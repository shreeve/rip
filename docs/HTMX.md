# Rip-Native Hypermedia

This document defines Rip's hypermedia architecture and behavioral
contract. It is a design specification; implementation proceeds only
through the dependency-ordered phases and acceptance tests below.

> **Surface revision in progress (recorded 2026-07-15).** The public
> surface spelled below predates two resolved decisions: there is no
> sub-brand and no `HyperBoundary` component — the public owner is a
> plain `Frame` component — and dotted `rip.*` attributes are
> rejected in favor of ordinary component props plus `$`-sigil data
> attributes. Three details remain open and undecided: the exact
> element-level spelling (bare `$get` versus a namespaced form), a
> possible deferred `Frame get` load-on-mount prop, and the written
> fragment trust policy. Read the ownership, transaction, protocol,
> and rejection contracts below as authoritative; read the
> `HyperBoundary` and `rip.*` spellings as superseded pending the
> revision.

The design is inspired by HTMX's server-driven interaction model, but
it does not embed or emulate HTMX inside Rip-owned trees.

## Goal

Rip hypermedia updates server-selected regions without requiring the
application to become a client-side SPA for every interaction.

It provides:

- native links and forms with progressive enhancement;
- declarative request, target, swap, pending, and abort behavior;
- inert server-rendered HTML fragments;
- compiler-produced reactive Rip fragments with explicit manifests;
- source and stash invalidation from server responses;
- router-aware navigation where requested;
- transactional DOM activation and rollback;
- coexistence with Rip's reactive SPA architecture.

Hypermedia is a parallel application mode, not a replacement renderer
and not a second owner of Rip-managed DOM.

Product promise:

> Declare a request on a link or form. The server returns the next
> region. Rip swaps only what it owns, invalidates what changed, and
> never destroys the last working UI because a fragment failed.

## Vocabulary

| Term | Meaning |
|---|---|
| hypermedia mode | server-driven interaction through requests and fragment swaps |
| reactive SPA mode | client-driven interaction through stash, sources, mutations, renderer, and router |
| `HyperBoundary` | Rip owner that captures hypermedia actions and controls requests and swaps within one DOM region |
| directive | compiler-recognized `rip.*` declaration such as `rip.get` or `rip.target` |
| inert fragment | HTML inserted as DOM without Rip component activation, bindings, effects, or hydration |
| Rip fragment | compiler-produced HTML plus a manifest sufficient for deterministic Rip activation |
| fragment manifest | compiler metadata describing ABI, roots, cells, bindings, ownership, and required modules |
| target | boundary-owned container receiving a swap |
| swap | replace, append, prepend, or reconcile target contents |
| morph | Rip renderer reconciliation of a managed Rip fragment |
| invalidation | explicit notification that named source or stash state is stale |
| request transaction | request, response validation, swap, activation, invalidation, and commit as one operation |
| unmanaged island | DOM subtree explicitly excluded from Rip ownership, where another runtime may operate |
| progressive enhancement | meaningful browser navigation or form submission without Rip client code |
| OOB swap | out-of-band response content targeting a region other than the request's declared target |

## Current baseline

Rip v4 establishes `NodeStore`, `RoleStore`, `MappingStore`, and
`CodeBuilder`. The app architecture separates stash, source, mutation,
renderer, and routes. The server uses a Sinatra-style request-handler
model (`@rip-lang/server`).

Rip does not yet define:

- a hypermedia boundary or request runtime;
- compiler semantics for `rip.*` directives;
- a fragment response protocol;
- deterministic client activation of server-produced Rip fragments;
- source or stash invalidation headers;
- swap transaction and rollback behavior;
- coexistence rules between hypermedia and reactive ownership.

Hypermedia therefore depends on the browser-delivery, app, and server
foundations in `ROADMAP.md`. The first phase establishes inert
fragments and honest ownership. Reactive Rip fragments follow only
after compiler manifests and renderer activation are deterministic.

## Why not literal HTMX

Rip must not embed `htmx.js` inside Rip-owned trees.

Literal HTMX would introduce a second system that independently:

- discovers behavior from live DOM attributes;
- sends requests and mutates DOM;
- decides swap and event timing;
- retains or discards element identity;
- owns pending and abort state;
- interprets out-of-band responses;
- interacts with browser history.

That ownership conflicts with Rip's renderer, component lifecycle,
effects, routes, HMR cells, and transactional activation. Two runtimes
must not independently mutate the same tree and then infer what the
other did.

Rip also has information HTMX does not have: compiler-known
directives, component identities, fragment manifests, definition
cells, source registries, stash ownership, and renderer
reconciliation. Discarding that information and reconstructing
behavior from emitted HTML would be a regression.

HTMX remains possible only inside an explicitly unmanaged island. Rip
does not initialize, reconcile, preserve, or inspect that island. The
island is an escape hatch, not an integration layer.

## Architecture

### SPA versus hypermedia

Rip supports two parallel interaction paths:

```text
Reactive SPA
event → mutation/source → stores → renderer → owned DOM

Hypermedia
native action → HyperBoundary → server fragment → swap → owned DOM
                                      │
                                      └→ source/stash invalidation
```

Both paths use the same renderer ownership rules and may share:

- stash;
- source registries;
- route state;
- component definition cells;
- fragment manifests;
- HMR revisions;
- effect and cleanup ownership.

They differ in where the next UI state is produced.

In SPA mode, client code computes or fetches data and renders the next
state. In hypermedia mode, the server returns the next region.

An application may use both modes in sibling regions. A reactive Rip
component may contain a `HyperBoundary`, and a compiler-produced Rip
fragment may activate reactive components after insertion. No DOM node
may have simultaneous independent ownership by the SPA renderer,
hypermedia runtime, HTMX, or another renderer.

### HyperBoundary ownership

`HyperBoundary` is the unit of request and DOM ownership.

It owns:

- directive registrations generated by the compiler;
- delegated native activation and submission handling;
- target resolution;
- in-flight request records;
- pending state;
- response validation;
- swap staging and commit;
- activation and disposal of Rip fragments;
- invalidation delivery;
- lifecycle events.

Targets must resolve inside the initiating boundary. Crossing into a
parent boundary, sibling boundary, or unmanaged island is rejected.

Nested boundaries are allowed. The nearest boundary owns an action, and
the event does not escape to an ancestor after that boundary accepts it.

The runtime does not scan generated JavaScript to discover directives.
It also does not treat arbitrary `rip.*` text found in inert HTML as
active behavior. Compiler output registers directives and manifests
explicitly.

### Fragment kinds

A response fragment is exactly one of two kinds.

#### Inert HTML

Inert HTML:

- creates ordinary DOM nodes;
- has no Rip bindings, components, effects, or lifecycle;
- cannot introduce active `rip.*` directives;
- cannot request morph reconciliation;
- is removed and disposed as plain DOM;
- does not execute response scripts.

The presence of attributes resembling Rip directives does not change
its kind.

#### Managed Rip fragment

A managed Rip fragment contains compiler-produced HTML and a matching
manifest. The manifest identifies:

- protocol and renderer ABI versions;
- compiler revision;
- fragment and root identities;
- component definition cell ids;
- binding and event registrations;
- ownership boundaries;
- required module ids and content hashes;
- structural keys needed for reconciliation;
- activation entry points;
- optional source and stash dependencies.

A managed fragment is activated only when the manifest validates
against the received HTML and the running runtime. Missing, stale, or
incompatible metadata is a hard rejection. Rip never guesses hydration
from DOM shape, comments, class names, or attribute patterns.

## Client surface

### Attribute spelling

The recommended and canonical source spelling is dotted `rip.*`
directives.

In Rip `render` blocks:

```rip
HyperBoundary id='contacts'
  a href='/contacts' rip.get rip.target='#list'
    'Contacts'

  form action='/contacts' method='post' rip.post rip.target='#list' rip.swap='append'
    input name='name'
    button 'Add'

  button rip.delete='/contacts/42' rip.target='#list' rip.swap='replace'
    'Delete'
```

Progressive-enhancement HTML uses the same names:

```html
<a href="/contacts" rip.get rip.target="#list">Contacts</a>
```

The compiler may emit private `data-*`, table, or registration
metadata, but emitted attribute spelling is not a public API.

Dotted names are preferred over `hx-*`, `rip-*`, or namespaced
XML-style attributes because they identify compiler-owned Rip
directives and compose with the language's member-like directive
surface. They also make literal copying into unmanaged HTML
insufficient to activate behavior.

### Request directives

The MVP supports:

| Directive | Meaning |
|---|---|
| `rip.get` | issue a `GET` request |
| `rip.post` | issue a `POST` request |
| `rip.delete` | issue a `DELETE` request |
| `rip.target` | select the boundary-owned swap target |
| `rip.swap` | select `replace`, `append`, `prepend`, or `morph` |
| `rip.pending` | show or mark pending UI associated with a request |
| `rip.abort` | abort the applicable in-flight request |

A request directive may contain a URL. A bare directive uses native
element data:

- `rip.get` on an anchor uses `href`;
- `rip.get` on a form uses `action` and successful form controls;
- `rip.post` on a form uses `action`;
- `rip.delete` uses its explicit value, form `action`, or element URL
  contract in that order.

Missing or ambiguous URLs are compile errors where statically known and
runtime errors otherwise.

The MVP does not include a general trigger language. Activation follows
native behavior:

- link or button activation;
- form submission;
- keyboard activation through browser semantics.

Timers, visibility triggers, polling, arbitrary event expressions, and
load triggers are deferred.

### Target resolution

`rip.target` accepts:

- `self`;
- a boundary-local CSS selector;
- a compiler-resolved element reference when the source language
  supports one.

A missing target defaults to the initiating element's nearest declared
hypermedia region, then to the boundary's default target. If neither
exists, the request is rejected before network activity.

A selector must resolve to exactly one target. Zero or multiple matches
are errors. Resolution occurs before the request and is revalidated
before commit. A target removed while the request is in flight causes
the transaction to abort without redirecting the response elsewhere.

### Swap behavior

`rip.swap` supports:

- `replace`: replace the target's children while retaining the target
  container;
- `append`: insert fragment roots after the target's existing children;
- `prepend`: insert fragment roots before the target's existing
  children;
- `morph`: reconcile the target's managed children through the Rip
  renderer.

`replace` is the default.

Append and prepend preserve existing children and their owners. Managed
insertions receive new owner frames under the target. A later replace
disposes all removed owners exactly once.

`morph` is valid only for compiler-produced Rip fragments. It uses
Rip's renderer reconciliation, keys, cells, and ownership records. Rip
does not ship a morphdom-like generic HTML differ and does not morph
inert HTML. An inert response requested with `rip.swap='morph'` is
rejected before DOM mutation.

### Pending state

Pending begins after request validation and before network dispatch. It
ends after commit, rejection, failure, or abort.

During pending:

- the boundary records the initiating action, target, and transaction;
- the target receives framework-owned busy state;
- `aria-busy='true'` is applied where appropriate;
- the native submitter is disabled for the transaction unless declared
  otherwise by a later API;
- associated `rip.pending` content becomes active.

A bare `rip.pending` associates with the nearest request owner.
A valued form may identify an action or target within the same boundary.

Rip restores prior disabled, hidden, and ARIA state rather than assuming
default values.

### Abort and concurrency

A `rip.abort` control aborts the newest applicable pending transaction
in its boundary. It may identify a target to disambiguate concurrent
requests.

Concurrency is target-scoped:

- requests for disjoint targets may proceed in parallel;
- a newer request for the same target aborts the older request;
- an aborted or superseded response cannot swap, invalidate, navigate,
  or emit a commit event;
- stale response completion is ignored even if transport cancellation
  fails.

The runtime exposes a boundary-level imperative abort operation for
component cleanup and route transitions. It does not expose arbitrary
DOM mutation hooks.

### Lifecycle events

`HyperBoundary` emits structured Rip lifecycle events:

1. `hyper:before-request`;
2. `hyper:request`;
3. `hyper:before-swap`;
4. `hyper:after-swap`;
5. `hyper:commit`;
6. `hyper:abort`;
7. `hyper:error`.

Events carry stable boundary, target, transaction, method, URL, and
response metadata. They do not expose mutable internal transaction
objects. Cancellation is permitted only at documented pre-request and
pre-swap points.

## Server protocol

### Request contract

Enhanced requests send ordinary HTTP requests plus:

```text
Accept: application/rip-fragment+json, text/html
Rip-Request: fragment
Rip-Target: <stable target id when available>
Rip-Current-URL: <document URL>
Rip-Runtime-ABI: <runtime ABI>
Rip-Manifest-ABI: <manifest ABI>
```

Header names and exact serialization remain versioned protocol details,
but their semantics are required.

`GET` encodes successful controls in the query string. `POST` preserves
the form's encoding, including multipart uploads. `DELETE` sends an
empty body unless initiated from a form contract that explicitly
provides controls.

Cookies, authentication, CSRF protection, redirects, cache headers, and
same-origin policy remain ordinary HTTP concerns. Rip does not invent a
parallel authentication protocol.

Cross-origin hypermedia requests are rejected by default.

### Response kinds

An inert fragment response uses:

```text
Content-Type: text/html; charset=utf-8
Rip-Fragment: inert
```

A managed fragment response uses:

```text
Content-Type: application/rip-fragment+json
Rip-Fragment: managed
```

Its logical payload is:

```json
{
  "version": 1,
  "html": "<section>...</section>",
  "manifest": {
    "abi": "...",
    "fragment": "...",
    "roots": [],
    "cells": [],
    "bindings": [],
    "modules": []
  }
}
```

The concrete manifest schema is compiler-owned and versioned. User code
must not hand-author managed manifests.

Plain `text/html` without `Rip-Fragment` is accepted as inert only when
the request explicitly negotiated fragment HTML. A full document,
unexpected media type, malformed payload, or contradictory headers is
rejected. Rip does not inspect the body and guess whether it is a page,
fragment, or hydratable component.

Scripts in fragment responses are never executed. Executable behavior
must arrive through validated Rip modules referenced by a managed
manifest.

### `c.fragment`

The Sinatra-style server exposes `c.fragment` as the canonical response
constructor. It owns:

- content negotiation;
- fragment media type and protocol headers;
- inert versus managed declaration;
- manifest attachment;
- source and stash invalidation headers;
- optional route location;
- cache and status metadata.

Conceptually:

```rip
post '/contacts' ->
  Contact.create! @form()
  @fragment ContactList.html!, invalidateSource: ['contacts']
```

HTML strings produce inert fragments.

Compiler-produced fragment values produce managed fragments and carry
their compiler-generated manifests. Passing HTML plus a claim that it
is managed is rejected unless the compiler supplied the matching
fragment value.

For the MVP, handlers may return HTML strings or precompiled fragment
render results. Full server-side rendering of arbitrary living Rip
components is not an MVP dependency. The server does not need to create
browser component instances, run browser effects, or emulate client
lifecycles merely to return a fragment.

### Invalidation headers

Responses may declare named invalidations:

```text
Rip-Invalidate-Source: contacts, contact%3A42
Rip-Invalidate-Stash: session, cart
```

Names use stable application registry ids and a defined escaping
grammar. Duplicate header fields are combined. Unknown ids are reported
in development and ignored in production unless strict protocol mode is
enabled.

Invalidation communicates staleness, not replacement values. A response
cannot directly overwrite arbitrary stash or source storage through
headers.

### Status and redirects

The MVP behavior is:

- `200`–`299`: validate and process the declared fragment;
- `204`: perform no swap, but commit valid invalidations and location
  metadata;
- `300`–`399`: follow ordinary same-origin redirects, then validate the
  final response;
- `400`–`599`: do not swap by default; retain current DOM and emit a
  structured error.

A server that wants to render validation errors into the target returns
a successful fragment response. A later error-target feature may permit
explicit non-success swaps; the MVP does not infer them.

A response may provide an authoritative same-origin location for router
integration. It cannot silently navigate to a cross-origin URL.

## Lifecycle and transaction

Each hypermedia action is one transaction:

```text
native action
  → resolve boundary, URL, target, and swap
  → validate ownership and progressive fallback
  → establish pending state
  → dispatch request
  → receive and classify response
  → validate fragment and manifest
  → stage DOM and managed owners
  → snapshot affected target ownership
  → apply swap
  → activate managed fragment
  → deliver invalidations
  → update route if requested
  → commit
```

The authoritative DOM does not change until response classification,
target validation, and fragment validation succeed.

For a managed fragment, activation is staged before commit. Effects
cannot escape their staged owner frames. On activation failure, Rip:

1. disposes staged effects and owners;
2. restores the previous target DOM and ownership records;
3. restores pending and accessibility state;
4. leaves source, stash, and route unchanged;
5. emits `hyper:error`.

Invalidations and route updates occur only after a successful DOM and
activation commit. They are not delivered for stale, aborted, malformed,
or rolled-back responses.

If an invalidation callback itself schedules reactive rendering, that
render observes the committed fragment. It is not allowed to interleave
with an incomplete swap.

### Required rejection cases

- request directive without a valid URL;
- target missing, ambiguous, detached, or outside the boundary;
- target entering an unmanaged island;
- unsupported method or swap;
- `morph` with inert HTML;
- missing or incompatible managed-fragment manifest;
- manifest and HTML root mismatch;
- unavailable or hash-incompatible required module;
- runtime or renderer ABI mismatch;
- full document returned where a fragment is required;
- executable script in a fragment;
- stale or superseded transaction;
- activation or effect setup failure;
- route update outside the same-origin policy;
- rollback failure.

Each rejection preserves the previous committed target. Rollback failure
escalates to an explicit full-page navigation or reload; it is never
reported as a successful swap.

## Stash, source, mutation, and router integration

### Source

`source()` instances register stable invalidation ids with the app
source registry.

A committed source invalidation:

- marks matching cached results stale;
- notifies active consumers through the source's normal scheduler;
- refetches only according to that source's configured policy;
- deduplicates repeated ids in one transaction.

Rip does not discover source dependencies by scanning rendered DOM.
Source ids come from compiler metadata or explicit registration.

### Stash

Stash entries or namespaces may register stable invalidation ids.

A committed stash invalidation invokes stash-defined invalidation
semantics. It does not blindly delete live values. A stash may choose
to:

- mark a server-backed entry stale;
- rerun its loader;
- clear an explicitly disposable cache;
- notify dependent computations;
- reject invalidation for locally authoritative state.

This preserves stash ownership and prevents a fragment response from
silently corrupting client state.

### Mutation

Hypermedia requests and client mutations are parallel command paths.

A `rip.post` or `rip.delete` request is not automatically wrapped in an
application `createMutation` object. Both systems may share:

- pending instrumentation;
- abort signals;
- invalidation delivery;
- error normalization;
- transaction ids.

They must not execute the same command twice. An action is declared as
either a hypermedia request or a client mutation at one ownership point.

### Router

A fragment request does not change the application route merely because
it used `GET`.

Route changes occur when:

- the action is declared as navigation by the boundary or router
  integration;
- the response returns authoritative location metadata;
- a redirect completes at a new same-origin location.

Router updates happen after a successful swap and participate in the
transaction. Back and forward restoration must use router-owned history
state, not replay arbitrary mutation requests.

Without client enhancement, anchors and forms continue through normal
browser navigation, so the server must be capable of returning a full
page when the request does not negotiate a fragment.

## HMR and v4 relationship

Hypermedia manifests and HMR metadata share the same compiler-owned
identity system. See [HMR.md](HMR.md).

A managed fragment references stable definition cells rather than
capturing permanent component class objects. Once activated, its living
components participate in HMR exactly like components created by the
SPA renderer.

The shared contract includes:

- module ids and revisions;
- component definition cell ids;
- renderer and manifest ABI;
- structural signatures;
- root and ownership identity;
- effect owner frames.

A fragment received during an HMR transaction is staged behind the
active revision. An HMR update does not interleave with fragment
activation against a partially replaced cell registry.

If a fragment references a newer compatible module revision, the client
may fetch and stage that revision through the browser-delivery
substrate. It must not evaluate arbitrary response JavaScript. If the
required revision cannot be loaded and validated, the fragment is
rejected.

An active managed fragment may patch, migrate, remount, or reload
according to the HMR contract. An inert fragment has no HMR identity.

v4 stores remain authoritative containers. Fragment activation may bind
to registered stores but may not reconstruct, replace, or infer stores
from HTML.

`CodeBuilder` emits directive registrations and fragment manifests
directly. Generated JavaScript is never scanned to recover either.

## Progressive enhancement

A hypermedia-enabled link or form should remain a valid browser action.

For links:

- `href` names the full-page destination;
- the server returns a full page without fragment negotiation;
- Rip intercepts only after the boundary validates the action.

For forms:

- `action`, `method`, names, values, encoding, and submitter semantics
  remain valid;
- native constraint validation runs before interception;
- the server returns a full page when JavaScript is absent.

Native forms do not support `DELETE`. A progressively enhanced delete
must therefore provide an ordinary fallback, such as a `POST` form with
the server's documented method override. A button whose only usable
contract is `rip.delete` is enhancement-dependent and must be diagnosed
as such in strict accessibility or progressive-enhancement mode.

If Rip fails to initialize, native navigation and submission continue.
If Rip has already intercepted an action and the fragment transaction
later fails, it retains the current page and reports the error rather
than silently replaying the action as a full navigation. Automatic
replay could duplicate non-idempotent requests.

The server must vary fragment and full-page responses on the relevant
request headers and emit correct cache metadata.

## Hard nos

- No `htmx.js` inside Rip-owned trees.
- No second DOM owner inside a `HyperBoundary`.
- No activation of `rip.*` text discovered in inert response HTML.
- No hydration guessed from DOM shape, comments, attributes, or names.
- No generated-JavaScript scanning for directives or manifests.
- No arbitrary response script execution.
- No generic morphdom-style diff for inert HTML.
- No cross-boundary target selection.
- No source or stash mutation before transaction commit.
- No automatic replay of failed non-idempotent requests.
- No implicit full-document-to-fragment extraction.
- No silent downgrade from a managed fragment to inert HTML.
- No production claim that unmanaged islands preserve Rip lifecycle,
  HMR, route, or state behavior.
- No generic HTMX-style out-of-band swaps.

## Resolved design opinions

### Attribute spelling

Use dotted `rip.*` source directives.

Examples: `rip.get`, `rip.post`, `rip.delete`, `rip.target`,
`rip.swap`, `rip.pending`, and `rip.abort`. Compiler emission is private
and may use a more compact representation.

### Server rendering for the MVP

Do not make full SSR of arbitrary Rip components an MVP prerequisite.

The MVP supports inert HTML-string handlers and compiler-produced
fragment render values through `c.fragment` / `@fragment`. General
component SSR may arrive later when its lifecycle, context, async, and
serialization contracts are independently specified.

### Morph implementation

Use Rip renderer reconciliation for managed Rip fragments only.

Do not add a morphdom-like dependency or generic HTML differ. Inert HTML
supports replace, append, and prepend. Requesting morph for inert HTML
is an error.

### Out-of-band swaps

Do not implement generic HTMX-style OOB swaps.

If later use cases require one response to update multiple regions, add
an explicit compiler- and server-produced multi-region transaction with
declared targets, ownership validation, complete staging, and atomic
rollback. Do not accept arbitrary response elements carrying target
selectors. Generic OOB swapping remains a hard no.

## Delivery phases

### Phase 0 — ownership and protocol skeleton

- define `HyperBoundary` ownership;
- define directive compiler metadata;
- implement native link and form interception;
- implement `GET`, `POST`, and `DELETE`;
- implement request headers and inert `c.fragment`;
- reject targets outside the boundary;
- retain native full-page fallback.

Exit: enhanced requests can replace a boundary-local target with inert
HTML, and no product surface claims reactive fragment activation.

### Phase 1 — inert swaps and lifecycle

- implement replace, append, and prepend;
- implement target-scoped concurrency;
- implement pending and abort;
- implement lifecycle events;
- reject scripts, stale responses, and invalid response kinds;
- add transaction staging and DOM rollback.

Exit: inert fragment behavior is deterministic under success, failure,
abort, and concurrent requests.

### Phase 2 — app integration

- register stable source and stash invalidation ids;
- emit and parse invalidation headers;
- deliver invalidations only after commit;
- integrate same-origin router location updates;
- share pending, abort, and diagnostics infrastructure with mutations.

Exit: a server mutation can swap HTML and invalidate application state
without duplicate execution or partial commit.

### Phase 3 — managed Rip fragments

- define the versioned fragment manifest;
- emit managed fragment values through `CodeBuilder`;
- implement `c.fragment` serialization for compiled fragments;
- validate roots, cells, modules, hashes, and ABI;
- stage activation and effect ownership;
- roll back failed activation.

Exit: compiler-produced server fragments activate reactively without
hydration guessing.

### Phase 4 — managed morph

- connect fragment manifests to renderer reconciliation;
- preserve keyed identity and compatible component state;
- dispose removed owners and effects exactly once;
- reject all inert morph attempts.

Exit: `rip.swap='morph'` reconciles managed fragments through the Rip
renderer and no generic DOM differ exists.

### Phase 5 — HMR and operational quality

- coordinate fragment activation with HMR transactions;
- load validated manifest-declared module revisions;
- preserve last-known-good cells during failures;
- add browser history restoration;
- add protocol diagnostics, devtools events, and rollback hardening.

Exit: managed fragments, HMR, sources, stash, routes, and effects obey
one automated transactional contract.

## Test contract

Automated tests cover:

1. native link and form behavior without client enhancement;
2. `GET`, `POST`, and `DELETE` request construction;
3. form controls, submitter, encoding, uploads, and constraint
   validation;
4. default and explicit target resolution;
5. rejection of missing, ambiguous, detached, cross-boundary, and
   unmanaged-island targets;
6. replace, append, and prepend ordering;
7. concurrent requests to disjoint targets;
8. newest-request-wins behavior for the same target;
9. transport abort and stale-response suppression;
10. pending and accessibility state restoration;
11. successful inert fragment commit;
12. malformed media type, full-document, and executable-script
    rejection;
13. non-success status behavior and same-origin redirects;
14. source invalidation exactly once after commit;
15. stash invalidation through stash-owned semantics;
16. no invalidation after abort, rejection, or rollback;
17. router update only after a successful transaction;
18. inert HTML never activating textual `rip.*` attributes;
19. managed fragment manifest and HTML validation;
20. runtime, renderer, module, hash, and manifest ABI mismatch;
21. managed activation and effect cleanup exactly once;
22. activation failure restoring previous DOM and ownership;
23. morph preserving compatible keyed component identity;
24. inert morph rejection;
25. append and prepend preserving existing owner frames;
26. replace disposing removed managed owners exactly once;
27. HMR patch, migration, remount, and fallback within an activated
    fragment;
28. fragment activation serialized against an HMR transaction;
29. no arbitrary response JavaScript evaluation;
30. unmanaged islands receiving no Rip lifecycle guarantees;
31. cache variation between full-page and fragment responses;
32. rollback failure escalating explicitly rather than committing
    partial state.

Protocol parsing, manifest validation, target selection, invalidation,
and transaction ordering remain deterministic unit tests. DOM ownership,
form behavior, accessibility state, history, abort races, activation,
and HMR interaction require a real browser harness.

## Open decisions

- Exact compiler syntax for declaring a boundary default target.
- Whether directive URL values permit only literals and references or
  also pure expressions.
- Exact fragment media type and header serialization.
- Manifest transport as JSON, binary metadata, or negotiated compact
  encoding after the JSON contract is stable.
- Whether managed fragment modules may be fetched in production or must
  already be present in the application asset graph.
- Cache keys and ETag behavior for user-specific fragments.
- Router history snapshot contents for back and forward restoration.
- Strict-mode behavior for unknown source and stash invalidation ids.
- Whether non-success fragment swaps need an explicit `rip.error-target`
  in a later phase.
- Whether a future multi-region transaction is sufficiently valuable to
  justify a separate protocol.
- Focus, selection, and scroll policy for replace versus managed morph.
- Server method-override spelling for progressively enhanced deletes.
- Development diagnostics for fragments compiled against a newer
  application revision.

Decisions are recorded here before implementation depends on them.

## Architectural constraints

- Rip owns every DOM node it renders or inserts outside an explicitly
  unmanaged island.
- A DOM node never has two independent render or swap owners.
- Hypermedia and SPA interaction paths share renderer ownership rather
  than coordinating through DOM observation.
- Inert HTML remains inert regardless of attribute spelling.
- Managed activation requires compiler-produced manifests.
- Component hydration is never guessed.
- Morph uses Rip reconciliation and managed fragment metadata only.
- Generated JavaScript is never scanned to reconstruct directives,
  cells, manifests, source ids, or ownership.
- Response scripts never execute as a fragment activation mechanism.
- Effects never survive without their owner frame and cleanup.
- Source, stash, and route changes occur only after successful swap
  commit.
- An aborted or stale response has no application-visible effects.
- A failed transaction preserves the previous committed DOM and state.
- Full-page navigation is an explicit fallback, never a disguised
  partial success.
- HTMX may run only in an unmanaged island with no Rip ownership
  guarantees.
- Generic OOB swaps are never accepted.
