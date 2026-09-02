/**
 * Hermit Desktop Core 的最小 renderer 能力面。业务插件只提交绝对 deadline 和安全摘要，
 * 不接触 Electron、Node 或通用 IPC。
 */

export interface DesktopDeadlineInput {
  readonly id: string
  readonly fireAt: string
}

export type DesktopCapabilityErrorCode =
  | 'PLATFORM_UNSUPPORTED'
  | 'PERMISSION_DENIED'
  | 'CAPABILITY_UNAVAILABLE'
  | 'OWNER_UNLOADED'
  | 'INVALID_REQUEST'
  | 'ID_IN_USE'

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

export interface DesktopDeadlineClient {
  arm(input: DesktopDeadlineInput): Promise<DesktopDeadlineResult>
  cancel(id: string): Promise<DesktopDeadlineResult>
  observe(listener: (event: DesktopDeadlineFiredEvent) => void): () => void
}

export interface DesktopNotificationActionInput {
  readonly id: string
  readonly label: string
}

export interface DesktopNotificationInput {
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

export interface DesktopNotificationClient {
  status(): Promise<DesktopNotificationStatus>
  show(input: DesktopNotificationInput): Promise<DesktopNotificationResult>
  replace(input: DesktopNotificationInput): Promise<DesktopNotificationResult>
  remove(id: string): Promise<DesktopNotificationResult>
  observe(listener: (event: DesktopNotificationEvent) => void): () => void
}

/** 纯 Web 或未注入 Desktop Core 时返回 undefined。 */
export function getDesktopDeadlineClient(): DesktopDeadlineClient | undefined {
  const host = globalThis as typeof globalThis & { readonly hermitDesktopDeadlines?: DesktopDeadlineClient }
  return host.hermitDesktopDeadlines
}

/** 纯 Web 或未注入 Desktop Core 时返回 undefined。 */
export function getDesktopNotificationClient(): DesktopNotificationClient | undefined {
  const host = globalThis as typeof globalThis & { readonly hermitDesktopNotifications?: DesktopNotificationClient }
  return host.hermitDesktopNotifications
}
