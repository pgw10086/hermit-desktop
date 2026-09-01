import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, IconChevronLeftOutline14, IconCodeOutline16, IconEllipsisOutline16, IconFolderClose16, IconLinkOutline16, IconListPenOutline16, IconPanelLeftOutline16, IconPaperclipOutline16, IconRefreshOutline16, IconTrashOutline16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FileReadResult, FileSummary, SaveStatus } from './contracts.js'
import css from './FileWorkspace.module.css'

interface FileEditorProps {
  /** 当前选中的文件。 */
  readonly file: FileSummary | undefined
  /** 当前文件读取结果及 revision。 */
  readonly read: FileReadResult | undefined
  /** 保存状态。 */
  readonly saveStatus: SaveStatus
  /** 是否处于窄窗口布局。 */
  readonly compact: boolean
  /** 收起文件树。 */
  readonly onCollapseTree: () => void
  /** 显示文件树。 */
  readonly onShowTree: () => void
  /** 更新编辑器正文。 */
  readonly onChange: (content: string) => void
  /** 重新读取当前文件。 */
  readonly onRetry: () => void
  /** 当前是否有可用的对话 projection。 */
  readonly projectionAvailable: boolean
  /** 请求将文件投影插入对话。 */
  readonly onProjection: () => void
  /** 打开移动文件流程。 */
  readonly onMove: () => void
  /** 将当前文件移入废纸篓。 */
  readonly onTrash: () => void
}

/** 文件编辑器和通用文件信息面板；保存由上层端口负责。 */
export function FileEditor(props: FileEditorProps): ReactNode {
  const [toolbarNotice, setToolbarNotice] = useState<string | undefined>()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { setToolbarNotice(undefined) }, [props.file?.id])
  if (props.file === undefined) return <main className={css.editor}><div className={css.empty}>从左侧选择文件开始</div></main>
  const editable = props.file.editable && props.read?.content !== undefined
  const title = props.file.name
  return <main className={`${css.editor} ${editable ? '' : css.infoEditor}`}>
    <header className={css.editorHeader}>
      <div className={css.identity}><span className={css.fileIcon}>{editable ? <IconListPenOutline16 size={18} /> : <IconPaperclipOutline16 size={18} />}</span><div><h2 title={title}>{title}</h2><span>{folderLabel(props.file.folderId)} · {props.file.mediaType}</span></div></div>
      <div className={css.editorActions}>
      <span className={`${css.saveStatus} ${props.saveStatus === 'saved' ? css.saved : props.saveStatus === 'failed' ? css.failed : ''}`}><StateDot state={props.saveStatus === 'failed' ? 'error' : props.saveStatus === 'saving' ? 'ongoing' : 'done'} size={7} />{props.saveStatus === 'saving' ? '正在保存' : props.saveStatus === 'failed' ? '保存失败' : '已保存'}</span>
        {props.compact ? <Button type="button" variant="toolbar" size="sm" icon={<IconPanelLeftOutline16 size={16} />} aria-label="显示文件树" title="显示文件树" onClick={props.onShowTree} /> : <Button type="button" variant="toolbar" size="sm" icon={<IconChevronLeftOutline14 size={16} />} aria-label="收起文件树" title="收起文件树" onClick={props.onCollapseTree} />}
      </div>
    </header>
    {editable ? <>
      <div className={css.editorToolbar} aria-label="Markdown 格式工具栏">
        <Button type="button" variant="toolbar" size="sm" aria-label="插入标题" title="标题" onClick={() => insertAtCursor(textareaRef.current, '# ', props.onChange)}><strong>H</strong></Button>
        <Button type="button" variant="toolbar" size="sm" aria-label="加粗" title="加粗" onClick={() => wrapSelection(textareaRef.current, '**', props.onChange)}><strong>B</strong></Button>
        <Button type="button" variant="toolbar" size="sm" aria-label="插入列表" title="列表" onClick={() => insertAtCursor(textareaRef.current, '- ', props.onChange)}>•</Button>
        <Button type="button" variant="toolbar" size="sm" aria-label="插入代码" title="代码" onClick={() => wrapSelection(textareaRef.current, '`', props.onChange)}><IconCodeOutline16 size={16} /></Button>
        <Button type="button" variant="toolbar" size="sm" aria-label="插入链接" title="链接" onClick={() => insertLink(textareaRef.current, props.onChange)}><IconLinkOutline16 size={16} /></Button>
        <span className={css.toolbarSpacer} />
        <Button type="button" variant="toolbar" size="sm" icon={<IconFolderClose16 size={16} />} aria-label="移动文件" title="移动到文件夹" onClick={props.onMove} />
        <Button type="button" variant="toolbar" size="sm" icon={<IconTrashOutline16 size={16} />} aria-label="移到废纸篓" title="移到废纸篓" onClick={props.onTrash} />
        <Button type="button" variant="toolbar" size="sm" icon={<IconEllipsisOutline16 size={16} />} aria-label="文件更多操作" title="更多" onClick={() => setToolbarNotice('更多操作将在对应流程中提供')} />
      </div>
      <textarea ref={textareaRef} className={css.textarea} aria-label={`编辑 ${title}`} value={props.read?.content ?? ''} onChange={(event) => props.onChange(event.currentTarget.value)} />
      <footer className={css.editorFooter}><span>{(props.read?.content ?? '').length} 字</span><span>Markdown</span></footer>
    </> : <>
      <div className={css.infoPane}><div className={css.infoHeading}><span className={css.infoIcon}><IconPaperclipOutline16 size={20} /></span><div><h3>{title}</h3><p>文件已保存到 Hermit，但当前格式不能在这里预览或编辑。</p></div></div><dl><div><dt>类型</dt><dd>{props.file.mediaType}</dd></div><div><dt>大小</dt><dd>{formatBytes(props.file.byteSize)}</dd></div><div><dt>添加时间</dt><dd>{formatTime(props.file.createdAt)}</dd></div><div><dt>修改时间</dt><dd>{formatTime(props.file.updatedAt)}</dd></div><div><dt>对话引用</dt><dd>{props.read?.projectionError === undefined ? '可用' : props.read.projectionError}</dd></div></dl></div>
      <footer className={css.editorFooter}><span>通用文件信息</span><span><Button type="button" variant="toolbar" size="sm" icon={<IconRefreshOutline16 size={14} />} aria-label="重新读取文件" title="重新读取" onClick={props.onRetry} /></span></footer>
    </>}
    {toolbarNotice !== undefined && <p className={css.inlineNotice} role="status">{toolbarNotice}</p>}
    {editable && props.projectionAvailable && props.read?.projectionError === undefined && <Button type="button" className={css.projectionButton} variant="ghost" size="sm" icon={<IconLinkOutline16 size={16} />} onClick={props.onProjection}>在对话中使用</Button>}
  </main>
}

/** 将系统文件夹身份转换为用户可见名称。 */
function folderLabel(id: string): string { return id === 'root' ? '根目录' : id === 'quick-notes' ? '快速记事' : id }
/** 将字节数转换为编辑器信息面板使用的容量文本。 */
function formatBytes(size: number): string { return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB` }
/** 将 ISO 时间转换为中文本地化时间。 */
function formatTime(value: string): string { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }

/** 在光标位置插入 Markdown 文本并恢复焦点。 */
function insertAtCursor(input: HTMLTextAreaElement | null, text: string, onChange: (content: string) => void): void {
  if (input === null) return
  const start = input.selectionStart
  const end = input.selectionEnd
  const next = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`
  onChange(next)
  requestAnimationFrame(() => { input.focus(); input.setSelectionRange(start + text.length, start + text.length) })
}

/** 用 Markdown 标记包裹当前选择文本。 */
function wrapSelection(input: HTMLTextAreaElement | null, marker: string, onChange: (content: string) => void): void {
  if (input === null) return
  const start = input.selectionStart
  const end = input.selectionEnd
  const selected = input.value.slice(start, end)
  const next = `${input.value.slice(0, start)}${marker}${selected || '文本'}${marker}${input.value.slice(end)}`
  onChange(next)
  requestAnimationFrame(() => { input.focus(); input.setSelectionRange(start + marker.length, start + marker.length + (selected || '文本').length) })
}

/** 在当前选择处插入 Markdown 链接模板。 */
function insertLink(input: HTMLTextAreaElement | null, onChange: (content: string) => void): void {
  if (input === null) return
  const start = input.selectionStart
  const end = input.selectionEnd
  const selected = input.value.slice(start, end) || '链接文本'
  const inserted = `[${selected}](https://)`
  const next = `${input.value.slice(0, start)}${inserted}${input.value.slice(end)}`
  onChange(next)
  requestAnimationFrame(() => {
    input.focus()
    input.setSelectionRange(start + selected.length + 3, start + selected.length + 11)
  })
}
