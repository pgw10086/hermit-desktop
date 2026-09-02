import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ILayout, ProductEntry } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { SmartClipboardHistoryPage } from './HistoryPage.js'

/** Client 需要的公开 slot 和布局服务。 */
export const inject = ['slots', 'layout']

/** 历史 Product Surface 的稳定入口 ID。 */
const HISTORY_SURFACE_ID = 'smart-clipboard-history'

type ProductSurfaceLayout = ILayout & {
  readonly productSurfaceContract?: 1
  readonly productNavigationContract?: 1
  openProductSurface?: (id: string) => void
  closeProductSurface?: () => void
}

/** Smart Clipboard 的稳定入口 metadata；导航 UI 由 Core 统一渲染。 */
const PRODUCT_ENTRY = {
  id: HISTORY_SURFACE_ID,
  label: '剪贴板历史',
  icon: 'clipboard',
  order: 30,
} satisfies ProductEntry

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
    || layout.productNavigationContract !== 1
    || typeof layout.openProductSurface !== 'function'
    || typeof layout.closeProductSurface !== 'function'
    || typeof layout.registerProductEntry !== 'function'
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
  ctx.effect(() => layout.registerProductEntry(PRODUCT_ENTRY), 'smart-clipboard: product navigation entry')
  ctx.effect(() => {
    globalThis.addEventListener('hermit-smart-clipboard-open-history', openHistory)
    return () => { globalThis.removeEventListener('hermit-smart-clipboard-open-history', openHistory) }
  }, 'smart-clipboard: desktop open-history bridge')
}

export default { inject, apply }
