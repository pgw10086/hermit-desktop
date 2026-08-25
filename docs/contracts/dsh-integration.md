# DSH Integration Contract

DSH is a qualified external platform contract and remains a developer preview.

## Qualification And Pinning

- Use an exact, clean-room-qualified DSH/npm closure and one frozen lockfile.
- Record upstream version/commit, artifact integrity, public export snapshot,
  resolved React identity, license/notices, SBOM identities, and qualification
  evidence.
- Upgrade DSH and its Cordis closure together. Do not resolve `latest`, `next`,
  Git HEAD, or mixed release candidates.
- Create a downstream fork only after an ADR proves a reproducible upstream
  artifact defect requires a source patch.

## Public Seams

Hermit imports DSH only through `packages/dsh-adapter` and
`packages/ui-adapter`.

- Consume approved package-root or documented `./client` exports.
- Compose across plugins through typed slots or services.
- Treat `@deepseek-ai/**/src/*`, implementation stores, private DOM/classes,
  private CSS, and router internals as unsupported.
- DSH packages may use private exports internally; Hermit's stricter rule is an
  external-consumer policy.

## Host, Client, And Lifecycle

Host and Client are separate faces. Client components do not receive a mutable
runtime context; data and callbacks arrive through public slot/service faces.

Service injection participates in activation topology. Client manifest inject
metadata is not an apply-order mechanism. Registrations, timers, watchers,
connections, and other external resources are Cordis effects with disposers and
clean up on unload, HMR, or required-service loss.

## UI Contract

- DSH owns shell, navigation, Conversation, Composer, Session/Workspace, Tool
  frames, Approval, Models, Permission, and Settings shell.
- Hermit uses public UI primitives, slots, theme, and semantic `--dsw-*` tokens.
- Hermit client UI uses CSS Modules plus `clsx`, not Tailwind or another visual
  component system.
- React and ReactDOM are platform singletons and match the qualified DSH
  resolution. Plugin bundles do not contain another React copy.
- Preserve focus visibility, semantic HTML, keyboard behavior, and reduced
  motion. Tests assert user-observable behavior rather than classes/hooks.

Default to the narrowest additive/list slot. Replacing a single-owner surface
requires an architecture review and explicit contract evidence.
