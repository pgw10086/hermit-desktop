# public npm 发布配置

状态：`current`

更新时间：2026-09-11

Hermit 的 Core、Runtime Adapter 和 Product Plugin 通过 GitHub Actions 发布到 public npm。仓库
workflow 已经准备好，但 npm scope、Trusted Publisher 和 GitHub Environment 必须由 package
维护者在网页端配置；代码不会保存长期 `NPM_TOKEN`。

## 1. 需要配置的 package

| GitHub 仓库 | npm package |
| --- | --- |
| `pgw10086/agent-desktop-core` | `@tianbuyv/agent-desktop-core`、`@tianbuyv/dsh-runtime-adapter` |
| `pgw10086/plugin-smart-clipboard` | `@tianbuyv/smart-clipboard` |
| `pgw10086/plugin-organizer` | `@tianbuyv/organizer` |
| `pgw10086/plugin-file-workspace` | `@tianbuyv/file-workspace` |

所有包使用当前 npm 账号 `tianbuyv` 的 user scope，不依赖额外组织。当前 npm 账号必须拥有这些
scope 的公开发布权限；package manifest 已设置：

```json
{
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  }
}
```

## 2. 创建 GitHub Environment

在每个 package GitHub 仓库进入 `Settings -> Environments`，创建：

```text
npm-publish
```

环境中不需要保存 secret。可以按需要增加 required reviewer，并限制只允许 release tag 使用。
workflow 的 publish job 已引用这个 environment，并只申请：

```yaml
permissions:
  contents: read
  id-token: write
```

`id-token: write` 只用于获取 OIDC 身份，不等于 GitHub 仓库写权限。

## 3. 配置 npm Trusted Publisher

首次 bootstrap 发布后，对上表中的每一个 npm package 分别配置 Trusted Publisher：

1. 打开 npm package 的 `Settings`；
2. 找到 `Publishing access` 或 `Trusted Publishers`；
3. Provider 选择 `GitHub Actions`；
4. Owner 填 `pgw10086`；
5. Repository 填对应仓库名；
6. Workflow filename 填：`package-release.yml`；
7. Environment 填：`npm-publish`；
8. 保存配置。

workflow 文件真实路径是 `.github/workflows/package-release.yml`，但 npm 配置项只填文件名
`package-release.yml`。

Trusted Publisher 的仓库、workflow 和 environment 必须与实际值完全一致。仓库迁移、复制或
fork 后不要沿用错误的 owner/repository 配置。

## 4. 首次发布

如果 package 还不存在于 npm registry，先在维护者本机完成一次 bootstrap（user-scoped public package）：

```sh
npm login
npm whoami
```

然后在已经通过 package CI 的 tag commit 上执行一次 public publish，或按 npm 当前页面提供的
首次 package 创建步骤完成 bootstrap。bootstrap 只负责让 package 出现在 registry；完成后
立即启用 Trusted Publisher，后续发布不再使用本机 token。

如果 package 已经存在，直接先配置 Trusted Publisher，不要重新使用旧 token。

## 5. 用 tag 触发后续发布

每个 package 仓库的版本号必须和 tag 一致：

```text
package.json 0.2.3
      ↓
tag v0.2.3
      ↓
package-release.yml
      ↓
pnpm pack → npm publish <tgz>
```

workflow 会严格校验 `vX.Y.Z`、package version、public access 和 registry。pnpm 负责安装、
测试、构建和打包，npm CLI 负责最终发布；不使用 `pnpm publish` 代替 OIDC 发布。

## 6. 发布后回读

每个 package 发布后确认：

```sh
npm view @tianbuyv/smart-clipboard versions --json
npm view @tianbuyv/smart-clipboard@0.2.2 dist.integrity
```

再到 Desktop 仓库更新 exact dependency 和 `pnpm-lock.yaml`。Desktop CI 通过后，才创建
Desktop 的 `vX.Y.Z` tag。

## 7. 失败和恢复

- tag/version 不一致：修复版本后创建新的 tag；
- npm 返回 401/403：检查 Trusted Publisher 的 owner、repository、workflow filename 和 environment；
- npm 返回版本已存在：不能覆盖，核验已发布版本后提升 patch；
- 多 package workspace 部分成功：停止自动重试，核验已存在 package，只补发缺失 package；
- 不要添加长期 `NPM_TOKEN`，不要使用 `--force` 或覆盖已有版本。

## 8. 当前验证边界

本地已经通过 package manifest、`pnpm pack` 和 `npm publish --dry-run`。四个仓库的 GitHub
Package CI 也已在远端 main 成功运行。实际 npm publish、Trusted Publisher 生效和 Desktop
Windows 原生 Release 必须在上述远端配置完成后验证。
