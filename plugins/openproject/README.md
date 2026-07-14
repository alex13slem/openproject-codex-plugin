# OpenProject MCP server

A write-capable Model Context Protocol server for OpenProject API v3. It can
search, create, update, assign, prioritize, and comment on work packages.

The package is maintained as part of
[OpenProject for Codex](https://github.com/alex13slem/openproject-codex-plugin),
which also includes Codex workflow guidance and portable installers.

## Run with an MCP client

Configure these environment variables:

- `OPENPROJECT_URL`: the root URL of your OpenProject instance;
- `OPENPROJECT_API_TOKEN`: an API token with only the permissions you need.

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

## License

MIT
