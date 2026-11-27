// The v2 emitter's driver: one call from a parse result to the emit
// record compile() reads. It takes v1's emit() options and validates
// them with v1's messages, so the switch changes the engine and nothing
// else a caller can observe.
//
// v2 reads the parser's own tree (src/grammar/grammar.rip `kinds`
// documents every shape) and lowers each node through LOWERINGS, a
// table keyed by the node's NodeStore semanticKind. A node whose kind
// has no lowering yet rejects at its own span with an
// EmitUnimplemented error. v2 never hands a node back to v1: the two
// engines read different trees, and a silent hand-off would hide what
// v2 does not yet cover.

import { Stores } from '../stores.js';
import { CodeBuilder } from '../builder.js';

// A construct v2 has no lowering for. Distinct from every rejection a
// program earns on its own: the differential harness counts these as
// "not covered yet", never as a difference from v1.
export class EmitUnimplemented extends Error {
  constructor(kind, span) {
    super(`emitter v2: '${kind}' is not implemented yet`);
    this.kind = kind;
    if (span) {
      this.start = span[0];
      this.end = span[1];
    }
  }
}

const LOWERINGS = new Map();

const FACES = ['js', 'ts'];
const DELIVERIES = ['none', 'import', 'inline'];

export function emit(parseResult, { source = '', runtimeDelivery = 'none', face = 'js', pins = null, strict = false, script = false, browserModule = false, dataPayload = null, ambientBindings = null, repl = false, hmr = false, tolerant = false, modulePath = null, appStashSpec = null, routesUnion = null, routeParams = null } = {}) {
  if (!parseResult.sexpr) {
    throw new Error('emitter: cannot emit a failed parse');
  }
  if (!FACES.includes(face)) {
    throw new Error(`emitter: unknown face '${face}' — expected 'js' (the shipping emission) or 'ts' (the editor face)`);
  }
  if (!DELIVERIES.includes(runtimeDelivery)) {
    throw new Error(`emitter: unknown runtimeDelivery '${runtimeDelivery}' — expected 'none', 'import', or 'inline'`);
  }
  const stores = new Stores(parseResult.stores);
  const builder = new CodeBuilder(stores, { source, primitives: face === 'ts' });
  const ctx = {
    stores, builder, face, runtimeDelivery, pins, strict, script, browserModule, dataPayload,
    ambientBindings, repl, hmr, tolerant, modulePath, appStashSpec, routesUnion, routeParams,
  };
  program(ctx, parseResult.sexpr);
  return record(ctx);
}

// A node's kind is its NodeStore semanticKind; a node with no store row
// (plumbing) or no kind falls back to its head.
const rowOf = (ctx, node) => {
  const id = ctx.stores.idOf(node);
  return id === null ? null : ctx.stores.node(id);
};
const kindOf = (ctx, node) => rowOf(ctx, node)?.semanticKind ?? node[0];

export function lower(ctx, node) {
  const kind = kindOf(ctx, node);
  const lowering = LOWERINGS.get(kind);
  if (lowering === undefined) {
    const row = rowOf(ctx, node);
    throw new EmitUnimplemented(kind, row ? [row.sourceStart, row.sourceEnd] : null);
  }
  return lowering(ctx, node);
}

function program(ctx, node) {
  const { builder, stores } = ctx;
  const body = node.slice(2);
  builder.mark(stores.idOf(node), '$self', () => {
    for (const stmt of body) lower(ctx, stmt);
  });
  // The TS face of a program with no import or export carries a
  // TS-only `export {}`: the loader runs every .rip file as an ES
  // module, and a face that presented as a global script would let two
  // faces in one checker program redeclare each other's top-level names.
  if (ctx.face === 'ts' && !body.some((stmt) => MODULE_KINDS.has(kindOf(ctx, stmt)))) {
    builder.tsOnly(() => builder.emit('\nexport {};\n'));
  }
}

// `import` is the static import statement only: a dynamic import is a
// `dynimport` call.
const MODULE_KINDS = new Set(['import', 'export']);

// The emit record: every field compile() and the editor read, in v1's
// spelling. A field no lowering has written yet holds its empty value.
function record(ctx) {
  const { builder, stores } = ctx;
  return {
    code: builder.code,
    mappings: builder.rows,
    runtimeImports: [],
    vocabulary: [],
    silences: [],
    memberDecls: [],
    narrowedDecls: [],
    importedRefs: [],
    runtimeRefs: [],
    stores,
    runtimes: new Set(),
    bindings: [],
    bindingNames: [],
    replResultName: null,
    replImportResolver: null,
    tsRegions: builder.tsRegions,
    echoSpans: builder.echoSpans,
    globalDecls: [],
    pinnables: [],
    mutables: [],
    classDecls: [],
    pinSpans: [],
    loopVars: [],
    readLoopVarDecls: [],
    attrNames: [],
    routeWraps: [],
    sourceKeys: [],
    stashMembers: [],
    stashKeys: null,
    memberInits: [],
    imports: [],
    intrinsics: [],
    indexedLoops: [],
    componentUses: [],
    componentProps: {},
    namespaceExports: [],
    componentNames: [],
    partNames: [],
    renderPairs: [],
    kinds: [],
  };
}
