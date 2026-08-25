# 安全策略

Hermit vNext 当前处于 Private incubation，尚无受支持的 production release。

安全问题应私下报告给仓库 owner。不得创建包含 credential、用户数据、exploit
细节或未脱敏日志的公开 Issue。

## 安全边界

- Product Plugin 不会因为属于 Cordis/DSH plugin 就自动受信任；
- Production 只接纳第一方或 Hermit 审计签名的 artifact；
- Secret 使用 reference，由 Core-owned credential provider 解析，不进入 fixture、
  log 或 plugin config；
- 真实用户数据和兄弟 legacy 仓库不属于编码 Agent 范围；
- Release、publish、sign、migration 和 cutover 必须经过明确授权和受保护环境。

完整插件和 Runtime Agent 安全规则位于 `docs/contracts/`。
