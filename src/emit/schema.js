// Schema emission.
//
// A schema node's value is the descriptor the lexer pass parsed
// (src/schema.js). Emission is one `__schema({...})` call —
// the byte-pinned descriptor literal — with callable/
// transform/ensure bodies compiled from the trees the parse built for
// them (the schema entry's code) through a nested Emitter. The
// whole call is one generated manifestation of the schema node
// ($self + the body role as cover rows); per-token mappings inside
// compiled callables do not exist.
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

import { descriptorSegments, behaviorObjectText, paramsOf, relationOf, schemaCodeSites, SCHEMA_TREES } from '../schema.js';
import { isIdentifierName, IDENT_START, IDENT_PART, IDENT_RE } from '../ident.js';
import { islandSpan } from './names.js';
import { isList, isNode, isNone, isStruct, mkNode } from '../sexpr.js';
import { isComprehensionNode, isFunc, isLoopNode, isSourceLoop } from './tree.js';
import { Emitter } from './core.js';
import { boundNames } from './walks.js';

// A schema body reaches the face only as descriptor string literals,
// which carry no symbol — so nothing in it is a typed position of its
// own. Its types do live in the companion alias this block emits, so
// each entry pairs its SOURCE span with the generated offset of its own
// member there, and the editor answers from that.
// The label is the entry's own tag, naming the construct the body
// declared rather than the `property` the alias spells it as.
export const SCHEMA_BODY_KINDS = { field: 'field', computed: 'computed', derived: 'derived', method: 'method' };

// A directive whose first argument NAMES a schema — an `@mixin` target,
// a relation's target — with the word the author wrote for it: null
// for any other entry, and for a target the parse did not read as one
// identifier token.
export function schemaBodyReference(e) {
  if (e.tag !== 'directive' || e.argTokens?.[0]?.kind !== 'IDENTIFIER' || typeof e.argTokens[0].start !== 'number') return null;
  const word = e.argTokens[0].value;
  if (e.name === 'mixin') return { name: word, start: e.argTokens[0].start, accessor: null };
  const rel = relationOf(e);
  if (rel === null || rel.target !== word) return null;
  return { name: word, start: e.argTokens[0].start, accessor: rel.accessor };
}

// A descriptor's recorded word occurrences by spelling, each list in
// source order.
function schemaWordIndex(descriptor) {
  const index = new Map();
  for (const p of descriptor.wordSpans ?? []) {
    const list = index.get(p.value);
    if (list === undefined) index.set(p.value, [p]);
    else list.push(p);
  }
  for (const list of index.values()) list.sort((a, b) => a.sourceStart - b.sourceStart);
  return index;
}

export class SchemaMethods {
  // One schema word, claiming its next recorded source occurrence.
  emitSchemaWord(word) {
    return this.emitWordAt(word, this.schemaWords !== null ? this.b.claimWord(word, this.schemaWords.get(word)) : null);
  }

  // Schema bodies are one opaque SCHEMA_BODY token, but the schema pass keeps
  // each source word occurrence on its descriptor. Serialize a descriptor
  // segment in place, marking word-valued JSON strings and expression
  // identifiers from those recorded occurrences. Object-literal keys are
  // generated descriptor vocabulary and stay unmarked. This consumes the text
  // before it reaches the builder; no generated output is searched afterward.
  // `body` marks COMPILED body text (a callable's function, the adapter's
  // expression): there a `word:` is the author's object key or a ternary
  // arm and claims its source occurrence like any other word; only the
  // descriptor's own text treats `word:` as generated vocabulary.
  emitSchemaText(text, body = false) {
    let i = 0;
    let lastKey = null;
    while (i < text.length) {
      const ch = text[i];
      // A template literal's raw text is string content, not words the
      // author read: it emits verbatim, and only its `${…}` holes carry
      // source occurrences (`"#{@items.length} items"` reads `items`
      // once, in the hole).
      if (ch === '`') {
        let j = i + 1;
        this.b.emit('`');
        while (j < text.length && text[j] !== '`') {
          if (text[j] === '\\') { this.b.emit(text.slice(j, j + 2)); j += 2; continue; }
          if (text[j] === '$' && text[j + 1] === '{') {
            let depth = 1, k = j + 2, quote = null;
            while (k < text.length && depth > 0) {
              const c = text[k];
              if (quote !== null) { if (c === '\\') k++; else if (c === quote) quote = null; }
              else if (c === '"' || c === "'" || c === '`') quote = c;
              else if (c === '{') depth++;
              else if (c === '}') depth--;
              k++;
            }
            this.b.emit('${');
            this.emitSchemaText(text.slice(j + 2, depth === 0 ? k - 1 : k), body);
            if (depth === 0) this.b.emit('}');
            j = k;
            continue;
          }
          this.b.emit(text[j]);
          j++;
        }
        if (j < text.length) this.b.emit('`');
        i = j + 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < text.length && text[j] !== ch) j += text[j] === '\\' ? 2 : 1;
        const str = text.slice(i + 1, j);
        this.b.emit(ch);
        const pin = body ? undefined : this.schemaPins?.get(`${lastKey}:${str}`)?.shift();
        lastKey = null;
        if (pin !== undefined && this.schemaPinNode !== null) this.b.markSpan(this.schemaPinNode, 'literal', pin[0], pin[1], () => this.b.emit(str));
        else if (isIdentifierName(str)) this.emitSchemaWord(str);
        else this.b.emit(str);
        if (j < text.length) this.b.emit(ch);
        i = Math.min(j + 1, text.length);
        continue;
      }
      if (IDENT_START.test(ch)) {
        let j = i + 1;
        while (j < text.length && IDENT_PART.test(text[j])) j++;
        const word = text.slice(i, j);
        let k = j;
        while (k < text.length && /\s/.test(text[k])) k++;
        // Descriptor object keys (`name:`, `typeName:`) are generated
        // vocabulary. Expression/member identifiers and shorthand values are
        // source-carried occurrences.
        if (text[k] === ':' && !body) { this.b.emit(word); lastKey = word; }
        else this.emitSchemaWord(word);
        i = j;
        continue;
      }
      this.b.emit(ch);
      i++;
    }
  }

  // ["schema", {}, ["schema-body", {}, descriptor, dsl]].
  schemaExpr(node) {
    const body = node[2];
    const descriptor = isNode(body) && body[0] === 'schema-body' ? body[2] : null;
    if (!descriptor || typeof descriptor !== 'object' || !Array.isArray(descriptor.entries)) {
      throw this.positionedError(node, 'emitter: schema node without a descriptor — the lexer pass owns SCHEMA_BODY values');
    }
    // A FUNCTION-scope binding of `__schema` shadows the runtime
    // exactly where this declaration's call needs it — an accident
    // with no working reading (the bring-your-own-factory hatch is
    // module-scope suppression). scopes[0] is program scope;
    // deeper entries are function scopes.
    if (this.scopes.slice(1).some((s) => s.has('__schema'))) {
      throw this.positionedError(node,
        "emitter: a function-scope binding of '__schema' shadows the schema runtime where this " +
        "schema declaration needs it — rename the local, or bind '__schema' at MODULE scope to " +
        'supply your own factory (the suppression hatch)',
      );
    }
    this.usesSchema = true;
    const schemaName = this._schemaName ?? null;
    const fns = new Map();
    for (const { entry: e, index: i, tokens, stmts, value } of this.schemaBodies(descriptor, body[3])) {
      if (value) {
        fns.set(i, this.schemaValueCode(stmts, tokens[0].start));
        continue;
      }
      // Transforms see the whole raw input as the explicit `it`
      // parameter.
      const params = this.schemaBodyParams(e);
      // `it` is the DSL's own word — the grammar fixes a transform's
      // parameter list, so there is nothing to annotate — and it reaches
      // the face as the minted parameter carrying the declared `any`
      // boundary. That IS its answer: `(parameter) it: any`, the boundary
      // stated at the word.
      const fn = this.schemaFnCode(params, stmts, islandSpan(tokens));
      // A plain @ensure reads its check's result as truthy-or-not, so a
      // check that awaits — compiled async, answering with a Promise —
      // would always pass. Only @ensure! awaits.
      if (e.tag === 'ensure' && !e.async && fn.code.startsWith('(async ')) {
        Emitter.schemaFail(`@ensure: this check awaits, so it answers with a promise a plain @ensure reads as passing — declare it '@ensure!' to await it`, tokens[0]?.start ?? e.start);
      }
      fns.set(i, fn);
    }
    // The schema type story (face only): callable bodies gain
    // TS-only `this` parameters per their real calling convention,
    // and the binding's value gains a TS-only cast to its
    // declared type — inference-independent, so the face types the
    // binding identically under every runtimeDelivery.
    const story = this.schemaStories?.get(node) ?? null;
    const nodeId = this.stores.idOf(node);
    // A NAMED declaration always has a story: the story walk reaches
    // every function scope, and a name arrives only through the
    // assignment forms it records. The one position it leaves out is a
    // parameter default, where no scope's aliases are visible; any other
    // story-less name is a walk the emitter's scope rules outgrew.
    // Either rejects here, never a bare untyped call by position.
    if (this.ts && schemaName !== null && story === null) {
      throw this.positionedError(node,
        `emitter: the schema declaration '${schemaName}' sits in a parameter default, where no scope's type aliases are visible — move it into the body, or to module scope`);
    }
    // Rip assigns outward: a name bound by an enclosing scope is that
    // scope's binding, and a declaration of it inside this function
    // REBINDS it rather than declaring a local. The enclosing scope's
    // story cannot describe two shapes under one name (the same reason
    // a scope rejects a second declaration), and this scope's aliases
    // would describe a binding that is not its own.
    if (this.ts && story?.scope && !this.scopes[this.scopes.length - 1]?.has(schemaName)) {
      throw this.positionedError(node,
        `emitter: the schema declaration '${schemaName}' inside this function rebinds the enclosing '${schemaName}' ` +
        `(a name assigned in an enclosing scope is that scope's binding) — a schema binds once; ` +
        `declare it under a name of its own, or at the scope that binds '${schemaName}'`);
    }
    // The compiled bodies, kept for the behavior object the binding
    // statement emits after this expression (same bodies, one place
    // they are compiled). The object is owed from here until that
    // statement places it (schemaBehaviorPending).
    if (this.ts && story !== null) {
      this.schemaFns.set(node, fns);
      if (behaviorObjectText(descriptor, story.decl.name, fns, story.thisTypes) !== null) this.schemaBehaviorPending.set(node, story);
    }
    this.schemaPins = this.ts ? this.schemaDeclarationPins(node, descriptor, schemaName, story) : null;
    this.schemaPinNode = nodeId;
    // A pinned occurrence is spoken for before the literal emits: a
    // compiled body ahead of the pin in the literal (an ensure's
    // predicate precedes its `field:`) must not claim it for a read.
    for (const spans of this.schemaPins?.values() ?? []) for (const [a, z] of spans) this.b.exactSourceSpans.add(`${a}:${z}`);
    const prevWords = this.schemaWords;
    this.schemaWords = this.ts ? schemaWordIndex(descriptor) : null;
    this.mark(node, '$self', () => {
      this.b.emit('__schema(');
      this.mark(node, 'body', () => {
        const segments = descriptorSegments(
          descriptor, schemaName, fns, fns.get('adapter') ?? null, story?.thisTypes ?? null, this.ts,
          story?.defaultTypes ?? null, story?.ensureTypes ?? null);
        for (const seg of segments) {
          if (typeof seg === 'string') this.emitSchemaText(seg);
          // Compiled body text: the author's words, keys included.
          else if (seg.body !== undefined) {
            this.schemaBodyBound = seg.bound ?? null;
            this.emitSchemaText(seg.body, true);
            this.schemaBodyBound = null;
          }
          // A face segment carrying a source span marks there — a
          // wrong-typed default's diagnostic anchors on the literal the
          // author wrote, not on the entry list that encloses it.
          else if (seg.span !== null && seg.span !== undefined && nodeId !== null) {
            this.b.tsOnly(() => this.b.markSpan(nodeId, 'literal', seg.span[0], seg.span[1], () => this.b.emit(seg.ts)));
          } else if (story !== null) {
            // A TS-only insert repeating the schema's NAME (`this: Parcel`
            // on a callable) marks the declaration, like every other copy.
            const bind = this.bindingNameSpan(story.decl.node, 'target', story.decl.name);
            this.b.tsOnly(() => this.emitNamedCopies(seg.ts, story.decl.name, bind?.id ?? null, bind?.span ?? null));
          } else this.b.tsOnly(() => this.b.emit(seg.ts));
        }
      });
      this.b.emit(')');
      if (story !== null && story.constType !== null) {
        const bind = this.bindingNameSpan(story.decl.node, 'target', story.decl.name);
        this.b.tsOnly(() => { this.b.emit(' as unknown as '); this.emitNamedCopies(story.constType, story.decl.name, bind?.id ?? null, bind?.span ?? null); });
      }
    });
    this.schemaWords = prevWords;
    this.schemaPins = null;
    this.schemaPinNode = null;
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

  static schemaFail(message, at) {
    const err = new Error(`schema: ${message}`);
    err.start = at;
    throw err;
  }

  // A schema descriptor's code sites with their parsed statements — ONE
  // enumeration (schemaCodeSites) shared by emission (schemaExpr) and
  // analyze.js's delivery walk, so a new callable class can never join
  // one and silently miss the other. The `on:` adapter is a VALUE
  // expression, not a callable body, but it is a tree the module emits,
  // so the delivery walk and the temp-name collector see it too.
  // Each site's tree is the descriptor's (SCHEMA_TREES), recorded in
  // `schemaCode` by its tokens. A projection folded from a schema
  // carries no DSL of its own: its sites are its source's, which the
  // fold only finds in an earlier top-level statement, so the source
  // has recorded them by the time the projection emits.
  schemaBodies(descriptor, dsl) {
    const trees = isNone(dsl) ? null : descriptor[SCHEMA_TREES];
    return schemaCodeSites(descriptor).map((site) => {
      if (trees !== null) {
        const tree = trees?.get(site.tokens);
        if (tree === undefined) throw new Error(`emitter: a schema's code site has no tree (entry ${site.index})`);
        this.schemaCode.set(site.tokens, tree[3]);
      }
      const program = this.schemaCode.get(site.tokens);
      if (!isNode(program)) throw new Error('emitter: a schema code site has no parsed body — the parse owns every SCHEMA_CODE payload');
      return { ...site, stmts: program.slice(2) };
    });
  }

  schemaBodyParams(entry) {
    if (entry.tag === 'adapter') return [];
    if (entry.tag === 'field') return [{ name: 'it', type: null }];
    return paramsOf(
      entry.paramTokens ?? [],
      entry.tag === 'ensure' ? '@ensure' : `'${entry.name}'`,
      Emitter.schemaFail,
      this.b.source,
    );
  }

  // Compile a schema code site's statements to a parenthesized
  // function expression. Single-statement bodies compact to one line
  // (`(function() { return X; })`); multi-statement bodies
  // take the ordinary block form at indent 0. Returns {code, thisAt,
  // annots}, where the two offsets are the face's own splice points into
  // `code`: thisAt sits right after the parameter list opens, where the
  // calling convention's `this` parameter goes, and annots carries each
  // declared parameter's type (or the JS-arity `?`) at the offset it
  // follows. The code itself is the runtime spelling and holds neither.
  // `bound` is every name the callable binds, parameters and locals at
  // any depth: the parent re-emits this text word by word under its own
  // scopes, which know none of them. `span` is the site's source span.
  schemaFnCode(params, stmts, span = null) {
    const names = params.map((p) => p.name);
    if (stmts.length === 0) return { code: '(function() {})', thisAt: '(function('.length, annots: [], bound: new Set(names) };
    const bound = boundNames(this, mkNode('program', ...stmts), names);
    const bodyNode = stmts.length === 1 ? stmts[0] : mkNode('block', ...stmts);
    const isAsync = this.containsAwait(bodyNode);
    const isGen = this.containsYield(bodyNode);
    const sub = this.subEmitter();
    // The compact body hoists exactly like the block form — a single
    // statement can still assign (`(y = 5) and y`, a match write's `_`),
    // and the emitted function is a real (strict module) scope where an
    // undeclared write throws.
    const { entries, names: scoped } = sub.scopedHoist(stmts, names);
    for (const n of sub.pushReactiveFrame(stmts, scoped)) scoped.add(n);
    sub.scopes.push(scoped);
    sub.rejectUnboundIt(names, bodyNode, { fallback: span });
    let bodyText;
    if (stmts.length === 1) {
      const stmt = stmts[0];
      if (entries.length) {
        sub.hoistLine(entries);
        sub.b.emit(' ');
      }
      if (isLoopNode(stmt) || isComprehensionNode(stmt)) sub.statement(stmt, 0);
      else sub.implicitReturn(stmt, 0);
      bodyText = `{ ${sub.b.code} }`;
    } else {
      sub.b.emit('{\n');
      if (entries.length) {
        sub.b.emit('  ');
        sub.hoistLine(entries, '  ');
        sub.b.emit('\n');
      }
      stmts.forEach((stmt, i) => {
        sub.b.emit('  ');
        if (i === stmts.length - 1) sub.implicitReturn(stmt, 1);
        else sub.statement(stmt, 1, true);
        sub.b.emit('\n');
      });
      sub.b.emit('}');
      bodyText = sub.b.code;
    }
    const head = `(${isAsync ? 'async ' : ''}function${isGen ? '*' : ''}(`;
    // A declared parameter type is TypeScript, so the emitted list holds
    // NAMES and each annotation is recorded at the offset it belongs
    // after — the same channel the `this` parameter rides.
    const annots = [];
    let at = head.length;
    params.forEach((p, i) => {
      at += p.name.length;
      if (p.type !== null) annots.push([at, `: ${p.type}`]);
      else if (p.optional) annots.push([at, '?']);
      if (i < params.length - 1) at += ', '.length;
    });
    return { code: `${head}${names.join(', ')}) ${bodyText})`, thisAt: head.length, annots, bound };
  }

  // Compile a VALUE-expression code site (the `on:` adapter) — one
  // expression, emitted in value context in the enclosing scope (no
  // function wrapper, no fresh frame).
  schemaValueCode(stmts, at) {
    if (stmts.length !== 1) {
      Emitter.schemaFail(`'on:' takes one adapter expression`, at);
    }
    const sub = this.subEmitter();
    sub.expr(stmts[0]);
    return sub.b.code;
  }

  // The scope-boundary classification the TS face's schema story
  // places each schema's type declarations by (buildSchemaTypeStory's
  // `boundary` hook): which scope owns a construct's names.
  //
  //   'skip'           nothing inside reaches this scope (a nested
  //                    function, def, or component body)
  //   'effect'         the body is its own function scope; only the
  //                    handle name binds here
  //   'reactive'       a reactive declaration — the value emits inline
  //                    here UNLESS it is a multi-statement computed
  //                    block (its own scope); the walker checks
  //                    `n[0] === 'computed' && this.isBlock(n[3]) &&
  //                    n[3].length > 3` for that split
  //   'readonly'       the name const-binds; the value walks here
  //   'class'          fields are members, not scope names; the head
  //                    and field VALUES walk here
  //   'loop'           for-in/of/as — vars declare in the for-head;
  //                    the other slots walk here
  //   'comprehension'  clause vars bind per-construct; value, clause
  //                    sources, and guards walk here
  //   'try'            catch patterns bind per-handler; parts walk
  //   null             an ordinary node or a list — generic descent
  scopeBoundary(n) {
    if (isList(n)) return null;
    if (!isStruct(n)) return 'skip';
    if (n[0] === 'def' || isFunc(n)) return 'skip';
    if (n[0] === 'component' && n.length === 4) return 'skip';
    if (this.isEffectDecl(n)) return 'effect';
    if (this.isReactiveDecl(n)) return 'reactive';
    if (this.isReadonlyDecl(n)) return 'readonly';
    if (n[0] === 'class') return 'class';
    if (isSourceLoop(n)) return 'loop';
    if (isComprehensionNode(n)) return 'comprehension';
    if (n[0] === 'try') return 'try';
    return null;
  }
}
