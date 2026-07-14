#!/usr/bin/env bun
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (process.argv.includes("--help")) {
  console.log("Usage: bun scripts/uninstall.ts");
  process.exit(0);
}
if (process.argv.length > 2) fail(`Unknown argument: ${process.argv[2]}`);

const codex = Bun.which("codex");
if (!codex) fail("Codex CLI is required and must be available on PATH.");

function run(command: string[], quiet = false): number {
  return Bun.spawnSync({
    cmd: command,
    stdin: "inherit",
    stdout: quiet ? "ignore" : "inherit",
    stderr: quiet ? "ignore" : "inherit",
  }).exitCode;
}

if (run([codex, "mcp", "get", "openproject"], true) === 0) {
  const exitCode = run([codex, "mcp", "remove", "openproject"]);
  if (exitCode !== 0) fail(`Could not remove OpenProject MCP (exit code ${exitCode}).`);
  console.log("OpenProject MCP removed from Codex.");
} else {
  console.log("OpenProject MCP is not installed.");
}
