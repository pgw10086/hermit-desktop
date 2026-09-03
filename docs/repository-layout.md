# 仓库布局

本文档是顶层目录所有权和生命周期的唯一事实来源。新增顶层目录前，必须先说明负责
人、用途、依赖边界、创建条件和退出方式，并在这里登记。

## 原则

1. 一个事实、模块或数据只由一个明确负责人维护。
2. 目录跟随真实代码、契约或运维需要创建，不为未来计划保留空壳。
3. 可安装插件的运行时独立性由 package 和公共契约保证；物理拆仓使用同级 sibling Git
   仓库，不在仓库内部嵌套 Git。
4. 本地状态、缓存、下载依赖、浏览器状态和生成证据不属于项目知识。
5. package、插件和原生辅助模块的具体清单由真实 manifest/workspace 配置负责，本文
   不复制容易过期的目录快照。

## 多产品拆仓状态

本仓库是拆分后的 `hermit-desktop` 产品仓库，保留 Hermit 的完整构建、测试和发布流程。
共享 Desktop Core、新产品和后续插件仓库与本仓库位于同一个普通父文件夹中；父文件夹本身
不是 Git 仓库，也不是一个超级 pnpm workspace。

拆仓后的每个仓库拥有自己的 Git、lockfile、依赖版本、构建和发布边界。代码目录可以相邻，
正式依赖必须通过已发布的 package 或固定 tarball 连接；不能跨仓库引用兄弟仓库的 `src/*`。

## 顶层所有权

| 路径 | 用途和负责人 | 创建条件 | 生命周期 |
| --- | --- | --- | --- |
| `apps/` | Desktop Platform 负责最终应用装配 | 出现首个可运行应用时 | 随对应应用维护 |
| `packages/` | 各平台 owner 负责可复用公共契约和实现 | 首份契约或实现通过评审时 | 随 package 版本维护 |
| `plugins/` | 各 Product Plugin owner 负责当前设计和第一方可安装插件 | 插件范围确认并进入设计孵化时 | 设计随确认更新；实现独立打包和版本化 |
| `native/` | Native Platform 负责确有需要的平台辅助程序或 addon | 首个原生实现出现时 | 随对应 manifest 维护 |
| `migration/` | Migration Program 负责演练、转换和切换材料 | 迁移实现或 fixture 出现时 | 迁移支持结束后归档 |
| `docs/` | 对应领域 owner 负责长期有效的工程事实 | 当前事实需要长期维护时 | 随事实更新或删除 |
| `specs/` | Product、Architecture 和 Security 负责已确认需求与规范 | 需求或机器契约确认时 | 按变更主题冻结或演进 |
| `scripts/` | Developer Experience 和 Release 负责维护命令 | 首个可执行维护命令出现时 | 随命令维护和测试 |
| `vendor/` | Hermit Release 负责拆仓迁移期的固定 package tarball 和摘要 | registry 尚未建立但产品必须从真实制品集成时 | 正式 registry 依赖稳定后删除 |
| `.github/` | DevEx、Security 和 Release 负责协作与 CI 配置 | GitHub 配置出现时 | 随仓库治理维护 |
| `.agents/` | Developer Experience 负责项目开发 skill | 出现可复用开发流程时 | 随流程维护 |
| `.claude/` | Developer Experience 负责 Claude 专用适配 | 确有 Claude 专用配置时 | 随适配维护 |
| `.codex/` | Developer Experience 负责 Codex 专用适配 | 确有 Codex 专用配置时 | 随适配维护 |
| `.hermit/` | 本地运行者拥有 cache、tmp 和 artifacts | 工具运行时按需创建 | 始终忽略，不提交 |

`apps/desktop-vnext/` 是 Hermit 产品 Desktop，不是两个产品共用的产品壳。共享 Desktop
Core 已经迁到 sibling 仓库，本仓库只通过固定 package 制品消费它。

## 拆仓后的 sibling 责任

| 仓库 | 负责什么 | 明确不负责什么 |
| --- | --- | --- |
| `desktop-core/` | Electron 窗口、Tray、Surface、快捷键、通知、系统能力、受控 IPC、安全、生命周期和 DSH 进程监督 | DSH Web/Layout、Conversation/Session/Settings/Approval UI、业务插件清单和业务数据 |
| `hermit-desktop/` | Hermit 产品壳、Hermit layout/source patch、Hermit DSH generation/profile、插件组合、Hermit 打包和发布 | 新产品 UI、另一产品的 profile、共享 UI 壳 |
| `new-product-desktop/` | 新产品壳、自己的 Conversation/Session/Settings/Approval/导航组合、自己的 layout/source patch、DSH generation/profile、插件组合和打包 | Hermit layout、另一个产品的业务数据和内部代码 |
| `plugin-*/` | 一个业务的 Canonical 数据、规则、Host、Client、Tool、迁移和自己的桌面适配（如有） | 宿主全局导航、DSH 私有实现、另一个插件的数据库和 Electron 私有 API |
| `integration/`（可选） | 跨仓库版本清单、固定制品、集成 E2E 和发布编排 | 产品业务代码、运行时私有状态和临时源码引用 |

DSH upstream 源码和版本来源仍由 DeepSeek Harness 上游负责。每个 Product Desktop 自己
锁定 DSH package、上游 commit、runtime manifest 和 layout 制品；可以使用同一个上游版本，
但不能在一套 runtime 中混用两份 layout。

根目录的 `DEEPSEEK-HARNESS-UPSTREAM.md` 由 Architecture/Developer Experience 共同负责，
只登记当前采用的 DSH 官方资料快照、上游 commit、版本批次、完整性摘要和更新流程。它是
外部 DSH 资料的版本入口，不承载 Hermit 产品规则；快照正文放在
`docs/provenance/deepseek-harness/`，随对应上游 commit 永久保留。

根级 `README.md`、`AGENTS.md`、`CONTRIBUTING.md`、`SECURITY.md`、许可证、`NOTICE`、
`THIRD_PARTY_NOTICES.md`、lockfile、workspace 配置和工具链 pin 由其直接用途负责，
不为它们建立第二份目录说明。

## 创建模块

新增 app、package、plugin 或原生辅助模块时，在同一个变更中完成：

1. 定义负责人、公共入口、允许的依赖方向和退出方式；
2. 提交真实契约、manifest 或实现，不只提交 README 和空目录；
3. 将公共边界接入对应 schema、lint、依赖检查和测试；
4. 只有该子树存在根规则无法表达的真实差异时，才添加 scoped `AGENTS.md`；
5. 更新本文件只记录长期所有权，不复制 manifest 能直接证明的版本和文件清单。

产品插件默认只依赖 Core 和 DSH/Hermit 公共契约，不依赖另一个业务插件的实现、数据表、
迁移或运行顺序。跨插件协作经过 Core contract。

已确认进入设计孵化的 Product Plugin 可以先创建一个持续更新的 `DESIGN.md`，用于保存
该插件当前功能、信息架构、交互和待确认问题；这不代表插件已经实现。代码开发开始时，
再在同一插件目录提交真实 manifest、公共契约、实现和测试，不能用设计文档冒充制品。

## 文档归属

- `README.md`：项目入口、当前状态、常用命令和文档导航；
- `AGENTS.md`：所有编码任务都会用到的入口和红线；
- `docs/architecture/`：当前系统职责和依赖方向；
- `docs/contracts/`：DSH、插件安全和运行时 Agent 的独立边界；
- `docs/development/`：全仓工程、工作区和发布规则；
- `docs/research/`：调研证据，不进入默认执行链；
- `specs/`：已确认产品需求、阶段门和机器规范；
- `plugins/`：所有插件共用的开发/UI 规范，以及每个插件持续更新的当前设计；
- `docs/provenance/`：外部资料的来源与完整性记录。
- `docs/document-authority.yaml`：主题到权威文档的机器可读索引；不复制架构或需求正文。

`docs/provenance/deepseek-harness/snapshots/` 是外部 DSH 原文的只读版本快照，唯一当前版本
入口是根目录 `DEEPSEEK-HARNESS-UPSTREAM.md`；快照不承载 Hermit 产品需求或集成规则。

从外部导入的确认文档必须在 `docs/provenance/imports.yaml` 记录来源、完整性和已做
修改；provenance 只负责追溯，不重复需求正文。

计划、任务日志和生成报告不进入上述长期文档。复杂变更的临时材料放在所属
change-specific spec；本地生成证据放在 `.hermit/artifacts/`。

## 工作区边界

仓库内部不包含嵌套 Git metadata。多个 sibling 仓库可以位于同一个父文件夹，但父文件夹
不参与源码依赖解析。Symlink、junction 和等价链接解析后必须留在已授权的工作区内。外部
依赖源码使用明确授权的只读缓存，不复制进仓库。

本地联调可以明确生成 sibling package 的 tarball 或使用受控 dev override；CI、发布和最终
集成验收必须恢复为版本化 package 或固定 tarball，不得依赖 `../other-repo/src`、`workspace:*`
或隐式 hoist。

顶层采用自动 allowlist。新增顶层 entry 时，先更新本文件，再同步门禁；未定义负责
人和生命周期的 entry 由门禁拒绝。
