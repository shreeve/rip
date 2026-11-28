// Assignment and destructuring: plain, compound, optional and slice
// assignment, and middle-rest patterns.
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

import { isNode, isNone, isStruct, wordOf, mkLeaf } from '../sexpr.js';
import { PROTO_GENERIC_PARAMS, SPINE_HEADS } from './helpers.js';
import { protoMemberTarget, isSpread } from './tree.js';
import { Emitter } from './core.js';

// The reference plan of a target whose every part is repeat-safe.
const NO_REF_PLAN = Object.freeze({ recv: null, obj: null, key: null });

export class AssignMethods {
  // The hoisted temps a re-reading write binds its target's parts to
  // (scope.js's planTemps), or NO_REF_PLAN.
  refPlan(node) {
    return this.refPlans.get(node) ?? NO_REF_PLAN;
  }

  // A computed (`~=`) derives from its dependencies — it has no legal
  // write; the runtime's read-only container would throw at the
  // assignment, which is the loud error in the wrong place. A readonly
  // (`=!`) never changes after its declaration.
  checkNameWrite(node, name) {
    if (name === undefined) return;
    if (this.isComputedName(name)) {
      throw this.positionedError(node,
        `emitter: cannot assign to computed '${name}' — a '~=' binding derives from its dependencies; write to those instead`);
    }
    if (this.isAmbientReadonly(name)) {
      throw this.positionedError(node,
        `emitter: cannot assign to readonly '${name}' — a '=!' binding never changes after its declaration`);
    }
  }

  // A destructured write lands on each name it assigns as surely as
  // `c = …` does, so each runs the same check. A name the REPL's ambient
  // seed binds keeps the runtime backstop instead: the evaluation
  // environment restores a seeded readonly as const and a seeded
  // computed as its read-only container, so JS throws at the element.
  checkPatternNameWrites(node, target) {
    for (const name of this.patternNames(target)) {
      if (!this.isSeededName(name)) this.checkNameWrite(node, name);
    }
  }

  // Assignment through an optional chain: statement position guards
  // with `if (guard != null) …`; value position lowers to a ternary
  // yielding undefined when the guard is nullish. The guard emission
  // is a second generated manifestation of the optional link's
  // `object` role, so leaf guards map exactly.
  //
  // Single evaluation: every target part that is not repeat-safe
  // binds to a hoisted temp from the node's reference plan — the
  // receiver INSIDE the guard's own parens (`(_ref = recv()) != null`,
  // so the null check and the write see the SAME object), the final
  // link's object and computed key as leading sequence assignments
  // inside the successful branch. Only the receiver evaluates before
  // the guard; a nullish receiver produces zero key/value evaluations.
  // Hoisted temps (never an IIFE parameter) keep `yield`, `await`,
  // and every control transfer in the source function's own context.
  optionalAssign(node, optLink, context) {
    // The member write guards run here too: an optional target never
    // reaches the plain assignment path, and the rest-view rule keys
    // on the chain's ROOT, which the optional link does not change.
    this.checkMemberWrite(node, node[2]);
    const op = node[0];
    const synth = op === '//=' || op === '%%=';
    const plan = this.refPlan(node);
    if (plan.recv === null && !this.repeatSafeValue(optLink[2])) {
      throw this.positionedError(node, 'emitter: reference plan missing for an optional assignment with an impure receiver — a capture site the planner walk did not reach');
    }
    // Clones alias to their originals' ids, so every re-manifested
    // segment keeps its source mapping (the clone IS a second
    // generated manifestation of the same construct).
    const temp = (name, x) => (name === null ? x : mkLeaf('name', name));
    const subst = (x) => {
      if (x === optLink) return this.aliasCopy([x[0], x[1], temp(plan.recv, x[2]), x[3]], x);
      return isStruct(x) ? this.aliasCopy(x.map(subst), x) : x;
    };
    const target1 = subst(node[2]);
    // The temp scaffolding stays OUTSIDE the object mark, so the
    // receiver keeps its exact source mapping; the parens and temp are
    // covered by the node's $self row.
    const guard = () => {
      if (plan.recv !== null) {
        this.b.emit(`(${plan.recv} = `);
        this.mark(optLink, 'object', () => this.withExpression(() => this.expr(optLink[2])));
        this.b.emit(')');
      } else {
        this.mark(optLink, 'object', () => this.expr(optLink[2]));
      }
    };
    const value = () => this.mark(node, 'value', () => this.withExpression(() => this.expr(node[3])));
    // The successful branch: obj/key setup (when captured), then the
    // assignment. Comma-sequenced, so both positions stay a single
    // expression and setup runs only past the guard.
    const emitBranch = () => {
      if (!synth) {
        const target = () => this.mark(node, 'target', () => this.withTarget(() => this.withDeopt(() => this.expr(target1))));
        target();
        this.b.emit(' ');
        this.mark(node, 'operator', () => this.b.emit(op));
        this.b.emit(' ');
        value();
        return;
      }
      // Synthesized compound: the target manifests twice (read +
      // write), so its object/key spell through the captured temps.
      if (plan.obj !== null) {
        this.b.emit(`${plan.obj} = `);
        this.mark(target1, 'object', () => this.withDeopt(() => this.expr(target1[2])));
        this.b.emit(', ');
      }
      if (plan.key !== null) {
        this.b.emit(`${plan.key} = `);
        this.mark(target1, 'key', () => this.withExpression(() => this.expr(target1[3])));
        this.b.emit(', ');
      }
      const ref = SPINE_HEADS.has(target1[0])
        ? this.stores.alias([target1[0], target1[1], temp(plan.obj, target1[2]), temp(plan.key, target1[3])], node[2])
        : target1;
      this.synthRespell(node, () => this.mark(node, 'target', () => this.withTarget(() => this.withDeopt(() => this.expr(ref)))));
    };
    this.mark(node, '$self', () => {
      if (context === 'statement') {
        this.b.emit('if (');
        guard();
        this.b.emit(' != null) ');
        emitBranch();
      } else {
        // Bare ternary — the node keeps its assign tier, so operand
        // positions group it through needsGrouping like any assignment.
        guard();
        this.b.emit(' != null ? (');
        emitBranch();
        this.b.emit(') : undefined');
      }
    });
  }

  // The one form a slice target takes is the statement `a[i..j] = v`.
  sliceAssignError(node) {
    if (node[0] === '=') {
      return this.positionedError(node, 'emitter: a slice assignment (`a[i..j] = v`) is a statement — it splices the range in place and has no value form; move it to its own line');
    }
    return this.positionedError(node, `emitter: a slice takes plain assignment only (\`a[i..j] = v\`) — '${node[0]}' has no in-place reading`);
  }

  assign(node) {
    const [, attrs, target, value] = node;
    const name = wordOf(target);
    // A string-literal target is the string-NAMED class field's shape
    // (`"data-src" = v`) — the class-member walk owns that form;
    // everywhere else a string is not an assignment target.
    if (name !== undefined && name[0] === '"') {
      throw this.positionedError(node, 'emitter: a string is not an assignment target — a string-NAMED member (`"data-src" = v`) lives in a class body');
    }
    this.checkNameWrite(node, name);
    if (!this.inPattern && Emitter.isPattern(target)) this.checkPatternNameWrites(node, target);
    // A middle-rest pattern has no JS destructuring form and no
    // expression lowering — only the statement path binds the source
    // once and reads by index. Reaching here means the pattern is in
    // VALUE position, where emitting it verbatim ships bytes no engine
    // parses; reject in the author's vocabulary instead (the for-range
    // ban's model), and name the statement spelling that does work.
    if (Emitter.middleRestPattern(target)) {
      throw this.positionedError(node,
        'emitter: a middle-rest pattern (`[a, ...mid, b]`) assigns only as a STATEMENT — '
        + 'it binds its source once and reads by index, which has no expression form; '
        + 'move the assignment to its own line');
    }
    // Pattern elements reject too — a destructured write declares
    // nothing, so `[flag] = […]` writes the export just as `flag = …`
    // does. Inside an enclosing pattern this `=` is a DEFAULT, and the
    // pattern's own check already covered the name.
    if (!this.inPattern) this.checkExportedConstWrite(node, target);
    this.checkImportWrite(node, target);
    this.checkMemberWrite(node, target);
    // A void definition (`save! = ->`, the `void` flag) validates its
    // function value and emits as a plain '='; the value's body owns
    // the void shape. The voidMarker role (side-band) covers the
    // whole emitted assignment — the bang's only generated
    // manifestation; mark() is a no-op for plain rows (no such role).
    if (attrs.void === true) this.registerVoidValue(value, node);
    this.protoAugmentation(node);
    // Pattern targets emit as direct ES destructuring — names declare
    // in place or hoist like plain targets. An OBJECT pattern that
    // assigns wraps the whole assignment in parens (a bare `{` would
    // open a block); one that DECLARES needs none, `let` already
    // opens a declaration. Inside an enclosing pattern this `=` is a
    // DEFAULT, where parens/grouping are invalid destructuring JS. The
    // default's value is an expression position again.
    const patternTarget = Emitter.isPattern(target);
    const declares = this.declaresInPlace.has(node);
    const wrapParens = this.isObject(target) && !this.inPattern && !declares;
    // A typed declaration's annotation role (side-band) covers
    // the whole emitted assignment — its only generated manifestation;
    // mark() is a no-op for the untyped rows (no such role).
    // Tier-1 declare-in-place: this statement's `=` also declares its
    // target — a plain name, or every name of a pattern. The `let ` is
    // declaration syntax the statement adds — like semicolons and
    // indentation it sits OUTSIDE all role marks, so every role row
    // (including $self) keeps its exact source↔generated slice.
    if (declares) this.b.emit('let ');
    this.mark(node, 'voidMarker', () => this.mark(node, 'annotation', () => this.mark(node, '$self', () => {
      if (wrapParens) this.b.emit('(');
      this.mark(node, 'target', () => {
        if (patternTarget) this.withPattern(() => this.expr(target));
        else this.withTarget(() => this.expr(target));
      });
      // A declare-in-place statement carries its type INLINE (`let x:
      // T = v`): the author's annotation when present, else the derived
      // schema story type. Both are TS-only regions, so the stripped
      // face stays byte-equal to the JS emission — annotating a
      // binding never changes shipped JS.
      if (this.ts && declares) {
        const owner = this.inlineOwners.get(node);
        const text = this.annotationText(node) ?? (owner !== undefined ? this.annotationText(owner) : null);
        if (text !== null) {
          this.emitAnnotation(owner ?? node, 'annotation', text);
        } else {
          const story = this.schemaStories?.get(node);
          if (story && !story.decl.exported && story.constType !== null) {
            const bind = this.bindingNameSpan(node, 'target', story.decl.name);
            this.b.tsOnly(() => { this.b.emit(': '); this.emitNamedCopies(story.constType, story.decl.name, bind?.id ?? null, bind?.span ?? null); });
          }
        }
      }
      this.b.emit(' ');
      this.mark(node, 'operator', () => this.b.emit(node[0]));
      this.b.emit(' ');
      // A schema value takes its binding's name (identity for
      // SchemaError, the registry, and debug output); a component
      // value likewise (the data-part attribute).
      const prevSchemaName = this._schemaName;
      const prevComponentName = this._componentName;
      const prevComponentTypeParams = this._componentTypeParams;
      this._componentTypeParams = null;
      if (isNode(value) && value[0] === 'schema' && name !== undefined) {
        this._schemaName = name;
      }
      if (name !== undefined && this.isComponentDecl(value)) {
        this._componentName = name;
        // Generic component: the assign's TYPE_PARAMS role rides to
        // the lowered class (componentExpr) through the same channel
        // as the name.
        const text = this.annotationText(node, 'typeParams');
        this._componentTypeParams = text === null ? null : { text, owner: node };
      }
      // A pinned first write under rip.strict checks without the pin as
      // its contextual type (pinnedWrites); the assignment still checks
      // against the pin. TS-only grouping parens: an arrow value would
      // otherwise swallow the clause into its body.
      const severed = this.ts && this.strict && this.pinnedWrites.has(node);
      if (severed) this.b.tsOnly(() => this.b.emit('('));
      this.mark(node, 'value', () => this.withExpression(() => this.expr(value)));
      if (severed) this.b.tsOnly(() => this.b.emit(') satisfies unknown'));
      this._schemaName = prevSchemaName;
      this._componentName = prevComponentName;
      this._componentTypeParams = prevComponentTypeParams;
      if (wrapParens) this.b.emit(')');
    })));
  }

  // A typed prototype member (`X::m: T = v`, target
  // `X.prototype.m`): the annotation's face manifestation is an
  // interface AUGMENTATION line ahead of the assignment — `declare
  // global` when the head names an outside type (String, Array), a
  // same-module interface when the head is declared here (TS merges
  // it with the class declaration). The member then EXISTS on the
  // target type: the write checks against the declared type, and
  // every call site and hover resolves it. TS-only bytes, so the
  // stripped face stays byte-equal to the JS emission; the line is
  // marked with the annotation role, so any TS diagnostic on the
  // augmentation itself (a malformed type, a generic global outside
  // the arity table) maps back to the author's annotation instead of
  // dropping with the synthetic span.
  //
  // An annotation that CANNOT manifest rejects loudly (never a
  // silently untyped member): augmentations are legal only at a
  // module's top level, and a module-bound head that is not a class
  // DECLARATION (an import, an expression-form `A = class`) gives
  // the interface nothing to merge with.
  protoAugmentation(node) {
    const proto = protoMemberTarget(node);
    const text = proto !== null ? this.annotationText(node) : null;
    if (text === null) return;
    const id = this.stores.idOf(node);
    const protoError = (message) => {
      const row = id !== null ? this.stores.role(id, 'annotation') : null;
      return row !== null && row.sourceStart != null
        ? this.positionedErrorAt(row.sourceStart, row.sourceEnd, message)
        : this.positionedError(node, message);
    };
    if (node !== this.moduleTopStmt) {
      throw protoError(
        'emitter: an annotated prototype member must be a module top-level statement — ' +
        'the annotation manifests as an interface augmentation, which TypeScript admits ' +
        'only at a module\'s top level; move the write there or drop the annotation');
    }
    if (this.moduleClassNames?.has(proto.head)) {
      this.tsAugment(node, id, proto, `interface ${proto.head} { `, `: ${text} }\n`);
    } else if (!this.scopes[0].has(proto.head)) {
      const params = PROTO_GENERIC_PARAMS[proto.head] ?? '';
      this.tsAugment(node, id, proto, `declare global { interface ${proto.head}${params} { `, `: ${text} } }\n`);
    } else {
      throw protoError(
        `emitter: the annotation on \`${proto.head}::${proto.member}\` cannot augment — ` +
        `\`${proto.head}\` is a module binding, not a class declaration, so the interface has ` +
        `nothing to merge with; declare \`class ${proto.head}\`, drop the annotation, or ` +
        'describe the member in a workspace .d.ts');
    }
  }

  // An array pattern whose rest sits BEFORE the last element:
  // `[a, ...mid, b]` — JS forbids the shape, so it takes a statement
  // lowering instead of the destructuring passthrough.
  static middleRestPattern(x) {
    if (!isNode(x) || x[0] !== 'array') return false;
    const els = x.slice(2);
    const at = els.findIndex(isSpread);
    return at !== -1 && at < els.length - 1;
  }

  // The middle-rest lowering: the source binds ONCE (pure sources
  // spell directly), heads read by index, the rest slices between,
  // and the tail reads from the end:
  //   [a, ...mid, b, c] = src
  //   → a = _ref[0]; mid = _ref.slice(1, -2); b = _ref[_ref.length - 2]; …
  middleRestAssign(node, ind) {
    // This lowering is dispatched AHEAD of the guarded assign path, so
    // the write checks have to run here too — `[...rest, flag] = src`
    // reaches no other guard.
    this.checkExportedConstWrite(node, node[2]);
    this.checkImportWrite(node, node[2]);
    this.checkMemberWrite(node, node[2]);
    this.checkPatternNameWrites(node, node[2]);
    const els = node[2].slice(2);
    const at = els.findIndex(isSpread);
    // Each element's target: its name node, or null for an elision,
    // which binds nothing but still holds its index.
    const targets = els.map((e, i) => {
      const t = i === at ? e[2] : e;
      if (isNone(t)) return null;
      if (wordOf(t) === undefined) {
        throw this.positionedError(node, 'emitter: a middle-rest pattern takes plain names (`[a, ...mid, b]`) — nested patterns have no single-read lowering');
      }
      return t;
    });
    const heads = targets.slice(0, at);
    const rest = targets[at];
    const tail = targets.slice(at + 1);
    this.mark(node, '$self', () => {
      const src = node[3];
      const ref = this.repeatSafeValue(src) ? null : this.loopTempName('_ref');
      let first = true;
      // Statements after the first start a new line; the first follows
      // the caller's indentation.
      const open = (t) => {
        if (!first) this.b.emit(`;\n${'  '.repeat(ind)}`);
        first = false;
        this.withTarget(() => this.expr(t));
        this.b.emit(' = ');
      };
      if (ref !== null) {
        // A scope-level const claims its name for the whole compile
        // (a for-header temp is reserved only while its loop emits).
        this.temps.used.add(ref);
        this.b.emit(`const ${ref} = `);
        this.mark(node, 'value', () => this.expr(src));
        first = false;
      }
      const srcText = () => { if (ref !== null) this.b.emit(ref); else this.expr(src); };
      heads.forEach((t, i) => {
        if (t === null) return;
        open(t);
        srcText();
        this.b.emit(`[${i}]`);
      });
      if (rest !== null) {
        open(rest);
        srcText();
        this.b.emit(tail.length > 0 ? `.slice(${heads.length}, -${tail.length})` : `.slice(${heads.length})`);
      }
      tail.forEach((t, i) => {
        if (t === null) return;
        open(t);
        srcText();
        this.b.emit(`[`);
        srcText();
        this.b.emit(`.length - ${tail.length - i}]`);
      });
    });
  }

  // A slice as an assignment target: `["[]", obj, ["..", from, to]]`
  // (either end may be null — an open end).
  static sliceTarget(t) {
    return isNode(t) && t[0] === '[]' && t.length === 4 && isNode(t[3]) &&
      (t[3][0] === '..' || t[3][0] === '...') && t[3].length === 4 ? t : null;
  }

  // `a[i..j] = v` → `a.splice(i, count, ...[].concat(v))`: the range's
  // elements are replaced in place by the value's — an array's items,
  // a scalar as one item (CoffeeScript's concat reading). An open end
  // splices to the end (`Infinity`); a missing start begins at 0. The
  // count is `j - i + 1` for an inclusive range and `j - i` for an
  // exclusive one, folded when both ends are integer literals. An
  // array-literal value without holes spreads inline. A negative
  // literal bound rejects: a count from the end needs the length,
  // which the read form (`slice`) has and `splice` does not.
  sliceAssignStatement(node) {
    const [, , target, value] = node;
    const [, , obj, range] = target;
    const [op, , from, to] = range;
    const int = (x) => (Emitter.isIntegerLiteral(wordOf(x)) ? parseInt(wordOf(x).replace(/_/g, ''), 10) : null);
    const plain = (x) => wordOf(x) !== undefined;
    for (const bound of [from, to]) {
      if (isNode(bound) && bound[0] === '-' && bound.length === 3 && Emitter.isIntegerLiteral(wordOf(bound[2]))) {
        throw this.positionedError(node, 'emitter: a slice assignment cannot count from the end — `splice` takes a count, not a negative index; open the range instead (`a[i..] = v`) or compute the bound from `a.length`');
      }
    }
    // A plain name goes through expr(): a reactive binding unwraps.
    const endExpr = (x) => {
      if (plain(x)) this.expr(x);
      else { this.b.emit('('); this.expr(x); this.b.emit(')'); }
    };
    this.mark(node, '$self', () => {
      this.mark(node, 'target', () => this.mark(target, '$self', () => {
        this.head(target, 'object', obj);
        this.b.emit('.splice(');
        this.mark(target, 'key', () => {
          if (isNone(from)) this.b.emit('0'); else endExpr(from);
          this.b.emit(', ');
          if (isNone(to)) {
            this.b.emit('Infinity');
          } else if (int(to) !== null && (isNone(from) || int(from) !== null)) {
            this.b.emit(String(int(to) - (isNone(from) ? 0 : int(from)) + (op === '..' ? 1 : 0)));
          } else {
            endExpr(to);
            if (!isNone(from)) { this.b.emit(' - '); endExpr(from); }
            if (op === '..') this.b.emit(' + 1');
          }
        });
      }));
      this.mark(node, 'operator', () => {});
      const inline = isNode(value) && value[0] === 'array' && value.slice(2).every((el) => !isSpread(el) && !isNone(el));
      this.mark(node, 'value', () => {
        if (inline) {
          value.slice(2).forEach((el) => { this.b.emit(', '); this.callArg(el); });
        } else {
          this.b.emit(', ...[].concat(');
          this.expr(value);
          this.b.emit(')');
        }
      });
      this.b.emit(')');
    });
  }
}
