// The emitter's analysis pass: ONE walk over the parser's tree that
// gathers every fact emission reads before it writes a byte. It reads
// the parser's own shapes (src/grammar/grammar.rip `kinds`) and never
// the converted tree the v1 emitter reads.
//
// The walk runs several consumers at once. Each one has its own notion
// of where a scope ends, and the boundary rules differ by consumer: the
// frame collectors stop at a class, the program-scope hoist walks a
// class's field values, the redeclaration check walks a try's handlers
// before its body. `visit` carries one mode word (bits below) plus the
// collector and redeclaration scopes, and each node kind's handler
// states, per child, what every consumer sees. A consumer's boundary
// rule is a row of that dispatch, never a walk of its own.
//
// Facts:
//   bindings, bindingNames   the emit record's binding inventory and the
//                            source bindings runtime aliases dodge
//   runtimes                 the delivery decision, dependencies closed
//   bound                    the program-scope names (programScopeNames)
//   programHoist             the program scope's hoisted targets,
//                            name → declaring node id
//   typeOnlyImports          imported names used only in type text
//   appAccessors             the rip/app accessor bindings
//   isAtom / atoms           every string the trees spell, the seed of
//                            the used-name registry
//   schemaBodies             the schema callable bodies, each walked as
//                            its own delivery tree
//   scopes                   per function-like scope: the frame sets and
//                            the authoritative declarations
// A program the emitter must reject throws here with the emitter's
// message and span: a redeclaration, a block-nested declaration, a
// destructuring target that cannot bind.

import { Stores } from '../stores.js';
import { isAttrs, LEAF_KINDS } from '../sexpr.js';
import { schemaCodeSites, paramsOf } from '../schema.js';
import { identifierMatches, isCustomElementName, isIdentifierName } from '../ident.js';
import { TEMPLATE_TAGS } from '../dom.js';
import { isComponentName } from '../render.js';
import { RUNTIMES, runtimeRequires, bareSpecifier } from './runtimes.js';

// ── the mode word ────────────────────────────────────────────────────
// RN: the free-reference walk's position (off, expression, binding
// pattern, render statement).
const RN = 3, RN_EXPR = 1, RN_PAT = 2, RN_RENDER = 3;
const USED = 4;        // the type-only-import use walk (main tree only)
const HOIST = 8;       // the program-scope hoist walk
const HMATCH = 16;     // the hoist walk's match-write-only scan
const CNEST = 32;      // the frame collectors' block nesting
const RNEST = 64;      // the redeclaration walk's block nesting
const NORAB = 128;     // outside the alias-binding walk
const NOIT = 256;      // a string the bare-`it` scan skips
const RNONLY = 512;    // a second reading for the free-reference walk alone

// Statement heads (the emitter's spelling) whose bodies are block-
// nested for the frame collectors and the redeclaration walk.
const BLOCK_HEADS = new Set(['if', 'while', 'loop', 'for-in', 'for-of', 'for-as', 'switch', 'when', 'try', 'block', 'comprehension']);
// The assignment heads the scope walks treat as writes (the two
// synthesized compounds are absent: every walk reads them generically).
const ASSIGNS = new Set(['=', 'void-assign', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=', '<<=', '>>=', '>>>=', '&=', '^=', '|=']);
const PATTERN_LITERALS = new Set(['true', 'false', 'null', 'undefined', 'this']);
const CALL_KINDS = new Set(['call', 'optcall', 'super', 'dammit', 'maybe-dammit', 'tagged', 'dynimport']);
// The roles whose span is type text.
const TYPE_ROLES = new Set(['annotation', 'returnType', 'typeParams', 'declaration']);
// The assignment heads that bind or update a render local.
const RENDER_BINDING_HEADS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=']);
const AMBIENT_KINDS = new Set(['plain', 'state', 'computed', 'effect', 'readonly', 'import', 'class', 'def']);

// A word's flags in Analysis.words: every word spelled is an atom; a
// word in a use position, a use; a word read as a free reference, free.
const W_ATOM = 1, W_USED = 2, W_FREE = 4;

// The shared empty collections a scope holds until it records something.
const EMPTY_MAP = Object.freeze(new Map());
const EMPTY_SET = Object.freeze(new Set());

const isHtmlTag = (name) => {
  const tag = String(name).split('#')[0];
  return TEMPLATE_TAGS.has(tag) || isCustomElementName(tag);
};
const isTagWord = (w) => typeof w === 'string' && isHtmlTag(w.split('#')[0]);

// ── reading the parser's tree ────────────────────────────────────────
// A node: [head, attrs, ...children]. A leaf ([kind, {}, raw]), a type
// value (["type", {}, raw, body]) and a bare literal slot ("this",
// "super", "default", "*") each read as one word, the string the
// emitter's tree holds in that place. Anything else that is an array
// is a plumbing list.
const isNodeP = (x) => Array.isArray(x) && typeof x[0] === 'string' && isAttrs(x[1]);
const isNone = (x) => Array.isArray(x) && x.length === 2 && x[0] === 'none' && isAttrs(x[1]);
// A function node: `->` or `=>` (a head test, never an emission).
const FUNC_HEADS = new Set(['->', '=>']);
const isFuncNode = (x) => isNodeP(x) && FUNC_HEADS.has(x[0]);

function wordOf(x) {
  if (typeof x === 'string') return x;
  if (Array.isArray(x) && x.length >= 3 && typeof x[0] === 'string' && isAttrs(x[1])) {
    if (x.length === 3 && LEAF_KINDS.has(x[0])) return x[0] === 'this' ? 'this' : x[2];
    if (x.length === 4 && x[0] === 'type' && typeof x[2] === 'string') return x[2];
  }
  return undefined;
}

// Is x a structure (the emitter's `isNode`): an array that is not a
// word and not an absent slot.
const isStruct = (x) => Array.isArray(x) && wordOf(x) === undefined && !isNone(x);

// The head the emitter's tree gives a node: one per loop form, the void
// spellings, and no head at all for the headless parts (their first
// child stands where a head would).
function headOf(x) {
  if (!isNodeP(x)) {
    if (!Array.isArray(x) || x.length === 0) return undefined;
    return wordOf(x[0]);
  }
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
    case 'catch': return isNone(x[2]) ? null : wordOf(x[2]);
    case 'as': return wordOf(x[2]);
    case 'pickitem': return wordOf(x[2]);
  }
  return h;
}

// ── the analysis ─────────────────────────────────────────────────────

// `dataLine` is the __DATA__ marker's 1-based line when the program has a
// section (parseSource's dataLine): the marker declares DATA in the
// program scope.
export function analyze(parseResult, { source = '', face = 'js', ambientBindings = null, stores = null, dataLine = null } = {}) {
  if (!parseResult.sexpr) throw new Error('analyze: cannot analyze a failed parse');
  const st = stores ?? new Stores(parseResult.stores);
  const ambient = normalizeAmbient(ambientBindings);
  const a = new Analysis(st, source, face);
  a.dataLine = dataLine;
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
    this.bareIt = false;
    this.implicitIt = false;
    this.decls = null;
    this.rejection = null;
    // The statement-level facts, gathered as the walk meets each live
    // statement: def/class declarations, class-valued bindings,
    // exported plain consts, import specifiers, and (for a scope with
    // no owner node, which its statements identify) the statement ids.
    this.declared = null;
    this.classes = EMPTY_MAP;
    this.exportedConst = EMPTY_MAP;
    this.importSpecs = EMPTY_MAP;
    this.stmtIds = owner === null ? [] : null;
  }

  // The first declaration of a name is its declaring node, kept by id.
  record(set, name, id) {
    if (this[set] === EMPTY_MAP) this[set] = new Map();
    if (!this[set].has(name)) this[set].set(name, id);
  }
}

class Analysis {
  constructor(stores, source, face) {
    this.stores = stores;
    this.source = source;
    this.face = face;
    this.words = new Map();
    this.importBound = [];
    this.shadow = new Map();
    this.trig = { schema: false, modelSchema: false, reactive: false, component: false, objectComprehension: false, matchRead: false };
    this.trees = [];         // [{ names: Set, atoms }] in delivery order
    this.tree = null;        // the tree being walked
    this.scopes = [];
    this.program = null;
    this.hoistTargets = new Map();
    this.hoistReactive = new Set();
    this.hoistErr = null;
    this.rabErr = null;
    this.schemaErr = null;
    this.itScope = null;
    this.schemaBodies = [];
    this.siteTrees = new Map();
    this.renderPos = new Map();
    this.childrenFuncs = new Set();
    this.methodFuncs = new Set();
    this.dataLine = null;
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

  // A multi-statement computed block: its own scope.
  static isComputedBlock(x) {
    const v = x[3];
    return x[0] === 'computed' && Array.isArray(v) && v[0] === 'block' && isAttrs(v[1]) && v.length > 3;
  }

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
        out.push(w);
      }
      return out;
    }
    if (isNodeP(p) && CALL_KINDS.has(this.kindOf(p))) {
      throw this.positioned("emitter: a call cannot be a destructuring target — a pattern element writes a name or a member, and a call's result is neither", p);
    }
    const h = headOf(p);
    if (!isNodeP(p)) {
      // A plumbing list spelled where a pattern stands: its first word
      // is its head in the emitter's tree.
      return out;
    }
    if (h === 'array') {
      for (let i = 2; i < p.length; i++) if (!isNone(p[i])) this.patternNames(p[i], out, binding, p);
    } else if (h === 'object') {
      for (let i = 2; i < p.length; i++) {
        const pair = p[i];
        if (!isStruct(pair)) continue;
        const ph = headOf(pair);
        if (ph === null) this.patternNames(pair[2], out, binding, p);
        else if (ph === ':') this.patternNames(pair[3], out, binding, p);
        else if (ph === '=') this.patternNames(pair[2], out, binding, p);
        else if (ph === '...') this.patternNames(pair[2], out, binding, p);
      }
    } else if (h === 'rest') {
      if (!binding) throw this.positioned("emitter: Cannot use 'rest' expression as a destructuring target (destructuring rest is spelled '...name')", p);
      this.patternNames(p[2], out, binding, p);
    } else if (h === '...' || h === 'default' || h === '=' || h === 'cast' || h === 'satisfies' || h === 'typed-var') {
      this.patternNames(p[2], out, binding, p);
    }
    return out;
  }

  static isPattern(x) {
    return isNodeP(x) && (x[0] === 'object' || x[0] === 'array');
  }

  // The names an import binds in module scope (the emitter's
  // importedNames over one import).
  importedNames(x, out = []) {
    for (const spec of [x[2], x[3]]) {
      if (isNone(spec)) continue;
      if (Array.isArray(spec) && spec.length === 0 && spec === x[2]) continue;
      const w = wordOf(spec);
      if (w !== undefined) { out.push(w); continue; }
      if (isNodeP(spec) && spec[0] === 'as') {
        const name = wordOf(spec[2]);
        if (name === '*') out.push(wordOf(spec[3]));
        else out.push(name, wordOf(spec[3]));
        continue;
      }
      for (const s of spec) {
        if (isNodeP(s) && s[0] === 'as') out.push(wordOf(s[3]));
        else out.push(wordOf(s));
      }
    }
    return out;
  }

  // Each imported local with the module and the name it came from (the
  // emitter's importedSpecs over one import).
  importSpecs(x, specs) {
    const src = wordOf(x[5]);
    if (typeof src !== 'string') return;
    const hasSpec = !isNone(x[2]);
    const hasExtra = !isNone(x[3]);
    if (!hasSpec && !hasExtra) return;
    const specifier = bareSpecifier(src);
    for (const spec of [x[2], x[3]]) {
      if (isNone(spec)) continue;
      if (Array.isArray(spec) && spec.length === 0 && spec === x[2]) continue;
      const w = wordOf(spec);
      if (w !== undefined) { specs.set(w, { specifier, importedName: 'default' }); continue; }
      const list = isNodeP(spec) && spec[0] === 'as' ? [wordOf(spec[2]), wordOf(spec[3])] : null;
      if (list !== null && list[0] === '*') { specs.set(list[1], { specifier, importedName: '*' }); continue; }
      if (list !== null) {
        for (const name of list) specs.set(name, { specifier, importedName: name });
        continue;
      }
      for (const s of spec) {
        if (isNodeP(s) && s[0] === 'as') specs.set(wordOf(s[3]), { specifier, importedName: wordOf(s[2]) });
        else specs.set(wordOf(s), { specifier, importedName: wordOf(s) });
      }
    }
  }

  // ── trees ──────────────────────────────────────────────────────────

  run(sexpr) {
    const stmts = sexpr.slice(2);
    const live = stmts.filter((s) => !isErased(s));
    const program = new Scope(null, live, []);
    // The __DATA__ marker declares DATA ahead of every statement.
    if (this.dataLine !== null) program.forms.push({ name: 'DATA', kind: 'the __DATA__ section', node: null, line: this.dataLine, auth: true });
    this.scopes.push(program);
    this.program = program;
    this.rawStmts = stmts;
    this.beginTree([]);
    this.visitWord('program', USED | RN_EXPR);
    for (const s of stmts) {
      const isLive = !isErased(s);
      if (isLive) this.noteStmt(program, s);
      this.visit(s, USED | RN_EXPR | HOIST, isLive ? program : null, isLive ? program : null);
    }
    this.endScope(program);
    this.endTree();
  }

  beginTree(atoms, stmts = null) {
    const tree = { names: new Set(), atoms, stmts, outer: this.tree, shadow: this.shadow, itScope: this.itScope };
    this.trees.push(tree);
    this.tree = tree;
    this.shadow = new Map();
    this.itScope = null;
    for (const atom of atoms) this.flag(atom, W_ATOM);
  }

  endTree() {
    const tree = this.tree;
    this.tree = tree.outer;
    this.shadow = tree.shadow;
    this.itScope = tree.itScope;
  }

  // ── words ──────────────────────────────────────────────────────────
  flag(w, bits) {
    const f = this.words.get(w);
    if (f === undefined) this.words.set(w, bits);
    else if ((f | bits) !== f) this.words.set(w, f | bits);
  }

  visitWord(w, m) {
    const rn = m & RN;
    let bits = (m & RNONLY) ? 0 : W_ATOM | ((m & USED) ? W_USED : 0);
    if ((rn === RN_EXPR || (rn === RN_RENDER && !isTagWord(w))) && (this.shadow.size === 0 || !this.shadow.has(w))) bits |= W_FREE;
    if (bits !== 0) this.flag(w, bits);
    if (w === 'it' && this.itScope !== null && !(m & (NOIT | RNONLY))) this.itScope.bareIt = true;
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
      if (this.rabErr === null || this.rabErr.tree > this.trees.indexOf(this.tree)) {
        this.rabErr = { tree: this.trees.indexOf(this.tree), err };
      }
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
    if (!isNodeP(x)) return this.visitList(x, m, cs, rs);
    if (this.renderPos.size !== 0) {
      const sink = this.renderPos.get(x);
      if (sink !== undefined) this.renderChild(x, sink);
    }
    const h = x[0];
    if (x.length === 3 && LEAF_KINDS.has(h)) return this.visitWord(h === 'this' ? 'this' : x[2], m);
    if (h === 'type' && x.length === 4 && typeof x[2] === 'string') return this.visitWord(x[2], m);
    if (h === 'none') return;
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
      case 'schema': if (this.kindOf(x) === 'schema') return this.visitSchema(x, m); break;
      case 'do-iife': return this.visitDoIife(x, m, cs, rs);
      case 'render': if (this.kindOf(x) === 'render') return this.visitRender(x, m, cs, rs); break;
      case '.': case '?.': if (x.length === 4) return this.visitAccess(x, m, cs, rs); break;
      case 'object': return this.visitObject(x, m, cs, rs);
      case 'array': return this.visitArray(x, m, cs, rs);
      case 'str': return this.visitStr(x, m, cs, rs, 2);
      case 'here-regex': return this.visitStr(x, m, cs, rs, 3);
      case 'if': return this.visitIf(x, m, cs, rs);
      case 'while': return this.visitWhile(x, m, cs, rs);
      case 'switch': return this.visitSwitch(x, m, cs, rs);
      case 'type-decl': return this.visitTypeDecl(x, m);
      case 'catch': case 'as': case 'pickitem': return this.visitHeadless(x, m, cs, rs);
      case 'return': case 'yield': case 'accept': return this.visitOptionalTail(x, m, cs, rs);
      case '..': case '...':
        if (x.length === 4) return this.visitRange(x, m, cs, rs);
        if (h === '...') return this.visitPatternPart(x, m, cs, rs);
        break;
      case '=': return this.visitAssign(x, headOf(x), m, cs, rs);
    }
    if (ASSIGNS.has(h)) return this.visitAssign(x, h, m, cs, rs);
    if (FUNC_HEADS.has(h)) return this.visitFunc(x, m, cs, rs, null);
    return this.generic(x, h, m, cs, rs);
  }

  // The mode word for a structure's children under the generic rule:
  // the free-reference walk reads them as expressions, and a block head
  // nests the scope walks.
  static childMode(m, hv) {
    let c = m;
    if (c & RN) c = (c & ~RN) | RN_EXPR;
    if (BLOCK_HEADS.has(hv)) c |= CNEST | RNEST;
    return c;
  }

  // Per-node checks every consumer makes at any structure: the
  // structural runtime triggers and the program hoist's match writes.
  noteNode(x, hv, m) {
    if (hv === '=~' && x.length === 4) this.matchWrite(x, m);
    else if (hv === 'regex-index' && x.length === 5) this.matchWrite(x, m);
    else if (hv === '[]' && x.length === 4) {
      const k = wordOf(x[3]);
      if (typeof k === 'string' && k[0] === '/') this.matchWrite(x, m);
    }
  }

  matchWrite(x, m) {
    this.trig.matchRead = true;
    if (m & (HOIST | HMATCH)) this.hoistAdd('_', x);
  }

  hoistAdd(name, node) {
    if (!this.hoistTargets.has(name)) this.hoistTargets.set(name, node);
  }

  // A pattern's names for the program hoist (binding positions read as
  // writes, so a rest element rejects).
  hoistPattern(p, node) {
    try {
      for (const n of this.patternNames(p)) this.hoistAdd(n, node);
    } catch (err) {
      if (this.hoistErr === null) this.hoistErr = err;
    }
  }

  generic(x, hv, m, cs, rs) {
    this.noteNode(x, hv, m);
    const c = Analysis.childMode(m, hv);
    this.visitWord(hv, c);
    for (let i = 2; i < x.length; i++) this.visit(x[i], c, cs, rs);
  }

  // A block: in a render statement its statements are render and its
  // head is no reference; otherwise the generic rule.
  visitBlock(x, m, cs, rs) {
    if ((m & RN) !== RN_RENDER) return this.generic(x, 'block', m, cs, rs);
    const c = Analysis.childMode(m, 'block');
    this.visitWord('block', c & ~RN);
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
    const c = Analysis.childMode(m, h);
    this.visitWord(h, c & ~RN);
    this.visit(x[2], (c & ~RN) | RN_PAT, cs, rs);
    if (h === 'default') this.visit(x[3], c, cs, rs);
  }

  visitList(x, m, cs, rs) {
    const hv = x.length ? wordOf(x[0]) : undefined;
    const c = Analysis.childMode(m, hv);
    for (const el of x) this.visit(el, c, cs, rs);
  }

  // Words of a structure's head for a handler that does not read its
  // head as a reference.
  headWord(hv, m) {
    if (typeof hv === 'string') this.visitWord(hv, m & ~RN);
  }

  // ── imports ────────────────────────────────────────────────────────
  visitImport(x, m, rs) {
    const names = this.importedNames(x);
    if (m & USED) {
      const id = this.idOf(x);
      if (id === null || this.stores.role(id, 'typeOnly') === null) for (const n of names) this.importBound.push(n);
    }
    if (!(m & NORAB)) for (const n of names) this.tree.names.add(n);
    if (rs !== null) for (const n of names) this.auth(rs, n, 'import', x);
    const w = (m & ~(RN | USED)) | NOIT;
    // The emitter's import spells only its words: the specifiers, `{}`
    // for an empty list, the attributes and the source.
    this.visitWord('import', w & ~NOIT);
    const quiet = (m & ~(RN | USED | HOIST | HMATCH)) | NORAB;
    if (Array.isArray(x[2]) && x[2].length === 0) this.visitWord('{}', quiet);
    else if (!isNone(x[2])) this.visit(x[2], quiet, null, null);
    if (!isNone(x[3])) this.visit(x[3], quiet, null, null);
    if (!isNone(x[4])) this.visit(x[4], quiet, null, null);
    this.visit(x[5], quiet, null, null);
  }

  // ── functions ──────────────────────────────────────────────────────
  // The names a parameter list binds (the free-reference walk's
  // shadowing set).
  paramBindings(params, out) {
    const bind = (p) => {
      const w = wordOf(p);
      if (w !== undefined) { if (!isNone(p)) out.add(w); return; }
      if (!isStruct(p)) return;
      const h = headOf(p);
      if (!isNodeP(p)) return;
      if (h === 'object' || h === 'array') {
        for (let i = 2; i < p.length; i++) if (!isNone(p[i])) bind(p[i]); else out.add(',');
      } else if (h === null && p.length === 4) bind(p[3]);
      else if ((h === ':' || h === '=') && p.length === 4) bind(h === ':' ? p[3] : p[2]);
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
  // reference walk, the alias-binding walk's pattern names, outside
  // every scope walk.
  visitParams(params, m) {
    const pm = (m & ~(RN | HOIST | HMATCH | CNEST | RNEST)) | ((m & RN) ? RN_PAT : 0) | NORAB;
    for (const p of params) {
      this.rabPattern(p, m);
      this.visit(p, pm, null, null);
    }
  }

  // `->` / `=>`. A method (`as` 'method', or a function its class or
  // component body registered in methodFuncs) is emitted by the
  // emitter's methodBlock: parameters first, then its body's scope, and
  // no implicit `it`. Any other function is emitted by emitFunc, which
  // checks its body's scope before it emits its parameters, so its
  // scope opens before the scopes inside its parameter defaults. A
  // render children block (childrenFuncs) is inlined into its render
  // and is no scope. `rnRender` reads the body as render statements for
  // the free-reference walk (a tag call's children).
  visitFunc(x, m, cs, rs, as, rnRender = false) {
    const params = x[2];
    const body = x[3];
    const method = as === 'method' || this.methodFuncs.has(x);
    this.headWord(x[0], m);
    let scope = null;
    const scoped = !this.childrenFuncs.has(x);
    if (method) this.visitParams(params, m);
    if (scoped) {
      scope = this.openScope(x, body, params, false, m);
      scope.implicitIt = !method && params.length === 0;
    }
    if (!method) this.visitParams(params, m);
    this.visitBody(body, m, scope, params, 'func', rnRender ? RN_RENDER : RN_EXPR);
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
    const bm = (m & ~(HOIST | HMATCH | CNEST | RNEST | RN)) | ((m & RN) ? bodyRn : 0);
    this.visitBlockBody(body, bm, scope);
    this.itScope = outerIt;
    this.popShadow(shadowed);
    if (scope !== null) this.endScope(scope);
  }

  visitBlockBody(body, m, scope) {
    if (isNodeP(body) && body[0] === 'block') {
      this.visitWord('block', m);
      for (let i = 2; i < body.length; i++) {
        const s = body[i];
        const live = scope !== null && !isErased(s);
        if (live) this.noteStmt(scope, s);
        this.visit(s, m, live ? scope : null, live ? scope : null);
      }
    } else {
      if (scope !== null) this.noteStmt(scope, body);
      this.visit(body, m, scope, scope);
    }
  }

  openScope(owner, body, params, checkOnly = false, m = 0) {
    const scope = new Scope(owner, body, params, checkOnly);
    if (!(m & RNONLY)) this.scopes.push(scope);
    return scope;
  }

  visitDef(x, m, rs, inClass) {
    const hv = headOf(x);
    const name = wordOf(x[2]);
    if (!inClass && name !== undefined) this.rabName(name, m);
    if (rs !== null && !(m & RNEST) && name !== undefined) this.auth(rs, name, 'def', x);
    this.headWord(hv, m);
    this.visit(x[2], (m & ~(RN | HOIST | HMATCH | CNEST | RNEST)) | NORAB | NOIT, null, null);
    this.visitParams(x[3], m);
    // A def emits as its own scope: defStatement, or a class body's
    // method form.
    const scope = this.openScope(x, x[4], x[3], false, m);
    this.visitBody(x[4], m, scope, x[3], 'def');
  }

  // An overload signature: erased, read generically by every walk but
  // the use walk, which sees its parameters alone.
  visitDefSig(x, m, cs, rs) {
    const c = Analysis.childMode(m, 'def-sig');
    const noUse = c & ~USED;
    this.visitWord('def-sig', noUse);
    this.visit(x[2], noUse, cs, rs);
    this.visit(x[3], c, cs, rs);
    this.visit(x[4], noUse, cs, rs);
  }

  // ── classes and components ─────────────────────────────────────────
  // A class: `x` positions it; name, parent and body are its parts. A
  // pick item keyed `class` takes this reading too (see visitHeadless).
  visitClass(x, m, rs, nameSlot, parentSlot, bodySlot) {
    const name = isNone(nameSlot) ? null : nameSlot;
    const parent = isNone(parentSlot) ? null : parentSlot;
    const body = bodySlot === undefined || isNone(bodySlot) ? null : bodySlot;
    const nameWord = name === null ? undefined : wordOf(name);
    if (nameWord !== undefined) this.rabName(nameWord, m);
    if (rs !== null && !(m & RNEST) && nameWord !== undefined) this.auth(rs, nameWord, 'class', x);
    this.headWord('class', m);
    // The frame collectors never enter a class; the hoist and the
    // redeclaration walk read its parent and field values in the
    // enclosing scope, nested.
    const inner = (m & ~(RN | CNEST)) | RNEST | ((m & RN) ? RN_EXPR : 0);
    if (name !== null) this.visit(name, (m & ~(RN | HOIST | HMATCH | CNEST | RNEST)) | NORAB, null, null);
    if (parent !== null) {
      if (isNodeP(parent) && parent[0] === 'def') this.visitDef(parent, inner, rs, true);
      else this.visit(parent, inner, null, rs);
    }
    if (body === null) return;
    const bm = inner;
    this.visitWord('block', (bm & ~(HOIST | HMATCH)) | NORAB);
    for (let i = 2; i < body.length; i++) {
      const s = body[i];
      if (isNodeP(s) && s[0] === 'def') { this.visitDef(s, bm & ~(HOIST | HMATCH), null, true); continue; }
      if (isNodeP(s) && ASSIGNS.has(headOf(s)) && s.length === 4) {
        this.visitClassField(s, bm, rs);
        continue;
      }
      if (isNodeP(s) && s[0] === 'typed-var' && s.length === 4) {
        this.visit(s, bm & ~(HOIST | HMATCH), null, null);
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
    if (isNodeP(x)) {
      if (x[0] === 'object') for (let i = 2; i < x.length; i++) this.noteMethodPair(x[i]);
      else if (x[0] === ':') this.noteMethodPair(x);
      else if (x[0] === 'call' && x[1].opt !== true && x[1].await !== true && x.length === 4) {
        const w = wordOf(x[2]);
        if ((w === 'get' || w === 'set') && isNodeP(x[3]) && x[3][0] === 'object' && x[3].length === 3) this.noteMethodPair(x[3][2]);
      }
    }
    return this.visit(x, m, null, rs);
  }

  // A pair whose value the emitter emits as a method.
  noteMethodPair(pair) {
    if (isNodeP(pair) && pair[0] === ':' && pair[1].shorthand !== true && isFuncNode(pair[3])) this.methodFuncs.add(pair[3]);
  }

  // A member access: the free-reference walk reads only the object; a
  // render statement's tag chain is no reference at all.
  visitAccess(x, m, cs, rs) {
    const hv = x[0];
    const rn = m & RN;
    const c = Analysis.childMode(m, hv);
    if (rn === RN_RENDER && hv === '.' && this.tagOf(x)) {
      this.visitWord(hv, c & ~RN);
      this.visit(x[2], c & ~RN, cs, rs);
      this.visit(x[3], (c & ~RN) | NOIT, cs, rs);
      return;
    }
    this.visitWord(hv, c & ~RN);
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
    else if (Analysis.isPattern(target)) this.rabPattern(target, m);
    this.headWord(hv, m);
    const tm = (m & ~(HOIST | HMATCH | RN)) | ((m & RN) ? RN_PAT : 0);
    this.visit(target, tm, null, null);
    this.visit(x[3], (m & ~RN) | ((m & RN) ? RN_EXPR : 0), null, rs);
  }

  visitComponent(x, m) {
    this.trig.component = true;
    const parent = isNone(x[2]) ? null : x[2];
    const body = x[3];
    const c = (m & ~(HOIST | HMATCH | CNEST | RNEST | RN)) | ((m & RN) ? RN_EXPR : 0);
    this.visitWord('component', c);
    if (parent !== null) this.visit(parent, c, null, null);
    this.visitWord('block', c);
    for (let i = 2; i < body.length; i++) {
      const s = body[i];
      if (isNodeP(s) && s[0] === 'effect' && this.isEffectDecl(s)) { this.visitEffect(s, c, null, null, true); continue; }
      // The emitter emits a component's methods and lifecycle hooks
      // through methodBlock: a `name = ->` member, and every pair of a
      // colon-method group.
      if (isNodeP(s)) {
        if (s[0] === 'object') for (let j = 2; j < s.length; j++) this.noteMethodPair(s[j]);
        else if (s[0] === ':') this.noteMethodPair(s);
        else if (s[0] === '=' && s.length === 4 && isFuncNode(s[3])) this.methodFuncs.add(s[3]);
      }
      this.visit(s, c, null, null);
    }
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
    this.headWord(hv, m);
    const name = this.declTarget(x, m);
    const block = Analysis.isComputedBlock(x);
    if (m & HOIST && name !== undefined) this.hoistReactive.add(name);
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
    if (rs !== null) this.auth(rs, name, hv === 'computed' ? 'computed' : 'state', x);
    const vm = (m & ~RN) | ((m & RN) ? RN_EXPR : 0);
    if (block) {
      // computedBody: the block is its own scope.
      const value = x[3];
      const scope = this.openScope(null, value, [], false, m);
      this.visitBody(value, vm, scope, []);
      return;
    }
    this.visit(x[3], vm & ~CNEST, null, rs);
  }

  visitEffect(x, m, cs, rs, member) {
    this.trig.reactive = true;
    this.headWord('effect', m);
    const target = isNone(x[2]) ? null : x[2];
    let name;
    if (target !== null) name = this.declTarget(x, m);
    if (m & HOIST && name !== undefined) this.hoistReactive.add(name);
    if (target !== null && cs !== null) {
      if (m & CNEST) {
        if (cs.errHandle === null) {
          cs.errHandle = this.positioned(
            `emitter: a bound effect ('${name ?? '…'} ~> …') must sit at module or function scope — ` +
            `inside a statement block its dispose handle would be a block-scoped const, dead to every later read ` +
            `; a BARE '~> …' stays legal here`, x);
        }
      } else if (name !== undefined) {
        cs.record('handles', name, this.idOf(x));
      }
    }
    if (target !== null && rs !== null) this.auth(rs, name, 'effect', x);
    const body = x[3];
    const bm = (m & ~(HOIST | HMATCH | CNEST | RNEST | RN)) | ((m & RN) ? RN_EXPR : 0);
    if (isFuncNode(body)) return this.visitFunc(body, bm, null, null, null);
    if (isNodeP(body) && body[0] === 'block') {
      // A component member's single-statement block emits inline with
      // no frame; every other block body is a function scope.
      if (member && body.length <= 3) return this.visit(body, bm, null, null);
      const scope = this.openScope(null, body, [], false, m);
      return this.visitBody(body, bm, scope, []);
    }
    if (member) return this.visit(body, bm, null, null);
    // effectValue's single expression: checked as its own scope, no
    // frame.
    const scope = this.openScope(x, [body], [], true, m);
    this.noteStmt(scope, body);
    this.visit(body, bm, null, scope);
    this.endScope(scope);
  }

  visitReadonly(x, m, cs, rs) {
    this.headWord(headOf(x), m);
    const name = this.declTarget(x, m);
    if (m & HOIST && name !== undefined) this.hoistReactive.add(name);
    if (cs !== null) {
      if (m & CNEST) {
        if (cs.errReadonly === null) {
          cs.errReadonly = this.positioned(
            `emitter: a readonly declaration ('${name ?? '…'} =! …') must sit at module or function scope — ` +
            `inside a statement block it lowers to a block-scoped const, dead to every later read `, x);
        }
      } else if (name !== undefined) {
        cs.record('readonly', name, this.idOf(x));
      }
    }
    if (rs !== null) this.auth(rs, name, 'readonly', x);
    this.visit(x[3], (m & ~RN) | ((m & RN) ? RN_EXPR : 0), cs, rs);
  }

  visitGate(x, m, cs, rs) {
    const c = Analysis.childMode(m, 'gate');
    this.headWord('gate', c);
    const target = x[2];
    const tw = wordOf(target);
    if (tw !== undefined) this.rabName(tw, m);
    else if (isStruct(target)) this.rabPattern(target, m);
    this.visit(target, (c & ~RN) | NORAB, cs, rs);
    this.visit(x[3], (c & ~RN) | ((m & RN) ? RN_EXPR : 0), cs, rs);
    for (let i = 4; i < x.length; i++) this.visit(x[i], (c & ~RN) | NORAB, cs, rs);
  }

  // ── assignments and pairs ──────────────────────────────────────────
  visitAssign(x, hv, m, cs, rs) {
    if (!ASSIGNS.has(hv)) return this.generic(x, hv, m, cs, rs);
    const target = x[2];
    const tw = wordOf(target);
    if (tw !== undefined) this.rabName(tw, m);
    else if (Analysis.isPattern(target)) this.rabPattern(target, m);
    if (m & HOIST) {
      if (tw !== undefined) this.hoistAdd(tw, x);
      else if (hv === '=' && Analysis.isPattern(target)) this.hoistPattern(target, x);
    }
    if (rs !== null) {
      if (tw !== undefined) this.plain(rs, tw, x);
      else if (hv === '=' && Analysis.isPattern(target)) {
        try {
          for (const n of this.dupIn(this.patternNames(target), x, 'destructuring pattern', rs)) this.plain(rs, n, x);
        } catch (err) {
          rs.forms.push({ error: err });
        }
      }
    }
    const c = Analysis.childMode(m, hv);
    this.visitWord(hv, c & ~RN);
    const rn = m & RN;
    this.visit(target, (c & ~RN) | (rn ? RN_PAT : 0), cs, rs);
    this.visit(x[3], c, cs, rs);
  }

  // `key: value`, a void pair, a shorthand pair. `as` 'method' marks an
  // object or class method's function.
  visitPair(x, m, cs, rs, as = null, inObject = false) {
    const hv = headOf(x);
    const c = Analysis.childMode(m, hv);
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
    this.visitWord(hv, c & ~RN);
    const keyRn = keyWord === undefined && rn ? RN_EXPR : 0;
    this.visit(key, (c & ~RN) | keyRn | (hv === ':' && keyWord !== undefined && inObject ? NOIT : 0), cs, rs);
    let vrn = rn ? RN_EXPR : 0;
    if (rn === RN_PAT && hv === ':') vrn = RN_PAT;
    const value = x[3];
    const method = as === 'method' || (as === 'object' && this.isMethodPair(x));
    if (method && isFuncNode(value)) {
      return this.visitFunc(value, (c & ~RN) | vrn, cs, rs, 'method');
    }
    this.visit(value, (c & ~RN) | vrn, cs, rs);
  }

  isMethodPair(x) {
    const hv = headOf(x);
    if (hv !== ':' && hv !== 'void-pair') return false;
    const k = wordOf(x[2]);
    return typeof k === 'string' && isIdentifierName(k) && isNodeP(x[3]) && x[3][0] === '->';
  }

  visitObject(x, m, cs, rs) {
    if (x.length === 3 && isNodeP(x[2]) && headOf(x[2]) === ':') {
      const pair = x[2];
      const k = pair[2];
      const keyOk = wordOf(k) !== undefined || (isNodeP(k) && k[0] === 'dynamicKey');
      if (keyOk && isNodeP(pair[3]) && pair[3][0] === 'comprehension' && pair[3][3][1].over === 'of') this.trig.objectComprehension = true;
    }
    const rn = m & RN;
    const c = Analysis.childMode(m, 'object');
    this.visitWord('object', rn === RN_PAT ? c & ~RN : c);
    const pm = rn === RN_PAT ? (c & ~RN) | RN_PAT : c;
    for (let i = 2; i < x.length; i++) {
      const p = x[i];
      if (isNodeP(p) && p[0] === ':') this.visitPair(p, pm, cs, rs, rn === RN_PAT ? null : 'object', true);
      else this.visit(p, pm, cs, rs);
    }
  }

  visitArray(x, m, cs, rs) {
    const rn = m & RN;
    const c = Analysis.childMode(m, 'array');
    this.visitWord('array', rn === RN_PAT ? c & ~RN : c);
    const pm = rn === RN_PAT ? (c & ~RN) | RN_PAT : c;
    for (let i = 2; i < x.length; i++) {
      if (isNone(x[i])) this.visitWord(',', pm);
      else this.visit(x[i], pm, cs, rs);
    }
  }

  visitStr(x, m, cs, rs, from) {
    const c = Analysis.childMode(m, x[0]);
    this.visitWord(x[0], c);
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
    if (over === 'forever' || over === 'times') {
      const c = Analysis.childMode(m, hv);
      this.visitWord(hv, c);
      if (over === 'times') this.visit(x[3], c, cs, rs);
      this.visit(x[6], c, cs, rs);
      return;
    }
    const vars = x[2];
    const rn = m & RN;
    const c = Analysis.childMode(m, hv);
    this.visitWord(hv, c & ~RN);
    for (const p of vars) this.rabPattern(p, m);
    if (rs !== null) {
      try {
        const names = [];
        for (const p of vars) this.patternNames(p, names, true);
        this.dupIn(names, x, 'loop head', rs);
      } catch (err) {
        rs.forms.push({ error: err });
      }
    }
    this.visitVars(vars, (c & ~(RN | HOIST)) | (rn ? RN_PAT : 0) | ((m & (HOIST | HMATCH)) ? HMATCH : 0), cs);
    const sm = (c & ~RN) | (rn ? RN_EXPR : 0);
    this.visit(x[3], sm, cs, rs);
    if (!isNone(x[4])) this.visit(x[4], sm, cs, rs);
    if (!isNone(x[5])) this.visit(x[5], sm, cs, rs);
    this.visit(x[6], rn === RN_RENDER ? (sm & ~RN) | RN_RENDER : sm, cs, rs);
  }

  // A loop's or clause's variables: each a binding pattern (its
  // defaults and computed keys are the free-reference walk's only
  // references there).
  visitVars(vars, m, cs) {
    for (const p of vars) this.visit(p, m, cs, null);
  }

  visitComprehension(x, m, cs, rs) {
    const c = Analysis.childMode(m, 'comprehension');
    const rn = m & RN;
    this.visitWord('comprehension', c);
    const ec = (c & ~RN) | (rn ? RN_EXPR : 0);
    this.visit(x[2], ec, cs, rs);
    const clause = x[3];
    if (rs !== null) {
      try {
        const names = [];
        for (const p of clause[2]) this.patternNames(p, names, true);
        this.dupIn(names, x, 'comprehension clause', rs);
      } catch (err) {
        rs.forms.push({ error: err });
      }
    }
    // The clause: its vars bind per construct, its source walks here,
    // and its step reaches no scope walk.
    const hv = headOf(clause);
    const cc = Analysis.childMode(ec, hv);
    this.visitWord(hv, cc & ~RN);
    for (const p of clause[2]) this.rabPattern(p, m);
    this.visitVars(clause[2], (cc & ~(RN | HOIST)) | (rn ? RN_PAT : 0) | ((m & (HOIST | HMATCH)) ? HMATCH : 0), cs);
    this.visit(clause[3], cc, cs, rs);
    const over = clause[1].over;
    if (over === 'in') {
      if (!isNone(clause[4])) this.visit(clause[4], cc & ~(HOIST | HMATCH), cs, null);
    }
    if (!isNone(clause[5])) this.visit(clause[5], ec, cs, rs);
  }

  visitTry(x, m, cs, rs) {
    const c = Analysis.childMode(m, 'try');
    const rn = m & RN;
    this.visitWord('try', c & ~RN);
    const body = x[2];
    const handler = isNone(x[3]) ? null : x[3];
    const finalizer = isNone(x[4]) ? null : x[4];
    const binding = handler !== null && !isNone(handler[2]) ? handler[2] : null;
    const pattern = binding !== null && Analysis.isPattern(binding);
    if (pattern) {
      this.rabPattern(binding, m);
      if (m & HOIST) this.hoistPattern(binding, x);
    }
    const ec = (c & ~RN) | (rn ? RN_EXPR : 0);
    // The redeclaration walk reads the handler and the finalizer before
    // the body: the body's forms land after theirs.
    let bodyForms = null;
    let saved = null;
    if (rs !== null) {
      saved = rs.forms;
      rs.forms = [];
    }
    if (isNodeP(body) && body[0] === 'block') {
      this.visit(body, ec, cs, rs);
    } else {
      this.visitInlineTryBody(body, c, rn, cs, rs);
    }
    if (rs !== null) {
      bodyForms = rs.forms;
      rs.forms = saved;
    }
    if (handler !== null) {
      // The handler is headless: [binding, block].
      if (pattern) {
        if (rs !== null) {
          try {
            for (const n of this.dupIn(this.patternNames(binding), binding, 'catch pattern', rs)) this.plain(rs, n, x);
          } catch (err) {
            rs.forms.push({ error: err });
          }
        }
        this.visit(binding, (c & ~RN) | (rn ? RN_PAT : 0), cs, null);
      } else if (binding !== null) {
        this.visit(binding, (c & ~RN) | (rn ? RN_PAT : 0), cs, rs);
      }
      this.visit(handler[3], ec, cs, rs);
    }
    if (finalizer !== null) this.visit(finalizer, ec, cs, rs);
    if (rs !== null) for (const f of bodyForms) rs.forms.push(f);
  }

  // A try whose body is one expression. Every walk reads it as usual
  // but the free-reference walk, which reads it as a handler: the
  // emitter-tree element after its head, and nothing else.
  visitInlineTryBody(body, c, rn, cs, rs) {
    this.visit(body, c & ~RN, cs, rs);
    if (!rn || !isStruct(body)) return;
    const el = emitterElements(body)[1];
    if (el === undefined) return;
    if (el.word !== undefined) {
      this.free(el.word);
    } else if (el.node !== undefined) {
      this.visit(el.node, (c & ~(RN | USED | HOIST | HMATCH | CNEST | RNEST)) | RN_EXPR | NORAB | RNONLY, null, null);
    }
  }

  visitIf(x, m, cs, rs) {
    const c = Analysis.childMode(m, 'if');
    const rn = m & RN;
    if (rn === RN_RENDER) {
      this.visitWord('if', c & ~RN);
      this.visit(x[2], (c & ~RN) | RN_EXPR, cs, rs);
      this.visit(x[3], (c & ~RN) | RN_RENDER, cs, rs);
      if (!isNone(x[4])) this.visit(x[4], (c & ~RN) | RN_RENDER, cs, rs);
      return;
    }
    this.visitWord('if', c);
    this.visit(x[2], c, cs, rs);
    this.visit(x[3], c, cs, rs);
    if (!isNone(x[4])) this.visit(x[4], c, cs, rs);
  }

  visitWhile(x, m, cs, rs) {
    const c = Analysis.childMode(m, 'while');
    this.visitWord('while', c);
    this.visit(x[2], c, cs, rs);
    if (!isNone(x[3])) this.visit(x[3], c, cs, rs);
    this.visit(x[4], c, cs, rs);
  }

  visitSwitch(x, m, cs, rs) {
    const c = Analysis.childMode(m, 'switch');
    this.visitWord('switch', c);
    if (!isNone(x[2])) this.visit(x[2], c, cs, rs);
    this.visit(x[3], c, cs, rs);
    if (!isNone(x[4])) this.visit(x[4], c, cs, rs);
  }

  visitOptionalTail(x, m, cs, rs) {
    const c = Analysis.childMode(m, x[0]);
    this.visitWord(x[0], c);
    for (let i = 2; i < x.length; i++) if (!isNone(x[i])) this.visit(x[i], c, cs, rs);
  }

  visitRange(x, m, cs, rs) {
    const c = Analysis.childMode(m, x[0]);
    this.visitWord(x[0], c);
    if (!isNone(x[2])) this.visit(x[2], c, cs, rs);
    if (!isNone(x[3])) this.visit(x[3], c, cs, rs);
  }

  // catch, as, pickitem: no head in the emitter's tree; the first child
  // stands in its place.
  visitHeadless(x, m, cs, rs) {
    const hv = headOf(x);
    // The emitter's tree spells a pick item [key, target, default], so
    // every walk that tests a head reads one keyed `class` as a class
    // named by its target, the default standing as its parent.
    if (x[0] === 'pickitem' && hv === 'class') return this.visitClass(x, m, rs, x[3], x[4], undefined);
    const c = Analysis.childMode(m, hv);
    // One keyed `component` or `def` reads as that construct, a scope
    // of its own: the program hoist and the frame collectors stop there.
    if (x[0] === 'pickitem' && (hv === 'component' || hv === 'def')) {
      for (let i = 2; i < x.length; i++) if (!isNone(x[i])) this.visit(x[i], c & ~(HOIST | HMATCH), null, rs);
      return;
    }
    for (let i = 2; i < x.length; i++) if (!isNone(x[i])) this.visit(x[i], c, cs, rs);
  }

  visitTypeDecl(x, m) {
    const quiet = m & ~(RN | USED);
    this.visitWord('type-decl', quiet);
    this.visit(x[2], quiet, null, null);
  }

  // ── exports ────────────────────────────────────────────────────────
  visitExport(x, m, cs, rs) {
    const c = Analysis.childMode(m, 'export');
    this.visitWord('export', c);
    const spec = x[2];
    if (Array.isArray(spec) && spec.length === 0) { this.visitWord('{}', c); return; }
    // The hoist: a declaration's initializer walks, the binding never
    // hoists; any other export hoists nothing.
    let sm = c;
    if (m & HOIST) {
      sm = c & ~HOIST;
      if (isNodeP(spec)) {
        const decl = (spec[0] === 'state' || spec[0] === 'computed') ? this.isReactiveDecl(spec)
          : spec[0] === 'effect' ? this.isEffectDecl(spec) : spec[0] === 'readonly' ? this.isReadonlyDecl(spec) : false;
        const name = decl ? wordOf(spec[2]) : undefined;
        if (decl && name !== undefined) {
          this.hoistReactive.add(name);
          if (spec[0] !== 'effect' && !Analysis.isComputedBlock(spec)) return this.visitExportSpec(spec, c, sm | HOIST, cs, rs);
          return this.visitExportSpec(spec, c, sm, cs, rs);
        }
        if (ASSIGNS.has(headOf(spec)) && spec.length === 4) return this.visitExportSpec(spec, c, sm | HOIST, cs, rs);
      }
    }
    this.visitExportSpec(spec, c, sm, cs, rs);
  }

  // The exported spec. `hm` carries HOIST when the program hoist walks
  // the spec's initializer (and never its target).
  visitExportSpec(spec, c, hm, cs, rs) {
    const assign = isNodeP(spec) && (headOf(spec) === '=' || headOf(spec) === 'void-assign') && spec.length === 4 && wordOf(spec[2]) !== undefined;
    if (assign) {
      const name = wordOf(spec[2]);
      if (rs !== null) this.auth(rs, name, 'plain', spec);
      // An exported plain assign is `export const`: the redeclaration
      // walk counts it authoritatively and walks only its value; the
      // hoist walks its value.
      this.rabName(name, c);
      const hv = headOf(spec);
      const sc = Analysis.childMode(hm, hv);
      this.visitWord(hv, sc & ~RN);
      this.visit(spec[2], (sc & ~(RN | HOIST | HMATCH)) | ((c & RN) ? RN_PAT : 0), cs, null);
      this.visit(spec[3], sc, cs, rs);
      return;
    }
    if (hm & HOIST && isNodeP(spec) && ASSIGNS.has(headOf(spec))) {
      // The initializer walks; the target does not hoist.
      const hv = headOf(spec);
      const tw = wordOf(spec[2]);
      if (tw !== undefined) this.rabName(tw, c);
      else if (Analysis.isPattern(spec[2])) this.rabPattern(spec[2], c);
      if (rs !== null) {
        if (tw !== undefined) this.plain(rs, tw, spec);
        else if (hv === '=' && Analysis.isPattern(spec[2])) {
          try {
            for (const n of this.dupIn(this.patternNames(spec[2]), spec, 'destructuring pattern', rs)) this.plain(rs, n, spec);
          } catch (err) {
            rs.forms.push({ error: err });
          }
        }
      }
      const sc = Analysis.childMode(hm, hv);
      this.visitWord(hv, sc & ~RN);
      this.visit(spec[2], (sc & ~(RN | HOIST | HMATCH)) | ((c & RN) ? RN_PAT : 0), cs, rs);
      this.visit(spec[3], sc, cs, rs);
      return;
    }
    if (hm & HOIST && isNodeP(spec)) {
      // A declaration spec: its value walks under HOIST (the handler
      // records the name), its target does not.
      return this.visit(spec, hm, cs, rs);
    }
    this.visit(spec, hm, cs, rs);
  }

  visitExportOther(x, m, cs, rs) {
    const h = x[0];
    const c = Analysis.childMode(m, h);
    this.visitWord(h, c);
    if (h === 'export-from' && Array.isArray(x[2]) && x[2].length === 0) {
      this.visitWord('{}', c);
      this.visit(x[3], c, cs, rs);
      return;
    }
    for (let i = 2; i < x.length; i++) if (!isNone(x[i])) this.visit(x[i], c, cs, rs);
  }

  // ── types ──────────────────────────────────────────────────────────
  visitTypedVar(x, m, cs, rs) {
    const c = Analysis.childMode(m, 'typed-var');
    const rn = m & RN;
    this.visitWord('typed-var', (c & ~(RN | USED)));
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
    const c = Analysis.childMode(m, x[0]);
    const rn = m & RN;
    this.visitWord(x[0], c & ~(RN | USED));
    this.visit(x[2], (c & ~RN) | (rn ? RN_EXPR : 0), cs, rs);
    this.visit(x[3], c & ~(RN | USED), cs, rs);
  }

  // ── calls ──────────────────────────────────────────────────────────
  visitCall(x, m, cs, rs) {
    const c = Analysis.childMode(m, 'call');
    const rn = m & RN;
    this.visitWord('call', c & ~(RN | USED));
    const a = x[1];
    if (rn === RN_RENDER && a.opt !== true && a.await !== true && this.tagOf(x[2])) {
      // A tag call: the tag is an element, a parameterless arrow among
      // its arguments is its children block.
      this.visit(x[2], c & ~RN, cs, rs);
      for (let i = 3; i < x.length; i++) {
        const arg = x[i];
        if (isFuncNode(arg) && arg[2].length === 0) {
          this.visitFunc(arg, c, cs, rs, null, true);
        } else {
          this.visit(arg, (c & ~RN) | RN_EXPR, cs, rs);
        }
      }
      return;
    }
    const cm = (c & ~RN) | (rn ? RN_EXPR : 0);
    for (let i = 2; i < x.length; i++) this.visit(x[i], cm, cs, rs);
  }

  tagOf(head) {
    const w = wordOf(head);
    if (w !== undefined) return isTagWord(w);
    if (isNodeP(head) && head[0] === '.' && head.length === 4) {
      let cur = head;
      while (isNodeP(cur) && cur[0] === '.' && cur.length === 4) {
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
    const c = Analysis.childMode(m, 'do-iife');
    this.visitWord('do-iife', c & ~RN);
    if (m & RN) {
      for (const n of this.paramBindings(fn[2], new Set())) {
        this.free(n);
      }
    }
    this.visit(fn, (c & ~RN) | ((m & RN) ? RN_EXPR : 0), cs, rs);
  }

  visitRender(x, m, cs, rs) {
    const sink = { locals: new Set(), loops: [] };
    const body = x[2];
    if (isNodeP(body) && body[0] === 'block') for (let i = 2; i < body.length; i++) this.renderAt(body[i], sink);
    else this.renderAt(body, sink);
    const c = Analysis.childMode(m, 'render');
    this.visitWord('render', c & ~RN);
    this.visit(x[2], (c & ~RN) | ((m & RN) ? RN_RENDER : 0), cs, rs);
  }

  // ── render emission ────────────────────────────────────────────────
  // How the emitter's render lowering reads a render body: which nodes
  // stand at a render child position, and which parameterless arrows
  // are children blocks it inlines (never function scopes). A sink is
  // one factory's render locals plus the loop variables above it; a
  // conditional branch and a loop body each open a new one.
  renderAt(x, sink) {
    if (isNodeP(x) && wordOf(x) === undefined) this.renderPos.set(x, sink);
  }

  renderShadowed(sink, name) {
    return sink.locals.has(name) || sink.loops.includes(name);
  }

  renderBlock(body, sink) {
    if (isNodeP(body) && body[0] === 'block') for (let i = 2; i < body.length; i++) this.renderAt(body[i], sink);
    else if (Array.isArray(body) && !isNodeP(body)) for (const el of body) this.renderAt(el, sink);
    else this.renderAt(body, sink);
  }

  renderChild(x, sink) {
    this.renderPos.delete(x);
    const hv = headOf(x);
    const branch = () => ({ locals: new Set(), loops: sink.loops });
    if (RENDER_BINDING_HEADS.has(hv) && x.length === 4 && isIdentifierName(wordOf(x[2]))) {
      if (hv === '=') sink.locals.add(wordOf(x[2]));
      return;
    }
    if (hv === 'if') {
      this.renderBlock(x[3], branch());
      if (!isNone(x[4])) {
        if (isNodeP(x[4]) && x[4][0] === 'if') this.renderAt(x[4], sink);
        else this.renderBlock(x[4], branch());
      }
      return;
    }
    if (hv === 'switch') {
      for (const w of x[3]) if (isNodeP(w) && w[0] === 'when') this.renderBlock(w[3], branch());
      if (!isNone(x[4])) this.renderBlock(x[4], branch());
      return;
    }
    if (hv === 'for-in' && !isNone(x[6])) {
      const loops = [...sink.loops];
      for (const v of x[2]) { const w = wordOf(v); if (w !== undefined) loops.push(w); }
      this.renderBlock(x[6], { locals: new Set(), loops });
      return;
    }
    if (isFuncNode(x)) {
      this.childrenFuncs.add(x);
      this.renderBlock(x[3], sink);
      return;
    }
    if (hv !== 'call' || x[1].opt === true || x[1].await === true) return;
    const callee = x[2];
    const name = wordOf(callee);
    const args = x.slice(3);
    if (name === 'slot' || name === '__text__') return;
    if (name !== undefined && isComponentName(name)) return this.renderComponentArgs(args, sink);
    if (componentPathOf(callee)) return this.renderComponentArgs(args, sink);
    if (name !== undefined) {
      if (isHtmlTag(name.split('#')[0]) && !this.renderShadowed(sink, name)) this.renderTagArgs(args, sink);
      return;
    }
    if (isNodeP(callee) && callee[0] === 'call' && isNodeP(callee[2]) && callee[2][0] === '.' && wordOf(callee[2][3]) === '__clsx') {
      const tagExpr = callee[2][2];
      const t = wordOf(tagExpr);
      const tag = t !== undefined ? (t.split('#')[0] || 'div') : templateTag(tagExpr).tag;
      if (tag !== null && isHtmlTag(tag)) this.renderTagArgs(args, sink);
      return;
    }
    const { tag, classes } = templateTag(callee);
    if (tag !== null && isHtmlTag(tag) && !this.renderShadowed(sink, tag)) {
      if (classes.length > 0 && classes[classes.length - 1] === '__clsx') return;
      this.renderTagArgs(args, sink);
    }
  }

  // An element's arguments: a parameterless arrow is its children
  // block, an object its attributes, a word text or a flag; anything
  // else is a child of its own.
  renderTagArgs(args, sink) {
    for (const arg of args) {
      if (isFuncNode(arg)) {
        this.childrenFuncs.add(arg);
        const block = arg[3];
        if (isNodeP(block) && block[0] === 'block') {
          for (let i = 2; i < block.length; i++) if (!(isNodeP(block[i]) && block[i][0] === 'object')) this.renderAt(block[i], sink);
        } else if (!(isNodeP(block) && block[0] === 'object')) this.renderAt(block, sink);
        continue;
      }
      if (isNodeP(arg) && arg[0] === 'object') continue;
      this.renderAt(arg, sink);
    }
  }

  // A child component's arguments: objects are props, the children
  // arrow's statements are props or child DOM.
  renderComponentArgs(args, sink) {
    for (const arg of args) {
      if (isFuncNode(arg)) {
        this.childrenFuncs.add(arg);
        const block = arg[3];
        const stmts = isNodeP(block) && block[0] === 'block' ? block.slice(2) : [block];
        for (const child of stmts) if (!(isNodeP(child) && child[0] === 'object')) this.renderAt(child, sink);
        continue;
      }
      if (isNodeP(arg) && arg[0] === 'object') continue;
      this.renderAt(arg, sink);
    }
  }

  // ── schemas ────────────────────────────────────────────────────────
  visitSchema(x, m) {
    if (m & RNONLY) return;
    this.trig.schema = true;
    const body = x[2];
    const descriptor = body[2];
    if (descriptor && descriptor.kind === 'model') this.trig.modelSchema = true;
    this.visitWord('schema', m & ~RN);
    const sites = schemaCodeSites(descriptor);
    const codes = body[3].slice(2);
    if (codes.length > 0 || sites.length === 0) {
      if (codes.length !== sites.length) throw new Error(`emitterShape: a schema body holds ${codes.length} code tree(s) for ${sites.length} code site(s)`);
      sites.forEach((site, k) => this.siteTrees.set(site.tokens, codes[k][3]));
    }
    for (const site of sites) {
      const program = this.siteTrees.get(site.tokens);
      if (program === undefined) throw new Error('emitter: a schema code site has no parsed body — the parse owns every SCHEMA_CODE payload');
      const stmts = program.slice(2);
      this.schemaBodies.push({ schema: x, site, program });
      if (stmts.length === 0) continue;
      let names = [];
      if (!site.value) {
        try {
          names = this.schemaBodyParams(site.entry).map((p) => p.name);
        } catch (err) {
          if (this.schemaErr === null) this.schemaErr = err;
        }
      }
      this.visitSchemaBody(stmts, names, site.value);
    }
  }

  schemaBodyParams(entry) {
    if (entry.tag === 'adapter') return [];
    if (entry.tag === 'field') return [{ name: 'it', type: null }];
    return paramsOf(entry.paramTokens ?? [], entry.tag === 'ensure' ? '@ensure' : `'${entry.name}'`, schemaFail, this.source);
  }

  // A schema callable body: its own delivery tree, and (when it is a
  // callable rather than the adapter value) its own scope with the
  // body parameters as plain names.
  visitSchemaBody(stmts, names, value) {
    this.beginTree(names, stmts);
    const scope = value ? null : this.openScope(null, stmts, names);
    this.visitWord('program', RN_EXPR);
    for (const s of stmts) {
      if (scope !== null) this.noteStmt(scope, s);
      this.visit(s, RN_EXPR, scope, scope);
    }
    if (scope !== null) this.endScope(scope);
    this.endTree();
  }

  // ── redeclaration ──────────────────────────────────────────────────
  auth(scope, name, kind, node) {
    if (typeof name === 'string') scope.forms.push({ name, kind, node, auth: true });
  }

  plain(scope, name, node) {
    if (typeof name === 'string') scope.forms.push({ name, kind: 'plain', node, auth: false });
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
    const forms = pforms.length === 0 ? scope.forms : [...pforms, ...scope.forms];
    forms.forEach((f, i) => { f.order = i; });
    const reject = (at, prior) => {
      const line = prior.node !== null ? this.nodeLine(prior.node) : prior.line ?? null;
      const hint = prior.kind === 'state' || prior.kind === 'parameter' || prior.kind === 'plain' || prior.line != null
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
      if (prior !== undefined && prior.auth && f.order < prior.order) { scope.rejection = reject(prior, f); return; }
    }
    scope.decls = decls;
  }

  // ── the result ─────────────────────────────────────────────────────

  // The first rejection the emitter would meet: the delivery walk's
  // schema parameters, the alias-binding walk's patterns, the program
  // hoist, then each scope in emission order (its collectors, then its
  // redeclaration check).
  rejection() {
    if (this.schemaErr !== null) return this.schemaErr;
    if (this.rabErr !== null) return this.rabErr.err;
    if (this.hoistErr !== null) return this.hoistErr;
    for (const s of this.scopes) {
      if (!s.checkOnly) {
        if (s.errReactive !== null) return s.errReactive;
        if (s.errHandle !== null) return s.errHandle;
        if (s.errReadonly !== null) return s.errReadonly;
      }
      if (s.rejection !== null) return s.rejection;
    }
    return null;
  }

  result(ambient) {
    const err = this.rejection();
    if (err !== null) throw err;
    const program = this.program;
    const stmts = this.rawStmts;
    const ambientNames = new Set(ambient.map(({ name }) => name));

    // The program hoist: targets minus the scope's const-bound names,
    // its def/class declarations and its imports.
    const hoist = new Map(this.hoistTargets);
    for (const n of this.hoistReactive) hoist.delete(n);
    for (const [n] of declaredNames(stmts)) hoist.delete(n);
    const imports = [];
    for (const s of stmts) if (isNodeP(s) && this.isModuleImport(s)) this.importedNames(s, imports);
    for (const n of imports) hoist.delete(n);
    const hoistNames = [...hoist.keys()].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));

    // programScopeNames.
    const bound = new Set(hoistNames);
    for (const n of imports) bound.add(n);
    for (const n of program.reactive.keys()) bound.add(n);
    for (const n of program.handles.keys()) bound.add(n);
    for (const n of program.readonly.keys()) bound.add(n);
    const topDeclared = (s, add) => {
      if (!isNodeP(s)) return;
      const hv = headOf(s);
      if (hv === 'class' && !isNone(s[2]) && wordOf(s[2]) !== undefined) add(wordOf(s[2]), 'class');
      if ((hv === 'def' || hv === 'void-def') && wordOf(s[2]) !== undefined) add(wordOf(s[2]), 'def');
      if ((hv === '=' || hv === 'void-assign') && wordOf(s[2]) !== undefined) add(wordOf(s[2]), 'plain');
    };
    for (const s of stmts) {
      topDeclared(s, (n) => bound.add(n));
      if (isNodeP(s) && s[0] === 'export' && isStruct(s[2])) topDeclared(s[2], (n) => bound.add(n));
    }

    // inventoryBindings: first classification wins.
    const kinds = new Map();
    const add = (name, kind) => { if (typeof name === 'string' && !kinds.has(name)) kinds.set(name, kind); };
    for (const n of imports) add(n, 'import');
    for (const n of program.reactive.keys()) add(n, program.computed.has(n) ? 'computed' : 'state');
    for (const n of program.handles.keys()) add(n, 'effect');
    for (const n of program.readonly.keys()) add(n, 'readonly');
    for (const s of stmts) {
      topDeclared(s, (n, k) => { if (k === 'plain') { if (!ambientNames.has(n)) add(n, 'plain'); } else add(n, k); });
      if (isNodeP(s) && s[0] === 'export' && isStruct(s[2])) topDeclared(s[2], (n, k) => add(n, k));
    }
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

    const scopes = this.scopes.map((s) => this.scopeFacts(s));
    return withAtoms(words, {
      bindings,
      bindingNames: [...aliasUsed],
      runtimes,
      bound,
      programHoist: hoistNames.map((n) => [n, this.idOf(hoist.get(n))]),
      typeOnlyImports: this.typeOnlyImports(),
      appAccessors: this.appAccessors(),
      schemaBodies: this.schemaBodies,
      schemaTrees: this.trees.slice(1).map((t) => ({ stmtIds: t.stmts.map((x) => (wordOf(x) === undefined ? this.idOf(x) : null)), atoms: [...t.atoms] })),
      scopes,
    });
  }

  // A live statement of a scope: its statement-level facts.
  noteStmt(scope, st) {
    if (scope.stmtIds !== null) scope.stmtIds.push(wordOf(st) === undefined ? this.idOf(st) : null);
    if (!isNodeP(st)) return;
    const h = st[0];
    if (h === 'export') {
      const spec = st[2];
      if (isStruct(spec)) this.noteDeclared(scope, spec);
      if (isNodeP(spec)) {
        const hv = headOf(spec);
        if ((hv === '=' || hv === 'void-assign') && spec.length === 4 && wordOf(spec[2]) !== undefined) {
          if (scope.exportedConst === EMPTY_MAP) scope.exportedConst = new Map();
          scope.exportedConst.set(wordOf(spec[2]), this.idOf(spec));
        }
      }
    } else if (h === 'import') {
      if (!isNone(st[2]) || !isNone(st[3]) || !isNone(st[4])) {
        if (scope.importSpecs === EMPTY_MAP) scope.importSpecs = new Map();
        this.importSpecs(st, scope.importSpecs);
      }
    }
    this.noteDeclared(scope, st);
  }

  // A def or class declaration, or a binding of a class or component
  // value, at a scope's own level (a statement, or an exported spec).
  noteDeclared(scope, st) {
    if (!isNodeP(st)) return;
    const h = st[0];
    if (h !== 'class' && h !== 'def' && h !== '=') return;
    const hv = headOf(st);
    if (hv === 'class' || hv === 'def' || hv === 'void-def') {
      const n = isNone(st[2]) ? undefined : wordOf(st[2]);
      if (n !== undefined) (scope.declared ??= []).push([n, st]);
      return;
    }
    if ((hv !== '=' && hv !== 'void-assign') || st.length !== 4) return;
    const n = wordOf(st[2]);
    const v = st[3];
    if (n !== undefined && isNodeP(v) && (v[0] === 'class' || v[0] === 'component')) {
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
  // word (the emitter's collectTypeOnlyImports): the value imports the
  // walk met, against the identifiers of every role span of type text.
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
      if (!isNodeP(x) || !this.isModuleImport(x)) continue;
      const from = wordOf(x[5]);
      if (typeof from !== 'string' || from.slice(1, -1) !== 'rip/app') continue;
      const id = this.idOf(x);
      if (id !== null && this.stores.role(id, 'typeOnly') !== null) continue;
      for (const spec of [x[2], x[3]]) {
        if (isNone(spec) || (Array.isArray(spec) && spec.length === 0)) continue;
        if (wordOf(spec) !== undefined) continue;
        let list;
        if (isNodeP(spec) && spec[0] === 'as') {
          if (wordOf(spec[2]) === '*') continue;
          list = [spec[2], spec[3]];
        } else list = spec;
        for (const s of list) {
          const imported = isNodeP(s) && s[0] === 'as' ? wordOf(s[2]) : wordOf(s);
          const local = isNodeP(s) && s[0] === 'as' ? wordOf(s[3]) : wordOf(s);
          if (imported === 'currentStash') acc.stash = local;
          else if (imported === 'currentRouter') acc.router = local;
        }
      }
    }
    return acc;
  }
}

// The used-name registry's seed on a result: `isAtom` answers it and
// `atoms` spells it out as a set when a reader needs one. Built outside
// the analysis so the result holds the word map alone.
function withAtoms(words, result) {
  result.isAtom = (name) => words.has(name);
  Object.defineProperty(result, 'atoms', { enumerable: true, get: () => new Set(words.keys()) });
  return result;
}

function schemaFail(message, at) {
  const err = new Error(`schema: ${message}`);
  err.start = at;
  throw err;
}

// Whole statements that compile to nothing: type declarations, bare
// typed forwards, overload signatures.
function isErased(s) {
  if (!isNodeP(s)) return false;
  return s[0] === 'type-decl' || (s[0] === 'typed-var' && s.length === 4) || s[0] === 'def-sig';
}

// The def and class names a statement list declares at its own level,
// each [name, declaring node].
function declaredNames(stmts) {
  const names = [];
  const declared = (s) => {
    if (!isNodeP(s)) return;
    const hv = headOf(s);
    if (hv === 'class' && !isNone(s[2]) && wordOf(s[2]) !== undefined) names.push([wordOf(s[2]), s]);
    if ((hv === 'def' || hv === 'void-def') && wordOf(s[2]) !== undefined) names.push([wordOf(s[2]), s]);
  };
  for (const s of stmts) {
    declared(s);
    if (isNodeP(s) && s[0] === 'export' && isStruct(s[2])) declared(s[2]);
  }
  return names;
}

// A structure's elements as the emitter's tree spells them: each either
// a word or a structure.
function emitterElements(x) {
  const out = [];
  const hv = headOf(x);
  if (isNodeP(x) && hv !== null && !(x[0] === 'catch' || x[0] === 'as' || x[0] === 'pickitem')) out.push({ word: hv });
  if (x[0] === 'call' && isNodeP(x)) out.push({});
  const start = isNodeP(x) ? 2 : 0;
  for (let i = start; i < x.length; i++) {
    const el = x[i];
    if (isNone(el)) continue;
    const w = wordOf(el);
    if (w !== undefined) out.push({ word: w });
    else if (typeof el === 'boolean') out.push({});
    else out.push({ node: el });
  }
  return out;
}

// A dot chain's tag and static classes (the render lowering's reading
// of `div.card#main`); tag null when the chain is not one.
function templateTag(x) {
  const classes = [];
  let cur = x;
  while (isNodeP(cur) && cur[0] === '.' && cur.length === 4) {
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
  if (!isNodeP(x) || x[0] !== '.' || x.length !== 4) return false;
  if (!isComponentName(wordOf(x[3]))) return false;
  let cur = x;
  while (isNodeP(cur) && cur[0] === '.' && cur.length === 4) {
    if (wordOf(cur[3]) === undefined) return false;
    cur = cur[2];
  }
  const root = wordOf(cur);
  return typeof root === 'string' && root !== 'this' && isIdentifierName(root);
}
