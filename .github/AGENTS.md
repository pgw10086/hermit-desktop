# GitHub 自动化规则

- workflow 使用最小权限，第三方 Action 固定到完整 commit SHA；
- CI 可以验证不可信变更；publish、sign、promote、deploy、migrate 和 cutover 只能在
  受保护 workflow 中并经过明确授权；
- Secret 不得进入 output、artifact、fixture、cache 或 pull-request 执行路径；
- `pull_request_target`、release environment、OIDC publishing、artifact attestation
  和 repository setting 都属于安全敏感 contract；
- 编写 workflow 不代表已获得执行特权副作用的授权。
