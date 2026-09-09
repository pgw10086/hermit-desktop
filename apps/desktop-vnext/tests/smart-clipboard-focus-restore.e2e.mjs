import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { packagedElectronTestEnvironment } from './packaged-electron-harness.mjs'

const execFileAsync = promisify(execFile)
const appRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const executablePath = process.platform === 'darwin'
  ? path.join(appRoot, 'dist', 'mac-arm64', 'Hermit.app', 'Contents', 'MacOS', 'Hermit')
  : path.join(appRoot, 'dist', 'win-unpacked', 'Hermit.exe')

if (process.platform !== 'darwin') {
  console.log('Smart Clipboard focus restore packaged E2E skipped: requires macOS external-app focus')
  process.exit(0)
}
assert.equal(fs.existsSync(executablePath), true, `Hermit packaged executable is missing: ${executablePath}`)

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-smart-clipboard-focus-restore-'))
const userData = path.join(root, 'user-data')
let application
let succeeded = false

try {
  application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userData}`, '--lang=zh-CN'],
    cwd: root,
    env: packagedElectronTestEnvironment(),
    timeout: 60_000,
  })
  const mainPage = await waitForMainWindow(application)
  await dismissOnboarding(mainPage)
  const quickPage = await waitForQuickPanel(application)

  const visibleMain = await runDismissScenario(application, mainPage, quickPage, true)
  assert.notEqual(visibleMain.externalApp, 'Hermit')
  assert.notEqual(visibleMain.after.frontmost, 'Hermit')
  assert.equal(visibleMain.after.appActive, false)
  assert.deepEqual({ mainVisible: visibleMain.after.mainVisible, mainFocused: visibleMain.after.mainFocused }, { mainVisible: true, mainFocused: false })

  const hiddenMain = await runDismissScenario(application, mainPage, quickPage, false)
  assert.notEqual(hiddenMain.externalApp, 'Hermit')
  assert.notEqual(hiddenMain.after.frontmost, 'Hermit')
  assert.equal(hiddenMain.after.appActive, false)
  assert.deepEqual({ mainVisible: hiddenMain.after.mainVisible, mainFocused: hiddenMain.after.mainFocused }, { mainVisible: false, mainFocused: false })

  console.log('Smart Clipboard focus restore packaged E2E passed: Escape restores the external app without opening Hermit main')
  succeeded = true
} finally {
  if (application !== undefined) await application.close().catch(() => undefined)
  if (succeeded) fs.rmSync(root, { recursive: true, force: true })
}

async function runDismissScenario(application, mainPage, quickPage, mainVisible) {
  await application.evaluate(({ BrowserWindow }, visible) => {
    const main = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hermit')
    const quick = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Smart Clipboard')
    if (main === undefined || quick === undefined) throw new Error('Smart Clipboard windows missing')
    quick.hide()
    if (visible) main.show()
    else main.hide()
  }, mainVisible)
  await activateFinder()
  const externalApp = await frontmostApplication()
  assert.notEqual(externalApp, 'Hermit')

  const opened = await mainPage.evaluate(() => window.hermitDesktopSurface.open('smart-clipboard.quick-retrieval'))
  assert.deepEqual(opened, { status: 'opened', id: 'smart-clipboard.quick-retrieval' })
  await waitForWindowVisibility(application, 'Smart Clipboard', true)
  await quickPage.locator('input[type="search"]').focus()
  await quickPage.keyboard.press('Escape')
  await waitForWindowVisibility(application, 'Smart Clipboard', false)
  await new Promise((resolve) => setTimeout(resolve, 250))

  const after = await application.evaluate(({ app, BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hermit')
    return {
      frontmost: null,
      appActive: app.isActive(),
      mainVisible: main?.isVisible() ?? false,
      mainFocused: main?.isFocused() ?? false,
    }
  })
  return { externalApp, after: { ...after, frontmost: await frontmostApplication() } }
}

async function activateFinder() {
  await execFileAsync('/usr/bin/osascript', ['-e', 'tell application "Finder" to activate'])
}

async function frontmostApplication() {
  const { stdout } = await execFileAsync('/usr/bin/osascript', [
    '-e', 'tell application "System Events" to get name of first application process whose frontmost is true',
  ])
  return stdout.trim()
}

async function waitForMainWindow(application) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const page = application.windows().find((candidate) => /^http:\/\/127\.0\.0\.1:\d+/u.test(candidate.url()))
    if (page !== undefined) return page
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Hermit main window did not load DSH: ${application.windows().map((page) => page.url())}`)
}

async function waitForQuickPanel(application) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const page = application.windows().find((candidate) => candidate.url().includes('quick-retrieval'))
    if (page !== undefined) return page
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Smart Clipboard Quick Panel did not load: ${application.windows().map((page) => page.url())}`)
}

async function waitForWindowVisibility(application, title, expected) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const visible = await application.evaluate(({ BrowserWindow }, input) => {
      return BrowserWindow.getAllWindows().find((window) => window.getTitle() === input.title)?.isVisible() ?? false
    }, { title })
    if (visible === expected) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`${title} visibility did not become ${String(expected)}`)
}

async function dismissOnboarding(page) {
  const welcome = page.getByRole('dialog', { name: /^(Internal Testing Notice|内测声明)$/u })
  if (await welcome.count() > 0) {
    await welcome.getByRole('button', { name: /^(Continue|继续)$/u }).click()
  }
  const credential = page.getByRole('dialog', { name: /^(Add an API key to get started|添加一个 API Key 开始使用)$/u })
  if (await credential.count() > 0) {
    await credential.getByRole('button', { name: /^(Configure later|稍后配置)$/u }).click()
    await credential.waitFor({ state: 'detached', timeout: 20_000 })
  }
}
