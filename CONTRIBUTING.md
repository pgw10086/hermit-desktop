# 参与贡献

Hermit vNext 当前处于 Private incubation。

1. 先读取 `AGENTS.md` 和本次修改所属区域的 canonical context；
2. 遵守 `docs/repository-layout.md` 中的 package owner 和 dependency direction；
3. 修改 public contract/spec 后，再修改依赖实现；
4. 只使用 synthetic fixture 或有记录的 sanitized fixture；
5. 运行最小且相关的检查；安全边界必须包含 denial-path test；
6. 通过 pull request 提交变更。Publish、release、sign、GitHub setting、migration
   和 cutover 需要单独授权。

第一个实现目标是
`specs/2026-08-24-hermit-dsh-vnext/start-readiness.md` 中定义的 Core-only vertical
slice。
