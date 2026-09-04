const { contextBridge, ipcRenderer } = require('electron')

const CHANNEL = 'desktop:surface'
const invoke = (request) => ipcRenderer.invoke(CHANNEL, request)

// 对话小窗只拿到 Desktop Core 的 typed surface facade；它没有 Node、Electron 或业务 API。
contextBridge.exposeInMainWorld('hermitDesktopSurface', {
  open: (id, options) => invoke({ op: 'open', id, ...(options === undefined ? {} : { options }) }),
  toggle: (id, options) => invoke({ op: 'toggle', id, ...(options === undefined ? {} : { options }) }),
  resize: (id, size) => invoke({ op: 'resize', id, size }),
  close: (id) => invoke({ op: 'close', id }),
  openMainSession: (sessionId) => invoke({ op: 'open-main-session', sessionId }),
  capabilities: () => invoke({ op: 'capabilities' }),
})
