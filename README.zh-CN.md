# Hermit vNext

Hermit vNext 是一款以固定并验证过的 DeepSeek Harness（DSH）为底座的本地优先
桌面 AI 工作台。Tauri/Rust 负责桌面与最底层恢复，DSH 负责 AI Session、Tool、
Approval 和 Web 组合，个人事务、文件工作台、智能剪贴板等业务以可独立安装的
Product Plugin 提供。

当前状态：私有孵化和文档/目录初始化，尚未开始产品代码开发。开工条件见
[项目启动准备](specs/2026-08-24-hermit-dsh-vnext/start-readiness.md)。

## 先读这些

- [开发 Agent 规则](AGENTS.md)
- [仓库布局](docs/repository-layout.md)
- [系统边界](docs/architecture/system-boundaries.md)
- [核心需求](specs/2026-08-24-hermit-dsh-vnext/core-requirements.md)
- [文档索引](docs/README.md)

## 仓库边界

本仓库与旧 Go 产品完全分开，不复制旧源码和真实用户数据。迁移开发只使用
synthetic fixture 或有 provenance 的脱敏 fixture，并固定旧系统来源身份。
