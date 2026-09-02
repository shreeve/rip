// The component TYPE story — one walker and one set of
// renderers shared by the two typed artifacts: the TS-face emission
// (src/emitter.js — TS-only member declares, the constructor's props
// surface, the companion interface) and declaration emission
// (src/ts/dts.js — the component's .d.ts shape). Both render from the
// SAME recorded data: the member model read off the component node's
// statements, annotation/optionalMarker spans from the side tables
// (side-band roles), never re-derived from generated code.
//
// The type conventions (settled):
//   - a reactive member (state, prop) types its CONTAINER —
//     `{ value: T }`, the reactive convention; a computed's
//     container is `{ readonly value: T }`; readonly/plain members
//     and accept handles type the raw value.
//   - unannotated members type `{ value: any }` / `any` — the
//     CONTAINER shape is the lowering's own fact, the value type is
//     TypeScript's honest unknown-ness; the face never invents a
//     value type.
//   - the PROPS surface: a prop accepts a snapshot OR a container
//     (`T | { value: T }` — the #135 sharing contract admits both),
//     with a `__bind_x__` slot for the `<=>` channel; `@x: T`
//     (annotated, no marker, no default) is REQUIRED — passable as
//     the plain slot or the bind slot (a per-prop union arm);
//     everything else is optional; `@x?: T` renders `x?: T | …`.
//   - `extends <tag>`: the props surface gains the tag's attribute
//     names (src/dom.js — spec-derived data, the #125 table)
//     and the data-/aria- template index signatures (undeclared rest
//     props ride the templates — a misspelled DECLARED prop draws the
//     excess-property did-you-mean instead of falling through a
//     catch-all; excess-property checking stays ON for non-extends
//     components — the #131 fix's editor twin).
//
// Renderers produce SEGMENT lists ({ text } | { text, node, role })
// so the face can mark each named piece under its recorded store row
// (the CodeBuilder mark protocol decides exact vs cover) while dts
// joins the same segments as plain text — one assembly, two
// consumers, no drift.

import { tidyType, normalizeTypeText, renderParams, optionalReader } from './types.js';
import { attributeNamesFor } from '../dom.js';
import { CAMEL, CLASS_TYPE } from './dom-types.js';

// Same spellings as src/emitter.js COMPONENT_HOOKS (emission owns the
// JS-face list; this file cannot import the emitter).
const COMPONENT_HOOKS = new Set(['beforeMount', 'mounted', 'beforeUnmount', 'unmounted', 'onError']);

const isNode = (x) => Array.isArray(x);
const isFunc = (x) => isNode(x) && (x[0] === '->' || x[0] === '=>') && x.length === 3;
const isBlock = (x) => isNode(x) && x[0] === 'block';

// A member TARGET: `x` (private) or `@x` ([".", "this", "x"]).
const memberTarget = (t) => {
  if (typeof t === 'string') return { name: t, isPublic: false };
  if (isNode(t) && t[0] === '.' && t[1] === 'this' && t.length === 3 && typeof t[2] === 'string') {
    return { name: t[2], isPublic: true };
  }
  return null;
};

// containsAwait's shape (the Promise spelling for async methods):
// nested function/class bodies keep their own awaits.
const awaitsIn = (x) => {
  if (!isNode(x)) return false;
  const h = x[0];
  if (h === 'await' || h === 'dammit!' || h === 'dammit?') return true;
  if (h === 'for-as' && x[3] === true) return true;
  if (h === '->' || h === '=>' || h === 'def' || h === 'void-def' || h === 'class') return false;
  return x.some(awaitsIn);
};

// containsYield's shape, on the same boundaries: a generator method
// returns its ITERATOR, so neither the void spelling nor the Promise
// wrap below names what its caller receives.
const yieldsIn = (x) => {
  if (!isNode(x)) return false;
  const h = x[0];
  if (h === 'yield' || h === 'yield-from') return true;
  if (h === '->' || h === '=>' || h === 'def' || h === 'void-def' || h === 'class') return false;
  return x.some(yieldsIn);
};

// ── the walker ───────────────────────────────────────────────────────
// Reads a VALID component node (JS emission has already accepted it —
// every rejection class fires before any type story renders) into the
// member list the renderers consume. Statements that carry no type
// story (render, effects) skip; anything unrecognized skips rather
// than guessing (the JS emission is the rejection authority).
// `behavior` names the face's per-component behavior object, or is
// null on the road that has none (dts). Every member carries it, so
// the segment assembly can read a computed's type through the body.
export function componentTypeInfo(stores, source, node, behavior = null) {
  const [, parent, body] = node;
  const extendsTag = typeof parent === 'string' ? parent : null;
  const stmts = isBlock(body) ? body.slice(1) : [];
  const members = [];

  const semantic = (n) => {
    if (!isNode(n)) return null;
    const id = stores.idOf(n);
    return id !== null ? stores.node(id)?.semanticKind : null;
  };
  const roleText = (n, role) => {
    if (source == null) return null;
    const id = isNode(n) ? stores.idOf(n) : null;
    if (id === null) return null;
    const row = stores.role(id, role);
    if (!row || row.sourceStart == null) return null;
    return normalizeTypeText(source.slice(row.sourceStart, row.sourceEnd).replace(/^\s*:\s*/, ''));
  };
  const hasRole = (n, role) => {
    const id = isNode(n) ? stores.idOf(n) : null;
    return id !== null && stores.role(id, role) !== null;
  };
  // The name's mark coordinates: a bare target re-marks the owning
  // statement's `target` role; an `@name` target re-marks the member
  // node's `property` role.
  const nameMark = (stmt, t) =>
    typeof t === 'string' ? { nameNode: stmt, nameRole: 'target' } : { nameNode: t, nameRole: 'property' };

  const classify = (stmt) => {
    const kind = semantic(stmt);
    if (kind === 'render' || kind === 'effect') return;
    if (kind === 'offer') {
      classify(stmt[1]);
      return;
    }
    if (kind === 'accept' && typeof stmt[1] === 'string') {
      members.push({
        node: stmt, name: stmt[1], kind: 'accept', isPublic: false,
        optional: false, hasDefault: false, annotation: null,
        nameNode: stmt, nameRole: 'name',
      });
      return;
    }
    if (((kind === 'state' || kind === 'computed' || kind === 'readonly') && stmt.length === 3) ||
        (kind === 'gate' && stmt.length >= 3)) {
      const t = memberTarget(stmt[1]);
      if (t === null) return;
      members.push({
        node: stmt, name: t.name, kind, isPublic: t.isPublic,
        optional: hasRole(stmt, 'optionalMarker'), hasDefault: true,
        annotation: roleText(stmt, 'annotation'),
        ...nameMark(stmt, stmt[1]),
      });
      return;
    }
    if (!isNode(stmt)) return;
    // `@x?` — the optional bare prop (an existence node over the
    // member; the `?` glyph is the operator literal, span-less).
    if (stmt[0] === '?' && stmt.length === 2) {
      const t = memberTarget(stmt[1]);
      if (t === null || !t.isPublic) return;
      members.push({
        node: stmt, name: t.name, kind: 'prop', isPublic: true,
        optional: true, hasDefault: false, annotation: null,
        nameNode: stmt[1], nameRole: 'property',
      });
      return;
    }
    // `@x: T` / `@x?: T` — the typed prop (a typed-var wrapper; the
    // optionalMarker role carries the `?` span side-band).
    if (stmt[0] === 'typed-var' && stmt.length === 3) {
      const t = memberTarget(stmt[1]);
      if (t === null || !t.isPublic) return;
      members.push({
        node: stmt, name: t.name, kind: 'prop', isPublic: true,
        optional: hasRole(stmt, 'optionalMarker'), hasDefault: false,
        annotation: roleText(stmt, 'annotation') ?? tidyType(stmt[2]),
        ...nameMark(stmt, stmt[1]),
      });
      return;
    }
    // `@x` — the bare required prop.
    if (stmt[0] === '.' && stmt[1] === 'this' && stmt.length === 3 && typeof stmt[2] === 'string') {
      members.push({
        node: stmt, name: stmt[2], kind: 'prop', isPublic: true,
        optional: false, hasDefault: false, annotation: null,
        nameNode: stmt, nameRole: 'property',
      });
      return;
    }
    // Plain assigns: fields, methods, hooks.
    if ((stmt[0] === '=' || stmt[0] === 'void-assign') && stmt.length === 3) {
      const t = memberTarget(stmt[1]);
      if (t === null) return;
      const isVoid = stmt[0] === 'void-assign';
      if (isFunc(stmt[2])) {
        members.push({
          node: stmt, name: t.name,
          kind: COMPONENT_HOOKS.has(t.name) ? 'hook' : 'method',
          isPublic: false, optional: false, hasDefault: true, annotation: null,
          func: stmt[2], isVoid,
          ...nameMark(stmt, stmt[1]),
        });
        return;
      }
      if (isVoid) return;
      members.push({
        node: stmt, name: t.name, kind: 'plain', isPublic: t.isPublic,
        optional: false, hasDefault: true,
        annotation: roleText(stmt, 'annotation'),
        // The stores' semanticKind decides component-ness (the emitter's
        // own doctrine) — a user function named `component` builds a
        // same-headed CALL node, which a shape test would misread.
        isComponentValued: semantic(stmt[2]) === 'component',
        ...nameMark(stmt, stmt[1]),
      });
      return;
    }
    // Colon-method groups (`save: (e) -> …`).
    if (stmt[0] === 'object') {
      for (const pair of stmt.slice(1)) {
        if (!isNode(pair) || (pair[0] !== ':' && pair[0] !== 'void-pair')) continue;
        if (typeof pair[1] !== 'string' || !isFunc(pair[2])) continue;
        members.push({
          node: pair, name: pair[1],
          kind: COMPONENT_HOOKS.has(pair[1]) ? 'hook' : 'method',
          isPublic: false, optional: false, hasDefault: true, annotation: null,
          func: pair[2], isVoid: pair[0] === 'void-pair',
          nameNode: pair, nameRole: 'key',
        });
      }
    }
  };

  for (const stmt of stmts) classify(stmt);
  // Sibling-name set for the typeof-spelling guard (a member's
  // initializer rooted at another member cannot spell module-scope
  // typeof).
  const siblings = new Set(members.map((m) => m.name));
  for (const m of members) { m.siblings = siblings; m.behavior = behavior; }
  return {
    extendsTag,
    behavior,
    members,
    roleText,
    // The shared optionality reader, carried on `info` because BOTH
    // signature emitters render a component's instance type through
    // the same instanceTypeLines() — so a dropped `?` here is dropped
    // in the face AND the .d.ts identically. They agree, and are both
    // wrong: the face's own method body keeps `note?` while the
    // instance type it declares says `note` is required, so a legal
    // call draws a spurious TS2554. Agreeing outputs mean no
    // face/dts diff can see it, and both are valid TS, so no tsc gate
    // can either. Read the role; never assume.
    isOptionalParam: optionalReader(stores),
  };
}

// ── segment assembly ─────────────────────────────────────────────────
// A segment is { text } or { text, node, role }; the face marks the
// named pieces (mark() no-ops where the role has no store row — the
// span-less optional glyphs), dts joins the text.
export const segmentsText = (segs) => segs.map((s) => s.text).join('');

// Is a reactive-container member — its runtime slot is a `__state`
// container ({ value: T; read(): T; touch(): void }).
const containerish = (m) => m.kind === 'state' || m.kind === 'prop';

// A WRITABLE container's notify seam: a nested write (`form.first <=> …`)
// changes no container identity, so the bind notifies the root through
// `touch`. The two spellings answer two different questions, and a
// container position must pick the one that matches how it got its
// container:
//
//   MINTED — the slot holds a container `__state` made (a module
//     reactive, `rest`, a component's own `:=` member). It has `touch`,
//     so the type says so outright and a consumer holding the container
//     writes `count.touch()` with no guard. Spelling this optional was
//     measured: under `rip.strict` the guardless call draws TS2722 on a
//     notify that cannot be absent.
//
//   TAKEN — the slot ACCEPTS a container from somewhere else (a prop, a
//     bind channel, and the prop's own instance type, since that is the
//     accepted container). The sharing contract admits a caller-supplied
//     `{ value, read }`, which the runtime treats as a container (the
//     `read` predicate) but which has no `touch`, so its nested writes
//     notify nothing. Optional is the honest spelling and is why the
//     lowering emits `.touch?.()` rather than `.touch()`.
//
// Read-only containers (`~=`) have no `touch` at runtime and spell
// neither. TAKEN is the default: claiming a `touch` that is not there
// rejects containers the runtime accepts, which is the louder failure.
export const MINTED = '; touch(): void';
export const TAKEN = '; touch?(): void';

// The container type carries the STRUCTURAL BRAND `read(): T` — the
// runtime's own container-detection predicate (`typeof x.read ===
// 'function'`, src/runtime/reactive.js), spelled into the type. A
// plain object literal (`{ value: 5 }`) is NOT signal-shaped: the
// runtime would DOUBLE-WRAP it (`__state({value: 5})` makes `.value`
// the object), so the type must reject it — and with the predicate AS
// the brand, anything the type accepts is exactly what the runtime
// treats as a container (type story = runtime truth — taken
// structurally: a unique-symbol brand would
// need the ambient-mode symbol and the inline-mode runtime's own
// symbol to be the SAME type, which no spelling gives — `read` is
// already on every real container's inferred type in every delivery).
// The bare parameter NAMES of a type-parameter list, for the self-arguments
// a generic component's own surface applies (`mount(): Select<TOption>` —
// constraints stay on the header that declares them). Split at bracket
// DEPTH ZERO: a constraint or default carries its own commas
// (`<T extends Record<string, number>>`), and a naive split renders a list
// that does not parse, which is a worse failure than the unbound name it
// was meant to fix.
export const typeParamNames = (typeParams) => {
  if (!typeParams) return [];
  const body = typeParams.slice(1, -1);
  const names = [];
  let depth = 0, start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    // A quoted constraint carries whatever bytes it likes, commas and
    // brackets included — skip to its close before counting anything.
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < body.length; i++) {
        if (body[i] === '\\') { i++; continue; }
        if (body[i] === c) break;
      }
      continue;
    }
    if (c === '<' || c === '(' || c === '[' || c === '{') depth++;
    // The `>` of an ARROW closes nothing: a function-type constraint
    // (`F extends () => void`) would otherwise drive depth negative and
    // swallow the comma that ends the parameter.
    else if (c === '>' && body[i - 1] === '=') continue;
    else if (c === '>' || c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { names.push(body.slice(start, i)); start = i + 1; }
  }
  names.push(body.slice(start));
  // A variance or const modifier precedes the name it governs.
  const MODIFIERS = new Set(['const', 'in', 'out']);
  return names.map((n) => {
    const words = n.trim().split(/\s+/).filter(Boolean);
    while (words.length > 1 && MODIFIERS.has(words[0])) words.shift();
    return words[0] ?? '';
  }).filter(Boolean);
};

// The same arity filled with `any` — for a surface that references the
// component's own type where no parameter is in scope to name.
export const anyArgsOf = (typeParams) => {
  const n = typeParamNames(typeParams).length;
  return n === 0 ? '' : `<${Array(n).fill('any').join(', ')}>`;
};

// The self-reference arguments for a generic surface — `<A, B>` — or ''.
export const selfArgsOf = (typeParams) => {
  const names = typeParamNames(typeParams);
  return names.length === 0 ? '' : `<${names.join(', ')}>`;
};

export const containerType = (t, ro = '', notify = TAKEN) =>
  `{ ${ro}value: ${t}; read(): ${t}${ro === '' ? notify : ''} }`;

// The member's INSTANCE type as segments (`declare name: …` bodies,
// interface member lines). The annotated piece marks as `: T` — the
// recorded span's own shape (a TYPE run spans colon→end), so the
// builder's verbatim comparison can classify it EXACT. An optional
// annotated member whose slot can actually be absent reads
// `T | undefined` (widensToUndefined — the VOID SLOT); an optional
// member whose default fills the slot stays `T`.
// Syntactic literal inference for unannotated member initializers
//: `loading := false` declares `{ value: boolean }` —
// what `let loading = false` would infer, computed from the literal
// alone (no checker in the emitter; the same widening rules as
// declare-in-place: literals widen, `let` members stay mutable).
// Non-evident initializers keep `any`.
export const syntacticLiteralType = (v) => {
  if (typeof v === 'string') {
    if (v === 'true' || v === 'false') return 'boolean';
    if (/^-?\d[\d_]*(\.\d+)?$/.test(v)) return 'number';
    if (/^["'][^]*["']$/.test(v)) return 'string';
    return null;
  }
  if (!Array.isArray(v)) return null;
  const h = v[0];
  if (h === 'str') return 'string';
  if (h === 'array') {
    if (v.length === 1) return 'any[]';
    const el = new Set(v.slice(1).map(syntacticLiteralType));
    return el.size === 1 && !el.has(null) ? `${[...el][0]}[]` : null;
  }
  // Operator results with syntactically-fixed types (the reactive
  // faces lean on these: `clicks * 2` is number whatever clicks is;
  // comparisons are boolean; `+` only when both sides agree).
  if (v.length === 3 && ['*', '/', '%', '**', '//', '%%', '-', '<<', '>>', '>>>', '&', '^', '|'].includes(h)) return 'number';
  if (v.length === 2 && (h === '-' || h === '+')) return syntacticLiteralType(v[1]) === 'number' ? 'number' : null;
  if (v.length === 3 && ['<', '>', '<=', '>=', '==', '!='].includes(h)) return 'boolean';
  if (v.length === 2 && (h === '!' || h === 'not')) return 'boolean';
  if (v.length === 3 && (h === '&&' || h === '||' || h === '??')) {
    const a = syntacticLiteralType(v[1]);
    return a !== null && a === syntacticLiteralType(v[2]) ? a : null;
  }
  if (v.length === 3 && h === '+') {
    const a = syntacticLiteralType(v[1]);
    const b = syntacticLiteralType(v[2]);
    return a === 'number' && b === 'number' ? 'number' : a === 'string' && b === 'string' ? 'string' : null;
  }
  return null;
};

// typeof spelling for member initializers whose type is a NAME's:
// `store ~= cart` declares `typeof cart` (the module binding's full
// inferred type); `ref ~= new X({})` declares `InstanceType<typeof X>`.
// Only entity paths — plain identifiers, dotted identifier chains, and
// new-expressions over them — spell; anything else stays null.
const entityPath = (v) => {
  if (typeof v === 'string') {
    return /^[A-Za-z_$][\w$]*$/.test(v) &&
      !['true', 'false', 'null', 'undefined', 'this', 'it'].includes(v) ? v : null;
  }
  if (Array.isArray(v) && v[0] === '.' && v.length === 3 && typeof v[2] === 'string') {
    const base = entityPath(v[1]);
    return base === null ? null : `${base}.${v[2]}`;
  }
  return null;
};
const typeofSpelling = (v) => {
  const path = entityPath(v);
  if (path !== null) return `typeof ${path}`;
  if (Array.isArray(v) && v[0] === 'new' && v.length === 2 &&
      Array.isArray(v[1]) && typeof v[1][0] === 'string' && /^[A-Za-z_$][\w$]*$/.test(v[1][0])) {
    return `InstanceType<typeof ${v[1][0]}>`;
  }
  return null;
};

// Does the face declare this member as the lowering's CONTAINER rather
// than as its value? Only these have a container for a declaration
// hover to see past — a `=!` or plain member's declared type IS its
// value type (`declare readonly cap: number`), and a member whose
// annotation happens to spell the container shape by hand meant it.
export const declaresContainer = (m) =>
  containerish(m) || m.kind === 'computed' || m.kind === 'gate';

// Does this member's face type read through the lowering's behavior
// object? The projection below is the one member type spelled from a
// MINTED name, which the editor cannot present in the author's
// vocabulary — so the two places that care read one predicate.
export const isBehaviorProjected = (m) =>
  m.kind === 'computed' && m.annotation == null && Boolean(m.behavior);

// The FORM TABLE: the spellable type of a member — the author's
// annotation, a syntactic literal's type, or a module-scope `typeof`
// for entity paths. Null when nothing is spellable (a call, a
// sibling-rooted read, a `this` chain).
export const formTableType = (m) => {
  // The typeof spelling resolves at MODULE scope (the declare row sits
  // on the class) — an initializer rooted at a SIBLING member
  // (`bad1 ~= store.itms`) must not spell it (this.store is not in
  // scope there); those members keep nothing.
  const rootOf = (v) => (typeof v === 'string' ? v
    : Array.isArray(v) && v[0] === '.' && v.length === 3 ? rootOf(v[1]) : null);
  const init = Array.isArray(m.node) && m.node.length === 3 ? m.node[2] : undefined;
  const siblingRooted = m.siblings !== undefined && init !== undefined && m.siblings.has(rootOf(init));
  return m.annotation ??
    (m.hasDefault && !siblingRooted && init !== undefined
      ? (syntacticLiteralType(init) ?? typeofSpelling(init))
      : null);
};

// A PRIVATE plain member the form table cannot spell reads through the
// behavior object too (`updateUser = createMutation(...)` — a call
// spells nothing, and `any` buried the initializer's real type). The
// emitter captures the initializer as a thunk under the same predicate,
// so the two decisions cannot drift. Public plain members stay out (the
// props seam types them), and a member-held component declaration is
// excluded by the stores' SEMANTIC verdict, recorded at classify time
// (its class must not be re-lowered into a thunk).
export const plainBehaviorValued = (m) =>
  m.kind === 'plain' && !m.isPublic && Boolean(m.behavior) &&
  formTableType(m) === null && m.isComponentValued !== true;

// The VOID SLOT: `?:` reaches inside the container — but only where
// absence can actually inhabit the slot. `x?: T` is `T | undefined` in
// TypeScript's own reading, so an optional member with no default (a
// prop the caller may omit) and one whose default IS `undefined`
// (`x?: T := undefined` — the author managing absence as a value) carry
// it on `value` and `read()`. An optional member with a real default is
// optional to the CALLER only — the default fills the slot, so inside
// it is always `T`, TypeScript's own optional-with-default semantics.
// Every surface that spells the member's container consults this one
// predicate — the instance slot and the `<=>` bind seam must agree, or
// a parent binding an equally-widened signal is rejected at the prop.
const widensToUndefined = (m) => {
  if (!m.optional) return false;
  if (!m.hasDefault) return true;
  return Array.isArray(m.node) && m.node.length === 3 && m.node[2] === 'undefined';
};

const memberTypeSegments = (m, lead, info = null) => {
  // An unannotated computed reads its type from the BODY, through the
  // face's behavior object (the emitter emits one per named component,
  // carrying the same compiled bodies `_init` does). The form table
  // below cannot do this: it reads the initializer's SHAPE, so `count
  // * 2` types number and `words.length` types any. An author's own
  // annotation still wins — it is a declaration, not a guess.
  //
  // `m.behavior` is absent on the dts road, which has no module-local
  // value to name and keeps the form table (the schema-callable
  // precedent: derivation reaches this checker, not consumers).
  if (isBehaviorProjected(m)) {
    const rt = `ReturnType<typeof ${m.behavior}.${m.name}>`;
    return [{ text: `${lead}{ readonly value: ${rt}; read(): ${rt} }` }];
  }
  const t = formTableType(m);
  const typed = t !== null
    ? [{ text: `: ${t}`, node: m.node, role: 'annotation' }]
    : [{ text: ': any' }];
  const vt = t ?? 'any';
  if (m.kind === 'accept') return [{ text: `${lead}any` }];
  // The container renders the member's type TWICE — once on `value`, once
  // as `read()`'s return. Both spellings are the same annotation, so both
  // carry its span: an unmarked one falls to whatever cover encloses the
  // line, which in the companion interface is the whole component.
  const readBack = (pre, post) => (t !== null
    ? [{ text: pre }, { text: vt, node: m.node, role: 'annotation' }, { text: post }]
    : [{ text: `${pre}${vt}${post}` }]);
  if (containerish(m)) {
    const und = t !== null && widensToUndefined(m) ? ' | undefined' : '';
    // PUBLIC is the line, not the kind: a member the caller can reach
    // takes whatever container arrives on its bind channel, and a
    // defaulted prop (`@step: number = 1`) carries kind 'state' while
    // `_init` still reads `props.__bind_step__` first. A private member
    // is minted here and nowhere else.
    const notify = m.isPublic ? TAKEN : MINTED;
    return [
      { text: `${lead}{ value` }, ...typed,
      ...readBack(`${und}; read(): `, `${und}${notify} }`),
    ];
  }
  if (m.kind === 'computed' || m.kind === 'gate') {
    // An unannotated gate with a discovered stash projects its type from
    // the path it reads (stashProjection) — the member the author left
    // bare infers instead of falling to `any`. This road writes the
    // projection as a type node (an interface member has no inferred
    // position to take); the class declare road resolves the display.
    if (m.kind === 'gate' && t === null) {
      const proj = stashProjection(m, info);
      if (proj !== null) {
        return [{ text: `${lead}{ readonly value: ` }, { text: proj, node: m.nameNode, role: m.nameRole }, { text: `; read(): ${proj} }` }];
      }
    }
    return [{ text: `${lead}{ readonly value` }, ...typed, ...readBack('; read(): ', ' }')];
  }
  // A thunked plain member projects like a behavior computed: the
  // interface spells ReturnType over the minted name (a written node,
  // correct for checking; the class road's inferred field is what
  // resolves the display).
  if (plainBehaviorValued(m)) {
    return [{ text: `${lead}ReturnType<typeof ${m.behavior}.${m.name}>` }];
  }
  if (t === null) return [{ text: `${lead}any` }];
  return typed; // readonly / plain: the annotation IS `: T`
};

// One face `declare` line for a non-callable member (methods and
// hooks are REAL class methods — their annotations ride the shared
// param/return machinery).
export const memberDeclareSegments = (m, info = null) => {
  // An unannotated computed takes an INFERRED position rather than a
  // `declare` carrying a type node. TypeScript's quickinfo echoes a
  // written type node VERBATIM — driven against tsgo, both
  // `ReturnType<typeof f>` and an inlined conditional print exactly as
  // spelled, resolved neither time — so no projection can be written that
  // does not read as machinery, and no server-side rewrite reaches past
  // it. A declaration with no type node has nothing to echo, so
  // TypeScript prints the RESOLVED type instead.
  //
  // The initializer reuses the behavior object the face already carries,
  // which holds the same compiled body `_init` assigns, so nothing is
  // computed twice and the two cannot drift. At a field initializer
  // `this` is the class, which is the position v3 reaches by
  // construction (its shadow emits the computed as a field with its
  // initializer). TS-only: the region strips, and `_init`'s assignment
  // remains the only one the shipped JS carries.
  if (isBehaviorProjected(m)) return [
    { text: m.name, node: m.nameNode, role: m.nameRole },
    // `this as any` is not sloppiness — it breaks a real circularity. The
    // behavior function declares `this: <Component>`, and the member being
    // initialized is PART of that component's type, so checking the
    // argument's assignability means resolving the class while this field
    // is still being inferred (driven: TS2345, `'this' is not assignable to
    // parameter of type 'Badge'`). The cast costs nothing that matters: the
    // return type comes from the function's own signature, not from the
    // argument, so the member still infers its resolved value type. v3
    // avoids the circularity differently, by inlining the body so `this` is
    // only ever a receiver and never an argument.
    { text: ` = __computed(() => ${m.behavior}.${m.name}.call(this as any));` },
  ];
  // A thunked plain member takes the same inferred position: the field
  // calls the behavior thunk the emitter captured (emitPlainish), and
  // the member infers the initializer's real type instead of the form
  // table's `any`. `this as any` breaks the same circularity the
  // computed branch documents.
  if (plainBehaviorValued(m)) return [
    { text: m.name, node: m.nameNode, role: m.nameRole },
    { text: ` = ${m.behavior}.${m.name}.call(this as any);` },
  ];
  // A stash-projected gate never reaches here: the emitter emits its
  // face TWIN (emitGateTwin — the read the author wrote, through
  // `__computed` and `!`) before consulting this table, for the same
  // reason the computed branch above exists: an inferred position
  // prints resolved where a written node echoes.
  return [
    // A `=!` member is a CONST value: readonly on the declare, so
    // instance writes draw TS2540.
    { text: m.kind === 'readonly' ? 'declare readonly ' : 'declare ' },
    { text: m.name, node: m.nameNode, role: m.nameRole },
    ...memberTypeSegments(m, ': ', info),
    { text: ';' },
  ];
};

// The `=!` seam's this-cast type: one MUTABLE member carrying the
// declared type the class states readonly. `_init` is the lowering's
// constructor seam, so its one legitimate readonly write has to quiet
// TS2540 — through a cast that keeps the member's type, so the value
// still checks against it.
export const readonlyCastType = (m) => `{ ${m.name}${segmentsText(memberTypeSegments(m, ': '))} }`;

export const isDeclarableMember = (m) => m.kind !== 'method' && m.kind !== 'hook';

// ── the props surface ────────────────────────────────────────────────
const publicProps = (info) =>
  info.members.filter((m) => m.isPublic && (containerish(m) || m.kind === 'readonly' || m.kind === 'plain'));

const isRequiredProp = (m) => m.kind === 'prop' && m.annotation !== null && !m.optional;

// A props-object key spelling (attribute names may carry hyphens).
const keyText = (name) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : `'${name}'`);

// Every component takes `props` optionally unless a REQUIRED prop
// exists (annotated `@x: T`, no marker, no default).
export const propsParamOptional = (info) => !publicProps(info).some(isRequiredProp);

// The props object type as segments: every prop as an optional entry
// with its `<=>` bind slot, `children` (+ the extends attribute
// surface and its index signature), then one union arm per REQUIRED
// prop making it non-optional — passable as the plain slot or the
// container slot (the base keeps both keys optional so _init's
// `props.x` / `props.__bind_x__` reads type on every arm).
// The projection channel's type. The union is the runtime's admission
// and is what the .d.ts road spells inline (a declaration file owes its
// reader a self-contained type); the FACE road names it through the
// `__RipChildren` alias the editor scrubs to `Children` — a name at the
// hover, the union one hop behind it.
export const CHILDREN_UNION = 'Node | string | number | boolean | null';
const childrenType = (road) => (road === 'face' ? '__RipChildren' : CHILDREN_UNION);

// The passthrough object an `extends` component admits beyond what it
// declares — the same object on two surfaces: the props ctor spells it
// inline (less the keys declared props own), and the `rest` view holds
// it. Intrinsic attr typing: each attribute types through the tag's DOM
// interface — `disabled?:` on a button is boolean, not any — via an
// extends-Record guard so attributes with no matching property fall back
// to any instead of erroring. Attributes whose DOM property is camelCased
// get BOTH spellings (authors write maxLength; the spec list says
// maxlength) — the shared CAMEL bridge, the same one the intrinsic
// surfaces read. Undeclared rest props ride the data-/aria- templates —
// the same admission the intrinsic surfaces make. A misspelled DECLARED
// prop must draw the excess-property did-you-mean instead of falling
// through a catch-all, so there is no string index.
export const REST_TEMPLATES = '[key: `data-${string}`]: any; [key: `aria-${string}`]: any';
export function restPassthroughEntries(tag, road = 'dts') {
  const tagMap = `HTMLElementTagNameMap[${JSON.stringify(tag)}]`;
  const guarded = (prop) => `${tagMap} extends Record<'${prop}', infer T> ? T : any`;
  const isHtmlTag = attributeNamesFor(tag).length > 0 && !/^(svg|path|circle|rect|line|g|text|defs|use)$/.test(tag);
  const out = [];
  const seen = new Set();
  const put = (key, t) => { if (!seen.has(key)) { seen.add(key); out.push([key, t]); } };
  for (const attr of attributeNamesFor(tag)) {
    // Two keys take the element roads' own types rather than the DOM guard.
    // `class` has no property of its name (the property is `className`, no
    // camel-casing of it) and the runtime applies it through __clsx, so both
    // spellings admit the clsx vocabulary — on the face; the clsx alias is
    // recursive and the declaration road ships no minted names, so a .d.ts
    // keeps `any` there. `style` is a string or an object at runtime, the
    // attribute road's admission: the DOM property widened by `| string`.
    if (attr === 'class') {
      const t = road === 'face' ? CLASS_TYPE : 'any';
      put('class', t); put('className', t);
      continue;
    }
    const prop = CAMEL[attr] ?? attr;
    const t = !isHtmlTag ? 'any' : attr === 'style' ? `(${guarded('style')}) | string` : guarded(prop);
    put(attr, t);
    if (prop !== attr) put(prop, t);
  }
  return out;
}
// The `rest` view's value type, spelled whole: what the face names through
// the per-tag `__RipRest_<tag>` alias (the editor shows it as `Rest<tag>`),
// and what the shipped declarations spell inline.
export const restPassthroughText = (tag, road = 'dts') =>
  `{ ${restPassthroughEntries(tag, road).map(([k, t]) => `${keyText(k)}?: ${t}`).join('; ')}; ${REST_TEMPLATES} }`;
export const restAliasName = (tag) => `__RipRest_${tag.replace(/[^A-Za-z0-9_]/g, '_')}`;
// Every DOM-lib global the minted declaration text can spell: `Node`
// in the children union, the tag map under `extends`. A declaration
// file naming one carries its own `dom` lib reference (src/ts/dts.js),
// so a consumer compiled with the language lib alone still resolves
// every name the file uses; a new DOM global in the minted text joins
// this list or the consumer's TS2304 is the only gate that sees it.
export const DOM_LIB_GLOBALS = ['Node', 'HTMLElementTagNameMap'];

export function propsTypeSegments(info, { road = 'dts' } = {}) {
  const props = publicProps(info);
  const segs = [{ text: '{ ' }];
  const used = new Set();
  let first = true;
  const sep = () => {
    if (!first) segs.push({ text: '; ' });
    first = false;
  };
  for (const m of props) {
    used.add(m.name);
    const t = m.annotation;
    sep();
    segs.push(
      { text: m.name, node: m.nameNode, role: m.nameRole },
      { text: '?', node: m.node, role: 'optionalMarker' },
    );
    const wide = t !== null && widensToUndefined(m) ? `${t} | undefined` : t;
    if (t === null) segs.push({ text: ': any' });
    else if (containerish(m)) segs.push({ text: `: ${t}`, node: m.node, role: 'annotation' }, { text: ` | ${containerType(wide)}` });
    else segs.push({ text: `: ${t}`, node: m.node, role: 'annotation' });
    if (containerish(m)) {
      segs.push({ text: `; __bind_${m.name}__?: ${containerType(wide ?? 'any')}` });
    }
  }
  // The projection channel — UNLESS the component declares a member
  // named `children` of its own (legal: `children` is ONE prop, the
  // extends record; a declared prop's entry above already carries the
  // name, and a duplicate key is TS2300 on every artifact (the
  // same member-wide suppression instanceTypeLines carries).
  if (!info.members.some((m) => m.name === 'children')) {
    sep();
    segs.push({ text: `children?: ${childrenType(road)}` });
  }
  used.add('children');
  if (info.extendsTag !== null) {
    // The passthrough object (restPassthroughEntries), less any key a
    // declared prop already owns.
    for (const [key, t] of restPassthroughEntries(info.extendsTag, road)) {
      if (used.has(key)) continue;
      segs.push({ text: `; ${keyText(key)}?: ${t}` });
    }
    segs.push({ text: `; ${REST_TEMPLATES}` });
  }
  segs.push({ text: ' }' });
  for (const m of props.filter(isRequiredProp)) {
    const t = m.annotation;
    segs.push(
      { text: ' & ({ ' },
      { text: m.name, node: m.nameNode, role: m.nameRole },
      { text: `: ${t}`, node: m.node, role: 'annotation' },
      { text: ` | ${containerType(t)} } | { __bind_${m.name}__: ${containerType(t)} })` },
    );
  }
  return segs;
}

export const propsTypeText = (info, opts = {}) => segmentsText(propsTypeSegments(info, opts));

// ── the constructor surface ──────────────────────────────────────────
// The members of the type a component BINDING carries, each a complete
// `;`-terminated line. One construction serves both manifestations —
// the shipped `.d.ts` declaration and the face's hoist-line annotation
// for a forward-referenced binding — so a consumer and the declaring
// module read the same component type. `self` is the instance type as
// this surface must name it (a generic component's own parameters,
// applied).
// The same constructor type as SEGMENTS — the props block carrying each
// member's node — for the hoist line, where the face declares a
// forward-used component's binding: a prop key at a use site navigates
// to its declaration through this text, so the names in it map.
export const componentCtorSegments = (info, name, typeParams = '', self = name, opts = {}) => {
  if (info.members.some((m) => m.kind === 'gate')) return [{ text: `{ readonly prototype: ${name}${anyArgsOf(typeParams)}; }` }];
  const optional = propsParamOptional(info);
  return [
    { text: `{ new ${typeParams}(props${optional ? '?' : ''}: ` },
    ...propsTypeSegments(info, opts),
    { text: `): ${self};${optional ? ` mount${typeParams}(target?: any): ${self};` : ''} }` },
  ];
};

export const componentCtorMembers = (info, name, typeParams = '', self = name, opts = {}) => {
  // The GATED branch has no constructor to declare a parameter list on,
  // so the prototype cannot NAME one — `${name}<T>` would put an unbound
  // T inside a value's object type. It applies `any` per parameter: the
  // prototype is a runtime identity, and a gated component's consumer
  // reaches the instance through its route, never through this.
  if (info.members.some((m) => m.kind === 'gate')) {
    return [`readonly prototype: ${name}${anyArgsOf(typeParams)};`];
  }
  const optional = propsParamOptional(info);
  const members = [`new ${typeParams}(props${optional ? '?' : ''}: ${propsTypeText(info, opts)}): ${self};`];
  // The static mount mirror constructs with NO props (`new this()` in
  // the runtime), so a component with a REQUIRED prop must not offer it
  // — the call would be tsc-clean while the runtime yields a required
  // container holding undefined. Requiredness is a TYPE-story fact
  // (annotations erase — the runtime never sees it), so the gate lives
  // here, never as a runtime throw.
  if (optional) members.push(`mount${typeParams}(target?: any): ${self};`);
  return members;
};

// ── the instance surface ─────────────────────────────────────────────
// The lines shared by the face's companion interface and the .d.ts
// declaration: every member (typed or explicit-any — a declared
// component carries its WHOLE public surface, so a consumer's legal
// call never draws TS2339), then the __Component API the runtime
// provides (mount returns the instance; static mount mirrors it on
// the constructor type).
// Each line is { text, node?, role? }. Behavior-projected computeds
// carry their member's name node: their ReturnType<> projection is
// where a type-level cycle surfaces (mutually-recursive computeds draw
// TS2502 on the container's `value`), and an unanchored line would
// cover-map that diagnostic across the whole component instead of the
// computed the author wrote. Every other line stays unanchored — the
// companion's enclosing $self mark serves it, and a second source row
// per member would compete with the class declare road's for hover.
// The runtime AMBIENCE, one list: the members every component instance
// carries without declaring them. The injection lives in
// src/runtime/components.js (mount injection and the launch-global
// fallback for `app`/`router`; `params`/`query` are route navigation
// state) — that site names this constant as its co-owner, and a name
// added there without a line here resurfaces as a TS7022 cycle on the
// first computed that reads it.
export const AMBIENT_FIELDS = ['app', 'router', 'params', 'query'];

// The API every component instance carries from the runtime BASE
// (src/runtime/components.js). The inlined runtime is destructured
// through a cast that types `__Component` as `any`, so a component's
// `class extends __Component` inherits nothing at the type level: both
// roads must DECLARE this surface, or the class instance is not
// assignable to the constructor type its own binding publishes.
// A null `returns` is the INSTANCE type, which each road spells its own
// way — the companion interface by name, the class road as `this`.
const RUNTIME_API = [
  { name: 'mount', params: 'target?: any', returns: null },
  { name: 'unmount', params: 'options?: { removeDOM?: boolean }', returns: 'void' },
  { name: 'emit', params: 'name: string, detail?: any', returns: 'void' },
];

// The interface road's spelling: method members.
export const runtimeApiMembers = (self) =>
  RUNTIME_API.map((m) => `${m.name}(${m.params}): ${m.returns ?? self};`);

// The class road's spelling: `declare` governs PROPERTIES, and a method
// signature in a class body would be an overload with no implementation
// — so the same surface takes the function-property form.
export const runtimeApiDeclares = (self) =>
  RUNTIME_API.map((m) => `declare ${m.name}: (${m.params}) => ${m.returns ?? self};`);

// The CLASS road's half of the ambience: with a discovered stash the
// class declares the same runtime-injected members the companion
// interface carries, so the REAL copies of `@app`/`@router` reads (the
// `_init` lowering, hooks, methods — where `this` is the class) type
// and hover as what the runtime injects instead of falling to
// error-`any` — which also swallowed wrong stash paths whole. NON-
// optional, unlike the interface's `?:`, on purpose: the class type is
// internal (consumers and hand-built values type against the
// interface), the lowering reads these only where the runtime injected
// them, and an optional here would draw possibly-undefined on every
// such read. An author member of the same name wins the line, as on
// the interface.
export const ambientClassDeclares = (info) => {
  if (!info.appStashSpec) return [];
  const taken = new Set(info.members.map((m) => m.name));
  const lines = [];
  for (const name of AMBIENT_FIELDS) {
    if (taken.has(name)) continue;
    // Not a `declare`: the written object type would echo its import()
    // splices verbatim in the hover. Inferred through `__ripAmbientApp`
    // (the emitter declares it once at module scope, from the emit()
    // tail), the member's type is INSTANTIATED and prints resolved.
    // TS-only like every line here; the runtime's injection remains the
    // only real assignment.
    if (name === 'app') lines.push(`app = __ripAmbientApp(0 as any as ${appDataType(info.appStashSpec)} & ${stashMethodsType(info.appStashSpec)});`);
    else if (name === 'router') lines.push(`declare router: ${routerAmbienceType(info)};`);
    else if (name === 'params') lines.push(`declare params: ${info.routeParams ?? 'Record<string, string>'};`);
    else lines.push(`declare ${name}: Record<string, string>;`);
  }
  return lines;
};

// The router's ambient type — ONE spelling for the class declare and the
// companion interface. Plain `import('rip/app').Router` without a route
// union; with one, the union-checked construction: Omit the two
// navigation members and re-add them in METHOD syntax. Not a generic
// `Router<R>` — arrow-typed properties check contravariantly under
// strictFunctionTypes, so `Router<Union>` and `Router<string>` would be
// mutually unassignable — and not an intersection, which unions an
// overloaded parameter and loses the narrowing; method syntax stays
// bivariant, so the typed router passes wherever a plain Router is
// expected. The conditional keys off the ARGUMENT'S SYNTAX: a
// `/`-leading string literal must inhabit the union (inlined, so the
// error reads as the actual route list), while dynamic strings,
// external URLs, and query/hash strings built as values fall through
// to P and pass.
export const routerAmbienceType = (info) => {
  if (!info.routesUnion) return `import('rip/app').Router`;
  const u = `(${info.routesUnion})`;
  const nav = (name) =>
    `${name}<const P extends string>(url: P extends \`/\${string}\` ? ${u} : P, opts?: { noScroll?: boolean }): boolean;`;
  return `Omit<import('rip/app').Router, 'push' | 'replace'> & { ${nav('push')} ${nav('replace')} }`;
};

export const appDataType = (spec) =>
  `import('rip/app').AppData<import(${JSON.stringify(spec)}).__RipStash>`;

// The stash-method surface, instantiated at the projected data shape so
// `source()` answers TYPED handles: a top-level key resolves through
// StashMethods' keyed overload to `SourceHandleFor<D[K]>`, and any
// other string — dotted paths included — stays legal on the permissive
// overload and answers the untyped handle. A NAMED reference on
// purpose, never an inline re-spelling of `source`: an anonymous type
// literal's signature internals print AS WRITTEN in hover, so an
// inlined overload pair echoes its `import(...)` splices on every
// `@app` hover — the same leak the `__ripAmbientApp` indirection
// exists to prevent, and the editor's no-leak sweep gates it. The cost
// is that a typo'd top-level key passes untyped instead of erroring:
// telling a dotted path from a typo needs a template-literal type,
// which the package cannot spell (Rip's structured types carry none)
// and this splice must not inline.
export const stashMethodsType = (spec) =>
  `import('rip/app').StashMethods<${appDataType(spec)}>`;

// The ambience's `app` member — ONE spelling for the interface road and
// the class road. `data` is what the runtime delivers: a Stash — the
// projected entries plus the StashMethods surface (`source()`, `inc`,
// `reset`, …), spelled as an intersection. gateProjection stays on the
// bare AppData: a gate path names a data entry, never a method.
export const appAmbienceType = (spec) =>
  `{ data: ${appDataType(spec)} & ${stashMethodsType(spec)}; [key: string]: any }`;

// A render gate's member type, projected from the stash the gate reads:
// `<~` admits only a literal `@app.data.<path>` (the emitter rejects the
// rest), so the member IS `NonNullable<AppData[…path]>` — non-null by the
// gate's own contract (the body does not render until the value exists) —
// and a keyed gate is the family's return, un-nulled the same way.
export const gateProjection = (m, spec) => {
  const chain = (n) => (typeof n === 'string' ? [n]
    : Array.isArray(n) && n[0] === '.' && n.length === 3 ? (chain(n[1]) ?? []).concat([n[2]]) : null);
  const segs = Array.isArray(m.node) && m.node.length >= 3 ? chain(m.node[2]) : null;
  if (!segs || segs.length < 4 || segs[0] !== 'this' || segs[1] !== 'app' || segs[2] !== 'data') return null;
  let t = appDataType(spec);
  for (const p of segs.slice(3)) t = `${t}[${JSON.stringify(p)}]`;
  if (m.node.length > 3) t = `ReturnType<Extract<${t}, (...args: any) => any>>`;
  return `NonNullable<${t}>`;
};

// The stash projection of a bare gate, or null — ONE predicate for both
// rendering roads (the class declare and the companion interface), so
// the two cannot drift. The annotation check here and the form-table
// `t === null` the interface road computes agree on every projectable
// gate: its initializer is a `this`-rooted chain, a form the table
// never types (entityPath excludes `this`).
export const stashProjection = (m, info) =>
  m.kind === 'gate' && m.annotation == null && info?.appStashSpec
    ? gateProjection(m, info.appStashSpec) : null;

// The failure ENVELOPE an error boundary receives — what `onError`'s
// unannotated parameter types as, in the face and the d.ts alike.
// `name`, `message`, and the raw thrown value are always present; the
// route fields ride only when the route layer filled them (the
// renderer's GateFailure is the richer instance and is assignable).
// Co-owned with `__componentFailure` in src/runtime/components.js —
// the wrapper delivers exactly this shape, and a field added on one
// side alone desyncs the type surface from the runtime.
export const COMPONENT_FAILURE_TYPE =
  '{ name: string; message: string; error: unknown; status?: number; path?: string; file?: string }';

export function instanceTypeLines(info, selfType, { road = 'dts' } = {}) {
  const lines = [];
  let hasChildren = false;
  const memberNames = new Set();
  for (const m of info.members) {
    memberNames.add(m.name);
    if (m.name === 'children') hasChildren = true;
    if (m.kind === 'method' || m.kind === 'hook') {
      const declared = info.roleText(m.func, 'returnType');
      // A generator takes neither the void spelling nor the async wrap
      // — the same rule the class declare emits under
      // (tsReturnAnnotation). This companion is what a CONSUMER reads,
      // so a wrong type here is not a diagnostic on the component at
      // all: it lands on every call site instead, where `void` has no
      // `.next` and the iterator the method really returns is
      // unreachable. `any` is what an unannotated member already
      // publishes; a generator joins them rather than claiming a
      // return it does not make.
      const isGen = yieldsIn(m.func[2]);
      const base = declared ?? (m.isVoid && !isGen ? 'void' : 'any');
      const ret = awaitsIn(m.func[2]) && !isGen && !/^Promise\s*</.test(base) ? `Promise<${base}>` : base;
      const firstType = m.name === 'onError' ? COMPONENT_FAILURE_TYPE : null;
      lines.push({ segs: [{ text: `${m.name}${renderParams(m.func[1], info.isOptionalParam, firstType)}: ${ret};` }] });
      continue;
    }
    // SEGMENTS, not one blob: the member's type is rendered here a second
    // time (the class declare is the first), so a fault in it publishes
    // twice, and the companion has no source line of its own to fall back
    // on — an unmapped byte lands on the component's `$self` cover and
    // paints every line of the component. The type segments already carry
    // their annotation spans; passing them through is what puts the second
    // publication on the member the author wrote.
    lines.push({
      // The line's own cover is the MEMBER, so any byte without a finer
      // span of its own — the container's `value`, which is where TS
      // reports a computed cycle — lands on the member the author wrote
      // instead of on the component. Segments carrying a span (the
      // annotation) nest inside and win where they apply.
      node: m.nameNode, role: m.nameRole,
      segs: [
        { text: m.kind === 'readonly' ? 'readonly ' : '' },
        { text: m.name },
        ...memberTypeSegments(m, ': ', info),
        { text: ';' },
      ],
    });
  }
  // Scaffolding the author never wrote: no source span exists for these, so
  // they carry no mark and stay under the component's cover.
  //
  // The runtime AMBIENCE rides the interface, not just the class: the
  // class road cannot vouch for it here — a computed's table function
  // takes `this` as THIS interface, so a member the interface omits turns
  // the member's own ReturnType<> projection into a cycle (TS7022 on the
  // component) instead of a plain unknown-name. Declared on EVERY
  // component (route-ness is not statically knowable) and OPTIONAL:
  // `?: any` reads as `any` at every use — the cycle stays broken — while
  // a hand-built value assigned to the interface owes none of them, and
  // the route-only members read as what they are, possibly absent. An
  // author member of the same name wins the line.
  for (const name of AMBIENT_FIELDS) {
    if (memberNames.has(name)) continue;
    // With a discovered stash, the ambience carries the runtime's real
    // types (still optional — a hand-built value owes none of them):
    // `app.data` is the app's own surface (AppData projects each entry to
    // what the runtime delivers, so an unannotated `cart ~= @app.data.cart`
    // infers), `router` is the Router the runtime injects, and
    // `params`/`query` are its live route-state views (getters onto
    // `router.params`/`router.query` — src/runtime/components.js). The
    // splices are type-only import()s: the face stays import-free, and the
    // discovery that found the stash is what guarantees `rip/app` rides
    // the closure.
    if (info.appStashSpec) {
      if (name === 'app') {
        lines.push({ segs: [{ text: `app?: ${appAmbienceType(info.appStashSpec)};` }] });
        continue;
      }
      if (name === 'router') {
        lines.push({ segs: [{ text: `router?: ${routerAmbienceType(info)};` }] });
        continue;
      }
      if (name === 'params') {
        lines.push({ segs: [{ text: `params?: ${info.routeParams ?? 'Record<string, string>'};` }] });
        continue;
      }
      if (name === 'query') {
        lines.push({ segs: [{ text: `query?: Record<string, string>;` }] });
        continue;
      }
    }
    lines.push({ segs: [{ text: `${name}?: any;` }] });
  }
  if (!hasChildren) lines.push({ segs: [{ text: `children?: ${childrenType(road)};` }] });
  // The rest view: the passthrough object, named on the face and inline
  // in the declarations (a .d.ts owes its reader a self-contained type).
  if (info.extendsTag !== null) lines.push({ segs: [{ text: `rest: ${containerType(road === 'face' ? restAliasName(info.extendsTag) : restPassthroughText(info.extendsTag), '', MINTED)};` }] });
  for (const text of runtimeApiMembers(selfType)) lines.push({ segs: [{ text }] });
  return lines;
}
