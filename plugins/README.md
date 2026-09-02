# Product Plugin 设计与开发入口

状态：`current`

`plugins/` 保存第一方 Product Plugin 的当前设计，并在实现开始后承载各插件的可安装
制品。一个目录代表一套完整业务，不代表一个页面、按钮或 DSH Tool。

新增插件先看[Product Plugin 最小接入](../docs/development/product-plugin-quickstart.md)。开发
规范见[Product Plugin 开发规范](development-guidelines.md)；需要系统剪贴板、全局快捷键、
原生窗口等桌面能力时，再看[Desktop Core 开发规范](../docs/development/desktop-core-development.md)。

## 当前目录

```text
plugins/
|-- development-guidelines.md
|-- ui-guidelines.md
|-- organizer/
|   |-- README.md
|   `-- DESIGN.md
|-- file-workspace/
|   |-- README.md
|   `-- DESIGN.md
`-- smart-clipboard/
    |-- README.md
    `-- DESIGN.md
```

设计期只有 `DESIGN.md` 是正常状态，不表示插件已经实现、可以安装或进入发布候选。实现
开始后再由真实 manifest、代码、测试和打包配置证明实现状态。

平台接入参考位于
[`packages/dsh-plugin-reference`](../packages/dsh-plugin-reference/README.md)。它只验证 DSH
公共 Bundle、Host、Client、Settings、Tool、Product Surface、React 和生命周期，不是第四个
业务 Product Plugin，也不提供三个业务插件共用的伪基类或业务页面。

## 文档分工

| 事实 | 权威来源 |
| --- | --- |
| 产品定位、插件划分、业务规则和发布验收 | [核心需求](../specs/2026-08-24-hermit-dsh-vnext/core-requirements.md) |
| 所有插件共同遵循的开发方式 | [插件开发规范](development-guidelines.md) |
| Desktop Core 的职责、桌面 API 和生命周期 | [Desktop Core 开发规范](../docs/development/desktop-core-development.md) |
| DSH 官方插件 API、生命周期、Bundle/Profile、CLI 和 Client 资料版本 | [DSH 官方上游资料](../DEEPSEEK-HARNESS-UPSTREAM.md) |
| 所有前端共同遵循的布局、层级和交互规则 | [前端 UI 设计规范](../docs/development/frontend-ui-design.md) |
| Product Plugin 的 DSH 接入和组件所有权 | [插件 UI 规范](ui-guidelines.md) |
| 某个插件当前功能、信息架构、流程和低保真原型 | 对应目录的 `DESIGN.md` |
| 系统职责、DSH 接入、安全和运行时 Agent | `docs/architecture/` 与 `docs/contracts/` 对应权威文档 |

`DESIGN.md` 不复制跨项目规范，也不重新定义 Core、DSH 或安全边界。核心需求不维护
高频变化的页面布局；两者发生冲突时，先判断是产品范围变化还是交互设计变化，再修改
对应的唯一权威来源。

## 设计会话规则

1. 一个会话只设计一个 Product Plugin，并只更新该插件的 `DESIGN.md`。
2. 先读取核心需求中对应插件章节、本文、父级开发规范和 UI 规范。
3. 当前阶段只确认功能、信息架构、页面关系、交互流程、状态和范围取舍；不冻结具体
   UI 组件、颜色、字号、间距或高保真视觉。
4. 已确认结论直接写成当前设计；仍需用户决定的内容放进“待确认问题”，不能把多个
   互斥方案同时写成现行事实。
5. 若讨论要求改变插件边界、核心业务规则、AI 权限或数据归属，先提出变更和影响，
   用户确认后再同步核心需求或契约。
6. 调研记录、过程日志和废弃方案不堆进 `DESIGN.md`；只保留仍影响当前设计的理由。

## 状态含义

- `DISCOVERY`：正在确认功能、页面和交互，不能据此直接宣称实现范围冻结。
- `READY_FOR_IMPLEMENTATION`：关键流程、状态、边界和首条 vertical slice 已确认。
- `IMPLEMENTED`：设计已由当前代码和验收证据实现；后续变化仍先更新设计再实施。

状态只描述设计成熟度，不替代测试、打包或发布 Gate。
