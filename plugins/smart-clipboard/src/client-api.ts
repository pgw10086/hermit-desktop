import type { ActionMapping, ClipboardAction } from './actions.js'
import type { ClipboardKind, HistoryFilter, Retention } from './full-history.js'

export interface TextClipboardWireEntry {
  /** 历史记录稳定身份。 */
  readonly id: string
  /** 类型标识。 */
  readonly kind: 'TEXT'
  /** 纯文本内容。 */
  readonly text: string
  /** 可选富文本表示。 */
  readonly formatted?: { readonly html?: string; readonly rtf?: string }
  /** 来源应用名称。 */
  readonly sourceApplication: string | null
  /** 创建时间。 */
  readonly createdAt: number
  /** 最近使用时间。 */
  readonly lastUsedAt: number
  /** 是否固定。 */
  readonly pinned: boolean
  /** 当前位于历史或废纸篓。 */
  readonly state: 'history' | 'trash'
  /** 该记录占用的字节数。 */
  readonly byteSize: number
}

export interface ImageClipboardWireEntry {
  /** 历史记录稳定身份。 */
  readonly id: string
  /** 类型标识。 */
  readonly kind: 'IMAGE'
  /** 供 Client 预览的资源 URL，不是 Canonical 图片字节。 */
  readonly previewUrl: string
  /** 图片像素宽度。 */
  readonly width: number
  /** 图片像素高度。 */
  readonly height: number
  /** 是否包含透明通道。 */
  readonly hasAlpha: boolean
  /** 来源应用名称。 */
  readonly sourceApplication: string | null
  /** 创建时间。 */
  readonly createdAt: number
  /** 最近使用时间。 */
  readonly lastUsedAt: number
  /** 是否固定。 */
  readonly pinned: boolean
  /** 当前位于历史或废纸篓。 */
  readonly state: 'history' | 'trash'
  /** 该记录占用的字节数。 */
  readonly byteSize: number
}

export interface FileListClipboardWireEntry {
  /** 历史记录稳定身份。 */
  readonly id: string
  /** 类型标识。 */
  readonly kind: 'FILE_LIST'
  readonly items: readonly {
    /** 文件名展示文本。 */
    readonly displayName: string
    /** 系统路径；使用前仍需检查存在性。 */
    readonly path: string
    /** 路径指向文件或文件夹。 */
    readonly itemType: 'file' | 'folder'
    /** 最近刷新时路径是否存在。 */
    readonly exists: boolean
    /** 文件大小；文件夹或不可用路径为空。 */
    readonly sizeBytes?: number
  }[]
  /** 来源应用名称。 */
  readonly sourceApplication: string | null
  /** 创建时间。 */
  readonly createdAt: number
  /** 最近使用时间。 */
  readonly lastUsedAt: number
  /** 是否固定。 */
  readonly pinned: boolean
  /** 当前位于历史或废纸篓。 */
  readonly state: 'history' | 'trash'
  /** 该记录占用的字节数。 */
  readonly byteSize: number
}

/** 面向 Client 的安全投影联合类型；图片正文只通过 previewUrl 暴露。 */
export type ClipboardWireEntry = TextClipboardWireEntry | ImageClipboardWireEntry | FileListClipboardWireEntry

/** Client 执行动作的明确结果。 */
export type ClipboardOperationResult =
  | { readonly status: 'copied' }
  | { readonly status: 'pasted' }
  | { readonly status: 'copy-only'; readonly reason: string }
  | { readonly status: 'unavailable'; readonly reason: string }

export interface SmartClipboardSettings {
  /** 活动历史条数上限。 */
  readonly historyLimit: number
  /** 历史数据总字节上限。 */
  readonly totalBytes: number
  /** 历史记录保留期限。 */
  readonly retention: Retention
  /** 是否暂停捕获。 */
  readonly paused: boolean
  /** 快捷键动作映射。 */
  readonly actionMapping: ActionMapping
  /** 不捕获的来源应用。 */
  readonly excludedApplications: readonly string[]
  /** 不捕获的内容类型。 */
  readonly excludedKinds: readonly ClipboardKind[]
}

/** 可由设置界面修改的设置子集；paused 由独立控制项管理。 */
export type SmartClipboardSettingsUpdate = Omit<SmartClipboardSettings, 'paused'>

export interface SmartClipboardClientApi {
  /** 查询活动历史。 */
  list(filter?: HistoryFilter): Promise<readonly ClipboardWireEntry[]>
  /** 查询废纸篓。 */
  trash(): Promise<readonly ClipboardWireEntry[]>
  /** 读取当前设置。 */
  settings(): Promise<SmartClipboardSettings>
  /** 读取捕获状态。 */
  status(): Promise<
    | { readonly state: 'recording' | 'paused' | 'storage-full' }
    | { readonly state: 'unavailable'; readonly reason: string }
  >
  /** 执行使用、复制或纯文本动作。 */
  execute(id: string, action: ClipboardAction, source?: 'history' | 'quick-panel'): Promise<ClipboardOperationResult>
  /** 设置固定状态。 */
  setPinned(id: string, pinned: boolean): Promise<ClipboardWireEntry | undefined>
  /** 将记录移入废纸篓。 */
  moveToTrash(id: string): Promise<ClipboardWireEntry | undefined>
  /** 从废纸篓恢复记录。 */
  restore(id: string): Promise<ClipboardWireEntry | undefined>
  /** 永久删除记录。 */
  permanentlyDelete(id: string): Promise<boolean>
  /** 清理活动历史中的非固定记录。 */
  clearHistory(): Promise<number>
  /** 清空废纸篓。 */
  emptyTrash(): Promise<number>
  /** 清空全部剪贴板数据。 */
  clearAllData(): Promise<number>
  /** 忽略下一次可记录的剪贴板变化。 */
  ignoreNext(): Promise<void>
  /** 暂停或恢复捕获。 */
  setPaused(paused: boolean): Promise<void>
  /** 更新可编辑设置。 */
  updateSettings(input: SmartClipboardSettingsUpdate): Promise<SmartClipboardSettings>
  /** 导出历史数据；返回目标路径或明确不可用原因。 */
  exportData(includeTrash: boolean): Promise<{ readonly status: 'exported'; readonly path: string } | { readonly status: 'unavailable'; readonly reason: string }>
  /** 更新 Quick Panel 的布局偏好。 */
  setQuickPanelLayout(input: { readonly rows: number; readonly previewOpen: boolean }): Promise<{ readonly placement: 'left' | 'right' }>
  /** 请求打开完整历史工作面。 */
  openHistory(): void
  /** 请求关闭 Quick Panel。 */
  closeQuickPanel(): void
  /** 订阅 Host 状态变化。 */
  observe(listener: () => void): () => void
}

/** 获取由 Host 注入的 Client API；缺失时表示插件能力不可用。 */
export function getSmartClipboardApi(): SmartClipboardClientApi | undefined {
  const host = globalThis as typeof globalThis & { readonly hermitSmartClipboard?: SmartClipboardClientApi }
  return host.hermitSmartClipboard
}

/** 将内部内容类型转换为用户可见标签。 */
export function kindLabel(kind: ClipboardKind): string {
  switch (kind) {
    case 'TEXT': return '文本'
    case 'IMAGE': return '图片'
    case 'FILE_LIST': return '文件'
  }
}
