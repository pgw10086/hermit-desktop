# Product Plugin 开发规范

状态：`current`

本文是 Hermit 第一方 Product Plugin 的共同入口。它只写 Hermit 自己的约定；DSH 的官方
API、生命周期和打包规则见[DSH 官方资料](../DEEPSEEK-HARNESS-UPSTREAM.md)，桌面能力见
[Desktop Core 开发规范](../docs/development/desktop-core-development.md)。

## 一个插件是什么

一个插件是一套完整业务，可以有自己的 Host、Client、Tool 或 Desktop Core 接入，但不要求
每个插件都具备全部角色。

插件负责自己的：

- 业务数据和数据迁移；
- 业务规则、搜索和状态变化；
- 业务页面和 DSH 工作面里的内容；
- 给 DSH 使用的 Skill、Tool 或资源投影。

插件不负责：

- 重新实现 DSH 的会话、模型、审批或插件运行时；
- 复制 DSH shell、主题和通用 UI 组件；
- 直接使用 Electron、Node、私有 preload、私有 Router 或 DSH `src/*`；
- 直接读写另一个插件的数据库或内部文件。

## 选择依赖的顺序

实现新能力时按下面的顺序判断：

```text
DSH 官方公开能力 -> 插件自己的业务代码 -> Desktop Core
```

- 生命周期、Host/Client、Storage、Filesystem、Remote/RPC、Tool 和公开 UI 能力，优先用
  DSH；
- 业务模型和业务流程留在插件里；
- 只有必须使用系统资源或 Electron 的场景，才申请 Desktop Core capability；
- “DSH 没有现成函数”不等于可以读取 DSH 私有实现。确有缺口时先补公开 contract，再让
  插件使用它。

## Host、Client 和通信

- Host 负责服务、数据和 Tool 注册；Client 负责页面展示和交互；
- Host 与 Client 之间使用 DSH 公开的 Connection/RPC 或 Hermit 已批准的 contract；
- Client 不直接调用 Electron、Node、文件系统或通用 IPC；
- 页面只维护自己的临时交互状态，业务数据以 Host 返回的 Canonical 快照为准；
- 一个业务规则只能有一份实现，页面按钮和 DSH Tool 都调用同一个领域服务。

## 数据和生命周期

- 插件拥有自己的 Canonical 数据、迁移和派生索引；
- 派生搜索、缩略图和缓存可以重建，不能替代用户原件；
- 停用、卸载和删除数据是不同动作，默认不因卸载而删除用户的 Canonical 数据；
- watcher、timer、listener、窗口、RPC 和 Tool registration 都要随当前 activation generation
  注册和释放；
- 迟到的异步结果不能覆盖新的状态，也不能在插件已经停用后继续写入。

## DSH 和 AI

- DSH 是唯一的 AI 入口。插件可以提供 Skill、Tool 和安全资源，但不能自己调用模型或保存
  Provider 凭据；
- 插件的写操作经过 DSH Tool、权限和 Approval；
- `@` 引用只代表用户明确选择的资源，不自动把正文复制进输入框；
- 没有成功结果时，插件或 Skill 不能告诉用户“已经保存”或“已经读过”。

## 桌面能力

插件声明实际用到的 capability，并对不可用状态给出清楚提示。

- 普通文件和业务存储先用 DSH；
- 系统剪贴板、全局快捷键、原生窗口、通知和焦点恢复使用 Desktop Core；
- 插件只依赖公开的 typed API，不依赖 `apps/desktop-vnext` 的实现文件；
- 不为了“所有插件统一”给纯 Web 插件增加桌面依赖。

Desktop Core 的能力边界、API 形式和打包后的桌面验证见[Desktop Core 开发规范](../docs/development/desktop-core-development.md)。

## 页面和 UI

页面直接挂在 DSH 提供的 Product Surface、slot 或公开 route 中，复用 DSH 的公开组件、
图标和语义 token。插件自己的列表、编辑器和领域状态留在插件内，不复制一套 DSH shell。
持久产品入口只注册 layout 的 `ProductEntry` metadata；入口排列、active、收起表现和
导航切换由 Core 统一负责，插件不注册自己的 sidebar navigation React 组件。

具体布局、键盘、响应式和截图验收规则见[前端 UI 设计规范](../docs/development/frontend-ui-design.md)
和[Product Plugin UI 规范](ui-guidelines.md)。

## 制品和测试

- 每个需要安装的插件都有真实 `package.json`、稳定 exports、许可证、构建产物和 DSH
  metadata；
- DSH、React 和 ReactDOM 使用宿主提供的版本，不在插件制品里复制；
- 普通插件至少验证 clean build、主要业务流程、停用和数据回读；
- 使用 Product Surface 或 Desktop Core 的插件，再增加对应的真实宿主/打包验证；
- 测试业务规则、权限拒绝、旧 revision、取消、重复调用和生命周期释放，不测试 padding、
  颜色或 README 快照。

制品构建、Profile 激活、双宿主和发布资格见[Hermit DSH 集成与打包标准](../docs/development/dsh-plugin-development-and-packaging.md)。

## 文档怎么写

- `plugins/README.md` 只做导航；
- 本文只写所有插件共用的规则；
- 每个插件的 `DESIGN.md` 只写自己的产品范围、流程、业务模型和验收；
- `README.md` 只写开发者如何安装、构建和验证；
- DSH、系统边界、安全和打包事实只在对应权威文档维护，其他地方只引用；
- 新增限制前先说明要解决的真实问题，没有明确收益的不写。
