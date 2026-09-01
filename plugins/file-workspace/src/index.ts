import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import { fileWorkspaceRequestSchema, FileWorkspaceService, type ParsedFileWorkspaceRequest } from './domain/service.js'
import { RPC_CHANNEL } from './shared.js'

// 这些 import 只为让 TypeScript 载入 DSH 对 Context 的公开声明合并；运行时依赖由 profile 提供。
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-storage'

/** File Workspace Host 需要的持久化和公开连接服务。 */
export const inject = ['storage', 'connection']

/** 将 Host 侧异常转换为公开 RPC 错误，保留可展示的业务消息。 */
function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : '文件工作区操作失败'
  return { ok: false as const, error: { code: 'internal' as const, message, details: {} } }
}

/** 构造统一成功响应，避免 RPC handler 各分支重复拼接结构。 */
function success(value: unknown) {
  return { ok: true as const, value }
}

/** 将经过 schema 校验的 RPC 请求分派到唯一的领域服务。 */
async function dispatch(service: FileWorkspaceService, request: ParsedFileWorkspaceRequest) {
  switch (request.operation) {
    case 'snapshot': return { snapshot: await service.snapshot() }
    case 'read': return { read: await service.read(request.fileId) }
    case 'create-note': return service.createNote()
    case 'create-folder': return service.createFolder(request.name)
    case 'delete-folder': return service.deleteFolder(request.folderId)
    case 'move-file': return service.moveFile(request.fileId, request.destinationFolderId)
    case 'trash-file': return service.trashFile(request.fileId)
    case 'restore-file': return service.restoreFile(request.fileId)
    case 'purge-file': return service.purgeFile(request.fileId)
    case 'purge-trash': return service.purgeTrash()
    case 'save-markdown': return service.saveMarkdown(request.fileId, request.expectedRevisionId, request.content)
    case 'import-file': return service.importFile(request.input)
    case 'set-last-open': return service.setLastOpen(request.fileId)
  }
}

/** Host 入口只暴露公开 Connection RPC，不让文件系统路径或私有 DSH 路由穿过边界。 */
export function apply(ctx: Context): void {
  ctx.effect(async () => {
    const service = await FileWorkspaceService.open(ctx)
    const handler: ConnectionRpcHandler = async (_endpoint, payload) => {
      const parsed = fileWorkspaceRequestSchema.safeParse(payload)
      if (!parsed.success) return errorResult(new Error('文件工作区请求格式无效'))
      try {
        return success(await dispatch(service, parsed.data))
      } catch (error) {
        return errorResult(error)
      }
    }
    const disposeRpc = ctx.connection.rpc.handle(RPC_CHANNEL, handler, { authority: 'loopback' })
    return async () => {
      await disposeRpc()
      await service.close()
    }
  }, 'file-workspace: domain + rpc')
}

export default { inject, apply }

export { RPC_CHANNEL }
