# ADR-0005：Hermit 主工作区采用会话与 Product Surface 互斥导航

状态：`accepted`

日期：2026-09-02

## 背景

ADR-0004 收回了三个插件各自的入口 UI，但只解决了“从入口打开 Product Surface”。实际使用
中，用户打开 Product Surface 后再点击 DSH 会话区，会话虽然可能已经切换，右侧 Product
Surface 却仍然停留在页面上。原因是 Layout 的 `productSurfaceId` 和 DSH `sessions.current`
分属两条状态链；只监听当前会话变化还覆盖不了“重复点击当前会话”的真实操作。

## 决策

主工作区由 Desktop Core 统一维护为两个互斥状态：`conversation` 或一个
`product-surface(surfaceId)`。

- Layout 只拥有主工作区目的地；当前会话身份、历史和会话切换仍由 DSH `sessions` service
  拥有，Core 不复制 `sessionId`。
- Layout 监听 DSH sessions 的公开列表快照。`current` 真正变化时，若当前存在 Product
  Surface，就通过 `LayoutController.closeProductSurface()` 回到会话区；背景列表刷新不触发
  页面切换。
- 对同一会话重复点击、搜索结果、分叉后打开和新会话，Hermit bundled 的固定版本 DSH
  Workspace 和 Sidebar adapter 调用公开的 `ctx.get("layout")?.closeProductSurface()`。
  这个调用只存在于 source-controlled 的精确补丁中，不能扩展为插件私有 API。
- 不增加 tabs、并排工作区、第二套路由或第二份会话状态。Product Surface 的业务页面仍由
  插件自己负责，Core 只负责入口和主工作区切换。

## 影响

这会让用户从任何 DSH 前台会话入口回到唯一会话主工作区，并保持侧边栏和 DSH 会话历史的
所有权不变。重复执行 runtime 准备脚本不会重复注入补丁；固定 DSH 版本、源码锚点、补丁
摘要和 generation manifest 都是打包验收的一部分。

代价是当前 pinned DSH rc.2 需要携带一个小型 source patch。DSH 升级时必须重新核对
Workspace 和 Sidebar adapter 的源码锚点并重新执行打包及前台导航资格；上游提供等价公开 seam 后，应
删除该补丁，而不是长期维护两套实现。

## 验收

- 点击 Product Navigation 入口打开 Product Surface；
- 点击当前会话、其他会话、会话搜索结果、分叉后的会话和“新会话”后，主工作区为
  `conversation`；
- DSH sessions 的后台列表刷新不会关闭用户正在查看的 Product Surface；
- Product Surface 插件卸载后入口和页面一起清理；
- runtime 准备、`afterPack` 和安装后验证都会拒绝缺少或不完整的 Workspace/Sidebar patch。
