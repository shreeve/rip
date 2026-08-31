# Hot Module Replacement

Rip HMR is the contract for updating a running App without discarding
developer context that is still valid. This document is the constitution:
what “world-class” means here, what the system does today, and where
further simplification still pays off.

Publication wire format and reconnect rules live in
[WORKSPACE.md](WORKSPACE.md). This file owns framework refresh and the
acceptance bars that prove it.

---

## The ideal

A save in watch mode should feel like **editing a living program**, not
restarting one.

Preserve everything that is still true after the edit:

- local reactive state and plain instance members (`:=`, props, and
  `_init` bindings such as `createMutation`);
- global stash values and the current route;
- focus, selection, and scroll;
- open UI that the edit did not invalidate;
- the **last-known-good** App when a candidate fails to compile or
  activate.

Fail loudly when preservation would lie. Prefer the narrowest honest
tier — patch, migrate, remount, or reload — never a silent wrong App.

That ideal is **not** “never touch the DOM.” It is **never destroy
meaning that still holds.**

---

## What patch is (and is not)

**Patch = state-preserving view remount.**

On a compatible edit the runtime:

1. keeps the living instance and its state containers;
2. does **not** re-run `_init`;
3. disposes the owner frame (effects and cleanups);
4. refreshes `~=` bodies and rebinds body `~>` effects
   (`_hmrRefreshComputeds` / `_hmrBindEffects` on hmr builds);
5. rebuilds the view through `_create` / `_setup`;
6. reinserts into a **connected** parent (never a spent staging
   `DocumentFragment`);
7. restores focus, selection, and scroll when recorded — focus by
   **locator** (the element's id, else its element path from
   `document.body`), never by node identity, because the rebuilt view
   replaced the focused node.

This matches the competitive bar set by React Fast Refresh: keep state,
swap implementation, re-render. It is **not** surgical DOM morph
(morphdom-style node reuse).

**Surgical DOM morph is not a goal.** Morph is optional UX polish
(flicker, caret edge cases). It does not define correctness and does not
win the Cart bars. Focus/selection/scroll restore plus a correct instance
are enough. Do not treat morph as unfinished destiny.

---

## Two layers

HMR has two owners. Confusing them is how good patch work dies after
commit.

```text
Layer A — Workspace publication
  watch → Manager confirms bytes → change {from,hash,list}
       → browser stage / compile / activate or quarantine

Layer B — framework refresh
  identity → signature → patch | migrate | remount → view
```

| Layer | Owns | Must not own |
|---|---|---|
| A | Complete App generations, ordered transport, LKG vs candidate, overlay | Instance state, DOM identity |
| B | Living components, signatures, effects, view rebuild | Publication hashes, Hub framing |

Rip owns language, compiler, runtime, renderer, router, and Sites, so
both layers share compiler-owned ids and metadata — never heuristic
scans of generated JavaScript.

---

## Competitive bars (the constitution)

Typing into a form field is a **weak** pin. The decisive surface is local
action state held across a rebuild, certified in
`test/browser/tests/live-hmr.spec.mjs` (`bun run test:live`).

### Gate A — local action-state (tie React / beat Vue)

1. Add an item; place the order → `placeOrder.succeeded` shows
   “Order Placed!” (`onSuccess` clears the cart).
2. Make a **render-only** edit to `app/routes/cart.rip` (stamp the h1).
3. Confirmation **stays**; the new heading shows; `rip:hmr` reports
   `patch`, not `remount`.

Failure mode: empty cart. The edit “worked” only after placing another
order — local action state was destroyed. Among React / Vue / Svelte /
Solid, only React Fast Refresh has been observed to survive this
sequence.

Mechanics: `placeOrder` is a plain `_init` member. **Patch** keeps it.
Any path that re-runs `_init` after `cart.clear()` makes the empty-cart
branch win. Migrate’s `__hmrPreserveState` copies `:=` signature slots
only — it does **not** preserve mutation objects. Do not sell
migrate-on-confirmation as the headline pin.

### Gate B — LKG-on-confirmation (ahead of React and Vue)

Same confirmation, then:

1. Break compile on `cart.rip` → overlay; LKG stays on confirmation and
   interactive.
2. Publish a good stamped edit → overlay clears; stamped confirmation
   remains; **no** document reload; **no** re-order.

This is the honest claim beyond React-tier local refresh: **App-hash
publication quarantine** while the last good App stays live. Not “faster
DOM than React.”

---

## How the system meets the ideal

### Layer A — publication

Defined in detail by [WORKSPACE.md](WORKSPACE.md). HMR-critical facts:

- Watch changes are ordered `from → hash` with Rip source inline;
  ordinary assets stay on HTTP.
- Manager may publish a candidate even when assemble/compile of the
  complete program fails: coherent **bytes** reach the browser so the
  client can quarantine. Validity is the browser’s job on the live path.
- Compile/activation failure: candidate hash is **rejected**, LKG App
  stays active, overlay shows, duplicate rejected delivery is ignored.
- A newer **live** generation after quarantine applies **in place**.
  When `change.from` is the rejected hash, the browser rebases the
  delta onto the living LKG. Walking back to the same LKG hash still
  clears overlay/quarantine.
- Reconnect that sees a still-newer `latest.json` (missed recovery while
  disconnected) reloads for a complete publication.
- `stash.rip` / `data.rip` **definition** edits request document reload.
  Runtime stash *value* updates never reload.
- CSS refreshes through HTTP identity; HTML and other managed assets
  reload.

### Layer B — refresh tiers

Compiler emits `__hmrId` / `__hmrSig` on module-scope components when
`hmr` is on (omitted in production). A process registry maps id →
definition, signature, living instances.

| Tier | When | Keeps | Rebuilds |
|---|---|---|---|
| **Patch** | Compatible implementation/render | Instance, `:=` / props, plain `_init` members | View + effects/computeds |
| **Migrate** | Compatible named-state shape change | Intersecting `:=` slots (diagnostics for kept/added/removed) | New instance on remount floor when patch cannot apply |
| **Remount** | Incompatible contract / forced dirty chain | Ancestors above the dirty boundary; stash; UI restore | Narrowest dirty route/layout suffix |
| **Reload** | Graph/runtime cannot isolate safely | Nothing in-page | Full document |

Every tier is chosen from signatures. No incompatible shape is silently
accepted. Tooling sees thin events: `rip:hmr` / `__hmrEvents()` for
`patch` | `migrate` | `remount` | `reject` | `noop` — `noop` names a
publication whose dirty modules have no living instance, so nothing on
the page was touched.

A dirty module accounts for itself through its living instances: the
ones in the mounted chain plus every registered instance under its id
prefix. Mounted instances patch, or fall to the floor when no patch can
carry them — incompatible signature, vanished definition, or an instance
that is not mounted (failed, or constructed and never mounted). A module
with no living instance contributes nothing — a helper reaches the page
only through importers, and the dirty set carries those — and a dirty
set that contributes nothing while the current route is the mounted one
is a `noop` (the Workspace commit still carries the source to the next
mount). When the current route is not mounted (its navigation failed and
the previous screen is up), nothing is idle: the floor mounts it. A path
the candidate still holds but did not compile is unaccounted for and
takes the floor.

### Couplings that must stay true

These are load-bearing invariants, not folklore:

1. **Content edits must not churn route identity.** After a successful
   Layer B patch, Workspace commit notifies route watchers and
   `router.rebuild()` refreshes the manifest. Rebuild **soft-skips**
   re-resolve when file, layout chain, and path are unchanged. Otherwise
   the renderer remounts the page and Gate A dies after a “successful”
   patch.
2. **Patch reinserts into a live parent.** Layout staging often mounts
   into a `DocumentFragment`; after commit that fragment is empty.
   `_hmrRerender` resolves a connected parent (`#content` / `#app`) and
   clears fragment `_target` values.
3. **Owner frames own effects.** Patch disposes the frame once, then
   rebinds. Effects never survive without their cleanup owner.
4. **Mode flags are zero-effect when off.** `hmr: false` production
   bytes omit HMR helpers and metadata.
5. **A patched layout reseats its descendants.** The layout's view is
   rebuilt with a fresh page slot, but the route below it is not the
   layout's child — its nodes still hang from the old, detached slot.
   Each chain entry records the slot it mounted into and how many
   children that slot already held; everything past that count is the
   entry's (its create-phase nodes and whatever its blocks mount —
   a top-level `for` puts rows *before* its anchor, so the entry's own
   nodes do not bound the range). After a chain patch the renderer
   re-resolves every slot from the chain root, moves each descendant's
   owned range into the live slot, and records that slot as the page
   mount point the next navigation commits into. The page keeps its
   instance, DOM, and state. A forced remount from a middle layout
   commits into the kept parent's outlet for the same reason.
6. **Focus restore is by locator, gated by identity.** The snapshot
   records how to find the focused element's successor (id, else
   element path from `document.body`) because the refresh replaces the
   node itself; a node-identity restore silently no-ops on every patch.
   The successor must carry the same tag, name, type, placeholder,
   aria-label, and (by path) the same value — otherwise a sibling that
   alone matches is taken, and nothing is focused when that is
   ambiguous. A wrong field is worse than a lost caret.

---

## Vocabulary

| Term | Meaning |
|---|---|
| live reload | Full page reload; the JavaScript heap is discarded |
| HMR | Replace modules without reloading the page |
| hot refresh | Framework-aware HMR that preserves compatible component state |
| patch | State-preserving view remount on a living instance |
| migrate | Preserve intersecting named `:=` slots across a replacement |
| remount | Replace the narrowest dirty subtree; keep ancestors |
| last-known-good (LKG) | Active successful App generation retained across a failed candidate |
| quarantine | Rejected candidate hash retained so recovery can rebase or ignore duplicates |
| signature | Compiler fingerprint selecting patch / migrate / remount |
| component definition | Stable identity (`module#Name`) whose implementation can swap |

---

## Transaction model

One multi-module update is one transaction:

1. Compile every changed module (complete candidate program).
2. Validate graph and signatures.
3. Stage namespaces and definition updates.
4. Snapshot UI (focus / selection / scroll) where refresh will touch the tree.
5. Apply deepest dependencies first (patch → migrate floor → remount).
6. Commit Workspace; soft-rebuild the router manifest without remounting
   an unchanged living match.
7. On failure before commit: roll back; keep LKG; overlay when appropriate.

The previous successful revision remains authoritative until commit.

---

## Required rejection and fallback

- incompatible component signature;
- failed compile or module evaluation;
- failed activation / gate validation;
- failed effect cleanup or setup that cannot leave a coherent tree;
- revision gap or stale client (reload);
- stash-module definition edit (reload);
- mounted route/layout deletion (reload);
- transaction rollback failure (reload if the document is not coherent).

Each case uses the narrowest honest tier. A failed update never destroys
the LKG App in place of a blank or silently wrong one.

---

## Test contract

Automated coverage includes:

1. ordered revisions, stale updates, reconnect catch-up;
2. compile failure with interactive LKG + overlay;
3. activation failure and rollback;
4. patch preserves instance and state containers; refreshes computeds/effects;
5. migrate diagnostics for kept / added / removed slots;
6. remount preserves parent / sibling / stash state;
7. effect cleanup and recreation exactly once;
8. focus, selection, and scroll restoration;
9. CSS update without JavaScript remount;
10. explicit full-reload fallback;
11. **Gate A** — confirmation survives render-only `cart.rip` edit via patch;
12. **Gate B** — LKG on confirmation; recover stamped heading in place;
13. a layout patch keeps the mounted route visible and the next
    navigation renders into the live slot;
14. focus and caret survive a render-only edit of the focused page;
15. an edit to an unmounted route is a `noop` — confirmation stays, and
    the route shows the new source when it mounts.

Browser behavior requires a real browser harness
(`test/browser`). Signature and registry decisions stay
deterministic unit tests (`test/ui/hmr-patch.test.js`,
`test/ui/hmr-ui-restore.test.js`, `test/toolchain/browser-boot.test.js`,
`packages/app` remount/apply/hmr-chain suites).

---

## Resolved decisions

- **Transport:** publication changes per [WORKSPACE.md](WORKSPACE.md);
  no `import.meta.hot` shim — compiler-owned accept/identity.
- **Patch DOM strategy:** state-preserving view remount; not morph.
- **Container identity:** owner-frame + declared key; never positional.
- **Type-fingerprint change:** remount; stable fingerprint may patch.
- **Route/layout identity:** same layout-chain identity navigation uses;
  content-only publication must not force page remount.
- **Stash definition vs values:** definition edit → reload; value
  updates → surgical reactive updates only.
- **Workspace noun:** module (path-keyed). Swappable UI identity:
  component definition.
- **Delivery:** complete Rip program in `bundle.json`; `latest.json` for
  reconnect; no public per-file hash inventory.

---

## Architectural constraints

- Generated HMR metadata never changes production semantics.
- Production output omits HMR-only metadata and transport code.
- Effects never survive without their cleanup owner.
- Component state never migrates by positional guesswork.
- Generated code is never scanned to reconstruct mapping or HMR facts.
- A failed update never destroys the last-known-good application.
- Invalid input and incompatible shapes reject loudly; silent
  mis-apply is the forbidden defect class.

---

## Inherent complexity vs seam compression

### Inherent (the problem’s mass)

Any serious system needs these *ideas*, whatever the spelling:

1. ordered App generations and LKG vs candidate;
2. classify: patch / migrate / remount / reload;
3. preserve instance + non-DOM state on the compatible path;
4. rebuild the view without re-running `_init`;
5. honest failure with an interactive previous App.

That mass does not disappear. Frameworks only hide it.

### Accidental (compress later)

The working system has discoverable scaffolding. A future architecture
pass — driven by the pins above as the constitution — can aim for:

```text
Apply  = classify → (patch view | remount subtree | reload) → done
Publish = stage complete App → browser accepts or quarantines
Router  = remounts on route-table identity change only;
          content applies never churn living match identity
```

Concrete compression candidates (open work, not a second product):

- **One quarantine disposition** — Manager publish fallback, feed
  `rejectedHash`, browser rejected set, and overlay clear-on-same-hash
  should collapse toward a single candidate state machine.
- **Router ignorance of content** — soft-skip in `rebuild` is correct;
  a sharper model makes content applies unable to request resolve at all.
- **One “owner frame + view rebuild” primitive** — fewer emitter scars
  (`_hmrBindEffects` / `_hmrRefreshComputeds` / staging `_target`
  special cases) without changing the patch contract.
- **Manager snapshot on assemble failure** — keep publishing coherent
  bytes; tighten error-tolerant import closure so the fallback path is
  as boring as the success path.

Rewrite from green pins and this document, not from memory. Seam
compression is justified when complexity hurts day-to-day work — not as
a morph project, and not as churn for its own sake.

---

## Status

| Concern | State |
|---|---|
| Publication substrate (Layer A) | Contracted in WORKSPACE.md; Sites + browser-boot |
| Signature classify + registry | Shipped |
| Patch (view remount + effect/computed rebind) | Shipped; certified |
| Migrate diagnostics + remount floor | Shipped; certified |
| LKG overlay + in-place recovery | Shipped; certified |
| Tier certification (`test:live`) | Every tier in this table, against `test/browser/hmr-app` |
| Surgical DOM morph | **Out of scope** as a goal |
| Seam compression | Optional later; see above — not blocking |

**Product HMR for the contracted bars is done.** Further work is
optional kitchen cleanup (fewer utensils), not a missing course. Morph
is not dessert we owe. Do not re-open this as ROADMAP product work
unless the Cart bars regress.
