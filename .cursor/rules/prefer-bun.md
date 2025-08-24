## Prefer Bun for JavaScript/TypeScript in this monorepo

This repository standardizes on the Bun runtime and toolchain. Unless a package explicitly documents otherwise, assume Bun is the default for running, testing, and managing JavaScript/TypeScript.

- **Runtime and scripts**: Use `bun` to execute programs and `bun run <script>` for `package.json` scripts.
- **Dev tools**: Prefer `bunx <tool>` instead of `npx` or globally installed CLIs.
- **Dependencies**: Use `bun add`, `bun remove`, `bun update`, and commit the canonical `bun.lock`. Avoid `npm/yarn/pnpm` lockfiles unless a subpackage explicitly requires them.
- **Testing**: Use `bun test` where applicable. If a subpackage uses another test runner, invoke it via `bunx`.
- **Shebangs**: For executable scripts, use `#!/usr/bin/env bun`.
- **Node-only exceptions**: If a subpackage truly requires Node or another engine, document it in that package's `README.md` and its `package.json` scripts. Otherwise, default to Bun.
- **Tone**: Be humble & honest - NEVER overstate what you got done or what actually works in commits, PRs or in messages to the user.
- **Stopping rip-server**: Simply use `bun server stop` to kill the rip-server

Notes:
- We already track `bun.lock` at the repo root. Keep it as the source of truth when possible. Subpackages may maintain their own lockfile only when necessary and documented.
- Prefer ESM by default; Bun supports ESM and TypeScript out of the box.

When in doubt, choose Bun.
