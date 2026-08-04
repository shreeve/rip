# Rip Workspace

**Status:** living constitution — plan + backout charter. The **door is
the default** (Q10, 2026-07-29): every WATCHING manager-served browser
app runs through the Workspace; a production manager (watch off) serves
plain-booting pages — production has no hub (Q2). Apply excellence (hot
swap, state intact) remains open research. Not a completed HMR protocol.
Not a Janus capability.

**Name:** singular — `WORKSPACE.md`, one **Workspace**. The product is
one reactive bag of Rip components in the browser, not a catalog of
“workspaces.” Frozen revisions, when ratified, land as append-only
`docs/YYYYMMDD-HHMMSS-workspace.md`; this file stays the living pointer.

Owner rulings below are dated **2026-07-23** (Q1–Q5 locked) with
warm-collaboration polish **2026-07-24**, sequencing / store / freshness
rulings **2026-07-28** (Q6–Q9), the default ruling **2026-07-29**
(Q10), and the app-rails / watch-door amendment **2026-07-30** (Q8,
layout, hub, exemplar). Amend this document when a lock changes; do not
invent protocol detail that is still open research.

---

## What it is

The Workspace is a reactive collection of Rip component records in the
browser. The compiler, dependency graph, and runtime observe that
collection. Producers (first load, disk watch, later an editor or AI)
do not each own a private update path — they mutate the bag.

**Sacred rule:** everything that changes browser-executable code does
so by mutating the Workspace.

---

## Locked decisions (Q1–Q5)

| # | Ruling |
|---|---|
| **Q1** | Pure Rip. Projection (compiled JS / later WASM) is invisible. Production = sealed Workspace + Projection-cache hit by default. Signed Projection cells. CSP without `unsafe-eval` on the happy path. Janus = admission and (in watch mode) doorbell only — no Rip meaning at the edge. |
| **Q2** | Hub ding **only in dev/watch**. Production = no Hub. Hub never carries bodies; HTTP carries bytes. Ding envelope: `id` + Rip `hash` (+ optional `kind`); never source or Projection. The client self-joins `/hub`; Janus direct mode needs no API worker bridge. |
| **Q3** | **B′** — stable component id, path-derived at birth; path is a label; renames keep the id. |
| **Q4** | **C + research-first** — apply quality is measured against the written scenario suite (**S1–S15**) and automated tests; industry systems (Vite / Vue SFC HMR / React Fast Refresh) are **citations**, not a slogan stand-in. Reload is an escape hatch, never the marketed product. Not “done” until research + tests land. |
| **Q5** | **C** — M1 without RipFS/OPFS. Manager watches disk → Hub ding → HTTP → `Workspace.set`. OPFS/RipFS may arrive later as an optional backpack; they are never durable truth. |

### Passport (locked vs sketch)

**Locked**

- One passport **record type** (not three products).
- Integrity is a signed binding of
  `(id, sourceHash, compilerId, projectionHash)` under an atomic
  deploy manifest.
- Delivery packaging (whole archive, group, or single component) is
  **flexible**; the passport shape is not.

**Sketch** (fields amendable; include `compilerId` in the public side)

| Side | Fields (sketch) |
|---|---|
| **Public** | `id`, Rip `hash` / times, `sourceHash`, `compilerId`, `projectionHash` |
| **Private** | Rip `source` (optional in production), Projection bytes |

Production may omit source bytes and still keep `sourceHash`. Key
custody, rotation, and mismatch UX stay **open research**; a
stub / deploy-dev signer is enough for M0 happy-path proof. Hash-only
forever and “CSP later” are **rejected** as M0 rewrites.

### Rulings 2026-07-28 (Q6–Q9)

| # | Ruling |
|---|---|
| **Q6** | **M0 and M1 are independent exits.** M1 (the dev door) may land first under `RIP_WORKSPACE=1` with dev-mode in-browser compile; M0 (signed cells, CSP without `unsafe-eval`) gates **production populate** only and is unweakened. D6 reads: the dev door never leaks into production — flag off is unchanged and production has no Hub. |
| **Q7** | **The bag subsumes the app's component store.** The Workspace implements the `ComponentsStore` interface (`packages/app/components.rip`) as its app-facing view — path-keyed through the path→id map, passports underneath. `launch()` accepts an injected components store; flag off, it creates its own store exactly as today (D1). When the Workspace earns the default, `createComponents` retires and the bag is the only store. Two live stores of browser code never coexist. |
| **Q8** | **Module freshness is latest-wins.** The default client **bag** is membership `app/**/*.{rip,css,html}` (ids = birth paths). A ding carries `{id,hash}` where `hash = rash(bytes)`; it is a hint, not an address. The client fetches the ordinary latest URL with `cache: no-store`, computes the actual hash from received bytes, and uses an owner token so an older completion cannot overwrite a newer apply. Client verdicts are **`reload` \| `css` \| `update` \| `ignore`**. There is no App `409`, historical representation URL, or Rip hash implementation in Janus. |
| **Q9** | **Package shape confirmed.** `packages/workspace` and `packages/refresh` stay separate browser-side packages while experimental (kill switch #2); `packages/server` keeps only the muscles. If the Workspace earns the default, its merge destination is `packages/app`, never `packages/server`. |

### Ruling 2026-07-29 (Q10)

| # | Ruling |
|---|---|
| **Q10** | **The Workspace is the default watch door.** Every watching manager publishes stable `bundle.json` / `manifest.json` coordination files, sends dings through Janus, and lets Janus serve authored App bytes directly. Pooled workers are API-only. A watch-off App boots plain and has no development Hub feed. `@rip-lang/app` owns `workspace.rip`, `feed.rip`, `rash`, and browser apply meaning. |

The ledger and the bundle are one artifact: first paint fetches the
ledger (virtual `bundle.json`, each entry carrying its passport) into
`Workspace.populate`; live mutation fetches a single module generation
into `Workspace.set`. One record type, two package sizes — per the
flexible-packaging lock above.

### App rails and latest-wins door

| Topic | Locked |
|---|---|
| **Server entry** | `index.rip` (also accepted: `app.rip` — manager resolves both) |
| **Client tree** | `app/` + optional `app/index.html` SPA shell |
| **API source** | `api/` on disk → app-chosen public prefix (`/api` or `/v1`); SPA fallback never serves that prefix |
| **Static** | Multi-tenant: `sites/{slug}/public` then `sites/common/public`. Simple apps: `public/` (one fallback per app) |
| **Serve config** | Optional app-local `serve.rip`; strict `sites` + `files` normalization resolves paths to absolute Janus registration fields. Ordinary apps keep exact `hosts`. |
| **Edge** | Janus resolves `{site}`, tries tenant/common file roots, and proxies `proxyFirst` paths before static lookup. Rip semantics remain in Rip. |
| **Runtime JS** | Prefer CDN-pinned `rip.js` once the slice lands; until then `/@rip/rip.js` from the checkout is fine |
| **Hub** | `/hub` for workspace dings (client self-join; Janus direct admission) |
| **Full-shape exemplar** | [`examples/cart/`](../examples/cart/) — multi-route shop (SQLite first, then `@rip-lang/db` / DuckDB) |
| **Thin door demo** | [`examples/pulse/`](../examples/pulse/) — status board proving the Workspace door |

For tenant apps, the manager loads `serve.rip` beside the server entry
and POSTs `{name, site, files, upstreams}` to Janus. `site.host`
contains exactly one `{site}`; `site.dir`, `files.roots`, and
`files.shell` are absolute on the wire; `proxyFirst` becomes
`proxy_first`. Static prefixes, shared roots, and the shell must exist
at startup, while individual tenant child directories remain dynamic.
Janus supplies the selected tenant to the private worker as trusted
`Rip-Site`; the framework exposes only that value as `@req.site` and
does not derive tenant identity from the public request.

---

## Door vs apply

This split is the difference between a clean experiment and a mess.

| Layer | Meaning | Status |
|---|---|---|
| **Door** | Populate, seal, ding → HTTP → `Workspace.set` (passport mutates) | The **contract**. Ship and test this first. |
| **Apply** | How the running app absorbs a mutation (hot patch / remount / reload) | A **replaceable engine**. Research-first; discardable. |

**Door truth** = ding → HTTP → `Workspace.set` → passport mutation.  
**M1 acceptance** = that door under the flag, with a **UI-visible**
change so Probe 0 stays honest. Remount / reload may exist as an
**escape**, not as apply excellence and not as Vite-parity.  
**M1 acceptance is not** Vite-parity hot refresh.

Calling reload-based live update “HMR done” is rejected. Reload may
exist as an internal escape hatch; it never exits a milestone that
claims framework refresh.

*Workspace = passport bag + mutation door. Hot-apply excellence =
replaceable engine on top (a discardable `packages/app` module, Q10).*

---

## Ownership / packages

| Piece | Owner | Role |
|---|---|---|
| Workspace brain (passport bag, populate / set / seal, Projection use) | `packages/app` (`workspace.rip`) | Door + passport meaning |
| Feed (hub subscriber: ding → HTTP → set, resync, epoch reload) | `packages/app` (`feed.rip`) | The browser half of the door |
| Apply / refresh engine | future `packages/app` module (Q10) | Replaceable absorb policy; discardable |
| Muscles (disk watch, path→id map, generated bundle/manifest, dings) | `packages/server` | Thin feed for the bag |
| Edge files and Hub | Janus | Latest authored bytes, HTTP ETags, cache policy, and tiny invalidate notices |
| Constitution / ratifications | `docs/WORKSPACE.md` (+ timestamped snapshots later) | Plan and backout |

**Rule of thumb:** do not put the reactive bag inside `server` (server
owns reload smells). Do not put file watching inside the browser
packages (not the browser’s job). Do not invent Janus capability 7 for
this — Janus moves bytes and dings; Rip owns Workspace meaning.

---

## How we don’t make a mess

### Backout charter (Q10 — the door is the default)

The experimental kill switch (feature branch + separate packages +
`RIP_WORKSPACE=1`) served M1 and retired with Q10. What protects the
codebase now is architectural:

1. **The boot's `workspace` option is the seam.** A page without it
   boots plain, byte-identically (D1). The manager enables the door
   only when it writes the manifest and publishes the development feed.
2. **Door and apply stay separate kill criteria.** The door is default;
   apply excellence is not. The apply engine, when M2 research starts,
   is a discardable `packages/app` module developed against the
   S-suite — deleting it must stay cheap.
3. **Production sealed populate (M0)** may run once M0 exit holds.
   **No production live-mutate / apply** until refresh contract tests
   pass. Production has no hub (Q2) and a sealed workspace rejects the
   feed at the door.

### Forbidden invariants

Reject loudly if any of these appear:

- User-facing **JS dual reality** (teaching bundles/Vite as the product
  alongside Pure Rip).
- **Hub bodies** (source or Projection over the doorbell).
- **Janus capability 7** “sync/workspace” that owns Rip semantics.
- **RipFS / OPFS as truth** in M1 (or ever as durable authority —
  disk/git/CI remain durable truth; backpack is optional).
- Marketing **reload** as Hot Module Replacement.
- Fusing M1 exit criteria to **Vite-parity apply** (that kills
  discardability).
- Demoting Q1 to hash-only forever or “CSP later” as an M0 rewrite.

### Discipline checklist

- One sacred rule (code changes only via Workspace).
- One passport record type; flexible packaging, not three protocols.
- Prod = seal + Projection-cache hit; no compiler on the happy path;
  signed cells + CSP without `unsafe-eval` on that path.
- Dev = same model, door open, Hub ding only (`id` + Rip `hash`,
  optional `kind`).
- Spec here before a large package explosion.
- Present tense only; no “legacy compat” fog.

---

## Milestones

Honest exits. Do not promote a rung by renaming a weaker behavior.

### M0 — Populate

- Serve / fetch a ledger (manifest + files).
- Populate the Workspace; Projection-cache hit path works in prod.
- Seal in production (no post-populate mutation).
- Happy path **proves** Q1 constraints: signed Projection bindings and
  CSP without `unsafe-eval`. Stub / deploy-dev signer allowed; key
  custody / rotation / mismatch UX stay open research.

**Exit:** a sealed app loads and runs without a Hub connection and
without claiming live update — under those CSP/signed constraints.

### M1 — Live mutate (door)

- Dev/watch: manager sees disk change → Hub ding → HTTP fetch →
  `Workspace.set` → passport mutates → UI visibly updates.
- M0 is **not** a prerequisite (Q6): the door may land with dev-mode
  in-browser compile; production populate stays gated on M0.
- No RipFS/OPFS required.
- Apply may be coarse (even remount/reload *as escape*) so long as the
  **door** is real and tested — but the product surface must not call
  this “Vite-class HMR” or “HMR done.”

**Exit:** ding → HTTP → set → passport mutation → visible update. Not
Vite-parity. Not an S-suite claim. **Met 2026-07-29** — the door is the
default worker-mode path (Q10); apply remains the labeled remount
escape.

### Research apply track (parallel, discardable)

See **Research / apply** below. Industry deep dive + scenario suite
(**S1–S15**) land here first; then the apply module (in
`packages/app`, Q10) implements against the suite; iterate or delete.

**Exit:** automated suite green for the written Rip scenarios (industry
citations as evidence, not a vague “≥ Vite” slogan alone). Only then
may marketing say framework-quality live update; only then may
production live-mutate / apply turn on.

### Later — optional backpack

- OPFS / RipFS only if still useful after M1 + apply.
- Never durable truth; never required to explain Workspace.

---

## Research / apply

**Status:** research notes under Q4 — not a ratified invalidate
protocol, not an implementation spec. Door vs apply stays sacred:
this section informs the **replaceable apply engine**; it does not
change M1 door acceptance (ding → HTTP → `Workspace.set` → visible
update). M1 ≠ Vite-parity. Do **not** invent a complete Rip
invalidate / accept graph here.

Document what industry systems prove, what maps under locked Q1–Q5,
what remains open, and what experiment comes next.

### Industry lessons

#### Vite HMR (substrate)

Primary source: [Vite HMR API](https://vite.dev/guide/api-hmr).
Under-the-hood walkthrough: [Bjorn Lu — Hot Module Replacement is
Easy](https://bjornlu.com/blog/hot-module-replacement-is-easy).

| Mechanism | Lesson |
|---|---|
| `import.meta.hot.accept` | A module that accepts is an **HMR boundary**. Self-accept re-evaluates the module; dep-accept lets a parent absorb a child’s update without reloading itself. |
| `dispose` / `prune` | Dispose cleans side effects before replacement; prune cleans when a module leaves the graph (Vite uses this for CSS). |
| `invalidate` | A self-accepting module that cannot handle an update **re-propagates to importers** as if it were not self-accepting — not always an immediate full reload. Must still `accept` so future updates are heard. |
| `hot.data` | Small cross-revision bag for intentional carry; not a substitute for framework instance state. |
| Graph walk | From changed modules, walk **importers** looking for boundaries. Dead end at the root → **full reload**. Circular import paths force cautious client fallback. |
| CSS | Style updates are a separate soft path; they must not remount JS state. |
| Escape | Full reload is honest when no boundary contains the change (or activation fails). |

Rip takeaway: **substrate ≠ refresh**. Vite’s public API is module-graph
accept/dispose/invalidate. Framework excellence (Vue / React) sits on
top and chooses preserve / remount / invalidate. Rip’s apply engine
needs both layers eventually; M1 only needs the door that feeds new
Projection into the bag.

#### Vue SFC hot reload (component tiers)

Primary source: [Vue Loader — Hot
Reload](https://vue-loader.vuejs.org/guide/hot-reload.html). SFC
compiler intent: [vuejs/core `compiler-sfc`](https://github.com/vuejs/core/tree/main/packages/compiler-sfc)
(separate HMR for script / template / style).

| Edit surface | Industry behavior |
|---|---|
| **Template** | Re-render in place; **preserve** private instance state (render fn is treated as side-effect-free). |
| **Script** | **Destroy and re-create** instances of that component in place; sibling / ancestor state preserved. Script may carry impure lifecycle side effects; remount is the honest tier. |
| **Style** | Independent CSS path; **no** JS remount / state reset. |

Rip takeaway: a Rip component is closer to an SFC than to a raw ESM
file. Apply quality should tier by **edit kind** (markup / logic /
style / export shape), not only by “module changed.” Vue’s script
remount bar is a legitimate floor — not a failure — when logic/effects
change. Claiming “always preserve state across any script edit” would
exceed Vue’s own contract. First apply probe for S3 = **Vue remount
floor**; higher patch remains open.

#### React Fast Refresh (export-shape boundaries)

Primary sources: [React Native — Fast
Refresh](https://reactnative.dev/docs/fast-refresh); Vite React plugin
boundary behavior summarized in
[vite-plugin-react Fast Refresh](https://deepwiki.com/vitejs/vite-plugin-react/2.5-fast-refresh-implementation)
(export-only-components heuristic; class remount; export add/remove →
invalidate).

| Rule | Industry behavior |
|---|---|
| Module exports **only** components | Update module; re-render; **preserve** local Hook state when safe. |
| Module exports non-components too | Re-run that module **and importers**; if a non-React consumer sits on the chain → **full reload**. |
| Export shape breaks (add/remove incompatible export) | Boundary fails → invalidate / reload. |
| Class components | Remount (state not preserved). |
| Hooks | `useState` / `useRef` preserve when order/args stable; dependency Hooks **re-run** on refresh so edits appear. |
| Force remount | `// @refresh reset` (file-local). |
| Errors | Syntax / init errors keep last good modules; fix-and-save resumes; runtime errors inside render often remount. |

Rip takeaway: **export / passport public shape** is a first-class
refresh signal. Mixed “component + shared constant” modules are a
known industry footgun. Rip should prefer compiler-owned metadata over
capitalization heuristics (HMR.md agrees); the **scenario outcomes**
still match RFR’s ladder.

#### Other bundlers (one-line each)

| System | Distinct lesson |
|---|---|
| **webpack HMR** | Same accept/dispose/decline family; proves the substrate pattern predates Vite — boundaries are graph contracts, not a Vite trademark. |
| **Snowpack / Parcel** | Unbundled ESM + invalidate-to-reload reinforces: narrow update when a boundary accepts; otherwise reload. No new Rip-facing tier beyond Vite. |

### What maps to Rip (under locked Qs)

| Industry concept | Rip mapping (locked constraints) |
|---|---|
| Dev notify channel | **Hub ding only** in watch (Q2). Envelope: `id` + Rip `hash` (+ optional `kind`); **never bodies**. |
| File bytes | **HTTP** latest-wins fetch into `Workspace.set` (Q5 M1 / Q8). Not Hub payload. Not SSE body bus. |
| Module identity | Passport **B′** id, path-derived at birth; path is a label (Q3). |
| Compiled form | **Projection** invisible to authors (Q1); apply swaps Projection behind the passport. |
| Accept / invalidate graph | **Open research** for Rip — do not copy Vite’s `import.meta.hot` spelling; do not ratify a full protocol from this table alone. |
| Framework tiers | Apply ladder targets: preserve instance → remount component subtree → invalidate importers → full reload. Exact selectors = experiment + tests. |
| Production | **No Hub**, sealed Workspace, Projection-cache hit, signed cells, CSP without `unsafe-eval` (Q1/Q2). Apply research is a **dev** excellence bar until tests pass. |

Sacred split reminder: ding → set is **door**. Preserve/remount/reload
policy is **apply**. Shipping door with coarse apply is allowed for M1;
marketing framework-quality hot update is not.

### Rip-facing scenario suite

Targets are **quality bars** for the apply research track — not M1
exit criteria. Confidence: **industry** = clear parallel in Vite / Vue
/ RFR; **open** = Rip-specific until an experiment pins it. Q4’s bar is
this suite (**S1–S15**), with industry rows as citations.

| # | Edit kind | Expected apply quality target | Confidence |
|---|---|---|---|
| S1 | Leaf component **markup / render** only | Preserve instance state; re-render / reconcile | industry (Vue template; RFR render edit) |
| S2 | Leaf component **style** only | No JS remount; styles swap/prune cleanly | industry (Vue style; Vite CSS prune) |
| S3 | Leaf component **script / methods / effects** (signature stable) | First probe floor = **Vue script remount**; siblings preserved. Higher patch (HMR.md) remains **open** | industry floor = Vue remount; higher = open |
| S4 | Add/remove/rename **named state** slots | Migrate retained slots or remount component; never positional guesswork | open (HMR.md migrate tier; RFR preserves Hook state only when order stable) |
| S5 | Change **props / public contract** of a component | Remount that component; parents keep state | industry (incompatible boundary) |
| S6 | Change **exports** mixed with non-component values | Invalidate importers or remount consumers; full reload if non-UI root depends on it | industry (RFR export rules) |
| S7 | Edit **shared pure dep** imported by two components | Both consumers update; no full reload if a UI boundary accepts | industry (Vite dep-accept / RFR re-run importers) |
| S8 | Edit module with **no accepting UI boundary** up to root | Full reload (honest escape) | industry (Vite dead-end walk) |
| S9 | **Effect cleanup** ownership on replace | Outgoing effects dispose exactly once; no orphan timers/listeners | industry + Rip effect model (HMR.md) |
| S10 | **Compile failure** mid-edit | Last-known-good stays interactive; overlay; no bag corruption | industry (Vite error overlay; RFR redbox) |
| S11 | **Activation failure** after successful compile | Roll back apply; a passport hash advances only after successful activation. Mutation safety: a failed activation must not leave living instances half-applied. |
| S12 | **CSS-only** shared sheet | Page already linked the sheet (`<link href="/styles.css">`); ding cache-busts that same href (`?hash=`); no link → inject `<style>`; zero component remount; ding `{id,hash}` (extension → `css`) | industry (Probe 1 pin on cart) |
| S13 | Rename file on disk (**B′ id stable**) | Same component identity; apply continues against id not path | open (Q3; no industry twin) |
| S14 | Hub ding with a **stale / duplicate hash hint** | Ignore/coalesce duplicates; owner tokens prevent stale fetch completion from overwriting a newer apply | industry (door ordering) |
| S15 | Intentional **force remount** | Author/tooling can request remount without full reload | industry (`@refresh reset`) |

This suite is the falsifiable Q4 contract seed. Amend rows when
experiments falsify a target; do not silently weaken a row to pass a
demo.

### Recommended next experiments (not more docs)

Split door from apply. Do not invent a full HMR protocol.

#### Probe 0 — door

Watch → Hub ding → HTTP → `Workspace.set` → visible update.

- Coarse remount / reload-as-escape is OK.
- Exit = **M1 door** (met — Q10 made it the default).
- No S-suite claim. No “HMR done.”

Probe 0 observables (honesty bar, not a protocol):

| # | Observable |
|---|---|
| D1 | A plain boot without the `workspace` option → non-Workspace launch path unchanged |
| D2 | Disk change → Hub ding with `{id,hash}` as a freshness hint (no body) |
| D3 | Client strips the bag's `app/` id prefix, fetches the latest module bytes at the ordinary root URL with `cache: no-store`, and computes `rash(bytes)` |
| D4 | `Workspace.set` mutates the passport only after compile/activation succeeds (hash/source advance) |
| D5 | UI shows a visible change attributable to that mutation |
| D6 | Seal / no-Hub path still holds for production populate (M0) |
| D7 | Remount or reload, if used, is labeled escape — not apply excellence |

#### Probe 1 — apply

A discardable apply module in `packages/app` (Q10) against **S1, S2,
S3** (Vue remount floor), **S8, S10**. Stop before inventing full
accept/invalidate. If door and apply fuse, **delete the module**.

Records pass/fail against the suite in automated browser tests. Do not
fuse Vite-parity into M1 exit.

### Other open research (non-apply)

| Topic | Notes |
|---|---|
| **Compiler locus on miss** | Where compile-on-miss runs (worker? build-time only?) without forcing `unsafe-eval` on every prod visit. |
| **Signing keys** | Who holds deploy keys; rotation; mismatch / reject behavior. Stub / deploy-dev signer is enough for M0. |
| **Id birth registry** | How B′ ids are minted, persisted across renames, and collision-handled. |
| **Cold-start budget** | Numbers for Projection-cache miss vs hit — measure, then pin. |
| **Apply selectors** | Exact signature / export / graph rules that choose preserve vs remount vs invalidate vs reload — **evidence from Probe 1**, not invented here. |
| **Door vs activation ordering** | Whether `Workspace.set` commits passport before or after successful apply (S11); mutation safety on failed activation. |

When research answers an item, amend this section or ratify a
timestamped snapshot. Do not silently “fill in” protocol in code first.

---

## Relation to HMR.md / v3 / ROADMAP

- **[HMR.md](HMR.md)** — historical **design aspiration** for Layer B
  (identity, signatures, patch / migrate / remount, transactional
  activation) and a substrate sketch. **What it still gets right:**
  door-vs-refresh split in spirit (Layer A vs B); last-known-good;
  effect cleanup ownership; CSS without JS remount; compiler-owned
  metadata over scanning generated JS; phased honesty (Phase 0 must
  not claim state-preserving HMR). **What it conflates / conflicts
  with locked Q1–Q5:** “Resolved decisions” that put **update bodies
  inline on a bidirectional WebSocket** and treat that channel as the
  product transport — that contradicts **Q2** (Hub ding only; HTTP
  carries bytes) and the Workspace door. Those transport rows are
  **superseded** for Workspace work; do not implement Hub bodies to
  satisfy HMR.md. Rip-native API (no `import.meta.hot` shim) remains
  compatible with Q1. Full accept/invalidate protocol detail in HMR.md
  is **not** ratified apply law until the scenario suite and Probe 1
  say so.
- **Workspace** owns the mutation **door** — populate, set, seal, ding,
  passport integrity. **Apply** (refresh) decides how living instances
  adopt a mutation; it stays a discardable engine under Q4, landing as
  a `packages/app` module when its research starts (Q10).
- **v3** (JSON source bundle + SSE → `location.reload`) is historical
  reference only. It proves a coarse door+reload escape; it is not
  this product. Workspace is greenfield: passport bag + door +
  researched apply — not “port the v3 watch bus and call it done.”
- **[ROADMAP.md](ROADMAP.md)** Browser delivery already follows **Q2**
  for Workspace door work (Hub ding, HTTP bytes). HMR.md’s
  inline-WebSocket payload rows remain superseded. ROADMAP’s deferred
  CSP-clean precompile (non-Workspace delivery leaning) does **not**
  override Workspace **M0** for the Workspace path — M0 still requires
  signed cells + CSP without `unsafe-eval` on the happy path.
- **[FRAME.md](FRAME.md)** HMR coordination (fragment vs refresh
  transactions) stays downstream of a real apply engine; no change
  required until apply exists.
- Production has **no realtime code channel by design** (Q2). Sealed
  Workspace populate (M0) may run in production once M0 exit holds;
  live-mutate / apply stay off until refresh contract tests pass. Do
  not sneak SSE or Hub into sealed prod “for convenience.”

---

## Philip-facing one-liner

> Authors live in Pure Rip; the machine may cache and run compiled
> forms invisibly; production is sealed and fast; development is the
> same world with the door unlocked — and every code change walks
> through the Workspace.

---

## Document hygiene

- Update this file when Q1–Q10 or the backout rules change.
- Amend **Research / apply** when scenario rows or industry citations
  change; do not grow a second constitution unless this file becomes
  unreadable.
- Ratify major revisions as timestamped docs; leave this as the index.
- Cross-links: [HMR.md](HMR.md) (refresh aspiration),
  [ROADMAP.md](ROADMAP.md) (open work). No Janus capability page for
  Workspace.
