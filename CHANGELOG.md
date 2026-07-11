# Changelog

Notable changes to this repository, newest first. Entries reference this
repository's pull requests.

## Unreleased

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
