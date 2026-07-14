---
name: openproject
description: Manage projects and work packages in a connected OpenProject instance. Use when the user asks to find, inspect, create, update, assign, prioritize, comment on OpenProject tasks, or read their attachments.
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
   Search can be narrowed by project, assignee, exact due date, and either an
   exact status or the open/closed status category. Use `assignedToMe` for the
   authenticated user's work packages.
3. Use `list_work_package_attachments` and then
   `get_work_package_attachment` when the task includes attached files. Raise
   `maxBytes` only when the listed file size requires it.
4. Use `create_work_package` for new tasks. Omit `typeId` to select the project's `Task` type automatically.
5. Use `update_work_package` for field changes.
6. Use `add_work_package_comment` for progress notes and follow-ups.
