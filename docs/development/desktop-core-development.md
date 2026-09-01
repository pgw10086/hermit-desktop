# Desktop Core 开发规范

状态：`current`

本文只说明 Hermit Desktop Core 什么时候存在、应该提供什么，以及插件怎样安全地使用它。
它不是 Electron 教程，也不复制 DSH 官方插件文档。

## 先用哪一层

遇到一个新需求时，按这个顺序判断：

```text
DSH 官方公开能力 -> Product Plugin 业务代码 -> Desktop Core 桌面能力
```

- DSH 已经有合适、公开并经过 Hermit 验证的能力，就直接使用 DSH。
- 需求属于某个产品的业务规则、数据或页面，就放在 Product Plugin。
- 只有确实需要 Electron、操作系统或整台桌面的共享资源，才进入 Desktop Core。

“进入 Core 比较方便”不是理由。新增能力时要能说清楚 DSH 为什么不够，以及哪个真实产品
流程正在使用它。

## Desktop Core 负责什么

Desktop Core 是桌面外壳和原生能力的负责人，常见范围包括：

- Electron 应用生命周期、窗口、Tray、单实例和退出协调；
- 系统剪贴板读写或监听；
- 全局快捷键；
- 需要置顶、独立尺寸或鼠标附近显示的原生窗口；
- 系统通知、焦点恢复和操作系统权限探测；
- 原生 addon、系统文件选择器等确实无法由 DSH Web 完成的能力。

普通业务文件读写、业务存储、业务搜索、页面列表和编辑器不属于 Core，优先走 DSH 或插件
自己的业务代码。

## 对外只给能力

插件看到的是稳定的 TypeScript 能力接口，不是 Electron 对象。例如：

```ts
clipboard.observe()
shortcut.register(command)
quickSurface.open(options)
```

不要向插件暴露 `BrowserWindow`、`ipcRenderer`、Node 文件系统、原生模块实例或通用 IPC
转发器。Core 内部可以使用这些实现，但它们不属于插件契约。

每个能力都应该说明：

- 能做什么和不能做什么；
- 成功、取消、权限拒绝和暂时不可用时返回什么；
- 由哪个插件申请，以及如何在插件停用时释放；
- macOS、Windows 或其他平台当前是否可用。

不要求所有平台一次实现。某个平台暂时不可用时，要返回清楚的 `unavailable`，不要偷偷
加载一个行为不同的替代实现。

## 生命周期

Core 创建的窗口、快捷键、监听器、定时器、IPC handler、数据库连接和原生资源，都必须归
当前 activation generation 所有。

- 启动失败时，已经创建的资源要按顺序清理；
- 停用或卸载插件时，先让旧回调失效，再释放资源；
- DSH 重启、应用退出和崩溃恢复都要经过同一套可重复调用的停止流程；
- 异步结果回来时，先确认 generation 仍然有效，过期结果不能再产生副作用。

## 安全边界

- 主进程持有 Electron 和系统权限；Renderer 使用 `contextIsolation`、sandbox 和最小
  preload；
- IPC 请求必须校验发送窗口和输入数据；
- 事件通知只传状态变化，不广播剪贴板正文、完整路径或其他不必要的数据；
- Core 不保存插件的业务规则、AI 会话、模型凭据或第二份业务数据；
- 真实用户数据、凭据和系统剪贴板不进入测试 fixture。

详细的 Electron/DSH 运行时安全边界见
[系统边界](../architecture/system-boundaries.md)、[DSH 集成契约](../contracts/dsh-integration.md)
和[产品插件安全契约](../contracts/product-plugin-security.md)。

## 新增能力的最小检查

新增 Desktop capability 前，补充以下事实即可：

1. 真实使用它的产品流程；
2. DSH 官方能力为什么不能完成；
3. 对外 TypeScript 接口和失败结果；
4. 停用、卸载和退出时的清理方式；
5. 至少一条打包后的真实流程验证。

不要预先建立万能 `desktopAPI`、复杂权限清单或未来能力目录。第二个真实使用者出现后，
再判断是否需要抽成更通用的接口。

## 和 Product Plugin 的关系

Product Plugin 只依赖公开的 Desktop Core contract，不依赖 `apps/desktop-vnext` 的内部
文件，也不直接导入 Electron。插件负责业务含义，Core 负责把能力安全地执行出来：

```text
插件：选择哪条历史、执行什么业务动作
  -> Desktop Core：读写系统剪贴板、注册快捷键、打开窗口
  -> 插件：根据结果更新自己的业务状态和页面
```

需要 DSH Web 能完成的事情，不得为了统一而绕到 Core。需要桌面特权的事情，也不得为了
“插件独立”而把 Electron 代码塞进普通 Product Plugin。

## 验收

- Desktop Core 自己的测试覆盖能力接口、失败结果和资源释放；
- 使用 Core 的插件增加打包后的桌面流程测试；
- 纯 Web 插件不因为随桌面发布而继承 Desktop Core 验收；
- DSH 或 Electron 版本变化时，重新验证实际使用的能力，不把一次测试结果写成永久保证。

打包、制品和双宿主资格见
[Hermit DSH 集成与打包标准](dsh-plugin-development-and-packaging.md)。
