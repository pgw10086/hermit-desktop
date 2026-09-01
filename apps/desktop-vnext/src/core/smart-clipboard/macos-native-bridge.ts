import { createRequire } from 'node:module'
import path from 'node:path'

export interface MacApplicationIdentity {
  /** 前台应用进程 ID。 */
  readonly pid: number
  /** macOS bundle identifier，用于确认目标身份。 */
  readonly bundleIdentifier?: string
  /** 面向诊断展示的本地化应用名称。 */
  readonly localizedName?: string
  /** 应用启动时间，用于区分 PID 重用。 */
  readonly launchDateMs?: number
}

export interface MacSourceApplication extends Partial<MacApplicationIdentity> {
  /** 来源身份的采集依据。 */
  readonly basis: 'explicit-marker' | 'frontmost-sample'
}

/** 原生桥与 macOS 剪贴板之间传递的已编码 payload。 */
export type MacClipboardPayload =
  | { readonly kind: 'TEXT'; readonly plain: string; readonly htmlBase64?: string; readonly rtfBase64?: string }
  | { readonly kind: 'IMAGE'; readonly pngBase64: string; readonly width: number; readonly height: number; readonly hasAlpha: boolean }
  | { readonly kind: 'FILE_LIST'; readonly fileUrls: readonly string[] }

/** 原生读取结果；unstable 表示读取期间剪贴板发生并发变化。 */
export type MacReadResult =
  | { readonly status: 'baseline'; readonly generation: number }
  | { readonly status: 'unchanged'; readonly generation: number }
  | { readonly status: 'unstable'; readonly beforeGeneration: number; readonly afterGeneration: number }
  | { readonly status: 'ignored'; readonly generation: number; readonly markers: readonly string[]; readonly operationId?: string }
  | { readonly status: 'unsupported'; readonly generation: number; readonly types: readonly string[]; readonly operationId?: string }
  | {
      readonly status: 'snapshot'
      readonly generation: number
      readonly operationId?: string
      readonly sourceApp?: MacSourceApplication
      readonly snapshot: MacClipboardPayload
    }

/** 原生写入结果；conflict 表示目标 generation 已变化。 */
export type MacWriteResult =
  | { readonly status: 'written'; readonly generation: number }
  | { readonly status: 'conflict'; readonly observedGeneration: number }
  | { readonly status: 'failed'; readonly reason: 'write-failed' | 'marker-verification-failed' }

/** 激活目标应用的结果；copy-only 表示不能保证前台切换。 */
export type MacActivateResult =
  | { readonly status: 'requested' }
  | { readonly status: 'copy-only'; readonly reason: 'target-gone' | 'target-identity-mismatch' | 'activation-rejected' }

/** 带目标身份和操作身份校验的自动粘贴结果。 */
export type MacPostPasteResult =
  | { readonly status: 'posted'; readonly clipboardAfter: 'unchanged' | 'changed' }
  | {
      readonly status: 'copy-only'
      readonly reason: 'target-gone' | 'target-identity-mismatch' | 'target-not-frontmost' | 'accessibility-denied' | 'clipboard-changed' | 'operation-mismatch' | 'event-create-failed'
      readonly retryable?: boolean
    }

type MacPostPasteFailureReason = Extract<MacPostPasteResult, { readonly status: 'copy-only' }>['reason']

interface RawMacClipboardAddon {
  /** 读取稳定剪贴板快照的 JSON。 */
  readStableSnapshot(lastGeneration?: number): string
  /** 写入剪贴板快照并绑定 operationId。 */
  writeSnapshot(payloadJson: string, operationId: string): string
  /** 捕获当前前台应用身份的 JSON。 */
  captureFrontmostApplication(): string
  /** 请求激活目标应用。 */
  requestActivate(targetJson: string): string
  /** 仅在目标和 generation 仍匹配时执行粘贴。 */
  postPasteIfCurrent(targetJson: string, operationId: string, generation: number): string
}

export interface MacClipboardNativeBridge {
  /** 读取并解析稳定快照。 */
  readStableSnapshot(lastGeneration?: number): MacReadResult
  /** 写入 payload 并返回原生 generation。 */
  writeSnapshot(payload: MacClipboardPayload, operationId: string): MacWriteResult
  /** 读取当前前台应用身份。 */
  captureFrontmostApplication(): MacApplicationIdentity | undefined
  /** 请求激活目标应用。 */
  requestActivate(target: MacApplicationIdentity): MacActivateResult
  /** 校验目标、操作和 generation 后发送粘贴。 */
  postPasteIfCurrent(target: MacApplicationIdentity, operationId: string, generation: number): MacPostPasteResult
}

/** 根据打包状态解析随包或开发构建的 macOS native bridge 路径。 */
export function macClipboardNativeModulePath(options: {
  /** 是否从发布资源目录加载。 */
  readonly isPackaged: boolean
  /** Electron resources 目录。 */
  readonly resourcesPath: string
  /** 开发环境应用路径。 */
  readonly appPath: string
}): string {
  return options.isPackaged
    ? path.join(options.resourcesPath, 'runtime', 'native', 'hermit_macos_clipboard_bridge.node')
    : path.resolve(options.appPath, '..', '..', 'native', 'macos-clipboard-bridge', 'build', 'Release', 'hermit_macos_clipboard_bridge.node')
}

/** 加载并校验原生 addon 的公开方法，再包装为类型化桥接接口。 */
export function loadMacClipboardNativeBridge(modulePath: string): MacClipboardNativeBridge {
  const loaded: unknown = createRequire(import.meta.url)(modulePath)
  if (!isRecord(loaded)) throw new Error('macOS Clipboard native addon 导出无效')
  for (const name of ['readStableSnapshot', 'writeSnapshot', 'captureFrontmostApplication', 'requestActivate', 'postPasteIfCurrent']) {
    if (typeof loaded[name] !== 'function') throw new Error(`macOS Clipboard native addon 缺少 ${name}`)
  }
  const addon = loaded as unknown as RawMacClipboardAddon
  return {
    readStableSnapshot: (lastGeneration) => parseReadResult(
      lastGeneration === undefined ? addon.readStableSnapshot() : addon.readStableSnapshot(lastGeneration),
    ),
    writeSnapshot: (payload, operationId) => parseWriteResult(addon.writeSnapshot(JSON.stringify(payload), operationId)),
    captureFrontmostApplication: () => parseApplication(addon.captureFrontmostApplication()),
    requestActivate: (target) => parseActivateResult(addon.requestActivate(JSON.stringify(target))),
    postPasteIfCurrent: (target, operationId, generation) => parsePostResult(
      addon.postPasteIfCurrent(JSON.stringify(target), operationId, generation),
    ),
  }
}

/** 解析 native readStableSnapshot 的 JSON 结果。 */
function parseReadResult(json: string): MacReadResult {
  const value = parseObject(json, 'readStableSnapshot')
  const status = value.status
  if (status === 'baseline' || status === 'unchanged') return { status, generation: integer(value.generation, 'generation') }
  if (status === 'unstable') {
    return { status, beforeGeneration: integer(value.beforeGeneration, 'beforeGeneration'), afterGeneration: integer(value.afterGeneration, 'afterGeneration') }
  }
  const generation = integer(value.generation, 'generation')
  const operationId = optionalString(value.operationId, 'operationId')
  if (status === 'ignored') return { status, generation, markers: stringArray(value.markers, 'markers'), ...(operationId === undefined ? {} : { operationId }) }
  if (status === 'unsupported') return { status, generation, types: stringArray(value.types, 'types'), ...(operationId === undefined ? {} : { operationId }) }
  if (status !== 'snapshot') throw new Error(`macOS Clipboard native read status 无效：${String(status)}`)
  const snapshot = parsePayload(value.snapshot)
  const sourceApp = value.sourceApp === undefined ? undefined : parseSource(value.sourceApp)
  return { status, generation, snapshot, ...(operationId === undefined ? {} : { operationId }), ...(sourceApp === undefined ? {} : { sourceApp }) }
}

/** 解析并限制原生 payload 形状，避免未经校验的数据进入 Core。 */
function parsePayload(input: unknown): MacClipboardPayload {
  if (!isRecord(input)) throw new Error('macOS Clipboard native snapshot 无效')
  if (input.kind === 'TEXT') {
    return {
      kind: 'TEXT', plain: requiredString(input.plain, 'plain'),
      ...optionalProperty(input.htmlBase64, 'htmlBase64'), ...optionalProperty(input.rtfBase64, 'rtfBase64'),
    }
  }
  if (input.kind === 'IMAGE') {
    return {
      kind: 'IMAGE', pngBase64: requiredString(input.pngBase64, 'pngBase64'),
      width: positiveInteger(input.width, 'width'), height: positiveInteger(input.height, 'height'),
      hasAlpha: booleanValue(input.hasAlpha, 'hasAlpha'),
    }
  }
  if (input.kind === 'FILE_LIST') return { kind: 'FILE_LIST', fileUrls: stringArray(input.fileUrls, 'fileUrls') }
  throw new Error(`macOS Clipboard native snapshot kind 无效：${String(input.kind)}`)
}

/** 解析 native writeSnapshot 的写入或 generation 冲突结果。 */
function parseWriteResult(json: string): MacWriteResult {
  const value = parseObject(json, 'writeSnapshot')
  if (value.status === 'written') return { status: 'written', generation: integer(value.generation, 'generation') }
  if (value.status === 'conflict') return { status: 'conflict', observedGeneration: integer(value.observedGeneration, 'observedGeneration') }
  if (value.status === 'failed' && (value.reason === 'write-failed' || value.reason === 'marker-verification-failed')) {
    return { status: 'failed', reason: value.reason }
  }
  throw new Error('macOS Clipboard native write result 无效')
}

/** 解析前台应用身份；原生返回 null 表示当前没有可用目标。 */
function parseApplication(json: string): MacApplicationIdentity | undefined {
  const value: unknown = JSON.parse(json)
  if (value === null) return undefined
  return applicationFromObject(value)
}

/** 解析来源应用并保留其采集依据。 */
function parseSource(value: unknown): MacSourceApplication {
  if (!isRecord(value)) throw new Error('macOS Clipboard source identity 无效')
  const record = value
  if (record.basis !== 'explicit-marker' && record.basis !== 'frontmost-sample') throw new Error('macOS Clipboard source basis 无效')
  const pid = record.pid === undefined ? undefined : positiveInteger(record.pid, 'pid')
  const bundleIdentifier = optionalString(record.bundleIdentifier, 'bundleIdentifier')
  const localizedName = optionalString(record.localizedName, 'localizedName')
  const launchDateMs = record.launchDateMs === undefined ? undefined : finiteNumber(record.launchDateMs, 'launchDateMs')
  return {
    basis: record.basis,
    ...(pid === undefined ? {} : { pid }),
    ...(bundleIdentifier === undefined ? {} : { bundleIdentifier }),
    ...(localizedName === undefined ? {} : { localizedName }),
    ...(launchDateMs === undefined ? {} : { launchDateMs }),
  }
}

/** 将已校验的对象转换为应用身份。 */
function applicationFromObject(value: unknown): MacApplicationIdentity {
  if (!isRecord(value)) throw new Error('macOS Clipboard application identity 无效')
  const pid = positiveInteger(value.pid, 'pid')
  const bundleIdentifier = optionalString(value.bundleIdentifier, 'bundleIdentifier')
  const localizedName = optionalString(value.localizedName, 'localizedName')
  const launchDateMs = value.launchDateMs === undefined ? undefined : finiteNumber(value.launchDateMs, 'launchDateMs')
  return { pid, ...(bundleIdentifier === undefined ? {} : { bundleIdentifier }), ...(localizedName === undefined ? {} : { localizedName }), ...(launchDateMs === undefined ? {} : { launchDateMs }) }
}

/** 解析目标激活结果。 */
function parseActivateResult(json: string): MacActivateResult {
  const value = parseObject(json, 'requestActivate')
  if (value.status === 'requested') return { status: 'requested' }
  if (value.status === 'copy-only' && (value.reason === 'target-gone' || value.reason === 'target-identity-mismatch' || value.reason === 'activation-rejected')) {
    return { status: 'copy-only', reason: value.reason }
  }
  throw new Error('macOS Clipboard activation result 无效')
}

/** 解析带身份、generation 和操作一致性检查的粘贴结果。 */
function parsePostResult(json: string): MacPostPasteResult {
  const value = parseObject(json, 'postPasteIfCurrent')
  if (value.status === 'posted' && (value.clipboardAfter === 'unchanged' || value.clipboardAfter === 'changed')) {
    return { status: 'posted', clipboardAfter: value.clipboardAfter }
  }
  const reasons = new Set(['target-gone', 'target-identity-mismatch', 'target-not-frontmost', 'accessibility-denied', 'clipboard-changed', 'operation-mismatch', 'event-create-failed'])
  if (value.status === 'copy-only' && typeof value.reason === 'string' && reasons.has(value.reason)) {
    return { status: 'copy-only', reason: value.reason as MacPostPasteFailureReason, ...(value.retryable === true ? { retryable: true } : {}) }
  }
  throw new Error('macOS Clipboard paste result 无效')
}

/** 解析原生 JSON 对象并附带操作名，便于定位错误上下文。 */
function parseObject(json: string, operation: string): Record<string, unknown> {
  const value: unknown = JSON.parse(json)
  if (!isRecord(value)) throw new Error(`macOS Clipboard ${operation} 返回值无效`)
  return value
}

/** 判断输入是否为非数组对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`macOS Clipboard ${field} 必须是字符串`)
  return value
}

function optionalString(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : requiredString(value, field)
}

function optionalProperty(value: unknown, field: string): Readonly<Record<string, string>> {
  const parsed = optionalString(value, field)
  return parsed === undefined ? {} : { [field]: parsed }
}

function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`macOS Clipboard ${field} 必须是安全整数`)
  return value
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = integer(value, field)
  if (parsed < 1) throw new Error(`macOS Clipboard ${field} 必须是正整数`)
  return parsed
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`macOS Clipboard ${field} 必须是有限数值`)
  return value
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`macOS Clipboard ${field} 必须是布尔值`)
  return value
}

function stringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error(`macOS Clipboard ${field} 必须是字符串数组`)
  return value
}
