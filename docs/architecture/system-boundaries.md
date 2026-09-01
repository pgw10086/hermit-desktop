# 系统边界

状态：`current`

本文是 Hermit 当前运行架构的唯一权威来源。它只回答“谁负责什么、谁依赖谁、运行时
如何连接和恢复”。M1 载体起点见
[ADR-0002](../adr/0002-electron-loopback-dsh-carrier.md)，受控 DSH source patch 边界见
[ADR-0003](../adr/0003-hermit-bundled-dsh-web-source-patch.md)；具体接入义务见
[DSH 集成契约](../contracts/dsh-integration.md)。

## 长期运行形态

```text
Electron Desktop Shell
|-- 主窗口、Tray、开机启动、更新、单实例
|-- 通过 Hermit carrier 启动并监管自带、经过兼容性验证的 Node/DSH 运行时
|-- Smart Clipboard 桌面运行单元与主进程专用 macOS native micro-adapter
`-- 通过 127.0.0.1 + OS 随机端口加载 DSH Web

Bundled DSH Web/Runtime
|-- 官方 Web shell、Conversation、Session、Settings
|-- Tool、Skill、MCP、Approval 和插件生命周期
`-- Hermit Product Plugins
    |-- Personal Organizer
    |-- File Workspace -> Hermit Product Surface v1
    `-- Smart Clipboard
```

Electron 是桌面外壳，不承载产品业务和 DSH 私有实现。DSH 是唯一的 AI 与插件运行底座。
stock DSH 是插件 artifact 的兼容基线；Hermit bundled DSH generation 可以携带经过审计
的最小 source patch 来补齐公开 Product Surface，但插件仍是标准 DSH 插件，只依赖 patch
暴露的公开 typed contract。stock DSH 没有该能力时，插件必须确定性 unavailable，不能靠
运行时私有实现继续工作。

Hermit carrier 是 Electron 与 DSH 之间的一次性生命周期载体。它只转发输出、监听父进程
管道并回收一个 DSH 进程树；不读取 DSH 配置或 Session，不解释协议，也不拥有重启策略。

通用 AI Quick Panel 及其全局快捷键仍不属于 M1 桌面底座，也没有进入当前产品运行路径。
Smart Clipboard 的快速取回是插件专属桌面工作面：Electron/Core 拥有窗口、快捷键和窄 IPC
facade，插件领域服务仍拥有数据和动作语义。两者不能因为都使用浮层而合并成第二套对话入口。

## 责任边界

### Electron

- 拥有桌面应用生命周期：单实例、窗口、Tray、开机启动、更新和退出；
- 通过一个幂等 Shutdown Coordinator 汇聚正常退出、系统关机和 Windows session-end；
  先停止受管 DSH，再允许 Electron 退出，超过有界等待后由 carrier 的 EOF 路径继续回收；
- 在 `userData/desktop/startup-observation.json` 原子覆盖最近一次正常启动状态，以同一个
  `launchId` 记录 Electron 官方启动原因和 DSH ready；它只服务本地诊断和系统级验收，
  不保存 Session 或业务数据；
- 可选的桌面 evidence sink 只追加记录生产路径观察到的 OS/API 结果，不提供触发 Tray、
  登录项或关机的控制入口，也不能替代真实系统级验收；
- 携带通过兼容性资格检查的 Node、pnpm、DSH 组合，并负责启动、就绪探测、退出、崩溃恢复和进程树清理；
- 创建受限 renderer，加载经过允许的 DSH loopback origin；
- 为 Smart Clipboard 创建鼠标附近的受限快速取回窗口，并持有其全局快捷键、焦点恢复和
  copy-only 通知；该窗口只调用 Smart Clipboard 窄 facade，不承载其他插件或 AI Session；
- 在 macOS 主进程加载唯一、精确 ABI 的 Objective-C++ N-API micro-adapter；它只提供稳定
  pasteboard 快照/写回、应用身份和守卫后的粘贴按键，不获得网络、shell、凭据或任意文件
  正文读取能力。native 内存故障仍可能终止 Electron，因此签名产物和 disposable 平台资格
  是发布硬门，不能把进程内 addon 描述成崩溃隔离进程；
- 不保存 DSH Session、插件业务数据、模型凭据或插件权限状态；
- 不向插件暴露 Electron API、Node ambient authority、`ipcRenderer` 或私有 preload 接口；
  必须由 renderer 承载的 Core 能力只能以经过 sender/schema 校验的最小公开 facade 暴露，
  例如 Smart Clipboard 的 `hermitSmartClipboard`，不能因此获得通用桌面权限。

### DSH

- 拥有 Conversation、Session、Tool、Skill、MCP、Approval、Settings 和插件运行时；
- 是产品 AI 的唯一入口，所有业务 AI 操作都回到真实 DSH Session；
- 拥有 DSH profile/home 中的运行时配置和官方数据格式；
- 通过公开 package root、client seam、slot 和 service 接受外部组合；
- 负责插件的激活、停用、卸载和生命周期资源清理。

### Product Plugin

- 拥有自己的业务模型、Canonical 数据、搜索索引和业务 UI/Tool contribution；
- 只能使用公开 DSH/Hermit plugin contract 和声明的 capability；
- 不依赖 Electron、`ipcRenderer`、私有 preload、`window.hermit`、另一个插件的内部文件或
  DSH `src/*`；仅可使用自身 manifest 明确声明、由 Core 提供的最小公开能力 facade；
- 被卸载或停用后，Core 和其他插件仍可正常运行，已有数据按插件契约保留或导出。

Smart Clipboard 是当前唯一需要桌面运行单元的 Product Plugin。Electron 每次 DSH ready
都重新读取受管 web profile：ACTIVE 时幂等启动该单元；停用、卸载、DSH crash 或不可用时
先撤快捷键，再停止捕获、IPC、浮层和数据库连接。当前 Client 停用仍使用明确 DSH 重启边界，
不宣称进程内热卸载。

## 依赖方向

```text
Electron shell -> bundled DSH runtime
Product Plugin -> DSH public contract + Hermit plugin contract
Product Plugin -/-> Electron private API
Product Plugin -/-> another Product Plugin internals
```

跨插件协作通过 DSH/Hermit public service、resource、tool 或 domain event 完成。任何需要
桌面特权的动作都经过 DSH/Hermit
capability contract，不由插件直接访问文件系统、网络、进程或凭据。

## 运行和恢复模型

```text
Electron single-instance check
        -> prepare Hermit-owned DSH profile/home
  -> spawn bundled Node + Hermit carrier + stock or Hermit-patched dsh web
        -> read and validate loopback readiness URL
        -> load DSH Web in hardened renderer
        -> supervise, restart or show recovery state
        -> terminate the owned process tree on normal exit
```

Electron 只监管自己启动的 DSH 进程，不接管用户单独安装的 stock DSH，也不默认共享
用户的 stock DSH profile。DSH 意外退出时，Electron 记录可观察的失败原因并按重启策略
恢复；连续失败进入恢复界面，不静默切换到另一套运行时。

Electron 与 carrier 保持 stdin 控制/存活管道。正常停止写入 `STOP`；Electron main 被
强制终止时，操作系统关闭管道，carrier 收到 EOF 后用同一幂等流程回收完整 DSH 进程组。
carrier 自己被不可捕获地强杀不在这项保证内，不能把它宣传成内核级 containment。

安装包把 Node、DSH、pnpm 和经过审计的 DSH source patch 摘要放在只读的
`resources/runtime/generations/<id>` 下；Electron
在用户数据目录只保存 generation 激活状态。所有 generation 使用同一个 Hermit DSH_HOME，
因此切换运行时代码不会偷偷切换 Session、Settings 或插件数据负责人。

M1 的更新边界只负责已经由可信发布流程预置的 generation：候选先进入 `prepared`，启动
可用后进入 `trial` 并提交；进程中断或候选失败时回到上一个 committed generation。M1 只
允许相同 `dataEpoch`，不负责下载、验签、解包、数据迁移或把任意可写目录加入候选目录。
这些能力必须等 Package Gate 建立后再扩展。

## Loopback 边界

DSH Web 只绑定 `127.0.0.1`，端口由操作系统分配。loopback 解决端口冲突和跨平台 Web
加载问题，不是身份认证，也不是插件隔离边界。同一用户下的其他本地进程理论上可以发现
并调用该接口，因此 renderer 必须使用 Electron 安全基线，DSH 的 Host/Origin 规则也
必须保持启用。

不得绑定 `0.0.0.0`，不得把随机端口当作 Secret，不得为业务再建一个绕过 DSH 的代理。
详细的启动参数、ready 信号、renderer 设置、关闭语义和兼容测试由
[DSH 集成契约](../contracts/dsh-integration.md)负责。

## 运行时权威

DSH 是 Session、Tool、Settings 和插件激活状态的运行时权威；各 Product Plugin 是其
Canonical 业务数据的唯一 writer。Electron 只拥有桌面生命周期状态和自己启动的进程
句柄。迁移、备份和更新的 authority transfer 必须由对应 change-specific spec 定义，
不能在本文件中另造一套状态机。
