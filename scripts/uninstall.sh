#!/usr/bin/env bash
set -euo pipefail

if codex mcp get openproject >/dev/null 2>&1; then
  codex mcp remove openproject
  echo "OpenProject MCP removed from Codex."
else
  echo "OpenProject MCP is not installed."
fi
