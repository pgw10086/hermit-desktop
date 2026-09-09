# Hermit DSH vNext 项目启动准备

状态：`M1_IMPLEMENTATION_COMPLETE + M1_LOCAL_QUALIFIED`

更新时间：2026-08-28

本文只记录开始 M1 开发前必须确认的仓库、工具链和运行时条件。长期系统职责以
[系统边界](../../docs/architecture/system-boundaries.md)为准，产品范围以
[核心需求](core-requirements.md)为准。

## 1. 大白话结论

底层路线已经确定：Electron 是桌面外壳，Hermit 自带通过兼容性验证的 Node 和 DSH Web（M1
以 stock 基线为准，后续 Product Surface 可使用经过审计的 Hermit source-patched generation），
通过本机 `127.0.0.1` 随机端口连接。M1 不再等待 DSH 提供脱离 WebServer 的 Client
module Host，也不实现 Tauri、Rust 或零 TCP carrier。

M1 桌面底座实现已经完成，并形成 macOS Apple Silicon 可运行候选；Windows 留到后续平台
阶段。真实 Tray 菜单交互和注销后自动启动均已通过，本机资格已经完成。版本发布不再由本
文另设条件，统一按 [macOS 发布流程](../../docs/development/macos-release.md)执行；签名、公证
和 staple 是流程中必须如实记录的可选步骤。

## 2. 仓库和 GitHub

- 主仓库：`pgw10086/hermit-desktop`，当前 checkout 位于多仓工作区的
  `hermit-desktop/`；旧 `hermit-vnext` 名称和来源 commit 只属于迁移历史，不是当前环境事实；
- 旧 Hermit 仓库和用户数据不在原地改造成 vNext，也不由本仓库测试清理；
- 当前仓库不嵌套新的 Git 仓库，不提交真实用户数据、凭据或浏览器状态；
- 第一方插件位于 sibling 仓库，分别打包和版本化；Hermit Desktop 通过固定 package
  或 tarball 消费它们；
- DSH source patch 只有在必须补齐已确认的 Product Surface、用户已授权且通过 ADR、许可证/notice、
  构建摘要、精确版本和双宿主资格时才进入 Hermit bundled generation；不维护未经审计的完整 fork。

## 3. M1 工具链候选

| 项目 | 当前兼容候选 | 规则 |
| --- | --- | --- |
| Electron | `43.x` 兼容范围 | 随桌面发布物和 Chromium 一起测试 |
| Node | `24.x` 项目已验证；`22.x` 候选 | 随应用打包，不依赖系统 Node |
| pnpm | `11.x` 项目已验证 | Corepack 用于开发；发布物携带插件管理所需 pnpm |
| DSH | `0.1.1-rc.2` | 精确 npm closure 和完整 integrity |
| React | `18.x` 兼容范围 | 与 DSH 解析结果保持单实例 |

当前 `scripts/qualification/` 的 Q0 检查继续用于记录 DSH 发布物、公开 export、React
解析和 clean install 证据。它不再阻止 Electron M1，但任何版本升级仍要重新检查。

## 4. 开工前硬条件

1. Electron、Node、pnpm、DSH 的兼容范围和 lockfile 已提交，发布候选的实际解析版本可追溯；
2. Hermit 使用独立、可识别的 DSH profile/home 和数据根；
3. DSH 只能监听 `127.0.0.1`，端口由 OS 分配，不能绑定 `0.0.0.0`；
4. Electron renderer 的安全基线已写入实现测试：无 Node integration、隔离、sandbox、
   导航白名单和 sender 校验；
5. DSH 的 ready 信号、退出、崩溃、重启和孤儿进程清理都有可执行验收；
6. 一个无特权第一方测试插件可以在 stock DSH 和 Hermit 中使用同一个 `.tgz` 安装、
   启动和卸载；
7. 兼容性失败必须明确停止或进入恢复状态，不使用静默 fallback。

## 5. M1 不做什么

- 不实现 Organizer、File Workspace、Smart Clipboard 业务逻辑；
- 不实现 Package Gate、Capability Broker 和隔离 Runner 的完整产品能力；
- M1 不复制 DSH Conversation、Settings、路由或私有源码；后续允许的 DSH source patch 只能补公开
  typed contract，不改变这条运行时边界；
- 不实现 Tauri、Rust、零 TCP carrier 或 Electron 业务代理；
- 不创建插件市场、社区插件目录或第二套聊天 UI；
- 不把旧 Go 运行时、旧数据或旧凭据接入新运行时。

## 6. 开发顺序

```text
选择 Electron/Node/pnpm/DSH 兼容范围并锁定候选
  -> 打包自带 Node 和 stock 或受控 source-patched dsh web generation
  -> 单实例、spawn、URL 解析、ready 探测
  -> hardened BrowserWindow 加载 DSH Web
  -> 关闭、崩溃、有限重启和进程树回收
  -> 主窗口、Tray、开机启动
  -> 原生安装器和上一 generation 回滚演练
  -> 同一测试插件在 stock DSH/Hermit 双端安装验证
  -> M1 实现退出评审
  -> 本机交互资格补证
```

Quick Panel 及其全局快捷键不在这条 M1 开发顺序内；当前独立模块 spec 已形成，后续按
Desktop Surface 的独立开发、打包和验收顺序推进。
仓库中的现有实验页面不作为 M1 完成证据。

## 7. M1 退出和发行条件

M1 实现只有同时满足以下条件才算完成：

- 安装后无需系统 Node 即可启动；
- Electron 能启动、探测并加载当前批准的 DSH Web generation（M1 stock baseline，后续可为 Hermit
  bundled source-patched generation 单独建证据）；
- 官方 Conversation、Session、Settings、Tool、Approval 和插件管理可用；
- 主窗口、Tray 和开机启动实现及 OS API readback 可用；
- DSH 崩溃、Electron 退出、关机协调器和更新失败不会留下不可控的 DSH 进程；
- renderer 和 loopback 边界测试通过；
- 同一个第一方插件包可在 stock DSH 和 Hermit 中安装、启动、停用、卸载；
- 失败路径可观察，测试证据已保存到 `.hermit/artifacts/`，不依赖真实凭据。

以上条件已经通过，因此 `M1_IMPLEMENTATION_COMPLETE = PASS`。packaged Hermit 的真实
Tray 菜单点击和真实注销/登录自动启动已通过，因此 `M1_LOCAL_QUALIFIED = PASS`；
发布版本的 tag、制品和步骤状态由统一发布流程及 GitHub Release 负责，不能用 M1 状态代替。

M1 实现完成后才开始三个业务插件的第一条 vertical slice。File Workspace 当前使用已经
完成资格验证的 Hermit Product Surface v1 作为唯一中央宿主，不依赖辅助栏插件，也不维护
双宿主状态。此前的辅助栏宿主审计只作为历史研究证据保留，不再是实现前置条件。M2 的
权限、隔离和社区插件策略仍在真实 Product Plugin 切片证明需求后逐步冻结，
不预建完整平台。

## 8. 当前机器结论

- 当前主机是 macOS arm64，不使用旧 Windows 结论替代当前事实；
- Node 24 + pnpm 11 可生成资格证据；Node 25 只用于诊断观察，不能生成发布候选；
- Mac app-dir、arm64 DMG、产品图标、keyless Tool/Approval、Electron SIGKILL
  carrier 清理、Session 恢复、插件双端、generation 回滚、packaged Tray bounds、登录项
  读写、正常 startup observation 和统一退出顺序已通过；
- macOS 真实 Tray 菜单点击已通过，跨注销资格 journal、官方 `wasOpenedAtLogin` 判据和原状态
  恢复均已通过，`M1_LOCAL_QUALIFIED = PASS`；签名、公证、Gatekeeper 和真实关机/重启仍
 作为独立证据记录，不反向改变 M1 结论。Windows 和 Quick Panel 不属于当前 M1，Quick Panel
另见 [Desktop Surface 与 Quick Panel spec](desktop-surface-quick-panel.md)。
