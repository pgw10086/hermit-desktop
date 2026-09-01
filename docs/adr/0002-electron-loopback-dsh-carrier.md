# Electron 作为薄桌面壳并加载 stock DSH Web

状态：`superseded by ADR-0003`

日期：2026-08-26

替代：[ADR-0001：桌面端采用零 TCP 载体](0001-zero-tcp-desktop-carrier.md)

补充替代：[ADR-0003：允许 Hermit 自带 DSH Web 携带受控 source patch](0003-hermit-bundled-dsh-web-source-patch.md)

以下正文保留 M1 的 Electron + stock DSH carrier 历史决定；Product Surface 的 source patch
边界以 ADR-0003 为准。

## 背景

Hermit 需要保留 DSH 官方 Web、Session、Tool、Skill、MCP 和插件生态，同时提供桌面
窗口、托盘、快捷键、开机启动和更新。上一版 Tauri/零 TCP 方案要求 DSH 暴露尚未具备的
transport-neutral Client module Host 契约，无法在当前官方发布物上形成可维护的底座。

## 决策

采用一个自研的薄 Electron shell，启动并监管 Hermit 自带、经过兼容性验证的 Node/DSH 运行时，使用
`127.0.0.1` 和 OS 分配的随机端口加载未修改的 stock DSH Web。

Electron 只负责桌面生命周期和 DSH 进程监督。DSH 继续负责 Web shell、对话、Session、
Tool、Skill、MCP、Settings、Approval 和插件运行时。Hermit 业务以标准 DSH 插件交付，
插件不依赖 Electron 私有 API，并使用同一个 `.tgz` 在 stock DSH 和 Hermit 中验收。

## 选择理由

- 不复制 DSH 私有 Web graph、路由或 React 运行时；
- Electron 与 Node/DSH 的运行环境一致，减少跨 WebView 实现差异；
- 桌面能力、进程监管、Tray、快捷键和更新有成熟平台支持；
- loopback + 随机端口与 stock DSH Web 能力匹配，不引入第二个业务代理；
- 插件保持可移植，Hermit 不会变成 DSH 的私有分支。

## 代价和风险

- Electron 安装包更大，必须在兼容范围内验证 Chromium、Node、Electron 组合并做签名更新；
- loopback 不是认证边界，同用户本地进程可能调用 DSH API；
- 进程树、孤儿进程、profile 隔离、更新回滚和 renderer 安全必须有真实测试；
- DSH 是 developer preview，每次升级都必须重新做兼容性资格认证。

## 后续约束

1. 当前系统职责只写在 `docs/architecture/system-boundaries.md`；
2. Electron/DSH 的具体启动、renderer、loopback 和恢复义务写在
   `docs/contracts/dsh-integration.md`；
3. M1 先完成桌面闭环和插件双端安装验证，再进入业务插件；
4. 不因为旧 ADR 或外部社区实现而引入 Tauri、零 TCP、私有 DSH import 或旁路代理；
5. 若未来改变桌面载体，必须新增 ADR 并标记本 ADR 为 `superseded`。
