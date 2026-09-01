import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { ILayout, ProductSurfaceOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
import { Button, IconFolderClose16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { createFileWorkspacePort } from './port.js'
import { FileWorkspaceSurface } from './FileWorkspaceSurface.js'

/** File Workspace Client 需要的 slot、布局和公开连接服务。 */
export const inject = ['slots', 'layout', 'connection']

/** File Workspace Product Surface 的稳定入口 ID。 */
const SURFACE_ID = 'file-workspace'

/** 侧边栏入口所需的布局参数和打开回调。 */
type NavigationProps = SidebarFooterActionOwnerProps & { readonly openWorkspace: () => void }

/** 侧边栏入口只负责触发工作面导航，不读取文件数据。 */
function FileWorkspaceNavigation({ wide, openWorkspace }: NavigationProps) {
  return <Button type="button" variant="ghost" size="md" icon={<IconFolderClose16 size={16} />} aria-label="打开文件工作区" title="文件工作区" onClick={openWorkspace} style={{ width: wide ? '100%' : 36, minWidth: 36, justifyContent: wide ? 'flex-start' : 'center', paddingInline: wide ? 10 : 0 }}>{wide ? '文件工作区' : null}</Button>
}

/** 注册文件工作区 Product Surface 和侧边栏入口。 */
export function apply(ctx: ClientContext): void {
  const layout = ctx.layout as ILayout
  if (layout.productSurfaceContract !== 1) return
  const connection = (ctx as ClientContext & { readonly connection: { readonly rpc: ClientConnectionRpc } }).connection
  const port = createFileWorkspacePort(connection.rpc)
  const openWorkspace = (): void => layout.openProductSurface(SURFACE_ID)
  const closeWorkspace = (): void => layout.closeProductSurface()
  ctx.slots.inject('product.surface', () => ctx.slots.register({
    name: 'product.surface',
    id: SURFACE_ID,
    order: 15,
    inject: (): ProductSurfaceOwnerProps & { readonly port: typeof port; readonly onClose: () => void } => ({ port, onClose: closeWorkspace }),
  }, FileWorkspaceSurface))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: SURFACE_ID,
    order: 15,
    inject: () => ({ openWorkspace }),
  }, FileWorkspaceNavigation))
}

export default { inject, apply }
