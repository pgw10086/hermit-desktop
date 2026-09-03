# Smart Clipboard 开源实现与 File Workspace 可迁移性调研

日期：2026-08-28

状态：调研结论，不是产品规范或当前实现。Smart Clipboard 的产品事实仍以
`plugin-smart-clipboard` sibling 仓库中的 `DESIGN.md` 为唯一权威来源；
开发前 Gate 以
[`2026-08-28-smart-clipboard-pre-development.md`](2026-08-28-smart-clipboard-pre-development.md)
为准。本文件没有修改任何插件 `DESIGN.md`。

## 结论

指定的 File Workspace 设计会话有参考价值，但它提供的是**拆边界的方法**，不是可直接迁移
的剪贴板功能方案。最值得复用的五条是：

1. 业务记录使用稳定 ID，不能把内容哈希、路径、列表位置或当前宿主上下文当成身份；
2. Canonical 内容、搜索文本、列表摘要、缩略图和其他缓存分开，派生数据可重建；
3. Product Plugin 拥有业务记录，宿主工作面和当前 DSH Session 不取得数据所有权；
4. 剪贴板、全局快捷键和自动粘贴等特权动作只经过 Core 公共能力，插件 UI 不直连 Electron
   或平台 API；
5. 持久化由 Core 注入的 storage repository 负责，插件只执行领域规则，不把 SQLite、路径或
   文件句柄权限带进 Product Plugin；
6. 先用固定制品和可丢弃 spike 证明公开扩展面、平台行为和生命周期，再进入正式业务数据库。

不应迁移的是 File Workspace 的 `managed/external`、文件 revision、SecretLocator、文件树、
同名替换、文件导入和 external 移除规则。剪贴板记录是一次捕获到的不可变快照，不是需要
持续编辑和保存冲突的文件。Better Sidebar 也是 File Workspace 的特定 UI 依赖，不能因此
变成 Smart Clipboard History 的入口或数据负责人。

开源项目给出的共同答案也很一致：

- **行为基线看 Maccy**：快捷唤起、输入搜索、写回后尝试粘贴、明确 marker 跳过；
- **macOS 首切片使用第一方微型 adapter 资格**：只暴露 `changeCount`、稳定 TEXT snapshot 和
  TEXT write；CrossCopy 只保留为源码调研样本，不进入产品依赖或资格路径；
- **跨平台捕获和数据链看 EcoPaste**：平台监听、内容规范化、SQLite/FTS、图片资源、写回
  回环抑制和非激活窗口；
- **宿主与能力边界看 GPaste 和 PowerToys**：后台能力/业务进程与 Shell/Runner UI 生命周期
  分开，用窄契约连接；
- **Windows 资格看 Ditto，跨平台故障隔离看 CopyQ**，但二者为 GPL，默认只作为行为与测试
  参考；
- **不要照搬 Clipboard Indicator 的单体 Shell 扩展形态**：其官方 README 已承认大图片会让
  Shell 短暂卡顿，说明重捕获、哈希和存储不应塞进 DSH Client UI 线程。

因此推荐架构不是再选一个项目整体移植，而是保留当前 Hermit 分工：

```text
Smart Clipboard Product Plugin
|-- domain：ClipboardEntry、去重、保留、Trash、搜索、导出
|-- repository contract：由 Core 注入本地持久化实现
|-- client：DSH History + 快捷取回 UI
`-- 只消费窄公共能力
     |
     v
Hermit Core capability
|-- ClipboardBridge.observe / snapshot / write / sourceIdentity / autoPaste
|-- Shortcut Registry
|-- Core-owned SQLite/storage adapter
|-- Product Surface / overlay
`-- ActivationLease（统一注册、世代失效、逆序回收）
     |
     v
macOS / Windows / X11 / Wayland adapter
```

这轮调研没有发现能绕过当前 DSH Product Surface Gate 的开源插件，也没有发现一个成熟项目
同时满足“标准 DSH Product Plugin、跨平台 Canonical 历史、鼠标附近快捷取回、完整 History、
Hermit Core 特权边界”。现有开源代码只能分层参考，不能替代 Hermit 自己的插件契约。

## 现有 DSH 剪贴板插件是否可用

GitHub `dsh-plugin` topic 中已经出现剪贴板相关项目，但“名字相同”不代表它们解决的是同一
产品问题。逐项审计后的结论是：**当前没有一个可以作为 Smart Clipboard 的直接依赖或 fork
起点**。它们可以证明 DSH Host/Client 能做小型 PoC，也暴露了 Hermit 必须避免的边界问题。

| 项目 | 实际解决的问题 | 对 Hermit 的价值 | 不能采用的原因 |
| --- | --- | --- | --- |
| [`dsh-clipboard`](https://github.com/ZhijiangTang/dsh-clipboard) | Agent 调用一个 Tool，把 TEXT 写到 `pbcopy`、`clip`、`xclip` 或 `xsel` | shell 工具可用性和结构化失败结果的 PoC | 没有捕获、历史或 UI；插件挂载时还会主动写 probe，覆盖用户当前剪贴板，不符合非侵入生命周期 |
| [`qqyumidi/dsh-clipboard-history`](https://github.com/qqyumidi/dsh-clipboard-history) | TEXT-only 轮询、JSON 历史、Conversation 头部按钮和 overlay 侧面板、模型 Tool | 证明公开 `conversation.session.header.utilities`、`shell.overlay`、timer/subprocess/fs 可以拼出小面板 | 不是全局持久 Product Surface；没有快捷浮层、自动粘贴或三类 Canonical；完整历史可被模型搜索/读取；整份 JSON 和 shell polling 不适合作为正式数据链 |
| [`kuangre123/dsh-clipboard-history`](https://github.com/kuangre123/dsh-clipboard-history) | 无 UI 的 TEXT 历史和 Agent Tools | `ctx.effect` 回收轮询 timer 的写法可作为生命周期示例 | 业务面完全是模型 Tool，违背“用户明确选择单条后才交给 DSH”；没有 Product Plugin UI 和平台能力边界 |
| [`dsh-copy-fix`](https://github.com/lhh666-6/dsh-copy-fix) | 修复 DSH Desktop 内置复制按钮的 write-only bridge | loopback 请求限长、origin/localhost 检查和 disposer 可作为局部实现参考 | 直接 `import('electron')`，并全局 patch `navigator.clipboard`；没有读取、监听或历史，也绕过 Hermit Core capability owner |

其中 `qqyumidi/dsh-clipboard-history` 使用的 `conversation.session.header.utilities + shell.overlay`
只能提供“当前 DSH 会话里打开一个临时侧面板”，不能提供用户已确认的 DSH 全局导航完整
History，更不能从任意原应用通过系统快捷键呼出鼠标附近浮层。因此它没有解除 G2，只是用
现有 slot 做了另一个产品。

这几项最多允许两类选择性借鉴：

1. `ctx.effect`/DSH timer 的 disposer 和 Host/Client 小契约写法；
2. 失败结果、请求限长、loopback origin 检查等局部测试场景。

不直接复制其 shell 命令、JSON schema、HTTP API、全局浏览器 patch、Agent Tool 能力或 UI。
任何代码级候选仍需按精确 commit 进入 Package Gate，而不是因为 MIT 就默认可进入产品。

## 新发现：CrossCopy 不进入资格路径

网页 GPT 首轮独立评审提出
[`@crosscopy/clipboard@0.3.6`](https://www.npmjs.com/package/@crosscopy/clipboard)
作为 Core 底层候选；第二轮反向审查结合一手源码推翻了该建议。最终结论是：**CrossCopy
只保留为调研样本，不作为依赖，也不值得占用 packaged qualification**。

它确实是 Node N-API binding，`package.json` 声明 MIT，并存在 macOS arm64 的 `0.3.6`
预编译包；但仓库没有随源码提供 LICENSE 文本，正式复用许可证据并不完整。更关键的是，
它固定依赖 `clipboard-rs = 0.3.2`，而该版本的 macOS watcher 并非事件队列：后台线程每
500ms 比较一次 `NSPasteboard.changeCount`，数字有变化时只调用一次 handler。500ms 内的
多个中间内容已被系统剪贴板覆盖，无法恢复。
[`package.json`](https://github.com/CrossCopy/clipboard/blob/v0.3.6/package.json)
[`Cargo.toml`](https://github.com/CrossCopy/clipboard/blob/v0.3.6/Cargo.toml)
[`clipboard-rs macOS watcher`](https://github.com/ChurchTao/clipboard-rs/blob/da51c143f451643f06aa66fa453ab7a70e4fd1b5/src/platform/macos.rs#L54-L82)

CrossCopy 又把 handler 转成无参数 `() => void`，以 non-blocking ThreadsafeFunction 排入 JS；
调用者收到通知后才另行 `getText()`。它没有交出变化发生时的 `changeCount` 或 snapshot，
因此存在“通知对应 B，稍后读到 C”的竞态；也没有 source identity、自身写回 generation 或
marker。`stop()` 只发 shutdown，不等待 thread join，Hermit 最后仍需自己的 ActivationLease
generation guard。
[`CrossCopy watcher`](https://github.com/CrossCopy/clipboard/blob/v0.3.6/src/lib.rs#L137-L206)

这意味着 CrossCopy 没有减少本切片最关键的复杂度，却额外带来 clipboard-rs、Rust thread、
N-API binary、ASAR unpack、签名/notarization 和第三方 native supply chain。N-API 降低 ABI
风险，但 Electron 官方仍要求真实验证目标架构、原生模块加载和打包。
[`Native Node Modules`](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
[`ASAR Archives`](https://www.electronjs.org/docs/latest/tutorial/asar-archives)

### 替代方案：第一方 macOS micro-adapter

本轮唯一推荐是做一个**可丢弃、仅 macOS arm64 TEXT 的 AppKit/Node-API 资格 spike**，不建
跨平台 clipboard framework，也不创建 helper 或 native watcher thread。原生面只提供：

- `changeCount()`：读取 `NSPasteboard.general.changeCount`；
- `snapshotText()`：执行 `countBefore -> read TEXT -> countAfter`，只返回计数一致的稳定
  `{ changeCount, text }`；
- `writeText(text)`：写入 TEXT 并返回写完后的 `changeCount`。

Apple 明确说明 `changeCount` 在 pasteboard ownership 变化时递增。Core 因此可以用写入返回的
精确计数抑制自身写回；外部应用随后复制相同文本时计数再次变化，不会被基于内容的 TTL
误吞。观察定时器、ActivationLease、停用清理和 generation guard 仍由 Core 管理。
[`NSPasteboard.changeCount`](https://developer.apple.com/documentation/appkit/nspasteboard/changecount)

Electron 自带 `clipboard` 只有 read/write/format API，没有 `changeCount` 或 change event。
“Electron `readText()` + 比较上次文本”无法识别同文本重新复制，也无法精确区分自身写回后
外部再次复制相同内容，因此只适合作为便宜的对照 fixture，不作为正式 observer。
[`Electron clipboard`](https://www.electronjs.org/docs/latest/api/clipboard)

micro-adapter 的 packaged qualification 至少覆盖：真实外部复制和写回、Unicode/多行保真、
同文本重复复制、稳定 snapshot、own-write count 抑制、own-write 后外部同文本、快速计数跳跃、
反复启停/旧 generation、ASAR/签名/notarization 和 crash soak。快速 `A -> B -> C` 允许中间
内容被系统覆盖，但必须捕获当前稳定 snapshot，不能伪造为无损事件日志。

资格结果只有 PASS 或 BLOCKED：PASS 只证明此 Core port 可行，仍等待 Product Surface；
若确认是打包、生命周期或平台语义的架构性 FAIL，就保持 native capture Gate 阻断，不再依次
尝试 CrossCopy、clipboard-rs、helper 和 shell polling。

## File Workspace 会话哪些可以复用

### 可以复用：设计方法和跨层规则

| File Workspace 已验证的方法 | Smart Clipboard 中的对应做法 | 结论 |
| --- | --- | --- |
| `FileRecord.id` 不随路径和文件夹移动改变 | `ClipboardEntry.id` 不等于内容 hash 或列表行号；精确重复命中时保留原 ID，更新最近使用时间、来源和排序 | 直接复用原则 |
| FileRecord、ManagedBlob、projection、索引分开 | Entry 元数据、TEXT/IMAGE/FILE_LIST Canonical、`search_text`、摘要、缩略图分开 | 直接复用原则 |
| Better Sidebar 只承载公开 Tab，不拥有 managed 内容 | DSH Surface 只承载 History/浮层，插件 domain 仍是 Canonical writer，storage 通过 Core repository contract 落地 | 直接复用原则 |
| 特权文件操作经过 Core/Broker，不由 Client 旁路 | observe/write/autoPaste/shortcut/window 都经过 Core capability | 直接复用原则 |
| 用固定 `dsh-better-sidebar@0.16.1` 做 public-contract spike | 对 frozen DSH、packaged Hermit 和平台剪贴板做 executable qualification | 直接复用工作方式 |
| lifecycle disposer 随工作面释放 | observer、shortcut、window/listener、timer 统一挂到一次 ActivationLease generation | 直接复用生命周期规则 |
| 自有轻量 Trash，不冒充 OS Trash | Clipboard 单条删除进入插件 Trash；永久删除同时清 Canonical 和自有派生数据 | 复用删除一致性原则 |
| `@文件` 选择时固化一次 projection，Session 不取得源文件所有权 | 后续 `@ClipboardItem` 固化单条已选择 Entry 的安全 projection，不后台监听或自动刷新 | 只在 M3.1/M3.2 复用 |

### 不能复用：文件领域本身

1. **不引入 `managed/external`。** TEXT、IMAGE、FILE_LIST 都是 Smart Clipboard 自己捕获的
   Canonical 记录；FILE_LIST 保存的是有序引用，不成为 File Workspace external 文件。
2. **不引入 revision。** 一条剪贴板记录不是可编辑文档。重复内容按已冻结的精确去重规则
   更新同一 Entry 的复制时间/来源，不形成 revision 链。
3. **不复用文件树或文件夹组织。** 首版没有 Collection、Tag 或目录，Pin 也不应发展成模板库。
4. **不委托全部搜索给 Federated Search。** 快捷取回要求离线、低延迟、输入即搜索，插件必须
   有自己的本地索引；未来 Core Federated Search 只聚合结果，不替代这条热路径。
5. **不复用 Better Sidebar。** File Workspace 的直接依赖是被批准的唯一例外；Smart
   Clipboard 需要独立 Product Surface 和 Core 管理的 overlay。
6. **不复用文件导入、同名替换和 external 保存冲突。** 剪贴板捕获、精确重复与超限淘汰是
   另一套业务语义。

## 开源实现比较

### 总表

| 项目 | 真实实现形态 | 最值得参考 | 不应照搬 | 许可证边界 |
| --- | --- | --- | --- | --- |
| [Maccy](https://github.com/p0deje/Maccy) | macOS 原生 Swift/SwiftData 单体应用 | AppKit 捕获、明确 marker、键盘优先、先写回再发粘贴键 | 菜单栏/UI、SwiftData schema、macOS-only 结构和无法确认目标已粘贴的成功心智 | MIT；代码级候选仍需 Package Gate/NOTICE 审查 |
| [EcoPaste](https://github.com/EcoPasteHub/EcoPaste) | Tauri + Rust core + React，macOS/Windows | 平台 watcher、规范化、SQLite/FTS、资源落盘、写回 guard、快捷键和非激活 panel | Tauri 壳、直接原生权限、完整设置/分组/敏感启发式、只支持两平台 | Apache-2.0；适合代码级候选，保留版权/许可并审查依赖闭包 |
| [CopyQ](https://github.com/hluk/CopyQ) | Qt/C++，GUI server + 独立 clipboard monitor + clients | 平台接口、监控故障隔离、marker/owner、容量满且全置顶时明确停止新增 | 多进程脚本平台、Tab/命令系统、重量级隔离默认值 | GPL-3.0-or-later；未接受 GPL 派生义务前只作行为/测试参考 |
| [Ditto](https://github.com/sabrogden/Ditto) | Windows MFC/C++ + SQLite + clipboard thread | `AddClipboardFormatListener`、busy/retry、owner/foreground best effort、Windows 快捷取回 | Windows-only/MFC、旧兼容链和整体数据库 | GPL-3.0；默认只作 Windows 行为/测试参考 |
| [PowerToys Advanced Paste](https://github.com/microsoft/PowerToys/tree/main/src/modules/AdvancedPaste) | Runner 模块 + 独立 WinUI 进程 + named pipe；历史委托 Windows Clipboard History | 宿主 enable/disable、热键分发、进程启动/退出、AI 与普通 paste 分层 | 依赖 Windows 系统历史、Windows-only UI/IPC、AI 放进首切片 | MIT；模块生命周期代码可研究，不能把 OS 历史当跨平台 Canonical |
| [GPaste](https://github.com/Keruspe/GPaste) | daemon 拥有历史，GTK UI/GNOME Shell extension/CLI 经 D-Bus 使用 | 后台 owner + 多前端窄契约、稳定 UUID、SQLite/资源、Shell 生命周期 | GNOME/GLib/DBus 具体实现、首版即建独立 daemon、多个 history/encryption | BSD-2-Clause；边界和部分代码可候选复用，仍需依赖审查 |
| [Clipboard Indicator](https://github.com/Tudmotu/gnome-shell-extension-clipboard-indicator) | 全部逻辑直接运行于 GNOME Shell extension | 宿主 enable/disable disposer、菜单内键盘操作 | 捕获、图片缓存、registry 和 UI 同进程；官方承认大图卡顿且粘贴非全兼容 | MIT；主要作为反例 |

许可证说明只是工程筛选，不代替正式法律意见。任何代码复制、静态/动态链接和依赖分发都
必须由 Package Gate 针对精确 commit、transitive dependency、NOTICE 和最终发行方式再审计。

### Maccy：行为参考，不是跨平台架构

当前官方源码使用 `Timer` 比较 `NSPasteboard.changeCount`，变化后才读取 pasteboard；读取前
跳过 `.autoGenerated`、`.concealed`、`.transient`，并用 `.fromMaccy` 标记自身写回。
[`Clipboard.swift`](https://github.com/p0deje/Maccy/blob/d994f91f11e4836d155f41119577237ce7d9d5b4/Maccy/Clipboard.swift#L13-L31)
[`Clipboard.swift`](https://github.com/p0deje/Maccy/blob/d994f91f11e4836d155f41119577237ce7d9d5b4/Maccy/Clipboard.swift#L50-L71)
[`Clipboard.swift`](https://github.com/p0deje/Maccy/blob/d994f91f11e4836d155f41119577237ce7d9d5b4/Maccy/Clipboard.swift#L149-L239)

历史命中重复项后迁移首次复制时间、次数和 pin，删除旧对象；容量只淘汰未置顶记录。
[`History.swift`](https://github.com/p0deje/Maccy/blob/d994f91f11e4836d155f41119577237ce7d9d5b4/Maccy/Observables/History.swift#L121-L175)
这验证了 Hermit 的“稳定业务身份 + 去重更新 + 置顶免自动淘汰”方向，但不能复制其存储
schema：Maccy 当前重复实现实际用新对象替换旧对象，而 Hermit 已冻结保留原 Entry ID。

粘贴链先写 NSPasteboard，再用 CGEvent 发送粘贴组合键。CGEvent post 本身没有目标应用
消费回执，因此没有任何项目能普遍证明“目标真的收到了内容”。
[`Clipboard.swift`](https://github.com/p0deje/Maccy/blob/d994f91f11e4836d155f41119577237ce7d9d5b4/Maccy/Clipboard.swift#L74-L139)
Hermit 继续把复制作为可靠结果、自动粘贴作为 best effort 是正确的；“成功”最多表示能力
检查和事件注入没有立即失败，不能承诺目标内容已改变。

### EcoPaste：最接近跨平台数据链

EcoPaste 官方贡献指南明确把剪贴板采集/写回、数据库、快捷键和窗口放在 Rust，React 只做
渲染、交互与 UI 状态；前端通过 Tauri command 和命名事件通信。
[`CONTRIBUTING.zh-CN.md`](https://github.com/EcoPasteHub/EcoPaste/blob/5139d30b0f4c1309356a9b308c05092f1038bc9b/CONTRIBUTING.zh-CN.md#L26-L49)

其 watcher 在独立线程内创建平台句柄；macOS 走 `changeCount` 轮询，Windows 走
`AddClipboardFormatListener`，Windows 读取 busy 使用有界重试。payload 规范化后才把可发送
数据投递到异步数据库路径。
[`watcher.rs`](https://github.com/EcoPasteHub/EcoPaste/blob/5139d30b0f4c1309356a9b308c05092f1038bc9b/src-tauri/src/clipboard/watcher.rs#L1-L48)
[`watcher.rs`](https://github.com/EcoPasteHub/EcoPaste/blob/5139d30b0f4c1309356a9b308c05092f1038bc9b/src-tauri/src/clipboard/watcher.rs#L250-L345)

写回前登记带 TTL 的 `content_hash`，监听命中后只消费一次，避免简单布尔标志误吞写回间隙
发生的真实复制。这是 Hermit 首切片很值得做成资格用例的实现模式，不应原样冻结常量。
[`guard.rs`](https://github.com/EcoPasteHub/EcoPaste/blob/5139d30b0f4c1309356a9b308c05092f1038bc9b/src-tauri/src/clipboard/guard.rs#L1-L63)

数据模型把稳定 `id`、去重 `content_hash`、`search_text`、列表 `summary`、图片缩略图路径和
UI 后置字段分开；SQLite FTS 用 trigger 跟随 Canonical 表更新。
[`models.rs`](https://github.com/EcoPasteHub/EcoPaste/blob/5139d30b0f4c1309356a9b308c05092f1038bc9b/src-tauri/src/db/models.rs#L34-L114)
[`0001_init.sql`](https://github.com/EcoPasteHub/EcoPaste/blob/5139d30b0f4c1309356a9b308c05092f1038bc9b/src-tauri/migrations/0001_init.sql#L20-L80)
这直接支持从 File Workspace 迁移“业务身份和派生数据分离”的方法。

EcoPaste 仍不能整体移植：它是拥有全部原生能力的独立 Tauri 应用，不是受 DSH/Core
capability 约束的 Product Plugin；官方当前平台范围也只有 macOS 和 Windows。

### CopyQ 与 Ditto：平台资格和故障模型

CopyQ 官方架构把 clipboard monitor 放到独立进程，因为 Qt 剪贴板访问可能阻塞 GUI；主进程
通过本地 server 与 monitor/client 通信，并在 monitor 失去 keep-alive 时重启。平台差异由
`PlatformNativeInterface` 和 `PlatformClipboard` 承担。
[`source-code-overview.rst`](https://github.com/hluk/CopyQ/blob/0abed10b903dcfb00f59de75b4fdfb2f9f2cda11/docs/source-code-overview.rst#L21-L62)
[`source-code-overview.rst`](https://github.com/hluk/CopyQ/blob/0abed10b903dcfb00f59de75b4fdfb2f9f2cda11/docs/source-code-overview.rst#L146-L171)
[`clipboardmonitor.cpp`](https://github.com/hluk/CopyQ/blob/0abed10b903dcfb00f59de75b4fdfb2f9f2cda11/src/app/clipboardmonitor.cpp#L83-L190)

这证明“平台监控可能值得隔离”，但没有证明 Hermit 首切片现在就需要第二进程。当前更小的
选择仍是已经资格过的 packaged Electron main provider + ActivationLease；只有真实平台测试
出现不可接受的阻塞、崩溃或 owner 生命周期问题，才拿 CopyQ 作为升级依据。

CopyQ 还给出了一个与当前产品规则一致的边界：容量满且所有可淘汰项都被 pin 时，明确拒绝
新增并要求用户手工释放空间，而不是删 pin 或静默超限。
[`clipboardbrowser.cpp`](https://github.com/hluk/CopyQ/blob/0abed10b903dcfb00f59de75b4fdfb2f9f2cda11/src/gui/clipboardbrowser.cpp#L1558-L1583)

Ditto 在 Windows 使用 `AddClipboardFormatListener` 接收更新，旧系统才回退 viewer chain；
复制读取在专门 thread 中执行，对无格式结果可有界重试，来源优先取 clipboard owner，缺失时
才用 foreground window。
[`ClipboardViewer.cpp`](https://github.com/sabrogden/Ditto/blob/d36f864f9e6bc3558e11e3f1c9f5f522b8079702/src/ClipboardViewer.cpp#L65-L103)
[`ClipboardViewer.cpp`](https://github.com/sabrogden/Ditto/blob/d36f864f9e6bc3558e11e3f1c9f5f522b8079702/src/ClipboardViewer.cpp#L240-L341)
[`CopyThread.cpp`](https://github.com/sabrogden/Ditto/blob/d36f864f9e6bc3558e11e3f1c9f5f522b8079702/src/CopyThread.cpp#L35-L127)
这些适合转成 Windows adapter 资格场景，不适合复制 MFC/SQLite 整体结构。

### PowerToys：最接近宿主管理模块生命周期

PowerToys Runner 负责加载模块、分发事件、托盘和设置桥接；模块接口统一 enable/disable、
hotkey 和配置。External Application Launcher 可以由 Runner 启动独立 UI 进程并经 IPC 通信。
[`architecture.md`](https://github.com/microsoft/PowerToys/blob/e5a19c4ac544b18d79da42895e7f5c116aee15cd/doc/devdocs/core/architecture.md#L3-L33)
[`architecture.md`](https://github.com/microsoft/PowerToys/blob/e5a19c4ac544b18d79da42895e7f5c116aee15cd/doc/devdocs/core/architecture.md#L56-L74)

Advanced Paste 的 module process manager 在 enable 时启动进程和 named pipe，在 disable 时先发
graceful terminate，超时后强制终止；所有内部操作排进背景线程队列。
[`AdvancedPasteProcessManager.cpp`](https://github.com/microsoft/PowerToys/blob/e5a19c4ac544b18d79da42895e7f5c116aee15cd/src/modules/AdvancedPaste/AdvancedPasteModuleInterface/AdvancedPasteProcessManager.cpp#L35-L52)
[`AdvancedPasteProcessManager.cpp`](https://github.com/microsoft/PowerToys/blob/e5a19c4ac544b18d79da42895e7f5c116aee15cd/src/modules/AdvancedPaste/AdvancedPasteModuleInterface/AdvancedPasteProcessManager.cpp#L215-L273)
这与 Hermit Core 管理 activation lease、shortcut 和 overlay 的责任划分相似，但 Hermit 不需要
复制 Windows named pipe 或独立 WinUI 进程。

Advanced Paste 的历史不是它自己的跨平台数据库，而是直接调用 Windows
`Clipboard.GetHistoryItemsAsync()` 和 `Clipboard.HistoryChanged`，删除也调用 Windows History。
[`MainPage.xaml.cs`](https://github.com/microsoft/PowerToys/blob/e5a19c4ac544b18d79da42895e7f5c116aee15cd/src/modules/AdvancedPaste/AdvancedPaste/AdvancedPasteXAML/Pages/MainPage.xaml.cs#L33-L138)
因此它不能替代 Smart Clipboard Canonical storage，只能参考宿主/模块和后续显式 AI 分层。

### GPaste：最接近“后台 owner + 宿主扩展 UI”

GPaste 官方定位就是“daemon 记忆历史 + GTK UI + GNOME Shell extension + CLI”。daemon 拥有
历史并经 D-Bus 暴露，前端只是客户端；SQLite/XML/no-op 是可选存储后端。
[`README.md`](https://github.com/Keruspe/GPaste/blob/ebb0eeaec6a655e0268c33c4b70f142a7154bd49/README.md#L1-L31)
[`README.md`](https://github.com/Keruspe/GPaste/blob/ebb0eeaec6a655e0268c33c4b70f142a7154bd49/README.md#L183-L195)

Item 内部有稳定 UUID、内容、特殊 representation、显示文本、大小和 favourite；UUID 与数组
位置分开，pin 只改变淘汰资格，后续 size/memory/storage 都由 History 统一处理。
[`gpaste-item.c`](https://github.com/Keruspe/GPaste/blob/ebb0eeaec6a655e0268c33c4b70f142a7154bd49/src/libgpaste/gpaste-daemon/gpaste-item.c#L11-L38)
[`gpaste-item.c`](https://github.com/Keruspe/GPaste/blob/ebb0eeaec6a655e0268c33c4b70f142a7154bd49/src/libgpaste/gpaste-daemon/gpaste-item.c#L158-L187)

它最值得 Hermit 借鉴的是所有权关系，而不是进程形式：Core/provider 拥有平台观察句柄，
Product Plugin 拥有 Canonical 业务历史，DSH Client UI 只走公开契约。Hermit 已经有 Electron
main + DSH/Cordis，不应仅因为 GPaste 使用 daemon 就再造一个长期服务。

### Clipboard Indicator：最接近宿主扩展，也最能说明反例

Clipboard Indicator 在 GNOME Shell extension `enable()` 中直接创建剪贴板、菜单、Registry 和
快捷键对象，`disable()` 时销毁；Registry 把文本 JSON 和图片缓存直接放在扩展自有的用户
cache 目录。
[`extension.js`](https://github.com/Tudmotu/gnome-shell-extension-clipboard-indicator/blob/c880c7fb88dc7232a61a5864d125989a4f375daa/extension.js#L66-L103)
[`registry.js`](https://github.com/Tudmotu/gnome-shell-extension-clipboard-indicator/blob/c880c7fb88dc7232a61a5864d125989a4f375daa/registry.js#L10-L67)

其官方 README 同时列出“大图片会短暂卡顿”和“菜单粘贴并非所有应用都工作”。
[`README.md`](https://github.com/Tudmotu/gnome-shell-extension-clipboard-indicator/blob/c880c7fb88dc7232a61a5864d125989a4f375daa/README.md#L59-L63)
这正好反证两条 Hermit 规则：重 payload 的读取、哈希、缩略图和持久化不能占用 DSH UI
线程；auto-paste 必须有 copy-only 产品状态。

## 对首条 vertical slice 的建议

本轮没有理由扩大或重排当前首切片，仍然只做 TEXT。建议实现顺序保持：

1. 先解除 DSH Product Surface Gate；在此之前不写正式 domain DB；
2. 用同一最小 artifact 证明 Product Plugin -> Core capability handshake 和 ActivationLease；
3. 在 packaged Hermit 中用第一方 macOS micro-adapter spike 验证真实 changeCount、稳定 TEXT
   snapshot、write/own-write count、锁屏、shortcut 和 autoPaste/copy-only；
4. 再实现 `ClipboardEntry.id + canonical text + exact content hash + last_used + source`；
5. 搜索先满足 100 条 TEXT 的普通输入即过滤，不为 IMAGE/FILE_LIST 或 AI 提前建框架；
6. 快捷取回和完整 History 复用同一个 domain service，不创建第二份缓存真相；
7. 停用时先让 activation generation 失效，再逆序撤销 listener、shortcut、window 和异步任务，
   已有业务数据保留。

需要额外加入资格用例、但不必改产品范围的三件事：

- **自身写回回环**：macOS TEXT 用 `writeText()` 返回的精确 `changeCount` 只吞对应写回；
  其他平台后续分别资格 marker/generation/fingerprint，不能提前冻结一个跨平台 TTL 规则。
- **来源只 best effort**：捕获时尽早采集当前 owner/frontmost 信息，失败写 unknown，不能把
  foreground app 宣称成可证明的 writer。
- **auto-paste 无通用成功回执**：权限拒绝、SendInput 数量不足或能力不可用时明确降级；即使
  注入 API 返回成功，也不宣传“目标应用已确认粘贴”。

## 最终裁决

- `FILE_WORKSPACE_DESIGN_METHOD_REFERENCE = YES`
- `FILE_WORKSPACE_DOMAIN_MODEL_REUSE = NO`
- `OPEN_SOURCE_WHOLESALE_FORK = NO`
- `LAYERED_REFERENCE = YES`
- `CROSSCOPY = RESEARCH_SAMPLE_ONLY, NO_QUALIFICATION`
- `MACOS_TEXT_NATIVE_SPIKE = FIRST_PARTY_CHANGECOUNT_MICRO_ADAPTER`
- `TEXT_DOMAIN_IMPLEMENTATION = NO-GO`，原因仍是既有 DSH Product Surface 和 Core/platform
  Gate，开源项目没有提供捷径
- `NEXT_ACTION = FINISH_G2_PRODUCT_SURFACE -> G3_CAPABILITY_SEAM -> G4_PACKAGED_CLIPBOARD`

这份结论不要求修改当前 Smart Clipboard 产品设计；它只把实现参考收敛到明确层次，并补充
稳定 snapshot、自身写回、来源归因和 auto-paste 回执四个必须在资格中验证的工程问题。
