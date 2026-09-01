import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const packageRoot = new URL('../', import.meta.url)

test('Organizer 只暴露 Host、Client 和 manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'))
  assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './client', './package.json'])
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.deepEqual(manifest.hermit, { type: 'product-plugin' })
  assert.equal(manifest.peerDependencies.react, '>=18.3.0 <19')
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-skill'], '0.1.1-rc.2')
})

test('Client bundle 复用 DSH Product Surface、官方 UI 和宿主 React', async () => {
  const source = await readFile(new URL('lib/client.js', packageRoot), 'utf8')
  assert.match(source, /^window\.__ModuleLoader__\.load\(\{\s*id:\s*"@hermit\/organizer"/u)
  assert.match(source, /require\("react"\)/u)
  assert.match(source, /require\("@deepseek-ai\/dsh-client-ui-primitives"\)/u)
  assert.match(source, /product\.surface/u)
  assert.match(source, /sidebar\.footer\.action/u)
  assert.match(source, /data-organizer-surface.*unavailable/u)
  assert.doesNotMatch(source, /@deepseek-ai\/[^"']+\/src\//u)
  assert.doesNotMatch(source, /MutationObserver|createRoot\(/u)
  assert.doesNotMatch(source, /RRULE|timeZone|timezone|recurrence/u)
})

test('导航保持四个常用视图、独立提醒入口和中文回收站术语', async () => {
  const source = await readFile(new URL('lib/client.js', packageRoot), 'utf8')
  assert.match(source, /个人事项视图/u)
  assert.match(source, /aria-current/u)
  assert.match(source, /提醒中心，有待处理提醒或通知异常/u)
  assert.match(source, /回收站/u)
  assert.doesNotMatch(source, /更多[\s\S]{0,260}提醒中心/u)
})

test('原型表达使用待办清单展开、内容快编和全天提醒默认值', async () => {
  const source = await readFile(new URL('lib/client.js', packageRoot), 'utf8')
  assert.match(source, /待办清单/u)
  assert.match(source, /展开[^\n]{0,40}清单/u)
  assert.match(source, /快速编辑待办内容/u)
  assert.match(source, /全天事件/u)
  assert.match(source, /08:00/u)
  assert.doesNotMatch(source, /仅日期/u)
  assert.doesNotMatch(source, /具体时间/u)
  assert.doesNotMatch(source, /相对事项时间/u)
  assert.doesNotMatch(source, /选择基准/u)
})

test('Host 通过公开 Storage/RPC/Tool 契约提供 Canonical Todo 与 Note 写入', async () => {
  const source = await readFile(new URL('lib/index.js', packageRoot), 'utf8')
  const domain = await readFile(new URL('lib/domain/spec.js', packageRoot), 'utf8')
  assert.match(domain, /personal_organizer/u)
  assert.match(source, /organizer_create_todo/u)
  assert.match(source, /organizer_create_note/u)
  assert.match(domain, /tool_calls/u)
  assert.match(source, /personal-organizer/u)
  assert.match(source, /ctx\.skills\.register/u)
  assert.match(source, /不要创建第二个聊天入口/u)
  assert.doesNotMatch(source, /@deepseek-ai\/[^"']+\/src\//u)
})
