# Hermit DSH 集成与打包标准

状态：`current`

本文只规定 Hermit 如何把第一方 Product Plugin 接入 DSH/桌面、构建成制品并进行资格验收。
DSH/Cordis 的插件 API、生命周期、Bundle/Profile、CLI 和 Client Modules 规则不在本文重新
定义，统一以[当前 DSH 官方上游资料快照](../../DEEPSEEK-HARNESS-UPSTREAM.md)为准。

插件平时如何写，见[Product Plugin 开发规范](../../plugins/development-guidelines.md)；需要
Electron、系统剪贴板、全局快捷键或原生窗口时，先看[Desktop Core 开发规范](desktop-core-development.md)。

## 适用范围

本文适用于 `plugins/*` 下的第一方插件，以及 Hermit 随包携带的 DSH Web runtime。插件的产品
行为以自己的 `DESIGN.md` 和核心需求为准；系统、安全和运行时 Agent 边界以对应契约为准。

Hermit 只在这里增加自己的规则：

- 插件制品如何进入 Hermit bundled runtime；
- Electron 主进程何时需要静态 host package；
- Package Gate 如何记录版本、lock、制品摘要和平台；
- stock DSH 与 Hermit bundled DSH 如何验证同一份制品；
- 桌面包、native addon 和 Profile 激活的重启边界。

## 版本批次

每次 Hermit 采用的 DSH runtime 必须和根目录
[DSH 官方上游资料登记](../../DEEPSEEK-HARNESS-UPSTREAM.md)中的 `active` snapshot 属于同一
个版本批次。版本批次至少包含：

- DSH 官方 Git commit 和 tag；
- 实际 DSH package 版本；
- Hermit lockfile 解析结果；
- Product Surface source patch 的上游 commit（如有）；
- runtime generation 和插件制品摘要。

不能只改 package 版本号而跳过资格验证，也不能让文档快照、runtime 和打包制品各自跟不同的
上游版本前进。新 DSH 先作为 candidate 快照，差异和资格通过后再同时切换。

## 插件角色与接入

一个插件可能只提供 Host、只提供 Web Client，也可能同时提供 Bundle；这些是不同角色，不要求
所有插件都复制同一套入口。插件只有在实际声明对应角色时，才需要该角色的 manifest、构建和
验收证据。

Electron 主进程也不属于普通插件的公共依赖。只有确实拥有快捷键、Tray、IPC、native addon
或系统权限的插件，才允许有 Desktop Integration；纯 Web 插件不因为随桌面发布而获得这些
能力。

## 一次构建、一个制品

候选插件从当前源码只构建一次，并保留同一个 `.tgz`：

```sh
corepack pnpm --filter @hermit/<plugin> test
artifact_dir=$(mktemp -d /tmp/hermit-plugin-artifact-XXXXXX)
corepack pnpm --filter @hermit/<plugin> pack --pack-destination "$artifact_dir"
tar -tzf "$artifact_dir"/*.tgz
shasum -a 256 "$artifact_dir"/*.tgz
```

制品必须预先构建，目标 Profile 不得依赖 `prepare` 或目标机器重新编译。stock DSH 和 Hermit
bundled DSH 安装、运行和验收同一份 `.tgz`，不能为两个宿主维护两套实现。

## Hermit runtime 闭包

`apps/desktop-vnext/runtime-bundle-manifest.json` 是 Hermit runtime 输入清单，负责声明：

- Product Surface patch package；
- 随包第一方插件的源码位置和构建产物路径；
- runtime 闭包需要携带的 package。

`prepare:dsh-runtime` 应完成以下工作：

1. 用 bundled Node 构建清单中的 package；
2. 对每个随包 package 执行一次 `pnpm pack`，把 tarball 内容物化进 runtime 闭包；
3. 计算 lock、workspace、runtime 清单和构建产物的 SHA-256；
4. 生成可搬运的物理 `node_modules` 闭包；
5. 安装并校验 Hermit layout Product Surface source patch，以及固定 DSH Workspace 的前台
   会话导航 source patch；
6. 校验 DSH CLI、pnpm、链接、依赖和闭包路径；
7. 写入 runtime generation manifest，并记录 DSH 版本批次、两个 source patch 的摘要、
   `packed-tarball-v1` 模式、发布文件内容摘要和实际 `.tgz` 摘要。

Electron 只把自己的壳放入 ASAR。DSH 闭包、bundled Node、pnpm 和 source patch 放在
`resources/runtime/`。只有 Electron 主进程静态 import 的 host package 才能额外进入
`app.asar/node_modules`；这份复制必须来自同一个已构建制品，不能重新从 workspace 取一份。

## Profile 激活边界

桌面主进程只负责把已冻结的 Hermit 制品通过官方 DSH CLI materialize 到 Hermit 自己的 Profile，
不负责重新实现 Bundle/Profile 规则，也不让每个插件自己管理 Profile。

- Profile 是 DSH 的运行时组合，不是插件业务状态；
- 停用、卸载和删除数据是三个不同动作；
- DSH Client 当前停用按明确的重启边界验收，不能把尚未验证的热卸载写成当前能力；
- 用户自行安装的 stock DSH Profile 不属于 Hermit 默认管理范围；
- 制品缺失、版本不一致或 capability 不可用时，插件必须确定性 `unavailable`，不能加载残缺入口。

## 资格验收层级

按插件实际角色执行到最高适用层级：

### L1：Package / Host / Client

- frozen lock、clean build、类型检查和插件业务测试通过；
- 制品内容符合 `files`，没有源码、secret、悬空链接或第二份 React；
- Host 路由、Tool、slot、timer、watcher 和 effect 在 fiber dispose 后可回收；
- 真实负向路径覆盖权限拒绝、旧 revision、取消、重复和恶意输入。

### L2：双宿主

在临时 Profile 中使用同一 `.tgz` 安装并重启 DSH：

- stock DSH：插件依赖能安装；缺少 Hermit 专属 capability 时明确 `unavailable`；
- Hermit bundled DSH：公开 Product Surface、slot 或 route 正常出现；
- `dump-config`、停用、移除和重启后的依赖状态符合官方 CLI 语义；
- 不读取用户真实 Profile、文件、会话、剪贴板或凭据。

### L3：Product Surface 业务闭环

在真实 DSH Web 和受限 BrowserWindow 中验证插件的主要用户流程：打开、主要业务动作、持久化
回读、关闭和页面错误。业务状态按插件自己的 `DESIGN.md` 逐项覆盖，不用一个 smoke 测试伪装
覆盖所有状态。

### L4：Electron / 原生资格

只有声明 Electron 主进程、IPC、系统快捷键、Tray、native addon 或系统权限的插件才执行这
一级。纯 Web 插件不继承 Smart Clipboard 的 native gate，但仍必须通过 bundled runtime 和
L3 验收。

## 发布前检查

建议执行：

```sh
corepack pnpm --filter @hermit/<plugin> test
corepack pnpm --filter @hermit/desktop typecheck
corepack pnpm --filter @hermit/desktop build
corepack pnpm --filter @hermit/desktop prepare:runtime
corepack pnpm --filter @hermit/desktop verify:packaged-runtime
```

需要桌面或 native 能力时，再运行对应的 Product Surface、packaged UI 和目标平台资格测试。
插件检查通过后，桌面版本统一进入 [macOS 发布流程](macos-release.md)。签名、公证和 staple
是否执行由该次发布明确选择并记录，不在插件规范里重复设置发布门槛。

## 证据和失败处理

- 每个候选记录 DSH 版本批次、插件版本、发布内容摘要、`.tgz` SHA-256、解析版本、runtime generation、
  平台架构和 Package Gate 结果；
- 构建、类型或业务测试失败，从 L1 修复后重跑；
- stock unavailable、Hermit available 如果确实是 capability 差异，记录为宿主差异，不复制
  第二套 UI；
- profile 未登记、入口残留、版本/哈希不一致或 packaged 出现模块缺失时，禁止进入下一级；
- 证据写入 `.hermit/artifacts/`，不提交本地 cache、Profile、真实数据或凭据。

Smart Clipboard 的 native/DMG 专属步骤仍由
[Smart Clipboard 打包 runbook](smart-clipboard-packaging-runbook.md)负责；它不能反向成为
普通插件的通用前置条件。
