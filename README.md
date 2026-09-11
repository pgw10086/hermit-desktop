# Hermit Desktop

Hermit Desktop 是以 DeepSeek Harness（DSH）为底座的本地优先桌面 AI 工作台。Electron 负责
桌面外壳和 DSH 进程生命周期；DSH 负责官方 Web、Session、Tool、Approval、Settings 和插件
运行时；个人事务、文件工作台、智能剪贴板等能力由独立 Product Plugin 提供。

当前状态：`Public incubation`。M1 Electron + stock DSH Web 桌面底座、Product Surface、
Smart Clipboard 和本地 runtime 已完成主要实现。macOS/Windows 当前发布未签名、未公证，首次
启动可能出现系统安全提示；正式发布以 GitHub Releases 和随包 manifest 为准。

本仓库的第一方依赖来自 public npm package，`apps/desktop-vnext/package.json` 使用 exact
version，`pnpm-lock.yaml` 固定完整解析图。Desktop 不读取兄弟仓库源码，也不使用本地 vendor
tarball。包仓库发布不会触发 Desktop；Desktop 通过自己的 tag 决定产品组合和最终版本。

## 文档入口

- [Agent 规则](AGENTS.md)：编码任务入口和红线；
- [文档权威索引](docs/document-authority.yaml)：各类事实的唯一来源；
- [系统边界](docs/architecture/system-boundaries.md)：Electron、DSH、插件职责；
- [Agent Desktop Core 开发规范](docs/development/desktop-core-development.md)：桌面能力和生命周期；
- [Product Plugin 最小接入](docs/development/product-plugin-quickstart.md)：插件接入入口；
- [Product Plugin 开发规范](plugins/development-guidelines.md)：第一方插件共用规则；
- [DSH 集成契约](docs/contracts/dsh-integration.md)：启动、loopback、renderer 和恢复；
- [核心需求](specs/2026-08-24-hermit-dsh-vnext/core-requirements.md)：产品能力和用户闭环；
- [产品边界](docs/architecture/system-boundaries.md)：当前系统和产品边界；
- [Agent Desktop Core 适配器 ADR](docs/adr/0007-agent-desktop-core-runtime-adapters.md)：Core 和 Adapter 边界；
- [DSH 官方上游资料](DEEPSEEK-HARNESS-UPSTREAM.md)：DSH 版本和快照规则；
- [macOS 发布流程](docs/development/macos-release.md)：未签名 DMG 构建和回验；
- [npm 解耦交付规范](specs/2026-09-11-npm-decoupled-delivery-pipeline.md)：多仓 package、Desktop CI 和 Release；
- [Git 与 Hermit 打包入门](docs/development/git-and-release-beginner-guide.md)：分支、commit、push、tag 和打包；
- [Smart Clipboard 打包与更新流程](docs/development/smart-clipboard-packaging-runbook.md)：插件专属验收清单；
- [ADR-0002](docs/adr/0002-electron-loopback-dsh-carrier.md)：Electron + stock DSH Web 底座；
- [ADR-0003](docs/adr/0003-hermit-bundled-dsh-web-source-patch.md)：受控 DSH Web source patch。

## 当前验证

在仓库根目录运行：

```sh
node --version
corepack pnpm --version
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm test
```

日常目录包：

```sh
corepack pnpm --filter @hermit/desktop package:dir
```

平台打包：

```sh
# 原生 macOS arm64
corepack pnpm run dist:desktop:mac

# 原生 Windows x64
corepack pnpm run dist:desktop:win
```

平台打包只生成本地未签名制品和 `.hermit/artifacts/` 证据，不创建或移动 tag。正式跨平台发布
由 `.github/workflows/desktop-release.yml` 的 `vX.Y.Z` tag 触发，两个平台完成后由一个 publish
job 创建 Draft 并发布 GitHub Release。

## 依赖升级

先在 Core 或 Plugin 仓库发布 npm 版本，再在 Desktop 中使用 exact version 更新依赖并提交
`pnpm-lock.yaml`。依赖升级通过普通 PR 完成，CI 验证组合兼容性；包仓库不会自动修改 Desktop。

## DSH 长会话性能测试

该测试只使用本地 replay fixture，不调用真实模型。首次运行前准备目录包：

```sh
corepack pnpm --filter @hermit/desktop package:dir
corepack pnpm test:dsh:long-session
```

成功后的结构化结果写入 `.hermit/artifacts/`；真实用户 profile、剪贴板、凭据和临时目录不能
提交到 Git。
