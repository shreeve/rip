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
| bare `~>` operator | silence — punctuation is silent, permanently | today serves the runtime's `__effect` signature, a machinery leak; the open bare-effect finding (FINDINGS.md) holds it |
| the `?` opt marker on a reactive binding | silence | — |

## Components / render

Measured 2026-07-23 over 32-components (the `ruled` gauge, hover-pins.json's `positions`). Two findings hold the red pins: the render-DSL finding (positions with no user symbol serve minted scaffold — the cover's `this`, `_elN` locals, the `__bind_value__` slot, the gate key-fn's params) and the member-wrapper finding (member declarations and gate targets serve the container wrapper where the value-type answer is the only truthful interim).

| position | ruling (target) | interim |
| --- | --- | --- |
| `ref` in `input ref: inputEl` | `ref — writes <ElementType> into inputEl` (the user's own binding name) | null pin — today the cover's `this`; the render-DSL finding |
| the name after `ref:` | the state binding, `<ElementType> \| null` | null pin — today the cover's `this`; the render-DSL finding |
| `key:` in a render loop | `key: string \| number — row identity` | null pin — today a minted scaffold local; the render-DSL finding |
| `slot` | `slot — the component's children`, typed where expressible | null pin — today the cover's `this`; the render-DSL finding |
| element tag (`div`, `input`) | intrinsic element hover, TSX-style | null pin — today the cover's `this`; the render-DSL finding |
| attr name on an intrinsic (`class:`) | the prop's type | null pin — today the cover's `this`; the render-DSL finding |
| prop name at a component use (`label:`) | the prop's type | pinned as measured — the props surface's declared type; the bind-slot arm rides the union by design |
| event word (`click`) | the handler signature, event type included | null pin — today the cover's `this`; the render-DSL finding |
| bind target (`value` in `value <=> count`) | `value <=> — two-way bind, <prop type>` | null pin — today the minted `__bind_value__` slot; the render-DSL finding |
| the name in a bind (`count`) | its VALUE type — never the wrapper | null pin — today the bind cover's `__bind_value__`; the render-DSL finding |
| render loop variable at a read | plain inferred type | blocked on the identifier-read finding |
| member reads in branch/loop bodies (the factory's `ctx` is minted — no source position carries it) | plain inferred type | blocked on the identifier-read finding |
| member declaration (state, computed, readonly, prop, ref cell) | minted kind, value-first — `(state) people: string[]` | null pin — the container wrapper is a leak (member-wrapper finding); the value-type answer is the only truthful interim |
| gate target name (`stats <~ …`) | minted kind, value-first — the kind label undecided | null pin — wrapper leak; the member-wrapper finding |
| gate operator `<~` and `@app.data` path segments | silence | pinned null — green, measured 2026-07-23 |
| gate key (`params.id` / `@query.tab`) | plain inferred type | null pin — today the minted key-fn's own param; the render-DSL finding |
| component name at a use site | the component's signature (props) | pinned null — green, measured 2026-07-23; the pin asserts the interim |
| `offer` / `accept` | **PARKED** — model not settled; minimal grammar coverage, no pin | no pin |

## Schema

Measured 2026-07-23 over 33-schema's spellings (the `ruled` gauge, hover-pins.json's `positions`). The schema body is wholesale silent today — every in-body position serves null, which IS the ruled interim — so the null pins are green while the minted-kind targets stay unserved; no finding holds them, the component-name-at-use-site precedent. The declaration and companion-type rows serve truthful answers and pin as measured — except the `:mixin` declaration, which serves the runtime's own class; the mixin-declaration finding (FINDINGS.md) holds that pin.

| position | ruling (target) | interim |
| --- | --- | --- |
| schema name at declaration | type-first: structure leads, value nature noted after | pinned as measured (`decls`) — the value-first `let Person: Schema<Person, Person>` is truthful short of the target, the reactive doctrine |
| schema name at declaration (`:mixin`) | user vocabulary, never the machinery — the exact spelling undecided: a mixin has no parse surface, so `Schema<…>` would over-promise | pinned as measured (`decls`) — `let Stamped: __SchemaDef` is a leak; the mixin-declaration finding (FINDINGS.md) holds it |
| field name (`name! string`) | `(field) name: string`, required/optional visible | pinned null — green, measured 2026-07-23 |
| field type word | the type, same as an annotation | blocked on the identifier-read finding |
| `!` / `?` markers | silence — punctuation is silent, permanently | pinned null — green, measured 2026-07-23 |
| default-value expression | normal expression hovers | pinned null — silence today, measured 2026-07-23; the pin moves the day expression hovers reach the default bracket |
| computed field name | `(computed) total: number` | pinned null — green, measured 2026-07-23 |
| `it` in a transform | `it: <input record>` — the record under validation (driven 2026-07-23: a transform receives the whole raw record, never the field's own value) | pinned null — green, measured 2026-07-23 |
| companion type at a use site | the structural type, expanded like any alias | pinned as measured — the annotation position serves the full expansion (the target, already served); a value-position use serves the schema value's own type, the plain-answer rule |

"Blocked on the identifier-read finding": pinnable when that fix lands (see FINDINGS.md).

## Tokens

The semantic token names the construct the user DECLARED, judged at rip's level — never the binding operator alone, and never the lowering alone. The measuring invariant is the Token Audit's `expectedToken` (runner.js); these rows are the decided cases.

| position | ruling | today |
| --- | --- | --- |
| exported plain binding (`export flag = 1`) | `readonly` — the emission is `export const` by the emitter's stated design, and no writable exported plain binding exists | the invariant expects readonly in export position; the export-reassignment row in FINDINGS.md owns the loud-rejection half, and a writable-exports ruling would flip this row with the emission |
| class-expression binding (`Blank = class`) | token type `class` — the spelling itself declares a class; tsgo's classification is correct | the invariant expects `class` |
| cast to a constructor type (`X = value as new () => …`) | no expectation — variable by spelling, class by shape; dual like `X = schema` | reported, never scored |
| enum name (`enum Direction`) | token type `enum` — the declared construct; the lowering's companion type must not leak into the color | the invariant expects `enum` and stays red; the open enum-token finding (FINDINGS.md) holds the server's reclassification |
| state name at a WRITE site (`count = 5` off `count := 0`) | no `readonly` modifier — the binding is writable in rip; the lowering's const cell must not leak into the color | the server clears `readonly` on declaration spans only, so the write site still carries it; the open use-site-readonly finding (FINDINGS.md) holds the correction's reach |
| named effect binding, unannotated (`watcher ~> …`) | token type `function`, with `readonly` — the binding's value is the disposer, a callable; tsgo's classification of the value is the informative answer, the class-expression doctrine | the invariant expects `function` in every form, inline and carried alike |
| named effect binding, annotated (`logger: Function ~> …`) | the annotation governs the classification — tsgo's own rule, identical on the equivalent plain-TS line | reported, never scored — dual like `X = schema`; asserting against the annotation is an expectation the audit cannot defend |
