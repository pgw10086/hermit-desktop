# 仓库布局

本文档是 Hermit vNext 顶层目录所有权和生命周期的唯一事实来源。创建新的顶层目录
前，必须先在本文中定义。

## 原则

1. 同一事实只有一个权威 owner；
2. 源码所有权和可安装 package boundary 必须明确；
3. Runtime state、生成 evidence、cache 和 upstream checkout 不属于项目知识；
4. 产品插件独立性通过 contract 保证，不通过嵌套仓库实现；
5. 只有包含真实 owner 和 lifecycle 文件时才创建目录。

## 顶层结构

```text
hermit-vnext/
|-- README.md
|-- AGENTS.md
|-- CLAUDE.md
|-- apps/                    # Product assembly
|-- packages/                # 共享且可版本化的平台 package
|-- plugins/                 # 第一方可安装 Product Plugin
|-- native/                  # Rust/native 特权 provider
|-- migration/               # Legacy rehearsal 和 cutover program
|-- docs/                    # 长期架构和开发事实
|-- specs/                   # Normative requirement 和 machine contract
|-- scripts/                 # 维护的开发/release command
|-- .github/                 # GitHub collaboration 和 CI 配置
|-- .agents/                 # Coding Agent skill（需要时）
|-- .claude/                 # Claude-only Coding Agent adapter
|-- .codex/                  # Codex-only Coding Agent adapter
|-- .hermit/                 # 已忽略的 local cache/tmp/artifacts
|-- package.json             # PR0 建立的根 pnpm command surface
|-- pnpm-workspace.yaml
|-- pnpm-lock.yaml
|-- Cargo.toml               # vNext Rust workspace
|-- Cargo.lock
`-- rust-toolchain.toml
```

本仓库不包含 Go source、`go.mod`、嵌套 Git repository 或旧产品 runtime。

## 所有权表

| 路径 | 负责人 | 层 | 生命周期 |
| --- | --- | --- | --- |
| `apps/desktop-vnext/` | Desktop Platform | 最终 Tauri/DSH assembly | 随 Core release 发布 |
| `packages/core/` | Runtime Platform | Core-only DSH composition | 随 Core 版本化 |
| `packages/plugin-api/` | Architecture + Platform | 公共 Product Plugin contract | SemVer public API |
| `packages/plugin-sdk/` | Ecosystem + Platform | 插件 build helper | 跟随兼容 API major |
| `packages/plugin-testkit/` | Quality + Ecosystem | Conformance/clean-boot test | 跟随兼容 API major |
| `packages/dsh-adapter/` | DSH Integration | 唯一批准的 DSH import 边界 | 随 qualified DSH generation |
| `packages/ui-adapter/` | UI Platform | DSH public UI/token/slot wrapper | 随 qualified DSH generation |
| `packages/capability-broker/` | Security Platform | Capability decision/narrow handle | Core security release |
| `packages/data-registry/` | Data Platform | Canonical namespace/schema owner | Core data release |
| `plugins/organizer/` | Organizer Product | 第一方可安装插件 | 独立 artifact/version |
| `plugins/file-workspace/` | File Workspace Product | 第一方可安装插件 | 独立 artifact/version |
| `plugins/smart-clipboard/` | Clipboard Product | 第一方可安装插件 | 独立 artifact/version |
| `native/` | Native Platform | Rust/OS 特权 provider | 根 Cargo workspace |
| `migration/` | Migration Program | Snapshot-only rehearsal/cutover | 保留到迁移支持结束 |
| `docs/` | 对应领域 owner | 长期人类可读事实 | 随实现事实维护 |
| `specs/` | Architecture + Product + Security | Normative requirement/schema | 先于依赖代码版本化 |
| `scripts/` | Developer Experience + Release | 确定性 command | 维护并测试 |
| `.github/` | DevEx + Security + Release | CI 和仓库治理 | 受保护 review 路径 |

## Assembly 和 Package

`apps/desktop-vnext` 是唯一桌面混合 assembly。它可以组合 public package 和第一方
plugin artifact，但 feature logic 必须留在所属 owner。

`packages/` 保存有明确依赖方向的 contract 和平台实现。创建 package 前必须先定义
owner。Public contract 与 privileged provider implementation 必须分离。

`plugins/` 保存第一方 Product Plugin 源码。可安装插件是 package boundary，不是
嵌套 Git repository。每个插件必须只与 Core build/test；跨插件协作经过 Core
contract。

`native/` 保存 Node runtime supervision、Tier 0 Rescue、OS credential、clipboard、
parser isolation 和 desktop integration 等根 Rust workspace member。平台代码留在
所属 crate 内。

## Runtime Profile 和上游源码

不得创建源码 `profiles/` 目录。DSH Profile 是临时或用户 `DSH_HOME` 下 materialize
的 runtime state；仓库只拥有 bundle/materialization logic。

默认不得创建 `vendor/`、`third_party/` 或 DSH submodule。Qualified DSH 依赖使用
exact npm closure + provenance。只有 fork/patch ADR 已批准后，源码 checkout 才能
存在于独立仓库或外部只读缓存。

## 文档和 Spec

`docs/` 解释当前架构、contract、decision、安全和开发流程，不保存 task log 或
生成 report。第一方维护性 Markdown 的语言规则见
`docs/development/documentation-language.md`。

`specs/` 保存已确认产品需求和机器可读 invariant。代码不得在局部 README 中重新
解释 normative schema；所属 spec 和依赖代码必须一起修改。

从旧环境导入的确认文档必须记录在 `docs/provenance/imports.yaml`。Legacy source、
真实数据和外部未提交文件不得导入。

## 生成和本地状态

本地状态统一放在：

```text
.hermit/
|-- cache/
|-- tmp/
`-- artifacts/
```

Package output 放在 owner 声明的 `dist/`、`lib/` 或 Rust `target/` 并默认忽略；只有
spec 明确声明为 source-of-record 的 generated source 才能提交。

Synthetic fixture 留在所属 owner。Sanitized fixture 必须有 provenance 和字段说明。
Browser profile、cookie、credential、真实 Session content 和真实用户文件禁止进入。

## Scoped Agent 规则

只有以下目录的执行行为确实不同，需要 scoped `AGENTS.md`：

- `apps/desktop-vnext/`；
- `packages/`；
- `plugins/`；
- `native/`；
- `migration/`；
- `specs/`；
- `.github/`。

更深目录只有出现真实新增规则时才增加 scoped 文件。Scoped 文件只补充根规则，不
复制根安全边界。

## 修改布局

1. 明确 owner、layer、dependency direction 和 lifecycle；
2. 先更新本文；
3. 只有执行行为变化时才增加/修改 scoped `AGENTS.md`；
4. 在同一个 reviewed change 中创建文件和目录；
5. 同步 ownership/invariant gate 和维护链接；
6. 验证没有 nested repository、out-of-root link、Secret 或生成状态。

自动布局门禁建立前，由 reviewer 手工验证上述清单。
