import { useState, type FormEvent, type ReactNode } from 'react'
import {
  Button,
  DisclosureRow,
  IconChecklistOutline14,
  IconSearchOutline16,
  IconWarningOutline16,
  Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ItemKind,
  ItemsQuery,
  OrganizerItem,
  OrganizerQuery,
  OrganizerSnapshot,
  OrganizerView,
  ReminderRow,
} from './contracts.js'
import { ItemList, LoadingRows } from './ItemList.js'
import css from './OrganizerSurface.module.css'
import filterCss from './ItemsFilter.module.css'

export interface OrganizerViewsProps {
  /** 当前视图身份。 */
  readonly view: OrganizerView
  /** Host 生成的统一投影快照。 */
  readonly snapshot: OrganizerSnapshot
  /** 当前选中事项身份。 */
  readonly selectedItemId?: string
  /** 最近便签区域是否展开。 */
  readonly recentNotesOpen: boolean
  /** 切换最近便签展开状态。 */
  readonly onToggleRecentNotes: () => void
  /** 打开事项详情抽屉。 */
  readonly onOpenItem: (itemId: string) => void
  /** 完成待办。 */
  readonly onComplete: (item: OrganizerItem) => void
  /** 保存列表内快速编辑内容。 */
  readonly onQuickEdit: (item: OrganizerItem, title: string, detail: string) => Promise<boolean>
  /** 切换清单项完成状态。 */
  readonly onChecklistToggle: (item: OrganizerItem, entryId: string, completed: boolean) => Promise<boolean>
  /** 提交搜索或回收站查询。 */
  readonly onRequest: (query: OrganizerQuery) => void
  /** 当前事项筛选条件。 */
  readonly itemsQuery: ItemsQuery
  /** 更新事项筛选条件。 */
  readonly onItemsQuery: (query: ItemsQuery) => void
}

/** 根据当前视图选择唯一的领域工作面，不复制快照或业务状态。 */
export function OrganizerViews(props: OrganizerViewsProps) {
  if (props.view === 'default') return <DefaultView {...props} />
  if (props.view === 'items') return <ItemsView {...props} />
  if (props.view === 'today') return <TodayView {...props} />
  if (props.view === 'calendar') return <CalendarView {...props} />
  if (props.view === 'search') return <SearchView {...props} />
  if (props.view === 'reminders') return <ReminderCenterView {...props} />
  if (props.view === 'trash') return <TrashView {...props} />
  return <DataView {...props} />
}

/** 展示近期日程、待办和最近便签的概览视图。 */
function DefaultView(props: OrganizerViewsProps) {
  return (
    <div className={css.content} data-organizer-view="default">
      <ViewHeading title="概览" detail="近期安排、未完成待办和最近便签" />
      <Notice value={props.snapshot.notice} />
      <div className={css.defaultGrid}>
        <Section title="近期安排">
          <ItemList
            projection={props.snapshot.defaultView.events}
            selectedItemId={props.selectedItemId}
            emptyLabel="未来 7 天没有安排"
            onOpen={props.onOpenItem}
          />
        </Section>
        <Section title="待办">
          <ItemList
            projection={props.snapshot.defaultView.todos}
            selectedItemId={props.selectedItemId}
            emptyLabel="没有未完成待办"
            onOpen={props.onOpenItem}
            onComplete={props.onComplete}
            onQuickEdit={props.onQuickEdit}
            onChecklistToggle={props.onChecklistToggle}
          />
        </Section>
      </div>
      <Section>
        <DisclosureRow
          icon={<IconChecklistOutline14 size={14} />}
          title="最近便签"
          open={props.recentNotesOpen}
          expandable
          expandOnRowClick
          onToggle={props.onToggleRecentNotes}
        >
          <ItemList
            projection={props.snapshot.defaultView.notes}
            selectedItemId={props.selectedItemId}
            emptyLabel="没有最近便签"
            onOpen={props.onOpenItem}
          />
        </DisclosureRow>
      </Section>
    </div>
  )
}

/** 展示可按类型、状态和标签筛选的事项列表。 */
function ItemsView(props: OrganizerViewsProps) {
  const query = props.itemsQuery
  const tags = Array.from(new Set([
    ...props.snapshot.defaultView.events.items,
    ...props.snapshot.defaultView.todos.items,
    ...props.snapshot.defaultView.notes.items,
    ...props.snapshot.items.items,
  ].flatMap((item) => item.tags))).sort()
  const toggle = <T extends string>(values: readonly T[], value: T): readonly T[] => values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value]
  const update = (patch: Partial<ItemsQuery>) => props.onItemsQuery({ ...query, ...patch, type: 'items' })
  const filtered = query.kinds.length > 0 || query.statuses.length > 0 || query.tags.length > 0
  return (
    <div className={css.content} data-organizer-view="items">
      <ViewHeading title="全部事项" detail="便签、待办和日程在同一列表中筛选" />
      <Notice value={props.snapshot.notice} />
      <div className={filterCss.panel} aria-label="事项筛选">
        <FilterGroup label="类型" values={query.kinds} options={([['note', '便签'], ['todo', '待办'], ['event', '日程']] as const)} onToggle={(value) => update({ kinds: toggle(query.kinds, value as ItemKind) })} />
        <FilterGroup label="状态" values={query.statuses} options={([['active', '记录中'], ['planned', '计划中'], ['scheduled', '已安排'], ['completed', '已完成'], ['archived', '已归档'], ['cancelled', '已取消']] as const)} onToggle={(value) => update({ statuses: toggle(query.statuses, value) })} />
        <FilterGroup label="标签" values={query.tags} options={tags.map((tag) => [tag, tag] as const)} onToggle={(value) => update({ tags: toggle(query.tags, value) })} />
        <label className={filterCss.sort}>排序<select aria-label="排序" value={query.sort} onChange={(event) => update({ sort: event.currentTarget.value as ItemsQuery['sort'] })}><option value="default">当前事项优先</option><option value="updated">按更新时间</option></select></label>
      </div>
      {filtered && <div className={filterCss.footer}><Button type="button" variant="ghost" size="sm" onClick={() => update({ kinds: [], statuses: [], tags: [] })}>清除筛选</Button></div>}
      <Section>
        <ItemList
          projection={props.snapshot.items}
          selectedItemId={props.selectedItemId}
          emptyLabel={filtered ? '当前条件没有匹配事项' : '还没有事项'}
          onOpen={props.onOpenItem}
          onComplete={props.onComplete}
          onQuickEdit={props.onQuickEdit}
          onChecklistToggle={props.onChecklistToggle}
        />
      </Section>
    </div>
  )
}

/** 展示逾期、今日待办、日程和提醒投影。 */
function TodayView(props: OrganizerViewsProps) {
  return (
    <div className={css.content} data-organizer-view="today">
      <ViewHeading title="今天" detail="逾期待办、今天待办、今天日程和今天提醒" />
      <Notice value={props.snapshot.notice} />
      <div className={css.todayGrid}>
        <Section title="逾期待办">
          <ItemList projection={props.snapshot.today.overdue} selectedItemId={props.selectedItemId} emptyLabel="没有逾期待办" onOpen={props.onOpenItem} onComplete={props.onComplete} onQuickEdit={props.onQuickEdit} onChecklistToggle={props.onChecklistToggle} />
        </Section>
        <Section title="今天待办">
          <ItemList projection={props.snapshot.today.todos} selectedItemId={props.selectedItemId} emptyLabel="今天没有待办" onOpen={props.onOpenItem} onComplete={props.onComplete} onQuickEdit={props.onQuickEdit} onChecklistToggle={props.onChecklistToggle} />
        </Section>
        <Section title="今天日程">
          <ItemList projection={props.snapshot.today.events} selectedItemId={props.selectedItemId} emptyLabel="今天没有日程" onOpen={props.onOpenItem} />
        </Section>
        <Section title="今天提醒">
          <ReminderList projection={props.snapshot.today.reminders} onOpen={props.onOpenItem} />
        </Section>
      </div>
    </div>
  )
}

/** 展示按周或列表模式查看的日程投影。 */
function CalendarView(props: OrganizerViewsProps) {
  const [mode, setMode] = useState<'week' | 'list'>('week')
  const calendar = props.snapshot.calendar
  return (
    <div className={css.content} data-organizer-view="calendar">
      <div className={css.viewHeading}>
        <div>
          <h2>日历</h2>
          <p>{calendar.rangeLabel}</p>
        </div>
        <div className={css.segmented} aria-label="日历显示方式">
          <button type="button" className={css.segmentButton} aria-pressed={mode === 'week'} onClick={() => setMode('week')}>周</button>
          <button type="button" className={css.segmentButton} aria-pressed={mode === 'list'} onClick={() => setMode('list')}>列表</button>
        </div>
      </div>
      <Notice value={props.snapshot.notice} />
      {calendar.state === 'loading'
        ? <LoadingRows />
        : calendar.state === 'empty'
          ? <p className={css.emptyText}>当前日期范围没有日程</p>
          : mode === 'list'
            ? (
              <ItemList
                projection={{ state: calendar.state, items: calendar.list, ...(calendar.message === undefined ? {} : { message: calendar.message }) }}
                selectedItemId={props.selectedItemId}
                emptyLabel="当前日期范围没有日程"
                onOpen={props.onOpenItem}
              />
            )
            : (
              <div className={css.calendarScroll}>
                <div className={css.calendarGrid}>
                  {calendar.days.map((day) => (
                    <section key={day.id} className={css.calendarDay} data-today={day.isToday === true}>
                      <div className={css.calendarDate}><span>周{day.weekday}</span><strong>{day.date}</strong></div>
                      {day.items.map((item) => (
                        <button key={item.id} type="button" className={css.calendarEvent} onClick={() => props.onOpenItem(item.id)}>
                          {item.timeLabel}<br />{item.title}
                        </button>
                      ))}
                    </section>
                  ))}
                </div>
              </div>
            )}
    </div>
  )
}

/** 提交搜索词并展示 Host 返回的搜索投影。 */
function SearchView(props: OrganizerViewsProps) {
  const [query, setQuery] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    props.onRequest({ type: 'search', query })
  }
  return (
    <div className={css.content} data-organizer-view="search">
      <ViewHeading title="搜索" detail="查找所有未移入回收站的便签、待办和日程" />
      <form className={css.searchForm} onSubmit={submit}>
        <Input
          aria-label="搜索内容"
          icon={<IconSearchOutline16 size={16} />}
          placeholder="输入标题或内容"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <Button type="submit" variant="primary">搜索</Button>
      </form>
      {query.length === 0 && props.snapshot.search.items.length === 0
        ? <p className={css.emptyText}>输入内容后开始搜索</p>
        : (
          <ItemList
            projection={props.snapshot.search}
            selectedItemId={props.selectedItemId}
            emptyLabel="没有匹配事项"
            onOpen={props.onOpenItem}
            onComplete={props.onComplete}
            onQuickEdit={props.onQuickEdit}
            onChecklistToggle={props.onChecklistToggle}
          />
        )}
    </div>
  )
}

/** 展示待处理、即将到来和历史提醒。 */
function ReminderCenterView(props: OrganizerViewsProps) {
  return (
    <div className={css.content} data-organizer-view="reminders">
      <ViewHeading title="提醒中心" detail="处理已到期、即将到来和历史提醒" />
      <Notice value={props.snapshot.reminders.notice ?? props.snapshot.notice} />
      <Section title="待处理">
        <ReminderList projection={props.snapshot.reminders.due} onOpen={props.onOpenItem} showActions />
      </Section>
      <Section title="即将到来">
        <ReminderList projection={props.snapshot.reminders.upcoming} onOpen={props.onOpenItem} showActions />
      </Section>
      <Section title="历史">
        <ReminderList projection={props.snapshot.reminders.history} onOpen={props.onOpenItem} />
      </Section>
    </div>
  )
}

/** 展示回收站事项并提交回收站查询。 */
function TrashView(props: OrganizerViewsProps) {
  const [query, setQuery] = useState('')
  return (
    <div className={css.content} data-organizer-view="trash">
      <ViewHeading title="回收站" detail="查看、恢复或永久删除已移除的事项" />
      <form className={css.searchForm} onSubmit={(event) => { event.preventDefault(); props.onRequest({ type: 'trash', query }) }}>
        <Input aria-label="搜索回收站" icon={<IconSearchOutline16 size={16} />} placeholder="搜索已删除事项" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
        <Button type="submit" variant="outline">搜索</Button>
      </form>
          <ItemList projection={props.snapshot.trash} selectedItemId={props.selectedItemId} emptyLabel={query.length > 0 ? '回收站中没有匹配事项' : '回收站为空'} onOpen={props.onOpenItem} />
    </div>
  )
}

/** 展示数据导入导出入口；当前只保留能力不可用的明确状态。 */
function DataView(_props: OrganizerViewsProps) {
  const [mode, setMode] = useState<'import' | 'export'>('import')
  const [format, setFormat] = useState<'json' | 'csv' | 'ics'>('json')
  return (
    <div className={css.content} data-organizer-view="data">
      <ViewHeading title="导入与导出" detail="使用原生 JSON、Todo CSV 或 Event ICS" />
      <div className={css.dataLayout}>
        <nav className={css.dataNav} aria-label="数据操作">
          <Button type="button" variant={mode === 'import' ? 'outline' : 'ghost'} onClick={() => setMode('import')}>导入</Button>
          <Button type="button" variant={mode === 'export' ? 'outline' : 'ghost'} onClick={() => setMode('export')}>导出</Button>
        </nav>
        <section className={css.dataPanel}>
          <h3>{mode === 'import' ? '选择导入格式' : '选择导出格式'}</h3>
          <p className={css.muted}>{mode === 'import' ? '导入前会先解析和预览，只有最终确认后才写入。' : '导出前会显示范围和无法无损表达的内容。'}</p>
          <div className={css.fieldGrid}>
            <label className={css.field}>
              <span>格式</span>
              <select className={css.nativeControl} value={format} onChange={(event) => setFormat(event.currentTarget.value as 'json' | 'csv' | 'ics')}>
                <option value="json">原生 JSON</option>
                <option value="csv">Todo CSV</option>
                <option value="ics">Event ICS</option>
              </select>
            </label>
            <div className={css.inlineActions}>
              <Button type="button" variant="primary" disabled title="将在第三包原型中启用">
                {mode === 'import' ? '选择文件并预览' : '生成导出预览'}
              </Button>
            </div>
            <Notice value={{ tone: 'info', title: '本轮暂不可操作', detail: '导入、导出和冲突处理将在第三包“边界流程与 DSH”中一起验收。' }} />
          </div>
        </section>
      </div>
    </div>
  )
}

/** 将提醒投影渲染为可打开事项的列表。 */
function ReminderList({ projection, onOpen, showActions = false }: {
  readonly projection: { readonly state: string; readonly items: readonly ReminderRow[]; readonly message?: string }
  readonly onOpen: (itemId: string) => void
  readonly showActions?: boolean
}) {
  if (projection.state === 'loading') return <LoadingRows />
  if (projection.items.length === 0) return <p className={css.emptyText}>没有需要显示的提醒</p>
  return (
    <ul className={css.list}>
      {projection.items.map((row) => (
        <li key={row.id} className={css.reminderRow}>
          <div>
            <p className={css.reminderTitle}>{row.title}</p>
            <p className={css.reminderMeta}>{row.timeLabel} · {row.stateLabel} · {row.detail}</p>
          </div>
          <div className={css.inlineActions}>
            {showActions && <Button type="button" variant="ghost" size="sm" disabled title="将在第二包原型中启用">稍后提醒</Button>}
            <Button type="button" variant="outline" size="sm" onClick={() => onOpen(row.itemId)}>打开</Button>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** 渲染一个受控多选筛选组。 */
function FilterGroup({ label, values, options, onToggle }: {
  readonly label: string
  readonly values: readonly string[]
  readonly options: readonly (readonly [string, string])[]
  readonly onToggle: (value: string) => void
}) {
  return (
    <fieldset className={filterCss.group}>
      <legend>{label}</legend>
      {options.map(([value, text]) => <label key={value} className={filterCss.option}><input type="checkbox" checked={values.includes(value)} onChange={() => onToggle(value)} />{text}</label>)}
    </fieldset>
  )
}

/** 渲染统一的视图标题和辅助说明。 */
function ViewHeading({ title, detail }: { readonly title: string; readonly detail: string }) {
  return (
    <div className={css.viewHeading}>
      <div>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
    </div>
  )
}

/** 提供连续工作面中的语义区块容器。 */
function Section({ title, children }: { readonly title?: string; readonly children: ReactNode }) {
  return (
    <section className={css.section}>
      {title !== undefined && <div className={css.sectionHeader}><h3>{title}</h3></div>}
      {children}
    </section>
  )
}

/** 展示需要持续处理的提示，不用 Toast 替代持久状态。 */
export function Notice({ value }: { readonly value?: { readonly tone: string; readonly title: string; readonly detail: string } | undefined }) {
  if (value === undefined) return null
  return (
    <div className={css.notice} data-tone={value.tone} role={value.tone === 'error' ? 'alert' : 'status'}>
      <div>
        <p className={css.noticeTitle}>{value.title}</p>
        <p className={css.noticeDetail}>{value.detail}</p>
      </div>
    </div>
  )
}

/** 宿主能力不可用时展示明确结果和重试入口。 */
export function UnavailableView({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) {
  return (
    <div className={css.unavailable} data-organizer-view="unavailable">
      <div className={css.unavailableContent}>
        <IconWarningOutline16 size={24} />
        <h2>个人事项当前不可用</h2>
        <p>{message}</p>
        <Button type="button" variant="outline" onClick={onRetry}>重试</Button>
      </div>
    </div>
  )
}
