# Product Plugin Security Contract

Product Plugin is a Hermit trust/package boundary, not a synonym for an
in-process Cordis plugin.

## Trust Tiers

P0 Production accepts only:

1. Hermit first-party signed artifacts.
2. Hermit-audited artifacts whose exact digest is signed/attested and present in
   the production catalog.

Community discovery does not authorize installation. Developer Mode is a
separate app/profile/data/credential security domain with no Production
authority, database, migration command, or Secret namespace.

## Package Gate

Package Gate validates bytes before lifecycle code executes:

```text
stage bytes
-> hash and origin
-> manifest schema
-> signature/attestation
-> Core and DSH compatibility
-> capability policy
-> dependency, SBOM, license, and lifecycle-script policy
-> materialize
-> load into the approved Runner
```

Unknown capabilities and compatibility states fail closed.

## Capability Model

The manifest declares capabilities and data namespaces. Capability Broker mints
short-lived narrow handles scoped by plugin, Session/agent, action, resource,
constraints, and generation.

Product Plugin code expresses intent. It does not directly obtain filesystem,
network, process, environment, credential, model/`ctx.llm`, Tauri, native/FFI,
or another plugin's data authority. Pure computation APIs are not treated as
privileged merely because they are Node built-ins.

The isolated Runner is defense in depth; ordinary Cordis composition and DSH
filesystem sandbox vocabulary are not proof of network/process/credential
isolation.

## Dependency And Lifecycle Rules

- The only Hermit hard runtime dependency is the Core public contract.
- Cross-plugin cooperation uses Core events/services/capabilities, not value
  imports, shared tables, or foreign keys.
- Client code does not invoke Tauri/native directly; Host code goes through the
  Broker/provider contract.
- Every registration and background resource belongs to the activation
  generation and disposes cleanly.
- Uninstall removes code/derived state, preserves Canonical data by default,
  and leaves historical Session rendering to Core.

Security boundaries require negative tests with malicious fixtures, not only
manifest/static checks.
