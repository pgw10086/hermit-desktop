import { z } from 'zod'
import type { OrganizerCommandResult, OrganizerQuery, OrganizerSnapshot } from '../client/contracts.js'
import { ItemDraftSchema } from './wire-schema.js'

/** RPC items 查询的运行时校验；状态和类型集合与 Client contract 保持同源。 */
const itemsQuerySchema = z.object({
  type: z.literal('items'),
  kinds: z.array(z.union([z.literal('note'), z.literal('todo'), z.literal('event')])),
  statuses: z.array(z.string()), tags: z.array(z.string()), sort: z.union([z.literal('default'), z.literal('updated')]),
})

/** Host 接收的 Organizer RPC 请求 schema，拒绝未声明的操作和字段形状。 */
export const organizerRequestSchema = z.union([
  z.object({ operation: z.literal('snapshot'), query: z.union([itemsQuerySchema, z.object({ type: z.literal('search'), query: z.string() }), z.object({ type: z.literal('trash'), query: z.string() })]).optional() }),
  z.object({ operation: z.literal('command'), command: z.union([
    z.object({ type: z.literal('save'), draft: ItemDraftSchema }),
    z.object({ type: z.literal('complete'), itemId: z.string().min(1), revision: z.number().int().positive() }),
    z.object({ type: z.literal('lifecycle'), itemId: z.string().min(1), revision: z.number().int().positive(), action: z.union([z.literal('pin'), z.literal('unpin'), z.literal('archive'), z.literal('activate'), z.literal('cancel'), z.literal('trash')]) }),
    z.object({ type: z.literal('restore'), itemId: z.string().min(1), revision: z.number().int().positive() }),
    z.object({ type: z.literal('purge'), itemId: z.string().min(1), revision: z.number().int().positive() }),
  ]) }),
])

/** 从运行时 schema 推导出的 RPC 请求类型，避免静态类型与校验规则漂移。 */
export type OrganizerRpcRequest = z.infer<typeof organizerRequestSchema>

export interface OrganizerRpcResponse {
  /** 查询成功返回的完整投影快照。 */
  readonly snapshot?: OrganizerSnapshot
  /** 命令执行结果，预期冲突和拒绝通过 outcome 表达。 */
  readonly result?: OrganizerCommandResult
}

/** 供 RPC 入口消费的查询输入类型。 */
export type OrganizerQueryInput = OrganizerQuery
