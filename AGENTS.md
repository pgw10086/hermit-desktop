# 仓库开发 Agent 规则

本文件只保存所有任务都要遵守的入口和红线。详细事实由下方对应文档负责；机器能稳定判断的要求由 lint、schema、测试或 CI 执行。

## 工作方式

- 使用中文和用户沟通；需要取舍时，用大白话说明方案、利弊和适用场景。
- 文档先讲清事情，再使用必要的技术名词；能用普通话说明的，不堆术语。
- 新增规则或限制前，先说明要解决的真实问题；没有明确风险和收益的，不额外增加限制，给实现保留空间。
- 阅读或修改时发现现有隐患、坏味道和维护风险要主动说明；边界不清时先给选项再实施。
- 修改前先读取与任务直接相关的代码、配置、测试和权威文档，不要求通读全部文档。
- 优先解决根本原因。兼容和降级必须是明确、可观察、可测试的产品行为，不能用静默 fallback、重复状态或旁路实现掩盖问题。
- 沿用已经由真实代码和契约证明的边界，不为猜测中的未来需求预建目录、抽象、状态层或兼容层。
- 已经产品决策废弃且没有明确兼容承诺的功能，必须连同入口、实现、状态、配置、文档和测试直接删除；不得隐藏、保留 dead code、fallback 或双实现。
- 同一事实只有一个负责人。优先修改现有权威来源，其他位置只链接，不复制规范。
- 活跃文档描述当前事实；调研只提供依据，计划和历史不得伪装成当前实现。
- 文档分工以 `docs/document-authority.yaml` 为入口：先读取对应权威文档，再修改事实；不在其他文档复制一套架构结论。
- 代码按职责保持高内聚、低耦合；超过 700 行时必须评估拆分，不能机械切割。中文注释解释原因和边界；日志和测试覆盖真实流程与状态，不为覆盖率锁样式、README 或快照。
- 优先复用成熟开源项目和现有实现，能直接借鉴、迁移或改造的不要从零设计，避免重复造轮子。
- 设计或实现前端 UI 与交互原型时，先读取[前端 UI 设计规范](docs/development/frontend-ui-design.md)。
- DSH 插件开发、打包和资格验收按[通用标准](docs/development/dsh-plugin-development-and-packaging.md)执行。

## 版本与环境

- 普通稳定运行时、工具和依赖原则上声明经过验证的兼容范围，不能把 manifest 锁死在单个补丁；复现由 frozen lock 和制品 manifest 保证，prerelease/RC、bundled binary 或经批准的互操作约束可以精确锁定。
- 兼容范围、frozen lock 解析结果、runtime/release manifest 的实际版本是三类事实，互不替代。
- 环境状态区分“观察可运行、上游支持、项目已验证、允许发布”。只读诊断不因未验证版本
  一律阻断；lock 修改、构建、打包和发布按风险逐级收紧。
- 不追 `latest`。新兼容线先在对应原生平台完成资格矩阵；跨平台打包不算原生发布证据。
- 跨网下载使用 Clash：POSIX 设置 `HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:7897`；
  PowerShell 设置同名 `$env:` 变量。

## 外部协作

- 遇到可能过时的技术事实、官方方案、不确定架构、连续失败或需求分歧时，先在已绑定的 `hermit-vnext` 网页 GPT Project 中调研和讨论，再实施；仍有关键分歧时交给用户决策。
- 默认优先使用 DSH 的公开 package、typed slot、service 和 Product Surface。若已确认的 Product Plugin 闭环被当前 pinned DSH Web 阻塞且用户明确授权，可以修改 Hermit 自带的 DSH Web 源码或构建包，形成最小、可追踪、精确锁定的 source patch；patch 必须经过 license/notice、依赖、构建、双宿主和生命周期资格。插件仍只能使用 patch 暴露的公开 typed contract，不能运行时注入 DOM、挂私有 Router、读 private store 或依赖 DSH `src/*`。

## 按任务读取

- 改产品范围、插件划分或用户闭环：读取
  `specs/2026-08-24-hermit-dsh-vnext/core-requirements.md`。
- 设计或修改 Product Plugin 的功能、页面和交互：切换到对应 sibling 插件仓库，先读取其
  `AGENTS.md`、`README.md` 和 `DESIGN.md`；本仓库只维护宿主集成、固定制品和共用 UI 规范。
- 判断启动条件或第一条技术闭环：读取
  `specs/2026-08-24-hermit-dsh-vnext/start-readiness.md`。
- 创建、移动或调整顶层目录和所有权：先读取 `docs/repository-layout.md`。
- 修改进程、组件职责或依赖方向：先读取 `docs/architecture/system-boundaries.md`，再读取
  `docs/contracts/dsh-integration.md`。
- 修改 DSH、React、UI seam 或生命周期：读取 `docs/contracts/dsh-integration.md`。
- 修改插件信任、权限、安装或隔离：读取
  `docs/contracts/product-plugin-security.md`。
- 修改产品 AI Session、Tool、Approval、恢复或凭据使用：读取
  `docs/contracts/runtime-agent.md`。
- 修改文档、工作区数据、GitHub workflow 或一般工程规则：读取
  `docs/development/engineering-rules.md`。
- 打包、校验、创建 tag 或发布 GitHub Release：读取
  `docs/development/macos-release.md`。

## 项目红线

- 编码 Agent 与产品运行时 Agent 完全隔离，不共享指令、凭据、工具权限或会话状态。
- DSH 只通过批准的公开契约使用；Hermit 可为自带 DSH Web 携带经过审计的 source patch，由 patch 补出的能力必须先成为公开 typed contract；React/ReactDOM 在同一产品运行时保持单实例。
- 插件的特权动作必须经过 Core、Package Gate、Capability Broker 和隔离 Runner，
  不得旁路。
- 保留用户现有工作区状态；仓库外资源、真实用户数据和凭据默认不属于任务范围。
- 不提交 Secret。未经用户明确要求，不执行 push、发布、部署、签名、迁移、远端配置
  或凭据修改等外部写操作。

## 完成标准

- 运行与本次改动直接相关的检查，并只报告实际运行过的结果。
- 产品范围、系统边界、契约、安全模型或仓库治理发生变化时，同步更新其权威文档。
- scoped `AGENTS.md` 只用于已经出现的局部差异；完全继承根规则的目录不创建占位文件。
- `CLAUDE.md` 只保留 `@AGENTS.md`，不维护第二套规则。
