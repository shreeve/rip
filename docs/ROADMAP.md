# Product Roadmap

This document lists current open work only. Completed behavior belongs
in tests, `CHANGELOG.md`, and permanent reference documentation.

No item here authorizes a silent design choice. Product decisions are
resolved before implementation depends on them.

## Executable pending lane

`test/battery-pending/` is the source of truth for deferred language
and package behavior. Every row must continue to fail. When
implementation makes a row pass, that row moves into `test/battery/`
in the same change.

Two groups remain:

### Email package — 75 rows

`pending-email.rip` specifies `packages/ui/email`:

- DOM shim and serializer;
- client-compatibility behavior;
- email components and rendering.

The rows move when the package lands; they do not justify partial
compiler syntax in isolation.

### App/router gates — 8 rows

`pending-router.rip` specifies component render gates:

```rip
user <~ @app.data.user
```

The complete contract includes router prefetch metadata, stash-backed
member binding, keyed gate families, and the app/router consumer.
Gate syntax lands with that subsystem, not as an unread metadata stub.

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
Selected = if condition
  schema :shape
    value! integer
else
  schema :shape
    value! integer
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

### Strictness configuration

Define project-level control over implicit-any suppression and
definite-assignment behavior without creating a second language
dialect.

### Rename deduplication

Hoist and assignment manifestations can share source spans. Workspace
rename must collapse coincident edits before producing a
`WorkspaceEdit`.

### Whole-workspace features

The editor currently materializes the import closure of open files.
Workspace-wide references, rename, and auto-import may expand that
closure lazily; the feature that requests the expansion owns its cost.

### Derived schema declarations

Bindings produced by schema algebra can type through the TypeScript
face, but shipping `.d.ts` declarations require an explicit,
mapping-safe representation of argument literals.

## Hot module replacement

The active architecture and phased acceptance contract live in
[HMR.md](HMR.md). Work begins with honest last-known-good live reload,
then module delivery, narrow remount, patch, state migration, and
transactional graph polish.

## Roadmap hygiene

- One owner and one acceptance contract per item.
- Syntax changes update all three editor grammars.
- New behavior moves pending rows into the real battery.
- Implemented items leave this file.
- Completed probes and campaign ledgers do not accumulate here.
