# AGENTS.md — Operating Rules for This Repository

Standing rules for any agent (AI or human) working in this repository —
the Rip compiler: language, toolchain, runtimes, and editor support.

Permanent documentation:

- [README.md](README.md) — repository orientation and entry points.
- [docs/SYNTAX.md](docs/SYNTAX.md) — context-sensitive language syntax.
- [docs/TYPES.md](docs/TYPES.md) — type and editor architecture.
- [docs/HMR.md](docs/HMR.md) — HMR design and acceptance contract.
- [docs/FRAME.md](docs/FRAME.md) — Rip-native hypermedia design and acceptance contract.
- [docs/ROADMAP.md](docs/ROADMAP.md) — current open product work.

## The Rules

1. **Reject loudly; never tolerate silently.** Invalid grammar
   annotations, reserved syntax, malformed input to tools, control
   flow with no legal target, writes to unwritable bindings — all fail
   with precise, positioned, identifying errors. Silent stripping,
   auto-repair, and drift-tolerance are bugs. The worst defect class
   is the silent miscompile: legal-looking source that compiles
   without error to wrong JavaScript. Every rule below that touches
   the emitter exists to make that class impossible.

2. **Lowerings preserve the source program's shape.** A generated
   scope (an IIFE, a minted parameter, scaffold bindings) must never
   capture a source binding — minted names dodge user identifiers —
   and a lowering must never change an operand's evaluation count or
   a control transfer's lexical target. Where preservation is
   impossible, the construct rejects loudly (rule 1); it never ships
   quietly altered semantics. The full doctrine is below.

3. **Never hand-edit generated files** (`src/parser.js`). Change the
   grammar or generator and regenerate via `bun run parser` —
   regeneration is byte-gated in CI.

4. **No backward compatibility, no legacy modes, no historical
   comments.** Code states present facts only. Never write "we used
   to", "previously", "legacy", "for compat", or speculative "someday
   we might". There is exactly one way to do each thing.

5. **Tests are the contract.** New behavior lands with tests (snapshot
   surfaces and negative tests). If a test fails, fix the code or (with
   justification) the test — never weaken an acceptance criterion to
   pass. Every confirmed defect converts to a permanent pin in the same
   commit as its fix; a pin asserts the CORRECT behavior, never the bug.

6. **Emitted output never changes silently.** A change that alters the
   compiler's output bytes lands with its regenerated corpus snapshots
   (`bun run corpus-expected`) in the same commit — and the diff is
   ENUMERATED: every changed region is inspected and matches the
   change's stated intent. An unexplained region is a stop-and-report.

7. **Claims are verified, not asserted.** A review finding, a bug
   report, or a performance claim is a hypothesis; reproduce it
   empirically before changing code, and record what refuted it when
   it dies. A performance change lands with its measurement, and the
   measurement covers every path the change touches — construction
   cost counts as much as query cost; an optimization that speeds one
   path by regressing another is not an optimization until the
   trade-off is measured and accepted.

8. **Plain git, verified locally.** Run the affected suites before
   committing; report failures as failures. Commits carry **no AI
   attribution** — no Co-Authored-By trailers, no "generated with"
   footers; authorship is the owner's.

## Lowering Doctrine (rule 2, in full)

- **Minted names dodge user identifiers.** Every temporary the emitter
  introduces is drawn from the used-name registry for the scope it
  lands in — never a fixed string. Runtime identifiers spelled by a
  lowering use module aliases minted against source bindings; direct
  source references retain the public runtime spelling. A user program
  may legally use any identifier the emitter is fond of.
- **Operands evaluate exactly once.** A lowering that must read a
  value twice (compound assignment, membership, optional assignment,
  ranges, loop sources) binds a non-repeat-safe operand to a single
  ref and reuses the ref. REPEAT-SAFE is a semantic judgment, not a
  syntactic one: only `this`, literals, and identifiers bound in the
  current lexical environment qualify — member and index access is
  NEVER repeat-safe (getters and proxies are observable user code),
  and an unresolved identifier is not either (a `globalThis` property
  may be an accessor). `repeatSafeValue`/`singleReadIterable` are the
  single source of that judgment; capture applies only at sites that
  actually reread, so single-read lowerings keep their bytes. The
  scope-boundary classifier (`scopeBoundary`) is shared by the hoist
  collector and the reference planner — a construct with its own
  scope rule is added there, once, and both walks follow.
- **Generated scopes are control-flow boundaries.** Every emitter
  site that puts a function scope into output (an arrow, an IIFE)
  either preserves the source control context without the boundary,
  explicitly supports async/generator behavior, or rejects positioned
  before emitting — and registers in the generated-scope inventory
  (`test/toolchain/generated-scopes.test.js`) with its policy. The
  parser generator compiles itself, so ref decisions are load-bearing:
  unexplained parser byte drift is a doctrine violation.
- **Control transfers keep their lexical target.** `return`, `break`,
  and `continue` inside a value-position lowering (an if/try/switch
  used as an expression, a comprehension) would be captured by the
  generated function scope, so they reject positioned. The one legal
  tunnel: an if/try/switch in a function's TAIL position keeps its
  `return`, which passes through the lowering to the enclosing
  function. Bare `break`/`continue` outside any loop, and
  `return`/`yield` outside any function, reject at the site.
- **Declaration order is initialization order.** A construct that
  collects members (a component's values, offers, states, computeds)
  initializes them in SOURCE ORDER; reactions and effects start only
  after the instance is fully built. A member may read any member
  written above it, none below it.

## Runtime Doctrine

Runtime code ships into user programs; its correctness rules are as
strict as the emitter's.

- **Validation is stateless.** Any stateful object consulted during
  validation resets before use — a `/g` or `/y` regex resets
  `lastIndex` before every test. Identical inputs validate
  identically, always.
- **Structure precedes fields.** An object schema requires an actual
  object; a primitive, `null`, or an array rejects with a structured
  issue before any field logic runs. Absent-field defaults never
  manufacture validity for an input of the wrong shape.
- **Host APIs that normalize do not decide validity.** `Date` silently
  repairs impossible calendar dates; validity is therefore computed
  from the WRITTEN components (pure calendar math, leap years,
  timezone-independent) before any `Date` is constructed. Treat every
  normalizing host API with the same suspicion.
- **Rendering writes are replacements, not accumulations.** Applying a
  new value clears what the previous value set and the new one omits —
  a style object that drops a key removes that declaration. State
  needed to compute the removal set is remembered per element, never
  rediscovered from the DOM.
- **One reactive runtime per process.** The runtime guards against a
  second copy loading. Tests that execute compiled output run it in a
  subprocess (`bun bin/rip <file>`) — evaluating inline-runtime output
  inside the test process collides with the suite's own runtime.

## The Never-List (mapping architecture doctrine)

- Side tables, not fat nodes — span, role, and mapping data live in
  stores keyed by node id, never as extra fields on tree nodes.
- No heuristic scanning of generated code — every mapping fact is
  recorded at emission time, never rediscovered by string search.
- No fake generated locations — an erased span maps as a cover or a
  zero-width row, never as a pretend-exact one.
- Offsets internally (UTF-16 code units), never line/col — line/column
  exists only at serialization boundaries (diagnostics, source maps),
  computed via `lineStarts`.

## Editor Grammars

Three highlighting surfaces ship from this repository and must stay
in lockstep with the language: the VS Code TextMate grammar
(packages/vscode/syntaxes), the highlight.js grammar
(packages/highlight — Rip Print consumes it), and the vim plugin
(packages/vim). A change that adds or alters surface syntax updates
ALL THREE in the same change.

## Style

- **Comments explain non-obvious intent** — invariants, constraints,
  why a trade-off was taken. Never narrate what code obviously does,
  never reference project history or future plans.
- **Names come from the established vocabulary**: SourceFile, TokenTape,
  NodeStore, RoleStore, MappingStore, CodeBuilder, semanticKind, role,
  `_` (structural constant), grammarRef (null for literal-sourced
  roles), childSlot, `$self`, mappingKind (exact/cover/synthetic). Do
  not invent synonyms for established concepts.
- **Spans are `[start, end)` UTF-16 code-unit offsets** plus a fileId.
- Grammar/generator sources are Rip (`.rip`); supporting modules are
  plain JavaScript ES modules; runtime and tests use Bun.

## Test-Authoring Sharp Edges

- Battery files are themselves Rip source, so quoting nests: a `"""`
  heredoc interpolates `#{}` at the battery-file level (the test's
  source never sees it); a `'''` heredoc is raw for interpolation but
  consumes one backslash level; a double-quoted EXPECTED string
  interpolates `${}` at the file level — single-quote it. When a pin's
  bytes matter, write the probe file exactly (a script that writes
  bytes beats a shell heredoc).
- The parser-regeneration gate doubles as a canary: the parser
  generator compiles itself, so an emitter change that alters minted
  temporaries or ref decisions surfaces as parser byte drift even when
  the corpus is quiet. Treat unexpected drift there as a doctrine
  violation, not noise.
- `packages/vscode` tests never ride the compiler's fast loop; the two
  suites run separately (CI runs both).

## Commands

- `bun run test:rip` — the battery alone (every test/battery/*.rip
  row — the language's syntax contract), sub-second: the inner loop
  for language work.
- `bun run test` — the FAST compiler loop: language, mapping,
  snapshots, strip/emission pins. The extended tier (tsc-spawning
  validity gates, scaling gates, fuzz drift) registers visible skips
  here.
- `bun run test:all` — the CANONICAL full suite: everything above PLUS
  the extended tier. CI runs this, always. COMPLETION CLAIMS run
  against `bun run test:all`, not the fast loop.
- `bun run test` FROM `packages/vscode` — the extension's own suite
  (run `bun install` in the package first).
- `bun run parser` — regenerate `src/parser.js` from the grammar.
- `bun run corpus-expected` — regenerate the corpus expected outputs.
- `bun run type-audit` — the typed-editor scoreboard. Three audits (type,
  hover, token); the default runs only the first. `--help` is the full
  surface — what each audit measures, and what it is judged against.
- `bun run ext` — build and install the VS Code extension.
- `bun run link-global` — make THIS checkout the machine's global rip:
  symlinks `rip` and every package bin into `~/.bun`, and points
  `~/node_modules/@rip-lang/*` here. Run once per machine (idempotent);
  running another checkout's link-global flips ownership back.
- `bun run link-check` — guardrail (also runs on postinstall): fails
  loudly if any `@rip-lang/*` name resolves outside this repo (e.g.
  shadowed by a sibling checkout's global links).

## When Blocked

- Missing decision → present options with a recommendation; ask. Do not
  silently choose.
- A gate diverging inexplicably → stop and report; do not guess around
  it.
- An acceptance criterion seems wrong → propose the change; do not
  quietly test something weaker.
