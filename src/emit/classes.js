// Classes: class statements and expressions, members, fields, method
// bodies and super calls.
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

import { isSuperCall, isPlainCall, isNode, isNone, isStruct, wordOf, mkNode } from '../sexpr.js';
import { atParamName, isFunc, isTypedWrapper } from './tree.js';
import { Emitter } from './core.js';

// A class body's `@name` key: a static member.
const isStaticKey = (key) => isNode(key) && key[0] === '.' && key.length === 4 && wordOf(key[2]) === 'this';
// A member's name: a static key's property, or the key's own word. A
// computed or symbol key is itself.
const memberName = (key) => (isStaticKey(key) ? wordOf(key[3]) : wordOf(key) ?? key);
// The leaf that spells a member's name.
const memberLeaf = (key) => (isStaticKey(key) ? key[3] : key);

export class ClassMethods {
  // ["class", {}, name|none, parent|none, body|none] — the ES-class lowering
  // for the supported member set: methods (`->`/`=>`), the constructor,
  // and static methods (`@name:` keys). Bound methods (`=>`) bind in
  // the constructor — after a leading super(...) in subclasses, first
  // otherwise; a bound method WITHOUT an explicit constructor rejects
  // loudly. Class FIELDS are the typed-field surface — classMembers
  // lists the accepted forms.
  classStatement(node, ind) {
    this.mark(node, '$self', () => this.classCode(node, ind));
  }

  classExpr(node) {
    this.mark(node, '$self', () => this.classCode(node, this.ind));
  }

  classCode(node, ind) {
    const [, , name, parent, body] = node;
    this.b.emit('class');
    if (!isNone(name)) {
      const word = wordOf(name);
      if (word === undefined) {
        throw this.positionedError(node, 'emitter: `class @Name` is a STATIC member class — it lives inside a class body (`static Name = class`); at the top level give the class a plain name');
      }
      this.b.emit(' ');
      this.mark(node, 'name', () => this.b.emit(word));
    }
    if (!isNone(parent)) {
      this.b.emit(' extends ');
      // JavaScript takes a LeftHandSideExpression here, which is what a
      // chain HEAD is: a primary stands bare, and an await, a logical or
      // a conditional groups, or `class extends a || b {` does not parse.
      this.grouped(node, 'parent', parent, Emitter.needsGrouping(parent, 'head'));
    }
    this.b.emit(' {\n');
    if (!isNone(body)) this.withThisBoundary(() => this.mark(node, 'body', () => this.classMembers(body, ind)));
    this.b.emit('  '.repeat(ind) + '}');
  }

  // A class body's method forms beyond `name: -> …`: a `def` (its
  // `def @m` spelling static, `def m!` void) and the `get`/`set`
  // accessors (`get x: -> …`, which parse as a call of `get` on a
  // one-pair object). Each reads as the equivalent pair — the pair
  // and its function alias the original node, so their marks resolve
  // to its rows (a def's `name` role stands in for the pair's `key`).
  classMethodForm(stmt) {
    if (!isStruct(stmt)) return null;
    if (stmt[0] === 'def' && stmt.length === 5) {
      const fn = this.stores.alias(mkNode('->', stmt[3], stmt[4]), stmt);
      const pair = this.stores.alias([':', stmt[1].void === true ? { void: true } : {}, stmt[2], fn], stmt);
      return { form: 'def', pair };
    }
    const accessor = isPlainCall(stmt) ? wordOf(stmt[2]) : undefined;
    if ((accessor === 'get' || accessor === 'set') && stmt.length === 4 && this.isObject(stmt[3]) && stmt[3].length === 3) {
      const pair = stmt[3][2];
      if (isNode(pair) && pair[0] === ':' && pair[1].void !== true && pair[1].shorthand !== true && isFunc(pair[3])) {
        return { form: accessor, pair };
      }
    }
    return null;
  }

  // Whether a class member carries the `private` modifier — the
  // visibility side-band role, which the lexer admits only at the head
  // of a class body's member row, so a node that carries it is a class
  // member by construction.
  isPrivateMember(node) {
    return this.roleRow(node, 'visibility') !== null;
  }

  // Class bodies mix METHOD objects (implicit-object statements of
  // function-valued pairs) with FIELD statements (typed class
  // fields and their untyped twins):
  //   x                    → x;             ["typed-var", {}, x, T]           → x;
  //   [".", {}, "this", x] → static x;      ["typed-var", {}, this-member, T] → static x;
  //   ["=", {}, x, v]      → x = v;         ["=", {}, this-member, v]         → static x = v;
  // Fields and methods emit interleaved in source order. Anything else
  // rejects loudly.
  classMembers(body, ind) {
    const stmts = this.isBlock(body) ? body.slice(2) : [body];
    const forms = new Map(stmts.map((stmt) => [stmt, this.classMethodForm(stmt)]));
    const pad = '  '.repeat(ind + 1);
    const { bound, declared, ctorParams, ctorBody, methodBodies } = this.classBodyFacts(body, stmts, forms);
    if (this.ts && ctorParams !== null) this.declarePromotedFields(body, ctorParams, declared, pad);
    if (this.ts) this.declareAssignedFields([ctorBody, ...methodBodies], declared, pad);
    // Each member row runs through the place-or-decline probe:
    // a directive above a single-line member (typed field, field with
    // initializer, static prop) places directly above its row; method
    // rows are multi-line and decline. The pad sits INSIDE each
    // branch's emission, so the directive line takes pad-first layout.
    for (const stmt of stmts) {
      this.withTsDirectives(stmt, pad, () => this.classMember(stmt, body, ind, pad, {
        bound, form: forms.get(stmt) ?? null,
      }), true);
    }
  }

  // One walk over the whole body: the checks that span members (one
  // constructor, bound methods need it, accessor arity, a field
  // shadowing an accessor) and the facts the TS face's declarations
  // need.
  classBodyFacts(body, stmts, forms) {
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
    // Instance method bodies, for declareAssignedFields.
    const methodBodies = [];
    // Every field key and every accessor, statics keyed apart: a field
    // and an accessor of one name is a JS class where the field wins
    // silently (the instance's own property shadows the prototype's
    // accessor), so the pair rejects.
    const memberKey = (key) => (isStaticKey(key) ? `static ${wordOf(key[3])}` : memberName(key));
    const fieldKeys = new Set();
    const accessors = [];
    for (const stmt of stmts) {
      const form = forms.get(stmt) ?? null;
      const pairs = form !== null ? [form.pair] : this.isObject(stmt) ? stmt.slice(2) : null;
      if (pairs === null) {
        const isField = (key) => wordOf(key) !== undefined || isStaticKey(key);
        const fieldKey = isField(stmt) ? stmt
          : isTypedWrapper(stmt) && isField(stmt[2]) ? stmt[2]
          : isNode(stmt) && stmt[0] === '=' && stmt[1].void !== true && stmt.length === 4 && isField(stmt[2]) ? stmt[2]
          : null;
        if (fieldKey !== null) {
          fieldKeys.add(memberKey(fieldKey));
          if (!isStaticKey(fieldKey)) declared.add(memberName(fieldKey));
        }
        continue;
      }
      const accessor = form !== null && form.form !== 'def' ? form.form : null;
      for (const pair of pairs) {
        if (pair[0] !== ':' || pair[1].shorthand === true) {
          throw this.positionedError(pair, 'emitter: class bodies support methods and fields only', stmt);
        }
        const [, , key, value] = pair;
        if (accessor !== null) this.checkAccessor(pair, stmt, accessor);
        if (isNode(key) && (key[0] === 'dynamicKey' || key[0] === '[]')) {
          throw this.positionedError(pair, 'emitter: computed class members are not supported yet', stmt);
        }
        const mName = memberName(key);
        const instance = !isStaticKey(key);
        if (accessor !== null) {
          if (mName === 'constructor') {
            throw this.positionedError(pair, `emitter: a class constructor cannot be a ${accessor} accessor`, stmt);
          }
          accessors.push({ pair, stmt, key: memberKey(key), form: accessor });
        }
        // A STATIC member named `constructor` is an ordinary static
        // method; only the instance one is the class constructor.
        if (mName === 'constructor' && instance) {
          if (hasConstructor) {
            throw this.positionedError(pair, 'emitter: a class has one constructor — JavaScript refuses a second at load', stmt);
          }
          if (isFunc(value) && (this.containsAwait(value[3]) || this.containsYield(value[3]))) {
            throw this.positionedError(pair, 'emitter: a constructor cannot await or yield — JavaScript has no async or generator constructors (await in a static factory method instead)', stmt);
          }
          hasConstructor = true;
          if (isFunc(value)) { ctorParams = value[2]; ctorBody = value[3]; }
          continue;
        }
        if (instance && typeof mName === 'string') declared.add(mName);
        // A STATIC method is excluded: its `this` is the class, so what
        // it assigns is not an instance property.
        if (!isFunc(value) || !instance) continue;
        methodBodies.push(value[3]);
        if (value[0] === '=>') {
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
        throw this.positionedError(a.pair, `emitter: field and ${a.form} accessor '${memberName(a.pair[2])}' share a name — the field would shadow the accessor on every instance; drop one`, a.stmt);
      }
    }
    return { bound, declared, ctorParams, ctorBody, methodBodies };
  }

  // A `get`/`set` accessor's shape: a thin arrow that neither awaits nor
  // yields, a getter taking nothing and a setter one parameter.
  checkAccessor(pair, stmt, accessor) {
    const value = pair[3];
    const arity = value[2].length;
    if (value[0] === '=>') {
      throw this.positionedError(pair, `emitter: a ${accessor} accessor takes '->' — accessors are looked up on the instance, never bound`, stmt);
    }
    if (this.containsAwait(value[3]) || this.containsYield(value[3])) {
      throw this.positionedError(pair, `emitter: a ${accessor} accessor cannot await or yield — JavaScript has no async or generator accessors`, stmt);
    }
    if (accessor === 'get' && arity !== 0) {
      throw this.positionedError(pair, 'emitter: a getter takes no parameters (`get x: -> …`)', stmt);
    }
    if (accessor === 'set' && arity !== 1) {
      throw this.positionedError(pair, 'emitter: a setter takes exactly one parameter (`set x: (v) -> …`)', stmt);
    }
  }

  classFieldValue(value) {
    if (this.containsAwait(value)) {
      throw this.positionedError(value,
        'emitter: a class field initializer cannot await — JavaScript evaluates class fields synchronously');
    }
    if (this.containsYield(value)) {
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

  classMember(stmt, body, ind, pad, { bound, form }) {
    // A nested `class @Name` is a STATIC member class:
    // `static Name = class [extends P] { … }`.
    if (isNode(stmt) && stmt[0] === 'class' && isStaticKey(stmt[2])) {
      this.b.emit(pad + 'static ');
      this.mark(stmt, 'name', () => this.emitLeaf(stmt[2][3]));
      this.b.emit(' = ');
      this.classCode(mkNode('class', mkNode('none'), stmt[3], stmt[4]), ind + 1);
      this.b.emit(';\n');
      return;
    }
    if (form !== null || this.isObject(stmt)) {
      // The reshaped member is an object by construction — its alias
      // carries the ORIGIN's row (a `get`/`set` accessor is a call row),
      // so the call-aware object test cannot be the one to read it.
      const object = form !== null ? this.stores.alias(mkNode('object', form.pair), stmt) : stmt;
      for (const pair of object.slice(2)) {
        this.withTsDirectives(pair, pad, () => this.classMethod(pair, object, stmt, ind, pad, { bound, form }), true);
      }
      return;
    }
    // Bare field names: the untyped twins of typed bodiless fields.
    const word = wordOf(stmt);
    if (word !== undefined) {
      this.b.emit(pad + word + ';\n');
      return;
    }
    if (isStaticKey(stmt)) {
      this.b.emit(pad);
      this.mark(stmt, '$self', () => {
        this.b.emit('static ');
        this.mark(stmt, 'property', () => this.emitLeaf(stmt[3]));
      });
      this.b.emit(';\n');
      return;
    }
    // Typed bodiless field: the annotation erases, the name stays —
    // its cover row spans the emitted declaration. The TS face keeps
    // the annotation on the field.
    if (isTypedWrapper(stmt) && (wordOf(stmt[2]) !== undefined || isStaticKey(stmt[2]))) {
      this.b.emit(pad);
      this.mark(stmt, '$self', () => this.mark(stmt, 'annotation', () => {
        this.tsPrivate(stmt);
        if (isStaticKey(stmt[2])) this.b.emit('static ');
        this.mark(stmt, 'target', () => this.withDeclaredName(() => this.emitLeaf(memberLeaf(stmt[2]))));
        if (this.ts) this.tsAnnotate(stmt, 'annotation', this.typedText(stmt));
      }));
      this.b.emit(';\n');
      return;
    }
    // Field with an initializer (`x = v` / `@x = v`; the typed
    // spelling `x: T = v` erases to the same node, its annotation
    // role covering the whole emitted field).
    if (isNode(stmt) && stmt[0] === '=' && stmt[1].void !== true && stmt.length === 4 &&
        (wordOf(stmt[2]) !== undefined || isStaticKey(stmt[2]))) {
      this.ind = ind + 1;
      this.b.emit(pad);
      this.mark(stmt, 'annotation', () => this.mark(stmt, '$self', () => {
        this.tsPrivate(stmt);
        if (isStaticKey(stmt[2])) this.b.emit('static ');
        this.mark(stmt, 'target', () => this.withDeclaredName(() => this.emitLeaf(memberLeaf(stmt[2]))));
        const annotation = this.ts ? this.annotationText(stmt) : null;
        if (annotation !== null) this.tsAnnotate(stmt, 'annotation', annotation);
        this.b.emit(' ');
        this.mark(stmt, 'operator', () => this.b.emit('='));
        this.b.emit(' ');
        this.mark(stmt, 'value', () => this.withExpression(() => this.classFieldValue(stmt[3])));
      }));
      this.b.emit(';\n');
      return;
    }
    if (isNode(stmt) && stmt[0] === 'type-decl') {
      throw this.positionedError(stmt, 'emitter: type declarations are not allowed as class members — move the `type`/`interface` to module scope');
    }
    // A reactive declaration, an effect and a readonly declaration are
    // no class members: each lowers to a `const` declaration or an
    // expression statement, neither of which has a class-body reading.
    if (this.isReactiveDecl(stmt)) {
      throw this.positionedError(stmt, `emitter: a reactive declaration ('${wordOf(stmt[2]) ?? '…'} ${stmt[0] === 'state' ? ':=' : '~='} …') cannot be a class member — declare it at module or function scope`);
    }
    if (this.isEffectDecl(stmt)) {
      throw this.positionedError(stmt, `emitter: an effect ('~>') cannot be a class member — run it at module or function scope, or inside a method`);
    }
    if (this.isReadonlyDecl(stmt)) {
      throw this.positionedError(stmt, `emitter: a readonly declaration ('${wordOf(stmt[2]) ?? '…'} =! …') cannot be a class member — declare it at module or function scope`);
    }
    throw this.positionedError(stmt, "emitter: unsupported class member — fields take `name = value`, `name: T = value`, `name: T`, or their `@`-static forms; methods take `name: -> …`", body);
  }

  // One method row of a class body: `stmt` is the object holding the
  // pair (an alias when a `def` or accessor reshaped it), `origin` the
  // statement the author wrote.
  classMethod(pair, stmt, origin, ind, pad, { bound, form }) {
    const accessor = form !== null && form.form !== 'def' ? form.form : null;
    const keyRole = form !== null && form.form === 'def' ? 'name' : 'key';
    const [, , key, value] = pair;
    const mName = memberName(key);
    // A void pair is a VOID method (`fn!: ->` / `@fn!: ->`):
    // implicit return suppressed, the method returns undefined.
    const isVoidPair = pair[1].void === true;
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
      if (this.containsAwait(value[3])) this.b.emit('async ');
      if (this.containsYield(value[3])) this.b.emit('*');
      if (accessor !== null) {
        // The word parsed as a call's callee; the emission is the
        // keyword. Placed under that role (same bytes), and a ruled
        // hover silence — a keyword names nothing to hover.
        const callee = this.roleRow(origin, 'callee');
        if (callee !== null) this.silences.push([callee.sourceStart, callee.sourceEnd]);
        this.mark(origin, 'callee', () => this.b.emit(accessor));
        this.b.emit(' ');
      }
      // A symbol key (`:sym: ->`) is a computed member name.
      if (isNode(key) && key[0] === 'symbol') this.mark(pair, 'key', () => this.symbolKey(key));
      else this.mark(pair, keyRole, () => this.emitLeaf(memberLeaf(key), mName));
      // A generic def read as a method (`def id<T>(x: T): T`): the
      // TYPE_PARAMS side-band role re-emits after the name, TS-only.
      if (this.ts) {
        const tp = this.annotationText(pair, 'typeParams');
        if (tp !== null) this.b.tsOnly(() => this.mark(pair, 'typeParams', () => this.emitTypeText(pair, 'typeParams', tp)));
      }
      const isCtor = mName === 'constructor' && !isStaticKey(key);
      const { params, block, atParams } = isCtor ? this.promoteParams(value) : { params: value[2], block: value[3], atParams: [] };
      this.b.emit('(');
      // A setter's one parameter is never optional in TS (TS1051).
      this.emitParams(params, null, accessor !== 'set');
      this.b.emit(')');
      // Constructors take no return annotation in TS.
      if (!isCtor) {
        this.tsReturnAnnotation(value, this.containsAwait(value[3]), isVoidPair, this.containsYield(value[3]), pair);
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
  }

  // Promoted parameters: `(@name)` binds the argument to a same-named
  // param and assigns `this.name = name` after any leading super().
  // Inside that super call's arguments `@name` reads the PARAM
  // (`super(@name)` — `this` is not available yet); everywhere else it
  // stays a normal instance read.
  promoteParams(ctor) {
    const atParams = [];
    const strip = (p) => {
      // The plain parameter is the property's own leaf, so it maps to
      // the name the author wrote.
      const n = atParamName(p);
      if (n !== null) {
        atParams.push(n);
        return isNode(p) && p[0] === 'typed-var' ? mkNode('typed-var', p[2][3], p[3]) : p[3];
      }
      if (isNode(p) && p[0] === 'default' && p.length === 4) {
        const dn = atParamName(p[2]);
        if (dn !== null) {
          atParams.push(dn);
          // The annotation rides through the default wrapper: a
          // defaulted parameter's type would otherwise be the DEFAULT's
          // inferred type, which is wider than what the author wrote
          // (`'on' | 'off' = 'on'` reads as `string`) and contradicts
          // the field.
          const inner = p[2];
          const typed = isNode(inner) && inner[0] === 'typed-var' && inner.length === 4;
          const name = typed ? inner[2][3] : inner[3];
          return mkNode('default', typed ? mkNode('typed-var', name, inner[3]) : name, p[3]);
        }
      }
      return p;
    };
    const params = ctor[2].map(strip);
    let block = ctor[3];
    if (atParams.length > 0 && this.isBlock(block) && isSuperCall(block[2])) {
      const names = new Set(atParams);
      // A thin arrow, a def and a class bind their own `this`: an `@x`
      // inside one is that receiver's, never the parameter.
      const subst = (x) => {
        if (!isStruct(x)) return x;
        if (x[0] === '->' || x[0] === 'class' || x[0] === 'def') return x;
        if (x[0] === '.' && wordOf(x[2]) === 'this' && names.has(wordOf(x[3]))) return x[3];
        return this.aliasCopy(x.map(subst), x);
      };
      block = mkNode('block', subst(block[2]), ...block.slice(3));
    }
    return { params, block, atParams };
  }

  methodBlock(...args) {
    return this.freshCtrl(() => this.methodBlockCore(...args));
  }

  // `params` is the list the head emitted, when a constructor's
  // promotions rewrote the function's own.
  methodBlockCore(funcNode, block, ind, { isConstructor, binds, methodName, voidBody = false, tailReturn = true, voidReason = null, atParams = [], params = null }) {
    const body = this.isBlock(block) ? block.slice(2) : [block];
    const stmts = this.liveStmts(body);
    const { entries: hoist, names } = this.scopedHoist(stmts, funcNode[2]);
    for (const n of this.pushReactiveFrame(stmts, names, funcNode)) names.add(n);
    this.scopes.push(names);
    this.rejectUnboundIt(funcNode[2], block);
    const outerMethod = this.methodName;
    this.methodName = methodName;
    this.withVoidBody(voidBody, voidReason, () => this.mark(block, '$self', () => {
      this.b.emit('{\n');
      this.bodyHoistLine(hoist, ind);
      // A promoted tail parameter binds here first; its `this.name`
      // assignment follows with the other promotions.
      this.emitGapExtractions(params ?? funcNode[2], ind);
      const pad = '  '.repeat(ind + 1);
      const emitBinds = () => {
        for (const bm of binds) this.b.emit(`${pad}this.${bm} = this.${bm}.bind(this);\n`);
        // Promoted parameters assign after any leading super() — the
        // instance exists, the param carries the value.
        for (const n of atParams) this.b.emit(`${pad}this.${n} = ${n};\n`);
      };
      this.emitTsTypeDecls(body, pad);
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
    }));
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
        for (let i = 3; i < node.length; i++) {
          if (i > 3) this.b.emit(', ');
          this.callArg(node[i]);
        }
      });
      this.b.emit(')');
    });
  }
}
