/**
 * Layout plugin, browser half: one register() call contributes AppFrame into
 * the runtime's built-in 'root' slot and, in the same breath, declares the
 * five child slots (declaration = exclusive render authority), seats the
 * layout store (panel geometry), and wires the panel-action service face.
 * ctx.layout is the cross-plugin panel-action contract; the primary workspace
 * destination lives in this layout while the selected Session remains owned
 * by the runtime sessions service. A second effect seats the theme presenter,
 * which projects ctx.theme snapshots onto document.body.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { type ProductSurfaceOwnerProps } from './contract.ts'
import type { PanelActions } from './service.ts'
import { AppFrame } from './AppFrame.tsx'
import { ProductNavigation } from './ProductNavigation.tsx'
import { ShortcutCenter } from './ShortcutCenter.tsx'
import { createLayoutStore } from './stores.ts'
import { LayoutController } from './service.ts'
import { ThemePresenter } from './theme-presenter.ts'

// Contract exports only (export-convergence rule: cross-package consumers
// keep a symbol exported; test-only/package-internal symbols live off /src).
// ILayout: the ctx.layout face consumers and test fakes type against.
// OwnerShare contracts below are the render-side halves registrants compose
// against; the frame components and the store factory are package-internal.
export { LayoutController } from './service.ts'
export {
  getDesktopSurfaceClient,
  type DesktopSurfaceCapabilities,
  type DesktopSurfaceClient,
  type DesktopMainSessionResult,
  type DesktopSurfaceOpenOptions,
  type DesktopSurfaceResult,
  type ILayout,
  type ProductEntry,
  type ProductEntryIcon,
  type ProductNavigationState,
  type ProductSurfaceOwnerProps,
} from './contract.ts'
export {
  getDesktopDeadlineClient,
  getDesktopNotificationClient,
  type DesktopCapabilityErrorCode,
  type DesktopDeadlineClient,
  type DesktopDeadlineFiredEvent,
  type DesktopDeadlineInput,
  type DesktopDeadlineResult,
  type DesktopNotificationActionInput,
  type DesktopNotificationClient,
  type DesktopNotificationEvent,
  type DesktopNotificationInput,
  type DesktopNotificationResult,
  type DesktopNotificationStatus,
} from './desktop-capabilities.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The outward face only; the concrete service stays inside this plugin. */
    layout: import('./contract.ts').ILayout
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    // The 'root' entry itself is the runtime's built-in slot (declared
    // there); these five are the frame's children, declared by the same
    // register() call that contributes AppFrame. Session owners never pass
    // sessionId: the framework injects it as a standard prop.
    /**
     * The whole left column. OCCUPIED by ui-sidebar's SidebarRoot, which
     * declares the workspace and settings seats inside it — registering here
     * replaces the navigation column outright rather than adding to it, and
     * the seats it declares disappear with it. To add something to the
     * sidebar, register into one of those inner seats instead.
     *
     * The occupant receives the frame's live column state (collapsed, width)
     * and is expected to render the compact control rail while collapsed.
     */
    'sidebar': { kind: 'single'; scope: 'root'; owner: SidebarOwnerProps }
    /**
     * The whole center column, across both the no-session hero and a live
     * conversation. OCCUPIED by ui-conversation's ConversationRoot, which
     * declares the session body, composer, and input seats inside it —
     * registering here replaces the entire conversation surface (and removes
     * every seat it declares) rather than adding to it.
     *
     * Current-session-optional: the occupant owns both states without
     * changing its React identity, so it keeps its own state across a session
     * switch. It receives no owner props; session facts arrive through the
     * framework hooks of the `session-maybe` scope.
     */
    'conversation': { kind: 'single'; scope: 'session-maybe'; owner: ConvOwnerProps }
    /**
     * The right details column, shown when the layout opens it. OCCUPIED by
     * ui-conversation's DetailsPanel, which declares the tool-details seat
     * inside it — registering here replaces the column and takes that seat
     * with it. Absent an occupant the column renders nothing.
     *
     * No owner props: the framework injects the session id and hooks for the
     * `session` scope, and `ctx.layout` owns whether the column is open.
     */
    'details': { kind: 'single'; scope: 'session'; owner: DetailsOwnerProps }
    /**
     * Persistent root business pages. The layout renders exactly the entry
     * selected through `ctx.layout.openProductSurface(id)` and leaves the
     * sidebar mounted so product navigation remains available.
     */
    'product.surface': { kind: 'list'; scope: 'root'; owner: ProductSurfaceOwnerProps }
    /**
     * Frame-wide floating layer, above every column and outside their scroll
     * containers. Deliberately generic and unowned by any feature: a badge, a
     * toast stack or a status pill all belong here, and entries order among
     * themselves. The layer itself is click-through — entries opt back into
     * pointer events — so an occupant never blocks the app underneath.
     *
     * This is the additive seat for a frame-wide surface of your own: a fresh
     * `id` is added beside the shipped entries instead of replacing them.
     */
    'shell.overlay': { kind: 'list'; scope: 'root' }
  }
}

// OwnerShare contracts — the render-side share the slot owner supplies at
// renderSlot. Registrants IMPORT these and compose their full component props
// through the four-share intersection (PropsRuntime & PropsRenderSlots &
// PropsStore & I). Conversation business state and actions arrive through
// framework-standard hooks and each registrant's inject face, not owner props.

/** Sidebar owner share: live column state from the frame's concession solve. */
export interface SidebarOwnerProps {
  /** True when the sidebar is closed (the column renders the compact control rail). */
  collapsed: boolean
  /** Rendered column width in px (SIDEBAR_COLLAPSED when collapsed). */
  width: number
}

/** Conversation owner share: business state and actions belong to the registrant. */
export interface ConvOwnerProps {}

/** Details owner share: empty — sessionId arrives as a framework-standard prop. */
export interface DetailsOwnerProps {}

/** Required services (cordis fiber inject — the loader passes all module exports as an object plugin). */
/** 布局插件需要的 slot 注册和主题快照服务。 */
export const inject = ['slots', 'theme', 'sessions']

/**
 * Client plugin body: provide ctx.layout, then one register() call — AppFrame
 * into 'root' with the five child-slot declarations, the layout store seat,
 * and the inject hook that hands the store's bound actions to the service.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const layout = new LayoutController()
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('layout', layout)
    const disposeRegistration = ctx.slots.register({
      name: 'root',
      children: {
        'sidebar': { kind: 'single', scope: 'root' },
        'conversation': { kind: 'single', scope: 'session-maybe' },
        'details': { kind: 'single', scope: 'session' },
        'product.surface': { kind: 'list', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
      // Exclusive store: the factory itself — the framework instantiates per
      // entry and delivers useStore/actions to AppFrame as standard props.
      store: createLayoutStore,
      // The hook's only side effect connects the root store to ctx.layout;
      // conversation business actions belong to their registrants.
      inject: (actions: PanelActions) => {
        layout.attachPanels(actions)
        return {}
      },
    }, AppFrame)
    const disposeProductNavigation = ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'hermit-product-navigation',
      order: -100,
      inject: () => ({ layout }),
    }, ProductNavigation))
    const disposeShortcutCenter = ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'shortcut-center',
      order: 80,
      label: () => '快捷键',
    }, ShortcutCenter))
    const disposeSessionNavigation = subscribeSessionNavigation(ctx, layout)
    return () => {
      disposeSessionNavigation()
      disposeShortcutCenter()
      disposeProductNavigation()
      disposeRegistration()
      // provide()'s disposer settles asynchronously; teardown is synchronous fire-and-forget.
      void disposeService()
    }
  }, 'ui-layout: service + root registration')

  // A Quick Conversation surface may carry an existing Session id in its URL.
  // The selection remains client-local; the Session log and stream stay in DSH.
  const requestedSessionId = new URLSearchParams(window.location.search).get('sessionId')?.trim() as SessionId | undefined
  if (requestedSessionId !== undefined && requestedSessionId !== '') {
    ctx.effect(() => {
      let live = true
      const reconcile = (): void => {
        if (!live) return
        const sessions = ctx.sessions.list.getSnapshot()
        if (sessions.current === requestedSessionId) {
          live = false
          off()
          return
        }
        if (sessions.byId[requestedSessionId] === undefined) return
        ctx.sessions.open(requestedSessionId)
      }
      const off = ctx.sessions.list.subscribe(reconcile)
      reconcile()
      return () => {
        live = false
        off()
      }
    }, 'ui-layout: requested Surface Session')
  }

  // A Quick Conversation fresh-open is an explicit no-session request. Clear
  // only this renderer's current selection through the official DSH service;
  // the Core never creates or mirrors a Session to implement this behavior.
  if (new URLSearchParams(window.location.search).get('hermitNewSession') === '1') {
    ctx.effect(() => {
      ctx.sessions.clear()
      return () => undefined
    }, 'ui-layout: fresh Surface Session')
  }

  // Theme presentation: pure DOM writes from resolved snapshots — initial
  // state through the getter once, then event-driven only; no React path.
  ctx.effect(() => {
    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', (snapshot) => { presenter.apply(snapshot) })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'ui-layout: theme presenter')
}

/**
 * 让所有通过 DSH sessions 服务完成的前台会话切换回到会话主工作区。
 * 同一会话的重复打开由 bundled DSH 的 Workspace adapter 直接通知；这里
 * 负责处理真正改变 current 的其他公开路径，不能把 sessionId 复制进布局状态。
 */
function subscribeSessionNavigation(ctx: ClientContext, layout: LayoutController): () => void {
  let previous = ctx.sessions.list.getSnapshot().current
  return ctx.sessions.list.subscribe(() => {
    const next = ctx.sessions.list.getSnapshot().current
    if (next === previous) return
    previous = next
    if (layout.getProductNavigationState().activeProductSurfaceId !== null) {
      layout.closeProductSurface()
    }
  })
}
