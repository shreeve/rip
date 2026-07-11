# Changelog

Notable changes to this repository, newest first. Entries reference this
repository's pull requests.

## Unreleased

- JavaScript-parity spellings: literal `===`/`!==` normalize to the
  strict COMPARE the two-character spellings already emit (all four
  spellings mean strict equality); `?=` assigns when the target is
  nullish (the `??=` compound's short spelling — `0` and `""` are
  kept); and `new.target` passes through inside constructors (the
  import.meta meta-property precedent) (#40)

- Method assignment and merge assignment: `x .= trim()` re-binds the
  target to a method call on itself (`x = x.trim()`, chained right
  sides included), and `*>obj = {…}` merges the value into the
  target, initializing it when nullish
  (`obj = Object.assign(obj ??= {}, {…})` — a plain-name target
  declares on first use). Both spell the target twice, so an impure
  member target binds its base once on a pre-line; both are
  statements and reject in value position (#39)

- Return guards: `x or return e`, `x and return e`, and
  `x ?? return e` (with or without a value, bare or assigning:
  `y = x or return "no"`) lower as statement rewrites —
  `if (!(y = x)) return "no";` — the one lowering that keeps the
  return's function target. Value-position uses, top-level uses, and
  uses inside expression-lowered constructs all reject positioned
  (#38)

- Await-emitting call chains group correctly: `g!()` and `g!.x`-style
  spellings agree — a call whose callee is the dammit operator sits in
  the unary tier, so `fetch!("u").json!()` emits
  `await (await fetch("u")).json()` instead of binding the accessor
  onto the Promise. A string-LITERAL left operand of `*` is repetition
  (`"-" * 40` emits `"-".repeat(40)`; a dynamic left operand keeps JS
  `*`). A bare word-unary left operand of `**` groups
  (`(typeof x) ** 2` — the unparenthesized form is a JS SyntaxError).
  Every `code` battery row's emitted output must now PARSE as
  JavaScript, so a byte pin can never lock in unrunnable output again
  (#37)

- Declaration output carries the module's edges: imports whose names
  the declarations reference are retained (an unimported name broke
  every consumer with TS2304), `export default` emits as itself
  instead of an export-nothing marker, and re-export lists and star
  re-exports pass through. Unreferenced and side-effect imports drop;
  an untyped name's export specifier drops (no declaration to name).
  A consumer-resolution gate now type-checks a real importing program
  against the generated declarations under tsc (#36)

- AGENTS.md — the operating rules for any agent (AI or human) working
  in this repository — now lives at the top level. Eight standing
  rules (reject loudly; lowerings preserve source shape; no hand-
  edits to generated files; timeless code; tests as contract;
  no silent output changes; claims verified not asserted; honest
  PR-only commits) plus the full lowering doctrine, runtime doctrine,
  mapping never-list, style vocabulary, test-authoring sharp edges,
  and command reference (#35)

- Runtime validation is stateless and structural: a `/g` or `/y`
  schema constraint resets its cursor before every test (identical
  inputs validate identically); an object schema rejects a primitive,
  `null`, or array input with a structured issue instead of spreading
  it into an empty instance; a written calendar date must exist —
  `2024-02-30` fails validation instead of silently becoming March 1
  (leap years honored, timezone-independent); and replacing a
  component's style OBJECT clears the declarations the new value
  omits, so stale styles never linger (#34)

- Reject loudly where control flow and writes have no target: `return`
  and `yield` outside a function, `break`/`continue` outside a loop,
  and `return`/`break`/`continue` inside an expression-lowered
  construct (the IIFE would capture them) all reject positioned — a
  function-TAIL if/try/switch keeps its `return`, which tunnels
  through the lowering to the enclosing function. Writes and updates
  to a computed (`~=`) binding reject at compile instead of throwing
  at the runtime's read-only container; an optional chain rejects as
  an update target (`obj?.x++` has no JavaScript reference); a
  non-string `compile()` source fails with one stable identifying
  error; the human diagnostic caret respects display cells (tabs and
  astral glyphs); and the project-config comment states present
  invariants (#33)

- Component value members initialize in SOURCE ORDER (they were
  grouped by kind, so a plain member written after a state ran first
  and could not read it); offers register after the values and
  effects still start last — a reaction never fires against a
  half-built instance. The initialization contract is one sentence:
  members initialize as written, effects start after construction (#31)

- Preserve the source program's shape through seven lowerings (the
  third cross-vendor review's evaluation/scoping cluster): a ternary
  used as another ternary's condition keeps its parens; an optional-
  chain assignment's impure receiver binds once, so the guard and the
  write see the same object; indexed, stepped, object, own, and
  range-bounded loops evaluate their source exactly once (pure
  sources keep byte-identical headers); the complex-pick parameter
  and the catch scaffold parameter mint against user bindings (`_`
  and outer `error` reads now resolve to the user's own); a value-try
  catch binding shadows same-named reactives like the statement form;
  and a source-escaped `\${` in an interpolated string stays literal
  instead of turning into a live interpolation (#30)

- Quiet the implicit-any family's missing members in the editor:
  importing a plain .js module (no declaration file, TS7016) is legal,
  idiomatic Rip and no longer squiggles — likewise `new` on an untyped
  target (7009), indexing without a signature (7017), and the indirect
  self-reference return (7024). Annotated code never fires the family;
  real error classes are untouched and pinned so (#29)

- Fix five findings from the second cross-vendor review: `throw` in
  any expression position lowers to a throwing IIFE (it previously
  emitted `throw(...)` — a call of the keyword, invalid JavaScript
  that seven stale pins had locked in); a nested block loop in value
  position accumulates like the parenthesized comprehension (it
  silently produced `[]`), staying a statement only when a `return`
  must cross out; `//=` and `%%=` evaluate a member/index base exactly
  once through an IIFE lowering; an unescaped `#{` in a slash regex
  rejects loudly naming the heregex form (it silently matched literal
  characters); and a second `export default` rejects at emit instead
  of shipping a module that cannot instantiate (#28)

- Fix five front-end findings from the cross-vendor cold review:
  signed numeric literal casts claim (`x = y as -1` erases; `+1`
  rejects naming TypeScript's '-'-only rule; a committed cast that
  claims no type rejects instead of silently reading `as` as a call);
  ternaries pair their colons per bracket depth, so a parenthesized
  nested ternary and an object literal in a ternary branch both work
  (both previously misparsed); the `::` member lookahead accepts the
  full identifier alphabet (`String::señal`); offsetAt clamps a CRLF
  line at the `\r`; and the editor's cursor mapper refuses the
  vacuous zero-byte cover match the insertion mapper already
  refused (#27)

- Fix five silent-miscompile classes found by the cross-vendor cold
  review: a value-position subjectless switch now ORs every condition
  in a multi-test `when` (only the first decided before); membership
  (`in`) with a constructed container dispatches through a helper call
  so the container evaluates exactly once (the inline form re-read
  it); a catch-pattern target named `error` now escapes (the lowering
  hard-coded the parameter name it collided with); comprehension and
  loop accumulators dodge user identifiers (`result = 10` no longer
  captures into its own accumulator); and module specifiers escape
  embedded quotes and backslashes (an apostrophe emitted invalid JS).
  Plain-name containers and collision-free programs keep byte-identical
  output; two corpus artifacts regenerate for the membership helper (#26)

- Complete prototype access with the soak form: a tight `a?::b` reads
  as `a?.prototype.b` (the existence token becomes the optional-member
  link), soak writes lower through the optional-assign guard, and the
  annotated soak write rejects shaped — an augmentation declares the
  member EXISTS, which a conditional write cannot carry (#25)

- Index the mapping offset queries: atGenerated/atSource answer
  through a centered interval tree (O(log n + k) per stab) instead of
  filtering and sorting every row (O(n)), with results byte-identical
  to the full scan, order included. The editor maps every diagnostic,
  hover, and navigation position through these queries, so per-publish
  mapping cost on large files drops ~250x (300 queries over a
  48,000-row table: 19.1 ms to 0.08 ms; the index builds lazily per
  side in ~5 ms, once per compile). Pinned by corpus-wide equivalence,
  a count-keyed staleness test, and a near-linear ops-scaling gate (#24)

- Restore stripped test coverage: eight test files defined fixtures
  whose consuming blocks were lost to over-eager de-witnessing — six
  ran zero tests. Every self-contained block is converted and kept;
  genuine sibling-compiler comparison arms are dropped; comments and
  titles state present-tense invariants. Recovered 723 tests
  (~967,000 assertions): types 4→299, sourcemap 0→137, mapping 0→126,
  schema 0→66, voidmarker 0→37, async 0→26, enum 1→23, pick 0→14.
  The corpus-invariant sweeps now run over the full current corpus (#23)

- Fix comment and test-title typos left by earlier scrubbing: doubled
  articles, unfilled placeholder phrases reworded to name the actual
  rule or mechanism, empty citation parentheses, dangling section
  references, and mangled comparison titles restated as the invariant
  they pin. Comments and test titles only — no behavior changes (#22)

- Enable prototype access: `X::m` reads and writes `X.prototype.m`
  (`String::capitalize = -> …`), and an ANNOTATED write
  (`String::capitalize: () => string = -> …`) manifests its annotation
  as an interface augmentation in the TS face and `.d.ts` — `declare
  global` for outside heads (generic globals repeat their parameter
  lists, so the annotation can name `T`), a same-module interface for
  a declared class — so the write, every call site, and hover all
  resolve the member with zero editor noise. Every shape that cannot
  deliver rejects loudly at its own position: a doubled colon outside
  the operator (including inside annotation text), an annotated write
  below the module top level, and an annotated write on a module
  binding that is not a class declaration. Augmentation bytes carry
  the annotation's mapping role, so TS diagnostics on them land on the
  author's annotation. The editor's generated tsconfig now also
  includes workspace `.d.ts` files, so hand-written ambient
  augmentations govern in the editor exactly as they do under batch
  tsc, and the type-audit fixtures pin the whole story (hover
  resolution included). Restores the lost consuming test sections of
  test/toolchain/dts.test.js (#21)

- Split the type-audit into two audits and add the tsgo twin oracle:
  the default run is the five-dimension grid (fast, streams rows live);
  `--hover`/`--all` adds the Hover Audit, which hovers every top-level
  declaration and judges each answer against TWO references — the
  hand-written twin hovered through a raw tsgo LSP (the actual
  TypeScript answer, after quote/keyword/union-order normalization)
  and the pinned hovers.json snapshot (the regression net over every
  probe, twin or no twin) (#20)

- Add the generator's own test suite (src/grammar/test: the annotation
  validator and the semantic side table, colocated with the tool) and
  the exactness differential (test/mapping/exactness.test.js: the
  incremental mapping-exactness algorithm proven equal to its literal
  definition over the corpus and adversarial chain shapes) (#19)


- Add the type-audit gauge (test/type-audit): twelve real-world typed
  fixtures with .ts/.tsx twins, a six-dimension audit runner (compiles,
  directives kept, editor verdict, runtime parity, twin validity, and
  pinned hover snapshots), the any-hover gauge metric, and the
  `bun run type-audit` script (#17)

- Give battery files real imports: the four verbs (test, code, fail,
  type) live in test/support/testing.js and every battery file imports
  them — the editor resolves the vocabulary, and a battery file run
  directly (bun test/battery/assignment.rip) executes standalone (#16)

- Wire `bun run ext` to the shared extension installer, and carry the
  icon field into the staged vsix manifest so editors show the
  extension icon (#14)

- Set the VS Code extension version to 4.0.0 (#13)

- Enforce the test boundary: root test runs mechanically exclude
  packages/**, whose suites run from their own packages (#12)

- Add the VS Code extension: syntax highlighting, hover, diagnostics,
  completions, go-to-definition, references, rename, signature help,
  semantic tokens, code actions, outline, inlay hints, and document
  links through the compiler's TS face and the TypeScript 7 LSP server;
  its suite runs as its own CI step and the dependency budget is
  enforced (#11)

- Add the UI and face test suites: components and the render DSL,
  reactive declarations, effects, readonly, the reactive/component/ORM
  runtime batteries, the TS-face strip gate with real-tsc validation,
  and the recording DOM and adapter test doubles (#10)

- Group the test suite by layer: lang/, mapping/, schema/, and
  toolchain/ directories under test/, with corpus/, battery/, and
  support/ unchanged and the battery runner beside its rows (#9)

- Run the extended tier in CI: TypeScript installs as a pinned external
  tool and `bun run test:all` arms the extended and tsc-gated checks —
  the meta-gate that requires this in CI now passes by construction (#8)

- Add the language test suite: the battery (25 files of idiom rows with
  their own runner), mapping and source-map conformance, declaration and
  schema-type checks, migration machinery, types, async, pick, void
  markers, tiers, trivia, dependency budget, TS-face fuzzing, and the
  parser-currency guard (#7)

- Add the compiler surface and corpus: the compile() entry point, project
  configuration, the Bun .rip loader, the run harness, the rip CLI with
  explain and schema evolution, the corpus snapshot layer with committed
  expected artifacts, and CI gates for parser regeneration and corpus
  drift (#6)

- Add the emitter, type faces, and feature runtimes: the full JS/TS
  two-face emitter with exact mapping rows, declaration emission, the
  schema and component type stories, and the inline-delivered reactive,
  component, schema, ORM, and stdlib runtimes (#5)

- Add the grammar and generated parser: the SLR(1) generator (solar), the
  grammar with semantic annotations and pattern labels, and the generated
  parser with node/role store population at reduce time (#4)

- Add the lexer and its rewrite passes: the offset-native tokenizer with
  trivia channel and literal-prefix indentation, the type-annotation
  collapse pass, the schema and render sub-parsers, the DOM vocabulary
  tables, and continuous integration (#3)
- Add the source/mapping foundation: operation counters, SourceFile with
  offset↔line/col conversion, node/role/mapping store query layers,
  CodeBuilder with exact-span mark protocol, Source Map V3 serialization,
  and stack-frame remapping (#2)
- Add project scaffolding: package manifest, ignore rules, MIT license, and
  this changelog (#1)
