import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type {
  ClipboardEntry,
  ClipboardRepository,
  FileListItem,
  HistoryState,
  TextClipboardEntry,
} from '@hermit/smart-clipboard/domain'

interface StoredPayload {
  /** 进入 Trash 的时间；活动记录不写入该字段。 */
  readonly trashedAt?: number
  /** 文本正文。 */
  readonly text?: string
  /** 文本富格式正文。 */
  readonly formatted?: TextClipboardEntry['formatted']
  /** 图片原始字节的 base64 编码。 */
  readonly imageBase64?: string
  /** 图片像素宽度。 */
  readonly width?: number
  /** 图片像素高度。 */
  readonly height?: number
  /** 图片是否包含透明通道。 */
  readonly hasAlpha?: boolean
  /** 文件列表快照。 */
  readonly items?: readonly FileListItem[]
}

interface EntryRow {
  /** 数据库主键。 */
  readonly id: string
  /** history 或 trash。 */
  readonly state: string
  /** TEXT、IMAGE 或 FILE_LIST。 */
  readonly kind: string
  /** 来源应用标识。 */
  readonly source_application: string | null
  /** 首次捕获时间。 */
  readonly created_at: number
  /** 最近使用时间。 */
  readonly last_used_at: number
  /** SQLite 布尔值。 */
  readonly pinned: number
  /** 记录占用字节数。 */
  readonly byte_size: number
  /** JSON 编码的类型 payload。 */
  readonly payload: string
}

/** FTS 查询只返回记录身份，再由主表解码完整内容。 */
interface SearchRow { readonly id: string }

/** Core-owned SQLite repository. The plugin only sees the public repository contract. */
export class SqliteClipboardRepository implements ClipboardRepository {
  readonly #database: DatabaseSync
  readonly #databasePath: string
  readonly #selectByState: StatementSync
  readonly #selectAll: StatementSync
  readonly #insert: StatementSync
  readonly #update: StatementSync
  readonly #remove: StatementSync
  readonly #searchIds: StatementSync
  readonly #insertSearch: StatementSync
  readonly #removeSearch: StatementSync

  constructor(databasePath: string) {
    this.#databasePath = databasePath
    const databaseDirectory = dirname(databasePath)
    mkdirSync(databaseDirectory, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') chmodSync(databaseDirectory, 0o700)
    this.#database = new DatabaseSync(databasePath)
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS clipboard_entries (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK (state IN ('history', 'trash')),
        kind TEXT NOT NULL CHECK (kind IN ('TEXT', 'IMAGE', 'FILE_LIST')),
        source_application TEXT,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
        byte_size INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS clipboard_entries_state_recent
        ON clipboard_entries(state, pinned, last_used_at DESC, created_at DESC);
      CREATE VIRTUAL TABLE IF NOT EXISTS clipboard_entries_fts USING fts5(
        id UNINDEXED,
        state UNINDEXED,
        text,
        file_names,
        tokenize='trigram'
      );
    `)
    this.#secureFiles()
    this.#selectByState = this.#database.prepare(
      'SELECT id, state, kind, source_application, created_at, last_used_at, pinned, byte_size, payload FROM clipboard_entries WHERE state = ?',
    )
    this.#selectAll = this.#database.prepare(
      'SELECT id, state, kind, source_application, created_at, last_used_at, pinned, byte_size, payload FROM clipboard_entries',
    )
    this.#insert = this.#database.prepare(
      'INSERT INTO clipboard_entries (id, state, kind, source_application, created_at, last_used_at, pinned, byte_size, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    this.#update = this.#database.prepare(
      'UPDATE clipboard_entries SET state = ?, kind = ?, source_application = ?, created_at = ?, last_used_at = ?, pinned = ?, byte_size = ?, payload = ? WHERE id = ?',
    )
    this.#remove = this.#database.prepare('DELETE FROM clipboard_entries WHERE id = ?')
    this.#searchIds = this.#database.prepare(
      'SELECT id FROM clipboard_entries_fts WHERE clipboard_entries_fts MATCH ? AND state = ?',
    )
    this.#insertSearch = this.#database.prepare(
      'INSERT INTO clipboard_entries_fts (id, state, text, file_names) VALUES (?, ?, ?, ?)',
    )
    this.#removeSearch = this.#database.prepare('DELETE FROM clipboard_entries_fts WHERE id = ?')
    this.#rebuildSearchIndex()
  }

  findDuplicate(candidate: ClipboardEntry, state: HistoryState): ClipboardEntry | undefined {
    return this.list(state).find((entry) => sameContent(entry, candidate))
  }

  list(state: HistoryState): readonly ClipboardEntry[] {
    return (this.#selectByState.all(state) as unknown as EntryRow[]).map(decodeEntry)
  }

  /** 使用 FTS 过滤记录；短查询回退到领域可接受的完整列表语义。 */
  search(state: HistoryState, query: string): readonly ClipboardEntry[] {
    if ([...query].length < 3) return this.list(state)
    const normalized = query.toLocaleLowerCase()
    const expression = `"${normalized.replaceAll('"', '""')}"`
    const ids = new Set((this.#searchIds.all(expression, state) as unknown as SearchRow[]).map((row) => row.id))
    return this.list(state).filter((entry) => ids.has(entry.id))
  }

  insert(entry: ClipboardEntry): void {
    this.#transaction(() => {
      this.#insert.run(
        entry.id,
        entry.state,
        entry.kind,
        entry.sourceApplication,
        entry.createdAt,
        entry.lastUsedAt,
        entry.pinned ? 1 : 0,
        entry.byteSize,
        JSON.stringify(encodePayload(entry)),
      )
      this.#index(entry)
    })
  }

  update(entry: ClipboardEntry): void {
    this.#transaction(() => {
      this.#update.run(
        entry.state,
        entry.kind,
        entry.sourceApplication,
        entry.createdAt,
        entry.lastUsedAt,
        entry.pinned ? 1 : 0,
        entry.byteSize,
        JSON.stringify(encodePayload(entry)),
        entry.id,
      )
      this.#removeSearch.run(entry.id)
      this.#index(entry)
    })
  }

  remove(id: string): void {
    this.#transaction(() => {
      this.#remove.run(id)
      this.#removeSearch.run(id)
    })
  }

  count(state: HistoryState): number {
    return this.list(state).length
  }

  bytes(state?: HistoryState): number {
    const rows = state === undefined
      ? this.#selectAll.all() as unknown as EntryRow[]
      : this.#selectByState.all(state) as unknown as EntryRow[]
    return rows.reduce((total, row) => total + row.byte_size, 0)
  }

  /** 截断 WAL 并重新收紧文件权限，供低频维护任务调用。 */
  compact(): void {
    this.#database.exec('PRAGMA wal_checkpoint(TRUNCATE);')
    this.#secureFiles()
  }

  /** 关闭数据库句柄；调用方负责确保不再提交新操作。 */
  close(): void {
    this.#database.close()
  }

  #index(entry: ClipboardEntry): void {
    const projection = searchProjection(entry)
    this.#insertSearch.run(entry.id, entry.state, projection.text, projection.fileNames)
  }

  #rebuildSearchIndex(): void {
    this.#transaction(() => {
      this.#database.exec('DELETE FROM clipboard_entries_fts;')
      for (const row of this.#selectAll.all() as unknown as EntryRow[]) this.#index(decodeEntry(row))
    })
  }

  #transaction(operation: () => void): void {
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      operation()
      this.#database.exec('COMMIT;')
      this.#secureFiles()
    } catch (cause) {
      this.#database.exec('ROLLBACK;')
      throw cause
    }
  }

  #secureFiles(): void {
    // Windows 使用 NTFS ACL 管理权限；chmod 的 POSIX mode 在 Windows 上可能把文件标成只读，
    // 进而阻止 SQLite/WAL 清理。这里只在支持该语义的平台收紧文件权限。
    if (process.platform === 'win32') return
    for (const file of [this.#databasePath, `${this.#databasePath}-wal`, `${this.#databasePath}-shm`]) {
      if (existsSync(file)) chmodSync(file, 0o600)
    }
  }
}

/** 生成 FTS 索引投影；图片正文不进入全文索引。 */
function searchProjection(entry: ClipboardEntry): { readonly text: string; readonly fileNames: string } {
  if (entry.kind === 'TEXT') return { text: entry.text.toLocaleLowerCase(), fileNames: '' }
  if (entry.kind === 'FILE_LIST') {
    return { text: '', fileNames: entry.items.map((item) => item.displayName.toLocaleLowerCase()).join('\n') }
  }
  return { text: '', fileNames: '' }
}

/** 将领域联合类型编码为稳定 JSON payload，二进制图片单独 base64 化。 */
function encodePayload(entry: ClipboardEntry): StoredPayload {
  const lifecycle = entry.trashedAt === undefined ? {} : { trashedAt: entry.trashedAt }
  if (entry.kind === 'TEXT') return { ...lifecycle, text: entry.text, ...(entry.formatted === undefined ? {} : { formatted: entry.formatted }) }
  if (entry.kind === 'IMAGE') {
    return {
      ...lifecycle,
      imageBase64: Buffer.from(entry.bytes).toString('base64'),
      width: entry.width,
      height: entry.height,
      hasAlpha: entry.hasAlpha,
    }
  }
  return { ...lifecycle, items: entry.items }
}

/** 校验并解码数据库行；任何结构不一致都必须显式失败。 */
function decodeEntry(row: EntryRow): ClipboardEntry {
  const payload = JSON.parse(row.payload) as StoredPayload
  if (payload.trashedAt !== undefined && (!Number.isSafeInteger(payload.trashedAt) || payload.trashedAt < 0)) {
    throw new Error(`剪贴板记录 ${row.id} 的删除时间无效`)
  }
  const base = {
    id: row.id,
    sourceApplication: row.source_application,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    pinned: row.pinned === 1,
    state: row.state as HistoryState,
    byteSize: row.byte_size,
    ...(payload.trashedAt === undefined ? {} : { trashedAt: payload.trashedAt }),
  }
  if (row.kind === 'TEXT' && typeof payload.text === 'string') {
    return {
      ...base,
      kind: 'TEXT',
      text: payload.text,
      ...(payload.formatted === undefined ? {} : { formatted: payload.formatted }),
    }
  }
  if (row.kind === 'IMAGE' && typeof payload.imageBase64 === 'string'
    && typeof payload.width === 'number' && Number.isInteger(payload.width)
    && typeof payload.height === 'number' && Number.isInteger(payload.height)
    && typeof payload.hasAlpha === 'boolean') {
    return {
      ...base,
      kind: 'IMAGE',
      bytes: new Uint8Array(Buffer.from(payload.imageBase64, 'base64')),
      width: payload.width,
      height: payload.height,
      hasAlpha: payload.hasAlpha,
    }
  }
  if (row.kind === 'FILE_LIST' && Array.isArray(payload.items)) {
    return { ...base, kind: 'FILE_LIST', items: payload.items }
  }
  throw new Error(`剪贴板记录 ${row.id} 的 payload 无效`)
}

/** 按内容而非记录身份判断重复，供领域去重查询使用。 */
function sameContent(left: ClipboardEntry, right: ClipboardEntry): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'TEXT' && right.kind === 'TEXT') return left.text === right.text
  if (left.kind === 'IMAGE' && right.kind === 'IMAGE') {
    return left.width === right.width && left.height === right.height
      && left.hasAlpha === right.hasAlpha && left.bytes.byteLength === right.bytes.byteLength
      && left.bytes.every((value, index) => value === right.bytes[index])
  }
  if (left.kind === 'FILE_LIST' && right.kind === 'FILE_LIST') {
    return left.items.length === right.items.length && left.items.every((item, index) => {
      const other = right.items[index]
      return other !== undefined && item.path === other.path && item.itemType === other.itemType
    })
  }
  return false
}
