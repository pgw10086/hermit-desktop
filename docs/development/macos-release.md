# macOS 发布流程

状态：`current`

本文是 Hermit macOS 版本发布的唯一流程。无论这次是否签名、公证，都走同一套步骤、使用
正常版本号和正常 GitHub Release，不另外发明“内部版”或“未签名版”流程。

插件怎样进入桌面包由 [DSH 集成与打包标准](dsh-plugin-development-and-packaging.md)负责；
Smart Clipboard 的原生能力检查由[专属清单](smart-clipboard-packaging-runbook.md)补充。本文只
负责把已经通过检查的代码变成一个可下载、可核对的 macOS Release。

## 怎么记录结果

每个步骤只使用三种状态：

- `PASS`：执行并通过；
- `SKIPPED`：这一步属于完整流程，但本次明确不做；
- `FAIL`：执行失败，停止发布。

`SKIPPED` 不等于漏做，也不需要特殊版本号。发布说明必须如实写出跳过了什么以及对用户的
影响。例如跳过签名和公证后，macOS 可能阻止第一次打开，用户需要在系统设置里手工允许。

## 固定流程

| 顺序 | 步骤 | 是否必须 | 通过标准 |
| --- | --- | --- | --- |
| 1 | 整理源码和第三方声明 | 必须 | 没有 secret、本机构建物、悬空链接或遗漏的许可证信息 |
| 2 | 确认版本、提交和 tag | 必须 | 应用版本为 `X.Y.Z`，发布 tag 为 `vX.Y.Z`，tag 指向干净提交 |
| 3 | 安装依赖并跑项目检查 | 必须 | frozen lock、治理、插件、桌面和原生相关检查通过 |
| 4 | 生成 DMG | 必须 | 从当前提交生成唯一的目标平台 DMG |
| 5 | Developer ID 签名 | 可选 | 执行时必须通过 `codesign`；不执行则记录 `SKIPPED` |
| 6 | Apple 公证和 staple | 可选 | 执行时必须通过 Apple 和 `stapler` 校验；不执行则记录 `SKIPPED` |
| 7 | 挂载并启动制品 | 必须 | DMG 可只读挂载，应用、bundled Node、DSH、插件和退出流程通过 |
| 8 | 生成 SHA 和发布清单 | 必须 | 文件名、版本、commit、平台、platform lock、模块制品 SHA-256 和可选步骤状态一致 |
| 9 | 创建 Draft Release | 必须 | tag、说明和三个制品上传完整 |
| 10 | 从 GitHub 下载回验 | 必须 | 下载后的 SHA-256、DMG 挂载和启动检查仍通过 |
| 11 | 发布 Release 并回读 | 必须 | Release 不再是 draft，tag、commit 和下载链接可从 GitHub 读回 |

可选步骤一旦选择执行，就不能失败后静默改成跳过。需要改变选择时，应先说明原因，再重新从
DMG 构建开始执行并更新发布说明。

## 1. 发布前整理

发布必须在原生 Apple Silicon Mac 上执行。先确认工作区、工具链、远程和登录状态：

```sh
git status --short --branch
git diff --check
node --version
corepack pnpm --version
uname -m
git remote -v
gh auth status
```

逐项确认未提交文件确实属于源码或文档，生成目录已由 `.gitignore` 排除。不得提交 `.env`、
证书、私钥、真实用户数据、`.hermit/`、`node_modules/`、`dist/`、`lib/` 或 native build 输出。

跨网下载时使用仓库统一代理：

```sh
export HTTP_PROXY=http://127.0.0.1:7897
export HTTPS_PROXY=http://127.0.0.1:7897
```

安装命令可以继续使用 `--ignore-scripts`。正式打包入口会先通过 Electron 自带的安装脚本
显式准备 lockfile 锁定的原生 Electron；检测到 `HTTP_PROXY` 或 `HTTPS_PROXY` 时会同步开启
`@electron/get` 的代理支持。electron-builder 随后只从本地 `node_modules/electron/dist`
组装应用，不再为同一个版本发起第二次下载。

## 2. 版本和源码

桌面版本取自 `apps/desktop-vnext/package.json`，文件名固定为
`Hermit-<version>-arm64.dmg`，tag 固定为 `v<version>`。第一方插件如果随这一版一起交付，
它们的实际版本和 lock 解析结果必须已经进入同一个提交。

先在功能分支完成检查和提交，再合并到 `main` 并推送。创建 tag 前必须确认：

```sh
git status --porcelain
git rev-parse HEAD
git rev-parse origin/main
```

工作区必须为空，本地 `main` 与 `origin/main` 必须指向同一提交，然后才创建并推送 tag。

## 3. 必须检查

正式打包统一执行：

```sh
node scripts/package-product.mjs release --signing skip
```

签名版把 `skip` 改为 `required`。统一入口会按顺序完成 platform lock/frozen install、项目检查、
runtime、native、三个 Product Surface、目录包、packaged UI、最终 DMG 验证和发布附件生成。
任一步失败立即停止，并在 `.hermit/artifacts/builds/` 保留失败步骤和未执行步骤。

## 4. 构建和制品验证

发布入口要求明确选择本次是否签名，避免机器上是否恰好存在证书改变结果。

只需要生成不要求干净 tag 的未签名测试候选时执行：

```sh
node scripts/package-product.mjs candidate
```

正式候选的签名选择已经由上一节的 `--signing` 参数明确传入。`required` 会检查 Developer ID
和完整公证凭据，并执行 `codesign`、Gatekeeper 和 staple 校验；任何一项失败都停止。`skip`
会隔离签名凭据，仍执行相同的桌面测试、DMG 构建、只读挂载、bundled runtime 和真实应用
启动检查，只把签名、公证和 staple 记录为 `SKIPPED`。

需要单独诊断底层 DMG 打包时仍可执行：

```sh
HERMIT_MAC_RELEASE_SIGNING=skip corepack pnpm run dist:desktop:mac
```

## 5. 生成发布附件

统一 `release` 入口已经自动执行本步骤。只在诊断或重新生成附件时单独运行：

```sh
HERMIT_MAC_RELEASE_SIGNING=skip corepack pnpm run release:desktop:mac:assets
```

签名版把 `skip` 改成 `required`。脚本核对当前 tag、commit、版本和唯一 DMG，然后在
`.hermit/artifacts/releases/v<version>/` 生成：

- `SHA256SUMS.txt`；
- `release-manifest.json`。

发布清单同时记录 `platform-lock.json` 摘要，以及 Core、Runtime Adapter 和每个 Product Plugin
的版本、来源 commit 和制品 SHA，确保最终 DMG 可以回溯到同一批第一方字节。

最终 Release 上传三个文件：DMG、SHA 文件和发布清单。发布说明至少写清主要功能、目标平台、
安装方式、已知限制，以及签名、公证、staple 的实际状态。

## 6. Draft、下载回验和发布

先创建 Draft，不直接公开：

```sh
gh release create "v<version>" \
  "apps/desktop-vnext/dist/mac-release/Hermit-<version>-arm64.dmg" \
  ".hermit/artifacts/releases/v<version>/SHA256SUMS.txt" \
  ".hermit/artifacts/releases/v<version>/release-manifest.json" \
  --draft --verify-tag --title "Hermit <version>" --notes-file "<release-notes>"
```

再下载到新的临时目录，校验 SHA，并对下载后的 DMG 重跑制品验证：

```sh
download_dir=$(mktemp -d /tmp/hermit-release-download-XXXXXX)
gh release download "v<version>" --dir "$download_dir"
(cd "$download_dir" && shasum -a 256 -c SHA256SUMS.txt)
HERMIT_MAC_RELEASE_SIGNING=skip \
  node apps/desktop-vnext/scripts/verify-mac-artifact.mjs release "$download_dir"
```

全部通过后发布并回读：

```sh
gh release edit "v<version>" --draft=false --latest
gh release view "v<version>" --json tagName,isDraft,isPrerelease,url,targetCommitish,assets
git ls-remote --heads --tags origin main "refs/tags/v<version>"
```

## 失败怎么处理

- 代码、测试或打包失败：修复源码，形成新提交，重新执行必须检查和后续步骤；
- tag 已推送但制品需要改代码：不要移动公开 tag，提升补丁版本重新发布；
- Draft 附件上传或回验失败：保持 Draft，替换附件后从 GitHub 重新下载验证；
- 已发布附件有误：先下架或标记问题，再用新补丁版本修复，不悄悄替换用户已经下载的文件；
- 签名或公证失败：如果本次原本选择 `required`，失败就是 `FAIL`，不能自动降级为 `skip`。

GitHub Release 页面和随包 `release-manifest.json` 记录每次发布的实际结果；M1、插件设计或
README 不再复制某一版的发布状态。
