import type {
  DesktopFocusLease,
  DesktopFocusPort,
  DesktopFocusRestoreResult,
} from '@tianbuyv/agent-desktop-core'
import {
  loadMacClipboardNativeBridge,
  macClipboardNativeModulePath,
  type MacApplicationIdentity,
  type MacClipboardNativeBridge,
} from '../core/smart-clipboard/macos-native-bridge.js'

interface HermitFocusPortOptions {
  readonly isPackaged: boolean
  readonly resourcesPath: string
  readonly appPath: string
  /** 只记录 adapter 加载失败，不改变 Surface 是否可用。 */
  readonly onUnavailable?: (reason: string) => void
}

/**
 * Hermit 的平台焦点适配器。Core 只持有这份一次性 lease，不理解 macOS 应用身份或剪贴板业务。
 * 原生模块按需加载，Smart Clipboard 停用时不会为了捕获历史而重复打开另一套窗口状态。
 */
export function createHermitFocusPort(options: HermitFocusPortOptions): DesktopFocusPort {
  let attempted = false
  let native: MacClipboardNativeBridge | undefined
  return {
    capture: () => {
      if (process.platform !== 'darwin') return undefined
      native ??= loadNativeOnce()
      if (native === undefined) return undefined
      const target = native.captureFrontmostApplication()
      if (target === undefined || target.pid === process.pid) return undefined
      return createLease(native, target)
    },
  }

  function loadNativeOnce(): MacClipboardNativeBridge | undefined {
    if (attempted) return native
    attempted = true
    try {
      return loadMacClipboardNativeBridge(macClipboardNativeModulePath(options))
    } catch (cause) {
      options.onUnavailable?.(cause instanceof Error ? cause.message : String(cause))
      return undefined
    }
  }
}

function createLease(native: MacClipboardNativeBridge, target: MacApplicationIdentity): DesktopFocusLease {
  let disposed = false
  return {
    restore: async (): Promise<DesktopFocusRestoreResult> => {
      if (disposed) return { status: 'unavailable', reason: '焦点租约已经释放' }
      const result = native.requestActivate(target)
      return result.status === 'requested'
        ? { status: 'restored' }
        : { status: 'unavailable', reason: result.reason }
    },
    dispose: () => { disposed = true },
  }
}
