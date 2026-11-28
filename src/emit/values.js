// Value-usage lowerings (context-sensitive codegen).
//
// Statement constructs in expression position
// lower: if → ternary (or an inline-style IIFE when any branch holds
// multiple statements), try/switch → IIFE with returns pushed onto
// each tail, while/loop/for → accumulator IIFE collecting each
// iteration's last value. Generated IIFE scaffolding sits OUTSIDE
// role marks; branch/condition marks stay honest (cover rows over
// lowered forms — mappingKind by construction).
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

import { isHeadless } from '../emitter-shape.js';
import { asked, isShapedNode, isIf, isFunc, CTRL_ALL, isDefHead, isUpdate, isComprehensionNode, isLoopNode } from './helpers.js';
import { Emitter } from './core.js';

export class ValueMethods {
  static ifArms(node) {
    const arms = [];
    let cur = node;
    let elseBlock = null;
    while (true) {
      arms.push(cur);
      if (cur.length < 4) break;
      if (isShapedNode(cur[3]) && cur[3][0] === 'if') {
        cur = cur[3];
        continue;
      }
      elseBlock = cur[3];
      break;
    }
    return { arms, elseBlock };
  }

  // Branch statements with erased statements FILTERED — shape
  // predicates (ifIsSimple, tail classification) and emission must
  // agree with the stripped twin's shape. Pure: records nothing.
  // An if branch is always the grammar's ['block', …] wrapper (an
  // inline arm included), never a bare call, so the head alone decides.
  static branchStmts(b) {
    return Emitter.stripErased(isShapedNode(b) && b[0] === 'block' && !isHeadless(b) ? b.slice(1) : [b[0]]);
  }

  // The emission-path twin: same statements, with each erased one
  // recording its zero-width rows at the current output position.
  // `collectDecls` — passed by SLOTLESS lowerings (ternary arms) —
  // queues the branch's type declarations for the enclosing statement
  // list's flush (pendingTypeDecls) so the face never drops them.
  branchLive(b, collectDecls = false) {
    const raw = this.isBlock(b) ? b.slice(1) : [b[0]];
    if (this.ts && collectDecls) {
      for (const s of raw) {
        if (isShapedNode(s) && s[0] === 'type-decl') this.pendingTypeDecls.push(s);
      }
    }
    return this.liveStmts(raw);
  }

  // A statement that cannot appear inside a ternary branch.
  static statementOnly(stmt) {
    if (typeof stmt === 'string' && (stmt === 'break' || stmt === 'continue' || stmt === 'debugger')) return true;
    return isShapedNode(stmt) && (stmt[0] === 'return' || stmt[0] === 'throw' || isDefHead(stmt[0]));
  }

  // Control flow anywhere inside a statement: a break/continue/return/
  // throw at ANY depth (function boundaries excluded — a nested
  // function's return is its own) cannot cross an accumulator's push,
  // because the value lowering would trap it inside an IIFE. Such a
  // tail statement stays a statement. DELIBERATELY CONSERVATIVE: a
  // tail `if` whose control flow sits only on one branch could in
  // principle collect the other branch's value, but classifying which
  // shapes lower validly is a per-construct proof — refusing the whole
  // statement is always CORRECT (the loop yields fewer collected
  // values, never invalid JS or trapped control flow).
  // A `return` anywhere below, NOT descending into function bodies —
  // the one control form a value-position push cannot contain (it must
  // cross to the enclosing function).
  static containsReturn(stmt) {
    if (!isShapedNode(stmt)) return false;
    if (isHeadless(stmt)) return stmt.some((item) => Emitter.containsReturn(item));
    const head = stmt[0];
    if (head === 'return') return true;
    if (head === '->' || head === '=>' || isDefHead(head) || head === 'class') return false;
    return stmt.some((item) => Emitter.containsReturn(item));
  }

  static containsCtrl(stmt) {
    if (typeof stmt === 'string') return stmt === 'break' || stmt === 'continue';
    if (!isShapedNode(stmt)) return false;
    if (isHeadless(stmt)) return stmt.some((item) => Emitter.containsCtrl(item));
    const head = stmt[0];
    if (head === 'break' || head === 'continue' || head === 'return' || head === 'throw') return true;
    if (head === '->' || head === '=>' || isDefHead(head) || head === 'class') return false;
    return stmt.some((item) => Emitter.containsCtrl(item));
  }

  static ifIsSimple(node) {
    const { arms, elseBlock } = Emitter.ifArms(node);
    const ok = (b) => {
      const stmts = Emitter.branchStmts(b);
      return stmts.length === 1 && !Emitter.statementOnly(stmts[0]);
    };
    return arms.every((a) => ok(a[2])) && (elseBlock === null || ok(elseBlock));
  }

  valueIf(node) {
    if (!Emitter.ifIsSimple(node)) {
      // IIFE scaffolding is emitter-added syntax — it sits OUTSIDE the
      // $self mark, so the construct's cover anchor lands on the
      // `if` itself.
      const ind = this.ind;
      this.rejectYieldInIIFE(node);
      const isAsync = this.containsAwait(node);
      this.b.emit(isAsync ? 'await (async () => { ' : '(() => { ');
      this.mark(node, '$self', () => this.returnifyIf(node, ind));
      this.b.emit(' })()');
      return;
    }
    this.mark(node, '$self', () => this.ifTernary(node));
  }

  ifTernary(node) {
    // Lowered-ternary conditions emit in 'value' context, which
    // self-parenthesizes compounds: `(n > 5) ? … : …`.
    // await conditions group in ternaries (`(await ok()) ? …`);
    // dammit conditions stay bare — the sugar's await surrounds a
    // complete call, which reads unambiguously.
    this.grouped(node, 'condition', node[1], Emitter.needsGrouping(node[1], 'operand') || (isShapedNode(node[1]) && (node[1][0] === 'await' || node[1][0] === 'yield')));
    this.b.emit(' ? ');
    this.ternaryArm(node, 'then', this.branchLive(node[2], true)[0]);
    this.b.emit(' : ');
    if (node.length < 4) {
      this.b.emit('undefined');
    } else if (isShapedNode(node[3]) && node[3][0] === 'if') {
      // An else-if chain nests as a parenthesized ternary.
      this.mark(node, 'else', () => {
        this.b.emit('(');
        this.ifTernary(node[3]);
        this.b.emit(')');
      });
    } else {
      this.ternaryArm(node, 'else', this.branchLive(node[3], true)[0]);
    }
  }

  ternaryArm(node, role, stmt) {
    this.mark(node, role, () => {
      const wrap = Emitter.needsGrouping(stmt, 'operand') || isUpdate(stmt);
      if (wrap) this.b.emit('(');
      this.expr(stmt);
      if (wrap) this.b.emit(')');
    });
  }

  // A brace block whose LAST statement returns its value — the body
  // shape shared by every returns-pushed lowering.
  returnBlock(block, ind, effect = false) {
    const stmts = this.branchLive(block);
    this.b.emit('{\n');
    this.emitTsTypeDecls(this.isBlock(block) ? block.slice(1) : [block[0]], '  '.repeat(ind + 1));
    stmts.forEach((stmt, i) => {
      this.b.emit('  '.repeat(ind + 1));
      if (i === stmts.length - 1) this.implicitReturn(stmt, ind + 1, effect);
      else this.statement(stmt, ind + 1);
      this.b.emit('\n');
    });
    this.b.emit('  '.repeat(ind) + '}');
  }

  returnifyIf(node, ind, effect = false) {
    // The condition emits in 'value' context —
    // compound conditions arrive double-parenthesized: `if ((v > 0))`.
    this.b.emit('if (');
    this.grouped(node, 'condition', node[1], Emitter.needsGrouping(node[1], 'operand'));
    this.b.emit(') ');
    this.mark(node, 'then', () => this.returnBlock(node[2], ind, effect));
    if (node.length >= 4) {
      this.b.emit(' else ');
      if (isShapedNode(node[3]) && node[3][0] === 'if') this.returnifyIf(node[3], ind, effect);
      else this.mark(node, 'else', () => this.returnBlock(node[3], ind, effect));
    }
  }

  // A yield cannot cross a lowering IIFE's boundary: the arrow is not
  // a generator, so the emitted JS would be invalid.
  rejectYieldInIIFE(node) {
    if (Emitter.containsYield(node)) {
      throw this.positionedError(node, 'emitter: yield inside an expression-lowered construct cannot cross the IIFE boundary; restructure as statements');
    }
    this.rejectCapturedCtrl(node);
  }

  // Control flow that would cross a value-lowering's IIFE: `return`
  // anywhere (it would return from the generated function, not the
  // enclosing one), and `break`/`continue` not bound by a loop (or,
  // for break, a switch) INSIDE the construct — bare, they emit
  // engine-invalid JavaScript.
  // `want` narrows the search (the match-arm check asks for break
  // alone). A statement `break`/`continue` is a bare word directly in
  // a block, or the one-element node a postfix conditional wraps; the
  // same word anywhere else is a member or key name (`obj.break()`,
  // `{break: 1}`) and never counts.
  static findCapturedCtrl(stmt, want = CTRL_ALL) {
    let found = null;
    const walk = (n, loops, switches) => {
      if (found !== null || !isShapedNode(n)) return;
      const head = isHeadless(n) ? null : n[0];
      if (isFunc(n) || isDefHead(head) || head === 'class') return;
      if (head === 'return') { if (want.has('return')) found = { kind: 'return', node: n }; return; }
      const l = head !== null && (isLoopNode(n) || isComprehensionNode(n)) ? loops + 1 : loops;
      const s = head === 'switch' ? switches + 1 : switches;
      const inBlock = head === 'block' || head === 'program' || head === 'try';
      // A node's slot 0 is its head; a headless array (a switch's cases,
      // a postfix body) has none, and its first element is a child like
      // the rest.
      for (let i = typeof head === 'string' ? 1 : 0; i < n.length; i++) {
        const el = n[i];
        const ctrl = typeof el === 'string' ? (
          inBlock || ((head === '||' || head === '&&' || head === '??') && i === 2) ? el : null
        ) : isShapedNode(el) && el.length === 1 && typeof el[0] === 'string' ? el[0] : null;
        if (ctrl === 'break' && want.has('break') && l + s === 0) { found = { kind: 'break', node: null }; return; }
        if (ctrl === 'continue' && want.has('continue') && l === 0) { found = { kind: 'continue', node: null }; return; }
        walk(el, l, s);
      }
    };
    walk(stmt, 0, 0);
    return found;
  }

  rejectCapturedCtrl(node) {
    // Consume-once tail exemption: when the construct's value is
    // IMMEDIATELY returned (a function-tail if/try/switch), a source
    // `return` tunnels through the IIFE — the returned value flows to
    // the enclosing return — so it stays legal there. Nested
    // constructs see the flag cleared and reject as usual;
    // break/continue never tunnel.
    const tailOk = this.tailReturnOk;
    this.tailReturnOk = false;
    const hit = Emitter.findCapturedCtrl(node);
    if (hit !== null && !(tailOk && hit.kind === 'return')) {
      throw this.positionedError(hit.node ?? node,
        `emitter: '${hit.kind}' inside an expression-lowered construct cannot cross the IIFE boundary — ` +
        'restructure with statement position (or assign from the branches)', node);
    }
  }

  // Emit fn with the tail-return exemption armed, clearing it even on
  // paths that never consult it (the simple-ternary tail).
  withTailReturn(fn) {
    this.tailReturnOk = true;
    try { fn(); } finally { this.tailReturnOk = false; }
  }

  valueTry(node) {
    const ind = this.ind;
    this.rejectYieldInIIFE(node);
    this.b.emit(this.containsAwait(node) ? 'await (async () => { ' : '(() => { ');
    this.tryBranches(node, ind);
    this.b.emit(' })()');
  }

  // The try with every branch returning its value: the body of the
  // value form's IIFE, and the whole of a tail-position try, which
  // returns from the enclosing function in place.
  tryBranches(node, ind, effect = false) {
    this.mark(node, '$self', () => {
      this.b.emit('try ');
      // An inline body (`x = try f()`) is its own one-statement
      // block; a handler-less try gains `catch {}`, so the value is
      // the body's result or undefined on throw.
      const vbody = this.isBlock(node[1]) ? node[1] : ['block', node[1]];
      this.mark(node, 'body', () => this.returnBlock(vbody, ind, effect));
      if (node.length === 2) this.b.emit(' catch {}');
      for (const part of node.slice(2)) {
        if (!isShapedNode(part)) continue;
        if (this.isBlock(part)) {
          this.b.emit(' finally ');
          this.braceBlock(part, ind);
        } else {
          const [, binding, body] = part;
          if (binding === null) {
            this.b.emit(' catch ');
            this.returnBlock(body, ind, effect);
          } else if (Emitter.isPattern(binding)) {
            this.checkExportedConstWrite(part, binding); this.checkImportWrite(part, binding);
            // The statement path's catch-pattern lowering, value-side:
            // minted parameter, face-only `any` on it for the same reason.
            const param = this.loopTempName('_err');
            this.b.emit(` catch (${param}`);
            this.tsScaffoldAny();
            this.b.emit(') {\n');
            this.b.emit('  '.repeat(ind + 1) + '(');
            this.mark(part, 'binding', () => this.withPattern(() => this.expr(binding)));
            this.b.emit(` = ${param});\n`);
            const stmts = this.branchLive(body);
            this.emitTsTypeDecls(this.isBlock(body) ? body.slice(1) : [body[0]], '  '.repeat(ind + 1));
            stmts.forEach((stmt, i) => {
              this.b.emit('  '.repeat(ind + 1));
              if (i === stmts.length - 1) this.implicitReturn(stmt, ind + 1, effect);
              else this.statement(stmt, ind + 1);
              this.b.emit('\n');
            });
            this.b.emit('  '.repeat(ind) + '}');
          } else if (Emitter.isTypedWrapper(binding)) {
            this.b.emit(' catch (');
            this.mark(part, 'binding', () => this.emitParam(binding));
            this.b.emit(') ');
            this.withBindings([binding[1]], () => this.returnBlock(body, ind, effect));
          } else {
            this.b.emit(' catch (');
            this.mark(part, 'binding', () => this.b.emit(binding));
            this.b.emit(') ');
            // The binding is a new name for the handler — it shadows a
            // same-named reactive declaration (the statement path's rule).
            this.withBindings([binding], () => this.returnBlock(body, ind, effect));
          }
        }
      }
    });
  }

  valueSwitch(node, effect = false) {
    this.rejectYieldInIIFE(node);
    this.b.emit(this.containsAwait(node) ? 'await (async () => { ' : '(() => { ');
    this.mark(node, '$self', () => this.switchArms(node, this.ind, effect));
    this.b.emit(' })()');
  }

  // A switch whose every arm returns its value: the body of a value
  // switch's IIFE, or a function's tail statement.
  switchArms(node, ind, effect) {
    const [, subject, cases, dflt] = node;
    const pad = '  '.repeat(ind);
    if (Emitter.hasMatchArms(cases)) {
      this.checkMatchSwitch(node);
      this.matchChain(node, ind, (body) => this.returnBlock(body, ind, effect));
    } else if (subject !== null) {
      this.liveScope(() => {
        this.b.emit('switch (');
        this.mark(node, 'subject', () => this.expr(subject));
        this.b.emit(') {\n');
        for (const when of cases) {
          const [, conditions, body] = when;
          for (const c of conditions) {
            this.b.emit(`${pad}  case `);
            this.expr(c);
            this.b.emit(':\n');
          }
          this.returnCaseBody(body, ind, effect);
        }
        if (dflt !== null) {
          this.b.emit(`${pad}  default:\n`);
          this.returnCaseBody(dflt, ind, effect);
        }
        this.b.emit(`${pad}}`);
      }, 'switch');
    } else {
      // Subjectless switch lowers to an if/else chain with returns
      // (value context); a multi-condition `when` ORs every test,
      // exactly like the statement-position chain.
      cases.forEach((when, i) => {
        const [, conditions, body] = when;
        if (i > 0) this.b.emit(' else ');
        this.b.emit('if (');
        this.whenTests(Array.isArray(conditions) ? conditions : [conditions]);
        this.b.emit(') ');
        this.returnBlock(body, ind, effect);
      });
      if (dflt !== null) {
        this.b.emit(' else ');
        this.returnBlock(dflt, ind, effect);
      }
    }
  }

  returnCaseBody(body, ind, effect = false) {
    this.inCtrl(() => this.returnCaseBodyCtrl(body, ind, effect), false);
  }

  returnCaseBodyCtrl(body, ind, effect) {
    const stmts = this.branchLive(body);
    this.emitTsTypeDecls(this.isBlock(body) ? body.slice(1) : [body[0]], '  '.repeat(ind + 2));
    stmts.forEach((stmt, i) => {
      this.b.emit('  '.repeat(ind + 2));
      if (i === stmts.length - 1) this.implicitReturn(stmt, ind + 2, effect);
      else this.statement(stmt, ind + 2);
      this.b.emit('\n');
    });
    if (!this.tailLeaves(stmts[stmts.length - 1], effect)) this.b.emit('  '.repeat(ind + 2) + 'break;\n');
  }

  // Whether an arm's tail, as implicitReturn lowers it, always leaves the
  // arm: returns, throws, or jumps. A tail it lowers to a statement — a
  // loop, a guard, a declaration, a write with no value form, an effect
  // write — can finish, and its arm then breaks itself rather than fall
  // into the next case. Unsure answers false: a `break` after a return is
  // unreachable, a missing one runs the next arm.
  tailLeaves(stmt, effect) {
    if (stmt === undefined) return false;
    if (typeof stmt === 'string') return stmt !== 'debugger';
    if (!isShapedNode(stmt)) return true;
    const h = stmt[0];
    if (h === 'return' || h === 'throw') return true;
    if (effect && (this.effectTailWrites(stmt) || this.effectBranchWrites(stmt))) return false;
    if (h === 'if' && stmt.length >= 3 && stmt.length <= 4) {
      if (Emitter.ifIsSimple(stmt)) return true;
      if (stmt.length === 3) return false;
      const last = (b) => Emitter.branchStmts(b).at(-1);
      const rest = isShapedNode(stmt[3]) && stmt[3][0] === 'if' ? stmt[3] : last(stmt[3]);
      return this.tailLeaves(last(stmt[2]), effect) && this.tailLeaves(rest, effect);
    }
    if (h === 'try' || h === 'switch') return false;
    if ((h === 'while' && (stmt.length === 3 || stmt.length === 4)) || (h === 'loop' && stmt.length === 2)) return false;
    if (Emitter.returnGuard(stmt) || Emitter.stmtGuard(stmt)) return false;
    if (h === '=' && stmt.length === 3 &&
        (Emitter.returnGuard(stmt[2]) || Emitter.stmtGuard(stmt[2]) || Emitter.sliceTarget(stmt[1]) !== null)) return false;
    if (this.isReactiveDecl(stmt) || this.isReadonlyDecl(stmt)) return false;
    if (this.isEffectDecl(stmt) && stmt[1] !== null) return false;
    return true;
  }

  // The loop header for a value/tail-position accumulator: emits the
  // header (no brace) and returns the body plus the guard and body-top
  // setup emitters the caller lays out.
  loopHeader(node) {
    const head = node[0];
    if (head === 'while') {
      this.b.emit('while (');
      this.mark(node, 'condition', () => this.expr(node[1]));
      this.b.emit(')');
      return { body: node[node.length - 1], guard: node.length === 4 ? node[2] : null, setups: [] };
    }
    if (head === 'loop') {
      this.b.emit('while (true)');
      return { body: node[1], guard: null, setups: [] };
    }
    if (head === 'loop-n') {
      // `loop n` — n iterations, `it` bound as the counter. The count
      // evaluates ONCE: a pure count reads inline in the header test;
      // an impure one binds beside the counter.
      const count = node[1];
      const pure = this.repeatSafeValue(count);
      const ref = pure ? null : this.liveTemp('_n');
      this.b.emit('for (let it = 0');
      if (ref !== null) {
        this.b.emit(`, ${ref} = `);
        this.mark(node, 'count', () => this.expr(count));
      }
      this.b.emit('; it < ');
      if (ref !== null) this.b.emit(ref);
      else this.mark(node, 'count', () => this.expr(count));
      this.b.emit('; it++)');
      return { body: node[2], guard: null, setups: [] };
    }
    const [, vars, iter, aux, guard, body] = node;
    const setups = this.clauseHeader(node, head, vars, iter, aux);
    return { body, guard, setups };
  }

  // Loops as values collect each iteration's last body value (an
  // accumulator IIFE; the multiline style, unlike the inline if/try/
  // switch IIFEs). Setups and the guard `if` sit at the loop body's
  // level; guarded contents indent one deeper.
  accumulatorIIFE(node) {
    this.withBindings(this.loopBindingNames(node), () => this.accumulatorIIFECore(node));
  }

  accumulatorIIFECore(node) {
    this.inCtrl(() => this.accumulatorIIFECoreCtrl(node));
  }

  accumulatorIIFECoreCtrl(node) {
    const ind = this.ind;
    const p1 = '  '.repeat(ind + 1);
    this.rejectYieldInIIFE(node);
    this.b.emit(this.containsAwait(node) ? 'await (async () => {\n' : '(() => {\n');
    const acc = this.liveTemp('result');
    this.b.emit(`${p1}const ${acc} = [];\n`);
    this.b.emit(p1);
    this.mark(node, '$self', () => {
      const { body, guard, setups } = this.loopHeader(node);
      this.b.emit(' {\n');
      const p2 = '  '.repeat(ind + 2);
      for (const setup of setups) {
        this.b.emit(p2);
        setup();
        this.b.emit('\n');
      }
      if (guard !== null && node[0] === 'while') {
        // A while's value-position guard SKIPS the iteration (`if
        // (!(guard)) continue;`) where the for family wraps the body —
        // the two guard styles, both pinned by the tests.
        this.b.emit(p2);
        this.b.emit('if (!(');
        this.expr(guard);
        this.b.emit(')) continue;\n');
        this.accumulateBody(body, ind + 1, acc);
      } else if (guard !== null) {
        this.b.emit(p2);
        this.guardOpen(guard);
        this.accumulateBody(body, ind + 2, acc);
        this.b.emit(`${p2}}\n`);
      } else {
        this.accumulateBody(body, ind + 1, acc);
      }
      this.b.emit(`${p1}}`);
    });
    this.b.emit('\n');
    this.b.emit(`${p1}return ${acc};\n`);
    this.b.emit('  '.repeat(ind) + '})()');
  }

  accumulateBody(body, ind, into) {
    const stmts = this.branchLive(body);
    const pad = '  '.repeat(ind + 1);
    this.emitTsTypeDecls(this.isBlock(body) ? body.slice(1) : [body[0]], pad);
    stmts.forEach((stmt, i) => {
      this.b.emit(pad);
      // A tail LOOP accumulates like any tail expression — the nested
      // loop's own value (its accumulator array) pushes, so block-form
      // nesting agrees with the parenthesized comprehension — UNLESS a
      // `return` sits inside (it must cross to the enclosing function,
      // which a push's IIFE would capture). The loop's own
      // break/continue bind inside it and never cross the push.
      const tailLoop = i === stmts.length - 1 && isLoopNode(stmt) &&
        !asked('return', stmt, Emitter.containsReturn(stmt));
      if (tailLoop) {
        this.b.emit(`${into}.push(`);
        this.expr(stmt);
        this.b.emit(');');
        this.b.emit('\n');
        return;
      }
      // A tail statement carrying control flow stays a statement:
      // its break/continue/return cannot cross a push.
      if (i === stmts.length - 1 && !Emitter.statementOnly(stmt) && !isLoopNode(stmt) && !asked('ctrl', stmt, Emitter.containsCtrl(stmt))) {
        this.b.emit(`${into}.push(`);
        const wrap = Emitter.needsGrouping(stmt, 'operand') || isUpdate(stmt);
        if (wrap) this.b.emit('(');
        this.expr(stmt);
        if (wrap) this.b.emit(')');
        this.b.emit(');');
      } else if (i === stmts.length - 1 && isShapedNode(stmt) && stmt[0] === 'if' && stmt.length >= 3 && stmt.length <= 4) {
        // A tail `if` whose arms jump (`if a is 1 then continue else
        // a * 10`): each arm accumulates its own tail, and a jumping arm
        // stays the jump.
        this.mark(stmt, '$self', () => this.accumulateIf(stmt, ind + 1, into));
      } else if (i === stmts.length - 1 && isShapedNode(stmt) && stmt[0] === 'switch' && stmt.length === 4) {
        this.switchStatement(stmt, ind + 1, into);
      } else if (i === stmts.length - 1 && isShapedNode(stmt) && stmt[0] === 'try') {
        if (stmt.slice(2).some((part) => this.isBlock(part))) {
          // A finally runs after a branch's push and may throw or jump
          // past it: the branches collect into a temp the loop takes only
          // once the whole try completes.
          const tmp = this.loopTempName('_try');
          this.temps.used.add(tmp);
          this.b.emit(`const ${tmp} = [];\n${pad}`);
          this.tryStatement(stmt, ind + 1, tmp);
          this.b.emit(`\n${pad}${into}.push(...${tmp});`);
        } else {
          this.tryStatement(stmt, ind + 1, into);
        }
      } else {
        this.statement(stmt, ind + 1);
        if (isLoopNode(stmt)) this.b.emit(';');
      }
      this.b.emit('\n');
    });
  }

  // A tail `if` of an accumulating loop body, every arm accumulating.
  accumulateIf(node, ind, into) {
    this.b.emit('if (');
    this.grouped(node, 'condition', node[1], Emitter.needsGrouping(node[1], 'operand'));
    this.b.emit(') ');
    this.mark(node, 'then', () => this.accumulateBlock(node[2], ind, into));
    if (node.length >= 4) {
      this.b.emit(' else ');
      if (isShapedNode(node[3]) && node[3][0] === 'if') this.accumulateIf(node[3], ind, into);
      else this.mark(node, 'else', () => this.accumulateBlock(node[3], ind, into));
    } else {
      this.accumulateMissingArm(ind, into);
    }
  }

  // A collecting branch with no else arm collects `undefined`, as the
  // same branch in value position yields.
  accumulateMissingArm(ind, into) {
    this.b.emit(' else {\n' + '  '.repeat(ind + 1) + `${into}.push(undefined);\n` + '  '.repeat(ind) + '}');
  }

  accumulateBlock(block, ind, into) {
    this.b.emit('{\n');
    this.accumulateBody(block, ind, into);
    this.b.emit('  '.repeat(ind) + '}');
  }

  // A statement-position comprehension whose value is unused: a plain
  // loop, guard as a wrapping if. The statement semicolon belongs to
  // the caller — a function body's direct statements carry none.
  plainLoopComprehension(node, ind) {
    this.withBindings(this.loopBindingNames(node), () => this.plainLoopComprehensionCore(node, ind));
  }

  plainLoopComprehensionCore(node, ind) {
    this.inCtrl(() => this.plainLoopComprehensionCoreCtrl(node, ind));
  }

  plainLoopComprehensionCoreCtrl(node, ind) {
    const [, expr, [clause], guards] = node;
    const pad = '  '.repeat(ind);
    this.mark(node, '$self', () => {
      const [kind, vars, iter, aux] = clause;
      const setups = this.clauseHeader(node, kind, vars, iter, aux ?? null, pad);
      this.b.emit(' {\n');
      let inner = `${pad}  `;
      for (const setup of setups) {
        this.b.emit(inner);
        setup();
        this.b.emit('\n');
      }
      if (guards.length > 0) {
        this.b.emit(inner);
        this.guardOpen(guards[0]);
        inner += '  ';
      }
      this.b.emit(inner);
      this.statement(expr, ind + (guards.length > 0 ? 2 : 1));
      this.b.emit('\n');
      if (guards.length > 0) this.b.emit(`${pad}  }\n`);
      this.b.emit(`${pad}}`);
    });
  }

  // Tail-position for-loops accumulate INLINE with `_result`
  // (no IIFE inside a function body).
  // The accumulator's `const` lands in the block that holds the loop,
  // and the loop's `return` ends that block — except in a case clause,
  // whose block is the whole switch: there the name stays reserved
  // until the switch closes, so a later clause's tail loop mints its own.
  returnifyLoop(node, ind) {
    const acc = this.liveKinds.at(-1) === 'switch' ? this.liveTemp('_result') : null;
    this.withBindings(this.loopBindingNames(node), () => this.returnifyLoopCore(node, ind, acc));
  }

  returnifyLoopCore(node, ind, acc) {
    this.inCtrl(() => this.returnifyLoopCoreCtrl(node, ind, acc));
  }

  returnifyLoopCoreCtrl(node, ind, shared) {
    const pad = '  '.repeat(ind);
    const acc = shared ?? this.liveTemp('_result');
    this.b.emit(`const ${acc} = [];\n`);
    this.b.emit(pad);
    this.mark(node, '$self', () => {
      const { body, guard, setups } = this.loopHeader(node);
      this.b.emit(' {\n');
      const p1 = '  '.repeat(ind + 1);
      for (const setup of setups) {
        this.b.emit(p1);
        setup();
        this.b.emit('\n');
      }
      if (guard !== null) {
        this.b.emit(p1);
        this.guardOpen(guard);
        this.accumulateBody(body, ind + 1, acc);
        this.b.emit(`${p1}}\n`);
      } else {
        this.accumulateBody(body, ind, acc);
      }
      this.b.emit(`${pad}}`);
    });
    this.b.emit('\n');
    this.b.emit(`${pad}return ${acc};`);
  }

  ifChain(node, ind) {
    this.b.emit('if (');
    this.mark(node, 'condition', () => this.expr(node[1]));
    this.b.emit(') ');
    this.mark(node, 'then', () => this.braceBlock(node[2], ind));
    if (node.length === 4) {
      this.b.emit(' ');
      this.mark(node, 'else', () => {
        this.b.emit('else ');
        const tail = node[3];
        if (isIf(tail)) this.mark(tail, '$self', () => this.ifChain(tail, ind));
        else this.braceBlock(tail, ind);
      });
    }
  }
}
