/** 事项的 Canonical 类型；类型转换会记录在 typeHistory。 */
export type ItemKind = 'note' | 'todo' | 'event'
/** 常规工作视图，不包含搜索、提醒和回收站等独立入口。 */
export type NormalView = 'default' | 'items' | 'today' | 'calendar'
/** Organizer 支持的全部视图身份。 */
export type OrganizerView = NormalView | 'search' | 'reminders' | 'trash' | 'data'
/** 投影数据当前是否可直接展示。 */
export type ProjectionState = 'loading' | 'partial' | 'empty' | 'ready' | 'unavailable'
/** 待办优先级；none 表示用户没有设置优先级。 */
export type TodoPriority = 'none' | 'low' | 'medium' | 'high'
/** 日程时间的精度模式。 */
export type EventTimeMode = 'date-only' | 'all-day' | 'timed'
/** 允许的事项生命周期动作。 */
export type ItemLifecycleAction = 'pin' | 'unpin' | 'archive' | 'activate' | 'cancel' | 'trash'

export interface TemporalPoint {
  /** 日期部分，使用产品约定的日期格式。 */
  readonly date: string
  /** 时间部分；为空表示没有指定具体时间。 */
  readonly time: string
}
export interface ChecklistEntry {
  /** 清单项稳定身份。 */
  readonly id: string
  /** 清单项展示文本。 */
  readonly text: string
  /** 是否已经完成。 */
  readonly completed: boolean
}

export interface ReminderRuleDraft {
  /** 提醒规则稳定身份。 */
  readonly id: string
  /** 绝对时间或相对锚点模式。 */
  readonly mode: 'absolute' | 'relative'
  /** 相对提醒所依附的事项时间点；绝对模式为空字符串。 */
  readonly anchor: '' | 'todo-start' | 'todo-due' | 'event-start'
  /** 绝对提醒或相对计算使用的日期。 */
  readonly date: string
  /** 提醒时间。 */
  readonly time: string
  /** 相对锚点前后关系。 */
  readonly relation: 'before' | 'after'
  /** 相对提醒的数量。 */
  readonly amount: number
  /** 相对提醒数量的单位。 */
  readonly unit: 'minute' | 'hour' | 'day'
  /** 用户原始表达，供详情和问题定位使用。 */
  readonly sourceText?: string
  /** 创建时采用的 IANA 时区；旧数据缺失时保持兼容。 */
  readonly timeZone?: string
  /** 相对日期解析所依据的用户消息时间。 */
  readonly referenceAt?: number
}

export interface EventTimeDraft {
  /** 日程时间精度模式。 */
  readonly mode: EventTimeMode
  /** 开始日期。 */
  readonly startDate: string
  /** timed 模式下的开始时间。 */
  readonly startTime: string
  /** 可选结束日期。 */
  readonly endDate: string
  /** timed 模式下的结束时间。 */
  readonly endTime: string
  /** 是否存在有效结束时间。 */
  readonly hasEnd: boolean
}

export interface OrganizerItem {
  /** 事项稳定身份。 */
  readonly id: string
  /** 事项 Canonical 类型。 */
  readonly kind: ItemKind
  /** 面向用户的类型标签。 */
  readonly kindLabel: string
  /** 事项标题。 */
  readonly title: string
  /** 事项详细内容。 */
  readonly detail: string
  /** 当前状态，具体状态机由 domain service 决定。 */
  readonly status: string
  /** 当前状态的展示标签。 */
  readonly statusLabel: string
  /** 根据类型和时间字段计算出的展示时间。 */
  readonly timeLabel?: string
  /** 第一条提醒规则的展示文本。 */
  readonly reminderLabel?: string
  /** 用户标签列表。 */
  readonly tags: readonly string[]
  /** 事项的提醒规则。 */
  readonly reminders: readonly ReminderRuleDraft[]
  /** Canonical revision，命令写入时必须回传期望版本。 */
  readonly revision: number
  /** 创建来源的展示名称。 */
  readonly sourceLabel: string
  /** 用户最初输入的原文，供追溯而非状态判断。 */
  readonly originalInput: string
  /** 事项类型转换历史。 */
  readonly typeHistory: readonly string[]
  /** 待办是否完成。 */
  readonly completed?: boolean
  /** 进入回收站的时间；存在时不再出现在活动列表。 */
  readonly deletedAt?: string
  /** 是否固定在列表前部。 */
  readonly pinned?: boolean
  /** 待办优先级。 */
  readonly priority?: TodoPriority
  /** 待办清单。 */
  readonly checklist?: readonly ChecklistEntry[]
  /** 待办开始时间。 */
  readonly todoStart?: TemporalPoint
  /** 待办截止时间。 */
  readonly todoDue?: TemporalPoint
  /** 日程时间描述。 */
  readonly eventTime?: EventTimeDraft
  /** 日程地点。 */
  readonly location?: string
}

export interface Projection<T> {
  /** 投影当前状态。 */
  readonly state: ProjectionState
  /** 当前可展示的数据；partial 也可能只包含部分结果。 */
  readonly items: readonly T[]
  /** 不可用或部分成功时供界面展示的说明。 */
  readonly message?: string
}

export interface TodaySnapshot {
  /** 已过期的事项投影。 */
  readonly overdue: Projection<OrganizerItem>
  /** 今日待办投影。 */
  readonly todos: Projection<OrganizerItem>
  /** 今日事件投影。 */
  readonly events: Projection<OrganizerItem>
  /** 今日提醒投影。 */
  readonly reminders: Projection<ReminderRow>
}

export interface ReminderRow {
  /** 提醒记录稳定身份。 */
  readonly id: string
  /** 所属事项身份。 */
  readonly itemId: string
  /** 事项标题。 */
  readonly title: string
  /** 提醒时间展示文本。 */
  readonly timeLabel: string
  /** 提醒当前状态展示文本。 */
  readonly stateLabel: string
  /** 提醒关联的事项详情。 */
  readonly detail: string
}

export interface CalendarDay {
  /** 日历日期稳定身份。 */
  readonly id: string
  /** 星期展示文本。 */
  readonly weekday: string
  /** 日期展示文本。 */
  readonly date: string
  /** 是否为当前日期。 */
  readonly isToday?: boolean
  /** 该日期关联的事项。 */
  readonly items: readonly OrganizerItem[]
}

export interface OrganizerNotice {
  /** 提示的严重程度。 */
  readonly tone: 'info' | 'warning' | 'error'
  /** 提示标题。 */
  readonly title: string
  /** 提示详细内容。 */
  readonly detail: string
}

export interface OrganizerSnapshot {
  /** 业务服务是否可用。 */
  readonly availability: 'ready' | 'unavailable'
  /** 服务不可用时的明确原因。 */
  readonly unavailableMessage?: string
  /** 需要在工作面持续展示的提示。 */
  readonly notice?: OrganizerNotice
  readonly defaultView: {
    readonly events: Projection<OrganizerItem>
    readonly todos: Projection<OrganizerItem>
    readonly notes: Projection<OrganizerItem>
  }
  readonly items: Projection<OrganizerItem>
  readonly today: TodaySnapshot
  readonly calendar: {
    readonly state: ProjectionState
    readonly rangeLabel: string
    readonly days: readonly CalendarDay[]
    readonly list: readonly OrganizerItem[]
    readonly message?: string
  }
  readonly reminders: {
    readonly notice?: OrganizerNotice
    readonly due: Projection<ReminderRow>
    readonly upcoming: Projection<ReminderRow>
    readonly history: Projection<ReminderRow>
  }
  readonly trash: Projection<OrganizerItem>
  readonly search: Projection<OrganizerItem>
}

export interface ItemDraft {
  /** 编辑中的事项身份；为空表示创建新事项。 */
  readonly id?: string
  /** 编辑中的类型；空字符串表示尚未选择。 */
  readonly kind: ItemKind | ''
  /** 标题。 */
  readonly title: string
  /** 详细内容。 */
  readonly detail: string
  /** 标签。 */
  readonly tags: readonly string[]
  /** 是否固定。 */
  readonly pinned: boolean
  /** 待办优先级。 */
  readonly priority: TodoPriority
  /** 待办清单。 */
  readonly checklist: readonly ChecklistEntry[]
  /** 待办开始时间。 */
  readonly todoStart: TemporalPoint
  /** 待办截止时间。 */
  readonly todoDue: TemporalPoint
  /** 日程时间。 */
  readonly eventTime: EventTimeDraft
  /** 日程地点。 */
  readonly location: string
  /** 提醒规则。 */
  readonly reminders: readonly ReminderRuleDraft[]
  /** 编辑开始时读取的 revision，用于拒绝覆盖他人的更新。 */
  readonly revision?: number
}

export interface ItemsQuery {
  /** 查询类型标识。 */
  readonly type: 'items'
  /** 按事项类型筛选。 */
  readonly kinds: readonly ItemKind[]
  /** 按状态筛选。 */
  readonly statuses: readonly string[]
  /** 按标签筛选。 */
  readonly tags: readonly string[]
  /** 列表排序方式。 */
  readonly sort: 'default' | 'updated'
}

/** 修改 Organizer Canonical 状态的命令；所有写命令都带 revision。 */
export type OrganizerCommand =
  | { readonly type: 'save'; readonly draft: ItemDraft }
  | { readonly type: 'complete'; readonly itemId: string; readonly revision: number }
  | { readonly type: 'lifecycle'; readonly itemId: string; readonly revision: number; readonly action: ItemLifecycleAction }
  | { readonly type: 'restore'; readonly itemId: string; readonly revision: number }
  | { readonly type: 'purge'; readonly itemId: string; readonly revision: number }

/** 读取 Organizer 投影的查询。 */
export type OrganizerQuery =
  | ItemsQuery
  | { readonly type: 'search'; readonly query: string }
  | { readonly type: 'trash'; readonly query: string }

/** 命令执行结果；预期失败不会通过异常隐式吞掉。 */
export type OrganizerCommandResult =
  | { readonly outcome: 'success'; readonly item?: OrganizerItem; readonly message: string }
  | { readonly outcome: 'conflict'; readonly latest: OrganizerItem; readonly message: string }
  | { readonly outcome: 'denied' | 'invalid' | 'unknown'; readonly message: string }

/**
 * UI 只读取已投影的 snapshot 并提交明确命令。Today 归属、Reminder 计算、
 * 搜索排名和 Canonical 状态机均由真实 adapter 后方的业务负责人处理。
 */
export interface OrganizerClientPort {
  /** 获取当前已投影的快照。 */
  getSnapshot(): OrganizerSnapshot
  /** 按稳定身份读取一个事项。 */
  getItem(itemId: string): OrganizerItem | undefined
  /** 订阅快照更新，并返回取消订阅函数。 */
  subscribe(listener: () => void): () => void
  /** 请求刷新指定查询的投影。 */
  request(query: OrganizerQuery): void
  /** 执行一条带版本约束的业务命令。 */
  execute(command: OrganizerCommand): Promise<OrganizerCommandResult>
  /** 可选的显式刷新能力。 */
  readonly refresh?: () => Promise<void>
}

export interface OrganizerInitialIntent {
  /** 初始打开的视图。 */
  readonly view?: OrganizerView
  /** 初始打开的抽屉状态。 */
  readonly drawer?:
    | { readonly mode: 'view' | 'edit'; readonly itemId: string }
    | { readonly mode: 'create'; readonly kind?: ItemKind }
}
