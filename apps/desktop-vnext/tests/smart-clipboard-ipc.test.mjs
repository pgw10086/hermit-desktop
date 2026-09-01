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
    actionMapping: { Enter: 'use', 'Mod+Enter': 'copy', 'Shift+Enter': 'plain-text' },
    excludedApplications: ['com.example.secret'], excludedKinds: ['IMAGE'],
  }).retention, 30)
  assert.deepEqual(parseRequest({ op: 'ignore-next' }), { op: 'ignore-next' })
  assert.deepEqual(parseRequest({ op: 'clear-all-data' }), { op: 'clear-all-data' })
  assert.deepEqual(parseRequest({ op: 'set-quick-panel-layout', rows: 8, previewOpen: true }), {
    op: 'set-quick-panel-layout', rows: 8, previewOpen: true,
  })
  assert.throws(() => parseRequest({ op: 'execute', id: '', action: 'copy' }), /id 必须是非空字符串/u)
  assert.throws(() => parseRequest({ op: 'list', filter: { kind: 'URL' } }), /History 类型无效/u)
  assert.throws(() => parseRequest({ op: 'set-quick-panel-layout', rows: 9, previewOpen: false }), /rows 必须是/u)
  assert.throws(() => parseRequest({
    op: 'update-settings', historyLimit: 0, totalBytes: 1024, retention: 'forever',
    actionMapping: { Enter: 'use', 'Mod+Enter': 'copy', 'Shift+Enter': 'plain-text' },
    excludedApplications: [], excludedKinds: [],
  }), /historyLimit 必须是正整数/u)
})

test('preload 将 Quick Panel 布局对象转换为主进程请求字段', async () => {
  const calls = []
  let exposed
  const source = fs.readFileSync(new URL('../src/desktop/smart-clipboard-preload.cjs', import.meta.url), 'utf8')
  vm.runInNewContext(source, {
    require: (name) => {
      assert.equal(name, 'electron')
      return {
        contextBridge: { exposeInMainWorld: (_key, value) => { exposed = value } },
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
  await exposed.setQuickPanelLayout({ rows: 5, previewOpen: true })
  assert.deepEqual(calls.at(-1), {
    channel: 'hermit:smart-clipboard',
    request: { op: 'set-quick-panel-layout', rows: 5, previewOpen: true },
  })
})
