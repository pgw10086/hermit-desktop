# 系统边界

状态：`current`

本文是 Hermit 当前运行架构的唯一权威来源。它只回答“谁负责什么、谁依赖谁、运行时
如何连接和恢复”。M1 载体起点见
[ADR-0002](../adr/0002-electron-loopback-dsh-carrier.md)，受控 DSH source patch 边界见
[ADR-0003](../adr/0003-hermit-bundled-dsh-web-source-patch.md)；具体接入义务见
[DSH 集成契约](../contracts/dsh-integration.md)。

多仓工作区的跨项目边界见外层 `docs/architecture/platform-boundaries.md`；本文只保留 Hermit
Desktop 的产品架构、runtime 组合和宿主生命周期。

## 长期运行形态

```text
Agent Desktop Core (`@tianbuyv/agent-desktop-core`)
|-- 窗口、Tray、Surface、快捷键、通知、系统能力、受控 IPC 和退出生命周期
|-- Agent Runtime 生命周期契约和通用桌面证据
`-- 不拥有任何 Agent 的 Web/Layout、会话或业务状态

DSH Runtime Adapter (`@tianbuyv/dsh-runtime-adapter`)
|-- DSH 命令、ready 探测、carrier、崩溃恢复和 DSH generation
`-- 依赖 Agent Desktop Core，不反向进入 Core

Hermit Desktop
|-- Hermit 产品壳、Hermit layout/source patch、Hermit DSH generation/profile
|-- Hermit Product Plugin 组合和 Hermit 打包发布
`-- 组合 Agent Desktop Core、DSH Runtime Adapter 和自己的 Electron + DSH runtime

Bundled DSH Web/Runtime
|-- 官方 Web shell、Conversation、Session、Settings
|-- Tool、Skill、MCP、Approval 和插件生命周期
`-- Hermit Product Plugins
    |-- Personal Organizer
    |-- File Workspace -> Hermit Product Surface v1
    `-- Smart Clipboard
```

Electron/Agent Desktop Core 是桌面平台层，不承载产品业务和 DSH 私有实现。DSH 是当前 Hermit 的 AI 与插件运行底座。
stock DSH 是插件 artifact 的兼容基线；Hermit bundled DSH generation 可以携带经过审计
的最小 source patch 来补齐公开 Product Surface，但插件仍是标准 DSH 插件，只依赖 patch
暴露的公开 typed contract。stock DSH 没有该能力时，插件必须确定性 unavailable，不能靠
运行时私有实现继续工作。

Hermit 自己决定 DSH 上游 commit、generation、profile、layout 制品和打包清单。DSH Web/Layout
不能放入 Agent Desktop Core；未来其他 Agent 只通过自己的 Runtime Adapter 接入，不改变 Core
对 Conversation、Session、Tool、Approval 等业务语义的不了解。

Hermit carrier 是 Electron 与 DSH 之间的一次性生命周期载体。它只转发输出、监听父进程
管道并回收一个 DSH 进程树；不读取 DSH 配置或 Session，不解释协议，也不拥有重启策略。

Quick Panel 现在按独立模块设计为 Desktop Surface 能力，仍不属于 M1 已完成的资格范围。
Desktop Core 提供统一的 Surface Manager 和 typed contract；第一条产品闭环是
`conversation.quick`，它通过正常 DSH Session 承载对话，不创建第二套 AI runtime。Quick 页面
由 Hermit layout 独立绘制，`approval.companion` 是不嵌入 Quick 的独立审批入口。
Smart
Clipboard 的快速取回和未来 Product Plugin 小窗复用窗口宿主，但继续拥有自己的数据、领域
服务和动作语义，不能因为都使用浮层而合并业务状态。

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
- Hermit 携带自己通过兼容性资格检查的 Node、pnpm、DSH 组合；Agent Desktop Core 提供
  通用生命周期能力，DSH Runtime Adapter 提供 DSH 启动、就绪探测、退出、崩溃恢复和进程树清理；
- 创建受限 renderer，加载经过允许的 DSH loopback origin；
- 提供 Desktop Surface Manager，统一创建、定位、显示、隐藏、焦点、窗口策略和
  renderer 清理；Surface 内容和业务状态由 DSH 或对应 Product Plugin 提供；
- 为使用 Surface 的插件提供经过 sender/schema 校验的窄 facade；Smart Clipboard 的快速
  取回只调用自己的业务 facade，`conversation.quick` 只绑定 DSH Session；
- 为 Reminder 等真实桌面流程提供经过 sender/schema 校验的 `desktop.deadlines` 和
  `desktop.notifications` facade；Core 只执行绝对时刻等待和系统投递，不保存 Rule、Occurrence、
  重复、时区或业务正文，事件只回发给 owner window；
- 通过 Core `ShortcutRegistry` 统一管理插件快捷键、内部重复和系统注册结果；快捷键被占用
  时只撤下对应命令，不回滚 Smart Clipboard 的捕获、History 或 IPC；DSH bundled layout 的
  快捷键中心通过独立的只读列表/更新/恢复 facade 消费这些状态；
- 在 macOS 主进程加载唯一、精确 ABI 的 Objective-C++ N-API micro-adapter；它只提供稳定
  pasteboard 快照/写回、应用身份和守卫后的粘贴按键，不获得网络、shell、凭据或任意文件
  正文读取能力。native 内存故障仍可能终止 Electron，因此签名产物和 disposable 平台资格
  是发布硬门，不能把进程内 addon 描述成崩溃隔离进程；
- 不保存 DSH Session、插件业务数据、模型凭据或插件权限状态；
- 不向插件暴露 Electron API、Node ambient authority、`ipcRenderer` 或私有 preload 接口；
  必须由 renderer 承载的 Core 能力只能以经过 sender/schema 校验的最小公开 facade 暴露，
  不能因此获得未声明的通用桌面权限。

### DSH

- 拥有 Conversation、Session、Tool、Skill、MCP、Approval、Settings 和插件运行时；
- 是产品 AI 的唯一入口，所有业务 AI 操作都回到真实 DSH Session；
- 拥有 DSH profile/home 中的运行时配置和官方数据格式；
- 通过公开 package root、client seam、slot 和 service 接受外部组合；
- bundled DSH 通过 Hermit layout patch 承载 Core-owned 产品入口和“设置 -> 快捷键”页面；
- 负责插件的激活、停用、卸载和生命周期资源清理。

Hermit 独立拥有自己的 DSH profile/home、runtime generation、layout/source patch 和插件清单。
这些输入必须由 Hermit 的 lockfile、manifest 和资格证据锁定；Adapter 只执行 DSH 运行时契约，
不替产品选择 DSH Web 或业务插件。

### Product Plugin

- 拥有自己的业务模型、Canonical 数据、搜索索引和业务 UI/Tool contribution；
- 只能使用公开 DSH/Hermit plugin contract 和声明的 capability；
- 不依赖 Electron、`ipcRenderer`、私有 preload、`window.hermit`、另一个插件的内部文件或
  DSH `src/*`；仅可使用自身 manifest 明确声明、由 Core 提供的最小公开能力 facade；
- 不在业务插件中绘制或保存全局快捷键中心；快捷键命令由 Desktop Core 注册，统一页面负责
  展示和修改；
- 被卸载或停用后，Core 和其他插件仍可正常运行，已有数据按插件契约保留或导出。

Product Plugin 可以在独立 Git 仓库中维护。需要 Electron/native 的插件在自己的仓库中提供
产品专属 desktop-adapter，再通过 Desktop Core typed contract 接入；该 adapter 不会因此
成为共享 Core 能力，也不把产品 UI 反向放进 Core。

Smart Clipboard 当前仍需要桌面运行单元。Electron 每次 DSH ready 都重新读取受管 web profile：
ACTIVE 时幂等启动该单元；停用、卸载、DSH crash 或不可用时先撤快捷键，再停止捕获、IPC、
Surface 实例和数据库连接。当前 Client 停用仍使用明确 DSH 重启边界，不宣称进程内热卸载。
快捷键或某项 Surface 偏好不可用是该能力内部的部分不可用状态，不等于 DSH 或插件资格失败。

## 依赖方向

```text
Electron shell -> bundled DSH runtime
Product Plugin -> DSH public contract + Hermit plugin contract
Product Plugin -/-> Electron private API
Product Plugin -/-> another Product Plugin internals
```

当前物理依赖方向为：

```text
hermit-desktop      -> @tianbuyv/agent-desktop-core + @tianbuyv/dsh-runtime-adapter + Hermit DSH generation + Hermit plugins
@tianbuyv/dsh-runtime-adapter -> @tianbuyv/agent-desktop-core
plugin              -> DSH public contract + declared Desktop capability
```

插件和平台仓库不通过相对路径导入对方源码；产品组合根负责把 Core、Adapter、DSH 和插件制品组装起来。

跨插件协作通过 DSH/Hermit public service、resource、tool 或 domain event 完成。任何需要
桌面特权的动作都经过 DSH/Hermit capability contract，不由插件直接访问文件系统、网络、
进程或凭据。Reminder 的推荐链路是 Organizer 先算出绝对时刻，再调用 deadline facade；
收到 fire 后由 Organizer 幂等认领 Occurrence，再调用 notification facade。Core 重启后不恢复
Reminder 业务状态，Organizer 必须重新 reconcile。

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
