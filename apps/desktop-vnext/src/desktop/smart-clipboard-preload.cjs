const { contextBridge, ipcRenderer } = require('electron')

// preload 只负责把调用转发到受信 IPC channel，不在 Renderer 暴露 Electron API。
const CHANNEL = 'hermit:smart-clipboard'
const invoke = (request) => ipcRenderer.invoke(CHANNEL, request)

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
// 主进程事件只转换为无参数的刷新通知，正文和文件路径不会通过广播事件传递。
ipcRenderer.on('hermit:smart-clipboard:show', () => {
  window.dispatchEvent(new Event('hermit-smart-clipboard-show'))
})
ipcRenderer.on('hermit:smart-clipboard:open-history', () => {
  window.dispatchEvent(new Event('hermit-smart-clipboard-open-history'))
})
