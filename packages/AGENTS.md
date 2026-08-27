# packages/ — Package Contract

Default mold for simple first-party library and CLI packages under
`packages/`. The references are **`packages/csv`** (server-side, CLI +
benches) and **`packages/time`** (browser-safe, demo + test oracle);
`rsx`, `decimal`, `http`, `validate`, `x12`, and similar flat packages
copy that shape. New packages start here.

Larger packages follow the **values** below and the README top LAF;
they earn structure and are listed under [Earned shapes](#earned-shapes)
rather than forced into a one-file tree. Editor trees (`vscode`, `vim`)
sit beside the stdlib packages and follow the same values where they apply.

## Style — the values that generate the rules

Every rule below falls out of a few ranked values. When a case the
rules don't cover comes up, decide with these, in this order:

1. **Loud beats everything.** No silent failure, no soft fallback, no
   registration that quietly didn't happen. If two designs tie, the
   one whose failure mode is an immediate, named error wins.
2. **Simple beats pure.** A single file that takes one honest import
   beats a pristine two-file split (decimal's coercer merge). Flat
   layout until structure is *earned* — a directory exists only for a
   structural reason (dependency quarantine, plugin resolution, native
   host, multi-surface ownership), never as invocation sugar or
   symmetry.
3. **POLS — the principle of least surprise.** `rip test.rip` cannot
   be shadowed by a future CLI subcommand; a boring top-left logo
   renders identically everywhere; automatic where the user should
   not have to remember (coercers ride the main import), explicit
   where they must decide (rounding modes, relax/excel flags).
4. **Fast is a feature, and measured.** Hot paths get profiled and
   benched, not guessed. A performance claim in a README exists only
   with the bench that reproduces it (`bun run bench`); stale or
   unverified numbers are deleted, not caveated.
5. **Lightweight by default.** Mold packages ship zero runtime
   dependencies. External packages appear as test oracles (dayjs),
   quarantined bench competitors, or — when a surface honestly needs
   them — named earned deps (`print` → highlight.js, `ui` →
   css-tree/tailwindcss, `sites` / `vscode` → their real stacks). The
   shared harness stays tiny (~110 lines, five exports) and grows only
   when a concrete test cannot be written without it.
6. **Cookie-cutter edges, honest middles.** The frame (README top LAF,
   package.json key order for mold packages, test anatomy) stays
   uniform so a script can verify it. The content between the edges is
   whatever the domain truly needs; no section is stamped on for
   symmetry.
7. **Claims are verified.** README examples run against the real
   implementation before they are written down.

## Layout (default mold)

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

Package binaries have exactly ONE shape for mold CLIs: the entry `.rip`
file IS the bin. Its first line is `#!/usr/bin/env rip`, it is
executable, the CLI logic sits behind `import.meta.main`, and
package.json maps the command name to it
(`"bin": { "rip-<name>": "./<name>.rip" }`). No `bin/` directory, no
wrapper scripts (sh or JS). This assumes `rip` is on PATH; inside the
repo, `bun run` contexts resolve it to THIS checkout via the root
postinstall link, and `rip <name>.rip` always works regardless. The
reference is `packages/x12`. (Earned packages such as `sites` may keep
additional control-plane layout; that does not reopen mold CLIs.)

### Multi-bin collections (`utils`)

A package may be a collection of standalone CLI scripts rather than a
library. Shape:

```
packages/utils/
  curl.rip        # each utility is its own bin
  test.rip
  package.json    # "bin" maps every utility; no "exports"
  README.md
```

No library entry and no `exports`. Each utility follows the bin shape
above (shebang, executable, loud reject unless `import.meta.main`) and
reads its version from the package's `package.json`. Adding a utility
is: drop the `.rip` file, add a `"bin"` entry, list it under `"files"`,
document it in the README, and extend `test.rip`.

### Plugin directories (`stamp`)

A package whose extension model is "drop a file in a directory and it
resolves at runtime" earns that directory — it is a structural part of
the program, not invocation sugar. `stamp` is the reference: its
`directives/` holds one `<type>.rip` per handler, each exporting the
`check`/`apply`/`verify` contract, and the engine resolves a directive's
type to the matching file (built-in, then local, then installed). Inputs
the package treats as DATA may share this shape — stamp's `stamps/`
example Stampfiles live in a directory because code and tests reference
them; they are assets, not modules. The flat-until-earned rule still
holds for CODE: a `src/` split that only mirrors the call graph folds
into the root entry.

### Earned shapes

These packages follow the values and README top LAF; they are **not**
one-file mold trees. Prefer the package README (and any package-local
`TODO.md`) for architecture — do not restate it here.

| Package | Why the structure is earned |
|---------|-----------------------------|
| `sites` | System edge / manager / workers / demos — see [docs/SERVER.md](../docs/SERVER.md) |
| `app` | Multi-module application substrate (`index.rip` + surface modules, `test/`) |
| `ui` | Ownership split: `email/` / `shared/` / `tailwind/` / `browser/` |
| `tray` | Rip provider + macOS SwiftUI host (`macos/`) |
| `ai` | MCP server entry plus `lib/` |
| `highlight` | Single highlight.js grammar module (`.js` entry, not `.rip`) |
| `vscode` | VS Code extension (`vscode-rip`) — `src/`, marketplace metadata |
| `vim` | Vim plugin tree (`syntax/`, `ftdetect/`, …) — no `package.json` |

Do NOT add for mold packages: per-package `bunfig.toml`, `bun.lock`,
`.d.ts` files, `test/` directories, or JS test files. Types are a later,
separate pass. A package-root `bun.lock` is not isolation under
`linker = "hoisted"` — `bun install` from a package directory still
resolves against the repo-root lockfile — and CI's frozen-lockfile gate
is root-only (`test/toolchain/dependencies.test.js` rejects a sibling
`bun.lock` next to each `packages/*/package.json`). Nested quarantine
trees that are their own package (`csv/bench`, `print/vscode`,
`sites/demos/cart`) may keep
a lock. Earned packages may use `test/` when the suite is host-heavy
(see [Tests](#tests)).

## package.json

Keys in exactly this order for mold packages (omit what does not apply):

```json
{
  "name": "@rip/<name>",
  "version": "4.0.0",
  "private": true,
  "type": "module",
  "description": "<pitch — same text as the README blockquote>",
  "exports": { ".": "./<name>.rip" },
  "scripts": {
    "test": "rip test.rip",
    "demo": "rip demo.rip",
    "bench": "rip bench.rip"
  },
  "rip": { "browser": true },
  "files": ["<name>.rip", "README.md"]
}
```

- `exports` points at `.rip` sources only — no `"types"`, no `"main"`
  (highlight's `.js` entry is the earned exception).
- `description` and the README `> **…**` pitch are the same sentence
  (include the trailing period in both). WIP packages may use
  `"version": "0.0.0"` until the surface stabilizes.
- Scripts invoke bare `rip`. The root `postinstall` links
  `node_modules/.bin/rip` → `bin/rip`, and `bun run` puts the workspace
  root's `.bin` first on PATH — so `rip` inside a script is always THIS
  repo's compiler, even when the shell's global `rip` points at another
  checkout. Always run suites via `bun run test` (a bare `rip` typed in
  a shell may be a different checkout). Do not use `bun test` for
  `.rip` suites — it never sees them.
- In-repo imports use the `rip/<name>` stdlib namespace (the loader
  resolves them from this checkout) — no `workspace:*` entries, no
  dependency declarations between stdlib packages. Mold packages keep
  external runtime deps at zero; earned external deps are declared in
  that package's own `package.json`.
- No `keywords`, `license`, `repository`, `author` while
  `private: true` — publish metadata comes with the publish pass.
  Marketplace packages (`vscode-rip`) are the exception and carry the
  fields the store requires.

### `rip.browser`

Set `"rip": { "browser": true }` ONLY when the entry runs in a browser:
no `Bun.*`, `node:*`, `process.*`, or `globalThis` in the source, and
imports only of browser-safe modules (the schema runtime qualifies —
decimal imports it for coercer registration). Absence of the flag means
server-only — never write `"browser": false`. When claimed, pin it in
`test.rip` (see time's "declares browser safety and earns it").

Schema coercers register AUTOMATICALLY on the package's main import:
pulling in the package makes its `~:name` coercers work with no bridge
import. The collision policy stays loud — the only way the import can
throw is a genuine foreign claim on the name. Export a
`register<X>Coercer(name)` for custom names.

## README.md

**Required top LAF** (every package, including earned shapes and editor
trees):

1. Logo on its own paragraph, then the title:

   ```
   <img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

   # Rip <Name>
   ```

   The asset lives in this repo (`docs/assets/rip.png`); the src is
   the absolute raw URL above — identical in every README, and it
   renders in contexts where a relative path has no repo to resolve
   against (offline copies, packaged extension pages).

   (`alt`/`width` ATTRIBUTES, never `style` — GitHub strips
   `style`. No `align` tricks: floats and inline-in-heading placements
   render inconsistently across GitHub and editor previews.)
2. `> **<pitch>**` — same text as `package.json` `description` (trailing
   period included in both).
3. One short paragraph on how it works — new information, never a
   restatement of the pitch.
4. A `**Runtime:**` line stating host/browser posture in one or two
   sentences:
   - browser-safe: `**Runtime:** browser-safe (\`rip.browser: true\`). One \`.rip\` file.`
   - server-only: `**Runtime:** not browser-safe — <which APIs and why>. One \`.rip\` file.`
   - editor / native hosts: name the host (VS Code + Bun, Vim, macOS
     SwiftUI, …) and that it is not a browser import.

**Default mold sections** (library/CLI packages — omit when they do not
apply):

5. `## Quick Start` — a `coffee` example importing from
   `rip/<name>`; the stdlib ships with rip, so there is no install
   step to show.
6. `## Features` — bullet list when a feature inventory helps.
7. Domain sections (whatever the package needs — Mental model, Install,
   How it works, …).
8. `## Demo` — only if `demo.rip` exists.
9. `## Test` — `bun run test` in a `bash` fence, plus one sentence on
   what the suite covers (when the package has a `test` script).

All shell fences use `bash`. No `## License` footer.

## Tests

- Mold default: one root `test.rip` importing from `rip/testing`
  (`test`, `eq`, `ok`, `throws` — tally on exit, failures set
  `process.exitCode`; colors honor NO_COLOR/FORCE_COLOR).
- Import the package under test by its stdlib name
  (`from 'rip/<name>'`), not a relative path — this exercises the
  loader's stdlib namespace and the real `exports` map.
- Start the suite with a "Package surface" section pinning the export
  names, dependency posture, and (when claimed) browser safety.
- Run with `bun run test` from the package directory.
- Host-heavy suites (`sites`, `app`, `ui`, `vscode`) may use Bun test
  and/or a `test/` tree until a natural Rip shape fits — that is the
  exception. Prefer `"test": "rip test"` when the CLI subcommand wraps
  `bun test` with the `.rip` loader preloaded and a 15000ms default
  timeout (pass `--timeout`/files to override) — never a hand-written
  `--preload` flag. `vscode` may keep a `bun test` script when its
  suite is extension-owned rather than `rip test`.
