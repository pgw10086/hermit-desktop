# Desktop Surface 与 Quick Panel

状态：`IMPLEMENTED_V1_2`

更新时间：2026-09-02

当前实现进度：S1 的 typed contract、Surface Manager、IPC 和能力 bridge 已落地；S3 的
Smart Clipboard 窗口已迁移到统一宿主并通过 macOS packaged UI 验收；S2 的
`conversation.quick` 已接入 DSH Web、正式 Session UI，并通过 macOS packaged Surface
真实对话验收。v1.2 的通用窗口策略、轻量独立 Quick Conversation 视图和独立的
`approval.companion` 审批伴随窗口已落地，并通过模块测试、目录制品构建和 macOS packaged
Quick Conversation 烟测。macOS 代码签名因本机没有 Developer ID 而跳过；S4 暂不开发。

本文是 Hermit 将 Quick Panel 从 Smart Clipboard 专属窗口能力调整为 Desktop Core 通用桌面
能力的变更 spec。它承接[核心需求](core-requirements.md)中的长期边界，并作为后续代码开发、
测试和文档回读的当前依据。

相关权威文档：

- [系统边界](../../docs/architecture/system-boundaries.md)：进程、组件和依赖方向；
- [Desktop Core 开发规范](../../docs/development/desktop-core-development.md)：桌面能力的
  通用规则和生命周期；
- [Product Plugin 最小接入](../../docs/development/product-plugin-quickstart.md)：插件如何识别
  和使用公开能力；
- [Smart Clipboard 设计](../../plugins/smart-clipboard/DESIGN.md)：剪贴板业务规则和快速取回体验。

## 1. 变更结论

Quick Panel 不再被定义为剪贴板能力，而是 Desktop Core 提供的桌面 Surface 能力。第一条
真实产品闭环是 `conversation.quick`：一个可由全局快捷键唤起的紧凑 DSH 对话工作面。

这次变更不建立第二套 AI runtime，也不把 Desktop Core 变成插件可以自由创建 Electron 窗口的
SDK。目标是让 Core 统一管理桌面资源和可配置的窗口行为，让 DSH 继续管理 AI、Session 和
Approval，让 Product Plugin 继续管理自己的业务。确认框属于独立 Surface，不嵌进 Quick 输入框，
也不强制跳回主窗口。

## 2. 为什么要调整

当前代码同时存在旧的通用 Quick Panel 原型和 Smart Clipboard 专属快速取回窗口。两者都拥有
窗口、定位和 IPC 细节，导致“快速窗口”无法被对话或其他插件复用，也容易让业务状态和桌面
生命周期混在一起。

调整后，多个 Surface 可以共用一个 Desktop Core Manager，但每个 Surface 仍保留自己的内容、
业务状态和动作语义。

## 3. 责任边界

### Desktop Core

- 创建、显示、隐藏、销毁和恢复桌面窗口；
- 处理屏幕、工作区、焦点、置顶、窗口状态和平台差异；
- 持有 Surface 实例和插件 activation 的关系；
- 通过 typed contract 返回实际生效的能力和降级状态；
- 在插件停用、卸载、DSH 重启、应用退出或窗口异常时清理资源。

### DSH

- 拥有 Conversation、Session、Model、Tool、Skill、Approval、流式响应和会话历史；
- Quick Conversation 使用正常 DSH Session，不创建独立消息存储或模型调用链；
- 主窗口和 Quick Panel 打开同一个 Session 时，继续使用同一份历史和状态。

### Product Plugin

- 拥有业务数据、领域服务、业务 UI 和动作含义；
- 声明自己需要的 Surface 类型和内容，不直接操作 Electron 或操作系统对象；
- Surface 关闭不等于业务数据或 DSH Session 删除；
- 插件卸载后，Core 自动撤销其 Surface 注册和实例，Canonical 数据按插件规则保留。

### Shortcut Registry

全局快捷键仍是独立的 Core 共享资源。Surface 可以被快捷键打开，但快捷键注册、冲突检测、
持久化和释放继续由 `ShortcutRegistry` 负责。

## 4. 通用规则

只冻结以下通用规则，具体 Surface 的窗口偏好和交互由各自定义决定：

1. Core 管桌面资源，DSH 管 AI/Session，插件管业务；
2. 跨边界使用公开 typed contract，插件不依赖 Electron 私有对象或 DSH 私有实现；
3. Core 不保存插件业务状态、对话消息、模型凭据或第二份 Session；
4. 每个 Surface 必须有明确 owner、停用/卸载清理方式和平台不可用结果。

以下内容不是全局硬编码清单，而是可协商的 Surface 配置：标题栏、是否可拖动、是否可缩放、
是否置顶、位置、尺寸、焦点、Esc/失焦行为、位置/尺寸记忆、内容区域和业务动作。Core 可以根据
平台和安全策略返回实际生效值；插件只依赖 typed contract，不感知 Electron 细节。

## 5. Surface 模型

`Surface` 是一个由 Core 托管的桌面工作面。`kind` 使用带命名空间的稳定标识，第一批包括：

- `conversation.quick`：紧凑 DSH Conversation；
- `clipboard.quick-retrieval`：Smart Clipboard 快速取回；
- `product.panel` 及其插件定义的具体类型，例如 `organizer.todo-glance`。

Surface 的生命周期是：

```text
register -> open/toggle -> active -> hide/close -> reopen 或 destroy
```

隐藏窗口不删除其绑定的 Session 或业务数据。`close` 和 `destroy` 的差异由 Core 管理，
插件只依赖公开的状态事件和 disposer。

## 6. 公共 API 形状

以下是概念级 contract，字段可随版本协商扩展，不要求第一版一次冻结所有未来选项：

```ts
type SurfaceKind = string

interface DesktopSurfaceDefinition {
  id: string
  kind: SurfaceKind
  content: {
    type: 'dsh-conversation' | 'plugin-view'
    viewId?: string
    contract?: number
  }
  window?: {
    chrome?: 'system' | 'none'
    movable?: 'allowed' | 'locked'
    resizable?: boolean
    alwaysOnTop?: boolean
    anchor?: string
    placement?: string
    preferredSize?: { width: number; height: number }
    minSize?: { width: number; height: number }
    maxSize?: { width: number; height: number }
    focus?: string
    escape?: 'hide' | 'close' | 'ignore'
    blur?: 'hide' | 'keep'
    rememberPosition?: boolean
    rememberSize?: boolean
  }
  session?: {
    type: 'new-on-submit' | 'last-bound' | 'existing'
    sessionId?: string
  }
  actions?: readonly string[]
}

interface DesktopSurfaceService {
  register(definition: DesktopSurfaceDefinition): () => void
  open(id: string, options?: DesktopSurfaceOpenOptions): Promise<DesktopSurfaceHandle>
  toggle(id: string, options?: DesktopSurfaceOpenOptions): Promise<DesktopSurfaceHandle | null>
  resize(id: string, size: { width: number; height: number }): Promise<void>
  close(id: string): Promise<void>
  capabilities(): DesktopSurfaceCapabilities
}

interface DesktopSurfaceOpenOptions {
  anchor?: string
  placement?: string
  preferredSize?: { width: number; height: number }
  focus?: string
  alwaysOnTop?: boolean
  session?: DesktopSurfaceDefinition['session']
}

interface DesktopSurfaceHandle {
  readonly id: string
  close(): Promise<void>
  focus(): Promise<void>
  on(event: string, listener: (payload: unknown) => void): () => void
}

interface DesktopSurfaceCapabilities {
  platform: string
  supported: boolean
  features: Record<string, boolean>
}

type DesktopSurfaceErrorCode =
  | 'PLATFORM_UNSUPPORTED'
  | 'CAPABILITY_UNAVAILABLE'
  | 'INVALID_DEFINITION'
  | 'SESSION_UNAVAILABLE'
  | 'OWNER_UNLOADED'
  | 'RENDERER_FAILED'
```

接口设计的关键点：

- Surface 类型是可扩展的，不要求 Core 为每个未来功能预建一个专用方法；
- `resize` 只改变已存在窗口的尺寸，不重新加载内容或改变 Session；
- `anchor`、`placement`、`preferredSize`、`focus` 和 `alwaysOnTop` 表达业务意图，不暴露平台
  坐标、窗口层级或 native handle；注册时的窗口策略还可声明标题栏、拖动、缩放、边界和
  记忆行为；
- 无标题栏 Surface 由内容声明公开拖动区域（例如 `data-hermit-drag-region`），交互控件声明
  `data-hermit-no-drag`；Core 只负责把这些声明映射到宿主窗口，不让插件拿到原生窗口对象；
- `content` 使用已经注册的 DSH Conversation 或 Product Plugin View；
- `actions` 引用已经注册的命令或 typed action，不传任意 IPC 回调；
- owner 从插件运行时作用域推导，`register` 返回 disposer；
- Core 返回“支持、降级或不可用”的实际结果，插件不需要自己判断所有平台差异。

插件不得直接取得 `BrowserWindow`、`WebContents`、`NSWindow`、`HWND`、Node ambient
authority、原生模块实例或私有 IPC。这是跨边界的通用安全规则，不是对每个 Surface 再建立一套
重复的限制清单。

## 7. `conversation.quick` 第一阶段

### 用户流程

```text
全局快捷键
-> 打开紧凑对话 Surface
-> 输入并提交
-> DSH 创建或恢复 Session
-> 流式展示真实 DSH 回复
-> 继续对话、取消、重试或等待 Approval
-> 需要时由调用方显式绑定已有 sessionId，继续使用同一份历史
```

### 默认行为

- `conversation.quick` 默认使用无标题栏、可拖动、不可缩放、非置顶的普通窗口，不依附主窗口，
  也不因失去焦点自动隐藏；这些是该 Surface 的偏好，不是所有 Surface 的硬编码规则；
- Surface 有三个可观察状态：`HIDDEN`（窗口不可见）、`COMPOSER`（刚打开，只显示紧凑输入框）和
  `CHAT(sessionId)`（首条消息被 DSH 接收后显示聊天内容）；`HIDDEN` 只是窗口可见性，不是会话状态；
- 每次从 `HIDDEN` 重新打开都从新的 DSH 会话草稿开始；Quick 页面通过 DSH 公开的 `sessions.create`
  建立空白 Session，Core 不创建或镜像 Session。当前已经打开时再次触发快捷键只聚焦，不重置正在进行的对话；
- `COMPOSER` 按 `Esc` 隐藏窗口，不删除草稿或已存在的 Session；聊天态也允许按 `Esc` 隐藏，重新打开
  仍按“新打开即新会话”处理；
- `CHAT` 右上角只提供“新建对话”和“打开主窗口”。“新建对话”清空当前小窗回到 `COMPOSER`，
  下一次提交创建新的 DSH Session；“打开主窗口”把当前 `sessionId` 显式交给主窗口，成功后隐藏小窗；
- 主窗口与小窗之间只通过公开 typed contract 传递 `sessionId`，Core 不猜测主窗口当前选中的会话，
  也不复制消息、模型或 Session 存储；
- 小窗默认获取输入焦点，但不强行抢回用户主动切换后的其他应用焦点；
- DSH 的 Tool、Skill、Approval、取消、重试和错误状态保持原有语义，不在 Quick Panel
  里另建一套操作流程。Quick 页面只使用公开的 DSH Session/Input/Conversation snapshot，
  不复用完整 DSH Web 的标题栏、侧栏和详情布局。
- v1 的 `rememberPosition`/`rememberSize` 只保证同一窗口实例隐藏后重开时恢复；跨应用重启的
  持久化存储留给后续明确的 Core 状态需求，不由本次 Surface contract 默默扩展。

窗口是否有标题栏、是否置顶、失焦是否隐藏、草稿态和聊天态的具体布局，都由
`conversation.quick` 自己声明。其他插件只复用 Desktop Surface 的通用生命周期，不被这些偏好绑定。

Quick Conversation 不需要因为“未来可能支持截图、语音或文件”而提前申请对应系统权限。
这些能力以后各自声明、各自申请、各自返回结果。

### 7.1 独立 Approval companion

- DSH 的 `ApprovalRequest` 仍只有一个回答者；`approval.companion` 只是 Core 托管的独立展示与
  回答入口，沿用同一个 `PendingWait`、`requestId` 和 `callId`，不复制审批状态机；
- 它可以靠近 Quick 窗口显示，待审批时获取焦点；默认不嵌在 Quick 面板内，也不把用户赶回主窗口；
- 允许一次、拒绝、Esc、关闭、过期、DSH 重启都走同一个 fail-closed 结算路径；审批消失后伴随窗口自动关闭；
- 这是 DSH/受信任宿主路径。普通 Product Plugin 不能伪造 DSH Approval 响应，只能声明自己的普通 Surface。

### 7.2 轻量 Quick 页面

Quick 页面由 Hermit layout 自己绘制：草稿态只有紧凑输入框，聊天态显示消息流、输入框和右上角
“新建对话／打开主窗口”。它可以使用 DSH 的公开原语和快照类型，但不依赖 DSH Web 的私有 DOM、
Router、store 或 CSS 选择器。页面状态变化通过 `DesktopSurfaceClient.resize` 告知 Core，Core 按
Surface 的 min/max 约束生效。

## 8. Smart Clipboard 迁移

迁移只改变窗口宿主，不改变剪贴板业务：

| 内容 | 迁移后的负责人 |
| --- | --- |
| 窗口创建、定位、显示、焦点、窗口策略和清理 | Desktop Core Surface Manager |
| 快捷键注册和冲突状态 | Desktop Core `ShortcutRegistry` |
| ClipboardEntry、历史、SQLite/FTS、搜索 | Smart Clipboard |
| TEXT/IMAGE/FILE_LIST 规则 | Smart Clipboard |
| 复制、纯文本复制、显式粘贴 | Smart Clipboard + 独立 clipboard capability |
| 快速取回列表和动作映射 | Smart Clipboard View/Domain |

Smart Clipboard 注册 `clipboard.quick-retrieval`，使用 Core 提供的窗口宿主；它不因为复用
Surface Manager 就获得 DSH Conversation 或其他插件的数据。

当前 `windows.ts` 的旧通用 Quick Panel 和 `smart-clipboard-quick-panel.ts` 的专属窗口需要
在代码迁移时统一入口和命名，避免两套窗口实现继续并存。

## 9. 后续 Product Panel

第二条真实使用场景优先选择 Organizer Todo 小窗，用于验证：

- 插件注册自己的 typed view；
- 业务数据仍由 Organizer domain service 提供；
- `no-activate` 或用户主动固定等窗口偏好；
- Surface 与插件 activation 同步注销；
- 窗口常驻不等于业务数据进入 Core。

只有出现多个真实 Surface 后，才根据共性补充新的 contract 字段或 capability，不提前建设
任意 WebView、多窗口编排或“万能桌面 API”。

## 10. 平台和失败结果

Surface API 必须区分：

- 完整可用；
- 窗口可用但某项偏好降级，例如不能置顶或不能可靠恢复焦点；
- 当前平台完全不可用；
- owner 已停用或 renderer 启动失败。

第一阶段优先完成 macOS 真实闭环，Windows、Linux X11 和 Wayland 按平台能力逐步补证；Wayland
对移动、置顶和位置恢复的有效性以实际运行时能力为准，不能把请求值当成生效值。
不得为了声称跨平台一致而偷偷启用另一套未验证的窗口实现。

## 11. 分阶段开发顺序

### S1：公共 contract 和 Core Manager

- 新增 Desktop Surface typed contract 和能力探测；
- 建立统一的窗口生命周期、定位、焦点、置顶和 disposer；
- 保持 `ShortcutRegistry` 为独立服务；
- 为旧 Quick Panel 和 Smart Clipboard 窗口建立兼容适配。

### S2：`conversation.quick`

- 创建 Core-owned 对话窗口和受限 renderer；
- 接入 DSH Session、stream、cancel、Approval 和错误状态；Core 不复制 DSH Session 状态；
- 增加 Surface 选择、toggle、关闭恢复和错误状态测试；验证 `COMPOSER`/`CHAT(sessionId)` 两态、
  新会话、Esc 隐藏和主窗口显式交接；
- 完成 macOS packaged smoke 和小窗内真实 DSH 对话验收；已有 Session 的显式绑定按公开
  `session` 选项扩展，不把主窗口当前选择暗含成跨边界依赖。

### S2.1：轻量页面与审批伴随窗口

- 加入可拖动的轻量 Quick 页面，保持 `conversation.quick` 的两态尺寸和通用窗口策略；
- 加入独立 `approval.companion`，沿用 DSH `PendingWait`，验证审批只有一个回答者且不跳主窗口；

状态：`IMPLEMENTED`。Quick 页面、窗口策略和 companion 已进入布局包与 Desktop Core；
macOS packaged Quick Conversation 烟测覆盖草稿态、聊天态、Esc、新建对话和主窗口交接。
Approval companion 的专门 packaged replay 留作后续资格补证；当前实现和 typed PendingWait
路径已通过构建与模块检查，不读取主窗口私有 React 状态来伪造测试输入。

### S3：Smart Clipboard 迁移

- 将窗口宿主切换到 Surface Manager；
- 保留剪贴板捕获、数据、搜索、写回和显式粘贴业务；
- 删除或重命名旧的重复 Quick Panel 入口；
- 回归现有 Clipboard packaged、native 和停用/卸载测试。

### S4：第二个 Product Panel

- 以真实 Organizer Todo 小窗验证 `plugin-view` 和用户偏好；
- 根据实际共性扩展 contract；
- 不为没有真实使用者的能力创建空实现。

## 12. 验收标准

- Core、DSH 和插件的责任边界在代码和文档中一致；
- `conversation.quick` 的消息、流式结果、Approval 和历史由 DSH 正式 Session 负责；每次从隐藏状态
  重新打开都创建新的会话草稿，只有“打开主窗口”才显式绑定当前 `sessionId` 继续同一份历史；
- 关闭、重开、DSH 重启、renderer 异常和插件卸载不会产生重复 Session 或残留窗口；
- Smart Clipboard 迁移后历史、搜索、复制/粘贴和原有降级语义不变；
- Surface 的 API 只暴露 typed contract，不暴露 Electron 或原生对象；
- 至少一条 macOS packaged 真实流程通过，并记录平台降级结果；
- 旧 Quick Panel 重复实现和过时文档不再作为当前入口；
- 新增 Surface 类型能够在不修改已有业务数据负责人的情况下接入。

## 13. 不在本 spec 内

- 视觉像素、品牌样式和具体组件库选择；
- 截图、语音、文件分享等额外系统能力；
- 新的 AI Provider、模型配置或 DSH Session 存储；
- Smart Clipboard 的历史数据规则和 AI 引用规则；
- 社区插件市场、远程控制和任意第三方原生窗口。
