# PROBLEMS — Rip

Inconsistencies and broken parts of the syntax, language and packages,
found while preparing [docs/REFERENCE-PLAN.md](docs/REFERENCE-PLAN.md).
Open work only: delete an entry when its fix lands with a pin, as the
rules ask (AGENTS.md rule 6). Every entry was reproduced on main
(2026-10-09, after `97a1db09`) by a probe that ran the compiler or the
package; entries marked **✔** were re-run independently. Repros are
inline — run a `.rip` snippet with `bin/rip f.rip`, or compile it with
`bin/rip -c f.rip` to see the JavaScript.

Severity: **H** high (silent miscompile, security, data loss, a failing
documented example), **M** medium (legal-looking code rejected, invalid
JavaScript emitted, silent acceptance of bad input), **L** low (messages,
naming, cosmetics).

Contents: [Language core](#language-core) ·
[Templates, components, reactivity](#templates-components-reactivity) ·
[Schema and ORM](#schema-and-orm) · [Rip Sites](#rip-sites) ·
[Rip App](#rip-app) · [Standard packages](#standard-packages) ·
[Tooling](#tooling) · [Documentation](#documentation) ·
[Package mold](#package-mold) · [Duplicate spellings](#duplicate-spellings) ·
[Unconfirmed and design questions](#unconfirmed-and-design-questions)

---

## Language core

### Silent miscompiles

**C31 L — A chained statement postfix if-else rejects with an unrelated message.**
`return x if a else y if b else z` fails "'return' is not supported in
expression position"; `r = x if a else y if b else z` chains to
`a ? x : (b ? y : z)`. The returned-ternary production reduces at the
first `else` operand.

**C32 L — `delete a?.b` rejects as "deleting a plain binding".** JavaScript
allows an optional-chain delete; the message names the wrong reason.

**C7 M — Class-body `x: 1`, `x: 0`, `x: ""`, `x: []`, `x: {}`, `x: true`, `x: null` silently drop the value.**
```coffee
class A
  @s: 1
  x: 1
p A.s, (new A).x    # undefined undefined
```
The value is read as a TypeScript literal type (`static s;`, `x;`).
`x: -1`, `x: f()` reject with "a class field takes '=' for its value".

**C8 ✔ M — The implicit `it` parameter captures a source binding named `it`.**
```coffee
fs = []
for it in [1, 2]
  fs.push -> it
p (f() for f in fs)  # [undefined, undefined]
```
Also `it = 3; f = -> it` returns `undefined`. Rule 2: a minted parameter
never captures a source binding.

**C9 M — In a nested function, `=` to a `def`, `class` or `enum` name declares a local instead of writing the outer binding.**
`def f` → `g = -> f = -> 2; g(); p f()` prints 1 (the inner function
emits `let f;`). A plain outer name is written, as HANDOFF.md states. The
`export` variant is pinned in test/rip/modules.rip as a recorded limit,
which pins the bug rather than the correct behavior (rule 6).

**C10 M — Writes to unwritable bindings slip past the checks as destructuring or `.=`.**
`x =! 1` then `[x] = [2]`, `{x} = o` or `x .= trim()` compile to writes
to a `const` (caught only by Bun's bundler; a browser fails at runtime).
`x ~= a + 1` then `[x] = [50]` fails at runtime. Plain, compound and `?=`
writes reject, positioned.

**C11 M — An `@`-parameter assignment is placed before a later `super()`.**
`constructor: (@a) -> v = a * 2; super(v)` in a subclass emits
`this.a = a` first: runtime ReferenceError. Also with
`if c then super(1) else super(2)`.

### Legal-looking code emits invalid JavaScript

**C12 M — A function-tail `switch` with a collecting loop in two `when` arms declares `const _result` twice.** Bun rejects the output.

**C13 M — `break`/`continue` inside a function inside a loop is not rejected.**
`for a in xs` → `[3].forEach (x) -> continue if x` emits `continue;` in
the callback. A top-level `f = -> continue` rejects correctly.

**C14 M — A rest element in the middle of parameters or an object pattern emits invalid JavaScript.**
`f = (a, ...b, c) -> c` and `{a, ...b, c} = o`. Array-pattern middle rest
is lowered correctly.

**C15 M — An await (or yield) in a constructor emits `async constructor()` (or `*constructor()`).** Getters and setters reject the same case, positioned.

**C16 ✔ M — Duplicate constructors compile; the JavaScript fails at load.**
A class with two `constructor: ->` members compiles with exit 0 and
`rip check` reports nothing; Bun then throws "Cannot declare multiple
constructors".

### Legal-looking code rejected, or inconsistent

**C17 ✔ M — Inline `try` with a paren-less call before `catch`/`finally` fails to parse.**
`y = try f 1 catch then 2`, `x = try JSON.parse s catch then null`,
`try f! x catch then y`, `try f x finally g()` → "Unexpected 'catch'".
`try f(1) catch then 2` works, and `if a then f b else c` closes the call
at `else`. AGENTS.md Style prescribes both `try expr catch then fallback`
and the juxtaposed call. Not pinned in test/rip.

**C18 M — `not` and `!` bind differently with `**`.** `not 2 ** 2` is
`(!2) ** 2` → 0 (pinned in operators.rip); `!2 ** 2` is `!(2 ** 2)` →
false. They read as one operator with two spellings.

**C19 M — A `break` in a statement-`switch` `when` inside a loop is a silent no-op.**
`for a in [5,1,7]` → `switch a` / `when 1 then break` emits
`case 1: break; break;`; the loop continues. In a match arm the same
`break` rejects ("nothing to leave").

**C20 M — A tight `%w` after an operand lexes as a word array.**
`x = i%w(3)` and `x = n%w.length` reject with "Unexpected '['" or
"unclosed %w."; `x = i %w(3)` silently becomes `i(["3"])`.

**C21 L — `for x in src() by step()` evaluates `step()` before `src()`.** Range loops keep source order (pinned).

**C22 L — String repetition ignores interpolated strings.** `"ab" * 3`
is `"ababab"`; `"#{a}-" * 3` compiles to a template literal times 3 → NaN.

**C23 L — `not s =~ /e/` matches against the string `"false"`.** `not`
binds tighter than `=~`, and `toMatchable` stringifies the boolean.

**C24 L — `s !~ /a/` silently compiles to `s(!(~/a/))`.** Users of `=~`
reach for `!~`; it becomes a juxtaposed call instead of a rejection.

**C25 L — Assorted rejections of legal-looking forms.**
`a ? b ? c : d : e` (nested ternary); `unless a … else if c`;
`[a, ..., b] = c` (parameters accept the `...` marker); `a?[1..2]`
(`a?[0]` works); `x = a ?.5 : 1`.

**C26 L — A postfix comprehension on a module's last line builds a throwaway array.** `f a for a in b` as the final line emits a collecting IIFE; followed by another line it emits a plain loop and a stray `};`.

**C27 L — An `in` container that is an unresolved global is read up to three times.** `a in someGlobal` emits `b` three times with no capture; doctrine says an unresolved identifier is not repeat-safe.

**C28 L — `window?` on an undeclared global throws ReferenceError.** It compiles to `window != null` (documented), unlike CoffeeScript's `typeof` guard.

### Error messages

**C29 L — The unexpected token appears in its own "expected" list.**
`x = 1 if b then c` → "Unexpected 'if' — expected …, if, …";
`x = f!!`, `x = a[0]!`, `obj.m! = ->` → "Unexpected '!' — expected …, !, …".

**C30 L — Messages name things the user did not write.**
`x = {:a}` → "@-keys are only supported in class bodies";
`f! ?= -> 5` → "Unexpected '??='"; `delete a?.b` → "deleting a plain
binding"; `on := true` → bare "Unexpected ':='" (`on` is reserved, `true`).

---

## Templates, components, reactivity

**T20 M — A hyphenated bare event shorthand compiles to subtraction.**
`p @x-y` in a render block emits
`addEventListener('x', (e) => (this.onX - y)(e))`: the shorthand takes
`x` as the event and subtracts `y` from the handler. Custom event names
are commonly hyphenated (`@sl-change`); reject the form or read the
whole run as the event name.

**T4 H — Component methods are never bound, including `=>` members.**
`format = (n) => "#{prefix}#{n}"` then `names.map(format)` emits an
unbound prototype method → "Cannot read properties of undefined".
Passing `onPress: save` to a child loses `this` the same way. Plain
classes bind `=>` members (`this.fmt = this.fmt.bind(this)`).

**T5 M — `<=>` into a loop variable's field never notifies the collection.**
`for todo in todos` → `input value <=> todo.title` writes the data but
emits no `touch`, so dependents (`count ~= todos.filter …`) and sibling
text never update. `<=> user.name` does call `touch` (docs/TYPES.md
says a bind into a chain calls it). Cause: `bindRootTouch`
(src/emitter.js ~14797) returns null for loop variables.

**T6 M — Hyphenated or quoted event names miscompile.**
`div @value-changed: go` listens for `value` and calls
`(this.onValue - {changed: this.go})`; `@'value-changed': go` listens for
an event literally named `"value-changed"` (quotes included);
`sl-input @sl-change: go` rejects with an unrelated message. No spelling
listens for `value-changed`.

**T7 H — An effect's last expression is silently registered as its cleanup.**
```coffee
open := true
~>
  if open
    win.onkeydown = (e) -> console.log e.key
open = false        # throws: the handler runs as cleanup with no event
```
Designed and pinned (src/emitter.js ~9235; test/ui/components.test.js
~457), but invisible: packages/ui works around it with defensive
trailing `return` lines. The one-line form differs by location — inside
a component it returns, at module level it does not.

**T8 M — A state write from inside an effect is dropped or kept depending on batching.**
An effect `count = 10 if count > 10` keeps 50 when `set50()` is called
directly, and 10 when the same method runs from a click (inside
`__batch`). Computed self-writes reject loudly; state self-writes are
dropped silently. There is no public batch API (packages use `__batch`).

**T9 M — A tight `#word` after an identifier in render emits invalid JavaScript.** `span name#note` and `title: name#t` emit `name#note` verbatim. The lexer merges `#…` into any preceding identifier in render (src/lexer.js ~1366).

**T10 M — An `#id` that starts with a digit or a non-ASCII letter swallows the rest of the line.** `b#1 "hello"` and `p#é "v"` render with no id and no text; `span#café` rejects. Regexes at src/lexer.js ~1204/1367 are a private identifier class, against "One identifier vocabulary".

**T11 M — Void elements accept children.** `input disabled` (with `disabled := false` in scope) renders `<input>` with a text child `"false"` and no attribute; `input "text"`, `br x`, `img` + child all compile.

**T12 M — `Component.suffix` compiles to a call rendered as text.** `Child.big` renders `undefined`; `Child.one label: "x"` throws "Child.one is not a function". `UI.Child` namespace paths work.

**T13 L — `null` renders differently by text form.** A reactive bare `r` renders `""` (then `"undefined"` after `r = undefined`); `= r` renders `"null"`; a non-reactive `s =! null` renders `"null"`.

**T14 L — `ref:` inside a `for` holds the last row and clears while rows remain.** Expected a rejection inside a loop body.

**T15 L — `ref: @el` rejects with a wrong hint** ("declare `el := null`" when it is declared); `<=>` accepts `@x`.

**T16 ✔ L — The `h1 @heading` hint is misleading.** "`@heading` is not a
DOM event — use `= @heading` to render text…"; written literally as
`h1 = @heading` it errors again ("render local 'h1' is never read"). The
working forms are `h1 heading` or `h1` + indented `= @heading`, and no
message names them. `h1 (@heading)` and `h1 this.heading` get "bare"
errors for spellings the user did not write.

**T17 L — Destructuring writes bypass the "silently freezes the render" guard.** `[count] = [5]`, `{count} = {count: 5}`, `Object.assign this, count: 3` compile; `count++` and `this.count = 5` reject.

**T18 L — Reading a member declared below gives a raw runtime TypeError.** `a := b + 1` above `b := 1` fails at construction; doctrine ("a member may read any member written above it") suggests a positioned compile error naming both sites.

**T19 M — Shallow reactivity has no diagnostics, and a new array of the same objects does not refresh rows.** `todos.push …` and `todo.done = true` change data, not DOM; `items = [...items]` after an in-place field write leaves rows stale (`__reconcile` skips `===` items).

---

## Schema and ORM

**S10 L — An unknown field type throws SchemaError, the data-failure class.**
A handler that maps SchemaError to 400 reports a declaration bug as a
client error; the async-ensure misuse has its own SchemaEnsureError.
An aliased import (`import {Address as Addr}`) as a field type fails
with a hint to import a file that is already imported.

**S3 M — Constraints on non-matching types are silently ignored.**
`n! integer, /^1/` accepts 5; `b! boolean, 1..5`, `d? date, 1..3`,
`s! string, -5..3` are accepted. A default of the wrong type or out of
range fails on every parse instead of at declaration (a literal-union
default is checked at declaration).

**S4 M — `integer` has no 32-bit bound, and docs/ORM.md's money claim is wrong.**
`price! integer, 0..` accepts 3e9 and 1e300; the column is `INTEGER`
(INT32 — `SELECT 3000000000::INTEGER` fails). ORM.md says integer cents
are exact "to 2^53 cents (≈ $90 trillion)"; the column caps near
$21.4M. `~integer` turns `"9007199254740993"` into `…992` silently;
`number` accepts `Infinity`.

**S5 M — A required `@belongsTo` foreign key is not validated before the INSERT.** `Order.create!(total: 5)` sends an INSERT without `user_id` (NOT NULL) after hooks ran; `userId: 'abc'` passes validation for an INTEGER column.

**S6 M — A coercer that returns a Promise passes.** The field value becomes a Promise; registration rejects only functions declared async.

**S7 L — `omit()` and `required()` accept unknown field names**; `pick()` rejects them.

**S8 L — `schema.connect` advertises and silently drops `token`.** No Authorization header is sent; unknown options are not rejected.

**S9 L — ORM wording.** `where({firstName: 'A', first_name: 'B'})` silently ANDs both (`create` rejects the conflict); `@ensure "bad", :nope, …` attributes the failure to a nonexistent field; `upsert on: [:email, :firstName]` calls an existing non-unique field "unknown".

---

## Rip Sites

**W12 L — `read` with a numeric range accepts a non-integer JSON number.**
`?qty=5.5` answers null, but a JSON body `{qty: 5.5}` answers 5.5.

**W4 M — `read()` with a misspelled validator name.** `read 'email',
'emial'` → `null` with 200; `'emial!'` → 400 "Missing required field";
`'emial?'` → 422. `check()` in rip/validate throws "unknown validator".

**W5 M — A required field with an invalid value is reported as missing.** `'id!'` with `id=abc` → 400 "Missing required field"; the `?` form reports 422 "not a valid".

**W6 M — A malformed JSON body reads as empty.** `'{"name": "Ada"'` → 200 with null fields; routes with `input:` return 400 `invalid_json`.

**W7 M — An async `prefix` block registers its routes without the prefix.** `prefix '/api', -> cfg = loadConfig!(); get '/ping' …` serves `/ping`, not `/api/ping`: `fn?.()` is not awaited and `finally` restores the prefix. `App(fn)` has the same `fn?.()`. Same class as #432.

**W8 M — Coded 5xx messages reach the client.** `error! 'db password is hunter2', 500, 'db_down'` → body `{"error":"db password is hunter2"}`. The README says "Raw failures and 5xx details are masked"; the code says a coded error "ships as authored". One is wrong.

**W9 L — Absent fields named after built-ins return them.** `read 'hasOwnProperty', /.+/` returns the native function source; `read 'toString', [1,100]` and `read 'constructor'` likewise.

**W10 L — A numeric enumeration in `read()` becomes a range.** `read 'qty', [1, 2, 3]` rejects 3.

**W11 L — Smaller Sites edges.** A handler returning a bigint, symbol or function sends an empty 204; `error 'x', '404'` and `error 'x', 302` become a masked 500; a JSON string body spreads into read data (`"hello"` → `read('0')` is `'h'`); an `input:` route given an array body loses the reason; `onError` returning a plain object works although the README requires a Response; the README says validators and `registerValidator` are re-exported, and they are not.

---

## Rip App

**A1 M — Async callbacks escape the router's guards.** An async `onNavigate` that throws becomes an unhandled rejection (README: callbacks "cannot break it … by throwing"); an async redirect loop runs past the "ten nested navigations" guard.

**A2 L — `stash.del` on a source key removes the source permanently.** `reset()` does not restore it; assignment to a source key is guarded, deletion is not.

**A3 L — `createMutation` callbacks written with `->` inside a component get the wrong `this`.** The action `(x) -> @n + x` compiles to an arrow, but `onSuccess: (r) -> @n = r` compiles to a method on the options object, silently writing there. The `=>` warning is a source comment only.

**A4 L — `staleTime` is case-sensitive, though the README says otherwise.** `'5 MIN'`, `'2H'`, `'Forever'` reject; `'1e999 years'` is accepted (Infinity) while the number `Infinity` rejects. Sites' `@cache` parses a different duration dialect.

**A5 L — Keyed sources share one cell between an object key and its JSON text** (`cellFor({a:1})` is `cellFor('{"a":1}')`).

---

## Standard packages

**P4 H — testing `eq` passes on different Dates, Maps and Sets.**
`eq new Date(0), new Date(1)`, `eq new Map([[1,2]]), new Map([[1,3]])`,
`eq new Set([1]), new Set([2])` all pass (`deepEq` compares own
enumerable keys). Also `throws 42` passes; `eq NaN, NaN` fails with
"expected null, got null"; `eq {a: undefined}, {}` fails with "expected
{}, got {}".

**P5 H — rsx parses truncated or ill-formed XML without error.**
`parse '<a><b>text'` → `{"a":{"b":{}}}`; `'<a>1 < 2</a>'` makes an
element named `"2<"`; two roots, trailing junk, `'hello'` and `''` are
accepted; duplicate attributes keep the last. A cut-off SOAP or EDI
response parses "successfully".

**P6 H — rsx `stringify` writes unvalidated names (markup injection).**
`stringify 'a', {'@attrs': {'x" onload="evil': '1'}}` →
`<a x" onload="evil="1"/>`; element names like `'<x>'` and `'1bad'` are
accepted.

**P7 H — x12 `set` accepts separator characters inside a value (segment injection).**
`x.set "NM1-3", "SMITH*JOHN~DMG*D8*19800101"` adds a field and a new
`DMG` segment on re-parse.

**P8 H — rip-curl treats any argument containing `=` as a variable.**
`rip packages/utils/curl.rip 'http://host/users?page=2'` prints usage
and exits 1 (`eq = arg.indexOf('=')`).

**P9 M — swarm's `-q` summary hides failures, and the exit code is 0 when tasks died.** The README Quick Start with `-w 4 -q` reports success while tasks sit in `.swarm/died/`.

**P10 M — fake `unique` dedupes by closure identity.** The README's inline `fake.unique -> fake.email()` creates a new closure per call, so it never dedupes, and its strong `Map` leaks one entry per call (packages/fake/fake.rip ~240).

**P11 M — time accepts invalid input silently.** `time.duration('garbage')` → zero; `time.duration(NaN).humanize()` → "a month"; `time(true)` is a valid date; `age('2030-01-01', '2026-01-01')` → -4.

**P12 M — csv accepts bad input and loses data.** `CSV.write 'abc'` writes three lines; `sep: ''`, `mode: 'bogus'` and unknown options are ignored; with `headers: true` an extra field is dropped and duplicate headers collapse; single-column empty rows do not round-trip; the README's `CSV.writer(sep: '\t', excel: true)` passes an option the writer ignores.

**P13 M — x12 accepts bad input.** `X12.load!` of an empty file returns the default ISA envelope; `get "EB(0)-1"` → `""`; `set "EB(?)", 5` → null silently; `set "NM1(0)-3", "Q"` throws a raw TypeError (packages/x12/x12.rip ~304).

**P14 M — rip-print's `min.js`/`min.css` exclusions never match.** The extension is the last dot segment, so `src/app.min.js` prints and `-x min.js` does not exclude it; unknown flags (`--darkk`) and `-x` without a value are ignored.

**P15 M — rsx's rejections and mixed content disagree with its README.** The mismatched-close-tag and non-string errors carry no offset; `parse '</a>'` says "expected </>, got </a>"; `<p>hi <b>there</b> you</p>` drops the text though `textKey` is described as the mixed-content key.

**P16 L — Barcode encoders ignore unknown options and disagree on errors.** `hieght:`, `colums:`, `eccc:` are accepted (rip/pdf rejects unknown keys); a QR miss throws `"finder"` while the others say "not found"; `encodeQR ''` encodes while Code 128 and PDF417 reject empty text.

**P17 L — tui `run`/`mount`/`renderToString` options are not validated.** `cols: 0`, `cols: -5`, `colz: 10` render at 80 columns.

**P18 L — rip-curl drops non-JSON bodies and malformed header lines.**

**P19 L — rip/script ends on an unknown control symbol without error** (`:skp` aborts silently; `trace` accepts `[:bogus]`); the README trace omits the `\r` actually sent.

**P20 L — validate `check` passes nullish and object input.** `check undefined, 'string'` → `""`; `check {a:1}, 'string'` → `"[object Object]"`.

**P21 L — rip-csv treats unknown flags as filenames** (`--bogus` → ENOENT) and prints raw stack traces on parse errors; `rip-db --help` lacks a final newline.

---

## Tooling

**X1 M — The piped REPL silently discards input still incomplete at EOF.** `printf 'x = (1\ny = 2\n' | bin/rip -r` exits 0 with no diagnostic; a file or stdin run reports `1:5: unclosed '('`.

**X2 L — `rip -e` gives an unpositioned message for incomplete input** ("--eval input is incomplete" versus `1:5: unclosed '('` elsewhere).

**X3 L — An unknown stdlib import from a file says "Cannot find package 'rip'"**; `-e` and the REPL say "Cannot resolve import 'rip/nope'". `if x 1` (missing `then`) errors at 1:1 with a ~60-token expected list.

---

## Documentation

**D1 ✔ M — AGENTS.md rule 9 says a `main` ruleset requires the `test` and `browser` jobs; none exists.** `gh api repos/shreeve/rip/rulesets` → `[]`; branch protection → "Branch not protected". Nothing blocks merging a red PR, and GitHub refuses auto-merge for want of a required check.

**D3 M — packages/db still documents the retired Harbor extension.** README lines ~43–45 and ~153 and `example.rip` line 6 use `INSTALL`/`harbor_serve`; "Mental model" says Harbor runs inside DuckDB (ECOSYSTEM.md's Harbor caution, still true).

**D4 M — The migration timeout "zero means no limit" claim persists on the Rip side.** src/cli/migrate.js ~107 and docs/ORM.md's `timeoutMs: null` row; Harbor clamps zero to its cap (ECOSYSTEM.md's migration-timeout caution).

**D5 L — packages/sites/README.md describes exact-path rehash and a reload on the next hash.** Lines ~1018–1022, ~1203, ~1290 (the Manager snapshots the whole tree) and ~1074 (feed.rip recovers in place); the watch-time assembly failure's Hub `assembly` message is undocumented (ECOSYSTEM.md's Sites watch cautions).

---

## Package mold

**M2 L — barcodes and tui are neither mold nor listed as earned shapes.** barcodes has no `**Runtime:**` line, a `test/` tree and `"bench": "rip test/bench.rip"`; tui has `test/`, `bench/`, `demo/` and `## Quick start`.

**M3 L — Bin names and Runtime lines break the mold.** `"swarm"` and `"rip-shat"` (googlesheets) are not `rip-<name>`; fake and googlesheets say "server-side" instead of `not browser-safe — …`. `rip.browser: true` packages use `globalThis` (http.rip ~103; app index/feed/launch), which the mold forbids and ECOSYSTEM.md calls too broad (caution 10).

---

## Duplicate spellings

Not bugs — each pair compiles identically — but every one is a choice an
agent can get "wrong" and a reviewer must normalize. docs/REFERENCE-PLAN.md
proposes a preferred form for each.

| Meaning | Spellings |
|---|---|
| equality | `is` · `==` · `===` |
| inequality | `isnt` · `!=` · `!==` |
| logic | `and` · `&&` — `or` · `\|\|` — `not` · `!` (differ with `**`, C18) |
| assignment | `?=` · `??=` — `or=` · `\|\|=` — `and=` · `&&=` |
| booleans | `yes` · `on` · `true` — `no` · `off` · `false` |
| conditional expression | `if c then a else b` · `c ? a : b` · `a if c else b` |
| delegation | `yield from` · `yield*` |
| construction | `X.new(a)` · `new X(a)` |
| optional access and call | `a?[0]` · `a?.[0]` — `f? x` · `f?(x)` · `f?.(x)` |
| template handler | `(-> a(); @b())` · `-> a(); @b()` · a method |

`then`/`else` (low-precedence and/or) and `??` (nullish) are distinct
operators, not spellings.

---

## Unconfirmed and design questions

- `(b for a in xs for b in a)` with an outer `a = 1` compiles and reads the outer `a`: correct by nesting, but it misses the Python misreading the chained-comprehension check exists for.
- At statement level `f a if b else c` evaluates `c` when `b` is false and discards it; it never calls `f`.
- `x = w /2 + h /2` rejects as an invalid regex flag (inherited from CoffeeScript).
- `a in someSet` tests a property, not membership — always false for a Set or Map.
- Duplicate keys in an object literal and duplicate class methods compile silently, while duplicate pattern names reject; should the one-binding rule cover members?
- `%%` and `//` throw on BigInt operands.
- `@click: go()` calls `go` on every click and then throws; `@click: "go()"` can never be called and could reject at compile time.
- Inside components `->` callbacks become arrows (deliberate, src/emitter.js ~17066) but this is not documented for users.
- A bare `@click` resolved to an unset `@onClick := null` prop throws on click.
- `read()` merges route params over query over body, so `POST ?role=admin` overrides a body `role`; the precedence is not documented.
- `u.typo = 1; u.save!` saves nothing silently; only `set!` guards.
- An enum with numeric values gets a `VARCHAR` column but parses to numbers (needs a database to confirm).
- validate's `ssn` accepts issuance-impossible numbers (000-, 666-, group 00).
- rsx `maxBytes` compares UTF-16 length, not bytes.
- time `set(:month, 13)` rolls over while parsing never does.
- READMEs use `new X12`, `new URLSearchParams()` and `await Bun.sleep`; the style test covers `.rip` files only.
- `rip check emptydir` exits 0 with "no .rip files found".
