import { z } from 'zod'

/** Client 草稿中的时间点形状；空字段保留给表单编辑态。 */
const temporalPoint = z.object({ date: z.string(), time: z.string() })
/** Client 清单项形状；与领域记录共用稳定 id。 */
const checklist = z.object({ id: z.string().min(1), text: z.string(), completed: z.boolean() })
/** Client 提醒规则形状；由领域层在提交时解释相对锚点。 */
const reminder = z.object({ id: z.string().min(1), mode: z.union([z.literal('absolute'), z.literal('relative')]), anchor: z.union([z.literal(''), z.literal('todo-start'), z.literal('todo-due'), z.literal('event-start')]), date: z.string(), time: z.string(), relation: z.union([z.literal('before'), z.literal('after')]), amount: z.number().int().positive(), unit: z.union([z.literal('minute'), z.literal('hour'), z.literal('day')]) })
/** Client 事件时间形状；mode 是 UI 与领域之间的明确契约。 */
const eventTime = z.object({ mode: z.union([z.literal('date-only'), z.literal('all-day'), z.literal('timed')]), startDate: z.string(), startTime: z.string(), endDate: z.string(), endTime: z.string(), hasEnd: z.boolean() })

/** Organizer Client 提交的条目草稿；revision 存在时表示乐观并发更新。 */
export const ItemDraftSchema = z.object({
  id: z.string().min(1).optional(), kind: z.union([z.literal(''), z.literal('note'), z.literal('todo'), z.literal('event')]),
  title: z.string(), detail: z.string(), tags: z.array(z.string()), pinned: z.boolean(),
  priority: z.union([z.literal('none'), z.literal('low'), z.literal('medium'), z.literal('high')]), checklist: z.array(checklist),
  todoStart: temporalPoint, todoDue: temporalPoint, eventTime, location: z.string(), reminders: z.array(reminder), revision: z.number().int().positive().optional(),
})
