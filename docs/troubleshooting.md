# Troubleshooting

## Environment file not found

Create the default file and restrict its permissions:

```bash
mkdir -p ~/.codex
cp .env.example ~/.codex/openproject.env
chmod 600 ~/.codex/openproject.env
```

On Windows, create the same file in PowerShell:

```powershell
New-Item -ItemType Directory -Force (Join-Path $HOME ".codex")
Copy-Item .env.example (Join-Path $HOME ".codex\openproject.env")
```

If you use another location, reinstall with `--env-file` followed by its
absolute path. Existing `~/.config/codex/openproject.env` files continue to be
detected on macOS and Linux.

## OpenProject returns 401 or 403

- Confirm that the API token is active and copied without surrounding spaces.
- Confirm that `OPENPROJECT_URL` points to the instance root, not `/api/v3`.
- Check that the token owner can access the requested project in OpenProject.
- Revoke and replace the token if it may have been exposed.

## Codex cannot find the tools

Run the installer again and start a new Codex thread:

```bash
./scripts/install.sh
```

On Windows, run `./scripts/install.ps1` from PowerShell instead.

Then verify that `openproject` appears in the configured MCP servers for your
Codex installation.

## A work-package update conflicts

OpenProject uses `lockVersion` to prevent lost updates. Retry the request after
reading the work package again so the plugin can use its latest version.

## Dependency installation reports a frozen lockfile error

Use the committed Bun version and do not edit dependency versions without also
updating `bun.lock`:

```bash
cd plugins/openproject
bun install
bun run check
```

Commit both `package.json` and `bun.lock` when dependencies change.

## Collecting diagnostics

Include the operating system, Bun version, Codex version, OpenProject version,
tool name, and sanitized error message in a bug report. Never include tokens,
private instance URLs, customer data, or complete private API responses.
