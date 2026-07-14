# Contributing

Contributions are welcome. Please open an issue before starting a substantial
change so the approach can be discussed first.

## Development setup

1. Install Bun 1.3 or newer.
2. Install and check the plugin:

   ```bash
   cd plugins/openproject
   bun install --frozen-lockfile
   bun run check
   ```

3. Check the portable installer and Unix wrappers from the repository root:

   ```bash
   bun scripts/install.ts --help
   bun scripts/uninstall.ts --help
   bash -n scripts/install.sh scripts/uninstall.sh
   ```

Use a test OpenProject instance or a least-privilege token while developing.
Never include tokens, environment files, customer data, or private instance
URLs in commits, issues, logs, or screenshots.

## Pull requests

- Keep each pull request focused.
- Explain user-visible behavior and validation steps.
- Add or update documentation when behavior changes.
- Add tests for request-building and API behavior changes.
- Use Conventional Commits, for example `feat: add status lookup` or
  `fix: preserve work package lock version`.
