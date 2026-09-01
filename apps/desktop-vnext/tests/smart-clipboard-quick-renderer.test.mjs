import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright-core'

const appRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const renderer = path.join(appRoot, 'lib', 'quick-retrieval', 'index.html')
const preload = path.join(appRoot, 'tests', 'fixtures', 'smart-clipboard-quick-renderer-preload.cjs')

test('Quick Retrieval 实际 renderer 完成搜索、键盘选择、三类预览和动作映射', async () => {
  assert.equal(fs.existsSync(renderer), true, `Quick Retrieval renderer 缺失：${renderer}`)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-quick-renderer-'))
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ private: true, main: 'main.cjs' }))
  fs.writeFileSync(path.join(root, 'main.cjs'), `
const { app, BrowserWindow } = require('electron')
app.commandLine.appendSwitch('lang', 'zh-CN')
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 480,
    height: 406,
    show: true,
    frame: false,
    webPreferences: {
      preload: process.env.HERMIT_QUICK_PRELOAD,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  await window.loadFile(process.env.HERMIT_QUICK_RENDERER)
})
app.on('window-all-closed', () => app.quit())
`)

  const application = await electron.launch({
    executablePath: electronPath,
    args: [root],
    cwd: root,
    env: { ...process.env, HERMIT_QUICK_PRELOAD: preload, HERMIT_QUICK_RENDERER: renderer },
    timeout: 30_000,
  })
  const pageErrors = []
  try {
    const page = await application.firstWindow({ timeout: 30_000 })
    page.on('pageerror', (cause) => pageErrors.push(cause.message))
    const panel = page.locator('[data-smart-clipboard-quick-panel="ready"]')
    await panel.waitFor()
    await page.evaluate(() => window.dispatchEvent(new Event('hermit-smart-clipboard-show')))
    const search = page.getByRole('searchbox', { name: '搜索剪贴板历史' })
    await search.waitFor()
    assert.equal(await search.evaluate((element) => element === document.activeElement), true)
    assert.equal(await page.getByRole('option').count(), 3)

    await search.press('ArrowDown')
    await page.getByRole('img', { name: '图片预览' }).waitFor()
    await search.press('Shift+Enter')
    await page.getByText('纯文本使用只支持文本记录', { exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.hermitQuickRetrievalTest.state().actions), [])

    await search.press('Enter')
    assert.deepEqual(await page.evaluate(() => window.hermitQuickRetrievalTest.state().actions.at(-1)), {
      id: 'image-review', action: 'use', source: 'quick-panel',
    })
    await search.press('ArrowDown')
    await page.getByText('obsolete.txt', { exact: true }).waitFor()

    await search.fill('release')
    assert.equal(await page.getByRole('option').count(), 1)
    await search.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
    await search.press('Shift+Enter')
    const actions = await page.evaluate(() => window.hermitQuickRetrievalTest.state().actions)
    assert.deepEqual(actions.slice(-2), [
      { id: 'text-release', action: 'copy', source: 'quick-panel' },
      { id: 'text-release', action: 'plain-text', source: 'quick-panel' },
    ])

    await page.getByRole('button', { name: '完整历史 ›' }).click()
    await search.press('Escape')
    assert.deepEqual(await page.evaluate(() => window.hermitQuickRetrievalTest.state()), {
      actions,
      closeCount: 1,
      openHistoryCount: 1,
    })
    assert.deepEqual(pageErrors, [])
  } finally {
    await application.close().catch(() => undefined)
    fs.rmSync(root, { recursive: true, force: true })
  }
})
