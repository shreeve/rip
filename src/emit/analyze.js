// The emitter's analysis pass: the facts emission reads before it
// writes a byte, from two walks over the parser's tree. It reads the
// parser's own shapes (src/grammar/grammar.rip `kinds`).
//
// The first walk, in source order, runs several consumers at once. Each
// one has its own notion of where a scope ends, and the boundary rules
// differ by consumer: the frame collectors stop at a class, the hoist
// walks a class's field values and the planner does not, the
// redeclaration check walks a try's handlers before its body. `visit`
// carries one mode word (bits below) plus the collector and
// redeclaration scopes, and each node kind's handler states, per child,
// what every consumer sees. A consumer's boundary rule is a row of that
// dispatch, never a walk of its own.
//
// The scopes then settle outermost first (each one's hoist entries and
// reference plans against the names its enclosing scopes bind), and the
// second walk reads every tree in the emitter's execution order (values
// before the targets they write, nested functions included) for the
// declare-in-place scan and the predicates, each predicate's stops a
// row of that walk.
//
// Facts:
//   bindings, bindingNames   the emit record's binding inventory and the
//                            source bindings runtime aliases dodge
//   runtimes                 the delivery decision, dependencies closed
//   bound                    every name module-level emission declares
//   programHoist             the program scope's hoisted targets,
//                            name → declaring node id
//   typeOnlyImports          imported names used only in type text
//   appAccessors             the rip/app accessor bindings
//   atoms                    every string the trees spell, the seed of
//                            the used-name registry
//   scopes                   per function-like scope: the frame sets and
//                            the authoritative declarations
//   hoists                   per scope the emitter hoists: its entries,
//                            match-write flag, TS annotations and typed
//                            forwards, its temp sites (chain mid
//                            operands, reference plans) in minting
//                            order, its declare-in-place decisions with
//                            the scan facts they rest on, and for a
//                            component's `_init` each state
//                            initializer's HMR thunk
//   fieldPlans               the reference plans of each class field
//                            value, planned in its own evaluation
//   predicateBits            per node id: await, yield, bare `it`,
//                            return, control flow — each under its own
//                            stop rules
// A program the emitter must reject throws here with the emitter's
// message and span: a redeclaration, a block-nested declaration, a
// destructuring target that cannot bind, a parameter default's match
// write, a promoted parameter inside a pattern, a bare `it` no declared binding answers in
// a function that takes parameters.

import { Stores } from '../stores.js';
import { normalizeTypeText } from '../ts/types.js';
import { isAttrs, LEAF_KINDS, isNode, isNone, wordOf, isStruct } from '../sexpr.js';
import { schemaCodeSites, paramsOf, SCHEMA_TREES } from '../schema.js';
import { identifierMatches, isIdentifierName } from '../ident.js';
import { isComponentName } from '../render.js';
import { RUNTIMES, runtimeRequires, bareSpecifier } from './runtimes.js';
import { clsxTagExpr, controlGuard, ifIsSimple, importBindings, importedNames, isBlock, isIf, isMatchArm, isSourceLoop, isSymbol, optionalGuard } from './tree.js';
import { CALL_KINDS, COMPARISONS, isHtmlTag, PATTERN_HEADS, PATTERN_LITERALS, RENDER_BINDING_HEADS, SPINE_HEADS } from './helpers.js';
import { COMPONENT_HOOKS, MEMBER_IN_PARAMETER, MEMBER_LOOP_VARIABLE, PROMOTED_IN_PATTERN, UNBOUND_IT, UPDATE_BEFORE_DECLARATION, bareItSpan, islandSpan, wordSafety } from './names.js';

// ── the mode word ────────────────────────────────────────────────────
// RN: the free-reference walk's position (off, expression, binding
// pattern, render statement).
const RN = 3, RN_EXPR = 1, RN_PAT = 2, RN_RENDER = 3;
const USED = 4;        // the type-only-import use walk (main tree only)
const HOIST = 8;       // the hoist walk of the scope `hs`
const HMATCH = 16;     // the hoist walk's match-write-only scan
const CNEST = 32;      // the frame collectors' block nesting
const RNEST = 64;      // the redeclaration walk's block nesting
const NORAB = 128;     // outside the alias-binding walk
const NOIT = 256;      // a string the bare-`it` scan skips
const PLAN = 512;      // the reference planner's walk of the scope `ps`

// Statement heads (the emitter's spelling) whose bodies are block-
// nested for the frame collectors and the redeclaration walk.
const BLOCK_HEADS = new Set(['if', 'while', 'loop', 'for-in', 'for-of', 'for-as', 'switch', 'when', 'try', 'block', 'comprehension']);
// The assignment heads the scope walks treat as writes, read by headOf:
// the void definition is its own 'void-assign' there, where helpers.js
// ASSIGNS spells it '=', and the two synthesized compounds are absent
// because every walk reads them generically.
const ASSIGNS = new Set(['=', 'void-assign', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=', '<<=', '>>=', '>>>=', '&=', '^=', '|=']);
// The roles whose span is type text. 'declaration' is a type-decl's
// whole `type A = …` text: an import referenced only there is used by a
// type, so it must count, or the alias would read as merely unused.
const TYPE_ROLES = new Set(['annotation', 'returnType', 'typeParams', 'declaration']);
const AMBIENT_KINDS = new Set(['plain', 'state', 'computed', 'effect', 'readonly', 'import', 'class', 'def']);

// The mode word with the free-reference walk, when it is on, at `rn`.
const atRn = (m, rn) => ((m & RN) === 0 ? m : (m & ~RN) | rn);

// The mode word for a structure's children under the generic rule:
// the free-reference walk reads them as expressions, and a block head
// nests the scope walks.
const childMode = (m, hv) => {
  const c = atRn(m, RN_EXPR);
  return BLOCK_HEADS.has(hv) ? c | CNEST | RNEST : c;
};

// A word's flags in Analysis.words: every word spelled is an atom; a
// word in a use position, a use; a word read as a free reference, free.
const W_ATOM = 1, W_USED = 2, W_FREE = 4;

// The shared empty collections a scope holds until it records something.
const EMPTY_MAP = Object.freeze(new Map());
const EMPTY_SET = Object.freeze(new Set());
const EMPTY_ARRAY = Object.freeze([]);
const IT_BINDING = Object.freeze(new Set(['it']));
const IT_PARAMS = Object.freeze(['it']);
// The compound writes: they read their target before writing it.
const COMPOUND_ASSIGNS = new Set(['+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=', '<<=', '>>=', '>>>=', '&=', '^=', '|=']);
// The predicates' bits: does the subtree await, yield, read a bare
// `it`, return, or carry control flow (a return, throw, break or
// continue)?
export const P_AWAIT = 1, P_YIELD = 2, P_IT = 4, P_RETURN = 8, P_CTRL = 16;

// A tag word, read up to any `#id`: an HTML template tag or a custom
// element name.
const isTagWord = (w) => typeof w === 'string' && isHtmlTag(w);

// ── reading the parser's tree ────────────────────────────────────────
// src/sexpr.js reads it: a node is [head, attrs, ...children]; a leaf
// ([kind, {}, raw]), a type value (["type", {}, raw, body]) and a bare
// literal slot ("this", "super", "default", "*") each read as one word
// (wordOf); anything else that is an array is a plumbing list, whose
// first element is a child like the rest, whatever head it spells.
// A node's head is its kind, never a word: no walk counts it as an
// atom, a use or a reference, whatever identifier it spells.

// A render factory's sink: its render locals and the loop variables
// above it, which `bound` answers as one set.
function renderSink(locals, loops, parent = null) {
  return { locals, loops, parent, bound: { has: (n) => locals.has(n) || loops.includes(n) } };
}

// A function node: `->` or `=>` (a head test, never an emission).
const FUNC_HEADS = new Set(['->', '=>']);
// Statement constructs whose blocks the emitter can lay out in place.
const STMT_BLOCK_HEADS = new Set(['if', 'while', 'loop', 'try', 'switch', 'block']);
const isFuncNode = (x) => isNode(x) && FUNC_HEADS.has(x[0]);
const isChildren = (x) => isNode(x) && x[0] === 'children';
const isPattern = (x) => isNode(x) && (x[0] === 'object' || x[0] === 'array');
// A multi-statement computed block: its own scope.
const isComputedBlock = (x) => {
  const v = x[3];
  return x[0] === 'computed' && Array.isArray(v) && v[0] === 'block' && isAttrs(v[1]) && v.length > 3;
};
// The heads of the component body lines a member category takes; the
// emitter rejects every other line as it classifies the body.
const COMPONENT_LINE_HEADS = new Set(['offer', 'accept', 'gate', 'state', 'computed', 'readonly', 'effect', 'render', '?', 'typed-var', '.', '=', 'object']);

// The first member or index target a binding's positions hold (the
// binding itself, a rest's operand, a pattern's elements, a default's,
// annotation's or cast's target), or null. A default's value and a
// computed key are expressions. Unlike Emitter.memberInPattern, a void
// `=` and a void pair hold a target here too: `{k!: a.b}` as a parameter
// or loop variable rejects in this pass, before emission runs its own
// check.
function memberInPattern(p) {
  if (!isNode(p)) return null;
  const h = p[0];
  if (SPINE_HEADS.has(h)) return p;
  if (h === 'rest' || h === '...' || h === 'default' || h === '=' || h === 'typed-var' || h === 'cast' || h === 'satisfies') return memberInPattern(p[2]);
  if (h === 'array') {
    for (let i = 2; i < p.length; i++) { const hit = memberInPattern(p[i]); if (hit !== null) return hit; }
    return null;
  }
  if (h === 'object') {
    for (let i = 2; i < p.length; i++) {
      const pair = p[i];
      if (!isNode(pair)) continue;
      const slot = pair[0] === ':' ? pair[3] : pair[0] === '=' || pair[0] === '...' ? pair[2] : null;
      const hit = memberInPattern(slot);
      if (hit !== null) return hit;
    }
  }
  return null;
}

// The bare name a promoted `@name` parameter binds, read through a
// default and an annotation; undefined for any other parameter.
function promotedName(p) {
  let x = p;
  if (isNode(x) && x[0] === 'default' && x.length === 4) x = x[2];
  if (isNode(x) && x[0] === 'typed-var' && x.length === 4) x = x[2];
  if (isNode(x) && x[0] === '.' && x.length === 4 && wordOf(x[2]) === 'this') return wordOf(x[3]);
  return undefined;
}

// The head the analysis reads a node by: one per loop form, one per void
// spelling, and null for the parts that have no head of their own (a
// plumbing list, an `as` specifier, a shorthand pair).
function headOf(x) {
  if (!isNode(x)) return Array.isArray(x) && x.length > 0 ? null : undefined;
  const h = x[0];
  const a = x[1];
  switch (h) {
    case 'loop':
      switch (a.over) {
        case 'in': return 'for-in';
        case 'of': return 'for-of';
        case 'as': return 'for-as';
        case 'forever': return 'loop';
        case 'times': return 'loop-n';
      }
      throw new Error(`analyze: a loop over '${a.over}' has no reading`);
    case ':': return a.void === true ? 'void-pair' : (a.shorthand === true ? null : ':');
    case '=': return a.void === true ? 'void-assign' : '=';
    case 'readonly': return a.void === true ? 'void-readonly' : 'readonly';
    case 'def': return a.void === true ? 'void-def' : 'def';
    case 'as': return null;
  }
  return h;
}

// ── the analysis ─────────────────────────────────────────────────────

// `dataLine` is the __DATA__ marker's 1-based line when the program has a
// section (parseSource's dataLine): the marker declares DATA in the
// program scope. `reserved` lists the module names the build claims
// ([{ name, kind }]): no module-scope declaring form, write or update may
// take one.
export function analyze(parseResult, { source = '', face = 'js', ambientBindings = null, repl = false, stores = null, dataLine = null, reserved = [] } = {}) {
  if (!parseResult.sexpr) throw new Error('analyze: cannot analyze a failed parse');
  const st = stores ?? new Stores(parseResult.stores);
  const ambient = normalizeAmbient(ambientBindings);
  const a = new Analysis(st, { source, face, ambient, repl, dataLine, reserved });
  a.run(parseResult.sexpr);
  return a.result(ambient);
}

// The ambientBindings option, checked with the emitter's messages.
function normalizeAmbient(ambientBindings) {
  if (ambientBindings == null) return [];
  if (!Array.isArray(ambientBindings)) {
    throw new Error(`emitter: ambientBindings must be an array of {name, kind}; got ${typeof ambientBindings}`);
  }
  const seen = new Set();
  for (const b of ambientBindings) {
    if (b === null || typeof b !== 'object' || !isIdentifierName(b.name)) {
      throw new Error(`emitter: ambientBindings entries are {name, kind} with an identifier name; got ${JSON.stringify(b)}`);
    }
    if (!AMBIENT_KINDS.has(b.kind)) {
      throw new Error(`emitter: ambientBindings kind '${b.kind}' for '${b.name}' is not a binding kind — expected one of ${[...AMBIENT_KINDS].join(', ')}`);
    }
    if (seen.has(b.name)) {
      throw new Error(`emitter: ambientBindings names '${b.name}' twice — one binding per name`);
    }
    seen.add(b.name);
  }
  return ambientBindings;
}

// A function-like scope: the program, a def or function body, a
// multi-statement computed block, an effect body, a schema callable
// body. Its frame sets record each name's declaring node; `forms` are
// the redeclaration walk's declaring forms in that walk's order, with
// any rejection the walk met in place.
class Scope {
  // `body` is the owner's body (its live statements are the scope's
  // statements) or, for the program, a schema body and a single-
  // expression effect, the statement list itself.
  constructor(owner, body, params, checkOnly = false) {
    this.owner = owner;
    this.body = body;
    this.params = params;
    this.checkOnly = checkOnly;
    this.reactive = EMPTY_MAP;
    this.computed = EMPTY_MAP;
    this.handles = EMPTY_MAP;
    this.readonly = EMPTY_MAP;
    this.errReactive = null;
    this.errHandle = null;
    this.errReadonly = null;
    this.forms = [];
    this.typed = null;
    this.bareIt = false;
    this.implicitIt = false;
    this.itAssigned = false;
    this.itUpdated = false;
    this.decls = null;
    this.rejection = null;
    this.itErr = null;
    // The statement-level facts, gathered as the walk meets each live
    // statement: def/class declarations, class-valued bindings,
    // exported plain consts, import specifiers, and (for a scope with
    // no owner node, which its statements identify) the statement ids.
    this.declared = null;
    this.classes = EMPTY_MAP;
    this.exportedConst = EMPTY_MAP;
    this.importSpecs = EMPTY_MAP;
    this.stmtIds = owner === null ? [] : null;
    // The hoist: set by `hoisting` when the emitter hoists this scope.
    this.hoists = false;
    this.frameless = false;
  }

  // This scope hoists. `list` is the statement list the emitter's hoist
  // reads (null for the program), `raw` the list its declare-in-place
  // scan reads, `live` whether that scan skips the list's erased
  // statements, `env` the enclosing environment.
  hoisting(list, raw, live, env, { declareInPlace = true, tailExpr = true } = {}) {
    this.hoists = true;
    this.sub = false;
    this.subRoot = false;
    this.capKey = null;
    this.hbody = null;
    this.hlist0 = list;
    this.raw0 = raw;
    this.live = live;
    this.env = env;
    this.declareInPlace = declareInPlace;
    this.tailExpr = tailExpr;
    hoistRecords(this);
    this.paramErr = null;
    // Settled after the walk.
    this.entries = null;
    this.names = null;
    this.plans = null;
    this.captures = null;
    return this;
  }

  // Does the scope push a reactive frame (every scope with a frame, not
  // a hoist-only or check-only one)?
  framed() {
    return !this.frameless && !this.checkOnly;
  }

  // A def or class this scope's statements declare.
  declares(name) {
    if (this.declared === null) return false;
    for (const [n] of this.declared) if (n === name) return true;
    return false;
  }

  // The statement list the scope's hoist reads (null for the program)
  // and the one its declare-in-place scan reads: a function-like body's
  // statements, its erased ones filtered when the scan reads it live.
  get hlist() {
    if (this.hbody === null) return this.hlist0;
    if (this.hlist0 === null) {
      const b = this.hbody;
      const list = isNode(b) && b[0] === 'block' ? b.slice(2) : [b];
      this.hlist0 = this.live ? list.filter((s) => !isErased(s)) : list;
    }
    return this.hlist0;
  }

  get raw() {
    return this.hbody === null ? this.raw0 : this.hlist;
  }

  // The first declaration of a name is its declaring node, kept by id.
  record(set, name, id) {
    if (this[set] === EMPTY_MAP) this[set] = new Map();
    if (!this[set].has(name)) this[set].set(name, id);
  }
}

// One component member initializer's share of the `_init` hoist: the
// walk records into it as it records into a hoisting scope.
class HoistSlot {
  constructor(scope, value, state) {
    this.scope = scope;
    this.value = value;
    this.state = state;
    this.live = false;
    this.itUpdated = false;
    hoistRecords(this);
  }
}

// What the hoist walk records into a hoisting scope or a slot: its
// targets (name → first writing node), the reactive names it must not
// hoist, a match write, the TS face's annotations and typed forwards,
// the loop-head and catch names in force, its temp sites, and its first
// rejection.
function hoistRecords(o) {
  o.targets = new Map();
  o.hreactive = new Set();
  o.matchWrite = false;
  o.ann = null;
  o.fwd = null;
  o.topForwards = null;
  o.forwards = null;
  o.heads = null;
  o.chains = [];
  o.planSites = [];
  o.hoistErr = null;
}

class Analysis {
  constructor(stores, { source, face, ambient, repl, dataLine, reserved }) {
    this.stores = stores;
    this.source = source;
    this.face = face;
    this.repl = repl;
    this.dataLine = dataLine;
    this.reserved = reserved;
    // The lexical environment the walk is in, innermost frame first:
    // { scope } a scope that hoists (its settled names and frame),
    // { block } a loop's or a handler's binding names, { members } a
    // component's member names, { ambient } the REPL's seed.
    this.ambientFrame = ambient.length === 0 ? null : { ambient: new Set(ambient.map(({ name }) => name)), next: null };
    this.env = null;
    this.hs = null;          // the scope whose hoist the walk is in
    this.ps = null;          // the scope whose reference plans it is in
    this.extra = null;       // the planner's construct-local names
    this.curTop = null;      // the statement of `hs` being walked
    this.hscopes = [];       // every scope that hoists, in walk order
    this.fieldScopes = [];   // every class field value the planner reads
    this.hoistAt = new Map(); // a value walked by another scope's hoist
    // Node id → predicate bits.
    this.preds = new Uint8Array(stores.nodes.length + 1);
    this.predsFar = null;
    this.inSub = false;      // walking a schema callable body
    this.quiet = false;      // walking a program statement its hoist line skips
    this.words = new Map();
    this.importBound = [];
    this.shadow = new Map();
    this.trig = { schema: false, modelSchema: false, reactive: false, component: false, objectComprehension: false, matchRead: false };
    this.trees = [];         // [{ names: Set, atoms }] in delivery order
    this.tree = null;        // the tree being walked
    this.scopes = [];
    this.program = null;
    this.rabErr = null;
    this.schemaErr = null;
    this.itScope = null;
    // The function that takes parameters whose bare `it` reads the walk
    // is checking (null outside one, and inside a parameterless function).
    this.itFence = null;
    this.itFences = [];
    this.itQuiet = false;      // walking a catch name, which binds `it`
    this.preempted = 0;        // inside a component line the emitter rejects first
    this.pointErrs = [];       // rejections between two scopes' checks
    this.siteTrees = new Map();
    this.renderPos = new Map();
    this.caseBlocks = new Map();  // a switch case body block → the switch's block unit
    this.loopSource = null;       // the binding frame of the loop whose source the walk is in
    this.rsink = null;       // the render factory the walk is inside: its sink and the env it opened at
    this.methodFuncs = new Set();
    this.rawStmts = null;      // the program's statements, erased ones included
    this.schemaConsts = null;  // TS face: module consts a schema declares
    this.modBound = null;      // moduleBound's memo
    // The execution-order walk's state (captureAll).
    this.interest = null;    // name → the declare-in-place records watching it
    this.capAt = null;       // a scope body → its record
    this.cdepth = 0;         // function-like constructs above the walk
    this.defAt = null;       // the depths at which a def opened
    this.annotates = false;  // annotations reach the scan (not in a schema body)
  }

  kindOf(x) {
    const id = this.stores.idOf(x);
    return id === null ? null : (this.stores.node(id)?.semanticKind ?? null);
  }

  idOf(x) {
    return Array.isArray(x) ? this.stores.idOf(x) : null;
  }

  // An error at the first of the nodes that has a span (the emitter's
  // positionedError).
  positioned(message, ...nodes) {
    const err = new Error(message);
    for (const n of nodes) {
      const id = this.idOf(n);
      const span = id !== null ? this.stores.selfSpan(id) : null;
      if (span) {
        err.start = span[0];
        err.end = span[1];
        break;
      }
    }
    return err;
  }

  nodeLine(node) {
    const id = this.idOf(node);
    const span = id !== null ? this.stores.selfSpan(id) : null;
    if (!span || typeof this.source !== 'string') return null;
    let line = 1;
    for (let i = 0; i < span[0] && i < this.source.length; i++) {
      if (this.source[i] === '\n') line++;
    }
    return line;
  }

  // ── declaration predicates (the NodeStore kind decides) ────────────
  isReactiveDecl(x) {
    const h = x[0];
    if (h !== 'state' && h !== 'computed') return false;
    const k = this.kindOf(x);
    return k === 'state' || k === 'computed';
  }
  isEffectDecl(x) { return x[0] === 'effect' && this.kindOf(x) === 'effect'; }
  isReadonlyDecl(x) { return x[0] === 'readonly' && this.kindOf(x) === 'readonly'; }
  isGateDecl(x) { return x[0] === 'gate' && this.kindOf(x) === 'gate'; }
  isModuleImport(x) { return x[0] === 'import' && this.kindOf(x) === 'import'; }
  isComponentDecl(x) { return x[0] === 'component' && this.kindOf(x) === 'component'; }

  // ── binding names ──────────────────────────────────────────────────

  // The names a pattern binds (the emitter's patternNames), rejecting a
  // target that cannot bind. `at` is the nearest enclosing pattern node.
  patternNames(p, out = [], binding = false, at = null) {
    if (!isStruct(p)) {
      const w = wordOf(p);
      if (w !== undefined && !isNone(p)) {
        if (PATTERN_LITERALS.has(w)) {
          throw this.positioned(`emitter: \`${w}\` cannot be a destructuring target — a value word lowers to its literal before scope exists, so the binding would be unreachable`, at);
        }
        if (at !== null) this.rejectNonTarget(p, at);
        out.push(w);
      }
      return out;
    }
    if (isNode(p) && CALL_KINDS.has(this.kindOf(p))) {
      throw this.positioned("emitter: a call cannot be a destructuring target — a pattern element writes a name or a member, and a call's result is neither", p);
    }
    // A plumbing list where a pattern stands binds nothing.
    if (!isNode(p)) return out;
    const h = headOf(p);
    if (at !== null) this.rejectNonTarget(p, at);
    if (h === 'array') {
      for (let i = 2; i < p.length; i++) if (!isNone(p[i])) this.patternNames(p[i], out, binding, p);
    } else if (h === 'object') {
      for (let i = 2; i < p.length; i++) {
        const pair = p[i];
        if (!isStruct(pair)) continue;
        const ph = headOf(pair);
        if (ph === ':') this.patternNames(pair[3], out, binding, p);
        else if (ph === null || ph === '=' || ph === '...') this.patternNames(pair[2], out, binding, p);
      }
    } else if (h === 'rest') {
      if (!binding) throw this.positioned("emitter: Cannot use 'rest' expression as a destructuring target (destructuring rest is spelled '...name')", p);
      this.patternNames(p[2], out, binding, p);
    } else if (h === '...' || h === 'default' || h === '=' || h === 'cast' || h === 'satisfies' || h === 'typed-var') {
      this.patternNames(p[2], out, binding, p);
    }
    return out;
  }

  // The emitter's rejectNonTarget: a pattern element writes a name or a
  // member. A leaf positions at the enclosing pattern, as every
  // rejection does.
  rejectNonTarget(p, at) {
    const reject = (what, why = 'a pattern element writes a name or a member, and this is neither') => {
      const message = `emitter: ${what} cannot be a destructuring target — ${why}`;
      throw isStruct(p) ? this.positioned(message, p, at) : this.positioned(message, at);
    };
    const w = wordOf(p);
    if (w !== undefined) {
      if (!isIdentifierName(w)) reject(`the literal \`${w}\``);
      return;
    }
    const h = headOf(p);
    if (PATTERN_HEADS.has(h)) return;
    if (!SPINE_HEADS.has(h)) reject(`a '${h}' expression`);
    for (let link = p; isNode(link) && SPINE_HEADS.has(link[0]); link = link[2]) {
      if (link[0] === '?.' || link[0] === 'optindex') reject('an optional chain', "JavaScript has no write through '?.'");
    }
    const key = p[3];
    if (h === '[]' && ((isNode(key) && (key[0] === '..' || key[0] === '...') && key.length === 4) || wordOf(key)?.[0] === '/')) {
      reject('a range or regex index', "its read lowers to a call, and a call's result is not assignable");
    }
  }

  // ── trees ──────────────────────────────────────────────────────────

  run(sexpr) {
    const stmts = sexpr.slice(2);
    const live = stmts.filter((s) => !isErased(s));
    const program = new Scope(null, live, []);
    // The __DATA__ marker declares DATA ahead of every statement.
    if (this.dataLine !== null) program.forms.push({ name: 'DATA', kind: 'the __DATA__ section', node: null, line: this.dataLine, auth: true });
    // A name the build reserves at module scope: no declaring form or
    // write there may claim it.
    for (const { name, kind } of this.reserved) program.forms.push({ name, kind, node: null, auth: true, reserved: true });
    // The program hoists its live statements; the scan for declare-in-
    // place reads them all.
    program.hoisting(null, stmts, false, this.ambientFrame, { tailExpr: this.repl });
    program.hparams = [];
    this.scopes.push(program);
    this.hscopes.push(program);
    this.program = program;
    this.rawStmts = stmts;
    this.hs = program;
    this.ps = program;
    this.env = { scope: program, next: program.env };
    this.beginTree([]);
    for (const s of stmts) {
      const isLive = !isErased(s);
      if (isLive) this.noteStmt(program, s);
      this.curTop = s;
      this.noteForwardAnnotation(program, s);
      // An erased statement joins the walk that names the program's
      // bindings, never its emitted hoist line, whose bare typed
      // forwards annotate it apart.
      if (!isLive && this.face === 'ts' && s[0] === 'typed-var') {
        this.noteForward(s);
        if (wordOf(s[2]) !== undefined) this.hoistAnnotation(wordOf(s[2]), s, true);
      }
      this.quiet = !isLive;
      this.visit(s, USED | RN_EXPR | HOIST | PLAN, isLive ? program : null, isLive ? program : null);
      this.quiet = false;
    }
    this.endScope(program);
    this.endTree();
    this.settle();
  }

  beginTree(atoms) {
    const tree = { names: new Set(), atoms, outer: this.tree, shadow: this.shadow, itScope: this.itScope, itFence: this.itFence };
    this.trees.push(tree);
    this.tree = tree;
    this.shadow = new Map();
    this.itScope = null;
    this.itFence = null;
    for (const atom of atoms) this.flag(atom, W_ATOM);
  }

  endTree() {
    const tree = this.tree;
    this.tree = tree.outer;
    this.shadow = tree.shadow;
    this.itScope = tree.itScope;
    this.itFence = tree.itFence;
  }

  // ── words ──────────────────────────────────────────────────────────
  flag(w, bits) {
    const f = this.words.get(w);
    if (f === undefined) this.words.set(w, bits);
    else if ((f | bits) !== f) this.words.set(w, f | bits);
  }

  visitWord(w, m) {
    const rn = m & RN;
    let bits = W_ATOM | ((m & USED) ? W_USED : 0);
    if ((rn === RN_EXPR || (rn === RN_RENDER && !isTagWord(w))) && (this.shadow.size === 0 || !this.shadow.has(w))) bits |= W_FREE;
    this.flag(w, bits);
    if (w === 'it' && this.itScope !== null && !(m & NOIT)) this.itScope.bareIt = true;
  }

  // A bare `it` read inside a function that takes parameters: the first
  // one no loop, comprehension, counted loop or catch name inside the
  // function binds is checked against the scopes once they settle.
  fenceIt(x, m) {
    const fence = this.itFence;
    const hits = fence.render === true ? fence.hits : null;
    if ((m & NOIT) || this.itQuiet || (fence.hit !== null && hits === null)) return;
    for (let e = this.env; e !== null && e !== fence.env && e.scope !== fence.scope; e = e.next) {
      if (e.block !== undefined && e !== this.loopSource && e.block.has('it')) return;
    }
    if (hits !== null) hits.push(x, this.rsink?.sink ?? null);
    if (fence.hit !== null) return;
    fence.hit = x;
    fence.hitParam = fence.inParams;
  }

  // Walk a parameter list, its bare `it` reads marked as the parameters'
  // for the function's fence.
  visitFenceParams(params, m) {
    const fence = this.itFence;
    if (fence !== null) fence.inParams = true;
    this.visitParams(params, m);
    if (fence !== null) fence.inParams = false;
  }

  free(w) {
    if (!this.shadow.has(w)) this.flag(w, W_FREE);
  }

  // The alias-binding walk's pattern names, recorded in the current
  // tree; a rejection is kept as the walk's first.
  rabPattern(p, m) {
    if (m & NORAB) return;
    const w = wordOf(p);
    if (w !== undefined && !PATTERN_LITERALS.has(w)) {
      if (!isNone(p)) this.tree.names.add(w);
      return;
    }
    try {
      for (const n of this.patternNames(p, [], true)) this.tree.names.add(n);
    } catch (err) {
      const tree = this.trees.indexOf(this.tree);
      if (this.rabErr === null || this.rabErr.tree > tree) this.rabErr = { tree, err };
    }
  }

  rabName(w, m) {
    if (!(m & NORAB) && typeof w === 'string') this.tree.names.add(w);
  }

  // ── the walk ───────────────────────────────────────────────────────
  // m: the mode word; cs: the frame collectors' scope (null outside
  // one); rs: the redeclaration walk's scope.
  visit(x, m, cs, rs) {
    if (x == null || typeof x !== 'object') {
      if (typeof x === 'string') this.visitWord(x, m);
      return;
    }
    if (!Array.isArray(x)) return;
    if (!isNode(x)) return this.visitList(x, m, cs, rs);
    if (this.renderPos.size !== 0) {
      const sink = this.renderPos.get(x);
      if (sink !== undefined) {
        this.renderChild(x, sink);
        // Below a render child its factory's locals and loop variables
        // are in scope, between the scopes inside the child and the env
        // the child stands in: a handler that writes one writes the
        // factory's binding.
        const saved = this.rsink;
        const env = this.env;
        this.rsink = { sink, env };
        this.env = { block: sink.bound, next: env };
        this.visit(x, m, cs, rs);
        this.env = env;
        this.rsink = saved;
        return;
      }
    }
    if (this.hoistAt.size !== 0) {
      const slot = this.hoistAt.get(x);
      if (slot !== undefined) {
        this.hoistAt.delete(x);
        const curTop = this.curTop;
        const saved = this.enterHoist(slot.scope);
        this.hs = slot;
        this.ps = slot;
        this.curTop = curTop;
        this.visit(x, m | HOIST | PLAN, cs, rs);
        this.leaveHoist(saved);
        return;
      }
    }
    const h = x[0];
    if (x.length === 3 && LEAF_KINDS.has(h)) {
      if (this.itFence !== null && x[2] === 'it' && h !== 'this') this.fenceIt(x, m);
      return this.visitWord(h === 'this' ? 'this' : x[2], m);
    }
    if (h === 'type' && x.length === 4 && typeof x[2] === 'string') return this.visitWord(x[2], m);
    if (h === 'none' || isSymbol(x)) return;
    switch (h) {
      case 'block': return this.visitBlock(x, m, cs, rs);
      case 'default': case 'rest': case 'expansion': return this.visitPatternPart(x, m, cs, rs);
      case 'import': if (this.isModuleImport(x)) return this.visitImport(x, m, rs); break;
      case 'def': return this.visitDef(x, m, rs, false);
      case 'def-sig': return this.visitDefSig(x, m, cs, rs);
      case 'class': return this.visitClass(x, m, rs, x[2], x[3], x[4]);
      case 'component': if (this.isComponentDecl(x)) return this.visitComponent(x, m); break;
      case 'state': case 'computed': if (this.isReactiveDecl(x)) return this.visitReactive(x, m, cs, rs); break;
      case 'effect': if (this.isEffectDecl(x)) return this.visitEffect(x, m, cs, rs, false); break;
      case 'readonly': if (this.isReadonlyDecl(x)) return this.visitReadonly(x, m, cs, rs); break;
      case 'gate': if (this.isGateDecl(x)) return this.visitGate(x, m, cs, rs); break;
      case ':': return this.visitPair(x, m, cs, rs);
      case 'loop': return this.visitLoop(x, m, cs, rs);
      case 'comprehension': return this.visitComprehension(x, m, cs, rs);
      case 'try': return this.visitTry(x, m, cs, rs);
      case 'export': return this.visitExport(x, m, cs, rs);
      case 'export-from': case 'export-all': case 'export-default': return this.visitExportOther(x, m, cs, rs);
      case 'typed-var': return this.visitTypedVar(x, m, cs, rs);
      case 'cast': case 'satisfies': if (this.kindOf(x) === h || this.idOf(x) === null) return this.visitPostfixType(x, m, cs, rs); break;
      case 'call': return this.visitCall(x, m, cs, rs);
      case 'children': return this.visitChildren(x, m, RN_EXPR);
      case 'schema': if (this.kindOf(x) === 'schema') return this.visitSchema(x, m); break;
      case 'do-iife': return this.visitDoIife(x, m, cs, rs);
      case 'render': if (this.kindOf(x) === 'render') return this.visitRender(x, m, cs, rs); break;
      case '.': case '?.': if (x.length === 4) return this.visitAccess(x, m, cs, rs); break;
      case 'object': return this.visitObject(x, m, cs, rs);
      case 'array': return this.visitArray(x, m, cs, rs);
      case 'str': return this.visitStr(x, m, cs, rs, 2);
      case 'here-regex': return this.visitStr(x, m, cs, rs, 3);
      case 'if': if ((m & RN) === RN_RENDER) return this.visitRenderIf(x, m, cs, rs); break;
      case 'switch': return this.visitSwitch(x, m, cs, rs);
      case 'type-decl': return this.visitTypeDecl(x, m);
      case 'pickitem': return this.visitPickItem(x, m, cs, rs);
      case '...': if (x.length !== 4) return this.visitPatternPart(x, m, cs, rs); break;
      case '=': return this.visitAssign(x, headOf(x), m, cs, rs);
    }
    if (ASSIGNS.has(h)) return this.visitAssign(x, h, m, cs, rs);
    if (FUNC_HEADS.has(h)) return this.visitFunc(x, m, cs, rs, null);
    return this.generic(x, h, m, cs, rs);
  }

  // Per-node checks every consumer makes at any structure: the
  // structural runtime triggers and the program hoist's match writes.
  noteNode(x, hv, m) {
    if (m & HOIST) this.noteChain(x, hv);
    // An update writes its bare name without hoisting it: an implicit
    // `it` it updates is the function's declared binding.
    if ((hv === '++' || hv === '--') && (m & HOIST) && x.length === 3 && wordOf(x[2]) === 'it') this.hs.itUpdated = true;
    if ((hv === '//=' || hv === '%%=') && (m & PLAN)) this.planSite(x, hv, m);
    if (isMatchWrite(x)) this.matchWrite(x, m);
  }

  matchWrite(x, m) {
    this.trig.matchRead = true;
    if (m & (HOIST | HMATCH)) {
      this.hoistAdd('_', x);
      this.hs.matchWrite = true;
    }
  }

  // Run fn with `names` bound as loop-head or catch names for the hoist
  // (under HOIST) and the redeclaration walk: writes to them inside the
  // loop or handler assign those bindings.
  withHeads(names, m, rs, fn) {
    const maps = [];
    if (names.length !== 0) {
      if (m & HOIST) maps.push(this.hs.heads ??= new Map());
      if (rs !== null) maps.push(rs.heads ??= new Map());
    }
    for (const h of maps) for (const n of names) h.set(n, (h.get(n) ?? 0) + 1);
    fn();
    for (const h of maps) {
      for (const n of names) {
        const k = h.get(n) - 1;
        if (k === 0) h.delete(n);
        else h.set(n, k);
      }
    }
  }

  // A write to a loop-head or simple catch name inside its loop or
  // handler assigns that binding, never one of the hoisting scope.
  headWrite(tw) {
    const c = this.hs.heads;
    return c !== null && tw !== undefined && c.has(tw);
  }

  hoistAdd(name, node) {
    const t = this.hs.targets;
    if (!t.has(name)) t.set(name, node);
  }

  // A pattern's names for the hoist (binding positions read as writes,
  // so a rest element rejects).
  hoistPattern(p, node, heads = null) {
    try {
      for (const n of this.patternNames(p)) if (heads === null || !heads.has(n)) this.hoistAdd(n, node);
    } catch (err) {
      if (this.hs.hoistErr === null) this.hs.hoistErr = err;
    }
  }

  // The TS face's hoist-line annotation for a name: the first annotated
  // assignment or bare typed forward the hoist walk meets. A hoist that
  // reads its live statements (the program's, a method's) never meets
  // its own top-level forwards: they annotate only the names its walk
  // left bare. A def's, a function's, an effect's and a computed's hoist
  // reads its raw statements, forwards in walk order.
  hoistAnnotation(name, node, forward) {
    if (this.quiet) return;
    const s = this.hs;
    if (forward && node === this.curTop) {
      if (s.fwd === null) s.fwd = new Map();
      if (!s.fwd.has(name)) s.fwd.set(name, node);
      if (s === this.program || s.live) return;
    }
    if ((s.ann !== null && s.ann.has(name)) || !this.annotated(node)) return;
    if (s.ann === null) s.ann = new Map();
    if (!s.ann.has(name)) s.ann.set(name, node);
  }

  // A bare typed forward the hoist meets (TS face): the directives above
  // it manifest on the scope's hoist line. The emitter takes a scope's
  // statement-level forwards as it filters the statements, before its
  // hoist walk meets the nested ones.
  noteForward(x) {
    if (this.quiet) return;
    const s = this.hs;
    if (x === this.curTop) (s.topForwards ??= []).push(x);
    else (s.forwards ??= []).push(x);
  }

  annotated(node, role = 'annotation') {
    const id = this.idOf(node);
    const row = id === null ? null : this.stores.role(id, role);
    return row != null && row.sourceStart != null && this.source !== null;
  }

  // A chained comparison's link: the mid operand a structure, so the
  // emitter caches it in a temp the scope's hoist declares.
  noteChain(x, hv) {
    if (this.quiet || !COMPARISONS.has(hv) || x.length !== 4) return;
    const left = x[2];
    if (!isNode(left) || !COMPARISONS.has(left[0]) || left.length !== 4 || left.parenthesized) return;
    if (isStruct(left[3])) this.hs.chains.push(left[3]);
  }

  // An assignment that re-reads parts of its target (an optional link,
  // a synthesized compound): a site the planner decides once the
  // scope's names are known.
  planSite(x, h, m) {
    if (!(m & PLAN) || this.quiet || x.length !== 4) return;
    const synth = h === '//=' || h === '%%=';
    const target = x[2];
    const optLink = optionalGuard(target);
    if (optLink === null && !synth) return;
    if (optLink === null && !(isNode(target) && (target[0] === '.' || target[0] === '[]') && target.length === 4)) return;
    this.ps.planSites.push({ node: x, synth, optLink, extra: this.extra });
  }

  generic(x, hv, m, cs, rs) {
    this.noteNode(x, hv, m);
    // An update writes its name and declares nothing: the block rule and
    // the write-before-declaration rule read it. One in a class field's
    // value runs at construction, after the scope's declarations.
    if (rs !== null && (hv === '++' || hv === '--') && x.length === 3) {
      const w = wordOf(x[2]);
      if (w !== undefined && !(rs.heads?.has(w) ?? false) && !(rs.fieldDepth > 0)) rs.forms.push({ name: w, kind: 'update', node: x, auth: false, update: true });
    }
    const c = childMode(m, hv);
    for (let i = 2; i < x.length; i++) this.visit(x[i], c, cs, rs);
  }

  // A block: in a render statement its statements are render; to the
  // redeclaration walk they are one block unit (or a switch's shared
  // one); otherwise the generic rule.
  visitBlock(x, m, cs, rs) {
    if ((m & RN) !== RN_RENDER) {
      if (rs === null) return this.generic(x, 'block', m, cs, rs);
      this.noteNode(x, 'block', m);
      const c = childMode(m, 'block');
      const shared = this.caseBlocks.get(x);
      const unit = shared ?? this.blockUnit(rs);
      for (let i = 2; i < x.length; i++) {
        this.noteForwardAnnotation(rs, x[i]);
        this.unitStmt(unit, x[i], c, cs, rs);
      }
      if (shared === undefined) this.endBlockUnit(unit, rs);
      return;
    }
    const c = childMode(m, 'block');
    const r = (c & ~RN) | RN_RENDER;
    for (let i = 2; i < x.length; i++) this.visit(x[i], r, cs, rs);
  }

  // default, rest, splat, expansion: in a binding pattern the first
  // child binds and a default's value is an expression; elsewhere the
  // generic rule.
  visitPatternPart(x, m, cs, rs) {
    const h = x[0];
    const arity = h === 'default' ? 4 : 3;
    if ((m & RN) !== RN_PAT || x.length !== arity) return this.generic(x, h, m, cs, rs);
    const c = childMode(m, h);
    this.visit(x[2], (c & ~RN) | RN_PAT, cs, rs);
    if (h === 'default') this.visit(x[3], c, cs, rs);
  }

  visitList(x, m, cs, rs) {
    const c = childMode(m, null);
    for (const el of x) this.visit(el, c, cs, rs);
  }

  // ── imports ────────────────────────────────────────────────────────
  visitImport(x, m, rs) {
    const names = importedNames([x]);
    if (m & USED) {
      const id = this.idOf(x);
      if (id === null || this.stores.role(id, 'typeOnly') === null) for (const n of names) this.importBound.push(n);
    }
    if (!(m & NORAB)) for (const n of names) this.tree.names.add(n);
    if (rs !== null) for (const n of names) this.auth(rs, n, 'import', x);
    // The emitter's import spells only its words: the specifiers, `{}`
    // for an empty list, the attributes and the source.
    const quiet = (m & ~(RN | USED | HOIST | HMATCH)) | NORAB;
    if (Array.isArray(x[2]) && x[2].length === 0) this.visitWord('{}', quiet);
    else if (!isNone(x[2])) this.visit(x[2], quiet, null, null);
    if (!isNone(x[3])) this.visit(x[3], quiet, null, null);
    if (!isNone(x[4])) this.visit(x[4], quiet, null, null);
    this.visit(x[5], quiet, null, null);
  }

  // ── functions ──────────────────────────────────────────────────────
  // The names a parameter list binds (the free-reference walk's
  // shadowing set). walks.js has its own reader for referencesNames:
  // this one also reads a shorthand pair and an expansion, skips the
  // absent marker, and records an elided array slot as ','.
  paramBindings(params, out) {
    const bind = (p) => {
      const w = wordOf(p);
      if (w !== undefined) { if (!isNone(p)) out.add(w); return; }
      if (!isNode(p)) return;
      const h = headOf(p);
      if (h === 'object' || h === 'array') {
        for (let i = 2; i < p.length; i++) if (!isNone(p[i])) bind(p[i]); else out.add(',');
      } else if ((h === null || h === ':') && p.length === 4) bind(p[3]);
      else if (h === '=' && p.length === 4) bind(p[2]);
      else if (h === 'default' && p.length === 4) bind(p[2]);
      else if ((h === 'rest' || h === '...' || h === 'expansion') && p.length === 3) bind(p[2]);
      else if (h === 'typed-var') bind(p[2]);
    };
    if (Array.isArray(params)) for (const p of params) bind(p);
    return out;
  }

  pushShadow(names) {
    for (const n of names) this.shadow.set(n, (this.shadow.get(n) ?? 0) + 1);
  }

  popShadow(names) {
    for (const n of names) {
      const k = this.shadow.get(n) - 1;
      if (k === 0) this.shadow.delete(n);
      else this.shadow.set(n, k);
    }
  }

  // A function's parameter list: binding patterns for the free-
  // reference walk, outside every scope walk. The alias-binding walk
  // reads a parameter's pattern names (a promoted `@name`'s bare name)
  // and walks into its default values and computed keys.
  visitParams(params, m) {
    const pm = atRn(m & ~(HOIST | HMATCH | PLAN | CNEST | RNEST), RN_PAT);
    let err = null;
    for (const p of params) {
      const promoted = promotedName(p);
      if (promoted !== undefined) this.rabName(promoted, m);
      else {
        this.rabPattern(p, m);
        if (err === null) err = this.memberTargetErr(p, MEMBER_IN_PARAMETER);
      }
      this.visit(p, pm, null, null);
    }
    // The emitter checks a parameter list as it emits it: after the
    // scopes opened before it, before the scopes its defaults open.
    if (err !== null && this.preempted === 0) this.pointErrs.push({ at: this.scopes.length, err });
  }

  // The rejection a member a binding holds earns, at the member: a
  // promoted `@name` in a parameter in its own vocabulary, any other in
  // `message`'s; null when the binding holds none.
  memberTargetErr(p, message) {
    const hit = memberInPattern(p);
    if (hit === null) return null;
    const promoted = hit[0] === '.' && hit.length === 4 && wordOf(hit[2]) === 'this' && wordOf(hit[3]) !== undefined;
    return this.positioned(promoted && message === MEMBER_IN_PARAMETER ? PROMOTED_IN_PATTERN(wordOf(hit[3])) : message, hit, p);
  }

  // A def, a method, and a function that takes parameters check their
  // bare `it` reads: the fence, open over the parameters and body (null
  // for a parameterless function value, whose `it` is its own).
  openItFence(x, params, implicit) {
    const saved = [this.itFence, this.itScope];
    const fence = (params.length > 0 || !implicit) && this.preempted === 0
      ? { fn: x, params, scope: null, env: this.env, sub: this.inSub, rsink: this.rsink, hit: null, inParams: false, hitParam: false } : null;
    this.itFence = fence;
    if (fence !== null) this.itScope = null;
    return saved;
  }

  // An effect's, a computed's or a render's body binds no implicit `it`
  // and checks its own reads: its fence, which no enclosing scan reads
  // through. `scope` is the body's scope (null for a body emitted inline,
  // whose rejection lands between the scopes around it); `root` anchors
  // an `it` with no node of its own above it. A render's fence keeps
  // every read with its render sink.
  openBodyFence(stmts, scope, root, render = false) {
    const saved = [this.itFence, this.itScope];
    this.itFence = this.preempted === 0
      ? { fn: null, stmts, params: EMPTY_ARRAY, scope, root, env: this.env, sub: this.inSub, rsink: this.rsink, hit: null, inParams: false, hitParam: false, at: this.scopes.length, render, hits: render ? [] : null }
      : null;
    this.itScope = null;
    return saved;
  }

  closeBodyFence(saved) {
    const fence = this.itFence;
    if (fence !== null && fence.hit !== null) this.itFences.push(fence);
    [this.itFence, this.itScope] = saved;
  }

  closeItFence(saved) {
    const fence = this.itFence;
    if (fence !== null && fence !== saved[0] && fence.hit !== null && fence.scope !== null) this.itFences.push(fence);
    [this.itFence, this.itScope] = saved;
  }

  // `->` / `=>`. A method (`as` 'method', or a function its class or
  // component body registered in methodFuncs) is emitted by the
  // emitter's methodBlock: parameters first, then its body's scope, and
  // no implicit `it`. Any other function is emitted by emitFunc, which
  // checks its body's scope before it emits its parameters, so its
  // scope opens before the scopes inside its parameter defaults.
  visitFunc(x, m, cs, rs, as) {
    const params = x[2];
    const body = x[3];
    const method = as === 'method' || this.methodFuncs.has(x);
    const saved = this.openItFence(x, params, !method);
    if (method) this.visitFenceParams(params, m);
    const outer = this.env;
    const scope = this.openScope(x, body, params, false);
    scope.implicitIt = !method && params.length === 0;
    this.hoistBody(scope, body, params, method, {});
    if (this.itFence !== null) this.itFence.scope = scope;
    // emitFunc emits the parameters inside the function's own scope.
    if (!method) {
      if (scope.hoists) this.env = { scope, next: outer };
      this.visitFenceParams(params, m);
      this.env = outer;
    }
    this.visitBody(body, m, scope, params, 'func');
    this.closeItFence(saved);
  }

  // An element's children block: inlined into its render, so no scope,
  // and no implicit `it` of its own.
  visitChildren(x, m, bodyRn) {
    this.visitBody(x[2], m, null, EMPTY_ARRAY, 'func', bodyRn);
  }

  // A scope over a function-like body: its hoist reads the body's
  // statements, live (erased statements filtered) or raw.
  hoistBody(scope, body, params, live, opts) {
    scope.hoisting(null, null, live, this.env, opts);
    scope.hbody = body;
    scope.hparams = params;
    scope.capKey = body;
    this.addHoist(scope);
  }

  // A function-like body: the free-reference walk under the parameters'
  // shadow, the scope walks over its live statements. `fence` says
  // what the bare-`it` scan does here: 'func' (a function: the scan
  // belongs to this scope when it may gain `it`), 'def' (a def: no
  // scan), or null (a block scope the scan passes through).
  visitBody(body, m, scope, params, fence = null, bodyRn = RN_EXPR) {
    const shadowed = params.length === 0 ? EMPTY_SET : this.paramBindings(params, new Set());
    this.pushShadow(shadowed);
    const outerIt = this.itScope;
    if (fence === 'func') this.itScope = scope !== null && scope.implicitIt ? scope : null;
    else if (fence === 'def') this.itScope = null;
    const bm = atRn(m & ~(HOIST | HMATCH | PLAN | CNEST | RNEST), bodyRn);
    if (scope !== null && scope.hoists) {
      const saved = this.enterHoist(scope);
      this.visitBlockBody(body, bm | HOIST | PLAN, scope);
      this.leaveHoist(saved);
    } else this.visitBlockBody(body, bm, scope);
    this.itScope = outerIt;
    this.popShadow(shadowed);
    if (scope !== null) this.endScope(scope);
  }

  // A scope whose hoist reads one statement, emitted in a function of
  // its own.
  hoistOne(scope, stmt) {
    scope.hoisting([stmt], [stmt], false, this.env);
    scope.hparams = [];
    scope.capKey = stmt;
    this.addHoist(scope);
  }

  addHoist(scope) {
    scope.sub = this.inSub;
    this.hscopes.push(scope);
  }

  // Walk `fn` as the body of the hoisting scope `scope`.
  inHoist(scope, fn) {
    const saved = this.enterHoist(scope);
    fn();
    this.leaveHoist(saved);
  }

  enterHoist(scope) {
    const saved = [this.hs, this.ps, this.env, this.extra, this.curTop];
    this.hs = scope;
    this.ps = scope;
    this.env = { scope, next: scope.env };
    this.extra = null;
    return saved;
  }

  leaveHoist(saved) {
    [this.hs, this.ps, this.env, this.extra, this.curTop] = saved;
  }

  visitBlockBody(body, m, scope) {
    if (isNode(body) && body[0] === 'block') {
      for (let i = 2; i < body.length; i++) {
        const s = body[i];
        const erased = isErased(s);
        const live = scope !== null && !erased;
        if (live) this.noteStmt(scope, s);
        this.curTop = s;
        this.noteForwardAnnotation(scope, s);
        this.visit(s, erased ? this.erasedMode(s, m, scope) : m, live ? scope : null, live ? scope : null);
      }
    } else {
      if (scope !== null) this.noteStmt(scope, body);
      this.curTop = body;
      this.visit(body, m, scope, scope);
    }
  }

  // An erased statement of a hoisting scope: a scope whose hoist reads
  // its live statements never walks it, but its bare typed forward
  // still annotates the scope's hoist line.
  erasedMode(s, m, scope) {
    if (!(m & HOIST) || scope === null || !scope.hoists || !scope.live) return m;
    if (this.face === 'ts' && s[0] === 'typed-var') {
      this.noteForward(s);
      const w = wordOf(s[2]);
      if (w !== undefined) this.hoistAnnotation(w, s, true);
    }
    return m & ~(HOIST | HMATCH | PLAN);
  }

  openScope(owner, body, params, checkOnly = false) {
    const scope = new Scope(owner, body, params, checkOnly);
    this.scopes.push(scope);
    return scope;
  }

  visitDef(x, m, rs, inClass) {
    const name = wordOf(x[2]);
    if (!inClass && name !== undefined) this.rabName(name, m);
    if (rs !== null && !(m & RNEST) && name !== undefined) this.auth(rs, name, 'def', x);
    this.visit(x[2], (m & ~(RN | HOIST | HMATCH | CNEST | RNEST)) | NORAB | NOIT, null, null);
    const saved = this.openItFence(x, x[3], false);
    this.visitFenceParams(x[3], m);
    // A def emits as its own scope: defStatement, whose hoist reads the
    // body's statements raw, or a class body's method form, emitted as
    // a method over its live statements.
    const scope = this.openScope(x, x[4], x[3], false);
    this.hoistBody(scope, x[4], x[3], inClass, {});
    if (this.itFence !== null) this.itFence.scope = scope;
    this.visitBody(x[4], m, scope, x[3], 'def');
    this.closeItFence(saved);
  }

  // An overload signature: erased, read generically by every walk but
  // the use walk, which sees its parameters alone.
  visitDefSig(x, m, cs, rs) {
    const c = childMode(m, 'def-sig');
    const noUse = c & ~USED;
    this.visit(x[2], noUse, cs, rs);
    this.visit(x[3], c, cs, rs);
    this.visit(x[4], noUse, cs, rs);
  }

  // ── classes and components ─────────────────────────────────────────
  // A class: `x` positions it; name, parent and body are its parts.
  visitClass(x, m, rs, nameSlot, parentSlot, bodySlot) {
    const name = isNone(nameSlot) ? null : nameSlot;
    const parent = isNone(parentSlot) ? null : parentSlot;
    const body = bodySlot === undefined || isNone(bodySlot) ? null : bodySlot;
    const nameWord = name === null ? undefined : wordOf(name);
    if (nameWord !== undefined) this.rabName(nameWord, m);
    if (rs !== null && !(m & RNEST) && nameWord !== undefined) this.auth(rs, nameWord, 'class', x);
    // The frame collectors never enter a class; the hoist and the
    // redeclaration walk read its parent and field values in the
    // enclosing scope, nested.
    const inner = atRn(m & ~CNEST, RN_EXPR) | RNEST;
    if (name !== null) this.visit(name, (m & ~(RN | HOIST | HMATCH | CNEST | RNEST)) | NORAB, null, null);
    if (parent !== null) {
      if (isNode(parent) && parent[0] === 'def') this.visitDef(parent, inner, rs, true);
      else this.visit(parent, inner, null, rs);
    }
    if (body === null) return;
    // The planner reads a class's parent alone: each field value plans
    // in its own evaluation (visitClassField).
    const bm = inner & ~PLAN;
    // A class the emitter rejects before it emits any member: no check
    // inside its body runs.
    const preempted = classRejectsFirst(body);
    if (preempted) this.preempted++;
    if (rs !== null) rs.fieldDepth = (rs.fieldDepth ?? 0) + 1;
    this.visitClassBody(body, bm, rs);
    if (rs !== null) rs.fieldDepth--;
    if (preempted) this.preempted--;
  }

  visitClassBody(body, bm, rs) {
    for (let i = 2; i < body.length; i++) {
      const s = body[i];
      if (isNode(s) && s[0] === 'def') { this.visitDef(s, bm & ~(HOIST | HMATCH), null, true); continue; }
      if (isNode(s) && ASSIGNS.has(headOf(s)) && s.length === 4) {
        this.visitClassField(s, bm, rs);
        continue;
      }
      if (isNode(s) && s[0] === 'typed-var' && s.length === 4) {
        // A typed field's name is a member, never a bare `it`.
        const quiet = this.itQuiet;
        this.itQuiet = true;
        this.visit(s, bm & ~(HOIST | HMATCH), null, null);
        this.itQuiet = quiet;
        continue;
      }
      this.visitClassMember(s, bm, rs);
    }
  }

  // A class member that is not a def, field or typed field: walked in
  // the enclosing scope by the redeclaration walk. The emitter's
  // classMember emits every function a member pair holds through
  // methodBlock — whatever the key (a name, `@static`, a string) and
  // either arrow — and so the `get`/`set` accessor's.
  visitClassMember(x, m, rs) {
    if (isNode(x)) {
      if (x[0] === 'object') for (let i = 2; i < x.length; i++) this.noteMethodPair(x[i]);
      else if (x[0] === ':') this.noteMethodPair(x);
      else if (x[0] === 'call' && x[1].opt !== true && x[1].await !== true && x.length === 4) {
        const w = wordOf(x[2]);
        if ((w === 'get' || w === 'set') && isNode(x[3]) && x[3][0] === 'object' && x[3].length === 3) this.noteMethodPair(x[3][2]);
      }
    }
    return this.visit(x, m, null, rs);
  }

  // A pair whose value the emitter emits as a method.
  noteMethodPair(pair) {
    if (isNode(pair) && pair[0] === ':' && pair[1].shorthand !== true && isFuncNode(pair[3])) this.methodFuncs.add(pair[3]);
  }

  // A member access: the free-reference walk reads only the object; a
  // render statement's tag chain is no reference at all.
  visitAccess(x, m, cs, rs) {
    const hv = x[0];
    const rn = m & RN;
    const c = childMode(m, hv);
    if (rn === RN_RENDER && hv === '.' && this.tagOf(x)) {
      this.visit(x[2], c & ~RN, cs, rs);
      this.visit(x[3], (c & ~RN) | NOIT, cs, rs);
      return;
    }
    this.visit(x[2], c, cs, rs);
    const prop = wordOf(x[3]);
    this.visit(x[3], (c & ~RN) | (prop !== undefined ? NOIT : 0), cs, rs);
  }

  // A class field `name = value`: the target is a member, never a scope
  // name; the value walks in the enclosing scope.
  visitClassField(x, m, rs) {
    const hv = headOf(x);
    const target = x[2];
    const tw = wordOf(target);
    if (tw !== undefined) this.rabName(tw, m);
    else if (isPattern(target)) this.rabPattern(target, m);
    const tm = atRn(m & ~(HOIST | HMATCH), RN_PAT);
    // The target names a member, never a bare `it`.
    const quiet = this.itQuiet;
    this.itQuiet = true;
    this.visit(target, tm, null, null);
    this.itQuiet = quiet;
    const vm = atRn(m, RN_EXPR);
    const staticKey = isNode(target) && target[0] === '.' && target.length === 4 && wordOf(target[2]) === 'this' && wordOf(target[3]) !== undefined;
    if (hv !== '=' || (tw === undefined && !staticKey)) return this.visit(x[3], vm, null, rs);
    // The emitter's classFieldValue plans the value's captures in an
    // arrow of its own, knowing no name of its own.
    const field = { value: x[3], planSites: [], env: this.env, sub: this.inSub, plans: null };
    this.fieldScopes.push(field);
    const { ps, extra } = this;
    this.ps = field;
    this.extra = null;
    this.visit(x[3], vm | PLAN, null, rs);
    this.ps = ps;
    this.extra = extra;
  }

  visitComponent(x, m) {
    this.trig.component = true;
    const parent = isNone(x[2]) ? null : x[2];
    const body = x[3];
    const c = atRn(m & ~(HOIST | HMATCH | PLAN | CNEST | RNEST), RN_EXPR);
    if (parent !== null) this.visit(parent, c, null, null);
    // Every member name binds for the whole lowering; the member
    // initializers hoist into `_init`, where the body's effects emit.
    const env = this.env;
    const { names, initValues, state } = this.componentMembers(body);
    // Under `extends`, `rest` is the component's view of the undeclared
    // caller props: a member no bare write declares over.
    if (parent !== null) names.add('rest');
    const members = { members: names, next: env };
    const init = new Scope(x, null, []);
    init.frameless = true;
    init.hoisting(initValues, initValues, false, members, { declareInPlace: false });
    init.hparams = [];
    this.scopes.push(init);
    this.addHoist(init);
    // Each initializer hoists into a slot of its own, which the walk
    // meets in source order and `_init` merges in the emitter's order.
    // A state slot is also the HMR thunk that re-runs it alone.
    init.slots = [];
    for (const v of initValues) {
      if (!isStruct(v)) continue;
      const slot = new HoistSlot(init, v, state.includes(v));
      init.slots.push(slot);
      this.hoistAt.set(v, slot);
    }
    const initEnv = { scope: init, next: members };
    this.env = members;
    for (let i = 2; i < body.length; i++) {
      const s = body[i];
      if (isNode(s) && s[0] === 'effect' && this.isEffectDecl(s)) {
        this.env = initEnv;
        this.visitEffect(s, c, null, null, true);
        this.env = members;
        continue;
      }
      // The emitter emits a component's methods and lifecycle hooks
      // through methodBlock: a `name = ->` member, and every pair of a
      // colon-method group.
      if (isNode(s)) {
        if (s[0] === 'object') for (let j = 2; j < s.length; j++) this.noteMethodPair(s[j]);
        else if (s[0] === ':') this.noteMethodPair(s);
        else if (s[0] === '=' && s.length === 4 && isFuncNode(s[3])) this.methodFuncs.add(s[3]);
      }
      // A line no member category takes rejects as the emitter
      // classifies the body, before any member's function emits: the
      // parameter and bare-`it` checks inside it never run.
      const preempted = isNode(s) && !COMPONENT_LINE_HEADS.has(s[0]);
      if (preempted) this.preempted++;
      this.visit(s, c, null, null);
      if (preempted) this.preempted--;
    }
    this.env = env;
  }

  // A component body's member names and its `_init` hoist list: the
  // readonly, plain and state initializers, then the computed values
  // that are no multi-statement block, in the emitter's order; and the
  // state initializers alone.
  componentMembers(body) {
    const names = new Set();
    const ro = [], plain = [], state = [], derived = [];
    const target = (t) => {
      const w = wordOf(t);
      if (w !== undefined) return w;
      if (isNode(t) && t[0] === '.' && t.length === 4 && wordOf(t[2]) === 'this') return wordOf(t[3]);
      return undefined;
    };
    const member = (s) => {
      if (!isNode(s)) return;
      const kind = this.kindOf(s);
      const h = s[0];
      if (h === 'offer' && kind === 'offer') return member(s[2]);
      if (h === 'accept' && kind === 'accept') { const w = wordOf(s[2]); if (w !== undefined) names.add(w); return; }
      if (h === 'gate' && kind === 'gate') { const w = target(s[2]); if (w !== undefined) names.add(w); return; }
      if (this.isReactiveDecl(s)) {
        const w = target(s[2]);
        if (w === undefined) return;
        names.add(w);
        if (h === 'state') state.push(s[3]);
        else if (!isComputedBlock(s)) derived.push(s[3]);
        return;
      }
      if (this.isReadonlyDecl(s)) {
        const w = target(s[2]);
        if (w !== undefined) { names.add(w); ro.push(s[3]); }
        return;
      }
      if (h === '?' && s.length === 3) { const w = target(s[2]); if (w !== undefined) names.add(w); return; }
      if (h === 'typed-var') { const w = target(s[2]); if (w !== undefined) names.add(w); return; }
      if (h === '.' && s.length === 4 && wordOf(s[2]) === 'this' && wordOf(s[3]) !== undefined) { names.add(wordOf(s[3])); return; }
      if (h === '=' && s.length === 4) {
        const w = target(s[2]);
        if (w === undefined || COMPONENT_HOOKS.has(w)) return;
        names.add(w);
        if (!isFuncNode(s[3])) plain.push(s[3]);
        return;
      }
      if (h === 'object') {
        for (let j = 2; j < s.length; j++) {
          const k = isNode(s[j]) ? wordOf(s[j][2]) : undefined;
          if (k !== undefined && !COMPONENT_HOOKS.has(k)) names.add(k);
        }
      }
    };
    for (let i = 2; i < body.length; i++) member(body[i]);
    return { names, initValues: [...ro, ...plain, ...state, ...derived], state };
  }

  // ── declarations ───────────────────────────────────────────────────
  declTarget(x, m) {
    const target = x[2];
    const tw = wordOf(target);
    if (tw !== undefined) this.rabName(tw, m);
    else if (isStruct(target)) this.rabPattern(target, m);
    this.visit(target, (m & ~(RN | HOIST | HMATCH | CNEST | RNEST)) | NORAB, null, null);
    return tw;
  }

  visitReactive(x, m, cs, rs) {
    this.trig.reactive = true;
    const hv = x[0];
    const name = this.declTarget(x, m);
    const block = isComputedBlock(x);
    if (m & HOIST && name !== undefined) this.hs.hreactive.add(name);
    if (cs !== null) {
      if (m & CNEST) {
        if (cs.errReactive === null) {
          const op = hv === 'state' ? ':=' : '~=';
          cs.errReactive = this.positioned(
            `emitter: a reactive declaration ('${name ?? '…'} ${op} …') must sit at module or function scope — ` +
            `inside a statement block it lowers to a block-scoped const, and any later read would unwrap '.value' off a binding ` +
            `that no longer exists`, x);
        }
      } else if (name !== undefined) {
        cs.record('reactive', name, this.idOf(x));
        if (hv === 'computed') cs.record('computed', name, this.idOf(x));
      }
    }
    if (rs !== null) {
      this.auth(rs, name, hv === 'computed' ? 'computed' : 'state', x);
      this.noteAnnotation(rs, name, x);
    }
    const vm = atRn(m, RN_EXPR);
    if (block) {
      // computedBody: the block is its own scope.
      const value = x[3];
      const scope = this.openScope(null, value, [], false);
      this.hoistBody(scope, value, [], false, {});
      const saved = this.openBodyFence([value], scope, x);
      this.visitBody(value, vm, scope, []);
      this.closeBodyFence(saved);
      return;
    }
    if (hv !== 'computed') return this.visit(x[3], vm & ~CNEST, null, rs);
    const saved = this.openBodyFence([x[3]], null, x);
    this.visit(x[3], vm & ~CNEST, null, rs);
    this.closeBodyFence(saved);
  }

  visitEffect(x, m, cs, rs, member) {
    this.trig.reactive = true;
    const target = isNone(x[2]) ? null : x[2];
    let name;
    if (target !== null) name = this.declTarget(x, m);
    if (m & HOIST && name !== undefined) this.hs.hreactive.add(name);
    if (target !== null && cs !== null) {
      if (m & CNEST) {
        if (cs.errHandle === null) {
          cs.errHandle = this.positioned(
            `emitter: a bound effect ('${name ?? '…'} ~> …') must sit at module or function scope — ` +
            `inside a statement block its dispose handle would be a block-scoped const, dead to every later read; ` +
            `a BARE '~> …' stays legal here`, x);
        }
      } else if (name !== undefined) {
        cs.record('handles', name, this.idOf(x));
      }
    }
    if (target !== null && rs !== null) this.auth(rs, name, 'effect', x);
    const body = x[3];
    const bm = atRn(m & ~(HOIST | HMATCH | PLAN | CNEST | RNEST), RN_EXPR);
    if (isFuncNode(body)) return this.visitFunc(body, bm, null, null, null);
    if (isNode(body) && body[0] === 'block') {
      // A component member's single-statement block emits inline with
      // no frame, hoisting its one statement; every other block body is
      // a function scope.
      if (member && body.length <= 3) {
        if (body.length === 3) return this.visitSingleEffect(x, body[2], bm, body);
        return this.visit(body, bm, null, null);
      }
      const scope = this.openScope(null, body, [], false);
      this.hoistBody(scope, body, [], false, {});
      const saved = this.openBodyFence([body], scope, x);
      this.visitBody(body, bm, scope, []);
      this.closeBodyFence(saved);
      return;
    }
    if (member) return this.visitSingleEffect(x, body, bm, null);
    // effectValue's single expression: checked as its own scope, no
    // frame; it hoists its one expression.
    const scope = this.openScope(x, [body], [], true);
    this.noteStmt(scope, body);
    this.hoistOne(scope, body);
    const saved = this.openBodyFence([body], scope, x);
    this.inHoist(scope, () => {
      this.curTop = body;
      this.visit(body, bm | HOIST | PLAN, null, scope);
    });
    this.endScope(scope);
    this.closeBodyFence(saved);
  }

  // A component effect with one statement: no frame and no check, but
  // the statement hoists in its own function. `block` is the body block
  // the statement sits in, walked as the free-reference walk reads it.
  visitSingleEffect(x, single, bm, block) {
    const scope = new Scope(x, [single], []);
    scope.frameless = true;
    this.scopes.push(scope);
    this.hoistOne(scope, single);
    const saved = this.openBodyFence([block ?? single], scope, x);
    this.inHoist(scope, () => {
      this.curTop = single;
      this.visit(single, bm | HOIST | PLAN, null, null);
    });
    this.closeBodyFence(saved);
  }

  visitReadonly(x, m, cs, rs) {
    const name = this.declTarget(x, m);
    if (m & HOIST && name !== undefined) this.hs.hreactive.add(name);
    if (cs !== null) {
      if (m & CNEST) {
        if (cs.errReadonly === null) {
          cs.errReadonly = this.positioned(
            `emitter: a readonly declaration ('${name ?? '…'} =! …') must sit at module or function scope — ` +
            `inside a statement block it lowers to a block-scoped const, dead to every later read`, x);
        }
      } else if (name !== undefined) {
        cs.record('readonly', name, this.idOf(x));
      }
    }
    if (rs !== null) {
      this.auth(rs, name, 'readonly', x);
      this.noteAnnotation(rs, name, x);
    }
    this.visit(x[3], atRn(m, RN_EXPR), cs, rs);
  }

  visitGate(x, m, cs, rs) {
    const c = childMode(m, 'gate');
    const target = x[2];
    const tw = wordOf(target);
    if (tw !== undefined) this.rabName(tw, m);
    else if (isStruct(target)) this.rabPattern(target, m);
    this.visit(target, (c & ~RN) | NORAB, cs, rs);
    this.visit(x[3], c, cs, rs);
    for (let i = 4; i < x.length; i++) this.visit(x[i], (c & ~RN) | NORAB, cs, rs);
  }

  // ── assignments and pairs ──────────────────────────────────────────
  visitAssign(x, hv, m, cs, rs) {
    const target = x[2];
    const tw = wordOf(target);
    if (tw !== undefined) this.rabName(tw, m);
    else if (isPattern(target)) this.rabPattern(target, m);
    if ((m & HOIST) && !this.headWrite(tw)) {
      if (tw !== undefined) {
        this.hoistAdd(tw, x);
        if (this.face === 'ts') {
          this.hoistAnnotation(tw, x, false);
          // A module-scope schema declaration: the TS face types its
          // binding from the schema's story, never a pin.
          if (hv === '=' && this.hs === this.program && isNode(x[3]) && x[3][0] === 'schema' && this.kindOf(x[3]) === 'schema') {
            (this.schemaConsts ??= new Set()).add(tw);
          }
        }
      } else if (hv === '=' && isPattern(target)) this.hoistPattern(target, x, this.hs.heads);
    }
    if (m & PLAN) this.planSite(x, hv, m);
    if (rs !== null) {
      this.plainWrite(rs, x, hv, tw);
      if (tw !== undefined) this.noteAnnotation(rs, tw, x);
    }
    const c = childMode(m, hv);
    this.visit(target, atRn(c, RN_PAT), cs, rs);
    this.visit(x[3], c, cs, rs);
  }

  // `key: value`, a void pair, a shorthand pair. `as` 'method' marks an
  // object or class method's function.
  visitPair(x, m, cs, rs, as = null, inObject = false) {
    const hv = headOf(x);
    const c = childMode(m, hv);
    const rn = m & RN;
    const key = x[2];
    const keyWord = wordOf(key);
    if (hv === null) {
      // Shorthand: the generic rule (both words are references), and in
      // a binding pattern no reference at all.
      const sm = rn === RN_PAT ? c & ~RN : c;
      this.visit(key, sm, cs, rs);
      this.visit(x[3], sm, cs, rs);
      return;
    }
    // A computed key is an expression; a word key is no reference (nor,
    // in an object literal, a bare `it`).
    this.visit(key, keyWord === undefined ? c : (c & ~RN) | (hv === ':' && inObject ? NOIT : 0), cs, rs);
    // In a binding pattern a pair's value binds.
    const vm = rn === RN_PAT && hv === ':' ? atRn(c, RN_PAT) : c;
    const value = x[3];
    const method = as === 'method' || (as === 'object' && this.isMethodPair(x));
    if (method && isFuncNode(value)) return this.visitFunc(value, vm, cs, rs, 'method');
    this.visit(value, vm, cs, rs);
  }

  isMethodPair(x) {
    const hv = headOf(x);
    if (hv !== ':' && hv !== 'void-pair') return false;
    const k = wordOf(x[2]);
    return typeof k === 'string' && isIdentifierName(k) && isNode(x[3]) && x[3][0] === '->';
  }

  visitObject(x, m, cs, rs) {
    if (x.length === 3 && isNode(x[2]) && headOf(x[2]) === ':') {
      const pair = x[2];
      const k = pair[2];
      const keyOk = wordOf(k) !== undefined || (isNode(k) && k[0] === 'dynamicKey');
      if (keyOk && isNode(pair[3]) && pair[3][0] === 'comprehension' && pair[3][3][1].over === 'of') this.trig.objectComprehension = true;
    }
    const rn = m & RN;
    const c = childMode(m, 'object');
    const pm = rn === RN_PAT ? (c & ~RN) | RN_PAT : c;
    for (let i = 2; i < x.length; i++) {
      const p = x[i];
      if (isNode(p) && p[0] === ':') this.visitPair(p, pm, cs, rs, rn === RN_PAT ? null : 'object', true);
      else this.visit(p, pm, cs, rs);
    }
  }

  visitArray(x, m, cs, rs) {
    const rn = m & RN;
    const c = childMode(m, 'array');
    const pm = rn === RN_PAT ? (c & ~RN) | RN_PAT : c;
    for (let i = 2; i < x.length; i++) {
      if (isNone(x[i])) this.visitWord(',', pm);
      else this.visit(x[i], pm, cs, rs);
    }
  }

  visitStr(x, m, cs, rs, from) {
    const c = childMode(m, x[0]);
    for (let i = 2; i < x.length; i++) {
      if (i >= from && isNone(x[i])) this.visitWord('', c);
      else this.visit(x[i], c, cs, rs);
    }
  }

  // ── loops and blocks ───────────────────────────────────────────────
  // A loop statement. The vars are binding patterns the hoist scans
  // for match writes alone and the redeclaration walk never enters;
  // every later slot walks nested.
  visitLoop(x, m, cs, rs) {
    const hv = headOf(x);
    const over = x[1].over;
    const env = this.env;
    if (over === 'forever' || over === 'times') {
      const c = childMode(m, hv);
      // A counted loop binds `it` for its whole emission.
      if (over === 'times') this.env = { block: IT_BINDING, next: env };
      if (over === 'times') this.visit(x[3], c, cs, rs);
      this.withHeads(over === 'times' ? ['it'] : EMPTY_ARRAY, m, rs, () => this.visit(x[6], c, cs, rs));
      this.env = env;
      return;
    }
    const vars = x[2];
    const rn = m & RN;
    const c = childMode(m, hv);
    for (const p of vars) this.rabPattern(p, m);
    // The loop's variables bind for its whole emission (environment)
    // and, to the planner, for every slot after the variables.
    const bound = this.bindingNames(vars);
    this.env = { block: bound, next: env };
    const extra = this.extra;
    if (rs !== null) this.bindingVars(vars, x, 'loop head', rs);
    this.visitVars(vars, atRn(c & ~(HOIST | PLAN), RN_PAT) | ((m & (HOIST | HMATCH)) ? HMATCH : 0), cs);
    if (m & PLAN) this.extra = { names: bound, next: extra };
    // The source and step evaluate before the variables bind: no bare
    // `it` there reads them.
    const outerSource = this.loopSource;
    this.loopSource = this.env;
    this.visit(x[3], c, cs, rs);
    if (!isNone(x[4])) this.visit(x[4], c, cs, rs);
    this.loopSource = outerSource;
    this.withHeads([...bound], m, rs, () => {
      if (!isNone(x[5])) this.visit(x[5], c, cs, rs);
      this.visit(x[6], rn === RN_RENDER ? (c & ~RN) | RN_RENDER : c, cs, rs);
    });
    this.extra = extra;
    this.env = env;
  }

  // The names a loop's or clause's variables bind (none when a
  // variable cannot bind: that rejects in its own walk).
  bindingNames(vars) {
    const names = [];
    try {
      for (const p of vars) this.patternNames(p, names, true);
    } catch {
      return EMPTY_SET;
    }
    return new Set(names);
  }

  // A loop's or clause's variables: each a binding pattern (its
  // defaults and computed keys are the free-reference walk's only
  // references there).
  visitVars(vars, m, cs) {
    for (const p of vars) this.visit(p, m, cs, null);
  }

  visitComprehension(x, m, cs, rs) {
    const c = childMode(m, 'comprehension');
    const clause = x[3];
    // The clause's variables bind for the whole comprehension.
    const env = this.env;
    const extra = this.extra;
    const bound = this.bindingNames(clause[2]);
    this.env = { block: bound, next: env };
    if (m & PLAN) this.extra = { names: bound, next: extra };
    this.withHeads([...bound], m, rs, () => this.visit(x[2], c, cs, rs));
    if (rs !== null) this.bindingVars(clause[2], x, 'comprehension clause', rs);
    // The clause: its vars bind per construct, and its source and step
    // walk here (a step's write is this scope's).
    const hv = headOf(clause);
    const cc = childMode(c, hv);
    for (const p of clause[2]) this.rabPattern(p, m);
    this.visitVars(clause[2], atRn(cc & ~(HOIST | PLAN), RN_PAT) | ((m & (HOIST | HMATCH)) ? HMATCH : 0), cs);
    const outerSource = this.loopSource;
    this.loopSource = this.env;
    this.visit(clause[3], cc, cs, rs);
    const over = clause[1].over;
    if (over === 'in') {
      if (!isNone(clause[4])) this.visit(clause[4], cc & ~PLAN, cs, null);
    }
    this.loopSource = outerSource;
    if (!isNone(clause[5])) this.withHeads([...bound], m, rs, () => this.visit(clause[5], c, cs, rs));
    this.extra = extra;
    this.env = env;
  }

  visitTry(x, m, cs, rs) {
    const c = childMode(m, 'try');
    const body = x[2];
    const handler = isNone(x[3]) ? null : x[3];
    const finalizer = isNone(x[4]) ? null : x[4];
    const binding = handler !== null && !isNone(handler[2]) ? handler[2] : null;
    const pattern = binding !== null && isPattern(binding);
    if (binding !== null) this.rabPattern(binding, m);
    if (pattern && (m & HOIST)) this.hoistPattern(binding, x, this.hs.heads);
    // The redeclaration walk reads the handler and the finalizer before
    // the body: the body's forms land after theirs.
    let bodyForms = null;
    let saved = null;
    if (rs !== null) {
      saved = rs.forms;
      rs.forms = [];
    }
    // So does the planner: the emitter mints the body's temps after the
    // handler's and the finalizer's.
    const sites = (m & PLAN) ? this.ps.planSites : null;
    const bodyStart = sites?.length ?? 0;
    this.visit(body, c, cs, rs);
    const bodyEnd = sites?.length ?? 0;
    if (rs !== null) {
      bodyForms = rs.forms;
      rs.forms = saved;
    }
    if (handler !== null) {
      // The handler: ['catch', attrs, binding, block]. A simple binding
      // (a name, or a typed name) names one catch parameter.
      const w = binding !== null && !pattern
        ? wordOf(binding) ?? (isNode(binding) && binding[0] === 'typed-var' ? wordOf(binding[2]) : undefined)
        : undefined;
      if (pattern) {
        if (rs !== null) {
          try {
            const names = this.dupIn(this.patternNames(binding), binding, 'catch pattern', rs);
            for (const n of names) this.plain(rs, n, x);
            this.handlerDecls(handler, names, rs);
          } catch (err) {
            rs.forms.push({ error: err });
          }
        }
        this.visit(binding, atRn(c, RN_PAT), cs, null);
      } else if (binding !== null) {
        if (rs !== null && w !== undefined) this.handlerDecls(handler, [w], rs);
        const quiet = this.itQuiet;
        this.itQuiet = true;
        this.visit(binding, atRn(c, RN_PAT), cs, rs);
        this.itQuiet = quiet;
      }
      // A pattern's names are the planner's own in the handler; a plain
      // or typed binding binds for the handler's emission.
      const env = this.env;
      const extra = this.extra;
      if (pattern && (m & PLAN)) {
        let names = EMPTY_SET;
        try { names = new Set(this.patternNames(binding)); } catch { /* the hoist walk rejects it */ }
        this.extra = { names, next: extra };
      }
      // The handler's writes to a simple catch name assign the catch
      // parameter: the hoist (headWrite) and the redeclaration walk
      // (plain) skip them.
      if (w !== undefined) this.env = { block: new Set([w]), next: env };
      this.withHeads(w !== undefined ? [w] : EMPTY_ARRAY, m, rs, () => this.visit(handler[3], c, cs, rs));
      this.env = env;
      this.extra = extra;
    }
    if (finalizer !== null) this.visit(finalizer, c, cs, rs);
    if (rs !== null) for (const f of bodyForms) rs.forms.push(f);
    if (bodyEnd > bodyStart) sites.push(...sites.splice(bodyStart, bodyEnd - bodyStart));
  }

  // A def or class statement of a catch handler's own block declares in
  // the block the catch binding scopes: one of the binding's names
  // there is a redeclaration of it. A deeper block shadows freely.
  handlerDecls(handler, names, rs) {
    const body = handler[3];
    const stmts = isNode(body) && body[0] === 'block' ? body.slice(2) : [body];
    for (const st of stmts) {
      if (!isNode(st) || (st[0] !== 'def' && st[0] !== 'class')) continue;
      const n = wordOf(st[2]);
      if (n === undefined || !names.includes(n)) continue;
      const line = this.nodeLine(handler);
      rs.forms.push({ error: this.positioned(`emitter: '${n}' was already declared as catch binding${line !== null ? ` on line ${line}` : ''} — assign with '${n} = …' to update it, or choose a different name`,
        st, ...(rs.owner !== null ? [rs.owner] : [])) });
      return;
    }
  }

  // An `if` in a render statement: its condition is an expression, its
  // branches render.
  visitRenderIf(x, m, cs, rs) {
    const c = childMode(m, 'if');
    const r = (c & ~RN) | RN_RENDER;
    this.visit(x[2], c, cs, rs);
    this.visit(x[3], r, cs, rs);
    if (!isNone(x[4])) this.visit(x[4], r, cs, rs);
  }

  // A switch with a subject and no regex or range arm is one JS switch:
  // its cases share one block, each case body's statements the switch's
  // own (blockUnit). Any other is an if chain, each case its own block.
  visitSwitch(x, m, cs, rs) {
    if (rs === null || isNone(x[2]) || x[3].some((w) => isNode(w) && w[0] === 'when' && w[2].some(isMatchArm))) {
      return this.generic(x, 'switch', m, cs, rs);
    }
    // The subject writes outside the cases' block.
    const c = childMode(m, 'switch');
    this.visit(x[2], c, cs, rs);
    const unit = this.blockUnit(rs);
    for (const w of x[3]) if (isNode(w) && w[0] === 'when' && isNode(w[3]) && w[3][0] === 'block') this.caseBlocks.set(w[3], unit);
    if (isNode(x[4]) && x[4][0] === 'block') this.caseBlocks.set(x[4], unit);
    this.visit(x[3], c, cs, rs);
    this.visit(x[4], c, cs, rs);
    this.endBlockUnit(unit, rs);
  }

  // A def or class in a block binds its name across the whole block,
  // so a write to the name earlier in the block, or a second def or class
  // of it, rejects at the def. A unit marks where its forms begin and
  // collects the names it declares.
  blockUnit(rs) {
    return { start: rs.forms.length, names: null };
  }

  unitStmt(unit, st, c, cs, rs) {
    if (isNode(st) && (st[0] === 'def' || st[0] === 'class')) {
      const n = wordOf(st[2]);
      if (n !== undefined) {
        const kind = st[0];
        const at = rs.owner !== null ? [rs.owner] : [];
        const prior = unit.names?.get(n);
        if (prior !== undefined) {
          const line = this.nodeLine(prior);
          rs.forms.push({ error: this.positioned(`emitter: '${n}' was already declared as ${prior[0]}${line !== null ? ` on line ${line}` : ''} — choose a different name`, st, ...at) });
        } else {
          for (let i = unit.start; i < rs.forms.length; i++) {
            const f = rs.forms[i];
            if (f.auth || f.blockBound || f.name !== n) continue;
            const line = f.node !== null ? this.nodeLine(f.node) : null;
            rs.forms.push({ error: this.positioned(`emitter: '${n}' is written${line !== null ? ` on line ${line}` : ''} before this ${kind} in the same block — ` +
              `a ${kind} binds its name across its whole block, so that write would assign the ${kind}; rename one of them, or move the ${kind} out of the block`, st, ...at) });
            break;
          }
        }
        (unit.names ??= new Map()).set(n, st);
      }
    }
    this.visit(st, c, cs, rs);
  }

  endBlockUnit(unit, rs) {
    if (unit.names === null) return;
    for (let i = unit.start; i < rs.forms.length; i++) {
      const f = rs.forms[i];
      if (!f.auth && unit.names.has(f.name)) f.blockBound = true;
    }
  }

  // A pick item: [key, target, default]. The key and the target are
  // property names, words to every walk but the free-reference walk and
  // the bare-`it` scan; the default is an expression.
  visitPickItem(x, m, cs, rs) {
    this.noteNode(x, 'pickitem', m);
    const c = childMode(m, 'pickitem');
    const names = (c & ~RN) | NOIT;
    this.visit(x[2], names, cs, rs);
    this.visit(x[3], names, cs, rs);
    if (!isNone(x[4])) this.visit(x[4], c, cs, rs);
  }

  visitTypeDecl(x, m) {
    const quiet = m & ~(RN | USED);
    this.visit(x[2], quiet, null, null);
  }

  // ── exports ────────────────────────────────────────────────────────
  visitExport(x, m, cs, rs) {
    const c = childMode(m, 'export');
    const spec = x[2];
    if (Array.isArray(spec) && spec.length === 0) { this.visitWord('{}', c); return; }
    // The hoist walks a declaration's initializer (an effect's and a
    // computed block's are scopes of their own) and an assignment's; the
    // binding never hoists, and any other export hoists nothing.
    let hm = c & ~HOIST;
    if ((m & HOIST) && isNode(spec)) {
      const decl = (spec[0] === 'state' || spec[0] === 'computed') ? this.isReactiveDecl(spec)
        : spec[0] === 'effect' ? this.isEffectDecl(spec) : spec[0] === 'readonly' ? this.isReadonlyDecl(spec) : false;
      const name = decl ? wordOf(spec[2]) : undefined;
      if (name !== undefined) {
        this.hs.hreactive.add(name);
        if (spec[0] !== 'effect' && !isComputedBlock(spec)) hm = c;
      } else if (ASSIGNS.has(headOf(spec)) && spec.length === 4) hm = c;
    }
    this.visitExportSpec(spec, c, hm, cs, rs);
  }

  // The exported spec. `hm` carries HOIST when the program hoist walks
  // the spec's initializer (and never its target).
  visitExportSpec(spec, c, hm, cs, rs) {
    const assign = isNode(spec) && (headOf(spec) === '=' || headOf(spec) === 'void-assign') && spec.length === 4 && wordOf(spec[2]) !== undefined;
    if (assign) {
      const name = wordOf(spec[2]);
      if (rs !== null) this.auth(rs, name, 'plain', spec);
      // An exported plain assign is `export const`: the redeclaration
      // walk counts it authoritatively and walks only its value; the
      // hoist walks its value.
      this.rabName(name, c);
      const hv = headOf(spec);
      const sc = childMode(hm, hv);
      this.visit(spec[2], atRn(sc & ~(HOIST | HMATCH), RN_PAT), cs, null);
      this.visit(spec[3], sc, cs, rs);
      return;
    }
    if (hm & HOIST && isNode(spec) && ASSIGNS.has(headOf(spec))) {
      // The initializer walks; the target does not hoist.
      const hv = headOf(spec);
      const tw = wordOf(spec[2]);
      if (tw !== undefined) this.rabName(tw, c);
      else if (isPattern(spec[2])) this.rabPattern(spec[2], c);
      if (rs !== null) this.plainWrite(rs, spec, hv, tw);
      const sc = childMode(hm, hv);
      this.visit(spec[2], atRn(sc & ~(HOIST | HMATCH), RN_PAT), cs, rs);
      this.visit(spec[3], sc, cs, rs);
      return;
    }
    // Any other spec walks as itself: under HOIST a declaration's
    // handler records the name and walks its value.
    this.visit(spec, hm, cs, rs);
  }

  visitExportOther(x, m, cs, rs) {
    const h = x[0];
    const c = childMode(m, h);
    if (h === 'export-from' && Array.isArray(x[2]) && x[2].length === 0) {
      this.visitWord('{}', c);
      this.visit(x[3], c, cs, rs);
      return;
    }
    for (let i = 2; i < x.length; i++) if (!isNone(x[i])) this.visit(x[i], c, cs, rs);
  }

  // ── types ──────────────────────────────────────────────────────────
  visitTypedVar(x, m, cs, rs) {
    if ((m & HOIST) && this.face === 'ts') {
      this.noteForward(x);
      const w = wordOf(x[2]);
      if (w !== undefined) this.hoistAnnotation(w, x, true);
    }
    const c = childMode(m, 'typed-var');
    const rn = m & RN;
    const target = x[2];
    const tw = wordOf(target);
    let tm = c & ~RN;
    if (rn === RN_PAT) tm |= RN_PAT;
    else if (rn && tw === undefined) tm |= RN_EXPR;
    this.visit(target, tm, cs, rs);
    if (isNone(x[3])) this.visitWord('', c & ~(RN | USED));
    else this.visit(x[3], c & ~(RN | USED), cs, rs);
  }

  visitPostfixType(x, m, cs, rs) {
    const c = childMode(m, x[0]);
    this.visit(x[2], c, cs, rs);
    this.visit(x[3], c & ~(RN | USED), cs, rs);
  }

  // ── calls ──────────────────────────────────────────────────────────
  visitCall(x, m, cs, rs) {
    const c = childMode(m, 'call');
    const a = x[1];
    if ((m & RN) !== RN_RENDER || a.opt === true || a.await === true || !this.tagOf(x[2])) {
      for (let i = 2; i < x.length; i++) this.visit(x[i], c, cs, rs);
      return;
    }
    // A tag call: the tag is an element, its children block is render.
    this.visit(x[2], c & ~RN, cs, rs);
    for (let i = 3; i < x.length; i++) {
      if (isChildren(x[i])) this.visitChildren(x[i], c, RN_RENDER);
      else this.visit(x[i], c, cs, rs);
    }
  }

  tagOf(head) {
    const w = wordOf(head);
    if (w !== undefined) return isTagWord(w);
    if (isNode(head) && head[0] === '.' && head.length === 4) {
      let cur = head;
      while (isNode(cur) && cur[0] === '.' && cur.length === 4) {
        if (wordOf(cur[3]) === undefined) return false;
        cur = cur[2];
      }
      const t = wordOf(cur);
      if (t === undefined) return false;
      const [tag] = t.split('#');
      return isTagWord(tag || 'div');
    }
    return false;
  }

  visitDoIife(x, m, cs, rs) {
    const fn = x[2];
    if (!isFuncNode(fn)) return this.generic(x, 'do-iife', m, cs, rs);
    // `do` calls its function with the outer bindings its parameters
    // name: each is a free reference.
    if (m & RN) for (const n of this.paramBindings(fn[2], new Set())) this.free(n);
    this.visit(fn, childMode(m, 'do-iife'), cs, rs);
  }

  visitRender(x, m, cs, rs) {
    const sink = renderSink(new Set(), []);
    const body = x[2];
    if (isNode(body) && body[0] === 'block') for (let i = 2; i < body.length; i++) this.renderAt(body[i], sink);
    else this.renderAt(body, sink);
    const c = childMode(m, 'render');
    // A render local or loop variable named `it` answers the reads of its
    // own sink (settleIt).
    const saved = this.openBodyFence([body], null, x, true);
    this.visit(x[2], atRn(c, RN_RENDER), cs, rs);
    this.closeBodyFence(saved);
  }

  // ── render emission ────────────────────────────────────────────────
  // How the emitter's render lowering reads a render body: which nodes
  // stand at a render child position. A sink is one factory's render
  // locals plus the loop variables above it; a conditional branch and a
  // loop body each open a new one.
  renderAt(x, sink) {
    if (isNode(x) && wordOf(x) === undefined) this.renderPos.set(x, sink);
  }

  renderBlock(body, sink) {
    if (isNode(body) && body[0] === 'block') for (let i = 2; i < body.length; i++) this.renderAt(body[i], sink);
    else if (Array.isArray(body) && !isNode(body)) for (const el of body) this.renderAt(el, sink);
    else this.renderAt(body, sink);
  }

  renderChild(x, sink) {
    this.renderPos.delete(x);
    const hv = headOf(x);
    const branch = () => renderSink(new Set(), sink.loops, sink);
    if (RENDER_BINDING_HEADS.has(hv) && x.length === 4 && isIdentifierName(wordOf(x[2]))) {
      if (hv === '=') sink.locals.add(wordOf(x[2]));
      return;
    }
    // A parenthesized branch is a value, no markup.
    if ((hv === 'if' || hv === 'switch') && x.parenthesized) return;
    if (hv === 'if') {
      this.renderBlock(x[3], branch());
      if (!isNone(x[4])) {
        if (isNode(x[4]) && x[4][0] === 'if') this.renderAt(x[4], sink);
        else this.renderBlock(x[4], branch());
      }
      return;
    }
    if (hv === 'switch') {
      for (const w of x[3]) if (isNode(w) && w[0] === 'when') this.renderBlock(w[3], branch());
      if (!isNone(x[4])) this.renderBlock(x[4], branch());
      return;
    }
    if (hv === 'for-in' && !isNone(x[6])) {
      const loops = [...sink.loops];
      for (const v of x[2]) { const w = wordOf(v); if (w !== undefined) loops.push(w); }
      this.renderBlock(x[6], renderSink(new Set(), loops, sink));
      return;
    }
    if (hv !== 'call' || x[1].opt === true || x[1].await === true) return;
    const callee = x[2];
    const name = wordOf(callee);
    const args = x.slice(3);
    if (name === 'slot') return;
    if (name !== undefined && isComponentName(name)) return this.renderTagArgs(args, sink);
    if (componentPathOf(callee)) return this.renderTagArgs(args, sink);
    if (name !== undefined) {
      if (isHtmlTag(name) && !sink.bound.has(name)) this.renderTagArgs(args, sink);
      return;
    }
    const tagExpr = clsxTagExpr(callee);
    if (tagExpr !== null) {
      const t = wordOf(tagExpr);
      const tag = t !== undefined ? (t.split('#')[0] || 'div') : templateTag(tagExpr).tag;
      if (tag !== null && isHtmlTag(tag)) this.renderTagArgs(args, sink);
      return;
    }
    const { tag, classes } = templateTag(callee);
    if (tag !== null && isHtmlTag(tag) && !sink.bound.has(tag)) {
      if (classes.length > 0 && classes[classes.length - 1] === '__clsx') return;
      this.renderTagArgs(args, sink);
    }
  }

  // An element's or a child component's arguments: each statement of
  // its children block that is no attribute (or prop) object stands at a
  // render child position, and so does each argument that is no object.
  renderTagArgs(args, sink) {
    for (const arg of args) {
      if (isChildren(arg)) {
        const block = arg[2];
        for (let i = 2; i < block.length; i++) if (!(isNode(block[i]) && block[i][0] === 'object')) this.renderAt(block[i], sink);
      } else if (!(isNode(arg) && arg[0] === 'object')) this.renderAt(arg, sink);
    }
  }

  // ── schemas ────────────────────────────────────────────────────────
  visitSchema(x, m) {
    this.trig.schema = true;
    const body = x[2];
    const descriptor = body[2];
    if (descriptor && descriptor.kind === 'model') this.trig.modelSchema = true;
    const sites = schemaCodeSites(descriptor);
    // Each site's tree is the descriptor's. A projection folded from a schema carries no DSL of its own: its
    // sites' trees are the source schema's, recorded there.
    const dsl = body[3];
    if (!isNone(dsl)) {
      const trees = descriptor[SCHEMA_TREES];
      for (const site of sites) {
        const tree = trees?.get(site.tokens);
        if (tree === undefined) throw new Error(`analyze: a schema's code site has no tree (entry ${site.index})`);
        this.siteTrees.set(site.tokens, tree[3]);
      }
    }
    for (const site of sites) {
      const program = this.siteTrees.get(site.tokens);
      if (program === undefined) throw new Error('emitter: a schema code site has no parsed body — the parse owns every SCHEMA_CODE payload');
      const stmts = program.slice(2);
      if (stmts.length === 0) continue;
      let names = [];
      if (!site.value) {
        try {
          names = this.schemaBodyParams(site.entry).map((p) => p.name);
        } catch (err) {
          if (this.schemaErr === null) this.schemaErr = err;
        }
      }
      this.visitSchemaBody(stmts, names, site.value, site.tokens);
    }
  }

  schemaBodyParams(entry) {
    if (entry.tag === 'adapter') return [];
    if (entry.tag === 'field') return [{ name: 'it', type: null }];
    return paramsOf(entry.paramTokens ?? [], entry.tag === 'ensure' ? '@ensure' : `'${entry.name}'`, schemaFail, this.source);
  }

  // A schema callable body: its own delivery tree, and (when it is a
  // callable rather than the adapter value) its own scope with the
  // body parameters as plain names. A callable checks its bare `it`
  // reads, as a def does.
  visitSchemaBody(stmts, names, value, tokens) {
    this.beginTree(names);
    const scope = value ? null : this.openScope(null, stmts, names);
    if (scope !== null && this.preempted === 0) {
      this.itFence = { fn: null, stmts, span: islandSpan(tokens), params: names, scope, env: this.env, sub: true, rsink: this.rsink, hit: null, inParams: false, hitParam: false };
    }
    const walk = (m) => {
      for (const s of stmts) {
        if (scope !== null) this.noteStmt(scope, s);
        this.curTop = s;
        this.visit(s, m, scope, scope);
      }
    };
    if (scope === null) walk(RN_EXPR);
    else {
      // A sub-emitter compiles the body where the schema emits: it starts
      // from that environment's scopes and frames, but not the module's
      // other bindings, its components' members or its source text.
      const sub = this.inSub;
      this.inSub = true;
      scope.hoisting(stmts, stmts, false, this.env);
      scope.hparams = names;
      scope.subRoot = true;
      this.addHoist(scope);
      this.inHoist(scope, () => walk(RN_EXPR | HOIST | PLAN));
      this.inSub = sub;
      this.endScope(scope);
    }
    if (this.itFence !== null && this.itFence.hit !== null) this.itFences.push(this.itFence);
    this.endTree();
  }

  // ── redeclaration ──────────────────────────────────────────────────
  auth(scope, name, kind, node) {
    if (typeof name === 'string') scope.forms.push({ name, kind, node, auth: true });
  }

  plain(scope, name, node) {
    if (typeof name === 'string' && !(scope.heads?.has(name) ?? false)) scope.forms.push({ name, kind: 'plain', node, auth: false });
  }

  // One binding has one type: a later annotation of a name in the same
  // scope spells the first one's type, or the program rejects naming
  // both. Identical annotations agree.
  noteAnnotation(scope, name, node) {
    if (typeof name !== 'string') return;
    const text = this.annotationText(node);
    if (text === null) return;
    const prior = scope.typed?.get(name);
    if (prior === undefined) (scope.typed ??= new Map()).set(name, { node, text });
    else if (prior.text !== text) scope.forms.push({ error: this.annotationConflict(name, prior, { node, text }, scope.owner) });
  }

  annotationConflict(name, prior, at, owner) {
    const line = this.nodeLine(at.node);
    const priorLine = this.nodeLine(prior.node);
    return this.positioned(`emitter: '${name}' is annotated ': ${at.text}'${line !== null ? ` on line ${line}` : ''} ` +
      `but ': ${prior.text}'${priorLine !== null ? ` on line ${priorLine}` : ''} — one binding has one type; make the annotations agree or drop one`,
      at.node, ...(owner !== null ? [owner] : []));
  }

  // An annotation on a name the scope does not bind is a write to an
  // enclosing binding, so it describes that binding: it agrees with the
  // binding's own annotation or rejects naming both, and a binding with
  // no annotation of its own rejects it, since the declaration's scope
  // would never see the type. A seeded REPL name carries no type, and a
  // component member's writes are the member guards' concern.
  settleOuterAnnotations(s) {
    if (s.typed === null || s.rejection !== null) return;
    for (const [name, at] of s.typed) {
      if (s.names.has(name)) continue;
      for (let f = s.env; f !== null; f = f.next) {
        if (f.members !== undefined) { if (f.members.has(name)) break; continue; }
        if (f.ambient !== undefined) { if (f.ambient.has(name)) break; continue; }
        if (f.block !== undefined && !f.block.has(name)) continue;
        if (f.scope !== undefined && !f.scope.names.has(name)) continue;
        const prior = f.scope !== undefined ? this.ownAnnotation(f.scope, name) : null;
        if (prior === null) s.rejection = this.unannotatedOuterWrite(name, at, f.scope ?? null, s.owner);
        else if (prior.text !== at.text) s.rejection = this.annotationConflict(name, prior, at, s.owner);
        break;
      }
      if (s.rejection !== null) return;
    }
  }

  // The annotation a scope's own binding of `name` carries: a typed
  // parameter's, or its first annotated write or typed forward.
  ownAnnotation(sc, name) {
    for (const p of sc.params ?? []) {
      if (!isNode(p) || p[0] !== 'typed-var' || wordOf(p[2]) !== name) continue;
      const text = this.annotationText(p);
      if (text !== null) return { node: p, text };
    }
    return sc.typed?.get(name) ?? null;
  }

  unannotatedOuterWrite(name, at, sc, owner) {
    const line = this.nodeLine(at.node);
    const site = sc === null ? undefined : sc.entries?.find(([n]) => n === name)?.[1];
    const siteLine = site === undefined ? null : this.nodeLine(site);
    return this.positioned(`emitter: '${name}' is annotated ': ${at.text}'${line !== null ? ` on line ${line}` : ''} ` +
      `but writes the enclosing binding${siteLine !== null ? ` declared on line ${siteLine}` : ''}, which has no annotation — ` +
      'one binding has one type; annotate it where it is declared, or drop this one',
      at.node, ...(owner !== null ? [owner] : []));
  }

  // A statement-level bare typed forward's annotation.
  noteForwardAnnotation(scope, s) {
    if (scope !== null && isNode(s) && s[0] === 'typed-var' && s.length === 4) this.noteAnnotation(scope, wordOf(s[2]), s);
  }

  // The normalized text of a node's annotation role, or null.
  annotationText(node) {
    const id = this.idOf(node);
    const row = id === null ? null : this.stores.role(id, 'annotation');
    if (row == null || row.sourceStart == null || this.source === null) return null;
    const raw = this.source.slice(row.sourceStart, row.sourceEnd).replace(/^\s*:\s*/, '');
    try {
      return normalizeTypeText(raw);
    } catch {
      return raw.trim();
    }
  }

  // An assignment's write forms: its bare target's, or each name a
  // destructuring `=` binds (a duplicate rejecting in place).
  plainWrite(scope, x, hv, tw) {
    if (tw !== undefined) return this.plain(scope, tw, x);
    if (hv !== '=' || !isPattern(x[2])) return;
    try {
      for (const n of this.dupIn(this.patternNames(x[2]), x, 'destructuring pattern', scope)) this.plain(scope, n, x);
    } catch (err) {
      scope.forms.push({ error: err });
    }
  }

  // A loop head's or comprehension clause's variables: each must bind
  // (no member target), and no name twice; a rejection lands in place.
  bindingVars(vars, x, what, scope) {
    try {
      const names = [];
      for (const p of vars) this.patternNames(p, names, true);
      for (const p of vars) { const err = this.memberTargetErr(p, MEMBER_LOOP_VARIABLE); if (err !== null) throw err; }
      this.dupIn(names, x, what, scope);
    } catch (err) {
      scope.forms.push({ error: err });
    }
  }

  dupIn(names, node, what, scope) {
    if (names.length < 2) return names;
    const seen = new Set();
    for (const n of names) {
      if (seen.has(n)) {
        throw this.positioned(`emitter: '${n}' is bound twice in one ${what} — one binding per name; rename or drop the duplicate`,
          node, ...(scope.owner !== null ? [scope.owner] : []));
      }
      seen.add(n);
    }
    return names;
  }

  // Close a scope: settle its redeclaration verdict and its parameter
  // forms (a zero-parameter function that reads a bare `it` gains it as
  // its parameter).
  endScope(scope) {
    const owner = scope.owner;
    const params = scope.implicitIt && scope.bareIt ? ['it'] : scope.params;
    // With no parameter and no authoritative form there is nothing to
    // redeclare, and no walk error to report.
    if (params.length === 0 && scope.forms.every((f) => !f.auth && f.error === undefined)) { scope.decls = EMPTY_MAP; return; }
    const pforms = [];
    let perr = null;
    try {
      const names = [];
      const sites = [];
      for (const p of params ?? []) {
        this.patternNames(p, names, true);
        const site = isStruct(p) ? p : params;
        while (sites.length < names.length) sites.push(site);
      }
      this.dupIn(names, isStruct(params?.[0]) ? params[0] : owner, 'parameter list', scope);
      names.forEach((n, i) => pforms.push({ name: n, kind: 'parameter', node: sites[i], auth: true }));
    } catch (err) {
      perr = err;
    }
    if (perr !== null) { scope.rejection = perr; return; }
    for (const f of scope.forms) {
      if (f.error) { scope.rejection = f.error; return; }
    }
    // A parameter's annotation is its binding's first.
    if (scope.typed !== null) {
      for (const p of params) {
        if (!isNode(p) || p[0] !== 'typed-var') continue;
        const name = wordOf(p[2]);
        const later = name === undefined ? undefined : scope.typed.get(name);
        const text = later === undefined ? null : this.annotationText(p);
        if (text !== null && text !== later.text) { scope.rejection = this.annotationConflict(name, { node: p, text }, later, owner); return; }
      }
    }
    const forms = pforms.length === 0 ? scope.forms : [...pforms, ...scope.forms];
    forms.forEach((f, i) => { f.order = i; });
    const reject = (at, prior) => {
      if (prior.reserved) return this.positioned(`emitter: '${at.name}' is reserved for ${prior.kind} — choose a different name`, at.node, ...(owner !== null ? [owner] : []));
      const line = prior.node !== null ? this.nodeLine(prior.node) : prior.line ?? null;
      const hint = prior.kind === 'state' || prior.kind === 'parameter' || prior.kind === 'catch binding' || prior.kind === 'plain' || prior.line != null
        ? ` — assign with '${at.name} = …' to update it, or choose a different name`
        : ' — choose a different name';
      return this.positioned(`emitter: '${at.name}' was already declared as ${prior.kind}${line !== null ? ` on line ${line}` : ''}${hint}`,
        at.node, ...(owner !== null ? [owner] : []));
    };
    const decls = new Map();
    for (const f of forms) {
      if (!f.auth) continue;
      const prior = decls.get(f.name);
      if (prior !== undefined) { scope.rejection = reject(f, prior); return; }
      decls.set(f.name, f);
    }
    for (const f of forms) {
      if (f.auth) continue;
      const prior = decls.get(f.name);
      if (prior?.reserved) { scope.rejection = reject(f, prior); return; }
      if (f.update) {
        if (prior !== undefined && prior.node !== null && f.order < prior.order && !f.blockBound) {
          scope.rejection = this.positioned(UPDATE_BEFORE_DECLARATION(f.name, this.nodeLine(f.node), prior.kind), prior.node, ...(owner !== null ? [owner] : []));
          return;
        }
        continue;
      }
      if (prior !== undefined && prior.auth && f.order < prior.order) { scope.rejection = reject(prior, f); return; }
    }
    scope.decls = decls;
  }

  // ── the scope facts ────────────────────────────────────────────────
  // Settled after the walk, outermost scope first: each scope's hoist
  // entries (its targets less what its parameters, its own declarations
  // and the enclosing scopes already bind), the reference plans its
  // walk met, then one walk in execution order for the declare-in-place
  // scan and the predicates, then the declare-in-place decisions.
  settle() {
    for (const s of this.hscopes) this.settleHoist(s);
    for (const s of this.hscopes) this.settleOuterAnnotations(s);
    for (const fence of this.itFences) this.settleIt(fence);
    for (const f of this.fieldScopes) f.plans = this.settlePlans(f, EMPTY_SET, f.env, false, f.sub);
    this.captureAll();
  }

  settleHoist(s) {
    if (s.slots !== undefined) this.mergeSlots(s);
    const program = s === this.program;
    const params = s.implicitIt && s.bareIt ? IT_PARAMS : s.hparams;
    if (!program) {
      for (const p of params) {
        const hit = paramMatchWrite(p);
        if (hit !== null) {
          s.paramErr = this.positioned('emitter: a parameter default cannot write the last-match binding — ' +
            '`_` lives in the enclosing body, which a default cannot reach (move the match into the body)', hit);
          break;
        }
      }
    }
    const exclude = [];
    for (const p of params) {
      try { this.patternNames(p, exclude, true); } catch { /* the parameter walk rejects it */ }
    }
    // The program's targets also name its bindings (result): its copy.
    const targets = program ? new Map(s.targets) : s.targets;
    // An implicit `it` the body assigns is the function's declared binding.
    s.itAssigned = targets.has('it') || s.itUpdated;
    for (const n of exclude) targets.delete(n);
    for (const n of s.hreactive) targets.delete(n);
    // The statement-level declarations: a framed scope's walk noted
    // them; a hoist-only scope's list is read here.
    const declared = s.framed() || program ? (s.declared ?? []) : declaredNames(s.hlist);
    for (const [n] of declared) targets.delete(n);
    if (program) {
      const imports = importedNames(this.rawStmts.filter((st) => isNode(st) && this.isModuleImport(st)));
      // The __DATA__ marker's DATA binds with the imports (the emitter's
      // moduleSeeds).
      if (this.dataLine !== null) imports.push('DATA');
      for (const n of imports) targets.delete(n);
      s.imports = imports;
    }
    for (const n of this.memberNames(s)) targets.delete(n);
    const known = new Set(targets.keys());
    for (const n of exclude) known.add(n);
    for (const n of s.hreactive) known.add(n);
    s.plans = this.settlePlans(s, known, s.env, program, s.sub);
    if (s.chains.length === 0) s.chains = EMPTY_ARRAY;

    const entries = this.hoisted(targets, s.env, s.matchWrite, program);
    s.entries = entries.length === 0 ? EMPTY_ARRAY : entries;
    const names = new Set(entries.map(([n]) => n));
    if (program) for (const n of s.imports) names.add(n);
    else for (const n of exclude) names.add(n);
    if (s.framed()) {
      for (const n of s.reactive.keys()) names.add(n);
      for (const n of s.handles.keys()) names.add(n);
      for (const n of s.readonly.keys()) names.add(n);
    }
    s.names = names;
    if (!program) s.targets = null;
    s.planSites = null;
    // The scope's TS-face hoist annotations: its walk's, then the bare
    // typed forwards its statement list erases.
    if (this.face === 'ts' && !s.sub && (s.ann !== null || s.fwd !== null)) {
      const ann = new Map(s.ann ?? EMPTY_MAP);
      if (s.fwd !== null) for (const [n, node] of s.fwd) if (!ann.has(n)) ann.set(n, node);
      s.annotations = ann;
    } else s.annotations = EMPTY_MAP;
  }

  // The targets a scope declares, by name: those no enclosing scope binds.
  // Every invocation owns its last match, so a match write's `_` hoists
  // under an outer `_`. A compound write to an enclosing exported const
  // mints no local: the shadow would be read before its first write.
  hoisted(targets, env, matchWrite, program) {
    const entries = [];
    for (const [n, node] of [...targets].sort(([x], [y]) => byName(x, y))) {
      if (!program && isNode(node) && COMPOUND_ASSIGNS.has(headOf(node)) && wordOf(node[2]) === n && this.exportedConst(n, env)) continue;
      if (this.inScope(n, env) && !(n === '_' && matchWrite)) continue;
      entries.push([n, node]);
    }
    return entries;
  }

  // `_init` hoists its initializers' slots in the emitter's order.
  mergeSlots(s) {
    for (const slot of s.slots) {
      for (const [n, node] of slot.targets) if (!s.targets.has(n)) s.targets.set(n, node);
      for (const n of slot.hreactive) s.hreactive.add(n);
      if (slot.matchWrite) s.matchWrite = true;
      if (slot.itUpdated) s.itUpdated = true;
      for (const x of slot.chains) s.chains.push(x);
      for (const x of slot.planSites) s.planSites.push(x);
      if (slot.ann !== null) {
        s.ann ??= new Map();
        for (const [n, node] of slot.ann) if (!s.ann.has(n)) s.ann.set(n, node);
      }
      if (slot.forwards !== null) (s.forwards ??= []).push(...slot.forwards);
      if (s.hoistErr === null) s.hoistErr = slot.hoistErr;
    }
  }

  // The hoist of a state initializer's HMR thunk, which re-runs it alone:
  // its own targets, and `_init`'s plans for the sites `_init` planned.
  slotFacts(slot) {
    const init = slot.scope;
    const targets = new Map(slot.targets);
    for (const n of slot.hreactive) targets.delete(n);
    for (const n of this.memberNames(init)) targets.delete(n);
    const known = new Set(targets.keys());
    for (const n of slot.hreactive) known.add(n);
    const planned = new Map(init.plans.map((p) => [p.node, p]));
    const fresh = new Map(this.settlePlans({ planSites: slot.planSites.filter((site) => !planned.has(site.node)) }, known, init.env, false, init.sub)
      .map((p) => [p.node, p]));
    const plans = [];
    for (const site of slot.planSites) {
      const p = planned.get(site.node) ?? fresh.get(site.node);
      if (p !== undefined) plans.push(p);
    }
    const ann = this.face === 'ts' && !init.sub && slot.ann !== null ? slot.ann : EMPTY_MAP;
    return new HoistFacts({
      owner: init.owner, list: [slot.value], first: slot.value, entries: this.hoisted(targets, init.env, slot.matchWrite, false),
      declareInPlace: false, annotations: ann, forwards: slot.forwards ?? EMPTY_ARRAY, chains: slot.chains, plans,
    });
  }

  // The component members an enclosing component binds, which a scope
  // never hoists. A schema body's sub-emitter knows only its own.
  memberNames(s) {
    const out = [];
    if (s.subRoot) return out;
    for (let f = s.env; f !== null; f = f.next) {
      if (f.members !== undefined) for (const n of f.members) out.push(n);
      else if (f.scope !== undefined && f.scope.subRoot) break;
    }
    return out;
  }

  // Each plan site's verdict: the parts of its target that are not
  // repeat-safe capture. The program's are decided before any scope
  // exists (`pre`): only its own names, literal spellings and the REPL's
  // ambient seed are safe.
  settlePlans(s, known, env, pre, sub) {
    if (s.planSites.length === 0) return EMPTY_ARRAY;
    const plans = [];
    for (const site of s.planSites) {
      const safe = (x) => {
        const w = wordOf(x);
        if (w === undefined) return false;
        return this.repeatSafe(w, site.extra, env, pre, sub) || known.has(w);
      };
      const target = site.node[2];
      const recv = site.optLink !== null && !safe(site.optLink[2]);
      let obj = false;
      let key = false;
      if (site.synth) {
        // The final link's object: the receiver's temp when the optional
        // link is the final link and captured.
        const objE = site.optLink === target && recv ? null : target[2];
        if (objE !== null && !(wordOf(objE) !== undefined && safe(objE))) obj = true;
        if ((target[0] === '[]' || target[0] === 'optindex') && !safe(target[3])) key = true;
      }
      if (recv || obj || key) plans.push({ node: site.node, recv, obj, key });
    }
    return plans;
  }

  // A function that takes parameters and reads a bare `it` no binding
  // inside it answers: a scope around it declares `it`, or the read
  // rejects at its nearest node with a NodeStore row. A parameter
  // default runs before the body, so the function's own declarations
  // answer it only through a parameter named `it`.
  settleIt(fence) {
    const scope = fence.scope;
    if (fence.render) {
      // The first read its own sink's locals and loop variables leave
      // unanswered, unless a scope around the render declares `it`. A
      // read under an enclosing sink's local `it` is the emitter's
      // render-local rejection, which analysis does not model.
      let hit = null;
      for (let i = 0; i < fence.hits.length && hit === null; i += 2) {
        const sink = fence.hits[i + 1];
        if (sink !== null && sink.bound.has('it')) continue;
        for (let p = sink?.parent; p != null; p = p.parent) if (p.locals.has('it')) return;
        hit = fence.hits[i];
      }
      if (hit === null || this.declaresIt(fence.env, fence.sub, null)) return;
      fence.hit = hit;
    } else if (scope === null) {
      if (this.declaresIt(fence.env, fence.sub, fence.rsink)) return;
    } else {
      const outer = scope.env ?? fence.env;
      if (fence.hitParam
        ? this.paramsNameIt(fence.params) || this.declaresIt(outer, fence.sub, fence.rsink)
        : this.declaresIt({ scope, next: outer }, fence.sub, fence.rsink)) return;
    }
    let anchor = null;
    const find = (x, at) => {
      if (x === fence.hit) { anchor = at; return true; }
      if (!Array.isArray(x) || wordOf(x) !== undefined) return false;
      const here = this.idOf(x) !== null ? x : at;
      // A comprehension's guard positions at the comprehension, not at
      // the clause that holds it.
      if (x[0] === 'comprehension' && isNode(x) && !isNone(x[3][5]) && find(x[3][5], here)) return true;
      for (const el of x) if (find(el, here)) return true;
      return false;
    };
    const fn = fence.fn;
    if (fn === null) { for (const s of fence.stmts) if (find(s, fence.root ?? null)) break; }
    else if (fn[0] === 'def') { if (!find(fn[3], fn)) find(fn[4], fn); }
    else if (!find(fn[2], fn)) find(fn[3], fn);
    const span = (anchor === null ? null : bareItSpan(this.stores, this.source, this.idOf(anchor))) ?? fence.span ?? null;
    const err = new Error(UNBOUND_IT);
    if (span !== null) { err.start = span[0]; err.end = span[1]; }
    if (scope !== null) { scope.itErr = err; return; }
    // A body emitted inline rejects where it emits: after the scopes
    // opened before it.
    const points = this.pointErrs;
    let i = points.length;
    while (i > 0 && points[i - 1].at > fence.at) i--;
    points.splice(i, 0, { at: fence.at, err });
  }

  // Does a parameter name `it`? (A pattern the parameter walk rejects
  // names nothing here.)
  paramsNameIt(params) {
    try {
      const names = [];
      for (const p of params) this.patternNames(p, names, true);
      return names.includes('it');
    } catch {
      return false;
    }
  }

  // Does the nearest scope around `env` that binds `it` declare it? A
  // parameterless function's implicit `it` the body never assigns is no
  // declaration, and it shadows every `it` outside it. A render
  // factory's locals and loop variables (`rsink`) declare, at the env
  // their render child stands in.
  declaresIt(env, sub, rsink = null) {
    for (let f = env; f !== null; f = f.next) {
      if (rsink !== null && f === rsink.env && rsink.sink.bound.has('it')) return true;
      if (f.scope !== undefined) {
        const sc = f.scope;
        if (sc.framed() && sc.reactive.has('it')) return true;
        if (sc.implicitIt && sc.bareIt) return sc.itAssigned;
        if (sc.names.has('it')) return true;
        if (sc.framed() && sc.declares('it')) return true;
      } else if (f.block !== undefined) {
        if (f.block.has('it')) return true;
      } else if (f.members !== undefined) {
        if (f.members.has('it')) return true;
      } else if (f.ambient.has('it')) return true;
    }
    if (rsink !== null && rsink.env === null && rsink.sink.bound.has('it')) return true;
    return !sub && this.moduleBound().has('it');
  }

  // The emitter's repeatSafeValue over this pass's environment model.
  repeatSafe(w, extra, env, pre, sub) {
    const safety = wordSafety(w);
    if (safety !== null) return safety;
    for (let e = extra; e !== null; e = e.next) if (e.names.has(w)) return true;
    if (pre) return this.ambientFrame?.ambient.has(w) ?? false;
    return this.lexicallyBound(w, env, sub);
  }

  // A name the environment binds: a scope's names or frame, a loop's or
  // handler's binding, a component member, an ambient seed, or (outside
  // a schema body) a module-level binding.
  lexicallyBound(name, env, sub) {
    for (let f = env; f !== null; f = f.next) {
      if (f.scope !== undefined) {
        const sc = f.scope;
        if (sc.names.has(name)) return true;
        if (sc.framed() && (sc.reactive.has(name) || sc.declares(name))) return true;
      } else if (f.block !== undefined) {
        if (f.block.has(name)) return true;
      } else if (f.members !== undefined) {
        if (f.members.has(name)) return true;
      } else if (f.ambient.has(name)) return true;
    }
    return !sub && this.moduleBound().has(name);
  }

  inScope(name, env) {
    for (let f = env; f !== null; f = f.next) {
      if (f.scope !== undefined) { if (f.scope.names.has(name)) return true; }
      else if (f.block !== undefined) { if (f.block.has(name)) return true; }
      else if (f.ambient !== undefined && f.ambient.has(name)) return true;
    }
    return false;
  }

  // Does `name` resolve to an enclosing exported const? The nearest
  // frame that binds it answers.
  exportedConst(name, env) {
    for (let f = env; f !== null; f = f.next) {
      if (f.scope !== undefined) {
        const sc = f.scope;
        if (sc.framed()) {
          if (sc.reactive.has(name)) return false;
          if (sc.exportedConst.has(name)) return true;
          if (sc.names.has(name) || sc.declares(name) || sc.handles.has(name) || sc.readonly.has(name)) return false;
        } else if (sc.names.has(name)) return false;
      } else if (f.block !== undefined) {
        if (f.block.has(name)) return false;
      } else if (f.members !== undefined) {
        if (f.members.has(name)) return false;
      } else if (f.ambient.has(name)) return false;
    }
    return false;
  }

  // The program's module-level bindings: its top-level writes, classes
  // and defs, bare and exported.
  moduleBound() {
    if (this.modBound !== null) return this.modBound;
    const names = new Set();
    const note = (spec) => {
      if (!isNode(spec)) return;
      const hv = headOf(spec);
      if (ASSIGNS.has(hv) && spec.length === 4 && wordOf(spec[2]) !== undefined) names.add(wordOf(spec[2]));
      else if (hv === 'class' && wordOf(spec[2]) !== undefined) names.add(wordOf(spec[2]));
      else if ((hv === 'def' || hv === 'void-def') && wordOf(spec[2]) !== undefined) names.add(wordOf(spec[2]));
    };
    for (const st of this.program.body) {
      if (isNode(st) && st[0] === 'export') note(st[2]);
      else note(st);
    }
    this.modBound = names;
    return names;
  }

  // ── the execution-order walk ───────────────────────────────────────
  // One walk over every tree in the emitter's element order (values
  // before the targets they write, nested functions included): each
  // declare-in-place scope's facts for its own targets, and every
  // node's predicate bits.
  //
  // The walk keeps a stack of statement FRAMES: a declare-in-place
  // scope's statement list, and below it each block the emitter lays
  // out as a braced JavaScript block of statements in place.
  // A frame's `cur` is the statement being walked, which is how a node
  // knows it stands in statement position.
  captureAll() {
    this.interest = new Map();
    this.capAt = new Map();
    this.cdepth = 0;
    this.defAt = [];
    this.frame = null;
    this.lazy = 0;
    this.annotates = this.source !== null;
    const records = [];
    for (const s of this.hscopes) {
      if (!s.declareInPlace || s.entries.length === 0) continue;
      const names = s.entries.map(([n]) => n);
      // The scan records identifiers alone: a literal a pattern spells
      // as a target has no facts.
      const rec = { scope: s, names, watched: names.filter((n) => isIdentifierName(n)), facts: new Map(), forwards: null, depth: 0, lazy: 0, muted: false };
      records.push(rec);
      if (s !== this.program && !s.subRoot) this.capAt.set(s.capKey, rec);
      s.capture = rec;
    }
    const program = this.program;
    // A REPL entry's bindings are saved after its code, at the entry's
    // top level, so none may declare inside a nested block.
    if (program.capture !== undefined) {
      this.activate(program.capture);
      this.frame = scopeFrame(program.capture, !this.repl, null, false);
    }
    for (const st of this.rawStmts) {
      if (this.frame !== null) this.frame.cur = st;
      this.cw(st);
    }
    if (program.capture !== undefined) this.deactivate(program.capture);
    this.frame = null;
    // Each schema callable body is its own tree; its sub-emitter has no
    // source text, so no annotation reaches the scan.
    this.annotates = false;
    for (const s of this.hscopes) {
      if (!s.subRoot) continue;
      const rec = s.capture;
      if (rec !== undefined) {
        this.activate(rec);
        this.frame = scopeFrame(rec, false, null, false);
      }
      for (const st of s.hlist) {
        if (this.frame !== null) this.frame.cur = st;
        this.cw(st);
      }
      if (rec !== undefined) this.deactivate(rec);
      this.frame = null;
    }
    for (const rec of records) this.inPlace(rec);
  }

  activate(rec) {
    rec.depth = this.cdepth;
    rec.lazy = this.lazy;
    for (const n of rec.watched) {
      const list = this.interest.get(n);
      if (list === undefined) this.interest.set(n, [rec]);
      else list.push(rec);
    }
  }

  deactivate(rec) {
    for (const n of rec.watched) this.interest.get(n).pop();
  }

  // How deep below a record's own statements the walk is: 0 at them, 1
  // inside a function, class or component, 2 inside a def.
  level(rec) {
    if (this.cdepth === rec.depth) return 0;
    const d = this.defAt.length;
    return d !== 0 && this.defAt[d - 1] >= rec.depth ? 2 : 1;
  }

  occur(name, write = false, declaring = false, node = null, writeNode = null, path = '') {
    const list = this.interest.get(name);
    if (list === undefined || list.length === 0) return;
    for (const rec of list) {
      if (rec.muted) continue;
      const lvl = this.level(rec);
      let f = rec.facts.get(name);
      if (f === undefined) f = this.newFacts(rec, name);
      const fr = this.frame;
      if (!f.seen) {
        f.seen = true;
        if (declaring && lvl === 0 && fr !== null && fr.owner === rec && node === fr.cur) {
          f.decl = node;
          f.block = fr;
        }
      } else if (f.decl !== null && !f.block.scope && f.inside) {
        // A write declaring in a nested block needs every later
        // occurrence inside that block, and notes whether one sits in a
        // function or a reactive body.
        let p = fr;
        while (p !== null && p !== f.block) p = p.parent;
        if (p === null) f.inside = false;
        else if (lvl > 0 || this.lazy > rec.lazy) f.closure = true;
      }
      if (write && f.firstWrite === null && writeNode !== null) {
        f.firstWrite = writeNode;
        f.firstWritePath = path;
      }
      if (lvl > 0) {
        f.nested = true;
        if (write) f.nestedWrite = true;
        if (lvl === 2) f.inDef = true;
      }
    }
  }

  newFacts(rec, name) {
    const f = { decl: null, block: null, inside: true, closure: false, declared: false, seen: false, nested: false, nestedWrite: false, inDef: false, annotated: rec.forwards?.get(name) ?? null, firstWrite: null, firstWritePath: '', inPlace: false };
    rec.facts.set(name, f);
    return f;
  }

  // A def's or a class's own name: no occurrence, but a declaration of
  // the name in whatever block holds it, beside which a `let` of the
  // same name cannot stand.
  declared(name) {
    const list = this.interest.get(name);
    if (list === undefined) return;
    for (const rec of list) {
      if (rec.muted) continue;
      (rec.facts.get(name) ?? this.newFacts(rec, name)).declared = true;
    }
  }

  // The first annotation of a name. A bare typed forward met before the
  // name's first occurrence is invisible to the occurrence rules, but
  // its annotation is the name's wherever the name's facts begin.
  annotate(name, node) {
    const list = this.interest.get(name);
    if (list === undefined) return;
    for (const rec of list) {
      if (rec.muted) continue;
      const f = rec.facts.get(name);
      if (f !== undefined) { if (f.annotated === null) f.annotated = node; }
      else if (rec.forwards === null) rec.forwards = new Map([[name, node]]);
      else if (!rec.forwards.has(name)) rec.forwards.set(name, node);
    }
  }

  // A word: an occurrence, and its predicate bits.
  cword(w) {
    if (this.interest.size !== 0) this.occur(w);
    return w === 'it' ? P_IT : (w === 'break' || w === 'continue') ? P_CTRL : 0;
  }

  // Enter or leave a function-like construct's parts: one level down,
  // a def's marking the levels below it 2.
  down(def) {
    if (def) this.defAt.push(this.cdepth);
    this.cdepth++;
  }

  up(def) {
    this.cdepth--;
    if (def) this.defAt.pop();
  }

  cw(x) {
    if (typeof x === 'string') return this.cword(x);
    if (!Array.isArray(x)) return 0;
    if (!isNode(x)) return this.cwList(x);
    return this.keep(x, this.cwNode(x));
  }

  // A node's bits, held by its id.
  keep(x, bits) {
    if (bits !== 0) {
      const id = this.stores.idOf(x);
      if (id !== null) this.setBits(id, bits);
    }
    return bits;
  }

  setBits(id, bits) {
    const p = this.preds;
    if (id < p.length) p[id] = bits;
    else (this.predsFar ??= new Map()).set(id, bits);
  }

  // A function-like body: a declare-in-place scope's statements when it
  // is one.
  cwBody(x) {
    if (this.capAt.size !== 0 && isNode(x)) {
      const rec = this.capAt.get(x);
      if (rec !== undefined) return this.keep(x, this.cwScope(x, rec));
    }
    return this.cw(x);
  }

  // An effect's body: a scope's statements, or a component effect's
  // one statement.
  cwEffectBody(x) {
    if (this.capAt.size !== 0 && isNode(x)) {
      const rec = this.capAt.get(x);
      if (rec !== undefined) return this.keep(x, this.cwScope(x, rec));
      if (x[0] === 'block' && x.length === 3 && this.capAt.has(x[2])) return this.keep(x, this.cwBody(x[2]));
    }
    return this.cw(x);
  }

  // A plumbing list: its elements, read generically, the first
  // included.
  cwList(x) {
    let bits = 0;
    for (let i = 0; i < x.length; i++) bits |= this.cw(x[i]);
    return bits;
  }

  // A scope's statements: the record watches them while they walk.
  cwScope(x, rec) {
    let bits = 0;
    const block = isNode(x) && x[0] === 'block';
    this.activate(rec);
    const outer = this.frame;
    // A single-statement body may inline as an expression, so only a
    // body of two statements or more lays its tail out as statements.
    const fr = this.frame = scopeFrame(rec, block, outer, block && liveCount(x) >= 2);
    if (block) {
      fr.tail = lastLive(x);
      for (let i = 2; i < x.length; i++) {
        const st = x[i];
        fr.cur = st;
        rec.muted = rec.scope.live && isErased(st);
        bits |= this.cw(st);
        rec.muted = false;
      }
    } else {
      fr.cur = x;
      bits = this.cwNode(x);
    }
    this.frame = outer;
    this.deactivate(rec);
    return bits;
  }

  // A statement-position construct whose blocks the emitter lays out as
  // braced statements in place opens a frame for each; -1 declines, and
  // the construct walks as any node. `fr` is the frame the construct is
  // a statement of. At the tail of a function body a construct returns
  // its value, so it lays out in place only in the shapes implicitReturn
  // keeps as statements, and its blocks' own tails return (or collect,
  // under a returning loop) in turn; a collecting tail lays out nothing
  // in place.
  cwStmt(x, h, fr) {
    let ctx = 'plain';
    if (x === fr.tail && fr.flavor !== 'plain') {
      if (fr.flavor === 'collect' || !fr.tailOk) return -1;
      ctx = 'return';
    }
    switch (h) {
      case 'if': {
        if (x.length !== 5 || !isBlock(x[3])) return -1;
        if (ctx === 'return' && ifIsSimple(x)) return -1;
        return this.cwIfStmt(x, ctx);
      }
      case 'while': {
        if (x.length !== 5 || !isBlock(x[4])) return -1;
        let bits = this.cw(x[2]);
        if (!isNone(x[3])) bits |= this.cw(x[3]);
        return bits | this.cwFrame(x[4], 'plain', true);
      }
      case 'loop': {
        if (x.length !== 7 || !isBlock(x[6])) return -1;
        let flavor = 'plain';
        if (ctx === 'return') {
          if (isSourceLoop(x)) flavor = 'collect';
          else if (x[1].over !== 'forever') return -1;
        }
        return this.cwLoop(x, false, flavor);
      }
      case 'try': {
        let bits = isBlock(x[2]) ? this.cwFrame(x[2], ctx, false) : this.cw(x[2]);
        if (!isNone(x[3])) {
          const handler = x[3];
          if (!isNone(handler[2])) bits |= this.cw(handler[2]);
          bits |= isBlock(handler[3]) ? this.cwFrame(handler[3], ctx, false) : this.cw(handler[3]);
        }
        if (!isNone(x[4])) bits |= isBlock(x[4]) ? this.cwFrame(x[4], 'plain', false) : this.cw(x[4]);
        return bits;
      }
      case 'switch': {
        if (x.length !== 5 || isNode(x[3]) || !Array.isArray(x[3])) return -1;
        let bits = isNone(x[2]) ? 0 : this.cw(x[2]);
        for (const when of x[3]) {
          if (!isNode(when)) { bits |= this.cw(when); continue; }
          let wb = 0;
          for (let i = 2; i < when.length; i++) wb |= i === 3 && isBlock(when[i]) ? this.cwFrame(when[i], ctx, false) : this.cw(when[i]);
          bits |= this.keep(when, wb);
        }
        if (!isNone(x[4])) bits |= isBlock(x[4]) ? this.cwFrame(x[4], ctx, false) : this.cw(x[4]);
        return bits;
      }
      case 'block': return ctx === 'plain' ? this.cwFrame(x, 'plain', false) : -1;
    }
    return -1;
  }

  // An if-statement and its else-if chain: each arm a frame.
  cwIfStmt(x, ctx) {
    let bits = this.cw(x[2]) | this.cwFrame(x[3], ctx, false);
    const rest = x[4];
    if (isNone(rest)) return bits;
    if (isIf(rest) && isBlock(rest[3])) return bits | this.keep(rest, this.cwIfStmt(rest, ctx));
    return bits | (isBlock(rest) ? this.cwFrame(rest, ctx, false) : this.cw(rest));
  }

  // A braced block of statements laid out in place: its statements walk
  // in a frame below the current one, which a loop body marks.
  cwFrame(block, flavor, loop) {
    const parent = this.frame;
    const fr = this.frame = { owner: parent.owner, scope: false, nest: true, flavor, tailOk: true, loop: loop || parent.loop, cur: null, tail: lastLive(block), parent };
    let bits = 0;
    for (let i = 2; i < block.length; i++) {
      fr.cur = block[i];
      bits |= this.cw(block[i]);
    }
    this.frame = parent;
    return this.keep(block, bits);
  }

  // A node, by the head headOf gives it: the declare-in-place
  // scan's rules by head, and the predicates' stops (a function or def
  // stops them all; a class lets await and yield through its parent
  // alone and bare `it` through everything; an effect stops await).
  cwNode(x) {
    const h = x[0];
    if (x.length === 3 && LEAF_KINDS.has(h)) return this.cword(h === 'this' ? 'this' : x[2]);
    if (h === 'type' && x.length === 4 && typeof x[2] === 'string') return this.cword(x[2]);
    if (h === 'none') return this.cword('none');
    if (isSymbol(x)) return 0;
    const fr = this.frame;
    if (fr !== null && fr.nest && x === fr.cur && STMT_BLOCK_HEADS.has(h)) {
      const bits = this.cwStmt(x, h, fr);
      if (bits !== -1) return bits;
    }
    const a = x[1];
    if (FUNC_HEADS.has(h)) {
      this.down(false);
      this.cw(x[2]);
      this.cwBody(x[3]);
      this.up(false);
      return 0;
    }
    switch (h) {
      case 'def': {
        if (this.interest.size !== 0) { const n = wordOf(x[2]); if (n !== undefined) this.declared(n); }
        this.down(true);
        this.cw(x[3]);
        this.cwBody(x[4]);
        this.up(true);
        return 0;
      }
      case 'class': return this.cwClass(x);
      case 'component': {
        this.down(false);
        const parent = x[2];
        let bits = !isNone(parent) && wordOf(parent) === undefined ? this.cw(parent) : 0;
        bits |= this.cw(x[3]);
        this.up(false);
        return bits;
      }
      // An effect, a computed and a render check their own bare `it`
      // reads: none reaches the function around them.
      case 'effect': {
        let bits = 0;
        if (!isNone(x[2])) bits |= this.cw(x[2]);
        this.lazy++;
        bits |= this.cwEffectBody(x[3]);
        this.lazy--;
        return (this.isEffectDecl(x) ? bits & ~P_AWAIT : bits) & ~P_IT;
      }
      case 'computed': {
        if (x.length !== 4) break;
        const bits = this.cw(x[2]);
        this.lazy++;
        const body = this.cwBody(x[3]);
        this.lazy--;
        return (bits | body) & ~P_IT;
      }
      case 'render': {
        let bits = 0;
        for (let i = 2; i < x.length; i++) bits |= this.cw(x[i]);
        return bits & ~P_IT;
      }
      case 'typed-var': {
        const w = wordOf(x[2]);
        if (w !== undefined && this.interest.size !== 0) this.annotate(w, x);
        return predicateBits(x);
      }
      case 'call': {
        if (!isAttrs(a)) break;
        let bits = a.await === true ? P_AWAIT : 0;
        for (let i = 2; i < x.length; i++) bits |= this.cw(x[i]);
        return bits;
      }
      case '.': case '?.': {
        if (x.length !== 4) break;
        let bits = this.cw(x[2]);
        const p = wordOf(x[3]);
        if (p === undefined) bits |= this.cw(x[3]);
        else if (p === 'break' || p === 'continue') bits |= P_CTRL;
        return bits;
      }
      case 'object': {
        let bits = 0;
        for (let i = 2; i < x.length; i++) {
          const pair = x[i];
          if (isNode(pair) && headOf(pair) === ':' && pair.length === 4) {
            const k = wordOf(pair[2]);
            if (k === undefined) bits |= this.cw(pair[2]);
            else if (k === 'break' || k === 'continue') bits |= P_CTRL;
            bits |= this.cw(pair[3]);
          } else bits |= this.cw(pair);
        }
        return bits;
      }
      case '++': case '--': {
        if (x.length !== 3) break;
        const w = wordOf(x[2]);
        if (w !== undefined) {
          if (this.interest.size !== 0) this.occur(w, true);
          return w === 'it' ? P_IT : 0;
        }
        return this.cw(x[2]);
      }
      case '=~': case 'regex-index': case '[]': if (isMatchWrite(x)) return this.cwMatch(x); break;
      case 'loop': return this.cwLoop(x, isNone(x[6]));
      case 'comprehension': {
        let bits = this.cw(x[2]);
        const clause = x[3];
        // The clause wrapper and the clause (no guard, no body).
        bits |= this.cwLoop(clause, true);
        // The guard stands in a one-element list.
        if (!isNone(clause[5])) bits |= this.cw(clause[5]);
        return bits;
      }
      case 'try': {
        let bits = this.cw(x[2]);
        if (!isNone(x[3])) {
          // The handler: ["catch", binding|null, body].
          const handler = x[3];
          if (!isNone(handler[2])) bits |= this.cw(handler[2]);
          bits |= this.cw(handler[3]);
        }
        if (!isNone(x[4])) bits |= this.cw(x[4]);
        return bits;
      }
      case 'if': case 'while': case 'switch': case 'return': case 'yield': case 'yield-from': case 'await': case 'throw': case 'accept': case '..': case '...': {
        let bits = h === 'await' ? P_AWAIT : (h === 'yield' || h === 'yield-from') ? P_YIELD : h === 'return' ? P_RETURN | P_CTRL : h === 'throw' ? P_CTRL : 0;
        for (let i = 2; i < x.length; i++) if (!isNone(x[i])) bits |= this.cw(x[i]);
        return bits;
      }
      case 'as': {
        let bits = 0;
        for (let i = 2; i < x.length; i++) if (!isNone(x[i])) bits |= this.cw(x[i]);
        return bits;
      }
      case 'pickitem': {
        // The key and the target are occurrences to the scan, but no
        // bare `it`.
        let bits = (this.cw(x[2]) | this.cw(x[3])) & ~P_IT;
        if (!isNone(x[4])) bits |= this.cw(x[4]);
        return bits;
      }
      case 'schema': return 0;
      case 'import': {
        let bits = 0;
        if (Array.isArray(x[2]) && x[2].length === 0) bits |= this.cword('{}');
        else if (!isNone(x[2])) bits |= this.cw(x[2]);
        for (let i = 3; i < x.length; i++) if (!isNone(x[i])) bits |= this.cw(x[i]);
        return bits;
      }
      case 'export': case 'export-from': {
        let bits = 0;
        if (Array.isArray(x[2]) && x[2].length === 0) bits |= this.cword('{}');
        else bits |= this.cw(x[2]);
        if (h === 'export-from') bits |= this.cw(x[3]);
        return bits;
      }
      case 'export-all': {
        let bits = this.cw(x[2]);
        if (!isNone(x[3])) bits |= this.cw(x[3]);
        return bits;
      }
      case 'array': case 'str': case 'here-regex': {
        let bits = 0;
        const from = h === 'here-regex' ? 3 : 2;
        for (let i = 2; i < x.length; i++) {
          if (i >= from && isNone(x[i])) bits |= this.cword(h === 'array' ? ',' : '');
          else bits |= this.cw(x[i]);
        }
        return bits;
      }
    }
    const hv = headOf(x);
    if (ASSIGNS.has(hv) && x.length === 4) return this.cwAssign(x, hv);
    // Generic: every child; the head is the node's kind, never an
    // occurrence, even where it spells a legal name.
    let bits = 0;
    for (let i = 2; i < x.length; i++) bits |= this.cw(x[i]);
    return bits;
  }

  // A class: its name is no occurrence; its parent and body read one
  // level down, a body def at the class's own level.
  cwClass(x) {
    if (this.interest.size !== 0 && !isNone(x[2])) { const n = wordOf(x[2]); if (n !== undefined) this.declared(n); }
    const parent = isNone(x[3]) ? null : x[3];
    const body = x[4] === undefined || isNone(x[4]) ? null : x[4];
    let pbits = 0;
    let bbits = 0;
    this.down(false);
    if (parent !== null) pbits = this.cw(parent);
    if (body !== null) {
      for (let i = 2; i < body.length; i++) {
        const st = body[i];
        if (isNode(st) && st[0] === 'def') { this.cw(st[3]); this.cwBody(st[4]); continue; }
        bbits |= this.cw(st);
      }
    }
    this.up(false);
    const nameIt = !isNone(x[2]) && wordOf(x[2]) === 'it' ? P_IT : 0;
    return (pbits & (P_AWAIT | P_YIELD | P_IT)) | (bbits & P_IT) | nameIt;
  }

  // A match write: its operands, then `_` written.
  cwMatch(x) {
    let bits = 0;
    for (let i = 2; i < x.length; i++) bits |= this.cw(x[i]);
    if (this.interest.size !== 0) this.occur('_', true);
    return bits;
  }

  // A loop, or a comprehension's clause, in the emitter's element order.
  // `flavor` walks a statement loop's body as a frame of that flavor.
  cwLoop(x, clause, flavor = null) {
    const over = x[1].over;
    const body = () => (flavor === null ? this.cw(x[6]) : this.cwFrame(x[6], flavor, true));
    if (over === 'forever') return body();
    if (over === 'times') return this.cw(x[3]) | body();
    let bits = this.cwList(x[2]) | this.cw(x[3]);
    if (over === 'in' && !isNone(x[4])) bits |= this.cw(x[4]);
    if (over === 'as' && x[1].await === true) bits |= P_AWAIT;
    if (clause) return bits;
    if (!isNone(x[5])) bits |= this.cw(x[5]);
    return bits | body();
  }

  // An assignment: its value before its target, as it executes.
  cwAssign(x, hv) {
    const declaring = hv === '=' || hv === 'void-assign';
    let bits = this.cw(x[3]);
    const target = x[2];
    const tw = wordOf(target);
    const watching = this.interest.size !== 0;
    if (tw !== undefined) {
      if (watching) {
        if (!declaring) this.occur(tw);
        this.occur(tw, true, declaring, x, declaring ? x : null);
        if (declaring && this.annotates && this.interest.get(tw)?.length && this.annotated(x)) this.annotate(tw, x);
      }
      return bits | (tw === 'it' ? P_IT : 0);
    }
    if (hv === '=' && declarablePattern(target)) {
      if (watching) {
        const paths = new Map(patternBindings(target));
        this.walkPattern(target, (bound) => this.occur(bound, true, true, x, paths.has(bound) ? x : null, paths.get(bound) ?? ''));
      }
      return bits | predicateBits(target);
    }
    bits |= this.cw(target);
    if (declaring && watching) for (const [bound, path] of patternBindings(target)) this.occur(bound, true, false, null, x, path);
    return bits;
  }

  // A declarable pattern's elements in evaluation order: a default's
  // value and a computed key read before the element binds.
  walkPattern(p, bind) {
    const element = (el) => {
      const w = wordOf(el);
      if (w !== undefined) { bind(w); return; }
      if (isNone(el)) return;
      const h = headOf(el);
      if (h === '=') { this.cw(el[3]); element(el[2]); return; }
      if (h === '...') { bind(wordOf(el[2])); return; }
      this.walkPattern(el, bind);
    };
    if (p[0] === 'array') { for (let i = 2; i < p.length; i++) element(p[i]); return; }
    for (let i = 2; i < p.length; i++) {
      const pair = p[i];
      const h = headOf(pair);
      if (h === null) bind(wordOf(pair[3]));
      else if (h === '=') { this.cw(pair[3]); bind(wordOf(pair[2])); }
      else if (h === '...') bind(wordOf(pair[2]));
      else if (h === ':') { if (wordOf(pair[2]) === undefined) this.cw(pair[2]); element(pair[3]); }
    }
  }

  // ── declare in place ───────────────────────────────────────────────
  // The scope's targets that declare at their first write: the write is
  // the name's first occurrence, a statement of the scope itself or of a
  // block laid out in place below it, not a tail that returns or
  // collects its value, no guard's write, and no def reads the name. A
  // pattern declares all its names or none, and none when a name it
  // binds is annotated: a pattern cannot carry an element's annotation,
  // so the hoist line carries it.
  //
  // A nested block's `let` is that block's binding, so a write declares
  // there only when every occurrence of the name sits inside the block,
  // after the write. Inside a loop the binding is per-iteration, which a
  // closure would observe, so there no occurrence may sit in a function
  // or a reactive body. A class, component or schema value keeps the
  // hoist: the module-level surfaces that name it (the class repaint,
  // the hmr table, the schema story) are not inside the block.
  inPlace(rec) {
    const s = rec.scope;
    const facts = rec.facts;
    let tail = null;
    if (s.tailExpr) {
      for (let i = s.raw.length - 1; i >= 0; i--) if (!isErased(s.raw[i])) { tail = s.raw[i]; break; }
    }
    const qualifies = (f) => {
      if (f.decl === null || f.inDef) return false;
      const b = f.block;
      if (b.scope) return f.decl !== tail;
      if (!f.inside || f.declared || (b.loop && f.closure) || (b.flavor !== 'plain' && f.decl === b.tail)) return false;
      const v = f.decl[3];
      return !(isNode(v) && (v[0] === 'class' || v[0] === 'component' || v[0] === 'schema'));
    };
    const targets = new Set(rec.names);
    const verdicts = new Map();
    const patternDeclares = (stmt) => {
      let v = verdicts.get(stmt);
      if (v !== undefined) return v;
      let names = [];
      try { names = this.patternNames(stmt[2]); } catch { /* the hoist walk rejects it */ }
      v = names.every((nm) => {
        const ff = facts.get(nm);
        return targets.has(nm) && ff !== undefined && ff.decl === stmt && qualifies(ff) && ff.annotated === null;
      });
      verdicts.set(stmt, v);
      return v;
    };
    for (const n of rec.names) {
      const f = facts.get(n);
      if (f === undefined || !qualifies(f)) continue;
      const hv = headOf(f.decl);
      if ((hv === '=' || hv === 'void-assign') && controlGuard(f.decl[3])) continue;
      if (isPattern(f.decl[2]) && !patternDeclares(f.decl)) continue;
      f.inPlace = true;
    }
    // The kept targets' class bindings and pin candidates.
    const classBindings = [];
    const pinnable = [];
    for (const n of rec.names) {
      const f = facts.get(n);
      if (f !== undefined && f.inPlace) continue;
      const write = f?.firstWrite ?? null;
      const v = write !== null ? write[3] : undefined;
      let componentType = false;
      if (isNode(v)) {
        if (v[0] === 'class' || v[0] === 'component') classBindings.push(n);
        componentType = this.face === 'ts' && !s.sub && this.isComponentDecl(v) && !this.annotated(write, 'typeParams');
      }
      if (f === undefined || !f.nested || f.firstWrite === null) continue;
      if (s.annotations.has(n) || componentType) continue;
      if (s === this.program && this.schemaConsts?.has(n)) continue;
      pinnable.push([n, f.firstWrite, f.firstWritePath]);
    }
    s.classBindings = classBindings.length === 0 ? EMPTY_ARRAY : classBindings;
    s.pinnable = pinnable.length === 0 ? EMPTY_ARRAY : pinnable;
    // Each entry's facts, in entry order.
    s.captures = rec.names.map((n) => facts.get(n) ?? null);
  }

  // ── the result ─────────────────────────────────────────────────────

  // The first rejection the emitter would meet: the delivery walk's
  // schema parameters, the alias-binding walk's patterns, the program
  // hoist, then each scope in emission order (its collectors, then its
  // redeclaration check).
  rejection() {
    if (this.schemaErr !== null) return this.schemaErr;
    if (this.rabErr !== null) return this.rabErr.err;
    const program = this.program;
    if (program.hoistErr !== null) return program.hoistErr;
    const points = this.pointErrs;
    for (let i = 0; i < this.scopes.length; i++) {
      if (points.length !== 0 && points[0].at <= i) return points[0].err;
      const s = this.scopes[i];
      // A scope hoists before it pushes its frame: a parameter's match
      // write, a target that cannot bind.
      if (s !== program && s.hoists) {
        if (s.paramErr !== null) return s.paramErr;
        if (s.hoistErr !== null) return s.hoistErr;
      }
      if (s.framed()) {
        if (s.errReactive !== null) return s.errReactive;
        if (s.errHandle !== null) return s.errHandle;
        if (s.errReadonly !== null) return s.errReadonly;
      }
      if (s.rejection !== null) return s.rejection;
      if (s.itErr !== null) return s.itErr;
    }
    return points.length !== 0 ? points[0].err : null;
  }

  result(ambient) {
    const err = this.rejection();
    if (err !== null) throw err;
    const program = this.program;
    const stmts = this.rawStmts;
    const ambientNames = new Set(ambient.map(({ name }) => name));

    // The program hoist: targets minus the scope's const-bound names,
    // its def/class declarations, its imports and the __DATA__ marker's
    // DATA (the emitter's moduleSeeds, declared ahead of the hoist).
    const hoist = new Map(program.targets);
    for (const n of program.hreactive) hoist.delete(n);
    for (const [n] of declaredNames(stmts)) hoist.delete(n);
    const imports = importedNames(stmts.filter((s) => isNode(s) && this.isModuleImport(s)));
    for (const n of imports) hoist.delete(n);
    const seeds = this.dataLine !== null ? ['DATA'] : EMPTY_ARRAY;
    for (const n of seeds) hoist.delete(n);
    const hoistNames = [...hoist.keys()].sort(byName);

    // The program's own-level classes, defs and plain assignments, bare
    // or exported, in source order: [name, kind, exported].
    const topLevel = [];
    const declare = (s, exported) => {
      if (!isNode(s)) return;
      const hv = headOf(s);
      const kind = hv === 'class' ? 'class' : hv === 'def' || hv === 'void-def' ? 'def' : hv === '=' || hv === 'void-assign' ? 'plain' : null;
      const name = kind === null ? undefined : wordOf(s[2]);
      if (name !== undefined) topLevel.push([name, kind, exported]);
    };
    for (const s of stmts) {
      declare(s, false);
      if (isNode(s) && s[0] === 'export') declare(s[2], true);
    }

    // Every name module-level emission declares: an injected runtime
    // binding of the same name would be a duplicate declaration.
    const bound = new Set(hoistNames);
    for (const n of imports) bound.add(n);
    for (const n of seeds) bound.add(n);
    for (const n of program.reactive.keys()) bound.add(n);
    for (const n of program.handles.keys()) bound.add(n);
    for (const n of program.readonly.keys()) bound.add(n);
    for (const [n] of topLevel) bound.add(n);

    // The binding inventory, each name with its kind (the vocabulary
    // ambientBindings accepts, so a REPL feeds it back as the next line's
    // seed): first classification wins. A plain write to an ambient name
    // binds nothing (it writes the seeded binding), so it stays out:
    // claimed as plain, a seeded state would downgrade on the next line.
    const kinds = new Map();
    const add = (name, kind) => { if (typeof name === 'string' && !kinds.has(name)) kinds.set(name, kind); };
    for (const n of imports) add(n, 'import');
    // The marker declares DATA a plain module binding, written or not.
    for (const n of seeds) add(n, 'plain');
    for (const n of program.reactive.keys()) add(n, program.computed.has(n) ? 'computed' : 'state');
    for (const n of program.handles.keys()) add(n, 'effect');
    for (const n of program.readonly.keys()) add(n, 'readonly');
    for (const [n, k, exported] of topLevel) if (exported || k !== 'plain' || !ambientNames.has(n)) add(n, k);
    for (const n of hoistNames) if (!ambientNames.has(n)) add(n, 'plain');
    const bindings = [...kinds].map(([name, kind]) => ({ name, kind }));

    // Alias bindings: every tree's names in delivery order, then the
    // ambient names.
    const aliasUsed = new Set();
    for (const t of this.trees) {
      for (const n of t.names) aliasUsed.add(n);
      for (const atom of t.atoms) for (const n of this.patternNames(atom, [], true)) aliasUsed.add(n);
    }
    for (const { name } of ambient) aliasUsed.add(name);
    // Every word is an atom; the ambient names join them.
    for (const { name } of ambient) this.flag(name, W_ATOM);
    const words = this.words;

    // The delivery decision.
    const deliveryBound = new Set(bound);
    for (const { name } of ambient) deliveryBound.add(name);
    const runtimes = new Set();
    for (const rt of RUNTIMES) {
      if (rt.trigger !== null && !Object.hasOwn(this.trig, rt.trigger)) {
        throw new Error(`analyze: the runtime '${rt.key}' names the structural trigger '${rt.trigger}', which analysis does not detect`);
      }
      const triggered = rt.trigger !== null && this.trig[rt.trigger];
      if (triggered || rt.names.some((n) => !deliveryBound.has(n) && ((this.words.get(n) ?? 0) & W_FREE) !== 0)) runtimes.add(rt.key);
    }
    for (let grew = true; grew;) {
      grew = false;
      for (const rt of RUNTIMES) {
        if (!runtimes.has(rt.key)) continue;
        for (const dep of runtimeRequires(rt)) if (!runtimes.has(dep)) { runtimes.add(dep); grew = true; }
      }
    }

    const scopes = this.scopes.filter((s) => !s.frameless).map((s) => this.scopeFacts(s));
    return withAtoms(words, {
      bindings,
      bindingNames: [...aliasUsed],
      runtimes,
      bound,
      programHoist: hoistNames.map((n) => [n, this.idOf(hoist.get(n))]),
      typeOnlyImports: this.typeOnlyImports(),
      appAccessors: this.appAccessors(),
      scopes,
      hoists: this.hscopes.map((s) => this.hoistFacts(s)),
      fieldPlans: this.fieldScopes.filter((f) => f.plans.length !== 0).map((f) => ({ value: f.value, plans: f.plans })),
      predicateBits: predicateReader(this.preds, this.predsFar),
    });
  }

  // A hoisting scope's facts: see HoistFacts.
  hoistFacts(s) {
    const scanned = s.capture !== undefined;
    const forwards = s.topForwards === null ? s.forwards : s.forwards === null ? s.topForwards : [...s.topForwards, ...s.forwards];
    const list = s === this.program ? null : s.hlist;
    const first = list === null ? null : list.find((x) => isStruct(x) && this.idOf(x) !== null) ?? null;
    const facts = new HoistFacts({
      owner: s.owner, list, first, key: first === null ? null : this.idOf(first), raw: s.raw, entries: s.entries, matchWrite: s.matchWrite,
      declareInPlace: s.declareInPlace, annotations: s.annotations, forwards: this.face === 'ts' ? forwards ?? EMPTY_ARRAY : EMPTY_ARRAY,
      chains: s.chains, plans: s.plans, facts: scanned ? s.captures : null, classBindings: scanned ? s.classBindings : EMPTY_ARRAY,
      pinnable: scanned ? s.pinnable : EMPTY_ARRAY, itAssigned: s.itAssigned,
    });
    if (s.slots !== undefined) {
      for (const slot of s.slots) if (slot.state) (facts.slots ??= new Map()).set(this.idOf(slot.value), this.slotFacts(slot));
    }
    return facts;
  }

  // A live statement of a scope: its statement-level facts.
  noteStmt(scope, st) {
    if (scope.stmtIds !== null) scope.stmtIds.push(wordOf(st) === undefined ? this.idOf(st) : null);
    if (!isNode(st)) return;
    const h = st[0];
    if (h === 'export') {
      const spec = st[2];
      if (isStruct(spec)) this.noteDeclared(scope, spec);
      if (isNode(spec)) {
        const hv = headOf(spec);
        if ((hv === '=' || hv === 'void-assign') && spec.length === 4 && wordOf(spec[2]) !== undefined) {
          if (scope.exportedConst === EMPTY_MAP) scope.exportedConst = new Map();
          scope.exportedConst.set(wordOf(spec[2]), this.idOf(spec));
        }
      }
    } else if (h === 'import') {
      if (!isNone(st[2]) || !isNone(st[3]) || !isNone(st[4])) {
        if (scope.importSpecs === EMPTY_MAP) scope.importSpecs = new Map();
        importSpecs(st, scope.importSpecs);
      }
    }
    this.noteDeclared(scope, st);
  }

  // A def or class declaration, or a binding of a class or component
  // value, at a scope's own level (a statement, or an exported spec).
  noteDeclared(scope, st) {
    if (!isNode(st)) return;
    const h = st[0];
    if (h !== 'class' && h !== 'def' && h !== '=') return;
    const hv = headOf(st);
    if (hv === 'class' || hv === 'def' || hv === 'void-def') {
      const n = wordOf(st[2]);
      if (n !== undefined) (scope.declared ??= []).push([n, st]);
      return;
    }
    if ((hv !== '=' && hv !== 'void-assign') || st.length !== 4) return;
    const n = wordOf(st[2]);
    const v = st[3];
    if (n !== undefined && isNode(v) && (v[0] === 'class' || v[0] === 'component')) {
      if (scope.classes === EMPTY_MAP) scope.classes = new Map();
      scope.classes.set(n, this.idOf(st));
    }
  }

  scopeFacts(s) {
    let own = EMPTY_MAP;
    if (s.declared !== null || s.handles.size || s.readonly.size) {
      own = new Map();
      if (s.declared !== null) for (const [n, node] of s.declared) own.set(n, this.idOf(node));
      for (const [n, id] of s.handles) own.set(n, id);
      for (const [n, id] of s.readonly) own.set(n, id);
    }
    return {
      owner: s.owner,
      ownerId: this.idOf(s.owner),
      stmtIds: s.stmtIds,
      checkOnly: s.checkOnly,
      reactive: s.reactive,
      computed: s.computed,
      readonly: s.readonly,
      handles: s.handles,
      own,
      classes: s.classes,
      importSpecs: s.importSpecs.size ? s.importSpecs : EMPTY_MAP,
      exportedConst: s.exportedConst,
      decls: s.decls === null ? null : s.decls.size === 0 ? EMPTY_MAP
        : new Map([...s.decls].filter(([, f]) => f.auth).map(([n, f]) => [n, { kind: f.kind, nodeId: this.idOf(f.node) }])),
    };
  }

  // Imported names that appear in type text and nowhere as a value
  // word: the value imports the walk met, against the identifiers of
  // every role span of type text. A name must be USED BY A TYPE to be
  // elided, not merely unused: an import nobody references is dead code,
  // the author's business, and removing it would rewrite the program.
  //
  // Both halves are deliberately conservative, and they fail the same
  // safe way. Every word in the value tree counts as a use, including
  // ones that are not references (a property key sharing the name); and
  // only TYPE_ROLES are read for type text, so a type position that list
  // does not name goes unseen. Either way the name is KEPT, which costs
  // an elision. The opposite — emitting an import of a name the module
  // does not export — is a module that fails to load.
  typeOnlyImports() {
    const out = new Set();
    const unused = this.importBound.filter((n) => ((this.words.get(n) ?? 0) & W_USED) === 0);
    if (unused.length === 0 || !this.source) return out;
    const inTypes = new Set();
    for (const r of this.stores.roles) {
      if (!TYPE_ROLES.has(r.role) || typeof r.sourceStart !== 'number') continue;
      for (const mt of identifierMatches(this.source.slice(r.sourceStart, r.sourceEnd))) inTypes.add(mt[0]);
    }
    for (const name of unused) if (inTypes.has(name)) out.add(name);
    return out;
  }

  // The rip/app accessor bindings: top-level value imports only.
  appAccessors() {
    const acc = { stash: null, router: null };
    for (const x of this.rawStmts) {
      if (!isNode(x) || !this.isModuleImport(x)) continue;
      const from = wordOf(x[5]);
      if (typeof from !== 'string' || from.slice(1, -1) !== 'rip/app') continue;
      const id = this.idOf(x);
      if (id !== null && this.stores.role(id, 'typeOnly') !== null) continue;
      for (const [local, imported] of importBindings(x)) {
        if (imported === 'currentStash') acc.stash = local;
        else if (imported === 'currentRouter') acc.router = local;
      }
    }
    return acc;
  }
}

// A hoisting scope's facts:
//   list, raw        the statement list its hoist reads (null for the
//                    program) and the one its declare-in-place scan reads
//   first, key       the list's first structure with an id, which no other
//                    scope's list holds, and that id: how the emitter finds
//                    the facts
//   entries          [name, declaring node], by name
//   matchWrite       a match write of its own (its `_` hoists)
//   annotations      the TS face's hoist-line annotations, name → node
//   forwards         the TS face's bare typed forwards, whose directives
//                    the hoist line takes: the statement-level ones, then
//                    the nested ones in walk order
//   chains, plans    the temp sites in minting order: chain mid operands,
//                    and reference plans { node, recv, obj, key }
//   facts            for a scope whose scan ran, each entry's scan facts
//                    in entry order ({ decl, nested, nestedWrite, inDef,
//                    annotated, firstWrite, firstWritePath, inPlace }),
//                    null where the scan met no occurrence
//   classBindings    the kept targets whose first write is a class or
//                    component, and pinnable: [name, first write, path]
//   itAssigned       the body writes its implicit `it`
//   slots            a component's `_init`: each state initializer's id →
//                    its HMR thunk's facts
class HoistFacts {
  constructor({ owner, list, first = null, key = null, raw = list, entries, matchWrite = false, declareInPlace, annotations, forwards, chains, plans, facts = null, classBindings = EMPTY_ARRAY, pinnable = EMPTY_ARRAY, itAssigned = false }) {
    this.owner = owner;
    this.list = list;
    this.first = first;
    this.key = key;
    this.raw = raw;
    this.entries = entries;
    this.matchWrite = matchWrite;
    this.declareInPlace = declareInPlace;
    this.annotations = annotations;
    this.forwards = forwards;
    this.chains = chains;
    this.plans = plans;
    this.facts = facts;
    this.classBindings = classBindings;
    this.pinnable = pinnable;
    this.itAssigned = itAssigned;
    this.slots = null;
  }

  // The scan facts by name (null for a scope whose scan did not run),
  // and the targets that declare in place (name → declaring statement).
  get captures() {
    if (this.facts === null) return null;
    return new Map(this.entries.map(([n], i) => [n, this.facts[i] ?? undefined]).filter(([, f]) => f !== undefined));
  }

  get inPlace() {
    const out = new Map();
    if (this.facts !== null) this.entries.forEach(([n], i) => { const f = this.facts[i]; if (f !== null && f.inPlace) out.set(n, f.decl); });
    return out;
  }
}

// The predicate bits a node id holds (0 for none).
function predicateReader(near, far) {
  return (id) => (id < near.length ? near[id] : far?.get(id) ?? 0);
}

// The used-name registry's seed on a result, a fresh set per read (the
// emitter adds the names it mints). Built outside the analysis so the
// result holds the word map alone.
function withAtoms(words, result) {
  Object.defineProperty(result, 'atoms', { enumerable: true, get: () => new Set(words.keys()) });
  return result;
}

function schemaFail(message, at) {
  const err = new Error(`schema: ${message}`);
  err.start = at;
  throw err;
}

// Code-unit order, independent of locale.
const byName = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

// A match write: `=~`, a regex index, an index by a regex spelling.
function isMatchWrite(x) {
  if (!isNode(x)) return false;
  const h = x[0];
  if (h === '=~') return x.length === 4;
  if (h === 'regex-index') return x.length === 5;
  if (h === '[]' && x.length === 4) {
    const k = wordOf(x[3]);
    return typeof k === 'string' && k[0] === '/';
  }
  return false;
}

// The first match write in a parameter, or null; a function or def in
// a default owns its own `_`.
function paramMatchWrite(p) {
  if (!Array.isArray(p) || wordOf(p) !== undefined || isNone(p)) return null;
  if (isFuncNode(p) || (isNode(p) && p[0] === 'def')) return null;
  if (isMatchWrite(p)) return p;
  for (let i = isNode(p) ? 2 : 0; i < p.length; i++) {
    const hit = paramMatchWrite(p[i]);
    if (hit !== null) return hit;
  }
  return null;
}

// A pattern a `let` can spell: plain names, nested patterns, defaults
// on a name, one rest last.
function declarablePattern(p) {
  const leaf = (t) => wordOf(t) !== undefined || isNone(t) || (isNode(t) && headOf(t) === '=' ? leaf(t[2]) : declarablePattern(t));
  if (!isNode(p)) return false;
  if (p[0] === 'array') {
    for (let i = 2; i < p.length; i++) {
      const el = p[i];
      if (isNode(el) && el[0] === '...') {
        if (i !== p.length - 1 || wordOf(el[2]) === undefined) return false;
      } else if (!leaf(el)) return false;
    }
    return true;
  }
  if (p[0] === 'object') {
    for (let i = 2; i < p.length; i++) {
      const pair = p[i];
      if (!isNode(pair)) return false;
      const h = headOf(pair);
      if (h === null) { if (wordOf(pair[3]) === undefined) return false; continue; }
      if (h === '=') { if (wordOf(pair[2]) === undefined) return false; continue; }
      if (h === '...') { if (i !== p.length - 1 || wordOf(pair[2]) === undefined) return false; continue; }
      if (h !== ':' || !leaf(pair[3])) return false;
    }
    return true;
  }
  return false;
}

// The names a pattern binds with the accessor path to each one's value
// (defaults, rests and computed keys excluded: their types are not
// their accessors').
function patternBindings(p, base = '', out = []) {
  if (!isNode(p)) return out;
  if (p[0] === 'object') {
    for (let i = 2; i < p.length; i++) {
      const el = p[i];
      if (!isNode(el) || el.length !== 4) continue;
      const h = headOf(el);
      if (h !== ':' && h !== null) continue;
      const key = wordOf(el[2]);
      if (key === undefined) continue;
      const seg = isIdentifierName(key) ? `.${key}` : `[${key}]`;
      const target = el[3];
      const w = wordOf(target);
      if (w !== undefined) { if (isIdentifierName(w)) out.push([w, base + seg]); } else patternBindings(target, base + seg, out);
    }
    return out;
  }
  if (p[0] === 'array') {
    for (let i = 2; i < p.length; i++) {
      const el = p[i];
      const at = `${base}[${i - 2}]`;
      if (isNode(el) && el[0] === '...') continue;
      if (isNone(el)) continue;
      const w = wordOf(el);
      if (w !== undefined) { if (isIdentifierName(w)) out.push([w, at]); } else patternBindings(el, at, out);
    }
  }
  return out;
}

// A bound (fat-arrow) function: of the two function heads, not `->`.
const isBoundFunc = (x) => isFuncNode(x) && x[0] !== '->';

// Does the emitter's class scan reject this class body before it emits
// a member, in a case whose member is one a bare-`it` or parameter check
// inside the body would otherwise answer first: a second instance
// constructor, a bound (`=>`) method with no constructor, a bound method
// whose key is no name, a bound accessor. The scan's other rejections
// (accessor arity, an awaiting constructor or accessor, a field beside an
// accessor of its name) are not modeled here.
function classRejectsFirst(body) {
  let ctors = 0;
  let bound = false;
  for (let i = 2; i < body.length; i++) {
    const s = body[i];
    if (!isNode(s)) continue;
    if (s[0] === 'call' && s.length === 4 && (wordOf(s[2]) === 'get' || wordOf(s[2]) === 'set') && isNode(s[3]) && s[3][0] === 'object') {
      for (let j = 2; j < s[3].length; j++) if (isNode(s[3][j]) && s[3][j][0] === ':' && isBoundFunc(s[3][j][3])) return true;
      continue;
    }
    const pairs = s[0] === 'object' ? s.slice(2) : s[0] === ':' ? [s] : [];
    for (const pair of pairs) {
      if (!isNode(pair) || pair[0] !== ':' || pair[1].shorthand === true) continue;
      const key = pair[2];
      if (isNode(key) && key[0] === '.' && wordOf(key[2]) === 'this') continue;
      const name = wordOf(key);
      if (name === 'constructor') { ctors++; continue; }
      if (isBoundFunc(pair[3])) {
        if (name === undefined) return true;
        bound = true;
      }
    }
  }
  return ctors > 1 || (bound && ctors === 0);
}

// The predicate bits of a subtree read on its own (no occurrences).
function predicateBits(x) {
  if (typeof x === 'string') return x === 'it' ? P_IT : (x === 'break' || x === 'continue') ? P_CTRL : 0;
  if (!Array.isArray(x)) return 0;
  let bits = 0;
  if (!isNode(x)) {
    for (const el of x) bits |= predicateBits(el);
    return bits;
  }
  const w = wordOf(x);
  if (w !== undefined) return predicateBits(w);
  if (isNone(x) || isSymbol(x)) return 0;
  const h = x[0];
  if (FUNC_HEADS.has(h) || h === 'def') return 0;
  if (h === 'class') {
    const parent = isNone(x[3]) ? 0 : predicateBits(x[3]);
    const body = x[4] === undefined || isNone(x[4]) ? 0 : predicateBits(x[4]);
    return (parent & (P_AWAIT | P_YIELD | P_IT)) | (body & P_IT);
  }
  if (h === 'await' || (h === 'call' && x[1].await === true) || (h === 'loop' && x[1].over === 'as' && x[1].await === true)) bits |= P_AWAIT;
  if (h === 'yield' || h === 'yield-from') bits |= P_YIELD;
  if (h === 'return') bits |= P_RETURN | P_CTRL;
  if (h === 'throw') bits |= P_CTRL;
  const member = (h === '.' || h === '?.') && x.length === 4;
  for (let i = 2; i < x.length; i++) {
    const el = x[i];
    if (member && i === 3 && wordOf(el) !== undefined) { bits |= predicateBits(wordOf(el)) & P_CTRL; continue; }
    bits |= predicateBits(el);
  }
  return bits;
}

// Whole statements that compile to nothing: type declarations, bare
// typed forwards, overload signatures.
function isErased(s) {
  if (!isNode(s)) return false;
  return s[0] === 'type-decl' || (s[0] === 'typed-var' && s.length === 4) || s[0] === 'def-sig';
}

// A block's live statements: its last, and how many.
function lastLive(block) {
  for (let i = block.length - 1; i >= 2; i--) if (!isErased(block[i])) return block[i];
  return null;
}

function liveCount(block) {
  let n = 0;
  for (let i = 2; i < block.length; i++) if (!isErased(block[i])) n++;
  return n;
}

// The frame of a declare-in-place scope's own statements. `nest` says
// whether blocks below it may open frames; a scope whose tail returns
// its value lays that tail out in place only when `tailOk`.
function scopeFrame(rec, nest, parent, tailOk) {
  return { owner: rec, scope: true, nest, flavor: rec.scope.tailExpr ? 'return' : 'plain', tailOk, loop: false, cur: null, tail: null, parent };
}

// Each imported local with the module and the name it came from.
function importSpecs(x, specs) {
  const src = wordOf(x[5]);
  if (typeof src !== 'string') return;
  const specifier = bareSpecifier(src);
  for (const [local, importedName] of importBindings(x)) specs.set(local, { specifier, importedName });
}

// The def and class names a statement list declares at its own level,
// each [name, declaring node].
function declaredNames(stmts) {
  const names = [];
  const declared = (s) => {
    if (!isNode(s)) return;
    const hv = headOf(s);
    const n = hv === 'class' || hv === 'def' || hv === 'void-def' ? wordOf(s[2]) : undefined;
    if (n !== undefined) names.push([n, s]);
  };
  for (const s of stmts) {
    declared(s);
    if (isNode(s) && s[0] === 'export' && isStruct(s[2])) declared(s[2]);
  }
  return names;
}

// A dot chain's tag and static classes (the render lowering's reading
// of `div.card#main`); tag null when the chain is not one.
function templateTag(x) {
  const classes = [];
  let cur = x;
  while (isNode(cur) && cur[0] === '.' && cur.length === 4) {
    const w = wordOf(cur[3]);
    if (w === undefined) return { tag: null, classes };
    classes.unshift(w);
    cur = cur[2];
  }
  const t = wordOf(cur);
  if (t === undefined) return { tag: null, classes };
  const [tag] = t.split('#');
  return { tag: tag || 'div', classes: classes.map((c) => (c.includes('#') ? c.slice(0, c.indexOf('#')) : c)).filter((c) => c !== '') };
}

// A member path whose last segment names a component (`ui.Button`):
// property access only, rooted at an identifier other than `this`.
function componentPathOf(x) {
  if (!isNode(x) || x[0] !== '.' || x.length !== 4) return false;
  if (!isComponentName(wordOf(x[3]))) return false;
  let cur = x;
  while (isNode(cur) && cur[0] === '.' && cur.length === 4) {
    if (wordOf(cur[3]) === undefined) return false;
    cur = cur[2];
  }
  const root = wordOf(cur);
  return typeof root === 'string' && root !== 'this' && isIdentifierName(root);
}
