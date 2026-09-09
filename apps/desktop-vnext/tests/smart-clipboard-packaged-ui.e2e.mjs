import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { packagedElectronTestEnvironment } from './packaged-electron-harness.mjs'

const appRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const executablePath = process.platform === 'darwin'
  ? path.join(appRoot, 'dist', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Hermit.app', 'Contents', 'MacOS', 'Hermit')
  : path.join(appRoot, 'dist', 'win-unpacked', 'Hermit.exe')

if (!new Set(['darwin', 'win32']).has(process.platform)) {
  throw new Error(`Smart Clipboard packaged UI 验收尚不支持 ${process.platform}`)
}
assert.equal(fs.existsSync(executablePath), true, `Hermit packaged executable is missing: ${executablePath}`)

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-smart-clipboard-packaged-ui-'))
const userData = path.join(root, 'user-data')
seedLegacyActionMapping()
let application
let succeeded = false

try {
  application = await launchApplication()
  const page = await waitForMainWindow(application)
  const pageErrors = []
  page.on('pageerror', (cause) => pageErrors.push(cause.message))
  await dismissOnboarding(page)
  const quickPanelPage = await waitForQuickPanel(application)
  assert.deepEqual(
    await quickPanelPage.evaluate(async () => (await window.hermitSmartClipboard.settings()).actionMapping),
    { Enter: 'copy', 'Mod+Enter': 'paste', 'Shift+Enter': 'plain-text' },
  )
  const activationState = await application.evaluate(async ({ app, BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hermit')
    const quickPanel = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Smart Clipboard')
    if (main === undefined || quickPanel === undefined) throw new Error('Smart Clipboard packaged windows missing')
    main.hide()
    quickPanel.show()
    await new Promise((resolve) => setTimeout(resolve, 250))
    app.emit('activate')
    const hiddenDuringQuickPanel = !main.isVisible()
    quickPanel.hide()
    main.show()
    return { hiddenDuringQuickPanel }
  })
  assert.deepEqual(activationState, { hiddenDuringQuickPanel: true })
  await openSidebar(page)

  assert.equal(await page.evaluate(() => typeof window.hermitSmartClipboard), 'object')
  assert.equal(await page.evaluate(() => typeof window.hermitDesktopShortcuts), 'object')
  await page.getByRole('button', { name: /^(Settings|设置)$/u }).last().click()
  const desktopSettings = page.getByRole('dialog', { name: /^(Settings|设置)$/u })
  await desktopSettings.waitFor({ timeout: 20_000 })
  await desktopSettings.getByRole('button', { name: /^(快捷键|Shortcuts)$/u }).click()
  const shortcutCenter = desktopSettings.locator('[data-hermit-shortcut-center="ready"]')
  await shortcutCenter.waitFor({ timeout: 20_000 })
  await shortcutCenter.getByText('Smart Clipboard', { exact: true }).waitFor()
  await shortcutCenter.getByText('打开剪贴板快速取回', { exact: true }).waitFor()
  const shortcutRow = shortcutCenter.locator('[data-shortcut-status]').filter({ hasText: '打开剪贴板快速取回' })
  const shortcutInput = shortcutRow.getByRole('textbox', { name: /Smart Clipboard 打开剪贴板快速取回/u })
  await shortcutInput.press('Control+Shift+F12')
  await shortcutRow.getByRole('button', { name: '应用' }).click()
  await page.getByText('打开剪贴板快速取回 已保存', { exact: true }).waitFor()
  assert.equal((await page.evaluate(async () => (await window.hermitDesktopShortcuts.list()).find((item) => item.id === 'smart-clipboard.open')?.accelerator)), 'CommandOrControl+Shift+F12')
  await shortcutInput.press('Control+Shift+Enter')
  await shortcutRow.getByRole('button', { name: '应用' }).click()
  await page.getByText('打开剪贴板快速取回 未修改：与 Hermit 其他命令冲突', { exact: true }).waitFor()
  assert.equal((await page.evaluate(async () => (await window.hermitDesktopShortcuts.list()).find((item) => item.id === 'smart-clipboard.open')?.accelerator)), 'CommandOrControl+Shift+F12')
  await shortcutRow.getByRole('button', { name: '恢复默认' }).click()
  await page.getByText('打开剪贴板快速取回 已恢复默认', { exact: true }).waitFor()
  assert.equal((await page.evaluate(async () => (await window.hermitDesktopShortcuts.list()).find((item) => item.id === 'smart-clipboard.open')?.accelerator)), 'CommandOrControl+Shift+Space')
  await desktopSettings.press('Escape')
  await desktopSettings.waitFor({ state: 'detached' })
  const navigation = page.getByRole('button', { name: '剪贴板历史' })
  await navigation.waitFor({ timeout: 20_000 })
  await navigation.click()
  const history = page.locator('[data-smart-clipboard-history="ready"]')
  await history.waitFor({ timeout: 20_000 })
  // Windows 默认窗口进入单栏 History；详情占位只属于双栏布局，不是跨平台业务门禁。
  if (process.platform === 'darwin') await waitForVisibleText(history, '选择一条记录查看详情')
  if (process.platform === 'darwin') {
    await history.locator('[data-smart-clipboard-capture-status]').filter({ hasText: '上限 100 条' }).waitFor()
  }

  await history.getByRole('button', { name: '暂停记录' }).click()
  await waitForCaptureState(page, 'paused')
  // Windows 默认单栏会隐藏桌面状态栏；macOS 双栏才额外验收这条可见反馈。
  if (process.platform === 'darwin') {
    await history.locator('[data-smart-clipboard-capture-status]').filter({ hasText: '已暂停' }).waitFor()
  }
  await history.getByRole('button', { name: '继续记录' }).click()
  await waitForCaptureState(page, 'recording')
  if (process.platform === 'darwin') {
    await history.locator('[data-smart-clipboard-capture-status]').filter({ hasText: '正在记录' }).waitFor()
  }
  await history.getByRole('button', { name: '查看' }).click()
  await page.getByRole('menuitem', { name: '记录与数据' }).click()
  const settingsForm = history.locator('[data-smart-clipboard-settings-form]')
  await settingsForm.getByText('不记录的内容', { exact: true }).click()
  await settingsForm.getByLabel('图片').check()
  await settingsForm.getByLabel(/来源应用标识/u).fill('com.example.private')
  await settingsForm.getByLabel('保留期限').selectOption('90')
  await settingsForm.getByRole('button', { name: '保存设置' }).click()
  await history.getByText('设置已保存', { exact: true }).waitFor()
  const savedSettings = await page.evaluate(() => window.hermitSmartClipboard.settings())
  assert.deepEqual(savedSettings.excludedKinds, ['IMAGE'])
  assert.deepEqual(savedSettings.excludedApplications, ['com.example.private'])
  assert.equal(savedSettings.retention, 90)
  assert.deepEqual(await page.evaluate(() => window.hermitSmartClipboard.status()), { state: 'recording' })
  await history.getByRole('button', { name: '返回 DSH 对话' }).click()
  await page.locator('[data-product-surface="smart-clipboard-history"]').waitFor({ state: 'detached' })

  await application.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hermit')
    if (main === undefined) throw new Error('Hermit main window missing')
    main.webContents.send('hermit:smart-clipboard:open-history')
  })
  await page.locator('[data-product-surface="smart-clipboard-history"]').waitFor({ timeout: 20_000 })
  assert.deepEqual(pageErrors, [])

  await application.close()
  application = undefined
  const profilePath = path.join(userData, 'dsh-home', 'profiles', 'web', 'package.json')
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'))
  profile.dsh.profile.bundles = profile.dsh.profile.bundles.filter((name) => name !== '@hermit/smart-clipboard')
  fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`)

  application = await launchApplication()
  const disabledPage = await waitForMainWindow(application)
  assert.equal(await disabledPage.getByRole('button', { name: '剪贴板历史' }).count(), 0)
  assert.deepEqual(await application.evaluate(({ BrowserWindow, globalShortcut }) => ({
    shortcut: globalShortcut.isRegistered('CommandOrControl+Shift+Space'),
    panels: BrowserWindow.getAllWindows().filter((window) => window.getTitle() === 'Smart Clipboard').length,
  })), { shortcut: false, panels: 0 })
  await application.close()
  application = undefined

  profile.dsh.profile.bundles.push('@hermit/smart-clipboard')
  fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`)
  application = await launchApplication()
  const reenabledPage = await waitForMainWindow(application)
  await openSidebar(reenabledPage)
  const reenabledNavigation = reenabledPage.getByRole('button', { name: '剪贴板历史' })
  await reenabledNavigation.waitFor({ timeout: 20_000 })
  assert.equal(await application.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('CommandOrControl+Shift+Space')), true)
  assert.deepEqual((await reenabledPage.evaluate(() => window.hermitSmartClipboard.settings())).excludedKinds, ['IMAGE'])

  await application.close()
  application = undefined
  console.log('Smart Clipboard packaged UI passed: history/settings, native runtime, disable/re-enable lifecycle')
  succeeded = true
} catch (cause) {
  console.error(`Smart Clipboard packaged UI 状态已保留：${root}`)
  throw cause
} finally {
  if (application !== undefined) await application.close().catch(() => undefined)
  if (succeeded) fs.rmSync(root, { recursive: true, force: true })
}

function launchApplication() {
  return electron.launch({
    executablePath,
    args: [`--user-data-dir=${userData}`, '--lang=zh-CN'],
    cwd: root,
    env: packagedElectronTestEnvironment(),
    timeout: 60_000,
  })
}

/** 升级验收使用真实旧版默认组合，确保包装后的主进程会完成一次性迁移。 */
function seedLegacyActionMapping() {
  const settingsDirectory = path.join(userData, 'smart-clipboard')
  fs.mkdirSync(settingsDirectory, { recursive: true })
  fs.writeFileSync(path.join(settingsDirectory, 'settings.json'), `${JSON.stringify({
    historyLimit: 100,
    totalBytes: 1_000_000_000,
    retention: 'forever',
    paused: false,
    actionMapping: { Enter: 'paste', 'Mod+Enter': 'copy', 'Shift+Enter': 'plain-text' },
    excludedApplications: [],
    excludedKinds: [],
  }, null, 2)}\n`)
}

async function waitForMainWindow(application) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const page = application.windows().find((candidate) => /^http:\/\/127\.0\.0\.1:\d+/u.test(candidate.url()))
    if (page !== undefined) {
      await page.locator('body').waitFor({ timeout: 30_000 })
      return page
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Hermit main window did not load DSH: ${application.windows().map((page) => page.url())}`)
}

async function waitForQuickPanel(application) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const page = application.windows().find((candidate) => candidate.url().includes('quick-retrieval'))
    if (page !== undefined) {
      await page.locator('body').waitFor({ timeout: 30_000 })
      return page
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Smart Clipboard Quick Panel did not load: ${application.windows().map((page) => page.url())}`)
}

async function dismissOnboarding(page) {
  const welcome = page.getByRole('dialog', { name: /^(Internal Testing Notice|内测声明)$/u })
  await welcome.waitFor({ timeout: 30_000 })
  await welcome.getByRole('button', { name: /^(Continue|继续)$/u }).click()
  const credential = page.getByRole('dialog', { name: /^(Add an API key to get started|添加一个 API Key 开始使用)$/u })
  await credential.waitFor({ timeout: 30_000 })
  await credential.getByRole('button', { name: /^(Configure later|稍后配置)$/u }).click()
  await credential.waitFor({ state: 'detached', timeout: 20_000 })
}

async function openSidebar(page) {
  const open = page.getByRole('button', { name: /^(Open sidebar|打开侧边栏)$/u })
  if (await open.isVisible().catch(() => false)) await open.click()
}

async function waitForVisibleText(scope, text, timeout = 20_000) {
  const deadline = Date.now() + timeout
  const candidates = scope.getByText(text, { exact: true })
  while (Date.now() < deadline) {
    const count = await candidates.count()
    for (let index = 0; index < count; index += 1) {
      if (await candidates.nth(index).isVisible()) return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Visible text did not appear: ${text}`)
}

/** 跨平台门禁以主进程拥有的捕获状态为准，避免响应式布局是否展示状态栏改变业务判定。 */
async function waitForCaptureState(page, expectedState) {
  await page.waitForFunction(
    async (state) => (await window.hermitSmartClipboard.status()).state === state,
    expectedState,
    { timeout: 20_000 },
  )
}
