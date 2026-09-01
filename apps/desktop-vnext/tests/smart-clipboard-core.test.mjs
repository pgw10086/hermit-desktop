import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { SqliteClipboardRepository } from '../lib/core/smart-clipboard/sqlite-repository.js'
import { ClipboardCoreService } from '../lib/core/smart-clipboard/service.js'

function fixturePlatform() {
  const writes = []
  return {
    writes,
    async snapshot() { return undefined },
    async write(entry, plainText) { writes.push({ entry, plainText }); return { status: 'written' } },
    async autoPaste() { return { status: 'copy-only', reason: 'fixture' } },
  }
}

test('Core SQLite repository 重启后保留三类记录，service 统一执行 copy-only 降级', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-smart-clipboard-core-'))
  const dbPath = path.join(root, 'history.sqlite')
  try {
    const firstRepository = new SqliteClipboardRepository(dbPath)
    const platform = fixturePlatform()
    let id = 1
    const service = new ClipboardCoreService(firstRepository, platform, {
      idFactory: () => `core-${String(id++)}`,
      now: () => 10_000,
    })
    assert.equal(service.store.capture({ kind: 'TEXT', text: 'hello', sourceApplication: 'Editor' }).status, 'recorded')
    assert.equal(service.store.capture({
      kind: 'IMAGE', bytes: new Uint8Array([1, 2]), width: 1, height: 2,
      hasAlpha: true, sourceApplication: 'Preview',
    }).status, 'recorded')
    assert.equal(service.store.capture({
      kind: 'FILE_LIST', sourceApplication: 'Finder',
      items: [{ displayName: 'a.txt', path: '/tmp/a.txt', itemType: 'file', exists: true }],
    }).status, 'recorded')
    const result = await service.execute('core-1', 'use')
    assert.deepEqual(result, { status: 'copy-only', reason: 'fixture' })
    assert.equal(platform.writes.length, 1)
    assert.deepEqual(service.list({ query: 'ell' }).map((entry) => entry.kind), ['TEXT'])
    assert.deepEqual(service.list({ query: 'a.txt' }).map((entry) => entry.kind), ['FILE_LIST'])
    assert.equal(fs.statSync(dbPath).mode & 0o777, 0o600)
    assert.equal(fs.statSync(path.dirname(dbPath)).mode & 0o777, 0o700)
    const exportPath = path.join(root, 'export.zip')
    service.exportData(exportPath, false)
    const archive = fs.readFileSync(exportPath)
    assert.equal(archive.subarray(0, 4).toString('hex'), '504b0304')
    assert.match(archive.toString('latin1'), /manifest\.json/u)
    firstRepository.close()

    const secondRepository = new SqliteClipboardRepository(dbPath)
    assert.equal(secondRepository.count('history'), 3)
    assert.deepEqual(secondRepository.list('history').map((entry) => entry.kind).sort(), ['FILE_LIST', 'IMAGE', 'TEXT'])
    assert.deepEqual(secondRepository.search('history', 'ell').map((entry) => entry.kind), ['TEXT'])
    secondRepository.close()
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Core service 只在指纹变化时捕获，暂停状态不会伪装成容量不足', async () => {
  let calls = 0
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-smart-clipboard-poll-'))
  const repository = new SqliteClipboardRepository(path.join(root, 'history.sqlite'))
  const platform = {
    async snapshot() { calls += 1; return { kind: 'TEXT', text: 'same', sourceApplication: null } },
    async write() { return { status: 'written' } },
    async autoPaste() { return { status: 'pasted', reason: 'fixture' } },
  }
  const service = new ClipboardCoreService(repository, platform, { idFactory: () => 'one', now: () => 1_000 })
  try {
    await service.poll(); await service.poll()
    assert.equal(calls, 2)
    assert.equal(repository.count('history'), 1)
    service.setPaused(true)
    assert.equal(service.store.capture({ kind: 'TEXT', text: 'paused', sourceApplication: null }).reason, 'paused')
  } finally {
    repository.close(); fs.rmSync(root, { recursive: true, force: true })
  }
})

test('平台 generation 变化时同内容复制仍更新最近使用，而不是被内容指纹吞掉', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-smart-clipboard-generation-'))
  const repository = new SqliteClipboardRepository(path.join(root, 'history.sqlite'))
  let generation = 1
  let now = 100
  const bridge = {
    async snapshot() { return { kind: 'TEXT', text: 'same', sourceApplication: 'Editor', platformGeneration: generation } },
    async write() { return { status: 'written' } },
    async autoPaste() { return { status: 'copy-only', reason: 'fixture' } },
  }
  const service = new ClipboardCoreService(repository, bridge, { idFactory: () => 'entry-1', now: () => now })
  try {
    await service.poll()
    generation = 2
    now = 200
    await service.poll()
    assert.equal(service.list().length, 1)
    assert.equal(service.list()[0].lastUsedAt, 200)
  } finally {
    repository.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Core service 暴露忽略下一次和清空全部数据动作', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-smart-clipboard-management-'))
  const repository = new SqliteClipboardRepository(path.join(root, 'history.sqlite'))
  const platform = fixturePlatform()
  const service = new ClipboardCoreService(repository, platform, {
    idFactory: (() => { let id = 0; return () => `management-${String(++id)}` })(),
    now: () => 1_000,
  })
  try {
    service.ignoreNext()
    assert.equal(service.store.capture({ kind: 'TEXT', text: 'skip', sourceApplication: null }).reason, 'ignored')
    assert.equal(service.store.capture({ kind: 'TEXT', text: 'keep', sourceApplication: null }).status, 'recorded')
    assert.equal(service.clearAllData(), 1)
    assert.equal(service.list().length, 0)
  } finally {
    repository.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('复制和不可用动作都会丢弃快捷面板记录的目标应用', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-smart-clipboard-target-'))
  const repository = new SqliteClipboardRepository(path.join(root, 'history.sqlite'))
  let discarded = 0
  const platform = {
    async snapshot() { return undefined },
    async write() { return { status: 'written' } },
    async autoPaste() { return { status: 'copy-only', reason: 'fixture' } },
    discardPasteTarget() { discarded += 1 },
  }
  const service = new ClipboardCoreService(repository, platform, { idFactory: () => 'target-1', now: () => 1_000 })
  try {
    service.store.capture({ kind: 'TEXT', text: 'copy me', sourceApplication: null })
    assert.deepEqual(await service.execute('target-1', 'copy'), { status: 'copied' })
    assert.deepEqual(await service.execute('missing', 'use'), { status: 'unavailable', reason: '历史记录不存在' })
    assert.equal(discarded, 2)
  } finally {
    repository.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('排除规则跳过指定来源和类型，并持续暴露容量与捕获故障状态', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-smart-clipboard-capture-state-'))
  const repository = new SqliteClipboardRepository(path.join(root, 'history.sqlite'))
  const snapshots = [
    { kind: 'TEXT', text: 'source excluded', sourceApplication: 'com.example.secret' },
    { kind: 'IMAGE', bytes: new Uint8Array([1]), width: 1, height: 1, hasAlpha: true, sourceApplication: 'Preview' },
    { kind: 'TEXT', text: 'allowed', sourceApplication: 'Editor' },
  ]
  let index = 0
  const bridge = {
    async snapshot() { return snapshots[index++] },
    async write() { return { status: 'written' } },
    async autoPaste() { return { status: 'copy-only', reason: 'fixture' } },
  }
  const service = new ClipboardCoreService(repository, bridge, {
    idFactory: () => 'allowed-1', now: () => 1_000,
    excludedApplications: ['com.example.secret'], excludedKinds: ['IMAGE'],
  })
  try {
    await service.poll(); await service.poll(); await service.poll()
    assert.deepEqual(service.list().map((entry) => entry.kind === 'TEXT' ? entry.text : entry.kind), ['allowed'])
    assert.deepEqual(service.status(), { state: 'recording' })

    const fullRepository = new SqliteClipboardRepository(path.join(root, 'full.sqlite'))
    const fullService = new ClipboardCoreService(fullRepository, {
      ...bridge,
      async snapshot() { return { kind: 'TEXT', text: 'too large', sourceApplication: 'Editor' } },
    }, { idFactory: () => 'full-1', now: () => 1_000, totalBytes: 1 })
    try {
      await fullService.poll()
      assert.deepEqual(fullService.status(), { state: 'storage-full' })
    } finally {
      fullRepository.close()
    }

    const unavailableRepository = new SqliteClipboardRepository(path.join(root, 'unavailable.sqlite'))
    const unavailableService = new ClipboardCoreService(unavailableRepository, {
      ...bridge,
      async snapshot() { throw new Error('clipboard access denied') },
    }, { idFactory: () => 'unavailable-1' })
    try {
      await assert.rejects(() => unavailableService.poll(), /clipboard access denied/u)
      assert.deepEqual(unavailableService.status(), { state: 'unavailable', reason: 'clipboard access denied' })
    } finally {
      unavailableRepository.close()
    }
  } finally {
    repository.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('FILE_LIST 在展示和使用前刷新文件状态，已删除引用不会继续尝试粘贴', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-smart-clipboard-file-state-'))
  const file = path.join(root, 'temporary.txt')
  fs.writeFileSync(file, 'content')
  const repository = new SqliteClipboardRepository(path.join(root, 'history.sqlite'))
  const platform = fixturePlatform()
  const service = new ClipboardCoreService(repository, platform, { idFactory: () => 'file-state-1', now: () => 1_000 })
  try {
    service.store.capture({
      kind: 'FILE_LIST', sourceApplication: 'Finder',
      items: [{ displayName: 'temporary.txt', path: file, itemType: 'file', exists: true, sizeBytes: 7 }],
    })
    fs.rmSync(file)
    assert.equal(service.list()[0].kind, 'FILE_LIST')
    assert.equal(service.list()[0].items[0].exists, false)
    assert.deepEqual(await service.execute('file-state-1', 'use'), {
      status: 'unavailable', reason: '文件列表包含已不存在的引用',
    })
    assert.equal(platform.writes.length, 0)
  } finally {
    repository.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
