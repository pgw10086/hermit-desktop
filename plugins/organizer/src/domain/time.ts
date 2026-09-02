import type { ReminderRuleDraft, TemporalPoint } from '../client/contracts.js'

/** AI 创建参数中的日期表达；绝对日期和相对天数只能二选一。 */
export interface TemporalExpression {
  readonly date?: string
  readonly relativeDays?: number
  readonly time?: string
}

/** AI 创建参数中的一次性指定时间提醒。 */
export interface CreateReminderInput {
  readonly date?: string
  readonly relativeDays?: number
  readonly time: string
  readonly sourceText?: string
  readonly timeZone?: string
  readonly referenceAt?: number
}

/** 解析相对日期所需的原始用户消息时间和本地时区。 */
export interface TimeResolutionContext {
  readonly referenceAt: number
  readonly timeZone: string
}

/**
 * 将 AI 提取的时间事实转换为 Canonical 本地时间点。
 * 相对日期必须依赖原始用户消息时间，避免重放或异步处理时漂移。
 */
export function resolveTemporalExpression(input: TemporalExpression, context: TimeResolutionContext | undefined, label: string, requireTime = false): TemporalPoint {
  if (input.date !== undefined && input.relativeDays !== undefined) throw new Error(`${label}同时包含绝对日期和相对日期，无法确定`)
  const date = input.date !== undefined ? validateDate(input.date, label) : input.relativeDays !== undefined ? resolveRelativeDate(input.relativeDays, context, label) : undefined
  if (date === undefined) throw new Error(`${label}缺少日期`)
  const time = input.time ?? ''
  if (requireTime && time.length === 0) throw new Error(`${label}需要具体时间`)
  if (time.length > 0 && !TIME_PATTERN.test(time)) throw new Error(`${label}的时间必须是 HH:mm`)
  return { date, time }
}

/** 校验并保留一个绝对日期。 */
export function validateDate(value: string, label: string): string {
  if (!DATE_PATTERN.test(value)) throw new Error(`${label}的日期必须是 YYYY-MM-DD`)
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label}的日期无效`)
  return value
}

/** 返回当前设备时区；它只用于本地日历日期的解析和展示。 */
export function systemTimeZone(): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (timeZone === undefined || timeZone.length === 0) throw new Error('无法确定当前设备时区，不能解析相对日期')
  return timeZone
}

/** 将一个绝对提醒输入转换为领域已有的 ReminderRule 形状。 */
export function toAbsoluteReminder(input: CreateReminderInput, index: number, context: TimeResolutionContext | undefined): ReminderRuleDraft {
  const point = resolveTemporalExpression(input, context, '提醒', true)
  const base = {
    id: `rule-${String(index + 1)}`,
    mode: 'absolute',
    anchor: '',
    date: point.date,
    time: point.time,
    relation: 'before',
    amount: 1,
    unit: 'minute',
  } as const
  const withSource = input.sourceText === undefined ? base : { ...base, sourceText: input.sourceText }
  const timeZone = input.timeZone ?? context?.timeZone
  const referenceAt = input.referenceAt ?? context?.referenceAt
  if (timeZone === undefined && referenceAt === undefined) return withSource
  if (timeZone === undefined) return { ...withSource, referenceAt: referenceAt as number }
  if (referenceAt === undefined) return { ...withSource, timeZone }
  return { ...withSource, timeZone, referenceAt }
}

/** 按本地日历日期计算相对天数，不把一天粗暴当成固定秒数。 */
function resolveRelativeDate(offset: number, context: TimeResolutionContext | undefined, label: string): string {
  if (context === undefined) throw new Error(`${label}的相对日期缺少原始消息时间`)
  if (!Number.isSafeInteger(offset) || offset < -3650 || offset > 3650) throw new Error(`${label}的相对日期范围无效`)
  const base = localDateAt(context.referenceAt, context.timeZone)
  const cursor = new Date(`${base}T00:00:00.000Z`)
  cursor.setUTCDate(cursor.getUTCDate() + offset)
  return cursor.toISOString().slice(0, 10)
}

/** 从一个绝对时刻读取指定 IANA 时区的本地日期。 */
function localDateAt(timestamp: number, timeZone: string): string {
  if (!Number.isFinite(timestamp)) throw new Error('原始消息时间无效')
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp))
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u
