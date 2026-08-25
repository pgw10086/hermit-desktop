# 桌面装配规则

本目录是唯一的桌面混合装配层。

- 使用固定 DSH Web shell 和平台共享的 React/ReactDOM singleton；
- 只通过批准的 adapter 和公开 slot/contract 使用 DSH；
- 产品插件 UI 不得直接调用 Tauri/native，特权意图必须经过 Core-owned IPC 和
  Capability Broker contract；
- Tauri executable 保持轻薄：窗口、进程、Rescue 和 native provider 在此装配，
  业务行为留在所属 owner；
- 每个平台都必须验证 WebView 启动、关闭、取消、crash generation、键盘、IME、
  drag/drop、overlay 和 theme 行为。
