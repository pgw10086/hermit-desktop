# `@hermit/smart-clipboard`

这是 Smart Clipboard 的完整业务实现包：插件负责 Canonical 类型、搜索、保留和管理规则，
Core 负责 SQLite、本机剪贴板读写、全局快捷键、自动粘贴和导出文件，DSH Client 负责
History 工作面。插件本身不直接访问 Electron、系统剪贴板、快捷键、文件系统或 DSH 私有
API；所有平台能力都通过 Core 注入的公开边界完成。

开发入口：先读[Product Plugin 开发规范](../development-guidelines.md)、[Desktop Core 开发规范](../../docs/development/desktop-core-development.md)，
再读[本插件设计](DESIGN.md)。当前桌面能力声明位于 `package.json` 的 `hermit.desktop.capabilities`。

当前已实现：TEXT、IMAGE、FILE_LIST 捕获与精确去重；100 条默认历史上限、1 GB 默认容量、
保留期限、排除应用/类型、置顶、Trash、恢复、永久删除、清空、忽略下一次、暂停、版本化
ZIP 导出；History 列表/详情以及鼠标附近的紧凑快捷取回浮层；Enter、Mod+Enter、Shift+Enter
动作映射；SQLite + trigram FTS5 重启恢复；macOS Objective-C++ N-API bridge 的稳定快照、
格式化写回和 generation/token 守卫的 best-effort 自动粘贴。Hermit bundled DSH 已通过受控、精确
锁定的 Product Surface source patch 提供一级侧栏入口和完整 History；同一插件 artifact 在
stock DSH 中保留 `settings.plugins.tab` fallback，并在缺少 Hermit Core facade 时明确显示
unavailable。完整 History 直接复用 DSH 公开布局、菜单、输入、按钮、提示、设置行和图标，
并使用 CSS Modules 与 DSH 语义 token；生产组件不包含 mock 或 preview mode。桌面快捷取回
浮层由 BrowserWindow 加载实际 React renderer 制品，默认约 480px 单列；选中项稳定后在同一
BrowserWindow 内按需展开贴靠 sidecar 预览，共享插件公开的 typed client API，不再使用内联
data URL 页面。插件没有使用私有 Router、DOM 注入或第二套 DSH 页面壳。

```sh
corepack pnpm --filter @hermit/smart-clipboard test
```

桌面包、DMG 和后续版本更新按[通用打包流程](../../docs/development/smart-clipboard-packaging-runbook.md)执行。

领域规则和客户端范围：

- 空文本、`transient`、`concealed`、`auto-generated` marker 和超过内容上限的记录不入库；
- 完全相同的内容复用原 ID，更新最近使用时间和来源；
- 普通历史默认最多 100 条，置顶不占条数但计入容量；
- 搜索只在纯文本和文件名/路径上匹配，不读取文件正文、不对图片做 OCR；
- 自动粘贴失败时保持已复制状态并显示手工粘贴提示；
- `storage-full` 和捕获不可用持续显示，FILE_LIST 在展示、导出和使用前刷新引用状态；
- 导出是本地 ZIP 快照，不触发网络，也不承诺导入/同步；
- AI 和 `@clipboard` 仍按 `DESIGN.md` 的 M3.1/M3.2 里程碑后置。

当前 macOS 产物仍是未签名候选。native 测试使用唯一命名 pasteboard，成品自动资格只验证
addon 可加载，不读取或改写用户 General Pasteboard；真实复制/粘贴、辅助功能权限、物理
快捷键、Developer ID 签名和公证仍是发布前独立资格门。
