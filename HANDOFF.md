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

The current tip carries the local Rip appliance and its first native client:

- `rip app` remembers and supervises Rip projects through the per-user agent.
- `rip edge` owns or observes the shared Caddy + Janus edge.
- Inline `try expression finally expression` is grammar-owned and available to
  authored Rip, with every editor/print surface pinned.
- `@rip-lang/tray` builds native macOS menu-bar apps whose complete menus and
  callbacks are authored in Rip. The reusable SwiftUI host only renders the
  strict Rip protocol and returns actions.
- `rip-tray provider.rip --name NAME --identifier ID --output PATH` creates an
  independently named, ad-hoc-signed `.app`. The package's executable
  `tray.rip` mode is the Rip Apps client for `rip app` and `rip edge`.

Live verification for the tray commit:

- `bun run test` — 6,128 passed, 35 extended-tier skips.
- `bun run test:all` — all 22 lanes passed, 8,357 tests total; the new
  `packages/tray` lane ran 10 tests.
- The Swift package built on macOS and its protocol executable passed four
  native checks.
- `packages/tray/dist/Rip.app` was built, its plist and ad-hoc signature were
  verified, and the app launched its embedded Rip provider successfully. The
  build directory is ignored.
- `packages/browser-tests` remains the documented CI-only Playwright lane.
- `git diff --check` — passed.

## Next tray work

The framework and Rip Apps tray are usable now. Product follow-ups are native
launch-at-login control, a dedicated log window, and visual polish. Those
features should extend the same Rip-owned menu protocol; Rip Server and the
SwiftUI host must not grow competing lifecycle logic.

## Working agreements

- **Land** = merge green + delete feature branch.
- PRs: TRUE MERGE only. No AI attribution.
