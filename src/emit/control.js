// Statement-position control flow: while/loop, if, throw, try, def,
// return, return guards and brace blocks.
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

import { isNode } from './helpers.js';
import { Emitter } from './core.js';

export class ControlMethods {
  // ["while", condition, body] — the plain loop; ["while", condition,
  // guard, body] carries a WHEN guard, which nests the body in an
  // `if (guard)` block (value position guards with `continue` instead —
  // accumulatorIIFECore).
  whileStatement(node, ind) {
    this.inCtrl(() => this.whileStatementCtrl(node, ind));
  }

  whileStatementCtrl(node, ind) {
    const guard = node.length === 4 ? node[2] : null;
    const body = node[node.length - 1];
    this.mark(node, '$self', () => {
      this.b.emit('while (');
      this.mark(node, 'condition', () => this.expr(node[1]));
      this.b.emit(') ');
      if (guard !== null) {
        const stmts = this.isBlock(body) ? body.slice(1) : body;
        this.b.emit('{\n' + '  '.repeat(ind + 1) + 'if (');
        this.expr(guard);
        this.b.emit(') {\n');
        this.mark(node, 'body', () => this.statements(stmts, ind + 2, 'block'));
        this.b.emit('  '.repeat(ind + 1) + '}\n' + '  '.repeat(ind) + '}');
        return;
      }
      // A postfix loop carries a PLAIN [statement] array (the
      // postfix-if convention) and emits BRACED, single-statement
      // (unlike postfix-if's braceless line).
      if (!this.isBlock(body) && isNode(body)) {
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
    // A postfix conditional carries a PLAIN statement array (not a block
    // node) and emits braceless on one line: `if (a) b = 1;`.
    // A reactive declaration can never be the guarded statement — every
    // block-nested declaration rejects at frame collection (#88).
    if (!this.isBlock(node[2]) && isNode(node[2])) {
      const stmt = node[2][0];
      // A guarded LOOP emits braced: a loop may open with a hoisted
      // temp (`const _ref = …;` ahead of `for (… in _ref)`), and a
      // braceless `if` would guard only that first statement.
      const braced = isNode(stmt) && Emitter.LOOP_HEADS.has(stmt[0]);
      this.mark(node, '$self', () => {
        this.b.emit('if (');
        this.mark(node, 'condition', () => this.expr(node[1]));
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

  static LOOP_HEADS = new Set(['for-in', 'for-of', 'for-as', 'while', 'loop', 'comprehension']);

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
      this.mark(node, 'value', () => this.expr(node[1]));
    });
    this.b.emit(';');
  }

  // `into`: the accumulator of a collecting loop whose tail this try
  // is — the body and each handler collect their own tails, and a
  // swallowed throw collects `undefined`, as the value form yields.
  tryStatement(node, ind, into = null) {
    const block = (body) => (into === null ? this.braceBlock(body, ind) : this.accumulateBlock(body, ind, into));
    this.mark(node, '$self', () => {
      this.b.emit('try ');
      // An inline body (`try f()`) is its own one-statement block; a
      // handler-less try gains `catch {}` — JS requires a handler or
      // finalizer, and the bare form's contract is to swallow.
      const body = this.isBlock(node[1]) ? node[1] : ['block', node[1]];
      this.mark(node, 'body', () => block(body));
      if (node.length === 2) {
        if (into === null) this.b.emit(' catch {}');
        else this.b.emit(' catch {\n' + '  '.repeat(ind + 1) + `${into}.push(undefined);\n` + '  '.repeat(ind) + '}');
      }
      // A catch node is the handler; a block is the finalizer.
      for (const part of node.slice(2)) {
        if (!isNode(part)) continue;
        if (this.isBlock(part)) {
          this.b.emit(' finally ');
          this.braceBlock(part, ind);
        } else {
          const [, binding, body] = part;
          if (binding === null) {
            this.b.emit(' catch ');
            block(body);
          } else if (Emitter.isPattern(binding)) {
            // The catch-pattern lowering: bind `error`, destructure as
            // the handler's first statement (paren-wrapped for both
            // pattern kinds). The names hoist at the enclosing scope —
            // for BOTH kinds, which is why the write check runs here.
            this.checkExportedConstWrite(part, binding); this.checkImportWrite(part, binding);
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
            this.mark(part, 'binding', () => this.withPattern(() => this.expr(binding)));
            this.b.emit(` = ${param});\n`);
            if (into === null) this.statements(this.isBlock(body) ? body.slice(1) : [body], ind + 1, 'block');
            else this.accumulateBody(this.isBlock(body) ? body : ['block', body], ind, into);
            this.b.emit('  '.repeat(ind) + '}');
          } else if (Emitter.isTypedWrapper(binding)) {
            // An annotated binding (`catch error: any`): the name is the
            // JS parameter and the annotation is the face's alone.
            this.b.emit(' catch (');
            this.mark(part, 'binding', () => this.emitParam(binding));
            this.b.emit(') ');
            this.withBindings([binding[1]], () => block(body));
          } else {
            this.b.emit(' catch (');
            this.mark(part, 'binding', () => this.b.emit(binding));
            this.b.emit(') ');
            // The binding is a new name for the handler — it shadows a
            // same-named reactive declaration.
            this.withBindings([binding], () => block(body));
          }
        }
      }
    });
  }

  defStatement(node, ind) {
    // A void def (head 'void-def') suppresses the implicit return;
    // its voidMarker role (side-band) covers the whole emitted
    // function — the bang's only generated manifestation. The
    // return-type role (side-band) covers it the same way;
    // mark() is a no-op for rows without the role.
    const isVoid = node[0] === 'void-def';
    if (typeof node[1] !== 'string') {
      throw this.positionedError(node, "emitter: `def @name` declares a static class method — spell it inside a class body");
    }
    const isAsync = this.containsAwait(node[3]);
    const isGen = Emitter.containsYield(node[3]);
    // TS face: recorded overload signatures print immediately above
    // the implementation, outside its covers.
    this.tsOverloadSigs(node, ind);
    this.mark(node, 'voidMarker', () => this.mark(node, 'returnType', () => this.mark(node, '$self', () => {
      if (isAsync) this.b.emit('async ');
      this.b.emit(isGen ? 'function* ' : 'function ');
      this.mark(node, 'name', () => this.b.emit(node[1]));
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
        this.mark(node[2], '$self', () => this.emitParams(node[2]));
        this.b.emit(')');
      });
      this.tsReturnAnnotation(node, isAsync, isVoid, isGen);
      this.b.emit(' ');
      const stmts = this.liveStmts(this.isBlock(node[3]) ? node[3].slice(1) : [node[3]]);
      const { entries, names } = this.scopedHoist(this.isBlock(node[3]) ? node[3].slice(1) : [node[3]], node[2]);
      for (const n of this.pushReactiveFrame(stmts, names, node)) names.add(n);
      this.scopes.push(names);
      this.rejectUnboundIt(node[2], node[3]);
      // def bodies implicitly return their last expression, same as
      // arrow functions — unless the def is void.
      this.funcBlock(node, node[3], stmts, ind, entries, isVoid);
      this.scopes.pop();
      this.rframes.pop();
    })));
  }

  returnStatement(node) {
    // Outside any function a `return` has no target — the emitted
    // module would fail at load, which is the loud error in the
    // wrong place.
    if (this.scopes.length <= 1) {
      throw this.positionedError(node, "emitter: 'return' outside a function");
    }
    // A void function's body cannot return a value — the `!` on its
    // definition declares it returns undefined. Bare
    // `return` stays legal.
    if (node.length === 2 && this.sideEffectOnly) {
      throw this.positionedError(node, `emitter: cannot return a value from a void function (${this.voidReason ?? "the trailing '!' on its definition suppresses returns"})`);
    }
    this.mark(node, '$self', () => {
      this.b.emit('return');
      if (node.length === 2) {
        this.b.emit(' ');
        this.grouped(node, 'value', node[1], Emitter.needsGrouping(node[1], 'return'));
      }
    });
    this.b.emit(';');
  }

  braceBlock(blockNode, ind, hoist = []) {
    const stmts = this.isBlock(blockNode) ? blockNode.slice(1) : [blockNode];
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
    const ret = guard[2];
    const kind = typeof ret === 'string' ? ret : ret[0];
    if (kind === 'return' && this.scopes.length <= 1) {
      throw this.positionedError(ret, "emitter: 'return' outside a function");
    }
    if ((kind === 'break' && this.ctrlDepth === 0) || (kind === 'continue' && this.loopDepth === 0)) {
      throw this.positionedError(guard, `emitter: '${kind}' outside a loop${kind === 'break' ? ' or switch' : ''}`);
    }
    const op = guard[0];
    const emitCond = () => {
      const inner = () => {
        if (assign !== null) {
          this.mark(assign, '$self', () => {
            this.mark(assign, 'target', () => this.b.emit(assign[1]));
            this.b.emit(' ');
            this.mark(assign, 'operator', () => this.b.emit('='));
            this.b.emit(' ');
            this.mark(assign, 'value', () => this.expr(guard[1]));
          });
        } else {
          this.mark(guard, 'left', () => this.expr(guard[1]));
        }
      };
      // An assignment (or any non-primary operand) parenthesizes
      // inside the condition; a plain name or call reads bare.
      const grouped = assign !== null || Emitter.jsTier(guard[1]) !== 'primary';
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
      const emitJump = () => {
        this.b.emit(kind);
        if (isNode(ret) && ret.length > 1) {
          this.b.emit(' ');
          this.mark(ret, 'value', () => {
            if (ret[0] === 'return' && Emitter.needsGrouping(ret[1], 'return')) {
              this.b.emit('('); this.expr(ret[1]); this.b.emit(')');
            } else this.expr(ret[1]);
          });
        }
      };
      if (typeof ret === 'string') emitJump();
      else this.mark(ret, '$self', emitJump);
      this.b.emit(';');
    });
  }
}
