# 产品插件规则

产品插件（Product Plugin）是低信任、可安装扩展。

- 唯一 Hermit 硬运行时依赖是 Core 公共 contract；
- 跨插件协作必须经过 Core contract，不得 import 另一个插件的 value、table、
  migration 或 private UI；
- manifest 必须声明 capability、data namespace、schema/migration owner、host/client
  face、compatibility、integrity 和 signing identity；
- host 通过 Capability Broker/Runner 请求特权副作用；client 不直接调用
  Tauri/native；
- 不得使用 ambient filesystem/network/process/environment/credential/LLM authority；
  runtime skill 必须属于本插件 manifest 并受 runtime capability 管理；
- 每个插件必须能与 Core 单独 build/test/clean-boot，卸载默认不得破坏 Core 或删除
  Canonical data。
