import type { BrowserWindow, IpcMain } from 'electron'
import type {
  DesktopSurfaceManager,
  ShortcutRegistry,
} from '@tianbuyv/agent-desktop-core'
import type { RuntimeGenerationManager } from '@tianbuyv/dsh-runtime-adapter'
import type { NavigationActions } from '../desktop/window-policy.js'
import { ConversationQuickRuntime } from '../desktop/conversation-quick-runtime.js'
import { SmartClipboardDesktopRuntime } from '../desktop/smart-clipboard-runtime.js'
import { createDshCommand, type DshCommand } from '../runtime/dsh-command.js'
import { ensureBundledPluginProfile } from '../runtime/bundled-plugin-profile.js'
import { ensureSmartClipboardProfile } from '../runtime/smart-clipboard-profile.js'
import { resolveBundledPluginPath } from '../runtime/bundled-plugin-path.js'

/** Hermit 产品层的插件装配参数；不把这些产品选择塞进 Desktop Core。 */
export interface HermitProductCompositionOptions {
  readonly userData: string
  readonly profileHome: string
  readonly workspacePath: string
  readonly mainWindow: BrowserWindow
  readonly actions: NavigationActions
  readonly ipcMain: IpcMain
  readonly isPackaged: boolean
  readonly resourcesPath: string
  readonly appPath: string
  readonly shortcutRegistry: ShortcutRegistry
  readonly surfaceManager: DesktopSurfaceManager
  readonly generationManager?: RuntimeGenerationManager
}

/**
 * Hermit 自己的产品组合层。
 *
 * Desktop Core 只提供平台能力；这里才决定 Hermit 要装配哪些插件、哪些 Surface 以及
 * 哪些插件需要主进程桌面运行单元。新产品可以拥有自己的 composition，而不用复制 Core。
 */
export class HermitProductComposition {
  readonly #options: HermitProductCompositionOptions
  readonly #conversationRuntime: ConversationQuickRuntime
  readonly #clipboardRuntime: SmartClipboardDesktopRuntime

  constructor(options: HermitProductCompositionOptions) {
    this.#options = options
    this.#conversationRuntime = new ConversationQuickRuntime({
      surfaceManager: options.surfaceManager,
      shortcutRegistry: options.shortcutRegistry,
      actions: options.actions,
    })
    this.#clipboardRuntime = new SmartClipboardDesktopRuntime({
      userData: options.userData,
      mainWindow: options.mainWindow,
      actions: options.actions,
      ipcMain: options.ipcMain,
      isPackaged: options.isPackaged,
      resourcesPath: options.resourcesPath,
      appPath: options.appPath,
      shortcutRegistry: options.shortcutRegistry,
      surfaceManager: options.surfaceManager,
    })
  }

  /** 根据当前 DSH generation 重新核验 Hermit 插件，并同步其产品专属运行单元。 */
  syncProfiles(): void {
    this.#syncOrganizerProfile()
    try {
      const profileCommand = this.#profileCommand()
      const smartClipboardPath = this.#pluginPath('@tianbuyv/smart-clipboard')
      const clipboardProfile = ensureSmartClipboardProfile({
        nodeBinary: profileCommand.executable,
        dshEntry: profileCommand.args[1] ?? '',
        profileHome: this.#options.profileHome,
        pluginPath: smartClipboardPath,
        environment: profileCommand.env,
      })

      try {
      const fileWorkspacePath = this.#pluginPath('@tianbuyv/file-workspace')
        const fileWorkspaceProfile = ensureBundledPluginProfile({
          packageName: '@tianbuyv/file-workspace',
          markerName: 'file-workspace',
          nodeBinary: profileCommand.executable,
          dshEntry: profileCommand.args[1] ?? '',
          profileHome: this.#options.profileHome,
          pluginPath: fileWorkspacePath,
          environment: profileCommand.env,
        })
        if (fileWorkspaceProfile.state !== 'active') {
          console.info(`File Workspace ${fileWorkspaceProfile.state}，插件不会挂载到 DSH Product Surface`)
        }
      } catch (cause) {
        console.error(`File Workspace 启动资格检查失败，插件保持不可用: ${errorMessage(cause)}`)
      }

      if (clipboardProfile.state === 'active') this.#clipboardRuntime.start()
      else {
        this.#clipboardRuntime.stop()
        console.info(`Smart Clipboard ${clipboardProfile.state}，已撤销捕获、IPC 和快捷键`)
      }
    } catch (cause) {
      // 可选产品插件不能阻止 DSH Core；资格或原生加载失败时必须 fail closed。
      this.#clipboardRuntime.stop()
      console.error(`Smart Clipboard 启动资格检查失败，插件保持不可用: ${errorMessage(cause)}`)
    }
  }

  /** Organizer 只有 DSH Product Surface，没有额外的主进程运行单元。 */
  #syncOrganizerProfile(): void {
    try {
      const profileCommand = this.#profileCommand()
      const pluginPath = this.#pluginPath('@tianbuyv/organizer')
      const profile = ensureBundledPluginProfile({
        packageName: '@tianbuyv/organizer',
        markerName: 'personal-organizer',
        nodeBinary: profileCommand.executable,
        dshEntry: profileCommand.args[1] ?? '',
        profileHome: this.#options.profileHome,
        pluginPath,
        environment: profileCommand.env,
      })
      if (profile.state !== 'active') {
        console.info(`Personal Organizer ${profile.state}，不会挂载到 DSH Product Surface`)
      }
    } catch (cause) {
      // Organizer 是可选业务插件；制品或公开能力异常时只撤下它自己的入口。
      console.error(`Personal Organizer 启动资格检查失败，插件保持不可用: ${errorMessage(cause)}`)
    }
  }

  /** DSH ready 后启动 Hermit 自己的对话 Surface；Session 仍归 DSH 所有。 */
  startConversation(): void {
    this.#conversationRuntime.start()
  }

  /** DSH 崩溃、停用或应用退出时释放 Hermit 产品层资源。 */
  stop(): void {
    this.#clipboardRuntime.stop()
    this.#conversationRuntime.stop()
  }

  #profileCommand(): DshCommand {
    const activeRuntimeRoot = this.#options.generationManager?.selectStartupGeneration().root
    return createDshCommand({
      isPackaged: this.#options.isPackaged,
      resourcesPath: this.#options.resourcesPath,
      profileHome: this.#options.profileHome,
      workspacePath: this.#options.workspacePath,
      ...(activeRuntimeRoot === undefined ? {} : { runtimeRoot: activeRuntimeRoot }),
    })
  }

  #pluginPath(packageName: string): string {
    const activeRuntimeRoot = this.#options.generationManager?.selectStartupGeneration().root
    return resolveBundledPluginPath({
      packageName,
      isPackaged: this.#options.isPackaged,
      appPath: this.#options.appPath,
      resourcesPath: this.#options.resourcesPath,
      ...(activeRuntimeRoot === undefined ? {} : { runtimeRoot: activeRuntimeRoot }),
    })
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
