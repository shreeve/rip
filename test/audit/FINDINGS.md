# Audit findings — the open gaps in rip's typed-editor story

**A road, not a record.** A finding lives here until its gate is green; then its body is deleted and one line stays in [Closed](#closed). **The end state of the road is empty** — whether the Closed table drains with it is undecided. Everything a closed finding knew lives in the gate that holds it and in the commit that filed it — this file is not where that knowledge is kept, it is where the work that has not landed yet is queued.

## How to read this ledger

**Why this file exists at all.** `bun test` verifies rip against **rip** — every expectation in it was authored, so it checks only what its author already knew, and it was green through every finding recorded here (hence the *"why the suite missed it"* paragraphs below). The audit verifies rip against **TypeScript**, through oracles this repo does not control — the hand-written twin, the source's own grammar, TypeScript's own diagnostics over the error lane — which is why it can discover, and why its output is a categorized diff rather than a pass/fail boolean. The findings are that diff, written down.

**The Gate column is load-bearing, and it is the exit.** ✅ **Verified means a named gate runs and passes** — nothing else earns it, not a code reading, not a scratch script, not a plausible argument. Read in both directions that is the whole membership contract: a finding with no gate cannot be Verified however obviously fixed it looks, and a finding whose gate *is* green does not stay. **This file is the queue of constraints not yet expressible as a passing test.** Every claim here *is* reachable that way, because each is a compiler output or a server payload and LSP carries all of them — a `textDocument/hover` response *is* the text VS Code renders; the reflex to call a claim "editor-only" is usually an unwritten test, not an unreachable one. One gate is red *by design* (#21) and its row stays until it flips — read each row's Gate cell, because a red gate does not always track only its own finding. One row (#23) has no gate because its own subject does not fail — the probe round's one driven defect is a separate row (#41) with its own exit — so #23's exit is a ruling rather than a green run, unless the open question in its body answers yes and hands it an ordinary gate.

**A fix closes the root, and the test is where the datum lands** — into the **face**, where every consumer reads it, or into the one response. A gate cannot tell them apart: a mitigation makes its payload correct without supplying the datum that was missing. The Tier 3 probe (#23) feeds tsgo's answers back through `compile()` as pins, so **a query is not the tell** — across an out-of-process checker it is the only route to a type at all; `enrichEvolvingAnyHover` ([server.js](../../packages/vscode/src/server.js)) returns a reference's hover in place of an `any` and touches nothing else. Same shape, opposite verdicts. The other tell is scope: one root leaves four surfaces wrong in #21, so greening one closes nothing, and **a mitigation's residue is not the finding** — a row restated around what the workaround could not reach reads as progress, and is how a workaround becomes the architecture. Nor is the root always in the compiler (#13's is `generatedMirror`, #16's is inside tsgo): *upstream* is where to look, not the rule. Diagnose the root, state it in the body, and make the gate measure **that** — one aimed at a symptom can be satisfied by a patch, and eventually is.

**IDs are doc-internal** — nothing outside this file cites one (a row is engineered to disappear), and numbers are never reused or renumbered: the filing commit is the durable provenance. [findings.test.js](../toolchain/findings.test.js) enforces and explains this.

**Completeness — five slots, every row, gated.** A row is not a report of a symptom; it is everything the person who fixes it would otherwise have to rediscover. Each slot is recognized by its marker, because a section a gate cannot see goes missing silently — which is how a row shipped with its symptom driven and its root never diagnosed.

| slot | marker | what it holds |
| --- | --- | --- |
| root | `**Why (code)` | what in the code produces this, cited by file and symbol |
| fix | `**The fix` | where it belongs, what it must NOT do, and a precedent if one exists — or, where the fix needs a decision, the ruling required and who makes it |
| escape | `**Why the suite missed it` | which instrument should have caught it, and why it did not |
| prior | `**vs v3` | driven both sides, or explicitly why v3 cannot be asked |
| exit | `**Status.**` | open date, and the gate (or an honest none, plus what the fix's gate would be) |

**Root and fix are separate slots on purpose.** They are easy to merge into one paragraph and the merge costs the two most valuable sentences: *what the fix must not do*, and *which precedent it should follow*. Both are earned by driving, exist nowhere in the code, and die with the body — #21's "do not solve this at query time" and #26's "softening the annotation is the one fix this row rules out" are the shape. A prescribed fix is the root's proof, too: a root that cannot be turned into a fix shape is not diagnosed yet. What a row must NOT carry is the diff — a prescribed implementation is a prediction, and reads as wrong the day someone fixes it another way.

**A slot with nothing to say is still filled, honestly.** "Root not diagnosed, and here is what would settle it" is complete; silence is not.

**Tags group by root** — `compiler` (parser/emitter) · `strict` (implicit-any & safety) · `directive` (the `@ts-expect-error` family) · `hoist` · `config` · `editor` · `capability`. Labels, not partitions: a row that shares a fix with two roots carries both.

**Conventions.** Code is cited by file and symbol, **never by line number** — greppable, and survives an edit above it; when a cited symbol is deleted, say so at the citation. Gates are cited by name and by whether they are green, **never by pass count** — counts drift when a fixture is added, going stale while the finding has not changed. **Positions** are LSP coordinates (**1-based line, 0-based column**), what the gates assert and the editor consumes; `rip check` prints 1-based/1-based, so the same diagnostic reads one column higher there.

**vs v3.** A **vs v3** line records what the typed editor did before the tsgo/LSP broker replaced v3's in-process LanguageService — the root almost every gap here traces back to. Each was established by driving v3, still reachable at 3.17.5 (`~/Code/shreeve/rip-lang`). It survives on an open row because it argues about a fix not yet made; it dies with the body when the row closes. This repo is **v4, cleaned up**; "v4" in a body means the code here.

**Re-driving.** `bun run test:all` — green as of 2026-07-18. It sets `RIP_EXTENDED=1` itself, the tier where the tsc-backed gates spawn the repo's pinned TypeScript, resolved from the workspace install ([tsc.js](../support/tsc.js) `resolveTsc`) rather than PATH, throwing loudly rather than skipping when it is missing. An editor-path change is not live in VS Code until `bun run install-vscode` from `packages/vscode/` — the running extension is the installed `.vsix`, not the working tree. The audit itself is `bun run audit` (`--help` for what each audit is judged against; hover pins are hand-maintained per row — the run prints paste-ready rows for divergences, and adopting one is an explicit reviewed edit). The wider editor surface — completions, definition, references, rename, code actions — is covered by the extension's own suite in `packages/vscode/test/`, not here.

## The road

Ordered by **how many rip users a gap reaches**, then by how badly the editor misleads. **Order is the recommendation; the ID is only a name** — a number records when a gap was found, which says nothing about what to do next.

| # | Finding | Tags | Gate |
| --- | --- | --- | --- |
| [51](#51-a-boolean-alias-word-names-a-binding-and-every-read-becomes-the-literal) | A boolean alias word names a binding, and every read of it becomes the literal — a wrong VALUE, silently | `compiler` | **none** — the shape cannot enter a positive fixture while it miscompiles; the fix's gate is a `battery` rejection row |
| [21](#21-an-identifier-read-carries-no-source-span) | Identifier reads carry no source span — hover, definition, diagnostics, tokens | `editor`, `compiler` | `census` — **red by design**, the root all four surfaces share; `member` + `survival` on the token surface |
| [22](#22-completion-and-signature-help-fail-on-an-incomplete-expression) | Completion & signature help fail on an incomplete expression | `editor`, `compiler` | **none** — a content audit for each would catch them; neither built |
| [40](#40-a-component-members-initializer-and-in-method-writes-are-never-type-checked) | A component member's initializer and in-method writes are never type-checked | `compiler` | **none** — a `check` case asserting the silence as the gap is the honest interim, unbuilt; the fix's gate is the member negatives entering 13-components' error pair, and three parked claims rows ([CLAIMS.md](CLAIMS.md)) |
| [42](#42-a-wrong-typed-schema-default-or-transform-is-never-type-checked) | A wrong-typed schema default or transform is never type-checked | `compiler` | **none** — a `check` case asserting the silence as the gap is the honest interim, unbuilt; the fix's gate is the misdeclaration negatives entering 14-schema's error pair |
| [8](#8-auto-import-is-closure-scoped) | Auto-import closure-scoped | `capability` | `auto-import` — the gap is an **expected failure** |
| [26](#26-the-match-operators-emission-is-never-null-clean) | The match operator publishes TS2531 on every use | `compiler` | `check`'s match-operator case — asserts the TS2531 **as the gap**; it goes red the day the emission is fixed, the cue to invert it and move the operator into the corpus, where `verdict` holds it |
| [27](#27-a-pattern-catch-destructures-unknown) | A pattern catch publishes TS2339/TS2488 from its own lowering | `compiler` | **none** — the corpus parks both pattern spellings ([MANIFEST.md](MANIFEST.md)'s Parked table); a `check` case in the match-operator style is the honest interim gate, unbuilt |
| [31](#31-a-promoted-param-declares-no-field) | A promoted `@`-param declares no field — TS2339 on every member use | `compiler` | **none** — 08-functions carries promotion only alongside manual field declarations; a `check` case in the match-operator style is the honest interim gate, unbuilt |
| [52](#52-a-destructured-binding-read-by-a-hoisted-def-is-implicitly-any-under-strict) | A destructured binding read by a hoisted def is implicitly `any` under strict | `strict`, `hoist` | **none** — the shape cannot enter a positive fixture while it fails the `strict` dimension; the fix's gate is the destructured spelling entering the inference claims fixture, where `strict` holds it |
| [55](#55-a-computed-members-type-is-inferred-from-its-expressions-form-so-most-bodies-type-any) | A computed member's type is inferred from its expression's form, so most bodies type `any` | `compiler` | **none** — the fix's gate is a consumer-face claims row whose computed body reads a property rather than multiplying |
| [54](#54-a-generic-components-shipped-declarations-reference-a-type-parameter-they-never-declare) | A generic component's shipped declarations reference a type parameter they never declare | `compiler` | **none** — the audit reads the face the checker serves, never the emitted declarations; the fix's gate is a type parameter on dts-tsc's component fixture |
| [59](#59-a-type-predicate-in-a-parameter-ships-as--in-the-emitted-declarations) | A type predicate in a parameter ships as `==` in the emitted declarations — the `.d.ts` does not parse | `compiler` | **none** — the audit reads the face the checker serves, never the emitted declarations; the fix's gate is the predicate spelling entering dts-tsc's fixture |
| [53](#53-a-paren-injected-calls-arity-error-lands-on-the-wrong-argument) | A paren-injected call's arity error lands on the wrong argument | `editor`, `compiler` | **none** — the negative cannot enter the error lane while the position is wrong; the fix's gate is that negative joining 02-operations' error pair |
| [43](#43-a-schema-callables-output-types-unknown) | A schema callable's output types `unknown` — false errors on every typed read | `compiler` | the Diagnostics Lane's 14-schema pin (`error-pins.json`) asserts the typed-read rejection **as the interim** — it goes red the day callable outputs type, the cue to retire it |
| [36](#36-a-reactive-import-serves-the-raw-cell) | A reactive import serves the raw cell — no deref, writes don't build | `compiler`, `capability` | **none while the semantics are unsettled** — auto-deref vs cell-as-API is the language owner's ruling; this row's exit is that ruling, which hands it an ordinary gate either way |
| [41](#41-a-forward-referenced-class-or-component-pins-the-probes-own-symbol) | A forward-referenced class or component pins the probe's own symbol — TS2304 on legal code | `editor`, `hoist` | **none** — a `check` case asserting the TS2304 as the gap is the honest interim, unbuilt; the fix's gate is the forward-reference spelling entering the corpus, where `verdict` holds it |
| [38](#38-render-dsl-positions-hover-the-lowerings-scaffold) | Render-DSL positions hover the lowering's scaffold | `editor` | the Hover Audit's `ruled` gauge (`hover-pins.json` positions) — red by agreement (soft: the audit exits 0) until the server declines or serves the ruled targets |
| [39](#39-a-component-members-declaration-hovers-the-container-wrapper) | A component member's declaration hovers the container wrapper | `editor` | the `ruled` gauge's member-declaration and gate-target pins — red by agreement (soft) |
| [44](#44-a-mixin-declaration-hovers-the-runtimes-machinery) | A `:mixin` declaration hovers the runtime's machinery | `editor`, `compiler` | the Hover Audit's 14-schema mixin decls pin (`hover-pins.json`) asserts the machinery answer **as the interim** — it flips the day the face's typing changes, the cue to re-rule and re-pin |
| [33](#33-an-enum-names-semantic-token-says-type-not-enum) | An enum name's semantic token says `type`, not `enum` | `editor` | the Token Audit's enum rows — red by agreement (soft: the audit exits 0) until the server reclassifies |
| [57](#57-a-void-marked-bindings-token-says-variable-where-its-arrow-says-function) | A void-marked binding's token says `variable`, not `function` | `editor`, `compiler` | the Token Audit's wrong-type row on 04-assignments' void binding — red by agreement (soft: the audit exits 0), shared with the enum rows until both close |
| [37](#37-a-state-write-site-keeps-the-lowerings-readonly-color) | A state write site keeps the lowering's `readonly` color | `editor` | the token audit's `readonly` invariant at 12-reactive's state write sites — red by agreement (soft: the audit exits 0) until the correction reaches use-site spans |
| [35](#35-a-wrong--initializer-publishes-twice-in-lowering-vocabulary) | A wrong `:=`/`~=` initializer publishes twice, in lowering vocabulary | `compiler` | the Diagnostics Lane's 12-reactive pins (`error-pins.json`) assert the double **as the interim** — they go red the day the emission publishes once, the cue to retire them |
| [34](#34-the-bare--operator-hovers-the-runtimes-machinery) | The bare `~>` operator hovers the runtime's machinery | `editor` | the Hover Audit's `silence` gauge — ruled-silent bare-effect positions must serve null; red by agreement (soft: the audit exits 0) until the server declines to answer |
| [13](#13-single-rooted-tsconfig--no-per-project-resolution) | Single-rooted tsconfig — no monorepo support | `config` | **none** |
| [50](#50-a-rewritten-literal-widens-its-neighbours-diagnostics-to-the-whole-element-list) | A rewritten literal widens its neighbours' diagnostics to the whole element list | `compiler` | the Diagnostics Lane (`runner.js`) — 11-types' wrongEntry and wrongTrailing rows report position violations; red by agreement (soft: the audit exits 0) until the span maps to the offending element |
| [32](#32-reassigning-an-exported-plain-binding-double-declares) | Reassigning an exported plain binding double-declares | `compiler` | **none** — the spelling's output does not build, so no fixture can carry it; the fix's gate is the spelling entering 10-modules |
| [58](#58-a-classed-svg-element-emits-an-unclosed-setattribute-call) | A classed SVG element emits an unclosed call — the module does not parse | `compiler` | **none** — the emission does not parse, so no fixture can carry it; the fix's gate is the spelling entering 13-components |
| [28](#28-a-postfix-cast-on-an-inline-try-body-detaches-the-catch-arm) | A postfix cast on an inline try body detaches the catch arm | `compiler` | **none** — the spelling cannot compile, so no fixture can carry it; the fix's gate is the spelling entering 07-exceptions, where `compiles` and `verdict` hold it |
| [29](#29-new-on-an-optional-chain-emits-an-unconstructable-spelling) | `new` on an optional chain emits an unconstructable spelling | `compiler` | **none** — the emission cannot parse as JS, so no fixture can carry it; the production is parked ([MANIFEST.md](MANIFEST.md)); the fix's gate is the spelling entering 09-classes |
| [30](#30-new-on-a-tagged-template-leaks-the-sexpr-head) | `new` on a tagged template leaks the sexpr head | `compiler` | **none** — the emission references undeclared names, so no fixture can carry it; the production is parked ([MANIFEST.md](MANIFEST.md)); the fix's gate is the spelling entering 09-classes |
| [46](#46-a-mapped-type-is-rejected-by-the-type-body-validator) | A mapped type is rejected by the type-body validator | `compiler` | **none while unruled** — the MappedType row stands in the census queue (no spelling compiles); the exit is the language owner's ruling: admit (the fix's gate is the kind entering 11-types, contract negative alongside) or rule out (the row closes into the census exclusion table) |
| [45](#45-a-type-predicate-inside-a-type-body-collides-with-rips-is) | A type predicate inside a type body collides with rip's `is` | `compiler` | **none** — the body spelling is lexer-rejected, so no fixture can carry it, and the surviving def-return spelling drains the census row past it; the boundaries note ([ROADMAP.md](ROADMAP.md)) records the constraint |
| [48](#48-a-method-member-in-an-inline-type-body-is-rejected) | A method member in an inline type body is rejected | `compiler` | **none** — the indented spelling claims the kind, so the census stays silent about the inline gap; the fix's gate is the inline spelling entering 11-types under `compiles` |
| [49](#49-an-import-type-cannot-name-a-rip-module) | An import type cannot name a `.rip` module | `compiler` | **none** — the specifier does not resolve, so no fixture can carry it; the fix's gate is the ImportType kind entering 11-types with a contract negative |
| [23](#23-an-in-face-value-declaration-could-retire-the-tier-3-pin-probe) | An in-face value declaration could retire the Tier 3 pin probe | `hoist` | **none today** — nothing fails; adoption hands it an ordinary gate (bindings still needing a pin, expect zero) |
| [16](#16-library-globals-lose-the-defaultlibrary-modifier) | Library globals lose `defaultLibrary` | `editor` | **none, and none is honest** — upstream; a naive gate is platform-dependent |

**The ordering principles.** Audience first: everything down to #8 reaches every rip user, mode-independent — permissive still infers. Within a band, *silently wrong* outranks *visibly missing*: a wrong answer stated without hedging misleads, where a loud failure merely interrupts — so the loud rows (build breaks, parse errors) sink below the silent ones however broken their output is. #16 sits last because it is blocked upstream, not because it matters least. Each row's own body argues its place; this paragraph does not restate them.

**The `strict` dimension's clean run is contractual** — a red row there is a discovery, not residue; the runner's header states the curation rules.

## Findings

### 51. A boolean alias word names a binding, and every read becomes the literal

```
yes: boolean = false
console.log('binding says:', yes)     # prints: true
```

The declaration stands — the face reads `let yes: boolean = false` — and every subsequent READ of that binding is replaced by `true`. The binding is unreachable from the moment it exists, and the program prints the opposite of what its source says. No diagnostic, no squiggle: the face type-checks clean, because a literal satisfies the annotation.

**Why (code) — the declaration is collateral, not a decision.** A word followed by a colon is captured as a property KEY before it is classified at all ([lexer.js](../../src/lexer.js), the identifier branch), which is what lets `when: 1` and `if: 2` be pairs — the alias table is not consulted for another sixty lines. An annotated declaration has the same `word :` shape as a pair, so it inherits the exemption without anyone choosing it. The read has no colon, falls through to the alias table, and becomes the literal.

**Four spellings, and only four, fail silently** — a fact that follows from what the misread lowers to rather than from a list. The misread has to be a legal expression to go unnoticed. Driven 2026-07-27, one probe per class: a keyword name (`if: number = 2`) rejects at the parser on `POST_IF`; an operator alias (`is: number = 2`) rejects on `COMPARE`, and so do `and`, `or`, `not`, `isnt`, because an operator in argument position does not parse. Only the VALUE aliases — `yes`, `no`, `on`, `off` — lower to `BOOL`, which is legal wherever an expression is, so only those four reach runtime wrong.

**The fix belongs in the scanner, at the declaration.** Making a read yield to an in-scope binding would need scope knowledge in a scanner that has none, which is the wrong layer. Rejecting the DECLARATION is tractable and has its precedent in the same file: `RESERVED_WORDS` exists so certain words never reach the parser as an identifier. The rejection must be narrower than "no alias word before a colon" — `{ yes: 1 }` stays legal, since nothing later reads a binding — so it has to separate a key inside a literal from any ANNOTATED BINDING SITE. Statement level is not the whole of that: driven 2026-07-28, an annotated parameter miscompiles identically (`def toggle(off: boolean)` prints the wrong branch, and the face type-checks clean), and a discriminator scoped to statements would leave it open. Property and promoted positions are safe.

**Why the suite missed it.** Nothing anywhere declares a binding named for a value alias. The battery's only `yes`/`no` are string literals in ternary rows, and this corpus wrote `yes: Yes = true` and `no: No = false` — the two cases where the literal the read collapses to EQUALS the binding's value, so the fixture printed the right answer while demonstrating nothing. `runtime` passed, `verdict` passed, and the mistake was invisible in both. The lexer-spelling census is what surfaced it: `yes` and `no` counted as exercised BOOL aliases, and the only site claiming them was a read that was never meant to be one.

**vs v3 — not a regression** (driven both sides, 2026-07-28). v3 prints `true` for the same two lines. Both the pair exemption in the identifier branch and the alias table predate this repo, so the shape has always miscompiled; the lexer-spelling census is what made it visible, not a change that made it wrong.

**Status.** ⬜ **Open** (2026-07-27) — **no gate**, honestly: a positive fixture cannot carry the shape while it miscompiles, and `rip check` cannot see it because the face is clean. The fix's gate is a `battery` rejection row for the declaration, at which point the census's `yes`/`no` rows go dark and want an exclusion naming `true`/`false` as the spelling that carries their lowering.

### 21. An identifier read carries no source span

An identifier READ gets no mapping row of its own — it inherits the **cover** row of whatever construct carries it, and each consumer then fails its own way. Three resolvers in [translate.js](../../packages/vscode/src/translate.js) divide the surfaces: hover, definition and tokens ask SOURCE→GENERATED through `sourceOffsetToGeneratedExact`, so a read with no exact row resolves to another symbol or to nothing; diagnostics ask GENERATED→SOURCE through `generatedSpanToSource`, which for a cover row answers with the **whole cover span**, so the squiggle swallows correct neighbours; and the edit path's `generatedEditSpanToSource` refuses outright, returning null rather than guessing. Driven: `widen('lit')` underlines `('lit')`, and `pair 1, count, count` underlines `1, count, count` — covers, not points.

**Four surfaces, one root** — driven 2026-07-17, the real server against tsgo on the hand-written twin, at the argument read in a `console.log` whose label is single-quoted:

| surface | source | answer at the read |
| --- | --- | --- |
| hover | `console.log('total:', total)` | **`(method) Console.log(...data: any[]): void`** — the wrong symbol, stated without hedging |
| definition | `console.log('total:', total)` | **null** |
| diagnostics | `console.log('total:', totalz)` | underlines `'total:', totalz`; TypeScript underlines the name alone |
| semantic token | `console.log('total:', total)` | dropped |

The diagnostics row needs a *bad* name — a resolving `total` raises nothing to mis-place — so it reads `totalz`; the other three need a resolving one. Same construct, same cover, same collapse.

**The diagnostics surface, driven again on an ARGUMENT-TYPE rejection** (2026-07-28, `rip check` over four spellings of one call, expected column 11 in every row):

| argument | face | published |
| --- | --- | --- |
| `widen('lit')` | `widen("lit")` — quote rewritten | **10 — the open paren** |
| `widen("lit")` | byte-identical | 11 — the argument |
| `widen(true)` | byte-identical | 11 |
| `widen(word)` | byte-identical | 11 |

Same trigger table as above, one surface over: the prefix holds to the rewritten byte and no further, so the resolver answers with the cover's left edge — which for an explicitly parenthesised call is the `(`, one byte left of the argument. The paren-less spelling positions correctly here, the opposite of the paren-injected arity row, because *that* row's diagnostic belongs on an EXCESS argument the cover's edge never coincides with. Neither spelling generalizes; the quote does.

**A third surface, the widest cover in the corpus** (driven 2026-07-28). A type error inside a schema callable body publishes its correct code on the schema's HEAD line — `bad: ~> @units.toUpperCase()` two lines down reports at the `:shape` marker. [schema.js](../../src/schema.js) states the mechanism in its own header: the block collapses to two tokens and *"the schema rule's annotation records the SCHEMA_BODY span as the `body` role"* — one span for the entire body, so anything inside it resolves to that span's start. Driven as the cover rather than assumed: rename the binding from `Alpha` to `LongerName` and the anchor moves five columns with it. Sub-compilation is not the cause; the single role span is. It matters more here than elsewhere because a schema body is the largest cover the corpus contains, and callables are the only in-body construct that reaches the checker at all — a wrong-typed default or transform publishes nothing (its own row), so every diagnostic a schema body can raise lands on the head line.

**This is why the corpus's own style guide is the failing combination** — explicit parens plus single quotes is the house idiom, so an error-lane row written the natural way mis-positions and one written with a double quote does not. [25-components.errors.rip](corpus/errors/25-components.errors.rip)'s method-argument row is double-quoted for exactly this reason and says so at the citation. Four other fixtures already assert TS2345 — 02-operations, 08-functions twice, and 22-vocabulary — and every one of their arguments is an identifier or a numeric literal, which the face emits byte-identically. So the rewrite path had never been reached, not because argument-type rejections were unasserted, but because none of them was spelled with the quote that moves.

Checking itself is **sound** — the same diagnostics fire with the same codes, and the compiled JS is unaffected; only *where* an answer lands is wrong. It misleads, it does not let a bug through — which is what would rank it under any unchecked-code hole, and what still separates it from everything below it.

**Two triggers, each sufficient alone** (driven, one variable at a time, same read):

| | no literal | double-quoted | single-quoted |
| --- | --- | --- | --- |
| **parens** | ok | ok | **fails** |
| **paren-less** | **fails** | **fails** | **fails** |

A **paren-less call** fails unconditionally — the `args` cover maps source `total` onto face `(total)`, so the face span opens with an inserted `(` and the verbatim prefix is zero-length. A **single-quoted literal** fails positionally — `('x:', total)` → `("x:", total)` holds the prefix until the quote, so arguments *left* of it survive. Parens **and** double quotes is the only combination that works, and neither is idiomatic rip: this fires on ordinary code, not a corner.

**The two token invariants, and why it takes two.** Both assert the CORRECT behavior (a name *should* classify), never the bug's absence — the direction #16 warns against — and both are platform-independent, so unlike #16 they carry none of that finding's gating hazard.

- **`member`** ([runner.js](runner.js) `typeMembersOf`) — enumerates type-body members from SOURCE and asserts each gets a token. Presence only. It reaches the third root category below, where a name's span never existed.
- **`survival`** ([runner.js](runner.js) `faceSurvival`) — count-based, and must be: a dropped token's source offset is unrecoverable, so it does not correspond by position. It takes the SET of names tsgo classifies on the face, counts each name's source occurrences, and subtracts what the real server (`session.semanticTokens`) delivered — the deficit is the drop. The server is the delivery oracle, so no remap is reimplemented. It is the only invariant reaching use sites and rip-native names.

A source enumeration cannot see a use, and a classified-name-vs-delivered count cannot say *where* a surviving name landed — hence two, and hence neither alone.

**The census now subsumes `member`.** A type-body member with no token is a member with no exact row — so the census counts it, from compiler output alone, without a server. Once the fix lands, `member` has nothing left to catch at the mapping layer and reverts to guarding token *delivery* — that a classified name is actually shipped — which the census structurally cannot see. `survival` is only *root*-subsumed: it too flips green on the fix, but its delivery half (server-shipped vs face-classified) stays its own.

**The population is the census, not the symptom count.** A read is safe when it sits inside an `exact` row: [builder.js](../../src/builder.js) records `exact` only for verbatim-equal slices, so byte arithmetic *inside* one is valid by construction. Everything else has no positional guarantee — it resolves today only while its cover's prefix happens to stay verbatim through it. Driven 2026-07-17 over the 252 of 255 `.rip` files in this repo and in medlabs that compile (3 fail to compile and are in no column below), predicate validated against all four rows of the trigger table above:

| where | reads with no exact row |
| --- | --- |
| medlabs — the real app, 58 files | **3,063 / 9,999 — 31%** |
| this repo's shipped packages, 83 files | 6,619 / 33,400 — 20% |
| the audit corpus (re-measured 2026-07-23, the rewritten corpus; the live number is `--map`'s census line) | 576 / 2,667 — 22% |

**The corpus rate sits between the two, so for this row it is a fair instrument** — the rate is uniform because the triggers are ordinary syntax, not a shape that needs scale to appear. (It is not fair for #23, where the corpus under-counts by two orders of magnitude and carries the wrong shape.) The census exceeds the broken-today subset by design — the remainder resolve only while their cover's prefix holds, which is what the census counts and a symptom gate would not; medlabs' worst file is `app/components/icon.rip` at 94%.

**Why (code) — three categories, each losing the span at a different point.**

- **List elements** (call arguments). The list *is* a node with a span — `console.log a, b` yields one node over `a, b` — but per-element spans are never derived: [parser.js](../../src/parser.js) records one row per **role**, and for a spread role `childNodeId` stays null, because [stores.js](../../src/stores.js) takes per-element spans only from *"the children's own NodeStore rows"* and a bare identifier is a primitive string in the tree (`["...", "console", "log"], "total"`), which has none. The span exists transiently at the accumulator's reduce (`locs`) and dies when the stack pops.
- **Annotation names.** The `annotation` role's span is `": number"` — it includes the operator — and `number` gets no node.
- **Type-declaration internals.** `type ID = string` is **one lexer token** (`TYPE_DECL`, via [lexer.js](../../src/lexer.js)'s `claim`) → one node → one role over the whole text. `ID` and `string` have no spans *at all*; the grammar never sees inside a type. This is the largest slice — `string` and `number` top the at-risk census — and the type-heavy fixtures are the most exposed in the corpus.

**The fix — upstream, and the same move for all three.** Give primitive reads real source spans and mark them: `markSpan` + `SPAN_ROLES` ([builder.js](../../src/builder.js)), whose `mappingKind` stays decided by the builder's verbatim comparison, so a name row classifies exact **by construction** rather than by assertion. `shorthandProp` is the precedent and the model — *"a boolean-shorthand prop key is a primitive with no store row"*, given an exact row from an anchored bare-word scan. Type internals need no type grammar: the `TYPE` token already carries its span and its text, and the face emits that text near-verbatim, so the scan is over text already in hand. **Do not solve this at query time.** A query-time resolver (identity, ordinal, or otherwise) fixes one consumer, cannot serve the edit path — which must never guess — and structurally cannot resolve a name that repeats inside its cover, which an emit-time row resolves for free because the span is *known*, not searched. See the upstream rule under [How to read this ledger](#how-to-read-this-ledger).

**The gate this wants is built** — the Mapping Audit ([runner.js](runner.js) `mappingScan`, `bun run audit --map`). Its **census** is exactly this: reads with no exact row, computed straight from the mapping rows, no server and no oracle. It measures the root and nothing else, so no downstream mitigation can satisfy it — only giving reads real source spans reduces it. **Red by design** until that fix lands; it goes green when every read classifies exact. The same run also reports the broken-**today** subset (`placed`/`text` — reads whose precise resolution refuses or lands on wrong bytes), a strict subset of the census: the remainder resolve today only by a verbatim cover prefix, one face rewrite from breaking, which the census counts and a symptom gate would not. The audit's logic was validated against the real editor once and then shipped standalone (no server, no oracle); see [ROADMAP.md](ROADMAP.md) "M1".

**Why the suite missed it.** Every token gate was source-enumerated at declarations — `declsOf` (column-0), plus [semantic-tokens.test.js](../toolchain/semantic-tokens.test.js) and the `readonly` sweep on column-0 `:=`/`=!`/`~=` names. A name's *declaration* gets a token, so every gate passed while its *use* was never in any set. The editor suite's definition tests are the sharper miss: they **do** drive use sites (`// total at its read`, `// answer at its use` — [editor-features.test.js](../../packages/vscode/test/editor-features.test.js)), and pass because their fixtures are `next = total + 1` and `double = answer * 2` — binop operands, which the emitter's read guard gives an exact row. Right position, source that cannot fail. And `declsOf`'s own comment names the construct it excludes — *"a name followed by `.`/`(`/`[` is a usage (`console.log(…)`) — which the old heuristic wrongly probed"* — a refinement that was correct on its own terms and removed the only shape in the corpus that carries the defect.

**vs v3 — established for TOKENS (driven both sides, 2026-07-15) and for HOVER and DEFINITION (2026-07-28, below); diagnostics unestablished.** v3 compiles to TS, runs `getEncodedSemanticClassifications`, and remaps the spans back (rip-lang 3.17.5 `packages/vscode/src/lsp.js`) — it is not remap-free, so a token surviving there is a property of its remap, not of classifying on raw source. The token verdict **splits by surface**:

- **Type-body members — regression.** `type Circle = { kind: 'circle', radius: number }`: v3 classifies `radius` `property`, v4 drops it. The `member` gauge tracks a genuine v4 loss — v3's remap survives the quote rewrite where v4's cover-prefix does not.
- **Use sites — regression.** `console.log('total:', total)`: v3 CLASSIFIES the single-quoted call argument; v4 drops it. Re-driven 2026-07-28 with liveness inside each run. The earlier reading of this bullet was a probe artifact: **v3 returns no tokens at all for a file carrying no type annotation** (`lsp.js` gates on `hasTypes`), so on a two-line probe it emits nothing — no declaration either — and filtered to one name that reads as a drop. Padding the file, or annotating anything in it, makes v3 answer.

Net for tokens: **both** surfaces are v4 regressions. Still unsettled: 08's reactive reads drop in v4 only in render/component context, and that exact context has not been reproduced on v3 — any re-drive must carry a type annotation, or it measures v3's `hasTypes` gate rather than its classifier.

**Hover and definition — established, both v4 regressions** (driven both sides, 2026-07-28, the real servers over stdio at the argument read in `console.log('total:', total)`). v3 hovers **`let total: any`** and resolves the definition; v4 hovers **`(method) Console.log(...data: any[]): void`** and returns null. **Why** v3 answers correctly is not established. The token verdict above records v3 remapping spans back rather than avoiding a round trip, so this is a difference between two remaps, not between having one and not — and the nearest available explanation is the one the member surface already shows, v3's remap surviving the quote rewrite that collapses v4's cover-prefix. That is inference; it was not driven for hover. What IS driven is the outcome, and unlike the use-site TOKEN surface these two do not split: v3 is right and v4 is wrong on the ordinary single-quoted form.

**Diagnostics stay unsettled.** v3's position on a failing read was not driven. The tuple-span and paren-injected-arity rows both record v3 positioning correctly on THEIR shapes, which is suggestive and is not this surface.

**Status.** ⬜ **Open** (2026-07-17) — **gated red by design** by the Mapping Audit's census (`bun run audit --map`): reads with no exact row, straight from the compiler output, mitigation-proof. All four surfaces are the same byte-math over the same mapping rows, so the census is the gate for *every* one of them — driven to zero, the cover-collapse mechanism is gone on hover, definition, diagnostics and tokens alike, by construction; no per-surface gate would tell you anything it doesn't. The token surface additionally carries `member` and `survival`. What no gate *drives* is the three server surfaces at a failing read — `verdict` counts Error-severity diagnostics and gets zero (positive fixtures publish nothing by design — their negative content lives in the error lane, so no diagnostic ever sits at a failing read for the mis-position to reach), and the hover audit probes only `declsOf` declarations, never a read — but driving them is a question of server *delivery* (does the plumbing serve the right answer once the spans exist), a concern separate from this finding's root. The root is watched, and goes green only when the fix above lands.
### 22. Completion and signature help fail on an incomplete expression

The broker builds its TypeScript face from a **successful** compile, so it can serve a request only where the source parses — but the two features whose trigger is an *incomplete* expression fire precisely where it does not. The trigger byte is the same byte that breaks the parse: type a member-access dot and pause (`items.‸`), or sit inside an open call (`add(‸`), and the buffer no longer parses, so no face carries the member-access / call context and the request has nothing to map into. rip's compiler throws where TypeScript's error-tolerant parser recovers — which is why the hand-written twin serves the correct answer on the identical incomplete text and the broker does not. What you actually get instead is nothing, or (for completion) the wrong list; the popup works only once the expression is complete enough to parse, which is backwards from how these features are used.

**Why (code) — two surfaces, one root.** Member completion at a bare dot and signature help inside an open call. Both are un-parseable at the cursor (`bin/rip --ts` on `items.` → `Unexpected end of input — expected PROPERTY`; on `add(` and `add(1,` → a parse error at the `(`), so neither has a face. They differ only in fallback: completion has a statement-context one (it serves *something* wrong), signature help has none (it serves plain null).

**The fix — an error-tolerant face, or a fixup at the cursor.** v3's dot rewrite (below) is the cheap end and is proven on this exact surface, but it is per-trigger: signature help's open paren needs its own. The general form is a parser that recovers where TypeScript's does, which serves both. **Not** by widening the staleness fallback — serving the last good face's scope list is what produces the wrong list today, and a better-chosen wrong list is still wrong.

**Driven — member completion** (2026-07-15), the real server (`server.js --stdio`, `onCompletion`) against tsgo on the twin, `items` typed `number[]`, completion right after the dot:

| buffer at the dot | server | result |
| --- | --- | --- |
| `x = items.` — fresh buffer, never compiled | rip broker | **empty** — no items |
| `x = items.` — after a good compile, dot just typed | rip broker | **stale scope list** — in-scope names + ambient globals (`items`, `count`, `Date`, `Map`, …), **no members** |
| `x = items.map` — parseable | rip broker | **correct** — `map`, `filter`, `join`, … |
| `let x = items.` — same trailing dot | tsgo (twin) | **correct** — the same members |

The two broker symptoms are the two branches of the staleness guard — [onCompletion](../../packages/vscode/src/server.js) maps the cursor into the **last good face** (the version before the dot, plain statement context → the in-scope identifier list) or, on a buffer that never compiled, nothing at all. Neither is the member list; make the expression parse (`items.map`) and a real face exists, member completion then matching the twin exactly.

**Driven — signature help** (2026-07-15), the real server (`onSignatureHelp`) against the twin, `add` typed `(a: number, b: number): number`, cursor inside the call:

| call state at the cursor | server | result |
| --- | --- | --- |
| `r = add(` — unclosed, fresh | rip broker | **null** |
| `r = add(1, ` — unclosed mid-args, fresh | rip broker | **null** |
| `r = add(1, 2)` — closed, cursor inside the 2nd arg | rip broker | **correct** — `add(a: number, b: number): number`, activeParameter 1 |
| closed, then backspaced to `r = add(1, ` | rip broker | **null** (no fallback) |
| `let r = add(1, ` — unclosed mid-args | tsgo (twin) | **correct** — same label, activeParameter 1 |

Signature help is the harsher surface: with no statement-context fallback, every open-paren state returns plain null, prior compile or not. It works only on the **closed** call `add(1, 2)` — exactly when it is no longer needed — where the response passes through correctly (signatures / activeParameter untouched, the design the bodiless-overload note in `onSignatureHelp` relies on).

**Why the suite missed it.** Both tests use the **already-complete** form — the one state that has a face. Member completion is tested at `msg.sub‸` (a complete member expression; [editor-features.test.js](../../packages/vscode/test/editor-features.test.js) "member completion serves with resolve-lazy detail") and signature help at a closed `pick(1, 2)` ("active parameter indices hold across bodiless overload rows"). `msg.sub` and `pick(1, 2)` parse; `msg.` and `pick(` do not. The twin proves the correct answer was reachable on the identical incomplete text the whole time.

**vs v3 — established (driven both surfaces, 2026-07-15).** v3 type-checks in-process through the JS TypeScript LanguageService; the verdict **splits by surface**:

- **Member completion — v4 regression.** v3 serves the correct members at the bare dot — driven, fresh `x = items.` → the full `number[]` member list (40 items, `map`/`filter`/…), no prior good compile needed. Its `onCompletion` (rip-lang 3.17.5, `packages/vscode/src/lsp.js`) rewrites `word.` → `word.__rip__` before compiling, so the compiler sees a real member access, recompiling that fixed-up text on the fly (`catch {}` on failure). v4 has no such rewrite, so the dot never yields a face — the whole of the regression.
- **Signature help — split.** *Fresh* open paren is **inherited**: v3 has no equivalent open-paren fixup, so `r = add(` and `r = add(1,` compile-error (`missing )`) and return null in both. But the common interactive case — a call that *was* valid, now mid-edit — is a **v4 regression**: v3 falls back to the last good compile and `getSignatureHelpItems` still resolves the call (driven: closed `add(1, 2)` → backspace to `add(1, ` → `add(a: number, b: number): number`, activeParameter 1), where v4's stale path returns null.

**Status.** ⬜ **Open** (2026-07-15) — no fix, no gate. A completion content audit (twin-oracled on the item set + resolved `detail`) and a signature-help audit (on the label + `activeParameter`) would catch the two surfaces and, sharing this root, retire together the day the parse gap closes — but both are unbuilt, and the extension tests exercise only the parseable form of each (above), which is why the suite is green.
### 40. A component member's initializer and in-method writes are never type-checked

Of the four component member forms, three silently accept a wrong-typed initializer — driven 2026-07-23, `rip check` over one component: `wrongPlain: string = 42` publishes TS2322; `wrongMember: number := 'oops'`, `wrongComputed: string ~= 7 * 3`, and `wrongReadonly: number =! 'nope'` publish **nothing**. The annotation declares on the class (hover, props, and consumers all see it), and the initializer that violates it is never checked anywhere — not in the editor, not in `rip check`, permissive and strict alike. An unchecked-code hole, not a mislead: a wrong member type flows into every read of the member with no diagnostic anywhere on the road.

**Why (code) — two mechanisms, one surface.** In a component-carrying file, runtime delivery switches to the components table, and the face's runtime destructure loses the reactive `types` annotations the reactive table's own delivery carries — `const { __state, __computed, … } = (() => …)` is UNTYPED there (compare any `:=`-only file, whose destructure is annotated with the generic signatures). So `__state(…)`/`__computed(…)` infer from the raw runtime JS, return effectively-`any`, and the `_init` assignment lines (`this.wrongMember = __state("oops")`) never check. Reproduced in minimal TS with the generic signatures present: both mismatches then fire TS2322 — typing the destructure is sufficient for `:=`/`~=` members. The `=!` member has its own micro-root: its one legitimate constructor-seam write is spelled `(this as any).wrongReadonly = …` to quiet TS2540, and the `as any` swallows the value check with it — that cast needs a shape that keeps the member's type (a typed this-cast, or a `satisfies` on the value).

**The scope is every write to a member, not only its initializer.** Driven 2026-07-28 under `rip.strict`: a wrong-typed write inside a method publishes nothing for state (`@count = 'oops'`), for a prop (`@value = 'nope'`), and for a **plain non-reactive member** (`@plainField = 'flat'`) — the last of which has no cell, no `__state` call, and an honest `declare plainField: number` on the class. The method body itself IS checked (a `nonexistentHelper(1)` call in the same method publishes TS2304), so this is member access specifically. **The write half is a different root, and typing the destructure will not fix it.** tsgo DOES report all three: checking the same mirror directly yields three TS2322s on the write lines, and only the TS2304 survives into `rip check`. They are dropped in transit — an `@name` write lowers to a `this.`-prefixed member expression whose prefix carries no source row, the diagnostic's span starts there, and `mapTsDiagnostic` ([diagnostics.js](../../packages/vscode/src/diagnostics.js)) discards any diagnostic whose generated span has no honest source mapping. Driven 2026-07-28: mapping each TS2322's own span through `generatedSpanToSource` returns null for the `@` spelling and the member's name for the bare one — and the bare spelling reports correctly today. The `any`-base story is refuted in isolation: a class extending an untyped base still enforces its own `declare` members under `--strict`. So this half belongs to the identifier-read row's family, not to the destructure's.

**Riding evidence.** The same untyped destructure collapses the wrong-initializer double (the two-publish row above) to a single TS1360 in component-carrying files — the annotated-const TS2322 needs a typed `__state` and is gone; only the `satisfies` guard still fires (driven 2026-07-23, a top-level `wrongState: number := 'oops'` beside a component).

**The fix — type the runtime destructure.** Sufficient for the `:=`/`~=` members by the minimal-TS reproduction above, and one level up it restores enforcement of the class's own `declare` members through `__Component`. v3's delivery is annotated (below), so this is restoration rather than design. The `=!` member needs its own micro-fix alongside: its constructor-seam write is spelled `(this as any).x = …` to quiet TS2540 and the cast swallows the value check with it, so it wants a shape that keeps the member's type — a typed this-cast, or a `satisfies` on the value.

**Why the suite missed it.** Nothing in the suite ever asserted a member declaration's own initializer — component negatives asserted member WRITES (`count = 'hello'` in a method) and prop construction sites. Deriving 13-components' error pair is what surfaced it: the member-initializer negatives publish nothing, so the Diagnostics Lane cannot carry them, and the pair had to be authored without them.

**vs v3 — regression** (driven both sides, 2026-07-28, `rip check` over the same four-member component). v3 publishes **all four**: `wrongPlain`, `wrongMember`, `wrongComputed` and `wrongReadonly` each raise TS2322 on the member name. v4 publishes the plain one. The mechanism is the destructure above read from the other side — v3's delivery annotates its runtime table (`declare people: Signal<any>`, the generic signatures present), so an initializer checks against the member's declared type; typing v4's destructure is therefore not a speculative fix but a restoration of the shape that already checks.

**Status.** ⬜ **Open** (2026-07-23) — no gate. A `check` case in the match-operator style — the SILENCE asserted as the gap, liveness-paired with a genuine error in the same workspace — is the honest interim gate, unbuilt. The fix's gate is the member-initializer negatives entering 13-components' error pair, where the Diagnostics Lane holds them by code and position.

### 42. A wrong-typed schema default or transform is never type-checked

`role number, ['guest']` — a string default on a number field — and `id! number, -> it.name` — a transform returning a string on a number field — publish **nothing**: not in the editor, not in `rip check`, permissive and strict alike (driven 2026-07-23). The runtime rejects both on every `.parse()` that touches them (`SchemaError: id must be number; role must be number` — the validator checks defaults and transform outputs like any other value), so the declaration is a program that cannot parse successfully, silent until run. An unchecked-code hole, the component-member-initializer shape wearing schema vocabulary: the declared field type is real — the companion carries it and consumers check against it — and the value that violates it is never checked anywhere on the road.

**Why (code).** The face carries the schema body as an untyped runtime descriptor — `__schema({ …, entries: [{tag: "field", name: "role", …, constraints: {default: "guest"}}, …] })` — where a default is a bare JS value and a transform is a bare JS function, neither related by any face type to the field's declared type, so tsgo has nothing to check. The declared types themselves project into the companion ([schema-types.js](../../src/schema-types.js)), which is why the assignment surface checks; only the descriptor's own values are dark.

**The fix — a typed descriptor closes the default, and not the transform.** What is missing is a face in which a default and a transform's return are checked against their field. Driven in minimal TS: a `{ default?: T; transform?: (it: any) => T }` descriptor catches the wrong-typed DEFAULT and says nothing about the transform, because `it` is `any` and an `any` return satisfies every field type. Closing the transform half needs the transform's INPUT related to the row shape as well, which reopens the ruled `it: any` ground of the closed schema-`it` row — so this row's two examples do not close together, and the fix must say which one it buys. **Not** a runtime-only assertion: the validator already rejects both on `.parse()`, and this row exists because that rejection arrives too late to help.

**Why the suite missed it.** [schema.test.js](../schema/schema.test.js) asserts the runtime rejection as correct behavior — which it is; nothing ever type-checked a face carrying a wrong-typed default or transform. Deriving 14-schema's error pair is what surfaced it: the misdeclaration negatives publish nothing, so the Diagnostics Lane cannot carry them and the pair was authored without them.

**vs v3 — not a regression** (driven both sides, 2026-07-28, the same wrong-typed default and transform). v3 publishes nothing either, permissive and strict alike: its descriptor is untyped in the same way. The hole is as old as the schema face.

**Status.** ⬜ **Open** (2026-07-23) — no gate. A `check` case in the match-operator style — the SILENCE asserted as the gap, liveness-paired with a genuine error in the same workspace — is the honest interim gate, unbuilt. The fix's gate is the misdeclaration negatives entering 14-schema's error pair, where the Diagnostics Lane holds them by code and position.

### 8. Auto-import is closure-scoped

v4 offers auto-import candidates only from the ACTIVE PROGRAM (open files + transitive imports) plus `node_modules`/`@types`. A workspace `.rip` nothing open imports is not offered until you open/import it — the feature's headline case (import from a file you have *not* opened) is defeated for `.rip`→`.rip`; only npm/`@types` work fully.

**Why (code) — candidacy is bound by which mirrors exist on disk.** `materializeClosure` walks only seeds and recorded imports, and `pruneClosure` deletes any mirror no open buffer reaches ([server.js](../../packages/vscode/src/server.js)) — so the candidate set is exactly the tsgo program, and the program is exactly the open buffers' closure. The generated tsconfig's `include` is **not** the constraint: `['**/*.ts', '../../**/*.d.ts']` globs the whole mirror tree and narrows nothing. Driven against real tsgo (2026-07-28): a mirror written to disk and never opened IS offered — the whole requirement is a `.ts` present inside the tree, with no didOpen, no overlay and no import edge.

**The fix — populate, do not glob.** The change belongs in mirror population and pruning, not in the tsconfig: no `include` pattern can match a mirror that was never written, and tsgo cannot read a `.rip` file, so widening the glob is inert for the headline case. The open question is how cheap a mirror can be — a full face, or a declaration-only stub — and whether it survives `pruneClosure`. v3 got a wider set free from a whole-workspace root (below), which proves one is serviceable but is **not** the shape to copy: materializing every mirror eagerly defeats the closure, which exists to bound session cost.

**Why the suite missed it.** Auto-import was exercised only through the closure, where it works. Nothing probed a file no open buffer reached, because until the mirror model existed there was no reason to think reachability could differ from workspace membership.

**vs v3** — v3's in-process LanguageService rooted its project at the whole workspace (tsconfig `include` globbed all sources), so every workspace file was a candidate from cold. This was originally filed as a "scope note," which undersells it: for this feature it is a functional regression, not a caveat.

**Status.** ⬜ **Open** (2026-07-14) — gated as the interim, and **green**: [auto-import.test.js](../toolchain/auto-import.test.js) drives real completion requests against the server and asserts the gap with `not.toContain`, so the wrong behaviour is pinned deliberately, the way the match-operator and schema-callable rows pin theirs. It goes red the day the scope widens, which is the cue to invert it. The expected-failure device was considered and rejected in the gate's own header: under `test.failing` any throw counts as a pass, so a server returning nothing would satisfy it — which is why every completion assertion is liveness-paired against a candidate that IS offered.
### 26. The match operator's emission is never null-clean

`text =~ /re/` lowers to `(_ = toMatchable(text).match(/re/))` ([emitter.js](../../src/emitter.js) `matchOp`), and the face's own prelude types `toMatchable` as `(v: any, allowNewlines?: boolean) => string | null` (the `RUNTIME_TABLE` annotation — honest: a multi-line string without `/m` deliberately coerces to `null` so the match throws loudly rather than anchoring wrong). The emitted call then invokes `.match` on that union unguarded, so **every** `=~` expression — any operand type, permissive and strict alike, no `package.json` in sight — publishes TS2531 *Object is possibly 'null'* on legal rip. The regex-index sugar shares the root and flags identically: `text[/re/]` and `text[/re/, n]` emit the same `toMatchable(…).match(…)` spine (`regexIndex`, same file). Driven 2026-07-22, `rip check --json` over a two-line file (`text = 'abc'` / `found = text =~ /b+/`): TS2531 spanning the whole match expression.

**Why (code) — the emission's type story, not the runtime's semantics.** The `null` return is load-bearing — it is the loud-throw path — so the union is honest and the defect is the unguarded `.match` on it.

**The fix — acknowledge the null branch in the emitted spine.** The lowering owns both halves of the expression, so it can narrow its own call. **Not** by softening `toMatchable`'s signature: v3 ships exactly that spelling (below), and it lies about a helper that really does return `null`. **Nor** by loosening the mirror's null-strictness — driven, `strictNullChecks: false` clears the diagnostic just as thoroughly. The generated tsconfig sets no such option; TypeScript 7 defaults it on, which is why this row's "permissive and strict alike, no `package.json` in sight" holds. The pattern-catch row is the precedent, minting an annotation scoped to its own lowering rather than changing a runtime contract. When it lands, `=~` (and the regex-index spelling) join 02-operations and the `verdict` dimension holds both.

**Why the suite missed it.** `bun test` asserts the operator's runtime values, and nothing ever type-checked an `=~` face: `Expression MATCH Expression` was grammar-dark until the M3 sweep — authoring 02-operations is what surfaced this. The corpus **parks the operator**: a positive fixture cannot carry it (the `verdict` dimension means zero published diagnostics, and M3 fixtures carry no directives), and the Diagnostics Lane cannot assert it as a negative (TS2531 anchors on a call expression that the line-aligned twin can only spell as TS18047 on a bare identifier — the codes cannot be made to agree, and blessing the diagnostic would certify the bug as intended). The corpus's traces are the parked note in [02-operations.rip](corpus/grammar/02-operations.rip) and [MANIFEST.md](MANIFEST.md)'s Parked rows — the operator, and the regex-index spelling that shares its root; the gate lives outside it. [check.test.js](../toolchain/check.test.js)'s match-operator case drives the real CLI and asserts the current, wrong behavior on purpose — TS2531 bound to each spelling's line (columns left free: a mapped-column shift is not a fix), liveness-paired with a genuine TS2322 in the same workspace so a checker that stopped reporting anything cannot impersonate the fix (the auto-import pattern, and for the same reason not `test.failing`). It goes red the day the emission is fixed — the cue to invert it, not a regression.

**vs v3 — v4-only, and v3 is the cautionary case** (driven both sides, 2026-07-28). v3 DOES annotate `toMatchable` — as `(v: any, allowNewlines?: boolean) => string`, over a runtime that returns `null` on the multi-line path exactly as v4's does. So v3's silence is bought by precisely the softening this row rules out, and the must-not stops being hypothetical: that spelling exists, and it lies about the helper. The emitted spine is identical on both sides. **A caution for re-drivers:** v3 emits `// @ts-nocheck` for any file carrying no type annotation, so the natural two-line `=~` probe proves nothing — annotate something first.

**Status.** ⬜ **Open** (2026-07-22) — gated as the interim by `check`'s match-operator case, described above: it asserts the TS2531 **as the gap**, so the fix inverts it — the cue to move the operator into the corpus, where `verdict` holds it.

### 27. A pattern catch destructures `unknown`

`catch {message}` and `catch [first]` lower to a minted binding plus a first-statement destructure — `catch (_err) { ({message} = _err); … }` ([emitter.js](../../src/emitter.js), the catch-pattern branch of the try emission, `Emitter.isPattern`) — and the face types that binding `unknown`, so the destructure itself publishes: **TS2339** *Property does not exist on type 'unknown'* on an object pattern, **TS2488** *not iterable* on an array pattern, anchored on the source pattern. Driven 2026-07-22, `rip check` over both spellings, no `package.json` in sight. Every pattern catch publishes on legal rip.

**The identifier spelling is not this finding.** `catch e` followed by `e.message` raises the same-family TS18046 — but on the USER'S read, which the user can govern the ordinary TypeScript ways (`instanceof`, a cast). The pattern's error sits on **compiler-minted code with no narrowing seam**: nothing the author writes can stand between the binding and the destructure, so the only recourse is a directive on legal syntax.

**Why (code) — the lowering's type story.** TypeScript permits exactly two catch annotations, `any` and `unknown` — and the pattern branch mints its binding, so it can annotate it.

**The fix — mint the annotation on the pattern branch alone.** `catch (_err: any)`, or a cast at the destructure, scoped to the pattern lowering. **Not** a global loosening of the catch type: the identifier spelling's `unknown` is honest, and the user can govern it the ordinary TypeScript ways (`instanceof`, a cast), so widening it would trade a real safety property for a lowering's convenience. When it lands, both pattern spellings join 07-exceptions and `verdict` holds them.

**Why the suite missed it.** `bun test` asserts the pattern bindings' runtime values, and nothing ever type-checked a pattern catch's face: `Catch → CATCH Object Block` and `Catch → CATCH Array Block` were grammar-dark until the M3 sweep — authoring 07-exceptions is what surfaced this, the same road #26 arrived by. The corpus parks both spellings (a positive fixture cannot carry them — `verdict` means zero published diagnostics, and M3 fixtures carry no directives — and the Diagnostics Lane cannot bless the codes without certifying the bug as intended); the traces are the parked note in [07-exceptions.rip](corpus/grammar/07-exceptions.rip) and [MANIFEST.md](MANIFEST.md)'s Parked rows.

**vs v3 — v4-only for the array pattern; v3 fails the object pattern differently** (driven both sides, 2026-07-28). The lowering is the same shape — v3 emits `catch (error) { ({message} = error); … }` — and v3 types every catch binding `any`, strict or not, so the identifier spelling and `catch [first]` publish nothing there. But `catch {message}` draws TS2552 twice from v3: its shadow hoists the array pattern's name and not the object pattern's, so the destructured name is simply undeclared. A hoist gap, not a catch-type gap — v3 is broken here too, from another root. v4's `unknown` is TypeScript's own correct behaviour under strict, which is why the fix belongs in the pattern lowering's own annotation rather than in loosening the catch type back.

**Status.** ⬜ **Open** (2026-07-22) — no gate. A `check` case in the match-operator style — the TS2339/TS2488 asserted **as the gap**, liveness-paired — is the honest interim gate, unbuilt; it would go red the day the emission is fixed, the cue to invert it.

### 31. A promoted param declares no field

`constructor: (@owner: string) ->` emits the promotion's assignment but not its declaration: the face carries `this.owner = owner;` inside the constructor and **no field declaration on the class**, so TypeScript reports the class has no such property — TS2339 at the promotion itself and at every member use. Driven 2026-07-23, `rip check` over a three-line class: two TS2339, one on the constructor line, one on `crate.owner`. The runtime is untouched (the JS assignment is fine); this is purely the face's type story, and it makes field-less promotion — the construct's entire point — impossible to type-check. Any class using `@`-param promotion without redundant manual field declarations gets standing false errors on legal rip.

**The workaround is the corpus's current shape.** 08-functions carries `ParamVar → ThisProperty` only alongside explicit field declarations in the class body (`owner: string` beside the `@owner` param) — which type-checks, and which is exactly the redundancy promotion exists to remove.

**Why (code) — the emission's class walk.** The parameter's annotation is in hand at the promotion site, and the walk emits the assignment without the declaration it implies.

**The fix — emit the field the promotion implies, and dedupe it.** A class field (`owner: string`), or TypeScript's own parameter-property spelling, which is this exact feature. The precedent is in this repo, not only in v3: [dts.js](../../src/dts.js)'s constructor branch already does exactly this for the shipped declarations, skipping the field when the class body declares it — commented "one declaration". That dedupe is load-bearing rather than tidy: 08-functions carries the both-spellings shape today, and a mirror that declares unconditionally draws TS2300 and turns a green fixture red. Aim it at the CHECK MIRROR — the shipped `.d.ts` is correct on both sides, so only the mirror is wrong. When it lands, the field-less form joins 08-functions and `verdict` holds it.

**Why the suite missed it.** Every fixture exercising promotion also declares the field the emission omits — the workaround above — so the face type-checks and nothing fails. The field-less form the construct exists for is spelled nowhere.

**vs v3 — regression** (driven both sides, 2026-07-28). v3's checked face declares the field the promotion implies — `class Crate { owner: string; constructor(owner: string) { this.owner = owner; } }` — and `rip check` is clean on the field-less spelling. Both compilers' shipped `.d.ts` already carry `owner: string`; only v4's checked face omits it, so the two artifacts have diverged and the fix is to the mirror, not to the declaration emitter.

**Status.** ⬜ **Open** (2026-07-23) — no gate. A `check` case in the match-operator style — the TS2339 pair asserted **as the gap**, liveness-paired — is the honest interim gate, unbuilt.

### 52. A destructured binding read by a hoisted def is implicitly `any` under strict

```
{ json: media } = { json: 'application/json' }
def mediaType()
  media                                  # strict: TS7034 at the pattern, TS7005 here
```

The pin pass annotates a top-level binding that a hoisted `def` reads — a `def` is callable from above its own statement, so the binding's type has to reach the editor some other way, and supplying it is what the pass is for. It does not reach a binding introduced by a DESTRUCTURING PATTERN. Under `rip.strict` the pair fires: TS7034 where the pattern binds, TS7005 at the read. Permissive mode is silent and the emitted value is correct, so nothing is mistyped at runtime — what is missing is only the annotation the pass would have written.

**The shape is narrow, and the boundary is clean.** Driven with `rip check` under `rip.strict` (2026-07-27), four one-file programs:

| binding | read by a hoisted def | read in ordinary flow |
| --- | --- | --- |
| `{ json } = …` | **TS7034 + TS7005** | clean |
| `{ json: media } = …` | **TS7034 + TS7005** | clean |
| `plain = …` | clean | clean |

So it is neither destructuring nor hoisting alone — it is destructuring reached through the hoisted-read path, and the rename is irrelevant. The plain-assignment row is the pass working, which is what makes this a gap in its coverage rather than a question about whether the pass exists.

**Why (code) — a pattern target walks as reads, so `firstWrite` stays null.** The carrier set is `kept.pinnable`, built in `applyDeclareInPlace` from `captureScan`'s facts ([emitter.js](../../src/emitter.js)) — not in [pins.js](../../packages/vscode/src/pins.js), which only builds and parses the probe. `captureScan`'s assign branch walks a non-string target's names as READS (its comment: patterns stay hoisted), so a pattern-introduced name never records a `firstWrite`, and the carrier loop skips any name whose `firstWrite` is null. Driven 2026-07-28 through the public API: destructured and shorthand spellings yield an empty pinnable list where the plain assignment yields its name.

**The fix — admit the binding AND move the probe site.** Admitting the name to the carrier set is necessary and not sufficient: `buildProbe` splices `let __rip_probe_N_<name> = <RHS>` where the RHS is the assign node's whole value span, so a pattern binding would be pinned the type of the ENTIRE object — `{ json: string }` onto `media`. The probe must bind through the pattern (`let { json: __rip_probe_0_media } = <RHS>`) or the pinnable must carry an element-level value span, which is the identifier-read row's shape appearing once more; the same slice also feeds `pinKey`, so siblings from one pattern would otherwise share a hash. **Not** by annotating the pattern as a whole — the read is of one name, and a whole-pattern annotation over-constrains its siblings.

**Why the suite missed it.** Nothing had ever destructured at the top level and read the result from a `def`: the corpus's one live pinnable ([08-functions.rip](corpus/grammar/08-functions.rip) `formatOf`) reads a plainly-assigned object, and `bun test` asserts the operator's runtime values, where the annotation is invisible. Authoring [claims/20-inference.rip](corpus/claims/20-inference.rip) for the pin-pass claim is what surfaced it — the fixture was written with both spellings, and the `strict` dimension rejected the destructured one.

**vs v3 — not reachable there** (driven 2026-07-28). v3 publishes nothing on the same program under `rip.strict`, but that says nothing about its pin pass: v3's strict fires `strictNullChecks` (`x: string = null` rejects) and never fires `noImplicitAny` (an unannotated param is silent), which is the closed implicit-any row from the other side. With the family inert there is no TS7034/TS7005 pair for any binding, destructured or plain, so the coverage question this row asks cannot be put to v3 at all.

**Status.** ⬜ **Open** (2026-07-27) — **no gate**: the shape cannot enter a positive fixture while it fails the `strict` dimension, and the corpus keeps only the block-confined spelling with the destructured one named as absent on purpose. The fix's gate is that spelling entering `claims/20-inference.rip`, where `strict` holds it and the pin-pass claim's carrier goes green.

### 53. A paren-injected call's arity error lands on the wrong argument

```
pair = (left: number, right: number) -> left + right
pair 1, count, count      # TS2554 positions on `1`, not on the excess `count`
pair(1, count, count)     # the same call, explicitly parenthesised, positions correctly
```

rip injects the parens a paren-less call omits, and the emitted face is byte-identical to what the explicit spelling emits — so tsgo raises the same TS2554, on the same argument, in both cases. Only the journey back differs: mapped to source, the implicit spelling's diagnostic lands on the FIRST argument rather than the excess one. The code survives paren injection; the position does not.

**Driven** (2026-07-27, the Diagnostics Lane over `02-operations.errors.rip`): the two spellings in one file, arguments identical. The explicit call asserts clean. The implicit one reports `position TS2554: expected column 36 (\`count\`), published 26` — column 26 is the literal `1`.

**Why (code) — the identifier-read root wearing an argument list.** The injected `(…)` emits as one cover row, and an argument inside it has no source span of its own, so the resolver answers with the cover's left edge — the same mechanism that makes `console.log total` hover about `console.log`. What is new is the surface: a diagnostic, not a hover, and one whose CODE is correct, so nothing outside a position-asserting lane would notice.

**The fix rides the identifier-read row.** Give the injected argument list's elements real spans and the diagnostic lands on the offending argument with nothing to fix separately — that row's `markSpan`/`SPAN_ROLES` move is the whole of it. **Not** a resolver special-case for injected covers: that corrects the arity diagnostic and leaves every other consumer of the same cover wrong.

**Why the suite missed it.** `bun test` asserts that the paren-less call runs and that its emitted bytes round-trip, both of which hold. Nothing asserted where a diagnostic on such a call lands, because the corpus had no paren-less negative — the explicit-arity negative in 02-operations covers the code and says nothing about the spelling.

**vs v3 — regression** (driven both sides, 2026-07-28, both spellings in one file). v3 positions **both** on the excess argument — the paren-less call and the explicit one land identically on the third `count`. So paren injection costs v3 nothing positional, which is the sharpest available statement that the injected cover is v4's own construct and not an inevitable consequence of the sugar.

**Status.** ⬜ **Open** (2026-07-27) — **no gate**: the negative cannot enter the error lane while the position is wrong, since the Diagnostics Lane asserts code AND position and pinning it would certify the mis-position as intended. The claims row is parked. The fix's gate is that negative entering 02-operations' error pair, where the lane holds it by both.

### 54. A generic component's shipped declarations reference a type parameter they never declare

```
export Listing<TItem extends string> = component
  @items?: TItem[] := []
```

emits

```ts
export interface Listing {                      // no <TItem>
  items: { value: TItem[]; read(): TItem[] };   // TS2304: Cannot find name 'TItem'
};
declare let Listing: {
  new (props?: { items?: TItem[] | … }): Listing;   // and again, four more times
};
```

The type-parameter list is dropped from both the instance interface and the constructor, while every reference to it survives in the members. The declaration file does not compile: seven TS2304 for that four-line component, fourteen for [13-components.rip](corpus/grammar/13-components.rip)'s two generic components. A TypeScript consumer importing a generic component from the shipped `.d.ts` gets `Cannot find name` for a parameter it cannot see or supply.

**The checker's face is fine, and that is why this is invisible.** `rip check` reads an in-memory face where the parameter IS bound — a use-site constraint violation rejects correctly there (driven 2026-07-27: `new Listing({ items: [1, 2] })` publishes TS2322 twice). Only the emitted declarations lose it. Two surfaces, one right and one wrong, so no amount of checking source finds this.

**Why (code) — the declaration emitter drops the parameter list and keeps every reference to it.** The type-parameter list reaches neither the instance interface nor the constructor, while the members that reference it emit verbatim, so the two halves of one file disagree. Only the emitted `.d.ts` path is affected — the in-memory face binds the parameter correctly, which is why no amount of checking source finds it.

**The fix — carry the list onto both shipped declarations.** It is in hand where the members are emitted, since those members already reference it; the interface and the constructor each need it re-stated. v3's declaration (below) is the target text, so nothing here is designed. **Not** by erasing the references to match — that silently widens a generic component's props to `unknown` for every consumer.

**Why the suite missed it.** [dts-tsc.test.js](../toolchain/dts-tsc.test.js) does exactly the right thing — compiles a component's shipped declarations against a consumer program — but its fixture is `export Counter = component` with no type parameter, so the generic path has never been emitted into a compiler. Nothing else looks at declaration text for components at all: the audit's lanes read the checker's face, never the `.d.ts`.

**vs v3 — regression** (driven both sides, 2026-07-28, `-d` over the same four-line component). v3 emits `export declare class Listing<TItem extends string>` — the parameter list survives onto the declaration, so the shipped `.d.ts` compiles and a consumer can supply the argument.

**Status.** ⬜ **Open** (2026-07-27) — **no gate**, and the gate does not belong in this corpus: the audit judges the face the checker serves, which is correct here. The fix's gate is a type parameter on `dts-tsc.test.js`'s component fixture, where a consumer already compiles against the emitted declarations and would fail on the unbound name.

### 59. A type predicate in a parameter ships as `==` in the emitted declarations

```
export def apply(g: ((v: unknown) => v is string), x: unknown): boolean
  g(x)
```

emits

```ts
export declare function apply(g: ((v: unknown) => v == string), x: unknown): boolean;
```

The declaration file does not parse — driven 2026-07-28, the repo's pinned TypeScript over the emitted `.d.ts`: TS1005 twice on that one line. `rip check` reports the source **clean**, because the checker reads a face built from a different render path. So a package whose public API takes a type guard ships a declaration file no consumer can compile, and nothing on the road says so.

**Why (code) — two render paths, one of which re-tokenizes.** [typetext.js](../../src/typetext.js) states the split in its own header: an annotation position renders `normalizeTypeText` over the user's source bytes, while lexer-value positions — dts params, overload rows — render the token VALUE through `tidyType`. `is` is rewritten at scan time by `ALIASES` ([lexer.js](../../src/lexer.js), `is: ['COMPARE', '==']`), so the token value carries `==` and only the second path ships it. Same root as the type-body rejection one row over; different path, and this one is silent.

**The fix — scope the rewrite, not the renderer.** Held in common with #45: stop `is` being rewritten inside type text, and both symptoms close. **Not** by special-casing `tidyType` to undo `==` → `is`, which cannot distinguish a predicate from a user's genuine equality comparison in a type position, and would leave every other alias the same path carries.

**Why the suite missed it.** [dts-tsc.test.js](../toolchain/dts-tsc.test.js) compiles shipped declarations against a consumer program — exactly the right instrument — but no fixture's public surface takes a type predicate. The audit's lanes never look at declaration text at all, which is the same blind spot the generic-component row records.

**vs v3 — not a regression** (driven both sides, 2026-07-28). v3 corrupts the same spelling through the same alias table; its type-body face escapes for the same reason v4's does, and its declaration path does not.

**Status.** ⬜ **Open** (2026-07-28) — **no gate**: the audit judges the face the checker serves, which is correct here, and no lane reads emitted declarations. The fix's gate is the predicate spelling entering `dts-tsc.test.js`'s fixture, where a consumer already compiles against the shipped `.d.ts` and would fail to parse it.

### 55. A computed member's type is inferred from its expression's FORM, so most bodies type `any`

```
count := 3
words: string[] := ['a']

fromArith    ~= (count * 2)      # readonly value: number
fromProperty ~= words.length     # readonly value: any
bareRead     ~= count            # readonly value: any
concat       ~= (count + 1)      # readonly value: any
```

The declared type comes from the shape of the body, never from resolving what the body reads. An operator whose result type is fixed supplies it — `*` gives number, a comparison or `!` gives boolean, a literal gives its own type, and `((count * 2) + 1)` works because the inner `*` settles it. Everything else is `any`: a bare member read, a property access, an index, a method call, a ternary, and `+` — which is overloaded, so it resolves only when a sub-expression already fixed the type.

Most real computeds are in the second list.

**It reaches the consumer, not just the emission.** Driven (2026-07-27, `rip check` under `rip.strict`): a consumer assigning `p.nestedArith.value` to a mismatched type rejects with TS2322, while `p.bareNumberRead.value` and `p.concat.value` assign to anything at all. So this is the face the CHECKER serves, unlike the generic-declaration gap where the checker is correct and only the emitted `.d.ts` is wrong.

**Why (code) — two mechanisms in `memberTypeSegments`, and the second is the one that bites.** [component-types.js](../../src/component-types.js) computes a computed member's declared type from `syntacticLiteralType` — the form table the row characterizes — falling back to `typeofSpelling`, but only when `siblingRooted` is false. That guard suppresses the fallback whenever the initializer's root identifier is another component member, and it is what makes `bareRead ~= count` and `fromProperty ~= words.length` type `any` in the snippet above: driven 2026-07-28, the same four bodies at module scope declare `typeof count` / `typeof words.length` instead. The guard's own comment defers the checking it skips to "the `_init` assignment line (the generic runtime types it)" — and that compensation does not exist, because the component-carrying face delivers the runtime untyped. That is the link to the member-initializer row, and it is a dead deferral rather than a shared root: this row's declared type is fixed emitted text, byte-identical whether or not the destructure is annotated.

**The fix — resolve the body instead of pattern-matching its form.** The declared type should come from what the expression evaluates to, which tsgo computes for free if the face states the member as an inference over the body rather than a form-derived literal; the schema-callable row's `ReturnType<typeof …>` is the nearest precedent, and v3 used exactly that shape there. **Not** by extending the operator table — every form admitted leaves the next one `any`, and the table is precisely what makes property reads, most real computeds, silently unchecked.

**Why the suite missed it, and why a fixture would too.** Nothing had asserted a computed's type from outside its component. Worse, the shape that a fixture author reaches for first — `total ~= (price * quantity)` — is arithmetic, which is exactly the form that works. A claims row for the consumer face written that way goes green while every property-access computed in real code is silently unchecked.

**vs v3 — regression on the surface this row turns on** (driven both sides, 2026-07-28). The shipped `.d.ts` is where v4 is ahead: v3 types all four `Computed<any>` and v4 resolves the arithmetic one. But this row's own subject is the face the CHECKER serves, and there v3 resolves **all four** — its computeds emit as unannotated class-field initializers, so tsgo infers each — while v4 resolves one. Driven with a consumer reading each into a `string`: four TS2322 from v3, one from v4. So there IS something to restore, and v3's shape is the direct precedent the fix slot names.

**Status.** ⬜ **Open** (2026-07-27) — **no gate**. The fix's gate is a consumer-face claims row whose `~=` member reads a property rather than multiplying, where the Type Audit's `strict` dimension and the error lane's negative both hold it. It does **not** share a root with the member-initializer row: that one turns on what `__state`/`__computed` return, this one on fixed emitted text from `memberTypeSegments`, and the declared type is byte-identical with a fully typed destructure. The kinship worth recording is with the schema-callable row instead — both write a fixed type string where a face tsgo could infer through would serve the real type, and both have a v3 precedent that did exactly that.

### 43. A schema callable's output types `unknown`

Every `:shape` callable projects `unknown` as its OUTPUT into the companion — a getter and an eager derived as `unknown` outright, a method as `(...args: any[]) => unknown` — so a typed read of legal, correctly-running rip publishes: `sum: number = cart.total + 1` raises TS18046 and `wrongGetter: number = cart.total` raises TS2322 (driven 2026-07-23, re-verified 2026-07-28). The method is callable and only its RESULT is dark, so `cart.describe()` alone is clean; the rejection arrives when its result is read into a typed position. No callable member is optional. In-body reads hit the same wall: a getter reading a callable sibling (`total: ~> @subtotal * …`) publishes TS2571/TS2532 anchored at the schema head. And nothing the author writes can govern it — the callable grammar has no type slot (`label: string ~> …` is a parse-time rejection), and in-body casts and annotations are STRIPPED with the descriptor's JS, so `(@subtotal as number)` never reaches the face. Under strict the wall closes entirely on `@ensure`: its predicate's param is an implicit any (TS7006) that no spelling can annotate, so a strict corpus cannot carry `@ensure` at all.

**The corpus's current shape.** 14-schema reads callable outputs through interpolation alone (where `unknown` coerces silently), casts the one method call at the use site (a use-site cast survives; only in-body ones are stripped), recomputes `total` from fields instead of reading `@subtotal`, and carries no `@ensure` — every one a workaround, the promoted-param precedent.

**Why (code).** Callable bodies are sub-compiled at emission and land as plain JS function values in the untyped `__schema({…})` descriptor; the companion projection ([schema-types.js](../../src/schema-types.js)) types fields from their declared types but has no type information for a callable — no annotation slot exists in the field-line grammar ([schema.js](../../src/schema.js) `parseCallableLine`), and no inference crosses the descriptor — so it mints `unknown`, optional. 

**The fix — one of two roads, and the language owner picks.** A type slot in the callable grammar the projection can read, or a face shape that lets tsgo infer the body's return type. v3 built the second (below, `ReturnType<typeof …>` over an emitted behavior object), so it is demonstrated rather than hypothetical. Either way the projection stops minting `unknown`. **Not** by casting at use sites — that is the corpus's current workaround and it hides the gap instead of closing it.

**Why the suite missed it.** Nothing in the suite reads a callable's output in a typed position: the corpus interpolates its getters (`"#{order.name}"`, where `unknown` coerces without a diagnostic — the workaround shape above), and [schema-types.test.js](../schema/schema-types.test.js) types the transform's `it` (the closed schema-`it` row) but never a callable's OUTPUT.

**vs v3 — regression, and it names one of the two roads** (driven both sides, 2026-07-28). v3's checked face types the callable by DERIVING it: it emits the behavior object beside the companion and spells the member `readonly total: ReturnType<typeof __Cart__behavior.total>`, so `sum: number = cart.total + 1` checks clean where v4 raises TS18046. That is the second road above — a face shape tsgo can infer through — already built once, so the choice between it and a grammar type slot is not between one proven and one hypothetical. Note the shipped `.d.ts` says `unknown` in BOTH: v3's derivation reaches its own checker and not its consumers, so adopting it closes the in-project surface and leaves the consumer surface open.

**Status.** ⬜ **Open** (2026-07-23) — gated as the interim: the Diagnostics Lane's 14-schema pin (`error-pins.json`, the `wrongGetter` row) asserts the typed-read rejection by code and position, so the lane is green while the behavior stands and flips loudly the day callable outputs type — the cue to retire the pin, drop the fixture's workaround shapes, and let `verdict` hold typed reads in 14-schema.

### 36. A reactive import serves the raw cell

Reactivity is module-scoped at the compiler level: the importer's face carries an imported reactive name VERBATIM — no `.value` deref — so `import { count } from './store.rip'` followed by `console.log(count)` prints the cell object, and `count = 5` emits a bare assignment to an import, which the bundler rejects at build time (*Cannot assign to import "count"* — driven 2026-07-23, two-file probe, `export count := 0` in the store). Inside the exporting module the same spellings deref and notify correctly (`count = 5` lowers to `count.value = 5`; `export const` carries the cell, so there is no hoist collision — the exported-plain-binding double-declare is a different row). The editor is consistent with the emission: an importer's hover shows the cell type, which is the truth of what the importer holds.

**Why (code) — the unwrap set is scoped to the declaring module.** `collectReactiveNames` ([emitter.js](../../src/emitter.js)) builds the deref set from the declaring scope's OWN reactive names, so an imported name is never in it and the importer emits the binding verbatim. The cell's primitive-coercion protocol (`__primitiveCoercion`, [reactive.js](../../src/runtime/reactive.js)) exists only for a consumer holding a raw cell — the same design read from the runtime side.

**The fix is a ruling, and the work left is smaller and different than it looks.** The bare WRITE needs nothing: the checker already refuses it (TS2632) and the bundler refuses it again. What no design has work for is the bare READ — silent, and printing the cell object. If the cell IS the cross-module API, the remaining work is that read: decline it, or make the face say what it holds, plus the documentation that makes `.value` the stated contract. If importers should deref, reactivity metadata has to cross the module boundary and `collectReactiveNames` grows an import-aware pass. The language owner decides; these are not compatible halves, and neither is a default.

**Why the suite missed it.** Every reactive gate — battery, corpus, editor suite — exercises reactivity inside one module; 10-modules' import fixtures import functions, classes, and values, never a reactive binding. Authoring 12-reactive's export sections is what surfaced it: the export side compiles, runs, and checks clean standalone, so nothing forced the importer's view into any test.

**vs v3 — not a regression on the emission; v4 is ahead on the editor** (driven both sides, 2026-07-28, the same two-file probe). v3's importer emits the bare `import { count }` and the read prints the cell object, identically — so the model has never been settled in either version. The hover differs, though: at the importer's read v3 answers `(alias) const count: any` where v4 answers the cell's own type. v4's is the truthful answer, and it is one more piece of evidence that the cell is already the served contract.

**What is genuinely open is the model, not a defect.** Two coherent designs: the cell IS the cross-module API (importers consume `count.value` explicitly — today's behavior), or the compiler tracks reactive exports and derefs in importers (which needs reactivity metadata to cross the module boundary). The mechanism already leans toward the first, from two directions: the unwrap set is built from the declaring scope's OWN reactive names by design ([emitter.js](../../src/emitter.js) `collectReactiveNames`), and the cell carries a primitive-coercion protocol (`valueOf`/`toString`/`Symbol.toPrimitive` — [reactive.js](../../src/runtime/reactive.js) `__primitiveCoercion`) whose only beneficiary is a consumer holding the raw cell: in-module reads compile to `.value` and never coerce, so arithmetic and interpolation on an IMPORTED cell already yield the value, and only non-coercing contexts (`console.log`) show the object. But a leaning mechanism is not a stated invariant — the export-reassignment row could rule from the emitter's own asserted intent, and no such assertion exists for the importer surface. Which model is intended is the language owner's ruling.

**Status.** ⬜ **Open** (2026-07-23) — no gate while the semantics are unsettled; the exit is the ruling, which hands it an ordinary gate either way (a runtime-parity fixture importing a reactive binding, or an asserted answer at the bare read — the surface the fix slot names, and the only one still open under either design). 12-reactive covers the export productions — its whole allocation — without an importer fixture, so the corpus does not block on this row.

### 41. A forward-referenced class or component pins the probe's own symbol

Reference a class or component above its declaration — `Parent` rendering `Child` declared below it, or `make = -> new Box()` above `Box = class` — and the file publishes **TS2304 `Cannot find name '__rip_probe_0_Child'`** at 1:1, in `rip check` and the editor alike. Driven 2026-07-23, both spellings; the programs are legal and run correctly. The error is doubly wrong: a false diagnostic on legal code, spelled in the pin machinery's own minted vocabulary — a symbol the user cannot find anywhere because it exists only in a probe file that was deleted before they saw the message. Mutual and forward references between components are ordinary component-library shapes, so this reaches real code, not a corner.

**The contrast that isolates the trigger.** A forward-referenced plain object (`lookup = -> config.host` above `config = { … }`) pins cleanly and publishes nothing — the probe answer is a structural type. Only a CLASS-EXPRESSION binding (components lower to one) breaks: tsgo types an anonymous class by its own binding, so the probe declaration's hover answers **`typeof __rip_probe_0_Box`** — self-referential — and [parseProbeHover](../../packages/vscode/src/pins.js) has no self-reference clause in its unusable-answer filter (it rejects no-fence, `any`, and truncation only). The self-naming type text feeds back through `compile()` as the pin, annotating the hoisted declaration with a reference to the discarded probe file's symbol; tsgo then reports the dangling name, anchored at the hoist line, which maps to 1:1.

**Why the forward reference is what arms it.** The pin probe rounds only on bindings that STAYED hoisted and are closure-read. A class declared before its uses takes declare-in-place and never enters the probe set; the forward reference is what forces the hoist split, which is why the corpus — ladder-ordered by authoring convention, children before parents — never carried the shape, and why nothing failed until it was driven by hand.

**Why (code) — the unusable-answer filter has no self-reference clause.** [parseProbeHover](../../packages/vscode/src/pins.js) rejects no-fence, `any` and truncation, and nothing else — so the self-referential answer described above passes it, and feeds back through `compile()` as a pin naming a symbol from a probe file already deleted.

**The fix — a floor and a ceiling.** The floor is one more clause in the unusable-answer filter: an answer naming a probe symbol is self-referential and caches as null — the probe round's own doctrine ("every failure path lands on the status quo"), leaving the binding an unpinned evolving `any` rather than a false error. The ceiling — substituting the real binding name into the answer (`typeof Box`) — is NOT a free upgrade: annotating a binding with its own `typeof` is circular at the declaration site, so the substitution needs a shape that avoids self-annotation, a design step beyond the filter fix. When either lands, the forward-reference spelling enters the corpus (a claims fixture, or 13-components' use-site section) and `verdict` holds it.

**Why the suite missed it.** The pin-probe row below records the probe round as correct — which it was, on every driven shape until this one: the probe corpus was implicitly declaration-ordered, exactly like the fixture corpus, so no probe RHS was ever a class expression. The corpus cannot carry the shape while it publishes (positive fixtures demand zero diagnostics), which is also why the interim gate must live in `check`'s style, asserting the wrong behavior as the gap.

**vs v3 — regression** (driven both sides, 2026-07-28, liveness-paired in each directory). v3 publishes nothing on either spelling — the forward-referenced class and the forward-rendered component both check clean. It has no pin probe to mint a symbol from: its in-process LanguageService injects types by mutating binder symbols instead, so no manufactured name can leak. v4 introduces a false diagnostic where v3 had none.

**Status.** ⬜ **Open** (2026-07-23) — no gate. A `check` case in the match-operator style — the TS2304 asserted **as the gap**, liveness-paired — is the honest interim gate, unbuilt; it goes red the day the filter (or a substitution shape) lands, the cue to invert it and move the spelling into the corpus.

### 38. Render-DSL positions hover the lowering's scaffold

Hovering a render-DSL word answers a minted symbol, stated without hedging — driven 2026-07-23, the real server over 13-components' spellings. `ref`, `slot`, element tags, an intrinsic attr name, an event word, and the `accept` keyword all answer **`this: this`** (the factory's self); `key:` and neighbouring positions answer a scaffold local (**`let _elN: any`**); a bind target AND the user's own state name beside it answer the minted **`__bind_value__`** slot; a gate key's `params`/`id` answer the minted key-fn's own param; the `offer` keyword answers **`(local class) Give`**. The ruled answers (RULINGS.md, Components / render) are typed channel answers with silence as the only interim — a wrong answer is never a stand-in — so every one of these is a leak, the bare-effect row's shape across the whole render surface.

**A diagnostics flavor of the same territory, recorded while authoring the error pair:** a TS2304-class error on a render-body read anchors at its construct's cover START — `switch`, `for`-iterable, `unless`, attr-value, and text-expression reads all flag the keyword or marker, not the name; only a plain `if` head anchors on the name itself (driven 2026-07-23, `rip check` across all six spellings). That half is the identifier-read finding's diagnostics surface wearing render vocabulary — its root and gate live there; it is noted here because 13-components' error pair could only carry the one anchoring shape.

**Why (code).** These positions carry no user symbol — the span maps into minted scaffold (the factory's self param, a scaffold element local, the `__bind_` props slot, the key fn) and tsgo truthfully describes what sits there; the hover path never declines. The fix is server-side, the ruled-target program: the compiler knows which spans are DSL words with no user symbol, and the hover path either declines (the interim) or serves the ruled channel answer once minted.

**The fix — decline, then serve the ruled answer.** The hover path refuses these spans (the interim the ruling demands) and serves the minted channel answer once one lands; the span information it needs is the root's, above. **Not** by letting tsgo's truthful description of the scaffold stand: an answer stated without hedging about a symbol the user never wrote is exactly what the register bans.

**Why the suite missed it.** No instrument probed an in-body position: `declsOf` probes column-0 declarations, the twin oracle matches top-level names, and the silence gauge covers only bare `~>`. The `ruled` gauge (hover-pins.json's `positions` sections) is the first instrument aimed at these positions.

**vs v3 — regression** (driven both sides, 2026-07-28, the real servers over stdio, at this row's OWN subject positions). v3 never answers `this: this`. At an element tag it returns **null** — which is the ruled interim this row asks for — and at an intrinsic attr name it answers `(property) type?: string`, a truthful symbol. v4 answers `this: this` at both. So the ruled target is not something neither compiler has met: v3 already declines where declining is right and resolves where a symbol exists. An earlier reading of this slot compared a user READ inside a render body, which is a different population with a user symbol and belongs to the identifier-read row.

**Status.** ⬜ **Open** (2026-07-23) — gated softly: the Hover Audit's `ruled` gauge hovers every pinned position and expects the ruling's interim (null at these rows), red by agreement (the audit exits 0) while the server serves scaffold symbols. Green — the server declining, or serving a ruled target once one lands (rulings change first, pins follow) — retires this row.

### 39. A component member's declaration hovers the container wrapper

Hovering a component member at its declaration answers the container: `(property) Roster.people: { value: string[]; read(): string[]; }` — driven 2026-07-23 across every member kind (state, computed, readonly, prop, ref cell, and both gate target spellings; the readonly member alone answers its value type, `(property) Roster.cap: number`). The ruled target (RULINGS.md, Components / render) is the minted kind, value-first — `(state) people: string[]` — and the ruling holds the wrapper a LEAK: the value-type answer is the only truthful interim, the same doctrine that cured the top-level reactive declarations (the closed reactive-hover row).

**What keeps this honest rather than obvious:** the wrapper is not a fabrication. It is the face's declared member type, and a consumer holding an instance really does write `ref.b.value` — the container is consumer-visible in a way the top-level cell never was. The ruling still lands on value-first because the DECLARATION is the user's own vocabulary — the member was declared with `:=` and an annotation naming the value type, and the hover should speak that language, with the container story belonging to consumer-side positions.

**Why (code).** `memberDeclareSegments` ([component-types.js](../../src/component-types.js)) declares the container on the class (`declare people: { value: string[]; read(): string[] }`), and the hover at the name serves that declared type verbatim. The fix direction is the minted-kind program: the server rewrites the declaration-position answer from compiler facts (the enum-token correction's mechanism), or the face carries a value-typed declare plus the kind label when the minted-kind vocabulary lands.

**The fix — value-first at the declaration.** Either road above serves it; v3 already answers with the value type (also below), so the interim is demonstrated rather than proposed. **Not** by changing `memberDeclareSegments`' container type — a consumer really does write `ref.b.value`, so the container is right where it is; this is about which vocabulary a DECLARATION speaks.

**Why the suite missed it.** Member declarations are indented, so `declsOf` (column-0) never probed one; the twin is not an oracle for components, so no comparison ever landed there either.

**vs v3 — regression** (driven both sides, 2026-07-28, the real servers over stdio). At the same position on `people: string[] := []`, v3 answers **`(property) W.people: string[]`** — the value type, which is the ruled target's type half already served. So the wrapper is not a limitation both sides inherit and the ruling has to argue into existence: v3's answer is already the one this row asks for, and the container is what v4 added.

**Status.** ⬜ **Open** (2026-07-23) — gated softly: the `ruled` gauge's member-declaration and gate-target pins expect null (the interim while the wrapper stands ruled-out and the value-type answer is unserved), red by agreement. Green — the server serving the value-type interim or the minted-kind target — retires this row; the pins then move to the served answer, rulings first.

### 44. A `:mixin` declaration hovers the runtime's machinery

Hovering a `:mixin` schema at its declaration answers `let Stamped: __SchemaDef` — the schema runtime's internal class, served by name at a user declaration (driven 2026-07-23, 14-schema's `Stamped`). Every other kind answers in user vocabulary — `Schema<Person, Person>`, `ModelSchema<Account, …>`, the enum and union method surfaces — and the ruled register bans the machinery name outright (RULINGS.md, Principles: a machinery name is never a stand-in), so this is the bare-effect leak's shape at a declaration position.

**Why (code).** The emitter casts every other schema binding to its user-facing type — `let Doc = __schema({…}) as unknown as Schema<Doc, Doc>` — but the mixin binding gets no cast: `let Stamped = __schema({kind: "mixin", …})` falls to `__schema`'s own return type, the runtime class. The structural companion IS minted (`type Stamped = { createdBy: string }` — including schemas consume it: `type Doc = { title: string } & Stamped`); only the value binding's vocabulary is missing. The fix is the cast the other kinds already get, to a spelling that does not over-promise — a mixin is not instantiable (its parse surface rejects at runtime), so `Schema<Stamped, Stamped>` would claim what it refuses; the honest target type is the language owner's call, and the RULINGS row holds that spelling open.

**The fix — cast the mixin binding like every other schema kind.** The cast every other kind already gets is described above; the mixin binding is the one that falls through. The target spelling is the open part: a mixin is not instantiable, so `Schema<Stamped, Stamped>` would promise a parse surface it refuses — the honest type is the language owner's call, and RULINGS.md holds that row open.

**Why the suite missed it.** No fixture declared a bare `:mixin` before 14-schema, and the hover audit's decls surface pins schema names rather than twin-judging them — nothing compared the answer to the register until the pin round measured it.

**vs v3 — the leak is v4-introduced; the gap is shared** (driven both sides, 2026-07-28). v3 answers `let Stamped: any` — honest and useless — where v4 answers `__SchemaDef`. v3's shadow mints a per-name overload for every other kind (`declare function __schema(d: { name: "Doc"; … }): Schema<Doc, Doc>`) and none for the mixin, so it arrives at the same missing user-facing type by a different route. Neither answer is the ruled target, and v3's `any` is not a fallback to adopt.

**Status.** ⬜ **Open** (2026-07-23) — gated as the interim: the Hover Audit's 14-schema `Stamped` decls pin (`hover-pins.json`) asserts the measured machinery answer, so the audit is green while the leak stands and flips loudly the day the face's typing changes — the cue to rule the target spelling (RULINGS.md, Schema) and move the pin.

### 33. An enum name's semantic token says `type`, not `enum`

`enum Direction` colors as a type alias: the server publishes token type `type` (with `readonly`) at the name. The lowering is not the defect — rip deliberately emits a const object plus a companion type alias, because a native TS enum diverges at runtime (a string enum carries no reverse entries) — but tsgo classifies the FACE, and the name's mapped position lands on the companion type. Driven 2026-07-23 by the Token Audit over 11-types' three enums (`Direction`, `Status`, `export enum Priority`): expected `enum`, actual `type readonly`, all three.

**The ruling (RULINGS.md, Tokens).** The token names the construct the user declared, judged at rip's level — an `enum` keyword gets an `enum` token; the lowering must not leak into the color. Same doctrine that retired the reactive-`readonly` row (Closed table): the editor's answer follows rip's semantics, not the emission's accidents.

**Why (code) — the correction machinery exists and enum names are in no span set.** `ripSemanticTokens` ([server.js](../../packages/vscode/src/server.js)) already applies source-informed corrections, clearing TypeScript's `readonly` bit for reactive bindings from the compiler's `mutables` span list. So overriding tsgo's answer is a solved problem here; enum names simply belong to no correction's spans. The mapping layer is **not** involved: the companion alias shares the const's name, so the two symbols MERGE and tsgo classifies the merged symbol — `type` then wins at every position, including value uses. Driven 2026-07-28 against tsgo on v4's own face: delete the alias line and the same const classifies `variable [declaration,readonly]`.

**The fix — one more source-informed correction, over declarations AND uses.** The compiler knows which names an `enum` declared; the server rewrites the token type on those spans. All three positions are wrong (the declaration, the annotation, the value use), so a fix reaching declarations alone leaves two thirds standing. Note what this shares with the state-write row and what it does not: the span plumbing into `ripSemanticTokens` is common, but that row clears a modifier BIT from a list the compiler already reports (`mutables`), while this one needs a new reported span list and a token-TYPE rewrite — neither exists today. **Not** by changing the lowering: it is deliberate for the runtime reason above, and v3's face is the counter-example, declaring a native TS enum that rip rejected on purpose.

**Why the suite missed it.** The Token Audit derives its expectation from rip SOURCE, and until 11-types carried enums there was no `enum` keyword to derive one from. The `readonly` invariant that already probed these names asserts a modifier, not a type, so it passed on all three.

**vs v3 — regression at USE sites, inherited at the declaration** (driven both sides, 2026-07-28, the real servers over stdio, `enum Color` read through `c: Color = Color.Red`). v3 classifies both use positions — the annotation and the value — **`enum`**, and the declaration itself `variable [declaration,readonly]`. v4 answers `type [readonly]` at all three. The paths are now driven too, and they explain the split: v3's face declares a **native TS enum** in its dts header alongside a value `const Color = {}` in the body, so its use positions inherit `enum` from a real enum declaration while its declaration token lands on the const. v3 has no enum correction at all — it gets two thirds right by emitting the very face rip deliberately rejected, which is why its answer is not a target to copy.

**Status.** ⬜ **Open** (2026-07-23) — gated softly: the Token Audit's enum rows expect `enum` and stay red by agreement (the audit exits 0; nothing hard-gates). Green retires this row.

### 57. A void-marked binding's token says `variable` where its arrow says `function`

```
report! = -> console.log('report ran')
```

emits a SPLIT — a bare hoisted declaration and a separate assignment:

```ts
let report;
report = function(): void { … };
```

where the unmarked spelling emits one initialized declaration (`let plainFn = function() { … }`). A semantic token is read at the DECLARATION span, and that span now carries no value, so tsgo answers `variable` for a name whose value is a function. Driven 2026-07-28 across three spellings: plain and annotated (`typedFn: () => void = -> …`) both emit one declaration and classify `function`; only the void-marked one splits.

**It reaches every void-marked binding, not a corner.** The marker REQUIRES a function value — `voidNum! = 42` is refused by the emitter (*"the void marker … requires a function value"*) — so there is no void-marked binding whose token is right.

**Why (code) — the marker empties the span the token is read at.** The split shown above leaves the declaration carrying no value, so tsgo has nothing but a bare `let` to classify. The unmarked and annotated spellings emit one initialized declaration and classify `function`, which isolates the split as the whole cause.

**The fix — emit one initialized declaration.** The void annotation lands on the function expression, which `let report = function(): void { … }` carries just as well; the annotated spelling is the proof it is expressible, saying `void` in the type and emitting one statement. So the change is the emission's shape, not the annotation — and **not** a server-side token correction, which would paint over a split that has no reason to exist.

**Why the suite missed it.** The Token Audit derives its expectation from rip SOURCE ([runner.js](runner.js) `expectedTokenType`, the arrow test), and the source pins `function` correctly — nothing ever compared the two spellings' EMISSIONS, which is where they diverge. The hover surface is affected too, and its probes are green for the wrong reason. Driven 2026-07-28: with no later reference the declaration hovers `let report: any` where v3 answers `let report: () => void`; add a call and v4 recovers. 04-assignments carries `report()`, so `enrichEvolvingAnyHover` ([server.js](../../packages/vscode/src/server.js)) re-serves a reference's hover and the probe passes — the mitigation this ledger's own front matter names, covering the fixture rather than supplying the datum. So the split costs the declaration's TYPE, not only its token.

**vs v3 — regression, and it strengthens the emission fix** (driven both sides, 2026-07-28). v3 SPLITS too — all three spellings emit a bare hoisted declaration and a separate assignment — and still answers `function`, because it patches the checker: `patchUninitializedTypes` injects the first-assignment type onto the uninitialized local's symbol, and `lsp.js` calls it immediately before classifying. Driven through TS 6.0.3 with and without the patch, the same face answers `variable` then `function`. That route is structurally unavailable across an out-of-process broker, which is why the emission is the only place this can be fixed rather than merely the preferable one. **A caution for re-drivers:** v3 returns no semantic tokens at all for a file carrying no type annotation (`lsp.js` gates on `hasTypes`), so a probe must annotate something or it measures nothing.

**Status.** ⬜ **Open** (2026-07-28) — gated softly: the Token Audit's wrong-type row on this binding stays red by agreement (the audit exits 0). The agreement is SHARED with the enum-token row and names both causes, so it clears only when both close; greening one leaves the other's red standing with the reason still true.

### 37. A state write site keeps the lowering's `readonly` color

`count = 5` off `count := 0` carries the `readonly` token modifier at the write — a writable binding, colored immutable at the exact position that proves it writable. The declaration is correct: `ripSemanticTokens` ([server.js](../../packages/vscode/src/server.js)) clears TypeScript's `readonly` bit from the compiler's `mutables` span list, and the DECLARATION span is in that list — driven 2026-07-23, exported and plain spellings alike (`export count := 0` tokens `variable [declaration]`, no readonly; the write site on the next line tokens `variable [readonly]`). tsgo is classifying the face, where the cell is a `const`; the correction exists precisely to stop that lowering leaking into the color, and it stops at declarations.

**Why (code) — the correction's span set stops at declarations.** `ripSemanticTokens` clears the `readonly` bit from the compiler's `mutables` list, and that list carries declaration spans only — so a write site keeps tsgo's answer off the face, where the cell really is a `const`.

**The fix — widen the span set to use sites.** The compiler knows which names are writable state; whether `mutables` carries write-site spans or the server derives them is an implementation choice inside the existing correction. The enum-token row shares the machinery and would ride the same change.

**Why the suite missed it.** [semantic-tokens.test.js](../toolchain/semantic-tokens.test.js) and the token audit's `readonly` invariant probe column-0 declarations — the fix that closed the reactive-readonly row was gated there, so its gate certified exactly the spans it corrected. No token gate visits a use site DELIBERATELY — the one that does gets there by the `declsOf` accident the Status below names. That is the same declaration-only blind spot the identifier-read finding records for the mapping layer, but this token SURVIVES and maps — the span is right, the modifier is wrong — so the mapping census will not catch it and closing that row would strand this one.

**vs v3 — regression** (driven both sides, 2026-07-28). v3 carries no `readonly` at either the write site or the read: `count = 5` and a later `console.log(count)` both token `variable`, bare. Its correction is a source regex over `:=`/`~=`/`~>` names, stripping the bit at every reference — which is **not** a template: it over-clears, taking the bit off `~=` and `~>` bindings that this project's own ruling says must keep it. v3 is proof the answer is reachable, and its mechanism is the wrong one. (A probe of v3's token surface needs a type annotation somewhere in the file — see the note on the void-marked row.)

**Status.** ⬜ **Open** (2026-07-23) — gated softly: the declaration heuristic probes a column-0 reassignment line, so 12-reactive's `pulse` write sites land in the token audit's `readonly` invariant, which expects writable and stays red by agreement (the audit exits 0) while the correction stops at declaration spans. Green retires this row. The ruling lives in RULINGS.md (Tokens): no `readonly` at a state write site. **The gate rides an accident worth naming:** it exists because `declsOf` happens to count a bare reassignment as a declaration — a refinement excluding reassignments from the probe set, correct on its own terms, would evaporate this gate silently, the exact shape the identifier-read row's "why the suite missed it" records. If that heuristic ever tightens, this row's expectation must move into an explicit use-site probe in the same invariant, in the same change.

### 35. A wrong `:=`/`~=` initializer publishes twice, in lowering vocabulary

One wrong line, two squiggles — and the first one talks emission. `wrongState: number := 'oops'` publishes **TS2322 on the name**, whose message reads `Type '{ value: string; read(): string; }' is not assignable to type '{ value: number; read(): number; }'` — the cell wrapper, the vocabulary the hover surface was explicitly cured of when the reactive-hover row closed — **plus TS1360 on the literal**, from the `satisfies` guard the state lowering plants (`__state('oops' satisfies number)`). The computed spelling doubles the same way (TS2322 on the name in wrapper prose, a second value-level TS2322 on the expression). `=!` and an annotated effect publish once, cleanly — driven 2026-07-23, `rip check --json` across all four operators. The positions are right and the errors are real; what misleads is the count and the prose.

**Why (code) — the emission's redundant guard, not the annotation.** The annotated cell type already carries the constraint (it alone produces the name-anchored TS2322); the `satisfies` on the initializer re-states it and produces the second. The prose half is the same doctrine as the closed reactive-hover row: the user's error should speak value types, which the cell's structural assignability message does not.

**The fix — drop the guard, publish in value vocabulary.** By the root above the `satisfies` is pure duplication: the annotated cell type already produces the name-anchored error on its own. v3 publishes exactly the target — one error, value-typed (below) — so this is a demonstrated shape, not a proposal. When the emission publishes once, the pinned expectations below go red — the cue to retire them, not a regression.

**Why the suite missed it.** A directive consumes however many diagnostics land on its line — a double publishes, the marker fires, green — so marker-based negatives structurally cannot see a double. The Diagnostics Lane is the first instrument that asserts each published diagnostic individually, and deriving 12-reactive's error pair is what surfaced both the double and the prose.

**vs v3 — regression on both halves** (driven both sides, 2026-07-28, the same `wrongState: number := 'oops'`). v3 publishes **once**, and in value vocabulary: a single TS2322 reading *Type 'string' is not assignable to type 'number'*. So neither the count nor the prose is inherited — v3 plants no `satisfies` guard on the initializer and its message never mentions a cell. The fix's shape is therefore already demonstrated rather than merely argued for.

**Status.** ⬜ **Open** (2026-07-23) — gated as the interim: the Diagnostics Lane's 12-reactive pins (`error-pins.json`) assert the measured double — code and position, the hover-pins discipline — so the lane is green while the behavior stands and flips loudly the day it changes. The twin-derivable rows beside them (`=!`, effect, the TS2588 write) stay derived and are not this row's subject. **The gate's scope is the count, not the prose:** the lane asserts codes and positions, and no instrument asserts message text — so an emission change that keeps both diagnostics but cleans the wrapper vocabulary flips nothing. The prose half rides the same fix in every likely shape (one publish, value-typed), but if it ever lands separately, this row does not close on the gate alone — the body's prose claim must be re-driven.

### 34. The bare `~>` operator hovers the runtime's machinery

Hovering the operator of a bare effect (`~> console.log(…)`, column 0) answers `const __effect: (fn: () => void | (() => void)) => () => void` — the reactive runtime's own symbol, served with full signature at a position whose ruled answer is silence (RULINGS.md, Reactive: punctuation is silent, permanently; a machinery name is never a stand-in). Driven 2026-07-23 against the real server. The named spelling is unaffected — `logger ~> …` hovers the binding.

**Why (code).** The bare form lowers to a statement-position `__effect(…)` call with no user binding, so the operator's source position maps into the injected callee and tsgo truthfully describes what sits there. The fix is server-side suppression: the compiler knows the span is an operator with no user symbol; the hover path can decline to answer there, the way the ruled interim demands.

**The fix — decline at the operator's span.** The hover path returns null there, which is the ruled answer and permanently so (RULINGS.md, Reactive: punctuation is silent). The compiler already knows the span carries no user binding, per the root above. The render-DSL row wants the same suppression at the same layer, and the two would ride one change.

**Why the suite missed it.** The hover audit probes `declsOf` declarations — a line opening with `~>` declares nothing, so no probe had ever landed on the operator until the corpus carried the bare form.

**vs v3 — not a regression, inherited** (driven both sides, 2026-07-28). v3 leaks the same machinery symbol at the operator, in its `function` spelling — `function __effect(fn: () => void | (() => void)): () => void` — and additionally serves a definition jump there where v4 serves none. The named spelling agrees on both sides. So the ruled silence is unserved in both, and the suppression the fix names would cover v4's definition surface too.

**Status.** ⬜ **Open** (2026-07-23) — gated softly: the Hover Audit's `silence` gauge ([runner.js](runner.js), the probe pass) hovers every column-0 bare-`~>` position and expects null, red by agreement (the audit exits 0) while the server serves the machinery answer. Green — the server declining to answer — retires this row.

### 13. Single-rooted tsconfig — no per-project resolution

Both the editor and `rip check` generate ONE tsconfig at the mirror root that `extends` only `<workspaceRoot>/tsconfig.json` ([mirror.js](../../packages/vscode/src/mirror.js) `generatedMirror`: `extends: '../../tsconfig.json'`, `rootDirs: ['.', '../..']`). Every `.rip` file is type-checked under the ROOT's `compilerOptions`; a nested package's own `tsconfig.json` — its `types`, `lib`, `jsx`, `strict`, `paths` — is ignored. `package.json#rip` (`strict`/`noCheck`) is already resolved per-file via `readProjectConfig` (nearest `package.json`, [config.js](../../src/config.js)), so the two config systems disagree: rip policy is per-package, tsconfig is flat. A second symptom: the editor roots the mirror at the VS Code folder while `rip check`'s `findWorkspaceRoot` walks to the nearest `package.json`/`tsconfig.json`/`.git` marker — so in a monorepo the same file can extend DIFFERENT tsconfigs in the two surfaces. A third artifact rides the same flat root: the host floor (`hostFloorDts`, [mirror.js](../../packages/vscode/src/mirror.js)) is generated once per mirror from the WORKSPACE root's `rip.strict` and installed types, so a nested project's own strictness or `@types/bun` cannot govern whether ITS files see the floor — the wrapper fix below must emit the floor per project, from each project's own gate answers.

**Why (code) — one call site, and its reach-ups are literals.** All three symptoms above follow from `generatedMirror` emitting a single config whose `extends` and `rootDirs` are string constants rather than computed relatives. There is no seam at which a nested project could be consulted — which is why the fix below is additive, a second config per project, rather than a rework of how any one file resolves.

**The fix — one mirror, one session, per-project wrapper tsconfigs.** tsgo's LSP does per-file NEAREST-`tsconfig.json` discovery (the tsserver "configured project" model), so the single mirror tree and single tsgo session stay. Instead of one generated tsconfig at the mirror root, place a generated WRAPPER at each mirrored project dir, each `extends`-ing its source `tsconfig.json` with the same overrides (`noImplicitAny`, `noEmit`, `allowImportingTsExtensions`, `types:["*"]` unless the chain sets `types`) and reach-ups (`extends`, `rootDirs`) computed by `path.relative` instead of the hardcoded `../..`. tsgo then partitions the faces per project internally. Wrappers set their own `include`/`exclude`, so a source tsconfig's file set is not inherited (only `compilerOptions` are).

**Driven** — the real tsgo LSP, two probes:
- Two sibling dirs, one with a `strict:true` `tsconfig.json`, one governed by a loose root: `let x: string = null` reported `TS2322` ONLY under the nearest strict config; the loose file stayed clean. tsgo routes per file.
- The production shape — a nested generated wrapper `extends`-ing a strict source tsconfig via `../../../../pkg/tsconfig.json`, under one mirror root, one session: `pkg/a.rip.ts` reported `TS2322` (strict) while `root.rip.ts` stayed loose. Nested wrappers + reach-ups work.

**Blast radius.** Shared: generalize `generatedMirror` + add a `nearestTsconfig(dir, anchor)` walk in `mirror.js`. `rip check` ([src/check.js](../../src/check.js)): after materialization, emit one wrapper per distinct owning tsconfig — small, self-contained. Editor ([server.js](../../packages/vscode/src/server.js)): larger — emit/refresh wrappers during closure materialization and on `tsconfig.json` (or extends-chain) changes via the existing watcher; no session multiplexing. The pin pass and single-session architecture are untouched.

**Why the suite missed it.** Every gate runs in a single-package workspace, where a flat root is indistinguishable from a correct per-project one — there has never been a fixture with two tsconfigs to disagree. The two surfaces' differing roots (the editor's folder against `findWorkspaceRoot`'s marker walk) are invisible for exactly the same reason.

**vs v3 — not a regression** (driven both sides, 2026-07-28, a two-package scratch monorepo with a strict nested `tsconfig.json`). v3 ignores the nested config under both a whole-repo and a per-package invocation, liveness-paired in each. It is single-rooted too — and more uniformly so: v4's answer FLIPS with the target set, which v3's does not. A missing capability in both, and a v4 inconsistency on top.

**Status.** ⬜ **Open** (no fix). The fix approach is **verified feasible** — driven against real tsgo, above.
### 50. A rewritten literal widens its neighbours' diagnostics to the whole element list

`pair: [string, number] = ['a', label]` — with `label` a string — publishes TS2322 spanning `'a', label`, both elements, where TypeScript flags `label` alone. The editor squiggle therefore blames an element that is correct, and on a longer tuple the reader is told the list is wrong instead of which slot is.

**The trigger is the quote, not the tuple** (driven 2026-07-28, one variable at a time). Hold the type fixed and vary only the literal: `pair: [string, number] = ["a", label]` NARROWS to `label`, and `[1, label]` narrows too — while a plain `string[] = ['a', num]` WIDENS. So the fixed-length tuple is incidental; what widens the span is a rewritten literal earlier in the same element list, which is the identifier-read row's quote trigger on one more list shape. The object literal remains the contrasting case: `{ hits: label }` flags the key, because a key gets its own row. A rest tuple is unaffected — `[string, ...number[]]` reports the whole-value message on the binding, which is TypeScript's own shape for it.

**Why (code) — a mapping fault, not a checker one.** The face is line-identical to the twin (`let pair: [string, number] = ["a", label];`), so TypeScript answers the same for both; only the span mapped back to rip source differs.

**The fix rides the identifier-read row.** The face is line-identical to the twin, so nothing in the checker changes: the tuple's element list needs per-element spans, which is that row's `markSpan`/`SPAN_ROLES` move applied to one more list shape. v3 narrows correctly (below), so the target span is not in question.

**Why the suite missed it.** The corpus had no tuple negative at all — `TupleType` was claimed by a positive fixture and falsified by a whole-value mismatch, neither of which puts a wrong ELEMENT in the error lane. The census drain is what first wrote one.

**vs v3 — regression** (driven both sides, 2026-07-28, the same `pair: [string, number] = ['a', label]`). v3 flags `label` alone, TypeScript's own span; v4 widens to both elements. Since the face is line-identical on both sides, this isolates the fault to the mapping layer with no appeal to a checker difference.

**Status.** ⬜ **Open** (2026-07-24) — gated by the Diagnostics Lane's position rows on 11-types' `wrongEntry` and `wrongTrailing`, red by agreement: the contract carries `diagnostics.positions` with this row's reason, so the run reports both violations and still exits 0, and fails the day the span narrows without the reason being deleted with it. **The single-quoted leading literal is the load-bearing property of both fixtures** — rewriting them to double quotes narrows the span and greens the lane with no span work at all, which is the mitigation this gate must not accept. Assigning a whole wrong value instead would green it while testing nothing positional. `contract.js`'s `redBecause` string still carries the tuple framing and wants the same rescoping.

**Why this is not folded into the identifier-read row.** Same trigger, same resolver, same fix — what it holds that the other cannot is the only gate in the audit that asserts POSITION on a failing read. That row is red-by-design on a census computed from compiler output alone and structurally never drives a published diagnostic; this one does.

### 32. Reassigning an exported plain binding double-declares

`export flag = 1` alone emits `export const flag = 1;` — coherent, and the reason the editor's semantic token for an exported plain binding reads `readonly`. Add a later reassignment (`flag = 2`) and the two lowerings collide: the reassignment makes the binding an evolving let, so the hoist pass emits `let flag;` at the top — **and the export pass still emits `export const flag = 1;`**. The output declares `flag` twice and does not build (driven 2026-07-23: `bun` refuses the module with "flag has already been declared"). So an exported plain binding today is const when never reassigned and broken when reassigned — there is no writable spelling, whatever the intent.

**Why (code) — the hoist pass violates the export pass's stated invariant.** The emitter's export lowering asserts its position twice — *"An exported plain assign is `export const …` — a real declaration (never a hoisted write)"* ([emitter.js](../../src/emitter.js), the export walk and the hoist-boundary comment) — so the defect is one pass breaking another's stated invariant, not an unsettled semantics question.

**The fix — reject the reassignment loudly.** The for-range ban is the model: a message, never broken output. **Not** by making the export writable — const is the emitter's own asserted design, so a writable export is a language change and the language owner's call, not a defect fix. The token surface is ruled accordingly (RULINGS.md, Tokens): an exported plain binding expects `readonly`, and if writable exports ever become a deliberate feature — an emission change, the language owner's call — that expectation goes red at exactly the flip, which is the instrument speaking when semantics change.

**Why the suite missed it.** 10-modules carries exported plain bindings and never reassigns one — the two lowerings collide only when both fire on the same name, and no fixture put them together. `bun test` asserts the never-reassigned form's bytes, which are correct.

**vs v3 — not a regression** (driven both sides, 2026-07-28). v3 emits the same collision — `let count;` from the hoist pass and `export const count = 1;` from the export pass, in the same output. The invariant the emitter states has been violated on this path in both.

**Status.** ⬜ **Open** (2026-07-23) — no gate: the spelling's output does not build, so no fixture can carry it. When the rejection lands, the never-reassigned spelling remains 10-modules' covered form and the reassignment becomes an asserted compile error.

### 58. A classed SVG element emits an unclosed `setAttribute` call

```
export Icon = component
  render
    svg class: 'animate-spin'
```

emits `this._el0.setAttribute('class', "animate-spin";` — the closing paren is absent, so the module does not parse. Driven 2026-07-28 against three independent parsers, which agree: tsgo publishes TS1005 (*`)` expected*), `bun build` refuses with *Expected ")" but found ";"*, and node rejects the same bytes as ESM. Every other attribute on the same element closes correctly (`viewBox` and `fill` beside it emit whole), and a `div` carrying the identical `class:` is unaffected.

**Why (code) — the close is arity-matched to the wrong call.** The static `class` branch ([emitter.js](../../src/emitter.js), the class-attribute walk) opens on the element kind — `setAttribute('class', ` for SVG, `${el}.className = ` for HTML — which is a CALL on one side and an ASSIGNMENT on the other. Its only close is the `if (compound)` emit of `')'`, and that paren balances the `__clsx(` the branch may have opened, never the `setAttribute(`. So the assignment side needs no close and gets none, correctly; the call side needs one and never gets one, at either arity:

| SVG `class:` value | opens | closes | result |
| --- | --- | --- | --- |
| a plain string (`'animate-spin'`) | `setAttribute(` | none | one short |
| compound (`['spin', on and 'go']`) | `setAttribute(` + `__clsx(` | `__clsx`'s only | one short |

**The fix's shape is ten lines above it.** The REACTIVE class branch has the same two openings and branches its close the way it branches its open — `this.b.emit(isSvg ? '));' : ');')` — and emits whole (driven: `setAttribute('class', __clsx(this.cls.value));`). The static branch needs the same `isSvg` conditional on its close; nothing else about the lowering changes.

**It reaches shipped code.** medlabs carries two occurrences. Any component whose render tree contains a classed SVG produces a module that can be neither built nor type-checked, so every other diagnostic in that file is unreachable behind the parse failure — which is what puts a loud row this far up among the loud ones.

**Why the suite missed it.** No fixture spells `class:` on an SVG element: 13-components' SVG content carries geometry attributes, and every classed element in the corpus is HTML, which takes the `className` branch. `bun test` asserts emitted bytes for the shapes it carries, and this shape is carried nowhere, so nothing ever compared them.

**vs v3 — regression** (driven both sides, 2026-07-28). v3 emits `this._el0.setAttribute('class', 'animate-spin');` — closed, and the same module builds.

**Status.** ⬜ **Open** (2026-07-28) — no gate: the emission does not parse, so no fixture can carry it. The fix's gate is the spelling entering 13-components, where `compiles` and `runtime` hold it.

### 28. A postfix cast on an inline try body detaches the catch arm

`x = try f() as T catch e then y` does not parse — the reported error is an unexpected INDENT at the catch arm's own body. Driven 2026-07-22 across cast shapes: `as number`, `as { a: number }`, `as number[]` all fail identically, so the trigger is the cast itself, not a brace type. The same spelling without the cast parses (`try f() catch e then y` is committed corpus), and the cast without the catch parses (`x = try f() as T`); it is exactly the combination that breaks. The workaround is one pair of parens on the cast operand: `try (f() as T) catch e then y` compiles.

**Why (code) — `CAST_STOPS` omits `CATCH`, so the type run swallows the handler.** The parser never sees a CATCH at all: the lexer's cast type-run scans until a stop keyword, and `CAST_STOPS` ([lexer.js](../../src/lexer.js)) lists `IF, UNLESS, ELSE, THEN, WHILE, UNTIL, LOOP, FOR, WHEN, BY, SWITCH, RETURN, THROW` — no `CATCH` — though the set's own comment states the invariant it is breaking, that a trailing clause never swallows into the type string. Driven 2026-07-28: `rip -t` on the failing spelling yields `CAST "number catch e"` as one token value, and the run stops at `THEN`, which is why the error lands on the handler body's INDENT. The parenthesized workaround rescues it by DEPTH, not precedence — `)` drops the run below zero and breaks the scan, and its token stream carries `CAST "number"` followed by a real `CATCH`.

**The fix — add `CATCH` to `CAST_STOPS`.** The set already encodes the rule; `CATCH` is the omission. **Not** a grammar change: the token stream is wrong before the parser runs, so precedence and lookahead cannot reach it. And **not** a blanket widening of the stop set — `|` and `&` are deliberately absent because they carry union and intersection types, so the addition belongs to the clause-keyword group alone.

**Why the suite missed it.** Nothing ever spelled a cast on an inline try body. The Grammar Gate counts productions, not interaction shapes — cast × inline-try is precisely the interaction class the containment matrix exists to measure, and it is one the matrix cannot yet name: `CONSTRUCT_HEADS` carries no cast head, so the cell is unrulable until the heads are curated ([ROADMAP.md](ROADMAP.md), M3) — and this one surfaced by hand while authoring 07-exceptions, whose try-expression section sidesteps the combination today: the cast rides the handler-less form, and the handled form types itself through a declaration annotation instead.

**vs v3 — both wrong, v3 more quietly** (driven both sides, 2026-07-28). v3 PARSES the spelling and drops the handler: `x = try f() as number catch e then 0` emits `(() => { try { return f(); } catch {} })()` — no binding, no `0`, the catch arm silently gone. So the combination is unsupported on both sides, and v4 refusing it at the parser is the better of the two failures. Nothing to restore here; the fix is new work either way.

**Status.** ⬜ **Open** (2026-07-22) — loud (a compile error, not a wrong answer) and narrow, which is why it sits at the bottom of the unblocked rows. No gate: the spelling cannot enter a fixture while it fails to compile. The fix's gate is the unparenthesized spelling entering 07-exceptions, where `compiles` and `verdict` hold it.

### 29. `new` on an optional chain emits an unconstructable spelling

`new Registry?.Box` compiles and emits the optional chain into `new` verbatim — `new Registry?.Box;` — which JavaScript rejects at parse time: *Cannot call constructor in an optional chain* (driven 2026-07-23, reproduced under bun; tsgo flags the face TS2351). Every spelling of the production is affected, so no fixture can carry it: the corpus parks `NewSpine → NewSpine ?. Property` ([MANIFEST.md](MANIFEST.md)'s Parked table), which is why 09-classes' gate queue holds one row it cannot clear.

**Why (code) — the new-spine emission.** The walk emits the chain into `new` verbatim, and JS permits constructing through an optional chain only when the chain is sealed first.

**The fix — parenthesize the spine when it carries `?.`.** `new (Registry?.Box)()` — one case in the new-spine walk. Found by the M3 wave-2 author, independently reproduced by its reviewer, and re-driven for this row. When it lands, the spelling joins 09-classes and `compiles`/`runtime`/`verdict` hold it.

**Why the suite missed it.** `NewSpine → NewSpine ?. Property` was grammar-dark until the M3 sweep enumerated the productions: no fixture had spelled `new` on an optional chain, and no gate ran the emission's output.

**vs v3 — split by spelling** (driven both sides, 2026-07-28). On the CALL form (`new Registry?.Box()`) v3 emits the same unconstructable bytes — not a regression, pre-existing, dark until the grammar gate enumerated the production. On the bare form this row quotes, v3 silently DROPS the soak and emits `new Registry.Box`, which parses and runs with different semantics. So v3 is not a clean baseline here: it trades an unconstructable emission for a silently wrong one, and neither is the answer.

**Status.** ⬜ **Open** (2026-07-23) — no gate while the emission is broken; the parked manifest row is the queue's memory of it.

### 30. `new` on a tagged template leaks the sexpr head

`new tag"hi"` emits `new tagged-template(tag, "hi");` — the emitter's new-spine walk has no tagged-template case, so the internal sexpr head `tagged-template` leaks into the output as bare identifiers, parsing as the subtraction `tagged - template(...)`: TS2304 (*Cannot find name*) from the checker and ReferenceError at runtime (driven 2026-07-23). Every spelling of the production is affected, so no fixture can carry it: the corpus parks `NewSpine → NewSpine TEMPLATE_TAG String` ([MANIFEST.md](MANIFEST.md)'s Parked table), the second of 09-classes' two held rows.

**Why (code) — a missing case, not a wrong one** — the ordinary tagged-template expression lowers correctly; only the new-spine walk falls through to the generic path that prints the sexpr head raw.

**The fix — add the tagged-template case to the new-spine walk.** The correct lowering already exists on the ordinary expression path, so the case is copied rather than designed. Found by the M3 wave-2 author, independently reproduced by its reviewer, and re-driven for this row. When it lands, the spelling joins 09-classes and the ordinary dimensions hold it.

**Why the suite missed it.** `NewSpine → NewSpine TEMPLATE_TAG String` was grammar-dark until the M3 sweep, the same road as the optional-chain spine beside it — and the tagged-template family looked covered, because its ordinary form is.

**vs v3 — not a regression** (driven both sides, 2026-07-28). v3 leaks the same sexpr head, byte for byte: `new tagged-template(tag, "hi");`. Pre-existing, and dark for the same reason as the optional-chain spine beside it.

**Status.** ⬜ **Open** (2026-07-23) — no gate while the emission is broken; the parked manifest row is the queue's memory of it.

### 46. A mapped type is rejected by the type-body validator

`type Copy<T> = { [K in keyof T]: T[K] }` does not compile: the type-body validator reads TS's `in` as executable code — *"code expression ('in') in a type body — types erase and cannot execute"* (driven 2026-07-24, the expressibility census; the indented block spelling fails identically). The validator's purpose is sound — catch users writing runtime code inside erased type bodies — but mapped types are TypeScript's own grammar, not code: the rejection is a false positive of a generic check, not a considered ruling that rip's type sub-language omits them. The loss is user-authored `Partial`-shaped transforms; the built-in utility types survive (`Partial<T>` is an ordinary type reference, claimed by the corpus).

**Why (code) — a generic code-in-type-body check with no mapped-type case.** The validator scans a type body for tokens it reads as executable and rejects `in` among them. Mapped-type syntax is the one TypeScript grammar that puts `in` between `[` and `]`, and the check carries no exception for that position.

**The fix is a ruling, and admitting is the narrow side of it.** Admit `in` between `[` and `]` inside a type body — the only place TS grammar puts it — or rule mapped types out and close this into the census exclusion table beside template-literal types. v3 compiles the spelling (below), which is what makes this a decision about removing a capability — and the version of the question the language owner should actually be handed.

**Why the suite missed it.** No fixture spells a mapped type anywhere — `MappedType` sat unclaimed and invisible until the census enumerated TS's type grammar as a closed universe and the expressibility probe drove each queued kind through the compiler.

**vs v3 — regression** (driven both sides, 2026-07-28). v3 has no type-body validator and compiles the spelling, emitting `type Copy<T> = {[K in keyof T]: T[K]};` verbatim onto the face. That narrows the ruling below: mapped types were expressible until this validator, so ruling them out is removing a capability rather than declining to add one — which is a different decision, and the one the language owner should be asked.

**Whether to admit them is the language owner's call.** If yes, the fix is scoped: the validator admits `in` between `[` and `]` inside a type body (mapped-type syntax is the only TS grammar that puts it there). If no — a deliberate simplicity ruling — this row closes into the census exclusion table with that ruling as its reason, beside template-literal types.

**Status.** ⬜ **Open** (2026-07-24) — gated softly: `MappedType` stands in the census queue (`bun run audit --grammar`) and cannot drain while the lexer rejects every spelling; the row closes when the kind is admitted and claimed, or rules into the exclusion table.

### 45. A type predicate inside a type body collides with rip's `is`

`type Guard = { check: (value: unknown) => value is string }` does not compile: rip's `is`→`==` rewrite reaches inside the type body, and the lexer's own validation then rejects its product — *"code expression ('==') in a type body — types erase and cannot execute"* (driven 2026-07-24, the expressibility census; the indented block spelling fails identically). TypeScript's predicate syntax owns `is` in that position; rip's operator rewrite runs anyway. Annotation positions survive and are fully honest — a typed binding (`isStr: ((v: unknown) => v is string)`) and a nested object type both emit `v is string` onto the face and enforce it, so the predicate KIND is expressible everywhere except a `type`/`interface` declaration body. The def-return spelling survives on the face too, and corrupts in the emitted declarations — that is #59, one symptom over, same root.

**Why (code) — the `is`→`==` rewrite runs inside type bodies.** rip rewrites `is` to `==` wherever it appears, the type sub-language included, and the validator then rejects the `==` its own rewrite produced — which is why the error blames an operator the user never wrote. The def-return position escapes because the rewrite does not reach a return annotation.

**The fix — scope the rewrite so it does not reach type text.** **Not** by carving out the validator: a `type`/`interface` face is raw source (`TYPE_DECL` carries the statement text verbatim — `type Flag = { a: yes, b: no }` ships `yes`/`no` unrewritten), so a carve-out really would make this spelling correct, and that is the trap. It would close the loud symptom and leave #59's silent one, which flows through a different render path, standing.

**Why the suite missed it.** No fixture spells a type predicate anywhere — `TypePredicate` sat unclaimed and invisible until the census enumerated TS's type grammar as a closed universe and the expressibility probe drove each queued kind through the compiler.

**It is a defect, not a ruling.** The sibling rejections are not considered exclusions with their own messages: `this`-types and mapped types draw the identical generic string from the single `fail` site in `assertTypeVocabulary`. And the same predicate text is admitted, rendered and enforced one position over, so the type sub-language is inconsistent with itself rather than deliberately narrow.

**vs v3 — shared root, opposite failure mode** (driven both sides, 2026-07-28). The `is`→`==` rewrite reaches into the type body in v3 too — but v3 has no validator to catch its product, so the spelling COMPILES and emits `check :(value: unknown) => value == string` onto the face, where tsgo then reports TS2749 and TS2693 against the user's legal predicate syntax. The rewrite is the defect on both sides. v4's rejection is the louder half — but not the safer one: v4 ships the same corruption through its declaration path (#59), so it has both halves where v3 has one.

**Status.** ⬜ **Open** (2026-07-24) — no mechanical gate while the spelling is lexer-rejected: a fixture cannot carry it, and the census cannot distinguish which SPELLING claimed a kind (any `TypePredicate` claim, def-return included, drains the queue row). The boundaries note (ROADMAP.md, the error-pair conventions) records the constraint for census-queue authoring; re-drive the census probe on any change to the lexer's type-run collection.

### 48. A method member in an inline type body is rejected

`type Greeter = { greet(n: number): string }` does not compile: the type-body validator reads the member's parameter list as executable code — *"code expression ('(') in a type body — types erase and cannot execute"* (driven 2026-07-24, the census drain). It is the same generic check that rejects mapped types, firing on a name followed by a paren, and it is not a considered ruling that the type sub-language omits object methods: the sibling call signature `{ (value: number): string }` compiles inline, and the indented spelling of the very same member compiles too — `interface Sink` carries `accept(entry: string): string`. Closed finding C2 admitted this shorthand into type bodies; its fix reached the indented form and left the inline literal behind.

**Why (code) — the same code-in-type-body check, firing on a name followed by a paren.** The validator reads the parameter list as executable and refuses it. The two spellings that DO compile, above, are what isolate this to the check's reach rather than to the type sub-language's scope.

**The fix — admit a name followed by a parameter list inside a type body.** C2 admitted this shorthand and its fix reached the indented form only; the inline literal needs the same admission at the validator. The inline call signature already passing is the precedent for the exact shape, and v3 compiles the spelling (below).

**Why the suite missed it.** No fixture spelled a method member inline, and the indented spelling works, so nothing failed. The census cannot report the gap either — it records that a kind is claimed, never which SPELLING claimed it, and the indented member claims MethodSignature.

**vs v3 — regression** (driven both sides, 2026-07-28). v3 compiles the inline spelling and emits `type Greeter = { greet(n: number): string; };`. So this is not C2's fix stopping short of a form that never worked — the form worked, and the validator is what reaches it. Same root as the mapped-type row, same reframing: a capability removed, not one unbuilt.

**Status.** ⬜ **Open** (2026-07-24) — no mechanical gate: the kind is claimed, so the queue is silent, and no fixture can carry a spelling that does not compile. The boundaries note ([ROADMAP.md](ROADMAP.md)) records the constraint for census-queue authoring; the fix's gate is the inline spelling entering 11-types, where `compiles` holds it.

### 49. An import type cannot name a `.rip` module

`c: import('./lib.rip').Crate = …` publishes TS2307 — *Cannot find module './lib.rip' or its corresponding type declarations* — while the static spelling `import { Crate } from './lib.rip'` resolves the same type from the same file and checks clean (both driven 2026-07-24, the census drain). The sibling module is compiled into the program for an import STATEMENT and not for an import TYPE, so the specifier rewriting that makes `.rip` resolvable never reaches the type position. Against a `.ts` module the import type resolves and enforces normally, with the rejection landing on the rip line — so the defect is the `.rip` specifier, not the construct.

**Why (code) — an import type is not a closure edge.** There is no `.rip` specifier rewriting anywhere, in either position: the emitted face carries `import("./lib.rip").Crate` unchanged, and resolution comes from the mirror's FILENAME (`lib.rip.ts`) plus TypeScript's extension append. What differs is program membership — `ripImportsOf` ([mirror.js](../../packages/vscode/src/mirror.js)) collects edges from `import`/`export`/`dynimport` node kinds only, so an import type contributes none, and the BFS in [check.js](../../src/check.js) and `materializeClosure` ([server.js](../../packages/vscode/src/server.js)) never pull the sibling in. Driven 2026-07-28: one file that both statically imports `./lib.rip` and annotates with `import('./lib.rip').Crate` checks clean, and its mistyped twin rejects — same specifier, same type position.

**The fix — make an import type a closure edge.** One half, not two: with the module in the program the untouched `.rip` specifier already resolves and enforces, so there is nothing to rewrite. **Not** by adding specifier rewriting — the mirror-naming convention is what makes `.rip` resolvable, and a rewrite would be a second, divergent resolution rule.

**Why the suite missed it.** No fixture spells an import type anywhere; `ImportType` sat unclaimed until the census enumerated TS's type grammar as a closed universe.

**vs v3 — not reachable there** (driven 2026-07-28). v3's `rip check` accepts a directory only — handed a file it dies in `findRipFiles` on a `readdirSync` — so the sibling is always in the program and the import type always resolves. Under a whole-directory check v4 resolves it too; the rejection needs the single-file path. So this is a resolution gap that a v4 CAPABILITY exposed rather than one v4 introduced, and v3 cannot be driven to answer either way.

**Status.** ⬜ **Open** (2026-07-24) — the ImportType kind stands in the census queue. The corpus cannot carry the working spelling either: a `.ts` module dropped into the grammar bucket would read as a fixture's twin, so the kind waits on the `.rip` specifier resolving.

### 23. An in-face value declaration could retire the Tier 3 pin probe

A binding that stays hoist-split and is **also** read from inside a closure is an evolving `let` TypeScript declines to infer (`TS7034` — an evolving `let` serves only same-function references), so no site in the real face knows its type. The Tier 3 pin probe recovers those types by manufacturing a declaration site, hovering it ([pins.js](../../packages/vscode/src/pins.js)), and feeding the answer back through `compile()` as a pin — in the editor and in `rip check`'s batch alike, so the type lands in the **face** where every consumer reads it.

**The alternative works, and that is new.** A TS-only value declaration ahead of the hoist line — `const __p0 = <first-write RHS>; let x: typeof __p0;` — types the binding with no round trip at all. Driven 2026-07-28 against the repo's pinned TypeScript (7.0.2): the object case infers and its negative fires (TS2322), and so does the **class-expression** case (TS2339 on a bad member), which is the shape that makes the forward-reference row publish a dangling probe symbol. So the probe is not the only route to a type — it is the only route the current face shape leaves.

**Why (code) — what keeps a binding hoisted, and what the alternative needs.** `captureScan`'s safety rule ([emitter.js](../../src/emitter.js)) has three clauses; driven over this repo and medlabs, roughly a third of pinnable bindings are held solely by the third — any name touched inside a hoisted `def`, because a `def` is callable from above its own statement — and roughly two thirds by first-occurrence or placement, dominated by forward-referenced and recursive helpers. Neither group can declare in place: the write genuinely may not have run. The in-face declaration sidesteps that entirely by typing from the RHS rather than from the write's position, which is why it reaches cases widening never could.

**The fix — settle the strip gate, then adopt or rule.** Two things remain unproven, both narrow: the strip gate must admit a stripped TS-only value declaration (a JS capture would break it), and the RHS must resolve in the declaring scope — true of the constants that dominate the population, false where it reads a block-local. A third is cosmetic and real: the type prints as the minted name (`typeof __p0`), so hover leaks machinery unless aliased. **Not** by widening declare-in-place — driven, that reaches only self-referential function-expression writes, and the `def` hazard it declines is genuine.

**Why the suite missed it.** Nothing missed anything: no gate can fail while the probe works, which is why this row's exit was a ruling until the alternative was driven.

**vs v3 — not a choice to weigh.** `patchUninitializedTypes` (rip-lang 3.17.5, `src/typecheck.js`) does not infer a type onto the hoist line: it takes the `ts` module and the live LanguageService, calls `checker.getSymbolAtLocation`, and injects types by mutating binder symbols on DocumentRegistry-shared SourceFiles — its own comment records the price, symbols released by hand or "every rebuilt program leaks (~50MB/compile → GBs over an editing session)". The tsgo broker is a separate process spoken to over LSP: no `ts` module, no `Program`, no symbol to mutate. So v3's mechanism is unavailable here, and the in-face declaration is the portable alternative it never needed.

**Status.** ⬜ **Open** (2026-07-17) — **no gate today, and an ordinary one on adoption**: count the bindings still needing a pin, expect zero. The row closes by adopting the in-face declaration or by ruling it out on the strip gate; either way it leaves through the same door as every other row. Adopting it would also dissolve the forward-reference row, which exists only because a probe symbol can be pinned — a fixer taking this route is closing two rows and would learn that from neither.

### 16. Library globals lose the `defaultLibrary` modifier

Symbols declared in `lib.*.d.ts` reach the editor with **no `defaultLibrary` modifier**, so VS Code falls back to `variable.other.readwrite` / `entity.name.function` instead of the `support.*` scopes themes reserve for the standard library. Token *types* are correct; only the modifier is missing. Driven on `console`, `Math`, `parseInt` and `isNaN`, and true of the whole class — the lookup that sets the bit never consults the symbol, and **not one token** in the fixture carries it. The only finding here whose cause is outside rip.

**Why (code)** — tsgo's classifier (`internal/ls/semantictokens.go`, `collectSemanticTokensInRange`) passes a declaration's **raw** `FileName()` to `IsSourceFileDefaultLibrary`, a lookup in a map keyed by **canonical** paths. Canonicalization lowercases on a case-insensitive filesystem, so `/Users/…` never matches its key `/users/…` and the lookup always misses; every other caller in tsgo passes `sourceFile.Path()`. Causally confirmed: copy tsgo's lib dir to an all-lowercase path, change nothing else, and every library global gets its modifier back — same binary, same file, same client.

**Platform-conditional — the gating hazard, while the pin predates the fix.** On a case-SENSITIVE filesystem the canonicalization is the identity function and the bug does not occur, so a gate asserting `console` carries `defaultLibrary` **fails on macOS/Windows and passes on Linux**. That asymmetry disappears once the pin moves — on a fixed build the modifier is present everywhere — so this hazard is an argument for waiting, not a permanent one. Reporting differently by platform is worse than no gate, and the expected-failure device (#8) does not fit — an expected failure that passes on half the platforms is not one. Hence Gate **none**. **Never close this by asserting the modifier's ABSENCE:** that pins an upstream bug into the suite and certifies it correct. The honest gate becomes writable the day #4635 lands.

**The fix — none here, and that is the finding.** The bit never arrives, so `ripSemanticTokens` has nothing to forward and no local change can synthesize one honestly; the cause and its causal experiment are above, and the issue is linked in Status. The constraint to carry is the gating hazard's: **never** close this by asserting the modifier's ABSENCE.

**Why the suite missed it.** The modifier surface is only half-watched: `readonly` is gated and nothing asserts `defaultLibrary` — or any modifier on a LIBRARY symbol, since both that gate and the token audit probe rip's own declarations. No instrument had ever looked at a `lib.*.d.ts` name.

**Driven** — both editor servers over real LSP, same machine, matching fixture content on each side (the evidence is engine-level either way — see the binary drive below and the causal experiment above, both fixture-independent):

| server | library globals carrying `defaultLibrary` |
| --- | --- |
| v3 — in-process TS 6.0.3 LanguageService, on v3's `test/types/06-functions.rip` | **every one** |
| v4 — tsgo broker | **none** |

Also driven straight against the tsgo binary, bypassing rip: **not a single token** on the `.ts` twin, under both the native-preview extension and the released `typescript@7.0.2`. The engine, not rip's remapping.

**vs v3** — **regression** (driven, above). v3 classifies in-process through the JS TypeScript LanguageService (`getEncodedSemanticClassifications`), which canonicalizes correctly, so the same code on the same machine gets the bit. It surfaced late for the reason the escape slot above records.

**Status.** ⬜ **Open** (2026-07-14) — **fixed upstream, waiting on a stable release.** [microsoft/typescript-go#4635](https://github.com/microsoft/typescript-go/issues/4635) closed 2026-07-21 (PR #4654, `declSourceFile.Path()`), and the modifier is present when the same probe runs against a build carrying it. But no stable release has it: npm `latest` is 7.0.2, published before the merge, and the only builds with the fix are `7.1.0-dev.*` under `next`. This repo pins 7.0.2, and that pin also feeds every tsc-backed gate ([tsc.js](../support/tsc.js) `resolveTsc`), so adopting it early means putting the gates on a daily build. The row's exit is a stable 7.1 reaching the pin. It still sits last because nothing here moves it — but the reason is now a release cadence, not an unfixed upstream bug.
## Closed

Verified, and gone. **The gate is the record** — each row's constraint is stated where it is enforced, and the audit that retired these bodies confirmed the root of every one already lives in the code it governs, usually better stated than it was here. The body is recoverable from git (`git log -S`), and the commit that filed each finding still names its ID.

| # | Finding | Gate |
| --- | --- | --- |
| C1 | Optional `?` marker rejected | `dts-tsc`, audit `compiles` |
| C2 | Method-shorthand in type body rejected | `dts-tsc`, audit `compiles` |
| 1 | Implicit-any suppressed, no opt-out | `strict-modes` |
| 2 | Use-before-assign hidden by `!` | `strict-modes`, `tiers` |
| 3 | Reactive annotations not enforced | audit `verdict` |
| 4 | Evolving-`let` reassignment not caught | audit `verdict` |
| 5 | `typeof` unannotated → `undefined` | audit `verdict`/`twin`, `tsface-tsc` |
| 6 | `@ts-expect-error` dropped on multi-line emit | `tsface`, `check` |
| 7 | No headless `rip check` | `check` |
| 9 | Write-only locals hover any | hover audit's not-any invariant |
| 10 | Reactive bindings hover cell wrapper | hover audit + `hover-pins.json` |
| 11 | Config changes required a reload | `config-reactivity` |
| 12 | `rip.noCheck` parsed but never applied | `config-reactivity` |
| 14 | Unused `@ts-expect-error` silently swallowed | `check` |
| 15 | Reactive `:=` bindings tagged `readonly` | `semantic-tokens`, token audit's `readonly` invariant |
| 17 | A directive swallows the unused-local fade | `editor-features` |
| 18 | A directive blinded its whole indented block | `check`'s head-line-only case |
| 19 | Inline render-block directive lost from the face | `check`'s inline component-prop and two-way-bind directive cases; audit `verdict` |
| 20 | Render branch/loop bodies unchecked (`ctx`, loop items) | `check`'s typed-factory-params case; audit `strict` (13-components' render branches and loops) |
| 24 | A `schema` block's implicit `it` untyped | audit `strict` (14-schema's transforms); `schema-types`' transform case |
| 25 | Event handler parameters get no event type | `check`'s handler case; `dom-vocab-lib` |
| 47 | Census blind to indented type declarations | the type-vocabulary census (`runner.js`) — soft: MethodSignature is claimed only from an indented interface, so the queue silently grows if the declaration rendering is dropped |
