// The emitter's entry: assembles Emitter from its area modules, then owns
// emit() — option normalization (ambientBindings), the result shape
// ({code, mappings, stores, bindings, ...}), delivery decisions and the
// public re-exports (runtime table, face helpers, shape helpers). The
// per-construct lowerings live in the area modules beside this file; the
// class itself and the statement/expression dispatch live in core.js.
//
// Every character is written THROUGH a MappingBuilder (src/emit/mapping.js)
// so each emitted node and role gains exact MappingStore rows when asked
// for. The emitter never replaces AST arrays: it only reads the tree, so
// every WeakMap nodeId join stays live.
import { Stores } from '../stores.js';
import { MappingBuilder } from './mapping.js';
import { buildSchemaTypeStory, isModuleShaped, SchemaTypeError } from '../ts/schema.js';
import { isIdentifierName } from '../ident.js';
import { isNode, wordOf } from '../sexpr.js';
import { domSurfaceDecls } from '../ts/dom-types.js';
import { analyze } from './analyze.js';
import { runtimeRequires, faceRuntimeType, faceClassDecls } from './runtimes.js';
import { PATTERN_LITERALS } from './helpers.js';
import { restAliasName, restPassthroughText, routeArgType } from '../ts/components.js';
import { Emitter } from './core.js';
import { RUNTIME_TABLE, runtimeText } from './delivery.js';
import { ReactiveMethods } from './reactive.js';
import { FaceMethods } from './face.js';
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
export { stripFace } from './face.js';
export { faceRuntimeType as _faceRuntimeType, faceClassDecls as _faceClassDecls };

// Each area's carrier class lends its members to Emitter: instance members
// onto the prototype, statics onto the class. A carrier holds members only —
// state an instance field or constructor would add, or a static that
// shadows the class's own name/length, has nowhere to go, so it rejects at
// load; so does a name two areas define.
const AREAS = [ReactiveMethods, FaceMethods, ScopeMethods, ModuleMethods, SchemaMethods, ControlMethods, MatchMethods, LoopMethods, ValueMethods, AssignMethods, ComponentMethods, RenderMethods, RenderDynamicMethods, ChainMethods, OperatorMethods, LiteralMethods, ClassMethods, FunctionMethods];
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
  if (face !== 'js' && face !== 'ts') {
    throw new Error(`emitter: unknown face '${face}' — expected 'js' (the shipping emission) or 'ts' (the editor face)`);
  }
  if (runtimeDelivery !== 'none' && runtimeDelivery !== 'import' && runtimeDelivery !== 'inline') {
    throw new Error(`emitter: unknown runtimeDelivery '${runtimeDelivery}' — expected 'none', 'import', or 'inline'`);
  }
  const ambient = normalizeAmbient(ambientBindings);
  const program = parseResult.sexpr;
  const stores = new Stores(parseResult.stores);
  const programId = stores.idOf(program);
  // The program's binding facts, its delivery decision and its scope
  // rejections, from one walk of the parser's tree. An hmr build exports
  // the component table under the renderer's contract: no module-scope
  // declaring form or write may claim it.
  const reserved = hmr && modulePath ? [{ name: '__hmrComponents', kind: 'the HMR component table' }] : [];
  const facts = analyze(parseResult, { source, face, ambientBindings: ambient, repl, stores, dataLine, reserved });
  // The editor face always maps: its consumers read the rows.
  const builder = new MappingBuilder(stores, source, { record: mappings || face === 'ts', claims: face === 'ts' });
  const emitter = new Emitter(stores, builder, { face, pins, strict, script, browserModule, repl, hmr, tolerant, modulePath, appStashSpec, routesUnion, routeParams });
  emitter.useAnalysis(facts);
  emitter.dataPayload = dataPayload;

  emitter.collectSourceChannels(parseResult.tokens ?? [], parseResult.trivia ?? []);
  // TS directive comments: pair each whole-line `# @ts-…` comment from
  // the trivia channel with the statement it governs.
  emitter.collectTsDirectives(program, parseResult.trivia ?? [], source);
  emitter.typeOnlyImports = facts.typeOnlyImports;
  emitter.appAccessors = facts.appAccessors;
  emitter.collectValidatorRegistrations(program);
  // The file-level `@ts-nocheck` emits as the face's FIRST line — ahead
  // of any runtime injection — since TypeScript honors it only before
  // all code.
  if (emitter.tsNocheck !== null) {
    const t = emitter.tsNocheck;
    builder.tsOnly(() => {
      const line = () => builder.emit('//' + t.text.slice(1));
      if (programId !== null) builder.markSpan(programId, 'tsDirective', t.start, t.end, line);
      else line();
      builder.emit('\n');
    });
  }

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
    for (const unit of units) emitRuntimeUnit(emitter, builder, programId, unit, bound, face);
  }

  if (face === 'ts') emitSchemaStory(emitter, builder, stores, programId, program);

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
  rejectUnplacedSchemas(emitter);

  if (face === 'ts') {
    const stashLocal = stashLocalOf(program);
    if (stashLocal !== null) emitStashType(emitter, builder, stores, program, stashLocal);
  }
  emitHelperDecls(emitter, builder, face);
  const globalDecls = face === 'ts' ? globalInstalls(program) : [];
  if (globalDecls.length) emitGlobalDecls(builder, globalDecls);
  // The module marker: the loader runs every .rip file as a Bun
  // ES module, so a face whose own syntax carries no import/export
  // must not present as a global SCRIPT — script-ness misrepresents
  // runtime semantics, and two such faces in one tsgo program
  // redeclare every shared top-level name (TS2451) and duplicate the
  // schema intrinsic aliases (TS2300): false diagnostics no runtime
  // collision backs. A TS-only `export {}` makes each face a module;
  // stripping it reproduces the JS emission exactly.
  if (face === 'ts' && !isModuleShaped(program, (s) => emitter.isModuleImport(s))) {
    builder.tsOnly(() => builder.emit('\nexport {};\n'));
  }
  // The exported objects whose every value is one of this module's own
  // components — the qualifiers an importer's tag constructs through.
  const partNames = emitter.exportedObjects
    .filter(([, values]) => values.every((value) => emitter.componentNames.includes(value)))
    .map(([name]) => name);
  const pinnables = pinnableRecords(emitter, builder, stores);
  return { code: builder.code, mappings: builder.rows, runtimeImports: emitter.runtimeImports, vocabulary: emitter.vocabulary, silences: emitter.silences, memberDecls: emitter.memberDecls, narrowedDecls: emitter.narrowedDecls, importedRefs: emitter.importedRefs, runtimeRefs: emitter.runtimeRefs, stores, runtimes, bindings, bindingNames, replResultName: emitter.replResultName, replImportResolver: emitter.replImportResolver, tsRegions: builder.tsRegions, echoSpans: builder.echoSpans, globalDecls: globalDecls.map((g) => g.name), pinnables, mutables: emitter.mutables, classDecls: emitter.classDecls, pinSpans: emitter.pinSpans, loopVars: emitter.loopVars, readLoopVarDecls: emitter.loopVarDecls.filter((d) => d.owner.readVars.has(d.which)).map((d) => d.span), attrNames: emitter.attrNames, routeWraps: emitter.routeWrapSpans, sourceKeys: emitter.sourceKeySpans, stashMembers: emitter.stashMemberSpans, stashKeys: emitter.stashKeys ?? null, memberInits: emitter.memberInitSites, imports: emitter.importSpans, intrinsics: emitter.intrinsics, indexedLoops: emitter.indexedLoops, componentUses: emitter.componentUses, componentProps: emitter.componentProps, namespaceExports: emitter.namespaceExports, componentNames: emitter.componentNames, partNames, renderPairs: emitter.renderPairs, kinds: emitter.kinds };
}

// Injected text with no source records ONE synthetic row — a zero-width
// source anchor at the program's start: reverse lookups see it, and it
// never serializes into the source map.
function syntheticRow(builder, programId, role, generatedStart) {
  if (programId === null || !builder.record) return;
  builder.rows.push({
    nodeId: programId, role, mappingKind: 'synthetic',
    sourceStart: 0, sourceEnd: 0,
    generatedStart, generatedEnd: builder.offset,
    fileId: 0,
  });
}

// Import delivery: one unit per runtime. The specifier is the module's
// file path (decoded: a URL pathname escapes spaces and non-ASCII).
// Under the face it resolves to the declaration beside each runtime,
// generated from these same `types` (`bun run decls`); the unit carries
// `types` so each reference records whether it is typed.
const importUnits = (active) =>
  active.map((rt) => ({ runtimes: [rt], names: rt.names, imp: decodeURIComponent(rt.url.pathname), types: rt.types }));

// Inline delivery fuses a dependent runtime's body INTO its dependency's
// IIFE — the bodies share one scope (the fragment model), and the fused
// unit binds the union of names and states the union of their face types
// (a fused unit's destructure carries its dependency's signatures: a
// component-carrying file's `__state`/`__computed` stay generic, so every
// member initializer checks against the member's declared type).
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
      units.push({ runtimes: [rt], names: rt.names, body: runtimeText(rt), types: rt.types, decls: rt.decls });
      continue;
    }
    // A fused unit states the union of its runtimes' face types — and
    // only when one of them HAS a table: the assertion types every bound
    // name, so an empty union would flatten names that infer honestly
    // through the IIFE to `any`. Its alias declarations join the same way.
    units.push({
      runtimes: chain,
      names: chain.flatMap((r) => r.names),
      body: chain.map((r) => runtimeText(r)).join('\n'),
      types: chain.some((r) => r.types) ? Object.assign({}, ...chain.map((r) => r.types)) : undefined,
      decls: chain.some((r) => r.decls) ? chain.filter((r) => r.decls).map((r) => r.decls).join('\n') : undefined,
    });
  }
  return units;
}

// One delivery unit's injection: the names it binds that the program
// does not (a generated name always binds, under its minted alias).
function emitRuntimeUnit(emitter, builder, programId, unit, bound, face) {
  const generated = new Set(unit.runtimes.flatMap((rt) => rt.generatedNames ?? []));
  const slots = unit.names
    .filter((name) => generated.has(name) || !bound.has(name))
    .map((name) => ({ name, local: generated.has(name) ? emitter.runtimeAliases.get(name) : name }));
  if (slots.length === 0) return;
  for (const { name } of slots) {
    const rt = unit.runtimes.find((r) => r.names.includes(name));
    const signature = unit.types?.[name];
    emitter.injected.set(name, { runtime: rt.key, typed: signature !== undefined && signature !== 'any' });
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
    // The aliases the assertion's signatures reference, declared ahead
    // of it under the unit's own synthetic row (declarations hoist, so
    // the position serves the row, not the checker).
    if (face === 'ts' && unit.types) {
      const decls = [unit.decls, faceClassDecls(unit.types)].filter(Boolean).join('\n');
      if (decls !== '') builder.tsOnly(() => builder.emit(`${decls}\n`));
      if (decls.includes('__RipCSSProperties')) emitter._needsCssProperties = true;
    }
    builder.emit(`const { ${slots.map(({ name, local }) => name === local ? name : `${name}: ${local}`).join(', ')} }`);
    // Precise runtime types on the TS face (the table's signatures): the
    // checker reads the declared shapes instead of inferring through the
    // IIFE. Stated as an ASSERTION on the injected value, not as a
    // destructure annotation — an annotation is checked against the
    // body, and the body is vendored JS whose inferred shapes are not
    // the contract, so one unprovable signature would reject the whole
    // declaration and hand every bound name an error type. It must also
    // state EVERY name the pattern binds; a name the table does not type
    // rides as `any`, which is what inferring through the IIFE gave it.
    // Members key by the runtime's OWN name, never the alias a colliding
    // user binding mints — the assertion describes the object the
    // pattern reads from, not the names it binds.
    const types = face === 'ts' && unit.types
      ? `{ ${slots.map(({ name }) => `${name}: ${faceRuntimeType(name, unit.types[name] ?? 'any', unit.types)}`).join('; ')} }`
      : null;
    // A signature in the assertion may reference a face-declared alias;
    // the tail emission arms it (declarations hoist, so the tail governs
    // this earlier position).
    if (types !== null && types.includes('__RipClassValue')) emitter._needsClassValue = true;
    if (types !== null && types.includes('__RipCSSProperties')) emitter._needsCssProperties = true;
    builder.emit(' = ');
    if (types) builder.tsOnly(() => builder.emit('('));
    builder.emit(`(() => {\n${unit.body}\nreturn { ${unit.names.join(', ')} };\n})()`);
    if (types) builder.tsOnly(() => builder.emit(` as ${types})`));
    builder.emit(';\n');
  }
  syntheticRow(builder, programId, 'runtime', start);
}

// The schema type story (face only), built once per module: the
// intrinsic block emits at the top as ONE TS-only region with a
// synthetic mapping row (injected text with no source), each schema's
// alias lines emit as TS-only cover manifestations of THEIR schema node
// (a diagnostic landing in an alias line cover-lands on the declaration
// that produced it), and schemaExpr reads the per-node story for the
// binding cast and the callable `this` parameters. TS type declarations
// hoist within their scope: the module's aliases emit here, at the top,
// and a function scope's aliases emit at that function's top
// (placeSchemaScope), where the names they declare are the ones its
// casts and annotations spell. Collisions on the emitted type names
// reject positioned.
function emitSchemaStory(emitter, builder, stores, programId, program) {
  let story;
  try {
    story = buildSchemaTypeStory(program, builder.source,
      Emitter.importedNames(program.slice(2).filter((s) => emitter.isModuleImport(s))),
      { boundary: (n) => emitter.scopeBoundary(n), isBlock: (n) => emitter.isBlock(n) }, program);
  } catch (err) {
    if (!(err instanceof SchemaTypeError)) throw err;
    const e = new Error(`emitter: ${err.message}`);
    // A user-declaration offender positions through its node's store
    // span; descriptor-sourced offenders carry the offset.
    const id = err.node !== null ? stores.idOf(err.node) : null;
    const span = id !== null ? stores.selfSpan(id) : null;
    if (span) {
      e.start = span[0];
      e.end = span[1];
    } else if (err.start !== null) {
      e.start = err.start;
      e.end = err.start;
    }
    throw e;
  }
  if (story === null) return;
  const start = builder.offset;
  builder.tsOnly(() => builder.emit(story.intrinsicLines.join('\n') + '\n'));
  syntheticRow(builder, programId, 'schemaTypes', start);
  emitter.schemaStories = new Map();
  emitter.schemaModuleStories = story.stories;
  // A function scope's stories join the per-node map now — the cast and
  // the behavior object read it at the declaration — and its alias lines
  // wait for the scope's top. The scope is found again by any of its
  // body's own statement nodes (`keys`).
  emitter.schemaScopes = new Map();
  emitter.schemaScopeRecords = story.scopes.map((scope) => {
    const record = { stories: scope.stories, placed: false };
    for (const s of scope.stories) {
      s.scope = record;
      emitter.schemaStories.set(s.decl.node, s);
    }
    for (const k of scope.keys) emitter.schemaScopes.set(k, record);
    return record;
  });
  // A derived binding contributes an alias and nothing else, so it joins
  // the same block on the same terms — marked under its own assignment,
  // and the LAST block of either kind carries the separator before the
  // program's first line.
  const blocks = [
    ...story.stories.map((s) => ({ node: s.decl.node, exported: s.decl.exported, story: s,
                                   lines: s.faceAliasLines ?? s.aliasLines })),
    ...story.derivations.map((d) => ({ node: d.decl.node, exported: d.decl.exported, story: null,
                                      lines: d.aliasLines })),
  ];
  blocks.forEach((b, i) => {
    if (b.story !== null) emitter.schemaStories.set(b.node, b.story);
    emitter.emitSchemaAliasBlock(b, b.exported ? 'export ' : '', '', i === blocks.length - 1 ? '\n\n' : '\n');
  });
  // A module whose only schemas are function-local emits the intrinsic
  // block alone; the blank line the last alias block otherwise carries
  // still separates it from the program.
  if (blocks.length === 0) builder.tsOnly(() => builder.emit('\n'));
}

function rejectUnplacedSchemas(emitter) {
  // Every function scope's aliases were placed: a function form whose
  // emission reaches neither emitTsTypeDecls nor a statement-list seam
  // would otherwise leave a cast naming a type the face never declares —
  // an emitter defect, reported at the declaration rather than as a
  // checker error.
  for (const record of emitter.schemaScopeRecords ?? []) {
    if (record.placed) continue;
    throw emitter.positionedError(record.stories[0].decl.node,
      `emitter: the schema declaration '${record.stories[0].decl.name}' sits in a function form whose top the alias placement never reached`);
  }
  // Every behavior object owed was placed. The one declaration form with
  // none to follow is a declaration that is not a statement of its own
  // (`y = X = schema …`, an argument): its callable members' types would
  // name a const the face never declares.
  for (const [node, story] of emitter.schemaBehaviorPending) {
    throw emitter.positionedError(node,
      `emitter: the schema declaration '${story.decl.name}' declares callable members but is not a statement of its own, ` +
      'so its behavior object has no statement to follow — declare it on its own line');
  }
}

// The local binding a module exports as `stash` — the framework contract
// launch reads — or null. Every export spelling that names a LOCAL
// binding counts — `export stash = …`, `export { stash }`,
// `export { thing as stash }` (the local half) — while a re-export
// (`export … from`) carries no local binding and is excluded by its own
// head.
function stashLocalOf(program) {
  for (let i = 2; i < program.length; i++) {
    const s = program[i];
    if (!isNode(s) || s[0] !== 'export') continue;
    const decl = s[2];
    if (isNode(decl)) {
      if (decl[0] === '=' && decl[1].void !== true && wordOf(decl[2]) === 'stash') return 'stash';
      continue;
    }
    // A specifier list holds only names and ["as", {}, local, exported]
    // pairs.
    const specList = decl.every((x) => {
      const w = wordOf(x);
      return w !== undefined ? isIdentifierName(w)
        : x[0] === 'as' && wordOf(x[2]) !== undefined && wordOf(x[3]) !== undefined;
    });
    if (!specList) continue;
    for (const spec of decl) {
      if (wordOf(spec) === 'stash') return 'stash';
      if (spec[0] === 'as' && wordOf(spec[3]) === 'stash') return wordOf(spec[2]);
    }
  }
  return null;
}

// A stash module carries its own type on the face, so a component's
// `app` ambience can splice it by specifier
// (`import('<rel>').__RipStash`) without the component importing
// anything. TS-only THROUGH THE RECORDED REGION: the strip gate (TS face
// minus regions === JS face) must hold on stash modules too.
function emitStashType(emitter, builder, stores, program, stashLocal) {
  emitter.stashKeys = Emitter.stashKeysOf(program, stashLocal);
  builder.tsOnly(() => {
    // `typeof stash` repeats the stash binding's name; the copy marks the
    // binding's own declaration bytes, so a rename reaches it.
    const decl = /^(?:export\s+)?(stash)\s*=/m.exec(builder.source ?? '');
    const rootId = decl !== null ? stores.idOf(program) : null;
    builder.emit('\nexport type __RipStash = typeof ');
    if (rootId !== null) builder.markSpan(rootId, 'identifier', decl.index + decl[0].indexOf('stash'), decl.index + decl[0].indexOf('stash') + 5, () => builder.emit(stashLocal));
    else builder.emit(stashLocal);
    builder.emit(';\n');
  });
}

// The face's module-scope helper declarations, each emitted ONCE when the
// program needed it. Declarations hoist, so the tail placement governs
// every earlier use. TS-only through the recorded region.
function emitHelperDecls(emitter, builder, face) {
  // Ambient `RoutePath` — the route union under a clean public name, so
  // app code can annotate data-driven hrefs (a nav array, props
  // forwarded to an anchor) without reaching any internal spelling.
  // Injected only when this module REFERENCES the name and neither
  // declares nor imports its own — a user-defined `RoutePath` always
  // wins, so no duplicate-identifier clash is possible. The tests run
  // against the GENERATED face, where a multi-line import list has been
  // flattened to one statement, so the line-bounded import regex sees
  // every spelling; the face's own emissions never introduce the name.
  if (face === 'ts' && emitter.routesUnion !== null) {
    const faceText = builder.code;
    if (/\bRoutePath\b/.test(faceText)
        && !/\b(?:type|interface)\s+RoutePath\b/.test(faceText)
        && !/\bimport\b[^;\n]*\bRoutePath\b/.test(faceText)) {
      builder.tsOnly(() => builder.emit(`\ntype RoutePath = ${emitter.routesUnion};\n`));
    }
  }
  // The ambience helper, where every class that emitted
  // `stash = __ripAmbientStash(...)` can reach it (nested and
  // expression-valued components included). Named apart from the
  // runtime's `globalThis.__ripStash` so the face never shadows the
  // launch global's name.
  if (emitter._needsAmbienceHelper === true) {
    builder.tsOnly(() => builder.emit('\ndeclare function __ripAmbientStash<T>(v: T): T;\n'));
  }
  // The route helper, for every `__ripRoute(...)` wrap. The parameter
  // type is the router surface's (routeArgType), the union INLINED, not
  // aliased: the error and the hover then read as the actual list of
  // routes instead of a helper's name. The `const T` keeps a literal
  // argument literal, so a typo reports against the union rather than
  // widening to `string` and passing.
  if (emitter._needsRouteHelper === true) {
    builder.tsOnly(() => builder.emit(`\ndeclare function __ripRoute<const T extends string>(s: ${routeArgType(emitter.routesUnion, 'T')}): T;\n`));
  }
  // The intrinsic-element surfaces (src/ts/dom-types.js): exactly the
  // per-tag interfaces this module's receiver casts named, plus the
  // shared helpers/bases they read, the __RipClassValue alias when the
  // runtime types assertion referenced it, and the __ripRefCell
  // declares when a ref wrap emitted.
  if (face === 'ts' && (emitter.domSurfaces.size > 0 || emitter._needsClassValue === true || emitter._needsCssProperties === true || emitter._needsRefCellHelper === true || emitter._needsChildren === true || emitter._restTags.size > 0)) {
    const surfaceText = domSurfaceDecls(emitter.domSurfaces.values(), {
      needsClassValue: emitter._needsClassValue === true,
      needsCssProperties: emitter._needsCssProperties === true,
      needsRefCell: emitter._needsRefCellHelper === true,
      needsChildren: emitter._needsChildren === true,
      // One `__RipRest_<tag>` alias per extends tag the module uses.
      extra: [...emitter._restTags].sort().map((t) => `type ${restAliasName(t)} = ${restPassthroughText(t, 'face')};`),
    });
    if (surfaceText !== '') builder.tsOnly(() => builder.emit(surfaceText));
  }
  // The stash-key helpers — the strict source() constraint: a top-level
  // stash key, or a DOTTED path under one (legal, untyped at the package
  // surface). Spelled off the stash splice so it tracks the stash by
  // reference, never by copied text.
  if (emitter._needsMemberKeyHelper === true) {
    builder.tsOnly(() => builder.emit('\ndeclare function __ripMemberKey<C>(): <K>(k: [C] extends [readonly unknown[] | string] ? K : K & PropertyKey) => PropertyKey;\n'));
  }
  if (emitter._needsSourceKeyHelper === true) {
    const stashKeys = `keyof import(${JSON.stringify(emitter.appStashSpec)}).__RipStash & string`;
    builder.tsOnly(() => builder.emit(`\ndeclare function __ripSourceKey<const T extends ((${stashKeys}) | \`\${${stashKeys}}.\${string}\`)>(s: T): T;\n`));
  }
  if (face === 'ts' && emitter.validatorRegistrations.length > 0) {
    const entries = emitter.validatorRegistrations
      .map(([name, fn]) => `${JSON.stringify(name)}: Exclude<ReturnType<typeof ${fn}>, null | undefined>;`).join(' ');
    builder.tsOnly(() => builder.emit(`\ndeclare module 'rip/validate' { interface Validated { ${entries} } }\n`));
  }
  // The indexed-loop helper (indexedReader). The constraint admits what
  // `.length` and `[i]` genuinely index: a type the checker cannot see
  // into (`never`, `any`, `unknown`), a nullish arm (the checker's own
  // complaint stands), an iterable (arrays, tuples, strings, typed
  // arrays, collections — a Map's missing `length` is still the
  // checker's own report), and an array-like with a numeric length that
  // is not a string index signature answering for one. A refused
  // argument yields `ArrayLike<any>`, so the header's `.length` and the
  // body's `[i]` draw no second complaint about the same loop.
  if (emitter._needsIndexedHelper === true) {
    builder.tsOnly(() => builder.emit('\ndeclare function __ripIndexed<T>(xs: T & __RipIndexed<T>): [T] extends [never] ? T : [__RipIndexed<T>] extends [never] ? ArrayLike<any> : T;\ntype __RipIndexed<T> = [T] extends [never] ? T : unknown extends T ? T : T extends null | undefined ? T : T extends Iterable<unknown> ? T : T extends { readonly length: number } ? (string extends keyof T ? never : T) : never;\n'));
  }
  // The narrowing assertion — an assertion signature over the condition
  // itself, so each `__ripNarrow(claim)` a block's function body opens
  // with narrows the claim's reads by control flow exactly as the tested
  // `if` would: a chain to its truthy part, a discriminant equality to
  // its arm.
  if (emitter._needsNarrowHelper === true) {
    builder.tsOnly(() => builder.emit('\ndeclare function __ripNarrow(c: unknown): asserts c;\n'));
  }
  // The narrowed-container helper: a cell with the null dropped from its
  // value — what a child's required prop admits under a branch that
  // tested the member. A plain cell shape, not an intersection with the
  // argument: the editor's presenters collapse a cell to its value and
  // pass any other shape through raw.
  if (emitter._needsNarrowedHelper === true) {
    builder.tsOnly(() => builder.emit('\ndeclare function __ripNarrowed<T extends { value: unknown }>(c: T): { readonly value: NonNullable<T[\'value\']>; read(): NonNullable<T[\'value\']> };\n'));
  }
}

// A top-level `globalThis.NAME ??= expr` DECLARES the global. The
// spelling is the boundary: `??=` says "install unless someone already
// did", which is a declaration wearing runtime clothes — DSL vocabulary
// like stamp's `sh`/`ok`/`run`, whose handlers import nothing by design.
// Plain `=` stays meaningless here on purpose (a test overwriting
// `globalThis.fetch` must not redeclare the host's fetch), and a
// non-top-level install is lifecycle state, not vocabulary (an app's
// guarded `__ripStash`, deleted on destroy, must not be declared
// ever-present). An identifier initializer declares `typeof` it — the
// module binding is lexically visible inside `declare global` — and any
// other initializer, a keyword literal included, declares `any`.
function globalInstalls(program) {
  const installs = [];
  for (let i = 2; i < program.length; i++) {
    const stmt = program[i];
    if (!isNode(stmt) || stmt[0] !== '??=' || stmt.length !== 4) continue;
    const target = stmt[2];
    if (!isNode(target) || target[0] !== '.' || wordOf(target[2]) !== 'globalThis') continue;
    const name = wordOf(target[3]);
    if (name === undefined || !isIdentifierName(name)) continue;
    const v = wordOf(stmt[3]);
    installs.push({ name, anchor: v !== undefined && isIdentifierName(v) && !PATTERN_LITERALS.has(v) ? v : null });
  }
  return installs;
}

// The block is TS-only, so the strip gate holds byte identity; `declare
// global` requires module shape, which the module marker guarantees for
// bare files. The type rides a MODULE-LEVEL alias: inside `declare
// global` the bare name resolves to the global being declared (TS2502),
// so `typeof sh` must be taken where `sh` still means the module binding
// and carried in by alias.
function emitGlobalDecls(builder, installs) {
  builder.tsOnly(() => {
    for (const g of installs) {
      if (g.anchor !== null) builder.emit(`\ntype __ripGlobal_${g.name} = typeof ${g.anchor};`);
    }
    builder.emit('\ndeclare global {');
    for (const g of installs) {
      builder.emit(`\n  var ${g.name}: ${g.anchor === null ? 'any' : `__ripGlobal_${g.name}`};`);
    }
    builder.emit('\n}\n');
  });
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
