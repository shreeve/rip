// The dynamic half of the render DSL, called from render.js's walk:
// render scopes and locals, block factories,
// narrowing, conditionals, switches, loops, transitions, refs and binds.
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

import { isIdentifierName } from '../ident.js';
import { hostText } from '../ts/dom-types.js';
import { isCall, mkNode } from '../sexpr.js';
import { toParser, toShaped } from '../emitter-shape.js';
import { RENDER_BINDING_HEADS, isShapedNode as isNode, isChildren } from './helpers.js';
import { Emitter } from './core.js';
import { referencesNames } from './walks.js';

export class RenderDynamicMethods {
  // The current loop variable names, innermost scope's whole stack.
  loopVarNames() {
    const names = new Set();
    for (const v of this.rstate.sink.loopStack) {
      names.add(v.itemVar);
      names.add(v.indexVar);
    }
    return names;
  }

  // A render expression captured for LATER emission must not read an
  // ENCLOSING render scope's locals — each factory is its own JS
  // function (a compiled read would be a ReferenceError, or would
  // re-read the name as markup). Names the current scope re-binds
  // are its own and pass.
  checkCrossScopeLocals(expr, node) {
    const R = this.rstate;
    if (!R) return;
    const loopVars = this.loopVarNames();
    const visible = (n) => R.sink.locals.has(n) || loopVars.has(n);
    for (let r = R.sink.parent; r !== null; r = r.parent) {
      if (r.locals.size === 0) continue;
      const hidden = new Set([...r.locals].filter((n) => !visible(n)));
      if (hidden.size > 0 && referencesNames(expr, hidden, this.stores)) {
        throw this.positionedError(node,
          'emitter: this expression reads a render local of an ENCLOSING render scope — each dynamic block (a ' +
          'conditional branch, a loop body) is its own factory function, and render locals never cross that boundary ' +
          '; declare the local ' +
          'inside this block, or use a member', this.rstate.node);
      }
    }
  }

  // A render local: `name = expr` declares (a create-phase `let` —
  // a create-time snapshot, the semantics), compound forms mutate.
  // Returns null — no DOM child.
  renderBinding(stmt) {
    const [op, name, value] = stmt;
    const rec = this.rstate.sink;
    const control = this.firstAwaitIn(value);
    if (control !== null) throw this.renderSyncError(control);
    if (name.startsWith('__')) {
      throw this.positionedError(stmt,
        `emitter: render local '${name}' — double-underscore names are the compiler/runtime namespace inside render ` +
        '(factory scaffolding and injected helpers live there)');
    }
    if (rec.loopStack.some((v) => v.itemVar === name || v.indexVar === name)) {
      throw this.positionedError(stmt,
        `emitter: '${name}' is a loop variable — a render local cannot re-declare or assign it ` +
        "");
    }
    if (op === '=') {
      if (!rec.locals.has(name)) {
        rec.locals.add(name);
        rec.bindings.add(name);
        rec.localDecls.set(name, stmt);
        if (rec.kind !== 'class') rec.vars.add(name);
      }
    } else if (!rec.locals.has(name)) {
      throw this.positionedError(stmt,
        `emitter: compound assignment to '${name}' — no render local of that name is declared in this render scope ` +
        '(`name = expr` declares one)');
    }
    this.checkCrossScopeLocals(value, stmt);
    this.renderLine(stmt, () => {
      this.mark(stmt, 'target', () => this.b.emit(name));
      this.b.emit(` ${op} `);
      this.mark(stmt, 'value', () => this.withExpression(() => this.expr(value)));
    });
    return null;
  }

  // At a render scope's close, a local never read anywhere in the
  // scope's statements is DEAD — and the spelling that produces one is
  // almost always an element line (`li = item` means a local named
  // `li`, never an <li>).
  closeRenderScope(rec) {
    for (const [name, decl] of rec.localDecls) {
      let reads = 0;
      const walk = (x) => {
        if (typeof x === 'string') {
          if (x === name) reads++;
          return;
        }
        if (!isNode(x)) return;
        // The binding's own target slot is a declaration, not a read.
        if (RENDER_BINDING_HEADS.has(x[0]) && x.length === 3 && x[1] === name) {
          walk(x[2]);
          return;
        }
        // NAME positions are never reads: a plain pair KEY
        // (`div x: "attr"` must not count as a read of local `x`) and
        // a member PROPERTY slot. Dynamic keys and computed accesses
        // are nodes and walk normally.
        if ((x[0] === ':' || x[0] === 'void-pair') && x.length === 3 && typeof x[1] === 'string') {
          walk(x[2]);
          return;
        }
        if ((x[0] === '.' || x[0] === '?.') && x.length === 3 && typeof x[2] === 'string') {
          walk(x[1]);
          return;
        }
        // A call's head and attribute record are not reads.
        for (const el of isCall(x) ? x.slice(2) : x) walk(el);
      };
      for (const s of rec.stmts) walk(s);
      if (reads === 0) {
        throw this.positionedError(decl,
          `emitter: render local '${name}' is never read — a dead local renders NOTHING (if this line meant an ` +
          `element with expression text, spell it \`${name}\` + indented \`= expr\`: inside render \`${name} = expr\` ` +
          'declares a local named the tag)', this.rstate.node);
      }
    }
  }

  // Walk a factory body (a conditional branch, a loop body) into its
  // own RECORD: fresh local scope, `ctx` self, emission deferred to
  // the factory method. Loop callers extend `loopEntry`.
  // Every bare word a subtree spells that could be an IDENTIFIER
  // reference — liberal (a false hit only moves a minted scaffold
  // name to its next candidate, never changes meaning), except the
  // pure NAME positions that can never reference: plain pair KEYS and
  // member PROPERTY slots (always behind a dot — skipping them keeps
  // the scaffold bytes stable when an attribute or property spells
  // `show`/`anchor`). The reserved-name mechanism: emitted SCAFFOLD
  // names (`ctx`, `__fr`, `__o`, the p() re-bind params, the swap's
  // consts, a listener's event param) must never capture a name the
  // user's code references — fixed names would silently collide.
  static collectLeafNames(x, set) {
    if (typeof x === 'string') {
      if (isIdentifierName(x)) set.add(x);
      return;
    }
    if (!isNode(x)) return;
    if ((x[0] === ':' || x[0] === 'void-pair') && x.length === 3 && typeof x[1] === 'string') {
      Emitter.collectLeafNames(x[2], set);
      return;
    }
    if ((x[0] === '.' || x[0] === '?.') && x.length === 3 && typeof x[2] === 'string') {
      Emitter.collectLeafNames(x[1], set);
      return;
    }
    for (const el of x) Emitter.collectLeafNames(el, set);
  }

  // Mint a scaffold name that collides with nothing in `used`; the
  // pick joins `used` so sibling scaffold names stay distinct.
  static mintName(base, used) {
    let name = base;
    while (used.has(name)) name = `${name}_`;
    used.add(name);
    return name;
  }

  // A child component opens its receiver's projection by name. A
  // receiver held on the component is reached through `ctx` from any
  // factory; one that is a LOCAL of a factory (a component constructed
  // per row) is out of scope in the sibling methods walked inside its
  // projection. So every factory between this child and the receiver's
  // owner takes the receiver as a parameter after the loop names, the
  // way they thread: its call site, inside the enclosing factory,
  // passes the name that is in scope there.
  threadProjectionHost(held) {
    if (held === null || held.startsWith('this.')) return;
    for (let rec = this.rstate.sink; rec && rec.hostParams !== undefined && !rec.vars.has(held); rec = rec.parent) {
      if (rec.hostParams.includes(held)) continue;
      rec.hostParams.push(held);
      rec.paramNames.push(held);
    }
  }

  walkFactory(part, kind, originNode, loopEntry = null) {
    const R = this.rstate;
    const parent = R.sink;
    const name = this.newBlockName();
    const ownVars = loopEntry !== null ? [loopEntry.itemVar, loopEntry.indexVar] : [];
    // Header assembly with RENAME-THREADING (the
    // duplicate-parameter hazard): an outer loop variable SHADOWED by an
    // own var (or by an earlier outer) cannot repeat in the header —
    // factories are strict-mode class methods, so the duplicate
    // parameter (`function b(ctx, x, j, x, i)`) is a load-time
    // SyntaxError. Only the SHADOWED position renames (its name is
    // unreachable in this scope — the shadow owns the spelling); a
    // legitimate outer capture keeps its name, so body reads stay
    // honest. The rename threads through this record's loopStack, so
    // deeper factories and reconcile call sites pass the value under
    // the name VISIBLE here; the minted name dodges everything the
    // body spells.
    const headerSet = new Set(ownVars);
    const bodySpells = new Set();
    Emitter.collectLeafNames(part, bodySpells);
    // Rename hazards accumulate DOWN the factory chain: once a loop
    // name is remapped anywhere above, both spellings are ambiguous in
    // every deeper scope (the original resolves to the wrong binding,
    // the minted name may capture an unrelated one) — the loop's
    // iterable thunk (tsIterThunkName) refuses an iterable that spells
    // either, so its re-emission never lands on a crosswise binding.
    const renameHazardNames = new Set(parent.renameHazardNames ?? []);
    const remap = (n) => {
      if (!headerSet.has(n)) {
        headerSet.add(n);
        return n;
      }
      let cand = `${n}_`;
      while (headerSet.has(cand) || bodySpells.has(cand)) cand += '_';
      headerSet.add(cand);
      renameHazardNames.add(n);
      renameHazardNames.add(cand);
      return cand;
    };
    const visibleOuter = parent.loopStack.map((v) => ({ ...v, itemVar: remap(v.itemVar), indexVar: remap(v.indexVar) }));
    const outerVars = visibleOuter.flatMap((v) => [v.itemVar, v.indexVar]);
    const loopStack = loopEntry !== null ? [...visibleOuter, loopEntry] : visibleOuter;
    const rec = {
      kind, name, parent, self: 'ctx',
      // OWN vars FIRST, then the threaded outer names — the runtime's
      // calling convention: __reconcile invokes `factory(ctx, item, i,
      // ...outer)` and `block.p(ctx, item, i, ...outer)`. The order is
      // load-bearing: reversed, nested-loop parameters bind CROSSWISE
      // — the inner item arrives in the outer-row slot.
      paramNames: [...ownVars, ...outerVars],
      // Projection receivers threaded in after the loop names
      // (threadProjectionHost) — filled while the body walks, read by
      // the call sites and emitFactory once it has.
      hostParams: [],
      frameVar: '__fr', ownerVar: '__o',
      creates: [], setups: [], vars: new Set(),
      locals: new Set(), localDecls: new Map(),
      bindings: new Set([...outerVars, ...ownVars]),
      refs: [], loopStack, stmts: [],
      forceNonStatic: false, root: null, isStatic: false, originNode,
      hasKids: false, kidsVar: null, renameHazardNames,
      // Which of this loop's own variables ('item', 'index') an emitted
      // read resolved to (noteLoopVarRead).
      readVars: new Set(),
      // The chains this block's reads may treat as non-null on the TS
      // face: every enclosing branch's tested chains plus this one's.
      narrowed: [...(parent.narrowed ?? []), ...(this._narrowNext ?? [])],
    };
    this._narrowNext = null;
    if (loopEntry !== null) loopEntry.owner = rec;
    R.records.push(rec);
    const prevSlot = R.transitionSlot;
    R.transitionSlot = kind === 'branch' ? { record: rec, el: null } : null;
    R.sink = rec;
    // Same double duty as withRecordContext's frame: `bindings` is exactly
    // the loop item/index names, bound for shadowing, loopVars for the
    // token correction's recording.
    this.rframes.push({ reactive: new Set(), bound: rec.bindings, loopVars: rec.bindings, loopBindings: Emitter.loopBindingsOf(rec) });
    try {
      let stmts;
      if (this.isBlock(part)) {
        stmts = part.slice(1);
      } else if (isNode(part) && part.length === 1 && isNode(part[0]) && this.stores.idOf(part) === null) {
        // The postfix conditional's plain [statement] wrapper.
        stmts = [part[0]];
      } else {
        stmts = [part];
      }
      rec.stmts = stmts;
      rec.root = stmts.length === 0 ? null : this.walkChildStmts(stmts);
      if (rec.root === null) {
        rec.root = this.newRenderVar('empty');
        this.renderLine(null, () => this.b.emit(`${rec.root} = document.createComment('')`));
      }
    } finally {
      this.rframes.pop();
      R.sink = parent;
      R.transitionSlot = prevSlot;
    }
    this.closeRenderScope(rec);
    rec.isStatic = kind === 'loop' && rec.setups.length === 0 && !rec.forceNonStatic;
    // The factory's scaffold names mint AFTER the walk, against every
    // name the body binds or spells — a loop variable named `ctx`,
    // `fr`, or `o` must never collide with the self param, the patch
    // frame, or the owner token (a collision is invalid JS or a
    // first-patch TypeError).
    const used = new Set([...rec.bindings, ...rec.locals, ...rec.vars]);
    Emitter.collectLeafNames(rec.stmts, used);
    rec.self = Emitter.mintName('ctx', used);
    rec.frameVar = Emitter.mintName('__fr', used);
    rec.ownerVar = Emitter.mintName('__o', used);
    // Child-component instances the block constructs (the fixed
    // _factoryChildren): the array is block state; d() unmounts them.
    if (rec.hasKids) rec.kidsVar = Emitter.mintName('_factoryChildren', used);
    return rec;
  }

  // Conditional rendering: an anchor comment + one factory per branch
  // + a swap effect in the enclosing setup phase. this side's else-if chains
  // are already NESTED if-nodes in the else slot — the recursion
  // through the branch factory handles them (the flat-chain fold has
  // no input shape here; a >4-length node would be one, and rejects
  // loudly if the grammar ever grew it).
  // The claims a branch condition proves for its body — each top-level
  // `and` operand the face can restate: a chain (`found`, `session.user`,
  // `@stash.user.profile`, a loop variable's `step.timer`), an equality
  // of a chain against a literal (a switch arm's `it.kind === "a"`), or
  // an `or` of such claims (an arm's test list). Anything else — a call,
  // an index, an optional link, a render local at the root, a comparison
  // the checker does not narrow on — proves nothing the face can spell.
  // A claim records each chain root's binding at the condition site (a
  // loop variable's owning record, or null for a member), so a record
  // that rebinds the name drops the claim instead of restating it
  // against the wrong value (activeNarrowed).
  narrowConjuncts(cond) {
    if (isNode(cond) && cond[0] === '&&' && cond.length === 3) {
      return [...this.narrowConjuncts(cond[1]), ...this.narrowConjuncts(cond[2])];
    }
    const roots = [];
    return this.collectClaimRoots(cond, roots) ? [{ node: cond, roots }] : [];
  }

  // Fills `roots` with the chain roots of a candidate claim; false where
  // any part of it is not a shape a claim admits.
  collectClaimRoots(x, roots) {
    if (isNode(x) && x[0] === '||' && x.length === 3) {
      return this.collectClaimRoots(x[1], roots) && this.collectClaimRoots(x[2], roots);
    }
    if (isNode(x) && (x[0] === '==' || x[0] === '!=') && x.length === 3) {
      if (Emitter.isNarrowLiteral(x[2])) return this.collectClaimRoots(x[1], roots);
      if (Emitter.isNarrowLiteral(x[1])) return this.collectClaimRoots(x[2], roots);
      return false;
    }
    if (typeof x !== 'string' && !Emitter.isDotChain(x)) return false;
    let root = x;
    while (isNode(root)) root = root[1];
    // A `this`-rooted chain needs no root record; bare `this` is no claim.
    if (root === 'this') return isNode(x);
    if (!isIdentifierName(root) || this.renderVarKind(root) === 'local') return false;
    const entry = this.loopEntryOf(root);
    if (entry === null && this.bareRewrite(root) === null) return false;
    roots.push({ name: root, owner: entry === null ? null : entry.owner, which: entry === null ? null : entry.itemVar === root ? 'item' : 'index' });
    return true;
  }

  // A literal a chain may be compared against in a claim: a string, a
  // number (negated or not), or one of the keyword literals.
  static isNarrowLiteral(x) {
    if (isNode(x)) return x[0] === '-' && x.length === 2 && typeof x[1] === 'string' && /^\d/.test(x[1]);
    return typeof x === 'string' && (/^["'\d]/.test(x) || x === 'true' || x === 'false' || x === 'null' || x === 'undefined');
  }

  // The loop-stack entry whose item or index variable `name` reads as
  // at the current sink, innermost first; null for anything else.
  loopEntryOf(name) {
    const stack = this.rstate?.sink.loopStack ?? [];
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].itemVar === name || stack[i].indexVar === name) return stack[i];
    }
    return null;
  }

  static isDotChain(n) {
    if (!isNode(n) || n[0] !== '.' || n.length !== 3 || typeof n[2] !== 'string' || n[2][0] === '"') return false;
    const o = n[1];
    if (o === 'this') return true;
    if (typeof o === 'string') return isIdentifierName(o);
    return Emitter.isDotChain(o);
  }

  // The TS-only narrowing a block's function bodies open with — its
  // c() and each of its effects: one `__ripNarrow(claim)` assertion per
  // claim the enclosing branches tested, so every read under it in the
  // same function body is narrowed on the face by control flow — what
  // the checker narrows on and what the editor's hover reports. Echoed:
  // the claim's reads already publish at the branch condition. The
  // runtime keeps the claim true: a block is built only after its
  // condition held for the values it is called with, the flush runs an
  // owner before anything it owns, so the swap disposes the block's
  // effects before a binding under it re-runs, a row's re-bind disposes
  // its frame and re-tests before any arm exists again, and a block
  // leaving through a transition freezes its effects first (f()). A
  // nested function body is not narrowed — a handler can fire after the
  // flip while the leaving DOM lingers.
  // The statement form spells `__ripNarrow(c); ` per claim; the
  // expression form spells `(__ripNarrow(c), ` per claim for an arrow
  // whose body is the one expression that follows, and
  // narrowGuardClose closes what it opened.
  // The claims the CURRENT record may assert: a claim whose chain root
  // this record spells differently — a member shadowed by a loop
  // variable or a render local, a loop variable rebound by an inner
  // loop or renamed out of its way — would re-spell against the wrong
  // value, so it drops here. A `this`-rooted chain has no such hazard.
  activeNarrowed() {
    const rec = this.renderRecord;
    if (!this.ts || !rec || !(rec.narrowed?.length > 0)) return [];
    return rec.narrowed.filter((claim) => claim.roots.every(({ name, owner, which }) => {
      if (rec.locals.has(name)) return false;
      if (owner === null) return !rec.bindings.has(name);
      const entry = rec.loopStack.find((e) => e.owner === owner);
      return entry !== undefined && (which === 'item' ? entry.itemVar : entry.indexVar) === name;
    }));
  }

  hasNarrow() {
    return this.activeNarrowed().length > 0;
  }

  // The bare members among the active chains — the names whose reads
  // and container passes record in narrowedDecls.
  narrowedReadNames() {
    const names = new Set();
    for (const { node, roots } of this.activeNarrowed()) {
      if (typeof node === 'string' && roots[0].owner === null) names.add(node);
      else if (isNode(node) && node[0] === '.' && node[1] === 'this' && node.length === 3 && typeof node[2] === 'string') names.add(node[2]);
    }
    return names;
  }

  narrowGuard(form = 'statement', { trailing = true } = {}) {
    const chains = this.activeNarrowed();
    if (chains.length === 0) return false;
    this._needsNarrowHelper = true;
    // An echo claims no occurrence: the chain's reads are the branch
    // condition's, and a claim here would take the occurrence a later
    // emission in the same frame maps to.
    this.b.suppressClaims = true;
    try {
      this.b.tsOnly(() => this.b.echo(() => {
        chains.forEach((c, i) => {
          if (i > 0) this.b.emit(' ');
          this.b.emit(form === 'statement' ? '__ripNarrow(' : '(__ripNarrow(');
          this.renderExpr(c.node);
          this.b.emit(form === 'statement' ? ');' : '),');
        });
        if (trailing) this.b.emit(' ');
      }));
    } finally {
      this.b.suppressClaims = false;
    }
    return true;
  }

  narrowGuardClose(opened) {
    if (opened) this.b.tsOnly(() => this.b.emit(')'.repeat(this.activeNarrowed().length)));
  }

  renderCond(node, markNode = node) {
    if (node.length > 4) {
      throw this.positionedError(node, 'emitter: unexpected flat conditional chain shape in render (internal)');
    }
    // A switch's synthetic if-chain re-enters here per else-link with
    // the DEFAULT markNode (the minted chain node, no store id) — the
    // author's switch node threads through _chainMarkNode so every
    // link's diagnostics map to the statement the author wrote
    // (the statusz leak).
    if (this.stores.idOf(markNode) === null && this._chainMarkNode) markNode = this._chainMarkNode;
    const [, cond, thenPart] = node;
    const elsePart = node.length === 4 ? node[3] : null;
    this.checkSetupLocalRefs(cond, markNode);
    this.checkCrossScopeLocals(cond, markNode);
    const anchorVar = this.newRenderVar('anchor');
    this.renderLine(null, () => this.b.emit(`${anchorVar} = document.createComment('if')`));
    this._narrowNext = this.narrowConjuncts(cond);
    const thenRec = this.walkFactory(thenPart, 'branch', markNode);
    const prevChain = this._chainMarkNode;
    if (elsePart !== null && isNode(elsePart) && elsePart[0] === 'if' && this.stores.idOf(elsePart) === null) {
      this._chainMarkNode = markNode;
    }
    const elseRec = elsePart !== null ? this.walkFactory(elsePart, 'branch', markNode) : null;
    this._chainMarkNode = prevChain;
    const hasRef = thenRec.refs.length > 0 || (elseRec !== null && elseRec.refs.length > 0);
    const sink = this.rstate.sink;
    // Both branches are called with one argument list, so each takes
    // every receiver either one threads, in one order.
    if (elseRec !== null) {
      for (const [from, to] of [[thenRec, elseRec], [elseRec, thenRec]]) {
        for (const held of from.hostParams) {
          if (to.hostParams.includes(held)) continue;
          to.hostParams.push(held);
          to.paramNames.push(held);
        }
      }
      elseRec.hostParams.sort((a, b) => thenRec.hostParams.indexOf(a) - thenRec.hostParams.indexOf(b));
      elseRec.paramNames.splice(elseRec.paramNames.length - elseRec.hostParams.length, elseRec.hostParams.length, ...elseRec.hostParams);
    }
    const outer = [...sink.loopStack.flatMap((v) => [v.itemVar, v.indexVar]), ...thenRec.hostParams];
    sink.setups.push({
      kind: 'raw',
      // A directive above the render conditional rides its setup line —
      // markNode is the AUTHOR's node (a render switch lowers through a
      // synthetic if-chain; only markNode is in the directive map).
      node: markNode,
      fn: (pad) => this.emitCondSetup(pad, markNode, node, anchorVar, thenRec, elseRec, hasRef, outer),
    });
    return anchorVar;
  }

  // `switch` folds into the if-chain: each
  // `when` becomes `disc === test` (OR-joined for test lists); a
  // subjectless switch takes the tests bare. The minted nodes carry
  // no store rows — marks fall back to the switch node itself.
  renderSwitch(node) {
    const [, disc, whens, dflt] = node;
    if (Emitter.hasMatchArms(whens)) this.checkMatchSwitch(node);
    const either = (a, t) => (a === null ? t : mkNode('||', a, t));
    let chain = dflt === null ? null : toParser(dflt);
    for (let i = whens.length - 1; i >= 0; i--) {
      const [, tests, body] = whens[i];
      const cond = disc === null
        ? tests.map(toParser).reduce(either, null)
        : tests.map((t) => Emitter.matchArmSexpr(disc, t)).reduce(either, null);
      chain = mkNode('if', cond, toParser(body), chain ?? mkNode('none'));
    }
    chain = toShaped(chain);
    if (chain === null || chain[0] !== 'if') {
      // A when-less switch (default only, or empty) has no swap to
      // build — its body renders unconditionally.
      return chain === null ? this.renderNode('null') : this.renderChildBlock(chain);
    }
    return this.renderCond(chain, node);
  }

  // Loop rendering: `for … in` over an anchor comment + one row
  // factory + a reconcile effect (#126's compile half — the runtime
  // half is the runtime's).
  renderLoop(node) {
    const [, vars, iter, step, guard, body] = node;
    if (step !== null) {
      throw this.positionedError(node,
        'emitter: a `by` step has no render reading — the reconciler patches whole collections; step the collection itself: `items.filter((x, i) -> i % 2 == 0)`');
    }
    if (guard !== null) {
      throw this.positionedError(node,
        'emitter: a `when` guard has no render reading — the reconciler patches whole collections; filter the collection itself: `for x in items.filter((x) -> cond)`');
    }
    if (vars.length > 2 || vars.some((v) => typeof v !== 'string')) {
      throw this.positionedError(node,
        'emitter: a render loop takes plain item and index variables (`for item, i in items`) — destructuring loop ' +
        'variables have no factory-parameter reading here; destructure inside the body');
    }
    if (vars.length === 2 && vars[0] === vars[1]) {
      throw this.positionedError(node,
        `emitter: a render loop cannot bind '${vars[0]}' as BOTH item and index — one name cannot hold two row facts ` +
        '');
    }
    for (const v of vars) {
      if (v.startsWith('__')) {
        throw this.positionedError(node,
          `emitter: render loop variable '${v}' — double-underscore names are the compiler/runtime namespace inside ` +
          'render (factory scaffolding and injected helpers live there)');
      }
    }
    this.checkSetupLocalRefs(iter, node);
    this.checkCrossScopeLocals(iter, node);
    const itemVar = vars[0];
    let indexVar = vars[1] ?? null;
    if (indexVar === null) {
      // Pick an index name that collides with nothing: outer loop
      // vars, the item var, any `for` var or render local anywhere in
      // the body subtree (the rule — the nested factories thread it
      // as a positional parameter) — AND any candidate the body spells
      // at all: loop variables shadow tags, so an auto-picked `i`
      // would silently swallow an `<i>` element line (the auto-index
      // is a name the user never wrote).
      const used = new Set(this.loopVarNames());
      used.add(itemVar);
      Emitter.collectRenderBodyBindings(body, used);
      const spells = (x, name) => {
        if (typeof x === 'string') return x === name;
        return isNode(x) && x.some((el) => spells(el, name));
      };
      for (const candidate of ['i', 'j', 'k', 'l', 'm', 'n']) {
        if (!used.has(candidate) && !spells(body, candidate)) {
          indexVar = candidate;
          break;
        }
      }
      indexVar = indexVar ?? `__rip_idx${this.rstate.sink.loopStack.length}`;
    }
    const anchorVar = this.newRenderVar('anchor');
    this.renderLine(null, () => this.b.emit(`${anchorVar} = document.createComment('for')`));
    const reactiveSource = this.renderReactive(iter);
    const keyExpr = this.extractLoopKey(body, node);
    const keySpan = keyExpr !== null ? (this.rstate.keySpan ?? null) : null;
    if (keyExpr !== null) {
      this.checkSetupLocalRefs(keyExpr, node);
      this.checkCrossScopeLocals(keyExpr, node);
    }
    // The loop head's own occurrence of each variable is its DECLARATION,
    // and the factory parameter marks it (emitTypedParams); the body's
    // reads claim their own occurrences, never the head's.
    const headId = this.stores.idOf(node);
    const headVars = headId !== null ? this.stores.role(headId, 'vars') : null;
    const prevAvoid = this.primitiveAvoid;
    if (headVars?.sourceStart != null) this.primitiveAvoid = [...(prevAvoid ?? []), [headVars.sourceStart, headVars.sourceEnd]];
    let rec;
    try {
      rec = this.walkFactory(body, 'loop', node, { itemVar, indexVar, reactiveSource, iter, node });
    } finally {
      this.primitiveAvoid = prevAvoid;
    }
    if (keyExpr !== null) {
      // The keyFn emits in the ENCLOSING setup scope with (item, i)
      // params — a render local declared inside the loop BODY does
      // not exist there (a live keyFn compiled that way would throw
      // at mount). Checked before the
      // row-derivation rule so the diagnosis names the real problem.
      if (rec.locals.size > 0 && referencesNames(keyExpr, rec.locals, this.stores)) {
        throw this.positionedError(node,
          'emitter: a `key:` expression must be evaluable in the loop HEADER scope — it reads a render local declared ' +
          'inside the loop body, which lives in the row factory (derive the key from the item inline: `key: item.id`)');
      }
      // A key is the ROW's identity: a keyFn that never reads the
      // loop's item or index cannot be injective over the rows —
      // constant keys die at the runtime's duplicate-key rejection,
      // and an undeclared root (`key: missing.id`) is a mount-time
      // ReferenceError far from here.
      if (!referencesNames(keyExpr, new Set([itemVar, indexVar]), this.stores)) {
        throw this.positionedError(node,
          `emitter: a loop key must derive from the row — this \`key:\` expression never reads '${itemVar}'` +
          `${vars.length === 2 ? ` or '${indexVar}'` : ''} (a row-independent key cannot identify rows)`);
      }
    }
    const hasRef = rec.refs.length > 0;
    const sink = this.rstate.sink;
    const outer = [...sink.loopStack.flatMap((v) => [v.itemVar, v.indexVar]), ...rec.hostParams];
    sink.setups.push({
      kind: 'raw',
      node, // a directive above the render loop rides its setup line
      fn: (pad) => this.emitLoopSetup(pad, node, anchorVar, iter, rec, keyExpr, itemVar, indexVar, hasRef, outer, keySpan),
    });
    return anchorVar;
  }

  // `for` vars and render-local declarations anywhere in a subtree —
  // the auto-index collision set.
  static collectRenderBodyBindings(x, set) {
    if (!isNode(x)) return;
    if ((x[0] === 'for-in' || x[0] === 'for-of' || x[0] === 'for-as') && isNode(x[1])) {
      for (const v of x[1]) if (typeof v === 'string') set.add(v);
    } else if (x[0] === '=' && x.length === 3 && typeof x[1] === 'string') {
      set.add(x[1]);
    }
    for (const el of x) Emitter.collectRenderBodyBindings(el, set);
  }

  // The `key:` extraction (#126's compile half): the pair lives on the
  // FIRST renderable statement of the loop body — its direct attribute
  // objects or its children block's top-level objects (the
  // indented-attribute spelling). The pair is
  // SUPPRESSED (never mutated out of the tree — the node-id join needs its
  // subtree reachable) so it never emits: keys are reconcile
  // identities, never DOM attributes.
  extractLoopKey(body, loopNode) {
    const stmts = this.isBlock(body) ? body.slice(1) : [body];
    const first = stmts.find((s) => !this.isRenderBinding(s));
    if (!isNode(first)) return null;
    const scanObject = (obj) => {
      for (let i = 1; i < obj.length; i++) {
        const pair = obj[i];
        if (isNode(pair) && pair.length === 3 && pair[0] === ':' && pair[1] === 'key') {
          this.noteVocabulary('render-channel', 'key', pair);
          // The word's own span, for the served record the loop setup
          // writes once the keyFn has emitted (the key's type lives there).
          this.rstate.keySpan = this.wordSpanIn('key', pair);
          this.rstate.suppressedPairs.add(pair);
          return pair[2];
        }
      }
      return null;
    };
    for (const arg of first.slice(1)) {
      if (this.isObject(arg)) {
        const found = scanObject(arg);
        if (found !== null) return found;
      } else if (isChildren(arg) && this.isBlock(arg[1])) {
        for (const child of arg[1].slice(1)) {
          if (this.isObject(child)) {
            const found = scanObject(child);
            if (found !== null) return found;
          }
        }
      }
    }
    return null;
  }

  // The threaded outer loop variables a nested block's factory and p()
  // receive, as an echo: the names restate the enclosing factory's own
  // params, so a rename of the loop variable drops their edits rather
  // than refusing over them.
  emitOuterLoopArgs(outer) {
    if (outer.length === 0) return;
    this.b.emit(', ');
    this.b.echo(() => this.b.emit(outer.join(', ')));
  }

  // The conditional swap block
  // block teardown on scope close rides an `__ownerFrame().add(…)`
  // disposer.
  emitCondSetup(pad, markNode, node, anchorVar, thenRec, elseRec, hasRef, outer) {
    const self = this.renderSelf ?? 'this';
    const p2 = pad + '  ';
    const p3 = p2 + '  ';
    // The swap's scaffold consts mint against every name the block
    // emits bare — the condition's reads and the threaded outer loop
    // variables. A loop variable named `anchor` or `show` must not be
    // captured by the scaffold (the fixed names render the wrong
    // branch or throw a TDZ ReferenceError).
    const used = new Set([self, ...outer]);
    Emitter.collectLeafNames(node[1], used);
    const anchor = Emitter.mintName('anchor', used);
    const cur = Emitter.mintName('currentBlock', used);
    const showing = Emitter.mintName('showing', used);
    const show = Emitter.mintName('show', used);
    const want = Emitter.mintName('want', used);
    const leaving = Emitter.mintName('leaving', used);
    const transition = this.runtimeName('__transition');
    const armLines = (rec) => {
      this.b.emit(`${p3}  ${cur} = ${self}.${rec.name}(${self}`);
      this.emitOuterLoopArgs(outer);
      this.b.emit(');\n');
      this.b.emit(`${p3}  ${cur}.c();\n`);
      this.b.emit(`${p3}  if (${anchor}.parentNode) ${cur}.m(${anchor}.parentNode, ${anchor}.nextSibling);\n`);
      this.b.emit(`${p3}  ${cur}.p(${self}`);
      this.emitOuterLoopArgs(outer);
      this.b.emit(');\n');
      this.b.emit(`${p3}  if (${cur}._t) ${transition}(${cur}._first, ${cur}._t, 'enter', undefined);\n`);
    };
    const emitBody = () => {
      this.b.emit(`${pad}{\n`);
      this.b.emit(`${p2}const ${anchor} = ${anchorVar};\n`);
      this.b.emit(`${p2}let ${cur}`);
      this.tsScaffoldAny();
      this.b.emit(' = null;\n');
      this.b.emit(`${p2}let ${showing}`);
      this.tsScaffoldAny();
      this.b.emit(' = null;\n');
      this.b.emit(`${p2}${this.runtimeName('__effect')}(() => {\n`);
      // A dynamic ref inside a branch writes its cell in m(): batch
      // the whole swap so observers see only the final cell value.
      if (hasRef) this.b.emit(`${p3}${this.runtimeName('__batch')}(() => {\n`);
      if (this.hasNarrow()) this.b.tsOnly(() => { this.b.emit(p3); this.narrowGuard('statement', { trailing: false }); this.b.emit('\n'); });
      this.b.emit(`${p3}const ${show} = !!(`);
      // $self fallback: a SWITCH lowers through this path with
      // markNode = the switch node, which has no 'condition' role —
      // without the $self wrap the discriminant's diagnostics fall
      // through to the render-body cover and land lines away from
      // the author's statement (the statusz leak).
      this.mark(markNode, '$self', () => this.mark(markNode, 'condition', () => this.renderExpr(node[1])));
      this.b.emit(');\n');
      this.b.emit(`${p3}const ${want} = ${show} ? 'then' : ${elseRec !== null ? "'else'" : 'null'};\n`);
      this.b.emit(`${p3}if (${want} === ${showing}) return;\n`);
      this.b.emit(`${p3}if (${cur}) {\n`);
      this.b.emit(`${p3}  const ${leaving} = ${cur};\n`);
      this.b.emit(`${p3}  if (${leaving}._t) { ${leaving}.f(); ${transition}(${leaving}._first, ${leaving}._t, 'leave', () => ${leaving}.d(true)); }\n`);
      this.b.emit(`${p3}  else { ${leaving}.d(true); }\n`);
      this.b.emit(`${p3}  ${cur} = null;\n`);
      this.b.emit(`${p3}}\n`);
      this.b.emit(`${p3}${showing} = ${want};\n`);
      this.b.emit(`${p3}if (${want} === 'then') {\n`);
      armLines(thenRec);
      this.b.emit(`${p3}}\n`);
      if (elseRec !== null) {
        this.b.emit(`${p3}if (${want} === 'else') {\n`);
        armLines(elseRec);
        this.b.emit(`${p3}}\n`);
      }
      if (hasRef) this.b.emit(`${p3}});\n`);
      this.b.emit(`${p2}});\n`);
      this.b.emit(`${p2}${this.runtimeName('__ownerFrame')}().add(() => { if (${cur}) { ${cur}.d(true); ${cur} = null; } });\n`);
      this.b.emit(`${pad}}\n`);
    };
    this.mark(markNode, '$self', emitBody);
  }

  // The loop reconcile block. `__s` holds the row state __reconcile
  // threads across runs; teardown destroys the live blocks on scope
  // close.
  emitLoopSetup(pad, node, anchorVar, iter, rec, keyExpr, itemVar, indexVar, hasRef, outer, keySpan = null) {
    const self = this.renderSelf ?? 'this';
    const p2 = pad + '  ';
    const p3 = p2 + '  ';
    // The reconcile scaffold mints against the block's bare emissions:
    // the collection's and keyFn's reads, the loop's own variables
    // (keyFn params), and the threaded outer names.
    const used = new Set([self, itemVar, indexVar, ...outer]);
    Emitter.collectLeafNames(iter, used);
    if (keyExpr !== null) Emitter.collectLeafNames(keyExpr, used);
    const state = Emitter.mintName('__s', used);
    const each = Emitter.mintName('__b', used);
    this.mark(node, '$self', () => {
      this.b.emit(`${pad}{\n`);
      this.b.emit(`${p2}const ${state}`);
      this.tsScaffoldAny();
      this.b.emit(' = { blocks: [], keys: [] };\n');
      this.b.emit(`${p2}${this.runtimeName('__effect')}(() => {\n`);
      this.b.emit(p3);
      if (hasRef) this.b.emit(`${this.runtimeName('__batch')}(() => `);
      const guarded = this.narrowGuard(hasRef ? 'expression' : 'statement');
      this.b.emit(`${this.runtimeName('__reconcile')}(${anchorVar}, ${state}, `);
      const prevNarrowed = this._narrowedReads;
      this._narrowedReads = this.narrowedReadNames();
      try { this.withExpression(() => this.expr(iter)); } finally { this._narrowedReads = prevNarrowed; }
      this.b.emit(`, ${self}, ${self}.${rec.name}, `);
      if (keyExpr !== null) {
        // The keyFn's item param takes the same element type as the
        // factory's, through the loop's thunk spelled from this scope's
        // own self (bare when the loop has none — an honest implicit
        // any). The index is the reconciler's counter.
        const keyItemType = this.tsLoopItemTypeText(rec.loopStack.at(-1), self);
        {
          // The key function's parameter is the loop variable: it marks the
          // head's declaration of it, so a definition from the key's read
          // lands on `for person in people`.
          const headId = this.stores.idOf(node);
          const headVars = headId !== null ? this.stores.role(headId, 'vars') : null;
          const decl = headVars?.sourceStart != null ? this.stores.primitiveSpans(itemVar, headVars.sourceStart, headVars.sourceEnd)[0] ?? null : null;
          this.b.emit('(');
          if (decl) {
            // Marked, and RECORDED: this parameter is the loop binding's
            // declaration, so the editor's correction must reach it. The
            // marked path bypasses emitPrimitive, which is where the
            // record is otherwise made.
            const at = this.b.offset;
            this.b.markSpan(headId, 'identifier', decl.sourceStart, decl.sourceEnd, () => this.b.emit(itemVar));
            this.loopVars.push([at, this.b.offset]);
            this.loopVarDecls.push({ span: [at, this.b.offset], owner: rec, which: 'item' });
          } else this.b.emit(itemVar);
        }
        if (keyItemType !== null) this.b.tsOnly(() => this.b.echo(() => this.b.emit(`: ${keyItemType}`)));
        this.b.emit(`, ${indexVar}`);
        if (this.ts) this.b.tsOnly(() => this.b.emit(': number'));
        this.b.emit(') => ');
        // The keyFn's binding frame carries loopVars too: its body reads
        // the loop's own variables, and it is the one generated
        // manifestation of the binding that maps back to the loop HEAD —
        // without it the token correction reaches every position but the
        // binding's own.
        this.rframes.push({
          reactive: new Set(), bound: new Set([itemVar, indexVar]), block: true, loopVars: new Set([itemVar, indexVar]),
          loopBindings: new Map([[itemVar, { owner: rec, which: 'item' }], [indexVar, { owner: rec, which: 'index' }]]),
        });
        try {
          this.withExpression(() => {
            const wrap = Emitter.needsGrouping(keyExpr, 'operand') || this.isObject(keyExpr);
            // The `key:` word answers the key's own type, read off the
            // served position around the expression — the same technique
            // a bind uses: the typed position is the expression, and the
            // word is the channel that spends it (RULINGS.md, `key:` in a
            // render loop).
            const gen = this.tsServedValue('__key', () => {
              if (wrap) this.b.emit('(');
              {
                // The head's own occurrences of the loop variables are
                // their declarations; the key's reads claim their own.
                const headId = this.stores.idOf(node);
                const headVars = headId !== null ? this.stores.role(headId, 'vars') : null;
                const prevAvoid = this.primitiveAvoid;
                if (headVars?.sourceStart != null) this.primitiveAvoid = [...(prevAvoid ?? []), [headVars.sourceStart, headVars.sourceEnd]];
                try { this.expr(keyExpr); } finally { this.primitiveAvoid = prevAvoid; }
              }
              if (wrap) this.b.emit(')');
            });
            if (gen !== null && keySpan !== null) {
              this.intrinsics.push({ start: keySpan[0], end: keySpan[1], kind: 'key', gen });
            }
          });
        } finally {
          this.rframes.pop();
        }
      } else {
        this.b.emit('null');
      }
      this.emitOuterLoopArgs(outer);
      this.b.emit(')');
      if (hasRef) this.narrowGuardClose(guarded);
      if (hasRef) this.b.emit(')');
      this.b.emit(';\n');
      this.b.emit(`${p2}});\n`);
      this.b.emit(`${p2}${this.runtimeName('__ownerFrame')}().add(() => { for (const ${each} of ${state}.blocks) { try { ${each}.d(true); } catch {} } ${state}.blocks = []; ${state}.keys = []; ${state}.items = []; });\n`);
      this.b.emit(`${pad}}\n`);
    });
  }

  // A block factory as a class method: `create_block_N(ctx, …)`
  // returning the runtime's handle. Effects created in p() land on a
  // fresh nested owner frame (disposed on the next patch and on d);
  // p() re-binds the factory params so create-phase closures track the
  // current row (without the re-bind, p-shadowing
  // would leave them stale). Refs write in m() after insertion and compare-and-clear in
  // d(detaching) — batched, so parent subscribers see one flush.
  emitFactory(rec, ind, renderNode) {
    const pad = '  '.repeat(ind + 1);
    const p2 = pad + '  ';
    const p3 = p2 + '  ';
    const p4 = p3 + '  ';
    const { self, frameVar, ownerVar } = rec;
    const headerParams = [self, ...rec.paramNames];
    const hasFrame = rec.setups.length > 0;
    // The p() re-bind params mint against everything the factory
    // binds or spells, the minted scaffold included — a body
    // referencing `__item` (a module binding) must not be captured.
    const used = new Set([...rec.bindings, ...rec.locals, ...rec.vars, self, frameVar, ownerVar]);
    if (rec.kidsVar !== null) used.add(rec.kidsVar);
    Emitter.collectLeafNames(rec.stmts, used);
    const pParams = [self, ...rec.paramNames.map((n) => Emitter.mintName(`__${n}`, used))];
    // The d() kids-unmount loop's binders.
    const kidC = rec.kidsVar !== null ? Emitter.mintName('__c', used) : null;
    const kidE = rec.kidsVar !== null ? Emitter.mintName('__e', used) : null;
    const needsP = !rec.isStatic;
    // The face types the factory's self param `: this` — every call
    // site passes the component instance — so user expressions inside
    // the block body type-check against the real member surface. The
    // handle's p() is an object-literal method where a `this` type is
    // illegal, so a face-only alias carries the instance type in. Loop
    // item params take their loop's element type through its thunk
    // (tsLoopItemTypeText; bare where the loop has none — an implicit
    // `any` the strict gauge keeps reporting), index params are the
    // reconciler's counter, and the c/m/p/d plumbing plus the block's
    // node slots stay explicit `any` (tsScaffoldAny's posture: scaffold
    // state, not user code).
    const ctxType = this.ts ? Emitter.mintName('__Ctx', used) : null;
    const paramTypes = new Map();
    // A loop-derived param marks with ITS loop's node, so a diagnostic
    // on it (an uninferrable item's implicit any) maps to the loop head
    // the author wrote — the line a directive there governs — never to
    // the render statement the factory's outer cover would collapse it
    // onto. Its type text is an echo: an error there restates the
    // iterable's own, which reports at the reconcile call.
    const paramNodes = new Map();
    rec.loopStack.forEach((entry) => {
      if (entry.node !== undefined) {
        paramNodes.set(entry.itemVar, entry.node);
        paramNodes.set(entry.indexVar, entry.node);
      }
    });
    if (this.ts) {
      for (const entry of rec.loopStack) {
        const t = this.tsLoopItemTypeText(entry, rec.self);
        if (t !== null) paramTypes.set(entry.itemVar, t);
        paramTypes.set(entry.indexVar, 'number');
      }
      // A threaded projection receiver is scaffold state, like the
      // block's node slots.
      for (const host of rec.hostParams) paramTypes.set(host, 'any');
    }
    // A loop variable's DECLARATION is the `for` head's own occurrence of
    // it; the factory parameter that carries it marks that span, so a
    // definition from a body read lands on `for person in people`.
    const declSpans = new Map();
    for (const entry of rec.loopStack) {
      const id = entry.node ? this.stores.idOf(entry.node) : null;
      const r = id !== null ? this.stores.role(id, 'vars') : null;
      if (r?.sourceStart == null) continue;
      for (const v of [entry.itemVar, entry.indexVar]) {
        if (typeof v !== 'string' || declSpans.has(v)) continue;
        const hit = this.stores.primitiveSpans(v, r.sourceStart, r.sourceEnd)[0] ?? null;
        if (hit) declSpans.set(v, { id, start: hit.sourceStart, end: hit.sourceEnd, owner: entry.owner, which: v === entry.itemVar ? 'item' : 'index' });
      }
    }
    const emitTypedParams = (names, selfType, typeOf) => {
      names.forEach((n, i) => {
        if (i > 0) this.b.emit(', ');
        const emitOne = () => {
          const decl = declSpans.get(n);
          if (decl) {
            // The span still joins `loopVars`, which the editor reads to
            // retype this occurrence: the factory parameter IS the loop
            // variable's declaration, and the author declared a loop
            // variable, not a parameter. Taking the marked path instead
            // of emitPrimitive must not cost the classification the
            // primitive path recorded.
            const at = this.b.offset;
            this.b.markSpan(decl.id, 'identifier', decl.start, decl.end, () => this.b.emit(n));
            if (this.isRenderLoopName(n)) this.loopVars.push([at, this.b.offset]);
            if (decl.owner !== undefined) this.loopVarDecls.push({ span: [at, this.b.offset], owner: decl.owner, which: decl.which });
          } else this.emitPrimitive(n);
          if (!this.ts) return;
          const t = i === 0 ? selfType : typeOf(n, i);
          if (t != null) this.b.tsOnly(() => this.b.echo(() => this.b.emit(`: ${t}`)));
        };
        const owner = paramNodes.get(n);
        if (owner !== undefined) this.mark(owner, '$self', emitOne);
        else emitOne();
      });
    };
    const ownEntry = rec.kind === 'loop' ? rec.loopStack.at(-1) : null;
    const thunkName = ownEntry !== null ? this.tsIterThunkName(ownEntry) : null;
    if (thunkName !== null) {
      const outerNames = rec.paramNames.slice(2, rec.paramNames.length - rec.hostParams.length);
      let text;
      this.withRecordContext(rec, () => {
        text = this.capturedExprText(() => this.expr(ownEntry.iter), { source: this.b.source });
      });
      const params = [`${self}: this`, ...outerNames.map((n) => paramTypes.has(n) ? `${n}: ${paramTypes.get(n)}` : n)];
      this.b.tsOnly(() => this.b.echo(() => this.b.emit(`${pad}${thunkName}(${params.join(', ')}) { return ${text}; }\n`)));
    }
    this.mark(renderNode, '$self', () => {
      this.withRecordContext(rec, () => {
        this.b.emit(`${pad}${rec.name}(`);
        emitTypedParams(headerParams, 'this', (n) => paramTypes.get(n));
        this.b.emit(') {\n');
        if (this.ts && needsP) this.b.tsOnly(() => this.b.emit(`${p2}type ${ctxType} = typeof ${self};\n`));
        if (rec.vars.size > 0) {
          this.b.emit(`${p2}let `);
          [...rec.vars].forEach((v, i) => {
            if (i > 0) this.b.emit(', ');
            this.b.emit(v);
            this.tsScaffoldAny();
          });
          this.b.emit(';\n');
        }
        if (rec.kidsVar !== null) {
          this.b.emit(`${p2}let ${rec.kidsVar}`);
          this.tsScaffoldAny('[]');
          this.b.emit(' = [];\n');
        }
        if (hasFrame) {
          this.b.emit(`${p2}let ${frameVar}`);
          this.tsScaffoldAny();
          this.b.emit(';\n');
        }
        this.b.emit(`${p2}return {\n`);
        if (rec.isStatic) this.b.emit(`${p3}_s: true,\n`);
        // c(): build the block's nodes, detached.
        this.b.emit(`${p3}c() {\n`);
        if (this.hasNarrow()) this.b.tsOnly(() => { this.b.emit(p4); this.narrowGuard('statement', { trailing: false }); this.b.emit('\n'); });
        const prevReads = this._narrowedReads;
        this._narrowedReads = this.narrowedReadNames();
        try { this.replayCreates(rec, p4); } finally { this._narrowedReads = prevReads; }
        const fragChildren = this.rstate.fragChildren.get(rec.root);
        const firstNode = fragChildren !== undefined ? fragChildren[0] : rec.root;
        // The handle's `_first`/`_t` slots write onto the object
        // literal from inside its own methods — the face casts `this`
        // (the literal's contextual type has only c/m/p/d; the slots
        // are the handle contract's, read as `any` everywhere else).
        this.b.emit(p4);
        if (this.ts) this.b.tsOnly(() => this.b.emit('('));
        this.b.emit('this');
        if (this.ts) this.b.tsOnly(() => this.b.emit(' as any)'));
        this.b.emit(`._first = ${firstNode};\n`);
        this.b.emit(`${p3}},\n`);
        // m(): insert before the anchor; dynamic refs write AFTER
        // insertion so no subscriber observes a detached node.
        this.b.emit(`${p3}m(target`);
        this.tsScaffoldAny();
        this.b.emit(', anchor');
        this.tsScaffoldAny();
        this.b.emit(') {\n');
        if (fragChildren !== undefined) {
          for (const child of fragChildren) {
            this.b.emit(`${p4}if (target) target.insertBefore(${child}, anchor);\n`);
          }
        } else {
          this.b.emit(`${p4}if (target) target.insertBefore(${rec.root}, anchor);\n`);
        }
        for (const r of rec.refs) {
          this.b.emit(p4);
          // The same typed channel the class road wears: the cell
          // bytes wrap in the TS-only `__ripRefCell('<tag>', …)` call
          // and the write casts to the wrap's return (the tag's
          // element, nullable) — a dynamic ref checks exactly like a
          // static one.
          this.mark(r.node, '$self', () => {
            const typed = this.ts && typeof r.tag === 'string';
            if (typed) this.b.tsOnly(() => this.b.emit(`${r.svg ? '__ripRefCellSvg' : '__ripRefCell'}('${r.tag}', `));
            const cellStart = this.b.offset;
            this.b.emit(`${self}.`);
            // The NAME claims its exact row and joins the value-first
            // channel — a dynamic ref answers like a static one.
            const span = this.emitPrimitive(r.name);
            if (span !== null) this.memberDecls.push({ start: span[0], end: span[1] });
            // The cell argument is the pair's relation site (renderRef).
            if (typed) r.site([cellStart, this.b.offset]);
            if (typed) this.b.tsOnly(() => this.b.emit(')'));
            this.b.emit(`.value = ${r.elVar}`);
            if (typed) this.b.tsOnly(() => this.b.emit(` as ${hostText(r.tag, r.svg)} | null`));
            this.b.emit(';');
          });
          this.b.emit('\n');
        }
        this.b.emit(`${p3}},\n`);
        // p(): re-bind the row, then dispose-and-recreate the patch
        // frame's effects under the owner push. A re-bind param is the
        // same row datum as the header param it writes into, so its
        // face type is `typeof` that param — one hole reports once
        // when the header param stayed bare, never twice. A static
        // block's p() takes no params: the runtime never calls it
        // (`_s` gates every call), and a parameter spelled with the
        // author's loop-variable name would be a second, unread
        // declaration of that variable, faded onto the `for` head.
        this.b.emit(`${p3}p(`);
        if (needsP) emitTypedParams(pParams, ctxType, (n, i) => `typeof ${rec.paramNames[i - 1]}`);
        this.b.emit(') {\n');
        if (needsP && rec.paramNames.length > 0) {
          this.b.emit(p4);
          this.b.echo(() => this.b.emit(rec.paramNames.map((n, i) => `${n} = ${pParams[i + 1]};`).join(' ')));
          this.b.emit('\n');
        }
        if (hasFrame) {
          this.b.emit(`${p4}if (${frameVar}) ${frameVar}.dispose();\n`);
          this.b.emit(`${p4}const ${ownerVar} = ${this.runtimeName('__pushOwner')}(${frameVar} = ${this.runtimeName('__ownerFrame')}());\n`);
          this.b.emit(`${p4}try {\n`);
          this.replaySetups(rec, p4 + '  ');
          this.b.emit(`${p4}} finally { ${this.runtimeName('__popOwner')}(${ownerVar}); }\n`);
        }
        this.b.emit(`${p3}},\n`);
        // f(): the block's effects die now while its DOM outlives them
        // through a leave transition, so no binding re-runs against
        // the state that dismissed the block. Branch handles only —
        // the swap is the one caller.
        if (rec.kind === 'branch') {
          this.b.emit(`${p3}f() {`);
          if (hasFrame) this.b.emit(` if (${frameVar}) { ${frameVar}.dispose(); ${frameVar} = null; }`);
          this.b.emit(` },\n`);
        }
        // d(): child components unmount FIRST (the order — the child
        // cascade runs while the block's effects are still live),
        // effects die with the frame, refs clear (real destroys only
        // — a keyed move re-inserts through m() without d()), the DOM
        // detaches.
        this.b.emit(`${p3}d(detaching`);
        this.tsScaffoldAny();
        this.b.emit(') {\n');
        if (rec.kidsVar !== null) {
          this.b.emit(`${p4}for (const ${kidC} of ${rec.kidsVar}) { try { ${kidC}.unmount?.({removeDOM: detaching}); } catch (${kidE}) { console.error('[Rip] factory child unmount error:', ${kidE}); } }\n`);
          this.b.emit(`${p4}${rec.kidsVar} = [];\n`);
        }
        if (hasFrame) this.b.emit(`${p4}if (${frameVar}) { ${frameVar}.dispose(); ${frameVar} = null; }\n`);
        if (rec.refs.length > 0) {
          this.b.emit(`${p4}if (detaching) ${this.runtimeName('__batch')}(() => {\n`);
          for (const r of rec.refs) {
            this.b.emit(`${p4}  ${this.runtimeName('__detachRef')}(${self}.${r.name}, ${r.elVar});\n`);
          }
          this.b.emit(`${p4}});\n`);
        }
        if (fragChildren !== undefined) {
          for (const child of fragChildren) {
            this.b.emit(`${p4}if (detaching) ${this.runtimeName('__detach')}(${child});\n`);
          }
        } else {
          this.b.emit(`${p4}if (detaching) ${this.runtimeName('__detach')}(${rec.root});\n`);
        }
        this.b.emit(`${p3}}\n`);
        this.b.emit(`${p2}};\n`);
        this.b.emit(`${pad}}\n`);
      });
    });
  }

  // A transition directive (`~name` → `__transition__: "name"`): legal
  // exactly where a working enter/leave phase exists — the FIRST
  // top-level element of a conditional branch, whose node is the
  // block's _first (what the swap's __transition calls animate). The
  // #129 posture: loud or working, never inert.
  renderTransition(el, pair, value, objExpr) {
    const R = this.rstate;
    const slot = R.transitionSlot;
    if (slot === null || slot.record !== R.sink || slot.el !== el) {
      const where = R.sink.kind === 'class'
        ? 'a static element)'
        : R.sink.kind === 'loop'
          ? 'a loop body — the reconciler has no enter/leave phase for rows'
          : "a nested position — the swap animates the branch's FIRST node, so a deeper directive would animate an " +
            'element it does not name';
      throw this.positionedError(pair,
        `emitter: a transition (\`~name\`) runs where a conditional branch enters or leaves, and this directive sits on ${where}; ` +
        'put it on the FIRST top-level element of an if/else branch', this.rstate.node);
    }
    if (typeof value !== 'string' || !(value.startsWith('"') || value.startsWith("'"))) {
      throw this.positionedError(pair,
        'emitter: a transition takes a literal name (`~fade`) — computed transition names have no reading', this.rstate.node);
    }
    const name = value.replace(/^["']|["']$/g, '');
    this.renderLine(pair, () => {
      // The handle-slot write's face cast (the `_first` twin above).
      if (this.ts) this.b.tsOnly(() => this.b.emit('('));
      this.b.emit('this');
      if (this.ts) this.b.tsOnly(() => this.b.emit(' as any)'));
      this.b.emit(`._t = "${name}"`);
    });
  }

  // `ref: cell` — bind the live element into a WRITABLE state cell
  // (the signal object, never its .value): the validation and
  // messages. Static refs write in _create (the subtree is connected
  // before any effect first runs — glitch-free) and clear through
  // _refCleanups on unmount; dynamic refs ride the factory's m()/d().
  renderRef(el, pair, value, objExpr, site) {
    const refName = typeof value === 'string' && isIdentifierName(value) ? value : null;
    if (refName === null) {
      throw this.positionedError(pair,
        'emitter: ref: expects a state cell — declare `el := null` then write `ref: el`', this.rstate.node);
    }
    const kind = this.rstate.frame.members.get(refName);
    if (kind !== 'state' && kind !== 'prop') {
      throw this.positionedError(pair, kind !== undefined
        ? `emitter: ref: target '${refName}' is not a writable state cell — declare it with ':=' (computed '~=' and ` +
          "readonly '=!' members can't hold a ref)"
        : `emitter: ref: target '${refName}' must be a state cell declared with ':=' (e.g. \`${refName} := null\`)`,
        this.rstate.node);
    }
    // The typed channel, both roads: the WRITE wraps the cell bytes in
    // a TS-only `__ripRefCell('<tag>', …)` call, whose declared
    // constraint (src/ts/dom-types.js) accepts exactly the cells that
    // can hold this tag's element — a mismatch draws TS2345 anchored
    // on the cell's own name. The RHS cast stays: the assignment
    // checks against the wrap's return (the tag's element, nullable —
    // teardown writes null), and hover on the element var stays
    // honest. Guarded on the tag-name shape; an unrecognized tag
    // keeps the unwrapped, uncast write.
    const tag = this.renderTagOf(el);
    const refTyped = this.ts && tag !== null && /^[a-z][a-z0-9-]*$/.test(tag);
    const refSvg = this.rstate.svgEls?.has(el) === true;
    if (refTyped) {
      this._needsRefCellHelper = true;
      // The `ref` WORD's ruled hover — "writes <element type> into
      // <cell>" — is served from this record (the word itself is spent
      // by the lowering; no face symbol describes the channel).
      const word = this.wordSpanIn('ref', pair);
      if (word !== null) {
        this.intrinsics.push({ start: word[0], end: word[1], kind: 'ref', tag, svg: refSvg, name: refName });
      }
    }
    if (this.rstate.sink.kind === 'class') {
      this.renderLine(pair, () => {
        if (refTyped) this.b.tsOnly(() => this.b.emit(`${refSvg ? '__ripRefCellSvg' : '__ripRefCell'}('${tag}', `));
        // The wrap's cell argument is the pair's relation site: a cell
        // that cannot hold this tag's element draws TS2345 there. The
        // name is a verified state member, so nothing the value draws
        // on its own can stand on the same span.
        const cellStart = this.b.offset;
        this.b.emit('this.');
        // The NAME's exact row joins the value-first channel: hover at
        // `ref: inputEl` answers the binding's own element type, never
        // the container wrapper (RULINGS.md, the ref-name row).
        const span = this.emitPrimitive(refName);
        if (span !== null) this.memberDecls.push({ start: span[0], end: span[1] });
        if (refTyped) site([cellStart, this.b.offset]);
        if (refTyped) this.b.tsOnly(() => this.b.emit(')'));
        this.b.emit(`.value = ${el}`);
        if (refTyped) this.b.tsOnly(() => this.b.emit(` as ${hostText(tag, refSvg)} | null`));
      });
      this.renderLine(pair, () => {
        // The ref NAME emits through the primitive channel so the TS face
        // gives it its own exact row; in JS mode that falls back to a plain
        // emit, so both faces spell the same bytes from this one path.
        this.b.emit(`(this._refCleanups ??= []).push(() => ${this.runtimeName('__detachRef')}(this.`);
        this.emitPrimitive(refName);
        this.b.emit(`, ${el}))`);
      });
    } else {
      this.rstate.sink.refs.push({
        name: refName, elVar: el, node: pair,
        tag: refTyped ? tag : null, svg: refSvg, site,
      });
    }
  }

  // Two-way binding (`value <=> target` → `__bind_value__: target`):
  // one effect pushes container → element, one listener pushes
  // element → container. the event/accessor matrix: checked binds on
  // change via e.target.checked; number/range inputs read
  // valueAsNumber; everything else (text, textarea, select) binds on
  // input via e.target.value. Chain targets notify their root
  // container with `.touch?.()` (a nested write changes no container
  // identity).
  renderBind(el, pair, prop, value, objExpr, site) {
    this.checkBindTarget(pair, value);
    if (this.rstate.sink.kind === 'loop' && this.loopVarNames().size > 0 && referencesNames(value, this.loopVarNames(), this.stores)) {
      this.rstate.sink.forceNonStatic = true;
    }
    let inputType = null;
    for (const p of objExpr.slice(1)) {
      if (isNode(p) && p.length === 3 && (p[1] === 'type' || p[1] === '"type"') && typeof p[2] === 'string') {
        inputType = p[2].replace(/^["']|["']$/g, '');
      }
    }
    let event, accessor;
    if (prop === 'checked') {
      event = 'change';
      accessor = 'target.checked';
    } else {
      event = 'input';
      accessor = inputType === 'number' || inputType === 'range' ? 'target.valueAsNumber' : 'target.value';
    }
    this.renderEffect(pair, () => {
      this.b.emit(`${el}.`);
      // The `<=>` target's ruled hover is served from this record: the word
      // is a channel word the census declines, and the record names where
      // its type stands — here the element property the bind writes.
      const span = this.emitRewrittenPrimitive(`__bind_${prop}__`, prop);
      this.b.emit(' = ');
      // The channel's type is the CELL's, not the element's (docs/TYPES.md:
      // a `<=>` write is typed at the cell), and the element receiver here is
      // a scaffold local with no type to read. So the record points at the
      // served position around the bound expression, whose type is what
      // flows both ways.
      const gen = this.tsServedValue('__bind', () => this.withExpression(() => this.expr(value)));
      if (gen !== null && span !== null) {
        this.intrinsics.push({ start: span[0], end: span[1], kind: 'bind', name: prop, gen });
      }
      if (prop === 'value') this.b.emit(" ?? ''");
      this.b.emit(';');
    }, value);
    const touch = this.bindRootTouch(value);
    // The listener's event param mints against the target's reads
    const evUsed = new Set();
    Emitter.collectLeafNames(value, evUsed);
    const ev = Emitter.mintName('e', evUsed);
        this.renderLine(pair, () => {
      // The bind's write-back listener is lowering-internal, correct
      // by construction — its param stays explicit `any`.
      this.b.emit(`${el}.addEventListener('${event}', (${ev}`);
      // The write-back READS the element and assigns into the cell, so its
      // param carries the event's real type with the host claim — that is
      // what makes `cell.value = e.target.value` check against the cell.
      // Without it the param is `any` and the channel is unchecked in both
      // directions, which lets a number cell take a string on first input.
      const bindRecv = this.tsElReceiver(el);
      const evText = this.ts ? this.tsEventTypeText([event], bindRecv.hostText) : null;
      if (evText !== null) this.b.tsOnly(() => this.b.emit(`: ${evText}`));
      else this.tsScaffoldAny();
      this.b.emit(') => { ');
      // The write-back's left-hand side is the pair's relation site: a
      // cell that cannot hold what the element returns draws TS2322
      // there. The target is a verified writable member (checkBindTarget),
      // so no complaint of its own covers the whole span — a chain's
      // missing member reports on that member alone.
      const targetStart = this.b.offset;
      this.withExpression(() => this.expr(value));
      site([targetStart, this.b.offset]);
      this.b.emit(` = ${ev}.${accessor};`);
      if (touch !== null) {
        this.b.emit(' ');
        touch();
        this.b.emit('.touch?.();');
      }
      this.b.emit(' })');
    });
  }

  // The bind target's loudness fork: the target must be ASSIGNABLE and
  // reactive-rooted where a container exists.
  checkBindTarget(pair, value) {
    const reject = (msg) => {
      throw this.positionedError(pair, msg, this.rstate.node);
    };
    if (typeof value === 'string') {
      if (!isIdentifierName(value)) {
        reject('emitter: a two-way binding (`<=>`) needs an assignable target — a literal cannot receive the input');
      }
      const kind = this.renderVarKind(value, pair);
      if (kind !== null) {
        reject(`emitter: a two-way binding cannot target a ${kind === 'local' ? 'render local' : 'loop variable'} — ` +
          'the write would land on a factory parameter and reach nothing; bind a state member or a chain into row data');
      }
      const r = this.resolveBareRead(value);
      if (r === 'member-reactive' && this.rstate.frame.members.get(value) === 'computed') {
        reject(`emitter: '<=>' targets '${value}', a computed ('~=') member — a derived value has no writable ` +
          "container (its .value is get-only); bind the state it derives from");
      }
      if (r === 'reactive' || r === 'member-reactive') return;
      if (r === 'member') {
        reject(`emitter: '<=>' targets '${value}', a plain (\`=\`) member — writes would never notify and the display ` +
          "would never update; declare it with ':='");
      }
      reject(`emitter: '<=>' targets '${value}', which is not declared — declare a state member (\`${value} := ""\`) to bind it`);
    }
    if (isNode(value) && value[0] === '.' && value[1] === 'this' && value.length === 3 && typeof value[2] === 'string') {
      if (this.memberIsReactive(value[2]) && this.rstate.frame.members.get(value[2]) === 'computed') {
        reject(`emitter: '<=>' targets '@${value[2]}', a computed ('~=') member — a derived value has no writable ` +
          'container; bind the state it derives from');
      }
      if (this.memberIsReactive(value[2])) return;
      if (this.rstate.frame.members.has(value[2])) {
        reject(`emitter: '<=>' targets '@${value[2]}', a non-reactive member — writes would never notify` +
          "); declare it with ':='");
      }
      reject(`emitter: '<=>' targets '@${value[2]}', which is not a declared member`);
    }
    if (isNode(value) && this.optionalGuard(value) !== null) {
      reject('emitter: a two-way binding target cannot carry optional links — the write form would be invalid JS');
    }
    let n = value;
    let isChain = false;
    while (isNode(n) && (n[0] === '.' || n[0] === '[]') && n.length === 3) {
      isChain = true;
      n = n[1];
    }
    if (isChain) return;
    reject('emitter: a two-way binding (`<=>`) needs an assignable target — a state member or a member/index chain ' +
      '');
  }

  // The root container a chain-target bind notifies: a reactive
  // member (`this.history…`) or a module reactive name. Simple
  // targets notify through their own container write — no touch.
  bindRootTouch(value) {
    if (typeof value === 'string') return null;
    if (isNode(value) && value[0] === '.' && value[1] === 'this' && value.length === 3) return null;
    let n = value;
    while (isNode(n) && (n[0] === '.' || n[0] === '[]') && n.length === 3) {
      if (n[0] === '.' && n[1] === 'this' && typeof n[2] === 'string') {
        const name = n[2];
        if (this.memberIsReactive(name)) return () => this.b.emit(`${this.renderSelf ?? 'this'}.${name}`);
        return null;
      }
      n = n[1];
    }
    if (typeof n === 'string') {
      if (this.renderVarKind(n) !== null) return null;
      const r = this.resolveBareRead(n);
      if (r === 'member-reactive') {
        const name = n;
        return () => this.b.emit(`${this.renderSelf ?? 'this'}.${name}`);
      }
      if (r === 'reactive') {
        const name = n;
        return () => this.b.emit(name);
      }
    }
    return null;
  }

  // A user-SPELLED `__bind_x__:` key rejects — the key is the
  // compiler's channel for the `<=>` rewrite. The rewrite renames the
  // LHS token IN PLACE, so a minted key's recorded span still spells
  // the user's own word; a key span that spells `__bind_` was typed
  // by the user (the `__`-namespace posture; 
  // round, item 5 — completions scrub the namespace, so accepting the
  // spelled form would be an invisible second spelling).
  checkUserSpelledBind(pair) {
    const id = isNode(pair) ? this.stores.idOf(pair) : null;
    const row = id !== null ? this.stores.role(id, 'key') : null;
    if (!row || row.sourceStart == null || this.b.source === null) return;
    if (this.b.source.slice(row.sourceStart, row.sourceEnd).startsWith('__bind_')) {
      throw this.positionedError(pair,
        "emitter: '__bind_…__:' is the compiler's two-way-binding channel — spell the binding `name <=> container` " +
        '(`__`-prefixed names are the compiler/runtime namespace)', this.rstate.node);
    }
  }

  // Tag + static classes + id from a dot-chain
  // (`[".", [".", "div", "card"], "active"]`). A `#id` merged into a
  // CLASS segment splits back out (leaving it inside the class
  // string would be broken markup).
  static collectTemplateClasses(sexpr) {
    const classes = [];
    let id;
    let current = sexpr;
    while (isNode(current) && current[0] === '.' && current.length === 3) {
      if (typeof current[2] !== 'string') return { tag: null, classes, id };
      classes.unshift(current[2]);
      current = current[1];
    }
    if (typeof current !== 'string') return { tag: null, classes, id };
    let [tag, tagId] = current.split('#');
    if (tagId) id = tagId;
    for (let i = 0; i < classes.length; i++) {
      const hash = classes[i].indexOf('#');
      if (hash >= 0) {
        id = classes[i].slice(hash + 1);
        classes[i] = classes[i].slice(0, hash);
      }
    }
    return { tag: tag || 'div', classes: classes.filter((c) => c !== ''), id };
  }

  // The tag a render node's HEAD names, or null — every head spelling
  // the render walk dispatches on, resolved through collectTemplateClasses
  // so the two never disagree: a bare string (`input`, `input#one`), a
  // dot chain (`input.field`, `.cls`), a call whose head is either, and
  // the dynamic-class call (`tag.(…)` — `__clsx` as the chain's last
  // member, or a `__clsx`-headed call standing as the head). The tag is
  // the spelling's, unchecked against the vocabulary.
  static templateHeadTag(x) {
    if (!isNode(x)) return null;
    if (isCall(x)) {
      const callee = x[2];
      if (typeof callee === 'string') return callee.length > 0 ? callee.split('#')[0] || 'div' : null;
      if (!isNode(callee)) return null;
      if (isCall(callee) && isNode(callee[2]) && callee[2][0] === '.' && callee[2][2] === '__clsx') {
        const tagExpr = callee[2][1];
        if (typeof tagExpr === 'string') return tagExpr.split('#')[0] || 'div';
        return Emitter.collectTemplateClasses(tagExpr).tag;
      }
      return Emitter.collectTemplateClasses(callee).tag;
    }
    const head = x[0];
    if (typeof head !== 'string') return null;
    if (head === '.') return Emitter.collectTemplateClasses(x).tag;
    return head.length > 0 ? head.split('#')[0] || 'div' : null;
  }
}
