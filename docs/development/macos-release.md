# macOS 发布流程

状态：`current`

更新时间：2026-09-11

本文只说明 Hermit macOS arm64 未签名制品的构建和回验。跨平台组合发布的总流程以
[npm 解耦交付规范](../../specs/2026-09-11-npm-decoupled-delivery-pipeline.md)为准。

本阶段不做 Developer ID 签名、公证或 staple。发布说明必须明确标记 unsigned / not notarized；
首次打开时出现 Gatekeeper 提示属于未签名分发的预期限制。

## 固定流程

| 顺序 | 步骤 | 通过标准 |
| --- | --- | --- |
| 1 | 干净 tag | `vX.Y.Z` 与 `apps/desktop-vnext/package.json` 一致，tag 指向 main 提交 |
| 2 | Frozen install | `pnpm install --frozen-lockfile --ignore-scripts` 成功 |
| 3 | Desktop CI | 类型、契约、集成 smoke 和构建通过 |
| 4 | 原生打包 | macOS arm64 生成唯一 DMG |
| 5 | 制品回验 | DMG 可挂载，App、bundled Node、DSH 和插件闭包完整 |
| 6 | 发布附件 | 生成 `release-manifest.json` 和 `SHA256SUMS.txt`，标记未签名/未公证 |
| 7 | Draft/Publish | 与 Windows 制品一起由单一 publish job 发布 |

## 本地命令

在 `hermit-desktop/` 根目录执行：

```sh
git status --short --branch
git diff --check
node --version
corepack pnpm --version
uname -m
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm run dist:desktop:mac
node scripts/prepare-macos-release-assets.mjs
```

跨网下载使用统一代理：

```sh
export HTTP_PROXY=http://127.0.0.1:7897
export HTTPS_PROXY=http://127.0.0.1:7897
```

## 发布附件

`prepare-macos-release-assets.mjs` 会检查当前 tag、版本和唯一 DMG，并生成：

- `.hermit/artifacts/releases/v<version>/release-manifest.json`；
- `.hermit/artifacts/releases/v<version>/SHA256SUMS.txt`。

manifest 记录 Desktop commit、package manifest 摘要、pnpm lock 摘要、runner 和 Node 版本，
以及 `signed: false`、`notarized: false`。它不记录已经删除的 `platform-lock.json` 或本地
vendor 路径。

## 失败和回滚

- 构建、挂载或回验失败：保持 tag 不变，修复后提升 patch 版本；
- 已发布版本不移动 tag、不覆盖资产；
- 未签名警告不是构建失败，但必须在 Release 说明中如实说明；
- 回滚通过新的 Desktop patch 重新选择旧的可用 npm package 版本。
