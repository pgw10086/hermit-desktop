# Hermit vNext

Hermit vNext 是一款以固定并通过资格认证的 DeepSeek Harness（DSH）为底座的本地
优先桌面 AI 工作台。Tauri/Rust 负责桌面和最底层恢复，DSH 负责 AI Session、
Tool、Approval 和 Web composition；完整业务能力以可独立安装的产品插件
（Product Plugin）提供。

当前状态：Private incubation；文档基线正在收敛，DSH `0.1.1-rc.2` 的 M1 资格认证
在 Client module Host 契约处阻塞，尚未开始产品代码开发。开工条件见
[项目启动准备](specs/2026-08-24-hermit-dsh-vnext/start-readiness.md)和
[M1 底座资格认证](specs/2026-08-24-hermit-dsh-vnext/m1-foundation-qualification.md)。

## 文档入口

- [开发 Agent 规则](AGENTS.md)：编码任务的导航和红线；
- [核心需求](specs/2026-08-24-hermit-dsh-vnext/core-requirements.md)：产品范围、
  插件划分和业务闭环；
- [项目启动准备](specs/2026-08-24-hermit-dsh-vnext/start-readiness.md)：开工条件和
  第一条技术闭环；
- [M1 底座资格认证](specs/2026-08-24-hermit-dsh-vnext/m1-foundation-qualification.md)：
  DSH 版本证据、gate、STOP 条件和 M1/M2 边界；
- [仓库布局](docs/repository-layout.md)：顶层所有权和生命周期；
- [系统边界](docs/architecture/system-boundaries.md)：Core、DSH、桌面端和插件的职责；
- [DSH 集成契约](docs/contracts/dsh-integration.md)：公共接口、React 和 UI 集成；
- [产品插件安全契约](docs/contracts/product-plugin-security.md)：安装、权限和隔离；
- [运行时 Agent 契约](docs/contracts/runtime-agent.md)：Session、Tool、审批和恢复；
- [工程规则](docs/development/engineering-rules.md)：开发、测试、文档和工作区安全。

调研资料保存在 `docs/research/`，用于追溯决定依据，不是默认开发入口。

## 当前验证

在仓库根目录运行：

```powershell
node scripts/verify-agent-contracts.mjs
```

当前中文 `README.md` 是权威入口。确有英文读者时再增加带 `translation-of` 声明的
派生翻译。
