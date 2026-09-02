const { contextBridge } = require('electron')

const now = Date.now()
const state = { actions: [], closeCount: 0, openHistoryCount: 0 }
const entries = [
  {
    id: 'text-release', kind: 'TEXT', text: 'Release checklist: verify package, smoke test, publish notes.',
    sourceApplication: 'Code', createdAt: now - 3000, lastUsedAt: now - 3000,
    pinned: true, state: 'history', byteSize: 64,
  },
  {
    id: 'image-review', kind: 'IMAGE',
    previewUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    width: 1440, height: 900, hasAlpha: false, sourceApplication: 'Sketch',
    createdAt: now - 2000, lastUsedAt: now - 2000, pinned: false, state: 'history', byteSize: 2048,
  },
  {
    id: 'files-plan', kind: 'FILE_LIST', sourceApplication: 'Finder',
    createdAt: now - 1000, lastUsedAt: now - 1000, pinned: false, state: 'history', byteSize: 256,
    items: [
      { displayName: 'roadmap.md', path: '/Project/roadmap.md', itemType: 'file', exists: true, sizeBytes: 1024 },
      { displayName: 'obsolete.txt', path: '/Project/obsolete.txt', itemType: 'file', exists: false },
    ],
  },
]

const api = {
  list: async () => entries,
  trash: async () => [],
  settings: async () => ({
    historyLimit: 100,
    totalBytes: 1024 * 1024 * 1024,
    retention: 'forever',
    paused: false,
    actionMapping: { Enter: 'copy', 'Mod+Enter': 'paste', 'Shift+Enter': 'plain-text' },
    excludedApplications: [],
    excludedKinds: [],
  }),
  status: async () => ({ state: 'recording' }),
  execute: async (id, action, source) => {
    state.actions.push({ id, action, source })
    return { status: 'unavailable', reason: 'fixture keeps the panel open' }
  },
  setPinned: async () => undefined,
  moveToTrash: async () => undefined,
  restore: async () => undefined,
  permanentlyDelete: async () => false,
  clearHistory: async () => 0,
  emptyTrash: async () => 0,
  clearAllData: async () => 0,
  ignoreNext: async () => undefined,
  setPaused: async () => undefined,
  updateSettings: async (input) => ({ ...input, paused: false }),
  exportData: async () => ({ status: 'unavailable', reason: 'fixture' }),
  setQuickPanelLayout: async () => ({ placement: 'right' }),
  openHistory: () => { state.openHistoryCount += 1 },
  closeQuickPanel: () => { state.closeCount += 1 },
  observe: () => () => undefined,
}

contextBridge.exposeInMainWorld('hermitSmartClipboard', api)
contextBridge.exposeInMainWorld('hermitQuickRetrievalTest', {
  state: () => structuredClone(state),
})
