# 迁移规则

- 默认输入只能是 synthetic data 或有记录的 sanitized data；外部 source 和真实用户
  数据只有在当前 migration task 明确授权时才能使用；
- rehearsal 必须支持 dry-run、可重跑，并只写新的 staging generation 和 reconciliation
  evidence；
- adapter 必须绑定固定 legacy source identity 和明确字段映射；
- 不得移动或覆盖源数据；必须 copy、hash、validate 后再提交 staging；
- 真实输入迁移和 production cutover 是两个分别需要用户明确授权的动作；
- authority epoch/lease、backup receipt、validation 和 crash point evidence 必须先于
  一次性 authority commit。
