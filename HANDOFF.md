# HANDOFF — session launch document (2026-08-07)

Read this first when starting a session. Permanent architecture lives in
`docs/`. Git history and pull requests retain completed-work detail.

## Orientation

- Repo: `~/Data/Code/rip` — mainline after src layout + test-lane split.
- Fast commands: `bun run test:rip` · `bun run test` · `bun run test:spawn`
  · package-local `bun run test` · `packages/browser-tests`: `bun run test:smoke`.
- Explicit certification: `bun run test:all` · `bun run audit` ·
  `packages/browser-tests`: `bun run test:cart`.
- Open notes: `TODO.md` · `packages/sites/TODO.md`.

## Layout (current)

Three host surfaces, separate graphs:

- **CLI / Bun** — `src/` + `src/cli/` (loader, run, repl, check, schema,
  migrate, explain, stackmap). Process entries live under `cli/`.
- **IDE / types** — `src/types/` (dts, typetext, schemas, components) plus
  `packages/vscode`. Browser stubs those modules at bundle time.
- **Browser** — `src/browser.js` → `dist/browser/rip.js` (+ min + br).
  In-page Rip→JS compile stays; no tsgo/ORM in the page.

Other root notes: `ops.js` and `config.js` stay as shared leaves;
`projections.js` stays beside `schema.js` (parse step would cycle if
folded); `dom.js` is the HTML/SVG vocab; language suite is `test/rip/`
(+ `test/rip.test.js`).

## Test lanes (current)

- `test/` in-process trees — default `bun run test` (file-parallel; no spawn).
- `test/spawn/{cli,sentinel,loader,tsc,bundle,repl}/` — process pins only;
  `bun run test:spawn` or the root lane of `test:all`.
- `test/audit/` — Philip’s editor scoreboard; `bun run audit` (untouched).
- Boundary gate: `test/toolchain/spawn-boundary.test.js`.

## Certification (live-verified this session)

- `bun run test` — 5892 pass (~4s).
- `bun run test:spawn` — 230 pass.
- Spawn boundary — clean outside `test/spawn|audit|support`.
- `test:all` / full audit not re-run on this exact candidate after the
  final script wiring; run before the next certification land if needed.

## Working agreements

- **Land** = merge green + delete feature branch.
- Shared branches catch up by merge, never rebase; never force-push.
- Pull requests land as true merge commits only (squash/rebase disabled).
- `main` ruleset requires PR jobs `test` + `browser`; no post-merge CI re-run.

## Testing cadence

1. Edit loop — smallest disproof (`test:rip`, `test`, package `test`, named spec).
2. Process seams — `test:spawn`.
3. Landing — freeze candidate; PR CI (`test` + `browser`) must be green to merge;
   `test:all` / cart only when explicitly certifying.
