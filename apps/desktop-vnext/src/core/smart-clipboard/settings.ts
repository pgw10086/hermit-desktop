import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  DEFAULT_ACTION_MAPPING,
  validateActionMapping,
  type ActionMapping,
} from '@tianbuyv/smart-clipboard/actions'
import {
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_TOTAL_BYTES,
  type ClipboardKind,
  type Retention,
} from '@tianbuyv/smart-clipboard/domain'

/** 动作映射的持久化语义版本；只用于识别旧版默认组合，不改变剪贴板数据。 */
const CURRENT_ACTION_MAPPING_VERSION = 2 as const

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
  /** 动作映射语义版本；缺失表示尚未完成旧版默认组合迁移。 */
  readonly actionMappingVersion?: typeof CURRENT_ACTION_MAPPING_VERSION
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
    writeFileSync(temporary, `${JSON.stringify({ ...settings, actionMappingVersion: CURRENT_ACTION_MAPPING_VERSION }, null, 2)}\n`, { mode: 0o600 })
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
    actionMappingVersion: CURRENT_ACTION_MAPPING_VERSION,
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
  const actionMappingVersion = parseActionMappingVersion(record.actionMappingVersion)
  const actionMapping = record.actionMapping
  if (typeof actionMapping !== 'object' || actionMapping === null) throw new Error('动作映射设置无效')
  const mapping = migrateActionMapping(actionMapping, actionMappingVersion)
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
    actionMappingVersion: CURRENT_ACTION_MAPPING_VERSION,
    excludedApplications,
    excludedKinds,
  }
}

/**
 * 将没有版本标记的旧版默认组合迁移到当前 Maccy 式默认动作。
 * 仅迁移可识别的旧默认值；带当前版本标记的用户自定义组合必须原样保留。
 */
function migrateActionMapping(value: object, version: typeof CURRENT_ACTION_MAPPING_VERSION | undefined): ActionMapping {
  const raw = value as Record<string, unknown>
  if (
    version === undefined
    && (raw.Enter === 'use' || raw.Enter === 'paste')
    && raw['Mod+Enter'] === 'copy'
    && raw['Shift+Enter'] === 'plain-text'
  ) {
    return DEFAULT_ACTION_MAPPING
  }
  const normalize = (action: unknown): unknown => action === 'use' ? 'paste' : action
  return {
    Enter: normalize(raw.Enter) as ActionMapping['Enter'],
    'Mod+Enter': normalize(raw['Mod+Enter']) as ActionMapping['Mod+Enter'],
    'Shift+Enter': normalize(raw['Shift+Enter']) as ActionMapping['Shift+Enter'],
  }
}

/** 只接受当前已知版本；未知版本回到完整默认设置，避免静默误解释快捷键。 */
function parseActionMappingVersion(value: unknown): typeof CURRENT_ACTION_MAPPING_VERSION | undefined {
  if (value === undefined) return undefined
  if (value !== CURRENT_ACTION_MAPPING_VERSION) throw new Error('动作映射版本无效')
  return CURRENT_ACTION_MAPPING_VERSION
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
