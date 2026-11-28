// Loops and comprehensions: loop bindings and their checks, for-in,
// for-of, for-as, guarded bodies and comprehension lowering.
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

import { isHeadless } from '../emitter-shape.js';
import { ASSIGNS, isShapedNode, isRange, isFunc, isDefHead, isUpdate, isComprehensionNode } from './helpers.js';
import { Emitter } from './core.js';
import { referencesNames } from './walks.js';

export class LoopMethods {
  // ["for-in", vars, iterable, step, guard, body] — the lowering
  // keeps the unindented-body quirk for stepped loops.
  // Loop variables are new bindings for the loop's whole emission —
  // they shadow same-named reactive declarations (a frame per loop).
  loopBindingNames(node) {
    const h = isShapedNode(node) ? node[0] : null;
    let vars = null;
    if (h === 'loop-n') return ['it'];
    if (h === 'for-in' || h === 'for-of' || h === 'for-as') vars = node[1];
    else if (isComprehensionNode(node)) vars = node[2][0][1];
    if (vars === null) return [];
    // A loop that binds NO variable has no coherent emission — the
    // var-less ranged spelling (`for [1...3]`) reaches here with an
    // empty vars list and would otherwise compile to a for-of against
    // nothing. The repeat
    // idiom takes a binding.
    if (vars.length === 0) {
      throw this.positionedError(node, "emitter: a for loop binds no variable — spell a bare repeat with a binding (`for i in [1...3]`)");
    }
    const names = [];
    for (const v of vars) this.patternNames(v, names, true);
    if (h === 'for-in' || h === 'for-of' || h === 'for-as') {
      this.checkLoopSource(node, names);
      this.checkLoopGuard(node[4], names);
    } else {
      const own = [];
      for (const clause of node[2]) {
        const clauseNames = this.loopBindingNames(clause);
        this.checkLoopSource(clause, clauseNames);
        own.push(...clauseNames);
      }
      this.checkLoopGuard(node[3], own);
    }
    return names;
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
    const [h, vars, source] = loop;
    const namesOf = (v) => this.patternNames(v, [], true);
    const ranged = h === 'for-in' && isRange(source);
    const step = h === 'for-in' ? loop[3] ?? null : null;
    let header, body = [];
    if (h === 'for-of') {
      const rereads = loop[3] === true || vars.length === 2;
      if (rereads && !this.singleReadIterable(source)) return this.checkLoopStep(loop, step, new Set(), names);
      header = namesOf(vars[0]);
      if (vars.length === 2) body = namesOf(vars[1]);
    } else if (h === 'for-in' && !ranged && (step !== null || vars.length === 2)) {
      header = vars.length === 2 ? namesOf(vars[1]) : [];
      if (this.singleReadIterable(source)) body = namesOf(vars[0]);
    } else header = names;
    const hidden = [...header, ...body];
    const hit = hidden.find((n) => referencesNames(source, new Set([n]), this.stores)) ??
      Emitter.loopVarWrite(source, new Set(hidden), (p) => this.patternNames(p, [], false))?.name;
    if (hit !== undefined) {
      const message = `emitter: the loop variable '${hit}' is read in its own source — the loop binds '${hit}' before ` +
        `its source evaluates, so the source cannot reach an outer '${hit}'; rename the loop variable`;
      const id = this.stores.idOf(loop);
      const row = id !== null ? (this.stores.role(id, 'iterable') ?? this.stores.role(id, 'object')) : null;
      if (row !== null && typeof row.sourceStart === 'number') throw this.positionedErrorAt(row.sourceStart, row.sourceEnd, message);
      throw this.positionedError(source, message, loop);
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
      const id = this.stores.idOf(loop);
      const row = id !== null ? this.stores.role(id, 'step') : null;
      const message = `emitter: a loop step cannot read the loop variable '${read}' — the step evaluates once, as the ` +
        `loop starts, where '${read}' is already the loop's own binding, not an outer '${read}'; compute the step into ` +
        'another name first';
      if (row !== null && typeof row.sourceStart === 'number') throw this.positionedErrorAt(row.sourceStart, row.sourceEnd, message);
      throw this.positionedError(step, message, loop);
    }
  }

  // The first write to one of `names` inside an expression, with the
  // written name. A closure writes the enclosing binding unless a
  // parameter of its own shadows the name.
  static loopVarWrite(x, names, targetNames) {
    if (!isShapedNode(x) || names.size === 0) return null;
    if (isHeadless(x)) {
      for (const el of x) {
        const hit = Emitter.loopVarWrite(el, names, targetNames);
        if (hit !== null) return hit;
      }
      return null;
    }
    if (x[0] === 'class') return null;
    if (isFunc(x) || isDefHead(x[0])) {
      const params = isFunc(x) ? x[1] : x[2];
      const shadowed = new Set();
      for (const p of params ?? []) {
        try { for (const n of targetNames(Emitter.paramCore(p))) shadowed.add(n); } catch { /* not a pattern */ }
        if (typeof p === 'string') shadowed.add(p);
      }
      const live = new Set([...names].filter((n) => !shadowed.has(n)));
      return Emitter.loopVarWrite(isFunc(x) ? x[2] : x[3], live, targetNames);
    }
    if (ASSIGNS.has(x[0]) && x.length === 3) {
      let targets = [];
      try { targets = typeof x[1] === 'string' ? [x[1]] : targetNames(x[1]); } catch { targets = []; }
      const name = targets.find((n) => names.has(n));
      if (name !== undefined) return { node: x, name };
    }
    if (isUpdate(x) && typeof x[1] === 'string' && names.has(x[1])) return { node: x, name: x[1] };
    for (let i = 1; i < x.length; i++) {
      const hit = Emitter.loopVarWrite(x[i], names, targetNames);
      if (hit !== null) return hit;
    }
    return null;
  }

  // Ranged for, every form. Direction: a literal step's sign decides
  // (positive ascends, negative descends, zero rejects — it never
  // advances); a variable step binds ONCE and the header tests its
  // sign; with no step, two literal bounds decide statically and any
  // variable bound ascends (`by -1` descends). Impure bounds bind once
  // beside the counter. A second loop variable is the iteration index.
  rangedHeader(node, markVar, vars, iter, step) {
    const [dots, from, to] = iter;
    const cmpUp = dots === '..' ? '<=' : '<';
    const cmpDown = dots === '..' ? '>=' : '>';
    const numText = (s) => (typeof s === 'string' && /^[0-9.]/.test(s) ? s : null);
    const signedText = (x) => numText(x) ??
      (isShapedNode(x) && (x[0] === '+' || x[0] === '-') && x.length === 2 && numText(x[1]) !== null
        ? `${x[0] === '-' ? '-' : ''}${numText(x[1])}`
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
    const v = vars[0];
    const idx = vars.length === 2 ? vars[1] : null;
    const toRef = toLit !== null || this.singleReadIterable(to) ? null : this.liveTemp('_ref');
    const stepRef = step === null || stepLit !== null ? null : this.liveTemp('_step');
    this.b.emit('for (let ');
    markVar(v);
    this.b.emit(' = ');
    this.expr(from);
    if (toRef !== null) { this.b.emit(`, ${toRef} = `); this.expr(to); }
    if (stepRef !== null) { this.b.emit(`, ${stepRef} = `); this.mark(node, 'step', () => this.expr(step)); }
    if (idx !== null) { this.b.emit(', '); markVar(idx); this.b.emit(' = 0'); }
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

  forIn(node, ind) {
    this.inCtrl(() => this.forInCtrl(node, ind));
  }

  forInCtrl(node, ind) {
    const [, vars, iter, step, guard, body] = node;
    this.withBindings(this.loopBindingNames(node), () => this.forInCore(node, vars, iter, step, guard, body, ind));
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
    const plainVars = vars.length === 2 && vars.every((v) => typeof v === 'string');
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

  forInCore(node, vars, iter, step, guard, body, ind) {
    this.mark(node, '$self', () => {
      const markVar = (v) => this.mark(node, 'vars', () => (typeof v === 'string' ? this.emitPrimitive(v) : this.withPattern(() => this.expr(v), true)));
      // Pattern loop variables emit in the plain of-loop and the
      // index-variable forms (both destructure); the range/step
      // lowerings iterate through the variable itself.
      if (isShapedNode(vars[0]) && (isRange(iter) || step !== null)) {
        throw this.positionedError(node, 'emitter: pattern loop variables with ranges or BY steps are not supported yet');
      }
      if (isRange(iter)) {
        this.rangedHeader(node, markVar, vars, iter, step);
        this.b.emit(' ');
        this.guardedBlock(body, guard, ind);
      } else if (step !== null) {
        // Stepped iteration. A LITERAL step's direction is static:
        // positive literals ascend, `-`-literals walk DOWN from the
        // end (an ascending header with a negative step would never
        // terminate), and a zero literal rejects — it never advances
        // the loop. Every OTHER step expression has runtime sign: it
        // evaluates ONCE into `_step` and the header tests that sign,
        // so both directions terminate and a zero step iterates
        // nothing. Bodies emit unindented (a pinned emission
        // quirk). The index variable is the second loop variable when
        // given (`for t, i in xs by -1`), `_i` otherwise.
        const idx = vars.length === 2 ? vars[1] : this.liveTemp('_i');
        // The index name's DECLARING occurrence is a source variable only when the
        // loop spells one (`for t, i in xs by 2`); every later `${idx}` in the header
        // is emitter arithmetic on that binding, not another read of the source.
        const declIdx = () => { if (vars.length === 2) markVar(idx); else this.b.emit(idx); };
        const numText = (s) => (typeof s === 'string' && /^[0-9.]/.test(s) ? s : null);
        const posLit = numText(step) ??
          (isShapedNode(step) && step[0] === '+' && step.length === 2 ? numText(step[1]) : null);
        const negLit = isShapedNode(step) && step[0] === '-' && step.length === 2 ? numText(step[1]) : null;
        if ((posLit ?? negLit) !== null && Number((posLit ?? negLit).replace(/_/g, '')) === 0) {
          throw this.positionedError(node, 'emitter: a BY step of 0 never advances the loop');
        }
        // An impure iterable binds ONCE in the init; every later
        // read (bounds, element) uses the binding.
        const it = this.singleReadIterable(iter) ? null : this.liveTemp('_ref');
        const read = this.indexedReader(node, vars, iter);
        const bind = () => { if (it) { this.b.emit(`${it} = `); read(); this.b.emit(', '); } };
        const ref = () => { if (it) this.b.emit(it); else read(); };
        if (negLit !== null) {
          this.b.emit('for (let ');
          bind();
          declIdx(); this.b.emit(' = ');
          ref();
          this.b.emit(`.length - 1; ${idx} >= 0; `);
          if (negLit === '1') {
            this.mark(node, 'step', () => this.b.emit(`${idx}--`));
          } else {
            this.b.emit(`${idx} += `);
            this.mark(node, 'step', () => {
              this.b.emit('(-');
              this.expr(step[1]);
              this.b.emit(')');
            });
          }
        } else if (posLit !== null) {
          this.b.emit('for (let ');
          bind();
          declIdx(); this.b.emit(` = 0; ${idx} < `);
          ref();
          this.b.emit(`.length; `);
          if (step === '1') {
            this.mark(node, 'step', () => this.b.emit(`${idx}++`));
          } else {
            this.b.emit(`${idx} += `);
            // A `+`-headed literal step is a unary and groups as an
            // operand (`_i += (+2)`).
            this.grouped(node, 'step', step, Emitter.needsGrouping(step, 'operand'));
          }
        } else {
          const stp = this.liveTemp('_step');
          this.b.emit(`for (let ${stp} = `);
          this.mark(node, 'step', () => this.expr(step));
          this.b.emit(', ');
          bind();
          declIdx(); this.b.emit(` = ${stp} > 0 ? 0 : `);
          ref();
          this.b.emit(`.length - 1; ${stp} > 0 ? ${idx} < `);
          ref();
          this.b.emit(`.length : ${stp} < 0 && ${idx} >= 0; ${idx} += ${stp}`);
        }
        this.b.emit(`) {\nlet `);
        markVar(vars[0]);
        this.b.emit(' = ');
        ref();
        this.b.emit(`[${idx}];\n`);
        this.flatBody(body, guard, '    ');
        this.b.emit('}');
      } else if (vars.length === 2) {
        const it = this.singleReadIterable(iter) ? null : this.liveTemp('_ref');
        const read = this.indexedReader(node, vars, iter);
        this.b.emit('for (let ');
        if (it) {
          this.b.emit(`${it} = `);
          read();
          this.b.emit(', ');
        }
        // The index name's DECLARING occurrence is the source variable; every
        // later `${vars[1]}` in the header is emitter arithmetic on that
        // binding, not another read of the source.
        markVar(vars[1]);
        this.b.emit(` = 0; ${vars[1]} < `);
        if (it) this.b.emit(it); else read();
        this.b.emit(`.length; ${vars[1]}++) {\n`);
        this.b.emit('  '.repeat(ind + 1) + 'let ');
        markVar(vars[0]);
        this.b.emit(' = ');
        if (it) this.b.emit(it); else read();
        this.b.emit(`[${vars[1]}];\n`);
        if (guard !== null) {
          this.b.emit('  '.repeat(ind + 1) + 'if (');
          this.expr(guard);
          this.b.emit(') ');
          this.braceBlock(body, ind + 1);
          this.b.emit('\n');
        } else {
          this.bodyLines(body, ind);
        }
        this.b.emit('  '.repeat(ind) + '}');
      } else {
        this.b.emit('for (let ');
        markVar(vars[0]);
        this.b.emit(' of ');
        this.mark(node, 'iterable', () => this.expr(iter));
        this.b.emit(') ');
        this.guardedBlock(body, guard, ind);
      }
    });
  }

  // ["for-of", vars, object, own, guard, body] — own and
  // two-variable loops emit their body unindented.
  // Pattern loop variables: the VALUE slot destructures the value in
  // the injected let line; a pattern KEY destructures the key string
  // in the header. The two combinations that need the
  // key BY NAME — the `own` hasOwn filter and a value binding's
  // `obj[key]` index — reject.
  forOf(node, ind) {
    this.inCtrl(() => this.forOfCtrl(node, ind));
  }

  forOfCtrl(node, ind) {
    const [, vars, obj, own, guard, body] = node;
    this.checkForOfPatternKey(vars, own);
    this.withBindings(this.loopBindingNames(node), () => this.forOfCore(node, vars, obj, own, guard, body, ind));
  }

  forOfCore(node, vars, obj, own, guard, body, ind) {
    this.mark(node, '$self', () => {
      const markVar = (v) => this.mark(node, 'vars', () => (typeof v === 'string' ? this.emitPrimitive(v) : this.withPattern(() => this.expr(v), true)));
      // An impure object the own-filter or value line would re-read
      // binds once ahead of the header.
      const rereads = own || vars.length === 2;
      const it = rereads && !this.singleReadIterable(obj) ? this.loopTempName('_ref') : null;
      if (it !== null) {
        // A scope-level const claims its name for the whole compile
        // (a for-header temp is reserved only while its loop emits).
        this.temps.used.add(it);
        this.b.emit(`const ${it} = `);
        this.mark(node, 'object', () => this.expr(obj));
        this.b.emit(`;\n${'  '.repeat(ind)}`);
      }
      const ref = () => { if (it) this.b.emit(it); else this.expr(obj); };
      this.b.emit('for (let ');
      markVar(vars[0]);
      this.b.emit(' in ');
      if (it) this.b.emit(it);
      else this.mark(node, 'object', () => this.expr(obj));
      this.b.emit(') ');
      if (own || vars.length === 2) {
        // The hasOwn filter always emits for `own`.
        this.b.emit('{\n');
        if (own) {
          this.b.emit(`if (!Object.hasOwn(`);
          ref();
          this.b.emit(`, ${vars[0]})) continue;\n`);
        }
        if (vars.length === 2) {
          this.b.emit('let ');
          markVar(vars[1]);
          this.b.emit(' = ');
          ref();
          this.b.emit(`[${vars[0]}];\n`);
        }
        this.flatBody(body, guard, '');
        this.b.emit('}');
      } else {
        this.guardedBlock(body, guard, ind);
      }
    });
  }

  // A for…of pattern KEY has no name, so the forms that read the key
  // by name cannot lower it: the `own` hasOwn filter and a value
  // binding's `obj[key]` index — both reject
  //. Shared by the
  // statement form and the clause emitter (comprehensions,
  // accumulator loops).
  checkForOfPatternKey(vars, own) {
    if (!isShapedNode(vars[0])) return;
    if (own) {
      throw this.positionedError(vars[0], "emitter: a for…of pattern key cannot combine with 'own' — the hasOwn filter reads the key by name (name the key and destructure the value slot)");
    }
    if (vars.length === 2) {
      throw this.positionedError(vars[0], 'emitter: a for…of pattern key cannot combine with a value variable — the value binding indexes the object by the key name (name the key and destructure the value slot)');
    }
  }

  // ["for-as", vars, iterable, await, guard, body] — iterator-protocol
  // iteration: a plain ES for-of (`for await` when the await flag is
  // set). The header — including the one-loop-variable enforcement —
  // is clauseHeader's, shared with every expression-position form.
  forAs(node, ind) {
    this.inCtrl(() => this.forAsCtrl(node, ind));
  }

  forAsCtrl(node, ind) {
    const [, vars, iter, isAwait, guard, body] = node;
    this.withBindings(this.loopBindingNames(node), () => {
      this.mark(node, '$self', () => {
        this.clauseHeader(node, 'for-as', vars, iter, isAwait);
        this.b.emit(' ');
        this.guardedBlock(body, guard, ind);
      });
    });
  }

  // Loop body at normal indentation, wrapping in the guard `if` when one
  // exists (single-parenthesized in block loops).
  guardedBlock(body, guard, ind) {
    if (guard === null) {
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
    const stmts = this.liveStmts(this.isBlock(body) ? body.slice(1) : [body]);
    this.emitTsTypeDecls(this.isBlock(body) ? body.slice(1) : [body], '');
    if (guard !== null) {
      const wrap = Emitter.needsGrouping(guard, 'operand') || isUpdate(guard);
      this.b.emit('if (');
      if (wrap) this.b.emit('(');
      this.expr(guard);
      if (wrap) this.b.emit(')');
      this.b.emit(') {\n');
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
    const stmts = this.liveStmts(this.isBlock(body) ? body.slice(1) : [body]);
    this.emitTsTypeDecls(this.isBlock(body) ? body.slice(1) : [body], '  '.repeat(ind + 1));
    for (const stmt of stmts) {
      this.b.emit('  '.repeat(ind + 1));
      this.statement(stmt, ind + 1);
      this.b.emit('\n');
    }
  }

  // One accumulator/comprehension loop clause: emits the `for (…)`
  // header (no brace) and returns the body-top setup emitters — the
  // hasOwn continue (own for-of), the value binding (two-variable
  // for-of, indexed or stepped for-in) — one line each, indentation
  // owned by the caller. `node` supplies role marks when the clause
  // belongs to an annotated loop node; comprehension clauses carry no
  // roles, so their marks fall back to plain emission.
  clauseHeader(node, kind, vars, iter, aux, pad = null) {
    const markVar = (v) => this.mark(node, 'vars', () => (typeof v === 'string' ? this.emitPrimitive(v) : this.withPattern(() => this.expr(v), true)));
    const setups = [];
    if (kind === 'for-of') {
      this.checkForOfPatternKey(vars, aux === true);
      // An impure object the own-filter or value line would re-read
      // binds once ahead of the header (the caller's pad restores the
      // line); a header-only read never needs it.
      const rereads = aux === true || vars.length === 2;
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
      if (aux === true) {
        setups.push(() => {
          this.b.emit('if (!Object.hasOwn(');
          ref();
          this.b.emit(`, ${vars[0]})) continue;`);
        });
      }
      if (vars.length === 2) {
        setups.push(() => {
          this.b.emit('let ');
          markVar(vars[1]);
          this.b.emit(' = ');
          ref();
          this.b.emit(`[${vars[0]}];`);
        });
      }
      return setups;
    }
    if (kind === 'for-as') {
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
      if (aux === true) this.renderSyncGuard(node);
      this.b.emit(aux === true ? 'for await (let ' : 'for (let ');
      markVar(vars[0]);
      this.b.emit(' of ');
      this.mark(node, 'iterable', () => this.expr(iter));
      this.b.emit(')');
      return setups;
    }
    // for-in: plain, indexed (second loop variable), or stepped.
    const step = aux;
    if (isShapedNode(vars[0]) && (isRange(iter) || step !== null)) {
      throw this.positionedError(node, 'emitter: pattern loop variables with ranges or BY steps are not supported yet');
    }
    if (isRange(iter)) {
      this.rangedHeader(node, markVar, vars, iter, step);
      return setups;
    }
    if (step !== null) {
      // The statement-position stepped-loop policy, at accumulator
      // indentation: literal steps get static-direction headers, every
      // other step evaluates ONCE into `_step` and the header tests its
      // sign, and a zero literal rejects.
      const idx = vars.length === 2 ? vars[1] : this.liveTemp('_i');
      // The index name's DECLARING occurrence is a source variable only when the
      // loop spells one (`for t, i in xs by 2`); every later `${idx}` in the header
      // is emitter arithmetic on that binding, not another read of the source.
      const declIdx = () => { if (vars.length === 2) markVar(idx); else this.b.emit(idx); };
      const numText = (s) => (typeof s === 'string' && /^[0-9.]/.test(s) ? s : null);
      const posLit = numText(step) ??
        (isShapedNode(step) && step[0] === '+' && step.length === 2 ? numText(step[1]) : null);
      const negLit = isShapedNode(step) && step[0] === '-' && step.length === 2 ? numText(step[1]) : null;
      if ((posLit ?? negLit) !== null && Number((posLit ?? negLit).replace(/_/g, '')) === 0) {
        throw this.positionedError(node, 'emitter: a BY step of 0 never advances the loop');
      }
      const it = this.singleReadIterable(iter) ? null : this.liveTemp('_ref');
      const read = this.indexedReader(node, vars, iter);
      const bind = () => { if (it) { this.b.emit(`${it} = `); read(); this.b.emit(', '); } };
      const ref = () => { if (it) this.b.emit(it); else read(); };
      if (negLit !== null) {
        this.b.emit('for (let ');
        bind();
        declIdx(); this.b.emit(' = ');
        ref();
        this.b.emit(`.length - 1; ${idx} >= 0; `);
        if (negLit === '1') {
          this.mark(node, 'step', () => this.b.emit(`${idx}--`));
        } else {
          this.b.emit(`${idx} += `);
          this.mark(node, 'step', () => {
            this.b.emit('(-');
            this.expr(step[1]);
            this.b.emit(')');
          });
        }
      } else if (posLit !== null) {
        this.b.emit('for (let ');
        bind();
        declIdx(); this.b.emit(` = 0; ${idx} < `);
        ref();
        this.b.emit(`.length; `);
        if (step === '1') {
          this.mark(node, 'step', () => this.b.emit(`${idx}++`));
        } else {
          this.b.emit(`${idx} += `);
          this.grouped(node, 'step', step, Emitter.needsGrouping(step, 'operand'));
        }
      } else {
        const stp = this.liveTemp('_step');
        this.b.emit(`for (let ${stp} = `);
        this.mark(node, 'step', () => this.expr(step));
        this.b.emit(', ');
        bind();
        declIdx(); this.b.emit(` = ${stp} > 0 ? 0 : `);
        ref();
        this.b.emit(`.length - 1; ${stp} > 0 ? ${idx} < `);
        ref();
        this.b.emit(`.length : ${stp} < 0 && ${idx} >= 0; ${idx} += ${stp}`);
      }
      this.b.emit(')');
      setups.push(() => {
        this.b.emit('let ');
        markVar(vars[0]);
        this.b.emit(' = ');
        ref();
        this.b.emit(`[${idx}];`);
      });
      return setups;
    }
    if (vars.length === 2) {
      const it = this.singleReadIterable(iter) ? null : this.liveTemp('_ref');
      const read = this.indexedReader(node, vars, iter);
      this.b.emit('for (let ');
      if (it) {
        this.b.emit(`${it} = `);
        read();
        this.b.emit(', ');
      }
      // The index name's DECLARING occurrence is the source variable; every
      // later `${vars[1]}` in the header is emitter arithmetic on that binding.
      markVar(vars[1]);
      this.b.emit(` = 0; ${vars[1]} < `);
      if (it) this.b.emit(it); else read();
      this.b.emit(`.length; ${vars[1]}++)`);
      setups.push(() => {
        this.b.emit('let ');
        markVar(vars[0]);
        this.b.emit(' = ');
        if (it) this.b.emit(it); else read();
        this.b.emit(`[${vars[1]}];`);
      });
      return setups;
    }
    this.b.emit('for (let ');
    markVar(vars[0]);
    this.b.emit(' of ');
    this.mark(node, 'iterable', () => this.expr(iter));
    this.b.emit(')');
    return setups;
  }

  // A guard opening: `if (<guard>) {` — the guard is a value position
  // (compounds group).
  guardOpen(guard) {
    this.b.emit('if (');
    const wrap = Emitter.needsGrouping(guard, 'operand') || isUpdate(guard);
    if (wrap) this.b.emit('(');
    this.expr(guard);
    if (wrap) this.b.emit(')');
    this.b.emit(') {\n');
  }

  // ["comprehension", expr, [forClause], [guards]] — an IIFE with
  // result accumulation.
  // keyExpr distinguishes the two accumulator shapes: null builds
  // an array (`result.push(expr)`), non-null builds an object
  // (`result[key] = expr` — the object-comprehension form).
  comprehension(node, ind, keySpec = null) {
    this.withBindings(this.loopBindingNames(node), () => this.comprehensionCore(node, ind, keySpec));
  }

  comprehensionCore(node, ind, keySpec) {
    this.inCtrl(() => this.comprehensionCoreCtrl(node, ind, keySpec));
  }

  // The bare identifiers an expression reads in ITS OWN scope: a
  // member's property name and an object key are not reads, a call's
  // head is, and a nested function keeps its own.
  bareReads(n, out = new Set()) {
    if (typeof n === 'string') { out.add(n); return out; }
    if (!isShapedNode(n) || isFunc(n) || isDefHead(n[0]) || n[0] === 'class') return out;
    const head = n[0];
    if ((head === '.' || head === '?.') && n.length === 3) return this.bareReads(n[1], out);
    if ((head === ':' || head === 'void-pair') && n.length === 3) return this.bareReads(n[2], out);
    if (isShapedNode(head)) this.bareReads(head, out);
    for (let k = 1; k < n.length; k++) this.bareReads(n[k], out);
    return out;
  }

  comprehensionCoreCtrl(node, ind, keySpec) {
    const [, expr, [clause], guards] = node;
    // Chained clauses nest: `v for a in as for b in bs` parses as
    // `(v for a in as) for b in bs`, so the LAST clause is the outer
    // loop. A later clause that reads a name only an earlier clause binds
    // therefore reads it unbound — the spelling of someone expecting the
    // clauses to flatten in written order. Independent clauses build the
    // nested array they say.
    if (isShapedNode(expr) && isComprehensionNode(expr) && !expr.parenthesized && this.lockedHead(expr, 'comprehension')) {
      const earlier = [];
      for (let c = expr; isShapedNode(c) && isComprehensionNode(c) && !c.parenthesized && this.lockedHead(c, 'comprehension'); c = c[1]) {
        earlier.push(...this.loopBindingNames(c));
      }
      const reads = new Set();
      this.bareReads(clause[2], reads);
      this.bareReads(clause[3], reads);
      for (const g of guards) this.bareReads(g, reads);
      const own = new Set(this.loopBindingNames(node));
      const unbound = earlier.find((name) => reads.has(name) && !own.has(name) && !this.inScope(name));
      if (unbound !== undefined) {
        throw this.positionedError(node,
          `emitter: this clause reads '${unbound}', which only the clause written before it binds — chained clauses nest with the ` +
          `LAST one outermost, so '${unbound}' is unbound here. For one flat list, write one \`for\` per comprehension, ` +
          'outer loop last, and `.flat()` the result');
      }
    }
    const emitValue = () => this.mark(node, 'value', () => this.expr(expr));
    const keyExpr = keySpec?.expr ?? keySpec;
    const pad = '  '.repeat(ind);
    this.rejectYieldInIIFE(node);
    this.mark(node, '$self', () => {
      this.b.emit(this.containsAwait(node) ? 'await (async () => {\n' : '(() => {\n');
      const acc = this.liveTemp('result');
      this.b.emit(`${pad}  const ${acc} = ${keyExpr === null ? '[]' : '{}'};\n`);
      this.b.emit(`${pad}  `);
      const [kind, vars, iter, aux] = clause;
      // The clause has no role of its own, so its names claim from the
      // comprehension's whole $self frame — where the BODY's reads live too, and
      // where the lowering emits the clause FIRST, so an ordinal claim would
      // hand the clause variable the body's occurrence. The parts that DO own
      // spans say where the clause is not: the `value` role covers the body, and
      // each guard is a node with its own extent.
      const away = [];
      const cid = this.stores.idOf(node);
      const valueRole = cid !== null ? this.stores.role(cid, 'value') : null;
      if (valueRole !== null && valueRole.sourceStart != null) away.push([valueRole.sourceStart, valueRole.sourceEnd]);
      for (const g of guards) {
        const gid = isShapedNode(g) ? this.stores.idOf(g) : null;
        const sp = gid !== null ? this.stores.selfSpan(gid) : null;
        if (sp !== null) away.push(sp);
      }
      // The header AND the body-top setups both spell clause variables (the
      // two-variable for-of binds its value there), so both emit inside the
      // window; everything after it claims normally.
      const offClause = away.length > 0 ? () => { this.primitiveAvoid = null; } : () => {};
      const onClause = away.length > 0 ? () => { this.primitiveAvoid = away; } : () => {};
      onClause();
      const setups = this.clauseHeader(node, kind, vars, iter, aux ?? null, `${pad}  `);
      offClause();
      this.b.emit(' {\n');
      let inner = `${pad}    `;
      for (const setup of setups) {
        this.b.emit(inner);
        onClause();
        setup();
        offClause();
        this.b.emit('\n');
      }
      if (guards.length > 0) {
        this.b.emit(inner);
        this.guardOpen(guards[0]);
        inner += '  ';
      }
      if (keyExpr === null) {
        this.b.emit(`${inner}${acc}.push(`);
        // The pushed expression is an operand position (compounds group).
        const wrap = Emitter.needsGrouping(expr, 'operand') || isUpdate(expr);
        if (wrap) this.b.emit('(');
        emitValue();
        if (wrap) this.b.emit(')');
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
        const wrapKey = isShapedNode(keyExpr) && (Emitter.needsGrouping(keyExpr, 'operand') || isUpdate(keyExpr));
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
        const wrap = Emitter.needsGrouping(expr, 'operand') || isUpdate(expr);
        if (wrap) this.b.emit('(');
        emitValue();
        if (wrap) this.b.emit(')');
        this.b.emit(';\n');
        this.b.emit(`${inner}${this.runtimeName('__defineOwnDataProperty')}(${acc}, ${kt}, ${vt});\n`);
      }
      if (guards.length > 0) this.b.emit(`${pad}    }\n`);
      this.b.emit(`${pad}  }\n`);
      this.b.emit(`${pad}  return ${acc};\n`);
      this.b.emit(`${pad}})()`);
    });
  }

  // The object-comprehension rule: an object whose ONLY pair's value is
  // a FOR-OF comprehension IS the comprehension, building an object
  // keyed by the pair key (`{k: v for k, v of src}` → result[k] = v).
  // The object form exists for `of` clauses only; a for-in
  // value stays a plain pair.
  static objectComprehension(node) {
    if (node.length !== 2) return null;
    const pair = node[1];
    if (!isShapedNode(pair) || pair[0] !== ':') return null;
    const keyOk = typeof pair[1] === 'string' || (isShapedNode(pair[1]) && pair[1][0] === 'dynamicKey');
    if (!keyOk) return null;
    if (!isComprehensionNode(pair[2])) return null;
    if (pair[2][2][0][0] !== 'for-of') return null;
    return pair;
  }
}
