# Hermit Desktop

Hermit Desktop 是以通过兼容性检查的 DeepSeek Harness（DSH）为底座的本地优先
桌面 AI 工作台。Electron 只负责桌面外壳和 DSH 进程生命周期；DSH 负责官方 Web、AI
Session、Tool、Approval、Settings 和插件运行时；个人事务、文件工作台、智能剪贴板
等能力以可独立安装的 DSH Product Plugin 提供。

当前状态：Private incubation。M1 Electron + stock DSH Web 桌面底座实现已完成，后续 Hermit
bundled DSH generation 在必要时可按 [ADR-0003](docs/adr/0003-hermit-bundled-dsh-web-source-patch.md)
携带经过审计的最小 source patch；Product Surface v1 已完成源码、许可证、摘要门禁和
Smart Clipboard 同制品双宿主验证。macOS Apple Silicon 的本地资格已通过真实菜单栏交互和注销后自动启动；版本发布统一按
[macOS 发布流程](docs/development/macos-release.md)执行，某一版是否签名、公证及其实际制品
以 [GitHub Releases](https://github.com/pgw10086/hermit-desktop/releases) 和随包发布清单为准。
runtime closure、app-dir、DMG 只读挂载冷启动、官方 UI、keyless
Tool/Approval、插件双端、Electron main 强杀清理、预置 generation 回滚，以及 packaged
Tray/登录项读写/正常退出证据已通过；Hermit 自有图标和第三方 attribution 已进入产物。
最近一次启动状态会原子记录启动原因和 DSH ready；跨注销资格脚本只在明确授权后注册登录项，
不会自行安装或删除应用，也不会触发注销。
Windows 留到后续平台阶段；通用 AI Quick Panel 已完成独立模块 spec，首条 `conversation.quick`
和 Smart Clipboard 窗口迁移已经落地并通过 macOS packaged 验收，Smart Clipboard
M1/M2 已形成 macOS 候选，包含插件专属快捷取回、完整 History、SQLite/FTS5 和
主进程专用 Objective-C++ native bridge。无人值守测试没有读取或改写用户 General
Pasteboard；真实复制/自动粘贴/物理快捷键仍待 disposable 资格。签名、公证和 staple 是
完整发布流程中的可选步骤，执行或跳过都必须明确记录，不能由本机证书状态自动决定。
产品范围见[核心需求](specs/2026-08-24-hermit-dsh-vnext/core-requirements.md)，M1
入口见[项目启动准备](specs/2026-08-24-hermit-dsh-vnext/start-readiness.md)和
[M1 设计](specs/2026-08-24-hermit-dsh-vnext/m1-foundation-qualification.md)。二期路线见
[二期总方向](specs/2026-08-24-hermit-dsh-vnext/phase-2-roadmap.md)。

## 文档入口

本仓库只负责 Hermit 产品。共享桌面平台位于同级独立
[`desktop-core`](https://github.com/pgw10086/desktop-core) 仓库，并通过
`vendor/platform-desktop-core-0.1.0.tgz` 的固定制品接入；不从 sibling 目录导入源码。

- [Agent 规则](AGENTS.md)：编码任务的入口和红线；
- [文档权威索引](docs/document-authority.yaml)：某类事实应该查哪份文档；
- [系统边界](docs/architecture/system-boundaries.md)：Electron、DSH、插件的当前职责；
- [Desktop Core 开发规范](docs/development/desktop-core-development.md)：桌面能力边界、desktop API 和生命周期；
- [Product Plugin 最小接入](docs/development/product-plugin-quickstart.md)：新插件的唯一 `Start Here` 入口和当前 Core 能力一览；
- [Product Plugin 开发规范](plugins/development-guidelines.md)：三个第一方插件共同遵循的开发方式；
- [Product Plugin 入口](plugins/README.md)：三个插件的设计、开发和文档导航；
- [DSH 集成契约](docs/contracts/dsh-integration.md)：启动、loopback、renderer 和恢复；
- [核心需求](specs/2026-08-24-hermit-dsh-vnext/core-requirements.md)：产品能力和用户闭环；
- [Desktop Surface 与 Quick Panel spec](specs/2026-08-24-hermit-dsh-vnext/desktop-surface-quick-panel.md)：Quick Panel、对话小窗口和剪贴板窗口迁移；
- [M1 设计](specs/2026-08-24-hermit-dsh-vnext/m1-foundation-qualification.md)：M1 阶段、gate 和退出条件；
- [仓库布局](docs/repository-layout.md)：目录所有权和生命周期；
- [多产品拆仓方案](specs/2026-09-03-product-variant-platform-split.md)：Desktop Core、Hermit 和新产品的 sibling 仓库边界与迁移门槛；
- [DSH 官方上游资料](DEEPSEEK-HARNESS-UPSTREAM.md)：当前 DSH 文档快照、版本和更新规则；
- [macOS 发布流程](docs/development/macos-release.md)：版本、DMG、可选签名、Draft、下载回验和正式发布；
- [Smart Clipboard 打包与更新流程](docs/development/smart-clipboard-packaging-runbook.md)：插件制品、桌面包、DMG 和版本更新的执行清单；
- [ADR-0002](docs/adr/0002-electron-loopback-dsh-carrier.md)：M1 为什么采用 Electron + stock DSH Web（历史底座决定）。
- [ADR-0003](docs/adr/0003-hermit-bundled-dsh-web-source-patch.md)：何时允许 Hermit 自带 DSH Web 携带受控 source patch。
- [ADR-0006](docs/adr/0006-multi-product-sibling-repositories.md)：为什么多产品拆成 sibling Git 仓库，以及共用与隔离边界。

## 当前验证

在仓库根目录运行：

```sh
# 先用任意版本管理器进入 Node 24.x
node --version
corepack pnpm doctor
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm test
```

桌面包和安装后 runtime 验证：

```sh
corepack pnpm test:desktop
corepack pnpm package:desktop:dir
corepack pnpm dist:desktop:mac:smoke
# 发布构建必须明确选择 skip 或 required
HERMIT_MAC_RELEASE_SIGNING=skip corepack pnpm dist:desktop:mac
corepack pnpm verify:desktop:packaged-runtime
corepack pnpm test:m1:desktop:packaged
corepack pnpm test:m1:replay:packaged
corepack pnpm test:dsh:long-session
corepack pnpm test:smart-clipboard:product-surface
corepack pnpm test:smart-clipboard:packaged-ui
corepack pnpm --filter @hermit/desktop test:conversation:quick:packaged
corepack pnpm test:smart-clipboard:native
corepack pnpm qualification:desktop:mac-login:status
```

### DSH 长会话性能测试

该测试只使用本地 `@deepseek-ai/dsh-llm-replay`，不会调用真实模型或消耗 API token。它会
动态生成约 10 万字符、128 轮的会话 fixture，启动已打包 Hermit，逐轮写入并流式回放；随后
关闭进程、重新打开同一个 userData，在原 Session 上追加一轮，再进行第三次冷启动读取。

首次运行前准备本机目录包和 bundled runtime：

```sh
corepack pnpm --filter @hermit/desktop package:dir
corepack pnpm test:dsh:long-session
```

性能基线默认使用 `paceMs=2` 和 32 字符/chunk。先做小规模试跑时可以使用：

```sh
HERMIT_DSH_LONG_TARGET_CHARS=2000 \
HERMIT_DSH_LONG_TURNS=8 \
HERMIT_DSH_LONG_CHUNK_CHARS=32 \
HERMIT_DSH_LONG_PACE_MS=0 \
corepack pnpm test:dsh:long-session
```

可调环境变量包括 `HERMIT_DSH_LONG_TARGET_CHARS`、`HERMIT_DSH_LONG_TURNS`、
`HERMIT_DSH_LONG_SEED`、`HERMIT_DSH_LONG_CHUNK_CHARS`、`HERMIT_DSH_LONG_PACE_MS` 和
`HERMIT_DSH_LONG_STREAM_TIMEOUT_MS`。成功后的结构化结果写入 `.hermit/artifacts/`；失败时会
保留临时 userData、fixture 和 manifest，并在 stderr 输出诊断目录。设置
`HERMIT_DSH_LONG_KEEP=1` 可在成功后也保留该临时目录。

文档治理检查可单独运行：

```sh
corepack pnpm verify:document-governance
corepack pnpm verify:plugin-manifests
corepack pnpm verify:dsh-upstream
```

仓库脚本入口允许 Node `22.13.x` 以上的 22 系、Node 24-26 和 pnpm 10-12；正式资格范围
仍是 Node `24.x` 和 pnpm `11.x`。桌面打包入口会自动切换到 bundled Node 24，lockfile 与
runtime manifest 记录候选的精确解析版本。DSH 仍处于 RC，因此当前资格闭包精确使用
`0.1.1-rc.2`。

当前 Q0 脚本仍用于记录 DSH `0.1.1-rc.2` 的发布物和公开 contract 证据；它不再把
缺少 transport-neutral Client Host 当作 Electron M1 的前置阻塞。

DSH 官方插件开发资料的当前版本、上游 commit 和快照校验以
[`DEEPSEEK-HARNESS-UPSTREAM.md`](DEEPSEEK-HARNESS-UPSTREAM.md)为准；runtime 与文档必须
属于同一个版本批次。
