# Contributing

Hermit vNext is currently in private incubation.

1. Read `AGENTS.md` and the owning context for the area you change.
2. Preserve package ownership and dependency direction from
   `docs/repository-layout.md`.
3. Change a public contract/spec before dependent implementations.
4. Use synthetic or documented sanitized fixtures only.
5. Run the narrowest relevant checks and include denial-path tests for security
   boundaries.
6. Submit changes through a pull request. External publish, release, signing,
   GitHub settings, migration, and cutover operations need separate approval.

The first implementation milestone is the Core-only vertical slice described
in `specs/2026-08-24-hermit-dsh-vnext/start-readiness.md`.
