import type { DesktopSurfaceHostDefinition } from '../core/desktop-surface-manager.js'
import type { DesktopSurfaceDefinition, DesktopSurfaceOpenOptions } from '../core/desktop-surface-contract.js'
import { fileURLToPath } from 'node:url'
import type { NavigationActions } from './window-policy.js'
import { installNavigationPolicy } from './window-policy.js'
import { hardenedWebPreferences } from './window-options.js'

export const CONVERSATION_QUICK_SURFACE_ID = 'conversation.quick'
export const CONVERSATION_QUICK_COMPOSER_SIZE = { width: 720, height: 200 } as const
export const CONVERSATION_QUICK_CHAT_SIZE = { width: 720, height: 620 } as const

/**
 * 第一版对话小窗复用 DSH Web 的正式连接、Session、Tool 和 Approval 链路；这里仅负责把它
 * 放进 Desktop Surface 宿主，不复制一套模型调用或消息存储。
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
        anchor: 'screen-center',
        placement: 'center',
        preferredSize: CONVERSATION_QUICK_COMPOSER_SIZE,
        focus: 'activate',
        topmost: false,
      },
      session: { type: 'new-on-submit' },
    },
    host: {
      window: {
        title: 'Hermit 对话',
        width: 720,
        height: 620,
        frame: false,
        minWidth: 520,
        minHeight: 180,
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
