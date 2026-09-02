import {
  type DesktopDeadlineFiredEvent,
  type DesktopDeadlineInput,
  type DesktopDeadlineResult,
} from './desktop-capabilities-contract.js'

const MAX_TIMER_DELAY_MS = 2_147_483_647

export interface DeadlineClock {
  now(): number
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>
  clearTimeout(handle: ReturnType<typeof setTimeout>): void
}

interface DeadlineEntry {
  readonly owner: object
  readonly input: DesktopDeadlineInput
  readonly fireAtMs: number
  readonly onFire: (event: DesktopDeadlineFiredEvent) => void
  timer: ReturnType<typeof setTimeout> | undefined
}

/**
 * 只等待调用方已经算好的绝对时刻。它不保存 Reminder 规则，也不理解重复、事项或时区。
 */
export class DesktopDeadlineService {
  readonly #clock: DeadlineClock
  readonly #entries = new Map<string, DeadlineEntry>()
  #disposed = false

  constructor(clock: DeadlineClock = {
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (handle) => clearTimeout(handle),
  }) {
    this.#clock = clock
  }

  arm(owner: object, input: DesktopDeadlineInput, onFire: (event: DesktopDeadlineFiredEvent) => void): DesktopDeadlineResult {
    const id = input.id.trim()
    if (this.#disposed) return unavailable(id, 'OWNER_UNLOADED', 'Desktop Core 已停止')
    const fireAtMs = parseUtcInstant(input.fireAt)
    if (fireAtMs === undefined) return unavailable(id, 'INVALID_REQUEST', 'deadline 必须是 UTC instant')
    if (id.length === 0 || input.id.length > 256) return unavailable(id, 'INVALID_REQUEST', 'deadline id 无效')

    const existing = this.#entries.get(id)
    if (existing !== undefined && existing.owner !== owner) {
      return unavailable(id, 'ID_IN_USE', 'deadline id 已被其他窗口使用')
    }
    if (existing !== undefined) this.clearEntry(existing)
    const entry: DeadlineEntry = {
      owner,
      input: { id, fireAt: new Date(fireAtMs).toISOString() },
      fireAtMs,
      onFire,
      timer: undefined,
    }
    this.#entries.set(entry.input.id, entry)
    this.schedule(entry)
    return { status: 'armed', id: entry.input.id, fireAt: entry.input.fireAt }
  }

  cancel(owner: object, id: string): DesktopDeadlineResult {
    const normalizedId = id.trim()
    if (this.#disposed) return unavailable(normalizedId, 'OWNER_UNLOADED', 'Desktop Core 已停止')
    const entry = this.#entries.get(normalizedId)
    if (entry === undefined) return { status: 'canceled', id: normalizedId }
    if (entry.owner !== owner) return unavailable(normalizedId, 'ID_IN_USE', 'deadline id 不属于当前窗口')
    this.clearEntry(entry)
    this.#entries.delete(normalizedId)
    return { status: 'canceled', id: normalizedId }
  }

  disposeOwner(owner: object): void {
    for (const [id, entry] of this.#entries) {
      if (entry.owner !== owner) continue
      this.clearEntry(entry)
      this.#entries.delete(id)
    }
  }

  /** DSH generation 重启时撤销当前 generation 的等待，但保留 Core facade 可再次使用。 */
  clear(): void {
    for (const entry of this.#entries.values()) this.clearEntry(entry)
    this.#entries.clear()
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.clear()
  }

  private schedule(entry: DeadlineEntry): void {
    const delay = Math.max(0, entry.fireAtMs - this.#clock.now())
    const wait = Math.min(delay, MAX_TIMER_DELAY_MS)
    entry.timer = this.#clock.setTimeout(() => {
      if (this.#entries.get(entry.input.id) !== entry || this.#disposed) return
      if (wait < delay) {
        this.schedule(entry)
        return
      }
      this.#entries.delete(entry.input.id)
      entry.timer = undefined
      entry.onFire({
        kind: 'fired',
        id: entry.input.id,
        fireAt: entry.input.fireAt,
        firedAt: new Date(this.#clock.now()).toISOString(),
      })
    }, wait)
  }

  private clearEntry(entry: DeadlineEntry): void {
    if (entry.timer !== undefined) this.#clock.clearTimeout(entry.timer)
    entry.timer = undefined
  }
}

function parseUtcInstant(value: string): number | undefined {
  if (!/Z$/u.test(value)) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function unavailable(id: string, code: 'OWNER_UNLOADED' | 'INVALID_REQUEST' | 'ID_IN_USE', reason: string): DesktopDeadlineResult {
  return { status: 'unavailable', id, code, reason }
}
