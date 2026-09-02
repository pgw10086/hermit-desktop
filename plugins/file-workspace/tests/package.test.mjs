import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('package exposes separate host/client entries and public-contract-only client imports', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(packageJson.name, '@hermit/file-workspace')
  assert.deepEqual(packageJson.hermit, { type: 'product-plugin' })
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const source = await readFile(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
  assert.match(source, /@deepseek-ai\/dsh-client-ui-layout\/client/)
  assert.match(client, /file-workspace/)
  assert.doesNotMatch(client, /dsh-web-frontend\/src|dsh-client-ui-layout\/src|private/i)
})

test('client CSS consumes DSH semantic theme tokens without a private palette', async () => {
  const css = await readFile(new URL('../src/client/FileWorkspace.module.css', import.meta.url), 'utf8')
  assert.match(css, /--dsw-alias-bg-base/u)
  assert.match(css, /--dsw-alias-label-primary/u)
  assert.match(css, /--dsw-alias-interactive-bg-active/u)
  assert.doesNotMatch(css, /--fw-/u)
  assert.doesNotMatch(css, /--dsw-alias-(surface|text|border-subtle|fill-active)/u)
  assert.doesNotMatch(css, /(?:#[0-9a-f]{3,8}|rgba?\()/iu)
})
