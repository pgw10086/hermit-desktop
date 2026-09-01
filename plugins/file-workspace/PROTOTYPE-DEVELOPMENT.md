# File Workspace 原型开发说明

本原型用于验证 [DESIGN.md](DESIGN.md) 的工作面和交互流程，并尽量保持与正式实现相同的
组件边界。原型不是 Product Plugin 制品，不接真实 FileRecord、Core、文件系统或 DSH
Session 数据。布局、信息层级和组件复用服从
[项目前端 UI 设计规范](../../docs/development/frontend-ui-design.md)。

## 组件规则

- DSH public primitives 能覆盖的控件直接使用当前锁定制品的公开 root export，例如
  `Button`、`Input`、`Modal`、`Toast` 和公开图标；不复制其源码或 CSS。
- DSH 没有的文件树、编辑器、导入流程和领域状态由 File Workspace 自己实现，局部样式只
  使用 DSH `--dsw-*` semantic alias，不创建第二套主题或通用 UI 包。
- Hermit Product Surface v1 是正式唯一承载面；原型预览可以有本地挂载层，但只负责提供
  可用空间，不复制 Conversation、窗口标题栏、辅助栏或宿主导航，也不得读取 DSH 私有
  DOM、store、Router、CSS 或 `src/*`。
- 所有业务数据使用内存 mock，并让交互动作对应未来的 File Workspace/Core service；替换
  mock 不应要求重写工作面组件。
- 原型允许选择或拖放任意普通文件；Markdown 具备直接编辑演示，其他格式只显示可靠文件
  信息和能力边界。“可添加”不得伪装成所有格式都可预览、编辑、解析或用于 AI。
- File Workspace 工作面只渲染统一文件树和当前文件区。宿主区域关闭或为空时必须退出布局，
  工作面按获得的空间自动重排，不能保留空列。

## 预览入口

在 `.hermit/tmp/file-workspace-ui-prototype` 中运行 `corepack pnpm start`，打开
`http://127.0.0.1:4173/`。本地入口只挂载可复用的 File Workspace 工作面，不模拟宿主
Conversation、窗口标题栏和辅助栏。Product Surface 的打开、关闭和响应式布局由公开
DSH/Hermit 契约负责，工作面只响应宿主提供的可用空间。

本原型只保留已经确认的单一布局 A。正式实现前仍须以 UI foundation 资格结果确认 DSH
package、React 单实例和 theme 注入条件。
