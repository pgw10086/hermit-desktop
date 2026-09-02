import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  ClipboardEntry,
  ClipboardHistoryOptions,
  ClipboardKind,
  ClipboardRepository,
  HistoryFilter,
  Retention,
} from '@hermit/smart-clipboard/domain'
import {
  actionAvailable,
  DEFAULT_ACTION_MAPPING,
  validateActionMapping,
} from '@hermit/smart-clipboard/actions'
import type { ActionMapping, ClipboardAction } from '@hermit/smart-clipboard/actions'
import { ClipboardHistoryStore as HistoryStore } from '@hermit/smart-clipboard/domain'
import { createZip } from './zip.js'

/**
 * 平台剪贴板稳定快照。platformGeneration 只用于平台并发一致性，不进入领域记录。
 */
export type ClipboardSnapshot =
  | {
      readonly kind: 'TEXT'
      readonly text: string
      readonly sourceApplication: string | null
      readonly markers?: readonly ('transient' | 'concealed' | 'auto-generated')[]
      readonly formatted?: { readonly html?: string; readonly rtf?: string }
      readonly platformGeneration?: number | string
    }
  | {
      readonly kind: 'IMAGE'
      readonly bytes: Uint8Array
      readonly width: number
      readonly height: number
      readonly hasAlpha: boolean
      readonly sourceApplication: string | null
      readonly markers?: readonly ('transient' | 'concealed' | 'auto-generated')[]
      readonly platformGeneration?: number | string
    }
  | {
      readonly kind: 'FILE_LIST'
      readonly items: readonly {
        readonly displayName: string
        readonly path: string
        readonly itemType: 'file' | 'folder'
        readonly exists: boolean
        readonly sizeBytes?: number
      }[]
      readonly sourceApplication: string | null
      readonly markers?: readonly ('transient' | 'concealed' | 'auto-generated')[]
      readonly platformGeneration?: number | string
    }

export interface ClipboardPlatformBridge {
  /** 读取平台剪贴板的稳定快照；没有新内容时返回 undefined。 */
  snapshot(): Promise<ClipboardSnapshot | undefined>
  /** 将历史记录写回系统剪贴板。 */
  write(entry: ClipboardEntry, plainText: boolean): Promise<{ readonly status: 'written' | 'denied'; readonly reason?: string }>
  /** 在用户明确请求 paste 时，向捕获写入前记录的目标应用发送粘贴。 */
  autoPaste(): Promise<{ readonly status: 'pasted' | 'copy-only'; readonly reason: string }>
  /** 取消当前显式粘贴目标，避免后续动作误用旧窗口。 */
  discardPasteTarget?(): void
}

export interface ClipboardCoreServiceOptions extends ClipboardHistoryOptions {
  /** 平台剪贴板轮询间隔。 */
  readonly pollIntervalMs?: number
  /** 快捷键动作映射。 */
  readonly actionMapping?: ActionMapping
  /** 不捕获的来源应用。 */
  readonly excludedApplications?: readonly string[]
  /** 不捕获的内容类型。 */
  readonly excludedKinds?: readonly ClipboardKind[]
  /** 设置发生变化时的持久化回调。 */
  readonly onSettingsChanged?: (settings: ReturnType<HistoryStore['settings']> & {
    readonly actionMapping: ActionMapping
    readonly excludedApplications: readonly string[]
    readonly excludedKinds: readonly ClipboardKind[]
  }) => void
}

/** 捕获循环当前状态；unavailable 是需要用户或资格流程处理的明确失败。 */
export type ClipboardCaptureStatus =
  | { readonly state: 'recording' | 'paused' | 'storage-full' }
  | { readonly state: 'unavailable'; readonly reason: string }

/** 历史操作结果；copy-only 表示写入成功但平台未完成显式粘贴。 */
export type ClipboardOperationResult =
  | { readonly status: 'copied' }
  | { readonly status: 'pasted' }
  | { readonly status: 'copy-only'; readonly reason: string }
  | { readonly status: 'unavailable'; readonly reason: string }

export class ClipboardCoreService {
  readonly #store: HistoryStore
  readonly #platform: ClipboardPlatformBridge
  readonly #pollIntervalMs: number
  readonly #onSettingsChanged: ClipboardCoreServiceOptions['onSettingsChanged']
  #actionMapping: ActionMapping
  #timer: ReturnType<typeof setInterval> | undefined
  #lastFingerprint: string | undefined
  #excludedApplications: readonly string[]
  #excludedKinds: readonly ClipboardKind[]
  #captureStatus: ClipboardCaptureStatus
  readonly #listeners = new Set<() => void>()

  constructor(repository: ClipboardRepository, platform: ClipboardPlatformBridge, options: ClipboardCoreServiceOptions = {}) {
    this.#store = new HistoryStore(repository, options)
    this.#platform = platform
    this.#pollIntervalMs = options.pollIntervalMs ?? 250
    if (!Number.isInteger(this.#pollIntervalMs) || this.#pollIntervalMs < 50) {
      throw new Error('剪贴板轮询间隔必须至少为 50ms')
    }
    this.#actionMapping = options.actionMapping ?? DEFAULT_ACTION_MAPPING
    this.#excludedApplications = normalizeApplicationExclusions(options.excludedApplications ?? [])
    this.#excludedKinds = normalizeKindExclusions(options.excludedKinds ?? [])
    this.#captureStatus = options.paused === true ? { state: 'paused' } : { state: 'recording' }
    this.#onSettingsChanged = options.onSettingsChanged
  }

  /** 暴露领域 store 给同一 Core 的导出和管理流程，外部不能替换其 repository。 */
  get store(): HistoryStore { return this.#store }

  /** 启动轮询；重复调用保持幂等。 */
  start(): void {
    if (this.#timer !== undefined) return
    this.#timer = setInterval(() => {
      void this.poll().catch((cause: unknown) => console.error(`Smart Clipboard 轮询失败: ${errorMessage(cause)}`))
    }, this.#pollIntervalMs)
    this.#timer.unref()
    void this.poll().catch((cause: unknown) => console.error(`Smart Clipboard 初始捕获失败: ${errorMessage(cause)}`))
  }

  /** 停止轮询并释放定时器。 */
  stop(): void {
    if (this.#timer === undefined) return
    clearInterval(this.#timer)
    this.#timer = undefined
  }

  /** 订阅历史、设置或捕获状态变化。 */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** 读取一次平台快照，按 fingerprint 去重并写入领域历史。 */
  async poll(): Promise<void> {
    let snapshot: ClipboardSnapshot | undefined
    try {
      snapshot = await this.#platform.snapshot()
    } catch (cause) {
      this.#setCaptureStatus({ state: 'unavailable', reason: errorMessage(cause) })
      throw cause
    }
    if (snapshot === undefined) return
    const fingerprint = fingerprintSnapshot(snapshot)
    if (fingerprint === this.#lastFingerprint) return
    this.#lastFingerprint = fingerprint
    if (
      this.#excludedKinds.includes(snapshot.kind)
      || (snapshot.sourceApplication !== null && this.#excludedApplications.includes(snapshot.sourceApplication))
    ) {
      this.#setCaptureStatus(this.#store.settings().paused ? { state: 'paused' } : { state: 'recording' })
      return
    }
    const result = this.#store.capture(snapshot)
    this.#setCaptureStatus(
      result.status === 'skipped' && result.reason === 'storage-full'
        ? { state: 'storage-full' }
        : this.#store.settings().paused ? { state: 'paused' } : { state: 'recording' },
    )
    if (result.status === 'recorded' || result.status === 'duplicate') this.#notify()
  }

  /** 返回活动历史，并刷新文件列表引用的存在性。 */
  list(filter: HistoryFilter = {}): readonly ClipboardEntry[] { return this.#store.list(filter).map(refreshFileList) }
  /** 返回废纸篓，并刷新文件列表引用的存在性。 */
  trash(): readonly ClipboardEntry[] { return this.#store.trash().map(refreshFileList) }
  settings(): ReturnType<HistoryStore['settings']> & {
    readonly actionMapping: ActionMapping
    readonly excludedApplications: readonly string[]
    readonly excludedKinds: readonly ClipboardKind[]
  } {
    return {
      ...this.#store.settings(), actionMapping: this.#actionMapping,
      excludedApplications: this.#excludedApplications,
      excludedKinds: this.#excludedKinds,
    }
  }
  /** 返回当前捕获状态。 */
  /** 返回当前捕获状态；状态变化由订阅回调统一广播。 */
  status(): ClipboardCaptureStatus { return this.#captureStatus }
  /** 暂停或恢复捕获，并将设置变化同步给持久化回调。 */
  setPaused(paused: boolean): void {
    this.#store.setPaused(paused)
    this.#setCaptureStatus(paused ? { state: 'paused' } : { state: 'recording' })
    this.#settingsChanged()
  }
  /** 忽略下一次平台捕获；该意图只消费一次。 */
  ignoreNext(): void { this.#store.ignoreNext(); this.#notify() }
  /** 更新活动历史条数上限。 */
  setHistoryLimit(limit: number): void { this.#store.setHistoryLimit(limit); this.#settingsChanged() }
  /** 更新历史总容量上限，并重新计算容量状态。 */
  setTotalBytes(totalBytes: number): void {
    this.#store.setTotalBytes(totalBytes)
    this.#setCaptureStatus(this.#normalCaptureStatus())
    this.#settingsChanged()
  }
  /** 更新废纸篓保留期限。 */
  setRetention(retention: Retention): void { this.#store.setRetention(retention); this.#settingsChanged() }
  /** 校验并更新快捷键动作映射。 */
  setActionMapping(mapping: ActionMapping): void {
    const validation = validateActionMapping(mapping)
    if (!validation.valid) throw new Error(`动作映射无效：${validation.field} ${validation.reason}`)
    this.#actionMapping = validation.mapping
    this.#settingsChanged()
  }
  /** 更新来源应用和内容类型排除规则，供后续轮询使用。 */
  setExclusions(excludedApplications: readonly string[], excludedKinds: readonly ClipboardKind[]): void {
    this.#excludedApplications = normalizeApplicationExclusions(excludedApplications)
    this.#excludedKinds = normalizeKindExclusions(excludedKinds)
    this.#settingsChanged()
  }

  /** 将历史记录写回系统；只有 paste 动作才继续尝试显式粘贴。 */
  async execute(id: string, action: ClipboardAction): Promise<ClipboardOperationResult> {
    const stored = this.#store.list().find((candidate) => candidate.id === id)
    const entry = stored === undefined ? undefined : refreshFileList(stored)
    if (entry === undefined) return this.#unavailable('历史记录不存在')
    if (!actionAvailable(action, entry.kind)) return this.#unavailable('纯文本复制只支持 TEXT')
    if (entry.kind === 'FILE_LIST' && entry.items.some((item) => !item.exists)) {
      return this.#unavailable('文件列表包含已不存在的引用')
    }
    const write = await this.#platform.write(entry, action === 'plain-text')
    if (write.status === 'denied') return this.#unavailable(write.reason ?? '系统剪贴板拒绝写入')
    this.#store.use(id)
    if (action !== 'paste') {
      this.#platform.discardPasteTarget?.()
      this.#notify()
      return { status: 'copied' }
    }
    const pasted = await this.#platform.autoPaste()
    this.#notify()
    return pasted.status === 'pasted'
      ? { status: 'pasted' }
      : { status: 'copy-only', reason: pasted.reason }
  }

  /** 切换固定状态；取消固定后允许容量清理重新评估记录。 */
  setPinned(id: string, pinned: boolean): ClipboardEntry | undefined {
    const result = this.#store.setPinned(id, pinned)
    if (result !== undefined) {
      if (!pinned) this.#setCaptureStatus(this.#normalCaptureStatus())
      this.#notify()
    }
    return result
  }
  /** 将记录移入 Trash，并广播列表变化。 */
  moveToTrash(id: string): ClipboardEntry | undefined { const result = this.#store.moveToTrash(id); if (result !== undefined) this.#notify(); return result }
  /** 从 Trash 恢复记录，并广播列表变化。 */
  restore(id: string): ClipboardEntry | undefined { const result = this.#store.restore(id); if (result !== undefined) this.#notify(); return result }
  /** 永久删除一条记录；成功后重新计算容量状态。 */
  permanentlyDelete(id: string): boolean { const result = this.#store.permanentlyDelete(id); if (result) { this.#setCaptureStatus(this.#normalCaptureStatus()); this.#notify() } return result }
  /** 清空未置顶历史记录，返回实际删除数量。 */
  clearHistory(): number { const result = this.#store.clearHistory(); if (result > 0) { this.#setCaptureStatus(this.#normalCaptureStatus()); this.#notify() } return result }
  /** 清空 Trash，返回实际删除数量。 */
  emptyTrash(): number { const result = this.#store.emptyTrash(); if (result > 0) { this.#setCaptureStatus(this.#normalCaptureStatus()); this.#notify() } return result }
  /** 删除 History 与 Trash 内容但保留设置。 */
  clearAllData(): number { const result = this.#store.clearAllData(); if (result > 0) { this.#setCaptureStatus(this.#normalCaptureStatus()); this.#notify() } return result }

  /** 将安全投影和可恢复内容导出为受限权限的 ZIP 文件。 */
  exportData(targetPath: string, includeTrash: boolean): string {
    mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 })
    const entries = [
      ...this.list(),
      ...(includeTrash ? this.trash() : []),
    ]
    const files = [
      {
        name: 'manifest.json',
        data: Buffer.from(`${JSON.stringify({ schemaVersion: 1, exportedAt: Date.now(), includeTrash, entries: entries.map(manifestEntry) }, null, 2)}\n`, 'utf8'),
      },
      ...entries.flatMap((entry) => exportEntryFiles(entry)),
    ]
    writeFileSync(targetPath, createZip(files), { mode: 0o600 })
    return targetPath
  }

  /** 通知所有 Client 订阅者刷新读取到的快照。 */
  #notify(): void {
    for (const listener of this.#listeners) listener()
  }

  /** 持久化设置变化并通知 Client。 */
  #settingsChanged(): void {
    this.#onSettingsChanged?.(this.settings())
    this.#notify()
  }

  /** 仅在捕获状态实际变化时通知订阅者。 */
  #setCaptureStatus(status: ClipboardCaptureStatus): void {
    if (JSON.stringify(status) === JSON.stringify(this.#captureStatus)) return
    this.#captureStatus = status
    this.#notify()
  }

  /** 根据暂停设置计算正常捕获状态。 */
  #normalCaptureStatus(): ClipboardCaptureStatus {
    return this.#store.settings().paused ? { state: 'paused' } : { state: 'recording' }
  }

  /** 取消潜在粘贴目标并返回不可用结果。 */
  #unavailable(reason: string): ClipboardOperationResult {
    this.#platform.discardPasteTarget?.()
    return { status: 'unavailable', reason }
  }
}

/** 标准化并限制来源应用排除列表。 */
function normalizeApplicationExclusions(values: readonly string[]): readonly string[] {
  const normalized = [...new Set(values.map((value) => value.trim()).filter(Boolean))]
  if (normalized.length > 256 || normalized.some((value) => value.length > 256)) {
    throw new Error('排除应用最多 256 个，每个标识最多 256 个字符')
  }
  return normalized
}

/** 标准化并校验内容类型排除列表。 */
function normalizeKindExclusions(values: readonly ClipboardKind[]): readonly ClipboardKind[] {
  const normalized = [...new Set(values)]
  if (normalized.some((value) => value !== 'TEXT' && value !== 'IMAGE' && value !== 'FILE_LIST')) {
    throw new Error('排除内容类型无效')
  }
  return normalized
}

/** 重新探测文件列表路径，保持历史记录本身不可变。 */
function refreshFileList(entry: ClipboardEntry): ClipboardEntry {
  if (entry.kind !== 'FILE_LIST') return entry
  return {
    ...entry,
    items: entry.items.map((item) => {
      const { sizeBytes: _previousSize, ...withoutSize } = item
      if (!existsSync(item.path)) return { ...withoutSize, exists: false }
      try {
        const stats = statSync(item.path)
        return {
          ...withoutSize,
          exists: true,
          itemType: stats.isDirectory() ? 'folder' : 'file',
          ...(stats.isFile() ? { sizeBytes: stats.size } : {}),
        }
      } catch {
        // 路径可能在 exists 与 stat 之间消失；对用户只呈现当前不可用，不读取正文或重试。
        return { ...withoutSize, exists: false }
      }
    }),
  }
}

/** 将平台异常转换为可观察消息。 */
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** 生成导出 manifest 条目，不把图片二进制内联到 JSON。 */
function manifestEntry(entry: ClipboardEntry): unknown {
  if (entry.kind === 'IMAGE') return { ...entry, bytes: undefined, file: `entries/${entry.id}.png` }
  if (entry.kind === 'TEXT') return { ...entry, file: `entries/${entry.id}.txt` }
  return { ...entry, file: `entries/${entry.id}.json` }
}

/** 将单条记录拆分为导出 ZIP 中的独立文件。 */
function exportEntryFiles(entry: ClipboardEntry): { readonly name: string; readonly data: Uint8Array }[] {
  if (entry.kind === 'IMAGE') return [{ name: `entries/${entry.id}.png`, data: entry.bytes }]
  if (entry.kind === 'TEXT') return [{ name: `entries/${entry.id}.txt`, data: Buffer.from(entry.text, 'utf8') }]
  return [{ name: `entries/${entry.id}.json`, data: Buffer.from(`${JSON.stringify(entry, null, 2)}\n`, 'utf8') }]
}

/** 生成平台快照指纹，避免轮询重复写入同一内容。 */
function fingerprintSnapshot(snapshot: ClipboardSnapshot): string {
  if (snapshot.platformGeneration !== undefined) return `GENERATION:${String(snapshot.platformGeneration)}`
  if (snapshot.kind === 'TEXT') return `TEXT:${snapshot.text}:${JSON.stringify(snapshot.formatted ?? null)}`
  if (snapshot.kind === 'IMAGE') return `IMAGE:${snapshot.width}x${snapshot.height}:${Buffer.from(snapshot.bytes).toString('base64')}`
  return `FILE_LIST:${snapshot.items.map((item) => `${item.itemType}:${item.path}`).join('\u0000')}`
}
