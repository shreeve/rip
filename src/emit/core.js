// The Emitter class: construction state; the statement and expression
// dispatch; the grouping lattice; marks, positioned errors and source
// channels; the reactive-declaration and import/export predicates; the
// program entry (data section and binding, HMR component table, schema
// constants, module seeds); and the REPL slot, resolver and capture.
// The per-construct lowerings live in the area modules beside this one;
// src/emit/emitter.js installs them onto Emitter, and every method
// dispatches through `this`, so any area may call any other. Emitter is
// complete only once emitter.js has loaded: the areas import this class
// to extend it, so every consumer enters through emitter.js.

import { MappingBuilder } from './mapping.js';
import { isIdentifierName } from '../ident.js';
import { suggestAttribute } from '../dom.js';
import { wordSafety } from './names.js';
import { declaresContainer } from '../ts/components.js';
import { P_AWAIT, P_YIELD, P_IT, P_RETURN, P_CTRL } from './analyze.js';
import { isHeadless, toParser, NodeMap, NodeWeakMap, NodeWeakSet } from '../emitter-shape.js';
import { isCall, isPlainCall, isAwaitedCall, isNode, wordOf } from '../sexpr.js';
import { ASSIGNS, isAssignHead, PATTERN_HEADS, isShapedNode, isBinary, SPINE_HEADS, isRubyNew, isUnary, isAssign, isRelation, isIf, isRange, isObjectShape, isFunc, isChildren, isDefHead, isUpdate, isTernary, isComprehensionNode, isModuleImportNode } from './helpers.js';

// Does this subtree await — i.e. is the function owning it ASYNC? A
// `dammit` call (`f!`) awaits, and an awaited for-as carries its await
// in a flag slot rather than a nested node. Nested function and class
// bodies own their own awaits, so the walk stops at them — an effect's
// body among them: it emits as the effect's own function, async when it
// awaits. The NodeStore row identifies the effect (a plumbing list can
// begin with the name `effect`), so the walk takes the stores. Exported
// for the same
// reason as containsYield below: the return type it decides is spelled
// independently by the face and by the declarations.
export function containsAwait(sexpr, stores) {
  if (!isShapedNode(sexpr)) return false;
  if (isHeadless(sexpr)) return sexpr.some((item) => containsAwait(item, stores));
  const head = sexpr[0];
  if (head === 'await' || (isCall(sexpr) && sexpr[1].await === true)) return true;
  if (head === 'for-as' && sexpr[3] === true) return true;
  // A class body owns its awaits; its heritage evaluates in this scope.
  if (head === 'class') return containsAwait(sexpr[2], stores);
  if (head === '->' || head === '=>' || isDefHead(head) || Emitter.isEffectDeclIn(stores, sexpr)) return false;
  return sexpr.some((item) => containsAwait(item, stores));
}

// Does this subtree yield — i.e. is the function owning it a GENERATOR?
// Nested function and class bodies own their own yields, so the walk
// stops at them. Exported because a generator's return type is decided
// in three places that must agree: the TS face (tsReturnAnnotation), the
// shipped declarations (src/ts/dts.js), and the component companion
// (src/ts/components.js, which mirrors this rather than importing it —
// the emitter imports THAT module, so the edge cannot run both ways).
export function containsYield(sexpr) {
  if (!isShapedNode(sexpr)) return false;
  if (isHeadless(sexpr)) return sexpr.some((item) => containsYield(item));
  const head = sexpr[0];
  if (head === 'yield' || head === 'yield-from') return true;
  // A class body owns its yields; its heritage evaluates in this scope.
  if (head === 'class') return containsYield(sexpr[2]);
  if (head === '->' || head === '=>' || isDefHead(head)) return false;
  return sexpr.some((item) => containsYield(item));
}

export class Emitter {
  constructor(stores, builder, { face = 'js', pins = null, strict = false, script = false, browserModule = false, repl = false, hmr = false, tolerant = false, modulePath = null, appStashSpec = null, routesUnion = null, routeParams = null } = {}) {
    this.stores = stores;
    this.b = builder;
    // repl emission: the final top-level expression statement lands
    // in the minted result slot; top-level static imports lower to
    // awaited dynamic imports. Off by default with zero effect —
    // the slot name mints lazily, so the used-name registry and the
    // temp allocator are untouched when off.
    this.repl = repl;
    // The editor's face compile: a shape the tolerant parse invented
    // (an unclosed literal that swallowed the next statement) must
    // still emit, so the dead-code rejections stand down here.
    this.tolerant = tolerant;
    // The lexer's channels an identifier search over the SOURCE consults
    // (collectSourceChannels): string, regex, and comment spans no hit
    // may land in, and the statement ends a search starts after.
    this.opaqueSpans = [];
    this.terminatorStarts = [];
    this.replResultName = null;
    this.replImportResolver = null;
    this.dataFn = null;
    this.dataBodyAt = 0;
    // Script-target emission: <script type="text/rip"> sources share one
    // page scope and are not modules, so every module form rejects at
    // its own position instead of emitting bytes new Function cannot take.
    this.script = script;
    // The relative specifier from this module to the app's stash module,
    // when the CALLER discovered one (check.js and the editor own the
    // project-anchor walk; the compiler stays pure). Types the `app`
    // ambience and the render gates; null leaves both `any`.
    this.appStashSpec = appStashSpec;
    // The project's route-union TS text and this module's own params
    // shape, when the CALLER discovered them (the same anchor walk as
    // the stash; the compiler stays pure). The union arms href /
    // push / replace literal checking and the ambient `RoutePath`;
    // null leaves every route surface unchecked. `routeParams` is
    // non-null only when THIS module is a route file with named
    // params — it tightens the component's `params` ambience.
    this.routesUnion = typeof routesUnion === 'string' && routesUnion.length > 0 ? routesUnion : null;
    this.routeParams = typeof routeParams === 'string' && routeParams.length > 0 ? routeParams : null;
    // The local bindings of the app barrel's accessors (`currentStash`,
    // `currentRouter` imported as values from 'rip/app'), null for one
    // the module does not import. A call of either is a checked
    // receiver alongside the ambient `@stash` / `@router`.
    this.appAccessors = { stash: null, router: null };
    // Generated spans of each route-checked surface, KEY and VALUE: on
    // an ATTRIBUTE surface (intrinsic `a href:`, a child component's
    // `href:` prop) the key is the pair's key and the value is the
    // `__ripRoute`-wrapped literal; on a ROUTER surface
    // (`this.router.push`/`.replace`, or the accessor's, with a literal
    // argument) the key is NULL and the value is the argument literal —
    // a mismatch stays on the literal, where tsgo anchors a call
    // argument, and the span records so completions know the slot is
    // route-constrained. The diagnostics road moves a mismatch covering
    // EXACTLY a keyed value onto its key; an unrecorded call (an
    // array's `.push`) can never match. Recorded at emission, TS face
    // only.
    this.routeWrapSpans = [];
    // Per member initializer: the member NAME's source span and the
    // lowered write's left-hand side (`this.name`) in generated
    // coordinates — bytes the author never wrote, so a complaint
    // standing on exactly that side is about the member and lands on
    // its name, where tsgo anchors a declaration's own mismatch. TS
    // face only.
    this.memberInitSites = [];
    // Generated spans of each `__ripSourceKey`-wrapped literal, and of
    // the member NAME of each ambient `@stash.<name>` access: a
    // mismatch covering exactly one is a stash-key miss, a member miss
    // covering exactly one is on the stash, and the diagnostics road
    // words each from these records — never from the checker's
    // sentence. TS face only.
    this.sourceKeySpans = [];
    this.stashMemberSpans = [];
    // The intrinsic-element surfaces this module's render lowering cast
    // to (`__RipEl_<tag>` — src/ts/dom-types.js), keyed by surface name;
    // the emit() tail declares exactly these. `_needsClassValue` arms
    // the `__RipClassValue` alias whenever the components runtime's
    // types assertion references it (with or without any element);
    // `_needsRefCellHelper` arms the `__ripRefCell` declares when a
    // ref wrap emitted. TS face only.
    this.domSurfaces = new Map();
    this._needsClassValue = false;
    this._needsCssProperties = false;
    this._needsChildren = false;
    this._restTags = new Set();
    this._needsRefCellHelper = false;
    // SOURCE spans of intrinsic-element positions whose ruled hover the
    // editor SERVES from the compiler's own record rather than from a
    // tsgo symbol (RULINGS.md, the render rows): the element TAG word
    // (its face position is a string literal, which carries no symbol)
    // and the `ref` channel word (spent whole by the lowering). Each
    // row carries what the served answer is built from — the tag, its
    // namespace, and for `ref` the cell's name. TS face only.
    this.intrinsics = [];
    // Per `__ripIndexed(…)` wrap of an indexed loop's iterable: the
    // argument's generated span, the loop head's source span, the head's
    // spelling and the `for … of` spelling the report suggests, and
    // whether this wrap is the loop's reporting one (mapTsDiagnostic).
    // TS face only.
    this.indexedLoops = [];
    // SOURCE span and spelling of every component tag's constructor
    // reference, where a construction of a non-component reports
    // (mapTsDiagnostic). TS face only.
    this.componentUses = [];
    // The names this module publishes with `export * as`: tsgo emits no
    // token for a binding that resolves to a module, so an importer's
    // editor colors it from this record.
    this.namespaceExports = [];
    // The module-scope component bindings, for the same reason: tsgo emits
    // no token for an import specifier, so an importer's editor colors an
    // imported component from this record.
    this.componentNames = [];
    // Per module-scope component, the props a construction must pass —
    // what a missing-prop diagnostic names (packages/vscode/src/diagnostics.js).
    this.componentProps = {};
    // Exported object literals whose every pair's value is a bare name
    // (`export Controls = { Panel, Row: Panel }`), as [name, values].
    // Filtered against componentNames once the module is emitted — a
    // component may be declared below the object that holds it — into
    // partNames: the objects an importer's tag qualifies through, which
    // tsgo tokens as the variables their declarations made.
    this.exportedObjects = [];
    // Per render pair: the key's and the pair's SOURCE spans, and the
    // road's relation sites in GENERATED coordinates — the diagnostics
    // road's anchor table (WHERE A PAIR'S DIAGNOSTIC LANDS, below).
    this.renderPairs = [];
    this.browserModule = browserModule;
    // HMR metadata on module-scope named components. Off by default —
    // production emission must stay byte-identical when hmr is false.
    this.hmr = hmr === true;
    this.modulePath = typeof modulePath === 'string' && modulePath.length > 0 ? modulePath : null;
    // Emitted module-specifier spans, RECORDED at emission (never
    // rediscovered by scanning output): the browser module loader
    // splices resolved specifiers by these exact offsets.
    this.importSpans = [];
    // The runtime import statements, [start, end) per statement: a
    // diagnostic standing there means the runtime did not resolve or
    // carries no declaration, which leaves every injected name `any`.
    this.runtimeImports = [];
    // Imported bindings the running program never references — the face
    // keeps them (they are real types there), the JS emission does not
    // (analyze.js's typeOnlyImports).
    this.typeOnlyImports = new Set();
    // Tier 3 pins (TS face only): Map of `${name}@${valueHash}` → type
    // text, supplied by the editor's probe pass. Names the scan reports
    // as pinnable (still hoisted + nested occurrence) collect in
    // `pinnables` for the emit() result, whatever face is running.
    this.pins = pins;
    this.pinnables = [];
    // First-write nodes whose hoist line took a pin. The pin is the
    // write's own inferred type, so the write never needs it as a
    // contextual type — and under rip.strict it must not have it: a
    // contextual `any` is not an implicit one, so the pin would silence
    // TS7006 at exactly the parameters an unpinned definition reports.
    this.pinnedWrites = new Set();
    // Generated `[start, end]` spans of `:=` state names. The face binds the
    // CELL with `const`, but rip lets you assign to the NAME (`clicks = 5` →
    // `clicks.value = 5`), so TypeScript's `readonly` classification describes
    // the container, not the binding the author writes to. Only the emitter can
    // tell them apart — `=!`, `~=` and `~>` also emit `const` and really are
    // immutable — so it reports the state names and the editor clears the
    // modifier on those alone. Recorded at EVERY occurrence, not the
    // declaration alone: `readonly` describes the BINDING, so a name
    // cleared where it is declared and painted immutable where it is
    // written and read is three colors for one binding, and the write
    // site is the position that proves the classification false.
    this.mutables = [];
    // Generated `[start, end]` spans of a hoisted CLASS-EXPRESSION binding's
    // declaration name. TypeScript classifies a binding from its
    // DECLARATION's initializer, so `let Shape = class {…}` colors `class`
    // and needs nothing — but a forward reference splits the declaration
    // from the class expression (`let Box;` … `Box = class {…}`), and the
    // initializer tsgo would have read is not there. The name is the
    // author's class either way, so the color is corrected rather than the
    // hoist changed. Components ride this too: one lowers to a class
    // expression, and a forward-rendered child is ordinary library shape.
    this.classDecls = [];
    // Generated `[start, end]` spans of a PIN's type text: the annotation
    // itself, never the name it lands on. A pin is a type the compiler
    // INFERRED and wrote into the face, and it is an ordinary annotation
    // there — so a reader asking whether a position was ANNOTATED cannot
    // tell it from the author's own, and takes every pinned position for
    // a claim. Recorded here because only the emitter knows which
    // annotations it wrote itself. Two bindings can share one hoist line,
    // one pinned and one the author's, so the span is the unit.
    this.pinSpans = [];
    // Generated `[start, end]` spans of a RENDER loop's item/index binding
    // names, every occurrence. The render path lowers the loop body to a
    // block-function factory, so in the face the binding genuinely IS a
    // parameter — the factory header, the keyed callback, every read — and
    // tsgo classifies it so. The author declared a loop variable; the
    // editor repaints exactly these spans. A handler's `(e) ->` parameter
    // is a parameter in the source too and is never recorded — the scope
    // walk decides, never the spelling.
    this.loopVars = [];
    // A render loop variable's declaring parameters — every block factory
    // and keyed callback that carries it — each with the loop's factory
    // record and which of its variables it declares. Each copy is its own
    // TypeScript symbol, so a copy the lowering merely threads through
    // draws TS6133 while the author's variable is read. `emit` keeps the
    // spans of variables some emitted read resolved to (the record's
    // `readVars`), and the editor drops the unused hint on exactly those.
    this.loopVarDecls = [];
    // Generated `[start, end]` spans of RENDER ATTRIBUTE names — a
    // component call's prop keys, every spelling. A plain key survives
    // into the ctor object verbatim, so its `property` token maps and
    // forwards, while a two-way bind's MINTED key (`__bind_value__`)
    // maps nowhere verbatim and drops — adjacent attributes in two
    // colors. The ruling suppresses rather than synthesizes: the editor
    // drops the token on exactly these spans, every attribute falls back
    // to the TextMate attribute scope, and no token is ever invented at
    // a span the mapper could not verify. TS face only.
    this.attrNames = [];
    // Generated spans of every reference to an IMPORTED name, each with
    // the module it came from: `[start, end, name, specifier]`. One
    // file's compile cannot know an imported name's KIND — that lives in
    // the declaring module — so the compiler reports WHERE to ask and
    // WHOM, and the editor resolves.
    this.importedRefs = [];
    // The names runtime delivery injects into this module — name →
    // `{ runtime, typed }`, where `typed` says the TS face asserts a
    // signature for the name (a name the runtime table does not type
    // rides as `any`). Filled by delivery before the program emits.
    this.injected = new Map();
    // Generated spans of each free SOURCE reference to an injected name:
    // `[start, end, name, runtime, typed]`. A reference an enclosing
    // scope binds (a parameter spelled like the name) is not one; a
    // member or key spelled like it never reaches this funnel. Checkers
    // read it to report what a module uses untyped. TS face only.
    this.runtimeRefs = [];
    // While a compiled schema callable's text re-emits here, the names
    // that callable binds (its parameters, its locals): a word among
    // them is the callable's own, whatever the enclosing scopes say.
    this.schemaBodyBound = null;
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
    // TS directive comments (TS face only): statement node → the
    // directives governing it (collectTsDirectives' attachment
    // pre-pass), and the file-level `@ts-nocheck` record.
    this.tsDirectiveMap = new NodeMap();
    this.tsNocheck = null;
    // Analysis's scope facts (useAnalysis): each hoisting scope's by its
    // statement list's first node id, the program's, each class field
    // value's reference plans by the value's id, and the predicate bits
    // of every node by its id.
    this.hoists = new Map();
    this.programHoist = null;
    this.fieldPlans = new Map();
    this.frames = new Map();
    this.predicates = null;
    // Bodiless overload signatures (def-sig) keyed by the implementing
    // def node (TS face only): the def's emission prints each signature
    // immediately above itself — TypeScript requires overload
    // signatures adjacent to their implementation (TS2391).
    this.pendingSigs = new NodeWeakMap();
    // Type declarations from SLOTLESS lowered positions (TS face only):
    // a ternary-lowered value-if branch has no statement slot, so its
    // type/interface declarations queue here and flush as TS-only
    // cluster lines after the enclosing statement — TS hoists type
    // declarations, so the displaced line still governs its uses.
    this.pendingTypeDecls = [];
    // Sibling-role source regions the primitive claim must SKIP while emitting a
    // part whose frame is wider than the part itself — a comprehension's clause,
    // which has no role of its own and would otherwise claim out of the body.
    // Null everywhere else; set tightly around one emission and always restored.
    this.primitiveAvoid = null;
    this.primitiveReuse = null;
    // Inside an emission that WRITES A NAME BEING DECLARED (a parameter,
    // a class member). The token-correction channels record references,
    // and a declaration of the same spelling is not one — see
    // withDeclaredName.
    this.declaringName = false;
    // Source spans the compiler CONSUMES as its own vocabulary: words that are
    // syntax in their position and reach no face entity, so no honest mapping
    // row can exist for them. Recorded (TS face only) so the mapping census can
    // subtract them from a population of reads that SHOULD resolve — never so a
    // read that could have a row is excused from having one. Each carries the
    // kind that says why, and the audit judges its exclusion table against the
    // kinds that actually appear.
    this.vocabulary = [];
    // Source spans where the EDITOR declines rather than describing what
    // the lowering put there — a different question from `vocabulary`,
    // which records words the compiler CONSUMES and the mapping census
    // nets out of its population. A ref cell's name and a bind's
    // right-hand name are real reads that DO reach the face, so they
    // stay in that population; they are silent only because at THIS
    // position they are a channel's target, which no answer about the
    // container the lowering wrote through describes honestly.
    this.silences = [];
    // Component member DECLARATION name spans (TS face only): the source
    // position where the author declared a member, paired with whether the
    // face types it through the lowering's own behavior object. A
    // declaration speaks the author's vocabulary — the member was written
    // `people := []` and reads as an array — where a CONSUMER holding an
    // instance really does write `ref.people.value`, so the container the
    // face declares is right at consumer positions and wrong here. The
    // editor needs the distinction and cannot derive it: both positions
    // resolve to the same face symbol.
    this.memberDecls = [];
    // Source spans of a bare member read or passed under the branch that
    // tested it: the face narrows the REFERENCE (`ctx.found.value`), and a
    // hover on the name lands on the member, so the editor drops the
    // nullish arms here itself. Live only inside an effect body that
    // opened a guard, never a nested function's.
    this.narrowedDecls = [];
    this._narrowedReads = null;
    this._textOwner = null;
    // Minted KIND labels: a declaration's own name span and the word rip
    // spells that construct with. The lowering's `const`/`let` describes the
    // cell it binds, never the construct the author declared — the same leak
    // the token audit refuses in the COLOR, refused here in the words.
    this.kinds = [];
    // Component type stories (TS face only): component node →
    // the walked member/props info. Populated by componentExpr (the
    // one place the member model is authoritative), consumed by the
    // companion-interface emission after the binding statement.
    this.componentInfo = new NodeMap();
    this.schemaFns = new NodeMap();
    // Schema nodes whose behavior object is owed and not yet placed:
    // set by schemaExpr, cleared by tsSchemaBehavior, checked empty when
    // the program has emitted.
    this.schemaBehaviorPending = new NodeMap();
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
    // The bare or `@` method name a reference position is emitting (a
    // callee, a member access's object, a delete operand): that read is
    // the method itself, not a value passed (boundMethodRead).
    this.calleeName = null;
    // Function nodes whose DEFINITION carries the void marker
    // (`save! = ->`, `fn!: ->`): their bodies suppress the implicit
    // return and end with a bare `return;`. Registered by the owning
    // definition's emission before the value emits (a void def
    // carries the marker in its own head and needs no registration).
    this.voidFuncs = new NodeWeakSet();
    // True while emitting the statements of a void function's body —
    // a value-carrying `return` there is an error (the function is
    // declared to return undefined). Saved/restored per function.
    this.sideEffectOnly = false;
    // Why the current void body is void, when the reason is not the
    // trailing `!` (a setter, say) — the return-value error names it.
    this.voidReason = null;
    // Set by schemaExpr — the emit() entry reports it as the 'schema'
    // feature runtime so delivery can inject exactly when used.
    this.usesSchema = false;
    // Current expression-descent depth — the deterministic nesting
    // bound: every recursive cycle in the emitter passes
    // through expr(), so one counter bounds the native stack and a
    // too-deep tree rejects as a positioned diagnostic instead of an
    // engine RangeError at a machine-dependent depth.
    this.exprDepth = 0;
    this.renderRecord = null;
    this.postfixGuardDepth = 0;
    // The binding name a schema value takes (assignment threading).
    this._schemaName = null;
    // Each schema code site's statements, keyed by the slice the
    // descriptor holds for it (emitterShape's side table): read by the
    // delivery decision (emit() walks them for runtime triggers before
    // any code emits) and by emission.
    this.schemaCode = new Map();
    // Generated runtime calls use aliases minted against every source
    // atom. Delivery fills this before emission; ordinary programs keep
    // the runtime's public spelling and therefore preserve their bytes.
    this.runtimeAliases = new Map();
    // Chained-comparison temps: a chain's middle operand with
    // a node shape (any compound — re-evaluation is observable, down
    // to valueOf/toString coercion) caches in a fresh `_ref` hoisted
    // at the owning scope's let line, so it evaluates exactly once
    // `byNode` keys each allocation on the chain's middle operand;
    // `used` holds every identifier the module's
    // trees spell (filled by emit() before any allocation) so fresh
    // names never collide; `n` is the monotonic allocation cursor.
    // Shared with sub-emitters (schema callable bodies).
    this.temps = { used: new Set(), n: 0, byNode: new NodeWeakMap() };
    // Live-range reservations (liveTemp), innermost last: each entry is
    // [set, name] — the used set the name joined and the name itself —
    // released when the liveScope that minted it closes.
    this.liveTemps = [];
    // The kind of each open liveScope, innermost last: 'construct' (a
    // loop, a pick), 'switch' (one block every case clause shares), or
    // 'body' (a function body, which no outer block's clauses reach).
    this.liveKinds = [];
    // Reference-capture plans' temps, keyed by the assignment node:
    // minted as the owning scope hoists (planTemps), consumed verbatim at
    // emission.
    this.refPlans = new NodeWeakMap();
    this.ctrlDepth = 0;
    this.loopDepth = 0;
    this.tailReturnOk = false;
    // Reactive scope frames, innermost last: { reactive, bound }.
    // `reactive` is the set of names the frame's scope declares with
    // `:=`/`~=`; `bound` is every OTHER binding the scope introduces
    // (params, hoist targets, imports, defs/classes, loop
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
    // Component-frame depths at which an object-literal method or a
    // class body rebinds `this` away from the innermost component.
    this.thisBoundaries = [];
    // The binding name a component value takes (assignment threading —
    // the _schemaName pattern); drives the data-part attribute.
    this._componentName = null;
    // Module bindings outside the hoist line (exports, classes, defs)
    // — the child-component name resolution's second channel.
    this.moduleBound = new Set();
    // The frame name sets of parameterless functions that bound an
    // implicit `it` they never assign: theirs answers no other
    // function's bare `it`.
    this.implicitItScopes = new WeakSet();
    // A sub-emitter's parent source: its own builder has none, and the
    // body's nodes index the parent's.
    this.parentSource = null;
    // The render-factory self prefix: null everywhere except
    // inside a block factory's deferred emission, where component
    // members and `this`/`@` chains read through the factory's `ctx`
    // parameter (the factory methods are called unbound — `this` there
    // is the block handle, never the instance).
    this.renderSelf = null;
    this.projectionHost = null;
  }

  // Is this node a REAL reactive declaration? The head alone cannot say:
  // a plumbing list (a parameter, specifier or condition list) begins with the user's first name, and `when state, a, b` builds ['state', 'a', 'b']. The
  // NodeStore semanticKind decides everywhere (the locked-head record).
  isReactiveDecl(x) {
    return Emitter.isReactiveDeclIn(this.stores, x);
  }

  // The stores-parameterized twin: the delivery decision walks schema
  // sub-trees, whose semanticKinds live in the SUB-parse's stores.
  static isReactiveDeclIn(stores, x) {
    if (!isShapedNode(x) || (x[0] !== 'state' && x[0] !== 'computed') || x.length !== 3) return false;
    const id = stores.idOf(x);
    const kind = id !== null ? stores.node(id)?.semanticKind : null;
    return kind === 'state' || kind === 'computed';
  }

  isGateDecl(x) {
    return Emitter.isGateDeclIn(this.stores, x);
  }

  static isGateDeclIn(stores, x) {
    if (!isShapedNode(x) || x[0] !== 'gate' || x.length < 3) return false;
    const id = stores.idOf(x);
    return (id !== null ? stores.node(id)?.semanticKind : null) === 'gate';
  }

  // A REAL effect — the same discrimination as the reactive
  // declarations (a plumbing list can begin with the name `effect`).
  // Covers both the bare form (target null) and the bound form (the
  // dispose handle).
  isEffectDecl(x) {
    return Emitter.isEffectDeclIn(this.stores, x);
  }

  static isEffectDeclIn(stores, x) {
    if (!isShapedNode(x) || x[0] !== 'effect' || x.length !== 3) return false;
    const id = stores.idOf(x);
    const kind = id !== null ? stores.node(id)?.semanticKind : null;
    return kind === 'effect';
  }

  // A REAL readonly declaration — the same discrimination (a plumbing
  // list can begin with the name `readonly`).
  isReadonlyDecl(x) {
    return Emitter.isReadonlyDeclIn(this.stores, x);
  }

  static isReadonlyDeclIn(stores, x) {
    if (!isShapedNode(x) || (x[0] !== 'readonly' && x[0] !== 'void-readonly') || x.length !== 3) return false;
    const id = stores.idOf(x);
    const kind = id !== null ? stores.node(id)?.semanticKind : null;
    return kind === 'readonly';
  }

  // The locked-head discriminator for LITERAL constructs: a node whose
  // head spells a construct ('array', 'str', 'map', …) is the REAL
  // construct only when its NodeStore row says so (the grammar rules
  // annotate the semanticKind) or when it has no row at all (emitter-
  // synthesized lowerings). A plumbing list that begins with such a
  // name carries a row of no kind.
  lockedHead(node, kind) {
    const id = this.stores.idOf(node);
    if (id === null) return true;
    return this.stores.node(id)?.semanticKind === kind;
  }

  // A REAL postfix type operator — `["cast", value, "T"]` /
  // `["satisfies", value, "T"]` — never a plumbing list beginning with
  // either name. The walks that skip the operator's type slot ask this,
  // or they would skip a list element.
  isPostfixType(x) {
    return Emitter.isPostfixTypeIn(this.stores, x);
  }

  static isPostfixTypeIn(stores, x) {
    if (!isShapedNode(x) || (x[0] !== 'cast' && x[0] !== 'satisfies') || x.length !== 3) return false;
    const id = stores.idOf(x);
    return id === null || stores.node(id)?.semanticKind === x[0];
  }

  // Every row whose evaluation invokes a function, whatever the callee
  // spells: `f!` is the awaited call, a tagged template calls its tag.
  static CALL_KINDS = new Set(['call', 'optcall', 'super', 'dammit', 'maybe-dammit', 'tagged', 'dynimport']);

  // A call standing where a destructuring pattern needs a write target.
  // The pattern is an Array/Object literal reinterpreted as a target, so
  // the grammar parses any element there. A call's result is never
  // assignable.
  rejectCallTarget(p) {
    if (isShapedNode(p) && Emitter.CALL_KINDS.has(this.semanticKindOf(p))) {
      throw this.positionedError(p, "emitter: a call cannot be a destructuring target — a pattern element writes a name or a member, and a call's result is neither");
    }
  }

  // A pattern element writes a name or a member; anything else the
  // grammar parses there would ship as invalid JavaScript (`[a + b] = x`,
  // `[a?.b] = x`), and a literal would reach the hoist line as `let 1`.
  // `at` is the enclosing pattern, which positions a leaf.
  rejectNonTarget(p, at) {
    const reject = (what, why = 'a pattern element writes a name or a member, and this is neither') => {
      throw this.positionedError(p, `emitter: ${what} cannot be a destructuring target — ${why}`, at);
    };
    if (typeof p === 'string') {
      if (!isIdentifierName(p)) reject(`the literal \`${p}\``);
      return;
    }
    if (isHeadless(p) || PATTERN_HEADS.has(p[0])) return;
    if (!SPINE_HEADS.has(p[0])) reject(`a '${p[0]}' expression`);
    for (let link = p; isShapedNode(link) && SPINE_HEADS.has(link[0]); link = link[1]) {
      if (link[0] === '?.' || link[0] === 'optindex') reject('an optional chain', "JavaScript has no write through '?.'");
    }
    const key = p[2];
    if (p[0] === '[]' && (isRange(key) || (typeof key === 'string' && key[0] === '/'))) {
      reject('a range or regex index', "its read lowers to a call, and a call's result is not assignable");
    }
  }

  // An object literal.
  isObject(x) {
    return isObjectShape(x);
  }

  // A statement block.
  isBlock(x) {
    return isShapedNode(x) && x[0] === 'block' && !isHeadless(x);
  }

  // A constructor spine with no call in it: a name or literal, or a
  // member/index chain rooted at one. Only such a spine may stand bare as
  // the constructor of `.new`.
  // An index whose read lowers to a call — a range (`.slice()`), a
  // negative literal (`.at(-n)`), a regex key (the match read) — is a
  // call in the output, so it is not pure: printed bare, `new` would
  // construct the method.
  pureSpine(x) {
    if (typeof x === 'string') return true;
    if (!this.isSpine(x) || isRubyNew(x)) return false;
    if (x[0] === '[]' || x[0] === 'optindex') {
      const key = x[2];
      if (isRange(key) || Emitter.negativeLiteralKey(key) || (typeof key === 'string' && key[0] === '/')) return false;
    }
    return this.pureSpine(x[1]);
  }

  // A member/index link.
  isSpine(x) {
    return isShapedNode(x) && typeof x[0] === 'string' && SPINE_HEADS.has(x[0]);
  }

  // The semanticKind the grammar annotated on a node's row, or null for
  // a node with no row (an emitter-synthesized lowering).
  semanticKindOf(node) {
    const id = this.stores.idOf(node);
    return id !== null ? this.stores.node(id)?.semanticKind ?? null : null;
  }

  // A MODULE import statement: the node the import rules build
  // (semanticKind 'import'; a dynamic import is a call).
  isModuleImport(x) {
    return Emitter.isModuleImportIn(this.stores, x);
  }

  static isModuleImportIn(stores, x) {
    return isModuleImportNode(stores, x);
  }

  // Does `name` resolve to an exported const at this point? The walk
  // is the ambient-readonly walk's shape: innermost frame first, and
  // any nearer binding (a parameter, an inner declaration, a loop or
  // catch binding, a component member) answers first — shadowing is
  // never a write to the export.
  isExportedConst(name) {
    for (let i = this.rframes.length - 1; i >= 0; i--) {
      const f = this.rframes[i];
      if (f.reactive.has(name)) return false;
      if (f.exportedConst !== undefined && f.exportedConst.has(name)) return true;
      if (f.bound.has(name)) return false;
      if (f.members !== undefined && f.members.has(name)) return false;
    }
    return false;
  }

  // The exported-const write guard — called with an assignment/update
  // TARGET before emission, at every head that writes a bare name.
  // Rejecting is the whole point: the two lowerings collide otherwise
  // (the hoist pass mints `let flag;` for the write while the export
  // pass mints `export const flag = 1;`, and the module does not
  // build), and no emission of a write to a const is correct anyway.
  // Member and index targets are untouched — those mutate the exported
  // VALUE, which a const binding permits.
  // An import binding is read-only for the whole module: JavaScript throws
  // on the write at runtime, which is the loud error in the wrong place.
  // A name or a pattern, the same as an exported const; a nearer binding
  // of the name (a parameter, a local) shadows the import and writes freely.
  checkImportWrite(node, target) {
    const names = typeof target === 'string'
      ? [target]
      : (Emitter.isPattern(target) ? this.patternNames(target) : []);
    for (const name of names) {
      const spec = this.importSpecOf(name);
      if (spec === null) continue;
      throw this.positionedError(node,
        `emitter: cannot assign to imported '${name}' — an import binding (from '${spec.specifier}') is read-only ` +
        `for the whole module; bind a local to it ('local = ${name}') or have the module export writable state`);
    }
  }

  checkExportedConstWrite(node, target) {
    const names = typeof target === 'string'
      ? [target]
      : (Emitter.isPattern(target) ? this.patternNames(target) : []);
    for (const name of names) {
      if (!this.isExportedConst(name)) continue;
      throw this.positionedError(node,
        `emitter: cannot assign to exported '${name}' — an exported binding lowers to ` +
        `'export const', which never changes after its declaration; declare it as state ` +
        `('export ${name} := …') to write it, or drop the export`);
    }
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
  // primitives with no NodeStore row: the span is DERIVED from recorded
  // neighbor rows, never invented.
  positionedErrorAt(start, end, message) {
    const err = new Error(message);
    err.start = start;
    err.end = end;
    return err;
  }

  // Emit a primitive atom through its parser-recorded occurrence span.
  // Primitive tree values have no identity, so the current node/role frame and
  // its occurrence cursor supply the join. TS-face only: these rows serve the
  // editor position surface and do not revise shipping source-map artifacts.
  //
  // LITERAL spellings take a row too, not identifiers alone. A re-rendered
  // literal (`'b'` → `"b"`) is not verbatim-equal to its source bytes, so the
  // builder calls the row `cover` — but the SPAN is the lexer's own and is
  // exactly right, and a resolver that finds no exact row falls to the
  // innermost cover it can see. Without a row of the literal's own that is the
  // enclosing element list, so a diagnostic on one element paints them all.
  // The role names which the value is; `mappingKind` stays the builder's
  // verbatim call, never declared here.
  emitPrimitive(value) {
    const owner = this.b.currentMark;
    let span = this.ts && typeof value === 'string'
      ? this.b.claimPrimitiveSpan(value, this.primitiveAvoid) : null;
    // A lowering that re-reads a name it has no occurrence for (a child
    // component's name, spelled again in its event casts) names the
    // occurrence it repeats ahead of the emission: the copy maps there.
    if (span === null && this.primitiveReuse !== null && this.primitiveReuse.name === value) {
      span = this.primitiveReuse.span;
      this.primitiveReuse = null;
    }
    // The KIND rides the claimed span alone — an open mark is what a
    // mapping ROW needs, not what naming the construct needs, and a read
    // emitted outside one answers about the same declaration.
    if (span !== null && isIdentifierName(value)) {
      const k = this.kindOfName(value);
      const kind = typeof k === 'string' ? { label: k, optional: false } : k;
      if (kind !== null) this.kinds.push({ start: span[0], end: span[1], label: kind.label, name: value, optional: kind.optional });
    }
    if (owner !== null && span !== null) {
      const role = isIdentifierName(value) ? 'identifier' : 'literal';
      this.b.markSpan(owner.nodeId, role, span[0], span[1], () => this.noteNameSpan(value));
    } else {
      this.noteNameSpan(value);
    }
    return span; // the claimed SOURCE span, for callers that record it
  }

  // Emit a name, recording the token-correction channels it belongs to.
  // Both are the same question asked of one emission — which SPANS does
  // the editor have to repaint, because the face's own classification
  // describes the lowering rather than the binding — so they share the
  // funnel every identifier already passes through, and the scope walks
  // decide, never the spelling.
  noteNameSpan(value) {
    if (!this.ts || this.declaringName || typeof value !== 'string' || !isIdentifierName(value)) {
      this.b.emit(value);
      return;
    }
    const start = this.b.offset;
    this.b.emit(value);
    if (this.isReactiveName(value) && !this.isComputedName(value)) { this.mutables.push([start, this.b.offset]); return; }
    if (this.isClassName(value)) { this.classDecls.push([start, this.b.offset]); return; }
    if (this.isRenderLoopName(value)) {
      this.loopVars.push([start, this.b.offset]);
      this.noteLoopVarRead(value);
      return;
    }
    const imported = this.importSpecOf(value);
    if (imported !== null) {
      this.importedRefs.push([start, this.b.offset, imported.importedName, imported.specifier]);
      return;
    }
    const injected = this.injected.get(value);
    if (injected !== undefined && !this.inScope(value) && !this.schemaBodyBound?.has(value)) {
      this.runtimeRefs.push([start, this.b.offset, value, injected.runtime, injected.typed]);
    }
  }

  // A name being DECLARED is not a reference to whatever else holds that
  // spelling. Both scope walks answer about the ENCLOSING scope, and at a
  // parameter or a class member the binding being written is not in that
  // scope yet — a parameter's own frame is pushed after its list is
  // emitted, and a member name is a property, not a binding at all. Both
  // would resolve to the outer name and repaint it: `Color = class` would
  // make the parameter of `def paint(Color)` read `class`.
  withDeclaredName(fn) {
    const prev = this.declaringName;
    this.declaringName = true;
    try { return fn(); } finally { this.declaringName = prev; }
  }

  // Record `word` inside `container` as consumed vocabulary. Anchors on an
  // exact node when the caller has one; otherwise it accepts the container only
  // when the word occurs there ONCE, so an ambiguous anchor records nothing
  // rather than excusing the wrong occurrence — a user binding that happens to
  // share the spelling keeps its place in the census.
  noteVocabulary(kind, word, container) {
    const hit = this.wordSpanIn(word, container);
    if (hit !== null) this.vocabulary.push({ kind, start: hit[0], end: hit[1] });
  }

  // The class words of a tag shorthand (`div.row`, `.card.active`) are the
  // DSL's own vocabulary, consumed into the element's class string: no
  // symbol stands at any of them, so each is recorded as consumed rather
  // than left as a read the census would count as silent. Anchored on the
  // render node, under wordSpanIn's place-or-decline rule.
  noteShorthandClasses(classes, node) {
    for (const cls of classes) this.noteVocabulary('render-channel', cls, node);
  }

  // Record a node's own HEAD keyword as consumed vocabulary. A keyword the
  // grammar folds into the rule head (`offer`, `accept`) is never a carried
  // token value, so it has no PrimitiveStore occurrence and the anchored scan
  // above cannot see it — but the node's span opens on it, so its bytes are
  // arithmetic on a recorded span rather than a search. Verified before
  // recording: if the span ever stops opening on the word, this records
  // nothing rather than the wrong thing, the same place-or-decline rule
  // `wordSpanIn` follows.
  noteHeadKeyword(kind, word, node) {
    if (!this.ts) return;
    const id = isShapedNode(node) ? this.stores.idOf(node) : null;
    const span = id !== null ? this.stores.selfSpan(id) : null;
    if (span === null || this.b.source === null) return;
    const end = span[0] + word.length;
    if (end > span[1] || this.b.source.slice(span[0], end) !== word) return;
    this.vocabulary.push({ kind, start: span[0], end });
  }

  // A read the editor stays silent about without claiming the compiler
  // consumed it — see `silences` above for why the two differ.
  // A declaration's minted kind, at the SOURCE span of the role that names
  // it — the coordinates a hover arrives in.
  noteKind(node, role, label) {
    const id = this.stores.idOf(node);
    const row = id !== null ? this.stores.role(id, role) : null;
    if (row?.sourceStart != null && row.sourceEnd > row.sourceStart) {
      const name = this.b.source?.slice(row.sourceStart, row.sourceEnd) ?? null;
      this.kinds.push({ start: row.sourceStart, end: row.sourceEnd, label, name });
    }
  }

  noteSilence(word, container) {
    const hit = this.wordSpanIn(word, container);
    if (hit !== null) this.silences.push([hit[0], hit[1]]);
  }

  // A component member's declaration name, at the coordinates the declare
  // line re-marks — the SAME role the face maps, so the span the editor
  // tests is the span the mapping resolves. Only members the face
  // declares as CONTAINERS are recorded: a member that declares its value
  // type directly has nothing to see past, and one whose own annotation
  // spells the container shape by hand meant that shape. The channel also
  // carries every IN-BODY reactive read (memberRead — where the lowering
  // appended `.value` to a bare name), so the channel's meaning is "a
  // position that answers VALUE-FIRST"; a consumer holding an instance
  // is in neither set and keeps the container. Spans and nothing else.
  static MEMBER_KINDS = { state: 'state', computed: 'computed', readonly: 'readonly', gate: 'gate', accept: 'accept' };

  // A member's minted word. The PROP test is the `@` sigil, not the operator:
  // `@shades?: T := []` is a prop carrying a default, and reading its `:=`
  // would call it a state. Only the two kinds a parent can supply answer
  // `prop` — a public computed is still derived, so it stays a computed.
  static memberLabel(m) {
    if (m.isPublic && (m.kind === 'prop' || m.kind === 'state')) return 'prop';
    return Emitter.MEMBER_KINDS[m.kind] ?? null;
  }

  noteMemberDecl(m) {
    if (!this.ts) return;
    const id = isShapedNode(m.nameNode) ? this.stores.idOf(m.nameNode) : null;
    const row = id !== null ? this.stores.role(id, m.nameRole) : null;
    if (!row || typeof row.sourceStart !== 'number') return;
    // The member's minted kind, where the ruling names one (memberLabel); a
    // `plain` member is a plain property and mints nothing. An optional
    // member carries its marker: the face declares the instance member
    // required (its cell is always assigned), so the `?` the author wrote
    // survives only here, and the head says `name?:` the way TypeScript's
    // own does for an optional member.
    const label = Emitter.memberLabel(m);
    if (label !== null) {
      // An accept's row names its provider, so a miss reported on the name
      // can say which component was asked (mapTsDiagnostic).
      this.kinds.push({ start: row.sourceStart, end: row.sourceEnd, label, name: m.name, optional: m.optional === true,
        ...(m.kind === 'accept' && m.provider != null ? { provider: m.provider } : {}) });
    }
    if (!declaresContainer(m)) return;
    this.memberDecls.push({
      start: row.sourceStart, end: row.sourceEnd,
    });
  }

  wordSpanIn(word, container) {
    if (!this.ts) return null;
    const id = isShapedNode(container) ? this.stores.idOf(container) : null;
    const span = id !== null ? this.stores.selfSpan(id) : null;
    if (span === null) return null;
    const hits = this.stores.primitiveSpans(word, span[0], span[1]);
    if (hits.length !== 1) return null;
    return [hits[0].sourceStart, hits[0].sourceEnd];
  }

  // The SOURCE span of a bare identifier CHILD: the search window is
  // the ELEMENT's own span, narrowed further to the gap between the
  // nearest siblings that carry spans, so one word repeated under
  // several elements resolves to its OWN occurrence. A window holding
  // the word exactly once answers; anything else DECLINES, and the
  // caller then leaves the name unanchored rather than pointing at a
  // guess. Primitive spans are a ts-face side band, so this answers
  // only there — the road that has a reader for the answer.
  bareChildSpan(args, k, owner) {
    const spanOf = (x) => {
      const id = isShapedNode(x) ? this.stores.idOf(x) : null;
      return id !== null ? this.stores.selfSpan(id) : null;
    };
    const outer = spanOf(owner) ?? spanOf(this.rstate?.node ?? null);
    if (outer === null) return null;
    let [lo, hi] = outer;
    for (let j = k - 1; j >= 0; j--) { const sp = spanOf(args[j]); if (sp) { lo = sp[1]; break; } }
    for (let j = k + 1; j < args.length; j++) { const sp = spanOf(args[j]); if (sp) { hi = sp[0]; break; } }
    const hits = this.stores.primitiveSpans(args[k], lo, hi);
    return hits.length === 1 ? [hits[0].sourceStart, hits[0].sourceEnd] : null;
  }

  // The reading a rejected attribute NAME gets. tsgo's own report is
  // the generic-argument mismatch, whose parameter type is the tag's
  // WHOLE name union — sixty names, elided, with the one the author
  // meant among the hidden ones. Both roads record this instead: the
  // nearest spelling when the tables hold one (a DOM property's
  // camelCase name folds to its attribute, and that fold is certain),
  // and otherwise the road's own admission.
  unknownAttrMessage(tag, name, { bare, svg }) {
    const near = suggestAttribute(tag, name);
    if (near !== null) return `'${name}' is not a known attribute of <${tag}> — did you mean '${near}'?`;
    if (bare) {
      return `'${name}' is not a known attribute of <${tag}> — a bare word sets the boolean attribute it ` +
        `names; render a value with \`= ${name}\`, or spell \`name: value\``;
    }
    // Each namespace spells its own vocabulary: HTML lowercases, SVG
    // is verbatim and case-SENSITIVE. Naming the wrong rule would send
    // an author to the wrong fix.
    return `'${name}' is not a known attribute of <${tag}> — ` + (svg
      ? 'SVG attribute names are the spec\'s own, case-sensitive (`viewBox`)'
      : "HTML attribute names are the spec's own, lowercase") +
      '; `data-`/`aria-` names take any suffix';
  }

  emitRewrittenPrimitive(storedValue, emittedValue) {
    const owner = this.b.currentMark;
    const span = this.ts ? this.b.claimPrimitiveSpan(storedValue) : null;
    if (owner !== null && span !== null) {
      this.b.markSpan(owner.nodeId, 'identifier', span[0], span[1], () => this.b.emit(emittedValue));
    } else {
      this.b.emit(emittedValue);
    }
    return span; // the claimed SOURCE span, for callers that record it
  }

  emitQuotedPrimitive(value, quote = "'") {
    this.b.emit(quote);
    const span = this.emitPrimitive(value);
    this.b.emit(quote);
    return span; // the claimed SOURCE span, for callers that record it
  }

  // A render pair's KEY at the generated bytes its road spells: the
  // author's own spelling emits through the primitive channel (an
  // exact row — completions and diagnostics at the word's position),
  // and a road that spells the OTHER word (`class:` landing on
  // `className`, `className:` landing on `'class'`) rides a
  // rewritten-primitive cover, so the source key owns the generated
  // position either way. JS mode emits the bytes plain — same output.
  // Returns the SOURCE span the key claimed, for callers that record it:
  // the claim is taken in source order from the occurrences the frame has
  // not handed out, so a key whose spelling also appears in its own value
  // (`disabled: @rest.disabled`) still lands on the key's own bytes.
  emitKeyAs(key, emitted) {
    return key === emitted ? this.emitPrimitive(key) : this.emitRewrittenPrimitive(key, emitted);
  }

  // A PROPERTY-road key's generated span joins the attrNames drop
  // channel: the face position is a real property access now, so tsgo
  // mints a `property` semantic token there — and the author wrote an
  // ATTRIBUTE, which must keep its TextMate color. The editor drops
  // the token on exactly these spans (the child-prop key precedent).
  emitPropertyRoadKey(fn) {
    const start = this.b.offset;
    fn();
    if (this.ts) this.attrNames.push([start, this.b.offset]);
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
    if (!(isShapedNode(value) && isDefHead(value[0]))) {
      throw this.positionedError(value, "emitter: the void marker (a trailing '!' on the defined name) requires a function value — `save! = ->`, `save! =! ->`, `save! = =>`, `fn!: ->`", owner);
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

  // The row a mark, a rejection or a fact reads: a node's own. A word (a
  // leaf or a type value) opens no frame: its occurrence maps through the
  // primitive channel.
  rowIdOf(x) {
    return Array.isArray(x) && wordOf(x) === undefined ? this.stores.idOf(x) : null;
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

  // The validators this module registers where the checker can type
  // them: a top-level call of `registerValidator` imported as a value
  // from 'rip/validate', naming the validator by a literal and passing a
  // bound function. The face declares each into `Validated`, typed by
  // what the function answers. Any other registration runs and stays
  // unknown to the checker, so a read of its name fails the check.
  collectValidatorRegistrations(sexpr) {
    this.validatorRegistrations = [];
    if (!this.ts) return;
    const locals = new Set();
    for (const x of sexpr.slice(1)) {
      if (!isModuleImportNode(this.stores, x)) continue;
      const from = x[x.length - 1];
      if (typeof from !== 'string' || from.slice(1, -1) !== 'rip/validate') continue;
      const id = this.stores.idOf(x);
      if (id !== null && this.stores.role(id, 'typeOnly') !== null) continue;
      for (const spec of Emitter.importSpecs(x)) {
        if (!isShapedNode(spec) || spec[0] === '*') continue;
        for (const s of spec) if ((isShapedNode(s) ? s[0] : s) === 'registerValidator') locals.add(isShapedNode(s) ? s[1] : s);
      }
    }
    if (locals.size === 0) return;
    for (const x of sexpr.slice(1)) {
      if (!isPlainCall(x) || !locals.has(x[2]) || x.length < 5) continue;
      const [, , , nameArg, fn] = x;
      const name = isShapedNode(nameArg) && nameArg[0] === 'symbol' && nameArg.length === 2 ? nameArg[1]
        : typeof nameArg === 'string' && /^"\w+"$/.test(nameArg) ? nameArg.slice(1, -1) : null;
      if (name !== null && typeof fn === 'string' && isIdentifierName(fn)) this.validatorRegistrations.push([name, fn]);
    }
  }

  // A zero-argument call of an accessor's local binding, reached
  // through no inner scope that rebinds the name (a parameter of the
  // same name is a different binding).
  isAccessorCall(x, local) {
    if (local === null || !isPlainCall(x) || x.length !== 3 || x[2] !== local) return false;
    return !this.scopes.slice(1).some((sc) => sc.has(local));
  }

  // A whole-word search over the source finds a USE only outside the
  // bytes the lexer read as a literal or skipped as trivia: a string
  // chunk (an interpolation's code between chunks stays a use), a
  // regex, a comment. Both channels are the parse's own record; the
  // emitter never re-lexes the source to tell a word from a literal.
  collectSourceChannels(tokens, trivia) {
    const OPAQUE = new Set(['STRING', 'STRING_START', 'STRING_END', 'REGEX', 'HEREGEX_START', 'HEREGEX_END']);
    this.opaqueSpans = [];
    this.terminatorStarts = [];
    for (const t of tokens) {
      if (typeof t.start !== 'number' || typeof t.end !== 'number') continue;
      if (OPAQUE.has(t.kind)) this.opaqueSpans.push([t.start, t.end]);
      else if (t.kind === 'TERMINATOR') this.terminatorStarts.push(t.start);
    }
    for (const t of trivia) if (t.kind === 'comment') this.opaqueSpans.push([t.start, t.end]);
  }

  inOpaqueSpan(at) {
    return this.opaqueSpans.some(([start, end]) => at >= start && at < end);
  }

  // The end of the statement whose last clause closes at `at`: the first
  // terminator at or past it, or the end of the source when none follows.
  statementEndAfter(at) {
    let end = this.b.source.length;
    for (const t of this.terminatorStarts) if (t >= at && t < end) end = t;
    return end;
  }

  program(sexpr) {
    return this.programWith(sexpr);
  }

  // Attach a scope's schema stories' declared types to that scope's
  // hoist entries: the module's stories at the program hoist line
  // (only non-exported bindings hoist; exported ones emit `export
  // const` and infer from the cast), a function scope's at its own
  // (scopedHoist). A scope's entries see its own stories alone, so a
  // same-named binding elsewhere never annotates.
  attachSchemaConsts(entries, stories) {
    if (!stories) return;
    const consts = new Map();
    for (const s of stories) {
      if (!s.decl.exported && s.constType !== null) consts.set(s.decl.name, s.constType);
    }
    if (consts.size) entries.schemaConsts = consts;
  }

  programWith(sexpr) {
    // Erased statements filter here — BEFORE the leading-import scan
    // and the last-statement determination, both of which must see
    // the live program (a `type` declaration above the imports must
    // not push them below the hoist line).
    const all = this.liveStmts(sexpr.slice(1));
    // Leading MODULE imports emit ABOVE the hoist line (a dynamic-import
    // CALL spells the same head; isModuleImport discriminates).
    let lead = 0;
    while (lead < all.length && this.isModuleImport(all[lead])) lead++;
    this.lastProgramStmt = all[all.length - 1] ?? null;

    if (lead > 0) {
      this.mark(sexpr, '$self', () => {
        for (const imp of all.slice(0, lead)) this.statement(imp, 0);
        this.emitDataBinding();
        const rest = all.slice(lead);
        // Every import's names — leading or not, since an import binds
        // for the whole module wherever it sits — join the module scope,
        // which is what `inScope` answers for an extends host or an
        // accept provider. The emission split is layout.
        const imported = [...Emitter.importedNames(all.filter((n) => this.isModuleImport(n))), ...this.moduleSeeds()];
        let entries = this.hoistEntries(this.programHoist);
        this.attachSchemaConsts(entries, this.schemaModuleStories);
        const names = new Set([...entries.map(([n]) => n), ...imported]);
        for (const n of this.pushReactiveFrame(all, names)) names.add(n);
        this.moduleBound = Emitter.moduleBoundNames(rest);
        this.moduleClassNames = Emitter.classDeclNames(rest);
        this.rejectDuplicateDefault(rest);
        this.scopes.push(names);
        entries = this.applyDeclareInPlace(entries, this.programHoist);
        if (entries.length) {
          this.hoistLine(entries);
          this.b.emit('\n\n');
        }
        this.emitTsTypeDecls(sexpr.slice(1), '');
        if (rest.length) this.mark(sexpr, 'body', () => this.statements(rest, 0, 'program'));
        this.emitHmrComponentTable();
        this.emitDataSection();
        this.scopes.pop();
        this.rframes.pop();
      });
      return;
    }
    this.programPlain(sexpr, all);
  }

  // The __DATA__ marker declares DATA, a module binding like an
  // import's: a plain `DATA = …` writes it, a second declaring form
  // rejects naming the marker's line. The binding opens the program
  // (below any leading imports) and the raw text closes it, inside a
  // function declaration that hoists, so a long section never sits
  // ahead of the code. The function is `__data__`, minted so a user's
  // own `__data__` keeps its name.
  emitDataBinding() {
    if (this.dataPayload == null) return;
    this.dataFn = Emitter.mintName('__data__', this.temps.used);
    this.b.emit(`let DATA = ${this.dataFn}();\n\n`);
    this.dataBodyAt = this.b.offset;
  }

  emitDataSection() {
    if (this.dataPayload == null) return;
    if (this.b.offset !== this.dataBodyAt) this.b.emit('\n\n');
    this.b.emit(`function ${this.dataFn}() {\n  return ${JSON.stringify(this.dataPayload)};\n}`);
  }

  // The names a module scope binds before its statements: the
  // __DATA__ marker's DATA.
  moduleSeeds() {
    return this.dataPayload == null ? [] : ['DATA'];
  }

  // Every module-scope component under one export, whether or not the
  // module exports it: a living instance of a module-private component
  // can only be patched if the renderer can reach the replacement
  // class, and the module's exports do not name it. hmr builds only.
  emitHmrComponentTable() {
    if (!this.hmr || !this.modulePath || this.moduleComponentNames.size === 0) return;
    this.b.emit(`\n\nexport const __hmrComponents = { ${[...this.moduleComponentNames.keys()].join(', ')} };`);
  }

  programPlain(sexpr, stmts) {
    this.mark(sexpr, '$self', () => {
      this.emitDataBinding();
      // No leading import, but an import may still follow a statement,
      // and it binds for the whole module.
      const imported = [...Emitter.importedNames(stmts.filter((n) => this.isModuleImport(n))), ...this.moduleSeeds()];
      let entries = this.hoistEntries(this.programHoist);
      this.attachSchemaConsts(entries, this.schemaModuleStories);
      const names = new Set([...entries.map(([n]) => n), ...imported]);
      for (const n of this.pushReactiveFrame(stmts, names)) names.add(n);
      this.moduleBound = Emitter.moduleBoundNames(stmts);
      this.moduleClassNames = Emitter.classDeclNames(stmts);
      this.rejectDuplicateDefault(stmts);
      this.scopes.push(names);
      entries = this.applyDeclareInPlace(entries, this.programHoist);
      if (entries.length) {
        this.hoistLine(entries);
        this.b.emit('\n\n');
      }
      this.emitTsTypeDecls(sexpr.slice(1), '');
      this.mark(sexpr, 'body', () => this.statements(stmts, 0, 'program'));
      this.emitHmrComponentTable();
      this.emitDataSection();
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
      // Direct program children only — the augmentation emission's
      // position test (nested lists never reassign it, so a block's
      // statements compare unequal).
      if (mode === 'program') this.moduleTopStmt = stmt;
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
    'loop-n': (e, node, ind) => (e.loopStatement(node, ind), true),
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
      if (!isComprehensionNode(node)) return false;
      e.ind = ind;
      if (node === e.lastProgramStmt) {
        // Its value IS the program result, so repl mode captures it
        // like any final expression.
        if (e.repl) e.b.emit(`const ${e.replSlot()} = `);
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
    // Reactive declarations, effects and readonly declarations: a
    // plumbing list can spell the heads, and the semanticKind check
    // declines it.
    'state': (e, node, ind) => e.isReactiveDecl(node) && (e.reactiveDecl(node, ind), true),
    'computed': (e, node, ind) => e.isReactiveDecl(node) && (e.reactiveDecl(node, ind), true),
    'effect': (e, node, ind) => e.isEffectDecl(node) && (e.effectStatement(node, ind), true),
    'readonly': (e, node, ind) => e.isReadonlyDecl(node) && (e.readonlyDecl(node, ind), true),
    'void-readonly': (e, node, ind) => e.isReadonlyDecl(node) && (e.readonlyDecl(node, ind), true),
    // Module imports (a dynamic import is a call).
    'import': (e, node) => e.isModuleImport(node) && (e.importStatement(node), true),
    'export': (e, node, ind) => (e.exportStatement(node, ind), true),
    'export-default': (e, node, ind) => (e.exportStatement(node, ind), true),
    'export-all': (e, node, ind) => (e.exportStatement(node, ind), true),
    'export-from': (e, node, ind) => (e.exportStatement(node, ind), true),
  };

  // THE construction seam for nested emitters (schema callable
  // bodies). Everything the parent threads into a sub-emitter goes
  // through here: the stores (a body's nodes are the parse's own, with
  // the semanticKinds the kind-checked paths dispatch on), the enclosing
  // scope chain, and the reactive frames — a body reading or writing
  // an outer reactive name unwraps to `n.value` exactly like any
  // other function body; its params shadow like any other params.
  // The sub-emitter's builder has no source, so a body maps nowhere:
  // the schema node's cover rows are the construct's mapping story.
  // Runtime delivery needs NO reporting seam: emit() walks every code
  // site's statements before any code emits, so the sub-emitter's
  // output can reference only runtimes the parent already delivered.
  // A new parent↔sub concern belongs in this method, not at a call site.
  subEmitter() {
    const sub = new Emitter(this.stores, new MappingBuilder(this.stores, null, { record: false }));
    sub.scopes = [...this.scopes];
    sub.rframes = [...this.rframes];
    // The frames' implicit-`it` marks, and the source the body's spans
    // index (the sub's own builder has none), for the bare-`it` check.
    sub.implicitItScopes = this.implicitItScopes;
    sub.parentSource = this.b.source ?? this.parentSource;
    // One temp allocator per module: chain temps in a callable body
    // draw from the same name pool as the parent's (both emit into
    // the same output module).
    sub.temps = this.temps;
    // Generated runtime helpers are delivered and aliased at module
    // scope. Callable bodies must spell the parent's minted aliases,
    // never the public helper names a parameter/local may shadow.
    sub.runtimeAliases = this.runtimeAliases;
    // A nested schema inside a callable body reads its code from the
    // same side table, and its scopes' facts from the same analysis.
    sub.schemaCode = this.schemaCode;
    sub.hoists = this.hoists;
    sub.fieldPlans = this.fieldPlans;
    sub.frames = this.frames;
    sub.predicates = this.predicates;
    sub.shaped = this.shaped;
    return sub;
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
    if (isShapedNode(node)) {
      const form = Emitter.STATEMENT_FORMS[node[0]];
      if (form && form(this, node, ind)) {
        this.replDeclEcho(node);
        return;
      }
      // Control guards are statement rewrites: bare (`x or return e`,
      // `x or continue`) and assigning (`y = x or return e`) forms
      // both emit an `if` whose body is the jump — the one lowering
      // that keeps the jump's target (function, loop, or debugger).
      if (Emitter.controlGuard(node)) {
        return this.returnGuardStatement(node, null);
      }
      if (node[0] === '=' && node.length === 3 && typeof node[1] === 'string' &&
          Emitter.controlGuard(node[2])) {
        return this.returnGuardStatement(node[2], node);
      }
      // A MIDDLE-REST array pattern (`[a, ...mid, b] = src`) has no
      // JS destructuring form — the statement lowering binds the
      // source once and reads by index/slice.
      if (node[0] === '=' && node.length === 3 && Emitter.middleRestPattern(node[1])) {
        this.middleRestAssign(node, ind);
        this.b.emit(';');
        return;
      }
      // Slice assignment (`a[1..2] = v`) replaces the range in place:
      // a statement lowering to splice (value position rejects).
      if (node[0] === '=' && node.length === 3 && Emitter.sliceTarget(node[1]) !== null) {
        this.sliceAssignStatement(node);
        this.b.emit(';');
        return;
      }
      // A compound operator has no splice reading (`a[1..2] += v` would
      // assign to a slice call).
      if (isAssignHead(node[0]) && node.length === 3 && Emitter.sliceTarget(node[1]) !== null) {
        throw this.sliceAssignError(node);
      }
      // Optional-chain assignment in statement position guards with a
      // plain `if` (no ternary value is needed).
      if (isAssignHead(node[0]) && node.length === 3) {
        const guard = this.optionalGuard(node[1]);
        if (guard !== null) {
          this.optionalAssign(node, guard, 'statement');
          this.b.emit(';');
          return;
        }
      }
    }
    // repl capture: everything reaching this point is an expression
    // statement (the dispatched statement forms and the assignment
    // rewrites returned above); the program's FINAL one lands in the
    // result slot. Direct writes (assign/compound/update) stay
    // uncaptured — their emission owns declaration syntax (`let x =
    // 5`) the capture prefix cannot wrap.
    if (this.replCapture(node)) return;
    // Statement-position grouping: expression forms JS treats specially
    // at statement start group unconditionally — object literals (bare
    // braces parse as a block) and `->` function expressions (a bare
    // `function` is a declaration needing a name). `=>`
    // arrows are valid bare and stay so. Update statements group
    // ((i++);). The grouped form is a second $self
    // manifestation (cover row over the parens — one-to-many) so the
    // statement start itself maps.
    const wrap = Emitter.needsGrouping(node, 'statement', this.stores);
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
    // (after the statement).
    if (this.ts && isShapedNode(node) && node[0] === '=' && node.length === 3 &&
        typeof node[1] === 'string' && this.componentInfo.has(node[2])) {
      this.tsComponentCompanion(node[2], node[1], false, this.annotationText(node, 'typeParams'));
    }
    if (this.ts && isShapedNode(node) && node[0] === '=' && node.length === 3) {
      this.tsSchemaBehavior(node[2]);
    }
  }

  // repl mode's result slot, minted against the used-name registry on
  // FIRST capture (never a fixed string — a user may legally bind any
  // name the emitter is fond of; mintName registers the pick, so
  // later minted names dodge it too). Lazy so an off-flag or
  // capture-free emission never touches the registry.
  replSlot() {
    if (this.replResultName === null) {
      this.replResultName = Emitter.mintName('__result', this.temps.used);
    }
    return this.replResultName;
  }

  // repl mode's import resolver — the minted name every dynamic-
  // import specifier routes through (`import(<R>(spec))`), reported
  // as result.replImportResolver so the evaluation environment can
  // bind it to a cwd-anchored resolver. Minted lazily on the same
  // rule as the result slot.
  replResolver() {
    if (this.replImportResolver === null) {
      this.replImportResolver = Emitter.mintName('__resolveImport', this.temps.used);
    }
    return this.replImportResolver;
  }

  // The final top-level expression OR assignment statement lands in
  // the result slot: `const <slot> = <expr>;` — an assignment's echo
  // is its expression value (the RHS for plain, compound, and
  // destructuring forms; postfix updates echo JS's own pre-update
  // value). The `const <slot> = ` prefix is generated declaration
  // syntax outside all role marks (the declare-in-place `let `
  // precedent), so every role row keeps its exact source↔generated
  // slice. Assignment forms that lower to multi-statement rewrites
  // (optional-chain targets, middle-rest patterns) return
  // from statementCore before this point and stay echo-free.
  replCapture(node) {
    if (!this.repl || node !== this.lastProgramStmt) return false;
    this.b.emit(`const ${this.replSlot()} = `);
    this.expr(node);
    this.b.emit(';');
    return true;
  }

  // The declaration echo: a final reactive/readonly/effect
  // declaration binds through its own statement form, then the result
  // slot receives the freshly bound value — reactive containers
  // unwrap (`x := 5` echoes 5, never the signal object; a computed's
  // echo performs its first read). The read is a bound-identifier
  // re-read (REPEAT-SAFE by the doctrine's own judgment), never a
  // re-evaluation of the initializer.
  replDeclEcho(node) {
    if (!this.repl || node !== this.lastProgramStmt || !isShapedNode(node)) return;
    let name = null;
    let unwrap = false;
    if (this.isReactiveDecl(node) && typeof node[1] === 'string') {
      name = node[1];
      unwrap = true;
    } else if (this.isReadonlyDecl(node) && typeof node[1] === 'string') {
      name = node[1];
    } else if (this.isEffectDecl(node) && typeof node[1] === 'string') {
      name = node[1];
    }
    if (name === null) return;
    this.b.emit(`\nconst ${this.replSlot()} = ${name}${unwrap ? '.value' : ''};`);
  }

  // Child expressions whose position requires grouping. Grouping parens
  // are emitter-produced characters OUTSIDE the role mark — the parent's
  // syntax, not the child's code. The classification is structural; the
  // `.parenthesized` fat-node flag is never read for grouping — its
  // readers are SEMANTIC decisions where source parens select the
  // program (the postfix-if-else hoist guard, chain-link detection,
  // sealed dammit-as-callee serialization).
  //
  // Async marking: a function is async iff its BODY awaits — the walk
  // stops at nested function/class boundaries, so an inner arrow's
  // await marks the INNER function only. Dammit nodes are awaits by
  // construction.
  containsAwait(x) {
    return (this.predicateBits(x) & P_AWAIT) !== 0;
  }

  // Generator marking, symmetric with containsAwait.
  containsYield(x) {
    return (this.predicateBits(x) & P_YIELD) !== 0;
  }

  // the implicit `it`: a ZERO-param arrow whose body
  // references the bare identifier `it` binds it as the single
  // parameter (`xs.map -> it * 2` → `function(it) { return it * 2 }`).
  // Nested functions decide for themselves (each zero-param arrow owns
  // its own `it`), and an effect, computed or render body checks its own
  // (rejectUnboundIt); member names and object keys are not references.
  containsBareIt(x) {
    return (this.predicateBits(x) & P_IT) !== 0;
  }

  // A `return` anywhere below, nested functions excluded: the one control
  // form a value-position push cannot contain (it must cross to the
  // enclosing function).
  containsReturn(x) {
    return (this.predicateBits(x) & P_RETURN) !== 0;
  }

  // Control flow anywhere below — a break, continue, return or throw —
  // nested functions excluded: none of it can cross an accumulator's
  // push, because the value lowering would trap it inside an IIFE, so
  // such a tail statement stays a statement. DELIBERATELY CONSERVATIVE:
  // a tail `if` whose control flow sits only on one branch could in
  // principle collect the other branch's value, but classifying which
  // shapes lower validly is a per-construct proof — refusing the whole
  // statement is always CORRECT (the loop yields fewer collected
  // values, never invalid JS or trapped control flow).
  containsCtrl(x) {
    return (this.predicateBits(x) & P_CTRL) !== 0;
  }

  // Analysis's predicate bits for a subtree (src/emit/analyze.js
  // predicateBits): a node with a row reads its own. A word reads its
  // spelling, and a lowering's own node (no row) reads the union of its
  // children's, a function's excepted: its body is its own.
  predicateBits(x) {
    x = toParser(x);
    const w = wordOf(x);
    if (w !== undefined) return w === 'it' ? P_IT : (w === 'break' || w === 'continue') ? P_CTRL : 0;
    if (!Array.isArray(x)) return 0;
    const id = this.rowIdOf(x);
    if (id !== null) return this.predicates(id);
    if (x[0] === '->' || x[0] === '=>' || x[0] === 'def') return 0;
    let bits = 0;
    for (let i = isNode(x) ? 2 : 0; i < x.length; i++) bits |= this.predicateBits(x[i]);
    return bits;
  }

  static isStringLiteral(sexpr) {
    if (Array.isArray(sexpr)) return String(sexpr[0]) === 'str';
    const first = String(sexpr)[0];
    return first === '"' || first === "'" || first === '`';
  }

  // An effect, a computed or a render: a body that checks its own bare
  // `it` reads.
  static isItBody(n) {
    const head = n[0];
    return ((head === 'effect' || head === 'computed') && n.length === 3) || (head === 'render' && n.length === 2);
  }

  // The bare names a non-empty object literal holds, one per pair —
  // shorthand or `key: Name` — or null when any pair is anything else
  // (a spread, a method, a computed or interpolated key, a value that
  // is not a bare name): such an object holds something no tag
  // constructs through.
  static plainObjectValues(node) {
    if (!isShapedNode(node) || node[0] !== 'object' || node.length < 2) return null;
    const values = [];
    for (const pair of node.slice(1)) {
      if (!isShapedNode(pair) || (pair[0] !== null && pair[0] !== ':')) return null;
      if (typeof pair[1] !== 'string' || typeof pair[2] !== 'string') return null;
      values.push(pair[2]);
    }
    return values;
  }

  // ── The grouping lattice: ONE source of truth ──────────────────────
  // "Does construct X need grouping in context Y?" — keyed on the
  // precedence tier of the JS the construct EMITS. IIFE-lowered forms
  // (try/switch/loops, multi-branch value ifs) emit their own delimiters
  // and are therefore 'primary' by construction; a value-lowered SIMPLE
  // if emits a ternary and sits in the ternary tier.
  static jsTier(x) {
    if (!isShapedNode(x)) return 'primary';
    // A cast or a satisfies erases to its value — grouping reads through it.
    if ((x[0] === 'cast' || x[0] === 'satisfies') && x.length === 3) return Emitter.jsTier(x[1]);
    if (isAssign(x)) return 'assign';
    if (isTernary(x) || (isIf(x) && x.length <= 4 && Emitter.ifIsSimple(x))) return 'ternary';
    // Postfix existence emits a `!=` comparison — the binary tier.
    if (x[0] === '?' && x.length === 2) return 'binary';
    if (Emitter.isStrRepeat(x)) return 'primary';
    if (isBinary(x) || isRelation(x)) return 'binary';
    if (isUnary(x)) return 'unary';
    // await-expressions (and dammit sugar, which EMITS one) sit in the
    // unary tier: they group in head position (`(await f()).x`) but
    // bind tighter than any binary as operands (`await f() + 1`, bare).
    // A call whose CALLEE is dammit emits `await callee(...)` — the
    // await surrounds the invocation, so the call sits in the unary
    // tier exactly like a spelled await: grouped in head position
    // (`(await f()).x`), bare as an operand.
    if ((x[0] === 'await' && x.length === 2) || isAwaitedCall(x)) return 'unary';
    // yield has the LOWEST JS precedence: it groups as an operand
    // (`(yield 1) + 2`) and in head position.
    if ((x[0] === 'yield' || x[0] === 'yield-from') && x.length <= 2) return 'yield';
    if (isFunc(x)) return 'function';
    if (isObjectShape(x)) return 'object';
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
  //                 hoist rewrites them into assignment statements
  //                 (`stores` tells the postfix spelling, which hoists,
  //                 from the operator one).
  static needsGrouping(child, context, stores) {
    const tier = Emitter.jsTier(child);
    if (context === 'operand' || context === 'return') {
      if (tier === 'unary') {
        return !(child[0] === '!' || child[0] === 'typeof' || child[0] === 'await' || isAwaitedCall(child));
      }
      // A return value is an operand position EXCEPT for yield: `return
      // yield 1` is valid JS and needs no grouping.
      if (tier === 'yield') return context === 'operand';
      return tier === 'binary' || tier === 'ternary' || tier === 'assign' || tier === 'function';
    }
    // An update expression cannot head a chain: `(--x).z` printed bare is
    // `--x.z`, which updates the MEMBER, and `x++.z` does not parse.
    if (context === 'head') return tier !== 'primary' || isUpdate(child);
    // context === 'statement'
    // A statement whose FIRST TOKEN would be `{` parses as a block in
    // JS no matter what follows — the leading-operand walk catches an
    // object at the head of a binary/relation spine
    // (`{a: 1} instanceof Map` must group its object).
    if (Emitter.leadsWithObject(child)) return true;
    return tier === 'object' || isUpdate(child) ||
      (tier === 'function' && child[0] === '->') ||
      (isShapedNode(child) && (child[0] === 'class' || child[0] === 'component')) ||
      (isTernary(child) && !Emitter.ternaryHoists(child, stores)) ||
      (tier === 'unary' && child[0] === 'delete');
  }

  operand(node, role, child) {
    this.grouped(node, role, child, Emitter.needsGrouping(child, 'operand'));
  }

  head(node, role, child) {
    this.grouped(node, role, child, Emitter.needsGrouping(child, 'head'));
  }

  static isIntegerLiteral(x) {
    // The first-char test keeps the common `a.b` receiver off the regex.
    return typeof x === 'string' && x.charCodeAt(0) >= 48 && x.charCodeAt(0) <= 57 && /^[0-9][0-9_]*$/.test(x);
  }

  grouped(node, role, child, wrap) {
    if (wrap) this.b.emit('(');
    this.mark(node, role, () => this.expr(child));
    if (wrap) this.b.emit(')');
  }

  // Template-literal escaping for string content emitted inside
  // backticks. Escape pairs pass through first, so a source-escaped
  // `\${` (the string escape for a literal dollar) is left alone —
  // re-escaping its `${` would turn the backslash literal and the
  // interpolation LIVE.
  static escapeTemplate(s) {
    return s.replace(/\\[^]|`|\$\{/g, (m) => (m === '`' || m === '${') ? `\\${m}` : m);
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
    if (!isShapedNode(node)) {
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
        if (rewrite === 'member') this.notePlainRenderRead(node);
        if (rewrite !== null) this.checkBareRest(node, node);
        if (rewrite !== null) return this.memberRead(node, rewrite === 'member-reactive');
        // Inside a render factory, `this` (spelled bare or through
        // `@member` chains) is the ctx parameter — the factory methods
        // run unbound, so a literal `this` would be the block handle.
        if (node === 'this' && this.renderSelf !== null) return this.b.emit(this.renderSelf);
      }
      if ((node === 'break' && this.ctrlDepth === 0) || (node === 'continue' && this.loopDepth === 0)) {
        const err = this.positionedError(node, `emitter: '${node}' outside a loop${node === 'break' ? ' or switch' : ''}`);
        if (typeof err.start !== 'number' && this.b.currentMark) {
          err.start = this.b.currentMark.sourceStart;
          err.end = this.b.currentMark.sourceEnd;
        }
        throw err;
      }
      if (typeof node === 'string') this.emitPrimitive(node);
      else this.b.emit(node);
      return;
    }
    const head = node[0];
    if (isCall(node)) return this.call(node);
    if (head === 'str' && this.lockedHead(node, 'str')) return this.strTemplate(node);
    if (head === 'tagged-template' && node.length === 3) return this.taggedTemplate(node);
    if (head === 'here-regex') return this.heregex(node);
    // A slice target reaches here only in VALUE position, or under a
    // compound head: the statement path lowers `a[i..j] = v` to splice
    // before this dispatch, and a splice has no other form.
    if (isAssignHead(head) && node.length === 3 && !this.inPattern && Emitter.sliceTarget(node[1]) !== null) {
      throw this.sliceAssignError(node);
    }
    // An assignment whose target spine holds an optional link lowers to
    // a guarded form (JS forbids optional chains in assignment targets).
    if (isAssignHead(head) && node.length === 3 && !this.inPattern) {
      const guard = this.optionalGuard(node[1]);
      if (guard !== null) return this.optionalAssign(node, guard, 'value');
    }
    if (ASSIGNS.has(head) && node.length === 3) return this.assign(node);
    if ((head === '.' || head === '?.') && node.length === 3) return this.member(node);
    if ((head === '.{}' || head === '?.{}') && node.length >= 3) return this.pick(node);
    if (head === '[]' && node.length === 3) return this.index(node);
    if (head === 'optindex' && node.length === 3 && this.lockedHead(node, 'optindex')) return this.optIndex(node);
    if (isFunc(node)) return this.func(node);
    if (isUpdate(node)) return this.update(node);
    if (isTernary(node)) return this.ternary(node);
    if (head === 'array' && this.lockedHead(node, 'array')) return this.array(node);
    if (head === 'object' && this.lockedHead(node, 'object')) return this.object(node);
    if (isRange(node)) return this.range(node);
    if ((head === 'in' || head === 'of' || head === '!in' || head === '!of' || head === '!instanceof') && node.length === 3) return this.relation(node);
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
    if (head === '=~' && node.length === 3) return this.matchOp(node);
    if (head === 'map' && this.lockedHead(node, 'map')) return this.mapLiteral(node);
    if (head === 'regex-index' && node.length === 4) {
      if (!(typeof node[2] === 'string' && node[2][0] === '/')) {
        throw this.positionedError(node, 'emitter: a two-part index is the regex-capture form (`text[/re/, n]`) — its key must be a regex literal');
      }
      return this.regexIndex(node, node[1], node[2], node[3]);
    }
    if (head === 'symbol' && node.length === 2 && this.lockedHead(node, 'symbol')) {
      // Interned symbol: identity holds across realms and modules.
      return this.mark(node, '$self', () => {
        // `:alpha` → `Symbol.for("alpha")`: the name survives verbatim as the
        // string's content, so it claims its own occurrence there.
        const quoted = JSON.stringify(node[1]);
        if (quoted === `"${node[1]}"`) {
          this.b.emit('Symbol.for("');
          this.emitPrimitive(node[1]);
          this.b.emit('")');
        } else this.b.emit(`Symbol.for(${quoted})`);
      });
    }
    if (head === '%%=' && node.length === 3) return this.moduloAssign(node);
    if (isComprehensionNode(node)) return this.comprehension(node, this.ind);
    if (head === 'do-iife' && node.length === 2) return this.doIife(node);
    if ((head === 'cast' || head === 'satisfies') && node.length === 3) return this.postfixType(node);
    if (head === '?' && node.length === 2) return this.existence(node);
    if (head === 'await' && node.length === 2) return this.awaitExpr(node);
    if ((head === 'yield' || head === 'yield-from') && node.length <= 2) return this.yieldExpr(node);
    if (head === 'class') return this.classExpr(node);
    // A reactive declaration lowers to a `const` declaration, which has
    // no value form — expression positions reject.
    if (this.isReactiveDecl(node)) {
      const op = head === 'state' ? ':=' : '~=';
      throw this.positionedError(node, `emitter: a reactive declaration ('${typeof node[1] === 'string' ? node[1] : '…'} ${op} …') is a statement — it lowers to a const declaration, which has no expression form`);
    }
    if (this.isGateDecl(node)) {
      throw this.positionedError(node,
        "emitter: a render gate ('<~') can only be used as a direct component body line");
    }
    // A readonly declaration is the same class: it lowers to a const
    // declaration, which has no expression form.
    if (this.isReadonlyDecl(node)) {
      throw this.positionedError(node, `emitter: a readonly declaration ('${typeof node[1] === 'string' ? node[1] : '…'} =! …') is a statement — it lowers to a const declaration, which has no expression form`);
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
    // the rule, positioned.
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
    if (head === 'loop-n' && node.length === 3) return this.accumulatorIIFE(node);
    if ((head === 'for-in' || head === 'for-of' || head === 'for-as') && node.length === 6) return this.accumulatorIIFE(node);
    // `throw` in an operand slot lowers to a throwing IIFE — the one
    // JS spelling that throws from any expression position (`a ?? throw
    // e`, ternary arms, call arguments). `return` stays rejected: it
    // has no expression meaning.
    if (head === 'throw' && node.length === 2) {
      this.rejectYieldInIIFE(node);
      this.mark(node, '$self', () => {
        this.b.emit(this.containsAwait(node) ? 'await (async () => { throw ' : '(() => { throw ');
        this.mark(node, 'value', () => this.expr(node[1]));
        this.b.emit('; })()');
      });
      return;
    }
    if (isDefHead(head) || head === 'return' || (head === 'program' && this.lockedHead(node, 'program'))) {
      throw this.positionedError(node, `emitter: '${head}' is not supported in expression position`);
    }
    // Erased type statements never emit as expressions — every
    // statement list filters them (liveStmts). Reaching here means a
    // list was missed; failing loudly beats emitting a silent call of
    // the node head.
    if (head === 'type-decl' || Emitter.isTypedWrapper(node)) {
      throw this.positionedError(node, 'emitter: an erased type statement reached expression position — a statement list missed its filter');
    }
    // The grammar takes a children block as any call's argument; only an
    // element's or a component's call has a reading for it.
    if (isChildren(node)) throw this.positionedError(node, 'emitter: a children block has no reading in a value — only an element or a component heading a template line takes one');
    throw this.positionedError(node, `emitter: no expression emission for a '${typeof head === 'string' ? head : typeof head}' node`);
  }

  // The OUTERMOST optional link on an assignment target's member/index
  // spine (null when the spine has none). Its object is the guard: it
  // keeps its own inner optionals — they short-circuit the guard
  // itself — while the rewritten target emits every link plain
  // (withDeopt): the guard already proved the whole spine non-null.
  optionalGuard(t) {
    if (!isShapedNode(t) || t.length !== 3) return null;
    if (t[0] === '?.' || (t[0] === 'optindex')) return t;
    if (t[0] === '.' || t[0] === '[]') return this.optionalGuard(t[1]);
    return null;
  }

  // A value whose repeated evaluation provably cannot run user code
  // or observe a different value: `this`, literal spellings, and
  // identifiers bound in the current lexical environment (params,
  // hoists, loop variables, reactive and component-member names — all
  // bindings or containers this compiler owns). Member and index
  // access is NEVER repeat-safe: a getter or proxy on the chain is
  // observable user code. An identifier that resolves nowhere reads
  // through globalThis, whose property may itself be an accessor —
  // not repeat-safe either. `extra` carries walker-tracked bindings
  // (loop variables, catch names) during reference planning.
  repeatSafeValue(x, extra = null) {
    if (typeof x !== 'string') return false;
    const safety = wordSafety(x);
    if (safety !== null) return safety;
    if (extra !== null && extra.has(x)) return true;
    return this.lexicallyBound(x);
  }

  // Is `name` a binding the current lexical environment declares —
  // a reactive frame's reactive/bound/member name, a scope-chain
  // hoist/param/import, or a module-level class/def/export binding?
  lexicallyBound(name) {
    for (let i = this.rframes.length - 1; i >= 0; i--) {
      const f = this.rframes[i];
      if (f.reactive.has(name) || f.bound.has(name)) return true;
      if (f.members !== undefined && f.members.has(name)) return true;
    }
    return this.inScope(name) || this.moduleBound.has(name);
  }

  // An iterable a loop header re-reads must be repeat-safe, or a
  // literal list of repeat-safe members (respelling a literal list
  // rebuilds equal values). Anything else binds once in the header.
  singleReadIterable(x, extra = null) {
    if (this.repeatSafeValue(x, extra)) return true;
    if (!isShapedNode(x)) return false;
    if (x[0] === 'array') return x.slice(1).every((e) => this.singleReadIterable(e, extra));
    return false;
  }

  // The scope-boundary classification the TS face's schema story
  // places each schema's type declarations by (buildSchemaTypeStory's
  // `boundary` hook): which scope owns a construct's names.
  //
  //   'skip'           nothing inside reaches this scope (a nested
  //                    function, def, or component body)
  //   'effect'         the body is its own function scope; only the
  //                    handle name binds here
  //   'reactive'       a reactive declaration — the value emits inline
  //                    here UNLESS it is a multi-statement computed
  //                    block (its own scope); the walker checks
  //                    `n[0] === 'computed' && this.isBlock(n[2]) &&
  //                    n[2].length > 2` for that split
  //   'readonly'       the name const-binds; the value walks here
  //   'class'          fields are members, not scope names; the head
  //                    and field VALUES walk here
  //   'loop'           for-in/of/as — vars declare in the for-head;
  //                    slots from 2 walk here
  //   'comprehension'  clause vars bind per-construct; value, clause
  //                    sources, and guards walk here
  //   'try'            catch patterns bind per-handler; parts walk
  //   null             an ordinary node or a headless array — generic
  //                    descent
  scopeBoundary(n) {
    if (!isShapedNode(n)) return 'skip';
    if (isHeadless(n)) return null;
    if (isDefHead(n[0]) || isFunc(n)) return 'skip';
    if (n[0] === 'component' && n.length === 3) return 'skip';
    if (this.isEffectDecl(n)) return 'effect';
    if (this.isReactiveDecl(n)) return 'reactive';
    if (this.isReadonlyDecl(n)) return 'readonly';
    if (n[0] === 'class') return 'class';
    if (n[0] === 'for-in' || n[0] === 'for-of' || n[0] === 'for-as') return 'loop';
    if (isComprehensionNode(n)) return 'comprehension';
    if (n[0] === 'try') return 'try';
    return null;
  }
}
