# Workspace Safety

## Repository Scope

Resolve the current Git root before writing. Work only in this repository.
Sibling repositories, especially the legacy `D:\codes\hermit` workspace, are
outside read and write scope unless the user explicitly authorizes a specific
confirmation document.

Do not inspect, diff, copy, build, execute, or mine uncommitted legacy source.
Migration knowledge enters through reviewed docs, synthetic fixtures, or a
documented sanitizer/provenance process.

## Worktree And Git

Preserve unknown worktree state. Use scoped status/diff and normal additive
edits. Do not use reset, clean, broad restore/checkout, or another operation
whose purpose is to discard unrelated work.

Local editing and tests are repository-scoped. Push, force-push, PR mutation,
tag, release, publish, signing, GitHub settings/secrets, privileged workflow
dispatch, real-input migration, and production cutover require explicit user
authorization for that action.

## Data And Fixtures

- `synthetic` fixtures are fabricated and contain no real user values.
- `sanitized` fixtures have provenance, field descriptions, and a review record.
- Browser profiles, Cookies, Login Data, Local State, API keys, certificates,
  real clipboard/history/Session content, and real user files are forbidden.

Runtime caches and generated evidence live under `.hermit/`. A qualification
checkout may live in an external read-only cache such as
`D:\codes\.hermit-vnext-cache\deepseek-harness\<commit>` and is never nested
inside this Git repository.

## Migration And Cutover

Rehearsal reads only approved snapshots and writes a new staging generation.
It is dry-run capable, repeatable, and emits reconciliation evidence. Real data
migration and production authority cutover are separate explicitly authorized
operations.
