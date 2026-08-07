# Hot Module Replacement

This document defines Rip's HMR architecture and behavioral contract.
It is a design specification; implementation proceeds only through the
dependency-ordered phases and acceptance tests below.

## Goal

Rip HMR updates running applications while preserving every compatible
piece of developer context:

- local reactive state;
- global stash and route;
- focus, selection, and scroll;
- open UI state;
- the last-known-good application after compile or activation failure.

An incompatible edit remounts the narrowest affected subtree. Full-page
reload is a fallback, not the default once framework refresh exists.

## Vocabulary

| Term | Meaning |
|---|---|
| live reload | full page reload; the JavaScript heap is discarded |
| HMR | replace modules without reloading the page |
| hot refresh | framework-aware HMR that preserves compatible component state |
| dev substrate | watcher, graph, transport, module delivery, CSS, overlay, fallback |
| framework refresh | identity, signatures, state migration, effects, DOM reconciliation |
| boundary | module/component that accepts an update |
| component definition | stable component identity whose implementation can swap |
| signature | structural fingerprint used to select patch, migrate, or remount |
| last-known-good | the active successful generation retained across a failed update |
| transactional activation | stage, validate, swap atomically, and roll back on failure |

## Current baseline

The publication substrate (Layer A) is defined by
[WORKSPACE.md](WORKSPACE.md): initial `bundle.json`, ordered
`change {from,hash,list}` messages in watch mode, and reconnect recovery through
`latest.json`. Rip Sites produces that protocol and Rip App consumes it.

Watch-mode delivery also ships:

- a compile/activation failure overlay that leaves the last-known-good App
  interactive underneath;
- compiler-emitted `__hmrId` / `__hmrSig` on module-scope components (omitted
  when `hmr` is off);
- a living-instance registry and signature classify (`patch` | `migrate` |
  `remount`);
- patch of living instances when signatures allow; otherwise narrow remount
  of the affected route/layout chain with focus/selection/scroll restore;
- stash-module / `data.rip` definition edits request a document reload
  (runtime stash *value* updates stay surgical and never reload).

Migrate that cannot patch in place still uses the narrow remount floor while
preserving intersecting named state where the remount path constructs a
replacement. Graph-quality hardening continues under Phase 5.

## Two-layer architecture

HMR has two independent owners:

```text
Layer A — Workspace publication (dev substrate)
watch → Manager confirms bytes → change {from,hash,list} → Workspace transaction
                         │
                         ▼
Layer B — framework refresh (apply engine)
identity → signature → patch/migrate/remount → effects → DOM
```

Layer A mutates the active module Workspace. Layer B decides whether living
instances can adopt the mutation. Rip source may ride in a watch-mode change;
ordinary asset bytes remain on HTTP.

Rip owns the language, compiler, runtime, renderer, router, and server,
so both layers can share stable ids and compiler-produced metadata
without heuristic source transforms.

## Layer A contract

### Module graph

The active Workspace records canonical Rip module paths, source, compiled
modules, and one complete Manager-declared App hash. Per-file hashes remain
private to Manager. Dependency and acceptance metadata needed for finer HMR
belongs to the compiler/module graph rather than the publication wire format.

### Update protocol

```text
save
  → compile changed source
  → retain old revision on failure
  → invalidate changed graph nodes
  → find accepting boundaries
  → send ordered revision update
  → stage new module namespaces
  → dispose outgoing revisions
  → activate boundaries transactionally
  → prune unreachable modules
  → commit or roll back the transaction
```

The client ignores stale revisions and detects missed revisions after
reconnect.

### Boundary API

The exact source spelling remains an open decision, but the semantic
surface contains:

- self-accept and dependency-accept callbacks;
- dispose before replacement;
- prune when a module leaves the graph;
- persistent per-module data;
- explicit invalidation to continue propagation;
- custom devtools/framework events.

Boundary discovery must be compiler-owned or structurally explicit,
never based on brittle scanning of generated JavaScript.

### Errors

A compile failure shows an overlay and leaves the active application
running. An activation failure restores the active module graph and living
implementations. The failed candidate hash is quarantined until Manager
publishes a newer generation. Full reload remains available for a malformed or
disconnected transition and when post-commit teardown cannot leave a coherent
document.

### CSS

CSS updates independently and removes obsolete styles when their
modules are pruned. A CSS-only change never remounts JavaScript state.

## Layer B contract

### Stable component identity

Each component declaration receives a stable id derived from module id
and declaration identity. A process-wide registry owns:

```text
component id
  → current component definition
  → structural signature
  → living instances
```

Generated code resolves the component definition rather than permanently
capturing one class object.

### Signature

The compiler records a deterministic signature covering:

- state names and initializer fingerprints;
- computed names;
- prop names and contracts;
- offer/accept context shape;
- method and lifecycle names;
- render structure/implementation hash;
- inheritance and root shape;
- effect declarations and cleanup ownership.

Compiler metadata is preferred over runtime reflection because erased
types and source roles are already available during emission.

### Refresh tiers

1. **Patch:** compatible implementation/render change. Keep state
   containers and instance identity, replace methods/render behavior,
   recreate owned effects, and reconcile DOM.
2. **Migrate:** compatible named-state shape change. Preserve retained
   slots, initialize added slots, dispose removed-slot ownership, then
   patch.
3. **Remount:** incompatible inheritance/root/contract change. Replace
   only the affected component subtree while preserving ancestors.
4. **Reload:** graph/runtime change that cannot be safely isolated.

Every tier is selected explicitly from signatures. No incompatible
shape is silently accepted.

### Effects

Effects belong to owner frames. Refresh disposes outgoing effects and
their cleanups exactly once before creating replacements. A failed
replacement cannot leave partial effects alive.

### DOM and interaction state

Patch and migration tiers reuse existing DOM where reconciliation can
prove identity. The refresh transaction records and restores:

- focused element;
- input selection;
- scroll positions;
- route and stash references;
- component refs.

Remount tiers preserve everything outside the replaced subtree.

## Transaction model

A multi-module update is one transaction:

1. compile every changed module;
2. validate graph and signatures;
3. stage namespaces and definition updates;
4. snapshot affected runtime/DOM ownership;
5. apply deepest dependencies first;
6. commit all updates;
7. on any failure, restore namespaces, definitions, effects, and DOM.

The previous successful revision remains authoritative until commit.

## Required rejection/fallback cases

- missing accept boundary;
- unsafe circular evaluation order;
- incompatible component signature;
- runtime ABI change;
- failed compile or module evaluation;
- failed effect cleanup/setup;
- revision gap or stale client;
- transaction rollback failure.

Each case reports the narrowest honest fallback: patch, migrate,
remount, or reload.

## Delivery phases

### Phase 0 — honest live reload

- connect browser delivery to the development server;
- provide revisioned reload notifications and a compile-failure overlay;
- add CSS soft updates and full-reload fallback.

Exit: no product surface claims state-preserving HMR.

### Phase 1 — substrate

- revisioned transport and module graph;
- last-known-good compilation;
- self-accepting non-UI modules;
- ordered reconnect/catch-up behavior.

Exit: utility modules update without reload.

### Phase 2 — narrow remount

- component registry and stable ids;
- living-instance tracking;
- affected-subtree remount.

Exit: editing a leaf preserves the application shell.

### Phase 3 — patch

- signatures and implementation hashes;
- method/render replacement;
- effect recreation;
- DOM reconciliation.

Exit: compatible edits preserve named state.

### Phase 4 — migration

- add/remove/reset named state slots;
- explicit migration diagnostics and cleanup.

Exit: compatible state-shape edits preserve unaffected slots.

### Phase 5 — graph quality

- transactional multi-module activation;
- shared dependency propagation;
- focus/selection/scroll restoration;
- devtools events and rollback hardening.

Exit: the full behavioral contract is automated.

## Test contract

Automated tests cover:

1. ordered revisions, stale updates, and reconnect catch-up;
2. compile failure with a still-interactive previous revision;
3. activation failure and complete rollback;
4. patch preserving state/container/instance identity;
5. migration preserving retained state and initializing new slots;
6. remount preserving parent/sibling state;
7. effect cleanup and recreation exactly once;
8. DOM focus, selection, and scroll preservation;
9. CSS update without JavaScript remount;
10. explicit full-reload fallback;
11. circular/shared module propagation;
12. multi-module transaction atomicity.

Browser-level behavior requires a real browser harness; pure graph and
signature decisions remain deterministic unit tests.

## Resolved decisions

Aligned with [WORKSPACE.md](WORKSPACE.md):

- **Layer A transport: publication changes.** A watch-mode Hub message carries
  one ordered `from → hash` transition. Changed Rip source may be inline;
  ordinary asset bytes use HTTP. Watch-off publication requires no Hub.
- **API: Rip-native, no `import.meta.hot` shim.** Compiler-owned
  accept/boundaries; Rip events for tools later.
- **Container identity during patch: owner-frame + declared key**, never
  positional (honors "state never migrates by positional guesswork").
- **Type-fingerprint change: remount.** A changed fingerprint remounts;
  a stable fingerprint patches in place.
- **Route/layout boundary identity: reuse the App stage's** layout-chain
  identity (route id + layout key), the same identity navigation uses.
- **Stash / schema-registry replacement: replace-and-revalidate.** The
  registry is replaced and revalidated; live stash values are preserved
  by key and orphaned keys are dropped loudly.
- **Stash-module definition edits: document reload.** Editing `stash.rip`
  / `data.rip` (rare) escapes to a full reload. Runtime assignments to
  stash values never reload.
- **Workspace unit noun: module.** Rip modules are path-keyed. Swappable
  component identity is **component definition**, not “definition cell.”
- **Delivery: complete Rip program first paint.** `bundle.json.list` carries
  the validated source graph and `bundle.json.hash` identifies the complete
  managed App state. `latest.json` is reconnect recovery; there is no
  manifest or public per-file hash inventory.

## Architectural constraints

- Generated HMR metadata never changes production semantics.
- Production output omits HMR-only metadata and transport code.
- Effects never survive without their cleanup owner.
- Component state never migrates by positional guesswork.
- Generated code is never scanned to reconstruct mapping or HMR facts.
- A failed update never destroys the last-known-good application.
