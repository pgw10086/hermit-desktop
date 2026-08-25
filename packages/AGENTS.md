# Package Rules

- Every package has an owner, layer, public face, and allowed dependency
  direction in `docs/repository-layout.md`.
- Separate public contract definitions from privileged provider
  implementations.
- Model a capability as Definition, Provider, and Consumer; use declared
  service injection rather than hidden activation ordering.
- Keep registrations, timers, watchers, connections, and other resources
  effect-owned with deterministic disposal.
- Only DSH adapter packages import approved DSH host/client contracts.
- Add a package only when it creates a real ownership boundary, not to split a
  file tree cosmetically.
