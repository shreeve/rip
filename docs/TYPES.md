# Type Architecture

Rip types are recorded, erased, and delegated.

- An annotation emits no JavaScript bytes.
- The compiler records annotation text and spans in side tables.
- TypeScript performs semantic checking and inference.
- Shipping modules are JavaScript plus optional `.d.ts` declarations.
- Editors consume a non-shipping TypeScript face mapped back to Rip.

There is one Rip language, not separate typed and untyped dialects.
Type-free programs pay no runtime or output cost.

**Status:** this architecture is the shipping contract. Open product
directions (optional-parameter strictness, workspace-wide editor
features, render-DSL face positions) live in
[ROADMAP.md](ROADMAP.md), not as missing milestones in this file.

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
- type aliases and interfaces, with block bodies whose bare-colon members take their type from the indented block beneath them;
- typed class, static, string-named, and prototype members;
- overload signatures;
- enum type companions;
- typed reactive, computed, and readonly containers;
- schema and model declarations;
- typed component props, members, constructors, and declaration
  companions;
- exported typed declarations;
- type-only imports (`import type { T } from './m.rip'`).

Examples:

```rip
x: number = 5
def parse(input: string): Result
  Result.new input

value = raw as User

type Pair<T> = [T, T]

interface Named
  name: string
  nick?: string

class Box
  value: number = 0

export count: number := 0
```

`::` is prototype access. Type annotations use one colon.

## Front-end representation

Type syntax is intentionally absent from the s-expression tree.

### Lexer

`rewriteTypes` (`src/types.js`, run as a tail pass by `tokenize`) folds
each annotation into one `TYPE` token and each
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

Imports erase at two depths. A binding used only in type positions elides from its clause automatically, but the statement survives — every binding erased leaves a bare `import 'mod'`, because the emitter cannot know the module carries no side effect the program needs. `import type … from …` is the author supplying that knowledge: the whole statement erases from the JS, module load included, and rides the TS face as written. The keyword is contextual under TypeScript's lookahead rule — `type` followed by `{`, `*`, or an identifier that is not `from` opens a type-only import, so `import type from 'mod'` (a default binding named `type`) and `import { type } from 'mod'` keep their plain readings. Only the statement form exists; an inline `import { type A, B }` is not recognized.

### Declarations

`src/ts/dts.js` renders exported/module-visible declarations. Untyped
files requested as declarations produce the trivial valid surface.

### TypeScript face

The normal emitter renders annotations, casts, declarations, overloads,
reactive containers, enum companions, schema intrinsics, and component
types through TS-only regions.

`src/ts/types.js` owns shared type-text and signature rendering so the
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
{ value: T; read(): T; touch(): void }
```

A computed exports its `value` readonly and carries no `touch` — it has
no notify seam at runtime.

`read(): T` is the structural brand shared with the runtime's container
detection, preventing an ordinary `{value: …}` object from satisfying a
binding-container slot.

`touch` is the writable container's notify seam, which a bind into a
chain calls because a nested write changes no container identity. A slot
that holds a container rip minted — a module reactive, `rest`, a
component's own `:=` member — spells it `touch(): void`, so a consumer
holding that container calls it unguarded. A slot that ACCEPTS a
container from elsewhere — a prop, a bind channel — spells it
`touch?(): void`, because the sharing contract admits a caller-supplied
`{ value, read }`, which the runtime treats as a container but which has
no `touch`.

Typed initializers are checked without changing runtime bytes.

## Schemas and models

Schema descriptors project into:

- output and input shapes;
- validation/schema constructor types;
- model data/create companions;
- query, CRUD, scope, and relation surfaces;
- callable `this` types;
- enum and union outputs.

A derived binding (`UserPublic = User.pick('id', 'email')`) gets a type companion under its own name, so it can be annotated and re-exported like any declared schema. The companion is the resolved shape, projected by the same folder the browser bundler uses, so a derivation types as what the runtime builds. The projection is conservative exactly where it cannot know the shape: an unknown base or dynamic keys yield no companion rather than a guessed one, and the binding keeps the type its algebra call infers. A `:mixin` base is not such a case — `derive` refuses only `:union` and `:enum`, so a derivation from a mixin is a plain `:shape` and takes its companion like any other.

Runtime delivery and type rendering are separate: using schema syntax
delivers the runtime machinery while the TS face and declarations carry
the static contract.

## Components

Component type rendering has one shared owner:
`src/ts/components.js`.

It produces:

- TS-only class member declarations;
- required, optional, and bindable props;
- constructor and inherited-element surfaces;
- the same-name companion interface;
- `.d.ts` component declarations.

The face and declaration paths consume the same model.

A component's name at a USE site hovers the component's signature — `component Button` (`… extends input` when it inherits a tag) with the author's props in value-first spelling. tsgo's raw answer there is the construct signature over the lowered props surface; the editor re-dresses it (`presentComponentSignatureHover`): bind twins, the minted children slot, and the extends passthrough out, container unions collapsed under the same brand check as the reactive-cell presenter, a required prop's intersection group folded back as a required row. An import-bound use answers identically through tsgo's alias dress. The signature renders in a `rip` code fence — the extension's own grammar colors it the way the source reads — with no TS semicolons on the rows. A prop KEY at the use site answers the same vocabulary (`presentPropSlotHover`): the slot's bind-container arm collapses under the brand check, so `outline:` hovers `(property) outline?: boolean | undefined` — the trailing `undefined` is tsgo's optional-property convention, kept so these keys hover like every other optional property.

**Children and `slot`.** The projection channel is typed as what the runtime delivers. A child body arrives as the DOM the parent built — one element, a `DocumentFragment` for several, a `Text` node for inline text — and no body leaves the key absent; an explicit `children:` prop may pass any value, which `slot` renders as-is when it is a `Node` and as text otherwise. So the props and instance surfaces declare `children?: Node | string | number | boolean | null` — the runtime's own admission, the shape `ReactNode` and Solid's `JSX.Element` take — and a parent passing an object where a node belongs is a type error. The face names the union through a per-module alias, `__RipChildren`, that the editor scrubs to `Children` and that carries the explanatory sentence as its doc, so `slot` hovers `(slot) children?: Children | undefined` and the name expands one hop behind; the shipped `.d.ts` spells the union inline, self-contained, and because the union names `Node` (and an `extends` surface names `HTMLElementTagNameMap`) the file opens with `/// <reference lib="dom" />` — it declares its own lib dependency, so a consumer compiled with the language lib alone still resolves every name it uses; a declaration file naming no DOM global carries no directive. A component that declares `@children: T` owns the key and answers `T`. Booleans render as their text (`String(true)`), which is why `boolean` is in the union; a runtime that rendered them as nothing would drop it.

**An optional member keeps its marker.** `@label?: string` hovers `(prop) label?: string | undefined` at its declaration, at a bare read, and at a `@label` sigil read — tsgo's own display for an optional member under strict, the marker beside the absence arm, the same form a schema field's `age?` takes. The face declares the instance member required (its cell is always assigned in `_init`; the optionality lives on the props type), so the `?` the author wrote survives only in the kind record the emitter writes, and the editor re-emits it from there rather than reading it off tsgo's head.

A component body has two kinds of name. The names it declares — state, computed, readonly, methods, gates, and props at their reads — resolve bare, and `@name` is the same read spelled through the instance: it never shadows, so it is the spelling to reach for when a local carries the member's name. The names it is provided — `app`, `router`, `params`, `query`, and under `extends` the `rest` view of the undeclared caller props — appear nowhere in the body, so they take the sigil alone: `@app`, `@router`, `@params`, `@query`, `@rest`. The runtime fields never resolve bare because they are not members; a bare `rest` inside an `extends` component is rejected by the emitter, while a local the author binds as `rest` is their own name and stays bare. The view is also never assigned: it is one object held by the cell the render reads and by the map the runtime forwards from, so the emitter rejects every write that reaches it — `@rest` itself, any chain rooted there, and the same shapes inside a destructuring pattern; a value the caller should see is set on the element in render or declared as a prop. The view is typed as the tag's passthrough object — each attribute under its own spelling, typed through the tag's DOM interface, plus the `data-`/`aria-` templates, never a catch-all — named on the face through a per-tag alias the editor shows as `Rest<tag>` and spelled inline in the shipped declarations, so `@rest.disabled` on a `button` is `boolean | undefined` and hovers `(rest) rest: Rest<button>`.

## Intrinsic element typing

The render DSL's element positions are tsgo-native typed positions in the face — checking, completions, and hover happen at the lowering's OWN source-mapped bytes, through generated per-tag surfaces (`src/ts/dom-types.js`) and TS-only receiver casts. Nothing shipped changes: every added byte is a tsOnly region, held byte-identical by the strip gate.

**The surfaces.** Per used `(tag, namespace)` the emit tail declares `__RipAttrVals_<tag>` (the attribute-values interface: the names `attributeNamesFor` accepts, values below, `data-${string}`/`aria-${string}` template rows, shared `__RipGlobalAttrVals`/`__RipSvgAttrVals` bases) and `__RipEl_<tag>` (the receiver surface: generic `setAttribute<A extends keyof Vals & string>(name: A, value: Vals[A])`, name-constrained `toggleAttribute`/`removeAttribute`, `addEventListener` with the typed event-map overload plus a `(type: string, …)` overload admitting custom events, and the writable property members the lowering assigns — `className`, `value`/`checked`, the `innerHTML` family). Each render branch casts its element receiver `(el as __RipEl_<tag>)` TS-only; branch keys own exact mapping rows (rerouted through the primitive channel where they were interpolated), so a diagnostic lands on the author's key or value bytes and completions answer at the word's own position. `test/lang/dom-types.test.js` locksteps the surface vocabulary against `src/dom.js`; `test/spawn/tsc/dom-surfaces-tsc.test.js` locksteps every tag's declarations against the pinned lib; `test/spawn/tsc/dom-typing-pins.test.js` pins the tsgo mechanics the design stands on.

**Value policy.** The property roads are STRICT — the DOM property's own type (`value: 42` on an input is a number into a string property; v3 parity). The setAttribute road is the property type WIDENED by `| string` — attributes are string serializations, so `width: '400'` passes while `alt: 42` still errors; a name with no matching property is plain `string`. The widening is a policy with a stated cost: any string passes any attribute (`maxlength: 'abc'` checks — the road admits serializations, not their grammar). SVG attribute values are uniformly `string | number` (the DOM-side properties are readonly `SVGAnimated*` objects — their types describe the live object, never the serialization written), names matched verbatim (case-sensitive). `class`/`className` positions take `__RipClassValue | __RipClassValue[]` — the clsx vocabulary MINUS `number`, which the runtime's `__clsx` silently drops (the one entry that types the merge road rides the components runtime's `types` assertion). Template keys value `string | number | boolean`.

**Absence removes on the attribute road.** A value that reaches `null` or `undefined` REMOVES the attribute instead of serializing into it, so `aria-busy: @loading` on an absent optional prop writes no attribute rather than the string `undefined`. Every attribute value the road cannot prove non-nullish by its spelling — anything but a quoted string, a number, a boolean literal, or an interpolation — emits through a scratch const that forks on `== null`: a fresh element declines the set, and an updating effect removes. The value still checks, at that const, against the attribute's own type widened by `| undefined` — the spelling rip code uses for an absent value — and reaches `setAttribute` already narrowed. The runtime removes on `null` too, which the type does not invite: a nullable value says so with `?? undefined`. An attribute whose own DOM property is nullable (lib.dom declares `role` as `string | null`) keeps that arm, since it is the attribute's and not the road's; the check therefore anchors on the author's bytes and the road's admission is the same `propertyType | string` as ever. The test reads the value's spelling alone and never the face's own wraps, so the JS emission and its TS face fork identically. FALSE is not absence: `aria-expanded: @open` writes `aria-expanded="false"` when open is false, because a false ARIA state is a state and not a missing one — `?!` is how an author asks for removal on any falsy value, and a bare boolean-attribute shorthand is how one asks for the boolean-attribute road.

**One spelling.** An attribute answers to its own name and no other — the HTML spec's (lowercase), and SVG's (verbatim, case-sensitive). A DOM property's camelCase name is where the attribute's VALUE type is read from (the CAMEL bridge, shared with the extends-props surface: lib.dom carries no `readonly`, only `readOnly`), never a second key an author may write, so one attribute cannot be spelled two ways across a codebase. `readOnly:` is not an attribute name and rejects; `readonly:` is the name, and types `boolean | undefined` through the property. `for:` is likewise the name, typing through `htmlFor`.

**A name the vocabulary does not hold is the SURFACE's rejection, on every road.** `readOnly` and `readOnly:` and `notAnAttr:` all reach `setAttribute` and all fail against the tag's name union — a diagnostic beside the file's others, never a compile refusal, because emission asks no name question on the untyped road either (`= someUndefinedName` compiles to a runtime ReferenceError). tsgo's own report names the whole union with the wanted spelling elided, so the emitter records the tag, the name, and the nearest spelling at the key's own bytes, and the mapper reads the claim back from that row: a case fold answers certainly (`readOnly` → `readonly`), a near miss within two edits answers once, and a tie or a distant best declines rather than guessing.

**Events.** The handler casts carry the event's real function type with `target`/`currentTarget` claimed as the HOST element (RULINGS.md — the re-ruling superseding `any`-by-design): a literal `(e) ->` handler's param types contextually, a named method checks against the event's function type at the binding AND types its own declared bare param through the render walk's tag record (a method serving several hosts claims their union; an unknowable host stays `any`). A custom event name is legal DOM (src/dom.js) — it rides the string overload, its literal handler's param takes contextual `any` (quiet under `noImplicitAny`, no claim), and no did-you-mean exists for event names (a misspelling IS a legal custom event). The event WORD hovers the handler's event type from the compiler's intrinsics record (its face position is the listener call's string literal — no symbol): `(event) @click: HTMLElementEventMap['click'] & { target: <button>; currentTarget: <button> }`; a component's known event serves the bare map entry (the child's root is a runtime fact — no host claim), and a custom name serves `(custom event) @saved: any`.

**Refs.** Both ref roads wrap the cell bytes in a TS-only `__ripRefCell('<tag>', …)`/`__ripRefCellSvg` call whose declared constraint admits exactly the cells that can hold the tag's element — v3's nominal trick carried whole, plus two arms v4 blesses by ruling: `V = any` and the documented `el := null` idiom. A rejected cell draws TS2345 anchored on the cell's own bytes; the write checks against the wrap's return (the tag's element, nullable — teardown writes null, so a non-nullable cell rejects). Featureless lib interfaces (`HTMLSpanElement`) are type-identical to their base and admit AS the base — the same admission v3's checker makes.

**Owner-acknowledged semantics** (documented, not defects):

- A BOOLEAN attribute admits `boolean | undefined`, not any truthy value. The road lowers to `!!expr` / `if (expr)`, which would take anything, so the author's own expression states its type through a TS-only `satisfies` — a string or a length rejects (TS1360) on the row that wrote it, and the shipped bytes are untouched. The looser reading is a spelling away and says what it means: `disabled: @items.length > 0`.
- A PRESENCE value (`?!`) stays a truthiness position, because that is what the operator is for — it maps any truthy value to an attribute's presence, and `aria-invalid: errors.field?.firstName?!` on an error STRING is the idiom it exists to serve. The value still checks against the attribute's own type at the scratch const, `| null | undefined` for the remove arm.
- The merge-road `class:` key has no generated bytes of its own (the pair dissolves into one `__clsx` call), so it answers from the compiler's record — the same answer the unmerged spelling gives, because a selector class on the tag does not change what the key means.
- Selector-token words (`div#id.class`) live inside one lexer token — no per-word rows; grammar-validated, hover forgone.
- A `<=>` bind checks the direction that can be wrong: the write-back listener carries the event's real type with the host claim, so `cell.value = e.target.value` checks against the CELL and a number cell bound to a text input rejects on the bind's own row. The cell→element write stays unchecked — the DOM coerces on assignment, and the element receiver there is a scaffold local.
- A misspelled key's error lists the constraint union (TS2345) — argument positions carry no did-you-mean; the extends-props road (an object-literal position) keeps its TS2561 suggestion.
- Unknown-lowercase-with-args stays a call (TS2304, unrewritten — the standing divergence); a bare misspelled attribute rejects at compile (above v3, which shipped the markup silently).
- `data-*`/`aria-*` admit any suffix by design (v3's admission): `aria-labl` passes.
- A 2+-parameter literal handler keeps `as any`, so the CALL is forgiven — arity forgiveness is legal Rip by design (v3 rejects it). The cast lands on the arrow, not inside it, so under strict the surplus parameters still draw TS7006 for want of a contextual type.

## Typed routes

Route checking is a discovery/compile split, like the stash: the editor server and `rip check` discover the project's route tree (`appRoutesFor` in `packages/vscode/src/mirror.js` — the fixed contract `<root>/app/routes`, walked under the same project-root anchor as the stash), and the compiler takes the answers as the pure options `routesUnion` and `routeParams`. The walker re-implements `buildRoutes`' conventions in pure JS; the differential test in `packages/app/test/routes-discovery.test.js` is the drift guard.

The union is TS text over the routable files: statics as string literals, dynamic segments as `${string}` template holes, `[[optional]]` segments contributing both expansions, catch-alls excluded (they are fallbacks, not navigation targets — `/${string}` would defeat every other member) but still contributing params. Zero members leaves checking **unarmed** — never `never`, which would reject every literal in a catch-all-only project.

Three surfaces check against the union, and the gate is **syntactic**: only a value that is syntactically a `/`-leading string literal or a `/`-leading interpolated template wraps in the TS-only `__ripRoute(...)` helper (strengthened to the union at the emit tail). Anything dynamic — a binding, a computed expression, a template opening on an interpolation — and anything external (`https:`, `mailto:`, `#frag`) passes by construction, never by inference.

- Intrinsic `<a href:>` — both the plain and reactive attribute branches.
- A child component's `href:` prop — keyed on the prop NAME, because a component's tag is invisible cross-module; only the constructor-object emission wraps, the `_updateProp` re-emission stays bare.
- `router.push` / `router.replace` — via the ambient router type (`routerAmbienceType` in `src/ts/components.js`): `Omit` the two members and re-add them in method syntax with a `const P` conditional. Not a generic `Router<R>` (arrow-typed properties make the instantiations mutually unassignable under strictFunctionTypes) and not an intersection (which unions the overloaded parameter).

Diagnostics anchor on the surface's MEANINGFUL TOKEN (v3 parity), through one mechanism: the `routeWraps` channel. The emitter records a key/value generated-span pair per checked surface — the pair's KEY for the two attribute surfaces (the anchor every other mistyped attribute in the render DSL reports on: a render pair's relation site re-anchors on its key the same way, see `test/audit/RULINGS.md` § Diagnostics) and the METHOD NAME for a `push`/`replace` argument (no wrap is emitted there — the ambience's conditional does the checking — but the spans record, gated on the callee chain being exactly the ambient `this.router` and the component not declaring its own `router` member). `mapTsDiagnostic` re-maps a diagnostic covering exactly a recorded value onto its key; an unrecorded call — an array's `.push`, route-membered element type or not — can never snap, and an error interior to a recorded value (an interpolated expression's own defect) keeps its exact position. The same recorded spans are completion's gate: a string slot is route-constrained exactly when its face offset sits inside a recorded value, never inferred from the labels tsgo returns.

The ambient `RoutePath` alias (the union under a public name, for data-driven hrefs like a nav array) injects only when the module references the name and neither declares nor imports its own — a user's `RoutePath` always wins. Route files with named params get `@params` tightened to their exact shape (`{ id: string }`, optionals as `page?: string`, catch-alls as `rest: string`), by exact file identity; every other file keeps `Record<string, string>`.

Gating mirrors v3: router and `@params` typing require a discovered stash; href checking and `RoutePath` work stash-free. The escape hatches are the ordinary ones — a `string`-typed binding or an `as string` cast — and the CLI's pin-pass recompile receives identical route options through the same memo as the main pass.

## Typed source handles

`@app.data.source(path, key?)` answers a typed handle: the ambience splice (`stashMethodsType`, `src/ts/components.js`) instantiates the package's `StashMethods` at the AppData-projected shape, whose keyed overload answers `SourceHandleFor<D[K]>` for a top-level key (a keyed family's element type, anything else `NonNullable`d, with the handle re-nulling as `value: T | null`); any other string — dotted paths included — stays legal on the permissive overload and answers the untyped handle.

The strict check lives in a THIRD home, because the obvious two can't hold it: the template-literal constraint that separates a dotted path from a typo is unspellable in Rip source (structured types carry no template-literal types), and inlining it into the ambience as an anonymous type literal echoes its `import(...)` splices on every `@app` hover — the leak the `__ripAmbientApp` indirection exists to prevent. So it rides the same construction as route checking: the emitter wraps a SYNTACTIC string-literal first argument of exactly `@app.data.source(...)` in the TS-only `__ripSourceKey(...)`, declared once per module at the emit tail with the constraint `(keyof __RipStash & string) | \`${keyof __RipStash & string}.${string}\`` — a module-scope declare renders in no hover. A typo'd key (flat or dotted-under-a-typo'd-prefix) errors at the literal with the key union; a legal dotted path matches the template arm and stays untyped; a dynamic key or a bound alias (`d = @app.data; d.source(k)`) is never wrapped and lands on the package's permissive overload — the same syntactic-gate doctrine as hrefs.

The remaining template-literal casualty is `Duration`: it stays `number | string` (the runtime `DURATION_RE` parse is the sole authority on duration strings) rather than v3's template-literal form.

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
Inference alone never publishes, and an annotation is how you ask for
more. What inference produces over unannotated Rip is dominated by
confident errors about correct code: a parameter is typed from its
`= {}` default, so every legitimate `opts.foo` reads as "does not exist
on type `{}`"; an object built by spread reads as closed to the key set
it was built with; a Bun API is unknown for want of `@types/bun`. Those
land exactly where the author declined to annotate, and no edit but an
annotation answers them. The case the other side would catch —
`answer = 42` later misused as a string — is genuine but was not found
anywhere in this repository.

Type information reaches along BINDINGS, never text. Three rules follow. A function body is a hole in whatever value contains it: a body that reads a typed binding types one local inside it, never the name the function lands in nor the rest of the body — `f = (x) -> …`, `memo((x) -> …)`, and the method in `handlers = run: (x) -> …` all lose their bodies and keep their headers, so a long `main = -> …` is not typed whole because one line of it calls a typed helper. A member name or an object key is not a read — `styles = { position: 'fixed' }` reads no binding called `position`, whatever annotated function of that name the file declares. And what remains of a value outside its bodies is what it reads: `r = typedFn(x)` types `r`, and an annotation left standing in the value — `f = (x: T) -> …`, `api = fetch: (): number -> 42` — is type information the author wrote into it and types the name.

The gate lives in `packages/vscode/src/scopes.js`, shared verbatim by the editor and `rip check`, and both read the token tape the compile itself consumed — so the two gate one text, a `__DATA__` payload is not code (it seeds no binding and holds no annotation), and an open buffer's tolerant compile gates its recovered face rather than throwing it open mid-edit. The gate fails OPEN: a gate scopes.js cannot build publishes everything, since an empty annotation set would read as "nothing is annotated" and silence the file.

Names and modules that do not resolve, and definition cycles, publish
in every mode — defects no annotation answers. One exception spells the
difference between a typo and stated intent: a bare import DECLARED in
the governing package.json but not installed is held under gradual
(`rip check` counts it with the install remedy), while strict publishes
it; undeclared-and-uninstalled stays a defect everywhere. Gradual rides
TypeScript 7's default `strict` and subtracts only what it deliberately
loosens: `strictNullChecks` (the lever that changes types, not just
which diagnostics publish), `useUnknownInCatchVariables` (an
unannotated `catch` answers `any`), and `noImplicitThis` (`this` in an
unannotated object-literal method is `any`). Everything else — present
and future strict-family members — stays on, so new strictness arrives
as a visible leak, never as silent inference loss. Any strictness the
project's own tsconfig chain sets is yielded to whole.

Syntax-class diagnostics (the TS1000–1999 band) also publish in every mode: a face that does not parse invalidates every conclusion the checker draws from the file, and the malformed bytes are the emitter's, never the author's. One whose generated span maps to no source position reports at the file head rather than dropping — a vanished syntax error reads as a clean file.

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

A nested package whose mode FLIPS against its parent package's becomes
its own program in the mirror (the same automatic boundary a
globals-declaring package gets): host floors and null posture are
per-program, so the package's own mode governs them. The flip cuts both
ways — a strict package inside a gradual workspace gets its complaints
(an unresolvable `bun:sqlite` instead of a floored `any`), and a
gradual package inside a strict workspace keeps its loose base instead
of riding strict nulls and refused floors.

Configuration changes refresh open editor documents without a window
reload. `rip check [paths...]` applies the same project configuration,
materializes the same TypeScript faces and import closure, and translates
diagnostics through the same mapping seam without starting an editor.
`rip check --strict` is the preview before flipping: every package in the workspace checks as if it set `rip.strict`, nothing on disk is edited, and dependencies outside the workspace keep their own posture — as they would after the flip.

A check answers for the paths it was given. The closure is compiled and
checked whole — a target's types cannot resolve otherwise — but a
dependency's own diagnostics report through its own check, counted here
in one summary line instead. The editor draws the same line by a
different rule: it publishes per open document, so a dependency stays
silent until you open it.

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
- **Suppression matrix:** the audit's gradual pair
  (`test/audit/corpus/gradual/`) asserts every family gradual holds
  publishes nothing in gradual AND still publishes under strict — a
  family quiet in both modes is a failure — plus the published set,
  pinned per line, with `rip check` and the editor answering alike.
- **Mapping:** annotations, diagnostics, hover, and definitions
  round-trip through exact UTF-16 offsets.

## File map

| Area | Files |
|---|---|
| type claims | `src/types.js` |
| lexer pipeline | `src/lexer.js` |
| grammar span labels | `src/grammar/grammar.rip`, `src/grammar/solar.rip` |
| shared type rendering | `src/ts/types.js` |
| declarations | `src/ts/dts.js` |
| TS face and strip | `src/emitter.js`, `src/builder.js` |
| schema type rendering | `src/ts/schema.js` |
| component type rendering | `src/ts/components.js` |
| editor broker | `packages/vscode/src/` |
| diagnostic gate | `packages/vscode/src/scopes.js` |
| type gates | `test/lang/`, `test/toolchain/`, `test/audit/` |

Open type/editor work is tracked in [ROADMAP.md](ROADMAP.md).
