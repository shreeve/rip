# Editor-surface rulings — what the editor answers at rip-native positions

The decided answers where no TypeScript oracle exists: the render DSL, schema bodies, rip's reactive vocabulary — and the semantic-token cases where rip's spelling and its lowering disagree.

**This file is the intent; the pins are the measurement.** `hover-pins.json` records what the editor serves, reviewed against this file; a fixture comment beside a governed line cites its row here. A pin diverging from a ruling is either an unimplemented target (the pin asserts the interim) or a wrong pin — never an ambiguous ruling. Rulings change here first; pins follow, never the reverse.

## Principles

- **Typed channel answers are the target.** A semantic DSL word (`ref:`, `key:`, `slot`, a bind target, an event word, an element tag) gets a real, typed answer describing its channel — `ref — writes HTMLInputElement into inputEl` — naming the user's own binding, never a category noun — the way TSX explains a JSX attribute. Not silence-as-policy, not another ecosystem's type vocabulary.
- **The interim is silence, only.** Until the target is servable, the position serves nothing and its pin asserts null. A wrong answer — the cover's symbol, a fabricated entity, a machinery name — is never a stand-in.
- **Rip mints its own kind labels**, mirroring TypeScript's: `(field)`, `(state)`, `(computed)` — a schema field is never mislabeled `(property)`.
- **Punctuation is silent, permanently** — the `!`/`?` markers carry no hover.
- **Hovers are signatures, not sentences.** The register is TypeScript's own: the term, its type, at most a few words of gloss (`key: string | number — row identity`). Never tutorial prose — a hover that explains behavior in a full sentence is talking down, and one that names a concept no doc teaches is talking past.
- **Value positions get plain answers.** A render loop variable, `ctx`, an event param, the state behind a bind, `it` in a transform: the inferred type, no DSL dressing.

## Components / render

| position | ruling (target) | interim |
| --- | --- | --- |
| `ref` in `input ref: inputEl` | `ref — writes <ElementType> into inputEl` (the user's own binding name) | null pin |
| the name after `ref:` | the state binding, `<ElementType> \| null` | measure, then pin |
| `key:` in a render loop | `key: string \| number — row identity` | null pin |
| `slot` | `slot — the component's children`, typed where expressible | null pin |
| element tag (`div`, `input`) | intrinsic element hover, TSX-style | null pin |
| attr/prop name | the prop's type | measure, then pin |
| event word (`click`) | the handler signature, event type included | measure, then pin |
| bind target (`value` in `value <=> count`) | `value <=> — two-way bind, <prop type>` | null pin |
| the name in a bind (`count`) | its VALUE type — never the wrapper | measure, then pin |
| render loop variable at a read | plain inferred type | blocked on the identifier-read finding |
| `ctx` (branch factory param) | plain inferred type | measure, then pin |
| component name at a use site | the component's signature (props) | measure, then pin |
| `offer` / `accept` | **PARKED** — model not settled; minimal grammar coverage, no pin | no pin |

## Schema

| position | ruling (target) | interim |
| --- | --- | --- |
| schema name at declaration | type-first: structure leads, value nature noted after | measure, then pin |
| field name (`name! string`) | `(field) name: string`, required/optional visible | measure, then pin |
| field type word | the type, same as an annotation | blocked on the identifier-read finding |
| `!` / `?` markers | silence | — |
| default-value expression | normal expression hovers | — |
| computed field name | `(computed) total: number` | measure, then pin |
| `it` in a transform | `it: T` — the field's value type | measure, then pin |
| companion type at a use site | the structural type, expanded like any alias | measure, then pin |

"Measure, then pin": current behavior undriven — no pin lands on an unmeasured today. "Blocked on the identifier-read finding": pinnable when that fix lands (see FINDINGS.md).

## Tokens

The semantic token names the construct the user DECLARED, judged at rip's level — never the binding operator alone, and never the lowering alone. The measuring invariant is the Token Audit's `expectedToken` (runner.js); these rows are the decided cases.

| position | ruling | today |
| --- | --- | --- |
| exported plain binding (`export flag = 1`) | `readonly` — the emission is `export const` by the emitter's stated design, and no writable exported plain binding exists | the invariant expects readonly in export position; the export-reassignment row in FINDINGS.md owns the loud-rejection half, and a writable-exports ruling would flip this row with the emission |
| class-expression binding (`Blank = class`) | token type `class` — the spelling itself declares a class; tsgo's classification is correct | the invariant expects `class` |
| cast to a constructor type (`X = value as new () => …`) | no expectation — variable by spelling, class by shape; dual like `X = schema` | reported, never scored |
| enum name (`enum Direction`) | token type `enum` — the declared construct; the lowering's companion type must not leak into the color | the invariant expects `enum` and stays red; the open enum-token finding (FINDINGS.md) holds the server's reclassification |
