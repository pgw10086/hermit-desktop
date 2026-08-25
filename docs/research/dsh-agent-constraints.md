# DSH Agent Constraints Research

Date: 2026-08-25

Scope: official DeepSeek Harness repository and official Coding Agent docs.
Hermit-specific rules are identified as stricter integration policy rather than
misattributed to DSH.

## Coding Agent Findings

- DSH uses a repo-wide root `AGENTS.md`; nested files supplement broader rules
  with subtree-specific behavior rather than copying the root. Confirmed
  examples include
  [root](https://github.com/deepseek-ai/deepseek-harness/blob/master/AGENTS.md),
  [docs](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/AGENTS.md),
  [packages](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/AGENTS.md),
  and [packages/client](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md).
- DSH client packages expose browser cooperation through `./client`, typed
  slots, and services. Implementation components/stores stay internal. DSH may
  expose/use `src/*` internally; Hermit's complete prohibition is a stricter
  external-consumer rule.
- Service definition, provider, and consumer form one capability seam. Service
  injection affects activation topology. Registrations and timers/watchers/
  connections are effects with disposers.
- DSH UI uses a singleton React platform, public primitives/theme/slots,
  semantic `--dsw-*` tokens, CSS Modules, and `clsx`. Its Coding Agent rules
  reject adding Tailwind/component-library styling and require visible keyboard
  focus and reduced-motion behavior.

Codex resolves instruction files from repository root toward the working
directory, with more local instructions applied later. See
[OpenAI AGENTS.md guidance](https://developers.openai.com/codex/guides/agents-md/).

Claude Code consumes `CLAUDE.md`; the portable Windows-compatible bridge is a
one-line `@AGENTS.md` import rather than a symlink. See
[Claude Code memory](https://docs.anthropic.com/en/docs/claude-code/memory).

## Runtime Agent Findings

- DSH Session is the append-only source of model-visible interaction history.
  Tool calls/results have same-step pairing and monotonic event order. See the
  [session package](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/core/session).
- Checkpoint failure prevents model/tool dispatch. A durable call without a
  durable result after crash becomes an unknown outcome; side-effecting work is
  not blindly retried.
- Approval is one-shot and fail-closed: missing, error, cancellation, timeout,
  malformed, and unavailable paths deny.
- DSH filesystem sandbox vocabulary does not prove network/process/credential
  isolation. Ordinary in-process Cordis plugins and dynamic runtime composition
  are not strong security boundaries.
- Credentials are references resolved by a provider per operation, rather than
  plaintext copied into consumers.

## Hermit Conclusions

1. Keep the root Coding Agent policy short and use strong context pointers.
2. Add scoped AGENTS only where assembly, package, plugin, native, migration,
   spec, or workflow behavior differs.
3. Keep Coding Agent configuration separate from Product Runtime Agent skills.
4. Treat DSH as a qualified public contract, not a source tree to import freely.
5. Add Package Gate, Capability Broker, and isolated Runner for Product Plugin
   security; Cordis composition alone is insufficient.
6. Turn the boundaries into static and runtime gates, including public-import,
   React-singleton, capability denial, checkpoint, Approval, and fixture-safety
   tests.

The complete adopted rules live in `AGENTS.md` and `docs/contracts/`.
