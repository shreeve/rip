// Loops and comprehensions: loop bindings and their checks, for-in,
// for-of, for-as, guarded bodies and comprehension lowering.
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

import { isList, isNode, isNone, isStruct, wordOf } from '../sexpr.js';
import { ASSIGNS } from './helpers.js';
import { isComprehensionNode, isFunc, isRange, isSourceLoop, isUpdate } from './tree.js';
import { Emitter } from './core.js';
import { referencesNames } from './walks.js';

export class LoopMethods {
  // A source loop is ["loop", {over}, vars, iterable, step, guard,
  // body]; a comprehension's clause is the same node without a body.
  // Loop variables are new bindings for the loop's whole emission —
  // they shadow same-named reactive declarations (a frame per loop).
  loopBindingNames(node) {
    if (isNode(node) && node[0] === 'loop' && node[1].over === 'times') return ['it'];
    const clause = isSourceLoop(node) ? node : isComprehensionNode(node) ? node[3] : null;
    if (clause === null) return [];
    const vars = clause[2];
    // A loop that binds NO variable has no coherent emission — the
    // var-less ranged spelling (`for [1...3]`) reaches here with an
    // empty vars list and would otherwise compile to a for-of against
    // nothing. The repeat idiom takes a binding.
    if (vars.length === 0) {
      throw this.positionedError(node, "emitter: a for loop binds no variable — spell a bare repeat with a binding (`for i in [1...3]`)");
    }
    const names = [];
    for (const v of vars) this.patternNames(v, names, true);
    this.checkLoopSource(clause, names);
    this.checkLoopGuard(clause[5], names);
    return names;
  }

  // A loop's emission: its variables bound (shadowing same-named
  // reactive declarations) and its body inside the loop's control
  // context and live scope.
  inLoop(node, fn) {
    this.withBindings(this.loopBindingNames(node), () => this.inCtrl(fn));
  }

  // A guard runs every iteration, so a write to a loop variable there
  // resets the loop instead of filtering it: `for i in [0...6] by 2 when
  // (i = 1)` never ends.
  checkLoopGuard(guard, names) {
    if (names.length === 0) return;
    const write = Emitter.loopVarWrite(guard, new Set(names), (p) => this.patternNames(p, [], false));
    if (write !== null) {
      throw this.positionedError(write.node,
        `emitter: a loop guard cannot write the loop variable '${write.name}' — the guard runs every iteration, so the ` +
        "write resets the loop instead of filtering it; compare with '==', or assign in the body");
    }
  }

  // A loop's source and step evaluate once, as the loop starts, inside
  // the scope of the names its `for (let …)` header declares, and a
  // source the body re-reads (no `_ref` binds it first) also sits under
  // the body's own `let`. Such a source or step cannot reach an outer
  // binding of those names: a read lands in the temporal dead zone, or
  // reads the loop's start value instead (`by x` steps by 0), and a write
  // moves the loop (`by (i = 2)` starts at 2). Each rejects at the source
  // or the step. A write to any loop variable from the step rejects too.
  checkLoopSource(loop, names) {
    if (names.length === 0) return;
    const [, { over, own }, vars, source] = loop;
    const namesOf = (v) => this.patternNames(v, [], true);
    const ranged = over === 'in' && isRange(source);
    const step = over === 'in' && !isNone(loop[4]) ? loop[4] : null;
    let header, body = [];
    if (over === 'of') {
      const rereads = own === true || vars.length === 2;
      if (rereads && !this.singleReadIterable(source)) return this.checkLoopStep(loop, step, new Set(), names);
      header = namesOf(vars[0]);
      if (vars.length === 2) body = namesOf(vars[1]);
    } else if (over === 'in' && !ranged && (step !== null || vars.length === 2)) {
      header = vars.length === 2 ? namesOf(vars[1]) : [];
      if (this.singleReadIterable(source)) body = namesOf(vars[0]);
    } else header = names;
    const hidden = [...header, ...body];
    const hit = hidden.find((n) => referencesNames(source, new Set([n]), this.stores)) ??
      Emitter.loopVarWrite(source, new Set(hidden), (p) => this.patternNames(p, [], false))?.name;
    if (hit !== undefined) {
      throw this.loopPartError(loop, source, ['iterable', 'object'],
        `emitter: the loop variable '${hit}' is read in its own source — the loop binds '${hit}' before ` +
        `its source evaluates, so the source cannot reach an outer '${hit}'; rename the loop variable`);
    }
    this.checkLoopStep(loop, step, new Set(ranged ? names : header), names);
  }

  checkLoopStep(loop, step, header, names) {
    if (step === null) return;
    const write = Emitter.loopVarWrite(step, new Set(names), (p) => this.patternNames(p, [], false));
    if (write !== null) {
      throw this.positionedError(write.node,
        `emitter: a loop step cannot write the loop variable '${write.name}' — the step evaluates once, as the loop ` +
        `starts, where '${write.name}' is already the loop's own binding, so the write moves the loop instead of ` +
        'computing its step; compute the step first and loop `by` that name', loop);
    }
    const read = [...header].find((n) => referencesNames(step, new Set([n]), this.stores));
    if (read !== undefined) {
      throw this.loopPartError(loop, step, ['step'],
        `emitter: a loop step cannot read the loop variable '${read}' — the step evaluates once, as the ` +
        `loop starts, where '${read}' is already the loop's own binding, not an outer '${read}'; compute the step into ` +
        'another name first');
    }
  }

  // An error positioned at the loop's first recorded role of `roles`,
  // or at `part` itself.
  loopPartError(loop, part, roles, message) {
    const id = this.stores.idOf(loop);
    for (const role of id !== null ? roles : []) {
      const row = this.stores.role(id, role);
      if (row === null) continue;
      if (typeof row.sourceStart === 'number') return this.positionedErrorAt(row.sourceStart, row.sourceEnd, message);
      break;
    }
    return this.positionedError(part, message, loop);
  }

  // The first write to one of `names` inside an expression, with the
  // written name. A closure writes the enclosing binding unless a
  // parameter of its own shadows the name.
  static loopVarWrite(x, names, targetNames) {
    if (names.size === 0) return null;
    if (isList(x)) {
      for (const el of x) {
        const hit = Emitter.loopVarWrite(el, names, targetNames);
        if (hit !== null) return hit;
      }
      return null;
    }
    if (!isStruct(x) || x[0] === 'class') return null;
    if (isFunc(x) || x[0] === 'def') {
      const params = isFunc(x) ? x[2] : x[3];
      const shadowed = new Set();
      for (const p of params) {
        const core = Emitter.paramCore(p);
        try { for (const n of targetNames(core)) shadowed.add(n); } catch { /* not a pattern */ }
        const w = wordOf(p);
        if (w !== undefined) shadowed.add(w);
      }
      const live = new Set([...names].filter((n) => !shadowed.has(n)));
      return Emitter.loopVarWrite(isFunc(x) ? x[3] : x[4], live, targetNames);
    }
    if (ASSIGNS.has(x[0]) && x.length === 4) {
      let targets = [];
      const w = wordOf(x[2]);
      try { targets = w !== undefined ? [w] : targetNames(x[2]); } catch { targets = []; }
      const name = targets.find((n) => names.has(n));
      if (name !== undefined) return { node: x, name };
    }
    if (isUpdate(x) && names.has(wordOf(x[2]))) return { node: x, name: wordOf(x[2]) };
    for (let i = 2; i < x.length; i++) {
      const hit = Emitter.loopVarWrite(x[i], names, targetNames);
      if (hit !== null) return hit;
    }
    return null;
  }

  // A for…of pattern KEY has no name, so the forms that read the key
  // by name cannot lower it: the `own` hasOwn filter and a value
  // binding's `obj[key]` index both reject.
  checkForOfPatternKey(vars, own) {
    if (!isStruct(vars[0])) return;
    if (own) {
      throw this.positionedError(vars[0], "emitter: a for…of pattern key cannot combine with 'own' — the hasOwn filter reads the key by name (name the key and destructure the value slot)");
    }
    if (vars.length === 2) {
      throw this.positionedError(vars[0], 'emitter: a for…of pattern key cannot combine with a value variable — the value binding indexes the object by the key name (name the key and destructure the value slot)');
    }
  }

  // The statement for-loops: the header is clauseHeader's, which every
  // loop clause shares; a loop whose header leaves body-top setups (the
  // value binding of an indexed, stepped, own or two-variable loop) lays
  // its body out flat beneath them.
  forIn(node, ind) {
    this.forLoop(node, ind);
  }

  // A for…of pattern key's rejection outranks the loop-variable checks.
  forOf(node, ind) {
    this.checkForOfPatternKey(node[2], node[1].own === true);
    this.forLoop(node, ind);
  }

  forAs(node, ind) {
    this.forLoop(node, ind);
  }

  forLoop(node, ind) {
    const [, { over }, , , step, guard, body] = node;
    this.inLoop(node, () => this.mark(node, '$self', () => {
      const setups = this.clauseHeader(node, node, '  '.repeat(ind));
      if (setups.length === 0) {
        this.b.emit(' ');
        this.guardedBlock(body, guard, ind);
        return;
      }
      this.b.emit(' {\n');
      if (over === 'in' && isNone(step)) {
        // The indexed loop keeps its body at the loop's indentation.
        const pad = '  '.repeat(ind + 1);
        this.emitSetups(setups, pad);
        if (!isNone(guard)) {
          this.b.emit(pad + 'if (');
          this.expr(guard);
          this.b.emit(') ');
          this.braceBlock(body, ind + 1);
          this.b.emit('\n');
        } else {
          this.bodyLines(body, ind);
        }
        this.b.emit('  '.repeat(ind) + '}');
        return;
      }
      this.emitSetups(setups, '');
      this.flatBody(body, guard, over === 'in' ? '    ' : '');
      this.b.emit('}');
    }));
  }

  // Each body-top setup on its own line at `pad`.
  emitSetups(setups, pad) {
    for (const setup of setups) {
      this.b.emit(pad);
      setup();
      this.b.emit('\n');
    }
  }

  // Loop body at normal indentation, wrapping in the guard `if` when one
  // exists (single-parenthesized in block loops).
  guardedBlock(body, guard, ind) {
    if (isNone(guard)) {
      this.braceBlock(body, ind);
      return;
    }
    this.b.emit('{\n' + '  '.repeat(ind + 1) + 'if (');
    this.expr(guard);
    this.b.emit(') ');
    this.braceBlock(body, ind + 1);
    this.b.emit('\n' + '  '.repeat(ind) + '}');
  }

  // Unindented body lines (the stepped/own/kv loop quirk). A guard
  // wraps the body in `if (…) {` — compound guards double-parenthesize —
  // with the guarded body at guardBodyPad (4 spaces in stepped
  // loops, none in of-loops) and the close at 2.
  flatBody(body, guard, guardBodyPad) {
    const all = this.isBlock(body) ? body.slice(2) : [body];
    const stmts = this.liveStmts(all);
    this.emitTsTypeDecls(all, '');
    if (!isNone(guard)) {
      this.guardOpen(guard);
      for (const stmt of stmts) {
        this.b.emit(guardBodyPad);
        this.statement(stmt, 0);
        this.b.emit('\n');
      }
      this.b.emit('  }\n');
      return;
    }
    for (const stmt of stmts) {
      this.statement(stmt, 0);
      this.b.emit('\n');
    }
  }

  // Indented body lines following an injected let-binding line.
  bodyLines(body, ind) {
    const all = this.isBlock(body) ? body.slice(2) : [body];
    const stmts = this.liveStmts(all);
    this.emitTsTypeDecls(all, '  '.repeat(ind + 1));
    for (const stmt of stmts) {
      this.b.emit('  '.repeat(ind + 1));
      this.statement(stmt, ind + 1);
      this.b.emit('\n');
    }
  }

  // A guard opening: `if (<guard>) {` — the guard is a value position
  // (compounds group).
  guardOpen(guard) {
    this.b.emit('if (');
    this.emitOperand(guard);
    this.b.emit(') {\n');
  }

  // A loop variable's declaring occurrence: a name, or a pattern.
  markLoopVar(node, v) {
    this.mark(node, 'vars', () => (wordOf(v) !== undefined ? this.emitLeaf(v) : this.withPattern(() => this.expr(v), true)));
  }

  // One loop clause (a source loop, or a comprehension's clause): emits
  // the `for (…)` header (no brace) and returns the body-top setup
  // emitters — the hasOwn continue (own for-of), the value binding
  // (two-variable for-of, indexed or stepped for-in) — one line each,
  // indentation owned by the caller. `node` supplies role marks: the
  // loop itself, or a comprehension, whose clause carries no roles, so
  // its marks fall back to plain emission.
  clauseHeader(node, clause, pad = null) {
    const { over } = clause[1];
    if (over === 'of') return this.ofHeader(node, clause, pad);
    if (over === 'as') return this.asHeader(node, clause);
    return this.inHeader(node, clause);
  }

  ofHeader(node, clause, pad) {
    const [, { own }, vars, iter] = clause;
    const markVar = (v) => this.markLoopVar(node, v);
    this.checkForOfPatternKey(vars, own === true);
    // An impure object the own-filter or value line would re-read
    // binds once ahead of the header (the caller's pad restores the
    // line); a header-only read never needs it.
    const rereads = own === true || vars.length === 2;
    const it = rereads && !this.singleReadIterable(iter) ? this.loopTempName('_ref') : null;
    if (it !== null) {
      // A scope-level const claims its name for the whole compile
      // (a for-header temp is reserved only while its loop emits).
      this.temps.used.add(it);
      this.b.emit(`const ${it} = `);
      this.mark(node, 'object', () => this.expr(iter));
      this.b.emit(`;\n${pad ?? ''}`);
    }
    const ref = () => { if (it) this.b.emit(it); else this.expr(iter); };
    this.b.emit('for (let ');
    markVar(vars[0]);
    this.b.emit(' in ');
    if (it) this.b.emit(it);
    else this.mark(node, 'object', () => this.expr(iter));
    this.b.emit(')');
    const setups = [];
    if (own === true) {
      setups.push(() => {
        this.b.emit('if (!Object.hasOwn(');
        ref();
        this.b.emit(`, ${wordOf(vars[0])})) continue;`);
      });
    }
    if (vars.length === 2) {
      setups.push(() => {
        this.b.emit('let ');
        markVar(vars[1]);
        this.b.emit(' = ');
        ref();
        this.b.emit(`[${wordOf(vars[0])}];`);
      });
    }
    return setups;
  }

  asHeader(node, clause) {
    const [, { await: isAwait }, vars, iter] = clause;
    // ONE loop variable, enforced HERE because every for-as form —
    // statement, value/statement comprehension, accumulator IIFE,
    // tail accumulator — flows through this clause emitter: the
    // iterator protocol yields single values, so a second variable
    // would bind nothing and the emitted program would silently
    // read an unrelated outer binding.
    if (vars.length !== 1) {
      throw this.positionedError(node, 'emitter: for-as takes ONE loop variable — the iterator protocol yields single values (destructure with a pattern instead)');
    }
    // An awaited for-as carries its await in a flag, not a node.
    if (isAwait === true) this.renderSyncGuard(node);
    this.b.emit(isAwait === true ? 'for await (let ' : 'for (let ');
    this.markLoopVar(node, vars[0]);
    this.b.emit(' of ');
    this.mark(node, 'iterable', () => this.expr(iter));
    this.b.emit(')');
    return [];
  }

  // for-in: ranged, indexed (a second loop variable or a step), or a
  // plain for-of over the iterable.
  inHeader(node, clause) {
    const [, , vars, iter] = clause;
    const step = isNone(clause[4]) ? null : clause[4];
    if (isStruct(vars[0]) && (isRange(iter) || step !== null)) {
      throw this.positionedError(node, 'emitter: pattern loop variables with ranges or BY steps are not supported yet');
    }
    if (isRange(iter)) {
      this.rangedHeader(node, (v) => this.markLoopVar(node, v), vars, iter, step);
      return [];
    }
    if (step !== null || vars.length === 2) return [this.indexedHeader(node, vars, iter, step)];
    this.b.emit('for (let ');
    this.markLoopVar(node, vars[0]);
    this.b.emit(' of ');
    this.mark(node, 'iterable', () => this.expr(iter));
    this.b.emit(')');
    return [];
  }

  // Ranged for, every form. Direction: a literal step's sign decides
  // (positive ascends, negative descends, zero rejects — it never
  // advances); a variable step binds ONCE and the header tests its
  // sign; with no step, two literal bounds decide statically and any
  // variable bound ascends (`by -1` descends). Impure bounds bind once
  // beside the counter. A second loop variable is the iteration index.
  rangedHeader(node, markVar, vars, iter, step) {
    const [dots, , from, to] = iter;
    const cmpUp = dots === '..' ? '<=' : '<';
    const cmpDown = dots === '..' ? '>=' : '>';
    const signedText = (x) => numText(x) ??
      (isNode(x) && (x[0] === '+' || x[0] === '-') && x.length === 3 && numText(x[2]) !== null
        ? `${x[0] === '-' ? '-' : ''}${numText(x[2])}`
        : null);
    const literal = (x) => {
      const text = signedText(x);
      return text === null ? null : Number(text.replace(/_/g, ''));
    };
    const stepLit = step === null ? null : literal(step);
    if (stepLit === 0) {
      throw this.positionedError(node, 'emitter: a BY step of 0 never advances the loop');
    }
    const fromLit = literal(from);
    const toLit = literal(to);
    const descends = step === null
      ? fromLit !== null && toLit !== null && fromLit > toLit
      : stepLit !== null && stepLit < 0;
    const v = wordOf(vars[0]);
    const idx = vars.length === 2 ? wordOf(vars[1]) : null;
    const toRef = toLit !== null || this.singleReadIterable(to) ? null : this.liveTemp('_ref');
    const stepRef = step === null || stepLit !== null ? null : this.liveTemp('_step');
    this.b.emit('for (let ');
    markVar(vars[0]);
    this.b.emit(' = ');
    this.expr(from);
    if (toRef !== null) { this.b.emit(`, ${toRef} = `); this.expr(to); }
    if (stepRef !== null) { this.b.emit(`, ${stepRef} = `); this.mark(node, 'step', () => this.expr(step)); }
    if (idx !== null) { this.b.emit(', '); markVar(vars[1]); this.b.emit(' = 0'); }
    const toText = () => { if (toRef !== null) this.b.emit(toRef); else this.expr(to); };
    const advance = () => {
      if (stepRef !== null) this.b.emit(`${v} += ${stepRef}`);
      else if (step === null) this.b.emit(descends ? `${v}--` : `${v}++`);
      else {
        this.b.emit(`${v} ${descends ? '-=' : '+='} `);
        this.mark(node, 'step', () => this.b.emit(String(Math.abs(stepLit))));
      }
      if (idx !== null) this.b.emit(`, ${idx}++`);
    };
    this.b.emit('; ');
    if (stepRef !== null) {
      this.b.emit(`${stepRef} > 0 ? ${v} ${cmpUp} `);
      toText();
      this.b.emit(` : ${v} ${cmpDown} `);
      toText();
    } else {
      this.b.emit(`${v} ${descends ? cmpDown : cmpUp} `);
      toText();
    }
    this.b.emit('; ');
    advance();
    this.b.emit(')');
  }

  // An indexed for-in counts an index over its iterable — the second
  // loop variable when the loop spells one (`for t, i in xs by -1`),
  // `_i` otherwise — and returns the setup binding the first variable to
  // the element. A LITERAL step's direction is static: positive literals
  // ascend, `-`-literals walk DOWN from the end (an ascending header with
  // a negative step would never terminate), and a zero literal rejects —
  // it never advances the loop. Every OTHER step expression has runtime
  // sign: it evaluates ONCE into `_step` and the header tests that sign,
  // so both directions terminate and a zero step iterates nothing.
  indexedHeader(node, vars, iter, step) {
    const idx = vars.length === 2 ? wordOf(vars[1]) : this.liveTemp('_i');
    // The index name's DECLARING occurrence is a source variable only when the
    // loop spells one; every later `${idx}` in the header is emitter
    // arithmetic on that binding, not another read of the source.
    const declIdx = () => { if (vars.length === 2) this.markLoopVar(node, vars[1]); else this.b.emit(idx); };
    const posLit = numText(step) ?? (isNode(step) && step[0] === '+' && step.length === 3 ? numText(step[2]) : null);
    const negLit = isNode(step) && step[0] === '-' && step.length === 3 ? numText(step[2]) : null;
    if ((posLit ?? negLit) !== null && Number((posLit ?? negLit).replace(/_/g, '')) === 0) {
      throw this.positionedError(node, 'emitter: a BY step of 0 never advances the loop');
    }
    // An impure iterable binds ONCE in the init; every later read
    // (bounds, element) uses the binding.
    const it = this.singleReadIterable(iter) ? null : this.liveTemp('_ref');
    const read = this.indexedReader(node, vars, iter);
    const bind = () => { if (it) { this.b.emit(`${it} = `); read(); this.b.emit(', '); } };
    const ref = () => { if (it) this.b.emit(it); else read(); };
    if (step === null || posLit !== null) {
      this.b.emit('for (let ');
      bind();
      declIdx();
      this.b.emit(` = 0; ${idx} < `);
      ref();
      this.b.emit('.length; ');
      if (step === null) {
        this.b.emit(`${idx}++`);
      } else if (wordOf(step) === '1') {
        this.mark(node, 'step', () => this.b.emit(`${idx}++`));
      } else {
        this.b.emit(`${idx} += `);
        // A `+`-headed literal step is a unary and groups as an
        // operand (`_i += (+2)`).
        this.grouped(node, 'step', step, Emitter.needsGrouping(step, 'operand'));
      }
    } else if (negLit !== null) {
      this.b.emit('for (let ');
      bind();
      declIdx();
      this.b.emit(' = ');
      ref();
      this.b.emit(`.length - 1; ${idx} >= 0; `);
      if (negLit === '1') {
        this.mark(node, 'step', () => this.b.emit(`${idx}--`));
      } else {
        this.b.emit(`${idx} += `);
        this.mark(node, 'step', () => {
          this.b.emit('(-');
          this.expr(step[2]);
          this.b.emit(')');
        });
      }
    } else {
      const stp = this.liveTemp('_step');
      this.b.emit(`for (let ${stp} = `);
      this.mark(node, 'step', () => this.expr(step));
      this.b.emit(', ');
      bind();
      declIdx();
      this.b.emit(` = ${stp} > 0 ? 0 : `);
      ref();
      this.b.emit(`.length - 1; ${stp} > 0 ? ${idx} < `);
      ref();
      this.b.emit(`.length : ${stp} < 0 && ${idx} >= 0; ${idx} += ${stp}`);
    }
    this.b.emit(')');
    return () => {
      this.b.emit('let ');
      this.markLoopVar(node, vars[0]);
      this.b.emit(' = ');
      ref();
      this.b.emit(`[${idx}];`);
    };
  }

  // `for k, v in xs` and `for x in xs by n` INDEX their iterable: the
  // header reads its `.length` and the body reads its `[i]`, and
  // JavaScript admits both on anything. A record admits them too — its
  // index signature types `.length` as a number — so `for k, v in record`
  // checks clean and runs zero times. The TS face wraps every read of the
  // iterable these headers make in `__ripIndexed(…)`, whose parameter
  // refuses a type that is neither iterable nor array-like (the declare
  // at the emit tail) and whose result is the argument's own type, so a
  // loop that passes types exactly as before. The refusal is one TS2345
  // per read; the first read's record carries the report and the others
  // drop (mapTsDiagnostic), so a loop reports once, on its head, in the
  // loop's own words. TS-only: the JS bytes are untouched. A scratch
  // capture (capturedExprText) re-emits bytes the real pass already
  // wrapped and reported, with no source to word a record from, so it
  // reads plain. Returns the emitter for one read of the iterable.
  indexedReader(node, vars, iter) {
    const id = this.ts && this.b.source !== null ? this.stores.idOf(node) : null;
    const self = id !== null ? this.stores.selfSpan(id) : null;
    if (self === null) return () => this.expr(iter);
    const roleSpan = (role) => {
      const r = this.stores.role(id, role);
      return r?.sourceStart != null ? [r.sourceStart, r.sourceEnd] : null;
    };
    const squash = (s) => s.replace(/\s+/g, ' ').trim();
    const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
    const plainVars = vars.length === 2 && vars.every((v) => wordOf(v) !== undefined);
    let head, iterText, names;
    if (roleSpan('iterable') !== null) {
      const tail = roleSpan('step') ?? roleSpan('iterable');
      head = [self[0], tail[1]];
      const iterSpan = roleSpan('iterable');
      iterText = clip(squash(this.b.source.slice(iterSpan[0], iterSpan[1])), 40);
      const varsSpan = roleSpan('vars');
      names = plainVars && varsSpan !== null ? squash(this.b.source.slice(varsSpan[0], varsSpan[1])) : 'key, value';
    } else {
      // A comprehension's clause carries no roles of its own: its node is
      // the comprehension, whose span opens on the value. The clause is
      // the text from its `for`, the last one in the span, and its parts
      // are read off that text.
      const text = this.b.source.slice(self[0], self[1]);
      const at = Math.max(0, text.search(/\bfor\b(?![\s\S]*\bfor\b)/));
      head = [self[0] + at, self[1]];
      const m = /^for\s+([\s\S]+?)\s+in\s+([\s\S]+?)(?:\s+(?:when|by)\b[\s\S]*)?$/.exec(text.slice(at));
      iterText = m !== null ? clip(squash(m[2]), 40) : '…';
      names = plainVars && m !== null ? squash(m[1]) : 'key, value';
    }
    const construct = clip(squash(this.b.source.slice(head[0], head[1])), 60);
    const of = `for ${names} of ${iterText}`;
    let report = true;
    return () => {
      this._needsIndexedHelper = true;
      const wrapStart = this.b.offset;
      this.b.tsOnly(() => this.b.emit('__ripIndexed('));
      const start = this.b.offset;
      this.expr(iter);
      const value = [start, this.b.offset];
      this.b.tsOnly(() => this.b.emit(')'));
      // `wrap` is the whole call: a complaint the checker makes about the
      // call's VALUE (a nullish iterable, an unknown one) stands there, and
      // re-anchors on the iterable the author wrote (mapTsDiagnostic).
      this.indexedLoops.push({ value, wrap: [wrapStart, this.b.offset], head, construct, of, report });
      report = false;
    };
  }

  // ["comprehension", {}, value, clause] — an IIFE with result
  // accumulation; the clause carries the guard. `keySpec` picks the
  // accumulator: null builds an array (`result.push(expr)`), a key (or
  // a {expr, pair, keyNode} record marking its pair) builds an object
  // (`result[key] = expr` — the object-comprehension form).
  comprehension(node, ind, keySpec = null) {
    this.inLoop(node, () => this.comprehensionBody(node, ind, keySpec));
  }

  comprehensionBody(node, ind, keySpec) {
    const [, , expr, clause] = node;
    const guard = clause[5];
    this.checkChainedClauses(node);
    // The value is an operand position either way (compounds group),
    // with the grouping outside its mark.
    const wrapValue = Emitter.needsGrouping(expr, 'operand') || isUpdate(expr);
    const emitValue = () => {
      if (wrapValue) this.b.emit('(');
      this.mark(node, 'value', () => this.expr(expr));
      if (wrapValue) this.b.emit(')');
    };
    const keyExpr = keySpec?.expr ?? keySpec;
    const pad = '  '.repeat(ind);
    this.rejectYieldInIIFE(node);
    this.mark(node, '$self', () => {
      this.b.emit(this.containsAwait(node) ? 'await (async () => {\n' : '(() => {\n');
      const acc = this.liveTemp('result');
      this.b.emit(`${pad}  const ${acc} = ${keyExpr === null ? '[]' : '{}'};\n`);
      this.b.emit(`${pad}  `);
      const setups = this.clauseHeader(node, clause, `${pad}  `);
      this.b.emit(' {\n');
      let inner = `${pad}    `;
      this.emitSetups(setups, inner);
      if (!isNone(guard)) {
        this.b.emit(inner);
        this.guardOpen(guard);
        inner += '  ';
      }
      if (keyExpr === null) {
        this.b.emit(`${inner}${acc}.push(`);
        emitValue();
        this.b.emit(');\n');
      } else {
        // Every dynamic key materializes as an OWN data property: a
        // '__proto__' key or inherited setter must never intercept the
        // write. The intrinsic seam performs ToPropertyKey exactly once
        // and yields the resulting string or symbol before the value
        // evaluates, without resolving capturable source bindings.
        const kt = this.liveTemp('_k');
        const vt = this.liveTemp('_v');
        this.b.emit(`${inner}const ${kt} = ${this.runtimeName('__toPropertyKey')}(`);
        // A string key is an identifier read (it routes through expr,
        // so a reactive key unwraps — `result[count.value]`;
        // loop variables are frame-bound and stay bare); a node
        // key is the dynamicKey's inner expression.
        const wrapKey = isStruct(keyExpr) && (Emitter.needsGrouping(keyExpr, 'operand') || isUpdate(keyExpr));
        const emitKey = () => {
          if (wrapKey) this.b.emit('(');
          this.expr(keyExpr);
          if (wrapKey) this.b.emit(')');
        };
        if (keySpec?.pair !== undefined) {
          if (keySpec.keyNode !== null) {
            this.mark(keySpec.pair, 'key', () =>
              this.mark(keySpec.keyNode, '$self', () =>
                this.mark(keySpec.keyNode, 'key', emitKey)));
          } else {
            this.mark(keySpec.pair, 'key', emitKey);
          }
        } else emitKey();
        this.b.emit(`), ${vt} = `);
        emitValue();
        this.b.emit(';\n');
        this.b.emit(`${inner}${this.runtimeName('__defineOwnDataProperty')}(${acc}, ${kt}, ${vt});\n`);
      }
      if (!isNone(guard)) this.b.emit(`${pad}    }\n`);
      this.b.emit(`${pad}  }\n`);
      this.b.emit(`${pad}  return ${acc};\n`);
      this.b.emit(`${pad}})()`);
    });
  }

  // Chained clauses nest: `v for a in as for b in bs` parses as
  // `(v for a in as) for b in bs`, so the LAST clause is the outer
  // loop. A later clause that reads a name only an earlier clause binds
  // therefore reads it unbound — the spelling of someone expecting the
  // clauses to flatten in written order. Independent clauses build the
  // nested array they say.
  checkChainedClauses(node) {
    const [, , expr, clause] = node;
    if (!isComprehensionNode(expr) || expr.parenthesized) return;
    const earlier = [];
    for (let c = expr; isComprehensionNode(c) && !c.parenthesized; c = c[2]) {
      earlier.push(...this.loopBindingNames(c));
    }
    const reads = new Set();
    this.bareReads(clause[3], reads);
    this.bareReads(clause[4], reads);
    this.bareReads(clause[5], reads);
    const own = new Set(this.loopBindingNames(node));
    const unbound = earlier.find((name) => reads.has(name) && !own.has(name) && !this.inScope(name));
    if (unbound !== undefined) {
      throw this.positionedError(node,
        `emitter: this clause reads '${unbound}', which only the clause written before it binds — chained clauses nest with the ` +
        `LAST one outermost, so '${unbound}' is unbound here. For one flat list, write one \`for\` per comprehension, ` +
        'outer loop last, and `.flat()` the result');
    }
  }

  // The bare identifiers an expression reads in ITS OWN scope: a
  // member's property name and an object key are not reads, a call's
  // head is, and a nested function keeps its own.
  bareReads(n, out = new Set()) {
    const w = wordOf(n);
    if (w !== undefined) { out.add(w); return out; }
    if (isList(n)) {
      for (const el of n) this.bareReads(el, out);
      return out;
    }
    if (!isNode(n) || isFunc(n) || n[0] === 'def' || n[0] === 'class') return out;
    const head = n[0];
    if ((head === '.' || head === '?.') && n.length === 4) return this.bareReads(n[2], out);
    if (head === ':' && n.length === 4) return this.bareReads(n[3], out);
    for (let k = 2; k < n.length; k++) this.bareReads(n[k], out);
    return out;
  }

  // The object-comprehension rule: an object whose ONLY pair's value is
  // a FOR-OF comprehension IS the comprehension, building an object
  // keyed by the pair key (`{k: v for k, v of src}` → result[k] = v).
  // The object form exists for `of` clauses only; a for-in
  // value stays a plain pair.
  static objectComprehension(node) {
    if (node.length !== 3) return null;
    const pair = node[2];
    if (!isNode(pair) || pair[0] !== ':' || pair[1].void === true || pair[1].shorthand === true) return null;
    const keyOk = wordOf(pair[2]) !== undefined || (isNode(pair[2]) && pair[2][0] === 'dynamicKey');
    if (!keyOk || !isComprehensionNode(pair[3]) || pair[3][3][1].over !== 'of') return null;
    return pair;
  }
}

// The text of a numeric literal word, or null.
const numText = (x) => {
  const w = wordOf(x);
  return w !== undefined && /^[0-9.]/.test(w) ? w : null;
};
