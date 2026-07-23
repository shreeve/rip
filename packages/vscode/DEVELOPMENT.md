# Rip VS Code extension — development

Internal notes for working on the extension itself. The user-facing marketplace page is `README.md`; this file is not bundled into the `.vsix`.

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

- **The project model:** the editor's TypeScript project is rooted in YOUR workspace. A mirror tree at `.rip/editor/` (self-gitignoring, regenerable — safe to delete any time; created lazily, so a session that never opens a `.rip` file touches nothing) holds the compiled TS face of every `.rip` file the program needs: the open buffers plus their transitive `.rip` imports, materialized on demand and PRUNED when files leave the closure — never a whole-workspace scan, and the program never outgrows what you have open. A generated tsconfig at the mirror root `extends` your `tsconfig.json` when you have one (your lib/target/strictness govern) and mimics an inferred project when you don't; `types: ["*"]` restores the classic visible-`@types` enumeration (TS 6/7 changed the default to none) unless your config — anywhere in its `extends` chain — sets `types` itself; `rootDirs` merges the mirror tree with your workspace, so `.rip` files can import your real `.ts` files too. Faces persist across restarts under a hash-keyed cache (`.cache.json`: source hash + generated-bytes hash + compiler-build hash — a compiler upgrade rebuilds everything, a restart recompiles only what changed, and corrupted mirrors are detected, never trusted). Recorded limits: the WORKSPACE-ROOT `tsconfig.json` governs (nested/solution configs are not supported); dynamic `import("./x.rip")` is followed only for static string literals (computed specifiers and `import!(...)` need a static `import` line); imports resolving outside the workspace are not materialized (a loud "closure truncated" log says so).
- Positions translate through MappingStore in both directions (`src/translate.js`): requests map Rip → generated TS (three flavors — lenient for hover, exact for symbol requests like definition/rename, cursor for completions/signature help — the settled rule), and results map back generated → Rip. Results and diagnostics whose generated span has no honest source mapping (injected runtime code) are dropped, never pinned to unrelated source. Results landing in files you never opened get their mappings by recompiling that file on demand (~0.1 ms, memoized, verified against the mirror tsgo answered from — the settled rule).
- While a buffer fails to compile, the parse diagnostic REPLACES the published diagnostics (positions from two buffer versions never mix) and the **last good compile** keeps serving hover — but only at positions that verifiably align with the last good text (common prefix/suffix of the two buffers; positions in the changed region answer null). If the TypeScript server dies, the Rip server restarts it once, then stays degraded (parse diagnostics keep working).
- The tsconfig posture: `noImplicitAny` stays ON — it activates the evolving-`let` inference that types UNANNOTATED hoisted declarations at read sites; annotated ones declare their real types in the face. The implicit-any diagnostic family stays suppressed per-code (`SUPPRESSED_TS_CODES`) because unannotated Rip is legal and idiomatic — with the face in place the suppression covers exactly that class and nothing else.
- Suggestion-class rendering (the rendering seam): the broker declares tagSupport in the pull-diagnostics slot, so tsgo delivers its own diagnostic tags — unused-declaration hints (TS6133 family) carry `Unnecessary` (VS Code fades the name, plain-TS rendering) and deprecation hints carry `Deprecated` (strikethrough) — with a fallback table mirroring TypeScript's own reportsUnnecessary/reportsDeprecated code sets for anything tsgo leaves untagged. Without the tag these hint-severity items draw a dotted underline that reads like a type error on legal Rip.
- Write-site hover on an unannotated local beats plain TS: tsgo's quickinfo answers `any` at an evolving let's declaration and write references (the inferred type manifests only at reads), so a hover answering exactly that shape triggers a references query and presents the first reference whose quickinfo answers a different declaration type — a read, by construction. Every step is a real LSP query against the face; with no reads anywhere (or an explicit `: any`, or an exported binding — exported lets never evolve) the original answer presents unchanged.

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

## Side-load the vsix

```sh
bun run ext rip cursor     # from the repo root: rip vscode | rip both
# equivalently, from this package: bun run install-cursor / install-vscode
```

Install logic is SHARED across the repo's extensions (`scripts/install-ext.mjs` at the root): the registry there maps PRODUCT names to package dirs (`rip` → `packages/vscode`; names are by product, never by directory). A future extension (e.g. `print`) registers itself by adding one registry line and keeping its own `package` script; its per-package `install-*` scripts are one-line delegates to the shared installer. Bare `bun run ext` prints the menu. `bun run package` here still builds the .vsix alone.

The staged package embeds the compiler from the repository's `src/` (version lockstep, the settled rule) and carries its own TypeScript — never the workspace's.

## Tests

Extension tests live ONLY in this package (the owner-ratified test boundary): `bun run test` here runs a preflight first that fails loudly if the tsgo binary is missing (run `bun install`), then the suite — which gates each live tsgo test on availability. The repository root's suite excludes `packages/**` mechanically (root `bunfig.toml`), so the compiler's fast loop never absorbs them; CI runs the two suites as separate steps.

## Distribution & publishing

How the extension (and the rip CLI it depends on) ships, the marketplace identity and versioning, and the open decisions around all of it live in one place at the repo root: [DISTRIBUTION.md](../../DISTRIBUTION.md). It's an open decision that needs owner sign-off, not a settled plan.
