# Normative Spec Rules

- Specs are machine-consumed invariants. Keep identifiers, versions, ownership,
  compatibility, and error semantics explicit.
- Change a normative schema and all dependent contracts/tests atomically.
- Code cannot weaken a spec through local interpretation; proposed exceptions
  are structured, reviewed, and auditable.
- Product requirements stay separate from generated verification evidence.
