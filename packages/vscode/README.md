# Rip for VS Code 

Rip language support built on the Rip compiler: syntax highlighting
plus a full LSP feature set that lands on `.rip` source through the
compiler's MappingStore, brokered to the TypeScript 7 native LSP server
(`tsgo`).

Status: the settled scope — **the full editor experience over the TS
emission face and the workspace project model**:

- **Hover** and **diagnostics** , positioned on Rip
  source, declared types included.
- **Completions** with lazy resolve; **auto-import** from any file in
  the program — the inserted import is idiomatic Rip (no semicolon,
  `.rip` specifier), whether it is a new line or a name merged into an
  existing clause, and it never separates a `# @ts-…` directive from
  the line it governs (a new import goes above the directive; below a
  file-level `# @ts-nocheck`). Compiler scaffolding (the `__` runtime,
  `_ref` temps) never appears as items; TS-face spellings (the
  definite-assignment `!`, mirror `.rip.ts` paths) are scrubbed from
  what you see.
- **Go-to-definition**, **type definition**, and **implementation** —
  same file, across files (including files you never opened), and into
  real `.ts`/`.d.ts` targets (those open as-is).
- **Signature help**, with correct active-parameter tracking across
  `def` overload signatures.
- **Semantic tokens** (full and range) on Rip positions — annotation
  types are tokens too; generated-only bytes produce none.
- **Find references** across the program, unopened files included.
- **Rename** with `prepareRename` — cross-file edits reach unopened
  files; a hoisted declaration renames as one edit; anything that cannot be mapped or verified refuses the WHOLE
  rename with a message — never a partial application.
- **Code actions**: quickfixes (auto-import) plus the `source.*`
  family — organize imports, remove unused imports, sort imports, fix
  all. Import-block rewrites keep YOUR bytes: a reorder
  or removal re-uses your own import lines — quotes, no semicolons —
  a narrowed or combined clause keeps your quote style on the
  specifier (only the clause itself changes), and an action that
  would touch bytes the rewrite cannot verify (an import line
  carrying a trailing comment) drops rather than applying wrong.
- **Outline** (document symbols) and **workspace symbol search**, on
  Rip positions — one symbol per declaration (hoist lines and
  same-name type companions collapse); injected-runtime names never
  appear.
- **Inlay hints** (parameter names, inferred types), governed by your
  own `typescript.inlayHints.*` settings — `.rip` files behave exactly
  like `.ts` files (all hint classes default off, exactly as VS Code
  ships them); hints sourced from compiler scaffolding drop.
- **Document links**: relative paths in comments are clickable
  (`# see ../NOTES.md#section-3`), driven by the compiler's comment
  records — a string literal that looks like a path is code and never
  linkifies.
- **Formatting** is out of scope, deliberately:
  the TypeScript server formats the generated face, and those edits
  cannot map back to Rip honestly; a Rip formatter is a language-level
  design question, not a broker feature.

Honest scope notes: references, rename, auto-import,
and workspace symbol search see the ACTIVE PROGRAM — the files you
have open plus everything they transitively import. A workspace file
nothing reaches is not searched and not offered for auto-import until
something in the program imports it (or you open it). And while a buffer has a parse error, features
serve from the last good compile only at positions that verifiably
align (see the staleness section below); a rename that would touch a
broken buffer refuses.

## Architecture

```
VS Code ── vscode-languageclient ── src/extension.js   (thin shell, CJS)
                │ stdio
        src/server.js on Bun        (the Rip language server)
                │  compiles each .rip buffer via the compiler's
                │  TS FACE (compile face: 'ts' — the settled rule; never
                │  a shipping surface, gated byte-equal to JS mode
                │  after type-stripping)
                │  maintains <workspace>/.rip/editor/ — the mirror
                │  tree: the import closure's TS faces on disk, open
                │  buffers overlaid via didOpen
                │ stdio (LSP, src/tsgo.js)
        tsgo --lsp --stdio          (typescript@7, the pinned dependency)
```

- **The project model:** the editor's TypeScript project is
  rooted in YOUR workspace. A mirror tree at `.rip/editor/`
  (self-gitignoring, regenerable — safe to delete any time; created
  lazily, so a session that never opens a `.rip` file touches nothing)
  holds the compiled TS face of every `.rip` file the program needs:
  the open buffers plus their transitive `.rip` imports, materialized
  on demand and PRUNED when files leave the closure — never a
  whole-workspace scan, and the program never outgrows what you have
  open. A generated tsconfig at the mirror root `extends` your
  `tsconfig.json` when you have one (your lib/target/strictness
  govern) and mimics an inferred project when you don't;
  `types: ["*"]` restores the classic visible-`@types` enumeration
  (TS 6/7 changed the default to none) unless your config — anywhere
  in its `extends` chain — sets `types` itself; `rootDirs` merges the
  mirror tree with your workspace, so `.rip` files can import your
  real `.ts` files too. Faces persist across restarts under a
  hash-keyed cache (`.cache.json`: source hash + generated-bytes hash
  + compiler-build hash — a compiler upgrade rebuilds everything, a
  restart recompiles only what changed, and corrupted mirrors are
  detected, never trusted). Recorded limits: the WORKSPACE-ROOT
  `tsconfig.json` governs (nested/solution configs are not
  supported); dynamic `import("./x.rip")` is followed only for static
  string literals (computed specifiers and `import!(...)` need a
  static `import` line); imports resolving outside the workspace are
  not materialized (a loud "closure truncated" log says so).
- Positions translate through MappingStore in both directions
  (`src/translate.js`): requests map Rip → generated TS (three flavors
  — lenient for hover, exact for symbol requests like
  definition/rename, cursor for completions/signature help — the settled
  design), and results map back generated → Rip. Results and diagnostics
  whose generated span has no honest source mapping (injected runtime
  code) are dropped, never pinned to unrelated source. Results landing
  in files you never opened get their mappings by recompiling that
  file on demand (~0.1 ms, memoized, verified against the mirror tsgo
  answered from — the settled rule).
- While a buffer fails to compile, the parse diagnostic REPLACES the
  published diagnostics (positions from two buffer versions never mix)
  and the **last good compile** keeps serving hover — but only at
  positions that verifiably align with the last good text (common
  prefix/suffix of the two buffers; positions in the changed region
  answer null). If the TypeScript server dies, the Rip server restarts
  it once, then stays degraded (parse diagnostics keep working).
- The tsconfig posture:
  `noImplicitAny` stays ON — it activates the evolving-`let` inference
  that types UNANNOTATED hoisted declarations at read sites; annotated
  ones declare their real types in the face. The implicit-any
  diagnostic family stays suppressed per-code (`SUPPRESSED_TS_CODES`)
  because unannotated Rip is legal and idiomatic — with the face in
  place the suppression covers exactly that class and nothing else.
- Suggestion-class rendering (the rendering seam): the broker declares
  tagSupport in the pull-diagnostics slot, so tsgo delivers its own
  diagnostic tags — unused-declaration hints (TS6133 family) carry
  `Unnecessary` (VS Code fades the name, plain-TS rendering) and
  deprecation hints carry `Deprecated` (strikethrough) — with a
  fallback table mirroring TypeScript's own
  reportsUnnecessary/reportsDeprecated code sets for anything tsgo
  leaves untagged. Without the tag these hint-severity items draw a
  dotted underline that reads like a type error on legal Rip.
- Write-site hover on an unannotated local beats plain TS: tsgo's
  quickinfo answers `any` at an evolving let's declaration and write
  references (the inferred type manifests only at reads), so a hover
  answering exactly that shape triggers a references query and
  presents the first reference whose quickinfo answers a different
  declaration type — a read, by construction. Every step is a real
  LSP query against the face; with no reads anywhere (or an explicit
  `: any`, or an exported binding — exported lets never evolve) the
  original answer presents unchanged.

## Requirements

- **Bun** on PATH (the server runs on Bun — the settled rule).
- Dependencies installed in this package: `bun install` in
  `packages/vscode` (the dependency budget: `typescript` 7.x pinned,
  `vscode-languageclient`, `vscode-languageserver`,
  `vscode-languageserver-textdocument`).

## Run it (extension development host)

1. `bun install` in `packages/vscode`.
2. Open the **rip repository** in VS Code.
3. Run and Debug → add (or use) a launch configuration:

```json
{
  "type": "extensionHost",
  "request": "launch",
  "name": "Rip extension",
  "args": ["--extensionDevelopmentPath=${workspaceFolder}/packages/vscode"]
}
```

4. F5, then open any `.rip` file in the development host window.

## Or side-load the vsix

```sh
bun run ext rip cursor     # from the repo root: rip vscode | rip both
# equivalently, from this package: bun run install-cursor / install-vscode
```

Install logic is SHARED across the repo's extensions
(`scripts/install-ext.mjs` at the root): the registry there maps
PRODUCT names to package dirs (`rip` → `packages/vscode`; names are
by product, never by directory). A future extension (e.g. `print`)
registers itself by adding one registry line and keeping its own
`package` script; its per-package `install-*` scripts are one-line
delegates to the shared installer. Bare `bun run ext` prints the
menu. `bun run package` here still builds the .vsix alone.

The staged package embeds the compiler from the repository's `src/`
(version lockstep, the settled rule) and carries its own TypeScript — never the
workspace's.

## What to expect (manual verification shape)

Cross-file (the settled project model): open only `app.rip` from a folder
that also contains `util.rip` (`export answer = 42`):

```coffee
import { answer } from './util.rip'
oops = answer.toUpperCase()
```

- The import resolves (no TS2307) even though `util.rip` was never
  opened — its face materialized on demand.
- One diagnostic on `answer.toUpperCase` — TS2339 — the imported
  value's real type flowed across the file boundary.
- Hover `answer` → the dependency's type, positioned on your source.
- Go-to-definition on `answer` → `util.rip` opens at the declaration.
- Rename `answer` at its declaration (open `util.rip`) → the importer
  is edited too, unopened or not; F2 on a comment refuses.
- Delete the import line, type `answer` and accept the completion →
  `import { answer } from './util.rip'` is inserted, Rip-spelled.
- `editor-gaps/manual-repro/` has a ready-made F5 fixture for the
  cross-file walk-through (plus the tsconfig/@types checks);
  `spikes/demo-features.mjs` is the scripted twin that drives EVERY
  feature over LSP stdio.

Single-file: open a `.rip` file such as:

```coffee
greeting = "hello"
count: number = 42
sum = (a, b) -> a + b
bad = count.toUpperCase()
```

- Hover `count` inside `count.toUpperCase()` → `let count: number`
  (the declared type, on Rip source). Hovering the DECLARATION/write
  site (`count` on line 2) also reads `let count: number` — the TS
  face types the hoisted declaration from the annotation (the
  hoisted-`any` gap, closed). Unannotated declarations still read
  their evolving-`let` inference at use sites and `any` at the write
  site — Rip knows no type there and the face never invents one.
- One diagnostic on `count.toUpperCase` — TS2339
  (`Property 'toUpperCase' does not exist on type 'number'`) — positioned
  on the Rip expression, not on generated JS.
- Assign against the annotation (`count = "nope"`) → TS2322
  (`Type 'string' is not assignable to type 'number'`) on the Rip
  line — annotation violations are real diagnostics now.
- Break the syntax (`sum = (a,`) → a `rip`-sourced parse diagnostic
  replaces the TS diagnostics; hover keeps answering from the last good
  compile wherever the surrounding text is unchanged (positions on or
  around the edited region answer nothing rather than something wrong).

## Grammar note (the old runtime port)

`syntaxes/` is ported whole from the old runtime. `component`/`render`
blocks compile for real now (the render gates landed), and the editor
face covers them: component members type at every site (hover answers
on props, state, computed, and `accept` members), a real violation
inside a render block diagnoses on the user's own expression span, and
prop completions and prop-key hover work at a child-component call
site — all exercised by this package's tests. The `|>` pipe operator
is the one highlighted construct the compiler does not compile yet
(deliberately deferred); it stays in the grammar on purpose —
highlighting costs nothing, keeps old-runtime source readable, and
deleting it would be churn against a known-coming wave. The old runtime's
`semanticTokenTypes`/`semanticTokenScopes` manifest contributions are
deliberately NOT ported: the server's semantic-tokens legend is tsgo's
own, and every type in it is a standard VS Code token type — themes
color them without custom contributions.

## Tests

Extension tests live ONLY in this package (the owner-ratified test
boundary): `bun run test` here runs a preflight first that fails loudly
if the tsgo binary is missing (run `bun install`), then the suite —
which gates each live tsgo test on availability. The repository
root's suite excludes `packages/**` mechanically (root
`bunfig.toml`), so the compiler's fast loop never absorbs them; CI
runs the two suites as separate steps.

## Marketplace identity

The extension keeps the marketplace identity `rip-lang.vscode-rip`, display
name "Rip Language": this is the next major
version of the same product, so existing users auto-upgrade with
settings intact. Version 4.0.0 opens the compiler's major line above the old runtime's
0.8.x. Publishing is not scheduled in this phase; per-platform
packaging (the vsix embeds the platform tsgo binary) is the
remaining publish-time work.
