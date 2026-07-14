#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEnvFile } from "../plugins/openproject/scripts/config.ts";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = resolve(rootDir, "plugins", "openproject");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

let explicitEnvFile: string | undefined;
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  const argument = args[index];
  if (argument === "--help") {
    console.log("Usage: bun scripts/install.ts [--env-file PATH]");
    process.exit(0);
  }
  if (argument === "--env-file") {
    const value = args[++index];
    if (!value || value.startsWith("--")) fail("--env-file requires a path.");
    explicitEnvFile = value;
    continue;
  }
  fail(`Unknown argument: ${argument}`);
}

const envFile = resolveEnvFile(explicitEnvFile);
if (!existsSync(envFile)) {
  fail(
    `OpenProject environment file not found: ${envFile}\n` +
      "Create it from .env.example before installing.",
  );
}

const bun = Bun.which("bun") ?? process.execPath;
const codex = Bun.which("codex");
if (!codex) fail("Codex CLI is required and must be available on PATH.");

function run(
  command: string[],
  { quiet = false, allowFailure = false } = {},
): boolean {
  const result = Bun.spawnSync({
    cmd: command,
    cwd: pluginDir,
    stdin: "inherit",
    stdout: quiet ? "ignore" : "inherit",
    stderr: quiet ? "ignore" : "inherit",
  });
  if (!allowFailure && result.exitCode !== 0) {
    fail(`Command failed with exit code ${result.exitCode}: ${command[0]}`);
  }
  return result.exitCode === 0;
}

run([bun, "install", "--frozen-lockfile"]);

if (run([codex, "mcp", "get", "openproject"], { quiet: true, allowFailure: true })) {
  run([codex, "mcp", "remove", "openproject"]);
}

run([
  codex,
  "mcp",
  "add",
  "openproject",
  "--env",
  `OPENPROJECT_ENV_FILE=${envFile}`,
  "--",
  bun,
  resolve(pluginDir, "scripts", "server.ts"),
]);

console.log("OpenProject MCP installed globally. Start a new Codex thread to use it.");
