# DSH Reference Plugin

状态：`current`

`@hermit/dsh-plugin-reference` 是 Hermit 的 DSH 公共接入资格包。它用一个最小制品验证
DSH `0.1.1-rc.2` 的 Bundle、Host、Client、Settings、Tool、React 单实例和插件生命周期，
作为第一方 Product Plugin 开发前的可执行参考。

它不是 Organizer、File Workspace、Smart Clipboard 之外的第四个 Product Plugin，不承载
用户业务，也不定义 Product Surface。包内只读状态路由只用于把同一资格制品的 Host 和
Client 结果关联起来，不能复制为业务 RPC；正式业务调用仍必须经过 Core 或 DSH 公共契约。

## 公共接入面

| 接入面 | 参考实现 | 验证目的 |
| --- | --- | --- |
| Bundle | [`package.json`](package.json) 与 [`cordis.patch.yml`](cordis.patch.yml) | 安装后由官方 profile bundle 激活 |
| Host | [`src/index.ts`](src/index.ts) | 注册 settings namespace、Tool 和可回收资格路由 |
| Client | [`src/client/index.tsx`](src/client/index.tsx) | 通过公开 `./client` export 和 typed slot 增加 Settings tab，验证 Organizer 首批所需 DSH public primitives |
| 构建 | [`tsdown.config.ts`](tsdown.config.ts) | 生成 DSH lazy-CJS Client bundle，并把 React 和 DSH UI runtime 留给 Host |
| 静态门禁 | [`tests/package.test.mjs`](tests/package.test.mjs) | 拒绝私有源码导入、DOM 注入和第二份 React |
| 双端资格 | [`tests/reference-plugin.e2e.mjs`](tests/reference-plugin.e2e.mjs) | 同一 tarball 在 stock DSH 与 Hermit bundled DSH 上完成真实生命周期 |

## 验证

在仓库根目录运行：

```sh
corepack pnpm --filter @hermit/dsh-plugin-reference test
corepack pnpm --filter @hermit/dsh-plugin-reference test:qualification
```

资格脚本使用 `.hermit/runtime/` 中的 bundled Node `24.19.0`、pnpm 和 DSH，不使用当前
shell 的 Node 版本代替正式资格环境。它只打包一次 `.tgz`，然后分别对 stock DSH 和
Hermit bundled DSH 验证：

1. 官方 `dsh plugin add` 安装并激活 Bundle；
2. Host settings 和 Tool 已注册；
3. Client bundle 由 DSH module loader 加载，Settings tab 可见；
4. 浏览器内共享 React Hook 能更新状态；
5. `Button`、`Input`、`Menu` portal/选择/outside-click、`Tooltip` DOM 锚点、
   `Toast`、`DisclosureRow` 和 exact icons 在两端可交互；
6. 从 profile bundle 移除后重启 DSH，Client entry 和资格路由都消失；
7. 官方 `dsh plugin remove` 清除 package 和 bundle entry。

`Tooltip` 当前只验证原生 DOM ref 锚点；DSH public `Button` 不转发 ref，
两者不得直接组合。`Menu` 在 Settings Modal 中的 Escape 会联动关闭
父层，Product Plugin 只能在另外通过资格的 Product Surface 用法内依赖 Escape。

通过后，平台相关证据写入忽略提交的
`.hermit/artifacts/dsh-reference-plugin-<platform>-<arch>.json`。失败时测试保留隔离目录，
并在 Client UI 失败时保存页面截图和 HTML，便于定位真实运行状态。

## 边界

本包已证明 rc.2 的 Settings contribution 可以作为 Client/UI 兼容性探针，但没有证明
日常业务页面所需的公开 Product Surface 已存在。当前包默认验证 stock `0.1.1-rc.2`；若
Hermit 采用 source-patched DSH generation，必须把该 generation 作为单独资格目标，证明
patch 暴露的公开 contract，而不是把 Settings、私有 Router、DSH DOM 或 CSS selector 当成
业务入口。Product Plugin 的静态私有依赖红线不因 source patch 放宽。

当前资格也不把外部 Client 插件的进程内热卸载视为已验证能力。插件安装、激活或停用后
按当前产品边界重启 DSH；若未来要承诺无重启切换，必须单独验证 Host 与 Client 的同代
卸载、资源回收和 UI 消失，不能从 Cordis Host effect 机制推断 Client 已支持。
