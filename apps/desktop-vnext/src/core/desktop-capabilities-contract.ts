/** Desktop Core 对 DSH Renderer 暴露的最小系统能力类型。业务语义不进入这里。 */

export type DesktopCapabilityErrorCode =
  | 'PLATFORM_UNSUPPORTED'
  | 'PERMISSION_DENIED'
  | 'CAPABILITY_UNAVAILABLE'
  | 'OWNER_UNLOADED'
  | 'INVALID_REQUEST'
  | 'ID_IN_USE'

export interface DesktopDeadlineInput {
  /** 调用方生成的不透明稳定 ID；Core 不解释其业务含义。 */
  readonly id: string
  /** 必须带 Z 的 UTC instant，例如 2026-09-02T00:00:00.000Z。 */
  readonly fireAt: string
}

export interface DesktopDeadlineFiredEvent {
  readonly kind: 'fired'
  readonly id: string
  readonly fireAt: string
  readonly firedAt: string
}

export type DesktopDeadlineResult =
  | { readonly status: 'armed'; readonly id: string; readonly fireAt: string }
  | { readonly status: 'canceled'; readonly id: string }
  | { readonly status: 'unavailable'; readonly id: string; readonly code: DesktopCapabilityErrorCode; readonly reason: string }

export interface DesktopNotificationActionInput {
  readonly id: string
  readonly label: string
}

export interface DesktopNotificationInput {
  /** 调用方生成的稳定通知 ID；同 ID 的 show 会替换当前通知。 */
  readonly id: string
  readonly title: string
  readonly body: string
  readonly actions?: readonly DesktopNotificationActionInput[]
}

export interface DesktopNotificationStatus {
  readonly supported: boolean
  readonly permission: 'granted' | 'denied' | 'unknown' | 'unsupported'
}

export interface DesktopNotificationEvent {
  readonly kind: 'clicked' | 'action' | 'failed'
  readonly id: string
  readonly actionId?: string
  readonly failedAt?: string
  readonly reason?: string
}

export type DesktopNotificationResult =
  | { readonly status: 'shown'; readonly id: string }
  | { readonly status: 'removed'; readonly id: string }
  | { readonly status: 'unavailable'; readonly id: string; readonly code: DesktopCapabilityErrorCode; readonly reason: string }

/** Core 内部使用的 native Notification 适配面；Electron 类型不越过 Core 边界。 */
export interface NativeNotification {
  show(): void
  close(): void
  on(event: 'click' | 'action' | 'failed', listener: (...args: unknown[]) => void): void
  removeListener(event: 'click' | 'action' | 'failed', listener: (...args: unknown[]) => void): void
}

export interface NativeNotificationFactory {
  isSupported(): boolean
  create(options: {
    readonly id: string
    readonly title: string
    readonly body: string
    readonly actions?: readonly { readonly type: 'button'; readonly text: string }[]
  }): NativeNotification
  remove?(id: string): void
}
