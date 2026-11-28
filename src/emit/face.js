// The TS face (the editor face), the component face and TS directive
// comments.
//
// Every method below is a no-op path in JS mode: the TS face emits
// the SAME code through the SAME mark protocol, plus TypeScript type
// syntax whose every byte records as a builder tsOnly region.
// Annotation text always renders from the RECORDED store spans (annotation
// side-band roles) or the lexer's opaque TYPE_DECL/typed-var values —
// never re-derived, never invented.
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

import { MappingBuilder } from './mapping.js';
import { behaviorObjectText } from '../schema.js';
import { IDENT_PART, IDENT_SOURCE, IDENT_RE, identifierMatches } from '../ident.js';
import { TypeTextError, normalizeTypeText, tidyType, renderTypeDecl, renderParams, optionalReader } from '../ts/types.js';
import { DOM_EVENTS } from '../dom.js';
import { attrValsName, elSurfaceName, hostText, surfaceableTag } from '../ts/dom-types.js';
import { restAliasName, restOfComponentText, restViewOfComponentText, memberDeclareSegments, isDeclarableMember, ambientClassDeclares, OFFERS, offersRecordText, HOST, hostTypeText, propsTypeSegments, propsParamOptional, instanceTypeLines, restContainerType, runtimeApiDeclares, selfArgsOf, anyArgsOf } from '../ts/components.js';
import { typeIdentifierTokens, isShapedNode } from './helpers.js';
import { Emitter } from './core.js';
import { referencesNames } from './walks.js';
import { SCHEMA_BODY_KINDS, schemaBodyReference } from './schema.js';

// Where an entry's schema reference sits in the alias text `text`: a
// union constituent or a mixin target follows its operator (`= A | B`,
// `& M`), which keeps it apart from a same-named member; a relation
// target is the accessor's return type (`partner(…): Promise<Partner |
// null>`, `orders(…): Promise<Order[]>`), matched through the accessor
// so two relations to one schema each find their own. Null when the
// entry names no schema or the text carries no reference for it (an
// unknown target renders `unknown`).
function schemaReferenceIn(e, text) {
  const esc = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ref = e.tag === 'union-member' && typeof e.start === 'number' ? { name: e.name, start: e.start, accessor: null } : schemaBodyReference(e);
  if (ref === null) return null;
  const pattern = ref.accessor === null
    ? `(?:= |\\| |& )(${esc(ref.name)})(?= \\||;| &)`
    : `(?:\\{ |; )${esc(ref.accessor)}\\([^)]*\\): Promise<(${esc(ref.name)})(?=\\[\\]>| \\| null>)`;
  const m = new RegExp(pattern, 'd').exec(text);
  if (m === null) return null;
  return { name: ref.name, start: ref.start, at: m.indices[1][0] };
}

// `text` is the block's alias text as emitted, starting at generated
// offset `at` — the caller hands over the string it just built rather
// than the face re-joining its chunks (a mark is open here, so the
// builder's `code` getter joins the whole output on every read).
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
  const esc = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The alias head names the schema's binding: its declaration bytes are
  // the nearest whole-word occurrence of the name ahead of the schema
  // expression (`Hop = schema …`).
  // A story may declare several aliases (`type ParcelData = …; type
  // Parcel = ParcelData & …`): each head whose name the source declares
  // marks every whole-word copy of it — the head, a `Promise<Name>`
  // return, a self-reference — to the one declaration span; a minted
  // head (`ParcelData`) has no source occurrence and marks nothing, and
  // a minted `__Name__behavior` is one word to the underscore, not a copy.
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
    for (const m of text.matchAll(new RegExp(`([{;] )((?:readonly )?)(${esc(e.name)})(\\??: )`, 'g'))) {
      marks.push({ at: m.index + m[1].length + m[2].length, len: e.name.length, start: e.start, end: e.start + e.name.length });
      if (typeWord === null) continue;
      const after = m.index + m[0].length;
      const stop = text.indexOf(';', after) < 0 ? text.length : text.indexOf(';', after) + 1;
      const tm = new RegExp(`(?<!${IDENT_PART.source})${esc(typeWord[0])}(?!${IDENT_PART.source})`).exec(text.slice(after, stop));
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
    const heads = [...new Set([...text.matchAll(new RegExp(String.raw`(?:^|\n)[ \t]*(?:export )?type (${IDENT_SOURCE})`, 'g'))].map((m) => m[1]))];
    for (const headName of heads) {
      if (named.has(headName)) continue;
      // `+ 1` admits an occurrence starting exactly AT the span (see
      // bindingNameSpan); a MINTED head (`UserData`) has no source
      // occurrence and contributes nothing.
      let from = selfSpan[0] + 1, nameAt = -1;
      while (from > 0) {
        const i = src.lastIndexOf(headName, from - 1);
        if (i < 0) break;
        if (!IDENT_PART.test(src[i - 1] ?? ' ') && !IDENT_PART.test(src[i + headName.length] ?? ' ')) { nameAt = i; break }
        from = i;
      }
      if (nameAt >= 0) named.set(headName, [nameAt, nameAt + headName.length]);
    }
    // A copy fills in only where nothing already marks: an entry above
    // mapped a USE SITE to the bytes the author wrote there (a field's
    // type word, a union constituent, a mixin target), and that position
    // answers about the use, not about the declaration it names.
    const claimed = (at, len) => marks.some((mk) => at < mk.at + mk.len && mk.at < at + len);
    for (const [name, span] of named) {
      for (const m of text.matchAll(new RegExp(`(?<!${IDENT_PART.source})${esc(name)}(?!${IDENT_PART.source})`, 'g'))) {
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

function recordSchemaFields(emitter, block, text, at) {
  const entries = block.story?.decl?.descriptor?.entries ?? null;
  if (entries === null) return;
  const esc = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    const name = esc(e.name);
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

export class FaceMethods {
  // Emit already-rendered type text while marking every source-backed
  // identifier from the owning recorded span. Inserted identifiers (notably
  // Promise around async returns) stay unmarked; source identifiers match in
  // order, so repeated names retain occurrence identity without a query-time
  // ordinal guess.
  emitTypeText(node, role, text) {
    const id = this.stores.idOf(node);
    const row = id === null ? null : role === '$self'
      ? this.stores.node(id) : this.stores.role(id, role);
    const source = this.b.source;
    if (!this.ts || id === null || row?.sourceStart == null || source === null) {
      // No row to match within — the node is SYNTHESIZED (the constructor's
      // promoted-parameter strip rebuilds each typed-var, losing its store
      // identity). The type names are still source reads, so they claim their
      // occurrences in the enclosing frame instead of emitting blind.
      if (this.ts && source !== null) {
        let at = 0;
        for (const token of typeIdentifierTokens(text)) {
          this.b.emit(text.slice(at, token.start));
          this.emitPrimitive(token.value);
          at = token.end;
        }
        this.b.emit(text.slice(at));
        return;
      }
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
    // some. Greedy first-match let an inserted token steal a later
    // source occurrence's span — the author's `Promise` marking the
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
        // (to the enclosing cover row, as before).
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

  // The recorded annotation text for (node, role): the role's source
  // slice, annotation sigil stripped, layout-normalized. Null when the
  // node carries no such role (untyped constructs) or the role is
  // literal-sourced (no span).
  annotationText(node, role = 'annotation') {
    const id = this.stores.idOf(node);
    if (id === null) return null;
    const row = this.stores.role(id, role);
    if (!row || row.sourceStart == null || this.b.source === null) return null;
    return normalizeTypeText(this.b.source.slice(row.sourceStart, row.sourceEnd).replace(/^\s*:\s*/, ''));
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
    if (!this.ts) return;
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
    if (!this.ts) return;
    this.placeSchemaScope(list, pad);
    for (const s of list) {
      if (!isShapedNode(s) || s[0] !== 'type-decl') continue;
      this.tsTypeDeclLine(s, pad);
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
    const lines = this.tsRendered(s, () => renderTypeDecl(s[1]));
    // A directive above the declaration follows it to its cluster
    // line — ONLY when the rendered declaration is a single
    // line, where a genuine error suppresses there and an unused
    // directive self-reports TS2578. A multi-line body (object
    // alias, interface) declines: its errors land on inner lines
    // the directive cannot govern (place-or-decline).
    const directives = this.tsDirectiveMap.get(s);
    if (directives !== undefined) {
      this.tsDirectiveMap.delete(s);
      if (lines.length === 1) {
        for (const d of directives) this.tsDirectiveLine(d, pad, true);
      }
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
    if (!this.ts || this.pendingTypeDecls.length === 0) return;
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
  // Generated text with no name of its OWN to copy — a props type's
  // structural pieces, an `_init` parameter — still spells the module's
  // declared types. Each copy marks its declaration; the owner is the
  // construct being emitted, since the SPAN is what identifies the
  // source bytes a rename must reach.
  emitDeclaredTypeCopies(text, id = null) {
    const owner = id ?? this.b.currentMark?.nodeId ?? null;
    if (owner === null || !this.ts) { this.b.emit(text); return; }
    this.emitNamedCopies(text, null, owner, null);
  }

  emitNamedCopies(text, name, id, span) {
    if (id === null || !this.ts) { this.b.emit(text); return; }
    const declared = this.moduleTypeDeclarationSpans();
    if (name !== null && span !== null) declared.set(name, span);
    if (declared.size === 0) { this.b.emit(text); return; }
    let cursor = 0;
    for (const m of identifierMatches(text)) {
      const at = declared.get(m[0]);
      if (at === undefined || m.index < cursor) continue;
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
            const use = new RegExp(`(?<!${IDENT_PART.source})${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!${IDENT_PART.source})`, 'g');
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
    const id = isShapedNode(node) ? this.stores.idOf(node) : null;
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
    let from = self[0] + 1;
    while (from > 0) {
      const i = this.b.source.lastIndexOf(name, from - 1);
      if (i < 0) break;
      if (!IDENT_PART.test(this.b.source[i - 1] ?? ' ') && !IDENT_PART.test(this.b.source[i + name.length] ?? ' ')) return { id, span: [i, i + name.length] };
      from = i;
    }
    return null;
  }

  // An annotation segment the face re-renders around the author's type
  // (`: { value: Item[]; read(): Item[]; … }` for the author's `Item[]`)
  // is a cover of the annotation, so the type words inside it — copies
  // of words the author wrote — map to their own occurrences in the
  // annotation's source, and a rename of `Item` reaches every copy. A
  // segment that repeats the source verbatim maps as one row already.
  emitAnnotationWords(s) {
    if (s.role !== 'annotation' || !this.ts) { this.b.emit(s.text); return; }
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

  // The gate's face twin — v3's construction. The read the author wrote
  // emits as a REAL ts-only expression (`user = __computed(() =>
  // this.stash.user!)`): every path segment claims its source span,
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
      segs.forEach((seg, i) => {
        if (i > 0) this.b.emit('.');
        this.emitPrimitive(seg);
      });
      // The path's root is a PROVIDED name (`@stash`, `@router`): its bytes
      // take the provision's head, as a plain read's do (noteProvidedRead).
      if (this.ts && (segs[0] === 'stash' || segs[0] === 'router')) {
        const id = this.stores.idOf(src.pathNode);
        const span = id !== null ? this.stores.selfSpan(id) : null;
        const hit = span !== null ? this.stores.primitiveSpans(segs[0], span[0], span[1])[0] ?? null : null;
        if (hit && !this.kinds.some((k) => k.start === hit.sourceStart && k.label === segs[0])) {
          this.kinds.push({ start: hit.sourceStart, end: hit.sourceEnd, label: segs[0], name: segs[0], optional: false });
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
          src.keyParts.forEach((seg, i) => {
            if (i > 0) this.b.emit('.');
            this.emitPrimitive(seg);
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
  // noImplicitAny; strictNullChecks varies with the user's tsconfig
  // an explicit `any` keeps swap/reconcile internals
  // quiet under every posture, so effect lines that carry mapped rows
  // to user constructs never inherit scaffold noise.
  tsScaffoldAny(suffix = '') {
    if (this.ts) this.b.tsOnly(() => this.b.emit(`: any${suffix}`));
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
    if (!this.ts) {
      fn();
      return null;
    }
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

  // Capture an emission's text without touching the real output. The
  // builder swaps for a scratch builder over the same stores that records
  // no row, so marks and TS-only regions made during the capture die
  // with it. The rest of what an emission can leave behind is
  // rolled back here, not preconditioned away:
  //
  //   The temp allocator is snapshotted and restored. Captures run in
  //   the TS emission only, so a captured mint (a `for…of` iterable's
  //   un-memoized `_ref`) would advance counters the JS emission never
  //   advances, and every later minting site would drift one name
  //   apart between the faces — the strip gate's byte-equality broken
  //   by a builder the output never sees. Chain temps stay memoized
  //   per node ACROSS the capture on purpose: a captured body is one
  //   the real pass has already emitted, and both must see one name.
  //
  //   The append-only record channels (the token corrections,
  //   pinnables, vocabulary, spans) record into throwaway arrays: a
  //   capture's generated offsets are scratch-relative, and its source
  //   facts duplicate what the real emission of the same nodes already
  //   recorded — either way the entry describes bytes the real face
  //   does not hold.
  //
  // Every capture emits in expression position, so the wrap lives
  // here. `source` stays a per-site choice — emitted text consults
  // `this.b.source` behind null guards (annotation slices, schema
  // code bodies, span scans), so each site keeps the value its captured
  // bytes were shaped under.
  capturedExprText(fn, { source = null } = {}) {
    const prevB = this.b;
    this.b = new MappingBuilder(this.stores, source, { record: false });
    const { n, used } = this.temps;
    this.temps.used = new Set(used);
    const channels = ['pinnables', 'mutables', 'classDecls', 'loopVars', 'attrNames', 'importedRefs', 'runtimeRefs',
      'vocabulary', 'silences', 'memberDecls', 'narrowedDecls', 'importSpans', 'pendingTypeDecls', 'loopVarDecls', 'indexedLoops'];
    const saved = {};
    for (const k of channels) { saved[k] = this[k]; this[k] = []; }
    try {
      this.withExpression(fn);
      return this.b.code;
    } finally {
      this.b = prevB;
      Object.assign(this.temps, { n, used });
      for (const k of channels) this[k] = saved[k];
    }
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
    if (!this.ts || rec === undefined || iter === undefined) return null;
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
    if (this.ts) {
      const tag = this.rstate?.tags?.get(el);
      const svg = this.rstate?.svgEls?.has(el) === true;
      if (typeof tag === 'string' && surfaceableTag(tag, svg)) {
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
    }
    return { surfaced: false, emit: () => this.b.emit(el), valsName: null, hostText: null };
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
    if (!this.ts) { fn(); return null; }
    const start = this.b.offset;
    this.b.tsOnly(() => this.b.emit('('));
    fn();
    // The type is text, or a function that emits it — a site whose type
    // spells a user name maps each copy through the primitive channel.
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
  // props — tsc-clean while the runtime yields a required container
  // holding undefined; 's F2. Requiredness is
  // a type-story fact — the annotation erases, so the gate can
  // never be a runtime throw). `never` because the override must
  // stay assignable to the REAL base's static side in the editor
  // (inline runtime — TS2417 otherwise); only bottom is both
  // assignable and uncallable.
  tsComponentCtor(info, pad) {
    if (info.members.some((m) => m.kind === 'gate')) {
      this.b.tsOnly(() => {
        this.b.emit(`${pad}declare static mount: never;\n`);
        this.b.emit(`${pad}private constructor() { super(); }\n`);
      });
      return;
    }
    if (!propsParamOptional(info)) {
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
      this.b.emit(`${pad}constructor(props${propsParamOptional(info) ? '?' : ''}: `);
      this.emitSegments(propsTypeSegments(info, { road: 'face' }));
      this.b.emit(') { super(props); }\n');
    });
  }

  // The companion interface: a
  // component binding is a VALUE (an anonymous class expression), so
  // an annotation naming it (`c: Counter`) would find no type; the
  // instance surface is the honest companion, and TS's separate
  // type/value namespaces make the same-name pairing legal. Emitted
  // after the binding statement, for plain-name bindings only.
  tsComponentCompanion(compNode, name, exported, typeParams = null) {
    if (!this.ts) return;
    const info = this.componentInfo.get(compNode);
    if (info === undefined) return;
    const pad = '  '.repeat(this.ind);
    // Generic component: the companion interface
    // carries the declaration's type params, and self-references in
    // the instance surface apply the bare param NAMES (`mount():
    // Select<TOption>` — extends clauses stay on the header).
    const selfArgs = selfArgsOf(typeParams);
    this.b.tsOnly(() => {
      this.b.emit('\n' + pad);
      this.mark(compNode, '$self', () => {
        // The interface repeats the component's NAME; it marks the
        // binding's own declaration bytes — the nearest whole-word
        // occurrence ahead of the component expression — so a rename
        // reaching this copy lands on the one span every copy shares.
        const compId = this.stores.idOf(compNode);
        const compSpan = compId !== null ? this.stores.selfSpan(compId) : null;
        let nameAt = -1;
        if (compSpan !== null && this.b.source !== null) {
          let from = compSpan[0];
          while (from > 0) {
            const i = this.b.source.lastIndexOf(name, from - 1);
            if (i < 0) break;
            const before = this.b.source[i - 1] ?? ' ', after = this.b.source[i + name.length] ?? ' ';
            if (!IDENT_PART.test(before) && !IDENT_PART.test(after)) { nameAt = i; break }
            from = i;
          }
        }
        // A text segment that repeats the name (`mount(): Name`) emits in
        // slices, each copy marked the same way.
        // A text segment repeats the component's name (`mount(): Name`) and
        // the module's own declared type names (`remove(item: Item)`): every
        // copy marks the declaration it copies, so a rename of either lands
        // where the declaration is.
        const declared = this.moduleTypeDeclarationSpans();
        if (nameAt >= 0) declared.set(name, [nameAt, nameAt + name.length]);
        const emitNamed = (text) => {
          if (declared.size === 0) { this.b.emit(text); return; }
          let cursor = 0;
          for (const m of identifierMatches(text)) {
            const span = declared.get(m[0]);
            if (!span) continue;
            this.b.emit(text.slice(cursor, m.index));
            this.b.markSpan(compId, 'identifier', span[0], span[1], () => this.b.emit(m[0]));
            cursor = m.index + m[0].length;
          }
          this.b.emit(text.slice(cursor));
        };
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
        // `this: Name` repeats the component's name: each copy marks the
        // binding's own declaration span, like the instance surface's.
        const compId = this.stores.idOf(compNode);
        const compSpan = compId !== null ? this.stores.selfSpan(compId) : null;
        let bindAt = -1;
        if (compSpan !== null && this.b.source !== null) {
          let from = compSpan[0];
          while (from > 0) {
            const i = this.b.source.lastIndexOf(name, from - 1);
            if (i < 0) break;
            if (!IDENT_PART.test(this.b.source[i - 1] ?? ' ') && !IDENT_PART.test(this.b.source[i + name.length] ?? ' ')) { bindAt = i; break }
            from = i;
          }
        }
        bodies.forEach(({ name: n, code, block }, i) => {
          this.b.emit(`${i > 0 ? ',' : ''} ${n}: function (this: `);
          this.emitNamedCopies(selfType, name, bindAt >= 0 ? compId : null, bindAt >= 0 ? [bindAt, bindAt + name.length] : null);
          this.b.emit(`) ${block ? code : `{ return ${code}; }`}`);
        });
        this.b.emit(' };');
      });
    }));
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
  // Sourced from the lexer's trivia channel — never from
  // generated text. The directive must sit on the line DIRECTLY above
  // its statement (TypeScript's own next-line rule; a blank line in
  // between leaves it an ordinary comment), alone on its line, and
  // spell one of the three known directives followed by whitespace or
  // end — everything else stays an ordinary Rip comment (comments
  // never emit), including unknown `@ts-*` spellings and directives in
  // expression-lowered positions where no statement line exists.
  static TS_DIRECTIVE = /^#[ \t]*@ts-(expect-error|ignore|nocheck)(?=\s|$)/;

  // The attachment pre-pass: pair each directive comment with the
  // statement-list element whose source line sits directly beneath it.
  // Elements come from the program's own list and every block node's
  // list — the positions the emitter prints as lines. Ties at one
  // source start (a postfix form and its guarded statement) resolve
  // OUTERMOST: the outer element is the one the statement list emits.
  // Attachment runs in BOTH modes: emission is ts-gated at every
  // consumer, but a prop pair's attached directive also decides the
  // child-ctor object's LAYOUT (one pair per line), and the strip
  // contract — face minus regions === JS bytes — holds only if both
  // modes make that layout decision from the same map.
  collectTsDirectives(sexpr, trivia, source) {
    this.tsDirectiveMap = new Map();
    this.tsNocheck = null;
    if (trivia.length === 0) return;
    const lineStarts = [0];
    for (let i = 0; i < source.length; i++) {
      if (source[i] === '\n') lineStarts.push(i + 1);
    }
    const lineOf = (offset) => {
      let lo = 0, hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid] <= offset) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    const directives = [];
    const nochecks = [];
    for (const t of trivia) {
      if (t.kind !== 'comment') continue;
      const m = Emitter.TS_DIRECTIVE.exec(t.text);
      if (m === null) continue;
      // Whole-line only: a trailing directive comment has no next-line
      // reading the emitter can honor.
      if (!/^[ \t]*$/.test(source.slice(lineStarts[lineOf(t.start)], t.start))) continue;
      (m[1] === 'nocheck' ? nochecks : directives).push(t);
    }
    if (directives.length === 0 && nochecks.length === 0) return;
    const elements = [];
    const listElements = (list) => {
      for (const el of list) {
        if (!isShapedNode(el)) continue;
        const id = this.stores.idOf(el);
        if (id === null) continue;
        const n = this.stores.node(id);
        elements.push({ el, id, start: n.sourceStart, end: n.sourceEnd });
      }
    };
    listElements(sexpr.slice(1));
    const walk = (x) => {
      if (!isShapedNode(x)) return;
      if (this.isBlock(x)) {
        listElements(x.slice(1));
        // Adjacent class members group into ONE implicit-object
        // statement, so a directive above a LATER member line can only
        // attach to the member PAIR — list pairs of statement-position
        // objects (classMember consumes them per row; a same-start
        // object sorts before its first pair via the larger-end rule,
        // so a directive above the FIRST member still attaches to the
        // whole-group statement).
        for (const el of x.slice(1)) {
          if (isShapedNode(el) && this.isObject(el)) listElements(el.slice(1));
        }
      }
      for (const c of x) walk(c);
    };
    walk(sexpr);
    elements.sort((a, b) => a.start - b.start || b.end - a.end);
    for (const d of directives) {
      const target = elements.find((e) => e.start >= d.end);
      if (target === undefined || lineOf(target.start) !== lineOf(d.start) + 1) continue;
      const attached = this.tsDirectiveMap.get(target.el) ?? [];
      attached.push({ t: d, nodeId: target.id });
      this.tsDirectiveMap.set(target.el, attached);
    }
    // `@ts-nocheck` is file-level in TypeScript — it counts only when
    // no statement precedes it in the source; the FIRST such comment
    // emits as the face's first line, the rest stay ordinary comments.
    const firstStmt = elements.length > 0 ? elements[0].start : Infinity;
    this.tsNocheck = this.ts ? (nochecks.find((t) => t.end <= firstStmt) ?? null) : null;
  }

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
  // governing the statement always emit above its HEAD line. An
  // earlier place-or-decline probe (drop the
  // directive when the statement emits multi-line) was a proxy for
  // "can the directive govern the error" that over-declined the
  // dominant case: an arrow/function assigned to a typed binding
  // reports its error on the statement's head line, which the
  // directive governs precisely (the declined
  // directive silently deleted the author's escape hatch and leaked
  // the acknowledged error). The honest residue of always-placing: a
  // directive whose error lands on an INNER line of a multi-line
  // statement doesn't suppress it and surfaces as TS2578 — visible
  // and actionable, exactly the behavior, strictly better than a
  // silent drop.
  withTsDirectives(node, pad, fn, padFirst = false) {
    const attached = this.ts && isShapedNode(node)
      ? this.tsDirectiveMap.get(node) : undefined;
    if (attached === undefined) return fn();
    this.tsDirectiveMap.delete(node);
    for (const d of attached) this.tsDirectiveLine(d, pad, padFirst);
    fn();
  }

  // A scope's hoist line is the only manifestation of its bare typed
  // forwards (`let a!: T`), so it takes their directives. Each remembers
  // its forward: when the forward's annotation re-homes inline at a
  // declaring write, applyDeclareInPlace moves the directive there.
  hoistDirectives(forwards) {
    const out = [];
    if (!this.ts) return out;
    for (const f of forwards) {
      const node = this.mine(f);
      const attached = this.tsDirectiveMap.get(node);
      if (attached === undefined) continue;
      this.tsDirectiveMap.delete(node);
      for (const d of attached) { d.forwardOwner = node; out.push(d); }
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
    if (!this.ts) return;
    const sigs = this.pendingSigs.get(node);
    if (!sigs) return;
    this.pendingSigs.delete(node);
    for (const sig of sigs) {
      // The overload row reads the SAME optionalMarker role the face's
      // main param path and dts.js read — without it, `b?: string` in a
      // signature printed as `b: string` here while the `.d.ts` kept the
      // `?`, so the editor and the shipped types disagreed on the API.
      const params = this.tsRendered(sig, () => renderParams(sig[2], optionalReader(this.stores)));
      // A directive above the signature follows it to its overload
      // row — the line its diagnostics land on.
      const directives = this.tsDirectiveMap.get(sig);
      if (directives !== undefined) {
        this.tsDirectiveMap.delete(sig);
        for (const d of directives) this.tsDirectiveLine(d, '  '.repeat(ind));
      }
      this.b.tsOnly(() => {
        this.mark(sig, '$self', () => {
          if (exported) this.b.emit('export ');
          this.b.emit('function ');
          this.mark(sig, 'name', () => this.b.emit(sig[1]));
          const tp = this.annotationText(sig, 'typeParams');
          if (tp !== null) this.mark(sig, 'typeParams', () => this.emitTypeText(sig, 'typeParams', tp));
          this.mark(sig, 'params', () => this.b.emit(params));
          this.mark(sig, 'returnType', () => this.emitTypeText(sig, 'returnType', `: ${tidyType(sig[3])}`));
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
    const text = behaviorObjectText(schemaNode[1], story.decl.name, fns, story.thisTypes);
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
    if (!this.ts || !this.isPrivateMember(node)) return;
    this.b.tsOnly(() => {
      this.mark(node, 'visibility', () => this.b.emit('private'));
      this.b.emit(' ');
    });
  }
}

// The strip transform: delete the recorded TS-only regions from a
// TS-face emission. Deterministic and mechanical — regions were
// recorded as the face emitted them (never scanned out of generated
// text), ascending and disjoint by construction. The strip gate
// (test/tsface.test.js) holds this equal to the JS-mode emission
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
