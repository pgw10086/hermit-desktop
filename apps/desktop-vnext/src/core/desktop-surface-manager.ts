import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import type {
  DesktopSurfaceCapabilities,
  DesktopSurfaceDefinition,
  DesktopSurfaceHandle,
  DesktopSurfaceOpenOptions,
  DesktopSurfaceSize,
} from './desktop-surface-contract.js'
import { DesktopSurfaceError } from './desktop-surface-contract.js'

/** Electron 在 Surface 隐藏后可能补发一次 activate；保护窗口只需覆盖这一小段事件竞态。 */
export const SURFACE_ACTIVATION_GUARD_MS = 500

export interface DesktopSurfaceHostDefinition {
  readonly window: BrowserWindowConstructorOptions
  readonly load: (window: BrowserWindow, options: DesktopSurfaceOpenOptions) => Promise<void>
  readonly position?: (window: BrowserWindow, options: DesktopSurfaceOpenOptions) => void
  readonly hideOnBlur?: boolean
  readonly eagerLoad?: boolean
  readonly onShown?: (window: BrowserWindow) => void
  readonly onHidden?: (window: BrowserWindow) => void
}

interface SurfaceEntry {
  readonly definition: DesktopSurfaceDefinition
  readonly host: DesktopSurfaceHostDefinition
  readonly window: BrowserWindow
  readonly listeners: Map<string, Set<(payload: unknown) => void>>
  loaded: Promise<void> | undefined
  loadedSessionKey: string | undefined
  openGeneration: number
  opening: boolean
  visible: boolean
  closingUntil: number
  disposed: boolean
  rememberedBounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | undefined
}

/**
 * Desktop Core 的窗口宿主。它只理解 Surface 的生命周期和桌面偏好，业务内容由 host loader
 * 提供；因此 Smart Clipboard、对话和后续 Product Panel 共用同一个资源管理入口。
 */
export class DesktopSurfaceManager {
  readonly #entries = new Map<string, SurfaceEntry>()
  readonly #onVisibilityChanged: ((id: string, visible: boolean) => void) | undefined
  readonly #createWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow

  constructor(options: {
    readonly createWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow
    readonly onVisibilityChanged?: (id: string, visible: boolean) => void
  }) {
    this.#onVisibilityChanged = options.onVisibilityChanged
    this.#createWindow = options.createWindow
  }

  register(definition: DesktopSurfaceDefinition, host: DesktopSurfaceHostDefinition): () => void {
    validateDefinition(definition)
    if (this.#entries.has(definition.id)) {
      throw new DesktopSurfaceError('INVALID_DEFINITION', `Surface "${definition.id}" 已注册`)
    }

    const window = this.#createWindow(windowOptions(host.window, definition.window))
    const entry: SurfaceEntry = {
      definition,
      host,
      window,
      listeners: new Map(),
      loaded: undefined,
      loadedSessionKey: undefined,
      openGeneration: 0,
      opening: false,
      visible: false,
      closingUntil: 0,
      disposed: false,
      rememberedBounds: undefined,
    }
    this.#entries.set(definition.id, entry)
    if (typeof host.window.title === 'string') {
      const title = host.window.title
      window.on('page-title-updated', (event) => {
        event.preventDefault()
        window.setTitle(title)
      })
    }
    window.on('show', () => this.setVisible(entry, true))
    window.on('hide', () => {
      entry.closingUntil = Math.max(entry.closingUntil, Date.now() + SURFACE_ACTIVATION_GUARD_MS)
      this.setVisible(entry, false)
    })
    window.on('closed', () => {
      entry.disposed = true
      this.setVisible(entry, false)
      this.#entries.delete(definition.id)
      this.emit(entry, 'destroyed', undefined)
    })
    window.on('move', () => this.rememberBounds(entry))
    window.on('resize', () => this.rememberBounds(entry))
    if (host.hideOnBlur === true) window.on('blur', () => {
      if (!window.isDestroyed()) void this.close(definition.id)
    })

    if (host.eagerLoad === true) {
      void this.ensureLoaded(entry, {}).catch((cause: unknown) => {
        console.error(`Surface "${definition.id}" renderer 预加载失败: ${cause instanceof Error ? cause.message : String(cause)}`)
      })
    }
    return () => { this.destroy(definition.id) }
  }

  async open(id: string, options: DesktopSurfaceOpenOptions = {}): Promise<DesktopSurfaceHandle> {
    const entry = this.require(id)
    const ownsOpen = !entry.opening
    if (ownsOpen) entry.opening = true
    const freshSession = options.session?.type === 'new-on-submit'
      || options.session === undefined
        && entry.definition.session?.type === 'new-on-submit'
        && !entry.visible
        && ownsOpen
    if (freshSession) entry.openGeneration += 1
    const sessionKey = freshSession
      ? `new-on-submit:${entry.openGeneration}`
      : options.session === undefined ? entry.loadedSessionKey : serializeSession(options.session)
    const loadOptions = freshSession && options.session === undefined
      ? { ...options, session: { type: 'new-on-submit' as const } }
      : options
    try {
      await this.ensureLoaded(entry, loadOptions, sessionKey)
      if (entry.disposed || entry.window.isDestroyed()) {
        throw new DesktopSurfaceError('OWNER_UNLOADED', `Surface "${id}" 已被销毁`)
      }
      const policy = entry.definition.window
      const remembered = entry.rememberedBounds
      if (policy?.rememberPosition === true && remembered !== undefined
        && options.anchor === undefined && options.placement === undefined) {
        entry.window.setPosition(remembered.x, remembered.y)
      } else {
        entry.host.position?.(entry.window, { ...policy, ...options })
      }
      const preferredSize = options.preferredSize
        ?? policy?.preferredSize
        ?? (policy?.rememberSize === true && remembered !== undefined ? remembered : undefined)
      if (preferredSize !== undefined) this.setSize(entry, preferredSize)
      const alwaysOnTop = options.alwaysOnTop ?? policy?.alwaysOnTop
      if (alwaysOnTop !== undefined) entry.window.setAlwaysOnTop(alwaysOnTop)
      entry.window.show()
      if (options.focus !== 'no-activate' && entry.definition.window?.focus !== 'no-activate') entry.window.focus()
      entry.host.onShown?.(entry.window)
      return this.handle(entry)
    } finally {
      if (ownsOpen) entry.opening = false
    }
  }

  async toggle(id: string, options: DesktopSurfaceOpenOptions = {}): Promise<DesktopSurfaceHandle | null> {
    const entry = this.require(id)
    if (entry.visible && !entry.window.isDestroyed()) {
      await this.close(id)
      return null
    }
    return this.open(id, options)
  }

  resize(id: string, size: DesktopSurfaceSize): void {
    const entry = this.require(id)
    if (entry.window.isDestroyed()) throw new DesktopSurfaceError('OWNER_UNLOADED', `Surface "${id}" 已被销毁`)
    this.setSize(entry, size)
  }

  async close(id: string): Promise<void> {
    const entry = this.require(id)
    if (entry.window.isDestroyed()) return
    entry.closingUntil = Date.now() + SURFACE_ACTIVATION_GUARD_MS
    entry.window.hide()
    entry.host.onHidden?.(entry.window)
  }

  /** 只供 Desktop Core 内部适配器使用；插件拿到的 API 不包含窗口对象。 */
  windowFor(id: string): BrowserWindow {
    return this.require(id).window
  }

  /** 判断一个 Renderer 是否属于当前 Core 管理的 Surface。 */
  ownsWindow(window: BrowserWindow): boolean {
    for (const entry of this.#entries.values()) if (entry.window === window) return true
    return false
  }

  /** 判断是否有桌面 Surface 正在打开、可见或刚刚关闭，供 App activate 区分浮层显隐。 */
  hasActiveSurface(): boolean {
    for (const entry of this.#entries.values()) {
      if ((entry.visible || entry.opening || Date.now() < entry.closingUntil) && !entry.window.isDestroyed()) return true
    }
    return false
  }

  /** 主进程退出或 owner 停用时销毁全部 Surface。 */
  disposeAll(): void {
    for (const id of [...this.#entries.keys()]) this.destroy(id)
  }

  capabilities(): DesktopSurfaceCapabilities {
    return {
      platform: process.platform,
      supported: true,
      features: {
        'multi-surface': true,
        'cursor-anchor': true,
        'always-on-top': process.platform !== 'linux',
        'window-movable': process.platform !== 'linux',
        'window-resizable': true,
        'window-chrome': true,
        'focus-restore': true,
      },
    }
  }

  private destroy(id: string): void {
    const entry = this.#entries.get(id)
    if (entry === undefined || entry.disposed) return
    entry.disposed = true
    this.#entries.delete(id)
    if (!entry.window.isDestroyed()) entry.window.destroy()
    entry.listeners.clear()
  }

  private async ensureLoaded(
    entry: SurfaceEntry,
    options: DesktopSurfaceOpenOptions,
    sessionKey = serializeSession(options.session),
  ): Promise<void> {
    if (entry.loaded !== undefined && entry.loadedSessionKey === sessionKey) return entry.loaded
    if (entry.loaded !== undefined) await entry.loaded
    entry.loadedSessionKey = sessionKey
    entry.loaded = entry.host.load(entry.window, options).catch((cause: unknown) => {
      entry.loaded = undefined
      entry.loadedSessionKey = undefined
      throw new DesktopSurfaceError('RENDERER_FAILED', `Surface "${entry.definition.id}" renderer 加载失败`, { cause })
    })
    return entry.loaded
  }

  private require(id: string): SurfaceEntry {
    const entry = this.#entries.get(id)
    if (entry === undefined || entry.disposed) {
      throw new DesktopSurfaceError('OWNER_UNLOADED', `Surface "${id}" 不存在或 owner 已停用`)
    }
    return entry
  }

  private handle(entry: SurfaceEntry): DesktopSurfaceHandle {
    return {
      id: entry.definition.id,
      close: () => this.close(entry.definition.id),
      focus: async () => {
        if (!entry.window.isDestroyed()) entry.window.focus()
      },
      on: (event, listener) => {
        const listeners = entry.listeners.get(event) ?? new Set()
        listeners.add(listener)
        entry.listeners.set(event, listeners)
        return () => listeners.delete(listener)
      },
    }
  }

  private setVisible(entry: SurfaceEntry, visible: boolean): void {
    if (entry.visible === visible) return
    entry.visible = visible
    this.#onVisibilityChanged?.(entry.definition.id, visible)
    this.emit(entry, visible ? 'shown' : 'hidden', { visible })
  }

  private emit(entry: SurfaceEntry, event: string, payload: unknown): void {
    for (const listener of entry.listeners.get(event) ?? []) listener(payload)
  }

  private setSize(entry: SurfaceEntry, size: DesktopSurfaceSize): void {
    const policy = entry.definition.window
    const min = policy?.minSize
    const max = policy?.maxSize
    const width = Math.min(max?.width ?? Number.POSITIVE_INFINITY, Math.max(min?.width ?? 1, size.width))
    const height = Math.min(max?.height ?? Number.POSITIVE_INFINITY, Math.max(min?.height ?? 1, size.height))
    entry.window.setSize(Math.round(width), Math.round(height))
  }

  private rememberBounds(entry: SurfaceEntry): void {
    const policy = entry.definition.window
    if (policy?.rememberPosition !== true && policy?.rememberSize !== true) return
    if (entry.window.isDestroyed()) return
    const bounds = entry.window.getBounds()
    entry.rememberedBounds = {
      ...(entry.rememberedBounds ?? bounds),
      ...(policy.rememberPosition ? { x: bounds.x, y: bounds.y } : {}),
      ...(policy.rememberSize ? { width: bounds.width, height: bounds.height } : {}),
    }
  }
}

function windowOptions(
  host: BrowserWindowConstructorOptions,
  policy: DesktopSurfaceDefinition['window'],
): BrowserWindowConstructorOptions {
  if (policy === undefined) return host
  return {
    ...host,
    ...(policy.chrome === 'none' ? { frame: false } : {}),
    ...(policy.movable === undefined ? {} : { movable: policy.movable === 'allowed' }),
    ...(policy.resizable === undefined ? {} : { resizable: policy.resizable }),
    ...(policy.alwaysOnTop === undefined ? {} : { alwaysOnTop: policy.alwaysOnTop }),
    ...(policy.minSize === undefined ? {} : { minWidth: policy.minSize.width, minHeight: policy.minSize.height }),
    ...(policy.maxSize === undefined ? {} : { maxWidth: policy.maxSize.width, maxHeight: policy.maxSize.height }),
  }
}

function serializeSession(session: DesktopSurfaceOpenOptions['session']): string | undefined {
  if (session === undefined) return undefined
  return session.type === 'existing' ? `existing:${session.sessionId}` : session.type
}

function validateDefinition(definition: DesktopSurfaceDefinition): void {
  if (definition.id.trim().length === 0 || definition.kind.trim().length === 0) {
    throw new DesktopSurfaceError('INVALID_DEFINITION', 'Surface id 和 kind 不能为空')
  }
  if (definition.content.type === 'plugin-view' && definition.content.viewId?.trim().length === 0) {
    throw new DesktopSurfaceError('INVALID_DEFINITION', `Surface "${definition.id}" viewId 不能为空`)
  }
}
