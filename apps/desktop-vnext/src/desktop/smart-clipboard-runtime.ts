import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { globalShortcut, powerMonitor, type BrowserWindow, type IpcMain } from 'electron'
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
  createSmartClipboardQuickPanel,
  showSmartClipboardQuickPanel,
} from './smart-clipboard-quick-panel.js'

const SHORTCUT = 'CommandOrControl+Shift+Space'

interface SmartClipboardDesktopRuntimeOptions {
  readonly userData: string
  readonly mainWindow: BrowserWindow
  readonly actions: NavigationActions
  readonly ipcMain: IpcMain
  readonly isPackaged: boolean
  readonly resourcesPath: string
  readonly appPath: string
  /** 快速面板抢占前台时，桌面壳不能把主窗口作为 activate 的副作用带到前台。 */
  readonly onQuickPanelVisibilityChanged?: (visible: boolean) => void
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

  /** 当前是否已持有捕获、IPC、快捷键和 Quick Panel 资源。 */
  get active(): boolean { return this.#stop !== undefined }

  /** 原子启动 Smart Clipboard 资源；任一步失败都会回收已创建资源。 */
  start(): void {
    if (this.#stop !== undefined) return
    let repository: SqliteClipboardRepository | undefined
    let disposeIpc: (() => void) | undefined
    let quickPanel: BrowserWindow | undefined
    let service: ClipboardCoreService | undefined
    let onLockScreen: (() => void) | undefined
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
      const panel = createSmartClipboardQuickPanel(this.#options.actions)
      quickPanel = panel
      panel.on('show', () => this.#options.onQuickPanelVisibilityChanged?.(true))
      panel.on('hide', () => this.#options.onQuickPanelVisibilityChanged?.(false))
      disposeIpc = registerSmartClipboardIpc({
        ipcMain: this.#options.ipcMain,
        service,
        mainWindow: this.#options.mainWindow,
        quickPanel: panel,
        quickPanelLayout: (input) => configureSmartClipboardQuickPanel(panel, input),
      })
      const shortcutRegistered = globalShortcut.register(SHORTCUT, () => {
        // 先标记再 show，避免 macOS 在 focus 过程中先发 activate，导致主窗口被显示。
        this.#options.onQuickPanelVisibilityChanged?.(true)
        platform.rememberPasteTarget()
        if (quickPanel !== undefined) showSmartClipboardQuickPanel(quickPanel)
      })
      if (!shortcutRegistered) throw new Error(`Smart Clipboard 快捷键注册失败：${SHORTCUT}`)
      onLockScreen = () => {
        quickPanel?.hide()
        this.#options.mainWindow.hide()
      }
      powerMonitor.on('lock-screen', onLockScreen)

      let stopped = false
      this.#stop = () => {
        if (stopped) return
        stopped = true
        service?.stop()
        disposeIpc?.()
        if (onLockScreen !== undefined) powerMonitor.removeListener('lock-screen', onLockScreen)
        if (globalShortcut.isRegistered(SHORTCUT)) globalShortcut.unregister(SHORTCUT)
        if (quickPanel !== undefined && !quickPanel.isDestroyed()) quickPanel.destroy()
        this.#options.onQuickPanelVisibilityChanged?.(false)
        repository?.close()
      }
    } catch (cause) {
      service?.stop()
      disposeIpc?.()
      if (onLockScreen !== undefined) powerMonitor.removeListener('lock-screen', onLockScreen)
      if (globalShortcut.isRegistered(SHORTCUT)) globalShortcut.unregister(SHORTCUT)
      if (quickPanel !== undefined && !quickPanel.isDestroyed()) quickPanel.destroy()
      this.#options.onQuickPanelVisibilityChanged?.(false)
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
