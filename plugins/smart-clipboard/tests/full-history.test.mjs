import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ClipboardHistoryStore,
  InMemoryClipboardRepository,
  MAX_IMAGE_PIXELS,
} from '../lib/full-history.js'

function createStore(options = {}) {
  let nextId = 1
  let now = options.now ?? 1_000
  const repository = new InMemoryClipboardRepository()
  const store = new ClipboardHistoryStore(repository, {
    idFactory: () => `entry-${String(nextId++)}`,
    now: () => now,
    ...options,
  })
  return {
    repository,
    store,
    advance(value) { now = value },
  }
}

function text(text, sourceApplication = 'Fixture') {
  return { kind: 'TEXT', text, sourceApplication }
}

test('三类内容均可记录，精确重复只更新最近使用时间', () => {
  const { store, repository, advance } = createStore()
  const first = store.capture(text('hello'))
  assert.equal(first.status, 'recorded')
  advance(2_000)
  const duplicate = store.capture(text('hello', 'Editor'))
  assert.equal(duplicate.status, 'duplicate')
  assert.equal(repository.count('history'), 1)
  assert.equal(duplicate.entry.id, first.entry.id)
  assert.equal(duplicate.entry.lastUsedAt, 2_000)
  assert.equal(duplicate.entry.sourceApplication, 'Editor')

  const image = store.capture({
    kind: 'IMAGE', bytes: new Uint8Array([1, 2, 3]), width: 2, height: 2,
    hasAlpha: true, sourceApplication: 'Preview',
  })
  assert.equal(image.status, 'recorded')
  advance(3_000)
  const files = store.capture({
    kind: 'FILE_LIST', sourceApplication: 'Finder',
    items: [
      { displayName: 'a.txt', path: '/tmp/a.txt', itemType: 'file', exists: true, sizeBytes: 12 },
      { displayName: 'folder', path: '/tmp/folder', itemType: 'folder', exists: false },
    ],
  })
  assert.equal(files.status, 'recorded')
  assert.deepEqual(store.list().map((entry) => entry.kind), ['FILE_LIST', 'IMAGE', 'TEXT'])
})

test('marker、暂停、无效图片和超大像素都给出可观察跳过原因', () => {
  const { store } = createStore()
  assert.deepEqual(store.capture({ ...text('secret'), markers: ['concealed'] }), {
    status: 'skipped', reason: 'marker',
  })
  store.setPaused(true)
  assert.deepEqual(store.capture(text('paused')), { status: 'skipped', reason: 'paused' })
  store.setPaused(false)
  assert.deepEqual(store.capture({
    kind: 'IMAGE', bytes: new Uint8Array([1]), width: 0, height: 4,
    hasAlpha: false, sourceApplication: null,
  }), { status: 'skipped', reason: 'invalid-image' })
  assert.deepEqual(store.capture({
    kind: 'IMAGE', bytes: new Uint8Array([1]), width: MAX_IMAGE_PIXELS, height: 2,
    hasAlpha: false, sourceApplication: null,
  }), { status: 'skipped', reason: 'too-large' })
})

test('TEXT 容量包含 HTML/RTF 表示，任一表示超过单条上限都会拒绝', () => {
  const { store } = createStore({ totalBytes: 100 })
  const captured = store.capture({
    ...text('plain'),
    formatted: { html: '<b>plain</b>', rtf: '{\\rtf1 plain}' },
  })
  assert.equal(captured.status, 'recorded')
  assert.equal(captured.entry.byteSize, Buffer.byteLength('plain<b>plain</b>{\\rtf1 plain}'))
  assert.deepEqual(store.capture({
    ...text('small'),
    formatted: { html: 'x'.repeat(2 * 1024 * 1024 + 1) },
  }), { status: 'skipped', reason: 'too-large' })
})

test('忽略下一次复制只消费一次，暂停时不消耗待执行动作', () => {
  const { store } = createStore()
  store.ignoreNext()
  assert.deepEqual(store.capture(text('ignored')), { status: 'skipped', reason: 'ignored' })
  assert.equal(store.capture(text('recorded')).status, 'recorded')
  store.ignoreNext()
  store.setPaused(true)
  assert.deepEqual(store.capture(text('paused')), { status: 'skipped', reason: 'paused' })
  store.setPaused(false)
  assert.deepEqual(store.capture(text('ignored-after-resume')), { status: 'skipped', reason: 'ignored' })
})

test('置顶不占普通条数，普通记录超限只淘汰最旧未置顶项', () => {
  const { store } = createStore({ historyLimit: 1 })
  const a = store.capture(text('a')).entry
  store.setPinned(a.id, true)
  const b = store.capture(text('b')).entry
  const c = store.capture(text('c')).entry
  assert.deepEqual(store.list().map((entry) => entry.text), ['a', 'c'])
  assert.equal(store.list().some((entry) => entry.id === b.id), false)
})

test('单条删除进入 Trash，可恢复、永久删除和清空；清空历史保留置顶', () => {
  const { store } = createStore()
  const pinned = store.capture(text('pinned')).entry
  store.setPinned(pinned.id, true)
  const ordinary = store.capture(text('ordinary')).entry
  assert.equal(store.moveToTrash(ordinary.id)?.state, 'trash')
  assert.equal(store.trash().length, 1)
  assert.equal(store.restore(ordinary.id)?.state, 'history')
  assert.equal(store.permanentlyDelete(ordinary.id), true)
  assert.equal(store.permanentlyDelete(ordinary.id), false)
  assert.equal(store.clearHistory(), 0)
  assert.equal(store.list()[0].id, pinned.id)
  assert.equal(store.emptyTrash(), 0)
})

test('清空所有内容永久删除 History 和 Trash，但不改变设置', () => {
  const { store } = createStore({ historyLimit: 7, totalBytes: 100 })
  const pinned = store.capture(text('pinned')).entry
  store.setPinned(pinned.id, true)
  const ordinary = store.capture(text('ordinary')).entry
  store.moveToTrash(ordinary.id)
  assert.equal(store.clearAllData(), 2)
  assert.equal(store.list().length, 0)
  assert.equal(store.trash().length, 0)
  assert.deepEqual(store.settings(), { historyLimit: 7, totalBytes: 100, retention: 'forever', paused: false })
})

test('容量只淘汰未置顶记录，置顶占满后新记录进入 storage-full', () => {
  const { store } = createStore({ totalBytes: 4 })
  const pinned = store.capture(text('1234')).entry
  store.setPinned(pinned.id, true)
  assert.deepEqual(store.capture(text('5')), { status: 'skipped', reason: 'storage-full' })
  assert.equal(store.list()[0].id, pinned.id)
})

test('保留期限和 Trash 期限会永久清理未置顶记录', () => {
  const day = 24 * 60 * 60 * 1000
  const { store, advance } = createStore({ retention: 30 })
  const old = store.capture(text('old')).entry
  const fresh = store.capture(text('fresh')).entry
  advance(29 * day + 1_000)
  store.moveToTrash(old.id)
  advance(31 * day + 1_000)
  assert.equal(store.purgeExpired(), 1)
  assert.equal(store.trash().length, 1)
  assert.equal(store.list().some((entry) => entry.id === fresh.id), false)
  advance(60 * day + 1_001)
  assert.equal(store.purgeExpired(), 1)
  assert.equal(store.trash().length, 0)
})
