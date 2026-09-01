---
upstreamRepository: https://github.com/deepseek-ai/deepseek-harness
upstreamTag: dsh-v0.1.1-rc.2
upstreamCommit: b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
dshPackageVersion: 0.1.1-rc.2
snapshotPath: docs/provenance/deepseek-harness/snapshots/0.1.1-rc.2__b150a551
snapshotChecksum: 0b295e1ff88eb443c5fd16cb3e9b23938606706d4377a2d94f45c1bdff08af25
retrievedAt: 2026-09-01
status: active
---

# DeepSeek Harness 官方上游资料

状态：`current`

本文是 Hermit 当前采用的 DeepSeek Harness（DSH）官方开发资料快照入口。这里记录
“我们使用哪一版上游资料”，不重新编写 DSH 的插件 API，也不把 Hermit 的桌面规则冒充
成 DeepSeek 官方规则。

## 当前基线

当前 Hermit runtime 实际使用 DSH `0.1.1-rc.2`，因此 active 快照必须与这个版本属于同一
个上游版本批次：

| 信息 | 当前值 |
| --- | --- |
| 官方仓库 | `deepseek-ai/deepseek-harness` |
| 官方 tag | `dsh-v0.1.1-rc.2` |
| Git commit | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` |
| DSH package | `0.1.1-rc.2` |
| 快照目录 | [`0.1.1-rc.2__b150a551`](docs/provenance/deepseek-harness/snapshots/0.1.1-rc.2__b150a551/) |
| 快照清单摘要 | `0b295e1ff88eb443c5fd16cb3e9b23938606706d4377a2d94f45c1bdff08af25` |
| 下载日期 | `2026-09-01` |
| 快照状态 | `active`，已与当前 DSH runtime 对齐 |

Git commit 是最终版本身份。tag 方便人阅读，package 版本说明实际运行时包版本，下载时间
只用于追溯，不能单独作为版本号。

## 快照内容

快照原样保存同一个上游 commit 下的：

- 官方 `docs/` 目录下的资料，包括 `docs/user/develop/`、Cordis tutorial、Cookbook、Cordis
  API 和 subsystem reference；上游 `AGENTS.md` 指令文件不随快照导入；
- `apps/cli/reference/` 与 CLI 入口说明；
- DSH package 的 README、中文说明和 i18n 元数据；
- 上游根 README、`package.json`、`LICENSE` 和 `THIRD_PARTY_NOTICES.md`；
- `CHECKSUMS.sha256`，用于检查快照文件是否被改写。

其中 `docs/user/develop/` 是插件开发的主要入口，但不是唯一参考。Bundle/Profile、CLI、
Client Modules 和实际依赖包的契约也必须以同一快照为准。

## 使用边界

1. 快照内的官方文件只读保存，不在原文中加入 Hermit 注释、改写示例或修正内容。
2. 快照是“该 commit 的官方资料基线”，不是跨版本永久不变的 DSH 标准。DSH 仍处于
   Developer Preview，升级可能包含不兼容变化。
3. 普通 Cordis 插件、`dsh.bundle`、`dsh.client`、Profile 和 Hermit Desktop Integration
   是不同角色，不能用一份超级清单强行合并。
4. Hermit 的插件开发、桌面集成、制品打包、权限和资格验收规则，分别由本仓库自己的
   [插件开发规范](plugins/development-guidelines.md)和
   [DSH 集成与打包标准](docs/development/dsh-plugin-development-and-packaging.md)负责。
5. 上游 `AGENTS.md`、源码内部说明和未声明的 private module 只用于升级调查，不能当成
   Hermit Product Plugin 可以依赖的公开契约。

## 更新流程

发现 DSH 新版本时，不覆盖当前目录：

1. 选定一个具体的上游 Git commit，并确认 tag 与 package 版本；
2. 把官方资料下载到新的 snapshot 目录，保留原文、许可证和校验清单；
3. 生成旧快照到新快照的文档和契约差异，检查 Cordis、Tool、Client、Bundle/Profile 和
   CLI 行为；
4. 用新版本 DSH runtime、同一插件制品和 Hermit bundled DSH 重新跑资格验收；
5. 验收通过后，才把本文的 active 元数据与 runtime manifest 一起切换；
6. 验收失败时继续使用旧快照，回滚时同时回滚 runtime 和本文指针。

不追踪未冻结的 `master`，也不执行无人审核的“自动更新官方规范”。自动化只负责下载、
校验、生成差异和报告。

## 来源与完整性

- [上游官方仓库](https://github.com/deepseek-ai/deepseek-harness)
- [当前 commit](https://github.com/deepseek-ai/deepseek-harness/commit/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e)
- [固定版本的官方开发文档目录](https://github.com/deepseek-ai/deepseek-harness/tree/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/user/develop)
- [插件开发入口](docs/provenance/deepseek-harness/snapshots/0.1.1-rc.2__b150a551/docs/user/develop/basic/index.zh.md)
- [发布与 Profile 说明](docs/provenance/deepseek-harness/snapshots/0.1.1-rc.2__b150a551/docs/user/develop/basic/publish.zh.md)
- [快照文件校验清单](docs/provenance/deepseek-harness/snapshots/0.1.1-rc.2__b150a551/CHECKSUMS.sha256)

候选上游版本 `0.1.2-alpha.3` 已单独保存为
[`0.1.2-alpha.3__dd6322d`](docs/provenance/deepseek-harness/snapshots/0.1.2-alpha.3__dd6322d/)，
但它尚未通过 Hermit 当前 runtime 的升级资格，因此不能作为 active 规范。
