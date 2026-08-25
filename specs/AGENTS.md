# 规范规则

- `specs/` 是机器消费的 normative invariant；identifier、version、ownership、
  compatibility 和 error 语义必须明确；
- normative schema 与所有依赖 contract/test 必须在同一变更中原子更新；
- 代码不得用局部解释削弱 spec；例外必须结构化、经过 review 且可审计；
- 产品需求与生成的验证 evidence 必须分开保存。
