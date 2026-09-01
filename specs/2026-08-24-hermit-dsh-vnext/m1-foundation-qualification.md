# M1 Electron + stock DSH Web 桌面底座

状态：

- `M1_IMPLEMENTATION_COMPLETE = PASS`
- `M1_LOCAL_QUALIFIED = PASS`
- `M1_RELEASE_INPUT = PASS`

更新时间：2026-09-01

M1 的目标是交付一个可安装、可启动、可恢复的 Hermit 桌面外壳。Electron 负责桌面
生命周期，stock DSH Web 负责官方 AI 和插件能力；产品业务插件不在本里程碑实现。

当前 Mac（Apple Silicon）已经完成 app-dir 和 arm64 DMG 打包、DMG 只读挂载、
安装后 DSH 冷启动、官方 Web UI、crash recovery、插件双端、同 epoch generation 回滚和
keyless Tool/Approval 闭环；强杀 Electron main 后，carrier 也能回收完整 DSH 进程组。
packaged app 已记录稳定 Tray bounds、真实 Tray 菜单打开主窗口、登录项
set/readback/restore 和正常退出顺序，Hermit 自有图标和第三方 attribution 已进入产物。
真实注销/登录后，系统从 `/Applications/Hermit.app` 自动启动同一候选，新的 startup
observation 记录 `wasOpenedAtLogin = true` 并到达 `dsh-ready`，测试登录项随后恢复为关闭。
因此桌面底座实现和当前 Mac 本机资格均已完成，可作为统一 macOS 发布流程的输入。签名、
公证、Gatekeeper 和真实重启分别记录，不在 M1 文档里决定某个 GitHub Release 是否成立。
Windows 留到后续平台阶段；
Quick Panel 及其全局快捷键改为独立模块，均不属于当前 M1。

## 1. M1 交付范围

### 必须交付

- 在兼容范围内验证 Electron、Node、pnpm、DSH 和 React/ReactDOM 组合；DSH RC 仍按精确
  兼容包验收；
- 将 Node、DSH Web、lockfile 和第一方测试插件作为可验证运行时闭包打包；
- Electron 单实例、spawn、ready URL 解析、profile/home 隔离和进程监督；
- hardened BrowserWindow 加载 `127.0.0.1:<os-port>` 的 DSH Web；
- 官方 Conversation、Session、Settings、Tool、Approval 和插件管理正常工作；
- 主窗口、Tray 和开机启动；
- DSH 崩溃、Electron 退出、系统关机和更新失败的可观察恢复；
- 同一个无特权 `.tgz` 插件在 stock DSH 和 Hermit 中安装、启动、停用和卸载。

### 明确不交付

- Personal Organizer、File Workspace、Smart Clipboard 业务；
- Package Gate、Capability Broker、隔离 Runner 的完整产品实现；
- Tauri、Rust、零 TCP carrier、反向代理或第二套聊天 UI；
- 社区插件市场、远程控制和真实模型凭据自动化测试。
- Quick Panel 及其全局快捷键的产品需求、接口和交互；现有实验实现不作为 M1 合同。
- Windows 安装器和原生生命周期证据；当前 M1 只验收 macOS Apple Silicon。

## 2. M1 关键原则

1. 只使用 DSH public package root、公开 client export、slot 和 service；
2. 不复制 DSH 私有 graph、路由、React root 或源码扫描实现；
3. 插件不得依赖 Electron、preload、`window.hermit` 或另一个插件内部；
4. `127.0.0.1` 是监听边界，随机端口不是身份认证；
5. DSH ready 必须由受支持的信号证明，不能使用固定延时；
6. 失败要停止、重启或进入恢复状态，不能静默 fallback；
7. 所有版本以一个 compatibility bundle 测试，不能单独升级 Electron 或 DSH。

## 3. 实施阶段

| 阶段 | 结果 |
| --- | --- |
| M1-A 运行时闭包 | 已通过：兼容范围、lock、integrity、Node/DSH/pnpm 打包和 clean install |
| M1-B 启动监督 | 已通过：单实例、spawn、profile、ready URL、关闭和进程树回收 |
| M1-C 官方 DSH 桌面 | 已通过：Conversation、Settings、Session、Tool/Approval |
| M1-D 桌面入口 | 实现、真实 Tray 菜单交互和真实登录启动均已通过 |
| M1-E 失败恢复 | DSH crash、统一 quit、Electron SIGKILL、预置 generation 回滚已通过；真实重启作为额外 OS 证据 |
| M1-F 插件双端 | 已通过：同一 `.tgz` 在 stock DSH/Hermit 安装、启动、停用、卸载 |
| M1-G 退出评审 | 实现和本机资格完成；是否已发布由 GitHub Release 和发布清单证明 |

## 4. 验收矩阵

| Gate | 必须证明 | 失败处理 |
| --- | --- | --- |
| `M1-BOOT` | 用户无需系统 Node，Electron 能启动自带 DSH | 阻止进入 UI 验收 |
| `M1-READY` | URL、host、port、profile 和 DSH 可交互状态均已验证 | 显示启动失败原因 |
| `M1-UI` | 官方 Conversation、Session、Settings、Tool、Approval 可用 | 不进入插件验收 |
| `M1-DESKTOP` | 主窗、Tray、开机启动可用 | 保留失败证据 |
| `M1-LIFE` | 关闭、crash、重启、关机和孤儿进程清理可证明 | 进入恢复状态 |
| `M1-SEC` | renderer、导航、IPC、loopback 边界测试通过 | 拒绝发布 |
| `M1-PLUGIN` | 同一包在 stock DSH/Hermit 双端闭环 | 拒绝声称插件兼容 |
| `M1-UPDATE` | 预置、同 epoch 的新旧 generation 启动、回滚和数据保护通过 | 保留旧 generation |

## 5. 测试证据

- 使用虚构数据和 keyless replay；真实 Provider 凭据只做人工 smoke，不进入仓库或 CI；
- 契约测试覆盖 host、ready、renderer、插件安装和拒绝路径；
- 集成测试覆盖进程退出、重启、背压、窗口焦点和同一插件包双端安装；
- 端到端测试覆盖“从 app-dir/DMG 启动 Hermit -> 启动 DSH -> 打开官方页面 -> 退出
  -> 再启动”；
- Supervisor 测试明确覆盖 DSH crash 后换端口恢复、超过上限进入 unavailable、根进程先
  退出但孙进程仍存活时的整组清理，以及第一次清理失败后保留受管引用并重试；
- generation 故障注入覆盖候选启动失败、提交状态失败、旧 generation 停止失败、trial
  写入失败、pending 清理失败、状态主文件损坏和跨 `dataEpoch` 拒绝；
- `apps/desktop-vnext/tests/plugin-dual-end.test.mjs` 使用同一个 `.tgz` fixture，通过 DSH
  官方 `plugin` 管理路径分别验证 stock DSH 和 bundled DSH 的安装、启动、停用、卸载；
- `apps/desktop-vnext/tests/plugin-fixture-lifecycle.test.mjs` 使用真实 Cordis `Context` 和
  公开 `WebServer`，验证插件 fiber dispose 后，同一进程、同一端口的资格路由从 200
  变为 404；它不替代 Client 插件热卸载资格；
- `apps/desktop-vnext/tests/m1-replay-packaged.e2e.mjs` 启动实际打包的 `Hermit.app`，使用
  DSH 官方 `@deepseek-ai/dsh-llm-replay@0.1.1-rc.2` 和固定来源夹具，验证 Read Only
  拒绝、Approval、`Allow once`、真实文件写入、`DONE`、强杀 Electron main 后完整 DSH
  进程组/端口消失，以及重启后 Session 恢复；
- Replay 只替换模型 provider，Agent loop、Tool、sandbox、Approval、Web、持久化和 Electron
  生命周期均使用打包产物的真实实现；测试使用隔离 `userData`，不读取或修改用户现有 Session；
- `apps/desktop-vnext/tests/m1-desktop-packaged.e2e.mjs` 使用隔离 `userData` 启动实际
  `Hermit.app`，验证稳定 Tray bounds、登录项 set/readback/restore，以及 shutdown
  coordinator 的 stop-before-quit 顺序；同时读取产品正常写出的最近一次 startup observation，
  确认同一启动已到 `dsh-ready`，schema v3 证据只记录它实际负责的实现和本机资格；
- `apps/desktop-vnext/scripts/verify-mac-artifact.mjs` 只读挂载唯一 DMG，复验 plist、Hermit
  executable、bundled Node arm64/版本、stock DSH generation、carrier、许可证、冷启动和
  packaged desktop E2E，最后明确卸载磁盘镜像；
- observer-only JSONL evidence 只在显式验收环境启用并限制在当前 `userData` 内，记录真实生产
  路径结果但不提供触发动作；因此它不能把模拟事件升级成系统关机或物理快捷键证据；
- `apps/desktop-vnext/scripts/qualify-mac-login.mjs` 把真实登录验收拆为可恢复事务：`status`
  只读，`prepare` 只在明确授权变量存在且安装候选与 mac-smoke fingerprint 一致时记录原状态
  并注册登录项，只有读回 `enabled` 才允许注销；初始 `not-found` 只记录为异常但可探测的
  基线，不解释成正常未注册。`verify` 读取登录后正常 startup observation、保存结果，并把
  原关闭语义恢复为 Apple 的规范 `not-registered`；脚本不复制或删除
  `/Applications/Hermit.app`，也不触发注销；
- 最终 Mac app-dir 使用实际用户 profile 做了只读冒烟：原有 Session 仍可见，应用菜单
  包含开机启动入口，Cmd+Q 后 Hermit/DSH 无残留；
- 生成证据放在 `.hermit/artifacts/`，只在 M1 评审文档中引用，不把运行产物提交进仓库。

## 6. 当前原生证据与剩余项

当前 Mac 候选的 manifest 记录 Node `24.19.0`、pnpm `11.7.0`、DSH `0.1.1-rc.2`；这些是
本次产物事实，长期开发政策仍是 Node `24.x`、pnpm `11.x` 的项目已验证范围。

| 项目 | 2026-08-28 状态 |
| --- | --- |
| macOS arm64 app-dir、DMG、只读挂载 cold start、Replay Tool/Approval、Session 重启恢复 | 已通过 |
| 52 个桌面测试、Q0 4/4、frozen lock、peer、Agent/文档治理 | `PASS` |
| stock/bundled 同一 `.tgz` 和真实 A→B→重启→A 回滚 | `PASS` |
| 实际用户 Session、Cmd+Q 进程清理 | `PASS` |
| Electron SIGKILL 后 carrier/DSH 全树和端口消失、Session 重启恢复 | `PASS` |
| macOS packaged Tray 实体/稳定 bounds、登录项 set/readback/restore、正常退出顺序 | `PASS` |
| Hermit 自有图标、MIT attribution、arm64 DMG mount/verify | `PASS` |
| Windows 原生 app-dir、NSIS 与生命周期证据 | `DEFERRED`，不阻塞当前 M1 |
| macOS 真实 Tray 菜单点击“打开 Hermit” | `PASS`，已记录 `desktop.tray-command = open-main` |
| macOS 注销并重新登录后自动启动 | `PASS`；`wasOpenedAtLogin = true`、新 `launchId`、同一安装路径和 `dsh-ready` 均成立，登录项已恢复为 `not-registered`；结果只代表当前机器 |
| macOS Developer ID 签名、公证、Gatekeeper | 独立发布步骤；当次执行则验收，跳过则记录 `SKIPPED` |
| macOS 真实关机/重启和启动恢复 | 额外 OS 证据，不是每个版本的固定发布门 |
| Quick Panel 及其全局快捷键 | `DEFERRED_TO_MODULE_DESIGN`，不阻塞当前 M1 |

Apple 将 Developer ID 和公证定义为 Mac App Store 外分发身份与 Gatekeeper 证明，不是桌面
底座代码是否实现的判据；Electron 同时明确说明，未签名/未公证应用的登录项可能静默失效。
因此签名状态必须进入发布说明，但不由 M1 本机资格替 GitHub Release 作结论。
本次证据已满足稳定安装路径上的新 `launchId`、`wasOpenedAtLogin = true`、`dsh-ready` 和
登录项恢复。未签名候选自动启动失败只表示本机资格没有建立，不反向把桌面实现改成失败，
也禁止为此增加隐藏参数或测试 IPC。
当发布选择 `required` 时，缺少身份、公证凭据或验证失败必须 fail closed；选择 `skip` 时
隔离相关凭据并明确记录 `SKIPPED`。具体流程见
[macOS 发布流程](../../docs/development/macos-release.md)。参考
[Apple Developer ID](https://developer.apple.com/support/developer-id/)和
[Electron login item](https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings-macos-windows)。

M1 的更新 Gate 到“预置 generation 激活与回滚”为止。下载、包信任、签名验证、跨
`dataEpoch` 迁移和任意第三方更新属于后续 Package Gate，不用 M1 的本地目录状态冒充。

## 7. 与已有 Q0 检查的关系

现有 `scripts/qualification/` 检查继续验证 DSH `0.1.1-rc.2` 的发布物边界、公开
contract、React 单实例和 clean install。`Q-CMOD-01` 的 blocked 结果说明“无 WebServer
的 DSH Client Host”不是当前 M1 需要的能力；它不再阻止 Electron 加载 stock DSH Web。

如果 DSH 版本、公开 export 或 React graph 改变，必须重新运行 Q0 和本文件的 M1 gate。
任何 verifier 通过都不能把内部源码 import 升级为 public contract。

## 8. M1 退出后的下一步

M1 的 stock DSH 结论仍然有效，不代表后续 Product Plugin 永远不能修改 Hermit 自带的 DSH
Web。若公开 Product Surface 缺口阻塞已确认业务闭环，可在 M1 退出后按新 ADR 建立受控
source-patched generation；该 generation 需要独立的源码/许可证、构建、双宿主、React identity
和生命周期资格，插件仍只能依赖 patch 新增的公开 typed contract。

工程主线进入 `P0 Product Plugin Vertical Slice`，首个插件是核心需求已指定的 Personal
Organizer。版本发布按统一流程独立推进，不要求业务开发等待 Apple 凭据。按以下顺序
推进：

1. 先解决 `plugins/organizer/DESIGN.md` 的剩余范围问题，使设计达到
   `READY_FOR_IMPLEMENTATION`；没有冻结设计前不写业务代码。
2. 使用已通过双端资格的 Reference Plugin 继续做公共契约回归，并单独证伪 DSH 是否存在
   可承载日常业务页面的 public Product Surface；只有 Settings 探针不算业务入口。若 stock
   DSH 没有公开入口，按“外部协作”规则评估 Hermit bundled source patch；在 patch 或上游
   surface 资格通过前停止正式 UI 激活，不使用私有 Router 或 DOM 注入。
3. 为 Organizer 建立同一个可安装 artifact 和最小 Package Gate。第一版 Gate 只固化已被
   真实切片需要证明的规则：manifest/patch/entry、artifact hash、正常依赖范围、RC 精确锁、
   禁止 DSH private import、禁止 Electron 权限、React 单实例和 effect 生命周期。
4. 按 Organizer 设计会话确认第一条 Todo 业务脊柱：手工新建 -> 默认工作面 -> 右侧抽屉
   查看/编辑 -> 完成 -> 重启后同一 item ID 和状态保留。输入必须直接成为 Note、Todo 或
   Event，禁止重新引入 Inbox、无类型临时记录或待整理队列。
5. UI 和 DSH Tool 共用同一 domain service 和 Canonical item；在同一 artifact 上完成 stock
   DSH/Hermit 安装、启动、停用、卸载和数据保留，再接入“Conversation 明确待办 -> 一个
   Organizer Skill -> Tool 创建 Todo -> permission/Approval policy + callId 幂等 -> UI 刷新”。
   `@Todo -> resource_read`、带 revision 的更新、Note 类型纠正、Event、Reminder、
   Search/Trash/导出按设计确认的后续切片逐项进入，不在首条切片预建空实现。
6. Capability Broker 只处理切片已经证明的公共能力缺口，不先建设通用大平台，也不得让
   Organizer 变成只能在 Hermit 运行。File Workspace 和 Smart Clipboard 等 Organizer
   切片稳定后再按核心需求顺序进入。

Reference Plugin 已经存在并通过真实双端资格，后续只作为 SDK/Package Gate 正向 fixture，
不是 Product Plugin、共享业务库或三个业务插件的运行时依赖。
