import { type KeyboardEvent, type ReactNode } from 'react'
import {
  Button,
  IconBrowseOutline16,
  IconChevronLeftOutline14,
  IconCodeOutline16,
  IconCopyOutline16,
  IconFolderOpenOutline16,
  IconSearchOutline16,
  IconTrashOutline16,
  Input,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClipboardAction } from '../actions.js'
import type { ClipboardKind } from '../full-history.js'
import { kindLabel, type ClipboardWireEntry } from './api.js'
import { entrySummary, formatBytes, formatTime } from './history-presenters.js'
import css from './HistoryWorkspace.module.css'

export interface HistoryWorkspaceProps {
  /** 当前处于历史还是废纸篓视图。 */
  readonly view: 'history' | 'trash'
  /** 当前筛选后的安全投影列表。 */
  readonly entries: readonly ClipboardWireEntry[]
  /** 当前选中记录。 */
  readonly selected: ClipboardWireEntry | undefined
  /** 搜索词。 */
  readonly query: string
  /** 内容类型筛选。 */
  readonly kind: ClipboardKind | undefined
  /** 来源应用筛选。 */
  readonly sourceApplication: string
  /** 是否仅显示固定记录。 */
  readonly pinnedOnly: boolean
  /** 当前可选来源列表。 */
  readonly sources: readonly string[]
  /** 列表是否正在加载。 */
  readonly loading: boolean
  /** 窄窗口下详情面板是否打开。 */
  readonly narrowDetailOpen: boolean
  /** 更新搜索词。 */
  readonly onQueryChange: (value: string) => void
  /** 更新类型筛选。 */
  readonly onKindChange: (value: ClipboardKind | undefined) => void
  /** 更新来源筛选。 */
  readonly onSourceChange: (value: string) => void
  /** 更新固定筛选。 */
  readonly onPinnedOnlyChange: (value: boolean) => void
  /** 选择记录并打开详情。 */
  readonly onSelect: (id: string) => void
  /** 窄窗口返回列表。 */
  readonly onBackToList: () => void
  /** 更新固定状态。 */
  readonly onPin: (entry: ClipboardWireEntry, pinned: boolean) => void
  /** 执行复制或粘贴。 */
  readonly onAction: (action: ClipboardAction) => void
  /** 移入废纸篓。 */
  readonly onTrash: () => void
  /** 从废纸篓恢复。 */
  readonly onRestore: () => void
  /** 永久删除。 */
  readonly onPermanentDelete: () => void
}

/** 历史列表与详情的双栏工作面，键盘导航使用同一选择状态。 */
export function HistoryWorkspace(props: HistoryWorkspaceProps): ReactNode {
  /** 按当前选中项相对移动，并限制在列表边界内。 */
  const selectRelative = (delta: number): void => {
    if (props.entries.length === 0) return
    const current = props.selected === undefined
      ? (delta > 0 ? -1 : 0)
      : props.entries.findIndex((entry) => entry.id === props.selected?.id)
    const next = Math.max(0, Math.min(props.entries.length - 1, current + delta))
    const entry = props.entries[next]
    if (entry !== undefined) props.onSelect(entry.id)
  }
  /** 处理列表上下键，保持键盘操作与点击选择一致。 */
  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      selectRelative(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      selectRelative(-1)
    }
  }

  return (
    <div className={css.historyBody}>
      <div className={css.filterBar} role="search">
        <Input
          className={css.searchInput}
          icon={<IconSearchOutline16 size={16} />}
          type="search"
          aria-label="搜索剪贴板历史"
          placeholder={props.view === 'history' ? '搜索剪贴板历史' : '搜索 Trash'}
          value={props.query}
          onChange={(event) => props.onQueryChange(event.currentTarget.value)}
        />
        <label className={css.filterField}>
          <span>类型</span>
          <select
            className={css.nativeControl}
            value={props.kind ?? ''}
            onChange={(event) => props.onKindChange(event.currentTarget.value === '' ? undefined : event.currentTarget.value as ClipboardKind)}
          >
            <option value="">全部</option>
            <option value="TEXT">文本</option>
            <option value="IMAGE">图片</option>
            <option value="FILE_LIST">文件</option>
          </select>
        </label>
        <label className={css.filterField}>
          <span>来源</span>
          <select className={css.nativeControl} value={props.sourceApplication} onChange={(event) => props.onSourceChange(event.currentTarget.value)}>
            <option value="">全部来源</option>
            {props.sources.map((source) => <option key={source} value={source}>{source}</option>)}
          </select>
        </label>
        <label className={css.checkField}>
          <input type="checkbox" checked={props.pinnedOnly} onChange={(event) => props.onPinnedOnlyChange(event.currentTarget.checked)} />
          <span>仅置顶</span>
        </label>
      </div>

      {props.view === 'trash' && (
        <p className={css.trashNotice}>Trash 最多保留 30 天；容量不足时可能提前永久清理。</p>
      )}

      <div className={css.workspace} data-detail-open={props.narrowDetailOpen}>
        <section className={css.listPane} aria-label={props.view === 'history' ? '剪贴板历史列表' : 'Trash 列表'}>
          <div className={css.listHeader} aria-hidden="true">
            <span>置顶</span><span>内容摘要</span><span>类型</span><span>来源应用</span><span>复制时间</span>
          </div>
          <div className={css.listScroll} role="listbox" tabIndex={0} aria-label="剪贴板记录" onKeyDown={onListKeyDown}>
            {props.loading
              ? <LoadingRows />
              : props.entries.length === 0
                ? <EmptyList view={props.view} />
                : props.entries.map((entry) => (
                  <HistoryRow
                    key={entry.id}
                    entry={entry}
                    selected={entry.id === props.selected?.id}
                    onSelect={() => props.onSelect(entry.id)}
                    onPin={(pinned) => props.onPin(entry, pinned)}
                  />
                ))}
          </div>
          <footer className={css.listFooter}>共 {String(props.entries.length)} 项</footer>
        </section>

        <HistoryDetail
          entry={props.selected}
          view={props.view}
          onBack={props.onBackToList}
          onAction={props.onAction}
          onTrash={props.onTrash}
          onRestore={props.onRestore}
          onPermanentDelete={props.onPermanentDelete}
        />
      </div>
    </div>
  )
}

/** 单条历史记录行，固定动作不触发详情选择。 */
function HistoryRow({ entry, selected, onSelect, onPin }: {
  readonly entry: ClipboardWireEntry
  readonly selected: boolean
  readonly onSelect: () => void
  readonly onPin: (pinned: boolean) => void
}): ReactNode {
  return (
    <div className={css.historyRow} role="option" aria-selected={selected} data-entry-id={entry.id}>
      <Tooltip label={entry.pinned ? '取消置顶' : '置顶'} side="right">
        <button
          type="button"
          className={css.pinButton}
          data-pinned={entry.pinned}
          aria-label={entry.pinned ? `取消置顶：${entrySummary(entry)}` : `置顶：${entrySummary(entry)}`}
          onClick={() => onPin(!entry.pinned)}
        >
          {entry.pinned ? '★' : '☆'}
        </button>
      </Tooltip>
      <button type="button" className={css.rowSelect} onClick={onSelect}>
        <span className={css.rowSummary} title={entrySummary(entry)}>{entrySummary(entry)}</span>
        <span className={css.rowKind}>{kindIcon(entry.kind)} {kindLabel(entry.kind)}</span>
        <span className={css.rowSource}>{entry.sourceApplication ?? '未知来源'}</span>
        <time className={css.rowTime} dateTime={new Date(entry.lastUsedAt).toISOString()}>{formatTime(entry.lastUsedAt)}</time>
      </button>
    </div>
  )
}

/** 历史详情面板，根据 view 提供活动记录或废纸篓操作。 */
function HistoryDetail({ entry, view, onBack, onAction, onTrash, onRestore, onPermanentDelete }: {
  readonly entry: ClipboardWireEntry | undefined
  readonly view: 'history' | 'trash'
  readonly onBack: () => void
  readonly onAction: (action: ClipboardAction) => void
  readonly onTrash: () => void
  readonly onRestore: () => void
  readonly onPermanentDelete: () => void
}): ReactNode {
  return (
    <aside className={css.detailPane} aria-label="剪贴板详情" data-detail-kind={entry?.kind ?? 'none'}>
      <div className={css.detailHeader}>
        <Button className={css.backButton} type="button" variant="toolbar" size="sm" icon={<IconChevronLeftOutline14 size={14} />} onClick={onBack}>
          返回列表
        </Button>
        <div>
          <h2>{entry === undefined ? '详情' : `${kindLabel(entry.kind)}详情`}</h2>
          {entry !== undefined && <p>{entry.sourceApplication ?? '未知来源'} · {formatTime(entry.lastUsedAt)}</p>}
        </div>
      </div>
      {entry === undefined
        ? <div className={css.emptyDetail}><IconCopyOutline16 size={24} /><p>选择一条记录查看详情</p></div>
        : (
          <>
            <div className={css.detailContent}>
              {entry.kind === 'TEXT' && <TextPreview entry={entry} />}
              {entry.kind === 'IMAGE' && <ImagePreview entry={entry} />}
              {entry.kind === 'FILE_LIST' && <FileListPreview entry={entry} />}
              <dl className={css.metadata}>
                <div><dt>类型</dt><dd>{kindLabel(entry.kind)}</dd></div>
                <div><dt>来源应用</dt><dd>{entry.sourceApplication ?? '未知来源'}</dd></div>
                <div><dt>复制时间</dt><dd>{formatTime(entry.lastUsedAt)}</dd></div>
                <div><dt>数据大小</dt><dd>{formatBytes(entry.byteSize)}</dd></div>
              </dl>
            </div>
            <div className={css.detailActions}>
              {view === 'history'
                ? (
                  <>
                    <Button type="button" variant="outline" size="sm" icon={<IconCopyOutline16 size={16} />} onClick={() => onAction('copy')}>复制</Button>
                    <Button type="button" variant="primary" size="sm" onClick={() => onAction('paste')}>粘贴</Button>
                    <Button type="button" variant="ghost" size="sm" icon={<IconTrashOutline16 size={16} />} onClick={onTrash}>删除</Button>
                  </>
                )
                : (
                  <>
                    <Button type="button" variant="outline" size="sm" onClick={onRestore}>恢复</Button>
                    <Button type="button" variant="ghost" size="sm" icon={<IconTrashOutline16 size={16} />} onClick={onPermanentDelete}>永久删除</Button>
                  </>
                )}
            </div>
          </>
        )}
    </aside>
  )
}

/** 文本记录预览。 */
function TextPreview({ entry }: { readonly entry: Extract<ClipboardWireEntry, { kind: 'TEXT' }> }): ReactNode {
  return <section className={css.previewSection}><h3>文本预览</h3><pre tabIndex={0}>{entry.text}</pre><p>{String(entry.text.length)} 个字符</p></section>
}

/** 图片安全预览，只消费 Host 提供的 previewUrl。 */
function ImagePreview({ entry }: { readonly entry: Extract<ClipboardWireEntry, { kind: 'IMAGE' }> }): ReactNode {
  return <figure className={css.imagePreview}><img src={entry.previewUrl} alt="剪贴板图片预览" /><figcaption>{entry.width} × {entry.height} · {formatBytes(entry.byteSize)}</figcaption></figure>
}

/** 文件列表预览，并展示最近一次刷新到的存在性。 */
function FileListPreview({ entry }: { readonly entry: Extract<ClipboardWireEntry, { kind: 'FILE_LIST' }> }): ReactNode {
  return (
    <section className={css.previewSection}>
      <h3>{String(entry.items.length)} 个文件或文件夹</h3>
      <ol className={css.fileList}>
        {entry.items.map((item, index) => (
          <li key={`${String(index)}:${item.path}`} data-missing={!item.exists}>
            <span className={css.fileIcon}>{item.itemType === 'folder' ? <IconFolderOpenOutline16 size={16} /> : <IconCodeOutline16 size={16} />}</span>
            <span><strong>{item.displayName}</strong><code>{item.path}</code></span>
            <span className={css.fileState}>{item.exists ? '存在' : '不存在'}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** 历史加载期间的稳定占位行。 */
function LoadingRows(): ReactNode {
  return <div className={css.loadingRows} aria-label="正在加载"><span /><span /><span /></div>
}

/** 当前筛选视图为空时的明确状态。 */
function EmptyList({ view }: { readonly view: 'history' | 'trash' }): ReactNode {
  return <div className={css.emptyList}><p>{view === 'history' ? '没有匹配的剪贴板记录' : 'Trash 中没有匹配记录'}</p></div>
}

/** 将内容类型转换为公共 UI 图标。 */
function kindIcon(kind: ClipboardKind): ReactNode {
  if (kind === 'TEXT') return <IconCodeOutline16 size={16} />
  if (kind === 'IMAGE') return <IconBrowseOutline16 size={16} />
  return <IconFolderOpenOutline16 size={16} />
}
