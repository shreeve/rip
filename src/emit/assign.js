// Assignment and destructuring: plain, compound, optional and slice
// assignment, and middle-rest patterns.
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

import { copyShape } from '../emitter-shape.js';
import { isNode, PROTO_GENERIC_PARAMS, protoMemberTarget } from './helpers.js';
import { Emitter } from './core.js';

export class AssignMethods {
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
    this.checkMemberWrite(node, node[1]);
    const op = node[0];
    const synth = op === '//=' || op === '%%=';
    const plan = this.refPlans.get(node) ?? { recv: null, obj: null, key: null };
    if (plan.recv === null && !this.repeatSafeValue(optLink[1])) {
      throw this.positionedError(node, 'emitter: reference plan missing for an optional assignment with an impure receiver — a capture site the planner walk did not reach');
    }
    // Clones alias to their originals' ids, so every re-manifested
    // segment keeps its source mapping (the clone IS a second
    // generated manifestation of the same construct), and keep the
    // shape's facts about their originals (copyShape).
    const subst = (x) => {
      if (x === optLink) return this.stores.alias(copyShape([x[0], plan.recv ?? x[1], x[2]], x), x);
      return isNode(x) ? this.stores.alias(copyShape(x.map(subst), x), x) : x;
    };
    const target1 = subst(node[1]);
    // The temp scaffolding stays OUTSIDE the object mark, so the
    // receiver keeps its exact source mapping; the parens and temp are
    // covered by the node's $self row.
    const guard = () => {
      if (plan.recv !== null) {
        this.b.emit(`(${plan.recv} = `);
        this.mark(optLink, 'object', () => this.withExpression(() => this.expr(optLink[1])));
        this.b.emit(')');
      } else {
        this.mark(optLink, 'object', () => this.expr(optLink[1]));
      }
    };
    const value = () => this.mark(node, 'value', () => this.withExpression(() => this.expr(node[2])));
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
      let objText = null;
      if (plan.obj !== null) {
        this.b.emit(`${plan.obj} = `);
        this.mark(target1, 'object', () => this.withDeopt(() => this.expr(target1[1])));
        this.b.emit(', ');
        objText = plan.obj;
      }
      if (plan.key !== null) {
        this.b.emit(`${plan.key} = `);
        this.mark(target1, 'key', () => this.withExpression(() => this.expr(target1[2])));
        this.b.emit(', ');
      }
      const ref = ['[]', '.'].includes(target1[0]) || target1[0] === '?.' || target1[0] === 'optindex'
        ? this.stores.alias([target1[0], objText ?? target1[1], plan.key ?? target1[2]], node[1])
        : target1;
      const target = () => this.mark(node, 'target', () => this.withTarget(() => this.withDeopt(() => this.expr(ref))));
      target();
      this.b.emit(' ');
      this.mark(node, 'operator', () => this.b.emit('='));
      this.b.emit(' ');
      this.mark(node, 'operator', () => {
        this.b.emit(op === '//=' ? 'Math.floor(' : Emitter.MODULO + '(');
        target();
        this.b.emit(op === '//=' ? ' / ' : ', ');
        this.operand(node, 'value', node[2]);
        this.b.emit(')');
      });
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
    // A string-literal target is the string-NAMED class field's shape
    // (`"data-src" = v`) — the class-member walk owns that form;
    // everywhere else a string is not an assignment target.
    if (typeof node[1] === 'string' && node[1][0] === '"') {
      throw this.positionedError(node, 'emitter: a string is not an assignment target — a string-NAMED member (`"data-src" = v`) lives in a class body');
    }
    // Pattern targets emit as direct ES destructuring — names declare
    // in place or hoist like plain targets. An OBJECT pattern that
    // assigns wraps the whole assignment in parens (a bare `{` would
    // open a block); one that DECLARES needs none, `let` already
    // opens a declaration. Inside an enclosing pattern this `=` is a
    // DEFAULT, where parens/grouping are invalid destructuring JS. The
    // default's value is an expression position again.
    const patternTarget = Emitter.isPattern(node[1]);
    const declares = Emitter.declaresInPlace.has(node);
    const wrapParens = this.isObject(node[1]) && !this.inPattern && !declares;
    // A computed (`~=`) derives from its dependencies — it has no
    // legal write; the runtime's read-only container would throw at
    // the assignment, which is the loud error in the wrong place.
    if (typeof node[1] === 'string' && this.isComputedName(node[1])) {
      throw this.positionedError(node,
        `emitter: cannot assign to computed '${node[1]}' — a '~=' binding derives from its dependencies; write to those instead`);
    }
    if (typeof node[1] === 'string' && this.isAmbientReadonly(node[1])) {
      throw this.positionedError(node,
        `emitter: cannot assign to readonly '${node[1]}' — a '=!' binding never changes after its declaration`);
    }
    // Pattern elements reject too — a destructured write declares
    // nothing, so `[flag] = […]` writes the export just as `flag = …`
    // does. Inside an enclosing pattern this `=` is a DEFAULT, and the
    // pattern's own check already covered the name.
    // A middle-rest pattern has no JS destructuring form and no
    // expression lowering — only the statement path binds the source
    // once and reads by index. Reaching here means the pattern is in
    // VALUE position, where emitting it verbatim ships bytes no engine
    // parses; reject in the author's vocabulary instead (the for-range
    // ban's model), and name the statement spelling that does work.
    if (Emitter.middleRestPattern(node[1])) {
      throw this.positionedError(node,
        'emitter: a middle-rest pattern (`[a, ...mid, b]`) assigns only as a STATEMENT — '
        + 'it binds its source once and reads by index, which has no expression form; '
        + 'move the assignment to its own line');
    }
    if (!this.inPattern) this.checkExportedConstWrite(node, node[1]); this.checkImportWrite(node, node[1]);
    this.checkMemberWrite(node, node[1]);
    // A void definition (`save! = ->`, head 'void-assign') validates its
    // function value and emits as a plain '='; the value's body owns
    // the void shape. The voidMarker role (side-band) covers the
    // whole emitted assignment — the bang's only generated
    // manifestation; mark() is a no-op for plain rows (no such role).
    if (node[0] === 'void-assign') this.registerVoidValue(node[2], node);
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
    {
      const proto = protoMemberTarget(node);
      const text = proto !== null ? this.annotationText(node) : null;
      if (text !== null) {
        const protoError = (message) => {
          const id = this.stores.idOf(node);
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
        // The member name inside the augmentation marks the `::`
        // declaration's own bytes, so a definition from a use lands on
        // `String::titleCase` rather than dropping.
        const memberDecl = (() => {
          const id = this.stores.idOf(node);
          const span = id !== null ? this.stores.selfSpan(id) : null;
          const hit = span !== null ? this.stores.primitiveSpans(proto.member, span[0], span[1])[0] ?? null : null;
          return hit === null ? null : { id, start: hit.sourceStart, end: hit.sourceEnd };
        })();
        const augment = (head, tail) => {
          this.b.emit(head);
          if (memberDecl !== null) this.b.markSpan(memberDecl.id, 'identifier', memberDecl.start, memberDecl.end, () => this.b.emit(proto.member));
          else this.b.emit(proto.member);
          this.emitTypeText(node, 'annotation', tail);
        };
        if (this.moduleClassNames?.has(proto.head)) {
          if (this.ts) this.b.tsOnly(() => this.mark(node, 'annotation', () =>
            augment(`interface ${proto.head} { `, `: ${text} }\n`)));
        } else if (!this.scopes[0].has(proto.head)) {
          const params = PROTO_GENERIC_PARAMS[proto.head] ?? '';
          if (this.ts) this.b.tsOnly(() => this.mark(node, 'annotation', () =>
            augment(`declare global { interface ${proto.head}${params} { `, `: ${text} } }\n`)));
        } else {
          throw protoError(
            `emitter: the annotation on \`${proto.head}::${proto.member}\` cannot augment — ` +
            `\`${proto.head}\` is a module binding, not a class declaration, so the interface has ` +
            `nothing to merge with; declare \`class ${proto.head}\`, drop the annotation, or ` +
            'describe the member in a workspace .d.ts');
        }
      }
    }
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
        if (patternTarget) this.withPattern(() => this.expr(node[1]));
        else this.withTarget(() => this.expr(node[1]));
      });
      // A declare-in-place statement carries its type INLINE (`let x:
      // T = v`): the author's annotation when present, else the derived
      // schema story type. Both are TS-only regions, so the stripped
      // face stays byte-equal to the JS emission — annotating a
      // binding never changes shipped JS.
      if (this.ts && declares) {
        const owner = Emitter.inlineOwners.get(node);
        const text = this.annotationText(node) ?? (owner !== undefined ? this.annotationText(owner) : null);
        if (text !== null) {
          this.tsAnnotate(owner ?? node, 'annotation', text);
        } else {
          const story = this.schemaStories?.get(node);
          if (story && !story.decl.exported && story.constType !== null) {
            const bind = this.bindingNameSpan(node, 'target', story.decl.name);
            this.b.tsOnly(() => { this.b.emit(': '); this.emitNamedCopies(story.constType, story.decl.name, bind?.id ?? null, bind?.span ?? null); });
          }
        }
      }
      this.b.emit(' ');
      this.mark(node, 'operator', () => this.b.emit(node[0] === 'void-assign' ? '=' : node[0]));
      this.b.emit(' ');
      // A schema value takes its binding's name (identity for
      // SchemaError, the registry, and debug output); a component
      // value likewise (the data-part attribute).
      const prevSchemaName = this._schemaName;
      const prevComponentName = this._componentName;
      const prevComponentTypeParams = this._componentTypeParams;
      this._componentTypeParams = null;
      if (isNode(node[2]) && node[2][0] === 'schema' && typeof node[1] === 'string') {
        this._schemaName = node[1];
      }
      if (this.isComponentDecl(node[2]) && typeof node[1] === 'string') {
        this._componentName = node[1];
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
      this.mark(node, 'value', () => this.withExpression(() => this.expr(node[2])));
      if (severed) this.b.tsOnly(() => this.b.emit(') satisfies unknown'));
      this._schemaName = prevSchemaName;
      this._componentName = prevComponentName;
      this._componentTypeParams = prevComponentTypeParams;
      if (wrapParens) this.b.emit(')');
    })));
  }

  // A method body is a brace block with the function-body hoisting and
  // implicit return, except constructors (no implicit return; bind
  // statements insert after a leading super(...) call, first
  // otherwise).
  // An array pattern whose rest sits BEFORE the last element:
  // `[a, ...mid, b]` — JS forbids the shape, so it takes a statement
  // lowering instead of the destructuring passthrough.
  static middleRestPattern(x) {
    if (!isNode(x) || x[0] !== 'array') return false;
    const els = x.slice(1);
    const at = els.findIndex((e) => isNode(e) && e[0] === '...' && e.length === 2);
    return at !== -1 && at < els.length - 1;
  }

  // The middle-rest lowering: the source binds ONCE (pure sources
  // spell directly), heads read by index, the rest slices between,
  // and the tail reads from the end:
  //   [a, ...mid, b, c] = src
  //   → a = _ref[0]; mid = _ref.slice(1, -2); b = _ref[_ref.length - 2]; …
  middleRestAssign(node, ind) {
    // This lowering is dispatched AHEAD of the guarded assign path and
    // writes each name raw, so the exported-const check has to run here
    // too — `[...rest, flag] = src` reaches no other guard.
    this.checkExportedConstWrite(node, node[1]); this.checkImportWrite(node, node[1]);
    const els = node[1].slice(1);
    const at = els.findIndex((e) => isNode(e) && e[0] === '...' && e.length === 2);
    const heads = els.slice(0, at);
    const restName = els[at][1];
    const tail = els.slice(at + 1);
    for (const part of [...heads, restName, ...tail]) {
      if (typeof part !== 'string') {
        throw this.positionedError(node, 'emitter: a middle-rest pattern takes plain names (`[a, ...mid, b]`) — nested patterns have no single-read lowering');
      }
    }
    this.mark(node, '$self', () => {
      const src = node[2];
      const ref = this.repeatSafeValue(src) ? null : this.loopTempName('_ref');
      if (ref !== null) {
        // A scope-level const claims its name for the whole compile
        // (a for-header temp is reserved only while its loop emits).
        this.temps.used.add(ref);
        this.b.emit(`const ${ref} = `);
        this.mark(node, 'value', () => this.expr(src));
        this.b.emit(`;\n${'  '.repeat(ind)}`);
      }
      const srcText = () => { if (ref !== null) this.b.emit(ref); else this.expr(src); };
      const pad = () => this.b.emit(`;\n${'  '.repeat(ind)}`);
      heads.forEach((name, i) => {
        this.b.emit(`${name} = `);
        srcText();
        this.b.emit(`[${i}]`);
        pad();
      });
      this.b.emit(`${restName} = `);
      srcText();
      this.b.emit(tail.length > 0 ? `.slice(${heads.length}, -${tail.length})` : `.slice(${heads.length})`);
      tail.forEach((name, i) => {
        pad();
        this.b.emit(`${name} = `);
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
    return isNode(t) && t[0] === '[]' && t.length === 3 && isNode(t[2]) &&
      (t[2][0] === '..' || t[2][0] === '...') && t[2].length === 3 ? t : null;
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
    const [, target, value] = node;
    const [, obj, range] = target;
    const [op, from, to] = range;
    const int = (x) => Emitter.isIntegerLiteral(x) ? parseInt(x.replace(/_/g, ''), 10) : null;
    const plain = (x) => typeof x === 'string';
    for (const bound of [from, to]) {
      if (isNode(bound) && bound[0] === '-' && bound.length === 2 && Emitter.isIntegerLiteral(bound[1])) {
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
          if (from === null) this.b.emit('0'); else endExpr(from);
          this.b.emit(', ');
          if (to === null) {
            this.b.emit('Infinity');
          } else if (int(to) !== null && (from === null || int(from) !== null)) {
            this.b.emit(String(int(to) - (from === null ? 0 : int(from)) + (op === '..' ? 1 : 0)));
          } else {
            endExpr(to);
            if (from !== null) { this.b.emit(' - '); endExpr(from); }
            if (op === '..') this.b.emit(' + 1');
          }
        });
      }));
      this.mark(node, 'operator', () => {});
      // An elision is a bare ',' in the array sexpr (see array()).
      const inline = isNode(value) && value[0] === 'array' && value.slice(1).every((el) => !(isNode(el) && el[0] === '...') && el !== ',');
      this.mark(node, 'value', () => {
        if (inline) {
          value.slice(1).forEach((el) => { this.b.emit(', '); this.callArg(el); });
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
