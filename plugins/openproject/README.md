# OpenProject MCP server

A comprehensive, write-capable Model Context Protocol server for OpenProject
API v3. Its 41 focused tools cover projects, work packages, attachments,
relations, boards, users, watchers, notifications, and reference data.

Attachment tools can list files on a work package and fetch their content.
Text-based files are returned directly; binary files are returned as embedded
MCP resources. Uploads and downloads are size-limited per request.

The package is maintained as part of
[OpenProject for Codex](https://github.com/alex13slem/openproject-codex-plugin),
which also includes Codex workflow guidance and portable installers.

## Run with an MCP client

Configure these environment variables:

- `OPENPROJECT_URL`: the root URL of your OpenProject instance;
- `OPENPROJECT_API_TOKEN`: an API token with only the permissions you need.

`OPENPROJECT_BASE_URL` and `OPENPROJECT_API_KEY` are accepted as compatibility
aliases for existing MCP configurations.

Optional settings:

- `OPENPROJECT_PAGE_SIZE`: default collection page size from 1 to 100
  (default `25`);
- `OPENPROJECT_TIMEOUT_MS`: request timeout from 1000 to 300000 milliseconds
  (default `30000`);
- `OPENPROJECT_AUTH_MODE`: `basic` for broad compatibility (default), or
  `bearer` for OpenProject 17.2 and newer.
- `OPENPROJECT_ALLOWED_UPLOAD_DIRS`: platform-separated directories from which
  upload tools may read files (default: current working directory).

Then launch the stdio server with:

```bash
npx -y openproject-codex-plugin
```

Example MCP configuration:

```json
{
  "mcpServers": {
    "openproject": {
      "command": "npx",
      "args": ["-y", "openproject-codex-plugin"],
      "env": {
        "OPENPROJECT_URL": "https://tasks.example.com",
        "OPENPROJECT_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

Never commit API tokens or include them in public logs and screenshots.

## Capabilities

- Project CRUD, counts, native filters, sorting, and pagination.
- Work-package search, CRUD, comments, activity history, scheduling, estimates,
  progress, hierarchy, assignees, responsible users, priorities, statuses, and
  versions.
- Attachment listing, authenticated reads, local-file uploads, and deletion.
- Relations and watcher management.
- Current-user lookup, user search, and permission-aware available assignees.
- In-app notifications and Kanban-style board inspection.
- Status, priority, type, and version discovery.
- Restricted GET-only passthrough for uncovered paths under `/api/v3`.

Read, write, and destructive tools carry MCP annotations so compatible clients
can apply appropriate confirmation policies. Collection responses include
`total`, `count`, `offset`, `pageSize`, and `hasMore` metadata.

## License

MIT
