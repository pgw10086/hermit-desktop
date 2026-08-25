# M1 DSH 底座资格认证

状态：`BLOCKED_Q_CMOD_01`

更新时间：2026-08-25

M1 的目标是使用 DSH 官方 npm 发布物，完成没有本地 TCP listener 的 Core-only
桌面闭环。当前目标版本 `0.1.1-rc.2` 在 Client module Host 组装契约上不满足条件，
因此只实施可重复的资格认证和阻塞证据，不创建 Tauri 产品代码。

## 大白话结论

DSH 已经公开了替换浏览器 HTTP 传输的 Client 接口，但没有公开“脱离 WebServer 后
如何在 Host 端生成 Client 启动图和 bundle 路径”的完整契约。现有实现把这部分绑定
在激活后立即监听端口的 `WebServer` 上，官方又明确说明该服务不是 capability seam。

Hermit 不复制 DSH 私有扫描算法，也不提供一个名字相同但未被官方承诺的假
`webServer`。在上游发布 transport-neutral Client module Host 契约前，M1 停在 Q0。

## 术语

**资格认证目标（Qualification Target）**：
准备接受验证的一组精确版本和发布物；通过全部 gate 前不能称为底座。
_避免使用_：正式底座、已支持版本。

**已认证组合（Qualified Tuple）**：
通过全部 M1 gate 的 Node、pnpm、DSH、完整 lockfile、React/ReactDOM、Rust、Tauri
和目标操作系统组合。
_避免使用_：单独的 DSH 版本号。

**公开契约（Public Contract）**：
npm 发布物实际包含的公开 export，并且官方文档赋予了可供外部组合的语义。仅存在于
`src/*`、测试、源码注释或结构类型中的实现不属于公开契约。
_避免使用_：能 import 的文件、源码里存在的接口。

资格认证脚本可以只读检查发布 tarball 内的 manifest、类型声明和构建后 JS，以证明
发布物边界和阻塞事实；这种证据读取不会把内部文件升级为产品 runtime API，也不得被
产品代码引用。

**载体（Carrier）**：
DSH Client 与 Host 之间承载请求、流、取消和 bundle 的物理通道，不负责判断产品
插件是否有权限。
_避免使用_：插件沙箱、Capability Broker。

**资格认证 Fixture（Qualification Fixture）**：
第一方、无特权、只用于验证公开 UI 和生命周期接缝的测试插件。它运行在 DSH Host
进程内，不证明第三方插件安全。
_避免使用_：安全插件、社区插件。

**Core-only**：
官方 DSH Conversation、Settings 和 AI Session 完整可用，Hermit Core 只提供身份、
就绪和生命周期，不安装任何业务插件。
_避免使用_：空壳、演示 UI。

**STOP**：
某个硬 gate 失败后停止后续目录和实现，不加入 fallback 把失败伪装成通过。
_避免使用_：暂时绕过、先跑起来。

## M1 范围

M1 包含：

- 精确 DSH npm 发布物、integrity、公开 export 和 lockfile 验证；
- transport-neutral Client module Host 契约验证；
- 通过后才实现 Tauri WebView、Rust 与 Node 的零 TCP carrier；
- 精确打包的第一方 `@hermit/core`；
- Windows WebView2 实机验收和三平台原生编译；
- React 单实例、Cordis lifecycle、无 listener、取消、背压、崩溃和退出测试；
- 使用无网络 replay 的确定性 AI Session/UI 测试。

M1 不包含：

- Organizer、File Workspace、Smart Clipboard；
- 第三方插件执行；
- Package Gate、Capability Broker、隔离 Runner 的产品实现；
- Tray、全局快捷键、通知、更新器、安装器和插件市场；
- localhost、随机端口或反向代理 fallback；
- DSH fork、源码 patch、私有 deep import 或工作区链接。

## 资格认证目标

| 项目 | M1 规则 |
| --- | --- |
| DSH | `0.1.1-rc.2` npm 发布物和完整 integrity |
| Node | Hermit 固定 `24.19.0`；DSH 声明范围为 `^22.19.0 || >=24.0.0` |
| pnpm | `11.7.0` |
| React | 声明范围从 `^18.2.0` 起，精确版本由 Hermit qualification lock 决定 |
| Rust | 进入 Tauri gate 后固定 `1.98.0` |
| Tauri | 进入 Tauri gate 后选择并由 `Cargo.lock` 固定 |

DSH 上游当前 lockfile 解析到 React/ReactDOM `18.3.1`，这只是观察证据，不替代
Hermit 自己的 lock 和 runtime identity test。

第一次未声明 Host singleton 的 clean consumer install 解析为 React `18.3.1` 和
ReactDOM `19.2.8`，`pnpm peers check` 明确失败。Hermit 因此把两者共同固定为
`18.3.1` 作为当前资格认证候选；只有重新生成的 lock、peer check 和后续 runtime
identity test 全部通过，才算 React gate 通过。这是 Host 对 singleton 的显式所有权，
不是用 alias 隐藏重复版本。

当前 qualification lock 的 SHA-256 为
`1d69a486fdd19457cdbbdaad62bacb8b431fdc0981f21f9765a1de5542800a45`，包含 189 个
带 integrity 的 `@deepseek-ai/dsh-*` `0.1.1-rc.2` package，React 和 ReactDOM 均只
解析为 `18.3.1`，`pnpm peers check` 已通过。Q0 使用 `--ignore-scripts` 检查发布物和
公开契约；这不等于 native/runtime lifecycle 已认证，相关 build script 只有在
`Q-CMOD-01` 解锁后才建立精确 allowlist 并执行。

## 设计树结论

### Client 与 Host

- `ClientTransportHooks`、`AbstractApiClient`、`createApiProxy()` 和
  `toFetchHandler()` 是发布物中的公开 transport seam；
- `ClientModuleRegistry` 虽公开 `graph()`、`clientPath()` 和 `bootInjections()`，但
  图的扫描、校验、revision 和路径解析仍绑定具体 `webServer`；
- `dsh-host-webserver` 激活即监听，并由官方说明为 Web carrier 而非 capability seam；
- 官方测试中的结构化 `webServer` mock 只能证明单元可测性，不能升级为生产 provider
  契约。

结论：`0.1.1-rc.2` 缺少 transport-neutral Client module Host contract，
`Q-CMOD-01` 失败。

### 解锁后的物理 Carrier

解锁后只采用 [零 TCP 桌面载体 ADR](../../docs/adr/0001-zero-tcp-desktop-carrier.md)
定义的链路：WebView 与 Rust 使用 Tauri invoke/event，Rust 与 Node 使用带长度前缀的
stdio，bundle 使用 Tauri custom protocol。产品路径不使用 Blob、`eval`、named pipe
或 localhost。

### 自动 AI 测试

自动测试使用 keyless replay 或进程内第一方测试 adapter，不启动本地 mock HTTP
server。真实 DeepSeek 凭据只由用户在产品 UI 中配置并做人工 smoke，不进入仓库、CI
或 Agent 上下文，也不作为确定性自动 gate。

### 平台门

M1 要求 Windows WebView2 实机闭环，以及 Windows、macOS、Linux 原生 runner 编译。
三平台实机运行属于后续发布门，不在 M1 中假装完成。

## Gate 与 STOP 矩阵

| Gate | 必须证明 | 当前状态 |
| --- | --- | --- |
| `Q-ART-01` | DSH 发布物版本和 integrity 精确固定 | **通过** |
| `Q-ART-02` | 资格认证代码只执行批准的公开 export | **通过**；产品 runtime 未创建 |
| `Q-BOOT-01` | 发布版 `app-boot.boot()` 公开入口存在 | **通过**；完整 boot 被阻塞 |
| `Q-API-01` | ApiProxy/fetch 和 Client transport 公开入口存在 | **通过**；物理 carrier 被阻塞 |
| `Q-CMOD-01` | 不激活 WebServer 即由官方公开 API 生成 graph 和 bundle lookup | **失败** |
| `Q-INJ-01` | 只消费公开的五类 `IndexInjection` | 被 `Q-CMOD-01` 阻塞 |
| `Q-BUNDLE-01` | bundle id/rev/bytes 一致且错误 revision fail loud | 被阻塞 |
| `Q-REACT-01` | lock 和 runtime 中 React/ReactDOM 单实例 | lock 通过；runtime 被阻塞 |
| `Q-RPC-01` | unary、stream、respond、cancel 全链路通过 | 被阻塞 |
| `Q-BP-01` | 背压有上限，慢消费者不会造成无界缓存 | 被阻塞 |
| `Q-CRASH-01` | Node crash 后 pending operation 明确失败 | 被阻塞 |
| `Q-EXIT-01` | 退出不残留 Node 进程 | 被阻塞 |
| `Q-TCP-01` | Hermit/Tauri/Node 没有本地 TCP listener 或隐式 fallback | 被阻塞 |
| `Q-LLM-01` | keyless replay 完成真实 Session/UI 流程 | 被阻塞 |
| `Q-WIN-01` | Windows WebView2 冷启动到 Client fibers ACTIVE | 被阻塞 |
| `Q-CI-*` | 三平台原生 runner 编译 | 被阻塞 |

任何 gate 失败都停止后续 owner 的创建。不得把失败项降为 warning、optional check 或
已知问题后继续进入业务插件。

## 当前允许实施的文件

当前只创建真实资格认证设施：

```text
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
.node-version
.npmrc
scripts/qualification/
|-- inspect-client-module-host.mjs
|-- qualification-status.mjs
|-- verify-public-contracts.mjs
|-- verify-client-module-host.mjs
|-- verify-clean-install.mjs
|-- tsconfig.json
|-- fixtures/
|   |-- css.d.ts
|   `-- public-contracts.ts
`-- qualification.test.mjs
```

`apps/desktop-vnext/`、`packages/core/`、Rust workspace 和 native crate 在
`Q-CMOD-01` 解锁前保持不存在。

## M1 完成条件

M1 只有在全部 gate 通过、Windows 实机验收通过、三平台原生 CI 通过后才能从
`BLOCKED` 改为 `PASS`。本地通过但尚未获得 push/ruleset 授权时只能标记为
`LOCAL_PASS_REMOTE_PENDING`，不能声称仓库闭环。

## 进入 M2 的门

官方 DSH npm 发布物必须先提供文档化的 transport-neutral Client module Host
contract：不激活 `dsh-host-webserver`，仍由官方实现完成 Loader 扫描、`dsh.client`
校验、bundle revision、graph composition 和 bundle lookup。

新版本到来后从 Q0 重新资格认证。M1 全绿前不开发 M2；M1 fixture 的成功也不代表
允许执行第三方插件。

M2 当前状态固定为 `DEFERRED_BY_M1_Q0`。不提前设计 M2 接口、依赖或实现，也不为了
未来插件平台改变 M1 gate。

## 上游解锁计划

截至 2026-08-26，DSH 官方 `master` 与 `dsh-v0.1.1-rc.2` commit
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` 相同，npm `latest` 和 `next` 也都指向
`0.1.1-rc.2`。没有公开的未发布修复、承诺版本或 ETA。官方当前不接受外部 pull
request，bug 和 idea 应先通过 Discussions 沟通。

推荐向上游提交一个不包含 Hermit、Tauri 或特定桌面实现的通用设计提案：

1. `@deepseek-ai/dsh-client-modules` 变为 transport-neutral Host，只依赖 Loader，
   负责 `dsh.client` 扫描、校验、bundle path、revision、neutral snapshot 和变更通知；
2. Web route、`/plugins` URL 和 index injection 移入独立 Web adapter；
3. neutral snapshot 不含 HTTP URL，由 carrier projection 把 `{id, rev}` 映射为 Web、
   Worker、Electron 或其他物理地址；
4. Web adapter 保持现有 WebBootGraph、route、cache 和 index 行为兼容；
5. 新增没有 `webServer` service 的 assembled boot，并 trap `net.Server.listen`，证明
   zero-port 不是偶然未访问端口；
6. npm pack consumer test 只通过公开 export 使用 snapshot 和 bundle lookup，不能
   依赖 workspace、`src/*` 或复制内部扫描算法；
7. 同步中英文 client-modules、web-server、GUI layering 和 Cordis catalog。

官方 merge 只允许做非产品预检。只有包含该 commit 的官方 npm release 出现，并在
Hermit 中重新生成 closure、integrity、lock、React 解析且新 Q0 全部通过，M1 才恢复。
当前的 189 个 package 和 React `18.3.1` 是 rc.2 证据，不是未来版本的固定答案。

向官方 Discussions 发帖或评论、clone/fork 外部仓库、创建 branch/commit、提供参考
patch、开 PR 或 push 都是外部动作，需要用户分别明确授权。Hermit 本仓在获得新官方
release 前只维护 release gate，不编写 workaround。
