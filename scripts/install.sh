#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="$ROOT_DIR/plugins/openproject"
ENV_FILE="${OPENPROJECT_ENV_FILE:-$HOME/.config/codex/openproject.env}"
if ! command -v codex >/dev/null 2>&1; then
  echo "Codex CLI is required." >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun 1.3 or newer is required." >&2
  exit 1
fi

BUN_BIN="$(command -v bun)"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "OpenProject environment file not found: $ENV_FILE" >&2
  echo "Create it from .env.example before installing." >&2
  exit 1
fi

(cd "$PLUGIN_DIR" && "$BUN_BIN" install --frozen-lockfile)

if codex mcp get openproject >/dev/null 2>&1; then
  codex mcp remove openproject
fi

codex mcp add openproject \
  --env "OPENPROJECT_ENV_FILE=$ENV_FILE" \
  -- "$BUN_BIN" "$PLUGIN_DIR/scripts/server.ts"

echo "OpenProject MCP installed globally. Start a new Codex thread to use it."
