import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconEditOutline16,
  IconRefreshOutline14,
  Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { OrganizerItem, Projection } from './contracts.js'
import css from './OrganizerSurface.module.css'

export interface ItemListProps {
  /** 待展示的 Organizer 投影及其状态。 */
  readonly projection: Projection<OrganizerItem>
  /** 当前抽屉选中的事项身份。 */
  readonly selectedItemId?: string | undefined
  /** 投影为空时的业务文案。 */
  readonly emptyLabel: string
  /** 打开事项详情。 */
  readonly onOpen: (itemId: string) => void
  /** 可选的完成待办动作。 */
  readonly onComplete?: (item: OrganizerItem) => void
  /** 可选的待办快速编辑动作。 */
  readonly onQuickEdit?: (item: OrganizerItem, title: string, detail: string) => Promise<boolean>
  /** 可选的清单项切换动作。 */
  readonly onChecklistToggle?: (item: OrganizerItem, entryId: string, completed: boolean) => Promise<boolean>
}

/** 投影加载期间的稳定占位，不改变列表尺寸。 */
export function LoadingRows() {
  return (
    <div className={css.loadingRows} aria-label="正在加载">
      <span className={css.loadingLine} />
      <span className={css.loadingLine} />
    </div>
  )
}

/** 根据投影状态渲染加载、不可用、部分结果或事项列表。 */
export function ItemList({ projection, selectedItemId, emptyLabel, onOpen, onComplete, onQuickEdit, onChecklistToggle }: ItemListProps) {
  if (projection.state === 'loading') return <LoadingRows />
  if (projection.state === 'unavailable') {
    return <p className={css.emptyText}>{projection.message ?? '这部分内容暂时不可用'}</p>
  }
  return (
    <Fragment>
      {projection.state === 'partial' && (
        <p className={css.sectionNotice}>{projection.message ?? '当前结果不完整'}</p>
      )}
      {projection.items.length === 0
        ? <p className={css.emptyText}>{emptyLabel}</p>
        : (
          <ul className={css.list}>
            {projection.items.map((item) => (
              <li key={item.id}>
                <ItemRow
                  item={item}
                  selected={item.id === selectedItemId}
                  onOpen={() => onOpen(item.id)}
                  {...(onComplete === undefined ? {} : { onComplete: () => onComplete(item) })}
                  {...(onQuickEdit === undefined ? {} : { onQuickEdit: (title: string, detail: string) => onQuickEdit(item, title, detail) })}
                  {...(onChecklistToggle === undefined ? {} : { onChecklistToggle: (entryId: string, completed: boolean) => onChecklistToggle(item, entryId, completed) })}
                />
              </li>
            ))}
          </ul>
        )}
    </Fragment>
  )
}

/** 单条事项行，拥有展开清单和快速编辑等局部交互状态。 */
function ItemRow({ item, selected, onOpen, onComplete, onQuickEdit, onChecklistToggle }: {
  readonly item: OrganizerItem
  readonly selected: boolean
  readonly onOpen: () => void
  readonly onComplete?: () => void
  readonly onQuickEdit?: (title: string, detail: string) => Promise<boolean>
  readonly onChecklistToggle?: (entryId: string, completed: boolean) => Promise<boolean>
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>()
  useEffect(() => () => { if (clickTimer.current !== undefined) clearTimeout(clickTimer.current) }, [])

  let leading: ReactNode = <span className={css.kindMark}>{item.kindLabel}</span>
  if (item.kind === 'todo') {
    leading = (
      <input
        className={css.todoCheck}
        type="checkbox"
        checked={item.completed === true}
        aria-label={item.completed === true ? `${item.title}，已完成` : `完成：${item.title}`}
        onChange={(event) => {
          event.stopPropagation()
          if (!event.currentTarget.checked || onComplete === undefined) return
          onComplete()
        }}
        onClick={(event) => event.stopPropagation()}
      />
    )
  }

  const hasChecklist = item.kind === 'todo' && (item.checklist?.length ?? 0) > 0
  const openContent = () => {
    if (clickTimer.current !== undefined) clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(onOpen, 220)
  }
  return (
    <div className={css.itemRow} data-selected={selected}>
      {leading}
      <div className={css.itemBody}>
        {editing && onQuickEdit !== undefined
          ? <QuickContentEditor item={item} onSave={async (title, detail) => { const saved = await onQuickEdit(title, detail); if (saved) setEditing(false); return saved }} onCancel={() => setEditing(false)} />
          : (
            <div className={css.itemMainLine}>
              {hasChecklist && (
                <Button
                  type="button"
                  className={css.checklistToggle}
                  variant="ghost"
                  size="sm"
                  icon={expanded ? <IconChevronDownOutline14 size={14} /> : <IconChevronRightOutline14 size={14} />}
                  aria-label={expanded ? `收起${item.title}的清单` : `展开${item.title}的清单`}
                  title={expanded ? '收起清单' : '展开清单'}
                  aria-expanded={expanded}
                  onClick={() => setExpanded((value) => !value)}
                />
              )}
              <button
                type="button"
                className={css.itemContentButton}
                onClick={(event) => {
                  if (event.detail >= 2 && onQuickEdit !== undefined && item.kind === 'todo' && item.deletedAt === undefined) {
                    if (clickTimer.current !== undefined) clearTimeout(clickTimer.current)
                    setEditing(true)
                    return
                  }
                  openContent()
                }}
              >
                <span>
                  <span className={css.itemTitleLine}>
                    <span className={css.itemTitle} data-completed={item.completed === true}>{item.title}</span>
                    <span className={css.statusLabel}>{item.statusLabel}</span>
                  </span>
                  <span className={css.itemMeta}>
                    {item.tags.length > 0 ? item.tags.join(' · ') : item.detail}
                  </span>
                </span>
                <span className={css.itemTime}>
                  <span>{item.timeLabel ?? '无日期'}</span>
                  {item.reminderLabel !== undefined && <span className={css.itemReminder}>提醒：{item.reminderLabel}</span>}
                </span>
              </button>
            </div>
          )}
        {expanded && hasChecklist && (
          <ul className={css.inlineChecklist} aria-label={`${item.title}的清单`}>
            {item.checklist?.map((entry) => (
              <li key={entry.id} className={css.inlineChecklistRow} data-completed={entry.completed}>
                <input
                  type="checkbox"
                  checked={entry.completed}
                  aria-label={`${entry.completed ? '取消完成' : '完成'}清单项 ${entry.text}`}
                  disabled={onChecklistToggle === undefined}
                  onChange={(event) => { if (onChecklistToggle !== undefined) void onChecklistToggle(entry.id, event.currentTarget.checked) }}
                />
                <span>{entry.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={css.itemActions}>
        {onQuickEdit !== undefined && item.kind === 'todo' && item.deletedAt === undefined && !editing && (
          <Button type="button" variant="toolbar" size="sm" icon={<IconEditOutline16 size={16} />} aria-label={`编辑${item.title}内容`} title="编辑内容" onClick={() => setEditing(true)} />
        )}
      </div>
    </div>
  )
}

/** 待办标题和正文的局部快速编辑器，不直接访问全局状态。 */
function QuickContentEditor({ item, onSave, onCancel }: {
  readonly item: OrganizerItem
  readonly onSave: (title: string, detail: string) => Promise<boolean>
  readonly onCancel: () => void
}) {
  const [title, setTitle] = useState(item.title)
  const [detail, setDetail] = useState(item.detail)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (title.trim().length === 0 || busy) return
    setBusy(true)
    try { await onSave(title, detail) } finally { setBusy(false) }
  }
  return (
    <div className={css.quickEditor} aria-label="快速编辑待办内容">
      <Input aria-label="待办标题" value={title} onChange={(event) => setTitle(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void save() } }} autoFocus />
      <textarea className={css.quickEditorDetail} aria-label="待办正文" value={detail} onChange={(event) => setDetail(event.currentTarget.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void save() } }} />
      <div className={css.quickEditorActions}>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>取消</Button>
        <Button type="button" size="sm" variant="primary" disabled={busy || title.trim().length === 0} onClick={() => { void save() }}>{busy ? '正在保存' : '保存'}</Button>
      </div>
    </div>
  )
}

export function RetryLine({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) {
  return (
    <div className={css.inlineActions}>
      <span className={css.muted}>{message}</span>
      <Button type="button" size="sm" variant="ghost" icon={<IconRefreshOutline14 size={14} />} onClick={onRetry}>
        重试
      </Button>
    </div>
  )
}
