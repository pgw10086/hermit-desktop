# UI Foundation 资格方案

状态：`PARTIAL`，Product Surface v1 和 Organizer 首批所需 DSH public primitives 已通过；
未使用的组件仍是 candidate，当前没有创建 `@hermit/ui` 的真实共享缺口

本文记录 M1 阶段 DSH UI 公共面和未来 `@hermit/ui` 的一次性资格方案。它不是 UI
规范的第二份权威来源；当前设计和组件创建规则以
[Product Plugin UI 与组件创建规范](../../plugins/ui-guidelines.md)为准，长期产品边界以
[核心需求 6.9](core-requirements.md#69-ui-组件和-dsh-风格契约)为准。

## 要回答的问题

资格验证只回答以下事实，不在本阶段扩展业务页面：

1. pinned DSH 的哪些公共 UI export 能被外部 Client 插件稳定加载；
2. 这些组件能否继承 DSH light/dark/system 主题、semantic token、portal 和 focus 行为；
3. 未来的 `@hermit/ui` 能否保持编译期依赖，同时把 React、ReactDOM 和 DSH 平台模块
   externalize 给 Host；
4. 同一个资格制品能否在 stock DSH 和 Hermit bundled DSH（必要时含受控 source patch）中得到一致结果；
5. 当前公开 seam 只足够做 Settings 资格探针，还是已经存在可承载日常业务页面的正式
   Product Surface。

第 5 项必须单独给出结论。Settings contribution 验证通过不等于 Product Surface 已存在，
也不能据此依赖私有 Router、DOM 或 CSS selector。

## 已确认的设计

- 初期只有一个未来共享包：`packages/ui/`，包名 `@hermit/ui`。
- 包内可以按 `components/`、`styles/` 和 DSH adapter 分职责，但只提供一个经过人工维护的
  公共入口，不因此增加多个 workspace package。
- `@hermit/ui` 不是 Theme Provider、运行时 service、Product Plugin 或 DSH fork。
- 插件领域 UI 留在各插件；Desktop carrier UI 留在 `apps/desktop-vnext`。
- 资格通过前不创建包目录、manifest 或占位组件。第一份实现必须同时解决一个真实 UI
  缺口，并接入资格制品。

## 资格载体

优先扩展已有的 `packages/dsh-plugin-reference`，不再创建第二个空 fixture。该包已经验证
Bundle、Host、Client、Settings、Tool、React 单实例和插件生命周期，可把 UI 验证限定在
同一个已知接入面内。

验证分两段：

### A. DSH 公共面探针

在 reference plugin 的资格页中直接接入候选 DSH public export，记录实际 export、类型、
渲染、主题和交互结果。此时不创建 `@hermit/ui`，目的是先区分“包里看见的名字”和“外部
插件可依赖的公共能力”。

### B. `@hermit/ui` 条件纵切

A 通过后不自动创建 `packages/ui/`。稳定且无需 Hermit 补语义的 DSH public primitive
直接从经资格的 package root 消费；只有出现真实、与领域无关的共享缺口，或需要隔离
版本/补可访问性时，才创建带真实代码的 `packages/ui/`。该纵切仍必须重跑同一套
stock/Hermit 资格，并证明没有带入第二份 React、ReactDOM、DSH platform module 或全局样式。

如果 A 失败，不进入 B；先修正 DSH 接入假设、推动上游公开契约，或按 ADR 为 Hermit bundled
DSH 增加最小 source patch。无论哪条路径，都不能用插件私有 import、DOM 注入或视觉复制绕过；
source patch 必须先成为公开 typed contract，并单独通过构建、license/notice、双宿主和生命周期
资格。

## 初始候选

下表是探针范围，不是已冻结 allowlist：

| 候选能力 | 重点验证 | 初始状态 |
| --- | --- | --- |
| Button、Input | export、基础状态、主题、focus、React identity | `PASS` |
| Menu | portal、选择、outside click、Product Surface Escape | `PASS with scope` |
| Tooltip | 原生 DOM ref 锚点的 focus/position | `PASS with scope` |
| Toast、DisclosureRow | portal 反馈、受控展开、主题 | `PASS` |
| Modal、Pill、StateDot | 本轮未使用 | `candidate` |
| 本轮 exact 公共图标 | export 稳定性、bundle 边界 | `PASS` |

2026-08-31 的 Reference Plugin 同制品已在 stock/Hermit 真实宿主通过上表首批能力；
Organizer 的真实 Product Surface 又验证了 Menu Escape、DSH semantic token 继承、400px 窄窗口、
右侧单实例抽屉和 React externalize。`Tooltip` 的 public API 需要 DOM ref 锚点；当前 public
`Button` 不转发 ref，两者不得直接组合。`Menu` 在 Settings Modal 内的 Escape 会联动
父层关闭，所以只在已验证的 Product Surface 范围内放行。这些结论不把整个
primitives 包升级为 allowlist，也不触发空 `@hermit/ui`。

第 5 项已经得到结论：stock rc.2 没有 Product Surface；Hermit bundled DSH 通过 ADR-0003
受控 patch 提供 `product.surface`、`openProductSurface/closeProductSurface` 和契约版本标记。
同一 Smart Clipboard artifact 在 stock 中使用 Settings fallback，在 Hermit 中使用一级业务
入口。patch 上游身份、许可证和 client digest 由 runtime/afterPack 门禁校验。

只有验证记录完整的候选才能标记为 `qualified`。稳定 DSH public export 的 allowed
入口是精确 package root 和限定用法；Hermit 自有共享能力的 allowed 入口才是
`@hermit/ui`。失败候选直接记录原因并退出，不保留静默 fallback。

## 未来包的最小形态

以下是资格通过后的目标形态，不授权现在创建目录：

```text
packages/ui/
  src/index.ts          # 唯一公共入口，显式导出
  src/dsh/              # DSH 公共面适配和版本隔离
  src/components/       # 真实共享组件
  src/styles/           # 仅局部布局与组件样式
  tests/                # 交互、打包和边界测试
```

DSH UI 包、React 和 ReactDOM 使用与 reference plugin 一致的 peer/external 策略。公共入口
不能 `export *` 透传整个 DSH 包；稳定 primitive 可以受控重导出，只有存在真实兼容、语义
或可访问性工作时才建立 wrapper。

## 执行门禁

### 静态与构建

- 从 clean install 构建 reference plugin 和后续 `@hermit/ui`；
- 扫描 bundle，React、ReactDOM、DSH public UI/platform module 的重复运行时代码为 0；
- 私有 `@deepseek-ai/**/src/*`、内部 `.tsx`、private CSS selector、宿主 DOM 查询为 0；
- Tailwind preflight、global reset、Hermit ThemeProvider 和复制的 DSH token 数值为 0；
- `@hermit/ui` 公共导出与资格记录一致，不包含领域组件或 Desktop UI。

### 真实宿主

同一份 `.tgz` 分别在 stock DSH 与 Hermit bundled DSH 中验证：

- Client bundle 能加载，基础组件能渲染并共享 Host React identity；
- light/dark/system 下 semantic token 生效，不出现独立主题或闪烁；
- Menu、Tooltip、Modal 的 portal、z-index、Escape、focus placement/return 正常；
- 长中文、窄窗口和 200% zoom 不重叠，键盘路径可完成；
- 插件移除并重启后，UI、路由、portal 和事件监听不残留；
- 两个宿主的资格结果使用同一 schema 记录，差异必须有明确原因。

### 测试边界

自动测试锁公共导出、交互、可访问性、打包边界和生命周期。不要用测试锁颜色值、padding、
README 内容或大面积 UI snapshot。截图只作为失败诊断和人工验收证据。

## 完成条件

资格验证只有三种结果：

| 结果 | 后续动作 |
| --- | --- |
| `PASS` | 冻结首版 allowlist；只有存在真实共享缺口时才创建 `@hermit/ui` |
| `PARTIAL` | 只允许通过的能力；未通过项留在插件本地或继续上游验证，不增加通用 fallback |
| `FAIL` | 不创建共享包，修正 seam、打包或宿主假设后重新资格验证 |

首版 Component Inventory 在 B 阶段随真实组件建立，不提前建设独立站点或新 package。首个
Product Plugin 纵切通过后，才根据实际重复需求增加下一批组件。

## 本阶段明确不交付

- 不创建 `ui-patterns`、`ui-desktop`、`ui-testing` 或多仓库设计系统；
- 不一次性补齐 Select、Tabs、Table、Calendar、PDF viewer 等组件；
- 不把 Reminder、Import、Clipboard 等领域界面放入共享包；
- 不复制 DSH 主题、图标集合或内部组件源码；Hermit 允许的 source patch 属于底座构建输入，
  只补公开 Product Surface，不把内部实现复制进插件；
- 不用 Settings 资格页冒充正式 Product Surface。

## 调研依据

- [DSH Web platform modules](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/web/src/platform.ts)
- [DSH Web styling](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/web-styling.md)
- [DSH UI primitives](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-primitives/README.md)
