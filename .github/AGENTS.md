# GitHub Automation Rules

- Use least-privilege workflow permissions and pin third-party Actions to full
  commit SHAs.
- CI verifies untrusted changes; publish, sign, promote, deploy, migrate, and
  cut over only in protected workflows with explicit authorization.
- Keep Secrets out of output, artifacts, fixtures, caches, and pull-request
  code paths.
- Treat `pull_request_target`, release environments, OIDC publishing, artifact
  attestations, and repository settings as security-sensitive contracts.
- Writing a workflow does not authorize dispatching its privileged effects.
