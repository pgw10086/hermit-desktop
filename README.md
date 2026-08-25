# Hermit vNext

Hermit vNext is a local-first desktop AI workspace built on a qualified,
pinned DeepSeek Harness (DSH) platform. Tauri/Rust owns the desktop and rescue
boundary; DSH owns the AI Session, Tool, Approval, and Web composition; complete
business capabilities ship as independently installable Product Plugins.

Status: private incubation and documentation bootstrap. Product implementation
has not started. See [Project Start Readiness](specs/2026-08-24-hermit-dsh-vnext/start-readiness.md).

## Read First

- [Repository Agent Rules](AGENTS.md)
- [Repository Layout](docs/repository-layout.md)
- [System Boundaries](docs/architecture/system-boundaries.md)
- [Core Requirements](specs/2026-08-24-hermit-dsh-vnext/core-requirements.md)
- [Documentation Map](docs/README.md)

## Repository Boundary

This repository is separate from the legacy Go product. Legacy source and real
user data are not copied here. Migration development uses synthetic or
documented sanitized fixtures and a pinned legacy source identity.
