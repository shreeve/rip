// The component TYPE story — one walker and one set of
// renderers shared by the two typed artifacts: the TS-face emission
// (src/emitter.js — TS-only member declares, the constructor's props
// surface, the companion interface) and declaration emission
// (src/dts.js — the component's .d.ts shape). Both render from the
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
//     names (src/dom-vocab.js — spec-derived data, the #125 table)
//     and a string index signature (undeclared props are REST props
//     by the runtime-root design; excess-property checking stays ON
//     for non-extends components — the #131 fix's editor twin).
//
// Renderers produce SEGMENT lists ({ text } | { text, node, role })
// so the face can mark each named piece under its recorded store row
// (the CodeBuilder mark protocol decides exact vs cover) while dts
// joins the same segments as plain text — one assembly, two
// consumers, no drift.

import { tidyType, normalizeTypeText, renderParam, renderParams, optionalReader } from './typetext.js';
import { attributeNamesFor } from './dom-vocab.js';

const isNode = (x) => Array.isArray(x);
const isFunc = (x) => isNode(x) && (x[0] === '->' || x[0] === '=>') && x.length === 3;
const isBlock = (x) => isNode(x) && x[0] === 'block';

// The exact-five lifecycle hooks — the single source (the emitter's
// categorization consumes this set too).
export const COMPONENT_HOOKS = new Set(['beforeMount', 'mounted', 'beforeUnmount', 'unmounted', 'onError']);
export const COMPONENT_RUNTIME_FIELDS = new Set([
  '_state', '_frame', '_parent', '_children', '_root', '_nodes', '_target',
  '_context', '_rest', '_restWriters', '_restHandlers', '_inheritedEl',
  '_refCleanups', '_initFailed',
]);

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
  if (h === 'await' || h === 'dammit!') return true;
  if (h === 'for-as' && x[3] === true) return true;
  if (h === '->' || h === '=>' || h === 'def' || h === 'void-def' || h === 'class') return false;
  return x.some(awaitsIn);
};

// ── the walker ───────────────────────────────────────────────────────
// Reads a VALID component node (JS emission has already accepted it —
// every rejection class fires before any type story renders) into the
// member list the renderers consume. Statements that carry no type
// story (render, effects) skip; anything unrecognized skips rather
// than guessing (the JS emission is the rejection authority).
// Pre-scan a component render for `@event: @method` / bare method-name
// bindings so companion + .d.ts method params share the same
// HTMLElementEventMap annotation the class method face injects (#25).
export function scanEventMethodTypes(renderNode, methodNames) {
  const map = new Map();
  if (renderNode == null || !(methodNames instanceof Set) || methodNames.size === 0) {
    return map;
  }
  const visit = (node) => {
    if (!isNode(node)) return;
    if ((node[0] === ':' || node[0] === 'void-pair') && node.length === 3) {
      const [, key, value] = node;
      if (isNode(key) && key[0] === '.' && key[1] === 'this' && typeof key[2] === 'string') {
        const eventName = key[2];
        let methodName = null;
        if (isNode(value) && value[0] === '.' && value[1] === 'this' && typeof value[2] === 'string') {
          methodName = value[2];
        } else if (typeof value === 'string' && methodNames.has(value)) {
          methodName = value;
        }
        if (methodName && !map.has(methodName)) map.set(methodName, eventName);
      }
    }
    for (let i = 1; i < node.length; i++) visit(node[i]);
  };
  visit(renderNode);
  return map;
}

export function componentTypeInfo(stores, source, node) {
  const [, parent, body] = node;
  const extendsTag = typeof parent === 'string' ? parent : null;
  const stmts = isBlock(body) ? body.slice(1) : [];
  const members = [];
  let renderNode = null;

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
    if (kind === 'render') {
      if (renderNode === null) renderNode = stmt;
      return;
    }
    if (kind === 'effect') return;
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
  for (const m of members) m.siblings = siblings;
  const methodNames = new Set(
    members.filter((m) => m.kind === 'method').map((m) => m.name),
  );
  return {
    extendsTag,
    members,
    roleText,
    eventMethodTypes: scanEventMethodTypes(renderNode, methodNames),
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
// container ({ value: T; read(): T }).
const containerish = (m) => m.kind === 'state' || m.kind === 'prop';

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
export const containerType = (t, ro = '') => `{ ${ro}value: ${t}; read(): ${t} }`;

// The member's INSTANCE type as segments (`declare name: …` bodies,
// interface member lines). The annotated piece marks as `: T` — the
// recorded span's own shape (a TYPE run spans colon→end), so the
// builder's verbatim comparison can classify it EXACT. Optional
// annotated props read `T | undefined` — the container exists on
// every instance; only the value may be absent.
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

const memberTypeSegments = (m, lead) => {
  // The typeof spelling resolves at MODULE scope (the declare row sits
  // on the class) — an initializer rooted at a SIBLING member
  // (`bad1 ~= store.itms`) must not spell it (this.store is not in
  // scope there); those members keep any and their checking happens on
  // the _init assignment line instead (the generic runtime types it).
  const rootOf = (v) => (typeof v === 'string' ? v
    : Array.isArray(v) && v[0] === '.' && v.length === 3 ? rootOf(v[1]) : null);
  const siblingRooted = m.siblings !== undefined &&
    Array.isArray(m.node) && m.node.length === 3 && m.siblings.has(rootOf(m.node[2]));
  const t = m.annotation ??
    (m.hasDefault && !siblingRooted && Array.isArray(m.node) && m.node.length === 3
      ? (syntacticLiteralType(m.node[2]) ?? typeofSpelling(m.node[2]))
      : null);
  const typed = t !== null
    ? [{ text: `: ${t}`, node: m.node, role: 'annotation' }]
    : [{ text: ': any' }];
  const vt = t ?? 'any';
  if (m.kind === 'accept') return [{ text: `${lead}any` }];
  if (containerish(m)) {
    const und = t !== null && m.optional && m.kind === 'prop' ? ' | undefined' : '';
    return [
      { text: `${lead}{ value` }, ...typed,
      { text: `${und}; read(): ${vt}${und} }` },
    ];
  }
  if (m.kind === 'computed' || m.kind === 'gate') {
    return [{ text: `${lead}{ readonly value` }, ...typed, { text: `; read(): ${vt} }` }];
  }
  if (t === null) return [{ text: `${lead}any` }];
  return typed; // readonly / plain: the annotation IS `: T`
};

// One face `declare` line for a non-callable member (methods and
// hooks are REAL class methods — their annotations ride the shared
// param/return machinery).
export const memberDeclareSegments = (m) => [
  // A `=!` member is a CONST value: readonly on the declare, so
  // instance writes draw TS2540.
  { text: m.kind === 'readonly' ? 'declare readonly ' : 'declare ' },
  { text: m.name, node: m.nameNode, role: m.nameRole },
  ...memberTypeSegments(m, ': '),
  { text: ';' },
];

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
export function propsTypeSegments(info) {
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
    if (t === null) segs.push({ text: ': any' });
    else if (containerish(m)) segs.push({ text: `: ${t}`, node: m.node, role: 'annotation' }, { text: ` | ${containerType(t)}` });
    else segs.push({ text: `: ${t}`, node: m.node, role: 'annotation' });
    if (containerish(m)) {
      segs.push({ text: `; __bind_${m.name}__?: ${containerType(t ?? 'any')}` });
    }
  }
  // The projection channel — UNLESS the component declares a member
  // named `children` of its own (legal: `children` is ONE prop, the
  // extends record; a declared prop's entry above already carries the
  // name, and a duplicate key is TS2300 on every artifact (the
  // same member-wide suppression instanceTypeLines carries).
  if (!info.members.some((m) => m.name === 'children')) {
    sep();
    segs.push({ text: 'children?: any' });
  }
  used.add('children');
  if (info.extendsTag !== null) {
    // Intrinsic attr typing: passthrough attributes
    // type through the tag's DOM interface — `disabled?:` on a button
    // is boolean, not any — via an extends-Record guard so attributes
    // with no matching property fall back to any instead of erroring.
    // Attributes whose DOM property is camelCased get BOTH spellings
    // (authors write maxLength; the spec list says maxlength).
    const CAMEL = {
      maxlength: 'maxLength', minlength: 'minLength', readonly: 'readOnly',
      tabindex: 'tabIndex', colspan: 'colSpan', rowspan: 'rowSpan',
      contenteditable: 'contentEditable', formaction: 'formAction',
      formenctype: 'formEnctype', formmethod: 'formMethod',
      formnovalidate: 'formNoValidate', formtarget: 'formTarget',
      novalidate: 'noValidate', crossorigin: 'crossOrigin',
      usemap: 'useMap', srclang: 'srcLang', autocomplete: 'autocomplete',
    };
    const tagMap = `HTMLElementTagNameMap[${JSON.stringify(info.extendsTag)}]`;
    const guarded = (prop) => `${tagMap} extends Record<'${prop}', infer T> ? T : any`;
    const isHtmlTag = attributeNamesFor(info.extendsTag).length > 0 && !/^(svg|path|circle|rect|line|g|text|defs|use)$/.test(info.extendsTag);
    for (const attr of attributeNamesFor(info.extendsTag)) {
      if (used.has(attr)) continue;
      const prop = CAMEL[attr] ?? attr;
      const t = isHtmlTag ? guarded(prop) : 'any';
      segs.push({ text: `; ${keyText(attr)}?: ${t}` });
      if (prop !== attr && !used.has(prop)) segs.push({ text: `; ${prop}?: ${t}` });
    }
    segs.push({ text: '; [key: string]: any' });
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

export const propsTypeText = (info) => segmentsText(propsTypeSegments(info));

// ── the instance surface ─────────────────────────────────────────────
// The lines shared by the face's companion interface and the .d.ts
// declaration: every member (typed or explicit-any — a declared
// component carries its WHOLE public surface, so a consumer's legal
// call never draws TS2339), then the __Component API the runtime
// provides (mount returns the instance; static mount mirrors it on
// the constructor type).
// Companion / .d.ts method params: the first bare (untyped) parameter of a
// method bound to `@event: @method` in render types as HTMLElementEventMap
// — same datum the class method face injects. Author
// typed-var params keep renderParam's spelling.
const renderParamsWithEvent = (params, isOptional, eventName) => {
  if (!eventName || !Array.isArray(params) || params.length === 0) {
    return renderParams(params, isOptional);
  }
  const first = params[0];
  if (typeof first !== 'string') return renderParams(params, isOptional);
  const rest = params.slice(1).map((p) => renderParam(p, isOptional));
  return `(${first}: HTMLElementEventMap['${eventName}']${rest.length ? `, ${rest.join(', ')}` : ''})`;
};

export function instanceTypeLines(info, selfType) {
  const lines = [];
  let hasChildren = false;
  const eventTypes = info.eventMethodTypes;
  for (const m of info.members) {
    if (m.name === 'children') hasChildren = true;
    if (m.kind === 'method' || m.kind === 'hook') {
      const declared = info.roleText(m.func, 'returnType');
      const base = declared ?? (m.isVoid ? 'void' : 'any');
      const ret = awaitsIn(m.func[2]) && !/^Promise\s*</.test(base) ? `Promise<${base}>` : base;
      const event = eventTypes instanceof Map ? eventTypes.get(m.name) : undefined;
      lines.push(`${m.name}${renderParamsWithEvent(m.func[1], info.isOptionalParam, event)}: ${ret};`);
      continue;
    }
    lines.push(`${m.kind === 'readonly' ? 'readonly ' : ''}${m.name}${segmentsText(memberTypeSegments(m, ': '))};`);
  }
  if (!hasChildren) lines.push('children?: any;');
  if (info.extendsTag !== null) lines.push(`rest: ${containerType('Record<string, any>')};`);
  lines.push(`mount(target?: any): ${selfType};`);
  lines.push('unmount(options?: { removeDOM?: boolean }): void;');
  lines.push('emit(name: string, detail?: any): void;');
  return lines;
}
