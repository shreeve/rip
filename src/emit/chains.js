// Accessor/call chains — iterative spine emission.
//
// member/index/optindex/optcall/call all recurse through their HEAD
// child (object/callee), and long chains (`a.b().c().d()…`) are
// depth-N trees of exactly these kinds — ordinary code makes them
// deep, so the descent is a LOOP (the nesting rule: the expr() nesting
// bound never rejects a flat chain). Every chain kind is 'primary'
// tier — head position never groups it — so the spine emits with no
// parens and the begin/tail phases reproduce the recursive bytes,
// mark order, and inTarget/deopt state transitions exactly.
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

import { isIdentifierName } from '../ident.js';
import { isCall, isSuperCall, isDynamicImport, isDammit, isMaybeDammit, isPlainCall, isOptCall } from '../sexpr.js';
import { isNode, isBinary, isRubyNew, isChainLink, isRelation, isRange, isObjectShape } from './helpers.js';
import { Emitter } from './core.js';

export class ChainMethods {
  // A return GUARD: a logical operator whose right operand is a
  // `return` statement (`x or return e`). The return must target the
  // enclosing function, so no expression lowering exists — the guard
  // is a statement rewrite, and every value-position use rejects.
  static returnGuard(x) {
    return isNode(x) && (x[0] === '||' || x[0] === '&&' || x[0] === '??') &&
      x.length === 3 && isNode(x[2]) && x[2][0] === 'return';
  }

  // STATEMENT guards: `x or continue` / `x and break` / `x ?? debugger`.
  // The right operand is the bare word (lexer STATEMENT token), not
  // a `["return", …]` node. Same statement rewrite as returnGuard.
  static stmtGuard(x) {
    return isNode(x) && (x[0] === '||' || x[0] === '&&' || x[0] === '??') &&
      x.length === 3 && (x[2] === 'continue' || x[2] === 'break' || x[2] === 'debugger');
  }

  static controlGuard(x) {
    return Emitter.returnGuard(x) || Emitter.throwGuard(x) || Emitter.stmtGuard(x);
  }

  // A throw GUARD in statement position takes the same rewrite —
  // `if (!(y = x)) throw e;` — cleaner bytes than the value form's
  // IIFE. Value positions KEEP the IIFE (a throw propagates out of
  // any scope, so both are correct there).
  static throwGuard(x) {
    return isNode(x) && (x[0] === '||' || x[0] === '&&' || x[0] === '??') &&
      x.length === 3 && isNode(x[2]) && x[2][0] === 'throw' && x[2].length === 2;
  }

  // `*` with a string-LITERAL left operand is repetition — it emits
  // `lit.repeat(n)`, a call: the primary tier, never a spine member.
  // Any string literal on the left: quoted, heredoc (backtick-delimited
  // atoms) or interpolated (a `str` node).
  static isStrRepeat(x) {
    if (!isNode(x) || x[0] !== '*' || x.length !== 3) return false;
    const l = x[1];
    return typeof l === 'string' ? (l[0] === '"' || l[0] === '`') : (isNode(l) && l[0] === 'str');
  }

  // Does this expression's EMISSION begin with an object literal's
  // `{`? Walks left operands of binaries/relations and chain heads.
  static leadsWithObject(x) {
    let cur = x;
    for (;;) {
      if (!isNode(cur)) return false;
      if (isObjectShape(cur)) return true;
      if (isBinary(cur) || isRelation(cur) || isChainLink(cur)) { cur = cur[1]; continue; }
      const slot = Emitter.chainHeadSlot(cur);
      if (slot !== null) { cur = cur[slot]; continue; }
      return false;
    }
  }

  static chainHeadSlot(x) {
    if ((x[0] === '.' || x[0] === '?.' || x[0] === '[]' || x[0] === 'optindex') && x.length === 3) return 1;
    return Emitter.chainHeadSlotRest(x);
  }

  // The 'optindex' head is a legal identifier a plumbing list can begin
  // with — the instance twin applies the locked-head discrimination and
  // is what every reading uses; the static form serves only the
  // grouping lattice, where a misread over-groups and never changes
  // meaning.
  chainHeadSlotOf(x) {
    if ((x[0] === '.' || x[0] === '?.' || x[0] === '[]') && x.length === 3) return 1;
    if (x[0] === 'optindex' && x.length === 3 && this.lockedHead(x, 'optindex')) return 1;
    return Emitter.chainHeadSlotRest(x);
  }

  // A call continues the spine through its callee (element 2): an
  // optional call always, a plain call when its callee is a node. The
  // awaited and keyword calls, dammit callees and `.new` constructor
  // calls keep their own paths — never a spine frame (each re-spells
  // the invocation).
  static chainHeadSlotRest(x) {
    if (!isCall(x) || x[1].await === true || isSuperCall(x) || isDynamicImport(x)) return null;
    if (x[1].opt === true) return 2;
    if (isNode(x[2]) && !isDammit(x[2]) && !isRubyNew(x[2])) return 2;
    return null;
  }

  isChainNodeOf(x) {
    return isNode(x) && this.chainHeadSlotOf(x) !== null;
  }

  chain(node) {
    this.checkEmitRead(node);
    this.noteProvidedRead(node);
    this.rejectJoinedClassRead(node);
    if (node[0] === '.' && node.length === 3 && node[1] === 'this' && typeof node[2] === 'string' &&
        this.boundMethodRead(node[2], this.thisMemberKindOf(node[2]))) {
      this.mark(node, '$self', () => this.emitBoundMethod(node[2]));
      return;
    }
    const spine = [node];
    while (true) {
      const cur = spine[spine.length - 1];
      const child = cur[this.chainHeadSlotOf(cur)];
      if (!this.isChainNodeOf(child)) break;
      spine.push(child);
    }
    const frames = [];
    // Begin phase, outermost → innermost: open $self, run the checks
    // and state saves each kind performs before its head child, and
    // open the head-role mark (spine children never group — primary
    // tier). The innermost frame emits its head child through the
    // ordinary head() path instead (terminals group normally there).
    for (let j = 0; j < spine.length; j++) {
      const n = spine[j];
      const head = n[0];
      const isInner = j === spine.length - 1;
      const fkind = (head === '.' || head === '?.') && n.length === 3 ? 'member'
        : (head === '[]' && n.length === 3) || (head === 'optindex' && n.length === 3 && this.lockedHead(n, 'optindex')) ? 'index'
        : isOptCall(n) ? 'optcall'
        : 'call';
      // An optional call of `.new` has no reading: the `.new` call is
      // the construction, JavaScript refuses `new X?.()`, and the
      // spelling does not say whether the soak guards the constructor
      // or the instance. A completed construction soaks its instance
      // (`X.new()?(…)`).
      if (fkind === 'optcall' && isRubyNew(n[2])) {
        throw this.positionedError(n,
          'emitter: an optional call of `.new` has no reading — construction is never optional. ' +
          'To construct only when the class exists, test it (`if X? then X.new(…)`); ' +
          'to soak the INSTANCE, construct first (`X.new()?(…)`)');
      }
      const f = { role: false, kind: fkind };
      frames.push(f);
      if (fkind === 'member') {
        // `super.prop` has no home outside a class method — reject
        // loudly (emitted blindly it is invalid JS at top level).
        if (n[1] === 'super' && !this.methodName) {
          throw this.positionedError(n, 'emitter: super outside a class method');
        }
        f.self = this.beginMark(n, '$self');
        // Only the OUTERMOST accessor is the write position — the
        // object spine below it is a read (`a[-1].b = 5` reads
        // `a.at(-1)`).
        f.savedTarget = this.inTarget;
        this.inTarget = false;
        // An INTEGER literal receiver groups: `2.toFixed` reads the
        // dot as a decimal point, so the member needs `(2).toFixed`
        // (a float, exponent, hex, or bigint literal has no such
        // ambiguity).
        if (isInner) this.asReference(n[1], () => this.grouped(n, 'object', n[1], Emitter.needsGrouping(n[1], 'head') || Emitter.isIntegerLiteral(n[1])));
        else f.role = this.beginMark(n, 'object');
      } else if (fkind === 'index') {
        // isWrite reads the state BEFORE this accessor clears it;
        // the optional spelling latches the deopt state at entry
        // (emitKey toggles deopt only inside its own save/restore).
        f.isWrite = this.inTarget || this.inPattern;
        f.opt = head === 'optindex' && !this.deopt;
        f.self = this.beginMark(n, '$self');
        f.savedTarget = this.inTarget;
        this.inTarget = false;
        if (isInner) this.asReference(n[1], () => this.head(n, 'object', n[1]));
        else f.role = this.beginMark(n, 'object');
      } else {
        // A call: ["call", attrs, callee, ...args].
        f.self = this.beginMark(n, '$self');
        if (isInner) this.asReference(n[2], () => this.head(n, 'callee', n[2]));
        else f.role = this.beginMark(n, 'callee');
      }
    }
    // Tail phase, innermost → outermost.
    for (let j = spine.length - 1; j >= 0; j--) {
      const n = spine[j];
      const head = n[0];
      const f = frames[j];
      this.endMark(f.role);
      if (f.kind === 'member') {
        this.inTarget = f.savedTarget;
        const op = this.deopt && head === '?.' ? '.' : head;
        // A string-literal PROPERTY (`@"a-b"` — a string-named
        // member's read) has no dot spelling: it brackets.
        if (typeof n[2] === 'string' && n[2][0] === '"') {
          this.mark(n, 'operator', () => this.b.emit(head === '?.' && !this.deopt ? '?.' : ''));
          this.mark(n, 'property', () => this.b.emit(`[${n[2]}]`));
        } else {
          this.mark(n, 'operator', () => this.b.emit(op));
          this.mark(n, 'property', () => {
            // A SYNTHESIZED member — one a lowering builds at emit time — has
            // no store row, so no frame opens here and the
            // property would inherit the statement's cover. Its name is still a
            // source read; it claims its occurrence in that enclosing span. A
            // real member already owns an exact row from its own frame.
            const nameStart = this.b.offset;
            if (this.stores.idOf(n) === null) this.emitPrimitive(n[2]);
            else this.b.emit(n[2]);
            if (this.ts && this.appStashSpec !== null && typeof n[2] === 'string' && Emitter.isThisMember(n[1], 'stash')
                && !(this.cframes.length && this.cframes[this.cframes.length - 1].members.has('stash'))) {
              this.stashMemberSpans.push([nameStart, this.b.offset]);
            }
            // A `@member` read carries the kind its declaration minted. The
            // name is emitted raw here (a real member already owns an exact
            // row), so it claims no primitive and the kinds channel would
            // never otherwise see it — and this site covers every member
            // kind, where the `.value` branch below sees only the reactive
            // ones.
            if (this.ts && n[1] === 'this' && typeof n[2] === 'string') {
              const cf = this.cframes[this.cframes.length - 1];
              const k = cf?.memberKinds?.get(n[2]) ?? null;
              const id = this.stores.idOf(n) ?? null;
              const prow = id !== null ? this.stores.role(id, 'property') : null;
              if (k !== null && prow && typeof prow.sourceStart === 'number') {
                this.kinds.push({ start: prow.sourceStart, end: prow.sourceEnd, label: k.label, name: n[2], optional: k.optional });
              }
            }
          });
        }
        // Component scope: `@member` (this.member) reads and writes
        // its signal's `.value` when the member is reactive — chains
        // read through the unwrap (`@user.name` → this.user.value.name).
        if (n[1] === 'this' && typeof n[2] === 'string' && this.memberIsReactive(n[2])) {
          // The name's SOURCE span joins the value-first channel: the
          // author wrote `@member` and the lowering appended `.value`,
          // so a hover here answers the VALUE type — the same contract
          // memberRead records for the bare spelling (RULINGS.md's
          // member-read row).
          if (this.ts) {
            const id = this.stores.idOf(n) ?? null;
            const row = id !== null ? this.stores.role(id, 'property') : null;
            if (row && typeof row.sourceStart === 'number') {
              this.memberDecls.push({ start: row.sourceStart, end: row.sourceEnd });
            }
          }
          this.b.emit('.value');
        }
      } else if (f.kind === 'index') {
        this.indexTail(n, f.opt, f.isWrite);
        this.inTarget = f.savedTarget;
      } else if (f.kind === 'optcall') {
        this.b.emit('?.');
        this.mark(n, 'args', () => {
          this.b.emit('(');
          n.slice(3).forEach((arg, i) => {
            if (i > 0) this.b.emit(', ');
            // Optional-call arguments do NOT unwrap a pick's parens:
            // `h?.(({a: o.a}))` — the double parens are valid JS and
            // the byte battery pins the spelling.
            this.argExpr(arg);
          });
          this.b.emit(')');
        });
      } else {
        const sourceKey = this.sourceKeyArgOf(n);
        if (sourceKey !== null) {
          (this._sourceKeyArgs ??= new Set()).add(sourceKey);
          this._needsSourceKeyHelper = true;
        }
        const routerArg = this.routerArgOf(n);
        if (routerArg !== null) {
          (this._routerArgs ??= new Map()).set(routerArg.arg, routerArg.wrap);
          if (routerArg.wrap) this._needsRouteHelper = true;
        }
        this.mark(n, 'args', () => {
          this.b.emit('(');
          n.slice(3).forEach((arg, i) => {
            if (i > 0) this.b.emit(', ');
            this.callArg(arg);
          });
          this.b.emit(')');
        });
      }
      this.endMark(f.self);
    }
  }

  member(node) {
    if (node[0] === '.' && node[1] === 'this' && typeof node[2] === 'string' && !this.inTarget) {
      this.notePlainRenderRead(node[2], true);
    }
    this.chain(node);
  }

  // Only the template gate joins a digit run into a name (`p-4`), and only
  // for an element's class; such a name read as a property means the line
  // was a value after all, and `label.w-1.toFixed(2)` would be invalid
  // JavaScript. It rejects, asking for the spaces subtraction needs.
  rejectJoinedClassRead(node) {
    for (let link = node; isNode(link); link = isCall(link) ? link[2] : link[1]) {
      if ((link[0] === '.' || link[0] === '?.') && typeof link[2] === 'string' && /-[0-9]/.test(link[2])) {
        throw this.positionedError(link,
          `emitter: \`.${link[2]}\` is read as a value here, where \`-\` is subtraction — write it with spaces ` +
          `(\`${link[2].replace(/-/g, ' - ')}\`), or give the element its class with \`class: '${link[2]}'\``);
      }
      if (!isCall(link) && link[0] !== '.' && link[0] !== '?.') break;
    }
  }

  // The names the runtime PROVIDES to a component — `@stash`, `@router` —
  // are read like members but declared by no one in the file; the read's
  // own bytes take a head naming the provision (RULINGS.md, Components),
  // the way `(prop)` and `(rest)` name theirs. A provided name is always
  // the root of a chain (`@stash.cart`, `@router.onNavigate(fn)`), so
  // the chain that reads it notes the kind once, at the name's own span.
  // The descent follows the chain driver's head slots, so a call whose
  // callee reads the name reaches the root the way the driver does.
  // A child notifies its parent through a callback prop; nothing on the
  // instance dispatches an event, so a chain rooted at `@emit` names no
  // member unless the component declares one.
  checkEmitRead(node) {
    if (!(this.cframes?.length > 0) || this.thisMemberKindOf('emit') !== null) return;
    // A call descends through its callee; a member chain through its
    // object slot. The root is whatever neither shape opens.
    let root = node;
    while (isNode(root)) {
      if (isCall(root)) root = root[2];
      else if ((root[0] === '.' || root[0] === '?.') && isNode(root[1])) root = root[1];
      else break;
    }
    if (!isNode(root) || root[0] !== '.' || root[1] !== 'this' || root[2] !== 'emit') return;
    throw this.positionedError(root,
      'emitter: `@emit` is not a component member — a child notifies its parent through a callback prop: declare `@onSaved?: () => void` and call `onSaved?()`');
  }

  noteProvidedRead(node) {
    if (!this.ts || !(this.cframes?.length > 0)) return;
    let root = node;
    while (isNode(root)) {
      const slot = this.chainHeadSlotOf(root);
      if (slot === null || !isNode(root[slot])) break;
      root = root[slot];
    }
    if (!isNode(root) || root[0] !== '.' || root[1] !== 'this' || (root[2] !== 'stash' && root[2] !== 'router')) return;
    if (this.cframes[this.cframes.length - 1].members?.has(root[2])) return;
    const id = this.stores.idOf(root);
    const span = id !== null ? this.stores.selfSpan(id) : null;
    const hit = span !== null ? this.stores.primitiveSpans(root[2], span[0], span[1])[0] ?? null : null;
    if (hit && !this.kinds.some((k) => k.start === hit.sourceStart && k.label === root[2])) {
      this.kinds.push({ start: hit.sourceStart, end: hit.sourceEnd, label: root[2], name: root[2], optional: false });
    }
  }

  // ['.{}'|'?.{}', source, ...['pickitem', key, target, default|null]]
  // — the pick operator:
  // `o.{a, b: c, d = e}` lowers to an always-parenthesized object
  // literal reading the source per key —
  // `({a: o.a, c: o.b, d: (o.d ?? e)})`. Defaults fire on NULLISH
  // (`??` — deliberately broader than JS destructuring's
  // undefined-only) and group as operands. A SIMPLE source (a bare
  // name or `this`) reads inline per key; every other source
  // evaluates ONCE through a `(_) =>` IIFE (getters and reactive
  // tracking observe each read). The optional head short-circuits a
  // nullish source to `undefined`. The target/pattern and
  // IIFE-crossing forms reject.
  // `bare` strips the self-parenthesization in CALL-ARGUMENT position
  // (`f(o.{a})` → `f({a: o.a})` — the byte batteries pin the shape);
  // the single-evaluation IIFE has no strippable outer parens.
  pick(node, bare = false) {
    const [head, source, ...items] = node;
    if (this.inPattern || this.inTarget) {
      throw this.positionedError(node, 'emitter: a pick expression is not an assignment target — it lowers to a fresh object literal (`({…}) = value` would be invalid JS)');
    }
    const optional = head === '?.{}';
    const simple = typeof source === 'string' && (source === 'this' || isIdentifierName(source));
    // A complex source binds `_` in a plain arrow — awaits and yields
    // in defaults cannot cross it (inside the arrow they are invalid
    // JS both ways).
    if (!simple) {
      for (const item of items) {
        if (item[3] !== null && this.containsAwait(item[3])) {
          throw this.positionedError(item, "emitter: a pick default cannot await when the source needs single evaluation — the lowering's '(_) =>' arrow is not async; bind the source first", node);
        }
        if (item[3] !== null && Emitter.containsYield(item[3])) {
          throw this.positionedError(item, "emitter: a pick default cannot yield when the source needs single evaluation — yield cannot cross the lowering's '(_) =>' arrow; bind the source first", node);
        }
      }
    }
    const body = (emitRef) => this.mark(node, 'items', () => {
      items.forEach((item, i) => {
        if (i > 0) this.b.emit(', ');
        const [, srcKey, dstKey, def] = item;
        this.mark(item, '$self', () => {
          // A picked or renamed-to '__proto__' destination is caller
          // DATA — it materializes as an own key, never the
          // prototype-set literal form.
          this.mark(item, 'target', () => this.b.emit(Emitter.ownKeyText(dstKey, dstKey)));
          this.b.emit(': ');
          if (def !== null) this.b.emit('(');
          emitRef();
          this.b.emit('.');
          this.mark(item, 'key', () => this.b.emit(srcKey));
          if (def !== null) {
            this.b.emit(' ?? ');
            this.withExpression(() => this.operand(item, 'default', def));
            this.b.emit(')');
          }
        });
      });
    });
    this.mark(node, '$self', () => {
      if (simple && !optional) {
        this.b.emit(bare ? '{' : '({');
        body(() => this.mark(node, 'source', () => this.expr(source)));
        this.b.emit(bare ? '}' : '})');
      } else if (simple) {
        if (!bare) this.b.emit('(');
        this.mark(node, 'source', () => this.expr(source));
        this.b.emit(' == null ? undefined : {');
        // Each per-key re-read of the source emits under the SOURCE role,
        // like the guard's read: the copies then map to the one occurrence
        // the author wrote, and a rename of it reaches every copy.
        body(() => this.mark(node, 'source', () => this.expr(source)));
        this.b.emit(bare ? '}' : '})');
      } else {
        // The IIFE argument is an operand position: compound sources
        // group (`((a || b))`).
        // The parameter is live while the per-key defaults emit. A bound
        // `_` — the last-match binding a scope declares for `=~`, which no
        // source atom reserves — must stay reachable from a default's
        // match write, so the parameter dodges it.
        this.liveScope(() => {
          if (this.inScope('_')) this.liveReserve('_');
          const p = this.liveTemp('_');
          this.b.emit(optional ? `((${p}) => ${p} == null ? undefined : ({` : `((${p}) => ({`);
          body(() => this.b.emit(p));
        });
        this.b.emit('}))(');
        this.withExpression(() => this.grouped(node, 'source', source, Emitter.needsGrouping(source, 'operand')));
        this.b.emit(')');
      }
    });
  }

  // One call argument: picks emit bare (the `bare` stripping above);
  // everything else is a plain expression.
  // A literal key argument of `@stash.source(...)`: the chain driver
  // registered it (sourceKeyArgOf), and the TS-only `__ripSourceKey`
  // wrap checks it against the stash's key union — the strict overload
  // pair the ambience must not inline (an anonymous type literal echoes
  // its import() splices in every `@stash` hover) and the package cannot
  // spell (Rip's structured types carry no template-literal types). A
  // module-scope declare renders in no hover, so this is where the
  // template lives. Dynamic keys are never registered and pass by
  // construction.
  callArg(arg) {
    if (this._sourceKeyArgs?.has(arg)) {
      this._sourceKeyArgs.delete(arg);
      this.b.tsOnly(() => this.b.emit('__ripSourceKey('));
      const valStart = this.b.offset;
      this.expr(arg);
      this.sourceKeySpans.push([valStart, this.b.offset]);
      this.b.tsOnly(() => this.b.emit(')'));
      return;
    }
    // A registered router argument's generated span records with NO
    // key: the mismatch stays on the literal. On the ambient `@router`
    // the argument emits UNCHANGED — the ambience's const conditional
    // does the checking; on an accessor call the package's `Router`
    // types `push`/`replace` on plain `string`, so the literal wraps in
    // the TS-only `__ripRoute` like an href.
    const wrap = this._routerArgs?.get(arg);
    if (wrap !== undefined) {
      this._routerArgs.delete(arg);
      if (wrap) this.b.tsOnly(() => this.b.emit('__ripRoute('));
      const valStart = this.b.offset;
      this.expr(arg);
      this.routeWrapSpans.push({ key: null, value: [valStart, this.b.offset] });
      if (wrap) this.b.tsOnly(() => this.b.emit(')'));
      return;
    }
    if (isNode(arg) && (arg[0] === '.{}' || arg[0] === '?.{}') && arg.length >= 3) return this.pick(arg, true);
    this.argExpr(arg);
  }

  // A `:name` passed straight to a call carries its name on the face, as
  // a quoted literal keeps its literal type there: a parameter that reads
  // names (`ValidatorName` in rip/validate) infers from it. A symbol bound
  // first is plain `symbol`, so a later `x = :other` still assigns.
  argExpr(arg) {
    if (!(this.ts && isNode(arg) && arg[0] === 'symbol' && arg.length === 2)) return this.expr(arg);
    this.b.tsOnly(() => this.b.emit('('));
    this.expr(arg);
    this.b.tsOnly(() => this.b.emit(` as symbol & { readonly ripSymbol?: ${JSON.stringify(arg[1])} })`));
  }

  // The checked spellings of a stash-handle ask: a call whose callee
  // chain is EXACTLY `this.stash.source` (`@stash.source(...)`) or the
  // barrel accessor's `currentStash().source` / `currentStash()?.source`,
  // and whose first argument is a plain quoted string literal. A bound
  // alias (`d = @stash; d.source(...)`) or a computed key stays on
  // the package's permissive overload — the same syntactic-gate
  // doctrine as the href wrap. A component declaring its OWN `stash`
  // member shadows the ambient stash (the ambience splice skips the
  // name too), so its `.source(...)` calls are not stash asks and stay
  // unwrapped.
  sourceKeyArgOf(node) {
    if (!this.ts || this.appStashSpec === null || !isCall(node)) return null;
    const arg = node[3];
    if (typeof arg !== 'string' || !/^["']/.test(arg)) return null;
    const callee = node[2];
    if (!isNode(callee) || callee.length !== 3 || callee[2] !== 'source') return null;
    const recv = callee[1];
    if (callee[0] === '.' && Emitter.isThisMember(recv, 'stash')) {
      if (this.cframes.length && this.cframes[this.cframes.length - 1].members.has('stash')) return null;
      return arg;
    }
    if ((callee[0] === '.' || callee[0] === '?.') && this.isAccessorCall(recv, this.appAccessors.stash)) return arg;
    return null;
  }

  static isThisMember(x, name) {
    return isNode(x) && x[0] === '.' && x.length === 3 && x[1] === 'this' && x[2] === name;
  }

  // The stash module's top-level keys, read off the binding's object
  // literal (a single-argument call around one — `createStash {…}` —
  // reads through). Plain, quoted, and shorthand keys are named; a
  // computed key or a spread makes the set INCOMPLETE — the names found
  // are still real, but a miss cannot list them as the whole stash.
  // Null when the binding's value is not an object literal at all.
  static stashKeysOf(sexpr, local) {
    let value = null;
    for (const s of sexpr.slice(1)) {
      const decl = isNode(s) && s[0] === 'export' ? s[1] : s;
      if (isNode(decl) && decl[0] === '=' && decl[1] === local) { value = decl[2]; break; }
    }
    if (isPlainCall(value) && value.length === 4 && typeof value[2] === 'string' && isNode(value[3]) && value[3][0] === 'object') value = value[3];
    if (!isNode(value) || value[0] !== 'object') return null;
    const keys = [];
    let complete = true;
    for (const entry of value.slice(1)) {
      if (!isNode(entry)) continue;
      if (entry[0] === '...') { complete = false; continue; }
      const key = entry[0] === ':' ? entry[1] : entry[0] === null ? entry[1] : null;
      if (typeof key !== 'string') { complete = false; continue; }
      keys.push(/^["']/.test(key) ? key.slice(1, -1) : key);
    }
    return { keys, complete };
  }

  // The router surface's twin: a call whose callee chain is EXACTLY
  // `this.router.push` / `this.router.replace`, or the barrel
  // accessor's `currentRouter().push` / `currentRouter()?.push` (and
  // `replace`), with a quoted string literal first argument. The
  // argument span joins routeWrapSpans so completions know the slot.
  // On the ambient router nothing is emitted (its const conditional
  // checks the literal); on the accessor `wrap` asks callArg for the
  // `__ripRoute` wrap. A component declaring its own `router` member
  // shadows the ambient router; its calls stay unrecorded, as does
  // every non-router `.push`.
  routerArgOf(node) {
    if (!this.ts || this.routesUnion === null || !isCall(node)) return null;
    const arg = node[3];
    if (typeof arg !== 'string' || !/^["']/.test(arg)) return null;
    const callee = node[2];
    if (!isNode(callee) || callee.length !== 3 || (callee[2] !== 'push' && callee[2] !== 'replace')) return null;
    const recv = callee[1];
    if (callee[0] === '.' && Emitter.isThisMember(recv, 'router')) {
      if (this.cframes.length && this.cframes[this.cframes.length - 1].members.has('router')) return null;
      return { arg, method: callee[2], wrap: false };
    }
    if ((callee[0] === '.' || callee[0] === '?.') && this.isAccessorCall(recv, this.appAccessors.router)) return { arg, method: callee[2], wrap: true };
    return null;
  }

  // The key half of index/optindex emission (the chain tail). `opt`
  // selects the optional spellings (`?.[`, `?.at(`); an optional link
  // on a deopt spine emits its plain form. Index KEYS leave the deopt
  // spine (a `?.` inside a computed key is a read, valid in an
  // assignment target). A range key lowers to .slice(): an inclusive
  // end adds 1 — folded into the literal when the end is numeric,
  // spelled `+e + 1 || 9e9` otherwise — and open ends drop their
  // argument.
  indexTail(node, opt, isWrite) {
    const key = node[2];
    const emitKey = () => {
      const d = this.deopt;
      this.deopt = false;
      this.mark(node, 'key', () => this.expr(key));
      this.deopt = d;
    };
    if (!opt && isRange(key)) {
      this.mark(node, 'key', () => this.slice(key));
    } else if (Emitter.negativeLiteralKey(key)) {
      // `.at(-n)` is a CALL — it has no assignment-target form.
      if (isWrite) {
        throw this.positionedError(node, 'emitter: a negative-literal index cannot be an assignment target (reads lower to .at(-n), and a call is not assignable)');
      }
      this.b.emit(opt ? '?.at(' : '.at(');
      this.mark(node, 'key', () => {
        this.b.emit('-');
        this.b.emit(key[1]);
      });
      this.b.emit(')');
    } else {
      this.b.emit(opt ? '?.[' : '[');
      emitKey();
      this.b.emit(']');
    }
  }

  // ["[]", object, key] — computed member; a regex-literal key is
  // the match read (`text[/re/]`), never a property lookup.
  index(node) {
    if (node.length === 3 && typeof node[2] === 'string' && node[2][0] === '/') {
      return this.regexIndex(node, node[1], node[2], null);
    }
    this.chain(node);
  }

  // ["optindex", object, key] — optional index (`a?.[k]`, `a?.at(-n)`).
  optIndex(node) {
    this.chain(node);
  }

  slice(range) {
    const [dots, from, to] = range;
    this.b.emit('.slice(');
    this.mark(range, 'from', () => (from === null ? this.b.emit('0') : this.expr(from)));
    if (to !== null) {
      this.b.emit(', ');
      if (dots === '...') {
        this.mark(range, 'to', () => this.expr(to));
      } else if (typeof to === 'string' && /^\d+$/.test(to)) {
        this.mark(range, 'to', () => this.b.emit(String(Number(to) + 1)));
      } else {
        this.b.emit('+');
        this.mark(range, 'to', () => this.expr(to));
        this.b.emit(' + 1 || 9e9');
      }
    }
    this.b.emit(')');
  }

  // ["call", attrs, callee, ...args]. The keyword callees and the
  // awaited forms keep their own paths; every other call emits through
  // the chain driver.
  call(node) {
    if (isDynamicImport(node)) return this.dynamicImport(node);
    if (isSuperCall(node)) return this.superCall(node);
    if (isDammit(node)) return this.dammit(node);
    if (isMaybeDammit(node)) return this.maybeDammit(node);
    const callee = node[2];
    const args = node.slice(3);
    // A call of `rest` reaching CALL emission inside a pattern sits in a
    // position the `rest x` sugar does not cover (array() owns the one
    // legal position, a binding pattern's tail): an object pair value
    // (`{k: rest v}`) or a target pattern. Emitting `rest(v)` here would
    // be a silent miscompile either way.
    if (callee === 'rest' && this.inPattern) {
      throw this.positionedError(node, this.bindingPattern
        ? 'emitter: a `rest` element is only legal at an array pattern\'s tail'
        : "emitter: Cannot use 'rest' expression as a destructuring target (destructuring rest is spelled '...name')");
    }
    // A dammit callee awaits the CALL, not the callee: `f! 1, 2` →
    // `await f(1, 2)` — the await surrounds the whole invocation, so
    // no callee grouping is needed. A PARENTHESIZED dammit sealed the
    // await-call inside its parens; outer args belong to THIS call
    // (`(f!)(a)` → `(await f())(a)`, not `await f(a)`).
    if (isPlainCall(node) && isDammit(callee)) {
      this.renderSyncGuard(node);
      const emitArgs = () => this.mark(node, 'args', () => {
        this.b.emit('(');
        args.forEach((arg, i) => {
          if (i > 0) this.b.emit(', ');
          this.callArg(arg);
        });
        this.b.emit(')');
      });
      if (callee.parenthesized) {
        this.mark(node, '$self', () => {
          this.b.emit('(');
          this.dammit(callee);
          this.b.emit(')');
          emitArgs();
        });
        return;
      }
      const target = callee[2];
      const constructing = isRubyNew(target);
      this.mark(node, '$self', () => {
        // The keyword rides the dammit's operator role, as the bare
        // dammit's does: TS80007's position resolves to the `!`.
        this.mark(callee, 'operator', () => this.b.emit('await'));
        this.b.emit(' ');
        // The `.new` word IS the construction keyword it lowers to.
        if (constructing) {
          this.mark(target, 'property', () => this.b.emit('new'));
          this.b.emit(' ');
        }
        this.mark(callee, '$self', () => {
          if (constructing) this.mark(callee, 'callee', () => this.rubyNewTarget(target));
          else this.asReference(target, () => this.head(callee, 'callee', target));
        });
        emitArgs();
      });
      return;
    }
    // Ruby-style construction: `X.new(args)` is `new X(args)` — the
    // `.new` member CALL is the constructor invocation (a bare
    // `X.new` property read stays a read). A non-primary constructor
    // expression groups so the `new` binds to it whole.
    if (isPlainCall(node) && isRubyNew(callee)) {
      this.mark(node, '$self', () => {
        // The `.new` word IS the construction keyword it lowers to.
        this.mark(callee, 'property', () => this.b.emit('new'));
        this.b.emit(' ');
        this.rubyNewTarget(callee);
        this.mark(node, 'args', () => {
          this.b.emit('(');
          args.forEach((arg, i) => {
            if (i > 0) this.b.emit(', ');
            this.callArg(arg);
          });
          this.b.emit(')');
        });
      });
      return;
    }
    this.chain(node);
  }

  // ["call", attrs, "import", url, options?] — dynamic import; the
  // `await` attribute is `import!(url)`.
  dynamicImport(node) {
    if (this.browserModule) {
      const error = this.positionedError(node, 'emitter: dynamic import is not supported in a browser App module — use a static import so Rip can publish and resolve the dependency');
      if (typeof error.start !== 'number' && this.b.currentMark) {
        error.start = this.b.currentMark.sourceStart;
        error.end = this.b.currentMark.sourceEnd;
      }
      throw error;
    }
    const args = node.slice(3);
    const emitImport = () => {
      // repl mode: a dynamic import evaluates inside an async function
      // whose module context is the REPL's own, so a specifier that
      // should resolve against the user's cwd would silently anchor
      // elsewhere. The first argument routes through the minted
      // resolver — `import(<R>(spec))` — which handles COMPUTED
      // specifiers too (the operand still evaluates exactly once; the
      // resolver only maps the resulting string).
      if (this.repl && (args.length === 1 || args.length === 2)) {
        this.b.emit(`import(${this.replResolver()}(`);
        this.mark(node, 'args', () => {
          this.callArg(args[0]);
          this.b.emit(')');
          if (args.length === 2) {
            this.b.emit(', ');
            this.callArg(args[1]);
          }
        });
        this.b.emit(')');
        return;
      }
      this.mark(node, 'callee', () => this.b.emit('import'));
      this.mark(node, 'args', () => {
        this.b.emit('(');
        args.forEach((arg, i) => {
          if (i > 0) this.b.emit(', ');
          this.callArg(arg);
        });
        this.b.emit(')');
      });
    };
    this.mark(node, '$self', () => {
      if (node[1].await === true) {
        this.renderSyncGuard(node);
        this.mark(node, 'operator', () => this.b.emit('await'));
        this.b.emit(' ');
      }
      emitImport();
    });
  }

  rubyNewTarget(member) {
    const ctor = member[1];
    this.mark(member, 'object', () => {
      // A PURE spine (names, members, indexes, no soak) stands bare:
      // `a.B.new(c)` is `new a.B(c)`. Any other constructor expression
      // groups: `new` consumes the FIRST argument list it reaches, so a
      // call in the constructor position (`getClass().new(x)`) must
      // parenthesize or `new` would construct the getter.
      if (isNode(ctor) && this.pureSpine(ctor) && !this.optionalGuard(ctor)) {
        if (ctor[0] === '.' || ctor[0] === '?.') this.member(ctor);
        else this.call(ctor);
      } else if (this.ts && this.isPostfixType(ctor)) {
        // On the TS face a cast or `satisfies` prints its own group,
        // which is the seal.
        this.expr(ctor);
      } else if (isNode(ctor)) {
        this.b.emit('(');
        this.expr(ctor);
        // A soaking target cannot be constructed THROUGH: JavaScript
        // refuses `new a?.b()`, so the spine seals into a value. Parens
        // alone are what the spec asks for, but bun's module parser
        // refuses a parenthesized optional chain under `new`, so the
        // coalesce is the seal; a short-circuited chain is undefined
        // either way, and constructing it throws.
        this.b.emit(this.optionalGuard(ctor) ? ' ?? undefined)' : ')');
      } else this.expr(ctor);
    });
  }
}
