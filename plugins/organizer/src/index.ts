import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-skill'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { OrganizerService } from './domain/service.js'
import type { OrganizerCommand } from './client/contracts.js'
import { organizerRequestSchema, type OrganizerRpcRequest } from './domain/wire.js'
import { RPC_CHANNEL } from './shared.js'

/** Organizer Host 需要的持久化、RPC、Tool 和 Skill 服务。 */
export const inject = ['storage', 'connection', 'tools', 'skills']

/** 创建待办的工具名称，作为 Skill 到领域服务的稳定入口。 */
const CREATE_TODO_TOOL = 'organizer_create_todo'
/** 创建便签的工具名称，作为 Skill 到领域服务的稳定入口。 */
const CREATE_NOTE_TOOL = 'organizer_create_note'

/** 注册 Organizer 的 Skill、Tool 和 Host RPC，并在 effect 结束时成组撤销。 */
export function apply(ctx: Context): void {
  ctx.effect(async () => {
    const service = await OrganizerService.open(ctx)
    const disposeSkill = ctx.skills.register({
      name: 'personal-organizer',
      description: '记录、安排、完成和查找用户的个人事项。',
      whenToUse: '用户明确说要记录、创建待办、添加日程、完成或修改已有个人事项时使用。',
      source: 'bundled',
      content: PERSONAL_ORGANIZER_SKILL,
      metadata: { packageName: '@hermit/organizer', contractVersion: 1 },
    })
    const handler: ConnectionRpcHandler = async (_endpoint, payload) => {
      const parsed = organizerRequestSchema.safeParse(payload)
      if (!parsed.success) return failure('个人事项请求格式无效')
      try {
        return success(await dispatch(service, parsed.data))
      } catch (error) {
        return failure(error instanceof Error ? error.message : '个人事项操作失败')
      }
    }
    const disposeRpc = ctx.connection.rpc.handle(RPC_CHANNEL, handler, { authority: 'loopback' })
    const disposeTool = ctx.tools.register(defineTool({
      name: CREATE_TODO_TOOL,
      description: '当用户明确要求记录或创建一个待办时，在 Personal Organizer 中创建一条待办。不要把普通讨论、建议或问题自动保存。',
      parameters: {
        title: { type: 'string', required: true, description: '待办的主要行动标题。' },
        detail: { type: 'string', description: '用户明确提供的补充说明。' },
        originalInput: { type: 'string', description: '触发这次创建的完整用户原话。' },
        checklist: {
          type: 'array', description: '用户明确给出“清单/步骤/子任务”时按原顺序填写；没有时省略。',
          items: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true, description: '清单项内容。' } } },
        },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            itemId: { type: 'string', required: true }, revision: { type: 'integer', required: true },
            kind: { type: 'string', const: 'todo', required: true }, status: { type: 'string', const: 'planned', required: true },
            title: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `已记录：待办 · ${value.title}（${value.itemId}）。打开：个人事项` }],
      },
      execute: async (args, exec) => {
        const item = await service.createTodo({ title: args.title, ...(args.detail === undefined ? {} : { detail: args.detail }), ...(args.originalInput === undefined ? {} : { originalInput: args.originalInput }), ...(args.checklist === undefined ? {} : { checklist: args.checklist }) }, String(exec.callId))
        exec.concludeTurn()
        return { itemId: item.id, revision: item.revision, kind: 'todo' as const, status: 'planned' as const, title: item.title }
      },
      presentCall: (args) => ({ card: 'generic', kind: 'edit', title: '记录待办', rawInput: args.title }),
      presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? '待办未记录' : '已记录待办' }),
    }))
    const disposeNoteTool = ctx.tools.register(defineTool({
      name: CREATE_NOTE_TOOL,
      description: '当用户明确要求记录内容但没有指定待办或日程时，在 Personal Organizer 中创建一条便签。不要把普通讨论、建议或问题自动保存。',
      parameters: {
        title: { type: 'string', required: true, description: '便签标题；不要丢失用户表达的事实。' },
        detail: { type: 'string', description: '用户明确提供的补充正文。' },
        originalInput: { type: 'string', description: '触发这次创建的完整用户原话。' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            itemId: { type: 'string', required: true }, revision: { type: 'integer', required: true },
            kind: { type: 'string', const: 'note', required: true }, status: { type: 'string', const: 'active', required: true },
            title: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `已记录：便签 · ${value.title}（${value.itemId}）。打开：个人事项` }],
      },
      execute: async (args, exec) => {
        const item = await service.createNote({ title: args.title, ...(args.detail === undefined ? {} : { detail: args.detail }), ...(args.originalInput === undefined ? {} : { originalInput: args.originalInput }) }, String(exec.callId))
        exec.concludeTurn()
        return { itemId: item.id, revision: item.revision, kind: 'note' as const, status: 'active' as const, title: item.title }
      },
      presentCall: (args) => ({ card: 'generic', kind: 'edit', title: '记录便签', rawInput: args.title }),
      presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? '便签未记录' : '已记录便签' }),
    }))
    return async () => {
      disposeTool()
      disposeNoteTool()
      await disposeRpc()
      disposeSkill()
      await service.close()
    }
  }, 'personal-organizer: domain + rpc + tool')
}

/** 将已解析 RPC 请求分派到领域服务，保持 transport 层不承载业务规则。 */
async function dispatch(service: OrganizerService, request: OrganizerRpcRequest) {
  if (request.operation === 'snapshot') return { snapshot: await service.snapshot(request.query) }
  return { result: await service.execute(toOrganizerCommand(request.command)), snapshot: await service.snapshot() }
}

/** 将 Zod 解析出的可选字段重建为业务命令，避免把显式 undefined 带进 exactOptional 类型。 */
type OrganizerCommandInput = Extract<OrganizerRpcRequest, { operation: 'command' }>['command']

function toOrganizerCommand(command: OrganizerCommandInput): OrganizerCommand {
  if (command.type !== 'save') return command
  const draft = command.draft
  return {
    type: 'save',
    draft: {
      kind: draft.kind,
      title: draft.title,
      detail: draft.detail,
      tags: draft.tags,
      pinned: draft.pinned,
      priority: draft.priority,
      checklist: draft.checklist,
      todoStart: draft.todoStart,
      todoDue: draft.todoDue,
      eventTime: draft.eventTime,
      location: draft.location,
      reminders: draft.reminders,
      ...(draft.id === undefined ? {} : { id: draft.id }),
      ...(draft.revision === undefined ? {} : { revision: draft.revision }),
    },
  }
}

/** 构造统一成功 RPC 响应。 */
function success(value: unknown) { return { ok: true as const, value } }
/** 构造统一失败 RPC 响应，避免把内部异常对象直接暴露给 Client。 */
function failure(message: string) { return { ok: false as const, error: { code: 'internal' as const, message, details: {} } } }

export default { inject, apply }

export { OrganizerService } from './domain/service.js'
export { ORGANIZER_DOMAIN } from './domain/spec.js'

const PERSONAL_ORGANIZER_SKILL = `
你是 Personal Organizer 的唯一 Skill，负责把用户明确的个人事项意图交给 Organizer Tool。

判断顺序：
1. 只有用户明确表达“待办”“帮我记录”“记一下”“添加日程”等保存意图时才写入；普通讨论、建议和提问不写入。
2. 明确说“待办”或“要完成一件事”时调用 organizer_create_todo 创建 Todo；明确说“日程”或“某段时间有安排”时不要调用本切片的创建 Tool，等 Event 能力可用；只说“帮我记录/记一下”且没有类型线索时调用 organizer_create_note 创建 Note。
3. 内容不清楚也不要追问或放入 Inbox，按 Note 保存用户原话；不要凭标题猜日期、提醒、优先级或清单。
4. 用户明确说“清单”“步骤”或“子任务”并列出内容时，才把这些内容按原顺序作为 Checklist；否则放在详情中。
5. 创建 Todo 时提炼简洁行动作为 title，把明确补充放进 detail，并把完整原话作为 originalInput。创建 Note 时优先保留用户原话事实，不能把内容擅自改成日期、待办或日程字段。
6. 只在 Organizer Tool 返回成功后告诉用户已记录；失败、拒绝或结果未知不能声称成功。结果中的 itemId 是后续打开、完成和修改的唯一引用。

不要创建第二个聊天入口、不要自行写数据库、不要为同一用户 turn 做相似内容去重。
`
