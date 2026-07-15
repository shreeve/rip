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
| definition cell | stable component identity whose implementation can swap |
| signature | structural fingerprint used to select patch, migrate, or remount |
| last-known-good | the active successful revision retained across a failed update |
| transactional activation | stage, validate, swap atomically, and roll back on failure |

## Current baseline

Rip currently compiles and runs modules through Bun and can emit feature
runtimes inline or by import. It does not ship a browser entry, app
framework, development server, watch transport, module graph, or
state-preserving refresh.

HMR therefore depends on the browser-delivery, app, and server
foundations in `ROADMAP.md`. The first HMR phase establishes an honest
last-known-good reload path; later phases add module and framework
refresh.

## Two-layer architecture

HMR has two independent owners:

```text
Layer A — dev substrate
watch → module graph → notify → fetch/evaluate → CSS → overlay
                         │
                         ▼
Layer B — framework refresh
identity → signature → patch/migrate/remount → effects → DOM
```

Layer A delivers a new module namespace. Layer B decides whether living
instances can adopt it.

Rip owns the language, compiler, runtime, renderer, router, and server,
so both layers can share stable ids and compiler-produced metadata
without heuristic source transforms.

## Layer A contract

### Module graph

Each module records:

- stable module id;
- content hash and revision;
- imported dependencies;
- importers;
- accepted dependencies/self-accept status;
- dispose and prune callbacks;
- the last successful namespace.

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
running. An activation failure restores the previous module graph and
living implementations. Full reload remains available when rollback
cannot restore a coherent graph.

### CSS

CSS updates independently and removes obsolete styles when their
modules are pruned. A CSS-only change never remounts JavaScript state.

## Layer B contract

### Stable component identity

Each component declaration receives a stable id derived from module id
and declaration identity. A process-wide registry owns:

```text
component id
  → current definition cell
  → structural signature
  → living instances
```

Generated code resolves the definition cell rather than permanently
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

Decided at stage entry, before implementation depends on them:

- **Transport: WebSocket, unified.** One dev transport carries both
  file-watch reloads and HMR updates. The existing SSE watch transport
  migrates to WS — SSE's HTTP/1.1 six-connection-per-origin ceiling
  starves the app's own requests once a few dev tabs are open, and a
  bidirectional channel is wanted for targeted updates and client→server
  error/state reporting. Reconnection carries a revision cursor so a
  reconnecting client resumes from its last-applied revision.
- **API: Rip-native, no `import.meta.hot` shim.** Rip owns its dev
  server and runtime and replaces Vite rather than running under it, so
  there is no external API to be compatible with. The HMR API keeps
  Rip's ownership and effect-cleanup semantics honest.
- **Container identity during patch: owner-frame + declared key**, never
  positional (honors "state never migrates by positional guesswork").
- **Type-fingerprint change: remount.** A changed fingerprint remounts;
  a stable fingerprint patches in place.
- **Route/layout boundary identity: reuse the App stage's** layout-chain
  identity (route id + layout key), the same identity navigation uses.
- **Stash / schema-registry replacement: replace-and-revalidate.** The
  registry is replaced and revalidated; live stash values are preserved
  by key and orphaned keys are dropped loudly.
- **Update payload: inline** over the bidirectional WS (no separate
  hash-addressed fetch channel).
- **Dev module layout: unbundled ESM** in development (fast narrow
  updates); the deterministic bundle remains the production output.

## Architectural constraints

- Generated HMR metadata never changes production semantics.
- Production output omits HMR-only metadata and transport code.
- Effects never survive without their cleanup owner.
- Component state never migrates by positional guesswork.
- Generated code is never scanned to reconstruct mapping or HMR facts.
- A failed update never destroys the last-known-good application.
