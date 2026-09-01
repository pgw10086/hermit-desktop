# DSH 集成契约

状态：`current`

系统职责和依赖关系以[系统边界](../architecture/system-boundaries.md)为准。本文只定义
Electron 与 DSH Web/Runtime 对接时双方必须遵守的具体规则。stock DSH 是兼容基线；Hermit
bundled DSH 可以在同一 pinned generation 上携带经过审计的最小 source patch，但插件仍
只能消费 patch 暴露的公开 typed contract。

## 运行时闭包

- Electron、Node、pnpm、DSH、React/ReactDOM、第一方插件和批准的必需插件依赖必须在
  声明的兼容范围内组成一个可测试组合；lockfile 记录每次发布候选实际解析的版本。
- 发布物使用 frozen lock、integrity、license/notice 和 SBOM；具体解析版本属于发布物
  manifest，不升级为长期 API 契约。
- 不解析 `latest`、`next`、Git HEAD 或未锁定的 workspace 制品；
- DSH 仍是 developer preview，升级必须重新跑兼容性资格检查，不能只改版本号。
- DSH 闭包由 `pnpm deploy --prod` 生成，并使用 `inject-workspace-packages=true` 和
  `node-linker=hoisted`，保留标准 `node_modules`、`.pnpm` 和 `.bin`；不得改名为
  `modules`，不得让 electron-builder 重新解析或安装这份闭包；
- `pnpm` 是安装后 `dsh plugin` 的运行依赖，不只是构建工具。打包 DSH 的 PATH 先放
  bundled Node 和闭包 `.bin`，不得依赖用户全局 pnpm；
- electron-builder 只把 Electron 壳放进 ASAR，DSH 闭包和 bundled Node 放到
  `resources/runtime/`；`afterPack` 必须检查安装目录内的 CLI、依赖和链接，不得依赖
  构建机的父级 `node_modules`。
- pnpm 的目录链接和 junction 在打包时物化；`.bin` 中指向闭包内部普通文件的相对链接
  可以保留。所有链接都必须非悬空且解析后仍在闭包内，其他链接一律拒绝。

## 启动与就绪

```text
Electron
  -> 启动自带 Node + Hermit carrier
  -> carrier 启动 `dsh web --host 127.0.0.1 --port 0 --no-open`
  -> 读取进程输出中的 URL
  -> 校验 scheme、host、端口和 DSH profile
  -> 通过受支持的健康/页面信号确认 ready
  -> BrowserWindow.loadURL(allowlisted URL)
```

禁止用固定 `sleep` 代替 ready 信号。无法解析 URL、host 不是 `127.0.0.1`、端口不是
有效 OS 分配值、profile 不属于 Hermit 或 DSH 未进入可交互状态时，启动失败并显示原因。

## Profile、Home 和数据

- Hermit 使用自己管理的 DSH profile/home、数据根和凭据命名空间；
- 不默认读取或修改用户单独安装的 stock DSH profile；
- 开发版、生产版和恢复模式使用可区分的数据根；
- Session、Settings、MCP、插件和模型配置的读写必须经过 DSH 正式接口；
- 更新或迁移失败时保留旧 generation，只有显式 authority switch 才切换 writer。

## Loopback 和威胁模型

- 只监听 `127.0.0.1`，严禁绑定 `0.0.0.0`；
- 随机端口用于避免冲突，不是认证机制；
- DSH Host/Origin/fetch-metadata 检查用于降低浏览器跨站利用风险，不替代身份认证；
- M1 接受“同用户本地进程可能调用 DSH API”的风险，不在 Electron 中创建第二个业务
  代理或伪造认证层；
- 任何真正需要的权限控制必须由 DSH、插件 capability 和操作系统边界完成。

## Electron renderer 安全

加载 DSH Web 的 BrowserWindow 必须满足：

- `nodeIntegration: false`；
- `contextIsolation: true`；
- `sandbox: true`；
- `webSecurity: true`；
- preload 只提供经过审查的最小能力；
- 导航只允许当前 DSH origin，外部 HTTPS 交给系统浏览器；
- 禁止未审查的 `window.open`、任意协议和远程代码执行；
- 任何 Electron IPC 都校验 sender 和消息 schema。

Electron 不向 DSH 插件暴露 `ipcRenderer`、Node、文件系统或私有 preload 对象。必须经过
Core 的 renderer 能力时，只允许公开、最小、插件专属的 facade（当前 Smart Clipboard 的
`hermitSmartClipboard`）；facade 的每个请求仍由主进程校验 sender 和消息 schema。

## 退出、崩溃和更新

- Electron 只关闭自己拥有的 DSH 子进程树；
- 正常退出先停止接受新桌面动作，再通过 carrier 管道发送 `STOP`，最后等待并强制回收
  残留子进程；Electron main 突然死亡时，carrier 以管道 EOF 触发同一清理；
- DSH 异常退出使当前操作明确失败，按有限次数重启；重启失败进入可见恢复状态；
- carrier 是 one-shot，不得自行重启 DSH；它清理残留后退出，由 Electron supervisor
  根据 desired state 决定恢复和 backoff；
- POSIX carrier 先向 DSH 根进程发 `SIGTERM`，等待整个进程组退出，再对残留组发
  `SIGKILL`；根进程
  先退出不等于整棵树已经清理；
- Windows 不伪造 Node `SIGTERM` 的优雅退出语义，当前用 `taskkill /T /F` 回收整树；
- 不能只依赖 `before-quit`。macOS `powerMonitor.shutdown` 必须阻止默认退出并等待 supervisor，
  Windows 还必须覆盖 `query-session-end` / `session-end`；
- 正常退出、系统关机、Tray 退出和 Windows session-end 必须汇入同一个幂等协调器；同一轮
  退出只停止一次 DSH，并在完成、明确失败或超过有界窗口后才请求 Electron 退出；
- 验收证据通道只能记录 Tray bounds、OS API 返回值、用户实际触发的回调和退出顺序，必须
  默认关闭、限制在当前 `userData` 内、写入失败不改变控制流，且不得提供模拟快捷键、点击
  Tray 或伪造系统关机的 actuator；
- 桌面壳默认原子覆盖最近一次 startup observation：记录 `launchId`、制品身份、
  `getLoginItemSettings()` 的 `wasOpenedAtLogin` 和当前 stage，并在真实 DSH ready 后推进同一
  记录；它不接受命令行或测试环境伪造启动原因，写入失败也不改变生产启动控制流；
- macOS 登录资格必须先从稳定的 `/Applications/Hermit.app` 注册 `mainAppService`，注销前
  持久记录原始登录项和候选 fingerprint，重新登录后以新 `launchId`、
  `wasOpenedAtLogin = true`、同一路径和 `dsh-ready` 为 PASS，并恢复原始登录项；
- 更新以兼容范围内的 Electron、Node、DSH 和 bundled plugin 为整体 compatibility bundle；
- 新 generation 未通过启动、迁移和恢复检查前，不替换当前可用 generation；
- 发布物必须能回到上一 generation，不能只回滚 Electron 而保留不兼容 DSH 数据。
- M1 只激活安装包内预置、相同 `dataEpoch` 的 generation；跨 epoch 明确拒绝，不做隐式迁移。

## DSH 公共面

- 只消费批准的 package root、公开 `./client` export、typed slot 和 service；
- 若当前 pinned stock DSH 缺少已确认的 Product Surface，Hermit 可以在自带 DSH Web
  generation 中携带 source-controlled、精确锁定并有 license/notice/SBOM、构建摘要和
  双宿主资格的最小 patch；patch 必须先补出公开 typed slot/service，不能把私有实现直接
  暴露给插件；
- 不导入 `@deepseek-ai/**/src/*`、private store、private DOM/class、private CSS 或
  router internals；
- Product Plugin 不打包第二份 React/ReactDOM；
- UI 使用 DSH public primitive、slot、theme 和 semantic token；
- DSH 上游内部可以使用 private export，但 Hermit 外部组合不能依赖它。source patch 属于
  Hermit 自带 DSH 的底座构建输入，不授权插件在运行时读取 patch 的私有实现；stock DSH
  未携带该 patch 时，依赖该能力的插件必须确定性 unavailable。

### rc.2 已验证插件基线

[`@hermit/dsh-plugin-reference`](../../packages/dsh-plugin-reference/README.md) 固化了当前
`0.1.1-rc.2` 的最小外部插件接入面。资格脚本只生成一个 tarball，并用 bundled Node
`24.19.0` 分别安装到 stock DSH 和 Hermit bundled DSH。当前已经验证：

- `dsh.bundle.patch` 能通过官方 profile 插件管理路径激活 Host root；
- Host 能通过公开 settings、tools 和 webServer service 注册并随 fiber 撤销资源；
- `dsh.client.platform:web`、公开 `./client` export 和 `dsh.client.inject` 能被官方
  Client module loader 发现；
- lazy-CJS Client bundle externalize React、ReactDOM 和 DSH runtime/UI package，浏览器
  内真实 React Hook 更新成功；
- typed `settings.plugins.tab` contribution 在 stock/Hermit 两端都可见；
- public `Button`、`Input`、`Menu`、`Tooltip`、`Toast`、`DisclosureRow` 和精确图标
  能从同一 Client bundle 加载，共享 Host React 并继承 DSH semantic token；Menu/
  Tooltip 的放行范围以 UI 规范中的已验证用法为准；
- 从 profile bundle 移除后重启 DSH，Client entry 与资格路由消失；官方 remove 清除依赖
  和 bundle entry。

该结果只建立插件平台的 Bundle/Host/Client/Settings/Tool/lifecycle 基线。Settings tab
是兼容 fallback，不是 Hermit 中的日常业务工作面；stock rc.2 仍没有 Product Surface，
Product Plugin 仍不得使用私有 Router、DOM 注入或 Settings 页面冒充业务入口。

### Hermit Product Surface v1

Hermit bundled generation 已在 rc.2 的 `@deepseek-ai/dsh-client-ui-layout` 上增加受控
Product Surface patch。当前公开面只有：

- root-scoped `product.surface` list slot；
- `ctx.layout.openProductSurface(id)` 与 `closeProductSurface()`；
- `productSurfaceContract = 1` 数值协商标记。

patch 固定到 DeepSeek Harness `dsh-v0.1.1-rc.2` commit
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，源码构建输入位于
`packages/dsh-client-ui-layout/`。运行时 generation manifest 记录 `lib/client.js` SHA-256，
`afterPack` 和安装后验证会拒绝 metadata、摘要或 resolver 结果不一致的闭包。

同一 Smart Clipboard artifact 已通过双宿主真实浏览器资格：stock DSH 只显示 Settings
fallback 并确定没有一级入口；Hermit patched DSH 显示侧栏入口，能够打开、关闭完整 History，
且 sidebar 保持挂载。该 PASS 不意味着 stock DSH 获得 Product Surface，也不扩展到其他布局
能力；未来上游提供等价公开契约时应删除本 patch。

双端停用资格仍以重启 DSH 为生效边界，没有验证 profile 命令或外部 Client 插件的进程内
热卸载。M1 无特权 fixture 另外使用真实 Cordis `Context` 和公开 `WebServer` 验证：插件
fiber dispose 后，同一进程、同一端口上的 Host 路由立即从 200 变为 404。这只证明 Host
effect 可回收，不能代替 Client UI、slot ledger 和 module graph 的热卸载证据；未来若要
取消重启，必须新增同一进程内的双 face 生命周期资格。

在仓库根目录运行
`corepack pnpm --filter @hermit/dsh-plugin-reference test:qualification` 可重建证据；通过结果
写入忽略提交的 `.hermit/artifacts/dsh-reference-plugin-<platform>-<arch>.json`。普通脚本
允许根 `engines` 声明的 Node 范围，只有 bundled Node 24 的结果属于正式资格证据。

## 兼容性验收

每次 DSH 或 Electron runtime generation 变化，至少验证：

1. clean install 和 frozen lock；
2. React/ReactDOM singleton；
3. DSH Web 冷启动、ready、正常退出和 crash recovery；
4. 先以 Reference Plugin 证明 stock DSH 与 Hermit 都能安装、启动、停用和卸载同一个
   `.tgz`；再对第一方 Product Plugin 及其声明的必需依赖闭包执行同样验证。依赖 Product
   Surface 的插件在 stock DSH 中必须确定性 unavailable；
5. renderer 导航、IPC、loopback host 和端口边界；
6. 旧 generation 数据可打开，失败时不会产生半切换 writer。
7. 安装后 bundled pnpm 能通过官方 `dsh plugin` 路径管理 profile 插件；
8. 目标平台原生 app/安装器、签名、公证和系统退出证据分别记录，不能相互替代。
9. macOS 成品中强杀 Electron main 后，carrier、DSH 完整进程组和原端口在有限窗口内消失。
10. 目标平台成品记录 Tray 实体、登录项 readback、启动原因和统一退出顺序；真实菜单点击、
    登录启动和系统关机仍分别保留原生证据，不能由模块测试代替。Quick Panel 与全局快捷键由其
    独立模块另行定义，不属于本契约的 M1 Gate。
