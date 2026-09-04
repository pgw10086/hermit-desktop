import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import { parseRequest } from '../lib/core/smart-clipboard/ipc-contract.js'

test('Smart Clipboard IPC 只接受有界操作和三类 Canonical 类型', () => {
  assert.deepEqual(parseRequest({ op: 'list', filter: { kind: 'IMAGE', query: '' } }), {
    op: 'list', filter: { kind: 'IMAGE', query: '' },
  })
  assert.deepEqual(parseRequest({
    op: 'update-settings', historyLimit: 100, totalBytes: 1024,
    retention: 30,
      actionMapping: { Enter: 'copy', 'Mod+Enter': 'paste', 'Shift+Enter': 'plain-text' },
    excludedApplications: ['com.example.secret'], excludedKinds: ['IMAGE'],
  }).retention, 30)
  assert.deepEqual(parseRequest({ op: 'ignore-next' }), { op: 'ignore-next' })
  assert.deepEqual(parseRequest({ op: 'clear-all-data' }), { op: 'clear-all-data' })
  assert.deepEqual(parseRequest({ op: 'execute', id: 'legacy-text', action: 'use' }), {
    op: 'execute', id: 'legacy-text', action: 'paste',
  })
  assert.deepEqual(parseRequest({ op: 'set-quick-panel-layout', rows: 8, previewOpen: true }), {
    op: 'set-quick-panel-layout', rows: 8, previewOpen: true,
  })
  assert.throws(() => parseRequest({ op: 'execute', id: '', action: 'copy' }), /id 必须是非空字符串/u)
  assert.throws(() => parseRequest({ op: 'list', filter: { kind: 'URL' } }), /History 类型无效/u)
  assert.throws(() => parseRequest({ op: 'set-quick-panel-layout', rows: 9, previewOpen: false }), /rows 必须是/u)
  assert.throws(() => parseRequest({
    op: 'update-settings', historyLimit: 0, totalBytes: 1024, retention: 'forever',
      actionMapping: { Enter: 'copy', 'Mod+Enter': 'paste', 'Shift+Enter': 'plain-text' },
    excludedApplications: [], excludedKinds: [],
  }), /historyLimit 必须是正整数/u)
})

test('preload 将 Quick Panel 布局对象转换为主进程请求字段', async () => {
  const calls = []
  let exposed
  let surfaceExposed
  let shortcutExposed
  let deadlineExposed
  let notificationExposed
  const source = fs.readFileSync(new URL('../src/desktop/smart-clipboard-preload.cjs', import.meta.url), 'utf8')
  vm.runInNewContext(source, {
    require: (name) => {
      assert.equal(name, 'electron')
      return {
        contextBridge: { exposeInMainWorld: (key, value) => {
          if (key === 'hermitSmartClipboard') exposed = value
          if (key === 'hermitDesktopSurface') surfaceExposed = value
          if (key === 'hermitDesktopShortcuts') shortcutExposed = value
          if (key === 'hermitDesktopDeadlines') deadlineExposed = value
          if (key === 'hermitDesktopNotifications') notificationExposed = value
        } },
        ipcRenderer: {
          invoke: (channel, request) => {
            calls.push(JSON.parse(JSON.stringify({ channel, request })))
            return Promise.resolve({ placement: 'right' })
          },
          on: () => undefined,
          removeListener: () => undefined,
        },
      }
    },
    window: { dispatchEvent: () => undefined },
  })
  assert.equal(typeof exposed?.setQuickPanelLayout, 'function')
  assert.equal(typeof exposed?.shortcut, 'undefined')
  assert.equal(typeof exposed?.setShortcut, 'undefined')
  assert.equal(typeof surfaceExposed?.open, 'function')
  assert.equal(typeof surfaceExposed?.toggle, 'function')
  assert.equal(typeof surfaceExposed?.capabilities, 'function')
  assert.equal(typeof shortcutExposed?.list, 'function')
  assert.equal(typeof shortcutExposed?.update, 'function')
  assert.equal(typeof shortcutExposed?.reset, 'function')
  assert.equal(typeof shortcutExposed?.observe, 'function')
  assert.equal(typeof deadlineExposed?.arm, 'function')
  assert.equal(typeof deadlineExposed?.cancel, 'function')
  assert.equal(typeof deadlineExposed?.observe, 'function')
  assert.equal(typeof notificationExposed?.status, 'function')
  assert.equal(typeof notificationExposed?.show, 'function')
  assert.equal(typeof notificationExposed?.replace, 'function')
  assert.equal(typeof notificationExposed?.remove, 'function')
  assert.equal(typeof notificationExposed?.observe, 'function')
  await exposed.setQuickPanelLayout({ rows: 5, previewOpen: true })
  assert.deepEqual(calls.at(-1), {
    channel: 'hermit:smart-clipboard',
    request: { op: 'set-quick-panel-layout', rows: 5, previewOpen: true },
  })
  await surfaceExposed.toggle('conversation.quick', { alwaysOnTop: true })
  assert.deepEqual(calls.at(-1), {
    channel: 'desktop:surface',
    request: { op: 'toggle', id: 'conversation.quick', options: { alwaysOnTop: true } },
  })
  await shortcutExposed.list()
  assert.deepEqual(calls.at(-1), {
    channel: 'desktop:shortcuts',
    request: { op: 'list' },
  })
  await shortcutExposed.update('smart-clipboard.open', 'CommandOrControl+Shift+F12')
  assert.deepEqual(calls.at(-1), {
    channel: 'desktop:shortcuts',
    request: { op: 'update', id: 'smart-clipboard.open', accelerator: 'CommandOrControl+Shift+F12' },
  })
  await shortcutExposed.reset('smart-clipboard.open')
  assert.deepEqual(calls.at(-1), {
    channel: 'desktop:shortcuts',
    request: { op: 'reset', id: 'smart-clipboard.open' },
  })
  await deadlineExposed.arm({ id: 'occ-1', fireAt: '2026-09-02T00:00:00.000Z' })
  assert.deepEqual(calls.at(-1), {
    channel: 'desktop:deadlines',
    request: { op: 'arm', input: { id: 'occ-1', fireAt: '2026-09-02T00:00:00.000Z' } },
  })
  await deadlineExposed.cancel('occ-1')
  assert.deepEqual(calls.at(-1), { channel: 'desktop:deadlines', request: { op: 'cancel', id: 'occ-1' } })
  await notificationExposed.show({ id: 'occ-1', title: '个人事项', body: '吃饭' })
  assert.deepEqual(calls.at(-1), { channel: 'desktop:notifications', request: { op: 'show', input: { id: 'occ-1', title: '个人事项', body: '吃饭' } } })
  await notificationExposed.replace({ id: 'occ-1', title: '个人事项', body: '晚餐' })
  assert.deepEqual(calls.at(-1), { channel: 'desktop:notifications', request: { op: 'replace', input: { id: 'occ-1', title: '个人事项', body: '晚餐' } } })
  await notificationExposed.remove('occ-1')
  assert.deepEqual(calls.at(-1), { channel: 'desktop:notifications', request: { op: 'remove', id: 'occ-1' } })
})
