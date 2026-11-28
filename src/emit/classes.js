// Classes: class statements and expressions, members, fields, method
// bodies and super calls.
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

import { tidyType } from '../ts/types.js';
import { copyShape } from '../emitter-shape.js';
import { isSuperCall, isPlainCall } from '../sexpr.js';
import { isShapedNode, atParamName, atParamField, ctorAtFields, isFunc, isDefHead } from './helpers.js';
import { Emitter } from './core.js';

export class ClassMethods {
  // ["class", name|null, parent|null, body?] — the ES-class lowering
  // for the supported member set: methods (`->`/`=>`), the constructor,
  // and static methods (`@name:` keys). Bound methods (`=>`) bind in
  // the constructor — after a leading super(...) in subclasses, first
  // otherwise; a bound method WITHOUT an explicit
  // constructor rejects loudly
  //. Class FIELDS are the typed-field surface —
  // classMembers lists the accepted forms.
  classStatement(node, ind) {
    this.mark(node, '$self', () => this.classCode(node, ind));
  }

  classExpr(node) {
    this.mark(node, '$self', () => this.classCode(node, this.ind));
  }

  classCode(node, ind) {
    const [, name, parent, body] = node;
    this.b.emit('class');
    if (name != null) {
      if (typeof name !== 'string') {
        throw this.positionedError(node, 'emitter: `class @Name` is a STATIC member class — it lives inside a class body (`static Name = class`); at the top level give the class a plain name');
      }
      this.b.emit(' ');
      this.mark(node, 'name', () => this.b.emit(name));
    }
    if (parent != null) {
      this.b.emit(' extends ');
      // JavaScript takes a LeftHandSideExpression here, which is what a
      // chain HEAD is: a primary stands bare, and an await, a logical or
      // a conditional groups, or `class extends a || b {` does not parse.
      this.grouped(node, 'parent', parent, Emitter.needsGrouping(parent, 'head'));
    }
    this.b.emit(' {\n');
    if (body != null) this.withThisBoundary(() => this.mark(node, 'body', () => this.classMembers(body, ind)));
    this.b.emit('  '.repeat(ind) + '}');
  }

  // Class bodies mix METHOD objects (implicit-object statements of
  // function-valued pairs) with FIELD statements (typed class
  // fields and their untyped twins):
  //   "x"                  → x;             ["typed-var", "x", "T"]      → x;
  //   [".","this","x"]     → static x;      ["typed-var", this-member, T] → static x;
  //   ["=", "x", v]        → x = v;         ["=", this-member, v]  → static x = v;
  // Fields and methods emit interleaved in source order
  //. Anything else rejects loudly.
  // A class body's method forms beyond `name: -> …`: a `def` (its
  // `def @m` spelling static, `def m!` void) and the `get`/`set`
  // accessors (`get x: -> …`, which parse as a call of `get` on a
  // one-pair object). Each reads as the equivalent pair — the pair
  // and its function alias the original node, so their marks resolve
  // to its rows (a def's `name` role stands in for the pair's `key`).
  classMethodForm(stmt) {
    if (!isShapedNode(stmt)) return null;
    if (isDefHead(stmt[0]) && stmt.length === 4) {
      const fn = this.stores.alias(['->', stmt[2], stmt[3]], stmt);
      const pair = this.stores.alias([stmt[0] === 'void-def' ? 'void-pair' : ':', stmt[1], fn], stmt);
      return { form: 'def', pair };
    }
    if (isPlainCall(stmt) && (stmt[2] === 'get' || stmt[2] === 'set') && stmt.length === 4 && this.isObject(stmt[3]) && stmt[3].length === 2) {
      const pair = stmt[3][1];
      if (isShapedNode(pair) && pair[0] === ':' && pair.length === 3 && isFunc(pair[2])) return { form: stmt[2], pair };
    }
    return null;
  }

  // Whether a class member carries the `private` modifier — the
  // visibility side-band role, which the lexer admits only at the head
  // of a class body's member row, so a node that carries it is a class
  // member by construction.
  isPrivateMember(node) {
    const id = this.stores.idOf(node);
    return id !== null && this.stores.role(id, 'visibility') !== null;
  }

  classMembers(body, ind) {
    const stmts = this.isBlock(body) ? body.slice(1) : [body];
    const forms = new Map(stmts.map((stmt) => [stmt, this.classMethodForm(stmt)]));
    const memberName = (key) => (isShapedNode(key) && key[0] === '.' && key[1] === 'this' ? key[2] : key);
    const isStaticKey = (key) => isShapedNode(key) && key[0] === '.' && key[1] === 'this' && key.length === 3 && typeof key[2] === 'string';
    const pad = '  '.repeat(ind + 1);

    // The bound-method audit spans EVERY method object in the body —
    // fields between two method groups must not hide an unbound `=>`.
    const bound = [];
    let firstBound = null;
    let hasConstructor = false;
    // The instance members the body itself names — every field form and
    // every method key, statics excluded (a static shares no name space
    // with an instance property). Collected over the WHOLE body: a
    // declaration reads to TypeScript wherever it sits, before the
    // constructor or after it.
    const declared = new Set();
    let ctorParams = null;
    let ctorBody = null;
    // Instance method bodies, for the `@field = …` pass below.
    const methodBodies = [];
    // Every field key and every accessor, statics keyed apart: a field
    // and an accessor of one name is a JS class where the field wins
    // silently (the instance's own property shadows the prototype's
    // accessor), so the pair rejects.
    const memberKey = (key) => (isStaticKey(key) ? `static ${key[2]}` : key);
    const fieldKeys = new Set();
    const accessors = [];
    for (const stmt of stmts) {
      const form = forms.get(stmt) ?? null;
      const pairs = form !== null ? [form.pair] : this.isObject(stmt) ? stmt.slice(1) : null;
      if (pairs === null) {
        const fieldKey = typeof stmt === 'string' || isStaticKey(stmt) ? stmt
          : Emitter.isTypedWrapper(stmt) && (typeof stmt[1] === 'string' || isStaticKey(stmt[1])) ? stmt[1]
          : isShapedNode(stmt) && stmt[0] === '=' && stmt.length === 3 && (typeof stmt[1] === 'string' || isStaticKey(stmt[1])) ? stmt[1]
          : null;
        if (fieldKey !== null) {
          fieldKeys.add(memberKey(fieldKey));
          if (!isStaticKey(fieldKey)) declared.add(fieldKey);
        }
        continue;
      }
      for (const pair of pairs) {
        if (pair[0] !== ':' && pair[0] !== 'void-pair') {
          throw this.positionedError(pair, 'emitter: class bodies support methods and fields only', stmt);
        }
        if (form !== null && form.form !== 'def') {
          const arity = pair[2][1].length;
          if (pair[2][0] === '=>') {
            throw this.positionedError(pair, `emitter: a ${form.form} accessor takes '->' — accessors are looked up on the instance, never bound`, stmt);
          }
          if (this.containsAwait(pair[2][2]) || Emitter.containsYield(pair[2][2])) {
            throw this.positionedError(pair, `emitter: a ${form.form} accessor cannot await or yield — JavaScript has no async or generator accessors`, stmt);
          }
          if (form.form === 'get' && arity !== 0) {
            throw this.positionedError(pair, 'emitter: a getter takes no parameters (`get x: -> …`)', stmt);
          }
          if (form.form === 'set' && arity !== 1) {
            throw this.positionedError(pair, 'emitter: a setter takes exactly one parameter (`set x: (v) -> …`)', stmt);
          }
        }
        if (isShapedNode(pair[1]) && (pair[1][0] === 'dynamicKey' || pair[1][0] === '[]')) {
          throw this.positionedError(pair, 'emitter: computed class members are not supported yet', stmt);
        }
        const mName = memberName(pair[1]);
        if (form !== null && form.form !== 'def') {
          if (mName === 'constructor') {
            throw this.positionedError(pair, `emitter: a class constructor cannot be a ${form.form} accessor`, stmt);
          }
          accessors.push({ pair, stmt, key: memberKey(pair[1]), form: form.form });
        }
        // A STATIC member named `constructor` is an ordinary static
        // method; only the instance one is the class constructor.
        if (mName === 'constructor' && !isStaticKey(pair[1])) {
          if (hasConstructor) {
            throw this.positionedError(pair, 'emitter: a class has one constructor — JavaScript refuses a second at load', stmt);
          }
          if (isFunc(pair[2]) && (this.containsAwait(pair[2][2]) || Emitter.containsYield(pair[2][2]))) {
            throw this.positionedError(pair, 'emitter: a constructor cannot await or yield — JavaScript has no async or generator constructors (await in a static factory method instead)', stmt);
          }
          hasConstructor = true;
          if (isFunc(pair[2])) { ctorParams = pair[2][1]; ctorBody = pair[2][2]; }
        } else if (!isStaticKey(pair[1]) && typeof mName === 'string') {
          declared.add(mName);
        }
        // A STATIC method is excluded: its `this` is the class, so what
        // it assigns is not an instance property.
        if (isFunc(pair[2]) && !isStaticKey(pair[1]) && mName !== 'constructor') {
          methodBodies.push(pair[2][2]);
        }
        if (isFunc(pair[2]) && pair[2][0] === '=>' && !isStaticKey(pair[1]) && mName !== 'constructor') {
          if (typeof mName !== 'string') {
            throw this.positionedError(pair, "emitter: a symbol-keyed method cannot be bound ('=>') — the constructor binds members by name; use '->'", stmt);
          }
          bound.push(mName);
          firstBound ??= pair;
        }
      }
    }
    if (bound.length > 0 && !hasConstructor) {
      throw this.positionedError(firstBound, "emitter: bound ('=>') class methods require an explicit constructor", body);
    }
    for (const a of accessors) {
      if (fieldKeys.has(a.key)) {
        throw this.positionedError(a.pair, `emitter: field and ${a.form} accessor '${memberName(a.pair[1])}' share a name — the field would shadow the accessor on every instance; drop one`, a.stmt);
      }
    }

    // A promoted parameter (`constructor: (@owner: string) ->`) assigns
    // the instance property but declares nothing, and TypeScript reads a
    // class's properties from its DECLARATIONS alone — never from what
    // the constructor assigns — so the TS face declares what the
    // promotion implies. TS-only: the JS twin's property comes from the
    // constructor's assignment, where a declaration would not describe
    // the field but REDEFINE it, on class-field semantics. The body's
    // own declaration wins when both spellings are present — one
    // declaration, or TypeScript reads the pair as duplicate identifiers.
    if (this.ts && ctorParams !== null) {
      for (const p of ctorParams) {
        const field = atParamField(p);
        if (field === null || declared.has(field.name)) continue;
        declared.add(field.name);
        const text = field.typed === null ? null
          : this.annotationText(field.typed) ?? (field.typed[2] === '' ? null : tidyType(field.typed[2]));
        // The field's name marks the promoted parameter's own bytes (its
        // first occurrence in the class body is the `@name` parameter), so
        // a definition from a read lands on the constructor's parameter.
        const bodyId = this.stores.idOf(body);
        const bodySpan = bodyId !== null ? this.stores.selfSpan(bodyId) : null;
        const at = bodySpan !== null ? this.stores.primitiveSpans(field.name, bodySpan[0], bodySpan[1])[0] ?? null : null;
        this.b.tsOnly(() => {
          this.b.emit(pad);
          if (at) this.b.markSpan(bodyId, 'identifier', at.sourceStart, at.sourceEnd, () => this.b.emit(field.name));
          else this.b.emit(field.name);
          this.b.emit(`${text ? `: ${text}` : ''};\n`);
        });
      }
    }

    // An instance method's `@field = value` is the same story as a
    // promoted parameter, by a different route: it assigns the instance
    // property and declares nothing, and TypeScript reads a class's
    // properties from its declarations alone — so every assignment AND
    // every read publishes TS2339 on code that runs correctly. The face
    // declares what the assignment implies, with the author's own
    // annotation when there is one. TS-only, for the promoted
    // parameter's reason: in JS the property comes from the assignment,
    // where a declaration would REDEFINE it rather than describe it.
    //
    // Control flow is walked THROUGH (a field assigned inside an `if`
    // still declares) but a nested plain function is not: its `this` is
    // not this instance's, so an assignment there says nothing about this
    // class. The `declared` set keeps a body-level declaration winning,
    // here as for promotions — one declaration, or TypeScript reads the
    // pair as duplicate identifiers.
    //
    // A field only a BOUND ARROW assigns spells `: any` when the author
    // did not annotate it: TypeScript's constructor inference does not
    // descend into arrows, so its bare declaration would be an implicit
    // any — TS7008 under noImplicitAny, minted on generated-only bytes
    // no source position answers for (the tsScaffoldAny doctrine).
    //
    // EVERY instance method feeds this, not the constructor alone — see
    // ctorAtFields. The constructor leads so source order holds.
    if (this.ts) {
      for (const at of ctorAtFields([ctorBody, ...methodBodies])) {
        if (declared.has(at.name)) continue;
        declared.add(at.name);
        // The annotation can ride ANY of the field's assignments — the
        // first one that resolves wins, so ordering against an arrow's
        // earlier unannotated write cannot drop it.
        const annotated = at.nodes.map((n) => this.annotationText(n)).find((t) => t != null) ?? null;
        const text = annotated ?? (at.viaArrow ? 'any' : null);
        this.b.tsOnly(() => this.b.emit(`${pad}${at.name}${text ? `: ${text}` : ''};\n`));
      }
    }

    // Each member row runs through the place-or-decline probe:
    // a directive above a single-line member (typed field, field with
    // initializer, static prop) places directly above its row; method
    // rows are multi-line and decline. The pad sits INSIDE each
    // branch's emission, so the directive line takes pad-first layout.
    for (const stmt of stmts) {
      this.withTsDirectives(stmt, pad, () => this.classMember(stmt, body, ind, pad, {
        memberName, isStaticKey, bound, form: forms.get(stmt) ?? null,
      }), true);
    }
  }

  classFieldValue(value) {
    if (this.containsAwait(value)) {
      throw this.positionedError(value,
        'emitter: a class field initializer cannot await — JavaScript evaluates class fields synchronously');
    }
    if (Emitter.containsYield(value)) {
      throw this.positionedError(value,
        'emitter: a class field initializer cannot yield — class field evaluation is not a generator context');
    }
    const entries = [];
    const field = this.fieldPlans.get(this.stores.idOf(value));
    if (field !== undefined) this.pushPlanTemps(entries, field.plans, this.factNodes([value], field.value));
    if (entries.length === 0) {
      this.expr(value);
      return;
    }
    // A fresh arrow activation owns every capture for one field
    // evaluation. Arrow lexicality preserves this/super; the checks
    // above keep await/yield from crossing the generated boundary.
    this.b.emit('(() => { ');
    this.hoistLine(entries);
    this.b.emit(' return ');
    this.expr(value);
    this.b.emit('; })()');
  }

  classMember(stmt, body, ind, pad, { memberName, isStaticKey, bound, form }) {
    const accessor = form !== null && form.form !== 'def' ? form.form : null;
    const keyRole = form !== null && form.form === 'def' ? 'name' : 'key';
    const origin = stmt;
    // The reshaped member is an object by construction — its alias
    // carries the ORIGIN's row (a `get`/`set` accessor is a call row),
    // so the call-aware object test cannot be the one to read it.
    if (form !== null) stmt = this.stores.alias(['object', form.pair], stmt);
    {
      // A nested `class @Name` is a STATIC member class:
      // `static Name = class [extends P] { … }`.
      if (isShapedNode(stmt) && stmt[0] === 'class' && isShapedNode(stmt[1]) &&
          stmt[1][0] === '.' && stmt[1][1] === 'this' && typeof stmt[1][2] === 'string') {
        this.b.emit(pad + 'static ');
        this.mark(stmt, 'name', () => this.emitPrimitive(stmt[1][2]));
        this.b.emit(' = ');
        this.classCode(['class', null, stmt[2] ?? null, stmt[3]], ind + 1);
        this.b.emit(';\n');
        return;
      }
      if (form !== null || this.isObject(stmt)) {
        for (const pair of stmt.slice(1)) this.withTsDirectives(pair, pad, () => {
          const key = pair[1];
          const value = pair[2];
          const mName = memberName(key);
          // A void-pair is a VOID method (`fn!: ->` / `@fn!: ->`):
          // implicit return suppressed, the method returns undefined.
          const isVoidPair = pair[0] === 'void-pair';
          if (!isFunc(value)) {
            if (isVoidPair) {
              throw this.positionedError(pair, "emitter: the void marker (a trailing '!' on the method key) requires a function value — `fn!: ->` (this class member's value is not a function)", stmt);
            }
            throw this.positionedError(pair, "emitter: a class field takes '=' for its value (`x = v`, `x: T = v`, `@x = v`) — `name: value` is a typed bodiless field only when the value is a TYPE", stmt);
          }
          // A constructor returns its instance by construction — the
          // void marker contradicts it.
          if (isVoidPair && mName === 'constructor') {
            throw this.positionedError(pair, "emitter: a constructor cannot carry the void marker (`constructor!:`) — constructors have no implicit return to suppress", stmt);
          }
          if (mName === 'constructor' && !isStaticKey(key) && this.isPrivateMember(pair)) {
            throw this.positionedError(pair, "emitter: `private constructor` is not supported — `private` hides the members a class keeps to itself; the constructor is its callers' entry", stmt);
          }
          this.b.emit(pad);
          this.mark(pair, 'voidMarker', () => this.mark(pair, '$self', () => {
            this.tsPrivate(pair);
            if (isStaticKey(key)) this.b.emit('static ');
            if (this.containsAwait(value[2])) this.b.emit('async ');
            if (Emitter.containsYield(value[2])) this.b.emit('*');
            if (accessor !== null) {
              // The word parsed as a call's callee; the emission is the
              // keyword. Placed under that role (same bytes), and a ruled
              // hover silence — a keyword names nothing to hover.
              const originId = this.stores.idOf(origin);
              const callee = originId !== null ? this.stores.role(originId, 'callee') : null;
              if (callee !== null) this.silences.push([callee.sourceStart, callee.sourceEnd]);
              this.mark(origin, 'callee', () => this.b.emit(accessor));
              this.b.emit(' ');
            }
            // A symbol key (`:sym: ->`) is a computed member name.
            if (isShapedNode(key) && key[0] === 'symbol') this.mark(pair, 'key', () => this.symbolKey(key));
            else this.mark(pair, keyRole, () => this.emitPrimitive(mName));
            // A generic def read as a method (`def id<T>(x: T): T`): the
            // TYPE_PARAMS side-band role re-emits after the name, TS-only.
            if (this.ts) {
              const tp = this.annotationText(pair, 'typeParams');
              if (tp !== null) this.b.tsOnly(() => this.mark(pair, 'typeParams', () => this.emitTypeText(pair, 'typeParams', tp)));
            }
            let [, params, block] = value;
            let atParams = [];
            const isCtor = mName === 'constructor' && !isStaticKey(pair[1]);
            if (isCtor) {
              // Promoted parameters: `(@name)` binds the argument to
              // a same-named param and assigns `this.name = name`
              // after any leading super(). Inside that super call's
              // arguments `@name` reads the PARAM (`super(@name)` —
              // `this` is not available yet); everywhere else it
              // stays a normal instance read.
              const strip = (p) => {
                const n = atParamName(p);
                if (n !== null) {
                  atParams.push(n);
                  return isShapedNode(p) && p[0] === 'typed-var' ? ['typed-var', n, p[2]] : n;
                }
                if (isShapedNode(p) && p[0] === 'default' && p.length === 3) {
                  const dn = atParamName(p[1]);
                  if (dn !== null) {
                    atParams.push(dn);
                    // The annotation rides through the default wrapper:
                    // a defaulted parameter's type would otherwise be
                    // the DEFAULT's inferred type, which is wider than
                    // what the author wrote (`'on' | 'off' = 'on'`
                    // reads as `string`) and contradicts the field.
                    const typed = isShapedNode(p[1]) && p[1][0] === 'typed-var' && p[1].length === 3;
                    return ['default', typed ? ['typed-var', dn, p[1][2]] : dn, p[2]];
                  }
                }
                return p;
              };
              params = params.map(strip);
              if (atParams.length > 0 && this.isBlock(block) &&
                  isSuperCall(block[1])) {
                const names = new Set(atParams);
                // A thin arrow, a def and a class bind their own `this`:
                // an `@x` inside one is that receiver's, never the
                // parameter.
                const subst = (x) => {
                  if (!isShapedNode(x)) return x;
                  if (x[0] === '->' || x[0] === 'class' || isDefHead(x[0])) return x;
                  if (x[0] === '.' && x[1] === 'this' && names.has(x[2])) return x[2];
                  return this.stores.alias(copyShape(x.map(subst), x), x);
                };
                block = ['block', subst(block[1]), ...block.slice(2)];
              }
            }
            this.b.emit('(');
            // A setter's one parameter is never optional in TS (TS1051).
            this.emitParams(params, null, accessor !== 'set');
            this.b.emit(')');
            // Constructors take no return annotation in TS.
            if (!isCtor) {
              this.tsReturnAnnotation(value, this.containsAwait(value[2]), isVoidPair, Emitter.containsYield(value[2]), pair);
            }
            this.b.emit(' ');
            this.mark(pair, 'value', () => {
              this.methodBlock(value, block, ind + 1, {
                isConstructor: isCtor,
                binds: isCtor ? bound : [],
                methodName: typeof mName === 'string' ? mName : 'symbol',
                // A setter's value is discarded by the language: its
                // body emits void — no implicit return, and none of
                // the bang method's explicit `return;` either.
                voidBody: isVoidPair || accessor === 'set',
                tailReturn: accessor !== 'set',
                voidReason: accessor === 'set' ? 'a setter discards its return value' : null,
                atParams,
                params,
              });
            });
          }));
          this.b.emit('\n');
        }, true);
        return;
      }
      // Bare field names: the untyped twins of typed bodiless fields.
      if (typeof stmt === 'string') {
        this.b.emit(pad + stmt + ';\n');
        return;
      }
      if (isStaticKey(stmt)) {
        this.b.emit(pad);
        this.mark(stmt, '$self', () => {
          this.b.emit('static ');
          this.mark(stmt, 'property', () => this.emitPrimitive(stmt[2]));
        });
        this.b.emit(';\n');
        return;
      }
      // Typed bodiless field: the annotation erases, the name stays —
      // its cover row spans the emitted declaration. The TS face keeps
      // the annotation on the field.
      if (Emitter.isTypedWrapper(stmt) &&
          (typeof stmt[1] === 'string' || isStaticKey(stmt[1]))) {
        this.b.emit(pad);
        this.mark(stmt, '$self', () => this.mark(stmt, 'annotation', () => {
          this.tsPrivate(stmt);
          if (isStaticKey(stmt[1])) this.b.emit('static ');
          this.mark(stmt, 'target', () => this.withDeclaredName(() => this.emitPrimitive(memberName(stmt[1]))));
          if (this.ts) this.tsAnnotate(stmt, 'annotation', this.annotationText(stmt) ?? tidyType(stmt[2]));
        }));
        this.b.emit(';\n');
        return;
      }
      // Field with an initializer (`x = v` / `@x = v`; the typed
      // spelling `x: T = v` erases to the same node, its annotation
      // role covering the whole emitted field).
      if (isShapedNode(stmt) && stmt[0] === '=' && stmt.length === 3 &&
          (typeof stmt[1] === 'string' || isStaticKey(stmt[1]))) {
        this.ind = ind + 1;
        this.b.emit(pad);
        this.mark(stmt, 'annotation', () => this.mark(stmt, '$self', () => {
          this.tsPrivate(stmt);
          if (isStaticKey(stmt[1])) this.b.emit('static ');
          this.mark(stmt, 'target', () => this.withDeclaredName(() => this.emitPrimitive(memberName(stmt[1]))));
          if (this.ts && this.annotationText(stmt) !== null) {
            this.tsAnnotate(stmt, 'annotation', this.annotationText(stmt));
          }
          this.b.emit(' ');
          this.mark(stmt, 'operator', () => this.b.emit('='));
          this.b.emit(' ');
          this.mark(stmt, 'value', () => this.withExpression(() => this.classFieldValue(stmt[2])));
        }));
        this.b.emit(';\n');
        return;
      }
      if (isShapedNode(stmt) && stmt[0] === 'type-decl') {
        throw this.positionedError(stmt, 'emitter: type declarations are not allowed as class members — move the `type`/`interface` to module scope');
      }
      // A reactive declaration is no class member: its lowering is a
      // `const` declaration, which cannot sit in a class body
      if (this.isReactiveDecl(stmt)) {
        throw this.positionedError(stmt, `emitter: a reactive declaration ('${typeof stmt[1] === 'string' ? stmt[1] : '…'} ${stmt[0] === 'state' ? ':=' : '~='} …') cannot be a class member — declare it at module or function scope`);
      }
      // An effect is no class member either: the bare form is an
      // expression statement, the bound form a const declaration —
      // neither has a member reading .
      if (this.isEffectDecl(stmt)) {
        throw this.positionedError(stmt, `emitter: an effect ('~>') cannot be a class member — run it at module or function scope, or inside a method`);
      }
      // A readonly declaration is the same class (a `const` lowering
      // with no class-body reading).
      if (this.isReadonlyDecl(stmt)) {
        throw this.positionedError(stmt, `emitter: a readonly declaration ('${typeof stmt[1] === 'string' ? stmt[1] : '…'} =! …') cannot be a class member — declare it at module or function scope`);
      }
      throw this.positionedError(stmt, "emitter: unsupported class member — fields take `name = value`, `name: T = value`, `name: T`, or their `@`-static forms; methods take `name: -> …`", body);
    }
  }

  methodBlock(...args) {
    return this.freshCtrl(() => this.methodBlockCore(...args));
  }

  methodBlockCore(funcNode, block, ind, { isConstructor, binds, methodName, voidBody = false, tailReturn = true, voidReason = null, atParams = [], params = funcNode[1] }) {
    const stmts = this.liveStmts(this.isBlock(block) ? block.slice(1) : [block]);
    const { entries: hoist, names } = this.scopedHoist(stmts, funcNode[1]);
    for (const n of this.pushReactiveFrame(stmts, names, funcNode)) names.add(n);
    this.scopes.push(names);
    this.rejectUnboundIt(funcNode[1], block);
    const outerMethod = this.methodName;
    this.methodName = methodName;
    const prevSEO = this.sideEffectOnly;
    const prevReason = this.voidReason;
    this.sideEffectOnly = voidBody;
    this.voidReason = voidReason;
    this.mark(block, '$self', () => {
      this.b.emit('{\n');
      if (hoist.length) {
        this.b.emit('  '.repeat(ind + 1));
        this.hoistLine(hoist, '  '.repeat(ind + 1));
        this.b.emit('\n');
      }
      // A promoted tail parameter binds here first; its `this.name`
      // assignment follows with the other promotions.
      this.emitGapExtractions(params, ind);
      const pad = '  '.repeat(ind + 1);
      const emitBinds = () => {
        for (const bm of binds) this.b.emit(`${pad}this.${bm} = this.${bm}.bind(this);\n`);
        // Promoted parameters assign after any leading super() — the
        // instance exists, the param carries the value.
        for (const n of atParams) this.b.emit(`${pad}this.${n} = ${n};\n`);
      };
      this.emitTsTypeDecls(this.isBlock(block) ? block.slice(1) : [block], pad);
      this.mark(block, 'statements', () => {
        const leadingSuper = isConstructor && stmts.length > 0 && isSuperCall(stmts[0]);
        if (!leadingSuper) emitBinds();
        stmts.forEach((stmt, i) => {
          this.b.emit(pad);
          const last = i === stmts.length - 1;
          if (!isConstructor && !voidBody && last) this.implicitReturn(stmt, ind + 1);
          else this.statement(stmt, ind + 1, !last || !isConstructor);
          this.b.emit('\n');
          if (leadingSuper && i === 0) emitBinds();
        });
      });
      if (tailReturn) this.voidTailReturn(stmts, ind);
      this.b.emit('  '.repeat(ind) + '}');
    });
    this.sideEffectOnly = prevSEO;
    this.voidReason = prevReason;
    this.methodName = outerMethod;
    this.scopes.pop();
    this.rframes.pop();
  }

  // ["call", {}, "super", ...args] — a bare super call: `super(args)`
  // inside the constructor; `super.<method>(args)` inside any other
  // method (the method-name shorthand). Outside a class method there is
  // no super home — reject loudly.
  superCall(node) {
    if (!this.methodName) {
      throw this.positionedError(node, 'emitter: super outside a class method');
    }
    this.mark(node, '$self', () => {
      this.b.emit(this.methodName === 'constructor' ? 'super(' : `super.${this.methodName}(`);
      this.mark(node, 'args', () => {
        node.slice(3).forEach((arg, i) => {
          if (i > 0) this.b.emit(', ');
          this.callArg(arg);
        });
      });
      this.b.emit(')');
    });
  }
}
