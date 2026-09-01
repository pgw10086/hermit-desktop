import { useState, type ReactNode } from 'react'
import {
  Button,
  IconBrowseOutline16,
  IconChecklistOutline14,
  IconCloseOutline16,
  IconEllipsisOutline16,
  IconGoalOutline16,
  IconListPenOutline16,
  IconPlusOutline16,
  IconSearchOutline16,
  Menu,
  Tooltip,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { NormalView, OrganizerView } from './contracts.js'
import css from './OrganizerSurface.module.css'

const VIEW_LABELS: Record<OrganizerView, string> = {
  default: '概览',
  items: '全部事项',
  today: '今天',
  calendar: '日历',
  search: '搜索',
  reminders: '提醒中心',
  trash: '回收站',
  data: '导入与导出',
}

const VIEW_ITEMS: readonly { readonly id: NormalView; readonly label: string; readonly icon: ReactNode }[] = [
  { id: 'default', label: '概览', icon: <IconListPenOutline16 size={16} /> },
  { id: 'items', label: '全部事项', icon: <IconChecklistOutline14 size={16} /> },
  { id: 'today', label: '今天', icon: <IconGoalOutline16 size={16} /> },
  { id: 'calendar', label: '日历', icon: <IconBrowseOutline16 size={16} /> },
]

const MORE_ITEMS: readonly MenuEntry[] = [
  { id: 'trash', label: '回收站' },
  { id: 'data', label: '导入与导出' },
]

export interface OrganizerHeaderProps {
  readonly view: OrganizerView
  readonly reminderAttention: boolean
  readonly onChangeView: (view: OrganizerView) => void
  readonly onCreate: () => void
  readonly onSearch: () => void
  readonly onClose: () => void
}

export function OrganizerHeader({ view, reminderAttention, onChangeView, onCreate, onSearch, onClose }: OrganizerHeaderProps) {
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  return (
    <header className={css.header}>
      <div className={css.titleGroup}>
        <h1 className={css.title}>个人事项</h1>
        <p className={css.contextLabel}>{VIEW_LABELS[view]}</p>
      </div>
      <div className={css.headerControls}>
        <nav className={css.viewNav} aria-label="个人事项视图">
          {VIEW_ITEMS.map((item) => {
            const selected = view === item.id
            return (
              <Tooltip key={item.id} label={item.label} side="bottom">
                <Button
                  type="button"
                  className={css.viewNavButton}
                  variant="toolbar"
                  size="sm"
                  icon={item.icon}
                  aria-current={selected ? 'page' : undefined}
                  aria-label={item.label}
                  data-active={selected}
                  onClick={() => onChangeView(item.id)}
                >
                  <span className={css.viewNavLabel}>{item.label}</span>
                </Button>
              </Tooltip>
            )
          })}
        </nav>
        <div className={css.utilityActions}>
          <Tooltip label={reminderAttention ? '提醒中心，有待处理提醒或通知异常' : '提醒中心'} side="bottom">
            <Button
              type="button"
              className={css.reminderButton}
              variant="toolbar"
              size="sm"
              aria-label={reminderAttention ? '提醒中心，有待处理提醒或通知异常' : '提醒中心'}
              title="提醒中心"
              data-active={view === 'reminders'}
              data-attention={reminderAttention}
              onClick={() => onChangeView('reminders')}
            >
              <ReminderBellIcon />
            </Button>
          </Tooltip>
          <Tooltip label="搜索" side="bottom">
            <Button type="button" variant="toolbar" size="sm" aria-label="搜索个人事项" title="搜索" onClick={onSearch}>
              <IconSearchOutline16 size={16} />
            </Button>
          </Tooltip>
          <Button type="button" variant="primary" size="sm" icon={<IconPlusOutline16 size={16} />} onClick={onCreate}>新建</Button>
          <Menu
            open={moreMenuOpen}
            anchor={(
              <Tooltip label="更多" side="bottom">
                <Button type="button" variant="toolbar" size="sm" aria-label="更多个人事项功能" title="更多" aria-haspopup="menu" aria-expanded={moreMenuOpen} onClick={() => setMoreMenuOpen((value) => !value)}>
                  <IconEllipsisOutline16 size={16} />
                </Button>
              </Tooltip>
            )}
            items={MORE_ITEMS}
            selectedId={view === 'trash' || view === 'data' ? view : undefined}
            onSelect={(id) => { setMoreMenuOpen(false); onChangeView(id as OrganizerView) }}
            onClose={() => setMoreMenuOpen(false)}
            align="end"
            portal
          />
          <Tooltip label="返回对话" side="bottom">
            <Button type="button" variant="toolbar" size="sm" aria-label="返回 DSH 对话" title="返回对话" onClick={onClose}>
              <IconCloseOutline16 size={16} />
            </Button>
          </Tooltip>
        </div>
      </div>
    </header>
  )
}

/** pinned DSH RC 没有 Bell/Clock 图标，提醒入口暂用插件内最小语义 glyph。 */
function ReminderBellIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 1.75a3.25 3.25 0 0 0-3.25 3.25v1.42c0 .65-.2 1.29-.58 1.82L3 10.25h10l-1.17-2.01a3.5 3.5 0 0 1-.58-1.82V5A3.25 3.25 0 0 0 8 1.75Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M6.25 12.25a1.9 1.9 0 0 0 3.5 0M2.25 10.25h11.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}
