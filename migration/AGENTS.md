# Migration Rules

- Default input is synthetic or documented sanitized data. The sibling legacy
  repository and real user data remain outside scope.
- Rehearsal is dry-run capable, repeatable, and writes only a new staging
  generation with reconciliation evidence.
- Bind adapters to a pinned legacy source identity and explicit field mapping.
- Never move or overwrite source data; copy, hash, validate, and commit staging.
- Real-input migration and production cutover are separate actions requiring
  explicit user authorization.
- Authority epoch/lease, backup receipt, validation, and crash point evidence
  precede the one-time authority commit.
