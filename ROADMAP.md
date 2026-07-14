# Roadmap

The roadmap favors safer workflows and better discovery before adding broad
administrative capabilities.

## Released in v0.2.0

- Cross-platform installation on Windows, macOS, and Linux.
- Filter work packages by status, assignee, due date, and current user.
- Compact work-package results with scheduling and progress fields.
- Clickable OpenProject URLs in search and write results.
- Unit tests for API authentication, filters, updates, and errors.

## Released in v0.5.0

- Project CRUD, native filtering, sorting, pagination, and count tools.
- Work-package activities, deletion, scheduling, estimates, progress,
  hierarchy, responsibility, and versions.
- Attachment uploads and deletion, relations, watchers, notifications, boards,
  users, available assignees, and reference data.
- Request timeout and authentication-mode controls.
- Restricted GET-only API v3 passthrough for uncommon read workflows.

## Later

- Optional read-only mode.
- Integration tests against a disposable OpenProject instance.
- Automated release notes and version synchronization.
- OAuth support for centrally administered, multi-user deployments.
- Board card movement after validating behavior across free and action boards.

Roadmap items are proposals, not commitments. Open an issue to discuss new
capabilities before starting a substantial implementation.
