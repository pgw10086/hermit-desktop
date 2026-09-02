import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  DEFAULT_ACTION_MAPPING,
  validateActionMapping,
  type ActionMapping,
} from '@hermit/smart-clipboard/actions'
import {
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_TOTAL_BYTES,
  type ClipboardKind,
  type Retention,
} from '@hermit/smart-clipboard/domain'

export interface SmartClipboardPersistedSettings {
  /** 活动历史条数上限。 */
  readonly historyLimit: number
  /** 历史数据总字节上限。 */
  readonly totalBytes: number
  /** 历史记录保留期限。 */
  readonly retention: Retention
  /** 是否暂停平台捕获。 */
  readonly paused: boolean
  /** 快捷键动作映射。 */
  readonly actionMapping: ActionMapping
  /** 不捕获的来源应用。 */
  readonly excludedApplications: readonly string[]
  /** 不捕获的内容类型。 */
  readonly excludedKinds: readonly ClipboardKind[]
}

export class SmartClipboardSettingsStore {
  readonly #path: string

  constructor(filePath: string) {
    this.#path = filePath
  }

  /** 从用户数据目录读取并校验设置；文件缺失或损坏时返回明确默认值。 */
  read(): SmartClipboardPersistedSettings {
    try {
      const parsed = JSON.parse(readFileSync(this.#path, 'utf8')) as unknown
      return parseSettings(parsed)
    } catch {
      return defaults()
    }
  }

  /** 以临时文件加原子替换写入设置，避免部分 JSON 被读取。 */
  write(settings: SmartClipboardPersistedSettings): void {
    const directory = dirname(this.#path)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const temporary = `${this.#path}.tmp-${String(process.pid)}`
    writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, this.#path)
  }
}

/** 构造首次启动的默认设置。 */
function defaults(): SmartClipboardPersistedSettings {
  return {
    historyLimit: DEFAULT_HISTORY_LIMIT,
    totalBytes: DEFAULT_TOTAL_BYTES,
    retention: 'forever',
    paused: false,
    actionMapping: DEFAULT_ACTION_MAPPING,
    excludedApplications: [],
    excludedKinds: [],
  }
}

/** 校验持久化设置并转换为内部类型。 */
function parseSettings(value: unknown): SmartClipboardPersistedSettings {
  if (typeof value !== 'object' || value === null) throw new Error('设置格式无效')
  const record = value as Record<string, unknown>
  if (!Number.isInteger(record.historyLimit) || (record.historyLimit as number) < 1) throw new Error('历史条数设置无效')
  if (!Number.isSafeInteger(record.totalBytes) || (record.totalBytes as number) < 1) throw new Error('容量设置无效')
  if (record.retention !== 'forever' && record.retention !== 30 && record.retention !== 90 && record.retention !== 365) throw new Error('保留期限设置无效')
  if (typeof record.paused !== 'boolean') throw new Error('暂停设置无效')
  const actionMapping = record.actionMapping
  if (typeof actionMapping !== 'object' || actionMapping === null) throw new Error('动作映射设置无效')
  const mapping = migrateActionMapping(actionMapping)
  const validation = validateActionMapping(mapping)
  if (!validation.valid) throw new Error('动作映射设置无效')
  const excludedApplications = parseApplicationExclusions(record.excludedApplications)
  const excludedKinds = parseKindExclusions(record.excludedKinds)
  return {
    historyLimit: record.historyLimit as number,
    totalBytes: record.totalBytes as number,
    retention: record.retention as Retention,
    paused: record.paused,
    actionMapping: validation.mapping,
    excludedApplications,
    excludedKinds,
  }
}

/** 将早期把显式粘贴称为 use 的设置迁移到当前 vocabulary，不改变其他用户选择。 */
function migrateActionMapping(value: object): ActionMapping {
  const raw = value as Record<string, unknown>
  const normalize = (action: unknown): unknown => action === 'use' ? 'paste' : action
  return {
    Enter: normalize(raw.Enter) as ActionMapping['Enter'],
    'Mod+Enter': normalize(raw['Mod+Enter']) as ActionMapping['Mod+Enter'],
    'Shift+Enter': normalize(raw['Shift+Enter']) as ActionMapping['Shift+Enter'],
  }
}

/** 解析并限制来源应用排除列表。 */
function parseApplicationExclusions(value: unknown): readonly string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error('排除应用设置无效')
  const normalized = [...new Set(value.map((item) => item.trim()).filter(Boolean))]
  if (normalized.length > 256 || normalized.some((item) => item.length > 256)) throw new Error('排除应用设置无效')
  return normalized
}

/** 解析内容类型排除列表。 */
function parseKindExclusions(value: unknown): readonly ClipboardKind[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((item) => item === 'TEXT' || item === 'IMAGE' || item === 'FILE_LIST')) {
    throw new Error('排除类型设置无效')
  }
  return [...new Set(value)]
}
