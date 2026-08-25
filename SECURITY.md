# Security Policy

Hermit vNext is in private incubation and has no supported production release.

Report suspected vulnerabilities privately to the repository owner. Do not
open a public issue containing credentials, user data, exploit details, or
unredacted logs.

## Security Boundaries

- Product Plugins are not trusted merely because they are Cordis/DSH plugins.
- Production admits only first-party or Hermit-audited signed artifacts.
- Secrets are references resolved by a Core-owned credential provider and are
  not stored in repository fixtures, logs, or plugin configuration.
- Real user data and the sibling legacy repository are outside Coding Agent
  scope.
- Release, publish, signing, migration, and cutover actions require explicit
  authorization and protected environments.

The complete plugin and Runtime Agent policies live under `docs/contracts/`.
