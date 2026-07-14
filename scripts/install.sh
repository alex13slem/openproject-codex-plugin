#!/usr/bin/env bash
set -euo pipefail

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun 1.3 or newer is required." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bun "$ROOT_DIR/scripts/install.ts" "$@"
