# Hermit DSH vNext 项目启动准备

状态：`M1_BLOCKED_Q_CMOD_01`

更新时间：2026-08-25

本文记录代码开发前的仓库、工具链、契约、CI 和第一条技术闭环。产品功能和
验收仍以 `core-requirements.md` 为准。

## 1. 大白话结论

产品方向和文档基线已经够清楚，但现在不能直接开始个人事务、文件工作台、剪贴板
或 Tauri 产品实现。DSH `0.1.1-rc.2` 缺少无 WebServer 的公开 Client module Host
组装契约，M1 在 `Q-CMOD-01` 停止。阻塞详情和重新开启条件见
[M1 底座资格认证](m1-foundation-qualification.md)。

旧 Go 仓库和用户数据保持原样。所有开发、测试和迁移演练都在新仓库和 staging
数据中进行；正式发布时数据权威只从 Go 切到 DSH 一次。

## 2. 已确认的 GitHub 策略

- Day-1 只创建一个新的 `pgw10086/hermit-vnext` 主 monorepo；
- 本地放在 `D:\codes\hermit-vnext`，与当前 `D:\codes\hermit` 是兄弟目录；
- 不在当前仓库中嵌套新 `.git`，不 reset、clean、移动或格式化当前脏工作区；
- 旧 Go 仓库保持原名称和完整历史，迁移支持结束后再 archive；
- Organizer、File Workspace、Smart Clipboard 源码先留在主 monorepo，但分别打包、
  分别版本化、分别安装；
- Plugin API 稳定并通过独立仓 dogfood 后，才创建
  `pgw10086/hermit-plugin-template`；
- Catalog/trust schema 稳定且准备接收第一个外部插件时，才创建
  `pgw10086/hermit-plugin-registry`；
- 只有必须维护 DSH 上游补丁且满足 fork gate 时，才建立真正的 DSH fork；
- 社区插件由作者使用独立仓库，不与第一方插件源码强行放在一起。

### 2.1 可见性和许可证

已确认：`hermit-vnext` 默认使用 Private incubation。满足以下条件后再公开：

- license、知识产权和外部代码 provenance 审核完成；
- 仓库没有旧用户数据、Secret 或不该公开的历史；
- Plugin API、SECURITY 和支持策略能够对外承诺；
- release artifact 能签名并生成 SBOM/provenance；
- 至少一次 clean-room release dry-run 通过。

公开时原创代码默认采用 Apache-2.0。复制或修改的 DSH/Maccy/其他第三方代码必须
保留各自许可证、attribution 和 notice；DSH fork 若出现，继续遵守上游 MIT。

## 3. 仓库创建顺序

```text
[完成] 确认 GitHub owner：pgw10086
-> [完成] 创建且只创建 pgw10086/hermit-vnext（Private）
-> [完成] clone 到 D:\codes\hermit-vnext
-> [进行中] 提交 PR0：治理文件和真实契约
-> 固化 M1 资格认证工具链和 Q0 证据
-> 等待 DSH 发布 transport-neutral Client module Host contract
-> Q0 全绿后实现 Core-only desktop slice
-> 启用稳定 CI 对应的 ruleset / required checks
-> 完成第一条 Core-only vertical slice
-> 再开始三个业务插件
-> API 稳定后创建 template
-> 准备社区目录时创建 registry
-> 必须 patch DSH 时才创建 fork
```

GitHub owner、远端和本地兄弟目录已经确认。当前只执行文档/治理 bootstrap；
产品代码等待 M1 Q0、toolchain、CI 和首个 vertical slice。

## 4. 新主仓目标所有权

下列路径描述目标所有权，不要求初始化时建立空目录。每个 app、package、plugin 和
native crate 必须与首份真实契约、manifest 或实现一起创建。

```text
hermit-vnext/
|-- apps/
|   `-- desktop-vnext/              # Tauri 桌面壳和 WebView composition
|-- packages/
|   |-- core/                       # Core-only DSH composition
|   |-- plugin-api/                 # 对外稳定插件契约
|   |-- plugin-sdk/                 # 插件开发辅助
|   |-- plugin-testkit/             # conformance/clean-boot 测试
|   |-- dsh-adapter/                # 唯一 DSH host/client import 边界
|   |-- ui-adapter/                 # DSH public UI/token/slot wrapper
|   |-- capability-broker/          # 权限与副作用 broker
|   `-- data-registry/              # Canonical namespace/schema registry
|-- plugins/
|   |-- organizer/
|   |-- file-workspace/
|   `-- smart-clipboard/
|-- native/
|   `-- crates/
|       |-- runtime-supervisor/
|       |-- tier0-rescue/
|       |-- os-credentials/
|       |-- clipboard-bridge/
|       |-- parser-sandbox/
|       `-- desktop-integration/
|-- migration/
|   |-- legacy-go/
|   |-- fixtures/                   # 只允许 synthetic/sanitized 数据
|   `-- legacy-source.lock.json
|-- specs/                          # manifest/capability/API/catalog/schema
|-- docs/
|   |-- adr/
|   |-- contracts/
|   |-- security/
|   |-- migration/
|   `-- provenance/
|-- scripts/
|-- .github/
|-- package.json
|-- pnpm-workspace.yaml
|-- pnpm-lock.yaml
|-- .node-version
|-- Cargo.toml
|-- Cargo.lock
|-- rust-toolchain.toml
|-- SECURITY.md
|-- CONTRIBUTING.md
|-- LICENSE
`-- THIRD_PARTY_NOTICES.md
```

不预建 `profiles/`、`vendor/`、`third_party/` 或 `tools/`。DSH Profile 是运行时
`DSH_HOME` 数据；只有真正出现 DSH patch 时才增加 third-party/fork 结构。

## 5. 工具链和上游锁定

第一候选组合，必须经过 clean-room qualification 后才成为正式 pin：

- Node 24.19.0；
- pnpm 11.7.0，通过 Corepack 启动；
- React/ReactDOM 使用 DSH 声明的 `^18.2.0` 兼容范围，精确版本由 Hermit
  qualification lock 和 runtime identity test 决定；
- Rust 1.98.0 候选；
- DSH 0.1.1-rc.2 精确 package closure 候选；
- 一个根 `pnpm-lock.yaml` 和一个 vNext `Cargo.lock`。

生产依赖禁止 `latest`、`next`、`workspace:` 残留制品、Git HEAD 和
`@deepseek-ai/**/src/*`。DSH 默认使用精确 npm graph + lock + provenance；只有
发布物不闭合且必须改源码时才触发 fork。

旧 `apps/desktop` 继续保留自己的 npm、React 19 和 Tailwind，不纳入新 pnpm
workspace。vNext 完整替代验收前不迁移或删除它。

## 6. 开工前阻塞项

以下内容未完成前不开始业务插件：

1. DSH 精确发布物、integrity、public export 和 frozen lock；
2. transport-neutral Client module Host contract 通过 `Q-CMOD-01`；
3. 零 TCP 的 WebView -> Rust -> Node/DSH versioned carrier；
4. React singleton、DSH public export/slot/token 自动门禁；
5. 精确打包的 `@hermit/core` 在隔离 Profile 中 clean boot；
6. Windows WebView2 实机闭环和三平台原生 CI；
7. 取消、背压、shutdown、crash 和 child cleanup 验收；
8. M1 所有 gate 通过后，再冻结 M2 的 Package Gate、Broker 和 Runner 对抗测试。

## 7. 首个 Vertical Slice

首个闭环按 [M1 底座资格认证](m1-foundation-qualification.md) 的 gate 顺序执行：先
证明 DSH 发布物能在不激活 WebServer 的情况下生成 Client graph 和 bundle lookup，
再实现零 TCP carrier、官方 Conversation/Settings、keyless replay、React 单实例、
Core lifecycle 和进程恢复。

M1 fixture 是第一方无特权测试代码，只证明 UI、transport 和 lifecycle，不证明插件
安全。Package Gate、Capability Broker、隔离 Runner、SQLite 业务数据和插件权限 UI
进入 M2，不用空实现占位。

零 TCP 决策见
[ADR-0001](../../docs/adr/0001-zero-tcp-desktop-carrier.md)。资格认证失败时停止，
不会在同一里程碑自动改成 localhost 或反向代理。

## 8. Day-1 GitHub 和 CI 基线

第一批 commit 至少包含 README、SECURITY、CONTRIBUTING、LICENSE/NOTICE、
CODEOWNERS、PR/Issue 模板、已确认 contracts、精确工具链、root locks、首个可运行
carrier、必要 schema 和 CI/release dry-run。ADR 只在记录真实且难以反转的决定时创建；
目录和插件不使用 README 或空 package 预占位置。

main 从第一天禁止直接/强制 push，必须 PR、required checks 和 CODEOWNER review；
API/spec/security/release 路径需要更严格 review。Actions 使用最小权限并 pin 完整
commit SHA。

第一天 required checks：

- policy：顶层 allowlist、无 nested `.git`、无未批准 submodule、目录 owner 合法；
- Node/pnpm frozen lock、TypeScript host/client typecheck/test；
- DSH exact closure/public exports/React singleton；
- Rust fmt/clippy/test 和三平台 compile smoke；
- Product Plugin 依赖边界、真实 packed tarball closure；
- secret scan、dependency review、license inventory、SBOM；
- generated-clean 和 release dry-run。

发布前再补真实三平台 WebView/E2E、签名/notarization、Tauri updater、Package Gate
negative corpus、fault injection、migration rehearsal、backup restore drill 和
authority-switch fault matrix。

## 9. 插件模板、Registry 和拆仓门

第一方插件可独立安装不等于源码必须独立仓。默认长期留主 monorepo，只有同时满足
以下条件才拆：

- Plugin API 已进入稳定 major，连续两个正式版本无 breaking change；
- 只依赖已发布的 plugin-api/sdk/testkit，不依赖 workspace/private source；
- 独立 clone 能 build/test/package/sign/release；
- 有独立 owner、roadmap 或明显不同发布节奏；
- registry 能只通过 package identity/version/digest/API range 判断兼容。

Template 是公共契约的消费者，包含 manifest、host/client、migration、合同测试和
示例 CI，不复制 Core/broker 源码。Registry 只存 artifact locator/digest、兼容范围、
capability、source commit、审计/签名/attestation 和 revoke 状态，不存插件源码、
二进制仓库或 Secret。

## 10. Developer Mode 和社区插件

P0 Production Profile 只允许 Hermit 第一方或 Hermit 审计签名的精确制品。签名只
能证明来源，不能代替 OS sandbox。

Developer Mode 是独立安全域：独立 app/profile、DSH_HOME、data root、credential
namespace，不挂载 production authority/DB/迁移命令，并持续显示开发模式。三平台
sandbox 未通过前，可以明确允许运行任意开发 Node 代码，但绝不能带入生产数据。

## 11. 不能这样开局

- 不在当前 `D:\codes\hermit` 原地改造成 vNext；
- 不先迁 npm/Tailwind/React 19 或清理旧 Go 工作区；
- 不一开始拆成 Core、三个插件、SDK、Registry、Migration 七八个仓；
- 不先写 Organizer 或先建数据表；
- 不复制 DSH Conversation/Settings 或依赖私有源码；
- 不使用 `latest/next` 混装 DSH；
- 不让 Product Plugin 直接拿 fs、child_process 或 Tauri command；
- 不在校验签名/manifest/capability 前执行 pnpm lifecycle；
- 不先写 Go 转换脚本再补 authority/backup/lease；
- 不在 sandbox 未证明前开放任意社区 Node 插件到 Production；
- 不提前建立没有 patch 的 DSH fork。

## 12. 下一步

Private `pgw10086/hermit-vnext` 已创建。下一步提交文档基线，并实现
`scripts/qualification/` 中的 Q0 自动检查，固定 `0.1.1-rc.2` 的阻塞证据。官方发布物
补齐 Client module Host contract 后重新运行 M1；Q0 变绿前不创建 Tauri、Core 或
业务插件目录。
