---
name: dsh-desktop-core-doc-sync
description: "在 Hermit vNext 中新增或修改 DSH Desktop Core、Desktop Surface、Quick Panel、ShortcutRegistry、窗口、系统集成、IPC、native bridge、生命周期或相关 DSH 接入后，使用此 Skill 检查并同步受影响的权威文档；也用于用户要求更新、同步或检查 DSH 桌面 Core 文档时。只更新真实受影响的文档，不发明 API，不把内部实现写成公共能力。"
---

# DSH Desktop Core 文档同步

## 目标

把一次已经确认的 Desktop Core 功能变更，同步到正确的当前文档。这个 Skill 是文档维护
工作流，不是 Desktop Core 设计规范、API 生成器或代码修改工具。

文档的事实仍由仓库现有权威来源负责；本 Skill 只帮助定位、判断和同步，避免功能已经变化
而 Quickstart、Core 规范、DSH 集成契约和插件说明互相矛盾。

## 使用时机

在以下场景使用：

- 新增或修改 Desktop Core、Desktop Surface、Quick Panel、ShortcutRegistry、窗口、Tray、
  系统快捷键、系统剪贴板、IPC、preload、native bridge 或桌面生命周期；
- 修改 Electron 与 DSH 的启动、恢复、退出、Renderer 安全或运行时兼容性；
- 修改 Product Surface、Product Navigation、DSH UI seam 或插件使用桌面能力的方式；
- 完成功能开发后，用户要求同步相关文档；
- 需要判断一次代码变更影响哪些 DSH 桌面文档。

纯业务插件页面或领域规则没有改变 Desktop Core、DSH 接入契约或公共能力时，不要为了“文档
完整”运行本 Skill。

## 核心原则

- 先读当前代码、测试、确认过的 spec 和文档，再判断影响范围；
- 先读取 `docs/document-authority.yaml`，不要靠文件名猜权威文档；
- 只有公开 typed contract、接入方式和验证证据都成立时，才把能力写成插件可接入；
- 明确区分公开能力、Hermit 专属能力、第一方专属能力、内部实现和规划中的能力；
- 一次内部重构不等于所有文档都要更新；只修正变得错误或误导的文档；
- 不复制 DSH 官方文档，不把研究资料、旧 ADR 或未来计划写成当前事实；
- 本 Skill 只修改文档。发现代码、contract 或 spec 还需要改变时，列出问题，不在同步文档时
  顺手修改实现。

## 阅读顺序

按需要读取，不要求通读整个仓库：

1. 根目录 `AGENTS.md`；
2. `docs/development/engineering-rules.md`；
3. `docs/document-authority.yaml`；
4. 用户指出的功能说明、目标路径和对应的限定 diff；工作区有大量无关修改时，不把全部
   `git diff` 当成本次变更；
5. `docs/document-authority.yaml` 中与本次变更匹配的权威文档；桌面 Core 变更通常需要查看
   `docs/architecture/system-boundaries.md`、`docs/contracts/dsh-integration.md`、
   `docs/development/desktop-core-development.md` 和
   `docs/development/product-plugin-quickstart.md`；
6. 变更涉及安全、AI、打包、插件业务或特定桌面 Surface 时，再读取对应的 security、
   runtime-agent、packaging、plugin README/DESIGN 或 `specs/` 文档；
7. 需要确认 DSH 官方含义时，读取 `DEEPSEEK-HARNESS-UPSTREAM.md` 指向的当前版本资料，
   不用上游最新 master 反推 Hermit 当前能力。

## 同步流程

### 1. 先确认变更事实

从用户描述、限定 diff、类型定义和测试中确认：

- 改了什么能力或行为；
- 谁拥有这项能力；
- 插件是否能直接调用；
- stock DSH、Hermit patched DSH 和桌面包分别是否支持；
- 生命周期、失败状态、平台差异和验证证据是否变化。

实现与 spec 不一致时，不要替任一方静默改名或改状态。把“已实现事实、目标要求、未决差异”
分开记录，并在输出中提示需要处理的边界。

### 2. 判断变更类型

使用下面的分类帮助选择文档：

| 变更类型 | 主要检查对象 |
| --- | --- |
| 插件可使用的公开能力、入口或 Surface | `product-plugin-quickstart.md`、对应 typed contract |
| Core 的职责、接口设计、生命周期规则 | `desktop-core-development.md` |
| Electron/DSH、Renderer、loopback、generation 或兼容性 | `dsh-integration.md`、`system-boundaries.md` |
| 已确认的产品范围或阶段验收 | `docs/document-authority.yaml` 指向的 `specs/` |
| 信任、权限、隔离、卸载或 capability | `product-plugin-security.md` |
| Tool、Skill、Approval、Session 或凭据 | `runtime-agent.md` |
| 插件制品、Profile、双宿主或发布资格 | `dsh-plugin-development-and-packaging.md` |
| 单个插件的业务行为或接入说明 | 对应插件的 `README.md`、`DESIGN.md` 和测试 |
| 已接受且影响架构边界的决定 | 对应 `docs/adr/`，仅在确有新决定时增加或更新 |

### 3. 做最小更新

- 新增公开能力时，在 `product-plugin-quickstart.md` 的 Core 能力一览中补充用途、接入方式、
  宿主范围和当前状态；精确类型仍以源码和 `.d.ts` 为准；
- 新增 Core 设计规则时，更新 `desktop-core-development.md`，同时说明为什么需要该规则；
- 修改 DSH 或 Electron 跨边界行为时，更新对应契约，不在 Quickstart 复制一套完整架构；
- 只有内部实现变化时，不把内部类名、私有 IPC、Electron 对象或实现路径写成插件 API；
- 只有已确认的架构决定才写 ADR；代码实现本身不能自动生成产品需求或架构决定；
- 新增文档前先确认现有权威文档无法承载。默认不新建目录、模板、脚本、文档网站或 API
  生成系统；
- 对于尚未公开的桌面能力，使用清楚的“内部能力”“第一方专属”或“规划中”描述，不给出
  看起来可以调用的示例代码。

### 4. 做一致性检查

至少检查：

```sh
git diff --check
corepack pnpm verify:document-governance
```

如果本次变更同时修改了 typed contract、运行时或资格测试，再根据已确认的范围运行对应的
针对性检查；不要把没有运行过的构建、测试或平台资格写成已验证。

## 输出格式

同步完成后，用简短结果说明：

```text
文档同步结果

本次确认的变更：
- ...

已更新：
- path/to/document.md：更新了什么

未更新：
- path/to/document.md：为什么不受影响，或为什么保留现状

需要注意：
- 当前能力状态、版本差异或实现/spec 不一致

验证：
- 实际运行过的命令及结果
```

如果用户只要求分析影响范围，不要修改文件；输出候选文档和修改建议即可。如果没有文档
需要变化，也要说明判断依据，而不是为了产生 diff 强行修改文字。

## 保持简单

本 Skill 不负责：

- 自动监听 Git commit 或自动触发；
- 批量改写所有 Markdown；
- 生成 Desktop Core API、万能 `desktopAPI` 或代码模板；
- 把 Smart Clipboard 或单个 Surface 的内部实现升级成通用能力；
- 为每个 Core 功能创建一篇新文档；
- 代替 DSH 官方文档、产品 spec、架构契约或测试资格。

只有当真实的新接入者反复遇到同一问题，或第二个独立插件开始使用同一种桌面能力时，才重新
评估是否需要公共 API、额外文档或自动化工具。
