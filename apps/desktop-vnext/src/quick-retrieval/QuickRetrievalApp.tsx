import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { actionAvailable, actionLabel, DEFAULT_ACTION_MAPPING, type ActionMapping, type ClipboardAction } from '@hermit/smart-clipboard/actions'
import type { ClipboardOperationResult, ClipboardWireEntry, SmartClipboardClientApi } from '@hermit/smart-clipboard/client-api'
import css from './QuickRetrievalApp.module.css'

declare global {
  interface Window {
    /** Quick Panel preload 注入的安全剪贴板 Client API。 */
    readonly hermitSmartClipboard?: SmartClipboardClientApi
  }
}

/** 快速取回入口；能力缺失时保持窗口可用并显示明确状态。 */
export function QuickRetrievalApp(): ReactNode {
  const api = window.hermitSmartClipboard
  if (api === undefined) return <UnavailableQuickRetrieval />
  return <ConnectedQuickRetrieval api={api} />
}

/** 快速取回工作面，统一拥有筛选、选择、预览和键盘交互状态。 */
function ConnectedQuickRetrieval({ api }: { readonly api: SmartClipboardClientApi }): ReactNode {
  const [entries, setEntries] = useState<readonly ClipboardWireEntry[]>([])
  const [mapping, setMapping] = useState<ActionMapping>(DEFAULT_ACTION_MAPPING)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [paused, setPaused] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewPlacement, setPreviewPlacement] = useState<'left' | 'right'>('right')
  const [sessionOpen, setSessionOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const selectedRef = useRef<HTMLButtonElement | null>(null)
  const previewOpenRef = useRef(false)
  const previewRequestRef = useRef(0)
  const visible = useMemo(() => filterEntries(entries, query), [entries, query])
  const safeIndex = visible.length === 0 ? 0 : Math.min(selectedIndex, visible.length - 1)
  const selected = visible[safeIndex]

  /** 并行刷新历史、设置和捕获状态，返回当前历史条数供窗口布局使用。 */
  const refresh = useCallback(async (): Promise<number> => {
    try {
      const [loadedEntries, settings, capture] = await Promise.all([api.list(), api.settings(), api.status()])
      setEntries(loadedEntries)
      setMapping(settings.actionMapping)
      setPaused(settings.paused)
      setStatus(captureMessage(capture))
      return loadedEntries.length
    } catch (cause) {
      setStatus(errorMessage(cause))
      return 0
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    void refresh()
    return api.observe(() => { void refresh() })
  }, [api, refresh])

  useLayoutEffect(() => {
    /** 每次打开都清理上次预览和搜索状态，再重新读取最新历史。 */
    const show = (): void => {
      previewRequestRef.current += 1
      previewOpenRef.current = false
      setPreviewOpen(false)
      setPreviewPlacement('right')
      setSessionOpen(true)
      setQuery('')
      setSelectedIndex(0)
      setStatus('')
      setLoading(true)
      void api.setQuickPanelLayout({ rows: 8, previewOpen: false }).catch(() => undefined)
      void refresh().then((count) => api.setQuickPanelLayout({ rows: rowCount(count), previewOpen: false })).then(() => searchRef.current?.focus())
    }
    window.addEventListener('hermit-smart-clipboard-show', show)
    return () => window.removeEventListener('hermit-smart-clipboard-show', show)
  }, [api, refresh])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [safeIndex])

  useEffect(() => {
    const requestId = ++previewRequestRef.current
    if (!sessionOpen || selected === undefined) {
      if (previewOpenRef.current) {
        previewOpenRef.current = false
        setPreviewOpen(false)
        void api.setQuickPanelLayout({ rows: rowCount(entries.length), previewOpen: false }).catch(() => undefined)
      }
      return
    }
    if (previewOpenRef.current) return
    const timer = setTimeout(() => {
      void api.setQuickPanelLayout({ rows: rowCount(entries.length), previewOpen: true }).then(({ placement }) => {
        if (previewRequestRef.current !== requestId) return
        previewOpenRef.current = true
        setPreviewPlacement(placement)
        setPreviewOpen(true)
      }).catch((cause: unknown) => {
        if (previewRequestRef.current === requestId) setStatus(errorMessage(cause))
      })
    }, 400)
    return () => {
      clearTimeout(timer)
      previewRequestRef.current += 1
    }
  }, [api, entries.length, previewOpen, selected, sessionOpen])

  /** 关闭预览和 Quick Panel，并撤销当前布局请求。 */
  const closePanel = (): void => {
    previewRequestRef.current += 1
    const wasOpen = sessionOpen
    previewOpenRef.current = false
    setPreviewOpen(false)
    setSessionOpen(false)
    void api.setQuickPanelLayout({ rows: rowCount(entries.length), previewOpen: false }).catch(() => undefined)
    if (wasOpen) api.closeQuickPanel()
  }

  /** 执行动作；鼠标点击显式传入目标，避免等待 selectedIndex 异步更新后误用旧行。 */
  const execute = async (action: ClipboardAction, target: ClipboardWireEntry | undefined = selected): Promise<void> => {
    if (target === undefined) return
    if (!actionAvailable(action, target.kind)) {
      setStatus('纯文本复制只支持文本记录')
      return
    }
    try {
      const result = await api.execute(target.id, action, 'quick-panel')
      setStatus(operationMessage(result))
      if (result.status === 'copied' || result.status === 'pasted' || result.status === 'copy-only') closePanel()
    } catch (cause) {
      setStatus(errorMessage(cause))
    }
  }

  /** 将上下键、Escape 和 Enter 映射为选择、关闭和 Maccy 式快捷动作。 */
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' && visible.length > 0) {
      event.preventDefault()
      setSelectedIndex((index) => (index + 1) % visible.length)
    } else if (event.key === 'ArrowUp' && visible.length > 0) {
      event.preventDefault()
      setSelectedIndex((index) => (index - 1 + visible.length) % visible.length)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closePanel()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const action = event.shiftKey
        ? mapping['Shift+Enter']
        : event.altKey || event.metaKey || event.ctrlKey
          ? mapping['Mod+Enter']
          : mapping.Enter
      void execute(action)
    }
  }

  return (
    <main className={css.root} data-smart-clipboard-quick-panel="ready" data-has-preview={previewOpen && selected !== undefined} data-preview-placement={previewPlacement} role="dialog" aria-label="快速取回剪贴板">
      <div className={css.searchBar}>
        <span className={css.searchIcon} aria-hidden="true">⌕</span>
        <input
          ref={searchRef}
          autoFocus
          type="search"
          autoComplete="off"
          aria-label="搜索剪贴板历史"
          placeholder="搜索剪贴板历史"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
        {query.length > 0 && <button type="button" className={css.clearButton} aria-label="清空搜索" onClick={() => setQuery('')}>×</button>}
        {paused && <span className={css.pausedBadge}>已暂停</span>}
      </div>

      <section className={css.results} aria-label="快速取回结果">
        <div className={css.list} role="listbox">
          {loading
            ? <LoadingList />
            : visible.length === 0
              ? <div className={css.empty}><strong>没有匹配记录</strong><span>换一个关键词，或打开完整 History。</span></div>
              : visible.map((entry, index) => (
                <QuickRow
                  key={entry.id}
                  ref={index === safeIndex ? selectedRef : undefined}
                  entry={entry}
                  selected={index === safeIndex}
                  onPointerDown={() => setSelectedIndex(index)}
                  onPrimaryAction={(paste) => {
                    setSelectedIndex(index)
                    void execute(paste ? mapping['Mod+Enter'] : mapping.Enter, entry)
                  }}
                  onPreview={() => { setSelectedIndex(index) }}
                />
              ))}
        </div>
        {previewOpen && selected !== undefined && <QuickPreview entry={selected} />}
      </section>

      <footer className={css.footer}>
        {status.length > 0
          ? <span className={css.status} role="status" aria-live="polite">{status}</span>
          : <span className={css.shortcuts}>↵ {shortActionLabel(mapping.Enter)} · {pasteModifierLabel()}↵ {shortActionLabel(mapping['Mod+Enter'])} · ⇧↵ {shortActionLabel(mapping['Shift+Enter'])}</span>}
        <button type="button" className={css.historyButton} onClick={() => { closePanel(); api.openHistory() }}>完整历史 ›</button>
      </footer>
    </main>
  )
}

interface QuickRowProps {
  /** 当前安全投影记录。 */
  readonly entry: ClipboardWireEntry
  /** 是否为当前键盘选中项。 */
  readonly selected: boolean
  /** 鼠标选择回调。 */
  readonly onPointerDown: () => void
  /** 左键执行当前记录；paste 表示用户明确按下 Option。 */
  readonly onPrimaryAction: (paste: boolean) => void
  /** 右键打开已有的贴靠预览，不执行内容动作。 */
  readonly onPreview: () => void
}

/** 快速取回列表项；左键执行，右键复用现有贴靠预览。 */
const QuickRow = forwardRef<HTMLButtonElement, QuickRowProps>((props, ref) => (
  <button
    ref={ref}
    type="button"
    className={css.row}
    role="option"
    aria-selected={props.selected}
    onMouseDown={(event) => {
      if (event.button === 0) {
        event.preventDefault()
        props.onPointerDown()
      } else if (event.button === 2) {
        // 先在 secondary click 到达前选中记录，确保已有预览不会被原生菜单时序延迟。
        props.onPreview()
      }
    }}
    onClick={(event) => props.onPrimaryAction(event.altKey)}
    onContextMenu={(event) => {
      event.preventDefault()
      props.onPreview()
    }}
  >
    <span className={css.kindMark}>{kindMark(props.entry.kind)}</span>
    <span className={css.rowContent}>
      <strong>{summary(props.entry)}</strong>
      <small>{props.entry.sourceApplication ?? '未知来源'} · {formatTime(props.entry.lastUsedAt)}</small>
    </span>
    {props.entry.pinned && <span className={css.pinned} aria-label="已置顶">★</span>}
  </button>
))
QuickRow.displayName = 'QuickRow'

/** 当前记录预览，只消费 Host 提供的安全投影。 */
function QuickPreview({ entry }: { readonly entry: ClipboardWireEntry }): ReactNode {
  return (
    <aside className={css.preview} aria-label="当前记录预览">
      <header><span>{kindLabel(entry.kind)}</span><time dateTime={new Date(entry.lastUsedAt).toISOString()}>{formatTime(entry.lastUsedAt)}</time></header>
      <div className={css.previewContent}>
        {entry.kind === 'TEXT' && <pre>{entry.text.slice(0, 1200)}</pre>}
        {entry.kind === 'IMAGE' && <figure><img src={entry.previewUrl} alt="图片预览" /><figcaption>{entry.width} × {entry.height}</figcaption></figure>}
        {entry.kind === 'FILE_LIST' && (
          <ol>{entry.items.slice(0, 10).map((item, index) => <li key={`${String(index)}:${item.path}`} data-missing={!item.exists}><strong>{item.displayName}</strong><span>{item.exists ? item.path : '文件已不存在'}</span></li>)}</ol>
        )}
      </div>
    </aside>
  )
}

/** 历史加载期间的稳定占位列表。 */
function LoadingList(): ReactNode {
  return <div className={css.loading} aria-label="正在读取剪贴板历史"><span /><span /><span /></div>
}

/** Smart Clipboard 能力缺失时的明确 Quick Panel 状态。 */
function UnavailableQuickRetrieval(): ReactNode {
  return <main className={css.unavailable} data-smart-clipboard-quick-panel="unavailable"><strong>Smart Clipboard 当前不可用</strong><span>完整 History 和系统剪贴板不受此窗口影响。</span></main>
}

/** 按文本或文件列表名称筛选安全投影。 */
function filterEntries(entries: readonly ClipboardWireEntry[], query: string): readonly ClipboardWireEntry[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (normalized.length === 0) return entries
  return entries.filter((entry) => {
    if (entry.kind === 'TEXT') return entry.text.toLocaleLowerCase().includes(normalized)
    if (entry.kind === 'FILE_LIST') return entry.items.some((item) => item.displayName.toLocaleLowerCase().includes(normalized) || item.path.toLocaleLowerCase().includes(normalized))
    return false
  })
}

/** 生成列表摘要，不把大段正文直接放入行布局。 */
function summary(entry: ClipboardWireEntry): string {
  if (entry.kind === 'TEXT') return entry.text.replace(/\s+/gu, ' ').trim().slice(0, 100)
  if (entry.kind === 'IMAGE') return `图片 · ${entry.width} × ${entry.height}`
  return `${entry.items[0]?.displayName ?? '文件列表'}${entry.items.length > 1 ? ` +${String(entry.items.length - 1)}` : ''}`
}

/** 将平台执行结果转换为快速取回状态文案。 */
function operationMessage(result: ClipboardOperationResult): string {
  if (result.status === 'copied') return '已复制到系统剪贴板'
  if (result.status === 'pasted') return '已复制并尝试粘贴'
  if (result.status === 'copy-only') return `已复制，请手工粘贴：${result.reason}`
  return `操作不可用：${result.reason}`
}

/** 将捕获状态转换为窗口底部提示。 */
function captureMessage(status: Awaited<ReturnType<SmartClipboardClientApi['status']>>): string {
  if (status.state === 'storage-full') return '本地容量已满，请在完整 History 中管理置顶或调整容量'
  if (status.state === 'unavailable') return `捕获不可用：${status.reason}`
  return ''
}

/** 将历史条数限制为 Quick Panel 支持的固定行数范围。 */
function rowCount(count: number): number {
  return Math.max(3, Math.min(8, count))
}

/** 将内容类型转换为紧凑的行标记。 */
function kindMark(kind: ClipboardWireEntry['kind']): string {
  if (kind === 'TEXT') return 'T'
  if (kind === 'IMAGE') return '图'
  return '档'
}

/** 将内容类型转换为用户可见中文标签。 */
function kindLabel(kind: ClipboardWireEntry['kind']): string {
  if (kind === 'TEXT') return '文本'
  if (kind === 'IMAGE') return '图片'
  return '文件列表'
}

/** 将动作转换为快捷键提示中的短标签。 */
function shortActionLabel(action: ClipboardAction): string {
  const label = actionLabel(action)
  return label === '粘贴' ? '粘贴' : label === '纯文本复制' ? '纯文本' : '复制'
}

/** 根据宿主平台选择 Mac 或 Windows 的修饰键提示。 */
function pasteModifierLabel(): string {
  return navigator.platform.toLocaleLowerCase().includes('mac') ? '⌥' : 'Alt+'
}

/** 将 Unix 毫秒时间戳格式化为本地时间。 */
function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

/** 将未知异常转换为界面可展示消息。 */
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
