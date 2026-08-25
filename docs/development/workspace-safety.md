# 工作区安全

## 仓库范围

写文件前必须解析当前 Git root，并且只在本仓库工作。兄弟仓库，特别是旧仓
`D:\codes\hermit`，默认不属于读写范围；只有用户明确批准的具体确认文档例外。

不得检查、diff、copy、build、execute 或挖掘 legacy 未提交源码。迁移知识只能通过
reviewed doc、synthetic fixture 或有记录的 sanitizer/provenance 流程进入。

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

Runtime cache 和生成 evidence 放在 `.hermit/`。资格认证 checkout 可以位于
`D:\codes\.hermit-vnext-cache\deepseek-harness\<commit>` 等外部只读缓存，但不得
嵌套进本 Git 仓库。

## 迁移和 Cutover

Rehearsal 只读取批准的 snapshot，写入新的 staging generation，必须支持 dry-run、
可重跑并产生 reconciliation evidence。真实数据迁移和 production authority cutover
是两个分别需要明确授权的动作。
