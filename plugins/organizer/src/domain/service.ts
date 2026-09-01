import type { Context } from '@deepseek-ai/cordis'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type {
  CalendarDay,
  ItemDraft,
  ItemKind,
  ItemLifecycleAction,
  ItemsQuery,
  OrganizerCommand,
  OrganizerCommandResult,
  OrganizerItem,
  OrganizerQuery,
  OrganizerSnapshot,
  Projection,
  ReminderRow,
} from '../client/contracts.js'
import { ORGANIZER_DOMAIN } from './spec.js'
import type { OrganizerRecord, OrganizerStatus } from './types.js'
import { toOrganizerItem } from './types.js'

const createTodoSchema = z.object({
  title: z.string().trim().min(1).max(500),
  detail: z.string().max(20_000).optional(),
  originalInput: z.string().max(20_000).optional(),
  checklist: z.array(z.object({ text: z.string().trim().min(1).max(500) })).max(100).optional(),
})

const createNoteSchema = z.object({
  title: z.string().trim().min(1).max(500),
  detail: z.string().max(20_000).optional(),
  originalInput: z.string().max(20_000).optional(),
})

export interface CreateTodoInput {
  /** 待办标题，写入前会去除首尾空白并校验长度。 */
  readonly title: string
  /** 待办详细内容。 */
  readonly detail?: string
  /** 用户原始输入，用于保留来源上下文。 */
  readonly originalInput?: string
  /** 创建时附带的清单文本。 */
  readonly checklist?: readonly { readonly text: string }[]
}

export interface CreateNoteInput {
  /** 便签标题，写入前会去除首尾空白并校验长度。 */
  readonly title: string
  /** 便签详细内容。 */
  readonly detail?: string
  /** 用户原始输入，用于保留来源上下文。 */
  readonly originalInput?: string
}

/** Organizer Canonical 数据的唯一写入服务，统一处理 revision、幂等和状态转换。 */
export class OrganizerService {
  private constructor(private readonly domain: Domain<typeof ORGANIZER_DOMAIN>) {}

  /** 打开 Organizer 存储域；调用方负责在插件停用时关闭服务。 */
  static async open(ctx: Context): Promise<OrganizerService> {
    return new OrganizerService(await ctx.storage.domain.open(ORGANIZER_DOMAIN))
  }

  /** 关闭存储域并释放其资源。 */
  async close(): Promise<void> { await this.domain.close() }

  /** 校验并创建一条待办；相同 callId 的重复调用返回原记录。 */
  async createTodo(input: CreateTodoInput, callId: string): Promise<OrganizerRecord> {
    const parsed = createTodoSchema.safeParse(input)
    if (!parsed.success) throw new Error('待办内容无效：标题不能为空且长度不能超过 500 个字符')
    return this.createRecord({
      kind: 'todo', title: parsed.data.title,
      ...(parsed.data.detail === undefined ? {} : { detail: parsed.data.detail }),
      ...(parsed.data.originalInput === undefined ? {} : { originalInput: parsed.data.originalInput }),
      ...(parsed.data.checklist === undefined ? {} : { checklist: parsed.data.checklist }),
    }, callId)
  }

  /** 校验并创建一条便签；相同 callId 的重复调用返回原记录。 */
  async createNote(input: CreateNoteInput, callId: string): Promise<OrganizerRecord> {
    const parsed = createNoteSchema.safeParse(input)
    if (!parsed.success) throw new Error('便签内容无效：标题不能为空且长度不能超过 500 个字符')
    return this.createRecord({
      kind: 'note', title: parsed.data.title,
      ...(parsed.data.detail === undefined ? {} : { detail: parsed.data.detail }),
      ...(parsed.data.originalInput === undefined ? {} : { originalInput: parsed.data.originalInput }),
    }, callId)
  }

  /** 根据查询生成统一快照，活动、搜索和回收站投影互不共享可变数组。 */
  async snapshot(query?: OrganizerQuery): Promise<OrganizerSnapshot> {
    const records = this.records()
    const active = records.filter((item) => item.deletedAt === undefined)
    const filtered = query?.type === 'items' ? filterItems(active, query) : active
    const search = query?.type === 'search' ? searchItems(active, query.query) : []
    const trash = query?.type === 'trash' ? records.filter((item) => item.deletedAt !== undefined && matches(item, query.query)) : records.filter((item) => item.deletedAt !== undefined)
    return buildSnapshot(active.map(toOrganizerItem), filtered.map(toOrganizerItem), search.map(toOrganizerItem), trash.map(toOrganizerItem))
  }

  /** 执行带 revision 约束的命令，并将预期失败转换为明确结果。 */
  async execute(command: OrganizerCommand): Promise<OrganizerCommandResult> {
    switch (command.type) {
      case 'save': return this.save(command.draft)
      case 'complete': return this.complete(command.itemId, command.revision)
      case 'lifecycle': return this.lifecycle(command.itemId, command.revision, command.action)
      case 'restore': return this.restore(command.itemId, command.revision)
      case 'purge': return this.purge(command.itemId, command.revision)
    }
  }

  /** 保存新建或编辑中的事项，并处理类型转换和并发冲突。 */
  private async save(draft: ItemDraft): Promise<OrganizerCommandResult> {
    if (draft.kind === '' || draft.title.trim().length === 0) return { outcome: 'invalid', message: '请先选择事项类型并填写标题' }
    if (draft.kind === 'event' && (draft.eventTime.startDate.length === 0 || (draft.eventTime.mode === 'timed' && draft.eventTime.startTime.length === 0))) return { outcome: 'invalid', message: '日程需要填写开始日期；具体时间模式还需要开始时间' }
    return this.write(async () => {
      const current = draft.id === undefined ? undefined : this.domain.table('items').get(draft.id)
      if (draft.id !== undefined && current === undefined) return { outcome: 'unknown', message: '事项不存在或已被永久删除' }
      if (current !== undefined && draft.revision !== undefined && current.revision !== draft.revision) return { outcome: 'conflict', latest: toOrganizerItem(current), message: '这项内容在你编辑期间已经变化，本次没有保存。' }
      const timestamp = now()
      const kind = draft.kind as ItemKind
      const converted = current !== undefined && current.kind !== kind
      if (converted && current?.kind !== 'note') return { outcome: 'invalid', message: '待办和日程之间暂不支持直接转换' }
      if (converted && (current?.status !== 'active' || current.deletedAt !== undefined)) return { outcome: 'invalid', message: '只有记录中的便签可以转换，请先恢复便签后再操作' }
      const status: OrganizerStatus = current === undefined || converted ? kind === 'note' ? 'active' : kind === 'todo' ? 'planned' : 'scheduled' : current.status
      const item = recordFromDraft(draft, current, timestamp, status, converted)
      await this.domain.table('items').put(item.id, item)
      return { outcome: 'success', item: toOrganizerItem(item), message: draft.id === undefined ? '事项已创建' : '事项已保存' }
    })
  }

  /** 将计划中的待办标记为完成，完成后 revision 递增。 */
  private async complete(itemId: string, revision: number): Promise<OrganizerCommandResult> {
    return this.write(async () => this.updateItem(itemId, revision, (current) => {
      if (current.kind !== 'todo' || current.status !== 'planned') throw new Error('只有计划中的待办可以完成')
      return { ...current, completed: true, status: 'completed', revision: current.revision + 1, updatedAt: now() }
    }, '待办已完成'))
  }

  /** 执行便签置顶、归档、取消或移入回收站等生命周期动作。 */
  private async lifecycle(itemId: string, revision: number, action: ItemLifecycleAction): Promise<OrganizerCommandResult> {
    return this.write(async () => this.updateItem(itemId, revision, (current) => {
      if (current.deletedAt !== undefined) throw new Error('回收站中的事项只能恢复或永久删除')
      if ((action === 'archive' || action === 'activate' || action === 'pin' || action === 'unpin') && current.kind !== 'note') throw new Error('只有便签支持此操作')
      if (action === 'cancel' && current.kind === 'note') throw new Error('便签不能取消')
      if (action === 'archive' && current.status !== 'active') throw new Error('只有记录中的便签可以归档')
      if (action === 'activate' && current.status !== 'archived') throw new Error('只有已归档的便签可以恢复使用')
      if (action === 'pin' && current.pinned === true) throw new Error('便签已经置顶')
      if (action === 'unpin' && current.pinned !== true) throw new Error('便签当前没有置顶')
      if (action === 'cancel' && current.status !== 'planned' && current.status !== 'scheduled') throw new Error('当前状态不能取消')
      if (action === 'archive') return { ...current, status: 'archived', revision: current.revision + 1, updatedAt: now() }
      if (action === 'activate') return { ...current, status: 'active', revision: current.revision + 1, updatedAt: now() }
      if (action === 'pin' || action === 'unpin') return { ...current, pinned: action === 'pin', revision: current.revision + 1, updatedAt: now() }
      if (action === 'cancel') return { ...current, status: 'cancelled', revision: current.revision + 1, updatedAt: now() }
      return { ...current, deletedAt: now(), revision: current.revision + 1, updatedAt: now() }
    }, action === 'trash' ? '事项已移到回收站' : action === 'cancel' ? '事项已取消' : '事项已更新'))
  }

  /** 从回收站恢复事项，并保留恢复前的 Canonical 状态。 */
  private async restore(itemId: string, revision: number): Promise<OrganizerCommandResult> {
    return this.write(async () => this.updateItem(itemId, revision, (current) => {
      if (current.deletedAt === undefined) throw new Error('事项当前不在回收站')
      const { deletedAt: _deletedAt, ...restored } = current
      return { ...restored, revision: current.revision + 1, updatedAt: now() }
    }, '事项已恢复，保留原状态'))
  }

  /** 永久删除回收站中的事项；活动事项不能直接走此路径。 */
  private async purge(itemId: string, revision: number): Promise<OrganizerCommandResult> {
    return this.write(async () => {
      const current = this.domain.table('items').get(itemId)
      if (current === undefined) return { outcome: 'unknown', message: '事项不存在或已被永久删除' }
      if (current.revision !== revision) return { outcome: 'conflict', latest: toOrganizerItem(current), message: '事项已经变化，本次没有永久删除。' }
      if (current.deletedAt === undefined) return { outcome: 'invalid', message: '只能永久删除回收站中的事项' }
      await this.domain.table('items').delete(itemId)
      return { outcome: 'success', message: '事项已永久删除' }
    })
  }

  /** 读取并校验 revision 后应用状态转换，将业务失败转成 typed result。 */
  private async updateItem(itemId: string, revision: number, transform: (current: OrganizerRecord) => OrganizerRecord, successMessage: string): Promise<OrganizerCommandResult> {
    const current = this.domain.table('items').get(itemId)
    if (current === undefined) return { outcome: 'unknown', message: '事项不存在或已被永久删除' }
    if (current.revision !== revision) return { outcome: 'conflict', latest: toOrganizerItem(current), message: '事项已经变化，本次没有保存。' }
    try {
      const next = transform(current)
      await this.domain.table('items').put(itemId, next)
      return { outcome: 'success', item: toOrganizerItem(next), message: successMessage }
    } catch (error) {
      return { outcome: 'invalid', message: error instanceof Error ? error.message : '事项操作无效' }
    }
  }

  /** 读取当前域中的全部 Canonical 事项记录。 */
  private records(): OrganizerRecord[] { return [...this.domain.table('items').entries()].map(([, item]) => item) }

  /** 创建事项并写入幂等调用记录，避免 Tool 重放产生重复事项。 */
  private async createRecord(input: {
    readonly kind: 'note' | 'todo'
    readonly title: string
    readonly detail?: string
    readonly originalInput?: string
    readonly checklist?: readonly { readonly text: string }[]
  }, callId: string): Promise<OrganizerRecord> {
    return this.write(async () => {
      const existingCall = this.domain.table('tool_calls').get(callId)
      if (existingCall !== undefined) {
        const existingItem = this.domain.table('items').get(existingCall.itemId)
        if (existingItem !== undefined) return existingItem
      }
      const existingItem = this.records().find((item) => item.createdByCallId === callId)
      if (existingItem !== undefined) {
        await this.domain.table('tool_calls').put(callId, { callId, itemId: existingItem.id, revision: existingItem.revision, createdAt: existingItem.createdAt })
        return existingItem
      }
      const timestamp = now()
      const base = {
        id: crypto.randomUUID(), kind: input.kind, title: input.title, detail: input.detail ?? '', tags: [],
        revision: 1, createdAt: timestamp, updatedAt: timestamp,
        sourceLabel: 'DSH 对话', originalInput: input.originalInput ?? input.title,
        reminders: [], createdByCallId: callId,
      } satisfies Omit<OrganizerRecord, 'status' | 'typeHistory'>
      const item: OrganizerRecord = input.kind === 'note'
        ? { ...base, kind: 'note', status: 'active', typeHistory: ['首次创建为便签'], pinned: false }
        : {
          ...base, kind: 'todo', status: 'planned', typeHistory: ['首次创建为待办'], completed: false, priority: 'none',
          ...(input.checklist === undefined ? {} : { checklist: input.checklist.map((entry, index) => ({ id: `check-${String(index + 1)}`, text: entry.text, completed: false })) }),
        }
      await this.domain.table('items').put(item.id, item)
      await this.domain.table('tool_calls').put(callId, { callId, itemId: item.id, revision: item.revision, createdAt: timestamp })
      return item
    })
  }

  private writeChain: Promise<void> = Promise.resolve()
  /** 让所有写操作按提交顺序执行，同时保持失败后队列可继续使用。 */
  private async write<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeChain.then(operation, operation)
    this.writeChain = result.then(() => undefined, () => undefined)
    return result
  }
}

/** 将编辑草稿转换为 Canonical 记录，并保留既有身份与类型历史。 */
function recordFromDraft(draft: ItemDraft, current: OrganizerRecord | undefined, timestamp: string, status: OrganizerStatus, converted: boolean): OrganizerRecord {
  const kind = draft.kind as ItemKind
  const conversionHistory = converted && current !== undefined
    ? `${current.kind === 'note' ? '便签' : '事项'}转换为${kind === 'todo' ? '待办' : '日程'}${current.pinned === true ? '（原便签置顶不保留）' : ''}`
    : undefined
  const base: OrganizerRecord = {
    id: current?.id ?? crypto.randomUUID(), kind, title: draft.title.trim(), detail: draft.detail, tags: [...draft.tags], status,
    revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp,
    sourceLabel: current?.sourceLabel ?? '手工创建', originalInput: current?.originalInput ?? draft.title.trim(),
    typeHistory: current === undefined ? ['首次保存'] : conversionHistory !== undefined ? [...current.typeHistory, conversionHistory] : [...current.typeHistory],
    reminders: [...draft.reminders], ...(current?.createdByCallId === undefined ? {} : { createdByCallId: current.createdByCallId }),
  }
  if (kind === 'note') return { ...base, pinned: draft.pinned }
  if (kind === 'todo') return { ...base, completed: status === 'completed', priority: draft.priority, checklist: [...draft.checklist], ...(draft.todoStart.date.length === 0 ? {} : { todoStart: { ...draft.todoStart } }), ...(draft.todoDue.date.length === 0 ? {} : { todoDue: { ...draft.todoDue } }) }
  return { ...base, eventTime: { ...draft.eventTime }, location: draft.location }
}

/** 从活动事项计算默认、今日、日历、提醒和回收站等全部 UI 投影。 */
function buildSnapshot(active: readonly OrganizerItem[], filtered: readonly OrganizerItem[], search: readonly OrganizerItem[], trash: readonly OrganizerItem[]): OrganizerSnapshot {
  const events = active.filter((item) => item.kind === 'event' && item.status === 'scheduled')
  const todos = active.filter((item) => item.kind === 'todo' && item.status === 'planned')
  const notes = active.filter((item) => item.kind === 'note' && item.status === 'active').slice(0, 3)
  const today = localDate(new Date())
  const overdueTodos = todos.filter((item) => item.todoDue?.date !== undefined && item.todoDue.date < today)
  const todayTodos = todos.filter((item) => !overdueTodos.includes(item) && (item.todoStart?.date === today || item.todoDue?.date === today))
  const todayEvents = events.filter((item) => eventDates(item).includes(today))
  const calendarDays = createCalendarDays(active.filter((item) => item.kind === 'event'))
  const ready = <T,>(items: readonly T[]): Projection<T> => ({ state: items.length === 0 ? 'empty' : 'ready', items })
  const empty = <T,>(): Projection<T> => ({ state: 'empty', items: [] })
  const reminderRows: readonly ReminderRow[] = []
  return {
    availability: 'ready', defaultView: { events: ready(events.slice(0, 10)), todos: ready(todos), notes: ready(notes) }, items: ready(filtered),
    today: { overdue: ready(overdueTodos), todos: ready(todayTodos), events: ready(todayEvents), reminders: empty<ReminderRow>() },
    calendar: { state: calendarDays.every((day) => day.items.length === 0) ? 'empty' : 'ready', rangeLabel: calendarRange(calendarDays), days: calendarDays, list: active.filter((item) => item.kind === 'event') },
    reminders: { due: ready(reminderRows), upcoming: empty<ReminderRow>(), history: empty<ReminderRow>() }, trash: ready(trash), search: ready(search),
  }
}

/** 按类型、状态、标签和排序条件筛选事项。 */
function filterItems(items: readonly OrganizerRecord[], query: ItemsQuery): OrganizerRecord[] {
  return [...items].filter((item) => (query.kinds.length === 0 || query.kinds.includes(item.kind)) && (query.statuses.length === 0 || query.statuses.includes(item.status)) && (query.tags.length === 0 || query.tags.every((tag) => item.tags.includes(tag)))).sort((left, right) => query.sort === 'updated' ? right.updatedAt.localeCompare(left.updatedAt) : right.updatedAt.localeCompare(left.updatedAt))
}

/** 对标题、详情、原始输入、标签、清单和地点执行大小写不敏感搜索。 */
function searchItems(items: readonly OrganizerRecord[], query: string): OrganizerRecord[] { return items.filter((item) => matches(item, query)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)) }
/** 判断事项是否包含查询文本。 */
function matches(item: OrganizerRecord, query: string): boolean { const needle = query.trim().toLocaleLowerCase(); return needle.length === 0 || [item.title, item.detail, item.originalInput, ...item.tags, ...(item.checklist?.map((entry) => entry.text) ?? []), item.location ?? ''].join(' ').toLocaleLowerCase().includes(needle) }

/** 计算日程跨越的日期集合，最多展开一年避免异常输入造成无限增长。 */
function eventDates(item: OrganizerItem): string[] {
  const time = item.eventTime
  if (time === undefined || time.startDate.length === 0) return []
  if (time.mode === 'all-day' && time.endDate.length > 0 && time.endDate !== time.startDate) return dateRange(time.startDate, time.endDate)
  return [time.startDate]
}

/** 生成半开区间 [start, endExclusive) 的本地日期列表。 */
function dateRange(start: string, endExclusive: string): string[] {
  const result: string[] = []; const cursor = new Date(`${start}T00:00:00`); const end = new Date(`${endExclusive}T00:00:00`)
  while (cursor < end && result.length < 366) { result.push(localDate(cursor)); cursor.setDate(cursor.getDate() + 1) }
  return result
}

/** 生成当前周的日历投影，并把事项按本地日期归并。 */
function createCalendarDays(items: readonly OrganizerItem[]): readonly CalendarDay[] {
  const today = localDate(new Date()); const start = new Date(`${today}T00:00:00`); start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); const dateValue = localDate(date); return { id: dateValue, weekday: ['日', '一', '二', '三', '四', '五', '六'][date.getDay()] ?? '', date: `${date.getMonth() + 1} 月 ${date.getDate()} 日`, ...(dateValue === today ? { isToday: true } : {}), items: items.filter((item) => eventDates(item).includes(dateValue)) } })
}

/** 格式化日历投影的日期范围标题。 */
function calendarRange(days: readonly CalendarDay[]): string { return days.length === 0 ? '当前周' : `${days[0]?.date ?? ''} - ${days[days.length - 1]?.date ?? ''}` }
/** 将 Date 转为本地日期字符串，供日历和过期判断使用。 */
function localDate(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
/** 生成 Canonical 记录使用的 UTC 时间戳。 */
function now(): string { return new Date().toISOString() }
