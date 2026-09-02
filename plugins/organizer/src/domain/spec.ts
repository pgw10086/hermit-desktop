import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { OrganizerRecord, OrganizerToolCall } from './types.js'

/** 待办时间点校验；空值语义由上层解析流程处理，这里只约束字段形状。 */
const temporalPointSchema = z.object({ date: z.string(), time: z.string() })
/** 清单项校验；id 需稳定以支持局部更新和排序。 */
const checklistSchema = z.object({ id: z.string().min(1), text: z.string(), completed: z.boolean() })
/** 提醒规则校验；relative 模式通过 anchor 和偏移量计算实际触发时间。 */
const reminderSchema = z.object({
  id: z.string().min(1), mode: z.union([z.literal('absolute'), z.literal('relative')]),
  anchor: z.union([z.literal(''), z.literal('todo-start'), z.literal('todo-due'), z.literal('event-start')]),
  date: z.string(), time: z.string(), relation: z.union([z.literal('before'), z.literal('after')]),
  amount: z.number().int().nonnegative(), unit: z.union([z.literal('minute'), z.literal('hour'), z.literal('day')]),
  sourceText: z.string().optional(), timeZone: z.string().optional(), referenceAt: z.number().int().nonnegative().optional(),
}).superRefine((value, ctx) => { if (value.mode === 'relative' && value.amount === 0) ctx.addIssue({ code: 'custom', path: ['amount'], message: '相对提醒数量必须大于 0' }) })
/** 日历事件时间校验；mode 区分日期、全天和精确时间，避免用隐含约定解释空字段。 */
const eventTimeSchema = z.object({
  mode: z.union([z.literal('date-only'), z.literal('all-day'), z.literal('timed')]),
  startDate: z.string(), startTime: z.string(), endDate: z.string(), endTime: z.string(), hasEnd: z.boolean(),
})
/** Organizer 条目持久化校验；所有状态、版本和时间字段在写入边界集中收窄。 */
const recordSchema = z.object({
  id: z.string().min(1), kind: z.union([z.literal('note'), z.literal('todo'), z.literal('event')]),
  title: z.string().min(1), detail: z.string(), tags: z.array(z.string()),
  status: z.union([z.literal('active'), z.literal('planned'), z.literal('completed'), z.literal('cancelled'), z.literal('scheduled'), z.literal('archived')]),
  revision: z.number().int().positive(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  sourceLabel: z.string(), originalInput: z.string(), typeHistory: z.array(z.string()),
  completed: z.boolean().optional(), deletedAt: z.string().datetime().optional(), pinned: z.boolean().optional(),
  priority: z.union([z.literal('none'), z.literal('low'), z.literal('medium'), z.literal('high')]).optional(),
  checklist: z.array(checklistSchema).optional(), todoStart: temporalPointSchema.optional(), todoDue: temporalPointSchema.optional(),
  eventTime: eventTimeSchema.optional(), location: z.string().optional(), reminders: z.array(reminderSchema), createdByCallId: z.string().min(1).optional(),
})
/** 工具调用幂等记录校验；callId 关联一次外部请求，revision 记录其提交时版本。 */
const callSchema = z.object({ callId: z.string().min(1), itemId: z.string().min(1), revision: z.number().int().positive(), createdAt: z.string().datetime() })

/** Organizer 的唯一领域注册；条目和工具调用由该定义统一持久化。 */
export const ORGANIZER_DOMAIN = defineDomain({
  name: 'personal_organizer',
  version: 1,
  tables: { items: domainTable<string, OrganizerRecord>(recordSchema as z.ZodType<OrganizerRecord>), tool_calls: domainTable<string, OrganizerToolCall>(callSchema as z.ZodType<OrganizerToolCall>) },
} as const)
