# DSH 桌面快捷键中心

状态：`COMPLETED`

适用范围：Hermit bundled DSH Web、Desktop Core，以及需要系统级快捷键的第一方 Product
Plugin。本文是本阶段实现的需求与验收依据；插件自己的业务快捷操作仍由各自
`DESIGN.md` 负责。

## 1. 背景和要解决的问题

当前快捷键由桌面运行单元分别处理，用户只能在某个插件自己的设置页里看到它。这样有
三个实际问题：

1. 用户不知道所有快捷键在哪里，也看不出不同插件之间是否有冲突；
2. 新插件要接入快捷键时，容易重复实现 Electron 注册、持久化和冲突处理；
3. 快捷键和插件业务设置混在一起，导致一个插件的设置页承担了桌面公共能力。

目标是由 Desktop Core 提供唯一的快捷键注册 API，并在 DSH 设置中提供一个统一的“快捷键
中心”。插件只注册自己的命令信息和触发动作，用户在快捷键中心查看、修改和恢复默认值。

## 2. 一句话方案

```text
插件注册命令
    -> Desktop Core 保存并向系统申请快捷键
    -> DSH 快捷键中心读取 Core 快照
    -> 用户修改
    -> Core 先申请新组合，成功后释放旧组合
```

快捷键中心按插件竖向分组，每个插件下面展示自己的命令。当前没有真实快捷键动作的插件
不显示空分组，也不为了“以后可能用到”预先注册假命令。

## 3. 用户看到的页面

入口位于 DSH 的“设置 -> 快捷键”，是独立设置页，不放在 Smart Clipboard 的业务设置页
或“插件配置”标签页中。

示意：

```text
设置
├── 通用
├── 模型
├── 插件
└── 快捷键
    ├── 对话小窗
    │   └── 打开对话小窗       [⌘ ⇧ Enter]       已注册
    └── Smart Clipboard
        └── 打开剪贴板快速取回 [⌃ ⇧ Space]       已注册
```

每一行至少显示：

- 插件名称（作为分组标题）；
- 命令名称；
- 当前快捷键；
- 状态：`已注册`、`冲突`或`当前环境不可用`；
- 修改快捷键和恢复默认值的操作。

修改时使用按键录入控件，而不是让用户手写 Electron accelerator。用户按下一个完整组合
后，页面把它提交给 Core。Core 返回失败时，页面保留用户刚才的尝试并明确显示“与其他
应用或系统功能冲突”，不能显示“已保存”。

## 4. 目标和非目标

### 4.1 本阶段目标

- Desktop Core 提供统一、唯一的快捷键注册、修改、恢复、释放和状态查询能力；
- 所有快捷键记录包含插件身份和命令身份，可以稳定分组和展示；
- DSH 设置提供一个由 Core 数据驱动的快捷键中心；
- Smart Clipboard 和对话小窗迁移到同一套注册机制；
- 新插件能按照一份稳定的 typed contract 注册快捷键，不需要导入 Electron；
- 系统或其他应用占用时，冲突在快捷键中心可见，同时不影响插件的其他功能；
- 插件停用、DSH 重启和桌面退出时，快捷键能释放，页面不会留下已注销命令。

### 4.2 本阶段不做

- 不扫描进程、系统设置或其他应用来猜测冲突拥有者；操作系统通常只告诉我们“注册成功”
  或“失败”，页面统一显示冲突原因；
- 不自动抢占其他应用的快捷键，不提供“强制覆盖”；
- 不做按应用生效的上下文快捷键；
- 不做多段快捷键、鼠标手势、快捷键导入导出、云同步和快捷键统计；
- 不为 Organizer、File Workspace 或其他暂时没有真实动作的插件注册空行；
- 不创建通用 `desktopAPI`、任意 IPC 或让插件获取 Electron 对象；
- 不把快捷键状态复制到各个插件的 settings 文档中。

## 5. 责任边界

```text
Product Plugin
  提交插件/命令 metadata 和业务触发回调
          |
          v
Desktop Core ShortcutRegistry
  统一身份、持久化、内部冲突、系统申请、状态和生命周期
          |
          +--> window.hermitDesktopShortcuts（受限 preload facade）
          |          |
          |          v
          |     DSH 快捷键中心
          |
          +--> Electron globalShortcut（Core 内部唯一使用者）
```

### 5.1 Product Plugin

插件负责：

- 提供稳定的 `pluginId`、用户可读的 `pluginName`；
- 为每个命令提供稳定的 `commandId`、`commandName`、默认快捷键和触发动作；
- 在自己的生命周期开始时注册，在停用或卸载时释放；
- 处理触发后的业务动作和业务错误。

插件不负责：

- 调用 Electron `globalShortcut`；
- 保存快捷键用户配置；
- 判断系统是否已经占用；
- 绘制快捷键中心或维护快捷键中心的另一份状态。

### 5.2 Desktop Core

Core 负责：

- 保证命令身份唯一；
- 从 `userData/desktop/shortcuts.json` 读取和保存用户成功应用的快捷键；
- 先检查 Hermit 内部冲突，再调用系统注册；
- 把系统注册失败转换成可展示状态；
- 修改时先申请新组合，成功后释放旧组合；
- 在插件停用、DSH generation 失效和应用退出时释放资源；
- 通过窄 facade 给 DSH 页面提供列表、修改、恢复和变化通知。

Core 不保证知道外部冲突来自哪个应用；这属于系统能力边界，不能用猜测替代事实。

### 5.3 DSH 快捷键中心

快捷键中心是 Hermit 随 bundled DSH 一起提供的第一方设置贡献者，使用 DSH 公共
`settings.section` slot。它负责：

- 订阅 Core 的只读快捷键快照；
- 按 `pluginId` 分组、按注册顺序或稳定命令 ID 排序；
- 将按键录入转换为 Core 接受的 accelerator；
- 展示注册成功、内部冲突、外部/系统冲突和不可用状态；
- 在修改失败时保留当前有效值，不把失败尝试伪装成持久化成功。

它不读取 DSH 私有 store、私有 Router 或 DOM，也不把 Electron API 传给插件。

## 6. Core typed contract

本阶段先把 contract 放在 Hermit Desktop Core 的受控公共边界中。只有经过实际第二个插件
接入和双宿主资格验证后，才考虑将它抽成独立的外部 SDK package。

### 6.1 注册定义

```ts
interface ShortcutDefinition {
  readonly id: string
  readonly pluginId: string
  readonly pluginName: string
  readonly commandName: string
  readonly defaultAccelerator: string
  readonly onTrigger: () => void
}
```

`id` 是全局稳定命令身份，建议使用 `pluginId.commandId`，但 Core 只把它当作不透明的
稳定 key。`pluginName` 和 `commandName` 是展示 metadata，不由 Core 根据文件夹名猜测。

### 6.2 快照和状态

```ts
type ShortcutStatus = 'registered' | 'conflict' | 'unavailable'

interface ShortcutSnapshot {
  readonly id: string
  readonly pluginId: string
  readonly pluginName: string
  readonly commandName: string
  readonly defaultAccelerator: string
  readonly accelerator: string
  readonly status: ShortcutStatus
  readonly reason?:
    | 'internal-conflict'
    | 'external-or-system-conflict'
    | 'unsupported'
}
```

规则：

- `registered`：Core 申请成功，并再次确认系统确实由本应用持有；
- `conflict + internal-conflict`：和 Hermit 另一个已注册命令使用同一组合；
- `conflict + external-or-system-conflict`：其他应用或系统功能占用，或者平台只返回失败；
- `unavailable + unsupported`：当前平台不支持该组合或输入不符合 accelerator 约束；
- 只保存成功应用的自定义组合；默认组合冲突时不保存冲突值，下次启动继续按默认值重试；
- 修改失败时旧的已注册组合继续有效；如果旧组合本身没有注册成功，页面显示本次尝试的
  冲突状态。

### 6.3 面向 DSH 的 facade

```ts
interface DesktopShortcutFacade {
  list(): Promise<readonly ShortcutSnapshot[]>
  update(id: string, accelerator: string): Promise<{
    readonly applied: boolean
    readonly snapshot: ShortcutSnapshot
  }>
  reset(id: string): Promise<{
    readonly applied: boolean
    readonly snapshot: ShortcutSnapshot
  }>
  observe(listener: () => void): () => void
}
```

facade 只传输 metadata、当前 accelerator 和状态，不传输回调、Electron 对象、文件路径、
插件内部数据或通用 IPC。每次调用仍由主进程校验 sender、命令身份和输入格式。

## 7. 持久化和生命周期

配置文件由 Core 独占，结构保持简单：

```json
{
  "smart-clipboard.open": "CommandOrControl+Shift+Space",
  "conversation.quick.open": "CommandOrControl+Shift+Enter"
}
```

插件名称、命令名称和状态不写入这个文件；它们来自当前已注册命令，避免插件更新后出现
第二份过期 metadata。配置文件只保存用户成功应用的 accelerator，目录和文件按桌面用户
私有权限创建。

注册生命周期：

```text
插件激活 -> register -> 读取自定义值或默认值 -> 内部检查 -> 系统申请
插件停用 -> dispose -> 释放系统快捷键 -> 从 Core 列表移除
桌面退出 -> disposeAll -> 释放全部系统快捷键
```

快捷键冲突只影响对应命令，不回滚 Smart Clipboard 的剪贴板捕获、历史数据、History IPC
或其他插件；只有插件自身激活失败、DSH generation 失效等更高层生命周期事件才撤销整套
桌面运行单元。

## 8. 验收标准

### 8.1 Core 和数据流

- Smart Clipboard 与对话小窗都通过同一个 `ShortcutRegistry` 注册；生产代码没有其他
  `globalShortcut.register` 调用；
- 同一组合的两个 Hermit 命令在调用系统前被标记为内部冲突；
- 模拟其他应用占用时，冲突命令可见，另一个命令和插件其他功能不受影响；
- 修改为可用组合后，新组合生效、旧组合释放、成功值持久化；修改失败时旧组合仍生效，
  配置文件不写入失败值；
- 停用、重新激活和应用退出后，系统快捷键和 Core 列表都没有残留注册。

### 8.2 DSH 页面

- 在 DSH“设置”中能找到独立的“快捷键”页面；
- 页面按插件竖向分组，每个真实注册命令只出现一行；
- 页面能显示当前组合、已注册、冲突和不可用状态；
- 用户按键后可以修改并看到成功或失败结果；失败不会显示为已保存；
- 能恢复默认值；没有快捷键的插件不出现空分组；
- Smart Clipboard 自己的业务设置页不再承担全局快捷键编辑。

### 8.3 宿主和安全

- bundled DSH Web 使用 `settings.section` 公共 slot，stock DSH 不获得 Hermit 私有 facade；
- preload 只暴露 `window.hermitDesktopShortcuts` 的已声明方法，Renderer 无法取得
  `ipcRenderer`、Node、Electron 对象或通用转发器；
- 打包后的桌面端完成设置页加载、列出快捷键、修改成功、冲突显示和停用释放的真实流程
  验证；
- Core 文档、DSH 集成契约、插件接入文档和本 spec 对职责与状态描述一致。

## 9. 分步开发顺序

1. 将现有 `ShortcutRegistry` 补成包含插件 metadata、列表查询、恢复默认和注销清理的
   Core contract，并补 Core 测试；
2. 增加 `hermitDesktopShortcuts` 窄 preload facade，复用已有 sender/schema 校验边界；
3. 在 bundled DSH 中增加“设置 -> 快捷键”的第一方 `settings.section` 页面；
4. 移除 Smart Clipboard 业务设置页中的临时快捷键控件及专属快捷键读写 API；
5. 让 Smart Clipboard 和对话小窗验证 generic registry；其他插件只有出现真实快捷键
   动作时再注册；
6. 完成模块测试、打包 UI 测试和文档治理后，再把当前实现同步到 Desktop Core 权威文档。

## 10. 设计依据

- DSH rc.2 官方设置 contract：`settings.section` 是“每项功能一页”，而
  `settings.plugins.tab` 是“插件”分区内的功能配置页，因此快捷键中心使用前者；
- Electron 官方 `globalShortcut.register`：返回值只能说明系统是否接受申请，失败时不能
  可靠知道冲突拥有者，所以页面展示“其他应用或系统功能冲突”；
- Raycast 的 Shortcuts 设置采用集中列表、搜索和就地编辑；Hermit 当前数量很少，先保留
  按插件分组和就地编辑，不提前加入搜索；
- Alfred 把快捷键冲突作为用户可见的配置问题，但其按应用上下文快捷键复杂度不纳入本阶段；
- macOS 系统快捷键设置和 Maccy 的使用说明都把修改冲突快捷键交给用户，Hermit 采用同样
  的“明确展示、用户自行修改”原则。
