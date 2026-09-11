# Hermit Product Desktop 端到端交付链路

状态：`SUPERSEDED`

更新时间：2026-09-10

本文件已由
[2026-09-11-npm-decoupled-delivery-pipeline.md](2026-09-11-npm-decoupled-delivery-pipeline.md)
取代。旧内容仅保留用于回溯之前的 tarball、Candidate、签名和公证方案，不再作为当前实现依据。

本文是 Hermit 从开发、Git 协作、第一方 package 制品到 Product Desktop 正式 Release 的当前
需求和实施顺序。它只负责交付链路，不替代产品需求、系统边界、`platform-lock.json` 或
[macOS 发布流程](../docs/development/macos-release.md)中的产品和平台事实。

## 1. 目标

把下面这条链路变成可重复、可审计、可回滚的工程流程：

```text
开发修改
  -> feature/* 分支
  -> PR 自动检查
  -> 合并 main
  -> 第一方 package 发布不可变制品
  -> 更新 Product Desktop platform-lock
  -> macOS/Windows 原生 candidate
  -> 创建版本 tag
  -> macOS/Windows 正式构建
  -> 签名与平台验收
  -> Draft Release
  -> GitHub 下载回验
  -> 人工批准
  -> Hermit GitHub Release
```

本阶段选定：正式 Product Desktop Release 直接发布在
`pgw10086/hermit-desktop` GitHub 仓库，不另建产品分发仓库。若源码和二进制必须使用
不同可见性，再单独提交新的边界决策，不在本 spec 中提前预建第二个 Release 仓库。

## 2. 事实与不变量

### 2.1 事实来源

- `hermit-desktop` 是 Product Desktop 的 Git、版本、平台组合和最终安装包负责人。
- `agent-desktop-core`、`plugin-*` 是独立 package 仓库，各自负责源码、测试、版本和 package
  制品；不能由 Product Desktop 读取 sibling `src/*`。
- `platform-lock.json` 是 Product Desktop 第一方依赖版本、来源 commit、lockfile 摘要和
  制品 SHA-256 的唯一事实源。
- `package-product.mjs` 是本地 dev、candidate、release 生命周期的编排入口；CI 只负责
  orchestration，不在 YAML 中复制一套发布业务规则。

### 2.2 必须保持的不变量

1. 正式 Product Release 只能来自受保护的 `vX.Y.Z` tag，不能从任意 branch/ref 发布。
2. `package.json.version`、tag、Product Desktop commit 和 Release 版本必须一致。
3. candidate/release 都只消费 `platform-lock.json` 已声明并校验过的 tarball；正式流程不能
   从 sibling 源码补包、不能自动 checkout sibling、不能隐式改写 lock 或 projection。
4. 第一方 package 先发布，再更新 `platform-lock.json`，再进行 Product Desktop candidate 和
   release；Product Desktop 不反向生成 package 制品。
5. macOS 和 Windows 可以并行构建，但正式 Release 必须作为一个完整集合发布，不能先公开一
   个平台再补另一个平台。
6. 安装包在签名、公证和最终处理完成后才计算 SHA-256；Release manifest、`SHA256SUMS` 和
   GitHub asset 必须互相一致。
7. 已发布版本的 tag 和 asset 不允许被替换。构建基础设施失败可以重跑；源码错误必须提升
   patch 版本，不能移动公开 tag。
8. 构建 runner 不持有不必要的 Release 写权限；签名凭据和 Release publisher 凭据按 job
   隔离。
9. Actions artifact 只用于同一 workflow 的 job 间传输，不是长期 canonical package 或
   Release 来源。长期来源必须能由不可变 package Release/registry 和 SHA 回读。
10. 每个最终安装包都必须能沿下面的证据链反向定位：

```text
installer SHA-256
  -> release-manifest.json
  -> hermit-desktop tag/commit
  -> platform-lock SHA-256
  -> package version/source commit/tarball SHA-256
  -> package Git tag/commit
```

## 3. 版本和 Git 规则

### 3.1 日常开发

```text
feature/<task>
  -> 本地类型检查、测试、candidate/dev 验证
  -> push feature branch
  -> Pull Request
  -> required CI checks
  -> review 后合并 main
```

`main` 不直接承载未经审查的代码。版本号由开发者在功能分支上的明确提交中修改；CI 不
自动 bump 版本，避免源码和发布身份在无人确认时漂移。

### 3.2 正式版本

- Product Desktop 版本取自 `apps/desktop-vnext/package.json`。
- 正式 tag 为 `v<version>`，tag 必须指向已经合并并通过 candidate 的 `main` commit。
- tag 一旦用于正式 Release，不得移动、删除后复用或用新字节覆盖。
- 代码修复、依赖更新或重新打包都创建新的 patch/minor 版本。

## 4. Package 制品链

每个 `agent-desktop-core` 或 `plugin-*` 仓库都应提供两类 workflow：

### 4.1 package-ci

触发：`pull_request`、`push` 到 `main`。

权限：`contents: read`，不读取签名或 Release 写凭据。

步骤：

1. 固定 Node/pnpm，frozen install；
2. package 自己的 typecheck/build/test；
3. `pnpm pack` dry-run 和 package 内容检查；
4. 验证 package name、version、入口、声明文件和没有生命周期脚本偷偷重建内容。

### 4.2 package-release

触发：受保护的 `v*` package tag。

步骤：

1. 校验 tag 与 `package.json.version` 一致；
2. 在 tag 对应 commit 上重新 frozen install、test、build、pack；
3. 生成不可变 tarball、`package-manifest.json` 和 `SHA256SUMS`；
4. 发布到 package 自己的 Release 或正式 npm/制品仓库；
5. 相同 package version 如果已经存在，远端 SHA 相同则幂等成功，不同则失败。

`package-manifest.json` 至少记录 package name、version、source repository、source tag、
source commit、source lockfile SHA-256 和 tarball SHA-256。

## 5. Product Desktop 链

### 5.1 PR/main CI

保留现有 source-independent `platform-lock.yml`，并增加 Product Desktop 的低成本检查：

- platform-lock schema、制品存在性和 SHA；
- frozen install 和 projection 无生成差异；
- 类型检查、单元/契约测试；
- 禁止 `link:`、`workspace:`、未声明 `file:` 和 sibling 源码路径进入正式依赖图；
- workflow、发布脚本、`platform-lock.json` 和打包配置由 CODEOWNERS 保护。

### 5.2 Candidate

建议 workflow：`desktop-candidate.yml`。

触发：

- Product Release PR 或 `main` 上涉及 Product Desktop、`platform-lock.json`、package 投影、
  Electron builder、runtime 或 release scripts 的变更；
- `workflow_dispatch` 仅作为无密钥诊断和重跑入口。

macOS 和 Windows 使用各自原生 runner。两个 runner 都必须：

- 只 checkout Product Desktop；
- 严格执行 `platform-lock.mjs install --mode release`；
- 不拿签名 secret、不拿 Release 写 token；
- 运行完整项目检查和真实平台打包验证；
- 上传带 commit 的 Actions artifact 与资格记录。

Candidate 只回答“这个确切的 Product Desktop commit 能否在两个正式平台完成构建”，不
创建正式 Release。

### 5.3 创建 tag

Candidate 对同一个 `main` commit 全部通过后，由 Release Manager 执行一次人工 Gate：

1. 确认 Product Desktop 版本号和发布说明；
2. 确认 candidate workflow 使用的 commit 等于当前 `main`；
3. 创建并推送 `vX.Y.Z`。

正式 tag workflow 还会通过 GitHub API 回读 `desktop-candidate.yml`，要求同一 commit 存在
完整成功的 candidate run；如果当前提交只改了文档、没有自动触发 candidate，必须先对当前
`main` 手动 dispatch candidate 并等其成功，不能复用上一个 commit 的结果。

也可以后续增加 `cut-release.yml`，但它必须先验证 candidate、版本和 tag 不存在，再通过
受保护 Environment 审批后创建 tag。

### 5.4 正式构建

建议 workflow：`desktop-release.yml`，唯一生产触发器为：

```yaml
on:
  push:
    tags:
      - "v*"
```

正式构建不接受任意 ref、任意后端 URL 或 `--signing skip`。配置应来自 tag 对应 commit 中
已经审查的源码或受控 channel 配置。

建议 job 顺序：

```text
verify-release-input
  -> release-macos
  -> release-windows
  -> aggregate-release
  -> stage-draft
  -> verify-github-download
  -> publish-release (production environment)
  -> post-publish-verify
```

其中 macOS job 执行签名、公证和 staple；Windows job 执行 Authenticode 和签名者校验。
两个 build job 只上传 Actions artifact，不直接写 GitHub Release。

`aggregate-release` 负责重新计算最终 SHA、检查平台数量、文件名、版本、架构和资格记录，
生成：

- `Hermit-<version>-mac-arm64.dmg`；
- `Hermit-<version>-win-x64.exe`；
- `release-manifest.json`；
- `SHA256SUMS`；
- 可选 SBOM 和 artifact attestation。

### 5.5 Draft、回验和发布

`stage-draft` 在所有平台构建完成后才创建 Draft，并上传全部附件。Draft 只负责最终公开前
的 staging，不负责 runner 间传输。

`verify-github-download` 必须从 GitHub 下载 Draft/Release 资产到新的临时目录，重新计算
SHA，并重新执行至少一次文件名、版本、架构、manifest 和平台安装包验证。

回验通过后进入 `production-release` Environment，由人工 Gate 2 批准发布。发布后执行：

- Release 为非 Draft；
- tag、target commit 和版本一致；
- 全部 asset 列表和 SHA 与 manifest 一致；
- GitHub Release URL、下载链接和 attestation 可读回。

## 6. 凭据与权限

| Job 类型 | 允许的权限 |
| --- | --- |
| PR/main CI | `contents: read`，无签名和 Release 写权限 |
| Candidate | 读取源码和已声明制品，上传 Actions artifact，无签名和 Release 写权限 |
| macOS release | 仅 Apple Developer ID/公证凭据，不能发布 Release |
| Windows release | 仅 Authenticode 凭据，不能发布 Release |
| Publisher | 仅当前 `hermit-desktop` Release 写权限，不运行构建 |
| Production Environment | required reviewer、tag 限制和 publisher 所需 secret |

如果未来需要跨仓 package Release 或独立分发仓，使用 GitHub App 短期 installation token；
不要把长期 PAT 放入构建 runner。

### 6.1 GitHub 远端配置清单

以下配置不能由仓库文件代替，必须由仓库管理员在 GitHub 上完成后才算启用正式发布：

- `main` ruleset：禁止直接 push、禁止 force push，要求 PR 和 platform-lock required checks；
- `v*` tag ruleset：限制创建、更新和删除，禁止普通开发者移动已发布 tag；
- `macos-signing` Environment：注入 `CSC_LINK`、`CSC_KEY_PASSWORD` 以及 Apple notarization
  所需 secret；
- `windows-signing` Environment：注入 `WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD`，并用变量
  `WINDOWS_SIGNER_SUBJECT` 固定预期签名者；
- `production-release` Environment：配置 required reviewer、禁止 self-review，并限制只
  允许 `v*` tag；
- 仓库/组织启用 immutable releases。发布前仍保留 Draft 和下载回验，发布后禁止修改 tag
  和 asset。

本地代码和 workflow 已按这些名称接线，但当前工作区没有执行上述远端管理操作，也没有提交
或读取任何真实签名凭据。

## 7. 重试和回滚

### 7.1 可以重试

- runner、网络、GitHub artifact 上传、Apple notarization 服务的基础设施失败；
- 同一个 tag、同一个 commit、同一份输入的失败 job。

### 7.2 必须失败停止

- tag 与版本不一致；
- platform-lock、tarball 或 package manifest SHA 不一致；
- Release asset 已存在但 SHA 不同；
- 签名者、公证状态或平台架构不符合要求；
- candidate 与正式 release 的 commit 不一致。

禁止在正式 publisher 中使用无条件 `--clobber`。资产不存在时上传；存在且 SHA 相同则
幂等成功；存在但 SHA 不同则硬失败。

### 7.3 回滚

已发布版本不覆盖、不移动 tag。应用代码回滚必须产生新 patch 版本；分发层可以将旧版本
重新标记为推荐版本，但不能改变坏版本的安装包字节。回滚记录必须同时包含 Product
Desktop commit、platform-lock、第一方 package 制品、配置和发布 manifest。

## 8. 分阶段实施和验收

### Phase 1：规则、权限和证据链

交付：

- `main`/`v*` ruleset 和 CODEOWNERS 方案；
- release-manifest schema 扩展；
- 禁止同版本覆盖、禁止 sibling fallback 和禁止浮动配置输入的验证；
- 所有 workflow 默认最小权限、第三方 Action 固定 commit SHA。

验收：

- 篡改 tarball 一个字节会在安装/构建前失败；
- 删除 sibling 源码目录后 candidate 仍能运行；
- 版本和 tag 不一致时正式流程失败；
- feature branch 不能直接进入正式 Release。

### Phase 2：第一方 package release

交付：

- Core 和每个 Product Plugin 的 package-ci/package-release；
- tarball、package-manifest、SHA 和不可变 package Release；
- Product Desktop 的 lock 更新/校验入口。

验收：

- package tag 生成可回读的 tarball 和 manifest；
- 同版本不同 SHA 不能覆盖；
- Product Desktop 只能消费已发布且 SHA 一致的 package 制品。

Product Desktop 使用 `scripts/update-platform-lock.mjs` 接收 package Release 的 manifest 和
tarball；脚本先校验 package name、版本、来源仓库、源码 commit、生产 lockfile SHA 和 tarball
SHA，再写入内容寻址路径并更新产品锁。旧制品保留，不做覆盖或删除。

### Phase 3：双平台 candidate

交付：

- `desktop-candidate.yml`；
- macOS arm64 和 Windows x64 原生 runner；
- Actions artifact 及资格记录；
- Product Desktop Windows candidate 统一入口。

验收：

- 两个平台从同一个 Product Desktop commit、同一份 platform-lock 构建；
- runner 不 checkout sibling 源码；
- candidate 不读取签名或 Release 写凭据。

### Phase 4：tag 驱动正式 Release

交付：

- `desktop-release.yml`；
- macOS 签名/公证、Windows Authenticode；
- aggregate、Draft、GitHub 下载回验、Environment 审批和发布后回读。

验收：

- 只有受保护 `v*` tag 可以启动生产发布；
- 任一平台失败都不能 Publish；
- 发布后尝试替换 asset 或移动 tag 会失败；
- 任意安装包可由 manifest 反查到 Product commit 和所有第一方 tarball SHA。

### Phase 5：Provenance、SBOM 和演练

交付：

- GitHub Artifact Attestations、SBOM、workflow run/runner/toolchain 记录；
- retry、Draft 中断、版本 burn、发布事故和回滚 runbook；
- 至少一次故障演练。

验收：

- 仅凭公开安装包、SHA、manifest 和 Release，审计者可以复原完整来源链；
- Draft 部分上传、同 SHA 重试、不同 SHA 拒绝和已发布版本回滚均有实测记录。

## 9. 当前落地状态

已完成：

- Phase 1 的 spec、权威索引、正式发布输入门禁和发布清单来源证据；
- Core/Plugin 的 package 制品准备、package Release publisher 和 hash-aware 幂等测试；
- Product Desktop 的 `update-platform-lock.mjs`，以及内容寻址 tarball 接线；
- Windows x64 candidate 打包入口、安装包命名、PE/app.asar 形状验证，以及原生 GitHub Actions
  runner 的实跑证据（Product Desktop commit `f9bd2d4`，workflow run `34376669373`）。
- macOS/Windows release 脚本、双平台聚合、Draft/下载回验 publisher 和 tag-only workflow
  的代码路径及单元测试。

未完成：

- package 仓库的远程 tag/Release 实跑；
- Windows 正式 Authenticode 签名仍未实跑；macOS arm64 和 Windows x64 的无签名 candidate
  已在同一 Product Desktop commit 上通过原生 runner 验证；
- `pgw10086/hermit-desktop` 的正式签名 secrets、第二位 production reviewer 和正式发布演练；
- package 仓库的可见性仍按各仓库当前配置处理，Product Desktop 只消费已锁定的公开 tarball
  和随仓制品，不从 sibling 源码构建。

2026-09-10 已完成远端门禁配置：`hermit-desktop` 已改为 public；`main-protection` 和
`immutable-release-tags` ruleset 已启用；`macos-signing`、`windows-signing` 和
`production-release` Environment 已创建并限制到 `v*` tag；GitHub immutable releases
已启用。`production-release` 当前配置了 owner reviewer 且禁止 self-review，因此正式发布
还需要另一位 reviewer；签名 secret 尚未写入，不能伪造或用占位值替代。

## 10. 当前实施顺序

本 spec 被确认后，按以下顺序改动：

1. 先落地 Phase 1 的验证脚本、manifest 字段和 workflow 权限边界；
2. 再为 Core/Plugin 仓库增加 package release workflow，并建立 Product Desktop lock 更新流程；
3. 再扩展 `package-product.mjs` 和 Windows candidate；
4. 最后实现 tag-driven signed release、Draft 回验和不可变发布。

每个阶段都必须先通过对应验收，再进入下一阶段；发现发布权限、版本身份或制品来源存在
关键分歧时，暂停实现并重新进行外部方案评审。
