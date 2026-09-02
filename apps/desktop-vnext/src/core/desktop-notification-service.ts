import {
  type DesktopNotificationEvent,
  type DesktopNotificationInput,
  type DesktopNotificationResult,
  type DesktopNotificationStatus,
  type NativeNotification,
  type NativeNotificationFactory,
} from './desktop-capabilities-contract.js'

interface NotificationEntry {
  readonly owner: object
  readonly input: DesktopNotificationInput
  readonly native: NativeNotification
  readonly listeners: readonly {
    readonly event: 'click' | 'action' | 'failed'
    readonly listener: (...args: unknown[]) => void
  }[]
}

/** 将 Electron Notification 限制为可替换、可移除、可观察的窄能力。 */
export class DesktopNotificationService {
  readonly #factory: NativeNotificationFactory
  readonly #entries = new Map<string, NotificationEntry>()
  #disposed = false

  constructor(factory: NativeNotificationFactory) {
    this.#factory = factory
  }

  status(): DesktopNotificationStatus {
    if (this.#disposed) return { supported: false, permission: 'unsupported' }
    if (!this.#factory.isSupported()) return { supported: false, permission: 'unsupported' }
    return { supported: true, permission: 'unknown' }
  }

  show(owner: object, input: DesktopNotificationInput, onEvent: (event: DesktopNotificationEvent) => void): DesktopNotificationResult {
    const normalizedInput = { ...input, id: input.id.trim() }
    if (this.#disposed) return unavailable(normalizedInput.id, 'OWNER_UNLOADED', 'Desktop Core 已停止')
    if (!this.#factory.isSupported()) return unavailable(normalizedInput.id, 'PLATFORM_UNSUPPORTED', '当前平台不支持系统通知')
    if (!validInput(normalizedInput)) return unavailable(normalizedInput.id, 'INVALID_REQUEST', '通知内容无效')
    const existing = this.#entries.get(normalizedInput.id)
    if (existing !== undefined && existing.owner !== owner) return unavailable(normalizedInput.id, 'ID_IN_USE', '通知 id 已被其他窗口使用')
    if (existing !== undefined) this.removeEntry(existing, normalizedInput.id)

    let native: NativeNotification
    try {
      native = this.#factory.create({
        id: normalizedInput.id,
        title: normalizedInput.title,
        body: normalizedInput.body,
        ...(normalizedInput.actions === undefined || normalizedInput.actions.length === 0
          ? {}
          : { actions: normalizedInput.actions.map((action) => ({ type: 'button' as const, text: action.label })) }),
      })
    } catch {
      return unavailable(normalizedInput.id, 'CAPABILITY_UNAVAILABLE', '系统通知创建失败')
    }

    const listeners: {
      readonly event: 'click' | 'action' | 'failed'
      readonly listener: (...args: unknown[]) => void
    }[] = []
    const click = () => onEvent({ kind: 'clicked', id: normalizedInput.id })
    const action = (...args: unknown[]) => {
      const index = typeof args[1] === 'number' ? args[1] : -1
      const actionId = normalizedInput.actions?.[index]?.id
      if (actionId !== undefined) onEvent({ kind: 'action', id: normalizedInput.id, actionId })
    }
    const failed = () => onEvent({
      kind: 'failed',
      id: normalizedInput.id,
      failedAt: new Date().toISOString(),
      reason: '系统通知投递失败',
    })
    native.on('click', click)
    native.on('action', action)
    native.on('failed', failed)
    listeners.push(
      { event: 'click', listener: click },
      { event: 'action', listener: action },
      { event: 'failed', listener: failed },
    )
    try {
      native.show()
    } catch {
      for (const listener of listeners) native.removeListener(listener.event, listener.listener)
      return unavailable(normalizedInput.id, 'CAPABILITY_UNAVAILABLE', '系统通知投递失败')
    }
    this.#entries.set(normalizedInput.id, { owner, input: normalizedInput, native, listeners })
    return { status: 'shown', id: normalizedInput.id }
  }

  remove(owner: object, id: string): DesktopNotificationResult {
    const normalizedId = id.trim()
    if (this.#disposed) return unavailable(normalizedId, 'OWNER_UNLOADED', 'Desktop Core 已停止')
    const entry = this.#entries.get(normalizedId)
    if (entry !== undefined && entry.owner !== owner) return unavailable(normalizedId, 'ID_IN_USE', '通知 id 不属于当前窗口')
    if (entry !== undefined) this.removeEntry(entry, normalizedId)
    else this.#factory.remove?.(normalizedId)
    return { status: 'removed', id: normalizedId }
  }

  disposeOwner(owner: object): void {
    for (const [id, entry] of this.#entries) {
      if (entry.owner !== owner) continue
      this.removeEntry(entry, id)
    }
  }

  /** DSH generation 重启时关闭当前 generation 的通知，但保留 Core facade 可再次使用。 */
  clear(): void {
    for (const [id, entry] of this.#entries) this.removeEntry(entry, id)
    this.#entries.clear()
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.clear()
  }

  private removeEntry(entry: NotificationEntry, id: string): void {
    for (const listener of entry.listeners) entry.native.removeListener(listener.event, listener.listener)
    entry.native.close()
    this.#factory.remove?.(id)
    this.#entries.delete(id)
  }
}

function validInput(input: DesktopNotificationInput): boolean {
  if (input.id.trim().length === 0 || input.id.length > 128) return false
  if (input.title.trim().length === 0 || input.title.length > 256) return false
  if (input.body.trim().length === 0 || input.body.length > 2048) return false
  if (input.actions !== undefined && (input.actions.length > 3 || input.actions.some((action) => (
    action.id.trim().length === 0 || action.id.length > 64 || action.label.trim().length === 0 || action.label.length > 64
  )))) return false
  return true
}

function unavailable(id: string, code: 'OWNER_UNLOADED' | 'PLATFORM_UNSUPPORTED' | 'INVALID_REQUEST' | 'CAPABILITY_UNAVAILABLE' | 'ID_IN_USE', reason: string): DesktopNotificationResult {
  return { status: 'unavailable', id, code, reason }
}
