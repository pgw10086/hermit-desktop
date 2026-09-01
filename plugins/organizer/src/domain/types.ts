import type {
  ChecklistEntry,
  EventTimeDraft,
  ItemKind,
  OrganizerItem,
  ReminderRuleDraft,
  TemporalPoint,
  TodoPriority,
} from '../client/contracts.js'

/** Canonical 事项状态；回收站通过 deletedAt 另行表达。 */
export type OrganizerStatus = 'active' | 'planned' | 'completed' | 'cancelled' | 'scheduled' | 'archived'

/** Canonical 事项记录；展示标签、时间文案和投影均从这里重新计算。 */
export interface OrganizerRecord {
  /** 事项稳定身份。 */
  readonly id: string
  /** Canonical 事项类型。 */
  readonly kind: ItemKind
  /** 标题。 */
  readonly title: string
  /** 详细内容。 */
  readonly detail: string
  /** 用户标签。 */
  readonly tags: readonly string[]
  /** 当前 Canonical 状态。 */
  readonly status: OrganizerStatus
  /** 单调递增 revision，用于拒绝旧编辑覆盖新状态。 */
  readonly revision: number
  /** 创建时间。 */
  readonly createdAt: string
  /** 最近更新时间。 */
  readonly updatedAt: string
  /** 创建来源展示名。 */
  readonly sourceLabel: string
  /** 用户原始输入，不用于业务状态判断。 */
  readonly originalInput: string
  /** 事项类型转换历史。 */
  readonly typeHistory: readonly string[]
  /** 待办完成状态。 */
  readonly completed?: boolean
  /** 回收站时间；存在时从活动投影中排除。 */
  readonly deletedAt?: string
  /** 是否固定。 */
  readonly pinned?: boolean
  /** 待办优先级。 */
  readonly priority?: TodoPriority
  /** 待办清单。 */
  readonly checklist?: readonly ChecklistEntry[]
  /** 待办开始时间。 */
  readonly todoStart?: TemporalPoint
  /** 待办截止时间。 */
  readonly todoDue?: TemporalPoint
  /** 日程时间。 */
  readonly eventTime?: EventTimeDraft
  /** 日程地点。 */
  readonly location?: string
  /** 提醒规则列表。 */
  readonly reminders: readonly ReminderRuleDraft[]
  /** 创建该事项的幂等调用身份。 */
  readonly createdByCallId?: string
}

export interface OrganizerToolCall {
  /** Tool 调用的幂等身份。 */
  readonly callId: string
  /** Tool 创建或更新的事项身份。 */
  readonly itemId: string
  /** 调用完成时对应的 revision。 */
  readonly revision: number
  /** 调用创建时间。 */
  readonly createdAt: string
}

/** 将 Canonical 记录转换为 UI 可消费的派生投影，不改变 Canonical 状态。 */
export function toOrganizerItem(record: OrganizerRecord): OrganizerItem {
  const base: OrganizerItem = {
    id: record.id,
    kind: record.kind,
    kindLabel: kindLabel(record.kind),
    title: record.title,
    detail: record.detail,
    status: record.status,
    statusLabel: statusLabel(record.status),
    timeLabel: timeLabel(record),
    ...(record.reminders.length === 0 ? {} : { reminderLabel: reminderLabel(record.reminders[0]) }),
    tags: [...record.tags],
    reminders: [...record.reminders],
    revision: record.revision,
    sourceLabel: record.sourceLabel,
    originalInput: record.originalInput,
    typeHistory: [...record.typeHistory],
    ...(record.completed === undefined ? {} : { completed: record.completed }),
    ...(record.deletedAt === undefined ? {} : { deletedAt: record.deletedAt }),
    ...(record.pinned === undefined ? {} : { pinned: record.pinned }),
    ...(record.priority === undefined ? {} : { priority: record.priority }),
    ...(record.checklist === undefined ? {} : { checklist: [...record.checklist] }),
    ...(record.todoStart === undefined ? {} : { todoStart: { ...record.todoStart } }),
    ...(record.todoDue === undefined ? {} : { todoDue: { ...record.todoDue } }),
    ...(record.eventTime === undefined ? {} : { eventTime: { ...record.eventTime } }),
    ...(record.location === undefined ? {} : { location: record.location }),
  }
  return base
}

/** 将事项类型转换为面向用户的中文标签。 */
function kindLabel(kind: ItemKind): string { return kind === 'note' ? '便签' : kind === 'todo' ? '待办' : '日程' }

/** 将 Canonical 状态转换为面向用户的中文标签。 */
function statusLabel(status: OrganizerStatus): string {
  switch (status) {
    case 'active': return '记录中'
    case 'planned': return '计划中'
    case 'completed': return '已完成'
    case 'cancelled': return '已取消'
    case 'scheduled': return '已安排'
    case 'archived': return '已归档'
  }
}

/** 按事项类型计算时间展示文本；该文本是派生值，不参与状态判断。 */
function timeLabel(record: OrganizerRecord): string {
  if (record.kind === 'note') return '最近更新'
  if (record.kind === 'todo') {
    const parts = [pointLabel('开始', record.todoStart), pointLabel('截止', record.todoDue)].filter(Boolean)
    return parts.length === 0 ? '无日期' : parts.join(' · ')
  }
  const time = record.eventTime
  if (time === undefined) return '时间未设置'
  if (time.mode === 'date-only') return `${time.startDate} · 时间未指定`
  if (time.mode === 'all-day') return `${time.startDate}${time.endDate && time.endDate !== time.startDate ? ` - ${time.endDate}` : ''} · 全天`
  const start = `${time.startDate} ${time.startTime}`.trim()
  return !time.hasEnd ? start : `${start} - ${`${time.endDate} ${time.endTime}`.trim()}`
}

/** 格式化待办的日期/时间点。 */
function pointLabel(label: string, point: TemporalPoint | undefined): string {
  if (point === undefined || point.date.length === 0) return ''
  return `${label}：${point.date}${point.time.length === 0 ? '' : ` ${point.time}`}`
}

/** 格式化第一条提醒规则，供列表摘要展示。 */
function reminderLabel(rule: ReminderRuleDraft | undefined): string {
  if (rule === undefined) return ''
  if (rule.mode === 'absolute') return `${rule.date} ${rule.time}`.trim()
  const anchor = rule.anchor === 'todo-start' ? '待办开始' : rule.anchor === 'todo-due' ? '待办截止' : '日程开始'
  const unit = rule.unit === 'minute' ? '分钟' : rule.unit === 'hour' ? '小时' : '天'
  return `${anchor}前 ${String(rule.amount)} ${unit}`
}
