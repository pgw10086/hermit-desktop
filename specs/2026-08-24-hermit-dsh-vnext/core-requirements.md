# Hermit DSH vNext 核心需求确认稿

状态：核心产品边界和 M1 底座路线已确认；Product Plugin 详细设计、UI 资格验证和
最新变更后的跨模块复核仍在进行
更新时间：2026-08-27
当前审查结论：上一轮终审曾为 `PASS`，但已被 2026-08-27 的产品变更取代；当前不能
标记为终审 `PASS`

> 本文档是 vNext 产品和后续详细设计的唯一主需求。旧版 `spec.md`、原型和
> 模块复用文档只作为历史输入；发生冲突时，以本文档为准。

## 1. 一句话定位

Hermit 是一款以 DeepSeek Harness（DSH）为主体的本地优先桌面 AI
工作台。用户可以直接使用完整的 DSH 对话，也可以按需安装完整业务插件，
让同一个 DSH AI 帮助管理个人事务、文件和剪贴板。

## 2. 要解决的问题

用户每天会遇到大量对话、临时想法、待办、日程和文件。这些信息通常分散
在聊天软件、任务工具、文件夹和剪贴板中，难以持续整理和找回。

Hermit 要形成下面的闭环：

```text
收进来
-> 整理和管理
-> 需要 AI 时交给同一个 DSH
-> 执行或提醒
-> 搜索和回顾
-> 导出、删除或卸载
```

## 3. 产品形态

- 已确认：桌面应用是主要产品形态。
- 已确认：DSH Core 是产品主体，不是 Hermit 的一个 AI Provider。
- 已确认：什么业务插件都不安装时，完整 DSH Conversation、Session、
  Models、Tools、Approval、MCP、Skills、Presets 和 Settings 仍可使用。
- 已确认：业务能力以可按需安装的 Product Plugin 提供。
- 已确认：一个 Product Plugin 必须是一套完整业务，而不是一个页面或按钮。
- 已确认：Windows 和 macOS 是正式发布平台，必须通过完整发布门；Linux 按
  WebView、Tray、全局快捷键、clipboard data-control 和隔离能力逐项探测，缺失
  能力时大白话降级，不阻塞 Windows/macOS P0。

当前 Go 产品只在正式 Authority Switch 前保持旧系统权威。目标安装和切换后
完全没有 Hermit Go 运行时、Go 数据权威或 Go 后台进程。

## 4. 核心原则

### 4.1 DSH 是唯一 AI 入口

已确认：插件可以给 DSH 提供资料、确定性处理能力和 Tools，但不能自己成为
另一套 AI。

```text
用户从任意入口发起 AI 操作
-> 创建或选择真实 DSH Session
-> 插件提供必要数据、上下文或 Tool
-> DSH 选择模型并调用 Provider
-> DSH 处理流式回答、Tool 和 Approval
-> 结果写入同一个 Session 历史
```

Hermit Product Plugin 不得：

- 保存模型 API Key 或 Provider 凭据；
- 直接调用模型 SDK、模型 HTTP 接口或 `ctx.llm`；
- 自己选择 Provider 或模型；
- 创建第二套聊天、审批或 AI 历史；
- 在后台静默执行总结、分类、长期记忆提取等生成式任务。

只有 Core 允许的 Model Provider Adapter 可以注册模型能力。

#### 4.1.1 统一 `@` 资源选择入口

已确认：DSH 主 Conversation 输入框使用一个统一的 `@` 入口选择业务数据。

- DSH Core 提供 Files 和历史 Sessions；
- Personal Organizer 安装后贡献 Note/Todo/Event 等候选；
- 后续 Product Plugin 可以按同一契约贡献自己的候选；
- 输入 `@` 后按当前已安装 Provider 分组显示候选；
- Core 只认识 Provider、稳定引用、显示名称和通用状态，不理解 Todo、File
  等业务 Schema；
- 每个 Provider 自己负责安全元数据查询、权限判断、引用解析和模型投影；
- 打开和搜索 `@` 菜单时不得读取文件或事项正文；
- P0 不把 `@file`、`@todo`、`@session` 定义为保留硬语法；用户直接输入
  `@` 和搜索词即可；
- 选中的引用作为结构化原子引用留在 Composer 中，不把正文复制进输入框。

在 Composer 中插入引用只创建可撤销的 pending selection，不立即签发读取权。
只有包含该引用的真实用户消息成功提交为本轮 turn 时，Core 才签发 grant；发送前
删除引用、丢弃草稿或切换 Session 都不会留下授权。

统一的是选择体验，不是把不同数据强行变成同一种读取方式。File Workspace
候选只绑定稳定 FileRecord；打开 `@` 菜单和搜索候选时不读取正文。用户明确选中
File Workspace 文件时，Provider 从最后一次成功保存的 revision 生成一次安全 UTF-8
projection，并把其身份放入尚未发送的原子引用；编辑器未保存内容不进入 projection，
也不为此触发或等待保存。文件从未成功保存或 projection 无法安全生成时不插入引用。
这一步只是准备待发送材料，不签发模型读取权，也不产生 DSH Tool Result；Organizer
业务引用仍由 Organizer Provider 按自己的安全投影规则解析。

#### 4.1.2 Live Reference 策略

结构化业务资源默认使用简单的 Live Reference：Session 不在资源被选中时额外保存
一份业务内容快照，只保存 Provider 和稳定引用。File Workspace 是明确例外：为了让用户
清楚控制“这次引用的是哪次已保存内容”，选择文件时生成一次临时 projection，后续发送
和读取都绑定这份 projection，不在发送时或模型读取时重新读取最新文件。来源 revision
用于追溯，不提供用户可见的“锁定 revision”功能。

`@` 同时代表本轮读取授权：

- 当前用户消息中新出现的普通 `@Ref` 可以读取数据源当前版本；File Workspace `@文件`
  只能读取用户选择时已经捕获的 projection；
- 实际读取结果以 DSH Tool Result 形式进入 Session 历史；
- 以后继续旧对话时只使用旧 Tool Result，不允许模型根据历史 `@Ref` 自动读取
  数据源最新版本；
- 用户必须在新一轮再次 `@` 同一资源，才建立新的读取授权和新的 Tool Result；
- Provider 被卸载后，旧 Tool Result 仍可查看，新读取返回 Provider unavailable。

已确认：本轮出现新 `@Ref` 后，Core 不自动把正文送给模型。File Workspace 在用户明确
选择时准备 projection 是 Provider 的用户触发动作，不等于模型已经读取。模型在确实需要
内容时仍必须显式调用 DSH Tool：

- 没有成功 Tool Result，模型不能声称已经看过资源正文，也不能根据标题猜测；
- Tool 执行时按当前权限读取 Provider 提供的 AI-safe projection；File Workspace 读取
  选择时捕获的 projection，不自动换成最新 revision；
- 普通结构化资源在选择、取消输入或未实际依赖时不读取业务正文；File Workspace 只在
  用户明确选择文件时读取最后成功 revision 以准备 pending projection，该正文此时不进入
  模型或 Tool Result；
- 正文只有在对应 Tool Result 成功后才能进入模型上下文；没有成功结果时，系统
  提示词和结果状态都禁止声称已经读取。Core 不承诺判断模型内部究竟“依赖”了
  哪条资料；
- Todo/Event 等小对象返回完整安全投影，不返回数据库内部字段、ACL 明细、
  Secret 或插件实现字段；
- File 继续使用 DSH 官方 `read` Tool，不由 Core 自动整文件预读。

#### 4.1.3 统一结构化资源读取 Tool

已确认：Note/Todo/Event 和后续插件的结构化业务资源统一使用 Core-owned
`resource_read(ref)`。它是一个极窄的读取能力，不是万能插件 RPC。

Core 只负责：

- 检查该 Ref 是否由当前用户消息中的 `@` 获得本轮读取权；
- 解析通用 reference envelope 并按 `providerId` 找到当前 Provider；
- 处理 Provider unavailable、总超时、取消和通用结果大小/格式边界；
- 把成功或失败的 Tool Result 写入 DSH Session。

Provider 自己负责：

- 当前用户业务权限；
- stable ref 到当前业务对象的解析；
- 数据库或远端数据查询；
- 字段过滤、脱敏和 AI-safe projection；
- 业务访问审计和更严格的内部超时。

`resource_read` 只能读取，不提供 search、update、delete、complete、relation 或
跨 Provider fallback。搜索和写入仍走各模块已经确认的独立入口；File Workspace 正文和
跨插件搜索由 Core Federated Search 发起，不因此塞进 `resource_read`。

File 不强行接入 `resource_read`，继续使用 DSH 官方有界 UTF-8 `read` 的 path、
offset 和 limit 语义。文件 containment、只读 AI filesystem scope 和可选的
read-before-write observation policy 由 Hermit Core adapter 显式提供，不能把它们
误写成 `read` Tool 自带的安全保证。对 File Workspace 文件，受控 path 指向用户选择时
生成的 projection，不允许 `read` 绕过它改读 external 原路径或最新 ManagedBlob。

#### 4.1.4 Reference、Provider 和本轮授权

持久化 Ref 与本轮授权必须分开：

```text
持久化 Ref = referenceProtocolVersion + providerId + opaqueRef + displayLabel
本轮授权 = actor + workspace + session + turn + providerId + ref + read-only
```

- Ref 是门牌号，不是门票；不能保存 `authorized=true`；
- `referenceProtocolVersion` 是 envelope 协议版本，不是业务对象 revision；File
  Workspace pending selection 可以在内部绑定 projection 的来源 revision，但持久 Ref
  不因此变成 revision ID，实际 observed revision 仍只在成功读取的 Tool Result 中记录；
- 只有当前真实用户消息中新出现的 `@` 才签发只活一个 turn 的读取授权；
- grant 中保存 session、turn、ref、expected/observed version 约束、expiry 和读取
  次数等运行信息；这些都不能编码进持久 Ref；
- replay、fork、复制旧消息或模型自己发现历史 Ref 都不会重新授权；
- providerId 使用“Package Gate 验证过的签名 package identity namespace +
  provider name”，由 Package Gate 永久登记所有权；插件卸载后 namespace 仍保留
  给原签名身份，其他包不能抢注并接管旧 Ref；
- Plugin unload/dispose 时撤销 Provider registration，并取消 in-flight call；
- Core 只精确路由到 Ref 声明的 Provider，不做跨 Provider fallback；
- Provider 接收最小只读调用上下文、Ref、AbortSignal 和预算，不接收整个可变
  Session/Workspace 对象，也不能要求 Core 转调其他 Provider。

#### 4.1.5 结果、预算和错误闭环

成功 Tool Result 只保存模型实际看到的安全投影，不保存投影前的原业务对象。
通用信息包括 Provider、Ref、observedAt、可选 revision/updatedAt、投影协议
版本、是否截断和省略量。

- Core 不理解业务字段含义，但机械验证 Provider 声明的 JSON Schema、JSON
  可持久化性、通用安全边界和调用预算；
- 不写死所有资源统一 8 KiB。实际 byte/token 预算取部署上限、Provider 声明
  和本 turn 剩余预算中最紧者；
- Provider 在预算内生成“短而完整”的安全投影，Core 不从中间截断 JSON；
- 最小合法投影仍超预算时返回 limit error；P0 不实现大型 evidence object；
- 一个 Ref 在一个 turn 最多执行一次 Provider read；模型重复发起同一 Tool call
  时保留每个 callId/result 配对，但底层复用同一次 settled result；
- not-found/deleted、forbidden、provider-unavailable、timeout、malformed 和
  internal 都成为 Tool error，不炸掉 Session；
- 为防止枚举，模型可见的 forbidden 与 not-found 可使用相同文案；
- 部分资源失败时继续使用可用来源并说明缺失项；问题完全依赖失败资源时明确
  说明无法完成，不能猜测。

#### 4.1.6 超时、审批、历史和审计

- Core 设置有限 deadline 并传递 AbortSignal；Provider 可以使用更短预算，
  不能延长；
- Provider 必须把取消传到支持取消的数据库、网络或 SDK；不可抢占的本地同步
  读取必须有严格查询/数据上限。收到 abort 后丢弃晚到结果、禁止后续副作用并
  等操作 settle；不能只用 Promise race 假装底层工作已经停止；
- 已提交的当前 user turn 中 `@` 已构成一次只读授权，普通 `resource_read` 不重复
  弹审批；
- 敏感 Provider 可以额外要求 DSH Approval 或拒绝；额外审批只能收紧授权；
- `@` 的读取权不能用于 mutation；模型发起的写操作必须走插件业务 Tool 和 DSH
  permission/approval pipeline。普通 create/update 可按策略自动允许，永久删除、
  批量写和不可逆操作强制 ask；用户在业务 UI 手工操作使用对应本地确认；
- Approval 绑定 `sessionId + callId + tool + canonicalArgsHash + targetProvider`，参数、
  Session、连接或目标变化后不能复用；业务 mutation 以 callId 持久去重，崩溃、
  replay 或 reconnect 后返回同一个已提交结果，不重复产生副作用；
- 后续撤销业务权限只阻止未来读取，不静默修改此前合法的 Tool Result；
- 删除源业务对象默认只阻止未来读取，不会假装抹掉已经生成的 Session 内容；
- 用户另行执行“从会话中清除引用内容”时，使用 Hermit 自研 persistence-level
  redaction/crypto-shred：append-only 事件 envelope 和 call/result pairing 保留，
  payload 变为 purged placeholder，并标记 Session 不再可精确 replay；不能用
  DSH compaction 冒充永久删除；
- assistant 已经生成的自然语言可能包含原内容的改写。P0 不承诺语义级擦除；要
  移除它必须删除对应 Session，界面在清理前明确说明；
- DSH compaction 可以缩短当前模型表面，但未 purge 的 durable Tool Result 是
  历史事实；压缩后至少保留来源、outcome、observedAt、可选版本和短摘要；
- Provider 卸载后，旧 call/result 由 Core generic card 展示，不加载旧插件、
  不重新访问业务系统；新读取返回 Provider unavailable；
- Session 记录模型实际看到的 Tool call/result 和 DSH approval pair；
- Core 安全审计只记录 actor/session/turn/callId/provider/ref fingerprint、结果、
  审批、耗时、大小和截断状态，不复制正文或 raw opaqueRef；
- Provider 自己记录具体业务对象访问审计；三本账不互相复制正文。

三本账的职责和保留规则固定为：Session 保留模型实际看到的历史，跟随 Session
归档、删除或单独 redaction；Core audit 保留安全边界事实并按 Core 审计策略清理；
Provider audit 保留业务对象访问事实并按插件数据策略清理。删除任何一本账都不能
静默声称另外两本也已经删除。

### 4.2 插件及其声明的依赖闭包必须有完整价值

每个 Product Plugin 安装在 Core 和自己声明的必需依赖闭包上，都必须覆盖：

```text
数据进入 -> 管理 -> AI 操作 -> 持久化 -> 搜索/历史 -> 数据退出
```

默认不允许可选业务插件之间形成硬依赖。File Workspace 只依赖 Core 与已经资格通过的
Hermit Product Surface 公共契约，不再拥有业务插件依赖例外。Product Surface 契约缺失或
不兼容时 File Workspace 不激活，但不能导致 DSH、Core 或其他插件无法启动，也不能删除
File Workspace 数据。

### 4.3 插件消失等于能力收回，不等于系统故障

插件被禁用、崩溃或卸载时：

- 页面、导航、命令、Tools、Search Provider 和快捷入口立即撤销；
- timers、watchers、listeners、jobs 和通知停止；
- 派生缓存和搜索索引清除；
- 业务数据默认保留，并可重装、原始导出或单独永久删除；
- 跨插件弱引用显示为 unavailable/tombstone，不级联删除来源数据；
- 旧 DSH Session 仍可用通用 Tool Card 查看历史；
- 其他插件继续正常运行。

## 5. 产品结构

```text
Hermit DSH vNext
|-- DSH / Hermit Core（不可从产品 UI 移除）
|   |-- 完整 DSH AI、Conversation 和 Session
|   |-- Models、Tools、Approval、MCP、Skills、Presets、Settings
|   |-- Package Gate、插件生命周期和权限边界
|   |-- Tray / Status Host
|   |-- Typed Command Bus
|   |-- Federated Search Host
|   `-- Embedding Gateway（P0 可暂不开启）
|-- Personal Organizer（首发业务插件）
|-- File Workspace（首发业务插件）
|-- Smart Clipboard（后续业务插件）
`-- Desktop Surface / Quick Panel（Desktop Core 能力，首条闭环为 conversation.quick）
```

Core 只拥有宿主、路由、安全和恢复能力，不拥有 WorkItem、Reminder、
FileRecord 或 Clipboard History 等业务数据。

## 6. 模块清单与当前结论

### 6.1 DSH / Hermit Core

当前方向和模块 1 核心边界：已确认。

核心价值：即使没有业务插件，用户仍有一款完整的 DSH 桌面 AI 产品。

包含功能：

- DSH Conversation、Workspace/Profile 和 Session；
- Provider、Model、Tools、Approval、MCP、Skills、Presets；
- 统一 AI 入口和 Session 历史；
- 插件安装、禁用、升级、卸载和失败回滚；
- 状态栏/托盘和桌面生命周期；
- 联邦搜索入口；
- 最低限度的诊断、Safe Mode、更新和恢复。

### 6.2 Personal Organizer

当前方向和模块 4 完整业务闭环：已确认。

核心价值：安装后就是一套本地个人事务工具。没有 AI、File Workspace、网络
或系统通知权限时，用户仍能记录、管理、完成、提醒、搜索和导出。

#### 6.2.1 用户只需理解三个内容和一个时间能力

```text
笔记：记东西
待办：有一件事要做完
日程：有一段时间被占用
提醒：在指定时间提醒上面这些内容
```

- 长期内容只有 Note、Todo、Event 三类；
- Reminder 不是第四份重复正文，而是挂在内容上的时间规则；
- Reminder 不决定事项类型。先判断被提醒内容是可执行动作、时间占用的日程还是信息，
  再把 Reminder 附着到 Todo、Event 或 Note；
- “在某时提醒我做 X”且 X 是可执行动作时，默认创建 Todo；该时间同时写入 Todo 的
  `todoStart` 和 Reminder 触发时间。只有明确说“截止/最晚/之前完成”时才写 `todoDue`；
- “提醒我记住/保存一条信息”仍创建 Note 并附加 Reminder；
- 不保留 Inbox、无类型临时记录或待整理队列；无法明确判断为 Todo 或 Event 的
  内容直接成为 Note。

统一记录具有稳定 ID、必填类型、标题、正文、标签、revision、创建/修改/删除时间、
来源、原始输入、类型变更历史和可选外部引用。`kind` 只能是 Note/Todo/Event。

| 类型 | 主要字段 | 业务状态 |
|---|---|---|
| Note | 标题、正文、标签、置顶 | active / archived |
| Todo | 详情、清单、开始/截止、优先级、标签 | planned / completed / canceled |
| Event | 详情、时间形态、日期或开始/可选结束、全天范围、地点、标签 | scheduled / canceled |

Trash 不混进业务状态，只通过 `deleted_at` 表示。因此 planned Todo 进垃圾箱再
恢复仍是 planned，canceled Event 恢复后仍是 canceled。已经过去的 Event 仍
是 scheduled，只在界面派生显示“已过去”，不自动假装已完成。

日期必须区分“只有日期”和“具体时刻”。“8 月 28 日截止”不能偷偷变成 UTC
零点。Event 的 Canonical 时间语义显式区分 date-only、all-day 和 timed 三种互斥形态，
不能靠午夜时刻、空字段组合或展示规则相互冒充；具体存储字段名留到数据设计阶段确定。

Todo 的 start/due 角色必须由用户明确表达：“开始/从……开始”映射 start，“截止/最晚/
……前完成或提交”映射 due；“在某时提醒我做 X”且 X 是可执行动作时，该时刻是 Todo 的
start，同时也是 Reminder 的绝对触发时刻；裸日期不能默认当作 due 或 start。日期角色明确后，今天、
明天和可唯一解析的星期表达按当前 locale 与 IANA 时区解析；无钟点保存 date-only，有明确
钟点才保存时刻。“X 日前”作为排他日期边界，在只有日期精度时落到前一个本地日历日期。

Todo 内容足以创建而日期角色、日期值或关系不完整时，先创建 Todo；只持久化角色明确、
值唯一且彼此一致的时间事实并反馈部分成功。`start > due` 时冲突中的两者都不写；不保存
pending date。后续补充针对同一 item ID 使用 expected revision 和独立幂等 update。Today
只根据 durable start/due 投影，不从原始输入中的未确定日期文字派生状态。

Todo 相对 Reminder 显式区分 start-relative 和 due-relative。用户明确说“开始前/截止前”
时使用对应字段；普通“提前 X”只在 start/due 恰好存在一个时使用唯一锚点，同时存在两个
时不建立默认优先级并追问。date-only 锚点不得提供隐含钟点：日历日偏移还需用户明确
Reminder 钟点，分钟/小时偏移必须有具体时刻锚点。

相对 Rule 保留锚点关系并随合法字段修改重算。Todo 锚点、受影响 Rule 和未来 Occurrence
原子提交；删除锚点、降低时间精度导致 Rule 不可调度或重算到过去时，不得自动改锚、固化
旧时刻、删除、补发或留下半有效 Rule，用户处理相关 Reminder 前不提交该锚点修改。
absolute Reminder 不随 start/due 变化。

一次性相对 Reminder 按 nominal Occurrence 去重，不在首次 fired/dismissed 后永久终止
Rule 的锚点关系。新未来 nominal time 可以为同一 Rule 产生新 Occurrence；同一 nominal
time 已消费后不得因改期往返、revision 或重启再次投递。旧 fired/dismissed 历史不可改写；
旧 pending snooze 因事项改期停止未来投递但保留历史。absolute one-time 不因事项改期
重新产生 Occurrence。

用户显式移除 Reminder 时，目标 Rule 进入不可恢复 removed 终态，未来 Occurrence 和
pending snooze 停止投递，既有历史保持可解释；当前不提供可恢复的 Rule pause。Removed
Rule 不因 item 改期、生命周期恢复或重启重新调度。重新创建相同 Reminder 使用全新 Rule
ID，旧 Rule 的去重历史不抑制新意图。Item 永久删除时才清除所属 Rule 与 Occurrence 历史；
原生 JSON round-trip 在 item 仍存在时保留 removed 终态且不得重新 enable。

同一 item 的正常 create/update 不得形成 Canonical 调度语义完全相同的 active Reminder
Rule。Exact equality 基于 Rule 类型、锚点、offset、明确钟点、absolute 时间、recurrence、
timezone 等调度事实，不使用文本或模型相似度。重复请求是 no-op 并返回现有 Rule，不增加
revision、Occurrence 或通知；不同入口并发创建必须原子收敛为一条。Removed Rule 不参与；
原生 JSON 无损恢复保留 legacy 数据，普通外部导入遵守当前唯一性并报告重复。

同一 item 的不同 Canonical Rule 恰好得到同一实际触发时刻时，不合并 Rule 或 Occurrence，
只在展示和投递层按 item、exact effective fire instant、channel 聚合；不同 item 或不同
时刻不使用模糊窗口合并。聚合项必须说明多个提醒原因，同一系统通知渠道只投递一次；每个
Occurrence 仍独立保留状态、历史和投递结果。聚合 snooze/dismiss 原子处理当时仍可操作的
全部成员，打开只打开关联 item，通知失败不删除 Canonical Reminder。

同一 repeating Rule 的 snoozed Occurrence 不得越过下一次正常 nominal Occurrence：target
严格早于下一实际 nominal instant 时保留，等于或晚于时停止旧实例未来投递并记录“由下一
次正常提醒接替”，但不删除、dismiss、合并或改写历史。该 cutoff 同时约束恢复补发；应用
在 cutoff 到达后恢复时旧 snooze 不补发，下一正常实例和 Rule recurrence 不受影响。

- date-only 只保存本地日历日期，表示“属于这一天，但时间未指定”；没有开始/结束时刻，
  不是 all-day，日期也不因设备切换时区而移动；
- all-day 只在用户明确表达全天时间范围或导入来源明确标记 all-day 时创建，保存本地开始
  日期和不包含最后一天的结束日期；不得根据“休假、出差、团建、节假日、培训”等标题或
  内容语义推断全天；
- timed 的开始时间必填，结束时间可选；结束时间存在时必须晚于开始时间，不存在时只表示
  “用户未指定结束时间”，不能同时表示解析失败、尚未加载、全天或零时长。timed 保存 UTC
  时刻和 IANA 时区。

用户明确要求创建 Event 并提供日期和开始时间、但没有结束时间时，直接创建 start-only
scheduled Event：不追问、不套用默认时长、不写成 `start=end`，也不改存 Note。它正常
进入近期安排、Items 和 Calendar；Calendar 为可点击性使用的最小视觉尺寸只是展示事实，
不能写回 Canonical 数据。没有已知结束时间时，冲突判断不得擅自声明后续时间被占用。

用户明确要求创建 Event 并只提供日期、没有具体时间且没有表达全天时，直接创建 date-only
scheduled Event：不追问、不假设全天或午夜，也不改存 Note。它在 Calendar 对应日期和
Today 的“时间未指定”语义位置显示，不进入 timed 时间轴、不参与具体时间段冲突判断。
以后补充具体时间或明确改为全天时，在同一 item ID 上原子改变时间形态并递增 revision。
只修改标题或详情不能改变时间形态。

#### 6.2.2 创建和类型纠正

插件页面允许用户明确选择 Note、Todo 或 Event 手工创建。DSH 中只提供一个
Personal Organizer Skill：可执行动作创建 Todo，明确表达“某段时间有安排”时创建 Event，
其余内容直接创建 Note；“在某时提醒我做 X”属于带提醒的 Todo，“提醒我记住/保存一条信息”
属于带提醒的 Note。Skill 通过 Organizer Tool 写入同一套
Canonical 数据，不用本地关键词规则或第二个 Agent 旁路分类。

active Note 可以由用户在右侧抽屉明确改为 Todo 或 Event。修改不复制、不换 ID、
不删除旧记录，保留正文、标签、Reminder、来源、原始输入和类型变更历史，并要求用户
补齐目标类型的必要字段，因此搜索、历史和已有 `@Ref` 不会断。Skill 不在后台静默改变
已保存事项的类型；P0 不提供 Todo 与 Event 之间任意互转，避免含糊映射字段。

archived Note 必须先由用户显式恢复为 active，再单独执行 Note → Todo/Event；类型转换
不得隐式解除归档或合并成“恢复并转换”。恢复成功后，后续转换取消或失败不自动重新归档。
恢复和转换分别使用 expected revision 与幂等保护；恢复只恢复未来有效 Reminder，不补
归档期间错过触发。Note 专属生命周期事实只保留在历史中，不污染目标 kind 的业务状态。

Note → Event 只允许从 active Note 发起；archived Note 必须先显式恢复，不能在类型转换中
隐式解除归档。标题/正文映射为 Event 标题/详情，标签、来源、原始输入和已有 absolute
Reminder 保留，置顶只记入类型变更历史。用户必须明确选择 date-only/all-day/timed 并
提供目标形态的最低必要时间事实；UI 手工转换不得从正文推断日期、全天或持续时长，也不
重新解释已有 Reminder。转换保持同一 ID，并将 kind、时间、scheduled 状态和历史原子提交。

```text
Conversation 输入“下午那个记一下”
-> 无法明确判断完成语义或时间占用，创建 Note #A17
-> 用户在右侧抽屉选择“改为日程”
-> 补充开始时间；结束时间可以保持未指定
-> 仍是 item #A17，正文、提醒和类型变更历史保留
```

#### 6.2.3 页面和 Today

DSH 只注册一个“个人事项”全局入口，默认打开由近期 Event、全部未完成 Todo 和
默认收起的最近 Note 组成的精简工作面，不默认进入 Today，也不另建“概览”页。
Items、Today 和 Calendar 放在同一个查看入口；Reminder Center 在有待处理提醒或
通知异常时成为状态入口；Trash、导入和导出属于低频入口。详情、新建和编辑在桌面端
复用同一个单实例右侧抽屉，并保留原列表条件和浏览位置。P0 日历只做周视图和列表
视图；Today 已承担日视图，完整月历放到 P1。

Today 固定展示四组：逾期待办、今天待办、今天日程、今天提醒。用户可以手工
排序和固定，但 Today 排序属于单独的视图数据，不能偷偷改写 Todo priority。
今天的 date-only Event 属于“今天日程”，但稳定显示在“时间未指定”组或等价语义位置，
不按 00:00 排序，也不假装全天占用。

Today 不提供跨 Todo、Event 和 Reminder 的含糊通用“推迟”。Todo 提供完成、改日期和
打开，Event 提供改期、取消和打开，Reminder Occurrence 提供稍后提醒、忽略和打开关联
事项。“改日期/改期”进入统一右侧抽屉，由用户明确编辑 Canonical 时间事实；Todo 和
Event 不提供一键推到明天。snooze 只修改当前 Occurrence。所有动作 durable success 后
重新计算 Today 投影，不维护第二套分组状态。

```text
| 今天 · 8 月 25 日                    + 新建  搜索 |
|----------------------------------------------------|
| 逾期 2                                             |
| [ ] 提交报销                              昨天截止 |
|----------------------------------------------------|
| 今天的待办 3                                      |
| [ ] 完成方案                   [完成] [推迟] [...] |
|----------------------------------------------------|
| 日程                                               |
| 10:00 牙医                         10:00 - 11:00   |
|----------------------------------------------------|
| 今天提醒                                           |
| 15:00 给妈妈打电话                   [稍后提醒]   |
```

AI 对轻重缓急和排序的判断只作为主 Conversation 中的建议，不自动成为业务
事实；写入必须调用 Tool 并遵守审批策略。

#### 6.2.4 提醒闭环

每条内容可以有多个 Reminder Rule。P0 支持一次、每天、每周、每月、指定星期，
不支持 cron、完整 RRULE、复杂例外或重复 Todo/Event。

规则记录时区、本地时间、下一次 UTC 触发时间和是否启用；每次实际触发另有
Occurrence，记录 scheduled、fired、snoozed、dismissed、canceled、通知结果
和幂等键。这样“一条每天 8 点提醒”不会每天复制一份正文。

每次 Occurrence 使用 `ruleId + nominalFireAt + timezone` 生成稳定 occurrence ID；
启动、唤醒和 crash replay 都先检查这个 ID，已经 fired/dismissed/snoozed 的实例
不能再次投递。DST 调整保留 nominal local time 和 effective UTC time，方便解释和
去重。

```text
保存/修改事项和提醒规则
-> 同一数据库事务写入下一次调度事实
-> 调度器只等待最近一次到期
-> 到期生成一次 Occurrence
-> 写入应用内提醒中心
-> 有系统权限时再尝试系统通知
-> 打开 / 完成待办 / 稍后提醒
-> 幂等写回并安排下一次
```

- 系统通知只是投递渠道，权限被拒绝或 API 失败都不能删除 Canonical 提醒；
- date-only 或 all-day Event 本身不会自动创建 Reminder，也不会默认使用当天 00:00；
  Reminder 仍必须具有自己明确的提醒时间事实；
- 一条复合指令中 Event 信息完整但 Reminder 缺少可调度时刻时，先持久化 Event，再反馈
  “日程已添加，提醒尚未设置”并在同一 Conversation 追问。此时不创建 Reminder Rule、
  Occurrence 或“待补全提醒”状态，也不使用默认时间；用户未回答时 Event 保留且没有提醒；
- 用户补充明确时刻后，使用前一次 Tool Result 的稳定 item ID，在独立事务中把 Reminder
  Rule 附着到原 Event。只有附着成功后才能声称提醒已设置；附着失败不回滚 Event，重试
  只处理 Reminder 并使用自己的幂等键；Event 创建失败时不得继续创建 Reminder；
- 对 date-only 或 all-day Event，“提前一天”“当天”“前两天”等只确定相对日历日期、
  没有具体钟点的表达仍不具有可调度时刻，因此沿用上述部分成功与追问流程。任何 Reminder
  Rule 持久化时都必须已经解析为明确可调度的时间事实；不得以默认午夜、默认钟点、标题
  语义、未配置的用户偏好或调度器自行选择来补全用户未表达的时刻；
- 对具有明确 start 的 timed Event，未限定锚点的精确“提前 X”统一以 Event start 为
  锚点，interval 和 start-only 规则相同，end 是否存在不改变该语义。能够解析为未来明确
  时刻时直接持久化 Reminder Rule，不得再次追问等价的绝对钟点；分钟、小时按实际经过
  时间计算，“一天”按 Event 的 IANA 时区解释为前一个本地日历日期的相同本地钟点；
- 相对偏移在创建 Rule 时解析出的时刻已经过去或不再属于未来时，不创建 Rule 或
  Occurrence，不立即触发通知、不自动缩短偏移，也不引入宽限期；Event 已成功时保持
  Event 并明确反馈提醒未设置；
- Reminder 保留用户实际表达的语义：明确给出独立时刻的 absolute Reminder 在 Event
  改期后保持固定；基于 timed Event start 的 start-relative Reminder 保留相对关系并随
  start 确定性重算，不能只保留首次计算的绝对结果。Event 时间修改、受影响 Rule 重算和
  未来 Occurrence 更新作为一个 Canonical 原子业务修改提交；
- timed Event 改为 date-only/all-day 导致相对 Rule 失去 start 锚点，或新 start 使重算
  结果已经过去时，不提交本次 Event 时间修改，要求用户先删除或重新设置相关 Reminder。
  不得静默删除、固化旧绝对结果、改成午夜、缩短偏移或立即补发；revision conflict 和
  Canonical 失败不得部分提交。系统通知重新注册失败作为下游渠道失败独立重试，不回滚
  已经成功的 Event、Rule 和 Occurrence；
- 应用关闭后若当前平台不能保证系统级调度，界面必须如实说明，不假装能提醒；
- 启动、系统睡眠/崩溃恢复时，从数据库重新扫描并按错过提醒规则处理，不依赖旧
  内存 Timer；用户主动停用插件或暂停后台任务已经明确放弃这段时间的提醒，恢复
  后只安排未来触发，不补停用期间的提醒；
- 错过一次性提醒时只补一次并显示晚了多久；
- 睡眠跨过很多重复提醒时只处理最近一次，记录跳过次数，不能连弹几十次；
- 重复提醒固定使用创建时的 IANA 时区和本地墙钟时间，设备换时区不偷改规则；
- 春季 DST 不存在的时刻顺延到第一个有效时刻；秋季重复小时只触发一次；
- “每月 31 日”遇到没有 31 日的月份直接跳过，不偷偷改成月底；
- 事项进 Trash、Note 归档、Todo 完成/取消或 Event 取消后暂停未来提醒；恢复到
  active/planned/scheduled 时只安排未来提醒，不补暂停期间的旧提醒；
- snooze 把当前 Occurrence 标为 snoozed，并用“原 Occurrence ID + 新时间”幂等
  创建或更新恰好一个派生触发；原重复 Rule 的下一次正常触发不被改写；
- 后台暂停时明确显示“暂停期间不会提醒你”。

提醒中心原型：

```text
| 提醒中心                         待处理 | 即将到来 |
|----------------------------------------------------|
| 系统通知未授权                                     |
| 提醒仍保存在这里，应用关闭时不会弹系统通知。       |
|----------------------------------------------------|
| 给妈妈打电话 · 今天 15:00 · 待办                  |
| [打开] [稍后 10 分钟] [忽略]                      |
|----------------------------------------------------|
| 喝水 · 每天 16:00 · 笔记                          |
| 下一次 今天 16:00                  [稍后提醒]      |
```

#### 6.2.5 搜索和 DSH AI

插件本地全文搜索覆盖标题、正文、清单、标签、地点和原始输入，可按类型、
状态、日期和标签筛选；默认不依赖 Embedding。中文/CJK 分词必须用真实语料验证，
不能假定英文 FTS 配置已经够用。

向 Core Federated Search 只返回安全的 title、snippet、time 和 opaque ref，选中
后打开 Canonical 详情。外部文件引用不可用时显示“当前不可打开”，不影响事项
阅读、修改、完成、搜索或提醒。

Organizer Local Search 与 Organizer Federated Search Provider 共享同一 Canonical 检索
语义和索引能力，但承担不同工作：前者在插件内提供业务筛选和连续处理，后者只通过安全
契约参与跨来源定位。Federated query 不自动变为插件本地查询。点击全局事项结果后进入
Organizer 真实工作面并打开同一抽屉；关闭抽屉留在 Organizer，用户明确返回时 Core 恢复
当前瞬时 Search session 的 query、Provider 状态和列表位置，不把这些内容持久化。

有明确 query 时，两个普通搜索入口默认覆盖所有非 Trash Organizer item，包括 archived、
completed 和 canceled 终态；终态必须在既有安全展示契约内明确标记。Trash 不进入普通
Local/Federated scope，只在 Trash 管理入口内单独搜索。可恢复 Trash item 可以继续存在于
插件本地索引，由 query-time scope 隔离；永久删除才清理对应索引和派生搜索数据。

Organizer Search result 的 primary time 使用类型自己的语义并带标签：Note 用 updated_at，
Todo 用 due > start > updated_at，Event 用原 start/date；终态只改变状态和“原定”语义，不
用 completed/canceled/archived 时间替换业务身份。默认组内排序以文本相关性为主，当前状态
和 updated_at 只做 tie-break，不用互不可比的跨类型业务日期排序。date-only/all-day 不得
伪造成午夜 timestamp。

AI 只能在真实 DSH Conversation 中工作：

- `@` 选择 Note/Todo/Event，`resource_read` 读取 AI-safe
  projection；
- P0 Tool 为 create、update、complete、cancel、archive、snooze、dismiss、search、
  list_today、trash、restore、purge；结构化正文没有第二个 `read` 旁路，只能通过
  Core `resource_read`；
- create/update 可以一起新增、修改或取消 Reminder Rule，不拆成大量微型 Tool；
- search/list_today 只返回有界安全元数据和可供用户明确选择的 opaque ref，不
  返回正文，也不因此签发本轮读取权；
- complete 只用于 Todo，cancel 用于 Todo/Event，archive 只用于 Note，
  snooze/dismiss 只操作某次提醒；
- 所有写操作带 expected revision。UI 或另一次 AI 已更新时，返回冲突和最新安全
  版本，不能后写覆盖前写；
- AI 永久删除、批量写入和以后可能出现的重复实例批量操作必须正式审批；
- 用户在插件页面主动永久删除时使用明确的本地危险确认，不必为了手工 UI 操作
  强行启动 Conversation。

#### 6.2.6 删除、导入导出和插件停用

- 移到 Trash 时写 `deleted_at` 并暂停提醒；可恢复原业务状态；
- 30 天后只提示用户清理，不静默永久删除；永久删除单独确认并原子清掉提醒；
- JSON 是唯一无损导入导出格式，必须包含 `schemaVersion`，round-trip 覆盖稳定
  ID、revision、kind、来源/原始输入、类型变更历史、标签、Checklist、Reminder
  Rule/Occurrence、Event 未指定结束时间、Trash 和 opaque ref；Todo CSV 和 Event ICS
  只是互操作格式，界面明确哪些信息会丢失；
- ICS P0 只处理普通非重复 VEVENT，遇到 RRULE、RECURRENCE-ID 等不支持内容
  必须在预览中拦住，不能悄悄只导入第一条；
- ICS 的 `VALUE=DATE` 按来源语义导入为 all-day，不自动解释成 Hermit date-only；目标
  格式无法无损表达 date-only 时，导出预览必须明确拦住或要求用户处理，不能静默改成
  all-day 或当天 00:00；
- ICS 标题中的 `Vacation`、`Holiday`、`Travel` 等内容词不得改写来源的时间形态；Hermit
  all-day 按标准日期范围和 exclusive end 导出，date-only 仍按上条无损边界处理；
- 导入先进入临时区预览和去重，再整批事务提交。任何一条失败时整批不落库；
- JSON 用稳定 ID 去重，ICS 优先 UID，CSV 只提示可能重复，不按相似标题自动覆盖；
- 数据库存放在稳定的插件数据目录，不在插件安装目录。停用/卸载保留数据库，
  重装后重新扫描到期和下一次提醒。

#### 6.2.7 复用、借鉴和自研

调研结论：目前没有同时满足“收藏多、持续维护、完整业务闭环、适合 DSH/React
边界”的社区 Personal Organizer 插件，可以直接作为底座。

Star 只作为初筛信号，不是可信或兼容证明。所有直接依赖仍需锁精确 version/commit、
生成 SBOM、归档许可证并通过三平台测试；GPL/AGPL 项只允许行为级研究，复制源码
或测试样本必须另做许可证审查。

直接复用候选：

- FullCalendar Standard：约 20k 星、MIT，只复用 React 周视图、列表视图和日期
  导航，不引入 Premium；
- date-fns：约 36k 星、MIT，只处理日期运算和格式化，不替产品定义提醒规则；
- better-sqlite3：约 7k 星、MIT、要求 Node 22+，只在 Host 侧使用；进入正式
  依赖前必须通过 Windows/macOS/Linux 及 x64/arm64 原生安装和升级测试；
- SQLite FTS5：复用数据库全文检索能力，另做中文检索质量门禁。

只借鉴，不直接依赖：

- Super Productivity：约 19k 星、MIT，借鉴 Today、任务详情和提醒交互；它是
  Angular/Electron 完整应用，不硬接进 DSH；
- Tasks.org：约 5k 星、GPL-3.0，借鉴任务和提醒行为，许可证及 Kotlin 技术栈
  不适合作为运行依赖；
- Vikunja：约 5k 星、AGPL、Go/Vue，借鉴筛选、导入和数据模型，不引入其服务；
- node-schedule、node-cron、rrule.js、ical-generator：只借鉴时间边界和测试
  用例，不把进程内 Timer、cron 或完整 RRULE 当成业务底座；
- 当前 DSH 社区 Todo/Notification 插件收藏和验证时间不足，只借鉴 DSH 注册、
  UI Slot 和通知接线方法，不直接安装到正式产品。

自研：Item/Note/Todo/Event 模型、提醒规则与触发记录、调度恢复、DST 规则、
Today、保持同一 ID 的 Note 类型纠正、revision 冲突、DSH Resource/Tool 适配、通知幂等、FTS
查询、导入预览、Trash/恢复/永久删除和安全审计。DSH API 仍处开发预览期，这些
业务层不得直接 import DSH 私有 UI，只通过可替换 adapter 连接。

### 6.3 File Workspace

当前方向和模块 5 文件业务闭环：已确认。

核心价值：通过 Hermit Product Surface 提供一套不依赖 AI 的轻量文件工作台。File
Workspace 在中央工作面内拥有 logical FileRecord tree、managed 文件、Markdown 编辑状态、
搜索与数据生命周期，不再建设独立文件库壳、文件详情页或预览系统。

File Workspace 的功能、页面、交互和当前 vertical slice 以
[File Workspace DESIGN](../../plugins/file-workspace/DESIGN.md)为唯一权威来源。本节只保留
产品范围、跨域契约、数据边界和验收红线；重复描述若与插件 DESIGN 冲突，插件可见行为
以 DESIGN 为准，Core 授权、安全和生命周期红线仍以本文为准。

#### 6.3.1 文件归属和组织边界

内部长期保留 external 和 managed 两种模式，但界面不把内部术语丢给普通用户：

- “复制到 Hermit”创建独立 managed 副本，由 Hermit 持有 ManagedBlob、revision 和
  完整数据生命周期；之后原文件移动或删除不影响该副本；
- “保留原位置”创建 external FileRecord 和私密 SecretLocator，不复制正文；外部原文件
  属于用户或其他系统，Hermit 不因导入、组织、Trash、卸载或清理而改名、移动或删除；
- 两种模式都是长期产品语义，不能为了界面简单把 external path、managed 存储和
  FileRecord 合并成同一种数据，也不能用 content hash 代替稳定文件身份。

| 对象 | 是否不可替代 | 说明 |
|---|---|---|
| 外部原文件 | 是，但由用户/外部系统拥有 | Hermit 永不替用户删除 |
| ManagedBlob | 是，由 File Workspace 拥有 | 用户明确复制进来的文件内容 |
| FileRecord | 是 | 稳定 ID、显示名、状态和 revision |
| SecretLocator | 是，属于私密定位层 | 绝对路径、书签、卷/文件身份和权限 |
| Safe AI text projection | 否 | 从已保存 revision 临时生成的只读 UTF-8 材料 |
| 文件正文搜索派生物 | 否 | 由 Core Federated Search 契约管理，可重新生成 |

SecretLocator 绝不能进入文件树、搜索结果、普通日志、遥测、AI Tool Result 或 Resource
Picker 候选。首版工作区只提供根层普通文件夹，不支持嵌套、文件夹移动或文件夹 Trash；
它们只是 Hermit 的组织关系，不代表 external 文件的真实磁盘父目录。同一工作区文件夹
可以容纳 managed 和既有 external FileRecord。改变工作区组织关系不能据此操作 external
原文件。

访问、解析和索引仍是分开的事实，但 P0 不把 missing、permission denied、password
required、unsupported、parse failed、stale 或 external changed 做成文件树常驻徽标，
也不建设 Needs Attention 页面；只有打开、保存、“在对话中使用”等相关动作发生时才显示
具体原因。路径、FileRecord、ManagedBlob、解析文本、projection、搜索派生物和 revision
不能混成一个状态对象。

#### 6.3.2 单一工作面和快速记事

P0 只有一个“文件工作区”插件入口。内部使用左侧统一文件树和右侧当前文件编辑/查看区；
快速记事、添加文件、搜索、导入进度、结果和 Trash 都是该工作面中的动作或状态，不增加
Library、Dashboard、独立快速记事页、文件详情页、安全预览页或 Needs Attention 页面。

```text
DSH Conversation
-> 打开 File Workspace Product Surface
   |-- 统一文件树
   `-- 当前文件编辑区或通用文件信息区
-> 关闭后返回 DSH Conversation
```

“快速记事”原子创建一个 managed Markdown 和稳定 FileRecord，然后立即在同一个 Product
Surface 中打开。它不是 Organizer Note，也不保存第二份正文。快速记事和其他 File Workspace
文件不属于任何 Session；Session 只提供打开 Product Surface 和使用 `@文件` 的对话上下文。
新建快速记事的正文必须是空字符串；系统生成的文件名属于 metadata，不能把标题、模板、
提示或示例文字写进正文。

File Workspace 只有一个工作区状态和一个中央宿主。从产品入口或全局快捷键进入时都打开
同一个 Product Surface，不注册辅助栏工作面，也不维护 promotion、双宿主同步或两份草稿。
全局快捷键属于 Core/Desktop；首版不要求 File Workspace 自行控制 DSH 其他侧栏。以后若
需要专注布局，只能扩展公开 DSH/Hermit seam，不能使用私有 Router、DOM/CSS hack、private
store 或复制 DSH shell。

- 打开 File Workspace 恢复整个工作区上次打开的 FileRecord；文件树“+”显式创建一条正文
  为空的新快速记事，不保留第二个“继续上一条”入口；
- 新文件固定进入根层级唯一的“快速记事”文件夹；不提供修改默认目标的设置；
- 固定文件夹本身不可重命名、移动、移到 Trash 或永久删除，空时也保留；菜单直接不提供
  不适用命令，不增加锁图标、提示条或管理页；
- 其中的文件仍是普通 managed Markdown，可以移动、移到 Trash、恢复和永久删除。移动后
  保持 FileRecord；首版不提供文件或文件夹重命名、文件夹嵌套或文件夹移动。

#### 6.3.3 添加现有文件

“添加文件”允许一次多选任意普通文件，但 P0 不接受文件夹、不递归扫描目录，也不为未来
批量迁移预建目录保留和大任务系统。P0 界面只提供 managed copy；external 是长期数据语义，
用户入口待可信路径、SecretLocator 和写回契约通过资格验证后再增加：

```text
选择一个或多个文件
-> 显示数量、名称和当前目标文件夹
-> 直接说明“复制到 Hermit”，不显示尚不可用的归属选择
-> 复制默认进入用户当前所在工作区文件夹，根目录发起则进入根目录
-> 用户可在同一个确认界面就地更改目标，不强制增加目标选择步骤
-> 预检来源可读、普通文件身份、可靠元数据、目标有效性、真实容量约束和同名冲突
-> 不声称已经验证文件安全、格式有效、可解析或可预览
-> 用户确认后，当前确认框原地切换为进度窗口
-> 完成后原地显示结果摘要，关闭后定位目标文件夹但不自动打开文件
```

- 同名冲突只提供“替换”和“跳过”，不自动覆盖、跳过、改名或保留两份；替换在现有
  FileRecord 上写入新 revision，不删除旧记录再新建；
- 多个冲突逐项处理，可把当前选择应用到其余冲突，并提供“全部跳过”；跳过冲突不取消
  没有冲突的文件；
- 用户取消只停止尚未处理的文件，已完整提交的结果保留；单个文件必须完整提交或不产生
  可见结果，不能留下半个 ManagedBlob、半个 FileRecord 或半个 revision；
- 结果摘要分别统计完成、跳过、失败和未处理，默认只展开需要关注的项目；只允许重试
  失败项，不建设后台任务中心或长期导入报告页；
- “复制到 Hermit”与“保留原位置”都不能绕过 File Workspace 领域服务写任意 path。

#### 6.3.4 编辑、保存和操作时状态

P0 接受并管理任意普通文件，但格式能力必须如实区分：Markdown 直接编辑真实原文，格式
操作只帮助插入 Markdown 语法；没有经过资格验证的 Editor 或 Viewer 的格式只显示名称、
类型、大小、managed 状态、可靠时间和 projection 可用性，并明确说明当前不能在 Hermit 中
预览或编辑。当前不扩展 OCR、PDF/Office 全格式解析、富文本副本或复杂 Viewer 体系。

- 具备编辑能力的 managed 文件输入后自动保存，显示“正在保存 / 已保存 / 保存失败”；保存
  产生 revision。没有编辑能力的 managed 文件只显示已存入 Hermit，不出现保存状态；
- managed 保存必须携带稳定 FileRecord 身份和编辑基于的 revision；成功时在同一 FileRecord
  下创建新的 immutable revision 并建立新的编辑基线，旧基线冲突或持久化失败时不得覆盖
  当前 revision，也不得丢弃用户尚未保存的正文；
- external 文件编辑后显示“未保存”，只在用户明确保存且 source fingerprint 未冲突时写回；
- external 有未保存修改时切换文件或关闭工作面，询问“保存 / 不保存 / 取消”；保存失败
  或发现外部变化时留在当前文件；
- external 保存前发现原文件已被其他程序修改，只提供“重新加载原文件 / 留在这里 /
  复制到 Hermit”，不强制覆盖或自动合并；
- managed 自动保存失败时离开当前文件，询问“重试保存 / 留在这里 / 放弃修改”；放弃
  恢复最后一次成功 revision，不把失败内容藏成离开后再恢复的草稿；
- 当前文件将被 Trash/移除时复用同一离开保护，不能静默丢弃未保存内容；
- missing、permission denied、password required、unsupported、parse failed、stale 等
  只在用户执行相关动作时显示原因，不长期占据文件树或单独页面。

#### 6.3.5 本地搜索和 Core Federated Search

File Workspace 工作面内的搜索只按文件夹名和文件名过滤当前统一文件树；结果临时替换
左侧树，清空或退出后恢复原树和展开状态。P0 不增加正文搜索栏、独立结果页、第三栏或
File Workspace 自有正文索引。

文件正文与跨插件检索由 Core Federated Search 统一查询、排序和聚合。当前 File Workspace
切片不为此提前实现 parser、chunk、BM25 或全格式 locator；文件正文如何形成安全的可搜索
材料属于 Federated Search 与 File Workspace 后续契约，未完成前该来源可以不提供正文结果，
不能用文件名命中冒充正文命中，也不能让 Core 取得 FileRecord 或 ManagedBlob 所有权。

#### 6.3.6 `@文件` 和安全 projection

“在对话中使用”只向当前 DSH Composer 插入一个可移除的 `@文件` 引用，不自动发送，也
不复制完整正文。File Workspace 文件仍是全局文件，不因引用变成 Session 附件。

```text
用户选择文件“在对话中使用”
-> 从最后一次成功保存的 revision 生成一次安全 projection
-> 未保存修改、正在保存或保存失败的内容不进入 projection，也不触发等待或保存
-> projection 不可用时不插入，并说明 password required / unsupported / parse failed
-> 插入携带 projection 身份的可移除 @文件引用
-> 用户补充问题并发送，Core 才签发本轮只读 grant
-> 模型显式调用官方 read，读取选择时捕获的 projection
-> 发送或 read 时不重新读取最新文件
-> 只有用户移除并重新指定文件，才生成新的 projection
```

文件从未成功保存时没有可用 projection，不能退化为空引用、仅文件名引用或 external 原
文件直传。来源 revision 可用于追溯，但不增加用户可见的“锁定”功能。成功 read 的 durable
Tool Result 记录模型实际看到的 projection 和 observed revision；之后文件变化不能改写旧
Session 历史。P0 不向模型开放文件导入、修改、移动、Trash、恢复、永久删除或任意路径操作。

#### 6.3.7 删除、移除和恢复

File Workspace 使用 Hermit 自己的轻量 Trash，不接入 OS Trash。Trash 是统一文件树底部
的特殊折叠节点，不是独立页面、普通文件夹或添加/移动目标。

- managed 文件使用“移到废纸篓”，不再次确认；保留 FileRecord、ManagedBlob、revision、
  原名称和原工作区父位置，恢复前不可编辑，也不参与正常树、文件名搜索或新的 `@文件`
  选择；
- 普通根层文件夹不进入 Trash；只允许直接删除空文件夹，非空时要求先移动或处理其中的
  文件。固定“快速记事”文件夹不可删除；
- 单个 external 文件不进入 Trash，只提供“从工作区移除…”；确认必须写明磁盘原文件不会
  被修改或删除，确认后永久移除 Hermit FileRecord、工作区关系和自有派生数据；
- 恢复优先回原工作区父位置；原父位置不存在时回根目录；目标同名时生成带“（已恢复）”
  的唯一名称，继续冲突再追加数字，不覆盖、不复用导入的替换/跳过对话；
- Trash 项目提供“永久删除…”，节点提供“清空废纸篓…”，都必须明确确认不可恢复；
  managed 删除 Hermit 原件和自有派生数据；
- P0 不做文件夹 Trash、独立 Trash 页面、自动清理、保留期限、后台清理、批量恢复、恢复
  位置选择、全局 Undo 或 OS Trash 集成。

固定“快速记事”文件夹本身不适用 Trash；保护只作用于容器，不保护其中的普通文件。

#### 6.3.8 宿主生命周期和首版 vertical slices

File Workspace 只在 `productSurfaceContract === 1` 和 `product.surface` capability 可用时
进入 ACTIVE。契约缺失或不兼容时不创建 Settings、辅助栏或私有 Router 作为替代入口，但
Core、Conversation、其他插件及既有 FileRecord/ManagedBlob 继续可用或保留。

停用或卸载 File Workspace 只撤产品入口、工作面、Provider 和能力注册；除非用户明确选择
删除数据，否则不删除 FileRecord、ManagedBlob 或 revision。

首版按三个可独立验收的切片推进：

```text
Slice 1：任意普通文件 managed copy
-> 多选或拖放普通文件
-> 创建 FileRecord、ManagedBlob 和首个 revision
-> 文件树组织、名称搜索、Trash、恢复和永久删除
-> Markdown 之外的格式显示通用文件信息

Slice 2：managed Markdown 创建、编辑、revision-aware save 和关闭重开

Slice 3：从最后成功 revision 生成安全 projection 并插入 @文件
```

“支持所有文件”只承诺 Slice 1 的纳管和生命周期，不承诺所有格式都能编辑、预览、解析或
用于 AI。当前添加入口只展示“复制到 Hermit”，不接受文件夹；“保留原位置”只有在可信
路径、SecretLocator 和 external 写回契约通过资格验证后才进入界面，但 external 长期语义
继续保留。

#### 6.3.9 复用和实现前置条件

DSH/Hermit Product Surface 只负责中央工作面宿主和生命周期。logical FileRecord tree、当前
文件、FileRecord、SecretLocator、ManagedBlob、revision、Trash、添加流程和 projection
仍由 File Workspace 拥有；不能把宿主 UI state、Session `cwd + path` 或 Product Surface
metadata 当成长期文件领域模型。

File Workspace 只消费资格通过的公开 package、typed slot 和 service，不导入 DSH `src/*`、
内部 store、DOM/CSS 或私有 Host 路由。managed 内容只能通过 File Workspace/Core 的领域
服务持久化；不得用私有路由、伪造 path、轮询、watcher 或 fallback 掩盖保存边界。

当前阶段不冻结 parser、OCR、Office、云盘、正文索引或复杂文件管理依赖。需要新增能力时
先回到 File Workspace DESIGN 和对应 Core 契约确认真实场景，再资格验证成熟开源实现，
不能把早期候选库或社区 File/KB 插件直接写成 P0 运行底座。

### 6.4 Smart Clipboard

当前方向和模块 6 完整业务闭环：已确认。它是后续可选 Product Plugin。

Smart Clipboard 的功能、页面、交互、用户可调默认值和数据操作细节只由
[Smart Clipboard DESIGN](../../plugins/smart-clipboard/DESIGN.md)维护。本节只保留
产品范围、跨域安全、Core 集成、平台能力和验收红线；重复描述若与插件设计冲突，插件
行为以 DESIGN 为准，Core 红线仍以本文为准。

核心价值：安装后就是一套 Maccy 风格的本地剪贴板管理器。没有 AI、网络、
Organizer 或 File Workspace 时，捕获、搜索、置顶、预览、复制/粘贴、清理和
导出仍然完整。

#### 6.4.1 捕获启动和范围

插件安装并进入 ACTIVE 后立即开始记录，不再增加首次隐私说明或“开始记录”门槛。
安装并启用插件本身就是用户选择使用剪贴板历史的动作；用户仍可随时暂停记录，
或只忽略下一次复制：

```text
插件 ACTIVE
-> 监听当前平台支持的剪贴板变化
-> 规范化受支持内容并写入本地历史
-> 用户暂停时停止接收新记录
-> 用户继续后只记录新的变化，不回补暂停期间内容
```

- 暂停、停用或崩溃期间不记录，也不伪造回补系统已经丢失的剪贴板历史；
- “忽略下一次复制”只消费下一次真实剪贴板变化，不能持续关闭记录；
- 捕获、存储、索引、搜索和历史管理没有网络能力，不主动上传剪贴板内容；
- 后续 AI 只有在用户明确选择内容并发起动作后，才通过 DSH 处理所选范围。

P0 Canonical 格式只有 TEXT、IMAGE、FILE_LIST：

- TEXT 保存精确 UTF-8，并可保留实现格式化回放所需的受支持 HTML/RTF 表示；搜索和
  预览只使用安全纯文本投影，HTML/RTF 不进入 DOM、不执行脚本、事件或远程请求；
- “无格式粘贴”只写回纯文本，普通复制/粘贴可写回受支持的格式表示；
- IMAGE 接受 PNG/JPEG/WebP 用户语义及 TIFF/DIB 等系统输入，安全解码、应用
  orientation、去除 metadata 后建议统一存 PNG；
- FILE_LIST 只保存本机文件引用和安全显示名，不读取、复制或索引文件正文；
- 未知/custom body、虚拟文件 promise、远程 URL 文件和任意序列化对象不保存。

文件引用以后若要让 AI 读正文，必须重新走 File Workspace 的独立授权，不能
因为路径曾出现在 Clipboard 就自动扩大权限。

#### 6.4.2 数据、忽略规则和去重

ClipboardEntry 保存稳定 ID、kind、payload/blob 引用、content hash、创建/最近
使用时间、稳定 source app ID、来源可信度、输入格式、置顶/删除时间、大小、
payload version。source executable path 和 window title 不持久化，也不进 FTS、
日志或 AI。

Smart Clipboard 不做密码、验证码、身份证或 Secret 的内容启发式分类，也不提供
`MASKED/Reveal` 状态。忽略规则只来自明确的剪贴板信号和用户配置：

- 系统或来源应用提供的 transient、concealed、auto-generated 或等价 exclusion
  marker 直接跳过，不创建 Entry；
- 用户可以暂停、忽略下一次复制，并在后续完整管理阶段配置排除应用或类型；
- source app 只作 best effort 筛选和显示，不参与内容是否可信的语义判断。

去重规则：

- 同一次系统事件的 plain/HTML/RTF 合成一条 TEXT；
- TEXT 按原文 UTF-8 bytes hash，不 trim、lowercase、Unicode normalize 或改换行；
- IMAGE 按规范化后的像素 hash，让同一张图的 TIFF/PNG 容器可以合并；
- FILE_LIST 按有顺序的本地引用列表 hash，顺序不同就是不同记录；
- 不同 kind 永不合并；
- 命中重复时保留 ID、created 和 pinned，只更新 last_used 和最近来源；
- “编辑文本副本”创建新 Entry 和新 ID，不能悄悄改旧内容和已有 AI 引用。

#### 6.4.3 列表、搜索、复制和粘贴

- 插件自己的 SQLite/FTS 搜索文本和文件显示名；图片按类型、时间、来源筛选，
  不做 OCR；
- P0 不注册 Core Federated Search Provider，剪贴板检索留在插件自己的快速取回和
  完整 History 工作面，不把历史复制到 Core 总索引；
- Smart Clipboard 通过 Core Shortcut Registry 提交专用快捷键建议；用户确认并注册后，
  该快捷键直接呼出剪贴板快速取回工作面，不打开 DSH 主窗口或要求切换 Quick Panel 模式；
- 打开后搜索框立即聚焦；无查询时显示置顶和最近历史，输入后本地实时过滤，键盘选择
  并执行当前项后关闭浮层、把焦点还给原应用；
- 目标体验保持输入即搜索、键盘选择、复制、显式粘贴和纯文本复制；默认 Enter/普通左键
  只复制，Mod+Enter 或 Option/Alt+左键才明确请求粘贴。浮层内部固定组合的动作映射由
  插件 DESIGN 负责，Core 只负责用户确认的全局唤起快捷键；右键只打开已有类型预览，
  不执行内容动作；
- 可靠的 Canonical 操作只是“把选择项写回系统剪贴板”；
- 显式粘贴仅在平台支持且用户给了最小辅助功能权限时执行：打开 Panel 前记住前台
  目标，写 clipboard 后验证 generation/marker 未被其他程序覆盖，再恢复焦点和模拟粘贴；
- 没权限、目标失效、Windows UIPI、Wayland 或远程桌面限制、剪贴板被覆盖时，
  立即降级为“已复制，请手动粘贴”，不提权、不反复抢写、不发送可能错误的按键。

插件自写回避使用三层保护：私有 clipboard format 中的随机 operation token、
平台 marker/generation、短时间 hash fallback。读取多个 format 期间 generation
变化时丢弃快照，不能把两个复制事件拼成一条。

#### 6.4.4 单条内容交给 DSH

普通复制、粘贴、搜索和置顶不调用 AI。只有用户在某条记录上点“在对话中使用”
后，才创建只含稳定 ClipboardEntry identity 的 Ref 和可撤销 pending selection。
用户真正提交含该 `@` 的消息时，Core 才签发绑定 session、turn、entry version/hash、
expiry、maxReads=1 的 grant；这些运行约束不写进 Ref。成功 Tool Result 再记录
实际 observed payload version/hash。

```text
选择一条 -> 在对话中使用
-> 告知会话历史保存规则
-> 打开主 DSH Conversation 并插入 @ClipboardItem
-> 不自动发送
-> 用户发送
-> 模型显式 resource_read
-> 校验当前 Session/本轮/版本/读取次数
-> 只返回这一条
-> 成功 Tool Result 写入本会话历史
```

固定告知用大白话：

> 只允许当前会话、本轮读取这 1 条。发送后，如果模型读取成功，这条内容会保存
> 到当前会话历史。以后删除剪贴板记录，不会删除会话里已经保存的内容。

读取前移除 `@`、删除 Entry、换 Session 或换 turn 会撤销引用，正文不会
进入 Tool Result。读取成功后只能取消以后继续访问，不能把它称为撤销已经产生的
Session 内容。删除 ClipboardEntry 和清理 DSH Session 是两个不同的数据域。

Clipboard Resource 不能 list、search 或批量读取 History。图片 P0 不 OCR；文件
引用只返回安全显示名和必要元数据，不读文件正文。要读取文件正文必须重新经过
Core-owned AI filesystem capability/broker 和 File Workspace（若已安装）的安全
projection；File Workspace 缺失时只显示引用不可用，不影响 Clipboard 其他能力。
图片只允许返回经过 Core/Clipboard bridge 校验、去 metadata、限大小的规范化
payload，不能把原始自定义 clipboard format 直接交给模型。

#### 6.4.5 保留、删除、导出和静态保护

历史条数、保留期限、总容量、Trash、清空和结构化 ZIP 导出的当前用户规则只在插件
DESIGN 中维护。Core 仍执行以下不可放宽的技术硬上限：文本/投影文本单条 2 MiB，图片
编码 20 MiB/32 MP/临时解码 128 MiB，单次 256 个文件引用且 manifest 不超过 1 MiB。

- 永久删除必须原子清理 DB、FTS 和无引用 blob；
- 导出文件是用户明确写入本地的普通未加密文件，不得借导出增加网络 capability；
- 所有删除界面写明：不会删除其他应用中的副本，也不会删除已经进入 DSH Session
  的 Tool Result；
- 停用/卸载默认保留数据库和 blob；插件 DESIGN 中的“清空所有剪贴板内容”是独立
  危险入口，不能与停用或卸载静默绑定。

P0 不自建 SQLCipher/envelope encryption，也不把它称为 Vault；否则会提前引入
密钥恢复、轮换、FTS 和明文迁移。基础保护为：DB/WAL/SHM/blob/temp 全部在 OS
用户私有 app-data 并使用严格 ACL/mode；正文不进普通日志、遥测或 crash breadcrumb；
清理时同时清 FTS/blob 并 checkpoint/truncate WAL。Schema 预留未来
`encryption_version/key_id`，但不能宣称 SSD/备份层面的法证擦除。

#### 6.4.6 平台桥接和故障隔离

ClipboardBridge 只有 observe、snapshot、write、sourceIdentity、autoPaste 五类能力；
无网络、无任意文件读取、无 shell、无命令执行。平台监听/写入/显式粘贴运行在最小权限
平台 bridge。当前 macOS bridge 是 Electron 主进程专用的
Objective-C++ N-API micro-adapter，UI、DB、FTS 和状态编排仍由 TypeScript Core/插件负责；
业务异常只让 Clipboard 进入 unavailable，native 内存故障仍可能终止 Electron，因此不能
宣称进程隔离。若真实稳定性证据不足，再评估独立 helper，不为假设风险提前增加第二进程。

- macOS：完整捕获；未授权 Accessibility 时，用户明确请求的粘贴降为 copy-only；
- Windows：使用官方 change listener/sequence；无法恢复前台或 UIPI 阻止输入时
  copy-only，绝不要求管理员权限；
- Linux X11/XWayland：按实际 clipboard ownership 能力实现；
- 纯 Wayland 有 data-control 才启用后台捕获，没有就明确显示“当前桌面不支持历史
  捕获”，仍提供能实现的复制功能，不假装完整支持；
- 远程桌面/VM 的来源归属和显式粘贴都是 best effort，默认偏向 copy-only。

#### 6.4.7 复用、二开和自研

Maccy 当前约 21k 星、MIT、持续维护，符合可信行为参考门槛。当前实现依据 Apple 公开
AppKit/Accessibility contract 和 Maccy 已核实的行为证据，以 Objective-C++ clean-room
自研 NSPasteboard changeCount、忽略 marker、多文件写回、operation token、目标身份和最小
Command+V 守卫；没有复制或改写 Maccy 源码。调研保留精确来源链接，但第一方 native 文件
不冒充 Maccy 衍生代码，也不添加虚假的源码 attribution。

不复用 Maccy 整个 App、CoreData、HistoryItem、Tray、快捷键、UI、设置和更新器，
避免出现第二套产品 ownership。

其他候选：

- Rust arboard：MIT/Apache-2.0、持续维护，适合封装跨平台 text/image/HTML/
  file-list 基本 get/set；Windows 事件、macOS marker/来源、race 和显式粘贴
  仍由平台 adapter 自研；
- EcoPaste：约 7k 星、Apache-2.0、Tauri/Rust，借鉴/逐文件审计后二开平台 glue、
  SQLite/FTS、retention 和恶意格式测试，不嵌入整套 App；
- CopyQ：约 12k 星、维护活跃但 GPL-3.0，只作跨平台行为和异常测试参考，不进入
  Hermit 非 GPL 运行依赖或复制代码；
- DSH Desktop 社区项目只借鉴“DSH 掌管 Session/Tool，桌面壳掌管原生权限”的
  边界。目前没有成熟、高收藏、维护活跃且边界合适的 DSH clipboard 插件可直接用。

自研：版本化 ClipboardBridge contract、Windows/macOS/Linux adapter 补充逻辑、
generation-consistent snapshot、Canonical DB/blob/FTS、排除规则、quota、一次性 AI
Resource、DSH UI、生命周期和崩溃隔离。

P0 明确不做同步、云、共享、Vault、OCR、AI 自动处理、脚本、命令、自动填表、
任意 custom clipboard body replay 或 clipboard-trigger automation。

### 6.5 Federated Search

当前方向和模块 5 搜索闭环：已确认。它是 Core Host，不是独立 Product Plugin，
也不成为新的数据主人。

```text
| 搜索 [ quarterly revenue                         ] |
|----------------------------------------------------|
| 文件 · 6                                          |
| Q3 Report.md    ...revenue increased...  第 42 行 |
| Budget notes.txt ...Revenue / Q3...      第 18 行 |
|                                   [更多文件结果]  |
|----------------------------------------------------|
| 对话 · 7                                          |
| Q3 planning discussion                  8 月 18 日 |
|----------------------------------------------------|
| 个人事务                                           |
| 查询超时                                  [重试]  |
```

- 同一个关键词并行发送给当前 ACTIVE 的 Conversation、Organizer、File 及后续
  Search Provider；未安装的 Provider 整组不出现；
- File Workspace 自己的工作面搜索只过滤文件夹名和文件名，不参与正文检索。文件正文
  查询、排序和跨插件聚合只从 Core Federated Search 发起；File Workspace 只按后续确认的
  契约提供安全的当前材料和打开引用，不因此把 FileRecord、ManagedBlob 或 SecretLocator
  所有权交给 Core；
- File Workspace 首条 Markdown 切片未提供正文检索材料时，文件正文结果组可以不出现；
  不得用文件名命中冒充正文命中，也不得为满足示例提前加入 parser、chunk 或 BM25；
- 结果协议只有 provider ID、canonical ref、title、snippet、timestamp、type、
  source label、cursor/open action；
- 按来源分组，每组在 Core Federated Search 契约内独立排序和分页；File 组的排序不复用
  File Workspace 名称过滤逻辑。Core 可以固定组顺序，但不比较或暴露不同 Provider 的
  raw score，不制造虚假的全局相关度；
- 每个 Provider 默认硬超时 3 秒、每页最多 50 条，支持 AbortSignal、独立重试；
- raw query 和 provider result 只在当前搜索请求内瞬时传递，不进入数据库、诊断
  或遥测；请求取消、超时或 query generation 改变后的晚到结果直接丢弃，不能
  重新注入当前页面；
- 某组崩溃或超时只在该组显示错误，其他结果继续；
- 点击结果通过 canonical ref 打开对应插件的真实工作面并定位对象；不要求插件为搜索
  结果新增详情页；
- Provider 进入真实插件工作面后，关闭插件详情不自动返回全局搜索；Core 在当前瞬时导航
  session 保留 query、Provider 状态和列表位置，只在用户明确返回时恢复，且不得把全局
  query 自动写入插件本地搜索状态；
- Core 不复制结果、正文或 query 到一个“总搜索数据库”，也不做 AI query rewrite、
  AI 排序或答案总结；如果以后只统计性能，也只能记录数量/时延，不能记录查询词；
- 默认不显示外部完整路径、Secret 或 Clipboard 正文；文件 snippet 本身仍可能
  敏感，锁屏和外围界面不展示；
- Conversation 正文搜索是否启用由 Core 自己的索引设置决定，未开启时不能显示
  为全文搜索；
- File Workspace、Organizer 或任何一个 Provider 停用后，Core 搜索和其他组仍
  正常工作，不留下不可点击的结果。

### 6.6 主窗口、Tray 和开机启动

当前方向和模块 3 桌面入口：已按 macOS M1 收窄。

DSH 官方目前主要提供 CLI 和 Web，没有可依赖的官方 Tray 和开机启动契约，因此这两项
由 Hermit Core Desktop Shell 实现，并通过少量适配层连接固定版本的 DSH。Quick Panel 现在
按 Desktop Surface 独立模块维护，窗口宿主归 Desktop Core，Conversation/Session 仍归 DSH，
业务内容和动作归对应 Product Plugin。本节只保留长期产品边界，接口形状、阶段和验收见
[Desktop Surface 与 Quick Panel spec](desktop-surface-quick-panel.md)。

#### 6.6.1 主窗口

Core-only 时，主窗口就是一款完整的 DSH 桌面 AI：

```text
| Hermit DSH                                           |
|-----------|------------------------------------------|
| 对话      |                                          |
| 搜索      |          当前真实功能页面                |
| 插件      |                                          |
| 设置      |                                          |
|-----------|                                          |
| 个人事务* |  * 只有插件已安装且正常时才出现          |
| 文件工作台*|                                          |
```

- “对话、搜索、插件、设置”由 Core 管理；
- 业务插件只能向 Core 的导航注册表提交自己的一级入口，不能直接改主导航；
- 插件满足“已安装、已启用、当前版本有效、运行正常”才显示入口；
- 插件尚未启动成功时不提前显示入口，运行中崩溃时立即撤下；
- Core 的会话搜索默认只承诺搜索标题和已建立索引的信息。会话正文全文索引必须
  单独开启后才能显示为“全文搜索”，不能在默认状态夸大能力。

#### 6.6.2 Quick Panel

Quick Panel 是 Desktop Core 托管的桌面 Surface，不再属于 Smart Clipboard 专属能力。第一条
实现为 `conversation.quick`，提供一个紧凑的 DSH 对话工作面；后续可以由 Smart Clipboard、
Personal Organizer 或其他已安装插件注册自己的 Surface 内容。

```text
全局快捷键
-> 打开紧凑对话窗口
-> 输入并提交
-> DSH 创建或恢复 Session
-> 流式展示真实 DSH 回复
-> 继续、取消、重试或等待 DSH Approval
-> 需要完整工作面时打开同一个 Session
```

Quick Panel 的通用规则：

- 窗口创建、定位、焦点、置顶、关闭和清理由 Desktop Core 负责；
- Conversation、Session、消息、模型、Tool、Skill、Approval 和历史由 DSH 负责；
- 插件负责自己的业务内容和动作；Core 不复制插件数据或对话消息；
- 第一次只打开窗口不由 Core 创建 Session；`conversation.quick` 从隐藏状态每次重新打开都回到新的
  DSH 会话草稿，首次提交由 DSH 正式流程创建；
- 关闭或隐藏窗口不删除已创建的 Session；`conversation.quick` 的“打开主窗口”才显式传入当前
  `sessionId` 继续已有会话，Core 不猜测；
- `conversation.quick` 是无标题栏、非置顶、失焦不自动隐藏的普通窗口，具体窗口偏好只属于该 Surface，
  不成为其他插件的强制模板；
- “打开完整对话”在调用方明确提供同一个 `sessionId` 时复用该会话，不复制消息或创建第二个会话；
- Surface 可以声明位置、尺寸、焦点和置顶偏好，Core 根据当前平台返回实际生效状态；
- 某项偏好不可用时，窗口仍可继续使用，并以明确的 unavailable/degraded 状态反馈；
- Surface 停用、卸载、DSH 重启或窗口异常时，Core 撤销实例和回调，不能留下旧入口；
- DSH Approval 继续使用正式 DSH 流程，不在 Quick Panel 中另建审批实现。

Smart Clipboard 的快速取回仍是独立的 `clipboard.quick-retrieval` Surface：它复用 Core
窗口宿主，但搜索、剪贴板数据、复制/粘贴和动作映射仍由 Smart Clipboard 负责。通用 Surface
接口、注册方式和分阶段验收见 [Desktop Surface 与 Quick Panel spec](desktop-surface-quick-panel.md)。

#### 6.6.3 Tray / 菜单栏

系统里最多只有一个 Hermit Core 图标：macOS 称菜单栏，Windows 称系统托盘，
Linux 界面统一称状态菜单。

```text
| Hermit DSH · 正常            |
| 待处理  2                    |
|------------------------------|
| 打开主窗口                   |
| 打开 Quick Panel             |
| 暂停后台任务                 |
| 插件与诊断                   |
|------------------------------|
| 退出                         |
```

- 总状态只有“正常、部分功能不可用、离线、需要处理、Safe Mode”；
- 某个业务插件失败只显示“部分功能不可用”，不能把整个产品说成故障；
- “离线”只表示 Core 的整体网络/AI 通路不可用，不代表某个插件自己的服务失败；
- 状态栏只显示安全计数，不显示事项、文件、剪贴板、Prompt 或 Secret 正文；
- 计数必须带观察时间和来源版本，超时、插件换代或失效后显示“未知”，不能沿用
  旧数字；
- 插件只能贡献 Core 预先允许的少量动作类型，不能随意加菜单、动态正文或第二个
  Tray 图标；P0 菜单保持上图的固定最小集合；
- 不依赖单击或双击，所有核心入口都放进菜单项；
- Linux 环境没有可靠 Tray 时，主窗口和其他功能仍完整可用。

#### 6.6.4 快捷键和开机启动

```text
| 全局快捷键                                 |
|--------------------------------------------|
| 打开 Quick Panel                           |
| [ Ctrl + Shift + Space ]   已注册          |
|                                            |
| 插件建议                                   |
| 个人事务 · 快速新建事项   [设置快捷键...] |
```

- 每个真实桌面动作都通过 Core 的快捷键 Registry 注册；默认组合、是否启用和数量由真实
  Surface/插件需求决定，不在产品需求层硬编码为一个；
- 插件只能提交带稳定 id 的快捷键定义，用户在统一设置页修改后仍由 Core 注册；
- Hermit 内部冲突可以提前发现；与系统或其他应用冲突通常只能实际注册后判断，
  界面必须如实显示“已注册、被占用/系统拒绝、当前环境不支持”；
- 插件开始停用、崩溃或卸载时，先注销快捷键，再撤下其他入口；
- Linux Wayland/X11 能力探测后尽力提供；不支持时仍可从主窗口或 Tray 打开，
  不为追求所有桌面环境完全一致拖住 P0；
- 只有 Core 可以设置“登录系统后启动”，插件不能注册自己的开机启动项或不受
  Core 管理的常驻进程。

“暂停后台任务”只暂停定时同步、后台整理、索引和提醒，不中断已经开始的正式
Conversation。界面明确提示“暂停期间不会提醒你”，并提供同一位置恢复。Safe
Mode 只启动 Core、恢复和诊断，不自动启动任何可选业务插件。

#### 6.6.5 隐私、失效和平台降级

- 外围界面从设计上就不显示敏感正文，不能依赖“不一定能检测到”的共享屏幕
  状态再临时隐藏；
- Windows/macOS 检测到锁屏时关闭 Quick Panel，解锁后不自动恢复带输入的窗口；
- 系统提供窗口内容保护时可作为额外加固，但不能宣称绝对防截图；
- 插件的导航、Quick mode、Tray action、快捷键和后台入口全部挂在同一个
  activation lease 下；停用或崩溃时由 Core 一次撤掉，旧版本晚到的异步结果
  不能把旧入口重新注册回来；
- 用户正停在失效插件页面时，由 Core 显示“这个功能已停用”，提供返回、重新
  启用或安装，不白屏、不继续调用失效插件；
- 可选插件不能成为 Core 首屏启动成功的必要条件。这是插件隔离的硬性要求。

#### 6.6.6 系统通知与绝对 Deadline 能力

Personal Organizer 的 Reminder 是业务能力，不能因为需要系统通知就把 Reminder Rule、
Occurrence 或提醒数据库搬进 Desktop Core。两层职责固定如下：

```text
Organizer：保存 Rule/Occurrence，解释重复、时区、DST、snooze/dismiss，决定下一次绝对时刻
    -> Desktop Core deadline：只等待一个不透明 id 对应的绝对时间
    -> Organizer：收到 fire 后幂等认领 Occurrence，更新业务状态
    -> Desktop Core notification：按 Organizer 给出的安全摘要尝试系统投递
```

Desktop Core 只在确有真实使用者时提供两个最小的、公开 typed capability：

- `desktop.deadlines`：`arm({ id, fireAt })`、`cancel(id)`，到期发出带不透明 `id` 的
  `fire` 事件。`fireAt` 必须是绝对 UTC instant；Core 不理解事项、Rule、Occurrence、
  重复、snooze、自然语言或业务状态。Core 只保证当前桌面进程生命周期内的等待，以及应用
  启动/唤醒/恢复时由调用方重新 reconcile；不能把“应用完全退出后的系统级触发”写成跨平台
  保证。
- `desktop.notifications`：`status()`、`show({ id, title, body, actions? })`、
  `replace({ id, ... })`、`remove({ id })`，并以受控事件返回用户点击/动作和投递失败。标题、
  正文和动作由调用方生成安全摘要，Core 不读取插件数据库，不保存第二份业务内容。

两项能力都必须返回明确的 `supported`、`permission` 或 `unavailable` 结果。权限拒绝、
平台不支持、Core 重启和单次投递失败只影响系统渠道：Organizer 仍保留 Canonical Reminder，
Today/Reminder Center/应用内处理继续可用；不得静默删除规则、伪造“已提醒”或把失败变成
业务完成。Core 不建立 Reminder store、不实现通用 recurrence/scheduler、不提供全局默认时区，
也不接收自然语言日期。

所有请求归当前 activation generation；停用、卸载、DSH 重启或退出时撤销 deadline、监听器和
通知句柄，旧 generation 的晚到事件不能产生副作用。通知和 deadline bridge 必须像其他 Core
能力一样校验 sender、限制输入并在纯 Web 宿主缺失时明确返回 unavailable，而不是暴露通用 IPC。
当前只验证桌面壳内的公开 typed bridge；后续 Organizer Reminder 切片在该 bridge 上接入，
不改变 Reminder 的 Canonical ownership。

### 6.7 Plugin Platform And Lifecycle

当前方向和模块 2 生命周期：已确认。

核心价值：让用户放心地“想要什么就安装什么”，同时保证一个插件装坏、停用
或卸载后，DSH 和其他插件仍然能正常打开。

#### 6.7.1 谁可以修改正式环境

- Package Gate 是正式环境唯一允许使用的安装、升级、停用和卸载入口；
- 普通插件不能修改 Package Gate、Core 启动清单或其他插件；
- 正式环境的插件清单由 Package Gate 生成并带完整性凭据，启动时必须核对；
- 用户绕过 Package Gate 手工改文件、直接运行原始 DSH 插件命令或修改依赖，
  正式环境会把它当成“环境已被改动”，进入恢复界面，不带病启动；
- 开发者可以使用单独的 Developer Mode 做实验，但实验环境不能冒充正式环境，
  也不能修改正式环境的安装记录。

这里保护的是“软件正常操作不会互相踩坏”。本机管理员故意篡改所有文件不在
应用自身能完全防住的范围内，但 Hermit 必须能够发现正式环境已经变化。

#### 6.7.2 安装和升级

一个 Product Plugin 可能同时包含界面、数据、Tool、搜索入口、后台任务等多
个部分。它们必须作为一个完整版本一起启用，不能出现“新界面配旧数据逻辑”。

候选版本只能操作新的 staging data generation。切换前 Capability Broker 阻止它
注册真实 listener、timer、watcher、job、shortcut 或产生通知、网络写入和外部
副作用；健康检查使用影子/测试 capability 和隔离数据。ACTIVE generation 的数据
与进程不能被候选代码修改。全部通过后，code + data generation 一次原子切换，
新 generation 才获得真实能力。

```text
选择插件/升级版本
-> 展开最终要安装的全部内容
-> 显示版本、来源、权限、脚本、许可证和磁盘占用
-> 用户确认
-> 在旁边准备一个全新的候选版本
-> 默认禁止第三方安装脚本，校验文件完整性
-> 用候选版本做一次真正的干净启动
-> 所有组成部分都启动成功
-> 一次切换到新版本
-> 写入“安装完成”记录
```

安装失败时：

- 原来的运行版本仍是唯一有效版本；
- 候选版本被标记为失败并等待安全清理；
- 不把半套新插件暴露给用户；
- 展示大白话原因和可导出的诊断信息；
- Windows 上无法立即删除的旧原生文件留到下次启动再清理。

版本必须精确锁定到具体版本或提交、来源和完整性，不能使用 `latest` 或版本
范围。安装页显示的是展开后的真实结果，不是一个含糊的“安装方案名”。

安装确认页原型：

```text
| 安装：个人事务                           |
|------------------------------------------|
| 来源      官方插件仓库                   |
| 版本      1.4.2（已验证）                |
| 将获得    事项数据 / 通知 / 搜索 / AI Tool|
| 后台活动  提醒服务                       |
| 安装脚本  无                             |
| 下载      18 MB    安装后约 42 MB        |
| 许可证    MIT                            |
|                                          |
| [取消]                         [安装]    |
```

#### 6.7.3 插件之间怎么相处

- Hermit Product Plugin 是 Package Gate 签发的 capability profile，不等于任意
  DSH/Cordis Plugin。除非它属于签名 Core release，Product Plugin 不得注册 Model
  Adapter、Approval answerer、另一套 Conversation/Session UI，不能取得 `ctx.llm`
  或未声明的 host/network/filesystem 能力；
- 可选业务插件默认只允许硬依赖 Core；File Workspace 使用 Hermit 已资格通过的 Product
  Surface 公共契约，不形成业务插件之间的硬依赖；
- 插件之间只能通过 Core 的公开能力做“有就显示、没有就跳过”的可选合作；
- 不允许直接导入另一个插件的内部代码、数据库表或创建跨插件外键；
- File Workspace 只能消费 DSH/Hermit 的公开 service、typed slot 和类型，不调用私有 Host
  路由，也不把 Product Surface metadata 或 Session `cwd + path` 当成 FileRecord 或 managed 数据；
- 每个插件及其后台进程使用自己的身份和最小权限；
- DSH/Cordis 同进程插件不是安全沙箱。没有达到官方信任标准的社区代码不能
  进入正式 Core Host，只能放进隔离进程，通过很窄的桥接接口工作；
- macOS 上各进程分别签名并只申请必需权限，不能为了插件降低主程序权限。

因此，拔掉任意一个业务插件后，其他插件最多少一个可选入口，不会因为找不到它而无法
启动。File Workspace 自身退出 ACTIVE 时，Core、其他插件和 File Workspace 已有数据继续
可用或按保留策略保留。

clean boot 发布门不仅检查页面能打开，还必须确认已移除插件没有残留 Tool、
Provider、listener、timer、watcher、job、shortcut、Tray action 或数据库句柄。

#### 6.7.4 停用、卸载和删除数据是三件事

停用流程：

```text
点击停用
-> 先隐藏入口并拒绝新的调用
-> 取消或等候正在执行的任务
-> 停止后台任务并释放资源
-> 超时仍不退出时，终止该插件的隔离进程
-> 数据原样保留
```

卸载流程：

```text
点击卸载
-> 完成停用流程
-> 删除插件代码和可重新生成的缓存
-> 保留用户原始业务数据
-> 旧会话显示通用引用卡片和“插件未安装”
-> 用户以后可以精确重装并重新打开数据
```

Session 中的 Tool call/result/envelope 由 Core durable persistence 保存，不引用
插件运行代码。插件卸载后，Core generic renderer 仍能展示旧回答和历史 Tool
Result；只有新的读取/写入调用返回 Provider unavailable。

“删除插件数据”是另一个危险操作，必须单独进入数据管理页，先展示将删除的
数据和外部文件影响，并提供导出。外部原文件永远不能因为卸载插件被删除。
由多个插件共同引用的托管文件按所有者和引用次数管理，最后一个引用消失前
不能清理。

#### 6.7.5 保留的数据怎么重新打开

- 卸载后至少保留数据格式、原插件身份、精确版本、来源、完整性和依赖闭包；
- 对仍保留业务数据的插件，保留一份已经验证过、当时能打开该数据的最小恢复
  包；相同文件只存一份，避免重复占空间；
- 用户可以主动选择“只留原始数据，不留恢复包”来省空间，但界面必须明确说明
  以后可能无法一键重装旧版本，不能静默清理；
- 若精确 package artifact 已无法获得或不再满足签名/平台要求，状态明确显示
  “可导出原始数据，但暂时无法恢复功能”，不能继续承诺一键重装；
- 深链打开已卸载插件时，先显示安全的通用页，可选择重装、导出或删除数据；
- 数据版本太新或不兼容时，进入只读隔离状态。Core 只允许查看安全元数据、
  导出原始数据或删除，不允许旧插件写坏新数据；
- Core-owned“插件与数据”页永远可达，不重新加载已卸载代码。Core 可以直接导出
  带 manifest 的原始数据包；要生成领域 JSON/CSV 等格式时，只能先精确重装，
  或在隔离环境运行已验证恢复包，不能把旧代码塞回 Core Host；
- Safe Mode 不依赖任何业务插件，始终可以查看并回滚最近一次插件变更。

卸载后的数据页原型：

```text
| 个人事务未安装                           |
|------------------------------------------|
| 仍保留：326 条事项、18 个提醒            |
| 数据状态：完整                           |
| 可恢复版本：1.4.2（已验证）              |
|                                          |
| [重新安装]  [导出数据]  [删除数据...]    |
```

### 6.8 Settings、Diagnostics、Update、Recovery And Migration

当前方向和模块 7 系统闭环：已确认。

#### 6.8.1 最终运行形态：Electron + bundled DSH Web（stock 或 Hermit 受控 patch），完全移除 Go

```text
Hermit Electron Desktop Shell
|-- 主窗口、Quick Panel、Tray、快捷键、开机启动、更新和单实例
|-- 兼容范围内的 Node + stock DSH Web，或 Hermit 自带的受控 patch generation，监听 127.0.0.1 的 OS 随机端口
`-- 只监管自己启动的 DSH 进程树

Bundled DSH Web/Runtime
|-- 官方 Conversation / Session / Settings / Tool / Approval
|-- Skill / MCP / 插件生命周期
`-- Hermit Product Plugins
```

- Node/TypeScript + DSH/Cordis 是 Core 和插件运行时；
- Electron 只负责窗口、WebView、进程监督、Tray、快捷键、通知、OS 桌面能力、更新和
  单实例；
- React 直接建立在官方 DSH Web、Conversation、Session、Tool rendering、Settings
  shell 和 client slot 上，不重写第二套聊天前端；
- Hermit 自己常驻和后台进程树中没有 Go，Go 不再拥有数据、API、后台任务或恢复；
- Electron 使用经过兼容性门验证的 Chromium/Node 运行时，减少跨平台 WebView 差异；三平台仍需分别
  验证窗口、Tray、快捷键、开机启动、剪贴板和更新行为。

#### 6.8.2 Node 和 DSH 版本

Hermit 自带 Node，不依赖用户系统安装。用户说的“最新 Node”在正式产品中解释为：

> 当前生产 Active LTS 线上，经过 Hermit 全套验证的最新补丁；不是版本号最大的
> Current，也不是启动时在线追 `latest`。

首个 Core generation 选择 Node 24.x 兼容范围。`.node-version`、`package.json` 和
lockfile 只记录当前发布候选的机器可追溯事实，不在需求文档追踪“最新”标签；以后新
LTS 也必须先完整验证，再随新 Core release 切换。

一个 Core release 是不可拆开的签名单元：Electron 壳、候选 Node binary、固定 DSH
RC 兼容包和完整 `@deepseek-ai/*` 包图、lockfile、Core adapters、Web assets、兼容
清单和 SBOM。生产依赖图不得出现 `latest`、`next`；发布时由 frozen lock 将声明范围
解析为可追溯的候选版本。

#### 6.8.3 设置和 Core 凭据

唯一设置框架使用 DSH Settings shell，Hermit 通过官方 slot 贡献以下分组：

```text
| Hermit Settings                                     |
|----------------------|-------------------------------|
| AI 与模型           | Provider / 模型 / Approval    |
| 插件                 | 版本 / 来源 / 权限 / 状态     |
| 桌面与快捷键         | 主窗 / Quick Panel / Tray     |
| 搜索与索引           | 状态 / 大小 / 暂停 / 重建     |
| 数据与存储           | Core/插件数据/旧档案          |
| 隐私与权限           | 路径/网络/原生权限/凭据后端   |
| 更新                 | 当前/候选/上一版本            |
| 诊断与恢复           | 检查/备份/Safe Mode           |
|----------------------|-------------------------------|
| Core C17 / DSH rc.2 / Node 24.x                    |
```

- 插件 ACTIVE 时贡献功能设置；卸载后 Core Data Registry 仍记录保留数据的所有者、
  数量、schema 和可恢复版本，提供重装、导出或删除；
- DSH 官方 credential reference/interface 可以复用，但正式 Profile 禁用会把 Key
  写入明文 YAML 的 local credential provider；
- Provider API key、DSH auth token 等 Core 凭据使用 Hermit OS Credential Provider，
  分别落 macOS Keychain、Windows Credential Manager、Linux Secret Service；
- Secret 字段只显示“未设置/已配置/删除”，不回显值；值只在 Core 使用时短暂进入
  内存，Product Plugin 不可读取；
- Linux 没有 Secret Service 时凭据读写 fail closed，不静默保存明文；Settings、
  数据和恢复仍能打开，只把 AI Provider 标为“凭据后端不可用”；
- 这只是 Core 凭据基线，不是 Secure Vault 产品功能。

#### 6.8.4 诊断和两层 Safe Mode

诊断默认只显示 Core/DSH/Node/OS/插件精确版本，启动/健康/权限/索引状态，任务
数量和脱敏错误码。不显示正文、Prompt、Tool payload、绝对路径、Clipboard、
Secret、provider stdout/stderr。

```text
| Diagnostics                                         |
|-----------------------------------------------------|
| Core       C17                 Healthy              |
| DSH        pinned commit       Healthy              |
| Node       24.x                Healthy              |
| Plugins    4 active / 1 disabled                    |
| Search     Ready / 100,000 chunks                   |
| Keychain   Available                                |
| Last error PLUGIN_ACTIVATION_TIMEOUT                |
|                                                     |
| Content / prompts / paths / clipboard: NOT INCLUDED|
| [Preview diagnostic package]            [Export]   |
```

- 导出前预览文件清单和脱敏结果；
- 插件 safe diagnostics 使用 schema allowlist、64 KiB 上限、500ms soft/2s hard
  timeout 和取消；超时只显示该插件诊断不可用；
- raw provider stdout/stderr 永不自动打包。

Safe Mode 分两层：

1. Tier 0 Electron Recovery 使用应用内置的最小本地页面，不依赖 DSH Web。即使
   Node binary、DSH 包或主页面坏了，也能查看极简错误、选择当前/上一签名 release、
   禁用 bundled 业务插件并启动 Tier 1；它不读取或修改插件 Canonical 数据。
2. Tier 1 DSH Safe Profile 只加载 Core、Package Gate、设置、诊断、数据校验、
   导出/恢复、派生索引重建和插件版本回滚。Conversation 历史仅只读；不加载
   社区插件、不调用模型、不自动迁移或“顺手修复”Canonical 数据。

#### 6.8.5 更新、代码版本和数据版本

```text
下载完整候选 release/generation
-> 校验签名、hash、SBOM、来源和兼容矩阵
-> 停止相关 writer 并做一致备份
-> 在数据 staging 上做 schema migration
-> integrity/foreign key/业务规则验证
-> 使用隔离测试数据真实启动完整候选桌面包
-> code + data pointer 一次切换
-> 允许新版本写入
```

Core release 和 Product Plugin 都有精确代码 generation，Canonical data 另有 data
generation，authority 成对记录它们。旧代码只有在明确支持当前 schema、有经过
测试的无损反向迁移，或与升级前数据 snapshot 一起恢复时才能回滚。

如果新 schema 已不可逆提交并产生新写入，不能只降级代码或自动恢复旧 snapshot，
否则会丢新数据；默认路线是 forward repair。界面不能提供一个看似安全、实际
代码旧数据新的“回滚”按钮。

#### 6.8.6 备份和恢复

Core 统一编排，各插件实现有版本的 Canonical export/restore adapter：

- 日常 SQLite 备份使用 Online Backup API 产生一致副本；迁移/cutover 关键备份
  必须先停止 writer；
- managed blobs 按 hash manifest 校验；external 文件默认只备份 FileRecord 和
  locator 元数据，不复制用户原件；
- OS Keychain 中的 Secret 值不进入普通 Canonical backup，只保存 credential
  reference 和“已配置”状态；
- manifest 记录版本、数量、hash、大小和兼容要求；SQLite 还要跑 integrity、
  foreign key 和业务 invariant 校验；
- 恢复先 dry-run/预览，再导入 staging，全部验证后一次切换；
- P0 只做本地备份，不做云同步；未加密备份明确标为普通文件。

#### 6.8.7 旧 Go 产品一次性切换

“一步到位”不是不做演练，而是用户的数据权威只切换一次。正式切换前的所有
演练都在只读旧快照和独立 staging 上反复进行，不改旧数据。

预检锁定旧 Go build/schema、目标 Core/插件精确 generation、映射版本、数据数
量/大小、权限、磁盘预算、Legacy AI 数量和旧 Secret/Vault 是否存在。磁盘预算
至少覆盖 backup + staging + temp + `max(512 MiB, 10%)` reserve，不足不开始。

```text
旧 Go 仍是唯一权威
-> 从真实旧数据做可重复 rehearsal（只读，不改源数据）
-> 同一 source ID/hash 必须稳定得到同一 target，不重复
-> 生成不可变旧系统备份
-> 进入唯一一次维护窗口
-> 阻止旧写入、排空任务、停止 Go writer/background
-> final consistent snapshot 并封存 manifest/hash
-> 导入新系统 staging
-> counts/IDs/hash/relations/reminder/内容抽样/启动全面校验
-> 用 staging 只读启动新 DSH 做 smoke test
-> 一次原子写入 authority pointer
-> authority = DSH，才允许新系统写入
-> Go 永久退役，不双写、不再读旧库或调用旧 API
```

authority pointer 同时携带持久 `authority_epoch/lease`。所有旧 Go writer 在 freeze
时永久撤销 lease；目标 DSH writer 的每次 Canonical 写都校验当前 epoch。即使旧
进程残留、被系统重启或有人误开旧程序，也只能只读/拒绝写，不能只靠“流程上不
再启动 Go”防止双权威。

数据映射：Item 到 Organizer；File metadata 到 File Workspace，managed 文件复制并
核对 hash、external 只建 locator；Reminder 到 Reminder Rule；仅迁兼容普通设置。
Migration Ledger 记录 source kind/ID/hash、target kind/ID/revision、transform version、
状态、错误和重试次数。整模块优先事务；跨库/文件使用 staging 和补偿日志。

校验不能只比总行数，还要检查分类数量、source 覆盖、target 唯一性、blob hash、
悬空关系、SQLite integrity/foreign key、提醒时区/重复规则、外部定位状态、内容
抽样、Core/插件启动、只读搜索、Legacy Archive 和 Secret 泄漏扫描。

断电/失败判定只有一条：authority pointer durable commit 前仍是 Go，可以丢弃
staging 回到旧系统；commit 后就是 DSH，哪怕第一次业务写也不能再回 Go。之后按
问题类型禁用坏插件、重建索引、切换数据兼容的 Core、从 DSH backup 恢复到 staging
或 forward repair，绝不能重新打开旧 Go 形成两条时间线。

#### 6.8.8 没有新归宿的旧数据

- 旧 AI 历史不能伪造为新 DSH SessionEvent，统一生成带 manifest、source metadata
  和逐条 hash 的只读 Legacy Archive；可以查看、导出和以明确“旧历史/只读”标签
  搜索，但不能继续成真实 Session；
- 检测到旧 Secret/Vault 就禁用 Cutover 按钮，直到用户在旧系统还能解密时导出
  到明确安全目标，或明确选择只保留“新 Hermit 无法打开”的原加密 snapshot 并
  确认风险；
- 旧 Vault 不能进入 Smart Clipboard、普通 JSON、诊断或 AI Archive；
- 最终安装不保留 Go decoder/runtime，旧格式转安全格式必须在 cutover 前完成；
- 切换后保留只读旧 snapshot、ledger、报告和 Legacy Archive，由用户主动清理，
  不设自动 TTL。删除旧快照是单独危险操作，先显示内容、大小、依赖和不可恢复项。

迁移报告使用大白话：

```text
成功迁移     10,284
跳过             17
需要处理          3
旧 AI 归档       426
旧 Secret          2 -> 已按用户选择处置
```

#### 6.8.9 本地网络和 Electron renderer 边界

- 本地 DSH 只监听随机 `127.0.0.1` 端口；随机端口不是身份认证；
- DSH Host/Origin/fetch-metadata fence 用于降低跨站利用风险，不替代权限边界；
- Electron renderer 使用 `nodeIntegration: false`、`contextIsolation: true`、
  `sandbox: true`、CSP 和导航白名单；任意 `window.open`/外部导航阻断或交给系统；
- Electron IPC 只开放最小 typed capability 并校验 sender；插件不能读 Core Secret 或
  任意路径；
- 更新只走签名渠道；日志/遥测默认本地且脱敏，P0 不上传用户内容。

#### 6.8.10 复用、二开和自研

直接复用 DSH：Session/SessionEvent、Agent loop、Tool pipeline、Approval seam、LLM
adapter、Session persistence、Cordis composition、Web Conversation、Tool rendering、
client slots、Settings service/schema 和 credential interface。

在官方 seam 上二开：Hermit Web profile、Settings 分组、OS credential provider、
desktop picker/notification bridge、runtime-token carrier、Tool capability adapter 和
safe diagnostics projection。

自研：Package Gate、签名 generation manager、code/data 兼容矩阵、Tier 0 Native
Rescue、Plugin Runner 隔离/broker、更新编排、Canonical Data Registry、backup
manifest、restore staging、migration ledger、authority pointer、Legacy Archive viewer
和 fault-injection recovery journal。

社区 Tauri/DSH Desktop 和 Electron wrapper 只借鉴 sidecar 打包、随机端口、ready
handshake、退出监督、renderer hardening 和发布测试；不继承其追 upstream latest、未经审计
的私有 patch、credential 存储、签名状态或 updater。Hermit 自己携带的 source patch 必须
由 ADR、许可证/notice、构建摘要、精确版本和双宿主资格单独约束。正式环境不使用 `dsh plugin add`
作为发布门，也不使用明文 `dsh-credentials-local`。

### 6.9 UI 组件和 DSH 风格契约

当前方向：已确认。DSH Web/client 是 Product Plugin 的唯一视觉宿主；Hermit 不 fork
或复制 App shell、Conversation、Session、Tool、Approval、Settings shell 和主题。若业务
闭环被 pinned DSH 的公开面阻塞，Hermit 可以在自带 generation 中携带经过审计的最小 source
patch 来补公开 Product Surface，不把该 patch 变成插件私有运行时依赖。

长期不变量：

- Product Plugin 只使用 stock 或 Hermit patched pinned DSH 暴露的公开 export、typed slot
  和正式 Product Surface，不依赖私有源码、React Router、内部 store、DOM 或 CSS selector；
- Product Plugin 与 DSH Host 共享唯一 React、ReactDOM 和平台模块，不能把第二份运行时
  打入插件 bundle；
- 初期只规划一个编译期共享包 `@hermit/ui`。它负责收敛经验证的 DSH 公共 UI 入口和通用
  组件，不是运行时插件，也不拆成 `ui-patterns`、`ui-desktop` 等包；
- 领域 UI 保留在各 Product Plugin，Desktop carrier UI 保留在
  `apps/desktop-vnext`；两者不能借共享之名混入同一运行时边界；
- DSH-mounted 样式直接使用 DSH semantic token，不复制主题数值、不建立 Hermit
  ThemeProvider、品牌调色板或全局样式 fallback；
- DSH 公共组件、图标和 token 只有经过真实 Host、打包、主题、交互和 React identity
  验证后，才能从 `candidate` 变成业务可依赖的 `allowed` 接口。

页面结构、组件归属、样式规则和新组件创建流程以
[Product Plugin UI 与组件创建规范](../../plugins/ui-guidelines.md)为准；首轮候选、资格拓扑
和退出条件以 [UI foundation 资格方案](ui-foundation-qualification.md)为准。资格通过前不
创建空的 `packages/ui/`，也不把候选组件名写成已经稳定的 allowlist。

## 7. 暂时不做

- 不做 Hermit 第一方 Knowledge Memory Product Plugin；
- 近期不默认或可选安装第三方 Memory 插件；
- 不自动把 Organizer/File 数据提炼成长期记忆；
- 暂不做真正 Secure Vault；
- 暂不做 Data Protection Product Plugin；
- 不为每个插件创建独立 AI、聊天、状态栏或全局快捷键；
- 不在 P0 依赖 Embedding 才能完成文件检索。

Memory 候选仅保留观察：`dsh-memento`；`dsh-mnemon` 只作为工程参考。重新
评估必须同时满足高采用、持续维护、目标 DSH 兼容、完整安装/卸载验证和无
AI 旁路。

## 8. 核心用户流程

### 8.1 在主 Conversation 使用业务数据

```text
在主 DSH Conversation 输入问题
-> 通过 `@` 或统一引用机制选择文件/事项等业务数据
-> 创建或选择真实 DSH Session
-> 插件按授权提供所选数据
-> DSH 调用模型
-> 需要修改数据时调用插件 Tool
-> 必要时 DSH Approval
-> 插件提交确定性写入
-> Tool 结果和最终回答写入同一个 Session
-> 用户可在主 Conversation 继续
```

异常闭环：

- 插件未安装或已禁用：入口消失，旧历史显示 unavailable；
- 数据已删除：显示 tombstone，不让 AI 读取缓存副本；
- Provider 不可用：Session 保留输入和上下文引用，允许更换 Core Model 后重试；
- Tool 被拒绝：不修改业务数据，回答中显示未执行。

### 8.2 联邦搜索

```text
输入关键词
-> Core 并行查询当前 Search Providers
-> 按来源分组显示 title/snippet/time
-> 用户打开 Canonical 来源
```

Provider 失败时只标记该来源不可用，其他结果继续显示。

### 8.3 插件升级并一次启用

```text
下载并校验候选
-> 在 staging code/data generation 启动
-> Broker 只给影子能力，不允许真实后台活动或外部副作用
-> schema、索引、UI、Tool、Search Provider 全部验证
-> code + data generation 原子切换
-> 新版本获得真实能力，旧版本停止并等待清理
```

任一步失败时旧 ACTIVE generation 不变；不可逆 schema 与代码兼容性不满足时
禁止切换或只降代码。

### 8.4 插件卸载后打开旧 Session

```text
打开历史 Session
-> Core durable persistence 读取旧 Tool call/result/envelope
-> Core generic renderer 展示，不加载已卸载插件
-> 旧回答和已成功 Tool Result 可查看
-> 用户尝试新读取/写入
-> 返回“插件未安装”，提供重装或数据管理入口
```

### 8.5 Clipboard 文件/图片交给 AI

```text
用户明确选择一条 ClipboardEntry 并提交本轮 @
-> Core 签发单条一次 grant
-> 文本：返回严格一条安全文本
-> 图片：只返回校验、去 metadata、限大小的规范化 payload
-> 文件引用：默认只返回安全名称/引用元数据
-> 需要正文时重新经过 Core AI filesystem broker 和 File Workspace 授权
```

File Workspace 未安装时文件正文不可读，但 Clipboard 的搜索、复制、粘贴、删除
和其他文本/图片能力仍正常。

### 8.6 Authority Switch 后旧 Writer 复活

```text
authority pointer 已提交为 DSH + epoch N
-> 旧 Go 进程残留、重启或被误开
-> 旧 lease 已永久撤销，写请求因 epoch 不匹配被拒绝
-> DSH 继续是唯一 writer
-> 故障只通过 DSH backup/兼容 generation/forward repair 处理
```

## 9. 页面与状态原型索引

本节负责产品范围和页面覆盖，不作为高频变化的插件交互设计文档。三个 Product Plugin
的当前信息架构、核心流程、低保真原型和待确认问题分别由
[Personal Organizer DESIGN](../../plugins/organizer/DESIGN.md)、
[File Workspace DESIGN](../../plugins/file-workspace/DESIGN.md)和
[Smart Clipboard DESIGN](../../plugins/smart-clipboard/DESIGN.md)负责。Core 需求负责
产品范围、数据归属、跨域安全和验收红线；各插件 DESIGN 负责已确认的功能、页面、交互、
默认设置和插件内数据操作，不在 Core 需求中复制第二套高频变化事实。

### 9.1 完整页面树

```text
Hermit Core
|-- 对话
|   |-- Session 列表
|   |-- Conversation
|   |-- Tool / Approval / unavailable 通用卡片
|   `-- Session 数据清理与删除
|-- 搜索
|   |-- 按来源分组结果
|   `-- 单来源更多结果 / 超时重试
|-- 插件
|   |-- 已安装 / 可安装 / 更新
|   |-- 安装确认与依赖闭包
|   |-- 插件详情 / 权限 / 版本 / 诊断
|   `-- 插件与数据（已卸载数据、重装、原始导出、删除）
|-- 设置
|   |-- AI 与模型
|   |-- 插件
|   |-- 桌面与快捷键
|   |-- 搜索与索引
|   |-- 数据与存储
|   |-- 隐私与权限
|   |-- 更新
|   `-- 诊断与恢复
|-- Tier 1 DSH Safe Profile
`-- Tier 0 Electron Recovery

Personal Organizer（安装后）
|-- 个人事项（默认工作面）
|   |-- 近期 Event
|   |-- 全部未完成 Todo
|   `-- 最近 Note（默认收起）
|-- 查看
|   |-- Items：Note / Todo / Event 列表与筛选
|   |-- Today：逾期 / 今天待办 / 今天日程 / 今天提醒
|   `-- Calendar：周视图 / 列表视图
|-- 右侧抽屉
|   |-- 详情 / 新建 / 编辑
|   `-- Note 明确改为 Todo / Event
|-- 提醒中心（有待处理状态时出现）
|   |-- 待处理 / 即将到来 / 已处理
|   `-- 打开 / 稍后 / 忽略
|-- 搜索
|-- 垃圾箱
|   `-- 恢复 / 永久删除
`-- 数据与存储
    |-- 导入预览 / 去重 / 失败报告
    `-- JSON / CSV / ICS 导出

File Workspace（安装后）
|-- Product Surface 中的单一文件工作区：统一文件树 + 当前文件编辑/查看
|-- 快速记事 / 新建一条 -> 固定文件夹中的 managed Markdown
|-- 添加文件：首版任意普通文件 managed copy；external 语义长期保留
|-- 文件夹名与文件名过滤
|-- projection-backed @文件
`-- managed Trash / external 从工作区移除

Smart Clipboard（安装后）
|-- Desktop Surface 中的 clipboard.quick-retrieval
|-- 完整历史
|   |-- 最近 / 置顶 / 类型筛选 / 本地搜索
|   `-- 预览 / 复制 / 粘贴 / 编辑副本 / Trash
|-- 垃圾箱 / 清空确认
`-- 记录与数据设置
    |-- 记录状态 / 暂停 / 忽略下一次
    |-- 排除应用 / 类型
    |-- 保留额度
    `-- 导出 / 清空 / 删除插件数据

桌面外围（Core）
|-- Desktop Surface Manager：对话和插件快速工作面宿主
|-- Tray / 菜单栏
|-- 快捷键设置与冲突
|-- 系统通知与绝对 Deadline bridge（不保存插件业务状态）
`-- 插件失效通用页
```

### 9.2 通用状态原型

每个列表、详情和设置页都必须覆盖 loading、empty、ready、partial、error、
permission denied、plugin unavailable。状态文案不能暴露内部堆栈或正文。

```text
| 当前页面                                      |
|-----------------------------------------------|
| 空状态：这里还没有内容              [+ 新建] |
|                                               |
| 部分失败：文件结果可用，个人事务查询超时      |
|                                    [重试该组] |
|                                               |
| 权限拒绝：没有读取这个位置的权限    [重新授权]|
|                                               |
| 插件失效：这个功能已停用             [返回]  |
|                         [重新启用 / 安装]     |
```

导入预览和 Trash 使用同一套明确的“影响范围 + 可撤销性”结构；具体失败是否整批回滚
由各插件的 Canonical 提交规则决定，File Workspace 按单文件原子提交并保留已完成项：

```text
| 导入预览 / 删除确认                           |
|-----------------------------------------------|
| 将处理       326 条                           |
| 重复建议      12 条                           |
| 不支持         3 条                 [查看]    |
| 预计占用     48 MB                            |
|                                               |
| 失败时：按当前插件规则回滚或保留已完成项      |
| [取消]                         [确认并继续]   |
```

### 9.3 确认过程

每次只确认一个决策，不一次抛出整套问卷。顺序由依赖关系决定：

1. DSH Core 与唯一 AI 入口；
2. Product Plugin 平台与安装/禁用/卸载；
3. 主窗口、Quick Panel、Tray 和 Shortcuts；
4. Personal Organizer；
5. File Workspace 轻量文件工作面；
6. Federated Search；
7. Smart Clipboard；
8. Settings、权限、Diagnostics、Update 和 Recovery；
9. 旧产品迁移与 Authority Switch；
10. 跨模块验收、性能、兼容性和发布边界。

每个模块的确认流程：

```text
Web GPT 原始资料调研
-> Web GPT 反方审查
-> Codex 按 grill-me 逐项核对
-> 双方一致：直接记录结论并进入下一项
-> 双方分歧：用大白话 + ASCII 原型提交产品负责人决定
-> 所有模块完成后交付最终确认文档
```

## 10. 验收与发布红线

### 10.1 Core 和最终运行时

- 零 Product Plugin 时能使用真实 DSH Conversation/Session、模型、Tools、Approval、
  Settings、插件管理、诊断、更新、备份/恢复和 Safe Mode；
- Windows/macOS 正式进程树中 Hermit-owned Go process 为 0，安装、启动、恢复、
  Legacy Archive 查看都不依赖 Go runtime；
- release manifest 能离线验证 Electron、Node binary、DSH commit、全部
  `@deepseek-ai` 包、lockfile、native addon、Web assets、SBOM 和兼容矩阵 hash；
- 生产解析图中出现 `latest`、`next` 或版本范围则发布失败；
- 本地服务只监听随机 `127.0.0.1` 端口；错误 Origin/Host/fetch metadata 的浏览器
  请求拒绝；随机端口不作为认证；Electron CSP、导航白名单和 IPC sender 自动回归；
- Core-only 冷启动定义为“无 Hermit 进程到 Conversation composer/Session list
  可交互”，固定基准机每平台至少 30 次，p95 不超过 3 秒、p99 不超过 4 秒；
- Quick Panel 从全局快捷键事件到首帧可交互，100 次 warm p95 不超过 300ms、
  p99 不超过 500ms，业务插件激活不在关键路径；
- 无后台任务时静置 60 秒后测 10 分钟，CPU median 低于一个逻辑核 0.5%，p95
  低于 1%，不得固定频率 busy polling。

### 10.2 插件独立性和生命周期

- 删除任意 Product Plugin 后，Core 和其他插件 clean boot；
- 可选插件不是 Core 启动条件。2 秒未启动显示“启动较慢”，10 秒未成功进入
  DEGRADED/QUARANTINED，不阻塞 Conversation；
- 插件安装/升级在候选环境完整启动成功前不发布任何导航、Quick mode、Tray、
  Shortcut、Tool 或 Search Provider；
- 候选 generation 只能使用 staging data 和影子 capability；验证期间注册真实
  listener/timer/watcher/job/shortcut 或产生外部副作用即发布失败；
- 插件停用/崩溃时一次撤掉全部入口并拒绝新调用，旧 activation 的晚到结果不能
  注册回来；
- 卸载默认保留 Canonical 数据，Core 数据页仍知道数据属于谁并能重装、导出或
  单独删除；外部原文件绝不因卸载被删；
- 卸载插件后打开旧 Session 不加载插件代码，Core generic renderer 仍能显示旧
  Tool call/result；新的调用才返回 unavailable；
- 社区插件权限超出隔离平台实际能力时拒绝安装，不以 unrestricted Node process
  冒充沙箱。

### 10.3 AI、资源和审批

- Product Plugin 静态扫描不得出现 `ctx.llm`、模型 SDK、模型 Key 或第二套聊天；
- 没有当前真实 DSH Session/turn 的业务 AI 操作全部拒绝；
- 本轮 `@` 不自动把正文交给模型；File Workspace 在用户明确选择时准备 projection 也不
  产生 grant 或 Tool Result。没有成功 durable Tool Result，模型和 UI 不能声称读过；
- Composer 插入 `@` 但未发送时没有 grant；删除引用、丢弃草稿或切换 Session
  后不能读取，只有真实 user turn 提交才签发本轮 grant；
- 历史 Ref 不自动刷新；File Workspace 发送/read 使用选择时捕获的 projection，只有移除
  并重新指定才绑定新的已保存 revision；Provider 卸载后旧结果仍由 Core 通用卡片显示，
  新读取返回 unavailable；
- Resource projection 不含 raw internal schema、Secret、绝对路径或未授权正文；
- Session A/connection A 的 Approval 不能给 Session B/其他连接使用；rejected、
  cancelled、unavailable 全部不执行；
- 有副作用 Tool 使用 callId 幂等。崩溃产生 `TOOL_OUTCOME_UNKNOWN` 时先核对真实
  状态，不盲目重试；
- Approval 的 session/call/tool/args hash/provider 任一变化即失效；相同 callId
  crash/replay/reconnect 返回同一提交结果，不能重复写；
- 上述跨 Session/连接/崩溃测试未在锁定 DSH generation 上通过前，所有 AI
  mutation Tool feature flag 必须关闭，只开放读取。

### 10.4 Personal Organizer

- 移除所有模型和 File Workspace 后，手工 Note/Todo/Event CRUD、Today、提醒、
  搜索、Trash、导入导出仍完整；
- 明确 query 的 Local/Federated Organizer 搜索都能命中所有非 Trash 生命周期状态，终态
  清楚标记且打开不自动恢复；Trash item 只在 Trash scoped search 中可见，进入/恢复/
  永久删除后 stale ref 和索引范围按当前 Canonical 状态收敛；
- Organizer 搜索时间始终带类型语义，终态不抹掉原业务时间，date-only/all-day 不制造
  00:00；Local 与 Federated 组内默认排序都以文本相关性为主，并以 lifecycle、updated_at
  和稳定 ID 确定性收敛，最近编辑不得推翻明显的相关性差异；
- Personal Organizer Skill 能明确识别完成语义时创建 Todo，能明确识别时间占用时
  创建 Event，其余输入创建 Note；不存在无类型记录或待整理队列；
- 用户在右侧抽屉把 Note 改为 Todo 或 Event 时 item ID 不变，正文、标签、Reminder、
  来源、原始输入和类型变更历史保留；Skill 不静默改变已保存事项的类型；
- Note → Event 不得从正文推断或默认生成时间事实、隐式解除归档或重新解释已有 Reminder；
  只有 active Note 在用户明确补齐目标 Event 时间形态后才能以同一 ID 原子转换；
- Note 生命周期与类型转换必须分离：只有 active Note 可转 Todo/Event；archived Note
  必须先显式恢复，转换不得隐式解除归档或与恢复合成隐藏副作用；
- Todo 自然语言日期解析必须区分“日期值可解析”和“start/due 角色已表达”。信息不足或
  日期关系非法不得阻塞已足够明确的 Todo 创建，也不得产生默认日期、非法组合或待补全
  领域状态；Today 只使用已持久化的日期事实；
- Todo 相对 Reminder 只有在锚点角色和可调度时刻都唯一时才能持久化；普通“提前 X”在
  只有一个 start/due 时使用唯一锚点，同时有两个时不得建立隐藏优先级。date-only 不提供
  隐含钟点；已有相对 Rule 随合法锚点修改原子重算；
- 一次性相对 Reminder 的去重范围是同一 nominal Occurrence：新的未来 nominal time 可
  产生新实例，同一已消费 nominal time 不得因改期往返、revision 或重启再次投递；旧
  fired/dismissed/snoozed 历史不可改写；
- 显式移除 Reminder 后 Rule 进入不可恢复终态并永久停止生成未来 Occurrence，既有历史
  保持可解释；重新创建相同 Reminder 必须使用新 Rule 身份，不能复用旧 Rule 或让旧去重
  历史抑制新的明确用户意图；
- 同一 item 的 active Reminder Rule 满足确定性的 Canonical exact-duplicate 唯一性；不同
  调用、user turn 和并发写入不得产生语义完全相同的第二条 active Rule，重复请求不得
  增加 revision、Occurrence 或系统通知；
- 同一 item 的不同 Rule 在同一 exact effective fire instant 触发时保留独立 Occurrence，
  Reminder Center/Today 按渠道显示一个带多个原因的聚合项，同一系统通知渠道只投递一次；
  聚合动作必须可追溯地更新各自 Occurrence，重启不得重复投递；
- 同一 repeating Rule 的旧 snooze 等于或越过下一 actual nominal instant 时，由下一正常
  Occurrence 接替并停止旧实例未来投递；旧历史保持可解释，睡眠/重启跨过 cutoff 后不得
  补发旧 snooze，也不得改写下一实例或 Rule recurrence；
- 只有开始时间的 Event 以 `end` 未指定保存并正常进入 Calendar；不得追问、默认时长、
  写成 `start=end` 或改存 Note，Calendar 展示尺寸不得写回业务数据；
- 只有日期的明确 Event 以 date-only 保存，不追问、不假设全天或午夜；在 Calendar 和
  Today 显示但不参与时间段冲突，JSON round-trip 必须保留该时间形态；
- all-day 只由用户明确的全天时间范围或可信导入语义产生，不根据标题推断；它与 date-only
  在 Calendar、Today、冲突和导出语义中保持可区分，也不自动产生午夜 Reminder；
- Event 信息完整、Reminder 缺少可调度时刻的复合指令先保存 Event，并明确反馈部分成功；
  用户补充前不存在 Reminder Rule、Occurrence、系统通知或待补全领域状态。补充后附着
  Reminder 失败不得回滚 Event，使用独立幂等键重试时不得重复创建 Rule；
- date-only 或 all-day Event 的“提前一天”等相对日期表达在缺少具体钟点时仍不能创建
  Reminder Rule，不得暗中补 00:00、固定默认时刻或不可解释的调度时刻；Today 和 Reminder
  Center 在用户补全并持久化 Rule 前不得显示对应 Reminder；
- timed Event 的精确“提前 X”在未限定锚点时统一锚定 start，interval 与 start-only 的
  结果一致；解析为未来时刻时不追问并只创建一个 Rule，解析结果已经过去时不创建、补偿、
  立即触发或擅自改变偏移，Event 保持不变；
- absolute Reminder 在 Event 改期后保持固定；start-relative Reminder 保留相对关系并
  随 start 重算。Event、Rule、Occurrence 原子提交，锚点失效、重算到过去或 revision
  conflict 时不得留下部分更新、静默转换、静默删除或立即补发；
- Today 不得提供一个跨不同业务对象却产生不同 Canonical 副作用的通用动作。Todo/Event
  的日期变化必须由用户明确编辑时间事实；Reminder snooze 仅作用于当前 Occurrence；
- Reminder daily/weekly/monthly/weekdays 连续 20 次计算正确；DST 跳时、重复时、
  每月 31 日、换时区、睡眠跨多次触发都符合 6.2.4；
- 相同 `ruleId + nominalFireAt + timezone` 在重启/唤醒/crash replay 后只产生一个
  Occurrence；主动停用期间不补发，系统睡眠/崩溃按 missed 规则；
- 通知权限拒绝或投递失败时提醒仍进入应用内中心；重复点击通知动作只执行一次；
- UI 与 AI 使用旧 revision 写入时返回冲突，不覆盖最新版本；
- 当前右侧抽屉存在未保存草稿时，任何会销毁该编辑上下文的用户主动动作不得静默丢弃或
  隐式提交草稿。revision conflict 必须保留本地输入并展示最新安全版本，不自动覆盖、
  字段级合并或清除草稿；未保存草稿不作为 P0 持久化或崩溃恢复数据；
- 编辑目标已进入 Trash 或永久删除时，普通保存不得隐式复活、覆盖删除语义或自动创建
  副本。恢复原 item 和从草稿创建新 item 都必须是用户明确选择的独立写操作；新 item
  使用新 ID，不继承原 Reminder、revision 历史或身份，也不改写历史 `@Ref`；
- JSON round-trip 保留 ID、状态、提醒、标签、清单和 opaque ref；ICS 不支持的
  重复语义在预览中拦住；整批导入任一条失败不留下前半批数据。

### 10.5 File Workspace 和 Federated Search

- File Workspace 缺少、停用或 Product Surface v1 契约不兼容时明确拒绝激活；File Workspace
  失效不影响 Core 和其他插件，也不删除文件数据；
- File Workspace 生产包只消费 DSH/Hermit 经过资格验证的公开 package、typed slot 和
  service，内部 `src/*`、store、DOM/CSS 和私有 Host 路由依赖数量为 0；
- File Workspace 只呈现一个“统一文件树 + 当前文件编辑/查看”工作面；不存在独立 Library、
  Dashboard、快速记事页、文件详情、安全预览或 Needs Attention 页面；
- 快速记事原子创建正文为空的 managed Markdown 和 FileRecord，不插入默认文字；失败不
  留下空记录或半文件。它不绑定 Session，从任意 Session 关闭后重开仍是同一 FileRecord
  和正文；
- 根层级始终只有一个固定“快速记事”文件夹，空时也保留；文件夹本身不能重命名、移动、
  Trash 或永久删除，其中的普通文件仍可移动、Trash、恢复和永久删除。普通文件夹也只在
  根层创建，首版不支持重命名、嵌套、移动或文件夹 Trash；
- 具备编辑能力的 managed 文件输入后自动保存并产生 revision；通用文件信息区不显示保存
  状态。external 只在用户明确保存时写回，原件已变化时停止保存且不覆盖；未保存内容、
  保存失败和离开保护符合 6.3.4；
- 添加文件默认“复制到 Hermit”；首版任意普通文件均可纳管，同批可多选但不接受文件夹
  或递归扫描，默认目标是当前工作区文件夹并可在确认界面就地更改；external 入口待契约
  资格通过后再显示；
- 没有已资格通过 Editor/Viewer 的格式只显示可靠文件信息并说明当前不能预览或编辑；
  “可添加”不能被解释成所有格式都可编辑、预览、解析或用于 AI；
- 同名冲突不静默处理，只提供替换或跳过；替换保留现有 FileRecord 并增加 revision。
  “全部跳过”和“对其余冲突执行相同操作”不影响没有冲突的文件；
- 单文件复制或 external 登记必须原子提交；取消只停止未处理项，已完成项保留，失败结果
  可单独重试，不留下半个 ManagedBlob/FileRecord/revision，也不自动打开添加结果；
- external 文件经过添加、打开、工作区移动、单文件移除、插件停用
  或卸载后，原 path/identity/hash/mtime 不被 Hermit 修改；只有用户明确保存且无冲突时才写回；
- File Workspace 工作面内搜索只按文件夹名和文件名过滤，正文不进入插件自有搜索或索引；
  正文结果只能由 Core Federated Search 工作面提供，未完成安全材料契约前允许文件正文组
  缺席，不得用名称命中冒充正文命中；
- 用户选择 `@文件` 时只从最后成功保存的 revision 生成 projection；未保存内容不进入，
  发送和 read 时不自动刷新。只有移除并重新指定才生成新 projection；projection 不可用时
  不插入引用，官方 read 成功写入 Tool Result 后才算模型已经读取；
- missing、permission denied、password required、unsupported、parse failed、stale 等不
  作为文件树常驻徽标；执行相关动作时才显示准确原因，不能静默 fallback；
- managed 文件可进入 Hermit Trash；普通文件夹不进入 Trash，只能在为空时直接删除。单个
  external 只“从工作区移除”，不进入 Trash，任何删除/清空都不触碰磁盘原件；
- 恢复优先原工作区位置，原父位置不存在则根目录，同名自动生成“（已恢复）”唯一名称且
  不覆盖；永久删除/清空明确确认，P0 无自动清理、期限、批量恢复、全局 Undo 或 OS Trash；
- Federated Provider 超过 3 秒只让自己组显示超时，其他组正常；执行前后没有新
  建中央结果/query content 数据库；
- Core Federated Search 停用或 File Provider 尚未实现正文契约时，不影响 File Workspace
  浏览、名称过滤、编辑、快速记事、添加、`@文件` 和 Trash 闭环。

### 10.6 Smart Clipboard

- 插件进入 ACTIVE 后复制的受支持内容进入本地历史；暂停、停用或崩溃期间的新内容
  不进入 DB/FTS/blob，恢复后也不回补；
- 插件停用/崩溃后专用快速取回入口和后台捕获一起消失，Core 正常；
- 用户确认的 Smart Clipboard 专用快捷键可以在其他应用上直接呼出快速取回工作面，
  搜索和执行不要求先打开 DSH 主窗口；插件停用时该快捷键先注销；
- Windows/macOS 系统锁屏时快速取回浮层关闭且内容不可查看；插件保持原有 ACTIVE/
  Paused 状态，ACTIVE 捕获继续，解锁后不自动重开浮层；
- HTML/RTF 可以完成受控格式化回放和无格式粘贴，但预览/搜索只使用安全文本，
  处理过程 0 网络、0 脚本/事件执行；畸形/超大图片不造成 Host/UI 崩溃或超额内存；
- transient、concealed、auto-generated 等明确 exclusion marker、排除应用和
  “忽略下一次”正文在 DB、blob、FTS、诊断日志均为 0；
- plain/HTML/RTF 的精确同文本最终只有一个 ID，置顶不丢；不同 kind 永不合并；
- 从历史 Copy/Paste 不生成新记录；读取多格式期间 clipboard 被另一进程改变时
  不产生混合 Entry；
- 显式粘贴无权限、目标失效、UIPI/Wayland 限制或 clipboard 被覆盖时不提权、
  不发错误按键，退回 copy-only；
- P0 capability graph 中不存在 Clipboard Federated Search Provider；
- 捕获、存储、索引、搜索、预览和历史管理链路没有网络 capability，网络观察中
  clipboard payload 出站为 0；只有用户显式选择内容并发起 AI 动作后才交给 DSH；
- Clipboard file ref 默认只返回安全元数据；未重新经过 Core filesystem broker/
  File Workspace 授权时正文不可读，File Workspace 缺失不影响 Clipboard 其他能力；
- 一次性 AI ref 在指定 Session/turn/version 只读一次，换 Session/turn、删除或
  改版本后拒绝；read 前撤销不写正文，read 后删除 Entry 不影响既有 Tool Result；
- 历史保留、Trash、清空和导出行为符合插件 DESIGN 的当前规则；置顶内容不能被自动
  删除，容量无法释放时停止新捕获并提示，不静默删除或无界增长。

### 10.7 更新、恢复和一次性迁移

- Node/DSH/Core 坏时 Tier 0 Electron Recovery 仍可启动；坏 Product Plugin 或
  Tier 1 Safe Profile 不影响 Tier 0；
- 下载、签名后、备份、schema migration、validation、候选启动、pointer 临时写、
  原子替换、首次启动和首次写入各阶段 fault injection 后，重启恰好有一个可解释
  authority，没有半迁移 Canonical；
- 磁盘满时 staging 失败且旧 authority 不变；备份断电不损原 Canonical；派生索引
  损坏可重建；不可逆 schema 禁止单独降级代码；
- 迁移 rehearsal 重跑不产生重复，source-to-target ledger 可审计；
- authority commit 前断电仍是 Go，commit 后断电是 DSH；第一次新写后永不回 Go；
- freeze 后旧 Go lease 永久撤销；残留/重启的旧进程因 authority epoch 不匹配无法
  写入，不能只靠“不再启动”通过双权威测试；
- 旧 AI 只进入可查看/导出的 Legacy Archive；检测到未处置 Secret/Vault 时
  Cutover 按钮禁用，且不能导入 Smart Clipboard 或普通 JSON；
- OS credential backend 不可用时 Secret fail closed 且无明文 fallback，数据、
  设置、诊断和恢复页仍可打开；
- 诊断、日志、迁移报告、backup manifest 和 Plugin IPC 自动扫描不得出现测试
  API key/token、正文、Prompt、绝对路径或 Clipboard payload；
- 普通可取消任务点击后 100ms 内显示 cancelling，不再开始新副作用，合作停止
  p95 不超过 2 秒，隔离 worker 必要时 5 秒内终止；authority commit 按恢复协议
  完成，不把强制取消做成半指针。

### 10.8 UI 组件和视觉一致性

- Conversation、Composer、Session、Approval、Model、Permission、Settings shell
  没有 Hermit fork/reimplementation；
- Product Plugin 只从 `@hermit/ui` 的 `allowed` 公共入口消费经验证的 DSH 能力；业务包
  没有绕过该入口的私有 DSH import 或视觉等价物；
- DSH-mounted UI 的 `@deepseek-ai/**/src/*`、private CSS/class/DOM selector、
  Tailwind class/global reset 数量均为 0；
- Web client 只有一份与 DSH RC 兼容包一致的 React runtime；当前不能把其他 React
  runtime 打入解析为 18.x 的宿主页；
- 新颜色和状态全部来自 DSH semantic token；light/dark/system、200% zoom、键盘、长文、
  empty/loading/error/plugin unavailable 在 Inventory 或真实 Product Plugin 中验收；
- `@hermit/ui` 只有一个公共入口，领域组件和 Desktop UI 不进入该包；组件新增遵循
  `candidate -> qualified -> allowed`，不以第二套通用 UI 库作为默认 fallback；
- Component Inventory 和自动测试验证交互、可访问性、打包边界和 React 单实例，不锁
  padding、颜色值、README 或大面积 UI snapshot；
- DSH 更新必须先通过 exports、slot、token、React identity contract diff，再允许
  更新三平台视觉 baseline。

## 11. 模块确认状态

当前结论：模块 1 至模块 7 的长期产品边界已确认；最新产品变更后的详细设计和跨模块复核
尚未完成，当前状态不是终审 `PASS`，也不表示 Product Plugin 已可进入实现。

### 11.1 已确认

- P0 的正式 AI 回答只显示在 DSH 主 Conversation；
- 文件页面不为每个文件提供“问这个文件”按钮；
- 用户在主 Conversation 中通过 `@` 或其他统一机制引用文件；
- `@` 是所有已安装 Product Plugin 共用的资源选择入口，候选按 Provider
  分组显示；
- Core 不理解各插件业务 Schema，候选查询和引用解析归对应 Provider；
- P0 不新增 `@file/@todo/@session` 等硬语法；
- 结构化业务资源默认采用 Live Reference；File Workspace 在选择时捕获最近成功保存
  revision 的临时 projection，不额外保存 model-step evidence snapshot；
- 历史 `@Ref` 不允许自动刷新；File Workspace 只有移除并重新指定文件才捕获新的已保存
  revision，其他 Provider 只有用户在当前消息再次 `@` 才允许读取最新版本；
- 资源实际读取结果使用 DSH Tool Result 记录，后续源数据变化不修改旧结果；
- Core 不自动预读 `@Ref`；模型必须按需显式调用读取 Tool，没有成功结果就
  不能声称看过正文；
- 结构化业务资源统一使用 Core `resource_read(ref)`；Core 只路由和执行通用
  读取边界，Provider 负责权限、查询和 AI-safe projection；
- File 继续使用官方 `read` 读取选择时捕获的 projection；File Workspace 内只做名称过滤，
  正文和跨插件搜索由 Core Federated Search 发起，文件修改仍不走通用读取 Tool；
- 业务页面不保存或复制 AI 回答正文；
- P0 首条 Quick Panel 闭环为 `conversation.quick`，通过真实 DSH Session 提供紧凑对话；
- 正式环境只能通过 Package Gate 修改，开发环境与正式环境分开；
- 插件的界面、数据逻辑、Tool、搜索和后台任务作为同一个完整版本切换；
- 新版本必须先在旁边完整安装并真实试启动，全部成功后才替换旧版本；
- 版本、来源、完整性和依赖必须精确锁定，不使用 `latest` 或版本范围；
- 可选业务插件默认只硬依赖 Core；File Workspace 通过已资格通过的 Hermit Product
  Surface 公共契约进入 DSH，不依赖另一个业务插件；
- 未达到官方信任标准的社区代码不能直接进入正式 Core Host；
- 停用先拒绝新调用、撤下入口，再取消任务和停止后台活动；
- 卸载默认只删除代码和缓存，保留用户业务数据，删除数据必须单独确认；
- 外部原文件不因插件卸载而删除；
- 保留数据时默认保留至少一个已验证的精确恢复版本，用户可明确放弃此保障；
- 任意插件安装或升级失败时，原来的可用版本仍保持有效；
- 主窗口一级导航由 Core 管理，插件入口只在对应版本正常运行时出现；
- Quick Panel 的窗口由 Desktop Core 托管，内容和业务动作由 DSH 或对应 Product Plugin 提供；
- Quick Conversation 使用 DSH 正式 Session；从隐藏状态重新打开时每次从新的会话草稿开始，关闭窗口
  不删除已经创建的会话；只有打开主窗口时才显式绑定当前 `sessionId` 继续复用该 Session；
- Quick Conversation 使用无标题栏、非置顶、失焦不自动隐藏的普通窗口；这些是该 Surface 的具体偏好，
  不是所有 Quick Panel 或插件窗口的统一限制；
- Quick Panel 内触发 DSH 写操作时沿用正式 Session/Tool/Approval 流程，不自建第二套审批；
- 系统只有一个 Core Tray/菜单栏图标，只显示安全状态和不过期的计数；
- Quick Panel 和插件快捷键都必须由 Core 统一注册，具体默认组合按真实动作配置并在统一页面
  显示冲突或不可用状态；
- 开机启动和后台暂停都由 Core 管理，插件不能各自创建常驻入口；
- 可选插件不是 Core 启动条件，失效时一次撤掉导航、小窗口、Tray 和快捷键贡献；
- Personal Organizer 长期内容只有 Note/Todo/Event，不保留 Inbox 或无类型暂存态；
  Reminder 是挂在内容上的时间规则；
- 无法明确判断为 Todo 或 Event 的输入直接成为 Note；用户把 Note 明确改为 Todo 或
  Event 时保持同一 ID、内容、提醒和历史，不复制内容或打断引用；
- P0 支持简单重复提醒，不支持重复 Todo/Event、cron 和完整 RRULE；
- 系统通知失败不丢提醒；Organizer 从 SQLite 恢复 Reminder Rule/Occurrence，并在启动/唤醒/
  重启后重新计算下一次绝对时刻，再通过 Desktop Core deadline bridge 等待；Core 不保存提醒
  业务状态；
- 插件没有 AI、网络、File Workspace 或通知权限时仍能手工完整使用；
- 插件全文搜索和业务数据都由自己的 SQLite 负责，AI 只通过 DSH Resource/Tool；
- JSON 是无损格式，CSV/ICS 只作有限互操作，导入必须先预览再整批提交；
- Personal Organizer 没有可靠的成熟 DSH 社区插件可直接复用；日历、日期和
  SQLite 基础库可复用，领域模型、提醒和 DSH 适配自研；
- File Workspace 添加现有文件默认“复制到 Hermit”，创建 managed 副本；首版接受任意普通
  文件但不接受文件夹，external 长期语义继续保留，用户入口待契约资格通过后再显示；
- FileRecord、ManagedBlob、SecretLocator、revision、projection 和正文搜索派生物各自负责
  不同事实；外部绝对路径只进入私密 SecretLocator，工作区文件夹不代表磁盘目录；
- File Workspace 只有一个“统一文件树 + 当前文件编辑/查看”工作面，不建设独立文件库壳、
  快速记事页、文件详情、安全预览、分类、标签、收藏或 Needs Attention；
- 快速记事直接创建正文为空的 managed Markdown，不写入标题、模板、提示或示例文字，
  不建立另一份 Note 正文，也不属于 Session；根层固定“快速记事”文件夹不可重命名、移动
  或删除，其中的文件仍按普通 managed 文件管理；
- P0 第一条切片验证任意普通文件的 managed copy、组织和生命周期；Markdown 编辑作为下一
  条切片单独验收。其他格式没有已资格通过的能力时只显示通用文件信息，不扩展 OCR、
  PDF/Office 全格式解析、云盘、富文本副本或复杂文件管理；
- File Workspace 内只按文件夹名和文件名过滤；正文和跨插件检索属于 Core Federated
  Search，当前切片不预建 File Workspace 正文索引或用名称命中冒充正文结果；
- 选择 `@文件` 时从最后成功保存的 revision 捕获 projection；未保存内容不进入，发送和
  read 不自动刷新，只有移除并重新指定才捕获新 revision；成功 Tool Result 前不算 AI 已读；
- AI P0 不得导入、分类、修改、移动、Trash、恢复、永久删除文件或操作任意路径；
- managed 文件进入 Hermit Trash 并可恢复；普通文件夹不进入 Trash，单个 external 只从
  工作区移除；任何删除、清空或插件卸载都不删除或移动 external 磁盘原文件；
- Federated Search 按来源分组，不复制数据、不比较跨源分数、不使用 AI 总结；
  某个 Provider 超时、崩溃或卸载只影响自己的结果组；
- Hermit Product Surface v1 是 File Workspace 的唯一 UI 宿主；它不拥有 FileRecord、
  managed/external、索引或 Trash。当前不引入社区 File/KB 或辅助栏插件作为运行时依赖；
- Smart Clipboard 安装并进入 ACTIVE 后默认捕获；暂停、停用或崩溃期间不记录，
  恢复后不回补；
- P0 保存精确纯文本、受控 HTML/RTF 格式表示、规范化图片和文件引用，不保存未知对象；
- transient、concealed、auto-generated 等明确 exclusion marker 直接跳过；插件不做
  内容敏感度启发式分类或 `MASKED/Reveal`；
- 显式粘贴是可降级便利能力，失败时可靠退回“已复制，请手动粘贴”；普通复制不额外
  发送粘贴按键；
- P0 不注册 Clipboard Federated Search Provider，AI 不能列出或搜索完整历史；
- AI 只能读取用户明确选择的单条、当前 Session/本轮一次性引用；成功 Tool Result
  留在会话后，删除 ClipboardEntry 不会删除会话历史；
- 捕获、索引、搜索和历史管理没有网络能力；只有用户显式发起 AI 动作时，所选内容
  才能交给 DSH；
- 历史保留、Trash、清空和导出采用 Smart Clipboard DESIGN 的当前规则；置顶不自动
  删除，容量无法释放时停止捕获并提示；
- P0 使用 OS 私有数据目录和严格权限，不自建静态加密或宣称 Vault；
- Maccy 仅选择性复用 macOS 原生桥接逻辑，不复用数据库、UI、Tray、快捷键或
  更新器；arboard/EcoPaste 可有限复用/二开，Canonical 数据和 DSH 边界自研；
- 最终架构采用 Electron 薄桌面壳，Node/TypeScript + DSH/Cordis 是 Core 和插件
  运行时，目标进程树完全移除 Go；
- Node 使用 Active LTS 线上经过全套验证的 24.x 兼容范围，与 DSH、lock、native addons
  作为同一个签名 Core generation；
- 正式凭据通过 OS Keychain/Credential Manager/Secret Service，禁用明文 local
  credential provider，Linux 凭据后端缺失时 fail closed；
- Safe Mode 分为不依赖 Node/DSH 的 Electron recovery screen 和 DSH Safe Profile；
- 代码 generation 与数据 generation 成对切换，不可逆 schema 产生新写入后不
  自动恢复旧 snapshot 或单独降级代码；
- 迁移 rehearsal 可重复但不改旧权威；最终 authority pointer 只切一次，切换前
  可回 Go，切换后永不再用 Go 读写业务；
- 旧 AI 历史只进只读 Legacy Archive；未处置旧 Secret/Vault 会阻止切换，绝不
  进入 Smart Clipboard、普通 JSON 或诊断；
- Windows/macOS 通过完整发布门，Linux 按实际 WebView/Tray/shortcut/clipboard/
  isolation capability 降级。
- UI 采用 DSH 官方优先混合路线：官方 shell/Conversation/Settings/primitives/token
  直接复用，Hermit 只补业务 wrapper；新目标 UI 使用 CSS Modules，不使用 Tailwind；
  React identity 随 DSH RC 兼容包，当前 compatibility lock 位于 18.x 范围。

### 11.2 当前审查状态

模块 1 至模块 7 在上一轮规则下完成过跨模块终审，历史结果为 `PASS`。2026-08-27 至
2026-08-28 用户随后确认了新的产品方向：

- Smart Clipboard 改为 ACTIVE 即捕获，删除额外隐私 onboarding 和内容敏感度启发式；
- File Workspace 当时曾采用辅助栏宿主，并收敛为统一文件树和当前文件
  编辑/查看的单一工作面；增加 managed Markdown 快速记事，添加文件默认 managed copy，
  插件内只做名称过滤，正文归 Core Federated Search；`@文件` 选择时捕获最近成功 revision
  的 projection，managed 使用轻量 Trash，external 单文件只从工作区移除；
- Product Plugin UI 收敛为未来唯一共享包 `@hermit/ui`，具体 DSH 公共组件仍需通过
  `candidate -> qualified -> allowed` 资格验证。

这些方向已经写入当前需求，但改变了上一轮终审的前提，因此历史 `PASS` 不再代表当前
审查结果。Personal Organizer 的 `DESIGN.md` 目前为 `DISCOVERY`；File Workspace 的产品
设计已达到 `READY_FOR_IMPLEMENTATION`；此前的辅助栏宿主资格验证只保留为历史研究，
当前实现已改用完成资格验证的 Hermit Product Surface v1，不再以辅助栏或双宿主布局作为
实现 gate；Smart
Clipboard 已为 `FUNCTIONAL_SCOPE_FROZEN`，M1/M2 领域、SQLite/FTS、桌面工作面、完整 History
和 macOS 原生 micro-adapter 已实现并通过未签名成品 E2E；
Hermit Product Surface v1 已按 ADR-0003 落地并通过同一插件 artifact 的 stock/Hermit 双宿主
资格。当前无人值守资格不触碰用户 General Pasteboard，真实写回/显式粘贴/物理快捷键、
签名发行和 Windows/Linux 原生切片仍未完成，因此不能
宣称跨平台发布就绪。UI foundation 当前为 `PARTIAL`：Product Surface 和 Smart Clipboard
实际使用的导航 Button/图标已 qualified，其余候选与 `@hermit/ui` 尚未执行。

恢复终审 `PASS` 必须同时满足：三个 Product Plugin 的关键流程、状态、边界和首条纵切
达到 `READY_FOR_IMPLEMENTATION`；UI 公共面资格结论与插件设计一致；再按更新后的依赖、
权限、生命周期和卸载规则完成一次跨模块复核。在此之前，可以继续 M1 底座资格、详细设计
和已经达到 slice-local readiness 的切片；不能把单条切片 READY 冒充整个 Product Plugin
或全产品已经实现就绪。

### 11.3 下一阶段非阻塞详细设计

以下内容必须在代码开发前形成独立详细规格，但不阻止本核心需求冻结：

- grant 的持久化 schema、消费原子性以及 expiry/read-count 并发语义；
- candidate generation 切换和 crash recovery 状态机；
- Approval + callId mutation 去重的事务边界与结果保留策略；
- File/Clipboard broker 的 token/path 生命周期、图片规范化和大小上限；
- File Workspace 真实 Core managed read/save transport、revision 持久化事务和冲突结果契约；
- Core Federated Search 与 File Workspace 之间的正文安全材料、查询、排序和打开引用契约；
  该契约完成前不实现插件内正文索引，也不把名称过滤冒充正文搜索；
- Smart Clipboard 完整 History、快捷键唤起后的快速取回交互、保留额度、格式化回放
  和显式 AI 入口；
- Reminder occurrence/snooze 状态机；
- authority epoch/lease 的启动、迁移和故障恢复协议；
- 旧 Item/File/Reminder/AI/Vault 字段到新数据模型的逐字段 Migration Mapping；
- 依据第 9 节页面树重新生成并验收高保真原型，旧 Vault 原型不得进入 P0。
- 对最终 pinned DSH 做 top-level route、spacing/radius/density token 和 portal/z-index
  公共 contract spike；未确认前不依赖私有实现。

项目仓库、工具链、PR0、第一条 Core-only vertical slice、GitHub/CI 和社区插件
开放顺序见 `start-readiness.md`。已确认 Day-1 只新建 Private
`pgw10086/hermit-vnext`，公开门通过后以 Apache-2.0 开放；本地仓库位于
独立 checkout，当前 Mac 路径为 `/Users/pgw/Developer/codes/hermit-vnext`，不在旧仓库内
创建嵌套 vNext 仓库。checkout 的绝对路径只是机器事实，不属于产品兼容契约。
