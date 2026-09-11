# Hermit Desktop npm 解耦交付链路

状态：`APPROVED`

实现状态：`LOCAL_VERIFIED_NPM_BOOTSTRAPPED_PENDING_TRUSTED_PUBLISHING_AND_WINDOWS_CI`

更新时间：2026-09-11

本文是 Hermit Desktop 当前交付链路的目标规范。它取代旧的 tarball、`platform-lock.json`、
Candidate 精确 run 绑定以及签名/公证强制要求，作为后续实现、测试和文档同步的依据。

## 1. 目标

把开发到桌面制品发布收敛为两个简单边界：

```text
独立 package 仓库
  -> 各自 CI、版本和 npm 制品
  -> Desktop 通过 exact version 选择依赖
  -> Desktop CI 验证组合
  -> Desktop tag 构建并发布 macOS/Windows 未签名制品
```

包仓库不编排 Desktop，Desktop 不 checkout 兄弟仓库源码。跨仓库耦合只保留：

1. npm package name + exact version + pnpm lockfile integrity；
2. package 对宿主或插件 API 的兼容契约。

## 2. 范围与不做什么

### 2.1 本阶段范围

- Core 和每个 Product Plugin 以 npm public package 发布；
- Desktop 使用 `package.json` 的 exact dependency version 和 `pnpm-lock.yaml`；
- 每个 package 仓库维护自己的 CI 和 release workflow；
- Desktop 维护一个 CI workflow 和一个 tag-only release workflow；
- macOS 和 Windows 仍使用原生 runner 构建；
- Release 采用一个发布 job 汇总两个平台制品；
- 本阶段跳过代码签名和公证，制品必须明确标记为 unsigned/not notarized；
- 失败修复通过新的 patch 版本发布，不覆盖旧版本。

### 2.2 明确删除或不再引入

- `platform-lock.json` 及其同步、校验和更新脚本；
- `vendor/platform/*.tgz` 和兄弟仓库源码 checkout；
- 独立 Candidate workflow、Candidate 制品和正式 Release 的 Candidate run 绑定；
- 外部 Release 仓库、跨仓库发布 token 和上游触发下游发布；
- macOS Developer ID、Apple notarization、Windows Authenticode 相关 workflow、环境、脚本和强制测试；
- 同一版本覆盖、`--clobber` 和移动已发布 tag。

## 3. 仓库职责

| 仓库 | 负责 | 不负责 |
| --- | --- | --- |
| Core package repo | Core/Adapter 源码、测试、独立版本和 npm 发布 | Desktop 版本组合和桌面 Release |
| Product Plugin repo | 插件业务、测试、独立版本和 npm 发布 | 其他仓库源码、Desktop 发布 |
| `hermit-desktop` | 依赖组合、产品测试、Electron 构建和 Desktop Release | 兄弟仓库源码构建和包仓库发布 |
| npm | 不可变 package 版本和安装来源 | Desktop 产品组合决定 |
| GitHub Release | Desktop 最终安装包 | 重新决定 package 版本 |

当前 `agent-desktop-core` 仓库包含 `@tianbuyv/agent-desktop-core` 和
`@tianbuyv/dsh-runtime-adapter` 两个 package。第一阶段保持一个仓库、一个 tag、一个 release
workflow，但分别发布两个 npm package；物理拆仓另行决策，不作为本次简化前置条件。

## 4. Package CI/CD

### 4.1 package-ci

触发：`pull_request` 和推送到 `main`。

```text
checkout
  -> 固定 Node 24 / pnpm 11.24.0
  -> pnpm install --frozen-lockfile --ignore-scripts
  -> typecheck、test、build
  -> pnpm pack --dry-run
```

workflow 只使用 `contents: read`，不读取 Desktop 写权限和发布凭据。

### 4.2 package-release

触发：包仓库 `vX.Y.Z` tag。

```text
校验 tag == package.json version
  -> frozen install
  -> test / build
  -> npm publish --access public
```

package manifest 必须删除 `private: true`，使用 `publishConfig.access=public`，并声明有效的
`files`、`exports`、`main`、`types`、`repository` 和 `license`。

正式启用 npm Trusted Publishing 前，npm 账号必须确认 `@tianbuyv` user scope 的公开发布
权限；每个 package 分别绑定对应 GitHub 仓库、`.github/workflows/package-release.yml` 和
`npm-publish` environment。GitHub job 使用 `contents: read` 与 `id-token: write`，不设置长期
`NPM_TOKEN`。这些是远端配置前置条件，不由仓库代码自动完成。

发布优先使用 npm Trusted Publishing/OIDC，不保存长期 npm token。package release 不创建
Desktop Release，也不修改 Desktop 仓库。

一个 workspace 仓库内多个 package 的 npm publish 不是原子事务。若同一 tag 出现部分成功，
必须停止自动重试，核验已发布 package 的版本和完整性后只补发缺失 package；已存在的
`name@version` 不覆盖、不使用 `--force`，必要时提升版本重新发布。

## 5. Desktop 依赖与构建

### 5.1 依赖事实源

第一方依赖直接写入 `apps/desktop-vnext/package.json`，例如：

```json
{
  "dependencies": {
    "@tianbuyv/agent-desktop-core": "0.1.1",
    "@tianbuyv/smart-clipboard": "0.2.2"
  }
}
```

`pnpm-lock.yaml` 是解析结果和 integrity 记录。禁止 `file:../../vendor`、`workspace:*`、
`link:`、兄弟仓库 `src/*` 和未提交的本地 override 进入正式依赖图。

`platform-lock.json` 删除后，`runtime-bundle-manifest.json` 只记录实际需要投影到 DSH runtime
的 package name 和来源路径，不再通过 module id 查询产品锁。

### 5.2 Desktop CI

统一为一个 `desktop-ci.yml`，触发 PR、`main` 和手动运行：

```text
checkout Desktop only
  -> pnpm install --frozen-lockfile
  -> typecheck / contract / integration smoke
  -> Desktop build
```

PR 不签名、不公证、不发布 Release。必要时在 main 或手动运行增加目录包检查。

### 5.3 Desktop Release

唯一正式触发器是 Desktop `vX.Y.Z` tag：

```text
校验 tag 与 Desktop version
  -> macOS arm64 构建
  -> Windows x64 构建
  -> 上传 workflow artifacts
  -> 一个 publish job 下载全部平台制品
  -> 创建 Draft Release
  -> 上传 DMG/EXE、manifest、SHA256SUMS
  -> 校验后 Publish
```

构建 job 使用 `contents: read`，只有 publish job 使用 `contents: write`。不接受任意 ref、
任意后端 URL 或签名参数。Release 不使用 `--clobber`；相同 tag 已存在时直接失败。

未签名制品至少在 Release 说明和 manifest 中标记 `signed: false`、`notarized: false`，避免把
Gatekeeper/SmartScreen 警告误认为构建错误。

## 6. 版本、兼容和回滚

- 每个 package 使用独立 SemVer；Desktop 版本表示产品组合版本；
- Desktop 依赖使用 exact version，依赖升级通过普通 PR 完成；
- package 对外声明 API/protocol 兼容范围，不维护无限增长的版本配对矩阵；
- 自动依赖工具可以创建 PR，但不能自动合并；
- package 发布后不主动触发 Desktop 发布；
- 已发布 package 和 Desktop Release 都不可变；
- 发现问题时发布新的 Desktop patch，并重新选择已知可用的 package 版本；
- 不移动 tag、不覆盖 npm 版本、不覆盖 GitHub Release 资产。

## 7. 实施顺序

### Phase 1：规范和 package 发布准备

1. 将本 spec 设为 `product-delivery-pipeline` 权威来源；
2. 将所有第一方 package 改为可公开发布，统一 Node 24 / pnpm 11.24.0；
3. 将各 package release workflow 改为 npm publish；
4. 删除 package tarball/manifest/SHA 发布脚本；
5. 发布或确认当前第一方 package 的第一个 npm 版本。

### Phase 2：Desktop 依赖迁移

1. 将 Desktop 第一方依赖改为 npm exact version；
2. 重新生成并提交 `pnpm-lock.yaml`；
3. 删除 `platform-lock.json`、vendor tarball 和相关脚本、测试、override；
4. 将 DSH runtime 和 bundled plugin 解析改为读取已安装 npm package；
5. 清理文档和权威索引中的旧锁逻辑。

### Phase 3：Desktop workflow 简化

1. 删除 Candidate workflow 和 exact Candidate run 校验；
2. 建立单一 `desktop-ci.yml`；
3. 将 `desktop-release.yml` 收敛为双平台构建加单一 publish job；
4. 删除签名、公证环境和脚本；
5. 用未签名 DMG/EXE 完成 tag release 验证。

### Phase 4：依赖升级和回滚验证

1. 用手动或 Dependabot/Renovate PR 升级一个 package；
2. 验证 frozen install、兼容性和 Desktop 集成；
3. 验证 package tag、Desktop tag 和 Release 版本一致；
4. 验证同版本不可覆盖；
5. 用新的 Desktop patch 版本回滚一个 package 版本。

## 8. 验收标准

- 任意 Desktop 干净 checkout 不需要兄弟仓库源码或 `vendor/platform`；
- Desktop 只使用 npm package 和 `pnpm-lock.yaml`；
- 每个 package 仓库可以单独 CI、单独 tag、单独发布 npm；
- package release 不需要 Desktop token；
- Desktop PR 不触发 package 发布，package release 不触发 Desktop 发布；
- Desktop tag 一次性生成 macOS arm64 和 Windows x64 未签名制品；
- Release 只有一个 publish job，资产不覆盖；
- 删除签名、公证、Candidate 和 platform-lock 后，没有残留入口、死代码、测试或文档要求；
- 版本、依赖、Release 和回滚均可通过 Git 历史复现。

## 9. 暂不解决的问题

- npm user scope `@tianbuyv` 的发布权限需要在 npm 账号侧确认；
- 当前 `agent-desktop-core` 两个 package 是否最终拆为两个仓库；
- 未来是否增加签名、公证、SBOM 或 artifact attestation；
- 是否启用 Dependabot/Renovate 以及更新频率。
