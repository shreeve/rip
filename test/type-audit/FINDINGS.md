# Type-audit findings — the open gaps in rip's typed-editor story

**A road, not a record.** A finding lives here until its gate is green; then its body is deleted and one line stays in [Closed](#closed). **The end state of the road is empty** — whether the Closed table drains with it is undecided. Everything a closed finding knew lives in the gate that holds it and in the commit that filed it — this file is not where that knowledge is kept, it is where the work that has not landed yet is queued.

## How to read this ledger

**Why this file exists at all.** `bun test` verifies rip against **rip** — every expectation in it was authored, so it checks only what its author already knew, and it was green through every finding recorded here (hence the *"why the suite missed it"* paragraphs below). The type audit verifies rip against **TypeScript**, through oracles this repo does not control — the hand-written twin, the source's own grammar, the fixtures' directives — which is why it can discover, and why its output is a categorized diff rather than a pass/fail boolean. The findings are that diff, written down.

**The Gate column is load-bearing, and it is the exit.** ✅ **Verified means a named gate runs and passes** — nothing else earns it, not a code reading, not a scratch script, not a plausible argument. Read in both directions that is the whole membership contract: a finding with no gate cannot be Verified however obviously fixed it looks, and a finding whose gate *is* green does not stay. **This file is the queue of constraints not yet expressible as a passing test.** Every claim here *is* reachable that way, because each is a compiler output or a server payload and LSP carries all of them — a `textDocument/hover` response *is* the text VS Code renders; the reflex to call a claim "editor-only" is usually an unwritten test, not an unreachable one. Some gates are red *by design* (#21, #8) and their rows stay until they flip — read each row's Gate cell, because a red gate does not always track only its own finding. One row (#23) has no gate because nothing about it fails: its exit is a ruling rather than a green run, unless the open question in its body answers yes and hands it an ordinary gate.

**A fix closes the root, and the test is where the datum lands** — into the **face**, where every consumer reads it, or into the one response. A gate cannot tell them apart: a mitigation makes its payload correct without supplying the datum that was missing. The Tier 3 probe (#23) feeds tsgo's answers back through `compile()` as pins, so **a query is not the tell** — across an out-of-process checker it is the only route to a type at all; `enrichEvolvingAnyHover` ([server.js](../../packages/vscode/src/server.js)) returns a reference's hover in place of an `any` and touches nothing else. Same shape, opposite verdicts. The other tell is scope: one root leaves four surfaces wrong in #21, so greening one closes nothing, and **a mitigation's residue is not the finding** — a row restated around what the workaround could not reach reads as progress, and is how a workaround becomes the architecture. Nor is the root always in the compiler (#13's is `generatedMirror`, #16's is inside tsgo): *upstream* is where to look, not the rule. Diagnose the root, state it in the body, and make the gate measure **that** — one aimed at a symptom can be satisfied by a patch, and eventually is.

**IDs are doc-internal** — nothing outside this file cites one (a row is engineered to disappear), and numbers are never reused or renumbered: the filing commit is the durable provenance. [findings.test.js](../toolchain/findings.test.js) enforces and explains this.

**Tags group by root** — `compiler` (parser/emitter) · `strict` (implicit-any & safety) · `directive` (the `@ts-expect-error` family) · `hoist` · `config` · `editor` · `capability`. Labels, not partitions: a row that shares a fix with two roots carries both.

**Conventions.** Code is cited by file and symbol, **never by line number** — greppable, and survives an edit above it; when a cited symbol is deleted, say so at the citation. Gates are cited by name and by whether they are green, **never by pass count** — counts drift when a fixture is added, going stale while the finding has not changed. **Positions** are LSP coordinates (**1-based line, 0-based column**), what the gates assert and the editor consumes; `rip check` prints 1-based/1-based, so the same diagnostic reads one column higher there.

**vs v3.** A **vs v3** line records what the typed editor did before the tsgo/LSP broker replaced v3's in-process LanguageService — the root almost every gap here traces back to. Each was established by driving v3, still reachable at 3.17.5 (`~/Code/shreeve/rip-lang`). It survives on an open row because it argues about a fix not yet made; it dies with the body when the row closes. This repo is **v4, cleaned up**; "v4" in a body means the code here.

**Re-driving.** `bun run test:all` — green as of 2026-07-18. It sets `RIP_EXTENDED=1` itself, the tier where the tsc-backed gates spawn the repo's pinned TypeScript, resolved from the workspace install ([tsc.js](../support/tsc.js) `resolveTsc`) rather than PATH, throwing loudly rather than skipping when it is missing. An editor-path change is not live in VS Code until `bun run install-vscode` from `packages/vscode/` — the running extension is the installed `.vsix`, not the working tree. The audit itself is `bun run type-audit` (`--help` for what each of its three audits is judged against, and for the one trap worth knowing before you touch `--update-hovers`). The wider editor surface — completions, definition, references, rename, code actions — is covered by the extension's own suite in `packages/vscode/test/`, not here.

## The road

Ordered by **how many rip users a gap reaches**, then by how badly the editor misleads. **Order is the recommendation; the ID is only a name** — a number records when a gap was found, which says nothing about what to do next.

| # | Finding | Tags | Gate |
| --- | --- | --- | --- |
| [21](#21-an-identifier-read-carries-no-source-span) | Identifier reads carry no source span — hover, definition, diagnostics, tokens | `editor`, `compiler` | `census` — **red by design**, the root all four surfaces share; `member` + `survival` on the token surface |
| [22](#22-completion-and-signature-help-fail-on-an-incomplete-expression) | Completion & signature help fail on an incomplete expression | `editor`, `compiler` | **none** — a content audit for each would catch them; neither built |
| [8](#8-auto-import-is-closure-scoped) | Auto-import closure-scoped | `capability` | `auto-import` — the gap is an **expected failure** |
| [26](#26-the-match-operators-emission-is-never-null-clean) | The match operator publishes TS2531 on every use | `compiler` | `check`'s match-operator case — asserts the TS2531 **as the gap**; it goes red the day the emission is fixed, the cue to invert it and move the operator into the corpus, where `verdict` holds it |
| [27](#27-a-pattern-catch-destructures-unknown) | A pattern catch publishes TS2339/TS2488 from its own lowering | `compiler` | **none** — the corpus parks both pattern spellings ([MANIFEST.md](MANIFEST.md)'s Parked table); a `check` case in the match-operator style is the honest interim gate, unbuilt |
| [31](#31-a-promoted-param-declares-no-field) | A promoted `@`-param declares no field — TS2339 on every member use | `compiler` | **none** — 27-functions carries promotion only alongside manual field declarations; a `check` case in the match-operator style is the honest interim gate, unbuilt |
| [36](#36-a-reactive-import-serves-the-raw-cell) | A reactive import serves the raw cell — no deref, writes don't build | `compiler`, `capability` | **none while the semantics are unsettled** — auto-deref vs cell-as-API is the language owner's ruling; this row's exit is that ruling, which hands it an ordinary gate either way |
| [33](#33-an-enum-names-semantic-token-says-type-not-enum) | An enum name's semantic token says `type`, not `enum` | `editor` | the Token Audit's enum rows — red by agreement (soft: the audit exits 0) until the server reclassifies |
| [37](#37-a-state-write-site-keeps-the-lowerings-readonly-color) | A state write site keeps the lowering's `readonly` color | `editor` | the token audit's `readonly` invariant at 31-reactive's state write sites — red by agreement (soft: the audit exits 0) until the correction reaches use-site spans |
| [35](#35-a-wrong--initializer-publishes-twice-in-lowering-vocabulary) | A wrong `:=`/`~=` initializer publishes twice, in lowering vocabulary | `compiler` | the Diagnostics Lane's 31-reactive pins (`error-pins.json`) assert the double **as the interim** — they go red the day the emission publishes once, the cue to retire them |
| [34](#34-the-bare-effect-operator-hovers-the-runtimes-machinery) | The bare `~>` operator hovers the runtime's machinery | `editor` | the Hover Audit's `silence` gauge — ruled-silent bare-effect positions must serve null; red by agreement (soft: the audit exits 0) until the server declines to answer |
| [13](#13-single-rooted-tsconfig--no-per-project-resolution) | Single-rooted tsconfig — no monorepo support | `config` | **none** |
| [32](#32-reassigning-an-exported-plain-binding-double-declares) | Reassigning an exported plain binding double-declares | `compiler` | **none** — the spelling's output does not build, so no fixture can carry it; the fix's gate is the spelling entering 29-modules |
| [28](#28-a-postfix-cast-on-an-inline-try-body-detaches-the-catch-arm) | A postfix cast on an inline try body detaches the catch arm | `compiler` | **none** — the spelling cannot compile, so no fixture can carry it; the fix's gate is the spelling entering 26-exceptions, where `compiles` and `verdict` hold it |
| [29](#29-new-on-an-optional-chain-emits-an-unconstructable-spelling) | `new` on an optional chain emits an unconstructable spelling | `compiler` | **none** — the emission cannot parse as JS, so no fixture can carry it; the production is parked ([MANIFEST.md](MANIFEST.md)); the fix's gate is the spelling entering 28-classes |
| [30](#30-new-on-a-tagged-template-leaks-the-sexpr-head) | `new` on a tagged template leaks the sexpr head | `compiler` | **none** — the emission references undeclared names, so no fixture can carry it; the production is parked ([MANIFEST.md](MANIFEST.md)); the fix's gate is the spelling entering 28-classes |
| [23](#23-the-tier-3-pin-probe-cannot-be-retired-by-more-declare-in-place) | Pin probe can't be retired by more declare-in-place | `hoist` | **none while the probe stands** — nothing fails; one open question could hand it a gate |
| [16](#16-library-globals-lose-the-defaultlibrary-modifier) | Library globals lose `defaultLibrary` | `editor` | **none, and none is honest** — upstream; a naive gate is platform-dependent |

**The ordering principles.** Audience first: everything down to #8 reaches every rip user, mode-independent — permissive still infers. Within a band, *silently wrong* outranks *visibly missing*: a wrong answer stated without hedging misleads, where a loud failure merely interrupts — so the loud rows (build breaks, parse errors) sink below the silent ones however broken their output is. #16 sits last because it is blocked upstream, not because it matters least. Each row's own body argues its place; this paragraph does not restate them.

**The `strict` dimension's clean run is contractual** — a red row there is a discovery, not residue; the runner's header states the curation rules.

## Findings

### 21. An identifier read carries no source span

An identifier READ gets no mapping row of its own — it inherits the **cover** row of whatever construct carries it. Every consumer that resolves a face position by byte arithmetic ([generatedEditSpanToSource](../../packages/vscode/src/translate.js)) refuses past the first byte divergence inside that cover and falls back to the **cover's start**, so the read does not resolve imprecisely — it resolves to *another symbol*.

**Four surfaces, one root** — driven 2026-07-17, the real server against tsgo on the hand-written twin, at the argument read in a `console.log` whose label is single-quoted:

| surface | source | answer at the read |
| --- | --- | --- |
| hover | `console.log('total:', total)` | **`(method) Console.log(...data: any[]): void`** — the wrong symbol, stated without hedging |
| definition | `console.log('total:', total)` | **null** |
| diagnostics | `console.log('total:', totalz)` | underlines `'total:', totalz`; TypeScript underlines the name alone |
| semantic token | `console.log('total:', total)` | dropped |

The diagnostics row needs a *bad* name — a resolving `total` raises nothing to mis-place — so it reads `totalz`; the other three need a resolving one. Same construct, same cover, same collapse.

Checking itself is **sound** — the same diagnostics fire with the same codes, and the compiled JS is unaffected; only *where* an answer lands is wrong. It misleads, it does not let a bug through — which is what would rank it under any unchecked-code hole, and what still separates it from everything below it.

**Two triggers, each sufficient alone** (driven, one variable at a time, same read):

| | no literal | double-quoted | single-quoted |
| --- | --- | --- | --- |
| **parens** | ok | ok | **fails** |
| **paren-less** | **fails** | **fails** | **fails** |

A **paren-less call** fails unconditionally — the `args` cover maps source `total` onto face `(total)`, so the face span opens with an inserted `(` and the verbatim prefix is zero-length. A **single-quoted literal** fails positionally — `('x:', total)` → `("x:", total)` holds the prefix until the quote, so arguments *left* of it survive. Parens **and** double quotes is the only combination that works, and neither is idiomatic rip: this fires on ordinary code, not a corner.

**Status.** ⬜ **Open** (2026-07-17) — **gated red by design** by the Mapping Audit's census (`bun run type-audit --map`): reads with no exact row, straight from the compiler output, mitigation-proof. All four surfaces are the same byte-math over the same mapping rows, so the census is the gate for *every* one of them — driven to zero, the cover-collapse mechanism is gone on hover, definition, diagnostics and tokens alike, by construction; no per-surface gate would tell you anything it doesn't. The token surface additionally carries `member` and `survival`. What no gate *drives* is the three server surfaces at a failing read — `verdict` counts Error-severity diagnostics and gets zero (a fixture's `@ts-expect-error` is consumed inside tsgo, on the face, at the face's true positions — *before* rip's mapping runs, so the mis-position is unreachable while the directives are in place), and the hover audit probes only `declsOf` declarations, never a read — but driving them is a question of server *delivery* (does the plumbing serve the right answer once the spans exist), a concern separate from this finding's root. The root is watched, and goes green only when the fix below lands.

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
| the audit corpus, 12 fixtures | 515 / 2,138 — 24% |

**The corpus rate sits between the two, so for this row it is a fair instrument** — the rate is uniform because the triggers are ordinary syntax, not a shape that needs scale to appear. (It is not fair for #23, where the same 12 fixtures under-count by two orders of magnitude and carry the wrong shape.) A hover-containment sweep — a returned range must contain the position asked for — finds **100** wrong across 9 of the 12 fixtures today. The gap between census and sweep is the finding: the rest are one face rewrite away from breaking, with nothing watching. [10-validation.rip](fixtures/10-validation.rip) is the corpus's most exposed file (42%) and reports **zero** hover violations; medlabs' worst is `app/components/icon.rip` at 94%.

**Root (code) — three categories, each losing the span at a different point.**

- **List elements** (call arguments). The list *is* a node with a span — `console.log a, b` yields one node over `a, b` — but per-element spans are never derived: [parser.js](../../src/parser.js) records one row per **role**, and for a spread role `childNodeId` stays null, because [stores.js](../../src/stores.js) takes per-element spans only from *"the children's own NodeStore rows"* and a bare identifier is a primitive string in the tree (`["...", "console", "log"], "total"`), which has none. The span exists transiently at the accumulator's reduce (`locs`) and dies when the stack pops.
- **Annotation names.** The `annotation` role's span is `": number"` — it includes the operator — and `number` gets no node.
- **Type-declaration internals.** `type ID = string` is **one lexer token** (`TYPE_DECL`, via [lexer.js](../../src/lexer.js)'s `claim`) → one node → one role over the whole text. `ID` and `string` have no spans *at all*; the grammar never sees inside a type. This is the largest slice — `string` and `number` top the at-risk census — and the type-heavy fixtures are the most exposed in the corpus (10-validation 42%, 05-interfaces 39%, 03-structural 37%, 02-aliases 35%).

**The fix — upstream, and the same move for all three.** Give primitive reads real source spans and mark them: `markSpan` + `SPAN_ROLES` ([builder.js](../../src/builder.js)), whose `mappingKind` stays decided by the builder's verbatim comparison, so a name row classifies exact **by construction** rather than by assertion. `shorthandProp` is the precedent and the model — *"a boolean-shorthand prop key is a primitive with no store row"*, given an exact row from an anchored bare-word scan. Type internals need no type grammar: the `TYPE` token already carries its span and its text, and the face emits that text near-verbatim, so the scan is over text already in hand. **Do not solve this at query time.** A query-time resolver (identity, ordinal, or otherwise) fixes one consumer, cannot serve the edit path — which must never guess — and structurally cannot resolve a name that repeats inside its cover, which an emit-time row resolves for free because the span is *known*, not searched. See the upstream rule under [How to read this ledger](#how-to-read-this-ledger).

**The gate this wants is built** — the Mapping Audit ([runner.js](runner.js) `mappingScan`, `bun run type-audit --map`). Its **census** is exactly this: reads with no exact row, computed straight from the mapping rows, no server and no oracle. It measures the root and nothing else, so no downstream mitigation can satisfy it — only giving reads real source spans reduces it. **Red by design** until that fix lands; it goes green when every read classifies exact. The same run also reports the broken-**today** subset (`placed`/`text` — reads whose precise resolution refuses or lands on wrong bytes), a strict subset of the census: the remainder resolve today only by a verbatim cover prefix, one face rewrite from breaking, which the census counts and a symptom gate would not. The audit's logic was validated against the real editor once and then shipped standalone (no server, no oracle); see [ROADMAP.md](ROADMAP.md) "M1".

**Why the suite missed it.** Every token gate was source-enumerated at declarations — `declsOf` (column-0), plus [semantic-tokens.test.js](../toolchain/semantic-tokens.test.js) and the `readonly` sweep on column-0 `:=`/`=!`/`~=` names. A name's *declaration* gets a token, so every gate passed while its *use* was never in any set. The editor suite's definition tests are the sharper miss: they **do** drive use sites (`// total at its read`, `// answer at its use` — [editor-features.test.js](../../packages/vscode/test/editor-features.test.js)), and pass because their fixtures are `next = total + 1` and `double = answer * 2` — binop operands, which the emitter's read guard gives an exact row. Right position, source that cannot fail. And `declsOf`'s own comment names the construct it excludes — *"a name followed by `.`/`(`/`[` is a usage (`console.log(…)`) — which the old heuristic wrongly probed"* — a refinement that was correct on its own terms and removed the only shape in the corpus that carries the defect.

**vs v3 — established for TOKENS (driven both sides, 2026-07-15), unestablished for the other three.** v3 compiles to TS, runs `getEncodedSemanticClassifications`, and remaps the spans back (rip-lang 3.17.5 `packages/vscode/src/lsp.js`) — it is not remap-free, so a token surviving there is a property of its remap, not of classifying on raw source. The token verdict **splits by surface**:

- **Type-body members — regression.** `type Circle = { kind: 'circle', radius: number }`: v3 classifies `radius` `property`, v4 drops it. The `member` gauge tracks a genuine v4 loss — v3's remap survives the quote rewrite where v4's cover-prefix does not.
- **Use sites — mostly inherited, causes inverted.** `console.log('total:', total)`: both drop the use, so no outcome change on the common single-quoted form. But the cause is opposite — v4 drops it to quote-normalization (`console.log("total:", total)` **rescues** it in v4, which is the trigger table above), while v3 drops it to the call-argument context regardless of quotes (double-quoting does **not** rescue it in v3). A bare `x = total` and a minimal reactive read (`x = clicks` off `clicks := 0`) classify in **both**. So the `console.log`-argument drops — the bulk of the `survival` count — are v3-inherited, not v4 drift.

Unsettled on tokens: 08's reactive reads drop in v4 only in render/component context (the minimal read survives both); that exact context was not reproduced on v3. Net for tokens: the **member** surface is the established v4 regression; the **use-site** surface is largely a shared, pre-existing limitation.

**Unsettled everywhere else, and it is the bigger question.** Whether v3 *hovers* a read correctly, resolves its definition, or positions its diagnostics — the three surfaces this row now turns on — was never driven. Re-drivable at 3.17.5 (`~/Code/shreeve/rip-lang`); worth settling before assuming those three are v4 drift, since the token split above shows the answer can invert per surface.

### 22. Completion and signature help fail on an incomplete expression

The broker builds its TypeScript face from a **successful** compile, so it can serve a request only where the source parses — but the two features whose trigger is an *incomplete* expression fire precisely where it does not. The trigger byte is the same byte that breaks the parse: type a member-access dot and pause (`items.‸`), or sit inside an open call (`add(‸`), and the buffer no longer parses, so no face carries the member-access / call context and the request has nothing to map into. rip's compiler throws where TypeScript's error-tolerant parser recovers — which is why the hand-written twin serves the correct answer on the identical incomplete text and the broker does not. What you actually get instead is nothing, or (for completion) the wrong list; the popup works only once the expression is complete enough to parse, which is backwards from how these features are used.

**Two surfaces, one root.** Member completion at a bare dot and signature help inside an open call. Both are un-parseable at the cursor (`bin/rip --ts` on `items.` → `Unexpected end of input — expected PROPERTY`; on `add(` and `add(1,` → a parse error at the `(`), so neither has a face. They differ only in fallback: completion has a statement-context one (it serves *something* wrong), signature help has none (it serves plain null).

**Status.** ⬜ **Open** (2026-07-15) — no fix, no gate. A completion content audit (twin-oracled on the item set + resolved `detail`) and a signature-help audit (on the label + `activeParameter`) would catch the two surfaces and, sharing this root, retire together the day the parse gap closes — but both are unbuilt, and the extension tests exercise only the parseable form of each (below), which is why the suite is green.

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

### 8. Auto-import is closure-scoped

v4 offers auto-import candidates only from the ACTIVE PROGRAM (open files + transitive imports) plus `node_modules`/`@types`. A workspace `.rip` nothing open imports is not offered until you open/import it — the feature's headline case (import from a file you have *not* opened) is defeated for `.rip`→`.rip`; only npm/`@types` work fully.

**Status.** ⬜ **Open** (2026-07-14). No fix has landed, but the finding is **gated** — [auto-import.test.js](../toolchain/auto-import.test.js) drives real completion requests against the server. What works is asserted green (a candidate reachable through the closure *is* offered — a genuine guard against auto-import breaking altogether; opening the orphan *does* bring it in, which is what proves the candidate set is exactly the tsgo program). The gap itself is an **expected failure** asserting the correct behavior — an unimported workspace `.rip` should be offered from cold — so it stays red by agreement while this is open and converts to a real failure the day the scope widens. Pinning the broken behavior as if it were correct would be worse than no coverage: a green test certifying the gap.

*Trap worth recording:* tsgo filters auto-import candidates **by prefix**, so a probe typed at `sh` can never offer `orphanWidget` no matter what the program contains — a gate probing the wrong prefix would "reproduce" this against a server that had it fixed. And a bare identifier statement does not map cleanly into the face and answers with no completions at all; the probe must sit in an expression position.

**Reproduced** — real server over LSP (2026-07-09): workspace with `util.rip` (reachable — `a.rip` imports it, open `app.rip` imports `a`) + `orphan.rip` (nothing imports it). Completing in `app.rip` offers `shout` from `./util.rip` [closure works] but not `orphanWidget`, which stays `TS2304` with no quickfix [the gap]. Opening `orphan.rip` makes `orphanWidget` immediately offered → candidate set = the closure, reversible only by bringing the file in.

**Why (code)** — the generated tsconfig ([mirror.js](../../packages/vscode/src/mirror.js) `generatedMirror`) roots its `include` at the mirror closure: `['**/*.ts', '../../**/*.d.ts']`. The reach-up matches ambient declarations only — no `.rip` mirrors — so the candidate set is exactly the tsgo program, and the program is exactly the open buffers' closure (`materializeClosure` walks only seeds and recorded imports; `pruneClosure` drops any mirror no open buffer reaches).

**vs v3** — v3's in-process LanguageService rooted its project at the whole workspace (tsconfig `include` globbed all sources), so every workspace file was a candidate from cold. This was originally filed as a "scope note," which undersells it: for this feature it is a functional regression, not a caveat.

### 26. The match operator's emission is never null-clean

`text =~ /re/` lowers to `(_ = toMatchable(text).match(/re/))` ([emitter.js](../../src/emitter.js) `matchOp`), and the face's own prelude types `toMatchable` as `(v: any, allowNewlines?: boolean) => string | null` (the `RUNTIME_TABLE` annotation — honest: a multi-line string without `/m` deliberately coerces to `null` so the match throws loudly rather than anchoring wrong). The emitted call then invokes `.match` on that union unguarded, so **every** `=~` expression — any operand type, permissive and strict alike, no `package.json` in sight — publishes TS2531 *Object is possibly 'null'* on legal rip. The regex-index sugar shares the root and flags identically: `text[/re/]` and `text[/re/, n]` emit the same `toMatchable(…).match(…)` spine (`regexIndex`, same file). Driven 2026-07-22, `rip check --json` over a two-line file (`text = 'abc'` / `found = text =~ /b+/`): TS2531 spanning the whole match expression.

**Why the suite missed it.** `bun test` asserts the operator's runtime values, and nothing ever type-checked an `=~` face: `Expression MATCH Expression` was grammar-dark until the M3 sweep — authoring 21-operations is what surfaced this. The corpus **parks the operator**: a positive fixture cannot carry it (the `verdict` dimension means zero published diagnostics, and M3 fixtures carry no directives), and the Diagnostics Lane cannot assert it as a negative (TS2531 anchors on a call expression that the line-aligned twin can only spell as TS18047 on a bare identifier — the codes cannot be made to agree, and blessing the diagnostic would certify the bug as intended). The corpus's traces are the parked note in [21-operations.rip](fixtures/21-operations.rip) and [MANIFEST.md](MANIFEST.md)'s Parked rows — the operator, and the regex-index spelling that shares its root; the gate lives outside it. [check.test.js](../toolchain/check.test.js)'s match-operator case drives the real CLI and asserts the current, wrong behavior on purpose — TS2531 bound to each spelling's line (columns left free: a mapped-column shift is not a fix), liveness-paired with a genuine TS2322 in the same workspace so a checker that stopped reporting anything cannot impersonate the fix (the auto-import pattern, and for the same reason not `test.failing`). It goes red the day the emission is fixed — the cue to invert it, not a regression.

**The root is the emission's type story, not the runtime's semantics.** The `null` return is load-bearing — it is the loud-throw path — so the fix belongs in how the emitted spine acknowledges that branch, not in softening `toMatchable`'s honest signature. When it lands, `=~` (and the regex-index spelling) join 21-operations and the `verdict` dimension holds both.

### 27. A pattern catch destructures `unknown`

`catch {message}` and `catch [first]` lower to a minted binding plus a first-statement destructure — `catch (_err) { ({message} = _err); … }` ([emitter.js](../../src/emitter.js), the catch-pattern branch of the try emission, `Emitter.isPattern`) — and the face types that binding `unknown`, so the destructure itself publishes: **TS2339** *Property does not exist on type 'unknown'* on an object pattern, **TS2488** *not iterable* on an array pattern, anchored on the source pattern. Driven 2026-07-22, `rip check` over both spellings, no `package.json` in sight. Every pattern catch publishes on legal rip.

**The identifier spelling is not this finding.** `catch e` followed by `e.message` raises the same-family TS18046 — but on the USER'S read, which the user can govern the ordinary TypeScript ways (`instanceof`, a cast). The pattern's error sits on **compiler-minted code with no narrowing seam**: nothing the author writes can stand between the binding and the destructure, so the only recourse is a directive on legal syntax.

**Why the suite missed it.** `bun test` asserts the pattern bindings' runtime values, and nothing ever type-checked a pattern catch's face: `Catch → CATCH Object Block` and `Catch → CATCH Array Block` were grammar-dark until the M3 sweep — authoring 26-exceptions is what surfaced this, the same road #26 arrived by. The corpus parks both spellings (a positive fixture cannot carry them — `verdict` means zero published diagnostics, and M3 fixtures carry no directives — and the Diagnostics Lane cannot bless the codes without certifying the bug as intended); the traces are the parked note in [26-exceptions.rip](fixtures/26-exceptions.rip) and [MANIFEST.md](MANIFEST.md)'s Parked rows.

**The root is the lowering's type story.** TypeScript permits exactly two catch annotations, `any` and `unknown` — so the pattern branch can acknowledge its own destructure by minting `catch (_err: any)` (or casting at the destructure), scoped to the pattern lowering alone, leaving the identifier spelling's honest `unknown` untouched. When it lands, both pattern spellings join 26-exceptions and `verdict` holds them.

**Status.** ⬜ **Open** (2026-07-22) — no gate. A `check` case in the match-operator style — the TS2339/TS2488 asserted **as the gap**, liveness-paired — is the honest interim gate, unbuilt; it would go red the day the emission is fixed, the cue to invert it.

### 31. A promoted param declares no field

`constructor: (@owner: string) ->` emits the promotion's assignment but not its declaration: the face carries `this.owner = owner;` inside the constructor and **no field declaration on the class**, so TypeScript reports the class has no such property — TS2339 at the promotion itself and at every member use. Driven 2026-07-23, `rip check` over a three-line class: two TS2339, one on the constructor line, one on `crate.owner`. The runtime is untouched (the JS assignment is fine); this is purely the face's type story, and it makes field-less promotion — the construct's entire point — impossible to type-check. Any class using `@`-param promotion without redundant manual field declarations gets standing false errors on legal rip.

**The workaround is the corpus's current shape.** 27-functions carries `ParamVar → ThisProperty` only alongside explicit field declarations in the class body (`owner: string` beside the `@owner` param) — which type-checks, and which is exactly the redundancy promotion exists to remove.

**The root is the emission's class walk.** The parameter's annotation is in hand at the promotion site; the fix is emitting the declaration it implies — a class field (`owner: string`) or TypeScript's own parameter-property spelling, which is this exact feature. When it lands, the field-less form joins 27-functions and `verdict` holds it.

**Status.** ⬜ **Open** (2026-07-23) — no gate. A `check` case in the match-operator style — the TS2339 pair asserted **as the gap**, liveness-paired — is the honest interim gate, unbuilt.

### 36. A reactive import serves the raw cell

Reactivity is module-scoped at the compiler level: the importer's face carries an imported reactive name VERBATIM — no `.value` deref — so `import { count } from './store.rip'` followed by `console.log(count)` prints the cell object, and `count = 5` emits a bare assignment to an import, which the bundler rejects at build time (*Cannot assign to import "count"* — driven 2026-07-23, two-file probe, `export count := 0` in the store). Inside the exporting module the same spellings deref and notify correctly (`count = 5` lowers to `count.value = 5`; `export const` carries the cell, so there is no hoist collision — the exported-plain-binding double-declare is a different row). The editor is consistent with the emission: an importer's hover shows the cell type, which is the truth of what the importer holds.

**Why the suite missed it.** Every reactive gate — battery, corpus, editor suite — exercises reactivity inside one module; 29-modules' import fixtures import functions, classes, and values, never a reactive binding. Authoring 31-reactive's export sections is what surfaced it: the export side compiles, runs, and checks clean standalone, so nothing forced the importer's view into any test.

**What is genuinely open is the model, not a defect.** Two coherent designs: the cell IS the cross-module API (importers consume `count.value` explicitly — today's behavior), or the compiler tracks reactive exports and derefs in importers (which needs reactivity metadata to cross the module boundary). The mechanism already leans toward the first, from two directions: the unwrap set is built from the declaring scope's OWN reactive names by design ([emitter.js](../../src/emitter.js) `collectReactiveNames`), and the cell carries a primitive-coercion protocol (`valueOf`/`toString`/`Symbol.toPrimitive` — [reactive.js](../../src/runtime/reactive.js) `__primitiveCoercion`) whose only beneficiary is a consumer holding the raw cell: in-module reads compile to `.value` and never coerce, so arithmetic and interpolation on an IMPORTED cell already yield the value, and only non-coercing contexts (`console.log`) show the object. But a leaning mechanism is not a stated invariant — the export-reassignment row could rule from the emitter's own asserted intent, and no such assertion exists for the importer surface. Which model is intended is the language owner's ruling.

**Status.** ⬜ **Open** (2026-07-23) — no gate while the semantics are unsettled; the exit is the ruling, which hands it an ordinary gate either way (a runtime-parity fixture importing a reactive binding, or an asserted loud rejection of the bare read). 31-reactive covers the export productions — its whole allocation — without an importer fixture, so the corpus does not block on this row.

### 33. An enum name's semantic token says `type`, not `enum`

`enum Direction` colors as a type alias: the server publishes token type `type` (with `readonly`) at the name. The lowering is not the defect — rip deliberately emits a const object plus a companion type alias, because a native TS enum diverges at runtime (a string enum carries no reverse entries) — but tsgo classifies the FACE, and the name's mapped position lands on the companion type. Driven 2026-07-23 by the Token Audit over 30-types' three enums (`Direction`, `Status`, `export enum Priority`): expected `enum`, actual `type readonly`, all three.

**The ruling (RULINGS.md, Tokens).** The token names the construct the user declared, judged at rip's level — an `enum` keyword gets an `enum` token; the lowering must not leak into the color. Same doctrine that retired the reactive-`readonly` row (Closed table): the editor's answer follows rip's semantics, not the emission's accidents.

**Root and fix are editor-side, and the mechanism exists.** `ripSemanticTokens` ([server.js](../../packages/vscode/src/server.js)) already applies source-informed corrections — it clears TypeScript's `readonly` bit for reactive bindings from the compiler's `mutables` span list. Enum names are one more such correction: the compiler knows which names an ENUM declared, and the server rewrites the token type on those spans. rip's lowering does not change.

**Status.** ⬜ **Open** (2026-07-23) — gated softly: the Token Audit's enum rows expect `enum` and stay red by agreement (the audit exits 0; nothing hard-gates). Green retires this row.

### 37. A state write site keeps the lowering's `readonly` color

`count = 5` off `count := 0` carries the `readonly` token modifier at the write — a writable binding, colored immutable at the exact position that proves it writable. The declaration is correct: `ripSemanticTokens` ([server.js](../../packages/vscode/src/server.js)) clears TypeScript's `readonly` bit from the compiler's `mutables` span list, and the DECLARATION span is in that list — driven 2026-07-23, exported and plain spellings alike (`export count := 0` tokens `variable [declaration]`, no readonly; the write site on the next line tokens `variable [readonly]`). tsgo is classifying the face, where the cell is a `const`; the correction exists precisely to stop that lowering leaking into the color, and it stops at declarations.

**Root and fix are editor-side, and the mechanism exists** — the same one as the enum-token row: the compiler knows which names are writable state; the correction's span set needs to include their write sites, not only their declarations. Whether `mutables` should carry use-site spans or the server should derive them is an implementation choice inside the existing correction.

**Why the suite missed it.** [semantic-tokens.test.js](../toolchain/semantic-tokens.test.js) and the token audit's `readonly` invariant probe column-0 declarations — the fix that closed the reactive-readonly row was gated there, so its gate certified exactly the spans it corrected. No token gate visits a use site; that is the same declaration-only blind spot the identifier-read finding records for the mapping layer, but this token SURVIVES and maps — the span is right, the modifier is wrong — so the mapping census will not catch it and closing that row would strand this one.

**Status.** ⬜ **Open** (2026-07-23) — gated softly: the declaration heuristic probes a column-0 reassignment line, so 31-reactive's `pulse` write sites land in the token audit's `readonly` invariant, which expects writable and stays red by agreement (the audit exits 0) while the correction stops at declaration spans. Green retires this row. The ruling lives in RULINGS.md (Tokens): no `readonly` at a state write site. **The gate rides an accident worth naming:** it exists because `declsOf` happens to count a bare reassignment as a declaration — a refinement excluding reassignments from the probe set, correct on its own terms, would evaporate this gate silently, the exact shape the identifier-read row's "why the suite missed it" records. If that heuristic ever tightens, this row's expectation must move into an explicit use-site probe in the same invariant, in the same change.

### 35. A wrong `:=`/`~=` initializer publishes twice, in lowering vocabulary

One wrong line, two squiggles — and the first one talks emission. `wrongState: number := 'oops'` publishes **TS2322 on the name**, whose message reads `Type '{ value: string; read(): string; }' is not assignable to type '{ value: number; read(): number; }'` — the cell wrapper, the vocabulary the hover surface was explicitly cured of when the reactive-hover row closed — **plus TS1360 on the literal**, from the `satisfies` guard the state lowering plants (`__state('oops' satisfies number)`). The computed spelling doubles the same way (TS2322 on the name in wrapper prose, a second value-level TS2322 on the expression). `=!` and an annotated effect publish once, cleanly — driven 2026-07-23, `rip check --json` across all four operators. The positions are right and the errors are real; what misleads is the count and the prose.

**Why the suite missed it.** 08-reactive's negatives are `# @ts-expect-error` markers, and a directive consumes however many diagnostics land on its line — a double publishes, the marker fires, green. The Diagnostics Lane is the first instrument that asserts each published diagnostic individually, and deriving 31-reactive's error pair is what surfaced both the double and the prose.

**The root is the emission's redundant guard, not the annotation.** The annotated cell type already carries the constraint (it alone produces the name-anchored TS2322); the `satisfies` on the initializer re-states it and produces the second. The prose half is the same doctrine as the closed reactive-hover row: the user's error should speak value types, which the cell's structural assignability message does not. When the emission publishes once, in value vocabulary, the pinned expectations below go red — the cue to retire them, not a regression.

**Status.** ⬜ **Open** (2026-07-23) — gated as the interim: the Diagnostics Lane's 31-reactive pins (`error-pins.json`) assert the measured double — code and position, the hover-pins discipline — so the lane is green while the behavior stands and flips loudly the day it changes. The twin-derivable rows beside them (`=!`, effect, the TS2588 write) stay derived and are not this row's subject. **The gate's scope is the count, not the prose:** the lane asserts codes and positions, and no instrument asserts message text — so an emission change that keeps both diagnostics but cleans the wrapper vocabulary flips nothing. The prose half rides the same fix in every likely shape (one publish, value-typed), but if it ever lands separately, this row does not close on the gate alone — the body's prose claim must be re-driven.

### 34. The bare `~>` operator hovers the runtime's machinery

Hovering the operator of a bare effect (`~> console.log(…)`, column 0) answers `const __effect: (fn: () => void | (() => void)) => () => void` — the reactive runtime's own symbol, served with full signature at a position whose ruled answer is silence (RULINGS.md, Reactive: punctuation is silent, permanently; a machinery name is never a stand-in). Driven 2026-07-23 against the real server. The named spelling is unaffected — `logger ~> …` hovers the binding.

**Why (code).** The bare form lowers to a statement-position `__effect(…)` call with no user binding, so the operator's source position maps into the injected callee and tsgo truthfully describes what sits there. The fix is server-side suppression: the compiler knows the span is an operator with no user symbol; the hover path can decline to answer there, the way the ruled interim demands.

**Why the suite missed it.** The hover audit probes `declsOf` declarations — a line opening with `~>` declares nothing, so no probe had ever landed on the operator until the corpus carried the bare form.

**Status.** ⬜ **Open** (2026-07-23) — gated softly: the Hover Audit's `silence` gauge ([runner.js](runner.js), the probe pass) hovers every column-0 bare-`~>` position and expects null, red by agreement (the audit exits 0) while the server serves the machinery answer. Green — the server declining to answer — retires this row.

### 13. Single-rooted tsconfig — no per-project resolution

Both the editor and `rip check` generate ONE tsconfig at the mirror root that `extends` only `<workspaceRoot>/tsconfig.json` ([mirror.js](../../packages/vscode/src/mirror.js) `generatedMirror`: `extends: '../../tsconfig.json'`, `rootDirs: ['.', '../..']`). Every `.rip` file is type-checked under the ROOT's `compilerOptions`; a nested package's own `tsconfig.json` — its `types`, `lib`, `jsx`, `strict`, `paths` — is ignored. `package.json#rip` (`strict`/`noCheck`) is already resolved per-file via `readProjectConfig` (nearest `package.json`, [config.js](../../src/config.js)), so the two config systems disagree: rip policy is per-package, tsconfig is flat. A second symptom: the editor roots the mirror at the VS Code folder while `rip check`'s `findWorkspaceRoot` walks to the nearest `package.json`/`tsconfig.json`/`.git` marker — so in a monorepo the same file can extend DIFFERENT tsconfigs in the two surfaces. A third artifact rides the same flat root: the host floor (`hostFloorDts`, [mirror.js](../../packages/vscode/src/mirror.js)) is generated once per mirror from the WORKSPACE root's `rip.strict` and installed types, so a nested project's own strictness or `@types/bun` cannot govern whether ITS files see the floor — the wrapper fix below must emit the floor per project, from each project's own gate answers.

**Status.** ⬜ **Open** (no fix). The fix approach is **verified feasible** — driven against real tsgo (see below).

**The fix — one mirror, one session, per-project wrapper tsconfigs.** tsgo's LSP does per-file NEAREST-`tsconfig.json` discovery (the tsserver "configured project" model), so the single mirror tree and single tsgo session stay. Instead of one generated tsconfig at the mirror root, place a generated WRAPPER at each mirrored project dir, each `extends`-ing its source `tsconfig.json` with the same overrides (`noImplicitAny`, `noEmit`, `allowImportingTsExtensions`, `types:["*"]` unless the chain sets `types`) and reach-ups (`extends`, `rootDirs`) computed by `path.relative` instead of the hardcoded `../..`. tsgo then partitions the faces per project internally. Wrappers set their own `include`/`exclude`, so a source tsconfig's file set is not inherited (only `compilerOptions` are).

**Driven** — the real tsgo LSP, two probes:
- Two sibling dirs, one with a `strict:true` `tsconfig.json`, one governed by a loose root: `let x: string = null` reported `TS2322` ONLY under the nearest strict config; the loose file stayed clean. tsgo routes per file.
- The production shape — a nested generated wrapper `extends`-ing a strict source tsconfig via `../../../../pkg/tsconfig.json`, under one mirror root, one session: `pkg/a.rip.ts` reported `TS2322` (strict) while `root.rip.ts` stayed loose. Nested wrappers + reach-ups work.

**Blast radius.** Shared: generalize `generatedMirror` + add a `nearestTsconfig(dir, anchor)` walk in `mirror.js`. `rip check` ([src/check.js](../../src/check.js)): after materialization, emit one wrapper per distinct owning tsconfig — small, self-contained. Editor ([server.js](../../packages/vscode/src/server.js)): larger — emit/refresh wrappers during closure materialization and on `tsconfig.json` (or extends-chain) changes via the existing watcher; no session multiplexing. The pin pass and single-session architecture are untouched.

**vs v3** — not established. v3 *is* re-runnable, so this could be settled either way; nobody has driven a monorepo through it. Framed as a missing capability, not a driven v3 regression.

### 32. Reassigning an exported plain binding double-declares

`export flag = 1` alone emits `export const flag = 1;` — coherent, and the reason the editor's semantic token for an exported plain binding reads `readonly`. Add a later reassignment (`flag = 2`) and the two lowerings collide: the reassignment makes the binding an evolving let, so the hoist pass emits `let flag;` at the top — **and the export pass still emits `export const flag = 1;`**. The output declares `flag` twice and does not build (driven 2026-07-23: `bun` refuses the module with "flag has already been declared"). So an exported plain binding today is const when never reassigned and broken when reassigned — there is no writable spelling, whatever the intent.

**Const is the stated design; the missing half is the loud rejection.** The emitter's export lowering asserts its position twice — *"An exported plain assign is `export const …` — a real declaration (never a hoisted write)"* ([emitter.js](../../src/emitter.js), the export walk and the hoist-boundary comment) — so the defect is the hoist pass violating that invariant on the reassignment path, not an unsettled semantics question. The fix consistent with the design: reject the reassignment with a real error (the for-range ban is the model — a message, never broken output). The token surface is ruled accordingly (RULINGS.md, Tokens): an exported plain binding expects `readonly`, and if writable exports ever become a deliberate feature — an emission change, the language owner's call — that expectation goes red at exactly the flip, which is the instrument speaking when semantics change.

**Status.** ⬜ **Open** (2026-07-23) — no gate: the spelling's output does not build, so no fixture can carry it. When the rejection lands, the never-reassigned spelling remains 29-modules' covered form and the reassignment becomes an asserted compile error.

### 28. A postfix cast on an inline try body detaches the catch arm

`x = try f() as T catch e then y` does not parse — the reported error is an unexpected INDENT at the catch arm's own body. Driven 2026-07-22 across cast shapes: `as number`, `as { a: number }`, `as number[]` all fail identically, so the trigger is the cast itself, not a brace type. The same spelling without the cast parses (`try f() catch e then y` is committed corpus), and the cast without the catch parses (`x = try f() as T`); it is exactly the combination that breaks. The workaround is one pair of parens on the cast operand: `try (f() as T) catch e then y` compiles.

**Why (code).** The inline handler form is `Try → TRY Expression Catch` and the cast is `Operation → Expression CAST` at `left CAST` precedence ([grammar.rip](../../src/grammar/grammar.rip)) — the lexer collapses `as Type` into one CAST token, and the parse resolves the cast against the try body's expression in a state from which the following CATCH can no longer shift into the handler production. Parenthesizing the operand closes the cast before the try-level attachment is decided, which is why it rescues the spelling.

**Why the suite missed it.** Nothing ever spelled a cast on an inline try body. The Grammar Gate counts productions, not interaction shapes — cast × inline-try is precisely the interaction class the corpus's adversarial tranche exists to mine — and this one surfaced by hand while authoring 26-exceptions, whose try-expression section sidesteps the combination today: the cast rides the handler-less form, and the handled form types itself through a declaration annotation instead.

**Status.** ⬜ **Open** (2026-07-22) — loud (a compile error, not a wrong answer) and narrow, which is why it sits at the bottom of the unblocked rows. No gate: the spelling cannot enter a fixture while it fails to compile. The fix's gate is the unparenthesized spelling entering 26-exceptions, where `compiles` and `verdict` hold it.

### 29. `new` on an optional chain emits an unconstructable spelling

`new Registry?.Box` compiles and emits the optional chain into `new` verbatim — `new Registry?.Box;` — which JavaScript rejects at parse time: *Cannot call constructor in an optional chain* (driven 2026-07-23, reproduced under bun; tsgo flags the face TS2351). Every spelling of the production is affected, so no fixture can carry it: the corpus parks `NewSpine → NewSpine ?. Property` ([MANIFEST.md](MANIFEST.md)'s Parked table), which is why 28-classes' gate queue holds one row it cannot clear.

**The root is the new-spine emission.** JS permits constructing through an optional chain only when the chain is sealed before `new` applies — `new (Registry?.Box)()` — so the fix is the emitter parenthesizing the spine when it carries `?.`. Found by the M3 wave-2 author, independently reproduced by its reviewer, and re-driven for this row. When it lands, the spelling joins 28-classes and `compiles`/`runtime`/`verdict` hold it.

**Status.** ⬜ **Open** (2026-07-23) — no gate while the emission is broken; the parked manifest row is the queue's memory of it.

### 30. `new` on a tagged template leaks the sexpr head

`new tag"hi"` emits `new tagged-template(tag, "hi");` — the emitter's new-spine walk has no tagged-template case, so the internal sexpr head `tagged-template` leaks into the output as bare identifiers, parsing as the subtraction `tagged - template(...)`: TS2304 (*Cannot find name*) from the checker and ReferenceError at runtime (driven 2026-07-23). Every spelling of the production is affected, so no fixture can carry it: the corpus parks `NewSpine → NewSpine TEMPLATE_TAG String` ([MANIFEST.md](MANIFEST.md)'s Parked table), the second of 28-classes' two held rows.

**The root is a missing case, not a wrong one** — the ordinary tagged-template expression lowers correctly; only the new-spine walk falls through to the generic path that prints the sexpr head raw. Found by the M3 wave-2 author, independently reproduced by its reviewer, and re-driven for this row. When the case lands, the spelling joins 28-classes and the ordinary dimensions hold it.

**Status.** ⬜ **Open** (2026-07-23) — no gate while the emission is broken; the parked manifest row is the queue's memory of it.

### 23. The Tier 3 pin probe cannot be retired by more declare-in-place

A binding that stays hoist-split and is **also** read from inside a closure is an evolving `let` TypeScript declines to infer (`TS7034` — an evolving `let` serves only same-function references), so no site in the real face knows its type. The Tier 3 pin probe recovers those types by manufacturing a declaration site and hovering it ([pins.js](../../packages/vscode/src/pins.js)), in the editor and in `rip check`'s batch alike, and feeds the answers back through `compile()` as pins — so the type lands in the **face**, where every consumer reads it.

**What keeps a binding hoisted is not what the name suggests.** `captureScan`'s safety rule has three clauses, and in real code the dominant one is the third: **any name touched inside a hoisted `def` keeps the hoist**, because a `def` is the one construct callable from above its own statement. That has nothing to do with where the write sits — `MIME = { … }` in [serving.rip](../../packages/server/serving.rip) is a top-level write, hoisted purely because `def mimeType` reads it. Driven 2026-07-17 over the 252 of 255 `.rip` files in this repo and in medlabs that compile (3 fail and are uncounted): **222 pinnable bindings** — 204 here, 18 in medlabs — and the population is dominated by top-level constants and helpers (`MIME`, `fail`, `COMMANDS`, `DEFAULT_TIMEOUT_MS`) that a hoisted `def` touches.

**So widening declare-in-place cannot retire the probe** — not because it only records top-level writes, but because the `def` hazard it declines is real: the write genuinely may not have run. What widening *would* reach is the block-confined shape ([11-inference](fixtures/11-inference.rip)'s `needle`, [09-components](fixtures/09-components.rip)'s `term`) — a binding first written inside an `if` and never read outside it, which could declare in place with no hazard at all. Driven: declared in place, tsgo infers `needle: string` natively and the `TS7034`/`TS7005` pair disappears. **That shape is 2 of 3 in the audit corpus and rounding error in real code** — which is why the corpus is the wrong instrument for this row, and why the 222 above was measured outside it.

**Status.** ⬜ **Open** (2026-07-17) — not a defect: the probe round is correct and the editor's answers are right, so there is nothing to fail today. **Gate: none while the probe stands** — but "none possible" would overstate it. If the in-face declaration below turns out to work, the probe becomes unnecessary and the gate is immediate: count the bindings still needing a pin, expect zero. So this row's exit is a **ruling** only if that question answers no; answer yes and it leaves through the same door as every other row.

**v3's alternative does not exist here, and is not a choice to weigh.** `patchUninitializedTypes` (rip-lang 3.17.5, `src/typecheck.js`) does not infer a type onto the hoist line: it takes the `ts` module and the live LanguageService, calls `checker.getSymbolAtLocation`, and injects types by mutating binder symbols on DocumentRegistry-shared SourceFiles (`sym.flags |= ts.SymbolFlags.Transient; sym.links = { type }`) — its own comment records the price, symbols released by hand or "every rebuilt program leaks (~50MB/compile → GBs over an editing session)". The tsgo broker is a separate process spoken to over LSP: no `ts` module, no `Program`, no symbol to mutate. **Across an out-of-process checker a query is the only route to a type at all** — so the probe is not a workaround deferring a fix, it is the architecture doing the only thing available, and its answer lands in the face rather than in one response. See the upstream rule under [How to read this ledger](#how-to-read-this-ledger).

**What is genuinely open** is narrower than a choice of mechanism: whether the face could carry a TS-only value declaration (`const __p = <first-write RHS>; let x: typeof __p;`) as a recorded region, typing the binding with no round trip. It needs the RHS to resolve in the declaring scope — true of the constants that dominate the 222, false where the RHS reads a block-local — and it needs the strip gate to admit a stripped value declaration, which a JS capture would break. **Undriven.** Settle that before ruling on the probe; the ruling is cheap and wrong if this turns out to be possible.

### 16. Library globals lose the `defaultLibrary` modifier

Symbols declared in `lib.*.d.ts` reach the editor with **no `defaultLibrary` modifier**, so VS Code falls back to `variable.other.readwrite` / `entity.name.function` instead of the `support.*` scopes themes reserve for the standard library. Token *types* are correct; only the modifier is missing. Driven on `console`, `Math`, `parseInt` and `isNaN`, and true of the whole class — the lookup that sets the bit never consults the symbol, and **not one token** in the fixture carries it. The only finding here whose cause is outside rip.

**Status.** ⬜ **Open** (2026-07-14). **Upstream, in tsgo**: rip cannot fix it in `ripSemanticTokens` because the bit never arrives to forward. Filed as [microsoft/typescript-go#4635](https://github.com/microsoft/typescript-go/issues/4635). Blocked — it sits last on the road because no amount of work here moves it, not because it matters least.

**Driven** — both editor servers over real LSP, same machine, same fixture lineage:

| server | library globals carrying `defaultLibrary` |
| --- | --- |
| v3 — in-process TS 6.0.3 LanguageService, on v3's `test/types/06-functions.rip` | **every one** |
| v4 — tsgo broker, on [06-functions.rip](fixtures/06-functions.rip) | **none** |

Also driven straight against the tsgo binary, bypassing rip: **not a single token** on the `.ts` twin, under both the native-preview extension and the released `typescript@7.0.2`. The engine, not rip's remapping.

**Why (code)** — tsgo's classifier (`internal/ls/semantictokens.go`, `collectSemanticTokensInRange`) passes a declaration's **raw** `FileName()` to `IsSourceFileDefaultLibrary`, a lookup in a map keyed by **canonical** paths. Canonicalization lowercases on a case-insensitive filesystem, so `/Users/…` never matches its key `/users/…` and the lookup always misses; every other caller in tsgo passes `sourceFile.Path()`. Causally confirmed: copy tsgo's lib dir to an all-lowercase path, change nothing else, and every library global gets its modifier back — same binary, same file, same client.

**Platform-conditional — the gating hazard.** On a case-SENSITIVE filesystem the canonicalization is the identity function and the bug does not occur, so a gate asserting `console` carries `defaultLibrary` **fails on macOS/Windows and passes on Linux**. Reporting differently by platform is worse than no gate, and the expected-failure device (#8) does not fit — an expected failure that passes on half the platforms is not one. Hence Gate **none**. **Never close this by asserting the modifier's ABSENCE:** that pins an upstream bug into the suite and certifies it correct. The honest gate becomes writable the day #4635 lands.

**vs v3** — **regression** (driven, above). v3 classifies in-process through the JS TypeScript LanguageService (`getEncodedSemanticClassifications`), which canonicalizes correctly, so the same code on the same machine gets the bit. It surfaced late because the modifier surface is only half-watched: `readonly` is gated, and nothing asserts `defaultLibrary` — or any modifier on a *library* symbol, since both that gate and the token audit probe rip's own declarations.

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
| 6 | `@ts-expect-error` dropped on multi-line emit | audit `directives`, `check` |
| 7 | No headless `rip check` | `check` |
| 9 | Write-only locals hover any | hover audit's not-any invariant |
| 10 | Reactive bindings hover cell wrapper | hover audit + `hover-pins.json` |
| 11 | Config changes required a reload | `config-reactivity` |
| 12 | `rip.noCheck` parsed but never applied | `config-reactivity` |
| 14 | Unused `@ts-expect-error` silently swallowed | `check` |
| 15 | Reactive `:=` bindings tagged `readonly` | `semantic-tokens`, token audit's `readonly` invariant |
| 17 | A directive swallows the unused-local fade | `editor-features` |
| 18 | A directive blinded its whole indented block | `check`'s head-line-only case |
| 19 | Inline render-block directive lost from the face | audit `directives` (09's inline bind directive); audit `verdict` |
| 20 | Render branch/loop bodies unchecked (`ctx`, loop items) | `check`'s typed-factory-params case; audit `strict` (09's ctx/loop classes) |
| 24 | A `schema` block's implicit `it` untyped | audit `strict` (10); `schema-types`' transform case |
| 25 | Event handler parameters get no event type | `check`'s handler case; `dom-vocab-lib` |
