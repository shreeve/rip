// Operators: binary, logical and comparison chains, unary and update
// forms, relations, ternaries, the synthesized arithmetic and match
// operators, await, yield and the dammit calls.
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

import { tidyType } from '../ts/types.js';
import { LITERAL_WORDS } from './names.js';
import { isAwaitedCall } from '../sexpr.js';
import { JS_OP, isNode, isBinary, isRubyNew, isChainLink, isRange, isFunc, isUpdate, isPostfixTernary } from './helpers.js';
import { Emitter } from './core.js';

export class OperatorMethods {
  // Binary emission is ITERATIVE over the left spine: a flat
  // left-associative chain (`a1 + a2 + … + aN`, concat runs,
  // comparison chains) is a depth-N tree, and emitting it
  // recursively would spend native stack on exactly the shape
  // ordinary programs make deep — the expr() nesting bound must
  // never reject it. A binary LEFT child always groups in
  // operand position, so each spine level contributes one paren
  // pair and the begin/tail loops reproduce the recursive bytes
  // and mark order exactly.
  //
  // Two operator families leave this generic path: `&&`/`||` runs
  // emit FLAT (`a && b && c` — same-operator logical trees are one
  // associative program), and comparison chains LOWER to
  // conjunctions. The spine walk stops where those emitters
  // take over, so their nodes route through expr() dispatch as
  // ordinary grouped operands.
  binary(node) {
    if (Emitter.returnGuard(node)) {
      throw this.positionedError(node[2], "emitter: a return guard is a statement — in value position the 'return' would lose its function target (bind the value first, or use `or throw`)");
    }
    if (Emitter.stmtGuard(node)) {
      throw this.positionedError(node[2], `emitter: a ${node[2]} guard is a statement`);
    }
    if (node[0] === '&&' || node[0] === '||') return this.logicalChain(node);
    // A string-LITERAL left operand of `*` is repetition (`"-" * 40`
    // is a ruler, never arithmetic — JS `*` would yield NaN). The
    // rule is literal-only: a dynamic left operand keeps JS `*`.
    if (Emitter.isStrRepeat(node)) {
      this.mark(node, '$self', () => {
        this.mark(node, 'left', () => (typeof node[1] === 'string' ? this.b.emit(node[1]) : this.expr(node[1])));
        this.b.emit('.repeat(');
        this.mark(node, 'right', () => this.expr(node[2]));
        this.b.emit(')');
      });
      return;
    }
    if (isChainLink(node)) return this.comparisonChain(node);
    const extendsSpine = (x) => isBinary(x) && x[0] !== '&&' && x[0] !== '||' && !isChainLink(x) && !Emitter.isStrRepeat(x);
    const spine = [node];
    while (extendsSpine(spine[spine.length - 1][1])) spine.push(spine[spine.length - 1][1]);
    const frames = [];
    for (let j = 0; j < spine.length; j++) {
      const n = spine[j];
      const f = { self: this.beginMark(n, '$self'), left: false };
      frames.push(f);
      if (j < spine.length - 1) {
        this.b.emit('(');
        f.left = this.beginMark(n, 'left');
      }
    }
    const inner = spine[spine.length - 1];
    // JS forbids an unparenthesized unary expression as the LEFT
    // operand of `**`. The word-form unaries the operand context
    // emits bare (typeof, `not`, await, dammit) group here; symbol
    // unaries parse OUTSIDE the power and never reach this slot.
    const l = inner[1];
    const bareUnaryLeft = isNode(l) && (l[0] === '!' || l[0] === 'typeof' || l[0] === 'await' || isAwaitedCall(l));
    if (inner[0] === '**' && bareUnaryLeft) {
      this.b.emit('(');
      this.operand(inner, 'left', l);
      this.b.emit(')');
    } else this.operand(inner, 'left', l);
    for (let j = spine.length - 1; j >= 0; j--) {
      const n = spine[j];
      this.b.emit(' ');
      this.mark(n, 'operator', () => this.b.emit(JS_OP[n[0]] ?? n[0]));
      this.b.emit(' ');
      this.operand(n, 'right', n[2]);
      this.endMark(frames[j].self);
      if (j > 0) {
        this.endMark(frames[j - 1].left);
        this.b.emit(')');
      }
    }
  }

  // A same-operator `&&`/`||` run emits FLAT — `a && b && c`, no
  // grouping between links, the whole same-head tree collapsed,
  // explicit parens included: `(a and b) and c` and `a and (b and
  // c)` are the same associative program. Different-operator
  // children group as ordinary operands (`(a && b) || c`); `??`
  // never flattens — its pairs stay grouped. Iterative over the
  // left spine like binary(); a same-head RIGHT child (explicit
  // parens only, so never deep) flattens through expr() dispatch
  // with the grouping suppressed.
  logicalChain(node) {
    const op = node[0];
    const sameOp = (x) => isBinary(x) && x[0] === op;
    const spine = [node];
    while (sameOp(spine[spine.length - 1][1])) spine.push(spine[spine.length - 1][1]);
    const frames = [];
    for (let j = 0; j < spine.length; j++) {
      const n = spine[j];
      frames.push({
        self: this.beginMark(n, '$self'),
        left: j < spine.length - 1 ? this.beginMark(n, 'left') : false,
      });
    }
    const inner = spine[spine.length - 1];
    this.operand(inner, 'left', inner[1]);
    for (let j = spine.length - 1; j >= 0; j--) {
      const n = spine[j];
      this.b.emit(' ');
      this.mark(n, 'operator', () => this.b.emit(op));
      this.b.emit(' ');
      if (sameOp(n[2])) this.grouped(n, 'right', n[2], false);
      else this.operand(n, 'right', n[2]);
      this.endMark(frames[j].self);
      if (j > 0) this.endMark(frames[j - 1].left);
    }
  }

  // The chained-comparison lowering: every link whose left
  // child is an unparenthesized comparison becomes a conjunction
  // sharing the middle operand — `a < b < c` emits
  // `(a < b) && (b < c)`, longer chains nest left like any `&&`
  // spine (`((a < b) && (b < c)) && (c < d)`). The shared middle
  // operand evaluates ONCE: an atom (identifier, literal) re-emits
  // verbatim — nothing user-visible can run between the two reads —
  // while a node mid caches (ANY compound: re-evaluation is
  // observable down to valueOf/toString coercion), assigning a
  // hoisted temp at its original position; the next conjunct reads
  // the temp (`(a < (_ref = f(b))) && (_ref < c)`).
  // Marks: each link's $self covers its whole accumulated
  // conjunction; the mid's re-emission (temp read included)
  // re-marks the PREVIOUS link's `right` role — the
  // one-to-many precedent; the synthesized `&&`s and parens sit
  // between role marks as parent syntax.
  comparisonChain(node) {
    // links[0] compares the chain's first two operands; each later
    // link shares its predecessor's right operand as its mid.
    const links = [node];
    while (isChainLink(links[links.length - 1])) links.push(links[links.length - 1][1]);
    links.reverse();
    const frames = [];
    for (let k = links.length - 1; k >= 1; k--) {
      const n = links[k];
      const self = this.beginMark(n, '$self');
      this.b.emit('(');
      frames[k] = { self, left: this.beginMark(n, 'left') };
    }
    const first = links[0];
    const s0 = this.beginMark(first, '$self');
    this.operand(first, 'left', first[1]);
    this.b.emit(' ');
    this.mark(first, 'operator', () => this.b.emit(JS_OP[first[0]] ?? first[0]));
    this.b.emit(' ');
    this.chainRight(first, links[1]);
    this.endMark(s0);
    for (let k = 1; k < links.length; k++) {
      const n = links[k];
      this.endMark(frames[k].left);
      this.b.emit(') && (');
      this.chainMid(links[k - 1]);
      this.b.emit(' ');
      this.mark(n, 'operator', () => this.b.emit(JS_OP[n[0]] ?? n[0]));
      this.b.emit(' ');
      this.chainRight(n, links[k + 1]);
      this.b.emit(')');
      this.endMark(frames[k].self);
    }
  }

  // A link's right operand. When a FOLLOWING link shares it as mid
  // and it is a node, it emits as the temp assignment (`(_ref =
  // expr)` — the value flows through, so the comparison reads the
  // same result); otherwise a plain operand.
  chainRight(link, nextLink) {
    const rhs = link[2];
    if (nextLink !== undefined && isNode(rhs)) {
      const temp = this.temps.byNode.get(rhs);
      if (temp === undefined) {
        // The hoist walks skip this position (a param default, a
        // loop-variable default) — no let line exists to host the
        // temp, and emitting the operand twice is the silent double
        // evaluation the lowering forbids.
        throw this.positionedError(rhs,
          'emitter: a chained comparison here cannot cache its middle operand for single evaluation ' +
          '(no enclosing scope hoist) — bind the middle operand to a variable first ' +
          '', link);
      }
      this.b.emit('(');
      this.mark(link, 'right', () => {
        this.b.emit(`${temp} = `);
        this.expr(rhs);
      });
      this.b.emit(')');
      return;
    }
    this.operand(link, 'right', rhs);
  }

  // A conjunct's left slot: the SECOND manifestation of the previous
  // link's right operand — the cached temp when one exists, the
  // re-emitted atom otherwise.
  chainMid(prevLink) {
    const temp = this.temps.byNode.get(prevLink[2]);
    if (temp !== undefined) {
      this.mark(prevLink, 'right', () => this.b.emit(temp));
      return;
    }
    this.operand(prevLink, 'right', prevLink[2]);
  }

  // ["cast", value, "T"] / ["satisfies", value, "T"] — the postfix
  // `expr as Type` cast and the `expr satisfies Type` check. JS mode
  // ERASES either: the value alone emits, transparently (grouping reads
  // through to the value's tier), and the annotation role's cover row
  // spans the emitted value — the type's only generated manifestation
  //; $self is a cover over the same extent (the emitted slice
  // never equals the source, which still spells `as T`).
  //
  // The TS face spells the operator: `(value as T)` /
  // `(value satisfies T)`, every added byte TS-only, so the editor sees
  // the assertion or the check, and stripping restores the bare value.
  // The parens are structural, not cosmetic — TS puts both operators at relational
  // precedence, so a bare spelling rebinds in exactly the positions
  // where JS-mode grouping (which reads THROUGH the node) adds nothing:
  // member/call heads (`x.foo` must face as `(x as T).foo`) and type
  // texts ending in a bare name before `<` (`a as T < b` would parse
  // `T<b>` as type arguments). A non-primary value takes its own
  // TS-only parens — both operators bind tighter than logical/ternary/
  // assignment forms whose JS-mode bytes emit bare here (`(a && b) as
  // T`, never `a && b as T`, which TS reads as `a && (b as T)`).
  postfixType(node) {
    if (!this.ts) {
      this.mark(node, '$self', () =>
        this.mark(node, 'annotation', () =>
          this.mark(node, 'value', () => this.expr(node[1]))));
      return;
    }
    // The recorded source spelling (`as T` / `satisfies T`, the token's
    // span) — byte-equal emission lets the builder classify the
    // annotation row exact, the mapping contract's spelling at exact
    // positions.
    const id = this.stores.idOf(node);
    const row = id === null ? null : this.stores.role(id, 'annotation');
    const spelled = row && row.sourceStart != null && this.b.source !== null
      ? this.b.source.slice(row.sourceStart, row.sourceEnd)
      : `${node[0] === 'cast' ? 'as' : 'satisfies'} ${tidyType(node[2])}`;
    this.mark(node, '$self', () => {
      this.b.tsOnly(() => this.b.emit('('));
      const wrapValue = Emitter.jsTier(node[1]) !== 'primary';
      if (wrapValue) this.b.tsOnly(() => this.b.emit('('));
      this.mark(node, 'value', () => this.expr(node[1]));
      if (wrapValue) this.b.tsOnly(() => this.b.emit(')'));
      this.b.tsOnly(() => {
        this.b.emit(' ');
        this.mark(node, 'annotation', () => this.emitTypeText(node, 'annotation', spelled));
      });
      this.b.tsOnly(() => this.b.emit(')'));
    });
  }

  // Postfix existence: `expr?` lowers to `expr != null` — one loose
  // comparison covers both null and undefined.
  existence(node) {
    this.mark(node, '$self', () => {
      this.operand(node, 'value', node[1]);
      this.b.emit(' != null');
    });
  }

  unary(node) {
    // `delete` on a bare REACTIVE name is its own rejection class —
    // no reading exists for it at all
    if (node[0] === 'delete' && typeof node[1] === 'string' && this.isReactiveName(node[1])) {
      throw this.positionedError(node, `emitter: cannot delete the reactive variable '${node[1]}' — \`delete ${node[1]}.value\` would remove the container's accessor and silently kill the reactive`);
    }
    // `delete` is only valid on a property reference: strict mode (all
    // ES modules) makes `delete x` on a plain binding a load-time
    // SyntaxError — reject
    // at the layer where the target shape is knowable. An optional
    // reference (`delete o?.a`, `delete o?[k]`) is one: JavaScript
    // answers true when the base is nullish.
    if (node[0] === 'delete' && !(isNode(node[1]) && ['.', '[]', '?.', 'optindex'].includes(node[1][0]))) {
      throw this.positionedError(node, "emitter: delete requires a property reference (delete obj.a / delete obj[k]) — deleting a plain binding is a strict-mode SyntaxError in modules");
    }
    // A negative-literal index reads through `.at(-n)` and a range
    // through `.slice()`: both are calls, so `delete` would answer true
    // and remove nothing.
    if (node[0] === 'delete' && (node[1][0] === '[]' || node[1][0] === 'optindex') && (isRange(node[1][2]) || Emitter.negativeLiteralKey(node[1][2]))) {
      throw this.positionedError(node, `emitter: delete cannot target a ${isRange(node[1][2]) ? 'range' : 'negative-literal index'} — it reads through a call (${isRange(node[1][2]) ? '.slice()' : '.at(-n)'}), so nothing would be deleted; use splice or a computed index`);
    }
    this.mark(node, '$self', () => {
      this.mark(node, 'operator', () => this.b.emit(node[0]));
      // Word operators need the separating space (`typeof x`,
      // `delete a.b`); symbols bind directly (`!x`, `-y`).
      if (/^[a-z]/.test(node[0])) this.b.emit(' ');
      if (node[0] === 'delete') this.asReference(node[1], () => this.operand(node, 'operand', node[1]));
      else this.operand(node, 'operand', node[1]);
    });
  }

  // [op, target, postfix] — prefix/postfix increment and decrement.
  update(node) {
    if (typeof node[1] === 'string' && this.isComputedName(node[1])) {
      throw this.positionedError(node,
        `emitter: cannot assign to computed '${node[1]}' — a '~=' binding derives from its dependencies; write to those instead`);
    }
    if (typeof node[1] === 'string' && this.isAmbientReadonly(node[1])) {
      throw this.positionedError(node,
        `emitter: cannot assign to readonly '${node[1]}' — a '=!' binding never changes after its declaration`);
    }
    this.checkExportedConstWrite(node, node[1]); this.checkImportWrite(node, node[1]);
    this.checkMemberWrite(node, node[1]);
    // An optional chain is not a JavaScript assignment reference —
    // `obj?.x++` has no valid emission; guard the update explicitly.
    if (isNode(node[1]) && this.optionalGuard(node[1]) !== null) {
      throw this.positionedError(node,
        "emitter: an optional chain cannot be an update target — no reference exists for `obj?.x++`; " +
        'guard it explicitly (`obj.x++ if obj?`)');
    }
    this.mark(node, '$self', () => {
      const [op, target, postfix] = node;
      if (postfix) {
        this.mark(node, 'target', () => this.withTarget(() => this.expr(target)));
        this.mark(node, 'operator', () => this.b.emit(op));
      } else {
        this.mark(node, 'operator', () => this.b.emit(op));
        this.mark(node, 'target', () => this.withTarget(() => this.expr(target)));
      }
    });
  }

  // ['in'|'of', a, b] — the RELATION lowerings: `in` is membership
  // (includes for arrays/strings, `in` otherwise); `of` is JS `in`.
  relation(node) {
    const [rawOp, a, b] = node;
    // A negated relation (`not in`/`not of`/`not instanceof`) wraps
    // the WHOLE lowering: `!(…)` — never just the left operand.
    const negated = rawOp[0] === '!';
    const op = negated ? rawOp.slice(1) : rawOp;
    this.mark(node, '$self', () => {
      if (negated) this.b.emit('!(');
      if (op === 'instanceof') {
        this.operand(node, 'left', a);
        this.b.emit(' instanceof ');
        this.operand(node, 'right', b);
        if (negated) this.b.emit(')');
        return;
      }
      // `key in {literal}`: the container is statically an object, so
      // the array/string membership lowering is dead — plain JS `in`.
      if (op === 'of' || (op === 'in' && this.isObject(b))) {
        this.operand(node, 'left', a);
        this.b.emit(' in ');
        this.operand(node, 'right', b);
      } else if (isNode(b)) {
        // A CONSTRUCTED container (a call, a member read, a literal
        // list) may carry side effects or getters — the inline
        // dispatch would evaluate it more than once, so the helper
        // call evaluates each operand exactly once.
        if (this.ts) {
          this.b.emit("((k, c) => Array.isArray(c) || typeof c === 'string' ? c.includes(k) : ");
          this.memberKey(() => this.b.emit('c'), () => this.b.emit('k'));
          this.b.emit(' in c)(');
        } else this.b.emit(Emitter.MEMBER_IN + '(');
        this.mark(node, 'left', () => this.expr(a));
        this.b.emit(', ');
        this.mark(node, 'right', () => this.expr(b));
        this.b.emit(')');
      } else {
        this.b.emit('Array.isArray(');
        this.expr(b);
        this.b.emit(') || typeof ');
        this.expr(b);
        this.b.emit(" === 'string' ? ");
        this.expr(b);
        this.b.emit('.includes(');
        this.mark(node, 'left', () => this.expr(a));
        this.b.emit(') : (');
        // The includes() slot is an argument; this one is an operand
        // of JavaScript's `in`, so a lower-precedence left side groups.
        const wrap = Emitter.needsGrouping(a, 'operand');
        const left = () => {
          if (wrap) this.b.emit('(');
          this.expr(a);
          if (wrap) this.b.emit(')');
        };
        if (this.ts) this.memberKey(() => this.expr(b), left);
        else left();
        this.b.emit(' in ');
        this.mark(node, 'right', () => this.expr(b));
        this.b.emit(')');
      }
      if (negated) this.b.emit(')');
    });
  }

  // The key operand of a membership lowering's `in` branch, on the face.
  // A list or string container takes the `includes` branch, so its `in`
  // never runs and any value may be sought; any other container's `in`
  // is a key test, which still takes only a property key.
  memberKey(container, key) {
    this._needsMemberKeyHelper = true;
    this.b.tsOnly(() => { this.b.emit('__ripMemberKey<typeof '); container(); this.b.emit('>()('); });
    key();
    this.b.tsOnly(() => this.b.emit(')'));
  }

  // ['?:', condition, then, else] — the condition emits bare (like an if
  // condition); branches are operand positions that additionally group
  // update expressions ((i--), (++i)).
  //
  // The assignment hoist: a postfix-else whose then
  // branch is an UNPARENTHESIZED assignment — the Python idiom
  // `x = b if c else d` — hoists the target out of the ternary:
  // `x = (c ? b : d)`. The explicit `(x = b) if c else d` keeps its
  // assign-only-when-true semantics (the Parenthetical flag guards it).
  static ternaryHoists(node, stores) {
    // The hoist belongs to the INNERMOST level of a left-nested chain
    // (`x = 1 if a else 2 if b else 3` — see ternary()).
    if (!isPostfixTernary(stores, node)) return false;
    let inner = node;
    while (isPostfixTernary(stores, inner[2]) && !inner[2].parenthesized) inner = inner[2];
    const then = inner[2];
    return isNode(then) && then[0] === '=' && then.length === 3 &&
      typeof then[1] === 'string' && !then.parenthesized;
  }

  //
  // The chain: `x if a else y if b else z` parses LEFT-nested —
  // ((x if a else y) if b else z), the then branch of each level being
  // the level inside it — and reads the Python way, `a ? x : (b ? y :
  // z)`. The chain re-associates at emission: each enclosing level's
  // condition pairs with the inner level's else, and the outermost
  // else closes it. Every mark stays on its own node. A parenthesized
  // inner ternary is a value the author grouped and keeps its nesting,
  // and an operator `?:` on either side ends the chain: `(c ? x : y)
  // if d else e` and `c ? (x if d else e) : y` emit as they parse.
  ternary(node) {
    const chain = [node];
    while (true) {
      const then = chain[chain.length - 1][2];
      if (isPostfixTernary(this.stores, chain[chain.length - 1]) && isPostfixTernary(this.stores, then) &&
          !then.parenthesized) chain.push(then);
      else break;
    }
    const inner = chain[chain.length - 1];
    const hoists = Emitter.ternaryHoists(inner, this.stores);
    const branch = (owner, role, child) => {
      this.grouped(owner, role, child, Emitter.needsGrouping(child, 'operand') || isUpdate(child));
    };
    // A ternary CONDITION keeps its parens — bare, JS
    // right-associativity re-associates and changes the value.
    const condition = (owner) => this.grouped(owner, 'condition', owner[1], isNode(owner[1]) && owner[1][0] === '?:');
    this.mark(node, '$self', () => {
      if (hoists) {
        // The hoisted target is a WRITE — it routes through expr so a
        // reactive name unwraps (`count.value = (c ? … : …)`);
        // plain names emit verbatim as before.
        this.expr(inner[2][1]);
        this.b.emit(' = (');
      }
      condition(inner);
      this.b.emit(' ? ');
      branch(inner, 'then', hoists ? inner[2][2] : inner[2]);
      for (let i = chain.length - 2; i >= 0; i--) {
        this.b.emit(' : (');
        condition(chain[i]);
        this.b.emit(' ? ');
        branch(chain[i + 1], 'else', chain[i + 1][3]);
      }
      this.b.emit(' : ');
      branch(chain[0], 'else', chain[0][3]);
      this.b.emit(')'.repeat(chain.length - 1));
      if (hoists) this.b.emit(')');
    });
  }

  // The true-modulo helper, inlined per site (like the range helper —
  // emitted output is self-contained, no shared helper block). Coerces both
  // operands once and normalizes the sign to the divisor's.
  static MODULO = '((n, d) => { n = +n; d = +d; return (n % d + d) % d; })';

  // Identifier-shaped spellings that are language literals, not
  // bindings (src/emit/names.js).
  static LITERAL_WORDS = LITERAL_WORDS;

  // A '__proto__' OBJECT-LITERAL key — bare or quoted — is
  // JavaScript's prototype-set form, not an own property; only the
  // computed spelling `["__proto__"]:` creates one. Where the language
  // means an ordinary data property (a pick destination), the key emits
  // through this helper. The check reads the DECODED key, so an escape spelling
  // is the same key.
  static ownKeyText(text, decoded) {
    return decoded === '__proto__' ? '["__proto__"]' : text;
  }

  // Membership dispatch as a call, for containers whose evaluation
  // must happen exactly once (the inline ternary form re-reads the
  // container; a plain-name container keeps it — bytes and behavior
  // are identical there).
  static MEMBER_IN = "((k, c) => Array.isArray(c) || typeof c === 'string' ? c.includes(k) : k in c)";

  // ["//", left, right] — floor division: Math.floor(left / right).
  floorDiv(node) {
    this.mark(node, '$self', () => {
      this.b.emit('Math.floor(');
      this.operand(node, 'left', node[1]);
      this.b.emit(' ');
      this.mark(node, 'operator', () => this.b.emit('/'));
      this.b.emit(' ');
      this.operand(node, 'right', node[2]);
      this.b.emit(')');
    });
  }

  // The seam both match lowerings share: close `toMatchable(`'s
  // argument, then open `.match(`. No narrowing rides here, because
  // `toMatchable` always answers a string — RULED (2026-08-03): the
  // coercion carries no multi-line guard; `^`/`$` across newlines are
  // the regex's own /m business, exactly as in hand-written JS.
  matchReceiverClose() {
    this.b.emit(')');
    this.b.emit('.match(');
  }

  // A regex-literal INDEX is a match read: `text[/re/]` is the whole
  // match (or null), `text[/re/, n]` the nth capture — both spell
  // `((_ = toMatchable(text).match(/re/)) && _[n])`, sharing the
  // last-match binding with `=~`. The outer parens keep the whole
  // guard one operand (`not x[/re/]` negates the READ, not the
  // assignment).
  regexIndex(node, obj, regex, capture) {
    this.mark(node, '$self', () => {
      this.b.emit(`((_ = ${this.runtimeName('toMatchable')}(`);
      this.mark(node, 'object', () => this.expr(obj));
      this.matchReceiverClose();
      this.mark(node, 'key', () => this.b.emit(regex));
      this.b.emit(')) && _[');
      if (capture === null) this.b.emit('0');
      else this.mark(node, 'capture', () => this.expr(capture));
      this.b.emit('])');
    });
  }

  // ["=~", left, right] — the match operator: `text =~ /re/` emits
  // `(_ = toMatchable(text).match(/re/))` — the match array or null,
  // with `_` (the last-match binding, hoisted at the scope) holding
  // it for later reads (`_[1]`). Deliberately NON-chaining: `a =~ b
  // =~ c` would match the first RESULT against the second pattern —
  // reject loudly.
  matchOp(node) {
    if (isNode(node[1]) && node[1][0] === '=~' && !node[1].parenthesized) {
      throw this.positionedError(node, 'emitter: `=~` does not chain — `a =~ b =~ c` would match the first match RESULT against the second pattern (parenthesize: `(a =~ b) =~ c`, or split the matches)');
    }
    const r = node[2];
    this.mark(node, '$self', () => {
      this.b.emit(`(_ = ${this.runtimeName('toMatchable')}(`);
      this.mark(node, 'left', () => this.expr(node[1]));
      this.matchReceiverClose();
      this.mark(node, 'right', () => this.expr(r));
      this.b.emit('))');
    });
  }

  // ["%%", left, right] — true modulo (result carries the divisor's sign).
  modulo(node) {
    this.mark(node, '$self', () => {
      this.b.emit(Emitter.MODULO + '(');
      this.mark(node, 'left', () => this.expr(node[1]));
      this.b.emit(', ');
      this.mark(node, 'right', () => this.expr(node[2]));
      this.b.emit(')');
    });
  }

  // The synthesized compounds (`//=`, `%%=`) spell their target twice
  // (read + write). A plain-name target is the same binding twice —
  // identical bytes, identical behavior. A MEMBER or INDEX target's
  // base (and key) bind as IIFE parameters instead, so a
  // side-effecting base evaluates exactly once (the native compounds'
  // single-evaluation contract).
  // Native compound-assignment order — base, key, target read, RHS,
  // write, each exactly once — comes from direct respelling:
  // `t = open t mid v close` reads the property once (in the RHS) and
  // writes it once (the LHS ref). A target whose object or computed
  // key is not repeat-safe spells both manifestations through the
  // node's plan temps, bound in a leading comma sequence. Hoisted
  // temps (never an IIFE parameter) keep `yield`, `await`, and every
  // control transfer in the source function's own context.
  synthCompound(node, open, mid, close) {
    const t = node[1];
    this.checkExportedConstWrite(node, t); this.checkImportWrite(node, t);
    if (isNode(t) && (t[0] === '.' || t[0] === '[]') && t.length === 3) {
      const plan = this.refPlans.get(node) ?? { recv: null, obj: null, key: null };
      if (plan.obj === null && !this.repeatSafeValue(t[1])) {
        throw this.positionedError(node, 'emitter: reference plan missing for a compound target with an impure object — a capture site the planner walk did not reach');
      }
      if (plan.key === null && t[0] === '[]' && !this.repeatSafeValue(t[2])) {
        throw this.positionedError(node, 'emitter: reference plan missing for a compound target with an impure key — a capture site the planner walk did not reach');
      }
      this.mark(node, '$self', () => {
        const seq = plan.obj !== null || plan.key !== null;
        if (seq) this.b.emit('(');
        if (plan.obj !== null) {
          this.b.emit(`${plan.obj} = `);
          this.mark(t, 'object', () => this.withExpression(() => this.expr(t[1])));
          this.b.emit(', ');
        }
        if (plan.key !== null) {
          this.b.emit(`${plan.key} = `);
          this.mark(t, 'key', () => this.withExpression(() => this.expr(t[2])));
          this.b.emit(', ');
        }
        const ref = this.stores.alias([t[0], plan.obj ?? t[1], plan.key ?? t[2]], t);
        const target = () => this.mark(node, 'target', () => this.withTarget(() => this.expr(ref)));
        target();
        this.b.emit(' ');
        this.mark(node, 'operator', () => this.b.emit('='));
        this.b.emit(' ');
        this.mark(node, 'operator', () => {
          this.b.emit(open);
          target();
          this.b.emit(mid);
          this.operand(node, 'value', node[2]);
          this.b.emit(close);
        });
        if (seq) this.b.emit(')');
      });
      return;
    }
    this.mark(node, '$self', () => {
      const target = () => this.mark(node, 'target', () => this.withTarget(() => this.expr(node[1])));
      target();
      this.b.emit(' ');
      this.mark(node, 'operator', () => this.b.emit('='));
      this.b.emit(' ');
      this.mark(node, 'operator', () => {
        this.b.emit(open);
        target();
        this.b.emit(mid);
        this.operand(node, 'value', node[2]);
        this.b.emit(close);
      });
    });
  }

  // ["//=", target, value] — target = Math.floor(target / value).
  floorDivAssign(node) {
    this.synthCompound(node, 'Math.floor(', ' / ', ')');
  }

  // ["%%=", target, value] — target = modulo(target, value), inlined.
  moduloAssign(node) {
    this.synthCompound(node, Emitter.MODULO + '(', ', ', ')');
  }

  // ["await", value] — the value is an operand position (compound
  // values group: `await (a && b)`; calls stay bare).
  awaitExpr(node) {
    this.renderSyncGuard(node);
    this.mark(node, '$self', () => {
      // The keyword's own row, off the operator role the grammar labels
      // on the AWAIT/DAMMIT token: verbatim-exact where the author
      // spelled `await`, a cover onto the `!` for the sugar spellings.
      // TS80007 reports on the generated keyword, and this row is what
      // its position resolves through — without it the innermost row is
      // the construct-wide cover, and a hint about one character lights
      // the whole expression. A synthetic await node has no role and
      // skips the mark (the emitter's mark() conditions on RoleStore).
      this.mark(node, 'operator', () => this.b.emit('await'));
      this.b.emit(' ');
      this.operand(node, 'value', node[1]);
    });
  }

  // ["do-iife", fn] — immediate invocation: `(<fn>)(<args>)`. The
  // function captures per-parameter arguments — an identifier
  // param passes the enclosing binding of the same name (the
  // loop-closure idiom), a default param passes its default value.
  // Trailing default-only arguments drop: the default itself fires.
  // Pattern, rest, and expansion params have no capture argument —
  // rejected loudly.
  doIife(node) {
    const [, fn] = node;
    if (!isFunc(fn)) {
      throw this.positionedError(isNode(fn) ? fn : node, 'emitter: `do` invokes a function literal (`do ->`, `do (x) ->`, `do (-> …)`); call any other value directly: `f()`', node);
    }
    this.mark(node, '$self', () => {
      this.b.emit('(');
      this.mark(node, 'func', () => this.expr(fn));
      this.b.emit(')(');
      const params = fn[1];
      const args = params.map((p) => {
        // Typed params erase to their cores here too: `do (x: T) ->`
        // captures the enclosing `x`; a typed default passes its
        // default value. The capture argument is a READ of the
        // enclosing binding — a reactive name captures its current
        // VALUE (the expr path unwraps), and the param then shadows
        // it inside the body.
        const core = Emitter.paramCore(p);
        if (typeof core === 'string') return () => this.expr(core);
        if (isNode(core) && core[0] === 'default' && typeof Emitter.paramCore(core[1]) === 'string') return () => this.expr(core[2]);
        throw this.positionedError(p, 'emitter: do-IIFE parameters must be plain names or defaulted names — patterns and rests have no capture argument', node);
      });
      let live = params.length;
      while (live > 0 && isNode(params[live - 1]) && params[live - 1][0] === 'default') live--;
      args.slice(0, live).forEach((arg, i) => {
        if (i > 0) this.b.emit(', ');
        arg();
      });
      this.b.emit(')');
    });
  }

  // ["call", {await}, callee] standing alone: `f!`, the awaited call
  // with no arguments.
  dammit(node) {
    this.renderSyncGuard(node);
    const callee = node[2];
    // The keyword rides the operator role (the labeled DAMMIT token) in
    // both branches — the same row awaitExpr records, for the same
    // reason: TS80007's position resolves to the `!`, not the construct.
    if (isRubyNew(callee)) {
      this.mark(node, '$self', () => {
        this.mark(node, 'operator', () => this.b.emit('await'));
        this.b.emit(' ');
        this.mark(callee, 'property', () => this.b.emit('new'));
        this.b.emit(' ');
        this.mark(node, 'callee', () => this.rubyNewTarget(callee));
        this.b.emit('()');
      });
      return;
    }
    this.mark(node, '$self', () => {
      this.mark(node, 'operator', () => this.b.emit('await'));
      this.b.emit(' ');
      this.asReference(callee, () => this.head(node, 'callee', callee));
      this.b.emit('()');
    });
  }

  // ["call", {opt, await}, callee, ...args] — optional call plus await. Bare
  // `f?!` carries no arguments and calls with none, as dammit's `f!` does.
  maybeDammit(node) {
    this.renderSyncGuard(node);
    // A constructor is never an optional callee. `?!` on `.new`
    // (`X.new?!`, `a.b.new?! 1`) would make the constructor one, which
    // JavaScript refuses. A method of the instance is an ordinary callee
    // (`X.new(1).go?!`).
    const callee = node[2];
    if (isRubyNew(callee)) {
      throw this.positionedError(node,
        "emitter: maybe dammit has no reading on a constructor — `?!` on a construction would make the " +
        "constructor an optional callee; construct and await with `X.new!`");
    }
    this.mark(node, '$self', () => {
      // The keyword's row maps to the labeled MAYBE_DAMMIT token — the `?!`
      // is this spelling's awaiting operator, the way `!` is dammit's.
      this.mark(node, 'operator', () => this.b.emit('await'));
      this.b.emit(' ');
      this.head(node, 'callee', callee);
      this.mark(node, 'operator', () => this.b.emit('?.'));
      this.mark(node, 'args', () => {
        this.b.emit('(');
        node.slice(3).forEach((arg, i) => {
          if (i > 0) this.b.emit(', ');
          this.argExpr(arg);
        });
        this.b.emit(')');
      });
    });
  }

  // ["yield"] | ["yield", value] | ["yield-from", value]
  yieldExpr(node) {
    this.renderSyncGuard(node);
    if (this.scopes.length <= 1) {
      throw this.positionedError(node, "emitter: 'yield' outside a function");
    }
    this.mark(node, '$self', () => {
      this.b.emit(node[0] === 'yield-from' ? 'yield*' : 'yield');
      const value = node[0] === 'yield-from' ? node[1] : node[1];
      if (node.length > 1) {
        this.b.emit(' ');
        this.operand(node, 'value', value);
      }
    });
  }
}
