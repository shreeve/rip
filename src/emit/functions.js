// Functions: parameters, function emission, bound `it`, function bodies
// and implicit returns.
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

import { tidyType, jsArityOptional } from '../ts/types.js';
import { MEMBER_HEADS, MEMBER_IN_PARAMETER, PROMOTED_IN_PATTERN, RENDER_LOCAL_HIDDEN, UNBOUND_IT, bareItSpan } from './names.js';
import { isNode, isNone, isList, isStruct, wordOf, mkNode, mkLeaf } from '../sexpr.js';
import { ASSIGNS } from './helpers.js';
import { atParamName, atParamField, isComprehensionNode, isFunc, isSourceLoop, isSymbol, isTypedWrapper } from './tree.js';
import { Emitter } from './core.js';

export class FunctionMethods {
  // One parameter: a plain name, a rest (`...name`), a default
  // (`name = expr`), or an array/object pattern (emitted like the
  // matching literal — the pattern element cases live on object/array).
  emitParam(p) {
    const name = wordOf(p);
    if (name !== undefined) return this.withDeclaredName(() => this.emitLeaf(p, name));
    // A typed parameter (["typed-var", {}, target, type]) erases to its target;
    // the annotation role's cover row spans the emitted target — the
    // type's only generated manifestation. The TS face emits
    // the annotation after the target as a TS-only region with its own
    // re-marked row.
    if (p[0] === 'typed-var') {
      this.mark(p, '$self', () =>
        this.mark(p, 'annotation', () => {
          this.mark(p, 'target', () => this.emitParam(p[2]));
          if (this.ts) {
            // Optional parameter (C1b): the side-band optionalMarker
            // role (grammar-dropped OPT_MARKER) emits as a TS-only `?`
            // — type-level only, the JS twin is the bare name.
            const id = this.stores.idOf(p);
            if (id !== null && this.stores.role(id, 'optionalMarker')) {
              this.b.tsOnly(() => this.mark(p, 'optionalMarker', () => this.b.emit('?')));
            }
            // A bare optional (`title?`) carries an empty annotation —
            // the `?` alone emits; TS infers the rest.
            const text = this.annotationText(p) ?? (isNone(p[3]) ? '' : tidyType(p[3][2]));
            if (text !== '') this.tsAnnotate(p, 'annotation', text);
          }
        }));
      return;
    }
    if (p[0] === 'rest') {
      this.b.emit('...');
      return this.emitParam(p[2]);
    }
    if (p[0] === 'default') {
      this.emitParam(p[2]);
      this.b.emit(' = ');
      return this.withExpression(() => this.expr(p[3]));
    }
    // An array/object param is a PATTERN: its interior emits in
    // binding-position context (defaults bare, no operand grouping) —
    // a BINDING pattern, where the `rest x` sugar is live.
    this.withPattern(() => this.expr(p), true);
  }

  // The erased core of a possibly-typed parameter: ["typed-var", {},
  // target, type] reads through to its target; everything else is
  // itself.
  static paramCore(p) {
    return isNode(p) && p[0] === 'typed-var' ? p[2] : p;
  }

  // The bare `...` expansion marker: params BEFORE it emit normally,
  // the marker becomes a minted rest parameter (`..._rest`), and params
  // AFTER it lower to `const name = _rest[_rest.length - K];`
  // extractions at the body's top. The rest name dodges every spelled
  // identifier, and is fixed per parameter list so the signature and
  // the body's extractions agree.
  expansionSplit(params) {
    const at = params.findIndex((p) => isNode(p) && p[0] === 'expansion');
    if (at === -1) return { list: params, extractions: [] };
    const trailing = params.slice(at + 1);
    let rest = this.temps.byNode.get(params);
    if (rest === undefined) {
      rest = this.loopTempName('_rest');
      this.temps.byNode.set(params, rest);
    }
    return {
      list: [...params.slice(0, at), mkNode('rest', mkLeaf('name', rest))],
      // The NAME is the parameter the source spells, and this extraction is its
      // ONLY generated manifestation, so it stays separate from the line's text
      // and takes its own row. The param NODE rides along because the extraction
      // emits inside the BODY's frame, which does not span the parameter list —
      // the claim has to open on the parameter's own extent to see it.
      // `slot` is the INDEX EXPRESSION, not a finished line: a tail parameter
      // is a parameter, so it can be a pattern or carry a default, and those
      // read the slot in different shapes. It is pure (arithmetic over a local
      // array's length), which is what lets the default form read it twice.
      extractions: trailing.map((p, i) => ({
        node: p,
        name: Emitter.paramCore(p),
        slot: `${rest}[${rest}.length - ${trailing.length - i}]`,
      })),
    };
  }

  // True when something OTHER than the parameter list already types a
  // function's parameters, so JS arity must not touch them: marking a
  // contextually-typed `number` optional widens it to `number | undefined`
  // and publishes TS18048 on correct code. Two sources:
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
  // The compiler's own handler-param injection is the third source, handled
  // where it is applied (`injectedTypes` in emitParams).
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

  // The first member or index target a binding's positions hold (the
  // binding itself, a rest's operand, a pattern's elements, a default's,
  // annotation's or cast's target), or null. A default's value and a
  // computed key are expressions and read members freely.
  static memberInPattern(p) {
    if (!isNode(p)) return null;
    const h = p[0];
    if (MEMBER_HEADS.has(h)) return p;
    if (h === 'rest' || h === '...' || h === 'default' || (h === '=' && p[1].void !== true) || h === 'typed-var' || h === 'cast' || h === 'satisfies') {
      return Emitter.memberInPattern(p[2]);
    }
    if (h === 'array') {
      for (let i = 2; i < p.length; i++) { const hit = Emitter.memberInPattern(p[i]); if (hit !== null) return hit; }
      return null;
    }
    if (h === 'object') {
      for (let i = 2; i < p.length; i++) {
        const pair = p[i];
        if (!isNode(pair)) continue;
        const slot = pair[0] === ':' && pair[1].void !== true ? pair[3] : pair[0] === '=' || pair[0] === '...' ? pair[2] : null;
        const hit = Emitter.memberInPattern(slot);
        if (hit !== null) return hit;
      }
    }
    return null;
  }

  // A member a binding holds rejects at the member: a promoted `@name`
  // in a parameter in its own vocabulary, any other in `message`'s.
  rejectMemberTarget(p, message) {
    const hit = Emitter.memberInPattern(p);
    if (hit === null) return;
    const promoted = hit[0] === '.' && hit.length === 4 && wordOf(hit[2]) === 'this';
    throw this.positionedError(hit, promoted && message === MEMBER_IN_PARAMETER ? PROMOTED_IN_PATTERN(wordOf(hit[3])) : message, p);
  }

  // `injectedTypes` is the event-handler injection seam (the named
  // `@event: @method` binding): an annotation per position, TS-only,
  // applied only where that param is a bare name — an annotated,
  // defaulted, rest or pattern param is the author's own shape and is
  // never overridden.
  emitParams(params, injectedTypes = null, jsArity = true) {
    const list = this.expansionSplit(params).list;
    // Arity softens only the TS face (`?` markers); the JS face never
    // reads the set, so skip the walk unless type syntax will emit.
    const optional = jsArity && this.ts ? jsArityOptional(list) : new Set();
    // An injected annotation types its param by position, so JS arity
    // leaves that param alone — it is no longer unannotated.
    const injected = injectedTypes === null ? [] : [].concat(injectedTypes);
    injected.forEach((type, i) => { if (type != null) optional.delete(i); });
    // JavaScript takes a rest parameter last; a named rest before
    // another parameter has no formal-parameter form.
    const restAt = list.findIndex((p) => isNode(p) && (p[0] === 'rest' || p[0] === '...'));
    if (restAt !== -1 && restAt < list.length - 1) {
      throw this.positionedError(list[restAt],
        'emitter: a rest parameter must be the last parameter — JavaScript has no middle rest; take `...rest` last and read the tail from it');
    }
    for (const p of params) if (atParamField(p) === null) this.rejectMemberTarget(p, MEMBER_IN_PARAMETER);
    list.forEach((p, i) => {
      // JavaScript refuses `await` and `yield` anywhere in formal
      // parameters — a default, a pattern's default, a computed key —
      // even in an async or generator function. A nested function
      // inside a default owns its own (firstAwaitIn stops there).
      const control = this.firstAwaitIn(p);
      if (control !== null) {
        throw this.positionedError(control,
          "emitter: a parameter cannot await or yield — JavaScript refuses both in formal parameters, a default " +
          "or a pattern's default included; take the argument and do it in the body (`a ?= load!`)");
      }
      // A promoted parameter reaching emission was NOT stripped by a
      // constructor — the shape belongs to constructors alone (there
      // is no instance for any other function's `@name` to bind).
      if (atParamName(p) !== null ||
          (isNode(p) && p[0] === 'default' && atParamName(p[2]) !== null)) {
        throw this.positionedError(isStruct(p) ? p : params, 'emitter: an @-parameter promotes only in a constructor (`constructor: (@name) ->`) — bind a plain parameter and assign it here');
      }
      if (i > 0) this.b.emit(', ');
      this.emitParam(p);
      // JS ARITY (TS-only). A bare parameter the author never annotated is
      // optional, because in rip — as in JavaScript — calling with fewer
      // arguments is legal and yields `undefined`, and `arguments.length`
      // branching on it is idiomatic. Declaring it REQUIRED made the face
      // enforce an arity rip never promised: `resolveUrl = (url, env) ->`
      // drew TS2554 at every one-argument call it was written to accept.
      //
      // Nothing is lost under `rip.strict`, which is why this needs no mode:
      // an unannotated parameter is already TS7006 there, so the omission is
      // reported once, at the parameter, rather than again at every call.
      // The moment the author annotates, the parameter is required and the
      // arity check is back.
      if (optional.has(i)) this.b.tsOnly(() => this.b.emit('?'));
      if (injected[i] != null && wordOf(p) !== undefined && this.ts) {
        this.b.tsOnly(() => this.b.emit(`: ${injected[i]}`));
      }
    });
  }

  // ['->'|'=>', {}, params, block]. `->` emits a function expression, `=>` an
  // arrow (single simple param drops its parens; a single-expression body
  // inlines, operand-grouped). Both bodies implicitly return their last
  // expression.
  func(node) {
    // A nested function body is not narrowed (a handler can fire after
    // the flip), so no read inside it records.
    const prev = this._narrowedReads;
    this._narrowedReads = null;
    try { return this.emitFunc(node); } finally { this._narrowedReads = prev; }
  }

  // Only a parameterless function value binds an implicit `it`: in a
  // def, a method, a schema callable, an effect, a computed, a render
  // body or a function that takes parameters, a bare `it` in the
  // parameters or the body reads a binding some scope declares, or
  // rejects at the first one that has none. Called with the body's own
  // scope pushed. A parameter default runs before the body, so the
  // body's own declarations answer only the body; a parameter named `it`
  // answers both. The walk is containsBareIt's, with the bindings a
  // loop, a comprehension, a counted loop and a catch handler make
  // inside the body. A render passes `inline`, the children blocks it
  // inlines (the walk enters them), and `factories`, each render child's
  // factory record: a local or loop variable named `it` there answers the
  // reads below that child. `root` is the node a body with no node of
  // its own above an `it` anchors at (an effect's or computed's
  // declaration); `fallback` the span an `it` with no node above it
  // rejects at (a schema callable's site).
  rejectUnboundIt(params, block, { fallback = null, root = null, factories = null } = {}) {
    const inBody = this.declaresIt();
    let inParams = inBody;
    if (inBody && !this.paramsNameIt(params)) inParams = this.declaresIt(this.rframes.length - 2);
    if (inBody && inParams) return;
    // The anchor of the first unbound `it`: undefined while none is
    // found, null when no node with a NodeStore row stands above it.
    let found;
    const loopBinds = (vars) => isList(vars) && this.paramsNameIt(vars);
    // `bound`: true where a binding inside the body answers `it`, false
    // where none does, 'enclosing' where only a render local of an
    // enclosing factory is named `it` (which no factory below it sees).
    let enclosing = false;
    const bind = (bound, binds) => (binds ? true : bound);
    const walk = (n, anchor, bound) => {
      if (found !== undefined) return;
      const word = wordOf(n);
      if (word !== undefined) {
        if (word === 'it' && bound !== true) { found = anchor; enclosing = bound === 'enclosing'; }
        return;
      }
      if (!Array.isArray(n) || isNone(n) || isSymbol(n)) return;
      // A render child's factory decides for the reads below it. The
      // factories are keyed in render.js's tree.
      if (factories !== null) {
        const rec = factories.get(n);
        if (rec !== undefined) {
          bound = rec.locals.has('it') || rec.bindings.has('it');
          for (let r = rec.parent; !bound && r; r = r.parent) if (r.locals.has('it')) bound = 'enclosing';
        }
      }
      if (this.stores.idOf(n) !== null) anchor = n;
      if (isList(n)) { for (const el of n) walk(el, anchor, bound); return; }
      const head = n[0];
      if (head === '->' || head === '=>' || head === 'def') return;
      if (Emitter.isItBody(n)) return;
      // A member's property is a name, never a reference.
      if ((head === '.' || head === '?.') && n.length === 4) { walk(n[2], anchor, bound); return; }
      if (head === 'object') {
        for (let i = 2; i < n.length; i++) {
          const pair = n[i];
          if (isNode(pair) && pair[0] === ':' && pair[1].void !== true && pair[1].shorthand !== true) {
            walk(pair[3], anchor, bound);
            if (wordOf(pair[2]) === undefined) walk(pair[2], anchor, bound);
          } else walk(pair, anchor, bound);
        }
        return;
      }
      if (head === 'pickitem' && n.length === 5) { walk(n[4], anchor, bound); return; }
      // An annotation's or cast's type is no reference, and a typed name
      // declares (a class's typed field names a member).
      if (isTypedWrapper(n)) { if (wordOf(n[2]) === undefined) walk(n[2], anchor, bound); return; }
      if ((head === 'cast' || head === 'satisfies') && n.length === 4) { walk(n[2], anchor, bound); return; }
      // A class's field names are members; its parent and field values
      // are expressions here (the redeclaration check's class rule).
      if (head === 'class') {
        walk(n[3], anchor, bound);
        const body = n[4];
        if (this.isBlock(body)) {
          const inBody = this.stores.idOf(body) !== null ? body : anchor;
          for (let i = 2; i < body.length; i++) {
            const stmt = body[i];
            if (isNode(stmt) && ASSIGNS.has(stmt[0]) && stmt.length === 4) {
              walk(stmt[3], this.stores.idOf(stmt) !== null ? stmt : inBody, bound);
            } else walk(stmt, inBody, bound);
          }
        }
        return;
      }
      let inner = bound;
      // A loop's source and step belong to the scope around the loop: no
      // loop variable answers a bare `it` there.
      if (isSourceLoop(n)) {
        walk(n[3], anchor, bound);
        walk(n[4], anchor, bound);
        inner = bind(bound, loopBinds(n[2]));
        walk(n[2], anchor, inner);
        walk(n[5], anchor, inner);
        walk(n[6], anchor, inner);
        return;
      }
      if (head === 'loop' && n[1].over === 'times') inner = true;
      else if (isComprehensionNode(n)) {
        const clause = n[3];
        const at = this.stores.idOf(clause) !== null ? clause : anchor;
        walk(clause[3], at, bound);
        walk(clause[4], at, bound);
        inner = bind(bound, loopBinds(clause[2]));
        walk(n[2], anchor, inner);
        walk(clause[2], anchor, inner);
        walk(clause[5], anchor, inner);
        return;
      } else if (head === 'try') {
        walk(n[2], anchor, bound);
        const handler = n[3];
        if (!isNone(handler)) {
          const binding = isTypedWrapper(handler[2]) ? handler[2][2] : handler[2];
          const name = wordOf(binding);
          // A plain catch name binds the handler; a pattern's names hoist
          // into the function, and its defaults read here.
          if (name !== undefined) walk(handler[3], anchor, bind(bound, name === 'it'));
          else { walk(handler[2], anchor, bound); walk(handler[3], anchor, bound); }
        }
        walk(n[4], anchor, bound);
        return;
      }
      for (let i = 2; i < n.length; i++) walk(n[i], anchor, inner);
    };
    if (!inParams) for (const p of params) walk(p, params, false);
    if (!inBody) walk(block, root, false);
    if (found === undefined) return;
    const id = found === null ? null : this.stores.idOf(found);
    const span = (id !== null ? bareItSpan(this.stores, this.b.source ?? this.parentSource, id) : null) ?? fallback;
    const message = enclosing ? RENDER_LOCAL_HIDDEN('it') : UNBOUND_IT;
    if (span === null) throw new Error(message);
    throw this.positionedErrorAt(span[0], span[1], message);
  }

  // Does a parameter (or a loop variable) name `it`? (A pattern the
  // parameter walk rejects names nothing here.)
  paramsNameIt(params) {
    try {
      const names = [];
      for (const p of params) this.patternNames(p, names, true);
      return names.includes('it');
    } catch {
      return false;
    }
  }

  // Does the nearest scope at or around frame `top` that binds `it`
  // declare it? A parameterless function's implicit `it` is no
  // declaration, and it shadows every `it` outside it.
  declaresIt(top = this.rframes.length - 1) {
    for (let i = top; i >= 0; i--) {
      const f = this.rframes[i];
      if (f.reactive.has('it') || (f.members !== undefined && f.members.has('it'))) return true;
      if (f.bound.has('it')) return !this.implicitItScopes.has(f.bound);
    }
    return this.moduleBound.has('it');
  }

  emitFunc(node) {
    const [srcKind, , rawParams, block] = node;
    // Implicit `it`: a zero-param arrow that references
    // bare `it` gains it as its parameter — both faces identically.
    const bareIt = rawParams.length === 0 && this.containsBareIt(block);
    const params = bareIt ? [mkLeaf('name', 'it')] : rawParams;
    // Component bodies force thin arrows FAT: a nested
    // `->` inside a member/method/effect/render body would re-bind
    // `this` away from the instance every member rewrite targets.
    const kind = srcKind === '->' && this.inComponent() ? '=>' : srcKind;
    const ind = this.ind;
    // Registered by the owning definition (`save! = ->`, `fn!: ->`):
    // the body suppresses its implicit return.
    const isVoid = this.voidFuncs.has(node);
    const body = this.isBlock(block) ? block.slice(2) : [block];
    const stmts = this.liveStmts(body);
    const { entries: hoist, names, itAssigned } = this.scopedHoist(body, params);
    for (const n of this.pushReactiveFrame(stmts, names, node)) names.add(n);
    this.scopes.push(names);
    // An implicit `it` the body never assigns answers no other function's
    // bare `it`; one the body assigns (a plain write or a pattern target)
    // is the function's own declared binding. Any declaring form of `it`
    // beside the implicit parameter is a redeclaration and rejects.
    if (bareIt && !itAssigned) this.implicitItScopes.add(this.rframes[this.rframes.length - 1].bound);
    if (rawParams.length !== 0) this.rejectUnboundIt(rawParams, block);
    const isAsync = this.containsAwait(block);
    const isGen = this.containsYield(block);
    // Fat arrows cannot be generators: JS has no generator-arrow
    // form, so a yielding fat arrow is unemittable — rejected at the
    // layer that knows the function kind.
    if (isGen && kind === '=>') {
      throw this.positionedError(node, srcKind === '->'
        ? 'emitter: a generator arrow cannot sit inside a component body — thin arrows lower to fat arrows there to keep `this` on the instance, and JS has no generator arrows (name the generator a method and call it)'
        : 'emitter: fat arrows cannot contain yield (JS has no generator arrows; use ->)');
    }
    // A callback's parameters are typed by its callee, so JS arity does
    // not apply to them (see contextuallyTyped).
    const inArgs = this.ts && this.contextuallyTyped(node);
    // The return-type role (side-band) covers the whole emitted
    // function; mark() is a no-op for untyped rows.
    this.mark(node, 'returnType', () => this.mark(node, '$self', () => {
      if (isAsync) this.b.emit('async ');
      if (kind === '->') {
        this.mark(node, 'kind', () => this.b.emit(isGen ? 'function*' : 'function'));
        this.b.emit('(');
        this.mark(node, 'params', () => this.emitParams(params, null, !inArgs));
        this.b.emit(')');
        this.tsReturnAnnotation(node, isAsync, isVoid, isGen);
        this.b.emit(' ');
        this.funcBlock(node, block, stmts, ind, hoist, isVoid);
      } else {
        // TS requires parens around an ANNOTATED single param and
        // before a return annotation (`x: T => …` does not parse);
        // the TS face adds them as TS-only bytes, so stripping
        // restores the bare-name JS spelling.
        // A lone BARE param takes the JS-arity `?` like any other (see
        // emitParams), which needs the parens too — `x? => …` does not
        // parse. Both are TS-only, so stripping restores `x => …`.
        const plain = params.length === 1 && wordOf(Emitter.paramCore(params[0])) !== undefined;
        const jsArity = this.ts && !inArgs && params.length === 1 && wordOf(params[0]) !== undefined;
        const tsParens = this.ts && plain &&
          (isTypedWrapper(params[0]) || this.annotationText(node, 'returnType') !== null || isVoid || jsArity);
        this.mark(node, 'params', () => {
          // Only a single PLAIN name drops its parens — patterns,
          // rests, and defaults keep them (JS requires it). A typed
          // single name erases to a plain one and drops them too.
          if (plain) {
            if (tsParens) this.b.tsOnly(() => this.b.emit('('));
            this.emitParam(params[0]);
            if (jsArity) this.b.tsOnly(() => this.b.emit('?'));
            if (tsParens) this.b.tsOnly(() => this.b.emit(')'));
          } else {
            this.b.emit('(');
            this.emitParams(params, null, !inArgs);
            this.b.emit(')');
          }
        });
        this.tsReturnAnnotation(node, isAsync, isVoid, isGen);
        this.b.emit(' ');
        this.mark(node, 'kind', () => this.b.emit('=>'));
        this.b.emit(' ');
        // A void fat arrow never inlines: its body is the braced
        // statement form ending in `return;`. Statement-only bodies
        // never inline either — a lone `throw`/`debugger` has no
        // expression form, and the inline path would emit it as a
        // bare atom (`=> throw(e)`, `=> debugger` — invalid JS both).
        // A gap's tail parameters bind as statements, which an inline
        // body has no room for.
        const gap = params.some((p) => isNode(p) && p[0] === 'expansion');
        const inline = !isVoid && !gap && stmts.length === 1 && hoist.length === 0 &&
          !Emitter.statementOnly(stmts[0]) &&
          !(isNode(stmts[0]) && (['def', 'return', 'if', 'while'].includes(stmts[0][0]) || this.isBlock(stmts[0])));
        if (inline) {
          this.mark(node, 'body', () => {
            // An inline body that IS an object literal must group:
            // `() => {}` is an empty block returning undefined, not
            // the object (the statement-start problem in arrow-body
            // position).
            const wrap = Emitter.needsGrouping(stmts[0], 'operand') || this.isObject(stmts[0]);
            if (wrap) this.b.emit('(');
            this.expr(stmts[0]);
            if (wrap) this.b.emit(')');
          });
        } else {
          this.funcBlock(node, block, stmts, ind, hoist, isVoid);
        }
      }
    }));
    this.scopes.pop();
    this.rframes.pop();
    // Body statements moved this.ind; a sibling expression after this
    // function must not inherit the deeper level.
    this.ind = ind;
  }

  // The `...` gap's tail parameters bind at the top of the body: each
  // reads its slot of the minted rest parameter. Every function form
  // that takes a parameter list emits these, or its tail names are
  // unbound.
  emitGapExtractions(params, ind) {
    const { extractions } = this.expansionSplit(params);
    // A tail parameter is a PARAMETER: every shape a parameter list admits
    // before the gap can appear after it, and each has to reach the
    // extraction as a BINDING rather than as a name: a pattern or a default
    // emits as one.
    for (const ex of extractions) {
      // A DEFAULT wraps the binding it defaults, so unwrap to the thing
      // being bound before asking what shape it is.
      const defaulted = isNode(ex.name) && ex.name[0] === 'default';
      const bound = defaulted ? Emitter.paramCore(ex.name[2]) : ex.name;
      // The annotation lives on the typed wrapper, which the default (if
      // any) encloses — `last: number = 5` is a default over a typed-var.
      const typed = defaulted ? ex.name[2] : ex.node;
      if (isNode(bound) && bound[0] === 'rest') {
        throw this.positionedError(ex.node,
          "emitter: a rest parameter cannot follow the '...' gap — the gap already binds every argument between the head and the tail, so a second rest has nothing left to collect; name the tail parameter instead");
      }
      this.b.emit('  '.repeat(ind + 1) + 'const ');
      const name = wordOf(bound);
      if (name !== undefined) this.mark(ex.node, '$self', () => this.emitLeaf(bound, name));
      else this.withPattern(() => this.expr(bound), true);
      // The tail parameter's annotation rides its extraction, because the
      // gap swallowed the parameter position that would otherwise carry it
      // — this line is the only place the author's stated type can land,
      // and left off it is discarded outright: the binding then types from
      // whatever a call site contextually supplies, or from nothing at all
      // where no contextual signature exists. TS-only, so the JS emission
      // and the strip invariant are untouched. The gap's own `..._rest`
      // stays bare: the author states no type for it. The optional marker
      // does NOT ride along — `const x?: T` is not a declaration TS admits,
      // and the slot's own absence is what the default below expresses.
      const annotation = this.ts ? this.annotationText(typed) : null;
      if (annotation !== null) this.tsAnnotate(typed, 'annotation', annotation);
      this.b.emit(' = ');
      if (defaulted) {
        // JS parameter-default semantics, verbatim: the default fires when
        // the slot holds `undefined` and not when it holds `null`, so the
        // test is against `undefined` rather than a nullish coalesce. The
        // slot is read twice and that is free — it is arithmetic over a
        // local array the emitter itself minted, with nothing to observe.
        this.b.emit(`${ex.slot} === undefined ? `);
        this.withExpression(() => this.expr(ex.name[3]));
        this.b.emit(` : ${ex.slot}`);
      } else {
        this.b.emit(ex.slot);
      }
      this.b.emit(';\n');
    }
  }

  funcBlock(...args) {
    return this.freshCtrl(() => this.funcBlockCore(...args));
  }

  // An effect's or a computed's body has no parameter list.
  funcBlockCore(node, block, stmts, ind, hoist, voidBody = false, effectTail = false) {
    const params = isFunc(node) ? node[2] : node[0] === 'def' ? node[3] : [];
    this.withVoidBody(voidBody, null, () => this.mark(node, 'body', () => {
      this.mark(block, '$self', () => {
        this.b.emit('{\n');
        this.bodyHoistLine(hoist, ind);
        this.emitGapExtractions(params, ind);
        this.emitTsTypeDecls(this.isBlock(block) ? block.slice(2) : [block], '  '.repeat(ind + 1));
        this.mark(block, 'statements', () => {
          stmts.forEach((stmt, i) => {
            this.b.emit('  '.repeat(ind + 1));
            if (!voidBody && i === stmts.length - 1) this.implicitReturn(stmt, ind + 1, effectTail);
            else this.statement(stmt, ind + 1, true);
            this.b.emit('\n');
          });
        });
        this.voidTailReturn(stmts, ind);
        this.b.emit('  '.repeat(ind) + '}');
      });
    }));
  }

  // A function body's hoisted `let` line, on its own line at the body's
  // indent.
  bodyHoistLine(hoist, ind) {
    if (hoist.length === 0) return;
    this.b.emit('  '.repeat(ind + 1));
    this.hoistLine(hoist, '  '.repeat(ind + 1));
    this.b.emit('\n');
  }

  // Runs a body's emission with its void state: `voidBody` suppresses
  // the implicit return, and `voidReason` names why for the messages
  // that reject a value return.
  withVoidBody(voidBody, voidReason, fn) {
    const prevSEO = this.sideEffectOnly;
    const prevReason = this.voidReason;
    this.sideEffectOnly = voidBody;
    this.voidReason = voidReason;
    fn();
    this.sideEffectOnly = prevSEO;
    this.voidReason = prevReason;
  }

  // A void body's tail: every statement emitted as a statement, then a
  // bare `return;` — the function returns undefined by declaration.
  // Skipped when the last statement already leaves (return/throw) or
  // the body is empty (the head check reads node heads only, so a
  // bare `break`/`continue` word still takes the trailing return).
  voidTailReturn(stmts, ind) {
    if (!this.sideEffectOnly || stmts.length === 0) return;
    const last = stmts[stmts.length - 1];
    if (isNode(last) && ['return', 'throw'].includes(last[0])) return;
    this.b.emit('  '.repeat(ind + 1) + 'return;\n');
  }

  // The last statement of a function body returns its value (the
  // implicit return). Statement constructs in tail
  // position: if → `return (ternary)` when every branch is a single
  // expression, otherwise an in-place if-chain with returns pushed
  // into each branch; try/switch → `return` of the value IIFE;
  // while/loop → the plain statement (tail loops return
  // nothing); for → an inline `_result` accumulator.
  // `effect`: the tail of an effect body, which returns only a value
  // that may be its cleanup (effectTailWrites) — threaded through the
  // branch arms, never into a nested function or a value operand.
  implicitReturn(stmt, ind, effect = false) {
    this.withTsDirectives(stmt, '  '.repeat(ind), () => this.implicitReturnCore(stmt, ind, effect));
  }

  implicitReturnCore(stmt, ind, effect) {
    if (isNode(stmt) && (stmt[0] === 'return' || stmt[0] === 'throw')) return this.statement(stmt, ind);
    const word = wordOf(stmt);
    if (word === 'break' || word === 'continue' || word === 'debugger') return this.statement(stmt, ind);
    if (effect && this.effectTailWrites(stmt)) return this.statement(stmt, ind);
    this.ind = ind;
    if (isStruct(stmt)) {
      const h = stmt[0];
      const plainWrite = h === '=' && stmt.length === 4 && stmt[1].void !== true;
      if (h === 'if' && stmt.length === 5) {
        if (effect && this.effectBranchWrites(stmt)) {
          this.mark(stmt, '$self', () => this.returnifyIf(stmt, ind, true));
        } else if (Emitter.ifIsSimple(stmt)) {
          this.b.emit('return (');
          this.mark(stmt, '$self', () => this.ifTernary(stmt));
          this.b.emit(');');
        } else {
          this.mark(stmt, '$self', () => this.returnifyIf(stmt, ind));
        }
        return;
      }
      // A tail `try` and a tail `switch` are the statements themselves: a
      // `return` in a branch or an arm returns from the enclosing function,
      // so neither arms the tail exemption, which belongs to a value
      // lowering whose IIFE a `return` must tunnel through.
      if (h === 'try') {
        this.tryBranches(stmt, ind, effect);
        return;
      }
      if (h === 'switch' && stmt.length === 5) {
        this.mark(stmt, '$self', () => this.switchArms(stmt, ind, effect));
        return;
      }
      if ((h === 'while' && stmt.length === 5) || (h === 'loop' && stmt.length === 7 && stmt[1].over === 'forever')) {
        return this.statement(stmt, ind);
      }
      // A tail-position return/continue/break guard stays a statement:
      // its jump fires on the guard path, and the fall-through returns
      // undefined — there is no value form to wrap. Throw guards are
      // NOT included: a tail `x or throw e` still has a value form
      // (and must keep rejecting yield inside that IIFE).
      if (Emitter.returnGuard(stmt) || Emitter.stmtGuard(stmt) ||
          (plainWrite && (Emitter.returnGuard(stmt[3]) || Emitter.stmtGuard(stmt[3])))) {
        return this.statement(stmt, ind);
      }
      // A slice assignment likewise: it splices in place, and the
      // function returns undefined.
      if (plainWrite && Emitter.sliceTarget(stmt[2]) !== null) return this.statement(stmt, ind);
      // A tail-position reactive declaration stays a statement — its
      // lowering is a `const` declaration, which has no value form: the
      // declaration stands and the function returns undefined. A BOUND
      // effect is the same class, and so is a readonly declaration;
      // a BARE tail effect falls through and RETURNS the disposer — the
      // caller owns disposal.
      if (this.isReactiveDecl(stmt) || this.isReadonlyDecl(stmt)) return this.statement(stmt, ind);
      if (this.isEffectDecl(stmt) && !isNone(stmt[2])) return this.statement(stmt, ind);
      if (isSourceLoop(stmt)) return this.returnifyLoop(stmt, ind);
      if (h === 'def') {
        throw this.positionedError(stmt, "emitter: implicit return of a 'def' body is not supported yet");
      }
    }
    this.b.emit('return ');
    this.withTailReturn(() => {
      const wrap = Emitter.needsGrouping(stmt, 'return');
      if (wrap) this.b.emit('(');
      this.expr(stmt);
      if (wrap) this.b.emit(')');
    });
    this.b.emit(';');
    // A tail schema declaration (`return S = __schema(…)`) takes its
    // behavior object after the return, as the statement form takes
    // it after the statement: TS-only, and a type query (`typeof`)
    // reads a declaration below it whether or not control reaches it.
    if (this.ts && isNode(stmt) && stmt[0] === '=' && stmt.length === 4 && stmt[1].void !== true) this.tsSchemaBehavior(stmt[3]);
  }
}
