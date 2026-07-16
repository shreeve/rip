# packages/ — Package Contract

Rules for first-party `@rip-lang/*` packages in this directory. The
reference implementations are **`packages/csv`** (server-side, has a
CLI and benches) and **`packages/time`** (browser-safe, has a demo and
a test oracle); `rsx` and `decimal` follow the same mold. New and
migrated packages copy their shape exactly; packages differ only where
their content honestly differs.

## Style — the values that generate the rules

Every rule below falls out of a few ranked values. When a case the
rules don't cover comes up, decide with these, in this order:

1. **Loud beats everything.** No silent failure, no soft fallback, no
   registration that quietly didn't happen. If two designs tie, the
   one whose failure mode is an immediate, named error wins.
2. **Simple beats pure.** A single file that takes one honest import
   beats a pristine two-file split (decimal's coercer merge). Flat
   layout until structure is *earned* — a directory exists only for a
   structural reason (dependency quarantine), never as invocation
   sugar or symmetry.
3. **POLS — the principle of least surprise.** `rip test.rip` cannot
   be shadowed by a future CLI subcommand; a boring top-left logo
   renders identically everywhere; automatic where the user should
   not have to remember (coercers ride the main import), explicit
   where they must decide (rounding modes, relax/excel flags).
4. **Fast is a feature, and measured.** Hot paths get profiled and
   benched, not guessed. A performance claim in a README exists only
   with the bench that reproduces it (`bun run bench`); stale or
   unverified numbers are deleted, not caveated.
5. **Lightweight forever.** Zero runtime dependencies. External
   packages appear only as test oracles (dayjs) or quarantined bench
   competitors. The shared harness stays tiny (~100 lines, four
   exports) and grows only when a concrete test cannot be written
   without it.
6. **Cookie-cutter edges, honest middles.** The frame (layout,
   package.json key order, README skeleton, test anatomy) is
   byte-conformant across packages — a script can verify it. The
   content between the edges is whatever the domain truly needs; no
   section is stamped on for symmetry.
7. **Claims are verified.** README examples run against the real
   implementation before they are written down. Test parity with a
   prior generation is diffed mechanically, not declared.

## Layout

```
packages/<name>/
  <name>.rip      # public entry (or index.rip when the name is taken)
  test.rip        # the whole suite, at package root — not test/
  demo.rip        # optional runnable tour (time has one)
  bench.rip       # optional self-bench, zero deps (csv has one)
  bench/          # only when a bench needs quarantined deps (csv:
                  # compare.rip head-to-head — competitor parsers live
                  # in bench/package.json, never in the package itself)
  package.json
  README.md
```

Runnable package verbs are root-level `<verb>.rip` files invoked as
`rip <verb>.rip` — the extension can never collide with a CLI
subcommand (`rip test`, `rip schema`). A directory appears only for a
structural reason (its own package.json quarantining bench-only deps),
never as an invocation convenience.

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
    "demo": "rip demo.rip",
    "bench": "rip bench.rip"
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
imports only of browser-safe modules (the schema runtime qualifies —
decimal imports it for coercer registration). Absence of the flag means
server-only — never write `"browser": false`. When claimed, pin it in
`test.rip` (see time's "declares browser safety and earns it").

Schema coercers register AUTOMATICALLY on the package's main import
(user decision, reversing the v4 `/coercers` split): pulling in the
package makes its `~:name` coercers work with no bridge import. The
collision policy stays loud — the only way the import can throw is a
genuine foreign claim on the name. Export a `register<X>Coercer(name)`
for custom names.

## README.md

Same mold for every package, top to bottom:

1. rip.png banner at top-left, its own paragraph, then the title:

   ```
   <img src="https://raw.githubusercontent.com/shreeve/rip-lang/main/docs/assets/rip.png" alt="Rip" width="50" />

   # Rip <Name> - @rip-lang/<name>
   ```

   (`alt`/`width` ATTRIBUTES, never `style` — GitHub strips `style`.
   No `align` tricks: floats and inline-in-heading placements render
   inconsistently across GitHub and editor previews.)
2. `> **<pitch>**` — byte-identical to the `package.json` description
3. One paragraph on how it works — new information, never a restatement
   of the pitch
4. A `**Runtime:**` line stating browser safety in one sentence:
   - browser-safe: `**Runtime:** browser-safe (\`rip.browser: true\`). One \`.rip\` file.`
   - server-only: `**Runtime:** not browser-safe — <which APIs and why>. One \`.rip\` file.`
5. `## Quick Start` — `bun add @rip-lang/<name>` in a `bash` fence,
   then a `coffee` example
6. `## Features` — bullet list
7. Domain sections (whatever the package needs)
8. `## Demo` — only if `demo.rip` exists
9. `## Test` — `bun run test` in a `bash` fence, plus one sentence on
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
