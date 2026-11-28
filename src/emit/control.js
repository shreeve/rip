// Statement-position control flow: while/loop, if, throw, try, def,
// return, return guards and brace blocks.
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

import { isList, isNode, isNone, mkNode, wordOf } from '../sexpr.js';
import { isTypedWrapper } from './tree.js';
import { Emitter } from './core.js';

export class ControlMethods {
  // ["while", {}, condition, guard, body]: a WHEN guard nests the body in
  // an `if (guard)` block (value position guards with `continue`
  // instead — accumulatorIIFECore).
  whileStatement(node, ind) {
    this.inCtrl(() => this.whileStatementCtrl(node, ind));
  }

  whileStatementCtrl(node, ind) {
    const [, , condition, guard, body] = node;
    this.mark(node, '$self', () => {
      this.b.emit('while (');
      this.mark(node, 'condition', () => this.expr(condition));
      this.b.emit(') ');
      if (!isNone(guard)) {
        const stmts = this.isBlock(body) ? body.slice(2) : body;
        this.b.emit('{\n' + '  '.repeat(ind + 1) + 'if (');
        this.expr(guard);
        this.b.emit(') {\n');
        this.mark(node, 'body', () => this.statements(stmts, ind + 2, 'block'));
        this.b.emit('  '.repeat(ind + 1) + '}\n' + '  '.repeat(ind) + '}');
        return;
      }
      // A postfix loop's body is a [statement] list (the postfix-if
      // convention), and it emits BRACED, single-statement (unlike
      // postfix-if's braceless line).
      if (isList(body)) {
        this.mark(node, 'body', () => {
          this.b.emit('{\n');
          this.b.emit('  '.repeat(ind + 1));
          this.statement(body[0], ind + 1);
          this.b.emit('\n' + '  '.repeat(ind) + '}');
        });
      } else {
        this.mark(node, 'body', () => this.braceBlock(body, ind));
      }
    });
  }

  ifStatement(node, ind) {
    // A postfix conditional's consequent is a [statement] list, and it
    // emits braceless on one line: `if (a) b = 1;`.
    // A reactive declaration can never be the guarded statement — every
    // block-nested declaration rejects at frame collection (#88).
    if (isList(node[3])) {
      const stmt = node[3][0];
      // A guarded LOOP emits braced: a loop may open with a hoisted
      // temp (`const _ref = …;` ahead of `for (… in _ref)`), and a
      // braceless `if` would guard only that first statement. `loop n`
      // binds its count inside its own header.
      const braced = isNode(stmt) && ((stmt[0] === 'loop' && stmt[1].over !== 'times') || stmt[0] === 'while' || stmt[0] === 'comprehension');
      this.mark(node, '$self', () => {
        this.b.emit('if (');
        this.mark(node, 'condition', () => this.expr(node[2]));
        this.b.emit(') ');
        this.postfixGuardDepth++;
        if (braced) {
          this.b.emit('{\n' + '  '.repeat(ind + 1));
          this.statement(stmt, ind + 1);
          this.b.emit('\n' + '  '.repeat(ind) + '}');
        } else {
          this.statement(stmt, ind);
        }
        this.postfixGuardDepth--;
      });
      return;
    }
    this.mark(node, '$self', () => this.ifChain(node, ind));
  }

  // `loop` and `loop n`.
  loopStatement(node, ind) {
    this.withBindings(this.loopBindingNames(node), () => this.inCtrl(() => this.loopStatementCtrl(node, ind)));
  }

  loopStatementCtrl(node, ind) {
    this.mark(node, '$self', () => {
      // Both loop forms share the header emitter: `loop` is
      // `while (true)`, `loop n` the counted for with `it` bound.
      const { body } = this.loopHeader(node);
      this.b.emit(' ');
      this.mark(node, 'body', () => this.braceBlock(body, ind));
    });
  }

  throwStatement(node) {
    this.mark(node, '$self', () => {
      this.b.emit('throw ');
      this.mark(node, 'value', () => this.expr(node[2]));
    });
    this.b.emit(';');
  }

  // `into`: the accumulator of a collecting loop whose tail this try
  // is — the body and each handler collect their own tails, and a
  // swallowed throw collects `undefined`, as the value form yields.
  tryStatement(node, ind, into = null) {
    const [, , tryBody, handler, finalizer] = node;
    const block = (body) => (into === null ? this.braceBlock(body, ind) : this.accumulateBlock(body, ind, into));
    this.mark(node, '$self', () => {
      this.b.emit('try ');
      // An inline body (`try f()`) is its own one-statement block; a
      // handler-less try gains `catch {}` — JS requires a handler or
      // finalizer, and the bare form's contract is to swallow.
      const body = this.isBlock(tryBody) ? tryBody : mkNode('block', tryBody);
      this.mark(node, 'body', () => block(body));
      if (isNone(handler) && isNone(finalizer)) {
        if (into === null) this.b.emit(' catch {}');
        else this.b.emit(' catch {\n' + '  '.repeat(ind + 1) + `${into}.push(undefined);\n` + '  '.repeat(ind) + '}');
      }
      if (!isNone(handler)) {
        const [, , binding, body] = handler;
        if (isNone(binding)) {
          this.b.emit(' catch ');
          block(body);
        } else if (Emitter.isPattern(binding)) {
          // The catch-pattern lowering: bind `error`, destructure as
          // the handler's first statement (paren-wrapped for both
          // pattern kinds). The names hoist at the enclosing scope —
          // for BOTH kinds, which is why the write check runs here.
          this.checkExportedConstWrite(handler, binding); this.checkImportWrite(handler, binding);
          // The scaffold parameter is minted, never `error`: the
          // handler body may READ an outer `error`, which a fixed
          // parameter would shadow. Face-only `any` on it (tsScaffoldAny's
          // doctrine): the destructure is the LOWERING's statement, and
          // TypeScript's `unknown` catch type would publish on it with no
          // narrowing seam the author can reach. Scoped to the minted
          // binding alone — the identifier spelling keeps `unknown`,
          // which the author governs the ordinary ways.
          const param = this.loopTempName('_err');
          this.b.emit(` catch (${param}`);
          this.tsScaffoldAny();
          this.b.emit(') {\n');
          const pad = '  '.repeat(ind + 1);
          this.b.emit(pad + '(');
          this.mark(handler, 'binding', () => this.withPattern(() => this.expr(binding)));
          this.b.emit(` = ${param});\n`);
          if (into === null) this.statements(this.isBlock(body) ? body.slice(2) : [body], ind + 1, 'block');
          else this.accumulateBody(this.isBlock(body) ? body : mkNode('block', body), ind, into);
          this.b.emit('  '.repeat(ind) + '}');
        } else if (isTypedWrapper(binding)) {
          // An annotated binding (`catch error: any`): the name is the
          // JS parameter and the annotation is the face's alone.
          this.b.emit(' catch (');
          this.mark(handler, 'binding', () => this.emitParam(binding));
          this.b.emit(') ');
          this.withBindings([wordOf(binding[2])], () => block(body));
        } else {
          const name = wordOf(binding);
          this.b.emit(' catch (');
          this.mark(handler, 'binding', () => this.b.emit(name));
          this.b.emit(') ');
          // The binding is a new name for the handler — it shadows a
          // same-named reactive declaration.
          this.withBindings([name], () => block(body));
        }
      }
      if (!isNone(finalizer)) {
        this.b.emit(' finally ');
        this.braceBlock(finalizer, ind);
      }
    });
  }

  defStatement(node, ind) {
    const [, attrs, nameNode, params, body] = node;
    // A void def suppresses the implicit return; its voidMarker role
    // (side-band) covers the whole emitted function — the bang's only
    // generated manifestation. The return-type role (side-band) covers
    // it the same way; mark() is a no-op for rows without the role.
    const isVoid = attrs.void === true;
    const name = wordOf(nameNode);
    if (name === undefined) {
      throw this.positionedError(node, "emitter: `def @name` declares a static class method — spell it inside a class body");
    }
    const isAsync = this.containsAwait(body);
    const isGen = this.containsYield(body);
    // TS face: recorded overload signatures print immediately above
    // the implementation, outside its covers.
    this.tsOverloadSigs(node, ind);
    this.mark(node, 'voidMarker', () => this.mark(node, 'returnType', () => this.mark(node, '$self', () => {
      if (isAsync) this.b.emit('async ');
      this.b.emit(isGen ? 'function* ' : 'function ');
      this.mark(node, 'name', () => this.b.emit(name));
      // Generic def: the TYPE_PARAMS side-band role
      // re-emits after the name, TS-only (`function wrap<T extends
      // string>(…)` — erased from JS).
      if (this.ts) {
        const tp = this.annotationText(node, 'typeParams');
        if (tp !== null) this.b.tsOnly(() => this.mark(node, 'typeParams', () => this.emitTypeText(node, 'typeParams', tp)));
      }
      // The params role spans the parenthesized list (OptParams); the
      // ParamList array is itself a registered node, so the name list
      // inside the parens carries its own $self mapping.
      this.mark(node, 'params', () => {
        this.b.emit('(');
        this.mark(params, '$self', () => this.emitParams(params));
        this.b.emit(')');
      });
      this.tsReturnAnnotation(node, isAsync, isVoid, isGen);
      this.b.emit(' ');
      const all = this.isBlock(body) ? body.slice(2) : [body];
      const stmts = this.liveStmts(all);
      const { entries, names } = this.scopedHoist(all, params);
      for (const n of this.pushReactiveFrame(stmts, names, node)) names.add(n);
      this.scopes.push(names);
      this.rejectUnboundIt(params, body);
      // def bodies implicitly return their last expression, same as
      // arrow functions — unless the def is void.
      this.funcBlock(node, body, stmts, ind, entries, isVoid);
      this.scopes.pop();
      this.rframes.pop();
    })));
  }

  returnStatement(node) {
    const value = node[2];
    // Outside any function a `return` has no target — the emitted
    // module would fail at load, which is the loud error in the
    // wrong place.
    if (this.scopes.length <= 1) {
      throw this.positionedError(node, "emitter: 'return' outside a function");
    }
    // A void function's body cannot return a value — the `!` on its
    // definition declares it returns undefined. Bare
    // `return` stays legal.
    if (!isNone(value) && this.sideEffectOnly) {
      throw this.positionedError(node, `emitter: cannot return a value from a void function (${this.voidReason ?? "the trailing '!' on its definition suppresses returns"})`);
    }
    this.mark(node, '$self', () => {
      this.b.emit('return');
      if (!isNone(value)) {
        this.b.emit(' ');
        this.grouped(node, 'value', value, Emitter.needsGrouping(value, 'return'));
      }
    });
    this.b.emit(';');
  }

  braceBlock(blockNode, ind, hoist = []) {
    const stmts = this.isBlock(blockNode) ? blockNode.slice(2) : [blockNode];
    this.mark(blockNode, '$self', () => {
      this.b.emit('{\n');
      if (hoist.length) {
        this.b.emit('  '.repeat(ind + 1));
        this.hoistLine(hoist, '  '.repeat(ind + 1));
        this.b.emit('\n');
      }
      this.mark(blockNode, 'statements', () => this.statements(stmts, ind + 1, 'block'));
      this.b.emit('  '.repeat(ind) + '}');
    });
  }

  // A return guard in statement position. The rewrite keeps every
  // contract: the condition operand evaluates once, the assignment
  // (when present) lands before the test reads it, and the `return`
  // stays a statement of the ENCLOSING function's body.
  //   x or return e      →  if (!x) return e;
  //   y = x or return e  →  if (!(y = x)) return e;
  //   x ?? return e      →  if (x == null) return e;
  //   x and return e     →  if (x) return e;
  //   y = x or continue  →  if (!(y = x)) continue;
  returnGuardStatement(guard, assign) {
    const [op, , left, ret] = guard;
    // The jump: a `break`/`continue` word, or a return or throw node.
    const word = wordOf(ret);
    const kind = word ?? ret[0];
    if (kind === 'return' && this.scopes.length <= 1) {
      throw this.positionedError(ret, "emitter: 'return' outside a function");
    }
    if ((kind === 'break' && this.ctrlDepth === 0) || (kind === 'continue' && this.loopDepth === 0)) {
      throw this.positionedError(guard, `emitter: '${kind}' outside a loop${kind === 'break' ? ' or switch' : ''}`);
    }
    const emitCond = () => {
      const inner = () => {
        if (assign !== null) {
          this.mark(assign, '$self', () => {
            this.mark(assign, 'target', () => this.b.emit(wordOf(assign[2])));
            this.b.emit(' ');
            this.mark(assign, 'operator', () => this.b.emit('='));
            this.b.emit(' ');
            this.mark(assign, 'value', () => this.expr(left));
          });
        } else {
          this.mark(guard, 'left', () => this.expr(left));
        }
      };
      // An assignment (or any non-primary operand) parenthesizes
      // inside the condition; a plain name or call reads bare.
      const grouped = assign !== null || Emitter.jsTier(left) !== 'primary';
      if (op === '||') {
        this.b.emit('!');
        if (grouped) { this.b.emit('('); inner(); this.b.emit(')'); }
        else inner();
      } else if (op === '??') {
        if (grouped) { this.b.emit('('); inner(); this.b.emit(')'); }
        else inner();
        this.b.emit(' == null');
      } else {
        if (grouped && assign !== null) { this.b.emit('('); inner(); this.b.emit(')'); }
        else inner();
      }
    };
    this.mark(guard, '$self', () => {
      this.b.emit('if (');
      emitCond();
      this.b.emit(') ');
      this.mark(ret, '$self', () => {
        this.b.emit(kind);
        if (word === undefined && !isNone(ret[2])) {
          this.b.emit(' ');
          this.mark(ret, 'value', () => {
            if (kind === 'return' && Emitter.needsGrouping(ret[2], 'return')) {
              this.b.emit('('); this.expr(ret[2]); this.b.emit(')');
            } else this.expr(ret[2]);
          });
        }
      });
      this.b.emit(';');
    });
  }
}
