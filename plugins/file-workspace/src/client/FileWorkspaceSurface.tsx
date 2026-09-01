import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react'
import { Button, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { FileEditor } from './FileEditor.js'
import { FileTree } from './FileTree.js'
import type { FileReadResult, FileSummary, FileWorkspacePort, FolderRecord, SaveStatus, Selection, WorkspaceSnapshot } from './contracts.js'
import css from './FileWorkspace.module.css'

interface Candidate {
  /** 本次导入候选的临时身份。 */
  readonly id: string
  /** 外部文件名。 */
  readonly name: string
  /** 外部媒体类型。 */
  readonly mediaType: string
  /** 已读取的导入数据。 */
  readonly data: string
  /** 导入数据字节数。 */
  readonly byteSize: number
}

interface ImportRun {
  /** 本次导入的全部候选文件。 */
  readonly candidates: readonly Candidate[]
  /** 目标文件夹身份。 */
  readonly destinationFolderId: string
  /** 当前处理下标。 */
  index: number
  /** 是否对后续冲突全部跳过。 */
  skipAll: boolean
  /** 是否已请求取消剩余任务。 */
  cancelled: boolean
  /** 已成功写入的数量。 */
  completed: number
  /** 已跳过的数量。 */
  skipped: number
  /** 失败候选及可展示原因。 */
  failed: Array<{ readonly id: string; readonly name: string; readonly message: string }>
  /** 已成功写入的 Canonical 文件身份。 */
  completedIds: string[]
}

type ImportState =
  | { readonly phase: 'confirm'; readonly candidates: readonly Candidate[]; readonly destinationFolderId: string; readonly checking: boolean }
  | { readonly phase: 'progress'; readonly run: ImportRun }
  | { readonly phase: 'conflict'; readonly run: ImportRun; readonly candidate: Candidate; readonly index: number }
  | { readonly phase: 'result'; readonly run: ImportRun }

type ModalState =
  | { readonly kind: 'folder' }
  | { readonly kind: 'delete-folder'; readonly folderId: string }
  | { readonly kind: 'move'; readonly fileId: string }
  | { readonly kind: 'restore'; readonly fileId: string }
  | { readonly kind: 'purge'; readonly fileId: string }
  | { readonly kind: 'purge-trash' }
  | null

export interface FileWorkspaceSurfaceProps {
  /** Host 提供的文件工作区端口。 */
  readonly port: FileWorkspacePort
  /** 关闭 Product Surface。 */
  readonly onClose: () => void
}

/** 文件工作区 Product Surface；统一拥有选择、导入、编辑和模态流程状态。 */
export function FileWorkspaceSurface({ port, onClose }: FileWorkspaceSurfaceProps): ReactNode {
  const snapshot = useExternalSnapshot(port)
  const [selection, setSelection] = useState<Selection>({ kind: 'root' })
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ root: true, 'quick-notes': true })
  const [query, setQuery] = useState('')
  const [read, setRead] = useState<FileReadResult | undefined>()
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [compact, setCompact] = useState(false)
  const [treeVisible, setTreeVisible] = useState(true)
  const [modal, setModal] = useState<ModalState>(null)
  const [importState, setImportState] = useState<ImportState | undefined>()
  const [dragTarget, setDragTarget] = useState<string | 'trash' | null>(null)
  const [toast, setToast] = useState<string | undefined>()
  const [highlightIds, setHighlightIds] = useState<ReadonlySet<string>>(new Set())
  const workspaceRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const readToken = useRef(0)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>()
  const importRun = useRef<ImportRun | undefined>()
  const restoredLastOpen = useRef<string | undefined>()

  const activeSnapshot = useMemo(() => filterSnapshot(snapshot, query), [snapshot, query])
  const selectedFile = selection.kind === 'file' ? findFile(snapshot, selection.id) : undefined

  useEffect(() => {
    void port.refresh().catch((error: unknown) => setToast(errorMessage(error)))
  }, [port])

  useEffect(() => {
    if (importState?.phase !== 'confirm' || !importState.checking) return
    const timer = setTimeout(() => setImportState((current) => current?.phase === 'confirm' && current.checking ? { ...current, checking: false } : current), 120)
    return () => clearTimeout(timer)
  }, [importState])

  useEffect(() => {
    const element = workspaceRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === 0) return
      const nextCompact = entry.contentRect.width <= 560
      setCompact(nextCompact)
      if (!nextCompact) setTreeVisible(true)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const last = snapshot.lastOpenFileId === undefined ? undefined : findFile(snapshot, snapshot.lastOpenFileId)
    if (last !== undefined && restoredLastOpen.current !== last.id) {
      restoredLastOpen.current = last.id
      setSelection({ kind: 'file', id: last.id })
      void openFile(last.id)
      return
    }
    if (selection.kind === 'file' && findFile(snapshot, selection.id) === undefined) {
      setSelection({ kind: 'root' })
      setRead(undefined)
    }
  // The initial last-open selection is intentionally derived from the domain snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.lastOpenFileId, snapshot.files.length])

  useEffect(() => () => {
    if (saveTimer.current !== undefined) clearTimeout(saveTimer.current)
  }, [])

  const showToast = useCallback((message: string) => {
    setToast(message)
  }, [])

  const openFile = useCallback(async (fileId: string): Promise<void> => {
    const token = ++readToken.current
    setSelection({ kind: 'file', id: fileId })
    if (compact) setTreeVisible(false)
    try {
      const response = await port.request({ operation: 'read', fileId })
      if (token !== readToken.current || response.read === undefined) return
      setRead(response.read)
      setSaveStatus('saved')
      await port.request({ operation: 'set-last-open', fileId })
    } catch (error) {
      if (token === readToken.current) showToast(errorMessage(error))
    }
  }, [compact, port, showToast])

  const selectFolder = (folderId: string): void => {
    readToken.current += 1
    setSelection({ kind: 'folder', id: folderId })
    setExpanded((current) => ({ ...current, [folderId]: !(current[folderId] ?? true) }))
  }

  const createNote = async (): Promise<void> => {
    try {
      const response = await port.request({ operation: 'create-note' })
      await port.refresh()
      if (response.file !== undefined) await openFile(response.file.id)
    } catch (error) { showToast(errorMessage(error)) }
  }

  const createFolder = async (): Promise<void> => {
    setModal({ kind: 'folder' })
  }

  const deleteFolder = (folderId: string): void => { setModal({ kind: 'delete-folder', folderId }) }

  const submitFolder = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '')
    try {
      await port.request({ operation: 'create-folder', name })
      await port.refresh()
      setModal(null)
    } catch (error) { showToast(errorMessage(error)) }
  }

  const currentFolderId = (): string => {
    if (selection.kind === 'folder') return selection.id
    if (selection.kind === 'file') return findFile(snapshot, selection.id)?.folderId ?? 'root'
    return 'root'
  }

  const addFiles = async (files: FileList | readonly File[], destinationFolderId = currentFolderId()): Promise<void> => {
    const candidates: Candidate[] = []
    for (const file of Array.from(files)) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        let binary = ''
        for (const byte of bytes) binary += String.fromCharCode(byte)
        candidates.push({ id: crypto.randomUUID(), name: file.name, mediaType: file.type || 'application/octet-stream', data: btoa(binary), byteSize: bytes.byteLength })
      } catch (error) {
        showToast(`${file.name}: ${errorMessage(error)}`)
      }
    }
    if (candidates.length > 0) setImportState({ phase: 'confirm', candidates, destinationFolderId, checking: true })
  }

  const onInputChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    // React 事件在 await 后不再保证 currentTarget 仍指向输入框，先保存真实引用。
    const input = event.currentTarget
    const files = input.files
    if (files !== null) await addFiles(files)
    input.value = ''
  }

  const onDropFiles = async (event: DragEvent<HTMLElement>, destination: string | 'trash'): Promise<void> => {
    event.preventDefault()
    setDragTarget(null)
    if (destination === 'trash' || event.dataTransfer.files.length === 0) return
    await addFiles(event.dataTransfer.files, destination)
  }

  const beginImport = (): void => {
    if (importState?.phase !== 'confirm') return
    const run: ImportRun = { candidates: importState.candidates, destinationFolderId: importState.destinationFolderId, index: 0, skipAll: false, cancelled: false, completed: 0, skipped: 0, failed: [], completedIds: [] }
    importRun.current = run
    setImportState({ phase: 'progress', run })
    void processImport(run)
  }

  const processImport = async (run: ImportRun, forcedMode?: 'replace' | 'skip'): Promise<void> => {
    if (run.cancelled || run.index >= run.candidates.length) {
      setImportState({ phase: 'result', run })
      await port.refresh()
      setHighlightIds(new Set(run.completedIds))
      setExpanded((current) => ({ ...current, [run.destinationFolderId]: true }))
      return
    }
    const candidate = run.candidates[run.index]
    const existing = port.getSnapshot().files.find((file) => file.folderId === run.destinationFolderId && file.name === candidate.name)
    if (existing !== undefined && !run.skipAll && forcedMode === undefined) {
      setImportState({ phase: 'conflict', run, candidate, index: run.index })
      return
    }
    const mode = forcedMode ?? (existing === undefined ? 'create' : 'skip')
    try {
      const response = await port.request({ operation: 'import-file', input: { name: candidate.name, mediaType: candidate.mediaType, data: candidate.data, destinationFolderId: run.destinationFolderId, mode } })
      await port.refresh()
      if (response.operation === 'skipped') run.skipped += 1
      else {
        run.completed += 1
        if (response.file !== undefined) run.completedIds.push(response.file.id)
      }
    } catch (error) {
      run.failed.push({ id: candidate.id, name: candidate.name, message: errorMessage(error) })
    }
    run.index += 1
    setImportState({ phase: 'progress', run })
    await processImport(run)
  }

  const resolveConflict = (mode: 'replace' | 'skip' | 'all-skip'): void => {
    const state = importState
    const run = importRun.current
    if (state?.phase !== 'conflict' || run === undefined) return
    if (mode === 'all-skip') run.skipAll = true
    void processImport(run, mode === 'all-skip' ? 'skip' : mode)
  }

  const cancelImport = (): void => {
    const run = importRun.current
    if (run === undefined) return
    run.cancelled = true
    setImportState({ phase: 'progress', run })
  }

  const retryFailed = (): void => {
    const run = importRun.current
    if (run === undefined || run.failed.length === 0) return
    const failedIds = new Set(run.failed.map((item) => item.id))
    const retryRun: ImportRun = { candidates: run.candidates.filter((candidate) => failedIds.has(candidate.id)), destinationFolderId: run.destinationFolderId, index: 0, skipAll: false, cancelled: false, completed: 0, skipped: 0, failed: [], completedIds: [] }
    importRun.current = retryRun
    setImportState({ phase: 'progress', run: retryRun })
    void processImport(retryRun)
  }

  const moveFile = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (modal?.kind !== 'move') return
    const form = new FormData(event.currentTarget)
    try {
      await port.request({ operation: 'move-file', fileId: modal.fileId, destinationFolderId: String(form.get('destination') ?? 'root') })
      await port.refresh()
      setModal(null)
      await openFile(modal.fileId)
    } catch (error) { showToast(errorMessage(error)) }
  }

  const trashFile = async (): Promise<void> => {
    if (selectedFile === undefined) return
    try {
      await port.request({ operation: 'trash-file', fileId: selectedFile.id })
      await port.refresh()
      setRead(undefined)
      setSelection({ kind: 'root' })
    } catch (error) { showToast(errorMessage(error)) }
  }

  const restoreFile = async (): Promise<void> => {
    if (modal?.kind !== 'restore') return
    try {
      await port.request({ operation: 'restore-file', fileId: modal.fileId })
      await port.refresh()
      setModal(null)
    } catch (error) { showToast(errorMessage(error)) }
  }

  const purgeFile = async (): Promise<void> => {
    if (modal?.kind !== 'purge') return
    try {
      await port.request({ operation: 'purge-file', fileId: modal.fileId })
      await port.refresh()
      setModal(null)
    } catch (error) { showToast(errorMessage(error)) }
  }

  const purgeTrash = async (): Promise<void> => {
    if (modal?.kind !== 'purge-trash') return
    try {
      await port.request({ operation: 'purge-trash' })
      await port.refresh()
      setModal(null)
    } catch (error) { showToast(errorMessage(error)) }
  }

  const submitDeleteFolder = async (): Promise<void> => {
    if (modal?.kind !== 'delete-folder') return
    try {
      await port.request({ operation: 'delete-folder', folderId: modal.folderId })
      await port.refresh()
      setModal(null)
    } catch (error) { showToast(errorMessage(error)) }
  }

  const changeContent = (content: string): void => {
    if (read === undefined || selectedFile === undefined || !selectedFile.editable) return
    setRead({ ...read, content, projection: content })
    setSaveStatus('saving')
    const saveToken = readToken.current
    const fileId = selectedFile.id
    const expectedRevisionId = read.revisionId
    if (saveTimer.current !== undefined) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const response = await port.request({ operation: 'save-markdown', fileId, expectedRevisionId, content })
          await port.refresh()
          if (readToken.current !== saveToken) return
          if (response.file !== undefined && response.revisionId !== undefined) setRead({ file: response.file, revisionId: response.revisionId, content, projection: content })
          setSaveStatus('saved')
        } catch (error) {
          if (readToken.current !== saveToken) return
          setSaveStatus('failed')
          showToast(errorMessage(error))
        }
      })()
    }, 420)
  }

  const readAgain = (): void => { if (selectedFile !== undefined) void openFile(selectedFile.id) }
  const projection = (): void => showToast('当前版本尚未接入 Core 安全 projection，文件未插入对话')

  return <div ref={workspaceRef} className={css.root} data-file-workspace-surface="ready">
    <div className={css.body}>
      {(!compact || treeVisible) && <FileTree
        snapshot={activeSnapshot}
        selection={selection}
        expanded={expanded}
        query={query}
        dragTarget={dragTarget}
        highlightIds={highlightIds}
        onQueryChange={setQuery}
        onCreateNote={() => { void createNote() }}
        onAdd={() => inputRef.current?.click()}
        onCreateFolder={() => { void createFolder() }}
        onDeleteFolder={deleteFolder}
        onCollapseAll={() => setExpanded({ root: false, 'quick-notes': false, trash: false })}
        onSelectFolder={selectFolder}
        onSelectFile={(id) => { void openFile(id) }}
        onToggleTrash={() => { setSelection({ kind: 'trash' }); setExpanded((current) => ({ ...current, trash: !(current.trash ?? false) })) }}
        onRestore={(id) => setModal({ kind: 'restore', fileId: id })}
        onPurge={(id) => setModal({ kind: 'purge', fileId: id })}
        onPurgeTrash={() => setModal({ kind: 'purge-trash' })}
        onDragTarget={setDragTarget}
        onDropFiles={onDropFiles}
      />}
      {(!compact || !treeVisible) && <FileEditor
        file={selectedFile}
        read={read}
        saveStatus={saveStatus}
        compact={compact}
        onCollapseTree={() => setTreeVisible(false)}
        onShowTree={() => setTreeVisible(true)}
        onChange={changeContent}
        onRetry={readAgain}
        projectionAvailable={false}
        onProjection={projection}
        onMove={() => { if (selectedFile !== undefined) setModal({ kind: 'move', fileId: selectedFile.id }) }}
        onTrash={() => { void trashFile() }}
      />}
    </div>
    <input ref={inputRef} type="file" multiple hidden onChange={(event) => { void onInputChange(event) }} />
    {importState?.phase === 'confirm' && <ImportConfirm state={importState} snapshot={snapshot} onChangeDestination={(destinationFolderId) => setImportState({ ...importState, destinationFolderId })} onCancel={() => setImportState(undefined)} onStart={beginImport} />}
    {importState?.phase === 'progress' && <ImportProgress run={importState.run} onCancel={cancelImport} />}
    {importState?.phase === 'conflict' && <ConflictModal state={importState} onReplace={() => resolveConflict('replace')} onSkip={() => resolveConflict('skip')} onAllSkip={() => resolveConflict('all-skip')} />}
    {importState?.phase === 'result' && <ImportResult run={importState.run} onClose={() => setImportState(undefined)} onRetry={retryFailed} />}
    {modal?.kind === 'folder' && <Modal open title="新建文件夹" closeLabel="关闭" onClose={() => setModal(null)} footer={<><Button type="button" variant="ghost" size="md" onClick={() => setModal(null)}>取消</Button><Button form="folder-form" type="submit" variant="primary" size="md">创建</Button></>}><form id="folder-form" className={css.modalBody} onSubmit={(event) => { void submitFolder(event) }}><div className={css.modalField}><label htmlFor="folder-name">文件夹名称</label><input id="folder-name" name="name" autoFocus /></div></form></Modal>}
    {modal?.kind === 'delete-folder' && <Modal open title="删除空文件夹？" closeLabel="关闭" onClose={() => setModal(null)} description="文件夹本身不会进入废纸篓，只能删除空的普通文件夹。" footer={<><Button type="button" variant="ghost" size="md" onClick={() => setModal(null)}>取消</Button><Button type="button" variant="primary" size="md" onClick={() => { void submitDeleteFolder() }}>删除</Button></>}><p>{folderName(snapshot.folders, modal.folderId)}</p></Modal>}
    {modal?.kind === 'move' && <MoveModal file={findFile(snapshot, modal.fileId)} folders={snapshot.folders} onClose={() => setModal(null)} onSubmit={(event) => { void moveFile(event) }} />}
    {modal?.kind === 'restore' && <RestoreModal file={findFile(snapshot, modal.fileId)} folders={snapshot.folders} onClose={() => setModal(null)} onSubmit={() => { void restoreFile() }} />}
    {modal?.kind === 'purge' && <Modal open title="永久删除文件？" closeLabel="关闭" onClose={() => setModal(null)} description="删除后无法恢复，Hermit 保存的文件内容和 revision 也会被删除。" footer={<><Button type="button" variant="ghost" size="md" onClick={() => setModal(null)}>取消</Button><Button type="button" variant="primary" size="md" onClick={() => { void purgeFile() }}>永久删除</Button></>}><p>{findFile(snapshot, modal.fileId)?.name ?? '此文件'}</p></Modal>}
    {modal?.kind === 'purge-trash' && <Modal open title="清空废纸篓？" closeLabel="关闭" onClose={() => setModal(null)} description="清空后，废纸篓中的 managed 文件和所有 revision 都无法恢复。" footer={<><Button type="button" variant="ghost" size="md" onClick={() => setModal(null)}>取消</Button><Button type="button" variant="primary" size="md" onClick={() => { void purgeTrash() }}>清空废纸篓</Button></>}><p>共 {snapshot.trash.length} 个文件</p></Modal>}
    <input type="button" hidden onClick={onClose} aria-label="关闭文件工作区" />
    {highlightIds.size > 0 && <Button className={css.toast} type="button" variant="ghost" size="sm" onClick={() => setHighlightIds(new Set())}>已完成添加 {highlightIds.size} 个文件</Button>}
    {toast !== undefined && <Toast text={toast} onDone={() => setToast(undefined)} />}
  </div>
}

/** 将端口快照订阅接入 React 渲染生命周期。 */
function useExternalSnapshot(port: FileWorkspacePort): WorkspaceSnapshot {
  const [, rerender] = useState(0)
  useEffect(() => port.subscribe(() => rerender((value) => value + 1)), [port])
  return port.getSnapshot()
}

/** 按文件夹或文件名筛选快照，同时保留可导航的父文件夹。 */
function filterSnapshot(snapshot: WorkspaceSnapshot, query: string): WorkspaceSnapshot {
  const needle = query.trim().toLocaleLowerCase()
  if (needle.length === 0) return snapshot
  const folderIds = new Set(snapshot.folders.filter((folder) => folder.name.toLocaleLowerCase().includes(needle)).map((folder) => folder.id))
  for (const file of snapshot.files) if (file.name.toLocaleLowerCase().includes(needle)) folderIds.add(file.folderId)
  return { folders: snapshot.folders.filter((folder) => folderIds.has(folder.id)), files: snapshot.files.filter((file) => folderIds.has(file.folderId) || file.name.toLocaleLowerCase().includes(needle)), trash: snapshot.trash.filter((file) => file.name.toLocaleLowerCase().includes(needle)), ...(snapshot.lastOpenFileId === undefined ? {} : { lastOpenFileId: snapshot.lastOpenFileId }) }
}

/** 在活动区和废纸篓中按稳定身份查找文件。 */
function findFile(snapshot: WorkspaceSnapshot, id: string): FileSummary | undefined { return [...snapshot.files, ...snapshot.trash].find((file) => file.id === id) }
/** 将未知文件工作区异常转换为用户可展示消息。 */
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : '文件工作区操作失败' }
/** 按文件夹身份查找展示名称。 */
function folderName(folders: readonly FolderRecord[], id: string): string { return folders.find((folder) => folder.id === id)?.name ?? '根目录' }

function ImportConfirm({ state, snapshot, onChangeDestination, onCancel, onStart }: { readonly state: Extract<ImportState, { phase: 'confirm' }>; readonly snapshot: WorkspaceSnapshot; readonly onChangeDestination: (id: string) => void; readonly onCancel: () => void; readonly onStart: () => void }): ReactNode {
  const conflicts = state.candidates.filter((candidate) => snapshot.files.some((file) => file.folderId === state.destinationFolderId && file.name === candidate.name)).length
  return <Modal open title="添加文件" closeLabel="关闭" onClose={onCancel} description={`将复制 ${state.candidates.length} 个文件到 Hermit。`} footer={<><Button type="button" variant="ghost" size="md" onClick={onCancel}>取消</Button><Button type="button" variant="primary" size="md" disabled={state.checking} onClick={onStart}>{state.checking ? '正在检查…' : '开始添加'}</Button></>}><div className={css.modalBody}><div className={css.modalField}><label htmlFor="import-destination">保存到</label><select id="import-destination" value={state.destinationFolderId} onChange={(event) => onChangeDestination(event.currentTarget.value)} disabled={state.checking}>{snapshot.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></div><p>{state.checking ? '正在检查文件可读性、目标位置和同名冲突…' : `检查完成：${conflicts > 0 ? `发现 ${conflicts} 个同名文件，添加时逐个确认。` : '未发现同名冲突。'}`}</p><ul className={css.modalList}>{state.candidates.map((candidate) => <li key={candidate.id}>{candidate.name} <small>{formatBytes(candidate.byteSize)}</small></li>)}</ul></div></Modal>
}

function ImportProgress({ run, onCancel }: { readonly run: ImportRun; readonly onCancel: () => void }): ReactNode {
  const done = run.completed + run.skipped + run.failed.length
  return <Modal open title="正在添加文件" closeLabel="关闭" onClose={() => undefined} description={`已完成 ${done} / ${run.candidates.length}`} footer={<Button type="button" variant="ghost" size="md" onClick={onCancel}>{run.cancelled ? '正在停止…' : '取消剩余文件'}</Button>}><div className={css.modalProgress}><div className={css.progressTrack}><div className={css.progressValue} style={{ width: `${run.candidates.length === 0 ? 0 : (done / run.candidates.length) * 100}%` }} /></div><p>{run.cancelled ? '正在整理已完成结果' : run.candidates[run.index]?.name ?? '正在完成'}</p></div></Modal>
}

function ConflictModal({ state, onReplace, onSkip, onAllSkip }: { readonly state: Extract<ImportState, { phase: 'conflict' }>; readonly onReplace: () => void; readonly onSkip: () => void; readonly onAllSkip: () => void }): ReactNode {
  return <Modal open title="发现同名文件" closeLabel="关闭" onClose={() => undefined} description={`“${state.candidate.name}”已经存在，是否替换 Hermit 中的现有文件？`} footer={<><Button type="button" variant="ghost" size="md" onClick={onAllSkip}>全部跳过</Button><Button type="button" variant="ghost" size="md" onClick={onSkip}>跳过</Button><Button type="button" variant="primary" size="md" onClick={onReplace}>替换</Button></>}><p>替换会在现有 FileRecord 上写入一个新的 revision，不会删除后重建。</p></Modal>
}

function ImportResult({ run, onClose, onRetry }: { readonly run: ImportRun; readonly onClose: () => void; readonly onRetry: () => void }): ReactNode {
  const unprocessed = run.candidates.length - run.completed - run.skipped - run.failed.length
  return <Modal open title="添加结果" closeLabel="关闭" onClose={onClose} footer={<><Button type="button" variant="ghost" size="md" disabled={run.failed.length === 0} onClick={onRetry}>重试失败</Button><Button type="button" variant="primary" size="md" onClick={onClose}>完成</Button></>}><div className={css.resultSummary}><div className={css.resultMetric}><strong>{run.completed}</strong><span>已完成</span></div><div className={css.resultMetric}><strong>{run.skipped}</strong><span>已跳过</span></div><div className={css.resultMetric}><strong>{run.failed.length}</strong><span>失败</span></div><div className={css.resultMetric}><strong>{unprocessed}</strong><span>未处理</span></div></div>{run.failed.length > 0 && <ul className={css.errorList}>{run.failed.map((item) => <li key={item.id}>{item.name}：{item.message}</li>)}</ul>}</Modal>
}

function MoveModal({ file, folders, onClose, onSubmit }: { readonly file: FileSummary | undefined; readonly folders: readonly FolderRecord[]; readonly onClose: () => void; readonly onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }): ReactNode {
  return <Modal open title="移动文件" closeLabel="关闭" onClose={onClose} footer={<><Button type="button" variant="ghost" size="md" onClick={onClose}>取消</Button><Button form="move-form" type="submit" variant="primary" size="md">移动</Button></>}><form id="move-form" className={css.modalBody} onSubmit={onSubmit}><p>{file?.name ?? '文件'}</p><div className={css.modalField}><label htmlFor="move-destination">移动到</label><select id="move-destination" name="destination" defaultValue={file?.folderId ?? 'root'}>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></div></form></Modal>
}

function RestoreModal({ file, folders, onClose, onSubmit }: { readonly file: FileSummary | undefined; readonly folders: readonly FolderRecord[]; readonly onClose: () => void; readonly onSubmit: () => void }): ReactNode {
  const destination = file === undefined ? '根目录' : folderName(folders, file.folderId)
  return <Modal open title="恢复文件" closeLabel="关闭" onClose={onClose} description={`将恢复到：${destination}。如果存在同名文件，系统会自动追加“（已恢复）”。`} footer={<><Button type="button" variant="ghost" size="md" onClick={onClose}>取消</Button><Button type="button" variant="primary" size="md" onClick={onSubmit}>恢复</Button></>}><p>{file?.name ?? '此文件'}</p></Modal>
}

function formatBytes(size: number): string { return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB` }
