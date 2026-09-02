# Product Plugin UI 接入与组件创建规范

状态：`current`

本文是 Product Plugin 的 DSH UI 接入、共享组件归属和组件创建流程的唯一权威来源。
[项目前端 UI 设计规范](../docs/development/frontend-ui-design.md)负责所有前端共同遵循的
布局、信息层级、交互反馈和原型规则。
[核心需求 6.9](../specs/2026-08-24-hermit-dsh-vnext/core-requirements.md#69-ui-组件和-dsh-风格契约)
只保留长期产品边界；DSH UI 公共面、打包方式和候选组件的验证步骤由
[UI foundation 资格方案](../specs/2026-08-24-hermit-dsh-vnext/ui-foundation-qualification.md)
负责。

## 当前结论

- DSH Web/client 是 Product Plugin 的唯一视觉宿主。Hermit 不复制 DSH shell、主题，
  也不建立一套外观相似但独立演进的设计系统。若公开 Product Surface 确实缺失，Hermit
  可以在自带、精确锁定的 DSH Web generation 中携带经过审计的最小 source patch；patch
  只补公开 typed slot/service，不改变插件仍依赖公开面的原则。
- 初期只规划一个共享 UI 包：`@hermit/ui`，未来对应 `packages/ui/`。组件、样式和
  DSH 适配代码都留在这一个包的内部目录，不再拆 `ui-patterns`、`ui-desktop`、
  `ui-testing` 等包。
- `@hermit/ui` 是编译期依赖，不是可安装 Product Plugin、运行时服务或第二个 UI
  宿主。React、ReactDOM 和 DSH 平台模块必须由 DSH Host 提供。
- 插件自己的业务编辑器、业务列表和领域状态留在插件内。只有与业务无关、可稳定复用的
  UI 能力才进入 `@hermit/ui`。
- Desktop carrier 的 Quick Panel、恢复页、启动失败页等界面留在
  `apps/desktop-vnext`，服从 Desktop Visual Profile，不依赖 DSH UI，也不另建
  `ui-desktop` 包。
- 现在不创建空的 `packages/ui/`。先完成资格验证；首个包必须同时带来真实实现、公共契约
  和验证用例。

Hermit Product Surface v1 已通过 Smart Clipboard 同制品双宿主资格，公开面包括
`product.surface`、`ctx.layout.openProductSurface/closeProductSurface` 和
Core-owned `Product Navigation v1`。DSH 基础组件
allowlist 按能力逐项验证；Organizer 开工前已在 Reference Plugin 的 stock/Hermit
同制品真实宿主资格中验证 `Button`、`Input`、`Menu`、`Tooltip`、`Toast`、
`DisclosureRow` 和本轮使用的公开图标。这些不需要 Hermit 增加语义的稳定 public
export 可由 Product Plugin 直接使用，不为“换个 import 路径”创建空的 `@hermit/ui`。

## 所有权边界

```text
DSH public primitives / slots / semantic tokens
          |                         |
          | qualified direct       | 确有通用缺口
          v                         v
  插件领域 UI             @hermit/ui（未来唯一共享包）
          |                         |
          +------------+------------+
                       v
              Product Plugin 页面

Desktop Visual Profile -> apps/desktop-vnext 本地 UI
```

| 所有者 | 负责 | 不负责 |
| --- | --- | --- |
| DSH | App shell、Conversation、Session、Tool、Approval、Settings shell、主题和平台模块 | Hermit 业务字段和领域流程 |
| `@hermit/ui` | 经验证的 DSH 公共组件入口、通用交互组件、共享样式约束 | 业务查询、插件状态、数据库、Slot 注册和领域文案 |
| Product Plugin | 领域页面、业务列表、编辑器、业务状态和流程编排 | 复制 DSH shell、私有 DSH 适配、创建插件专属设计系统 |
| Desktop carrier | 启动、恢复、诊断和桌面原生入口 | 复用 DSH-mounted 组件或模拟 DSH 页面 |

Hermit bundled DSH 的 source patch 由底座/发布链负责，不由 Product Plugin 自己打补丁。
patch 暴露的能力先进入 DSH 公共 typed contract，经过资格验证后插件才能依赖；运行时
仍禁止私有 Router、内部 store、DOM/CSS selector 和第二个 React root。

一个插件最多贡献一个持久业务入口。入口只通过 layout 的
`registerProductEntry({ id, label, icon, order })` 声明 metadata，入口 UI、active 状态和
展开/收起表现由 Core-owned `Product Navigation v1` 统一渲染；插件不得直接注册
`sidebar.footer.action` 作为产品入口。当前 Product Surface v1 和 Product Navigation v1
由 Hermit bundled DSH 的受控 layout patch 提供，stock DSH 缺少契约时只保留兼容 fallback。
插件内部视图放在自己的页面标题区、筛选区或内容区，
不再创建一套完整侧边栏、标题栏、设置中心或聊天界面。Federated Search 和 Tray 由 Core
统一承载；Quick Panel 在合同冻结前不能被插件依赖。

## 共享包接口原则

`@hermit/ui` 应该是一个内部复杂度可增长、外部接口保持小而稳定的深模块，但“深模块”
不等于包装每个 DSH 原子组件：

- 包只提供一个经过人工维护的公共入口，不使用 `export *` 把 DSH 整包透传给业务。
- 对已经稳定、无需改变语义的 DSH primitive，可以做受控重导出；只有需要隔离版本变化、
  补全可访问性或统一交互约束时才创建 wrapper。
- 公共 Props 使用业务无关的值、状态和事件；不能接收 Core service、数据库模型、DSH
  私有 store 或插件 Slot handle。
- 组件优先受控，调用方拥有会影响业务和恢复的状态；纯视觉瞬时状态可以留在组件内部。
- 不用大量布尔参数拼出多个组件。行为或结构明显不同就拆成清楚的组件或显式变体。
- 通用标签由调用方提供或使用统一 i18n key；共享包不固化某个插件的中文业务文案。

## Product Plugin 工作面边界

工作面结构和 Flux 布局服从[项目前端 UI 设计规范](../docs/development/frontend-ui-design.md)。
Product Plugin 只在宿主提供的 Product Surface 内组织领域内容：

```text
DSH 全局导航 | 页面标题 / 二级视图 / 筛选 / 主要动作 | 列表或主内容 | 可选详情
```

- 多个业务对象优先通过视图、筛选和详情编辑区组织，避免每种对象都升级为全局入口。
- 详情可以使用同页右侧区域、抽屉或独立页面，但同一插件只选一套稳定语义。
- 批量导入、永久删除和权限授权必须说明影响范围、可撤销性和最终结果。

## 样式和视觉规则

- DSH-mounted UI 直接消费 DSH semantic token，不复制 token 数值、不维护 Hermit 品牌
  调色板，也不增加只做名称映射的 token adapter。组件内部只允许定义尺寸、布局等局部
  变量。
- 初始实现使用 CSS Modules 和 `clsx`。禁止 Tailwind preflight、global reset 或插件
  全局样式进入 DSH document。
- 不创建 Hermit ThemeProvider、密度开关或插件主题；light/dark/system 和基础控件状态
  由 DSH Host 与公共 primitive 决定。
- 图标优先使用通过资格验证的 DSH 公共图标。只有语义确实缺失且经过组件评审时，才允许
  在 `@hermit/ui` 内隔离其他图标来源。
- 不把 Radix、React Aria 或其他 headless 库当作默认 fallback。复杂键盘或 focus 行为在
  DSH 公共面和原生 HTML 都不能满足时，先单独验证，再用 ADR 决定是否引入一种实现。
- 不引入 MUI、Ant Design、Mantine 或 shadcn 作为第二套 UI foundation。

## 新组件创建流程

当插件找不到所需组件时，按以下顺序处理：

1. 在 `@hermit/ui` 的 Component Inventory 中确认是否已经存在相同能力。
2. 检查 pinned DSH 的公共 export、公开类型和官方样式契约；禁止搜索私有源码后直接引用。
3. 判断原生 semantic HTML 是否足够。原生能力满足交互时，不为“统一封装”增加浅 wrapper。
4. 如果缺口是业务专属界面，在插件内实现；如果能力与领域无关、API 可以稳定复用，则向
   `@hermit/ui` 增加组件。一个插件可以发起新增，不把“必须两个调用方”设成机械门槛。
5. 新组件评审必须写清缺口证据、职责、公共 Props、状态、键盘与 focus 行为、主题和长文
   表现，以及它为什么属于共享包。
6. 资格通过后同时提交实现、公共导出、Inventory 示例和有业务意义的交互测试；不能只建
   目录、manifest、占位 README 或只锁 padding/颜色的快照测试。

组件成熟度只有三种：

```text
candidate（发现可能可用） -> qualified（真实宿主验证通过） -> allowed（明确可消费入口）
```

DSH 自己的稳定 public export 通过资格并进入精确 allowlist 后，其 allowed
入口就是 DSH package root；Hermit 不得为此建立纯转发 wrapper。只有 Hermit 自己
提供的通用组件或确实需要隔离版本、补可访问性的 adapter，才通过 `@hermit/ui`
的人工公共入口进入 allowed。

失败或不再使用的候选直接移除，不保留静默 fallback 或第二套等价实现。

## 初始候选范围

第一轮只验证构成普通工作面的基础能力，目标不是一次建完整组件库：

| 能力 | 当前状态 | 说明 |
| --- | --- | --- |
| Button、Input | `allowed` | stock/Hermit 真实宿主、主题、focus、React externalize 已通过 |
| Menu | `allowed with scope` | portal、选择、outside-click 和 Product Surface 内 Escape 已通过；不承诺 Settings Modal 内 Escape 不联动关闭父层 |
| Tooltip | `allowed with scope` | 原生 DOM ref 锚点已通过；当前 public `Button` 不转发 ref，两者不得直接组合 |
| Toast、DisclosureRow | `allowed` | portal 反馈和受控展开已在同制品双宿主通过 |
| Modal、Pill、StateDot | `candidate` | 本轮未使用，不为以后可能需要提前放行 |
| 本轮 exact 公共图标 | `allowed` | Reference/Organizer bundle 不带入第二份 React 或私有图标源 |

Textarea、Select、Checkbox、Switch、Tabs、Popover、Table 等只有在真实页面出现缺口后再
进入候选。Reminder editor、Import progress、Clipboard preview 等仍是领域 UI，不因为
当前只有一个实现就进入共享组件库。

## 状态和反馈

通用状态、键盘、焦点和响应式要求服从
[项目前端 UI 设计规范](../docs/development/frontend-ui-design.md)。插件不可用时使用宿主批准的
明确状态，不加载残缺工作面；外围界面默认不显示正文、完整路径、Prompt 或剪贴板片段，
不能依赖临时检测共享屏幕再隐藏。

## 验收和维护

- Component Inventory 是组件状态、组合和人工检查入口，不是另一个生产包。初期放在
  `@hermit/ui` 的开发入口或 reference plugin 资格页中。
- 自动测试锁交互契约、可访问性、打包边界和 React 单实例，不锁颜色数值、padding、
  README 快照或大面积 UI snapshot。
- DSH 更新先检查 package exports、公开类型、slot、semantic token 和 React identity，
  再更新 allowlist。版本变化不能由业务插件各自兼容。
- 组件被两个以上插件使用后，API 变更要先检查所有真实调用方；发现领域参数开始进入公共
  Props 时，应把领域编排移回插件，而不是继续扩大共享接口。
