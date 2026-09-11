import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { powerMonitor, type BrowserWindow, type IpcMain } from 'electron'
import type { ShortcutRegistry, DesktopSurfaceCloseOptions, DesktopSurfaceManager } from '@tianbuyv/agent-desktop-core'
import { ElectronClipboardBridge } from '../core/smart-clipboard/electron-bridge.js'
import { registerSmartClipboardIpc } from '../core/smart-clipboard/ipc.js'
import {
  loadMacClipboardNativeBridge,
  macClipboardNativeModulePath,
} from '../core/smart-clipboard/macos-native-bridge.js'
import { ClipboardCoreService } from '../core/smart-clipboard/service.js'
import { SmartClipboardSettingsStore } from '../core/smart-clipboard/settings.js'
import { SqliteClipboardRepository } from '../core/smart-clipboard/sqlite-repository.js'
import type { NavigationActions } from './window-policy.js'
import {
  configureSmartClipboardQuickPanel,
  createSmartClipboardQuickPanelSurface,
  SMART_CLIPBOARD_SURFACE_ID,
} from './smart-clipboard-quick-panel.js'
import { QUICK_PANEL_SHORTCUT } from './system-integration.js'

interface SmartClipboardDesktopRuntimeOptions {
  readonly userData: string
  readonly mainWindow: BrowserWindow
  readonly actions: NavigationActions
  readonly ipcMain: IpcMain
  readonly isPackaged: boolean
  readonly resourcesPath: string
  readonly appPath: string
  /** Desktop Core 的唯一快捷键注册入口。 */
  readonly shortcutRegistry: ShortcutRegistry
  /** Desktop Core 的统一 Surface 宿主。 */
  readonly surfaceManager: DesktopSurfaceManager
}

/**
 * Smart Clipboard 的桌面资源统一由该运行单元持有，DSH profile 进入非 ACTIVE 状态时可以
 * 一次撤掉捕获、IPC、浮层和快捷键，同时不碰 userData 中的 Canonical 历史。
 */
export class SmartClipboardDesktopRuntime {
  readonly #options: SmartClipboardDesktopRuntimeOptions
  #stop: (() => void) | undefined

  constructor(options: SmartClipboardDesktopRuntimeOptions) {
    this.#options = options
  }

  /** 当前是否已持有捕获、IPC 和 Quick Panel 资源。快捷键冲突不影响该状态。 */
  get active(): boolean { return this.#stop !== undefined }

  /** 原子启动 Smart Clipboard 资源；任一步失败都会回收已创建资源。 */
  start(): void {
    if (this.#stop !== undefined) return
    let repository: SqliteClipboardRepository | undefined
    let disposeIpc: (() => void) | undefined
    let quickPanel: BrowserWindow | undefined
    let disposeSurface: (() => void) | undefined
    let service: ClipboardCoreService | undefined
    let onLockScreen: (() => void) | undefined
    let disposeShortcut: (() => void) | undefined
    try {
      const platform = new ElectronClipboardBridge(
        process.platform === 'darwin'
          ? loadMacClipboardNativeBridge(macClipboardNativeModulePath({
              isPackaged: this.#options.isPackaged,
              resourcesPath: this.#options.resourcesPath,
              appPath: this.#options.appPath,
            }))
          : undefined,
      )
      repository = new SqliteClipboardRepository(path.join(this.#options.userData, 'smart-clipboard', 'history.sqlite'))
      const settings = new SmartClipboardSettingsStore(path.join(this.#options.userData, 'smart-clipboard', 'settings.json'))
      service = new ClipboardCoreService(repository, platform, {
        ...settings.read(),
        idFactory: randomUUID,
        onSettingsChanged: (value) => settings.write(value),
      })
      settings.write(service.settings())
      service.start()
      const surface = createSmartClipboardQuickPanelSurface(this.#options.actions)
      disposeSurface = this.#options.surfaceManager.register(surface.definition, surface.host)
      const panel = this.#options.surfaceManager.windowFor(SMART_CLIPBOARD_SURFACE_ID)
      quickPanel = panel
      disposeIpc = registerSmartClipboardIpc({
        ipcMain: this.#options.ipcMain,
        service,
        mainWindow: this.#options.mainWindow,
        quickPanel: panel,
        closeQuickPanel: (closeOptions?: DesktopSurfaceCloseOptions) => this.#options.surfaceManager.close(SMART_CLIPBOARD_SURFACE_ID, closeOptions),
        openQuickPanel: async () => { await this.#options.surfaceManager.open(SMART_CLIPBOARD_SURFACE_ID) },
        quickPanelLayout: (input) => configureSmartClipboardQuickPanel(panel, input),
      })
      const shortcut = this.#options.shortcutRegistry.register({
        id: 'smart-clipboard.open',
        pluginId: 'smart-clipboard',
        pluginName: 'Smart Clipboard',
        commandName: '打开剪贴板快速取回',
        defaultAccelerator: QUICK_PANEL_SHORTCUT,
        onTrigger: () => {
          // 只为用户随后明确选择的 paste 保留原应用；普通 copy 会在 Core 中清理它。
          platform.rememberPasteTarget()
          void this.#options.surfaceManager.open(SMART_CLIPBOARD_SURFACE_ID).catch((cause: unknown) => {
            console.error(`Smart Clipboard 快速取回 Surface 打开失败: ${errorMessage(cause)}`)
          })
        },
      })
      disposeShortcut = shortcut.dispose
      onLockScreen = () => {
        void this.#options.surfaceManager.close(SMART_CLIPBOARD_SURFACE_ID, { disposition: 'keep-current' }).catch(() => undefined)
        this.#options.mainWindow.hide()
      }
      powerMonitor.on('lock-screen', onLockScreen)

      let stopped = false
      this.#stop = () => {
        if (stopped) return
        stopped = true
        disposeShortcut?.()
        service?.stop()
        disposeIpc?.()
        if (onLockScreen !== undefined) powerMonitor.removeListener('lock-screen', onLockScreen)
        disposeSurface?.()
        repository?.close()
      }
    } catch (cause) {
      service?.stop()
      disposeShortcut?.()
      disposeIpc?.()
      if (onLockScreen !== undefined) powerMonitor.removeListener('lock-screen', onLockScreen)
      disposeSurface?.()
      repository?.close()
      throw cause
    }
  }

  /** 停止并释放该运行单元持有的全部资源，重复调用保持幂等。 */
  stop(): void {
    const stop = this.#stop
    this.#stop = undefined
    stop?.()
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
