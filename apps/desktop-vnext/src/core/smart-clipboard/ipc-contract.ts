import type { ActionMapping, ClipboardAction } from '@hermit/smart-clipboard/actions'
import type { ClipboardEntry, HistoryFilter } from '@hermit/smart-clipboard/domain'

/** Quick Panel/History IPC 使用的安全剪贴板投影；图片正文只以 previewUrl 暴露。 */
export type ClipboardWireEntry =
  | (Omit<Extract<ClipboardEntry, { kind: 'TEXT' }>, 'formatted'> & { readonly kind: 'TEXT'; readonly formatted?: { readonly html?: string; readonly rtf?: string } })
  | (Omit<Extract<ClipboardEntry, { kind: 'IMAGE' }>, 'bytes'> & { readonly kind: 'IMAGE'; readonly previewUrl: string })
  | Extract<ClipboardEntry, { kind: 'FILE_LIST' }>

/** Renderer 提交给 Core 的剪贴板操作请求；入口会对 unknown 重新解析。 */
export type SmartClipboardRequest =
  | { readonly op: 'list'; readonly filter?: HistoryFilter }
  | { readonly op: 'trash' }
  | { readonly op: 'settings' }
  | { readonly op: 'status' }
  | { readonly op: 'execute'; readonly id: string; readonly action: ClipboardAction; readonly source?: 'history' | 'quick-panel' }
  | { readonly op: 'set-pinned'; readonly id: string; readonly pinned: boolean }
  | { readonly op: 'move-to-trash'; readonly id: string }
  | { readonly op: 'restore'; readonly id: string }
  | { readonly op: 'permanently-delete'; readonly id: string }
  | { readonly op: 'clear-history' }
  | { readonly op: 'empty-trash' }
  | { readonly op: 'clear-all-data' }
  | { readonly op: 'ignore-next' }
  | { readonly op: 'set-paused'; readonly paused: boolean }
  | { readonly op: 'update-settings'; readonly historyLimit: number; readonly totalBytes: number; readonly retention: 'forever' | 30 | 90 | 365; readonly actionMapping: ActionMapping; readonly excludedApplications: readonly string[]; readonly excludedKinds: readonly ('TEXT' | 'IMAGE' | 'FILE_LIST')[] }
  | { readonly op: 'export'; readonly includeTrash: boolean }
  | { readonly op: 'set-quick-panel-layout'; readonly rows: number; readonly previewOpen: boolean }
  | { readonly op: 'open-history' }
  | { readonly op: 'close-quick-panel' }

/** 校验并收窄 Renderer IPC 请求，拒绝未声明的操作和参数。 */
export function parseRequest(value: unknown): SmartClipboardRequest {
  if (typeof value !== 'object' || value === null) throw new Error('Smart Clipboard 请求格式无效')
  const record = value as Record<string, unknown>
  if (typeof record.op !== 'string') throw new Error('Smart Clipboard 请求缺少 op')
  switch (record.op) {
    case 'list': return { op: 'list', ...(record.filter === undefined ? {} : { filter: parseFilter(record.filter) }) }
    case 'trash': return { op: 'trash' }
    case 'settings': return { op: 'settings' }
    case 'status': return { op: 'status' }
    case 'execute': return { op: 'execute', id: nonEmptyString(record.id, 'id'), action: parseAction(record.action), ...(record.source === undefined ? {} : { source: parseSource(record.source) }) }
    case 'set-pinned': return { op: 'set-pinned', id: nonEmptyString(record.id, 'id'), pinned: boolean(record.pinned, 'pinned') }
    case 'move-to-trash': return { op: 'move-to-trash', id: nonEmptyString(record.id, 'id') }
    case 'restore': return { op: 'restore', id: nonEmptyString(record.id, 'id') }
    case 'permanently-delete': return { op: 'permanently-delete', id: nonEmptyString(record.id, 'id') }
    case 'clear-history': return { op: 'clear-history' }
    case 'empty-trash': return { op: 'empty-trash' }
    case 'clear-all-data': return { op: 'clear-all-data' }
    case 'ignore-next': return { op: 'ignore-next' }
    case 'set-paused': return { op: 'set-paused', paused: boolean(record.paused, 'paused') }
    case 'update-settings': return {
      op: 'update-settings', historyLimit: positiveInteger(record.historyLimit, 'historyLimit'),
      totalBytes: positiveInteger(record.totalBytes, 'totalBytes'), retention: parseRetention(record.retention),
      actionMapping: parseActionMapping(record.actionMapping),
      excludedApplications: applicationExclusions(record.excludedApplications),
      excludedKinds: kindExclusions(record.excludedKinds),
    }
    case 'export': return { op: 'export', includeTrash: boolean(record.includeTrash, 'includeTrash') }
    case 'set-quick-panel-layout': return { op: 'set-quick-panel-layout', rows: boundedInteger(record.rows, 'rows', 1, 8), previewOpen: boolean(record.previewOpen, 'previewOpen') }
    case 'open-history': return { op: 'open-history' }
    case 'close-quick-panel': return { op: 'close-quick-panel' }
    default: throw new Error(`Smart Clipboard op 不支持：${record.op}`)
  }
}

/** 解析来源应用排除列表，并去重、限制长度。 */
function applicationExclusions(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.trim().length > 0 && item.length <= 256) || value.length > 256) {
    throw new Error('排除应用格式无效')
  }
  return [...new Set(value.map((item) => item.trim()))]
}

/** 解析内容类型排除列表，并保持唯一值。 */
function kindExclusions(value: unknown): readonly ('TEXT' | 'IMAGE' | 'FILE_LIST')[] {
  if (!Array.isArray(value)) throw new Error('排除类型格式无效')
  return [...new Set(value.map(parseKind))]
}

/** 解析历史筛选条件。 */
function parseFilter(value: unknown): HistoryFilter {
  if (typeof value !== 'object' || value === null) throw new Error('History filter 格式无效')
  const filter = value as Record<string, unknown>
  return {
    ...(filter.query === undefined ? {} : { query: stringValue(filter.query, 'query') }),
    ...(filter.kind === undefined ? {} : { kind: parseKind(filter.kind) }),
    ...(filter.sourceApplication === undefined ? {} : { sourceApplication: nonEmptyString(filter.sourceApplication, 'sourceApplication') }),
    ...(filter.pinnedOnly === undefined ? {} : { pinnedOnly: boolean(filter.pinnedOnly, 'pinnedOnly') }),
  }
}

/** 解析剪贴板内容类型。 */
function parseKind(value: unknown): 'TEXT' | 'IMAGE' | 'FILE_LIST' {
  if (value === 'TEXT' || value === 'IMAGE' || value === 'FILE_LIST') return value
  throw new Error('History 类型无效')
}

/** 解析快捷操作类型。 */
function parseAction(value: unknown): ClipboardAction {
  if (value === 'use' || value === 'copy' || value === 'plain-text') return value
  throw new Error('Clipboard action 无效')
}

/** 解析三个快捷键到动作的映射。 */
function parseActionMapping(value: unknown): ActionMapping {
  if (typeof value !== 'object' || value === null) throw new Error('动作映射格式无效')
  const mapping = value as Record<string, unknown>
  return { Enter: parseAction(mapping.Enter), 'Mod+Enter': parseAction(mapping['Mod+Enter']), 'Shift+Enter': parseAction(mapping['Shift+Enter']) }
}

/** 解析历史保留期限。 */
function parseRetention(value: unknown): 'forever' | 30 | 90 | 365 {
  if (value === 'forever' || value === 30 || value === 90 || value === 365) return value
  throw new Error('保留期限无效')
}

/** 解析动作来源入口。 */
function parseSource(value: unknown): 'history' | 'quick-panel' {
  if (value === 'history' || value === 'quick-panel') return value
  throw new Error('Clipboard action source 无效')
}

/** 收窄为非空字符串，供 IPC 字段复用。 */
function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} 必须是非空字符串`)
  return value
}

/** 收窄为字符串。 */
function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} 必须是字符串`)
  return value
}

/** 收窄为布尔值。 */
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} 必须是布尔值`)
  return value
}

/** 收窄为正安全整数。 */
function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error(`${label} 必须是正整数`)
  return value
}

/** 收窄为指定范围内的安全整数。 */
function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} 必须是 ${String(minimum)} 到 ${String(maximum)} 之间的整数`)
  }
  return value
}
