# HANDOFF — session launch document (2026-08-03)

The tracked session launch document (see AGENTS.md, working ledgers): read it
first when starting a session; rewrite it at session boundaries with
live-verified facts only.

## Orientation

- Repo: `~/Data/Code/rip` — the live v4 checkout.
- Commands: `bun run test:all` · `bun run test` · `bun run audit`.
- Permanent server architecture: `docs/SERVER.md`.

## Active branch

**Branch: `main`, synchronized with `origin/main`.**

The current tip carries the local Rip appliance and its native client:

- `rip app` remembers and supervises Rip projects through the per-user agent.
- `rip edge` owns or observes the shared Caddy + Janus edge.
- Inline `try expression finally expression` is grammar-owned and available to
  authored Rip, with every editor/print surface pinned.
- `@rip-lang/tray` builds native macOS menu-bar apps whose complete panels and
  callbacks are authored in Rip. The reusable SwiftUI host renders one
  Apple-style window popover and returns actions; it contains no Rip Server
  policy.
- The panel stays deliberately flat: a compact branded header, one row per
  group/app, secondary status text, contextual icon controls, hairline
  dividers, native hover feedback, and bounded scrolling. It does not nest
  decorative cards.
- Tray icons accept SF Symbol strings, inline `svg` values, and file-backed
  `svgFile` values. SVGs are adaptive macOS template images by default;
  `template: false` preserves full color. A separate `logo:` can brand the
  panel header.
- `packages/tray/assets` carries the full-color Rip logo and compact monochrome
  menu-bar mark. The built-in Rip Apps tray uses both; the status mark renders
  at the visually verified 24-point size.
- `rip-tray provider.rip --name NAME --identifier ID --output PATH` creates an
  independently named, ad-hoc-signed `.app`. The package's executable
  `tray.rip` mode is the Rip Apps client for `rip app` and `rip edge`.

Live verification for the tray panel cleanup:

- `bun run test` — 6,128 passed, 35 extended-tier skips.
- `packages/tray`: 12 tests passed. The Swift package built on macOS and its
  protocol executable passed ten native model/SVG checks.
- `bun run test:all` — all 22 lanes passed, 8,359 tests total.
- `packages/tray/dist/Rip.app` was rebuilt, its ad-hoc signature and copied SVG
  bytes were verified, the open panel was visually inspected at native Retina
  resolution, and the app plus embedded provider are running. The build
  directory is ignored.
- `packages/browser-tests` remains the documented CI-only Playwright lane.
- `git diff --check` — passed.

## Next tray work

The framework and Rip Apps panel are usable now. `rip-tray` still builds one
self-contained `.app` per provider; the agreed packaging follow-up is to make
one installed generic host the primary path and launch multiple provider files
through separate instances of that same binary. Native launch-at-login control
and a dedicated log window follow. Those features should extend the same
Rip-owned panel protocol; Rip Server and the SwiftUI host must not grow
competing lifecycle logic.

## Working agreements

- **Land** = merge green + delete feature branch.
- PRs: TRUE MERGE only. No AI attribution.
