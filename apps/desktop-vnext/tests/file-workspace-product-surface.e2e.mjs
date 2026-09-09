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
import { lockedPlatformArtifact } from './locked-platform-artifact.mjs'

const appRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const repositoryRoot = path.resolve(appRoot, '..', '..')
const pluginArtifact = lockedPlatformArtifact(repositoryRoot, 'file-workspace')
const runtimeRoot = path.join(repositoryRoot, '.hermit', 'runtime')
const bundledNode = path.join(runtimeRoot, 'node', process.platform === 'win32' ? 'node.exe' : path.join('bin', 'node'))
const bundledDshRoot = path.join(runtimeRoot, 'dsh')
const bundledDsh = path.join(bundledDshRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const packageName = '@hermit/file-workspace'

for (const required of [bundledNode, bundledDsh, pluginArtifact, electronPath]) assert.equal(fs.existsSync(required), true, `File Workspace 资格缺少运行时文件：${required}`)

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-file-workspace-surface-'))
let succeeded = false
try {
  const stockDsh = prepareStockRuntime(path.join(root, 'stock-runtime'))
  await qualifyStock(stockDsh, pluginArtifact, path.join(root, 'stock'))
  await qualifyHermit(pluginArtifact, path.join(root, 'hermit'))
  console.log('File Workspace Product Surface qualification passed: stock=unavailable, hermit=managed lifecycle')
  succeeded = true
} catch (cause) {
  console.error(`File Workspace 资格目录已保留：${root}`)
  throw cause
} finally {
  if (succeeded) fs.rmSync(root, { recursive: true, force: true })
}

async function qualifyStock(dshEntry, artifact, target) {
  const runtime = await startRuntime(dshEntry, artifact, target)
  try {
    await withBrowser(runtime.url, path.join(target, 'browser'), async (page) => {
      await openSidebar(page)
      assert.equal(await page.getByRole('button', { name: '文件工作区' }).count(), 0)
    })
  } finally { await stopProcess(runtime.child) }
}

async function qualifyHermit(artifact, target) {
  const runtime = await startRuntime(bundledDsh, artifact, target)
  try {
    await withBrowser(runtime.url, path.join(target, 'browser'), async (page) => {
      await openSidebar(page)
      const navigation = page.getByRole('button', { name: '文件工作区' })
      await navigation.waitFor({ timeout: 20_000 })
      await navigation.click()
      const surface = page.locator('[data-file-workspace-surface="ready"]')
      await surface.waitFor({ timeout: 20_000 })
      const theme = await surface.evaluate((element) => {
        const surfaceStyle = getComputedStyle(element)
        const hostStyle = getComputedStyle(document.body)
        const requiredTokens = [
          '--dsw-alias-bg-base',
          '--dsw-alias-bg-layer-1',
          '--dsw-alias-bg-layer-2',
          '--dsw-alias-border-l2',
          '--dsw-alias-label-primary',
          '--dsw-alias-label-secondary',
          '--dsw-alias-interactive-bg-active',
          '--dsw-alias-brand-primary',
        ]
        return {
          background: surfaceStyle.backgroundColor,
          hostBackground: hostStyle.backgroundColor,
          color: surfaceStyle.color,
          hostColor: hostStyle.color,
          unresolved: requiredTokens.filter((token) => surfaceStyle.getPropertyValue(token).trim() === ''),
        }
      })
      assert.deepEqual(theme.unresolved, [])
      assert.equal(theme.background, theme.hostBackground)
      assert.equal(theme.color, theme.hostColor)
      await surface.getByRole('button', { name: '新建快速记事' }).click()
      const note = surface.locator('textarea[aria-label^="编辑 快速记事"]')
      await note.waitFor({ timeout: 20_000 })
      assert.equal(await note.inputValue(), '')
      await note.fill('# smoke')
      await surface.getByText('已保存', { exact: true }).waitFor({ timeout: 20_000 })
      const fileInput = surface.locator('input[type="file"]')
      await fileInput.setInputFiles({ name: 'smoke.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 255, 1]) })
      const importDialog = page.getByRole('dialog', { name: '添加文件' })
      await importDialog.waitFor()
      await importDialog.getByText('检查完成', { exact: false }).waitFor({ timeout: 20_000 })
      await importDialog.getByRole('button', { name: '开始添加' }).click()
      const resultDialog = page.getByRole('dialog', { name: '添加结果' })
      await resultDialog.waitFor({ timeout: 20_000 })
      await resultDialog.getByText('已完成', { exact: true }).waitFor()
      await resultDialog.getByRole('button', { name: '完成' }).click()
      const showTree = surface.getByRole('button', { name: '显示文件树' })
      if (await showTree.count() > 0) await showTree.click()
      await surface.getByRole('button', { name: 'smoke.bin' }).waitFor({ timeout: 20_000 })
      assert.equal(await surface.locator('textarea[aria-label="编辑 smoke.bin"]').count(), 0)
      assert.deepEqual(await page.locator('[data-file-workspace-surface="ready"]').count(), 1)
    })
  } finally { await stopProcess(runtime.child) }
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
    assert.equal(JSON.parse(fs.readFileSync(path.join(layout, 'package.json'), 'utf8')).hermitPatch, undefined)
  }
  return path.join(target, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

async function startRuntime(dshEntry, artifact, target) {
  const home = path.join(target, 'home')
  const workspace = path.join(target, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  const env = runtimeEnvironment(home)
  run(bundledNode, [dshEntry, 'plugin', '--profile', 'web', 'add', artifact], { cwd: workspace, env })
  const profile = JSON.parse(fs.readFileSync(path.join(home, 'profiles', 'web', 'package.json'), 'utf8'))
  assert.equal(typeof profile.dependencies?.[packageName], 'string')
  assert.equal(profile.dsh.profile.bundles.includes(packageName), true)
  const child = spawn(bundledNode, [dshEntry, 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true })
  return { child, url: await waitForReady(child) }
}

async function withBrowser(url, browserRoot, verify) {
  fs.mkdirSync(browserRoot, { recursive: true })
  fs.writeFileSync(path.join(browserRoot, 'package.json'), JSON.stringify({ private: true, main: 'main.cjs' }))
  fs.writeFileSync(path.join(browserRoot, 'main.cjs'), `const { app, BrowserWindow } = require('electron')\napp.commandLine.appendSwitch('lang', 'zh-CN')\napp.whenReady().then(async () => { const window = new BrowserWindow({ show: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } }); await window.loadURL(process.env.HERMIT_FILE_WORKSPACE_URL) })\napp.on('window-all-closed', () => app.quit())\n`)
  const application = await playwrightElectron.launch({ executablePath: electronPath, args: [browserRoot], cwd: browserRoot, env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', HERMIT_FILE_WORKSPACE_URL: url.href }, timeout: 60_000 })
  const page = await application.firstWindow({ timeout: 60_000 })
  const pageErrors = []
  page.on('pageerror', (cause) => pageErrors.push(cause.message))
  try { await dismissOnboarding(page); await verify(page); assert.deepEqual(pageErrors, []); await captureSuccessScreenshot(page, browserRoot) } catch (cause) { await page.screenshot({ path: path.join(browserRoot, 'failure.png'), fullPage: true }).catch(() => undefined); fs.writeFileSync(path.join(browserRoot, 'failure.html'), await page.content(), 'utf8'); throw cause } finally { await application.close().catch(() => undefined) }
}

async function captureSuccessScreenshot(page, browserRoot) {
  const captureRoot = process.env.HERMIT_CAPTURE_SCREENSHOTS_DIR
  if (captureRoot === undefined) return
  fs.mkdirSync(captureRoot, { recursive: true })
  await new Promise((resolve) => setTimeout(resolve, 600))
  const row = page.getByRole('button', { name: /根目录/u }).first()
  if (await row.count() === 0) return
  await page.screenshot({ path: path.join(captureRoot, `file-workspace-${path.basename(browserRoot)}.png`), fullPage: true })
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

function run(command, args, options) { const result = spawnSync(command, args, { ...options, encoding: 'utf8', windowsHide: true }); if (result.error !== undefined) throw result.error; assert.equal(result.status, 0, `${result.stdout ?? ''}\n${result.stderr ?? ''}`) }
function runtimeEnvironment(home) { const environment = { ...process.env, DSH_HOME: home, PATH: [path.dirname(bundledNode), path.join(bundledDshRoot, 'node_modules', '.bin'), process.env.PATH].filter(Boolean).join(path.delimiter) }; delete environment.NODE_OPTIONS; delete environment.NODE_PATH; delete environment.node_path; delete environment.PNPM_HOME; delete environment.COREPACK_HOME; return environment }
async function waitForReady(child) { let output = ''; const deadline = Date.now() + 30_000; return await new Promise((resolve, reject) => { const timer = setInterval(() => { if (Date.now() < deadline) return; clearInterval(timer); reject(new Error(`DSH 未在期限内 ready：${output}`)) }, 100); const inspect = (chunk) => { output += chunk.toString('utf8'); const match = /\bdsh web:\s+(http:\/\/127\.0\.0\.1:\d+)/u.exec(output); if (match?.[1] === undefined) return; clearInterval(timer); resolve(new URL(match[1])) }; child.stdout.on('data', inspect); child.stderr.on('data', inspect); child.once('error', reject); child.once('exit', (code, signal) => reject(new Error(`DSH ready 前退出 code=${String(code)} signal=${String(signal)}：${output}`))) }) }
async function stopProcess(child) { if (child.exitCode !== null || child.signalCode !== null) return; const exited = once(child, 'exit'); if (process.platform === 'win32' && child.pid !== undefined) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); else if (child.pid !== undefined) process.kill(-child.pid, 'SIGTERM'); await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]) }
