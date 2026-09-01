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
