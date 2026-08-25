# System Boundaries

Hermit vNext is a new runtime, not an in-place rewrite of the legacy Go product.

## Process Ownership

```text
Tauri / Rust Desktop Shell
|-- WebView: qualified DSH Web + Hermit client composition
|-- bundled exact Node: Hermit Core Host + pinned DSH/Cordis
|-- isolated Product Plugin Runners
`-- Core-owned native providers and explicit Tool subprocesses
```

- Rust owns desktop lifecycle, Node supervision, Tier 0 rescue, OS credentials,
  native capability providers, and signed generation selection.
- Core owns DSH Session/Tool/Approval composition, Package Gate, Capability
  Broker, data registry, diagnostics, and Tier 1 Safe Profile.
- Product Plugins own their Canonical business data and UI/Tool contributions.
  They receive narrow capabilities, not ambient host authority.
- The target process tree contains no Hermit Go runtime.

## Dependency Direction

```text
apps -> public packages -> DSH public contracts
apps -> first-party plugin artifacts
plugins -> Hermit Core public contract
native providers -> runtime protocol / Core-owned provider contracts
migration -> data/authority contracts and sanitized fixtures
```

Product Plugin source does not import another Product Plugin or a privileged
provider implementation. Cross-plugin cooperation uses Core contracts.

## Carrier

The first vertical slice qualifies the target WebView <-> Rust <-> Node/DSH
carrier before business development. The preferred spike is a versioned custom
IPC transport with no TCP listener. If the qualified DSH public contract cannot
support it, an ADR may approve a random loopback fallback with a per-start
runtime token and workspace scope.

The protocol includes version, generation, request/call identity,
request/response, server push, cancellation, deadline, ready, shutdown,
crash/restart, idempotency, and an error taxonomy.

## Generations And Recovery

Code and data generations switch together. Candidate code uses staging data and
shadow capabilities; it cannot perform real external effects before activation.
Tier 0 rescue starts without Node/DSH. Tier 1 Safe Profile loads qualified Core
recovery surfaces without Product Plugins or model calls.

The legacy Go authority is never mounted into this development repository.
Migration rehearsal reads approved snapshots into staging generations. The
production authority changes once through an epoch/lease-protected atomic
commit and never returns to Go.
