# 文档事实与归属规范

本文档约束“什么事实应该写在哪里”。语言形式见
`docs/development/documentation-language.md`。

## 当前事实优先

活跃文档用正向事实说明 Hermit vNext 现在是什么、由谁拥有、如何运行和验证。

README、仓库布局、系统边界和通用开发规则不得通过旧项目名称、旧技术栈或“当前
不再包含什么”来定义 vNext。环境和机器门禁已经能直接证明的简单事实，不在多个
文档中重复缓存。

## 三类事实

| 类型 | Canonical owner | 内容 |
| --- | --- | --- |
| 当前事实 | `README.md`、`docs/repository-layout.md`、`docs/architecture/`、`docs/development/` | 当前职责、authority、layer、接口和安全边界 |
| 迁移事实 | `migration/`、change-specific `specs/` | 输入、mapping、cutover、writer fence、compatibility 和 rollback |
| Provenance | `docs/provenance/` | Source identity、commit/digest、采集方式和必要格式信息 |

迁移规则不得扩散成永久项目身份。Provenance 保存可复现来源，不承担产品定位或
架构说明。

## 历史信息准入

历史项目名称、实现语言和旧运行方式只有满足以下任一条件时才可写入：

- 是 migration input 的必要 identity；
- 影响 compatibility、schema 解析或 migration tooling；
- 定义 authority transfer、cutover 或 rollback correctness；
- 是 source provenance 和可复现性所需信息；
- 当前任务明确授权访问某个外部资源，且该 identity 是安全边界的一部分。

否则删除历史表述，或改为不依赖具体历史名称仍然成立的当前通用规则。

## 正向规则

优先写 owner、allowlist、dependency direction、authority set 和 lifecycle。例如：

- 写“所有顶层 entry 必须由布局 allowlist 声明”，不逐项列举过去使用过但现在禁止
  的语言或工具；
- 写“所有操作限制在当前 Git root”，不硬编码个人机器的兄弟仓路径；
- 写“runtime state 只能来自正式 authority interface”，不通过旧 runtime 对比说明；
- 写“migration input 默认只读”，并把具体 source identity 留给 migration/provenance。

## Review 问题

新增历史或否定表述时，reviewer 必须回答：

1. 这句话是否描述今天仍可执行的系统事实？
2. 删除旧项目名称后，规则是否仍然成立？
3. 如果它解释的是“如何来到这里”，是否应移入 migration/spec/provenance？
4. 该事实是否已经能由目录、manifest、lockfile 或 verifier 直接查到？

无法说明 owner 和持续价值的表述应删除。

## 自动门禁边界

自动门禁验证当前结构：顶层 allowlist、owner、dependency、nested Git、root escape、
Secret 和 canonical pointer。它不维护“历史技术黑名单”。

历史 identity 如需自动审查，应来自 migration/provenance metadata；在 current 文档中
新增时触发 review，而不是在 verifier 源码里写死旧项目名称。
