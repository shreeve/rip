// The emitter's tree readers (src/grammar/grammar.rip `kinds`): a node
// is [head, attrs, ...children], so child k sits at index k + 2. The
// declaration pipeline (src/ts/dts.js) reads the module-edge ones too, so
// both emissions answer from one predicate.

import { isCall, isList, isNode, isNone, isStruct, wordOf } from '../sexpr.js';
import { BINOPS, ASSIGNS, COMPARISONS, SPINE_HEADS } from './helpers.js';

const UNARY_HEADS = new Set(['-', '+', '!', '~', 'typeof', 'delete']);
const RELATION_HEADS = new Set(['in', 'of', 'instanceof', '!in', '!of', '!instanceof']);

// The semanticKind of a node's NodeStore row; null for a node with no
// row (a lowering's own) or a row the grammar left unkinded.
export const semanticKindIn = (stores, x) => {
  const id = stores.idOf(x);
  return id === null ? null : stores.node(id)?.semanticKind ?? null;
};

export const isBinary = (x) => isNode(x) && BINOPS.has(x[0]) && x.length === 4;
export const isUnary = (x) => isNode(x) && x.length === 3 && UNARY_HEADS.has(x[0]);
// A plain or compound assignment; the void definition (`save! = ->`) is
// an `=` with the `void` flag.
export const isAssign = (x) => isNode(x) && ASSIGNS.has(x[0]) && x.length === 4;
export const isRelation = (x) => isNode(x) && x.length === 4 && RELATION_HEADS.has(x[0]);
export const isIf = (x) => isNode(x) && x[0] === 'if' && x.length === 5;
export const isRange = (x) => isNode(x) && (x[0] === '..' || x[0] === '...') && x.length === 4;
export const isSpread = (x) => isNode(x) && x[0] === '...' && x.length === 3;
export const isObjectShape = (x) => isNode(x) && x[0] === 'object';
export const isTypedWrapper = (x) => isNode(x) && x[0] === 'typed-var' && x.length === 4;
export const isFunc = (x) => isNode(x) && (x[0] === '->' || x[0] === '=>') && x.length === 4;
export const isUpdate = (x) => isNode(x) && (x[0] === '++' || x[0] === '--') && x.length === 3;
export const isTernary = (x) => isNode(x) && x[0] === '?:' && x.length === 5;
export const isBlock = (x) => isNode(x) && x[0] === 'block';
// A symbol (`:name`): its name is text, never a reference — `:it` binds
// no implicit `it`.
export const isSymbol = (x) => isNode(x) && x[0] === 'symbol' && x.length === 3;
// A loop over a source (`in`, `of`, `as`): its vars, iterable, step,
// guard and body sit at 2–6; a comprehension's clause has no body.
export const isSourceLoop = (x) => isNode(x) && x[0] === 'loop' && x.length === 7 &&
  (x[1].over === 'in' || x[1].over === 'of' || x[1].over === 'as');
export const isLoopNode = (x) => isNode(x) && ((x[0] === 'loop' && x.length === 7) || (x[0] === 'while' && x.length === 5));
export const isComprehensionNode = (x) => isNode(x) && x[0] === 'comprehension' && x.length === 4 && isSourceLoop(x[3]);
export const isSpine = (x) => isNode(x) && SPINE_HEADS.has(x[0]) && x.length === 4;
// `X.new` as a callee is the construction sugar, never a property read.
export const isRubyNew = (x) => isNode(x) && x[0] === '.' && x.length === 4 && wordOf(x[3]) === 'new';
// A comparison whose left operand is a comparison the source did not
// parenthesize: the pair is a chain link (`a < b < c`).
export const isChainLink = (x) => isNode(x) && COMPARISONS.has(x[0]) && x.length === 4 &&
  isNode(x[2]) && COMPARISONS.has(x[2][0]) && x[2].length === 4 && !x[2].parenthesized;
// The postfix spelling of `?:` (`x if c else y`, or the unkinded
// ternary a `return x if c else y` lifts) chains and hoists; the
// operator spelling (`c ? x : y`, kind `ternary`) emits as it parsed.
export const isPostfixTernary = (stores, x) => isTernary(x) && semanticKindIn(stores, x) !== 'ternary';

// The field `@name` / `this.name` names, or null for any other node.
export const thisField = (x) => (isNode(x) && x[0] === '.' && x.length === 4 && wordOf(x[2]) === 'this' ? wordOf(x[3]) ?? null : null);
// A member target: `x` (private) or `@x` (public), as { name, isPublic };
// null for anything else.
export const memberTarget = (t) => {
  const word = wordOf(t);
  if (word !== undefined) return { name: word, isPublic: false };
  const field = thisField(t);
  return field === null ? null : { name: field, isPublic: true };
};
// The leaves of a property path (`a.b.c`), root first: the words
// gateChain reads.
export const chainLeaves = (node) => {
  const out = [];
  let cur = node;
  for (; isNode(cur) && cur[0] === '.' && cur.length === 4 && wordOf(cur[3]) !== undefined; cur = cur[2]) out.push(cur[3]);
  out.push(cur);
  return out.reverse();
};
// A pair that carries a value under its key: `key: value`, or the
// shorthand `{key}` (`key: key`); never a void pair.
export const isValuePair = (x) => isNode(x) && x[0] === ':' && x.length === 4 && x[1].void !== true;
// An element's or a component's children block: ["children", {}, block].
export const isChildren = (x) => isNode(x) && x[0] === 'children' && x.length === 3;
// Where a walk's children start: a node's after its attributes, a list's
// at 0; -1 for a word, the absent marker, or a schema, whose code is its
// own program.
export const childStart = (x) => (!isStruct(x) || (isNode(x) && x[0] === 'schema') ? -1 : isNode(x) ? 2 : 0);

// The OUTERMOST optional link on an assignment target's member/index
// spine (null when the spine has none). Its object is the guard: it
// keeps its own inner optionals, which short-circuit the guard itself,
// while the rewritten target emits every link plain: the guard already
// proved the whole spine non-null.
export function optionalGuard(t) {
  for (; isNode(t) && t.length === 4; t = t[2]) {
    if (t[0] === '?.' || t[0] === 'optindex') return t;
    if (t[0] !== '.' && t[0] !== '[]') return null;
  }
  return null;
}

// The right operand of a logical operator, the slot a control guard
// (`x or return e`) puts its statement in; null for any other node.
export const guardOperand = (x) => (isNode(x) && (x[0] === '||' || x[0] === '&&' || x[0] === '??') && x.length === 4 ? x[3] : null);

// A control guard: a logical operator whose right operand is a return,
// a throw, or a `continue` / `break` / `debugger` word. Its statement
// rewrite emits the left operand inside an `if`.
export function controlGuard(x) {
  const right = guardOperand(x);
  const word = wordOf(right);
  if (word !== undefined) return word === 'continue' || word === 'break' || word === 'debugger';
  return isNode(right) && (right[0] === 'return' || (right[0] === 'throw' && right.length === 3));
}

// A `when` test the match lowering reads: a regex or a range. `case
// /re/:` would compare against a fresh RegExp object and `case [1..3]:`
// against a fresh array, so a switch carrying one lowers to an if/else
// chain.
export function isMatchArm(c) {
  const w = wordOf(c);
  if (w !== undefined) return w.startsWith('/');
  return isNode(c) && (c[0] === 'here-regex' || ((c[0] === '..' || c[0] === '...') && c.length === 4));
}

// The [local, imported] pairs an import statement binds, in source
// order: a default import's local imports 'default', a namespace's '*'.
export function importBindings(x) {
  const out = [];
  for (const spec of [x[2], x[3]]) {
    if (isNone(spec)) continue;
    const w = wordOf(spec);
    if (w !== undefined) { out.push([w, 'default']); continue; }
    if (isNode(spec) && spec[0] === 'as') {
      const name = wordOf(spec[2]);
      const local = wordOf(spec[3]);
      if (name === '*') out.push([local, '*']);
      else out.push([name, name], [local, local]);
      continue;
    }
    for (const s of spec) {
      if (isNode(s) && s[0] === 'as') out.push([wordOf(s[3]), wordOf(s[2])]);
      else out.push([wordOf(s), wordOf(s)]);
    }
  }
  return out;
}

// The names import statements bind in module scope.
export function importedNames(imports) {
  const names = [];
  for (const x of imports) for (const [local] of importBindings(x)) names.push(local);
  return names;
}

// The tag expression of a dynamic-class call `tag.__clsx(…)`, or null.
export function clsxTagExpr(x) {
  if (!isCall(x)) return null;
  const member = x[2];
  return isNode(member) && member[0] === '.' && member.length === 4 && wordOf(member[3]) === '__clsx' ? member[2] : null;
}

// An assignment whose target is the exact prototype-member chain
// `head.prototype.member` (both names plain): {head, member}, else
// null. The shape the `::` spelling produces — the face's augmentation
// emission and the declaration pipeline both key on it.
export function protoMemberTarget(node) {
  if (node[0] !== '=' || node.length !== 4 || node[1].void === true) return null;
  const t = node[2];
  if (!isNode(t) || t[0] !== '.' || t.length !== 4 || wordOf(t[3]) === undefined) return null;
  const o = t[2];
  if (!isNode(o) || o[0] !== '.' || o.length !== 4 || wordOf(o[3]) !== 'prototype' || wordOf(o[2]) === undefined) return null;
  return { head: wordOf(o[2]), member: wordOf(t[3]) };
}

// A promoted parameter's name: `@name`, typed or not — null when the
// param is not a ThisProperty.
export function atParamName(p) {
  const x = isNode(p) && p[0] === 'typed-var' && p.length === 4 ? p[2] : p;
  return thisField(x);
}

// The field a promoted parameter declares — its name and the
// ["typed-var", …] node carrying the annotation, null when the
// parameter is untyped. Reaches through a default (`@level = 1`),
// which wraps the promotion the annotation sits on.
export function atParamField(p) {
  const x = isNode(p) && p[0] === 'default' && p.length === 4 ? p[2] : p;
  const name = atParamName(x);
  if (name === null) return null;
  return { name, typed: isNode(x) && x[0] === 'typed-var' && x.length === 4 ? x : null };
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
// field. This walk has no store access, so it cannot ask which node
// carries one; the consumers can, and scan.
//
// Takes EVERY instance method body, not the constructor's alone: a
// constructor that hands its field setup to a helper (`@_refresh()`)
// establishes those fields just as surely as one that inlines them, and
// TypeScript reads plain `.js` the same way, inferring a class's
// properties from `this.x =` in any method.
//
// The bodies share one `seen` map, so the merging above works ACROSS them:
// a field an arrow assigns in the constructor and a method assigns directly
// is not arrow-only. Pass the constructor first — source order orders the
// result. `bodies` is always an array of bodies: a body is itself an
// array, so no runtime test could tell one from a list of them.
export function ctorAtFields(bodies) {
  const out = [];
  const seen = new Map();
  const walk = (n, inArrow) => {
    if (isList(n)) {
      for (const el of n) walk(el, inArrow);
      return;
    }
    if (!isStruct(n)) return;
    const h = n[0];
    // The boundary is WHOSE `this` a function has, not whether one is
    // nested. `->`/`def` emit a plain function, whose `this` is
    // dynamic — an assignment there says nothing about this class. A
    // BOUND `=>` emits an arrow, whose `this` is lexically whatever
    // encloses it, so inside the constructor it is the instance and
    // its assignment declares. An arrow under a `->` is still excluded
    // by the `->` above it, which is the correct reading: by then the
    // `this` it captures is the function's.
    if (h === '->' || h === 'def' || h === 'class' || h === 'component' || h === 'schema') return;
    const name = h === '=' && n.length === 4 ? thisField(n[2]) : null;
    if (name !== null) {
      const prior = seen.get(name);
      if (prior === undefined) {
        const entry = { name, node: n, nodes: [n], viaArrow: inArrow };
        seen.set(name, entry);
        out.push(entry);
      } else {
        prior.nodes.push(n);
        // A direct assignment supplies the inference an arrow's cannot,
        // wherever it sits — the field is not arrow-only.
        if (!inArrow) prior.viaArrow = false;
      }
    }
    for (let i = 2; i < n.length; i++) walk(n[i], inArrow || h === '=>');
  };
  for (const body of bodies) walk(body, false);
  return out;
}
// A module IMPORT STATEMENT. A dynamic `import(expr)` is a call node, so
// the head alone discriminates. The declaration pipeline asks too.
export const isModuleImportNode = (x) => isNode(x) && x[0] === 'import';

// An effect, by its NodeStore row.
const isEffect = (stores, x) => x[0] === 'effect' && semanticKindIn(stores, x) === 'effect';

// Does this subtree await, making the function that owns it async? An
// awaited call (`f!`) and an awaited `for … as` loop await too. Nested
// function and class bodies own their awaits, and so does an effect,
// which emits as a function of its own. A schema's code is its own
// program. The face, the component type story and the declarations all
// decide a return type from this, so it is shared rather than read from
// one emission's analysis.
export function containsAwait(x, stores) {
  if (!Array.isArray(x)) return false;
  if (isList(x)) return x.some((item) => containsAwait(item, stores));
  if (!isStruct(x)) return false;
  const head = x[0];
  if (head === 'await' || (isCall(x) && x[1].await === true)) return true;
  if (head === 'loop' && x[1].await === true) return true;
  // A class body owns its awaits; its heritage evaluates in this scope.
  if (head === 'class') return containsAwait(x[3], stores);
  if (head === '->' || head === '=>' || head === 'def' || head === 'schema' || isEffect(stores, x)) return false;
  for (let i = 2; i < x.length; i++) if (containsAwait(x[i], stores)) return true;
  return false;
}

// Does this subtree yield, making the function that owns it a generator?
// The same boundaries as containsAwait.
export function containsYield(x) {
  if (!Array.isArray(x)) return false;
  if (isList(x)) return x.some(containsYield);
  if (!isStruct(x)) return false;
  const head = x[0];
  if (head === 'yield' || head === 'yield-from') return true;
  if (head === 'class') return containsYield(x[3]);
  if (head === '->' || head === '=>' || head === 'def' || head === 'schema') return false;
  for (let i = 2; i < x.length; i++) if (containsYield(x[i])) return true;
  return false;
}
