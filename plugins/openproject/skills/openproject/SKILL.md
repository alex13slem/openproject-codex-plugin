---
name: openproject
description: Manage projects and work packages in a connected OpenProject instance. Use when the user asks to find, inspect, create, update, assign, prioritize, or comment on OpenProject tasks.
---

# OpenProject

Use the `openproject` MCP tools for OpenProject work.

## Safety

- Treat task creation, updates, assignments, status changes, and comments as external writes.
- Perform a write only when the user explicitly requests it and the target project or work package is unambiguous.
- Before a write, resolve project, type, status, priority, and assignee IDs with read tools when needed.
- Never expose API tokens or environment-file contents.
- After a write, return the work package ID, subject, and URL.

## Workflow

1. Use `list_projects` to resolve a project name or identifier.
2. Use `search_work_packages` or `get_work_package` to inspect existing work.
3. Use `create_work_package` for new tasks. Omit `typeId` to select the project's `Task` type automatically.
4. Use `update_work_package` for field changes.
5. Use `add_work_package_comment` for progress notes and follow-ups.
