import assert from 'node:assert/strict'
import test from 'node:test'
import { registerDesktopDeadlineIpc, registerDesktopNotificationIpc, parseDeadlineRequest, parseNotificationRequest } from '../lib/core/desktop-capability-ipc.js'

test('能力 IPC 解析 UTC deadline 和有限通知动作', () => {
  assert.deepEqual(parseDeadlineRequest({ op: 'arm', input: { id: 'occ-1', fireAt: '2026-09-02T00:00:00.000Z' } }), {
    op: 'arm', input: { id: 'occ-1', fireAt: '2026-09-02T00:00:00.000Z' },
  })
  assert.deepEqual(parseNotificationRequest({
    op: 'show', input: { id: 'occ-1', title: '个人事项', body: '吃饭', actions: [{ id: 'open', label: '打开' }] },
  }), {
    op: 'show', input: { id: 'occ-1', title: '个人事项', body: '吃饭', actions: [{ id: 'open', label: '打开' }] },
  })
  assert.throws(() => parseDeadlineRequest({ op: 'arm', input: { id: 'occ-1', fireAt: '2026-09-02T08:00:00' } }), /UTC instant/u)
  assert.throws(() => parseNotificationRequest({ op: 'show', input: { id: 'occ-1', title: 'x', body: 'x', actions: [{ id: 'x', label: 'x' }, { id: 'y', label: 'y' }, { id: 'z', label: 'z' }, { id: 'w', label: 'w' }] } }), /actions 无效/u)
})

test('能力 IPC 只允许受信窗口，并把 fire/event 发回原窗口', async () => {
  const main = createWindow('main')
  const other = createWindow('other')
  const calls = []
  const ipcMain = {
    handlers: new Map(),
    handle: (channel, handler) => ipcMain.handlers.set(channel, handler),
    removeHandler: (channel) => ipcMain.handlers.delete(channel),
  }
  const deadline = {
    arm: (owner, input, onFire) => { onFire({ kind: 'fired', id: input.id, fireAt: input.fireAt, firedAt: input.fireAt }); return { status: 'armed', id: input.id, fireAt: input.fireAt } },
    cancel: (owner, id) => ({ status: 'canceled', id }),
    disposeOwner: () => undefined,
  }
  const notifications = {
    status: () => ({ supported: true, permission: 'unknown' }),
    show: (owner, input, onEvent) => { onEvent({ kind: 'clicked', id: input.id }); return { status: 'shown', id: input.id } },
    remove: (owner, id) => ({ status: 'removed', id }),
    disposeOwner: () => undefined,
  }
  const options = { ipcMain, trustedWindows: [main], resolveWindow: (contents) => contents === main.webContents ? main : other }
  const disposeDeadline = registerDesktopDeadlineIpc({ ...options, service: deadline })
  const disposeNotification = registerDesktopNotificationIpc({ ...options, service: notifications })
  assert.deepEqual(await ipcMain.handlers.get('hermit:desktop-deadlines')({ sender: main.webContents }, { op: 'arm', input: { id: 'occ-1', fireAt: '2026-09-02T00:00:00Z' } }), { status: 'armed', id: 'occ-1', fireAt: '2026-09-02T00:00:00.000Z' })
  assert.deepEqual(await ipcMain.handlers.get('hermit:desktop-notifications')({ sender: main.webContents }, { op: 'show', input: { id: 'occ-1', title: '个人事项', body: '吃饭' } }), { status: 'shown', id: 'occ-1' })
  assert.deepEqual(main.sent, [
    ['hermit:desktop-deadlines', { kind: 'fired', id: 'occ-1', fireAt: '2026-09-02T00:00:00.000Z', firedAt: '2026-09-02T00:00:00.000Z' }],
    ['hermit:desktop-notifications', { kind: 'clicked', id: 'occ-1' }],
  ])
  main.emit('closed')
  assert.throws(() => ipcMain.handlers.get('hermit:desktop-deadlines')({ sender: other.webContents }, { op: 'cancel', id: 'occ-1' }), /受信窗口/u)
  disposeDeadline()
  disposeNotification()
  assert.equal(ipcMain.handlers.size, 0)
  void calls
})

function createWindow(id) {
  const listeners = new Map()
  const window = {
    id,
    webContents: { id },
    sent: [],
    isDestroyed: () => false,
    once: (event, listener) => listeners.set(event, listener),
    removeListener: (event, listener) => { if (listeners.get(event) === listener) listeners.delete(event) },
    emit: (event) => listeners.get(event)?.(),
  }
  window.webContents.send = (channel, value) => window.sent.push([channel, value])
  return window
}
