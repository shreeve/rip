// The delivered-runtime table and the module-specifier spelling, defined
// once: analysis reads the table for the delivery decision, delivery for
// the bodies, emission for the injected bindings. The names' face types
// are the TS face's (src/ts/runtime-types.js).

// A module source token's specifier: the text inside its quotes (the
// token carries them). One spelling for every reader of a module edge.
export const bareSpecifier = (s) => String(s).replace(/^['"`]|['"`]$/g, '');

// The delivered-runtime table — one entry per feature runtime. Each
// entry carries the runtime's public names (the trigger set AND the
// injected binding set), the names generated output spells
// (`generatedNames`, which take minted aliases), its module's file name
// under src/runtime/ (located by locateRuntimes), the runtimes its body
// depends on (`requires`), and its structural trigger (null for none):
// the construct whose emission calls a runtime name the source never
// spells (a schema declaration emits `__schema(…)`), named by key and
// detected by analysis. Delivery otherwise triggers on free REFERENCES
// to the names, so a runtime is deliverable whether or not a language
// construct emits its names. Delivering a runtime delivers what it
// requires — both modes, uniformly — and in inline mode the bodies share
// ONE IIFE (the fragment-scope model; a sibling import line strips
// exactly as export lines do).
//   schema:     the call every emitted schema makes, the error class
//               user code catches, and the registration entry `~:name`
//               coercers resolve through (coercers resolve lazily at
//               parse time, so in-module order is free).
//   orm:        the persistence runtime — the `schema` namespace
//               (transaction/connect/setAdapter/registerCoercer) and the
//               adapter installer. A `:model` declaration delivers it
//               (evaluation installs the model machinery the declaration
//               needs), reference or not. Its body depends on the
//               validation runtime's internals.
//   reactive:   the lowering targets (`__state`/`__computed`/
//               `__effect`), `__batch`, and the user-facing API
//               (`__readonly`, `__setErrorHandler`/`__handleError`/
//               `__catchErrors`, `getEffectSignal` — each delivers by
//               reference like every other runtime name; no lowering
//               emits `__readonly`).
//   components: the component runtime — the user-callable context API
//               (`setContext`/`getContext`/`hasContext`) and the class
//               and helpers component emission spells. A component
//               declaration delivers it. Its body imports the reactive
//               runtime's owner seam.
export const RUNTIMES = [
  {
    key: 'intrinsics',
    names: ['__toPropertyKey', '__defineOwnDataProperty'],
    generatedNames: ['__toPropertyKey', '__defineOwnDataProperty'],
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
  },
  {
    key: 'reactive',
    names: ['__state', '__computed', '__effect', '__batch', '__readonly',
            '__setErrorHandler', '__handleError', '__catchErrors', 'getEffectSignal'],
    generatedNames: ['__state', '__computed', '__effect', '__batch'],
    module: 'reactive.js',
    trigger: 'reactive',
  },
  {
    // The stdlib: p, sleep, zip and friends
    // — reference-triggered, plus the match-seam structural trigger:
    // `=~` and regex-index lowerings spell `toMatchable` in generated
    // output, so those constructs deliver (and alias) it even though
    // the source never references it. A program that never spells a
    // helper name and never matches carries zero stdlib bytes, and a
    // user binding of a helper name suppresses its delivery.
    key: 'stdlib',
    names: ['abort', 'assert', 'exit', 'kind', 'noop', 'p', 'pp', 'pj', 'pr',
            'raise', 'rand', 'sleep', 'toMatchable', 'todo', 'warn', 'zip'],
    generatedNames: ['toMatchable'],
    module: 'stdlib.js',
    trigger: 'matchRead',
  },
  {
    key: 'components',
    names: ['setContext', 'getContext', 'hasContext', '__Component',
            '__pushComponent', '__popComponent', '__clsx', '__style', '__lis', '__reconcile',
            '__transition', '__handleComponentError', '__gateBind', '__detach', '__heldSlot',
            '__mountChild', '__setupChild', '__reportChildFailure', '__hostOf',
            // The owner-seam names factory emission spells —
            // re-exported by the components module so reactive-only
            // programs' injected bytes stay untouched.
            '__ownerFrame', '__pushOwner', '__popOwner', '__detachRef'],
    generatedNames: ['setContext', 'getContext', '__Component', '__mountChild', '__setupChild',
                     '__clsx', '__style', '__reconcile', '__transition', '__gateBind', '__detach', '__heldSlot', '__hostOf',
                     '__ownerFrame', '__pushOwner', '__popOwner', '__detachRef'],
    module: 'components.js',
    requires: 'reactive',
    trigger: 'component',
  },
];

// `requires` is one key or several; normalizing here keeps the closure
// and the fusion walk from each re-deciding what shape it is.
export const runtimeRequires = (rt) =>
  rt.requires == null ? [] : (Array.isArray(rt.requires) ? rt.requires : [rt.requires]);

// The table with each runtime's module URL, resolved against `base`,
// the src/runtime/ directory as the caller's module sees it: a bundle
// that inlines the caller resolves it against the bundle's own URL.
export const locateRuntimes = (base) => RUNTIMES.map((rt) => ({ ...rt, url: new URL(rt.module, base) }));
