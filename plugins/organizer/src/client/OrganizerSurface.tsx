import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { IconWarningOutline16, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ItemDraft,
  ItemLifecycleAction,
  ItemsQuery,
  OrganizerClientPort,
  OrganizerCommand,
  OrganizerCommandResult,
  OrganizerInitialIntent,
  OrganizerItem,
  OrganizerView,
} from './contracts.js'
import { ItemDrawer, type DrawerIssue, type DrawerState } from './ItemDrawer.js'
import { OrganizerHeader } from './OrganizerHeader.js'
import { OrganizerViews, UnavailableView } from './OrganizerViews.js'
import css from './OrganizerSurface.module.css'

type PendingAction =
  | { readonly type: 'drawer'; readonly state: DrawerState | null }
  | { readonly type: 'close-surface' }

export interface OrganizerSurfaceProps {
  /** 由 Host 提供的唯一 Organizer Client 端口。 */
  readonly port: OrganizerClientPort
  /** 打开工作面时携带的初始视图或抽屉意图。 */
  readonly initialIntent?: OrganizerInitialIntent
  /** 关闭 Product Surface 的宿主回调。 */
  readonly onClose: () => void
}

/** Organizer Product Surface；统一拥有视图、抽屉、草稿和未保存变更保护状态。 */
export function OrganizerSurface({ port, initialIntent, onClose }: OrganizerSurfaceProps) {
  const snapshot = useSyncExternalStore(port.subscribe, port.getSnapshot, port.getSnapshot)
  const [view, setView] = useState<OrganizerView>(initialIntent?.view ?? 'default')
  const [drawer, setDrawer] = useState<DrawerState | null>(initialIntent?.drawer ?? null)
  const [recentNotesOpen, setRecentNotesOpen] = useState(false)
  const [itemsQuery, setItemsQuery] = useState<ItemsQuery>({ type: 'items', kinds: [], statuses: [], tags: [], sort: 'default' })
  const [draft, setDraft] = useState<ItemDraft | undefined>(() => initialDraft(initialIntent?.drawer, snapshot))
  const [baseline, setBaseline] = useState<ItemDraft | undefined>(() => initialDraft(initialIntent?.drawer, snapshot))
  const [pending, setPending] = useState<PendingAction | undefined>()
  const [issue, setIssue] = useState<DrawerIssue | undefined>()
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ readonly id: number; readonly text: string } | undefined>()
  const workAreaRef = useRef<HTMLElement>(null)
  const scrollByView = useRef<Partial<Record<OrganizerView, number>>>({})
  const dirty = draft !== undefined && baseline !== undefined && JSON.stringify(draft) !== JSON.stringify(baseline)
  const selectedItem = drawer === null || drawer.mode === 'create' ? undefined : port.getItem(drawer.itemId)
  const reminderAttention = snapshot.reminders.notice !== undefined || snapshot.reminders.due.items.length > 0

  const showToast = useCallback((text: string) => {
    setToast((current) => ({ id: (current?.id ?? 0) + 1, text }))
  }, [])

  useLayoutEffect(() => {
    if (workAreaRef.current !== null) workAreaRef.current.scrollTop = scrollByView.current[view] ?? 0
  }, [view])

  useEffect(() => {
    if (port.refresh === undefined) return
    void port.refresh().catch((error: unknown) => {
      showToast(error instanceof Error ? error.message : '个人事项暂时无法加载')
    })
  }, [port, showToast])

  /** 切换视图并记住离开前的滚动位置。 */
  const changeView = (next: OrganizerView): void => {
    if (workAreaRef.current !== null) scrollByView.current[view] = workAreaRef.current.scrollTop
    setView(next)
  }

  /** 切换抽屉并根据目标事项初始化唯一草稿。 */
  const startDrawer = (next: DrawerState | null): void => {
    setIssue(undefined)
    setPending(undefined)
    setDrawer(next)
    const nextDraft = draftForState(next, snapshot)
    setDraft(nextDraft)
    setBaseline(nextDraft)
  }

  /** 对会丢失草稿的导航动作执行未保存变更保护。 */
  const requestAction = (action: PendingAction): void => {
    if (dirty && (drawer?.mode === 'edit' || drawer?.mode === 'create')) {
      setPending(action)
      return
    }
    applyPending(action)
  }

  /** 应用已经通过保护确认的导航动作。 */
  const applyPending = (action: PendingAction): void => {
    setPending(undefined)
    if (action.type === 'close-surface') {
      onClose()
      return
    }
    startDrawer(action.state)
  }

  /** 统一管理命令执行期间的 busy 状态。 */
  const runCommand = async (command: OrganizerCommand): Promise<OrganizerCommandResult> => {
    setBusy(true)
    try {
      return await port.execute(command)
    } finally {
      setBusy(false)
    }
  }

  /** 保存当前草稿，并把 conflict 转成抽屉内可处理的问题。 */
  const save = async (): Promise<boolean> => {
    if (draft === undefined) return false
    setIssue(undefined)
    const result = await runCommand({ type: 'save', draft })
    if (result.outcome === 'success' && result.item !== undefined) {
      showToast(result.message)
      setDrawer({ mode: 'view', itemId: result.item.id })
      setDraft(undefined)
      setBaseline(undefined)
      return true
    }
    if (result.outcome === 'conflict') {
      setIssue({ type: 'conflict', message: result.message, latest: result.latest })
      return false
    }
    setIssue({ type: 'error', message: result.message })
    return false
  }

  /** 完成一个待办并把失败显示在当前抽屉。 */
  const complete = async (item: OrganizerItem): Promise<void> => {
    const result = await runCommand({ type: 'complete', itemId: item.id, revision: item.revision })
    if (result.outcome === 'success') showToast(result.message)
    else setIssue({ type: 'error', message: result.message })
  }

  /** 保存列表内快速编辑的标题和正文。 */
  const saveQuickContent = async (item: OrganizerItem, title: string, detail: string): Promise<boolean> => {
    const current = port.getItem(item.id)
    if (current === undefined) return false
    const result = await runCommand({ type: 'save', draft: { ...draftFromItem(current), title, detail } })
    if (result.outcome === 'success') {
      showToast('待办内容已保存')
      return true
    }
    showToast(result.message)
    return false
  }

  /** 更新清单项并沿用当前事项 revision。 */
  const toggleChecklist = async (item: OrganizerItem, entryId: string, completed: boolean): Promise<boolean> => {
    const current = port.getItem(item.id)
    if (current === undefined || current.checklist === undefined) return false
    const result = await runCommand({
      type: 'save',
      draft: {
        ...draftFromItem(current),
        checklist: current.checklist.map((entry) => entry.id === entryId ? { ...entry, completed } : entry),
      },
    })
    if (result.outcome === 'success') {
      showToast('清单状态已更新')
      return true
    }
    showToast(result.message)
    return false
  }

  /** 执行当前事项的生命周期动作。 */
  const lifecycle = async (action: ItemLifecycleAction): Promise<void> => {
    if (selectedItem === undefined) return
    const result = await runCommand({ type: 'lifecycle', itemId: selectedItem.id, revision: selectedItem.revision, action })
    if (result.outcome === 'success') {
      showToast(result.message)
      if (action === 'trash') startDrawer(null)
    } else setIssue({ type: 'error', message: result.message })
  }

  /** 恢复当前回收站事项。 */
  const restore = async (): Promise<void> => {
    if (selectedItem === undefined) return
    const result = await runCommand({ type: 'restore', itemId: selectedItem.id, revision: selectedItem.revision })
    if (result.outcome === 'success') {
      showToast(result.message)
      startDrawer(null)
    } else setIssue({ type: 'error', message: result.message })
  }

  /** 永久删除当前回收站事项。 */
  const purge = async (): Promise<void> => {
    if (selectedItem === undefined) return
    const result = await runCommand({ type: 'purge', itemId: selectedItem.id, revision: selectedItem.revision })
    if (result.outcome === 'success') {
      showToast(result.message)
      startDrawer(null)
    } else setIssue({ type: 'error', message: result.message })
  }

  if (snapshot.availability === 'unavailable') {
    return (
      <div className={css.root} data-organizer-surface="unavailable">
        <OrganizerHeader view={view} reminderAttention={reminderAttention} onChangeView={changeView} onCreate={() => startDrawer({ mode: 'create' })} onSearch={() => changeView('search')} onClose={onClose} />
        <div className={css.body}>
          <UnavailableView message={snapshot.unavailableMessage ?? '个人事项当前不可用'} onRetry={() => showToast('已重新检查，服务仍不可用')} />
        </div>
        {toast !== undefined && <Toast key={toast.id} text={toast.text} icon={<IconWarningOutline16 size={16} />} onDone={() => setToast(undefined)} />}
      </div>
    )
  }

  return (
    <div className={css.root} data-organizer-surface="ready">
      <OrganizerHeader
        view={view}
        reminderAttention={reminderAttention}
        onChangeView={changeView}
        onCreate={() => requestAction({ type: 'drawer', state: { mode: 'create' } })}
        onSearch={() => changeView('search')}
        onClose={() => requestAction({ type: 'close-surface' })}
      />
      <div className={css.body}>
        <main ref={workAreaRef} className={css.workArea}>
          <OrganizerViews
            view={view}
            snapshot={snapshot}
            {...(selectedItem === undefined ? {} : { selectedItemId: selectedItem.id })}
            recentNotesOpen={recentNotesOpen}
            onToggleRecentNotes={() => setRecentNotesOpen((value) => !value)}
            onOpenItem={(itemId) => requestAction({ type: 'drawer', state: { mode: 'view', itemId } })}
            onComplete={(item) => { void complete(item) }}
            onQuickEdit={saveQuickContent}
            onChecklistToggle={toggleChecklist}
            onRequest={(query) => port.request(query)}
            itemsQuery={itemsQuery}
            onItemsQuery={(query) => {
              setItemsQuery(query)
              port.request(query)
            }}
          />
        </main>
        {drawer !== null && (
          <ItemDrawer
            state={drawer}
            {...(selectedItem === undefined ? {} : { item: selectedItem })}
            {...(draft === undefined ? {} : { draft })}
            dirty={dirty}
            busy={busy}
            guardActive={pending !== undefined}
            {...(issue === undefined ? {} : { issue })}
            onClose={() => requestAction({ type: 'drawer', state: null })}
            onEdit={() => {
              if (selectedItem === undefined) return
              startDrawer({ mode: 'edit', itemId: selectedItem.id })
            }}
            onCancelEdit={() => selectedItem === undefined
              ? requestAction({ type: 'drawer', state: null })
              : requestAction({ type: 'drawer', state: { mode: 'view', itemId: selectedItem.id } })}
            onDraftChange={setDraft}
            onSave={() => { void save() }}
            onComplete={() => { if (selectedItem !== undefined) void complete(selectedItem) }}
            onLifecycle={(action) => { void lifecycle(action) }}
            onRestore={() => { void restore() }}
            onPurge={() => { void purge() }}
            onGuardSave={() => {
              void save().then((saved) => {
                if (saved && pending !== undefined) applyPending(pending)
              })
            }}
            onGuardDiscard={() => { if (pending !== undefined) applyPending(pending) }}
            onGuardContinue={() => setPending(undefined)}
            onAcceptLatest={() => {
              if (issue?.type !== 'conflict') return
              setIssue(undefined)
              setDrawer({ mode: 'view', itemId: issue.latest.id })
              setDraft(undefined)
              setBaseline(undefined)
            }}
            onContinueFromLatest={() => {
              if (issue?.type !== 'conflict' || draft === undefined) return
              const next = { ...draft, revision: issue.latest.revision }
              setIssue(undefined)
              setDraft(next)
              setBaseline(draftFromItem(issue.latest))
            }}
          />
        )}
      </div>
      {toast !== undefined && <Toast key={toast.id} text={toast.text} onDone={() => setToast(undefined)} />}
    </div>
  )
}

/** 将投影事项转换为可编辑草稿，不修改原投影。 */
function draftFromItem(item: OrganizerItem): ItemDraft {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    detail: item.detail,
    tags: item.tags,
    pinned: item.pinned === true,
    priority: item.priority ?? 'none',
    checklist: item.checklist ?? [],
    todoStart: item.todoStart ?? { date: '', time: '' },
    todoDue: item.todoDue ?? { date: '', time: '' },
    eventTime: item.eventTime ?? emptyEventTime(),
    location: item.location ?? '',
    reminders: item.reminders,
    revision: item.revision,
  }
}

/** 根据初始意图和首个快照创建草稿。 */
function initialDraft(intent: OrganizerInitialIntent['drawer'] | undefined, snapshot: ReturnType<OrganizerClientPort['getSnapshot']>): ItemDraft | undefined {
  if (intent === undefined || intent.mode === 'view') return undefined
  if (intent.mode === 'create') return emptyDraft(intent.kind)
  const item = findItem(snapshot, intent.itemId)
  return item === undefined ? undefined : draftFromItem(item)
}

/** 根据抽屉状态从当前快照生成草稿。 */
function draftForState(state: DrawerState | null, snapshot: ReturnType<OrganizerClientPort['getSnapshot']>): ItemDraft | undefined {
  if (state === null || state.mode === 'view') return undefined
  if (state.mode === 'create') return emptyDraft(state.kind)
  const item = findItem(snapshot, state.itemId)
  return item === undefined ? undefined : draftFromItem(item)
}

/** 创建新事项的空草稿。 */
function emptyDraft(kind: ItemDraft['kind'] = ''): ItemDraft {
  return {
    kind,
    title: '',
    detail: '',
    tags: [],
    pinned: false,
    priority: 'none',
    checklist: [],
    todoStart: { date: '', time: '' },
    todoDue: { date: '', time: '' },
    eventTime: emptyEventTime(),
    location: '',
    reminders: [],
  }
}

/** 创建日程编辑器的默认空时间。 */
function emptyEventTime(): ItemDraft['eventTime'] {
  return { mode: 'timed', startDate: '', startTime: '', endDate: '', endTime: '', hasEnd: false }
}

/** 在所有当前投影中查找稳定身份对应的事项。 */
function findItem(snapshot: ReturnType<OrganizerClientPort['getSnapshot']>, id: string): OrganizerItem | undefined {
  const candidates = [
    ...snapshot.items.items,
    ...snapshot.defaultView.events.items,
    ...snapshot.defaultView.todos.items,
    ...snapshot.defaultView.notes.items,
    ...snapshot.today.overdue.items,
    ...snapshot.today.todos.items,
    ...snapshot.today.events.items,
    ...snapshot.calendar.list,
    ...snapshot.trash.items,
    ...snapshot.search.items,
  ]
  return candidates.find((item) => item.id === id)
}
