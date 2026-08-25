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
corepack pnpm qualification:install
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm test
```

上述命令必须由 `.node-version` 指定的 Node 运行。第一条命令在 `.hermit/tmp` 创建
一次性独立 workspace，从已提交的 frozen lock 完整安装并检查 peer，然后删除该
workspace；它不复用当前 `node_modules`。第二条命令才为当前工作区安装依赖。两条
命令都禁止 dependency lifecycle script。

当前 M1 硬门使用 `corepack pnpm qualification:client-module-host` 检查。对
`0.1.1-rc.2` 运行时应返回 `Q-CMOD-01 blocked` 和退出码 2；目标版本或发布形状变化
时返回 `review-required` 和退出码 3。当前没有自动通过状态，必须先为新增的官方
public contract 实现完整行为 verifier，才能继续 Tauri 实现。

当前中文 `README.md` 是权威入口。确有英文读者时再增加带 `translation-of` 声明的
派生翻译。
