# `@hermit/organizer`

Personal Organizer 是 Hermit 的个人事项 Product Plugin，负责 Note、Todo、Event、Reminder
的业务规则、Canonical 数据、搜索和 Product Surface。DSH 是唯一的 AI 入口；插件通过一个
Skill 和受控 Tool 接收明确的记录、安排和完成意图。

开发入口：先读[Product Plugin 开发规范](../development-guidelines.md)，再读[本插件设计](DESIGN.md)。
Organizer 目前只使用 DSH Host/Client、Storage、Connection RPC、Skill、Tool 和 Product Surface，
不需要 Desktop Core capability。

```sh
corepack pnpm --filter @hermit/organizer test
corepack pnpm run test:organizer:product-surface
```

产品范围、业务规则和页面流程只以 `DESIGN.md` 与核心需求为准；这里不复制 DSH API、Electron
实现或详细 UI 规则。
