import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { bundledGenerationRoot, defaultResourcesPath } from '../scripts/runtime-paths.mjs'
import { buildLongSessionScenario, buildReplayOverride } from '../scripts/dsh-long-session-fixture.mjs'
import { packagedElectronTestEnvironment } from './packaged-electron-harness.mjs'

const scriptPath = fileURLToPath(import.meta.url)
const appRoot = path.resolve(path.dirname(scriptPath), '..')
const repositoryRoot = path.resolve(appRoot, '..', '..')
const resourcesPath = defaultResourcesPath(appRoot, process.platform, process.arch)
const generationRoot = bundledGenerationRoot(resourcesPath)
const dshRoot = path.join(generationRoot, 'dsh')
const nodeBinary = path.join(generationRoot, 'node', process.platform === 'win32' ? 'node.exe' : path.join('bin', 'node'))
const dshEntry = path.join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const executablePath = resolveExecutable(appRoot)

if (!new Set(['darwin', 'win32']).has(process.platform)) {
  throw new Error(`DSH 长会话性能测试暂不支持 ${process.platform}，请在 macOS 或 Windows 原生环境运行`)
}

for (const [label, file] of [
  ['Hermit executable', executablePath],
  ['bundled Node', nodeBinary],
  ['bundled DSH', dshEntry],
]) {
  assert.equal(fs.existsSync(file), true, `${label} is missing: ${file}`)
}

const options = readOptions(process.env)
const scenario = buildLongSessionScenario(options)
const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-dsh-long-session-'))
const userData = path.join(runRoot, 'user-data')
const workspace = path.join(runRoot, 'workspace')
const profileHome = path.join(userData, 'dsh-home')
const fixturePath = path.join(runRoot, 'session.jsonl')
const seedOverridePath = path.join(runRoot, 'seed.replay.override.json')
const continuationOverridePath = path.join(runRoot, 'continuation.replay.override.json')
const metricsPath = path.join(runRoot, 'metrics.json')
const artifactRoot = path.join(repositoryRoot, '.hermit', 'artifacts')
const artifactPath = path.join(artifactRoot, `dsh-long-session-${timestampForFile()}.json`)

fs.mkdirSync(workspace, { recursive: true })
fs.writeFileSync(fixturePath, `${JSON.stringify({ type: 'session', version: 0, id: 'hermit-dsh-long-fixture', createdAt: 0, cwd: '{{cwd}}' })}\n`, 'utf8')
fs.writeFileSync(seedOverridePath, `${JSON.stringify(buildReplayOverride(scenario.seedTurns, { chunkChars: options.chunkChars }), null, 2)}\n`, 'utf8')
fs.writeFileSync(continuationOverridePath, `${JSON.stringify(buildReplayOverride(scenario.continuationTurns, { chunkChars: options.chunkChars }), null, 2)}\n`, 'utf8')

let application
let seedSnapshot
let continuationSnapshot
let metrics = {
  schemaVersion: 1,
  status: 'FAIL',
  runRoot,
  artifactPath,
  options,
  scenario: {
    seedChars: scenario.seedChars,
    allChars: scenario.allChars,
    seedTurns: scenario.seedTurns.length,
    continuationTurns: scenario.continuationTurns.length,
  },
  timings: {},
  stream: { partialSamples: 0 },
}

try {
  stageReplayProfile()

  const seedStartedAt = performance.now()
  application = await launchApp()
  const seedPage = await readyPage(application)
  await passOnboarding(seedPage)
  await connectWorkspace(seedPage)
  await sendSeedTurns(seedPage)
  await closeApp(application)
  application = undefined
  metrics.timings.seedUiMs = Math.round(performance.now() - seedStartedAt)

  seedSnapshot = readSessionSnapshot(profileHome)
  assertSeedSnapshot(seedSnapshot)
  writeManifest('seed', seedSnapshot)

  writeReplayPatch(continuationOverridePath)
  const continuationStartedAt = performance.now()
  application = await launchApp()
  const continuationPage = await readyPage(application)
  await passOnboarding(continuationPage)
  await openSession(continuationPage, seedSnapshot.header.id)
  await waitForVisibleText(continuationPage, assistantMarker(scenario.seedTurns.at(-1).assistant), 60_000)
  const continuation = scenario.continuationTurns[0]
  const input = continuationPage.locator('textarea:enabled').first()
  await input.waitFor({ timeout: 20_000 })
  await input.fill(continuation.user)
  await input.press('Enter')
  const partialSamples = await observeStreaming(continuationPage, continuation.assistant, options.streamTimeoutMs)
  await waitForVisibleText(continuationPage, assistantMarker(continuation.assistant), options.streamTimeoutMs)
  await waitForVisibleText(continuationPage, assistantTail(continuation.assistant), options.streamTimeoutMs)
  metrics.stream.partialSamples = partialSamples
  await closeApp(application)
  application = undefined
  metrics.timings.continuationUiMs = Math.round(performance.now() - continuationStartedAt)

  continuationSnapshot = readSessionSnapshot(profileHome)
  assertContinuationSnapshot(seedSnapshot, continuationSnapshot, continuation)
  writeManifest('continuation', continuationSnapshot)

  // 第三个进程只做冷启动读取，确认第二阶段追加的内容不是内存残留。
  const coldStartedAt = performance.now()
  application = await launchApp()
  const coldPage = await readyPage(application)
  await passOnboarding(coldPage)
  await openSession(coldPage, continuationSnapshot.header.id)
  await waitForVisibleText(coldPage, assistantMarker(continuation.assistant), 60_000)
  await waitForVisibleText(coldPage, assistantTail(continuation.assistant), 60_000)
  await closeApp(application)
  application = undefined
  metrics.timings.coldResumeUiMs = Math.round(performance.now() - coldStartedAt)

  metrics = {
    ...metrics,
    status: 'PASS',
    session: {
      id: continuationSnapshot.header.id,
      createdAt: continuationSnapshot.header.createdAt,
      seedLastSeq: seedSnapshot.lastSeq,
      continuationLastSeq: continuationSnapshot.lastSeq,
      seedEventCount: seedSnapshot.events.length,
      continuationEventCount: continuationSnapshot.events.length,
      seedPhysicalBytes: seedSnapshot.physicalBytes,
      continuationPhysicalBytes: continuationSnapshot.physicalBytes,
      prefixSha256: seedSnapshot.prefixSha256,
      seedConversationChars: seedSnapshot.conversationChars,
      continuationConversationChars: continuationSnapshot.conversationChars,
      seedSurfaceChars: seedSnapshot.surfaceChars,
      continuationSurfaceChars: continuationSnapshot.surfaceChars,
      continuationChunkCount: continuationSnapshot.assistantChunkCount,
    },
  }
  writeArtifact()
  console.log(`DSH long session passed: ${scenario.seedTurns.length} turns, ${scenario.seedChars} chars, session=${continuationSnapshot.header.id}`)
  console.log(`Metrics: ${artifactPath}`)
} catch (cause) {
  metrics = { ...metrics, error: errorRecord(cause) }
  writeArtifact()
  console.error(`DSH long session isolated state retained for diagnosis: ${runRoot}`)
  throw cause
} finally {
  await closeApp(application)
  if (metrics.status === 'PASS' && process.env.HERMIT_DSH_LONG_KEEP !== '1') {
    fs.rmSync(runRoot, { recursive: true, force: true })
  }
}

function readOptions(environment) {
  return {
    targetChars: readPositiveInteger(environment.HERMIT_DSH_LONG_TARGET_CHARS, 100_000),
    turns: readPositiveInteger(environment.HERMIT_DSH_LONG_TURNS, 128),
    continuationTurns: 1,
    seed: readPositiveInteger(environment.HERMIT_DSH_LONG_SEED, 20260903),
    chunkChars: readPositiveInteger(environment.HERMIT_DSH_LONG_CHUNK_CHARS, 32),
    paceMs: readNonNegativeInteger(environment.HERMIT_DSH_LONG_PACE_MS, 2),
    streamTimeoutMs: readPositiveInteger(environment.HERMIT_DSH_LONG_STREAM_TIMEOUT_MS, 90_000),
  }
}

function resolveExecutable(rootPath) {
  const candidates = process.platform === 'darwin'
    ? [
        path.join(rootPath, 'dist', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Hermit.app', 'Contents', 'MacOS', 'Hermit'),
        path.join(rootPath, 'dist', 'mac-smoke', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Hermit.app', 'Contents', 'MacOS', 'Hermit'),
      ]
    : [path.join(rootPath, 'dist', 'win-unpacked', 'Hermit.exe')]
  const override = process.env.HERMIT_DSH_LONG_EXECUTABLE
  if (override !== undefined && override.trim() !== '') return path.resolve(override)
  const existing = candidates.find((candidate) => fs.existsSync(candidate))
  return existing ?? candidates[0]
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
  writeReplayPatch(seedOverridePath)
}

function writeReplayPatch(overrideFile) {
  const profileRoot = path.join(profileHome, 'profiles', 'web')
  fs.writeFileSync(path.join(profileRoot, 'cordis.patch.yml'), `# Hermit long-session keyless performance overlay.
- id: llm-deepseek
  disabled: true

- id: session-title-llm
  disabled: true

- id: session-persistence-jsonl
  name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: ${JSON.stringify(path.join(profileHome, 'sessions'))}
    compression: none
    packChunks: false

- insert:
    - id: llm-replay
      name: '@deepseek-ai/dsh-llm-replay'
      config:
        file: ${JSON.stringify(fixturePath)}
        overrideFile: ${JSON.stringify(overrideFile)}
        paceMs: ${options.paceMs}
        providers:
          - id: deepseek-official
            name: DeepSeek replay
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
    env: packagedElectronTestEnvironment({ SSH_TTY: 'hermit-dsh-long-session' }),
    timeout: 60_000,
  })
}

async function readyPage(app) {
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

async function passOnboarding(page) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const action = page.getByRole('button', { name: /^(Continue|继续|Configure later|稍后配置)$/u }).first()
    if (await action.isVisible({ timeout: 500 }).catch(() => false)) {
      if (await action.isEnabled().catch(() => false)) {
        await action.click({ timeout: 5_000 })
        await page.waitForTimeout(250)
      }
      continue
    }
    const dialogs = page.getByRole('dialog')
    let visibleDialog = false
    for (let index = 0; index < await dialogs.count(); index += 1) {
      if (await dialogs.nth(index).isVisible().catch(() => false)) {
        visibleDialog = true
        break
      }
    }
    const choose = page.getByRole('textbox', { name: /Choose workspace|选择工作区/u })
    if (!visibleDialog && await choose.isVisible({ timeout: 500 }).catch(() => false)) return
    if (!visibleDialog && await page.locator('textarea:enabled').first().isVisible({ timeout: 500 }).catch(() => false)) return
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

async function openSession(page, sessionId) {
  const url = new URL(page.url())
  url.searchParams.set('sessionId', sessionId)
  await page.goto(url.href)
  await page.locator('body').waitFor({ timeout: 30_000 })
}

async function sendSeedTurns(page) {
  const input = page.locator('textarea:enabled').first()
  await input.waitFor({ timeout: 20_000 })
  for (const turn of scenario.seedTurns) {
    await input.fill(turn.user)
    await input.press('Enter')
    await waitForVisibleText(page, assistantMarker(turn.assistant), options.streamTimeoutMs)
    await waitForVisibleText(page, assistantTail(turn.assistant), options.streamTimeoutMs)
    await input.waitFor({ timeout: 20_000 })
  }
}

function assistantMarker(text) {
  return text.slice(0, 24)
}

function assistantTail(text) {
  return text.slice(-24)
}

async function observeStreaming(page, expected, timeoutMs) {
  const marker = assistantMarker(expected)
  // UI 可能按 animation frame 合并多个 DSH snapshot；观察窗口只负责采样，
  // 最终完整性仍由后面的 visible-text 和持久化事件校验负责。
  const deadline = Math.min(Date.now() + timeoutMs, Date.now() + 10_000)
  const samples = new Set()
  while (Date.now() < deadline) {
    const body = await page.locator('body').innerText().catch(() => '')
    const start = body.indexOf(marker)
    if (start >= 0) {
      samples.add(body.slice(start).length)
      if (samples.size >= 2 || body.includes(assistantTail(expected))) break
    }
    await page.waitForTimeout(25)
  }
  return samples.size
}

async function waitForVisibleText(page, text, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  const locator = page.getByText(text, { exact: false })
  while (Date.now() < deadline) {
    if (await locator.count() > 0) {
      for (let index = 0; index < await locator.count(); index += 1) {
        if (await locator.nth(index).isVisible().catch(() => false)) return
      }
    }
    await page.waitForTimeout(100)
  }
  throw new Error(`Visible text did not appear: ${text}`)
}

async function closeApp(app) {
  if (app === undefined || app.process().exitCode !== null) return
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined)
  await app.close().catch(() => undefined)
}

function readSessionSnapshot(home) {
  const files = findFiles(path.join(home, 'sessions')).filter((file) => file.endsWith('.jsonl'))
  const candidates = files.map((file) => parseSessionFile(file)).filter((candidate) => candidate.events.some((event) => event.type === 'user/message'))
  if (candidates.length === 0) throw new Error(`No readable JSONL Session found under ${path.join(home, 'sessions')}`)
  return candidates.sort((left, right) => right.events.length - left.events.length)[0]
}

function parseSessionFile(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
  const header = lines.find((line) => line.type === 'session')
  if (header === undefined) throw new Error(`Session log has no header: ${file}`)
  const events = lines.filter((line) => line.type !== 'session')
  for (let index = 0; index < events.length; index += 1) {
    assert.equal(events[index].seq, index, `Session seq gap at ${file}:${index}`)
  }
  const surfaceMessages = events.filter((event) => event.type === 'user/message' || event.type === 'assistant/message')
  const surfaceChars = surfaceMessages.reduce((total, event) => total + messageText(event.data?.message ?? event.data ?? event).length, 0)
  const conversationMessages = surfaceMessages.filter((event) => event.type === 'assistant/message' || isBusinessUserMessage(event))
  const conversationChars = conversationMessages.reduce((total, event) => total + messageText(event.data?.message ?? event.data ?? event).length, 0)
  return {
    file,
    header,
    events,
    lastSeq: events.at(-1)?.seq ?? -1,
    surfaceChars,
    conversationChars,
    userMessageCount: events.filter((event) => isBusinessUserMessage(event)).length,
    assistantMessageCount: events.filter((event) => event.type === 'assistant/message').length,
    assistantChunkCount: events.filter((event) => event.type === 'assistant/chunk').length,
    physicalBytes: fs.statSync(file).size,
    prefixSha256: hashEvents(events),
  }
}

function assertSeedSnapshot(snapshot) {
  assert.equal(snapshot.header.id.length > 0, true)
  assert.equal(snapshot.events.filter((event) => isBusinessUserMessage(event)).length, scenario.seedTurns.length)
  assert.equal(snapshot.events.filter((event) => event.type === 'assistant/message').length >= scenario.seedTurns.length, true)
  assert.equal(snapshot.events.filter((event) => event.type === 'assistant/chunk').length >= scenario.seedTurns.length, true)
  assert.equal(snapshot.conversationChars >= scenario.seedChars * 0.95, true, `seed conversation is too short: ${snapshot.conversationChars}`)
}

function assertContinuationSnapshot(before, after, continuation) {
  assert.equal(after.header.id, before.header.id)
  assert.equal(after.header.createdAt, before.header.createdAt)
  assert.equal(after.events.length > before.events.length, true)
  assert.equal(hashEvents(after.events.slice(0, before.events.length)), before.prefixSha256)
  assert.equal(after.events.some((event) => isBusinessUserMessage(event) && messageText(event.data ?? event) === continuation.user), true)
  assert.equal(after.events.some((event) => event.type === 'assistant/message' && messageText(event.data?.message ?? event.data ?? event) === continuation.assistant), true)
  assert.equal(after.events.filter((event) => event.type === 'assistant/chunk').length > before.events.filter((event) => event.type === 'assistant/chunk').length, true)
}

function writeManifest(stage, snapshot) {
  fs.writeFileSync(path.join(runRoot, `${stage}-manifest.json`), `${JSON.stringify({
    schemaVersion: 1,
    stage,
    generatedAt: new Date().toISOString(),
    dshVersion: '0.1.1-rc.2',
    session: {
      id: snapshot.header.id,
      createdAt: snapshot.header.createdAt,
      lastSeq: snapshot.lastSeq,
      eventCount: snapshot.events.length,
      conversationChars: snapshot.conversationChars,
      surfaceChars: snapshot.surfaceChars,
      userMessageCount: snapshot.userMessageCount,
      assistantMessageCount: snapshot.assistantMessageCount,
      assistantChunkCount: snapshot.assistantChunkCount,
      physicalBytes: snapshot.physicalBytes,
      prefixSha256: snapshot.prefixSha256,
    },
  }, null, 2)}\n`, 'utf8')
}

function writeArtifact() {
  fs.mkdirSync(artifactRoot, { recursive: true })
  fs.writeFileSync(artifactPath, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8')
  fs.writeFileSync(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8')
}

function hashEvents(events) {
  return createHash('sha256').update(events.map((event) => JSON.stringify(event)).join('\n')).digest('hex')
}

function messageText(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(messageText).join('')
  if (value === null || typeof value !== 'object') return ''
  if (typeof value.text === 'string') return value.text
  if ('content' in value) return messageText(value.content)
  if ('blocks' in value) return messageText(value.blocks)
  return ''
}

function isBusinessUserMessage(event) {
  return event.type === 'user/message' && event.data?.source?.kind === 'user'
}

function findFiles(root) {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name)
    return entry.isDirectory() ? findFiles(fullPath) : [fullPath]
  })
}

function readPositiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function readNonNegativeInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function timestampForFile() {
  return new Date().toISOString().replace(/[-:.TZ]/gu, '').slice(0, 14)
}

function errorRecord(cause) {
  return { name: cause instanceof Error ? cause.name : 'UnknownError', message: cause instanceof Error ? cause.message : String(cause), stack: cause instanceof Error ? cause.stack : undefined }
}
