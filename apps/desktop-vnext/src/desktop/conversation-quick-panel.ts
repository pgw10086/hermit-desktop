import type { DesktopSurfaceHostDefinition, DesktopSurfaceDefinition, DesktopSurfaceOpenOptions } from '@platform/desktop-core'
import { screen, type BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import type { NavigationActions } from './window-policy.js'
import { installNavigationPolicy } from './window-policy.js'
import { hardenedWebPreferences } from './window-options.js'

export const CONVERSATION_QUICK_SURFACE_ID = 'conversation.quick'
export const APPROVAL_COMPANION_SURFACE_ID = 'approval.companion'
export const CONVERSATION_QUICK_COMPOSER_SIZE = { width: 560, height: 120 } as const
export const CONVERSATION_QUICK_CHAT_SIZE = { width: 600, height: 440 } as const
export const APPROVAL_COMPANION_SIZE = { width: 380, height: 240 } as const

/**
 * 对话小窗使用独立的轻量页面，但复用 DSH 的正式连接、Session、Tool 和 Approval 链路；这里
 * 只负责把页面放进 Desktop Surface 宿主，不复制一套模型调用或消息存储。
 */
export function createConversationQuickSurface(
  actions: NavigationActions,
): { readonly definition: DesktopSurfaceDefinition; readonly host: DesktopSurfaceHostDefinition } {
  return {
    definition: {
      id: CONVERSATION_QUICK_SURFACE_ID,
      kind: 'conversation.quick',
      content: { type: 'dsh-conversation', viewId: 'dsh.conversation', contract: 1 },
      window: {
        chrome: 'none',
        movable: 'allowed',
        resizable: false,
        alwaysOnTop: false,
        anchor: 'screen-center',
        placement: 'center',
        preferredSize: CONVERSATION_QUICK_COMPOSER_SIZE,
        minSize: { width: 420, height: 96 },
        maxSize: { width: 760, height: 720 },
        focus: 'activate',
        escape: 'hide',
        blur: 'keep',
        rememberPosition: true,
      },
      session: { type: 'new-on-submit' },
    },
    host: {
      window: {
        title: 'Hermit 对话',
        width: CONVERSATION_QUICK_COMPOSER_SIZE.width,
        height: CONVERSATION_QUICK_COMPOSER_SIZE.height,
        frame: false,
        minWidth: 420,
        minHeight: 96,
        resizable: false,
        maximizable: false,
        minimizable: false,
        show: false,
        skipTaskbar: true,
        alwaysOnTop: false,
        backgroundColor: '#202124',
        autoHideMenuBar: true,
        webPreferences: {
          ...hardenedWebPreferences(),
          preload: fileURLToPath(new URL('./conversation-quick-preload.cjs', import.meta.url)),
        },
      },
      hideOnBlur: false,
      position: (window) => { positionConversationQuickSurface(window) },
      load: async (window, options: DesktopSurfaceOpenOptions) => {
        const origin = actions.getDshOrigin()
        if (origin === undefined) throw new Error('DSH Web 尚未就绪')
        installNavigationPolicy(window, actions)
        const url = new URL(origin)
        url.searchParams.set('hermitSurface', 'conversation.quick')
        const sessionId = options.session?.type === 'existing' ? options.session.sessionId : undefined
        if (sessionId !== undefined) url.searchParams.set('sessionId', sessionId)
        if (options.session?.type === 'new-on-submit') url.searchParams.set('hermitNewSession', '1')
        await window.loadURL(url.href)
      },
    },
  }
}

/** 独立审批伴随窗口：展示与回答审批，但不把确认框嵌入 Quick 对话布局。 */
export function createConversationApprovalCompanionSurface(
  actions: NavigationActions,
): { readonly definition: DesktopSurfaceDefinition; readonly host: DesktopSurfaceHostDefinition } {
  return {
    definition: {
      id: APPROVAL_COMPANION_SURFACE_ID,
      kind: 'approval.companion',
      content: { type: 'dsh-conversation', viewId: 'dsh.approval-companion', contract: 1 },
      window: {
        chrome: 'none',
        movable: 'allowed',
        resizable: false,
        alwaysOnTop: true,
        anchor: 'surface:conversation.quick',
        placement: 'adjacent',
        preferredSize: APPROVAL_COMPANION_SIZE,
        minSize: { width: 320, height: 180 },
        maxSize: { width: 520, height: 360 },
        focus: 'activate',
        escape: 'close',
        blur: 'keep',
        rememberPosition: false,
        rememberSize: false,
      },
      session: { type: 'existing' },
    },
    host: {
      window: {
        title: 'Hermit 审批',
        width: APPROVAL_COMPANION_SIZE.width,
        height: APPROVAL_COMPANION_SIZE.height,
        frame: false,
        minWidth: 320,
        minHeight: 180,
        maxWidth: 520,
        maxHeight: 360,
        resizable: false,
        maximizable: false,
        minimizable: false,
        show: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        backgroundColor: '#202124',
        autoHideMenuBar: true,
        webPreferences: {
          ...hardenedWebPreferences(),
          preload: fileURLToPath(new URL('./conversation-quick-preload.cjs', import.meta.url)),
        },
      },
      hideOnBlur: false,
      position: (window) => { positionApprovalCompanionSurface(window) },
      load: async (window, options: DesktopSurfaceOpenOptions) => {
        const origin = actions.getDshOrigin()
        if (origin === undefined) throw new Error('DSH Web 尚未就绪')
        installNavigationPolicy(window, actions)
        const url = new URL(origin)
        url.searchParams.set('hermitSurface', 'approval.companion')
        const sessionId = options.session?.type === 'existing' ? options.session.sessionId : undefined
        if (sessionId !== undefined) url.searchParams.set('sessionId', sessionId)
        await window.loadURL(url.href)
      },
    },
  }
}

/** 首次打开时把 Quick 放到当前指针所在屏幕的工作区中央；重开时由 Core 记忆位置接管。 */
export function positionConversationQuickSurface(window: BrowserWindow): void {
  positionInWorkArea(window, (workArea, bounds) => ({
    x: workArea.x + Math.round((workArea.width - bounds.width) / 2),
    y: workArea.y + Math.round((workArea.height - bounds.height) / 2),
  }))
}

/** Approval companion 默认贴近屏幕中央偏右，避免覆盖 Quick 的输入区。 */
export function positionApprovalCompanionSurface(window: BrowserWindow): void {
  positionInWorkArea(window, (workArea, bounds) => ({
    x: workArea.x + Math.round(workArea.width / 2) + 296,
    y: workArea.y + Math.round((workArea.height - bounds.height) / 2),
  }))
}

function positionInWorkArea(
  window: BrowserWindow,
  resolve: (workArea: Electron.Rectangle, bounds: Electron.Rectangle) => { readonly x: number; readonly y: number },
): void {
  if (window.isDestroyed()) return
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const workArea = display.workArea
  const bounds = window.getBounds()
  const position = resolve(workArea, bounds)
  const x = Math.max(workArea.x + 8, Math.min(position.x, workArea.x + workArea.width - bounds.width - 8))
  const y = Math.max(workArea.y + 8, Math.min(position.y, workArea.y + workArea.height - bounds.height - 8))
  window.setPosition(x, y)
}
