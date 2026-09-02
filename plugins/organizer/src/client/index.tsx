import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { ILayout, ProductEntry } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { OrganizerSurface } from './OrganizerSurface.js'
import { createOrganizerPort } from './port.js'

/** Organizer Client 需要的 slot、布局和公开连接服务。 */
export const inject = ['slots', 'layout', 'connection']

/** Organizer Product Surface 的稳定入口 ID。 */
const ORGANIZER_SURFACE_ID = 'personal-organizer'

/** Organizer 的稳定入口 metadata；导航 UI 由 Core 统一渲染。 */
const PRODUCT_ENTRY = {
  id: ORGANIZER_SURFACE_ID,
  label: '个人事项',
  icon: 'organizer',
  order: 20,
} satisfies ProductEntry

/** 注册 Organizer 的 Product Surface 和 Core-owned 产品入口。 */
export function apply(ctx: ClientContext): void {
  const layout = ctx.layout as ILayout
  if (layout.productSurfaceContract !== 1 || layout.productNavigationContract !== 1) return
  const connection = (ctx as ClientContext & { readonly connection: { readonly rpc: ClientConnectionRpc } }).connection
  const port = createOrganizerPort(connection.rpc)
  const closeOrganizer = (): void => layout.closeProductSurface()

  ctx.slots.inject('product.surface', () => ctx.slots.register({
    name: 'product.surface',
    id: ORGANIZER_SURFACE_ID,
    order: 20,
    inject: () => ({ port, onClose: closeOrganizer }),
  }, OrganizerSurface))
  ctx.effect(() => layout.registerProductEntry(PRODUCT_ENTRY), 'organizer: product navigation entry')
}

export default { inject, apply }
