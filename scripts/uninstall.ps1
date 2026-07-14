$ErrorActionPreference = "Stop"

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Error "Bun 1.3 or newer is required."
    exit 1
}

& bun (Join-Path $PSScriptRoot "uninstall.ts") @args
exit $LASTEXITCODE
