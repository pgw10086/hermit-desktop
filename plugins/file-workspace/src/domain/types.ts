/** 文件当前是否仍在工作区中，还是已经进入废纸篓。 */
export type FileState = 'active' | 'trashed'

export interface FolderRecord {
  /** 文件夹的稳定身份，重命名不会改变。 */
  readonly id: string
  /** 面向用户展示的文件夹名称。 */
  readonly name: string
  /** 是否为系统维护的固定文件夹，固定文件夹不能按普通文件夹删除。 */
  readonly fixed: boolean
  /** 创建时间，使用 ISO 8601 字符串保存。 */
  readonly createdAt: string
}

export interface FileRecord {
  /** Canonical 文件身份，移动和重命名都不能替换它。 */
  readonly id: string
  /** 文件当前名称，不包含所属文件夹路径。 */
  readonly name: string
  /** 当前所属文件夹身份。 */
  readonly folderId: string
  /** 文件扩展名，不含点号；无扩展名时为空字符串。 */
  readonly extension: string
  /** 文件的媒体类型，用于读取和编辑能力判断。 */
  readonly mediaType: string
  /** 当前 revision 的字节数。 */
  readonly byteSize: number
  /** 首次创建时间，使用 ISO 8601 字符串保存。 */
  readonly createdAt: string
  /** 最近一次 Canonical 修改时间，使用 ISO 8601 字符串保存。 */
  readonly updatedAt: string
  /** 当前内容对应的 RevisionRecord 身份。 */
  readonly currentRevisionId: string
  /** 文件是否处于正常工作区或废纸篓状态。 */
  readonly state: FileState
  /** 进入废纸篓前的文件夹，用于恢复时找回原位置。 */
  readonly previousFolderId?: string | undefined
}

export interface ManagedBlobRecord {
  /** Blob 的稳定身份，供 revision 引用。 */
  readonly id: string
  /** 该 Blob 所属的 Canonical 文件身份。 */
  readonly fileId: string
  /** 经过存储层约定编码后的文件内容。 */
  readonly data: string
  /** data 的字节数，用于容量上限和清理计算。 */
  readonly byteSize: number
  /** Blob 创建时间，使用 ISO 8601 字符串保存。 */
  readonly createdAt: string
}

export interface RevisionRecord {
  /** Revision 的稳定身份。 */
  readonly id: string
  /** 该 Revision 所属的 Canonical 文件身份。 */
  readonly fileId: string
  /** 同一文件内单调递增的版本号，用于显示和冲突判断。 */
  readonly number: number
  /** 该版本引用的托管内容 Blob。 */
  readonly blobId: string
  /** Revision 创建时间，使用 ISO 8601 字符串保存。 */
  readonly createdAt: string
}

export interface OperationRecord {
  /** 导入、替换或清理操作的稳定身份，用于恢复未完成操作。 */
  readonly id: string
  /** 操作类型；不同类型拥有不同的清理和回滚语义。 */
  readonly kind: 'create' | 'replace' | 'purge'
  /** 操作作用的文件身份。 */
  readonly fileId: string
  /** 操作准备阶段创建或待清理的 Blob 身份。 */
  readonly blobId: string
  /** 操作准备阶段创建或待清理的 Revision 身份。 */
  readonly revisionId: string
  /** prepared 表示尚未完成提交，committed 表示 Canonical 状态已落盘。 */
  readonly stage: 'prepared' | 'committed'
  /** replace 操作提交前保存的旧文件快照，用于失败恢复。 */
  readonly previousFile?: FileRecord | undefined
  /** 提交后可清理的旧 Revision 列表。 */
  readonly cleanupRevisionIds?: readonly string[] | undefined
  /** 提交后可清理的旧 Blob 列表。 */
  readonly cleanupBlobIds?: readonly string[] | undefined
}

export interface FileWorkspaceGlobal {
  /** 域是否已经完成首次初始化。 */
  readonly initialized: boolean
  /** 最近一次打开的文件身份，刷新后用于恢复工作上下文。 */
  readonly lastOpenFileId?: string | undefined
}

export interface FileSummary {
  /** 文件的稳定身份。 */
  readonly id: string
  /** 文件当前名称。 */
  readonly name: string
  /** 文件所属文件夹身份。 */
  readonly folderId: string
  /** 文件扩展名，不含点号。 */
  readonly extension: string
  /** 文件媒体类型。 */
  readonly mediaType: string
  /** 当前内容的字节数。 */
  readonly byteSize: number
  /** 文件创建时间。 */
  readonly createdAt: string
  /** 文件最近更新时间。 */
  readonly updatedAt: string
  /** 文件是否在工作区或废纸篓。 */
  readonly state: FileState
  /** 当前宿主是否允许使用 Markdown 编辑器修改内容。 */
  readonly editable: boolean
}

export interface WorkspaceSnapshot {
  /** 当前可见的文件夹列表。 */
  readonly folders: readonly FolderRecord[]
  /** 工作区内的活动文件列表。 */
  readonly files: readonly FileSummary[]
  /** 废纸篓内的文件列表。 */
  readonly trash: readonly FileSummary[]
  /** 最近一次打开的文件身份。 */
  readonly lastOpenFileId?: string | undefined
}

export interface FileReadResult {
  /** 读取时对应的文件摘要；后续保存必须使用其中的 revision 身份。 */
  readonly file: FileSummary
  /** 本次读取内容对应的 Revision 身份。 */
  readonly revisionId: string
  /** 可直接编辑的文本内容；不支持文本投影时为空。 */
  readonly content?: string
  /** 面向预览或搜索的派生投影内容，不是 Canonical 原件。 */
  readonly projection?: string
  /** 投影生成失败的可观察原因。 */
  readonly projectionError?: 'unsupported' | 'parse failed'
}

export interface ImportFileInput {
  /** 导入文件名，不包含目标目录路径。 */
  readonly name: string
  /** 外部输入声明的媒体类型，Host 侧仍需重新校验。 */
  readonly mediaType: string
  /** 待导入内容的编码数据。 */
  readonly data: string
  /** 导入目标文件夹身份。 */
  readonly destinationFolderId: string
  /** 冲突时创建、替换或跳过的处理策略。 */
  readonly mode: 'create' | 'replace' | 'skip'
}

/** Renderer 与 Host 之间的文件工作区操作；字段会在 RPC 边界重新校验。 */
export type FileWorkspaceRpcRequest =
  | { readonly operation: 'snapshot' }
  | { readonly operation: 'read'; readonly fileId: string }
  | { readonly operation: 'create-note' }
  | { readonly operation: 'create-folder'; readonly name: string }
  | { readonly operation: 'move-file'; readonly fileId: string; readonly destinationFolderId: string }
  | { readonly operation: 'trash-file'; readonly fileId: string }
  | { readonly operation: 'restore-file'; readonly fileId: string }
  | { readonly operation: 'purge-file'; readonly fileId: string }
  | { readonly operation: 'save-markdown'; readonly fileId: string; readonly expectedRevisionId: string; readonly content: string }
  | { readonly operation: 'import-file'; readonly input: ImportFileInput }
  | { readonly operation: 'set-last-open'; readonly fileId: string }

export interface FileWorkspaceRpcResponse {
  /** 请求成功后的完整工作区快照。 */
  readonly snapshot?: WorkspaceSnapshot
  /** 创建、移动或恢复后返回的文件摘要。 */
  readonly file?: FileSummary
  /** 读取操作返回的内容和投影结果。 */
  readonly read?: FileReadResult
  /** 兼容旧读取路径返回的文本内容。 */
  readonly content?: string
  /** 已完成的业务操作类型。 */
  readonly operation?: 'created' | 'replaced' | 'skipped' | 'moved' | 'trashed' | 'restored' | 'purged' | 'saved' | 'deleted'
  /** 批量清理或删除实际影响的记录数。 */
  readonly count?: number
  /** 保存成功后产生的新 Revision 身份。 */
  readonly revisionId?: string
  /** 创建文件夹或重命名后返回的名称。 */
  readonly name?: string
}
