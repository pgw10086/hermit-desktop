# 系统边界（System Boundaries）

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
  capability，不获得 ambient host authority。

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

## Native Provider

Native/FFI 是 Core 拥有的特权 provider，不是产品插件可以直接调用的环境能力。
所有跨进程和 ABI 输入都要在边界校验，并明确 protocol generation、timeout、
cancellation 和 error 语义。`unsafe` 保持在最小封装内并说明安全前提；平台实现留在
所属 Rust crate。拒绝路径、进程退出和资源回收必须经过行为测试。

## 运行时权威边界

Hermit vNext 的 runtime state 只能由本文明确列出的 authority component 和 store
提供。所有 runtime reader/writer 必须通过这些 authority 的正式接口访问状态；未列入
runtime dependency graph 的 repository、data source 或 process 不属于 steady-state
runtime authority。

Authority transfer、writer fencing、data migration 和 rollback boundary 属于迁移
lifecycle，由 `migration/` 和对应 change-specific spec 定义。

## Carrier

在业务开发前，第一个 vertical slice 必须先资格认证目标
`WebView <-> Rust <-> Node/DSH` carrier。首选方案是没有 TCP listener 的 versioned
custom IPC transport，具体决定见
`docs/adr/0001-zero-tcp-desktop-carrier.md`。当前 DSH 公共 contract 不能支持时停止
M1；loopback、反向代理或其他 carrier 必须另行决策，不作为自动 fallback。

Protocol 至少包含 version、generation、request/call identity、request/response、
server push、cancellation、deadline、ready、shutdown、crash/restart、idempotency 和
error taxonomy。

## Generation 和恢复

Code generation 与 data generation 一起切换。Candidate code 只能使用 staging data
和 shadow capability，在激活前不得产生真实外部副作用。Tier 0 Rescue 不依赖
Node/DSH；Tier 1 Safe Profile 只加载资格认证过的 Core recovery surface，不加载
产品插件或模型调用。

迁移 rehearsal 只读取批准的 snapshot 并写入 staging generation。Production
authority 的转换必须使用受 epoch/lease 保护的原子 commit，并遵循所属 migration
spec 的 rollback boundary。
