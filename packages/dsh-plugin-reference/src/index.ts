import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'

const PLUGIN_ID = '@hermit/dsh-plugin-reference'
const STATE_ROUTE = '/__hermit_reference__/state'
const TOOL_NAME = 'hermit_reference_echo'

export interface ConfigValue {
  /** 由 Settings schema 管理的展示前缀。 */
  prefix: string | { get(): string }
}

// schemastery 3.18's public Schema type omits the mode parameter used by
// `.volatile()`, so keep the exported schema boundary explicit and let
// ConfigValue carry the narrow runtime read contract.
export const Config: z<any> = z.object({
  prefix: z.string().default('Hermit Reference').volatile(),
})

/** 参考插件需要的 Settings、Tool 和资格路由服务。 */
export const inject = ['settings', 'tools', 'webServer']

/** 注册参考插件的 Settings、Tool 和只读资格路由。 */
export function apply(ctx: Context, config: ConfigValue): void {
  ctx.effect(() => ctx.settings.configure({ auto: false }), 'hermit-reference: settings page policy')

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
      return `${readPrefix(config)}: ${args.text}`
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
        prefix: readPrefix(config),
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

/**
 * DSH 0.1.7 supplies volatile settings as live references when the plugin is
 * loaded through the typed runtime path. A plain string is still accepted for
 * the stock profile's serialized configuration bridge; both paths remain
 * explicit and reject any other shape instead of hiding a broken composition.
 */
function readPrefix(config: ConfigValue): string {
  if (typeof config.prefix === 'string') return config.prefix
  if (typeof config.prefix?.get === 'function') return config.prefix.get()
  throw new TypeError('hermit-reference: prefix config is not readable')
}

// Cordis resolves the plugin's schema from the object passed to
// `ctx.registry.plugin()`. Keep Config on the default export so the 0.1.7
// loader can validate the profile entry before invoking `apply(ctx, config)`.
export default { Config, inject, apply }
