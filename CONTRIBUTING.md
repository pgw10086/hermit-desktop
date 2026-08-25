# 参与贡献

Hermit vNext 当前处于 Private incubation。

1. 先读取 `AGENTS.md` 指向的相关文档、代码和测试；
2. 新增顶层目录或模块前，先在 `docs/repository-layout.md` 定义负责人和生命周期；
3. 修改产品范围、架构或接口时，先更新对应需求或契约，再修改实现；
4. 遵守 `docs/development/engineering-rules.md`，测试数据使用虚构数据或有记录的
   脱敏数据；
5. 运行与改动直接相关的检查；安全边界必须测试拒绝路径；
6. 通过 pull request 提交变更。发布、签名、GitHub 设置、真实数据迁移和生产切换
   需要针对该动作的明确授权。

第一个实现目标是
`specs/2026-08-24-hermit-dsh-vnext/start-readiness.md` 中定义的 Core-only vertical
slice。
