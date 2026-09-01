import type { HistoryFilter, Retention } from '../full-history.js'
import type { ClipboardOperationResult, ClipboardWireEntry } from './api.js'

/** 将历史记录转换为列表摘要，避免在多个页面重复拼接文案。 */
export function entrySummary(entry: ClipboardWireEntry): string {
  if (entry.kind === 'TEXT') return entry.text.replace(/\s+/gu, ' ').trim().slice(0, 100)
  if (entry.kind === 'IMAGE') return `图片 · ${entry.width} × ${entry.height}`
  return `${entry.items[0]?.displayName ?? '文件列表'}${entry.items.length > 1 ? ` +${String(entry.items.length - 1)}` : ''}`
}

/** 将执行结果转换为持久的用户反馈文案。 */
export function operationMessage(result: ClipboardOperationResult): string {
  if (result.status === 'copied') return '已复制到系统剪贴板'
  if (result.status === 'pasted') return '已复制并尝试粘贴'
  if (result.status === 'copy-only') return `已复制，请手工粘贴：${result.reason}`
  return `操作不可用：${result.reason}`
}

/** 在 Client 侧对安全投影执行筛选，不改变 Host 的 Canonical 数据。 */
export function filterEntries(entries: readonly ClipboardWireEntry[], filter: HistoryFilter): readonly ClipboardWireEntry[] {
  const query = filter.query?.trim().toLocaleLowerCase() ?? ''
  return entries
    .filter((entry) => filter.kind === undefined || entry.kind === filter.kind)
    .filter((entry) => !filter.pinnedOnly || entry.pinned)
    .filter((entry) => filter.sourceApplication === undefined || entry.sourceApplication === filter.sourceApplication)
    .filter((entry) => {
      if (query.length === 0) return true
      if (entry.kind === 'TEXT') return entry.text.toLocaleLowerCase().includes(query)
      if (entry.kind === 'FILE_LIST') {
        return entry.items.some((item) => (
          item.displayName.toLocaleLowerCase().includes(query)
          || item.path.toLocaleLowerCase().includes(query)
        ))
      }
      return false
    })
}

/** 将字节数转换为紧凑的本地化容量文本。 */
export function formatBytes(value: number): string {
  if (value < 1024) return `${String(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** 将 Unix 毫秒时间戳转换为列表时间文本。 */
export function formatTime(value: number): string {
  return new Date(value).toLocaleString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    month: 'numeric',
    day: 'numeric',
  })
}

/** 将未知异常收窄为可展示消息。 */
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** 解析设置表单中的保留期限值，拒绝未声明的数字。 */
export function parseRetentionInput(value: string): Retention {
  if (value === 'forever') return value
  const days = Number(value)
  if (days === 30 || days === 90 || days === 365) return days
  throw new Error('保留期限无效')
}
