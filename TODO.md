# TODO — Rip

Open work only. Delete a line when it lands or moves into docs/tests.

## Syntax removal candidates — owner decision pending

Seven surface forms with little or no use. Nothing here is decided: each
form stays until the owner rules on it, one form at a time. A form that
is kept leaves this list; a form that goes lands as its own change,
removing its grammar rules, lowering, pins, and its rows in all three
editor grammars (AGENTS.md, "Editor Grammars").

**How it was measured** (main `1d68bbe4`, 2026-11-24):

- *Uses* count real parses, not text matches: every file compiled, and
  each grammar rule's firings tallied from the node store. Corpora:
  `packages/` (350 files, 99,042 lines) and medlabs (118 files, 13,874
  lines). Test suites are excluded, since they pin the forms on purpose.
- *Grammar effect* is a copy of `src/grammar/grammar.rip` regenerated
  without the form (`bun src/grammar/solar.rip --info`), measured one
  form at a time against the baseline of 605 rules, 1,228 LALR states
  and 499 declared conflicts. Effects are not guaranteed to add up.

| Form | What it compiles to | Uses (packages / medlabs) | What people write instead | Grammar effect of removal |
|---|---|---|---|---|
| Loose `then` / `else` operators | `a then b` → `a && b`; `a else b` → `a \|\| b`; `a then b else c` → `(a && b) \|\| c` | 0 / 0 | `and` 2,372, `or` 1,551 (packages) | −9 rules, **−235 of 499 conflicts** |
| `yes` / `no` / `on` / `off` | `true` / `false` | 0 / 0 | `true` 2,410 / 154, `false` 1,461 / 109 | none (lexer aliases) |
| `new X` | `new X(…)` | 0 / 0 | `X.new …` 2,633 / 225 | −16 rules, −23 states, 0 conflicts |
| `enum` | a two-way map object (`{a: 0, 0: "a"}`) plus a TS enum companion | 0 / 0 | object literals, schema enums | −3 rules, −5 states, 0 conflicts |
| Pick `.{…}` / `?.{…}` | `obj.{id, name: label, role = 'x'}` → `{id: obj.id, label: obj.name, role: obj.role ?? 'x'}` | 0 / 0 | destructuring, then an object literal | −18 productions, −11 conflicts |
| `do <expr>` (not `do ->`) | `do f` → `(f)()` | 0 / 0 | a plain call; `do ->` itself has 29 / 1 uses | −1 rule, −2 states |
| `.=` method assignment | `x .= trim()` → `x = x.trim()` | 1 / 0 | `x = x.trim()` | −1 rule, −2 states |

**What each removal would buy, and what it would cost:**

1. **Loose `then`/`else`** — the largest single simplification
   available: nearly half of the grammar's declared conflicts (231 of
   its 436 reduce-reduce cells) exist to accommodate these nine rules,
   and the conflict manifest drops from 34 entries to 21. They also
   read deceptively: they bind looser than assignment, so
   `y = get() then print 'ok'` is `(y = get()) && print('ok')`, not an
   assignment of the result. `then` as the body introducer
   (`if c then x`) is a different use and is unaffected. Cost: the
   operator pins in `test/rip/control.rip`.
2. **`yes`/`no`/`on`/`off`** — frees four words as names. `on` and
   `off` are natural event-API names (`on 'click', handler`), and every
   binding of them is rejected because every read lowers to a literal
   (`on = …` is a parse error). Retires `test/rip/value-words.rip` (107 lines of rejection
   rows) and the alias entries in the three editor grammars. Cost: the
   CoffeeScript-flavored readability of `enabled: yes`.
3. **`new X`** — one construction spelling. The package style gate
   already bans it in favor of `X.new`. The reverse choice is also open:
   keep `new X` and drop `X.new`, which has a cost of its own — no
   method named `new` can be called through dot syntax (`obj.new 1`
   compiles to `new obj(1)`).
4. **`enum`** — retires the enum statement's lowering, its TypeScript
   enum companion and declaration rendering, and its test rows. Cost:
   TS-style numbered enums with reverse lookup, which nothing uses yet.
5. **Pick `.{…}`** — retires 18 productions, 11 conflicts, the
   `PICK_START`/`OPTPICK_START` token pair, and `test/rip/pick.rip`.
   Cost: a concise, defaulting projection that may simply not have been
   discovered yet; the optional form `obj?.{id}` has no short
   equivalent.
6. **`do <expr>`** — small: one rule. It is easy to misread as the
   common `do ->` form. Cost: invoking a non-literal function value
   through `do`.
7. **`.=`** — one rule, a token kind and a statement-only lowering; the
   one real use is `packages/script/script.rip:172`
   (`data .= replace /\r/g, '' if @nocr`). Cost: that line becomes
   `data = data.replace /\r/g, '' if @nocr`.

Recommendation, for the owner to accept or reject per form: loose
`then`/`else` is the clear win (235 conflicts for zero uses); `new X`
and `yes`/`no`/`on`/`off` each settle a duplicate spelling; `enum`,
pick, `do <expr>` and `.=` are small savings and can stay if the
language is better for having them.
