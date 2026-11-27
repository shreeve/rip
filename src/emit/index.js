// The v2 emitter's driver: one call from a parse result to the emit
// record compile() reads. It takes v1's emit() options and validates
// them with v1's messages.
//
// v2 reads the parser's own tree (src/grammar/grammar.rip `kinds`
// documents every shape) and lowers each node through LOWERINGS, a
// table keyed by the node's NodeStore semanticKind. Whatever v2 does not
// lower rejects with an EmitUnimplemented error: a node of a kind with
// no lowering, at the node's span, and every input that reaches the
// output from outside the tree (the channels unhonored() lists). v2
// never hands anything back to v1: the two engines read different
// trees, and a silent hand-off would hide what v2 does not cover.

import { Stores } from '../stores.js';
import { SourceFile } from '../source.js';
import { Builder } from './builder.js';
import { MappingBuilder } from './mapping.js';

// Something v2 has no lowering for. Distinct from every rejection a
// program earns on its own: the differential harness counts these as
// "not covered", never as a difference from v1. `kind` is the node kind
// or the channel's name; `what` is how the message names it.
export class EmitUnimplemented extends Error {
  constructor(kind, what, span) {
    super(`emitter v2: no lowering for ${what}`);
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

// A whole-line TS directive comment, exactly v1's recognizer: the TS face
// carries it into the output.
const TS_DIRECTIVE = /^#[ \t]*@ts-(expect-error|ignore|nocheck)(?=\s|$)/;

// `mappings: false` records no MappingStore row (the record's `mappings`
// is empty): the build pays for no source span.
export function emit(parseResult, { source = '', runtimeDelivery = 'none', face = 'js', pins = null, strict = false, script = false, browserModule = false, dataPayload = null, dataLine = null, ambientBindings = null, repl = false, hmr = false, tolerant = false, modulePath = null, appStashSpec = null, routesUnion = null, routeParams = null, mappings = true } = {}) {
  if (!parseResult.sexpr) {
    throw new Error('emitter: cannot emit a failed parse');
  }
  if (!FACES.includes(face)) {
    throw new Error(`emitter: unknown face '${face}' — expected 'js' (the shipping emission) or 'ts' (the editor face)`);
  }
  if (!DELIVERIES.includes(runtimeDelivery)) {
    throw new Error(`emitter: unknown runtimeDelivery '${runtimeDelivery}' — expected 'none', 'import', or 'inline'`);
  }
  if (typeof mappings !== 'boolean') {
    throw new Error(`emitter: mappings must be true or false; got ${typeof mappings}`);
  }
  if (ambientBindings != null && !Array.isArray(ambientBindings)) {
    throw new Error(`emitter: ambientBindings must be an array of {name, kind}; got ${typeof ambientBindings}`);
  }
  const stores = new Stores(parseResult.stores);
  const builder = mappings ? new MappingBuilder(stores, source, { leaves: face === 'ts' }) : new Builder();
  const ctx = {
    stores, builder, source, face, runtimeDelivery, pins, strict, script, browserModule, dataPayload, dataLine,
    ambientBindings, repl, hmr, tolerant, modulePath, appStashSpec, routesUnion, routeParams,
  };
  unhonored(ctx, parseResult.trivia ?? []);
  program(ctx, parseResult.sexpr);
  return record(ctx);
}

// The inputs that shape v1's output from outside the tree. v2 lowers
// none of them, so each rejects when present: the DATA payload at its
// marker line, a TS directive at its comment, and every option that
// changes what v1 emits when set.
function unhonored(ctx, trivia) {
  if (ctx.dataPayload != null) {
    const start = new SourceFile(ctx.source).offsetAt(ctx.dataLine - 1, 0);
    throw new EmitUnimplemented('DATA', 'the __DATA__ payload', [start, start + 8]);
  }
  if (ctx.face === 'ts') {
    for (const t of trivia) {
      if (t.kind === 'comment' && TS_DIRECTIVE.test(t.text)) {
        throw new EmitUnimplemented('ts-directive', 'a TS directive comment', [t.start, t.end]);
      }
    }
  }
  const options = [
    ['repl', ctx.repl], ['hmr', ctx.hmr], ['script', ctx.script], ['strict', ctx.strict],
    ['browserModule', ctx.browserModule], ['pins', ctx.pins != null],
    ['ambientBindings', ctx.ambientBindings != null && ctx.ambientBindings.length > 0],
    ['appStashSpec', ctx.appStashSpec != null], ['routesUnion', ctx.routesUnion != null],
    ['routeParams', ctx.routeParams != null],
  ];
  for (const [name, set] of options) {
    if (set) throw new EmitUnimplemented(`option ${name}`, `the ${name} option`, null);
  }
}

// A node is [head, attrs, ...children] with a string head. Its kind is
// its NodeStore semanticKind; a node with no store row (plumbing) or no
// kind falls back to its head. Anything else reaching lower() is a v2
// defect, never an unlowered construct.
const rowOf = (ctx, node) => {
  const id = ctx.stores.idOf(node);
  return id === null ? null : ctx.stores.node(id);
};
const kindOf = (ctx, node) => rowOf(ctx, node)?.semanticKind ?? node[0];

export function lower(ctx, node) {
  if (!Array.isArray(node) || typeof node[0] !== 'string') {
    throw new Error(`emitter v2: lower() was handed ${Array.isArray(node) ? 'an array with no string head' : typeof node} instead of a tree node`);
  }
  const kind = kindOf(ctx, node);
  const lowering = LOWERINGS.get(kind);
  if (lowering === undefined) {
    const row = rowOf(ctx, node);
    throw new EmitUnimplemented(kind, `'${kind}'`, row ? [row.sourceStart, row.sourceEnd] : null);
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
    mappings: builder.rows ?? [],
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
