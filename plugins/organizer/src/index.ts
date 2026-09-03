import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-skill'
import { defineTool, type ToolExecution } from '@deepseek-ai/dsh-tools'
import { OrganizerService } from './domain/service.js'
import type { OrganizerCommand, OrganizerItem, ReminderRuleDraft, TemporalPoint } from './client/contracts.js'
import { organizerRequestSchema, type OrganizerRpcRequest } from './domain/wire.js'
import { resolveTemporalExpression, systemTimeZone, toAbsoluteReminder, type CreateReminderInput, type TemporalExpression, type TimeResolutionContext } from './domain/time.js'
import { RPC_CHANNEL } from './shared.js'

/** Organizer Host 需要的持久化、RPC、Tool 和 Skill 服务。 */
export const inject = ['storage', 'connection', 'tools', 'skills']

/** 创建待办的工具名称，作为 Skill 到领域服务的稳定入口。 */
const CREATE_TODO_TOOL = 'organizer_create_todo'
/** 创建便签的工具名称，作为 Skill 到领域服务的稳定入口。 */
const CREATE_NOTE_TOOL = 'organizer_create_note'
/** 读取今日事项摘要的工具名称，作为 AI 只读入口。 */
const LIST_TODAY_TOOL = 'organizer_list_today'
/** AI 创建参数中的结构化日期时间；relativeDays 以当前用户消息的本地日期为基准。 */
const AI_TEMPORAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    date: { type: 'string', description: '绝对日期，格式 YYYY-MM-DD；与 relativeDays 二选一。' },
    relativeDays: { type: 'integer', description: '相对用户消息日期的天数；今天为 0，明天为 1。' },
    time: { type: 'string', description: '可选时间，格式 HH:mm。' },
  },
} as const

/** AI 创建参数中的一次性提醒；Reminder 时间必须有具体小时和分钟。 */
const AI_REMINDER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    date: { type: 'string', description: '绝对提醒日期，格式 YYYY-MM-DD；与 relativeDays 二选一。' },
    relativeDays: { type: 'integer', description: '相对用户消息日期的天数；今天为 0，明天为 1。' },
    time: { type: 'string', required: true, description: '提醒时间，格式 HH:mm。' },
    sourceText: { type: 'string', description: '用户原话中的提醒时间表达。' },
  },
} as const

const AI_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    itemId: { type: 'string', required: true, description: '事项稳定身份。' },
    kind: { type: 'string', required: true, description: '事项类型。' },
    title: { type: 'string', required: true, description: '事项标题。' },
    status: { type: 'string', required: true, description: '事项状态。' },
    timeLabel: { type: 'string', description: '事项时间；未设置时省略。' },
  },
} as const

interface AiItemSummary {
  readonly itemId: string
  readonly kind: string
  readonly title: string
  readonly status: string
  readonly timeLabel?: string
}

interface TodayAiSummary {
  readonly overdue: readonly AiItemSummary[]
  readonly todos: readonly AiItemSummary[]
  readonly events: readonly AiItemSummary[]
}

/** 注册 Organizer 的 Skill、Tool 和 Host RPC，并在 effect 结束时成组撤销。 */
export function apply(ctx: Context): void {
  ctx.effect(async () => {
    const service = await OrganizerService.open(ctx)
    const disposeSkill = ctx.skills.register({
      name: 'personal-organizer',
      description: '记录、安排、完成和查找用户的个人事项。',
      whenToUse: '用户明确说要记录、创建待办、添加日程、完成或修改已有个人事项时使用。',
      source: 'bundled',
      content: PERSONAL_ORGANIZER_SKILL,
      metadata: { packageName: '@hermit/organizer', contractVersion: 1 },
    })
    const handler: ConnectionRpcHandler = async (_endpoint, payload) => {
      const parsed = organizerRequestSchema.safeParse(payload)
      if (!parsed.success) return failure('个人事项请求格式无效')
      try {
        return success(await dispatch(service, parsed.data))
      } catch (error) {
        return failure(error instanceof Error ? error.message : '个人事项操作失败')
      }
    }
    const disposeRpc = ctx.connection.rpc.handle(RPC_CHANNEL, handler, { authority: 'loopback' })
    const disposeTool = ctx.tools.register(defineTool({
      name: CREATE_TODO_TOOL,
      description: '当用户明确要求记录或创建一个待办时，在 Personal Organizer 中创建一条待办。不要把普通讨论、建议或问题自动保存。',
      parameters: {
        title: { type: 'string', required: true, description: '待办的主要行动标题。' },
        detail: { type: 'string', description: '用户明确提供的补充说明。' },
        originalInput: { type: 'string', description: '触发这次创建的完整用户原话。' },
        checklist: {
          type: 'array', description: '用户明确给出“清单/步骤/子任务”时按原顺序填写；没有时省略。',
          items: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true, description: '清单项内容。' } } },
        },
        todoStart: { ...AI_TEMPORAL_SCHEMA, description: '用户明确表达计划执行时间时填写；“提醒我做 X”且 X 是可执行动作时，与提醒时间相同。' },
        todoDue: { ...AI_TEMPORAL_SCHEMA, description: '只有用户明确表达截止、最晚或之前完成时填写。' },
        reminders: { type: 'array', description: '用户明确要求提醒时填写；每条提醒必须有具体日期和 HH:mm。', items: AI_REMINDER_SCHEMA },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            itemId: { type: 'string', required: true }, revision: { type: 'integer', required: true },
            kind: { type: 'string', const: 'todo', required: true }, status: { type: 'string', const: 'planned', required: true },
            title: { type: 'string', required: true },
            todoStart: { type: 'string' }, reminder: { type: 'string' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `已记录：待办 · ${value.title}${value.todoStart === undefined ? '' : `，计划 ${value.todoStart}`}${value.reminder === undefined ? '' : `，提醒 ${value.reminder}`}（${value.itemId}）。打开：个人事项` }],
      },
      execute: async (args, exec) => {
        const context = timeResolutionContext(exec)
        const todoStart = resolveAiPoint(args.todoStart, context, '待办开始')
        const todoDue = resolveAiPoint(args.todoDue, context, '待办截止')
        const reminders = resolveAiReminders(args.reminders, context)
        const item = await service.createTodo({ title: args.title, ...(args.detail === undefined ? {} : { detail: args.detail }), ...(args.originalInput === undefined ? {} : { originalInput: args.originalInput }), ...(args.checklist === undefined ? {} : { checklist: args.checklist }), ...(todoStart === undefined ? {} : { todoStart }), ...(todoDue === undefined ? {} : { todoDue }), ...(reminders.length === 0 ? {} : { reminders }) }, String(exec.callId))
        exec.concludeTurn()
        return { itemId: item.id, revision: item.revision, kind: 'todo' as const, status: 'planned' as const, title: item.title, ...(item.todoStart === undefined ? {} : { todoStart: formatPoint(item.todoStart) }), ...(item.reminders[0] === undefined ? {} : { reminder: formatReminder(item.reminders[0]) }) }
      },
      presentCall: (args) => ({ card: 'generic', kind: 'edit', title: '记录待办', rawInput: args.title }),
      presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? '待办未记录' : '已记录待办' }),
    }))
    const disposeNoteTool = ctx.tools.register(defineTool({
      name: CREATE_NOTE_TOOL,
      description: '当用户明确要求记录内容但没有指定待办或日程时，在 Personal Organizer 中创建一条便签。不要把普通讨论、建议或问题自动保存。',
      parameters: {
        title: { type: 'string', required: true, description: '便签标题；不要丢失用户表达的事实。' },
        detail: { type: 'string', description: '用户明确提供的补充正文。' },
        originalInput: { type: 'string', description: '触发这次创建的完整用户原话。' },
        reminders: { type: 'array', description: '用户明确要求提醒时填写；每条提醒必须有具体日期和 HH:mm。', items: AI_REMINDER_SCHEMA },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            itemId: { type: 'string', required: true }, revision: { type: 'integer', required: true },
            kind: { type: 'string', const: 'note', required: true }, status: { type: 'string', const: 'active', required: true },
            title: { type: 'string', required: true },
            reminder: { type: 'string' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `已记录：便签 · ${value.title}${value.reminder === undefined ? '' : `，提醒 ${value.reminder}`}（${value.itemId}）。打开：个人事项` }],
      },
      execute: async (args, exec) => {
        const reminders = resolveAiReminders(args.reminders, timeResolutionContext(exec))
        const item = await service.createNote({ title: args.title, ...(args.detail === undefined ? {} : { detail: args.detail }), ...(args.originalInput === undefined ? {} : { originalInput: args.originalInput }), ...(reminders.length === 0 ? {} : { reminders }) }, String(exec.callId))
        exec.concludeTurn()
        return { itemId: item.id, revision: item.revision, kind: 'note' as const, status: 'active' as const, title: item.title, ...(item.reminders[0] === undefined ? {} : { reminder: formatReminder(item.reminders[0]) }) }
      },
      presentCall: (args) => ({ card: 'generic', kind: 'edit', title: '记录便签', rawInput: args.title }),
      presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? '便签未记录' : '已记录便签' }),
    }))
    const disposeListTodayTool = ctx.tools.register(defineTool({
      name: LIST_TODAY_TOOL,
      description: '读取 Personal Organizer 中今天的过期待办、今日待办和今日事件摘要。只返回标题、类型、状态和时间，不返回完整正文。',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            overdue: { type: 'array', required: true, items: AI_ITEM_SCHEMA },
            todos: { type: 'array', required: true, items: AI_ITEM_SCHEMA },
            events: { type: 'array', required: true, items: AI_ITEM_SCHEMA },
          },
        },
        render: (_args, value) => [{ type: 'text', text: renderTodaySummary(value) }],
      },
      execute: async () => {
        const snapshot = await service.snapshot()
        return {
          overdue: snapshot.today.overdue.items.map(toAiItem),
          todos: snapshot.today.todos.items.map(toAiItem),
          events: snapshot.today.events.items.map(toAiItem),
        }
      },
      presentCall: () => ({ card: 'generic', kind: 'read', title: '读取今日事项' }),
      presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? '今日事项读取失败' : '今日事项已读取' }),
    }))
    // 创建工具只声明业务语义；是否需要确认由 DSH/Core 的 permission/Approval policy 决定。
    return async () => {
      disposeListTodayTool()
      disposeTool()
      disposeNoteTool()
      await disposeRpc()
      disposeSkill()
      await service.close()
    }
  }, 'personal-organizer: domain + rpc + tool')
}

/** 将已解析 RPC 请求分派到领域服务，保持 transport 层不承载业务规则。 */
async function dispatch(service: OrganizerService, request: OrganizerRpcRequest) {
  if (request.operation === 'snapshot') return { snapshot: await service.snapshot(request.query) }
  return { result: await service.execute(toOrganizerCommand(request.command)), snapshot: await service.snapshot() }
}

/** 将 Zod 解析出的可选字段重建为业务命令，避免把显式 undefined 带进 exactOptional 类型。 */
type OrganizerCommandInput = Extract<OrganizerRpcRequest, { operation: 'command' }>['command']

function toOrganizerCommand(command: OrganizerCommandInput): OrganizerCommand {
  if (command.type !== 'save') return command
  const draft = command.draft
  return {
    type: 'save',
    draft: {
      kind: draft.kind,
      title: draft.title,
      detail: draft.detail,
      tags: draft.tags,
      pinned: draft.pinned,
      priority: draft.priority,
      checklist: draft.checklist,
      todoStart: draft.todoStart,
      todoDue: draft.todoDue,
      eventTime: draft.eventTime,
      location: draft.location,
      reminders: draft.reminders.map((reminder) => ({
        id: reminder.id, mode: reminder.mode, anchor: reminder.anchor, date: reminder.date, time: reminder.time,
        relation: reminder.relation, amount: reminder.amount, unit: reminder.unit,
        ...(reminder.sourceText === undefined ? {} : { sourceText: reminder.sourceText }),
        ...(reminder.timeZone === undefined ? {} : { timeZone: reminder.timeZone }),
        ...(reminder.referenceAt === undefined ? {} : { referenceAt: reminder.referenceAt }),
      })),
      ...(draft.id === undefined ? {} : { id: draft.id }),
      ...(draft.revision === undefined ? {} : { revision: draft.revision }),
    },
  }
}

/** 构造统一成功 RPC 响应。 */
function success(value: unknown) { return { ok: true as const, value } }
/** 构造统一失败 RPC 响应，避免把内部异常对象直接暴露给 Client。 */
function failure(message: string) { return { ok: false as const, error: { code: 'internal' as const, message, details: {} } } }

export default { inject, apply }

export { OrganizerService } from './domain/service.js'
export { ORGANIZER_DOMAIN } from './domain/spec.js'

/** 将页面投影收窄为 AI 可见的最小事项摘要，不把正文和内部字段送入模型。 */
function toAiItem(item: OrganizerItem): AiItemSummary {
  return {
    itemId: item.id,
    kind: item.kindLabel,
    title: item.title,
    status: item.statusLabel,
    ...(item.timeLabel === undefined ? {} : { timeLabel: item.timeLabel }),
  }
}

/** 为 Native 和模型上下文提供稳定、可读的今日摘要。 */
function renderTodaySummary(summary: TodayAiSummary): string {
  const sections = [
    ['过期待办', summary.overdue],
    ['今日待办', summary.todos],
    ['今日事件', summary.events],
  ] as const
  if (sections.every(([, items]) => items.length === 0)) return '今天没有过期待办、今日待办或今日事件。'
  const lines = sections.flatMap(([label, items]) => [
    `${label}（${String(items.length)}）`,
    ...items.map((item) => `- ${item.title} · ${item.kind} · ${item.status}${item.timeLabel === undefined ? '' : ` · ${item.timeLabel}`}`),
  ])
  return lines.join('\n')
}

/** 从当前 Agent 的公开 Session 事件读取原始用户消息时间，不使用 Tool 执行时间。 */
function timeResolutionContext(exec: ToolExecution): TimeResolutionContext | undefined {
  const events = exec.agent?.session.events ?? []
  const userEvent = [...events].reverse().find((event) => event.type === 'user/message' && event.data.source.kind === 'user')
  return userEvent === undefined ? undefined : { referenceAt: userEvent.time, timeZone: systemTimeZone() }
}

/** 将 AI 参数中的时间点解析为 Canonical 本地时间点。 */
function resolveAiPoint(value: unknown, context: TimeResolutionContext | undefined, label: string): TemporalPoint | undefined {
  if (value === undefined) return undefined
  return resolveTemporalExpression(value as TemporalExpression, context, label)
}

/** 将 AI 参数中的提醒解析为绝对提醒输入，再交由领域层统一落库。 */
function resolveAiReminders(value: unknown, context: TimeResolutionContext | undefined): readonly CreateReminderInput[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('提醒参数格式无效')
  return value.map((entry) => {
    const input = entry as CreateReminderInput
    const point = resolveTemporalExpression(input, context, '提醒', true)
    return {
      date: point.date,
      time: point.time,
      ...(input.sourceText === undefined ? {} : { sourceText: input.sourceText }),
      ...(context === undefined ? {} : { timeZone: context.timeZone, referenceAt: context.referenceAt }),
    }
  })
}

/** 统一格式化 Tool Result 中的计划时间。 */
function formatPoint(point: TemporalPoint): string { return `${point.date}${point.time.length === 0 ? '' : ` ${point.time}`}` }
/** 统一格式化 Tool Result 中的提醒时间。 */
function formatReminder(rule: ReminderRuleDraft): string { return `${rule.date} ${rule.time}`.trim() }

const PERSONAL_ORGANIZER_SKILL = `
你是 Personal Organizer 的唯一 Skill，负责把用户明确的个人事项意图交给 Organizer Tool。

判断顺序：
1. 需要了解今天安排时调用 organizer_list_today；它只返回安全摘要，不要把缺少的正文当成不存在。
2. 只有用户明确表达“待办”“帮我记录”“记一下”“添加日程”，或明确说“提醒我”且目标内容清楚时才写入；普通讨论、建议和提问不写入。
3. 先判断被记录的事情：可执行、可完成的动作创建 Todo；明确会在某个时间发生的会议或安排属于 Event；只是信息、想法或需要记住的内容创建 Note。当前 Event 创建 Tool 尚未开放时不要伪造 Event。
4. “在某时提醒我做 X”且 X 是可执行动作时，默认调用 organizer_create_todo：把该时间同时写入 todoStart 和 reminders。只有用户明确说“截止/最晚/之前完成”时才写 todoDue。Reminder 不决定事项类型。
5. “在某时提醒我记住/保存一条信息”时调用 organizer_create_note，并只在提醒日期和 HH:mm 都明确时填写 reminders。提醒时间不完整时不要猜钟点，也不要创建待补全提醒。
6. todoStart、todoDue 和 reminders 必须传结构化日期时间：绝对日期用 YYYY-MM-DD，相对日期用 relativeDays（今天为 0，明天为 1）；时间使用 HH:mm。不要把时间事实只放在 detail 或 originalInput 中。
7. 用户明确说“清单”“步骤”或“子任务”并列出内容时，才把这些内容按原顺序作为 Checklist；否则放在详情中。创建 Todo 时提炼简洁行动作为 title，把明确补充放进 detail，并把完整原话作为 originalInput。
8. 创建类 Tool 是否需要一次性审批由 DSH/Core 的 permission/Approval policy 决定；无论是否弹出审批，没有成功的写入结果都不得声称已保存。结果中的 itemId 是后续打开、完成和修改的唯一引用。

不要创建第二个聊天入口、不要自行写数据库、不要为同一用户 turn 做相似内容去重。
`
