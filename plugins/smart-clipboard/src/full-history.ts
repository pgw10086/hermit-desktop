/** 默认保留的活动历史条数，不计入废纸篓。 */
export const DEFAULT_HISTORY_LIMIT = 100
/** 默认允许占用的历史数据总字节数。 */
export const DEFAULT_TOTAL_BYTES = 1_000_000_000
/** 单条文本及其格式化表示允许的最大字节数。 */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024
/** 单条图片允许的最大字节数。 */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
/** 单条图片允许的最大像素数，避免解码资源失控。 */
export const MAX_IMAGE_PIXELS = 32 * 1024 * 1024
/** 单条文件列表允许包含的最大项目数。 */
export const MAX_FILE_ITEMS = 256
/** 文件列表 manifest 允许的最大序列化字节数。 */
export const MAX_FILE_MANIFEST_BYTES = 1024 * 1024
/** 废纸篓记录的固定保留时长。 */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/** 支持的剪贴板内容类型。 */
export type ClipboardKind = 'TEXT' | 'IMAGE' | 'FILE_LIST'
/** 用于阻止临时、隐私或自动生成内容进入历史的来源标记。 */
export type ClipboardMarker = 'transient' | 'concealed' | 'auto-generated'
/** 记录位于活动历史还是废纸篓。 */
export type HistoryState = 'history' | 'trash'
/** 历史记录的保留期限；forever 表示仅受容量和数量限制。 */
export type Retention = 'forever' | 30 | 90 | 365

export interface ClipboardEntryBase {
  /** 记录稳定身份。 */
  readonly id: string
  /** 内容类型。 */
  readonly kind: ClipboardKind
  /** 捕获来源应用名称，无法识别时为空。 */
  readonly sourceApplication: string | null
  /** 首次捕获时间，使用 Unix 毫秒时间戳。 */
  readonly createdAt: number
  /** 最近一次使用时间，使用 Unix 毫秒时间戳。 */
  readonly lastUsedAt: number
  /** 是否固定，固定记录不会被普通清理淘汰。 */
  readonly pinned: boolean
  /** 当前存放位置。 */
  readonly state: HistoryState
  /** 记录所有持久化表示占用的字节数。 */
  readonly byteSize: number
  /** 进入废纸篓的时间；活动记录没有该字段。 */
  readonly trashedAt?: number
}

export interface TextClipboardEntry extends ClipboardEntryBase {
  /** 类型收窄为文本记录。 */
  readonly kind: 'TEXT'
  /** 纯文本内容。 */
  readonly text: string
  /** 可选的 HTML/RTF 格式化表示。 */
  readonly formatted?: {
    /** HTML 表示。 */
    readonly html?: string
    /** RTF 表示。 */
    readonly rtf?: string
  }
}

export interface ImageClipboardEntry extends ClipboardEntryBase {
  /** 类型收窄为图片记录。 */
  readonly kind: 'IMAGE'
  /** 图片原始字节，不保存派生缩略图作为 Canonical 内容。 */
  readonly bytes: Uint8Array
  /** 图片像素宽度。 */
  readonly width: number
  /** 图片像素高度。 */
  readonly height: number
  /** 是否包含透明通道。 */
  readonly hasAlpha: boolean
}

export interface FileListItem {
  /** 展示用文件名，不作为唯一身份。 */
  readonly displayName: string
  /** 系统文件路径；重新读取时需重新检查是否存在。 */
  readonly path: string
  /** 路径当前指向文件或文件夹。 */
  readonly itemType: 'file' | 'folder'
  /** 最近一次刷新时路径是否存在。 */
  readonly exists: boolean
  /** 文件大小；文件夹或路径不可用时为空。 */
  readonly sizeBytes?: number
}

export interface FileListClipboardEntry extends ClipboardEntryBase {
  /** 类型收窄为文件列表记录。 */
  readonly kind: 'FILE_LIST'
  /** 捕获时的文件列表快照。 */
  readonly items: readonly FileListItem[]
}

/** 三类剪贴板记录的 Canonical 联合类型。 */
export type ClipboardEntry = TextClipboardEntry | ImageClipboardEntry | FileListClipboardEntry

export interface TextClipboardCapture {
  /** 类型收窄为文本捕获。 */
  readonly kind: 'TEXT'
  /** 平台读取到的纯文本。 */
  readonly text: string
  /** 来源应用身份。 */
  readonly sourceApplication: string | null
  /** 平台附带的过滤标记。 */
  readonly markers?: readonly ClipboardMarker[]
  /** 平台提供的格式化表示。 */
  readonly formatted?: TextClipboardEntry['formatted']
  /** 平台捕获时间；缺失时由领域服务生成。 */
  readonly capturedAt?: number
}

export interface ImageClipboardCapture {
  /** 类型收窄为图片捕获。 */
  readonly kind: 'IMAGE'
  /** 平台读取到的图片字节。 */
  readonly bytes: Uint8Array
  /** 图片像素宽度。 */
  readonly width: number
  /** 图片像素高度。 */
  readonly height: number
  /** 是否包含透明通道。 */
  readonly hasAlpha: boolean
  /** 来源应用身份。 */
  readonly sourceApplication: string | null
  /** 平台附带的过滤标记。 */
  readonly markers?: readonly ClipboardMarker[]
  /** 平台捕获时间。 */
  readonly capturedAt?: number
}

export interface FileListClipboardCapture {
  /** 类型收窄为文件列表捕获。 */
  readonly kind: 'FILE_LIST'
  /** 平台读取到的文件列表。 */
  readonly items: readonly FileListItem[]
  /** 来源应用身份。 */
  readonly sourceApplication: string | null
  /** 平台附带的过滤标记。 */
  readonly markers?: readonly ClipboardMarker[]
  /** 平台捕获时间。 */
  readonly capturedAt?: number
}

/** 平台捕获输入的联合类型。 */
export type ClipboardCapture = TextClipboardCapture | ImageClipboardCapture | FileListClipboardCapture

/** 捕获结果；重复和跳过是预期业务结果，不是异常。 */
export type CaptureResult =
  | { readonly status: 'recorded'; readonly entry: ClipboardEntry }
  | { readonly status: 'duplicate'; readonly entry: ClipboardEntry }
  | { readonly status: 'skipped'; readonly reason: CaptureSkipReason }

/** 捕获被跳过的可观察原因。 */
export type CaptureSkipReason =
  | 'empty'
  | 'marker'
  | 'too-large'
  | 'invalid-image'
  | 'invalid-file-list'
  | 'paused'
  | 'ignored'
  | 'storage-full'

export interface ClipboardRepository {
  /** 在指定存放位置寻找内容完全相同的记录。 */
  findDuplicate(candidate: ClipboardEntry, state: HistoryState): ClipboardEntry | undefined
  /** 列出指定存放位置的全部记录。 */
  list(state: HistoryState): readonly ClipboardEntry[]
  /** 可选的持久化层搜索能力。 */
  search?(state: HistoryState, query: string): readonly ClipboardEntry[]
  /** 插入一条新记录。 */
  insert(entry: ClipboardEntry): void
  /** 更新已有记录。 */
  update(entry: ClipboardEntry): void
  /** 删除记录及其持久化内容。 */
  remove(id: string): void
  /** 统计指定存放位置的记录数。 */
  count(state: HistoryState): number
  /** 统计指定存放位置或全部记录占用的字节数。 */
  bytes(state?: HistoryState): number
  /** 可选的物理存储压缩。 */
  compact?(): void
}

export interface ClipboardHistoryOptions {
  /** 活动历史条数上限。 */
  readonly historyLimit?: number
  /** 历史数据总字节上限。 */
  readonly totalBytes?: number
  /** 历史记录保留期限。 */
  readonly retention?: Retention
  /** 由 Core 注入的稳定 ID 生成器。 */
  readonly idFactory?: () => string
  /** 由调用方注入的时间源，便于保持领域行为可测试。 */
  readonly now?: () => number
  /** 是否从暂停状态开始。 */
  readonly paused?: boolean
}

export interface HistoryFilter {
  /** 对文本或文件名执行的搜索词。 */
  readonly query?: string
  /** 内容类型筛选。 */
  readonly kind?: ClipboardKind
  /** 来源应用筛选。 */
  readonly sourceApplication?: string
  /** 仅显示固定记录。 */
  readonly pinnedOnly?: boolean
}

export interface ClipboardSettings {
  /** 活动历史条数上限。 */
  readonly historyLimit: number
  /** 历史数据总字节上限。 */
  readonly totalBytes: number
  /** 历史记录保留期限。 */
  readonly retention: Retention
  /** 是否暂停捕获。 */
  readonly paused: boolean
}

/**
 * 三类剪贴板记录共用的领域服务。持久化、系统剪贴板和平台权限都从外部注入，服务本身
 * 只决定记录、去重、保留、Trash 和管理动作，避免 Quick Panel 与 History 形成两套规则。
 */
export class ClipboardHistoryStore {
  readonly #repository: ClipboardRepository
  #historyLimit: number
  #totalBytes: number
  #retention: Retention
  readonly #idFactory: () => string
  readonly #now: () => number
  #paused: boolean
  #ignoreNext = false

  constructor(repository: ClipboardRepository, options: ClipboardHistoryOptions = {}) {
    const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT
    const totalBytes = options.totalBytes ?? DEFAULT_TOTAL_BYTES
    if (!Number.isInteger(historyLimit) || historyLimit < 1) {
      throw new Error('历史条数上限必须是正整数')
    }
    if (!Number.isSafeInteger(totalBytes) || totalBytes < 1) {
      throw new Error('本地容量上限必须是正整数')
    }
    this.#repository = repository
    this.#historyLimit = historyLimit
    this.#totalBytes = totalBytes
    this.#retention = options.retention ?? 'forever'
    this.#idFactory = options.idFactory ?? (() => {
      throw new Error('剪贴板 ID 生成器尚未由 Core 注入')
    })
    this.#now = options.now ?? (() => Date.now())
    this.#paused = options.paused ?? false
  }

  /** 校验、去重并写入一次捕获；容量不足和过滤均返回可观察跳过原因。 */
  capture(capture: ClipboardCapture): CaptureResult {
    if (this.#paused) return { status: 'skipped', reason: 'paused' }
    if (this.#ignoreNext) {
      this.#ignoreNext = false
      return { status: 'skipped', reason: 'ignored' }
    }
    if (hasExcludedMarker(capture.markers)) return { status: 'skipped', reason: 'marker' }
    const prepared = prepareCapture(capture, this.#idFactory, this.#now())
    if ('status' in prepared) return prepared

    const duplicate = this.#repository.findDuplicate(prepared.entry, 'history')
    if (duplicate !== undefined) {
      const updated = withRecent(duplicate, prepared.entry.sourceApplication, prepared.entry.lastUsedAt)
      this.#repository.update(updated)
      this.#trimRetention(updated.lastUsedAt)
      return { status: 'duplicate', entry: updated }
    }

    this.#makeRoom(prepared.entry.byteSize)
    if (this.#repository.bytes() + prepared.entry.byteSize > this.#totalBytes) {
      return { status: 'skipped', reason: 'storage-full' }
    }
    this.#repository.insert(prepared.entry)
    this.#trimHistoryCount()
    return { status: 'recorded', entry: prepared.entry }
  }

  /** 按过滤器返回活动历史，并保持固定项和最近使用项的排序规则。 */
  list(filter: HistoryFilter = {}): readonly ClipboardEntry[] {
    const query = filter.query ?? ''
    const candidates = query.length === 0
      ? this.#repository.list('history')
      : this.#repository.search?.('history', query) ?? this.#repository.list('history')
    return [...candidates]
      .filter((entry) => filter.kind === undefined || entry.kind === filter.kind)
      .filter((entry) => !filter.pinnedOnly || entry.pinned)
      .filter((entry) => filter.sourceApplication === undefined
        || entry.sourceApplication === filter.sourceApplication)
      .filter((entry) => matchesQuery(entry, query))
      .sort(compareHistory)
  }

  /** 返回按最近删除时间排序的废纸篓记录。 */
  trash(): readonly ClipboardEntry[] {
    return [...this.#repository.list('trash')].sort(compareTrashRecent)
  }

  /** 返回当前捕获策略快照。 */
  settings(): ClipboardSettings {
    return {
      historyLimit: this.#historyLimit,
      totalBytes: this.#totalBytes,
      retention: this.#retention,
      paused: this.#paused,
    }
  }

  /** 切换捕获暂停状态，不删除已有历史。 */
  setPaused(paused: boolean): void {
    this.#paused = paused
  }

  /** 忽略下一次可记录的剪贴板变化；暂停期间不消耗这次一次性动作。 */
  ignoreNext(): void {
    this.#ignoreNext = true
  }

  /** 更新历史条数上限，并立即清理超出的非固定记录。 */
  setHistoryLimit(historyLimit: number): void {
    if (!Number.isInteger(historyLimit) || historyLimit < 1) throw new Error('历史条数上限必须是正整数')
    this.#historyLimit = historyLimit
    this.#trimHistoryCount()
  }

  /** 更新容量上限，并立即尝试释放足够空间。 */
  setTotalBytes(totalBytes: number): void {
    if (!Number.isSafeInteger(totalBytes) || totalBytes < 1) throw new Error('本地容量上限必须是正整数')
    this.#totalBytes = totalBytes
    this.#makeRoom(0)
  }

  /** 更新保留期限并立即清理已过期记录。 */
  setRetention(retention: Retention): void {
    this.#retention = retention
    this.purgeExpired(this.#now())
  }

  /** 记录一次使用并更新最近使用时间。 */
  use(id: string): ClipboardEntry | undefined {
    const entry = this.#repository.list('history').find((candidate) => candidate.id === id)
    if (entry === undefined) return undefined
    const usedAt = this.#now()
    assertTimestamp(usedAt, '使用时间')
    const used = withRecent(entry, entry.sourceApplication, usedAt)
    this.#repository.update(used)
    return used
  }

  /** 设置固定状态；固定记录不参与普通容量和数量清理。 */
  setPinned(id: string, pinned: boolean): ClipboardEntry | undefined {
    const entry = this.#repository.list('history').find((candidate) => candidate.id === id)
    if (entry === undefined) return undefined
    const updated = { ...entry, pinned }
    this.#repository.update(updated)
    return updated
  }

  /** 将活动记录移入废纸篓并清除固定状态。 */
  moveToTrash(id: string): ClipboardEntry | undefined {
    const entry = this.#repository.list('history').find((candidate) => candidate.id === id)
    if (entry === undefined) return undefined
    const trashedAt = this.#now()
    assertTimestamp(trashedAt, '删除时间')
    const updated = { ...entry, state: 'trash' as const, pinned: false, trashedAt }
    this.#repository.update(updated)
    return updated
  }

  /** 从废纸篓恢复记录；容量不足时保持废纸篓状态。 */
  restore(id: string): ClipboardEntry | undefined {
    const entry = this.#repository.list('trash').find((candidate) => candidate.id === id)
    if (entry === undefined) return undefined
    this.#makeRoom(entry.byteSize)
    if (this.#repository.bytes('history') + entry.byteSize > this.#totalBytes) return undefined
    const { trashedAt: _trashedAt, ...active } = entry
    const restored = { ...active, state: 'history' as const }
    this.#repository.update(restored)
    this.#trimHistoryCount()
    return restored
  }

  /** 永久删除活动或废纸篓中的记录。 */
  permanentlyDelete(id: string): boolean {
    const found = [...this.#repository.list('history'), ...this.#repository.list('trash')]
      .some((entry) => entry.id === id)
    if (!found) return false
    this.#repository.remove(id)
    this.#repository.compact?.()
    return true
  }

  /** 清空活动历史中的非固定记录。 */
  clearHistory(): number {
    const removable = this.#repository.list('history').filter((entry) => !entry.pinned)
    for (const entry of removable) this.#repository.remove(entry.id)
    if (removable.length > 0) this.#repository.compact?.()
    return removable.length
  }

  /** 清空活动历史和废纸篓中的全部记录。 */
  clearAllData(): number {
    const entries = [...this.#repository.list('history'), ...this.#repository.list('trash')]
    for (const entry of entries) this.#repository.remove(entry.id)
    if (entries.length > 0) this.#repository.compact?.()
    return entries.length
  }

  /** 清空废纸篓中的全部记录。 */
  emptyTrash(): number {
    const entries = this.#repository.list('trash')
    for (const entry of entries) this.#repository.remove(entry.id)
    if (entries.length > 0) this.#repository.compact?.()
    return entries.length
  }

  /** 按废纸篓固定期限和历史保留期限清理过期记录。 */
  purgeExpired(now = this.#now()): number {
    assertTimestamp(now, '清理时间')
    const historyCutoff = retentionCutoff(this.#retention, now)
    const expired = [
      ...this.#repository.list('trash').filter((entry) => now - (entry.trashedAt ?? entry.lastUsedAt) >= TRASH_RETENTION_MS),
      ...(historyCutoff === undefined
        ? []
        : this.#repository.list('history').filter((entry) => !entry.pinned && entry.lastUsedAt < historyCutoff)),
    ]
    for (const entry of expired) this.#repository.remove(entry.id)
    return expired.length
  }

  /** 先清理过期项，再按最旧优先释放非固定记录以满足容量要求。 */
  #makeRoom(requiredBytes: number): void {
    this.purgeExpired(this.#now())
    if (this.#repository.bytes() + requiredBytes <= this.#totalBytes) return
    const candidates = [
      ...this.#repository.list('trash'),
      ...this.#repository.list('history').filter((entry) => !entry.pinned),
    ].sort(compareOldest)
    for (const entry of candidates) {
      if (this.#repository.bytes() + requiredBytes <= this.#totalBytes) break
      this.#repository.remove(entry.id)
    }
  }

  /** 保持活动历史不超过数量上限，固定项不计入淘汰候选。 */
  #trimHistoryCount(): void {
    const ordinary = this.#repository.list('history')
      .filter((entry) => !entry.pinned)
      .sort(compareOldest)
    for (const entry of ordinary.slice(0, Math.max(0, ordinary.length - this.#historyLimit))) {
      this.#repository.remove(entry.id)
    }
  }

  /** 统一触发基于时间的过期清理。 */
  #trimRetention(now: number): void {
    this.purgeExpired(now)
  }
}

/** 仅用于领域测试和本地 fixture；生产实现由 Core 注入持久化 repository。 */
export class InMemoryClipboardRepository implements ClipboardRepository {
  readonly #entries = new Map<string, ClipboardEntry>()

  /** 在内存 fixture 中执行内容去重。 */
  findDuplicate(candidate: ClipboardEntry, state: HistoryState): ClipboardEntry | undefined {
    return this.list(state).find((entry) => sameContent(entry, candidate))
  }

  /** 返回指定状态的内存记录。 */
  list(state: HistoryState): readonly ClipboardEntry[] {
    return [...this.#entries.values()].filter((entry) => entry.state === state)
  }

  /** 插入内存记录并拒绝重复身份。 */
  insert(entry: ClipboardEntry): void {
    if (this.#entries.has(entry.id)) throw new Error(`剪贴板 ID 已存在：${entry.id}`)
    this.#entries.set(entry.id, entry)
  }

  /** 更新已存在的内存记录。 */
  update(entry: ClipboardEntry): void {
    if (!this.#entries.has(entry.id)) throw new Error(`剪贴板记录不存在：${entry.id}`)
    this.#entries.set(entry.id, entry)
  }

  /** 删除内存记录。 */
  remove(id: string): void {
    this.#entries.delete(id)
  }

  /** 统计指定状态的记录数，供容量和 UI 汇总使用。 */
  count(state: HistoryState): number {
    return this.list(state).length
  }

  /** 统计指定状态或全部记录的持久化字节数。 */
  bytes(state?: HistoryState): number {
    return [...this.#entries.values()]
      .filter((entry) => state === undefined || entry.state === state)
      .reduce((total, entry) => total + entry.byteSize, 0)
  }
}

/** 将平台捕获转换为领域记录，并在进入 repository 前完成大小和形状校验。 */
function prepareCapture(
  capture: ClipboardCapture,
  idFactory: () => string,
  capturedAt: number,
): CaptureResult | { readonly entry: ClipboardEntry } {
  assertTimestamp(capturedAt, '捕获时间')
  if (capture.kind === 'TEXT') {
    if (capture.text.length === 0) return { status: 'skipped', reason: 'empty' }
    const plainBytes = utf8ByteLength(capture.text)
    const htmlBytes = capture.formatted?.html === undefined ? 0 : utf8ByteLength(capture.formatted.html)
    const rtfBytes = capture.formatted?.rtf === undefined ? 0 : utf8ByteLength(capture.formatted.rtf)
    if (plainBytes > MAX_TEXT_BYTES || htmlBytes > MAX_TEXT_BYTES || rtfBytes > MAX_TEXT_BYTES) {
      return { status: 'skipped', reason: 'too-large' }
    }
    const byteSize = plainBytes + htmlBytes + rtfBytes
    return { entry: {
      id: createId(idFactory), kind: 'TEXT', text: capture.text, sourceApplication: capture.sourceApplication,
      createdAt: capturedAt, lastUsedAt: capturedAt, pinned: false, state: 'history', byteSize,
      ...(capture.formatted === undefined ? {} : { formatted: capture.formatted }),
    } }
  }
  if (capture.kind === 'IMAGE') {
    const byteSize = capture.bytes.byteLength
    if (byteSize === 0) return { status: 'skipped', reason: 'empty' }
    if (!Number.isInteger(capture.width) || !Number.isInteger(capture.height)
      || capture.width < 1 || capture.height < 1) {
      return { status: 'skipped', reason: 'invalid-image' }
    }
    if (byteSize > MAX_IMAGE_BYTES || capture.width * capture.height > MAX_IMAGE_PIXELS) {
      return { status: 'skipped', reason: 'too-large' }
    }
    return { entry: {
      id: createId(idFactory), kind: 'IMAGE', bytes: capture.bytes.slice(), width: capture.width,
      height: capture.height, hasAlpha: capture.hasAlpha, sourceApplication: capture.sourceApplication,
      createdAt: capturedAt, lastUsedAt: capturedAt, pinned: false, state: 'history', byteSize,
    } }
  }
  if (capture.items.length === 0 || capture.items.length > MAX_FILE_ITEMS) {
    return { status: 'skipped', reason: 'invalid-file-list' }
  }
  const manifestBytes = utf8ByteLength(JSON.stringify(capture.items))
  if (manifestBytes > MAX_FILE_MANIFEST_BYTES) return { status: 'skipped', reason: 'too-large' }
  return { entry: {
    id: createId(idFactory), kind: 'FILE_LIST', items: capture.items.map((item) => ({ ...item })),
    sourceApplication: capture.sourceApplication, createdAt: capturedAt, lastUsedAt: capturedAt,
    pinned: false, state: 'history', byteSize: manifestBytes,
  } }
}

/** 更新来源与最近使用时间，保持记录其他字段和状态不变。 */
function withRecent(entry: ClipboardEntry, sourceApplication: string | null, lastUsedAt: number): ClipboardEntry {
  return { ...entry, sourceApplication, lastUsedAt }
}

/** 按三类内容的 Canonical 字段判断是否相同。 */
function sameContent(left: ClipboardEntry, right: ClipboardEntry): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'TEXT' && right.kind === 'TEXT') return left.text === right.text
  if (left.kind === 'IMAGE' && right.kind === 'IMAGE') {
    return left.width === right.width && left.height === right.height
      && left.hasAlpha === right.hasAlpha && bytesEqual(left.bytes, right.bytes)
  }
  if (left.kind === 'FILE_LIST' && right.kind === 'FILE_LIST') {
    return left.items.length === right.items.length
      && left.items.every((item, index) => sameFileItem(item, right.items[index]))
  }
  return false
}

/** 文件项只比较路径和类型，展示名及存在性随当前文件系统刷新。 */
function sameFileItem(left: FileListItem, right: FileListItem | undefined): boolean {
  return right !== undefined && left.path === right.path && left.itemType === right.itemType
}

/** 比较图片原始字节，避免将 Uint8Array 身份作为去重依据。 */
function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  return left.every((value, index) => value === right[index])
}

/** 对文本正文或文件名执行大小写不敏感搜索，图片没有可搜索正文。 */
function matchesQuery(entry: ClipboardEntry, query: string): boolean {
  const normalized = query.toLocaleLowerCase()
  if (normalized.length === 0) return true
  if (entry.kind === 'TEXT') return entry.text.toLocaleLowerCase().includes(normalized)
  if (entry.kind === 'FILE_LIST') {
    return entry.items.some((item) => item.displayName.toLocaleLowerCase().includes(normalized))
  }
  return false
}

/** 历史排序：固定优先，其次按最近使用时间倒序。 */
function compareHistory(left: ClipboardEntry, right: ClipboardEntry): number {
  return Number(right.pinned) - Number(left.pinned) || compareRecent(left, right)
}

/** 最近记录的稳定排序比较器。 */
function compareRecent(left: ClipboardEntry, right: ClipboardEntry): number {
  return right.lastUsedAt - left.lastUsedAt || right.createdAt - left.createdAt
}

/** Trash 排序：最近移入优先，缺失删除时间时使用最近使用时间。 */
function compareTrashRecent(left: ClipboardEntry, right: ClipboardEntry): number {
  return (right.trashedAt ?? right.lastUsedAt) - (left.trashedAt ?? left.lastUsedAt)
    || compareRecent(left, right)
}

/** 清理排序：优先淘汰最早进入当前存放状态的非固定记录。 */
function compareOldest(left: ClipboardEntry, right: ClipboardEntry): number {
  const leftTime = left.state === 'trash' ? left.trashedAt ?? left.lastUsedAt : left.lastUsedAt
  const rightTime = right.state === 'trash' ? right.trashedAt ?? right.lastUsedAt : right.lastUsedAt
  return leftTime - rightTime || left.createdAt - right.createdAt
}

/** 判断平台标记是否声明该内容不得进入历史。 */
function hasExcludedMarker(markers: readonly ClipboardMarker[] | undefined): boolean {
  return markers?.some((marker) => marker === 'transient'
    || marker === 'concealed' || marker === 'auto-generated') ?? false
}

/** 按 UTF-8 字节而非 JavaScript 字符数计算容量。 */
function utf8ByteLength(value: string): number {
  let bytes = 0
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
  }
  return bytes
}

/** 统一校验持久化时间戳，避免负数或不安全整数污染排序和清理。 */
function assertTimestamp(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label}必须是非负安全整数`)
}

/** 调用注入的 ID 工厂并拒绝空身份，保证记录可寻址。 */
function createId(idFactory: () => string): string {
  const id = idFactory()
  if (id.length === 0) throw new Error('剪贴板历史 ID 不能为空')
  return id
}

/** 将保留策略转换为清理截止时间；forever 不产生截止时间。 */
function retentionCutoff(retention: Retention, now: number): number | undefined {
  if (retention === 'forever') return undefined
  return now - retention * 24 * 60 * 60 * 1000
}
