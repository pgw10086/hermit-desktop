# Product Plugin 最小接入

状态：`current`

本文是新 Product Plugin 接入 Hermit vNext 的唯一 `Start Here` 页面。先在这里确认平台
能提供什么，再决定插件应该使用 DSH、自己的业务代码，还是 Desktop Core。本文只引用已经
被三个业务插件和 [`@hermit/dsh-plugin-reference`](../../packages/dsh-plugin-reference/README.md)
验证过的公开契约，不提供业务基类，也不复制 DSH 私有实现。

## Core 能力一览

这里的 Core 分成两层：DSH Core 负责插件运行时和 AI；Desktop Core 负责 Electron、操作系统
和桌面资源。能力“已经存在”不等于“插件可以直接调用”，以“插件接入状态”为准。

| 能力 | 主要用途 | 插件接入方式 | 插件接入状态 |
| --- | --- | --- | --- |
| DSH 插件运行时 | Host、Client、Settings、Tool、Skill、Storage、Connection | DSH 官方 package、service、slot | 可接入，按 DSH 官方资料执行 |
| Product Navigation v1 | 注册产品入口，统一处理 active、排序和收起状态 | `ctx.get('layout')`、`registerProductEntry()` | 可接入，仅 Hermit patched DSH |
| Product Surface v1 | 提供插件自己的产品工作面 | `product.surface` typed slot | 可接入，仅 Hermit patched DSH |
| 桌面应用生命周期 | 窗口、Tray、单实例、退出和 DSH 进程监督 | 无插件直接 API | Desktop Core 内部能力 |
| 系统剪贴板 | 捕获、读取和写回剪贴板 | 当前没有通用插件 API | Smart Clipboard 专属 |
| 全局快捷键 | 注册系统级快捷键 | Core `ShortcutRegistry` | 可申请，仍由 Core 统一注册 |
| Desktop Surface / Quick Panel | 受控桌面窗口、对话或插件工作面 | `DesktopSurfaceClient` typed contract | `conversation.quick` 与 `approval.companion` 已接入，并通过 macOS packaged Quick 烟测 |
| 绝对 Deadline | 等待插件已经计算好的一个绝对 UTC 时刻 | `getDesktopDeadlineClient()` | 可接入，Core bridge 已完成接口和失败测试 |
| 系统通知 | 显示、替换、移除安全摘要并接收点击/动作/失败 | `getDesktopNotificationClient()` | 可接入，平台授权状态需按返回值处理 |

当前 Product Navigation 和 Product Surface 的精确契约见
[DSH 集成契约](../contracts/dsh-integration.md)。Desktop Surface 的目标契约、首条
`conversation.quick` 闭环和 Smart Clipboard 迁移见
[Desktop Surface 与 Quick Panel spec](../../specs/2026-08-24-hermit-dsh-vnext/desktop-surface-quick-panel.md)。
插件在 DSH Client 中通过 `getDesktopSurfaceClient()` 获取可用的
`open/toggle/resize/close/openMainSession/capabilities` 能力；桌面壳缺少该 bridge 时返回 `undefined`。
窗口注册和 renderer loader 仍由 Desktop Core 持有，插件不自行创建窗口。

```ts
const surface = getDesktopSurfaceClient()
if (surface !== undefined) {
  await surface.toggle('organizer.todo-glance', {
    preferredSize: { width: 420, height: 560 },
    alwaysOnTop: true,
  })
}
```

这里的 `id` 必须是已经由 Core 注册的 Surface；插件只表达打开、关闭和窗口偏好，业务内容
仍由自己的 DSH Client/Domain service 提供。需要复用已有会话时，再显式传入
`session: { type: 'existing', sessionId }`。

`openMainSession(sessionId)` 是对话类 Surface 把当前 DSH 会话交给主窗口的公开动作；它不读取主窗口
内部状态，也不复制消息。Surface 的标题栏、拖动、缩放、置顶、位置记忆等行为由注册定义决定，
插件不需要照搬 `conversation.quick` 的偏好；需要审批时使用 DSH 自己的 Approval 链路，不能伪造
`approval.companion`。

Reminder 插件只把已经算好的 `fireAt` 交给 `getDesktopDeadlineClient()`，把不含敏感业务正文
的摘要交给 `getDesktopNotificationClient()`。这两个 client 在纯 Web 中可能不存在，插件必须
保留应用内业务结果并显示 `unavailable`，不能把 Core facade 当作 Reminder store 或通用调度器。

有真实系统级动作时，插件在 Desktop Core 生命周期中注册一个带有 `pluginId`、`pluginName`、
`commandName`、`defaultAccelerator` 和 `onTrigger` 的快捷键定义。用户统一在 DSH“设置 ->
快捷键”中按插件查看、修改或恢复默认值；插件自己的 settings 页面不重复编辑全局快捷键。
注册失败会显示为冲突或不可用，不影响插件其他业务能力。具体字段和状态见
[DSH 桌面快捷键中心 spec](../../specs/2026-08-24-hermit-dsh-vnext/desktop-shortcut-center.md)。

## 先判断应该走哪一层

```text
DSH 已有公开能力
        -> 插件自己的业务能力
                -> 确实需要系统或 Electron 能力时，才进入 Desktop Core
```

- 普通业务数据、页面、搜索和 AI，优先使用 DSH 或插件自己的业务代码。
- 只有系统剪贴板、全局快捷键、原生窗口、绝对 Deadline 或系统通知等桌面能力，才考虑 Desktop Core。
- 插件不能直接导入 Electron、Node、`ipcRenderer`、DSH `src/*`、私有 Router 或私有 DOM。
- stock DSH 没有 Hermit layout service 时，只使用它已有的官方接入面，不注册产品入口。
- Surface 的业务内容和状态仍归插件或 DSH；Core 只提供窗口宿主和平台能力。

## 最小接入顺序

| 步骤 | 使用的公开面 | 结果 |
| --- | --- | --- |
| 1. 安装 | `package.json` 的 DSH bundle/client manifest、`cordis.patch.yml` | 插件可以由 DSH profile 管理 |
| 2. Host | `apply(ctx)`、Settings、Tool、WebServer 或业务 service | 注册服务端能力并随 fiber 释放 |
| 3. Client | `dsh.client`、公开 `./client` export、typed slot | 注册页面或 DSH UI contribution |
| 4. 产品入口 | 可选 `ctx.get('layout')` 和 `ProductEntry` | 只有 Hermit patched DSH 才出现入口 |
| 5. 产品工作面 | `product.surface`，并与入口使用同一个 id | 打开插件自己的业务页面 |
| 6. 业务与 AI | Canonical service、Connection/RPC、DSH Storage、Skill、少量 Tool | 形成业务闭环 |
| 7. 生命周期 | `ctx.effect`、fiber disposer、slot/Tool/Skill/RPC 清理 | 停用或卸载后不残留资源 |

`ProductEntry.id` 必须和 `product.surface` registration 使用同一个稳定身份。Core 负责入口
UI、active、展开/收起和注销；插件只提供 metadata 与自己的工作面。没有正式 Resource API
时，不要伪造 Resource；写操作沿用 DSH Approval、权限、幂等和 revision。

## 通用边界

- 不通过私有 Router、DOM 注入或 Settings tab 冒充 Product Surface；
- 不向插件暴露或从插件获取 `BrowserWindow`、`ipcRenderer`、Node 文件系统、native 模块实例
  或通用 IPC 转发器；
- 不在插件里调用模型、保存 Provider 凭据或打包第二份 React/ReactDOM；
- 不把 stock DSH 的资格结果写成 Hermit Product Surface 已经存在；
- 不把某个插件的业务状态或专属 native bridge 伪装成通用 Desktop Surface 能力。

这些是跨模块的通用边界。Surface 的位置、尺寸、焦点、置顶和内容扩展由具体 typed contract
协商，不在本文重复冻结每一种未来窗口形态。

## 验证

从仓库根目录运行：

```sh
corepack pnpm --filter @hermit/dsh-plugin-reference test
corepack pnpm --filter @hermit/dsh-plugin-reference test:qualification
```

使用 Product Surface 的业务插件，再运行对应的 `test:*:product-surface` 资格命令；需要
AI 闭环时，按插件文档运行对应的 replay 或业务验证。完成插件不只是能编译，还要确认
加载、主要流程、数据回读、停用和资源释放。

参考实现和可执行验收见
[`packages/dsh-plugin-reference/src/client/index.tsx`](../../packages/dsh-plugin-reference/src/client/index.tsx)
与
[`packages/dsh-plugin-reference/tests/reference-plugin.e2e.mjs`](../../packages/dsh-plugin-reference/tests/reference-plugin.e2e.mjs)。

## 深入文档

- [Desktop Core 开发规范](desktop-core-development.md)：Core 维护者如何新增桌面能力；
- [Desktop Surface 与 Quick Panel spec](../../specs/2026-08-24-hermit-dsh-vnext/desktop-surface-quick-panel.md)：Quick Panel、对话小窗口和剪贴板迁移的当前阶段依据；
- [DSH 集成契约](../contracts/dsh-integration.md)：DSH 版本、Hermit patch、运行时和兼容性；
- [产品插件安全契约](../contracts/product-plugin-security.md)：信任、权限、隔离和卸载边界；
- [Hermit DSH 集成与打包标准](dsh-plugin-development-and-packaging.md)：制品、Profile 和资格层级。
