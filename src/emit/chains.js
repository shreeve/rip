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
import { isCall, isSuperCall, isDynamicImport, isDammit, isMaybeDammit, isPlainCall, isOptCall, isNode, isNone, isStruct, wordOf } from '../sexpr.js';
import { guardOperand, isRubyNew, isRange, optionalGuard, thisField } from './tree.js';
import { Emitter } from './core.js';

export class ChainMethods {
  // A return GUARD: `x or return e`. The return must target the
  // enclosing function, so no expression lowering exists — the guard
  // is a statement rewrite, and every value-position use rejects.
  static returnGuard(x) {
    const right = guardOperand(x);
    return isNode(right) && right[0] === 'return';
  }

  // A throw GUARD in statement position takes the same rewrite —
  // `if (!(y = x)) throw e;` — cleaner bytes than the value form's
  // IIFE. Value positions KEEP the IIFE (a throw propagates out of
  // any scope, so both are correct there).
  static throwGuard(x) {
    const right = guardOperand(x);
    return isNode(right) && right[0] === 'throw' && right.length === 3;
  }

  // STATEMENT guards: `x or continue` / `x and break` / `x ?? debugger`.
  // The right operand is the bare word (lexer STATEMENT token), not
  // a node. Same statement rewrite as returnGuard.
  static stmtGuard(x) {
    const word = wordOf(guardOperand(x));
    return word === 'continue' || word === 'break' || word === 'debugger';
  }

  isChainNodeOf(x) {
    return isNode(x) && Emitter.chainHeadSlot(x) !== null;
  }

  chain(node) {
    this.checkEmitRead(node);
    this.tsNoteProvidedRead(node);
    this.rejectJoinedClassRead(node);
    if (node[0] === '.' && node.length === 4 && wordOf(node[2]) === 'this') {
      const name = wordOf(node[3]);
      if (this.boundMethodRead(name, this.thisMemberKindOf(name))) {
        this.mark(node, '$self', () => this.emitBoundMethod(name, node[3]));
        return;
      }
    }
    const spine = [node];
    while (true) {
      const cur = spine[spine.length - 1];
      const child = cur[Emitter.chainHeadSlot(cur)];
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
      const kind = (head === '.' || head === '?.') && n.length === 4 ? 'member'
        : (head === '[]' || head === 'optindex') && n.length === 4 ? 'index'
        : isOptCall(n) ? 'optcall'
        : 'call';
      // An optional call of `.new` has no reading: the `.new` call is
      // the construction, JavaScript refuses `new X?.()`, and the
      // spelling does not say whether the soak guards the constructor
      // or the instance.
      if (kind === 'optcall' && isRubyNew(n[2])) {
        throw this.positionedError(n,
          'emitter: an optional call of `.new` has no reading — construction is never optional. ' +
          'To construct only when the class exists, test it (`if X? then X.new(…)`); ' +
          'to soak the INSTANCE, construct first (`X.new()?(…)`)');
      }
      const f = { role: false, kind };
      frames.push(f);
      if (kind === 'member') {
        // `super.prop` has no home outside a class method; emitted
        // blindly it is invalid JS at top level.
        if (wordOf(n[2]) === 'super' && !this.methodName) {
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
        if (isInner) this.asReference(n[2], () => this.grouped(n, 'object', n[2], Emitter.needsGrouping(n[2], 'head') || Emitter.isIntegerLiteral(wordOf(n[2]))));
        else f.role = this.beginMark(n, 'object');
      } else if (kind === 'index') {
        // isWrite reads the state BEFORE this accessor clears it;
        // the optional spelling latches the deopt state at entry
        // (emitKey toggles deopt only inside its own save/restore).
        f.isWrite = this.inTarget || this.inPattern;
        f.opt = head === 'optindex' && !this.deopt;
        f.self = this.beginMark(n, '$self');
        f.savedTarget = this.inTarget;
        this.inTarget = false;
        if (isInner) this.asReference(n[2], () => this.head(n, 'object', n[2]));
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
      const f = frames[j];
      this.endMark(f.role);
      if (f.kind === 'member') {
        this.inTarget = f.savedTarget;
        this.memberTail(n);
      } else if (f.kind === 'index') {
        this.indexTail(n, f.opt, f.isWrite);
        this.inTarget = f.savedTarget;
      } else if (f.kind === 'optcall') {
        this.b.emit('?.');
        this.argList(n, true);
      } else {
        this.tsRegisterCheckedArgs(n);
        this.argList(n);
      }
      this.endMark(f.self);
    }
  }

  // The `.name` half of a member link (the chain tail).
  memberTail(n) {
    const head = n[0];
    const name = wordOf(n[3]);
    const ofThis = wordOf(n[2]) === 'this';
    // A string-literal PROPERTY (`@"a-b"` — a string-named member's
    // read) has no dot spelling: it brackets.
    if (name[0] === '"') {
      this.mark(n, 'operator', () => this.b.emit(head === '?.' && !this.deopt ? '?.' : ''));
      this.mark(n, 'property', () => this.b.emit(`[${name}]`));
    } else {
      this.mark(n, 'operator', () => this.b.emit(this.deopt && head === '?.' ? '.' : head));
      this.mark(n, 'property', () => {
        // A SYNTHESIZED member — one a lowering builds at emit time — has
        // no store row, so no frame opens here and the property would
        // inherit the statement's cover. Its name leaf still maps to its
        // own token. A real member already owns an exact row from its own
        // frame.
        const nameStart = this.b.offset;
        if (this.stores.idOf(n) === null) this.emitLeaf(n[3], name);
        else this.b.emit(name);
        if (this.ts && this.appStashSpec !== null && thisField(n[2]) === 'stash' && !this.shadowsProvision('stash')) {
          this.stashMemberSpans.push([nameStart, this.b.offset]);
        }
        // A `@member` read carries the kind its declaration minted. The
        // name is emitted raw here, so it passes no word channel and the
        // kinds channel would never otherwise see it — and this site
        // covers every member kind, where the `.value` branch below sees
        // only the reactive ones.
        if (this.ts && ofThis) {
          const k = this.cframes[this.cframes.length - 1]?.memberKinds?.get(name) ?? null;
          const row = this.propertyRow(n);
          if (k !== null && row !== null) {
            this.kinds.push({ start: row.sourceStart, end: row.sourceEnd, label: k.label, name, optional: k.optional });
          }
        }
      });
    }
    // Component scope: `@member` (this.member) reads and writes
    // its signal's `.value` when the member is reactive — chains
    // read through the unwrap (`@user.name` → this.user.value.name).
    if (ofThis && this.memberIsReactive(name)) {
      // The name's SOURCE span joins the value-first channel: the
      // author wrote `@member` and the lowering appended `.value`,
      // so a hover here answers the VALUE type — the same contract
      // memberRead records for the bare spelling (RULINGS.md's
      // member-read row).
      if (this.ts) {
        const row = this.propertyRow(n);
        if (row !== null) this.memberDecls.push({ start: row.sourceStart, end: row.sourceEnd });
      }
      this.b.emit('.value');
    }
  }

  // A call's parenthesized argument list (elements 3…) under its args
  // role. An optional call (`f?.(…)`, `f?!`) keeps a pick argument's own
  // parens — `h?.(({a: o.a}))` is valid JS and the byte battery pins it.
  argList(node, optional = false) {
    this.mark(node, 'args', () => {
      this.b.emit('(');
      for (let i = 3; i < node.length; i++) {
        if (i > 3) this.b.emit(', ');
        if (optional) this.argExpr(node[i]);
        else this.callArg(node[i]);
      }
      this.b.emit(')');
    });
  }

  member(node) {
    if (node[0] === '.' && wordOf(node[2]) === 'this' && !this.inTarget) {
      this.notePlainRenderRead(wordOf(node[3]), true);
    }
    this.chain(node);
  }

  // Only the template gate joins a digit run into a name (`p-4`), and only
  // for an element's class; such a name read as a property means the line
  // was a value after all, and `label.w-1.toFixed(2)` would be invalid
  // JavaScript. It rejects, asking for the spaces subtraction needs.
  // A call's callee and a member's object both sit at element 2.
  rejectJoinedClassRead(node) {
    for (let link = node; isNode(link); link = link[2]) {
      const name = link[0] === '.' || link[0] === '?.' ? wordOf(link[3]) : undefined;
      if (name !== undefined && /-[0-9]/.test(name)) {
        throw this.positionedError(link,
          `emitter: \`.${name}\` is read as a value here, where \`-\` is subtraction — write it with spaces ` +
          `(\`${name.replace(/-/g, ' - ')}\`), or give the element its class with \`class: '${name}'\``);
      }
      if (!isCall(link) && link[0] !== '.' && link[0] !== '?.') break;
    }
  }

  // A child notifies its parent through a callback prop; nothing on the
  // instance dispatches an event, so a chain rooted at `@emit` names no
  // member unless the component declares one. A call descends through
  // its callee, a member chain through its object slot; the root is
  // whatever neither shape opens.
  checkEmitRead(node) {
    if (!(this.cframes?.length > 0) || this.thisMemberKindOf('emit') !== null) return;
    let root = node;
    while (isNode(root)) {
      if (isCall(root)) root = root[2];
      else if ((root[0] === '.' || root[0] === '?.') && isStruct(root[2])) root = root[2];
      else break;
    }
    if (!isNode(root) || root[0] !== '.' || wordOf(root[2]) !== 'this' || wordOf(root[3]) !== 'emit') return;
    throw this.positionedError(root,
      'emitter: `@emit` is not a component member — a child notifies its parent through a callback prop: declare `@onSaved?: () => void` and call `onSaved?()`');
  }

  // ['.{}'|'?.{}', {}, source, ...['pickitem', {}, key, target, default|none]]
  // — the pick operator: `o.{a, b: c, d = e}` lowers to an
  // always-parenthesized object literal reading the source per key —
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
    const [head, , source, ...items] = node;
    if (this.inPattern || this.inTarget) {
      throw this.positionedError(node, 'emitter: a pick expression is not an assignment target — it lowers to a fresh object literal (`({…}) = value` would be invalid JS)');
    }
    const optional = head === '?.{}';
    const word = wordOf(source);
    const simple = word !== undefined && (word === 'this' || isIdentifierName(word));
    // A complex source binds `_` in a plain arrow — awaits and yields
    // in defaults cannot cross it (inside the arrow they are invalid
    // JS both ways).
    if (!simple) {
      for (const item of items) {
        const def = item[4];
        if (isNone(def)) continue;
        if (this.containsAwait(def)) {
          throw this.positionedError(item, "emitter: a pick default cannot await when the source needs single evaluation — the lowering's '(_) =>' arrow is not async; bind the source first", node);
        }
        if (this.containsYield(def)) {
          throw this.positionedError(item, "emitter: a pick default cannot yield when the source needs single evaluation — yield cannot cross the lowering's '(_) =>' arrow; bind the source first", node);
        }
      }
    }
    const body = (emitRef) => this.mark(node, 'items', () => {
      items.forEach((item, i) => {
        if (i > 0) this.b.emit(', ');
        const [, , srcKey, dstKey, def] = item;
        const dst = wordOf(dstKey);
        this.mark(item, '$self', () => {
          // A picked or renamed-to '__proto__' destination is caller
          // DATA — it materializes as an own key, never the
          // prototype-set literal form.
          this.mark(item, 'target', () => this.b.emit(Emitter.ownKeyText(dst, dst)));
          this.b.emit(': ');
          if (!isNone(def)) this.b.emit('(');
          emitRef();
          this.b.emit('.');
          this.mark(item, 'key', () => this.b.emit(wordOf(srcKey)));
          if (!isNone(def)) {
            this.b.emit(' ?? ');
            this.withExpression(() => this.operand(item, 'default', def));
            this.b.emit(')');
          }
        });
      });
    });
    this.mark(node, '$self', () => {
      if (simple) {
        if (optional) {
          if (!bare) this.b.emit('(');
          this.mark(node, 'source', () => this.expr(source));
          this.b.emit(' == null ? undefined : {');
        } else this.b.emit(bare ? '{' : '({');
        // Each per-key re-read of the source emits under the SOURCE role,
        // like the guard's read: the copies then map to the one occurrence
        // the author wrote, and a rename of it reaches every copy.
        body(() => this.mark(node, 'source', () => this.expr(source)));
        this.b.emit(bare ? '}' : '})');
        return;
      }
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
      // The IIFE argument is an operand position: compound sources
      // group (`((a || b))`).
      this.withExpression(() => this.grouped(node, 'source', source, Emitter.needsGrouping(source, 'operand')));
      this.b.emit(')');
    });
  }

  // One call argument: a checked ask's literal (registered by
  // tsRegisterCheckedArgs) takes its TS-only wrap, a pick emits bare, and
  // everything else is a plain argument.
  //
  // A literal key argument of `@stash.source(...)` wraps in the TS-only
  // `__ripSourceKey`, which checks it against the stash's key union —
  // the strict overload pair the ambience must not inline (an anonymous
  // type literal echoes its import() splices in every `@stash` hover)
  // and the package cannot spell (Rip's structured types carry no
  // template-literal types). A module-scope declare renders in no hover,
  // so this is where the template lives. Dynamic keys are never
  // registered and pass by construction.
  //
  // A router argument's generated span records with NO key: the
  // mismatch stays on the literal. On the ambient `@router` the argument
  // emits UNCHANGED — the ambience's const conditional does the
  // checking; on an accessor call the package's `Router` types
  // `push`/`replace` on plain `string`, so the literal wraps in the
  // TS-only `__ripRoute` like an href.
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
    if (isNode(arg) && (arg[0] === '.{}' || arg[0] === '?.{}') && arg.length >= 4) return this.pick(arg, true);
    this.argExpr(arg);
  }

  // A `:name` passed straight to a call carries its name on the face, as
  // a quoted literal keeps its literal type there: a parameter that reads
  // names (`ValidatorName` in rip/validate) infers from it. A symbol bound
  // first is plain `symbol`, so a later `x = :other` still assigns.
  argExpr(arg) {
    if (!(this.ts && isNode(arg) && arg[0] === 'symbol' && arg.length === 3)) return this.expr(arg);
    this.b.tsOnly(() => this.b.emit('('));
    this.expr(arg);
    this.b.tsOnly(() => this.b.emit(` as symbol & { readonly ripSymbol?: ${JSON.stringify(arg[2])} })`));
  }

  // The key half of index/optindex emission (the chain tail). `opt`
  // selects the optional spellings (`?.[`, `?.at(`); an optional link
  // on a deopt spine emits its plain form. Index KEYS leave the deopt
  // spine (a `?.` inside a computed key is a read, valid in an
  // assignment target). A range key lowers to .slice().
  indexTail(node, opt, isWrite) {
    const key = node[3];
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
        this.b.emit(wordOf(key[2]));
      });
      this.b.emit(')');
    } else {
      this.b.emit(opt ? '?.[' : '[');
      const deopt = this.deopt;
      this.deopt = false;
      this.mark(node, 'key', () => this.expr(key));
      this.deopt = deopt;
      this.b.emit(']');
    }
  }

  // ["[]", {}, object, key] — computed member; a regex-literal key is
  // the match read (`text[/re/]`), never a property lookup.
  index(node) {
    if (node.length === 4 && wordOf(node[3])?.[0] === '/') {
      return this.regexIndex(node, node[2], node[3], null);
    }
    this.chain(node);
  }

  // ["optindex", {}, object, key] — optional index (`a?.[k]`, `a?.at(-n)`).
  optIndex(node) {
    this.chain(node);
  }

  // A range key's `.slice()`: an inclusive end adds 1 — folded into the
  // literal when the end is numeric, spelled `+e + 1 || 9e9` otherwise —
  // and an open end drops its argument.
  slice(range) {
    const [dots, , from, to] = range;
    this.b.emit('.slice(');
    this.mark(range, 'from', () => (isNone(from) ? this.b.emit('0') : this.expr(from)));
    if (!isNone(to)) {
      const end = wordOf(to);
      this.b.emit(', ');
      if (dots === '...') {
        this.mark(range, 'to', () => this.expr(to));
      } else if (end !== undefined && /^\d+$/.test(end)) {
        this.mark(range, 'to', () => this.b.emit(String(Number(end) + 1)));
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
    // A call of `rest` reaching CALL emission inside a pattern sits in a
    // position the `rest x` sugar does not cover (array() owns the one
    // legal position, a binding pattern's tail): an object pair value
    // (`{k: rest v}`) or a target pattern. Emitting `rest(v)` here would
    // be a silent miscompile either way.
    if (wordOf(callee) === 'rest' && this.inPattern) {
      throw this.positionedError(node, this.bindingPattern
        ? 'emitter: a `rest` element is only legal at an array pattern\'s tail'
        : "emitter: Cannot use 'rest' expression as a destructuring target (destructuring rest is spelled '...name')");
    }
    if (isPlainCall(node) && isDammit(callee)) return this.dammitCalleeCall(node, callee);
    // Ruby-style construction: `X.new(args)` is `new X(args)` — the
    // `.new` member CALL is the constructor invocation (a bare
    // `X.new` property read stays a read).
    if (isPlainCall(node) && isRubyNew(callee)) {
      this.mark(node, '$self', () => {
        // The `.new` word IS the construction keyword it lowers to.
        this.mark(callee, 'property', () => this.b.emit('new'));
        this.b.emit(' ');
        this.rubyNewTarget(callee);
        this.argList(node);
      });
      return;
    }
    this.chain(node);
  }

  // A dammit callee awaits the CALL, not the callee: `f! 1, 2` →
  // `await f(1, 2)` — the await surrounds the whole invocation, so
  // no callee grouping is needed. A PARENTHESIZED dammit sealed the
  // await-call inside its parens; outer args belong to THIS call
  // (`(f!)(a)` → `(await f())(a)`, not `await f(a)`).
  dammitCalleeCall(node, callee) {
    this.renderSyncGuard(node);
    if (callee.parenthesized) {
      this.mark(node, '$self', () => {
        this.b.emit('(');
        this.dammit(callee);
        this.b.emit(')');
        this.argList(node);
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
      this.argList(node);
    });
  }

  // ["call", attrs, "import", url, options?] — dynamic import; the
  // `await` attribute is `import!(url)`.
  dynamicImport(node) {
    if (this.browserModule) {
      throw this.positionedErrorInMark(node, 'emitter: dynamic import is not supported in a browser App module — use a static import so Rip can publish and resolve the dependency');
    }
    this.mark(node, '$self', () => {
      if (node[1].await === true) {
        this.renderSyncGuard(node);
        this.mark(node, 'operator', () => this.b.emit('await'));
        this.b.emit(' ');
      }
      // repl mode: a dynamic import evaluates inside an async function
      // whose module context is the REPL's own, so a specifier that
      // should resolve against the user's cwd would silently anchor
      // elsewhere. The first argument routes through the minted
      // resolver — `import(<R>(spec))` — which handles COMPUTED
      // specifiers too (the operand still evaluates exactly once; the
      // resolver only maps the resulting string).
      if (this.repl && (node.length === 4 || node.length === 5)) {
        this.b.emit(`import(${this.replResolver()}(`);
        this.mark(node, 'args', () => {
          this.callArg(node[3]);
          this.b.emit(')');
          if (node.length === 5) {
            this.b.emit(', ');
            this.callArg(node[4]);
          }
        });
        this.b.emit(')');
        return;
      }
      this.mark(node, 'callee', () => this.b.emit('import'));
      this.argList(node);
    });
  }

  rubyNewTarget(member) {
    const ctor = member[2];
    this.mark(member, 'object', () => {
      // A PURE spine (names, members, indexes, no soak) stands bare:
      // `a.B.new(c)` is `new a.B(c)`. Any other constructor expression
      // groups: `new` consumes the FIRST argument list it reaches, so a
      // call in the constructor position (`getClass().new(x)`) must
      // parenthesize or `new` would construct the getter.
      if (isStruct(ctor) && this.pureSpine(ctor) && !optionalGuard(ctor)) {
        if (ctor[0] === '.' || ctor[0] === '?.') this.member(ctor);
        else this.call(ctor);
      } else if (this.ts && this.isPostfixType(ctor)) {
        // On the TS face a cast or `satisfies` prints its own group,
        // which is the seal.
        this.expr(ctor);
      } else if (isStruct(ctor)) {
        this.b.emit('(');
        this.expr(ctor);
        // A soaking target cannot be constructed THROUGH: JavaScript
        // refuses `new a?.b()`, so the spine seals into a value. Parens
        // alone are what the spec asks for, but bun's module parser
        // refuses a parenthesized optional chain under `new`, so the
        // coalesce is the seal; a short-circuited chain is undefined
        // either way, and constructing it throws.
        this.b.emit(optionalGuard(ctor) ? ' ?? undefined)' : ')');
      } else this.expr(ctor);
    });
  }
}
