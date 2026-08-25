# DSH Agent 限制调研

日期：2026-08-25

范围：DeepSeek Harness 官方仓库和官方 Coding Agent 文档。Hermit 自己加严的规则
会明确标注为集成政策，不归因给 DSH。

## 编码 Agent 结论

- DSH 使用 repo-wide 根 `AGENTS.md`，nested 文件只补充 subtree 差异，不复制根
  规则。已确认示例包括
  [root](https://github.com/deepseek-ai/deepseek-harness/blob/master/AGENTS.md)、
  [docs](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/AGENTS.md)、
  [packages](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/AGENTS.md)
  和 [packages/client](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)；
- DSH Client package 通过 `./client`、typed slot 和 service 进行浏览器协作；
  implementation component/store 保持内部。DSH 上游可以内部使用 `src/*`，Hermit
  的全面禁止属于更严格的外部消费者政策；
- Service Definition、Provider 和 Consumer 组成同一 capability seam。Service
  injection 影响 activation topology；registration 和 timer/watcher/connection 都是
  effect，必须提供 disposer；
- DSH UI 使用 singleton React、公共 primitive/theme/slot、semantic `--dsw-*`
  token、CSS Modules 和 `clsx`。其规则不允许增加 Tailwind/另一套 component library，
  并要求 keyboard focus 和 reduced-motion 行为。

Codex 从 repository root 向当前目录加载指令，更具体的 scoped 规则后加载。参考
[OpenAI AGENTS.md 指南](https://developers.openai.com/codex/guides/agents-md/)。

Claude Code 使用 `CLAUDE.md`；Windows 下可移植的桥接方式是一行 `@AGENTS.md`
import，而不是 symlink。参考
[Claude Code memory](https://docs.anthropic.com/en/docs/claude-code/memory)。

## 运行时 Agent 结论

- DSH Session 是 append-only 的模型可见交互历史来源；Tool call/result 同 step 配对，
  event order 单调。参考
  [Session package](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/core/session)；
- Checkpoint 失败时不会 dispatch model/tool。Crash 后 durable call 缺少 durable result
  表示 outcome unknown；可能产生副作用的调用不得盲目重试；
- Approval 是一次性、fail-closed：missing、error、cancel、timeout、malformed 和
  unavailable 全部 deny；
- DSH filesystem sandbox vocabulary 不能证明 network/process/credential 已隔离；
  普通进程内 Cordis plugin 和动态 runtime composition 不是强安全边界；
- Credential 使用 reference，由 provider 按 operation 解析，不把 plaintext 复制给
  consumer。

## Hermit 结论

1. 根 Coding Agent policy 保持短小，并使用明确 context pointer；
2. 只在 assembly、package、plugin、native、migration、spec、workflow 行为确实不同时
   增加 scoped AGENTS；
3. 编码 Agent 配置与产品 Runtime Agent skill 必须分离；
4. DSH 是经过资格认证的公共 contract，不是可随意 import 的源码树；
5. Product Plugin 安全必须增加 Package Gate、Capability Broker 和隔离 Runner；
6. Public import、React singleton、capability denial、checkpoint、Approval 和 fixture
   safety 必须成为自动门禁。

正式采用的规则以 `AGENTS.md` 和 `docs/contracts/` 为准。
