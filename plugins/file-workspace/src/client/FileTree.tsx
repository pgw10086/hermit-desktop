import { useState, type DragEvent, type ReactNode } from 'react'
import {
  Button,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconEllipsisOutline16,
  IconFolderClose16,
  IconFolderOpen16,
  IconListPenOutline16,
  IconPaperclipOutline16,
  IconPlusOutline16,
  IconSearchOutline16,
  IconTrashOutline16,
  Input,
  Menu,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FileSummary, FolderRecord, Selection } from './contracts.js'
import css from './FileWorkspace.module.css'

interface FileTreeProps {
  /** Host 当前投影的文件夹、活动文件和废纸篓。 */
  readonly snapshot: { readonly folders: readonly FolderRecord[]; readonly files: readonly FileSummary[]; readonly trash: readonly FileSummary[] }
  /** 当前导航选择。 */
  readonly selection: Selection
  /** 各文件夹及废纸篓的展开状态。 */
  readonly expanded: Readonly<Record<string, boolean>>
  /** 当前文件名搜索词。 */
  readonly query: string
  /** 当前拖放目标身份。 */
  readonly dragTarget: string | 'trash' | null
  /** 导入完成后需要高亮的文件身份。 */
  readonly highlightIds: ReadonlySet<string>
  /** 更新搜索词。 */
  readonly onQueryChange: (query: string) => void
  /** 创建快速记事。 */
  readonly onCreateNote: () => void
  /** 打开系统文件选择器。 */
  readonly onAdd: () => void
  /** 打开新建文件夹流程。 */
  readonly onCreateFolder: () => void
  /** 请求删除空文件夹。 */
  readonly onDeleteFolder: (id: string) => void
  /** 折叠全部文件夹。 */
  readonly onCollapseAll: () => void
  /** 选择文件夹。 */
  readonly onSelectFolder: (id: string) => void
  /** 选择文件并打开编辑器。 */
  readonly onSelectFile: (id: string) => void
  /** 切换废纸篓展开状态。 */
  readonly onToggleTrash: () => void
  /** 恢复废纸篓文件。 */
  readonly onRestore: (id: string) => void
  /** 永久删除单个废纸篓文件。 */
  readonly onPurge: (id: string) => void
  /** 清空废纸篓。 */
  readonly onPurgeTrash: () => void
  /** 更新拖放目标。 */
  readonly onDragTarget: (target: string | 'trash' | null) => void
  /** 接收文件拖放并提交导入。 */
  readonly onDropFiles: (event: DragEvent<HTMLElement>, destination: string | 'trash') => void
}

const treeMenu: readonly MenuEntry[] = [{ id: 'new-folder', label: '新建文件夹' }, { id: 'collapse', label: '折叠全部文件夹' }]

/** 文件夹、文件和废纸篓导航树；不拥有文件的 Canonical 状态。 */
export function FileTree(props: FileTreeProps): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false)
  const { snapshot } = props
  const rootFiles = visibleFiles(snapshot.files, 'root', props.query)
  const folders = snapshot.folders.filter((folder) => folder.id !== 'root' && matchesFolder(folder, props.query))
  const hasQuery = props.query.trim().length > 0
  return (
    <aside className={css.tree} aria-label="文件树">
      <header className={css.treeHeader}>
        <Input
          className={css.search}
          icon={<IconSearchOutline16 size={16} />}
          value={props.query}
          aria-label="搜索文件名"
          placeholder="搜索文件名"
          onChange={(event) => props.onQueryChange(event.currentTarget.value)}
        />
        <div className={css.treeActions}>
          <Button type="button" variant="toolbar" size="sm" icon={<IconPlusOutline16 size={16} />} aria-label="新建快速记事" title="新建快速记事" onClick={props.onCreateNote} />
          <Button type="button" variant="toolbar" size="sm" icon={<IconPaperclipOutline16 size={16} />} aria-label="添加文件" title="添加文件" onClick={props.onAdd} />
          <Menu
            open={menuOpen}
            anchor={<Button type="button" variant="toolbar" size="sm" icon={<IconEllipsisOutline16 size={16} />} aria-label="文件树更多操作" title="更多" onClick={() => setMenuOpen((open) => !open)} />}
            items={treeMenu}
            onSelect={(id) => { setMenuOpen(false); if (id === 'new-folder') props.onCreateFolder(); else if (id === 'collapse') props.onCollapseAll() }}
            onClose={() => setMenuOpen(false)}
            portal
          />
        </div>
      </header>
      <div
        className={`${css.treeScroll} ${props.dragTarget === 'root' ? css.dropTarget : ''}`}
        onDragOver={(event) => { event.preventDefault(); props.onDragTarget('root') }}
        onDragLeave={() => props.onDragTarget(null)}
        onDrop={(event) => props.onDropFiles(event, 'root')}
      >
        <FolderRow
          folder={{ id: 'root', name: '根目录', fixed: true, createdAt: '' }}
          open={props.expanded.root ?? true}
          selected={props.selection.kind === 'root'}
          hasQuery={hasQuery}
          dragTarget={props.dragTarget}
          onClick={() => props.onSelectFolder('root')}
          onDrop={props.onDropFiles}
          onDragTarget={props.onDragTarget}
        >
          {rootFiles.map((file) => <FileRow key={file.id} file={file} highlighted={props.highlightIds.has(file.id)} selected={props.selection.kind === 'file' && props.selection.id === file.id} onClick={() => props.onSelectFile(file.id)} onDragTarget={props.onDragTarget} onDropFiles={props.onDropFiles} />)}
        </FolderRow>
        {folders.map((folder) => (
          <FolderRow
            key={folder.id}
            folder={folder}
            open={props.expanded[folder.id] ?? true}
            selected={props.selection.kind === 'folder' && props.selection.id === folder.id}
            hasQuery={hasQuery}
            dragTarget={props.dragTarget}
            onClick={() => props.onSelectFolder(folder.id)}
            onDelete={() => props.onDeleteFolder(folder.id)}
            onDrop={props.onDropFiles}
            onDragTarget={props.onDragTarget}
          >
            {visibleFiles(snapshot.files, folder.id, props.query).map((file) => <FileRow key={file.id} file={file} highlighted={props.highlightIds.has(file.id)} selected={props.selection.kind === 'file' && props.selection.id === file.id} onClick={() => props.onSelectFile(file.id)} onDragTarget={props.onDragTarget} onDropFiles={props.onDropFiles} />)}
          </FolderRow>
        ))}
        <div className={css.trashBlock}>
          <Button
            type="button"
            variant="ghost"
            size="md"
            className={`${css.treeRow} ${props.selection.kind === 'trash' ? css.selected : ''}`}
            icon={<IconTrashOutline16 size={16} />}
            aria-expanded={props.expanded.trash ?? false}
            onClick={props.onToggleTrash}
          >
            <span>废纸篓</span><small>{snapshot.trash.length || ''}</small>
          </Button>
          {snapshot.trash.length > 0 && <Button type="button" variant="toolbar" size="sm" aria-label="清空废纸篓" title="清空废纸篓" onClick={props.onPurgeTrash}><IconTrashOutline16 size={14} /></Button>}
          {props.expanded.trash && <div className={css.trashChildren}>
            {snapshot.trash.length === 0 && <p>废纸篓为空</p>}
            {snapshot.trash.map((file) => <div className={css.trashItem} key={file.id}><strong title={file.name}>{file.name}</strong><Button type="button" variant="ghost" size="sm" onClick={() => props.onRestore(file.id)}>恢复</Button><Button type="button" variant="toolbar" size="sm" aria-label={`永久删除 ${file.name}`} title="永久删除" onClick={() => props.onPurge(file.id)}><IconTrashOutline16 size={14} /></Button></div>)}
          </div>}
        </div>
      </div>
    </aside>
  )
}

/** 可展开并接收拖放的文件夹行。 */
function FolderRow(props: {
  readonly folder: FolderRecord
  readonly open: boolean
  readonly selected: boolean
  readonly hasQuery: boolean
  readonly dragTarget: string | 'trash' | null
  readonly onClick: () => void
  readonly onDrop: (event: DragEvent<HTMLElement>, destination: string | 'trash') => void
  readonly onDragTarget: (target: string | 'trash' | null) => void
  readonly onDelete?: () => void
  readonly children: ReactNode
}): ReactNode {
  const icon = props.open ? <IconFolderOpen16 size={16} /> : <IconFolderClose16 size={16} />
  return <div className={css.folder}><div className={css.folderHeader}><Button type="button" variant="ghost" size="md" className={`${css.treeRow} ${css.folderRow} ${props.selected ? css.contextSelected : ''} ${props.dragTarget === props.folder.id ? css.dropTarget : ''}`} icon={props.open ? <IconChevronDownOutline14 size={14} /> : <IconChevronRightOutline14 size={14} />} onClick={props.onClick} onDragOver={(event) => { event.preventDefault(); props.onDragTarget(props.folder.id) }} onDragLeave={() => props.onDragTarget(null)} onDrop={(event) => props.onDrop(event, props.folder.id)}><span className={css.leadingIcon}>{icon}</span><span>{props.folder.name}</span></Button>{props.onDelete !== undefined && <Button type="button" variant="toolbar" size="sm" aria-label={`删除文件夹 ${props.folder.name}`} title="删除空文件夹" onClick={props.onDelete}><IconTrashOutline16 size={14} /></Button>}</div>{(props.open || props.hasQuery) && <div className={css.children}>{props.children}</div>}</div>
}

/** 可选择和接收拖放的文件行。 */
function FileRow(props: { readonly file: FileSummary; readonly highlighted: boolean; readonly selected: boolean; readonly onClick: () => void; readonly onDragTarget: (target: string | 'trash' | null) => void; readonly onDropFiles: (event: DragEvent<HTMLElement>, destination: string | 'trash') => void }): ReactNode {
  return <Button type="button" variant="ghost" size="md" className={`${css.treeRow} ${css.fileRow} ${props.selected ? css.selected : ''} ${props.highlighted ? css.highlight : ''}`} icon={props.file.editable ? <IconListPenOutline16 size={16} /> : <IconPaperclipOutline16 size={16} />} onClick={props.onClick} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); props.onDragTarget(props.file.folderId) }} onDragLeave={(event) => { event.stopPropagation(); props.onDragTarget(null) }} onDrop={(event) => { event.stopPropagation(); props.onDropFiles(event, props.file.folderId) }}><span title={props.file.name}>{props.file.name}</span></Button>
}

/** 判断文件夹名称是否匹配当前搜索词。 */
function matchesFolder(folder: FolderRecord, query: string): boolean { return query.trim().length === 0 || folder.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) }
/** 返回指定文件夹内匹配搜索词的活动文件。 */
function visibleFiles(files: readonly FileSummary[], folderId: string, query: string): readonly FileSummary[] {
  const needle = query.trim().toLocaleLowerCase()
  return files.filter((file) => file.folderId === folderId && (needle.length === 0 || file.name.toLocaleLowerCase().includes(needle)))
}
