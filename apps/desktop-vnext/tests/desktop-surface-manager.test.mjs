import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { DesktopSurfaceError } from '../lib/core/desktop-surface-contract.js'
import { DesktopSurfaceManager } from '../lib/core/desktop-surface-manager.js'

test('Surface Manager 统一管理注册、打开、toggle、关闭和 owner 注销', async () => {
  const windows = []
  const visibility = []
  const loads = []
  const manager = new DesktopSurfaceManager({
    createWindow: (options) => {
      const window = new FakeWindow(options)
      windows.push(window)
      return window
    },
    onVisibilityChanged: (id, visible) => visibility.push(`${id}:${String(visible)}`),
  })
  const dispose = manager.register(
    { id: 'todo.glance', kind: 'product.panel', content: { type: 'plugin-view', viewId: 'todo' } },
    {
      window: { title: 'Todo', width: 320, height: 240, show: false },
      load: async (_window, options) => { loads.push(options) },
      position: (window) => { window.setBounds({ x: 10, y: 20, width: 320, height: 240 }) },
      hideOnBlur: true,
    },
  )

  assert.equal(windows.length, 1)
  const opened = await manager.open('todo.glance', {
    preferredSize: { width: 320, height: 240 },
    session: { type: 'existing', sessionId: 'session-1' },
  })
  assert.equal(opened.id, 'todo.glance')
  assert.deepEqual(loads, [{
    preferredSize: { width: 320, height: 240 },
    session: { type: 'existing', sessionId: 'session-1' },
  }])
  assert.equal(windows[0].visible, true)
  assert.equal(manager.hasActiveSurface(), true)
  assert.deepEqual(windows[0].bounds, { x: 10, y: 20, width: 320, height: 240 })
  assert.deepEqual(windows[0].size, { width: 320, height: 240 })
  manager.resize('todo.glance', { width: 300, height: 220 })
  assert.deepEqual(windows[0].size, { width: 300, height: 220 })
  assert.deepEqual(await manager.toggle('todo.glance'), null)
  assert.equal(windows[0].visible, false)
  await new Promise((resolve) => setTimeout(resolve, 510))
  assert.equal(manager.hasActiveSurface(), false)
  await manager.toggle('todo.glance')
  assert.equal(windows[0].visible, true)
  await manager.close('todo.glance')
  assert.equal(windows[0].visible, false)
  dispose()
  assert.equal(windows[0].destroyed, true)
  assert.deepEqual(visibility, ['todo.glance:true', 'todo.glance:false', 'todo.glance:true', 'todo.glance:false'])
})

test('渲染加载失败返回明确的 RENDERER_FAILED，不伪造 opened 状态', async () => {
  const manager = new DesktopSurfaceManager({ createWindow: (options) => new FakeWindow(options) })
  manager.register(
    { id: 'conversation.quick', kind: 'conversation.quick', content: { type: 'dsh-conversation' } },
    {
      window: { title: 'Conversation', show: false },
      load: async () => { throw new Error('DSH unavailable') },
    },
  )
  await assert.rejects(
    manager.open('conversation.quick'),
    (error) => error instanceof DesktopSurfaceError && error.code === 'RENDERER_FAILED',
  )
})

test('显式切换已有 Session 时只重载会话绑定，不重复重载普通 Surface', async () => {
  const loads = []
  const manager = new DesktopSurfaceManager({ createWindow: (options) => new FakeWindow(options) })
  manager.register(
    { id: 'conversation.quick', kind: 'conversation.quick', content: { type: 'dsh-conversation' } },
    {
      window: { title: 'Conversation', show: false },
      load: async (_window, options) => { loads.push(options.session) },
    },
  )

  await manager.open('conversation.quick')
  await manager.open('conversation.quick')
  await manager.open('conversation.quick', { session: { type: 'existing', sessionId: 'session-1' } })
  await manager.open('conversation.quick', { session: { type: 'existing', sessionId: 'session-1' } })
  await manager.open('conversation.quick', { session: { type: 'existing', sessionId: 'session-2' } })

  assert.deepEqual(loads, [undefined, { type: 'existing', sessionId: 'session-1' }, { type: 'existing', sessionId: 'session-2' }])
})

test('声明 new-on-submit 的 Surface 每次从隐藏状态打开都重新开始，显式新建也会重载当前窗口', async () => {
  const loads = []
  const manager = new DesktopSurfaceManager({ createWindow: (options) => new FakeWindow(options) })
  manager.register(
    {
      id: 'conversation.quick',
      kind: 'conversation.quick',
      content: { type: 'dsh-conversation' },
      session: { type: 'new-on-submit' },
    },
    {
      window: { title: 'Conversation', show: false },
      load: async (_window, options) => { loads.push(options.session) },
    },
  )

  await manager.open('conversation.quick')
  await manager.open('conversation.quick')
  await manager.close('conversation.quick')
  await manager.open('conversation.quick')
  await manager.open('conversation.quick', { session: { type: 'new-on-submit' } })

  assert.deepEqual(loads, [
    { type: 'new-on-submit' },
    { type: 'new-on-submit' },
    { type: 'new-on-submit' },
  ])
})

test('重复 id 和无效定义在注册时失败', () => {
  const manager = new DesktopSurfaceManager({ createWindow: (options) => new FakeWindow(options) })
  const definition = { id: 'same', kind: 'product.panel', content: { type: 'plugin-view', viewId: 'view' } }
  manager.register(definition, { window: {}, load: async () => undefined })
  assert.throws(
    () => manager.register(definition, { window: {}, load: async () => undefined }),
    (error) => error instanceof DesktopSurfaceError && error.code === 'INVALID_DEFINITION',
  )
  assert.throws(
    () => manager.register({ id: ' ', kind: 'product.panel', content: { type: 'plugin-view' } }, { window: {}, load: async () => undefined }),
    (error) => error instanceof DesktopSurfaceError && error.code === 'INVALID_DEFINITION',
  )
})

test('Surface Window Policy 映射宿主行为并裁剪运行时尺寸', async () => {
  const windows = []
  const manager = new DesktopSurfaceManager({ createWindow: (options) => {
    const window = new FakeWindow(options)
    windows.push(window)
    return window
  } })
  manager.register({
    id: 'conversation.quick',
    kind: 'conversation.quick',
    content: { type: 'dsh-conversation' },
    window: {
      chrome: 'none',
      movable: 'allowed',
      resizable: false,
      alwaysOnTop: false,
      minSize: { width: 320, height: 180 },
      maxSize: { width: 640, height: 480 },
      rememberPosition: true,
      rememberSize: true,
    },
  }, { window: { show: false }, load: async () => undefined })
  assert.deepEqual(windows[0].options, {
    show: false,
    frame: false,
    movable: true,
    resizable: false,
    alwaysOnTop: false,
    minWidth: 320,
    minHeight: 180,
    maxWidth: 640,
    maxHeight: 480,
  })
  await manager.open('conversation.quick', { preferredSize: { width: 100, height: 800 } })
  assert.deepEqual(windows[0].size, { width: 320, height: 480 })
  manager.resize('conversation.quick', { width: 640, height: 180 })
  assert.deepEqual(windows[0].size, { width: 640, height: 180 })
  assert.equal(manager.capabilities().features['window-movable'], true)
})

class FakeWindow extends EventEmitter {
  visible = false
  destroyed = false
  bounds = undefined
  alwaysOnTop = false

  constructor(options) {
    super()
    this.options = options
  }

  show() { this.visible = true; this.emit('show') }
  hide() { this.visible = false; this.emit('hide') }
  focus() { this.focused = true }
  destroy() { this.destroyed = true; this.emit('closed') }
  isDestroyed() { return this.destroyed }
  setAlwaysOnTop(value) { this.alwaysOnTop = value }
  setBounds(bounds) { this.bounds = bounds }
  setSize(width, height) {
    this.size = { width, height }
    this.bounds = { ...(this.bounds ?? { x: 0, y: 0 }), width, height }
  }
  setPosition(x, y) { this.bounds = { ...(this.bounds ?? { width: 0, height: 0 }), x, y } }
  getBounds() { return this.bounds ?? { x: 0, y: 0, width: this.size?.width ?? 0, height: this.size?.height ?? 0 } }
}
