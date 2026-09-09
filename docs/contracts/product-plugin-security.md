# 产品插件安全契约

多仓工作区的共享安全规则见外层 `docs/contracts/shared-security-rules.md`；本文只定义 Hermit
Product Plugin 的信任、Package Gate、Capability 和生命周期细节。

产品插件（Product Plugin）是 Hermit 的信任和打包边界，不等同于进程内 Cordis
plugin。

## 信任等级

P0 Production 只接受：

1. Hermit 第一方签名 artifact；
2. Hermit 审计过、精确 digest 已签名/attest 且进入 production catalog 的 artifact。

社区发现不等于允许安装。Developer Mode 必须使用独立 app/profile/data/credential
安全域，不得拥有 Production authority、database、migration command 或 Secret
namespace。

## Package Gate

任何 lifecycle code 执行前，Package Gate 必须先验证 bytes：

```text
stage bytes
-> hash and origin
-> manifest schema
-> signature/attestation
-> Core and DSH compatibility
-> capability policy
-> dependency, SBOM, license, and lifecycle-script policy
-> materialize
-> load into the approved Runner
```

未知 capability 和 compatibility state 必须 fail closed。

## Capability 模型

Manifest 声明 capability 和 data namespace。Capability Broker 按 plugin、
Session/agent、action、resource、constraint 和 generation 签发短生命周期 narrow
handle。

产品插件只能表达 intent。它不得直接获得 filesystem、network、process、
environment、credential、model/`ctx.llm`、Electron、preload、native/FFI 或其他
插件的数据
authority。纯计算 API 不应仅因属于 Node built-in 就被当成特权能力。

隔离 Runner 属于 defense in depth；普通 Cordis composition 和 DSH filesystem
sandbox vocabulary 不能证明 network/process/credential 已隔离。

## 依赖和生命周期

- Product Plugin 默认只有 Core 公共 contract 这一项 Hermit 硬运行时依赖；
- 跨插件协作使用 Core
  event/service/capability，不使用 value import、shared table 或 foreign key；
- Client code 不直接调用 Electron、`ipcRenderer`、Node 或私有 preload；若某个 Core 能力必须
  经过 renderer 承载，必须使用该插件专属、最小化、sender 校验的公开 facade（例如
  Smart Clipboard 的 `hermitSmartClipboard`），并为 facade 单独做 schema 与生命周期测试；
- 插件不能伪造 DSH Approval 或直接操作 `approval.companion` 的结算；审批伴随窗口属于
  DSH/受信宿主路径，插件只能通过公开 Surface contract 表达自己的普通工作面；
  Host code 经过 Broker/provider contract；
- 每个 registration 和后台资源都属于 activation generation，并可确定性 dispose；
- 卸载默认删除 code/derived state、保留 Canonical data，历史 Session 由 Core 渲染。

每个插件都必须能只与 Core 和自己声明的必需依赖闭包一起完成 build、test 和 clean
boot。必需依赖是 manifest 与安装确认中的显式事实，不能藏在运行时探测中。File
Workspace 缺少兼容 Product Surface capability 时必须拒绝激活；它失效不能阻止 Core 和
其他插件运行。

安全边界必须使用恶意 fixture 做 negative test，不能只依赖 manifest/static check。
