import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const primitiveStubs = {
  Button() { return null },
  IconCopyOutline16() { return null },
  IconCordisPluginOutline14() { return null },
  IconFolderClose16() { return null },
  IconListPenOutline16() { return null },
}

function loadClientDependency(id) {
  if (id === '@deepseek-ai/dsh-client-runtime/client') return { defineStore: () => ({}) }
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitiveStubs
  return require(id)
}

test('package records the pinned upstream layout, Navigation and Desktop Surface patch', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(manifest.hermitPatch, {
    contractVersion: 6,
    name: 'product-navigation-shortcut-center-desktop-surface-and-primary-workspace',
    upstreamRepository: 'https://github.com/deepseek-ai/deepseek-harness.git',
    upstreamTag: 'dsh-v0.1.1-rc.2',
    upstreamCommit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
  })
})

test('public layout service opens and closes a Product Surface', () => {
  let factory
  const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (definition) => { factory = definition.factory } } },
  })
  assert.equal(typeof factory, 'function')
  const exports = factory(loadClientDependency)
  const calls = []
  const layout = new exports.LayoutController()
  assert.equal(layout.productSurfaceContract, 1)
  layout.attachPanels({
    toggleSidebar() {},
    setSidebar() {},
    setDetails() {},
    setNarrow() {},
    openDetails() {},
    closeDetails() {},
    openProductSurface(id) { calls.push(['open', id]) },
    closeProductSurface() { calls.push(['close']) },
  })

  layout.openProductSurface(' smart-clipboard-history ')
  layout.closeProductSurface()
  assert.deepEqual(calls, [['open', 'smart-clipboard-history'], ['close']])
  assert.equal(layout.getProductNavigationState().activeProductSurfaceId, null)
  assert.throws(() => layout.openProductSurface('   '), /must not be blank/)
})

test('public layout service registers ordered product entries and tracks the active surface', () => {
  const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  let factory
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (definition) => { factory = definition.factory } } },
  })
  const exports = factory(loadClientDependency)
  const layout = new exports.LayoutController()
  const calls = []
  layout.attachPanels({
    toggleSidebar() {},
    setSidebar() {},
    setDetails() {},
    setNarrow() {},
    openDetails() {},
    closeDetails() { calls.push(['close']) },
    openProductSurface(id) { calls.push(['open', id]) },
    closeProductSurface() { calls.push(['close-surface']) },
  })
  const changes = []
  const off = layout.subscribeProductNavigation(() => changes.push(layout.getProductNavigationState()))
  const disposeOrganizer = layout.registerProductEntry({ id: 'personal-organizer', label: '个人事项', icon: 'organizer', order: 20 })
  const disposeFiles = layout.registerProductEntry({ id: 'file-workspace', label: '文件工作区', icon: 'file-workspace', order: 15 })
  const disposeExample = layout.registerProductEntry({ id: 'example-product', label: '示例产品', icon: 'plugin', order: 40 })
  assert.equal(layout.getProductNavigationState().entries.map((entry) => entry.id).join(','), 'file-workspace,personal-organizer,example-product')
  layout.openProductSurface('personal-organizer')
  assert.equal(layout.getProductNavigationState().activeProductSurfaceId, 'personal-organizer')
  assert.equal(changes.length, 4)
  disposeOrganizer()
  assert.equal(layout.getProductNavigationState().activeProductSurfaceId, null)
  assert.deepEqual(calls, [['open', 'personal-organizer'], ['close-surface']])
  disposeFiles()
  disposeExample()
  off()
})

test('public layout service rejects duplicate or invalid product entry metadata', () => {
  const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  let factory
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (definition) => { factory = definition.factory } } },
  })
  const exports = factory(loadClientDependency)
  const layout = new exports.LayoutController()
  const dispose = layout.registerProductEntry({ id: 'one', label: 'One', icon: 'clipboard', order: 1 })
  assert.throws(() => layout.registerProductEntry({ id: 'one', label: 'Other', icon: 'clipboard', order: 2 }), /already registered/)
  assert.throws(() => layout.registerProductEntry({ id: 'two', label: 'Two', icon: 'unknown', order: 1 }), /unsupported icon/)
  assert.throws(() => layout.registerProductEntry({ id: 'three', label: 'Three', icon: 'clipboard', order: Number.POSITIVE_INFINITY }), /order must be finite/)
  dispose()
})

test('public layout client exposes the Desktop Surface bridge when the host provides it', () => {
  const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  let factory
  const surface = { open() {}, toggle() {}, close() {}, capabilities() {} }
  vm.runInNewContext(source, {
    hermitDesktopSurface: surface,
    window: { __ModuleLoader__: { load: (definition) => { factory = definition.factory } } },
  })
  const exports = factory(loadClientDependency)
  assert.equal(exports.getDesktopSurfaceClient(), surface)
})

test('public layout client exposes deadline and notification facades only when preload injects them', () => {
  const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  let factory
  const deadline = { arm() {}, cancel() {}, observe() {} }
  const notification = { status() {}, show() {}, replace() {}, remove() {}, observe() {} }
  vm.runInNewContext(source, {
    hermitDesktopDeadlines: deadline,
    hermitDesktopNotifications: notification,
    window: { __ModuleLoader__: { load: (definition) => { factory = definition.factory } } },
  })
  const exports = factory(loadClientDependency)
  assert.equal(exports.getDesktopDeadlineClient(), deadline)
  assert.equal(exports.getDesktopNotificationClient(), notification)
})
