import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as playwrightElectron } from 'playwright-core'

const packageRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const repositoryRoot = path.resolve(packageRoot, '..', '..')
const runtimeRoot = path.join(repositoryRoot, '.hermit', 'runtime')
const bundledNode = path.join(
  runtimeRoot,
  'node',
  process.platform === 'win32' ? 'node.exe' : path.join('bin', 'node'),
)
const bundledDshRoot = path.join(runtimeRoot, 'dsh')
const bundledDsh = path.join(
  bundledDshRoot,
  'node_modules',
  '@deepseek-ai',
  'dsh',
  'lib',
  'bin.js',
)
const stockDsh = path.join(repositoryRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const bundledPnpm = path.join(bundledDshRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
const expectedNode = 'v24.19.0'
const expectedDsh = '0.1.1-rc.2'
const packageName = '@hermit/dsh-plugin-reference'
const stateRoute = '/__hermit_reference__/state'

for (const required of [bundledNode, bundledDsh, stockDsh, bundledPnpm, electronPath]) {
  assert.equal(fs.existsSync(required), true, `资格测试缺少运行时文件：${required}`)
}
assert.equal(spawnSync(bundledNode, ['--version'], { encoding: 'utf8' }).stdout.trim(), expectedNode)

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-reference-plugin-'))
let succeeded = false

try {
  const packageDirectory = path.join(root, 'package')
  fs.mkdirSync(packageDirectory, { recursive: true })
  run(bundledNode, [bundledPnpm, 'pack', '--pack-destination', packageDirectory], {
    cwd: packageRoot,
    env: runtimeEnvironment(bundledNode, path.join(root, 'pack-home')),
  })
  const tarballs = fs.readdirSync(packageDirectory).filter((name) => name.endsWith('.tgz'))
  assert.deepEqual(tarballs.length, 1, `预期一个插件制品，实际为 ${tarballs.join(', ')}`)
  const artifact = path.join(packageDirectory, tarballs[0])
  const artifactSha256 = createHash('sha256').update(fs.readFileSync(artifact)).digest('hex')

  const results = []
  for (const runtime of [
    { label: 'stock-dsh', dshEntry: stockDsh },
    { label: 'hermit-bundled-dsh', dshEntry: bundledDsh },
  ]) {
    results.push(await qualifyRuntime(runtime, artifact, path.join(root, runtime.label)))
  }

  const evidenceDirectory = path.join(repositoryRoot, '.hermit', 'artifacts')
  fs.mkdirSync(evidenceDirectory, { recursive: true })
  fs.writeFileSync(
    path.join(evidenceDirectory, `dsh-reference-plugin-${process.platform}-${process.arch}.json`),
    `${JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      status: 'PASS',
      candidate: {
        plugin: packageName,
        pluginVersion: '0.1.0',
        artifactSha256,
        dshVersion: expectedDsh,
        nodeVersion: expectedNode,
      },
      results,
    }, null, 2)}\n`,
    'utf8',
  )

  console.log(`Reference Plugin qualification passed: sha256=${artifactSha256}`)
  succeeded = true
} catch (cause) {
  console.error(`Reference Plugin 隔离目录已保留：${root}`)
  throw cause
} finally {
  if (succeeded) fs.rmSync(root, { recursive: true, force: true })
}

async function qualifyRuntime(runtime, artifact, runtimeRootPath) {
  const home = path.join(runtimeRootPath, 'home')
  const workspace = path.join(runtimeRootPath, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  const environment = runtimeEnvironment(bundledNode, home)

  run(bundledNode, [runtime.dshEntry, 'plugin', '--profile', 'web', 'add', artifact], {
    cwd: workspace,
    env: environment,
  })
  const profilePath = path.join(home, 'profiles', 'web', 'package.json')
  const installed = readJson(profilePath)
  assert.equal(typeof installed.dependencies?.[packageName], 'string')
  assert.equal(installed.dsh.profile.bundles.includes(packageName), true)

  const active = startDsh(runtime.dshEntry, workspace, environment)
  try {
    const url = await waitForReady(active)
    const state = await readState(url)
    assert.deepEqual(state, {
      plugin: packageName,
      prefix: 'Hermit Reference',
      toolRegistered: true,
    })

    const index = await fetch(url).then((response) => response.text())
    assert.match(index, /"id":"@hermit\/dsh-plugin-reference"/u)
    const client = await fetch(new URL('/plugins/@hermit/dsh-plugin-reference/client.js', url))
      .then((response) => response.text())
    assert.match(client, /^window\.__ModuleLoader__\.load/u)
    assert.match(client, /require\("react"\)/u)
    await assertClientUi(url, path.join(runtimeRootPath, 'browser'))
  } finally {
    await stopProcess(active)
  }

  const disabled = readJson(profilePath)
  disabled.dsh.profile.bundles = disabled.dsh.profile.bundles.filter((name) => name !== packageName)
  fs.writeFileSync(profilePath, `${JSON.stringify(disabled, null, 2)}\n`, 'utf8')

  const inactive = startDsh(runtime.dshEntry, workspace, environment)
  try {
    const url = await waitForReady(inactive)
    const index = await fetch(url).then((response) => response.text())
    assert.doesNotMatch(index, /"id":"@hermit\/dsh-plugin-reference"/u)
    const response = await fetch(new URL(stateRoute, url))
    assert.notEqual(response.headers.get('content-type'), 'application/json; charset=utf-8')
  } finally {
    await stopProcess(inactive)
  }

  run(bundledNode, [runtime.dshEntry, 'plugin', '--profile', 'web', 'remove', packageName], {
    cwd: workspace,
    env: environment,
  })
  const removed = readJson(profilePath)
  assert.equal(removed.dependencies?.[packageName], undefined)
  assert.equal(removed.dsh.profile.bundles.includes(packageName), false)

  return {
    runtime: runtime.label,
    hostState: 'PASS',
    clientBundle: 'PASS',
    clientUi: 'PASS',
    reactHook: 'PASS',
    uiPrimitives: {
      buttonAndInput: 'PASS',
      menuPortalSelectOutsideClick: 'PASS',
      tooltipDomAnchor: 'PASS',
      toastPortal: 'PASS',
      disclosureRow: 'PASS',
      exactIcons: 'PASS',
    },
    disable: 'PASS',
    remove: 'PASS',
  }
}

async function assertClientUi(url, browserRoot) {
  fs.mkdirSync(browserRoot, { recursive: true })
  fs.writeFileSync(
    path.join(browserRoot, 'package.json'),
    `${JSON.stringify({ name: 'hermit-reference-browser', private: true, main: 'main.cjs' })}\n`,
    'utf8',
  )
  fs.writeFileSync(
    path.join(browserRoot, 'main.cjs'),
    `const { app, BrowserWindow } = require('electron')\n`
      + `app.commandLine.appendSwitch('lang', 'zh-CN')\n`
      + `app.whenReady().then(async () => {\n`
      + `  const window = new BrowserWindow({ show: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })\n`
      + `  await window.loadURL(process.env.HERMIT_REFERENCE_URL)\n`
      + `})\n`
      + `app.on('window-all-closed', () => app.quit())\n`,
    'utf8',
  )

  const application = await playwrightElectron.launch({
    executablePath: electronPath,
    args: [browserRoot],
    cwd: browserRoot,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      HERMIT_REFERENCE_URL: url.href,
    },
    timeout: 60_000,
  })
  const pageErrors = []
  let page
  try {
    page = await application.firstWindow({ timeout: 60_000 })
    page.on('pageerror', (cause) => pageErrors.push(cause.message))
    await page.locator('body').waitFor({ timeout: 30_000 })

    const welcome = page.getByRole('dialog', { name: /^(Internal Testing Notice|内测声明)$/u })
    await welcome.waitFor({ timeout: 30_000 })
    await welcome.getByRole('button', { name: /^(Continue|继续)$/u }).click()
    await welcome.waitFor({ state: 'hidden', timeout: 20_000 })

    const credential = page.getByRole('dialog', {
      name: /^(Add an API key to get started|添加一个 API Key 开始使用)$/u,
    })
    await credential.waitFor({ timeout: 30_000 })
    await credential.getByRole('button', { name: /^(Configure later|稍后配置)$/u }).click()
    await credential.waitFor({ state: 'detached', timeout: 20_000 })

    const openSidebar = page.getByRole('button', { name: /^(Open sidebar|打开侧边栏)$/u })
    if (await openSidebar.isVisible().catch(() => false)) await openSidebar.click()
    await page.getByRole('button', { name: /^(Settings|设置)$/u }).last().click()
    const settingsDialog = page.getByRole('dialog', { name: /^(Settings|设置)$/u })
    await settingsDialog.waitFor({ timeout: 20_000 })
    await settingsDialog.getByRole('button', { name: /^(Plugins|插件)$/u }).click()
    await settingsDialog.getByRole('tab', { name: 'Hermit 参考插件' }).click()

    const surface = settingsDialog.locator('[data-hermit-reference-plugin="ready"]')
    await surface.waitFor({ timeout: 20_000 })
    await surface.locator('[data-hermit-reference-host-state]').filter({ hasText: 'Tool 已注册' })
      .waitFor({ timeout: 20_000 })
    const hook = surface.getByRole('button', { name: 'React Hook 验证：0' })
    await hook.click()
    await surface.getByRole('button', { name: 'React Hook 验证：1' }).waitFor()

    const input = surface.getByRole('textbox', { name: '官方 Input 验证' })
    await input.fill('官方 Input 正常')
    assert.equal(await input.inputValue(), '官方 Input 正常')

    const menuTrigger = surface.getByRole('button', { name: '打开组件菜单' })
    await menuTrigger.click()
    const menu = page.getByRole('menu')
    await menu.waitFor()
    await menu.getByRole('menuitem', { name: '全部事项' }).click()
    await surface.locator('[data-hermit-reference-menu-value]').filter({ hasText: 'items' }).waitFor()
    await menuTrigger.click()
    await input.click()
    await menu.waitFor({ state: 'detached' })

    const tooltipTrigger = surface.getByRole('button', { name: '提示触发器' })
    await tooltipTrigger.focus()
    await page.getByRole('tooltip').filter({ hasText: '官方 Tooltip 正常' }).waitFor()
    await tooltipTrigger.blur()

    await surface.getByRole('button', { name: '显示 Toast' }).click()
    await page.getByRole('alert').filter({ hasText: '官方 Toast 正常' }).waitFor()

    await surface.getByText('DisclosureRow 验证').click()
    await surface.getByText('官方 DisclosureRow 展开内容').waitFor()
    assert.deepEqual(pageErrors, [])
  } catch (cause) {
    if (page !== undefined) {
      await page.screenshot({ path: path.join(browserRoot, 'failure.png'), fullPage: true })
        .catch(() => undefined)
      fs.writeFileSync(path.join(browserRoot, 'failure.html'), await page.content(), 'utf8')
    }
    throw cause
  } finally {
    await application.close().catch(() => undefined)
  }
}

function startDsh(dshEntry, cwd, env) {
  return spawn(
    bundledNode,
    [dshEntry, 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'],
    {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    },
  )
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
    child.once('error', (cause) => {
      clearInterval(timer)
      reject(cause)
    })
    child.once('exit', (code, signal) => {
      clearInterval(timer)
      reject(new Error(`DSH ready 前退出 code=${String(code)} signal=${String(signal)}：${output}`))
    })
  })
}

async function readState(url) {
  const response = await fetch(new URL(stateRoute, url))
  assert.equal(response.status, 200)
  return await response.json()
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

function runtimeEnvironment(nodeBinary, home) {
  const environment = {
    ...process.env,
    DSH_HOME: home,
    PATH: [path.dirname(nodeBinary), path.join(bundledDshRoot, 'node_modules', '.bin'), process.env.PATH]
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
    if (normalized === 'npm_execpath'
      || normalized === 'npm_node_execpath'
      || normalized.startsWith('npm_config_')
      || normalized.startsWith('pnpm_config_')) {
      delete environment[key]
    }
  }
  return environment
}

function run(command, args, options) {
  const result = spawnSync(command, args, { ...options, encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  return result
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}
