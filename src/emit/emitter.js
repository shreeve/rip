// The emitter's entry: assembles Emitter from its area modules, then owns
// emit() — option normalization (ambientBindings), the face choice, the
// result shape ({code, mappings, stores, bindings, ...}), delivery
// decisions and the public re-exports (runtime table, face helpers,
// shape helpers). The per-construct lowerings live in the area modules
// beside this file; the class itself and the statement/expression
// dispatch live in core.js. Emitter is the JS face; TsEmitter
// (face.js) extends it into the TS face.
//
// Every character is written THROUGH a MappingBuilder (src/emit/mapping.js)
// so each emitted node and role gains exact MappingStore rows when asked
// for. The emitter never replaces AST arrays: it only reads the tree, so
// every WeakMap nodeId join stays live.
import { Stores } from '../stores.js';
import { MappingBuilder } from './mapping.js';
import { isIdentifierName } from '../ident.js';
import { analyze } from './analyze.js';
import { runtimeRequires } from './runtimes.js';
import { Emitter } from './core.js';
import { RUNTIME_TABLE, runtimeText } from './delivery.js';
import { FaceHooks } from './hooks.js';
import { TsEmitter } from './face.js';
import { ReactiveMethods } from './reactive.js';
import { ScopeMethods } from './scope.js';
import { ModuleMethods } from './modules.js';
import { SchemaMethods } from './schema.js';
import { ControlMethods } from './control.js';
import { MatchMethods } from './match.js';
import { LoopMethods } from './loops.js';
import { ValueMethods } from './values.js';
import { AssignMethods } from './assign.js';
import { ComponentMethods } from './components.js';
import { RenderMethods } from './render.js';
import { RenderDynamicMethods } from './render-dynamic.js';
import { ChainMethods } from './chains.js';
import { OperatorMethods } from './operators.js';
import { LiteralMethods } from './literals.js';
import { ClassMethods } from './classes.js';
import { FunctionMethods } from './functions.js';

export { PROTO_GENERIC_PARAMS, moduleSourceText } from './helpers.js';
export { protoMemberTarget, ctorAtFields, isModuleImportNode, containsAwait, containsYield } from './tree.js';
export { _runtimeTable, _runtimeExports } from './delivery.js';

// Each area's carrier class lends its members to Emitter: instance members
// onto the prototype, statics onto the class. A carrier holds members only —
// state an instance field or constructor would add, or a static that
// shadows the class's own name/length, has nowhere to go, so it rejects at
// load; so does a name two areas define.
const AREAS = [ReactiveMethods, FaceHooks, ScopeMethods, ModuleMethods, SchemaMethods, ControlMethods, MatchMethods, LoopMethods, ValueMethods, AssignMethods, ComponentMethods, RenderMethods, RenderDynamicMethods, ChainMethods, OperatorMethods, LiteralMethods, ClassMethods, FunctionMethods];
const install = (area) => {
  if (Object.getOwnPropertyNames(new area()).length) throw new Error(`emitter: ${area.name} carries instance state; an area holds methods only`);
  for (const key of ['name', 'length']) {
    if (Object.getOwnPropertyDescriptor(area, key).writable) throw new Error(`emitter: ${area.name} overrides static ${key}`);
  }
  for (const [target, source, skip] of [[Emitter.prototype, area.prototype, ['constructor']], [Emitter, area, ['length', 'name', 'prototype']]]) {
    for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(source))) {
      if (skip.includes(key)) continue;
      if (Object.hasOwn(target, key)) throw new Error(`emitter: ${area.name} redefines ${key}`);
      Object.defineProperty(target, key, desc);
    }
  }
};
AREAS.forEach(install);

// A face class overrides the JS face at the seam's members and nowhere
// else: a member that shadowed any other Emitter member would lower that
// construct differently on the two faces, and the TS face must be the JS
// emission plus type syntax.
const checkSeam = (face) => {
  for (const [target, base, skip] of [[face.prototype, Emitter.prototype, ['constructor']], [face, Emitter, ['length', 'name', 'prototype']]]) {
    for (const key of Object.getOwnPropertyNames(target)) {
      if (skip.includes(key) || !(key in base) || Object.hasOwn(FaceHooks.prototype, key)) continue;
      throw new Error(`emitter: ${face.name} shadows ${key}, which is not a face hook (src/emit/hooks.js)`);
    }
  }
};

// The emitter class of each face. A build without the TS face (the
// browser bundle, whose face.js exports a null TsEmitter) has none for it.
const FACES = { js: Emitter, ts: TsEmitter };
if (TsEmitter !== null) checkSeam(TsEmitter);

// The class that emits `face`. compile() asks before it parses, so a face
// this build lacks rejects whatever the source.
export function faceEmitter(face) {
  if (!Object.hasOwn(FACES, face)) {
    throw new Error(`emitter: unknown face '${face}' — expected 'js' (the shipping emission) or 'ts' (the editor face)`);
  }
  if (FACES[face] === null) throw new Error(`emitter: the ${face.toUpperCase()} face is unavailable in this build`);
  return FACES[face];
}

// The binding kinds an ambient seed may carry — exactly the kinds the
// binding inventory reports (one vocabulary; a REPL feeds one line's
// inventory back as the next line's seed).
const AMBIENT_KINDS = new Set(['plain', 'state', 'computed', 'effect', 'readonly', 'import', 'class', 'def']);

// Validate and normalize the ambientBindings option: an array of
// {name, kind} with identifier names (the LEXER's identifier
// vocabulary — a seed round-trips names the scanner accepted, Unicode
// included), known kinds, and no duplicates — anything else rejects
// loudly (an API guard; no source node exists, so the error is
// message-only).
const normalizeAmbient = (ambientBindings) => {
  if (ambientBindings == null) return [];
  if (!Array.isArray(ambientBindings)) {
    throw new Error(`emitter: ambientBindings must be an array of {name, kind}; got ${typeof ambientBindings}`);
  }
  const seen = new Set();
  for (const b of ambientBindings) {
    if (b === null || typeof b !== 'object' || !isIdentifierName(b.name)) {
      throw new Error(`emitter: ambientBindings entries are {name, kind} with an identifier name; got ${JSON.stringify(b)}`);
    }
    if (!AMBIENT_KINDS.has(b.kind)) {
      throw new Error(`emitter: ambientBindings kind '${b.kind}' for '${b.name}' is not a binding kind — expected one of ${[...AMBIENT_KINDS].join(', ')}`);
    }
    if (seen.has(b.name)) {
      throw new Error(`emitter: ambientBindings names '${b.name}' twice — one binding per name`);
    }
    seen.add(b.name);
  }
  return ambientBindings;
};

// parseResult: the generated parser's {sexpr, stores, diagnostics}.
// Returns {code, mappings, stores, …} — mappings are plain MappingStore
// rows (src/stores.js Mappings is the query layer).
export function emit(parseResult, { source = '', mappings = true, runtimeDelivery = 'none', face = 'js', pins = null, strict = false, script = false, browserModule = false, dataPayload = null, dataLine = null, ambientBindings = null, repl = false, hmr = false, tolerant = false, modulePath = null, appStashSpec = null, routesUnion = null, routeParams = null } = {}) {
  if (!parseResult.sexpr) {
    throw new Error('emitter: cannot emit a failed parse');
  }
  if (typeof mappings !== 'boolean') {
    throw new Error(`emitter: mappings must be true or false; got ${typeof mappings}`);
  }
  const Face = faceEmitter(face);
  if (runtimeDelivery !== 'none' && runtimeDelivery !== 'import' && runtimeDelivery !== 'inline') {
    throw new Error(`emitter: unknown runtimeDelivery '${runtimeDelivery}' — expected 'none', 'import', or 'inline'`);
  }
  const ambient = normalizeAmbient(ambientBindings);
  const program = parseResult.sexpr;
  const stores = new Stores(parseResult.stores);
  const programId = stores.idOf(program);
  // The editor face always maps: its consumers read the rows.
  const builder = new MappingBuilder(stores, source, { record: mappings || face === 'ts', claims: face === 'ts' });
  const emitter = new Face(stores, builder, { pins, strict, script, browserModule, repl, hmr, tolerant, modulePath, appStashSpec, routesUnion, routeParams });
  // The program's binding facts, its delivery decision and its scope
  // rejections, from one walk of the parser's tree. An hmr build exports
  // the component table under the renderer's contract: no module-scope
  // declaring form or write may claim it.
  const reserved = hmr && modulePath ? [{ name: '__hmrComponents', kind: 'the HMR component table' }] : [];
  const facts = analyze(parseResult, { source, face, ambientBindings: ambient, repl, stores, dataLine, reserved });
  emitter.useAnalysis(facts);
  emitter.dataPayload = dataPayload;

  emitter.collectSourceChannels(parseResult.tokens ?? [], parseResult.trivia ?? []);
  // TS directive comments: pair each whole-line `# @ts-…` comment from
  // the trivia channel with the statement it governs.
  emitter.collectTsDirectives(program, parseResult.trivia ?? [], source);
  emitter.typeOnlyImports = facts.typeOnlyImports;
  emitter.appAccessors = facts.appAccessors;
  emitter.tsCollectValidatorRegistrations(program);
  emitter.tsHead(programId);

  // Minted temps and runtime aliases dodge every identifier the
  // module's trees spell and every ambient name, which the environment
  // binds. Runtime names spelled only by generated output get one
  // module-level alias minted against every source binding: the public
  // runtime name by default, preserving bytes and source-spelled
  // references, and a suffixed name on a binding collision, which
  // delivery imports or destructures into.
  emitter.temps.used = facts.atoms;
  const { bindings, bindingNames, runtimes } = facts;
  const aliasUsed = new Set(bindingNames);
  for (const rt of RUNTIME_TABLE) {
    for (const name of rt.generatedNames ?? []) {
      emitter.runtimeAliases.set(name, Emitter.mintName(name, aliasUsed));
    }
  }
  if (runtimeDelivery !== 'none') {
    // A seeded name counts as bound: a free reference to a runtime name a
    // prior line bound neither triggers an injection nor is shadowed by one.
    const bound = new Set(facts.bound);
    for (const { name } of ambient) bound.add(name);
    const active = RUNTIME_TABLE.filter((rt) => runtimes.has(rt.key));
    const units = runtimeDelivery === 'import' ? importUnits(active) : inlineUnits(active);
    for (const unit of units) emitRuntimeUnit(emitter, builder, programId, unit, bound);
  }
  emitter.tsSchemaStory(program, programId);

  // Ambient bindings frame the program from BELOW its own scope: the
  // program's declarations shadow a seed (redeclaration wins), and
  // anything the program does not itself bind resolves to the seed —
  // reactive kinds unwrap, everything else reads plain. The scope
  // entry makes seeded names visible to hoist filtering (the program
  // and every nested function skip re-declaring them).
  if (ambient.length > 0) {
    const reactive = new Set();
    const computed = new Set();
    const readonly = new Set();
    const bound = new Set();
    for (const { name, kind } of ambient) {
      if (kind === 'state' || kind === 'computed') reactive.add(name);
      else bound.add(name);
      if (kind === 'computed') computed.add(name);
      if (kind === 'readonly') readonly.add(name);
    }
    emitter.rframes.push({ reactive, computed, bound, ambientReadonly: readonly });
    emitter.scopes.push(new Set(ambient.map(({ name }) => name)));
  }
  emitter.program(program);
  if (ambient.length > 0) {
    emitter.rframes.pop();
    emitter.scopes.pop();
  }
  const globalDecls = emitter.tsTail(program);
  // The exported objects whose every value is one of this module's own
  // components — the qualifiers an importer's tag constructs through.
  const partNames = emitter.exportedObjects
    .filter(([, values]) => values.every((value) => emitter.componentNames.includes(value)))
    .map(([name]) => name);
  const pinnables = pinnableRecords(emitter, builder, stores);
  return { code: builder.code, mappings: builder.rows, runtimeImports: emitter.runtimeImports, vocabulary: emitter.vocabulary, silences: emitter.silences, memberDecls: emitter.memberDecls, narrowedDecls: emitter.narrowedDecls, importedRefs: emitter.importedRefs, runtimeRefs: emitter.runtimeRefs, stores, runtimes, bindings, bindingNames, replResultName: emitter.replResultName, replImportResolver: emitter.replImportResolver, tsRegions: builder.tsRegions, echoSpans: builder.echoSpans, globalDecls, pinnables, mutables: emitter.mutables, classDecls: emitter.classDecls, pinSpans: emitter.pinSpans, loopVars: emitter.loopVars, readLoopVarDecls: emitter.loopVarDecls.filter((d) => d.owner.readVars.has(d.which)).map((d) => d.span), attrNames: emitter.attrNames, routeWraps: emitter.routeWrapSpans, sourceKeys: emitter.sourceKeySpans, stashMembers: emitter.stashMemberSpans, stashKeys: emitter.stashKeys ?? null, memberInits: emitter.memberInitSites, imports: emitter.importSpans, intrinsics: emitter.intrinsics, indexedLoops: emitter.indexedLoops, componentUses: emitter.componentUses, componentProps: emitter.componentProps, namespaceExports: emitter.namespaceExports, componentNames: emitter.componentNames, partNames, renderPairs: emitter.renderPairs, kinds: emitter.kinds };
}

// Import delivery: one unit per runtime. The specifier is the module's
// file path (decoded: a URL pathname escapes spaces and non-ASCII).
// Under the face it resolves to the declaration beside each runtime,
// generated from the same face types (`bun run decls`).
const importUnits = (active) =>
  active.map((rt) => ({ runtimes: [rt], names: rt.names, imp: decodeURIComponent(rt.url.pathname) }));

// Inline delivery fuses a dependent runtime's body INTO its dependency's
// IIFE — the bodies share one scope (the fragment model), and the fused
// unit binds the union of names (on the TS face it states the union of
// their face types: tsRuntimeUnitTypes).
function inlineUnits(active) {
  const units = [];
  const fused = new Set(active.flatMap((rt) => runtimeRequires(rt)));
  for (const rt of active) {
    if (fused.has(rt.key)) continue;
    // Dependency-first, deduped: a body may only reference names its
    // dependencies already bound, so order is load-bearing.
    const chain = [];
    const visit = (r) => {
      if (chain.includes(r)) return;
      for (const key of runtimeRequires(r)) {
        const dep = RUNTIME_TABLE.find((d) => d.key === key);
        if (dep) visit(dep);
      }
      chain.push(r);
    };
    visit(rt);
    if (chain.length === 1) {
      units.push({ runtimes: [rt], names: rt.names, body: runtimeText(rt) });
      continue;
    }
    units.push({
      runtimes: chain,
      names: chain.flatMap((r) => r.names),
      body: chain.map((r) => runtimeText(r)).join('\n'),
    });
  }
  return units;
}

// One delivery unit's injection: the names it binds that the program
// does not (a generated name always binds, under its minted alias).
function emitRuntimeUnit(emitter, builder, programId, unit, bound) {
  const generated = new Set(unit.runtimes.flatMap((rt) => rt.generatedNames ?? []));
  const slots = unit.names
    .filter((name) => generated.has(name) || !bound.has(name))
    .map((name) => ({ name, local: generated.has(name) ? emitter.runtimeAliases.get(name) : name }));
  if (slots.length === 0) return;
  for (const { name } of slots) {
    emitter.injected.set(name, unit.runtimes.find((r) => r.names.includes(name)).key);
  }
  const start = builder.offset;
  if (unit.imp) {
    builder.emit(`import { ${slots.map(({ name, local }) => name === local ? name : `${name} as ${local}`).join(', ')} } from `);
    const specStart = builder.offset;
    builder.emit(JSON.stringify(unit.imp));
    emitter.importSpans.push({ start: specStart, end: builder.offset, specifier: JSON.stringify(unit.imp) });
    builder.emit(';\n');
    emitter.runtimeImports.push([start, builder.offset]);
  } else {
    const types = emitter.tsRuntimeUnitTypes(unit, slots);
    builder.emit(`const { ${slots.map(({ name, local }) => name === local ? name : `${name}: ${local}`).join(', ')} }`);
    builder.emit(' = ');
    if (types) builder.tsOnly(() => builder.emit('('));
    builder.emit(`(() => {\n${unit.body}\nreturn { ${unit.names.join(', ')} };\n})()`);
    if (types) builder.tsOnly(() => builder.emit(` as ${types})`));
    builder.emit(';\n');
  }
  builder.syntheticRow(programId, 'runtime', start);
}

// Pin candidates for the editor's probe pass: still-hoisted names whose
// nested references break TS's evolving inference (TS7034). Each carries
// its cache key (`${name}@${valueHash}` — stable across offset shifts),
// plus the GENERATED spans the probe builder splices with: the
// first-write statement's extent and its value expression.
function pinnableRecords(emitter, builder, stores) {
  const pinnables = [];
  for (const { name, node, path, key } of emitter.pinnables) {
    if (key === null) continue;
    const id = stores.idOf(node);
    if (id === null) continue;
    const stmtRow = builder.rows.find((r) => r.nodeId === id && r.role === '$self');
    const valueRow = builder.rows.find((r) => r.nodeId === id && r.role === 'value');
    if (!stmtRow || !valueRow) continue;
    pinnables.push({
      name,
      key,
      path: path ?? '',
      stmtGen: [stmtRow.generatedStart, stmtRow.generatedEnd],
      valueGen: [valueRow.generatedStart, valueRow.generatedEnd],
    });
  }
  return pinnables;
}
