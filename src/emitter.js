// Subset emitter — compiles the parser's s-expressions to JS, writing
// every character THROUGH CodeBuilder so each emitted node and role gains
// exact MappingStore rows. Output shape:
// alphabetically-sorted `let` hoisting per scope (program and function
// bodies; assignment targets only, params excluded), compound operands
// parenthesized, `==`/`!=` lowered to `===`/`!==`, block statements with
// 2-space indentation.
//
// Mapping conventions:
//   - Every emitted node gets a `$self` row (source span from NodeStore).
//   - Grouping parens the emitter adds sit OUTSIDE role marks — they are
//     the parent's syntax, so role spans stay verbatim when the child's
//     code is.
//   - Spread roles get ONE row covering the whole emitted extent;
//     per-element rows come from each child node's own mappings.
//   - Statement semicolons and indentation sit outside all marks.
//
// The emitter never replaces AST arrays: it only reads the tree, so
// every WeakMap nodeId join stays live.

import { readFileSync } from 'fs';
import { Stores } from './stores.js';
import { CodeBuilder } from './builder.js';
import { descriptorSegments, paramNamesOf, splitTopLevelByComma } from './schema.js';
import { buildSchemaTypeStory, isModuleShaped, SchemaTypeError } from './schema-types.js';
import { Parser } from './parser.js';
import { applyInsertionPass, implicitBlocks, implicitObjects, implicitCalls, tagPostfixConditionals, rewriteTypes } from './lexer.js';
import { TypeTextError, normalizeTypeText, tidyType, renderTypeDecl, renderParams } from './typetext.js';
import { TEMPLATE_TAGS, SVG_TAGS, DOM_EVENTS, knownBareAttribute } from './dom-vocab.js';
import {
  COMPONENT_HOOKS, componentTypeInfo, memberDeclareSegments, isDeclarableMember,
  propsTypeSegments, propsTypeText, propsParamOptional, instanceTypeLines, containerType,
  syntacticLiteralType,
} from './component-types.js';

const BINOPS = new Set(['+', '-', '*', '/', '%', '**', '<', '>', '<=', '>=', '==', '!=', '&&', '||', '??', '<<', '>>', '>>>', '&', '^', '|']);
// 'void-assign' is the void definition (`save! = ->`): assignment
// shape throughout (hoisting, grouping tier, class-body walks); its
// own emission validates the function value and suppresses the
// implicit return. It emits as plain '='.
const ASSIGNS = new Set(['=', 'void-assign', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=', '<<=', '>>=', '>>>=', '&=', '^=', '|=']);

// Assignment heads that declare/mutate a RENDER LOCAL at a render
// child position : `=` declares, compound forms
// mutate. Other assign heads have no render reading and reject.
const RENDER_BINDING_HEADS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=']);
const RENDER_LOCAL_RE = /^[A-Za-z_$][\w$]*$/;
const JS_OP = { '==': '===', '!=': '!==' };

const isNode = (x) => Array.isArray(x);
const isBinary = (x) => isNode(x) && BINOPS.has(x[0]) && x.length === 3;
// The comparison family — every COMPARE-level operator chains,
// equality included (otherwise `a == b < c` silently compares a
// boolean against c).
const COMPARISONS = new Set(['<', '>', '<=', '>=', '==', '!=']);
// A chain LINK: a comparison whose LEFT child is itself a comparison
// the source did not parenthesize. The pair lowers to a conjunction
// sharing the middle operand (`a < b < c` → `(a < b) && (b < c)` —
// the chained-comparison lowering); explicit parens opt out
// (`(a < b) < c` stays a boolean-to-c comparison). This is the
// second reader of the `.parenthesized` flag (the postfix-if-else
// hoist guard is the first): both decisions are SEMANTIC — which
// program the source spells — and grouping never reads the flag.
const isChainLink = (x) => isNode(x) && COMPARISONS.has(x[0]) && x.length === 3 &&
  isNode(x[1]) && COMPARISONS.has(x[1][0]) && x[1].length === 3 && !x[1].parenthesized;
const isUnary = (x) => isNode(x) && (x[0] === '-' || x[0] === '+' || x[0] === '!' || x[0] === '~' || x[0] === 'typeof' || x[0] === 'delete') && x.length === 2;
const isAssign = (x) => isNode(x) && ASSIGNS.has(x[0]) && x.length === 3;
const isRelation = (x) => isNode(x) && (x[0] === 'in' || x[0] === 'of' || x[0] === 'instanceof') && x.length === 3;
const isIf = (x) => isNode(x) && x[0] === 'if';
const isRange = (x) => isNode(x) && (x[0] === '..' || x[0] === '...') && x.length === 3;
const isObject = (x) => isNode(x) && x[0] === 'object';
const isFunc = (x) => isNode(x) && (x[0] === '->' || x[0] === '=>') && x.length === 3;
// The def heads — plain and void — are ONE family everywhere a
// predicate asks "is this a def?": every def-shaped decision reads
// this helper, never a hand-maintained head pair (a site that listed
// only 'def' would silently misclassify void defs).
const isDefHead = (h) => h === 'def' || h === 'void-def';
const isUpdate = (x) => isNode(x) && (x[0] === '++' || x[0] === '--') && x.length === 3;
const isTernary = (x) => isNode(x) && x[0] === '?:' && x.length === 4;
const isBlock = (x) => isNode(x) && x[0] === 'block';
// Render-DSL name classes: template tags come from the
// spec-derived vocabulary; PascalCase names (an interior lowercase
// letter distinguishes `Counter` from ALLCAPS constants) are
// component references.
const isHtmlTag = (name) => TEMPLATE_TAGS.has(String(name).split('#')[0]);
const isComponentName = (name) => typeof name === 'string' && /^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/.test(name);
const STATEMENT_HEADS = new Set(['for-in', 'for-of', 'for-as', 'switch', 'try', 'throw', 'loop', 'comprehension']);
const isLoopNode = (x) => isNode(x) && (
  ((x[0] === 'for-in' || x[0] === 'for-of' || x[0] === 'for-as') && x.length === 6) ||
  (x[0] === 'while' && (x.length === 3 || x.length === 4)) ||
  (x[0] === 'loop' && x.length === 2));

class Emitter {
  constructor(stores, builder, { face = 'js', pins = null, strict = false } = {}) {
    this.stores = stores;
    this.b = builder;
    // Tier 3 pins (TS face only): Map of `${name}@${valueHash}` → type
    // text, supplied by the editor's probe pass. Names the scan reports
    // as pinnable (still hoisted + nested occurrence) collect in
    // `pinnables` for the emit() result, whatever face is running.
    this.pins = pins;
    this.pinnables = [];
    // rip.strict (presentation-only, E): typed forwards and pins emit
    // WITHOUT the `!` definite-assignment assertion, so use-before-
    // assign is checked (TS2454) instead of silenced. TS-only glyphs
    // either way — strip-parity is unaffected by the flag.
    this.strict = strict;
    // The emission face: 'js' is the shipping emission — every
    // byte as today; 'ts' is the editor face — the SAME emission
    // plus TypeScript type syntax, every added byte recorded as a
    // builder tsOnly region so stripping the regions reproduces the
    // JS emission byte-for-byte (the byte-equality invariant,
    // gated in test/tsface.test.js). Never a shipping target.
    this.ts = face === 'ts';
    // Pending hoist-line annotations for the NEXT hoist line (TS face
    // only): name → the node whose 'annotation' role types it — the
    // first annotated assignment or bare typed forward declaration the
    // scope's collection saw. Populated by hoistTargets' walk (raw
    // blocks: def/method bodies, nested branches) and by liveStmts'
    // erased branch (scope-level lists that filter before hoisting:
    // program, function expressions); consumed and cleared by
    // hoistLine, so entries never cross scopes.
    this.pendingHoistTypes = new Map();
    // TS directive comments (TS face only): statement node → the
    // directives governing it (collectTsDirectives' attachment
    // pre-pass); the file-level `@ts-nocheck` record; and the
    // scope-pending list for directives above bare typed forwards,
    // consumed by the scope's hoist line exactly like
    // pendingHoistTypes.
    this.tsDirectiveMap = new Map();
    this.tsNocheck = null;
    this.pendingHoistDirectives = [];
    // Armed by emit() for the real emission pass only: the delivery
    // decision's read-only pre-walks (programScopeNames) run the same
    // hoistTargets collector and must not consume attachments.
    this.tsDirectivesArmed = false;
    // Bodiless overload signatures (def-sig) keyed by the implementing
    // def node (TS face only): the def's emission prints each signature
    // immediately above itself — TypeScript requires overload
    // signatures adjacent to their implementation (TS2391).
    this.pendingSigs = new WeakMap();
    // Type declarations from SLOTLESS lowered positions (TS face only):
    // a ternary-lowered value-if branch has no statement slot, so its
    // type/interface declarations queue here and flush as TS-only
    // cluster lines after the enclosing statement — TS hoists type
    // declarations, so the displaced line still governs its uses.
    this.pendingTypeDecls = [];
    // Component type stories (TS face only): component node →
    // the walked member/props info. Populated by componentExpr (the
    // one place the member model is authoritative), consumed by the
    // companion-interface emission after the binding statement.
    this.componentInfo = new Map();
    // Module-scope component binding names → their component node
    // (BOTH modes): a name bound to a second component rejects — the
    // rebinding clobbers the first class silently, and the typed
    // artifacts would merge two same-named companion interfaces. The
    // node keys re-emission idempotence (the builder probe emits
    // a statement twice).
    this.moduleComponentNames = new Map();
    // Current statement indentation — read by expression-position
    // constructs that open blocks (function bodies).
    this.ind = 0;
    // The class-method name being emitted — bare super calls resolve
    // through it (super(...) in the constructor, super.<name>(...)
    // elsewhere); null outside class methods.
    this.methodName = null;
    // Enclosing-scope declared names (program hoists + import bindings
    // + each function's params and hoists). A nested function hoists
    // only names NOT visible in this chain — assigning an outer
    // variable must not shadow it.
    this.scopes = [];
    // The program's final statement — a statement-position
    // comprehension there emits as a value IIFE, and as a plain loop
    // everywhere else.
    this.lastProgramStmt = null;
    // True while emitting INSIDE a destructuring pattern (assignment
    // targets, param patterns, catch bindings, pattern loop variables).
    // Pattern positions are BINDING targets, not expressions: operand
    // grouping there produces invalid JS (`[(a = 1)]`), so `=` nodes
    // emit bare as defaults and no item/value ever wraps. A default's
    // VALUE re-enters expression context.
    this.inPattern = false;
    // True while the current pattern is a BINDING pattern (params,
    // loop variables) rather than a TARGET pattern (assignment
    // targets, catch bindings) — the classes the `rest x` sugar
    // distinguishes (see withPattern).
    this.bindingPattern = false;
    // True while emitting an optional-chain assignment's target spine
    // (see withDeopt).
    this.deopt = false;
    // True while emitting an assignment/update TARGET — the position
    // where read-only lowerings (`.at(-n)`) have no valid JS form.
    this.inTarget = false;
    // Function nodes whose DEFINITION carries the void marker
    // (`save! = ->`, `fn!: ->`): their bodies suppress the implicit
    // return and end with a bare `return;`. Registered by the owning
    // definition's emission before the value emits (a void def
    // carries the marker in its own head and needs no registration).
    this.voidFuncs = new WeakSet();
    // True while emitting the statements of a void function's body —
    // a value-carrying `return` there is an error (the function is
    // declared to return undefined). Saved/restored per function.
    this.sideEffectOnly = false;
    // Set by schemaExpr — the emit() entry reports it as the 'schema'
    // feature runtime so delivery can inject exactly when used.
    this.usesSchema = false;
    // Current expression-descent depth — the deterministic nesting
    // bound: every recursive cycle in the emitter passes
    // through expr(), so one counter bounds the native stack and a
    // too-deep tree rejects as a positioned diagnostic instead of an
    // engine RangeError at a machine-dependent depth.
    this.exprDepth = 0;
    // The binding name a schema value takes (assignment threading).
    this._schemaName = null;
    // Schema callable bodies, sub-parsed ONCE per captured token slice
    // and shared between the delivery decision (emit() walks the
    // sub-trees for runtime triggers before any code emits) and
    // emission (schemaFnCode reads the same parse). Keyed by the
    // captured token array's identity — the descriptor carries one
    // stable array per body.
    this.subParses = new Map();
    // Chained-comparison temps: a chain's middle operand with
    // a node shape (any compound — re-evaluation is observable, down
    // to valueOf/toString coercion) caches in a fresh `_ref` hoisted
    // at the owning scope's let line, so it evaluates exactly once
    // `byNode` keys each allocation on the chain LINK whose conjunct
    // reads the temp; `used` holds every identifier the module's
    // trees spell (filled by emit() before any allocation) so fresh
    // names never collide; `n` is the monotonic allocation cursor.
    // Shared with sub-emitters (schema callable bodies).
    this.temps = { used: new Set(), n: 0, byNode: new WeakMap() };
    // Reactive scope frames, innermost last: { reactive, bound }.
    // `reactive` is the set of names the frame's scope declares with
    // `:=`/`~=`; `bound` is every OTHER binding the scope introduces
    // (params, hoist targets, imports, defs/classes/enums, loop
    // variables, catch bindings). A name READS reactive iff the
    // innermost frame that knows it at all knows it as reactive —
    // shadowing is scope-aware BY CONSTRUCTION from the tree
    this.rframes = [];
    // Component frames, innermost last. A frame ALSO enters
    // rframes (with `members`/`memberReactive` keys) so bare-name
    // resolution is one innermost-first walk: locals and params
    // shadow members; members shadow module names. cframes carries
    // the extra per-component emission state (the declared name for
    // data-part, the render var counters).
    this.cframes = [];
    // The binding name a component value takes (assignment threading —
    // the _schemaName pattern); drives the data-part attribute.
    this._componentName = null;
    // Module bindings outside the hoist line (exports, classes, defs)
    // — the child-component name resolution's second channel.
    this.moduleBound = new Set();
    // The render-factory self prefix: null everywhere except
    // inside a block factory's deferred emission, where component
    // members and `this`/`@` chains read through the factory's `ctx`
    // parameter (the factory methods are called unbound — `this` there
    // is the block handle, never the instance).
    this.renderSelf = null;
  }

  // ── Reactive declarations ──────────────────────────────────

  // Is this node a REAL reactive declaration — not a user call that
  // impersonates the head? The heads are spellable shapes
  // (`["state", target, value]` — `state a, 0` builds the same array),
  // so the sexpr alone cannot discriminate; the NodeStore semanticKind
  // can, and is the decider everywhere (the locked-head record).
  isReactiveDecl(x) {
    return Emitter.isReactiveDeclIn(this.stores, x);
  }

  // The stores-parameterized twin: the delivery decision walks schema
  // sub-trees, whose semanticKinds live in the SUB-parse's stores.
  static isReactiveDeclIn(stores, x) {
    if (!isNode(x) || (x[0] !== 'state' && x[0] !== 'computed') || x.length !== 3) return false;
    const id = stores.idOf(x);
    const kind = id !== null ? stores.node(id)?.semanticKind : null;
    return kind === 'state' || kind === 'computed';
  }

  // A REAL effect — same discrimination as the reactive
  // declarations: the head is a spellable sexpr shape (["effect",
  // target, body] — `effect h, 5` builds the same array), so the
  // NodeStore semanticKind decides (the locked-head
  // convention). Covers both the bare form (target null) and
  // the bound form (the dispose handle).
  isEffectDecl(x) {
    return Emitter.isEffectDeclIn(this.stores, x);
  }

  static isEffectDeclIn(stores, x) {
    if (!isNode(x) || x[0] !== 'effect' || x.length !== 3) return false;
    const id = stores.idOf(x);
    const kind = id !== null ? stores.node(id)?.semanticKind : null;
    return kind === 'effect';
  }

  // A REAL readonly declaration — the same discrimination:
  // the head is a spellable shape (["readonly", target, value] —
  // `readonly x, 5` builds the identical array —
  // the impersonation class), so the NodeStore semanticKind decides.
  isReadonlyDecl(x) {
    return Emitter.isReadonlyDeclIn(this.stores, x);
  }

  static isReadonlyDeclIn(stores, x) {
    if (!isNode(x) || x[0] !== 'readonly' || x.length !== 3) return false;
    const id = stores.idOf(x);
    const kind = id !== null ? stores.node(id)?.semanticKind : null;
    return kind === 'readonly';
  }

  // A MODULE import statement — not the dynamic-import CALL, whose
  // node spells the same head ("import" is the keyword's token value:
  // ["import", url] / ["import", url, options] vs ["import", spec…,
  // source]). The shapes collide at three elements —
  // `import(Foo, "./m.js")` builds the same array as
  // `import Foo from "./m.js"` — so length alone cannot discriminate;
  // the NodeStore semanticKind decides :
  // the statement rules annotate 'import', the call rules 'dynimport'.
  isModuleImport(x) {
    return Emitter.isModuleImportIn(this.stores, x);
  }

  static isModuleImportIn(stores, x) {
    if (!isNode(x) || x[0] !== 'import' || x.length < 3) return false;
    const id = stores.idOf(x);
    const kind = id !== null ? stores.node(id)?.semanticKind : null;
    return kind === 'import';
  }

  // Reactive names a statement list's OWN scope declares. The walk
  // mirrors hoistTargets' boundaries: function bodies are separate
  // scopes; class bodies declare fields, not scope names (reactive
  // members reject at emission); `export` wraps a module-scope
  // declaration and collects THROUGH it uniformly, so
  // `export count := 0` is order-independent
  //
  // A declaration NESTED in a statement block (an if/while/loop/for/
  // switch/try body, a bare block) rejects here: the lowering is a
  // BLOCK-scoped const, but the unwrap set is scope-granular at
  // functions — a read after the block would emit `.value` off a
  // binding that no longer exists
  //. Module and function scope are the declaration
  // positions with a coherent reading.
  static BLOCK_HEADS = new Set(['if', 'while', 'loop', 'for-in', 'for-of', 'for-as', 'switch', 'when', 'try', 'block', 'comprehension']);

  collectReactiveNames(stmts) {
    const names = new Set();
    const walk = (n, nested) => {
      if (!isNode(n) || isDefHead(n[0]) || isFunc(n) || n[0] === 'class' || n[0] === 'enum') return;
      // A component body is the member model's, never scope
      // declarations.
      if (n[0] === 'component' && n.length === 3) return;
      if (this.isReactiveDecl(n)) {
        if (nested) {
          const op = n[0] === 'state' ? ':=' : '~=';
          throw this.positionedError(n,
            `emitter: a reactive declaration ('${typeof n[1] === 'string' ? n[1] : '…'} ${op} …') must sit at module or function scope — ` +
            `inside a statement block it lowers to a block-scoped const, and any later read would unwrap '.value' off a binding ` +
            `that no longer exists`,
          );
        }
        if (typeof n[1] === 'string') names.add(n[1]);
        // The value never contributes: expression positions reject
        // nested declarations, and a computed's multi-statement block
        // is its OWN scope (computedBody opens its own frame).
        return;
      }
      // An effect body is its OWN function scope — declarations inside
      // it collect when the body emits, never here.
      if (this.isEffectDecl(n)) return;
      const below = nested || Emitter.BLOCK_HEADS.has(n[0]);
      for (const el of n) walk(el, below);
    };
    for (const n of stmts) walk(n, false);
    return names;
  }

  // Effect dispose handles a statement list's OWN scope binds (`h ~>
  // body` lowers to `const h = __effect(…)`). Same walk boundaries as
  // collectReactiveNames, same declaration-position rule: a BOUND
  // effect nested in a statement block would bind a block-scoped
  // const in a language where every other binding is function-scoped
  // — the same stale-handle rule extends to the handle, so it rejects here.
  // BARE effects (target null) are expression statements and stay
  // legal anywhere a statement sits.
  collectEffectHandles(stmts) {
    const names = new Set();
    const walk = (n, nested) => {
      if (!isNode(n) || isDefHead(n[0]) || isFunc(n) || n[0] === 'class' || n[0] === 'enum') return;
      if (n[0] === 'component' && n.length === 3) return;
      if (this.isReactiveDecl(n)) return;
      if (this.isEffectDecl(n)) {
        if (n[1] !== null) {
          if (nested) {
            throw this.positionedError(n,
              `emitter: a bound effect ('${typeof n[1] === 'string' ? n[1] : '…'} ~> …') must sit at module or function scope — ` +
              `inside a statement block its dispose handle would be a block-scoped const, dead to every later read ` +
              `; a BARE '~> …' stays legal here`,
            );
          }
          if (typeof n[1] === 'string') names.add(n[1]);
        }
        // The body is its own function scope (bare and bound alike).
        return;
      }
      const below = nested || Emitter.BLOCK_HEADS.has(n[0]);
      for (const el of n) walk(el, below);
    };
    for (const n of stmts) walk(n, false);
    return names;
  }

  // Readonly names a statement list's OWN scope declares (`x =! e`
  // lowers to `const x = e`). Same walk boundaries and the same
  // declaration-position rule as the dispose handles: a block-nested
  // readonly would bind a block-scoped const in a language where
  // every other binding is function-scoped — dead to every later
  // read or write (the stale-handle class extends here).
  collectReadonlyNames(stmts) {
    const names = new Set();
    const walk = (n, nested) => {
      if (!isNode(n) || isDefHead(n[0]) || isFunc(n) || n[0] === 'class' || n[0] === 'enum') return;
      if (n[0] === 'component' && n.length === 3) return;
      if (this.isReactiveDecl(n) || this.isEffectDecl(n)) return;
      if (this.isReadonlyDecl(n)) {
        if (nested) {
          throw this.positionedError(n,
            `emitter: a readonly declaration ('${typeof n[1] === 'string' ? n[1] : '…'} =! …') must sit at module or function scope — ` +
            `inside a statement block it lowers to a block-scoped const, dead to every later read ` +
            ``,
          );
        }
        if (typeof n[1] === 'string') names.add(n[1]);
        // The value is expression territory (a nested declaration
        // there rejects at emission — the #79 class).
        walk(n[2], nested);
        return;
      }
      const below = nested || Emitter.BLOCK_HEADS.has(n[0]);
      for (const el of n) walk(el, below);
    };
    for (const n of stmts) walk(n, false);
    return names;
  }

  // An Error carrying the node's source span (offsets) — compile()
  // formats it as path:line:col with a caret, the same shape lexer
  // and parse diagnostics take. Every emitter rejection throws
  // through here; `fallbacks` are enclosing nodes tried in order when
  // the offending position is a primitive or an unregistered node
  // (only constructed nodes carry NodeStore rows ).
  positionedError(node, message, ...fallbacks) {
    const err = new Error(message);
    for (const n of [node, ...fallbacks]) {
      const id = this.stores.idOf(n);
      const span = id !== null ? this.stores.selfSpan(id) : null;
      if (span) {
        err.start = span[0];
        err.end = span[1];
        break;
      }
    }
    return err;
  }

  // The explicit-span variant, for offending positions that are
  // primitives with no NodeStore row (a bare enum member): the span
  // is DERIVED from recorded neighbor rows, never invented.
  positionedErrorAt(start, end, message) {
    const err = new Error(message);
    err.start = start;
    err.end = end;
    return err;
  }

  // Non-hoist bindings a scope's statement list declares (def
  // functions, class declarations, enum consts — bare and exported):
  // shadow detection needs them in the frame's bound set, but they
  // must NOT enter this.scopes (hoist filtering has its own rules).
  static declaredNames(stmts) {
    const names = [];
    const declared = (s) => {
      if (!isNode(s)) return;
      if ((s[0] === 'enum' || s[0] === 'class') && typeof s[1] === 'string') names.push(s[1]);
      if (isDefHead(s[0]) && s.length === 4 && typeof s[1] === 'string') names.push(s[1]);
    };
    for (const s of stmts) {
      declared(s);
      if (isNode(s) && s[0] === 'export' && isNode(s[1])) declared(s[1]);
    }
    return names;
  }

  // Open a reactive frame for a scope (paired with a this.scopes push
  // at every function/program scope; loop/catch frames are
  // binding-only and push no scope). Returns every const-declared
  // name the scope's declarations bind — reactive names, effect
  // dispose handles, AND readonly names — so the caller can extend
  // its scope-name set (a nested function assigning one must not
  // shadow-hoist it). Handles and readonly names enter the frame's
  // BOUND set, never the reactive set: both are plain consts (reads
  // never unwrap), and each shadows any outer reactive name it
  // re-binds.
  pushReactiveFrame(stmts, bound) {
    const reactive = this.collectReactiveNames(stmts);
    const handles = this.collectEffectHandles(stmts);
    const readonly = this.collectReadonlyNames(stmts);
    this.rframes.push({
      reactive,
      bound: new Set([...bound, ...Emitter.declaredNames(stmts), ...handles, ...readonly]),
    });
    return new Set([...reactive, ...handles, ...readonly]);
  }

  // A binding-only frame (loop variables, catch bindings): the names
  // shadow outer reactive names for the wrapped emission.
  withBindings(names, fn) {
    this.rframes.push({ reactive: new Set(), bound: new Set(names) });
    fn();
    this.rframes.pop();
  }

  // How does a bare identifier READ here? One innermost-first walk
  // over the reactive frames decides: 'reactive' (a `:=`/`~=` name —
  // unwraps to `.value`), 'member-reactive' / 'member' (a component
  // member — rewrites to `this.name.value` / `this.name` — the reactive
  // rewrite's component-scope twin), or null (a plain name). Locals and params
  // shadow members; members shadow module names — within one frame
  // the reactive set wins (the declaration IS the binding).
  resolveBareRead(name) {
    for (let i = this.rframes.length - 1; i >= 0; i--) {
      const f = this.rframes[i];
      if (f.reactive.has(name)) return 'reactive';
      if (f.bound.has(name)) return null;
      if (f.members !== undefined && f.members.has(name)) {
        return f.memberReactive.has(name) ? 'member-reactive' : 'member';
      }
    }
    return null;
  }

  // Does `name` read (or write) as a reactive container here?
  isReactiveName(name) {
    return this.resolveBareRead(name) === 'reactive';
  }

  // The read/write rewrite decision for a bare identifier in the
  // emission stream — reactive names AND component members. BINDING
  // patterns (params, loop variables) are new names, never reads;
  // TARGET patterns assign into the container (`[a.value, b] = pair`).
  bareRewrite(name) {
    if (this.inPattern && this.bindingPattern) return null;
    return this.resolveBareRead(name);
  }

  isReactiveRead(name) {
    return this.bareRewrite(name) === 'reactive';
  }

  // Is `this.<name>` a REACTIVE member of the innermost enclosing
  // component? ThisProperty reads/writes never shadow (the `this.` is
  // explicit), and `this` always means the INNERMOST component — outer
  // frames never answer.
  memberIsReactive(name) {
    const f = this.cframes[this.cframes.length - 1];
    return f !== undefined && f.memberReactive.has(name);
  }

  inComponent() {
    return this.cframes.length > 0;
  }

  // Emit an unwrapped reactive read: `count` → `count.value`. When the
  // innermost open mark's SOURCE SPAN is exactly this identifier (the
  // operand/value/target role of the read site), the bare identifier
  // re-marks that same (nodeId, role) — an EXACT row on the read site
  // nested inside the role's cover row over the full `count.value`
  // (§4.1 one-to-many; serialization prefers the exact row, so a
  // breakpoint on the read lands on the identifier). Any other
  // enclosing span (a spread args role, a lowered construct's $self)
  // gains no inner row — re-marking it around the identifier would
  // serialize a name row whose source text is not the identifier.
  reactiveRead(name) {
    const m = this.b.currentMark;
    const src = this.b.source;
    if (m !== null && src !== null && src.slice(m.sourceStart, m.sourceEnd) === name) {
      this.b.mark(m.nodeId, m.role, () => this.b.emit(name));
    } else {
      this.b.emit(name);
    }
    this.b.emit('.value');
  }

  // Emit a component-member read/write: `count` → `this.count.value`
  // (reactive) / `note` → `this.note` (plain) — the reactive member rewrite's
  // component-scope twin. The mark strategy mirrors reactiveRead: when
  // the innermost open mark's source span is exactly this identifier,
  // the name re-marks the same (nodeId, role) — an exact row on the
  // read site inside the role's cover row over the lowered form.
  memberRead(name, reactive) {
    const m = this.b.currentMark;
    const src = this.b.source;
    this.b.emit((this.renderSelf ?? 'this') + '.');
    if (m !== null && src !== null && src.slice(m.sourceStart, m.sourceEnd) === name) {
      this.b.mark(m.nodeId, m.role, () => this.b.emit(name));
    } else {
      this.b.emit(name);
    }
    if (reactive) this.b.emit('.value');
  }

  // The void marker's contract: the annotated
  // value must be a function. `->`/`=>` register for void emission;
  // a def value passes through to its own (currently loud) expression-
  // position handling; anything else rejects here.
  registerVoidValue(value, owner) {
    if (isFunc(value)) {
      this.voidFuncs.add(value);
      return;
    }
    if (!(isNode(value) && isDefHead(value[0]))) {
      throw this.positionedError(value, "emitter: the void marker (a trailing '!' on the defined name) requires a function value — `save! = ->`, `save! = =>`, `fn!: ->`", owner);
    }
  }

  withTarget(fn) {
    const prev = this.inTarget;
    this.inTarget = true;
    fn();
    this.inTarget = prev;
  }

  // `binding` distinguishes the two pattern
  // classes: BINDING patterns (params, loop variables) accept the
  // `rest x` sugar as a JS rest element; TARGET patterns (assignment
  // targets, catch bindings — catch lowers through an assignment)
  // reject it ("Cannot use 'rest' expression as a destructuring
  // target" — destructuring rest is spelled `...name`).
  withPattern(fn, binding = false) {
    const prevPattern = this.inPattern;
    const prevBinding = this.bindingPattern;
    this.inPattern = true;
    this.bindingPattern = binding;
    fn();
    this.inPattern = prevPattern;
    this.bindingPattern = prevBinding;
  }

  withExpression(fn) {
    const prevPattern = this.inPattern;
    const prevBinding = this.bindingPattern;
    this.inPattern = false;
    this.bindingPattern = false;
    fn();
    this.inPattern = prevPattern;
    this.bindingPattern = prevBinding;
  }

  // True while emitting the TARGET spine of an optional-chain
  // assignment: every optional link lowers to its plain form (`?.` →
  // `.`, optindex → index) — JS forbids optional chains anywhere in an
  // assignment target, and the emitted guard already proved the spine
  // non-null. Off-spine positions (index keys) re-enter normal context.
  withDeopt(fn) {
    const prev = this.deopt;
    this.deopt = true;
    fn();
    this.deopt = prev;
  }

  // Mark when the node is registered and the role exists ($self always
  // exists — it is a NodeStore lookup); otherwise emit unmarked. This is
  // how un-annotated constructions (kind null) emit without role rows.
  mark(node, role, fn) {
    const id = this.stores.idOf(node);
    if (id !== null && (role === '$self' || this.stores.role(id, role) !== null)) {
      this.b.mark(id, role, fn);
    } else {
      fn();
    }
  }

  // The imperative pair mark() wraps, with the same registered-role
  // conditioning: beginMark reports whether a builder frame opened,
  // and endMark takes that report back. Iterative chain emission
  // (binary/member/call spines) holds these as frame DATA — a deep
  // chain never nests callbacks.
  beginMark(node, role) {
    const id = this.stores.idOf(node);
    if (id !== null && (role === '$self' || this.stores.role(id, role) !== null)) {
      this.b.beginMark(id, role);
      return true;
    }
    return false;
  }

  endMark(opened) {
    if (opened) this.b.endMark();
  }

  // ── The TS face (the editor face) ─────────────────────────────────
  // Every method below is a no-op path in JS mode: the TS face emits
  // the SAME code through the SAME mark protocol, plus TypeScript type
  // syntax whose every byte records as a builder tsOnly region.
  // Annotation text always renders from the RECORDED store spans (annotation
  // side-band roles) or the lexer's opaque TYPE_DECL/typed-var values —
  // never re-derived, never invented.

  // The recorded annotation text for (node, role): the role's source
  // slice, annotation sigil stripped, layout-normalized. Null when the
  // node carries no such role (untyped constructs) or the role is
  // literal-sourced (no span).
  annotationText(node, role = 'annotation') {
    const id = this.stores.idOf(node);
    if (id === null) return null;
    const row = this.stores.role(id, role);
    if (!row || row.sourceStart == null || this.b.source === null) return null;
    return normalizeTypeText(this.b.source.slice(row.sourceStart, row.sourceEnd).replace(/^\s*:\s*/, ''));
  }

  // Emit `: T` as a TS-only region, re-marked under (node, role) — the
  // annotation's generated manifestation (§4.1 one-to-many; exact when
  // the emitted bytes equal the recorded span verbatim, cover
  // otherwise — the builder decides, never a declaration).
  tsAnnotate(node, role, text) {
    this.b.tsOnly(() => this.mark(node, role, () => this.b.emit(`: ${text}`)));
  }

  // A function's TS-face return annotation, emitted after its param
  // list. The recorded returnType role when present — an ASYNC
  // function wraps it as Promise<T> (the TS spelling of the same
  // annotation: a Rip return type names what the caller awaits, and
  // TS requires the async wrapper spelled out, TS1064) unless the
  // user already spelled the Promise. A void definition without one
  // annotates `: void` under the voidMarker role — the `!`'s second
  // generated manifestation (arrows registered void through their
  // owning definition carry no voidMarker role of their own; their
  // `: void` emits unmarked inside the enclosing $self cover).
  tsReturnAnnotation(node, isAsync, isVoid, voidOwner = node) {
    if (!this.ts) return;
    const text = this.annotationText(node, 'returnType');
    if (text !== null) {
      const spelled = isAsync && !/^Promise\s*</.test(text) ? `Promise<${text}>` : text;
      this.b.tsOnly(() => this.mark(node, 'returnType', () => this.b.emit(`: ${spelled}`)));
      return;
    }
    if (isVoid) {
      const spelled = isAsync ? 'Promise<void>' : 'void';
      this.b.tsOnly(() => this.mark(voidOwner, 'voidMarker', () => this.b.emit(`: ${spelled}`)));
    }
  }

  // Shared-renderer rejections (src/typetext.js), positioned on the
  // offending statement: a malformed alias body fails the TS-face
  // compile from the declaration's own span (rule 5), with the same
  // message class the dts consumer raises.
  tsRendered(stmt, fn) {
    try {
      return fn();
    } catch (err) {
      if (err instanceof TypeTextError) throw this.positionedError(stmt, `emitter: ${err.message}`);
      throw err;
    }
  }

  // TS-face emission of the type/interface declarations a statement
  // LIST carries (whole statements the JS emission erases). They print
  // clustered at the top of the list's emission at its padding: TS
  // type declarations are scope-hoisted, so placement inside the list
  // is free, and clustering keeps the JS emission's own layout
  // untouched. Bare typed forwards contribute to the hoist line
  // instead; def-sig overloads print adjacent to their implementation
  // (pendingSigs — TS2391 demands adjacency). Every lowered body WITH
  // statement slots (try/switch/if IIFEs, accumulator loop bodies,
  // catch-pattern handlers) makes this same call; the one SLOTLESS
  // position — a ternary-lowered value-if branch — queues its
  // declarations instead (pendingTypeDecls) for the enclosing
  // statement list's flush. Zero-width rows still record for every
  // erased statement (liveStmts), so reverse queries resolve.
  emitTsTypeDecls(list, pad) {
    if (!this.ts) return;
    for (const s of list) {
      if (!isNode(s) || s[0] !== 'type-decl') continue;
      this.tsTypeDeclLine(s, pad);
    }
  }

  // One rendered type/interface declaration as a TS-only cluster line.
  tsTypeDeclLine(s, pad) {
    const lines = this.tsRendered(s, () => renderTypeDecl(s[1]));
    // A directive above the declaration follows it to its cluster
    // line — ONLY when the rendered declaration is a single
    // line, where a genuine error suppresses there and an unused
    // directive self-reports TS2578. A multi-line body (object
    // alias, interface) declines: its errors land on inner lines
    // the directive cannot govern (place-or-decline).
    const directives = this.tsDirectiveMap.get(s);
    if (directives !== undefined) {
      this.tsDirectiveMap.delete(s);
      if (lines.length === 1) {
        for (const d of directives) this.tsDirectiveLine(d, pad, true);
      }
    }
    this.b.tsOnly(() => {
      this.b.emit(pad);
      this.mark(s, '$self', () => this.mark(s, 'declaration', () => {
        this.b.emit(lines.join('\n' + pad));
      }));
      this.b.emit('\n');
    });
  }

  // Drain the slotless-position queue (pendingTypeDecls) as TS-only
  // cluster lines at the enclosing statement list's padding. TS hoists
  // type declarations, so a line displaced from its ternary-lowered
  // branch still governs every use. `atListEnd` marks the one call
  // site whose preceding statement carries no trailing newline (a
  // program's final statement) — the flush supplies it, TS-only.
  flushPendingTypeDecls(pad, atListEnd = false) {
    if (!this.ts || this.pendingTypeDecls.length === 0) return;
    const pending = this.pendingTypeDecls;
    this.pendingTypeDecls = [];
    if (atListEnd) this.b.tsOnly(() => this.b.emit('\n'));
    for (const s of pending) this.tsTypeDeclLine(s, pad);
  }

  // ── The component face ──────────────────────────────────────
  // Segment lists from src/component-types.js: named pieces re-mark
  // their recorded store rows (the builder decides exact vs cover by
  // verbatim comparison; mark() no-ops where a role has no row — the
  // span-less optional glyphs), plain pieces emit bare.
  emitSegments(segs) {
    for (const s of segs) {
      if (s.node !== undefined) this.mark(s.node, s.role, () => this.b.emit(s.text));
      else this.b.emit(s.text);
    }
  }

  // TS-only member declares at the class top: one `declare name: T;`
  // line per non-callable member (methods/hooks are real class methods
  // and annotate through the shared param/return machinery), the
  // `children` projection slot, the `rest` view under extends, and the
  // `_`-prefix index signature — the compiler/runtime slot namespace
  // (`__`-prefixed user names reject at parse; minted `_el0`/`_t0`/
  // `_inst1` slots and the runtime's own `_root`/`_frame` family all
  // land here), so member accesses never draw TS2339-class noise on
  // generated shapes.
  tsComponentMemberDeclares(info, pad) {
    const line = (fn) => this.b.tsOnly(() => {
      this.b.emit(pad);
      fn();
      this.b.emit('\n');
    });
    let hasChildren = false;
    for (const m of info.members) {
      if (m.name === 'children') hasChildren = true;
      if (!isDeclarableMember(m)) continue;
      line(() => this.emitSegments(memberDeclareSegments(m)));
    }
    if (!hasChildren) line(() => this.b.emit('declare children: any;'));
    if (info.extendsTag !== null) line(() => this.b.emit(`declare rest: ${containerType('Record<string, any>')};`));
    line(() => this.b.emit('[key: `_${string}`]: any;'));
  }

  // Minted render-scaffold declarations type `any` in the face
  // (TS-only): the scaffold is the lowering's own state, and its
  // inference is FLAG-dependent (a `let x = null` evolves only under
  // noImplicitAny; strictNullChecks varies with the user's tsconfig
  // an explicit `any` keeps swap/reconcile internals
  // quiet under every posture, so effect lines that carry mapped rows
  // to user constructs never inherit scaffold noise.
  tsScaffoldAny(suffix = '') {
    if (this.ts) this.b.tsOnly(() => this.b.emit(`: any${suffix}`));
  }

  // An event listener's handler CALL casts `as any` in the face
  // (TS-only): the listener always passes the event object, and a
  // handler declaring fewer parameters is legal Rip (JS ignores extra
  // arguments) — TypeScript's arity check (TS2554) is the one
  // diagnostic this call shape can draw, and it would land on the
  // user's directive span. The handler EXPRESSION keeps its own marks
  // (hover/references reach the method); only the call shape quiets.
  // The cast wraps the expression in TS-ONLY grouping parens — an
  // arrow-valued handler would otherwise swallow the cast into its
  // body (`() => body as any` parses as `() => (body as any)`, and
  // the arity error survives). JS bytes unchanged.
  tsHandlerCast(fn) {
    if (!this.ts) return fn();
    this.b.tsOnly(() => this.b.emit('('));
    fn();
    this.b.tsOnly(() => this.b.emit(') as any'));
  }

  // The TS-only constructor: the props SURFACE —
  // `new Counter({ label: … })` checks and completes against the
  // declared props. A whole face-only line; stripping removes it and
  // the runtime's own constructor governs as in JS mode. Under a
  // REQUIRED prop, the inherited static `mount` narrows to `never` —
  // non-callable, so `Counter.mount()` errors (it constructs with NO
  // props — tsc-clean while the runtime yields a required container
  // holding undefined; 's F2. Requiredness is
  // a type-story fact — the annotation erases, so the gate can
  // never be a runtime throw). `never` because the override must
  // stay assignable to the REAL base's static side in the editor
  // (inline runtime — TS2417 otherwise); only bottom is both
  // assignable and uncallable.
  tsComponentCtor(info, pad) {
    if (!propsParamOptional(info)) {
      this.b.tsOnly(() => this.b.emit(`${pad}declare static mount: never;\n`));
    }
    this.b.tsOnly(() => {
      this.b.emit(`${pad}constructor(props${propsParamOptional(info) ? '?' : ''}: `);
      this.emitSegments(propsTypeSegments(info));
      this.b.emit(') { super(props); }\n');
    });
  }

  // The companion interface (the enum type-companion pattern): a
  // component binding is a VALUE (an anonymous class expression), so
  // an annotation naming it (`c: Counter`) would find no type; the
  // instance surface is the honest companion, and TS's separate
  // type/value namespaces make the same-name pairing legal. Emitted
  // after the binding statement, for plain-name bindings only.
  tsComponentCompanion(compNode, name, exported, typeParams = null) {
    if (!this.ts) return;
    const info = this.componentInfo.get(compNode);
    if (info === undefined) return;
    const pad = '  '.repeat(this.ind);
    // Generic component: the companion interface
    // carries the declaration's type params, and self-references in
    // the instance surface apply the bare param NAMES (`mount():
    // Select<TOption>` — extends clauses stay on the header).
    const selfArgs = typeParams === null ? '' :
      '<' + typeParams.slice(1, -1).split(',').map((p2) => p2.trim().split(/\s/)[0]).join(', ') + '>';
    this.b.tsOnly(() => {
      this.b.emit('\n' + pad);
      this.mark(compNode, '$self', () => {
        const lines = [
          `${exported ? 'export ' : ''}interface ${name}${typeParams ?? ''} {`,
          ...instanceTypeLines(info, `${name}${selfArgs}`).map((l) => `  ${l}`),
          '}',
        ];
        this.b.emit(lines.join('\n' + pad));
      });
    });
  }

  // ── TS directive comments ───────────────────────────────────
  //
  // A whole-line Rip comment spelling a TypeScript directive —
  // `# @ts-expect-error …`, `# @ts-ignore …`, or the file-level
  // `# @ts-nocheck` — reaches the TS face as a TS-only comment line
  // (`// @ts-…`) under the PLACE-OR-DECLINE rule: the directive
  // places only where its suppression is PRECISE — where the governed
  // statement's diagnostics land exactly on the one face line beneath
  // the directive (TypeScript's next-line semantics). Everywhere else
  // it DECLINES: the comment stays an ordinary Rip comment, the error
  // stays visible, and no spurious TS2578 appears. Placements:
  //   - a live statement whose face emission is a SINGLE line — its
  //     own body line (an annotated declaration's violation fires on
  //     the assignment, not the hoist line). Single-line is decided
  //     by the builder PROBE (checkpoint → emit → inspect), never by
  //     re-deriving lowering shapes: a multi-line emission
  //     (comprehension/switch/try IIFEs, block-bodied function
  //     values, defs, classes) declines uniformly — errors inside a
  //     lowering land on inner lines the directive cannot govern;
  //   - the scope's hoist line for a bare typed forward, ONLY when
  //     that line declares a single name (their only manifestation —
  //     `let a!: T`); a multi-name hoist line declines, because one
  //     directive would silently suppress the sibling names'
  //     unrelated errors;
  //   - the scope-top cluster line for a SINGLE-LINE type
  //     declaration; multi-line rendered bodies (object aliases,
  //     interfaces) decline;
  //   - the overload row for def-sig signatures (always one line).
  // Sourced from the lexer's trivia channel — never from
  // generated text. The directive must sit on the line DIRECTLY above
  // its statement (TypeScript's own next-line rule; a blank line in
  // between leaves it an ordinary comment), alone on its line, and
  // spell one of the three known directives followed by whitespace or
  // end — everything else stays an ordinary Rip comment (comments
  // never emit), including unknown `@ts-*` spellings and directives in
  // expression-lowered positions where no statement line exists.
  static TS_DIRECTIVE = /^#[ \t]*@ts-(expect-error|ignore|nocheck)(?=\s|$)/;

  // The attachment pre-pass: pair each directive comment with the
  // statement-list element whose source line sits directly beneath it.
  // Elements come from the program's own list and every block node's
  // list — the positions the emitter prints as lines. Ties at one
  // source start (a postfix form and its guarded statement) resolve
  // OUTERMOST: the outer element is the one the statement list emits.
  collectTsDirectives(sexpr, trivia, source) {
    this.tsDirectiveMap = new Map();
    this.tsNocheck = null;
    this.pendingHoistDirectives = [];
    if (!this.ts || trivia.length === 0) return;
    const lineStarts = [0];
    for (let i = 0; i < source.length; i++) {
      if (source[i] === '\n') lineStarts.push(i + 1);
    }
    const lineOf = (offset) => {
      let lo = 0, hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid] <= offset) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    const directives = [];
    const nochecks = [];
    for (const t of trivia) {
      if (t.kind !== 'comment') continue;
      const m = Emitter.TS_DIRECTIVE.exec(t.text);
      if (m === null) continue;
      // Whole-line only: a trailing directive comment has no next-line
      // reading the emitter can honor.
      if (!/^[ \t]*$/.test(source.slice(lineStarts[lineOf(t.start)], t.start))) continue;
      (m[1] === 'nocheck' ? nochecks : directives).push(t);
    }
    if (directives.length === 0 && nochecks.length === 0) return;
    const elements = [];
    const listElements = (list) => {
      for (const el of list) {
        if (!isNode(el)) continue;
        const id = this.stores.idOf(el);
        if (id === null) continue;
        const n = this.stores.node(id);
        elements.push({ el, id, start: n.sourceStart, end: n.sourceEnd });
      }
    };
    listElements(sexpr.slice(1));
    const walk = (x) => {
      if (!isNode(x)) return;
      if (isBlock(x)) {
        listElements(x.slice(1));
        // Adjacent class members group into ONE implicit-object
        // statement, so a directive above a LATER member line can only
        // attach to the member PAIR — list pairs of statement-position
        // objects (classMember consumes them per row; a same-start
        // object sorts before its first pair via the larger-end rule,
        // so a directive above the FIRST member still attaches to the
        // whole-group statement).
        for (const el of x.slice(1)) {
          if (isNode(el) && isObject(el)) listElements(el.slice(1));
        }
      }
      for (const c of x) walk(c);
    };
    walk(sexpr);
    elements.sort((a, b) => a.start - b.start || b.end - a.end);
    for (const d of directives) {
      const target = elements.find((e) => e.start >= d.end);
      if (target === undefined || lineOf(target.start) !== lineOf(d.start) + 1) continue;
      const attached = this.tsDirectiveMap.get(target.el) ?? [];
      attached.push({ t: d, nodeId: target.id });
      this.tsDirectiveMap.set(target.el, attached);
    }
    // `@ts-nocheck` is file-level in TypeScript — it counts only when
    // no statement precedes it in the source; the FIRST such comment
    // emits as the face's first line, the rest stay ordinary comments.
    const firstStmt = elements.length > 0 ? elements[0].start : Infinity;
    this.tsNocheck = nochecks.find((t) => t.end <= firstStmt) ?? null;
  }

  // One directive line: `//` + the comment's own bytes past the `#`
  // (description preserved verbatim), the newline, and the pad that
  // keeps the surrounding indentation intact (`padFirst` places the
  // pad before the directive where the caller has not emitted it yet
  // — class member rows own their pads) — all one TS-only region, so
  // stripping deletes the whole line. The mapping row rides the
  // caller-span mark: the comment's real trivia span against the
  // emitted `// …` bytes — cover by the builder's comparison (`#`
  // versus `//` never matches verbatim), on the governed statement's
  // node under the 'tsDirective' role (the runtime-injection
  // precedent for rows whose role has no RoleStore entry).
  tsDirectiveLine(d, pad, padFirst = false) {
    this.b.tsOnly(() => {
      if (padFirst) this.b.emit(pad);
      this.b.markSpan(d.nodeId, 'tsDirective', d.t.start, d.t.end, () => {
        this.b.emit('//' + d.t.text.slice(1));
      });
      this.b.emit(padFirst ? '\n' : '\n' + pad);
    });
  }

  // Directive placement around one statement-position emission
  // (statements, implicit returns, class member rows): the directives
  // governing the statement always emit above its HEAD line. An
  // earlier place-or-decline probe (drop the
  // directive when the statement emits multi-line) was a proxy for
  // "can the directive govern the error" that over-declined the
  // dominant case: an arrow/function assigned to a typed binding
  // reports its error on the statement's head line, which the
  // directive governs precisely (the declined
  // directive silently deleted the author's escape hatch and leaked
  // the acknowledged error). The honest residue of always-placing: a
  // directive whose error lands on an INNER line of a multi-line
  // statement doesn't suppress it and surfaces as TS2578 — visible
  // and actionable, exactly the behavior, strictly better than a
  // silent drop.
  withTsDirectives(node, pad, fn, padFirst = false) {
    const attached = this.ts && this.tsDirectivesArmed && isNode(node)
      ? this.tsDirectiveMap.get(node) : undefined;
    if (attached === undefined) return fn();
    this.tsDirectiveMap.delete(node);
    for (const d of attached) this.tsDirectiveLine(d, pad, padFirst);
    fn();
  }

  // Erased-statement consumption for bare typed forwards: their only
  // face manifestation is the scope's hoist line (`let a!: T`), so
  // directives move to the scope-pending list the very next
  // hoistTargets call folds — the pendingHoistTypes discipline.
  tsForwardDirectives(node) {
    if (!this.ts || !this.tsDirectivesArmed) return;
    const attached = this.tsDirectiveMap?.get(node);
    if (attached === undefined) return;
    this.tsDirectiveMap.delete(node);
    // Tag provenance: when this forward's annotation later re-homes
    // inline at a declaring write (Tier 1), applyDeclareInPlace moves
    // these directives to that statement instead of the hoist line.
    for (const d of attached) d.forwardOwner = node;
    this.pendingHoistDirectives.push(...attached);
  }

  // The def's recorded overload signatures (TS face): each prints as a
  // bodiless TS overload row immediately above the implementation —
  // name/params/returnType marked from the def-sig's own roles.
  tsOverloadSigs(node, ind) {
    if (!this.ts) return;
    const sigs = this.pendingSigs.get(node);
    if (!sigs) return;
    for (const sig of sigs) {
      const params = this.tsRendered(sig, () => renderParams(sig[2]));
      // A directive above the signature follows it to its overload
      // row — the line its diagnostics land on.
      const directives = this.tsDirectiveMap.get(sig);
      if (directives !== undefined) {
        this.tsDirectiveMap.delete(sig);
        for (const d of directives) this.tsDirectiveLine(d, '  '.repeat(ind));
      }
      this.b.tsOnly(() => {
        this.mark(sig, '$self', () => {
          this.b.emit('function ');
          this.mark(sig, 'name', () => this.b.emit(sig[1]));
          this.mark(sig, 'params', () => this.b.emit(params));
          this.mark(sig, 'returnType', () => this.b.emit(`: ${tidyType(sig[3])}`));
          this.b.emit(';');
        });
        this.b.emit('\n' + '  '.repeat(ind));
      });
    }
  }

  // Identifier assignment targets in a scope, alphabetically, each paired
  // with the FIRST assignment node that targets it. `def` subtrees are
  // separate scopes and do not leak.
  // Every name bound by a destructuring pattern (array/object targets,
  // nested patterns, defaults, rests). Elisions (bare ',') bind nothing.
  // `binding` is true for BINDING patterns (params, loop variables):
  // there the `rest x` sugar is a genuine rest element
  // (`([rest a]) ->` compiles to `([...a])`) and its name collects. In
  // TARGET patterns (assignment targets, catch bindings — catch lowers
  // through an assignment) the same shape rejects: "Cannot use
  // 'rest' expression as a destructuring target".
  patternNames(p, out = [], binding = false) {
    if (!isNode(p)) {
      if (typeof p === 'string' && p !== ',') out.push(p);
      return out;
    }
    if (p[0] === 'array') for (const el of p.slice(1)) this.patternNames(el, out, binding);
    else if (p[0] === 'object') {
      for (const pair of p.slice(1)) {
        if (pair[0] === null) this.patternNames(pair[1], out, binding);
        else if (pair[0] === ':') this.patternNames(pair[2], out, binding);
        else if (pair[0] === '=') this.patternNames(pair[1], out, binding);
        else if (pair[0] === '...') this.patternNames(pair[1], out, binding);
      }
    } else if (p[0] === 'rest') {
      if (!binding) throw this.positionedError(p, "emitter: Cannot use 'rest' expression as a destructuring target (destructuring rest is spelled '...name')");
      this.patternNames(p[1], out, binding);
    } else if (p[0] === '...') this.patternNames(p[1], out, binding);
    else if (p[0] === 'default') this.patternNames(p[1], out, binding);
    else if (p[0] === 'typed-var') this.patternNames(p[1], out, binding);
    return out;
  }

  static isPattern(x) {
    return isObject(x) || (isNode(x) && x[0] === 'array');
  }

  // The erased typed wrapper: ["typed-var", target, "T"]. Hyphenated
  // like every invented head (the naming convention) — no identifier
  // spells it, so no user call can ever build the same shape and the
  // head ALONE discriminates.
  static isTypedWrapper(s) {
    return isNode(s) && s[0] === 'typed-var' && s.length === 3;
  }

  // Whole statements that ERASE: `type`/`interface` declarations
  // (["type-decl", text]), bare typed forward declarations (the
  // typed-var wrapper in statement position), and bodiless typed-def
  // OVERLOAD signatures (["def-sig", name, params, "T"] — read
  // only by declaration emission) compile to NOTHING. Every statement
  // list filters them before emission; each filtered statement
  // records zero-width cover rows so its source span still resolves
  // through bestAtSource.
  static isErasedStmt(s) {
    return isNode(s) && (s[0] === 'type-decl' || Emitter.isTypedWrapper(s) ||
      (s[0] === 'def-sig' && s.length === 4));
  }

  static stripErased(list) {
    return list.filter((s) => !Emitter.isErasedStmt(s));
  }

  // The emission-path filter: live statements come back, erased ones
  // record their rows at the current output position. An overload
  // signature is COHERENT only when a def of the same name follows it
  // in the same statement list — a sig with no implementation would
  // ship a phantom declaration (its erasure leaves nothing to back
  // it), so it rejects here instead.
  //
  // TS-face side channels: a def-sig registers on its implementing def
  // (pendingSigs — the def's emission prints the overload rows
  // adjacent to itself), and `forwards: true` — passed by SCOPE-level
  // statement lists that filter before their hoist collection runs
  // (program, function-expression bodies) — records bare typed forward
  // declarations into pendingHoistTypes for the scope's hoist line.
  // The very next hoistTargets call folds and clears that map, so
  // records never outlive their scope.
  liveStmts(list, { forwards = false } = {}) {
    const live = [];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (Emitter.isErasedStmt(s)) {
        if (isNode(s) && s[0] === 'def-sig') {
          const name = s[1];
          const impl = list
            .slice(i + 1)
            .find((later) => isNode(later) && isDefHead(later[0]) && later.length === 4 && later[1] === name);
          if (!impl) {
            throw this.positionedError(s,
              `emitter: overload signature 'def ${name}' has no implementation — ` +
              `a bodiless typed def must be followed by 'def ${name}' with a body in the same block`,
            );
          }
          if (this.ts) {
            const sigs = this.pendingSigs.get(impl) ?? [];
            if (!sigs.includes(s)) {
              sigs.push(s);
              this.pendingSigs.set(impl, sigs);
            }
          }
        }
        if (this.ts && forwards && Emitter.isTypedWrapper(s) && typeof s[1] === 'string' &&
            !this.pendingHoistTypes.has(s[1])) {
          this.pendingHoistTypes.set(s[1], s);
        }
        if (forwards && Emitter.isTypedWrapper(s)) this.tsForwardDirectives(s);
        this.erasedRows(s);
      } else {
        live.push(s);
      }
    }
    return live;
  }

  // Zero-width mapping rows for an erased statement, anchored at the
  // current output offset: the honest record that this span emits
  // nothing here (mappingKind 'cover' by construction — the empty
  // emitted slice never equals the source).
  erasedRows(stmt) {
    this.mark(stmt, '$self', () => {});
    const roles =
      stmt[0] === 'type-decl' ? ['declaration'] :
      stmt[0] === 'def-sig' ? ['name', 'params', 'returnType'] :
      ['target', 'annotation'];
    for (const role of roles) this.mark(stmt, role, () => {});
  }

  inScope(name) {
    return this.scopes.some((s) => s.has(name));
  }

  // A function scope's hoist entries: local assignment targets minus
  // params minus names already declared in an enclosing scope. Returns
  // the entries plus the full set of names this scope declares (for
  // the scope chain).
  scopedHoist(stmts, params = []) {
    const collected = this.hoistTargets(stmts, params);
    let entries = collected.filter(([n]) => !this.inScope(n));
    entries.annotations = collected.annotations;
    entries.directives = collected.directives;
    const names = new Set(entries.map(([n]) => n));
    for (const p of params) for (const n of this.patternNames(p, [], true)) names.add(n);
    // Function scopes implicit-return their tail statement — a tail
    // assign emits in EXPRESSION position (`return (r = 5)`), where a
    // `let ` is invalid JS, so the tail is never a declare-in-place
    // site (over-conservative for void-defs, which only costs a pin).
    entries = this.applyDeclareInPlace(entries, stmts, { tailIsExpression: true });
    return { entries, names };
  }

  hoistTargets(nodes, exclude = []) {
    const targets = new Map();
    // Reactive declarations bind through `const` — their names never
    // hoist, and a later plain write (`count = 5`) or pattern-target
    // element writes the container's `.value`, not a hoisted `let`
    //. Collected during this same walk, applied at
    // the end (order-independent, like the export decision #83).
    const reactive = new Set();
    // Chained-comparison temps this scope must declare: the
    // walk is the same one that finds assignment targets, so every
    // chain the scope emits allocates here — before the let line
    // emits. Entries carry the MID node and the '$self' role: the
    // declared temp is a generated manifestation of the middle
    // operand (a cover row — `_ref` never equals the source slice).
    const chainTemps = [];
    // TS face: the scope's hoist-line annotations — name → the node
    // whose 'annotation' role types it (the first annotated assignment
    // or bare typed forward the walk sees). Erased forwards at
    // pre-filtered levels arrive through pendingHoistTypes (liveStmts'
    // record), folded in below. JS mode collects nothing.
    const annotations = new Map();
    const noteAnnotation = (name, node) => {
      if (this.ts && !annotations.has(name) && this.annotationText(node) !== null) {
        annotations.set(name, node);
      }
    };
    const add = (name, node) => {
      if (!targets.has(name)) targets.set(name, node);
    };
    const walk = (n) => {
      if (!isNode(n) || isDefHead(n[0]) || isFunc(n)) return;
      // A component's body hoists inside its own emitted scopes
      // (_init, methods) — nothing from it reaches this scope's line.
      if (n[0] === 'component' && n.length === 3) return;
      if (this.ts && Emitter.isTypedWrapper(n)) {
        if (typeof n[1] === 'string') noteAnnotation(n[1], n);
        this.tsForwardDirectives(n);
      }
      if (isChainLink(n) && isNode(n[1][2])) {
        chainTemps.push([this.chainTemp(n), n[1][2], '$self']);
      }
      if (this.isReactiveDecl(n)) {
        if (typeof n[1] === 'string') reactive.add(n[1]);
        // A computed's multi-statement block is its own scope
        // (computedBody hoists it — the funcBlock path); every other
        // value emits inline in THIS scope, so its assignment targets
        // hoist here .
        if (!(n[0] === 'computed' && isBlock(n[2]) && n[2].length > 2)) walk(n[2]);
        return;
      }
      // An effect binds its dispose handle through `const` — the name
      // never hoists (a later plain write targets the const and hits
      // JS's own TypeError). The body is its own function scope and
      // hoists internally; nothing inside it
      // collects here.
      if (this.isEffectDecl(n)) {
        if (typeof n[1] === 'string') reactive.add(n[1]);
        return;
      }
      // A readonly declaration binds through `const` the same way —
      // later writes (plain, compound, pattern elements) emit bare
      // against the const and hit JS's own TypeError, never a hoisted
      // duplicate `let` . The VALUE
      // is expression territory and hoists its assignment targets
      // here .
      if (this.isReadonlyDecl(n)) {
        if (typeof n[1] === 'string') reactive.add(n[1]);
        walk(n[2]);
        return;
      }
      // An exported declaration binds `export const` — the BINDING
      // never hoists, but its INITIALIZER is a module-scope
      // expression like any other value position and walks for hoist
      // targets (the export twin: skipping the
      // walk loses the initializer's inner targets and the module
      // throws a load-time ReferenceError). A reactive/effect/
      // readonly spec additionally sends its name to the exclusion
      // set; effect bodies and multi-statement computed blocks are
      // their own function scopes and hoist internally.
      if (n[0] === 'export' && isNode(n[1])) {
        const spec = n[1];
        if ((this.isReactiveDecl(spec) || this.isEffectDecl(spec) || this.isReadonlyDecl(spec)) && typeof spec[1] === 'string') {
          reactive.add(spec[1]);
          if (!this.isEffectDecl(spec) && !(spec[0] === 'computed' && isBlock(spec[2]) && spec[2].length > 2)) {
            walk(spec[2]);
          }
          return;
        }
        // Exported plain (and void) assigns: the value walks the
        // same way; other exported forms (class/def/enum,
        // specifier lists) carry no module-scope initializer.
        if (ASSIGNS.has(spec[0]) && spec.length === 3) walk(spec[2]);
        return;
      }
      // Loop variables declare in the for-head (`for (let [q = 7] …)`)
      // — their pattern defaults are NOT scope-level assignments; skip
      // the vars slot.
      if (n[0] === 'for-in' || n[0] === 'for-of' || n[0] === 'for-as') {
        for (const el of n.slice(2)) walk(el);
        return;
      }
      if (n[0] === 'comprehension') {
        walk(n[1]);
        for (const clause of n[2] ?? []) walk(clause[2]);
        for (const g of n[3] ?? []) walk(g);
        return;
      }
      // Exported binding-less forms (`export {}` and any spec the
      // branch above declined) hoist nothing.
      if (n[0] === 'export') return;
      // Enums declare through `const`; their member assignments are
      // object entries, not scope variables — the subtree skips
      // everywhere.
      if (n[0] === 'enum') return;
      // Class bodies declare FIELDS, not scope variables: a field
      // assignment's target never hoists
      // ; field VALUES
      // are expressions and walk normally.
      if (n[0] === 'class') {
        if (n[2] != null) walk(n[2]);
        const body = n[3];
        if (isBlock(body)) {
          for (const stmt of body.slice(1)) {
            if (isNode(stmt) && ASSIGNS.has(stmt[0]) && stmt.length === 3) walk(stmt[2]);
            // A typed bodiless FIELD is a class member, not a scope
            // forward: its annotation and its directives belong to
            // the member row (classMembers), never to the enclosing
            // scope's hoist line.
            else if (!Emitter.isTypedWrapper(stmt)) walk(stmt);
          }
        }
        return;
      }
      if (ASSIGNS.has(n[0]) && n.length === 3) {
        if (typeof n[1] === 'string') {
          add(n[1], n);
          noteAnnotation(n[1], n);
        } else if (n[0] === '=' && Emitter.isPattern(n[1])) {
          for (const name of this.patternNames(n[1])) add(name, n);
        }
      }
      // Catch pattern bindings assign inside the handler; their names
      // declare at this scope — BOTH pattern kinds hoist
      if (n[0] === 'try') {
        for (const part of n.slice(2)) {
          if (isNode(part) && part.length === 2 && Emitter.isPattern(part[0])) {
            for (const name of this.patternNames(part[0])) add(name, n);
          }
        }
      }
      for (const el of n) walk(el);
    };
    for (const n of nodes) walk(n);
    const excludeNames = [];
    for (const x of exclude) this.patternNames(x, excludeNames, true);
    for (const x of excludeNames) targets.delete(x);
    for (const x of reactive) targets.delete(x);
    // Component member names never hoist: a bare write inside a
    // member body targets the instance member (`this.name = …`),
    // never a fresh local (the rule — a member name cannot be
    // re-declared as a local by assignment).
    for (const f of this.cframes) {
      for (const name of f.members.keys()) targets.delete(name);
    }
    const entries = [...targets.entries()].map(([name, node]) => [name, node, 'target']);
    entries.push(...chainTemps);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (this.ts) {
      // Fold the pre-filtered levels' forward records (liveStmts) into
      // this scope's map and CLEAR them — every scope-level filter is
      // immediately followed by its hoist collection, so a record can
      // never leak into a later scope's hoist line.
      for (const [name, node] of this.pendingHoistTypes) {
        if (!annotations.has(name)) annotations.set(name, node);
      }
      this.pendingHoistTypes.clear();
      entries.annotations = annotations;
      // Directives above bare typed forwards ride the same fold: the
      // scope's hoist line is their manifestation, and clearing here
      // keeps a record from leaking into a later scope's line.
      entries.directives = this.pendingHoistDirectives;
      this.pendingHoistDirectives = [];
    }
    return entries;
  }

  // ---- Declare-in-place (Tier 1 of the evolving-let tiers) ----------
  //
  // A hoisted binding with no initializer is an evolving `let` to
  // TypeScript: wrong-typed reassignment is never an error, `typeof`
  // reads `undefined`, and a write-only local hovers `any` — the
  // declaration/initialization split suppresses everything a real
  // initializer would teach the checker. For the names captureScan
  // proves safe, the emitter therefore declares AT the first write
  // (`let x = …`) instead of hoisting — in BOTH faces identically, so
  // strip-parity holds by construction.
  //
  // Safe means unobservable: the name's textually first occurrence IS
  // that write (values walk before targets, so a self-referential
  // first write disqualifies itself), the write is a direct statement
  // of the declaring scope, and no occurrence of the name sits inside
  // a hoisted `def`. Those three facts close every early-execution
  // vector: a direct read or an earlier closure's read is textually
  // before the write (first-occurrence rule); a function expression,
  // class, or component textually AFTER the write cannot run before
  // it (its value/binding doesn't exist yet — calling the not-yet-
  // assigned name throws either way); a hoisted `def` is the ONE
  // construct callable from above its own statement, so any name its
  // body touches keeps the hoist. Everything else keeps today's
  // hoist too (conditional first writes, patterns, compounds).
  //
  // Static and shared across emitter instances (sub-emitters, both
  // faces): membership is a pure function of the AST, so re-adding is
  // idempotent and both faces always agree.
  static declaresInPlace = new WeakSet();

  // Declaring write → the bare typed forward whose annotation re-homes
  // inline at it (`r: number` … `r = 5` → `let r: number = 5;` in the
  // TS face). Populated only when the TS walk sees the annotation;
  // JS mode never emits annotations, so the asymmetry is presentation-
  // only and strip-parity holds.
  static inlineOwners = new WeakMap();

  // One generic execution-order walk over a scope's RAW statement list
  // (pre-liveStmts, so bare typed forwards still appear and structurally
  // disqualify their names in both faces), descending into nested
  // functions (unlike hoistTargets). Per name: `decl` — the plain `=`
  // statement eligible to declare it (null unless the name's first
  // occurrence is an unannotated top-level write); `nested` — any
  // occurrence inside a nested function; `nestedWrite` — a nested
  // occurrence that writes (the Tier 3 signal, consumed by the pin
  // pipeline). Reads are over-counted by design: member names and
  // object-pair keys are the only excluded slots, unknown forms walk
  // every element (which also catches one-element interpolation holes),
  // and shadowing is not modeled — every over-count lands on `nested`
  // or an earlier read, which only forfeits declare-in-place coverage,
  // never correctness.
  captureScan(nodes) {
    const stmts = nodes.length === 1 && isBlock(nodes[0]) ? nodes[0].slice(1) : nodes;
    const top = new Set(stmts.filter(isNode));
    const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
    const facts = new Map();
    // inFn levels: 0 — the scope's own straight line; 1 — inside a
    // DEFERRED construct (function expression, class, component, enum:
    // none can execute before the statement that creates it without
    // first referencing a binding at a textual position the
    // execution-order rule already sees); 2 — inside a hoisted `def`,
    // the ONE construct callable before its own statement (`f()`
    // above, `def f` below — the early-execution counterexample).
    // Only level 2 disqualifies declare-in-place; level 1 still marks
    // `nested` for the pin pipeline.
    const occur = (name, inFn, write = false, declStmt = null, writeNode = null) => {
      if (typeof name !== 'string' || !IDENT.test(name)) return;
      let f = facts.get(name);
      if (f === undefined) facts.set(name, (f = { decl: null, seen: false, nested: false, nestedWrite: false, inDef: false, firstWrite: null }));
      if (!f.seen) { f.seen = true; f.decl = declStmt; }
      // The textually first WRITE with a known statement node — the
      // pin pipeline's probe site (its RHS is what TS infers from).
      if (write && f.firstWrite === null && writeNode !== null) f.firstWrite = writeNode;
      if (inFn > 0) { f.nested = true; if (write) f.nestedWrite = true; if (inFn === 2) f.inDef = true; }
    };
    const walk = (n, inFn) => {
      if (typeof n === 'string') return occur(n, inFn);
      if (!isNode(n)) return;
      // A bare typed FORWARD erases (no runtime existence) and is a
      // declaration, not a reference — invisible to the scan in BOTH
      // modes, so `r: number` + `r = 5` and plain `r = 5` classify
      // identically (whole-statement erasure invariance(b)); the
      // forward's annotation re-homes inline at the declaring write.
      if (Emitter.isTypedWrapper(n)) return;
      const head = n[0];
      // Nested execution scopes: def/class/component names are
      // bindings, not references — skip the name slot. A class parent
      // clause executes at declaration time; marking it nested is a
      // conservative over-count, not a miss. A def anywhere in the
      // subtree pins the disqualifying level even where it could only
      // run later (over-conservative, never a miss).
      if (isFunc(n)) { for (const el of n.slice(1)) walk(el, Math.max(inFn, 1)); return; }
      if (isDefHead(head) || head === 'class' || head === 'component' || head === 'enum') {
        const level = isDefHead(head) ? 2 : Math.max(inFn, 1);
        for (const el of n.slice(typeof n[1] === 'string' ? 2 : 1)) walk(el, level);
        return;
      }
      if (ASSIGNS.has(head) && n.length === 3) {
        walk(n[2], inFn); // value before target: execution order
        if (typeof n[1] === 'string') {
          if (head !== '=') occur(n[1], inFn); // compound assigns read their target first
          // Annotated assigns qualify too: the annotation emits inline
          // (`let x: T = v`), so typed/stripped twins ship identical JS
          // (the dts.test.js erasure invariant).
          occur(n[1], inFn, true, head === '=' && !inFn && top.has(n) ? n : null, head === '=' ? n : null);
        } else {
          // Pattern and member targets: names inside over-count as
          // reads (patterns stay hoisted; a member target's object is
          // a genuine read).
          walk(n[1], inFn);
        }
        return;
      }
      if (isUpdate(n)) { // ++/-- reads and writes its target
        if (typeof n[1] === 'string') occur(n[1], inFn, true);
        else walk(n[1], inFn);
        return;
      }
      if ((head === '.' || head === '?.') && n.length === 3) {
        walk(n[1], inFn);
        if (typeof n[2] !== 'string') walk(n[2], inFn); // a member NAME is not a reference
        return;
      }
      if (head === 'object') { // pair keys are not references
        for (const pair of n.slice(1)) {
          if (isNode(pair) && pair[0] === ':' && pair.length === 3) {
            if (typeof pair[1] !== 'string') walk(pair[1], inFn);
            walk(pair[2], inFn);
          } else walk(pair, inFn);
        }
        return;
      }
      // Generic: walk every element INCLUDING the head slot — a
      // one-element interpolation hole (["x"]) is an identifier
      // reference; keyword heads over-count as reads of names no
      // program hoists.
      for (const el of n) walk(el, inFn);
    };
    for (const s of stmts) walk(s, 0);
    return facts;
  }

  // Filter a scope's FINAL hoist entries through captureScan: names
  // proven safe leave the hoist line and their first-write statement
  // registers in declaresInPlace for assign(). Annotated names (typed
  // forwards fold into entries.annotations; annotated assigns return
  // annotation text and never earn a decl) and schema-story bindings
  // keep their hoist-line manifestations. The scope's declared-names
  // set is built by callers BEFORE this filter — a declare-in-place
  // name is still scope-declared, just not on the hoist line.
  applyDeclareInPlace(entries, rawStmts, { tailIsExpression = false } = {}) {
    if (!entries.some(([, , role]) => role === 'target')) return entries;
    const facts = this.captureScan(rawStmts);
    // The implicit-return tail of a function scope emits in expression
    // position (`return (r = 5)`) — a `let` there is invalid JS, so a
    // tail first-write never declares in place. The tail is the last
    // LIVE statement (erased type declarations don't return).
    let tail = null;
    if (tailIsExpression) {
      const stmts = rawStmts.length === 1 && isBlock(rawStmts[0]) ? rawStmts[0].slice(1) : rawStmts;
      for (let i = stmts.length - 1; i >= 0; i--) {
        if (!Emitter.isErasedStmt(stmts[i])) { tail = stmts[i]; break; }
      }
    }
    const ownerToDecl = new Map();
    const kept = entries.filter(([name, , role]) => {
      if (role !== 'target') return true;
      const f = facts.get(name);
      if (!f || f.decl === null || f.inDef || f.decl === tail) return true;
      // A bare typed FORWARD (`x: number` … `x = 5`) keeps the hoist —
      // its annotation manifests on the hoist line and the forward is
      // the name's first occurrence anyway. An annotated ASSIGN
      // (`x: T = 5`) declares in place with the annotation inline; only
      // when the annotation belongs to a DIFFERENT node than the
      // declaring write does the hoist line stay its manifestation.
      // A name annotated by a DIFFERENT node than its declaring write
      // (a bare typed forward) still declares in place; the forward's
      // annotation re-homes inline at the write (TS-face presentation
      // only — the tier decision above never consulted it). Schema
      // stories inline the same way, so both faces share one
      // shape (the strip gate).
      const owner = entries.annotations?.get(name);
      if (owner !== undefined && owner !== f.decl) {
        Emitter.inlineOwners.set(f.decl, owner);
        ownerToDecl.set(owner, f.decl);
      }
      Emitter.declaresInPlace.add(f.decl);
      return false;
    });
    kept.annotations = entries.annotations;
    kept.schemaConsts = entries.schemaConsts;
    // Directives that rode a forward whose annotation re-homed inline
    // re-anchor to the declaring statement (withTsDirectives emits them
    // above it, same place-or-decline rule); the rest stay hoist-line
    // directives exactly as before.
    if (entries.directives?.length && ownerToDecl.size) {
      kept.directives = [];
      for (const d of entries.directives) {
        const decl = d.forwardOwner !== undefined ? ownerToDecl.get(d.forwardOwner) : undefined;
        if (decl !== undefined) {
          const dirs = this.tsDirectiveMap.get(decl) ?? [];
          dirs.push(d);
          this.tsDirectiveMap.set(decl, dirs);
        } else kept.directives.push(d);
      }
    } else kept.directives = entries.directives;
    // Pin candidates (the evolving-let Tier 3 residue): still-hoisted,
    // unannotated names with a nested occurrence — exactly the shape
    // that breaks TS's evolving inference (TS7034: evolving serves only
    // same-function references) — and a known first write to probe.
    // Branch-first names with no nested references stay UNPINNED on
    // purpose: intact evolving checks their reads with precise CFA
    // unions, which first-write pinning would falsify.
    kept.pinnable = new Map();
    for (const [name, , role] of kept) {
      if (role !== 'target') continue;
      const f = facts.get(name);
      if (!f?.nested || f.firstWrite === null) continue;
      if (kept.annotations?.has(name) || kept.schemaConsts?.has(name)) continue;
      kept.pinnable.set(name, f.firstWrite);
      this.pinnables?.push({ name, node: f.firstWrite, key: this.pinKey(name, f.firstWrite) });
    }
    return kept;
  }

  // The pin cache key for a hoisted name: `${name}@${hash}` over the
  // first write's VALUE source slice — stable while unrelated edits
  // shift offsets, invalidated exactly when the defining expression
  // changes (djb2; collisions merely share a correctly-typed pin).
  pinKey(name, node) {
    const id = this.stores.idOf(node);
    const row = id !== null ? this.stores.role(id, 'value') : null;
    if (!row || row.sourceStart == null || this.b.source === null) return null;
    const slice = this.b.source.slice(row.sourceStart, row.sourceEnd);
    let h = 5381;
    for (let i = 0; i < slice.length; i++) h = ((h * 33) ^ slice.charCodeAt(i)) >>> 0;
    return `${name}@${h.toString(36)}`;
  }

  // Get-or-allocate the cached-mid temp for a chain link. Idempotent
  // by construction (the WeakMap key is the link node): the delivery
  // pre-walk and the scope's own hoist walk both reach every chain,
  // and both must see the same name.
  chainTemp(link) {
    let name = this.temps.byNode.get(link);
    if (name === undefined) {
      name = this.freshTempName();
      this.temps.byNode.set(link, name);
    }
    return name;
  }

  freshTempName() {
    let name;
    do {
      name = this.temps.n === 0 ? '_ref' : `_ref${this.temps.n}`;
      this.temps.n++;
    } while (this.temps.used.has(name));
    return name;
  }

  // Loop temporaries (`_i`, `_step`) dodge the module's spelled
  // identifiers against the same used set as chain temps, walking the
  // numbered family from the base spelling (`_i` → `_i1` → `_i2`).
  // The name is NOT reserved: each use is block-scoped to its own
  // loop header, so sibling and nested loops share a spelling safely
  // — and a program that never spells a base name keeps its bytes.
  loopTempName(base) {
    let name = base;
    for (let n = 1; this.temps.used.has(name); n++) name = `${base}${n}`;
    return name;
  }

  // Each hoisted name is a second generated manifestation of its first
  // assignment's `target` role, so declaration
  // positions map with zero heuristics. Chain temps carry '$self' —
  // the declared name manifests the chain's MID operand (a cover row).
  //
  // TS face (the hoisted-let strategy): a name whose scope carries
  // a recorded annotation — a typed declaration's or a bare typed
  // forward's — declares as `let x: T`, so its WRITE sites type
  // against the real annotation; unannotated names stay bare and ride
  // TypeScript's evolving-`let` inference. Chain temps are the
  // emitter's own and never annotate.
  //
  // A bare typed FORWARD declares with the definite-assignment
  // assertion (`let y!: T`): the annotation carries no declaration-
  // site initializer, so plain `let y: T` would opt the name into
  // TypeScript's definite-assignment analysis and raise TS2454 on
  // read-before-assign patterns that are LEGAL Rip (hoisted reads
  // yield undefined) — a diagnostic the unannotated twin never draws.
  // Editor diagnostics must not contradict legal Rip semantics.
  // The `!` is a TS-only strippable byte outside the annotation's
  // mark, so the annotation row stays exact and the strip invariant
  // holds. Annotated ASSIGNMENTS (`x: T = v`) keep the plain `let
  // x: T` — their declaration statement assigns.
  //
  // Directives above bare typed forwards print directly above
  // the hoist line — the line their diagnostics land on (`pad` is the
  // indentation the caller already emitted, restored after each
  // directive's newline) — ONLY when the line declares a single name.
  // TypeScript's suppression is line-granular: on a multi-name hoist
  // line one directive would also swallow the SIBLING names'
  // unrelated errors, silently — imprecise, so it declines
  // (place-or-decline) and every error stays visible.
  hoistLine(entries, pad = '') {
    if (entries.length === 1) {
      for (const d of entries.directives ?? []) this.tsDirectiveLine(d, pad);
    }
    this.b.emit('let ');
    entries.forEach(([name, node, role], i) => {
      if (i > 0) this.b.emit(', ');
      this.mark(node, role, () => this.b.emit(name));
      if (this.ts && role === 'target') {
        const owner = entries.annotations?.get(name) ?? null;
        if (owner !== null) {
          this.b.tsOnly(() => {
            if (Emitter.isTypedWrapper(owner) && !this.strict) this.b.emit('!');
            this.mark(owner, 'annotation', () => this.b.emit(`: ${this.annotationText(owner)}`));
          });
        } else {
          // A module-level schema binding declares its story type on
          // the hoist line: a DECLARED type answers at every
          // reference — the evolving-let alternative leaves reads
          // inside nested functions hovering the evolving base `any`
          // (tsgo quickinfo, plain-TS parity), which is exactly where
          // model bindings are used. Attached only at the program
          // hoist line (entries.schemaConsts is set only there), so a
          // same-named function-local never annotates.
          const constType = entries.schemaConsts?.get(name) ?? null;
          if (constType !== null) this.b.tsOnly(() => this.b.emit(`: ${constType}`));
          else {
            // Pin (evolving-let Tier 3): a caller-supplied inferred
            // type for a still-hoisted nested-referenced name, keyed
            // by name + a hash of the first write's VALUE source text
            // — stable while positions shift around it, invalidated
            // exactly when the defining expression changes. Emitted
            // like a typed forward (`name!: T`) — the `!` keeps rip's
            // legal read-before-assign quiet, exactly as
            // annotated forwards do.
            const pinNode = entries.pinnable?.get(name);
            const pinKey = pinNode !== undefined ? this.pinKey(name, pinNode) : null;
            const pinType = pinKey !== null ? this.pins?.get(pinKey) : undefined;
            if (pinType !== undefined) this.b.tsOnly(() => this.b.emit(`${this.strict ? '' : '!'}: ${pinType}`));
          }
        }
      }
    });
    this.b.emit(';');
  }

  program(sexpr) {
    return this.programWith(sexpr);
  }

  // Attach the schema story's declared types to the PROGRAM hoist
  // entries (only non-exported module-level schema bindings hoist;
  // exported ones emit `export const` and infer from the cast).
  attachSchemaConsts(entries) {
    if (!this.schemaStories) return;
    const consts = new Map();
    for (const s of this.schemaStories.values()) {
      if (!s.decl.exported && s.constType !== null) consts.set(s.decl.name, s.constType);
    }
    if (consts.size) entries.schemaConsts = consts;
  }

  programWith(sexpr) {
    // Erased statements filter here — BEFORE the leading-import scan
    // and the last-statement determination, both of which must see
    // the live program (a `type` declaration above the imports must
    // not push them below the hoist line).
    const all = this.liveStmts(sexpr.slice(1), { forwards: true });
    // Leading MODULE imports emit ABOVE the hoist line (a dynamic-import
    // CALL spells the same head; isModuleImport discriminates).
    let lead = 0;
    while (lead < all.length && this.isModuleImport(all[lead])) lead++;
    this.lastProgramStmt = all[all.length - 1] ?? null;
    if (lead > 0) {
      this.mark(sexpr, '$self', () => {
        for (const imp of all.slice(0, lead)) this.statement(imp, 0);
        const rest = all.slice(lead);
        let entries = this.hoistTargets(rest);
        this.attachSchemaConsts(entries);
        const names = new Set([...entries.map(([n]) => n), ...Emitter.importedNames(all.slice(0, lead))]);
        for (const n of this.pushReactiveFrame(rest, names)) names.add(n);
        this.moduleBound = Emitter.moduleBoundNames(rest);
        this.scopes.push(names);
        entries = this.applyDeclareInPlace(entries, sexpr.slice(1));
        if (entries.length) {
          this.hoistLine(entries);
          this.b.emit('\n\n');
        }
        this.emitTsTypeDecls(sexpr.slice(1), '');
        if (rest.length) this.mark(sexpr, 'body', () => this.statements(rest, 0, 'program'));
        this.scopes.pop();
        this.rframes.pop();
      });
      return;
    }
    this.programPlain(sexpr, all);
  }

  // Module bindings that never ride the hoist line — exported value
  // declarations (`export const`), classes, defs, enums. The child-
  // component resolution (#137's compile-knowable half) consults this
  // beside the scope chain; nothing else does (the hoist filtering
  // semantics stay untouched). NEGATIVE SPACE, deliberate (the PR
  // #78 Opus round): DESTRUCTURED export targets (`export [A, B] =
  // pair`) are not collected — a component class bound that way
  // draws the #137 rejection, which is LOUD and names the working
  // spellings (a plain binding or import); re-export specifier lists
  // (`export {A} from './m.js'`) bind nothing locally, so their
  // absence here is correct, and a local `export {A}` list
  // re-exports a binding the scope chain already answers.
  static moduleBoundNames(stmts) {
    const names = new Set();
    const noteSpec = (spec) => {
      if (!isNode(spec)) return;
      if (ASSIGNS.has(spec[0]) && spec.length === 3 && typeof spec[1] === 'string') names.add(spec[1]);
      else if ((spec[0] === 'class' || spec[0] === 'enum') && typeof spec[1] === 'string') names.add(spec[1]);
      else if (isDefHead(spec[0]) && typeof spec[1] === 'string') names.add(spec[1]);
    };
    for (const n of stmts) {
      if (!isNode(n)) continue;
      if (n[0] === 'export') for (const spec of n.slice(1)) noteSpec(spec);
      else noteSpec(n);
    }
    return names;
  }

  // Names an import statement binds in module scope.
  static importedNames(imports) {
    const names = [];
    for (const node of imports) {
      for (const spec of node.slice(1, -1)) {
        if (spec === '{}') continue;
        if (typeof spec === 'string') names.push(spec);
        else if (spec[0] === '*') names.push(spec[1]);
        else for (const s of spec) names.push(isNode(s) ? s[1] : s);
      }
    }
    return names;
  }

  // stmts arrives pre-filtered from programWith (erased statements
  // already recorded there).
  programPlain(sexpr, stmts) {
    this.mark(sexpr, '$self', () => {
      let entries = this.hoistTargets(stmts);
      this.attachSchemaConsts(entries);
      const names = new Set(entries.map(([n]) => n));
      for (const n of this.pushReactiveFrame(stmts, names)) names.add(n);
      this.moduleBound = Emitter.moduleBoundNames(stmts);
      this.scopes.push(names);
      entries = this.applyDeclareInPlace(entries, sexpr.slice(1));
      if (entries.length) {
        this.hoistLine(entries);
        this.b.emit('\n\n');
      }
      this.emitTsTypeDecls(sexpr.slice(1), '');
      this.mark(sexpr, 'body', () => this.statements(stmts, 0, 'program'));
      this.scopes.pop();
      this.rframes.pop();
    });
  }

  statements(list, ind, mode) {
    const pad = '  '.repeat(ind);
    const live = this.liveStmts(list);
    this.emitTsTypeDecls(list, pad);
    live.forEach((stmt, i) => {
      this.b.emit(pad);
      this.statement(stmt, ind);
      const last = i === live.length - 1;
      if (mode === 'block' || !last) this.b.emit('\n');
      // Slotless-position type declarations queued during this
      // statement's emission land here, at the list's own padding.
      this.flushPendingTypeDecls(pad, mode !== 'block' && last);
    });
  }

  // Statement dispatch by sexpr head — one table entry per statement
  // form, never a branch elsewhere. A handler owns any shape guard
  // beyond its head and returns false to decline, which sends the node
  // down the expression-statement path below.
  // Null-prototype: the dispatch key is a sexpr HEAD, which for call
  // nodes is user identifier text — an inherited Object.prototype
  // member must never dispatch (`valueOf 2` is a call statement).
  static STATEMENT_FORMS = {
    __proto__: null,
    'if': (e, node, ind) => (e.ifStatement(node, ind), true),
    'def': (e, node, ind) => node.length === 4 && (e.defStatement(node, ind), true),
    'void-def': (e, node, ind) => node.length === 4 && (e.defStatement(node, ind), true),
    'return': (e, node) => (e.returnStatement(node), true),
    'while': (e, node, ind) => (node.length === 3 || node.length === 4) && (e.whileStatement(node, ind), true),
    'loop': (e, node, ind) => (e.loopStatement(node, ind), true),
    'for-in': (e, node, ind) => (e.forIn(node, ind), true),
    'for-of': (e, node, ind) => (e.forOf(node, ind), true),
    'for-as': (e, node, ind) => (e.forAs(node, ind), true),
    'switch': (e, node, ind) => (e.switchStatement(node, ind), true),
    'try': (e, node, ind) => (e.tryStatement(node, ind), true),
    'throw': (e, node) => (e.throwStatement(node), true),
    // Statement-position comprehensions: the value-usage rule — the
    // PROGRAM'S FINAL statement keeps the accumulator IIFE (its value
    // is the program result); everywhere else the result is unused and
    // a plain loop emits. The plain loop carries a statement semicolon
    // everywhere EXCEPT as a function body's direct statement.
    'comprehension': (e, node, ind) => {
      e.ind = ind;
      if (node === e.lastProgramStmt) {
        e.comprehension(node, ind);
        e.b.emit(';');
      } else {
        const inFuncBody = e.funcBodyStmt;
        e.plainLoopComprehension(node, ind);
        if (!inFuncBody) e.b.emit(';');
      }
      return true;
    },
    // A parenthetical multi-statement in statement position emits as a
    // nested bare block with a trailing semicolon.
    'block': (e, node, ind) => (e.bareBlockStatement(node, ind), true),
    // Named classes are declarations (no trailing
    // semicolon). An UNNAMED class declines: JS requires class
    // statements to be named, so it takes the statement-grouping path
    // below .
    'class': (e, node, ind) => node[1] != null && (e.classStatement(node, ind), true),
    'enum': (e, node) => (e.enumStatement(node), true),
    // Reactive declarations. The heads are spellable, so a
    // user call `state a, 0` builds the identical array —
    // the semanticKind check declines it to the expression path (call
    // emission).
    'state': (e, node, ind) => e.isReactiveDecl(node) && (e.reactiveDecl(node, ind), true),
    'computed': (e, node, ind) => e.isReactiveDecl(node) && (e.reactiveDecl(node, ind), true),
    // Effects — the same spellable-head discipline: a user call
    // `effect h, 5` builds the identical array and declines to call
    // emission on its semanticKind.
    'effect': (e, node, ind) => e.isEffectDecl(node) && (e.effectStatement(node, ind), true),
    // Readonly — the same discipline again: `readonly x, 5`
    // declines to call emission on its semanticKind
    'readonly': (e, node, ind) => e.isReadonlyDecl(node) && (e.readonlyDecl(node, ind), true),
    // Module imports only (spec + source): the dynamic-import CALL
    // spells the same head and declines to the expression path on its
    // semanticKind — length cannot discriminate (`import(Foo, "./m.js")`
    // and `import Foo from "./m.js"` build the same array).
    'import': (e, node) => e.isModuleImport(node) && (e.importStatement(node), true),
    'export': (e, node, ind) => (e.exportStatement(node, ind), true),
    'export-default': (e, node, ind) => (e.exportStatement(node, ind), true),
    'export-all': (e, node, ind) => (e.exportStatement(node, ind), true),
    'export-from': (e, node, ind) => (e.exportStatement(node, ind), true),
  };

  // Module source strings emit single-quoted; the token
  // value carries normalized double quotes.
  moduleSource(s) {
    return `'${String(s).slice(1, -1)}'`;
  }

  // A specifier list entry: a plain name, `default`, or [name, alias].
  emitSpecifiers(list) {
    list.forEach((s, i) => {
      if (i > 0) this.b.emit(', ');
      if (isNode(s)) this.b.emit(`${s[0]} as ${s[1]}`);
      else this.b.emit(s);
    });
  }

  // ["import", spec, source] | ["import", default, extra, source] —
  // ESM passthrough: `import { a, b as c } from 'src';`
  // (spaced braces, single-quoted source, a trailing newline that
  // leaves a blank line before the code that follows).
  importStatement(node) {
    const source = node[node.length - 1];
    const specs = node.slice(1, -1);
    this.mark(node, '$self', () => {
      this.b.emit('import ');
      specs.forEach((spec, i) => {
        if (i > 0) this.b.emit(', ');
        if (spec === '{}') this.b.emit('{}');
        else if (typeof spec === 'string') this.b.emit(spec);
        else if (spec[0] === '*') this.b.emit(`* as ${spec[1]}`);
        else {
          this.b.emit('{ ');
          this.emitSpecifiers(spec);
          this.b.emit(' }');
        }
      });
      this.b.emit(' from ');
      this.mark(node, 'source', () => this.b.emit(this.moduleSource(source)));
    });
    this.b.emit(';\n');
  }

  exportStatement(node, ind) {
    const head = node[0];
    this.mark(node, '$self', () => {
      if (head === 'export-all') {
        this.b.emit('export * from ');
        this.mark(node, 'source', () => this.b.emit(this.moduleSource(node[1])));
        this.b.emit(';');
      } else if (head === 'export-from') {
        this.b.emit('export ');
        if (node[1] === '{}') this.b.emit('{}');
        else {
          this.b.emit('{ ');
          this.emitSpecifiers(node[1]);
          this.b.emit(' }');
        }
        this.b.emit(' from ');
        this.mark(node, 'source', () => this.b.emit(this.moduleSource(node[2])));
        this.b.emit(';');
      } else if (head === 'export-default') {
        this.b.emit('export default ');
        this.mark(node, 'spec', () => this.expr(node[1]));
        this.b.emit(';');
      } else {
        const spec = node[1];
        if (spec === '{}') {
          this.b.emit('export {};');
        } else if (isNode(spec) && spec[0] === 'class') {
          // Exported declarations carry a trailing semicolon.
          this.b.emit('export ');
          this.classStatement(spec, ind);
          this.b.emit(';');
        } else if (isNode(spec) && isDefHead(spec[0])) {
          this.b.emit('export ');
          this.defStatement(spec, ind);
          this.b.emit(';');
        } else if (isNode(spec) && spec[0] === 'enum') {
          this.b.emit('export ');
          this.enumCode(spec);
          this.b.emit(';');
          this.tsEnumCompanion(spec, true);
        } else if (this.isReactiveDecl(spec)) {
          // `export count := 0` → `export const count = __state(0);`.
          // The declaration's own emission carries the
          // roles and the trailing semicolon.
          this.b.emit('export ');
          this.reactiveDecl(spec, ind);
        } else if (this.isReadonlyDecl(spec)) {
          // `export x =! 5` → `export const x = 5;`.
          this.b.emit('export ');
          this.readonlyDecl(spec, ind);
        } else if (this.isEffectDecl(spec)) {
          // Only the BOUND form exports (`export const h =
          // __effect(…)`); a bare effect binds nothing to export
          if (spec[1] === null) {
            throw this.positionedError(node, "emitter: a bare effect ('export ~> …') binds nothing to export — bind a dispose handle (`export h ~> …`) or drop the export (`export __effect(…)` would be invalid JS)");
          }
          this.b.emit('export ');
          this.effectStatement(spec, ind);
        } else if (isNode(spec) && (spec[0] === '=' || spec[0] === 'void-assign')) {
          // Exported bindings are const declarations, never hoisted.
          // The assign node is real (ExportAssign rows),
          // so its roles mark: a typed export's annotation role covers
          // the whole emitted declaration; a void export's
          // voidMarker role covers it the same way.
          if (spec[0] === 'void-assign') this.registerVoidValue(spec[2], spec);
          this.b.emit('export ');
          this.mark(spec, 'voidMarker', () => this.mark(spec, 'annotation', () => this.mark(spec, '$self', () => {
            this.b.emit('const ');
            this.mark(spec, 'target', () => this.b.emit(spec[1]));
            if (this.ts && this.annotationText(spec) !== null) {
              this.tsAnnotate(spec, 'annotation', this.annotationText(spec));
            }
            this.b.emit(' ');
            this.mark(spec, 'operator', () => this.b.emit('='));
            this.b.emit(' ');
            const prevSchemaName = this._schemaName;
            const prevComponentName = this._componentName;
            const prevComponentTypeParams = this._componentTypeParams;
            this._componentTypeParams = null;
            if (isNode(spec[2]) && spec[2][0] === 'schema') this._schemaName = spec[1];
            if (this.isComponentDecl(spec[2]) && typeof spec[1] === 'string') {
              this._componentName = spec[1];
              // Exported generic component: the ExportAssign's
              // TYPE_PARAMS role rides to the lowered class, same
              // channel as the Assign path.
              this._componentTypeParams = this.annotationText(spec, 'typeParams');
            }
            this.mark(spec, 'value', () => this.withExpression(() => this.expr(spec[2])));
            this._schemaName = prevSchemaName;
            this._componentName = prevComponentName;
            this._componentTypeParams = prevComponentTypeParams;
          })));
          this.b.emit(';');
          if (this.ts && typeof spec[1] === 'string' && this.componentInfo.has(spec[2])) {
            this.tsComponentCompanion(spec[2], spec[1], true, this.annotationText(spec, 'typeParams'));
          }
        } else {
          this.b.emit('export { ');
          this.emitSpecifiers(spec);
          this.b.emit(' };');
        }
      }
    });
  }

  // ── Enum codegen ─────────────────────────────────────────────
  // `enum Name` lowers to ONE const object carrying both directions:
  // forward (member → value) and reverse (value → member).
  // Members are `name = <literal>` lines — number or string
  // literals only (the reverse direction needs a key), each usable
  // exactly once across BOTH directions. Bare members, expression
  // values, and colliding keys each reject loudly

  // A member value's [emitText, runtimeKey] — or null when the value
  // has no literal key form. String values decode through JSON.parse;
  // a JS-only escape (`\x5f`, `\v`, …) has no JSON decoding, so it
  // rejects with the escape named rather than surfacing a raw parser
  // error (`\uXXXX` spells every such character).
  enumValue(v, enumName, memberName, member) {
    if (typeof v === 'string') {
      if (v.startsWith('"')) {
        try {
          return [v, JSON.parse(v)];
        } catch {
          const escape = /\\u(?![0-9a-fA-F]{4})|\\[^"\\/bfnrtu]/.exec(v)?.[0] ?? '\\';
          throw this.positionedError(member,
            `emitter: enum '${enumName}' member '${memberName}' — its string value uses the ` +
            `'${escape}' escape, which enum values do not support (JSON escapes only; ` +
            `'\\uXXXX' spells the same character)`,
          );
        }
      }
      if (/^[\d.]/.test(v)) {
        const canon = v.replace(/_/g, '').replace(/n$/, '');
        return [v, String(Number(canon))];
      }
      return null;
    }
    if (isNode(v) && v[0] === '-' && v.length === 2) {
      const inner = this.enumValue(v[1], enumName, memberName, member);
      if (inner === null || v[1].startsWith('"')) return null;
      return [`-${v[1]}`, `-${inner[1]}`];
    }
    return null;
  }

  enumStatement(node) {
    this.enumCode(node);
    this.b.emit(';');
    this.tsEnumCompanion(node, false);
  }

  // TS face: the enum's TYPE companion. The const-object lowering is a
  // VALUE only, so an annotation naming the enum (`pick: Color`) would
  // find no type; the member-value union is the lowering's honest
  // type, and TS's separate type/value namespaces make the same-name
  // pairing legal (the dts face's `declare enum` analogue). A second
  // generated manifestation of the enum — cover rows by construction.
  tsEnumCompanion(node, exported) {
    if (!this.ts || typeof node[1] !== 'string') return;
    const name = node[1];
    this.b.tsOnly(() => {
      this.b.emit('\n');
      this.mark(node, '$self', () => {
        this.b.emit(`${exported ? 'export ' : ''}type ${name} = (typeof ${name})[keyof typeof ${name}];`);
      });
    });
  }

  enumCode(node) {
    const [, name, body] = node;
    const items = isBlock(body) ? body.slice(1) : [body];
    const pairs = []; // [item, keyText, valueText, valueKey]
    const usedKeys = new Set();
    const claim = (key, what, at) => {
      if (usedKeys.has(key)) {
        throw this.positionedError(at,
          `emitter: enum '${name}' key '${key}' is used more than once (${what}) — ` +
          `forward and reverse entries share one object, so every member name and value must be distinct ` +
          ``,
          node,
        );
      }
      usedKeys.add(key);
    };
    // A BARE member is a primitive with no NodeStore row; its span
    // derives from the recorded neighbors — the cursor starts at the
    // block row's start (the anchor rule anchors it at the first member) and
    // advances past each earlier item's row (or bare text), so the
    // window before the offending member holds only separators and
    // the indexOf is anchored and exact.
    const bareSpan = (k) => {
      const src = this.b.source;
      const bodyId = this.stores.idOf(body);
      let cursor = bodyId !== null ? (this.stores.selfSpan(bodyId)?.[0] ?? null) : null;
      if (src === null || cursor === null || typeof items[k] !== 'string') return null;
      for (let j = 0; j < k; j++) {
        const it = items[j];
        const id = isNode(it) ? this.stores.idOf(it) : null;
        const span = id !== null ? this.stores.selfSpan(id) : null;
        if (span) cursor = span[1];
        else if (typeof it === 'string') {
          const at = src.indexOf(it, cursor);
          if (at >= 0) cursor = at + it.length;
        }
      }
      const at = src.indexOf(items[k], cursor);
      return at >= 0 ? [at, at + items[k].length] : null;
    };
    for (let k = 0; k < items.length; k++) {
      const item = items[k];
      // A bracket-spelled member (`["__proto__"] = 1`) parses as a
      // destructuring assignment — never an enum form: member names
      // are plain identifiers (the emission handles the one dangerous
      // name itself).
      if (isNode(item) && item[0] === '=' && item.length === 3 && typeof item[1] !== 'string') {
        throw this.positionedError(item,
          `emitter: enum '${name}' member names are plain identifiers — ` +
          `a computed/bracket-spelled member ('["…"] = value') is not an enum form`,
          node,
        );
      }
      if (!isNode(item) || item[0] !== '=' || item.length !== 3) {
        const message =
          `emitter: enum '${name}' members are 'name = <literal>' lines — ` +
          `a bare member has no value for the reverse mapping`;
        const span = bareSpan(k);
        if (span) throw this.positionedErrorAt(span[0], span[1], message);
        throw this.positionedError(item, message, node);
      }
      const value = this.enumValue(item[2], name, item[1], item);
      if (value === null) {
        throw this.positionedError(item,
          `emitter: enum '${name}' member '${item[1]}' needs a number or string literal value — ` +
          `the reverse mapping uses the value as an object key, so expressions have no enum form ` +
          ``,
          node,
        );
      }
      const [valueText, valueKey] = value;
      claim(item[1], `member '${item[1]}'`, item);
      claim(valueKey, `value of '${item[1]}'`, item);
      pairs.push([item, item[1], valueText, valueKey]);
    }
    // `__proto__` as an object-literal key — bare OR quoted — is the
    // prototype-set form, not an own property; only the computed
    // spelling `["__proto__"]:` creates one. A member (or string
    // value) named `__proto__` emits through it so both lookup
    // directions are real entries. The check reads the
    // DECODED key — an escape spelling (`"\u005f_proto__"`) is the
    // same key. Every other Object.prototype name (`constructor`,
    // `hasOwnProperty`, …) is an ordinary own property in literal
    // form and keys verbatim.
    const ownKey = (text, decoded) => (decoded === '__proto__' ? '["__proto__"]' : text);
    this.mark(node, '$self', () => {
      this.b.emit('const ');
      this.mark(node, 'name', () => this.b.emit(name));
      this.b.emit(' = ');
      this.mark(node, 'body', () => {
        this.b.emit('{');
        pairs.forEach(([item, key, valueText], i) => {
          if (i > 0) this.b.emit(', ');
          this.mark(item, '$self', () => {
            this.mark(item, 'target', () => this.b.emit(ownKey(key, key)));
            this.b.emit(': ');
            this.mark(item, 'value', () => this.b.emit(valueText));
          });
        });
        pairs.forEach(([item, key, valueText, valueKey]) => {
          this.b.emit(', ');
          // The reverse entry is a second generated manifestation of
          // the member — its text is derived, so
          // the rows are covers, never fake exacts.
          this.mark(item, '$self', () => {
            // A negative value's key form must quote (a bare `-1:` is
            // invalid JS); positive literals key verbatim.
            this.b.emit(valueText.startsWith('-') ? JSON.stringify(valueKey) : ownKey(valueText, valueKey));
            this.b.emit(`: "${key}"`);
          });
        });
        this.b.emit('}');
      });
    });
  }

  // ── Schema emission ──────────────────────────────────────────
  // A schema node's value is the descriptor the lexer pass parsed
  // (src/schema.js). Emission is one `__schema({...})` call —
  // the byte-pinned descriptor literal — with callable/
  // transform/ensure bodies sub-compiled through the ordinary
  // pipeline: the captured token slice runs the tail lexer passes,
  // re-enters the parser, and emits through a nested Emitter. The
  // whole call is one generated manifestation of the schema node
  // ($self + the body role as cover rows); per-token mappings inside
  // compiled callables do not exist.

  schemaExpr(node) {
    const descriptor = node[1];
    if (!descriptor || typeof descriptor !== 'object' || !Array.isArray(descriptor.entries)) {
      throw this.positionedError(node, 'emitter: schema node without a descriptor — the lexer pass owns SCHEMA_BODY values');
    }
    // A FUNCTION-scope binding of `__schema` shadows the runtime
    // exactly where this declaration's call needs it — an accident
    // with no working reading (the bring-your-own-factory hatch is
    // module-scope suppression). scopes[0] is program scope;
    // deeper entries are function scopes.
    if (this.scopes.slice(1).some((s) => s.has('__schema'))) {
      throw this.positionedError(node,
        "emitter: a function-scope binding of '__schema' shadows the schema runtime where this " +
        "schema declaration needs it — rename the local, or bind '__schema' at MODULE scope to " +
        'supply your own factory (the suppression hatch)',
      );
    }
    this.usesSchema = true;
    const schemaName = this._schemaName ?? null;
    const fns = new Map();
    for (const { entry: e, index: i, tokens, value } of Emitter.schemaBodies(descriptor)) {
      if (value) {
        fns.set(i, this.schemaValueCode(tokens));
        continue;
      }
      // Transforms see the whole raw input as the explicit `it`
      // parameter.
      const params = e.tag === 'field'
        ? ['it']
        : paramNamesOf(e.paramTokens ?? [], e.tag === 'ensure' ? '@ensure' : `'${e.name}'`, Emitter.schemaFail);
      fns.set(i, this.schemaFnCode(params, tokens));
    }
    // The schema type story (face only): callable bodies gain
    // TS-only `this` parameters per their real calling convention
    //, and the binding's value gains a TS-only cast to its
    // declared type — inference-independent, so the face types the
    // binding identically under every runtimeDelivery.
    const story = this.schemaStories?.get(node) ?? null;
    this.mark(node, '$self', () => {
      this.b.emit('__schema(');
      this.mark(node, 'body', () => {
        const segments = descriptorSegments(
          descriptor, schemaName, fns, fns.get('adapter') ?? null, story?.thisTypes ?? null);
        for (const seg of segments) {
          if (typeof seg === 'string') this.b.emit(seg);
          else this.b.tsOnly(() => this.b.emit(seg.ts));
        }
      });
      this.b.emit(')');
      if (story !== null && story.constType !== null) {
        this.b.tsOnly(() => this.b.emit(` as unknown as ${story.constType}`));
      }
    });
  }

  static schemaFail(message, at) {
    const err = new Error(`schema: ${message}`);
    err.start = at;
    throw err;
  }

  // The captured token slices a schema descriptor sub-compiles — ONE
  // enumeration shared by emission (schemaExpr) and the delivery walk
  // (deliveryTrees in emit()), so a new callable class can never join
  // one and silently miss the other.
  static schemaBodies(descriptor) {
    const out = [];
    descriptor.entries.forEach((entry, index) => {
      if (entry.tag === 'method' || entry.tag === 'computed' || entry.tag === 'derived' || entry.tag === 'ensure' ||
          entry.tag === 'hook' || entry.tag === 'scope' || entry.tag === 'defaultScope') {
        out.push({ entry, index, tokens: entry.bodyTokens });
      } else if (entry.tag === 'field' && entry.transformTokens) {
        out.push({ entry, index, tokens: entry.transformTokens });
      }
    });
    // The `on:` adapter is a VALUE expression, not a callable body,
    // but it is a tree the module emits — the delivery walk and the
    // temp-name collector must see it like every other sub-parse.
    if (descriptor.adapterTokens) {
      out.push({ entry: { tag: 'adapter' }, index: 'adapter', tokens: descriptor.adapterTokens, value: true });
    }
    return out;
  }

  // Compile a captured schema-body token slice to a parenthesized
  // function expression. Single-statement bodies compact to one line
  // (`(function() { return X; })`); multi-statement bodies
  // take the ordinary block form at indent 0. Returns {code, thisAt}:
  // thisAt is the offset right after the parameter list opens — where
  // the TS face inserts a `this` parameter (descriptorSegments).
  schemaFnCode(params, bodyTokens) {
    const { stmts, stores } = this.subParse(bodyTokens);
    if (stmts.length === 0) return { code: '(function() {})', thisAt: '(function('.length };
    const bodyNode = stmts.length === 1 ? stmts[0] : ['block', ...stmts];
    const isAsync = Emitter.containsAwait(bodyNode);
    const isGen = Emitter.containsYield(bodyNode);
    const sub = this.subEmitter(stores);
    let bodyText;
    if (stmts.length === 1) {
      const stmt = stmts[0];
      const h = isNode(stmt) ? stmt[0] : null;
      const names = new Set(params);
      for (const n of sub.pushReactiveFrame(stmts, names)) names.add(n);
      sub.scopes.push(names);
      if (isLoopNode(stmt) || h === 'comprehension') sub.statement(stmt, 0);
      else sub.implicitReturn(stmt, 0);
      bodyText = `{ ${sub.b.code} }`;
    } else {
      const { entries, names } = sub.scopedHoist([bodyNode], params.map(String));
      for (const n of sub.pushReactiveFrame(stmts, names)) names.add(n);
      sub.scopes.push(names);
      sub.b.emit('{\n');
      if (entries.length) {
        sub.b.emit('  ');
        sub.hoistLine(entries, '  ');
        sub.b.emit('\n');
      }
      stmts.forEach((stmt, i) => {
        sub.b.emit('  ');
        if (i === stmts.length - 1) sub.implicitReturn(stmt, 1);
        else sub.statement(stmt, 1, true);
        sub.b.emit('\n');
      });
      sub.b.emit('}');
      bodyText = sub.b.code;
    }
    const head = `(${isAsync ? 'async ' : ''}function${isGen ? '*' : ''}(`;
    return { code: `${head}${params.join(', ')}) ${bodyText})`, thisAt: head.length };
  }

  // Compile a captured VALUE-expression slice (the `on:` adapter) —
  // one expression, emitted in value context in the enclosing scope
  // (no function wrapper, no fresh frame).
  schemaValueCode(bodyTokens) {
    const { stmts, stores } = this.subParse(bodyTokens);
    if (stmts.length !== 1) {
      Emitter.schemaFail(`'on:' takes one adapter expression`, bodyTokens[0]?.start ?? 0);
    }
    const sub = this.subEmitter(stores);
    sub.expr(stmts[0]);
    return sub.b.code;
  }

  // The one sub-parse per captured body — shared by the delivery
  // decision and emission (see the constructor's subParses note).
  subParse(bodyTokens) {
    let cached = this.subParses.get(bodyTokens);
    if (!cached) {
      cached = Emitter.schemaSubParse(bodyTokens, this.b.source);
      this.subParses.set(bodyTokens, cached);
    }
    return cached;
  }

  // THE construction seam for nested emitters (schema callable
  // bodies). Everything the parent threads into a sub-emitter goes
  // through here: the SUB-parse's stores (its nodes carry the
  // semanticKinds the kind-checked paths dispatch on), the enclosing
  // scope chain, and the reactive frames — a body reading or writing
  // an outer reactive name unwraps to `n.value` exactly like any
  // other function body; its params shadow like any other params.
  // Runtime delivery needs NO reporting seam: emit() walks
  // the sub-parsed trees (through the shared subParse cache) before
  // any code emits, so the sub-emitter's output can reference only
  // runtimes the parent already delivered. A new parent↔sub concern
  // belongs in this method, not at a call site.
  subEmitter(stores) {
    const sub = new Emitter(stores, new CodeBuilder(stores, { source: null }));
    sub.scopes = [...this.scopes];
    sub.rframes = [...this.rframes];
    // One temp allocator per module: chain temps in a callable body
    // draw from the same name pool as the parent's (both emit into
    // the same output module).
    sub.temps = this.temps;
    // One sub-parse cache per module: a nested schema inside a
    // callable body parses once whether the delivery walk or a
    // deeper sub-emitter reaches it first.
    sub.subParses = this.subParses;
    return sub;
  }

  // Run the tail lexer passes over a captured body slice and re-enter
  // the parser. Returns the statement list. Sub-parse token ids live in
  // their own range; the sub-parse's stores are discarded (the schema
  // node's cover rows are the construct's mapping story). The schema
  // collapse ran BEFORE rewriteTypes, so the captured slice runs it
  // here first (typed callable params still erase), then the
  // implicit-structure passes.
  static schemaSubParse(bodyTokens, source) {
    let toks = bodyTokens.slice();
    if (toks.length === 0) return { stmts: [], stores: null };
    // Strip one INDENT…OUTDENT pair wrapping the whole body.
    if (toks[0].kind === 'INDENT') {
      let d = 0;
      let lastOutdent = -1;
      for (let k = 0; k < toks.length; k++) {
        if (toks[k].kind === 'INDENT') d++;
        else if (toks[k].kind === 'OUTDENT' && --d === 0) { lastOutdent = k; break; }
      }
      if (lastOutdent === toks.length - 1) toks = toks.slice(1, -1);
    }
    if (toks.length === 0) return { stmts: [], stores: null };
    let nextId = 1e9;
    const mintId = () => nextId++;
    const fail = (message, at) => {
      const err = new Error(`schema: ${message}`);
      err.start = at;
      err.end = at;
      throw err;
    };
    rewriteTypes(toks, mintId, source ?? '', fail);
    applyInsertionPass(toks, implicitBlocks, mintId);
    tagPostfixConditionals(toks);
    applyInsertionPass(toks, implicitObjects, mintId);
    applyInsertionPass(toks, implicitCalls, mintId);

    const parser = Parser();
    parser.lexer = {
      tokens: toks,
      index: 0,
      text: '',
      loc: null,
      setInput() { this.index = 0; },
      lex() {
        const t = this.tokens[this.index];
        if (!t) return null;
        this.index++;
        this.text = t.value;
        this.loc = { start: t.start, end: t.end };
        return t.kind;
      },
    };
    const result = parser.parse('');
    if (result.diagnostics.length > 0) {
      const d = result.diagnostics[0];
      const err = new Error(`schema: failed to compile a schema function body: ${d.message}`);
      err.start = d.start;
      err.end = d.end;
      throw err;
    }
    // The statements plus the sub-parse's OWN stores: the sub-emitter
    // dispatches on semanticKinds (reactive declarations included), so
    // it must read the store rows these nodes registered under. The
    // rows still never join the module's mapping story (the schema
    // node's cover rows are the construct's story).
    return { stmts: result.sexpr.slice(1), stores: new Stores(result.stores) };
  }

  bareBlockStatement(node, ind) {
    this.mark(node, '$self', () => {
      this.b.emit('{\n');
      this.statements(node.slice(1), ind + 1, 'block');
      this.b.emit('  '.repeat(ind) + '}');
    });
    this.b.emit(';');
  }

  statement(node, ind, funcBody = false) {
    this.withTsDirectives(node, '  '.repeat(ind), () => this.statementCore(node, ind, funcBody));
  }

  statementCore(node, ind, funcBody) {
    this.ind = ind;
    // Consumed SYNCHRONOUSLY by the dispatched form (the comprehension
    // handler's semicolon rule reads it before emitting anything).
    // The invariant that keeps one field sufficient: every nested
    // statement re-enters through this assignment with the default
    // false BEFORE its own dispatch runs, so a stale true can never
    // leak into a deeper statement's handler.
    this.funcBodyStmt = funcBody;
    if (isNode(node)) {
      const form = Emitter.STATEMENT_FORMS[node[0]];
      if (form && form(this, node, ind)) return;
      // Optional-chain assignment in statement position guards with a
      // plain `if` (no ternary value is needed).
      if ((ASSIGNS.has(node[0]) || node[0] === '//=' || node[0] === '%%=') && node.length === 3) {
        const guard = Emitter.optionalGuard(node[1]);
        if (guard !== null) {
          this.optionalAssign(node, guard, 'statement');
          this.b.emit(';');
          return;
        }
      }
    }
    // Statement-position grouping: expression forms JS treats specially
    // at statement start group unconditionally — object literals (bare
    // braces parse as a block) and `->` function expressions (a bare
    // `function` is a declaration needing a name). `=>`
    // arrows are valid bare and stay so. Update statements group
    // ((i++);). The grouped form is a second $self
    // manifestation (cover row over the parens, §4.1 one-to-many) so the
    // statement start itself maps.
    const wrap = Emitter.needsGrouping(node, 'statement');
    if (wrap) {
      this.mark(node, '$self', () => {
        this.b.emit('(');
        this.expr(node);
        this.b.emit(')');
      });
      this.b.emit(';');
    } else {
      this.expr(node);
      this.b.emit(';');
    }
    // A component BINDING statement gains its companion interface
    // (the enum-companion placement — after the statement).
    if (this.ts && isNode(node) && node[0] === '=' && node.length === 3 &&
        typeof node[1] === 'string' && this.componentInfo.has(node[2])) {
      this.tsComponentCompanion(node[2], node[1], false, this.annotationText(node, 'typeParams'));
    }
  }

  // ["while", condition, body] — the plain loop; ["while", condition,
  // guard, body] carries a WHEN guard, which nests the body in an
  // `if (guard)` block (value position guards with `continue` instead —
  // accumulatorIIFECore).
  whileStatement(node, ind) {
    const guard = node.length === 4 ? node[2] : null;
    const body = node[node.length - 1];
    this.mark(node, '$self', () => {
      this.b.emit('while (');
      this.mark(node, 'condition', () => this.expr(node[1]));
      this.b.emit(') ');
      if (guard !== null) {
        const stmts = isBlock(body) ? body.slice(1) : body;
        this.b.emit('{\n' + '  '.repeat(ind + 1) + 'if (');
        this.expr(guard);
        this.b.emit(') {\n');
        this.mark(node, 'body', () => this.statements(stmts, ind + 2, 'block'));
        this.b.emit('  '.repeat(ind + 1) + '}\n' + '  '.repeat(ind) + '}');
        return;
      }
      // A postfix loop carries a PLAIN [statement] array (the
      // postfix-if convention) and emits BRACED, single-statement
      // (unlike postfix-if's braceless line).
      if (!isBlock(body) && isNode(body)) {
        this.mark(node, 'body', () => {
          this.b.emit('{\n');
          this.b.emit('  '.repeat(ind + 1));
          this.statement(body[0], ind + 1);
          this.b.emit('\n' + '  '.repeat(ind) + '}');
        });
      } else {
        this.mark(node, 'body', () => this.braceBlock(body, ind));
      }
    });
  }

  ifStatement(node, ind) {
    // A postfix conditional carries a PLAIN statement array (not a block
    // node) and emits braceless on one line: `if (a) b = 1;`.
    // A reactive declaration can never be the guarded statement — every
    // block-nested declaration rejects at frame collection (#88).
    if (!isBlock(node[2]) && isNode(node[2])) {
      this.mark(node, '$self', () => {
        this.b.emit('if (');
        this.mark(node, 'condition', () => this.expr(node[1]));
        this.b.emit(') ');
        this.statement(node[2][0], ind);
      });
      return;
    }
    this.mark(node, '$self', () => this.ifChain(node, ind));
  }

  loopStatement(node, ind) {
    this.mark(node, '$self', () => {
      this.b.emit('while (true) ');
      this.mark(node, 'body', () => this.braceBlock(node[1], ind));
    });
  }

  throwStatement(node) {
    this.mark(node, '$self', () => {
      this.b.emit('throw ');
      this.mark(node, 'value', () => this.expr(node[1]));
    });
    this.b.emit(';');
  }

  tryStatement(node, ind) {
    this.mark(node, '$self', () => {
      this.b.emit('try ');
      this.mark(node, 'body', () => this.braceBlock(node[1], ind));
      // [binding|null, block] pairs are catch handlers; block nodes are
      // finalizers.
      for (const part of node.slice(2)) {
        if (!isNode(part)) continue;
        if (isBlock(part)) {
          this.b.emit(' finally ');
          this.braceBlock(part, ind);
        } else {
          const [binding, body] = part;
          if (binding === null) {
            this.b.emit(' catch ');
            this.braceBlock(body, ind);
          } else if (Emitter.isPattern(binding)) {
            // The catch-pattern lowering: bind `error`, destructure as
            // the handler's first statement (paren-wrapped for both
            // pattern kinds). The names hoist at the enclosing scope —
            // for BOTH kinds.
            this.b.emit(' catch (error) {\n');
            const pad = '  '.repeat(ind + 1);
            this.b.emit(pad + '(');
            this.mark(part, 'binding', () => this.withPattern(() => this.expr(binding)));
            this.b.emit(' = error);\n');
            this.statements(isBlock(body) ? body.slice(1) : [body], ind + 1, 'block');
            this.b.emit('  '.repeat(ind) + '}');
          } else {
            this.b.emit(' catch (');
            this.mark(part, 'binding', () => this.b.emit(binding));
            this.b.emit(') ');
            // The binding is a new name for the handler — it shadows a
            // same-named reactive declaration.
            this.withBindings([binding], () => this.braceBlock(body, ind));
          }
        }
      }
    });
  }

  switchStatement(node, ind) {
    const [, subject, cases, dflt] = node;
    const pad = '  '.repeat(ind);
    this.mark(node, '$self', () => {
      if (subject !== null) {
        this.b.emit('switch (');
        this.mark(node, 'subject', () => this.expr(subject));
        this.b.emit(') {\n');
        this.mark(node, 'cases', () => {
          for (const when of cases) {
            this.mark(when, '$self', () => {
              const [, conditions, body] = when;
              for (const c of conditions) {
                this.b.emit(`${pad}  case `);
                this.expr(c);
                this.b.emit(':\n');
              }
              this.caseBody(body, ind);
            });
          }
        });
        if (dflt !== null) {
          this.b.emit(`${pad}  default:\n`);
          this.caseBody(dflt, ind);
        }
        this.b.emit(`${pad}}`);
      } else {
        // Subjectless switch lowers to an if/else chain with
        // double-parenthesized conditions.
        cases.forEach((when, i) => {
          const [, conditions, body] = when;
          if (i > 0) this.b.emit(' else ');
          this.b.emit('if ((');
          conditions.forEach((c, k) => {
            if (k > 0) this.b.emit(') || (');
            this.expr(c);
          });
          this.b.emit(')) ');
          this.braceBlock(body, ind);
        });
        if (dflt !== null) {
          this.b.emit(' else ');
          this.braceBlock(dflt, ind);
        }
      }
    });
  }

  caseBody(block, ind) {
    const stmts = this.liveStmts(isBlock(block) ? block.slice(1) : [block]);
    this.emitTsTypeDecls(isBlock(block) ? block.slice(1) : [block], '  '.repeat(ind + 2));
    for (const stmt of stmts) {
      this.b.emit('  '.repeat(ind + 2));
      this.statement(stmt, ind + 2);
      this.b.emit('\n');
    }
    this.b.emit('  '.repeat(ind + 2) + 'break;\n');
  }

  // ["for-in", vars, iterable, step, guard, body] — the lowering
  // keeps the unindented-body quirk for stepped loops.
  // Loop variables are new bindings for the loop's whole emission —
  // they shadow same-named reactive declarations (a frame per loop).
  loopBindingNames(node) {
    const h = isNode(node) ? node[0] : null;
    let vars = null;
    if (h === 'for-in' || h === 'for-of' || h === 'for-as') vars = node[1];
    else if (h === 'comprehension') vars = node[2][0][1];
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
    return names;
  }

  forIn(node, ind) {
    const [, vars, iter, step, guard, body] = node;
    this.withBindings(this.loopBindingNames(node), () => this.forInCore(node, vars, iter, step, guard, body, ind));
  }

  forInCore(node, vars, iter, step, guard, body, ind) {
    this.mark(node, '$self', () => {
      const markVar = (v) => this.mark(node, 'vars', () => (typeof v === 'string' ? this.b.emit(v) : this.withPattern(() => this.expr(v), true)));
      // Pattern loop variables emit in the plain of-loop and the
      // index-variable forms (both destructure); the range/step
      // lowerings iterate through the variable itself.
      if (isNode(vars[0]) && (isRange(iter) || step !== null)) {
        throw this.positionedError(node, 'emitter: pattern loop variables with ranges or BY steps are not supported yet');
      }
      if (isRange(iter) && step === null) {
        const [dots, from, to] = iter;
        this.b.emit('for (let ');
        markVar(vars[0]);
        this.b.emit(' = ');
        this.expr(from);
        this.b.emit(`; ${vars[0]} ${dots === '..' ? '<=' : '<'} `);
        this.expr(to);
        this.b.emit(`; ${vars[0]}++) `);
        this.guardedBlock(body, guard, ind);
      } else if (isRange(iter)) {
        throw this.positionedError(node, 'emitter: ranged for with BY is not supported yet');
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
        const idx = vars.length === 2 ? vars[1] : this.loopTempName('_i');
        const numText = (s) => (typeof s === 'string' && /^[0-9.]/.test(s) ? s : null);
        const posLit = numText(step) ??
          (isNode(step) && step[0] === '+' && step.length === 2 ? numText(step[1]) : null);
        const negLit = isNode(step) && step[0] === '-' && step.length === 2 ? numText(step[1]) : null;
        if ((posLit ?? negLit) !== null && Number((posLit ?? negLit).replace(/_/g, '')) === 0) {
          throw this.positionedError(node, 'emitter: a BY step of 0 never advances the loop');
        }
        if (negLit !== null) {
          this.b.emit(`for (let ${idx} = `);
          this.expr(iter);
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
          this.b.emit(`for (let ${idx} = 0; ${idx} < `);
          this.expr(iter);
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
          const stp = this.loopTempName('_step');
          this.b.emit(`for (let ${stp} = `);
          this.mark(node, 'step', () => this.expr(step));
          this.b.emit(`, ${idx} = ${stp} > 0 ? 0 : `);
          this.expr(iter);
          this.b.emit(`.length - 1; ${stp} > 0 ? ${idx} < `);
          this.expr(iter);
          this.b.emit(`.length : ${stp} < 0 && ${idx} >= 0; ${idx} += ${stp}`);
        }
        this.b.emit(`) {\nlet `);
        markVar(vars[0]);
        this.b.emit(' = ');
        this.expr(iter);
        this.b.emit(`[${idx}];\n`);
        this.flatBody(body, guard, '    ');
        this.b.emit('}');
      } else if (vars.length === 2) {
        this.b.emit(`for (let ${vars[1]} = 0; ${vars[1]} < `);
        this.expr(iter);
        this.b.emit(`.length; ${vars[1]}++) {\n`);
        this.b.emit('  '.repeat(ind + 1) + 'let ');
        markVar(vars[0]);
        this.b.emit(' = ');
        this.expr(iter);
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
    const [, vars, obj, own, guard, body] = node;
    this.checkForOfPatternKey(vars, own);
    this.withBindings(this.loopBindingNames(node), () => this.forOfCore(node, vars, obj, own, guard, body, ind));
  }

  forOfCore(node, vars, obj, own, guard, body, ind) {
    this.mark(node, '$self', () => {
      const markVar = (v) => this.mark(node, 'vars', () => (typeof v === 'string' ? this.b.emit(v) : this.withPattern(() => this.expr(v), true)));
      this.b.emit('for (let ');
      markVar(vars[0]);
      this.b.emit(' in ');
      this.mark(node, 'object', () => this.expr(obj));
      this.b.emit(') ');
      if (own || vars.length === 2) {
        // The hasOwn filter always emits for `own`.
        this.b.emit('{\n');
        if (own) {
          this.b.emit(`if (!Object.hasOwn(`);
          this.expr(obj);
          this.b.emit(`, ${vars[0]})) continue;\n`);
        }
        if (vars.length === 2) {
          if (isNode(vars[1])) {
            this.b.emit('let ');
            markVar(vars[1]);
            this.b.emit(' = ');
          } else {
            this.b.emit(`let ${vars[1]} = `);
          }
          this.expr(obj);
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
    if (!isNode(vars[0])) return;
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
    const stmts = this.liveStmts(isBlock(body) ? body.slice(1) : [body]);
    this.emitTsTypeDecls(isBlock(body) ? body.slice(1) : [body], '');
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
    const stmts = this.liveStmts(isBlock(body) ? body.slice(1) : [body]);
    this.emitTsTypeDecls(isBlock(body) ? body.slice(1) : [body], '  '.repeat(ind + 1));
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
  clauseHeader(node, kind, vars, iter, aux) {
    const markVar = (v) => this.mark(node, 'vars', () => (typeof v === 'string' ? this.b.emit(v) : this.withPattern(() => this.expr(v), true)));
    const setups = [];
    if (kind === 'for-of') {
      this.checkForOfPatternKey(vars, aux === true);
      this.b.emit('for (let ');
      markVar(vars[0]);
      this.b.emit(' in ');
      this.mark(node, 'object', () => this.expr(iter));
      this.b.emit(')');
      if (aux === true) {
        setups.push(() => {
          this.b.emit('if (!Object.hasOwn(');
          this.expr(iter);
          this.b.emit(`, ${vars[0]})) continue;`);
        });
      }
      if (vars.length === 2) {
        setups.push(() => {
          if (isNode(vars[1])) {
            this.b.emit('let ');
            markVar(vars[1]);
            this.b.emit(' = ');
          } else {
            this.b.emit(`let ${vars[1]} = `);
          }
          this.expr(iter);
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
      this.b.emit(aux === true ? 'for await (let ' : 'for (let ');
      markVar(vars[0]);
      this.b.emit(' of ');
      this.mark(node, 'iterable', () => this.expr(iter));
      this.b.emit(')');
      return setups;
    }
    // for-in: plain, indexed (second loop variable), or stepped.
    const step = aux;
    if (isNode(vars[0]) && (isRange(iter) || step !== null)) {
      throw this.positionedError(node, 'emitter: pattern loop variables with ranges or BY steps are not supported yet');
    }
    if (isRange(iter) && step !== null) {
      throw this.positionedError(node, 'emitter: ranged for with BY is not supported yet');
    }
    if (step !== null) {
      // The statement-position stepped-loop policy, at accumulator
      // indentation: literal steps get static-direction headers, every
      // other step evaluates ONCE into `_step` and the header tests its
      // sign, and a zero literal rejects.
      const idx = vars.length === 2 ? vars[1] : this.loopTempName('_i');
      const numText = (s) => (typeof s === 'string' && /^[0-9.]/.test(s) ? s : null);
      const posLit = numText(step) ??
        (isNode(step) && step[0] === '+' && step.length === 2 ? numText(step[1]) : null);
      const negLit = isNode(step) && step[0] === '-' && step.length === 2 ? numText(step[1]) : null;
      if ((posLit ?? negLit) !== null && Number((posLit ?? negLit).replace(/_/g, '')) === 0) {
        throw this.positionedError(node, 'emitter: a BY step of 0 never advances the loop');
      }
      if (negLit !== null) {
        this.b.emit(`for (let ${idx} = `);
        this.expr(iter);
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
        this.b.emit(`for (let ${idx} = 0; ${idx} < `);
        this.expr(iter);
        this.b.emit(`.length; `);
        if (step === '1') {
          this.mark(node, 'step', () => this.b.emit(`${idx}++`));
        } else {
          this.b.emit(`${idx} += `);
          this.grouped(node, 'step', step, Emitter.needsGrouping(step, 'operand'));
        }
      } else {
        const stp = this.loopTempName('_step');
        this.b.emit(`for (let ${stp} = `);
        this.mark(node, 'step', () => this.expr(step));
        this.b.emit(`, ${idx} = ${stp} > 0 ? 0 : `);
        this.expr(iter);
        this.b.emit(`.length - 1; ${stp} > 0 ? ${idx} < `);
        this.expr(iter);
        this.b.emit(`.length : ${stp} < 0 && ${idx} >= 0; ${idx} += ${stp}`);
      }
      this.b.emit(')');
      setups.push(() => {
        this.b.emit('let ');
        markVar(vars[0]);
        this.b.emit(' = ');
        this.expr(iter);
        this.b.emit(`[${idx}];`);
      });
      return setups;
    }
    if (vars.length === 2) {
      this.b.emit(`for (let ${vars[1]} = 0; ${vars[1]} < `);
      this.expr(iter);
      this.b.emit(`.length; ${vars[1]}++)`);
      setups.push(() => {
        this.b.emit('let ');
        markVar(vars[0]);
        this.b.emit(' = ');
        this.expr(iter);
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
  comprehension(node, ind, keyExpr = null) {
    this.withBindings(this.loopBindingNames(node), () => this.comprehensionCore(node, ind, keyExpr));
  }

  comprehensionCore(node, ind, keyExpr) {
    const [, expr, [clause], guards] = node;
    const pad = '  '.repeat(ind);
    this.rejectYieldInIIFE(node);
    this.mark(node, '$self', () => {
      this.b.emit(Emitter.containsAwait(node) ? 'await (async () => {\n' : '(() => {\n');
      this.b.emit(`${pad}  const result = ${keyExpr === null ? '[]' : '{}'};\n`);
      this.b.emit(`${pad}  `);
      const [kind, vars, iter, aux] = clause;
      const setups = this.clauseHeader(node, kind, vars, iter, aux ?? null);
      this.b.emit(' {\n');
      let inner = `${pad}    `;
      for (const setup of setups) {
        this.b.emit(inner);
        setup();
        this.b.emit('\n');
      }
      if (guards.length > 0) {
        this.b.emit(inner);
        this.guardOpen(guards[0]);
        inner += '  ';
      }
      if (keyExpr === null) {
        this.b.emit(`${inner}result.push(`);
        // The pushed expression is an operand position (compounds group).
        const wrap = Emitter.needsGrouping(expr, 'operand') || isUpdate(expr);
        if (wrap) this.b.emit('(');
        this.expr(expr);
        if (wrap) this.b.emit(')');
        this.b.emit(');\n');
      } else {
        this.b.emit(`${inner}result[`);
        // A string key is an identifier read (it routes through expr,
        // so a reactive key unwraps — `result[count.value]`;
        // loop variables are frame-bound and stay bare); a node
        // key is the dynamicKey's inner expression.
        this.expr(keyExpr);
        this.b.emit('] = ');
        const wrap = Emitter.needsGrouping(expr, 'operand') || isUpdate(expr);
        if (wrap) this.b.emit('(');
        this.expr(expr);
        if (wrap) this.b.emit(')');
        this.b.emit(';\n');
      }
      if (guards.length > 0) this.b.emit(`${pad}    }\n`);
      this.b.emit(`${pad}  }\n`);
      this.b.emit(`${pad}  return result;\n`);
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
    if (!isNode(pair) || pair[0] !== ':') return null;
    const keyOk = typeof pair[1] === 'string' || (isNode(pair[1]) && pair[1][0] === 'dynamicKey');
    if (!keyOk) return null;
    if (!isNode(pair[2]) || pair[2][0] !== 'comprehension') return null;
    if (pair[2][2][0][0] !== 'for-of') return null;
    return pair;
  }

  // ── Value-usage lowerings (context-sensitive codegen) ──────────
  // Statement constructs in expression position
  // lower: if → ternary (or an inline-style IIFE when any branch holds
  // multiple statements), try/switch → IIFE with returns pushed onto
  // each tail, while/loop/for → accumulator IIFE collecting each
  // iteration's last value. Generated IIFE scaffolding sits OUTSIDE
  // role marks; branch/condition marks stay honest (cover rows over
  // lowered forms — §4.5's mappingKind by construction).

  static ifArms(node) {
    const arms = [];
    let cur = node;
    let elseBlock = null;
    while (true) {
      arms.push(cur);
      if (cur.length < 4) break;
      if (isNode(cur[3]) && cur[3][0] === 'if') {
        cur = cur[3];
        continue;
      }
      elseBlock = cur[3];
      break;
    }
    return { arms, elseBlock };
  }

  // Branch statements with erased statements FILTERED — shape
  // predicates (ifIsSimple, tail classification) and emission must
  // agree with the stripped twin's shape. Pure: records nothing.
  static branchStmts(b) {
    return Emitter.stripErased(isBlock(b) ? b.slice(1) : [b[0]]);
  }

  // The emission-path twin: same statements, with each erased one
  // recording its zero-width rows at the current output position.
  // `collectDecls` — passed by SLOTLESS lowerings (ternary arms) —
  // queues the branch's type declarations for the enclosing statement
  // list's flush (pendingTypeDecls) so the face never drops them.
  branchLive(b, collectDecls = false) {
    const raw = isBlock(b) ? b.slice(1) : [b[0]];
    if (this.ts && collectDecls) {
      for (const s of raw) {
        if (isNode(s) && s[0] === 'type-decl') this.pendingTypeDecls.push(s);
      }
    }
    return this.liveStmts(raw);
  }

  // A statement that cannot appear inside a ternary branch.
  static statementOnly(stmt) {
    if (typeof stmt === 'string' && (stmt === 'break' || stmt === 'continue' || stmt === 'debugger')) return true;
    return isNode(stmt) && (stmt[0] === 'return' || stmt[0] === 'throw' || isDefHead(stmt[0]));
  }

  // Control flow anywhere inside a statement: a break/continue/return/
  // throw at ANY depth (function boundaries excluded — a nested
  // function's return is its own) cannot cross an accumulator's push,
  // because the value lowering would trap it inside an IIFE. Such a
  // tail statement stays a statement. DELIBERATELY CONSERVATIVE: a
  // tail `if` whose control flow sits only on one branch could in
  // principle collect the other branch's value, but classifying which
  // shapes lower validly is a per-construct proof — refusing the whole
  // statement is always CORRECT (the loop yields fewer collected
  // values, never invalid JS or trapped control flow).
  static containsCtrl(stmt) {
    if (typeof stmt === 'string') return stmt === 'break' || stmt === 'continue';
    if (!isNode(stmt)) return false;
    const head = stmt[0];
    if (head === 'break' || head === 'continue' || head === 'return' || head === 'throw') return true;
    if (head === '->' || head === '=>' || isDefHead(head) || head === 'class') return false;
    return stmt.some((item) => Emitter.containsCtrl(item));
  }

  static ifIsSimple(node) {
    const { arms, elseBlock } = Emitter.ifArms(node);
    const ok = (b) => {
      const stmts = Emitter.branchStmts(b);
      return stmts.length === 1 && !Emitter.statementOnly(stmts[0]);
    };
    return arms.every((a) => ok(a[2])) && (elseBlock === null || ok(elseBlock));
  }

  valueIf(node) {
    if (!Emitter.ifIsSimple(node)) {
      // IIFE scaffolding is emitter-added syntax — it sits OUTSIDE the
      // $self mark, so the construct's cover anchor lands on the
      // `if` itself.
      const ind = this.ind;
      this.rejectYieldInIIFE(node);
      const isAsync = Emitter.containsAwait(node);
      this.b.emit(isAsync ? 'await (async () => { ' : '(() => { ');
      this.mark(node, '$self', () => this.returnifyIf(node, ind));
      this.b.emit(' })()');
      return;
    }
    this.mark(node, '$self', () => this.ifTernary(node));
  }

  ifTernary(node) {
    // Lowered-ternary conditions emit in 'value' context, which
    // self-parenthesizes compounds: `(n > 5) ? … : …`.
    // await conditions group in ternaries (`(await ok()) ? …`);
    // dammit conditions stay bare — the sugar's await surrounds a
    // complete call, which reads unambiguously.
    this.grouped(node, 'condition', node[1], Emitter.needsGrouping(node[1], 'operand') || (isNode(node[1]) && (node[1][0] === 'await' || node[1][0] === 'yield')));
    this.b.emit(' ? ');
    this.ternaryArm(node, 'then', this.branchLive(node[2], true)[0]);
    this.b.emit(' : ');
    if (node.length < 4) {
      this.b.emit('undefined');
    } else if (isNode(node[3]) && node[3][0] === 'if') {
      // An else-if chain nests as a parenthesized ternary.
      this.mark(node, 'else', () => {
        this.b.emit('(');
        this.ifTernary(node[3]);
        this.b.emit(')');
      });
    } else {
      this.ternaryArm(node, 'else', this.branchLive(node[3], true)[0]);
    }
  }

  ternaryArm(node, role, stmt) {
    this.mark(node, role, () => {
      const wrap = Emitter.needsGrouping(stmt, 'operand') || isUpdate(stmt);
      if (wrap) this.b.emit('(');
      this.expr(stmt);
      if (wrap) this.b.emit(')');
    });
  }

  // A brace block whose LAST statement returns its value — the body
  // shape shared by every returns-pushed lowering.
  returnBlock(block, ind) {
    const stmts = this.branchLive(block);
    this.b.emit('{\n');
    this.emitTsTypeDecls(isBlock(block) ? block.slice(1) : [block[0]], '  '.repeat(ind + 1));
    stmts.forEach((stmt, i) => {
      this.b.emit('  '.repeat(ind + 1));
      if (i === stmts.length - 1) this.implicitReturn(stmt, ind + 1);
      else this.statement(stmt, ind + 1);
      this.b.emit('\n');
    });
    this.b.emit('  '.repeat(ind) + '}');
  }

  returnifyIf(node, ind) {
    // The condition emits in 'value' context —
    // compound conditions arrive double-parenthesized: `if ((v > 0))`.
    this.b.emit('if (');
    this.grouped(node, 'condition', node[1], Emitter.needsGrouping(node[1], 'operand'));
    this.b.emit(') ');
    this.mark(node, 'then', () => this.returnBlock(node[2], ind));
    if (node.length >= 4) {
      this.b.emit(' else ');
      if (isNode(node[3]) && node[3][0] === 'if') this.returnifyIf(node[3], ind);
      else this.mark(node, 'else', () => this.returnBlock(node[3], ind));
    }
  }

  // A yield cannot cross a lowering IIFE's boundary: the arrow is not
  // a generator, so the emitted JS would be invalid.
  rejectYieldInIIFE(node) {
    if (Emitter.containsYield(node)) {
      throw this.positionedError(node, 'emitter: yield inside an expression-lowered construct cannot cross the IIFE boundary; restructure as statements');
    }
  }

  valueTry(node) {
    const ind = this.ind;
    this.rejectYieldInIIFE(node);
    this.b.emit(Emitter.containsAwait(node) ? 'await (async () => { ' : '(() => { ');
    this.mark(node, '$self', () => {
      this.b.emit('try ');
      this.mark(node, 'body', () => this.returnBlock(node[1], ind));
      for (const part of node.slice(2)) {
        if (!isNode(part)) continue;
        if (isBlock(part)) {
          this.b.emit(' finally ');
          this.braceBlock(part, ind);
        } else {
          const [binding, body] = part;
          if (binding === null) {
            this.b.emit(' catch ');
            this.returnBlock(body, ind);
          } else if (Emitter.isPattern(binding)) {
            this.b.emit(' catch (error) {\n');
            this.b.emit('  '.repeat(ind + 1) + '(');
            this.mark(part, 'binding', () => this.withPattern(() => this.expr(binding)));
            this.b.emit(' = error);\n');
            const stmts = this.branchLive(body);
            this.emitTsTypeDecls(isBlock(body) ? body.slice(1) : [body[0]], '  '.repeat(ind + 1));
            stmts.forEach((stmt, i) => {
              this.b.emit('  '.repeat(ind + 1));
              if (i === stmts.length - 1) this.implicitReturn(stmt, ind + 1);
              else this.statement(stmt, ind + 1);
              this.b.emit('\n');
            });
            this.b.emit('  '.repeat(ind) + '}');
          } else {
            this.b.emit(' catch (');
            this.mark(part, 'binding', () => this.b.emit(binding));
            this.b.emit(') ');
            this.returnBlock(body, ind);
          }
        }
      }
    });
    this.b.emit(' })()');
  }

  valueSwitch(node) {
    const [, subject, cases, dflt] = node;
    const ind = this.ind;
    const pad = '  '.repeat(ind);
    this.rejectYieldInIIFE(node);
    this.b.emit(Emitter.containsAwait(node) ? 'await (async () => { ' : '(() => { ');
    this.mark(node, '$self', () => {
      if (subject !== null) {
        this.b.emit('switch (');
        this.mark(node, 'subject', () => this.expr(subject));
        this.b.emit(') {\n');
        for (const when of cases) {
          const [, conditions, body] = when;
          for (const c of conditions) {
            this.b.emit(`${pad}  case `);
            this.expr(c);
            this.b.emit(':\n');
          }
          this.returnCaseBody(body, ind);
        }
        if (dflt !== null) {
          this.b.emit(`${pad}  default:\n`);
          this.returnCaseBody(dflt, ind);
        }
        this.b.emit(`${pad}}`);
      } else {
        // Subjectless switch lowers to an if/else chain with returns
        // (value context).
        cases.forEach((when, i) => {
          const [, conditions, body] = when;
          if (i > 0) this.b.emit(' else ');
          this.b.emit('if ((');
          this.expr(Array.isArray(conditions) ? conditions[0] : conditions);
          this.b.emit(')) ');
          this.returnBlock(body, ind);
        });
        if (dflt !== null) {
          this.b.emit(' else ');
          this.returnBlock(dflt, ind);
        }
      }
    });
    this.b.emit(' })()');
  }

  returnCaseBody(body, ind) {
    const stmts = this.branchLive(body);
    this.emitTsTypeDecls(isBlock(body) ? body.slice(1) : [body[0]], '  '.repeat(ind + 2));
    stmts.forEach((stmt, i) => {
      this.b.emit('  '.repeat(ind + 2));
      if (i === stmts.length - 1) this.implicitReturn(stmt, ind + 2);
      else this.statement(stmt, ind + 2);
      this.b.emit('\n');
    });
  }

  // The loop header for a value/tail-position accumulator: emits the
  // header (no brace) and returns the body plus the guard and body-top
  // setup emitters the caller lays out.
  loopHeader(node) {
    const head = node[0];
    if (head === 'while') {
      this.b.emit('while (');
      this.mark(node, 'condition', () => this.expr(node[1]));
      this.b.emit(')');
      return { body: node[node.length - 1], guard: node.length === 4 ? node[2] : null, setups: [] };
    }
    if (head === 'loop') {
      this.b.emit('while (true)');
      return { body: node[1], guard: null, setups: [] };
    }
    const [, vars, iter, aux, guard, body] = node;
    const setups = this.clauseHeader(node, head, vars, iter, aux);
    return { body, guard, setups };
  }

  // Loops as values collect each iteration's last body value (an
  // accumulator IIFE; the multiline style, unlike the inline if/try/
  // switch IIFEs). Setups and the guard `if` sit at the loop body's
  // level; guarded contents indent one deeper.
  accumulatorIIFE(node) {
    this.withBindings(this.loopBindingNames(node), () => this.accumulatorIIFECore(node));
  }

  accumulatorIIFECore(node) {
    const ind = this.ind;
    const p1 = '  '.repeat(ind + 1);
    this.rejectYieldInIIFE(node);
    this.b.emit(Emitter.containsAwait(node) ? 'await (async () => {\n' : '(() => {\n');
    this.b.emit(`${p1}const result = [];\n`);
    this.b.emit(p1);
    this.mark(node, '$self', () => {
      const { body, guard, setups } = this.loopHeader(node);
      this.b.emit(' {\n');
      const p2 = '  '.repeat(ind + 2);
      for (const setup of setups) {
        this.b.emit(p2);
        setup();
        this.b.emit('\n');
      }
      if (guard !== null && node[0] === 'while') {
        // A while's value-position guard SKIPS the iteration (`if
        // (!(guard)) continue;`) where the for family wraps the body —
        // the two guard styles, both pinned by the tests.
        this.b.emit(p2);
        this.b.emit('if (!(');
        this.expr(guard);
        this.b.emit(')) continue;\n');
        this.accumulateBody(body, ind + 1, 'result');
      } else if (guard !== null) {
        this.b.emit(p2);
        this.guardOpen(guard);
        this.accumulateBody(body, ind + 2, 'result');
        this.b.emit(`${p2}}\n`);
      } else {
        this.accumulateBody(body, ind + 1, 'result');
      }
      this.b.emit(`${p1}}`);
    });
    this.b.emit('\n');
    this.b.emit(`${p1}return result;\n`);
    this.b.emit('  '.repeat(ind) + '})()');
  }

  accumulateBody(body, ind, into) {
    const stmts = this.branchLive(body);
    const pad = '  '.repeat(ind + 1);
    this.emitTsTypeDecls(isBlock(body) ? body.slice(1) : [body[0]], pad);
    stmts.forEach((stmt, i) => {
      this.b.emit(pad);
      // A loop in the accumulator's tail stays a statement — its value
      // never collects — and carries the accumulator body's statement
      // semicolon. A tail statement carrying control flow stays a
      // statement too: its break/continue/return cannot cross a push.
      if (i === stmts.length - 1 && !Emitter.statementOnly(stmt) && !isLoopNode(stmt) && !Emitter.containsCtrl(stmt)) {
        this.b.emit(`${into}.push(`);
        const wrap = Emitter.needsGrouping(stmt, 'operand') || isUpdate(stmt);
        if (wrap) this.b.emit('(');
        this.expr(stmt);
        if (wrap) this.b.emit(')');
        this.b.emit(');');
      } else {
        this.statement(stmt, ind + 1);
        if (isLoopNode(stmt)) this.b.emit(';');
      }
      this.b.emit('\n');
    });
  }

  // A statement-position comprehension whose value is unused: a plain
  // loop, guard as a wrapping if. The statement semicolon belongs to
  // the caller — a function body's direct statements carry none.
  plainLoopComprehension(node, ind) {
    this.withBindings(this.loopBindingNames(node), () => this.plainLoopComprehensionCore(node, ind));
  }

  plainLoopComprehensionCore(node, ind) {
    const [, expr, [clause], guards] = node;
    const pad = '  '.repeat(ind);
    this.mark(node, '$self', () => {
      const [kind, vars, iter, aux] = clause;
      const setups = this.clauseHeader(node, kind, vars, iter, aux ?? null);
      this.b.emit(' {\n');
      let inner = `${pad}  `;
      for (const setup of setups) {
        this.b.emit(inner);
        setup();
        this.b.emit('\n');
      }
      if (guards.length > 0) {
        this.b.emit(inner);
        this.guardOpen(guards[0]);
        inner += '  ';
      }
      this.b.emit(inner);
      this.statement(expr, ind + (guards.length > 0 ? 2 : 1));
      this.b.emit('\n');
      if (guards.length > 0) this.b.emit(`${pad}  }\n`);
      this.b.emit(`${pad}}`);
    });
  }

  // Tail-position for-loops accumulate INLINE with `_result`
  // (no IIFE inside a function body).
  returnifyLoop(node, ind) {
    this.withBindings(this.loopBindingNames(node), () => this.returnifyLoopCore(node, ind));
  }

  returnifyLoopCore(node, ind) {
    const pad = '  '.repeat(ind);
    this.b.emit(`const _result = [];\n`);
    this.b.emit(pad);
    this.mark(node, '$self', () => {
      const { body, guard, setups } = this.loopHeader(node);
      this.b.emit(' {\n');
      const p1 = '  '.repeat(ind + 1);
      for (const setup of setups) {
        this.b.emit(p1);
        setup();
        this.b.emit('\n');
      }
      if (guard !== null) {
        this.b.emit(p1);
        this.guardOpen(guard);
        this.accumulateBody(body, ind + 1, '_result');
        this.b.emit(`${p1}}\n`);
      } else {
        this.accumulateBody(body, ind, '_result');
      }
      this.b.emit(`${pad}}`);
    });
    this.b.emit('\n');
    this.b.emit(`${pad}return _result;`);
  }

  ifChain(node, ind) {
    this.b.emit('if (');
    this.mark(node, 'condition', () => this.expr(node[1]));
    this.b.emit(') ');
    this.mark(node, 'then', () => this.braceBlock(node[2], ind));
    if (node.length === 4) {
      this.b.emit(' ');
      this.mark(node, 'else', () => {
        this.b.emit('else ');
        const tail = node[3];
        if (isIf(tail)) this.mark(tail, '$self', () => this.ifChain(tail, ind));
        else this.braceBlock(tail, ind);
      });
    }
  }

  defStatement(node, ind) {
    // A void def (head 'void-def') suppresses the implicit return;
    // its voidMarker role (side-band) covers the whole emitted
    // function — the bang's only generated manifestation. The
    // return-type role (side-band) covers it the same way;
    // mark() is a no-op for rows without the role.
    const isVoid = node[0] === 'void-def';
    const isAsync = Emitter.containsAwait(node[3]);
    // TS face: recorded overload signatures print immediately above
    // the implementation, outside its covers.
    this.tsOverloadSigs(node, ind);
    this.mark(node, 'voidMarker', () => this.mark(node, 'returnType', () => this.mark(node, '$self', () => {
      if (isAsync) this.b.emit('async ');
      this.b.emit(Emitter.containsYield(node[3]) ? 'function* ' : 'function ');
      this.mark(node, 'name', () => this.b.emit(node[1]));
      // Generic def: the TYPE_PARAMS side-band role
      // re-emits after the name, TS-only (`function wrap<T extends
      // string>(…)` — erased from JS).
      if (this.ts) {
        const tp = this.annotationText(node, 'typeParams');
        if (tp !== null) this.b.tsOnly(() => this.mark(node, 'typeParams', () => this.b.emit(tp)));
      }
      // The params role spans the parenthesized list (OptParams); the
      // ParamList array is itself a registered node, so the name list
      // inside the parens carries its own $self mapping.
      this.mark(node, 'params', () => {
        this.b.emit('(');
        this.mark(node[2], '$self', () => this.emitParams(node[2]));
        this.b.emit(')');
      });
      this.tsReturnAnnotation(node, isAsync, isVoid);
      this.b.emit(' ');
      const stmts = this.liveStmts(isBlock(node[3]) ? node[3].slice(1) : [node[3]], { forwards: true });
      const { entries, names } = this.scopedHoist([node[3]], node[2]);
      for (const n of this.pushReactiveFrame(stmts, names)) names.add(n);
      this.scopes.push(names);
      // def bodies implicitly return their last expression, same as
      // arrow functions — unless the def is void.
      this.funcBlock(node, node[3], stmts, ind, entries, isVoid);
      this.scopes.pop();
      this.rframes.pop();
    })));
  }

  returnStatement(node) {
    // A void function's body cannot return a value — the `!` on its
    // definition declares it returns undefined. Bare
    // `return` stays legal.
    if (node.length === 2 && this.sideEffectOnly) {
      throw this.positionedError(node, "emitter: cannot return a value from a void function (the trailing '!' on its definition suppresses returns)");
    }
    this.mark(node, '$self', () => {
      this.b.emit('return');
      if (node.length === 2) {
        this.b.emit(' ');
        this.grouped(node, 'value', node[1], Emitter.needsGrouping(node[1], 'return'));
      }
    });
    this.b.emit(';');
  }

  braceBlock(blockNode, ind, hoist = []) {
    const stmts = isNode(blockNode) && blockNode[0] === 'block' ? blockNode.slice(1) : [blockNode];
    this.mark(blockNode, '$self', () => {
      this.b.emit('{\n');
      if (hoist.length) {
        this.b.emit('  '.repeat(ind + 1));
        this.hoistLine(hoist, '  '.repeat(ind + 1));
        this.b.emit('\n');
      }
      this.mark(blockNode, 'statements', () => this.statements(stmts, ind + 1, 'block'));
      this.b.emit('  '.repeat(ind) + '}');
    });
  }

  // Child expressions whose position requires grouping. Grouping parens
  // are emitter-produced characters OUTSIDE the role mark — the parent's
  // syntax, not the child's code. The classification is structural; the
  // `.parenthesized` fat-node flag is never read for grouping — its
  // readers are SEMANTIC decisions where source parens select the
  // program (the postfix-if-else hoist guard, chain-link detection).
  //
  // Async marking: a function is async iff its BODY awaits — the walk
  // stops at nested function/class boundaries, so an inner arrow's
  // await marks the INNER function only. Dammit nodes are awaits by
  // construction.
  static containsAwait(sexpr) {
    if (!isNode(sexpr)) return false;
    const head = sexpr[0];
    if (head === 'await' || head === 'dammit!') return true;
    // An awaited for-as (`for await x as it`) is an await by
    // construction — its flag slot, not a nested node, carries it.
    if (head === 'for-as' && sexpr[3] === true) return true;
    if (head === '->' || head === '=>' || isDefHead(head) || head === 'class') return false;
    return sexpr.some((item) => Emitter.containsAwait(item));
  }

  // the implicit `it`: a ZERO-param arrow whose body
  // references the bare identifier `it` binds it as the single
  // parameter (`xs.map -> it * 2` → `function(it) { return it * 2 }`).
  // Nested functions decide for themselves (each zero-param arrow owns
  // its own `it`); member names and object keys are not references.
  static containsBareIt(n) {
    if (n === 'it') return true;
    if (!isNode(n)) return false;
    const head = n[0];
    if (head === '->' || head === '=>' || isDefHead(head)) return false;
    if ((head === '.' || head === '?.') && n.length === 3) {
      return Emitter.containsBareIt(n[1]) || (typeof n[2] !== 'string' && Emitter.containsBareIt(n[2]));
    }
    if (head === 'object') {
      return n.slice(1).some((pair) => isNode(pair) && pair[0] === ':' && pair.length === 3
        ? Emitter.containsBareIt(pair[2]) || (typeof pair[1] !== 'string' && Emitter.containsBareIt(pair[1]))
        : Emitter.containsBareIt(pair));
    }
    return n.some((item) => Emitter.containsBareIt(item));
  }

  // Generator marking, symmetric with containsAwait.
  static containsYield(sexpr) {
    if (!isNode(sexpr)) return false;
    const head = sexpr[0];
    if (head === 'yield' || head === 'yield-from') return true;
    if (head === '->' || head === '=>' || isDefHead(head) || head === 'class') return false;
    return sexpr.some((item) => Emitter.containsYield(item));
  }

  // ── The grouping lattice: ONE source of truth ──────────────────────
  // "Does construct X need grouping in context Y?" — keyed on the
  // precedence tier of the JS the construct EMITS. IIFE-lowered forms
  // (try/switch/loops, multi-branch value ifs) emit their own delimiters
  // and are therefore 'primary' by construction; a value-lowered SIMPLE
  // if emits a ternary and sits in the ternary tier.
  static jsTier(x) {
    if (!isNode(x)) return 'primary';
    // A cast erases to its value — grouping reads through it.
    if (x[0] === 'cast' && x.length === 3) return Emitter.jsTier(x[1]);
    if (isAssign(x)) return 'assign';
    if (isTernary(x) || (isIf(x) && x.length <= 4 && Emitter.ifIsSimple(x))) return 'ternary';
    // Postfix existence emits a `!=` comparison — the binary tier.
    if (x[0] === '?' && x.length === 2) return 'binary';
    // Postfix presence emits a ternary — the ternary tier.
    if (x[0] === 'presence' && x.length === 2) return 'ternary';
    if (isBinary(x) || isRelation(x)) return 'binary';
    if (isUnary(x)) return 'unary';
    // await-expressions (and dammit sugar, which EMITS one) sit in the
    // unary tier: they group in head position (`(await f()).x`) but
    // bind tighter than any binary as operands (`await f() + 1`, bare).
    if ((x[0] === 'await' || x[0] === 'dammit!') && x.length === 2) return 'unary';
    // yield has the LOWEST JS precedence: it groups as an operand
    // (`(yield 1) + 2`) and in head position.
    if ((x[0] === 'yield' || x[0] === 'yield-from') && x.length <= 2) return 'yield';
    if (isFunc(x)) return 'function';
    if (isObject(x)) return 'object';
    return 'primary';
  }

  // Contexts:
  //   'operand'   — binary/unary operands, conditions, array items,
  //                 pushed/returned values: every tier at or below
  //                 binary precedence groups. Documented
  //                 exceptions: `!` and `typeof` bind tighter
  //                 than any binary and emit bare (`!x && y`,
  //                 `1 + typeof y`); object literals self-delimit as
  //                 operands (`[{a: 1}, 2]`); spreads bind their
  //                 operand at the emit site.
  //   'head'      — member-object, call-callee, index-object: EVERY
  //                 non-primary tier groups — dropping the parens
  //                 rebinds the trailing accessor onto the last
  //                 sub-expression (`(a ? f : g)()`, `(a in b).s()`,
  //                 `(!x).y`, `({n: 1}).n`).
  //   'statement' — statement start: the forms JS treats specially
  //                 there group — object braces (would open a block),
  //                 bare `->` functions (unnamed
  //                 declaration), class expressions, update
  //                 statements (`(i++);`), delete statements
  //                 (`(delete a.b);`), ternaries unless the assignment
  //                 hoist rewrites them into assignment statements.
  static needsGrouping(child, context) {
    const tier = Emitter.jsTier(child);
    if (context === 'operand' || context === 'return') {
      if (tier === 'unary') {
        return child[0] !== '!' && child[0] !== 'typeof' && child[0] !== 'await' && child[0] !== 'dammit!';
      }
      // A return value is an operand position EXCEPT for yield: `return
      // yield 1` is valid JS and needs no grouping.
      if (tier === 'yield') return context === 'operand';
      return tier === 'binary' || tier === 'ternary' || tier === 'assign' || tier === 'function';
    }
    if (context === 'head') return tier !== 'primary';
    // context === 'statement'
    return tier === 'object' || isUpdate(child) ||
      (tier === 'function' && child[0] === '->') ||
      (isNode(child) && (child[0] === 'class' || child[0] === 'component')) ||
      (isTernary(child) && !Emitter.ternaryHoists(child)) ||
      (isNode(child) && child[0] === 'presence' && child.length === 2) ||
      (tier === 'unary' && child[0] === 'delete');
  }

  operand(node, role, child) {
    this.grouped(node, role, child, Emitter.needsGrouping(child, 'operand'));
  }

  head(node, role, child) {
    this.grouped(node, role, child, Emitter.needsGrouping(child, 'head'));
  }

  grouped(node, role, child, wrap) {
    if (wrap) this.b.emit('(');
    this.mark(node, role, () => this.expr(child));
    if (wrap) this.b.emit(')');
  }

  // Template-literal escaping for string content emitted inside backticks.
  static escapeTemplate(s) {
    return s.replace(/`|\$\{/g, (m) => `\\${m}`);
  }

  // The deterministic nesting bound: deep left-nested trees
  // (thousand-deep comparison chains) exhausted the native stack at a
  // machine-dependent depth — a bare engine RangeError. Every
  // recursive emission cycle passes through expr(), so this one
  // counter turns the failure into a positioned diagnostic at a
  // depth the bound guarantees is reachable on every machine first.
  static MAX_EXPR_DEPTH = 1024;

  expr(node) {
    if (++this.exprDepth > Emitter.MAX_EXPR_DEPTH) {
      const err = this.positionedError(node,
        `emitter: expression nesting exceeds ${Emitter.MAX_EXPR_DEPTH} levels — restructure the expression (the compile-time nesting bound)`);
      // The bound can trip on a primitive atom (no NodeStore row);
      // the innermost OPEN mark carries the enclosing construct's
      // real source span.
      if (typeof err.start !== 'number' && this.b.currentMark) {
        err.start = this.b.currentMark.sourceStart;
        err.end = this.b.currentMark.sourceEnd;
      }
      throw err;
    }
    try {
      this.exprCore(node);
    } finally {
      this.exprDepth--;
    }
  }

  exprCore(node) {
    if (!isNode(node)) {
      // String atoms carry their delimiter as their value's own first/
      // last character: heredoc-derived values are backtick-delimited
      // (already template-escaped by the lexer) and emit verbatim;
      // quoted values emit verbatim. No metadata channel exists.
      // A bare identifier naming a reactive declaration is a READ (or,
      // in target position, a WRITE) of its container and unwraps to
      // `.value` — the reactive rewrite. Every position where a bare
      // string is a NAME rather than a reference (object keys, member
      // properties, import/export specifiers, params, loop variables,
      // the declaration target itself) emits through this.b directly
      // and never reaches this path — suppression by construction
      if (typeof node === 'string') {
        const rewrite = this.bareRewrite(node);
        if (rewrite === 'reactive') return this.reactiveRead(node);
        if (rewrite !== null) return this.memberRead(node, rewrite === 'member-reactive');
        // Inside a render factory, `this` (spelled bare or through
        // `@member` chains) is the ctx parameter — the factory methods
        // run unbound, so a literal `this` would be the block handle.
        if (node === 'this' && this.renderSelf !== null) return this.b.emit(this.renderSelf);
      }
      this.b.emit(node);
      return;
    }
    const head = node[0];
    if (head === 'str') return this.strTemplate(node);
    if (head === 'here-regex') return this.heregex(node);
    if (isNode(head)) return this.call(node);
    // An assignment whose target spine holds an optional link lowers to
    // a guarded form (JS forbids optional chains in assignment targets).
    if ((ASSIGNS.has(head) || head === '//=' || head === '%%=') && node.length === 3 && !this.inPattern) {
      const guard = Emitter.optionalGuard(node[1]);
      if (guard !== null) return this.optionalAssign(node, guard, 'value');
    }
    if (ASSIGNS.has(head) && node.length === 3) return this.assign(node);
    if ((head === '.' || head === '?.') && node.length === 3) return this.member(node);
    if ((head === '.{}' || head === '?.{}') && node.length >= 3) return this.pick(node);
    if (head === '[]' && node.length === 3) return this.index(node);
    if (head === 'optindex' && node.length === 3) return this.optIndex(node);
    if (head === 'optcall') return this.optCall(node);
    if (isFunc(node)) return this.func(node);
    if (isUpdate(node)) return this.update(node);
    if (isTernary(node)) return this.ternary(node);
    if (head === 'array') return this.array(node);
    if (head === 'object') return this.object(node);
    if (isRange(node)) return this.range(node);
    if ((head === 'in' || head === 'of') && node.length === 3) return this.relation(node);
    if (head === 'instanceof' && node.length === 3) {
      // Plain JS binary — no lowering.
      this.mark(node, '$self', () => {
        this.operand(node, 'left', node[1]);
        this.b.emit(' ');
        this.mark(node, 'operator', () => this.b.emit('instanceof'));
        this.b.emit(' ');
        this.operand(node, 'right', node[2]);
      });
      return;
    }
    if (head === '//' && node.length === 3) return this.floorDiv(node);
    if (head === '%%' && node.length === 3) return this.modulo(node);
    if (head === '//=' && node.length === 3) return this.floorDivAssign(node);
    if (head === '%%=' && node.length === 3) return this.moduloAssign(node);
    if (head === 'comprehension') return this.comprehension(node, this.ind);
    if (head === 'do-iife' && node.length === 2) return this.doIife(node);
    if (head === 'cast' && node.length === 3) return this.cast(node);
    if (head === '?' && node.length === 2) return this.existence(node);
    if (head === 'presence' && node.length === 2) return this.presence(node);
    if (head === 'await' && node.length === 2) return this.awaitExpr(node);
    if (head === 'dammit!' && node.length === 2) return this.dammit(node);
    if ((head === 'yield' || head === 'yield-from') && node.length <= 2) return this.yieldExpr(node);
    if (head === 'class') return this.classExpr(node);
    // A reactive declaration lowers to a `const` declaration, which has
    // no value form — expression positions reject
    //. A user CALL that impersonates the head
    // (`state a, 0` — semanticKind 'call') passes through to call
    // emission below.
    if (this.isReactiveDecl(node)) {
      const op = head === 'state' ? ':=' : '~=';
      throw this.positionedError(node, `emitter: a reactive declaration ('${typeof node[1] === 'string' ? node[1] : '…'} ${op} …') is a statement — it lowers to a const declaration, which has no expression form`);
    }
    // A readonly declaration is the same class: it lowers to a const
    // declaration, which has no expression form. A user CALL impersonating the head passes
    // through to call emission.
    if (this.isReadonlyDecl(node)) {
      throw this.positionedError(node, `emitter: a readonly declaration ('${typeof node[1] === 'string' ? node[1] : '…'} =! …') is a statement — it lowers to a const declaration, which has no expression form `);
    }
    // A BARE effect is a valid expression — `x = (~> f())` binds the
    // disposer. The BOUND form lowers to a const declaration, which
    // has no expression form .
    if (this.isEffectDecl(node)) {
      if (node[1] !== null) {
        throw this.positionedError(node, `emitter: a bound effect ('${typeof node[1] === 'string' ? node[1] : '…'} ~> …') is a statement — it lowers to a const declaration, which has no expression form ; a BARE '~> …' is the expression form`);
      }
      this.mark(node, '$self', () => this.effectValue(node, node[2], this.ind, true));
      return;
    }
    if (head === 'schema' && node.length === 2) return this.schemaExpr(node);
    // Components. The declaration lowers to an anonymous
    // class expression; render/offer/accept nodes reaching expression
    // position sit OUTSIDE a component's direct body — reject with
    // the rule, positioned. (User CALLS spelling the heads —
    // `offer(x)` outside a component — have semanticKind 'call' and
    // fall through to call emission.)
    if (this.isComponentDecl(node)) return this.componentExpr(node);
    if (this.isRenderNode(node)) {
      throw this.positionedError(node, 'emitter: render blocks can only be used inside a component (as a direct body line)');
    }
    if (this.isOfferNode(node)) {
      throw this.positionedError(node, 'emitter: offer can only be used as a direct component body line');
    }
    if (this.isAcceptNode(node)) {
      throw this.positionedError(node, 'emitter: accept can only be used as a direct component body line');
    }
    if (head === 'super') return this.superCall(node);
    if (head === 'new' && node.length === 2) return this.newExpr(node);
    if (head === '...' && node.length === 2) return this.spread(node);
    if (isBinary(node)) return this.binary(node);
    if (isUnary(node)) return this.unary(node);
    if (head === 'block') {
      // A parenthetical multi-statement in expression position is a
      // comma expression, self-parenthesized.
      this.mark(node, '$self', () => {
        this.b.emit('(');
        node.slice(1).forEach((el, i) => {
          if (i > 0) this.b.emit(', ');
          this.expr(el);
        });
        this.b.emit(')');
      });
      return;
    }
    // Value-usage lowerings (context-sensitive codegen): statement
    // constructs in expression position lower to ternaries or IIFEs.
    if (head === 'if' && node.length >= 3 && node.length <= 4) return this.valueIf(node);
    if (head === 'try') return this.valueTry(node);
    if (head === 'switch' && node.length === 4) return this.valueSwitch(node);
    if (head === 'while' && (node.length === 3 || node.length === 4)) return this.accumulatorIIFE(node);
    if (head === 'loop' && node.length === 2) return this.accumulatorIIFE(node);
    if ((head === 'for-in' || head === 'for-of' || head === 'for-as') && node.length === 6) return this.accumulatorIIFE(node);
    if (isDefHead(head) || head === 'return' || head === 'program') {
      throw this.positionedError(node, `emitter: '${head}' is not supported in expression position`);
    }
    // Erased type statements never emit as expressions — every
    // statement list filters them (liveStmts). Reaching here means a
    // list was missed; failing loudly beats emitting a silent call of
    // the node head.
    if (head === 'type-decl' || Emitter.isTypedWrapper(node)) {
      throw this.positionedError(node, 'emitter: an erased type statement reached expression position — a statement list missed its filter');
    }
    return this.call(node);
  }

  // The OUTERMOST optional link on an assignment target's member/index
  // spine (null when the spine has none). Its object is the guard: it
  // keeps its own inner optionals — they short-circuit the guard
  // itself — while the rewritten target emits every link plain
  // (withDeopt): the guard already proved the whole spine non-null.
  static optionalGuard(t) {
    if (!isNode(t) || t.length !== 3) return null;
    if (t[0] === '?.' || t[0] === 'optindex') return t;
    if (t[0] === '.' || t[0] === '[]') return Emitter.optionalGuard(t[1]);
    return null;
  }

  // Assignment through an optional chain: statement position guards
  // with `if (guard != null) …`; value position lowers to a ternary
  // yielding undefined when the guard is nullish. The guard emission
  // is a second generated manifestation of the optional link's
  // `object` role, so
  // leaf guards map exactly.
  optionalAssign(node, optLink, context) {
    const op = node[0];
    const guard = () => this.mark(optLink, 'object', () => this.expr(optLink[1]));
    const target = () => this.mark(node, 'target', () => this.withTarget(() => this.withDeopt(() => this.expr(node[1]))));
    const value = () => this.mark(node, 'value', () => this.withExpression(() => this.expr(node[2])));
    const emitAssign = () => {
      if (op === '//=') {
        target();
        this.b.emit(' = Math.floor(');
        target();
        this.b.emit(' / ');
        value();
        this.b.emit(')');
      } else if (op === '%%=') {
        target();
        this.b.emit(' = ' + Emitter.MODULO + '(');
        target();
        this.b.emit(', ');
        value();
        this.b.emit(')');
      } else {
        target();
        this.b.emit(' ');
        this.mark(node, 'operator', () => this.b.emit(op));
        this.b.emit(' ');
        value();
      }
    };
    this.mark(node, '$self', () => {
      if (context === 'statement') {
        this.b.emit('if (');
        guard();
        this.b.emit(' != null) ');
        emitAssign();
      } else {
        // Bare ternary — the node keeps its assign tier, so operand
        // positions group it through needsGrouping like any assignment.
        guard();
        this.b.emit(' != null ? (');
        emitAssign();
        this.b.emit(') : undefined');
      }
    });
  }

  assign(node) {
    // Pattern targets emit as direct ES destructuring —
    // names hoist like plain targets. An OBJECT pattern wraps the whole
    // assignment in parens (a bare `{` would open a block)
    // — except inside an enclosing pattern, where this `=` is a DEFAULT
    // and parens/grouping are invalid destructuring JS. The default's
    // value is an expression position again.
    const patternTarget = Emitter.isPattern(node[1]);
    const wrapParens = isObject(node[1]) && !this.inPattern;
    // A void definition (`save! = ->`, head 'void-assign') validates its
    // function value and emits as a plain '='; the value's body owns
    // the void shape. The voidMarker role (side-band) covers the
    // whole emitted assignment — the bang's only generated
    // manifestation; mark() is a no-op for plain rows (no such role).
    if (node[0] === 'void-assign') this.registerVoidValue(node[2], node);
    // A typed declaration's annotation role (side-band) covers
    // the whole emitted assignment — its only generated manifestation;
    // mark() is a no-op for the untyped rows (no such role).
    // Tier-1 declare-in-place: this statement's `=` also declares its
    // (always plain-name) target. The `let ` is declaration syntax the
    // statement adds — like semicolons and indentation it sits OUTSIDE
    // all role marks, so every role row (including $self) keeps its
    // exact source↔generated slice.
    if (Emitter.declaresInPlace.has(node)) this.b.emit('let ');
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
      if (this.ts && Emitter.declaresInPlace.has(node)) {
        const owner = Emitter.inlineOwners.get(node);
        const text = this.annotationText(node) ?? (owner !== undefined ? this.annotationText(owner) : null);
        if (text !== null) {
          this.tsAnnotate(owner ?? node, 'annotation', text);
        } else {
          const story = this.schemaStories?.get(node);
          if (story && !story.decl.exported && story.constType !== null) {
            this.b.tsOnly(() => this.b.emit(`: ${story.constType}`));
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
        this._componentTypeParams = this.annotationText(node, 'typeParams');
      }
      this.mark(node, 'value', () => this.withExpression(() => this.expr(node[2])));
      this._schemaName = prevSchemaName;
      this._componentName = prevComponentName;
      this._componentTypeParams = prevComponentTypeParams;
      if (wrapParens) this.b.emit(')');
    })));
  }

  // ["state", target, value] | ["computed", target, value] — the reactive
  // reactive declarations, statement position only (guarded by the
  // dispatch's isReactiveDecl and the expression-path rejection).
  //
  //   count := e        → const count = __state(e);
  //   total ~= e        → const total = __computed(() => e);
  //   total ~= <block>  → const total = __computed(() => { … });
  //
  // Mapping story (the bidirectional-mapping showcase): $self covers the whole
  // lowering; target is exact on the name (both here and, for typed
  // forms, under the annotation's cover); operator is the
  // side-band role — its RoleStore span is the `:=`/`~=` token, its
  // generated manifestation the emitted `=` (a cover row by
  // construction: the glyphs differ). The `__state(` / `__computed(()
  // => ` glyphs are the lowering's own text — inside $self, outside
  // every child role (§4.6: cover rows over the lowering, exact rows
  // on user expressions).
  reactiveDecl(node, ind) {
    const [head, target, value] = node;
    const op = head === 'state' ? ':=' : '~=';
    if (typeof target !== 'string') {
      throw this.positionedError(node, `emitter: a reactive declaration takes a plain name — '<target> ${op} …' cannot declare a ${isNode(target) && target[0] === 'object' ? 'destructuring pattern' : isNode(target) && target[0] === 'array' ? 'destructuring pattern' : 'member or index target'}`);
    }
    // The lowering CALLS the runtime name the declaration would bind —
    // no working reading exists (the declared-boundary class).
    if ((head === 'state' && target === '__state') || (head === 'computed' && target === '__computed')) {
      throw this.positionedError(node, `emitter: '${target} ${op} …' would bind the very runtime name its own lowering calls (const ${target} = ${target}(…) — a TDZ self-reference); rename the variable`);
    }
    // A computed body evaluates SYNCHRONOUSLY (the runtime computes
    // lazily and caches — there is no async
    // computed). Nested functions keep their own awaits/yields.
    if (head === 'computed' && Emitter.containsAwait(value)) {
      throw this.positionedError(node, "emitter: a computed ('~=') body cannot await — computeds evaluate synchronously (make it a state written by an effect)");
    }
    if (head === 'computed' && Emitter.containsYield(value)) {
      throw this.positionedError(node, "emitter: a computed ('~=') body cannot yield — computeds evaluate synchronously");
    }
    // A typed declaration's annotation role (side-band) covers the
    // whole emitted declaration — its only generated manifestation;
    // mark() is a no-op for the untyped rows.
    this.mark(node, 'annotation', () => this.mark(node, '$self', () => {
      this.b.emit('const ');
      this.mark(node, 'target', () => this.b.emit(target));
      // TS face: a typed reactive declaration types its CONTAINER —
      // the annotation names the `.value` slot (the dts convention;
      // a computed's container is read-only from the outside), and
      // the container carries the `read(): T` structural brand (the
      // runtime's detection predicate — src/component-types.js has
      // the doctrine): a plain `{ value: … }` literal must never
      // satisfy a container position the runtime would double-wrap.
      if (this.ts && this.annotationText(node) !== null) {
        const ro = head === 'computed' ? 'readonly ' : '';
        this.tsAnnotate(node, 'annotation', containerType(this.annotationText(node), ro));
      } else if (this.ts) {
        // Unannotated reactive with a syntactically-evident value type
        //: the container annotates from the
        // initializer alone — `clicks := 0` is a number cell, `~=
        // clicks * 2` a readonly number cell — so the cell CHECKS and
        // the hover has a value type to present. Non-evident
        // initializers stay untyped (the inlined runtime's inference).
        // No `satisfies` here: the type came FROM the value.
        const t = syntacticLiteralType(value);
        if (t !== null) {
          const ro = head === 'computed' ? 'readonly ' : '';
          this.b.tsOnly(() => this.b.emit(`: ${containerType(t, ro)}`));
        }
      }
      this.b.emit(' ');
      this.mark(node, 'operator', () => this.b.emit('='));
      this.b.emit(' ');
      // Annotation ENFORCEMENT: the container
      // annotation above types the cell, not the value — the
      // initializer flows into __state()/__computed() unchecked (the
      // runtime is inlined JS, so no generic constrains it). A
      // TS-only `satisfies` closes the gap: it checks assignability
      // WITHOUT changing the expression's type (the cell inference is
      // undisturbed) and strips to the identical JS. For `~=`
      // the lambda wraps so `satisfies () => T` checks the RETURN
      // type. Marked under the annotation role, so the fired error
      // maps to the author's `: T`.
      const enforce = this.ts ? this.annotationText(node) : null;
      if (head === 'state') {
        this.b.emit('__state(');
        // The initializer is an operand position (value context:
        // compounds group — `__state((1 + 2))`).
        this.mark(node, 'value', () => this.withExpression(() => {
          const wrap = Emitter.needsGrouping(value, 'operand');
          if (wrap) this.b.emit('(');
          this.expr(value);
          if (wrap) this.b.emit(')');
        }));
        if (enforce !== null) this.b.tsOnly(() => this.mark(node, 'annotation', () => this.b.emit(` satisfies ${enforce}`)));
        this.b.emit(')');
      } else {
        this.b.emit('__computed(');
        if (enforce !== null) this.b.tsOnly(() => this.b.emit('('));
        this.b.emit('() => ');
        this.mark(node, 'value', () => this.withExpression(() => this.computedBody(node, value, ind)));
        if (enforce !== null) this.b.tsOnly(() => this.mark(node, 'annotation', () => this.b.emit(`) satisfies () => ${enforce}`)));
        this.b.emit(')');
      }
    }));
    this.b.emit(';');
  }

  // The computed body: a multi-statement Block emits as a braced
  // function body (hoists, implicit return — its own scope and
  // reactive frame); everything else inlines as the arrow's
  // expression body. A single-statement Block reads through expr's
  // comma-expression path (`(1 + 2)`); object literals
  // group (a bare `{` would open a block body).
  computedBody(node, value, ind) {
    if (isBlock(value) && value.length > 2) {
      const stmts = this.liveStmts(value.slice(1), { forwards: true });
      const { entries, names } = this.scopedHoist(stmts, []);
      for (const n of this.pushReactiveFrame(stmts, names)) names.add(n);
      this.scopes.push(names);
      this.funcBlock(node, value, stmts, ind, entries);
      this.scopes.pop();
      this.rframes.pop();
      return;
    }
    const wrap = Emitter.needsGrouping(value, 'operand') || isObject(value);
    if (wrap) this.b.emit('(');
    this.expr(value);
    if (wrap) this.b.emit(')');
  }

  // ["readonly", target, value] — the readonly declaration,
  // statement position only (guarded by the dispatch's isReadonlyDecl
  // and the expression-path rejection).
  //
  //   x =! e  →  const x = e;
  //
  // A plain const — no runtime call (JS itself
  // enforces the reassignment; writes emit bare against the const and
  // hit JS's own TypeError, the handle precedent). The value is
  // an operand position (compounds group — `const x = (1 + 2);`)
  // and unwraps reactive reads like any expression
  // (`ro =! count` → `const ro = count.value;` — a value SNAPSHOT,
  // the readonly contract).
  //
  // Mapping story (the reactive mapping pattern): $self covers the whole
  // lowering; target is exact on the name; operator is the
  // side-band role — its RoleStore span is the `=!` token, its
  // generated manifestation the emitted `=` (a cover row by
  // construction: the glyphs differ); a typed twin's annotation role
  // covers the whole declaration.
  readonlyDecl(node, ind) {
    const [, target, value] = node;
    if (typeof target !== 'string') {
      throw this.positionedError(node, `emitter: a readonly declaration takes a plain name — '<target> =! …' cannot declare a ${isNode(target) && (target[0] === 'object' || target[0] === 'array') ? 'destructuring pattern' : 'member or index target'}`);
    }
    this.mark(node, 'annotation', () => this.mark(node, '$self', () => {
      this.b.emit('const ');
      this.mark(node, 'target', () => this.b.emit(target));
      if (this.ts && this.annotationText(node) !== null) {
        this.tsAnnotate(node, 'annotation', this.annotationText(node));
      }
      this.b.emit(' ');
      this.mark(node, 'operator', () => this.b.emit('='));
      this.b.emit(' ');
      this.mark(node, 'value', () => this.withExpression(() => {
        const wrap = Emitter.needsGrouping(value, 'operand');
        if (wrap) this.b.emit('(');
        this.expr(value);
        if (wrap) this.b.emit(')');
      }));
    }));
    this.b.emit(';');
  }

  // ["effect", target|null, body] — the effect statement.
  //
  //   ~> expr           → __effect(() => { expr; });
  //   ~> <block>        → __effect(() => { … });         (implicit return
  //                       of the last expression — the CLEANUP channel)
  //   ~> -> body        → __effect((function() { … }));  (arrow value
  //   h ~> => body      → const h = __effect(() => …);    passes through
  //                       AS the effect function)
  //   h ~> body         → const h = __effect(…);          (the dispose
  //                       handle — a plain const, never reactive)
  //
  // An awaiting body emits an ASYNC arrow riding the runtime's
  // async semantics (per-run AbortSignal, stale guards).
  //
  // Mapping story: $self covers the whole lowering; the bound form's
  // target is exact and its operator role (the side-band label on
  // the dropped EFFECT token) covers the emitted `=` (the reactive
  // pattern); the BARE form's operator covers the emitted `__effect`
  // name — the `~>` glyph's only generated manifestation. The body
  // (`value` role) covers the synthesized wrapper; user statements
  // inside stay exact.
  effectStatement(node, ind) {
    const [, target, body] = node;
    if (target !== null && typeof target !== 'string') {
      throw this.positionedError(node, `emitter: an effect handle takes a plain name — '<target> ~> …' cannot bind a ${isNode(target) && (target[0] === 'object' || target[0] === 'array') ? 'destructuring pattern' : 'member or index target'}`);
    }
    // The lowering CALLS the runtime name the handle would bind — no
    // working reading exists (the declared-boundary class).
    if (target === '__effect') {
      throw this.positionedError(node, `emitter: '__effect ~> …' would bind the very runtime name its own lowering calls (const __effect = __effect(…) — a TDZ self-reference); rename the handle`);
    }
    // The runtime calls the effect function — a generator frame would
    // never run its body. Nested functions keep
    // their own yields.
    if (Emitter.containsYield(body)) {
      throw this.positionedError(node, "emitter: an effect ('~>') body cannot yield — the runtime calls the effect function (make the generator a named function the effect calls)");
    }
    this.mark(node, 'annotation', () => this.mark(node, '$self', () => {
      if (target !== null) {
        this.b.emit('const ');
        this.mark(node, 'target', () => this.b.emit(target));
        if (this.ts && this.annotationText(node) !== null) {
          this.tsAnnotate(node, 'annotation', this.annotationText(node));
        }
        this.b.emit(' ');
        this.mark(node, 'operator', () => this.b.emit('='));
        this.b.emit(' ');
        this.effectValue(node, body, ind, false);
      } else {
        this.effectValue(node, body, ind, true);
      }
    }));
    this.b.emit(';');
  }

  // The `__effect(…)` call itself — shared by the statement form and
  // the bare form's expression position (`x = (~> f())` binds the
  // disposer). `markOp` marks the operator role over the emitted
  // `__effect` name (the bare form; the bound form's operator is its
  // `=`).
  effectValue(node, body, ind, markOp) {
    const emitName = () => {
      if (markOp) this.mark(node, 'operator', () => this.b.emit('__effect'));
      else this.b.emit('__effect');
    };
    // Arrow-valued bodies pass through AS the effect function; the
    // arrow's own emission carries async when its body awaits. `->`
    // groups (`__effect((function() {…}))`); `=>` emits bare.
    if (isFunc(body)) {
      emitName();
      this.b.emit('(');
      this.mark(node, 'value', () => this.withExpression(() => {
        const wrap = body[0] === '->';
        if (wrap) this.b.emit('(');
        this.expr(body);
        if (wrap) this.b.emit(')');
      }));
      this.b.emit(')');
      return;
    }
    const isAsync = Emitter.containsAwait(body);
    emitName();
    this.b.emit(isAsync ? '(async () => ' : '(() => ');
    if (isBlock(body)) {
      // A block body is a function body: own scope and reactive frame,
      // hoists, implicit return of the last expression — the cleanup
      // channel (a returned function runs before the next run and on
      // dispose; the runtime owns that contract).
      this.mark(node, 'value', () => this.withExpression(() => {
        const stmts = this.liveStmts(body.slice(1), { forwards: true });
        const { entries, names } = this.scopedHoist(stmts, []);
        for (const n of this.pushReactiveFrame(stmts, names)) names.add(n);
        this.scopes.push(names);
        this.funcBlock(node, body, stmts, ind, entries);
        this.scopes.pop();
        this.rframes.pop();
      }));
      this.b.emit(')');
      return;
    }
    // A single-expression body wraps as a braced statement with NO
    // return — the expression form has no cleanup channel. Still its
    // own function scope: a new name it assigns hoists INSIDE the
    // wrapper; object literals group — a bare `{`
    // would open a block.
    const { entries, names } = this.scopedHoist([body], []);
    this.scopes.push(names);
    this.rframes.push({ reactive: new Set(), bound: names });
    this.b.emit('{ ');
    if (entries.length) {
      this.hoistLine(entries);
      this.b.emit(' ');
    }
    this.mark(node, 'value', () => this.withExpression(() => {
      const wrap = Emitter.needsGrouping(body, 'operand') || isObject(body);
      if (wrap) this.b.emit('(');
      this.expr(body);
      if (wrap) this.b.emit(')');
    }));
    this.b.emit('; })');
    this.scopes.pop();
    this.rframes.pop();
  }

  // ── Components: declarations, the member model, the static
  // render DSL ────────────────────────────────────────────────────────
  // A component declaration lowers to an anonymous class extending the
  // runtime's __Component: members categorize into the seven-spelling
  // model and lower into _init(props)'s order (readonly → plain
  // → accept → state → computed → offer → effects); methods and the
  // exact-five lifecycle hooks emit as class methods; the render block
  // lowers to _create()/_setup(). The categorization is TOTAL — a body
  // statement matching no category REJECTS positioned,
  // duplicate members and render blocks reject, and
  // `offer` takes member declarations only (#127).

  // The exact-five lifecycle hooks — src/component-types.js is the
  // single source (the type story reads the same set).
  static COMPONENT_HOOKS = COMPONENT_HOOKS;

  // Boolean HTML attributes the render DSL toggles as properties of
  // presence.
  static BOOLEAN_ATTRS = new Set([
    'disabled', 'hidden', 'readonly', 'required', 'checked', 'selected',
    'autofocus', 'autoplay', 'controls', 'loop', 'muted', 'multiple',
    'novalidate', 'open', 'reversed', 'defer', 'async', 'formnovalidate',
    'allowfullscreen', 'inert',
  ]);

  static SVG_NS = 'http://www.w3.org/2000/svg';

  // The kind checks. `component` is a keyword (its head is not
  // spellable), but render/offer/accept heads ARE — `offer(x)` outside
  // a component builds ["offer", …] with semanticKind 'call' — so the
  // NodeStore semanticKind decides everywhere (the head-naming convention).
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
  isAcceptNode(x) { return this.componentKindOf(x, 'accept', 2); }

  // A member TARGET: `x` (private) or `@x` ([".", "this", "x"] —
  // public). Returns { name, isPublic } or null.
  static memberTarget(t) {
    if (typeof t === 'string') return { name: t, isPublic: false };
    if (isNode(t) && t[0] === '.' && t[1] === 'this' && t.length === 3 && typeof t[2] === 'string') {
      return { name: t[2], isPublic: true };
    }
    return null;
  }

  // ["component", parent, ["block", …]] — the declaration. Expression
  // position (the value of `Card = component …`); statement position
  // groups like a class expression.
  componentExpr(node) {
    const [, parent, body] = node;
    // `component extends <tag>` — the rest-forwarding surface: the
    // parent must be a real HTML tag — any other word would emit
    // DEAD rest machinery for a component or junk parent: no
    // inheritance, no target element).
    let extendsTag = null;
    if (parent !== null) {
      const p = typeof parent === 'string' ? parent : null;
      if (p === null || !isHtmlTag(p) || p.includes('#')) {
        throw this.positionedError(node,
          `emitter: 'component extends' takes an HTML tag — rest props forward onto the first '<tag>' element the ` +
          `render creates; '${typeof parent === 'string' ? parent : '…'}' is not one ` +
          '(component-to-component inheritance is not a surface)');
      }
      extendsTag = p;
    }
    const stmts = isBlock(body) ? body.slice(1) : [];

    // ── Categorization: the member model, total by construction ──
    const readonlyVars = [];
    const plainVars = [];
    const stateVars = [];
    const derivedVars = [];
    const methods = [];
    const hooks = [];
    const effects = [];
    const offeredVars = [];
    const acceptedVars = [];
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
      if (name === 'mount' || name === 'unmount' || name === 'emit') {
        throw this.positionedError(stmt,
          `emitter: component member '${name}' collides with the component runtime API — 'mount', 'unmount', ` +
          "and 'emit' are __Component's own methods, and the machinery calls them on every instance (a " +
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
        declare(stmt[1], 'accept', stmt, true);
        acceptedVars.push(stmt[1]);
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
          if (Emitter.containsAwait(stmt[2]) || Emitter.containsYield(stmt[2])) {
            throw this.positionedError(stmt, "emitter: a component state initializer cannot await or yield — _init runs synchronously during construction", node);
          }
          declare(t.name, 'state', stmt, true);
          stateVars.push({ name: t.name, value: stmt[2], isPublic: t.isPublic, required: false, node: stmt });
        } else {
          if (Emitter.containsAwait(stmt[2])) {
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
        declare(t.name, 'plain', stmt, false);
        plainVars.push({ name: t.name, value: stmt[2], isPublic: t.isPublic, node: stmt });
        return;
      }
      // Colon-method groups (`save: (e) -> …` lines wrap into one
      // implicit object statement).
      if (isObject(stmt)) {
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
        'emitter: offer takes a member DECLARATION — `offer theme := v`, `offer limit =! v`, `offer total ~= e`, ' +
        '`offer save = (e) ->` — anything else has no context key to publish', node);
    };

    for (const stmt of stmts) {
      if (this.isOfferNode(stmt)) {
        const payload = stmt[1];
        const declKinds = this.isReactiveDecl(payload) || this.isReadonlyDecl(payload) ||
          (isNode(payload) && (payload[0] === '=' || payload[0] === 'void-assign') && payload.length === 3 && Emitter.memberTarget(payload[1]) !== null);
        if (!declKinds) rejectOffer(stmt);
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
    if (extendsTag !== null) {
      if (seen.has('rest')) {
        throw this.positionedError(seen.get('rest'),
          "emitter: a component that extends a tag cannot declare a member named 'rest' — `@rest` is the reactive " +
          'view of the undeclared caller props (the rest-forwarding seam)', node);
      }
      members.set('rest', 'rest');
      memberReactive.add('rest');
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
    const tsInfo = this.ts ? componentTypeInfo(this.stores, this.b.source, node) : null;
    if (tsInfo !== null) this.componentInfo.set(node, tsInfo);
    const frame = { members, memberReactive, name: this._componentName, extendsTag };
    const ind = this.ind;
    const pad = '  '.repeat(ind + 1);
    const ipad = pad + '  ';
    this.cframes.push(frame);
    this.rframes.push({ reactive: new Set(), bound: new Set(), members, memberReactive });
    const prevMethod = this.methodName;
    this.methodName = null;

    // _init hoists inner assignment targets of member initializers at
    // its own top (each is a real function scope).
    const initValues = [...readonlyVars, ...plainVars, ...stateVars, ...derivedVars]
      .map((m) => m.value)
      .filter((v) => v !== undefined && !(isBlock(v) && v.length > 2));
    const { entries: initHoist, names: initNames } = this.scopedHoist(initValues, []);

    this.mark(node, '$self', () => {
      this.b.emit('class');
      // Generic component: the declaration's
      // TYPE_PARAMS side-band role (threaded by assign(), the
      // _componentName pattern) emits on the lowered class — a
      // TS-only region on the class expression (`class<TOption
      // extends TOptionShape> extends __Component`), erased from JS.
      if (this.ts && this._componentTypeParams) {
        const tp = this._componentTypeParams;
        this.b.tsOnly(() => this.b.emit(tp));
      }
      this.b.emit(' extends __Component {\n');
      if (tsInfo !== null) this.tsComponentMemberDeclares(tsInfo, pad);
      if (declaredProps.length > 0) {
        this.b.emit(`${pad}static __props = [${declaredProps.map((n) => `'${n}'`).join(', ')}];\n`);
      }
      if (extendsTag !== null) {
        // The runtime's rest seam reads this: undeclared constructor
        // props collect into the reactive `rest` view and forward
        // onto the inherited element (the rest machinery lives on
        // __Component).
        this.b.emit(`${pad}static __extends = '${extendsTag}';\n`);
      }
      if (tsInfo !== null) this.tsComponentCtor(tsInfo, pad);
      this.b.emit(`${pad}_init(props`);
      if (tsInfo !== null) this.b.tsOnly(() => this.b.emit(`: ${propsTypeText(tsInfo)}`));
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
        this.b.emit('this.');
        this.mark(stmt, role, () => this.b.emit(name));
      };
      const readonlySet = new Set(readonlyVars);
      for (const m of [...readonlyVars, ...plainVars]) {
        initLine(m.node, () => {
          // A readonly (`=!`) member declares `readonly` on the class,
          // and TS allows readonly writes only in the CONSTRUCTOR —
          // _init is the lowering's seam, so its one legitimate write
          // quiets through a TS-only cast (strip restores `this.x`).
          if (readonlySet.has(m) && this.ts) {
            this.b.tsOnly(() => this.b.emit('('));
            this.b.emit('this');
            this.b.tsOnly(() => this.b.emit(' as any)'));
            this.b.emit('.');
            this.mark(m.node, 'target', () => this.b.emit(m.name));
          } else {
            memberName(m.node, m.name);
          }
          this.b.emit(' = ');
          if (m.isPublic) this.b.emit(`props.${m.name} ?? `);
          // A member-held component declaration takes the MEMBER's
          // name (its data-part and placeholder identity), so the
          // nested declaration inherits the ENCLOSING component's
          // name (graduated here).
          const prevCN = this._componentName;
          if (this.isComponentDecl(m.value)) this._componentName = m.name;
          memberValue(m.node, m.value);
          this._componentName = prevCN;
        });
      }
      for (const name of acceptedVars) {
        const stmt = seen.get(name);
        initLine(stmt, () => {
          memberName(stmt, name, 'name');
          this.b.emit(` = getContext('${name}')`);
        });
      }
      for (const m of stateVars) {
        initLine(m.node, () => {
          memberName(m.node, m.name, m.value === undefined ? 'property' : 'target');
          this.b.emit(' = __state(');
          if (m.isPublic && (m.required || m.value === undefined)) {
            this.b.emit(`props.__bind_${m.name}__ ?? props.${m.name}`);
          } else if (m.isPublic) {
            this.b.emit(`props.__bind_${m.name}__ ?? props.${m.name} ?? `);
            memberValue(m.node, m.value);
          } else {
            memberValue(m.node, m.value);
          }
          this.b.emit(')');
        });
      }
      for (const m of derivedVars) {
        initLine(m.node, () => {
          memberName(m.node, m.name);
          this.b.emit(' = __computed(() => ');
          this.mark(m.node, 'value', () => this.withExpression(() => this.computedBody(m.node, m.value, ind + 2)));
          this.b.emit(')');
        });
      }
      for (const name of offeredVars) {
        initLine(seen.get(name), () => this.b.emit(`setContext('${name}', this.${name})`));
      }
      // Component-body effects register on the instance's owner frame
      // (the runtime pushes it around _init — the runtime seam). The
      // emission mirrors the COMPONENT shape exactly: an expression
      // body RETURNS its value (`{ return expr; }` — the cleanup
      // channel is live in one-liner component effects, the handle rule's
      // load-bearing idiom), where the module-level form deliberately
      // returns nothing — the asymmetry is pinned on both
      // sides.
      for (const eff of effects) {
        const bodyNode = eff[2];
        const isAsync = Emitter.containsAwait(bodyNode);
        this.b.emit(ipad);
        this.mark(eff, '$self', () => {
          this.mark(eff, 'operator', () => this.b.emit('__effect'));
          this.b.emit(isAsync ? '(async () => ' : '(() => ');
          if (isBlock(bodyNode) && bodyNode.length > 2) {
            this.mark(eff, 'value', () => this.withExpression(() => {
              const bodyStmts = this.liveStmts(bodyNode.slice(1), { forwards: true });
              const { entries, names } = this.scopedHoist(bodyStmts, []);
              for (const n of this.pushReactiveFrame(bodyStmts, names)) names.add(n);
              this.scopes.push(names);
              this.funcBlock(eff, bodyNode, bodyStmts, ind + 2, entries);
              this.scopes.pop();
              this.rframes.pop();
            }));
          } else {
            const single = isBlock(bodyNode) ? bodyNode[1] : bodyNode;
            this.b.emit('{ return ');
            this.mark(eff, 'value', () => this.withExpression(() => {
              const wrap = Emitter.needsGrouping(single, 'operand') || isObject(single);
              if (wrap) this.b.emit('(');
              this.expr(single);
              if (wrap) this.b.emit(')');
            }));
            this.b.emit('; }');
          }
          this.b.emit(')');
        });
        this.b.emit(';\n');
      }
      this.rframes.pop();
      this.scopes.pop();
      this.b.emit(`${pad}}\n`);

      // Methods, then lifecycle hooks.
      const emitCallable = ({ name, func, isVoid, node: owner }) => {
        const [, params, block] = func;
        this.b.emit(pad);
        this.mark(owner, '$self', () => {
          if (Emitter.containsAwait(block)) this.b.emit('async ');
          if (Emitter.containsYield(block)) this.b.emit('*');
          this.mark(owner, 'target', () => this.mark(owner, 'key', () => this.b.emit(name)));
          this.b.emit('(');
          this.emitParams(params);
          this.b.emit(')');
          this.tsReturnAnnotation(func, Emitter.containsAwait(block), isVoid, owner);
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

      this.b.emit('  '.repeat(ind) + '}');
    });

    this.methodName = prevMethod;
    this.rframes.pop();
    this.cframes.pop();
    this.ind = ind;
  }

  // ── The render DSL (dynamic) ───────────────────
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
  // mapping rows land at real generated offsets. Composition (child
  // components, slots ) rejects loudly, positioned; nothing in
  // a render body is silently dropped.

  renderBody(renderNode, ind, frame) {
    const pad = '  '.repeat(ind + 1);
    const ipad = pad + '  ';
    const prev = this.rstate;
    const classRecord = {
      kind: 'class', name: null, parent: null, self: null,
      creates: [], setups: [], vars: null,
      locals: new Set(), localDecls: new Map(), bindings: new Set(),
      refs: [], loopStack: [], stmts: [],
      forceNonStatic: false, root: null, params: null, originNode: renderNode,
    };
    this.rstate = {
      elCount: 0, textCount: 0, blockCount: 0, svgDepth: 0,
      fragChildren: new Map(), tags: new Map(),
      pendingClassArgs: null, pendingClassEl: null,
      pad: ipad, frame, node: renderNode,
      records: [], sink: classRecord, classRecord,
      transitionSlot: null, suppressedPairs: new Set(),
      slotSeen: false,
    };
    // ── Phase 1: the walk (collection only — no emission) ──
    const body = renderNode[1];
    const stmts = isBlock(body) ? body.slice(1) : [body];
    classRecord.stmts = stmts;
    this.rframes.push({ reactive: new Set(), bound: classRecord.bindings });
    let rootVar;
    try {
      rootVar = this.walkRenderRoot(stmts, classRecord);
    } finally {
      this.rframes.pop();
    }
    this.closeRenderScope(classRecord);
    // ── Phase 2: replay through the builder ──
    this.b.emit(`${pad}_create() {\n`);
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
      this.b.emit(`${pad}_setup() {\n`);
      this.withRecordContext(classRecord, () => this.replaySetups(classRecord, ipad));
      this.b.emit(`${pad}}\n`);
    }
    for (const rec of this.rstate.records) this.emitFactory(rec, ind, renderNode);
    this.rstate = prev;
  }

  // The render-root walk: the renderable counting — binding
  // statements (render locals) emit as JS lines and contribute no DOM
  // child, so a lone element beside bindings still returns itself and
  // an all-bindings body returns a comment placeholder.
  walkRenderRoot(stmts, record) {
    if (stmts.length === 0 || (stmts.length === 1 && stmts[0] === 'null')) {
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
      const c = this.newRenderVar('empty');
      this.renderLine(null, () => this.b.emit(`${c} = document.createComment('')`));
      return c;
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
    this.renderSelf = rec.self;
    this.rframes.push({ reactive: new Set(), bound: rec.bindings });
    try {
      fn();
    } finally {
      this.rframes.pop();
      this.renderSelf = prevSelf;
    }
  }

  // Directives inside RENDER bodies: a
  // `# @ts-expect-error` above a template line attaches to the render
  // statement node like any other; its generated manifestations are
  // the node's replay lines, so the directive emits above the FIRST
  // line replayed for that node (create or setup effect — whichever
  // comes first consumes it). The always-place doctrine applies: an
  // error landing on a later line of the same lowering stays visible
  // as TS2578 rather than silently dropping the author's marker.
  renderDirectives(node, pad) {
    if (!this.ts || !this.tsDirectivesArmed || node == null || !isNode(node)) return;
    const attached = this.tsDirectiveMap.get(node);
    if (attached === undefined) return;
    this.tsDirectiveMap.delete(node);
    for (const d of attached) this.tsDirectiveLine(d, pad, true);
  }

  replayCreates(rec, pad) {
    for (const { node, fn, semi } of rec.creates) {
      this.renderDirectives(node, pad);
      this.b.emit(pad);
      if (node != null) this.mark(node, '$self', fn);
      else fn();
      this.b.emit(semi ? ';\n' : '\n');
    }
  }

  replaySetups(rec, pad) {
    for (const s of rec.setups) {
      if (s.kind === 'effect') {
        this.renderDirectives(s.node, pad);
        this.b.emit(pad);
        const emitIt = () => {
          this.b.emit('__effect(() => { ');
          s.fn();
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

  newRenderVar(hint = 'el') {
    const n = this.rstate.elCount++;
    const rec = this.rstate.sink;
    if (rec.kind === 'class') return `this._${hint}${n}`;
    const name = `_${hint}${n}`;
    rec.vars.add(name);
    return name;
  }

  newRenderText() {
    const n = this.rstate.textCount++;
    const rec = this.rstate.sink;
    if (rec.kind === 'class') return `this._t${n}`;
    const name = `_t${n}`;
    rec.vars.add(name);
    return name;
  }

  newBlockName() {
    // Block factories are class methods — a member spelling the next
    // name would collide, so numbering skips it (compiler-owned names;
    // the member model never minted them).
    let name;
    do {
      name = `create_block_${this.rstate.blockCount++}`;
    } while (this.rstate.frame.members.has(name));
    return name;
  }

  // Queue a `__effect(() => { … });` line for the active record's
  // setup phase (_setup in class scope, p() in a factory). `checkExpr`
  // is the effect's source expression when one exists: a CLASS-scope
  // effect lives in _setup while render locals live in _create — a
  // read across that boundary is a mount-time ReferenceError
  // so it rejects here (factory scopes share one closure; no check).
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
    if (referencesNames(expr, rec.locals)) {
      throw this.positionedError(node ?? expr,
        'emitter: a render local cannot appear in a LIVE binding or a dynamic block head at the render top level — ' +
        'locals live in _create() and reactive machinery lives in _setup() (a compiled read here would be a ' +
        'mount-time ReferenceError); bind the value to a member instead', isNode(expr) ? expr : this.rstate.node);
    }
  }

  // A value expression inside a render line — operand grouping, the
  // component member rewrites live on the normal expr path.
  renderExpr(value) {
    this.withExpression(() => {
      const wrap = Emitter.needsGrouping(value, 'operand');
      if (wrap) this.b.emit('(');
      this.expr(value);
      if (wrap) this.b.emit(')');
    });
  }

  // How does a bare name read inside the CURRENT render scope —
  // 'local' (a render local of this scope), 'loop'/'loop-reactive' (a
  // loop item/index variable, live when its collection is reactive)?
  // Returns null for everything else. A name that is NOT in this
  // scope but IS a render local of an ENCLOSING render scope REJECTS
  // when `node` is given: locals never cross a factory boundary (each
  // factory is its own JS function
  // element or ships a ReferenceError).
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
        if (r.locals.has(name)) {
          throw this.positionedError(node,
            `emitter: render local '${name}' is not visible here — each dynamic block (a conditional branch, a loop body) ` +
            'is its own factory function, and render locals never cross that boundary; declare the local inside this block, or use a member',
            this.rstate.node);
        }
      }
    }
    return null;
  }

  // Does a render expression read anything reactive — a component
  // member, a module-level `:=`/`~=` name, a deeper this-rooted chain
  // (signal-backed getters), a component-method call, or a loop
  // item/index variable over a reactive collection? the rule plus
  // the deliberate widenings: module-level reactive names bind LIVE
  // here (a one-time read would go silently stale), and index
  // variables patch live (staying correct across keyed reorders). Over-wrapping a static chain in
  // __effect runs it once, harmless.
  renderReactive(sexpr) {
    if (typeof sexpr === 'string') {
      const kind = this.renderVarKind(sexpr);
      if (kind !== null) return kind === 'loop-reactive';
      const r = this.resolveBareRead(sexpr);
      return r === 'reactive' || r === 'member-reactive';
    }
    if (!isNode(sexpr)) return false;
    if (sexpr[0] === '.' && sexpr[1] === 'this' && sexpr.length === 3 && typeof sexpr[2] === 'string') {
      return this.memberIsReactive(sexpr[2]);
    }
    const rootsAtThis = (n) => {
      while (isNode(n) && (n[0] === '.' || n[0] === '[]') && n.length === 3) n = n[1];
      return n === 'this';
    };
    const rootsAtLoopReactive = (n) => {
      while (isNode(n) && (n[0] === '.' || n[0] === '[]' || n[0] === '?.' || n[0] === 'optindex') && n.length === 3) n = n[1];
      return typeof n === 'string' && this.renderVarKind(n) === 'loop-reactive';
    };
    if (sexpr[0] === '.' && sexpr.length === 3 && rootsAtThis(sexpr[1])) return true;
    if ((sexpr[0] === '.' || sexpr[0] === '[]') && sexpr.length === 3 && rootsAtLoopReactive(sexpr)) return true;
    if (isNode(sexpr[0]) && sexpr[0][0] === '.' && sexpr[0][1] === 'this' && typeof sexpr[0][2] === 'string' &&
        this.cframes.length > 0 && this.cframes[this.cframes.length - 1].members.has(sexpr[0][2])) {
      return true;
    }
    return sexpr.some((c) => this.renderReactive(c));
  }

  isRenderBinding(stmt) {
    return isNode(stmt) && RENDER_BINDING_HEADS.has(stmt[0]) && stmt.length === 3 &&
      typeof stmt[1] === 'string' && RENDER_LOCAL_RE.test(stmt[1]);
  }

  // The main render-tree dispatch. Returns the created node's var
  // name, or null for a statement with no DOM child (a render local).
  renderNode(sexpr) {
    // Render-scope locals: `x = expr` declares, compound forms mutate.
    if (this.isRenderBinding(sexpr)) return this.renderBinding(sexpr);
    // Any OTHER assignment shape at a child position has no render
    // reading (a member write belongs in a handler
    // assignment's value as text or emits a bare write that dies).
    if (isNode(sexpr) && (ASSIGNS.has(sexpr[0]) || sexpr[0] === '//=' || sexpr[0] === '%%=') && sexpr.length === 3) {
      throw this.positionedError(sexpr,
        'emitter: an assignment at a render child position must declare a render local (`name = expr` / compound forms ' +
        'on a plain name) — member and chain writes have no render reading here; put the write in a handler or method');
    }
    if (typeof sexpr === 'string') {
      // Quoted → static text.
      if (sexpr.startsWith('"') || sexpr.startsWith("'") || sexpr.startsWith('`')) {
        const t = this.newRenderText();
        this.renderLine(null, () => this.b.emit(`${t} = document.createTextNode(${sexpr})`));
        return t;
      }
      // Render locals and loop variables shadow tags and members —
      // an own-line read renders as text (the String() wrap); loop
      // vars over a reactive collection bind LIVE (the #143 widening).
      const kind = this.renderVarKind(sexpr, sexpr);
      if (kind !== null) {
        const t = this.newRenderText();
        if (kind === 'loop-reactive') {
          this.renderLine(null, () => this.b.emit(`${t} = document.createTextNode('')`));
          this.renderEffect(null, () => this.b.emit(`${t}.data = ${sexpr};`));
        } else {
          this.renderLine(null, () => this.b.emit(`${t} = document.createTextNode(String(${sexpr}))`));
        }
        return t;
      }
      const r = this.resolveBareRead(sexpr);
      // A reactive read → live text binding.
      if (r === 'reactive' || r === 'member-reactive') {
        const t = this.newRenderText();
        this.renderLine(null, () => this.b.emit(`${t} = document.createTextNode('')`));
        this.renderEffect(null, () => {
          this.b.emit(`${t}.data = `);
          this.expr(sexpr);
          this.b.emit(';');
        });
        return t;
      }
      if (sexpr === 'slot') {
        return this.renderSlot(sexpr, []);
      }
      if (isComponentName(sexpr)) {
        return this.renderChildComponent(sexpr, sexpr, []);
      }
      // A non-reactive member → one-time text.
      if (r === 'member') {
        const t = this.newRenderText();
        this.renderLine(null, () => {
          this.b.emit(`${t} = document.createTextNode(String(`);
          this.expr(sexpr);
          this.b.emit('))');
        });
        return t;
      }
      // Anything else is a TAG (custom elements included);
      // `tag#id` splits.
      const [tagStr, idStr] = sexpr.split('#');
      return this.renderTag(sexpr, tagStr || 'div', [], [], idStr);
    }
    if (!isNode(sexpr)) {
      throw this.positionedError(sexpr, 'emitter: unsupported render child');
    }

    const head = sexpr[0];
    const headStr = typeof head === 'string' ? head : null;

    // Dynamic constructs: conditionals and for-in loops
    // compile to block factories; the loop shapes with no reconcile
    // reading reject loudly, named.
    if (headStr === 'if' && sexpr.length >= 3) {
      return this.renderCond(sexpr);
    }
    if (headStr === 'switch' && sexpr.length === 4) {
      return this.renderSwitch(sexpr);
    }
    if (headStr === 'for-in' && sexpr.length === 6) {
      return this.renderLoop(sexpr);
    }
    if (headStr === 'for-of' && sexpr.length === 6) {
      throw this.positionedError(sexpr,
        'emitter: `for … of` (object iteration) has no reconcile reading inside render — ' +
        '__reconcile expects an array and crashes at mount; iterate entries instead: ' +
        '`for pair in Object.entries(obj)`');
    }
    if (headStr === 'for-as' && sexpr.length === 6) {
      throw this.positionedError(sexpr,
        'emitter: an async loop has no render reading — reconciliation is synchronous; collect the items into a state ' +
        'member and loop over it');
    }
    if (headStr === 'comprehension' || headStr === 'while' || headStr === 'loop') {
      throw this.positionedError(sexpr,
        'emitter: only `for … in` drives list rendering — while/loop/comprehensions have no reconcile reading inside ' +
        'render');
    }
    if (this.isEffectDecl(sexpr) || this.isReactiveDecl(sexpr) || this.isReadonlyDecl(sexpr)) {
      throw this.positionedError(sexpr,
        'emitter: declarations and effects have no render-body reading — declare members in the component body, above render');
    }
    if (headStr === 'slot') {
      return this.renderSlot(sexpr, sexpr.slice(1));
    }
    if (headStr !== null && isComponentName(headStr)) {
      return this.renderChildComponent(sexpr, headStr, sexpr.slice(1));
    }

    // Bare `@prop` as a child: never implicit text.
    if (headStr === '.' && sexpr[1] === 'this' && typeof sexpr[2] === 'string') {
      throw this.positionedError(sexpr,
        `emitter: bare \`@${sexpr[2]}\` is not rendered as text — use \`= @${sexpr[2]}\` to render it`);
    }

    // Tag with classes: `div.card` / `.card` chains. A render local
    // or loop variable shadows the tag reading (`code.value` after
    // `code = obj` reads the local).
    if (headStr === '.') {
      const { tag, classes, id } = Emitter.collectTemplateClasses(sexpr);
      if (tag !== null && isHtmlTag(tag) && this.renderVarKind(tag) === null) {
        return this.renderTag(sexpr, tag, classes, [], id);
      }
      // General member chain → text (static or live).
      return this.renderTextExpr(sexpr);
    }

    // Synthetic `= expr` text. The form takes exactly ONE expression:
    // an indented continuation under the `=` line re-reads as render
    // syntax (a leading `.` is a new element there) and lands here as
    // EXTRA call arguments
    // #145); rejecting is the only honest reading.
    if (headStr === '__text__') {
      if (sexpr.length > 2) {
        throw this.positionedError(sexpr,
          'emitter: the `= expr` text form takes ONE expression — an indented continuation under the `=` line has no ' +
          'render reading (inside render a leading `.` starts a NEW element, so the continuation cannot be a method ' +
          'chain; put the whole expression on the `=` line, or bind it in a method)', this.rstate.node);
      }
      return this.renderTextExpr(sexpr[1] ?? 'undefined', sexpr, true);
    }

    // Call shapes: tag heads with args/children. A render local wins
    // over the tag reading (`code "hi"` after `code = fn` is a call —
    // rendered as text below; locals are plain identifiers, so a
    // `#id`-carrying head can never be one).
    if (headStr !== null && isHtmlTag(headStr.split('#')[0]) && sexpr.length >= 1 &&
        this.renderVarKind(headStr) === null) {
      const [tagName, id] = headStr.split('#');
      return this.renderTag(sexpr, tagName || 'div', [], sexpr.slice(1), id);
    }
    if (isNode(head)) {
      // `tag.__clsx(...)` call with children: dynamic classes.
      if (isNode(head[0]) && head[0][0] === '.' && head[0][2] === '__clsx') {
        const tagExpr = head[0][1];
        const classExprs = head.slice(1);
        if (isNode(tagExpr)) {
          const { tag, classes, id } = Emitter.collectTemplateClasses(tagExpr);
          if (tag !== null && isHtmlTag(tag)) {
            return this.renderDynamicTag(sexpr, tag, classExprs, sexpr.slice(1), classes, id);
          }
        } else if (typeof tagExpr === 'string' && isHtmlTag(tagExpr.split('#')[0])) {
          const [tagName, id] = tagExpr.split('#');
          return this.renderDynamicTag(sexpr, tagName || 'div', classExprs, sexpr.slice(1), [], id);
        }
      }
      const { tag, classes, id } = Emitter.collectTemplateClasses(head);
      if (tag !== null && isHtmlTag(tag) && this.renderVarKind(tag) === null) {
        if (classes.length > 0 && classes[classes.length - 1] === '__clsx') {
          return this.renderDynamicTag(sexpr, tag, sexpr.slice(1), [], classes.slice(0, -1), id);
        }
        return this.renderTag(sexpr, tag, classes, sexpr.slice(1), id);
      }
    }
    if (headStr === '->' || headStr === '=>') {
      return this.renderChildBlock(sexpr[2]);
    }
    // General expression → text (static or live).
    return this.renderTextExpr(sexpr);
  }

  // Text from an expression: a live binding when anything reactive is
  // read, a one-time String() otherwise. `stringify` (the `= expr`
  // path) matches the String() wrap in the effect.
  renderTextExpr(expr, owner = null, stringify = false) {
    const t = this.newRenderText();
    const node = owner ?? (isNode(expr) ? expr : null);
    this.checkCrossScopeLocals(expr, node ?? this.rstate.node);
    // The `= expr` path marks the __text__ call's spread-args role
    // around the expression — its span IS the expression, so a bare
    // member/reactive read re-marks an EXACT row inside the effect.
    const exprMark = (fn) => {
      if (stringify && owner !== null) this.mark(owner, 'args', fn);
      else fn();
    };
    if (this.renderReactive(expr)) {
      this.renderLine(node, () => this.b.emit(`${t} = document.createTextNode('')`));
      this.renderEffect(node, () => {
        this.b.emit(`${t}.data = `);
        if (stringify) {
          this.b.emit('String(');
          exprMark(() => this.renderExpr(expr));
          this.b.emit(')');
        } else {
          this.renderExpr(expr);
        }
        this.b.emit(';');
      }, expr);
    } else {
      this.renderLine(node, () => {
        this.b.emit(`${t} = document.createTextNode(String(`);
        exprMark(() => this.withExpression(() => this.expr(expr)));
        this.b.emit('))');
      });
    }
    return t;
  }

  // Under `extends <tag>`, the FIRST class-scope element of the
  // extended tag is the rest-forwarding target (the fixed
  // _bindInheritedTarget: class scope only, first match wins;
  // factories never bind it).
  bindInheritedTarget(node, tag, el) {
    const R = this.rstate;
    if (R.frame.extendsTag !== tag || R.sink.kind !== 'class' || R.frame.inheritedBound === true) return;
    R.frame.inheritedBound = true;
    this.renderLine(node, () => this.b.emit(`this._inheritedEl = ${el}`));
    this.renderLine(node, () => this.b.emit('this._applyRestToInheritedEl()'));
  }

  // A static element: create, id, data-part (the component's first
  // element), children/attributes, classes.
  renderTag(node, tag, classes, args, id) {
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
    const isSvg = SVG_TAGS.has(tag) || R.svgDepth > 0;
    this.renderLine(node, () => {
      this.b.emit(isSvg
        ? `${el} = document.createElementNS('${Emitter.SVG_NS}', '${tag}')`
        : `${el} = document.createElement('${tag}')`);
    });
    if (id) this.renderLine(node, () => this.b.emit(`${el}.id = '${id}'`));
    this.bindInheritedTarget(node, tag, el);
    if (R.frame.name !== null && R.elCount === 1 && R.sink.kind === 'class') {
      this.renderLine(node, () => this.b.emit(`${el}.setAttribute('data-part', '${R.frame.name}')`));
    }
    const prevArgs = R.pendingClassArgs;
    const prevEl = R.pendingClassEl;
    if (classes.length > 0) {
      R.pendingClassArgs = [`'${classes.join(' ')}'`];
      R.pendingClassEl = el;
    }
    if (tag === 'svg') R.svgDepth++;
    this.renderChildren(el, args);
    if (tag === 'svg') R.svgDepth--;
    if (classes.length > 0) {
      if (R.pendingClassArgs.length === 1) {
        this.renderLine(node, () => this.b.emit(isSvg
          ? `${el}.setAttribute('class', '${classes.join(' ')}')`
          : `${el}.className = '${classes.join(' ')}'`));
      } else {
        const merged = R.pendingClassArgs.slice(1);
        this.renderEffect(node, () => {
          this.b.emit(isSvg ? `${el}.setAttribute('class', __clsx('${classes.join(' ')}', ` : `${el}.className = __clsx('${classes.join(' ')}', `);
          merged.forEach((fn, i) => {
            if (i > 0) this.b.emit(', ');
            fn();
          });
          this.b.emit(isSvg ? '));' : ');');
        });
      }
      R.pendingClassArgs = prevArgs;
      R.pendingClassEl = prevEl;
    }
    return el;
  }

  // A `.( … )` dynamic-class element: className binds through ONE
  // __clsx effect merging selector classes, the call's expressions,
  // and any `class:` attribute values.
  renderDynamicTag(node, tag, classExprs, children, staticClasses, id) {
    const R = this.rstate;
    const el = this.newRenderVar();
    R.tags.set(el, tag);
    if (R.transitionSlot !== null && R.transitionSlot.record === R.sink && R.transitionSlot.el === null) {
      R.transitionSlot.el = el;
    }
    const isSvg = SVG_TAGS.has(tag) || R.svgDepth > 0;
    this.renderLine(node, () => {
      this.b.emit(isSvg
        ? `${el} = document.createElementNS('${Emitter.SVG_NS}', '${tag}')`
        : `${el} = document.createElement('${tag}')`);
    });
    if (id) this.renderLine(node, () => this.b.emit(`${el}.id = '${id}'`));
    this.bindInheritedTarget(node, tag, el);
    if (R.frame.name !== null && R.elCount === 1 && R.sink.kind === 'class') {
      this.renderLine(node, () => this.b.emit(`${el}.setAttribute('data-part', '${R.frame.name}')`));
    }
    for (const expr of classExprs) this.checkCrossScopeLocals(expr, node);
    const prevArgs = R.pendingClassArgs;
    const prevEl = R.pendingClassEl;
    R.pendingClassArgs = [
      ...staticClasses.map((c) => `'${c}'`),
      ...classExprs.map((e) => () => this.renderExpr(e)),
    ];
    R.pendingClassEl = el;
    if (tag === 'svg') R.svgDepth++;
    this.renderChildren(el, children);
    if (tag === 'svg') R.svgDepth--;
    const parts = R.pendingClassArgs;
    if (parts.length > 0) {
      this.renderEffect(node, () => {
        this.b.emit(isSvg ? `${el}.setAttribute('class', __clsx(` : `${el}.className = __clsx(`);
        parts.forEach((p, i) => {
          if (i > 0) this.b.emit(', ');
          if (typeof p === 'string') this.b.emit(p);
          else p();
        });
        this.b.emit(isSvg ? '));' : ');');
      });
    }
    R.pendingClassArgs = prevArgs;
    R.pendingClassEl = prevEl;
    return el;
  }

  // A block of template children (the injected `-> INDENT …` body, a
  // conditional branch, a loop body). Non-blocks render as one child;
  // a postfix conditional's plain [statement] wrapper unwraps.
  renderChildBlock(body) {
    if (!isBlock(body)) {
      const v = this.renderNode(body);
      if (v != null) return v;
      const c = this.newRenderVar('empty');
      this.renderLine(null, () => this.b.emit(`${c} = document.createComment('')`));
      return c;
    }
    const stmts = body.slice(1);
    if (stmts.length === 0) {
      const c = this.newRenderVar('empty');
      this.renderLine(null, () => this.b.emit(`${c} = document.createComment('')`));
      return c;
    }
    return this.walkChildStmts(stmts);
  }

  // The shared child/attribute walk for element argument lists.
  renderChildren(el, args) {
    for (const arg of args) {
      if (isFunc(arg)) {
        // A PARAMETERIZED function has no render-child reading — the
        // injected children arrows are always bare `->`; a user-spelled
        // `(v) -> …` here is usually a chain continuation re-read as
        // render syntax — nonsense DOM if accepted
        if (isNode(arg[1]) && arg[1].length > 0) {
          throw this.positionedError(arg,
            'emitter: a parameterized function is not a render child — element children arrows carry no parameters ' +
            '(an indented `.method (v) -> …` continuation re-reads as a NEW element inside render; put the chain on one ' +
            'line or bind it in a method)', this.rstate.node);
        }
        const block = arg[2];
        if (isBlock(block)) {
          for (const child of block.slice(1)) {
            if (isObject(child)) {
              this.renderAttributes(el, child);
            } else {
              const v = this.renderNode(child);
              if (v == null) continue;
              this.renderLine(null, () => this.b.emit(`${el}.appendChild(${v})`));
            }
          }
        } else if (block) {
          const v = this.renderNode(block);
          if (v != null) this.renderLine(null, () => this.b.emit(`${el}.appendChild(${v})`));
        }
        continue;
      }
      if (isObject(arg)) {
        this.renderAttributes(el, arg);
        continue;
      }
      if (typeof arg === 'string') {
        const base = arg.split(/[#.]/)[0];
        // Render locals and loop variables shadow the tag reading and
        // the flag shorthand — an in-scope value renders as text (loop
        // vars over a reactive collection bind live).
        const scopeKind = base === arg ? this.renderVarKind(arg, arg) : null;
        if (scopeKind !== null) {
          const t = this.newRenderText();
          if (scopeKind === 'loop-reactive') {
            this.renderLine(null, () => this.b.emit(`${t} = document.createTextNode('')`));
            this.renderEffect(null, () => this.b.emit(`${t}.data = ${arg};`));
          } else {
            this.renderLine(null, () => this.b.emit(`${t} = document.createTextNode(${arg})`));
          }
          this.renderLine(null, () => this.b.emit(`${el}.appendChild(${t})`));
          continue;
        }
        if (isHtmlTag(base || 'div')) {
          const v = this.renderNode(arg);
          this.renderLine(null, () => this.b.emit(`${el}.appendChild(${v})`));
          continue;
        }
        if (isComponentName(base) && base === arg) {
          const v = this.renderChildComponent(arg, arg, []);
          this.renderLine(null, () => this.b.emit(`${el}.appendChild(${v})`));
          continue;
        }
        if (/^[A-Za-z_$][\w$]*$/.test(arg) && this.resolveBareRead(arg) === null && !this.inScope(arg)) {
          // Bare identifier resolving to NOTHING in scope: boolean-
          // attribute shorthand — validated against the spec-derived
          // known-attribute vocabulary (the known-vocabulary fork: a
          // misspelling must never silently become markup).
          const tag = this.renderTagOf(el);
          if (!knownBareAttribute(tag, arg)) {
            throw this.positionedError(arg,
              `emitter: '${arg}' is not a known attribute of <${tag}> — bare-identifier shorthand sets a boolean ` +
              `attribute and validates against the standard vocabulary ` +
              '(a misspelling would silently set a boolean attribute); quote it, or spell `name: value`', this.rstate.node);
          }
          this.renderLine(null, () => {
            this.b.emit(`${el}.setAttribute('${arg}', true`);
            if (this.ts) this.b.tsOnly(() => this.b.emit(' as any'));
            this.b.emit(')');
          });
          continue;
        }
        const t = this.newRenderText();
        if (arg.startsWith('"') || arg.startsWith("'") || arg.startsWith('`')) {
          this.renderLine(null, () => this.b.emit(`${t} = document.createTextNode(${arg})`));
        } else {
          const r = this.resolveBareRead(arg);
          if (r === 'reactive' || r === 'member-reactive') {
            this.renderLine(null, () => this.b.emit(`${t} = document.createTextNode('')`));
            this.renderEffect(null, () => {
              this.b.emit(`${t}.data = `);
              this.expr(arg);
              this.b.emit(';');
            });
          } else if (r === 'member') {
            this.renderLine(null, () => {
              this.b.emit(`${t} = document.createTextNode(String(`);
              this.expr(arg);
              this.b.emit('))');
            });
          } else {
            this.renderLine(null, () => {
              this.b.emit(`${t} = document.createTextNode(`);
              this.expr(arg);
              this.b.emit(')');
            });
          }
        }
        this.renderLine(null, () => this.b.emit(`${el}.appendChild(${t})`));
        continue;
      }
      if (arg != null) {
        const v = this.renderNode(arg);
        this.renderLine(null, () => this.b.emit(`${el}.appendChild(${v})`));
      }
    }
  }

  // The element's tag name, recovered for the #125 vocabulary check
  // (var names are allocation-ordered; the frame records tags).
  renderTagOf(el) {
    return this.rstate.tags?.get(el) ?? 'div';
  }

  // `slot` — children projection: the parent's emission passed its
  // built child DOM as the `children` prop; the slot line materializes
  // it (a fixed ternary — a Node projects, a plain value renders as
  // text, absence leaves a comment). `children` is ONE node, so the
  // projection point is structurally single: a second slot, a slot
  // inside a loop row, and slot arguments all reject loudly (a
  // silent move to the last projection point would drop
  // slot arguments).
  renderSlot(node, args) {
    const R = this.rstate;
    const markNode = isNode(node) ? node : null;
    if (args.length > 0) {
      throw this.positionedError(markNode ?? node,
        'emitter: `slot` takes no arguments — fallback content has no ' +
        'reading here (render it through a conditional around the slot)', this.rstate.node);
    }
    if (R.sink.loopStack.length > 0) {
      throw this.positionedError(markNode ?? node,
        'emitter: `slot` inside a loop row has no working reading — `children` is ONE node, and every row would fight ' +
        'over it; ' +
        'project it once, outside the loop', this.rstate.node);
    }
    if (R.slotSeen) {
      throw this.positionedError(markNode ?? node,
        'emitter: a second `slot` in one render — `children` is ONE node, and a second projection point MOVES it ' +
        '', this.rstate.node);
    }
    R.slotSeen = true;
    const v = this.newRenderVar('slot');
    this.renderLine(markNode, () => {
      const s = this.renderSelf ?? 'this';
      this.b.emit(`${v} = ${s}.children instanceof Node ? ${s}.children : (${s}.children != null ? ` +
        `document.createTextNode(String(${s}.children)) : document.createComment(''))`);
    });
    return v;
  }

  // A child-component position (`Counter`, `Counter label: x`, `Card`
  // + children). Props
  // evaluate in the PARENT scope; a bare reactive member or module
  // reactive name passes its CONTAINER (the #135 sharing contract —
  // child writes reach the parent's state; `<=>` is sugar over the
  // same channel — the module-name cell binds LIVE, never a stale
  // snapshot); any other expression
  // snapshots, and a reactive one drives an `_updateProp` effect (the
  // #132 seam — so updates into non-reactive child props are loud at
  // the runtime root, and the stale loop-var cell patches live).
  // Children build in the CURRENT scope and pass as ONE `children`
  // prop (duplicate `children:` keys would silently drop all but
  // the last). `@event:`
  // pairs listen on the child's root element (`emit` bubbles
  // CustomEvents through it). Construction failures degrade to a
  // comment placeholder and continue (#137's runtime contract); a
  // NAME that resolves to nothing rejects here — the compile-knowable
  // half. Class-mode instances ride `_children` (the unmount
  // cascade); factory instances ride the block's minted kids array,
  // unmounted in d().
  renderChildComponent(node, name, args) {
    const R = this.rstate;
    const rec = R.sink;
    const markNode = isNode(node) ? node : null;

    // ── The constructor reference ──
    // Loop variables and render locals shadow the module reading (row
    // data can hold a class); members
    // resolve through the instance (a nested member-held
    // declaration is usable here
    // placeholder at mount); module bindings and imports emit bare.
    let ctorRef;
    if (this.renderVarKind(name) !== null) {
      ctorRef = () => this.b.emit(name);
    } else {
      const r = this.resolveBareRead(name);
      if (r === 'member' || r === 'member-reactive') {
        ctorRef = () => this.b.emit(`${this.renderSelf ?? 'this'}.${name}${r === 'member-reactive' ? '.value' : ''}`);
      } else if (r === 'reactive') {
        ctorRef = () => this.b.emit(`${name}.value`);
      } else if (this.inScope(name) || (this.moduleBound !== undefined && this.moduleBound.has(name))) {
        ctorRef = () => this.b.emit(name);
      } else {
        throw this.positionedError(markNode ?? node,
          `emitter: component '${name}' is not defined in this module — a child component must be a module binding, ` +
          'an import, or a component member (an undefined name would degrade to a comment placeholder at mount)', this.rstate.node);
      }
    }

    // The instance/root slots allocate BEFORE the children walk (the fixed
    // order — it also keeps the data-part rule honest: a component
    // whose first renderable is a CHILD component carries no
    // data-part of its own; the child's render carries its own).
    const instVar = this.newRenderVar('inst');
    const elVar = this.newRenderVar('el');

    // ── The argument walk: props, event bindings, children ──
    const props = [];      // { pair, key, fn } in source order
    const updaters = [];   // { pair, key, value } — reactive snapshots
    const eventBindings = []; // { pair, event, value }
    const childVars = [];

    // Every prop key lands ONCE: duplicate keys would emit one JS
    // object literal where the last silently wins, and on an EXTENDS
    // child a duplicated
    // key can leave TWO live writers racing over the inherited
    // element (the first key's _updateProp effect beside the second's
    // rest application — the #164 family; the twin is frozen-broken
    // instead). `__bind_x__` normalizes to `x`: a bind and a plain
    // prop of one name write the same member. `children` collides
    // across SPELLINGS — an explicit `children:` pair against the
    // element body.
    const seenKeys = new Map();
    const declareKey = (rawKey, pair) => {
      const k = rawKey.startsWith('__bind_') && rawKey.endsWith('__') ? rawKey.slice(7, -2) : rawKey;
      if (seenKeys.has(k)) {
        if (k === 'children') {
          throw this.positionedError(pair ?? markNode ?? node,
            'emitter: this child component receives `children` TWICE — an explicit `children:` prop beside element ' +
            'body content; give the children ONE ' +
            'spelling: the element body (indented or inline), or the explicit `children:` prop', this.rstate.node);
        }
        throw this.positionedError(pair ?? markNode ?? node,
          `emitter: duplicate prop '${k}' on a child component — duplicate keys emit one object literal where the ` +
          'last silently wins, and on an extends child the pair leaves two live writers racing over the inherited ' +
          'element; pass one value per prop', this.rstate.node);
      }
      seenKeys.set(k, pair ?? null);
    };

    const addPair = (pair) => {
      if (!isNode(pair) || pair.length !== 3) {
        throw this.positionedError(pair, 'emitter: unsupported attribute form on a child component', markNode ?? this.rstate.node);
      }
      if (R.suppressedPairs.has(pair)) return; // an extracted loop `key:`
      let [, key, value] = pair;
      // `@event: handler` — a listener on the child's root element.
      if (isNode(key) && key[0] === '.' && key[1] === 'this' && typeof key[2] === 'string') {
        this.checkBareEventHandler(pair, value);
        this.checkCrossScopeLocals(value, pair);
        eventBindings.push({ pair, event: key[2], value });
        return;
      }
      if (typeof key !== 'string') {
        throw this.positionedError(pair, 'emitter: computed prop keys are not supported on a child component', markNode ?? this.rstate.node);
      }
      const cleanKey = key.startsWith('"') && key.endsWith('"') ? key.slice(1, -1) : key;
      if (cleanKey === '__transition__') {
        throw this.positionedError(pair,
          'emitter: a transition directive has no child-component reading — the enter/leave phases animate ELEMENTS ' +
          "; put it on the " +
          "branch's first element, inside the child's own render", this.rstate.node);
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
      const isBind = cleanKey.startsWith('__bind_') && cleanKey.endsWith('__');
      if (isBind) {
        this.checkUserSpelledBind(pair);
        const boundName = cleanKey.slice(7, -2);
        const container = this.childContainerRef(value);
        if (container !== null) {
          props.push({ pair, key, fn: container });
          return;
        }
        const dead = (what, fix) => this.positionedError(pair,
          `emitter: \`${boundName} <=> …\` on a child component shares a reactive CONTAINER, and ${what} ` +
          `; ${fix}`,
          this.rstate.node);
        if (typeof value === 'string' && this.renderVarKind(value) === null) {
          const r = this.resolveBareRead(value);
          if (r === 'member') throw dead(`'${value}' is a plain member`, "declare it with ':=' to share it");
          if (r === null && !this.inScope(value)) {
            throw dead(`'${value}' is not declared`, 'bind a reactive member or module reactive name');
          }
        }
        if (isNode(value) && value[0] === '.' && value[1] === 'this' && value.length === 3 && typeof value[2] === 'string') {
          throw dead(`'@${value[2]}' is not a reactive member`, "declare it with ':=' to share it");
        }
        if (typeof value !== 'string' && !Emitter.isChainNode(value)) {
          throw dead('this expression is never a container', 'bind a reactive member or module reactive name');
        }
        this.checkCrossScopeLocals(value, pair);
        props.push({ pair, key, fn: () => this.renderExpr(value) });
        return;
      }
      this.addChildProp(props, updaters, pair, key, cleanKey, value);
    };

    // A bare TEMPLATE-TAG word (or `slot`) in a child-argument
    // position is ambiguous whatever it resolves to — element intent,
    // prop intent, and value intent collide — and rejects naming
    // the TWO silent readings: resolving to nothing, the boolean-prop
    // reading renders no element; resolving to a module value, the
    // VALUE renders as text.
    // Render locals and loop variables keep the established
    // shadow-to-text rule; members keep their text reading.
    const rejectTagWord = (owner, word) => {
      throw this.positionedError(owner,
        `emitter: bare '${word}' under a child component is ambiguous — it reads as an HTML element, as ` +
        'boolean-prop shorthand, and as a value; spell the prop ' +
        `\`${word}: true\`, render the value with \`= ${word}\`, or give the element content or attributes`,
        this.rstate.node);
    };
    const addBareWord = (owner, word) => {
      // the scope rule for the rest: a bare word resolving to
      // NOTHING is boolean-prop shorthand (`Button outline` ⇒
      // `outline: true`); in-scope values fall through to the
      // children build as text. The word is a PRIMITIVE (no
      // NodeStore row), so its face row's span DERIVES from the
      // anchored scan below (never invented — a word the scan
      // cannot anchor gets no row).
      declareKey(word, null);
      props.push({ pair: null, key: word, span: wordSpan(word), fn: () => this.b.emit('true') });
    };

    // The bare-word span scan (face mapping only): a boolean-shorthand key is a primitive with no
    // store row, so completions at a FRESH key position (`Chip
    // label: "x", w‸`) had no exact row to map through and answered
    // empty. The scan walks the construct's args in SOURCE order,
    // advancing a cursor past each item's recorded span (registered
    // nodes) or literal text (string primitives — the enum bareSpan
    // convention), so the next word-boundary match IS the word's own
    // span; any item the cursor cannot consume stops the derivation
    // for everything after it (honest gap, never a guessed anchor).
    const scanSelfSpan = markNode !== null && this.stores.idOf(markNode) !== null
      ? this.stores.selfSpan(this.stores.idOf(markNode)) : null;
    let scanAt = scanSelfSpan !== null && this.b.source !== null ? scanSelfSpan[0] : null;
    const scanAdvance = (x) => {
      if (scanAt === null || x == null) return;
      if (isNode(x)) {
        const xid = this.stores.idOf(x);
        const sp = xid !== null ? this.stores.selfSpan(xid) : null;
        scanAt = sp !== null ? Math.max(scanAt, sp[1]) : null;
        return;
      }
      if (typeof x === 'string') {
        const at = this.b.source.indexOf(x, scanAt);
        scanAt = at >= 0 && at + x.length <= scanSelfSpan[1] ? at + x.length : null;
        return;
      }
      scanAt = null;
    };
    const wordSpan = (word) => {
      if (scanAt === null) return null;
      const re = new RegExp(`(?<![\\w$])${word.replace(/\$/g, '\\$&')}(?![\\w$])`, 'g');
      re.lastIndex = scanAt;
      const m = re.exec(this.b.source);
      if (m === null || m.index + word.length > scanSelfSpan[1]) return null;
      scanAt = m.index + word.length;
      return [m.index, m.index + word.length];
    };

    // First pass: props classify in source order; DOM children
    // collect for the build below (the split — every non-prop arg
    // is child DOM).
    const domItems = [];
    const isTextChild = (arg) =>
      !isNode(arg) && !(typeof arg === 'string' &&
        ((isHtmlTag(arg.split(/[#.]/)[0]) || isComponentName(arg.split(/[#.]/)[0])) &&
         this.renderVarKind(arg) === null && this.resolveBareRead(arg) === null));
    const classifyChild = (arg) => {
      if (arg == null) return;
      const isBareWord = typeof arg === 'string' && RENDER_LOCAL_RE.test(arg) &&
        this.renderVarKind(arg) === null && this.resolveBareRead(arg) === null;
      if (isBareWord && (isHtmlTag(arg) || arg === 'slot')) {
        rejectTagWord(markNode ?? this.rstate.node, arg);
      }
      if (isBareWord && !this.inScope(arg) && !this.moduleBound.has(arg)) {
        addBareWord(markNode ?? this.rstate.node, arg);
        return;
      }
      scanAdvance(arg);
      domItems.push(arg);
    };
    for (const arg of args) {
      if (isObject(arg)) {
        for (const pair of arg.slice(1)) addPair(pair);
        scanAdvance(arg);
      } else if (isFunc(arg)) {
        // The injected children arrow: objects are props, bare words
        // follow the scope rule, everything else is child DOM.
        const block = arg[2];
        const stmts = isBlock(block) ? block.slice(1) : block != null ? [block] : [];
        for (const child of stmts) {
          if (isObject(child)) {
            for (const pair of child.slice(1)) addPair(pair);
            scanAdvance(child);
          } else {
            classifyChild(child);
          }
        }
      } else {
        classifyChild(arg);
      }
    }

    // ── The children build: one child directly; several through a
    // fragment allocated FIRST with interleaved appends (the fixed
    // emitTemplateBlock order). A text child keeps the shape — no
    // String() wrap; a reactive one binds live. ──
    const buildChild = (arg) => {
      if (!isTextChild(arg)) return this.renderNode(arg);
      this.checkCrossScopeLocals(arg, markNode ?? this.rstate.node);
      const t = this.newRenderText();
      if (this.renderReactive(arg)) {
        this.renderLine(markNode, () => this.b.emit(`${t} = document.createTextNode('')`));
        this.renderEffect(markNode, () => {
          this.b.emit(`${t}.data = `);
          this.renderExpr(arg);
          this.b.emit(';');
        }, arg);
      } else {
        this.renderLine(markNode, () => {
          this.b.emit(`${t} = document.createTextNode(`);
          this.renderExpr(arg);
          this.b.emit(')');
        });
      }
      return t;
    };
    const renderables = domItems.filter((a) => !this.isRenderBinding(a));
    if (renderables.length === 1) {
      declareKey('children', null);
      let childrenVar = null;
      for (const arg of domItems) {
        const v = buildChild(arg);
        if (v != null) childrenVar = v;
      }
      props.push({ pair: null, key: 'children', fn: () => this.b.emit(childrenVar) });
    } else if (renderables.length > 1) {
      declareKey('children', null);
      const frag = this.newRenderVar('frag');
      this.renderLine(null, () => this.b.emit(`${frag} = document.createDocumentFragment()`));
      for (const arg of domItems) {
        const v = buildChild(arg);
        if (v != null) this.renderLine(null, () => this.b.emit(`${frag}.appendChild(${v})`));
      }
      props.push({ pair: null, key: 'children', fn: () => this.b.emit(frag) });
    } else {
      for (const arg of domItems) buildChild(arg);
    }

    // ── The instantiation protocol (the fixed shape over the owner
    // seam: the child's frame pushed around _create and the lifecycle
    // calls, so its effects die on ITS unmount, never the parent's) ──
    // The braced scaffold consts mint against every name the
    // construct spells (module-level `__` names read inside prop
    // values must not be captured).
    const used = new Set([...rec.bindings, ...rec.locals]);
    if (rec.vars !== null) for (const v of rec.vars) used.add(v);
    if (isNode(node)) Emitter.collectLeafNames(node, used);
    const prevV = Emitter.mintName('__prev', used);
    const cprevV = Emitter.mintName('__cprev', used);
    const coV = Emitter.mintName('__co', used);
    const ueV = Emitter.mintName('__ue', used);
    const errV = Emitter.mintName('__childErr', used);
    const hookErrV = Emitter.mintName('__e', used);
    if (rec.kind !== 'class') rec.hasKids = true;

    const line = (fn) => this.renderLine(markNode, fn, false);
    const self = () => this.renderSelf ?? 'this';
    line(() => this.b.emit(`{ const ${prevV} = __pushComponent(${self()}); try {`));
    line(() => this.b.emit('try {'));
    line(() => {
      this.b.emit(`${instVar} = new `);
      ctorRef();
      this.b.emit('(');
      if (props.length === 0) {
        this.b.emit('{}');
      } else {
        this.b.emit('{ ');
        props.forEach((p, i) => {
          if (i > 0) this.b.emit(', ');
          const emitPair = () => {
            // A boolean-shorthand key's derived span records a face
            // row (the builder's verbatim comparison makes it EXACT —
            // same bytes), so completions and diagnostics at the
            // word's own position map into the ctor object. Face-only:
            // JS-mode rows would revise the corpus map artifacts for
            // an editor-consumer concern.
            const mid = isNode(markNode) ? this.stores.idOf(markNode) : null;
            if (this.ts && p.span != null && mid !== null) {
              this.b.markSpan(mid, 'shorthandProp', p.span[0], p.span[1], () => this.b.emit(p.key));
              this.b.emit(': ');
              p.fn();
              return;
            }
            this.b.emit(`${p.key}: `);
            p.fn();
          };
          if (p.pair !== null && this.stores.idOf(p.pair) !== null) this.mark(p.pair, '$self', emitPair);
          else emitPair();
        });
        this.b.emit(' }');
      }
      this.b.emit(');');
    });
    line(() => this.b.emit(`if (${instVar} && ${instVar}._initFailed) {`));
    line(() => this.b.emit(`  try { ${instVar}.unmount({removeDOM: false}); } catch (${ueV}) { console.error('[Rip] partial-init unmount error:', ${ueV}); }`));
    line(() => this.b.emit(`  ${instVar} = null;`));
    line(() => this.b.emit(`  ${elVar} = document.createComment('rip:child-init-failed: ${name}');`));
    line(() => this.b.emit('} else {'));
    line(() => this.b.emit(`  { const ${cprevV} = __pushComponent(${instVar}); const ${coV} = __pushOwner(${instVar}._frame); try {`));
    line(() => this.b.emit(`    ${elVar} = ${instVar}._root = ${instVar}._create();`));
    line(() => this.b.emit(`  } finally { __popOwner(${coV}); __popComponent(${cprevV}); } }`));
    if (rec.kind === 'class') {
      line(() => this.b.emit(`  (this._children || (this._children = [])).push(${instVar});`));
    } else {
      line(() => this.b.emit(`  ${rec.kidsVar}.push(${instVar});`));
    }
    line(() => this.b.emit('}'));
    line(() => this.b.emit(`} catch (${errV}) {`));
    line(() => this.b.emit(`  console.error('[Rip] ${name} construction failed:', ${errV});`));
    line(() => this.b.emit(`  if (${instVar}) { try { ${instVar}.unmount({removeDOM: false}); } catch (${ueV}) { console.error('[Rip] partial-child unmount error:', ${ueV}); } }`));
    line(() => this.b.emit(`  ${instVar} = null;`));
    line(() => this.b.emit(`  ${elVar} = document.createComment('rip:child-error: ${name}');`));
    line(() => this.b.emit('}'));
    line(() => this.b.emit(`} finally { __popComponent(${prevV}); } }`));

    // Event bindings on the child's root; the listener
    // param mints against the handler's reads.
    for (const { pair, event, value } of eventBindings) {
      const evUsed = new Set();
      Emitter.collectLeafNames(value, evUsed);
      const ev = Emitter.mintName('e', evUsed);
      this.renderLine(pair, () => {
        this.b.emit(`if (${instVar}) ${elVar}.addEventListener('${event}', (${ev}) => __batch(() => (`);
        this.tsHandlerCast(() => this.withExpression(() => this.expr(value)));
        this.b.emit(`)(${ev})))`);
      });
    }

    // ── Setup: the once-latched lifecycle (the fixed shape over the owner
    // seam), then the reactive-prop updaters through _updateProp ──
    rec.setups.push({
      kind: 'raw',
      fn: (pad) => {
        this.b.emit(pad);
        const emitLatch = () => this.b.emit(
          `if (${instVar} && !${instVar}._isSetup) { ${instVar}._isSetup = true; ` +
          `const ${cprevV} = __pushComponent(${instVar}); const ${coV} = __pushOwner(${instVar}._frame); try { ` +
          `try { if (${instVar}.beforeMount) ${instVar}.beforeMount(); if (${instVar}._setup) ${instVar}._setup(); ` +
          `if (${instVar}.mounted) ${instVar}.mounted(); } catch (${hookErrV}) { __handleComponentError(${hookErrV}, ${instVar}); } ` +
          `} finally { __popOwner(${coV}); __popComponent(${cprevV}); } }`);
        if (markNode !== null) this.mark(markNode, '$self', emitLatch);
        else emitLatch();
        this.b.emit('\n');
      },
    });
    for (const { pair, key, value } of updaters) {
      const cleanKey = key.startsWith('"') && key.endsWith('"') ? key.slice(1, -1) : key;
      this.renderEffect(pair, () => {
        this.b.emit(`if (${instVar}) ${instVar}._updateProp('${cleanKey}', `);
        this.renderExpr(value);
        this.b.emit(');');
      }, value);
    }

    return elVar;
  }

  // An ordinary child-component prop: the bare reactive member /
  // module reactive name passes its CONTAINER (the #135 contract);
  // everything else snapshots, and a reactive snapshot drives an
  // _updateProp effect.
  addChildProp(props, updaters, pair, key, cleanKey, value) {
    const container = this.childContainerRef(value);
    if (container !== null) {
      props.push({ pair, key, fn: container });
      return;
    }
    this.checkCrossScopeLocals(value, pair);
    props.push({ pair, key, fn: () => this.renderExpr(value) });
    if (this.renderReactive(value)) updaters.push({ pair, key, value });
  }

  // The container-passable spellings: a bare REACTIVE member (`name`
  // or `@name`) and a bare module-level reactive name. Locals and
  // loop variables shadow (their values pass as row data, never as
  // this-member containers).
  childContainerRef(value) {
    if (typeof value === 'string') {
      if (this.renderVarKind(value) !== null) return null;
      const r = this.resolveBareRead(value);
      if (r === 'member-reactive') return () => this.b.emit(`${this.renderSelf ?? 'this'}.${value}`);
      if (r === 'reactive') return () => this.b.emit(value);
      return null;
    }
    if (isNode(value) && value[0] === '.' && value[1] === 'this' && value.length === 3 &&
        typeof value[2] === 'string' && this.memberIsReactive(value[2])) {
      return () => this.b.emit(`${this.renderSelf ?? 'this'}.${value[2]}`);
    }
    return null;
  }

  // Attributes, events, and class merges on one element.
  renderAttributes(el, objExpr) {
    const R = this.rstate;
    for (const pair of objExpr.slice(1)) {
      if (!isNode(pair) || pair.length !== 3) {
        throw this.positionedError(pair, 'emitter: unsupported attribute form in render', objExpr);
      }
      // An extracted loop `key:` pair — consumed by the keyFn, never
      // an attribute (#126).
      if (R.suppressedPairs.has(pair)) continue;
      let [, key, value] = pair;

      // A factory-scoped value must not read an enclosing render
      // scope's locals — EVERY attribute position rejects, not just
      // text/condition sites (F2).
      this.checkCrossScopeLocals(value, pair);

      // Event binding: `@name: handler`. A dispatch through a bare
      // member name calls the method on the instance (`ctx` inside
      // factories — the factory methods run unbound). The event param
      // mints against the handler's reads: a loop variable named `e`
      // must not be captured by the listener's own parameter
      // (a fixed `e` would hand the handler the event object as row
      // data).
      if (isNode(key) && key[0] === '.' && key[1] === 'this' && typeof key[2] === 'string') {
        const eventName = key[2];
        this.checkBareEventHandler(pair, value);
        if (this.rstate.sink.kind === 'loop' && this.loopVarNames().size > 0 &&
            referencesNames(value, this.loopVarNames())) {
          // The listener is a CREATE-phase closure over the loop item:
          // p()'s param re-binding keeps it current, but only when p()
          // runs — a block with no effects must not go static.
          this.rstate.sink.forceNonStatic = true;
        }
        const evUsed = new Set();
        Emitter.collectLeafNames(value, evUsed);
        const ev = Emitter.mintName('e', evUsed);
        this.renderLine(pair, () => {
          const self = this.renderSelf ?? 'this';
          this.b.emit(`${el}.addEventListener('${eventName}', (${ev}) => __batch(() => `);
          if (typeof value === 'string' && this.renderVarKind(value) === null &&
              this.cframes[this.cframes.length - 1].members.has(value)) {
            if (this.ts) this.b.tsOnly(() => this.b.emit('('));
            this.b.emit(`${self}.${value}`);
            if (this.ts) this.b.tsOnly(() => this.b.emit(' as any)'));
            this.b.emit(`(${ev})`);
          } else {
            this.b.emit('(');
            this.tsHandlerCast(() => this.withExpression(() => this.expr(value)));
            this.b.emit(`)(${ev})`);
          }
          this.b.emit('))');
        });
        continue;
      }

      if (typeof key !== 'string') {
        throw this.positionedError(pair, 'emitter: computed attribute keys are not supported in render', objExpr);
      }
      if (key.startsWith('"') && key.endsWith('"')) key = key.slice(1, -1);

      if (key === '__transition__') {
        this.renderTransition(el, pair, value, objExpr);
        continue;
      }
      if (key === 'ref') {
        this.renderRef(el, pair, value, objExpr);
        continue;
      }
      if (key.startsWith('__bind_') && key.endsWith('__')) {
        this.checkUserSpelledBind(pair);
        this.renderBind(el, pair, key.slice(7, -2), value, objExpr);
        continue;
      }
      if (key === 'key') {
        throw this.positionedError(pair,
          "emitter: `key:` identifies loop rows — it is read only on the FIRST element of a `for` body inside render; " +
          'anywhere else it would leak into the DOM as an attribute', objExpr);
      }

      if (key === 'class' || key === 'className') {
        if (R.pendingClassArgs !== null && R.pendingClassEl === el) {
          this.checkSetupLocalRefs(value, pair);
          R.pendingClassArgs.push(() => this.renderExpr(value));
        } else if (this.renderReactive(value)) {
          const isSvg = R.svgDepth > 0;
          this.renderEffect(pair, () => {
            this.b.emit(isSvg ? `${el}.setAttribute('class', __clsx(` : `${el}.className = __clsx(`);
            this.renderExpr(value);
            this.b.emit(isSvg ? '));' : ');');
          }, value);
        } else {
          const isSvg = R.svgDepth > 0;
          const compound = isNode(value);
          this.renderLine(pair, () => {
            this.b.emit(isSvg ? `${el}.setAttribute('class', ` : `${el}.className = `);
            if (compound) this.b.emit('__clsx(');
            this.renderExpr(value);
            if (compound) this.b.emit(')');
          });
        }
        continue;
      }

      if ((key === 'value' || key === 'checked') && this.renderReactive(value)) {
        this.renderEffect(pair, () => {
          this.b.emit(`${el}.${key} = `);
          this.renderExpr(value);
          this.b.emit(';');
        }, value);
        continue;
      }

      if (key === 'innerHTML' || key === 'textContent' || key === 'innerText') {
        if (this.renderReactive(value)) {
          this.renderEffect(pair, () => {
            this.b.emit(`${el}.${key} = `);
            this.renderExpr(value);
            this.b.emit(';');
          }, value);
        } else {
          this.renderLine(pair, () => {
            this.b.emit(`${el}.${key} = `);
            this.renderExpr(value);
          });
        }
        continue;
      }

      if (Emitter.BOOLEAN_ATTRS.has(key)) {
        if (this.renderReactive(value)) {
          this.renderEffect(pair, () => {
            this.b.emit(`${el}.toggleAttribute('${key}', !!`);
            this.renderExpr(value);
            this.b.emit(');');
          }, value);
        } else {
          this.renderLine(pair, () => {
            this.b.emit('if (');
            this.withExpression(() => this.expr(value));
            this.b.emit(`) ${el}.setAttribute('${key}', '')`);
          });
        }
        continue;
      }

      const isPresence = isNode(value) && value[0] === 'presence' && value.length === 2;
      if (this.renderReactive(value)) {
        if (isPresence) {
          this.renderEffect(pair, () => {
            this.b.emit('{ const __v = ');
            this.renderExpr(value);
            this.b.emit(`; __v == null ? ${el}.removeAttribute('${key}') : ${el}.setAttribute('${key}', __v); }`);
          }, value);
        } else {
          this.renderEffect(pair, () => {
            this.b.emit(`${el}.setAttribute('${key}', `);
            this.renderExpr(value);
            if (this.ts) this.b.tsOnly(() => this.b.emit(' as any'));
            this.b.emit(');');
          }, value);
        }
      } else if (isPresence) {
        this.renderLine(pair, () => {
          this.b.emit('{ const __v = ');
          this.renderExpr(value);
          this.b.emit(`; if (__v != null) ${el}.setAttribute('${key}', __v); }`);
        }, false);
      } else {
        this.renderLine(pair, () => {
          this.b.emit(`${el}.setAttribute('${key}', `);
          this.renderExpr(value);
          // Rip DOM attributes are coercive by design (numbers,
          // booleans stringify); TS's string-only setAttribute view
          // is scaffold noise — quiet it TS-only (quiet-TS-only doctrine).
          if (this.ts) this.b.tsOnly(() => this.b.emit(' as any'));
          this.b.emit(')');
        });
      }
    }
  }

  // ── The dynamic render layer ────────────────────────────────

  // The current loop variable names, innermost scope's whole stack.
  loopVarNames() {
    const names = new Set();
    for (const v of this.rstate.sink.loopStack) {
      names.add(v.itemVar);
      names.add(v.indexVar);
    }
    return names;
  }

  // A render expression captured for LATER emission must not read an
  // ENCLOSING render scope's locals — each factory is its own JS
  // function (a compiled read would be a ReferenceError, or would
  // re-read the name as markup). Names the current scope re-binds
  // are its own and pass.
  checkCrossScopeLocals(expr, node) {
    const R = this.rstate;
    if (!R) return;
    const visible = (n) => R.sink.locals.has(n) || this.loopVarNames().has(n);
    for (let r = R.sink.parent; r !== null; r = r.parent) {
      if (r.locals.size === 0) continue;
      const hidden = new Set([...r.locals].filter((n) => !visible(n)));
      if (hidden.size > 0 && referencesNames(expr, hidden)) {
        throw this.positionedError(node,
          'emitter: this expression reads a render local of an ENCLOSING render scope — each dynamic block (a ' +
          'conditional branch, a loop body) is its own factory function, and render locals never cross that boundary ' +
          '; declare the local ' +
          'inside this block, or use a member', this.rstate.node);
      }
    }
  }

  // A render local: `name = expr` declares (a create-phase `let` —
  // a create-time snapshot, the semantics), compound forms mutate.
  // Returns null — no DOM child.
  renderBinding(stmt) {
    const [op, name, value] = stmt;
    const rec = this.rstate.sink;
    if (name.startsWith('__')) {
      throw this.positionedError(stmt,
        `emitter: render local '${name}' — double-underscore names are the compiler/runtime namespace inside render ` +
        '(factory scaffolding and injected helpers live there)');
    }
    if (rec.loopStack.some((v) => v.itemVar === name || v.indexVar === name)) {
      throw this.positionedError(stmt,
        `emitter: '${name}' is a loop variable — a render local cannot re-declare or assign it ` +
        "");
    }
    if (op === '=') {
      if (!rec.locals.has(name)) {
        rec.locals.add(name);
        rec.bindings.add(name);
        rec.localDecls.set(name, stmt);
        if (rec.kind !== 'class') rec.vars.add(name);
      }
    } else if (!rec.locals.has(name)) {
      throw this.positionedError(stmt,
        `emitter: compound assignment to '${name}' — no render local of that name is declared in this render scope ` +
        '(`name = expr` declares one)');
    }
    this.checkCrossScopeLocals(value, stmt);
    this.renderLine(stmt, () => {
      this.mark(stmt, 'target', () => this.b.emit(name));
      this.b.emit(` ${op} `);
      this.mark(stmt, 'value', () => this.withExpression(() => this.expr(value)));
    });
    return null;
  }

  // At a render scope's close, a local never read anywhere in the
  // scope's statements is DEAD — and the spelling that produces one is
  // almost always an element line (`li = item` means a local named
  // `li`, never an <li>).
  closeRenderScope(rec) {
    for (const [name, decl] of rec.localDecls) {
      let reads = 0;
      const walk = (x) => {
        if (typeof x === 'string') {
          if (x === name) reads++;
          return;
        }
        if (!isNode(x)) return;
        // The binding's own target slot is a declaration, not a read.
        if (RENDER_BINDING_HEADS.has(x[0]) && x.length === 3 && x[1] === name) {
          walk(x[2]);
          return;
        }
        // NAME positions are never reads: a plain pair KEY
        // (`div x: "attr"` must not count as a read of local `x`) and
        // a member PROPERTY slot. Dynamic keys and computed accesses
        // are nodes and walk normally.
        if ((x[0] === ':' || x[0] === 'void-pair') && x.length === 3 && typeof x[1] === 'string') {
          walk(x[2]);
          return;
        }
        if ((x[0] === '.' || x[0] === '?.') && x.length === 3 && typeof x[2] === 'string') {
          walk(x[1]);
          return;
        }
        for (const el of x) walk(el);
      };
      for (const s of rec.stmts) walk(s);
      if (reads === 0) {
        throw this.positionedError(decl,
          `emitter: render local '${name}' is never read — a dead local renders NOTHING (if this line meant an ` +
          `element with expression text, spell it \`${name}\` + indented \`= expr\`: inside render \`${name} = expr\` ` +
          'declares a local named the tag)', this.rstate.node);
      }
    }
  }

  // Walk a factory body (a conditional branch, a loop body) into its
  // own RECORD: fresh local scope, `ctx` self, emission deferred to
  // the factory method. Loop callers extend `loopEntry`.
  // Every bare word a subtree spells that could be an IDENTIFIER
  // reference — liberal (a false hit only moves a minted scaffold
  // name to its next candidate, never changes meaning), except the
  // pure NAME positions that can never reference: plain pair KEYS and
  // member PROPERTY slots (always behind a dot — skipping them keeps
  // the scaffold bytes stable when an attribute or property spells
  // `show`/`anchor`). The reserved-name mechanism: emitted SCAFFOLD
  // names (`ctx`, `__fr`, `__o`, the p() re-bind params, the swap's
  // consts, a listener's event param) must never capture a name the
  // user's code references — fixed names would silently collide.
  static collectLeafNames(x, set) {
    if (typeof x === 'string') {
      if (RENDER_LOCAL_RE.test(x)) set.add(x);
      return;
    }
    if (!isNode(x)) return;
    if ((x[0] === ':' || x[0] === 'void-pair') && x.length === 3 && typeof x[1] === 'string') {
      Emitter.collectLeafNames(x[2], set);
      return;
    }
    if ((x[0] === '.' || x[0] === '?.') && x.length === 3 && typeof x[2] === 'string') {
      Emitter.collectLeafNames(x[1], set);
      return;
    }
    for (const el of x) Emitter.collectLeafNames(el, set);
  }

  // Mint a scaffold name that collides with nothing in `used`; the
  // pick joins `used` so sibling scaffold names stay distinct.
  static mintName(base, used) {
    let name = base;
    while (used.has(name)) name = `${name}_`;
    used.add(name);
    return name;
  }

  walkFactory(part, kind, originNode, loopEntry = null) {
    const R = this.rstate;
    const parent = R.sink;
    const name = this.newBlockName();
    const ownVars = loopEntry !== null ? [loopEntry.itemVar, loopEntry.indexVar] : [];
    // Header assembly with RENAME-THREADING (the
    // duplicate-parameter hazard): an outer loop variable SHADOWED by an
    // own var (or by an earlier outer) cannot repeat in the header —
    // factories are strict-mode class methods, so the duplicate
    // parameter (`function b(ctx, x, j, x, i)`) is a load-time
    // SyntaxError. Only the SHADOWED position renames (its name is
    // unreachable in this scope — the shadow owns the spelling); a
    // legitimate outer capture keeps its name, so body reads stay
    // honest. The rename threads through this record's loopStack, so
    // deeper factories and reconcile call sites pass the value under
    // the name VISIBLE here; the minted name dodges everything the
    // body spells.
    const headerSet = new Set(ownVars);
    const bodySpells = new Set();
    Emitter.collectLeafNames(part, bodySpells);
    const remap = (n) => {
      if (!headerSet.has(n)) {
        headerSet.add(n);
        return n;
      }
      let cand = `${n}_`;
      while (headerSet.has(cand) || bodySpells.has(cand)) cand += '_';
      headerSet.add(cand);
      return cand;
    };
    const visibleOuter = parent.loopStack.map((v) => ({ ...v, itemVar: remap(v.itemVar), indexVar: remap(v.indexVar) }));
    const outerVars = visibleOuter.flatMap((v) => [v.itemVar, v.indexVar]);
    const loopStack = loopEntry !== null ? [...visibleOuter, loopEntry] : visibleOuter;
    const rec = {
      kind, name, parent, self: 'ctx',
      // OWN vars FIRST, then the threaded outer names — the runtime's
      // calling convention: __reconcile invokes `factory(ctx, item, i,
      // ...outer)` and `block.p(ctx, item, i, ...outer)` — the
      // order is load-bearing (the reversed
      // order bound nested-loop parameters CROSSWISE — the inner item
      // arrived in the outer-row slot).
      paramNames: [...ownVars, ...outerVars],
      frameVar: '__fr', ownerVar: '__o',
      creates: [], setups: [], vars: new Set(),
      locals: new Set(), localDecls: new Map(),
      bindings: new Set([...outerVars, ...ownVars]),
      refs: [], loopStack, stmts: [],
      forceNonStatic: false, root: null, isStatic: false, originNode,
      hasKids: false, kidsVar: null,
    };
    R.records.push(rec);
    const prevSlot = R.transitionSlot;
    R.transitionSlot = kind === 'branch' ? { record: rec, el: null } : null;
    R.sink = rec;
    this.rframes.push({ reactive: new Set(), bound: rec.bindings });
    try {
      let stmts;
      if (isBlock(part)) {
        stmts = part.slice(1);
      } else if (isNode(part) && part.length === 1 && isNode(part[0]) && this.stores.idOf(part) === null) {
        // The postfix conditional's plain [statement] wrapper.
        stmts = [part[0]];
      } else {
        stmts = [part];
      }
      rec.stmts = stmts;
      rec.root = stmts.length === 0 ? null : this.walkChildStmts(stmts);
      if (rec.root === null) {
        rec.root = this.newRenderVar('empty');
        this.renderLine(null, () => this.b.emit(`${rec.root} = document.createComment('')`));
      }
    } finally {
      this.rframes.pop();
      R.sink = parent;
      R.transitionSlot = prevSlot;
    }
    this.closeRenderScope(rec);
    rec.isStatic = kind === 'loop' && rec.setups.length === 0 && !rec.forceNonStatic;
    // The factory's scaffold names mint AFTER the walk, against every
    // name the body binds or spells — a loop variable named `ctx`,
    // `fr`, or `o` must never collide with the self param, the patch
    // frame, or the owner token (a collision is invalid JS or a
    // first-patch TypeError).
    const used = new Set([...rec.bindings, ...rec.locals, ...rec.vars]);
    Emitter.collectLeafNames(rec.stmts, used);
    rec.self = Emitter.mintName('ctx', used);
    rec.frameVar = Emitter.mintName('__fr', used);
    rec.ownerVar = Emitter.mintName('__o', used);
    // Child-component instances the block constructs (the fixed
    // _factoryChildren): the array is block state; d() unmounts them.
    if (rec.hasKids) rec.kidsVar = Emitter.mintName('_factoryChildren', used);
    return rec;
  }

  // Conditional rendering: an anchor comment + one factory per branch
  // + a swap effect in the enclosing setup phase. this side's else-if chains
  // are already NESTED if-nodes in the else slot — the recursion
  // through the branch factory handles them (the flat-chain fold has
  // no input shape here; a >4-length node would be one, and rejects
  // loudly if the grammar ever grew it).
  renderCond(node, markNode = node) {
    if (node.length > 4) {
      throw this.positionedError(node, 'emitter: unexpected flat conditional chain shape in render (internal)');
    }
    // A switch's synthetic if-chain re-enters here per else-link with
    // the DEFAULT markNode (the minted chain node, no store id) — the
    // author's switch node threads through _chainMarkNode so every
    // link's diagnostics map to the statement the author wrote
    // (the statusz leak).
    if (this.stores.idOf(markNode) === null && this._chainMarkNode) markNode = this._chainMarkNode;
    const [, cond, thenPart] = node;
    const elsePart = node.length === 4 ? node[3] : null;
    this.checkSetupLocalRefs(cond, markNode);
    this.checkCrossScopeLocals(cond, markNode);
    const anchorVar = this.newRenderVar('anchor');
    this.renderLine(null, () => this.b.emit(`${anchorVar} = document.createComment('if')`));
    const thenRec = this.walkFactory(thenPart, 'branch', markNode);
    const prevChain = this._chainMarkNode;
    if (elsePart !== null && isNode(elsePart) && elsePart[0] === 'if' && this.stores.idOf(elsePart) === null) {
      this._chainMarkNode = markNode;
    }
    const elseRec = elsePart !== null ? this.walkFactory(elsePart, 'branch', markNode) : null;
    this._chainMarkNode = prevChain;
    const hasRef = thenRec.refs.length > 0 || (elseRec !== null && elseRec.refs.length > 0);
    const sink = this.rstate.sink;
    const outer = sink.loopStack.flatMap((v) => [v.itemVar, v.indexVar]);
    sink.setups.push({
      kind: 'raw',
      // A directive above the render conditional rides its setup line —
      // markNode is the AUTHOR's node (a render switch lowers through a
      // synthetic if-chain; only markNode is in the directive map).
      node: markNode,
      fn: (pad) => this.emitCondSetup(pad, markNode, node, anchorVar, thenRec, elseRec, hasRef, outer),
    });
    return anchorVar;
  }

  // `switch` folds into the if-chain: each
  // `when` becomes `disc === test` (OR-joined for test lists); a
  // subjectless switch takes the tests bare. The minted nodes carry
  // no store rows — marks fall back to the switch node itself.
  renderSwitch(node) {
    const [, disc, whens, dflt] = node;
    let chain = dflt;
    for (let i = whens.length - 1; i >= 0; i--) {
      const [, tests, body] = whens[i];
      let cond;
      if (disc === null) {
        cond = tests.reduce((a, t) => (a === null ? t : ['||', a, t]), null);
      } else {
        cond = tests.map((t) => ['==', disc, t]).reduce((a, c) => (a === null ? c : ['||', a, c]), null);
      }
      chain = chain !== null ? ['if', cond, body, chain] : ['if', cond, body];
    }
    if (chain === null || chain[0] !== 'if') {
      // A when-less switch (default only, or empty) has no swap to
      // build — its body renders unconditionally.
      return chain === null ? this.renderNode('null') : this.renderChildBlock(chain);
    }
    return this.renderCond(chain, node);
  }

  // Loop rendering: `for … in` over an anchor comment + one row
  // factory + a reconcile effect (#126's compile half — the runtime
  // half is the runtime's).
  renderLoop(node) {
    const [, vars, iter, step, guard, body] = node;
    if (step !== null) {
      throw this.positionedError(node,
        'emitter: a `by` step has no render reading — the reconciler patches whole collections; step the collection itself: `items.filter((x, i) -> i % 2 == 0)`');
    }
    if (guard !== null) {
      throw this.positionedError(node,
        'emitter: a `when` guard has no render reading — the reconciler patches whole collections; filter the collection itself: `for x in items.filter((x) -> cond)`');
    }
    if (vars.length > 2 || vars.some((v) => typeof v !== 'string')) {
      throw this.positionedError(node,
        'emitter: a render loop takes plain item and index variables (`for item, i in items`) — destructuring loop ' +
        'variables have no factory-parameter reading here; destructure inside the body');
    }
    if (vars.length === 2 && vars[0] === vars[1]) {
      throw this.positionedError(node,
        `emitter: a render loop cannot bind '${vars[0]}' as BOTH item and index — one name cannot hold two row facts ` +
        '');
    }
    for (const v of vars) {
      if (v.startsWith('__')) {
        throw this.positionedError(node,
          `emitter: render loop variable '${v}' — double-underscore names are the compiler/runtime namespace inside ` +
          'render (factory scaffolding and injected helpers live there)');
      }
    }
    this.checkSetupLocalRefs(iter, node);
    this.checkCrossScopeLocals(iter, node);
    const itemVar = vars[0];
    let indexVar = vars[1] ?? null;
    if (indexVar === null) {
      // Pick an index name that collides with nothing: outer loop
      // vars, the item var, any `for` var or render local anywhere in
      // the body subtree (the rule — the nested factories thread it
      // as a positional parameter) — AND any candidate the body spells
      // at all: loop variables shadow tags, so an auto-picked `i`
      // would silently swallow an `<i>` element line (the auto-index
      // is a name the user never wrote).
      const used = new Set(this.loopVarNames());
      used.add(itemVar);
      Emitter.collectRenderBodyBindings(body, used);
      const spells = (x, name) => {
        if (typeof x === 'string') return x === name;
        return isNode(x) && x.some((el) => spells(el, name));
      };
      for (const candidate of ['i', 'j', 'k', 'l', 'm', 'n']) {
        if (!used.has(candidate) && !spells(body, candidate)) {
          indexVar = candidate;
          break;
        }
      }
      indexVar = indexVar ?? `__rip_idx${this.rstate.sink.loopStack.length}`;
    }
    const anchorVar = this.newRenderVar('anchor');
    this.renderLine(null, () => this.b.emit(`${anchorVar} = document.createComment('for')`));
    const reactiveSource = this.renderReactive(iter);
    const keyExpr = this.extractLoopKey(body, node);
    if (keyExpr !== null) {
      this.checkSetupLocalRefs(keyExpr, node);
      this.checkCrossScopeLocals(keyExpr, node);
    }
    const rec = this.walkFactory(body, 'loop', node, { itemVar, indexVar, reactiveSource });
    if (keyExpr !== null) {
      // The keyFn emits in the ENCLOSING setup scope with (item, i)
      // params — a render local declared inside the loop BODY does
      // not exist there (a live keyFn compiled that way would throw
      // at mount). Checked before the
      // row-derivation rule so the diagnosis names the real problem.
      if (rec.locals.size > 0 && referencesNames(keyExpr, rec.locals)) {
        throw this.positionedError(node,
          'emitter: a `key:` expression must be evaluable in the loop HEADER scope — it reads a render local declared ' +
          'inside the loop body, which lives in the row factory (derive the key from the item inline: `key: item.id`)');
      }
      // A key is the ROW's identity: a keyFn that never reads the
      // loop's item or index cannot be injective over the rows —
      // constant keys die at the runtime's duplicate-key rejection,
      // and an undeclared root (`key: missing.id`) is a mount-time
      // ReferenceError far from here.
      if (!referencesNames(keyExpr, new Set([itemVar, indexVar]))) {
        throw this.positionedError(node,
          `emitter: a loop key must derive from the row — this \`key:\` expression never reads '${itemVar}'` +
          `${vars.length === 2 ? ` or '${indexVar}'` : ''} (a row-independent key cannot identify rows)`);
      }
    }
    const hasRef = rec.refs.length > 0;
    const sink = this.rstate.sink;
    const outer = sink.loopStack.flatMap((v) => [v.itemVar, v.indexVar]);
    sink.setups.push({
      kind: 'raw',
      node, // a directive above the render loop rides its setup line
      fn: (pad) => this.emitLoopSetup(pad, node, anchorVar, iter, rec, keyExpr, itemVar, indexVar, hasRef, outer),
    });
    return anchorVar;
  }

  // `for` vars and render-local declarations anywhere in a subtree —
  // the auto-index collision set.
  static collectRenderBodyBindings(x, set) {
    if (!isNode(x)) return;
    if ((x[0] === 'for-in' || x[0] === 'for-of' || x[0] === 'for-as') && isNode(x[1])) {
      for (const v of x[1]) if (typeof v === 'string') set.add(v);
    } else if (x[0] === '=' && x.length === 3 && typeof x[1] === 'string') {
      set.add(x[1]);
    }
    for (const el of x) Emitter.collectRenderBodyBindings(el, set);
  }

  // The `key:` extraction (#126's compile half): the pair lives on the
  // FIRST renderable statement of the loop body — its direct attribute
  // objects or the injected children arrow's top-level objects (the
  // indented-attribute spelling). The pair is
  // SUPPRESSED (never mutated out of the tree — the node-id join needs its
  // subtree reachable) so it never emits: keys are reconcile
  // identities, never DOM attributes.
  extractLoopKey(body, loopNode) {
    const stmts = isBlock(body) ? body.slice(1) : [body];
    const first = stmts.find((s) => !this.isRenderBinding(s));
    if (!isNode(first)) return null;
    const scanObject = (obj) => {
      for (let i = 1; i < obj.length; i++) {
        const pair = obj[i];
        if (isNode(pair) && pair.length === 3 && pair[0] === ':' && pair[1] === 'key') {
          this.rstate.suppressedPairs.add(pair);
          return pair[2];
        }
      }
      return null;
    };
    for (const arg of first.slice(1)) {
      if (isObject(arg)) {
        const found = scanObject(arg);
        if (found !== null) return found;
      } else if (isFunc(arg) && isBlock(arg[2])) {
        for (const child of arg[2].slice(1)) {
          if (isObject(child)) {
            const found = scanObject(child);
            if (found !== null) return found;
          }
        }
      }
    }
    return null;
  }

  // The conditional swap block
  // block teardown on scope close rides an `__ownerFrame().add(…)`
  // disposer.
  emitCondSetup(pad, markNode, node, anchorVar, thenRec, elseRec, hasRef, outer) {
    const self = this.renderSelf ?? 'this';
    const outerExtra = outer.length > 0 ? `, ${outer.join(', ')}` : '';
    const p2 = pad + '  ';
    const p3 = p2 + '  ';
    // The swap's scaffold consts mint against every name the block
    // emits bare — the condition's reads and the threaded outer loop
    // variables. A loop variable named `anchor` or `show` must not be
    // captured by the scaffold (the fixed names render the wrong
    // branch or throw a TDZ ReferenceError).
    const used = new Set([self, ...outer]);
    Emitter.collectLeafNames(node[1], used);
    const anchor = Emitter.mintName('anchor', used);
    const cur = Emitter.mintName('currentBlock', used);
    const showing = Emitter.mintName('showing', used);
    const show = Emitter.mintName('show', used);
    const want = Emitter.mintName('want', used);
    const leaving = Emitter.mintName('leaving', used);
    const armLines = (rec) => {
      this.b.emit(`${p3}  ${cur} = ${self}.${rec.name}(${self}${outerExtra});\n`);
      this.b.emit(`${p3}  ${cur}.c();\n`);
      this.b.emit(`${p3}  if (${anchor}.parentNode) ${cur}.m(${anchor}.parentNode, ${anchor}.nextSibling);\n`);
      this.b.emit(`${p3}  ${cur}.p(${self}${outerExtra});\n`);
      this.b.emit(`${p3}  if (${cur}._t) __transition(${cur}._first, ${cur}._t, 'enter', undefined);\n`);
    };
    const emitBody = () => {
      this.b.emit(`${pad}{\n`);
      this.b.emit(`${p2}const ${anchor} = ${anchorVar};\n`);
      this.b.emit(`${p2}let ${cur}`);
      this.tsScaffoldAny();
      this.b.emit(' = null;\n');
      this.b.emit(`${p2}let ${showing}`);
      this.tsScaffoldAny();
      this.b.emit(' = null;\n');
      this.b.emit(`${p2}__effect(() => {\n`);
      // A dynamic ref inside a branch writes its cell in m(): batch
      // the whole swap so observers see only the final cell value.
      if (hasRef) this.b.emit(`${p3}__batch(() => {\n`);
      this.b.emit(`${p3}const ${show} = !!(`);
      // $self fallback: a SWITCH lowers through this path with
      // markNode = the switch node, which has no 'condition' role —
      // without the $self wrap the discriminant's diagnostics fall
      // through to the render-body cover and land lines away from
      // the author's statement (the statusz leak).
      this.mark(markNode, '$self', () => this.mark(markNode, 'condition', () => this.renderExpr(node[1])));
      this.b.emit(');\n');
      this.b.emit(`${p3}const ${want} = ${show} ? 'then' : ${elseRec !== null ? "'else'" : 'null'};\n`);
      this.b.emit(`${p3}if (${want} === ${showing}) return;\n`);
      this.b.emit(`${p3}if (${cur}) {\n`);
      this.b.emit(`${p3}  const ${leaving} = ${cur};\n`);
      this.b.emit(`${p3}  if (${leaving}._t) { __transition(${leaving}._first, ${leaving}._t, 'leave', () => ${leaving}.d(true)); }\n`);
      this.b.emit(`${p3}  else { ${leaving}.d(true); }\n`);
      this.b.emit(`${p3}  ${cur} = null;\n`);
      this.b.emit(`${p3}}\n`);
      this.b.emit(`${p3}${showing} = ${want};\n`);
      this.b.emit(`${p3}if (${want} === 'then') {\n`);
      armLines(thenRec);
      this.b.emit(`${p3}}\n`);
      if (elseRec !== null) {
        this.b.emit(`${p3}if (${want} === 'else') {\n`);
        armLines(elseRec);
        this.b.emit(`${p3}}\n`);
      }
      if (hasRef) this.b.emit(`${p3}});\n`);
      this.b.emit(`${p2}});\n`);
      this.b.emit(`${p2}__ownerFrame().add(() => { if (${cur}) { ${cur}.d(true); ${cur} = null; } });\n`);
      this.b.emit(`${pad}}\n`);
    };
    this.mark(markNode, '$self', emitBody);
  }

  // The loop reconcile block. `__s` holds the row state __reconcile
  // threads across runs; teardown destroys the live blocks on scope
  // close.
  emitLoopSetup(pad, node, anchorVar, iter, rec, keyExpr, itemVar, indexVar, hasRef, outer) {
    const self = this.renderSelf ?? 'this';
    const outerExtra = outer.length > 0 ? `, ${outer.join(', ')}` : '';
    const p2 = pad + '  ';
    const p3 = p2 + '  ';
    // The reconcile scaffold mints against the block's bare emissions:
    // the collection's and keyFn's reads, the loop's own variables
    // (keyFn params), and the threaded outer names.
    const used = new Set([self, itemVar, indexVar, ...outer]);
    Emitter.collectLeafNames(iter, used);
    if (keyExpr !== null) Emitter.collectLeafNames(keyExpr, used);
    const state = Emitter.mintName('__s', used);
    const each = Emitter.mintName('__b', used);
    this.mark(node, '$self', () => {
      this.b.emit(`${pad}{\n`);
      this.b.emit(`${p2}const ${state}`);
      this.tsScaffoldAny();
      this.b.emit(' = { blocks: [], keys: [] };\n');
      this.b.emit(`${p2}__effect(() => {\n`);
      this.b.emit(p3);
      if (hasRef) this.b.emit('__batch(() => ');
      this.b.emit(`__reconcile(${anchorVar}, ${state}, `);
      this.withExpression(() => this.expr(iter));
      this.b.emit(`, ${self}, ${self}.${rec.name}, `);
      if (keyExpr !== null) {
        this.b.emit(`(${itemVar}, ${indexVar}) => `);
        this.withBindings([itemVar, indexVar], () => this.withExpression(() => {
          const wrap = Emitter.needsGrouping(keyExpr, 'operand') || isObject(keyExpr);
          if (wrap) this.b.emit('(');
          this.expr(keyExpr);
          if (wrap) this.b.emit(')');
        }));
      } else {
        this.b.emit('null');
      }
      this.b.emit(`${outerExtra})`);
      if (hasRef) this.b.emit(')');
      this.b.emit(';\n');
      this.b.emit(`${p2}});\n`);
      this.b.emit(`${p2}__ownerFrame().add(() => { for (const ${each} of ${state}.blocks) { try { ${each}.d(true); } catch {} } ${state}.blocks = []; ${state}.keys = []; ${state}.items = []; });\n`);
      this.b.emit(`${pad}}\n`);
    });
  }

  // A block factory as a class method: `create_block_N(ctx, …)`
  // returning the runtime's handle. Effects created in p() land on a
  // fresh nested owner frame (disposed on the next patch and on d);
  // p() re-binds the factory params so create-phase closures track the
  // current row (without the re-bind, p-shadowing
  // would leave them stale). Refs write in m() after insertion and compare-and-clear in
  // d(detaching) — batched, so parent subscribers see one flush.
  emitFactory(rec, ind, renderNode) {
    const pad = '  '.repeat(ind + 1);
    const p2 = pad + '  ';
    const p3 = p2 + '  ';
    const p4 = p3 + '  ';
    const { self, frameVar, ownerVar } = rec;
    const headerParams = [self, ...rec.paramNames];
    const hasFrame = rec.setups.length > 0;
    // The p() re-bind params mint against everything the factory
    // binds or spells, the minted scaffold included — a body
    // referencing `__item` (a module binding) must not be captured.
    const used = new Set([...rec.bindings, ...rec.locals, ...rec.vars, self, frameVar, ownerVar]);
    if (rec.kidsVar !== null) used.add(rec.kidsVar);
    Emitter.collectLeafNames(rec.stmts, used);
    const pParams = [self, ...rec.paramNames.map((n) => Emitter.mintName(`__${n}`, used))];
    // The d() kids-unmount loop's binders.
    const kidC = rec.kidsVar !== null ? Emitter.mintName('__c', used) : null;
    const kidE = rec.kidsVar !== null ? Emitter.mintName('__e', used) : null;
    const needsP = !rec.isStatic;
    this.mark(renderNode, '$self', () => {
      this.withRecordContext(rec, () => {
        this.b.emit(`${pad}${rec.name}(${headerParams.join(', ')}) {\n`);
        if (rec.vars.size > 0) this.b.emit(`${p2}let ${[...rec.vars].join(', ')};\n`);
        if (rec.kidsVar !== null) {
          this.b.emit(`${p2}let ${rec.kidsVar}`);
          this.tsScaffoldAny('[]');
          this.b.emit(' = [];\n');
        }
        if (hasFrame) this.b.emit(`${p2}let ${frameVar};\n`);
        this.b.emit(`${p2}return {\n`);
        if (rec.isStatic) this.b.emit(`${p3}_s: true,\n`);
        // c(): build the block's nodes, detached.
        this.b.emit(`${p3}c() {\n`);
        this.replayCreates(rec, p4);
        const fragChildren = this.rstate.fragChildren.get(rec.root);
        const firstNode = fragChildren !== undefined ? fragChildren[0] : rec.root;
        // The handle's `_first`/`_t` slots write onto the object
        // literal from inside its own methods — the face casts `this`
        // (the literal's contextual type has only c/m/p/d; the slots
        // are the handle contract's, read as `any` everywhere else).
        this.b.emit(p4);
        if (this.ts) this.b.tsOnly(() => this.b.emit('('));
        this.b.emit('this');
        if (this.ts) this.b.tsOnly(() => this.b.emit(' as any)'));
        this.b.emit(`._first = ${firstNode};\n`);
        this.b.emit(`${p3}},\n`);
        // m(): insert before the anchor; dynamic refs write AFTER
        // insertion so no subscriber observes a detached node.
        this.b.emit(`${p3}m(target, anchor) {\n`);
        if (fragChildren !== undefined) {
          for (const child of fragChildren) {
            this.b.emit(`${p4}if (target) target.insertBefore(${child}, anchor);\n`);
          }
        } else {
          this.b.emit(`${p4}if (target) target.insertBefore(${rec.root}, anchor);\n`);
        }
        for (const r of rec.refs) {
          this.b.emit(p4);
          this.mark(r.node, '$self', () => this.b.emit(`${self}.${r.name}.value = ${r.elVar};`));
          this.b.emit('\n');
        }
        this.b.emit(`${p3}},\n`);
        // p(): re-bind the row, then dispose-and-recreate the patch
        // frame's effects under the owner push.
        this.b.emit(`${p3}p(${(needsP ? pParams : headerParams).join(', ')}) {\n`);
        if (needsP && rec.paramNames.length > 0) {
          this.b.emit(`${p4}${rec.paramNames.map((n, i) => `${n} = ${pParams[i + 1]};`).join(' ')}\n`);
        }
        if (hasFrame) {
          this.b.emit(`${p4}if (${frameVar}) ${frameVar}.dispose();\n`);
          this.b.emit(`${p4}const ${ownerVar} = __pushOwner(${frameVar} = __ownerFrame());\n`);
          this.b.emit(`${p4}try {\n`);
          this.replaySetups(rec, p4 + '  ');
          this.b.emit(`${p4}} finally { __popOwner(${ownerVar}); }\n`);
        }
        this.b.emit(`${p3}},\n`);
        // d(): child components unmount FIRST (the order — the child
        // cascade runs while the block's effects are still live),
        // effects die with the frame, refs clear (real destroys only
        // — a keyed move re-inserts through m() without d()), the DOM
        // detaches.
        this.b.emit(`${p3}d(detaching) {\n`);
        if (rec.kidsVar !== null) {
          this.b.emit(`${p4}for (const ${kidC} of ${rec.kidsVar}) { try { ${kidC}.unmount?.({removeDOM: detaching}); } catch (${kidE}) { console.error('[Rip] factory child unmount error:', ${kidE}); } }\n`);
          this.b.emit(`${p4}${rec.kidsVar} = [];\n`);
        }
        if (hasFrame) this.b.emit(`${p4}if (${frameVar}) { ${frameVar}.dispose(); ${frameVar} = null; }\n`);
        if (rec.refs.length > 0) {
          this.b.emit(`${p4}if (detaching) __batch(() => {\n`);
          for (const r of rec.refs) {
            this.b.emit(`${p4}  __detachRef(${self}.${r.name}, ${r.elVar});\n`);
          }
          this.b.emit(`${p4}});\n`);
        }
        if (fragChildren !== undefined) {
          for (const child of fragChildren) {
            this.b.emit(`${p4}if (detaching) __detach(${child});\n`);
          }
        } else {
          this.b.emit(`${p4}if (detaching) __detach(${rec.root});\n`);
        }
        this.b.emit(`${p3}}\n`);
        this.b.emit(`${p2}};\n`);
        this.b.emit(`${pad}}\n`);
      });
    });
  }

  // A transition directive (`~name` → `__transition__: "name"`): legal
  // exactly where a working enter/leave phase exists — the FIRST
  // top-level element of a conditional branch, whose node is the
  // block's _first (what the swap's __transition calls animate). The
  // #129 posture: loud or working, never inert.
  renderTransition(el, pair, value, objExpr) {
    const R = this.rstate;
    const slot = R.transitionSlot;
    if (slot === null || slot.record !== R.sink || slot.el !== el) {
      const where = R.sink.kind === 'class'
        ? 'a static element)'
        : R.sink.kind === 'loop'
          ? 'a loop body — the reconciler has no enter/leave phase for rows'
          : "a nested position — the swap animates the branch's FIRST node, so a deeper directive would animate an " +
            'element it does not name';
      throw this.positionedError(pair,
        `emitter: a transition (\`~name\`) runs where a conditional branch enters or leaves, and this directive sits on ${where}; ` +
        'put it on the FIRST top-level element of an if/else branch', this.rstate.node);
    }
    if (typeof value !== 'string' || !(value.startsWith('"') || value.startsWith("'"))) {
      throw this.positionedError(pair,
        'emitter: a transition takes a literal name (`~fade`) — computed transition names have no reading', this.rstate.node);
    }
    const name = value.replace(/^["']|["']$/g, '');
    this.renderLine(pair, () => {
      // The handle-slot write's face cast (the `_first` twin above).
      if (this.ts) this.b.tsOnly(() => this.b.emit('('));
      this.b.emit('this');
      if (this.ts) this.b.tsOnly(() => this.b.emit(' as any)'));
      this.b.emit(`._t = "${name}"`);
    });
  }

  // `ref: cell` — bind the live element into a WRITABLE state cell
  // (the signal object, never its .value): the validation and
  // messages. Static refs write in _create (the subtree is connected
  // before any effect first runs — glitch-free) and clear through
  // _refCleanups on unmount; dynamic refs ride the factory's m()/d().
  renderRef(el, pair, value, objExpr) {
    const refName = typeof value === 'string' && RENDER_LOCAL_RE.test(value) ? value : null;
    if (refName === null) {
      throw this.positionedError(pair,
        'emitter: ref: expects a state cell — declare `el := null` then write `ref: el`', this.rstate.node);
    }
    const kind = this.rstate.frame.members.get(refName);
    if (kind !== 'state' && kind !== 'prop') {
      throw this.positionedError(pair, kind !== undefined
        ? `emitter: ref: target '${refName}' is not a writable state cell — declare it with ':=' (computed '~=' and ` +
          "readonly '=!' members can't hold a ref)"
        : `emitter: ref: target '${refName}' must be a state cell declared with ':=' (e.g. \`${refName} := null\`)`,
        this.rstate.node);
    }
    if (this.rstate.sink.kind === 'class') {
      this.renderLine(pair, () => {
        this.b.emit(`this.${refName}.value = ${el}`);
        // Ref typing: the scaffold's _el fields are
        // any (the slot index signature), so the assignment casts
        // TS-only to the element's REAL tag type — and `| null`,
        // because teardown writes null (a non-nullable annotated cell
        // must reject taking a ref at all).
        const tag = this.renderTagOf(el);
        if (this.ts && tag !== null && /^[a-z][a-z0-9-]*$/.test(tag)) {
          const map = SVG_TAGS.has(tag) ? 'SVGElementTagNameMap' : 'HTMLElementTagNameMap';
          this.b.tsOnly(() => this.b.emit(` as ${map}['${tag}'] | null`));
        }
      });
      this.renderLine(pair, () => this.b.emit(`(this._refCleanups ??= []).push(() => __detachRef(this.${refName}, ${el}))`));
    } else {
      this.rstate.sink.refs.push({ name: refName, elVar: el, node: pair });
    }
  }

  // Two-way binding (`value <=> target` → `__bind_value__: target`):
  // one effect pushes container → element, one listener pushes
  // element → container. the event/accessor matrix: checked binds on
  // change via e.target.checked; number/range inputs read
  // valueAsNumber; everything else (text, textarea, select) binds on
  // input via e.target.value. Chain targets notify their root
  // container with `.touch?.()` (a nested write changes no container
  // identity).
  renderBind(el, pair, prop, value, objExpr) {
    this.checkBindTarget(pair, value);
    if (this.rstate.sink.kind === 'loop' && this.loopVarNames().size > 0 && referencesNames(value, this.loopVarNames())) {
      this.rstate.sink.forceNonStatic = true;
    }
    let inputType = null;
    for (const p of objExpr.slice(1)) {
      if (isNode(p) && p.length === 3 && (p[1] === 'type' || p[1] === '"type"') && typeof p[2] === 'string') {
        inputType = p[2].replace(/^["']|["']$/g, '');
      }
    }
    let event, accessor;
    if (prop === 'checked') {
      event = 'change';
      accessor = 'target.checked';
    } else {
      event = 'input';
      accessor = inputType === 'number' || inputType === 'range' ? 'target.valueAsNumber' : 'target.value';
    }
    this.renderEffect(pair, () => {
      this.b.emit(`${el}.${prop} = `);
      this.withExpression(() => this.expr(value));
      this.b.emit(';');
    }, value);
    const touch = this.bindRootTouch(value);
    // The listener's event param mints against the target's reads
    const evUsed = new Set();
    Emitter.collectLeafNames(value, evUsed);
    const ev = Emitter.mintName('e', evUsed);
    this.renderLine(pair, () => {
      this.b.emit(`${el}.addEventListener('${event}', (${ev}) => { `);
      this.withExpression(() => this.expr(value));
      this.b.emit(` = ${ev}.${accessor};`);
      if (touch !== null) {
        this.b.emit(' ');
        touch();
        this.b.emit('.touch?.();');
      }
      this.b.emit(' })');
    });
  }

  // The bind target's loudness fork: the target must be ASSIGNABLE and
  // reactive-rooted where a container exists.
  checkBindTarget(pair, value) {
    const reject = (msg) => {
      throw this.positionedError(pair, msg, this.rstate.node);
    };
    if (typeof value === 'string') {
      if (!RENDER_LOCAL_RE.test(value)) {
        reject('emitter: a two-way binding (`<=>`) needs an assignable target — a literal cannot receive the input');
      }
      const kind = this.renderVarKind(value, pair);
      if (kind !== null) {
        reject(`emitter: a two-way binding cannot target a ${kind === 'local' ? 'render local' : 'loop variable'} — ` +
          'the write would land on a factory parameter and reach nothing; bind a state member or a chain into row data');
      }
      const r = this.resolveBareRead(value);
      if (r === 'member-reactive' && this.rstate.frame.members.get(value) === 'computed') {
        reject(`emitter: '<=>' targets '${value}', a computed ('~=') member — a derived value has no writable ` +
          "container (its .value is get-only); bind the state it derives from");
      }
      if (r === 'reactive' || r === 'member-reactive') return;
      if (r === 'member') {
        reject(`emitter: '<=>' targets '${value}', a plain (\`=\`) member — writes would never notify and the display ` +
          "would never update; declare it with ':='");
      }
      reject(`emitter: '<=>' targets '${value}', which is not declared — declare a state member (\`${value} := ""\`) to bind it`);
    }
    if (isNode(value) && value[0] === '.' && value[1] === 'this' && value.length === 3 && typeof value[2] === 'string') {
      if (this.memberIsReactive(value[2]) && this.rstate.frame.members.get(value[2]) === 'computed') {
        reject(`emitter: '<=>' targets '@${value[2]}', a computed ('~=') member — a derived value has no writable ` +
          'container; bind the state it derives from');
      }
      if (this.memberIsReactive(value[2])) return;
      if (this.rstate.frame.members.has(value[2])) {
        reject(`emitter: '<=>' targets '@${value[2]}', a non-reactive member — writes would never notify` +
          "); declare it with ':='");
      }
      reject(`emitter: '<=>' targets '@${value[2]}', which is not a declared member`);
    }
    if (isNode(value) && Emitter.optionalGuard(value) !== null) {
      reject('emitter: a two-way binding target cannot carry optional links — the write form would be invalid JS');
    }
    let n = value;
    let isChain = false;
    while (isNode(n) && (n[0] === '.' || n[0] === '[]') && n.length === 3) {
      isChain = true;
      n = n[1];
    }
    if (isChain) return;
    reject('emitter: a two-way binding (`<=>`) needs an assignable target — a state member or a member/index chain ' +
      '');
  }

  // The root container a chain-target bind notifies: a reactive
  // member (`this.history…`) or a module reactive name. Simple
  // targets notify through their own container write — no touch.
  bindRootTouch(value) {
    if (typeof value === 'string') return null;
    if (isNode(value) && value[0] === '.' && value[1] === 'this' && value.length === 3) return null;
    let n = value;
    while (isNode(n) && (n[0] === '.' || n[0] === '[]') && n.length === 3) {
      if (n[0] === '.' && n[1] === 'this' && typeof n[2] === 'string') {
        const name = n[2];
        if (this.memberIsReactive(name)) return () => this.b.emit(`${this.renderSelf ?? 'this'}.${name}`);
        return null;
      }
      n = n[1];
    }
    if (typeof n === 'string') {
      if (this.renderVarKind(n) !== null) return null;
      const r = this.resolveBareRead(n);
      if (r === 'member-reactive') {
        const name = n;
        return () => this.b.emit(`${this.renderSelf ?? 'this'}.${name}`);
      }
      if (r === 'reactive') {
        const name = n;
        return () => this.b.emit(name);
      }
    }
    return null;
  }

  // A user-SPELLED `__bind_x__:` key rejects — the key is the
  // compiler's channel for the `<=>` rewrite. The rewrite renames the
  // LHS token IN PLACE, so a minted key's recorded span still spells
  // the user's own word; a key span that spells `__bind_` was typed
  // by the user (the `__`-namespace posture; 
  // round, item 5 — completions scrub the namespace, so accepting the
  // spelled form would be an invisible second spelling).
  checkUserSpelledBind(pair) {
    const id = isNode(pair) ? this.stores.idOf(pair) : null;
    const row = id !== null ? this.stores.role(id, 'key') : null;
    if (!row || row.sourceStart == null || this.b.source === null) return;
    if (this.b.source.slice(row.sourceStart, row.sourceEnd).startsWith('__bind_')) {
      throw this.positionedError(pair,
        "emitter: '__bind_…__:' is the compiler's two-way-binding channel — spell the binding `name <=> container` " +
        '(`__`-prefixed names are the compiler/runtime namespace)', this.rstate.node);
    }
  }

  // Bare `@click` shorthand validation (the known-vocabulary fork):
  // ONLY the rewriter-minted handler pairs validate — their tokens are
  // zero-width (generated), so the value member's store span is empty.
  // Explicit `@name: handler` bindings stay unvalidated (custom events
  // are legal DOM); typo intelligence there is the face's.
  checkBareEventHandler(pair, value) {
    if (!isNode(value) || value[0] !== '.' || value[1] !== 'this' || typeof value[2] !== 'string') return;
    const id = this.stores.idOf(value);
    const span = id !== null ? this.stores.selfSpan(id) : null;
    if (span === null || span[0] !== span[1]) return; // real source → explicit binding
    const key = pair[1];
    const ev = typeof key[2] === 'string' ? key[2] : String(key[2]);
    if (!DOM_EVENTS.has(ev)) {
      throw this.positionedError(pair,
        `emitter: \`@${ev}\` is not a DOM event — use \`= @${ev}\` to render text, or \`@${ev}: handler\` for an explicit handler`);
    }
    if (ev === 'error') {
      throw this.positionedError(pair,
        'emitter: bare `@error` is ambiguous with the onError lifecycle hook — write `@error: handler` to bind a DOM error listener explicitly');
    }
    const method = value[2];
    if (!this.cframes[this.cframes.length - 1].members.has(method)) {
      throw this.positionedError(pair,
        `emitter: bare \`@${ev}\` requires a component method \`${method}\` — define \`${method}\`, or use \`@${ev}: handler\` for an explicit handler`);
    }
  }

  // Tag + static classes + id from a dot-chain
  // (`[".", [".", "div", "card"], "active"]`). A `#id` merged into a
  // CLASS segment splits back out (leaving it inside the class
  // string would be broken markup).
  static collectTemplateClasses(sexpr) {
    const classes = [];
    let id;
    let current = sexpr;
    while (isNode(current) && current[0] === '.' && current.length === 3) {
      if (typeof current[2] !== 'string') return { tag: null, classes, id };
      classes.unshift(current[2]);
      current = current[1];
    }
    if (typeof current !== 'string') return { tag: null, classes, id };
    let [tag, tagId] = current.split('#');
    if (tagId) id = tagId;
    for (let i = 0; i < classes.length; i++) {
      const hash = classes[i].indexOf('#');
      if (hash >= 0) {
        id = classes[i].slice(hash + 1);
        classes[i] = classes[i].slice(0, hash);
      }
    }
    return { tag: tag || 'div', classes: classes.filter((c) => c !== ''), id };
  }

  // ── Accessor/call chains — iterative spine emission ────────────────
  // member/index/optindex/optcall/call all recurse through their HEAD
  // child (object/callee), and long chains (`a.b().c().d()…`) are
  // depth-N trees of exactly these kinds — ordinary code makes them
  // deep, so the descent is a LOOP (the nesting rule: the expr() nesting
  // bound never rejects a flat chain). Every chain kind is 'primary'
  // tier — head position never groups it — so the spine emits with no
  // parens and the begin/tail phases reproduce the recursive bytes,
  // mark order, and inTarget/deopt state transitions exactly.

  static chainHeadSlot(x) {
    if ((x[0] === '.' || x[0] === '?.' || x[0] === '[]' || x[0] === 'optindex') && x.length === 3) return 1;
    if (x[0] === 'optcall') return 1;
    // A node-headed node is a call (expr dispatches it to call());
    // dammit callees keep their inline path — never a spine frame.
    if (isNode(x[0]) && x[0][0] !== 'dammit!') return 0;
    return null;
  }

  static isChainNode(x) {
    return isNode(x) && Emitter.chainHeadSlot(x) !== null;
  }

  chain(node) {
    const spine = [node];
    while (true) {
      const cur = spine[spine.length - 1];
      const child = cur[Emitter.chainHeadSlot(cur)];
      if (!Emitter.isChainNode(child)) break;
      spine.push(child);
    }
    const frames = [];
    // Begin phase, outermost → innermost: open $self, run the checks
    // and state saves each kind performs before its head child, and
    // open the head-role mark (spine children never group — primary
    // tier). The innermost frame emits its head child through the
    // ordinary head() path instead (terminals group normally there).
    for (let j = 0; j < spine.length; j++) {
      const n = spine[j];
      const head = n[0];
      const isInner = j === spine.length - 1;
      const f = { role: false };
      frames.push(f);
      if (head === '.' || head === '?.') {
        // `super.prop` has no home outside a class method — reject
        // loudly (emitted blindly it is invalid JS at top level).
        if (n[1] === 'super' && !this.methodName) {
          throw this.positionedError(n, 'emitter: super outside a class method');
        }
        f.self = this.beginMark(n, '$self');
        // Only the OUTERMOST accessor is the write position — the
        // object spine below it is a read (`a[-1].b = 5` reads
        // `a.at(-1)`).
        f.savedTarget = this.inTarget;
        this.inTarget = false;
        if (isInner) this.head(n, 'object', n[1]);
        else f.role = this.beginMark(n, 'object');
      } else if (head === '[]' || head === 'optindex') {
        // isWrite reads the state BEFORE this accessor clears it;
        // the optional spelling latches the deopt state at entry
        // (emitKey toggles deopt only inside its own save/restore).
        f.isWrite = this.inTarget || this.inPattern;
        f.opt = head === 'optindex' && !this.deopt;
        f.self = this.beginMark(n, '$self');
        f.savedTarget = this.inTarget;
        this.inTarget = false;
        if (isInner) this.head(n, 'object', n[1]);
        else f.role = this.beginMark(n, 'object');
      } else if (head === 'optcall') {
        f.self = this.beginMark(n, '$self');
        if (isInner) this.head(n, 'callee', n[1]);
        else f.role = this.beginMark(n, 'callee');
      } else {
        // A plain call ([callee, ...args]).
        f.self = this.beginMark(n, '$self');
        if (isInner) this.head(n, 'callee', n[0]);
        else f.role = this.beginMark(n, 'callee');
      }
    }
    // Tail phase, innermost → outermost.
    for (let j = spine.length - 1; j >= 0; j--) {
      const n = spine[j];
      const head = n[0];
      const f = frames[j];
      this.endMark(f.role);
      if (head === '.' || head === '?.') {
        this.inTarget = f.savedTarget;
        const op = this.deopt && head === '?.' ? '.' : head;
        this.mark(n, 'operator', () => this.b.emit(op));
        this.mark(n, 'property', () => this.b.emit(n[2]));
        // Component scope: `@member` (this.member) reads and writes
        // its signal's `.value` when the member is reactive — chains
        // read through the unwrap (`@user.name` → this.user.value.name).
        if (n[1] === 'this' && typeof n[2] === 'string' && this.memberIsReactive(n[2])) {
          this.b.emit('.value');
        }
      } else if (head === '[]' || head === 'optindex') {
        this.indexTail(n, f.opt, f.isWrite);
        this.inTarget = f.savedTarget;
      } else if (head === 'optcall') {
        this.b.emit('?.');
        this.mark(n, 'args', () => {
          this.b.emit('(');
          n.slice(2).forEach((arg, i) => {
            if (i > 0) this.b.emit(', ');
            // Optional-call arguments do NOT unwrap a pick's parens:
            // `h?.(({a: o.a}))` — the double parens are valid JS and
            // the byte battery pins the spelling.
            this.expr(arg);
          });
          this.b.emit(')');
        });
      } else {
        this.mark(n, 'args', () => {
          this.b.emit('(');
          n.slice(1).forEach((arg, i) => {
            if (i > 0) this.b.emit(', ');
            this.callArg(arg);
          });
          this.b.emit(')');
        });
      }
      this.endMark(f.self);
    }
  }

  member(node) {
    this.chain(node);
  }

  // ['.{}'|'?.{}', source, ...items] — the pick operator:
  // `o.{a, b: c, d = e}` lowers to an always-parenthesized object
  // literal reading the source per key —
  // `({a: o.a, c: o.b, d: (o.d ?? e)})`. Defaults fire on NULLISH
  // (`??` — deliberately broader than JS destructuring's
  // undefined-only) and group as operands. A SIMPLE source (a bare
  // name or `this`) reads inline per key; every other source
  // evaluates ONCE through a `(_) =>` IIFE (getters and reactive
  // tracking observe each read). The optional head short-circuits a
  // nullish source to `undefined`. The target/pattern and
  // IIFE-crossing forms reject.
  // `bare` strips the self-parenthesization in CALL-ARGUMENT position
  // (`f(o.{a})` → `f({a: o.a})` — the byte batteries pin the shape);
  // the single-evaluation IIFE has no strippable outer parens.
  pick(node, bare = false) {
    const [head, source, ...items] = node;
    if (this.inPattern || this.inTarget) {
      throw this.positionedError(node, 'emitter: a pick expression is not an assignment target — it lowers to a fresh object literal (`({…}) = value` would be invalid JS)');
    }
    const optional = head === '?.{}';
    const simple = typeof source === 'string' && (source === 'this' || /^[A-Za-z_$][\w$]*$/.test(source));
    // A complex source binds `_` in a plain arrow — awaits and yields
    // in defaults cannot cross it (inside the arrow they are invalid
    // JS both ways).
    if (!simple) {
      for (const item of items) {
        if (item[2] !== null && Emitter.containsAwait(item[2])) {
          throw this.positionedError(item, "emitter: a pick default cannot await when the source needs single evaluation — the lowering's '(_) =>' arrow is not async; bind the source first", node);
        }
        if (item[2] !== null && Emitter.containsYield(item[2])) {
          throw this.positionedError(item, "emitter: a pick default cannot yield when the source needs single evaluation — yield cannot cross the lowering's '(_) =>' arrow; bind the source first", node);
        }
      }
    }
    const body = (emitRef) => this.mark(node, 'items', () => {
      items.forEach((item, i) => {
        if (i > 0) this.b.emit(', ');
        const [srcKey, dstKey, def] = item;
        this.mark(item, '$self', () => {
          this.mark(item, 'target', () => this.b.emit(dstKey));
          this.b.emit(': ');
          if (def !== null) this.b.emit('(');
          emitRef();
          this.b.emit('.');
          this.mark(item, 'key', () => this.b.emit(srcKey));
          if (def !== null) {
            this.b.emit(' ?? ');
            this.withExpression(() => this.operand(item, 'default', def));
            this.b.emit(')');
          }
        });
      });
    });
    this.mark(node, '$self', () => {
      if (simple && !optional) {
        this.b.emit(bare ? '{' : '({');
        body(() => this.mark(node, 'source', () => this.expr(source)));
        this.b.emit(bare ? '}' : '})');
      } else if (simple) {
        if (!bare) this.b.emit('(');
        this.mark(node, 'source', () => this.expr(source));
        this.b.emit(' == null ? undefined : {');
        body(() => this.expr(source));
        this.b.emit(bare ? '}' : '})');
      } else {
        // The IIFE argument is an operand position: compound sources
        // group (`((a || b))`).
        this.b.emit(optional ? '((_) => _ == null ? undefined : ({' : '((_) => ({');
        body(() => this.b.emit('_'));
        this.b.emit('}))(');
        this.withExpression(() => this.grouped(node, 'source', source, Emitter.needsGrouping(source, 'operand')));
        this.b.emit(')');
      }
    });
  }

  // One call argument: picks emit bare (the `bare` stripping above);
  // everything else is a plain expression.
  callArg(arg) {
    if (isNode(arg) && (arg[0] === '.{}' || arg[0] === '?.{}') && arg.length >= 3) return this.pick(arg, true);
    this.expr(arg);
  }

  // Binary emission is ITERATIVE over the left spine: a flat
  // left-associative chain (`a1 + a2 + … + aN`, concat runs,
  // comparison chains) is a depth-N tree, and emitting it
  // recursively would spend native stack on exactly the shape
  // ordinary programs make deep — the expr() nesting bound must
  // never reject it. A binary LEFT child always groups in
  // operand position, so each spine level contributes one paren
  // pair and the begin/tail loops reproduce the recursive bytes
  // and mark order exactly.
  //
  // Two operator families leave this generic path: `&&`/`||` runs
  // emit FLAT (`a && b && c` — same-operator logical trees are one
  // associative program), and comparison chains LOWER to
  // conjunctions. The spine walk stops where those emitters
  // take over, so their nodes route through expr() dispatch as
  // ordinary grouped operands.
  binary(node) {
    if (node[0] === '&&' || node[0] === '||') return this.logicalChain(node);
    if (isChainLink(node)) return this.comparisonChain(node);
    const extendsSpine = (x) => isBinary(x) && x[0] !== '&&' && x[0] !== '||' && !isChainLink(x);
    const spine = [node];
    while (extendsSpine(spine[spine.length - 1][1])) spine.push(spine[spine.length - 1][1]);
    const frames = [];
    for (let j = 0; j < spine.length; j++) {
      const n = spine[j];
      const f = { self: this.beginMark(n, '$self'), left: false };
      frames.push(f);
      if (j < spine.length - 1) {
        this.b.emit('(');
        f.left = this.beginMark(n, 'left');
      }
    }
    const inner = spine[spine.length - 1];
    this.operand(inner, 'left', inner[1]);
    for (let j = spine.length - 1; j >= 0; j--) {
      const n = spine[j];
      this.b.emit(' ');
      this.mark(n, 'operator', () => this.b.emit(JS_OP[n[0]] ?? n[0]));
      this.b.emit(' ');
      this.operand(n, 'right', n[2]);
      this.endMark(frames[j].self);
      if (j > 0) {
        this.endMark(frames[j - 1].left);
        this.b.emit(')');
      }
    }
  }

  // A same-operator `&&`/`||` run emits FLAT — `a && b && c`, no
  // grouping between links, the whole same-head tree collapsed,
  // explicit parens included: `(a and b) and c` and `a and (b and
  // c)` are the same associative program. Different-operator
  // children group as ordinary operands (`(a && b) || c`); `??`
  // never flattens — its pairs stay grouped. Iterative over the
  // left spine like binary(); a same-head RIGHT child (explicit
  // parens only, so never deep) flattens through expr() dispatch
  // with the grouping suppressed.
  logicalChain(node) {
    const op = node[0];
    const sameOp = (x) => isBinary(x) && x[0] === op;
    const spine = [node];
    while (sameOp(spine[spine.length - 1][1])) spine.push(spine[spine.length - 1][1]);
    const frames = [];
    for (let j = 0; j < spine.length; j++) {
      const n = spine[j];
      frames.push({
        self: this.beginMark(n, '$self'),
        left: j < spine.length - 1 ? this.beginMark(n, 'left') : false,
      });
    }
    const inner = spine[spine.length - 1];
    this.operand(inner, 'left', inner[1]);
    for (let j = spine.length - 1; j >= 0; j--) {
      const n = spine[j];
      this.b.emit(' ');
      this.mark(n, 'operator', () => this.b.emit(op));
      this.b.emit(' ');
      if (sameOp(n[2])) this.grouped(n, 'right', n[2], false);
      else this.operand(n, 'right', n[2]);
      this.endMark(frames[j].self);
      if (j > 0) this.endMark(frames[j - 1].left);
    }
  }

  // The chained-comparison lowering: every link whose left
  // child is an unparenthesized comparison becomes a conjunction
  // sharing the middle operand — `a < b < c` emits
  // `(a < b) && (b < c)`, longer chains nest left like any `&&`
  // spine (`((a < b) && (b < c)) && (c < d)`). The shared middle
  // operand evaluates ONCE: an atom (identifier, literal) re-emits
  // verbatim — nothing user-visible can run between the two reads —
  // while a node mid caches (ANY compound: re-evaluation is
  // observable down to valueOf/toString coercion), assigning a
  // hoisted temp at its original position; the next conjunct reads
  // the temp (`(a < (_ref = f(b))) && (_ref < c)`).
  // Marks: each link's $self covers its whole accumulated
  // conjunction; the mid's re-emission (temp read included)
  // re-marks the PREVIOUS link's `right` role — the §4.1
  // one-to-many precedent; the synthesized `&&`s and parens sit
  // between role marks as parent syntax.
  comparisonChain(node) {
    // links[0] compares the chain's first two operands; each later
    // link shares its predecessor's right operand as its mid.
    const links = [node];
    while (isChainLink(links[links.length - 1])) links.push(links[links.length - 1][1]);
    links.reverse();
    const frames = [];
    for (let k = links.length - 1; k >= 1; k--) {
      const n = links[k];
      const self = this.beginMark(n, '$self');
      this.b.emit('(');
      frames[k] = { self, left: this.beginMark(n, 'left') };
    }
    const first = links[0];
    const s0 = this.beginMark(first, '$self');
    this.operand(first, 'left', first[1]);
    this.b.emit(' ');
    this.mark(first, 'operator', () => this.b.emit(JS_OP[first[0]] ?? first[0]));
    this.b.emit(' ');
    this.chainRight(first, links[1]);
    this.endMark(s0);
    for (let k = 1; k < links.length; k++) {
      const n = links[k];
      this.endMark(frames[k].left);
      this.b.emit(') && (');
      this.chainMid(links[k - 1], n);
      this.b.emit(' ');
      this.mark(n, 'operator', () => this.b.emit(JS_OP[n[0]] ?? n[0]));
      this.b.emit(' ');
      this.chainRight(n, links[k + 1]);
      this.b.emit(')');
      this.endMark(frames[k].self);
    }
  }

  // A link's right operand. When a FOLLOWING link shares it as mid
  // and it is a node, it emits as the temp assignment (`(_ref =
  // expr)` — the value flows through, so the comparison reads the
  // same result); otherwise a plain operand.
  chainRight(link, nextLink) {
    const rhs = link[2];
    if (nextLink !== undefined && isNode(rhs)) {
      const temp = this.temps.byNode.get(nextLink);
      if (temp === undefined) {
        // The hoist walks skip this position (a param default, a
        // loop-variable default) — no let line exists to host the
        // temp, and emitting the operand twice is the silent double
        // evaluation the lowering forbids.
        throw this.positionedError(rhs,
          'emitter: a chained comparison here cannot cache its middle operand for single evaluation ' +
          '(no enclosing scope hoist) — bind the middle operand to a variable first ' +
          '', link);
      }
      this.b.emit('(');
      this.mark(link, 'right', () => {
        this.b.emit(`${temp} = `);
        this.expr(rhs);
      });
      this.b.emit(')');
      return;
    }
    this.operand(link, 'right', rhs);
  }

  // A conjunct's left slot: the SECOND manifestation of the previous
  // link's right operand — the cached temp when one exists, the
  // re-emitted atom otherwise.
  chainMid(prevLink, link) {
    const temp = this.temps.byNode.get(link);
    if (temp !== undefined) {
      this.mark(prevLink, 'right', () => this.b.emit(temp));
      return;
    }
    this.operand(prevLink, 'right', prevLink[2]);
  }

  // ["cast", value, "T"] — the postfix `expr as Type` cast. JS mode
  // ERASES it: the value alone emits, transparently (grouping reads
  // through to the value's tier), and the annotation role's cover row
  // spans the emitted value — the type's only generated manifestation
  //; $self is a cover over the same extent (the emitted slice
  // never equals the source, which still spells `as T`).
  //
  // The TS face spells the cast: `(value as T)`, every added
  // byte TS-only, so the editor sees the assertion (hover/narrowing)
  // and stripping restores the bare value. The parens are structural,
  // not cosmetic — TS's `as` sits at relational precedence, so a bare
  // spelling rebinds in exactly the positions where JS-mode grouping
  // (which reads THROUGH the cast) adds nothing: member/call heads
  // (`x.foo` must face as `(x as T).foo`) and type texts ending in a
  // bare name before `<` (`a as T < b` would parse `T<b>` as type
  // arguments). A non-primary value takes its own TS-only parens —
  // `as` binds tighter than logical/ternary/assignment forms whose
  // JS-mode bytes emit bare here (`(a && b) as T`, never
  // `a && b as T`, which TS reads as `a && (b as T)`).
  cast(node) {
    if (!this.ts) {
      this.mark(node, '$self', () =>
        this.mark(node, 'annotation', () =>
          this.mark(node, 'value', () => this.expr(node[1]))));
      return;
    }
    // The recorded source spelling (`as T`, the CAST token's span) —
    // byte-equal emission lets the builder classify the annotation
    // row exact, the mapping contract's spelling at exact positions.
    const id = this.stores.idOf(node);
    const row = id === null ? null : this.stores.role(id, 'annotation');
    const spelled = row && row.sourceStart != null && this.b.source !== null
      ? this.b.source.slice(row.sourceStart, row.sourceEnd)
      : `as ${tidyType(node[2])}`;
    this.mark(node, '$self', () => {
      this.b.tsOnly(() => this.b.emit('('));
      const wrapValue = Emitter.jsTier(node[1]) !== 'primary';
      if (wrapValue) this.b.tsOnly(() => this.b.emit('('));
      this.mark(node, 'value', () => this.expr(node[1]));
      if (wrapValue) this.b.tsOnly(() => this.b.emit(')'));
      this.b.tsOnly(() => {
        this.b.emit(' ');
        this.mark(node, 'annotation', () => this.b.emit(spelled));
      });
      this.b.tsOnly(() => this.b.emit(')'));
    });
  }

  // Postfix existence: `expr?` lowers to `expr != null` — one loose
  // comparison covers both null and undefined.
  existence(node) {
    this.mark(node, '$self', () => {
      this.operand(node, 'value', node[1]);
      this.b.emit(' != null');
    });
  }

  // Postfix presence: `expr?!` lowers to `expr ? true : undefined` —
  // truthy yields true, anything falsy yields undefined (the Houdini
  // operator). The value evaluates exactly once.
  presence(node) {
    this.mark(node, '$self', () => {
      this.operand(node, 'value', node[1]);
      this.b.emit(' ? true : undefined');
    });
  }

  unary(node) {
    // `delete` on a bare REACTIVE name is its own rejection class —
    // no reading exists for it at all
    if (node[0] === 'delete' && typeof node[1] === 'string' && this.isReactiveName(node[1])) {
      throw this.positionedError(node, `emitter: cannot delete the reactive variable '${node[1]}' — \`delete ${node[1]}.value\` would remove the container's accessor and silently kill the reactive`);
    }
    // `delete` is only valid on a property reference: strict mode (all
    // ES modules) makes `delete x` on a plain binding a load-time
    // SyntaxError — reject
    // at the layer where the target shape is knowable.
    if (node[0] === 'delete' && !(isNode(node[1]) && (node[1][0] === '.' || node[1][0] === '[]'))) {
      throw this.positionedError(node, "emitter: delete requires a property reference (delete obj.a / delete obj[k]) — deleting a plain binding is a strict-mode SyntaxError in modules");
    }
    this.mark(node, '$self', () => {
      this.mark(node, 'operator', () => this.b.emit(node[0]));
      // Word operators need the separating space (`typeof x`,
      // `delete a.b`); symbols bind directly (`!x`, `-y`).
      if (/^[a-z]/.test(node[0])) this.b.emit(' ');
      this.operand(node, 'operand', node[1]);
    });
  }

  // ["...", value] — an ES spread/rest element (calls, arrays,
  // patterns). Valid only where JS accepts it; the surrounding
  // construct owns that context. The operand is an operand position
  // (`[...(a || b)]` groups); pattern payloads are plain names and
  // never group.
  spread(node) {
    this.mark(node, '$self', () => {
      this.b.emit('...');
      if (this.inPattern) this.mark(node, 'value', () => this.expr(node[1]));
      else this.operand(node, 'value', node[1]);
    });
  }

  // ["array", ...items] — an elision lands in the sexpr as a bare ","
  // string; it emits as an empty slot between commas.
  array(node) {
    this.mark(node, '$self', () => {
      this.b.emit('[');
      this.mark(node, 'items', () => {
        const items = node.slice(1);
        items.forEach((item, i) => {
          if (i > 0) this.b.emit(', ');
          if (item === ',') {
            // A TRAILING elision needs its own comma to survive: JS
            // ignores one trailing comma, so `[1, 2, ]` has no final
            // hole where the source `[1, 2,,]` does. Interior
            // elisions are carried by the separators alone.
            if (i === items.length - 1) this.b.emit(',');
            return;
          }
          // The `rest x` sugar: in a BINDING pattern a rest-headed
          // element is a rest element and lowers to `...x`
          // (`([rest a]) ->` → `([...a])`). It takes the tail with a
          // plain name ONLY — any other spelling rejects loudly
          // , and a
          // TARGET pattern rejects the shape outright.
          if (isNode(item) && item[0] === 'rest' && this.inPattern) {
            if (!this.bindingPattern) {
              throw this.positionedError(item, "emitter: Cannot use 'rest' expression as a destructuring target (destructuring rest is spelled '...name')", node);
            }
            if (item.length !== 2 || i !== items.length - 1) {
              throw this.positionedError(item, "emitter: a `rest` element takes the pattern's tail alone", node);
            }
            if (typeof item[1] !== 'string') {
              throw this.positionedError(item, 'emitter: a `rest` element takes a plain name', node);
            }
            this.b.emit('...');
            this.b.emit(item[1]);
            return;
          }
          // Array elements are operand positions: compound items group
          // (spreads never do — `...` binds its operand; pattern
          // elements never do — they are binding positions, and
          // `[(a = 1)]` is invalid destructuring JS).
          const wrap = !this.inPattern && !(isNode(item) && item[0] === '...') && Emitter.needsGrouping(item, 'operand');
          if (wrap) this.b.emit('(');
          this.expr(item);
          if (wrap) this.b.emit(')');
        });
      });
      this.b.emit(']');
    });
  }

  // ["object", ...pairs]; pair = [":", key, value] | [null, key, key]
  // (shorthand — key and value are the same text, so both role marks nest
  // around the one emission).
  // A `':'` pair with a simple identifier key and a thin-arrow value
  // emits as ES6 method shorthand (`->` has dynamic `this`,
  // matching method semantics; `=>` values stay arrows). String keys
  // never shorthand.
  static isMethodPair(pair) {
    return isNode(pair) && (pair[0] === ':' || pair[0] === 'void-pair') && typeof pair[1] === 'string' &&
      /^[A-Za-z_$][\w$]*$/.test(pair[1]) && isNode(pair[2]) && pair[2][0] === '->';
  }

  object(node) {
    const comp = !this.inPattern && Emitter.objectComprehension(node);
    // A dynamicKey comprehension key accumulates through its inner
    // expression (`result[k] = v`).
    if (comp) return this.comprehension(comp[2], this.ind, isNode(comp[1]) ? comp[1][1] : comp[1]);
    const pairs = node.slice(1);
    // Capture the statement indent ONCE: emitting an earlier pair's
    // method body mutates this.ind.
    const objInd = this.ind;
    const isMethod = pairs.map((p) => !this.inPattern && Emitter.isMethodPair(p));
    // The pair join: `, ` until the first method; each method — and
    // every pair after one — starts its own line (`,\n`, no indent).
    const sep = (i) => (isMethod[i] || isMethod.slice(0, i).some(Boolean) ? ',\n' : ', ');
    this.mark(node, '$self', () => {
      this.b.emit('{');
      this.mark(node, 'pairs', () => {
        pairs.forEach((pair, i) => {
          if (i > 0) this.b.emit(sep(i));
          if (isMethod[i]) {
            // A void-pair is a VOID method (`fn!: ->`): implicit
            // return suppressed; its voidMarker role covers the whole
            // emitted method.
            this.mark(pair, 'voidMarker', () => this.mark(pair, '$self', () => {
              if (Emitter.containsAwait(pair[2][2])) this.b.emit('async ');
              if (Emitter.containsYield(pair[2][2])) this.b.emit('*');
              this.mark(pair, 'key', () => this.b.emit(pair[1]));
              const [, params, block] = pair[2];
              this.b.emit('(');
              this.mark(pair[2], 'params', () => this.emitParams(params));
              this.b.emit(') ');
              this.mark(pair, 'value', () => {
                this.methodBlock(pair[2], block, objInd, { isConstructor: false, binds: [], methodName: pair[1], voidBody: pair[0] === 'void-pair' });
              });
            }));
            return;
          }
          const dynamicKey = isNode(pair[1]) && pair[1][0] === 'dynamicKey';
          // A computed key has no shorthand: `{[k]}` names no property.
          if (dynamicKey && pair[0] === null) {
            throw this.positionedError(pair, 'emitter: a computed key needs an explicit value ({[k]: v}) — there is no shorthand form', node);
          }
          // `@`-keys are class-body syntax (static members) — no valid
          // JS emission exists in a plain object literal
          //; the key parses (SimpleObjAssignable) so
          // class bodies can use it, and rejects loudly here. The
          // this-index key form (`{@[k]: v}`) has no valid JS emission
          // anywhere and rejects with it. Rest elements (`{...rest}`)
          // pass — their payload is a name.
          if (pair[0] !== '...' && isNode(pair[1]) && !dynamicKey) {
            throw this.positionedError(pair, 'emitter: @-keys are only supported in class bodies', node);
          }
          this.mark(pair, '$self', () => {
            if (pair[0] === ':' && dynamicKey) {
              // `[key]:` — the key expression is an operand position.
              this.mark(pair, 'key', () => {
                this.mark(pair[1], '$self', () => {
                  this.b.emit('[');
                  this.withExpression(() => this.operand(pair[1], 'key', pair[1][1]));
                  this.b.emit(']');
                });
              });
              this.b.emit(': ');
              if (this.inPattern || (isNode(pair[2]) && pair[2][0] === '=>')) this.mark(pair, 'value', () => this.expr(pair[2]));
              else this.operand(pair, 'value', pair[2]);
            } else if (pair[0] === ':' || pair[0] === 'void-pair') {
              // A non-method void-pair is a void definition whose
              // value must still be a function (a '=>' here — the
              // '->' form took the method-shorthand branch above); in
              // a destructuring pattern the marker has no meaning and
              // rejects.
              if (pair[0] === 'void-pair') {
                if (this.inPattern) {
                  throw this.positionedError(pair, "emitter: the void marker has no meaning in a destructuring pattern — a pattern key takes no trailing '!'", node);
                }
                this.registerVoidValue(pair[2], pair);
              }
              this.mark(pair, 'voidMarker', () => {
                this.mark(pair, 'key', () => this.b.emit(pair[1]));
                this.b.emit(': ');
                // Object pair values are operand positions: compound
                // values group — EXCEPT inside a pattern, where the value
                // is a binding position (a rename target, a nested
                // pattern, or a default like `{a: x = 2}`) and grouping
                // is invalid destructuring JS. Fat-arrow values emit BARE
                // (`n: () => this.a` — an arrow needs no
                // grouping in value position).
                if (this.inPattern || (isNode(pair[2]) && pair[2][0] === '=>')) this.mark(pair, 'value', () => this.expr(pair[2]));
                else this.operand(pair, 'value', pair[2]);
              });
            } else if (pair[0] === '=') {
              // Pattern default: {a = 1}. The default VALUE is an
              // expression position again.
              this.mark(pair, 'key', () => this.b.emit(pair[1]));
              this.b.emit(' = ');
              this.withExpression(() => this.operand(pair, 'value', pair[2]));
            } else if (pair[0] === '...') {
              // Rest element: {...rest} — the dots are the pair's
              // syntax; the value mark stays exact on the name. An
              // ObjSpreadExpr payload (member chains, calls, indexing,
              // parentheticals, this) is an object-LITERAL spread only:
              // in a destructuring pattern the rest target must be a
              // plain name — `this` is a string in the sexpr but no
              // rest target either.
              if (this.inPattern && (isNode(pair[1]) || pair[1] === 'this')) {
                throw this.positionedError(pair, 'emitter: object rest in a destructuring pattern takes a plain name — chained-accessor rest targets are not supported', node);
              }
              this.b.emit('...');
              // The payload is an operand position (`{...(a || b)}`
              // groups); pattern payloads are plain names.
              if (this.inPattern) this.mark(pair, 'value', () => this.expr(pair[1]));
              else this.operand(pair, 'value', pair[1]);
            } else if (typeof pair[1] === 'string' && this.bareRewrite(pair[1]) !== null) {
              // Reactive/member shorthand expands — the KEY stays the
              // bare name, the VALUE is the rewritten read (`{count}` →
              // `{count: count.value}`; a component member →
              // `{count: this.count.value}`). In a BINDING pattern the
              // shorthand is a new name and bareRewrite
              // already declines.
              this.mark(pair, 'key', () => this.b.emit(pair[1]));
              this.b.emit(': ');
              this.mark(pair, 'value', () => this.expr(pair[1]));
            } else {
              this.mark(pair, 'value', () => this.mark(pair, 'key', () => this.b.emit(pair[1])));
            }
          });
        });
      });
      this.b.emit('}');
    });
  }

  // A unary-minus key with a plain digit operand: `a[-1]` reads lower
  // to `.at(-n)` (last-element semantics).
  static negativeLiteralKey(key) {
    return isNode(key) && key[0] === '-' && key.length === 2 &&
      typeof key[1] === 'string' && /^\d+$/.test(key[1]);
  }

  // The key half of index/optindex emission (the chain tail). `opt`
  // selects the optional spellings (`?.[`, `?.at(`); an optional link
  // on a deopt spine emits its plain form. Index KEYS leave the deopt
  // spine (a `?.` inside a computed key is a read, valid in an
  // assignment target). A range key lowers to .slice(): an inclusive
  // end adds 1 — folded into the literal when the end is numeric,
  // spelled `+e + 1 || 9e9` otherwise — and open ends drop their
  // argument.
  indexTail(node, opt, isWrite) {
    const key = node[2];
    const emitKey = () => {
      const d = this.deopt;
      this.deopt = false;
      this.mark(node, 'key', () => this.expr(key));
      this.deopt = d;
    };
    if (!opt && isRange(key)) {
      this.mark(node, 'key', () => this.slice(key));
    } else if (Emitter.negativeLiteralKey(key)) {
      // `.at(-n)` is a CALL — it has no assignment-target form.
      if (isWrite) {
        throw this.positionedError(node, 'emitter: a negative-literal index cannot be an assignment target (reads lower to .at(-n), and a call is not assignable)');
      }
      this.b.emit(opt ? '?.at(' : '.at(');
      this.mark(node, 'key', () => {
        this.b.emit('-');
        this.b.emit(key[1]);
      });
      this.b.emit(')');
    } else {
      this.b.emit(opt ? '?.[' : '[');
      emitKey();
      this.b.emit(']');
    }
  }

  // ["[]", object, key] — computed member.
  index(node) {
    this.chain(node);
  }

  // ["optindex", object, key] — optional index (`a?.[k]`, `a?.at(-n)`).
  optIndex(node) {
    this.chain(node);
  }

  // ["optcall", callee, ...args] — optional call (`f?.(args)`).
  optCall(node) {
    this.chain(node);
  }

  slice(range) {
    const [dots, from, to] = range;
    this.b.emit('.slice(');
    this.mark(range, 'from', () => (from === null ? this.b.emit('0') : this.expr(from)));
    if (to !== null) {
      this.b.emit(', ');
      if (dots === '...') {
        this.mark(range, 'to', () => this.expr(to));
      } else if (typeof to === 'string' && /^\d+$/.test(to)) {
        this.mark(range, 'to', () => this.b.emit(String(Number(to) + 1)));
      } else {
        this.b.emit('+');
        this.mark(range, 'to', () => this.expr(to));
        this.b.emit(' + 1 || 9e9');
      }
    }
    this.b.emit(')');
  }

  // Standalone range: an IIFE lowering.
  range(node) {
    const [dots, from, to] = node;
    const helper = dots === '..'
      ? '((s, e) => Array.from({length: Math.abs(e - s) + 1}, (_, i) => s + (i * (s <= e ? 1 : -1))))'
      : '((s, e) => Array.from({length: Math.max(0, Math.abs(e - s))}, (_, i) => s + (i * (s <= e ? 1 : -1))))';
    this.mark(node, '$self', () => {
      this.b.emit(helper);
      this.b.emit('(');
      this.mark(node, 'from', () => this.expr(from));
      this.b.emit(', ');
      this.mark(node, 'to', () => this.expr(to));
      this.b.emit(')');
    });
  }

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
        throw this.positionedError(node, 'emitter: ThisProperty class names are not supported yet');
      }
      this.b.emit(' ');
      this.mark(node, 'name', () => this.b.emit(name));
    }
    if (parent != null) {
      this.b.emit(' extends ');
      this.mark(node, 'parent', () => this.expr(parent));
    }
    this.b.emit(' {\n');
    if (body != null) this.mark(node, 'body', () => this.classMembers(body, ind));
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
  classMembers(body, ind) {
    const stmts = isNode(body) && body[0] === 'block' ? body.slice(1) : [body];
    const memberName = (key) => (isNode(key) && key[0] === '.' && key[1] === 'this' ? key[2] : key);
    const isStaticKey = (key) => isNode(key) && key[0] === '.' && key[1] === 'this' && key.length === 3 && typeof key[2] === 'string';
    const pad = '  '.repeat(ind + 1);

    // The bound-method audit spans EVERY method object in the body —
    // fields between two method groups must not hide an unbound `=>`.
    const bound = [];
    let firstBound = null;
    let hasConstructor = false;
    for (const stmt of stmts) {
      if (!isObject(stmt)) continue;
      for (const pair of stmt.slice(1)) {
        if (pair[0] !== ':' && pair[0] !== 'void-pair') {
          throw this.positionedError(pair, 'emitter: class bodies support methods and fields only', stmt);
        }
        if (isNode(pair[1]) && (pair[1][0] === 'dynamicKey' || pair[1][0] === '[]')) {
          throw this.positionedError(pair, 'emitter: computed class members are not supported yet', stmt);
        }
        const mName = memberName(pair[1]);
        if (mName === 'constructor') hasConstructor = true;
        if (isFunc(pair[2]) && pair[2][0] === '=>' && !isStaticKey(pair[1]) && mName !== 'constructor') {
          bound.push(mName);
          firstBound ??= pair;
        }
      }
    }
    if (bound.length > 0 && !hasConstructor) {
      throw this.positionedError(firstBound, "emitter: bound ('=>') class methods require an explicit constructor", body);
    }

    // Each member row runs through the place-or-decline probe:
    // a directive above a single-line member (typed field, field with
    // initializer, static prop) places directly above its row; method
    // rows are multi-line and decline. The pad sits INSIDE each
    // branch's emission, so the directive line takes pad-first layout.
    for (const stmt of stmts) {
      this.withTsDirectives(stmt, pad, () => this.classMember(stmt, body, ind, pad, {
        memberName, isStaticKey, bound,
      }), true);
    }
  }

  classMember(stmt, body, ind, pad, { memberName, isStaticKey, bound }) {
    {
      if (isObject(stmt)) {
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
          this.b.emit(pad);
          this.mark(pair, 'voidMarker', () => this.mark(pair, '$self', () => {
            if (isStaticKey(key)) this.b.emit('static ');
            if (Emitter.containsAwait(value[2])) this.b.emit('async ');
            if (Emitter.containsYield(value[2])) this.b.emit('*');
            this.mark(pair, 'key', () => this.b.emit(mName));
            const [, params, block] = value;
            this.b.emit('(');
            this.emitParams(params);
            this.b.emit(')');
            // Constructors take no return annotation in TS.
            if (mName !== 'constructor') {
              this.tsReturnAnnotation(value, Emitter.containsAwait(value[2]), isVoidPair, pair);
            }
            this.b.emit(' ');
            this.mark(pair, 'value', () => {
              this.methodBlock(value, block, ind + 1, {
                isConstructor: mName === 'constructor',
                binds: mName === 'constructor' ? bound : [],
                methodName: mName,
                voidBody: isVoidPair,
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
          this.mark(stmt, 'property', () => this.b.emit(stmt[2]));
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
          if (isStaticKey(stmt[1])) this.b.emit('static ');
          this.mark(stmt, 'target', () => this.b.emit(memberName(stmt[1])));
          if (this.ts) this.tsAnnotate(stmt, 'annotation', this.annotationText(stmt) ?? tidyType(stmt[2]));
        }));
        this.b.emit(';\n');
        return;
      }
      // Field with an initializer (`x = v` / `@x = v`; the typed
      // spelling `x: T = v` erases to the same node, its annotation
      // role covering the whole emitted field).
      if (isNode(stmt) && stmt[0] === '=' && stmt.length === 3 &&
          (typeof stmt[1] === 'string' || isStaticKey(stmt[1]))) {
        this.ind = ind + 1;
        this.b.emit(pad);
        this.mark(stmt, 'annotation', () => this.mark(stmt, '$self', () => {
          if (isStaticKey(stmt[1])) this.b.emit('static ');
          this.mark(stmt, 'target', () => this.b.emit(memberName(stmt[1])));
          if (this.ts && this.annotationText(stmt) !== null) {
            this.tsAnnotate(stmt, 'annotation', this.annotationText(stmt));
          }
          this.b.emit(' ');
          this.mark(stmt, 'operator', () => this.b.emit('='));
          this.b.emit(' ');
          this.mark(stmt, 'value', () => this.withExpression(() => this.expr(stmt[2])));
        }));
        this.b.emit(';\n');
        return;
      }
      if (isNode(stmt) && stmt[0] === 'type-decl') {
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
        throw this.positionedError(stmt, `emitter: an effect ('~>') cannot be a class member — run it at module or function scope, or inside a method `);
      }
      // A readonly declaration is the same class (a `const` lowering
      // with no class-body reading).
      if (this.isReadonlyDecl(stmt)) {
        throw this.positionedError(stmt, `emitter: a readonly declaration ('${typeof stmt[1] === 'string' ? stmt[1] : '…'} =! …') cannot be a class member — declare it at module or function scope `);
      }
      throw this.positionedError(stmt, "emitter: unsupported class member — fields take `name = value`, `name: T = value`, `name: T`, or their `@`-static forms; methods take `name: -> …`", body);
    }
  }

  // A method body is a brace block with the function-body hoisting and
  // implicit return, except constructors (no implicit return; bind
  // statements insert after a leading super(...) call, first
  // otherwise).
  methodBlock(funcNode, block, ind, { isConstructor, binds, methodName, voidBody = false }) {
    const stmts = this.liveStmts(isNode(block) && block[0] === 'block' ? block.slice(1) : [block], { forwards: true });
    const { entries: hoist, names } = this.scopedHoist(stmts, funcNode[1]);
    for (const n of this.pushReactiveFrame(stmts, names)) names.add(n);
    this.scopes.push(names);
    const outerMethod = this.methodName;
    this.methodName = methodName;
    const prevSEO = this.sideEffectOnly;
    this.sideEffectOnly = voidBody;
    this.mark(block, '$self', () => {
      this.b.emit('{\n');
      if (hoist.length) {
        this.b.emit('  '.repeat(ind + 1));
        this.hoistLine(hoist, '  '.repeat(ind + 1));
        this.b.emit('\n');
      }
      const pad = '  '.repeat(ind + 1);
      const emitBinds = () => {
        for (const bm of binds) this.b.emit(`${pad}this.${bm} = this.${bm}.bind(this);\n`);
      };
      this.emitTsTypeDecls(isNode(block) && block[0] === 'block' ? block.slice(1) : [block], pad);
      this.mark(block, 'statements', () => {
        const leadingSuper = isConstructor && stmts.length > 0 && isNode(stmts[0]) && stmts[0][0] === 'super';
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
      this.voidTailReturn(stmts, ind);
      this.b.emit('  '.repeat(ind) + '}');
    });
    this.sideEffectOnly = prevSEO;
    this.methodName = outerMethod;
    this.scopes.pop();
    this.rframes.pop();
  }

  // ["super", ...args] — a bare super call: `super(args)` inside the
  // constructor; `super.<method>(args)` inside any other method (the
  // method-name shorthand). Outside a class method there is no
  // super home — reject loudly.
  superCall(node) {
    if (!this.methodName) {
      throw this.positionedError(node, 'emitter: super outside a class method');
    }
    this.mark(node, '$self', () => {
      this.b.emit(this.methodName === 'constructor' ? 'super(' : `super.${this.methodName}(`);
      this.mark(node, 'args', () => {
        node.slice(1).forEach((arg, i) => {
          if (i > 0) this.b.emit(', ');
          this.callArg(arg);
        });
      });
      this.b.emit(')');
    });
  }

  // ["new", operand] — a member operand keeps the
  // bare NewExpression (`new a.B`); a call-array operand becomes
  // `new Ctor(args)`; a simple operand gains empty parens (`new A()`).
  newExpr(node) {
    const [, operand] = node;
    this.mark(node, '$self', () => {
      this.mark(node, 'operator', () => this.b.emit('new'));
      this.b.emit(' ');
      this.mark(node, 'operand', () => {
        if (isNode(operand) && (operand[0] === '.' || operand[0] === '?.')) {
          this.member(operand);
        } else if (isNode(operand)) {
          // A call node — [ctor, ...args] — emits Ctor(args); with the
          // `new ` prefix already written this is `new Ctor(args)`.
          this.call(operand);
        } else {
          this.b.emit(operand);
          this.b.emit('()');
        }
      });
    });
  }

  // One parameter: a plain name, a rest (`...name`), a default
  // (`name = expr`), or an array/object pattern (emitted like the
  // matching literal — the pattern element cases live on object/array).
  emitParam(p) {
    if (typeof p === 'string') return this.b.emit(p);
    // A typed parameter (["typed-var", target, "T"]) erases to its target;
    // the annotation role's cover row spans the emitted target — the
    // type's only generated manifestation. The TS face emits
    // the annotation after the target as a TS-only region with its own
    // re-marked row.
    if (p[0] === 'typed-var') {
      this.mark(p, '$self', () =>
        this.mark(p, 'annotation', () => {
          this.mark(p, 'target', () => this.emitParam(p[1]));
          if (this.ts) {
            // Optional parameter (C1b): the side-band optionalMarker
            // role (grammar-dropped OPT_MARKER) emits as a TS-only `?`
            // — type-level only, the JS twin is the bare name.
            const id = this.stores.idOf(p);
            if (id !== null && this.stores.role(id, 'optionalMarker')) {
              this.b.tsOnly(() => this.mark(p, 'optionalMarker', () => this.b.emit('?')));
            }
            // A bare optional (`title?`) carries an empty annotation —
            // the `?` alone emits; TS infers the rest.
            const text = this.annotationText(p) ?? (p[2] === '' ? '' : tidyType(p[2]));
            if (text !== '') this.tsAnnotate(p, 'annotation', text);
          }
        }));
      return;
    }
    if (p[0] === 'rest') {
      this.b.emit('...');
      return this.emitParam(p[1]);
    }
    if (p[0] === 'default') {
      this.emitParam(p[1]);
      this.b.emit(' = ');
      return this.withExpression(() => this.expr(p[2]));
    }
    // An array/object param is a PATTERN: its interior emits in
    // binding-position context (defaults bare, no operand grouping) —
    // a BINDING pattern, where the `rest x` sugar is live.
    this.withPattern(() => this.expr(p), true);
  }

  // The erased core of a possibly-typed parameter: ["typed-var",
  // target, "T"] reads through to its target; everything else is
  // itself.
  static paramCore(p) {
    return isNode(p) && p[0] === 'typed-var' ? p[1] : p;
  }

  // The bare `...` expansion marker: params BEFORE it emit normally,
  // the marker becomes `..._rest`, and params AFTER it lower to
  // `const name = _rest[_rest.length - K];` extractions at the body's
  // top.
  static expansionSplit(params) {
    const at = params.findIndex((p) => isNode(p) && p[0] === 'expansion');
    if (at === -1) return { list: params, extractions: [] };
    const trailing = params.slice(at + 1).map(Emitter.paramCore);
    return {
      list: [...params.slice(0, at), ['rest', '_rest']],
      extractions: trailing.map((name, i) => `const ${name} = _rest[_rest.length - ${trailing.length - i}];`),
    };
  }

  emitParams(params) {
    Emitter.expansionSplit(params).list.forEach((p, i) => {
      if (i > 0) this.b.emit(', ');
      this.emitParam(p);
    });
  }

  // ['->'|'=>', params, block]. `->` emits a function expression, `=>` an
  // arrow (single simple param drops its parens; a single-expression body
  // inlines, operand-grouped). Both bodies implicitly return their last
  // expression.
  func(node) {
    const [srcKind, rawParams, block] = node;
    // Implicit `it`: a zero-param arrow that references
    // bare `it` gains it as its parameter — both faces identically.
    const params = rawParams.length === 0 && Emitter.containsBareIt(block) ? ['it'] : rawParams;
    // Component bodies force thin arrows FAT: a nested
    // `->` inside a member/method/effect/render body would re-bind
    // `this` away from the instance every member rewrite targets.
    const kind = srcKind === '->' && this.inComponent() ? '=>' : srcKind;
    const ind = this.ind;
    // Registered by the owning definition (`save! = ->`, `fn!: ->`):
    // the body suppresses its implicit return.
    const isVoid = this.voidFuncs.has(node);
    const stmts = this.liveStmts(isNode(block) && block[0] === 'block' ? block.slice(1) : [block], { forwards: true });
    const { entries: hoist, names } = this.scopedHoist(stmts, params);
    for (const n of this.pushReactiveFrame(stmts, names)) names.add(n);
    this.scopes.push(names);
    const isAsync = Emitter.containsAwait(block);
    const isGen = Emitter.containsYield(block);
    // Fat arrows cannot be generators: JS has no generator-arrow
    // form, so a yielding fat arrow is unemittable — rejected at the
    // layer that knows the function kind.
    if (isGen && kind === '=>') {
      throw this.positionedError(node, srcKind === '->'
        ? 'emitter: a generator arrow cannot sit inside a component body — thin arrows lower to fat arrows there to keep `this` on the instance, and JS has no generator arrows (name the generator a method and call it)'
        : 'emitter: fat arrows cannot contain yield (JS has no generator arrows; use ->)');
    }
    // The return-type role (side-band) covers the whole emitted
    // function; mark() is a no-op for untyped rows.
    this.mark(node, 'returnType', () => this.mark(node, '$self', () => {
      if (kind === '->') {
        if (isAsync) this.b.emit('async ');
        this.mark(node, 'kind', () => this.b.emit(isGen ? 'function*' : 'function'));
        this.b.emit('(');
        this.mark(node, 'params', () => this.emitParams(params));
        this.b.emit(')');
        this.tsReturnAnnotation(node, isAsync, isVoid);
        this.b.emit(' ');
        this.funcBlock(node, block, stmts, ind, hoist, isVoid);
      } else {
        if (isAsync) this.b.emit('async ');
        // TS requires parens around an ANNOTATED single param and
        // before a return annotation (`x: T => …` does not parse);
        // the TS face adds them as TS-only bytes, so stripping
        // restores the bare-name JS spelling.
        const tsParens = this.ts &&
          params.length === 1 && typeof Emitter.paramCore(params[0]) === 'string' &&
          (Emitter.isTypedWrapper(params[0]) || this.annotationText(node, 'returnType') !== null || isVoid);
        this.mark(node, 'params', () => {
          // Only a single PLAIN name drops its parens — patterns,
          // rests, and defaults keep them (JS requires it). A typed
          // single name erases to a plain one and drops them too.
          if (params.length === 1 && typeof Emitter.paramCore(params[0]) === 'string') {
            if (tsParens) this.b.tsOnly(() => this.b.emit('('));
            this.emitParam(params[0]);
            if (tsParens) this.b.tsOnly(() => this.b.emit(')'));
          } else {
            this.b.emit('(');
            this.emitParams(params);
            this.b.emit(')');
          }
        });
        this.tsReturnAnnotation(node, isAsync, isVoid);
        this.b.emit(' ');
        this.mark(node, 'kind', () => this.b.emit('=>'));
        this.b.emit(' ');
        // A void fat arrow never inlines: its body is the braced
        // statement form ending in `return;`. Statement-only bodies
        // never inline either — a lone `throw`/`debugger` has no
        // expression form, and the inline path would emit it as a
        // bare atom (`=> throw(e)`, `=> debugger` — invalid JS both).
        const inline = !isVoid && stmts.length === 1 && hoist.length === 0 &&
          !Emitter.statementOnly(stmts[0]) &&
          !(isNode(stmts[0]) && (isDefHead(stmts[0][0]) || ['return', 'if', 'while', 'block'].includes(stmts[0][0])));
        if (inline) {
          this.mark(node, 'body', () => {
            // An inline body that IS an object literal must group:
            // `() => {}` is an empty block returning undefined, not
            // the object (the statement-start problem in arrow-body
            // position).
            const wrap = Emitter.needsGrouping(stmts[0], 'operand') || isObject(stmts[0]);
            if (wrap) this.b.emit('(');
            this.expr(stmts[0]);
            if (wrap) this.b.emit(')');
          });
        } else {
          this.funcBlock(node, block, stmts, ind, hoist, isVoid);
        }
      }
    }));
    this.scopes.pop();
    this.rframes.pop();
    // Body statements moved this.ind; a sibling expression after this
    // function must not inherit the deeper level.
    this.ind = ind;
  }

  funcBlock(node, block, stmts, ind, hoist, voidBody = false) {
    // node[1] holds def params at slot 2 (def nodes) or slot 1
    // (arrows); read whichever is the params array.
    const params = isDefHead(node[0]) ? node[2] : node[1];
    const { extractions } = Emitter.expansionSplit(Array.isArray(params) ? params : []);
    const prevSEO = this.sideEffectOnly;
    this.sideEffectOnly = voidBody;
    this.mark(node, 'body', () => {
      this.mark(block, '$self', () => {
        this.b.emit('{\n');
        if (hoist.length) {
          this.b.emit('  '.repeat(ind + 1));
          this.hoistLine(hoist, '  '.repeat(ind + 1));
          this.b.emit('\n');
        }
        for (const line of extractions) {
          this.b.emit('  '.repeat(ind + 1) + line + '\n');
        }
        this.emitTsTypeDecls(isBlock(block) ? block.slice(1) : [block], '  '.repeat(ind + 1));
        this.mark(block, 'statements', () => {
          stmts.forEach((stmt, i) => {
            this.b.emit('  '.repeat(ind + 1));
            if (!voidBody && i === stmts.length - 1) this.implicitReturn(stmt, ind + 1);
            else this.statement(stmt, ind + 1, true);
            this.b.emit('\n');
          });
        });
        this.voidTailReturn(stmts, ind);
        this.b.emit('  '.repeat(ind) + '}');
      });
    });
    this.sideEffectOnly = prevSEO;
  }

  // A void body's tail: every statement emitted as a statement, then a
  // bare `return;` — the function returns undefined by declaration.
  // Skipped when the last statement already leaves (return/throw) or
  // the body is empty (the head check reads array heads
  // only, so a bare `break`/`continue` string still takes the
  // trailing return).
  voidTailReturn(stmts, ind) {
    if (!this.sideEffectOnly || stmts.length === 0) return;
    const last = stmts[stmts.length - 1];
    const lastH = isNode(last) ? last[0] : null;
    if (['return', 'throw', 'break', 'continue'].includes(lastH)) return;
    this.b.emit('  '.repeat(ind + 1) + 'return;\n');
  }

  // The last statement of a function body returns its value (the
  // implicit return). Statement constructs in tail
  // position: if → `return (ternary)` when every branch is a single
  // expression, otherwise an in-place if-chain with returns pushed
  // into each branch; try/switch → `return` of the value IIFE;
  // while/loop → the plain statement (tail loops return
  // nothing); for → an inline `_result` accumulator.
  implicitReturn(stmt, ind) {
    this.withTsDirectives(stmt, '  '.repeat(ind), () => this.implicitReturnCore(stmt, ind));
  }

  implicitReturnCore(stmt, ind) {
    if (isNode(stmt) && (stmt[0] === 'return' || stmt[0] === 'throw')) return this.statement(stmt, ind);
    if (typeof stmt === 'string' && (stmt === 'break' || stmt === 'continue' || stmt === 'debugger')) {
      return this.statement(stmt, ind);
    }
    this.ind = ind;
    if (isNode(stmt)) {
      const h = stmt[0];
      if (h === 'if' && stmt.length >= 3 && stmt.length <= 4) {
        if (Emitter.ifIsSimple(stmt)) {
          this.b.emit('return (');
          this.mark(stmt, '$self', () => this.ifTernary(stmt));
          this.b.emit(');');
        } else {
          this.mark(stmt, '$self', () => this.returnifyIf(stmt, ind));
        }
        return;
      }
      if (h === 'try') {
        this.b.emit('return ');
        this.valueTry(stmt);
        this.b.emit(';');
        return;
      }
      if (h === 'switch' && stmt.length === 4) {
        this.b.emit('return ');
        this.valueSwitch(stmt);
        this.b.emit(';');
        return;
      }
      if ((h === 'while' && (stmt.length === 3 || stmt.length === 4)) || (h === 'loop' && stmt.length === 2)) {
        return this.statement(stmt, ind);
      }
      // A tail-position enum stays a statement — its lowering is a
      // `const` declaration, which has no value form
      if (h === 'enum') return this.statement(stmt, ind);
      // A tail-position reactive declaration follows the enum
      // precedent: the declaration stands, the function returns
      // undefined. A BOUND effect is the same class,
      // and so
      // is a readonly declaration (#94); a
      // BARE tail effect falls through and RETURNS the disposer — the
      // caller owns disposal.
      if (this.isReactiveDecl(stmt) || this.isReadonlyDecl(stmt)) return this.statement(stmt, ind);
      if (this.isEffectDecl(stmt) && stmt[1] !== null) return this.statement(stmt, ind);
      if ((h === 'for-in' || h === 'for-of' || h === 'for-as') && stmt.length === 6) {
        return this.returnifyLoop(stmt, ind);
      }
      if (isDefHead(h)) {
        throw this.positionedError(stmt, "emitter: implicit return of a 'def' body is not supported yet");
      }
    }
    this.b.emit('return ');
    const wrap = Emitter.needsGrouping(stmt, 'return');
    if (wrap) this.b.emit('(');
    this.expr(stmt);
    if (wrap) this.b.emit(')');
    this.b.emit(';');
  }

  // [op, target, postfix] — prefix/postfix increment and decrement.
  update(node) {
    this.mark(node, '$self', () => {
      const [op, target, postfix] = node;
      if (postfix) {
        this.mark(node, 'target', () => this.withTarget(() => this.expr(target)));
        this.mark(node, 'operator', () => this.b.emit(op));
      } else {
        this.mark(node, 'operator', () => this.b.emit(op));
        this.mark(node, 'target', () => this.withTarget(() => this.expr(target)));
      }
    });
  }

  // ['in'|'of', a, b] — the RELATION lowerings: `in` is membership
  // (includes for arrays/strings, `in` otherwise); `of` is JS `in`.
  relation(node) {
    const [op, a, b] = node;
    this.mark(node, '$self', () => {
      // `key in {literal}`: the container is statically an object, so
      // the array/string membership lowering is dead — plain JS `in`.
      if (op === 'of' || (op === 'in' && isObject(b))) {
        this.operand(node, 'left', a);
        this.b.emit(' in ');
        this.operand(node, 'right', b);
      } else {
        this.b.emit('Array.isArray(');
        this.expr(b);
        this.b.emit(') || typeof ');
        this.expr(b);
        this.b.emit(" === 'string' ? ");
        this.expr(b);
        this.b.emit('.includes(');
        this.mark(node, 'left', () => this.expr(a));
        this.b.emit(') : (');
        this.expr(a);
        this.b.emit(' in ');
        this.mark(node, 'right', () => this.expr(b));
        this.b.emit(')');
      }
    });
  }

  // ['?:', condition, then, else] — the condition emits bare (like an if
  // condition); branches are operand positions that additionally group
  // update expressions ((i--), (++i)).
  //
  // The assignment hoist: a postfix-else whose then
  // branch is an UNPARENTHESIZED assignment — the Python idiom
  // `x = b if c else d` — hoists the target out of the ternary:
  // `x = (c ? b : d)`. The explicit `(x = b) if c else d` keeps its
  // assign-only-when-true semantics (the Parenthetical flag guards it).
  static ternaryHoists(node) {
    const then = node[2];
    return isNode(then) && then[0] === '=' && then.length === 3 &&
      typeof then[1] === 'string' && !then.parenthesized;
  }

  ternary(node) {
    if (Emitter.ternaryHoists(node)) {
      const then = node[2];
      this.mark(node, '$self', () => {
        // The hoisted target is a WRITE — it routes through expr so a
        // reactive name unwraps (`count.value = (c ? … : …)`);
        // plain names emit verbatim as before.
        this.expr(then[1]);
        this.b.emit(' = (');
        this.mark(node, 'condition', () => this.expr(node[1]));
        this.b.emit(' ? ');
        this.grouped(node, 'then', then[2], Emitter.needsGrouping(then[2], 'operand') || isUpdate(then[2]));
        this.b.emit(' : ');
        this.grouped(node, 'else', node[3], Emitter.needsGrouping(node[3], 'operand') || isUpdate(node[3]));
        this.b.emit(')');
      });
      return;
    }
    const branch = (role, child) => {
      this.grouped(node, role, child, Emitter.needsGrouping(child, 'operand') || isUpdate(child));
    };
    this.mark(node, '$self', () => {
      this.mark(node, 'condition', () => this.expr(node[1]));
      this.b.emit(' ? ');
      branch('then', node[2]);
      this.b.emit(' : ');
      branch('else', node[3]);
    });
  }

  // ["str", ...chunks] — template literal. String chunks are quoted
  // values (empty ones drop); interpolation chunks are Body arrays whose
  // single expression emits inside ${…} (compounds group) —
  // the Body node's own $self mark makes each interpolated expression
  // bidirectionally mapped with real source spans.
  strTemplate(node) {
    this.mark(node, '$self', () => {
      this.b.emit('`');
      this.templateChunks(node.slice(1));
      this.b.emit('`');
    });
  }

  // The chunk sequence of a template-lowered literal (interpolated
  // strings and heregexes): string chunks are quoted values (empty ones
  // drop); interpolation chunks are Body arrays whose single expression
  // emits inside ${…} (compounds group) — the Body node's own $self
  // mark makes each interpolated expression bidirectionally mapped
  // with real source spans.
  templateChunks(chunks) {
    for (const chunk of chunks) {
      if (chunk === '') continue; // empty interpolation (#{})
      if (isNode(chunk)) {
        if (chunk.length !== 1) {
          throw this.positionedError(chunk, 'emitter: multi-statement interpolations are not supported yet');
        }
        this.b.emit('${');
        this.mark(chunk, '$self', () => {
          const wrap = Emitter.needsGrouping(chunk[0], 'operand') || isUpdate(chunk[0]);
          if (wrap) this.b.emit('(');
          this.expr(chunk[0]);
          if (wrap) this.b.emit(')');
        });
        this.b.emit('}');
      } else {
        const content = chunk.slice(1, -1);
        if (content !== '') this.b.emit(Emitter.escapeTemplate(content));
      }
    }
  }

  // ["here-regex", flags, ...chunks] — an interpolated heregex lowers to a
  // RegExp call over a template literal (chunks already stripped by the
  // lexer), with the flags as a second argument when present.
  heregex(node) {
    const [, flags, ...chunks] = node;
    this.mark(node, '$self', () => {
      this.b.emit('RegExp(`');
      this.templateChunks(chunks);
      this.b.emit('`');
      if (flags !== '') this.b.emit(`, '${flags}'`);
      this.b.emit(')');
    });
  }

  call(node) {
    // A rest-headed node reaching CALL emission inside a pattern sits
    // in a position the `rest x` sugar does not cover (array() owns
    // the one legal position, a binding pattern's tail): an object
    // pair value (`{k: rest v}`) or a target pattern. Emitting
    // `rest(v)` here would be a silent miscompile either way.
    if (node[0] === 'rest' && this.inPattern) {
      throw this.positionedError(node, this.bindingPattern
        ? 'emitter: a `rest` element is only legal at an array pattern\'s tail'
        : "emitter: Cannot use 'rest' expression as a destructuring target (destructuring rest is spelled '...name')");
    }
    // A dammit callee awaits the CALL, not the callee: `f! 1, 2` →
    // `await f(1, 2)` — the await surrounds the whole invocation, so
    // no callee grouping is needed. This spelling keeps its inline
    // path; every other call emits through the chain driver.
    if (isNode(node[0]) && node[0][0] === 'dammit!') {
      this.mark(node, '$self', () => {
        this.b.emit('await ');
        this.mark(node[0], '$self', () => this.head(node[0], 'target', node[0][1]));
        this.mark(node, 'args', () => {
          this.b.emit('(');
          node.slice(1).forEach((arg, i) => {
            if (i > 0) this.b.emit(', ');
            this.callArg(arg);
          });
          this.b.emit(')');
        });
      });
      return;
    }
    this.chain(node);
  }

  // The true-modulo helper, inlined per site (like the range helper —
  // emitted output is self-contained, no shared helper block). Coerces both
  // operands once and normalizes the sign to the divisor's.
  static MODULO = '((n, d) => { n = +n; d = +d; return (n % d + d) % d; })';

  // ["//", left, right] — floor division: Math.floor(left / right).
  floorDiv(node) {
    this.mark(node, '$self', () => {
      this.b.emit('Math.floor(');
      this.operand(node, 'left', node[1]);
      this.b.emit(' ');
      this.mark(node, 'operator', () => this.b.emit('/'));
      this.b.emit(' ');
      this.operand(node, 'right', node[2]);
      this.b.emit(')');
    });
  }

  // ["%%", left, right] — true modulo (result carries the divisor's sign).
  modulo(node) {
    this.mark(node, '$self', () => {
      this.b.emit(Emitter.MODULO + '(');
      this.mark(node, 'left', () => this.expr(node[1]));
      this.b.emit(', ');
      this.mark(node, 'right', () => this.expr(node[2]));
      this.b.emit(')');
    });
  }

  // ["//=", target, value] — target = Math.floor(target / value). The
  // target emits twice (read + write), both marked;
  // both suppress read-only lowerings so the two spellings agree.
  floorDivAssign(node) {
    this.mark(node, '$self', () => {
      const target = () => this.mark(node, 'target', () => this.withTarget(() => this.expr(node[1])));
      target();
      this.b.emit(' = Math.floor(');
      target();
      this.b.emit(' / ');
      this.mark(node, 'value', () => this.expr(node[2]));
      this.b.emit(')');
    });
  }

  // ["%%=", target, value] — target = modulo(target, value), inlined.
  moduloAssign(node) {
    this.mark(node, '$self', () => {
      const target = () => this.mark(node, 'target', () => this.withTarget(() => this.expr(node[1])));
      target();
      this.b.emit(' = ' + Emitter.MODULO + '(');
      target();
      this.b.emit(', ');
      this.mark(node, 'value', () => this.expr(node[2]));
      this.b.emit(')');
    });
  }

  // ["await", value] — the value is an operand position (compound
  // values group: `await (a && b)`; calls stay bare).
  awaitExpr(node) {
    this.mark(node, '$self', () => {
      this.b.emit('await ');
      this.operand(node, 'value', node[1]);
    });
  }

  // ["do-iife", operand] — immediate invocation: `(<operand>)(<args>)`.
  // A function operand captures per-parameter arguments — an identifier
  // param passes the enclosing binding of the same name (the
  // loop-closure idiom), a default param passes its default value.
  // Trailing default-only arguments drop: the default itself fires.
  // Pattern, rest, and expansion params have no capture argument —
  // rejected loudly.
  doIife(node) {
    const [, fn] = node;
    this.mark(node, '$self', () => {
      this.b.emit('(');
      this.mark(node, 'func', () => this.expr(fn));
      this.b.emit(')(');
      if (isFunc(fn)) {
        const params = fn[1];
        const args = params.map((p) => {
          // Typed params erase to their cores here too: `do (x: T) ->`
          // captures the enclosing `x`; a typed default passes its
          // default value. The capture argument is a READ of the
          // enclosing binding — a reactive name captures its current
          // VALUE (the expr path unwraps), and the param then shadows
          // it inside the body.
          const core = Emitter.paramCore(p);
          if (typeof core === 'string') return () => this.expr(core);
          if (isNode(core) && core[0] === 'default' && typeof Emitter.paramCore(core[1]) === 'string') return () => this.expr(core[2]);
          throw this.positionedError(p, 'emitter: do-IIFE parameters must be plain names or defaulted names — patterns and rests have no capture argument', node);
        });
        let live = params.length;
        while (live > 0 && isNode(params[live - 1]) && params[live - 1][0] === 'default') live--;
        args.slice(0, live).forEach((arg, i) => {
          if (i > 0) this.b.emit(', ');
          arg();
        });
      }
      this.b.emit(')');
    });
  }

  // ["dammit!", target] standing alone: call-plus-await with no args.
  dammit(node) {
    this.mark(node, '$self', () => {
      this.b.emit('await ');
      this.head(node, 'target', node[1]);
      this.b.emit('()');
    });
  }

  // ["yield"] | ["yield", value] | ["yield-from", value]
  yieldExpr(node) {
    this.mark(node, '$self', () => {
      this.b.emit(node[0] === 'yield-from' ? 'yield*' : 'yield');
      const value = node[0] === 'yield-from' ? node[1] : node[1];
      if (node.length > 1) {
        this.b.emit(' ');
        this.operand(node, 'value', value);
      }
    });
  }
}

// parseResult: the generated parser's {sexpr, stores, diagnostics}.
// Returns {code, mappings, stores} — mappings are plain MappingStore rows
// (src/stores.js Mappings is the query layer).
// ── Feature-runtime delivery ───────────────────────────────────
// Packaging follows the compilation context:
//   'none'   — emit the bare program (references like `__schema` stay
//              free identifiers). The low-level default: tests and
//              test comparisons see undecorated output.
//   'import' — toolchain paths (the loader): ONE injected import of
//              the shared runtime module, mapped as a synthetic row
//              (zero-width source anchor on the program node).
//   'inline' — carried-away output (compile-to-file/stdout): the
//              runtime body inlined ONCE, IIFE-wrapped so only the
//              needed names bind; the runtime's own sentinel rejects
//              two standalone copies meeting in one process.
// Scope-aware suppression: a user binding shadowing a runtime name at
// PROGRAM scope (hoist target, import binding, export const, enum
// const — decided statically) suppresses injection for that name;
// function-scope shadowing is the user's local choice and suppresses
// nothing.

const containsSchema = (sexpr) => {
  if (!isNode(sexpr)) return false;
  if (sexpr[0] === 'schema' && sexpr.length === 2 && typeof sexpr[1] === 'object') return true;
  return sexpr.some(containsSchema);
};

// Structural trigger for the persistence runtime: a `:model`
// declaration anywhere in the tree — its evaluation needs the model
// machinery installed (kind 'model' rejects loudly in a process
// without the orm module), even when the source never spells a
// persistence name.
const containsModelSchema = (sexpr) => {
  if (!isNode(sexpr)) return false;
  if (sexpr[0] === 'schema' && sexpr.length === 2 && sexpr[1] &&
      typeof sexpr[1] === 'object' && sexpr[1].kind === 'model') return true;
  return sexpr.some(containsModelSchema);
};

// Structural trigger for the reactive runtime: a reactive DECLARATION
// or an effect anywhere in the tree — its emission calls
// `__state`/`__computed`/`__effect` (references the source never
// spells). isTrigger is the semanticKind check for exactly those
// constructs (the heads are spellable; a user call `state a, 0` or
// `effect h, 5` must not deliver a runtime). Readonly declarations
// are deliberately NOT triggers: the lowering is a plain `const`
// that calls no runtime name, so a readonly-only file stays
// zero-cost. They still count as DECLARATIONS in the reference walk
// (their target is a binding, never a reference).
const containsReactive = (sexpr, isTrigger) => {
  if (!isNode(sexpr)) return false;
  if (isTrigger(sexpr)) return true;
  return sexpr.some((el) => containsReactive(el, isTrigger));
};

// Structural trigger for the component runtime: a component
// DECLARATION node anywhere in the tree — its emission extends
// `__Component` and calls the context API (references the source
// never spells). The semanticKind check keeps forged shapes out
// (`component` is a keyword, but the discipline is uniform).
const containsComponentDecl = (sexpr, isComponent) => {
  if (!isNode(sexpr)) return false;
  if (isComponent(sexpr)) return true;
  return sexpr.some((el) => containsComponentDecl(el, isComponent));
};

// The delivered-runtime table — one entry per feature runtime. Each
// entry carries the runtime's public names (the trigger set AND the
// injected binding set), its module URL, and an optional structural
// trigger for constructs whose emission calls a runtime name the
// source never spells (a schema declaration emits `__schema(…)`).
// Delivery otherwise triggers on free REFERENCES to the names —
// the delivery rule — so a runtime is deliverable before any
// language construct emits its names (delivery triggers on
// references alone).
//   schema:     the call every emitted schema makes, the error class
//               user code catches, and the registration entry `~:name`
//               coercers resolve through (coercers resolve lazily at
//               parse time, so in-module order is free).
//   schema-orm: the persistence runtime — the `schema`
//               namespace (transaction/connect/setAdapter/
//               registerCoercer) and the adapter installer, plus the
//               structural trigger: a `:model` declaration
//               delivers it (evaluation installs the model machinery
//               the declaration needs), reference or not. Its body
//               depends on the validation runtime's internals (the
//               module imports them), so delivering it delivers the
//               schema runtime too — both modes, uniformly — and in
//               inline mode the two bodies share ONE IIFE (the
//               fragment-scope model; the import line strips exactly
//               as export lines do).
//   reactive:   the lowering targets (`__state`/`__computed`/
//               `__effect`), `__batch`, and the user-facing API
//               (`__readonly`, `__setErrorHandler`/`__handleError`/
//               `__catchErrors`, `getEffectSignal` — each delivers by
//               reference like every other runtime name; no lowering
//               emits `__readonly`).
//   components: the component runtime — the user-callable
//               context API (`setContext`/`getContext`/`hasContext`)
//               and the emission-facing class + helpers the component
//               declaration waves  spell in generated output.
//               Its body imports the reactive runtime's owner seam,
//               so delivering it delivers reactive too — both modes,
//               uniformly — and in inline mode the two bodies share
//               ONE IIFE. The structural trigger (a component
//               declaration node) arrives with the component grammar, whose
//               emission is what makes one exist; until then delivery
//               triggers on references alone.
const RUNTIME_TABLE = [
  {
    key: 'schema',
    names: ['__schema', 'SchemaError', 'registerCoercer'],
    url: new URL('./runtime/schema.js', import.meta.url),
    triggers: (sexpr, preds) => containsSchema(sexpr),
  },
  {
    key: 'schema-orm',
    names: ['schema', '__schemaSetAdapter'],
    url: new URL('./runtime/schema-orm.js', import.meta.url),
    requires: 'schema',
    triggers: (sexpr, preds) => containsModelSchema(sexpr),
  },
  {
    // `types` (TS face): the reactive primitives are GENERIC — the
    // inlined JS would infer anys, but `__state(v)` genuinely returns
    // a cell of v's type, and typing the destructure makes every
    // unannotated reactive infer natively (`store ~= cart` is a
    // readonly cell of cart's full object type).
    // Plain type params widen literal arguments (T from 'Rip' is
    // string, not "Rip") — the declare-in-place widening story.
    key: 'reactive',
    names: ['__state', '__computed', '__effect', '__batch', '__readonly',
            '__setErrorHandler', '__handleError', '__catchErrors', 'getEffectSignal'],
    url: new URL('./runtime/reactive.js', import.meta.url),
    triggers: (sexpr, preds) => containsReactive(sexpr, preds.isTrigger),
    types: {
      __state: '<T>(value: T) => { value: T; read(): T }',
      __computed: '<T>(fn: () => T) => { readonly value: T; read(): T }',
      __effect: '(fn: () => void | (() => void)) => () => void',
      __batch: '<T>(fn: () => T) => T',
      __readonly: '<T>(value: T) => T',
      __setErrorHandler: '(handler: ((error: any, source?: string) => void) | null) => void',
      __handleError: '(error: any, source?: string) => void',
      __catchErrors: '<T>(fn: () => T, onError?: (e: any) => void) => T | undefined',
      getEffectSignal: '() => AbortSignal | null',
    },
  },
  {
    // The stdlib: p, sleep, zip and friends
    // — reference-triggered only (no structural trigger), so a program
    // that never spells a helper name carries zero stdlib bytes,
    // and a user binding of the same name suppresses delivery. `types`
    // annotates the inline destructure on the TS face (member
    // signatures, the STDLIB_TYPE_DECLS): the checker sees precise
    // types without inferring through the IIFE.
    key: 'stdlib',
    names: ['abort', 'assert', 'exit', 'kind', 'noop', 'p', 'pp', 'pj', 'pr',
            'raise', 'rand', 'sleep', 'todo', 'warn', 'zip'],
    url: new URL('./runtime/stdlib.js', import.meta.url),
    types: {
      abort: '(msg?: string) => never',
      assert: '(v: any, msg?: string) => void',
      exit: '(code?: number) => never',
      kind: '(v: any) => string',
      noop: '() => void',
      p: '(...args: any[]) => void',
      pp: '<T>(v: T) => T',
      pj: '<T>(v: T) => T',
      pr: '<T>(v: T) => T',
      raise: '(a: any, b?: any) => never',
      rand: '(a?: number, b?: number) => number',
      sleep: '(ms: number) => Promise<void>',
      todo: '(msg?: string) => never',
      warn: '(...args: any[]) => void',
      zip: '(...arrays: any[][]) => any[][]',
    },
  },
  {
    key: 'components',
    names: ['setContext', 'getContext', 'hasContext', '__Component',
            '__pushComponent', '__popComponent', '__clsx', '__lis', '__reconcile',
            '__transition', '__handleComponentError', '__detach',
            // The owner-seam names factory emission spells —
            // re-exported by the components module so reactive-only
            // programs' injected bytes stay untouched.
            '__ownerFrame', '__pushOwner', '__popOwner', '__detachRef'],
    url: new URL('./runtime/components.js', import.meta.url),
    requires: 'reactive',
    triggers: (sexpr, preds) => containsComponentDecl(sexpr, preds.isComponent),
  },
];

// Inline-mode body text, lazily read and cached per runtime. The
// export line is the module's ES seam, and a runtime's import of a
// sibling runtime module is likewise: inlined bodies share one IIFE
// scope, so both lines strip and the references bind directly.
const runtimeBodies = new Map();
const runtimeText = (rt) => {
  if (!runtimeBodies.has(rt.key)) {
    const raw = readFileSync(rt.url, 'utf8');
    runtimeBodies.set(rt.key, raw
      .replace(/^export \{[^}]*\};\s*$/m, '')
      .replace(/^import \{[^}]*\} from '\.\/[a-z-]+\.js';\s*$/m, '')
      .trimEnd());
  }
  return runtimeBodies.get(rt.key);
};

// Does the tree REFERENCE any of `names` as a free identifier? The
// trigger rule: reference a delivered runtime name → get the
// runtime — a schema declaration is just one such reference (its
// emission calls `__schema`), so a registration-only module
// (`registerCoercer` with no schema) triggers delivery the same way.
// Identifier references are bare strings in VALUE position; the walk
// skips the positions where a bare string is a NAME, not a
// reference: member property names, plain object/pair keys
// (dynamicKey nodes recurse — those ARE references), function/def
// names and their parameter binding names, class names, assignment
// targets, type strings (typed-var/cast annotations erase), and
// import statements (import bindings are program-scope bindings —
// the suppression set, not references). PATTERN contexts —
// function/def parameters, loop heads, pattern-assignment targets,
// catch bindings — are BINDING positions: shorthand elements there
// ({SchemaError}, [SchemaError]) are binding names, never
// references, while default-value expressions, computed keys, and
// member/index targets inside a pattern stay references (object
// SHORTHAND in expression position — x = {SchemaError} — remains a
// reference; only patterns bind). String/number literals keep
// their source spelling (quotes included), so they never equal a
// bare name. The walk is scope-free by design: a FUNCTION-scope
// binding of a runtime name does not suppress module-level delivery
// (function scope suppresses nothing), so a reference
// under one may over-trigger injection, which the local binding then
// shadows — harmless, and consistent with the schema-module
// behavior.
const referencesNames = (sexpr, names, isDecl = () => false) => {
  if (names.size === 0) return false;
  const ref = (x) => typeof x === 'string' && names.has(x);
  const walkParams = (params) => isNode(params) && params.some(walkPattern);
  // Binding-position walk: bare strings are binding names (skipped);
  // only the expression slots inside a pattern can reference.
  const walkPattern = (p) => {
    if (!isNode(p)) return false;
    const [h] = p;
    if (h === 'object' || h === 'array') return p.slice(1).some(walkPattern);
    if (h === null && p.length === 3) return false;
    if (h === ':' && p.length === 3) return (isNode(p[1]) && walk(p[1])) || walkPattern(p[2]);
    if (h === '=' && p.length === 3) return walkPattern(p[1]) || walk(p[2]);
    if ((h === 'rest' || h === '...' || h === 'expansion') && p.length === 2) return walkPattern(p[1]);
    if (h === 'typed-var' && p.length === 3) return walkPattern(p[1]);
    return walk(p);
  };
  const walk = (x) => {
    if (ref(x)) return true;
    if (!isNode(x)) return false;
    const [h] = x;
    // A schema DECLARATION node is not a reference to the name
    // 'schema' — its head is the construct's spelling and its body is
    // a descriptor, not a tree (callable bodies are walked separately
    // through deliveryTrees). Without this, every schema declaration
    // would read as a reference to the persistence namespace.
    if (h === 'schema' && x.length === 2 && x[1] && typeof x[1] === 'object' && Array.isArray(x[1].entries)) return false;
    if (h === '.' || h === '?.') return walk(x[1]);
    if ((h === ':' || h === 'void-pair') && x.length === 3) return (isNode(x[1]) && walk(x[1])) || walk(x[2]);
    if (isFunc(x)) return walkParams(x[1]) || walk(x[2]);
    if (isDefHead(h) && x.length === 4) return walkParams(x[2]) || walk(x[3]);
    // A reactive DECLARATION's target is a binding name, never a
    // reference; its initializer is expression territory. (A user
    // call impersonating the head fails isDecl and walks generically
    // — its head string IS a reference.)
    if (isDecl(x)) return walk(x[2]);
    if (ASSIGNS.has(h) && x.length === 3) return (isNode(x[1]) && walkPattern(x[1])) || walk(x[2]);
    // Loop heads at every arity: the 6-slot statement form and the
    // 4-slot comprehension clause (postfix-for lowers to a
    // comprehension) both carry the pattern list in slot 1; the
    // remaining slots (iterable, guard, step, own flag, body) are
    // expression territory.
    if (h === 'for-in' || h === 'for-of' || h === 'for-as') {
      return (isNode(x[1]) && x[1].some(walkPattern)) || x.slice(2).some(walk);
    }
    if (h === 'try') {
      return x.slice(1).some((part) => {
        if (!isNode(part)) return false;
        if (part[0] === 'block') return walk(part);
        return walkPattern(part[0]) || walk(part[1]);
      });
    }
    if (h === 'class' && x.length >= 2) return x.slice(2).some(walk);
    if (h === 'typed-var' && x.length === 3) return isNode(x[1]) && walk(x[1]);
    if (h === 'cast' && x.length === 3) return walk(x[1]);
    if (h === 'import' || h === 'type-decl') return false;
    return x.some(walk);
  };
  return walk(sexpr);
};

// Every tree the delivery decision must see, each with the semanticKind
// check bound to ITS stores: the program itself, plus each schema
// callable body (sub-parsed once through the emitter's cache — the
// captured token slices never appear in the parent tree, so a walk of
// the program alone would miss a reactive lowering inside a schema
// method). Nested schemas inside callable bodies recurse.
const deliveryTrees = (emitter, sexpr) => {
  const trees = [];
  const visit = (tree, stores) => {
    // Two predicates, one distinction: every declaration's
    // target is a BINDING in the reference walk (isDecl — readonly
    // included), but only the constructs whose emission CALLS a
    // runtime name are structural triggers (isTrigger — readonly
    // excluded: its lowering is a plain const).
    const isDecl = (x) => Emitter.isReactiveDeclIn(stores, x) || Emitter.isEffectDeclIn(stores, x) || Emitter.isReadonlyDeclIn(stores, x);
    const isTrigger = (x) => Emitter.isReactiveDeclIn(stores, x) || Emitter.isEffectDeclIn(stores, x);
    const isComponent = (x) => Emitter.isComponentDeclIn(stores, x);
    trees.push({ tree, isDecl, isTrigger, isComponent });
    const walk = (x) => {
      if (!isNode(x)) return;
      if (x[0] === 'schema' && x.length === 2 && x[1] && typeof x[1] === 'object' && Array.isArray(x[1].entries)) {
        for (const { tokens } of Emitter.schemaBodies(x[1])) {
          const sub = emitter.subParse(tokens);
          if (sub.stmts.length) visit(['program', ...sub.stmts], sub.stores);
        }
        return;
      }
      x.forEach(walk);
    };
    walk(tree);
  };
  visit(sexpr, emitter.stores);
  return trees;
};

// The program-scope binding set — EVERY name module-level emission
// declares: hoisted `let` targets, import bindings, and the
// statement forms that bind without hoisting (class declarations,
// def functions, enum consts, exported bindings — bare and under
// `export`). hoistTargets deliberately skips those statement forms
// (they declare through their own keywords), so they enumerate here;
// a name this walk misses would collide with an injected runtime
// import as a duplicate declaration. Read-only walk; no rows
// recorded.
const programScopeNames = (emitter, sexpr) => {
  const stmts = sexpr.slice(1);
  const names = new Set(emitter.hoistTargets(stmts).map(([n]) => n));
  const imports = stmts.filter((s) => emitter.isModuleImport(s));
  for (const n of Emitter.importedNames(imports)) names.add(n);
  // Reactive declarations, effect handles, and readonly names bind
  // through `const` at module level — every scope-visible one counts,
  // which is exactly the set the frame collectors walk.
  for (const n of emitter.collectReactiveNames(stmts)) names.add(n);
  for (const n of emitter.collectEffectHandles(stmts)) names.add(n);
  for (const n of emitter.collectReadonlyNames(stmts)) names.add(n);
  const declared = (s) => {
    if (!isNode(s)) return;
    if (s[0] === 'enum' && typeof s[1] === 'string') names.add(s[1]);
    if (s[0] === 'class' && typeof s[1] === 'string') names.add(s[1]);
    if (isDefHead(s[0]) && s.length === 4 && typeof s[1] === 'string') names.add(s[1]);
    if ((s[0] === '=' || s[0] === 'void-assign') && typeof s[1] === 'string') names.add(s[1]);
  };
  for (const s of stmts) {
    declared(s);
    if (isNode(s) && s[0] === 'export' && isNode(s[1])) declared(s[1]);
  }
  return names;
};

export function emit(parseResult, { source = '', runtimeDelivery = 'none', face = 'js', pins = null, strict = false } = {}) {
  if (!parseResult.sexpr) {
    throw new Error('emitter: cannot emit a failed parse');
  }
  if (face !== 'js' && face !== 'ts') {
    throw new Error(`emitter: unknown face '${face}' — expected 'js' (the shipping emission) or 'ts' (the editor face)`);
  }
  const stores = new Stores(parseResult.stores);
  const builder = new CodeBuilder(stores, { source });
  const emitter = new Emitter(stores, builder, { face, pins, strict });

  if (runtimeDelivery !== 'none' && runtimeDelivery !== 'import' && runtimeDelivery !== 'inline') {
    throw new Error(`emitter: unknown runtimeDelivery '${runtimeDelivery}' — expected 'none', 'import', or 'inline'`);
  }

  // TS directive comments: pair each whole-line `# @ts-…`
  // comment from the trivia channel with the statement it governs.
  // The file-level `@ts-nocheck` emits as the face's FIRST line —
  // ahead of any runtime injection — since TypeScript honors it only
  // before all code.
  emitter.collectTsDirectives(parseResult.sexpr, parseResult.trivia ?? [], source);
  if (emitter.tsNocheck !== null) {
    const programId = stores.idOf(parseResult.sexpr);
    const t = emitter.tsNocheck;
    builder.tsOnly(() => {
      const line = () => builder.emit('//' + t.text.slice(1));
      if (programId !== null) builder.markSpan(programId, 'tsDirective', t.start, t.end, line);
      else line();
      builder.emit('\n');
    });
  }

  // Delivery trigger: a module needs a feature runtime when it
  // references one of that runtime's names as a free identifier no
  // program-scope binding supplies — the seam's general rule
  // (reference a runtime name → get the runtime) — or when it carries
  // a construct whose EMISSION calls one (a schema declaration emits
  // `__schema(…)`; a registration-only module is delivered exactly
  // like a schema-bearing one). The decision walks EVERY tree the
  // module emits: the program plus each schema callable body — those
  // live as captured token slices invisible to a parent-tree walk, so
  // an effect inside a schema method must trigger from its sub-parsed
  // tree (shared with emission through the emitter's subParse cache).
  const trees = deliveryTrees(emitter, parseResult.sexpr);
  // Chain-temp names must dodge every identifier the module's
  // trees spell — atoms collect from the SAME tree set the delivery
  // decision walks (schema callable bodies included), before any
  // hoist walk can allocate.
  const collectAtoms = (x) => {
    if (typeof x === 'string') emitter.temps.used.add(x);
    else if (isNode(x)) for (const el of x) collectAtoms(el);
  };
  for (const { tree } of trees) collectAtoms(tree);
  const bound = programScopeNames(emitter, parseResult.sexpr);
  const runtimes = new Set();
  for (const rt of RUNTIME_TABLE) {
    const unboundSet = new Set(rt.names.filter((n) => !bound.has(n)));
    if (trees.some(({ tree, isDecl, isTrigger, isComponent }) =>
          rt.triggers?.(tree, { isTrigger, isComponent }) || referencesNames(tree, unboundSet, isDecl))) {
      runtimes.add(rt.key);
    }
  }
  // A runtime whose body depends on a sibling runtime delivers both —
  // in BOTH modes, so mode parity is exact (the toolchain path would
  // resolve the dependency through the module graph regardless).
  for (const rt of RUNTIME_TABLE) {
    if (rt.requires && runtimes.has(rt.key)) runtimes.add(rt.requires);
  }
  if (runtimeDelivery !== 'none') {
    // Injection units: one per delivered runtime, except inline mode
    // fuses a dependent runtime's body INTO its dependency's IIFE —
    // the bodies share one scope (the fragment model), and the fused
    // unit binds the union of names.
    const active = RUNTIME_TABLE.filter((rt) => runtimes.has(rt.key));
    const units = [];
    if (runtimeDelivery === 'import') {
      for (const rt of active) units.push({ names: rt.names, imp: rt.url.pathname });
    } else {
      const fused = new Set(active.filter((rt) => rt.requires).map((rt) => rt.requires));
      for (const rt of active) {
        if (fused.has(rt.key)) continue;
        if (rt.requires) {
          const dep = RUNTIME_TABLE.find((d) => d.key === rt.requires);
          units.push({ names: [...dep.names, ...rt.names], body: runtimeText(dep) + '\n' + runtimeText(rt) });
        } else {
          units.push({ names: rt.names, body: runtimeText(rt), types: rt.types });
        }
      }
    }
    const programId = stores.idOf(parseResult.sexpr);
    for (const unit of units) {
      const unboundNames = unit.names.filter((n) => !bound.has(n));
      if (unboundNames.length === 0) continue;
      const start = builder.offset;
      if (unit.imp) {
        builder.emit(`import { ${unboundNames.join(', ')} } from ${JSON.stringify(unit.imp)};\n`);
      } else {
        builder.emit(`const { ${unboundNames.join(', ')} }`);
        // Precise stdlib types on the TS face (the STDLIB_TYPE_DECLS
        // as a destructure annotation): the checker sees the declared
        // signatures instead of inferring anys through the IIFE.
        if (face === 'ts' && unit.types) {
          const members = unboundNames.filter((n) => unit.types[n]).map((n) => `${n}: ${unit.types[n]}`);
          if (members.length > 0) builder.tsOnly(() => builder.emit(`: { ${members.join('; ')} }`));
        }
        builder.emit(` = (() => {\n${unit.body}\nreturn { ${unit.names.join(', ')} };\n})();\n`);
      }
      // The injected text has no source: ONE synthetic row (zero-width
      // source anchor at the program's start) records it honestly —
      // reverse lookups see it; it never serializes into the source map.
      if (programId !== null) {
        builder.rows.push({
          nodeId: programId, role: 'runtime', mappingKind: 'synthetic',
          sourceStart: 0, sourceEnd: 0,
          generatedStart: start, generatedEnd: builder.offset,
          fileId: 0,
        });
      }
    }
  }

  // The schema type story (face only). Built once per module:
  // the intrinsic block emits at the top as ONE TS-only region with a
  // synthetic mapping row (the runtime-injection precedent — injected
  // text with no source), each schema's alias lines emit as TS-only
  // cover manifestations of THEIR schema node (a diagnostic landing
  // in an alias line cover-lands on the declaration that produced
  // it), and schemaExpr reads the per-node story for the binding cast
  // and the callable `this` parameters. TS type declarations hoist,
  // so top placement governs every scope. Collisions on the emitted
  // type names reject positioned.
  let schemaStory = null;
  if (face === 'ts') {
    let story = null;
    try {
      story = buildSchemaTypeStory(parseResult.sexpr);
    } catch (err) {
      if (err instanceof SchemaTypeError) {
        const e = new Error(`emitter: ${err.message}`);
        // A user-declaration offender positions through its node's
        // store span; descriptor-sourced offenders carry the offset.
        const id = err.node !== null ? stores.idOf(err.node) : null;
        const span = id !== null ? stores.selfSpan(id) : null;
        if (span) {
          e.start = span[0];
          e.end = span[1];
        } else if (err.start !== null) {
          e.start = err.start;
          e.end = err.start;
        }
        throw e;
      }
      throw err;
    }
    schemaStory = story;
    if (story !== null) {
      const programId = stores.idOf(parseResult.sexpr);
      const start = builder.offset;
      builder.tsOnly(() => builder.emit(story.intrinsicLines.join('\n') + '\n'));
      if (programId !== null) {
        builder.rows.push({
          nodeId: programId, role: 'schemaTypes', mappingKind: 'synthetic',
          sourceStart: 0, sourceEnd: 0,
          generatedStart: start, generatedEnd: builder.offset,
          fileId: 0,
        });
      }
      emitter.schemaStories = new Map();
      story.stories.forEach((s, i) => {
        emitter.schemaStories.set(s.decl.node, s);
        const exp = s.decl.exported ? 'export ' : '';
        const nodeId = stores.idOf(s.decl.node);
        // The last block carries the blank separator before the
        // program's own first line (still inside its region).
        const tail = i === story.stories.length - 1 ? '\n\n' : '\n';
        builder.tsOnly(() => {
          const lines = () => builder.emit(s.aliasLines.map((l) => `${exp}${l}`).join('\n'));
          if (nodeId !== null) builder.mark(nodeId, '$self', lines);
          else lines();
          builder.emit(tail);
        });
      });
    }
  }

  emitter.tsDirectivesArmed = true;
  emitter.program(parseResult.sexpr);
  // The module marker: the loader runs every .rip file as a Bun
  // ES module, so a face whose own syntax carries no import/export
  // must not present as a global SCRIPT — script-ness misrepresents
  // runtime semantics, and two such faces in one tsgo program
  // redeclare every shared top-level name (TS2451) and duplicate the
  // schema intrinsic aliases (TS2300): false diagnostics no runtime
  // collision backs. A TS-only `export {}` makes each face a module;
  // stripping it reproduces the JS emission exactly.
  if (face === 'ts' && !isModuleShaped(parseResult.sexpr, (s) => emitter.isModuleImport(s))) {
    builder.tsOnly(() => builder.emit('\nexport {};\n'));
  }
  // Pin candidates for the editor's probe pass: still-hoisted names
  // whose nested references break TS's evolving inference (TS7034).
  // Each carries its cache key (`${name}@${valueHash}` — stable across
  // offset shifts), plus the GENERATED spans the probe builder splices
  // with: the first-write statement's extent and its value expression.
  const pinnables = [];
  for (const { name, node, key } of emitter.pinnables) {
    if (key === null) continue;
    const id = stores.idOf(node);
    if (id === null) continue;
    const stmtRow = builder.rows.find((r) => r.nodeId === id && r.role === '$self');
    const valueRow = builder.rows.find((r) => r.nodeId === id && r.role === 'value');
    if (!stmtRow || !valueRow) continue;
    pinnables.push({
      name,
      key,
      stmtGen: [stmtRow.generatedStart, stmtRow.generatedEnd],
      valueGen: [valueRow.generatedStart, valueRow.generatedEnd],
    });
  }
  return { code: builder.code, mappings: builder.rows, stores, runtimes, tsRegions: builder.tsRegions, pinnables };
}

// The strip transform: delete the recorded TS-only regions from a
// TS-face emission. Deterministic and mechanical — regions were
// recorded as the face emitted them (never scanned out of generated
// text), ascending and disjoint by construction. The strip gate
// (test/tsface.test.js) holds this equal to the JS-mode emission
// byte-for-byte across the corpus.
export function stripFace(code, tsRegions) {
  let out = '';
  let cursor = 0;
  for (const [start, end] of tsRegions) {
    out += code.slice(cursor, start);
    cursor = end;
  }
  return out + code.slice(cursor);
}
