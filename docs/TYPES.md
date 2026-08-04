# Type Architecture

Rip types are recorded, erased, and delegated.

- An annotation emits no JavaScript bytes.
- The compiler records annotation text and spans in side tables.
- TypeScript performs semantic checking and inference.
- Shipping modules are JavaScript plus optional `.d.ts` declarations.
- Editors consume a non-shipping TypeScript face mapped back to Rip.

There is one Rip language, not separate typed and untyped dialects.
Type-free programs pay no runtime or output cost.

## Two consumers, one program

The compiler serves two TypeScript consumers without changing the
shipping target.

### Shipping declarations

`compile()` exposes generated `.d.ts` declarations for module
boundaries. The CLI writes them only when requested. CI validates the
declarations with external `tsc`.

### Editor face

`face: 'ts'` renders the same program as TypeScript for the editor
broker. This artifact never ships. Every TS-only byte is recorded in
`tsRegions`.

The load-bearing invariant is:

```text
stripFace(TypeScriptFace, tsRegions) === JavaScriptOutput
```

The corpus gates this equality byte-for-byte under every runtime
delivery mode.

## Type surface

Rip supports:

- typed bindings and forwards;
- parameter, rest, default, optional, and destructured annotations;
- function and arrow return types;
- casts with `as`;
- type aliases and interfaces;
- typed class, static, string-named, and prototype members;
- overload signatures;
- enum type companions;
- typed reactive, computed, and readonly containers;
- schema and model declarations;
- typed component props, members, constructors, and declaration
  companions;
- exported typed declarations.

Examples:

```rip
x: number = 5
name?: string
def parse(input: string): Result
value = raw as User

type Pair<T> = [T, T]

interface Named
  name: string

class Box
  value: number = 0

export count: number := 0
```

`::` is prototype access. Type annotations use one colon.

## Front-end representation

Type syntax is intentionally absent from the s-expression tree.

### Lexer

`rewriteTypes` folds each annotation into one `TYPE` token and each
cast into one `CAST` token. The token carries opaque source text and
its exact span.

The lexer owns structural decisions:

- balanced generic delimiters;
- annotation boundaries;
- typed-forward versus implicit-object runs;
- parameter/return/class-field positions;
- positioned rejection of unsupported class generic syntax.

### Grammar and side tables

The grammar consumes and erases the opaque token. Pattern labels record
the erased span under semantic roles such as `annotation` and
`returnType`.

Role and mapping data remain in side tables keyed by node id. No type
AST is added to syntax nodes.

## Back-end artifacts

### JavaScript

JS emission drops type text. Erased spans receive honest cover or
zero-width mapping rows; the emitter never invents a generated
location for bytes that do not exist.

### Declarations

`src/dts.js` renders exported/module-visible declarations. Untyped
files requested as declarations produce the trivial valid surface.

### TypeScript face

The normal emitter renders annotations, casts, declarations, overloads,
reactive containers, enum companions, schema intrinsics, and component
types through TS-only regions.

`src/typetext.js` owns shared type-text and signature rendering so the
face and declarations cannot drift structurally.

## Ownership boundary

Rip owns:

- recognizing and spanning type syntax;
- erasure and byte identity;
- side-table roles and bidirectional mappings;
- `.d.ts` and TypeScript-face rendering;
- structural diagnostics;
- translation between Rip and generated positions.

TypeScript owns:

- semantic type checking;
- inference;
- assignability diagnostics;
- hover, completions, definitions, references, rename, signature help,
  and semantic tokens.

TypeScript is an external tool, never a compiler dependency. The editor
package carries the pinned TypeScript/`tsgo` toolchain it brokers.

## Reactive containers

A state exports its container, not an unwrapped snapshot:

```ts
{ value: T; read(): T }
```

A computed exports a readonly `value`. `read(): T` is the structural
brand shared with the runtime's container detection, preventing an
ordinary `{value: …}` object from satisfying a binding-container slot.

Typed initializers are checked without changing runtime bytes.

## Schemas and models

Schema descriptors project into:

- output and input shapes;
- validation/schema constructor types;
- model data/create companions;
- query, CRUD, scope, and relation surfaces;
- callable `this` types;
- enum and union outputs.

Runtime delivery and type rendering are separate: using schema syntax
delivers the runtime machinery while the TS face and declarations carry
the static contract.

## Components

Component type rendering has one shared owner:
`src/component-types.js`.

It produces:

- TS-only class member declarations;
- required, optional, and bindable props;
- constructor and inherited-element surfaces;
- the same-name companion interface;
- `.d.ts` component declarations.

The face and declaration paths consume the same model.

## Declared globals

A top-level `globalThis.NAME ??= expr` declares the global. The `??=`
spelling says "install unless someone already did" — DSL vocabulary,
like stamp's `sh`/`ok`/`run` — and the face emits the typed declaration
for it: `typeof` the initializer when it is an identifier, `any`
otherwise. Plain `=` and non-top-level installs declare nothing on
purpose: a test overwriting `globalThis.fetch` and an app's guarded,
destroy-cleared lifecycle globals are not vocabulary.

The declaring package becomes its own program in the mirror (an
automatic project boundary), so the vocabulary stays package-scoped and
reaches importers the way the runtime does — importing the module runs
the installer. A non-importing neighbor keeps its cannot-find.

## Editor pipeline

The VS Code/Cursor extension:

1. compiles each Rip buffer with `face: 'ts'`;
2. materializes the open file's import closure under
   `.rip/editor/`;
3. runs `tsgo --lsp --stdio` over that real mirror tree;
4. translates requests and responses through MappingStore;
5. publishes Rip parser/emitter diagnostics directly.

The mirror is deterministic scratch state keyed by source and compiler
hashes. It is never committed or shipped.

Synthetic generated ranges do not receive fabricated Rip positions.
Diagnostics without an honest source mapping are dropped.

## Diagnostic publishing

Every mode checks the same always-on program; modes differ in which
diagnostics publish.

Gradual — the default — publishes a diagnostic only where type
information reaches its mapped source line: an annotation in the
declaration's header, the compiler's own types (schemas, components),
flow along assignment, or an import of a typed export (annotated `.rip`
exports, relative `.ts` modules, and bare workspace `.rip` packages).
Inference alone never publishes — `answer = 42` misused as a string is
held until someone writes a type — which keeps the rule statable: you
get diagnostics where type information reaches, and an annotation is how
you ask for more. The gate lives in `packages/vscode/src/scopes.js`,
shared verbatim by the editor and `rip check`, and it fails OPEN: a
source the lexer refuses publishes everything.

Names and modules that do not resolve, and definition cycles, publish
in every mode — defects no annotation answers. Gradual also supplies
`strictNullChecks: false`, yielding to any strictness the project's own
tsconfig chain sets.

## Project configuration

The nearest `package.json` is the project boundary. Its `rip` object
controls editor presentation:

```json
{
  "rip": {
    "strict": true,
    "noCheck": ["vendor/**"]
  }
}
```

`strict` surfaces implicit-any diagnostics and enables
use-before-assignment checking for typed forwards. `noCheck` suppresses
diagnostics for matching paths while keeping those files in the
TypeScript program so imports continue to resolve.

Configuration changes refresh open editor documents without a window
reload. `rip check [paths...]` applies the same project configuration,
materializes the same TypeScript faces and import closure, and translates
diagnostics through the same mapping seam without starting an editor.

## Correctness gates

- **Erasure:** typed and untyped twins emit identical JavaScript.
- **Zero cost:** type-free programs gain no type/runtime preamble.
- **Strip identity:** removing TS-only regions reproduces JS bytes.
- **Declaration validity:** corpus declarations pass `tsc --noEmit`.
- **Face validity:** corpus faces pass `tsc --noEmit`.
- **Fuzz drift:** seeded annotated constructs preserve strip identity
  and produce their required TS regions.
- **Audit:** real Rip fixtures compare compilation, diagnostics,
  runtime behavior, and editor answers against TypeScript twins.
- **Mapping:** annotations, diagnostics, hover, and definitions
  round-trip through exact UTF-16 offsets.

## File map

| Area | Files |
|---|---|
| lexer claims | `src/lexer.js` |
| grammar span labels | `src/grammar/grammar.rip`, `src/grammar/solar.rip` |
| shared type rendering | `src/typetext.js` |
| declarations | `src/dts.js` |
| TS face and strip | `src/emitter.js`, `src/builder.js` |
| schema type rendering | `src/schema-types.js` |
| component type rendering | `src/component-types.js` |
| editor broker | `packages/vscode/src/` |
| diagnostic gate | `packages/vscode/src/scopes.js` |
| type gates | `test/lang/`, `test/toolchain/`, `test/audit/` |

Open type/editor work is tracked in [ROADMAP.md](ROADMAP.md).
