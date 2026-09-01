import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import { Button, IconCopyOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { SmartClipboardHistoryPage } from './HistoryPage.js'

/** Client 需要的公开 slot 和布局服务。 */
export const inject = ['slots', 'layout']

/** 历史 Product Surface 的稳定入口 ID。 */
const HISTORY_SURFACE_ID = 'smart-clipboard-history'

type ProductSurfaceLayout = ILayout & {
  readonly productSurfaceContract?: 1
  openProductSurface?: (id: string) => void
  closeProductSurface?: () => void
}

type HistoryNavigationProps = SidebarFooterActionOwnerProps & {
  /** 打开剪贴板历史工作面。 */
  readonly openHistory: () => void
}

/** 侧边栏入口只打开 Product Surface，不读取或维护历史数据。 */
function HistoryNavigation({ wide, openHistory }: HistoryNavigationProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="md"
      icon={<IconCopyOutline16 size={16} />}
      aria-label="打开剪贴板历史"
      title="剪贴板历史"
      onClick={openHistory}
      style={{
        width: wide ? '100%' : 36,
        minWidth: 36,
        justifyContent: wide ? 'flex-start' : 'center',
        paddingInline: wide ? 10 : 0,
      }}
    >
      {wide ? '剪贴板历史' : null}
    </Button>
  )
}

/** 注册设置页、历史 Product Surface 和桌面打开事件。 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: HISTORY_SURFACE_ID,
    order: 30,
    label: () => '剪贴板历史',
  }, SmartClipboardHistoryPage))

  const layout = ctx.layout as ProductSurfaceLayout
  if (
    layout.productSurfaceContract !== 1
    || typeof layout.openProductSurface !== 'function'
    || typeof layout.closeProductSurface !== 'function'
  ) {
    return
  }

  const openHistory = (): void => { layout.openProductSurface?.(HISTORY_SURFACE_ID) }
  const closeHistory = (): void => { layout.closeProductSurface?.() }
  ctx.slots.inject('product.surface', () => ctx.slots.register({
    name: 'product.surface',
    id: HISTORY_SURFACE_ID,
    order: 30,
    inject: () => ({ onClose: closeHistory }),
  }, SmartClipboardHistoryPage))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: HISTORY_SURFACE_ID,
    order: 30,
    inject: () => ({ openHistory }),
  }, HistoryNavigation))
  ctx.effect(() => {
    globalThis.addEventListener('hermit-smart-clipboard-open-history', openHistory)
    return () => { globalThis.removeEventListener('hermit-smart-clipboard-open-history', openHistory) }
  }, 'smart-clipboard: desktop open-history bridge')
}

export default { inject, apply }
