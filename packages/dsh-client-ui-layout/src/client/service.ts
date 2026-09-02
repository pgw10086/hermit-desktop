/**
 * LayoutController: the cross-plugin panel-action face behind ctx.layout.
 * Panel geometry and the primary workspace destination live in the root
 * entry's layout store (stores.ts); the current-session selection lives with
 * the runtime sessions service, and
 * the per-session active view dissolved into ui-conversation's session store
 * (its only consumer). What remains here is the contract other plugins'
 * apply worlds reach for panel transitions (sidebar toggle from ui-sidebar,
 * details open/close from ui-conversation) — writes stay inside the store's
 * declared action set, delivered as the registration's bound actions.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { createLayoutStore } from './stores.ts'
import type { ILayout, ProductEntry, ProductEntryIcon, ProductNavigationState } from './contract.ts'
export type { ILayout, ProductEntry, ProductEntryIcon, ProductNavigationState } from './contract.ts'

const PRODUCT_ENTRY_ICONS: readonly ProductEntryIcon[] = ['clipboard', 'organizer', 'file-workspace', 'plugin']

/** The layout store's bound action set (framework-baked, draft params peeled). */
export type PanelActions = BoundActions<ReturnType<typeof createLayoutStore>>

/** Cross-plugin panel-action face (ctx.layout). */
export class LayoutController implements ILayout {
  /** Hermit Product Surface contract version exposed for feature negotiation. */
  readonly productSurfaceContract = 1 as const
  /** Hermit Product Navigation contract version exposed for feature negotiation. */
  readonly productNavigationContract = 1 as const

  #panels: PanelActions | undefined
  #entries = new Map<string, ProductEntry>()
  #navigationState: ProductNavigationState = {
    entries: [],
    activeProductSurfaceId: null,
  }
  #navigationListeners = new Set<() => void>()

  /**
   * Adopt the root entry's bound store actions. Called from the root
   * registration's inject hook (a sanctioned assembly side effect), so the
   * face is live from the entry's first render; on entry re-register the
   * fresh actions overwrite the stale set.
   * @param actions - bound actions of the entry's layout store instance.
   */
  attachPanels(actions: PanelActions): void {
    this.#panels = actions
  }

  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  /** Open the details panel (no-op when already open). */
  openDetails(): void {
    this.#require().openDetails()
  }

  /** Close the details panel. */
  closeDetails(): void {
    this.#require().closeDetails()
  }

  /** Open a registered root Product Surface by entry id. */
  openProductSurface(id: string): void {
    const normalized = id.trim()
    if (normalized.length === 0) throw new Error('layout: product surface id must not be blank')
    this.#require().openProductSurface(normalized)
    if (this.#navigationState.activeProductSurfaceId !== normalized) {
      this.#publishNavigation({ activeProductSurfaceId: normalized })
    }
  }

  /** Return from the active Product Surface to the conversation. */
  closeProductSurface(): void {
    this.#require().closeProductSurface()
    if (this.#navigationState.activeProductSurfaceId !== null) {
      this.#publishNavigation({ activeProductSurfaceId: null })
    }
  }

  /** Register one Product Surface's Core-owned navigation metadata. */
  registerProductEntry(entry: ProductEntry): () => void {
    const normalized = normalizeProductEntry(entry)
    if (this.#entries.has(normalized.id)) {
      throw new Error(`layout: product entry "${normalized.id}" is already registered`)
    }
    this.#entries.set(normalized.id, normalized)
    this.#publishNavigation()
    let live = true
    return () => {
      if (!live) return
      live = false
      if (this.#entries.get(normalized.id) !== normalized) return
      this.#entries.delete(normalized.id)
      if (this.#navigationState.activeProductSurfaceId === normalized.id) {
        this.#panels?.closeProductSurface()
        this.#publishNavigation({ activeProductSurfaceId: null })
      } else {
        this.#publishNavigation()
      }
    }
  }

  /** Read the stable navigation snapshot used by the Core renderer. */
  getProductNavigationState(): ProductNavigationState {
    return this.#navigationState
  }

  /** Subscribe to entry registration and active-surface changes. */
  subscribeProductNavigation(listener: () => void): () => void {
    this.#navigationListeners.add(listener)
    return () => { this.#navigationListeners.delete(listener) }
  }

  #publishNavigation(next: { readonly activeProductSurfaceId?: string | null } = {}): void {
    const entries = [...this.#entries.values()].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    this.#navigationState = {
      entries,
      activeProductSurfaceId: next.activeProductSurfaceId === undefined
        ? this.#navigationState.activeProductSurfaceId
        : next.activeProductSurfaceId,
    }
    for (const listener of this.#navigationListeners) listener()
  }

  #require(): PanelActions {
    // Callers are UI gestures, which cannot fire before the root entry
    // rendered (the inject hook runs in its first render) — reaching this
    // unwired is a boot-order bug, not a race to tolerate.
    if (this.#panels === undefined) throw new Error('layout: panel actions not wired (root entry not mounted)')
    return this.#panels
  }
}

function normalizeProductEntry(entry: ProductEntry): ProductEntry {
  const id = entry.id.trim()
  if (id.length === 0) throw new Error('layout: product entry id must not be blank')
  const label = entry.label.trim()
  if (label.length === 0) throw new Error(`layout: product entry "${id}" label must not be blank`)
  if (!PRODUCT_ENTRY_ICONS.includes(entry.icon)) {
    throw new Error(`layout: product entry "${id}" uses an unsupported icon`)
  }
  if (!Number.isFinite(entry.order)) {
    throw new Error(`layout: product entry "${id}" order must be finite`)
  }
  return { id, label, icon: entry.icon, order: entry.order }
}
