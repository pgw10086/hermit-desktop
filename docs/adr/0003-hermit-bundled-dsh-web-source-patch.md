# ADR-0003：允许 Hermit 自带 DSH Web 携带受控 source patch

状态：`accepted`

日期：2026-08-31

## 背景

M1 已确定 Electron + bundled Node + stock DSH Web 的桌面运行底座，且该结论已经通过
本机资格。后续 Smart Clipboard 等 Product Plugin 需要一个可追加的持久业务入口；当前
pinned DSH `0.1.1-rc.2` 的公开 client contract 没有提供该 Product Surface。仅等待上游
会让已经确认的本地产品闭环无法开始，但运行时 DOM 注入、私有 Router、private store 或
直接 import DSH `src/*` 会破坏升级、生命周期和双宿主资格。

## 决策

保留 M1 的 stock DSH carrier 决策，同时允许 Hermit 在自己携带的 DSH Web generation 中
维护最小、source-controlled、精确锁定的 source patch，以补齐已经确认且无法由插件自行
解决的公开 Product Surface。

source patch 必须满足：

- patch 有明确的上游版本、commit/patch digest、变更范围和 owner；
- 通过许可证/notice、依赖闭包、构建产物、SBOM、签名和目标平台审计；
- 先新增 DSH package root、公开 `./client` export、typed slot/service 或同等正式公开
  contract，Product Plugin 只消费这个 contract；
- 在 stock DSH（缺少 patch 时应返回确定性 unavailable）和 Hermit patched DSH 上，用同一个
  plugin artifact 验证安装、激活、刷新恢复、停用和卸载；
- 通过 React/ReactDOM 单实例、renderer 安全、生命周期回收和升级/回滚资格；
- 不修改用户单独安装的 stock DSH，不把完整上游仓库复制成无边界 fork，不为插件暴露私有
  Router、store、DOM、CSS selector 或 `src/*`。

## 影响

- M1 文档仍然描述 stock DSH baseline；source patch 是 M1 之后 Product Surface 的独立
  generation 和 gate，不把 M1 已通过的事实改写成 patched 已通过。
- Product Plugin 可以开始实现，但正式业务切片必须等待 patched Product Surface、Core
  capability 和平台 clipboard 资格全部通过。
- stock DSH 仍是兼容性目标；同一个 artifact 在缺少 Hermit patch 时必须健康安装并清楚显示
  unavailable，不能维护行为不同的第二份发行包。
- 未来若 DSH 上游提供等价公开能力，应优先切回上游 contract，并删除 Hermit patch。

## 实现记录

首个 patch 已在 2026-08-31 落地：

- 上游为 DeepSeek Harness tag `dsh-v0.1.1-rc.2`、commit
  `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`；本地构建输入位于
  `packages/dsh-client-ui-layout/`，包版本仍保持 `0.1.1-rc.2`；
- 新增公开 typed `product.surface` list slot、`openProductSurface(id)`、
  `closeProductSurface()` 和数值型 `productSurfaceContract = 1` 协商标记；
- 插件只从公开 `@deepseek-ai/dsh-client-ui-layout/client` 消费该契约，未引用 Router、
  private store、DOM selector、CSS selector 或上游 `src/*`；
- 打包前从源码构建，写入上游身份和 `lib/client.js` SHA-256；`afterPack` 对所有 DSH resolver
  路径逐一校验相同 metadata 和 digest，安装后验证再次核对 generation manifest；
- 同一 Smart Clipboard tarball 已在 stock DSH 和 Hermit patched DSH 的真实浏览器中验证：
  stock 保留 Settings fallback 且不出现一级入口，Hermit 显示侧栏入口并打开/关闭完整
  History Product Surface；
- MIT 许可证和来源已进入 `NOTICE`、`THIRD_PARTY_NOTICES.md` 和安装包。

该记录只把上述 Product Surface v1 升级为当前可用公开能力，不授权其他 DSH 私有 API。
