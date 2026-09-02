# Hermit vNext 二期总方向

状态：`IN_PROGRESS`
适用范围：v0.1.0 发布后的三个第一方 Product Plugin、Hermit bundled DSH Web 和
Desktop Core 边界。
本文件是二期路线的当前权威方向；具体插件业务仍以各自的 `DESIGN.md` 为准。

## 一句话目标

把 v0.1.0 已经能用的三个插件，收敛成一个容易继续扩展、容易使用、容易被 DSH AI
调用的本地工作台，同时不提前建设一个没有真实使用者的“大平台”。

## 已确认的判断

### 1. 建设可扩展但受控的 Desktop Surface 能力

DSH 官方能力、Hermit Desktop Core 能力和 Product Plugin 能力继续分开：

```text
DSH 官方公开能力 -> Product Plugin 业务能力 -> 确有需要时的窄 Desktop Core capability
```

Desktop Core 可以提供一个可扩展的 Desktop Surface service，统一承载需要独立窗口、临时
浮层、焦点或置顶的桌面工作面。第一条实现是 `conversation.quick`，后续可由 Smart Clipboard
和 Organizer 注册自己的 Surface 类型。可扩展不等于任意窗口 API：Core 仍拥有窗口生命周期、
平台策略和安全边界，DSH 或插件拥有内容、Session 和业务状态；插件不直接操作 Electron 对象，
也不通过任意 IPC 绕过公开 contract。

具体需求、接口形状、迁移步骤和验收见
[Desktop Surface 与 Quick Panel spec](desktop-surface-quick-panel.md)。新 Surface 以真实产品
流程和打包验证为依据逐步增加，不预建没有使用者的窗口类型。

### 2. 先补 Product Navigation，再谈更多插件

当前 `product.surface` 已经解决“工作面由谁展示”；本阶段已把三个插件原先各自占用的
`sidebar.footer.action` 收敛为一个 Core-owned 产品入口组。这个 DSH rc.2 slot 的官方语义只是
Settings 旁边的 footer 小动作，因此它只作为 pinned rc.2 的兼容承载位，不再是插件的入口契约。

二期第一刀是现有 layout patch 的 `Product Navigation v1`：

- 插件只声明 `id`、`label`、`icon`、`order` 四项 metadata；`id` 必须与对应
  `product.surface` 相同；
- 新插件没有专属图标时使用公共 `plugin` 图标，不需要先修改 Core；新增专属图标必须有
  真实产品需要并单独升级契约；
- Core 统一负责入口排列、展开/收起表现、tooltip、active 样式、点击后的
  `openProductSurface` 和生命周期注销；
- Core 从已批准的 DSH 图标语义中渲染 icon，不接受插件 JSX、SVG、React component 或
  自定义点击回调；
- active 状态只来自当前 Product Surface，不在插件内复制一份 selection state；Layout 的主
  工作区只允许 `conversation` 或一个 Product Surface，当前会话仍只由 DSH `sessions` service
  持有；
- 重复 id、空 id/label、非法 icon/order 都直接失败；插件卸载时入口一起消失，若当前
  正在显示该工作面则回到 Conversation；
- pinned DSH rc.2 没有一级全局导航 slot，本轮用一个 Core-owned 产品入口组挂入现有
  footer seat，插件不再直接占用该 seat；前台会话点击、搜索打开、分叉后打开和新会话会
  回到 Conversation。对同一会话重复点击不会改变 `sessions.current`，因此 bundled DSH
  Workspace 和 Sidebar adapter 通过精确 source patch 调用公开
  `ctx.layout.closeProductSurface()`，不复制整套 sidebar、router 或会话状态。

本轮不加入 `badge`、计数、分组、嵌套、用户排序、路由、deeplink、导航级快捷键、权限状态、
任意 callback 或动态 unavailable。整个 Product 不存在就不注册入口；某个业务能力不可用，
由 Product Surface 自己解释。

全局桌面快捷键不属于 Product Navigation v1 的入口能力；它由独立的
[DSH 桌面快捷键中心 spec](desktop-shortcut-center.md) 管理。该中心按插件集中展示真实注册
命令，但不引入导航级快捷键、上下文快捷键或快捷键平台化扩展。

### 3. 三个插件按真实工作流优化

不同时重写三个插件，也不新增业务域。每个插件只选一个最重要的 golden flow，先消除
打开、查找、编辑/执行、完成和反馈中的重复摩擦：

1. Smart Clipboard：快捷键打开后，快速找到一条历史记录、复制/取回并回到原应用；
   完整 History 仍是同一个 Product Surface，native facade 继续独立存在。
2. Personal Organizer：打开后直接进入最常用视图，创建/完成一条事项，并在草稿、
   冲突和保存结果上给出清楚反馈。
3. File Workspace：打开后快速定位文件、编辑并保存；导入、同名冲突和失败重试保持在
   同一个工作面，不增加第二套文件壳。

优化顺序固定为 Smart Clipboard -> Organizer -> File Workspace，因为前者已有真实
桌面入口和完整 History，后两者可以复用导航迁移后的观察点。每次只改一个插件的页面
或业务编排，并保留已有 Canonical service、RPC、revision 和权限边界。

### 4. AI 通过 DSH 正式能力进入，不在插件里另起模型链路

AI 是第四阶段，入口只有 DSH Session。目标不是让 AI“什么都能做”，而是让它能在用户
明确意图下读取和调用已经存在的插件能力：

```text
DSH Session -> Model -> plugin Resource / Tool / Skill -> plugin Canonical service
```

- Resource：先提供安全、只读、可摘要的列表或单条投影；不默认注入全部正文；
- Tool：只暴露少量高价值业务动作，写操作沿用 DSH Approval、权限、幂等和 revision；
- Skill：说明何时使用 Resource/Tool 及参数边界，不在 Skill 中复制业务规则；
- Organizer 先做第一条 AI 闭环；Smart Clipboard 只考虑单条历史摘要/取回场景；
  File Workspace 等公共 projection 明确后再接入；
- 不在 Product Plugin 中调用模型、不保存 Provider 凭据、不把 `ctx.llm` 或原始 MCP
  客户端塞进插件、不做 RAG/vector store、后台自动 Agent 或第二套聊天 UI。

每一个 AI 动作都必须能回读 Canonical 结果；没有成功结果，不能向用户声称“已保存”、
“已完成”或“已读取”。

## 分阶段交付

### 阶段 A：Core/DSH 公共边界

状态：`COMPLETED`。Product Navigation v1、互斥的主工作区导航、Core-owned renderer、生命周期
注销、generation 校验和 runtime patch metadata 已完成，并通过 layout、打包补丁和三个业务
插件的既有资格测试。

交付物：

- `Product Navigation v1` typed contract 和版本标记；
- 一个 Core-owned renderer，三个插件只注册 metadata；
- `product.surface` 的打开、关闭、active 反馈、卸载行为以及前台会话返回保持同一条状态链；
- DSH Workspace 的前台会话导航补丁只依赖公开 `ctx.layout`，由 runtime manifest、afterPack
  和安装后验证共同校验；
- Product Surface 离开保护只在出现真实会丢失 draft 的页面后加入，优先做统一的
  `dirty` 布尔 guard，不做完整导航框架；
- DSH pinned generation、layout patch metadata、构建摘要和安装后校验同步升级。

验收：三个插件在展开和收起侧栏下入口尺寸、label、icon、active/focus 表现一致；源码中
不再有插件自己的 `Sidebar...Navigation` 组件或直接的产品入口 footer registration；
停用和重新激活不留下 dangling entry。

### 阶段 B：三个插件的 golden flow

状态：`COMPLETED`。三个插件已经分别完成最小 golden flow、隔离宿主资格测试和桌面截图检查；
没有因为“功能还可以继续加”而扩大业务范围。

交付物：每次只推进一个插件，补必要的状态反馈、空态、失败态、重试和响应式布局；不以
样式快照代替业务验收。

验收：使用真实源码版 DSH Web 和隔离的测试数据目录完成主要流程，关键状态有可见结果，
并用桌面截图检查宽窗口、窄窗口、收起侧栏、工作面打开后的布局，没有文字溢出或控件
重叠。

### 阶段 C：DSH AI 第一条闭环

状态：`COMPLETED`。Organizer 已通过官方 `@deepseek-ai/dsh-llm-replay@0.1.1-rc.2`
完成无密钥的真实 DSH Session 资格测试；生产 Provider 的凭据联调属于单独的环境资格，不作为
本次代码闭环的前置条件。

交付物：以 Organizer 为首个样板，打通一个只读摘要 Tool、一个需要 Approval 的 Tool 和
一份 Skill；用同一条 Canonical service 支撑页面操作与 AI 操作，并记录成功/拒绝/冲突
的可回读结果。正式 Resource contract 出现后，再把只读摘要迁移到 Resource。

当前 pinned rc.2 没有可供第一方插件注册的独立 Resource API，因此本阶段先用
`organizer_list_today` 这个只读、摘要化 Tool 作为数据入口；它不是伪造 Resource，也不把
正文默认注入模型。待 DSH 提供正式 typed Resource contract 后，再把同一投影迁移到该
contract，Organizer 的 Skill 和 Canonical service 不改。当前已完成 Skill、只读摘要 Tool、
写入 Tool 的 `ask` 审批门，以及真实 DSH Conversation 的读取、审批、follow-up 和 Canonical
回读资格测试；测试使用官方 replay，不触碰 Provider 凭据。

验收：从同一 DSH Session 发起读取、写入和 follow-up，权限拒绝不会写入，旧 revision
不会覆盖新数据，停用插件后只读摘要 Tool、写入 Tool 和 Skill 一起消失。

### 阶段 D：新插件快速接入

状态：`COMPLETED`。Reference Plugin 现在包含一个不承载业务的最小 Product Surface 示例：
stock DSH 只验证 Settings/Tool，Hermit patched DSH 额外验证入口、工作面、返回对话和卸载。
接入顺序与边界已整理到 `docs/development/product-plugin-quickstart.md`。

交付物：把 Reference Plugin、Product Navigation、Product Surface、Resource/Tool/Skill
和测试命令整理成最小 quickstart；只沉淀已被三个插件验证过的公共 contract。

验收：一个不依赖业务插件的最小示例可以在不读取 DSH 私有源码、不使用 Electron、不复制
React 的前提下完成安装、激活、显示入口、打开工作面、返回 Conversation 和卸载。

### 阶段 E：Personal Organizer 的 Desktop capability seam

状态：`CORE_API_IMPLEMENTED`。本阶段先把 Reminder 真正需要的桌面能力收敛为两个窄的公开
facade，不把 Reminder 业务搬进 Core。

已完成：

- `desktop.deadlines`：接受不透明 ID 和绝对 UTC instant，支持重设、幂等取消和 fired 事件；
- `desktop.notifications`：支持状态查询、显示/替换/移除安全摘要，以及点击、动作和失败事件；
- preload、主进程 IPC、sender/schema 校验、owner/generation 清理和纯 Web unavailable；
- Core、IPC、layout public getter 和打包入口检查。

仍待 Organizer 后续 Reminder vertical slice 完成：从 Canonical Rule/Occurrence 计算下一次
绝对时刻、收到 fired 后幂等认领、投递摘要并记录 delivery 结果。重复、时区/DST、snooze/
dismiss、Today/Reminder Center 和重启 reconcile 继续由 Organizer 自己负责。

验收：Core 的 API、失败、替换、owner 隔离和 generation 清理测试通过；Organizer 接入时再
增加真实 packaged Reminder 流程，不把当前 Core API 测试结果当成 Reminder 业务完成证明。

## 明确不做

二期不做以下事项：

- 通用 `desktopAPI`、Desktop SDK、capability registry、任意 IPC 或插件运行时注入 DOM；
- 重写 DSH Workspace/Session 模型、私有 Router、第二个 React root 或第二套 UI foundation；
- 全局搜索、导航分组/嵌套、用户拖拽排序、收藏/pin、导航级快捷键和自定义右键菜单；
- draft persistence framework、app quit/window close dirty guard 和后台自动 Agent；
- 为“以后可能需要”提前增加通用通知平台、文件选择器、权限中心、RAG/vector、同步或云端服务；
  本阶段只因 Personal Organizer 的真实 Reminder 闭环增加两个窄的 Desktop Core capability：
  `desktop.deadlines`（绝对时刻等待）和 `desktop.notifications`（系统投递），不包含 Reminder
  业务状态、重复规则、snooze、通用调度器或 Core 业务数据库；
- 为了覆盖率增加 padding、颜色、README 或大面积 UI snapshot 测试。

## 完成门槛

二期不以“代码合并”作为完成，而以以下事实收口：

1. `Product Navigation v1`、插件接入和 DSH generation 校验在代码、类型、测试和文档中
   只有一个权威定义；
2. 三个插件各自的 golden flow 在真实宿主中可操作，正常、空态、失败、取消/重试和
   生命周期行为可观察；
3. AI 第一条闭环只通过 DSH 公开 Session/Resource/Tool/Skill，并能读回业务结果；
4. 测试使用独立 userData/profile，不触碰已安装的 v0.1.0、真实剪贴板、用户文件或凭据；
5. 目标平台的“本机观察可运行”、项目已验证、允许发布继续分开记录，Node 24.x 资格门
   不能被当前 Node 25 的本机运行结果替代。

## 调研依据

本方向参考了相似产品和官方资料，但不把它们的完整平台复杂度搬入 Hermit：

- [Raycast extension terminology](https://developers.raycast.com/information/terminology)：
  入口由 manifest metadata 和宿主负责，扩展拥有进入后的工作面；
- [Raycast Actions](https://developers.raycast.com/api-reference/user-interface/actions)：
  常用动作由统一宿主 UI 承载；
- [VS Code View Containers](https://code.visualstudio.com/api/references/contribution-points)：
  扩展声明容器 metadata，Activity Bar 由 Workbench 渲染；Hermit 只借鉴边界，不复制其
  完整扩展平台；
- [Maccy](https://github.com/p0deje/Maccy)：全局快捷键、系统剪贴板和自动粘贴是具体的
  剪贴板产品能力，不是建设万能桌面扩展层的理由；
- [Notion MCP overview](https://developers.notion.com/guides/mcp/overview)：AI 接入应
  使用明确的资源和动作边界，并保留权限与用户控制；
- [DSH pinned source snapshot](https://github.com/deepseek-ai/deepseek-harness/tree/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e)：
  Hermit 当前以固定 rc.2 generation 作为兼容基线。
