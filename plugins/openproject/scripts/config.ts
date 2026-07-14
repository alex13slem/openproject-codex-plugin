import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export function resolveEnvFile(
  explicitPath = process.env.OPENPROJECT_ENV_FILE,
  home = homedir(),
  fileExists: (path: string) => boolean = existsSync,
): string {
  if (explicitPath) {
    return isAbsolute(explicitPath) ? explicitPath : resolve(explicitPath);
  }

  const currentPath = join(home, ".codex", "openproject.env");
  const legacyPath = join(home, ".config", "codex", "openproject.env");

  // Keep existing Linux and macOS installations working after moving to the
  // same home-relative default on every desktop operating system.
  return fileExists(currentPath) || !fileExists(legacyPath)
    ? currentPath
    : legacyPath;
}
