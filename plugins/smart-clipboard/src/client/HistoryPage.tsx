import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  IconCheckOutline16,
  IconCloseOutline16,
  IconCopyOutline16,
  IconListPenOutline16,
  IconPauseOutline16,
  IconPlayOutline16,
  IconWarningOutline16,
  Menu,
  Toast,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClipboardAction } from '../actions.js'
import type { ClipboardKind, HistoryFilter } from '../full-history.js'
import {
  getSmartClipboardApi,
  type ClipboardWireEntry,
  type SmartClipboardClientApi,
  type SmartClipboardSettings,
} from './api.js'
import { errorMessage, filterEntries, formatBytes, operationMessage } from './history-presenters.js'
import { HistoryWorkspace } from './HistoryWorkspace.js'
import { SettingsView } from './SettingsView.js'
import css from './HistoryPageShell.module.css'

type HistoryView = 'history' | 'trash' | 'settings'

const VIEW_LABELS: Record<HistoryView, string> = {
  history: 'History',
  trash: 'Trash',
  settings: '记录与数据',
}

const VIEW_ITEMS: readonly MenuEntry[] = [
  { id: 'history', label: 'History' },
  { id: 'trash', label: 'Trash' },
  { type: 'separator', id: 'separator-settings' },
  { id: 'settings', label: '记录与数据' },
]

/** 需要同时显示 Toast 和 aria-live 状态的操作反馈。 */
interface Feedback {
  /** 反馈序号，用于触发新的 Toast。 */
  readonly id: number
  /** 面向用户的反馈文案。 */
  readonly text: string
  /** 反馈严重程度。 */
  readonly tone: 'success' | 'warning' | 'error'
}

/** 获取 Host API 并在能力缺失时展示明确的不可用状态。 */
export function SmartClipboardHistoryPage({ onClose }: { readonly onClose?: () => void }): ReactNode {
  const api = getSmartClipboardApi()
  if (api === undefined) {
    return <UnavailableState reason="Core ClipboardBridge 不可用" {...(onClose === undefined ? {} : { onClose })} />
  }
  return <HistoryPageWithApi api={api} {...(onClose === undefined ? {} : { onClose })} />
}

/** 剪贴板历史主页面，统一拥有筛选、选择、设置和操作反馈状态。 */
export function HistoryPageWithApi({ api, onClose }: {
  /** Host 注入的安全 Client API。 */
  readonly api: SmartClipboardClientApi
  /** 返回 DSH 对话的宿主回调。 */
  readonly onClose?: () => void
}): ReactNode {
  const [view, setView] = useState<HistoryView>('history')
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<ClipboardKind | undefined>()
  const [sourceApplication, setSourceApplication] = useState('')
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [entries, setEntries] = useState<readonly ClipboardWireEntry[]>([])
  const [sources, setSources] = useState<readonly string[]>([])
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [narrowDetailOpen, setNarrowDetailOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<Feedback | undefined>()
  const [settings, setSettings] = useState<SmartClipboardSettings>()
  const [draftSettings, setDraftSettings] = useState<SmartClipboardSettings>()
  const [captureStatus, setCaptureStatus] = useState<Awaited<ReturnType<SmartClipboardClientApi['status']>>>()
  const loadSequence = useRef(0)

  const filter = useMemo<HistoryFilter>(() => ({
    ...(query.length === 0 ? {} : { query }),
    ...(kind === undefined ? {} : { kind }),
    ...(sourceApplication.length === 0 ? {} : { sourceApplication }),
    ...(pinnedOnly ? { pinnedOnly: true } : {}),
  }), [kind, pinnedOnly, query, sourceApplication])

  /** 并行加载列表、来源、设置和捕获状态，迟到响应不得覆盖新视图。 */
  const load = useCallback(async (): Promise<void> => {
    const sequence = ++loadSequence.current
    const allPromise = view === 'trash' ? api.trash() : api.list()
    const visiblePromise = view === 'history'
      ? api.list(filter)
      : view === 'trash'
        ? allPromise.then((all) => filterEntries(all, filter))
        : Promise.resolve<readonly ClipboardWireEntry[]>([])
    const [all, visible, loadedSettings, loadedStatus] = await Promise.all([
      allPromise,
      visiblePromise,
      api.settings(),
      api.status(),
    ])
    if (sequence !== loadSequence.current) return
    setEntries(visible)
    setSources([...new Set(all.map((entry) => entry.sourceApplication).filter((value): value is string => value !== null))].sort())
    setSelectedId((current) => visible.some((entry) => entry.id === current) ? current : undefined)
    setSettings(loadedSettings)
    setDraftSettings((current) => view === 'settings' && current !== undefined ? current : loadedSettings)
    setCaptureStatus(loadedStatus)
    setLoading(false)
  }, [api, filter, view])

  useEffect(() => {
    setLoading(true)
    void load().catch((cause: unknown) => {
      setLoading(false)
      setFeedback((current) => ({ id: (current?.id ?? 0) + 1, text: errorMessage(cause), tone: 'error' }))
    })
  }, [load])
  useEffect(() => api.observe(() => { void load() }), [api, load])

  const selected = useMemo(
    () => entries.find((entry) => entry.id === selectedId),
    [entries, selectedId],
  )

  const showFeedback = useCallback((text: string, tone: Feedback['tone'] = 'success'): void => {
    setFeedback((current) => ({ id: (current?.id ?? 0) + 1, text, tone }))
  }, [])

  /** 执行带统一成功/失败反馈和刷新动作的页面操作。 */
  const run = async (operation: () => Promise<unknown>, success: string): Promise<void> => {
    try {
      await operation()
      showFeedback(success)
      await load()
    } catch (cause) {
      showFeedback(errorMessage(cause), 'error')
    }
  }

  /** 执行当前选中记录的复制或粘贴动作。 */
  const execute = async (action: ClipboardAction): Promise<void> => {
    if (selected === undefined) return
    try {
      const result = await api.execute(selected.id, action, 'history')
      showFeedback(operationMessage(result), result.status === 'copy-only' ? 'warning' : result.status === 'unavailable' ? 'error' : 'success')
      await load()
    } catch (cause) {
      showFeedback(errorMessage(cause), 'error')
    }
  }

  /** 切换历史、废纸篓和设置视图，并清理不再适用的选择状态。 */
  const changeView = (next: HistoryView): void => {
    setViewMenuOpen(false)
    setView(next)
    setSelectedId(undefined)
    setNarrowDetailOpen(false)
    if (next === 'settings' && settings !== undefined) setDraftSettings(settings)
  }

  /** 清理非固定历史，危险操作必须先确认影响范围。 */
  const clearHistory = async (): Promise<void> => {
    const count = (await api.list()).filter((entry) => !entry.pinned).length
    if (count === 0) { showFeedback('没有可清空的未置顶历史', 'warning'); return }
    if (globalThis.confirm(`将永久删除 ${String(count)} 条未置顶历史，且不可恢复。是否继续？`)) {
      await run(() => api.clearHistory(), `已永久删除 ${String(count)} 条未置顶历史`)
    }
  }

  /** 永久清空废纸篓。 */
  const emptyTrash = async (): Promise<void> => {
    const count = (await api.trash()).length
    if (count === 0) { showFeedback('Trash 已经为空', 'warning'); return }
    if (globalThis.confirm(`将永久删除 Trash 中的 ${String(count)} 条记录，且不可恢复。是否继续？`)) {
      await run(() => api.emptyTrash(), `已永久删除 Trash 中的 ${String(count)} 条记录`)
    }
  }

  /** 永久清空全部剪贴板内容，但保留设置。 */
  const clearAllData = async (): Promise<void> => {
    const count = (await api.list()).length + (await api.trash()).length
    if (count === 0) { showFeedback('没有可清空的剪贴板内容', 'warning'); return }
    if (globalThis.confirm(`将永久删除全部 ${String(count)} 条剪贴板内容，设置会保留。是否继续？`)) {
      await run(() => api.clearAllData(), `已永久删除全部 ${String(count)} 条剪贴板内容`)
    }
  }

  /** 导出历史数据并将不可用结果保留为持久反馈。 */
  const exportData = async (includeTrash: boolean): Promise<void> => {
    try {
      const result = await api.exportData(includeTrash)
      showFeedback(result.status === 'exported'
        ? (includeTrash ? '已导出 History 和 Trash' : '已导出 History')
        : `未导出：${result.reason}`, result.status === 'exported' ? 'success' : 'error')
    } catch (cause) {
      showFeedback(errorMessage(cause), 'error')
    }
  }

  /** 提交设置草稿，并在成功后把 saved 与 draft 对齐。 */
  const saveSettings = async (): Promise<void> => {
    if (draftSettings === undefined) return
    try {
      const saved = await api.updateSettings({
        historyLimit: draftSettings.historyLimit,
        totalBytes: draftSettings.totalBytes,
        retention: draftSettings.retention,
        actionMapping: draftSettings.actionMapping,
        excludedApplications: draftSettings.excludedApplications,
        excludedKinds: draftSettings.excludedKinds,
      })
      setSettings(saved)
      setDraftSettings(saved)
      showFeedback('设置已保存')
      await load()
    } catch (cause) {
      showFeedback(errorMessage(cause), 'error')
    }
  }

  return (
    <section className={css.root} data-smart-clipboard-history="ready" aria-label="Clipboard History">
      <header className={css.header}>
        <div className={css.titleGroup}>
          <h1>剪贴板历史</h1>
          <p data-smart-clipboard-capture-status>{VIEW_LABELS[view]} · {captureStatusLabel(captureStatus, settings)}</p>
        </div>
        <div className={css.headerActions}>
          <Menu
            open={viewMenuOpen}
            anchor={(
              <Button type="button" variant="outline" size="sm" icon={<IconListPenOutline16 size={16} />} aria-haspopup="menu" aria-expanded={viewMenuOpen} onClick={() => setViewMenuOpen((value) => !value)}>
                查看
              </Button>
            )}
            items={VIEW_ITEMS}
            selectedId={view}
            onSelect={(id) => changeView(id as HistoryView)}
            onClose={() => setViewMenuOpen(false)}
            align="end"
            portal
          />
          {settings !== undefined && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              icon={settings.paused ? <IconPlayOutline16 size={16} /> : <IconPauseOutline16 size={16} />}
              onClick={() => { void run(() => api.setPaused(!settings.paused), settings.paused ? '已继续记录' : '已暂停记录') }}
            >
              {settings.paused ? '继续记录' : '暂停记录'}
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={() => { void run(() => api.ignoreNext(), '下一次复制将被忽略') }}>忽略下一次</Button>
          {onClose !== undefined && (
            <Button type="button" variant="toolbar" size="sm" aria-label="返回 DSH 对话" title="返回对话" onClick={onClose}>
              <IconCloseOutline16 size={16} />
            </Button>
          )}
        </div>
      </header>

      {captureStatus?.state === 'storage-full' && (
        <div className={css.persistentNotice} data-tone="warning" role="alert">
          <IconWarningOutline16 size={16} /><span>本地容量已被置顶内容占满。请在“记录与数据”中调整容量，或取消部分置顶。</span>
        </div>
      )}
      {captureStatus?.state === 'unavailable' && (
        <div className={css.persistentNotice} data-tone="error" role="alert">
          <IconWarningOutline16 size={16} /><span>当前无法捕获新的剪贴板内容：{captureStatus.reason}</span>
        </div>
      )}

      {view === 'settings'
        ? settings !== undefined && draftSettings !== undefined
          ? <SettingsView saved={settings} draft={draftSettings} onChange={setDraftSettings} onSave={() => { void saveSettings() }} onExport={(includeTrash) => { void exportData(includeTrash) }} onClearHistory={() => { void clearHistory().catch((cause: unknown) => showFeedback(errorMessage(cause), 'error')) }} onEmptyTrash={() => { void emptyTrash().catch((cause: unknown) => showFeedback(errorMessage(cause), 'error')) }} onClearAllData={() => { void clearAllData().catch((cause: unknown) => showFeedback(errorMessage(cause), 'error')) }} />
          : <div className={css.loadingPage}>正在读取设置…</div>
        : (
          <HistoryWorkspace
            view={view}
            entries={entries}
            selected={selected}
            query={query}
            kind={kind}
            sourceApplication={sourceApplication}
            pinnedOnly={pinnedOnly}
            sources={sources}
            loading={loading}
            narrowDetailOpen={narrowDetailOpen}
            onQueryChange={setQuery}
            onKindChange={setKind}
            onSourceChange={setSourceApplication}
            onPinnedOnlyChange={setPinnedOnly}
            onSelect={(id) => { setSelectedId(id); setNarrowDetailOpen(true) }}
            onBackToList={() => setNarrowDetailOpen(false)}
            onPin={(entry, pinned) => { void run(() => api.setPinned(entry.id, pinned), pinned ? '已置顶' : '已取消置顶') }}
            onAction={(action) => { void execute(action) }}
            onTrash={() => { if (selected !== undefined) void run(() => api.moveToTrash(selected.id), '已移入 Trash') }}
            onRestore={() => {
              if (selected === undefined) return
              void api.restore(selected.id).then(async (restored) => {
                showFeedback(restored === undefined ? '无法恢复：本地容量不足' : '已恢复', restored === undefined ? 'error' : 'success')
                await load()
              }).catch((cause: unknown) => showFeedback(errorMessage(cause), 'error'))
            }}
            onPermanentDelete={() => { if (selected !== undefined) void run(() => api.permanentlyDelete(selected.id), '已永久删除') }}
          />
        )}

      {feedback !== undefined && (
        <>
          <p className={css.srStatus} role="status" aria-live="polite">{feedback.text}</p>
          <Toast key={feedback.id} text={feedback.text} icon={feedback.tone === 'success' ? <IconCheckOutline16 size={16} /> : <IconWarningOutline16 size={16} />} onDone={() => setFeedback(undefined)} />
        </>
      )}
    </section>
  )
}

/** Host API 缺失时的明确不可用页面。 */
function UnavailableState({ reason, onClose }: {
  readonly reason: string
  readonly onClose?: () => void
}): ReactNode {
  return (
    <section className={css.unavailable} data-smart-clipboard-history="unavailable">
      <div>
        <IconWarningOutline16 size={24} />
        <h2>剪贴板历史不可用</h2>
        <p>{reason}。DSH 对话和其他功能不受影响。</p>
        {onClose !== undefined && <Button type="button" variant="outline" icon={<IconCopyOutline16 size={16} />} onClick={onClose}>返回对话</Button>}
      </div>
    </section>
  )
}

/** 将捕获状态和设置上限转换为页面标题摘要。 */
function captureStatusLabel(status: Awaited<ReturnType<SmartClipboardClientApi['status']>> | undefined, settings: SmartClipboardSettings | undefined): string {
  if (status?.state === 'storage-full') return '存储空间已满'
  if (status?.state === 'unavailable') return '捕获不可用'
  if (status?.state === 'paused' || settings?.paused === true) return `已暂停 · 上限 ${String(settings?.historyLimit ?? 0)} 条`
  return settings === undefined ? '正在连接' : `正在记录 · 上限 ${String(settings.historyLimit)} 条 · ${formatBytes(settings.totalBytes)}`
}
