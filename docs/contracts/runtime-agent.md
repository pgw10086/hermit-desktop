# 运行时 Agent 契约（Runtime Agent Contract）

本文管理产品 AI Session，不授予编码 Agent 任何仓库或外部权威。

## Session 事实

Append-only durable Session ledger 是模型可见历史的唯一事实来源。模型看到的事实、
指令、Tool call 和 Tool result 必须能从 durable event 重建。Event sequence 单调递增，
turn/step 正确闭合，logical Tool call/result 按 callId 配对。

## Tool Dispatch 和恢复

Dispatch 前，Core 必须持久记录 intent，包括 callId、plugin principal、capability、
canonical arguments digest、side-effect class、idempotency support 和 Approval
requirement。

Checkpoint 失败时不得 dispatch。Crash 后：

- 尚未 dispatch -> `TOOL_NOT_STARTED`；
- durable call 已存在但 outcome 未知 -> `TOOL_OUTCOME_UNKNOWN`；
- read-only 或已证明 idempotent 的工作可以 retry；
- 可能产生副作用的工作必须先 reconcile external state 或请求人类决定。

Provider 支持时，callId 可以作为 correlation/idempotency key；它不是 exactly-once
guarantee。

## Approval

Approval 必须 fail closed。只有一次 `allowed-once` decision 可以释放匹配的
Session/call/tool/argument digest/provider operation。Rejected、cancelled、timeout、
missing、throwing、malformed 或 unavailable answerer 全部 deny。执行前必须已经持久
记录 asked/decided audit event。

## Capability、Secret 和日志

Runtime Agent 与产品插件只能从 Core 获得 narrow capability handle。Filesystem、
network、process、credential、model 和 native authority 是相互独立的维度。

Configuration 和 Session state 只保存 credential reference，不保存 plaintext。
Core-owned provider 按 operation 解析凭据，不向产品插件暴露。

日志使用 structured logical identifier，记录 decision/outcome，但不记录 Secret、
browser state、不必要的绝对用户路径或 raw user content。

Provider identity 必须唯一、原子注册、受 lifecycle 管理，并在重复时 fail loudly。
