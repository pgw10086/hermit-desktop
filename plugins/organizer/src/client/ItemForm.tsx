import { useState } from 'react'
import {
  Button,
  IconCloseOutline16,
  IconPlusOutline16,
  IconTrashOutline16,
  Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChecklistEntry, ItemDraft, ItemKind, OrganizerItem, ReminderRuleDraft, TemporalPoint } from './contracts.js'
import css from './ItemForm.module.css'

/** 编辑事项草稿；所有字段更新都回传给 Surface 持有的唯一草稿。 */
export function ItemForm({ draft, original, onChange }: {
  /** 当前编辑草稿。 */
  readonly draft: ItemDraft
  /** 正在编辑的原事项，创建模式下为空。 */
  readonly original?: OrganizerItem | undefined
  /** 提交草稿变更。 */
  readonly onChange: (draft: ItemDraft) => void
}) {
  const [tagInput, setTagInput] = useState('')
  const [checkInput, setCheckInput] = useState('')
  const set = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) => onChange({ ...draft, [key]: value })
  const addTag = () => {
    const tag = tagInput.trim()
    if (tag.length === 0 || draft.tags.includes(tag)) return
    set('tags', [...draft.tags, tag])
    setTagInput('')
  }
  const addCheck = () => {
    const text = checkInput.trim()
    if (text.length === 0) return
    set('checklist', [...draft.checklist, { id: `check-${String(draft.checklist.length + 1)}`, text, completed: false }])
    setCheckInput('')
  }
  return (
    <form className={css.form} onSubmit={(event) => event.preventDefault()}>
      {(original === undefined || original.kind === 'note') && (
        <section className={css.stack} aria-label="事项类型">
          <p className={css.sectionTitle}>类型</p>
          <div className={css.choiceRow}>
            {(['note', 'todo', 'event'] as const).map((kind) => (
              <Button key={kind} type="button" size="sm" variant={draft.kind === kind ? 'outline' : 'ghost'} disabled={original?.status === 'archived' && kind !== 'note'} onClick={() => set('kind', kind)}>
                {kindLabel(kind)}
              </Button>
            ))}
          </div>
          {original?.status === 'archived' && <p className={css.hint}>归档便签需先恢复使用，才能转换为待办或日程。</p>}
          {original?.kind === 'note' && draft.kind !== 'note' && original.status !== 'archived' && <p className={css.hint}>转换后保留标题、正文、标签、提醒和来源；便签置顶不会带入{draft.kind === 'todo' ? '待办' : '日程'}。</p>}
        </section>
      )}
      {original !== undefined && original.kind !== 'note' && (
        <section className={css.stack} aria-label="事项类型">
          <p className={css.sectionTitle}>类型</p>
          <p className={css.readonlyValue}>{kindLabel(original.kind)}</p>
        </section>
      )}

      <label className={css.field}>
        <span className={css.fieldLabel}>标题</span>
        <Input aria-label="标题" value={draft.title} onChange={(event) => set('title', event.currentTarget.value)} />
      </label>
      <label className={css.field}>
        <span className={css.fieldLabel}>{draft.kind === 'note' ? '正文' : '备注'}</span>
        <textarea className={css.textarea} aria-label={draft.kind === 'note' ? '正文' : '备注'} value={draft.detail} onChange={(event) => set('detail', event.currentTarget.value)} />
      </label>

      <section className={css.section}>
        <p className={css.sectionTitle}>标签</p>
        {draft.tags.length > 0 && (
          <div className={css.tagList} aria-label="已添加标签">
            {draft.tags.map((tag) => (
              <span key={tag} className={css.tag}>{tag}<button type="button" aria-label={`移除标签 ${tag}`} onClick={() => set('tags', draft.tags.filter((value) => value !== tag))}><IconCloseOutline16 size={14} /></button></span>
            ))}
          </div>
        )}
        <div className={css.inline}>
          <Input aria-label="新标签" placeholder="输入标签" value={tagInput} onChange={(event) => setTagInput(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag() } }} />
          <Button type="button" variant="outline" size="sm" icon={<IconPlusOutline16 size={16} />} onClick={addTag}>添加</Button>
        </div>
      </section>

      {draft.kind === 'note' && (
        <section className={css.section}>
          <label className={css.checkboxLabel}><input type="checkbox" checked={draft.pinned} onChange={(event) => set('pinned', event.currentTarget.checked)} />置顶这条便签</label>
        </section>
      )}
      {draft.kind === 'todo' && (
        <TodoFields draft={draft} onChange={onChange} checkInput={checkInput} onCheckInput={setCheckInput} onAddCheck={addCheck} />
      )}
      {draft.kind === 'event' && <EventFields draft={draft} onChange={onChange} />}
      {draft.kind !== '' && <ReminderFields draft={draft} onChange={onChange} />}
    </form>
  )
}

/** 待办专属字段，包括清单、优先级和日期。 */
function TodoFields({ draft, onChange, checkInput, onCheckInput, onAddCheck }: {
  readonly draft: ItemDraft
  readonly onChange: (draft: ItemDraft) => void
  readonly checkInput: string
  readonly onCheckInput: (value: string) => void
  readonly onAddCheck: () => void
}) {
  const updateCheck = (id: string, patch: Partial<ChecklistEntry>) => onChange({ ...draft, checklist: draft.checklist.map((entry) => entry.id === id ? { ...entry, ...patch } : entry) })
  return (
    <>
      <section className={css.section}>
        <p className={css.sectionTitle}>待办清单</p>
        {draft.checklist.map((entry) => (
          <div key={entry.id} className={css.checklistRow}>
            <input type="checkbox" aria-label={`完成清单项 ${entry.text}`} checked={entry.completed} onChange={(event) => updateCheck(entry.id, { completed: event.currentTarget.checked })} />
            <Input aria-label="清单项" value={entry.text} onChange={(event) => updateCheck(entry.id, { text: event.currentTarget.value })} />
            <Button type="button" variant="toolbar" size="sm" aria-label={`删除清单项 ${entry.text}`} title="删除" onClick={() => onChange({ ...draft, checklist: draft.checklist.filter((value) => value.id !== entry.id) })}><IconTrashOutline16 size={16} /></Button>
          </div>
        ))}
        <div className={css.inline}>
          <Input aria-label="新清单项" placeholder="添加一个清单项" value={checkInput} onChange={(event) => onCheckInput(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onAddCheck() } }} />
          <Button type="button" variant="outline" size="sm" icon={<IconPlusOutline16 size={16} />} onClick={onAddCheck}>添加</Button>
        </div>
        <p className={css.hint}>勾完全部清单项不会自动完成待办。</p>
      </section>
      <section className={css.section}>
        <p className={css.sectionTitle}>待办安排</p>
        <label className={css.field}><span className={css.fieldLabel}>优先级</span><select className={css.native} value={draft.priority} onChange={(event) => onChange({ ...draft, priority: event.currentTarget.value as ItemDraft['priority'] })}><option value="none">无</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
        <TemporalFields label="开始" value={draft.todoStart} onChange={(value) => onChange({ ...draft, todoStart: value })} />
        <TemporalFields label="截止" value={draft.todoDue} onChange={(value) => onChange({ ...draft, todoDue: value })} />
        <p className={css.hint}>开始和截止彼此独立；只填其中一个也可以。</p>
      </section>
    </>
  )
}

/** 日程专属时间和地点字段，明确区分全天与具体时刻。 */
function EventFields({ draft, onChange }: { readonly draft: ItemDraft; readonly onChange: (draft: ItemDraft) => void }) {
  const time = draft.eventTime
  const setTime = (patch: Partial<ItemDraft['eventTime']>) => onChange({ ...draft, eventTime: { ...time, ...patch } })
  const allDay = time.mode === 'all-day'
  const setAllDay = (checked: boolean) => {
    if (checked) {
      setTime({ mode: 'all-day', endDate: time.endDate || time.startDate })
      return
    }
    setTime({ mode: time.startTime.length > 0 ? 'timed' : 'date-only' })
  }
  return (
    <section className={css.section}>
      <div className={css.reminderHeader}><p className={css.sectionTitle}>日程时间</p><label className={css.switchLabel}><span>全天事件</span><input className={css.switchInput} role="switch" type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.currentTarget.checked)} /></label></div>
      <label className={css.field}><span className={css.fieldLabel}>开始日期</span><input className={css.native} type="date" value={time.startDate} onChange={(event) => setTime({ startDate: event.currentTarget.value, ...(allDay && time.endDate.length === 0 ? { endDate: event.currentTarget.value } : {}) })} /></label>
      {allDay
        ? <>
          <label className={css.field}><span className={css.fieldLabel}>结束日期</span><input className={css.native} type="date" value={time.endDate} onChange={(event) => setTime({ endDate: event.currentTarget.value })} /></label>
          <p className={css.hint}>全天事件覆盖所选日期，不保存具体时刻。</p>
        </>
        : <>
          <label className={css.field}><span className={css.fieldLabel}>开始时间</span><input className={css.native} type="time" value={time.startTime} onChange={(event) => setTime({ mode: 'timed', startTime: event.currentTarget.value })} /></label>
          <label className={css.checkboxLabel}><input type="checkbox" checked={time.hasEnd} onChange={(event) => setTime({ mode: 'timed', hasEnd: event.currentTarget.checked })} />设置结束时间</label>
          {time.hasEnd && <div className={css.inline}><label className={css.field}><span className={css.fieldLabel}>结束日期</span><input className={css.native} type="date" value={time.endDate} onChange={(event) => setTime({ mode: 'timed', endDate: event.currentTarget.value })} /></label><label className={css.field}><span className={css.fieldLabel}>结束时间</span><input className={css.native} type="time" value={time.endTime} onChange={(event) => setTime({ mode: 'timed', endTime: event.currentTarget.value })} /></label></div>}
          <p className={css.hint}>关闭全天事件后，填写开始时间即可安排具体时刻。</p>
        </>}
      <label className={css.field}><span className={css.fieldLabel}>地点</span><Input aria-label="地点" value={draft.location} onChange={(event) => onChange({ ...draft, location: event.currentTarget.value })} /></label>
    </section>
  )
}

/** 事项提醒规则编辑器，提醒只附着于当前事项。 */
function ReminderFields({ draft, onChange }: { readonly draft: ItemDraft; readonly onChange: (draft: ItemDraft) => void }) {
  const eventHasConcreteStart = draft.kind !== 'event' || draft.eventTime.mode === 'timed'
  const add = () => {
    const allDayDefault = draft.kind === 'event' && draft.eventTime.mode === 'all-day'
    const onlyTodoAnchor = draft.kind === 'todo'
      ? draft.todoStart.date.length > 0 && draft.todoDue.date.length === 0 ? 'todo-start' : draft.todoDue.date.length > 0 && draft.todoStart.date.length === 0 ? 'todo-due' : ''
      : ''
    const rule: ReminderRuleDraft = {
      id: `rule-${String(draft.reminders.length + 1)}`,
      mode: allDayDefault ? 'absolute' : 'relative',
      anchor: onlyTodoAnchor || (draft.kind === 'event' ? 'event-start' : ''),
      date: allDayDefault ? draft.eventTime.startDate : '',
      time: allDayDefault ? '08:00' : '',
      relation: 'before',
      amount: 15,
      unit: allDayDefault ? 'day' : 'minute',
    }
    onChange({ ...draft, reminders: [...draft.reminders, rule] })
  }
  const update = (id: string, patch: Partial<ReminderRuleDraft>) => onChange({ ...draft, reminders: draft.reminders.map((rule) => rule.id === id ? { ...rule, ...patch } : rule) })
  return (
    <section className={css.section}>
      <div className={css.reminderHeader}><p className={css.sectionTitle}>提醒</p><Button type="button" variant="ghost" size="sm" icon={<IconPlusOutline16 size={16} />} onClick={add}>添加提醒</Button></div>
      {draft.reminders.length === 0 && <p className={css.hint}>没有提醒。提醒只附着在当前事项上。</p>}
      {draft.reminders.map((rule) => (
        <div key={rule.id} className={css.rule}>
          <div className={css.reminderHeader}><select className={css.native} aria-label="提醒方式" value={rule.mode} onChange={(event) => update(rule.id, { mode: event.currentTarget.value as ReminderRuleDraft['mode'] })}><option value="absolute">指定时间提醒</option>{draft.kind !== 'note' && eventHasConcreteStart && <option value="relative">按事项时间提醒</option>}</select><Button type="button" variant="toolbar" size="sm" aria-label="删除提醒" title="删除" onClick={() => onChange({ ...draft, reminders: draft.reminders.filter((value) => value.id !== rule.id) })}><IconTrashOutline16 size={16} /></Button></div>
          {rule.mode === 'absolute'
            ? <div className={css.inline}><label className={css.field}><span className={css.fieldLabel}>日期</span><input className={css.native} type="date" value={rule.date} onChange={(event) => update(rule.id, { date: event.currentTarget.value })} /></label><label className={css.field}><span className={css.fieldLabel}>时间</span><input className={css.native} type="time" value={rule.time} onChange={(event) => update(rule.id, { time: event.currentTarget.value })} /></label></div>
            : <RelativeRule draft={draft} rule={rule} onChange={(patch) => update(rule.id, patch)} />}
          {rule.mode === 'relative' && <p className={css.hint}>会随着事项时间一起调整。</p>}
        </div>
      ))}
    </section>
  )
}

/** 编辑按事项时间计算的相对提醒。 */
function RelativeRule({ draft, rule, onChange }: { readonly draft: ItemDraft; readonly rule: ReminderRuleDraft; readonly onChange: (patch: Partial<ReminderRuleDraft>) => void }) {
  const kind = draft.kind
  const dateBased = kind === 'event' && draft.eventTime.mode !== 'timed'
    || kind === 'todo' && ((rule.anchor === 'todo-start' && draft.todoStart.time.length === 0) || (rule.anchor === 'todo-due' && draft.todoDue.time.length === 0))
  return (
    <div className={css.relativeRule}>
      <div className={css.inline}><span className={css.sentenceText}>在</span><select className={css.native} aria-label="提醒关联时间" value={rule.anchor} onChange={(event) => onChange({ anchor: event.currentTarget.value as ReminderRuleDraft['anchor'] })}><option value="">选择事项时间</option>{kind === 'todo' && <><option value="todo-start">待办开始</option><option value="todo-due">待办截止</option></>}{kind === 'event' && <option value="event-start">日程开始</option>}</select><span className={css.sentenceText}>前</span><input className={css.native} type="number" min="1" aria-label="提前数量" value={rule.amount} onChange={(event) => onChange({ amount: Math.max(1, Number(event.currentTarget.value)) })} /><select className={css.native} aria-label="提前单位" value={rule.unit} onChange={(event) => onChange({ unit: event.currentTarget.value as ReminderRuleDraft['unit'] })}>{dateBased ? <option value="day">天</option> : <><option value="minute">分钟</option><option value="hour">小时</option><option value="day">天</option></>}</select><span className={css.sentenceText}>提醒我</span></div>
    </div>
  )
}

/** 编辑一组日期和可选时间。 */
function TemporalFields({ label, value, onChange }: { readonly label: string; readonly value: TemporalPoint; readonly onChange: (value: TemporalPoint) => void }) {
  return <div className={css.inline}><label className={css.field}><span className={css.fieldLabel}>{label}日期</span><input className={css.native} type="date" value={value.date} onChange={(event) => onChange({ ...value, date: event.currentTarget.value })} /></label><label className={css.field}><span className={css.fieldLabel}>{label}时间</span><input className={css.native} type="time" value={value.time} disabled={value.date.length === 0} onChange={(event) => onChange({ ...value, time: event.currentTarget.value })} /></label></div>
}

/** 将事项类型转换为用户可见标签。 */
function kindLabel(kind: ItemKind): string { return kind === 'note' ? '便签' : kind === 'todo' ? '待办' : '日程' }

/** 判断草稿是否满足当前领域的最小保存条件。 */
export function draftCanSave(draft: ItemDraft | undefined): boolean {
  if (draft === undefined || draft.kind === '' || draft.title.trim().length === 0) return false
  if (draft.kind === 'event' && draft.eventTime.startDate.length === 0) return false
  if (draft.kind === 'event' && draft.eventTime.mode === 'timed' && draft.eventTime.startTime.length === 0) return false
  return draft.reminders.every((rule) => rule.mode === 'absolute' ? rule.date.length > 0 && rule.time.length > 0 : rule.anchor.length > 0 && rule.amount > 0)
}
