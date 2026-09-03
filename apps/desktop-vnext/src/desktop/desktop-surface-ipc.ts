import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import type { DesktopSurfaceManager } from '../core/desktop-surface-manager.js'
import {
  DesktopSurfaceError,
  type DesktopSurfaceOpenOptions,
  type DesktopMainSessionResult,
  type DesktopSurfaceResult,
} from '../core/desktop-surface-contract.js'

export const DESKTOP_SURFACE_IPC_CHANNEL = 'hermit:desktop-surface'

type DesktopSurfaceIpcRequest =
  | { readonly op: 'open' | 'toggle'; readonly id: string; readonly options?: DesktopSurfaceOpenOptions }
  | { readonly op: 'resize'; readonly id: string; readonly size: { readonly width: number; readonly height: number } }
  | { readonly op: 'close'; readonly id: string }
  | { readonly op: 'open-main-session'; readonly sessionId: string }
  | { readonly op: 'capabilities' }

/** 为受信 DSH/插件 Renderer 暴露 Surface 的窄 bridge，发送窗口必须由 Core 管理。 */
export function registerDesktopSurfaceIpc(options: {
  readonly ipcMain: IpcMain
  readonly surfaceManager: DesktopSurfaceManager
  readonly openMainSession: (sessionId: string) => Promise<void>
  readonly trustedWindows: readonly BrowserWindow[]
  readonly resolveWindow: (contents: WebContents) => BrowserWindow | null
}): () => void {
  const trusted = new Set(options.trustedWindows)
  const handler = async (event: IpcMainInvokeEvent, value: unknown): Promise<unknown> => {
    const sender = options.resolveWindow(event.sender)
    if (sender === null || (!trusted.has(sender) && !options.surfaceManager.ownsWindow(sender))) {
      throw new Error('Desktop Surface IPC sender 不属于受信窗口')
    }
    const request = parseDesktopSurfaceRequest(value)
    if (request.op === 'capabilities') return options.surfaceManager.capabilities()
    if (request.op === 'open-main-session') {
      try {
        await options.openMainSession(request.sessionId)
        return { status: 'opened', sessionId: request.sessionId } satisfies DesktopMainSessionResult
      } catch (cause) {
        const error = cause instanceof DesktopSurfaceError
          ? cause
          : new DesktopSurfaceError('CAPABILITY_UNAVAILABLE', String(cause))
        return { status: 'unavailable', sessionId: request.sessionId, code: error.code, reason: error.message } satisfies DesktopMainSessionResult
      }
    }
    try {
      if (request.op === 'open') {
        await options.surfaceManager.open(request.id, request.options)
        return { status: 'opened', id: request.id } satisfies DesktopSurfaceResult
      }
      if (request.op === 'toggle') {
        const handle = await options.surfaceManager.toggle(request.id, request.options)
        return { status: handle === null ? 'closed' : 'opened', id: request.id } satisfies DesktopSurfaceResult
      }
      if (request.op === 'resize') {
        options.surfaceManager.resize(request.id, request.size)
        return { status: 'resized', id: request.id } satisfies DesktopSurfaceResult
      }
      await options.surfaceManager.close(request.id)
      return { status: 'closed', id: request.id } satisfies DesktopSurfaceResult
    } catch (cause) {
      const error = cause instanceof DesktopSurfaceError
        ? cause
        : new DesktopSurfaceError('CAPABILITY_UNAVAILABLE', String(cause))
      return { status: 'unavailable', id: request.id, code: error.code, reason: error.message } satisfies DesktopSurfaceResult
    }
  }
  options.ipcMain.handle(DESKTOP_SURFACE_IPC_CHANNEL, handler)
  return () => options.ipcMain.removeHandler(DESKTOP_SURFACE_IPC_CHANNEL)
}

export function parseDesktopSurfaceRequest(value: unknown): DesktopSurfaceIpcRequest {
  if (typeof value !== 'object' || value === null) throw new Error('Desktop Surface 请求格式无效')
  const record = value as Record<string, unknown>
  if (record.op === 'capabilities') return { op: 'capabilities' }
  if (record.op === 'resize') {
    if (typeof record.id !== 'string' || record.id.trim().length === 0 || record.id.length > 128) {
      throw new Error('Desktop Surface id 无效')
    }
    const size = record.size
    if (typeof size !== 'object' || size === null) throw new Error('Desktop Surface size 无效')
    const candidate = size as Record<string, unknown>
    if (!positiveBounded(candidate.width) || !positiveBounded(candidate.height)) throw new Error('Desktop Surface size 超出范围')
    return { op: 'resize', id: record.id.trim(), size: { width: candidate.width as number, height: candidate.height as number } }
  }
  if (record.op !== 'open' && record.op !== 'toggle' && record.op !== 'close') {
    if (record.op !== 'open-main-session') throw new Error('Desktop Surface op 无效')
    const sessionId = record.sessionId
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0 || sessionId.length > 256) {
      throw new Error('Desktop Surface sessionId 无效')
    }
    return { op: 'open-main-session', sessionId: sessionId.trim() }
  }
  if (typeof record.id !== 'string' || record.id.trim().length === 0 || record.id.length > 128) {
    throw new Error('Desktop Surface id 无效')
  }
  if (record.op === 'close') return { op: 'close', id: record.id.trim() }
  return {
    op: record.op,
    id: record.id.trim(),
    ...(record.options === undefined ? {} : { options: parseOpenOptions(record.options) }),
  }
}

function parseOpenOptions(value: unknown): DesktopSurfaceOpenOptions {
  if (typeof value !== 'object' || value === null) throw new Error('Desktop Surface options 无效')
  const record = value as Record<string, unknown>
  const size = record.preferredSize
  let preferredSize: { readonly width: number; readonly height: number } | undefined
  if (size !== undefined) {
    if (typeof size !== 'object' || size === null) throw new Error('Desktop Surface size 无效')
    const candidate = size as Record<string, unknown>
    if (!positiveBounded(candidate.width) || !positiveBounded(candidate.height)) throw new Error('Desktop Surface size 超出范围')
    preferredSize = { width: candidate.width as number, height: candidate.height as number }
  }
  const stringOption = (key: string): string | undefined => {
    const candidate = record[key]
    if (candidate === undefined) return undefined
    if (typeof candidate !== 'string' || candidate.trim().length === 0 || candidate.length > 128) throw new Error(`Desktop Surface ${key} 无效`)
    return candidate.trim()
  }
  const anchor = stringOption('anchor')
  const placement = stringOption('placement')
  const focus = stringOption('focus')
  const alwaysOnTop = record.alwaysOnTop
  if (alwaysOnTop !== undefined && typeof alwaysOnTop !== 'boolean') throw new Error('Desktop Surface alwaysOnTop 无效')
  const session = record.session === undefined ? undefined : parseSession(record.session)
  return {
    ...(anchor === undefined ? {} : { anchor }),
    ...(placement === undefined ? {} : { placement }),
    ...(focus === undefined ? {} : { focus }),
    ...(preferredSize === undefined ? {} : { preferredSize }),
    ...(alwaysOnTop === undefined ? {} : { alwaysOnTop }),
    ...(session === undefined ? {} : { session }),
  }
}

function parseSession(value: unknown): DesktopSurfaceOpenOptions['session'] {
  if (typeof value !== 'object' || value === null) throw new Error('Desktop Surface session 无效')
  const record = value as Record<string, unknown>
  const type = record.type
  if (type !== 'new-on-submit' && type !== 'last-bound' && type !== 'existing') {
    throw new Error('Desktop Surface session.type 无效')
  }
  const sessionId = record.sessionId
  if (type === 'existing') {
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0 || sessionId.length > 256) {
      throw new Error('Desktop Surface sessionId 无效')
    }
    return { type, sessionId: sessionId.trim() }
  }
  if (sessionId !== undefined) throw new Error('Desktop Surface sessionId 只能用于 existing')
  return { type }
}

function positiveBounded(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 64 && value <= 4096
}
