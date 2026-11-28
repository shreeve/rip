// Reactive declarations and the reactive frames: which names are state,
// computed, readonly or members, how their reads and writes lower, and
// the declarations and effects that create them.
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

import { containerType, MINTED, syntacticLiteralType } from '../ts/components.js';
import { isCall, isNode, isNone, isStruct, mkNode, wordOf } from '../sexpr.js';
import { isAssignHead, EMPTY_FRAME } from './helpers.js';
import { isFunc, isIf, isLoopNode, isUpdate, thisField } from './tree.js';
import { Emitter } from './core.js';

// What an object pattern's pair writes: a keyed pair its value; a
// shorthand, void or default pair, and a spread, the node it holds first.
const pairTarget = (pair) => (pair[0] === ':' && pair[1].shorthand !== true && pair[1].void !== true ? pair[3] : pair[2]);

// A destructuring pattern, for naming what a declaration cannot bind.
const isPatternNode = (x) => isNode(x) && (x[0] === 'object' || x[0] === 'array');

// Pattern nodes whose write target is the node they hold first.
const WRAPPED_TARGETS = new Set(['rest', '...', 'default', '=', 'cast', 'satisfies']);

// Does a frame bind `name` — as a reactive name, a plain binding or
// parameter, or a component member?
const binds = (f, name) => f.reactive.has(name) || f.bound.has(name) || (f.members !== undefined && f.members.has(name));

export class ReactiveMethods {
  // Open a reactive frame for a scope (paired with a this.scopes push
  // at every function/program scope; loop/catch frames are
  // binding-only and push no scope). Returns every const-declared
  // name the scope's declarations bind — reactive names, effect
  // dispose handles, AND readonly names — so the caller can extend
  // its scope-name set (a nested function assigning one must not
  // shadow-hoist it). Handles and readonly names enter the frame's
  // BOUND set, never the reactive set: both are plain consts (reads
  // never unwrap), and each shadows any outer reactive name it
  // re-binds. Exported plain names get their OWN set rather than
  // either, because the write guard has to tell them apart from every
  // other const to name the spellings that DO change; they
  // deliberately stay out of the returned scope names, so an inner
  // function's assignment to the name still binds its own local.
  pushReactiveFrame(stmts, bound, owner = null) {
    const f = this.frameOf(stmts, owner);
    this.rframes.push({
      reactive: f.reactive,
      computed: f.computed,
      // Kept as their own sets, not only folded into `bound`: a read of one
      // answers with the kind its declaration minted, so the scope has to be
      // able to say which spelling declared the name.
      readonly: f.readonly,
      handles: f.handles,
      bound: new Set([...bound, ...f.own.keys()]),
      classes: f.classes,
      importSpecs: f.importSpecs,
      exportedConst: f.exportedConst,
    });
    return new Set([...f.reactive.keys(), ...f.handles.keys(), ...f.readonly.keys()]);
  }

  // The frame facts of the scope `owner` opens, or (with no owner node)
  // of the scope whose statement list is `stmts`, found by its first
  // node with an id. A list of words alone declares nothing.
  frameOf(stmts, owner) {
    let key = owner === null ? null : this.rowIdOf(owner);
    if (key !== null) key = `o${key}`;
    else {
      const first = stmts.find((s) => this.rowIdOf(s) !== null);
      if (first === undefined) return EMPTY_FRAME;
      key = `s${this.rowIdOf(first)}`;
    }
    const f = this.frames.get(key);
    if (f === undefined) throw new Error('emitter: a scope opens that analysis never met');
    return f;
  }

  // A binding-only frame (loop variables, catch bindings): the names
  // shadow outer reactive names for the wrapped emission. They are
  // DECLARATIONS of the block they head (`block` is what inScope
  // reads): a function nested in the block that assigns one writes the
  // block's binding — the iteration's own `let`, the handler's
  // parameter — and never declares a local over it.
  withBindings(names, fn) {
    this.rframes.push({ reactive: new Set(), bound: new Set(names), block: true });
    fn();
    this.rframes.pop();
  }

  // How does a bare identifier READ here? One innermost-first walk
  // over the reactive frames decides: 'reactive' (a `:=`/`~=` name —
  // unwraps to `.value`), 'member-reactive' / 'member' (a component
  // member — rewrites to `this.name.value` / `this.name` — the reactive
  // rewrite's component-scope twin), or null (a plain name). Locals and params
  // shadow members; members shadow module names — within one frame
  // the reactive set wins (the declaration IS the binding).
  resolveBareRead(name) {
    for (let i = this.rframes.length - 1; i >= 0; i--) {
      const f = this.rframes[i];
      if (f.reactive.has(name)) return 'reactive';
      if (f.bound.has(name)) return null;
      if (f.members !== undefined && f.members.has(name)) {
        return f.memberReactive.has(name) ? 'member-reactive' : 'member';
      }
    }
    return null;
  }

  // Does `name` read (or write) as a reactive container here?
  // The kind a name's own DECLARATION minted, asked at any occurrence — so a
  // read answers the way its declaration does. `let count` at a read is the
  // same leak as at the declaration: the binding is a const cell, and the
  // author declared a state. The walk is resolveBareRead's: a local or
  // param shadows a member, and a component's own members are the
  // authority for their names — a member with no kind of its own
  // answers null, never a module binding that shares the spelling.
  kindOfName(name) {
    for (let i = this.rframes.length - 1; i >= 0; i--) {
      const f = this.rframes[i];
      if (f.reactive?.has(name)) return f.computed?.has(name) ? 'computed' : 'state';
      if (f.readonly?.has(name)) return 'readonly';
      if (f.handles?.has(name)) return 'effect';
      if (f.bound?.has(name)) return null;   // shadowed by a plain binding
      if (f.members !== undefined && f.members.has(name)) return f.memberKinds?.get(name) ?? null;
    }
    return null;
  }

  isReactiveName(name) {
    return this.resolveBareRead(name) === 'reactive';
  }

  // A render rejection at a tag word: the word's own leaf span on the
  // face, else the open mark.
  renderAmbiguity(node, message) {
    const word = wordOf(node);
    const own = this.ts && word !== undefined && isNode(node) ? this.leafSpan(node, word, null) : null;
    if (own !== null) return this.positionedErrorAt(own[0], own[1], message);
    return this.positionedErrorInMark(node, message, this.rstate?.node);
  }

  // A member chain rooted at a name that is both a tag and a component
  // member or module binding (`summary.total`, `i.icon`) reads either
  // way; render locals and loop variables shadow the tag by rule, and
  // everything else bound rejects rather than guess.
  rejectBoundTagRoot(node, tag) {
    if (this.bindsName(tag)) {
      throw this.renderAmbiguity(node,
        `emitter: '${tag}' names both an element and a binding here, so this chain could build a <${tag}> or read the binding — ` +
        `put \`= …\` on its own line under the element for the value, or rename the binding to use the element`);
    }
  }

  bindsName(name) {
    for (let i = this.rframes.length - 1; i >= 0; i--) if (binds(this.rframes[i], name)) return true;
    return false;
  }

  // The innermost frame whose `own` set (`classes`, `loopVars`,
  // `importSpecs`) holds `name`, or null when another binding of the
  // spelling answers first: an inner binding that re-uses the spelling
  // is not the outer class, loop variable or import. The frame's own set
  // is asked before its `bound`, because a render factory frame carries
  // its loop bindings in both.
  frameOwning(name, own) {
    for (let i = this.rframes.length - 1; i >= 0; i--) {
      const f = this.rframes[i];
      if (f[own] !== undefined && f[own].has(name)) return f;
      if (binds(f, name)) return null;
    }
    return null;
  }

  // Is `name` a class-expression binding here?
  isClassName(name) {
    return this.frameOwning(name, 'classes') !== null;
  }

  // Marks the loop variable a read of `name` resolves to as read, on its
  // loop's factory record.
  noteLoopVarRead(name) {
    const binding = this.frameOwning(name, 'loopVars')?.loopBindings?.get(name);
    if (binding !== undefined) binding.owner.readVars.add(binding.which);
  }

  // A factory record's loop variables by their visible names, each with
  // the factory record of the loop that declares it.
  static loopBindingsOf(rec) {
    const bindings = new Map();
    for (const entry of rec.loopStack) {
      if (entry.owner === undefined) continue;
      bindings.set(entry.itemVar, { owner: entry.owner, which: 'item' });
      bindings.set(entry.indexVar, { owner: entry.owner, which: 'index' });
    }
    return bindings;
  }

  // Is `name` a RENDER loop's item/index binding here?
  isRenderLoopName(name) {
    return this.frameOwning(name, 'loopVars') !== null;
  }

  // The module `name` was imported from and its original exported name,
  // or null when `name` is not an import here.
  importSpecOf(name) {
    return this.frameOwning(name, 'importSpecs')?.importSpecs.get(name) ?? null;
  }

  // The computed (`~=`) subset of the innermost frame that binds
  // `name`: a computed derives — it has no legal write.
  isComputedName(name) {
    for (let i = this.rframes.length - 1; i >= 0; i--) {
      const f = this.rframes[i];
      if (f.reactive.has(name)) return f.computed !== undefined && f.computed.has(name);
      if (f.bound.has(name)) return false;
      if (f.members !== undefined && f.members.has(name)) return false;
    }
    return false;
  }

  // A seeded (ambient) readonly name at the innermost frame that
  // binds `name`. Direct writes (assign, compound, update) reject at
  // COMPILE time — deliberately STRICTER than an in-file readonly,
  // whose write emits bare and throws JS's own TypeError only when
  // the const runs: across REPL lines the positioned rejection is the
  // better diagnostic and fires before any of the entry's side
  // effects. Pattern-element writes keep the runtime backstop — the
  // evaluation environment restores readonly kinds as const, so JS
  // throws there (the contract is pinned in ambient-bindings tests).
  isAmbientReadonly(name) {
    for (let i = this.rframes.length - 1; i >= 0; i--) {
      const f = this.rframes[i];
      if (f.reactive.has(name)) return false;
      if (f.ambientReadonly !== undefined && f.ambientReadonly.has(name)) return true;
      // A frame's own `=!` declarations sit in `bound` too, so they
      // must answer before the bound check does.
      if (f.readonly !== undefined && f.readonly.has(name)) return true;
      if (f.bound.has(name)) return false;
      if (f.members !== undefined && f.members.has(name)) return false;
    }
    return false;
  }

  // The component-member KIND a bare name resolves to here (state /
  // computed / readonly / prop / plain / method / accept) — null when
  // a local, param, or reactive declaration shadows it, or when no
  // enclosing component declares it. The walk mirrors resolveBareRead.
  memberKindOf(name) {
    for (let i = this.rframes.length - 1; i >= 0; i--) {
      const f = this.rframes[i];
      if (f.reactive.has(name) || f.bound.has(name)) return null;
      if (f.members !== undefined && f.members.has(name)) return f.members.get(name);
    }
    return null;
  }

  // The kind of `this.<name>` against the INNERMOST component — a
  // `this.`/`@` spelling never shadows (the receiver is explicit).
  thisMemberKindOf(name) {
    if (this.thisRebound()) return null;
    for (let i = this.rframes.length - 1; i >= 0; i--) {
      const f = this.rframes[i];
      if (f.members !== undefined) return f.members.has(name) ? f.members.get(name) : null;
    }
    return null;
  }

  // Does a write TARGET land on `this.rest` or inside it? The view is
  // one object held by two hands — the cell the render reads and the
  // `_rest` map the runtime forwards from — so replacing the cell's
  // value parts the hands for the instance's life, and mutating through
  // it notifies neither. Every spelling that reaches the view is a
  // write to it: the member itself, any chain rooted there, and the
  // same shapes inside a destructuring pattern.
  static targetsRestView(t) {
    if (!isNode(t)) return false;
    // A pair's value sits after its key; a spread's is its only child.
    if (t[0] === 'array') return t.slice(2).some((e) => Emitter.targetsRestView(e));
    if (t[0] === 'object') return t.slice(2).some((e) => Emitter.targetsRestView(e[3] ?? e[2]));
    if (t[0] === 'default' || t[0] === 'rest') return Emitter.targetsRestView(t[2]);
    for (let n = t; isNode(n) && (n[0] === '.' || n[0] === '[]' || n[0] === '?.' || n[0] === 'optindex') && n.length === 4; n = n[2]) {
      if (n[0] === '.' && wordOf(n[2]) === 'this' && wordOf(n[3]) === 'rest') return true;
    }
    return false;
  }

  // Under `extends`, `rest` is provided, never declared: nothing above
  // a read says the name exists, and only the member rewrite makes a
  // bare `rest` reach the synthesized view. The sigil is its one
  // spelling — `@rest` names what the runtime supplies, as `@stash` and
  // `@router` do. A local the author binds as `rest` is their own name
  // and shadows the view (memberKindOf answers null there).
  checkBareRest(node, name) {
    if (name !== 'rest' || this.memberKindOf(name) !== 'rest') return;
    throw this.positionedErrorInMark(node,
      'emitter: `rest` is provided by `extends`, not declared here — spell it `@rest`, as with `@stash` and `@router`');
  }

  // Component-member write guards — called with an assignment/update
  // TARGET before emission. A readonly ('=!') member has no legal
  // write anywhere after _init, so the write rejects at the site; a
  // plain ('=') member write RECORDS for the silent-freeze check at
  // component close (render reads of a plain member never re-run).
  checkMemberWrite(node, target) {
    if (this.cframes.length === 0) return;
    if (this.thisMemberKindOf('rest') === 'rest' && Emitter.targetsRestView(target)) {
      throw this.positionedError(node,
        'emitter: `@rest` is the runtime-owned view of the caller\'s undeclared props and is never assigned — ' +
        'set the attribute on the element in render, or declare the name as a prop the caller supplies');
    }
    // A destructuring write lands on each member it assigns, bare or
    // `@`: each is written as surely as by `c = …`.
    if (Emitter.isPattern(target)) {
      for (const [name, kind] of this.patternMemberTargets(target)) this.checkMemberKindWrite(node, name, kind);
      return;
    }
    const word = wordOf(target);
    if (word !== undefined) {
      this.checkBareRest(node, word);
      this.checkMemberKindWrite(node, word, this.memberKindOf(word));
      return;
    }
    const field = thisField(target);
    if (field !== null) this.checkMemberKindWrite(node, field, this.thisMemberKindOf(field));
  }

  // The members a destructuring target assigns, as [name, kind] — each
  // bare name and each `@name` leaf; a default value is a read.
  patternMemberTargets(p, out = []) {
    const word = wordOf(p);
    if (word !== undefined) {
      out.push([word, this.memberKindOf(word)]);
      return out;
    }
    if (!isNode(p) || isNone(p)) return out;
    this.rejectCallTarget(p);
    const h = p[0];
    const field = thisField(p);
    if (field !== null) out.push([field, this.thisMemberKindOf(field)]);
    else if (h === 'array') for (let i = 2; i < p.length; i++) this.patternMemberTargets(p[i], out);
    // A keyed pair writes its value; a shorthand or void pair, a default
    // pair and a spread write the name they hold first.
    else if (h === 'object') for (let i = 2; i < p.length; i++) this.patternMemberTargets(pairTarget(p[i]), out);
    else if (WRAPPED_TARGETS.has(h)) this.patternMemberTargets(p[2], out);
    return out;
  }

  checkMemberKindWrite(node, name, kind) {
    if (kind === null) return;
    if (kind === 'computed') this.rejectComputedMemberWrite(node, name);
    if (kind === 'readonly') {
      throw this.positionedError(node,
        `emitter: cannot assign to readonly member '${name}' — a '=!' member never changes after _init; ` +
        "a member that changes is state (':=')");
    }
    if (kind === 'plain') {
      const f = this.cframes[this.cframes.length - 1];
      if (!f.plainWrites.has(name)) f.plainWrites.set(name, node);
    }
  }

  // A computed member (`~=`) derives from its dependencies: there is no
  // write, and the runtime's read-only container would throw at the
  // assignment, the loud error in the wrong place.
  rejectComputedMemberWrite(node, name) {
    throw this.positionedError(node,
      `emitter: cannot assign to computed '${name}' — a '~=' member derives from its dependencies; write to those instead`);
  }

  // A render read of a plain ('=') member — the other half of the
  // silent-freeze pair.
  notePlainRenderRead(name, viaThis = false) {
    if (this.rstate == null || this.cframes.length === 0) return;
    const kind = viaThis ? this.thisMemberKindOf(name) : this.memberKindOf(name);
    if (kind !== 'plain') return;
    this.cframes[this.cframes.length - 1].renderPlainReads.add(name);
  }

  // The read/write rewrite decision for a bare identifier in the
  // emission stream — reactive names AND component members. BINDING
  // patterns (params, loop variables) are new names, never reads;
  // TARGET patterns assign into the container (`[a.value, b] = pair`).
  bareRewrite(name) {
    if (this.inPattern && this.bindingPattern) return null;
    return this.resolveBareRead(name);
  }

  // Is `this.<name>` a REACTIVE member of the innermost enclosing
  // component? ThisProperty reads/writes never shadow (the `this.` is
  // explicit), and `this` always means the INNERMOST component — outer
  // frames never answer.
  memberIsReactive(name) {
    if (this.thisRebound()) return false;
    const f = this.cframes[this.cframes.length - 1];
    return f !== undefined && f.memberReactive.has(name);
  }

  inComponent() {
    return this.cframes.length > 0;
  }

  // Inside an object-literal method or a class body, `this` is the
  // object or instance, not the innermost component: `@x` reads the
  // receiver's own property, and no component member is reachable
  // through `this`.
  thisRebound() {
    // A render factory spells the component as its ctx parameter, `this`
    // included, so no boundary inside it moves the receiver.
    if (this.renderSelf !== null) return false;
    const n = this.thisBoundaries.length;
    return n > 0 && this.thisBoundaries[n - 1] === this.cframes.length && this.cframes.length > 0;
  }

  withThisBoundary(fn) {
    this.thisBoundaries.push(this.cframes.length);
    try { return fn(); } finally { this.thisBoundaries.pop(); }
  }

  // The name a rewritten read spells, ahead of the `.value` (or after the
  // `this.`) the lowering adds. When the innermost open mark's SOURCE
  // SPAN is exactly this identifier (the operand/value/target role of
  // the read site), the bare identifier re-marks that same (nodeId,
  // role) — an EXACT row on the read site nested inside the role's
  // cover row over the whole lowered read (one-to-many; serialization
  // prefers the exact row, so a breakpoint on the read lands on the
  // identifier). Any other enclosing span (a spread args role, a
  // lowered construct's $self) gains no inner row — re-marking it
  // around the identifier would serialize a name row whose source text
  // is not the identifier. The face maps the name to its leaf instead
  // and returns the leaf's source span (null in JS mode).
  emitReadName(name, leaf) {
    if (this.ts) {
      const span = leaf !== null ? this.emitLeaf(leaf, name) : this.emitWordAt(name, null);
      if (span !== null && this._narrowedReads?.has(name)) this.narrowedDecls.push({ start: span[0], end: span[1] });
      return span;
    }
    const m = this.b.currentMark;
    const src = this.b.source;
    if (m !== null && src !== null && src.slice(m.sourceStart, m.sourceEnd) === name) {
      this.b.mark(m.nodeId, m.role, () => this.b.emit(name));
    } else {
      this.b.emit(name);
    }
    return null;
  }

  // An unwrapped reactive read: `count` → `count.value`.
  reactiveRead(name, leaf = null) {
    this.emitReadName(name, leaf);
    this.b.emit('.value');
  }

  // A component method read as a value — passed, stored, mapped — keeps
  // its instance: it reads as the instance's bound function (`_bound`).
  // A reference position (asReference) reads the method itself.
  boundMethodRead(name, kind) {
    const callee = this.calleeName;
    this.calleeName = null;
    return kind === 'method' && callee !== name && !this.inTarget;
  }

  // The TS face reads the bound function back as the method's own type
  // (TS-only bytes, so the face stays the JS bytes plus regions).
  emitBoundMethod(name, leaf = null) {
    const self = this.renderSelf ?? 'this';
    if (this.ts) this.b.tsOnly(() => this.b.emit('('));
    this.b.emit(self + '._bound("');
    if (leaf !== null) this.emitLeaf(leaf, name);
    else this.emitWordAt(name, null);
    this.b.emit('")');
    if (this.ts) this.b.tsOnly(() => this.b.emit(` as ${self === 'this' ? 'this' : `(typeof ${self})`}[${JSON.stringify(name)}])`));
  }

  // Emit a reference position — a call's callee, a member access's
  // object (`go.call(…)`, `go.length`), a delete's operand — where a bare
  // or `@` method name is the method itself, not a value read.
  asReference(callee, fn) {
    const name = wordOf(callee) ?? thisField(callee);
    const prev = this.calleeName;
    this.calleeName = name;
    try { fn(); } finally { this.calleeName = prev; }
  }

  // A component-member read/write: `count` → `this.count.value`
  // (reactive) / `note` → `this.note` (plain) — the reactive rewrite's
  // component-scope twin.
  memberRead(name, reactive, leaf = null) {
    if (this.thisRebound()) {
      throw this.positionedErrorInMark(name,
        `emitter: component member '${name}' is not reachable here — inside an object-literal method or a class body \`this\` is the object, not the component; read it into a local outside, or write the pair with \`=>\` to keep the component`);
    }
    if (!reactive && this.boundMethodRead(name, this.memberKindOf(name))) return this.emitBoundMethod(name, leaf);
    this.b.emit((this.renderSelf ?? 'this') + '.');
    const span = this.emitReadName(name, leaf);
    // A reactive read's SOURCE span joins the value-first channel
    // (memberDecls): the author wrote a bare read and the lowering
    // appended `.value`, so a hover here answers the VALUE type, the
    // same presentation the declaration serves — RULINGS.md's
    // member-read row. A consumer holding an instance never passes
    // through this rewrite, so consumer positions keep the container.
    if (reactive && span !== null) this.memberDecls.push({ start: span[0], end: span[1] });
    if (reactive) this.b.emit('.value');
  }

  // ["state", {}, target, value] | ["computed", {}, target, value] — the
  // reactive declarations, statement position only (guarded by the
  // dispatch's isReactiveDecl and the expression-path rejection).
  //
  //   count := e        → const count = __state(e);
  //   total ~= e        → const total = __computed(() => e);
  //   total ~= <block>  → const total = __computed(() => { … });
  //
  // Mapping story (the bidirectional-mapping showcase): $self covers the whole
  // lowering; target is exact on the name (both here and, for typed
  // forms, under the annotation's cover); operator is the
  // side-band role — its RoleStore span is the `:=`/`~=` token, its
  // generated manifestation the emitted `=` (a cover row by
  // construction: the glyphs differ). The `__state(` / `__computed(()
  // => ` glyphs are the lowering's own text — inside $self, outside
  // every child role (cover rows over the lowering, exact rows
  // on user expressions).
  reactiveDecl(node, ind) {
    const [head, , targetNode, value] = node;
    const op = head === 'state' ? ':=' : '~=';
    const target = wordOf(targetNode);
    if (target === undefined) {
      throw this.positionedError(node, `emitter: a reactive declaration takes a plain name — '<target> ${op} …' cannot declare a ${isPatternNode(targetNode) ? 'destructuring pattern' : 'member or index target'}`);
    }
    // The lowering CALLS the runtime name the declaration would bind —
    // no working reading exists (the declared-boundary class).
    if ((head === 'state' && target === '__state') || (head === 'computed' && target === '__computed')) {
      throw this.positionedError(node, `emitter: '${target} ${op} …' would bind the very runtime name its own lowering calls (const ${target} = ${target}(…) — a TDZ self-reference); rename the variable`);
    }
    // A computed body evaluates SYNCHRONOUSLY (the runtime computes
    // lazily and caches — there is no async
    // computed). Nested functions keep their own awaits/yields.
    if (head === 'computed' && this.containsAwait(value)) {
      throw this.positionedError(node, "emitter: a computed ('~=') body cannot await — computeds evaluate synchronously (make it a state written by an effect)");
    }
    if (head === 'computed' && this.containsYield(value)) {
      throw this.positionedError(node, "emitter: a computed ('~=') body cannot yield — computeds evaluate synchronously");
    }
    // A typed declaration's annotation role (side-band) covers the
    // whole emitted declaration — its only generated manifestation;
    // mark() is a no-op for the untyped rows.
    this.mark(node, 'annotation', () => this.mark(node, '$self', () => {
      this.b.emit('const ');
      // The name's generated span, recorded as it is written. A `:=` name is
      // WRITABLE in rip (`clicks = 5` → `clicks.value = 5`) though the cell it
      // binds is `const`; a `~=` name is not. `export count := 0` routes through
      // here too, so exports record identically.
      const nameStart = this.b.offset;
      this.mark(node, 'target', () => this.b.emit(target));
      if (head === 'state' && this.ts) this.mutables.push([nameStart, this.b.offset]);
      if (this.ts) this.noteKind(node, 'target', head === 'state' ? 'state' : 'computed');
      // TS face: a typed reactive declaration types its CONTAINER —
      // the annotation names the `.value` slot (the dts convention;
      // a computed's container is read-only from the outside), and
      // the container carries the `read(): T` structural brand (the
      // runtime's detection predicate — src/ts/components.js has
      // the doctrine): a plain `{ value: … }` literal must never
      // satisfy a container position the runtime would double-wrap.
      if (this.ts && this.annotationText(node) !== null) {
        const ro = head === 'computed' ? 'readonly ' : '';
        this.tsAnnotate(node, 'annotation', containerType(this.annotationText(node), ro, MINTED));
      } else if (this.ts) {
        // Unannotated reactive with a syntactically-evident value type:
        // the container annotates from the initializer alone — `clicks
        // := 0` is a number cell, `~= clicks * 2` a readonly number cell —
        // so the cell CHECKS and the hover has a value type to present.
        // Other initializers infer through the runtime's generic signature.
        // No `satisfies` here: the type came FROM the value.
        const t = syntacticLiteralType(value);
        if (t !== null) {
          const ro = head === 'computed' ? 'readonly ' : '';
          this.b.tsOnly(() => this.b.emit(`: ${containerType(t, ro, MINTED)}`));
        }
      }
      this.b.emit(' ');
      this.mark(node, 'operator', () => this.b.emit('='));
      this.b.emit(' ');
      // Annotation ENFORCEMENT: the container annotation above types
      // the CELL, not the value, so the initializer would flow into
      // __state()/__computed() unchecked unless something constrains
      // it. A TS-only EXPLICIT TYPE ARGUMENT does: `__state<T>(v)`
      // pins the primitive's own generic, which checks the value at
      // the argument AND makes the call's return type exactly the
      // annotated container — so the declaration itself has nothing
      // left to complain about, and one wrong line publishes ONE
      // diagnostic instead of two. `<T>` strips to the identical JS.
      // Marked under the annotation role, so the fired error maps to
      // the author's `: T`.
      //
      // Each alternative publishes worse. `satisfies T` on the value
      // leaves T inferred FROM the value, so the container annotation
      // fails too and a second diagnostic lands on the name in
      // cell-wrapper prose; both mechanisms together fail the value
      // twice; an overload spelling the parameter without its cell
      // branch draws TS2769 against the last overload, losing the
      // tuple spelling's element anchor.
      //
      // ACCEPTED LIMIT: because __state admits an existing cell in
      // its argument (the prop delivery seam — see RUNTIME_TABLE),
      // a SCALAR state rejection names that union. It still leads
      // with the value types and lands on the value; the array/tuple
      // spellings and every `~=` collapse to the bare type.
      //
      // The SPAN is TypeScript's own, not a rip invention: 12-reactive's
      // twin spells these as a call with a pinned parameter and an arrow
      // with a pinned return, and tsgo puts its diagnostic exactly where
      // the lowering puts ours — so the audit derives both lines rather
      // than pinning them.
      const enforce = this.ts ? this.annotationText(node) : null;
      const typeArg = () => {
        if (enforce === null) return;
        this.b.tsOnly(() => this.mark(node, 'annotation', () =>
          this.emitTypeText(node, 'annotation', `<${enforce}>`)));
      };
      if (head === 'state') {
        this.b.emit(this.runtimeName('__state'));
        typeArg();
        this.b.emit('(');
        // The initializer is an operand position (value context:
        // compounds group — `__state((1 + 2))`).
        this.mark(node, 'value', () => this.withExpression(() => this.operandExpr(value)));
        this.b.emit(')');
      } else {
        this.b.emit(this.runtimeName('__computed'));
        typeArg();
        this.b.emit('(() => ');
        this.mark(node, 'value', () => this.withExpression(() => this.computedBody(node, value, ind)));
        this.b.emit(')');
      }
    }));
    this.b.emit(';');
  }

  // `value` in operand position: parenthesized when its precedence
  // needs it, or (with `objects`) when it is an object literal, whose
  // bare `{` would open an arrow's block body.
  operandExpr(value, objects = false) {
    const wrap = Emitter.needsGrouping(value, 'operand') || (objects && this.isObject(value));
    if (wrap) this.b.emit('(');
    this.expr(value);
    if (wrap) this.b.emit(')');
  }

  // A computed's or an effect's block body as the braced body of the
  // arrow the caller opened: its own scope and reactive frame, hoists,
  // and the implicit return of its last expression (an effect's is its
  // cleanup).
  blockFunctionBody(owner, block, ind, effectTail) {
    const stmts = this.liveStmts(block.slice(2));
    const { entries, names } = this.scopedHoist(block.slice(2), []);
    for (const n of this.pushReactiveFrame(stmts, names)) names.add(n);
    this.scopes.push(names);
    this.rejectUnboundIt([], block, { root: owner });
    this.funcBlock(owner, block, stmts, ind, entries, false, effectTail);
    this.scopes.pop();
    this.rframes.pop();
  }

  // The computed body: a multi-statement Block emits as a braced
  // function body; everything else inlines as the arrow's expression
  // body. A single-statement Block reads through expr's
  // comma-expression path (`(1 + 2)`).
  computedBody(node, value, ind) {
    if (this.isBlock(value) && value.length > 3) {
      this.blockFunctionBody(node, value, ind, false);
      return;
    }
    this.rejectUnboundIt([], value, { root: node });
    this.operandExpr(value, true);
  }

  // ["readonly", {}|{void}, target, value] — the readonly declaration,
  // statement position only (guarded by the dispatch's isReadonlyDecl
  // and the expression-path rejection).
  //
  //   x =! e  →  const x = e;
  //
  // A plain const — no runtime call (JS itself
  // enforces the reassignment; writes emit bare against the const and
  // hit JS's own TypeError, the handle precedent). The value is
  // an operand position (compounds group — `const x = (1 + 2);`)
  // and unwraps reactive reads like any expression
  // (`ro =! count` → `const ro = count.value;` — a value SNAPSHOT,
  // the readonly contract).
  //
  // Mapping story (the reactive mapping pattern): $self covers the whole
  // lowering; target is exact on the name; operator is the
  // side-band role — its RoleStore span is the `=!` token, its
  // generated manifestation the emitted `=` (a cover row by
  // construction: the glyphs differ); a typed twin's annotation role
  // covers the whole declaration.
  readonlyDecl(node, ind) {
    const [, attrs, targetNode, value] = node;
    if (attrs.void === true) this.registerVoidValue(value, node);
    const target = wordOf(targetNode);
    if (target === undefined) {
      throw this.positionedError(node, `emitter: a readonly declaration takes a plain name — '<target> =! …' cannot declare a ${isPatternNode(targetNode) ? 'destructuring pattern' : 'member or index target'}`);
    }
    this.mark(node, 'voidMarker', () => this.mark(node, 'annotation', () => this.mark(node, '$self', () => {
      this.b.emit('const ');
      this.mark(node, 'target', () => this.b.emit(target));
      if (this.ts) this.noteKind(node, 'target', 'readonly');
      if (this.ts && this.annotationText(node) !== null) {
        this.tsAnnotate(node, 'annotation', this.annotationText(node));
      }
      this.b.emit(' ');
      this.mark(node, 'operator', () => this.b.emit('='));
      this.b.emit(' ');
      this.mark(node, 'value', () => this.withExpression(() => this.operandExpr(value)));
    })));
    this.b.emit(';');
  }

  // ["effect", {}, target|none, body] — the effect statement.
  //
  //   ~> expr           → __effect(() => { return expr; });
  //   ~> <block>        → __effect(() => { … });
  //                       (either form returns its last expression — the
  //                       CLEANUP channel — unless that is a statement)
  //   ~> -> body        → __effect((function() { … }));  (arrow value
  //   h ~> => body      → const h = __effect(() => …);    passes through
  //                       AS the effect function)
  //   h ~> body         → const h = __effect(…);          (the dispose
  //                       handle — a plain const, never reactive)
  //
  // An awaiting body emits an ASYNC arrow riding the runtime's
  // async semantics (per-run AbortSignal, stale guards).
  //
  // Mapping story: $self covers the whole lowering; the bound form's
  // target is exact and its operator role (the side-band label on
  // the dropped EFFECT token) covers the emitted `=` (the reactive
  // pattern); the BARE form's operator covers the emitted `__effect`
  // name — the `~>` glyph's only generated manifestation. The body
  // (`value` role) covers the synthesized wrapper; user statements
  // inside stay exact.
  effectStatement(node, ind) {
    const [, , targetNode, body] = node;
    const target = isNone(targetNode) ? null : wordOf(targetNode);
    if (target === undefined) {
      throw this.positionedError(node, `emitter: an effect handle takes a plain name — '<target> ~> …' cannot bind a ${isPatternNode(targetNode) ? 'destructuring pattern' : 'member or index target'}`);
    }
    // The lowering CALLS the runtime name the handle would bind — no
    // working reading exists (the declared-boundary class).
    if (target === '__effect') {
      throw this.positionedError(node, `emitter: '__effect ~> …' would bind the very runtime name its own lowering calls (const __effect = __effect(…) — a TDZ self-reference); rename the handle`);
    }
    this.mark(node, 'annotation', () => this.mark(node, '$self', () => {
      if (target !== null) {
        this.b.emit('const ');
        this.mark(node, 'target', () => this.b.emit(target));
        if (this.ts) this.noteKind(node, 'target', 'effect');
        if (this.ts && this.annotationText(node) !== null) {
          this.tsAnnotate(node, 'annotation', this.annotationText(node));
        }
        this.b.emit(' ');
        this.mark(node, 'operator', () => this.b.emit('='));
        this.b.emit(' ');
        this.effectValue(node, body, ind, false);
      } else {
        this.effectValue(node, body, ind, true);
      }
    }));
    this.b.emit(';');
  }

  // A render body's expressions embed inside synchronous generated
  // scopes — _create, updater effects, block factories, event listeners
  // and their __batch windows — none of which is async or a generator.
  // A function VALUE (a handler arrow, a function prop, a callback)
  // owns its own control context. The rule is enforced where the
  // awaiting forms EMIT: no render emission pushes a function scope, and
  // every function value does (emitFunc), so inside a render body the
  // scope depth equals the depth the render opened at exactly when the
  // form sits in a generated scope. Nothing about render's structure is
  // re-derived, so no render shape can disagree with the check.
  renderSyncGuard(node) {
    const R = this.rstate;
    if (R && this.scopes.length === R.scopeDepth) throw this.renderSyncError(node);
  }

  renderSyncError(node) {
    return this.positionedError(node,
      "emitter: a render body evaluates synchronously — 'await'/'yield' cannot appear in a render expression " +
      "(text, attributes, props, and event listeners emit into non-async generated scopes); compute the value " +
      "into a member (a state written by an effect), or make the handler a function ('-> await ...')", this.rstate.node);
  }

  // The first await/yield an EXPRESSION evaluates in its own scope:
  // every function in it is a value and the walk stops there. Formal
  // parameters and component member initializers are judged with it. A
  // render local's value is too, before its binding is judged: the
  // dead-local diagnostic runs at collection, ahead of emission, and
  // would otherwise answer for a line whose defect is the await.
  firstAwaitIn(n) {
    if (!isStruct(n)) return null;
    if (isNode(n)) {
      const head = n[0];
      if (head === 'await' || (isCall(n) && n[1].await === true) || head === 'yield' || head === 'yield-from') return n;
      if (head === 'loop' && n[1].await === true) return n;
      // An effect is a function too: effectValue pushes its scope and
      // emits it async when it awaits. Its NodeStore row identifies the
      // real construct; a BOUND effect in an expression position is left
      // to its own diagnostic. A class body owns its awaits, but its
      // HERITAGE evaluates here.
      if (head === 'class') return this.firstAwaitIn(n[3]);
      if (isFunc(n) || head === 'def' || this.isEffectDecl(n)) return null;
    }
    for (let i = isNode(n) ? 2 : 0; i < n.length; i++) {
      const hit = this.firstAwaitIn(n[i]);
      if (hit !== null) return hit;
    }
    return null;
  }

  // The `__effect(…)` call itself — shared by the statement form and
  // the bare form's expression position (`x = (~> f())` binds the
  // disposer). `markOp` marks the operator role over the emitted
  // `__effect` name (the bare form; the bound form's operator is its
  // `=`).
  effectValue(node, body, ind, markOp) {
    // The runtime calls the effect function — a generator frame would
    // never run its body. Nested functions keep their own yields.
    if (this.effectBodyYields(body)) {
      throw this.positionedError(node, "emitter: an effect ('~>') body cannot yield — the runtime calls the effect function (make the generator a named function the effect calls)");
    }
    const emitName = () => {
      const name = this.runtimeName('__effect');
      if (markOp) this.mark(node, 'operator', () => this.b.emit(name));
      else this.b.emit(name);
    };
    // Arrow-valued bodies pass through AS the effect function; the
    // arrow's own emission carries async when its body awaits. `->`
    // groups (`__effect((function() {…}))`); `=>` emits bare.
    if (isFunc(body)) {
      emitName();
      this.b.emit('(');
      this.mark(node, 'value', () => this.withExpression(() => {
        const wrap = body[0] === '->';
        if (wrap) this.b.emit('(');
        this.expr(body);
        if (wrap) this.b.emit(')');
      }));
      this.b.emit(')');
      return;
    }
    const isAsync = this.containsAwait(body);
    emitName();
    this.b.emit(isAsync ? '(async () => ' : '(() => ');
    // A returned function runs before the next run and on dispose; the
    // runtime owns that contract.
    if (this.isBlock(body)) this.mark(node, 'value', () => this.withExpression(() => this.blockFunctionBody(node, body, ind, true)));
    else this.effectExpressionBody(node, body, ind);
    this.b.emit(')');
  }

  // A single-expression effect body as the braced body of the arrow the
  // caller opened, returning the expression as the cleanup unless it is
  // a statement. Still its own function scope: a new name it assigns
  // hoists INSIDE the wrapper.
  // A component body effect passes the block it unwraps (`block`): the
  // unbound-`it` check reads the written form, and no schema scope is
  // placed.
  effectExpressionBody(node, body, ind, block = null) {
    const { entries, names } = this.scopedHoist([body], []);
    this.scopes.push(names);
    this.rframes.push({ reactive: new Set(), bound: names });
    this.rejectUnboundIt([], block ?? body, { root: node });
    this.b.emit('{ ');
    if (entries.length) {
      this.hoistLine(entries);
      this.b.emit(' ');
    }
    if (block === null) this.placeSchemaScope([body], '');
    if (this.effectBranchWrites(body)) {
      this.mark(node, 'value', () => this.withExpression(() => this.implicitReturn(body, ind, true)));
      this.b.emit(' }');
    } else {
      if (!this.effectTailWrites(body)) this.b.emit('return ');
      this.mark(node, 'value', () => this.withExpression(() => this.operandExpr(body, true)));
      this.b.emit('; }');
    }
    this.scopes.pop();
    this.rframes.pop();
  }

  // An effect's tail returns as its cleanup unless the tail is a
  // statement: a write (`if open then win.onkeydown = (e) -> …` would
  // otherwise register the handler it assigns as the cleanup), an
  // update, a loop, or a declaration. Every other tail may produce the
  // cleanup — a call (`~> subscribe(x)`), an optional call, a logical
  // or conditional expression, `new`, a nested effect's dispose handle
  // — and the runtime ignores a result that is not a function.
  effectTailWrites(stmt) {
    if (!isNode(stmt) || wordOf(stmt) !== undefined) return false;
    const h = stmt[0];
    // A parenthesized sequence (`(a = 0; b = 1)`) is the statement its
    // tail is; a branching tail inside one has no per-arm form there.
    if (this.isBlock(stmt) && stmt.length > 2) {
      const tail = stmt[stmt.length - 1];
      return this.effectTailWrites(tail) || this.effectBranchWrites(tail);
    }
    // A guarded write (`open and win.onkeydown = …`) is the `if` spelled
    // with an operator: its value is the write's.
    if ((h === '&&' || h === '||' || h === '??') && stmt.length === 4) {
      return this.effectTailWrites(stmt[3]) || this.effectBranchWrites(stmt[3]);
    }
    if (isAssignHead(h) || isUpdate(stmt)) return true;
    // A counted loop (`loop n`) is a value tail: its collected array
    // returns, and the runtime ignores a cleanup that is no function.
    if ((isLoopNode(stmt) && stmt[1].over !== 'times') || h === 'comprehension') return true;
    if (h === 'def' || h === 'class' || h === 'export') return true;
    if (this.isModuleImport(stmt) || this.isReactiveDecl(stmt) || this.isReadonlyDecl(stmt)) return true;
    return this.isEffectDecl(stmt) && !isNone(stmt[2]);
  }

  // Does a branching tail end in a statement on any arm? Each arm then
  // decides its own return (`if active then -> stop() else status =
  // 'idle'` returns the first arm's cleanup and runs the second's write).
  effectBranchWrites(stmt) {
    if (!isNode(stmt)) return false;
    const armTail = (body) => {
      const stmts = Emitter.branchStmts(body);
      const tail = stmts[stmts.length - 1];
      return this.effectTailWrites(tail) || this.effectBranchWrites(tail);
    };
    if (isIf(stmt)) {
      let arm = stmt;
      for (; isIf(arm[4]); arm = arm[4]) if (armTail(arm[3])) return true;
      return armTail(arm[3]) || (!isNone(arm[4]) && armTail(arm[4]));
    }
    if (stmt[0] === 'switch' && stmt.length === 5) {
      return stmt[3].some((w) => armTail(w[3])) || (!isNone(stmt[4]) && armTail(stmt[4]));
    }
    if (stmt[0] === 'try') {
      return armTail(this.isBlock(stmt[2]) ? stmt[2] : mkNode('block', stmt[2])) ||
        (!isNone(stmt[3]) && armTail(stmt[3][3]));
    }
    return false;
  }

  effectBodyYields(body) {
    return isFunc(body) ? this.containsYield(body[3]) : this.containsYield(body);
  }
}
