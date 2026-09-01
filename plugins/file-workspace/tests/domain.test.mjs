import test from 'node:test'
import assert from 'node:assert/strict'
import { FileWorkspaceService } from '../lib/domain/service.js'

class MemoryTable {
  constructor() { this.values = new Map() }
  get(key) { return this.values.get(key) }
  entries() { return this.values.entries() }
  keys() { return this.values.keys() }
  get size() { return this.values.size }
  async put(key, value) { this.values.set(key, value) }
  async delete(key) { return this.values.delete(key) }
  async update(key, fn) { const next = fn(this.values.get(key)); this.values.set(key, next); return next }
}

class MemoryDomain {
  constructor() {
    this.tables = new Map(['folders', 'files', 'blobs', 'revisions', 'operations'].map((name) => [name, new MemoryTable()]))
    this.globalValue = { initialized: false, lastOpenFileId: undefined }
  }
  table(name) { return this.tables.get(name) }
  get global() { return { get: () => this.globalValue, set: async (value) => { this.globalValue = value } } }
  async close() {}
}

async function openMemoryService() {
  const domain = new MemoryDomain()
  const service = await FileWorkspaceService.open({ storage: { domain: { open: async () => domain } } })
  return { service, domain }
}

function b64(bytes) { return Buffer.from(bytes).toString('base64') }

test('新建快速记事正文为空，并能写入新 revision', async () => {
  const { service } = await openMemoryService()
  const created = await service.createNote()
  assert.equal(created.content, '')
  const first = await service.read(created.file.id)
  assert.equal(first.content, '')
  assert.equal(first.file.byteSize, 0)

  const saved = await service.saveMarkdown(created.file.id, first.revisionId, '# 事项')
  assert.equal(saved.content, '# 事项')
  assert.notEqual(saved.revisionId, first.revisionId)
  const reopened = await service.read(created.file.id)
  assert.equal(reopened.content, '# 事项')
  await assert.rejects(() => service.saveMarkdown(created.file.id, first.revisionId, '过期内容'), /已经更新/)
})

test('任意普通文件按 managed bytes 导入，冲突只允许替换或跳过', async () => {
  const { service } = await openMemoryService()
  const input = { name: 'archive.bin', mediaType: 'application/octet-stream', data: b64([0, 255, 1, 2]), destinationFolderId: 'root', mode: 'create' }
  const created = await service.importFile(input)
  assert.equal(created.operation, 'created')
  const read = await service.read(created.file.id)
  assert.equal(read.projectionError, 'unsupported')
  const skipped = await service.importFile({ ...input, mode: 'skip' })
  assert.equal(skipped.operation, 'skipped')
  const replaced = await service.importFile({ ...input, data: b64([9, 8, 7]), mode: 'replace' })
  assert.equal(replaced.operation, 'replaced')
  assert.equal(replaced.file.id, created.file.id)
  assert.equal(replaced.file.byteSize, 3)
})

test('废纸篓恢复遇到同名文件会自动改名，永久删除会清理托管数据', async () => {
  const { service, domain } = await openMemoryService()
  const first = await service.importFile({ name: 'memo.txt', mediaType: 'text/plain', data: b64([1]), destinationFolderId: 'root', mode: 'create' })
  await service.trashFile(first.file.id)
  const second = await service.importFile({ name: 'memo.txt', mediaType: 'text/plain', data: b64([2]), destinationFolderId: 'root', mode: 'create' })
  const restored = await service.restoreFile(first.file.id)
  assert.match(restored.file.name, /已恢复/)
  await service.trashFile(restored.file.id)
  await service.purgeFile(restored.file.id)
  assert.equal(domain.table('files').get(restored.file.id), undefined)
  assert.equal(domain.table('revisions').get(restored.revisionId), undefined)
  assert.notEqual(second.file.id, restored.file.id)
})

test('replace journal 未完成时恢复旧 FileRecord 并清理新 revision', async () => {
  const { service, domain } = await openMemoryService()
  const created = await service.importFile({ name: 'journal.md', mediaType: 'text/markdown', data: b64([]), destinationFolderId: 'root', mode: 'create' })
  const current = domain.table('files').get(created.file.id)
  const operation = { id: 'op', kind: 'replace', fileId: current.id, blobId: 'new-blob', revisionId: 'new-revision', stage: 'prepared', previousFile: current }
  await domain.table('operations').put(operation.id, operation)
  await domain.table('blobs').put(operation.blobId, { id: operation.blobId, fileId: current.id, data: b64([3]), byteSize: 1, createdAt: current.updatedAt })
  await domain.table('revisions').put(operation.revisionId, { id: operation.revisionId, fileId: current.id, number: 2, blobId: operation.blobId, createdAt: current.updatedAt })
  await service.reconcileOperations()
  assert.equal(domain.table('files').get(current.id).currentRevisionId, current.currentRevisionId)
  assert.equal(domain.table('blobs').get(operation.blobId), undefined)
  assert.equal(domain.table('operations').get(operation.id), undefined)
})

test('普通文件夹只有为空时才能删除，清空废纸篓会删除所有托管文件', async () => {
  const { service, domain } = await openMemoryService()
  await service.createFolder('项目')
  const folderId = [...domain.table('folders').entries()].find(([, value]) => value.name === '项目')[0]
  const file = await service.importFile({ name: 'a.bin', mediaType: 'application/octet-stream', data: b64([1]), destinationFolderId: folderId, mode: 'create' })
  await assert.rejects(() => service.deleteFolder(folderId), /不为空/)
  await service.trashFile(file.file.id)
  await service.purgeTrash()
  assert.equal(domain.table('files').get(file.file.id), undefined)
  assert.equal((await service.deleteFolder(folderId)).operation, 'deleted')
})
