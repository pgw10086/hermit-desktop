# 桌面端采用零 TCP 载体

状态：`superseded by ADR-0002`

替代决定：[ADR-0002：Electron 作为薄桌面壳并加载 stock DSH Web](0002-electron-loopback-dsh-carrier.md)

以下正文保留历史决定原貌，仅增加本状态和替代链接。该方案不再指导当前实现。

## 历史决定

Hermit 桌面端使用 Tauri invoke/event 连接 WebView 与 Rust，使用带长度前缀的继承
stdio 连接 Rust 与受管 Node/DSH 进程，并使用 Tauri custom protocol 交付 DSH 前端
和 Client bundle。产品运行时不启动 localhost、随机端口或反向代理；资格认证失败时
停止并重新决策，不自动降级到 TCP。

## 历史原因和后果

DSH Web server 没有认证或 Origin policy，本机随机端口也不是安全边界。stdio 与
子进程生命周期天然绑定并跨平台，不需要 named pipe/Unix socket 的命名、ACL 和残留
清理。custom protocol 能执行带 revision 校验的 classic bundle，不需要 Blob、
`eval` 或第二套 React root。

该决定要求 DSH 发布物提供 transport-neutral Client module Host 契约。缺少该契约
时 M1 必须停止；Hermit 不复制 DSH 私有 graph 扫描算法，也不伪造未被上游承诺的
`webServer` provider。
