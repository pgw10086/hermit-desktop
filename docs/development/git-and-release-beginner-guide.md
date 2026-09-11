# Git 与 Hermit 打包入门

状态：`current`

更新时间：2026-09-11

本文面向第一次参与 Hermit 开发的同学，说明从 package 开发到 Desktop Release 的最短路径。
完整规则以 [npm 解耦交付规范](../../specs/2026-09-11-npm-decoupled-delivery-pipeline.md)为准。

## 1. 每个仓库独立

Core、Runtime Adapter、Product Plugin 和 Product Desktop 都有自己的 Git 仓库、版本、依赖、
测试和 CI。跨仓库只消费已发布的 public npm package，不 checkout 兄弟仓库源码。

Desktop 使用 `package.json` 的 exact version 和提交到 Git 的 `pnpm-lock.yaml`。不要再维护
产品级 `platform-lock.json`、vendor tarball 或跨仓库 commit 清单。

## 2. 日常开发

```sh
git status --short --branch
git switch main
git switch -c feature/my-task

# 修改后
git diff --check
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm test

# 精确暂存和保存
git add <明确的文件路径>
git diff --cached
git commit -m "feat: describe the change"
git push -u origin feature/my-task
```

不要使用 `git add .` 代替逐项确认，也不要在不了解内容时删除已有未提交修改。

## 3. 发布一个 package

在 package 仓库完成测试和版本修改：

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm test
corepack pnpm pack --dry-run
git commit -m "feat: release package 0.2.3"
git tag v0.2.3
git push origin main --tags
```

Package Release workflow 会再次校验 tag 与 `package.json.version`，然后使用 npm CLI 发布
public package。npm 的 package version 一旦发布就不能覆盖；发布失败时修复后提升 patch。

一个 workspace 仓库内有多个 package 时，一个 tag 必须与每个待发布 package 的版本一致。当前
`agent-desktop-core` 的两个 package 暂时锁步发布。

## 4. 更新 Desktop 依赖

先确认 package 已经出现在 npm registry，再在 Desktop 仓库更新：

```sh
corepack pnpm --filter @hermit/desktop add -E @hermit/smart-clipboard@0.2.3
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm test
git add apps/desktop-vnext/package.json pnpm-lock.yaml
git commit -m "chore: update smart clipboard package"
```

依赖更新应作为普通 PR 合并。Dependabot/Renovate 可以自动开 PR，但不自动合并。

## 5. 生成 Desktop 制品

```sh
# 日常目录包
corepack pnpm --filter @hermit/desktop package:dir

# 原生 macOS arm64
corepack pnpm run dist:desktop:mac

# 原生 Windows x64
corepack pnpm run dist:desktop:win
```

正式构建只接受与 Desktop 版本一致的 `vX.Y.Z` tag，并使用 frozen lockfile。当前生成的是未
签名、未公证制品，首次启动可能出现系统安全提示。

## 6. Desktop Release

```text
Desktop main
  -> PR CI
  -> 合并 main
  -> 修改 Desktop version
  -> 创建 vX.Y.Z tag
  -> macOS/Windows 原生构建
  -> 一个 publish job 创建 Draft
  -> 上传两个安装包和 manifest
  -> 发布 GitHub Release
```

不要移动已使用的 tag，也不要使用 `--clobber` 覆盖资产。发现问题时发布新的 Desktop patch，
重新选择之前的可用 package 版本。

## 7. 打包报告和常见问题

最终发布目录会生成：

```text
.hermit/artifacts/releases/v<version>/release-manifest.json
.hermit/artifacts/releases/v<version>/SHA256SUMS.txt
```

常见问题：

| 现象 | 处理 |
| --- | --- |
| `working tree is not clean` | `git status --short`，先提交属于本次发布的修改 |
| `tag must point to current commit` | 检查 Desktop version、tag 和 `git rev-list -n 1 <tag>` |
| `Cannot find package` | 确认 npm package 已发布、版本正确且 lockfile 已更新 |
| `integrity` 或安装失败 | 不改 lockfile 猜版本，重新生成并提交正确的 `pnpm-lock.yaml` |
| DMG/EXE 生成但无法启动 | 检查 runtime closure、app.asar 和目标平台架构 |
| 未签名安全警告 | 这是当前阶段的预期限制，不等同于构建失败 |

最短记忆方式：

```text
package 仓库生产 npm 制品
Desktop 通过 exact version 选择制品
pnpm-lock.yaml 固定安装图
Desktop tag 生成最终未签名安装包
```
