import { BrowserWindow, dialog, nativeImage, Notification, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import type { DesktopSurfaceCloseOptions } from '@platform/agent-desktop-core'
import type { ClipboardEntry } from '@hermit/smart-clipboard/domain'
import type { ClipboardCoreService } from './service.js'
import { parseRequest, type ClipboardWireEntry, type SmartClipboardRequest } from './ipc-contract.js'

export { parseRequest } from './ipc-contract.js'
export type { ClipboardWireEntry, SmartClipboardRequest } from './ipc-contract.js'

/** 主窗口、Quick Panel 与主进程共用的 Smart Clipboard IPC 通道。 */
export const SMART_CLIPBOARD_IPC_CHANNEL = 'hermit:smart-clipboard'

export interface SmartClipboardQuickPanelLayout {
  /** Quick Panel 需要展示的历史行数。 */
  readonly rows: number
  /** 是否打开右侧预览。 */
  readonly previewOpen: boolean
}

/** 注册受信窗口的 Smart Clipboard IPC，并在返回 disposer 时撤销监听。 */
export function registerSmartClipboardIpc(options: {
  /** Electron IPC 主进程入口。 */
  readonly ipcMain: IpcMain
  /** Core 领域服务。 */
  readonly service: ClipboardCoreService
  /** 主窗口，只接受来自受信窗口集合的请求。 */
  readonly mainWindow: BrowserWindow
  /** Quick Panel 窗口。 */
  readonly quickPanel: BrowserWindow
  /** 通过 Desktop Surface Manager 关闭 Quick Panel，避免绕过生命周期保护。 */
  readonly closeQuickPanel: (options?: DesktopSurfaceCloseOptions) => Promise<void>
  /** 通过 Desktop Surface Manager 重开 Quick Panel，确保 activate 看到 opening 状态。 */
  readonly openQuickPanel: () => Promise<void>
  /** 调整 Quick Panel 布局的宿主能力。 */
  readonly quickPanelLayout: (input: SmartClipboardQuickPanelLayout) => { readonly placement: 'left' | 'right' }
}): () => void {
  const windows = new Set<BrowserWindow>([options.mainWindow, options.quickPanel])
  /** 向仍存活的受信窗口广播状态变化。 */
  const notify = (): void => {
    for (const window of windows) {
      if (!window.isDestroyed()) window.webContents.send(SMART_CLIPBOARD_IPC_CHANNEL, { kind: 'changed' })
    }
  }
  const unsubscribe = options.service.subscribe(notify)
  /** 校验发送窗口和请求后分派到唯一 Core service。 */
  const handler = async (event: IpcMainInvokeEvent, value: unknown): Promise<unknown> => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (senderWindow === null || !windows.has(senderWindow)) {
      throw new Error('Smart Clipboard IPC sender 不属于受信任窗口')
    }
    const request: SmartClipboardRequest = parseRequest(value)
    if (request.op === 'list') return options.service.list(request.filter).map(toWireEntry)
    if (request.op === 'trash') return options.service.trash().map(toWireEntry)
    if (request.op === 'settings') return options.service.settings()
    if (request.op === 'status') return options.service.status()
    if (request.op === 'execute') {
      // 只有显式 paste 需要先让出 Quick Panel 的焦点；普通 copy 保持面板可见，
      // 等系统剪贴板写入成功后由 Renderer 关闭，失败时用户还能继续处理。
      const quickPaste = request.source === 'quick-panel' && request.action === 'paste'
      if (quickPaste) await options.closeQuickPanel({ disposition: 'external-handoff' })
      const result = await options.service.execute(request.id, request.action)
      if (quickPaste && result.status === 'unavailable') {
        await options.openQuickPanel()
      }
      if (request.source === 'quick-panel' && result.status === 'copy-only' && Notification.isSupported()) {
        new Notification({ title: 'Smart Clipboard', body: `已复制，请手工粘贴：${result.reason}` }).show()
      }
      return result
    }
    if (request.op === 'set-pinned') return mapOptional(options.service.setPinned(request.id, request.pinned))
    if (request.op === 'move-to-trash') return mapOptional(options.service.moveToTrash(request.id))
    if (request.op === 'restore') return mapOptional(options.service.restore(request.id))
    if (request.op === 'permanently-delete') return options.service.permanentlyDelete(request.id)
    if (request.op === 'clear-history') return options.service.clearHistory()
    if (request.op === 'empty-trash') return options.service.emptyTrash()
    if (request.op === 'clear-all-data') return options.service.clearAllData()
    if (request.op === 'ignore-next') { options.service.ignoreNext(); return undefined }
    if (request.op === 'set-paused') { options.service.setPaused(request.paused); return undefined }
    if (request.op === 'update-settings') {
      options.service.setHistoryLimit(request.historyLimit)
      options.service.setTotalBytes(request.totalBytes)
      options.service.setRetention(request.retention)
      options.service.setActionMapping(request.actionMapping)
      options.service.setExclusions(request.excludedApplications, request.excludedKinds)
      return options.service.settings()
    }
    if (request.op === 'set-quick-panel-layout') {
      if (senderWindow !== options.quickPanel) throw new Error('快速取回布局只能由快速取回窗口请求')
      return options.quickPanelLayout(request)
    }
    if (request.op === 'open-history') {
      await options.closeQuickPanel({ disposition: 'external-handoff' })
      options.mainWindow.show()
      options.mainWindow.focus()
      options.mainWindow.webContents.send('hermit:smart-clipboard:open-history')
      return undefined
    }
    if (request.op === 'close-quick-panel') { await options.closeQuickPanel(); return undefined }
    const result = await dialog.showSaveDialog(options.mainWindow, {
      title: '导出剪贴板历史',
      defaultPath: 'smart-clipboard-export.zip',
      filters: [{ name: 'Smart Clipboard ZIP', extensions: ['zip'] }],
    })
    if (result.canceled || result.filePath === undefined) return { status: 'unavailable', reason: '用户取消导出' }
    return { status: 'exported', path: options.service.exportData(result.filePath, request.includeTrash) }
  }
  options.ipcMain.handle(SMART_CLIPBOARD_IPC_CHANNEL, handler)
  return () => {
    unsubscribe()
    options.ipcMain.removeHandler(SMART_CLIPBOARD_IPC_CHANNEL)
  }
}

/** 将 Core 记录转换为不暴露图片原始字节的 Renderer 投影。 */
function toWireEntry(entry: ClipboardEntry): ClipboardWireEntry {
  if (entry.kind !== 'IMAGE') return entry
  return {
    id: entry.id,
    kind: 'IMAGE',
    previewUrl: imagePreviewUrl(entry.bytes, entry.width, entry.height),
    width: entry.width,
    height: entry.height,
    hasAlpha: entry.hasAlpha,
    sourceApplication: entry.sourceApplication,
    createdAt: entry.createdAt,
    lastUsedAt: entry.lastUsedAt,
    pinned: entry.pinned,
    state: entry.state,
    byteSize: entry.byteSize,
  }
}

/** 生成受限尺寸的 data URL 预览，避免把原始图片字节直接交给 Renderer。 */
function imagePreviewUrl(bytes: Uint8Array, width: number, height: number): string {
  const image = nativeImage.createFromBuffer(Buffer.from(bytes))
  if (image.isEmpty()) return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`
  const maxDimension = 320
  const scale = Math.min(1, maxDimension / Math.max(width, height))
  const preview = scale < 1
    ? image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) })
    : image
  return `data:image/png;base64,${Buffer.from(preview.toPNG()).toString('base64')}`
}

/** 将可选 Core 记录映射为可选安全投影。 */
function mapOptional(entry: ClipboardEntry | undefined): ClipboardWireEntry | undefined {
  return entry === undefined ? undefined : toWireEntry(entry)
}
