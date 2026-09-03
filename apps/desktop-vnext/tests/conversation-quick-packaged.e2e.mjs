import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundledGenerationRoot, defaultResourcesPath } from '../scripts/runtime-paths.mjs'
import { _electron as electron } from 'playwright-core'
import { packagedElectronTestEnvironment } from './packaged-electron-harness.mjs'

const appRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const fixtureRoot = path.join(appRoot, 'tests', 'fixtures', 'organizer-ai-replay')
const fixturePath = path.join(fixtureRoot, 'session.jsonl')
const overridePath = path.join(fixtureRoot, 'replay.override.json')
const resourcesPath = defaultResourcesPath(appRoot, process.platform, process.arch)
const generationRoot = bundledGenerationRoot(resourcesPath)
const dshRoot = path.join(generationRoot, 'dsh')
const nodeBinary = path.join(generationRoot, 'node', 'bin', 'node')
const dshEntry = path.join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const executablePath = path.join(
  appRoot,
  'dist',
  process.arch === 'arm64' ? 'mac-arm64' : 'mac',
  'Hermit.app',
  'Contents',
  'MacOS',
  'Hermit',
)

if (process.platform !== 'darwin') {
  throw new Error(`Conversation Quick packaged UI 验收尚不支持 ${process.platform}`)
}
assert.equal(fs.existsSync(executablePath), true, `Hermit packaged executable is missing: ${executablePath}`)
for (const [label, file] of [['bundled Node', nodeBinary], ['bundled DSH', dshEntry], ['replay fixture', fixturePath], ['replay override', overridePath]]) {
  assert.equal(fs.existsSync(file), true, `${label} is missing: ${file}`)
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-conversation-quick-packaged-'))
const userData = path.join(root, 'user-data')
const workspace = path.join(root, 'workspace')
const profileHome = path.join(userData, 'dsh-home')
fs.mkdirSync(workspace, { recursive: true })
let application
let succeeded = false

try {
  stageReplayProfile()
  application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userData}`, '--lang=zh-CN'],
    cwd: workspace,
    env: packagedElectronTestEnvironment({ SSH_TTY: 'hermit-conversation-quick' }),
    timeout: 60_000,
  })
  const mainPage = await waitForMainWindow(application)
  await passOnboarding(mainPage)
  await connectWorkspace(mainPage)
  const opened = await mainPage.evaluate(() => window.hermitDesktopSurface.toggle('conversation.quick'))
  assert.deepEqual(opened, { status: 'opened', id: 'conversation.quick' })

  const quickPage = await waitForSurfaceWindow(application)
  try {
    await quickPage.locator('[data-hermit-surface="conversation.quick"]').waitFor({ timeout: 30_000 })
  } catch (cause) {
    console.error('Conversation Quick surface diagnostics', {
      url: quickPage.url(),
      title: await quickPage.title().catch(() => ''),
      body: (await quickPage.locator('body').innerText().catch(() => '')).slice(0, 2_000),
      errors: await quickPage.evaluate(() => window.__hermitQuickErrors ?? []).catch(() => []),
    })
    throw cause
  }
  await connectWorkspace(quickPage)
  const requestedSessionId = new URL(quickPage.url()).searchParams.get('sessionId')
  assert.equal(requestedSessionId, null)
  await waitForQuickState(quickPage, 'composer')
  const composerWindow = await readQuickWindow(application)
  assert.equal(composerWindow.visible, true)
  assert.equal(composerWindow.alwaysOnTop, false)
  assert.deepEqual(
    { width: composerWindow.bounds.width, height: composerWindow.bounds.height },
    { width: 560, height: 120 },
  )
  assert.deepEqual(
    { width: composerWindow.contentBounds.width, height: composerWindow.contentBounds.height },
    { width: composerWindow.bounds.width, height: composerWindow.bounds.height },
  )
  const quickInput = quickPage.locator('[data-quick-composer] textarea:enabled')
  await quickInput.waitFor({ timeout: 30_000 })
  await quickInput.fill('今天的安排是什么？')
  await quickInput.press('Enter')
  await waitForVisibleText(quickPage, '今天没有过期待办、今日待办或今日事件。', 30_000)
  await waitForQuickState(quickPage, 'chat')
  assert.equal(await quickPage.locator('[data-quick-new-chat]').count(), 1)
  assert.equal(await quickPage.locator('[data-quick-open-main]').count(), 1)
  assert.equal(await quickPage.locator('[data-quick-session]').count(), 1)
  assert.equal(await quickPage.locator('[data-quick-chat]').count(), 1)
  const quickControlsRect = await quickPage.locator('[data-quick-new-chat]').boundingBox()
  const firstUserMessageRects = await quickPage.getByText('今天的安排是什么？', { exact: true }).evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }).filter((rect) => rect.width > 0 && rect.height > 0))
  assert.notEqual(quickControlsRect, null)
  assert.equal(firstUserMessageRects.length > 0, true)
  const firstUserMessageRect = firstUserMessageRects[0]
  assert.equal(firstUserMessageRect.y > 0, true)

  const chatWindow = await readQuickWindow(application)
  assert.equal(chatWindow.visible, true)
  assert.equal(chatWindow.alwaysOnTop, false)
  assert.deepEqual(
    { width: chatWindow.bounds.width, height: chatWindow.bounds.height },
    { width: 600, height: 440 },
  )

  await quickPage.locator('[data-quick-open-main]').click()
  await mainPage.waitForFunction(() => new URL(window.location.href).searchParams.has('sessionId'), undefined, { timeout: 30_000 })
  const handedOffSessionId = new URL(mainPage.url()).searchParams.get('sessionId')
  assert.notEqual(handedOffSessionId, null)
  await waitForQuickVisibility(application, false)

  const quickWindow = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === 'Hermit 对话')
    if (window === undefined) throw new Error('Conversation Quick window missing')
    return {
      bounds: window.getBounds(),
      alwaysOnTop: window.isAlwaysOnTop(),
      visible: window.isVisible(),
    }
  })
  assert.equal(quickWindow.visible, false)

  const reopened = await mainPage.evaluate(() => window.hermitDesktopSurface.toggle('conversation.quick'))
  assert.deepEqual(reopened, { status: 'opened', id: 'conversation.quick' })
  await waitForQuickState(quickPage, 'composer')
  assert.equal(new URL(quickPage.url()).searchParams.get('sessionId'), null)
  await quickPage.keyboard.press('Escape')
  await quickPage.waitForTimeout(250)

  // Explicitly binding the handed-off Session is the supported way to show
  // the chat state again; the New Chat action must then return to a fresh
  // composer without inheriting that Session.
  const rebound = await mainPage.evaluate((sessionId) => window.hermitDesktopSurface.open('conversation.quick', {
    session: { type: 'existing', sessionId },
  }), handedOffSessionId)
  assert.deepEqual(rebound, { status: 'opened', id: 'conversation.quick' })
  await waitForQuickState(quickPage, 'chat')
  await quickPage.locator('[data-quick-new-chat]').click()
  await waitForQuickState(quickPage, 'composer')
  assert.equal(new URL(quickPage.url()).searchParams.get('sessionId'), null)
  await quickPage.keyboard.press('Escape')
  await waitForQuickVisibility(application, false)
  await application.close()
  application = undefined
  console.log('Conversation Quick packaged UI passed: DSH surface, window policy and toggle lifecycle')
  succeeded = true
} finally {
  if (application !== undefined) await application.close().catch(() => undefined)
  if (succeeded) fs.rmSync(root, { recursive: true, force: true })
}

function runtimeEnvironment() {
  const environment = {
    ...process.env,
    DSH_HOME: profileHome,
    PATH: [path.dirname(nodeBinary), path.join(dshRoot, 'node_modules', '.bin'), process.env.PATH ?? ''].filter(Boolean).join(path.delimiter),
  }
  delete environment.Path
  delete environment.NODE_OPTIONS
  delete environment.NODE_PATH
  delete environment.node_path
  delete environment.PNPM_HOME
  delete environment.COREPACK_HOME
  for (const key of Object.keys(environment)) {
    const normalized = key.toLowerCase()
    if (normalized === 'npm_execpath' || normalized === 'npm_node_execpath' || normalized.startsWith('npm_config_') || normalized.startsWith('pnpm_config_')) delete environment[key]
  }
  return environment
}

function stageReplayProfile() {
  const install = spawnSync(nodeBinary, [dshEntry, 'plugin', '--profile', 'web', 'add', '-E', '@deepseek-ai/dsh-llm-replay@0.1.1-rc.2'], {
    cwd: workspace,
    env: runtimeEnvironment(),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  })
  assert.equal(install.status, 0, `${install.stdout}\n${install.stderr}`)
  const profileRoot = path.join(profileHome, 'profiles', 'web')
  const profile = JSON.parse(fs.readFileSync(path.join(profileRoot, 'package.json'), 'utf8'))
  assert.equal(profile.dependencies?.['@deepseek-ai/dsh-llm-replay'], '0.1.1-rc.2')
  fs.writeFileSync(path.join(profileRoot, 'cordis.patch.yml'), `# Hermit keyless Conversation Quick overlay.
- id: llm-deepseek
  disabled: true

- id: session-title-llm
  disabled: true

- insert:
    - id: llm-replay
      name: '@deepseek-ai/dsh-llm-replay'
      config:
        file: ${JSON.stringify(fixturePath)}
        overrideFile: ${JSON.stringify(overridePath)}
        paceMs: 15
        providers:
          - id: deepseek-official
            name: DeepSeek
            retryPolicy:
              mode: normal
              backoff:
                initialDelayMs: 1
                maxDelayMs: 1
                jitterRatio: 0
            models:
              - id: deepseek-v4-flash
                contextWindow: 128000
`)
}

async function passOnboarding(page) {
  const welcome = page.getByRole('dialog', { name: /^(Internal Testing Notice|内测声明)$/u })
  await welcome.waitFor({ state: 'visible', timeout: 30_000 })
  await welcome.getByRole('button', { name: /^(Continue|继续)$/u }).click()
  const credential = page.getByRole('dialog', { name: /^(Add an API key to get started|添加一个 API Key 开始使用)$/u })
  if (await credential.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)) {
    await credential.getByRole('button', { name: /^(Configure later|稍后配置)$/u }).click()
    await credential.waitFor({ state: 'detached', timeout: 20_000 })
  }
}

async function connectWorkspace(page) {
  const choose = page.getByRole('textbox', { name: /Choose workspace|选择工作区/u })
  if (!(await choose.isVisible({ timeout: 2_000 }).catch(() => false))) return
  await choose.click()
  const dialog = page.getByRole('dialog', { name: /Select Workspace Directory|选择工作区目录/u })
  await dialog.waitFor({ timeout: 10_000 })
  await dialog.getByRole('button', { name: /Edit path|编辑路径/u }).click()
  const pathInput = dialog.getByRole('textbox', { name: /Edit path|编辑路径/u })
  await pathInput.fill(workspace)
  await pathInput.press('Enter')
  await dialog.getByRole('button').filter({ hasText: /^(Open|打开)$/u }).click()
  const readyInput = page.url().includes('hermitSurface=conversation.quick')
    ? page.locator('[data-quick-composer] textarea:enabled')
    : page.locator('textarea:enabled').first()
  await readyInput.waitFor({ timeout: 20_000 })
}

async function waitForMainWindow(app) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const page = app.windows().find((candidate) => /^http:\/\/127\.0\.0\.1:\d+/u.test(candidate.url()))
    if (page !== undefined) {
      await page.locator('body').waitFor({ timeout: 30_000 })
      return page
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Hermit main window did not load DSH: ${app.windows().map((page) => page.url()).join(', ')}`)
}

async function waitForSurfaceWindow(app) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const page = app.windows().find((candidate) => candidate.url().includes('hermitSurface=conversation.quick'))
    if (page !== undefined) return page
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Conversation Quick window did not load: ${app.windows().map((page) => page.url()).join(', ')}`)
}

async function waitForVisibleText(page, text, timeout) {
  const deadline = Date.now() + timeout
  const locator = page.getByText(text, { exact: true })
  while (Date.now() < deadline) {
    for (let index = 0; index < await locator.count(); index += 1) {
      if (await locator.nth(index).isVisible().catch(() => false)) return
    }
    await page.waitForTimeout(100)
  }
  throw new Error(`Visible text did not appear: ${text}`)
}

async function waitForQuickState(page, state) {
  await page.locator(`[data-quick-state="${state}"]`).waitFor({ timeout: 30_000 })
}

async function readQuickWindow(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === 'Hermit 对话')
    if (window === undefined) throw new Error('Conversation Quick window missing')
    return {
      bounds: window.getBounds(),
      contentBounds: window.getContentBounds(),
      alwaysOnTop: window.isAlwaysOnTop(),
      visible: window.isVisible(),
    }
  })
}

async function waitForQuickVisibility(app, expected) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const visible = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === 'Hermit 对话')
      return window?.isVisible() ?? false
    })
    if (visible === expected) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Conversation Quick visibility did not become ${String(expected)}`)
}
