# Editor-surface rulings — what the editor answers at rip-native positions

The decided answers where no TypeScript oracle exists: the render DSL, schema bodies, rip's reactive vocabulary — and the semantic-token cases where rip's spelling and its lowering disagree.

**This file is the intent; the pins are the measurement.** `hover-pins.json` records what the editor serves — top-level declarations in its `decls` sections, the RULINGS-governed in-body positions in its `positions` sections (the Hover Audit's `ruled` gauge) — every row hand-maintained and reviewed against this file (no mechanical re-pin exists; the run prints paste-ready rows, and adopting one is an explicit edit); a fixture comment beside a governed line cites its row here. A pin diverging from a ruling is either an unimplemented target (the pin asserts the interim) or a wrong pin — never an ambiguous ruling. Rulings change here first; pins follow, never the reverse.

## Principles

- **Typed channel answers are the target.** A semantic DSL word (`ref:`, `key:`, `slot`, a bind target, an event word, an element tag) gets a real, typed answer describing its channel — `ref — writes HTMLInputElement into inputEl` — naming the user's own binding, never a category noun — the way TSX explains a JSX attribute. Not silence-as-policy, not another ecosystem's type vocabulary.
- **The interim is silence, only.** Until the target is servable, the position serves nothing and its pin asserts null. A wrong answer — the cover's symbol, a fabricated entity, a machinery name — is never a stand-in.
- **Rip mints its own kind labels**, mirroring TypeScript's: `(field)`, `(state)`, `(computed)` — a schema field is never mislabeled `(property)`.
- **Punctuation is silent, permanently** — the `!`/`?` markers carry no hover.
- **Hovers are signatures, not sentences.** The register is TypeScript's own: the term, its type, at most a few words of gloss (`key: string | number — row identity`). Never tutorial prose — a hover that explains behavior in a full sentence is talking down, and one that names a concept no doc teaches is talking past.
- **Value positions get plain answers.** A render loop variable, `ctx`, an event param, the state behind a bind, `it` in a transform: the inferred type, no DSL dressing.

## Reactive

The declaration hovers here have an honest interim that is not silence: the plain `let`/`const` value-type answer is TRUE — it misses only the minted kind. The interim-is-silence rule bans wrong answers as stand-ins; a truthful answer short of its target is pinned-or-twin-validated as the interim, and the divergence arrives with the minted label. These rows govern the exported spellings identically (driven 2026-07-23: `export` changes nothing on the hover surface).

| position | ruling (target) | interim |
| --- | --- | --- |
| `:=` name at its declaration (plain, annotated, opt-marked) | `(state) count: number` — minted kind, value type | `let count: number` — the plain-TS twin agrees live, so no pin |
| `~=` name at its declaration | `(computed) doubled: number` | `const doubled: number` — twin agrees, no pin |
| `=!` name at its declaration | `(readonly) limit: 100` — the literal type stands: a readonly binding is a const, and const infers the literal, TS's own convention | `const limit: 100` — twin agrees, no pin |
| named `~>` at its declaration | `(effect) logger: () => void` — the disposer is the binding's value | `const logger: () => void` — twin agrees, no pin |
| bare `~>` operator | silence — punctuation is silent, permanently | served: null, the ruled silence — the bare-effect finding closed (the server once leaked the runtime's `__effect` signature here) and the contract's hover.silence now gates any leak at zero; the gate is the record |
| the `?` opt marker on a reactive binding | silence | — |
| an IMPORTED reactive name at a read | the cell's own type — the importer holds the CELL, and `.value` is the contract. Reactivity is module-scoped by construction: `collectReactiveNames` builds the deref set from the declaring scope's OWN names, so an importer emits the binding verbatim; and the cell's primitive-coercion protocol has exactly one beneficiary — a consumer holding a raw cell, since in-module reads compile to `.value` and never coerce. Both mechanisms already lean this way. The alternative (reactivity metadata crossing the module boundary so importers deref) is the ruling this forecloses, not a default | served — the face names the cell, which is what the importer holds. v3 emits the same bare binding and answers `(alias) const count: any` at the read; v4's cell type is the truthful one of the two. **Accepted limit:** arithmetic on the bare cell RUNS (the coercion protocol) and cannot type-check — TypeScript requires an operand to BE number-ish, not to be coercible, so no cell-type spelling admits it. `.value` satisfies both halves |

## Components / render

Measured 2026-07-23 over 13-components (the `ruled` gauge, hover-pins.json's `positions`), re-measured 2026-07-30 at the member declarations, where 25-components carries the generic spelling — a component's type parameters ride into the containing type the answer names, which 13-components has no component to show. The render-DSL finding closed: at every position with no user symbol the editor now DECLINES — the null pins measure green and the contract's hover.ruled gates them (the machinery the cover once leaked — the cover's `this`, `_elN` locals, the `__bind_value__` slot, the gate key-fn's params — is what the decline replaced). The typed-channel TARGETS below stay unserved; the null interim is what is pinned.

**A declaration speaks the author's vocabulary; a consumer's read speaks the container's.** A member declared `people := []` is an array where the author wrote it, and the editor answers value-first there. That is not a claim the container is a fiction — a consumer holding an instance really does write `inst.people.value`, and at THAT position the container is the honest answer and passes through untouched. The two resolve to the same face symbol, so the compiler records which is which (`memberDecls`, src/emitter.js). The value-first half is served; the minted kind label is the open half of every member row below.

| position | ruling (target) | interim |
| --- | --- | --- |
| `ref` in `input ref: inputEl` | `ref — writes <ElementType> into inputEl` (the user's own binding name) | null pin — served (the editor declines; the machinery leak closed with the render-DSL finding); gated: hover.ruled |
| the name after `ref:` | the state binding, `<ElementType> \| null` | null pin — served (the editor declines; the machinery leak closed with the render-DSL finding); gated: hover.ruled |
| `key:` in a render loop | `key: string \| number — row identity` | null pin — served (the minted scaffold local no longer leaks); gated: hover.ruled |
| `slot` | `slot — the component's children`, typed where expressible | null pin — served (the editor declines; the machinery leak closed with the render-DSL finding); gated: hover.ruled |
| element tag (`div`, `input`) | intrinsic element hover, TSX-style | null pin — served (the editor declines; the machinery leak closed with the render-DSL finding); gated: hover.ruled |
| attr name on an intrinsic (`class:`) | the prop's type | null pin — served (the editor declines; the machinery leak closed with the render-DSL finding); gated: hover.ruled |
| prop name at a component use (`label:`) | the prop's type | pinned as measured — the props surface's declared type; the bind-slot arm rides the union by design |
| event word (`click`) | the handler signature, event type included | null pin — served (the editor declines; the machinery leak closed with the render-DSL finding); gated: hover.ruled |
| bind target (`value` in `value <=> count`) | `value <=> — two-way bind, <prop type>` | null pin — served (the `__bind_value__` slot no longer leaks); gated: hover.ruled |
| the name in a bind (`count`) | its VALUE type — never the wrapper | null pin — served (the bind cover's `__bind_value__` no longer leaks); gated: hover.ruled |
| render loop variable at a read | plain inferred type | pinnable, unpinned — see the note below the tables |
| member reads in branch/loop bodies (the factory's `ctx` is minted — no source position carries it) | plain inferred type | pinnable, unpinned — see the note below the tables |
| member declaration (state, readonly, prop, ref cell) | minted kind, value-first — `(state) people: string[]` | pinned as measured — `(property) Roster.people: string[]`, the value half served; the minted kind is the open half |
| member declaration (computed, unannotated) | the same — `(computed) shade: string` | pinned null — the face types an unannotated computed through the lowering's behavior object, so every spelling of its value type names machinery, which is never a stand-in; the computed-projection finding |
| gate target name (`stats <~ …`) | minted kind, value-first — the kind label undecided | pinned as measured — the value half served; the kind label is the open half |
| gate operator `<~` and `@app.data` path segments | silence | pinned null — green, measured 2026-07-23 |
| gate key (`params.id` / `@query.tab`) | plain inferred type | null pin — served (the minted key-fn's param no longer leaks); gated: hover.ruled |
| component name at a use site | the component's signature (props) | pinned null — green, measured 2026-07-23; the pin asserts the interim |
| `offer` / `accept` | **PARKED** — model not settled; minimal grammar coverage, no pin | no pin |

## Schema

Measured 2026-07-23 over 14-schema's spellings (the `ruled` gauge, hover-pins.json's `positions`). The schema body is wholesale silent today — every in-body position serves null, which IS the ruled interim — so the null pins are green while the minted-kind targets stay unserved; no finding holds them, the component-name-at-use-site precedent. The declaration and companion-type rows serve truthful answers and pin as measured, the `:mixin` declaration included — its spelling is the one row here carried as a PROPOSAL rather than a settled ruling.

| position | ruling (target) | interim |
| --- | --- | --- |
| schema name at declaration | type-first: structure leads, value nature noted after | pinned as measured (`decls`) — the value-first `let Person: Schema<Person, Person>` is truthful short of the target, the reactive doctrine |
| schema name at declaration (`:mixin`) | `MixinSchema<Stamped>` — user vocabulary, and no more surface than the runtime serves. A mixin is not instantiable: driven against the runtime 2026-08-03, `parse()` throws, `safe()` always fails, `ok()` is always false — so the interface carries NO parse surface. What it does carry is what answers: `toJSONSchema()` and the projection algebra — `pick`/`omit`/`partial`/`required`/`extend` — since `__schemaDerive` refuses only `:union` and `:enum` (the interface stopped promising less than it serves, 476133e). `Schema<Stamped, Stamped>` would promise the parse surface the runtime refuses, which is the reason this row stayed open; the type parameter names the shape the mixin contributes | served — the pin asserts `let Stamped: MixinSchema<Stamped>` |
| field name (`name! string`) | `(field) name: string`, required/optional visible | pinned null — green, measured 2026-07-23 |
| field type word | the type, same as an annotation | pinnable, unpinned — see the note below the tables |
| `!` / `?` markers | silence — punctuation is silent, permanently | pinned null — green, measured 2026-07-23 |
| default-value expression | normal expression hovers | pinned null — silence today, measured 2026-07-23; the pin moves the day expression hovers reach the default bracket |
| computed field name | `(computed) total: number` | pinned null — green, measured 2026-07-23 |
| `it` in a transform | `it: <input record>` — the record under validation (driven 2026-07-23: a transform receives the whole raw record, never the field's own value) | pinned null — green, measured 2026-07-23 |
| companion type at a use site | the structural type, expanded like any alias | pinned as measured — the annotation position serves the full expansion (the target, already served); a value-position use serves the schema value's own type, the plain-answer rule |

"Pinnable, unpinned": the identifier-read span these positions waited on has landed, so each now HAS a source position to answer at. What the server serves there is unmeasured — the pin is the measurement, and adopting one is an explicit reviewed edit, so these rows stay unpinned until someone drives them.

**`[null]` defaults widen the face — RULED (2026-08-03), a deliberate compat break.** A non-`!` field whose default is `[null]` types as `T | null` in the companion type and the shipped .d.ts, because that is what the runtime already delivers: `parse` substitutes the default on undefined OR null, so every default-taking parse of such a field answers null, and main's narrower `invite?: string` was a lie about unchanged runtime behavior. Types follow the runtime, even when correcting the lie changes a shipped surface; consumers who compiled against the old face were compiling against a false claim. Under `!` the widening is skipped — a required field never takes the default path that produces the null.

## Tokens

The semantic token names the construct the user DECLARED, judged at rip's level — never the binding operator alone, and never the lowering alone. The measuring invariant is the Token Audit's `expectedToken` (runner.js); these rows are the decided cases.

| position | ruling | today |
| --- | --- | --- |
| exported plain binding (`export flag = 1`) | `readonly` — the emission is `export const` by the emitter's stated design, and no writable exported plain binding exists | the invariant expects readonly in export position; the export-reassignment row in FINDINGS.md owns the loud-rejection half, and a writable-exports ruling would flip this row with the emission |
| class-expression binding (`Blank = class`) | token type `class` — the spelling itself declares a class; tsgo's classification is correct | the invariant expects `class` |
| cast to a constructor type (`X = value as new () => …`) | no expectation — variable by spelling, class by shape; dual like `X = schema` | reported, never scored |
| enum name (`enum Direction`) | token type `enum`, and no `readonly` — the declared construct, at its declaration, in an annotation and at a value use alike; neither half of the lowering (the const object, the companion type alias) may leak into the color | served, measured 2026-07-30 — the editor repaints the merged symbol tsgo classifies `type` |
| state name at ANY occurrence (the `count := 0` declaration, the `count = 5` write, a read) | no `readonly` modifier — `readonly` describes the BINDING, not the position, and a `:=` binding is writable in rip; the lowering's const cell must not leak into the color. Clearing it at the declaration alone would paint one binding in two colors, with the write — the position that PROVES the classification false — keeping the wrong one | served at every occurrence, measured 2026-07-30; the invariant scores declarations and use sites in one verdict |
| named effect binding, unannotated (`watcher ~> …`) | token type `function`, with `readonly` — the binding's value is the disposer, a callable; tsgo's classification of the value is the informative answer, the class-expression doctrine | the invariant expects `function` in every form, inline and carried alike |
| named effect binding, annotated (`logger: Function ~> …`) | the annotation governs the classification — tsgo's own rule, identical on the equivalent plain-TS line | reported, never scored — dual like `X = schema`; asserting against the annotation is an expectation the audit cannot defend |

## Disk — the editor's writes

Not a hover surface, but the same convention: the decided answer, recorded where a reviewer can cite it. These rulings were carried only in commit messages and test prose until 2026-08-03.

- **Faces are lazy, candidacy is eager — RULED (bc88d03).** A workspace that contains .rip source gets its `.rip/` mirror tree — auto-import stubs included — written at session start, before any document is opened: candidacy is a workspace property, not a per-document event. Real faces still materialize only when a document forces them. The territory doctrine bounds the eagerness: every write stays inside `.rip/`, a workspace with no .rip source is never written to, stub bytes are declaration-only, and a stub never shadows a real face nor buys diagnostic silence. Gates: packages/vscode/test/project-model.test.js (territory, eager candidacy), test/toolchain/auto-import.test.js (stub-never-shadows, stub-never-buys-silence).
