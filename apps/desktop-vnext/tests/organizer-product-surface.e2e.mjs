import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import electronPath from 'electron'
import { _electron as playwrightElectron } from 'playwright-core'
import { copyRuntimeClosure } from '../scripts/after-pack.mjs'
import { packInstalledPackage } from './installed-package-artifact.mjs'

const appRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const repositoryRoot = path.resolve(appRoot, '..', '..')
const runtimeRoot = path.join(repositoryRoot, '.hermit', 'runtime')
const bundledNode = path.join(runtimeRoot, 'node', process.platform === 'win32' ? 'node.exe' : path.join('bin', 'node'))
const bundledDshRoot = path.join(runtimeRoot, 'dsh')
const bundledDsh = path.join(bundledDshRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const packageName = '@tianbuyv/organizer'
const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-organizer-package-'))
const pluginArtifact = packInstalledPackage({ repositoryRoot, packageName, outputDirectory: artifactRoot })

for (const required of [bundledNode, bundledDsh, pluginArtifact, electronPath]) {
  assert.equal(fs.existsSync(required), true, `Personal Organizer 资格缺少运行时文件：${required}`)
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-organizer-surface-'))
let succeeded = false
try {
  const stockDsh = prepareStockRuntime(path.join(root, 'stock-runtime'))
  await qualifyStock(stockDsh, pluginArtifact, path.join(root, 'stock'))
  await qualifyHermit(pluginArtifact, path.join(root, 'hermit'))
  console.log('Personal Organizer Product Surface qualification passed: stock=unavailable, hermit=todo+note-conversion+restart')
  succeeded = true
} catch (cause) {
  console.error(`Personal Organizer Product Surface 资格目录已保留：${root}`)
  throw cause
} finally {
  fs.rmSync(artifactRoot, { recursive: true, force: true })
  if (succeeded) fs.rmSync(root, { recursive: true, force: true })
}

async function qualifyStock(dshEntry, artifact, target) {
  const runtime = await startRuntime(dshEntry, artifact, target)
  try {
    await withBrowser(runtime.url, path.join(target, 'browser'), async (page) => {
      await openSidebar(page)
      assert.equal(await page.getByRole('button', { name: '个人事项' }).count(), 0)
    })
  } finally {
    await stopProcess(runtime.child)
  }
}

async function qualifyHermit(artifact, target) {
  const runtime = await startRuntime(bundledDsh, artifact, target)
  const title = '资格测试：提交周报'
  const noteTitle = '资格测试：门禁卡 9 月到期'
  try {
    await withBrowser(runtime.url, path.join(target, 'browser-first'), async (page) => {
      await openOrganizer(page)
      const surface = page.locator('[data-organizer-surface="ready"]')
      await surface.getByRole('button', { name: '新建' }).click()
      const drawer = page.getByRole('complementary', { name: '新建事项' })
      await drawer.waitFor({ timeout: 20_000 })
      await drawer.getByRole('button', { name: '待办' }).click()
      await drawer.getByRole('textbox', { name: '标题' }).fill(title)
      await drawer.getByRole('textbox', { name: '备注' }).fill('验证 Canonical 存储与重启恢复')
      await drawer.getByRole('button', { name: '创建' }).click()
      await surface.locator('[data-organizer-view="default"]').getByText(title, { exact: true }).waitFor({ timeout: 20_000 })
      assert.equal(await page.getByRole('complementary', { name: '事项详情' }).getByText('验证 Canonical 存储与重启恢复', { exact: true }).count(), 1)

      await surface.getByRole('button', { name: '新建' }).click()
      const noteDrawer = page.getByRole('complementary', { name: '新建事项' })
      await noteDrawer.getByRole('button', { name: '便签' }).click()
      await noteDrawer.getByRole('textbox', { name: '标题' }).fill(noteTitle)
      await noteDrawer.getByRole('textbox', { name: '正文' }).fill('2026 年 9 月前处理门禁卡续期')
      await noteDrawer.getByRole('button', { name: '创建' }).click()
      await page.getByRole('complementary', { name: '事项详情' }).getByRole('button', { name: '关闭右侧抽屉' }).click()
      await surface.locator('[data-organizer-view="default"]').getByText('最近便签', { exact: true }).click()
      await surface.locator('[data-organizer-view="default"]').getByText(noteTitle, { exact: true }).waitFor({ timeout: 20_000 })
      await surface.locator('[data-organizer-view="default"]').getByText(noteTitle, { exact: true }).click()
      const noteDetailDrawer = page.getByRole('complementary', { name: '事项详情' })
      await noteDetailDrawer.getByRole('button', { name: '编辑' }).click()
      const noteEditDrawer = page.getByRole('complementary', { name: '编辑事项' })
      await noteEditDrawer.getByRole('button', { name: '待办' }).click()
      await noteEditDrawer.getByRole('button', { name: '保存' }).click()
      const convertedDrawer = page.getByRole('complementary', { name: '事项详情' })
      await convertedDrawer.getByText('待办', { exact: true }).waitFor({ timeout: 20_000 })
      await convertedDrawer.getByText('2026 年 9 月前处理门禁卡续期', { exact: true }).waitFor({ timeout: 20_000 })
    })
  } finally {
    await stopProcess(runtime.child)
  }

  const restarted = await startRuntime(bundledDsh, artifact, target, false)
  try {
    await withBrowser(restarted.url, path.join(target, 'browser-restart'), async (page) => {
      await openOrganizer(page)
      const surface = page.locator('[data-organizer-surface="ready"]')
      await surface.locator('[data-organizer-view="default"]').getByText(title, { exact: true }).waitFor({ timeout: 20_000 })
      const row = surface.locator('[data-organizer-view="default"] li').filter({ hasText: title }).first()
      await row.getByRole('button').first().click()
      const todoDrawer = page.getByRole('complementary', { name: '事项详情' })
      await todoDrawer.waitFor({ timeout: 5_000 })
      assert.equal(await todoDrawer.getByText('验证 Canonical 存储与重启恢复', { exact: true }).count(), 1)
      await todoDrawer.getByRole('button', { name: '关闭右侧抽屉' }).click()
      const convertedRow = surface.locator('[data-organizer-view="default"] li').filter({ hasText: noteTitle }).first()
      await convertedRow.getByRole('button').first().click()
      const convertedDrawer = page.getByRole('complementary', { name: '事项详情' })
      await convertedDrawer.getByText('待办', { exact: true }).waitFor({ timeout: 20_000 })
      await convertedDrawer.getByText('2026 年 9 月前处理门禁卡续期', { exact: true }).waitFor({ timeout: 20_000 })
    })
  } finally {
    await stopProcess(restarted.child)
  }
}

async function openOrganizer(page) {
  await openSidebar(page)
  const navigation = page.getByRole('button', { name: '个人事项' })
  await navigation.waitFor({ timeout: 20_000 })
  await navigation.click()
  await page.locator('[data-organizer-surface="ready"]').waitFor({ timeout: 20_000 })
}

function prepareStockRuntime(target) {
  copyRuntimeClosure(bundledDshRoot, target)
  const require = createRequire(import.meta.url)
  const officialWebApp = require.resolve('@deepseek-ai/dsh-web-app/package.json')
  const officialRequire = createRequire(officialWebApp)
  const officialLayout = path.dirname(officialRequire.resolve('@deepseek-ai/dsh-client-ui-layout/package.json'))
  const nodeModules = path.join(target, 'node_modules')
  const layouts = new Set([path.join(nodeModules, '@deepseek-ai', 'dsh-client-ui-layout')])
  for (const consumer of ['dsh-web-app', 'dsh-client-ui-sidebar', 'dsh-client-ui-conversation']) {
    const manifest = path.join(nodeModules, '@deepseek-ai', consumer, 'package.json')
    if (fs.existsSync(manifest)) layouts.add(path.dirname(createRequire(manifest).resolve('@deepseek-ai/dsh-client-ui-layout/package.json')))
  }
  for (const layout of layouts) {
    fs.rmSync(layout, { recursive: true, force: true })
    fs.mkdirSync(layout, { recursive: true })
    for (const entry of ['LICENSE', 'package.json', 'lib']) fs.cpSync(path.join(officialLayout, entry), path.join(layout, entry), { recursive: true, dereference: true })
    assert.equal(JSON.parse(fs.readFileSync(path.join(layout, 'package.json'), 'utf8')).hermitPatch, undefined, 'stock DSH 闭包意外包含 Hermit patch')
  }
  return path.join(target, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

async function startRuntime(dshEntry, artifact, target, install = true) {
  const home = path.join(target, 'home')
  const workspace = path.join(target, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  const env = runtimeEnvironment(home)
  if (install) run(bundledNode, [dshEntry, 'plugin', '--profile', 'web', 'add', artifact], { cwd: workspace, env })
  const profilePath = path.join(home, 'profiles', 'web', 'package.json')
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'))
  assert.equal(typeof profile.dependencies?.[packageName], 'string')
  assert.equal(profile.dsh.profile.bundles.includes(packageName), true)
  const child = spawn(bundledNode, [dshEntry, 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    cwd: workspace,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  })
  return { child, url: await waitForReady(child) }
}

async function withBrowser(url, browserRoot, verify) {
  fs.mkdirSync(browserRoot, { recursive: true })
  fs.writeFileSync(path.join(browserRoot, 'package.json'), JSON.stringify({ private: true, main: 'main.cjs' }))
  fs.writeFileSync(path.join(browserRoot, 'main.cjs'), `const { app, BrowserWindow } = require('electron')\napp.commandLine.appendSwitch('lang', 'zh-CN')\napp.whenReady().then(async () => { const window = new BrowserWindow({ show: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } }); await window.loadURL(process.env.HERMIT_ORGANIZER_URL) })\napp.on('window-all-closed', () => app.quit())\n`)
  const application = await playwrightElectron.launch({ executablePath: electronPath, args: [browserRoot], cwd: browserRoot, env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', HERMIT_ORGANIZER_URL: url.href }, timeout: 60_000 })
  const page = await application.firstWindow({ timeout: 60_000 })
  const pageErrors = []
  page.on('pageerror', (cause) => pageErrors.push(cause.message))
  try {
    await dismissOnboarding(page)
    await verify(page)
    assert.deepEqual(pageErrors, [])
    await captureSuccessScreenshot(page, browserRoot)
  } catch (cause) {
    await page.screenshot({ path: path.join(browserRoot, 'failure.png'), fullPage: true }).catch(() => undefined)
    fs.writeFileSync(path.join(browserRoot, 'failure.html'), await page.content(), 'utf8')
    throw cause
  } finally {
    await application.close().catch(() => undefined)
  }
}

async function captureSuccessScreenshot(page, browserRoot) {
  const captureRoot = process.env.HERMIT_CAPTURE_SCREENSHOTS_DIR
  if (captureRoot === undefined) return
  fs.mkdirSync(captureRoot, { recursive: true })
  await page.screenshot({ path: path.join(captureRoot, `organizer-${path.basename(browserRoot)}.png`), fullPage: true })
}

async function dismissOnboarding(page) {
  await page.locator('body').waitFor({ timeout: 30_000 })
  const welcome = page.getByRole('dialog', { name: /^(Internal Testing Notice|内测声明)$/u })
  await welcome.waitFor({ timeout: 5_000 }).catch(() => undefined)
  if (await welcome.isVisible().catch(() => false)) await welcome.getByRole('button', { name: /^(Continue|继续)$/u }).click()
  const credential = page.getByRole('dialog', { name: /^(Add an API key to get started|添加一个 API Key 开始使用)$/u })
  await credential.waitFor({ timeout: 5_000 }).catch(() => undefined)
  if (await credential.isVisible().catch(() => false)) {
    await credential.getByRole('button', { name: /^(Configure later|稍后配置)$/u }).click()
    await credential.waitFor({ state: 'detached', timeout: 20_000 })
  }
}

async function openSidebar(page) {
  const open = page.getByRole('button', { name: /^(Open sidebar|打开侧边栏)$/u })
  if (await open.isVisible().catch(() => false)) await open.click()
}

function run(command, args, options) {
  const result = spawnSync(command, args, { ...options, encoding: 'utf8', windowsHide: true })
  if (result.error !== undefined) throw result.error
  assert.equal(result.status, 0, `${result.stdout ?? ''}\n${result.stderr ?? ''}`)
}

function runtimeEnvironment(home) {
  const environment = { ...process.env, DSH_HOME: home, PATH: [path.dirname(bundledNode), path.join(bundledDshRoot, 'node_modules', '.bin'), process.env.PATH].filter(Boolean).join(path.delimiter) }
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

async function waitForReady(child) {
  let output = ''
  const deadline = Date.now() + 30_000
  return await new Promise((resolve, reject) => {
    const timer = setInterval(() => { if (Date.now() >= deadline) { clearInterval(timer); reject(new Error(`DSH 未在期限内 ready：${output}`)) } }, 100)
    const inspect = (chunk) => { output += chunk.toString('utf8'); const match = /\bdsh web:\s+(http:\/\/127\.0\.0\.1:\d+)/u.exec(output); if (match?.[1] !== undefined) { clearInterval(timer); resolve(new URL(match[1])) } }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('error', reject)
    child.once('exit', (code, signal) => reject(new Error(`DSH ready 前退出 code=${String(code)} signal=${String(signal)}：${output}`)))
  })
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  if (process.platform === 'win32' && child.pid !== undefined) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
  else if (child.pid !== undefined) process.kill(-child.pid, 'SIGTERM')
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))])
}
