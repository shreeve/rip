# Product Roadmap

This document lists current open work only. Completed behavior belongs
in tests and permanent reference documentation.

No item here authorizes a silent design choice. Product decisions are
resolved before implementation depends on them.

## Package and application portfolio

The compiler, feature runtimes, schema/ORM core, and editor integrations
are present. The first-party application and package portfolio remains
open work.

### Package substrate

New packages follow one package contract:

- package layout, exports, and named-only public APIs;
- direct package test commands through the Rip loader;
- Bun workspaces at the repo root (`packages/*`, `install.linker =
  "hoisted"`) so `@rip-lang/*` lands in `node_modules/@rip-lang/` and
  resolves in-tree; package-specific dependency budgets stay on the
  packages that need them — the compiler itself remains dependency-free;
- browser-safe metadata and bundle discovery;
- CLI subcommand discovery for package-provided tools;
- declaration, strict-check, and public-surface audit gates.

The substrate is a prerequisite for publishing and cross-package imports,
but it must not block direct-path package implementation and tests.

### Application foundation

- **Server:** the edge belongs to Janus running with Caddy — proxy
  and stream execution, the TLS story (ACME, certificates, SNI), and
  WebSocket termination with hub fan-out — so none of that is Rip
  Server work; `packages/server` publishes upstreams to the control
  plane and stops there. Remaining in Rip Server itself (contracts in
  the packages/server README's Planned section): hub ergonomics
  (bridge-frame dispatch, sigil directive helpers, a publish client,
  the `--bridge` registration flag) and opt-in file logging (a
  `logs:` knob / `RIP_LOG_DIR` redirect of the merged server stream
  to `logs/server.log`; stdout stays the default). Process workers,
  control-plane registration with heartbeats and upstream
  publication, dev watch with live reload, and the structured
  startup report (read-back composed) are shipped.
- **UI:** the headless widget catalog and its app-framework
  integration. The browser interaction primitives the widgets build
  on (`@rip-lang/ui/browser`: nav, dismiss, overlay, position, focus,
  scroll) and the Tailwind compilation boundary (`@rip-lang/ui`
  tailwind engine/inline/serve) are shipped with tests. Work begins
  with Philip after the type-audit PR (#156) lands.

### Independent libraries and tools

The first-party library portfolio is ported: CSV, decimal, XML (rsx),
X12, HTTP, time, worker-swarm, interactive scripting, source printing,
AI/MCP, host provisioning (stamp), the database client (`rip-db` over
duckdb-harbor, with its MCP server and CLI), and the authentication
gate all ship with converted or new test suites. Each package earns
its place through an independently runnable contract and current Rip
types.

### Browser delivery

The browser product needs:

- `<script type="text/rip">` compilation/loading;
- module and browser-safe package graph handling;
- integration with the app framework and development server.

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

### Headless checking

Provide a CLI that runs the editor-face/TypeScript pipeline without an
editor:

```text
Rip source → TS face → TypeScript diagnostics → Rip mappings
```

The command must share configuration, mapping, and diagnostic
translation with the extension.

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

### Derived schema declarations

Bindings produced by schema algebra can type through the TypeScript
face, but shipping `.d.ts` declarations require an explicit,
mapping-safe representation of argument literals.

## Hot module replacement

The active architecture and phased acceptance contract live in
[HMR.md](HMR.md). Work begins with honest last-known-good live reload,
then module delivery, narrow remount, patch, state migration, and
transactional graph polish.

## Rip-native hypermedia

The active architecture and phased acceptance contract live in
[FRAME.md](FRAME.md). Hypermedia is a parallel interaction mode beside
the reactive SPA path: a `Frame` component owns declarative requests,
targets, and swaps; fragments are inert first and managed later; and
committed responses invalidate stash and source state. It does not
embed `htmx.js` inside Rip-owned trees. Work begins after
browser-delivery and app/server foundations can host inert fragment
swaps.

## Roadmap hygiene

- One owner and one acceptance contract per item.
- Syntax changes update all three editor grammars.
- Implemented items leave this file.
- Completed probes and campaign ledgers do not accumulate here.
