import assert from 'node:assert/strict'
import test from 'node:test'
import { registerDesktopShortcutIpc } from '@platform/desktop-core'

test('快捷键 IPC 只允许 DSH 主窗口读取和修改 Core 目录', async () => {
  const calls = []
  const mainWindow = createWindow('main')
  const otherWindow = createWindow('other')
  const registry = {
    list: () => [{ id: 'one' }],
    update: (id, accelerator) => ({ applied: true, id, accelerator }),
    reset: (id) => ({ applied: true, id }),
    subscribe: (listener) => { calls.push(['subscribe', listener]); return () => calls.push(['unsubscribe']) },
  }
  const ipcMain = {
    handle: (channel, handler) => { calls.push(['handle', channel, handler]); ipcMain.handler = handler },
    removeHandler: (channel) => calls.push(['remove', channel]),
  }
  const dispose = registerDesktopShortcutIpc({
    ipcMain,
    registry,
    mainWindow,
    resolveWindow: (contents) => contents === mainWindow.webContents ? mainWindow : otherWindow,
  })
  assert.deepEqual(await ipcMain.handler({ sender: mainWindow.webContents }, { op: 'list' }), [{ id: 'one' }])
  assert.deepEqual(await ipcMain.handler({ sender: mainWindow.webContents }, { op: 'update', id: 'one', accelerator: 'CommandOrControl+K' }), {
    applied: true, id: 'one', accelerator: 'CommandOrControl+K',
  })
  assert.deepEqual(await ipcMain.handler({ sender: mainWindow.webContents }, { op: 'reset', id: 'one' }), { applied: true, id: 'one' })
  assert.throws(() => ipcMain.handler({ sender: otherWindow.webContents }, { op: 'list' }), /受信任的 DSH 主窗口/u)
  assert.throws(() => ipcMain.handler({ sender: mainWindow.webContents }, { op: 'update', id: '', accelerator: 'CommandOrControl+K' }), /id 必须是非空字符串/u)
  dispose()
  assert.deepEqual(calls.map(([kind, value]) => [kind, value]), [
    ['subscribe', calls[0][1]],
    ['handle', 'desktop:shortcuts'],
    ['unsubscribe', undefined],
    ['remove', 'desktop:shortcuts'],
  ])
})

function createWindow(id) {
  return {
    id,
    webContents: { id },
    isDestroyed: () => false,
  }
}
