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
const packageName = '@tianbuyv/smart-clipboard'
const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-smart-clipboard-package-'))
const pluginArtifact = packInstalledPackage({ repositoryRoot, packageName, outputDirectory: artifactRoot })

for (const required of [bundledNode, bundledDsh, pluginArtifact, electronPath]) {
  assert.equal(fs.existsSync(required), true, `Smart Clipboard 资格缺少运行时文件：${required}`)
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-smart-clipboard-surface-'))
let succeeded = false

try {
  const stockDsh = prepareStockRuntime(path.join(root, 'stock-runtime'))
  await qualifyStock(stockDsh, pluginArtifact, path.join(root, 'stock'))
  await qualifyHermit(pluginArtifact, path.join(root, 'hermit'))
  console.log('Smart Clipboard Product Surface qualification passed: stock=settings, hermit=sidebar+history')
  succeeded = true
} catch (cause) {
  console.error(`Smart Clipboard Product Surface 资格目录已保留：${root}`)
  throw cause
} finally {
  fs.rmSync(artifactRoot, { recursive: true, force: true })
  if (succeeded) fs.rmSync(root, { recursive: true, force: true })
}

async function qualifyStock(stockDsh, artifact, target) {
  const runtime = await startRuntime(stockDsh, artifact, target)
  try {
    await withBrowser(runtime.url, path.join(target, 'browser'), async (page) => {
      await openSidebar(page)
      assert.equal(await page.getByRole('button', { name: '剪贴板历史' }).count(), 0)
      await page.getByRole('button', { name: /^(Settings|设置)$/u }).last().click()
      const settings = page.getByRole('dialog', { name: /^(Settings|设置)$/u })
      await settings.waitFor({ timeout: 20_000 })
      await settings.getByRole('button', { name: /^(Plugins|插件)$/u }).click()
      await settings.getByRole('tab', { name: '剪贴板历史' }).click()
      await settings.locator('[data-smart-clipboard-history="unavailable"]').waitFor({ timeout: 20_000 })
    })
  } finally {
    await stopProcess(runtime.child)
  }
}

function prepareStockRuntime(target) {
  copyRuntimeClosure(bundledDshRoot, target)
  const require = createRequire(import.meta.url)
  const officialWebApp = require.resolve('@deepseek-ai/dsh-web-app/package.json')
  const officialRequire = createRequire(officialWebApp)
  const officialLayout = path.dirname(
    officialRequire.resolve('@deepseek-ai/dsh-client-ui-layout/package.json'),
  )
  const nodeModules = path.join(target, 'node_modules')
  const layouts = new Set([
    path.join(nodeModules, '@deepseek-ai', 'dsh-client-ui-layout'),
  ])
  for (const consumer of ['dsh-web-app', 'dsh-client-ui-sidebar', 'dsh-client-ui-conversation']) {
    const consumerManifest = path.join(nodeModules, '@deepseek-ai', consumer, 'package.json')
    if (!fs.existsSync(consumerManifest)) continue
    layouts.add(path.dirname(
      createRequire(consumerManifest).resolve('@deepseek-ai/dsh-client-ui-layout/package.json'),
    ))
  }
  for (const layout of layouts) {
    fs.rmSync(layout, { recursive: true, force: true })
    fs.mkdirSync(layout, { recursive: true })
    for (const entry of ['LICENSE', 'package.json', 'lib']) {
      fs.cpSync(
        path.join(officialLayout, entry),
        path.join(layout, entry),
        { recursive: true, dereference: true },
      )
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(layout, 'package.json'), 'utf8'))
    assert.equal(manifest.hermitPatch, undefined, 'stock DSH 闭包意外包含 Hermit patch')
  }
  const entry = path.join(target, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  assert.equal(fs.existsSync(entry), true, '独立 stock DSH 闭包未生成 CLI')
  return entry
}

async function qualifyHermit(artifact, target) {
  const runtime = await startRuntime(bundledDsh, artifact, target)
  try {
    await withBrowser(runtime.url, path.join(target, 'browser'), async (page) => {
      await openSidebar(page)
      const navigation = page.getByRole('button', { name: '剪贴板历史' })
      await page.locator('[data-hermit-product-navigation]').waitFor({ timeout: 20_000 })
      await navigation.waitFor({ timeout: 20_000 })
      await navigation.click()
      const frame = page.locator('[data-product-surface="smart-clipboard-history"]')
      await frame.waitFor({ timeout: 20_000 })
      await frame.locator('[data-smart-clipboard-history="unavailable"]').waitFor()
      const newSession = page.getByRole('button', { name: '新建会话' }).first()
      await newSession.waitFor({ timeout: 20_000 })
      await newSession.click()
      await page.locator('[data-primary-view="conversation"]').waitFor({ timeout: 20_000 })
      await frame.waitFor({ state: 'detached', timeout: 20_000 })
      assert.equal(await page.locator('[data-product-surface="smart-clipboard-history"]').count(), 0)

      await navigation.click()
      await page.locator('[data-product-surface="smart-clipboard-history"]').waitFor({ timeout: 20_000 })
      await frame.getByRole('button', { name: '返回对话' }).click()
      await page.locator('[data-product-surface="smart-clipboard-history"]').waitFor({ state: 'detached' })
    })
  } finally {
    await stopProcess(runtime.child)
  }
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
  const child = spawn(
    bundledNode,
    [dshEntry, 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'],
    {
      cwd: workspace,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    },
  )
  return { child, url: await waitForReady(child) }
}

async function withBrowser(url, browserRoot, verify) {
  fs.mkdirSync(browserRoot, { recursive: true })
  fs.writeFileSync(path.join(browserRoot, 'package.json'), JSON.stringify({ private: true, main: 'main.cjs' }))
  fs.writeFileSync(
    path.join(browserRoot, 'main.cjs'),
    `const { app, BrowserWindow } = require('electron')\n`
      + `app.commandLine.appendSwitch('lang', 'zh-CN')\n`
      + `app.whenReady().then(async () => {\n`
      + `  const window = new BrowserWindow({ show: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })\n`
      + `  await window.loadURL(process.env.HERMIT_CLIPBOARD_URL)\n`
      + `})\n`
      + `app.on('window-all-closed', () => app.quit())\n`,
  )
  const application = await playwrightElectron.launch({
    executablePath: electronPath,
    args: [browserRoot],
    cwd: browserRoot,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', HERMIT_CLIPBOARD_URL: url.href },
    timeout: 60_000,
  })
  let page
  const pageErrors = []
  try {
    page = await application.firstWindow({ timeout: 60_000 })
    page.on('pageerror', (cause) => pageErrors.push(cause.message))
    await dismissOnboarding(page)
    await verify(page)
    assert.deepEqual(pageErrors, [])
    await captureSuccessScreenshot(page, browserRoot)
  } catch (cause) {
    if (page !== undefined) {
      await page.screenshot({ path: path.join(browserRoot, 'failure.png'), fullPage: true }).catch(() => undefined)
      fs.writeFileSync(path.join(browserRoot, 'failure.html'), await page.content(), 'utf8')
    }
    throw cause
  } finally {
    await application.close().catch(() => undefined)
  }
}

async function captureSuccessScreenshot(page, browserRoot) {
  const captureRoot = process.env.HERMIT_CAPTURE_SCREENSHOTS_DIR
  if (captureRoot === undefined) return
  fs.mkdirSync(captureRoot, { recursive: true })
  await page.screenshot({ path: path.join(captureRoot, `smart-clipboard-${path.basename(browserRoot)}.png`), fullPage: true })
}

async function dismissOnboarding(page) {
  await page.locator('body').waitFor({ timeout: 30_000 })
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

function run(command, args, options) {
  const result = spawnSync(command, args, { ...options, encoding: 'utf8', windowsHide: true })
  if (result.error !== undefined) throw result.error
  assert.equal(result.status, 0, `${result.stdout ?? ''}\n${result.stderr ?? ''}`)
}

function runtimeEnvironment(home) {
  const environment = {
    ...process.env,
    DSH_HOME: home,
    PATH: [path.dirname(bundledNode), path.join(bundledDshRoot, 'node_modules', '.bin'), process.env.PATH]
      .filter(Boolean)
      .join(path.delimiter),
  }
  delete environment.NODE_OPTIONS
  delete environment.NODE_PATH
  delete environment.node_path
  delete environment.PNPM_HOME
  delete environment.COREPACK_HOME
  for (const key of Object.keys(environment)) {
    const normalized = key.toLowerCase()
    if (normalized === 'npm_execpath' || normalized === 'npm_node_execpath' || normalized.startsWith('npm_config_') || normalized.startsWith('pnpm_config_')) {
      delete environment[key]
    }
  }
  return environment
}

async function waitForReady(child) {
  let output = ''
  const deadline = Date.now() + 30_000
  return await new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (Date.now() < deadline) return
      clearInterval(timer)
      reject(new Error(`DSH 未在期限内 ready：${output}`))
    }, 100)
    const inspect = (chunk) => {
      output += chunk.toString('utf8')
      const match = /\bdsh web:\s+(http:\/\/127\.0\.0\.1:\d+)/u.exec(output)
      if (match?.[1] === undefined) return
      clearInterval(timer)
      resolve(new URL(match[1]))
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('error', reject)
    child.once('exit', (code, signal) => reject(new Error(`DSH ready 前退出 code=${String(code)} signal=${String(signal)}：${output}`)))
  })
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  if (process.platform === 'win32' && child.pid !== undefined) {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
    await once(killer, 'exit')
  } else {
    child.kill('SIGTERM')
  }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))])
  if (process.platform !== 'win32' && child.pid !== undefined) {
    try {
      process.kill(-child.pid, 0)
      process.kill(-child.pid, 'SIGKILL')
    } catch (cause) {
      if (cause?.code !== 'ESRCH') throw cause
    }
  }
}
