# 产品插件安全契约

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
environment、credential、model/`ctx.llm`、Tauri、native/FFI 或其他插件的数据
authority。纯计算 API 不应仅因属于 Node built-in 就被当成特权能力。

隔离 Runner 属于 defense in depth；普通 Cordis composition 和 DSH filesystem
sandbox vocabulary 不能证明 network/process/credential 已隔离。

## 依赖和生命周期

- 唯一 Hermit 硬运行时依赖是 Core 公共 contract；
- 跨插件协作使用 Core event/service/capability，不使用 value import、shared table
  或 foreign key；
- Client code 不直接 invoke Tauri/native；Host code 经过 Broker/provider contract；
- 每个 registration 和后台资源都属于 activation generation，并可确定性 dispose；
- 卸载默认删除 code/derived state、保留 Canonical data，历史 Session 由 Core 渲染。

每个插件都必须能只与 Core 一起完成 build、test 和 clean boot。未安装或卸载任意一个
插件时，Core 和其他插件仍能独立运行；插件不能把自身启动条件藏在另一个插件中。

安全边界必须使用恶意 fixture 做 negative test，不能只依赖 manifest/static check。
