import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { ILayout, ProductEntry, ProductSurfaceOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { createFileWorkspacePort } from './port.js'
import { FileWorkspaceSurface } from './FileWorkspaceSurface.js'

/** File Workspace Client 需要的 slot、布局和公开连接服务。 */
export const inject = ['slots', 'layout', 'connection']

/** File Workspace Product Surface 的稳定入口 ID。 */
const SURFACE_ID = 'file-workspace'

/** File Workspace 的稳定入口 metadata；导航 UI 由 Core 统一渲染。 */
const PRODUCT_ENTRY = {
  id: SURFACE_ID,
  label: '文件工作区',
  icon: 'file-workspace',
  order: 15,
} satisfies ProductEntry

/** 注册文件工作区 Product Surface 和 Core-owned 产品入口。 */
export function apply(ctx: ClientContext): void {
  const layout = ctx.layout as ILayout
  if (layout.productSurfaceContract !== 1 || layout.productNavigationContract !== 1) return
  const connection = (ctx as ClientContext & { readonly connection: { readonly rpc: ClientConnectionRpc } }).connection
  const port = createFileWorkspacePort(connection.rpc)
  const closeWorkspace = (): void => layout.closeProductSurface()
  ctx.slots.inject('product.surface', () => ctx.slots.register({
    name: 'product.surface',
    id: SURFACE_ID,
    order: 15,
    inject: (): ProductSurfaceOwnerProps & { readonly port: typeof port; readonly onClose: () => void } => ({ port, onClose: closeWorkspace }),
  }, FileWorkspaceSurface))
  ctx.effect(() => layout.registerProductEntry(PRODUCT_ENTRY), 'file-workspace: product navigation entry')
}

export default { inject, apply }
