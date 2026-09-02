const { contextBridge, ipcRenderer } = require('electron')

// preload 只负责把调用转发到受信 IPC channel，不在 Renderer 暴露 Electron API。
const CHANNEL = 'hermit:smart-clipboard'
const invoke = (request) => ipcRenderer.invoke(CHANNEL, request)
const SURFACE_CHANNEL = 'hermit:desktop-surface'
const surfaceInvoke = (request) => ipcRenderer.invoke(SURFACE_CHANNEL, request)
const SHORTCUT_CHANNEL = 'hermit:desktop-shortcuts'
const shortcutInvoke = (request) => ipcRenderer.invoke(SHORTCUT_CHANNEL, request)
const DEADLINE_CHANNEL = 'hermit:desktop-deadlines'
const deadlineInvoke = (request) => ipcRenderer.invoke(DEADLINE_CHANNEL, request)
const NOTIFICATION_CHANNEL = 'hermit:desktop-notifications'
const notificationInvoke = (request) => ipcRenderer.invoke(NOTIFICATION_CHANNEL, request)

// 每个方法对应一个已声明的 Smart Clipboard operation，参数校验在主进程完成。
const bridge = {
  list: (filter) => invoke({ op: 'list', ...(filter === undefined ? {} : { filter }) }),
  trash: () => invoke({ op: 'trash' }),
  settings: () => invoke({ op: 'settings' }),
  status: () => invoke({ op: 'status' }),
  execute: (id, action, source = 'history') => invoke({ op: 'execute', id, action, source }),
  setPinned: (id, pinned) => invoke({ op: 'set-pinned', id, pinned }),
  moveToTrash: (id) => invoke({ op: 'move-to-trash', id }),
  restore: (id) => invoke({ op: 'restore', id }),
  permanentlyDelete: (id) => invoke({ op: 'permanently-delete', id }),
  clearHistory: () => invoke({ op: 'clear-history' }),
  emptyTrash: () => invoke({ op: 'empty-trash' }),
  clearAllData: () => invoke({ op: 'clear-all-data' }),
  ignoreNext: () => invoke({ op: 'ignore-next' }),
  setPaused: (paused) => invoke({ op: 'set-paused', paused }),
  updateSettings: (input) => invoke({ op: 'update-settings', ...input }),
  exportData: (includeTrash) => invoke({ op: 'export', includeTrash }),
  setQuickPanelLayout: (input) => invoke({ op: 'set-quick-panel-layout', rows: input.rows, previewOpen: input.previewOpen }),
  openHistory: () => { void invoke({ op: 'open-history' }) },
  closeQuickPanel: () => { void invoke({ op: 'close-quick-panel' }) },
  observe: (listener) => {
    const handler = (_event, value) => {
      if (value && value.kind === 'changed') listener()
    }
    ipcRenderer.on(CHANNEL, handler)
    return () => ipcRenderer.removeListener(CHANNEL, handler)
  },
}

contextBridge.exposeInMainWorld('hermitSmartClipboard', bridge)
// Desktop Surface 只暴露语义化生命周期动作；窗口句柄、Electron IPC 和原生对象留在 Core。
contextBridge.exposeInMainWorld('hermitDesktopSurface', {
  open: (id, options) => surfaceInvoke({ op: 'open', id, ...(options === undefined ? {} : { options }) }),
  toggle: (id, options) => surfaceInvoke({ op: 'toggle', id, ...(options === undefined ? {} : { options }) }),
  resize: (id, size) => surfaceInvoke({ op: 'resize', id, size }),
  close: (id) => surfaceInvoke({ op: 'close', id }),
  openMainSession: (sessionId) => surfaceInvoke({ op: 'open-main-session', sessionId }),
  capabilities: () => surfaceInvoke({ op: 'capabilities' }),
})
// 快捷键中心只暴露 Core 的目录读写面，不复用 Smart Clipboard 业务 facade。
contextBridge.exposeInMainWorld('hermitDesktopShortcuts', {
  list: () => shortcutInvoke({ op: 'list' }),
  update: (id, accelerator) => shortcutInvoke({ op: 'update', id, accelerator }),
  reset: (id) => shortcutInvoke({ op: 'reset', id }),
  observe: (listener) => {
    const handler = (_event, value) => {
      if (value && value.kind === 'changed') listener()
    }
    ipcRenderer.on(SHORTCUT_CHANNEL, handler)
    return () => ipcRenderer.removeListener(SHORTCUT_CHANNEL, handler)
  },
})
// Organizer 只提交绝对 UTC 时刻；Core 不理解 Reminder、重复或业务状态。
contextBridge.exposeInMainWorld('hermitDesktopDeadlines', {
  arm: (input) => deadlineInvoke({ op: 'arm', input }),
  cancel: (id) => deadlineInvoke({ op: 'cancel', id }),
  observe: (listener) => {
    const handler = (_event, value) => {
      if (value && value.kind === 'fired') listener(value)
    }
    ipcRenderer.on(DEADLINE_CHANNEL, handler)
    return () => ipcRenderer.removeListener(DEADLINE_CHANNEL, handler)
  },
})
// Notification facade 只接收安全摘要和有限动作，不暴露 Electron Notification 对象。
contextBridge.exposeInMainWorld('hermitDesktopNotifications', {
  status: () => notificationInvoke({ op: 'status' }),
  show: (input) => notificationInvoke({ op: 'show', input }),
  replace: (input) => notificationInvoke({ op: 'replace', input }),
  remove: (id) => notificationInvoke({ op: 'remove', id }),
  observe: (listener) => {
    const handler = (_event, value) => {
      if (value && (value.kind === 'clicked' || value.kind === 'action' || value.kind === 'failed')) listener(value)
    }
    ipcRenderer.on(NOTIFICATION_CHANNEL, handler)
    return () => ipcRenderer.removeListener(NOTIFICATION_CHANNEL, handler)
  },
})
// 主进程事件只转换为无参数的刷新通知，正文和文件路径不会通过广播事件传递。
ipcRenderer.on('hermit:smart-clipboard:show', () => {
  window.dispatchEvent(new Event('hermit-smart-clipboard-show'))
})
ipcRenderer.on('hermit:smart-clipboard:open-history', () => {
  window.dispatchEvent(new Event('hermit-smart-clipboard-open-history'))
})
