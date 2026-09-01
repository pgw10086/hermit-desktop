/** 编辑器当前保存状态；failed 必须在界面上保留可处理结果。 */
export type SaveStatus = 'saved' | 'saving' | 'failed'
/** 文件工作区当前正在处理的交互操作，null 表示没有打开操作层。 */
export type Operation = 'import-confirm' | 'import-progress' | 'import-conflict' | 'import-result' | 'trash-restore-confirm' | 'trash-delete-confirm' | 'folder-create' | 'file-move' | null
/** 当前导航选择；文件夹和文件身份都使用 Canonical id，而不是路径。 */
export type Selection = { readonly kind: 'root' } | { readonly kind: 'folder'; readonly id: string } | { readonly kind: 'file'; readonly id: string } | { readonly kind: 'trash' }
/** 文件当前是否处于活动工作区或废纸篓。 */
export type FileState = 'active' | 'trashed'

export interface FolderRecord {
  /** 文件夹稳定身份，重命名不会改变。 */
  readonly id: string
  /** 面向用户展示的名称。 */
  readonly name: string
  /** 是否为不能按普通文件夹删除的固定目录。 */
  readonly fixed: boolean
  /** 创建时间。 */
  readonly createdAt: string
}
export interface FileSummary {
  /** 文件稳定身份。 */
  readonly id: string
  /** 文件当前名称。 */
  readonly name: string
  /** 当前所属文件夹身份。 */
  readonly folderId: string
  /** 文件扩展名，不含点号。 */
  readonly extension: string
  /** 文件媒体类型。 */
  readonly mediaType: string
  /** 当前内容字节数。 */
  readonly byteSize: number
  /** 文件创建时间。 */
  readonly createdAt: string
  /** 文件最近更新时间。 */
  readonly updatedAt: string
  /** 文件当前所在状态。 */
  readonly state: FileState
  /** 当前是否可以在编辑器中修改。 */
  readonly editable: boolean
}
export interface WorkspaceSnapshot {
  /** 当前全部文件夹。 */
  readonly folders: readonly FolderRecord[]
  /** 活动工作区文件。 */
  readonly files: readonly FileSummary[]
  /** 废纸篓文件。 */
  readonly trash: readonly FileSummary[]
  /** 最近打开的文件身份。 */
  readonly lastOpenFileId?: string
}
export interface FileReadResult {
  /** 读取时的文件摘要。 */
  readonly file: FileSummary
  /** 本次读取内容的 Revision 身份，保存时用于冲突检测。 */
  readonly revisionId: string
  /** 可编辑的文本内容。 */
  readonly content?: string
  /** 非 Canonical 的预览或搜索投影。 */
  readonly projection?: string
  /** 投影不可用时的明确原因。 */
  readonly projectionError?: 'unsupported' | 'parse failed'
}
export interface ImportFileInput {
  /** 导入文件名。 */
  readonly name: string
  /** 外部声明的媒体类型，Host 侧仍需校验。 */
  readonly mediaType: string
  /** 导入内容数据。 */
  readonly data: string
  /** 目标文件夹身份。 */
  readonly destinationFolderId: string
  /** 同名冲突时的处理方式。 */
  readonly mode: 'create' | 'replace' | 'skip'
}
/** Renderer 提交给 Host 的操作请求；所有变体都在 RPC 入口重新校验。 */
export type Request =
  | { readonly operation: 'snapshot' }
  | { readonly operation: 'read'; readonly fileId: string }
  | { readonly operation: 'create-note' }
  | { readonly operation: 'create-folder'; readonly name: string }
  | { readonly operation: 'delete-folder'; readonly folderId: string }
  | { readonly operation: 'move-file'; readonly fileId: string; readonly destinationFolderId: string }
  | { readonly operation: 'trash-file'; readonly fileId: string }
  | { readonly operation: 'restore-file'; readonly fileId: string }
  | { readonly operation: 'purge-file'; readonly fileId: string }
  | { readonly operation: 'purge-trash' }
  | { readonly operation: 'save-markdown'; readonly fileId: string; readonly expectedRevisionId: string; readonly content: string }
  | { readonly operation: 'import-file'; readonly input: ImportFileInput }
  | { readonly operation: 'set-last-open'; readonly fileId: string }

export interface Response {
  /** 请求完成后的工作区快照。 */
  readonly snapshot?: WorkspaceSnapshot
  /** 操作产生或更新的文件摘要。 */
  readonly file?: FileSummary
  /** 读取操作的完整结果。 */
  readonly read?: FileReadResult
  /** 兼容旧接口返回的文本内容。 */
  readonly content?: string
  /** 已完成的操作结果。 */
  readonly operation?: 'created' | 'replaced' | 'skipped' | 'moved' | 'trashed' | 'restored' | 'purged' | 'saved' | 'deleted'
  /** 保存成功后的新 Revision 身份。 */
  readonly revisionId?: string
  /** 创建文件夹后返回的名称。 */
  readonly name?: string
  /** 批量操作影响的记录数。 */
  readonly count?: number
}

export interface FileWorkspacePort {
  /** 获取最近一次 Host 投影的快照。 */
  readonly getSnapshot: () => WorkspaceSnapshot
  /** 订阅快照变化，并返回取消订阅函数。 */
  readonly subscribe: (listener: () => void) => () => void
  /** 提交一次经过类型约束的 Host 操作。 */
  request(request: Request): Promise<Response>
  /** 主动要求 Host 刷新快照。 */
  refresh(): Promise<void>
}
