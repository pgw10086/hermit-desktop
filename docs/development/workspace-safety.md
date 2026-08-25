# 工作区安全

## 仓库范围

默认情况下，所有仓库操作必须限制在当前 Git worktree 的解析后 root 内。

不得读取、修改或执行 root 外的 repository、worktree、目录、数据集或 credential，
除非当前任务或 canonical scoped 文档明确授权该外部资源。

访问文件前必须考虑 symlink、junction、mount 或其他路径重定向；解析后的目标不得
越出已授权 root。被授权作为 migration input 的外部资源默认只读，只有 scoped rule
明确授予写权限时才能修改。

## Worktree 和 Git

保留未知 worktree state。使用范围明确的 status/diff 和增量编辑。不得使用 reset、
clean、broad restore/checkout 或其他以丢弃无关工作为目的的操作。

本地编辑和测试属于仓库内动作。Push、force-push、PR 修改、tag、release、publish、
签名、GitHub 设置/Secret、特权 workflow dispatch、真实输入迁移和 production
cutover 都需要用户对该动作的明确授权。

## 数据和 Fixture

- `synthetic` fixture 是虚构数据，不含真实用户值；
- `sanitized` fixture 必须有 provenance、字段说明和 review 记录；
- Browser profile、Cookies、Login Data、Local State、API key、certificate、真实
  clipboard/history/Session content 和真实用户文件均禁止进入。

Runtime cache 和生成 evidence 放在 `.hermit/`。资格认证 checkout 通过
`HERMIT_DSH_UPSTREAM_DIR` 指向已授权的外部只读缓存，并校验 exact commit/hash；
不得嵌套进本 Git 仓库。

## 迁移和 Cutover

Rehearsal 只读取批准的 snapshot，写入新的 staging generation，必须支持 dry-run、
可重跑并产生 reconciliation evidence。真实数据迁移和 production authority cutover
是两个分别需要明确授权的动作。
