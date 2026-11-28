// The TS face (the editor face): TsEmitter, the Emitter that emit()
// constructs for face 'ts', with the component face and TS directive
// placement.
//
// Nothing below adds to the JS emission: the TS face emits the SAME
// code through the SAME mark protocol, plus TypeScript type syntax
// whose every byte records as a builder tsOnly region.
// Annotation text always renders from the RECORDED store spans (annotation
// side-band roles) or the lexer's opaque TYPE_DECL/typed-var values —
// never re-derived, never invented.
//
// The shared lowerings reach this file only through the face seam
// (src/emit/hooks.js, whose members TsEmitter overrides) and through
// TS-only members they call under a `this.ts` test. The JS face never
// loads it: the browser build, which emits JS alone, replaces it with a
// module whose TsEmitter rejects construction.

import { behaviorObjectText } from '../schema.js';
import { IDENT_PART, IDENT_SOURCE, IDENT_RE, identifierMatches, isIdentifierName } from '../ident.js';
import { TypeTextError, tidyType, renderTypeDecl, renderParams, optionalReader, jsArityOptional } from '../ts/types.js';
import { DOM_EVENTS, SVG_ONLY_TAGS, TEMPLATE_TAGS } from '../dom.js';
import { attrValsName, domSurfaceDecls, elSurfaceName, hostText, surfaceableTag } from '../ts/dom-types.js';
import { buildSchemaTypeStory, isModuleShaped, SchemaTypeError } from '../ts/schema.js';
import { RUNTIME_TYPES, faceRuntimeType, faceClassDecls } from '../ts/runtime-types.js';
import { restAliasName, restOfComponentText, restViewOfComponentText, memberDeclareSegments, isDeclarableMember, ambientClassDeclares, OFFERS, offersRecordText, HOST, hostTypeText, propsTypeSegments, propsParamOptional, instanceTypeLines, restContainerType, runtimeApiDeclares, selfArgsOf, anyArgsOf, restPassthroughText, routeArgType, declaresContainer, componentCtorSegments, componentCtorMembers, componentTypeInfo, containerType, gateProjection, hookParamTypes, MINTED, plainBehaviorValued, propsTypeText, publicProps, readonlyCastType, stateBehaviorValued, syntacticLiteralType } from '../ts/components.js';
import { isCall, isNode, isNone, isStruct, wordOf } from '../sexpr.js';
import { PATTERN_LITERALS, typeIdentifierTokens } from './helpers.js';
import { atParamField, chainLeaves, ctorAtFields, importedNames, isValuePair, isTypedWrapper, thisField } from './tree.js';
import { Emitter } from './core.js';
import { referencesNames } from './walks.js';
import { SCHEMA_BODY_KINDS, schemaBodyReference } from './schema.js';

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The start of the last whole-word occurrence of `name` in `src` that
// begins before `from`, or -1.
function wordStartBefore(src, name, from) {
  while (from > 0) {
    const i = src.lastIndexOf(name, from - 1);
    if (i < 0) break;
    if (!IDENT_PART.test(src[i - 1] ?? ' ') && !IDENT_PART.test(src[i + name.length] ?? ' ')) return i;
    from = i;
  }
  return -1;
}

// Where an entry's schema reference sits in the alias text `text`: a
// union constituent or a mixin target follows its operator (`= A | B`,
// `& M`), which keeps it apart from a same-named member; a relation
// target is the accessor's return type (`partner(…): Promise<Partner |
// null>`, `orders(…): Promise<Order[]>`), matched through the accessor
// so two relations to one schema each find their own. Null when the
// entry names no schema or the text carries no reference for it (an
// unknown target renders `unknown`).
function schemaReferenceIn(e, text) {
  const ref = e.tag === 'union-member' && typeof e.start === 'number' ? { name: e.name, start: e.start, accessor: null } : schemaBodyReference(e);
  if (ref === null) return null;
  const pattern = ref.accessor === null
    ? `(?:= |\\| |& )(${escapeRegExp(ref.name)})(?= \\||;| &)`
    : `(?:\\{ |; )${escapeRegExp(ref.accessor)}\\([^)]*\\): Promise<(${escapeRegExp(ref.name)})(?=\\[\\]>| \\| null>)`;
  const m = new RegExp(pattern, 'd').exec(text);
  if (m === null) return null;
  return { name: ref.name, start: ref.start, at: m.indices[1][0] };
}

// The alias text, emitted in slices so the names it declares MAP: the
// alias head (`type Person =`) marks the schema's own declaration name,
// and each member (`{ name: T`, `; name?: T`), on every line that
// carries it, marks its entry's span — so a definition or a rename from
// a use lands on the schema body rather than dropping on generated-only
// bytes. The member's first slice position is the one recordSchemaFields
// reads for the hover record, computed the same way, so the two never
// disagree about where a name sits.
function emitSchemaTextMarked(emitter, block, text, nodeId) {
  const marks = [];
  for (const e of block.story?.decl?.descriptor?.entries ?? []) {
    // A schema NAMED in the body — a union's constituent, an `@mixin`
    // target, a relation's target — is a copy of that schema's name,
    // and marks the word the author wrote for it.
    const ref = schemaReferenceIn(e, text);
    if (ref !== null) marks.push({ at: ref.at, len: ref.name.length, start: ref.start, end: ref.start + ref.name.length });
    if ((SCHEMA_BODY_KINDS[e.tag] ?? null) === null || typeof e.start !== 'number') continue;
    // A field whose type names another schema (`hops: [Hop]`) repeats
    // that name in the member's type; the copy marks the author's type
    // word.
    const typeWord = e.tag === 'field' && Array.isArray(e.typeSpan) && emitter.b.source !== null
      ? IDENT_RE.exec(emitter.b.source.slice(e.typeSpan[0], e.typeSpan[1]))
      : null;
    // The member recurs on every companion line (`ThingData`,
    // `ThingCreate`): each copy marks the entry, so none is left for the
    // module-wide copy pass below to answer with some other span of the
    // same spelling.
    for (const m of text.matchAll(new RegExp(`([{;] )((?:readonly )?)(${escapeRegExp(e.name)})(\\??: )`, 'g'))) {
      marks.push({ at: m.index + m[1].length + m[2].length, len: e.name.length, start: e.start, end: e.start + e.name.length });
      if (typeWord === null) continue;
      const after = m.index + m[0].length;
      const stop = text.indexOf(';', after) < 0 ? text.length : text.indexOf(';', after) + 1;
      const tm = new RegExp(`(?<!${IDENT_PART.source})${escapeRegExp(typeWord[0])}(?!${IDENT_PART.source})`).exec(text.slice(after, stop));
      if (tm !== null) marks.push({ at: after + tm.index, len: typeWord[0].length, start: e.typeSpan[0] + typeWord.index, end: e.typeSpan[0] + typeWord.index + typeWord[0].length });
    }
  }
  const selfSpan = nodeId !== null ? emitter.stores.selfSpan(nodeId) : null;
  if (selfSpan !== null && emitter.b.source !== null) {
    const src = emitter.b.source;
    // Every DECLARED name these lines spell marks the bytes the author
    // wrote for it — the block's own heads AND the other declarations the
    // lines reach: a field's element type (`items: OrderItem[]`), a
    // relation's target (`Promise<User | null>`), a derived alias's
    // expansion. Each is a copy, so a rename of the declaration must
    // reach it; unmarked, one such copy refuses the whole rename.
    const named = emitter.moduleTypeDeclarationSpans();
    // A function-local schema's own name declares at its binding, not at
    // a line-start match — and a module declaration of the same spelling
    // is the one it shadows, never its own.
    if (block.story?.scope) {
      const own = emitter.bindingNameSpan(block.story.decl.node, 'target', block.story.decl.name);
      if (own !== null) named.set(block.story.decl.name, own.span);
    }
    // The alias head names the schema's binding: its declaration bytes
    // are the nearest whole-word occurrence of the name ahead of the
    // schema expression (`Hop = schema …`). A story may declare several
    // aliases (`type ParcelData = …; type Parcel = ParcelData & …`):
    // each head whose name the source declares marks every whole-word
    // copy of it — the head, a `Promise<Name>` return, a self-reference
    // — to the one declaration span; a minted head (`ParcelData`) has no
    // source occurrence and marks nothing, and a minted
    // `__Name__behavior` is one word to the underscore, not a copy.
    const heads = [...new Set([...text.matchAll(new RegExp(String.raw`(?:^|\n)[ \t]*(?:export )?type (${IDENT_SOURCE})`, 'g'))].map((m) => m[1]))];
    for (const headName of heads) {
      if (named.has(headName)) continue;
      // `+ 1` admits an occurrence starting exactly AT the span (see
      // bindingNameSpan); a MINTED head (`UserData`) has no source
      // occurrence and contributes nothing.
      const nameAt = wordStartBefore(src, headName, selfSpan[0] + 1);
      if (nameAt >= 0) named.set(headName, [nameAt, nameAt + headName.length]);
    }
    // A copy fills in only where nothing already marks: an entry above
    // mapped a USE SITE to the bytes the author wrote there (a field's
    // type word, a union constituent, a mixin target), and that position
    // answers about the use, not about the declaration it names.
    const claimed = (at, len) => marks.some((mk) => at < mk.at + mk.len && mk.at < at + len);
    for (const [name, span] of named) {
      for (const m of text.matchAll(new RegExp(`(?<!${IDENT_PART.source})${escapeRegExp(name)}(?!${IDENT_PART.source})`, 'g'))) {
        if (claimed(m.index, name.length)) continue;
        marks.push({ at: m.index, len: name.length, start: span[0], end: span[1] });
      }
    }
  }
  marks.sort((a, b) => a.at - b.at);
  let cursor = 0;
  for (const mk of marks) {
    if (mk.at < cursor) continue;
    emitter.b.emit(text.slice(cursor, mk.at));
    if (nodeId !== null) emitter.b.markSpan(nodeId, 'identifier', mk.start, mk.end, () => emitter.b.emit(text.slice(mk.at, mk.at + mk.len)));
    else emitter.b.emit(text.slice(mk.at, mk.at + mk.len));
    cursor = mk.at + mk.len;
  }
  emitter.b.emit(text.slice(cursor));
}

// The hover records of the names an alias block declares. `text` is the
// block's alias text as emitted, starting at generated offset `at` — the
// caller hands over the string it just built rather than the face
// re-joining its chunks (a mark is open here, so the builder's `code`
// getter joins the whole output on every read).
function recordSchemaFields(emitter, block, text, at) {
  const entries = block.story?.decl?.descriptor?.entries ?? null;
  if (entries === null) return;
  // A schema NAMED in the body — a union's constituent, an `@mixin`
  // target, a relation's target — reaches the alias as a type
  // reference, so the word answers what any use of the companion type
  // answers: the structural type, expanded.
  for (const e of entries) {
    const ref = schemaReferenceIn(e, text);
    if (ref === null) continue;
    emitter.intrinsics.push({
      start: ref.start, end: ref.start + ref.name.length,
      kind: 'schema', label: null, name: ref.name, gen: at + ref.at,
    });
  }
  for (const e of entries) {
    const label = SCHEMA_BODY_KINDS[e.tag] ?? null;
    if (label === null || typeof e.start !== 'number') continue;
    const name = escapeRegExp(e.name);
    // A member is `{ name: T` or `; name?: T`, with `readonly` ahead of
    // it on a computed one. Matching the opener keeps a field's own
    // member apart from a same-named one in a neighboring alias.
    const m = new RegExp(`([{;] )((?:readonly )?)(${name})(\\??: )`).exec(text);
    if (m === null) continue;
    const nameGen = at + m.index + m[1].length + m[2].length;
    emitter.intrinsics.push({
      start: e.start, end: e.start + e.name.length,
      kind: 'schema', label, name: e.name, gen: nameGen,
      optional: m[4].startsWith('?'),
    });
    if (e.tag === 'field' && e.typeSpan !== null && e.typeSpan !== undefined) {
      emitter.intrinsics.push({
        start: e.typeSpan[0], end: e.typeSpan[1],
        kind: 'schema', label: null, name: e.name,
        gen: nameGen + m[3].length + m[4].length,
      });
    }
  }
}

export class TsEmitter extends Emitter {
  constructor(stores, builder, options = {}) {
    super(stores, builder, options);
    const { pins = null, strict = false, appStashSpec = null, routesUnion = null, routeParams = null } = options;
    this.ts = true;
    // Pins: Map of `${name}@${valueHash}` → type text, supplied by the
    // editor's probe pass.
    this.pins = pins;
    // First-write nodes whose hoist line took a pin. The pin is the
    // write's own inferred type, so the write never needs it as a
    // contextual type — and under rip.strict it must not have it: a
    // contextual `any` is not an implicit one, so the pin would silence
    // TS7006 at exactly the parameters an unpinned definition reports.
    this.pinnedWrites = new Set();
    // rip.strict: typed forwards and pins emit WITHOUT the `!`
    // definite-assignment assertion, so use-before-assign is checked
    // (TS2454) instead of silenced. TS-only glyphs either way —
    // strip-parity is unaffected by the flag.
    this.strict = strict;
    // The relative specifier from this module to the app's stash module,
    // when the CALLER discovered one (check.js and the editor own the
    // project-anchor walk; the compiler stays pure). Types the `app`
    // ambience and the render gates; null leaves both `any`.
    this.appStashSpec = appStashSpec;
    // The project's route-union TS text and this module's own params
    // shape, when the CALLER discovered them (the same anchor walk as
    // the stash; the compiler stays pure). The union arms href /
    // push / replace literal checking and the ambient `RoutePath`;
    // null leaves every route surface unchecked. `routeParams` is
    // non-null only when THIS module is a route file with named
    // params — it tightens the component's `params` ambience.
    this.routesUnion = typeof routesUnion === 'string' && routesUnion.length > 0 ? routesUnion : null;
    this.routeParams = typeof routeParams === 'string' && routeParams.length > 0 ? routeParams : null;
    // The intrinsic-element surfaces this module's render lowering cast
    // to (`__RipEl_<tag>` — src/ts/dom-types.js), keyed by surface name;
    // the tail declares exactly these, and each `_needs*` flag arms the
    // declaration of one helper or alias the emission referenced
    // (emitHelperDecls).
    this.domSurfaces = new Map();
    this._restTags = new Set();
    this._needsClassValue = false;
    this._needsCssProperties = false;
    this._needsChildren = false;
    this._needsRefCellHelper = false;
    this._needsAmbienceHelper = false;
    this._needsIndexedHelper = false;
    this._needsMemberKeyHelper = false;
    this._needsNarrowHelper = false;
    this._needsNarrowedHelper = false;
    this._needsRouteHelper = false;
    this._needsSourceKeyHelper = false;
    // Bodiless overload signatures (def-sig) keyed by the implementing
    // def node: the def's emission prints each signature immediately
    // above itself — TypeScript requires overload signatures adjacent
    // to their implementation (TS2391).
    this.pendingSigs = new WeakMap();
    // Type declarations from SLOTLESS lowered positions: a
    // ternary-lowered value-if branch has no statement slot, so its
    // type/interface declarations queue here and flush as TS-only
    // cluster lines after the enclosing statement — TS hoists type
    // declarations, so the displaced line still governs its uses.
    this.pendingTypeDecls = [];
    // Component type stories: component node → the walked member/props
    // info. Populated by componentExpr (the one place the member model
    // is authoritative), consumed by the companion-interface emission
    // after the binding statement.
    this.componentInfo = new Map();
    this.schemaFns = new Map();
    // Schema nodes whose behavior object is owed and not yet placed:
    // set by schemaExpr, cleared by tsSchemaBehavior, checked empty when
    // the program has emitted.
    this.schemaBehaviorPending = new Map();
    // Each statement list's schema scope (schemaStory).
    this.schemaScopes = null;
  }

  // The file-level `@ts-nocheck` emits as the face's FIRST line — ahead
  // of any runtime injection — since TypeScript honors it only before
  // all code.
  emitFaceHead(programId) {
    const t = this.tsNocheck;
    if (t === null) return;
    this.b.tsOnly(() => {
      const line = () => this.b.emit('//' + t.text.slice(1));
      if (programId !== null) this.b.markSpan(programId, 'tsDirective', t.start, t.end, line);
      else line();
      this.b.emit('\n');
    });
  }

  // Precise runtime types (the table's signatures) for an inline unit:
  // the checker reads the declared shapes instead of inferring through
  // the IIFE. The aliases the signatures reference are declared here,
  // ahead of the destructure, under the unit's own synthetic row
  // (declarations hoist, so the position serves the row, not the
  // checker). The types are stated as an ASSERTION on the injected
  // value, not as a destructure annotation — an annotation is checked
  // against the body, and the body is vendored JS whose inferred shapes
  // are not the contract, so one unprovable signature would reject the
  // whole declaration and hand every bound name an error type. The
  // assertion must also state EVERY name the pattern binds; a name the
  // table does not type rides as `any`, which is what inferring through
  // the IIFE gave it. Members key by the runtime's OWN name, never the
  // alias a colliding user binding mints — the assertion describes the
  // object the pattern reads from, not the names it binds.
  //
  // A fused unit states the union of its runtimes' face types — and only
  // when one of them HAS a table: the assertion types every bound name,
  // so an empty union would flatten names that infer honestly through
  // the IIFE to `any` (a component-carrying file's fused
  // `__state`/`__computed` stay generic, so every member initializer
  // checks against the member's declared type). Its alias declarations
  // join the same way.
  runtimeUnitTypes(unit, slots) {
    const typed = unit.runtimes.map((rt) => RUNTIME_TYPES[rt.key]).filter((t) => t !== undefined);
    if (!typed.some((t) => t.types)) return null;
    const unitTypes = Object.assign({}, ...typed.map((t) => t.types));
    const decls = [...typed.filter((t) => t.decls).map((t) => t.decls), faceClassDecls(unitTypes)].filter(Boolean).join('\n');
    if (decls !== '') this.b.tsOnly(() => this.b.emit(`${decls}\n`));
    if (decls.includes('__RipCSSProperties')) this._needsCssProperties = true;
    const types = `{ ${slots.map(({ name }) => `${name}: ${faceRuntimeType(name, unitTypes[name] ?? 'any', unitTypes)}`).join('; ')} }`;
    // A signature in the assertion may reference a face-declared alias;
    // the tail emission arms it (declarations hoist, so the tail governs
    // this earlier position).
    if (types.includes('__RipClassValue')) this._needsClassValue = true;
    if (types.includes('__RipCSSProperties')) this._needsCssProperties = true;
    return types;
  }

  // Does the face assert a signature for an injected runtime name?
  runtimeNameTyped(runtime, name) {
    const signature = RUNTIME_TYPES[runtime]?.types?.[name];
    return signature !== undefined && signature !== 'any';
  }

  emitSchemaStory(program, programId) {
    schemaStory(this, program, programId);
  }

  emitFaceTail(program) {
    rejectUnplacedSchemas(this);
    const stashLocal = stashLocalOf(program);
    if (stashLocal !== null) emitStashType(this, program, stashLocal);
    emitHelperDecls(this);
    const globals = globalInstalls(program);
    if (globals.length) emitGlobalDecls(this.b, globals);
    // The module marker: the loader runs every .rip file as a Bun
    // ES module, so a face whose own syntax carries no import/export
    // must not present as a global SCRIPT — script-ness misrepresents
    // runtime semantics, and two such faces in one tsgo program
    // redeclare every shared top-level name (TS2451) and duplicate the
    // schema intrinsic aliases (TS2300): false diagnostics no runtime
    // collision backs. A TS-only `export {}` makes each face a module;
    // stripping it reproduces the JS emission exactly.
    if (!isModuleShaped(program, (s) => this.isModuleImport(s))) {
      this.b.tsOnly(() => this.b.emit('\nexport {};\n'));
    }
    return globals.map((g) => g.name);
  }

  // Emit already-rendered type text while marking every source-backed
  // identifier from the owning recorded span. Inserted identifiers (notably
  // Promise around async returns) stay unmarked; source identifiers match in
  // order, so repeated names retain occurrence identity without a query-time
  // ordinal guess.
  emitTypeText(node, role, text) {
    // A typed parameter a lowering rebuilt (the constructor's promoted-
    // parameter strip) has no row; its type value keeps the author's.
    if (role === 'annotation' && isNode(node) && node[0] === 'typed-var' && node.length === 4 && this.rowIdOf(node) === null) {
      const typeId = this.stores.idOf(node[3]);
      if (typeId !== null) return this.emitTypeTextAt(typeId, this.stores.node(typeId), text);
    }
    const id = this.rowIdOf(node);
    const row = id === null ? null : role === '$self'
      ? this.stores.node(id) : this.stores.role(id, role);
    this.emitTypeTextAt(id, row, text);
  }

  // Type text placed against a row's source span: each identifier the
  // generated text shares with the source maps to its own occurrence.
  emitTypeTextAt(id, row, text) {
    const source = this.b.source;
    if (id === null || row?.sourceStart == null || source === null) {
      // A node a lowering built has no row to place the type's names in.
      this.b.emit(text);
      return;
    }
    const sourceTokens = typeIdentifierTokens(
      source.slice(row.sourceStart, row.sourceEnd), row.sourceStart,
    );
    const generatedTokens = typeIdentifierTokens(text);
    const n = sourceTokens.length;
    const m = generatedTokens.length;
    // The streams differ only where the emitter INSERTED tokens (the
    // async Promise wrap, an augmentation's interface head) or dropped
    // some. A greedy first match would let an inserted token steal a
    // later source occurrence's span — the author's `Promise` marking the
    // wrapper while every annotation token before it fell to the
    // cover. So the pairing is an alignment, not a search: `still[i][j]`
    // counts how many source tokens an in-order pairing can still match
    // from sourceTokens[i:] against generatedTokens[j:], and the walk
    // marks a generated token only when pairing it NOW is the only way
    // to keep that count. A duplicate that could pair either way is
    // treated as the insertion, because insertions are prefix-shaped —
    // the author's own bytes are always the later occurrence. The
    // identity case (no insertions — almost every annotation) skips
    // the table entirely.
    const aligned = n === m && sourceTokens.every((s, i) => s.value === generatedTokens[i].value);
    let still = null;
    if (!aligned) {
      still = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
      for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
          still[i][j] = sourceTokens[i].value === generatedTokens[j].value
            ? still[i + 1][j + 1] + 1
            : Math.max(still[i][j + 1], still[i + 1][j]);
        }
      }
    }
    let sourceAt = 0;
    let generatedAt = 0;
    for (let j = 0; j < m; j++) {
      const token = generatedTokens[j];
      this.b.emit(text.slice(generatedAt, token.start));
      if (still !== null) {
        // Source tokens the generated text no longer carries fall away
        // to the enclosing cover row.
        while (sourceAt < n && sourceTokens[sourceAt].value !== token.value &&
               still[sourceAt + 1][j] === still[sourceAt][j]) sourceAt++;
      }
      const pair = sourceAt < n && sourceTokens[sourceAt].value === token.value &&
        (still === null || still[sourceAt][j + 1] < still[sourceAt][j]);
      if (pair) {
        const s = sourceTokens[sourceAt];
        this.b.markSpan(id, 'identifier', s.start, s.end, () => this.noteNameSpan(token.value));
        sourceAt++;
      } else {
        this.noteNameSpan(token.value);
      }
      generatedAt = token.end;
    }
    this.b.emit(text.slice(generatedAt));
  }

  // Emit `: T` as a TS-only region, re-marked under (node, role) — the
  // annotation's generated manifestation (one-to-many; exact when
  // the emitted bytes equal the recorded span verbatim, cover
  // otherwise — the builder decides, never a declaration).
  tsAnnotate(node, role, text) {
    this.b.tsOnly(() => this.mark(node, role, () => this.emitTypeText(node, role, `: ${text}`)));
  }

  // A function's TS-face return annotation, emitted after its param
  // list. The recorded returnType role when present — an ASYNC
  // function wraps it as Promise<T> (the TS spelling of the same
  // annotation: a Rip return type names what the caller awaits, and
  // TS requires the async wrapper spelled out, TS1064) unless the
  // user already spelled the Promise. A void definition without one
  // annotates `: void` under the voidMarker role — the `!`'s second
  // generated manifestation (arrows registered void through their
  // owning definition carry no voidMarker role of their own; their
  // `: void` emits unmarked inside the enclosing $self cover).
  //
  // A GENERATOR takes NEITHER treatment, because neither names what
  // its caller receives: TS rejects `: void` on one outright (TS2505),
  // and the async wrap would promise a value that an async generator
  // hands back through its iterator instead. Both spellings are
  // GENERATED, so a wrong one is unanswerable — the author annotated
  // nothing in the void case, and gets their own annotation mangled in
  // the async one. Emitting no annotation leaves TS to infer the exact
  // iterator (`Generator<T, void, unknown>`); an author who wants it
  // spelled writes it (`: Generator<T>`, `: AsyncGenerator<T>`) and
  // that text passes through untouched, like any other annotation.
  tsReturnAnnotation(node, isAsync, isVoid, isGen, voidOwner = node) {
    const text = this.annotationText(node, 'returnType');
    if (text !== null) {
      const spelled = isAsync && !isGen && !/^Promise\s*</.test(text) ? `Promise<${text}>` : text;
      this.b.tsOnly(() => this.mark(node, 'returnType', () => this.emitTypeText(node, 'returnType', `: ${spelled}`)));
      return;
    }
    if (isVoid && !isGen) {
      const spelled = isAsync ? 'Promise<void>' : 'void';
      this.b.tsOnly(() => this.mark(voidOwner, 'voidMarker', () => this.b.emit(`: ${spelled}`)));
    }
  }

  // Shared-renderer rejections (src/ts/types.js), positioned on the
  // offending statement: a malformed alias body fails the TS-face
  // compile from the declaration's own span (rule 5), with the same
  // message class the dts consumer raises.
  tsRendered(stmt, fn) {
    try {
      return fn();
    } catch (err) {
      if (err instanceof TypeTextError) throw this.positionedError(stmt, `emitter: ${err.message}`);
      throw err;
    }
  }

  // TS-face emission of the type/interface declarations a statement
  // LIST carries (whole statements the JS emission erases). They print
  // clustered at the top of the list's emission at its padding: TS
  // type declarations are scope-hoisted, so placement inside the list
  // is free, and clustering keeps the JS emission's own layout
  // untouched. Bare typed forwards contribute to the hoist line
  // instead; def-sig overloads print adjacent to their implementation
  // (pendingSigs — TS2391 demands adjacency). Every lowered body WITH
  // statement slots (try/switch/if IIFEs, accumulator loop bodies,
  // catch-pattern handlers) makes this same call; the one SLOTLESS
  // position — a ternary-lowered value-if branch — queues its
  // declarations instead (pendingTypeDecls) for the enclosing
  // statement list's flush. Zero-width rows still record for every
  // erased statement (liveStmts), so reverse queries resolve.
  emitTsTypeDecls(list, pad) {
    this.placeSchemaScope(list, pad);
    for (const s of list) {
      if (isNode(s) && s[0] === 'type-decl') this.tsTypeDeclLine(s, pad);
    }
  }

  // The schema scope record a statement list belongs to: the function
  // scope whose body holds one of the list's statements, or null for
  // the module and for a scope that declares no schema.
  schemaScopeOf(list) {
    if (!this.schemaScopes) return null;
    for (const s of list) {
      const record = this.schemaScopes.get(s);
      if (record !== undefined) return record;
    }
    return null;
  }

  // A function scope's schema alias lines, placed at its top beside
  // the user type declarations the same list carries (the
  // emitTsTypeDecls cluster): once per scope, at the first statement
  // list of its body the emission reaches — the body's own top, ahead
  // of every nested list. Each block is a TS-only cover manifestation
  // of its schema node, like the module's at the program's top.
  placeSchemaScope(list, pad) {
    const record = this.schemaScopeOf(list);
    if (record === null || record.placed) return;
    record.placed = true;
    for (const s of record.stories) {
      this.emitSchemaAliasBlock({ node: s.decl.node, exported: false, story: s, lines: s.faceAliasLines ?? s.aliasLines }, '', pad, '\n');
    }
  }

  emitSchemaAliasBlock(block, exp, pad, tail) {
    const nodeId = this.stores.idOf(block.node);
    this.b.tsOnly(() => {
      this.b.emit(pad);
      const lines = () => {
        const at = this.b.offset;
        const text = block.lines.map((l) => `${exp}${l}`).join('\n' + pad);
        emitSchemaTextMarked(this, block, text, nodeId);
        recordSchemaFields(this, block, text, at);
      };
      if (nodeId !== null) this.b.mark(nodeId, '$self', lines);
      else lines();
      this.b.emit(tail);
    });
  }

  // One rendered type/interface declaration as a TS-only cluster line.
  tsTypeDeclLine(s, pad) {
    const lines = this.tsRendered(s, () => renderTypeDecl(s[2]));
    // A directive above the declaration follows it to its cluster
    // line — ONLY when the rendered declaration is a single
    // line, where a genuine error suppresses there and an unused
    // directive self-reports TS2578. A multi-line body (object
    // alias, interface) declines: its errors land on inner lines
    // the directive cannot govern (place-or-decline).
    const directives = this.takeTsDirectives(s);
    if (directives !== undefined && lines.length === 1) {
      for (const d of directives) this.tsDirectiveLine(d, pad, true);
    }
    this.b.tsOnly(() => {
      this.b.emit(pad);
      this.mark(s, '$self', () => this.mark(s, 'declaration', () => {
        this.emitTypeText(s, 'declaration', lines.join('\n' + pad));
      }));
      this.b.emit('\n');
    });
  }

  // Drain the slotless-position queue (pendingTypeDecls) as TS-only
  // cluster lines at the enclosing statement list's padding. TS hoists
  // type declarations, so a line displaced from its ternary-lowered
  // branch still governs every use. `atListEnd` marks the one call
  // site whose preceding statement carries no trailing newline (a
  // program's final statement) — the flush supplies it, TS-only.
  flushPendingTypeDecls(pad, atListEnd = false) {
    if (this.pendingTypeDecls.length === 0) return;
    const pending = this.pendingTypeDecls;
    this.pendingTypeDecls = [];
    if (atListEnd) this.b.tsOnly(() => this.b.emit('\n'));
    for (const s of pending) this.tsTypeDeclLine(s, pad);
  }

  // ── The component face ──────────────────────────────────────
  // Segment lists from src/ts/components.js: named pieces re-mark
  // their recorded store rows (the builder decides exact vs cover by
  // verbatim comparison; mark() no-ops where a role has no row — the
  // span-less optional glyphs), plain pieces emit bare.
  emitSegments(segs) {
    for (const s of segs) {
      if (s.node !== undefined) this.mark(s.node, s.role, () => this.emitAnnotationWords(s));
      else this.emitDeclaredTypeCopies(s.text);
    }
  }

  // Generated text with no name of its OWN to copy — a props type's
  // structural pieces, an `_init` parameter — still spells the module's
  // declared types. Each copy marks its declaration; the owner is the
  // construct being emitted, since the SPAN is what identifies the
  // source bytes a rename must reach.
  emitDeclaredTypeCopies(text, id = null) {
    const owner = id ?? this.b.currentMark?.nodeId ?? null;
    if (owner === null) { this.b.emit(text); return; }
    this.emitNamedCopies(text, null, owner, null);
  }

  // A generated text that repeats a declared NAME (`Schema<Hop, Hop>`
  // beside `Hop = schema`, `mount(): Badge` in a component's surface,
  // `props?: { variant?: Variant }` in a constructor) emits in slices,
  // every whole-word copy marking the declaration's own span — so a
  // rename reaching the copy lands where the declaration is, and the
  // coincident-span dedup folds the edits into one. The owning
  // construct's own name and every TYPE the module declares are copies
  // alike: a props type names the aliases its members are annotated
  // with, and one unmarked copy refuses the whole rename. Words are
  // taken maximally, so a minted `__Name__behavior` is one word and is
  // not a copy.
  emitNamedCopies(text, name, id, span) {
    if (id === null) { this.b.emit(text); return; }
    const declared = this.moduleTypeDeclarationSpans();
    if (name !== null && span !== null) declared.set(name, span);
    this.emitCopiesOf(text, declared, id);
  }

  // `text` in slices, each whole word `declared` names marked on (id)
  // with the declaration's span.
  emitCopiesOf(text, declared, id) {
    if (declared.size === 0) { this.b.emit(text); return; }
    let cursor = 0;
    for (const m of identifierMatches(text)) {
      const at = declared.get(m[0]);
      if (at === undefined) continue;
      this.b.emit(text.slice(cursor, m.index));
      this.b.markSpan(id, 'identifier', at[0], at[1], () => this.b.emit(m[0]));
      cursor = m.index + m[0].length;
    }
    this.b.emit(text.slice(cursor));
  }

  // The module's own type-shaped declarations, by name: `type`/`interface`
  // heads, schema declarations, and schema DERIVATIONS
  // (`UserPublic = User.pick(…)`), whose companion alias is a declaration
  // like any other. Spans come from the match's own group bounds, never a
  // search of the matched text — a derivation names two schemas on one
  // line, and a search cannot tell which occurrence declares.
  // A COPY per call: a caller adds its own construct's name to the map,
  // and a shared map would carry that into the next caller's answer.
  moduleTypeDeclarationSpans() {
    if (this._typeDeclSpans === undefined) {
      const spans = new Map();
      if (this.b.source !== null) {
        const DECL = new RegExp(String.raw`^(?:export\s+)?(?:(?:type|interface)\s+(${IDENT_SOURCE})|(${IDENT_SOURCE})\s*=\s*schema\b|(${IDENT_SOURCE})\s*=\s*${IDENT_SOURCE}\s*\.\s*(?:pick|omit|partial|required|extend)\b)`, 'gmd');
        for (const m of this.b.source.matchAll(DECL)) {
          const at = m.indices[1] ?? m.indices[2] ?? m.indices[3];
          const name = this.b.source.slice(at[0], at[1]);
          if (spans.has(name)) continue;
          spans.set(name, [at[0], at[1]]);
        }
        // An IMPORTED name has no declaration in this file, and a
        // generated text still spells it (a props type names the alias
        // its member is annotated with). Its copies mark the name's first
        // USE below the import statement — never the specifier, whose
        // bytes a rename of the LOCAL binding rewrites to the alias form
        // (`Tone as Shade`) while every use takes the bare new name; a
        // copy marked there would demand two different texts over one
        // span. Marked at a use, the copy's edit matches that use's own
        // and the coincident-span dedup folds them, whichever end the
        // rename started from. A local declaration of the same spelling
        // already claimed the name above and keeps it.
        // The search starts past the statement's terminator, so a module
        // path spelling the name (`./lib/eid.rip`) lies behind it, and a
        // word inside any string, regex, or comment is no use (the
        // editor paints a marked span with the copy's token, which a
        // literal's bytes must never carry). A name with no use below
        // the import marks nothing.
        // The captured group is the LOCAL name either way: the alias in
        // `Origin as local`, otherwise the specifier's own word.
        const SPEC = new RegExp(String.raw`(?:^|,)\s*(?:type\s+)?(?:${IDENT_SOURCE}\s+as\s+)?(${IDENT_SOURCE})`, 'gd');
        for (const clause of this.b.source.matchAll(/^import\s+(?:type\s+)?\{([^}]*)\}/gmd)) {
          const after = this.statementEndAfter(clause.index + clause[0].length);
          for (const sp of clause[1].matchAll(SPEC)) {
            const [start, end] = sp.indices[1];
            const name = clause[1].slice(start, end);
            if (spans.has(name)) continue;
            const use = new RegExp(`(?<!${IDENT_PART.source})${escapeRegExp(name)}(?!${IDENT_PART.source})`, 'g');
            use.lastIndex = after;
            for (let hit = use.exec(this.b.source); hit !== null; hit = use.exec(this.b.source)) {
              if (this.inOpaqueSpan(hit.index)) continue;
              spans.set(name, [hit.index, hit.index + name.length]);
              break;
            }
          }
        }
      }
      this._typeDeclSpans = spans;
    }
    return new Map(this._typeDeclSpans);
  }

  // The span a binding's own name occupies in the source, from the node
  // and role that declare it — null when the role covers more than the
  // name (a pattern) or the node has no row.
  bindingNameSpan(node, role, name) {
    const id = this.rowIdOf(node);
    if (id === null || this.b.source === null) return null;
    const r = this.stores.role(id, role);
    if (r?.sourceStart != null && this.b.source.slice(r.sourceStart, r.sourceEnd) === name) return { id, span: [r.sourceStart, r.sourceEnd] };
    // No role spells the bare name: the declaration is the nearest
    // whole-word occurrence ahead of the node's own span (`Hop = schema`).
    const self = this.stores.selfSpan(id);
    if (self === null) return null;
    // `+ 1` so an occurrence starting exactly AT the span admits: a
    // derivation's own span opens on its name (`UserPublic = User.pick(…)`),
    // where a search strictly ahead of the span finds nothing.
    const at = wordStartBefore(this.b.source, name, self[0] + 1);
    return at < 0 ? null : { id, span: [at, at + name.length] };
  }

  // An annotation segment the face re-renders around the author's type
  // (`: { value: Item[]; read(): Item[]; … }` for the author's `Item[]`)
  // is a cover of the annotation, so the type words inside it — copies
  // of words the author wrote — map to their own occurrences in the
  // annotation's source, and a rename of `Item` reaches every copy. A
  // segment that repeats the source verbatim maps as one row already.
  emitAnnotationWords(s) {
    if (s.role !== 'annotation') { this.b.emit(s.text); return; }
    const id = this.stores.idOf(s.node);
    const r = id !== null ? this.stores.role(id, 'annotation') : null;
    const src = r?.sourceStart != null && this.b.source !== null ? this.b.source.slice(r.sourceStart, r.sourceEnd) : null;
    if (src === null || s.text.includes(src)) { this.noteImportedTypeWords(s.text); return; }
    const words = new Map();
    for (const m of identifierMatches(src)) if (!words.has(m[0])) words.set(m[0], [r.sourceStart + m.index, r.sourceStart + m.index + m[0].length]);
    let cursor = 0;
    for (const m of identifierMatches(s.text)) {
      const at = words.get(m[0]);
      if (!at) continue;
      this.b.emit(s.text.slice(cursor, m.index));
      this.b.markSpan(id, 'identifier', at[0], at[1], () => this.noteImportedTypeWords(m[0]));
      cursor = m.index + m[0].length;
    }
    this.b.emit(s.text.slice(cursor));
  }

  // Type text whose words that ROOT a path and name an import join the
  // imported-reference channel: an annotation's words are reads whatever
  // line declares around them, and a qualifier there (`Dialog.ClosedBy`)
  // colors as the namespace it is only through that record.
  noteImportedTypeWords(text) {
    const was = this.declaringName;
    this.declaringName = false;
    try {
      let at = 0;
      for (const token of typeIdentifierTokens(text)) {
        if ((token.start > 0 && text[token.start - 1] === '.') || this.importSpecOf(token.value) === null) continue;
        this.b.emit(text.slice(at, token.start));
        this.noteNameSpan(token.value);
        at = token.end;
      }
      this.b.emit(text.slice(at));
    } finally { this.declaringName = was; }
  }

  // TS-only member declares at the class top: one `declare name: T;`
  // line per non-callable member (methods/hooks are real class methods
  // and annotate through the shared param/return machinery), the
  // `children` projection slot, the `rest` view under extends, and the
  // `_`-prefix index signature — the compiler/runtime slot namespace
  // (`__`-prefixed user names reject at parse; minted `_el0`/`_t0`/
  // `_inst1` slots and the runtime's own `_root`/`_frame` family all
  // land here), so member accesses never draw TS2339-class noise on
  // generated shapes.
  tsComponentMemberDeclares(info, pad) {
    const line = (fn) => this.b.tsOnly(() => {
      this.b.emit(pad);
      fn();
      this.b.emit('\n');
    });
    let hasChildren = false;
    for (const m of info.members) {
      if (m.name === 'children') hasChildren = true;
      if (!isDeclarableMember(m)) continue;
      this.noteMemberDecl(m);
      const twin = this.gateTwinSource(m, info);
      if (twin !== null && m.annotation == null) {
        line(() => this.emitGateTwin(m, twin));
        continue;
      }
      line(() => this.emitSegments(memberDeclareSegments(m, info)));
      // An ANNOTATED gate keeps its declare line (the annotation is the
      // member's type) and gains the twin under a minted name, so its path
      // segments still claim their spans and answer at each depth.
      if (twin !== null) line(() => this.emitGateTwin(m, twin, `__${m.name}__gate`));
    }
    // The projection channel, typed as what the runtime delivers — the
    // `__RipChildren` alias (declared once per module, below the
    // surfaces) that the editor shows as `Children`.
    if (!hasChildren) line(() => this.b.emit('declare children?: __RipChildren;'));
    this._needsChildren = true;
    line(() => this.b.emit(`declare ${OFFERS}: ${offersRecordText(info)};`));
    // The host record spells the host component's name as the rest line
    // does, unmarked: the extends head's bytes belong to `__ripHost`,
    // where the name hovers as the component.
    line(() => this.b.emit(`declare ${HOST}: ${hostTypeText(info)};`));
    // The ambience helper the `stash` field infers through is declared
    // once at MODULE scope, from the emit() tail — keyed off the USE,
    // never off companion emission: expression-valued and function-
    // nested components emit the field too, and a declaration parked on
    // the companion road would strand them (no companion, or a declare
    // at an illegal function-scope position). Declares hoist, so the
    // tail position serves every class in the module.
    const ambientLines = ambientClassDeclares(info);
    if (ambientLines.some((t) => t.includes('__ripAmbientStash('))) this._needsAmbienceHelper = true;
    for (const text of ambientLines) line(() => this.b.emit(text));
    if (info.extendsTag !== null) {
      // The rest view holds the passthrough object, named through the
      // per-tag alias the module declares once (restAliasName).
      this._restTags.add(info.extendsTag);
      this._needsClassValue = true; // the alias types the view's `class`
      line(() => this.b.emit(`declare rest: ${restContainerType(restAliasName(info.extendsTag))};`));
    } else if (info.extendsComponent !== null) {
      // `_rest` is the object the rest view holds, which the lowering
      // spreads into the host's construction.
      line(() => this.b.emit(`declare rest: ${restContainerType(restViewOfComponentText(info))};`));
      line(() => this.b.emit(`declare _rest: ${restOfComponentText(info)} | undefined;`));
      // The host itself, referenced under the head's own bytes so the
      // name there resolves to the component it names and hovers as the
      // component. A construction inside a body: a type position hovers
      // as `typeof Host`, a bare value reference likewise, only the
      // target of `new` answers the construct signature the presenter
      // dresses; a field initializer would draw use-before-declaration
      // on a host bound later in the module; and `null!` is never, so a
      // required props parameter draws no arity error.
      line(() => {
        this.b.emit('private static __ripHost() { return new ');
        if (info.hostSpan !== null && info.hostNodeId !== null) {
          let at = info.hostSpan[0];
          info.extendsComponent.split('.').forEach((seg, i) => {
            if (i > 0) { this.b.emit('.'); at += 1; }
            const start = at;
            at += seg.length;
            this.b.markSpan(info.hostNodeId, 'identifier', start, at, () => (i === 0 ? this.noteNameSpan(seg) : this.b.emit(seg)));
          });
        } else {
          this.b.emit(info.extendsComponent);
        }
        this.b.emit('(null!); }');
      });
    }
    // The runtime base's API, declared because the inlined base types as
    // `any` and carries nothing into the class. `this` rather than the
    // component's name: an expression-valued component has no companion
    // interface for a name to reach, and `this` keeps `mount`'s return
    // the instance at hand rather than a fixed spelling.
    for (const text of runtimeApiDeclares('this')) line(() => this.b.emit(text));
    line(() => this.b.emit('[key: `_${string}`]: any;'));
  }

  // The gate descriptor of a member that takes a face TWIN, or null.
  // A bare gate under a discovered stash emits the read the author
  // wrote instead of a projection formula; an annotated gate honors its
  // annotation (the declare road), and without a stash `this.stash` is
  // undeclared on the class, so a twin would publish an error on every
  // gate.
  gateTwinSource(m, info) {
    if (m.kind !== 'gate' || !info.appStashSpec) return null;
    const src = Emitter.gateSource(m.node);
    return src.error ? null : src;
  }

  // The gate's face twin. The read the author wrote
  // emits as a REAL ts-only expression (`user = __computed(() =>
  // this.stash.user!)`): every path segment maps to its own leaf,
  // so hover answers at each depth and a wrong path draws its error on
  // the segment the author wrote — and the `!` states the gate's own
  // contract (the body does not render until the value exists). The
  // member's type is the INSTANTIATED slot, which quickinfo prints
  // resolved (the memberDeclareSegments doctrine: a written node
  // echoes). The runtime road is untouched: `_init`'s `__gateBind`
  // remains the only assignment the shipped JS carries. A keyed gate's
  // key is a literal (verbatim) or a `params`/`query` chain, re-rooted
  // on `this` — the class ambience declares both records.
  emitGateTwin(m, src, as = null) {
    if (as === null) this.mark(m.nameNode, m.nameRole, () => this.b.emit(m.name));
    else this.b.emit(as);
    this.b.emit(' = __computed(() => this.');
    this.mark(src.pathNode, '$self', () => {
      const segs = Emitter.gateChain(src.pathNode).slice(1);
      const leaves = chainLeaves(src.pathNode).slice(1);
      segs.forEach((seg, i) => {
        if (i > 0) this.b.emit('.');
        this.emitLeaf(leaves[i], seg);
      });
      // The path's root is a PROVIDED name (`@stash`, `@router`): its bytes
      // take the provision's head, as a plain read's do (noteProvidedRead).
      if (segs[0] === 'stash' || segs[0] === 'router') {
        const hit = this.leafSpansIn(src.pathNode, segs[0])[0];
        if (hit !== undefined && !this.kinds.some((k) => k.start === hit[0] && k.label === segs[0])) {
          this.kinds.push({ start: hit[0], end: hit[1], label: segs[0], name: segs[0], optional: false });
        }
      }
    });
    if (src.key !== null) {
      this.b.emit('(');
      if (src.keyParts === null) {
        this.b.emit(src.keyCode);
      } else {
        this.mark(src.key, '$self', () => {
          this.b.emit('this.');
          const keyLeaves = chainLeaves(src.key).slice(-src.keyParts.length);
          src.keyParts.forEach((seg, i) => {
            if (i > 0) this.b.emit('.');
            this.emitLeaf(keyLeaves[i], seg);
          });
        });
      }
      this.b.emit(')');
    }
    this.b.emit('!);');
  }

  // Minted render-scaffold declarations type `any` in the face
  // (TS-only): the scaffold is the lowering's own state, and its
  // inference is FLAG-dependent (a `let x = null` evolves only under
  // noImplicitAny; strictNullChecks varies with the user's tsconfig).
  // An explicit `any` keeps swap/reconcile internals quiet under every
  // posture, so effect lines that carry mapped rows to user constructs
  // never inherit scaffold noise.
  tsScaffoldAny(suffix = '') {
    this.b.tsOnly(() => this.b.emit(`: any${suffix}`));
  }

  // The face position a served record points at must answer with the
  // value's WHOLE type. The value's own last byte cannot promise that:
  // a call or an index ends in `)`/`]`, which names nothing, and the
  // name before it types a part (`String(item.id)` ends on `id`, a
  // number, when the key is a string). So the value emits as the one
  // member of a TS-only object literal, `({ __name: value }).__name`,
  // and the record points at the member — a `(property)` head carrying
  // exactly the value's type. JS bytes unchanged; the returned offset
  // is the member's first byte, or null when the face records nothing.
  tsServedValue(name, fn) {
    let gen = null;
    this.b.tsOnly(() => {
      this.b.emit('({ ');
      gen = this.b.offset;
      this.b.emit(`${name}: `);
    });
    fn();
    this.b.tsOnly(() => this.b.emit(` }).${name}`));
    return gen;
  }

  // A render-loop item's face type — the element type of its loop's
  // iterable thunk (tsIterThunkName), spelled through `self`, the
  // consumer's own name for the component instance — or null when the
  // loop has no thunk (the param then stays bare: an implicit `any` the
  // strict gauge still reports, never a silencing `any`). `NonNullable`
  // first (an optional prop iterates as `T[] | undefined`), then a
  // conditional infer rather than `[number]` — a non-array iterable
  // must fall to `any`, never to a face error on a line the user
  // cannot see.
  tsLoopItemTypeText(entry, self) {
    const thunk = this.tsIterThunkName(entry);
    return thunk === null ? null : `NonNullable<ReturnType<typeof ${self}.${thunk}>> extends readonly (infer __E)[] ? __E : any`;
  }

  // The face-only method a render loop's iterable re-emits into: its
  // return type is the iterable's type, and `typeof ctx.<thunk>` is an
  // entity name every consumer can spell, where `typeof` over the
  // iterable itself takes an entity name alone (never a call, an
  // index, or a literal). The header that types the loop's item is a
  // class method the value never reaches — the iterable evaluates at
  // the reconcile call one scope up — so a declaration the header can
  // name is the one bridge. Null where the method would not see what
  // the evaluation sees: the loop's own vars, the self param, a rename
  // hazard, a render local of the enclosing block, or an async or
  // generator context; the item then stays bare, an implicit `any` the
  // strict gauge reports, where a name the method cannot see would
  // type it `any` silently. A misspelled name is not such a case: the
  // thunk re-spells it as an echo, the real copy at the reconcile call
  // reports it, and the item takes `any` from the error type as a
  // `for…of` binding would. Decided from the entry alone, so the
  // header, the keyFn, and every nested factory threading the entry
  // agree; each consumer runs after the walk, when the enclosing
  // block's render locals are all known.
  tsIterThunkName(entry) {
    const rec = entry.owner;
    const { iter } = entry;
    if (rec === undefined || iter === undefined) return null;
    if (this.containsAwait(iter) || this.containsYield(iter)) return null;
    if (referencesNames(iter, rec.parent.locals, this.stores)) return null;
    const leaves = new Set();
    Emitter.collectLeafNames(iter, leaves);
    for (const n of [rec.self, entry.itemVar, entry.indexVar, ...rec.renameHazardNames]) if (leaves.has(n)) return null;
    return `${rec.name}_iter`;
  }

  // The face type of a DOM event handler's parameter, or null for an
  // event name outside the vocabulary (a custom event carries no
  // claim — never a face error). The map lookup is a BARE indexed
  // access, so membership must be decided HERE: DOM_EVENTS gates the
  // emission, and dom-vocab-lib.test.js pins every vocabulary name
  // against the pinned lib's map so the index can never miss.
  // `target` and `currentTarget` intersect to the HOST ELEMENT where
  // the caller knows it (`hostText` — the walk-time tag+namespace
  // record; RULINGS.md § the render DSL): `currentTarget` IS the
  // listening element, and `target` is CLAIMED as it too — the
  // descendant an event bubbled from is untypeable, and the idiomatic
  // `e.target.value` on an input handler is the read the claim
  // exists to serve. Where no single host is known (a method serving
  // several elements reports each; none reports nothing) the slots
  // stay `any` — zero noise on legal reads while the event's own
  // surface (key, clientX, preventDefault) checks for real.
  tsEventTypeText(events, hostType = null) {
    const known = events.filter((e) => DOM_EVENTS.has(e));
    if (known.length === 0) return null;
    const map = known.map((e) => `HTMLElementEventMap['${e}']`).join(' | ');
    const host = hostType ?? 'any';
    return `${known.length > 1 ? `(${map})` : map} & { target: ${host}; currentTarget: ${host} }`;
  }

  // The receiver-surface cast for one render element (TS face only):
  // registers the (tag, namespace) surface — the emit() tail declares
  // exactly the registered set — and hands back `emit()`, which writes
  // the receiver bytes wrapped in the cast, plus the names the
  // branch's annotations spell. Everything is a passthrough when the
  // tag has no surface (an unrecorded var, a tag outside the
  // vocabulary): emit() writes the bare receiver, which stays the
  // scaffold's `any`, and the caller keeps its own quieting cast.
  tsElReceiver(el) {
    const tag = this.rstate?.tags?.get(el);
    const svg = this.rstate?.svgEls?.has(el) === true;
    if (typeof tag !== 'string' || !surfaceableTag(tag, svg)) return super.tsElReceiver(el);
    const name = elSurfaceName(tag, svg);
    this.domSurfaces.set(name, { tag, svg });
    return {
      surfaced: true,
      emit: () => {
        this.b.tsOnly(() => this.b.emit('('));
        this.b.emit(el);
        this.b.tsOnly(() => this.b.emit(` as ${name})`));
      },
      valsName: attrValsName(tag, svg),
      hostText: hostText(tag, svg),
    };
  }

  // An event listener's handler CALL casts in the face (TS-only): the
  // listener always passes the event object, and a handler declaring
  // fewer parameters is legal Rip (JS ignores extra arguments) —
  // TypeScript's arity check (TS2554) is the one diagnostic this call
  // shape can draw, and it would land on the user's directive span.
  // The handler EXPRESSION keeps its own marks (hover/references reach
  // the method); only the call shape quiets. The cast wraps the
  // expression in TS-ONLY grouping parens — an arrow-valued handler
  // would otherwise swallow the cast into its body (`() => body as
  // any` parses as `() => (body as any)`, and the arity error
  // survives). JS bytes unchanged.
  //
  // With `evTypeText`, a LITERAL unannotated ≤1-param handler casts to
  // the event's real function type instead of `any`: the assertion
  // contextually types the arrow's parameter, so `e` reads as the
  // actual event interface and the body checks against it, while
  // arity forgiveness holds (a fewer-params handler is assignable to
  // the 1-param signature). The caller passes evTypeText only for
  // that shape: a 2+-param handler is NOT assignable (the cast would
  // draw TS2352 on legal rip), an author-annotated param already
  // governs its own body, and a non-literal handler types at its own
  // declaration — all keep `as any`.
  // Returns the generated span of the `as` expression — where a handler
  // that cannot take the event draws TS2352 — or null where the cast
  // is `as any` (no claim, no relation).
  tsHandlerCast(fn, evTypeText = null) {
    const start = this.b.offset;
    this.b.tsOnly(() => this.b.emit('('));
    fn();
    // The type is text, or a function that emits it — a site whose type
    // spells a user name maps each copy to that name.
    this.b.tsOnly(() => {
      if (evTypeText === null) this.b.emit(') as any');
      else if (typeof evTypeText === 'function') { this.b.emit(') as (e: '); evTypeText(); this.b.emit(') => unknown'); }
      else this.b.emit(`) as (e: ${evTypeText}) => unknown`);
    });
    return evTypeText === null ? null : [start, this.b.offset];
  }

  // The TS-only constructor: the props SURFACE —
  // `new Counter({ label: … })` checks and completes against the
  // declared props. A whole face-only line; stripping removes it and
  // the runtime's own constructor governs as in JS mode. Under a
  // REQUIRED prop, the inherited static `mount` narrows to `never` —
  // non-callable, so `Counter.mount()` errors (it constructs with NO
  // props, which would type-check while the runtime yields a required
  // container holding undefined). Requiredness is a type-story fact —
  // the annotation erases, so the gate can never be a runtime throw.
  // `never` because the override must stay assignable to the REAL
  // base's static side in the editor (inline runtime — TS2417
  // otherwise); only bottom is both assignable and uncallable.
  tsComponentCtor(info, pad) {
    if (info.members.some((m) => m.kind === 'gate')) {
      this.b.tsOnly(() => {
        this.b.emit(`${pad}declare static mount: never;\n`);
        this.b.emit(`${pad}private constructor() { super(); }\n`);
      });
      return;
    }
    const optional = propsParamOptional(info);
    if (!optional) {
      this.b.tsOnly(() => this.b.emit(`${pad}declare static mount: never;\n`));
    } else {
      // The static mount mirror the binding's published type carries
      // (componentCtorMembers, under the same condition). The base
      // supplies it at runtime but types as `any`, so the class must
      // declare it or a hoisted binding's assignment fails TS2741
      // against its own published type. A class expression has no name
      // for its own instance type; `typeof this` in a static member is
      // the constructor, so InstanceType of it is that type without one.
      this.b.tsOnly(() => this.b.emit(`${pad}declare static mount: (target?: globalThis.Node | string) => InstanceType<typeof this>;\n`));
    }
    this.b.tsOnly(() => {
      this.b.emit(`${pad}constructor(props${optional ? '?' : ''}: `);
      this.emitSegments(propsTypeSegments(info, { road: 'face' }));
      this.b.emit(') { super(props); }\n');
    });
  }

  // The companion interface: a component binding is a VALUE (an
  // anonymous class expression), so an annotation naming it (`c:
  // Counter`) would find no type; the instance surface is the honest
  // companion, and TS's separate type/value namespaces make the
  // same-name pairing legal. Emitted after the binding statement, for
  // plain-name bindings only.
  tsComponentCompanion(compNode, name, exported, typeParams = null) {
    const info = this.componentInfo.get(compNode);
    if (info === undefined) return;
    const pad = '  '.repeat(this.ind);
    // Generic component: the companion interface
    // carries the declaration's type params, and self-references in
    // the instance surface apply the bare param NAMES (`mount():
    // Select<TOption>` — extends clauses stay on the header).
    const selfArgs = selfArgsOf(typeParams);
    // The interface and the behavior object repeat the component's NAME;
    // each copy marks the binding's own declaration bytes — the nearest
    // whole-word occurrence ahead of the component expression — so a
    // rename reaching it lands on the one span every copy shares.
    const compId = this.stores.idOf(compNode);
    const compSpan = compId !== null ? this.stores.selfSpan(compId) : null;
    const nameAt = compSpan !== null && this.b.source !== null ? wordStartBefore(this.b.source, name, compSpan[0]) : -1;
    // A text segment repeats the component's name (`mount(): Name`) and
    // the module's own declared type names (`remove(item: Item)`): every
    // copy marks the declaration it copies, so a rename of either lands
    // where the declaration is.
    const declared = this.moduleTypeDeclarationSpans();
    if (nameAt >= 0) declared.set(name, [nameAt, nameAt + name.length]);
    const emitNamed = (text) => this.emitCopiesOf(text, declared, compId);
    this.b.tsOnly(() => {
      this.b.emit('\n' + pad);
      this.mark(compNode, '$self', () => {
        this.b.emit(`${exported ? 'export ' : ''}interface `);
        emitNamed(name);
        this.b.emit(`${typeParams ?? ''} {`);
        // Every segment carrying a node marks its own row nested inside
        // the $self cover, so a diagnostic born in this second rendering
        // of a member's type anchors at the member the author wrote
        // rather than across the whole component. Scaffolding segments
        // have no source span and stay under the cover.
        for (const l of instanceTypeLines(info, `${name}${selfArgs}`, { road: 'face' })) {
          this.b.emit('\n' + pad + '  ');
          const segs = () => {
            for (const s of l.segs) {
              if (s.node !== undefined) this.mark(s.node, s.role, () => this.emitAnnotationWords(s));
              else emitNamed(s.text);
            }
          };
          if (l.node !== undefined) this.mark(l.node, l.role, segs);
          else segs();
        }
        this.b.emit('\n' + pad + '}');
      });
    });
    // The behavior object the computed members' types read through,
    // emitted HERE because this is the one place a companion
    // interface is known to exist for its `this` parameter to name. A
    // generic component's params are not in scope at module level, so
    // the parameter takes the erased arguments — the gated-prototype
    // spelling.
    const bodies = info.computedBodies ?? [];
    if (info.behavior === null || bodies.length === 0) return;
    // The schema behavior const's guard, for the component spelling: a
    // user module binding of the minted `__X__computed` name redeclares
    // the face-only const (TS2451 on the component head) while the JS
    // runs fine. Loud and positioned beats a checker error blamed on
    // the wrong construct.
    if (this.scopes[0]?.has(info.behavior) || this.moduleBound?.has(info.behavior)) {
      throw this.positionedError(compNode,
        `emitter: the module binds '${info.behavior}', the face-only name this component's ` +
        'computed types read through — rename the binding');
    }
    const selfType = `${name}${anyArgsOf(typeParams)}`;
    this.b.tsOnly(() => this.b.echo(() => {
      this.b.emit('\n' + pad);
      this.mark(compNode, '$self', () => {
        this.b.emit(`const ${info.behavior} = {`);
        // A multi-statement body is already a BRACED FUNCTION BODY
        // (computedBody's funcBlock path) and takes the parameter list
        // directly; wrapping it in `return …` would emit
        // `return { let x = …; }`, which does not parse. A
        // single-expression body is a value and needs the return.
        // `this: Name` marks its copies only where the name's binding
        // is found.
        bodies.forEach(({ name: n, code, block }, i) => {
          this.b.emit(`${i > 0 ? ',' : ''} ${n}: function (this: `);
          if (nameAt >= 0) this.emitCopiesOf(selfType, declared, compId);
          else this.b.emit(selfType);
          this.b.emit(`) ${block ? code : `{ return ${code}; }`}`);
        });
        this.b.emit(' };');
      });
    }));
  }

  // A component member's declaration name, at the coordinates the declare
  // line re-marks — the SAME role the face maps, so the span the editor
  // tests is the span the mapping resolves. Only members the face
  // declares as CONTAINERS are recorded: a member that declares its value
  // type directly has nothing to see past, and one whose own annotation
  // spells the container shape by hand meant that shape. The channel also
  // carries every IN-BODY reactive read (memberRead — where the lowering
  // appended `.value` to a bare name), so the channel's meaning is "a
  // position that answers VALUE-FIRST"; a consumer holding an instance
  // is in neither set and keeps the container.
  noteMemberDecl(m) {
    if (!this.ts) return;
    const id = this.rowIdOf(m.nameNode);
    const row = id !== null ? this.stores.role(id, m.nameRole) : null;
    if (!row || typeof row.sourceStart !== 'number') return;
    // The member's minted kind (memberLabel). An optional member carries
    // its marker: the face declares the instance member required (its
    // cell is always assigned), so the `?` the author wrote survives only
    // here, and the head says `name?:` the way TypeScript's own does.
    const label = Emitter.memberLabel(m);
    if (label !== null) {
      // An accept's row names its provider, so a miss reported on the name
      // can say which component was asked (mapTsDiagnostic).
      this.kinds.push({ start: row.sourceStart, end: row.sourceEnd, label, name: m.name, optional: m.optional === true,
        ...(m.kind === 'accept' && m.provider != null ? { provider: m.provider } : {}) });
    }
    if (declaresContainer(m)) this.memberDecls.push({ start: row.sourceStart, end: row.sourceEnd });
  }

  // A declaration's minted kind, at the SOURCE span of the role that names
  // it — the coordinates a hover arrives in.
  noteKind(node, role, label) {
    const row = this.roleRow(node, role);
    if (row?.sourceStart != null && row.sourceEnd > row.sourceStart) {
      const name = this.b.source?.slice(row.sourceStart, row.sourceEnd) ?? null;
      this.kinds.push({ start: row.sourceStart, end: row.sourceEnd, label, name });
    }
  }

  // The SOURCE span of a bare identifier CHILD: the child's own leaf, when
  // it is one.
  bareChildSpan(args, k) {
    return this.ts && wordOf(args[k]) !== undefined && isNode(args[k]) ? this.leafSpan(args[k], wordOf(args[k]), null) : null;
  }

  // A hoisted target's face type, the first that answers: its recorded
  // annotation, its schema story's type, a forward-referenced
  // component's constructor type, or a probed pin.
  hoistType(entries, name, node, role, owner) {
    if (owner !== null) {
      this.b.tsOnly(() => {
        if (isTypedWrapper(owner) && !this.strict) this.b.emit('!');
        this.mark(owner, 'annotation', () => this.b.emit(`: ${this.annotationText(owner)}`));
      });
      return;
    }
    // A schema binding declares its story type on its scope's hoist
    // line: a DECLARED type answers at every reference — the
    // evolving-let alternative leaves reads inside nested functions
    // hovering the evolving base `any` (tsgo quickinfo, plain-TS
    // parity), which is exactly where model bindings are used. A
    // scope's entries carry its own stories' types alone
    // (attachSchemaConsts), so a same-named binding in another scope
    // never annotates.
    const constType = entries.schemaConsts?.get(name) ?? null;
    if (constType !== null) {
      const bind = this.bindingNameSpan(node, role, name);
      // A binding assigned inside a block (`if c then S = schema …`)
      // and read after is legal Rip, so outside strict the declared
      // type carries the definite-assignment assertion the typed
      // forward carries; strict sees the conditional assignment as the
      // checker reports it (TS2454).
      this.b.tsOnly(() => {
        if (!this.strict) this.b.emit('!');
        this.b.emit(': ');
        this.emitNamedCopies(constType, name, bind?.id ?? null, bind?.span ?? null);
      });
      return;
    }
    // A forward-referenced COMPONENT declares its published constructor
    // type (hoistComponentTypes). It precedes the pin because the type is
    // CONSTRUCTED from the component's own surface rather than probed
    // from a first write — a pin would answer the same question worse,
    // and only after a round trip.
    const ctorType = entries.componentTypes?.get(name) ?? null;
    if (ctorType !== null) {
      // Emitted as SEGMENTS, so the props block's member names map to
      // their declarations — a prop key at a use site lands here.
      const info = entries.componentInfos?.get(name) ?? null;
      const bindId = this.stores.idOf(node);
      const bind = bindId !== null ? this.stores.role(bindId, role) : null;
      const bindSpan = bind?.sourceStart != null && this.b.source?.slice(bind.sourceStart, bind.sourceEnd) === name ? [bind.sourceStart, bind.sourceEnd] : null;
      this.b.tsOnly(() => {
        this.b.emit(`${this.strict ? '' : '!'}: `);
        if (info === null) {
          this.b.emit(ctorType);
          return;
        }
        // Text segments repeating the name (`): Name;`) mark the
        // binding's own span, copy by copy.
        for (const seg of componentCtorSegments(info, name, '', name, { road: 'face' })) {
          if (seg.node !== undefined) this.mark(seg.node, seg.role, () => this.b.emit(seg.text));
          else this.emitNamedCopies(seg.text, name, bindId, bindSpan);
        }
      });
      return;
    }
    // A pin: a caller-supplied inferred type for a still-hoisted
    // nested-referenced name, keyed by name + a hash of the first
    // write's VALUE source text (pinKey). Emitted like a typed forward
    // (`name!: T`) — the `!` keeps Rip's legal read-before-assign quiet,
    // exactly as annotated forwards do.
    const pin = entries.pinnable?.get(name);
    const pinType = pin?.key != null ? this.pins?.get(pin.key) : undefined;
    if (pinType === undefined) return;
    this.b.tsOnly(() => {
      this.pinnedWrites.add(pin.node);
      const at = this.b.offset;
      this.b.emit(`${this.strict ? '' : '!'}: `);
      // The pin is a TYPE the checker inferred, and it spells the
      // module's own type names (`(h: NavHandlers) => void`); each is a
      // copy of that declaration, like every other generated copy.
      this.emitDeclaredTypeCopies(pinType, this.stores.idOf(node));
      this.pinSpans.push([at, this.b.offset]);
    });
  }

  // The descriptor's word-valued strings that repeat a DECLARED name —
  // a field's `name:`, an ensure's `field:`, a `typeName:` naming
  // another schema, a union's constituent, a mixin target — are copies
  // of the author's declaration bytes and pin there. Claimed instead,
  // they would take the declaration's occurrence only while nothing
  // else owned it; once the companion alias places the declaration, a
  // claim slides to the next occurrence of the name, which is a body
  // read (`@items` in a callable), and every later read shifts by one.
  // Pins are keyed by the descriptor key the string sits under and
  // queued in entry order — the order the literal serializes — so two
  // copies of one name pin apart: the field's `name:` to its
  // declaration, the ensure's `field:` to the symbol.
  // Pins are TS-face rows (a caller-spanned `literal` row, like every
  // markSpan row); the runtime face keeps the claim, where nothing
  // else owns the declaration.
  schemaDeclarationPins(node, descriptor, schemaName, story) {
    const pins = new Map();
    const pinSpan = (key, span, name) => {
      if (span === null || span === undefined) return;
      const k = `${key}:${name}`;
      if (!pins.has(k)) pins.set(k, []);
      pins.get(k).push([span[0], span[1]]);
    };
    const pin = (key, name, start) => {
      if (typeof start !== 'number' || typeof name !== 'string') return;
      pinSpan(key, [start, start + name.length], name);
    };
    // The descriptor's OWN `name:` — the schema's registered name — is a
    // copy of the declaration, and queued first so the head's `name:`
    // takes it ahead of any entry that shares the spelling.
    if (schemaName !== null) {
      // A function-local declaration is no line-start match; its name's
      // bytes are the binding ahead of the schema expression.
      const declared = story?.scope
        ? this.bindingNameSpan(node, 'target', schemaName)?.span ?? null
        : this.moduleTypeDeclarationSpans().get(schemaName) ?? null;
      pinSpan('name', declared, schemaName);
    }
    for (const e of descriptor.entries) {
      if (e.tag === 'union-member') pin('name', e.name, e.start);
      else if (schemaBodyReference(e) !== null) pin('target', e.argTokens[0].value, e.argTokens[0].start);
      else if (e.tag === 'ensure') pin('field', e.field, e.fieldStart);
      else if (SCHEMA_BODY_KINDS[e.tag] !== undefined) {
        pin('name', e.name, e.start);
        if (e.tag === 'field' && Array.isArray(e.typeSpan) && this.b.source !== null) {
          const typeWord = IDENT_RE.exec(this.b.source.slice(e.typeSpan[0], e.typeSpan[1]));
          if (typeWord !== null && typeWord[0] === e.typeName) pin('typeName', typeWord[0], e.typeSpan[0] + typeWord.index);
        }
      }
    }
    return pins;
  }

  // A promoted parameter (`constructor: (@owner: string) ->`) assigns
  // the instance property but declares nothing, and TypeScript reads a
  // class's properties from its DECLARATIONS alone — never from what
  // the constructor assigns — so the TS face declares what the
  // promotion implies. TS-only: the JS twin's property comes from the
  // constructor's assignment, where a declaration would not describe
  // the field but REDEFINE it, on class-field semantics. The body's
  // own declaration wins when both spellings are present — one
  // declaration, or TypeScript reads the pair as duplicate identifiers.
  declarePromotedFields(body, ctorParams, declared, pad) {
    for (const p of ctorParams) {
      const field = atParamField(p);
      if (field === null || declared.has(field.name)) continue;
      declared.add(field.name);
      const typed = field.typed;
      const text = typed === null ? null
        : this.typedText(typed, null);
      // The field's name marks the promoted parameter's own bytes (its
      // first occurrence in the class body is the `@name` parameter), so
      // a definition from a read lands on the constructor's parameter.
      const bodyId = this.stores.idOf(body);
      const at = bodyId !== null ? this.leafSpansIn(body, field.name)[0] ?? null : null;
      this.b.tsOnly(() => {
        this.b.emit(pad);
        if (at) this.b.markSpan(bodyId, 'identifier', at[0], at[1], () => this.b.emit(field.name));
        else this.b.emit(field.name);
        this.b.emit(`${text ? `: ${text}` : ''};\n`);
      });
    }
  }

  // An instance method's `@field = value` is the same story as a
  // promoted parameter, by a different route: it assigns the instance
  // property and declares nothing, and TypeScript reads a class's
  // properties from its declarations alone — so every assignment AND
  // every read publishes TS2339 on code that runs correctly. The face
  // declares what the assignment implies, with the author's own
  // annotation when there is one. TS-only, for the promoted
  // parameter's reason: in JS the property comes from the assignment,
  // where a declaration would REDEFINE it rather than describe it.
  //
  // Control flow is walked THROUGH (a field assigned inside an `if`
  // still declares) but a nested plain function is not: its `this` is
  // not this instance's, so an assignment there says nothing about this
  // class. The `declared` set keeps a body-level declaration winning,
  // here as for promotions — one declaration, or TypeScript reads the
  // pair as duplicate identifiers.
  //
  // A field only a BOUND ARROW assigns spells `: any` when the author
  // did not annotate it: TypeScript's constructor inference does not
  // descend into arrows, so its bare declaration would be an implicit
  // any — TS7008 under noImplicitAny, minted on generated-only bytes
  // no source position answers for (the tsScaffoldAny doctrine).
  //
  // EVERY instance method feeds this, not the constructor alone — see
  // ctorAtFields. The constructor leads so source order holds.
  declareAssignedFields(bodies, declared, pad) {
    for (const at of ctorAtFields(bodies)) {
      if (declared.has(at.name)) continue;
      declared.add(at.name);
      // The annotation can ride ANY of the field's assignments — the
      // first one that resolves wins, so ordering against an arrow's
      // earlier unannotated write cannot drop it.
      const annotated = at.nodes.map((n) => this.annotationText(n)).find((t) => t != null) ?? null;
      const text = annotated ?? (at.viaArrow ? 'any' : null);
      this.b.tsOnly(() => this.b.emit(`${pad}${at.name}${text ? `: ${text}` : ''};\n`));
    }
  }

  // True when something OTHER than the parameter list already types a
  // function's parameters, so JS arity must not touch them: marking a
  // contextually-typed `number` optional widens it to `number | undefined`
  // and publishes TS18048 on correct code. Three sources:
  //
  //   ARGUMENT POSITION — `nums.reduce((acc, n) => acc + n, 0)` writes no
  //     annotation, but `reduce` types `acc` and `n`. Tested by containment
  //     in an `args` role span, so a callback nested in another callback is
  //     one too. A `def` inside a callback body is swept along; that only
  //     WITHHOLDS the marker, which is the safe direction.
  //
  //   AN ANNOTATED BINDING — `doubler: (n: number) => string = (n) => …`
  //     types `n` from the target's annotation, not from the parameter.
  //
  //   HANDLER-PARAM INJECTION — the compiler's own, handled where it is
  //   applied (`injectedTypes` in emitParams).
  contextuallyTyped(node) {
    const id = this.stores.idOf(node);
    const self = id === null ? null : this.stores.node(id);
    if (!self || typeof self.sourceStart !== 'number') return false;
    this._argSpans ??= this.stores.roles
      .filter((r) => r.role === 'args' && typeof r.sourceStart === 'number')
      .map((r) => [r.sourceStart, r.sourceEnd]);
    if (this._argSpans.some(([s, e]) => self.sourceStart >= s && self.sourceEnd <= e)) return true;
    this._annotatedValueSpans ??= (() => {
      const spans = new Set();
      const annotated = [];
      for (const n of this.stores.nodes) {
        if (n.semanticKind !== 'assign' && n.semanticKind !== 'pair') continue;
        if (!this.stores.role(n.nodeId, 'annotation')) continue;
        const v = this.stores.role(n.nodeId, 'value');
        if (typeof v?.sourceStart === 'number') {
          spans.add(`${v.sourceStart}:${v.sourceEnd}`);
          annotated.push([v.sourceStart, v.sourceEnd]);
        }
      }
      // A pair's value INSIDE an annotated value types through it too:
      // `cart: Cart = { addItem: (product) -> … }` — the annotation on
      // the binding reaches the member the way TS contextual typing
      // does, through the literal. Containment must STOP at function
      // boundaries, exactly where TS's contextual typing stops: a
      // literal built inside a nested function body has no contextual
      // type, and sweeping its pairs would withhold the JS-arity `?`
      // from parameters TS then requires at every call (TS2554 on
      // legal fewer-arg calls). A function-valued pair itself is fine —
      // the pair node starts at its key, before its value's boundary.
      const funcSpans = [];
      for (const n of this.stores.nodes) {
        if ((n.semanticKind === 'func' || n.semanticKind === 'def' || n.semanticKind === 'class') &&
            typeof n.sourceStart === 'number' &&
            annotated.some(([s, e]) => n.sourceStart >= s && n.sourceEnd <= e)) {
          funcSpans.push([n.sourceStart, n.sourceEnd]);
        }
      }
      for (const n of this.stores.nodes) {
        if (n.semanticKind !== 'pair' || typeof n.sourceStart !== 'number') continue;
        if (!annotated.some(([s, e]) => n.sourceStart >= s && n.sourceEnd <= e)) continue;
        if (funcSpans.some(([s, e]) => n.sourceStart >= s && n.sourceEnd <= e)) continue;
        const v = this.stores.role(n.nodeId, 'value');
        if (typeof v?.sourceStart === 'number') spans.add(`${v.sourceStart}:${v.sourceEnd}`);
      }
      return spans;
    })();
    return this._annotatedValueSpans.has(`${self.sourceStart}:${self.sourceEnd}`);
  }

  // The type text a typed form carries: its recorded annotation, else
  // the lexer's opaque type value, else `missing`.
  typedText(node, missing = '') {
    return this.annotationText(node) ?? (isNone(node[3]) ? missing : tidyType(node[3][2]));
  }

  // The trailing parameters JS arity leaves optional (src/ts/types.js
  // holds the one definition both signature emitters read).
  arityOptional(list) {
    return jsArityOptional(list);
  }

  // A postfix type's spelling: the recorded source bytes (`as T` /
  // `satisfies T`, the token's span) — byte-equal emission lets the
  // builder classify the annotation row exact, the mapping contract's
  // spelling at exact positions — else the rendered type.
  postfixTypeSpelling(node) {
    const row = this.roleRow(node, 'annotation');
    return row && row.sourceStart != null && this.b.source !== null
      ? this.b.source.slice(row.sourceStart, row.sourceEnd)
      : `${node[0] === 'cast' ? 'as' : 'satisfies'} ${tidyType(node[3][2])}`;
  }

  // A typed reactive declaration types its CONTAINER — the annotation
  // names the `.value` slot (the dts convention; a computed's container
  // is read-only from the outside), and the container carries the
  // `read(): T` structural brand (the runtime's detection predicate —
  // src/ts/components.js has the doctrine): a plain `{ value: … }`
  // literal must never satisfy a container position the runtime would
  // double-wrap. An unannotated reactive with a syntactically-evident
  // value type annotates its container from the initializer alone —
  // `clicks := 0` is a number cell, `~= clicks * 2` a readonly number
  // cell — so the cell CHECKS and the hover has a value type to present.
  // Other initializers infer through the runtime's generic signature.
  // No `satisfies` here: the type came FROM the value.
  tsReactiveAnnotation(node, head, value) {
    const ro = head === 'computed' ? 'readonly ' : '';
    const text = this.annotationText(node);
    if (text !== null) {
      this.tsAnnotate(node, 'annotation', containerType(text, ro, MINTED));
      return;
    }
    const t = syntacticLiteralType(value);
    if (t !== null) this.b.tsOnly(() => this.b.emit(`: ${containerType(t, ro, MINTED)}`));
  }

  // A component's type story (src/ts/components.js), walked once.
  componentTypeInfoOf(node, behavior) {
    return componentTypeInfo(this.stores, this.b.source, node, behavior);
  }

  // The props a construction must pass.
  requiredProps(info) {
    return publicProps(info).filter((m) => !m.optional && !m.hasDefault).map((m) => m.name);
  }

  // `_init`'s props parameter type.
  tsInitPropsType(info) {
    this.b.tsOnly(() => { this.b.emit(': '); this.emitDeclaredTypeCopies(propsTypeText(info, { road: 'face' })); });
  }

  // Does a plain (`'plain'`) or state (`'state'`) member take a behavior
  // thunk the form table cannot spell?
  behaviorValued(member, kind) {
    return kind === 'plain' ? plainBehaviorValued(member) : stateBehaviorValued(member);
  }

  // The mutable type a readonly member's `_init` write casts `this` to.
  readonlyCastText(member) {
    return member ? readonlyCastType(member) : 'any';
  }

  // A gate's cell type under a discovered stash: the stash projection.
  gateProjectionText(gate) {
    return this.appStashSpec !== null ? gateProjection(gate, this.appStashSpec) : null;
  }

  callableParamType(name, handlerEvents) {
    const evRec = handlerEvents.get(name);
    if (evRec === undefined) return hookParamTypes(name);
    const evHost = !evRec.unknownHost && evRec.hosts.size > 0 ? [...evRec.hosts].join(' | ') : null;
    return this.tsEventTypeText([...evRec.events], evHost);
  }

  // A child's declared host record: `NonNullable<InstanceType<typeof
  // Child>['__host']>`, the child's name emitted by `childName`.
  emitHostRecord(childName) {
    this.b.emit('NonNullable<InstanceType<typeof ');
    childName();
    this.b.emit(`>['${HOST}']>`);
  }

  // The TS type of a DOM element by tag and namespace.
  elementTypeText(tag, svg) {
    return hostText(tag, svg);
  }

  // A render element's tag word joins the intrinsics channel when its
  // tag has a surface.
  noteIntrinsicTag(span, tag, svg) {
    if (surfaceableTag(tag, svg)) this.intrinsics.push({ start: span[0], end: span[1], kind: 'tag', tag, svg });
  }

  // A named handler ref (`@submit: @handleSubmit`, or the bare
  // `@submit: handleSubmit` spelling) types the METHOD's event
  // parameter at its definition: the render tree is scanned for
  // `@event: method` attribute pairs before the methods emit, and a
  // matched method's first parameter — when the author left it a bare
  // name — takes the event's face type (the union, when one method
  // serves several events). An annotated parameter is the author's own
  // claim and is never overridden.
  componentHandlerEvents(renderNode, members) {
    const handlerEvents = new Map();
    if (renderNode === null) return handlerEvents;
    // The walk carries the nearest enclosing ELEMENT (tag + namespace)
    // so the param's `target`/`currentTarget` can claim the host type
    // (RULINGS.md § the render DSL). A component use clears the context
    // — its listener attaches to the child's root, which this scan
    // cannot name — and a method serving several hosts claims their
    // union.
    const scan = (x, host) => {
      if (!isStruct(x) || (isNode(x) && (x[0] === 'type' || x[0] === 'schema'))) return;
      let next = host;
      // A render `switch` STATEMENT carries the host through to its
      // arms; its node shape is told apart before the tag test because
      // `switch` is also an SVG tag (the render walk's own dispatch
      // order).
      const tag = x[0] === 'switch' && x.length === 5 ? null : Emitter.templateHeadTag(x);
      // `object` is BOTH the object-literal node head and an HTML tag.
      // Direct `:` pairs, shorthand ones included, mark the LITERAL (an
      // element's pairs arrive wrapped in their own object child), and a literal is
      // transparent — its element's context flows through to the
      // handlers it carries. Anything else spelled `object` is
      // ambiguous and clears the context: a real `<object>`'s handlers
      // must not inherit the outer tag, and no wrong claim beats either
      // right one.
      if (tag === 'object') {
        next = this.isObject(x) && x.slice(2).some((p) => isNode(p) && p[0] === ':') ? host : null;
      } else if (tag !== null && TEMPLATE_TAGS.has(tag)) {
        next = { tag, svg: host?.svg === true || SVG_ONLY_TAGS.has(tag) };
      } else if (isCall(x) && /^[A-Z]/.test(wordOf(x[2]) ?? '')) {
        next = null;
      }
      // A shorthand `{@click}` is `@click: @click`, a handler as surely.
      const event = isValuePair(x) ? thisField(x[2]) : null;
      if (event !== null && DOM_EVENTS.has(event)) {
        const handler = wordOf(x[3]) ?? thisField(x[3]);
        if (handler != null && members.has(handler)) {
          if (!handlerEvents.has(handler)) handlerEvents.set(handler, { events: new Set(), hosts: new Set(), unknownHost: false });
          const rec = handlerEvents.get(handler);
          rec.events.add(event);
          if (host !== null && surfaceableTag(host.tag, host.svg)) {
            rec.hosts.add(hostText(host.tag, host.svg));
          } else {
            rec.unknownHost = true;
          }
        }
      }
      for (let i = isNode(x) ? 2 : 0; i < x.length; i++) scan(x[i], next);
    };
    scan(renderNode, null);
    return handlerEvents;
  }

  // A component binding that STAYS on the hoist line is exactly a
  // forward-referenced one — a binding whose first write can declare
  // in place left above, taking the class expression with it and
  // typing from it. Split from its declaration the initializer is not
  // there to infer from, and the evolving `let` serves only
  // same-function references (TS7034 at the declaration, TS7005 at
  // every read inside a render body). The name's own published
  // constructor type answers instead — the same surface the shipped
  // `.d.ts` carries, so the two roads cannot disagree.
  hoistComponentTypes(kept, scan, node) {
    kept.componentTypes = new Map();
    for (const [name, , role] of kept) {
      if (role !== 'target') continue;
      const first = scan.get(name)?.firstWrite ?? null;
      if (first === null) continue;
      const write = node(first);
      const v = write[3];
      if (!isStruct(v) || !this.isComponentDecl(v)) continue;
      // A GENERIC component DECLINES and keeps the floor. Its class
      // expression instantiates its own parameter through the optional
      // props slot — the constructor yields `Box<T | undefined>` where
      // the published surface returns `Box<T>` — so the annotation
      // would be one the class cannot satisfy, trading the floor's
      // ordinary implicit-any for a TS2322 on the declaration that
      // names only generated types. The `.d.ts` road spells the same
      // surface safely because a declaration is never checked against
      // an implementation; only here must the class satisfy it.
      if (this.annotationText(write, 'typeParams') !== null) continue;
      const info = this.componentTypeInfoOf(v, `__${name}__computed`);
      info.appStashSpec = this.appStashSpec;
      info.routesUnion = this.routesUnion;
      info.routeParams = this.routeParams;
      kept.componentTypes.set(name, `{ ${componentCtorMembers(info, name, '', name, { road: 'face' }).join(' ')} }`);
      (kept.componentInfos ??= new Map()).set(name, info);
    }
  }

  // ── TS directive comments ───────────────────────────────────
  //
  // A whole-line Rip comment spelling a TypeScript directive —
  // `# @ts-expect-error …`, `# @ts-ignore …`, or the file-level
  // `# @ts-nocheck` — reaches the TS face as a TS-only comment line
  // (`// @ts-…`) under a PLACE-OR-DECLINE rule: a directive places only
  // where TypeScript's line-granular suppression is PRECISE — where the
  // governed thing's diagnostics land on the one face line beneath the
  // directive. Where they cannot, it declines: the comment stays an
  // ordinary Rip comment, the error stays visible, and no spurious
  // TS2578 appears. Placements, and what still declines:
  //   - a live statement — ALWAYS, on its own head line, however many
  //     lines the statement emits (`withTsDirectives`) — declining on
  //     multi-line emissions would silently delete the author's escape
  //     hatch on the dominant case (an arrow assigned to a typed
  //     binding, whose error lands on the head line the directive
  //     governs). An error that lands on an INNER line of a
  //     lowering is simply not suppressed, and surfaces as TS2578
  //     (unused) — visible and actionable, not a silent drop;
  //   - the scope's hoist line for a bare typed forward, ONLY when that
  //     line declares a single name (their only manifestation —
  //     `let a!: T`). A multi-name hoist line DECLINES (`hoistLine`):
  //     one directive would also swallow the sibling names' unrelated
  //     errors;
  //   - the scope-top cluster line for a type declaration, ONLY when the
  //     rendered declaration is a single line. A multi-line body (object
  //     alias, interface) DECLINES (`tsTypeDeclLine`): its errors land
  //     on inner lines the directive cannot govern;
  //   - the overload row for def-sig signatures (always one line).

  // One directive line: `//` + the comment's own bytes past the `#`
  // (description preserved verbatim), the newline, and the pad that
  // keeps the surrounding indentation intact (`padFirst` places the
  // pad before the directive where the caller has not emitted it yet
  // — class member rows own their pads) — all one TS-only region, so
  // stripping deletes the whole line. The mapping row rides the
  // caller-span mark: the comment's real trivia span against the
  // emitted `// …` bytes — cover by the builder's comparison (`#`
  // versus `//` never matches verbatim), on the governed statement's
  // node under the 'tsDirective' role (the runtime-injection
  // precedent for rows whose role has no RoleStore entry).
  tsDirectiveLine(d, pad, padFirst = false) {
    this.b.tsOnly(() => {
      if (padFirst) this.b.emit(pad);
      this.b.markSpan(d.nodeId, 'tsDirective', d.t.start, d.t.end, () => {
        this.b.emit('//' + d.t.text.slice(1));
      });
      this.b.emit(padFirst ? '\n' : '\n' + pad);
    });
  }

  // Directive placement around one statement-position emission
  // (statements, implicit returns, class member rows): the directives
  // governing the statement always emit above its HEAD line, however
  // many lines the statement emits. An arrow or function assigned to a
  // typed binding reports its error on that head line, which the
  // directive governs precisely; declining a multi-line statement would
  // delete the author's escape hatch on that dominant case. A directive
  // whose error lands on an INNER line doesn't suppress it and
  // surfaces as TS2578 — visible and actionable, never a silent drop.
  withTsDirectives(node, pad, fn, padFirst = false) {
    const attached = this.takeTsDirectives(node);
    if (attached !== undefined) for (const d of attached) this.tsDirectiveLine(d, pad, padFirst);
    fn();
  }

  // A scope's hoist line is the only manifestation of its bare typed
  // forwards (`let a!: T`), so it takes their directives. Each remembers
  // its forward: when the forward's annotation re-homes inline at a
  // declaring write, applyDeclareInPlace moves the directive there.
  hoistDirectives(forwards) {
    const out = [];
    for (const f of forwards) {
      for (const d of this.takeTsDirectives(f) ?? []) { d.forwardOwner = f; out.push(d); }
    }
    return out;
  }

  // The def's recorded overload signatures (TS face): each prints as a
  // bodiless TS overload row immediately above the implementation —
  // name/params/returnType marked from the def-sig's own roles. An
  // exported implementation prints them ahead of its own `export`,
  // each row exported too: TypeScript refuses overloads that are not
  // all exported or all local (TS2383).
  tsOverloadSigs(node, ind, exported = false) {
    const sigs = this.pendingSigs.get(node);
    if (!sigs) return;
    this.pendingSigs.delete(node);
    for (const sig of sigs) {
      // The overload row reads the SAME optionalMarker role the face's
      // main param path and dts.js read, so the editor and the shipped
      // types agree on an optional parameter.
      const params = this.tsRendered(sig, () => renderParams(sig[3], optionalReader(this.stores)));
      // A directive above the signature follows it to its overload
      // row — the line its diagnostics land on.
      for (const d of this.takeTsDirectives(sig) ?? []) this.tsDirectiveLine(d, '  '.repeat(ind));
      this.b.tsOnly(() => {
        this.mark(sig, '$self', () => {
          if (exported) this.b.emit('export ');
          this.b.emit('function ');
          this.mark(sig, 'name', () => this.b.emit(wordOf(sig[2])));
          const tp = this.annotationText(sig, 'typeParams');
          if (tp !== null) this.mark(sig, 'typeParams', () => this.emitTypeText(sig, 'typeParams', tp));
          this.mark(sig, 'params', () => this.b.emit(params));
          this.mark(sig, 'returnType', () => this.emitTypeText(sig, 'returnType', `: ${tidyType(wordOf(sig[4]))}`));
          this.b.emit(';');
        });
        this.b.emit('\n' + '  '.repeat(ind));
      });
    }
  }

  // The schema behavior object, after its binding statement (the
  // companion placement): a TS-only line whose properties re-carry the
  // descriptor's compiled callable bodies, so the companion's
  // `ReturnType<typeof …>` members resolve to what each body returns.
  tsSchemaBehavior(schemaNode) {
    const story = this.schemaStories?.get(schemaNode) ?? null;
    const fns = this.schemaFns.get(schemaNode);
    if (story === null || fns === undefined) return;
    const text = behaviorObjectText(schemaNode[2][2], story.decl.name, fns, story.thisTypes);
    if (text === null) return;
    this.schemaBehaviorPending.delete(schemaNode);
    // The behavior const's name is face-only but not invisible: a user
    // binding of the same spelling in the scope the const lands in — or,
    // for a function-local schema, in any scope the const would shadow
    // — redeclares or captures it in the TS face (TS2451 blamed on the
    // schema head) while the JS runs fine — the worst kind of
    // divergence. Rejected loudly here, the `__schema`-shadow
    // precedent; every minted TYPE name is already guarded the same
    // way (buildSchemaTypeStory).
    const bound = story.scope
      ? this.scopes.some((s) => s.has(story.behaviorName))
      : this.scopes[0]?.has(story.behaviorName);
    if (bound || this.moduleBound?.has(story.behaviorName)) {
      throw this.positionedError(schemaNode,
        `emitter: ${story.scope ? 'an enclosing scope' : 'the module'} binds '${story.behaviorName}', the face-only name this schema's ` +
        'callable types read through — rename the binding');
    }
    const id = this.stores.idOf(schemaNode);
    this.b.tsOnly(() => this.b.echo(() => {
      this.b.emit('\n' + '  '.repeat(this.ind));
      if (id !== null) this.b.mark(id, '$self', () => { const bind = this.bindingNameSpan(story.decl.node, 'target', story.decl.name); this.emitNamedCopies(text, story.decl.name, bind?.id ?? null, bind?.span ?? null); });
      else this.b.emit(text);
    }));
  }

  // The modifier's one generated manifestation: `private` on the TS
  // face, exact on its own bytes. The JS twin carries nothing — the
  // modifier erases exactly as an annotation does.
  tsPrivate(node) {
    if (!this.isPrivateMember(node)) return;
    this.b.tsOnly(() => {
      this.mark(node, 'visibility', () => this.b.emit('private'));
      this.b.emit(' ');
    });
  }
}

// The schema type story, built once per module: the
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
function schemaStory(emitter, program, programId) {
  const { b: builder, stores } = emitter;
  let story;
  try {
    story = buildSchemaTypeStory(program, builder.source,
      importedNames(program.slice(2).filter((s) => emitter.isModuleImport(s))),
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
  builder.syntheticRow(programId, 'schemaTypes', start);
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
function emitStashType(emitter, program, stashLocal) {
  const { b: builder, stores } = emitter;
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
function emitHelperDecls(emitter) {
  const builder = emitter.b;
  // Ambient `RoutePath` — the route union under a clean public name, so
  // app code can annotate data-driven hrefs (a nav array, props
  // forwarded to an anchor) without reaching any internal spelling.
  // Injected only when this module REFERENCES the name and neither
  // declares nor imports its own — a user-defined `RoutePath` always
  // wins, so no duplicate-identifier clash is possible. The tests run
  // against the GENERATED face, where a multi-line import list has been
  // flattened to one statement, so the line-bounded import regex sees
  // every spelling; the face's own emissions never introduce the name.
  if (emitter.routesUnion !== null) {
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
  if (emitter.domSurfaces.size > 0 || emitter._needsClassValue === true || emitter._needsCssProperties === true || emitter._needsRefCellHelper === true || emitter._needsChildren === true || emitter._restTags.size > 0) {
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
  if (emitter.validatorRegistrations.length > 0) {
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

// The strip transform: delete the recorded TS-only regions from a
// TS-face emission. Deterministic and mechanical — regions were
// recorded as the face emitted them (never scanned out of generated
// text), ascending and disjoint by construction. The strip gate
// (test/lang/tsface.test.js) holds this equal to the JS-mode emission
// byte-for-byte across the corpus.
export function stripFace(code, tsRegions) {
  let out = '';
  let cursor = 0;
  for (const [start, end] of tsRegions) {
    out += code.slice(cursor, start);
    cursor = end;
  }
  return out + code.slice(cursor);
}
