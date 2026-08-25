# Repository Agent Instructions

Hermit vNext has two separate agent domains:

- Coding Agents inspect and change this repository.
- Runtime Agents are product AI sessions governed by Hermit Core.

Never transfer trust, permissions, tools, skills, credentials, or runtime
authority between these domains.

## Read The Owning Context First

- Before creating, moving, renaming, or assigning a directory/package, read
  `docs/repository-layout.md`.
- Before Core, Host, Client, Broker, Runner, Package Gate, Tauri, native, IPC,
  or process changes, read `docs/architecture/system-boundaries.md`.
- Before DSH, React, UI, slot, theme, primitive, CSS, or export changes, read
  `docs/contracts/dsh-integration.md`.
- Before plugin, manifest, capability, signing, audit, or isolation changes,
  read `docs/contracts/product-plugin-security.md`.
- Before Session, Tool, callId, Approval, checkpoint, retry, provider,
  credential, or runtime log changes, read `docs/contracts/runtime-agent.md`.
- Before migration, fixture, Secret, generated state, GitHub, release, or
  cutover work, read `docs/development/workspace-safety.md`.

A nearest scoped `AGENTS.md` supplements this file. Scoped rules may specialize
behavior but may not weaken root workspace, data, trust, credential, or
external-action rules.

## Workspace And Data

Work inside the current Git worktree. Treat sibling repositories, including the
legacy `D:\codes\hermit` workspace, as outside read and write scope. Use only
explicitly approved confirmation documents plus synthetic or documented
sanitized fixtures.

Keep real user data, browser state, credentials, secrets, and uncommitted
external source out of this repository and Coding Agent context.

Preserve pre-existing worktree state. Do not use `git reset`, `git clean`, or
another command whose purpose is to discard work you did not create.

Transient repository state belongs under `.hermit/{cache,tmp,artifacts}/` and
is gitignored. A pinned DSH source checkout, when required for qualification,
lives in an allowlisted read-only external cache, never as a nested repository.

## Architecture And Dependencies

Ownership comes before structure: create a top-level area, package, or plugin
only after `docs/repository-layout.md` assigns its owner, layer, and lifecycle.

Product Plugins have one Hermit hard runtime dependency: the Hermit Core public
contract. Privileged effects flow through Package Gate, Capability Broker, and
an isolated Runner. P0 Production admits only first-party or Hermit-audited
signed Product Plugins.

Pinned DSH is an external platform contract. Consume only approved package-root
or `./client` public exports and documented slots, theme, and primitives. Do not
depend on DSH `src/*`, private DOM, private class names, or private CSS. React
and ReactDOM are platform singletons and match the qualified DSH resolution.

Runtime model-visible facts are durable Session facts. Tool calls and results
pair by callId; checkpoint failure prevents dispatch; Approval fails closed;
an unknown post-checkpoint side effect is never blindly retried.

Registrations and external resources are lifecycle-owned and dispose cleanly.

## Verification And External Actions

Extend an owned public seam before creating a new dependency or authority path.
Change the owning contract/spec before widening package ownership, capability
authority, or public API.

Run the narrowest relevant automated gates and behavior tests. Security
boundaries require denial-path tests.

Editing local files does not authorize external effects. Pushes, force-pushes,
PR mutations, tags, releases, publishes, signing/promotions, GitHub settings or
secrets changes, privileged workflow dispatches, real-input migration, and
production cutover require explicit user authorization for that action.

## Coding Tool Configuration

`AGENTS.md` is the canonical Coding Agent policy. Root `CLAUDE.md` contains only
`@AGENTS.md`.

`.agents/`, `.claude/`, and `.codex/` are Coding Agent configuration locations
only. Product Runtime Agent instructions and runtime skills belong to
product-owned runtime packages/plugins and are governed by manifests and
capabilities.
