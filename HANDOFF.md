# HANDOFF — session launch document (2026-07-30)

The tracked session launch document (see AGENTS.md, working ledgers):
read it first when starting a session; rewrite it at session
boundaries with live-verified facts only.

## Orientation

- Repo: `~/Data/Code/rip` — the live v4 checkout.
- Commands: `bun run test:all` · `bun run test` · `bun run browser-bundle`.

## Active branch

**Branch: `server-app-api-architecture`** (from `main` / `01328d5`).

Apply verdicts are **`reload` | `css` | `update` | `ignore`**.
The app tree is the serve root: the page links its sheet
(`<link href="/styles.css">`); a CSS ding cache-busts that link
(`?etag=`). No matching link → inject `<style>`. `*.css` never maps
to `reload`.

## Door doctrine

1. Bag = membership (`app/**/*.{rip,css,html}`).
2. Hub dings `{id,etag}` only.
3. Client: reload | css | update | ignore.
4. One path per file the page already uses — no second CSS URL.

## On main

- #194 Probe 1 · #195 cell→file · #196 CSS soft-apply · #197 bag HTML

## Working agreements

- **Land** = merge green + delete feature branch.
- PRs: TRUE MERGE only. No AI attribution.
