# Agent Desktop Core 开发规范

状态：`current`

Core package 内部边界、Runtime Adapter 生命周期和 Core 仓库工程规则现在分别以外层入口下的
`agent-desktop-core/docs/architecture/system-boundaries.md`、
`agent-desktop-core/docs/contracts/runtime-adapter.md` 和
`agent-desktop-core/docs/development/engineering-rules.md` 为准。本文保留 Hermit 对 Core 的
产品集成、DSH Layout 和打包资格要求，不再作为 Core package 的独立事实源。

本文面向 Agent Desktop Core 和 Runtime Adapter 维护者，只说明共享桌面 Core 什么时候存在、
应该提供什么，以及插件怎样安全地使用它。新 Product Plugin 开发者应先阅读
[Product Plugin 最小接入](product-plugin-quickstart.md)。

本文不是 Electron 教程，也不复制 DSH 官方插件文档。本文只定义 Agent Desktop Core 的长期职责
和通用规则；具体 Surface 的接口形状、阶段范围和验收以
[Desktop Surface 与 Quick Panel spec](../../specs/2026-08-24-hermit-dsh-vnext/desktop-surface-quick-panel.md)、
[DSH 桌面快捷键中心 spec](../../specs/2026-08-24-hermit-dsh-vnext/desktop-shortcut-center.md)
和实际 typed contract 为准。

## 先用哪一层

遇到一个新需求时，按这个顺序判断：

```text
DSH 官方公开能力 -> Product Plugin 业务代码 -> Agent Desktop Core 桌面能力
```

- DSH 已经有合适、公开并经过 Hermit 验证的能力，就直接使用 DSH。
- 需求属于某个产品的业务规则、数据或页面，就放在 Product Plugin。
- 只有确实需要 Electron、操作系统或整台桌面的共享资源，才进入 Desktop Core。

“进入 Core 比较方便”不是理由。新增能力时要能说清楚 DSH 为什么不够，以及哪个真实产品
流程正在使用它。

## Agent Desktop Core 负责什么

Agent Desktop Core 是桌面外壳和原生能力的负责人，常见范围包括：

- Electron 应用生命周期、窗口、Tray、单实例和退出协调；
- 系统剪贴板读写或监听；
- 全局快捷键；
- 需要置顶、独立尺寸或鼠标附近显示的原生窗口；
- 系统通知、焦点恢复和操作系统权限探测；
- 原生 addon、系统文件选择器等确实无法由 DSH Web 完成的能力。

普通业务文件读写、业务存储、业务搜索、页面列表和编辑器不属于 Core，优先走 DSH 或插件
自己的业务代码。

## Agent Runtime Adapter 边界

`@platform/agent-desktop-core` 是可以被多个 Agent Desktop 消费的版本化 package。它只提供稳定的
桌面平台能力和 typed contract，不拥有某个 Agent 的 Web/Layout、Conversation、Session、Settings、
Approval、导航、插件清单或业务数据库。

`@platform/dsh-runtime-adapter` 是当前 DSH 的具体 runtime adapter。它依赖 Core，负责 DSH command、
ready 探测、carrier、崩溃恢复和 generation。未来其他 Agent 只能通过自己的 adapter 接入，不把
Agent 的 Conversation、Session、Tool、Approval 或模型 API 塞进 Core。

每个 Product Desktop 自己决定：

- 使用哪个 DSH package 版本和上游 commit；
- 使用哪一份 DSH profile/home、runtime generation 和 layout/source patch；
- 装配哪些 Product Plugin；
- 如何打包、发布和回滚自己的产品。

Agent Desktop Core 可以提供通用运行时生命周期契约；DSH adapter 才负责“启动、监督、停止 DSH runtime”。
它们都不能决定产品使用哪套 DSH Web、layout patch 或插件集合。Smart Clipboard 等单一产品的 SQLite、
捕获编排和 native bridge 属于产品专属 desktop-adapter，不进入共享 Core。

## Desktop Surface

Desktop Surface 是 Agent Desktop Core 对外提供的受控桌面工作面能力。它可以承载某个 Agent 的
`runtime-view` 或 Product Plugin 已注册的工作面；具体 `runtimeId`、`kind` 和内容由各自的 typed
contract 决定，Core 不绑定 DSH。

主窗口的主工作区由 layout Core 统一建模为“会话区”或“一个 Product Surface”二选一。插件
入口点击只负责打开自己的 Surface；用户从 DSH 的会话列表、搜索结果、分叉结果或新会话入口
进入前台会话时，Core 负责关闭 Product Surface。当前会话的身份和历史仍归 DSH `sessions`
service，Core 不复制一份 `sessionId`，也不把插件页面改造成第二套路由。

Core 负责窗口宿主、屏幕和工作区、焦点、窗口策略、可见性、平台降级以及停用/卸载清理；DSH 或
插件负责 Surface 内的会话、业务数据、业务动作和状态。Surface API 允许插件表达标题栏、拖动、
缩放、位置、尺寸、焦点、置顶、Esc/失焦和记忆偏好，Core 返回当前平台实际生效的结果，不把
每种未来窗口形态提前写成固定枚举。

第一条实现是 `conversation.quick`：它使用无标题栏、可拖动、不可缩放、非置顶、失焦不自动隐藏的普通窗口，刚打开
是紧凑草稿态，首条消息提交后切换到聊天态；从隐藏状态再次打开和点击“新建对话”都回到新的
DSH 会话草稿。聊天态的“打开主窗口”通过公开 `openMainSession(sessionId)` 交接当前会话。
这些是该 Surface 的具体偏好。Smart Clipboard 的快速取回和未来 Organizer Todo 小窗可以复用
同一个 Manager，但不能因此共享业务状态或互相调用内部实现。审批使用独立的
`approval.companion` Surface，不嵌进 Quick 页面，也不强制跳回主窗口。

### Deadline 与系统通知

Personal Organizer 的 Reminder 是当前真实使用者，因此 Desktop Core 提供两项已经验证的
窄能力。它们位于 Hermit patched DSH layout client 的公开出口：

```ts
import {
  getDesktopDeadlineClient,
  getDesktopNotificationClient,
} from '@deepseek-ai/dsh-client-ui-layout/client'
```

- `getDesktopDeadlineClient()` 返回 `arm({ id, fireAt })`、`cancel(id)` 和 `observe(listener)`。
  `fireAt` 必须是带 `Z` 的 UTC ISO instant；到期事件只携带不透明 `id`、原定时刻和实际
  触发时刻。相同 `id` 的再次 `arm` 会替换旧等待，`cancel` 幂等。
- `getDesktopNotificationClient()` 返回 `status()`、`show(input)`、`replace(input)`、
  `remove(id)` 和 `observe(listener)`。通知只接受稳定 `id`、标题、正文和最多三个有限动作；
  相同 `id` 的显示会替换已有通知。状态会明确返回 `supported` 与
  `granted/denied/unknown/unsupported`，当前 Electron 跨平台适配无法读取系统授权细节时返回
  `unknown`，不把“调用成功”伪装成用户已经授权。

两项 facade 在纯 Web 或没有受信 preload 时返回 `undefined`。桌面壳通过独立的
`desktop:deadlines` 和 `desktop:notifications` IPC channel 处理请求，主进程校验
sender 和输入，事件只回发给发起窗口；这不是通用 IPC，也不允许插件传入 Electron 对象。
`unavailable`、`permission denied`、单次通知 `failed` 和窗口/Core 停止都只是桌面渠道状态，
调用方必须保留自己的业务事实。

这些 `desktop:*` channel 是 Desktop Core 的平台契约，不带具体产品名。修改名称时必须同步
更新 Core、preload、主进程注册和消费者测试；不保留旧 channel alias，避免两个事实入口长期并存。

Organizer 的正确调用顺序是“自己从 Rule 算出下一次绝对时刻 -> arm deadline -> 收到 fire 后
幂等认领 Occurrence -> show/replace 安全摘要 -> 记录 delivery 结果”。Core 不提供 Reminder
数据库、重复规则、snooze、默认时区、自然语言解析或应用完全退出后的跨平台定时保证。
当前 Core bridge 已完成接口、失败和生命周期测试；Organizer 的 Reminder vertical slice
接入仍以自身 DESIGN 和业务验收为准。

## 对外只给能力

当某项桌面能力经过真实使用、接口确认和资格验证后，插件看到的应该是稳定的 TypeScript
能力接口，而不是 Electron 对象。例如，接口形状可以是：

```ts
clipboard.observe()
shortcut.register(command)
quickSurface.open(options)
```

插件侧的 Desktop Surface contract 位于 Hermit DSH layout client 公共出口，可通过
`getDesktopSurfaceClient()` 取得 `open/toggle/resize/close/openMainSession/capabilities`。其中 `resize`
只调整已有窗口尺寸，不触发页面加载或 Session 选择。Surface 注册时可声明 `chrome`、`movable`、
`resizable`、`alwaysOnTop`、最小/最大尺寸、Esc/失焦行为以及位置/尺寸记忆；打开时只覆盖
位置、尺寸、焦点、置顶和 Session 等请求级偏好。桌面壳缺少该 bridge 时
返回 `undefined`。窗口注册、renderer loader 和 Electron 句柄仍只在 Agent Desktop Core 内部；
`ShortcutRegistry` 也继续由 Core 持有；快捷键中心只消费 Core 的列表、更新、恢复和变化通知，
不把 Electron 句柄或插件回调暴露给 DSH Client。

需要在临时工作面结束后回到原应用时，Surface 定义使用 `dismiss: 'restore-previous'`。Core 在
`show/focus` 前捕获一次 `DesktopFocusLease`：若已有本进程窗口获得焦点，优先恢复该窗口；否则
调用 Product Desktop 注入的 `DesktopFocusPort`。关闭调用可用 `keep-current` 保持当前焦点，或用
`external-handoff` 表示另一个受信任流程（例如打开主窗口或显式粘贴）会接管焦点。焦点恢复是
best-effort 的平台能力，失败必须有可观察结果；500ms activation guard 仅保护 macOS 延迟
`activate` 事件，不能替代焦点租约。

不要向插件暴露 `BrowserWindow`、`ipcRenderer`、Node 文件系统、原生模块实例或通用 IPC
转发器。无标题栏 Surface 的拖动区域由页面用公开 `data-hermit-drag-region` 声明，按钮等交互区
用 `data-hermit-no-drag` 标记；Core 内部可以使用 Electron，但插件只能通过公开的 Surface、快捷键
或其他 typed capability 表达意图即可。

当前 Surface 的位置/尺寸记忆只覆盖同一窗口实例隐藏后的重开；跨应用重启持久化需要单独的 Core
状态设计和验收，不能从 `rememberPosition`/`rememberSize` 字段名推断已经支持。

### 快捷键 Registry

快捷键是共享的系统资源，不能由每个插件各自调用 Electron。插件桌面适配层向 Agent Desktop Core 提交
`id`、`pluginId`、插件/命令展示名称、默认 accelerator 和触发回调，Core 负责读取
`userData/desktop/shortcuts.json`、检查 Hermit 内部重复、调用系统注册并在停用时释放。

- `register` 返回 `registered`、`conflict` 或 `unavailable`，注册失败不会抛出为插件启动失败；
- Hermit 内部重复在调用系统前标记为 `internal-conflict`；系统或其他应用冲突以系统返回为准，
  标记为 `external-or-system-conflict`；
- 修改快捷键先注册新组合，成功后才释放旧组合；失败时旧组合和已保存配置都不变；
- Core 只保存用户成功应用的组合，默认组合冲突时下次启动仍会重新尝试默认值；
- DSH 或插件运行单元停用时，先释放 binding，再释放捕获、IPC、窗口等其他资源。

统一设置页位于 bundled DSH 的“设置 -> 快捷键”，按 `pluginId` 竖向分组。Smart Clipboard
和 `conversation.quick` 是当前真实注册者；Organizer、File Workspace 没有真实桌面快捷键
动作前不注册空行。快捷键中心的 UI 和 renderer facade 属于 Hermit layout patch，业务插件
只负责注册命令 metadata 和触发后的业务动作。

因此，Smart Clipboard 的快捷键冲突只让“快速取回”不可用，剪贴板捕获、History 和 IPC
仍然可以继续工作；DSH 崩溃或插件资格失败才会撤销整个 Smart Clipboard 桌面运行单元。

每个能力都应该说明：

- 能做什么和不能做什么；
- 成功、取消、权限拒绝和暂时不可用时返回什么；
- 由哪个插件申请，以及如何在插件停用时释放；
- macOS、Windows 或其他平台当前是否可用。

不要求所有平台一次实现。某个平台暂时不可用时，要返回清楚的 `unavailable`，不要偷偷
加载一个行为不同的替代实现。

## 生命周期

Core 创建的窗口、快捷键、监听器、定时器、IPC handler、数据库连接和原生资源，都必须归
当前 activation generation 所有。

- 启动失败时，已经创建的资源要按顺序清理；
- 停用或卸载插件时，先让旧回调失效，再释放资源；
- DSH 重启、应用退出和崩溃恢复都要经过同一套可重复调用的停止流程；
- 异步结果回来时，先确认 generation 仍然有效，过期结果不能再产生副作用。

## 安全边界

- 主进程持有 Electron 和系统权限；Renderer 使用 `contextIsolation`、sandbox 和最小
  preload；
- IPC 请求必须校验发送窗口和输入数据；
- 事件通知只传状态变化，不广播剪贴板正文、完整路径或其他不必要的数据；
- Core 不保存插件的业务规则、AI 会话、模型凭据或第二份业务数据；
- 真实用户数据、凭据和系统剪贴板不进入测试 fixture。

详细的 Electron/DSH 运行时安全边界见
[系统边界](../architecture/system-boundaries.md)、[DSH 集成契约](../contracts/dsh-integration.md)
和[产品插件安全契约](../contracts/product-plugin-security.md)。

## 新增能力的最小检查

新增 Desktop capability 前，补充以下事实即可：

1. 真实使用它的产品流程；
2. DSH 官方能力为什么不能完成；
3. 对外 TypeScript 接口和失败结果；
4. 停用、卸载和退出时的清理方式；
5. 至少一条打包后的真实流程验证。

可以建立可扩展的 Desktop Surface service，但不提前实现没有真实使用者的窗口类型。每个新
Surface 仍需说明真实产品流程、typed contract、失败结果、生命周期和至少一条打包验证；这些
是通用治理要求，不是把未来所有窗口选项一次性冻结。

## 和 Product Plugin 的关系

Product Plugin 只依赖已经公开并经过验证的 contract，不依赖任一 Product Desktop 的内部
文件，也不直接导入 Electron。当前 Hermit Product Navigation/Product Surface 使用的是
Hermit patched DSH 的公开 layout contract；新产品可以维护自己的 layout contract，但不能
直接修改 Hermit 的 layout patch。Desktop Surface 由 Core 提供宿主，插件只注册内容和业务
动作。固定 pinned DSH 的 Workspace 和 Sidebar adapter 通过公开
`ctx.layout.closeProductSurface()` 把前台会话导航交还给 Core；这是 bundled generation 的
底座适配，不是插件可调用的私有实现。
插件负责业务含义，Core 负责把桌面能力安全地执行出来：

```text
插件：选择哪条历史、执行什么业务动作
  -> 已公开的 Desktop Core contract：执行受限桌面动作
  -> 插件：根据结果更新自己的业务状态和页面
```

需要 DSH Web 能完成的事情，不得为了统一而绕到 Core。需要桌面特权的事情，也不得为了
“插件独立”而把 Electron 代码塞进普通 Product Plugin。

## 验收

- Desktop Core 自己的测试覆盖能力接口、失败结果和资源释放；
- 使用 Core 的插件增加打包后的桌面流程测试；
- 纯 Web 插件不因为随桌面发布而继承 Desktop Core 验收；
- DSH 或 Electron 版本变化时，重新验证实际使用的能力，不把一次测试结果写成永久保证。

打包、制品和双宿主资格见
[Hermit DSH 集成与打包标准](dsh-plugin-development-and-packaging.md)。
