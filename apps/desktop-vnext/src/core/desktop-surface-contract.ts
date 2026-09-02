/** Desktop Surface 的稳定类型；不携带 Electron、Node 或原生窗口对象。 */

export type SurfaceKind = string

export interface DesktopSurfaceDefinition {
  readonly id: string
  readonly kind: SurfaceKind
  readonly content: {
    readonly type: 'dsh-conversation' | 'plugin-view'
    readonly viewId?: string
    readonly contract?: number
  }
  readonly window?: {
    readonly anchor?: string
    readonly placement?: string
    readonly preferredSize?: { readonly width: number; readonly height: number }
    readonly focus?: string
    readonly topmost?: boolean
  }
  readonly session?: {
    readonly type: 'new-on-submit' | 'last-bound' | 'existing'
    readonly sessionId?: string
  }
  readonly actions?: readonly string[]
}

export interface DesktopSurfaceOpenOptions {
  readonly anchor?: string
  readonly placement?: string
  readonly preferredSize?: { readonly width: number; readonly height: number }
  readonly focus?: string
  readonly topmost?: boolean
  readonly session?: DesktopSurfaceDefinition['session']
}

export interface DesktopSurfaceHandle {
  readonly id: string
  close(): Promise<void>
  focus(): Promise<void>
  on(event: string, listener: (payload: unknown) => void): () => void
}

export interface DesktopSurfaceCapabilities {
  readonly platform: string
  readonly supported: boolean
  readonly features: Readonly<Record<string, boolean>>
}

export type DesktopSurfaceErrorCode =
  | 'PLATFORM_UNSUPPORTED'
  | 'CAPABILITY_UNAVAILABLE'
  | 'INVALID_DEFINITION'
  | 'SESSION_UNAVAILABLE'
  | 'OWNER_UNLOADED'
  | 'RENDERER_FAILED'

export class DesktopSurfaceError extends Error {
  override readonly name = 'DesktopSurfaceError'

  constructor(
    readonly code: DesktopSurfaceErrorCode,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options)
  }
}

export interface DesktopSurfaceService {
  register(definition: DesktopSurfaceDefinition): () => void
  open(id: string, options?: DesktopSurfaceOpenOptions): Promise<DesktopSurfaceHandle>
  toggle(id: string, options?: DesktopSurfaceOpenOptions): Promise<DesktopSurfaceHandle | null>
  resize(id: string, size: { readonly width: number; readonly height: number }): void
  close(id: string): Promise<void>
  capabilities(): DesktopSurfaceCapabilities
}

/** Renderer 通过 preload bridge 消费的桌面能力；不暴露注册 loader 的内部入口。 */
export interface DesktopSurfaceClient {
  open(id: string, options?: DesktopSurfaceOpenOptions): Promise<DesktopSurfaceResult>
  toggle(id: string, options?: DesktopSurfaceOpenOptions): Promise<DesktopSurfaceResult>
  resize(id: string, size: { readonly width: number; readonly height: number }): Promise<DesktopSurfaceResult>
  close(id: string): Promise<DesktopSurfaceResult>
  openMainSession(sessionId: string): Promise<DesktopMainSessionResult>
  capabilities(): Promise<DesktopSurfaceCapabilities>
}

export type DesktopSurfaceResult =
  | { readonly status: 'opened'; readonly id: string }
  | { readonly status: 'closed'; readonly id: string }
  | { readonly status: 'resized'; readonly id: string }
  | { readonly status: 'unavailable'; readonly id: string; readonly code: DesktopSurfaceErrorCode; readonly reason: string }

export type DesktopMainSessionResult =
  | { readonly status: 'opened'; readonly sessionId: string }
  | { readonly status: 'unavailable'; readonly sessionId: string; readonly code: DesktopSurfaceErrorCode; readonly reason: string }
