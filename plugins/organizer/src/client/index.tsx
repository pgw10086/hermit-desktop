import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import { Button, IconListPenOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { OrganizerSurface } from './OrganizerSurface.js'
import { createOrganizerPort } from './port.js'

/** Organizer Client 需要的 slot、布局和公开连接服务。 */
export const inject = ['slots', 'layout', 'connection']

/** Organizer Product Surface 的稳定入口 ID。 */
const ORGANIZER_SURFACE_ID = 'personal-organizer'

/** 侧边栏入口只负责打开 Product Surface，不拥有 Organizer 业务状态。 */
function OrganizerNavigation({ wide, openOrganizer }: SidebarFooterActionOwnerProps & { readonly openOrganizer: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="md"
      icon={<IconListPenOutline16 size={16} />}
      aria-label="打开个人事项"
      title="个人事项"
      onClick={openOrganizer}
      style={{
        width: wide ? '100%' : 36,
        minWidth: 36,
        justifyContent: wide ? 'flex-start' : 'center',
        paddingInline: wide ? 10 : 0,
      }}
    >
      {wide ? '个人事项' : null}
    </Button>
  )
}

/** 注册 Organizer 的 Product Surface 和侧边栏入口，并将生命周期交给当前 Cordis effect。 */
export function apply(ctx: ClientContext): void {
  const layout = ctx.layout as ILayout
  if (layout.productSurfaceContract !== 1) return
  const connection = (ctx as ClientContext & { readonly connection: { readonly rpc: ClientConnectionRpc } }).connection
  const port = createOrganizerPort(connection.rpc)
  const openOrganizer = (): void => layout.openProductSurface(ORGANIZER_SURFACE_ID)
  const closeOrganizer = (): void => layout.closeProductSurface()

  ctx.slots.inject('product.surface', () => ctx.slots.register({
    name: 'product.surface',
    id: ORGANIZER_SURFACE_ID,
    order: 20,
    inject: () => ({ port, onClose: closeOrganizer }),
  }, OrganizerSurface))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: ORGANIZER_SURFACE_ID,
    order: 20,
    inject: () => ({ openOrganizer }),
  }, OrganizerNavigation))
}

export default { inject, apply }
