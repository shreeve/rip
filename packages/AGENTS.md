# packages/ — Package Contract

Rules for first-party `@rip-lang/*` packages in this directory. The
reference implementations are **`packages/csv`** (server-side, has a
CLI) and **`packages/time`** (browser-safe, has a demo and a test
oracle). New and migrated packages copy their shape exactly; the two
differ only where their content honestly differs.

## Layout

```
packages/<name>/
  <name>.rip      # public entry (or index.rip when the name is taken)
  test.rip        # the whole suite, at package root — not test/
  demo.rip        # optional runnable tour (time has one; csv does not)
  package.json
  README.md
```

Do NOT add: per-package `bunfig.toml`, `bun.lock`, `.d.ts` files,
`test/` directories, or JS test files for pure library packages.
Types are a later, separate pass.

## package.json

Keys in exactly this order (omit what does not apply):

```json
{
  "name": "@rip-lang/<name>",
  "version": "4.0.0",
  "private": true,
  "type": "module",
  "description": "<pitch — byte-identical to the README blockquote>",
  "exports": { ".": "./<name>.rip" },
  "scripts": {
    "test": "rip test.rip",
    "demo": "rip demo.rip"
  },
  "rip": { "browser": true },
  "files": ["<name>.rip", "README.md"],
  "devDependencies": {
    "@rip-lang/testing": "workspace:*"
  }
}
```

- `exports` points at `.rip` sources only — no `"types"`, no `"main"`.
- Scripts invoke bare `rip`. The root `postinstall` links
  `node_modules/.bin/rip` → `bin/rip`, and `bun run` puts the workspace
  root's `.bin` first on PATH — so `rip` inside a script is always THIS
  repo's compiler, even when the shell's global `rip` points at another
  checkout. Always run suites via `bun run test` (a bare `rip` typed in
  a shell may be a different checkout). Do not use `bun test` for
  `.rip` suites — it never sees them.
- In-repo deps use `workspace:*` (root workspaces + hoisted linker
  resolve them); external deps are test oracles only (e.g. dayjs).
- No `keywords`, `license`, `repository`, `author` while
  `private: true` — publish metadata comes with the publish pass.

### `rip.browser`

Set `"rip": { "browser": true }` ONLY when the entry runs in a browser:
no `Bun.*`, `node:*`, `process.*`, or `globalThis` in the source, and
no imports. Absence of the flag means server-only — never write
`"browser": false`. When claimed, pin it in `test.rip` (see time's
"declares browser safety and earns it").

## README.md

Same mold for every package, top to bottom:

1. rip.png banner: `<img src="https://raw.githubusercontent.com/shreeve/rip-lang/main/docs/assets/rip.png" style="width:50px" /> <br>`
2. `# Rip <Name> - @rip-lang/<name>`
3. `> **<pitch>**` — byte-identical to the `package.json` description
4. One paragraph on how it works — new information, never a restatement
   of the pitch
5. A `**Runtime:**` line stating browser safety in one sentence:
   - browser-safe: `**Runtime:** browser-safe (\`rip.browser: true\`). One \`.rip\` file.`
   - server-only: `**Runtime:** not browser-safe — <which APIs and why>. One \`.rip\` file.`
6. `## Quick Start` — `bun add @rip-lang/<name>` in a `bash` fence,
   then a `coffee` example
7. `## Features` — bullet list
8. Domain sections (whatever the package needs)
9. `## Demo` — only if `demo.rip` exists
10. `## Test` — `bun run test` in a `bash` fence, plus one sentence on
    what the suite covers

All shell fences use `bash`. No `## License` footer.

## Tests

- One root `test.rip` importing from `@rip-lang/testing`
  (`test`, `eq`, `ok`, `throws` — tally on exit, failures set
  `process.exitCode`; colors honor NO_COLOR/FORCE_COLOR).
- Import the package under test by its published name
  (`from '@rip-lang/<name>'`), not a relative path — this exercises the
  real `exports` map.
- Start the suite with a "Package surface" section pinning the export
  names, dependency posture, and (when claimed) browser safety.
- When migrating from rip-lang (v3): every v3 test case lands here
  unless it duplicates an existing case. Diff by test name and verify
  before declaring parity.
- Run with `bun run test` from the package directory. Host-heavy suites
  (server, db, vscode) may stay on Bun test until they have a natural
  Rip shape — that is the exception. Their script is `"test": "rip test"`
  — the CLI subcommand wraps `bun test` with the `.rip` loader preloaded
  and a 15000ms default timeout (pass `--timeout`/files to override) —
  never a hand-written `--preload` flag.
