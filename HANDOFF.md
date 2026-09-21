# HANDOFF.md — Getting Up to Speed in This Repository

Read this first, then the documents it points to. It says what the
repository is, how work moves through it, what a newcomer trips on in
the language, and where the current state of each area is recorded. It
states present facts; `git log` holds the history. State snapshot taken
2026-09-18 at main `9868a69f`; anything dated below is verified as of
then.

## Reading order

1. [AGENTS.md](AGENTS.md) — the operating rules. Every one of them is
   enforced by a gate or a reviewer. The ten numbered rules and the
   Style section are the minimum before touching code.
2. [README.md](README.md) — repository scope, core commands, the REPL,
   local HTTPS through Janus.
3. [ECOSYSTEM.md](ECOSYSTEM.md) — how Rip, Janus (the edge), DuckDB
   Harbor (the database process) and Rip Sites fit together, with the
   MedLabs request path as the worked example.
4. [packages/AGENTS.md](packages/AGENTS.md) — the package mold (layout,
   package.json, README shape, `test.rip` at the package root) and the
   ranked values that generate it: loud beats everything, simple beats
   pure, least surprise, fast and measured, lightweight, verified claims.
5. [docs/ROADMAP.md](docs/ROADMAP.md) and [TODO.md](TODO.md) — open
   work only. Package-local `TODO.md` files (`packages/app`,
   `packages/db`, `packages/sites`, `packages/vim`) hold each package's
   own leftovers.
6. The permanent contracts under `docs/` as the task needs them:
   SERVER (Sites architecture), ORM, TYPES, VARIANTS, WORKSPACE, HMR,
   FRAME, RFCS, CLEANROOM.

## The repository in one screen

```
bin/rip            the CLI (`rip --help`); REPL, run, check, schema, email, sites, test
src/               the compiler: lexer.js, grammar/ (Rip source), parser.js (GENERATED,
                   never hand-edited), emitter.js, types.js, loader.js (Bun preload that
                   compiles .rip on import), browser.js (in-browser compiler)
src/cli/           check, explain, migrate, public, repl, run, schema
src/runtime/       reactive, components, schema, orm, duckdb, stdlib, intrinsics, vocab
packages/          first-party packages, each a Bun workspace (see the table below)
test/              rip/ (39 language suites, the syntax contract), lang/, mapping/, ui/,
                   schema/, toolchain/, corpus/ (emitted-output snapshots), spawn/
                   (process lane), browser/ (Playwright), audit/ (typed-editor scoreboard)
scripts/           test-all, corpus, browser-bundle, tailwind-bundle, global, install-ext
dist/@rip/         the browser bundle (regenerate with `bun run browser`)
docs/              permanent contracts (understanding), never working notes
misc/              gitignored reference checkouts the benchmarks race against
```

Packages, by what they are for:

| package | one line |
|---|---|
| `sites` | Sinatra-style site framework; routes, validation, workers, the Manager that publishes apps to Janus |
| `app` | dependency-free application data substrate: stash, source, routes, workspace, apply |
| `ui`, `email` | unstyled composable components on native browser features; email templates as components |
| `db` | DuckDB over duckdb-harbor: `connect()`, module-level `sql`, MCP stdio server, `rip-db` CLI |
| `barcodes` | QR, PDF417 and Code 128 generator and reader, camera-budgeted, zero runtime dependencies |
| `csv`, `x12`, `rsx`, `pdf`, `decimal`, `time`, `http`, `validate`, `fake`, `googlesheets` | flat mold packages, each with `test.rip` and a README whose numbers come from its own bench |
| `script`, `swarm`, `stamp`, `tray`, `utils`, `ai` | process and host tooling: PTY/SSH/TCP conversations, worker-thread jobs, host provisioning, macOS tray host, small CLIs, the multi-model consultation MCP |
| `testing` | the tiny harness every `test.rip` imports: `test`, `eq`, `ok`, `throws` |
| `vscode`, `vim`, `highlight`, `print` | the three editor grammars that must move in lockstep with the language, and the source printer |

## How work moves

- **Edit loop.** `bun run test:rip` (sub-second, the language contract),
  `bun run test` (the fast in-process compiler and runtime loop), and
  `bun run test` or `rip test.rip` from inside a package for package
  work. `bun run test:all` is release certification, not the loop.
  AGENTS.md "Commands" lists every rhythm and what each one skips.
- **Compiler changes** that alter output bytes land with regenerated
  corpus snapshots (`bun run corpus`) in the same commit, every changed
  region explained. `src/parser.js` is regenerated (`bun run parser`),
  never edited; its byte drift is a canary for emitter changes.
- **Landing.** Branch from main, open a pull request with `gh`, let the
  required jobs run (`test` and `browser`), then merge as a TRUE MERGE
  commit and delete the branch locally and on origin. Only `main`
  remains between rounds. No squash, no rebase-merge, no force-push.
  Commit messages are `area: imperative sentence`, carry the measured
  before and after numbers for any performance change, and carry no AI
  attribution of any kind.
- **Claims are verified.** A bug report is a hypothesis until reproduced;
  a performance number exists only with the bench that reproduces it,
  measured on an idle machine (concurrent agents make every number
  ranking-only, and the README states which machine and runtime).
- **Timeless wording.** Code, comments and documents state present
  facts. No "previously", "now", "used to", "legacy", "new", no
  narration of a transition, no era framing in a label. A stale
  sentence is a defect (rule 8 applies to comments and READMEs).
- **Big changes** get an independent verifier and one cold review
  before landing (rule 10). Review agents deliver unified diffs per
  unit plus their proof; the coordinator applies one commit per unit,
  re-checking after each.

## Rip in one page

The 39 files under `test/rip/` are the syntax contract; read the one
for the form in question before guessing. The forms a newcomer trips
on:

- `x =! value` binds a constant; `x := value` a reactive state;
  `x ~= value` a computed. A plain `=` to a name that exists in an
  enclosing function scope is a WRITE to that binding, never a shadow,
  so name locals distinctly from module helpers, and make every
  module-level binding `=!`.
- `name! =! (args) ->` declares a void function (no auto-collected
  return); `f! x` calls `f(x)` and awaits it (the "dammit" form),
  `f? x` is optional call, bare `x?` is existence (`x != null`).
  `x ? y` is NOT a default; write `if x is undefined then a else b`
  (never `??` where null must stay loud).
- `X.new args` constructs (`Uint8Array.new n`, `Map.new()`); `fail
  msg, kind` raises; `p` prints.
- `if a then b else c` is the conditional expression the owner prefers
  over a ternary; `unless`, `until`, postfix forms are idiomatic.
- Ranges: `for i in [a...b]` (exclusive), `[a..b]` (inclusive), `by 2`,
  `by -1`. Literal bounds fix the direction statically; variable bounds
  ascend. `for own k, v of obj`, `for x, i in list`.
- A trailing `for` auto-collects an array (`(f x for x in xs)`); end a
  procedure with a bare `return` or give it a bang name to opt out.
  Chained `for` clauses NEST, as CoffeeScript's do: a comprehension is
  a postfix `for` on an expression, so `v for a in as for b in bs` is
  `(v for a in as) for b in bs` — the LAST clause is the outer loop and
  the result is a nested array. They do not flatten the way Python's
  bracketed clause list does. A later clause that reads an earlier
  clause's variable would read it unbound, and rejects. For one flat
  list use one `for` per comprehension, outer loop last, and `.flat()`:
  `((item for item in xs) for xs in lists).flat()`.
- A tail `try` wraps in an IIFE: assign first, then `try`. `yield*`
  is spelled `(yield)*`. `on`, `off`, `yes`, `no`, `by`, `then`, `own`
  are reserved words.
- Rest parameters are `...args` (dots first). Spread the same way.
- Before benchmarking, inspect the emitted JavaScript (`rip -c file.rip`)
  for `Array.from({length`, `_result`, `(() => { try` — each marks a
  form that materialized a range, collected a loop, or wrapped an IIFE
  by accident.
- Style: whitespace-aligned assignment runs, short names unless wrong,
  a rename earns its place only if the old name was wrong or collided,
  minimal diffs, idiomatic Rip over JavaScript-shaped Rip (AGENTS.md
  "Style" has the list).

## Environment

- Bun 1.4 (`bunfig.toml` preloads `src/loader.js` for both `bun` and
  `bun test`; both entries are load-bearing). `bun install` at the
  root; packages share the hoisted `node_modules`, no package-local
  lock. `bun run global` makes this checkout the machine's `rip`.
- Rip Sites needs `janus` on PATH for its integration lane and for
  local HTTPS: `janus autostart`, then `rip sites add
  packages/sites/demos/hello && rip sites start hello` serves
  https://hello.via.rip/. Registered sites run with a watcher and
  republish `dist/bundle.json` on every source change, so a served
  demo already runs whatever the working tree holds.
- The barcodes scorecard and the race need checkouts under the
  gitignored `misc/`: ZXing's test resources at `misc/zxing`
  (blackbox photographs), paulmillr/qr at `misc/qr`. The race script
  header in `packages/barcodes/test/compare.rip` names the two further
  worktrees it wants and how to create them; they are not kept between
  runs.
- Sibling repositories referenced from here: Janus
  (`Data/Code/janus`, the Caddy-based edge), duckdb-harbor
  (the DuckDB process and the Pilot CLI), medlabs (the application
  that drives most product decisions).

## State of the tree

Verified at main `9868a69f`, 2026-09-18:

- **Compiler and language.** 1714 commits; the language suite (3225
  tests) and the fast loop (6773 tests) pass on main, and the required
  `test` and `browser` jobs passed on the last landed pull requests
  (#327, #328). Candidate features (a fresh-binding `own` declaration)
  are in ROADMAP.md as evidence-backed but not accepted.
- **VARIANT.** `docs/VARIANTS.md` is the contract for reading and
  writing DuckDB `VARIANT` documents from SQL, Rip and the harbor REPL;
  the schema layer's `variant` field type is on main.
- **barcodes.** `packages/barcodes` is the QR half of paulmillr/qr
  0.7.0 ported to Rip plus original Code 128 and PDF417 readers. Its
  README Performance section is the current measurement (Apple M5, Bun
  1.4.0): `rip test/bench.rip` prints the README's rows verbatim;
  `rip test/corpus.rip` reproduces `test/corpus.txt` (924 reads of
  ZXing's 845, 0 false); `rip test/compare.rip` races ZXing
  (@zxing/library and zxing-wasm), qr 0.7.0, qr with upstream pull
  request 39, and this package against main, each cell as a speedup.
  Three probes under `test/` (`probe-stages`, `probe-pixels`,
  `probe-encode`) print one hash line per case so a change can be
  proved result-identical beyond the corpus counts; their main
  baselines are regenerated from a main checkout, not committed. The
  package has 46 tests and zero runtime dependencies (the two dev
  dependencies serve only the race). The scan demo at
  `packages/sites/demos/scan` (scan.via.rip) is its browser example
  and reads live from the camera.
- **Upstream.** Two pull requests from this work are open on
  paulmillr/qr: #39 (the decoder and encoder performance units, result
  identical) and #40 (a retry on the transposed grid for mirrored
  camera planes). Paul's repository requires verified signatures;
  commits there are SSH-signed from the fork at `misc/qr`.
- **Sites.** Shipped architecture is `docs/SERVER.md`; open items are
  in `packages/sites/TODO.md`. The demos (`hello`, `cart`, `pulse`,
  `scan`) are registered on this machine and run under the watcher.

## When blocked

From AGENTS.md: a missing decision gets options with a recommendation,
never a silent choice; a gate diverging inexplicably is a stop and
report; an acceptance criterion that seems wrong gets a proposed change,
never a quietly weaker test. Product decisions are the owner's; the
verdict "land" means merge as a true merge and delete the branch on
both sides.
