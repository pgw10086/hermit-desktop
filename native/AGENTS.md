# Native Provider 规则

- Native/FFI 是 Core-owned provider surface，不是产品插件的 ambient authority；
- 所有跨进程/ABI 输入必须验证，并保留 protocol generation、timeout、cancellation
  和 error 语义；
- 特权操作必须经过声明的 capability，产品插件不得直接 link native API；
- `unsafe` 必须最小化、说明原因并封装在安全接口后；
- Swift/Win32/Linux 平台代码留在所属 Rust crate，不创建新的顶层平台目录；
- 拒绝路径和进程/资源回收必须有测试。
