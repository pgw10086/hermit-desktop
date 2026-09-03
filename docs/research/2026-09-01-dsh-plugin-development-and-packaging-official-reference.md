# DeepSeek Harness 官方插件开发与打包规范核对

日期：2026-09-01

状态：`VERIFIED`（官方仓库快照）

上游：`deepseek-ai/deepseek-harness`，commit `dd6322d604e00eec1ba5e0c8541159906a21094a`（2026-08-31 23:53:17 +08:00）

## 结论摘要

1. **DSH 目前不是冻结的长期 v1 插件标准。** 官方 README 明确标记为 `developer preview`，并警告会发生兼容性破坏变更。因此下文是该 commit 的当前 Contract，不应写成永久兼容承诺。
2. **官方把三种概念分开：普通 Cordis 插件、可安装 Bundle、Web Client 半侧。** 普通插件只需被 `cordis.yml`/patch 行挂载；只有要贡献 profile 配置层的包才声明 `dsh.bundle.patch`；只有浏览器半侧才声明 `dsh.client` 并导出 `./client`。把三者强制放进同一个包是 Hermit 的集成选择，不是 DSH 通用要求。
3. **服务依赖必须用 `inject` 表达。** Cordis 根据服务可用性决定激活，缺依赖保持 `PENDING`；服务消失时依赖方会卸载并在服务恢复后重载。不能依赖 YAML 行顺序或手工加载顺序。
4. **注册和资源必须由 fiber/effect 负责撤销。** `ctx.on()`、`ctx.plugin()`、服务注册、`ctx.tools.register()` 等官方注册 API 已经是 effect；外部 timer、连接、watcher 等用 `ctx.effect()` 返回 disposer。`fiber.dispose()` 等待异步清理完成，并递归清理子插件。
5. **配置必须是运行时 schema。** 导出 `Config` 类型和 Schemastery/Standard Schema 校验器；配置在 `apply` 前验证，非法配置使插件加载失败。普通对象不能冒充 schema；`!!js` 是当前 loader 在 `config`/`disabled` 上的实现扩展，不是通用插件元数据表达式。
6. **Tool Contract 由 `dsh-tools` 持有。** 工具插件注入 `tools`，调用 `ctx.tools.register(defineTool(...))`；参数由 schema 校验，`execute` 返回 `output.schema` 声明的规范 JSON 值，`output.render` 生成内容。注册 disposer 随插件卸载。
7. **Bundle/Profile 是两种 manifest、两种职责。** Bundle 的 `package.json` 声明 `dsh.bundle.patch`，并随包提供 `cordis.patch.yml`；Profile 的 `package.json` 声明 `dsh.profile.bundles`，另有自己的 `cordis.patch.yml`。官方明确说一个 package 不同时扮演两者。
8. **安装入口是带 profile 的 `dsh plugin`。** 规范命令为 `dsh plugin --profile <name> add <package>`；CLI 将其余参数原样转发给 profile 目录中的 pnpm，成功后按已安装依赖的 `dsh.bundle.patch` 声明调和 `dsh.profile.bundles`。安装/更新 Bundle 后，正在运行的 profile 仍保持当前启动时的层栈，需要重启。
9. **当前 Hermit 标准存在“官方 Contract 与项目集成政策混写”。** `docs/development/dsh-plugin-development-and-packaging.md` 和 `plugins/development-guidelines.md` 把 Host、Client、Bundle、桌面运行时闭包、L1-L4 资格等要求写成每个插件的共同最低形态；其中只有 Cordis/Tool/Bundle 的小部分来自官方，其余是 Hermit 自己的桌面集成与发布门禁。应拆成“上游基线 + 仅适用的 Hermit Client/桌面扩展”，否则会把简单插件强行绑到双端打包和桌面运行时，造成高耦合。

## 官方一手证据

所有链接均固定到上述 commit；行号是该快照的本地 `nl -ba` 行号，URL 中的 `#L` 便于回看。

### 1. 版本与稳定性边界

- [官方 README（Developer preview）](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/README.md#L11-L15)：DSH 处于 developer preview，明确警告会有 compatibility-breaking changes。
- 该快照根 `package.json` 的版本为 `0.1.2-alpha.3`，属于 alpha 预发布线；版本号本身不是插件兼容性承诺，升级仍需按 commit 重新跑 Contract/资格核对（[package.json#L1-L10](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/package.json#L1-L10)）。
- 同一 README 的源码运行路径要求先 `pnpm install`、`pnpm run build`，再 `pnpm dsh web`；这描述的是官方仓库自身的开发流程，不等于第三方插件必须采用 Hermit 的 runtime-bundle 流程（[README#L29-L41](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/README.md#L29-L41)）。

### 2. 普通 Cordis 插件形态

- 最小插件是导出 `apply(ctx)` 的 TypeScript 模块，`name` 只是诊断显示元数据；`cordis.yml` 的 `name` 是相对路径或 npm module specifier（[第一个插件#L16-L31](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/cordis-tutorial/01-first-plugin.zh.md#L16-L31)）。
- Cordis 接受三种形态：函数插件、带 `apply` 的对象插件、`Service` 子类；官方建议在确实需要提供服务时再使用类形态（[第一个插件#L53-L77](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/cordis-tutorial/01-first-plugin.zh.md#L53-L77)）。
- 官方说明 `apply` 抛错会使插件进入失败路径；无法解析的配置项会由 logger 报告，启动早期可能因 logger 尚未挂载而看不到输出（[第一个插件#L79-L91](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/cordis-tutorial/01-first-plugin.zh.md#L79-L91)）。

### 3. `inject` 与服务依赖

- 服务是通过 `ctx.<key>` 提供的具名能力，消费方声明 `inject = ['serviceName']`；Cordis 会在所有依赖可用前保持 `PENDING`，YAML 行顺序不决定启动顺序（[服务教程#L5-L5](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/cordis-tutorial/03-services.zh.md#L5-L5)、[服务教程#L44-L59](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/cordis-tutorial/03-services.zh.md#L44-L59)）。
- 依赖关系在加载后仍被跟踪：提供方卸载或热替换会带走消费方，服务恢复后消费方再加载；可选能力不要写入硬依赖，而是在使用点通过 `ctx.get()` 探测（[服务教程#L74-L90](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/cordis-tutorial/03-services.zh.md#L74-L90)）。
- 服务实现通过 `Service` 注册到 context；声明合并只影响 TypeScript 类型，不改变运行时注册（[服务教程#L20-L42](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/cordis-tutorial/03-services.zh.md#L20-L42)）。

### 4. 生命周期与资源清理

- 插件可能因为配置编辑、HMR、显式 dispose 或依赖服务消失而卸载；外部资源必须通过 `ctx.effect()` 返回 disposer（[生命周期教程#L5-L10](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/cordis-tutorial/02-lifecycle-and-effects.zh.md#L5-L10)）。
- fiber 状态为 `PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED`，失败另有 `FAILED` 分支；`fiber.dispose()` 等待同步和异步清理并递归清理子插件（[生命周期教程#L62-L80](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/cordis-tutorial/02-lifecycle-and-effects.zh.md#L62-L80)）。
- `ctx.on()`、`ctx.plugin()`、服务注册以及 `ctx.tools.register()` 都由 Cordis 作为 effect 管理；异步 disposer 之间可能并发，必须串行时放到同一个 disposer 内（[生命周期教程#L84-L94](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/cordis-tutorial/02-lifecycle-and-effects.zh.md#L84-L94)）。

### 5. Config / Schemastery

- 插件导出同名 TypeScript `Config` 接口和 Schemastery schema，loader 在 `apply` 前验证并填充默认值；普通对象不满足 Cordis 要求的 Standard Schema（[配置教程#L7-L45](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/user/develop/basic/config.zh.md#L7-L45)）。
- 非法配置会让 fiber 进入 `FAILED` 并以明确错误退出；不同部署需要改变的参数应定义为配置字段，而不是硬编码（[配置教程#L47-L96](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/user/develop/basic/config.zh.md#L47-L96)）。
- 当前仓库 loader 支持 `!!js`，但官方把它限定在 `config` 和 `disabled`；`name`、`id`、`inject` 等元数据保持静态（[配置教程#L70-L80](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/user/develop/basic/config.zh.md#L70-L80)）。

### 6. Tool contract

- 最小工具插件声明 `inject = ['tools']` 并注册 `defineTool`；定义包含面向模型的 `name`、`description`、参数 schema、必需的 `output.schema`/`output.render` 和 `execute`（[工具教程#L7-L36](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/user/develop/basic/tool.zh.md#L7-L36)）。
- `defineTool` 根据参数声明推导 `args` 类型并在 `execute` 前校验；`execute` 返回规范值，`output.render` 负责生成面向模型/宿主的内容，注册的 disposer 随 fiber 卸载（[进入 harness#L17-L50](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/cordis-tutorial/07-into-the-harness.zh.md#L17-L50)）。
- 官方工具参考进一步要求工具只返回 `output.schema` 声明的无损 JSON 值，遵守 `exec.signal`；策略与观测使用 `tools/pre-execute`、`tools/execute`、`tools/post-execute`、`tools/result` 扩展点（[工具编写参考#L38-L61](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/cookbook/adding-a-tool.zh.md#L38-L61)）。

### 7. Bundle / Profile manifest 与 patch

- 官方将 Bundle 定义为“带配置层的 npm 包”，其 `package.json` 声明 `dsh.bundle`，指向 patch 文件；Profile 位于 `$DSH_HOME/profiles/<name>`，其 `package.json` 声明 `dsh.profile` 及有序 `bundles` 列表。两者不是同一个角色（[打包与安装#L9-L17](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/user/develop/basic/publish.zh.md#L9-L17)）。
- 最小 Bundle 目录包含 `package.json`、`cordis.patch.yml` 和被 patch 行引用的插件入口；manifest 示例为 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`，patch 是 YAML 数组，按包名引用插件（[打包与安装#L18-L64](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/user/develop/basic/publish.zh.md#L18-L64)）。
- 没有 `dsh.bundle` 的包仍可安装，但只作为普通依赖，不激活 profile 层；这正是“库”与“Bundle”之间的官方区别（[打包与安装#L56-L64](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/user/develop/basic/publish.zh.md#L56-L64)）。
- Profile manifest 由 CLI 创建维护，用户自己的 `cordis.patch.yml` 在每个 Bundle 层之后应用；后应用层按 `id` 胜出，且覆盖目标行的完整 `config`，不是深度合并（[打包与安装#L66-L73](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/user/develop/basic/publish.zh.md#L66-L73)、[打包与安装#L112-L128](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/user/develop/basic/publish.zh.md#L112-L128)）。

### 8. `dsh plugin` 安装、更新与重启边界

- 官方 canonical CLI 是 `dsh plugin --profile <name> <args...>`；它在 profile 目录转发到 pnpm，因此 `add`、`remove`、`why`、`update` 等 pnpm 子命令均可用。成功后，CLI 根据已安装依赖是否声明 `dsh.bundle.patch` 调和 `dsh.profile.bundles`（[CLI reference#L44-L46](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/apps/cli/reference/README.md#L44-L46)）。
- `add` 的完整示例为 `dsh plugin --profile demo add ./hello-plugin`；Profile 首次使用会初始化并将 Bundle 追加到 `dsh.profile.bundles`，`remove` 同时移除依赖和层（[打包与安装#L75-L110](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/user/develop/basic/publish.zh.md#L75-L110)）。
- Bundle 集合在进程启动时确定。安装、移除或更新 Bundle 后，运行中的 profile 保留当前层栈，必须重启；普通 profile/home patch 文件编辑才走 hot reload（[CLI reference#L48-L58](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/apps/cli/reference/README.md#L48-L58)）。
- Git-hosted 源码包会在安装时运行 `prepare` 构建；pnpm 10+ 默认阻止该脚本，用户必须在 profile 的 `pnpm-workspace.yaml` 精确添加 `allowBuilds`。npm 预构建包或 tarball 不需要该授权（[打包与安装#L153-L178](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/user/develop/basic/publish.zh.md#L153-L178)）。

### 官方实现中的重复挂载风险（非规范结论）

`apps/cli/src/plugin.ts` 的 reconcile 会把**所有已安装且声明 `dsh.bundle.patch` 的依赖**追加到 `dsh.profile.bundles`（[plugin.ts#L47-L90](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/apps/cli/src/plugin.ts#L47-L90)）。它不检查 profile 自己的 `cordis.patch.yml` 是否已经手工插入同一个 Bundle 的行。Bundle patch 与 profile patch 最终会被扁平组合（[profile-boot.ts#L135-L172](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/apps/cli/src/profile-boot.ts#L135-L172)）；Loader 对同一层重复 entry id 会直接抛错（[group.ts#L56-L70](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/vendor/loader/src/config/group.ts#L56-L70)）。因此“手工 patch 插件 + 再用 `dsh plugin add` 安装同包”存在重复挂载的静态风险；本文没有把它标成已复现 bug，实际处理应由上游修复 reconcile 去重/冲突诊断，或在 Hermit 规范中禁止双重接入路径。

### 9. Web Client 半侧（可选，不是普通插件最低要求）

- Web Client 包才声明 `dsh.client`（`platform: 'web'`，可选 `inject`/`immediately`）并导出 `exports["./client"]`；模块系统扫描已启用 Loader entries 后提供该 bundle（[Client 模块子系统#L75-L80](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/subsystems/client-modules.zh.md#L75-L80)）。
- 官方设置卡片示例把 Host 与浏览器半侧放在同一包中，但这是因为该示例需要同时贡献两端；它明确说明 `dsh.client`/`./client` 是浏览器半侧打包条件（[设置卡片#L5-L8](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/cookbook/adding-a-settings-card.zh.md#L5-L8)）。
- `dsh.client.inject` 是客户端模块图的包名边，表达 factory 到达/物化依赖；它不能替代 Cordis 的服务 `inject`。客户端 bundle 必须是 loader 所需的 lazy-CJS factory；官方 cookbook 给出 `exports["./client"]` 与 `dsh.client` 示例，并说明仓库外包需要自行复刻输出格式（[设置卡片#L80-L100](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/cookbook/adding-a-settings-card.zh.md#L80-L100)）。

## 对 Hermit 当前规范的审计

### 事实定位

- 当前权威文件为 [`docs/development/dsh-plugin-development-and-packaging.md`](../development/dsh-plugin-development-and-packaging.md)（authority `dsh-plugin-development-and-packaging`）和 [`plugins/development-guidelines.md`](../../plugins/development-guidelines.md)。
- 下表只判断“是否属于 DeepSeek Harness 官方基线”；标记为“项目政策”的内容不代表错误，但不应伪装成官方规范。

| Hermit 当前条款 | 官方对应关系 | 判断与风险 |
|---|---|---|
| 插件规范把 `@hermit/dsh-plugin-reference` / DSH 接入面固定为 `0.1.1-rc.2`（`plugins/development-guidelines.md` 第 59-69 行） | 本次官方仓库快照根版本已是 `0.1.2-alpha.3`，且 README 仍声明 preview/breaking changes | `[VERIFIED]` **版本事实已漂移。** 若 Hermit 有意继续以 rc.2 做资格基线，应把它标成“项目批准的旧基线”并注明与上游快照不同；若目标是当前上游，则需重新跑 public contract、Client/React 和打包资格，不能直接沿用 rc.2 结论。 |
| 每个可安装插件同时提供 Host root、`./client`、Bundle metadata 和 `cordis.patch.yml`（开发/打包标准 § Package 合约；插件规范第 57-73 行） | 官方只要求普通插件能被 Cordis 行挂载；Bundle 和 Web Client 是可选角色 | `[INFERENCE]` **过度收紧且耦合。** 简单 Host/Tool 插件被迫携带浏览器产物和 Bundle 层；应按 `plugin`、`bundle`、`client plugin` 三类 manifest/门禁拆分。 |
| `dsh.client.inject` 负责 Client 加载顺序 | 官方 Client 图将其定义为 package/factory 到达依赖；Cordis 激活仍由服务 `inject` 决定 | `[VERIFIED]` 语义被当前标准简化。应明确区分两种 `inject`，避免把客户端资源图当成 Host 生命周期顺序。 |
| Client lazy-CJS、React/ReactDOM externalize、UI runtime peer | 官方 Web Client 系统确实要求 `./client` 与 lazy-CJS；React singleton、具体 external 列表和 peer pin 是宿主实现约束 | `[PROJECT POLICY]` 只适用于声明 `dsh.client` 的 Web 插件，不能成为所有插件最低要求。 |
| 一个 `.tgz` 在 stock DSH/Hermit 双宿主安装，L1-L4 资格、runtime manifest、bundled Node、`pnpm deploy --prod` | 未出现在官方插件教程或 Bundle 发布 Contract 中 | `[PROJECT POLICY]` 属于 Hermit 桌面发布/资格门禁；把它放入通用 DSH 标准会扩大耦合和构建成本。 |
| DSH peer 精确 pin、React 18.x、`files`/license/security 审计、Package Gate | 官方示例展示 `files` 和 package metadata，但没有规定 Hermit 的精确版本线、双端闭包或安全门禁 | `[PROJECT POLICY]` 可以保留在发布资格文档，但不要宣称“官方要求”。 |
| 禁止 Electron/preload、另一个插件内部 import、DSH `src/*` | 官方服务/事件组合模型支持通过公共 context 解耦；Electron 与 Package Gate 是 Hermit 安全边界 | `[PROJECT POLICY]` 是合理的 Hermit 安全加严，不是 DSH 普通插件 API Contract。 |
| 只生成一次 tarball、目标 profile 不依赖 `prepare` | 官方明确 Git 源码安装会依赖 `prepare`，并说明 pnpm `allowBuilds` 授权；npm/tarball 才是预构建路径 | `[VERIFIED]` 当前条款是 Hermit 发布偏好，不是官方唯一方式；若要支持 Git 安装，必须记录 `prepare`/`allowBuilds` 风险。 |

### 高耦合的具体表现（基于当前仓库静态审计）

1. 三个 sibling 插件仓库的 `package.json` 都把 `dsh.bundle`、`dsh.client`、Host/Client 导出和同一套运行时 peer 放在一个私有 package 中。这使“业务插件是否挂载”“是否贡献 profile 层”“是否有 Web UI”成为一个开关，任一端构建或依赖变化都牵动整个制品。
2. 三个插件各自维护 Host + Client tsdown 配置和 `CLIENT_EXTERNALS` 列表。这不是 DSH 官方要求；官方只定义 Client loader 的输出 Contract，仓库外包需要自行复刻格式。重复配置容易造成版本、external 列表和浏览器图不一致。
3. 每个 `cordis.patch.yml` 只插入自身 Host package，但 Bundle 层和 Host 行仍被同一 package 绑定；若未来要把业务 Host、Web Client 或 profile layer 分开发布，当前 manifest/脚本会同时改动多个边界。

这些是结构性风险判断，不等同于已经证明的运行时 bug。实际打包失败仍应通过失败制品、解析树和启动日志定位；研究结论只说明当前规范把可选能力强制耦合，增加了失败半径。

## 建议的规范拆分（供后续决策）

### 方案 A：保留一个 Product Plugin 包，但拆开 Contract（推荐短期）

- 保留一个业务 package 作为 Hermit Product Plugin 交付单元；在文档中明确它是 Hermit Product Plugin profile，而非 DSH 通用插件。
- 将要求拆为三个可独立判定的段落：
  - DSH Host baseline：`name`/`apply`/可选 `inject`/`Config`/Tool/effect；
  - Profile Bundle：仅当 package 需要通过 `dsh plugin` 贡献 patch 层时才加 `dsh.bundle.patch` 与 `cordis.patch.yml`；
  - Web Client：仅当存在浏览器半侧时才加 `dsh.client`、`./client` 和 lazy-CJS 构建。
- 继续保留 Hermit 的安全、双宿主、Package Gate 为 Product Plugin 资格，不称作官方规范。

优点：改动范围小，适合当前三个第一方插件；缺点：一个包仍有两端构建，只是文档边界清楚。

### 方案 B：Host、Client、Bundle 三包独立发布

- Host 作为普通 Cordis 插件/服务包；Client 作为声明 `dsh.client` 的 Web 包；Bundle 作为只含 patch 的 profile 包，显式依赖 Host/Client。
- 每个包分别执行对应的 build、pack 和测试门禁。

优点：变化原因和失败半径最小，最符合官方“角色可替换、Bundle/Profile 分层”模型；缺点：包数量、版本协调和发布流程增加，当前 Hermit 需要先稳定公共 Client/Host contract。

### 方案 C：保持当前单包但只做脚本去重

- 抽共享 tsdown preset、manifest 校验和 pack 检查脚本，暂不拆 Contract。

优点：最快缓解重复配置；缺点：无法解决“每个插件强制同时成为 Bundle + Client”的根本耦合，后续仍会把桌面资格问题带入普通插件。

## 限制与待核实项

- 本文固定的是 `dd6322d...` 快照；DSH 处于 developer preview，后续 commit 可能改变字段或 CLI 行为，升级必须重新核对。
- 本文未把社区仓库、社区 RFC 或 GitHub Discussion 当作官方 Contract 依据；只引用 DeepSeek 官方仓库 README、文档、源码和包 manifest。
- 当前 Hermit 的具体打包失败（例如产物缺文件、依赖解析失败、启动重复注册）需要另行运行对应脚本并保留日志；本文没有把静态耦合风险当成已复现 bug。

## 来源索引

1. [DeepSeek Harness README（developer preview）](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/README.md)
2. [Cordis Tutorial 01：第一个插件](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/cordis-tutorial/01-first-plugin.zh.md)
3. [Cordis Tutorial 02：生命周期与 effect](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/cordis-tutorial/02-lifecycle-and-effects.zh.md)
4. [Cordis Tutorial 03：服务与 `inject`](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/cordis-tutorial/03-services.zh.md)
5. [Basic Develop：配置](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/user/develop/basic/config.zh.md)
6. [Basic Develop：工具](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/user/develop/basic/tool.zh.md)
7. [Cordis Tutorial 07：进入 harness](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/cordis-tutorial/07-into-the-harness.zh.md)
8. [Cookbook：工具编写参考](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/cookbook/adding-a-tool.zh.md)
9. [Basic Develop：打包与安装插件](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/user/develop/basic/publish.zh.md)
10. [`dsh` CLI behavior reference](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/apps/cli/reference/README.md)
11. [Client 模块子系统](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/subsystems/client-modules.zh.md)
12. [Cookbook：新增设置卡片（Host/Client 打包示例）](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/docs/cookbook/adding-a-settings-card.zh.md)
13. [官方 `dsh-base` Bundle manifest](https://github.com/deepseek-ai/deepseek-harness/blob/dd6322d604e00eec1ba5e0c8541159906a21094a/packages/bundle/base/package.json)
