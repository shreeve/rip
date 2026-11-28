// Components: declarations, the member model, the static render DSL.
//
// A component declaration lowers to an anonymous class extending the
// runtime's __Component: members categorize into the declaration
// model; value members initialize in SOURCE ORDER inside
// _init(<props>), offers register next, and effects start last (a
// reaction never fires against a half-built instance); methods and the
// lifecycle hooks emit as class methods; the render block
// lowers to _create()/_setup(). The categorization is TOTAL — a body
// statement matching no category REJECTS positioned,
// duplicate members and render blocks reject, and
// `offer` takes a state declaration only (#127).
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

import { isComponentName, memberPathText, componentPathRoot, restReadKeys } from '../render.js';
import { TEMPLATE_TAGS, SVG_ONLY_TAGS, DOM_EVENTS, BOOLEAN_ATTRS } from '../dom.js';
import { hostText, surfaceableTag } from '../ts/dom-types.js';
import { COMPONENT_HOOKS } from './names.js';
import { hookParamTypes, componentTypeInfo, plainBehaviorValued, stateBehaviorValued, publicProps, propsTypeText, readonlyCastType, gateProjection } from '../ts/components.js';
import { isCall } from '../sexpr.js';
import { COMPONENT_RUNTIME_FIELDS, isNode, isFunc, isHtmlTag } from './helpers.js';
import { Emitter } from './core.js';

export class ComponentMethods {
  // The lifecycle hooks (src/emit/names.js).
  static COMPONENT_HOOKS = COMPONENT_HOOKS;

  // Boolean HTML attributes the render DSL toggles as properties of
  // presence — src/dom.js is the single source (the VS Code
  // grammar's own-line flag rule reads the same set).
  static BOOLEAN_ATTRS = BOOLEAN_ATTRS;

  static SVG_NS = 'http://www.w3.org/2000/svg';

  // The kind checks: a plumbing list can begin with the names `render`,
  // `offer` or `accept`, so the NodeStore semanticKind decides
  // everywhere (the head-naming convention).
  isComponentDecl(x) {
    return Emitter.isComponentDeclIn(this.stores, x);
  }

  static isComponentDeclIn(stores, x) {
    if (!isNode(x) || x[0] !== 'component' || x.length !== 3) return false;
    const id = stores.idOf(x);
    return (id !== null ? stores.node(id)?.semanticKind : null) === 'component';
  }

  componentKindOf(x, kind, len) {
    if (!isNode(x) || x[0] !== kind || x.length !== len) return false;
    const id = this.stores.idOf(x);
    return (id !== null ? this.stores.node(id)?.semanticKind : null) === kind;
  }

  isRenderNode(x) { return this.componentKindOf(x, 'render', 2); }
  isOfferNode(x) { return this.componentKindOf(x, 'offer', 2); }
  isAcceptNode(x) { return this.componentKindOf(x, 'accept', 2) || this.componentKindOf(x, 'accept', 3); }

  // A member TARGET: `x` (private) or `@x` ([".", "this", "x"] —
  // public). Returns { name, isPublic } or null.
  static memberTarget(t) {
    if (typeof t === 'string') return { name: t, isPublic: false };
    if (isNode(t) && t[0] === '.' && t[1] === 'this' && t.length === 3 && typeof t[2] === 'string') {
      return { name: t[2], isPublic: true };
    }
    return null;
  }

  static gateChain(node) {
    const segments = [];
    let current = node;
    while (isNode(current) && current[0] === '.' && current.length === 3 && typeof current[2] === 'string') {
      segments.unshift(current[2]);
      current = current[1];
    }
    if (typeof current !== 'string') return null;
    segments.unshift(current);
    return segments;
  }

  // Pure analysis of the source-only gate descriptor. Nothing here
  // consults generated text: path and key policy are facts of the tree.
  static gateSource(node) {
    const pathNode = node[2];
    const keys = node.slice(3);
    if (keys.length > 1) return { error: 'arity', node };
    const key = keys[0] ?? null;
    const segments = Emitter.gateChain(pathNode);
    if (segments === null || segments.length < 3 ||
        segments[0] !== 'this' || segments[1] !== 'stash') {
      return { error: 'path', node: pathNode };
    }
    const path = segments.slice(2).join('.');
    if (key === null) return { path, pathNode, key: null, keyCode: null, keyParts: null };

    if (typeof key === 'string' &&
        (/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(key.replace(/_/g, '')) ||
         /^["'][^]*["']$/.test(key) || key === 'true' || key === 'false')) {
      return { path, pathNode, key, keyCode: key, keyParts: null };
    }
    const keySegments = Emitter.gateChain(key);
    if (keySegments === null) return { error: 'key', node: key };
    if (keySegments[0] === 'this') keySegments.shift();
    if (keySegments[0] !== 'params' && keySegments[0] !== 'query') {
      return { error: 'key', node: key };
    }
    return { path, pathNode, key, keyCode: keySegments.join('.'), keyParts: keySegments };
  }

  // Deterministic FNV-1a (32-bit) over a JSON payload — HMR shape/impl
  // fingerprints. Emission-only; never rediscovered from generated text.
  static hmrFingerprint(value) {
    const s = JSON.stringify(value);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  // static __hmrId / __hmrSig for a module-scope named component.
  // Call only when `this.hmr && this.modulePath` — the production path
  // never reaches here.
  emitComponentHmrMeta(pad, {
    bindingName, declaredProps, stateVars, derivedVars, gateVars,
    extendsTag, methods, hooks, hasRender, initNames,
  }) {
    const sortNames = (names) => [...names].sort();
    const props = sortNames(declaredProps);
    const state = sortNames(stateVars.map((m) => m.name));
    const computed = sortNames(derivedVars.map((m) => m.name));
    const methodNames = sortNames(methods.map((m) => m.name));
    const hookNames = sortNames(hooks.map((h) => h.name));
    const gates = gateVars.length;
    const shape = Emitter.hmrFingerprint({ props, state, computed, gates, extends: extendsTag });
    const impl = Emitter.hmrFingerprint({ methods: methodNames, hooks: hookNames, render: hasRender });
    const id = `${this.modulePath}#${bindingName}`;
    // `inits` fingerprints each `:=` initializer's COMPILED text, the
    // text its `__hmrInit` thunk re-states, so whitespace and quote
    // style never reset a slot. Source order, which is reset order.
    const inits = {};
    this.scopes.push(initNames);
    this.rframes.push({ reactive: new Set(), bound: initNames });
    try {
      for (const m of stateVars) {
        if (m.value === undefined) continue;
        inits[m.name] = Emitter.hmrFingerprint(this.capturedExprText(() => this.componentInitValue(m.value)));
      }
    } finally {
      this.rframes.pop();
      this.scopes.pop();
    }
    const sig = { shape, impl, state, computed, props, gates, extends: extendsTag, inits };
    this.b.emit(`${pad}static __hmrId = ${JSON.stringify(id)};\n`);
    this.b.emit(`${pad}static __hmrSig = ${JSON.stringify(sig)};\n`);
  }

  componentInitValue(value) {
    const wrap = Emitter.needsGrouping(value, 'operand');
    if (wrap) this.b.emit('(');
    this.expr(value);
    if (wrap) this.b.emit(')');
  }

  // static __hmrInit — one thunk per `:=` slot with an initializer,
  // called with the instance as `this`, so a patch can re-run a changed
  // initializer without re-running `_init`. A public slot's thunk
  // spells the default alone: whether the construction site supplies
  // the value is the runtime's to know. Each thunk is its own function
  // scope, so the inner assignment targets `_init` hoists at its top
  // hoist here per slot (analysis's slot facts). Same gate as
  // emitComponentHmrMeta.
  emitComponentHmrInit(pad, { stateVars, initNames, initFacts }) {
    const slots = [];
    for (const m of stateVars) {
      if (m.value === undefined) continue;
      const slot = initFacts?.slots?.get(this.stores.idOf(m.value)) ?? null;
      slots.push({ m, entries: this.scopedHoist([m.value], [], slot).entries });
    }
    if (slots.length === 0) return;
    this.b.emit(`${pad}static __hmrInit = {\n`);
    this.scopes.push(initNames);
    this.rframes.push({ reactive: new Set(), bound: initNames });
    try {
      for (const { m, entries } of slots) {
        this.b.emit(`${pad}  ${m.name}() { `);
        if (entries.length) {
          this.hoistLine(entries);
          this.b.emit(' ');
        }
        this.b.emit('return ');
        this.mark(m.node, 'value', () => this.withExpression(() => this.componentInitValue(m.value)));
        this.b.emit('; },\n');
      }
    } finally {
      this.rframes.pop();
      this.scopes.pop();
    }
    this.b.emit(`${pad}};\n`);
  }

  // ["component", parent, ["block", …]] — the declaration. Expression
  // position (the value of `Card = component …`); statement position
  // groups like a class expression.
  componentExpr(node) {
    const [, parent, body] = node;
    // `component extends <host>` — the rest-forwarding surface. The
    // host is an HTML tag, or a component this module binds or imports;
    // the render must construct it, and the caller's undeclared props
    // land on it. A component host is delegation, never inheritance:
    // nothing of its body is visible here, and its class is not this
    // class's parent.
    let extendsTag = null;
    let extendsComponent = null;
    if (parent !== null) {
      const p = typeof parent === 'string' ? parent : memberPathText(parent);
      const root = p !== null ? componentPathRoot(p) : null;
      if (p !== null && isHtmlTag(p) && !p.includes('#')) {
        extendsTag = p;
      } else if (p !== null && isComponentName(p.slice(p.lastIndexOf('.') + 1)) && (this.inScope(root) || this.moduleBound.has(root))) {
        if (p === this._componentName) {
          throw this.positionedError(node,
            `emitter: component '${p}' cannot extend itself — the render would construct it without end`);
        }
        // The declaration file spells the host through the path, and it
        // declares imports and components, never a plain value.
        if (root !== p && this.importSpecOf(root) === null) {
          throw this.positionedError(node,
            `emitter: 'component extends ${p}' roots at '${root}', a binding of this module — a host named through a ` +
            'path must root at an import (`import * as Ns …`), since a declaration file spells the host through it');
        }
        extendsComponent = p;
      } else {
        throw this.positionedError(node,
          `emitter: 'component extends' takes an HTML tag or a component bound in this module — rest props forward ` +
          `onto the first one the render creates; '${p ?? '…'}' is neither`);
      }
    }
    const extendsHost = extendsTag ?? extendsComponent;
    // A component host's name is a real reference on the face (the
    // class declares `typeof <Host>` under it), so its span is kept
    // for the mark that makes definition and hover answer there.
    let hostSpan = null;
    let hostNodeId = null;
    // The head's grammar words own no recorded positions, so their
    // bytes would fall to the class expression's cover row — a hover
    // there describes (and highlights) the WHOLE lowered class. The
    // words the grammar spends join the silence channel and decline;
    // the extends TAG is a real element reference and serves the
    // intrinsics tag row (RULINGS.md, the element-tag row). Byte
    // arithmetic on the node's own span, verified before recording —
    // a head that stops opening on `component` records nothing.
    if (this.ts) {
      const id = this.stores.idOf(node) ?? null;
      const span = id !== null ? this.stores.selfSpan(id) : null;
      const src = this.b.source;
      if (span !== null && src !== null && src.startsWith('component', span[0])) {
        this.silences.push([span[0], span[0] + 'component'.length]);
        if (extendsHost !== null) {
          const head = /^component(\s+)extends(\s+)/.exec(src.slice(span[0], span[1]));
          if (head !== null && src.startsWith(extendsHost, span[0] + head[0].length)) {
            const exStart = span[0] + 'component'.length + head[1].length;
            this.silences.push([exStart, exStart + 'extends'.length]);
            const tagStart = span[0] + head[0].length;
            if (extendsTag !== null) {
              this.intrinsics.push({ start: tagStart, end: tagStart + extendsTag.length, kind: 'tag', tag: extendsTag, svg: false });
            } else {
              hostSpan = [tagStart, tagStart + extendsComponent.length];
              hostNodeId = id;
            }
          }
        }
      }
    }
    const stmts = this.isBlock(body) ? body.slice(1) : [];

    // ── Categorization: the member model, total by construction ──
    const readonlyVars = [];
    const plainVars = [];
    const stateVars = [];
    const derivedVars = [];
    const gateVars = [];
    const methods = [];
    const hooks = [];
    const effects = [];
    const offeredVars = [];
    const acceptedVars = [];
    const acceptProviders = new Map();
    let renderNode = null;

    const members = new Map();       // name → kind (the frame's map)
    const memberReactive = new Set();
    const seen = new Map();          // name → first-declaring stmt (dup detection, hooks included)
    const declare = (name, kind, stmt, reactive) => {
      if (seen.has(name)) {
        throw this.positionedError(stmt,
          `emitter: duplicate component member '${name}' — it is already declared in this component body; ` +
          `duplicates clobber silently across kinds`, node);
      }
      if (COMPONENT_RUNTIME_FIELDS.has(name)) {
        throw this.positionedError(stmt,
          `emitter: component member '${name}' collides with component runtime state — ` +
          'the runtime owns this exact instance field; rename the member', node);
      }
      // The generated-lifecycle namespace: the lowering emits these
      // very method names into the same class body, so a same-named
      // member becomes a DUPLICATE class method — JS keeps the last,
      // silently replacing the generated machinery at runtime.
      if (name === '_init' || name === '_create' || name === '_setup' || /^create_block_\d+$/.test(name)) {
        throw this.positionedError(stmt,
          `emitter: component member '${name}' collides with the generated lifecycle machinery — '_init', ` +
          "'_create', '_setup', and 'create_block_N' are the class methods the component lowering emits (a " +
          'same-named member would silently replace the generated one at runtime); rename the member', node);
      }
      // The component runtime API: `mount`/`unmount`/`emit` are
      // __Component's methods — a same-named member silently shadows
      // the prototype (the child protocol and unmount cascade CALL
      // these on every instance), and the typed artifacts would
      // declare the name twice (the
      // rest-under-extends rejection is the precedent; the
      // runtime already rejects declared PROPS of these names at
      // construction, so the compile rejection closes the private-
      // member half of the same hazard).
      if (name === 'mount' || name === 'unmount' || name === '_bound') {
        throw this.positionedError(stmt,
          `emitter: component member '${name}' collides with the component runtime API — 'mount', 'unmount', and '_bound' ` +
          "are __Component's own methods, and the machinery calls them on every instance (a " +
          'same-named member would silently shadow them); rename the member', node);
      }
      seen.set(name, stmt);
      if (kind !== 'hook') {
        members.set(name, kind);
        if (reactive) memberReactive.add(name);
      }
    };
    const rejectBody = (stmt) => {
      const msg =
        'emitter: a component body line must be a member declaration — state (`x := v`, `@x := v`), a prop (`@x`, `@x?`), ' +
        'computed (`x ~= e`), readonly (`x =! v`), a plain field (`x = v`), a method (`save = (e) ->`), a lifecycle hook ' +
        '(beforeMount/mounted/beforeUnmount/unmounted/onError), an effect (`~> …`), `offer`/`accept`, or `render` — ' +
        'this statement matches no category';
      // PRIMITIVE body lines (a bare string or number literal) carry
      // no NodeStore row, so the standard fallback would point at the
      // component head. Derive the offending line's span from the
      // NEIGHBORING statements' recorded spans instead (the
      // positionedErrorAt convention: derived, never invented).
      const src = this.b.source;
      if ((!isNode(stmt) || this.stores.idOf(stmt) === null) && src !== null) {
        const spanOf = (x) => {
          const id = isNode(x) ? this.stores.idOf(x) : null;
          return id !== null ? this.stores.selfSpan(id) : null;
        };
        const k = stmts.indexOf(stmt);
        const blockSpan = spanOf(body);
        let start = null;
        for (let j = k - 1; j >= 0 && start === null; j--) start = spanOf(stmts[j])?.[1] ?? null;
        if (start === null) start = blockSpan?.[0] ?? null;
        if (start !== null) {
          while (start < src.length && /\s/.test(src[start])) start++;
          let end = null;
          for (let j = k + 1; j < stmts.length && end === null; j++) end = spanOf(stmts[j])?.[0] ?? null;
          if (end === null) end = blockSpan?.[1] ?? start;
          while (end > start && /\s/.test(src[end - 1])) end--;
          throw this.positionedErrorAt(start, end, msg);
        }
      }
      throw this.positionedError(stmt, msg, node);
    };
    const gateError = (stmt, role, at, message) => {
      const id = this.stores.idOf(stmt);
      const row = id !== null ? this.stores.role(id, role) : null;
      if (row?.sourceStart != null) {
        throw this.positionedErrorAt(row.sourceStart, row.sourceEnd, message);
      }
      throw this.positionedError(at, message, stmt, node);
    };

    const categorize = (stmt, offered) => {
      if (this.isRenderNode(stmt)) {
        if (offered) rejectOffer(stmt);
        if (renderNode !== null) {
          throw this.positionedError(stmt,
            'emitter: duplicate render block — a component takes exactly one', node);
        }
        renderNode = stmt;
        return;
      }
      if (this.isAcceptNode(stmt)) {
        if (offered) rejectOffer(stmt);
        this.noteHeadKeyword('context-channel', 'accept', stmt);
        if (stmt.length === 2) {
          throw this.positionedError(stmt,
            `emitter: accept names its provider — \`accept ${stmt[1]} from <Component>\` reads the nearest ` +
            'ancestor instance of that component', node);
        }
        const provider = typeof stmt[2] === 'string' ? stmt[2] : memberPathText(stmt[2]);
        const root = provider !== null ? componentPathRoot(provider) : null;
        if (!(provider !== null && isComponentName(provider.slice(provider.lastIndexOf('.') + 1)) &&
              (this.inScope(root) || this.moduleBound.has(root)))) {
          throw this.positionedError(stmt,
            `emitter: accept reads from a component bound in this module — '${provider ?? '…'}' is not one`, node);
        }
        // As a host's: the declaration file spells the member through the path.
        if (root !== provider && this.importSpecOf(root) === null) {
          throw this.positionedError(stmt,
            `emitter: accept reads from '${provider}', which roots at '${root}', a binding of this module — a provider ` +
            'named through a path must root at an import (`import * as Ns …`), since a declaration file spells the ' +
            'member through it', node);
        }
        declare(stmt[1], 'accept', stmt, true);
        acceptedVars.push(stmt[1]);
        acceptProviders.set(stmt[1], stmt[2]);
        return;
      }
      if (this.isGateDecl(stmt)) {
        if (offered) rejectOffer(stmt);
        const target = Emitter.memberTarget(stmt[1]);
        if (target === null) {
          gateError(stmt, 'target', stmt[1],
            "emitter: a render gate ('<~') target must be one private component name — patterns and member chains cannot name a gate");
        }
        if (target.isPublic) {
          gateError(stmt, 'target', stmt[1],
            `emitter: render gate '${target.name}' must be private — '@${target.name} <~ …' would expose route-prefetched state as a caller prop; remove '@' and pass an explicit prop where public input is intended`);
        }
        const source = Emitter.gateSource(stmt);
        if (source.error === 'arity') {
          gateError(stmt, 'key', source.node,
            "emitter: a keyed render gate takes exactly one key argument — use @stash.name(params.id)");
        }
        if (source.error === 'path') {
          gateError(stmt, 'rhs', source.node,
            "emitter: '<~' requires a literal @stash.<path> on the right-hand side, optionally called with one key");
        }
        if (source.error === 'key') {
          gateError(stmt, 'key', source.node,
            "emitter: a keyed render gate key may only be a literal, params, query, or a path into one (for example params.id or @query.tab)");
        }
        declare(target.name, 'gate', stmt, true);
        gateVars.push({ name: target.name, ...source, node: stmt });
        return;
      }
      if (this.isReactiveDecl(stmt)) {
        const t = Emitter.memberTarget(stmt[1]);
        if (t === null) {
          throw this.positionedError(stmt,
            `emitter: a component ${stmt[0] === 'state' ? 'state' : 'computed'} member takes a plain name or '@name' — ` +
            'patterns and member chains have no member reading ', node);
        }
        if (stmt[0] === 'state') {
          if (this.firstAwaitIn(stmt[2]) !== null) {
            throw this.positionedError(stmt, "emitter: a component state initializer cannot await or yield — _init runs synchronously during construction", node);
          }
          declare(t.name, 'state', stmt, true);
          stateVars.push({ name: t.name, value: stmt[2], isPublic: t.isPublic, required: false, node: stmt });
        } else {
          if (this.containsAwait(stmt[2])) {
            throw this.positionedError(stmt, "emitter: a computed ('~=') body cannot await — computeds evaluate synchronously (make it a state written by an effect)", node);
          }
          if (Emitter.containsYield(stmt[2])) {
            throw this.positionedError(stmt, "emitter: a computed ('~=') body cannot yield — computeds evaluate synchronously", node);
          }
          declare(t.name, 'computed', stmt, true);
          derivedVars.push({ name: t.name, value: stmt[2], node: stmt });
        }
        return;
      }
      if (this.isReadonlyDecl(stmt)) {
        const t = Emitter.memberTarget(stmt[1]);
        if (t === null) {
          throw this.positionedError(stmt,
            "emitter: a component readonly member takes a plain name or '@name' — patterns and member chains have no member reading ", node);
        }
        if (this.firstAwaitIn(stmt[2]) !== null) {
          throw this.positionedError(stmt, "emitter: a component readonly initializer cannot await or yield — _init runs synchronously during construction", node);
        }
        declare(t.name, 'readonly', stmt, false);
        readonlyVars.push({ name: t.name, value: stmt[2], isPublic: t.isPublic, node: stmt });
        return;
      }
      if (this.isEffectDecl(stmt)) {
        if (offered) rejectOffer(stmt);
        if (stmt[1] !== null) {
          throw this.positionedError(stmt,
            `emitter: a bound effect ('${typeof stmt[1] === 'string' ? stmt[1] : '…'} ~> …') has no component-body reading — ` +
            'the handle would bind nothing; use a bare `~> …` effect, or bind the handle inside a method', node);
        }
        // Same contract as every other effect position: the runtime
        // calls the effect function, so a generator body would never
        // run. Component effects emit outside effectValue's funnel,
        // so the check must live here too.
        if (Emitter.effectBodyYields(stmt[2])) {
          throw this.positionedError(stmt, "emitter: an effect ('~>') body cannot yield — the runtime calls the effect function (make the generator a named function the effect calls)", stmt);
        }
        effects.push(stmt);
        return;
      }
      // Bare prop `@name`; optional `@name?`; typed `@name: T`.
      if (isNode(stmt) && stmt[0] === '?' && stmt.length === 2) {
        const t = Emitter.memberTarget(stmt[1]);
        if (t !== null && t.isPublic) {
          declare(t.name, 'prop', stmt, true);
          stateVars.push({ name: t.name, value: undefined, isPublic: true, required: false, optional: true, node: stmt });
          return;
        }
        rejectBody(stmt);
      }
      if (Emitter.isTypedWrapper(stmt)) {
        const t = Emitter.memberTarget(stmt[1]);
        if (t !== null && t.isPublic) {
          declare(t.name, 'prop', stmt, true);
          stateVars.push({ name: t.name, value: undefined, isPublic: true, required: true, node: stmt });
          return;
        }
        rejectBody(stmt);
      }
      if (isNode(stmt) && stmt[0] === '.' && stmt[1] === 'this' && stmt.length === 3 && typeof stmt[2] === 'string') {
        declare(stmt[2], 'prop', stmt, true);
        stateVars.push({ name: stmt[2], value: undefined, isPublic: true, required: true, node: stmt });
        return;
      }
      // Plain assigns: fields, methods, lifecycle hooks.
      if (isNode(stmt) && (stmt[0] === '=' || stmt[0] === 'void-assign') && stmt.length === 3) {
        const t = Emitter.memberTarget(stmt[1]);
        if (t === null) rejectBody(stmt);
        const isVoid = stmt[0] === 'void-assign';
        if (Emitter.COMPONENT_HOOKS.has(t.name)) {
          if (offered) rejectOffer(stmt);
          if (!isFunc(stmt[2])) {
            throw this.positionedError(stmt,
              `emitter: the lifecycle hook '${t.name}' takes a function value — \`${t.name} = -> …\``, node);
          }
          declare(t.name, 'hook', stmt, false);
          hooks.push({ name: t.name, func: stmt[2], isVoid, node: stmt });
          return;
        }
        if (isFunc(stmt[2])) {
          declare(t.name, 'method', stmt, false);
          methods.push({ name: t.name, func: stmt[2], isVoid, node: stmt });
          return;
        }
        if (isVoid) {
          throw this.positionedError(stmt, "emitter: the void marker (a trailing '!' on the defined name) requires a function value — `save! = ->`", node);
        }
        if (this.firstAwaitIn(stmt[2]) !== null) {
          throw this.positionedError(stmt, "emitter: a component member initializer cannot await or yield — _init runs synchronously during construction", node);
        }
        declare(t.name, 'plain', stmt, false);
        plainVars.push({ name: t.name, value: stmt[2], isPublic: t.isPublic, node: stmt });
        return;
      }
      // Colon-method groups (`save: (e) -> …` lines wrap into one
      // implicit object statement).
      if (this.isObject(stmt)) {
        if (offered) rejectOffer(stmt);
        for (const pair of stmt.slice(1)) {
          if (!isNode(pair) || (pair[0] !== ':' && pair[0] !== 'void-pair') || typeof pair[1] !== 'string' || !isFunc(pair[2])) {
            rejectBody(stmt);
          }
          const isVoid = pair[0] === 'void-pair';
          if (Emitter.COMPONENT_HOOKS.has(pair[1])) {
            declare(pair[1], 'hook', stmt, false);
            hooks.push({ name: pair[1], func: pair[2], isVoid, node: pair });
          } else {
            declare(pair[1], 'method', stmt, false);
            methods.push({ name: pair[1], func: pair[2], isVoid, node: pair });
          }
        }
        return;
      }
      rejectBody(stmt);
    };
    const rejectOffer = (stmt) => {
      throw this.positionedError(stmt,
        'emitter: offer takes a state declaration — `offer theme := v` — so every offered value is a ' +
        'container an accept reads and writes', node);
    };

    for (const stmt of stmts) {
      if (this.isOfferNode(stmt)) {
        const payload = stmt[1];
        if (!(this.isReactiveDecl(payload) && payload[0] === 'state')) rejectOffer(stmt);
        this.noteHeadKeyword('context-channel', 'offer', stmt);
        categorize(payload, true);
        const t = Emitter.memberTarget(payload[1]);
        offeredVars.push(t.name);
        continue;
      }
      categorize(stmt, false);
    }
    // Declared props — the names a parent may pass; the runtime's
    // constructor validates incoming keys against this set (the
    // compile half of that validation).
    const declaredProps = [];
    for (const { name, isPublic } of [...stateVars, ...readonlyVars, ...plainVars]) {
      if (isPublic) declaredProps.push(name);
    }

    // Under `extends`, `rest` is the runtime-owned reactive view of
    // the undeclared caller props — a user member of that name would
    // shadow the machinery.
    if (extendsHost !== null) {
      if (seen.has('rest')) {
        throw this.positionedError(seen.get('rest'),
          "emitter: a component that extends a host cannot declare a member named 'rest' — `@rest` is the reactive " +
          'view of the undeclared caller props (the rest-forwarding seam)', node);
      }
      members.set('rest', 'rest');
      memberReactive.add('rest');
      // `asChild` is the caller's word for rendering the projected
      // element as the host; a declared prop of that name would take it
      // off the rest map before the host line could read it.
      if (declaredProps.includes('asChild')) {
        throw this.positionedError(seen.get('asChild'),
          "emitter: a component that extends a host cannot declare a prop named 'asChild' — `asChild` at a " +
          'call site renders the projected element as the host, and the key is reserved beside key, ref, and children', node);
      }
    }

    // ── Emission ──
    // A MODULE-SCOPE component binding claims its name once (both
    // modes — F3(b)): rebinding compiles
    // silently on main (the second class wins; instances of the
    // first keep the old identity) and the typed artifacts would
    // merge two same-named companion interfaces silently — loud
    // beats both. Keyed by node so the builder probe's
    // re-emission of one statement never self-collides; nested
    // scopes (function bodies, member-held components) are out —
    // their bindings never reach the module surface.
    if (this.scopes.length === 1 && typeof this._componentName === 'string') {
      const prior = this.moduleComponentNames.get(this._componentName);
      if (prior !== undefined && prior !== node) {
        throw this.positionedError(node,
          `emitter: component '${this._componentName}' is bound more than once at module scope — rebinding ` +
          'clobbers the first class silently (existing instances keep the old identity) and the typed artifacts ' +
          'would merge two same-named companion interfaces; give each component its own name');
      }
      this.moduleComponentNames.set(this._componentName, node);
    }
    // The type story (TS face only): walked ONCE here — after
    // every rejection class above has had its chance — and kept for
    // the companion-interface emission after the binding statement.
    // The behavior object's name — set only where a companion
    // INTERFACE is emitted to name in its `this` parameter, which is
    // exactly a module-scope named binding (the condition just above,
    // a strict subset of the two companion call sites). Everything
    // else — a member-held declaration, a binding inside a function —
    // keeps the form table.
    const behavior = this.ts && this.scopes.length === 1 && typeof this._componentName === 'string'
      ? `__${this._componentName}__computed` : null;
    const tsInfo = this.ts ? componentTypeInfo(this.stores, this.b.source, node, behavior) : null;
    if (tsInfo) {
      tsInfo.hostSpan = hostSpan;
      tsInfo.hostNodeId = hostNodeId;
      tsInfo.appStashSpec = this.appStashSpec;
      tsInfo.routesUnion = this.routesUnion;
      tsInfo.routeParams = this.routeParams;
    }
    if (tsInfo !== null) this.componentInfo.set(node, tsInfo);
    // The member KINDS this component declares, so a read inside its body
    // answers the way the declaration does — scoped to the innermost
    // component, so a consumer holding an instance is never touched.
    const memberKinds = new Map();
    for (const m of tsInfo?.members ?? []) {
      const label = Emitter.memberLabel(m);
      if (label !== null) memberKinds.set(m.name, { label, optional: m.optional === true });
    }
    // The provided `rest` view is no declared member, but its reads mint a
    // kind of their own: `(rest)`, the view of the undeclared caller props.
    if (extendsHost !== null) memberKinds.set('rest', { label: 'rest', optional: false });
    // The keys the body reads back through `@rest`: a read of `class`
    // or `style` takes that key out of the host line's automatic merge.
    const restReads = extendsHost !== null ? restReadKeys(stmts) : new Set();
    const frame = { members, memberReactive, memberKinds, name: this._componentName, extendsTag, extendsComponent, restReads, plainWrites: new Map(), renderPlainReads: new Set() };
    const ind = this.ind;
    const pad = '  '.repeat(ind + 1);
    const ipad = pad + '  ';
    this.cframes.push(frame);
    this.rframes.push({ reactive: new Set(), bound: new Set(), members, memberReactive, memberKinds });
    const prevMethod = this.methodName;
    this.methodName = null;

    // _init hoists inner assignment targets of member initializers at
    // its own top (each is a real function scope). Multi-statement
    // computed (`~=`) bodies are excluded — they open their own
    // funcBlock hoist via computedBody; parenthetical blocks on
    // readonly/plain/state still emit inline here and must keep
    // collecting (otherwise `this.x = (a = 1, a)` throws undeclared).
    const initValues = [
      ...[...readonlyVars, ...plainVars, ...stateVars].map((m) => m.value),
      ...derivedVars
        .map((m) => m.value)
        .filter((v) => !(this.isBlock(v) && v.length > 2)),
    ].filter((v) => v !== undefined);
    const initFacts = this.hoistOf(initValues);
    const { entries: initHoist, names: initNames } = this.scopedHoist(initValues, [], initFacts);

    this.mark(node, '$self', () => {
      this.b.emit('class');
      // Generic component: the declaration's
      // TYPE_PARAMS side-band role (threaded by assign(), the
      // _componentName pattern) emits on the lowered class — a
      // TS-only region on the class expression (`class<TOption
      // extends TOptionShape> extends __Component`), erased from JS.
      if (this.ts && this._componentTypeParams) {
        const { text, owner } = this._componentTypeParams;
        this.b.tsOnly(() => this.mark(owner, 'typeParams', () =>
          this.emitTypeText(owner, 'typeParams', text)));
      }
      this.b.emit(` extends ${this.runtimeName('__Component')} {\n`);
      if (tsInfo !== null) this.tsComponentMemberDeclares(tsInfo, pad);
      if (gateVars.length > 0) {
        // This source-ordered array is the gate ABI: the same gateVars
        // order emits each _init __gateBind index below, and the app
        // renderer fills its addressed binding array by this static index.
        this.b.emit(`${pad}static __gates = [`);
        gateVars.forEach((gate, index) => {
          if (index > 0) this.b.emit(', ');
          // `@stash` is the marker that makes this a gate. With a face
          // TWIN (emitGateTwin — a discovered stash), the segments have a
          // real typed expression to answer from, so they stay in the
          // mapping population — the twin's claims, emitted above, own
          // them. Without one the lowering erases the read entirely,
          // keeping only the route name: RULINGS.md pins those segments
          // to silence — there is nothing for them to answer — and the
          // key's segments, which reach only the minted key fn's own
          // scaffold, decline the same way.
          const twinned = this.ts && tsInfo !== null &&
            tsInfo.members.some((m) => m.node === gate.node && this.gateTwinSource(m, tsInfo) !== null);
          if (!twinned) {
            this.noteVocabulary('gate-prefix', 'stash', gate.pathNode);
            for (const seg of gate.keyParts ?? []) this.noteSilence(seg, gate.key);
          }
          this.mark(gate.node, '$self', () => {
            this.mark(gate.node, 'operator', () => {});
            this.mark(gate.node, 'rhs', () => {
              if (gate.key === null) {
                this.emitQuotedPrimitive(gate.path);
              } else {
                // The key fn is minted scaffold, but its params model
                // exactly the runtime values the class ambience declares
                // (`params`/`query` are `Record<string, string>` route
                // state), so they carry that type rather than scaffold
                // `any` — a position that maps into this cover (the twin
                // and this fn both cover the key span; precedence is a
                // mapping fact, not a contract) then answers the real
                // type, never `any`.
                this.b.emit('{ path: ');
                this.emitQuotedPrimitive(gate.path);
                this.b.emit(', key: (params');
                if (this.ts) this.b.tsOnly(() => this.b.emit(': Record<string, string>'));
                this.b.emit(', query');
                if (this.ts) this.b.tsOnly(() => this.b.emit(': Record<string, string>'));
                this.b.emit(') => ');
                this.mark(gate.node, 'key', () => {
                  this.mark(gate.key, '$self', () => {
                    // `@query.tab` drops its `@`, so the chain is not verbatim
                    // and its cover cannot place the segments — each identifier
                    // claims its own occurrence inside the key's own span.
                    if (gate.keyParts === null) { this.b.emit(gate.keyCode); return; }
                    gate.keyParts.forEach((seg, i) => {
                      if (i > 0) this.b.emit('.');
                      this.emitPrimitive(seg);
                    });
                  });
                });
                this.b.emit(' }');
              }
            });
          });
        });
        this.b.emit('];\n');
      }
      if (declaredProps.length > 0) {
        this.b.emit(`${pad}static __props = [${declaredProps.map((n) => `'${n}'`).join(', ')}];\n`);
      }
      if (extendsHost !== null) {
        // The runtime's rest seam reads this: undeclared constructor
        // props collect into the reactive `rest` view and forward
        // onto the host (the rest machinery lives on __Component).
        // A tag's string claims the head's occurrence of the tag; a
        // component's never claims — the head's bytes belong to the face
        // reference, and the next free occurrence would be the render's
        // construction of the host.
        this.b.emit(`${pad}static __extends = `);
        if (extendsTag !== null) this.emitQuotedPrimitive(extendsTag);
        else this.b.emit(`'${extendsComponent}'`);
        this.b.emit(';\n');
      }
      if (this.scopes.length === 1 && typeof this._componentName === 'string') {
        this.componentNames.push(this._componentName);
        if (tsInfo !== null) {
          this.componentProps[this._componentName] = {
            required: publicProps(tsInfo).filter((m) => !m.optional && !m.hasDefault).map((m) => m.name),
          };
        }
      }
      // HMR identity/signature — module-scope named components only.
      // Gated on `hmr`: off keeps production bytes unchanged.
      const hmrMeta = this.hmr && this.modulePath && this.scopes.length === 1 && typeof this._componentName === 'string';
      if (hmrMeta) {
        this.emitComponentHmrMeta(pad, {
          bindingName: this._componentName,
          declaredProps,
          stateVars,
          derivedVars,
          gateVars,
          extendsTag: extendsHost,
          methods,
          hooks,
          hasRender: renderNode !== null,
          initNames,
        });
      }
      if (tsInfo !== null) this.tsComponentCtor(tsInfo, pad);
      // `_init` overrides the base's public member, so it carries no
      // modifier; the editor's runtime-private list keeps it from consumers.
      // The props parameter is minted: a member initializer may read a
      // source binding of the base spelling.
      const given = this.loopTempName('__given');
      this.b.emit(pad);
      this.b.emit(`_init(${given}`);
      if (tsInfo !== null) this.b.tsOnly(() => { this.b.emit(': '); this.emitDeclaredTypeCopies(propsTypeText(tsInfo, { road: 'face' })); });
      this.b.emit(') {\n');
      this.scopes.push(initNames);
      this.rframes.push({ reactive: new Set(), bound: initNames });
      if (initHoist.length) {
        this.b.emit(ipad);
        this.hoistLine(initHoist, ipad);
        this.b.emit('\n');
      }
      const initLine = (stmt, fn) => {
        // A directive above a component member declaration rides its
        // _init line — the error for a wrong-typed member value lands
        // exactly there.
        this.renderDirectives(stmt, ipad);
        this.b.emit(ipad);
        this.mark(stmt, '$self', fn);
        this.b.emit(';\n');
      };
      const memberValue = (stmt, value) => {
        this.mark(stmt, 'value', () => this.withExpression(() => {
          const wrap = Emitter.needsGrouping(value, 'operand');
          if (wrap) this.b.emit('(');
          this.expr(value);
          if (wrap) this.b.emit(')');
        }));
      };
      // Each member's emitted NAME re-marks the declaration's target
      // role — an exact row inside the line's cover when the source
      // spells the bare name (a breakpoint on the declaration lands on
      // its init line); `@name` targets record covers.
      const memberName = (stmt, name, role = 'target') => {
        const lhsStart = this.b.offset;
        this.b.emit('this.');
        this.mark(stmt, role, () => this.b.emit(name));
        if (this.ts) {
          const id = this.stores.idOf(stmt);
          const row = id !== null ? this.stores.role(id, role) : null;
          if (row && typeof row.sourceStart === 'number') this.memberInitSites.push({ key: [row.sourceStart, row.sourceEnd], site: [lhsStart, this.b.offset] });
        }
      };
      const readonlySet = new Set(readonlyVars);
      // Captured computed bodies, in declaration order — the face's
      // behavior object, emitted with the companion interface it names.
      const computedBodies = [];
      if (tsInfo !== null) tsInfo.computedBodies = computedBodies;
      const emitPlainish = (m) => {
        initLine(m.node, () => {
          // A readonly (`=!`) member declares `readonly` on the class,
          // and TS allows readonly writes only in the CONSTRUCTOR —
          // _init is the lowering's seam, so its one legitimate write
          // quiets through a TS-only cast (strip restores `this.x`).
          // The cast states the MEMBER's own type, mutable: `as any`
          // would swallow the initializer's value check with TS2540.
          if (readonlySet.has(m) && this.ts) {
            const tm = tsInfo?.members.find((x) => x.node === m.node && x.kind === 'readonly');
            this.b.tsOnly(() => this.b.emit('('));
            this.b.emit('this');
            // The readonly member's cast names its own TYPE (`this as {
            // menuItems: AvatarMenuItem[] }`), so the declared types it
            // spells are copies like every other generated one.
            this.b.tsOnly(() => {
              this.b.emit(' as ');
              this.emitDeclaredTypeCopies(tm ? readonlyCastType(tm) : 'any');
              this.b.emit(')');
            });
            this.b.emit('.');
            this.mark(m.node, 'target', () => this.b.emit(m.name));
          } else {
            memberName(m.node, m.name);
          }
          this.b.emit(' = ');
          if (m.isPublic) this.b.emit(`${given}.${m.name} ?? `);
          // A member-held component declaration takes the MEMBER's
          // name (its data-part and placeholder identity), so the
          // nested declaration inherits the ENCLOSING component's
          // name (graduated here).
          const prevCN = this._componentName;
          if (this.isComponentDecl(m.value)) this._componentName = m.name;
          memberValue(m.node, m.value);
          this._componentName = prevCN;
        });
        // The face's behavior thunk for a plain member the form table
        // cannot spell — the same capture as emitComputed below, under
        // the shared plainBehaviorValued predicate, so the class field
        // that calls the thunk always finds it. The copy lowers member
        // reads exactly as the real emission does; the rollback returns
        // everything it consumed.
        if (behavior !== null && tsInfo !== null) {
          const tm = tsInfo.members.find((x) => x.node === m.node);
          if (tm !== undefined && plainBehaviorValued(tm)) {
            const code = this.capturedExprText(() => memberValue(m.node, m.value));
            computedBodies.push({ name: m.name, code, block: false });
          }
        }
      };
      const emitAccept = (name) => {
        const stmt = seen.get(name);
        initLine(stmt, () => {
          memberName(stmt, name, 'name');
          // The provider is a real reference, marked on the bytes the author
          // wrote after `from`, so the name there hovers, defines, renames,
          // and colors as the component it names.
          this.b.emit(` = ${this.runtimeName('getContext')}(`);
          this.mark(stmt, 'provider', () => {
            const provider = acceptProviders.get(name);
            if (typeof provider === 'string') this.noteNameSpan(provider);
            else this.expr(provider);
          });
          this.b.emit(`, '${name}')`);
        });
      };
      const emitState = (m) => {
        initLine(m.node, () => {
          memberName(m.node, m.name, m.value === undefined ? 'property' : 'target');
          this.b.emit(` = ${this.runtimeName('__state')}(`);
          if (m.isPublic && (m.required || m.value === undefined)) {
            this.b.emit(`${given}.__bind_${m.name}__ ?? ${given}.${m.name}`);
            // A REQUIRED prop's props type is an intersection with a
            // two-arm union (`{name: …} | {__bind_name__: …}`), so one
            // of the pair is always present — a correlation no
            // narrowing recovers, since neither arm mentions the
            // other's key. The TS-only assertion states it; the
            // optional spellings carry `| undefined` honestly and get
            // none.
            if (m.required && this.ts) this.b.tsOnly(() => this.b.emit('!'));
          } else if (m.isPublic) {
            this.b.emit(`${given}.__bind_${m.name}__ ?? ${given}.${m.name} ?? `);
            memberValue(m.node, m.value);
          } else {
            memberValue(m.node, m.value);
          }
          this.b.emit(')');
        });
        if (behavior !== null && tsInfo !== null) {
          const tm = tsInfo.members.find((x) => x.node === m.node);
          if (tm !== undefined && stateBehaviorValued(tm)) {
            const code = this.capturedExprText(() => memberValue(m.node, m.value));
            computedBodies.push({ name: m.name, code, block: false });
          }
        }
      };
      const emitComputed = (m) => {
        initLine(m.node, () => {
          memberName(m.node, m.name);
          this.b.emit(` = ${this.runtimeName('__computed')}(() => `);
          this.mark(m.node, 'value', () => this.withExpression(() => this.computedBody(m.node, m.value, ind + 2)));
          this.b.emit(')');
        });
        // The same body a second time, through capturedExprText, for
        // the face's behavior object: emitted from HERE because the
        // component's frames are live only here, so the copy lowers
        // member reads exactly as the real one does. The capture's
        // rollback is load-bearing, not hygiene — a body is arbitrary
        // code, so the copy can mint loop temps and walk the
        // declare-in-place scan, and everything it consumes or records
        // must be returned before the real emission continues. An
        // ANNOTATED computed is skipped: its declaration is the
        // author's, not the body's.
        if (behavior === null || tsInfo === null) return;
        const tm = tsInfo.members.find((x) => x.node === m.node && x.kind === 'computed');
        if (tm === undefined || tm.annotation != null) return;
        const code = this.capturedExprText(() => this.computedBody(m.node, m.value, 0));
        computedBodies.push({ name: m.name, code, block: this.isBlock(m.value) && m.value.length > 2 });
      };
      // Under a discovered stash the face names the gate's cell type, the
      // stash projection, so the member's type — an annotation included —
      // checks against what the stash yields.
      const emitGate = (gate, index) => {
        initLine(gate.node, () => {
          memberName(gate.node, gate.name);
          this.b.emit(` = ${this.runtimeName('__gateBind')}`);
          const projection = this.ts && this.appStashSpec !== null ? gateProjection(gate, this.appStashSpec) : null;
          if (projection !== null) this.b.tsOnly(() => this.b.emit(`<${projection}>`));
          this.b.emit('(');
          this.mark(gate.node, 'operator', () => {});
          this.mark(gate.node, 'rhs', () => {
            this.b.emit(`this, ${index}`);
          });
          this.b.emit(')');
        });
      };
      // Value members initialize in SOURCE ORDER — the lowering never
      // reorders observable initializer effects (a plain member reads
      // a state declared above it, a trace logs in the written
      // order). Offers then register, and effects start last: an
      // effect is a reaction, not a value — it must not fire against
      // a half-built instance.
      const orderAt = new Map();
      stmts.forEach((s, i) => {
        orderAt.set(s, i);
        // An offered declaration's member node is the offer's PAYLOAD —
        // it takes the offer statement's own position.
        if (this.isOfferNode(s)) orderAt.set(s[1], i);
      });
      const valueMembers = [
        ...[...readonlyVars, ...plainVars].map((m) => ({ at: orderAt.get(m.node) ?? 0, run: () => emitPlainish(m) })),
        ...acceptedVars.map((name) => ({ at: orderAt.get(seen.get(name)) ?? 0, run: () => emitAccept(name) })),
        ...stateVars.map((m) => ({ at: orderAt.get(m.node) ?? 0, run: () => emitState(m) })),
        ...derivedVars.map((m) => ({ at: orderAt.get(m.node) ?? 0, run: () => emitComputed(m) })),
      ].sort((a, b) => a.at - b.at);
      // Gates are route-prefetched prerequisites: every gate binds
      // first, in its own source order, before any ordinary member
      // initializer can consume the loaded values.
      for (const [index, gate] of gateVars.entries()) emitGate(gate, index);
      for (const vm of valueMembers) vm.run();
      for (const name of offeredVars) {
        initLine(seen.get(name), () => this.b.emit(`${this.runtimeName('setContext')}('${name}', this.${name})`));
      }
      // Component-body effects register on the instance's owner frame
      // (the runtime pushes it around _init — the runtime seam). The
      // emission mirrors the COMPONENT shape exactly: an expression
      // body RETURNS its value (`{ return expr; }` — the cleanup
      // channel is live in one-liner component effects, the handle rule's
      // load-bearing idiom), where the module-level form deliberately
      // returns nothing — the asymmetry is pinned on both
      // sides.
      //
      // Under hmr, effects live in `_hmrBindEffects` so `_hmrRerender`
      // can recreate them after disposing the owner frame without
      // re-running `_init` (which would duplicate state containers).
      const emitBodyEffects = (bodyPad) => {
        for (const eff of effects) {
          const bodyNode = eff[2];
          const isAsync = this.containsAwait(bodyNode);
          this.b.emit(bodyPad);
          this.mark(eff, '$self', () => {
            this.mark(eff, 'operator', () => this.b.emit(this.runtimeName('__effect')));
            this.b.emit(isAsync ? '(async () => ' : '(() => ');
            if (this.isBlock(bodyNode) && bodyNode.length > 2) {
              this.mark(eff, 'value', () => this.withExpression(() => {
                const bodyStmts = this.liveStmts(bodyNode.slice(1));
                const { entries, names } = this.scopedHoist(bodyNode.slice(1), []);
                for (const n of this.pushReactiveFrame(bodyStmts, names)) names.add(n);
                this.scopes.push(names);
                this.rejectUnboundIt([], bodyNode, { root: eff });
                this.funcBlock(eff, bodyNode, bodyStmts, ind + 2, entries, false, true);
                this.scopes.pop();
                this.rframes.pop();
              }));
            } else {
              const single = this.isBlock(bodyNode) ? bodyNode[1] : bodyNode;
              const { entries, names } = this.scopedHoist([single], []);
              this.scopes.push(names);
              this.rframes.push({ reactive: new Set(), bound: names });
              this.rejectUnboundIt([], bodyNode, { root: eff });
              this.b.emit('{ ');
              if (entries.length) {
                this.hoistLine(entries);
                this.b.emit(' ');
              }
              if (this.effectBranchWrites(single)) {
                this.mark(eff, 'value', () => this.withExpression(() => this.implicitReturn(single, ind + 2, true)));
                this.b.emit(' }');
              } else {
                if (!this.effectTailWrites(single)) this.b.emit('return ');
                this.mark(eff, 'value', () => this.withExpression(() => {
                  const wrap = Emitter.needsGrouping(single, 'operand') || this.isObject(single);
                  if (wrap) this.b.emit('(');
                  this.expr(single);
                  if (wrap) this.b.emit(')');
                }));
                this.b.emit('; }');
              }
              this.scopes.pop();
              this.rframes.pop();
            }
            this.b.emit(')');
          });
          this.b.emit(';\n');
        }
      };
      if (this.hmr && effects.length > 0) {
        this.b.emit(`${ipad}this._hmrBindEffects();\n`);
      } else {
        emitBodyEffects(ipad);
      }
      this.rframes.pop();
      this.scopes.pop();
      this.b.emit(`${pad}}\n`);

      if (this.hmr && effects.length > 0) {
        this.b.emit(`${pad}_hmrBindEffects() {\n`);
        this.scopes.push(initNames);
        this.rframes.push({ reactive: new Set(), bound: initNames });
        emitBodyEffects(ipad);
        this.rframes.pop();
        this.scopes.pop();
        this.b.emit(`${pad}}\n`);
      }

      if (hmrMeta) this.emitComponentHmrInit(pad, { stateVars, initNames, initFacts });

      // Refresh computed bodies on patch without re-running `_init`
      // (which would mint duplicate state containers).
      if (this.hmr && derivedVars.length > 0) {
        this.b.emit(`${pad}_hmrRefreshComputeds() {\n`);
        this.scopes.push(initNames);
        this.rframes.push({ reactive: new Set(), bound: initNames });
        for (const m of derivedVars) {
          // Kill the prior computed before replacing it — frame
          // dispose owns effects, not computed containers, so a bare
          // reassignment would leave the old body subscribed to state.
          this.b.emit(`${ipad}this.${m.name}?.kill?.();\n`);
          this.b.emit(ipad);
          memberName(m.node, m.name);
          this.b.emit(` = ${this.runtimeName('__computed')}(() => `);
          this.mark(m.node, 'value', () => this.withExpression(() => this.computedBody(m.node, m.value, ind + 2)));
          this.b.emit(');\n');
        }
        this.rframes.pop();
        this.scopes.pop();
        this.b.emit(`${pad}}\n`);
      }

      // A named handler ref (`@submit: @handleSubmit`, or the bare
      // `@submit: handleSubmit` spelling) types the METHOD's event
      // parameter at its definition: the render tree is scanned for
      // `@event: method` attribute pairs before the methods emit, and
      // a matched method's first parameter — when the author left it
      // a bare name — takes the event's face type (the union, when
      // one method serves several events). An annotated parameter is
      // the author's own claim and is never overridden.
      const methodEventNames = new Map();
      if (this.ts && renderNode !== null) {
        // The walk carries the nearest enclosing ELEMENT (tag +
        // namespace) so the param's `target`/`currentTarget` can claim
        // the host type (RULINGS.md § the render DSL). A component use
        // clears the context — its listener attaches to the child's
        // root, which this scan cannot name — and a method serving
        // several hosts claims their union.
        const scanHandlers = (x, host) => {
          if (!isNode(x)) return;
          let next = host;
          // A render `switch` STATEMENT carries the host through to its
          // arms; its node shape is told apart before the tag test
          // because `switch` is also an SVG tag (the render walk's own
          // dispatch order).
          const tag = x[0] === 'switch' && x.length === 4 ? null : Emitter.templateHeadTag(x);
          // `object` is BOTH the object-literal node head and an HTML
          // tag. Direct `:` pairs mark the LITERAL (an element's
          // pairs arrive wrapped in their own object child), and a
          // literal is transparent — its element's context flows
          // through to the handlers it carries. Anything else spelled
          // `object` is ambiguous and clears the context: a real
          // `<object>`'s handlers must not inherit the outer tag, and
          // no wrong claim beats either right one.
          if (tag === 'object') {
            next = this.isObject(x) && x.slice(1).some((c) => isNode(c) && c[0] === ':') ? host : null;
          } else if (tag !== null && TEMPLATE_TAGS.has(tag)) {
            next = { tag, svg: host?.svg === true || SVG_ONLY_TAGS.has(tag) };
          } else if (isCall(x) && typeof x[2] === 'string' && /^[A-Z]/.test(x[2])) {
            next = null;
          }
          if (x[0] === ':' && x.length === 3 && isNode(x[1]) && x[1][0] === '.' &&
              x[1][1] === 'this' && typeof x[1][2] === 'string' && DOM_EVENTS.has(x[1][2])) {
            const v = x[2];
            const m = typeof v === 'string' && members.has(v) ? v :
              (isNode(v) && v[0] === '.' && v[1] === 'this' && v.length === 3 &&
               typeof v[2] === 'string' && members.has(v[2]) ? v[2] : null);
            if (m !== null) {
              if (!methodEventNames.has(m)) methodEventNames.set(m, { events: new Set(), hosts: new Set(), unknownHost: false });
              const rec = methodEventNames.get(m);
              rec.events.add(x[1][2]);
              if (host !== null && surfaceableTag(host.tag, host.svg)) {
                rec.hosts.add(hostText(host.tag, host.svg));
              } else {
                rec.unknownHost = true;
              }
            }
          }
          for (const el of x) scanHandlers(el, next);
        };
        scanHandlers(renderNode, null);
      }
      // Methods, then lifecycle hooks.
      const emitCallable = ({ name, func, isVoid, node: owner }) => {
        const [, params, block] = func;
        const evRec = methodEventNames.get(name);
        // A hook's unannotated params type as what it is called with
        // (hookParamTypes) — the injection yields to an author-typed param.
        const evHost = evRec !== undefined && !evRec.unknownHost && evRec.hosts.size > 0
          ? [...evRec.hosts].join(' | ') : null;
        const evParamType = evRec !== undefined ? this.tsEventTypeText([...evRec.events], evHost)
          : hookParamTypes(name);
        this.b.emit(pad);
        this.mark(owner, '$self', () => {
          if (this.containsAwait(block)) this.b.emit('async ');
          if (Emitter.containsYield(block)) this.b.emit('*');
          this.mark(owner, 'target', () => this.mark(owner, 'key', () => this.b.emit(name)));
          this.b.emit('(');
          this.emitParams(params, evParamType);
          this.b.emit(')');
          this.tsReturnAnnotation(func, this.containsAwait(block), isVoid, Emitter.containsYield(block), owner);
          this.b.emit(' ');
          this.mark(owner, 'value', () => {
            this.methodBlock(func, block, ind + 1, {
              isConstructor: false, binds: [], methodName: name, voidBody: isVoid,
            });
          });
        });
        this.b.emit('\n');
      };
      for (const m of methods) emitCallable(m);
      for (const h of hooks) emitCallable(h);

      if (renderNode !== null) this.renderBody(renderNode, ind, frame);
      // Rest props forward onto the FIRST class-scope element whose
      // tag IS the extended tag (the rule — factories never bind the
      // target); a render that never creates one leaves every rest
      // prop with nowhere to land, silently,.
      if (extendsTag !== null && frame.inheritedBound !== true) {
        throw this.positionedError(node,
          `emitter: this component extends '${extendsTag}' but its render never creates a '<${extendsTag}>' element ` +
          'at class scope — rest props forward onto the FIRST class-scope element of the extended tag (at any ' +
          'nesting depth; conditional branches and loop rows never bind it), and without one every caller prop ' +
          'lands nowhere');
      }
      if (extendsComponent !== null && frame.inheritedBound !== true) {
        throw this.positionedError(node,
          `emitter: this component extends '${extendsComponent}' but its render never constructs a '${extendsComponent}' ` +
          'at class scope — rest props forward onto the FIRST class-scope construction of the extended component (at ' +
          'any nesting depth; conditional branches and loop rows never bind it), and without one every caller prop ' +
          'lands nowhere');
      }

      this.b.emit('  '.repeat(ind) + '}');
    });

    this.methodName = prevMethod;
    // The silent-freeze pair: a plain ('=') member that render READS
    // and anything WRITES would change state the UI never reflects —
    // render effects track no plain field. Reject at the write.
    for (const [mname, writeNode] of frame.plainWrites) {
      if (frame.renderPlainReads.has(mname)) {
        throw this.positionedError(writeNode,
          `emitter: writing to '${mname}' silently freezes the render — it is a plain ('=') member and render ` +
          `reads it, but render never re-runs for a non-reactive field; declare it with ':=' (state) if it changes`);
      }
    }
    this.rframes.pop();
    this.cframes.pop();
    this.ind = ind;
  }
}
