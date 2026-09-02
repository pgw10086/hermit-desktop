import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import type { ShortcutRegistry } from './shortcut-registry.js'

/** DSH 主窗口读取 Desktop Core 快捷键目录所用的独立 IPC 通道。 */
export const DESKTOP_SHORTCUT_IPC_CHANNEL = 'hermit:desktop-shortcuts'

type ShortcutRequest =
  | { readonly op: 'list' }
  | { readonly op: 'update'; readonly id: string; readonly accelerator: string }
  | { readonly op: 'reset'; readonly id: string }

/** 只允许快捷键中心需要的三类操作，避免形成通用 IPC 转发器。 */
function parseRequest(value: unknown): ShortcutRequest {
  if (typeof value !== 'object' || value === null) throw new Error('快捷键请求格式无效')
  const request = value as Record<string, unknown>
  if (request.op === 'list') return { op: 'list' }
  if (request.op === 'update') return {
    op: 'update',
    id: nonEmptyString(request.id, 'id'),
    accelerator: nonEmptyString(request.accelerator, 'accelerator'),
  }
  if (request.op === 'reset') return { op: 'reset', id: nonEmptyString(request.id, 'id') }
  throw new Error('快捷键请求操作不支持')
}

/** 只接受非空文本，具体 accelerator 是否受平台支持由 Registry 判断。 */
function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${field} 必须是非空字符串`)
  return value
}

/** 给受信 DSH 主窗口注册快捷键目录 facade，并在目录变化时发送无正文通知。 */
export function registerDesktopShortcutIpc(options: {
  readonly ipcMain: IpcMain
  readonly registry: ShortcutRegistry
  readonly mainWindow: BrowserWindow
  readonly resolveWindow: (contents: WebContents) => BrowserWindow | null
}): () => void {
  const handler = (event: IpcMainInvokeEvent, value: unknown): unknown => {
    const sender = options.resolveWindow(event.sender)
    if (sender !== options.mainWindow) throw new Error('快捷键 IPC sender 不属于受信任的 DSH 主窗口')
    const request = parseRequest(value)
    if (request.op === 'list') return options.registry.list()
    if (request.op === 'update') return options.registry.update(request.id, request.accelerator)
    return options.registry.reset(request.id)
  }
  const unsubscribe = options.registry.subscribe(() => {
    if (!options.mainWindow.isDestroyed()) options.mainWindow.webContents.send(DESKTOP_SHORTCUT_IPC_CHANNEL, { kind: 'changed' })
  })
  options.ipcMain.handle(DESKTOP_SHORTCUT_IPC_CHANNEL, handler)
  return () => {
    unsubscribe()
    options.ipcMain.removeHandler(DESKTOP_SHORTCUT_IPC_CHANNEL)
  }
}
