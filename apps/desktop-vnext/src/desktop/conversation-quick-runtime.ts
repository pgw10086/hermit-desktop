import type { DesktopSurfaceManager, ShortcutRegistry } from '@platform/agent-desktop-core'
import type { NavigationActions } from './window-policy.js'
import {
  CONVERSATION_QUICK_SURFACE_ID,
  createConversationApprovalCompanionSurface,
  createConversationQuickSurface,
} from './conversation-quick-panel.js'

/** 对话 Surface 的快捷键；与 Smart Clipboard 使用不同稳定 ID，冲突由 Core 统一处理。 */
export const CONVERSATION_QUICK_SHORTCUT = 'CommandOrControl+Shift+Enter'

export class ConversationQuickRuntime {
  readonly #options: {
    readonly surfaceManager: DesktopSurfaceManager
    readonly shortcutRegistry: ShortcutRegistry
    readonly actions: NavigationActions
  }
  #disposeSurface: (() => void) | undefined
  #disposeApprovalSurface: (() => void) | undefined
  #disposeShortcut: (() => void) | undefined

  constructor(options: {
    readonly surfaceManager: DesktopSurfaceManager
    readonly shortcutRegistry: ShortcutRegistry
    readonly actions: NavigationActions
  }) {
    this.#options = options
  }

  start(): void {
    if (this.#disposeSurface !== undefined) return
    const surface = createConversationQuickSurface(this.#options.actions)
    this.#disposeSurface = this.#options.surfaceManager.register(surface.definition, surface.host)
    const approvalSurface = createConversationApprovalCompanionSurface(this.#options.actions)
    this.#disposeApprovalSurface = this.#options.surfaceManager.register(approvalSurface.definition, approvalSurface.host)
    const registration = this.#options.shortcutRegistry.register({
      id: 'conversation.quick.open',
      pluginId: 'conversation',
      pluginName: '对话',
      commandName: '打开对话小窗',
      defaultAccelerator: CONVERSATION_QUICK_SHORTCUT,
      onTrigger: () => {
        void this.#options.surfaceManager.toggle(CONVERSATION_QUICK_SURFACE_ID).catch((cause: unknown) => {
          console.error(`打开对话小窗失败: ${cause instanceof Error ? cause.message : String(cause)}`)
        })
      },
    })
    this.#disposeShortcut = registration.dispose
  }

  stop(): void {
    this.#disposeShortcut?.()
    this.#disposeShortcut = undefined
    this.#disposeSurface?.()
    this.#disposeSurface = undefined
    this.#disposeApprovalSurface?.()
    this.#disposeApprovalSurface = undefined
  }
}
