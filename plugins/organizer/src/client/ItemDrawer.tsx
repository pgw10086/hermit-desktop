import { useState } from 'react'
import {
  Button,
  DisclosureRow,
  IconCheckOutline16,
  IconCloseOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconListPenOutline16,
  IconTrashOutline16,
  Menu,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ItemDraft, ItemKind, ItemLifecycleAction, OrganizerItem } from './contracts.js'
import { ItemForm, draftCanSave } from './ItemForm.js'
import css from './OrganizerSurface.module.css'
import drawerCss from './ItemDrawer.module.css'

export type DrawerState =
  | { readonly mode: 'view' | 'edit'; readonly itemId: string }
  | { readonly mode: 'create'; readonly kind?: ItemKind }

export type DrawerIssue =
  | { readonly type: 'conflict'; readonly message: string; readonly latest: OrganizerItem }
  | { readonly type: 'error'; readonly message: string }

export interface ItemDrawerProps {
  /** 当前抽屉模式和目标事项身份。 */
  readonly state: DrawerState
  /** 当前投影中的事项；创建模式下为空。 */
  readonly item?: OrganizerItem
  /** 编辑模式下的唯一草稿。 */
  readonly draft?: ItemDraft
  /** 草稿是否与基线不同。 */
  readonly dirty: boolean
  /** 是否有命令正在执行。 */
  readonly busy: boolean
  /** 是否正在保护未保存变更。 */
  readonly guardActive: boolean
  /** 当前需要用户处理的问题。 */
  readonly issue?: DrawerIssue
  /** 关闭抽屉。 */
  readonly onClose: () => void
  /** 进入编辑模式。 */
  readonly onEdit: () => void
  /** 取消编辑并返回查看或关闭。 */
  readonly onCancelEdit: () => void
  /** 更新唯一草稿。 */
  readonly onDraftChange: (draft: ItemDraft) => void
  /** 保存草稿。 */
  readonly onSave: () => void
  /** 完成当前待办。 */
  readonly onComplete: () => void
  /** 执行事项生命周期动作。 */
  readonly onLifecycle: (action: ItemLifecycleAction) => void
  /** 恢复回收站事项。 */
  readonly onRestore: () => void
  /** 永久删除回收站事项。 */
  readonly onPurge: () => void
  /** 保存草稿后继续原导航动作。 */
  readonly onGuardSave: () => void
  /** 放弃草稿并继续原导航动作。 */
  readonly onGuardDiscard: () => void
  /** 取消导航保护并继续编辑。 */
  readonly onGuardContinue: () => void
  /** 接受服务端最新版本并放弃本地修改。 */
  readonly onAcceptLatest: () => void
  /** 以最新 revision 继续本地编辑。 */
  readonly onContinueFromLatest: () => void
}

/** 事项详情、编辑和危险操作的统一抽屉。 */
export function ItemDrawer(props: ItemDrawerProps) {
  const [purgeConfirm, setPurgeConfirm] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const title = props.state.mode === 'create' ? '新建事项' : props.state.mode === 'edit' ? '编辑事项' : props.item?.deletedAt === undefined ? '事项详情' : '回收站事项'
  const moreItems = props.item === undefined ? [] : itemMenu(props.item)
  /** 将菜单选择收窄为生命周期动作并交给 Surface 执行。 */
  const selectMore = (id: string) => {
    setMoreOpen(false)
    props.onLifecycle(id as ItemLifecycleAction)
  }

  return (
    <aside className={drawerCss.drawer} aria-label={title} data-organizer-drawer={props.state.mode}>
      <div className={drawerCss.header}>
        <h2>{title}</h2>
        <Button type="button" variant="toolbar" size="sm" aria-label="关闭右侧抽屉" title="关闭" onClick={props.onClose}><IconCloseOutline16 size={16} /></Button>
      </div>
      <div className={drawerCss.body}>
        {props.guardActive && (
          <div className={drawerCss.guard} role="alert">
            <h3>保留未保存的修改？</h3><p>当前只保留这一份草稿。离开后不会在后台保存。</p>
            <div className={css.inlineActions}><Button type="button" variant="primary" size="sm" disabled={props.busy} onClick={props.onGuardSave}>保存</Button><Button type="button" variant="outline" size="sm" onClick={props.onGuardDiscard}>放弃</Button><Button type="button" variant="ghost" size="sm" onClick={props.onGuardContinue}>继续编辑</Button></div>
          </div>
        )}
        {props.issue?.type === 'conflict' && (
          <div className={drawerCss.conflict} role="alert">
            <h3>内容已发生变化</h3><p>{props.issue.message}</p><p><strong>最新版本：</strong>{props.issue.latest.detail}</p>
            <div className={css.inlineActions}><Button type="button" variant="outline" size="sm" onClick={props.onAcceptLatest}>放弃本地修改</Button><Button type="button" variant="primary" size="sm" onClick={props.onContinueFromLatest}>以最新版继续</Button></div>
          </div>
        )}
        {props.issue?.type === 'error' && <div className={css.notice} data-tone="error" role="alert"><div><p className={css.noticeTitle}>本次未修改</p><p className={css.noticeDetail}>{props.issue.message}</p></div></div>}

        {props.state.mode === 'view'
          ? props.item === undefined ? <p className={css.emptyText}>事项已不在当前投影中</p> : <ItemDetails item={props.item} />
          : props.draft === undefined ? null : <ItemForm draft={props.draft} original={props.item} onChange={props.onDraftChange} />}

        {purgeConfirm && props.item !== undefined && (
          <div className={drawerCss.dangerConfirm} role="alert">
            <h3>永久删除“{props.item.title}”？</h3><p>该事项、提醒历史和搜索数据将无法恢复；DSH 对话中已有的历史结果不会被追溯删除。</p>
            <div className={css.inlineActions}><Button type="button" variant="outline" size="sm" onClick={() => setPurgeConfirm(false)}>取消</Button><Button type="button" variant="primary" size="sm" disabled={props.busy} onClick={props.onPurge}>确认永久删除</Button></div>
          </div>
        )}
      </div>
      <div className={drawerCss.footer}>
        <div className={drawerCss.actions}>
          {props.state.mode === 'view' && props.item?.deletedAt !== undefined && <><Button type="button" variant="outline" disabled={props.busy} onClick={props.onRestore}>恢复</Button><Button type="button" variant="ghost" icon={<IconTrashOutline16 size={16} />} onClick={() => setPurgeConfirm(true)}>永久删除</Button></>}
          {props.state.mode === 'view' && props.item?.deletedAt === undefined && (
            <>
              <Button type="button" variant="outline" icon={<IconEditOutline16 size={16} />} onClick={props.onEdit}>编辑</Button>
              {props.item?.kind === 'todo' && props.item.status === 'planned' && <Button type="button" variant="primary" icon={<IconCheckOutline16 size={16} />} disabled={props.busy} onClick={props.onComplete}>完成</Button>}
              <Menu open={moreOpen} anchor={<Button type="button" variant="toolbar" aria-label="更多事项操作" title="更多" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}><IconEllipsisOutline16 size={16} /></Button>} items={moreItems} onSelect={selectMore} onClose={() => setMoreOpen(false)} align="end" portal />
            </>
          )}
          {props.state.mode !== 'view' && <><Button type="button" variant="outline" disabled={props.busy} onClick={props.onCancelEdit}>取消</Button><Button type="button" variant="primary" disabled={props.busy || !draftCanSave(props.draft)} onClick={props.onSave}>{props.busy ? '正在保存' : props.state.mode === 'create' ? '创建' : '保存'}</Button></>}
        </div>
      </div>
    </aside>
  )
}

/** 展示事项派生详情和来源历史，不修改 Canonical 数据。 */
function ItemDetails({ item }: { readonly item: OrganizerItem }) {
  const [historyOpen, setHistoryOpen] = useState(false)
  return (
    <div>
      <p className={drawerCss.detailTitle}>{item.title}</p>
      <p className={drawerCss.detailBody}>{item.detail || '无备注'}</p>
      <dl className={drawerCss.detailList}>
        <dt>类型</dt><dd>{item.kindLabel}</dd><dt>状态</dt><dd>{item.statusLabel}</dd>
        {item.pinned === true && <><dt>置顶</dt><dd>是</dd></>}
        <dt>时间</dt><dd>{item.timeLabel ?? '未设置'}</dd>
        {item.kind === 'todo' && <><dt>优先级</dt><dd>{priorityLabel(item.priority)}</dd></>}
        {item.kind === 'event' && <><dt>地点</dt><dd>{item.location || '未设置'}</dd></>}
        <dt>提醒</dt><dd>{item.reminderLabel ?? '无'}</dd><dt>标签</dt><dd>{item.tags.length > 0 ? item.tags.join('、') : '无'}</dd>
        {item.deletedAt !== undefined && <><dt>删除于</dt><dd>{item.deletedAt}</dd><dt>提醒状态</dt><dd>已暂停</dd></>}
      </dl>
      {item.kind === 'todo' && item.checklist !== undefined && item.checklist.length > 0 && <section className={drawerCss.detailSection}><h3>待办清单</h3><ul className={drawerCss.checklist}>{item.checklist.map((entry) => <li key={entry.id} data-completed={entry.completed}>{entry.completed ? '已完成' : '未完成'} · {entry.text}</li>)}</ul></section>}
      <DisclosureRow icon={<IconListPenOutline16 size={16} />} title="来源与历史" open={historyOpen} expandable expandOnRowClick onToggle={() => setHistoryOpen((value) => !value)}>
        <dl className={drawerCss.historyList}><dt>当前版本</dt><dd>revision {item.revision}</dd><dt>来源</dt><dd>{item.sourceLabel}</dd><dt>原始输入</dt><dd>{item.originalInput}</dd><dt>类型历史</dt><dd>{item.typeHistory.join(' → ')}</dd></dl>
      </DisclosureRow>
    </div>
  )
}

/** 根据事项类型和状态生成允许的生命周期菜单。 */
function itemMenu(item: OrganizerItem): readonly MenuEntry[] {
  const entries: MenuEntry[] = []
  if (item.kind === 'note') {
    entries.push({ id: item.pinned === true ? 'unpin' : 'pin', label: item.pinned === true ? '取消置顶' : '置顶' })
    entries.push({ id: item.status === 'archived' ? 'activate' : 'archive', label: item.status === 'archived' ? '恢复使用' : '归档' })
  } else if (item.status !== 'completed' && item.status !== 'cancelled') entries.push({ id: 'cancel', label: item.kind === 'todo' ? '取消待办' : '取消日程' })
  entries.push({ type: 'separator', id: 'separator-trash' }, { id: 'trash', label: '移到回收站' })
  return entries
}

/** 将待办优先级转换为中文标签。 */
function priorityLabel(priority: OrganizerItem['priority']): string { return priority === 'high' ? '高' : priority === 'medium' ? '中' : priority === 'low' ? '低' : '无' }
