/** Product Navigation v1 允许插件声明的 DSH 公共图标语义。 */
export type ProductEntryIcon = 'clipboard' | 'organizer' | 'file-workspace' | 'plugin'

/** 一级产品入口的最小 metadata；入口身份必须与 Product Surface 身份一致。 */
export interface ProductEntry {
  /** 与对应 `product.surface` registration 使用同一个稳定 id。 */
  readonly id: string
  /** 展开侧栏中的入口名称，也作为收起侧栏的 tooltip 文案。 */
  readonly label: string
  /** Core 从 DSH 已批准图标中选择具体 glyph，插件不能注入 JSX。 */
  readonly icon: ProductEntryIcon
  /** 数值越小越靠前；不依赖插件加载顺序。 */
  readonly order: number
}

/** Core-owned Product Navigation 的只读快照。 */
export interface ProductNavigationState {
  /** 当前生命周期内已注册、按 order 和 id 排序的入口。 */
  readonly entries: readonly ProductEntry[]
  /** 当前 Product Surface 身份；无工作面时为 null。 */
  readonly activeProductSurfaceId: string | null
}

/** 外部 Product Surface 工作面收到的公共 owner props。 */
export interface ProductSurfaceOwnerProps {}

/** Quick Surface 的会话槽不携带业务 owner 状态，Session 事实由 DSH 标准 kit 提供。 */
export interface QuickSessionOwnerProps {}

/** DSH Client 可消费的 Desktop Core Surface contract，不暴露宿主窗口对象。 */
export interface DesktopSurfaceSize {
  readonly width: number
  readonly height: number
}

export interface DesktopSurfaceWindowPolicy {
  readonly chrome?: 'system' | 'none'
  readonly movable?: 'allowed' | 'locked'
  readonly resizable?: boolean
  readonly alwaysOnTop?: boolean
  readonly anchor?: string
  readonly placement?: string
  readonly preferredSize?: DesktopSurfaceSize
  readonly minSize?: DesktopSurfaceSize
  readonly maxSize?: DesktopSurfaceSize
  readonly focus?: string
  readonly escape?: 'hide' | 'close' | 'ignore'
  readonly blur?: 'hide' | 'keep'
  readonly dismiss?: DesktopSurfaceDismissDisposition
  readonly rememberPosition?: boolean
  readonly rememberSize?: boolean
}

export interface DesktopSurfaceOpenOptions {
  readonly anchor?: string
  readonly placement?: string
  readonly preferredSize?: DesktopSurfaceSize
  readonly focus?: string
  readonly alwaysOnTop?: boolean
  readonly session?: {
    readonly type: 'new-on-submit' | 'last-bound' | 'existing'
    readonly sessionId?: string
  }
}

/** 关闭临时 Surface 时对焦点的处理方式。 */
export type DesktopSurfaceDismissDisposition = 'restore-previous' | 'keep-current' | 'external-handoff'

export interface DesktopSurfaceCloseOptions {
  readonly disposition?: DesktopSurfaceDismissDisposition
}

export interface DesktopSurfaceCapabilities {
  readonly platform: string
  readonly supported: boolean
  readonly features: Readonly<Record<string, boolean>>
}

export type DesktopSurfaceResult =
  | { readonly status: 'opened'; readonly id: string }
  | { readonly status: 'closed'; readonly id: string }
  | { readonly status: 'resized'; readonly id: string }
  | { readonly status: 'unavailable'; readonly id: string; readonly code: string; readonly reason: string }

export type DesktopMainSessionResult =
  | { readonly status: 'opened'; readonly sessionId: string }
  | { readonly status: 'unavailable'; readonly sessionId: string; readonly code: string; readonly reason: string }

export interface DesktopSurfaceClient {
  open(id: string, options?: DesktopSurfaceOpenOptions): Promise<DesktopSurfaceResult>
  toggle(id: string, options?: DesktopSurfaceOpenOptions): Promise<DesktopSurfaceResult>
  resize(id: string, size: DesktopSurfaceSize): Promise<DesktopSurfaceResult>
  close(id: string, options?: DesktopSurfaceCloseOptions): Promise<DesktopSurfaceResult>
  openMainSession(sessionId: string): Promise<DesktopMainSessionResult>
  capabilities(): Promise<DesktopSurfaceCapabilities>
}

/** 从 Desktop Core 注入的全局 bridge 读取 Surface API；缺失表示当前宿主不是桌面壳。 */
export function getDesktopSurfaceClient(): DesktopSurfaceClient | undefined {
  const host = globalThis as typeof globalThis & { readonly hermitDesktopSurface?: DesktopSurfaceClient }
  return host.hermitDesktopSurface
}

/** Hermit layout 服务的跨插件公共 contract。 */
export interface ILayout {
  /** Hermit Product Surface contract version exposed for feature negotiation. */
  readonly productSurfaceContract: 1
  /** Hermit Product Navigation contract version exposed for feature negotiation. */
  readonly productNavigationContract: 1
  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void
  /** Open the details panel (no-op when already open). */
  openDetails(): void
  /** Close the details panel. */
  closeDetails(): void
  /** Open a registered root Product Surface by entry id. */
  openProductSurface(id: string): void
  /** Return from the active Product Surface to the conversation. */
  closeProductSurface(): void
  /** Register one Product Surface's Core-owned navigation metadata. */
  registerProductEntry(entry: ProductEntry): () => void
  /** Read the stable navigation snapshot used by the Core renderer. */
  getProductNavigationState(): ProductNavigationState
  /** Subscribe to entry registration and active-surface changes. */
  subscribeProductNavigation(listener: () => void): () => void
}
