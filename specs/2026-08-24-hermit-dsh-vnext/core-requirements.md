# Hermit DSH vNext 核心需求确认稿

状态：核心需求、UI 组件路线和 Private incubation 启动策略已确认；
`pgw10086/hermit-vnext` 文档/目录 bootstrap 进行中
更新时间：2026-08-25
当前确认模块：全部完成

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
- Personal Organizer 安装后贡献未整理 Inbox capture、Note/Todo/Event 等候选；
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
候选只绑定稳定 FileRecord；纯文本可映射到受控 path，PDF/Office 则
生成带 locator 的安全 UTF-8 projection，再由模型显式调用官方 `read`。Organizer
业务引用由 Organizer Provider 按自己的安全投影规则解析。

#### 4.1.2 Live Reference 策略

已确认选择简单的 Live Reference 方向：Session 不在资源被选中时额外保存一份
业务内容快照，只保存 Provider 和稳定引用。

`@` 同时代表本轮读取授权：

- 当前用户消息中新出现的 `@Ref` 可以读取数据源当前版本；
- 实际读取结果以 DSH Tool Result 形式进入 Session 历史；
- 以后继续旧对话时只使用旧 Tool Result，不允许模型根据历史 `@Ref` 自动读取
  数据源最新版本；
- 用户必须在新一轮再次 `@` 同一资源，才建立新的读取授权和新的 Tool Result；
- Provider 被卸载后，旧 Tool Result 仍可查看，新读取返回 Provider unavailable。

已确认：本轮出现新 `@Ref` 后，Core 不自动预读。模型在确实需要内容时必须
显式调用 DSH Tool：

- 没有成功 Tool Result，模型不能声称已经看过资源正文，也不能根据标题猜测；
- Tool 执行时按当前权限读取 Provider 提供的 AI-safe projection；
- 普通选择、取消输入或未实际依赖该资源时，不读取业务正文；
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
跨 Provider fallback。搜索和写入仍由 Product Plugin 的业务 Tool 承担。

File 不强行接入 `resource_read`，继续使用 DSH 官方有界 UTF-8 `read` 的 path、
offset 和 limit 语义。文件 containment、只读 AI filesystem scope 和可选的
read-before-write observation policy 由 Hermit Core adapter 显式提供，不能把它们
误写成 `read` Tool 自带的安全保证。

#### 4.1.4 Reference、Provider 和本轮授权

持久化 Ref 与本轮授权必须分开：

```text
持久化 Ref = referenceProtocolVersion + providerId + opaqueRef + displayLabel
本轮授权 = actor + workspace + session + turn + providerId + ref + read-only
```

- Ref 是门牌号，不是门票；不能保存 `authorized=true`；
- `referenceProtocolVersion` 是 envelope 协议版本，不是业务对象 revision；对象的
  observed revision 只在实际成功读取的 Tool Result 中记录；
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

### 4.2 插件单独安装也必须有完整价值

每个 Product Plugin 单独安装在 Core 上，都必须覆盖：

```text
数据进入 -> 管理 -> AI 操作 -> 持久化 -> 搜索/历史 -> 数据退出
```

可选插件之间不得形成硬依赖。移除一个插件，只能让它自己的页面、Tools、
后台任务和数据入口消失，不能导致 DSH 或其他插件无法启动。

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
|   |-- Unified Quick Panel
|   |-- Tray / Status Host
|   |-- Shortcut Registry
|   |-- Typed Command Bus
|   |-- Federated Search Host
|   `-- Embedding Gateway（P0 可暂不开启）
|-- Personal Organizer（首发业务插件）
|-- File Workspace（首发业务插件）
`-- Smart Clipboard（后续业务插件）
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
- 统一 Quick Panel、状态栏/托盘和快捷键；
- 联邦搜索入口；
- 最低限度的诊断、Safe Mode、更新和恢复。

### 6.2 Personal Organizer

当前方向和模块 4 完整业务闭环：已确认。

核心价值：安装后就是一套本地个人事务工具。没有 AI、File Workspace、网络
或系统通知权限时，用户仍能记录、整理、完成、提醒、搜索和导出。

#### 6.2.1 用户只需理解三个内容和一个时间能力

```text
笔记：记东西
待办：有一件事要做完
日程：有一段时间被占用
提醒：在指定时间提醒上面这些内容
```

- 长期内容只有 Note、Todo、Event 三类；
- Reminder 不是第四份重复正文，而是挂在内容上的时间规则；
- “新建提醒”默认创建一个最小 Note 并加提醒。用户明确勾选“这是一件要完成
  的事”时才创建 Todo；
- Inbox 也不是第四类内容，只表示“已经存下，但还没决定是什么”。

统一记录具有稳定 ID、可空类型、`triage_state`、标题、正文、标签、revision、
创建/修改/删除时间、捕获来源、捕获原文和可选外部引用。`kind` 只能是
Note/Todo/Event 或空；`triage_state` 只能是 inbox/organized。收件箱记录的 kind
为空，整理后在同一事务中设置 kind 并把 triage_state 改为 organized。

| 类型 | 主要字段 | 业务状态 |
|---|---|---|
| Note | 标题、正文、标签、置顶 | active / archived |
| Todo | 详情、清单、开始/截止、优先级、标签 | planned / completed / canceled |
| Event | 详情、开始/结束/全天、地点、标签 | scheduled / canceled |

Trash 不混进业务状态，只通过 `deleted_at` 表示。因此 planned Todo 进垃圾箱再
恢复仍是 planned，canceled Event 恢复后仍是 canceled。已经过去的 Event 仍
是 scheduled，只在界面派生显示“已过去”，不自动假装已完成。

日期必须区分“只有日期”和“具体时刻”。“8 月 28 日截止”不能偷偷变成 UTC
零点。定时日程保存 UTC 时刻和 IANA 时区；全天日程保存本地开始日期和不包含
最后一天的结束日期。

#### 6.2.2 捕获和收件箱

插件页面允许用户明确选择 Note、Todo 或 Event 手工创建。Quick Panel 的
“存到收件箱”只保存原文，不用本地关键词规则假装 AI 分类。

```text
Quick Panel 输入“周五跟老王吃饭，可能晚上七点”
-> 创建 item #A17，kind=null，triage_state=inbox，原文完整保留
-> 用户选择“整理为日程”
-> 仍是 item #A17，设置 kind=event、triage_state=organized 并补充时间
-> 原始捕获文本和 inbox -> event 历史仍保留
```

Inbox 转为 Note/Todo/Event 时不复制、不换 ID、不删除旧记录，因此历史、搜索
和已存在的 `@Ref` 不会断。P0 不提供已整理 Todo 与 Event 之间任意互转，避免
含糊映射字段。

收件箱原型：

```text
| 收件箱 4                              + 手工捕获   |
|----------------------------------------------------|
| “周五跟老王吃饭，可能晚上七点”                    |
| Quick Panel · 12:31                                |
| [整理为笔记] [整理为待办] [整理为日程]            |
|                                                    |
| 原文永远保留。这里不自动猜类型。                  |
```

#### 6.2.3 页面和 Today

一级页面为：今天、收件箱、待办、日程、笔记、提醒中心、搜索、垃圾箱。详情和
编辑复用同一套实体编辑器；导入/导出从插件“数据与存储”设置进入。P0 日历只做
周视图和列表视图；今天页面已经完成日视图，完整月历放到 P1。

Today 固定展示四组：逾期待办、今天待办、今天日程、今天提醒。用户可以手工
排序和固定，但 Today 排序属于单独的视图数据，不能偷偷改写 Todo priority。

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

插件本地全文搜索覆盖标题、正文、清单、标签、地点和 Inbox 原文，可按类型、
状态、日期和标签筛选；默认不依赖 Embedding。中文/CJK 分词必须用真实语料验证，
不能假定英文 FTS 配置已经够用。

向 Core Federated Search 只返回安全的 title、snippet、time 和 opaque ref，选中
后打开 Canonical 详情。外部文件引用不可用时显示“当前不可打开”，不影响事项
阅读、修改、完成、搜索或提醒。

AI 只能在真实 DSH Conversation 中工作：

- `@` 选择未整理 Inbox capture 或 Note/Todo/Event，`resource_read` 读取 AI-safe
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
  ID、revision、kind/triage_state、捕获原文/转换历史、标签、Checklist、Reminder
  Rule/Occurrence、Trash 和 opaque ref；Todo CSV 和 Event ICS 只是互操作格式，
  界面明确哪些信息会丢失；
- ICS P0 只处理普通非重复 VEVENT，遇到 RRULE、RECURRENCE-ID 等不支持内容
  必须在预览中拦住，不能悄悄只导入第一条；
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

自研：Item/Inbox/Note/Todo/Event 模型、提醒规则与触发记录、调度恢复、DST 规则、
Today、无损 Inbox 转换、revision 冲突、DSH Resource/Tool 适配、通知幂等、FTS
查询、导入预览、Trash/恢复/永久删除和安全审计。DSH API 仍处开发预览期，这些
业务层不得直接 import DSH 私有 UI，只通过可替换 adapter 连接。

### 6.3 File Workspace

当前方向和模块 5 文件业务闭环：已确认。

核心价值：安装后就是一套不依赖 AI 的本地文件工作台，可以导入、预览、组织、
搜索、打开、移除、恢复和导出文件。

#### 6.3.1 文件归属先说清楚

内部有 external 和 managed 两种模式，但界面不把术语丢给普通用户：

```text
| 导入 36 个项目                                  |
|-------------------------------------------------|
| 文件要放在哪里？                               |
|                                                 |
| (*) 保留在原位置（推荐）                       |
|     Hermit 只建立链接和搜索索引，不移动或删除  |
|                                                 |
| ( ) 复制到 Hermit 文件库                       |
|     Hermit 保存自己的副本，之后可整理和删除    |
|                                                 |
| [ ] 以后默认这样做                              |
| [取消]                              [继续]      |
```

- 首次默认“保留在原位置”；
- 只有用户主动勾选“以后默认这样做”才记住选择，每批仍显示当前模式并可切换；
- 保留原位置：外部原文件属于用户或其他系统，Hermit 不改名、不移动、不删除；
- 复制到文件库：Hermit 管理自己的副本，承担完整性、内部 Trash、恢复和导出；
- 即使两个文件内容 hash 相同，也可以是两个 FileRecord。managed 模式可在底层
  共用一份 blob 节省空间，但用户看到的两条记录和组织方式仍相互独立。

#### 6.3.2 哪些数据是真正的原件

| 对象 | 是否不可替代 | 说明 |
|---|---|---|
| 外部原文件 | 是，但由用户/外部系统拥有 | Hermit 永不替用户删除 |
| ManagedBlob | 是，由 File Workspace 拥有 | 用户明确复制进来的文件内容 |
| FileRecord | 是 | 稳定 ID、显示名、状态、revision 和组织关系 |
| SecretLocator | 是，属于私密定位层 | 绝对路径、书签、卷/文件身份和权限 |
| 标签、集合、收藏、关系 | 是 | 用户自己整理的数据 |
| 解析文本、FTS chunk、缩略图 | 否 | 可换解析器后重新生成 |
| Safe AI text projection | 否 | 当前版本临时生成的只读 UTF-8 材料 |
| Watcher event | 否 | 只表示“文件可能变化了” |

FileRecord 保存稳定 ID、mode、display name、声明/检测类型、size、content hash、
locator/blob 引用、revision、source fingerprint、parser/version、访问/解析/索引
状态、创建/修改/删除时间。绝对路径不直接放进普通记录，而由 `locator_id` 指向
SecretLocator。

SecretLocator 绝不能进入列表、安全搜索结果、FTS、普通日志、遥测、AI Tool
Result 或 Resource Picker 候选。content hash 也不是文件身份，不能用路径或 hash
计算稳定 file ID。

访问、解析和索引状态分开表达：

- access：available、missing、permission denied、relink required、offline；
- parse：pending、parsing、ready、unsupported、password required、too large、
  failed、stale；
- index：pending、ready、stale、excluded、failed。

#### 6.3.3 页面和导入闭环

P0 一级页面为：概览、文件库、集合与标签、搜索、垃圾箱。“正在导入”是短任务，
使用全局进度抽屉和文件库筛选；“无法读取”是长期问题，作为需处理 badge/smart
view 保留，不单独占一级导航。

```text
| 文件库                         + 导入   搜索     |
|------------------------------------------------|
| [全部] [处理中] [需处理] [收藏]               |
|                                                |
| Q3 Report.pdf      PDF · 37 页      已建立索引 |
| Budget.xlsx        XLSX · 4 sheets  已建立索引 |
| Contract.pdf       需要密码         仅可打开   |
|                                                |
| 导入任务：128 / 300                    [查看]  |
```

导入不先创建正式 FileRecord，而是：

```text
选择文件/文件夹和归属方式
-> ImportJob / staging item
-> 检查路径、权限、symlink、类型、大小和安全边界
-> 计算 hash 并展示重复处理选择
-> external 创建私密 locator，managed 原子复制和校验 blob
-> 数据库事务提交正式 FileRecord
-> 隔离解析
-> 分块和 FTS
-> Ready
```

- 文件夹先显示文件数、总大小和不支持项，可取消并恢复未完成任务；
- 默认不跟随 symlink，必须使用 lstat/realpath 和 root containment，明确排除
  Hermit/DSH 私有状态目录；
- managed 使用同卷临时文件，流式复制/hash、fsync、核对 size/hash 后原子改名，
  永不覆盖同名文件；
- 取消时已完整提交的文件保留，未完成项不留下半个 blob 或坏 FileRecord；
- 重复项由用户选择跳过、保留两条或替换记录。“替换记录”只更新目标 FileRecord
  和 revision，绝不覆盖 external 原文件。

#### 6.3.4 P0 支持格式和安全预算

完整解析并支持正文搜索：TXT、Markdown、CSV-as-text、HTML、PDF、DOCX、XLSX、
PPTX。这里只支持无宏的 OOXML，不支持旧 `.doc/.xls/.ppt` 或宏格式。

只登记元数据并尽可能生成安全缩略图：JPEG、PNG、WebP、GIF 首帧。SVG P0 只
登记，不直接内联渲染。

只登记、不解析正文：ZIP/7z/TAR、音视频、EML/MSG、EPUB、代码仓库、旧 Office、
宏 Office、加密/密码 PDF 和未知二进制。密码 PDF 显示“文件已加入，但 Hermit
不会保存或代填密码，因此不能搜索正文”。P0 不做 OCR。

首版默认预算如下，经过恶意样本和性能测试后才可调大；超限时登记元数据但不
偷偷只索引前半段：

| 项目 | 默认上限 |
|---|---|
| 单文件登记/managed copy | 2 GiB |
| TXT/MD/CSV/HTML 正文解析 | 50 MiB |
| PDF | 200 MiB / 2,000 页 |
| DOCX/XLSX/PPTX 压缩体 | 100 MiB |
| OOXML 展开总量/条目数 | 512 MiB / 10,000 |
| XLSX | 200 sheets / 50 万非空单元格 |
| PPTX | 1,000 slides |
| 图片缩略图输入 | 50 MiB / 50 MP |
| 单文件抽取文本/chunk | 25 MiB / 20,000 |
| 文件夹深度/单批文件数/总量 | 32 / 10,000 / 20 GiB |
| 普通/PDF Office 解析时间 | 60 秒 / 120 秒 |
| parser RSS/硬上限/默认并发 | 512 MiB / 1 GiB / 2 |

解析器必须运行在独立进程和可验证的 OS 隔离中，Node Worker Thread 不算安全
隔离。解析进程无网络、不继承 token/credential、输入只读、只能写专用 temp、
不能启动 shell，并限制 CPU、内存、时间、输出和进程树。宏、DDE、OLE、外部
relationship、脚本、远程图片/字体、嵌套压缩包一律不执行或抓取。某文件或某类
parser 连续崩溃时熔断该 parser，不拖垮 File Workspace 或 Core。

#### 6.3.5 预览、变化和重新定位

```text
| Q3 Report.pdf · 第 14 / 37 页       | 文件信息   |
|--------------------------------------|------------|
| ... quarterly revenue increased ... | PDF · 8 MB |
|             ^ 搜索命中               | #财务 #Q3  |
| [上一页]                   [下一页]  | 季度报告   |
|                                      | 所在位置 > |
|                                      | [重新解析] |
```

- HTML 不运行原页面；script、iframe、style、事件、远程资源全部禁用；Markdown
  raw HTML 默认关闭，所有解析输出转义和安全化；
- 大文件分页/分段读取，预览不代表模型已经读取；
- watcher 只是变化提示。真正预览、搜索刷新或 `@` 读取前重新核对 fingerprint/
  hash，网络盘、云占位文件和平台 watcher 都不能当强一致来源；
- hash 未变不升 revision；hash 改变则 revision +1，旧解析和索引标 stale；
- stale 预览可显示但顶部必须写“这是上次解析的内容，原文件已经变化”，旧内容
  退出当前搜索且不能作为当前 `@` 读取，重新解析后才恢复；
- 找不到文件时进入 missing/relink required。用户手工选择新位置，系统显示 hash/
  identity 是否匹配，用户确认后保持原 file ID；不能只因 hash 相同自动绑定别处。

#### 6.3.6 全文搜索/BM25 和定位

SQLite FTS5/BM25 是 P0 正式搜索实现，但仍是可重建索引，不是用户原件。

- 拉丁文普通查询走 unicode61；
- CJK 三字及以上可走 trigram；
- 一至二个汉字使用有范围限制的 literal/LIKE fallback；真实中文语料 benchmark
  不达标时再增加自研 unigram/bigram 派生索引；
- 发布前至少用 200 个带人工标准答案的简中、繁中、中英混排、标点、数字日期、
  一字、二字和三字以上查询做召回与性能门禁。

每个 chunk 保存 file ID、revision、顺序、类型、locator、text hash 和标准化文本。
定位规则为：文本/Markdown/HTML 到标题、段落或行；PDF 到页码和文本偏移；DOCX
到段落/标题；XLSX 到 sheet+cell/range；PPTX 到 slide+shape/order。

```text
输入关键词
-> 只查询 current revision 的 FTS chunks
-> Provider 内部 BM25 排序
-> 返回 snippet + locator + revision
-> 打开文件详情
-> 跳到页/段/Sheet+Cell/Slide
-> 用户核对原文
```

PDF P0 至少保证跳到正确页，只有文本层映射可靠时才承诺精确高亮。点击旧 revision
结果时不能假装 locator 仍对应新正文。

返回搜索结果和执行 `@` read 前都重新核对 FileRecord/source revision。内容不一致
统一返回 `STALE/REPARSE_REQUIRED`，原文件消失返回 `MISSING/RELINK_REQUIRED`；
旧 chunk 或 locator 不能在验证失败后继续当当前事实。

#### 6.3.7 `@` 文件和 AI 边界

DSH 官方当前 `@file` 主要是 session cwd 下的 path-only 引用，官方 `read` 是有
行数/字节预算的 UTF-8 文本读取；PDF/Office 并非官方 read 原生能力。因此：

- 直接复用官方 Session、durable Tool Result、file-reference/read 语义；
- Hermit Core 自研多 Provider Resource Picker 和非文本文件的安全 UTF-8
  projection bridge；
- “AI filesystem scope”是 Core-owned capability/broker，由它签发短期只读 path/
  projection 能力；File Workspace 只是 Provider，不能因此成为 Core 或其他插件的
  硬依赖；
- File Workspace 提供当前、已验证、带页/段/Sheet/Slide locator 的只读 projection；
- 用户本轮重新 `@` 时只绑定稳定 file ID 和本轮读取授权；真正执行 read 前核对
  当前文件和 projection，Tool Result 记录实际 observed revision；
- 官方 read 成功并写入 durable Tool Result 后，模型才算真正读到；
- 历史 `@file_id` 本身不能再次授权或自动读最新版本；旧回答继续使用当时包含
  observed revision 的 Tool Result。用户新一轮再次 `@` 才读取当前版本；
- 不为了旧 mention 保存每一版完整文件；已成功的历史 Tool Result 本身继续留在
  Session。旧 Tool Result 已被单独 purge 时返回 placeholder，不重新物化旧版。

P0 暴露给 AI 的 File Tool 只有：search_files、get_file_metadata、
update_file_organization。后者只改 tags、collections、favorite，必须带 expected
revision 且可撤销。

import、reparse、trash、restore、purge、relink、export、open original、路径改名/
移动、删除外部文件和批量操作都只允许用户从 UI/Host command 发起，不向模型
暴露。AI 写操作启用前，实际锁定的 DSH build 必须通过跨 Session、跨连接和跨
调用方审批授权回归；未通过时先开放只读 AI 能力，关闭 mutation Tool。

#### 6.3.8 删除、恢复、停用和重装

- external Trash 只隐藏 Hermit 记录和索引，原文件不动；恢复保持 ID；永久删除
  只删 Hermit FileRecord、SecretLocator 和派生数据，仍不删原文件；
- managed Trash 使用逻辑 tombstone，不为 content-addressed blob 物理搬目录；
  永久删除记录后引用计数减一，只有最后一个引用消失才删 blob；
- 不自动清空 Trash；
- Canonical DB 和 managed blobs 位于插件安装目录之外。停用/卸载只撤 UI、
  Provider 和 Tool，不碰数据；重装后校验 schema、迁移、重开数据并按需重建派生物；
- “卸载 File Workspace”和“删除我的文件库”必须是两个完全不同的操作。

#### 6.3.9 复用、借鉴和自研

DSH 官方直接复用：Session、durable Tool Result、read/read_image、file-reference
语义以及 capability/cancellation/fs/approval 模式。统一 Resource Picker、非文本
projection 和 File Workspace 领域能力由 Hermit 自研。DSH 固定到测试通过的
commit + 完整 `@deepseek-ai/*` lock + 回归矩阵，不跟 `latest/next` 漂移。

直接复用候选（锁定精确安全版本）：

- SQLite FTS5/BM25/snippet；
- PDF.js：约 53k 星、Apache-2.0，用于 PDF 解析/渲染；
- Mammoth.js：约 6k 星、BSD-2-Clause，用于 DOCX 抽取，输出仍按不可信处理；
- Chokidar：约 12k 星、MIT，只把 watcher 事件作为变化 hint；
- fflate、react-markdown(raw HTML off)、DOMPurify；
- file-type 只作 magic-number hint，不作为安全证明，并固定到已修复已知问题的版本。

有条件二开/复用：SheetJS CE 只 vendor 审查过的精确 commit 处理 XLSX，并跑恶意
样本；Sharp 只有精确版本通过 libvips 安全门才启用，否则图片降级为 metadata-only；
officeParser 只借鉴 PPTX/XLSX 测试与 API。

只借鉴的 DSH 社区项目：dsh-knowledge-base、dsh-knowledge、
dsh-session-search-pro 等。目前它们收藏低、出现时间短，部分自带 ctx.llm、RAG、
embedding 或自己的 KB 数据模型，不满足正式依赖标准。P0 不直接安装任何社区
File/KB 插件作为运行底座。

自研：FileRecord/SecretLocator、ManagedBlob/refcount、ImportJob 原子提交、parser
supervisor/OS 隔离、PPTX 窄文本抽取、chunk/locator、CJK query router、文件 UI、
stale/relink/Trash、Resource adapter 和下节 Federated Search 契约。

### 6.4 Smart Clipboard

当前方向和模块 6 完整业务闭环：已确认。它是后续可选 Product Plugin。

核心价值：安装后就是一套 Maccy 风格的本地剪贴板管理器。没有 AI、网络、
Organizer 或 File Workspace 时，捕获、搜索、置顶、预览、复制/粘贴、清理和
导出仍然完整。

#### 6.4.1 首次启用和捕获范围

新安装默认不记录。插件 ACTIVE 后 Quick Panel 可以出现“剪贴板”模式，但首次
只显示隐私说明，用户明确点击后才启动监听：

```text
| 剪贴板                                      |
|---------------------------------------------|
| Smart Clipboard 当前没有记录任何内容。      |
|                                             |
| 剪贴板可能包含账号、验证码和私人内容。       |
| 只有你主动开启后才开始记录，AI 默认看不到。 |
|                                             |
|          [开始记录剪贴板]                   |
|                                             |
| 默认保留：30 天 · 1000 条 · 500 MiB         |
```

- 手工暂停与系统锁屏是两个独立原因；锁屏立即隐藏面板、暂停捕获，并让尚未读取
  的 AI 临时引用失效；
- 解锁后只在用户原本已开启且没有手工暂停时恢复；
- 停用、锁屏或崩溃期间不记录，也不伪造回补系统已经丢失的剪贴板历史。

P0 Canonical 格式只有 TEXT、IMAGE、FILE_LIST：

- TEXT 保存精确 UTF-8；HTML/RTF 只作为输入来源，转为安全纯文本后丢弃原始
  富文本，不执行脚本、事件或远程请求；
- IMAGE 接受 PNG/JPEG/WebP 用户语义及 TIFF/DIB 等系统输入，安全解码、应用
  orientation、去除 metadata 后建议统一存 PNG；
- FILE_LIST 只保存本机文件引用和安全显示名，不读取、复制或索引文件正文；
- 未知/custom body、虚拟文件 promise、远程 URL 文件和任意序列化对象不保存。

文件引用以后若要让 AI 读正文，必须重新走 File Workspace 的独立授权，不能
因为路径曾出现在 Clipboard 就自动扩大权限。

#### 6.4.2 数据、敏感内容和去重

ClipboardEntry 保存稳定 ID、kind、payload/blob 引用、content hash、创建/最近
使用时间、稳定 source app ID、来源可信度、输入格式、置顶/删除时间、大小、
敏感分类和 payload version。source executable path 和 window title 不持久化，
不进 FTS、日志或 AI。

敏感内容不是一个简单 bool：

- 系统或密码管理器提供的高可信 transient/concealed/exclusion marker 直接跳过，
  不创建 Entry、不写 FTS、不把正文落盘；
- 用户手工标记或低可信启发式只把已有 Entry 设为 MASKED，默认遮挡，不建正文
  FTS、不显示 snippet；
- 不承诺识别所有密码、验证码、无痕窗口或来源应用。排除应用列表和暂停捕获仍
  是用户可控的主要防线；
- source app 只作 best effort 筛选和显示，不能当安全认证。

去重规则：

- 同一次系统事件的 plain/HTML/RTF 合成一条 TEXT；
- TEXT 按原文 UTF-8 bytes hash，不 trim、lowercase、Unicode normalize 或改换行；
- IMAGE 按规范化后的像素 hash，让同一张图的 TIFF/PNG 容器可以合并；
- FILE_LIST 按有顺序的本地引用列表 hash，顺序不同就是不同记录；
- 不同 kind 永不合并；
- 命中重复时保留 ID、created 和 pinned，只更新 last_used 和最近来源；
- “编辑文本副本”创建新 Entry 和新 ID，不能悄悄改旧内容和已有 AI 引用。

#### 6.4.3 列表、搜索、复制和粘贴

```text
| Quick Panel · 剪贴板                    [暂停] |
| [搜索剪贴板...]                                |
| [全部] [文本] [图片] [文件]                    |
|------------------------------------------------|
| * 14:32 TEXT   API response schema...          |
|   14:28 IMAGE  1280x720                        |
| ! 14:21 TEXT   [敏感内容，已隐藏]              |
|   14:03 FILES  report.pdf +2                   |
|------------------------------------------------|
| ↑↓ 选择  Enter 粘贴/复制  Ctrl+Enter 只复制   |
```

- 插件自己的 SQLite/FTS 搜索文本和安全文件显示名；图片按类型、时间、来源筛选，
  不做 OCR；
- P0 完全不注册 Core Federated Search Provider，而不是注册后隐藏 snippet，从
  capability 层消除全局搜索误泄漏正文的路径；
- Enter 优先粘贴，Ctrl/Cmd+Enter 固定只复制，Esc 关闭；敏感项必须显式 reveal；
- 可靠的 Canonical 操作只是“把选择项写回系统剪贴板”；
- 自动粘贴仅在平台支持且用户给了最小辅助功能权限时执行：打开 Panel 前记住
  前台目标，写 clipboard 后验证 generation/marker 未被其他程序覆盖，再恢复焦点
  和模拟粘贴；
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

读取前移除 `@`、删除 Entry、锁屏、换 Session 或换 turn 会撤销引用，正文不会
进入 Tool Result。读取成功后只能取消以后继续访问，不能把它称为撤销已经产生的
Session 内容。删除 ClipboardEntry 和清理 DSH Session 是两个不同的数据域。

Clipboard Resource 不能 list、search 或批量读取 History。图片 P0 不 OCR；文件
引用只返回安全显示名和必要元数据，不读文件正文。要读取文件正文必须重新经过
Core-owned AI filesystem capability/broker 和 File Workspace（若已安装）的安全
projection；File Workspace 缺失时只显示引用不可用，不影响 Clipboard 其他能力。
图片只允许返回经过 Core/Clipboard bridge 校验、去 metadata、限大小的规范化
payload，不能把原始自定义 clipboard format 直接交给模型。

#### 6.4.5 保留、删除、导出和静态保护

默认限制哪个先到就执行哪个：30 天、1,000 条、500 MiB；文本/投影文本单条
2 MiB，图片编码 20 MiB/32 MP/临时解码 128 MiB，单次 256 个文件引用且 manifest
不超过 1 MiB。

- 自动清理按 last_used 删除最旧未置顶项；置顶计入容量但不自动删除；
- 如果全是置顶内容且已经占满，停止接收新记录并显示“存储已满”，不能无界增长
  或偷偷删置顶；
- 单条先进入 Trash 并可 Undo；永久删除清理 DB、FTS 和无引用 blob；
- 清空前显示准确条数、容量和置顶数，并提供导出；
- JSON/纯文本可导出文本，图片导出原格式或 PNG，文件引用只导出引用清单，
  不复制原文件；导出明确标记为普通未加密文件；
- 所有删除界面写明：不会删除其他应用中的副本，也不会删除已经进入 DSH Session
  的 Tool Result；
- 停用/卸载默认保留数据库和 blob；“删除 Smart Clipboard 数据”是独立危险入口。

P0 不自建 SQLCipher/envelope encryption，也不把它称为 Vault；否则会提前引入
密钥恢复、轮换、FTS 和明文迁移。基础保护为：DB/WAL/SHM/blob/temp 全部在 OS
用户私有 app-data 并使用严格 ACL/mode；正文不进普通日志、遥测或 crash breadcrumb；
MASKED 不进 FTS；清理时同时清 FTS/blob 并 checkpoint/truncate WAL。Schema 预留
未来 `encryption_version/key_id`，但不能宣称 SSD/备份层面的法证擦除。

#### 6.4.6 平台桥接和故障隔离

ClipboardBridge 只有 observe、snapshot、write、sourceIdentity、lockState、
autoPaste 六类能力；无网络、无任意文件读取、无 shell、无命令执行。平台监听/
写入/自动粘贴运行在最小权限原生 bridge/isolated principal，UI、DB、FTS 在插件
Host；bridge 崩溃只停 Clipboard 插件，Core/Conversation 继续。

- macOS：完整捕获；未授权 Accessibility 时自动粘贴降为 copy-only；
- Windows：使用官方 change listener/sequence；无法恢复前台或 UIPI 阻止输入时
  copy-only，绝不要求管理员权限；
- Linux X11/XWayland：按实际 clipboard ownership 能力实现；
- 纯 Wayland 有 data-control 才启用后台捕获，没有就明确显示“当前桌面不支持历史
  捕获”，仍提供能实现的复制功能，不假装完整支持；
- 远程桌面/VM 的来源归属和自动粘贴都是 best effort，默认偏向 copy-only。

#### 6.4.7 复用、二开和自研

Maccy 当前约 21k 星、MIT、持续维护，符合可信候选门槛。只选择性复用/改写其
macOS NSPasteboard 监听、类型/隐私 marker、generation/changeCount、自写 marker、
多文件写回、Accessibility 检查、最小 Cmd+V 注入和边角测试，形成 Hermit 自有
`MacClipboardBridge`；保留 MIT notice 和来源记录。

不复用 Maccy 整个 App、CoreData、HistoryItem、Tray、快捷键、UI、设置和更新器，
避免出现第二套产品 ownership。

其他候选：

- Rust arboard：MIT/Apache-2.0、持续维护，适合封装跨平台 text/image/HTML/
  file-list 基本 get/set；Windows 事件、macOS marker/来源、锁屏、race 和自动粘贴
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
原始 HTML/RTF replay 或 clipboard-trigger automation。

### 6.5 Federated Search

当前方向和模块 5 搜索闭环：已确认。它是 Core Host，不是独立 Product Plugin，
也不成为新的数据主人。

```text
| 搜索 [ quarterly revenue                         ] |
|----------------------------------------------------|
| 文件 · 18                                         |
| Q3 Report.pdf   ...revenue increased...  第 14 页 |
| Budget.xlsx     ...Revenue / Q3...       B8:F8    |
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
- 结果协议只有 provider ID、canonical ref、title、snippet、timestamp、type、
  source label、cursor/open action；
- 按来源分组，每组自己排序和分页。Core 可以固定组顺序，但不比较或暴露不同
  Provider 的 raw score，不制造虚假的全局相关度；
- 每个 Provider 默认硬超时 3 秒、每页最多 50 条，支持 AbortSignal、独立重试；
- raw query 和 provider result 只在当前搜索请求内瞬时传递，不进入数据库、诊断
  或遥测；请求取消、超时或 query generation 改变后的晚到结果直接丢弃，不能
  重新注入当前页面；
- 某组崩溃或超时只在该组显示错误，其他结果继续；
- 点击结果通过 canonical ref 打开对应插件的真实详情；
- Core 不复制结果、正文或 query 到一个“总搜索数据库”，也不做 AI query rewrite、
  AI 排序或答案总结；如果以后只统计性能，也只能记录数量/时延，不能记录查询词；
- 默认不显示外部完整路径、Secret 或 Clipboard 正文；文件 snippet 本身仍可能
  敏感，锁屏和外围界面不展示，后续可增加单文件“隐藏摘要”隐私设置；
- Conversation 正文搜索是否启用由 Core 自己的索引设置决定，未开启时不能显示
  为全文搜索；
- File Workspace、Organizer 或任何一个 Provider 停用后，Core 搜索和其他组仍
  正常工作，不留下不可点击的结果。

### 6.6 Unified Quick Panel、Tray 和 Shortcuts

当前方向和模块 3 桌面入口：已确认。

DSH 官方目前主要提供 CLI 和 Web，没有可依赖的官方 Tray、全局快捷键、开机
启动或 Quick Panel 契约。因此这些能力由 Hermit Core Desktop Shell 统一实现，
并通过少量适配层连接固定版本的 DSH，业务插件不能直接依赖 DSH 私有界面。

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

只有一个 Core Quick Panel。P0 不显示 Conversation、AI 回答、复杂编辑、设置
或审批，只提供当前真正可用的快捷动作：

```text
| [草稿]  [搜索]  [剪贴板*]               |
|------------------------------------------|
| > 输入……                                 |
|                                          |
| 动作：放到对话草稿                       |
| 最近：打开了一个对话 · 已完成            |
|                                          |
| Esc 关闭                    Enter 执行    |

* 只有 Smart Clipboard 正常运行时才出现
```

“草稿”闭环：

```text
输入文字
-> 选择“放到对话草稿”
-> 检查目标 Conversation 是否可以接收
-> 不自动发送、不调用模型、不写 AI 历史
-> 打开主窗口，由用户检查后自行发送
```

- 如果主窗口已有草稿、正在等待审批、目标 Session 已失效或跨窗口交接不可用，
  不覆盖原内容，只打开主窗口让用户继续；
- 跨窗口草稿交接必须先对锁定的 DSH 版本做技术验证。若没有稳定公开接口，使用
  Core 一次性交接队列，由主窗口主动领取；仍无法保证时，P0 隐藏该动作，不能
  伪造一条 Session 消息冒充草稿；
- Personal Organizer 正常运行时可增加第二个明确动作“存到收件箱”，但不能
  偷偷改变 Enter 的默认行为；
- 搜索只查询 Core 和当前正常运行插件的真实数据源，选中结果后在主窗口打开
  Canonical 来源并关闭小窗口；
- 默认进入“上次仍然可用的模式”。上次插件已卸载时自动回到草稿或搜索；
- 最近动作只写“打开了一个对话、已保存到个人事务”等安全描述，不保留正文、
  文件名/完整路径、剪贴板片段、Secret 或 Prompt 摘要；
- Enter 只在存在一个明确可执行动作时生效，空输入或选择不明确时不猜；
- 未提交的操作随 Esc 取消；已取得 operation ID 的操作可以继续，但必须保证
  重复按 Enter 或重新打开面板都只执行一次；搜索在关闭时可以取消。

写操作需要审批时：

```text
Quick Panel 发起写操作
-> Core 判断需要审批
-> 小窗口显示“请到主窗口确认”
-> 打开真实 DSH Conversation 的正式审批
-> 使用同一个 operation ID 和同一份参数
-> 小窗口关闭
```

Quick Panel 永远不提供“允许、拒绝、永久允许、修改 Tool 参数”等审批按钮。
若无法安全转交同一个操作，只提示用户去主窗口重新发起，不自建审批。

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

- Core 默认只注册一个打开 Quick Panel 的全局快捷键；
- 插件只能提交“快捷键建议”，用户在统一设置页确认后才由 Core 注册；
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
- 可选业务插件只允许硬依赖 Core，不允许硬依赖另一个可选业务插件；
- 插件之间只能通过 Core 的公开能力做“有就显示、没有就跳过”的可选合作；
- 不允许直接导入另一个插件的内部代码、数据库表或创建跨插件外键；
- 每个插件及其后台进程使用自己的身份和最小权限；
- DSH/Cordis 同进程插件不是安全沙箱。没有达到官方信任标准的社区代码不能
  进入正式 Core Host，只能放进隔离进程，通过很窄的桥接接口工作；
- macOS 上各进程分别签名并只申请必需权限，不能为了插件降低主程序权限。

因此，拔掉任意一个业务插件后，其他插件最多少一个可选入口，不会因为找不到
它而无法启动。

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

#### 6.8.1 最终运行形态：完全移除 Go

```text
Hermit Tauri / Rust Desktop Shell
|-- WebView
|   `-- 官方 DSH Web/client + Hermit 可信 UI adapter
|-- 精确版本 Node sidecar
|   `-- Hermit Core Host + 固定版本 DSH/Cordis
|       |-- 真实 Session / Approval / Tools
|       |-- Settings / Search / Package Registry
|       `-- 可信 Core adapters
|-- 隔离 Plugin Runner：Plugin A（需要时）
|-- 隔离 Plugin Runner：Plugin B（需要时）
`-- 用户明确调用时才启动的受控 Tool 子进程
```

- Node/TypeScript + DSH/Cordis 是 Core 和插件运行时；
- 保留现有 Tauri/Rust，只负责窗口、WebView、进程监督、Tray、快捷键、通知、
  OS 权限/凭据、签名版本选择和最底层恢复；
- React 直接建立在官方 DSH Web、Conversation、Session、Tool rendering、Settings
  shell 和 client slot 上，不重写第二套聊天前端；
- Hermit 自己常驻和后台进程树中没有 Go，Go 不再拥有数据、API、后台任务或恢复；
- 纯 Web 无法承担已确定的桌面能力；改成 Electron 会额外引入一套 Chromium/Node
  生命周期和更新面。现有 Tauri + 精确 Node sidecar 是更合适的目标；
- Tauri 使用 Windows WebView2、macOS WKWebView、Linux WebKitGTK，三者必须分别
  回归，不能因为都叫 WebView 就当表现完全一致。

#### 6.8.2 Node 和 DSH 版本

Hermit 自带 Node，不依赖用户系统安装。用户说的“最新 Node”在正式产品中解释为：

> 当前生产 Active LTS 线上，经过 Hermit 全套验证的最新补丁；不是版本号最大的
> Current，也不是启动时在线追 `latest`。

截至本次确认，Node 24.19.0 是 Latest/Active LTS，Node 26.7.0 仍是 Current；DSH
开发契约覆盖 Node 22.19/24/26，主测试以 Node 24 为主。因此首个 Core generation
优先锁 Node 24.19.0。以后新 LTS 也必须先完整验证，再随新 Core release 切换。

一个 Core release 是不可拆开的签名单元：Tauri 壳、精确 Node binary、固定 DSH
commit 和完整 `@deepseek-ai/*` 包图、lockfile、Core adapters、Web assets、native
addons、兼容清单和 SBOM。生产依赖图不得出现 `latest`、`next` 或版本范围解析。

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
| Core C17 / DSH pinned / Node 24.19.0                |
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
| Node       24.19.0             Healthy              |
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

1. Tier 0 Native Rescue 完全由 Rust 提供，不依赖 Node/DSH。即使 Node binary、DSH
   包或主 WebView 坏了，也能校验当前/上一签名 Core、禁用所有业务插件、选择与
   当前数据兼容的旧 Core、导出 Canonical 目录、查看极简错误、检测凭据后端并
   启动 Tier 1。
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

#### 6.8.9 本地网络和 WebView 边界

- 本地 DSH 只监听随机 `127.0.0.1` 端口；
- 上游 Host/Origin fence 不能当身份认证。每次启动生成 runtime capability token，
  所有本地 API 都校验；涉及 workspace 的请求再叠 workspace scope；
- WebView 使用 CSP、导航白名单，任意 `window.open`/外部导航阻断或明确交给系统；
- Tauri bridge 只开放最小 typed capability；插件不能读 Core Secret 或任意路径；
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
handshake、退出监督、renderer hardening 和发布测试；不继承其追 upstream latest、
私有 patch、credential 存储、签名状态或 updater。正式环境不使用 `dsh plugin add`
作为发布门，也不使用明文 `dsh-credentials-local`。

### 6.9 UI 组件和 DSH 风格契约

当前方向：已确认。Hermit 不另做一套“模仿 DSH”的设计系统，而是把官方 DSH
Web/client 作为唯一视觉宿主；业务插件只在官方公开 seam 中补业务内容。

#### 6.9.1 哪些界面直接交给 DSH

以下区域保持官方 feature plugin 挂载，不 fork、不复制内部组件：

- App shell、layout、sidebar 和 navigation；
- Conversation、Composer、Session/Workspace 列表；
- Tool frame、call/result pairing 和通用内容渲染；
- Approval、Model selection、Permission presets；
- Settings modal、navigation 和 section shell。

Product Plugin 通过官方 additive slot、keyed renderer 和 settings section 贡献内容，
不能抢占 whole conversation/sidebar/settings owner。当前未确认到稳定的第三方
top-level route API；如果 Hermit Core 需要 route registry，必须先在最终 pinned
DSH commit 上做 type/API spike，不能依赖 React Router、私有 DOM 或内部 store。

#### 6.9.2 允许依赖的官方公共面

业务代码只能通过 `hermit/dsh-ui-adapter` 访问锁定 DSH 的公共 root 或 `/client`
export。当前确认的直接复用候选包括：

- `@deepseek-ai/dsh-client-ui-primitives`：Button、Input、Menu、Tooltip、Modal、Toast、
  Pill、StateDot、Disclosure、HoverCard、风险确认、连接状态、Markdown/Code/JSON/
  Diff/Search/Web/Terminal/Read Block、图标等；
- `@deepseek-ai/dsh-client-ui-theme`：ThemeRuntime、主题变更和 semantic token；
- `@deepseek-ai/dsh-client-ui-slots`：typed slot composition；
- layout、sidebar、workspace、conversation、tool、settings、model selection、
  permission presets 等包的公开 `/client` contract。

禁止跨包 import `@deepseek-ai/**/src/*`、内部 `.tsx`、private CSS Module、class/id、
store handle、React Router 或查询 DSH 宿主 DOM。即使 package export map 技术上能
resolve，也不代表是受支持的公共 API。

#### 6.9.3 Hermit 自己补哪些组件

DSH 已公开的 primitive 不写视觉等价物。缺口按以下顺序处理：

```text
DSH public primitive
-> 原生 semantic HTML
-> 极薄 Hermit wrapper
-> 复杂键盘/focus 行为仍缺失时，按组件引入 Radix primitive
```

Hermit wrapper/自研范围：Textarea、简单 Select/Checkbox/Switch/Tabs/Popover 缺口，
业务 List/Table/Toolbar/Search/Filter，Empty/Loading/Error/Permission/Plugin unavailable，
Reminder editor、Import progress、Clipboard list/preview 和桌面设置页。Table 优先原生
`<table>`；日期时间优先原生输入。Radix 只提供无视觉行为，藏在 wrapper 后，不
成为第二套设计系统；React Aria 暂不与 Radix 同时引入。

不引入 MUI、Ant Design、Mantine 或 shadcn 作为 UI foundation。shadcn 最多是
一次性源码结构参考，不能带入默认视觉、主题变量或 Tailwind 依赖。

#### 6.9.4 样式、主题、图标和 React

- 新 DSH-mounted UI 使用 CSS Modules + `clsx`，消费官方 `--dsw-alias-*` semantic
  token；不复制 token 数值或维护 Hermit 品牌调色板；
- 允许一个极薄 token adapter 只做名称隔离，例如把 Hermit 变量映射到 DSH token；
  不能调用全局 `overrideTokens()` 给 DSH 换肤；
- 新 Product Plugin UI 不使用 Tailwind，也不能让 Tailwind preflight/global reset
  进入 DSH document。当前旧 `apps/desktop` 的 Tailwind 代码只作迁移期遗留，按
  功能替换后退出，不做一次性无关重写；
- 图标优先使用 DSH primitives 的官方 icon aggregate；只有语义确实缺失时才经
  `HermitIcon` adapter 使用 Lucide fallback；
- 不创建 Hermit ThemeProvider 或密度开关；light/dark/system、控件尺寸和交互密度
  由 DSH host/primitives 决定；
- Product Plugin 必须共享 DSH Web 提供的唯一 React/ReactDOM identity，不能再
  打包第二份 React。当前 pinned DSH 使用 React 18.2，Hermit vNext 随宿主使用
  18.2；以后只随完整 DSH generation 升级。旧 `apps/desktop` 的 React 19 不进入
  目标 DSH-mounted bundle。

#### 6.9.5 专业组件怎样接入

- 真正需要周/月/拖拽日历时使用 FullCalendar Standard，封装在
  `HermitCalendar` 后；不用 Premium，不沿用独立视觉主题，toolbar 使用 DSH
  Button/Menu，局部 CSS 映射 DSH token；
- PDF 使用 `pdfjs-dist` 的渲染能力，但 toolbar、loading、error、empty 和页面 chrome
  由 DSH/Hermit wrapper 提供，不照搬 Firefox viewer；
- 专业库 API 不能散落在业务页面，必须经 adapter；普通提醒表单不为显示日期而
  加载整个 FullCalendar。

#### 6.9.6 无障碍、升级和验收

- native semantic HTML 优先；复杂控件验证 label/error relationship、Tab/Shift+Tab、
  Enter/Space、方向键、Escape、outside click、focus placement/return、reduced motion；
- UI 不依赖 DSH sidebar/column 的固定 DOM 或宽度，使用自己的 flex/grid/minmax/
  overflow；overlay 单独验证 portal、z-index 和 focus；
- 每次 DSH bump 先 diff package exports、公开 type import、slot inventory、
  `exportInspectTokens()`、React identity，再允许视觉 baseline 更新；
- 建立 DSH Component Inventory 页面，覆盖所有 wrapper 的 default/hover/focus/
  disabled/loading/error/empty/long-text，在 light/dark/system、200% zoom 和长本地化
  文案下截图；
- 自动测试至少覆盖 Chromium/WebKit，正式 release 还必须在 Windows WebView2、
  macOS WKWebView、Linux WebKitGTK 的真实 Tauri 中通过键盘、IME、drag/drop、
  overlay 和关键页面 smoke；
- CI 要求 DSH-mounted Product Plugin 中 React runtime 数量为 1，Tailwind class、
  `@deepseek-ai/**/src/*`、DSH private selector 依赖均为 0；MUI/AntD/Mantine/shadcn
  不进入 production dependency tree。

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
`-- Tier 0 Rust Native Rescue

Personal Organizer（安装后）
|-- 今天
|-- 收件箱
|   `-- 整理为 Note / Todo / Event
|-- 待办
|   |-- 列表 / 筛选
|   |-- 详情 / 编辑 / Checklist
|   `-- 完成 / 取消 / 恢复
|-- 日程
|   |-- 周视图 / 列表视图
|   `-- 详情 / 编辑 / 取消
|-- 笔记
|   |-- 列表 / 搜索
|   `-- 详情 / 编辑 / 归档
|-- 提醒中心
|   |-- 待处理 / 即将到来 / 已处理
|   `-- 打开 / 稍后 / 忽略
|-- 搜索
|-- 垃圾箱
|   `-- 恢复 / 永久删除
`-- 数据与存储
    |-- 导入预览 / 去重 / 失败报告
    `-- JSON / CSV / ICS 导出

File Workspace（安装后）
|-- 概览
|   |-- 最近 / 收藏 / 需处理
|   `-- 全局导入进度
|-- 文件库
|   |-- 全部 / 处理中 / 需处理 / 收藏
|   `-- 文件详情
|       |-- 安全预览 / locator 跳转
|       |-- 标签 / 集合 / 收藏
|       |-- 所在位置（主动展开）
|       `-- 重新解析 / 打开 / 导出 / 移除
|-- 集合与标签
|-- 文件搜索
|-- 无法读取 / 重新定位 smart view
|-- 垃圾箱
|   `-- 恢复 / 永久删除
`-- 导入
    |-- 保留原位置 / 复制到 Hermit
    |-- 批次预检 / 重复处理
    `-- 进度 / 取消 / 恢复 / 失败报告

Smart Clipboard（安装后）
|-- 首次启用隐私页
|-- Quick Panel 剪贴板模式
|-- 完整历史
|   |-- 最近 / 置顶 / 类型筛选 / 本地搜索
|   `-- 预览 / 复制 / 粘贴 / 编辑副本 / Trash
|-- 垃圾箱 / 清空确认
`-- 隐私与数据设置
    |-- 记录 / 暂停 / 锁屏
    |-- 排除应用 / 敏感预览
    |-- 保留额度
    `-- 导出 / 清空 / 删除插件数据

桌面外围（Core）
|-- Quick Panel：草稿 / 搜索 / 当前插件安全模式
|-- Tray / 菜单栏
|-- 快捷键设置与冲突
|-- 系统通知
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

导入预览和 Trash 使用同一套明确的“影响范围 + 可撤销性”结构：

```text
| 导入预览 / 删除确认                           |
|-----------------------------------------------|
| 将处理       326 条                           |
| 重复建议      12 条                           |
| 不支持         3 条                 [查看]    |
| 预计占用     48 MB                            |
|                                               |
| 失败时：整批不提交 / 已完成文件保持可解释     |
| [取消]                         [确认并继续]   |
```

### 9.3 确认过程

每次只确认一个决策，不一次抛出整套问卷。顺序由依赖关系决定：

1. DSH Core 与唯一 AI 入口；
2. Product Plugin 平台与安装/禁用/卸载；
3. 主窗口、Quick Panel、Tray 和 Shortcuts；
4. Personal Organizer；
5. File Workspace 与全文搜索/BM25；
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
- release manifest 能离线验证 Tauri/Rust、Node binary、DSH commit、全部
  `@deepseek-ai` 包、lockfile、native addon、Web assets、SBOM 和兼容矩阵 hash；
- 生产解析图中出现 `latest`、`next` 或版本范围则发布失败；
- 本地服务只监听随机 `127.0.0.1` 端口；缺 runtime capability token、错误 Origin/
  Host 或错误 workspace scope 的请求全部拒绝；WebView CSP 和导航白名单自动回归；
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
- 本轮 `@` 不自动预读；没有成功 durable Tool Result，模型和 UI 不能声称读过；
- Composer 插入 `@` 但未发送时没有 grant；删除引用、丢弃草稿或切换 Session
  后不能读取，只有真实 user turn 提交才签发本轮 grant；
- 历史 Ref 不自动刷新；重新 `@` 才能绑定当前版本；Provider 卸载后旧结果仍由
  Core 通用卡片显示，新读取返回 unavailable；
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
- Quick Panel 只创建一个 `kind=null、triage_state=inbox` 记录，原文逐字一致；
  整理为正式类型前后 item ID 不变，原文和转换历史保留；
- Reminder daily/weekly/monthly/weekdays 连续 20 次计算正确；DST 跳时、重复时、
  每月 31 日、换时区、睡眠跨多次触发都符合 6.2.4；
- 相同 `ruleId + nominalFireAt + timezone` 在重启/唤醒/crash replay 后只产生一个
  Occurrence；主动停用期间不补发，系统睡眠/崩溃按 missed 规则；
- 通知权限拒绝或投递失败时提醒仍进入应用内中心；重复点击通知动作只执行一次；
- UI 与 AI 使用旧 revision 写入时返回冲突，不覆盖最新版本；
- JSON round-trip 保留 ID、状态、提醒、标签、清单和 opaque ref；ICS 不支持的
  重复语义在预览中拦住；整批导入任一条失败不留下前半批数据。

### 10.5 File Workspace 和 Federated Search

- external 文件经过导入、打标签、Trash、恢复、重解析、移除、卸载后，原 path/
  identity/hash/mtime 不被 Hermit 修改；
- managed copy/hash/fsync/rename/DB commit 各阶段强制崩溃后，不出现可见记录指向
  半文件，也不覆盖用户同名文件；
- symlink 指向系统根、用户目录、DSH/Hermit 私有目录时被跳过且不读取；
- ZIP bomb、traversal、宏/OLE/external relationship、XXE、恶意 PDF/HTML/图片使
  parser 单文件失败，0 网络、0 宿主越权写、Core 不崩；
- external 变化后旧 index 不再作为当前结果，preview 明确 stale，当前 `@` 必须
  重新解析；relink 保持 file ID，hash 不同必须让用户确认；
- 10 万 chunks + 1 万 Organizer items、本地 warm index/top20，搜索 p95 不超过
  500ms、p99 不超过 1 秒；中文 200+ 标注查询单独验证一至二字和三字以上路径；
- 搜索命中能定位正确 PDF 页、DOCX 段、XLSX sheet/range、PPTX slide；
- Federated Provider 超过 3 秒只让自己组显示超时，其他组正常；执行前后没有新
  建中央结果/query content 数据库；
- external Trash/purge 从不删原件，managed 最后一个记录 purge 才删除共享 blob。

### 10.6 Smart Clipboard

- 用户点“开始记录”前复制 100 次，DB/FTS/blob payload 仍为 0；
- 锁屏立即关闭 UI、暂停捕获并撤销未读 AI ref；插件停用/崩溃后 Quick Panel
  模式消失，Core 正常；
- HTML/RTF 只能产生安全文本且 0 网络，数据库无 raw HTML；畸形/超大图片不
  造成 Host/UI 崩溃或超额内存；
- 强隐私 marker 和排除应用连续复制的测试正文在 DB、blob、FTS、诊断日志均为 0；
- plain/HTML/RTF 的精确同文本最终只有一个 ID，置顶不丢；不同 kind 永不合并；
- 从历史 Copy/Paste 不生成新记录；读取多格式期间 clipboard 被另一进程改变时
  不产生混合 Entry；
- 自动粘贴无权限、目标失效、UIPI/Wayland 限制或 clipboard 被覆盖时不提权、
  不发错误按键，退回 copy-only；
- P0 capability graph 中不存在 Clipboard Federated Search Provider；
- Clipboard file ref 默认只返回安全元数据；未重新经过 Core filesystem broker/
  File Workspace 授权时正文不可读，File Workspace 缺失不影响 Clipboard 其他能力；
- 一次性 AI ref 在指定 Session/turn/version 只读一次，换 Session/turn、删除或
  改版本后拒绝；read 前撤销不写正文，read 后删除 Entry 不影响既有 Tool Result；
- 30 天/1,000 条/500 MiB 任一先到清最旧未置顶；只有置顶内容占满时停止新捕获
  并提示，不静默删除或无界增长。

### 10.7 更新、恢复和一次性迁移

- Node/DSH/Core 坏时 Tier 0 Rust Native Rescue 仍可启动；坏 Product Plugin 或
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
- DSH 已有 Button/Input/Menu/Tooltip/Modal/Toast/content renderer 时，Hermit 没有
  视觉等价物；
- DSH-mounted UI 的 `@deepseek-ai/**/src/*`、private CSS/class/DOM selector、
  Tailwind class/global reset 数量均为 0；
- Web client 只有一份与 pinned DSH 一致的 React runtime；当前不能把 React 19
  打入 React 18.2 宿主页；
- 新颜色和状态全部来自 DSH semantic token；light/dark/system、200% zoom、键盘、
  长文、空/加载/错误/插件不可用全部进入 Component Inventory；
- Radix 只在 public DSH primitive 和原生 HTML 都不能完成复杂行为时按组件引入；
  shadcn、MUI、AntD、Mantine 不在生产依赖；
- FullCalendar/PDF.js 由 Hermit adapter 隔离，外层控件与状态使用 DSH 风格；
- DSH 更新必须先通过 exports、slot、token、React identity contract diff，再允许
  更新三平台视觉 baseline。

## 11. 模块确认状态

当前模块：全部完成，终审 PASS。

### 11.1 已确认

- P0 的正式 AI 回答只显示在 DSH 主 Conversation；
- 文件页面不为每个文件提供“问这个文件”按钮；
- 用户在主 Conversation 中通过 `@` 或其他统一机制引用文件；
- `@` 是所有已安装 Product Plugin 共用的资源选择入口，候选按 Provider
  分组显示；
- Core 不理解各插件业务 Schema，候选查询和引用解析归对应 Provider；
- P0 不新增 `@file/@todo/@session` 等硬语法；
- 业务资源采用 Live Reference，不额外保存 model-step evidence snapshot；
- 历史 `@Ref` 不允许自动刷新；只有用户在当前消息再次 `@`，才允许读取最新
  版本；
- 资源实际读取结果使用 DSH Tool Result 记录，后续源数据变化不修改旧结果；
- Core 不自动预读 `@Ref`；模型必须按需显式调用读取 Tool，没有成功结果就
  不能声称看过正文；
- 结构化业务资源统一使用 Core `resource_read(ref)`；Core 只路由和执行通用
  读取边界，Provider 负责权限、查询和 AI-safe projection；
- File 继续使用官方 `read`；搜索和修改继续使用插件自己的业务 Tool；
- 业务页面不保存或复制 AI 回答正文；
- P0 暂不开发 Quick Panel Conversation；
- 正式环境只能通过 Package Gate 修改，开发环境与正式环境分开；
- 插件的界面、数据逻辑、Tool、搜索和后台任务作为同一个完整版本切换；
- 新版本必须先在旁边完整安装并真实试启动，全部成功后才替换旧版本；
- 版本、来源、完整性和依赖必须精确锁定，不使用 `latest` 或版本范围；
- 可选业务插件只硬依赖 Core，彼此只能做“有就合作、没有就跳过”的可选集成；
- 未达到官方信任标准的社区代码不能直接进入正式 Core Host；
- 停用先拒绝新调用、撤下入口，再取消任务和停止后台活动；
- 卸载默认只删除代码和缓存，保留用户业务数据，删除数据必须单独确认；
- 外部原文件不因插件卸载而删除；
- 保留数据时默认保留至少一个已验证的精确恢复版本，用户可明确放弃此保障；
- 任意插件安装或升级失败时，原来的可用版本仍保持有效；
- 主窗口一级导航由 Core 管理，插件入口只在对应版本正常运行时出现；
- Quick Panel P0 只做草稿交接、搜索和当前已安装插件的安全快捷动作，不做 AI
  回答或审批；
- “放到对话草稿”不自动发送、不覆盖现有草稿，无法安全交接时只打开主窗口；
- Quick Panel 写操作需要审批时转到真实 DSH Conversation，并沿用同一个操作；
- 系统只有一个 Core Tray/菜单栏图标，只显示安全状态和不过期的计数；
- Core 默认只注册一个 Quick Panel 全局快捷键，插件快捷键必须由用户确认并由
  Core 统一注册；
- 开机启动和后台暂停都由 Core 管理，插件不能各自创建常驻入口；
- 可选插件不是 Core 启动条件，失效时一次撤掉导航、小窗口、Tray 和快捷键贡献；
- Personal Organizer 长期内容只有 Note/Todo/Event，Inbox 是暂存态，Reminder
  是挂在内容上的时间规则；
- Inbox 整理时保持同一 ID 和原始捕获文本，不复制内容或打断历史引用；
- P0 支持简单重复提醒，不支持重复 Todo/Event、cron 和完整 RRULE；
- 系统通知失败不丢提醒，启动/唤醒/重启后从 SQLite 恢复调度；
- 插件没有 AI、网络、File Workspace 或通知权限时仍能手工完整使用；
- 插件全文搜索和业务数据都由自己的 SQLite 负责，AI 只通过 DSH Resource/Tool；
- JSON 是无损格式，CSV/ICS 只作有限互操作，导入必须先预览再整批提交；
- Personal Organizer 没有可靠的成熟 DSH 社区插件可直接复用；日历、日期和
  SQLite 基础库可复用，领域模型、提醒和 DSH 适配自研；
- File Workspace 默认只链接和索引外部原文件，用户明确选择后才复制到 Hermit；
- FileRecord/用户组织数据和 managed blob 是 Canonical，解析文本、缩略图和 FTS
  索引都可重建；外部绝对路径只进私密 SecretLocator；
- P0 解析文本、Markdown、HTML、PDF 和无宏 OOXML；图片只做安全缩略图；压缩包、
  音视频、旧/宏 Office 和密码文件只登记；
- 所有复杂 parser 进入无网络、限资源的独立进程，单文件失败不影响插件和 Core；
- File Search P0 使用 FTS5/BM25 并保留页、段、Sheet/Cell、Slide locator，中文
  一至二字查询必须单独 benchmark；
- 非文本文件由 File Workspace 生成当前版本的安全 UTF-8 projection，再交给 DSH
  官方 read；成功 durable Tool Result 前不算 AI 已读取；
- AI P0 只能搜索、读元数据和修改可撤销的标签/集合/收藏，不得导入、重解析、
  删除、重新定位、导出或操作任意路径；
- external Trash/purge 永不删除原文件；managed blob 只有最后一个引用删除时清理；
- Federated Search 按来源分组，不复制数据、不比较跨源分数、不使用 AI 总结；
  某个 Provider 超时、崩溃或卸载只影响自己的结果组；
- 当前 DSH 社区 File/KB 插件均未达到直接依赖门槛；成熟解析/监视基础库可复用，
  文件领域模型、安全边界、Resource adapter 和联邦搜索自研；
- Smart Clipboard 新安装默认不捕获，用户明确开启后才开始；锁屏、停用期间不回补；
- P0 只保存安全纯文本、规范化图片和文件引用，不保存 raw HTML/RTF 或未知对象；
- 高可信隐私 marker 直接跳过，应用排除和 MASKED 内容不进入正文 FTS；
- 自动粘贴是可降级便利能力，失败时可靠退回“已复制，请手动粘贴”；
- P0 不注册 Clipboard Federated Search Provider，AI 不能列出或搜索完整历史；
- AI 只能读取用户明确选择的单条、当前 Session/本轮一次性引用；成功 Tool Result
  留在会话后，删除 ClipboardEntry 不会删除会话历史；
- 默认 30 天/1,000 条/500 MiB，置顶不自动删；全是置顶且满额时停止捕获并提示；
- P0 使用 OS 私有数据目录和严格权限，不自建静态加密或宣称 Vault；
- Maccy 仅选择性复用 macOS 原生桥接逻辑，不复用数据库、UI、Tray、快捷键或
  更新器；arboard/EcoPaste 可有限复用/二开，Canonical 数据和 DSH 边界自研；
- 最终架构保留 Tauri/Rust 薄桌面壳，Node/TypeScript + DSH/Cordis 是 Core 和
  插件运行时，目标进程树完全移除 Go；
- Node 使用 Active LTS 线上经过全套验证的精确最新补丁，首个候选为 24.19.0，
  与 DSH、lock、native addons 作为同一个签名 Core generation；
- 正式凭据通过 OS Keychain/Credential Manager/Secret Service，禁用明文 local
  credential provider，Linux 凭据后端缺失时 fail closed；
- Safe Mode 分为不依赖 Node/DSH 的 Rust Native Rescue 和 DSH Safe Profile；
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
  React identity 随 pinned DSH，当前为 18.2。

### 11.2 最终审查状态

模块 1 至模块 7 已逐项完成，没有产品级分歧。跨模块终审发现的问题已经全部
修订；最后一轮验收结果为 `PASS`、`PRODUCT_DECISION_NEEDED: NONE`、
`REMAINING_BLOCKERS: NONE`、`REQUIRED_DOC_FIXES: NONE`。Core、Organizer、
File、Clipboard 和任意插件拔除均为 PASS。本文档可以冻结，作为下一阶段原型、
工程详细设计和迁移字段映射的唯一主需求。

### 11.3 下一阶段非阻塞详细设计

以下内容必须在代码开发前形成独立详细规格，但不阻止本核心需求冻结：

- grant 的持久化 schema、消费原子性以及 expiry/read-count 并发语义；
- candidate generation 切换和 crash recovery 状态机；
- Approval + callId mutation 去重的事务边界与结果保留策略；
- File/Clipboard broker 的 token/path 生命周期、图片规范化和大小上限；
- Reminder occurrence/snooze 状态机；
- authority epoch/lease 的启动、迁移和故障恢复协议；
- 旧 Item/File/Reminder/AI/Vault 字段到新数据模型的逐字段 Migration Mapping；
- 依据第 9 节页面树重新生成并验收高保真原型，旧 Vault 原型不得进入 P0。
- 对最终 pinned DSH 做 top-level route、spacing/radius/density token 和 portal/z-index
  公共 contract spike；未确认前不依赖私有实现。

项目仓库、工具链、PR0、第一条 Core-only vertical slice、GitHub/CI 和社区插件
开放顺序见 `start-readiness.md`。已确认 Day-1 只新建 Private
`pgw10086/hermit-vnext`，公开门通过后以 Apache-2.0 开放；本地仓库位于
`D:\codes\hermit-vnext`，不在旧仓库内创建嵌套 vNext 仓库。
