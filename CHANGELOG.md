# Changelog

All notable changes to this project are documented here. The project follows
[Semantic Versioning](https://semver.org/).

## Unreleased

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
