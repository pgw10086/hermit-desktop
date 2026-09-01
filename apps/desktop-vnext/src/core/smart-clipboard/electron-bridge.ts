import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { clipboard, nativeImage, systemPreferences } from 'electron'
import type { ClipboardEntry } from '@hermit/smart-clipboard/domain'
import type { ClipboardPlatformBridge, ClipboardSnapshot } from './service.js'
import type {
  MacApplicationIdentity,
  MacClipboardNativeBridge,
  MacClipboardPayload,
} from './macos-native-bridge.js'

interface PendingMacWrite {
  /** 本次平台写入身份，用于阻止轮询把自身写入再次记录。 */
  readonly operationId: string
  /** 写入时的 pasteboard generation，用于并发一致性检查。 */
  readonly generation: number
}

/** Electron 只负责平台读写；业务去重、额度和状态仍由 ClipboardCoreService 决定。 */
export class ElectronClipboardBridge implements ClipboardPlatformBridge {
  readonly #macosNative: MacClipboardNativeBridge | undefined
  #macosGeneration: number | undefined
  #pendingMacWrite: PendingMacWrite | undefined
  #pasteTarget: MacApplicationIdentity | undefined

  constructor(macosNative?: MacClipboardNativeBridge) {
    if (process.platform === 'darwin' && macosNative === undefined) {
      throw new Error('macOS Smart Clipboard 需要随包 native bridge，不能降级为内容轮询')
    }
    this.#macosNative = macosNative
  }

  /** 记录触发复制动作前的前台应用，供 use 动作恢复焦点并粘贴。 */
  rememberPasteTarget(): void {
    this.#pasteTarget = this.#macosNative?.captureFrontmostApplication()
  }

  /** 清除目标应用和待确认写入，避免后续操作误用过期身份。 */
  discardPasteTarget(): void {
    this.#pasteTarget = undefined
    this.#pendingMacWrite = undefined
  }

  /** 读取稳定平台快照；macOS 优先走带 generation 的原生桥。 */
  async snapshot(): Promise<ClipboardSnapshot | undefined> {
    if (this.#macosNative !== undefined) return this.#snapshotMacos()
    return electronSnapshot()
  }

  /** 将领域记录写入系统剪贴板，平台拒绝时返回可展示原因。 */
  async write(entry: ClipboardEntry, plainText: boolean): Promise<{ status: 'written' | 'denied'; reason?: string }> {
    try {
      if (this.#macosNative !== undefined) return this.#writeMacos(entry, plainText)
      writeElectronClipboard(entry, plainText)
      return { status: 'written' }
    } catch (cause) {
      return { status: 'denied', reason: cause instanceof Error ? cause.message : String(cause) }
    }
  }

  /** 在复制成功后尝试恢复原应用并发送粘贴；失败时明确降级为只复制。 */
  async autoPaste(): Promise<{ status: 'pasted' | 'copy-only'; reason: string }> {
    if (this.#macosNative === undefined) {
      return this.#finishCopyOnly('当前平台自动粘贴发送器尚未通过资格')
    }
    const target = this.#pasteTarget
    const pending = this.#pendingMacWrite
    if (target === undefined) return this.#finishCopyOnly('未记录到原目标应用')
    if (pending === undefined) return this.#finishCopyOnly('系统剪贴板写入身份不可用')
    if (!systemPreferences.isTrustedAccessibilityClient(false)) {
      return this.#finishCopyOnly('macOS 辅助功能权限未开启')
    }
    const activation = this.#macosNative.requestActivate(target)
    if (activation.status === 'copy-only') return this.#finishCopyOnly(macReason(activation.reason))

    const deadline = Date.now() + 500
    while (Date.now() < deadline) {
      await delay(20)
      const result = this.#macosNative.postPasteIfCurrent(target, pending.operationId, pending.generation)
      if (result.status === 'posted') {
        this.discardPasteTarget()
        return {
          status: 'pasted',
          reason: result.clipboardAfter === 'unchanged' ? '系统已发送 Command+V' : '系统已发送 Command+V，发送后剪贴板发生变化',
        }
      }
      if (result.retryable === true) continue
      return this.#finishCopyOnly(macReason(result.reason))
    }
    return this.#finishCopyOnly('目标应用未在限定时间内获得焦点')
  }

  /** 读取 macOS 原生快照并转换为 Core 可消费的统一结构。 */
  #snapshotMacos(): ClipboardSnapshot | undefined {
    const result = this.#macosNative?.readStableSnapshot(this.#macosGeneration)
    if (result === undefined) throw new Error('macOS Clipboard native bridge 未加载')
    if (result.status === 'unstable') return undefined
    this.#macosGeneration = result.generation
    if (result.status === 'baseline' || result.status === 'unchanged' || result.status === 'ignored' || result.status === 'unsupported') {
      return undefined
    }
    if (
      this.#pendingMacWrite !== undefined
      && result.operationId === this.#pendingMacWrite.operationId
      && result.generation === this.#pendingMacWrite.generation
    ) {
      return undefined
    }
    const sourceApplication = result.sourceApp?.bundleIdentifier ?? result.sourceApp?.localizedName ?? null
    const generation = result.generation
    const snapshot = result.snapshot
    if (snapshot.kind === 'TEXT') {
      const html = decodeOptionalText(snapshot.htmlBase64)
      const rtf = decodeOptionalText(snapshot.rtfBase64)
      return {
        kind: 'TEXT', text: snapshot.plain, sourceApplication, platformGeneration: generation,
        ...(html === undefined && rtf === undefined ? {} : { formatted: { ...(html === undefined ? {} : { html }), ...(rtf === undefined ? {} : { rtf }) } }),
      }
    }
    if (snapshot.kind === 'IMAGE') {
      return {
        kind: 'IMAGE', bytes: new Uint8Array(Buffer.from(snapshot.pngBase64, 'base64')),
        width: snapshot.width, height: snapshot.height, hasAlpha: snapshot.hasAlpha,
        sourceApplication, platformGeneration: generation,
      }
    }
    return {
      kind: 'FILE_LIST', items: snapshot.fileUrls.map(fileItemFromUrl),
      sourceApplication, platformGeneration: generation,
    }
  }

  /** 通过 operationId 与 generation 标记一次 macOS 写入。 */
  #writeMacos(entry: ClipboardEntry, plainText: boolean): { status: 'written' | 'denied'; reason?: string } {
    const operationId = randomUUID()
    const result = this.#macosNative?.writeSnapshot(macPayload(entry, plainText), operationId)
    if (result === undefined) return { status: 'denied', reason: 'macOS Clipboard native bridge 未加载' }
    if (result.status === 'conflict') return { status: 'denied', reason: '写入期间系统剪贴板已被其他应用更新' }
    if (result.status === 'failed') {
      return { status: 'denied', reason: result.reason === 'marker-verification-failed' ? '写入后操作标记校验失败' : '系统剪贴板拒绝写入' }
    }
    this.#pendingMacWrite = { operationId, generation: result.generation }
    this.#macosGeneration = result.generation
    return { status: 'written' }
  }

  /** 清理一次性粘贴上下文并返回只复制结果。 */
  #finishCopyOnly(reason: string): { status: 'copy-only'; reason: string } {
    this.discardPasteTarget()
    return { status: 'copy-only', reason }
  }
}

/** 按文件、图片、文本优先级读取 Electron 系统剪贴板。 */
function electronSnapshot(): ClipboardSnapshot | undefined {
  const fileSnapshot = readFileList()
  if (fileSnapshot !== undefined) return fileSnapshot
  const image = clipboard.readImage()
  if (!image.isEmpty()) {
    const size = image.getSize()
    return {
      kind: 'IMAGE', bytes: new Uint8Array(image.toPNG()), width: size.width, height: size.height,
      hasAlpha: true, sourceApplication: null,
    }
  }
  const text = clipboard.readText()
  if (text.length === 0) return undefined
  const html = clipboard.readHTML()
  const rtf = clipboard.readRTF()
  return {
    kind: 'TEXT', text, sourceApplication: null,
    ...(html.length === 0 && rtf.length === 0 ? {} : { formatted: { ...(html.length === 0 ? {} : { html }), ...(rtf.length === 0 ? {} : { rtf }) } }),
  }
}

/** 将历史记录编码为 Electron 支持的剪贴板格式。 */
function writeElectronClipboard(entry: ClipboardEntry, plainText: boolean): void {
  if (entry.kind === 'TEXT') {
    const data: Parameters<typeof clipboard.write>[0] = { text: entry.text }
    if (!plainText && entry.formatted?.html !== undefined) data.html = entry.formatted.html
    if (!plainText && entry.formatted?.rtf !== undefined) data.rtf = entry.formatted.rtf
    clipboard.write(data)
  } else if (entry.kind === 'IMAGE') {
    clipboard.write({ image: nativeImage.createFromBuffer(Buffer.from(entry.bytes)) })
  } else {
    clipboard.clear()
    const uriList = entry.items.map((item) => pathToFileURL(item.path).href).join('\r\n') + '\r\n'
    clipboard.writeBuffer('text/uri-list', Buffer.from(uriList, 'utf8'))
  }
}

/** 将领域记录转换为 macOS native bridge 的 base64 payload。 */
function macPayload(entry: ClipboardEntry, plainText: boolean): MacClipboardPayload {
  if (entry.kind === 'TEXT') {
    return {
      kind: 'TEXT', plain: entry.text,
      ...(!plainText && entry.formatted?.html !== undefined ? { htmlBase64: Buffer.from(entry.formatted.html, 'utf8').toString('base64') } : {}),
      ...(!plainText && entry.formatted?.rtf !== undefined ? { rtfBase64: Buffer.from(entry.formatted.rtf, 'utf8').toString('base64') } : {}),
    }
  }
  if (entry.kind === 'IMAGE') return { kind: 'IMAGE', pngBase64: Buffer.from(entry.bytes).toString('base64'), width: entry.width, height: entry.height, hasAlpha: entry.hasAlpha }
  return { kind: 'FILE_LIST', fileUrls: entry.items.map((item) => pathToFileURL(item.path).href) }
}

/** 解析 Electron 的文件 URL 格式，并构造当前路径快照。 */
function readFileList(): ClipboardSnapshot | undefined {
  const formats = clipboard.availableFormats()
  const format = formats.find((candidate) => candidate === 'text/uri-list' || candidate === 'public.file-url')
  if (format === undefined) return undefined
  const raw = clipboard.readBuffer(format).toString('utf8')
  const paths = raw.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => toPath(line))
    .filter((value): value is string => value !== undefined)
  if (paths.length === 0) return undefined
  return { kind: 'FILE_LIST', sourceApplication: null, items: paths.map(fileItemFromPath) }
}

/** 将 macOS 文件 URL 转为本机路径；非法 URL 必须显式失败。 */
function fileItemFromUrl(value: string) {
  const filePath = toPath(value)
  if (filePath === undefined) throw new Error(`macOS Clipboard 返回非本机文件 URL：${value}`)
  return fileItemFromPath(filePath)
}

/** 读取文件路径的当前存在性、类型和大小。 */
function fileItemFromPath(filePath: string) {
  const exists = existsSync(filePath)
  let sizeBytes: number | undefined
  let itemType: 'file' | 'folder' = 'file'
  if (exists) {
    const stats = statSync(filePath)
    itemType = stats.isDirectory() ? 'folder' : 'file'
    if (stats.isFile()) sizeBytes = stats.size
  }
  return {
    displayName: basename(filePath), path: filePath, itemType, exists,
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
  }
}

/** 只接受本机 file URL 或绝对路径，拒绝远程资源。 */
function toPath(value: string): string | undefined {
  try {
    if (value.startsWith('file://')) return fileURLToPath(value)
    if (value.startsWith('/')) return value
    return undefined
  } catch {
    return undefined
  }
}

/** 解码 native bridge 可选的 base64 文本字段。 */
function decodeOptionalText(value: string | undefined): string | undefined {
  return value === undefined ? undefined : Buffer.from(value, 'base64').toString('utf8')
}

/** 把原生失败码转换为用户可理解的自动粘贴原因。 */
function macReason(reason: string): string {
  const messages: Record<string, string> = {
    'target-gone': '原目标应用已经退出',
    'target-identity-mismatch': '原目标应用身份已经变化',
    'activation-rejected': '系统拒绝恢复原目标应用',
    'target-not-frontmost': '原目标应用未获得焦点',
    'accessibility-denied': 'macOS 辅助功能权限未开启',
    'clipboard-changed': '自动粘贴前系统剪贴板已被其他应用更新',
    'operation-mismatch': '自动粘贴前剪贴板操作标记已变化',
    'event-create-failed': '系统无法创建粘贴按键事件',
  }
  return messages[reason] ?? `自动粘贴不可用：${reason}`
}

/** 在轮询自动粘贴窗口内短暂等待，避免忙等。 */
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
