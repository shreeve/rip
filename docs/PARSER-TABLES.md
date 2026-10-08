# Parser Table Encoding — Evaluated Proposal

This document records a proposal to change how Solar writes the parser
tables into `src/parser.js`, with everything needed to decide on it
later: what the tables are, the proposed encodings, the measurements,
the verification, the defects found, the costs, and the landing plan.
It is a proposal, not a contract. Nothing here is implemented.

Status: **declined (2026-10-08).** An interesting idea, and verified
lossless, but passed on: the packed tables obscure much of the parser's
internals — `src/parser.js` stops being readable, and a grammar change
can no longer be reviewed by eye — while the brotli-compressed bundle,
the bytes a browser actually downloads, shrinks by only 7.4 KB (4.0%).
The minified-size saving (−30.7%) is real but buys only a few
milliseconds on a first visit, and none on a repeat visit once the
compiled-module cache and the engine's code cache are warm.

The evaluation below is kept so the question never reopens from scratch.
Four adversarial reviews and three independent verdicts (2026-10-07,
main `2fe8431b`, Bun 1.4.2) agreed it was adoptable only after fixes. If
first-load size ever matters, the pieces that carry no grammar
assumptions are the place to start (see
[Tiers](#tiers-what-is-a-clear-win)); the numbers need re-measuring
against the main of that day.

## Why it matters

`dist/@rip/rip.min.js` carries the whole compiler, because every Rip
App compiles in the page and the owner requires that browser-side
compile. The generated parser is the largest single module in it:

| Module | Minified | Brotli (marginal) |
|---|---:|---:|
| `src/parser.js` | 422,497 (39.5%) | 25,397 (13.7%) |
| `src/emitter.js` | 333,403 (31.2%) | 72,432 (39.1%) |
| remainder | 312,508 | 87,350 |
| **rip.min.js** | **1,068,408** | **185,179** |

The parser is the biggest thing the browser must *parse*, but compresses
well, so it is a small share of what the browser *downloads*. The
encoding therefore buys mostly startup time, not transfer.

## What `src/parser.js` holds

Solar (`src/grammar/solar.rip`) generates it from `src/grammar/grammar.rip`
via `bun run parser`. The grammar has 248 symbols, 558 rules and 1,110
LALR states.

| Field | Content | Read in the browser? |
|---|---|---|
| `parseTable` | per state, `{symbolId: action}`; positive = shift/goto target state, negative = reduce by rule, 0 = accept | yes, every token |
| `symbolIds` | `{name: id}` | yes, the lexer, every token |
| `tokenNames` | display names | yes, "expected …" diagnostics |
| `semantics` | per rule `{kind, roles[], nested?}` | yes, every reduce |
| `ruleTable`, `ruleActions` | reduce lengths and actions | yes |
| `accumulators` | list-building rules | yes |
| `primitiveRefs` | per rule, primitive positions | `face:'ts'` only (kept: in-browser typed editing is planned) |
| `repairTable` | error-recovery candidates | tolerant mode only (kept) |
| `ruleNames` | `"Root → Body"` strings | no runtime reader; tests and the audit runner only |

## The proposal

Five lossless encodings. Each decodes at module load to an object
strictly equal to the emitted one (key order, key types, no sharing).

1. **`parseTable` keyed by target state, with shared lookahead sets,
   packed into a string.**
   - Every LR state is entered by exactly one symbol (its *accessing
     symbol*), so a shift/goto stores only its target state; the key is
     `access[target]`.
   - A reduction is `(rule, lookaheadSetId)`; only 91 distinct lookahead
     sets cover all 1,110 states, so each set is stored once.
   - Numbers are base-45 digits printed as characters `#`…`~`, skipping
     `<` (no `</` in output) and backslash (no escapes): a digit 0–44
     ends a number, 45–89 continues it. No commas.
2. **`semantics` as interned tuples** (kind and role names stored once).
3. **`ruleNames` rebuilt** from a packed `[lhs, length, rhs…]` stream
   plus the symbol-name list.
4. **`repairTable` with its 24 distinct candidate lists stored once.**
5. **`primitiveRefs` as a dense list; `symbolIds` rebuilt** from the
   symbol-name list.

### Worked example: state 157

After a parameter name: shift on `TYPE` (to 387) or `OPT_MARKER` (to
388); reduce `TypedParamVar → ParamVar` (rule 350) on seven tokens.

```
emitted (67 chars):  9,6,11,1,13,5,1,15,61,22,-350,387,388,-350,-350,-350,-350,-350,-350
proposed (8 chars):  %Y?$$XG3  =  2 shifts · 387 · +1 → 388 · 1 reduce group · rule 350 · set #16
```

The keys `TYPE`/`OPT_MARKER` come from the targets' accessing symbols;
the seven reduce tokens are lookahead set #16, shared by four states.
Both decode to
`{6:-350, 17:387, 18:388, 31:-350, 36:-350, 37:-350, 52:-350, 113:-350, 135:-350}`.

The start state shows the packing at its most compressible: 107 shifts
to states 1…107 in order become `S4` (107) followed by 107 `$` (each a
delta of 1).

## Measurements

### Size, per encoding (each alone, against rip.min.js)

| Change | Minified saved | Brotli saved |
|---|---:|---:|
| 1. parseTable | 243,354 | 3,481 |
| 2. semantics tuples | 50,994 | 445 |
| 3. ruleNames rebuilt | 16,917 | 547 |
| 4. repairTable dedup | 9,995 | 1,112 |
| 5. primitiveRefs list + symbolIds rebuilt | 3,588 | 868 |
| **All five** | **327,827 (−30.7%)** → 740,581 | **7,440 (−4.0%)** → 177,739 |

parser.js on disk: 449,077 → 107,895 bytes.

### The parse table split by technique

Measured on the `parseTable` field alone (minified field, then brotli);
every variant decodes identical to the emitted table.

| Variant | Needs a grammar invariant? | Minified | Brotli |
|---|---|---:|---:|
| A. emitted: delta keys + values, JSON numbers | no | 280,863 | 9,493 |
| B. A + base-45 packing only | no | 137,035 | 9,215 |
| C. shared reduce sets, shifts as (Δkey, target), JSON | no | 158,735 | 7,375 |
| **D. C + base-45 packing** | **no** | **80,946** | **6,912** |
| E. D + accessing-symbol keys (the proposal) | yes | 37,383 | 6,090 |

D delivers 71% of the table's minified saving and 76% of its brotli
saving with no assumption about the grammar. The accessing-symbol step
(D→E) adds 43.6 KB minified / 0.8 KB brotli and is the source of the
"no accessing symbol" rejections below.

### Startup and runtime (real engines; medians, interleaved A/B, loaded machine)

| Engine | rip.min.js import, cold | First `compile()` | Compile/parse throughput |
|---|---|---|---|
| Chromium (30 runs) | 22.0 → 17.6 ms | unchanged | unchanged |
| WebKit (30) | 21.5 → 15.0 ms | unchanged | unchanged |
| Node (25) | 20.0 → 15.0 ms | unchanged | unchanged |
| Bun (25) | 15.9 → 10.4 ms | unchanged | unchanged |

An independent rerun: Node 13.3 → 10.5, Bun 16.1 → 10.2, Chromium
13.5 → 10.5 ms. Chromium JS heap 5.24 → 4.98 MB. Parse-table decode
5.2 → 1.6 ms (Bun). Everything decodes at load; nothing is lazy.
Firefox was not measured.

### Costs found

1. **V8 `symbolIds` lookups 3× slower** (microbenchmark 7.9 → 25.0 ms per
   869 KB of source; ~0.34 ms real, ~1% of parse). `Object.fromEntries`
   builds a fast-properties object where the literal was dictionary-mode.
   Fix: emit `symbolIds` as a literal (gives back ~3 KB minified).
2. **+0.3 ms per import on warm Chromium revisits** in the same renderer,
   where V8 skips parsing and the decode is pure overhead. Inherent.
   With V8 on-disk code cache (Node `cachedData`) it is a wash: 12.99 vs
   13.05 ms. WebKit is faster in every case.
3. **+7% parse-table row memory** (+154 KB Chromium): keys are inserted
   shifts-first, out of order. Net heap still falls. Fix: insert in
   ascending key order.

### What it means for users

Every cold load (first visit, deploy day, new process, evicted cache)
saves 3–6 ms on desktop; a low-end phone plausibly 10–20 ms (estimate:
a CPU-throttled Chromium run showed only 20.9 → 19.1 ms because V8
parses large scripts off the main thread). Transfer saves 7.4 KB:
~150 ms on slow 3G, negligible on broadband. Against an App whose own
compile is 100–400 ms, this is 1–5% of startup. The per-file compiled
module cache (below) is the larger lever by roughly 20–50×.

## Verification performed

- Strict equality of every field against `src/parser.js`: own-key order,
  property descriptors, holes, number vs string keys, `-0`, prototypes,
  object aliasing (none on either side). Function text differs only in
  minted temporaries (below).
- 19,840 differential parses: all 496 tracked `.rip` files plus random
  deletions and truncations, tolerant on/off, primitives on/off; 2,770
  throws and 4,798 "expected" lists, 0 mismatches, expected-token order
  unchanged.
- Identical compile output (code, source maps, errors) for all 496 files
  in 4 modes, from the compiler and from the minified bundle (992
  compiles, one hash).
- Self-hosting fixpoint: the patched Solar regenerates itself
  byte-identically; the original Solar still reproduces `src/parser.js`.
- `bun run test` matches baseline; `bun run corpus` writes nothing;
  Solar oracle and generated-byte tests pass; Playwright smoke passes on
  Chromium and WebKit.
- `_pack`/`unpack` round-trip fuzzed over 200k values including 0, 44,
  45, 2024, 2025, 45³, 2⁵³−1.
- No consumer reads `parser.js` text except the byte gates
  (`test/toolchain/generated.test.js`, `grammar-toolchain.test.js`,
  certify's `git diff --exit-code`). Runtime readers (grammar-coverage,
  audit runner, cast-stops, semantic-surface, lexer, vscode, print,
  sites) pass against the proposed module. Nothing mutates the tables.

## Defects in the patch as written

None affects Rip's grammar or produces a silent miscompile.

| # | Severity | Defect | Fix |
|---|---|---|---|
| 1 | blocker (rule 6) | No permanent test pins losslessness; all evidence lives in scratch scripts | test: decode the emitted module, deep-equal every field against the Generator's in-memory tables |
| 2 | should-fix | Valid grammars rejected: a state precedence or `nonassoc` leaves unentered (e.g. a dangling `else` resolved by precedence) throws "state N has no accessing symbol" | emit a placeholder access symbol for unentered states; keep the two-symbol check |
| 3 | should-fix | Valid grammars rejected: integer-like symbol names (`7`) throw, because `for own` enumerates integer keys first | build names by id (`names[id] = name`), reject holes and duplicates |
| 4 | should-fix (rule 1) | An unknown action code yields `undefined` and the cell is silently dropped (unreachable today) | `else throw` in the action switch |
| 5 | minor (rule 1) | `_pack` accepts integers above 2⁵³ and corrupts them | `Number.isSafeInteger` |
| 6 | minor | Semantics shape check tests key names, not value types | `Array.isArray` on `roles`/`nested` |
| 7 | should-fix (rule 7) | Parse-driver temporaries renumber (`_ref5`→`_ref9`, `_ref6`→`_ref10`): the new methods sit before `parse` and draw from the shared counter | place the new helpers after `parse` (tested: zero driver drift) |
| 8 | minor (Style) | `_ruleNames` is dead and its comment is wrong; `bin/rip:17` says parser.js is ~450 KB | delete; update the comment |
| 9 | minor | New module-level names `unpack`, `symbolNames` could capture a grammar action's free identifier (none today) | minted or prefixed names |
| 10 | perf | Costs 1 and 3 above | literal `symbolIds`; sorted insertion |

## Process costs

- **Reviewability (rule 7).** The JSON `ruleNames` and `semantics` are
  the readable parts of `parser.js`; packed, a grammar change can no
  longer be checked by eye, and a two-cell precedence swap scatters into
  13 runs of the packed string (the shared sets renumber). Per-state
  line breaks do not help: adding a rule renumbers states. Mitigation:
  `solar --dump` (each state keyed by kernel items, actions by symbol
  and rule name) and/or `scripts/parser-diff.mjs` decoding two revisions,
  optionally a git `textconv`.
- **Merges** conflict exactly as they do today (the fix is always
  regenerate). **Repo growth** improves: packed deltas 6.4 KB vs 15.2 KB
  per added rule. **Blame** unchanged. **Diff size** ~5× smaller.
- **Decoder code** is minified JS inside Rip strings, unlinted, and must
  stay in step with the shape checks; only the pin from defect 1 guards
  that.
- **CI.** The required PR jobs run `test:rip` and the browser smoke, not
  the parser byte gate or the dist freshness gate; both run under
  `bun run test` / certification. `dist/@rip` must be regenerated in the
  same commit.

## Tiers: what is a clear win

**Tier 1 — no grammar assumption, simple, recommended:**
- Parse table variant **D** (shared reduce sets + base-45 packing):
  −200 KB minified, −2.6 KB brotli on the field.
- `repairTable` dedup: −10 KB minified, −1.1 KB brotli.
- `primitiveRefs` as a dense list.
- Unquoted numeric object keys in every emitted table (Bun's minifier
  leaves 1,947 `"12":` keys quoted, ~3.9 KB minified bundle-wide).
- Keep `symbolIds` a literal (avoids cost 1 and defect 3).

**Tier 2 — larger or riskier, evaluate separately:**
- Accessing-symbol keys (D→E): −43.6 KB minified, −0.8 KB brotli; needs
  defects 2 and 7 fixed and the invariant pinned.
- `semantics` interning: −51 KB minified, −0.4 KB brotli; opaque, shape
  checks to maintain.
- `ruleNames` rebuilt: −17 KB minified, −0.5 KB brotli; no runtime
  reader in the browser, so a lazy getter is an alternative.

Tier 1 still needs defect 1 (the losslessness pin), defect 7 (helper
placement), sorted row insertion (cost 3: variant D also inserts shifts
before reductions), the dump/diff tool, and the rule-7 enumeration. It
avoids defects 2 and 3 and cost 1 by construction.

## Landing checklist (whichever tier)

1. Separate commit: `bun run browser` to refresh `dist/@rip`, which is
   stale at `2fe8431b` (52dad3d5 changed `src/runtime/schema.js`).
2. Solar changes with the fixes for every applicable defect.
3. Tests in the same commit: the decode-equals-Generator pin;
   `_pack`/`unpack` boundaries and negative inputs; one negative test per
   new throw; small grammars with unentered states and integer-like
   names.
4. `bun run parser`; `bun run corpus` (expect no diff); `bun run browser`.
5. The dump/diff tool in the same PR.
6. `bun run test`, `bun run test:spawn`, `bun run test:browser`, then the
   manual certification workflow.
7. PR description: the `parser.js` diff enumerated region by region (the
   tables, and confirmation of zero driver drift), before/after numbers
   with the commands that reproduce them.
8. A cold review of the final diff and an independent rerun of the pin
   and bench (rule 10); true merge.

## Reproducing the measurements

- Bundle size: copy `scripts/browser-bundle.mjs` outside the tree with
  `root` pointing at a copy of `src/` + `packages/app/` holding the
  candidate `parser.js`; brotli q11 the minified output.
- Losslessness: import both parsers, compare every field by own-key
  order and descriptors, and diff `parse()` trees (with diagnostics) for
  every tracked `.rip` file, mutated inputs, tolerant and primitives
  modes.
- Compile equivalence: hash `compile()` output (code, map, error text)
  for every tracked `.rip` file under `{}`,
  `{browserModule, runtimeDelivery:'import', hmr}`, `{tolerant}`,
  `{face:'ts'}`, normalizing absolute runtime paths.
- Engines: Playwright Chromium/WebKit loading each bundle in a fresh
  context per run, interleaved, timing import and first `compile()`;
  V8 code-cache behavior via Node `vm.Script` `cachedData`.

## Related decisions

- **Precompiled publication** (Manager ships JavaScript, page never
  compiles; runtime-only bundle 157,307 minified / 43,621 brotli) is
  rejected: the owner requires browser-side compilation.
- **Per-file compiled module cache** (IndexedDB keyed by module path,
  validated by exact source + compiler build + `hmr`, overwritten on
  change, swept of deleted paths at boot, dropped after ~30 days unused)
  removes repeat-visit compile — roughly 100–200 ms for a MedLabs-sized
  App. It is independent of this proposal, larger in benefit, and
  belongs in its own design.
- **swc minifier** (2 passes over Bun's unminified output): a further
  −19.6 KB minified / −7.8 KB brotli on top of this proposal (721,002 /
  169,940 combined), identical compile output on 992 compiles; adds a
  pinned native dev dependency; needs `test:browser` against an swc build.
- **Emitter `#private` members**: −23 KB minified / −1.5 KB brotli;
  touches ~375 names; not timed in a browser.

## Appendix: the patch as evaluated

Against `src/grammar/solar.rip` at `2fe8431b`. It contains defects 2–10
above and is recorded for reference, not for application as-is.

```diff
@@ -1630,6 +1630,23 @@
     """
     // ES6 Parser generated by Solar #{VERSION}
 
+    // Symbol names in id order; symbolIds and ruleNames derive from it.
+    const symbolNames = #{JSON.stringify @_symbolNames()}
+
+    // Inverse of Solar's _pack: base-45 digits, most significant first,
+    // a continuation digit offset by 45, each printed as charCode 35+d
+    // skipping '<' and backslash.
+    const unpack = (s) => {
+      let d = [], x = 0, i = 0, c;
+      while (i < s.length) {
+        c = s.charCodeAt(i++);
+        c -= 35 + (c > 60) + (c > 92);
+        if (c > 44) x = x * 45 + c - 45;
+        else d.push(x * 45 + c), x = 0;
+      }
+      return d;
+    }
+
     const parserInstance = #{parserInstance}
 
     const createParser = (init = {}) => {
@@ -1664,31 +1681,146 @@
     names[r.id] = "#{r.lhs} → #{if r.symbols[0] is '' then 'ε' else r.symbols.join ' '}" for r in @rules
     names
 
+  # Symbol names indexed by id. The module rebuilds symbolIds from this
+  # list, which is exact only while ids run 0..n-1 in insertion order.
+  _symbolNames: ->
+    names = []
+    for own name, id of @symbolIds
+      throw Error.new "symbol table: '#{name}' has id #{id}, expected #{names.length}" unless id is names.length
+      names.push name
+    names
+
+  # Non-negative integers → printable text: base-45 digits, most
+  # significant first, a continuation digit offset by 45, digit d
+  # printed as charCode 35+d skipping '<' (no '</' in output) and
+  # backslash (no escapes). The module's `unpack` inverts it.
+  _pack: (nums) ->
+    out = []
+    for n in nums
+      throw Error.new "pack: #{n} is not a non-negative integer" unless Number.isInteger(n) and n >= 0
+      digits = []
+      loop
+        digits.unshift n % 45
+        n = Math.floor n / 45
+        break unless n > 0
+      for d, i in digits
+        c = 35 + d + (if i < digits.length - 1 then 45 else 0)
+        c++ if c >= 60
+        c++ if c >= 92
+        out.push String.fromCharCode(c)
+    out.join ''
+
+  # semantics as tuples [ruleId, kind, roles, nested?], kinds and role
+  # names interned. A role is [name, grammarRef, childSlot, spread 0/1],
+  # or [name, null, childSlot, literal] when grammarRef is null. Any
+  # other shape rejects: a field the decoder does not rebuild would
+  # vanish from the module.
+  _semanticsCode: ->
+    kinds = []
+    names = []
+    intern = (list, text) ->
+      at = list.indexOf text
+      if at < 0
+        at = list.length
+        list.push text
+      at
+    roleTuples = (roles) ->
+      out = []
+      for role in roles
+        roleShape = Object.keys(role).join ','
+        if roleShape is 'name,grammarRef,childSlot,spread' and role.grammarRef isnt null and typeof role.spread is 'boolean'
+          out.push [intern(names, role.name), role.grammarRef, role.childSlot, (if role.spread then 1 else 0)]
+        else if roleShape is 'name,grammarRef,childSlot,literal' and role.grammarRef is null
+          out.push [intern(names, role.name), null, role.childSlot, role.literal]
+        else
+          throw Error.new "semantics: role shape {#{roleShape}} has no encoding"
+      out
+    nestedTuples = (list) ->
+      out = []
+      for entry in list
+        nestShape = Object.keys(entry).join ','
+        throw Error.new "semantics: nested shape {#{nestShape}} has no encoding" unless nestShape is 'role,path,kind,roles,nested'
+        out.push [intern(names, entry.role), entry.path, intern(kinds, entry.kind), roleTuples(entry.roles), nestedTuples(entry.nested)]
+      out
+    entries = []
+    for own id, sem of JSON.parse JSON.stringify @semantics
+      semShape = Object.keys(sem).join ','
+      tuple = [+id, intern(kinds, sem.kind), roleTuples(sem.roles)]
+      if semShape is 'kind,roles,nested'
+        tuple.push nestedTuples(sem.nested)
+      else unless semShape is 'kind,roles'
+        throw Error.new "semantics: rule #{id} shape {#{semShape}} has no encoding"
+      entries.push tuple
+    "((K,R,E)=>{let r=x=>x.map(([n,g,c,v])=>g===null?{name:R[n],grammarRef:g,childSlot:c,literal:v}:{name:R[n],grammarRef:g,childSlot:c,spread:!!v}),m=x=>x.map(([o,p,k,l,n])=>({role:R[o],path:p,kind:K[k],roles:r(l),nested:m(n)})),o={};for(let[i,k,l,n]of E)o[i]=n?{kind:K[k],roles:r(l),nested:m(n)}:{kind:K[k],roles:r(l)};return o})(#{JSON.stringify kinds},#{JSON.stringify names},#{JSON.stringify entries})"
+
+  # primitiveRefs keyed 1..n densely: emitted as a list.
+  _primitiveRefsCode: ->
+    list = []
+    for own id, refs of @primitiveRefs
+      throw Error.new "primitiveRefs: rule #{id} breaks the dense 1..n run" unless +id is list.length + 1
+      list.push refs
+    "((a,o={})=>(a.forEach((v,i)=>o[i+1]=v),o))(#{JSON.stringify list})"
+
+  # repairTable: distinct candidate lists interned; states as
+  # (Δstate, listId) pairs. Each state gets its own array copy.
+  _repairTableCode: ->
+    listIds = Map.new()
+    lists = []
+    seq = []
+    prev = -1
+    for own state, ids of @repairTable
+      key = ids.join ','
+      unless listIds.has key
+        listIds.set key, lists.length
+        lists.push ids
+      seq.push(+state - prev, listIds.get(key))
+      prev = +state
+    "((R,d,o={})=>{for(let i=0,k=-1;i<d.length;i+=2)o[k+=d[i]]=R[d[i+1]].slice();return o})(#{JSON.stringify lists},[#{seq.join ','}])"
+
+  # ruleNames as a packed stream of [lhsId, length, rhsIds...] per rule
+  # id; length 0 is the empty production (ε).
+  _ruleNamesCode: ->
+    byId = []
+    byId[r.id] = r for r in @rules
+    data = []
+    for r, id in byId
+      throw Error.new "rule ids: no rule #{id}" unless r?
+      throw Error.new "rule #{id}: empty symbol list" if r.symbols.length is 0
+      rhs = if r.symbols[0] is '' then [] else r.symbols
+      data.push @symbolIds[r.lhs], rhs.length
+      for sym in rhs
+        throw Error.new "rule #{id}: symbol '#{sym}' has no id" unless @symbolIds[sym]?
+        data.push @symbolIds[sym]
+    "(()=>{let d=unpack(\"#{@_pack data}\"),r=[],p=0,l,n;while(p<d.length){l=symbolNames[d[p++]]+\" → \";n=d[p++];r.push(l+(n?d.slice(p,p+=n).map(i=>symbolNames[i]).join(\" \"):\"ε\"))}return r})()"
+
   _generateModuleCore: ->
     tableCode = @_generateTableCode @parseTable
 
     """{
-      symbolIds: #{JSON.stringify @symbolIds},
+      symbolIds: Object.fromEntries(symbolNames.map((n, i) => [n, i])),
       tokenNames: #{JSON.stringify(@tokenNames).replace /"([0-9]+)":/g, "$1:"},
-      semantics: #{JSON.stringify @semantics},
-      primitiveRefs: #{JSON.stringify @primitiveRefs},
+      semantics: #{@_semanticsCode()},
+      primitiveRefs: #{@_primitiveRefsCode()},
       accumulators: #{JSON.stringify @accumulators},
       parseTable: #{tableCode},
-      repairTable: #{JSON.stringify @repairTable},
+      repairTable: #{@_repairTableCode()},
       ruleTable: #{JSON.stringify @ruleTable},
-      ruleNames: #{JSON.stringify @_ruleNames()},
+      ruleNames: #{@_ruleNamesCode()},
       ruleActions: #{@ruleActions},
       #{String(@parse).replace(/^function /, '')},
       ctx: {},
     }"""
 
   _generateTableCode: (stateTable) ->
-    # Interleaved delta-encoded format for optimal Brotli compression (~30% smaller)
-    # Format per row: [count, Δkey₁, Δkey₂..., val₁, val₂...]
-    # Actions: positive=SHIFT/GOTO, negative=REDUCE, zero=ACCEPT
-    data = []
-
-    for state in stateTable
+    # A row is its shift/goto targets plus its reductions. Every target
+    # state has exactly one accessing symbol, so a target alone names its
+    # key (access[target]); ACCEPT rides as target 0, which no transition
+    # enters. A reduction's lookahead set is interned once and shared.
+    # Stream: [nStates, access..., nSets, (len, Δsym...)..., then per
+    # state: nTargets, Δtarget..., nReduces, (rule, setId)...]. Integer
+    # keys enumerate in ascending order, so each decoded row equals the
+    # sorted original.
+    rows = for state in stateTable
       entries = []
       for own sym, act of state when act?
         val = if Array.isArray act
@@ -1698,18 +1830,45 @@
             when 3 then 0         # ACCEPT
         else act  # GOTO
         entries.push [+sym, val]
-      entries.sort (a, b) -> a[0] - b[0]
-
-      data.push entries.length
-      k = 0
-      for [key] in entries
-        data.push key - k
-        k = key
-      for [, val] in entries
-        data.push val
-
-    # Decoder reconstructs [{key: val}, ...] at runtime
-    "(()=>{let d=[#{data.join ','}],t=[],p=0,n,o,k,a;while(p<d.length){n=d[p++];o={};k=0;a=[];while(n--)k+=d[p++],a.push(k);for(k of a)o[k]=d[p++];t.push(o)}return t})()"
+      entries
+    access = []
+    for entries in rows
+      for [sym, val] in entries when val >= 0
+        throw Error.new "parse table: state #{val} has two accessing symbols" if access[val]? and access[val] isnt sym
+        access[val] = sym
+    for k in [0...rows.length]
+      throw Error.new "parse table: state #{k} has no accessing symbol" unless access[k]?
+    setIds = Map.new()
+    sets = []
+    body = []
+    for entries in rows
+      targets = (val for [, val] in entries when val >= 0).sort (a, b) -> a - b
+      body.push targets.length
+      prev = 0
+      for t in targets
+        body.push t - prev
+        prev = t
+      groups = Map.new()
+      for [sym, val] in entries when val < 0
+        groups.set val, [] unless groups.has val
+        groups.get(val).push sym
+      body.push groups.size
+      for [val, syms] as groups
+        syms.sort (a, b) -> a - b
+        key = syms.join ','
+        unless setIds.has key
+          setIds.set key, sets.length
+          sets.push syms
+        body.push(-val, setIds.get(key))
+    data = [rows.length, ...access, sets.length]
+    for syms in sets
+      data.push syms.length
+      prev = 0
+      for sym in syms
+        data.push sym - prev
+        prev = sym
+    data.push ...body
+    "(()=>{let d=unpack(\"#{@_pack data}\"),t=[],p=0,A,S=[],n,o,k,j,a,g;A=d.slice(1,p=d[0]+1);for(n=d[p++];n--;S.push(a))for(a=[],k=0,j=d[p++];j--;)a.push(k+=d[p++]);while(p<d.length){o={};for(n=d[p++],k=0;n--;)o[A[k+=d[p++]]]=k;for(n=d[p++];n--;){g=-d[p++];for(k of S[d[p++]])o[k]=g}t.push(o)}return t})()"
```
