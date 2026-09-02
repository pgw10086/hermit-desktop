import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import {
  type DesktopDeadlineInput,
  type DesktopNotificationInput,
} from './desktop-capabilities-contract.js'
import type { DesktopDeadlineService } from './desktop-deadline-service.js'
import type { DesktopNotificationService } from './desktop-notification-service.js'

export const DESKTOP_DEADLINE_IPC_CHANNEL = 'hermit:desktop-deadlines'
export const DESKTOP_NOTIFICATION_IPC_CHANNEL = 'hermit:desktop-notifications'

type DeadlineRequest =
  | { readonly op: 'arm'; readonly input: DesktopDeadlineInput }
  | { readonly op: 'cancel'; readonly id: string }

type NotificationRequest =
  | { readonly op: 'status' }
  | { readonly op: 'show' | 'replace'; readonly input: DesktopNotificationInput }
  | { readonly op: 'remove'; readonly id: string }

/** 将 Deadline service 限定给 DSH 主窗口和 Core 自己创建的可信 Surface。 */
export function registerDesktopDeadlineIpc(options: {
  readonly ipcMain: IpcMain
  readonly service: DesktopDeadlineService
  readonly trustedWindows: readonly BrowserWindow[]
  readonly resolveWindow: (contents: WebContents) => BrowserWindow | null
  readonly ownsWindow?: (window: BrowserWindow) => boolean
}): () => void {
  const trusted = new Set(options.trustedWindows)
  const ownerDisposers = new Map<BrowserWindow, () => void>()
  const handler = (event: IpcMainInvokeEvent, value: unknown): unknown => {
    const window = assertTrustedSender(event, trusted, options.resolveWindow, options.ownsWindow)
    const request = parseDeadlineRequest(value)
    if (request.op === 'cancel') return options.service.cancel(window, request.id)
    ensureOwnerCleanup(window, ownerDisposers, options.service)
    return options.service.arm(window, request.input, (fired) => {
      if (!window.isDestroyed()) window.webContents.send(DESKTOP_DEADLINE_IPC_CHANNEL, fired)
    })
  }
  options.ipcMain.handle(DESKTOP_DEADLINE_IPC_CHANNEL, handler)
  return () => {
    for (const dispose of ownerDisposers.values()) dispose()
    ownerDisposers.clear()
    options.ipcMain.removeHandler(DESKTOP_DEADLINE_IPC_CHANNEL)
  }
}

/** 将系统通知 service 限定给 DSH 主窗口和 Core 自己创建的可信 Surface。 */
export function registerDesktopNotificationIpc(options: {
  readonly ipcMain: IpcMain
  readonly service: DesktopNotificationService
  readonly trustedWindows: readonly BrowserWindow[]
  readonly resolveWindow: (contents: WebContents) => BrowserWindow | null
  readonly ownsWindow?: (window: BrowserWindow) => boolean
}): () => void {
  const trusted = new Set(options.trustedWindows)
  const ownerDisposers = new Map<BrowserWindow, () => void>()
  const handler = (event: IpcMainInvokeEvent, value: unknown): unknown => {
    const window = assertTrustedSender(event, trusted, options.resolveWindow, options.ownsWindow)
    const request = parseNotificationRequest(value)
    if (request.op === 'status') return options.service.status()
    if (request.op === 'remove') return options.service.remove(window, request.id)
    ensureOwnerCleanup(window, ownerDisposers, options.service)
    return options.service.show(window, request.input, (notificationEvent) => {
      if (!window.isDestroyed()) window.webContents.send(DESKTOP_NOTIFICATION_IPC_CHANNEL, notificationEvent)
    })
  }
  options.ipcMain.handle(DESKTOP_NOTIFICATION_IPC_CHANNEL, handler)
  return () => {
    for (const dispose of ownerDisposers.values()) dispose()
    ownerDisposers.clear()
    options.ipcMain.removeHandler(DESKTOP_NOTIFICATION_IPC_CHANNEL)
  }
}

export function parseDeadlineRequest(value: unknown): DeadlineRequest {
  if (!isRecord(value) || (value.op !== 'arm' && value.op !== 'cancel')) throw new Error('Deadline 请求格式无效')
  if (value.op === 'cancel') return { op: 'cancel', id: parseId(value.id, 'deadline id') }
  if (!isRecord(value.input)) throw new Error('deadline input 无效')
  const id = parseId(value.input.id, 'deadline id')
  if (typeof value.input.fireAt !== 'string' || !/Z$/u.test(value.input.fireAt) || !Number.isFinite(Date.parse(value.input.fireAt))) {
    throw new Error('deadline fireAt 必须是有效 UTC instant')
  }
  return { op: 'arm', input: { id, fireAt: new Date(Date.parse(value.input.fireAt)).toISOString() } }
}

export function parseNotificationRequest(value: unknown): NotificationRequest {
  if (!isRecord(value) || typeof value.op !== 'string') throw new Error('通知请求格式无效')
  if (value.op === 'status') return { op: 'status' }
  if (value.op === 'remove') return { op: 'remove', id: parseId(value.id, '通知 id') }
  if (value.op !== 'show' && value.op !== 'replace') throw new Error('通知 op 无效')
  if (!isRecord(value.input)) throw new Error('通知 input 无效')
  const id = parseId(value.input.id, '通知 id')
  if (typeof value.input.title !== 'string' || value.input.title.trim().length === 0 || value.input.title.length > 256) throw new Error('通知 title 无效')
  if (typeof value.input.body !== 'string' || value.input.body.trim().length === 0 || value.input.body.length > 2048) throw new Error('通知 body 无效')
  const rawActions = value.input.actions
  let actions: DesktopNotificationInput['actions']
  if (rawActions !== undefined) {
    if (!Array.isArray(rawActions) || rawActions.length > 3) throw new Error('通知 actions 无效')
    actions = rawActions.map((action) => {
      if (!isRecord(action)) throw new Error('通知 action 无效')
      return { id: parseId(action.id, '通知 action id', 64), label: parseLabel(action.label) }
    })
  }
  return { op: value.op, input: { id, title: value.input.title, body: value.input.body, ...(actions === undefined ? {} : { actions }) } }
}

function assertTrustedSender(
  event: IpcMainInvokeEvent,
  trusted: ReadonlySet<BrowserWindow>,
  resolveWindow: (contents: WebContents) => BrowserWindow | null,
  ownsWindow: ((window: BrowserWindow) => boolean) | undefined,
): BrowserWindow {
  const window = resolveWindow(event.sender)
  if (window === null || (!trusted.has(window) && !(ownsWindow?.(window) ?? false))) throw new Error('桌面能力 IPC sender 不属于受信窗口')
  return window
}

function ensureOwnerCleanup<T extends { disposeOwner(owner: object): void }>(
  window: BrowserWindow,
  ownerDisposers: Map<BrowserWindow, () => void>,
  service: T,
): void {
  if (ownerDisposers.has(window)) return
  const onClosed = () => {
    service.disposeOwner(window)
    ownerDisposers.delete(window)
  }
  window.once('closed', onClosed)
  ownerDisposers.set(window, () => window.removeListener('closed', onClosed))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseId(value: unknown, label: string, maxLength = 256): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) throw new Error(`${label} 无效`)
  return value.trim()
}

function parseLabel(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 64) throw new Error('通知 action label 无效')
  return value.trim()
}
