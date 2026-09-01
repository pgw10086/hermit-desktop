import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

test('package records the pinned upstream Product Surface patch', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(manifest.hermitPatch, {
    contractVersion: 1,
    name: 'product-surface',
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
  const exports = factory((id) => id === '@deepseek-ai/dsh-client-runtime/client'
    ? { defineStore: () => ({}) }
    : require(id))
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
  assert.throws(() => layout.openProductSurface('   '), /must not be blank/)
})
