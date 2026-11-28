// The render DSL: the static walk and the two-phase record/replay that
// drives it (_create, _setup, factory records), tags, attributes, text,
// events and composition. The dynamic constructs it dispatches to —
// scopes, factories, conditionals, loops — live in render-dynamic.js.
//
// _create() builds the static DOM through document calls; _setup()
// holds the reactive bindings — one __effect per dynamic text/
// attribute/class site (fine-grained: no vdom, no re-render).
// Dynamic constructs (conditionals, loops) compile to BLOCK
// FACTORIES — class methods returning the runtime's {c,m,p,d,
// _first,_s} handle — driven by swap/reconcile effects in _setup.
// The walk is TWO-PHASE: it first collects every emission as a
// closure into per-scope RECORDS (the class scope plus one record
// per factory — a factory is discovered mid-walk but emits after
// _setup, and class-mode render locals need a `let` line ahead of
// lines already walked), then replays them through the builder, so
// mapping rows land at real generated offsets. A render child with no
// reading rejects positioned; nothing in a render body is silently
// dropped.
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

import { isIdentifierName, isCustomElementName } from '../ident.js';
import { isComponentName, componentPathText, componentPathRoot } from '../render.js';
import { SVG_ONLY_TAGS, DOM_EVENTS, knownBareAttribute } from '../dom.js';
import { surfaceableTag } from '../ts/dom-types.js';
import { RENDER_LOCAL_HIDDEN } from './names.js';
import { HOST } from '../ts/components.js';
import { isCall, isList, isNode, isNone, isPlainCall, isStruct, wordOf } from '../sexpr.js';
import { isAssignHead, RENDER_BINDING_HEADS, PATTERN_LITERALS, RENDER_FUNC_CHILD, isHtmlTag } from './helpers.js';
import { isComprehensionNode, isFunc, isIf, isSpread, isChildren, thisField } from './tree.js';
import { Emitter } from './core.js';
import { referencesNames } from './walks.js';

// An attribute key's bare spelling: a hyphenated key is one string leaf
// whose word keeps its quotes.
const unquoteKey = (key) => key.startsWith('"') && key.endsWith('"') ? key.slice(1, -1) : key;
// The prop a minted `__bind_x__` key (the `<=>` rewrite) binds, or null.
const bindTarget = (key) => key.startsWith('__bind_') && key.endsWith('__') ? key.slice(7, -2) : null;
// The ways a child component can receive `children`, as a duplicate names them.
const CHILDREN_SPELLINGS = {
  prop: 'an explicit `children:` prop', body: 'element body content', slot: 'a nested `slot`',
};
// `class` and `className` are one attribute: a set holding either holds both.
const pairClassKeys = (keys) => {
  if (keys.has('class') || keys.has('className')) { keys.add('class'); keys.add('className'); }
};

export class RenderMethods {
  renderBody(renderNode, ind, frame) {
    const pad = '  '.repeat(ind + 1);
    const ipad = pad + '  ';
    const prev = this.rstate;
    const classRecord = {
      kind: 'class', name: null, parent: null, self: null,
      creates: [], setups: [], vars: null,
      locals: new Set(), localDecls: new Map(), bindings: new Set(),
      refs: [], loopStack: [], stmts: [],
      forceNonStatic: false, root: null, originNode: renderNode,
      renameHazardNames: new Set(),
    };
    this.rstate = {
      elCount: 0, textCount: 0, blockCount: 0, svgDepth: 0,
      fragChildren: new Map(), tags: new Map(), svgEls: new Set(),
      pendingClassArgs: null, pendingClassEl: null, pendingClassKeys: null,
      pad: ipad, frame, node: renderNode,
      records: [], sink: classRecord, classRecord,
      transitionSlot: null, suppressedPairs: new Set(),
      slotSeen: false, scopeDepth: this.scopes.length,
      // Each render child's factory record (rejectRenderIt).
      factoryOf: new Map(),
    };
    // ── Phase 1: the walk (collection only — no emission) ──
    const body = renderNode[2];
    const stmts = this.isBlock(body) ? body.slice(2) : [body];
    classRecord.stmts = stmts;
    this.rframes.push({ reactive: new Set(), bound: classRecord.bindings });
    let rootVar;
    try {
      rootVar = this.walkRenderRoot(stmts, classRecord);
    } finally {
      this.rframes.pop();
    }
    this.closeRenderScope(classRecord);
    this.rejectRenderIt(renderNode);
    // ── Phase 2: replay through the builder ──
    this.b.emit(pad);
    if (this.ts) this.b.tsOnly(() => this.b.emit('private '));
    this.b.emit('_create() {\n');
    this.mark(renderNode, '$self', () => this.mark(renderNode, 'body', () => {
      this.withRecordContext(classRecord, () => {
        if (classRecord.locals.size > 0) {
          this.b.emit(`${ipad}let ${[...classRecord.locals].join(', ')};\n`);
        }
        this.replayCreates(classRecord, ipad);
      });
      this.b.emit(`${ipad}return ${rootVar};\n`);
    }));
    this.b.emit(`${pad}}\n`);
    if (classRecord.setups.length > 0) {
      this.b.emit(pad);
      if (this.ts) this.b.tsOnly(() => this.b.emit('private '));
      this.b.emit('_setup() {\n');
      this.withRecordContext(classRecord, () => this.replaySetups(classRecord, ipad));
      this.b.emit(`${pad}}\n`);
    }
    for (const rec of this.rstate.records) this.emitFactory(rec, ind, renderNode);
    this.rstate = prev;
  }

  // A render body binds no implicit `it`: a bare `it` in it reads a
  // binding the component's scopes declare, or a render local or loop
  // variable named `it` of its own factory. Checked after the walk, which
  // settles every factory's locals and loop variables and which function
  // arguments are inlined children blocks.
  rejectRenderIt(renderNode) {
    this.rejectUnboundIt([], renderNode[2], { root: renderNode, factories: this.rstate.factoryOf });
  }

  // The render-root walk: the renderable counting — binding
  // statements (render locals) emit as JS lines and contribute no DOM
  // child, so a lone element beside bindings still returns itself and
  // an all-bindings body returns a comment placeholder.
  walkRenderRoot(stmts, record) {
    if (stmts.length === 0 || (stmts.length === 1 && wordOf(stmts[0]) === 'null')) {
      // `render null` — a component with no DOM of its own.
      return 'null';
    }
    const rootVar = this.walkChildStmts(stmts);
    // A multi-root fragment empties on insertion — capture the real
    // top-level nodes now so unmount can detach them (the runtime's
    // _nodes contract).
    if (record.kind === 'class' && this.rstate.fragChildren.has(rootVar)) {
      this.renderLine(null, () => this.b.emit(`this._nodes = [...${rootVar}.childNodes]`));
    }
    return rootVar;
  }

  // A statement list at a root position (the render body, a factory
  // body): 0 renderables → comment placeholder; 1 → itself; n → a
  // DocumentFragment. The transition slot (a branch's first-element
  // claim) closes after the FIRST renderable — only the block's
  // _first can carry a working directive.
  walkChildStmts(stmts) {
    const R = this.rstate;
    const closeSlot = () => {
      if (R.transitionSlot !== null && R.transitionSlot.record === R.sink) R.transitionSlot = null;
    };
    const renderables = stmts.reduce((n, s) => n + (this.isRenderBinding(s) ? 0 : 1), 0);
    if (renderables === 0) {
      for (const stmt of stmts) this.renderNode(stmt);
      return this.renderPlaceholder();
    }
    if (renderables === 1) {
      let only = null;
      for (const stmt of stmts) {
        const v = this.renderNode(stmt);
        if (v != null) {
          only = v;
          closeSlot();
        }
      }
      return only;
    }
    const frag = this.newRenderVar('frag');
    this.renderLine(null, () => this.b.emit(`${frag} = document.createDocumentFragment()`));
    const children = [];
    for (const stmt of stmts) {
      const childVar = this.renderNode(stmt);
      if (childVar == null) continue;
      closeSlot();
      this.renderLine(null, () => this.b.emit(`${frag}.appendChild(${childVar})`));
      children.push(childVar);
    }
    this.rstate.fragChildren.set(frag, children);
    return frag;
  }

  // Replay context: a record's deferred closures emit member reads
  // through its self prefix (`ctx` in factories) and resolve its
  // locals/loop variables as plain bindings (they shadow members —
  // the one-walk rule).
  withRecordContext(rec, fn) {
    const prevSelf = this.renderSelf;
    const prevRecord = this.renderRecord;
    this.renderSelf = rec.self;
    this.renderRecord = rec;
    // A factory record's `bindings` is exactly its loop item/index names
    // (own plus threaded outer; the class record's is empty), so the same
    // set feeds both roles: `bound` shadows outer names, `loopVars` marks
    // the emissions the token correction records (see noteNameSpan).
    // `block` makes them declarations to inScope: the record's bindings
    // are `let`s and parameters of the function this replay emits into,
    // so a handler that assigns one writes it and declares no local.
    this.rframes.push({ reactive: new Set(), bound: rec.bindings, block: true, loopVars: rec.bindings, loopBindings: Emitter.loopBindingsOf(rec) });
    try {
      fn();
    } finally {
      this.rframes.pop();
      this.renderSelf = prevSelf;
      this.renderRecord = prevRecord;
    }
  }

  // Directives inside RENDER bodies: a `# @ts-expect-error` above a
  // template line attaches to the render
  // statement node like any other; its generated manifestations are
  // the node's replay lines, so the directive emits above the FIRST
  // line replayed for that node (create or setup effect — whichever
  // comes first consumes it). The always-place doctrine applies: an
  // error landing on a later line of the same lowering stays visible
  // as TS2578 rather than silently dropping the author's marker.
  renderDirectives(node, pad) {
    if (!this.ts || node == null) return;
    const attached = this.tsDirectiveMap.get(node);
    if (attached === undefined) return;
    this.tsDirectiveMap.delete(node);
    for (const d of attached) this.tsDirectiveLine(d, pad, true);
  }

  replayCreates(rec, pad) {
    // The pad, readable by a create fn that emits MULTI-LINE (the
    // child-component ctor with per-prop directive lines) — saved and
    // restored so a nested replay cannot leave a stale pad behind.
    const prevPad = this.replayPad;
    this.replayPad = pad;
    try {
      for (const { node, fn, semi } of rec.creates) {
        this.renderDirectives(node, pad);
        this.b.emit(pad);
        if (node != null) this.mark(node, '$self', fn);
        else fn();
        this.b.emit(semi ? ';\n' : '\n');
      }
    } finally {
      this.replayPad = prevPad;
    }
  }

  replaySetups(rec, pad) {
    for (const s of rec.setups) {
      if (s.kind === 'effect') {
        this.renderDirectives(s.node, pad);
        this.b.emit(pad);
        const emitIt = () => {
          this.b.emit(`${this.runtimeName('__effect')}(() => { `);
          const prev = this._narrowedReads;
          this._narrowedReads = this.narrowedReadNames();
          try {
            this.narrowGuard();
            s.fn();
          } finally {
            this._narrowedReads = prev;
          }
          this.b.emit(' })');
        };
        if (s.node != null) this.mark(s.node, '$self', emitIt);
        else emitIt();
        this.b.emit(';\n');
      } else {
        if (s.node != null) this.renderDirectives(s.node, pad);
        s.fn(pad);
      }
    }
  }

  // One generated line inside _create/_setup (or a factory's c()):
  // pad, an optional $self manifestation for the owning render node
  // (one-to-many — a node's create line, append line, and effect line
  // each carry a row), the statement semicolon outside the mark.
  // Collected into the active record; emitted at replay.
  renderLine(node, fn, semi = true) {
    this.rstate.sink.creates.push({ node, fn, semi });
  }

  // A node slot of the active record: a field of the instance in class
  // scope, a `let` of the factory otherwise. Elements and text nodes
  // number apart.
  newRenderVar(hint = 'el') {
    return this.recordVar(`_${hint}${this.rstate.elCount++}`);
  }

  newRenderText() {
    return this.recordVar(`_t${this.rstate.textCount++}`);
  }

  recordVar(name) {
    const rec = this.rstate.sink;
    if (rec.kind === 'class') return `this.${name}`;
    rec.vars.add(name);
    return name;
  }

  // A text node written once: `t = document.createTextNode(<value>)`.
  renderStaticText(node, emitValue) {
    const t = this.newRenderText();
    this.renderLine(node, () => {
      this.b.emit(`${t} = document.createTextNode(`);
      emitValue();
      this.b.emit(')');
    });
    return t;
  }

  // A text node bound live: created empty, its data written by an effect
  // (checkExpr as renderEffect takes it).
  renderLiveText(node, emitValue, checkExpr) {
    const t = this.newRenderText();
    this.renderLine(node, () => this.b.emit(`${t} = document.createTextNode('')`));
    this.renderEffect(node, () => {
      this.b.emit(`${t}.data = `);
      emitValue();
      this.b.emit(';');
    }, checkExpr);
    return t;
  }

  emitString(emitValue) {
    this.b.emit('String(');
    emitValue();
    this.b.emit(')');
  }

  // The comment a root position with nothing to render stands as.
  renderPlaceholder() {
    const c = this.newRenderVar('empty');
    this.renderLine(null, () => this.b.emit(`${c} = document.createComment('')`));
    return c;
  }

  newBlockName() {
    // Block factories are class methods — a member spelling the next
    // name, or the face's `_iter` thunk beside it (tsIterThunkName),
    // would collide, so numbering skips it.
    let name;
    do {
      name = `create_block_${this.rstate.blockCount++}`;
    } while (this.rstate.frame.members.has(name) || this.rstate.frame.members.has(`${name}_iter`));
    return name;
  }

  // Queue a `__effect(() => { … });` line for the active record's
  // setup phase (_setup in class scope, p() in a factory). `checkExpr`
  // is the effect's source expression when one exists: a CLASS-scope
  // effect lives in _setup while render locals live in _create — a
  // read across that boundary is a mount-time ReferenceError, so it
  // rejects here (factory scopes share one closure; no check).
  renderEffect(node, fn, checkExpr) {
    if (checkExpr !== undefined) this.checkSetupLocalRefs(checkExpr, node);
    this.rstate.sink.setups.push({ kind: 'effect', node, fn });
  }

  // A class-scope emission that lands in _setup (an effect body, a
  // conditional's condition, a loop's collection, a keyFn) cannot
  // read a render local — locals are `let`s inside _create's function
  // scope.
  checkSetupLocalRefs(expr, node) {
    const rec = this.rstate.sink;
    if (rec.kind !== 'class' || rec.locals.size === 0) return;
    if (referencesNames(expr, rec.locals, this.stores)) {
      throw this.positionedError(node ?? expr,
        'emitter: a render local cannot appear in a LIVE binding or a dynamic block head at the render top level — ' +
        'locals live in _create() and reactive machinery lives in _setup() (a compiled read here would be a ' +
        'mount-time ReferenceError); bind the value to a member instead', isStruct(expr) ? expr : this.rstate.node);
    }
  }

  // A value expression inside a render line — operand grouping, the
  // component member rewrites live on the normal expr path. Returns
  // the generated span of the expression INSIDE any grouping parens:
  // TypeScript reports an argument's mismatch on the bare expression,
  // parens skipped, so that is the span a relation site records.
  renderExpr(value) {
    let span = null;
    this.withExpression(() => {
      const wrap = Emitter.needsGrouping(value, 'operand');
      if (wrap) this.b.emit('(');
      const start = this.b.offset;
      this.expr(value);
      span = [start, this.b.offset];
      if (wrap) this.b.emit(')');
    });
    return span;
  }

  // How does a bare name read inside the CURRENT render scope —
  // 'local' (a render local of this scope), 'loop'/'loop-reactive' (a
  // loop item/index variable, live when its collection is reactive)?
  // Returns null for everything else. A name that is NOT in this
  // scope but IS a render local of an ENCLOSING render scope REJECTS
  // when `node` is given: locals never cross a factory boundary (each
  // factory is its own JS function, so the read would ship a
  // ReferenceError).
  renderVarKind(name, node) {
    const R = this.rstate;
    if (!R) return null;
    if (R.sink.locals.has(name)) return 'local';
    for (let i = R.sink.loopStack.length - 1; i >= 0; i--) {
      const v = R.sink.loopStack[i];
      if (v.itemVar === name || v.indexVar === name) {
        return v.reactiveSource ? 'loop-reactive' : 'loop';
      }
    }
    if (node !== undefined) {
      for (let r = R.sink.parent; r; r = r.parent) {
        if (r.locals.has(name)) throw this.positionedError(node, RENDER_LOCAL_HIDDEN(name), this.rstate.node);
      }
    }
    return null;
  }

  // Does a render expression read anything reactive — a component
  // member, a module-level `:=`/`~=` name, a deeper chain rooted at
  // `this`, a plain member, or a module binding (signal-backed
  // getters: a mutation's `pending`, a router's `navigating`), a
  // component-method call (`@m()` or bare `m()`), or a loop
  // item/index variable over a reactive collection? Module-level
  // reactive names bind LIVE here (a one-time read would go silently
  // stale), and index variables patch live (staying correct across
  // keyed reorders). Over-wrapping a static chain in __effect runs it
  // once, harmless.
  renderReactive(sexpr) {
    const word = wordOf(sexpr);
    if (word !== undefined) {
      const kind = this.renderVarKind(word);
      if (kind !== null) return kind === 'loop-reactive';
      const r = this.resolveBareRead(word);
      return r === 'reactive' || r === 'member-reactive';
    }
    // A schema's code runs when its callables do, never in the binding.
    if (!isStruct(sexpr) || sexpr[0] === 'schema') return false;
    const field = thisField(sexpr);
    if (field !== null) return this.memberIsReactive(field);
    if (sexpr[0] === '.' && sexpr.length === 4 && this.chainRootsLive(sexpr[2])) return true;
    if ((sexpr[0] === '.' || sexpr[0] === '[]') && sexpr.length === 4 && this.chainRootsAtLiveLoopVar(sexpr)) return true;
    if (isPlainCall(sexpr)) {
      const method = thisField(sexpr[2]);
      if (method !== null && this.cframes.length > 0 && this.cframes[this.cframes.length - 1].members.has(method)) return true;
      const callee = wordOf(sexpr[2]);
      if (callee !== undefined && this.renderVarKind(callee) === null && this.resolveBareRead(callee) === 'member') return true;
    }
    // A node's head and attribute record are not reads.
    for (let i = isNode(sexpr) ? 2 : 0; i < sexpr.length; i++) if (this.renderReactive(sexpr[i])) return true;
    return false;
  }

  // Is the plain member/index chain `n` rooted at `this`, a plain member,
  // or a binding? A render local or a static loop row is a snapshot by
  // construction, so its chain is not a root here.
  chainRootsLive(n) {
    while (isNode(n) && (n[0] === '.' || n[0] === '[]') && n.length === 4) n = n[2];
    const name = wordOf(n);
    if (name === 'this') return true;
    if (name === undefined || this.renderVarKind(name) !== null) return false;
    const r = this.resolveBareRead(name);
    return r === 'member' || (r === null && (this.inScope(name) || this.moduleBound.has(name)));
  }

  // Is the chain `n`, optional links included, rooted at a loop variable
  // over a reactive collection?
  chainRootsAtLiveLoopVar(n) {
    while (isNode(n) && (n[0] === '.' || n[0] === '[]' || n[0] === '?.' || n[0] === 'optindex') && n.length === 4) n = n[2];
    const name = wordOf(n);
    return name !== undefined && this.renderVarKind(name) === 'loop-reactive';
  }

  // A render local: `name = expr` declares, compound forms mutate.
  isRenderBinding(stmt) {
    if (!isNode(stmt) || !RENDER_BINDING_HEADS.has(stmt[0]) || stmt.length !== 4 || stmt[1].void === true) return false;
    const name = wordOf(stmt[2]);
    return name !== undefined && isIdentifierName(name);
  }

  // `component` names the child component the spread sits on; null
  // anywhere else in a render.
  renderSpreadError(spread, component = null) {
    return this.positionedError(spread, component !== null
      ? 'emitter: a spread has no reading on a child component — pass each prop as a named pair; to forward the ' +
        `caller's undeclared props onto '${component}', declare the wrapper \`component extends ${component}\` and ` +
        'construct it in the render'
      : 'emitter: a spread has no render reading — an element takes named attribute pairs, and `= expr` renders ONE value',
    this.rstate.node);
  }

  // The main render-tree dispatch. Returns the created node's var
  // name, or null for a statement with no DOM child (a render local).
  // `probe` asks the same dispatch without emitting: true when the node
  // would render as markup, false when as text; a rejection still throws.
  renderNode(sexpr, probe = false) {
    if (isStruct(sexpr) && !probe) this.rstate.factoryOf.set(sexpr, this.rstate.sink);
    // Render-scope locals: `x = expr` declares, compound forms mutate.
    if (this.isRenderBinding(sexpr)) return probe || this.renderBinding(sexpr);
    if (isSpread(sexpr)) throw this.renderSpreadError(sexpr);
    // Any OTHER assignment shape at a child position has no render
    // reading: a member write belongs in a handler.
    if (isNode(sexpr) && isAssignHead(sexpr[0]) && sexpr.length === 4) {
      throw this.positionedError(sexpr,
        'emitter: an assignment at a render child position must declare a render local (`name = expr` / compound forms ' +
        'on a plain name) — member and chain writes have no render reading here; put the write in a handler or method');
    }
    const word = wordOf(sexpr);
    if (word !== undefined) {
      // Quoted → static text, and so is a literal: it names no element.
      const base = word.split('#')[0];
      if (/^["'`]/.test(word) || PATTERN_LITERALS.has(word) || !(isIdentifierName(base) || isHtmlTag(base))) {
        return !probe && this.renderStaticText(null, () => this.b.emit(word));
      }
      // Render locals and loop variables shadow tags and members —
      // an own-line read renders as text (the String() wrap); loop
      // vars over a reactive collection bind LIVE.
      const kind = this.renderVarKind(word, sexpr);
      if (kind !== null) {
        if (probe) return false;
        return kind === 'loop-reactive'
          ? this.renderLiveText(null, () => this.b.emit(word))
          : this.renderStaticText(null, () => this.emitString(() => this.b.emit(word)));
      }
      const r = this.resolveBareRead(word);
      if (probe) return r !== 'reactive' && r !== 'member-reactive' && r !== 'member';
      // A reactive read → live text binding.
      if (r === 'reactive' || r === 'member-reactive') return this.renderLiveText(null, () => this.expr(sexpr));
      if (word === 'slot') {
        return this.renderSlot(sexpr, []);
      }
      if (isComponentName(word)) {
        return this.renderChildComponent(sexpr, word, []);
      }
      // A non-reactive member → one-time text.
      if (r === 'member') return this.renderStaticText(null, () => this.emitString(() => this.expr(sexpr)));
      // Anything else is a TAG (custom elements included);
      // `tag#id` splits.
      const [tagStr, idStr] = word.split('#');
      return this.renderTag(sexpr, tagStr || 'div', [], [], idStr);
    }
    if (!isNode(sexpr)) {
      throw this.positionedError(sexpr, 'emitter: unsupported render child');
    }

    const headStr = sexpr[0];
    // A plain call is a tag, a component, a slot or the `= expr` text
    // form by its callee.
    const callee = isPlainCall(sexpr) ? sexpr[2] : null;
    const calleeStr = callee !== null ? wordOf(callee) ?? null : null;
    const args = callee !== null ? sexpr.slice(3) : null;

    // Dynamic constructs: conditionals and for-in loops compile to block
    // factories; the loop shapes with no reconcile reading reject loudly,
    // named.
    // A parenthesized branch is a value (`p (if ok then a else 0)`), so
    // one whose branch the dispatch reads as markup has no reading.
    const branch = (headStr === 'if' || headStr === 'switch') && sexpr.parenthesized ? this.markupBranch(sexpr) : null;
    if (branch !== null) {
      throw this.positionedError(branch, 'emitter: a parenthesized branch is a value, and this branch reads as render ' +
        'markup — drop the parentheses and write the branch as a block to render it', sexpr);
    }
    if (isIf(sexpr) && !sexpr.parenthesized) {
      return probe || this.renderCond(sexpr);
    }
    if (headStr === 'switch' && sexpr.length === 5 && !sexpr.parenthesized) {
      return probe || this.renderSwitch(sexpr);
    }
    const over = headStr === 'loop' && sexpr.length === 7 ? sexpr[1].over : null;
    if (over === 'in') {
      return probe || this.renderLoop(sexpr);
    }
    if (over === 'of') {
      throw this.positionedError(sexpr,
        'emitter: `for … of` (object iteration) has no reconcile reading inside render — ' +
        '__reconcile expects an array and crashes at mount; iterate entries instead: ' +
        '`for pair in Object.entries(obj)`');
    }
    if (over === 'as') {
      throw this.positionedError(sexpr,
        'emitter: an async loop has no render reading — reconciliation is synchronous; collect the items into a state ' +
        'member and loop over it');
    }
    // A counted loop (`loop n`) renders its collected array as text.
    if (isComprehensionNode(sexpr) || headStr === 'while' || over === 'forever') {
      throw this.positionedError(sexpr,
        'emitter: only `for … in` drives list rendering — while/loop/comprehensions have no reconcile reading inside ' +
        'render');
    }
    if (this.isEffectDecl(sexpr) || this.isReactiveDecl(sexpr) || this.isReadonlyDecl(sexpr)) {
      throw this.positionedError(sexpr,
        'emitter: declarations and effects have no render-body reading — declare members in the component body, above render');
    }
    if (calleeStr === 'slot') {
      return probe || this.renderSlot(sexpr, args);
    }
    if (calleeStr !== null && isComponentName(calleeStr)) {
      return probe || this.renderChildComponent(sexpr, calleeStr, args);
    }

    // Bare `@prop` as a child: never implicit text.
    const field = thisField(sexpr);
    if (field !== null) {
      throw this.positionedError(sexpr,
        `emitter: bare \`@${field}\` is not rendered as text — use \`= @${field}\` to render it`);
    }

    const memberTag = componentPathText(sexpr);
    if (memberTag !== null) return probe || this.renderChildComponent(sexpr, { text: memberTag, node: sexpr }, []);
    const memberHead = callee !== null ? componentPathText(callee) : null;
    if (memberHead !== null) return probe || this.renderChildComponent(sexpr, { text: memberHead, node: callee }, args);

    // Tag with classes: `div.card` / `.card` chains. A render local,
    // loop variable, member or binding shadows the tag reading
    // (`summary.total` after `summary := {…}` reads the member).
    if (headStr === '.') {
      const { tag, classes, id } = Emitter.collectTemplateClasses(sexpr);
      if (tag !== null && isHtmlTag(tag) && this.renderVarKind(tag) === null) {
        this.rejectBoundTagRoot(sexpr, tag);
        return probe || this.renderTag(sexpr, tag, classes, [], id);
      }
      // General member chain → text (static or live).
      return !probe && this.renderTextExpr(sexpr);
    }

    if (headStr === 'text') return !probe && this.renderTextExpr(sexpr[2], sexpr, true);

    // Call shapes: tag heads with args/children. A render local wins
    // over the tag reading (`code "hi"` after `code = fn` is a call —
    // rendered as text below; locals are plain identifiers, so a
    // `#id`-carrying head can never be one).
    if (calleeStr !== null && isHtmlTag(calleeStr.split('#')[0]) &&
        this.renderVarKind(calleeStr) === null) {
      const [tagName, id] = calleeStr.split('#');
      return probe || this.renderTag(sexpr, tagName || 'div', [], args, id);
    }
    if (isStruct(callee)) {
      // `tag.__clsx(...)` call with children: dynamic classes.
      const tagExpr = Emitter.clsxTagExpr(callee);
      if (tagExpr !== null) {
        const tagWord = wordOf(tagExpr);
        const classExprs = callee.slice(3);
        if (tagWord === undefined) {
          const { tag, classes, id } = Emitter.collectTemplateClasses(tagExpr);
          if (tag !== null && isHtmlTag(tag)) {
            return probe || this.renderDynamicTag(sexpr, tag, classExprs, args, classes, id);
          }
        } else if (isHtmlTag(tagWord.split('#')[0])) {
          const [tagName, id] = tagWord.split('#');
          return probe || this.renderDynamicTag(sexpr, tagName || 'div', classExprs, args, [], id);
        }
      }
      const { tag, classes, id } = Emitter.collectTemplateClasses(callee);
      if (tag !== null && isHtmlTag(tag) && this.renderVarKind(tag) === null) {
        if (classes.length > 0) this.rejectBoundTagRoot(sexpr, tag);
        if (classes.length > 0 && classes[classes.length - 1] === '__clsx') {
          return probe || this.renderDynamicTag(sexpr, tag, args, [], classes.slice(0, -1), id);
        }
        return probe || this.renderTag(sexpr, tag, classes, args, id);
      }
    }
    if (isFunc(sexpr)) throw this.positionedError(sexpr, RENDER_FUNC_CHILD, this.rstate.node);
    // General expression → text (static or live).
    return !probe && this.renderTextExpr(sexpr);
  }

  // The first branch value of an if/switch that the render lowering
  // would read as markup on a line of its own, or null.
  markupBranch(x) {
    const branches = x[0] === 'if' ? [x[3], x[4]] : [...x[3].map((w) => w[3]), x[4]];
    for (const v of branches.flatMap((b) => (this.isBlock(b) ? b.slice(2) : isList(b) ? b : isNone(b) ? [] : [b]))) {
      const nested = isNode(v) && (v[0] === 'if' || v[0] === 'switch');
      const found = nested ? this.markupBranch(v) : this.renderNode(v, true) ? v : null;
      if (found !== null) return found;
    }
    return null;
  }

  // Text from an expression: a live binding when anything reactive is
  // read, a one-time String() otherwise. `stringify` (the `= expr`
  // path) matches the String() wrap in the effect.
  renderTextExpr(expr, owner = null, stringify = false) {
    const node = owner ?? (isStruct(expr) ? expr : null);
    this.checkCrossScopeLocals(expr, node ?? this.rstate.node);
    // The `= expr` path marks the text node's value role around the
    // expression — its span IS the expression, so a bare member/reactive
    // read re-marks an EXACT row inside the effect.
    const exprMark = (fn) => {
      if (stringify && owner !== null) this.mark(owner, 'value', fn);
      else fn();
    };
    if (this.renderReactive(expr)) {
      return this.renderLiveText(node, () => {
        if (stringify) this.emitString(() => exprMark(() => this.renderExpr(expr)));
        else this.renderExpr(expr);
      }, expr);
    }
    return this.renderStaticText(node, () => this.emitString(() => exprMark(() => this.withExpression(() => this.expr(expr)))));
  }

  // Under `extends <tag>`, the FIRST class-scope element of the
  // extended tag is the rest-forwarding target (class scope only, first
  // match wins; factories never bind it).
  // A key the element's own line sets is the line's: rest never
  // writes it, at mount or on a later update, as under a component
  // host. Listeners are not keys here — the line's and the caller's
  // both run. `class` and `style` merge instead (mergesRestKey).
  isInheritedTarget(tag) {
    const R = this.rstate;
    return R.frame.extendsTag === tag && R.sink.kind === 'class' && R.frame.inheritedBound !== true;
  }

  // On the inherited element, the line's `class` and `style` merge with
  // the caller's unless the body reads that key back through `@rest`,
  // which makes the key the author's: their list or object decides.
  // Automatic mode ends the line's class write with the rest view's
  // `class` read and merges the caller's style by key through the
  // runtime, as an effect either way, since the caller's value may be
  // reactive or arrive through `_updateProp` (a rest write touches the
  // view). The key stays in `_inheritedOwn`: rest never writes it on
  // its own road, so the element has one class writer and one style
  // writer.
  mergesRestKey(el, key) {
    const R = this.rstate;
    return R.frame.extendsTag !== null && R.frame.inheritedEl === el && !R.frame.restReads.has(key);
  }

  // The rest view's read of a merging key, as `@rest.<key>` lowers it.
  emitRestRead(key) {
    this.b.emit(`${this.renderSelf ?? 'this'}.rest.value.${key}`);
  }

  // Under `extends <Component>`, the same two keys merge on the value
  // the host line passes down: `class` becomes `[line, @rest.class]`
  // and `style` the runtime merge of the line's object with the
  // caller's, and the host then merges that one value with its own line
  // as it does any caller's. The value snapshots and re-pushes through
  // the updater effect, since the rest read is reactive; a container
  // never passes here, as the merge would hold it unread inside a list.
  // Answers which merge the key takes, or null.
  hostMergeKey(cleanKey) {
    const R = this.rstate;
    if (R.frame.extendsComponent === null) return null;
    if (cleanKey === 'class' || cleanKey === 'className') return R.frame.restReads.has('class') ? null : 'class';
    if (cleanKey === 'style') return R.frame.restReads.has('style') ? null : 'style';
    return null;
  }

  emitHostMerge(merge, value) {
    if (merge === 'class') {
      this.b.emit('[');
      this.renderExpr(value);
      this.b.emit(', ');
      this.emitRestRead('class');
      this.b.emit(']');
    } else {
      this.b.emit(`${this.renderSelf ?? 'this'}._mergeRestStyle(`);
      this.renderExpr(value);
      this.b.emit(')');
    }
  }

  bindInheritedTarget(node, tag, el, own) {
    const R = this.rstate;
    if (!this.isInheritedTarget(tag)) return;
    R.frame.inheritedBound = true;
    R.frame.inheritedEl = el;
    this.renderLine(node, () => this.b.emit(`this._inheritedEl = ${el}`));
    if (own.length > 0) {
      this.renderLine(node, () => this.b.emit(`this._inheritedOwn = new Set([${own.map((k) => JSON.stringify(k)).join(', ')}])`));
    }
    this.renderLine(node, () => this.b.emit('this._applyRestToInheritedEl()'));
  }

  // The attribute keys an element's line sets: its pairs, on the line
  // or in its body, plus what the selector spells. `class` and
  // `className` are one attribute.
  elementOwnKeys(hasClass, args, id) {
    const keys = new Set();
    if (id) keys.add('id');
    if (hasClass) keys.add('class');
    // Every pair with a word key; a spread has none.
    const take = (obj) => {
      for (const pair of obj.slice(2)) {
        const key = pair.length === 4 ? wordOf(pair[2]) : undefined;
        if (key !== undefined) keys.add(unquoteKey(key));
      }
    };
    for (const arg of args) {
      if (this.isObject(arg)) take(arg);
      else if (isChildren(arg) && this.isBlock(arg[2])) for (const child of arg[2].slice(2)) if (this.isObject(child)) take(child);
    }
    for (const k of ['ref', 'key']) keys.delete(k);
    for (const k of [...keys]) if (k.startsWith('__')) keys.delete(k);
    pairClassKeys(keys);
    return [...keys];
  }

  // The leaf that spells a tag: the root of the head (a bare word, a
  // call's callee, a class chain's first word), when its word is the tag.
  tagLeaf(node, tag) {
    let leaf = isCall(node) ? node[2] : node;
    while (isNode(leaf) && leaf[0] === '.' && leaf.length === 4) leaf = leaf[2];
    return wordOf(leaf) === tag ? leaf : null;
  }

  // The element prologue both element walks share: mint the var, record
  // the tag, claim the branch-root transition slot, and create the
  // (NS-forked) element with its tag-word intrinsics row. Returns
  // { el, isSvg }.
  renderElementPrologue(node, tag) {
    // `total-count` with every part bound reads as subtraction as well
    // as a custom element; the lexer cannot see bindings, so the
    // ambiguity rejects here rather than silently picking the tag.
    if (isCustomElementName(tag) && tag.split('-').every((n) => this.renderVarKind(n) !== null || this.bindsName(n))) {
      throw this.renderAmbiguity(node,
        `emitter: '${tag}' reads as a custom element, but every part of it names a binding here, so it could be a subtraction — ` +
        `write the arithmetic spaced or as \`= ${tag.split('-').join(' - ')}\`, or rename a binding to use the element`);
    }
    const R = this.rstate;
    const el = this.newRenderVar();
    R.tags.set(el, tag);
    // The branch-root transition claim: the FIRST top-level element of
    // a conditional branch is the block's _first — the node the swap's
    // enter/leave transitions run on. Its own attribute objects may
    // carry `__transition__`; anywhere else the directive rejects.
    if (R.transitionSlot !== null && R.transitionSlot.record === R.sink && R.transitionSlot.el === null) {
      R.transitionSlot.el = el;
    }
    const isSvg = R.svgDepth > 0 || SVG_ONLY_TAGS.has(tag);
    if (isSvg) R.svgEls.add(el);
    // The inherited target under `asChild` is the projected element,
    // handed back by the runtime in place of a fresh tag; every line
    // after this one writes to whichever element the fork chose.
    const adopts = this.isInheritedTarget(tag);
    this.renderLine(node, () => {
      const self = this.renderSelf ?? 'this';
      this.b.emit(`${el} = `);
      if (adopts) this.b.emit(`${self}._asChild ? ${self}._adoptChild() : `);
      if (isSvg) this.b.emit(`document.createElementNS('${Emitter.SVG_NS}', `);
      else this.b.emit(`document.createElement(`);
      // The TAG word's face position is a string literal — no symbol
      // to hover — so its span joins the intrinsics channel and the
      // editor serves the ruled answer from the record (a selector-
      // carrying head claims nothing: its words share one lexer token).
      const span = this.emitQuotedWord(this.tagLeaf(node, tag), tag);
      if (span !== null && surfaceableTag(tag, isSvg)) {
        this.intrinsics.push({ start: span[0], end: span[1], kind: 'tag', tag, svg: isSvg });
      }
      this.b.emit(')');
    });
    return { el, isSvg };
  }

  // The id, the inherited-target binding, and the data-part stamp (the
  // component's first element).
  renderElementBasics(node, tag, el, id, own) {
    const R = this.rstate;
    if (id) this.renderLine(node, () => this.b.emit(`${el}.id = '${id}'`));
    this.bindInheritedTarget(node, tag, el, own);
    if (R.frame.name !== null && R.elCount === 1 && R.sink.kind === 'class') {
      this.renderLine(node, () => this.b.emit(`${el}.setAttribute('data-part', '${R.frame.name}')`));
    }
  }

  // Open an element's class merge: its `class:` pairs, on the line or in
  // its body, join `args` (strings or emitters) as `__clsx` arguments
  // instead of writing on their own. Key spans scope WITH the merge, so a
  // nested element's merging pairs never deposit into this one's list.
  // Returns the enclosing merge, for closeClassMerge.
  openClassMerge(el, args) {
    const R = this.rstate;
    const outer = { args: R.pendingClassArgs, el: R.pendingClassEl, keys: R.pendingClassKeys };
    R.pendingClassArgs = args;
    R.pendingClassEl = el;
    R.pendingClassKeys = null;
    return outer;
  }

  closeClassMerge(outer) {
    const R = this.rstate;
    R.pendingClassArgs = outer.args;
    R.pendingClassEl = outer.el;
    R.pendingClassKeys = outer.keys;
  }

  // A static element: prologue and basics, children and attributes, then
  // its selector classes — one plain write, or one `__clsx` effect when
  // `class:` pairs or the rest view merge in.
  renderTag(node, tag, classes, args, id) {
    this.noteShorthandClasses(classes, node);
    const R = this.rstate;
    const { el, isSvg } = this.renderElementPrologue(node, tag);
    this.renderElementBasics(node, tag, el, id, this.elementOwnKeys(classes.length > 0, args, id));
    const outer = classes.length > 0 ? this.openClassMerge(el, [`'${classes.join(' ')}'`]) : null;
    if (isSvg) R.svgDepth++;
    this.renderChildrenOf(el, args, node);
    if (isSvg) R.svgDepth--;
    if (outer !== null) {
      if (this.mergesRestKey(el, 'class')) R.pendingClassArgs.push(() => this.emitRestRead('class'));
      if (R.pendingClassArgs.length === 1) {
        this.renderLine(node, () => this.b.emit(isSvg
          ? `${el}.setAttribute('class', '${classes.join(' ')}')`
          : `${el}.className = '${classes.join(' ')}'`));
      } else {
        const merged = R.pendingClassArgs.slice(1);
        const mergedKeys = R.pendingClassKeys ?? [];
        const mergeRecv = this.tsElReceiver(el);
        this.renderEffect(node, () => {
          const clsx = this.runtimeName('__clsx');
          if (isSvg) {
            mergeRecv.emit();
            const gen = this.b.offset + 1;
            this.b.emit(`.setAttribute('class', ${clsx}('${classes.join(' ')}', `);
            for (const k of mergedKeys) this.intrinsics.push({ start: k[0], end: k[1], kind: 'attr', name: 'class', gen });
          } else {
            // Through the tag's own receiver, so the merged write lands on a
            // typed `className` — the position the key's ruled hover reads,
            // and the same answer the unmerged spelling already gives.
            mergeRecv.emit();
            this.b.emit('.');
            const gen = this.b.offset;
            this.b.emit(`className = ${clsx}('${classes.join(' ')}', `);
            for (const k of mergedKeys) this.intrinsics.push({ start: k[0], end: k[1], kind: 'classkey', gen });
          }
          merged.forEach((fn, i) => {
            if (i > 0) this.b.emit(', ');
            fn();
          });
          this.b.emit(isSvg ? '));' : ');');
        });
      }
      this.closeClassMerge(outer);
    }
    return el;
  }

  // A `.( … )` dynamic-class element: className binds through ONE
  // __clsx effect merging selector classes, the call's expressions,
  // and any `class:` attribute values.
  renderDynamicTag(node, tag, classExprs, children, staticClasses, id) {
    this.noteShorthandClasses(staticClasses, node);
    const R = this.rstate;
    const { el, isSvg } = this.renderElementPrologue(node, tag);
    this.renderElementBasics(node, tag, el, id, this.elementOwnKeys(true, children, id));
    for (const expr of classExprs) this.checkCrossScopeLocals(expr, node);
    const outer = this.openClassMerge(el, [
      ...staticClasses.map((c) => `'${c}'`),
      ...classExprs.map((e) => () => this.renderExpr(e)),
    ]);
    if (isSvg) R.svgDepth++;
    this.renderChildrenOf(el, children, node);
    if (isSvg) R.svgDepth--;
    if (this.mergesRestKey(el, 'class')) R.pendingClassArgs.push(() => this.emitRestRead('class'));
    const parts = R.pendingClassArgs;
    // This element's merging pairs recorded their key spans here —
    // claim them against this write (the static walk's merge does the
    // same), or a pair under a dynamic-class element leaks its keys
    // into the next enclosing merge.
    const keys = R.pendingClassKeys ?? [];
    if (parts.length > 0) {
      this.renderEffect(node, () => {
        const clsx = this.runtimeName('__clsx');
        this.b.emit(`${el}`);
        const gen = this.b.offset + 1;
        this.b.emit(isSvg ? `.setAttribute('class', ${clsx}(` : `.className = ${clsx}(`);
        for (const k of keys) {
          this.intrinsics.push(isSvg
            ? { start: k[0], end: k[1], kind: 'attr', name: 'class', gen }
            : { start: k[0], end: k[1], kind: 'classkey', gen });
        }
        parts.forEach((p, i) => {
          if (i > 0) this.b.emit(', ');
          if (typeof p === 'string') this.b.emit(p);
          else p();
        });
        this.b.emit(isSvg ? '));' : ');');
      });
    }
    this.closeClassMerge(outer);
    return el;
  }

  // A block of template children (a conditional branch, a loop body).
  // Non-blocks render as one child; a postfix conditional's plain
  // [statement] wrapper unwraps.
  renderChildBlock(body) {
    if (!this.isBlock(body)) return this.renderNode(body) ?? this.renderPlaceholder();
    const stmts = body.slice(2);
    return stmts.length === 0 ? this.renderPlaceholder() : this.walkChildStmts(stmts);
  }

  renderAppend(el, v) {
    this.renderLine(null, () => {
      const guard = v === this.rstate.frame?.asChildSlot ? `if (!${this.renderSelf ?? 'this'}._asChild) ` : '';
      this.b.emit(`${guard}${el}.appendChild(${v})`);
    });
  }

  // The shared child/attribute walk for element argument lists.
  renderChildrenOf(el, args, owner) {
    for (let k = 0; k < args.length; k++) {
      const arg = args[k];
      if (isFunc(arg)) {
        // A spelled `(v) -> …` here is usually a chain continuation
        // re-read as render syntax.
        if (arg[2].length > 0) {
          throw this.positionedError(arg,
            'emitter: a parameterized function is not a render child — element children arrows carry no parameters ' +
            '(an indented `.method (v) -> …` continuation re-reads as a NEW element inside render; put the chain on one ' +
            'line or bind it in a method)', this.rstate.node);
        }
        throw this.positionedError(arg, RENDER_FUNC_CHILD, this.rstate.node);
      }
      if (isChildren(arg)) {
        const block = arg[2];
        for (let j = 2; j < block.length; j++) {
          const child = block[j];
          if (this.isObject(child)) {
            this.renderAttributes(el, child);
          } else if (!this.renderOwnLineWord(el, child, block, j, owner)) {
            const v = this.renderNode(child);
            if (v == null) continue;
            this.renderAppend(el, v);
          }
        }
        continue;
      }
      if (this.isObject(arg)) {
        this.renderAttributes(el, arg);
        continue;
      }
      const word = wordOf(arg);
      if (word !== undefined) {
        const base = word.split(/[#.]/)[0];
        // Render locals and loop variables shadow the tag reading and
        // the flag shorthand — an in-scope value renders as text (loop
        // vars over a reactive collection bind live).
        const scopeKind = base === word ? this.renderVarKind(word, arg) : null;
        if (scopeKind !== null) {
          // The name is a source READ — a render loop variable at its use,
          // which RULINGS.md wants answering a plain inferred type.
          const emitName = () => this.emitLeaf(arg, word);
          const t = scopeKind === 'loop-reactive' ? this.renderLiveText(null, emitName) : this.renderStaticText(null, emitName);
          this.renderLine(null, () => this.b.emit(`${el}.appendChild(${t})`));
          continue;
        }
        if (isHtmlTag(base || 'div')) {
          const v = this.renderNode(arg);
          this.renderAppend(el, v);
          continue;
        }
        if (isComponentName(base) && base === word) {
          const v = this.renderChildComponent(arg, word, []);
          this.renderAppend(el, v);
          continue;
        }
        if (isIdentifierName(word) && this.resolveBareRead(word) === null && !this.inScope(word)) {
          this.renderBareAttribute(el, word, args, k, owner);
          continue;
        }
        const quoted = /^["'`]/.test(word);
        const r = quoted ? null : this.resolveBareRead(word);
        let t;
        if (quoted) t = this.renderStaticText(null, () => this.b.emit(word));
        else if (r === 'reactive' || r === 'member-reactive') t = this.renderLiveText(null, () => this.expr(arg));
        else if (r === 'member') t = this.renderStaticText(null, () => this.emitString(() => this.expr(arg)));
        else t = this.renderStaticText(null, () => this.expr(arg));
        this.renderLine(null, () => this.b.emit(`${el}.appendChild(${t})`));
        continue;
      }
      if (arg != null) {
        const v = this.renderNode(arg);
        this.renderAppend(el, v);
      }
    }
  }

  // The element's tag name: which attribute vocabulary an element's
  // keys answer to (var names are allocation-ordered; the frame
  // records tags).
  renderTagOf(el) {
    return this.rstate.tags.get(el) ?? 'div';
  }

  // A bare identifier CHILD resolving to NOTHING in scope is boolean-
  // attribute shorthand for the enclosing element, on both bare roads
  // — the inline word (`button disabled`) and the word on its own line
  // under the element (`button` / `  disabled`). The arm is TOTAL: the
  // readings above it (an in-scope value, a tag, a component) have all
  // declined, so the name is an attribute, whatever it spells — never
  // a TAG. A non-hyphen word outside the tag tables names no custom
  // element (the platform requires the hyphen, and a hyphenated word
  // parses as subtraction here), so an element built from it would be
  // a DOM node no face can see, out of what is usually a misspelled
  // attribute (`readOnly` → `<readOnly>`); the attribute reading of the
  // same word is inert markup the typed surface rejects on the word.
  //
  // WHETHER THE VOCABULARY HOLDS IT is the typed surface's question,
  // never emission's: the name is a string-literal union member there,
  // admitted from the same tables this file reads (the lockstep test
  // pins the two equal). Emission rejects nothing here, because the JS
  // face rejects no other name either — `= someUndefinedName` compiles
  // to a runtime ReferenceError, and `notAnAttr: 'x'` to markup, both
  // silently. A gate here would be the one name question the untyped
  // road answers, and it would answer the least costly one. What the
  // ts face gets instead is the author's span on the emitted name —
  // the call's own complaint lands on the word, and the editor reaches
  // the word's records through it — and the rows the pair road keeps
  // for a key: the attribute row the hover reads, then, for a name
  // outside the vocabulary, the row that re-words the rejection.
  renderBareAttribute(el, name, siblings, k, owner) {
    const tag = this.renderTagOf(el);
    const recv = this.tsElReceiver(el);
    const at = this.ts ? this.bareChildSpan(siblings, k) : null;
    const ownerId = at === null ? null : this.rowIdOf(owner);
    // The empty string is the boolean-attribute serialization (the
    // docs spell it) — `true` would write name="true", the same DOM
    // state but not the documented markup, and a literal "true" value
    // on a non-boolean attribute. '' satisfies the widened attribute
    // type, so no quieting cast rides.
    this.renderLine(null, () => {
      recv.emit();
      // The method the attribute row points at stands one byte past
      // the dot the call opens with.
      const gen = this.b.offset + 1;
      this.b.emit('.setAttribute(');
      if (at !== null && recv.surfaced) {
        // The word answers the type its road admits: presence, spelled
        // outright, for a boolean name; for any other, the value the
        // instantiated call takes.
        this.intrinsics.push(Emitter.BOOLEAN_ATTRS.has(name)
          ? { start: at[0], end: at[1], kind: 'attr', name, type: 'boolean | undefined' }
          : { start: at[0], end: at[1], kind: 'attr', name, gen });
      }
      if (at !== null && !knownBareAttribute(tag, name)) {
        this.intrinsics.push({
          start: at[0], end: at[1], kind: 'unknown-attr', tag, name,
          message: this.unknownAttrMessage(tag, name, { bare: true, svg: this.rstate.svgEls.has(el) }),
        });
      }
      // The name is a bare WORD in source and a string literal in the
      // emission: a caller-supplied span is the only way the word's
      // position reaches the bytes the lowering wrote.
      const leaf = wordOf(siblings[k]) === name ? siblings[k] : null;
      if (ownerId !== null) {
        this.b.markSpan(ownerId, 'identifier', at[0], at[1], () => this.emitQuotedWord(leaf, name));
      } else this.emitQuotedWord(leaf, name);
      this.b.emit(", '')");
    });
  }

  // The own-line child that is a bare attribute word (renderBareAttribute)
  // — true when it rendered as one. The precedence is the inline road's:
  // an in-scope value keeps its text reading, a tag word (`slot` among
  // them) and a component name keep their element readings, and only a
  // plain identifier resolving to nothing reaches the attribute arm.
  // Everything else (quoted text, a call, a chain) is renderNode's.
  renderOwnLineWord(el, child, siblings, k, owner) {
    const word = wordOf(child);
    if (word === undefined || !isIdentifierName(word)) return false;
    if (isHtmlTag(word) || isComponentName(word)) return false;
    if (this.renderVarKind(word, child) !== null) return false;
    if (this.resolveBareRead(word) !== null || this.inScope(word)) return false;
    this.renderBareAttribute(el, word, siblings, k, owner);
    return true;
  }

  // `slot` — children projection. Under a native tag the slot line
  // materializes the received children (a fixed ternary — a Node
  // projects, a plain value renders as text, absence leaves a
  // comment); under a child component the nested word forwards them
  // as that call's `children` prop (renderChildComponent). `children`
  // is ONE node, so the projection point is structurally single
  // across both spellings: a second slot, a slot inside a loop row,
  // and slot arguments all reject loudly (a silent move to the last
  // projection point would drop slot arguments).
  claimSlot(markNode) {
    const R = this.rstate;
    const at = markNode ?? this.rstate.node;
    if (R.sink.loopStack.length > 0) {
      throw this.positionedError(at,
        'emitter: `slot` inside a loop row has no working reading — `children` is ONE node, and every row would fight ' +
        'over it; project it once, outside the loop', this.rstate.node);
    }
    if (R.slotSeen) {
      throw this.positionedError(at,
        'emitter: a second `slot` in one render — `children` is ONE node, and a second projection point MOVES it ',
        this.rstate.node);
    }
    R.slotSeen = true;
    this.noteVocabulary('render-channel', 'slot', at);
  }

  // The `children` read a slot spelling makes. A declared `@children`
  // with no initializer is a reactive cell like every other bare prop
  // (the face types it as one), so the read unwraps it the way any
  // reactive member read does; an undeclared or `=!` member reads
  // plain. The `slot` word answers the children it projects: the
  // `children` word of the first read is the typed position
  // (RULINGS.md, `slot`).
  childrenReadText() {
    const s = this.renderSelf ?? 'this';
    return `${s}.children${this.memberIsReactive('children') ? '.value' : ''}`;
  }

  emitChildrenRead(slotSpan) {
    this.b.emit(`${this.renderSelf ?? 'this'}.`);
    if (slotSpan !== null) this.intrinsics.push({ start: slotSpan[0], end: slotSpan[1], kind: 'slot', gen: this.b.offset });
    this.b.emit('children');
    if (this.memberIsReactive('children')) this.b.emit('.value');
  }

  renderSlot(node, args) {
    const markNode = isStruct(node) ? node : null;
    if (args.length > 0) {
      throw this.positionedError(markNode ?? node,
        'emitter: `slot` takes no arguments — fallback content has no ' +
        'reading here (render it through a conditional around the slot)', this.rstate.node);
    }
    this.claimSlot(markNode);
    const v = this.newRenderVar('slot');
    // Under `asChild` the projected element is the host, so the slot
    // has no place to go: its append is guarded (renderAppend).
    if (this.rstate.frame.extendsTag !== null && this.rstate.sink.kind === 'class') this.rstate.frame.asChildSlot = v;
    const slotSpan = this.ts ? this.wordSpanIn('slot', markNode ?? this.rstate.node) : null;
    // Under a conditional the slot comes and goes with its branch, so it
    // projects through __heldSlot, which lets several root children
    // detach whole; a slot outside one is inserted once.
    if (this.rstate.sink.kind !== 'class') {
      this.renderLine(markNode, () => {
        this.b.emit(`${v} = ${this.runtimeName('__heldSlot')}(`);
        this.emitChildrenRead(slotSpan);
        this.b.emit(')');
      });
      return v;
    }
    this.renderLine(markNode, () => {
      const c = this.childrenReadText();
      this.b.emit(`${v} = `);
      this.emitChildrenRead(slotSpan);
      this.b.emit(` instanceof Node ? ${c} : (${c} != null ? document.createTextNode(String(${c})) : document.createComment(''))`);
    });
    return v;
  }

  // A child-component position (`Counter`, `Counter label: x`, `Card`
  // + children). Props evaluate in the PARENT scope; a bare reactive
  // member or module reactive name passes its CONTAINER (child writes
  // reach the parent's state; `<=>` is sugar over the same channel — the
  // module-name cell binds LIVE, never a stale snapshot); any other
  // expression snapshots, and a reactive one drives an `_updateProp`
  // effect (so updates into non-reactive child props are loud at the
  // runtime root, and the stale loop-var cell patches live). Children
  // build in the CURRENT scope and pass as ONE `children` prop
  // (duplicate `children:` keys would silently drop all but the last).
  // `@event:` pairs listen on the element the child inherits through
  // `extends` (a hostless child has no element that means the event,
  // and a child notifies its parent through a callback prop).
  // Construction failures degrade to a comment placeholder at runtime
  // and continue; a NAME that resolves to nothing rejects here — the
  // compile-knowable half. Class-mode instances ride `_children` (the
  // unmount cascade); factory instances ride the block's minted kids
  // array, unmounted in d().
  renderChildComponent(node, name, args) {
    const R = this.rstate;
    const rec = R.sink;
    const markNode = isStruct(node) ? node : null;
    // A member path arrives as { text, node }: the root resolves as a bare
    // name does, and the dotted text names the child wherever a name would.
    const ref = typeof name === 'string' ? null : name;
    if (ref !== null) name = ref.text;
    const root = ref !== null ? componentPathRoot(ref.text) : name;
    // The name's own leaf: the bare word, or a call's callee.
    const nameLeaf = ref !== null ? null : isCall(node) ? node[2] : node;
    const emitName = () => (wordOf(nameLeaf) === name ? this.emitLeaf(nameLeaf, name) : this.emitWordAt(name, null));
    // The row carries the keys the site passes, a bind's minted key
    // under the prop's own name, so a missing required prop is named
    // from the record rather than from the checker's elided sentence.
    let useSpan = null;
    const noteUse = (span) => {
      if (!this.ts || span === null) return;
      useSpan = span;
      const keys = props.map(({ key }) => {
        const k = unquoteKey(key);
        return bindTarget(k) ?? k;
      });
      this.componentUses.push({ start: span[0], end: span[1], name, keys });
    };
    // The component's own name at a USE site answers: the constructor
    // reference emits it verbatim, so tsgo describes the component's
    // construct signature there, and the editor re-dresses that answer
    // in the author's vocabulary — bind slots and container unions out,
    // `component <Name>` head on (presentComponentSignatureHover;
    // RULINGS.md, the component-use row).

    // ── The constructor reference ──
    // Loop variables and render locals shadow the module reading (row
    // data can hold a class); members resolve through the instance;
    // module bindings and imports emit bare.
    let ctorRef;
    if (ref !== null) {
      if (this.renderVarKind(root) === null && this.resolveBareRead(root) === null &&
          !this.inScope(root) && !this.moduleBound.has(root)) {
        throw this.positionedError(markNode ?? node,
          `emitter: component '${name}' is not defined in this module — a child component's path starts at a module ` +
          `binding, an import, or a component member, and '${root}' is none of these`, this.rstate.node);
      }
      const pathId = this.rowIdOf(ref.node) ?? null;
      ctorRef = () => {
        noteUse(pathId !== null ? this.stores.selfSpan(pathId) : null);
        this.renderExpr(ref.node);
      };
    } else if (this.renderVarKind(name) !== null) {
      ctorRef = () => noteUse(emitName());
    } else {
      const r = this.resolveBareRead(name);
      if (r === 'member' || r === 'member-reactive') {
        ctorRef = () => {
          this.b.emit(`${this.renderSelf ?? 'this'}.`);
          noteUse(emitName());
          if (r === 'member-reactive') this.b.emit('.value');
        };
      } else if (r === 'reactive') {
        ctorRef = () => { noteUse(emitName()); this.b.emit('.value'); };
      } else if (this.inScope(name) || this.moduleBound.has(name)) {
        ctorRef = () => noteUse(emitName());
      } else {
        throw this.positionedError(markNode ?? node,
          `emitter: component '${name}' is not defined in this module — a child component must be a module binding, ` +
          'an import, or a component member (an undefined name would degrade to a comment placeholder at mount)', this.rstate.node);
      }
    }

    // The instance/root slots allocate BEFORE the children walk, which
    // keeps the data-part rule honest: a component whose first renderable
    // is a CHILD component carries no data-part of its own; the child's
    // render carries its own.
    const instVar = this.newRenderVar('inst');
    const elVar = this.newRenderVar('el');
    // Under `extends <Component>`, the FIRST class-scope construction
    // of the host takes rest: spread into its props ahead of the line's
    // own keys, and bound as the instance later rest writes route
    // through (bindInheritedTarget's rule, for a part).
    const isHost = R.frame.extendsComponent === name && rec.kind === 'class' && R.frame.inheritedBound !== true &&
      this.renderVarKind(root) === null && this.resolveBareRead(root) === null;
    if (isHost) R.frame.inheritedBound = true;

    // ── The argument walk: props, event bindings, children ──
    const props = [];      // { pair, key, fn } in source order
    const updaters = [];   // { pair, key, value } — reactive snapshots
    const eventBindings = []; // { pair, event, value }
    const childVars = [];

    // Every prop key lands ONCE: duplicate keys would emit one JS
    // object literal where the last silently wins, and on an EXTENDS
    // child a duplicated key can leave TWO live writers racing over the
    // inherited element (the first key's _updateProp effect beside the
    // second's rest application). `__bind_x__` normalizes to `x`: a bind
    // and a plain prop of one name write the same member. `children`
    // collides across SPELLINGS — an explicit `children:` pair, the
    // element body, and a nested `slot` forwarding the received children.
    const seenKeys = new Map();
    let childrenFrom = null;
    const declareKey = (rawKey, pair, spelling = 'prop') => {
      const k = bindTarget(rawKey) ?? rawKey;
      if (seenKeys.has(k)) {
        if (k === 'children') {
          throw this.positionedError(pair ?? markNode ?? node,
            `emitter: this child component receives \`children\` TWICE — ${CHILDREN_SPELLINGS[childrenFrom]} beside ` +
            `${CHILDREN_SPELLINGS[spelling]}; give the children ONE spelling: the element body (indented or inline), ` +
            'the explicit `children:` prop, or a nested `slot` forwarding the received children', this.rstate.node);
        }
        throw this.positionedError(pair ?? markNode ?? node,
          `emitter: duplicate prop '${k}' on a child component — duplicate keys emit one object literal where the ` +
          'last silently wins, and on an extends child the pair leaves two live writers racing over the inherited ' +
          'element; pass one value per prop', this.rstate.node);
      }
      seenKeys.set(k, pair ?? null);
      if (k === 'children') childrenFrom = spelling;
    };

    const addPair = (pair) => {
      if (isSpread(pair)) throw this.renderSpreadError(pair, name);
      if (!isNode(pair) || pair.length !== 4) {
        throw this.positionedError(pair, 'emitter: unsupported attribute form on a child component', markNode ?? this.rstate.node);
      }
      if (R.suppressedPairs.has(pair)) return; // an extracted loop `key:`
      const [, , keyNode, value] = pair;
      // `@event: handler` — a listener on the child's root element.
      const event = thisField(keyNode);
      if (event !== null) {
        this.checkCrossScopeLocals(value, pair);
        eventBindings.push({ pair, event, value });
        return;
      }
      takePropDirectives(pair);
      const key = wordOf(keyNode);
      if (key === undefined) {
        throw this.positionedError(pair, 'emitter: computed prop keys are not supported on a child component', markNode ?? this.rstate.node);
      }
      const cleanKey = unquoteKey(key);
      if (cleanKey === '__transition__') {
        throw this.positionedError(pair,
          'emitter: a transition directive has no child-component reading — the enter/leave phases animate ELEMENTS ' +
          "; put it on the branch's first element, inside the child's own render", this.rstate.node);
      }
      if (cleanKey === 'ref') {
        throw this.positionedError(pair,
          'emitter: `ref:` captures ELEMENTS — on a child component it has no reading ' +
          '(a dead prop, silently); put the ref on an element inside the child, or emit the instance ' +
          'through an event', this.rstate.node);
      }
      if (cleanKey === 'key') {
        throw this.positionedError(pair,
          "emitter: `key:` identifies loop rows — it is read only on the FIRST element of a `for` body inside render; " +
          'anywhere else it would leak into the DOM as an attribute', this.rstate.node);
      }
      // `__bind_x__` (the `<=>` channel): the RHS must be able to
      // carry a CONTAINER — the bare reactive member / module
      // reactive name shares it; loop variables, locals, and chains
      // pass through (row data may hold one); a statically-knowable
      // non-container rejects (a one-shot binding would be silently
      // dead).
      declareKey(cleanKey, pair);
      const boundName = bindTarget(cleanKey);
      if (boundName !== null) {
        this.checkUserSpelledBind(pair);
        // Same channel as an intrinsic bind, by the child-component
        // route: the target under its rewritten spelling (whose leaf
        // spans the source word) and the name bound to it, which the
        // pair's cover describes as the minted props slot rather than as
        // itself.
        this.noteVocabulary('render-channel', cleanKey, pair);
        const container = this.childContainerRef(value);
        if (container !== null) {
          props.push({ pair, key, fn: container });
          return;
        }
        const dead = (what, fix) => this.positionedError(pair,
          `emitter: \`${boundName} <=> …\` on a child component shares a reactive CONTAINER, and ${what} ` +
          `; ${fix}`,
          this.rstate.node);
        const valueWord = wordOf(value);
        if (valueWord !== undefined && this.renderVarKind(valueWord) === null) {
          const r = this.resolveBareRead(valueWord);
          if (r === 'member') throw dead(`'${valueWord}' is a plain member`, "declare it with ':=' to share it");
          if (r === null && !this.inScope(valueWord)) {
            throw dead(`'${valueWord}' is not declared`, 'bind a reactive member or module reactive name');
          }
        }
        if (thisField(value) !== null) {
          throw dead(`'@${thisField(value)}' is not a reactive member`, "declare it with ':=' to share it");
        }
        if (valueWord === undefined && !this.isChainNodeOf(value)) {
          throw dead('this expression is never a container', 'bind a reactive member or module reactive name');
        }
        this.checkCrossScopeLocals(value, pair);
        props.push({ pair, key, fn: () => this.renderExpr(value) });
        return;
      }
      const merge = isHost ? this.hostMergeKey(cleanKey) : null;
      if (merge !== null) {
        this.checkCrossScopeLocals(value, pair);
        props.push({ pair, key, fn: () => this.emitHostMerge(merge, value) });
        updaters.push({ pair, key, value, merge });
        return;
      }
      this.addChildProp(props, updaters, pair, key, cleanKey, value);
    };

    // A bare TEMPLATE-TAG word (or `slot`) under a child component that
    // ALSO names a module value: the element reading and the value
    // reading collide, and the value wins SILENTLY — `Card div` beside
    // `div = "TEXT"` renders the string, no element, no error. Nothing
    // downstream can see it: a value passed as children is well-typed.
    //
    // The word that resolves to NOTHING is not refused here. It becomes
    // boolean-prop shorthand, and if the component declares no such prop
    // the type layer says so exactly — TS2353, naming the prop and the
    // props type, at the word itself, across files as well as within
    // one. That is the same fact this refusal would report, from the
    // instrument that can also tell a DECLARED prop from an undeclared
    // one; refusing ahead of it costs every legitimate `Button link`
    // whose component declares `link`.
    // Render locals and loop variables keep the established
    // shadow-to-text rule; members keep their text reading.
    const rejectTagWord = (owner, word) => {
      throw this.positionedError(owner,
        `emitter: bare '${word}' under a child component is ambiguous — it names an HTML element AND a ` +
        `value in scope, and the value would win silently; render the value with \`= ${word}\`, ` +
        'or give the element content or attributes',
        this.rstate.node);
    };
    const addBareWord = (leaf, word) => {
      // A bare word resolving to NOTHING is boolean-prop shorthand
      // (`Button outline` ⇒ `outline: true`); in-scope values fall
      // through to the children build as text. The word's face row is
      // its own token.
      declareKey(word, null);
      props.push({ pair: null, key: word, span: this.ts ? this.leafSpan(leaf, word, null) : null, fn: () => this.b.emit('true') });
    };

    // A directive INSIDE the element body (above a bind/prop line)
    // attaches to the props object (above the FIRST line — same
    // start, and the attachment pre-pass sorts the object first) or
    // to one of its pairs. An EVENT pair keeps its attachment: its
    // addEventListener replay line consumes it like any pair-owned
    // line. A PROP pair's only face manifestation is the ctor call's
    // argument object, so its directives collect here — and their
    // presence switches the ctor emission below to ONE PAIR PER LINE,
    // the only shape under which TypeScript's next-line suppression
    // can govern one prop without blinding its siblings (one shared
    // line would also read every stacked sibling directive but the
    // last as unused, TS2578). Collection runs in BOTH modes — the
    // per-line layout must too, or stripping the face's directive
    // lines would not restore the JS bytes; only the directive
    // lines themselves are ts-gated.
    const propDirs = new Map();  // prop pair → its directives
    const takePropDirectives = (pair) => {
      const attached = this.tsDirectiveMap.get(pair);
      if (attached === undefined) return;
      this.tsDirectiveMap.delete(pair);
      propDirs.set(pair, [...(propDirs.get(pair) ?? []), ...attached]);
    };
    const rehomeObjectDirectives = (obj) => {
      if (!this.tsDirectiveMap.has(obj)) return;
      // Re-homing is line-preserving or nothing: the directive sat
      // above the FIRST pair's line, so only that pair may take it. An
      // extracted loop `key:` first pair never emits a line of its own
      // — DECLINE (the comment stays ordinary) rather than govern a
      // sibling line the author never wrote it above.
      const firstPair = obj[2];
      if (firstPair === undefined || R.suppressedPairs.has(firstPair)) return;
      this.rehomeDirectives(obj, firstPair);
    };

    // First pass: props classify in source order; DOM children
    // collect for the build below (the split — every non-prop arg
    // is child DOM).
    const domItems = [];
    let forwardSlot = false;
    // A word that names no element or component in scope.
    const isTextChild = (arg) => {
      const word = wordOf(arg);
      return word !== undefined && !((isHtmlTag(word.split(/[#.]/)[0]) || isComponentName(word.split(/[#.]/)[0])) &&
        this.renderVarKind(word) === null && this.resolveBareRead(word) === null);
    };
    const classifyChild = (arg) => {
      if (arg == null) return;
      if (isSpread(arg)) throw this.renderSpreadError(arg, name);
      const word = wordOf(arg);
      const isBareWord = word !== undefined && isIdentifierName(word) &&
        this.renderVarKind(word) === null && this.resolveBareRead(word) === null;
      if (isBareWord && (isHtmlTag(word) || word === 'slot')
          && (this.inScope(word) || this.moduleBound.has(word))) {
        rejectTagWord(markNode ?? this.rstate.node, word);
      }
      // A nested `slot` is the received children, forwarded — never
      // a boolean-shorthand prop named `slot`. Alone, it passes the
      // member itself (the children build below); beside body
      // content it materializes into the fragment like any slot line.
      // A `slot` that resolves to a value keeps the shadow-to-text
      // rule (isBareWord is false for it).
      if (isBareWord && word === 'slot') {
        forwardSlot = true;
        domItems.push(arg);
        return;
      }
      if (isBareWord && !this.inScope(word) && !this.moduleBound.has(word)) {
        addBareWord(arg, word);
        return;
      }
      domItems.push(arg);
    };
    for (const arg of args) {
      if (this.isObject(arg)) {
        rehomeObjectDirectives(arg);
        for (const pair of arg.slice(2)) addPair(pair);
      } else if (isFunc(arg)) {
        throw this.positionedError(arg, arg[2].length > 0
          ? `emitter: a parameterized function is not a render child — the children of '${name}' arrive as a bare block ` +
            '(a callback the component should run is passed as a named prop)'
          : RENDER_FUNC_CHILD, this.rstate.node);
      } else if (isChildren(arg)) {
        // Objects are props, bare words follow the scope rule, everything
        // else is child DOM.
        for (const child of arg[2].slice(2)) {
          if (this.isObject(child)) {
            rehomeObjectDirectives(child);
            for (const pair of child.slice(2)) addPair(pair);
          } else {
            classifyChild(child);
          }
        }
      } else {
        classifyChild(arg);
      }
    }

    // ── The children build: one child directly; several through a
    // fragment allocated FIRST with interleaved appends. A text child
    // keeps the shape — no String() wrap; a reactive one binds live. ──
    const buildChild = (arg) => {
      if (!isTextChild(arg)) return this.renderNode(arg);
      this.checkCrossScopeLocals(arg, markNode ?? this.rstate.node);
      const emitValue = () => this.renderExpr(arg);
      return this.renderReactive(arg) ? this.renderLiveText(markNode, emitValue, arg) : this.renderStaticText(markNode, emitValue);
    };
    // A body projection is built after the instance exists and under
    // it, so a part constructed inside it has the receiver on its
    // parent chain; the emitting component stays its owner.
    let projection = null;
    const renderables = domItems.filter((a) => !this.isRenderBinding(a));
    if (renderables.length === 1 && forwardSlot) {
      // The forward: `Section` + nested `slot` is `Section children:
      // @children` — the received children pass through unmaterialized,
      // so the child's own slot decides how a plain value renders.
      declareKey('children', null, 'slot');
      this.claimSlot(markNode);
      const slotSpan = this.ts ? this.wordSpanIn('slot', markNode ?? this.rstate.node) : null;
      for (const arg of domItems) if (wordOf(arg) !== 'slot') buildChild(arg);
      props.push({ pair: null, key: 'children', fn: () => this.emitChildrenRead(slotSpan) });
    } else if (renderables.length === 1) {
      declareKey('children', null, 'body');
      projection = () => {
        let childrenVar = null;
        for (const arg of domItems) {
          const v = buildChild(arg);
          if (v != null) childrenVar = v;
        }
        return childrenVar;
      };
    } else if (renderables.length > 1) {
      declareKey('children', null, 'body');
      projection = () => {
        const frag = this.newRenderVar('frag');
        this.renderLine(null, () => this.b.emit(`${frag} = document.createDocumentFragment()`));
        for (const arg of domItems) {
          const v = buildChild(arg);
          if (v != null) this.renderLine(null, () => this.b.emit(`${frag}.appendChild(${v})`));
        }
        return frag;
      };
    } else {
      for (const arg of domItems) buildChild(arg);
    }

    // ── The instantiation protocol. Child creation and setup use the
    // runtime's mount transaction, so root and child paths share one
    // state machine and rollback owner. ──
    // The braced scaffold consts mint against every name the
    // construct spells (module-level `__` names read inside prop
    // values must not be captured).
    const used = new Set([...rec.bindings, ...rec.locals]);
    if (rec.vars !== null) for (const v of rec.vars) used.add(v);
    if (isStruct(node)) Emitter.collectLeafNames(node, used);
    const prevV = Emitter.mintName('__prev', used);
    const kidV = Emitter.mintName('__kid', used);
    const errV = Emitter.mintName('__childErr', used);
    if (rec.kind !== 'class') rec.hasKids = true;

    const line = (fn) => this.renderLine(markNode, fn, false);
    const self = () => this.renderSelf ?? 'this';
    // Inside another component's projection the receiver stays current
    // and the emitting component stays owner; outside, the emitting
    // component is both. A receiver held on the component is reached
    // through the current self: inside a block the component is `ctx`,
    // and `this` there is the block.
    // The lines below replay later, under the self of wherever they land,
    // so the spelling is taken at replay.
    const held = this.projectionHost;
    this.threadProjectionHost(held);
    const host = () => held !== null && held.startsWith('this.') ? `${self()}.${held.slice(5)}` : held;
    line(() => this.b.emit(held !== null
      ? `{ const ${prevV} = ${host()}._beginProjection(${self()}); try {`
      : `{ const ${prevV} = ${this.runtimeName('__pushComponent')}(${self()}); try {`));
    line(() => this.b.emit('try {'));
    line(() => {
      this.b.emit(`${instVar} = new `);
      ctorRef();
      this.b.emit('(');
      if (props.length === 0) {
        this.b.emit(isHost ? `{ ...${self()}._rest }` : '{}');
      } else {
        // With directive-carrying pairs, the argument object emits ONE
        // PAIR PER LINE so each directive sits directly above the face
        // line its own pair's diagnostics land on. Without them it keeps
        // the compact single-line form.
        const multi = propDirs.size > 0;
        const inner = this.replayPad + '  ';
        this.b.emit(multi ? '{' : '{ ');
        if (isHost) this.b.emit(multi ? `\n${inner}...${self()}._rest,` : `...${self()}._rest, `);
        props.forEach((p, i) => {
          if (multi) {
            if (i > 0) this.b.emit(',');
            this.b.emit('\n');
            const dirs = p.pair !== null ? propDirs.get(p.pair) : undefined;
            if (this.ts && dirs !== undefined) for (const d of dirs) this.tsDirectiveLine(d, inner, true);
            this.b.emit(inner);
          } else if (i > 0) this.b.emit(', ');
          const emitPair = () => {
            // Every spelling of the KEY records its generated span into
            // the attrNames channel (TS face only): the token-suppression
            // correction is keyed by these spans, so a prop key loses its
            // `property` token while an object literal inside the VALUE
            // (emitted by p.fn below) keeps every one of its own.
            const recordAttr = (fn) => {
              const start = this.b.offset;
              const keySpan = fn();
              if (this.ts) this.attrNames.push([start, this.b.offset]);
              // A route-wrapped href prop pairs its key span with the
              // value span its fn records (see addChildProp).
              if ('routeKey' in p) p.routeKey = [start, this.b.offset];
              // The property NAME is the props-object road's relation
              // site — TS2322 and TS2353 both stand on it (WHERE A PAIR'S
              // DIAGNOSTIC LANDS, in the intrinsic pair loop); `fn`
              // returns the key's source span, the anchor.
              if (this.ts && keySpan != null) {
                const pid = p.pair !== null ? this.rowIdOf(p.pair) : null;
                const extent = pid !== null ? this.stores.selfSpan(pid) : null;
                const key = [keySpan[0], keySpan[1]];
                this.renderPairs.push({ key, pair: extent ?? key, sites: [[start, this.b.offset]] });
              }
            };
            // A boolean-shorthand key's derived span records a face
            // row (the builder's verbatim comparison makes it EXACT —
            // same bytes), so completions and diagnostics at the
            // word's own position map into the ctor object. Face-only:
            // JS-mode rows would revise the corpus map artifacts for
            // an editor-consumer concern.
            const mid = this.rowIdOf(markNode);
            if (this.ts && p.span != null && mid !== null) {
              recordAttr(() => {
                this.b.markSpan(mid, 'shorthandProp', p.span[0], p.span[1], () => this.b.emit(p.key));
                return [p.span[0], p.span[1]];
              });
              this.b.emit(': ');
              p.fn();
              return;
            }
            const bound = bindTarget(p.key);
            if (bound !== null) {
              recordAttr(() => {
                const gen = this.b.offset;
                this.b.emit('__bind_');
                const span = p.pair !== null ? this.emitLeafAs(p.pair[2], bound) : (this.b.emit(bound), null);
                if (this.ts && span !== null) {
                  this.intrinsics.push({ start: span[0], end: span[1], kind: 'bind', name: bound, gen });
                }
                this.b.emit('__');
                return span;
              });
            } else {
              recordAttr(() => (p.pair !== null ? this.emitLeaf(p.pair[2], p.key) : this.emitWordAt(p.key, null)));
            }
            this.b.emit(': ');
            p.fn();
          };
          if (p.pair !== null && this.rowIdOf(p.pair) !== null) this.mark(p.pair, '$self', emitPair);
          else emitPair();
        });
        this.b.emit(multi ? `\n${this.replayPad}}` : ' }');
      }
      this.b.emit(');');
    });
    line(() => this.b.emit(`if (${instVar} && ${instVar}._initFailed) {`));
    line(() => this.b.emit(`  ${instVar} = null;`));
    line(() => this.b.emit(`  ${elVar} = document.createComment('rip:child-init-failed: ${name}');`));
    if (projection !== null) {
      line(() => this.b.emit('} else {'));
      line(() => this.b.emit(`{ const ${kidV} = ${instVar}._beginProjection(${self()}); try {`));
      const outerHost = this.projectionHost;
      this.projectionHost = instVar;
      const from = rec.setups.length;
      let childrenVar;
      try { childrenVar = projection(); } finally { this.projectionHost = outerHost; }
      // The projection's setups — its lists, its branches, its text
      // bindings — run only while the child stands: a child whose
      // construction failed is null at its construct site, and the
      // nodes and anchors those setups drive may never have been made.
      // Their error would mask the child's own. A projected child's
      // latch is the exception, in its place: it guards itself, and a
      // child the projection made must leave `mounting` to unmount.
      const guard = (setups) => ({
        kind: 'raw',
        node: null,
        fn: (pad) => {
          this.b.emit(`${pad}if (${instVar}) {\n`);
          this.replaySetups({ setups }, `${pad}  `);
          this.b.emit(`${pad}}\n`);
        },
      });
      let run = [];
      for (const s of rec.setups.splice(from)) {
        if (s.latch !== true) { run.push(s); continue; }
        if (run.length > 0) rec.setups.push(guard(run));
        run = [];
        rec.setups.push(s);
      }
      if (run.length > 0) rec.setups.push(guard(run));
      line(() => this.b.emit(`} finally { ${instVar}._endProjection(${kidV}); } }`));
      line(() => this.b.emit(`${instVar}._setChildren(${childrenVar});`));
    }
    line(() => {
      this.b.emit(projection !== null ? 'if (' : '} else if (');
      const emitCreate = () => this.b.emit(`${instVar}._mountCreate()`);
      if (markNode !== null) this.mark(markNode, '$self', emitCreate);
      else emitCreate();
      this.b.emit(') {');
    });
    line(() => this.b.emit(`  ${elVar} = ${instVar}._root;`));
    if (isHost) {
      // `class` and `className` are one key: the line passing either owns
      // both, or the rest road would push a caller's other spelling past
      // the merged value the updater just passed.
      const ownKeys = new Set([...seenKeys.keys()].filter((k) => k !== 'children'));
      pairClassKeys(ownKeys);
      const own = [...ownKeys].map((k) => JSON.stringify(k)).join(', ');
      line(() => this.b.emit(`  ${self()}._inheritedInst = ${instVar};`));
      line(() => this.b.emit(`  ${self()}._inheritedOwn = new Set([${own}]);`));
    }
    if (rec.kind === 'class') {
      line(() => this.b.emit(`  (this._children || (this._children = [])).push(${instVar});`));
    } else {
      line(() => this.b.emit(`  ${rec.kidsVar}.push(${instVar});`));
    }
    line(() => this.b.emit('} else {'));
    line(() => this.b.emit(`  ${instVar} = null;`));
    line(() => this.b.emit(`  ${elVar} = document.createComment('rip:child-error: ${name}');`));
    line(() => this.b.emit('}'));
    if (projection !== null) line(() => this.b.emit('}'));
    line(() => this.b.emit(`} catch (${errV}) {`));
    line(() => this.b.emit(`  ${this.runtimeName('__reportChildFailure')}('${name}', ${errV});`));
    line(() => this.b.emit(`  ${instVar} = null;`));
    line(() => this.b.emit(`  ${elVar} = document.createComment('rip:child-error: ${name}');`));
    line(() => this.b.emit('}'));
    line(() => this.b.emit(held !== null
      ? `} finally { ${host()}._endProjection(${prevV}); } }`
      : `} finally { ${this.runtimeName('__popComponent')}(${prevV}); } }`));

    // `@event:` on a child is a DOM listener on the element the child
    // inherits through `extends`, admitting what a native site admits
    // (a custom name is legal DOM, and a host document may read its own
    // spellings — the TUI's `keydownCapture`), and nothing else: a child
    // with no host has no element to listen on, which the face reports
    // through the child's `__host` (an import's host is unknowable
    // here) and the runtime rejects at the site. A child notifies its
    // parent through a callback prop. The listener param mints against
    // the handler's reads.
    for (const { pair, event, value } of eventBindings) {
      // The host is the child's declared `__host`. The `__hostOf` call
      // asserts it by the direct index, which misses on a hostless
      // child's `{}` whatever shape the handler takes; the handler's
      // `target` and `currentTarget` are claimed through an Extract
      // that resolves to never on that miss, so the site draws the one
      // report. The event word's record serves the map entry
      // (RULINGS.md, the event-word row).
      // Every copy of the child's name in the casts maps to the
      // constructor reference's span, so a rename of the child edits them
      // with it; a member path spells as text.
      const childName = () => {
        if (ref === null && useSpan !== null) this.emitWordAt(name, useSpan);
        else this.b.emit(name);
      };
      const hostRecord = () => { this.b.emit('NonNullable<InstanceType<typeof '); childName(); this.b.emit(`>['${HOST}']>`); };
      const hostEl = () => { hostRecord(); this.b.emit("['el']"); };
      const host = () => { this.b.emit('Extract<'); hostRecord(); this.b.emit(", { el: unknown }>['el']"); };
      const known = this.ts && DOM_EVENTS.has(event)
        ? () => {
          this.b.emit(`HTMLElementEventMap['${event}'] & { target: `); host();
          this.b.emit('; currentTarget: '); host(); this.b.emit(' }');
        }
        : null;
      if (this.ts) {
        const keyNode = isStruct(pair[2]) ? pair[2] : null;
        const keyId = keyNode !== null ? (this.rowIdOf(keyNode) ?? null) : null;
        const keySpan = keyId !== null ? this.stores.selfSpan(keyId) : null;
        if (keySpan !== null) {
          this.intrinsics.push({
            start: keySpan[0], end: keySpan[1], kind: 'event', name: event,
            type: DOM_EVENTS.has(event) ? `HTMLElementEventMap['${event}']` : null,
            child: name,
          });
        }
      }
      // The pair's relation site is the listener's host cast: a hostless
      // child's `{}` misses inside it, and the diagnostics road re-anchors
      // that miss on the key (packages/vscode/src/diagnostics.js).
      const rec = this.pairRelationRecord(pair);
      const ev = Emitter.eventParamName(value);
      this.renderLine(pair, () => {
        // The wrapper's own param is lowering plumbing — explicit
        // `any` (the handler EXPRESSION is where typing lands).
        const target = `${this.runtimeName('__hostOf')}(${instVar}, '${event}')`;
        if (!this.ts) {
          this.b.emit(`if (${instVar}) ${target}.addEventListener('${event}', (${ev}`);
        } else {
          this.b.emit(`if (${instVar}) (${target}`);
          const hostStart = this.b.offset;
          this.b.emit(' as '); hostEl();
          if (rec !== null) rec.sites.push([hostStart, this.b.offset]);
          this.b.emit(').addEventListener(');
          this.emitQuotedWord(pair[2][3], event);
          this.b.emit(`, (${ev}`);
        }
        this.tsScaffoldAny();
        this.b.emit(`) => ${this.runtimeName('__batch')}(() => (`);
        // The same handler shapes a native site casts to the event's
        // function type take the typed cast here (tsHandlerCast).
        const evType = this.handlerCastType(value, known, known);
        this.tsHandlerCast(() => this.withExpression(() => this.asReference(value, () => this.expr(value))), evType);
        this.b.emit(`)(${ev})))`);
      });
    }

    // ── Setup: the runtime state machine makes this phase exactly
    // once and returns the authoritative node at the child's position.
    // On failure that is the marker, so every later move/destroy reads
    // the placeholder rather than the detached failed root. ──
    rec.setups.push({
      kind: 'raw',
      latch: true,
      fn: (pad) => {
        this.b.emit(pad);
        const emitLatch = () => {
          this.b.emit(
            `if (${instVar} && ${instVar}._state === 'mounting') {\n` +
            `${pad}  ${elVar} = ${instVar}._mountSetup(document.createComment('rip:child-error: ${name}'));\n`,
          );
          // _first tracks the setup-returned node ONLY when the child
          // IS the block's first top-level node (c() latched the same
          // var). A child nested inside another element must never
          // hijack _first: the reconciler uses _first as an
          // insertBefore reference against the block's PARENT, and an
          // interior node is no child of it.
          const fragChildren = this.rstate.fragChildren.get(rec.root);
          const firstNode = fragChildren !== undefined ? fragChildren[0] : rec.root;
          if (rec.kind !== 'class' && firstNode === elVar) {
            this.b.emit(`${pad}  `);
            if (this.ts) this.b.tsOnly(() => this.b.emit('('));
            this.b.emit('this');
            if (this.ts) this.b.tsOnly(() => this.b.emit(' as any)'));
            this.b.emit(`._first = ${elVar};\n`);
          }
          this.b.emit(`${pad}}`);
        };
        if (markNode !== null) this.mark(markNode, '$self', emitLatch);
        else emitLatch();
        this.b.emit('\n');
      },
    });
    for (const { pair, key, value, merge = null } of updaters) {
      this.renderEffect(pair, () => {
        this.b.emit(`if (${instVar}) ${instVar}._updateProp('${unquoteKey(key)}', `);
        if (merge !== null) this.emitHostMerge(merge, value);
        else this.renderExpr(value);
        this.b.emit(');');
      }, value);
    }

    return elVar;
  }

  // An ordinary child-component prop: the bare reactive member /
  // module reactive name passes its CONTAINER; everything else snapshots, and a reactive snapshot drives an
  // _updateProp effect.
  //
  // A prop whose value IS a function literal never takes that effect.
  // Its reads run when the CHILD calls the closure, not while the prop
  // is evaluated, so the value cannot change: the effect would register
  // no dependency (renderReactive's scan reaches into the body, but the
  // body does not run inside the effect) and re-push an identical
  // closure forever. The boundary is the function's VALUE position, not
  // its body: `list.map((x) -> other)` invokes its callback while the
  // prop is evaluated, so that read IS a dependency and still counts.
  addChildProp(props, updaters, pair, key, cleanKey, value) {
    const container = this.childContainerRef(value);
    if (container !== null) {
      props.push({ pair, key, fn: container });
      return;
    }
    this.checkCrossScopeLocals(value, pair);
    // An `href:` prop on a child component route-checks the same way an
    // intrinsic anchor's does. A component's tag is invisible
    // cross-module, so the PROP NAME is the key — `href` is a URL
    // wherever it appears (a forwarding component types it plain
    // `string`, which would otherwise let every literal escape). Only
    // the ctor-object emission wraps; the `_updateProp` re-emission
    // stays unwrapped — the construction site already reported the
    // literal, once.
    const routeWrap = this.ts && this.routesUnion !== null && cleanKey === 'href' && this.isRouteLiteralValue(value);
    if (routeWrap) {
      this._needsRouteHelper = true;
      // `routeKey` is filled by the ctor-object emission when it emits
      // this prop's key (emitPair's recordAttr), BEFORE fn runs — the
      // two spans pair up into one routeWrapSpans entry here.
      const rec = { pair, key, routeKey: null };
      rec.fn = () => {
        this.b.tsOnly(() => this.b.emit('__ripRoute('));
        const valStart = this.b.offset;
        this.renderExpr(value);
        const valEnd = this.b.offset;
        this.b.tsOnly(() => this.b.emit(')'));
        if (rec.routeKey !== null) this.routeWrapSpans.push({ key: rec.routeKey, value: [valStart, valEnd] });
      };
      props.push(rec);
    } else {
      props.push({ pair, key, fn: () => this.renderExpr(value) });
    }
    if (!isFunc(value) && this.renderReactive(value)) updaters.push({ pair, key, value });
  }

  // The container-passable spellings: a bare REACTIVE member (`name`
  // or `@name`) and a bare module-level reactive name. Locals and
  // loop variables shadow (their values pass as row data, never as
  // this-member containers).
  childContainerRef(value) {
    const word = wordOf(value);
    if (word !== undefined) {
      if (this.renderVarKind(word) !== null) return null;
      const r = this.resolveBareRead(word);
      if (r === 'member-reactive') return this.narrowedContainer(word, () => {
        this.b.emit(`${this.renderSelf ?? 'this'}.`);
        // The bind SHARES the container, so this position is the container's
        // — but the author wrote their own binding here, not a consumer's
        // read of an instance, so the name joins the value-first channel and
        // answers the type they bound (RULINGS.md, the name in a bind).
        const span = this.emitLeaf(value, word);
        if (this.ts && span !== null) this.memberDecls.push({ start: span[0], end: span[1] });
        return span;
      });
      if (r === 'reactive') return this.narrowedContainer(word, () => this.emitLeaf(value, word));
      return null;
    }
    const field = thisField(value);
    if (field !== null && this.memberIsReactive(field)) {
      return this.narrowedContainer(field, () => {
        this.b.emit(`${this.renderSelf ?? 'this'}.`);
        return this.emitLeaf(value[3], field);
      });
    }
    return null;
  }

  // A container passed under a branch that tested its member (`if found`
  // … `Child item: found`) wraps, on the face only, in `__ripNarrowed(…)`,
  // a cell with the null dropped from its value: the branch's swap
  // disposes the child, and the child's bindings with it, before any of
  // them re-run against the value that dismissed the block — the same
  // owner-ordered invariant `__ripNarrow` rides
  // (test/ui/branch-order.test.js). Nothing narrows a chain's container
  // (`if session.user` tests a value, not a container), so only the bare
  // spellings qualify.
  narrowedContainer(name, emitRef) {
    if (!this.ts) return emitRef;
    return () => {
      // Read at emission, like narrowGuard: the record open then is the
      // block whose branches were tested.
      const narrowed = this.activeNarrowed().some(({ node }) => wordOf(node) === name || thisField(node) === name);
      if (!narrowed) return emitRef();
      this._needsNarrowedHelper = true;
      this.b.tsOnly(() => this.b.emit('__ripNarrowed('));
      const span = emitRef();
      this.b.tsOnly(() => this.b.emit(')'));
      if (span != null) this.narrowedDecls.push({ start: span[0], end: span[1] });
    };
  }

  // A SYNTACTICALLY `/`-leading string value — a quoted literal, or an
  // interpolated template whose leading chunk is `/`-leading text.
  // These alone wrap in `__ripRoute(...)` for route checking; anything
  // dynamic (a binding, a computed expression, a template opening on an
  // interpolation) must pass unchecked BY CONSTRUCTION — never wrapped,
  // so no inference can tighten it. External URLs (`https:`, `mailto:`,
  // `#frag`) fail the leading-`/` test and pass the same way.
  isRouteLiteralValue(value) {
    const leads = (s) => s !== undefined && /^["'`]\//.test(s);
    return leads(wordOf(value)) || (isNode(value) && value[0] === 'str' && leads(wordOf(value[2])));
  }

  // A pair's diagnostics record (TS face only): its key's and its whole
  // extent's source spans, and the generated relation sites its road
  // fills in as they emit (WHERE A PAIR'S DIAGNOSTIC LANDS, in
  // renderAttributes). Null when the pair has no row or no key text.
  pairRelationRecord(pair) {
    if (!this.ts) return null;
    const pid = this.rowIdOf(pair);
    const extent = pid !== null ? this.stores.selfSpan(pid) : null;
    const src = this.b.source;
    if (extent === null || src === null) return null;
    let ke = extent[0];
    while (ke < extent[1] && !/[\s:]/.test(src[ke])) ke++;
    if (ke === extent[0]) return null;
    const rec = { key: [extent[0], ke], pair: [extent[0], extent[1]], sites: [] };
    this.renderPairs.push(rec);
    return rec;
  }

  // Move the directives attached to an attribute object onto its first
  // pair, ahead of any the pair already carries.
  rehomeDirectives(obj, firstPair) {
    const attached = this.tsDirectiveMap.get(obj);
    this.tsDirectiveMap.delete(obj);
    this.tsDirectiveMap.set(firstPair, [...attached, ...(this.tsDirectiveMap.get(firstPair) ?? [])]);
  }

  // The cast a listener's handler takes on the face: a function literal
  // with no params (the implicit-`it` rule may still hand it one) or one
  // BARE param takes `literalType`; any other literal none (arity
  // forgiveness, or the author's own annotation, governs); a non-literal
  // handler the event's function type.
  handlerCastType(value, known, literalType) {
    if (!this.ts) return null;
    if (!isFunc(value)) return known;
    const params = value[2];
    return params.length === 0 || (params.length === 1 && wordOf(params[0]) !== undefined) ? literalType : null;
  }

  // Does an element's attribute pair emit a replay line of its own? A
  // `class:` merging into the element's clsx call and a factory-side
  // `ref:` riding m() do not; an `@event:` pair's listener line does.
  pairReplays(el, pair) {
    const R = this.rstate;
    const word = wordOf(pair[2]);
    if (word === undefined) return true;
    const key = unquoteKey(word);
    if ((key === 'class' || key === 'className') && R.pendingClassArgs !== null && R.pendingClassEl === el) return false;
    return !(key === 'ref' && R.sink.kind !== 'class');
  }

  // `{ const __v<annotation> = <value>` — the scratch const a nullable
  // attribute or a style write tests. Its NAME is the pair's relation
  // site: the value initializes it against the admitted type, and TS2322
  // stands on the declaration name while the initializer's own
  // complaints stay on the author's bytes. Returns the minted name.
  emitScratchConst(value, site, annotate) {
    const scratch = this.loopTempName('__v');
    this.b.emit('{ const ');
    const at = this.b.offset;
    this.b.emit(scratch);
    site([at, this.b.offset]);
    annotate();
    this.b.emit(' = ');
    this.renderExpr(value);
    return scratch;
  }

  // Attributes, events, and class merges on one element.
  renderAttributes(el, objExpr) {
    const R = this.rstate;
    // A directive above the FIRST attribute line attaches to the props
    // OBJECT (same start, and the attachment pre-pass sorts the object
    // before its first pair) — but an element's replay lines carry the
    // PAIR nodes, so re-home it onto the first pair for the replay
    // consumption every other attribute line already gets. Re-homing
    // is line-preserving or nothing: only the first pair may take it,
    // and only when that pair emits a replay line of its own. A first
    // pair with no line to govern — an extracted loop `key:`, a
    // `class:` merging into the element's clsx call, a factory-side
    // `ref:` riding m() — DECLINES (place-or-decline: the comment
    // stays an ordinary Rip comment) rather than govern a sibling
    // line the author never wrote it above.
    if (this.ts && this.tsDirectiveMap.has(objExpr)) {
      const firstPair = objExpr[2];
      if (firstPair !== undefined && firstPair.length === 4 && !R.suppressedPairs.has(firstPair) &&
          this.pairReplays(el, firstPair)) {
        this.rehomeDirectives(objExpr, firstPair);
      }
    }
    for (const pair of objExpr.slice(2)) {
      if (isSpread(pair)) throw this.renderSpreadError(pair);
      if (!isNode(pair) || pair.length !== 4) {
        throw this.positionedError(pair, 'emitter: unsupported attribute form in render', objExpr);
      }
      // An extracted loop `key:` pair — consumed by the keyFn, never
      // an attribute.
      if (R.suppressedPairs.has(pair)) continue;
      const [, , keyNode, value] = pair;

      // A factory-scoped value must not read an enclosing render
      // scope's locals — EVERY attribute position rejects, not just
      // text/condition sites.
      this.checkCrossScopeLocals(value, pair);

      // WHERE A PAIR'S DIAGNOSTIC LANDS. A complaint that exists only
      // because of the pair — the value against the key's admitted type —
      // lands on the KEY, where JSX puts an attribute's type error and
      // where a reader of markup looks; a complaint the value would draw
      // in any position (name resolution, member access, its own syntax
      // or type errors) is about the value and keeps its bytes. The roads
      // below lower into different TypeScript shapes, and each spells the
      // relation at a different generated position — the scratch const's
      // `__v` name, a property write's left-hand side, the `satisfies`
      // keyword, a call's argument, a props-object key, the handler
      // cast — so each road records its RELATION SITE(S) here, in
      // GENERATED coordinates, beside the key's source span; the
      // diagnostics road re-anchors exactly a diagnostic standing on a
      // recorded site (packages/vscode/src/diagnostics.js). A site is
      // recorded at the moment its bytes emit — the roads run inside
      // deferred closures, and the offset is only known then.
      const rec = this.pairRelationRecord(pair);
      const site = (span) => { if (rec !== null && span !== null && span[1] > span[0]) rec.sites.push(span); };

      // Event binding: `@name: handler`. A dispatch through a bare
      // member name calls the method on the instance (`ctx` inside
      // factories — the factory methods run unbound). The event param
      // mints against the handler's reads (eventParamName).
      const eventName = thisField(keyNode);
      if (eventName !== null) {
        if (this.rstate.sink.kind === 'loop' && this.loopVarNames().size > 0 &&
            referencesNames(value, this.loopVarNames(), this.stores)) {
          // The listener is a CREATE-phase closure over the loop item:
          // p()'s param re-binding keeps it current, but only when p()
          // runs — a block with no effects must not go static.
          this.rstate.sink.forceNonStatic = true;
        }
        const ev = Emitter.eventParamName(value);
        // The receiver surface makes the event NAME a typed position
        // (the event-map overload: completions, hover, and the custom-
        // name fallback — src/ts/dom-types.js); the handler's own
        // typing rides the casts below, host element included.
        const recv = this.tsElReceiver(el);
        const known = this.ts ? this.tsEventTypeText([eventName], recv.hostText) : null;
        // The event WORD answers from the compiler's record (RULINGS.md,
        // the event-word row): the key's face position is the listener
        // call's string literal — no symbol for tsgo — so the handler
        // signature the casts below enforce is served from here.
        if (this.ts) {
          const keyId = this.rowIdOf(keyNode);
          const keySpan = keyId !== null ? this.stores.selfSpan(keyId) : null;
          if (keySpan !== null) {
            this.intrinsics.push({
              start: keySpan[0], end: keySpan[1], kind: 'event', name: eventName,
              type: known, tag: this.rstate.tags.get(el) ?? null, svg: this.rstate.svgEls.has(el),
            });
          }
        }
        this.renderLine(pair, () => {
          const self = this.renderSelf ?? 'this';
          // The wrapper's own param is lowering plumbing — explicit
          // `any`; the typed cast on the handler expression is where
          // the event type lands.
          if (!this.ts) {
            this.b.emit(`${el}.addEventListener('${eventName}', (${ev}`);
          } else {
            recv.emit();
            this.b.emit('.addEventListener(');
            this.emitQuotedWord(keyNode[3], eventName);
            this.b.emit(`, (${ev}`);
          }
          this.tsScaffoldAny();
          this.b.emit(`) => ${this.runtimeName('__batch')}(() => `);
          const handler = wordOf(value);
          if (handler !== undefined && this.renderVarKind(handler) === null &&
              this.cframes[this.cframes.length - 1].members.has(handler)) {
            // A bare member-name handler is checked against the
            // event's real function type when the event is in the
            // vocabulary — a method whose declared parameter cannot
            // take this event draws the cast diagnostic on the
            // handler's own bytes (a custom event keeps `any`: no
            // claim to check against).
            if (this.ts) this.b.tsOnly(() => this.b.emit('('));
            const castStart = this.b.offset;
            this.b.emit(`${self}.`);
            this.emitLeaf(value, handler);
            if (this.ts) this.b.tsOnly(() => this.b.emit(known !== null ? ` as (e: ${known}) => unknown)` : ' as any)'));
            // The `as` expression (its closing paren excluded) is the
            // pair's relation site — TS2352 stands on it.
            if (this.ts && known !== null) site([castStart, this.b.offset - 1]);
            this.b.emit(`(${ev})`);
          } else {
            // The typed cast lands where contextual typing reaches an
            // unannotated parameter and arity forgiveness holds
            // (handlerCastType). A custom event's literal takes
            // `(e: any)` so the bare param stays quiet under
            // noImplicitAny WITHOUT a claim (custom events are legal DOM —
            // src/dom.js); a 2+-param or annotated literal keeps `as any`.
            const evType = this.handlerCastType(value, known, known ?? 'any');
            this.b.emit('(');
            site(this.tsHandlerCast(() => this.withExpression(() => this.asReference(value, () => this.expr(value))), evType));
            this.b.emit(`)(${ev})`);
          }
          this.b.emit('))');
        });
        continue;
      }

      let key = wordOf(keyNode);
      if (key === undefined) {
        throw this.positionedError(pair, 'emitter: computed attribute keys are not supported in render', objExpr);
      }
      // A hyphenated key (`aria-busy`, `data-kind`) is ONE string leaf
      // whose value keeps the quotes; the roads emit the bare spelling,
      // mapped to the key's own token (emitKeyLeaf).
      key = unquoteKey(key);

      // Only the CHANNEL words the lowering spends whole join the
      // render-channel census (`__transition__`, the `ref` key word, a
      // bind's minted key, a loop's `key:`): nothing at those positions
      // survives into the face as the word the user wrote. An attribute,
      // property, boolean, presence, or class KEY owns its exact
      // generated row, so it answers natively — completions, hover, and
      // diagnostics at the word's own position. A component USE takes
      // the other path, where a prop name is the props surface's own
      // declared member (RULINGS.md).
      if (key === '__transition__') {
        this.noteVocabulary('render-channel', key, pair);
        this.renderTransition(el, pair, value);
        continue;
      }
      if (key === 'ref') {
        // The channel's key word is spent; the NAME it binds answers —
        // the wrap gives the cell bytes a real face position, and the
        // value-first channel serves the binding's own type there
        // (RULINGS.md, the ref rows).
        this.noteVocabulary('render-channel', key, pair);
        this.renderRef(el, pair, value, site);
        continue;
      }
      const prop = bindTarget(key);
      if (prop !== null) {
        this.noteVocabulary('render-channel', key, pair);
        this.checkUserSpelledBind(pair);
        // The two-way channel's own halves: the bind TARGET (the prop
        // being bound, which the lowering rewrites into the
        // `__bind_x__` props slot) and the NAME bound to it, which the
        // same cover describes as that slot rather than as itself.
        // The target is recorded under its REWRITTEN spelling: the lexer
        // turned `value <=>` into the `__bind_value__` key, whose leaf
        // spans the source `value`.
        // Looking for the source word instead finds the RHS when a bind
        // names the same word on both sides (`value <=> value`).
        this.renderBind(el, pair, prop, value, objExpr, site);
        continue;
      }
      if (key === 'key') {
        throw this.positionedError(pair,
          "emitter: `key:` identifies loop rows — it is read only on the FIRST element of a `for` body inside render; " +
          'anywhere else it would leak into the DOM as an attribute', objExpr);
      }

      if (key === 'class' || key === 'className') {
        // The write's target, after the receiver. On SVG the class key
        // rides setAttribute (className is not assignable there), so it
        // answers from the record like any other attribute-road key. On
        // HTML it is a real property access and the property road already
        // answers.
        const emitClassTarget = (isSvg) => {
          if (isSvg) {
            const gen = this.b.offset + 1;
            this.b.emit(".setAttribute('");
            const span = this.emitKeyLeaf(keyNode, 'class');
            if (this.ts && span !== null) this.intrinsics.push({ start: span[0], end: span[1], kind: 'attr', name: 'class', gen });
          } else {
            this.b.emit('.');
            this.emitPropertyRoadKey(() => this.emitKeyLeaf(keyNode, 'className'));
          }
        };
        if (R.pendingClassArgs !== null && R.pendingClassEl === el) {
          this.checkSetupLocalRefs(value, pair);
          // The merge dissolves this pair into one `__clsx` argument, so the
          // key emits nothing of its own to claim a span from. The pair's
          // extent starts at the key, which is the span the reader points at.
          const pid = this.rowIdOf(pair);
          const extent = pid !== null ? this.stores.selfSpan(pid) : null;
          if (this.ts && extent !== null) {
            (R.pendingClassKeys ??= []).push([extent[0], extent[0] + key.length]);
          }
          // A `__clsx` argument is the pair's relation site — and the
          // value's own expression, so a whole-span complaint of the
          // value's own stands there too; the diagnostics road tells
          // them apart by the complaint's family.
          R.pendingClassArgs.push(() => site(this.renderExpr(value)));
        } else if (this.renderReactive(value) || this.mergesRestKey(el, 'class')) {
          const isSvg = R.svgDepth > 0;
          const recv = this.tsElReceiver(el);
          const merges = this.mergesRestKey(el, 'class');
          this.renderEffect(pair, () => {
            const clsx = this.runtimeName('__clsx');
            recv.emit();
            emitClassTarget(isSvg);
            this.b.emit(isSvg ? `', ${clsx}(` : ` = ${clsx}(`);
            // The `__clsx` argument (see the merge road above).
            site(this.renderExpr(value));
            if (merges) { this.b.emit(', '); this.emitRestRead('class'); }
            this.b.emit(isSvg ? '));' : ');');
          }, value);
        } else {
          const isSvg = R.svgDepth > 0;
          const compound = isStruct(value);
          const recv = this.tsElReceiver(el);
          this.renderLine(pair, () => {
            // The relation site by shape: an HTML write of a plain value
            // is a property assignment (TS2322 on its left-hand side);
            // the SVG call and the `__clsx` wrap take the value as an
            // argument (see the merge road above).
            const lhsStart = this.b.offset;
            recv.emit();
            emitClassTarget(isSvg);
            if (isSvg) {
              this.b.emit("', ");
            } else {
              if (!compound) site([lhsStart, this.b.offset]);
              this.b.emit(' = ');
            }
            if (compound) this.b.emit(`${this.runtimeName('__clsx')}(`);
            const valueSpan = this.renderExpr(value);
            if (isSvg || compound) site(valueSpan);
            if (compound) this.b.emit(')');
            // The open is branched, so the close is too: SVG opened a CALL, HTML an assignment.
            if (isSvg) this.b.emit(')');
          });
        }
        continue;
      }

      // The property road: a reactive `value:`/`checked:` and the content
      // properties write the element property itself, STRICT under the
      // receiver surface (the tag's own property type: `value: 42` on an
      // input is a number into a string property).
      const contentKey = key === 'innerHTML' || key === 'textContent' || key === 'innerText';
      if (contentKey || key === 'value' || key === 'checked') {
        const reactive = this.renderReactive(value);
        if (reactive || contentKey) {
          const recv = this.tsElReceiver(el);
          const emitAssign = () => {
            // A property write's left-hand side is the pair's relation
            // site — TS2322 stands on the whole receiver-and-property.
            const lhsStart = this.b.offset;
            recv.emit();
            this.b.emit('.');
            this.emitPropertyRoadKey(() => this.emitKeyWord(keyNode, key));
            site([lhsStart, this.b.offset]);
            this.b.emit(' = ');
            this.renderExpr(value);
          };
          if (reactive) {
            this.renderEffect(pair, () => {
              emitAssign();
              // A nullish `value` is the empty field, never the word. A
              // string or template literal is never nullish, and `??` after
              // one is TS2869 on bytes the author never wrote.
              if (key === 'value' && !Emitter.isStringLiteral(value)) this.b.emit(" ?? ''");
              this.b.emit(';');
            }, value);
          } else {
            this.renderLine(pair, emitAssign);
          }
          continue;
        }
      }

      if (Emitter.BOOLEAN_ATTRS.has(key)) {
        // The author VALUE is a truthiness position by the road's own
        // semantics (`!!expr` / `if (expr)`) — governed, never
        // constrained; the KEY answers through the receiver surface.
        const recv = this.tsElReceiver(el);
        // The key's ruled hover carries its type outright: this road
        // spells presence, and its two lowerings (a toggle under a
        // reactive value, a guarded set under a static one) would
        // otherwise describe one key two ways. The span is the key's own
        // CLAIM, so a value repeating the key (`disabled: @rest.disabled`)
        // still lands on the key. A boolean name the tag does not take
        // keeps the re-wording row behind it, as every other road does.
        const emitBooleanKey = () => {
          const span = this.emitKeyLeaf(keyNode, key);
          if (this.ts && recv.surfaced && span !== null) {
            this.intrinsics.push({ start: span[0], end: span[1], kind: 'attr', name: key, type: 'boolean | undefined' });
            const attrTag = this.renderTagOf(el);
            if (!knownBareAttribute(attrTag, key)) {
              this.intrinsics.push({
                start: span[0], end: span[1], kind: 'unknown-attr', tag: attrTag, name: key,
                message: this.unknownAttrMessage(attrTag, key, { bare: false, svg: this.rstate.svgEls.has(el) }),
              });
            }
          }
        };
        // The `satisfies` keyword is the pair's relation site — TS1360
        // stands on the keyword, never on the expression.
        const emitSatisfies = (text) => {
          const satStart = this.b.offset + 1;
          if (!this.ts) return;
          this.b.tsOnly(() => this.b.emit(text));
          site([satStart, satStart + 'satisfies'.length]);
        };
        if (this.renderReactive(value)) {
          this.renderEffect(pair, () => {
            recv.emit();
            this.b.emit(".toggleAttribute('");
            emitBooleanKey();
            this.b.emit("', !!");
            // A boolean attribute admits a BOOLEAN, not any truthy value:
            // `!!` would take anything, so the author's expression states
            // its own type here. TS-only, and parenthesized because
            // `satisfies` binds looser than `!!` — without the parens the
            // negation's own result is what gets checked.
            if (this.ts) this.b.tsOnly(() => this.b.emit('('));
            this.renderExpr(value);
            emitSatisfies(' satisfies boolean | undefined)');
            this.b.emit(');');
          }, value);
        } else {
          this.renderLine(pair, () => {
            this.b.emit('if (');
            // The guard's own parens already group the expression.
            this.withExpression(() => this.expr(value));
            emitSatisfies(' satisfies boolean | undefined');
            this.b.emit(') ');
            recv.emit();
            this.b.emit(".setAttribute('");
            emitBooleanKey();
            this.b.emit("', '')");
          });
        }
        continue;
      }

      // A style OBJECT has no attribute serialization — a browser's
      // setAttribute stringifies it to `[object Object]` — so `style:`
      // has its own road, one for every spelling: `__style(el, value)`,
      // the runtime's one style writer (the rest seam applies through the
      // same one), which sets a string as the attribute, writes an object
      // by key while clearing the keys the last object set, and removes
      // on null. The value checks against the attribute's own type through
      // the scratch const's annotation (the absence fork's shape), and the
      // key's hover answers that type from a record, since no instantiated
      // call stands beside it to read it off.
      if (key === 'style') {
        const recv = this.tsElReceiver(el);
        const merges = this.mergesRestKey(el, 'style');
        const write = () => {
          const scratch = this.emitScratchConst(value, site, () => {
            if (!this.ts) return;
            this.b.tsOnly(() => {
              if (recv.surfaced) {
                this.b.emit(`: ${recv.valsName}['`);
                this.emitKeyLeaf(keyNode, key);
                this.b.emit("'] | undefined");
              } else {
                this.b.emit(': any');
              }
            });
          });
          this.b.emit(`; ${this.runtimeName('__style')}(`);
          recv.emit();
          // The merge reads the rest view's `style` inside the effect and
          // refuses a key both sides set.
          this.b.emit(merges ? `, ${this.renderSelf ?? 'this'}._mergeRestStyle(${scratch})); }` : `, ${scratch}); }`);
        };
        if (merges || this.renderReactive(value)) this.renderEffect(pair, write, value);
        else this.renderLine(pair, write, false);
        if (this.ts && recv.surfaced && rec !== null) {
          this.intrinsics.push({ start: rec.key[0], end: rec.key[1], kind: 'attr', name: key, type: 'string | __RipCSSProperties | undefined' });
        }
        continue;
      }
      // An anchor's `href:` given as a syntactic route literal wraps in
      // `__ripRoute(...)` — TS-only, so the shipping bytes are the
      // untouched value — and checks against the project's route union.
      // Armed only when the caller discovered routes; the wrap replaces
      // nothing at runtime.
      const routeWrap = this.ts && this.routesUnion !== null && key === 'href' &&
        this.rstate.tags.get(el) === 'a' && this.isRouteLiteralValue(value);
      if (routeWrap) this._needsRouteHelper = true;
      // The receiver surface types the KEY (its exact row is already
      // recorded below) and, through the generic setAttribute, the
      // VALUE — the widened `propertyType | string` road. Only where
      // no surface exists does a value-quieting `as any` ride.
      const recv = this.tsElReceiver(el);
      // NULLISH IS ABSENCE on the attribute road: a value that reaches
      // `null`/`undefined` removes the attribute instead of stringifying
      // into it, so `aria-busy: @loading` on an absent optional prop
      // writes no attribute rather than the four letters `null`. The
      // author states the value; the road states what an absent one
      // means. A value whose SPELLING cannot reach either — a quoted
      // string, a number, a boolean literal, or an interpolation, which
      // always yields a string — keeps the direct call. The test reads
      // the value alone and never the face's own wraps: the JS emission
      // and its TS face must fork identically, or stripping the face
      // leaves two shapes that cannot reconcile.
      const valueWord = wordOf(value);
      const nullable = !(
        (valueWord !== undefined && (!isIdentifierName(valueWord) || valueWord === 'true' || valueWord === 'false')) ||
        (isNode(value) && value[0] === 'str')
      );
      // Value checking anchors on the author's bytes through the scratch
      // const's tsOnly annotation: the value expression initializes `__v`
      // against the attribute's type widened by the absence arm, and the
      // narrowed `__v` then satisfies the setAttribute call by itself.
      // An unsurfaced receiver has no attribute type to check against and
      // keeps the quiet-TS-only doctrine's silence.
      // The attribute KEY's ruled hover is served from this record. The
      // key's own face position is a string literal — no symbol, nothing
      // for tsgo to describe — but the call it names is generic over the
      // key, so the INSTANTIATED method beside it spells the value type
      // this attribute admits. The record carries where that method
      // stands; the editor reads the type off it.
      // The record's two halves arrive in either order and from either
      // arm: the absence fork spells the key twice, and the FIRST spelling
      // takes the source claim while only the setAttribute arm names a
      // value type. So each half is captured where it happens and the row
      // goes in once, when both are known.
      let attrSpan = null, attrGen = null, attrRecorded = false;
      const recordAttrKey = () => {
        if (attrRecorded || !this.ts || !recv.surfaced || attrSpan === null || attrGen === null) return;
        attrRecorded = true;
        // A route-checked href answers the type this position actually
        // admits — the project's route union the wrap checks against —
        // rather than the road's generic string. No absence arm: the
        // value is a leading-`/` literal by construction, never nullish.
        this.intrinsics.push(routeWrap
          ? { start: attrSpan[0], end: attrSpan[1], kind: 'attr', name: key, type: this.routesUnion, route: true }
          : { start: attrSpan[0], end: attrSpan[1], kind: 'attr', name: key, gen: attrGen });
        // The name the surface will reject — recorded so the mapper can
        // say which spelling works, the same row the bare road keeps.
        const attrTag = this.renderTagOf(el);
        if (!knownBareAttribute(attrTag, key)) {
          this.intrinsics.push({
            start: attrSpan[0], end: attrSpan[1], kind: 'unknown-attr', tag: attrTag, name: key,
            message: this.unknownAttrMessage(attrTag, key, { bare: false, svg: this.rstate.svgEls.has(el) }),
          });
        }
      };
      // The method the record points at stands one byte past the dot the
      // call opens with.
      const emitSetAttribute = () => {
        attrGen = this.b.offset + 1;
        this.b.emit(".setAttribute('");
        recordAttrKey();
      };
      // The key's own CLAIMED span — never a search for its spelling,
      // which a value repeating the key (`disabled: @rest.disabled`)
      // makes ambiguous.
      const emitAttrKey = () => {
        const span = this.emitKeyLeaf(keyNode, key);
        if (attrSpan === null) attrSpan = span;
        recordAttrKey();
      };
      const nullableAnnotation = () => {
        if (!this.ts) return;
        this.b.tsOnly(() => this.b.emit(recv.surfaced ? `: ${recv.valsName}['${key}'] | undefined` : ': any'));
      };
      // The direct call, for a value that cannot be nullish. The receiver
      // cast is what makes completions INSIDE the literal work: the
      // scaffold var is `any` (quiet-TS-only doctrine), and inside an
      // any-receiver call tsgo stops computing the argument's contextual
      // string-literal completions.
      const emitDirectSet = (close) => {
        recv.emit();
        emitSetAttribute();
        const keyStart = this.b.offset;
        emitAttrKey();
        const keyEnd = this.b.offset;
        this.b.emit("', ");
        if (routeWrap) this.b.tsOnly(() => this.b.emit('__ripRoute('));
        const valStart = this.b.offset;
        // The call's argument is the pair's relation site (TS2345); a
        // literal or a template draws nothing of its own there.
        site(this.renderExpr(value));
        const valEnd = this.b.offset;
        // The value checks against the surface's widened
        // `propertyType | string` road (Rip DOM attributes are coercive by
        // design — numbers and booleans stringify, so the road admits
        // `| string` while a number into a string-typed attribute still
        // errors). The __ripRoute wrap CLOSES WITHOUT a cast: it returns a
        // string-literal type setAttribute already accepts, and an `as any`
        // here collapses tsgo's string-literal completions inside the value
        // to the current literal alone. An UNSURFACED receiver keeps the
        // quieting cast (the lib's string-only setAttribute view is
        // scaffold noise there).
        if (this.ts) {
          if (routeWrap) this.b.tsOnly(() => this.b.emit(')'));
          else if (!recv.surfaced) this.b.tsOnly(() => this.b.emit(' as any'));
        }
        this.b.emit(close);
        if (routeWrap) this.routeWrapSpans.push({ key: [keyStart, keyEnd], value: [valStart, valEnd] });
      };
      if (this.renderReactive(value)) {
        if (nullable) {
          this.renderEffect(pair, () => {
            const scratch = this.emitScratchConst(value, site, nullableAnnotation);
            this.b.emit(`; ${scratch} == null ? `);
            recv.emit();
            this.b.emit(".removeAttribute('");
            emitAttrKey();
            this.b.emit("') : ");
            recv.emit();
            emitSetAttribute();
            emitAttrKey();
            this.b.emit(`', ${scratch}); }`);
          }, value);
        } else {
          this.renderEffect(pair, () => emitDirectSet(');'), value);
        }
      } else if (nullable) {
        // A fresh element holds no attribute yet, so absence needs no
        // removal here — declining the set IS the absence.
        this.renderLine(pair, () => {
          const scratch = this.emitScratchConst(value, site, nullableAnnotation);
          this.b.emit(`; if (${scratch} != null) `);
          recv.emit();
          emitSetAttribute();
          emitAttrKey();
          this.b.emit(`', ${scratch}); }`);
        }, false);
      } else {
        this.renderLine(pair, () => emitDirectSet(')'));
      }
    }
  }
}
