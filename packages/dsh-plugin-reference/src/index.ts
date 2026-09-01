import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-host-webserver'

const PLUGIN_ID = '@hermit/dsh-plugin-reference'
const SETTINGS_NAMESPACE = settingsNamespace('hermit-reference')
const STATE_ROUTE = '/__hermit_reference__/state'
const TOOL_NAME = 'hermit_reference_echo'

interface ReferenceSettings {
  /** 由 Settings schema 管理的展示前缀。 */
  prefix: string
}

const ReferenceSettingsSchema: z<ReferenceSettings> = z.object({
  prefix: z.string().default('Hermit Reference'),
})

/** 参考插件需要的 Settings、Tool 和资格路由服务。 */
export const inject = ['settings', 'tools', 'webServer']

/** 注册参考插件的 Settings、Tool 和只读资格路由。 */
export function apply(ctx: Context): void {
  const settings = ctx.settings.register(SETTINGS_NAMESPACE, ReferenceSettingsSchema, {
    base: { prefix: 'Hermit Reference' },
  })

  ctx.tools.register(defineTool({
    name: TOOL_NAME,
    description: 'Echo text through the Hermit DSH reference plugin.',
    parameters: {
      text: { type: 'string', required: true, description: 'Text to echo.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `${settings.get().prefix}: ${args.text}`
    },
  }))

  // 该只读路由只为资格测试关联同一制品的 Host 和 Client，不承载业务 RPC。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STATE_ROUTE,
    handler: (request, response) => {
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET' })
        response.end()
        return
      }
      const body = JSON.stringify({
        plugin: PLUGIN_ID,
        prefix: settings.get().prefix,
        toolRegistered: ctx.tools.schemas().some(({ name }) => name === TOOL_NAME),
      })
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
      })
      response.end(body)
    },
  }), 'hermit-reference: qualification route')
}

export default { inject, apply }
