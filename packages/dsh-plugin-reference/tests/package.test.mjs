import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const packageRoot = new URL('../', import.meta.url)

test('参考插件制品只暴露 Host、Client 和 package manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'))
  assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './client', './package.json'])
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.peerDependencies.react, '>=18.3.0 <19')
  assert.equal(manifest.peerDependenciesMeta.react.optional, true)
  assert.equal(manifest.license, 'Apache-2.0')
})

test('Client bundle 使用 DSH lazy-CJS factory 并共享 React', async () => {
  const source = await readFile(new URL('lib/client.js', packageRoot), 'utf8')
  assert.match(source, /^window\.__ModuleLoader__\.load\(\{\s*id:\s*"@hermit\/dsh-plugin-reference"/u)
  assert.match(source, /require\("react"\)/u)
  assert.match(source, /require\("@deepseek-ai\/dsh-client-ui-primitives"\)/u)
  assert.match(source, /DisclosureRow/u)
  assert.match(source, /Toast/u)
  assert.match(source, /registerProductEntry/u)
  assert.match(source, /product\.surface/u)
  assert.doesNotMatch(source, /document\.querySelector|MutationObserver/u)
  assert.doesNotMatch(source, /@deepseek-ai\/[^"']+\/src\//u)
})

test('Host bundle 不导入 DSH 私有源码', async () => {
  const source = await readFile(new URL('lib/index.js', packageRoot), 'utf8')
  assert.doesNotMatch(source, /@deepseek-ai\/[^"']+\/src\//u)
  assert.match(source, /hermit_reference_echo/u)
  assert.match(source, /__hermit_reference__\/state/u)
})
