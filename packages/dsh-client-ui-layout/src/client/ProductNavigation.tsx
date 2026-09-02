import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import {
  Button,
  IconCopyOutline16,
  IconCordisPluginOutline14,
  IconFolderClose16,
  IconListPenOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ILayout, ProductEntry, ProductEntryIcon } from './contract.ts'
import css from './ProductNavigation.module.css'

type ProductNavigationProps = SidebarFooterActionOwnerProps & {
  /** Core-owned layout service; plugin metadata never supplies click handlers. */
  readonly layout: ILayout
}

/**
 * Core-owned product entry renderer. It is mounted as one footer contribution
 * because pinned DSH rc.2 has no primary-navigation slot; the individual
 * plugin buttons never register into the official footer list.
 */
export function ProductNavigation({ wide, layout }: ProductNavigationProps): ReactNode {
  const getSnapshot = () => layout.getProductNavigationState()
  const state = useSyncExternalStore(
    (listener) => layout.subscribeProductNavigation(listener),
    getSnapshot,
    getSnapshot,
  )

  return (
    <nav className={css.navigation} aria-label="产品工作面" data-hermit-product-navigation>
      {state.entries.map((entry) => {
        const active = state.activeProductSurfaceId === entry.id
        return (
          <Button
            key={entry.id}
            type="button"
            variant="ghost"
            size="md"
            className={css.entry}
            data-active={active || undefined}
            data-collapsed={!wide || undefined}
            aria-current={active ? 'page' : undefined}
            aria-label={entry.label}
            title={entry.label}
            icon={iconFor(entry.icon, wide ? 16 : 18)}
            onClick={() => {
              if (!active) layout.openProductSurface(entry.id)
            }}
          >
            {wide ? <span className={css.label}>{entry.label}</span> : null}
          </Button>
        )
      })}
    </nav>
  )
}

function iconFor(icon: ProductEntryIcon, size: number): ReactNode {
  if (icon === 'clipboard') return <IconCopyOutline16 size={size} />
  if (icon === 'organizer') return <IconListPenOutline16 size={size} />
  if (icon === 'file-workspace') return <IconFolderClose16 size={size} />
  return <IconCordisPluginOutline14 size={size} />
}

/** Keep the option shape visible to the type checker at the registration site. */
export type { ProductEntry } from './contract.ts'
