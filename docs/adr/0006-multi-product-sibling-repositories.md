# ADR-0006：多产品采用 sibling Git 仓库并共享版本化 Desktop Core

状态：`superseded by ADR-0007`

日期：2026-09-03

替代：[ADR-0007：Agent Desktop Core 与 Runtime Adapter 分层](0007-agent-desktop-core-runtime-adapters.md)

跨项目的当前入口已迁移到外层 `docs/adr/0007-agent-desktop-core-runtime-adapters.md`；本文只保留
Hermit Desktop 仓库内的历史记录。

以下正文保留原多产品拆仓决定，用于历史追溯；当前仓库不再维护 `new-product-desktop`。

## 背景

Hermit vNext 当前把 Desktop、DSH Layout 和三个 Product Plugin 放在同一个 pnpm workspace
中。新产品会大幅改变 Conversation、Session、Settings、Approval 和导航的界面与组合方式，
但仍需要复用已经验证的 DSH 底层 AI 能力和 Desktop Core 桌面能力。

若把新产品继续塞进 Hermit Desktop，同一套主窗口和 Layout 会逐渐出现大量产品条件分支；
若复制整套 Desktop 和 DSH，则进程监管、安全、Session 和 Approval 语义会形成两份实现。

## 决策

采用同一普通父文件夹下的多个 sibling Git 仓库。父文件夹不是 Git 仓库，也不是超级
pnpm workspace：

- `desktop-core/` 提供版本化 `@tianbuyv/agent-desktop-core` package，负责 Electron、系统能力、
  受控 IPC、生命周期、Surface 和 DSH 进程监管；
- `hermit-desktop/` 独立拥有 Hermit 产品壳、Hermit DSH Layout/source patch、runtime
  generation、profile、插件组合、打包和发布；
- `new-product-desktop/` 独立拥有新产品的产品壳、交互组合、DSH Layout/source patch、
  runtime generation、profile、插件组合、打包和发布；
- 每个 Product Plugin 最终拥有自己的 Git 仓库和制品版本；带桌面专属能力的插件将
  desktop adapter 与该插件一起维护，但只能通过 Desktop Core public contract 接入。

两个产品可以锁定同一个 DSH 上游 commit 和保持相同的 Session、Tool、Approval 等底层
语义，但各自决定 DSH Web/Layout、插件清单和 runtime generation。它们不能在同一运行时
混用两份 Layout，也不能修改对方的产品 UI。

跨仓库正式依赖只使用发布 package 或带固定版本和摘要的 tarball。禁止跨 sibling 仓库
引用 `src/*`、使用 `workspace:*`、`link:` 或 `file:../`。本地联调可以把 sibling 构建成
tarball 再安装，但 CI 和发布必须能在没有 sibling 源码的干净环境中重建。

只有产品需要改变 DSH 底层状态语义、协议或执行模型，而公开 Layout/slot/service 已无法
表达时，才建立新产品的 DSH fork。单纯重做页面、导航或布局不构成 fork 理由。

## 术语澄清

[ADR-0004](0004-hermit-product-navigation-v1.md) 和
[ADR-0005](0005-hermit-primary-workspace-navigation.md) 中负责 Hermit 主工作区和产品导航的
“Core”是 Hermit DSH Layout 的产品级 Layout Core，不是本 ADR 定义的共享 Desktop Core。
这两个 ADR 的交互行为继续只约束 Hermit Desktop；新产品拥有自己的 Layout 和交互验收。

## 影响

- Desktop Core 的变更需要维护公共 API 兼容性，并至少由两个 Product Desktop 的集成测试
  验证后再发布；
- Hermit 和新产品各自维护 lockfile、runtime manifest、产品数据目录和发布节奏；
- 插件拆仓发生在 Desktop Core 和 Hermit Desktop 的制品依赖闭环稳定之后，避免一次同时
  改变所有边界；
- 迁移完成后，`hermit-vnext` 只作为远程历史来源；本地 checkout 已移除，不得继续在两处
  并行开发同一事实；
- 暂不创建共享 UI 仓库或 integration 仓库。只有出现两个真实消费者和独立发布需要时，
  再用新的 ADR 决定是否增加。

## 未选择的方案

- **一个超级 monorepo**：本地联调方便，但两个产品仍共享 lockfile 和发布边界，无法满足
  独立打包、独立演进的目标。
- **只做 Git submodule**：能固定提交，但没有解决 package API、制品验证和独立构建问题。
- **复制 Desktop 和 DSH**：短期最快，长期会让生命周期、安全和底层 AI 语义分叉。
- **现在建立共享 UI 平台**：目前只有一套真实产品 UI，抽象依据不足，容易把 Hermit 页面
  误当成公共标准。
