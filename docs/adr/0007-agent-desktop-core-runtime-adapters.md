# ADR-0007：Agent Desktop Core 与 Runtime Adapter 分层

状态：`accepted`

日期：2026-09-04

## 背景

原来的 `desktop-core` package 同时放了通用 Electron/Desktop 能力和 DSH 专属运行协议。两类代码
的变化原因不同：窗口、快捷键和通知可以被多个 Agent Desktop 复用；DSH command、ready 探测、
carrier 和 generation 会随 DSH 版本变化。新产品计划已取消，当前先服务 Hermit Desktop，并为
未来可能的其他 Agent Runtime 保留窄的生命周期扩展点。

## 决策

共享仓库改名为 `agent-desktop-core`，先在同一个 Git 仓库维护两个 package：

- `@platform/agent-desktop-core`：窗口/Surface、快捷键、通知、deadline、生命周期、受控 IPC、
  证据和最小 `AgentRuntimeAdapter` 生命周期契约；不理解 DSH 或 Agent 业务语义；
- `@platform/dsh-runtime-adapter`：DSH command、ready 探测、carrier 停止协议、DSH 进程监督、
  DSH generation 和相关诊断；依赖前者，不反向被 Core 依赖。

Product Desktop 是组合根，负责选择 Node、Agent Runtime、版本、profile、layout、插件和打包
制品。当前 Hermit 同时消费两个固定 tarball。未来其他 Agent 通过新增 adapter 接入，不能把
Conversation、Session、Tool、Approval、模型或凭据 API 统一塞进 Core。

Desktop Surface 的运行时内容使用中性的 `runtime-view` 并携带 `runtimeId`；Core 不再使用
`dsh-conversation` 这样的具体 Agent 类型名。

## 取舍

现在拆 package 但不拆第二个 Git 仓库，能让依赖边界在代码层面成立，又避免 Core 与 Adapter
跨仓库同步、版本和发布成本。只有 Adapter 出现独立 owner、独立发布周期、显著特殊依赖或大量
外部消费者时，才另建仓库。

原多产品拆仓方案和 `new-product-desktop` 已取消；旧方案文档保留为历史记录并由本 ADR 取代。

## 依赖方向

```text
@platform/dsh-runtime-adapter -> @platform/agent-desktop-core

hermit-desktop -> @platform/agent-desktop-core
hermit-desktop -> @platform/dsh-runtime-adapter
hermit-desktop -> bundled DSH/Layout + first-party plugins
```

Core 负责承载运行时，但 Core 本身不是 Agent Runtime。
