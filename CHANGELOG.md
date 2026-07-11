# Changelog

Notable changes to this repository, newest first. Entries reference this
repository's pull requests.

## Unreleased

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
