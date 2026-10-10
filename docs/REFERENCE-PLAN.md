# The Agent Reference — Design

This document designs **`docs/REFERENCE.md`**: one compact, verified
description of Rip written for AI coding agents, complete enough that an
agent writes correct Rip on its first attempt without reading the
compiler. It records the problem, the deliverable's shape, how it stays
true, how its effect is measured, and the order of work. It is a plan,
not a contract; nothing here is implemented.

Status: **proposed.** The language problems found while preparing it are
recorded in [PROBLEMS.md](../PROBLEMS.md).

## The problem

An agent meets Rip through one of two doors today, and neither states
the rules it needs:

- **Examples.** On 2026-10-08 two agents with no prior knowledge of Rip
  read 40 programs from this repository (no docs, no compiler) and wrote
  three programs each. Four of six compiled first time; both kv-parser
  suites passed (19 of 19 tests). Their reconstruction was good where the
  corpus was explicit and wrong or blank where it was silent:
  - `then` and `else` as low-precedence `and`/`or` never appeared, so
    neither agent knew they exist;
  - `!` on a definition (`name! = ->`, a void function) read as unknown;
  - `@prop` versus bare `prop` inside a component, `<~` versus `~=`, and
    the effect-cleanup convention were all guessed;
  - both agents treated `or`/`||`, `?=`/`??=` and three conditional
    spellings as an unexplained mess, scoring Rip 4/10 for AI agents
    while their own code largely compiled.
- **AGENTS.md.** It is the operating manual for building the compiler —
  doctrine, gates, layering — not a statement of how to write Rip.

The cost is concrete. A missing `!` (dammit: call-and-await) is legal
and silent — the call returns a Promise, which is always truthy — and
that exact slip shipped two auth bypasses in Rip Sites (`csrf` `exempt`,
hub `auth`; fixed in #432) in code written by people who know Rip well.

## Goals

1. **Complete for writing.** Every construct a program can use, with its
   canonical spelling, its meaning, and the JavaScript it compiles to.
2. **Exact.** Semantics are shown, not paraphrased: each entry pairs Rip
   with the JavaScript the compiler emits, so precedence and evaluation
   are unambiguous.
3. **Verified.** Every example compiles in CI and its JavaScript is
   compared to the compiler's output; the document cannot drift.
4. **Compact.** About 15,000 tokens, so an agent loads it whole.
5. **Measured.** Its value is a number: the cold-agent experiment rerun
   with the reference in hand.

## Non-goals

- Not a tutorial or a marketing page; it states rules, not motivation.
- Not AGENTS.md: nothing about building, testing or landing the compiler.
- Not a language change. It describes Rip as it is; every spelling stays
  valid. Where several spellings exist it names one **preferred** form
  and lists the others as equivalent.
- Not the TypeScript face or editor internals (docs/TYPES.md owns those);
  only what a program author writes.

## The deliverable

One file, `docs/REFERENCE.md`, linked from README.md and AGENTS.md.

### Entry format

Each construct gets one entry, in this shape:

````markdown
### Low-precedence and/or: `then`, `else`

Binds looser than `=`: the assignment happens first, then the right side
runs on success (`then`) or failure (`else`). `and`/`&&` and `or`/`||`
bind tighter than `=`.

```rip
a = user! then p "Got one!"
b = user! else p "Nobody here!"
c = user! or p "Nobody here!"
```

```js
let a, b;

(a = await user()) && p("Got one!");
(b = await user()) || p("Nobody here!");
let c = await user() || p("Nobody here!");
```

Trap: `c` holds `p`'s return value when `user!` is falsy; `b` holds the user.
Pins: test/rip/control.rip ("then binds below assignment").
````

- **Rule first**, one or two sentences, present tense.
- **A `rip` block and its `js` block**, minimal. The JavaScript is the
  compiler's own output, normalized as the `code` rows of the language
  suite normalize it (`normalizeCode` in `test/support/battery.js`).
- **Traps and preferred form** where they exist, one line each.
- **Pins:** the `test/rip/*.rip` suite that owns the construct, so a
  reader can find the full contract.
- A rejected form is shown as a `rip fail` block with the message
  fragment the compiler gives, so the reference teaches errors too.

### Outline

1. **Orientation** (half a page). Rip compiles to JavaScript, runs on
   Bun, browser-safe subset in the page. How to compile (`rip -c`), run,
   and read an error.
2. **Bindings.** `=` (and why assigning an outer name writes it), `=!`,
   `:=`, `~=`, `~>`, destructuring, the one-binding-per-scope rule.
3. **Calls and functions.** Juxtaposition and its precedence edges,
   implicit objects, `->`/`=>`, implicit `it`, implicit return and how a
   bang name (`name! = ->`) opts out, `def`, splats, defaults.
4. **The sigils, disambiguated.** One table for every meaning of `!`,
   `?`, `~`, `@`, `:`, `<=>`, `<~`, each linked to its entry.
5. **Operators and precedence.** `and`/`or`/`not`/`is`/`isnt`, `then`/
   `else`, `??`, `?=`, `in`/`of`, `%%`, `**`, ranges and slices, `=~` and
   `_`, symbols, `%w[]`, `$"…"`, tagged templates; a precedence ladder.
6. **Control flow.** Conditional expressions (preferred: `if c then a
   else b`; equivalent: `c ? a : b`, `a if c else b`), `unless`,
   `switch/when`, loops, ranges with `by`, comprehensions (and why chained
   `for` clauses nest), inline `try`, what rejects (`return` inside a
   value-position lowering).
7. **Async.** `f!`, `f! x`, `x.m!`, `?!`, `for … as!`, `import!`; the
   missing-`!` trap with the safe pattern.
8. **Modules and the stdlib.** `import`/`export` forms, `rip/<pkg>`
   resolution, the ambient stdlib (`p`, `pp`, `pj`, `pr`, `kind`, `sleep`,
   `rand`, `zip`, `assert`, `abort`, `raise`, `todo`, `warn`, `noop`,
   `exit`) and where each comes from.
9. **Classes.** `class`, `extends`, `constructor: (@x) ->`, statics,
   fields, `super`.
10. **Types.** Annotations, `type` blocks, generics, `as`, `satisfies`;
    how much checking `rip check` does.
11. **Components.** Members (props, state, computeds, methods, effects,
    `offer`/`accept`, lifecycle), with the declaration-order rule.
12. **Templates.** Tags, `.class`/`#id`, attributes, bare words, `= expr`
    text, `@event: handler` and bare `@event`, `key:`, `ref:`, `class:`,
    `style:`, `<=>`, `if`/`for`/`switch` in render, children, and what
    each compiles to. Preferred handler forms (bare arrow for one
    statement; a method for more).
13. **Reactivity semantics.** Tracking, batching, laziness, effect
    cleanup (a returned function is the cleanup — the trap when a last
    line yields one), `getEffectSignal`.
14. **Schemas.** Field lines, modifiers, ranges, defaults, unions, arrays,
    markers (`@unique`, `@times`, relations), `parse`/`safe`/`pick`,
    coercers.
15. **The ORM.** Queries, persistence, relations, transactions — the
    calls, with links to docs/ORM.md for depth.
16. **Rip Sites.** Routes, `read`, `error`, middleware, request context.
17. **Rip App.** Stash, `source`, `createMutation`, routes and layouts.
18. **Errors you will meet.** The twenty most common compiler errors,
    each with its cause and fix.
19. **Silent-failure traps.** The short list, collected: missing `!`, the
    effect-cleanup return, outer-name assignment, `x ? y` (not a default),
    and every trap PROBLEMS.md confirms.

## How it stays true

- **Doc-test.** A test (`test/toolchain/reference.test.js`, in the fast
  loop) extracts every `rip`/`js` pair from `docs/REFERENCE.md`, compiles
  the Rip, normalizes both sides as the `code` rows do, and fails on any
  difference; every `rip fail` block must reject with its stated
  fragment. An example that no longer compiles, or compiles differently,
  fails the fast loop in the commit that changed the compiler.
- **Coverage gate.** The parser exports its 75 AST kinds (`kinds`). The
  doc-test maps each kind to at least one reference entry and fails when
  a kind has none, so a new construct cannot land undocumented.
- **Lockstep rule.** AGENTS.md gains one line beside its editor-grammar
  rule: a change that adds or alters surface syntax updates
  `docs/REFERENCE.md` in the same change. The doc-test and coverage gate
  enforce it.
- **Budget gate.** The doc-test fails above a fixed size (about 15,000
  tokens, measured as words × 1.4), so growth stays deliberate.

## Sources of truth

The reference summarizes; it never becomes a second specification.

| Area | Owner it summarizes |
|---|---|
| Syntax and semantics | `test/rip/*.rip` (39 suites, about 3,500 rows): schema 444, components 317, control 204, operators 196, loops 151 … |
| Types and editor-visible behavior | docs/TYPES.md |
| Schema and ORM | docs/ORM.md, test/rip/schema.rip |
| Publication, App, HMR | docs/WORKSPACE.md, docs/HMR.md, packages/app/README.md |
| Sites | docs/SERVER.md, packages/sites/README.md |
| Stdlib globals | src/runtime/stdlib.js |

Each entry's **Pins** line points at its owner. Where the owner and the
compiler disagree, the compiler's behavior is recorded and the
disagreement goes to PROBLEMS.md.

## Preferred forms

Rip keeps several spellings of some constructs, and the reference keeps
them all valid. It names one preferred form per construct so agents and
reviewers converge, and lists the rest as equivalent:

| Construct | Preferred | Equivalent |
|---|---|---|
| Logical or / and | `or`, `and` | `\|\|`, `&&` |
| Inequality | `isnt` | `!=` |
| Nullish assignment | `?=` | `??=` |
| Conditional expression | `if c then a else b` | `c ? a : b`, `a if c else b` |
| One-statement handler | `@click: -> @go()` | `@click: (-> @go())` |
| Multi-statement handler | a method (`onSubmit: (e) ->`) | `(-> a(); @b())`, `-> a(); @b()` |

`then`/`else` (low-precedence) and `??` (nullish) are **not** in this
table: they differ in meaning from `and`/`or`, and the reference says so.
A formatter or lint mode that steers toward the preferred column is a
separate plan.

## Measuring it

Rerun the cold-read experiment as a standing benchmark:

- **Agents:** fresh, with no repository access beyond what each arm
  provides.
- **Arms:** (A) the 40-program corpus only — the 2026-10-08 baseline; (B)
  the corpus plus `docs/REFERENCE.md`; (C) the reference alone.
- **Tasks:** the original three (a reactive todo component, a `Note`
  model with routes, a key=value parser with tests), plus a growing set
  covering templates, async, schemas and Sites middleware.
- **Scored:** first-try compile rate, tests passed, a count of silent
  traps hit (a missing `!` on an awaited call, an effect whose last line
  is a function), and spelling against the preferred column.
- **Baseline (arm A):** 4/6 first-try compiles, 19/19 tests; both
  failures were the template `;` defect (fixed in #434).
- **Target:** arm B at 6/6 first-try compiles with zero silent traps.

Results live with the benchmark harness and are rerun when the reference
or the language changes materially. It is a measurement, not a merge
gate.

## Order of work

1. **Harness first.** The doc-test, the coverage gate and the budget gate
   against a skeleton `docs/REFERENCE.md` with one verified entry.
2. **Core language** (outline 2–10), drafted from the `test/rip` suites;
   every example verified as it lands.
3. **Components, templates, reactivity** (11–13).
4. **Platform** (14–17), deferring depth to the owning docs.
5. **Errors and traps** (18–19), seeded from PROBLEMS.md.
6. **Lockstep rule** added to AGENTS.md once the coverage gate is green.
7. **Benchmark** arms B and C; record against the baseline.

## Open questions

- **Delivery beyond the repo.** Ship the reference with the VS Code
  extension, print it from `rip --reference`, or both, so an agent
  working in another project can load it.
- **Budget.** 15,000 tokens is a starting bound; the benchmark decides
  whether a shorter reference teaches as well.
- **Preferred forms.** The table above is a proposal for the owner to
  confirm; it chooses words, not syntax.
