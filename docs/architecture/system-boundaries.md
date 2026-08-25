# 系统边界（System Boundaries）

Hermit vNext 是新的运行时，不是在旧 Go 产品目录中原地改造。

## 进程所有权

```text
Tauri / Rust Desktop Shell
|-- WebView: qualified DSH Web + Hermit client composition
|-- bundled exact Node: Hermit Core Host + pinned DSH/Cordis
|-- isolated Product Plugin Runners
`-- Core-owned native providers and explicit Tool subprocesses
```

- Rust 负责桌面生命周期、Node supervisor、Tier 0 Rescue、OS credential、native
  capability provider 和签名 generation 选择；
- Core 负责 DSH Session/Tool/Approval composition、Package Gate、Capability Broker、
  Data Registry、diagnostics 和 Tier 1 Safe Profile；
- 产品插件负责自己的 Canonical 业务数据和 UI/Tool contribution，只获得 narrow
  capability，不获得 ambient host authority；
- 目标进程树中不存在 Hermit Go runtime。

## 依赖方向

```text
apps -> public packages -> DSH public contracts
apps -> first-party plugin artifacts
plugins -> Hermit Core public contract
native providers -> runtime protocol / Core-owned provider contracts
migration -> data/authority contracts and sanitized fixtures
```

产品插件源码不得 import 另一个产品插件或特权 provider implementation。跨插件
协作必须经过 Core contract。

## Carrier

在业务开发前，第一个 vertical slice 必须先资格认证目标
`WebView <-> Rust <-> Node/DSH` carrier。首选方案是没有 TCP listener 的 versioned
custom IPC transport。若资格认证后的 DSH 公共 contract 不能支持，再通过 ADR 评估
random loopback fallback，并要求 per-start runtime token 和 workspace scope。

Protocol 至少包含 version、generation、request/call identity、request/response、
server push、cancellation、deadline、ready、shutdown、crash/restart、idempotency 和
error taxonomy。

## Generation 和恢复

Code generation 与 data generation 一起切换。Candidate code 只能使用 staging data
和 shadow capability，在激活前不得产生真实外部副作用。Tier 0 Rescue 不依赖
Node/DSH；Tier 1 Safe Profile 只加载资格认证过的 Core recovery surface，不加载
产品插件或模型调用。

旧 Go authority 不挂载到本开发仓库。迁移 rehearsal 只读取批准的 snapshot 并写入
staging generation。Production authority 通过受 epoch/lease 保护的原子 commit
从 Go 切换一次，之后永不返回 Go。
