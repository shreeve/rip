# Product Roadmap

This document lists current open work only. Completed behavior belongs
in tests and permanent reference documentation
([WORKSPACE.md](WORKSPACE.md), [HMR.md](HMR.md), [SERVER.md](SERVER.md),
[ORM.md](ORM.md), [TYPES.md](TYPES.md), package READMEs).

No item here authorizes a silent design choice. Product decisions are
resolved before implementation depends on them.

## Package substrate

New packages follow [packages/AGENTS.md](../packages/AGENTS.md): mold
layout for simple library/CLI packages, earned shapes for larger trees,
Bun workspaces at the repo root (`packages/*` plus `test/browser`),
`install.linker = "hoisted"`, and a dependency-free compiler core.

Open substrate work is only what that contract still leaves undecided
for a given package (browser-safe subpath rules, publish metadata when
`private` lifts). Do not block direct-path package tests on a complete
publish story.

## Application foundation

- **Sites leftovers** — shipped architecture is [SERVER.md](SERVER.md).
  Open items live in [packages/sites/TODO.md](../packages/sites/TODO.md)
  (opt-in file logging, `public` edge posture, compression and security
  header pins, Manager watch defaults, appliance distribution, Cart
  cleanups). Process workers, control-plane registration, watch
  publication, and the structured startup report are already shipped.
- **UI** — browser interaction primitives (`rip/ui/browser`) and
  the Tailwind compilation boundary are shipped with tests. The
  headless widget catalog and its app-framework integration remain
  open with Philip.

## Browser delivery

Shipped and CI-certified: `<script type="text/rip">`,
`assembleRipBundle` → `bootApp` → `launch`, Workspace publication
consume ([WORKSPACE.md](WORKSPACE.md)), and real-browser Playwright
(`bun run test:browser`) across Chromium, Firefox, and WebKit.

Product HMR for the contracted Cart bars is done
([HMR.md](HMR.md)); optional seam compression only, not morph.

Still open:

- **`rip.browser` granularity** (needs an owner call — see breakdown
  below if opening work). Today `"rip": { "browser": true }` is
  package-wide, and assembly that claims a package copies every `.rip`
  file under its root. A package such as `rip/ui` mixes
  browser-safe surfaces (`./browser`) with server-only / npm-backed
  surfaces (`./tailwind`), so it cannot set the flag without lying.
- **Sites pin for precompressed `bundle.json`.** Janus (≥ v1.6) already
  selects `.br` / `.zst` / `.gz` sidecars from `Accept-Encoding` when
  `files { precompressed }` is on (Sites Caddyfiles already enable it).
  Remaining work is a Sites certification pin that
  `GET /bundle.json` with `Accept-Encoding: br` returns the Manager
  sidecar bytes — not new Janus transport. Track under
  [packages/sites/TODO.md](../packages/sites/TODO.md) edge policy.
- **Production precompiled output** (CSP-clean path with no in-browser
  compiler) remains deliberately deferred; the on-the-fly compiler
  stays. That is not a Workspace milestone name — just a later product
  leaning.

This delivery layer is distinct from compiler runtime `inline`/`import`
emission.

## Language candidates

These candidates are evidence-backed but not accepted features.

### Fresh binding declaration

Rip's function-scoped assignment intentionally captures an existing
outer binding. Closure-dense token walks sometimes need explicit fresh
intent:

```rip
own index = out.length
```

`own` is already reserved by `for own`. A feature design must define:

- function and flattened-expression scopes;
- interaction with hoisting and typed declarations;
- mapping and rename behavior;
- alpha-renaming where two declarations land in one JS scope.

Revisit when another real fresh-intent defect appears or a static
analysis experiment finds a meaningful population.

### Continue-safe cursor loop

Token walkers need a mutable index update that runs after `continue`.
A candidate loop form must preserve:

- update-before-next-test ordering;
- explicit index mutation;
- `continue` behavior;
- break/return/yield/await control targets;
- single evaluation of header operands.

The syntax remains undecided.

### Structural partial matching

Compiler code repeatedly tests adjacent token shapes. A constrained
partial match could replace conjunction ladders:

```rip
token is like {kind: 'UNARY_MATH', value: '~'}
```

The first design should support value-only partial object matching,
without bindings or guards. Sequence matching is a separate extension.

### Diagnostics for arithmetic-looking member typos

`object.data-src` is legal subtraction and cannot become hyphenated
member access. A lint-tier diagnostic may warn on assignment-shaped
uses such as:

```rip
object.data-src = value
```

Bracket access remains the language spelling.

### Schema identity through value selection

A direct schema binding receives its assignment name for diagnostics,
registry identity, and debugging. A schema selected through a
value-position `if`, `try`, or `switch` does not currently receive the
outer binding name:

```rip
Selected = if individual
  schema :shape
    firstName! string
    lastName! string
else
  schema :shape
    companyName! string
```

The selected schema's `name` is `null`. A complete design must tunnel
identity without changing branch evaluation, mappings, or anonymous
schema behavior.

## Type and editor directions

Architecture: [TYPES.md](TYPES.md). Still open:

### Bare optional parameters under strict checking

An untyped optional parameter emits the valid TypeScript spelling
`name?`, whose value type remains implicit `any`. A strict project asks
for missing annotations to be diagnosed, so the language must choose
and pin one contract: surface the diagnostic, or render an explicit
`name?: any` matching declaration output.

### Whole-workspace features

The editor currently materializes the import closure of open files.
Workspace-wide references, rename, and auto-import may expand that
closure lazily; the feature that requests the expansion owns its cost.

### Render-DSL intelligence

The TypeScript face currently lowers render-block attributes to string
literals, leaving no typed position for the language service. Editor
intelligence for render blocks returns through typed attribute
positions in the face, so completion and checking are tsgo-native.
Scheduled with the UI stage.

## Rip-native hypermedia

Design and phased acceptance: [FRAME.md](FRAME.md). Not started.
Work begins after browser-delivery and app/server foundations can host
inert fragment swaps, and after FRAME's open surface decisions are
closed (exact `$` / prop spelling, optional load-on-mount, fragment
trust policy).

## Clean-room engine

[CLEANROOM.md](CLEANROOM.md) is shelved until v4 is declared done. It
is not scheduled product work and does not belong in the edit loop.

## Roadmap hygiene

- One owner and one acceptance contract per item.
- Syntax changes update all three editor grammars.
- Implemented items leave this file (point at permanent docs instead).
- Completed probes and campaign ledgers do not accumulate here.
