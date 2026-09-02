import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  FileShortcutSettingsStore,
  ShortcutRegistry,
} from '../lib/core/shortcut-registry.js'

test('快捷键注册成功后才报告 registered，并且触发回调', () => {
  const port = createShortcutPort()
  let triggered = 0
  const registry = new ShortcutRegistry({
    port,
    settings: new MemorySettingsStore(),
  })

  const registration = registry.register({
    id: 'smart-clipboard.open',
    pluginId: 'smart-clipboard',
    pluginName: 'Smart Clipboard',
    commandName: '打开剪贴板快速取回',
    defaultAccelerator: 'CommandOrControl+Shift+Space',
    onTrigger: () => { triggered += 1 },
  })

  assert.equal(registration.snapshot.status, 'registered')
  port.trigger('CommandOrControl+Shift+Space')
  assert.equal(triggered, 1)
  registration.dispose()
  assert.equal(port.isRegistered('CommandOrControl+Shift+Space'), false)
})

test('系统或其他应用冲突只产生 conflict，不影响其他快捷键绑定', () => {
  const port = createShortcutPort(new Set(['CommandOrControl+Shift+Space']))
  const registry = new ShortcutRegistry({ port, settings: new MemorySettingsStore() })

  const first = registry.register({
    id: 'first', pluginId: 'first-plugin', pluginName: '第一个插件', commandName: '第一个', defaultAccelerator: 'CommandOrControl+Shift+Space', onTrigger: () => undefined,
  })
  const second = registry.register({
    id: 'second', pluginId: 'second-plugin', pluginName: '第二个插件', commandName: '第二个', defaultAccelerator: 'CommandOrControl+Shift+F12', onTrigger: () => undefined,
  })

  assert.equal(first.snapshot.status, 'conflict')
  assert.equal(first.snapshot.reason, 'external-or-system-conflict')
  assert.equal(second.snapshot.status, 'registered')
  assert.equal(port.isRegistered('CommandOrControl+Shift+F12'), true)
})

test('Hermit 内部冲突在调用系统前被识别', () => {
  const port = createShortcutPort()
  const registry = new ShortcutRegistry({ port, settings: new MemorySettingsStore() })
  registry.register({ id: 'first', pluginId: 'first-plugin', pluginName: '第一个插件', commandName: '第一个', defaultAccelerator: 'CommandOrControl+Shift+Space', onTrigger: () => undefined })
  const second = registry.register({ id: 'second', pluginId: 'second-plugin', pluginName: '第二个插件', commandName: '第二个', defaultAccelerator: 'CommandOrControl+Shift+Space', onTrigger: () => undefined })

  assert.deepEqual(second.snapshot, {
    id: 'second',
    pluginId: 'second-plugin',
    pluginName: '第二个插件',
    commandName: '第二个',
    defaultAccelerator: 'CommandOrControl+Shift+Space',
    accelerator: 'CommandOrControl+Shift+Space',
    status: 'conflict',
    reason: 'internal-conflict',
  })
  assert.deepEqual(port.registered(), ['CommandOrControl+Shift+Space'])
})

test('替换快捷键先试新组合，失败时保留旧组合；成功后才持久化', () => {
  const port = createShortcutPort()
  const settings = new MemorySettingsStore()
  const registry = new ShortcutRegistry({ port, settings })
  registry.register({
    id: 'smart-clipboard.open', pluginId: 'smart-clipboard', pluginName: 'Smart Clipboard', commandName: '剪贴板', defaultAccelerator: 'CommandOrControl+Shift+Space', onTrigger: () => undefined,
  })

  const changed = registry.update('smart-clipboard.open', 'CommandOrControl+Shift+F12')
  assert.equal(changed.applied, true)
  assert.equal(port.isRegistered('CommandOrControl+Shift+Space'), false)
  assert.equal(port.isRegistered('CommandOrControl+Shift+F12'), true)
  assert.equal(settings.read('smart-clipboard.open'), 'CommandOrControl+Shift+F12')

  port.blocked.add('CommandOrControl+Shift+F11')
  const rejected = registry.update('smart-clipboard.open', 'CommandOrControl+Shift+F11')
  assert.equal(rejected.applied, false)
  assert.equal(rejected.snapshot.accelerator, 'CommandOrControl+Shift+F12')
  assert.equal(rejected.snapshot.status, 'registered')
  assert.equal(port.isRegistered('CommandOrControl+Shift+F12'), true)
  assert.equal(port.isRegistered('CommandOrControl+Shift+F11'), false)
  assert.equal(settings.read('smart-clipboard.open'), 'CommandOrControl+Shift+F12')
})

test('快捷键设置使用 userData 下的私有 JSON 文件并可重启读取', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-shortcuts-'))
  try {
    const file = path.join(root, 'desktop', 'shortcuts.json')
    const first = new FileShortcutSettingsStore(file)
    first.write('smart-clipboard.open', 'CommandOrControl+Shift+F12')

    const second = new FileShortcutSettingsStore(file)
    assert.equal(second.read('smart-clipboard.open'), 'CommandOrControl+Shift+F12')
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('快捷键目录按插件 metadata 展示，并且恢复默认会删除用户覆盖值', () => {
  const port = createShortcutPort()
  const settings = new MemorySettingsStore()
  const registry = new ShortcutRegistry({ port, settings })
  registry.register({
    id: 'smart-clipboard.open', pluginId: 'smart-clipboard', pluginName: 'Smart Clipboard', commandName: '打开剪贴板快速取回',
    defaultAccelerator: 'CommandOrControl+Shift+Space', onTrigger: () => undefined,
  })
  registry.update('smart-clipboard.open', 'CommandOrControl+Shift+F12')
  assert.deepEqual(registry.list().map(({ pluginId, pluginName, commandName, accelerator }) => ({ pluginId, pluginName, commandName, accelerator })), [{
    pluginId: 'smart-clipboard', pluginName: 'Smart Clipboard', commandName: '打开剪贴板快速取回', accelerator: 'CommandOrControl+Shift+F12',
  }])
  const reset = registry.reset('smart-clipboard.open')
  assert.equal(reset.applied, true)
  assert.equal(reset.snapshot.accelerator, 'CommandOrControl+Shift+Space')
  assert.equal(settings.read('smart-clipboard.open'), undefined)
  registry.dispose('smart-clipboard.open')
  assert.deepEqual(registry.list(), [])
})

function createShortcutPort(blocked = new Set()) {
  const handlers = new Map()
  return {
    blocked,
    register(accelerator, callback) {
      if (blocked.has(accelerator) || handlers.has(accelerator)) return false
      handlers.set(accelerator, callback)
      return true
    },
    isRegistered: (accelerator) => handlers.has(accelerator),
    unregister: (accelerator) => { handlers.delete(accelerator) },
    trigger: (accelerator) => handlers.get(accelerator)?.(),
    registered: () => [...handlers.keys()],
  }
}

class MemorySettingsStore {
  #settings = new Map()

  read(id) { return this.#settings.get(id) }
  write(id, accelerator) { this.#settings.set(id, accelerator) }
  delete(id) { this.#settings.delete(id) }
}
