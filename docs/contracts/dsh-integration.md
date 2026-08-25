# DSH 集成契约

DSH 是经过资格认证的外部平台契约，并且当前仍是 developer preview。

## 资格认证和固定版本

- 使用在 clean-room 中通过资格认证的精确 DSH/npm closure 和唯一 frozen lockfile；
- 记录 upstream version/commit、artifact integrity、public export snapshot、解析后的
  React identity、license/notice、SBOM identity 和 qualification evidence；
- DSH 与其 Cordis closure 必须一起升级，不得解析 `latest`、`next`、Git HEAD 或
  混合 release candidate；
- 只有 ADR 证明可复现的上游 artifact 缺陷必须修改源码时，才创建 downstream fork。

## 公共 Seam

Hermit 只能通过 `packages/dsh-adapter` 和 `packages/ui-adapter` import DSH。

- 只消费批准的 package root 或公开 `./client` export；
- 插件之间通过 typed slot 或 service 组合；
- `@deepseek-ai/**/src/*`、implementation store、private DOM/class、private CSS 和
  router internals 均视为不支持；
- DSH package 可以在上游内部使用 private export；Hermit 的全面禁止是外部消费者
  的加严规则，不得误写为 DSH 自身事实。

## Host、Client 和生命周期

Host 与 Client 是不同 face。Client component 不接收可变 runtime context；数据和
callback 必须通过 public slot/service face 进入。

Service injection 参与 activation topology。Client manifest 中的 inject metadata
不是 apply-order 机制。registration、timer、watcher、connection 和其他外部资源
都是 Cordis effect，必须提供 disposer，并在 unload、HMR 或 required-service loss
时清理。

## UI 契约

- DSH 负责 shell、navigation、Conversation、Composer、Session/Workspace、Tool
  frame、Approval、Model、Permission 和 Settings shell；
- Hermit 使用公共 UI primitive、slot、theme 和 semantic `--dsw-*` token；
- Hermit Client UI 使用 CSS Modules + `clsx`，不使用 Tailwind 或另一套视觉组件系统；
- React/ReactDOM 是平台 singleton，并与资格认证后的 DSH resolution 一致；Plugin
  bundle 不得包含第二份 React；
- 保持 focus visibility、semantic HTML、keyboard behavior 和 reduced motion；测试
  用户可观察行为，不绑定 class/hook。

默认使用最窄的 additive/list slot。替换 single-owner surface 必须经过架构审查并
提供明确的公共 contract evidence。
