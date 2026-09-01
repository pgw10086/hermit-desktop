import type { Context } from '@deepseek-ai/cordis'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { FILE_WORKSPACE_DOMAIN, QUICK_NOTES_FOLDER_ID, ROOT_FOLDER_ID } from './spec.js'
import type {
  FileReadResult,
  FileRecord,
  FileSummary,
  FileWorkspaceGlobal,
  FileWorkspaceRpcResponse,
  FolderRecord,
  ImportFileInput,
  ManagedBlobRecord,
  OperationRecord,
  RevisionRecord,
  WorkspaceSnapshot,
} from './types.js'

const MAX_NAME_LENGTH = 255
const emptyGlobal: FileWorkspaceGlobal = { initialized: false }

function now(): string {
  return new Date().toISOString()
}

function assertFileName(name: string): string {
  const value = name.trim()
  if (value.length === 0 || value.length > MAX_NAME_LENGTH || value === '.' || value === '..'
    || value.includes('/') || value.includes('\\') || value.includes('\0')) {
    throw new Error('文件名无效：请输入不含路径分隔符的文件名')
  }
  return value
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

function decodeBase64(data: string): Buffer {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(data) || data.length % 4 !== 0) {
    throw new Error('文件内容不是有效的 Base64')
  }
  const bytes = Buffer.from(data, 'base64')
  if (bytes.toString('base64') !== data) throw new Error('文件内容不是有效的 Base64')
  return bytes
}

function decodeUtf8(data: string): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64(data))
  } catch {
    return undefined
  }
}

function isEditable(file: Pick<FileRecord, 'extension'>, blob: ManagedBlobRecord | undefined): boolean {
  return file.extension === '.md' && blob !== undefined && decodeUtf8(blob.data) !== undefined
}

function summary(file: FileRecord, blob: ManagedBlobRecord | undefined): FileSummary {
  return {
    id: file.id,
    name: file.name,
    folderId: file.folderId,
    extension: file.extension,
    mediaType: file.mediaType,
    byteSize: file.byteSize,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    state: file.state,
    editable: isEditable(file, blob),
  }
}

function titleWithRestoreSuffix(title: string, names: ReadonlySet<string>): string {
  if (!names.has(title)) return title
  const dot = title.lastIndexOf('.')
  const base = dot > 0 ? title.slice(0, dot) : title
  const ext = dot > 0 ? title.slice(dot) : ''
  let candidate = `${base}（已恢复）${ext}`
  let index = 2
  while (names.has(candidate)) candidate = `${base}（已恢复 ${String(index++)}）${ext}`
  return candidate
}

function uniqueNoteName(names: ReadonlySet<string>): string {
  let index = 1
  while (names.has(`快速记事 ${String(index)}.md`)) index += 1
  return `快速记事 ${String(index)}.md`
}

/** File Workspace 的唯一持久化 writer。所有跨表变更都先写 operations journal，重启时收敛半成品。 */
export class FileWorkspaceService {
  private constructor(private readonly domain: Domain<typeof FILE_WORKSPACE_DOMAIN>) {}

  static async open(ctx: Context): Promise<FileWorkspaceService> {
    const domain = await ctx.storage.domain.open(FILE_WORKSPACE_DOMAIN)
    const service = new FileWorkspaceService(domain)
    await service.reconcileOperations()
    await service.ensureRootAndQuickNotes()
    return service
  }

  async close(): Promise<void> {
    await this.domain.close()
  }

  async snapshot(): Promise<WorkspaceSnapshot> {
    const folders = this.folders().sort((a, b) => (a.id === QUICK_NOTES_FOLDER_ID ? -1 : b.id === QUICK_NOTES_FOLDER_ID ? 1 : a.name.localeCompare(b.name)))
    const allFiles = this.files()
    const files = [...allFiles.filter((file) => file.state === 'active')]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((file) => summary(file, this.blobForCurrent(file)))
    const trash = [...allFiles.filter((file) => file.state === 'trashed')]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((file) => summary(file, this.blobForCurrent(file)))
    const global = this.domain.global.get()
    return {
      folders,
      files,
      trash,
      ...(global.lastOpenFileId === undefined ? {} : { lastOpenFileId: global.lastOpenFileId }),
    }
  }

  async read(fileId: string): Promise<FileReadResult> {
    const file = this.requireActiveFile(fileId)
    const blob = this.blobForCurrent(file)
    const fileSummary = summary(file, blob)
    if (!fileSummary.editable) {
      return { file: fileSummary, revisionId: file.currentRevisionId, projectionError: 'unsupported' }
    }
    const content = decodeUtf8(blob?.data ?? '')
    if (content === undefined) return { file: fileSummary, revisionId: file.currentRevisionId, projectionError: 'parse failed' }
    return { file: fileSummary, revisionId: file.currentRevisionId, content, projection: content }
  }

  async createNote(): Promise<FileWorkspaceRpcResponse> {
    const names = new Set(this.filesInFolder(QUICK_NOTES_FOLDER_ID).map((file) => file.name))
    const created = await this.createManaged(uniqueNoteName(names), 'text/markdown', '', QUICK_NOTES_FOLDER_ID)
    await this.setLastOpen(created.id)
    return { file: summary(created, this.blobForCurrent(created)), operation: 'created', content: '' }
  }

  async createFolder(name: string): Promise<FileWorkspaceRpcResponse> {
    const value = assertFileName(name)
    if (this.folders().some((folder) => folder.name === value)) throw new Error(`文件夹“${value}”已存在`)
    const folder: FolderRecord = { id: crypto.randomUUID(), name: value, fixed: false, createdAt: now() }
    await this.table('folders').put(folder.id, folder)
    return { name: folder.name, operation: 'created' }
  }

  async deleteFolder(folderId: string): Promise<FileWorkspaceRpcResponse> {
    const folder = this.requireFolder(folderId)
    if (folder.fixed || folder.id === ROOT_FOLDER_ID || folder.id === QUICK_NOTES_FOLDER_ID) {
      throw new Error('固定文件夹不能删除')
    }
    const hasFiles = this.files().some((file) => file.folderId === folder.id || file.previousFolderId === folder.id)
    if (hasFiles) throw new Error('文件夹不为空，请先移动或处理其中的文件')
    await this.table('folders').delete(folder.id)
    return { name: folder.name, operation: 'deleted' }
  }

  async moveFile(fileId: string, destinationFolderId: string): Promise<FileWorkspaceRpcResponse> {
    const file = this.requireActiveFile(fileId)
    this.requireFolder(destinationFolderId)
    if (file.folderId === destinationFolderId) return { file: summary(file, this.blobForCurrent(file)), operation: 'moved' }
    if (this.filesInFolder(destinationFolderId).some((candidate) => candidate.name === file.name)) {
      throw new Error(`目标文件夹中已存在“${file.name}”`)
    }
    const updated: FileRecord = { ...file, folderId: destinationFolderId, updatedAt: now() }
    await this.table('files').put(file.id, updated)
    return { file: summary(updated, this.blobForCurrent(updated)), operation: 'moved' }
  }

  async trashFile(fileId: string): Promise<FileWorkspaceRpcResponse> {
    const file = this.requireActiveFile(fileId)
    const updated: FileRecord = { ...file, state: 'trashed', previousFolderId: file.folderId, updatedAt: now() }
    await this.table('files').put(file.id, updated)
    return { file: summary(updated, this.blobForCurrent(updated)), operation: 'trashed' }
  }

  async restoreFile(fileId: string): Promise<FileWorkspaceRpcResponse> {
    const file = this.table('files').get(fileId)
    if (file === undefined || file.state !== 'trashed') throw new Error('废纸篓中找不到这个文件')
    const destination = file.previousFolderId !== undefined && this.table('folders').get(file.previousFolderId) !== undefined
      ? file.previousFolderId
      : ROOT_FOLDER_ID
    const names = new Set(this.filesInFolder(destination).map((candidate) => candidate.name))
    const restored: FileRecord = {
      ...file,
      name: titleWithRestoreSuffix(file.name, names),
      folderId: destination,
      state: 'active',
      previousFolderId: undefined,
      updatedAt: now(),
    }
    await this.table('files').put(file.id, restored)
    return { file: summary(restored, this.blobForCurrent(restored)), operation: 'restored' }
  }

  async purgeFile(fileId: string): Promise<FileWorkspaceRpcResponse> {
    const file = this.table('files').get(fileId)
    if (file === undefined || file.state !== 'trashed') throw new Error('只能永久删除废纸篓中的文件')
    const revisions = this.revisionsFor(file.id)
    const operation: OperationRecord = {
      id: crypto.randomUUID(), kind: 'purge', fileId: file.id, blobId: crypto.randomUUID(), revisionId: crypto.randomUUID(), stage: 'prepared',
      cleanupRevisionIds: revisions.map((revision) => revision.id),
      cleanupBlobIds: revisions.map((revision) => revision.blobId),
    }
    await this.table('operations').put(operation.id, operation)
    await this.table('files').delete(file.id)
    for (const revision of revisions) {
      await this.table('blobs').delete(revision.blobId)
      await this.table('revisions').delete(revision.id)
    }
    await this.table('operations').put(operation.id, { ...operation, stage: 'committed' })
    await this.table('operations').delete(operation.id)
    const global = this.domain.global.get()
    if (global.lastOpenFileId === file.id) await this.domain.global.set({ initialized: true })
    return { operation: 'purged' }
  }

  async purgeTrash(): Promise<FileWorkspaceRpcResponse> {
    const ids = this.files().filter((file) => file.state === 'trashed').map((file) => file.id)
    for (const id of ids) await this.purgeFile(id)
    return { operation: 'purged', count: ids.length }
  }

  async saveMarkdown(fileId: string, expectedRevisionId: string, content: string): Promise<FileWorkspaceRpcResponse> {
    const file = this.requireActiveFile(fileId)
    const current = this.table('revisions').get(file.currentRevisionId)
    if (current === undefined || current.id !== expectedRevisionId) throw new Error('文件已经更新，请重新打开后再保存')
    if (!isEditable(file, this.blobForCurrent(file))) throw new Error('这个文件当前不能编辑')
    const bytes = Buffer.from(content, 'utf8')
    const result = await this.commitRevision(file, bytes, 'replace')
    return { file: summary(result, this.blobForCurrent(result)), operation: 'saved', revisionId: result.currentRevisionId, content }
  }

  async importFile(input: ImportFileInput): Promise<FileWorkspaceRpcResponse> {
    const name = assertFileName(input.name)
    const destination = this.requireFolder(input.destinationFolderId)
    const bytes = decodeBase64(input.data)
    const existing = this.filesInFolder(destination.id).find((file) => file.name === name && file.state === 'active')
    if (existing !== undefined) {
      if (input.mode === 'skip') return { file: summary(existing, this.blobForCurrent(existing)), operation: 'skipped' }
      if (input.mode !== 'replace') throw new Error(`目标文件夹中已存在“${name}”`)
      const result = await this.commitRevision(existing, bytes, 'replace')
      return { file: summary(result, this.blobForCurrent(result)), operation: 'replaced', revisionId: result.currentRevisionId }
    }
    if (input.mode === 'replace') throw new Error(`目标文件夹中找不到“${name}”`)
    const created = await this.createManaged(name, input.mediaType || 'application/octet-stream', bytes, destination.id)
    return { file: summary(created, this.blobForCurrent(created)), operation: 'created', revisionId: created.currentRevisionId }
  }

  async setLastOpen(fileId: string): Promise<FileWorkspaceRpcResponse> {
    const file = this.requireActiveFile(fileId)
    const global = this.domain.global.get()
    await this.domain.global.set({ ...global, initialized: true, lastOpenFileId: file.id })
    return { file: summary(file, this.blobForCurrent(file)) }
  }

  private table<N extends 'folders' | 'files' | 'blobs' | 'revisions' | 'operations'>(name: N) {
    return this.domain.table(name)
  }

  private folders(): FolderRecord[] { return [...this.table('folders').entries()].map(([, value]) => value) }
  private files(): FileRecord[] { return [...this.table('files').entries()].map(([, value]) => value) }
  private filesInFolder(folderId: string): FileRecord[] { return this.files().filter((file) => file.folderId === folderId && file.state === 'active') }
  private revisionsFor(fileId: string): RevisionRecord[] { return [...this.table('revisions').entries()].map(([, value]) => value).filter((revision) => revision.fileId === fileId) }
  private blobForCurrent(file: FileRecord): ManagedBlobRecord | undefined {
    const revision = this.table('revisions').get(file.currentRevisionId)
    return revision === undefined ? undefined : this.table('blobs').get(revision.blobId)
  }
  private requireFolder(folderId: string): FolderRecord {
    const folder = this.table('folders').get(folderId)
    if (folder === undefined) throw new Error('目标文件夹不存在')
    return folder
  }
  private requireActiveFile(fileId: string): FileRecord {
    const file = this.table('files').get(fileId)
    if (file === undefined || file.state !== 'active') throw new Error('文件不存在或已在废纸篓中')
    return file
  }

  private async createManaged(name: string, mediaType: string, content: string | Buffer, folderId: string): Promise<FileRecord> {
    const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
    const fileId = crypto.randomUUID()
    const blobId = crypto.randomUUID()
    const revisionId = crypto.randomUUID()
    const timestamp = now()
    const operation: OperationRecord = { id: crypto.randomUUID(), kind: 'create', fileId, blobId, revisionId, stage: 'prepared' }
    await this.table('operations').put(operation.id, operation)
    await this.table('blobs').put(blobId, { id: blobId, fileId, data: bytes.toString('base64'), byteSize: bytes.byteLength, createdAt: timestamp })
    await this.table('revisions').put(revisionId, { id: revisionId, fileId, number: 1, blobId, createdAt: timestamp })
    const file: FileRecord = {
      id: fileId, name, folderId, extension: extensionOf(name), mediaType,
      byteSize: bytes.byteLength, createdAt: timestamp, updatedAt: timestamp,
      currentRevisionId: revisionId, state: 'active',
    }
    await this.table('files').put(file.id, file)
    await this.table('operations').put(operation.id, { ...operation, stage: 'committed' })
    await this.table('operations').delete(operation.id)
    return file
  }

  private async commitRevision(file: FileRecord, bytes: Buffer, kind: 'replace'): Promise<FileRecord> {
    const revisions = this.revisionsFor(file.id)
    const revisionId = crypto.randomUUID()
    const blobId = crypto.randomUUID()
    const timestamp = now()
    const operation: OperationRecord = { id: crypto.randomUUID(), kind, fileId: file.id, blobId, revisionId, stage: 'prepared', previousFile: file }
    await this.table('operations').put(operation.id, operation)
    await this.table('blobs').put(blobId, { id: blobId, fileId: file.id, data: bytes.toString('base64'), byteSize: bytes.byteLength, createdAt: timestamp })
    await this.table('revisions').put(revisionId, { id: revisionId, fileId: file.id, number: revisions.length + 1, blobId, createdAt: timestamp })
    const updated: FileRecord = { ...file, byteSize: bytes.byteLength, updatedAt: timestamp, currentRevisionId: revisionId }
    await this.table('files').put(file.id, updated)
    await this.table('operations').put(operation.id, { ...operation, stage: 'committed' })
    await this.table('operations').delete(operation.id)
    return updated
  }

  private async ensureRootAndQuickNotes(): Promise<void> {
    if (this.table('folders').get(ROOT_FOLDER_ID) === undefined) {
      await this.table('folders').put(ROOT_FOLDER_ID, { id: ROOT_FOLDER_ID, name: '根目录', fixed: true, createdAt: now() })
    }
    if (this.table('folders').get(QUICK_NOTES_FOLDER_ID) === undefined) {
      await this.table('folders').put(QUICK_NOTES_FOLDER_ID, { id: QUICK_NOTES_FOLDER_ID, name: '快速记事', fixed: true, createdAt: now() })
    }
    if (!this.domain.global.get().initialized) await this.domain.global.set(emptyGlobal)
  }

  private async reconcileOperations(): Promise<void> {
    for (const [key, operation] of this.table('operations').entries()) {
      if (operation.stage === 'prepared') {
        if (operation.kind === 'create') {
          await this.table('files').delete(operation.fileId)
          await this.table('revisions').delete(operation.revisionId)
          await this.table('blobs').delete(operation.blobId)
        } else if (operation.kind === 'replace') {
          await this.table('revisions').delete(operation.revisionId)
          await this.table('blobs').delete(operation.blobId)
          if (operation.previousFile !== undefined) await this.table('files').put(operation.fileId, operation.previousFile)
        } else {
          await this.table('files').delete(operation.fileId)
          for (const revisionId of operation.cleanupRevisionIds ?? []) await this.table('revisions').delete(revisionId)
          for (const blobId of operation.cleanupBlobIds ?? []) await this.table('blobs').delete(blobId)
        }
      }
      await this.table('operations').delete(key)
    }
  }
}

export const fileWorkspaceRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('snapshot') }),
  z.object({ operation: z.literal('read'), fileId: z.string().min(1) }),
  z.object({ operation: z.literal('create-note') }),
  z.object({ operation: z.literal('create-folder'), name: z.string() }),
  z.object({ operation: z.literal('delete-folder'), folderId: z.string().min(1) }),
  z.object({ operation: z.literal('move-file'), fileId: z.string().min(1), destinationFolderId: z.string().min(1) }),
  z.object({ operation: z.literal('trash-file'), fileId: z.string().min(1) }),
  z.object({ operation: z.literal('restore-file'), fileId: z.string().min(1) }),
  z.object({ operation: z.literal('purge-file'), fileId: z.string().min(1) }),
  z.object({ operation: z.literal('purge-trash') }),
  z.object({ operation: z.literal('save-markdown'), fileId: z.string().min(1), expectedRevisionId: z.string().min(1), content: z.string() }),
  z.object({
    operation: z.literal('import-file'),
    input: z.object({
      name: z.string(), mediaType: z.string(), data: z.string(),
      destinationFolderId: z.string().min(1), mode: z.union([z.literal('create'), z.literal('replace'), z.literal('skip')]),
    }),
  }),
  z.object({ operation: z.literal('set-last-open'), fileId: z.string().min(1) }),
])

export type ParsedFileWorkspaceRequest = z.infer<typeof fileWorkspaceRequestSchema>
