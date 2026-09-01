import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type {
  FileRecord,
  FileWorkspaceGlobal,
  FolderRecord,
  ManagedBlobRecord,
  OperationRecord,
  RevisionRecord,
} from './types.js'

/** 文件夹记录的持久化校验；fixed 用于保护系统预置目录不被业务删除。 */
const folderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  fixed: z.boolean(),
  createdAt: z.string().datetime(),
}) satisfies z.ZodType<FolderRecord>

/** 文件元数据校验；正文只通过 revision/blob 关联保存，避免元数据和内容脱节。 */
const fileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  folderId: z.string().min(1),
  extension: z.string(),
  mediaType: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  currentRevisionId: z.string().min(1),
  state: z.union([z.literal('active'), z.literal('trashed')]),
  previousFolderId: z.string().min(1).optional(),
}) satisfies z.ZodType<FileRecord>

/** 文件正文 blob 校验；data 是编码后的内容，byteSize 用于配额和完整性核对。 */
const blobSchema = z.object({
  id: z.string().min(1),
  fileId: z.string().min(1),
  data: z.string(),
  byteSize: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
}) satisfies z.ZodType<ManagedBlobRecord>

/** 文件修订校验；number 必须单调递增，blobId 指向该版本的实际内容。 */
const revisionSchema = z.object({
  id: z.string().min(1),
  fileId: z.string().min(1),
  number: z.number().int().positive(),
  blobId: z.string().min(1),
  createdAt: z.string().datetime(),
}) satisfies z.ZodType<RevisionRecord>

/** 两阶段文件操作校验；prepared 状态用于崩溃恢复，committed 才能视为完成。 */
const operationSchema = z.object({
  id: z.string().min(1),
  kind: z.union([z.literal('create'), z.literal('replace'), z.literal('purge')]),
  fileId: z.string().min(1),
  blobId: z.string().min(1),
  revisionId: z.string().min(1),
  stage: z.union([z.literal('prepared'), z.literal('committed')]),
  previousFile: fileSchema.optional(),
  cleanupRevisionIds: z.array(z.string().min(1)).optional(),
  cleanupBlobIds: z.array(z.string().min(1)).optional(),
}) satisfies z.ZodType<OperationRecord>

/** 工作区全局状态校验；只保存恢复入口，不把列表数据复制到 global。 */
const globalSchema = z.object({
  initialized: z.boolean(),
  lastOpenFileId: z.string().min(1).optional(),
}) satisfies z.ZodType<FileWorkspaceGlobal>

/** File Workspace 的唯一领域注册；表结构和 global 状态由此作为持久化真源。 */
export const FILE_WORKSPACE_DOMAIN = defineDomain({
  name: 'file_workspace',
  version: 1,
  global: {
    schema: globalSchema,
    initial: { initialized: false, lastOpenFileId: undefined },
  },
  tables: {
    folders: domainTable<string, FolderRecord>(folderSchema),
    files: domainTable<string, FileRecord>(fileSchema),
    blobs: domainTable<string, ManagedBlobRecord>(blobSchema),
    revisions: domainTable<string, RevisionRecord>(revisionSchema),
    operations: domainTable<string, OperationRecord>(operationSchema),
  },
} as const)

/** 快速笔记固定目录 ID，跨 UI、导入和恢复流程必须保持稳定。 */
export const QUICK_NOTES_FOLDER_ID = 'quick-notes'
/** 工作区根目录 ID，所有用户目录都从该节点开始。 */
export const ROOT_FOLDER_ID = 'root'
