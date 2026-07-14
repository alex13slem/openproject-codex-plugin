# Changelog

All notable changes to this project are documented here. The project follows
[Semantic Versioning](https://semver.org/).

## 0.3.0 — 2026-07-14

### Added

- Published-package metadata and an npm executable for installation through
  MCP registries and clients.
- Official MCP Registry metadata and an OIDC-based publishing workflow.
- Direct OpenProject work-package URLs in compact search results and write
  responses.

### Changed

- Clarified Community Edition compatibility and the project's write-capable
  positioning relative to OpenProject's official MCP server.
- Added a visual example workflow and refreshed the project banner.
- Updated the roadmap after the v0.2.0 release.
- The MCP server can now read credentials directly from environment variables,
  while retaining support for the private environment file used by installers.

## 0.2.0 — 2026-07-14

### Added

- Cross-platform Bun installer with shell wrappers for macOS/Linux and
  PowerShell wrappers for Windows.
- CI coverage on Windows, macOS, and Linux.
- Work-package filters for assignee, current user, exact due date, and status.
- Compact work-package search results with scheduling and progress fields.
- Unit tests for authentication headers, API errors, HAL resources, filters,
  and optimistic-lock update payloads.
- Architecture, troubleshooting, and roadmap documentation.
- Project banner and expanded usage examples.

### Changed

- New installations use `~/.codex/openproject.env` on every desktop OS while
  retaining compatibility with the previous `~/.config/codex` location.
- Extracted OpenProject HTTP and payload logic into a testable API module.

## 0.1.0 — 2026-07-13

### Added

- Initial Codex plugin and MCP server.
- Project and work-package search tools.
- Work-package creation, updates, and comments.
- Installer, marketplace manifest, CI, and public project documentation.
