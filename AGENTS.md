# 仓库开发 Agent 规则

本文件只保存所有任务都要遵守的入口和红线。详细事实由下方对应文档负责；机器能
稳定判断的要求由 lint、schema、测试或 CI 执行。

## 工作方式

- 使用中文和用户沟通；需要取舍时，用大白话说明方案、利弊和适用场景。
- 修改前先读取与任务直接相关的代码、配置、测试和权威文档，不要求通读全部文档。
- 优先解决根本原因。兼容和降级必须是明确、可观察、可测试的产品行为，不能用静默
  fallback、重复状态或旁路实现掩盖问题。
- 沿用已经由真实代码和契约证明的边界，不为猜测中的未来需求预建目录、抽象、状态层
  或兼容层。
- 同一事实只有一个负责人。优先修改现有权威来源，其他位置只链接，不复制规范。
- 活跃文档描述当前事实；调研只提供依据，计划和历史不得伪装成当前实现。

## 按任务读取

- 改产品范围、插件划分或用户闭环：读取
  `specs/2026-08-24-hermit-dsh-vnext/core-requirements.md`。
- 判断启动条件或第一条技术闭环：读取
  `specs/2026-08-24-hermit-dsh-vnext/start-readiness.md`。
- 创建、移动或调整顶层目录和所有权：先读取 `docs/repository-layout.md`。
- 修改进程、组件职责或依赖方向：读取 `docs/architecture/system-boundaries.md`。
- 修改 DSH、React、UI seam 或生命周期：读取 `docs/contracts/dsh-integration.md`。
- 修改插件信任、权限、安装或隔离：读取
  `docs/contracts/product-plugin-security.md`。
- 修改产品 AI Session、Tool、Approval、恢复或凭据使用：读取
  `docs/contracts/runtime-agent.md`。
- 修改文档、工作区数据、GitHub workflow 或一般工程规则：读取
  `docs/development/engineering-rules.md`。

## 项目红线

- 编码 Agent 与产品运行时 Agent 完全隔离，不共享指令、凭据、工具权限或会话状态。
- DSH 只通过批准的公开契约使用；React/ReactDOM 在同一产品运行时中保持单实例。
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
