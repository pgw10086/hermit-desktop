# Repository Layout

This document is the source of truth for top-level ownership and lifecycle in
Hermit vNext. Define a new top-level directory here before creating it.

## Principles

1. One fact has one authoritative owner.
2. Source ownership and installable package boundaries are explicit.
3. Runtime state, generated evidence, caches, and upstream checkouts are not
   project knowledge.
4. Product Plugin independence is enforced through contracts, not repository
   nesting.
5. Directories exist only when they contain owned files with a real lifecycle.

## Top-Level Layout

```text
hermit-vnext/
|-- README.md
|-- README.zh-CN.md
|-- AGENTS.md
|-- CLAUDE.md
|-- apps/                    # Product assemblies
|-- packages/                # Versioned shared platform packages
|-- plugins/                 # First-party installable Product Plugins
|-- native/                  # Rust/native privileged providers
|-- migration/               # Legacy rehearsal and cutover program
|-- docs/                    # Durable architecture and development facts
|-- specs/                   # Normative requirements and machine contracts
|-- scripts/                 # Maintained developer/release commands
|-- .github/                 # GitHub collaboration and CI configuration
|-- .agents/                 # Coding Agent skills, when required
|-- .claude/                 # Claude-only Coding Agent adapters
|-- .codex/                  # Codex-only Coding Agent adapters
|-- .hermit/                 # Ignored local cache/tmp/artifacts
|-- package.json             # Root pnpm command surface, when bootstrapped
|-- pnpm-workspace.yaml
|-- pnpm-lock.yaml
|-- Cargo.toml               # vNext Rust workspace
|-- Cargo.lock
`-- rust-toolchain.toml
```

The repository does not contain Go source, `go.mod`, nested Git repositories,
or the legacy product runtime.

## Ownership Map

| Path | Owner | Layer | Lifecycle |
| --- | --- | --- | --- |
| `apps/desktop-vnext/` | Desktop Platform | Final Tauri/DSH assembly | Ships with each Core release |
| `packages/core/` | Runtime Platform | Core-only DSH composition | Versioned with Core |
| `packages/plugin-api/` | Architecture + Platform | Public Product Plugin contract | SemVer public API |
| `packages/plugin-sdk/` | Ecosystem + Platform | Plugin build helpers | Follows compatible API majors |
| `packages/plugin-testkit/` | Quality + Ecosystem | Conformance and clean-boot tests | Follows compatible API majors |
| `packages/dsh-adapter/` | DSH Integration | Only approved DSH import boundary | Changes with qualified DSH generation |
| `packages/ui-adapter/` | UI Platform | Public DSH UI/token/slot wrappers | Changes with qualified DSH generation |
| `packages/capability-broker/` | Security Platform | Capability decisions and narrow handles | Core security release |
| `packages/data-registry/` | Data Platform | Canonical namespace/schema ownership | Core data release |
| `plugins/organizer/` | Organizer Product | Installable first-party plugin | Independent artifact/version |
| `plugins/file-workspace/` | File Workspace Product | Installable first-party plugin | Independent artifact/version |
| `plugins/smart-clipboard/` | Clipboard Product | Installable first-party plugin | Independent artifact/version |
| `native/` | Native Platform | Privileged Rust/OS providers | Root Cargo workspace |
| `migration/` | Migration Program | Snapshot-only rehearsal/cutover | Retained through migration support window |
| `docs/` | Named domain owner | Durable human-readable facts | Maintained with implementation truth |
| `specs/` | Architecture + Product + Security | Normative requirements and schemas | Versioned before dependent code |
| `scripts/` | Developer Experience + Release | Deterministic commands | Maintained and tested |
| `.github/` | DevEx + Security + Release | CI and repository governance | Protected review paths |

## Assemblies And Packages

`apps/desktop-vnext` is the only mixed desktop assembly. It may compose public
packages and first-party plugin artifacts, but feature logic stays with its
owner.

`packages/` contains contracts and platform implementations with explicit
dependency direction. A package must have an owner before creation. Public
contracts and privileged provider implementations remain separate.

`plugins/` contains first-party Product Plugin source. An installable plugin is
a package boundary, not a nested Git repository. Each plugin builds and tests
against Core alone; cross-plugin cooperation goes through Core contracts.

`native/` contains the root Rust workspace members for runtime supervision,
Tier 0 rescue, OS credentials, clipboard, parser isolation, and desktop
integration. Platform-specific code stays inside its owning crate.

## Runtime Profiles And Upstream Source

Do not create a source `profiles/` directory. DSH profiles are materialized
runtime state under an ephemeral or user `DSH_HOME`; source owns only bundle
and materialization logic.

Do not create `vendor/`, `third_party/`, or a DSH submodule by default. The
qualified DSH dependency is an exact npm closure plus provenance. A downstream
source checkout exists only after an approved fork/patch ADR and lives in a
separate repository or read-only external cache.

## Documentation And Specs

`docs/` explains current architecture, contracts, decisions, safety, and
development workflows. It does not store task logs or generated reports.

`specs/` owns confirmed product requirements and machine-readable invariants.
Code may not reinterpret a normative schema in a local README. Change the
owning spec and dependent code together.

Imported confirmation documents record provenance under
`docs/provenance/imports.yaml`. Legacy application source, real data, and
uncommitted external files are not imported.

## Generated And Local State

Local state belongs under:

```text
.hermit/
|-- cache/
|-- tmp/
`-- artifacts/
```

Package output stays in owner-declared `dist/`, `lib/`, or Rust `target/`
directories and is ignored unless a spec explicitly declares generated source
as authoritative.

Synthetic fixtures stay with their owner. Sanitized fixtures require a
provenance record and field-level description. Browser profiles, cookies,
credentials, real Session content, and real user files never enter fixtures.

## Scoped Agent Policy

Create scoped `AGENTS.md` only where behavior differs materially from the root:

- `apps/desktop-vnext/`
- `packages/`
- `plugins/`
- `native/`
- `migration/`
- `specs/`
- `.github/`

Do not add deeper scoped files unless the subtree has a real additional rule.
Scoped files supplement root safety rules and do not duplicate them.

## Changing The Layout

1. Identify the owner, layer, dependency direction, and lifecycle.
2. Update this document first.
3. Add or update a scoped `AGENTS.md` only when execution behavior changes.
4. Create files and directories in the same reviewed change.
5. Update ownership/invariant checks and maintained links.
6. Verify no nested repository, out-of-root link, Secret, or generated state was
   introduced.

Until automated layout gates exist, reviewers verify this checklist manually.
