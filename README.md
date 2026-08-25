# Hermit vNext

Hermit vNext 是一款以固定并通过资格认证的 DeepSeek Harness（DSH）为底座的本地
优先桌面 AI 工作台。Tauri/Rust 负责桌面和最底层恢复，DSH 负责 AI Session、
Tool、Approval 和 Web composition；完整业务能力以可独立安装的产品插件
（Product Plugin）提供。

当前状态：Private incubation 和 PR0 文档/目录 bootstrap，尚未开始产品代码开发。
开工条件见[项目启动准备](specs/2026-08-24-hermit-dsh-vnext/start-readiness.md)。

## 先读这些

- [开发 Agent 规则](AGENTS.md)
- [仓库布局](docs/repository-layout.md)
- [系统边界](docs/architecture/system-boundaries.md)
- [核心需求](specs/2026-08-24-hermit-dsh-vnext/core-requirements.md)
- [文档索引](docs/README.md)

## 仓库范围

Hermit vNext 是当前产品实现、架构和工程规则的权威仓库。

- 当前系统边界由 `docs/architecture/system-boundaries.md` 定义；
- 目录职责由 `docs/repository-layout.md` 定义；
- 工作区安全由 `docs/development/workspace-safety.md` 定义；
- 迁移输入、authority transfer、cutover 和 rollback 只由 `migration/` 及对应
  change-specific `specs/` 维护。

当前中文 `README.md` 是权威入口。未来公开需要英文入口时，再创建带
`translation-of` 声明的 `README.en.md` 派生翻译。
