// Definitions both emitters read: the delivered-runtime table and the
// module-specifier spelling. src/emit/emitter.js (v1) and src/emit/index.js (v2)
// import them from here; neither keeps a copy.

import { CLSX_TYPE, STYLE_FN_TYPE } from '../ts/dom-types.js';
import { COMPONENT_CLASS, OWNER_FRAME_DECLS, OWNER_FRAME_TYPES, TEARDOWN_DECL } from '../ts/runtime-exports.js';

// A module source token's specifier: the text inside its quotes (the
// token carries them). One spelling for every reader of a module edge.
export const bareSpecifier = (s) => String(s).replace(/^['"`]|['"`]$/g, '');

// The face vocabulary of the runtime table below. An entry's `types`
// (TS face) states each injected name's signature, read off the
// runtime's implementation; a unit's assertion types every name it
// binds, and a name without an entry rides as `any`, which `rip check`
// reports to a strict project as a value it received untyped. An
// entry's `decls` is TS-only alias text its signatures reference,
// emitted ahead of the unit's destructure under the same synthetic
// row; the names are `__Rip`-prefixed, a spelling no user binding may
// take.
//
// The schema runtime's: a validation failure's issue row and the
// instance of the error class that carries them.
const SCHEMA_TYPE_DECLS = [
  'type __RipSchemaIssue = { field: string; error: string; message: string };',
  'type __RipSchemaError = Error & { issues: __RipSchemaIssue[]; schemaName: string | null; schemaKind: string | null };',
].join('\n');
// A coercer receives the trimmed string, or with `raw` the wire value
// itself; a `raw` the call cannot settle is the wire arm. The function
// comes back as it was given. An unannotated callback takes its
// parameter type from the arm the call selects.
// The context API's aliases: a provider is a component, whose instances
// carry the `__offers` record — required on the face's class, optional on
// a declaration file's interface, where a hand-built value owes none —
// and the record is what a read indexes. A read's provider argument is
// __RipProviding, which admits only a type whose instances name the
// record; named, it reads back as a name rather than its conditional.
const COMPONENTS_TYPE_DECLS = [
  'type __RipProvider = abstract new (...args: never[]) => { __offers?: object };',
  "type __RipOffers<P extends __RipProvider> = NonNullable<InstanceType<P>['__offers']>;",
  "type __RipProviding<P extends __RipProvider> = '__offers' extends keyof InstanceType<P> ? P : never;",
  'type __RipListBlock = { c(): void; m(parent: Node, anchor: Node | null): void; p(ctx: unknown, item: unknown, index: number, ...outer: unknown[]): void; d(detaching: boolean): void; _s?: boolean; _first?: Node | null };',
  'type __RipListState = { keys: unknown[]; items?: unknown[]; blocks: __RipListBlock[] };',
].join('\n');
const COERCER_TYPE = '{ <F extends (value: string) => unknown>(name: string, fn: F, options?: { raw?: false }): F; <F extends (value: unknown) => unknown>(name: string, fn: F, options: { raw: boolean }): F }';
// Adapter Contract v2 (docs/ORM.md): `query` is the floor the
// installation seams check, and the rest is feature-detected where it
// is used. `begin` receives the transaction's options whole, so its
// parameter is open; `catalog` receives the query options the CLI's
// reads pass. A result's `rows` is the write-path alias of `rowCount`.
const ORM_TYPE_DECLS = [
  'type __RipAdapterResult = { columns: { name: string; type?: string; duckdbType?: string; encoding?: string }[]; data: unknown[][]; rowCount?: number; rows?: number };',
  'type __RipAdapterQuery = (sql: string, params?: unknown[] | null, options?: { signal?: AbortSignal | null; timeoutMs?: number | null }) => __RipAdapterResult | Promise<__RipAdapterResult>;',
  'type __RipAdapter = { query: __RipAdapterQuery; begin?: (options?: unknown) => Promise<{ query: __RipAdapterQuery; commit: () => Promise<void>; rollback: () => Promise<void> }>; catalog?: (options?: { signal?: AbortSignal | null; timeoutMs?: number | null }) => Promise<Record<string, unknown>>; capabilities?: { tx?: boolean; ddlTransactional?: boolean } };',
  'type __RipSequence = { name: string; start: number };',
].join('\n');
// The `schema` namespace as orm.js builds it. `transaction` takes the
// block alone or options first, and the options pass whole to the
// adapter's `begin`, so beyond `on` they are the adapter's to read.
// `sequence` reads back with no argument, clears with null, and sets
// with a name; the migration verbs throw, CLI-only.
const ORM_SCHEMA_TYPE = '{ '
  + 'transaction: { <T>(fn: () => T): Promise<Awaited<T>>; <T>(options: { on?: __RipAdapter; [option: string]: unknown }, fn: () => T): Promise<Awaited<T>> }; '
  + 'connect: (options: string | { url: string; timeoutMs?: number | null }) => __RipAdapter; '
  + 'setAdapter: (adapter: __RipAdapter) => void; '
  + 'sequence: { (): __RipSequence | null; (name: null): null; (name: string, options?: { start?: number }): __RipSequence }; '
  + `registerCoercer: ${COERCER_TYPE}; `
  + 'plan: () => never; status: () => never; make: () => never; migrate: () => never; introspect: () => never'
  + ' }';

// The delivered-runtime table — one entry per feature runtime. Each
// entry carries the runtime's public names (the trigger set AND the
// injected binding set), its module's file name under src/runtime/
// (located by locateRuntimes), and its structural trigger
// (null for none): the construct whose emission calls a runtime name
// the source never spells (a schema declaration emits `__schema(…)`),
// named by key — each engine detects it on its own tree.
// Delivery otherwise triggers on free REFERENCES to the names —
// the delivery rule — so a runtime is deliverable before any
// language construct emits its names (delivery triggers on
// references alone).
//   schema:     the call every emitted schema makes, the error class
//               user code catches, and the registration entry `~:name`
//               coercers resolve through (coercers resolve lazily at
//               parse time, so in-module order is free).
//   orm: the persistence runtime — the `schema`
//               namespace (transaction/connect/setAdapter/
//               registerCoercer) and the adapter installer, plus the
//               structural trigger: a `:model` declaration
//               delivers it (evaluation installs the model machinery
//               the declaration needs), reference or not. Its body
//               depends on the validation runtime's internals (the
//               module imports them), so delivering it delivers the
//               schema runtime too — both modes, uniformly — and in
//               inline mode the two bodies share ONE IIFE (the
//               fragment-scope model; the import line strips exactly
//               as export lines do).
//   reactive:   the lowering targets (`__state`/`__computed`/
//               `__effect`), `__batch`, and the user-facing API
//               (`__readonly`, `__setErrorHandler`/`__handleError`/
//               `__catchErrors`, `getEffectSignal` — each delivers by
//               reference like every other runtime name; no lowering
//               emits `__readonly`).
//   components: the component runtime — the user-callable
//               context API (`setContext`/`getContext`/`hasContext`)
//               and the emission-facing class + helpers the component
//               declaration waves  spell in generated output.
//               Its body imports the reactive runtime's owner seam,
//               so delivering it delivers reactive too — both modes,
//               uniformly — and in inline mode the two bodies share
//               ONE IIFE. The structural trigger (a component
//               declaration node) arrives with the component grammar, whose
//               emission is what makes one exist; until then delivery
//               triggers on references alone.
export const RUNTIMES = [
  {
    key: 'intrinsics',
    names: ['__toPropertyKey', '__defineOwnDataProperty'],
    generatedNames: ['__toPropertyKey', '__defineOwnDataProperty'],
    types: {
      __toPropertyKey: '(value: unknown) => string | symbol',
      __defineOwnDataProperty: '<T extends object>(target: T, key: PropertyKey, value: unknown) => T',
    },
    module: 'intrinsics.js',
    trigger: 'objectComprehension',
  },
  {
    // The schema vocabulary: directive names, arg shapes, and the
    // naming rules every derived identifier obeys. Binds NO user-facing
    // name — delivered only as a dependency, fused ahead of whatever
    // requires it. The COMPILER imports the same file directly, so the
    // vocabulary has exactly one definition across all three layers.
    key: 'vocab',
    names: [],
    module: 'vocab.js',
    trigger: null,
  },
  {
    key: 'schema',
    names: ['__schema', 'SchemaError', 'registerCoercer'],
    module: 'schema.js',
    requires: ['vocab'],
    trigger: 'schema',
    decls: SCHEMA_TYPE_DECLS,
    // `__schema` returns `unknown`: every NAMED declaration casts its
    // result to the schema's type story wherever it is written (module
    // scope or a function body), so the open return reaches only an
    // anonymous schema — a value with no name to type — and the name
    // is spelled by emission alone, so no source reference reads it.
    types: {
      __schema: '(descriptor: unknown) => unknown',
      SchemaError: '{ new (issues: __RipSchemaIssue[], schemaName?: string | null, schemaKind?: string | null): __RipSchemaError; prototype: __RipSchemaError }',
      registerCoercer: COERCER_TYPE,
    },
  },
  {
    // The DuckDB substrate (wire client to duckdb-harbor). Binds NO
    // user-facing name — it is delivered only as a dependency, fused
    // into the unit of whatever requires it, so a program that declares
    // no model carries none of it. Server-only by nature (fetch,
    // process.env): never add it to the browser runtime surface.
    key: 'duckdb',
    names: [],
    module: 'duckdb.js',
    trigger: null,
  },
  {
    key: 'orm',
    names: ['schema', '__schemaSetAdapter'],
    module: 'orm.js',
    requires: ['schema', 'duckdb', 'vocab'],
    trigger: 'modelSchema',
    decls: ORM_TYPE_DECLS,
    types: {
      schema: ORM_SCHEMA_TYPE,
      __schemaSetAdapter: '(adapter: __RipAdapter) => void',
    },
  },
  {
    // `types` (TS face): the reactive primitives are GENERIC — the
    // inlined JS would infer anys, but `__state(v)` genuinely returns
    // a cell of v's type, and typing the destructure makes every
    // unannotated reactive infer natively (`store ~= cart` is a
    // readonly cell of cart's full object type).
    // Plain type params widen literal arguments (T from 'Rip' is
    // string, not "Rip") — the declare-in-place widening story.
    // `__state` PASSES AN EXISTING CELL THROUGH (reactive.js's first
    // line), which the signature states by admitting the cell in the
    // ARGUMENT: a prop's delivery seam is `__state(props.__bind_x__ ??
    // props.x ?? …)` over _init's props parameter, whose argument
    // legitimately unions the cell with the value, and a signature that
    // always wrapped would type that member a cell of a cell.
    // That union is READ BY USERS: an annotated `:=` enforces its
    // initializer with an explicit type argument here, so a scalar
    // rejection names this parameter type. It is the accepted cost of
    // the pass-through, and the alternative was measured — splitting
    // it into overloads makes TypeScript report TS2769 against the
    // last one, which loses the array/tuple spellings' element anchor.
    // The RETURN states `touch()`, the minted spelling, because an
    // annotated `:=` declares a minted container and this call is its
    // initializer — an optional return would not be assignable to it.
    // The pass-through arm is where that reaches past what the runtime
    // guarantees: a hand-built `{ value, read }` handed to `__state`
    // comes back with a `touch` the type promises and the object lacks.
    // That arm's own reason for existing is the prop seam, where the
    // result lands in a member typed with the TAKEN spelling and the
    // promise is narrowed straight back off.
    key: 'reactive',
    names: ['__state', '__computed', '__effect', '__batch', '__readonly',
            '__setErrorHandler', '__handleError', '__catchErrors', 'getEffectSignal'],
    generatedNames: ['__state', '__computed', '__effect', '__batch'],
    module: 'reactive.js',
    trigger: 'reactive',
    types: {
      __state: '<T>(value: T | { value: T; read(): T }) => { value: T; read(): T; touch(): void }',
      __computed: '<T>(fn: () => T) => { readonly value: T; read(): T }',
      __effect: '(fn: () => unknown) => () => void',
      __batch: '<T>(fn: () => T) => T',
      __readonly: '<T>(value: T) => Readonly<{ value: T }>',
      __setErrorHandler: '(handler: ((error: unknown) => void) | null) => ((error: unknown) => void) | null',
      __handleError: '(error: unknown) => void',
      // `__catchErrors` WRAPS: the function it returns calls `fn` with the
      // caller's `this` and arguments, and a throw goes to the error
      // handler in place of a result.
      __catchErrors: '<F extends (...args: never[]) => unknown>(fn: F) => (this: ThisParameterType<F>, ...args: Parameters<F>) => ReturnType<F> | undefined',
      getEffectSignal: '() => AbortSignal | null',
    },
  },
  {
    // The stdlib: p, sleep, zip and friends
    // — reference-triggered, plus the match-seam structural trigger:
    // `=~` and regex-index lowerings spell `toMatchable` in generated
    // output, so those constructs deliver (and alias) it even though
    // the source never references it. A program that never spells a
    // helper name and never matches carries zero stdlib bytes, and a
    // user binding of a helper name suppresses its delivery. `types`
    // annotates the inline destructure on the TS face (member
    // signatures, the STDLIB_TYPE_DECLS): the checker sees precise
    // types without inferring through the IIFE.
    key: 'stdlib',
    names: ['abort', 'assert', 'exit', 'kind', 'noop', 'p', 'pp', 'pj', 'pr',
            'raise', 'rand', 'sleep', 'toMatchable', 'todo', 'warn', 'zip'],
    generatedNames: ['toMatchable'],
    module: 'stdlib.js',
    trigger: 'matchRead',
    types: {
      abort: '(msg?: string) => never',
      assert: '(v: unknown, msg?: string) => void',
      exit: '(code?: number) => never',
      kind: '(v: unknown) => string',
      noop: '() => void',
      p: '(...args: unknown[]) => void',
      pp: '<T>(v: T) => T',
      pj: '<T>(v: T) => T',
      pr: '<T>(v: T) => T',
      // `raise` throws what it is handed: a message becomes an Error, and
      // a constructor with its argument constructs the throwable.
      raise: '{ (message: unknown): never; <A>(ctor: new (arg: A) => unknown, arg: A): never }',
      rand: '(a?: number, b?: number) => number',
      sleep: '(ms: number) => Promise<void>',
      toMatchable: '(v: unknown) => string',
      todo: '(msg?: string) => never',
      warn: '(...args: unknown[]) => void',
      // `zip` tuples its arrays' elements positionally, as many tuples as
      // the first array has elements.
      zip: '<T extends unknown[][]>(...arrays: T) => { [I in keyof T]: T[I] extends (infer E)[] ? E : never }[]',
    },
  },
  {
    key: 'components',
    names: ['setContext', 'getContext', 'hasContext', '__Component',
            '__pushComponent', '__popComponent', '__clsx', '__style', '__lis', '__reconcile',
            '__transition', '__handleComponentError', '__gateBind', '__detach', '__heldSlot',
            '__reportChildFailure', '__hostOf',
            // The owner-seam names factory emission spells —
            // re-exported by the components module so reactive-only
            // programs' injected bytes stay untouched.
            '__ownerFrame', '__pushOwner', '__popOwner', '__detachRef'],
    generatedNames: ['setContext', 'getContext', '__Component',
                     '__pushComponent', '__popComponent', '__clsx', '__style', '__reconcile',
                     '__transition', '__gateBind', '__detach', '__heldSlot', '__reportChildFailure', '__hostOf',
                     '__ownerFrame', '__pushOwner', '__popOwner', '__detachRef'],
    decls: COMPONENTS_TYPE_DECLS,
    types: {
      // The context API types a source call as the `accept … from`
      // lowering is typed: the provider is a component, whose instances
      // carry the `__offers` record, the key is one the provider OFFERS,
      // and a read answers that offered member's container. A provider
      // whose instances carry no record — a plain class included — fails
      // on the provider argument, and a key the record lacks on the key.
      // The key vocabulary is the offered names, so `setContext` takes a
      // string where the runtime's Map would take any key. The lowering's
      // own read is typed the same way; its report folds into the declare
      // line's (mapTsDiagnostic).
      setContext: '(key: string, value: unknown) => void',
      getContext: '<P extends __RipProvider, K extends keyof __RipOffers<P>>(provider: __RipProviding<P>, key: K) => __RipOffers<P>[K]',
      hasContext: '<P extends __RipProvider>(provider: __RipProviding<P>, key: keyof __RipOffers<P>) => boolean',
      // The one entry that types every merged `class:` value — the
      // face's __RipClassValue alias arms alongside it (the tail's
      // domSurfaceDecls emission).
      __clsx: CLSX_TYPE,
      // The style road's writer — its value parameter is the face's
      // __RipCSSProperties alias, armed alongside.
      __style: STYLE_FN_TYPE,
      // The base every component extends.
      __Component: { class: COMPONENT_CLASS, decls: `${OWNER_FRAME_DECLS}\n${TEARDOWN_DECL}` },
      // The lowering's own calls: list reconciliation generic over the
      // context, the item and every outer loop binding; a gate's cell
      // typed by the stash projection the face passes as its argument.
      __pushComponent: '(component: __Component | null) => __Component | null',
      __popComponent: '(prev: __Component | null) => void',
      __lis: '(arr: readonly number[]) => number[]',
      __reconcile: '<C, T, O extends unknown[]>(anchor: Node | null | undefined, state: __RipListState, items: readonly T[], ctx: C, factory: (ctx: C, item: T, index: number, ...outer: O) => __RipListBlock, keyFn: ((item: T, index: number) => unknown) | null | undefined, ...outer: O) => void',
      __transition: '(el: Element, name: string, dir: string, done?: (() => void) | null) => void',
      __handleComponentError: '(error: unknown, component: __Component | null | undefined) => void',
      __gateBind: '<T>(self: __Component, index: number) => { readonly value: T; read(): T }',
      __detach: '(node: Node | null | undefined) => void',
      __heldSlot: '(children: unknown) => Node',
      __reportChildFailure: '(name: string, error: unknown) => void',
      __hostOf: '(inst: __Component, event: string) => Element',
      ...OWNER_FRAME_TYPES,
    },
    module: 'components.js',
    requires: 'reactive',
    trigger: 'component',
  },
];

// A table entry typed `{ class }` is a class the runtime exports. On the
// face its injected binding is a value, never a type, so the class is
// declared under a face name of its own and the binding typed `typeof`
// it; a subclass's undeclared member then fails against it.
const faceClassName = (name) => `__Rip${name.replace(/^_+/, '')}`;
// A string signature naming one of the unit's classes names its face
// declaration, since the injected binding is a value.
export const faceRuntimeType = (name, signature, types = {}) => {
  if (typeof signature === 'object') return `typeof ${faceClassName(name)}`;
  let text = signature;
  for (const [cls, sig] of Object.entries(types)) {
    if (typeof sig === 'object') text = text.replace(new RegExp(`\\b${cls}\\b`, 'g'), faceClassName(cls));
  }
  return text;
};
export const faceClassDecls = (types) => Object.entries(types ?? {})
  .filter(([, signature]) => typeof signature === 'object')
  .map(([name, { class: body, decls }]) => {
    const text = body.replace(new RegExp(`\\b${name}\\b`, 'g'), faceClassName(name));
    return `${decls ? `${decls}\n` : ''}declare class ${faceClassName(name)} ${text}`;
  })
  .join('\n');

// `requires` is one key or several; normalizing here keeps the closure
// and the fusion walk from each re-deciding what shape it is.
export const runtimeRequires = (rt) =>
  rt.requires == null ? [] : (Array.isArray(rt.requires) ? rt.requires : [rt.requires]);

// The table with each runtime's module URL, resolved against `base`,
// the src/runtime/ directory as the caller's module sees it: a bundle
// that inlines the caller resolves it against the bundle's own URL.
export const locateRuntimes = (base) => RUNTIMES.map((rt) => ({ ...rt, url: new URL(rt.module, base) }));
