import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright-core'
import { packagedElectronTestEnvironment } from './packaged-electron-harness.mjs'
import { bundledGenerationRoot, defaultResourcesPath } from '../scripts/runtime-paths.mjs'

const appRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'organizer-ai-replay')
const fixturePath = path.join(fixtureRoot, 'session.jsonl')
const overridePath = path.join(fixtureRoot, 'replay.override.json')
const resourcesPath = defaultResourcesPath(appRoot, process.platform, process.arch)
const generationRoot = bundledGenerationRoot(resourcesPath)
const dshRoot = path.join(generationRoot, 'dsh')
const nodeBinary = path.join(generationRoot, 'node', process.platform === 'win32' ? 'node.exe' : path.join('bin', 'node'))
const dshEntry = path.join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const executablePath = process.platform === 'darwin'
  ? path.join(appRoot, 'dist', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Hermit.app', 'Contents', 'MacOS', 'Hermit')
  : path.join(appRoot, 'dist', 'win-unpacked', 'Hermit.exe')

if (!new Set(['darwin', 'win32']).has(process.platform)) throw new Error(`Organizer AI Replay 尚不支持 ${process.platform}`)
for (const [label, file] of [
  ['Hermit executable', executablePath],
  ['bundled Node', nodeBinary],
  ['bundled DSH', dshEntry],
  ['replay fixture', fixturePath],
  ['replay override', overridePath],
]) assert.equal(fs.existsSync(file), true, `${label} is missing: ${file}`)

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-organizer-ai-replay-'))
const userData = path.join(root, 'user-data')
const workspace = path.join(root, 'workspace')
const profileHome = path.join(userData, 'dsh-home')
fs.mkdirSync(workspace, { recursive: true })
let application
let succeeded = false

try {
  stageReplayProfile()
  application = await launchApp()
  const page = await readyPage(application)
  await passOnboarding(page)
  await connectWorkspace(page)

  const firstInput = page.locator('textarea:enabled').first()
  await firstInput.waitFor({ timeout: 20_000 })
  await firstInput.fill('今天的安排是什么？')
  await firstInput.press('Enter')
  await page.getByText('今天没有过期待办、今日待办或今日事件。', { exact: true }).first().waitFor({ timeout: 90_000 })

  const secondInput = page.locator('textarea:enabled').first()
  await secondInput.fill('帮我记一个待办：准备二期验收，检查三个插件和 AI 闭环')
  await secondInput.press('Enter')
  await waitForCanonicalTodo()
  assert.equal(await page.locator('[data-approval-key]').count(), 0)

  const followUpInput = page.locator('textarea:enabled').first()
  await followUpInput.waitFor({ timeout: 20_000 })
  await followUpInput.fill('请确认刚才的待办已经记录。')
  await followUpInput.press('Enter')
  await page.getByText('已确认，刚才的待办已经记录。', { exact: true }).first().waitFor({ timeout: 90_000 })

  await openSidebar(page)
  const organizer = page.getByRole('button', { name: '个人事项' })
  await organizer.waitFor({ timeout: 20_000 })
  await organizer.click()
  const surface = page.locator('[data-organizer-surface="ready"]')
  await surface.waitFor({ timeout: 20_000 })
  await surface.getByText('准备二期验收', { exact: true }).waitFor({ timeout: 20_000 })
  assert.equal(await surface.getByText('检查三个插件和 AI 闭环', { exact: true }).count(), 1)
  assertPersistedSession()
  await captureSuccessScreenshot(page)
  console.log('Organizer AI Replay passed: same DSH Session read -> normal write -> follow-up -> Canonical readback')
  succeeded = true
} catch (cause) {
  const page = application?.windows().find((candidate) => /^http:\/\/127\.0\.0\.1:\d+/u.test(candidate.url()))
  await page?.screenshot({ path: path.join(root, 'failure.png'), fullPage: true }).catch(() => undefined)
  console.error(`Organizer AI Replay isolated state retained for diagnosis: ${root}`)
  throw cause
} finally {
  await closeApp(application)
  if (succeeded) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
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
  fs.writeFileSync(path.join(profileRoot, 'cordis.patch.yml'), `# Hermit keyless Organizer AI qualification overlay.
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

async function launchApp() {
  return electron.launch({
    executablePath,
    args: [`--user-data-dir=${userData}`, '--lang=zh-CN'],
    cwd: workspace,
    env: packagedElectronTestEnvironment({ SSH_TTY: 'hermit-organizer-ai-replay' }),
    timeout: 60_000,
  })
}

async function readyPage(app) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const page = app.windows().find((candidate) => /^http:\/\/127\.0\.0\.1:\d+/u.test(candidate.url()))
    if (page !== undefined) {
      await page.locator('[class*="frame"]').waitFor({ timeout: 30_000 })
      return page
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Hermit main window did not load DSH; windows=${app.windows().map((page) => page.url()).join(', ')}`)
}

async function passOnboarding(page) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const button = page.getByRole('button', { name: /Continue|继续|Configure later|稍后配置/u }).first()
    if (!(await button.isVisible({ timeout: 1_000 }).catch(() => false))) return
    if (!(await button.isEnabled().catch(() => false))) {
      await page.waitForTimeout(250)
      continue
    }
    await button.click({ timeout: 5_000 }).catch(() => undefined)
    await page.waitForTimeout(250)
  }
  throw new Error('DSH onboarding did not settle within 30 seconds')
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
  await page.locator('textarea:enabled').first().waitFor({ timeout: 20_000 })
}

async function openSidebar(page) {
  const open = page.getByRole('button', { name: /^(Open sidebar|打开侧边栏)$/u })
  if (await open.isVisible().catch(() => false)) await open.click()
}

function assertPersistedSession() {
  const sessions = [
    ...findFiles(path.join(profileHome, 'sessions'), '.jsonl'),
    ...findFiles(path.join(profileHome, 'sessions'), '.jsonl.zstd'),
  ]
  assert.ok(sessions.length > 0, 'DSH did not persist the Organizer AI Session log')
}

async function waitForCanonicalTodo() {
  const storagePath = path.join(profileHome, 'storages', 'personal_organizer.json')
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (fs.existsSync(storagePath)) {
      const storage = JSON.parse(fs.readFileSync(storagePath, 'utf8'))
      const items = Object.values(storage.tables?.items ?? {})
      const todo = items.find((item) => item.title === '准备二期验收')
      if (todo?.detail === '检查三个插件和 AI 闭环' && todo.status === 'planned') return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Organizer Canonical storage did not contain the created Todo')
}

function findFiles(rootPath, suffix) {
  if (!fs.existsSync(rootPath)) return []
  return fs.readdirSync(rootPath, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(rootPath, entry.name)
    return entry.isDirectory() ? findFiles(fullPath, suffix) : entry.name.endsWith(suffix) ? [fullPath] : []
  })
}

async function captureSuccessScreenshot(page) {
  const captureRoot = process.env.HERMIT_CAPTURE_SCREENSHOTS_DIR
  if (captureRoot === undefined) return
  fs.mkdirSync(captureRoot, { recursive: true })
  await page.screenshot({ path: path.join(captureRoot, 'organizer-ai-replay-canonical-readback.png'), fullPage: true })
}

async function closeApp(app) {
  if (app === undefined || app.process().exitCode !== null) return
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined)
  await app.close().catch(() => undefined)
}
