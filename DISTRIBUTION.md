# Distribution — open decision

> **Status: OPEN — needs Steve's call.** The packaging *mechanics* below are worked out; whether and how rip actually ships is not decided. This blocks publishing the VS Code extension.

## The question

How does rip reach a machine that doesn't have this repo cloned? Today it doesn't — there is no CLI distribution, and the VS Code extension's viability depends on one.

## Where things stand (verified)

- **The CLI is source-only.** Root `package.json` is `"private": true` at `"version": "0.0.0"`; there is no `npm publish`, no installer, no Homebrew formula, no release workflow, and no install instructions in the README. The only way to run rip today: clone the repo, `bun install`, run `./bin/rip`.
- **rip is Bun-first.** The README states rip "runs directly under Bun" — Bun is the target runtime, not an incidental toolchain host. Requiring Bun is therefore justified (the Deno model: rip users run on Bun by definition).
- **The CLI channel is half-declared.** Root `package.json` already has `bin: { "rip": "bin/rip" }`, so `bun install -g rip` / `bunx rip` is the natural install path — once the package is made publishable.
- **The extension today is self-contained.** It bundles its own LSP server (`packages/vscode/src/server.js`), spawns it with `bun` (`command: 'bun'` in `extension.js`), and the packaged vsix embeds the compiler (copied from the repo's `src/`) plus TypeScript 7 — including the native `tsgo` binary. That leaks two native dependencies into distribution: the **server host** (Bun, on the user's PATH) and the **tsgo binary** (`@typescript/typescript-<os>-<arch>`, a per-platform Go executable — `bun install` materializes only the build host's, so a vsix built on Apple Silicon carries only `darwin-arm64`, making full IntelliSense macOS/arm64-only). Syntax highlighting is grammar-only and works on every platform regardless; only the LSP features need Bun + tsgo.

## Why the CLI blocks the extension

The extension's distribution is *downstream* of the CLI's:

- The **thin-client** model (the leading candidate — mechanics below) has the extension spawn the toolchain's `rip lsp` from PATH, bundling nothing. It presupposes the developer has the rip toolchain installed, which currently has no install path.
- Even a **self-contained** extension would strand users: someone who installs it from the marketplace has no way to install the rip toolchain it front-ends.

So publishing the extension before the CLI is installable ships a dead end. **CLI distribution comes first, extension second.**

## How v3 did it (the precedent)

v3 (`rip-lang` 3.17.5) had a complete, working distribution story — worth keeping in view, because parts of it are a template and parts are what v4 traded away:

| | **v3** (`rip-lang` 3.17.5) | **v4** (this repo) |
| --- | --- | --- |
| **CLI** | published to npm — not private, versioned, `files` allowlist; `bun add -g rip-lang` | source-only — `private: true`, `0.0.0` |
| **Extension build** | esbuild-bundled to `dist/` (minified, `platform=node`) | unbundled — stages raw `src/` + `node_modules` |
| **Extension distribution** | hosted `.vsix` on GitHub Pages (`curl … shreeve.github.io/rip-lang/…/rip-latest.vsix`) + a `vscode-extensions.yml` workflow | one manual `vsce publish`; no workflow |
| **Type engine** | JS TypeScript — `ts.createLanguageService(...)`, `--external:typescript` | tsgo (native per-platform binary) |
| **Platform matrix?** | none — pure JS, cross-platform for free | yes |
| **Bun required?** | yes — `command: 'bun'` | yes — `command: 'bun'` |

Three things this settles:

1. **CLI distribution is a regression to recover, not a green field.** v3 already published `rip-lang` to npm; its root `package.json` — not-private, versioned, `files: [bin/, src/, docs/, …]` — is a working template for re-establishing the CLI channel.
2. **The platform matrix is self-inflicted by the tsgo move.** v3's JS-TypeScript engine had no native binary, so it shipped one universal cross-platform build. v4's per-platform problem exists *only* because v4 chose tsgo for speed — that cost is the bill for the bet, which makes the "not an option: JS TypeScript" tradeoff concrete: v3's free cross-platform vs tsgo's speed.
3. **The Bun requirement is inherited, not new.** Both v3 and v4 spawn `command: 'bun'`; requiring Bun was never a v4 regression — it's the settled Bun-first posture.

## What needs deciding

**1. Does rip get a CLI distribution, and through what channel?** npm/bunx (leveraging the existing `bin` field) is the natural fit for a Bun-first tool — but the root is a private monorepo *root*, not a shippable package, so making it publishable is real work: bundle `src/`, resolve the `catalog:` deps, and decide what "the `rip` package" actually contains (the same self-contained-copy problem `packages/vscode/scripts/package.js` already solves for the vsix). Alternatives: a `curl | sh` installer (Bun/Deno/rustup style), Homebrew, or a `bun build --compile` single-file binary (which reintroduces the per-platform native-binary problem).

**2. Once the CLI ships, is the extension a thin client or self-contained?**

- **Thin client** (the likely direction). A rip developer already has the toolchain — you can't compile or run rip without it — and the toolchain already carries **both** Bun *and* tsgo (tsgo is exactly what `rip check` drives). So the cleanest model mirrors the Deno extension's `deno lsp`: expose the server as an `rip lsp` subcommand on `bin/rip`, and have the extension spawn `rip lsp` from PATH instead of bundling anything. The extension becomes a pure thin client — no runtime, no native binary — and platform support becomes "wherever the toolchain runs." That dissolves both leaks at once: no Bun ask beyond "have the toolchain," and no per-platform tsgo packaging. Tradeoffs: the extension is inert without the toolchain (acceptable — the same prerequisite as using the language at all), it couples to the installed toolchain's version (a startup handshake/version check covers it), and it needs the `rip lsp` command added (delegating to the existing `server.js`).
- **Self-contained.** Keep bundling, and solve the two leaks directly: (a) move the server off Bun onto VS Code's bundled Node to drop the Bun requirement — a small port (`Bun.hash` → `node:crypto`, and the spawn changed to a Node-module transport); (b) ship platform-specific vsixes via `vsce package --target <os-arch>`, each bundling that platform's tsgo binary, all at one version, so the marketplace serves the right one per OS. More work than the thin client, and both parts become unnecessary under it.
- **Not an option: JS TypeScript.** v4 is built around out-of-process tsgo over the mirror faces; reverting to v3's in-process `LanguageService` (JS TypeScript) to sidestep the native binary would give up the performance that motivated the tsgo move (the `rip check` crossover, measured in the type-audit notes). The type engine is fixed; the platform question is solved within the tsgo model.

**Mechanism note — the CLI install *is* the platform fix.** tsgo's binaries are **os/cpu-gated optional dependencies** of `typescript@7` — 20 of them (`@typescript/typescript-<os>-<arch>`, each stamped with `os`/`cpu`, binary bundled, no postinstall). So `bun add -g rip` installs *only* the binary matching the user's machine, automatically — no rip logic; it's the standard npm/bun native-binary pattern (esbuild, swc, Prisma). The vsix needs a per-platform `--target` matrix only because it's a frozen artifact built once on one machine; an npm/bun-installed CLI picks the platform at *install* time, per user, and `tsgoBinaryPath()` (`@typescript/typescript-${process.platform}-${process.arch}`) finds exactly what the installer placed. So distributing the CLI doesn't merely *enable* the thin client — the package-manager mechanism is itself the fix for the tsgo platform problem.

**3. Timing.** Publishing is currently unscheduled. Is that deliberate (pre-1.0, not ready) or is distribution now on the table?

None of this needs code today. It needs a direction.

## Marketplace identity & versioning

The extension keeps the marketplace identity `rip-lang.vscode-rip`, display name "Rip Language": this is the next major version of the same product, so existing users auto-upgrade with settings intact. Version 4.0.0 continues the compiler's major line (this repo is v4), above the prior extension's 0.8.x — v3 shipped `vscode-rip@0.8.1` under the same identity, so a marketplace user upgrades 0.8.1 → 4.0.0.

The version lives in `packages/vscode/package.json`'s `version` field (plain semver); the marketplace requires each publish to increment it and never reuse a version, so a re-publish — e.g. to correct the stale repository link baked into the current 4.0.0 listing — needs a bump to 4.0.1+. `engines.vscode` (`^1.80.0`) is a separate number: the minimum VS Code, not the extension's own version.
