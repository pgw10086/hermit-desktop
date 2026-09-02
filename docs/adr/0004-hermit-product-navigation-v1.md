# ADR-0004：Hermit Product Navigation v1 收回插件入口宿主

状态：`accepted`

日期：2026-09-01

## 背景

v0.1.0 的三个 Product Plugin 都能打开自己的 Product Surface，但每个插件还重复注册
`sidebar.footer.action` 并各自实现 wide/collapsed 按钮。这个 DSH rc.2 slot 的官方语义是
Settings 旁边的可选 footer action，不是一级产品导航；继续复制按钮会让入口布局、active
状态和生命周期逐渐分叉。

## 决策

在现有 Hermit `@deepseek-ai/dsh-client-ui-layout` source patch 中增加
`Product Navigation v1`，但不建设通用 Desktop SDK：

- `ILayout` 增加 `productNavigationContract = 1`、`registerProductEntry()`、
  `getProductNavigationState()` 和 `subscribeProductNavigation()`；
- `ProductEntry` 只有与 `product.surface` 相同的 `id`、展示用 `label`、受批准的 `icon` 和
  稳定 `order`；不接受 JSX、SVG、React component、route、badge、permission 或 click handler；
- Core 统一渲染入口、active 状态、展开/收起表现和注销；Product Plugin 只声明 metadata，
  继续拥有自己的 Product Surface、业务状态和 Canonical service；
- pinned DSH rc.2 暂无一级全局导航 slot，因此 v1 注册一个 Core-owned 产品入口组到
  `sidebar.footer.action`，三个插件不再直接注册该 slot。这个承载方式不改变 DSH 官方
  footer slot 的语义；上游提供等价公开 seam 或真实使用证明必要时，再做精确位置迁移；
- Product Surface 当前没有 dirty guard，下一步仅在真实丢失 draft 的流程出现后增加统一
  transition guard，不在插件内各做一套拦截。

## 影响

这次修改只扩大 Hermit layout patch 的公开 typed contract，不改变 DSH 官方 stock package，
也不改变 Electron、IPC、剪贴板、快捷键或任何插件业务接口。patch contract version 从 1
提升为 2；bundled runtime、after-pack 校验和 Product Surface 资格必须一起识别新 metadata
和 `registerProductEntry`。

三个插件的入口不再拥有按钮 React 组件，因此未来新增 Product Plugin 只需要注册一个
metadata 和一个 Product Surface；入口 UI 只有一个 Core 负责人。由于 `sidebar.footer.action`
仍是兼容承载位置，若未来 DSH 新增正式一级导航 seam，应优先迁移 Core renderer，不增加插件
侧的兼容双注册。
