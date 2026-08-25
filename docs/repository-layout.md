# 仓库布局

本文档是顶层目录所有权和生命周期的唯一事实来源。新增顶层目录前，必须先说明负责
人、用途、依赖边界、创建条件和退出方式，并在这里登记。

## 原则

1. 一个事实、模块或数据只由一个明确负责人维护。
2. 目录跟随真实代码、契约或运维需要创建，不为未来计划保留空壳。
3. 可安装插件的独立性由 package 和公共契约保证，不通过嵌套 Git 仓库保证。
4. 本地状态、缓存、下载依赖、浏览器状态和生成证据不属于项目知识。
5. package、插件和 native crate 的具体清单由真实 manifest/workspace 配置负责，本文
   不复制容易过期的目录快照。

## 顶层所有权

| 路径 | 用途和负责人 | 创建条件 | 生命周期 |
| --- | --- | --- | --- |
| `apps/` | Desktop Platform 负责最终应用装配 | 出现首个可运行应用时 | 随对应应用维护 |
| `packages/` | 各平台 owner 负责可复用公共契约和实现 | 首份契约或实现通过评审时 | 随 package 版本维护 |
| `plugins/` | 各 Product Plugin owner 负责第一方可安装插件 | 插件进入实现时 | 独立打包和版本化 |
| `native/` | Native Platform 负责 Rust/OS 特权 provider | 首个 native protocol 实现时 | 随根 Rust workspace 维护 |
| `migration/` | Migration Program 负责演练、转换和切换材料 | 迁移实现或 fixture 出现时 | 迁移支持结束后归档 |
| `docs/` | 对应领域 owner 负责长期有效的工程事实 | 当前事实需要长期维护时 | 随事实更新或删除 |
| `specs/` | Product、Architecture 和 Security 负责已确认需求与规范 | 需求或机器契约确认时 | 按变更主题冻结或演进 |
| `scripts/` | Developer Experience 和 Release 负责维护命令 | 首个可执行维护命令出现时 | 随命令维护和测试 |
| `.github/` | DevEx、Security 和 Release 负责协作与 CI 配置 | GitHub 配置出现时 | 随仓库治理维护 |
| `.agents/` | Developer Experience 负责项目开发 skill | 出现可复用开发流程时 | 随流程维护 |
| `.claude/` | Developer Experience 负责 Claude 专用适配 | 确有 Claude 专用配置时 | 随适配维护 |
| `.codex/` | Developer Experience 负责 Codex 专用适配 | 确有 Codex 专用配置时 | 随适配维护 |
| `.hermit/` | 本地运行者拥有 cache、tmp 和 artifacts | 工具运行时按需创建 | 始终忽略，不提交 |

根级 `README.md`、`AGENTS.md`、`CONTRIBUTING.md`、`SECURITY.md`、许可证、lockfile、
workspace 配置和工具链 pin 由其直接用途负责，不为它们建立第二份目录说明。

## 创建模块

新增 app、package、plugin 或 native crate 时，在同一个变更中完成：

1. 定义负责人、公共入口、允许的依赖方向和退出方式；
2. 提交真实契约、manifest 或实现，不只提交 README 和空目录；
3. 将公共边界接入对应 schema、lint、依赖检查和测试；
4. 只有该子树存在根规则无法表达的真实差异时，才添加 scoped `AGENTS.md`；
5. 更新本文件只记录长期所有权，不复制 manifest 能直接证明的版本和文件清单。

产品插件只依赖 Core 公共契约。跨插件协作经过 Core contract，不直接引用另一个
插件的内部实现、数据表或迁移。

## 文档归属

- `README.md`：项目入口、当前状态、常用命令和文档导航；
- `AGENTS.md`：所有编码任务都会用到的入口和红线；
- `docs/architecture/`：当前系统职责和依赖方向；
- `docs/contracts/`：DSH、插件安全和运行时 Agent 的独立边界；
- `docs/development/`：全仓工程与工作区规则；
- `docs/research/`：调研证据，不进入默认执行链；
- `specs/`：已确认产品需求、阶段门和机器规范；
- `docs/provenance/`：外部资料的来源与完整性记录。

从外部导入的确认文档必须在 `docs/provenance/imports.yaml` 记录来源、完整性和已做
修改；provenance 只负责追溯，不重复需求正文。

计划、任务日志和生成报告不进入上述长期文档。复杂变更的临时材料放在所属
change-specific spec；本地生成证据放在 `.hermit/artifacts/`。

## 工作区边界

仓库内部不包含嵌套 Git metadata。Symlink、junction 和等价链接解析后必须留在已
授权的工作区内。外部依赖源码使用明确授权的只读缓存，不复制进仓库。

顶层采用自动 allowlist。新增顶层 entry 时，先更新本文件，再同步门禁；未定义负责
人和生命周期的 entry 由门禁拒绝。
