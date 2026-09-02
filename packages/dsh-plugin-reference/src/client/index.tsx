import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  Button,
  DisclosureRow,
  IconCheckOutline16,
  IconChecklistOutline14,
  IconPlusOutline16,
  Input,
  Menu,
  Toast,
  Tooltip,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ILayout, ProductEntry } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'

/** Host 资格状态只读路由；用于验证同一制品的 Host/Client 配置一致。 */
const STATE_ROUTE = '/__hermit_reference__/state'
/** 只用于验证 Product Surface 接入的稳定示例身份。 */
const PRODUCT_SURFACE_ID = 'hermit-reference-surface'
/** 参考插件使用通用图标，不要求 Core 为资格示例增加专属图标。 */
const PRODUCT_ENTRY = {
  id: PRODUCT_SURFACE_ID,
  label: '参考工作面',
  icon: 'plugin',
  order: 100,
} satisfies ProductEntry
/** 参考页面用于验证官方 Menu 的选择和分隔行为。 */
const MENU_ITEMS: readonly MenuEntry[] = [
  { id: 'today', label: '今天', icon: <IconCheckOutline16 size={16} /> },
  { id: 'items', label: '全部事项', icon: <IconChecklistOutline14 size={16} /> },
]

interface HostState {
  /** 参考插件 package 身份，用于验证 Host/Client 属于同一制品。 */
  plugin: '@hermit/dsh-plugin-reference'
  /** Host 配置中的展示前缀。 */
  prefix: string
  /** 参考 Tool 是否已在 Host 注册。 */
  toolRegistered: boolean
}

/** 校验资格路由返回的 Host 状态。 */
function parseHostState(value: unknown): HostState {
  if (typeof value !== 'object' || value === null) throw new Error('Host state 不是对象')
  const state = value as Record<string, unknown>
  if (state.plugin !== '@hermit/dsh-plugin-reference'
    || typeof state.prefix !== 'string'
    || typeof state.toolRegistered !== 'boolean') {
    throw new Error('Host state 不符合参考插件契约')
  }
  return state as unknown as HostState
}

/** 参考插件 Settings tab，用于验证公开 UI、Slot 和 Host 状态读取。 */
function ReferenceSettingsTab(): ReactNode {
  const [hostState, setHostState] = useState<HostState | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [count, setCount] = useState(0)
  const [inputValue, setInputValue] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [selectedMenuItem, setSelectedMenuItem] = useState('today')
  const [disclosureOpen, setDisclosureOpen] = useState(false)
  const [toastSequence, setToastSequence] = useState(0)
  const dismissToast = useCallback(() => setToastSequence(0), [])

  useEffect(() => {
    const controller = new AbortController()
    void fetch(STATE_ROUTE, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Host state HTTP ${String(response.status)}`)
        return parseHostState(await response.json())
      })
      .then(setHostState)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
    return () => controller.abort()
  }, [])

  return (
    <section data-hermit-reference-plugin="ready">
      <h2>Hermit 参考插件</h2>
      <p>用于验证 DSH 官方 Bundle、Host、Client、Settings、Tool 和 Slot 接入。</p>
      <p data-hermit-reference-host-state>
        {error !== undefined
          ? `Host 连接失败：${error}`
          : hostState === undefined
            ? '正在读取 Host 状态'
            : `${hostState.prefix} · Tool ${hostState.toolRegistered ? '已注册' : '未注册'}`}
      </p>
      <Button variant="outline" onClick={() => setCount((value) => value + 1)}>
        React Hook 验证：{count}
      </Button>
      <Input
        aria-label="官方 Input 验证"
        placeholder="输入任意内容"
        icon={<IconChecklistOutline14 size={16} />}
        value={inputValue}
        onChange={(event) => setInputValue(event.currentTarget.value)}
      />
      <Menu
        open={menuOpen}
        anchor={(
          <Button
            type="button"
            variant="outline"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            打开组件菜单
          </Button>
        )}
        items={MENU_ITEMS}
        selectedId={selectedMenuItem}
        onSelect={(id) => {
          setSelectedMenuItem(id)
          setMenuOpen(false)
        }}
        onClose={() => setMenuOpen(false)}
        portal
      />
      <span data-hermit-reference-menu-value>{selectedMenuItem}</span>
      <Tooltip label="官方 Tooltip 正常" side="bottom">
        <button type="button" aria-label="提示触发器">
          提示
        </button>
      </Tooltip>
      <Button
        type="button"
        variant="outline"
        icon={<IconPlusOutline16 size={16} />}
        onClick={() => setToastSequence((value) => value + 1)}
      >
        显示 Toast
      </Button>
      {toastSequence > 0 && (
        <Toast
          key={toastSequence}
          text="官方 Toast 正常"
          icon={<IconCheckOutline16 size={16} />}
          onDone={dismissToast}
        />
      )}
      <DisclosureRow
        icon={<IconChecklistOutline14 size={16} />}
        title="DisclosureRow 验证"
        open={disclosureOpen}
        expandable
        expandOnRowClick
        onToggle={() => setDisclosureOpen((value) => !value)}
      >
        <p>官方 DisclosureRow 展开内容</p>
      </DisclosureRow>
    </section>
  )
}

/** 只证明 Product Surface 的接入形状，不引入业务数据或第二套页面外壳。 */
function ReferenceProductSurface({ onClose }: { readonly onClose: () => void }): ReactNode {
  return (
    <section data-hermit-reference-product-surface="ready">
      <header>
        <h1>Hermit 参考工作面</h1>
        <Button type="button" variant="outline" onClick={onClose}>
          返回对话
        </Button>
      </header>
      <p>这是一个只用于验证 Product Navigation 和 Product Surface 生命周期的最小示例。</p>
    </section>
  )
}

export const inject = ['slots']

/** 注册参考插件的 Settings tab，并在可选 Hermit layout contract 存在时增加最小工作面示例。 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'hermit-reference',
    order: 100,
    label: () => 'Hermit 参考插件',
  }, ReferenceSettingsTab))

  // stock DSH 没有 Hermit layout service；可选读取让 Settings 资格继续成立，
  // 同时避免把 Product Surface 假装成 DSH 官方 stock 能力。
  const layout = ctx.get('layout') as ILayout | undefined
  if (layout?.productSurfaceContract !== 1 || layout.productNavigationContract !== 1) return
  const closeSurface = (): void => layout.closeProductSurface()
  ctx.slots.inject('product.surface', () => ctx.slots.register({
    name: 'product.surface',
    id: PRODUCT_SURFACE_ID,
    order: PRODUCT_ENTRY.order,
    inject: () => ({ onClose: closeSurface }),
  }, ReferenceProductSurface))
  ctx.effect(() => layout.registerProductEntry(PRODUCT_ENTRY), 'hermit-reference: product navigation entry')
}
