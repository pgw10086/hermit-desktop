import type { ClientConnectionRpc, RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import { RPC_CHANNEL } from '../shared.js'
import type { FileWorkspacePort, Request, Response, WorkspaceSnapshot } from './contracts.js'

const EMPTY: WorkspaceSnapshot = { folders: [], files: [], trash: [] }

/** 将底层 RPC 结果收窄为文件工作区响应，拒绝无效 payload。 */
function unwrap(result: RpcResult<unknown>): Response {
  if (!result.ok) throw new Error(result.error.message)
  const value = result.value
  if (typeof value !== 'object' || value === null) throw new Error('文件工作区返回了无效结果')
  return value as Response
}

/** 创建文件工作区 Client 端口，并以最新 Host 快照驱动订阅者。 */
export function createFileWorkspacePort(rpc: ClientConnectionRpc): FileWorkspacePort {
  let snapshot = EMPTY
  const listeners = new Set<() => void>()
  /** 发布 Host 返回的 Canonical 投影，保持所有视图共享同一份快照。 */
  const publish = (next: WorkspaceSnapshot): void => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  const request = async (input: Request): Promise<Response> => {
    const result = await rpc.call(RPC_CHANNEL, 'request', input)
    const response = unwrap(result)
    if (response.snapshot !== undefined) publish(response.snapshot)
    return response
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    request,
    refresh: async () => { await request({ operation: 'snapshot' }) },
  }
}
