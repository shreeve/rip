// The emitter's shared vocabulary: head sets, shape predicates, the
// module-edge helpers the declaration pipeline also reads, and the
// analysis differential's fact sink. Every area module imports from here.

import { identifierRunAt, isCustomElementName } from '../ident.js';
import { TEMPLATE_TAGS } from '../dom.js';
import { isHeadless } from '../emitter-shape.js';

// Component member vocabulary. The hooks (src/emit/names.js) are the
// type story's too. The runtime fields are the instance slots
// src/runtime/components.js owns: a member of that name would be
// overwritten by the runtime.
export const COMPONENT_RUNTIME_FIELDS = new Set([
  '_state', '_frame', '_parent', '_children', '_root', '_nodes', '_target',
  '_context', '_rest', '_restWriters', '_restHandlers', '_inheritedEl', '_inheritedInst', '_inheritedOwn',
  '_refCleanups', '_initFailed', '_hmrOrphans', '_hmrReleasing', '_hmrPropKeys', '_hmrResetPending', '_hmrReset', '_asChild',
  '_boundCache',
]);

export const BINOPS = new Set(['+', '-', '*', '/', '%', '**', '<', '>', '<=', '>=', '==', '!=', '&&', '||', '??', '<<', '>>', '>>>', '&', '^', '|']);
// 'void-assign' is the void definition (`save! = ->`): assignment
// shape throughout (hoisting, grouping tier, class-body walks); its
// own emission validates the function value and suppresses the
// implicit return. It emits as plain '='.
export const ASSIGNS = new Set(['=', 'void-assign', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=', '<<=', '>>=', '>>>=', '&=', '^=', '|=']);
// Every assignment head, the two synthesized compounds included
// (`//=` and `%%=` lower through a helper call and sit outside ASSIGNS).
export const isAssignHead = (h) => ASSIGNS.has(h) || h === '//=' || h === '%%=';
// Assignment heads that declare/mutate a RENDER LOCAL at a render
// child position : `=` declares, compound forms
// mutate. Other assign heads have no render reading and reject.
export const RENDER_BINDING_HEADS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=']);
export const JS_OP = { '==': '===', '!=': '!==' };

// What a value word has already become by the time a pattern is walked.
// The scanner's own table (types.js VALUE_WORDS) maps the SOURCE spellings
// — `yes`/`no` and the literal keywords — onto these; only the
// lowered side survives into the tree, so this is the set a destructuring
// target can never legally be.
export const PATTERN_LITERALS = new Set(['true', 'false', 'null', 'undefined', 'this']);
// The heads that shape a destructuring pattern rather than stand as one
// of its write targets.
export const PATTERN_HEADS = new Set(['array', 'object', 'rest', '...', 'default', '=', 'cast', 'satisfies', 'typed-var']);
// Identifier tokens inside opaque type text. Strings and comments are skipped:
// their word-shaped contents are values, not type-name occurrences. The caller
// supplies the source-base offset when these become MappingStore spans.
export const typeIdentifierTokens = (text, base = 0) => {
  const out = [];
  let quote = null;
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === '\\') i += 2;
      else { if (ch === quote) quote = null; i++; }
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; i++; continue; }
    if (ch === '#' || (ch === '/' && text[i + 1] === '/')) {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    const identifier = identifierRunAt(text, i);
    if (identifier !== null) {
      out.push({
        value: identifier.value,
        start: base + identifier.start,
        end: base + identifier.end,
      });
      i = identifier.end;
      continue;
    }
    i++;
  }
  return out;
};

// The fact sink: set by emit()'s internal `facts` option for one emit()
// and null otherwise. Each `FACTS?.(kind, key, value)` hands the sink a
// value the emitter has already computed; with no sink the optional call
// evaluates nothing, so emission is byte-identical either way. Only the
// analysis differential (test/support/analyze-diff.js) sets it.
export let FACTS = null;
// The writers (emit(), a capture) swap the sink through here.
export const setFacts = (sink) => { FACTS = sink; };
// A predicate's verdict, handed to the sink with the node it was asked
// about and returned unchanged.
export const asked = (kind, node, verdict) => {
  FACTS?.('predicate', kind, [node, verdict]);
  return verdict;
};

// A node of emitterShape's tree, where every array is one. Converted
// code reads the parser's tree with src/sexpr.js's isNode instead.
export const isShapedNode = (x) => Array.isArray(x);
export const isBinary = (x) => isShapedNode(x) && BINOPS.has(x[0]) && x.length === 3;
// The four links a member/index spine is built from. A spine carrying
// an optional link anywhere along it cannot be constructed THROUGH —
// `new a?.b()` is a syntax error, not a runtime one — so it seals first;
// `Emitter.optionalGuard` is the walk that finds the link, and it
// already descends every one of these.
export const SPINE_HEADS = new Set(['.', '?.', '[]', 'optindex']);
// `X.new` as a CALL is rip's construction sugar, not a property read,
// so a callee wearing it belongs to the call walk's own branch — a
// spine test would otherwise swallow it and emit the property.
export const isRubyNew = (x) => isShapedNode(x) && x[0] === '.' && x.length === 3 && x[2] === 'new';

// The standard generic globals' type parameters: augmenting a generic
// interface must repeat its parameter list (`interface Array<T>`), and
// repeating it lets a member's annotation NAME the parameter
// (`Array::second: () => T`). Heads outside this table augment bare.
// Null-prototype: the head is USER identifier text, so an inherited
// Object.prototype member (`constructor::m`) must never satisfy the
// lookup.
export const PROTO_GENERIC_PARAMS = {
  __proto__: null,
  Array: '<T>', ReadonlyArray: '<T>', Map: '<K, V>', Set: '<T>',
  WeakMap: '<K, V>', WeakSet: '<T>', Promise: '<T>', WeakRef: '<T>',
};

// An assignment whose target is the exact prototype-member chain
// `head.prototype.member` (both names plain): {head, member}, else
// null. The shape the `::` spelling produces — the face's augmentation
// emission and the declaration pipeline both key on it.
export function protoMemberTarget(node) {
  if (node[0] !== '=' || node.length !== 3) return null;
  const t = node[1];
  if (!isShapedNode(t) || t[0] !== '.' || typeof t[2] !== 'string') return null;
  const o = t[1];
  if (!isShapedNode(o) || o[0] !== '.' || o[2] !== 'prototype' || typeof o[1] !== 'string') return null;
  return { head: o[1], member: t[2] };
}

// A promoted parameter's name: `@name`, typed or defaulted, at any
// wrapper depth — null when the param is not a ThisProperty. Shared
// with the declaration pipeline (dts.js), which must see the same
// fields the TS face declares — the emitter's own predicate, not a
// copy of it.
export function atParamName(p) {
  let x = p;
  if (isShapedNode(x) && x[0] === 'typed-var' && x.length === 3) x = x[1];
  if (isShapedNode(x) && x[0] === '.' && x[1] === 'this' && typeof x[2] === 'string') return x[2];
  return null;
}

// The field a promoted parameter declares — its name and the
// ["typed-var", …] node carrying the annotation, null when the
// parameter is untyped. Reaches through a default (`@level = 1`),
// which wraps the promotion the annotation sits on.
export function atParamField(p) {
  let x = p;
  if (isShapedNode(x) && x[0] === 'default' && x.length === 3) x = x[1];
  const name = atParamName(x);
  if (name === null) return null;
  return { name, typed: isShapedNode(x) && x[0] === 'typed-var' && x.length === 3 ? x : null };
}

// Every `@name = …` an instance method body assigns, in source order,
// deduped by name (a field written twice declares once). A plain
// function is not entered — its `this` is another object; a bound
// arrow is, because its `this` is this instance's. `viaArrow` marks
// the fields only an arrow assigns: TypeScript's own constructor
// inference does not descend into arrows, so a bare declaration for
// one is an implicit `any` (TS7008 under noImplicitAny) instead of an
// inferred type — the declaring emission spells the `any` explicitly.
//
// `nodes` carries EVERY assignment of the name, in source order, because
// the author's annotation can ride any one of them — `@n = 1` inside an
// arrow and `@n: number | null = 2` directly after each declare the same
// field, and a declaration built from the first-seen node alone dropped
// whichever annotation arrived later. This walk has no store access, so
// it cannot ask which node carries one; the consumers can, and scan.
//
// Takes EVERY instance method body, not the constructor's alone. A
// constructor that hands its field setup to a helper (`@_refresh()` filling
// in a dozen cached parts) establishes those fields just as surely as one
// that inlines them, and the class is no less correct for it — this repo's
// own `Time` published 121 diagnostics on that shape. TypeScript reads plain
// `.js` the same way, inferring a class's properties from `this.x =` in any
// method, so this is the rule its own untyped dialect already follows.
//
// The bodies share one `seen` map, so the merging above works ACROSS them:
// a field an arrow assigns in the constructor and a method assigns directly
// is not arrow-only, and the annotation can ride whichever body carries it.
// Pass the constructor first — source order is what orders the result. Takes
// an ARRAY always: a body is itself an array, so no runtime test can tell one
// from a list of them, and guessing silently walked neither.
export function ctorAtFields(bodies) {
  const out = [];
  const seen = new Map();
  const walk = (n, inArrow) => {
    if (!isShapedNode(n)) return;
    const h = n[0];
    // A headless array (a postfix conditional's consequent, a
    // when-test list) holds children only: every element walks, the
    // first included, even when it is a name that spells a head.
    if (typeof h !== 'string' || isHeadless(n)) {
      for (const el of n) walk(el, inArrow);
      return;
    }
    // The boundary is WHOSE `this` a function has, not whether one is
    // nested. `->`/`def` emit a plain function, whose `this` is
    // dynamic — an assignment there says nothing about this class. A
    // BOUND `=>` emits an arrow, whose `this` is lexically whatever
    // encloses it, so inside the constructor it is the instance and
    // its assignment declares. An arrow under a `->` is still excluded
    // by the `->` above it, which is the correct reading: by then the
    // `this` it captures is the function's.
    if (h === '->' || h === 'def' || h === 'void-def' ||
        h === 'class' || h === 'component' || h === 'schema') return;
    if ((h === '=' || h === 'void-assign') && n.length === 3 &&
        isShapedNode(n[1]) && n[1][0] === '.' && n[1][1] === 'this' && typeof n[1][2] === 'string') {
      const name = n[1][2];
      const prior = seen.get(name);
      if (prior === undefined) {
        const entry = { name, node: n, nodes: [n], viaArrow: inArrow };
        seen.set(name, entry);
        out.push(entry);
      } else {
        prior.nodes.push(n);
        if (prior.viaArrow && !inArrow) {
          // A direct assignment supplies the inference an arrow's
          // cannot, wherever it sits — the field is not arrow-only.
          prior.viaArrow = false;
        }
      }
    }
    for (const el of n.slice(1)) walk(el, inArrow || h === '=>');
  };
  for (const body of bodies) {
    if (body !== null && body !== undefined) walk(body, false);
  }
  return out;
}
// The comparison family — every COMPARE-level operator chains,
// equality included (otherwise `a == b < c` silently compares a
// boolean against c).
export const COMPARISONS = new Set(['<', '>', '<=', '>=', '==', '!=']);
// A chain LINK: a comparison whose LEFT child is itself a comparison
// the source did not parenthesize. The pair lowers to a conjunction
// sharing the middle operand (`a < b < c` → `(a < b) && (b < c)` —
// the chained-comparison lowering); explicit parens opt out
// (`(a < b) < c` stays a boolean-to-c comparison). This is the
// second reader of the `.parenthesized` flag (the postfix-if-else
// hoist guard is the first): both decisions are SEMANTIC — which
// program the source spells — and grouping never reads the flag.
export const isChainLink = (x) => isShapedNode(x) && COMPARISONS.has(x[0]) && x.length === 3 &&
  isShapedNode(x[1]) && COMPARISONS.has(x[1][0]) && x[1].length === 3 && !x[1].parenthesized;
export const isUnary = (x) => isShapedNode(x) && (x[0] === '-' || x[0] === '+' || x[0] === '!' || x[0] === '~' || x[0] === 'typeof' || x[0] === 'delete') && x.length === 2;
export const isAssign = (x) => isShapedNode(x) && ASSIGNS.has(x[0]) && x.length === 3;
export const isRelation = (x) => isShapedNode(x) && (x[0] === 'in' || x[0] === 'of' || x[0] === 'instanceof' ||
  x[0] === '!in' || x[0] === '!of' || x[0] === '!instanceof') && x.length === 3;
export const isIf = (x) => isShapedNode(x) && x[0] === 'if';
export const isRange = (x) => isShapedNode(x) && (x[0] === '..' || x[0] === '...') && x.length === 3;
export const isSpread = (x) => isShapedNode(x) && x[0] === '...' && x.length === 2;
// The object-literal SHAPE, for the pattern predicates (the grammar
// never parses a call as an assignment target) and the grouping
// lattice (a misread call only over-groups); every other reader asks
// the call-aware Emitter#isObject.
export const isObjectShape = (x) => isShapedNode(x) && x[0] === 'object' && !isHeadless(x);
export const isFunc = (x) => isShapedNode(x) && (x[0] === '->' || x[0] === '=>') && x.length === 3;
// A try's handler: ["catch", binding|null, body]. Its other trailing
// slot, the finalizer, is a block.
export const isCatchClause = (x) => isShapedNode(x) && x[0] === 'catch' && x.length === 3 && !isHeadless(x);
// What findCapturedCtrl looks for.
export const CTRL_ALL = new Set(['break', 'continue', 'return']);
export const CTRL_BREAK = new Set(['break']);
// The def heads — plain and void — are ONE family everywhere a
// predicate asks "is this a def?": every def-shaped decision reads
// this helper, never a hand-maintained head pair (a site that listed
// only 'def' would silently misclassify void defs).
export const isDefHead = (h) => h === 'def' || h === 'void-def';
// The frame of a scope whose statements are words alone.
export const NONE = new Map();
export const EMPTY_FRAME = { reactive: NONE, computed: NONE, readonly: NONE, handles: NONE, own: NONE, classes: NONE, importSpecs: NONE, exportedConst: NONE };

export const isUpdate = (x) => isShapedNode(x) && (x[0] === '++' || x[0] === '--') && x.length === 3;

export const isTernary = (x) => isShapedNode(x) && x[0] === '?:' && x.length === 4;
// Render-DSL name classes: template tags come from the
// spec-derived vocabulary; PascalCase names (an interior lowercase
// letter distinguishes `Counter` from ALLCAPS constants) are
// component references.
export const isHtmlTag = (name) => { const tag = String(name).split('#')[0]; return TEMPLATE_TAGS.has(tag) || isCustomElementName(tag); };
// A comprehension node, by its full shape — the loop-spec list (a plain
// array of ['for-…'] arrays) — and never a plumbing list that begins
// with the name `comprehension`.
export const isComprehensionNode = (x) =>
  isShapedNode(x) && x[0] === 'comprehension' && !isHeadless(x) && x.length === 4 && Array.isArray(x[2]) &&
  x[2].length > 0 && Array.isArray(x[2][0]) && String(x[2][0][0]).startsWith('for-');

export const STATEMENT_HEADS = new Set(['for-in', 'for-of', 'for-as', 'switch', 'try', 'throw', 'loop', 'loop-n', 'comprehension']);
export const isLoopNode = (x) => isShapedNode(x) && (
  ((x[0] === 'for-in' || x[0] === 'for-of' || x[0] === 'for-as') && x.length === 6) ||
  (x[0] === 'while' && (x.length === 3 || x.length === 4)) ||
  (x[0] === 'loop' && x.length === 2) ||
  (x[0] === 'loop-n' && x.length === 3));

// Module source strings emit single-quoted; the token value carries
// normalized double quotes, so embedded single quotes (and
// backslashes) must escape or the emitted specifier breaks the
// string it sits in. Shared with declaration emission — the two
// renderings of one module edge must never drift.
export function moduleSourceText(s) {
  const inner = String(s).slice(1, -1).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `'${inner}'`;
}

// Both conditional spellings build ["?:", condition, then, else]; the
// semantic kind tells the operator `c ? x : y` (`ternary`) from the
// postfix `x if c else y` (`ifelse`, or the unkinded ternary a statement's
// `return x if c else y` lifts). Only the postfix spelling chains and
// hoists an assignment; the operator form emits as it parsed.
export function isPostfixTernary(stores, x) {
  if (!isTernary(x)) return false;
  const id = stores.idOf(x);
  return (id !== null ? stores.node(id)?.semanticKind : null) !== 'ternary';
}

// Is this node a module IMPORT STATEMENT? Shape alone cannot say: a
// dynamic `import(expr)` shares the head AND the length with a
// side-effect `import './x.rip'` (both `["import", x]`), so the stores'
// semanticKind is the only discriminator — `import` against `dynimport`.
// The length test below is a fast reject, nothing more; it was once `< 3`
// and silently stopped recognizing side-effect imports the day they
// gained their own node shape.
//
// Exported because the .d.ts emitter asks the same question, and asking
// it from a private copy is how the two came to disagree.
export function isModuleImportNode(stores, x) {
  if (!isShapedNode(x) || x[0] !== 'import' || x.length < 2) return false;
  const id = stores.idOf(x);
  return (id !== null ? stores.node(id)?.semanticKind : null) === 'import';
}
