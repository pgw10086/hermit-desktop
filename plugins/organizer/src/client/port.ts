import type { ClientConnectionRpc, RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import type { OrganizerClientPort, OrganizerCommand, OrganizerQuery, OrganizerSnapshot } from './contracts.js'
import type { OrganizerRpcResponse } from '../domain/wire.js'
import { RPC_CHANNEL } from '../shared.js'

const EMPTY_SNAPSHOT: OrganizerSnapshot = {
  availability: 'ready',
  defaultView: { events: { state: 'loading', items: [] }, todos: { state: 'loading', items: [] }, notes: { state: 'loading', items: [] } },
  items: { state: 'loading', items: [] },
  today: { overdue: { state: 'loading', items: [] }, todos: { state: 'loading', items: [] }, events: { state: 'loading', items: [] }, reminders: { state: 'loading', items: [] } },
  calendar: { state: 'loading', rangeLabel: '', days: [], list: [] },
  reminders: { due: { state: 'loading', items: [] }, upcoming: { state: 'loading', items: [] }, history: { state: 'loading', items: [] } },
  trash: { state: 'loading', items: [] },
  search: { state: 'empty', items: [] },
}

/** 将底层 RPC 结果收窄为 Organizer 公开响应，拒绝无效 payload。 */
function unwrap(result: RpcResult<unknown>): OrganizerRpcResponse {
  if (!result.ok) throw new Error(result.error.message)
  if (typeof result.value !== 'object' || result.value === null) throw new Error('个人事项返回了无效结果')
  return result.value as OrganizerRpcResponse
}

/** 创建 Client 侧端口；只接受最新请求序列的快照，丢弃迟到响应。 */
export function createOrganizerPort(rpc: ClientConnectionRpc): OrganizerClientPort {
  let snapshot = EMPTY_SNAPSHOT
  let requestSequence = 0
  const listeners = new Set<() => void>()
  /** 发布新快照并通知订阅者，快照本身由 Host 负责生成。 */
  const publish = (next: OrganizerSnapshot): void => { snapshot = next; for (const listener of listeners) listener() }
  /** 为每次请求分配序号，避免旧查询结果覆盖当前工作面。 */
  const request = async (input: { readonly operation: 'snapshot'; readonly query?: OrganizerQuery } | { readonly operation: 'command'; readonly command: OrganizerCommand }) => {
    const sequence = ++requestSequence
    try {
      const response = unwrap(await rpc.call(RPC_CHANNEL, 'request', input))
      if (response.snapshot !== undefined && sequence === requestSequence) publish(response.snapshot)
      return response
    } catch (error) {
      if (sequence === requestSequence) {
        publish({ ...snapshot, availability: 'unavailable', unavailableMessage: error instanceof Error ? error.message : '个人事项服务暂时不可用' })
      }
      throw error
    }
  }
  return {
    getSnapshot: () => snapshot,
    getItem: (itemId) => findItem(snapshot, itemId),
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    request: (query) => { void request({ operation: 'snapshot', query }).catch(() => undefined) },
    execute: async (command) => {
      const response = await request({ operation: 'command', command })
      if (response.result === undefined) throw new Error('个人事项没有返回操作结果')
      return response.result
    },
    refresh: async () => { await request({ operation: 'snapshot' }) },
  }
}

/** 在所有已知投影中按稳定身份查找事项。 */
function findItem(snapshot: OrganizerSnapshot, itemId: string) {
  const items = [
    ...snapshot.items.items, ...snapshot.defaultView.events.items, ...snapshot.defaultView.todos.items, ...snapshot.defaultView.notes.items,
    ...snapshot.today.overdue.items, ...snapshot.today.todos.items, ...snapshot.today.events.items, ...snapshot.calendar.list,
    ...snapshot.trash.items, ...snapshot.search.items,
  ]
  return items.find((item) => item.id === itemId)
}
