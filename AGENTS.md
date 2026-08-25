# 仓库开发 Agent 规则

Hermit vNext 有两个完全分离的 Agent 域：

- 编码 Agent（Coding Agent）负责检查和修改本仓库；
- 运行时 Agent（Runtime Agent）是由 Hermit Core 管理的产品 AI Session。

不得在两者之间传递信任、权限、Tool、Skill、凭据或运行时权威。

## 先读取所属上下文

- 创建、移动、重命名目录或 package 前，必须读取
  `docs/repository-layout.md`；
- 修改 Core、Host、Client、Broker、Runner、Package Gate、Tauri、native、IPC
  或进程边界前，必须读取 `docs/architecture/system-boundaries.md`；
- 修改 DSH、React、UI、slot、theme、primitive、CSS 或 export 前，必须读取
  `docs/contracts/dsh-integration.md`；
- 修改插件、manifest、capability、签名、审计或隔离前，必须读取
  `docs/contracts/product-plugin-security.md`；
- 修改 Session、Tool、callId、Approval、checkpoint、重试、provider、凭据或
  运行时日志前，必须读取 `docs/contracts/runtime-agent.md`；
- 处理迁移、fixture、Secret、生成状态、GitHub、release 或 cutover 前，必须读取
  `docs/development/workspace-safety.md`。
- 新增或修改根级项目说明、架构、布局、开发规则中的历史背景前，必须读取
  `docs/development/documentation-rules.md`。

距离当前目录最近的 scoped `AGENTS.md` 用来补充本文件。局部规则可以收紧或细化，
但不得削弱根文件中的工作区、数据、信任、凭据和外部动作边界。

## 文档语言

- 本仓库的第一方维护性 Markdown 默认使用简体中文，并以中文版本作为工程事实的
  权威表达；新增或修改文档时必须遵循
  `docs/development/documentation-language.md`；
- 例外仅限法律或第三方原文、逐字引用、代码与命令等不可翻译内容，以及语言规范
  明确允许的派生英文翻译；不得为同一事实维护逐段中英双语或两份并列权威文档；
- 技术术语首次出现时使用“中文解释（English Original；必要时附
  `codeIdentifier`）”；文件名、目录名、代码标识符、命令、API/schema key、DSH
  package/export/slot/token、错误码和官方引用保持原文；
- 用户可见文案、代码注释、commit message 和 schema description 分别遵循自己的
  产品、本地化、代码或接口约定，不因 Markdown 中文规则自动改变；
- 如提供英文翻译，中文 canonical 文档仍是工程事实来源；译文必须声明中文来源，
  不得包含只存在于译文中的规范性事实。

## 文档事实

- 使用 Hermit vNext 的当前正向事实定义系统；历史项目名称、技术栈和实现细节，
  只有在 migration、compatibility、provenance、cutover/rollback 或明确安全授权
  边界中具有直接语义时才可出现，并由对应 canonical 文档拥有；
- 根级文档不得复制历史背景；需要历史上下文时必须链接对应 owner；
- 工作区操作默认限制在当前 Git root，root 外资源必须有明确 scoped authorization。

## 工作区和数据

只在当前 Git worktree 的解析后 root 内工作。Root 外的 repository、worktree、目录、
数据集和 credential 默认不属于读写范围；只有当前任务或 canonical scoped 文档
明确授权时才可以访问。

真实用户数据、浏览器状态、凭据、Secret 和外部未提交源码不得进入本仓库或编码
Agent 上下文。

保留工作区既有状态。不得使用 `git reset`、`git clean` 或其他以丢弃非本次工作
为目的的命令。

临时状态统一放在已忽略的 `.hermit/{cache,tmp,artifacts}/`。资格认证所需的固定
DSH 源码检出必须位于白名单只读外部缓存，不能成为嵌套仓库。

## 架构和依赖

所有权先于结构：只有 `docs/repository-layout.md` 已定义 owner、layer 和 lifecycle
后，才可以创建新的顶层区域、package 或 plugin。

产品插件（Product Plugin）唯一的 Hermit 硬运行时依赖是 Core 公共契约。特权副
作用必须经过 Package Gate、Capability Broker 和隔离 Runner。P0 Production 只
接纳第一方或 Hermit 审计签名的 Product Plugin。

固定版本的 DSH 是外部平台契约。只消费批准的 package root、`./client` 公共
export，以及公开的 slot、theme 和 primitive。不得依赖 DSH `src/*`、私有 DOM、
私有 class 或私有 CSS。React/ReactDOM 是平台 singleton，并与资格认证后的 DSH
解析结果一致。

模型可见的运行时事实必须是可持久恢复的 Session 事实。Tool call/result 按 callId
配对；checkpoint 失败时不得 dispatch；Approval fail closed；checkpoint 后结果
未知的副作用不得盲目重试。

所有 registration 和外部资源都必须有明确生命周期并可确定性 dispose。

## 验证和外部动作

优先扩展已有 owner 的公共 seam，再考虑增加依赖或权威路径。扩大 package owner、
capability authority 或 public API 前，先修改所属 contract/spec。

运行最小且相关的自动门禁和行为测试。安全边界必须包含拒绝路径测试。

本地文件编辑不授权外部副作用。push、force-push、PR 修改、tag、release、publish、
签名/推广、GitHub 设置或 Secret 修改、特权 workflow dispatch、真实数据迁移和
生产 cutover 都需要用户针对该动作的明确授权。

## 编码工具配置

`AGENTS.md` 是编码 Agent 的唯一规范来源。根 `CLAUDE.md` 只能包含
`@AGENTS.md`。

`.agents/`、`.claude/`、`.codex/` 只属于编码 Agent 配置。产品 Runtime Agent 的
指令和 runtime skill 必须放在产品拥有的 runtime package/plugin 中，并受 manifest
和 capability 管理。
