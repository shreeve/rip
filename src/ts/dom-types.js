// The intrinsic-element TYPE surfaces — the generated declarations that
// make the render lowering's OWN byte positions typed. The emitter
// casts each element receiver to `__RipEl_<tag>` (TS-only), so the
// existing `setAttribute`/`toggleAttribute`/`removeAttribute`/
// `addEventListener` calls and property assignments check, complete,
// and hover natively at the source-mapped bytes; nothing here changes
// a shipped byte (every region is tsOnly, held by the strip gate).
//
// The vocabulary is src/dom.js's spec-derived tables, read through
// `attributeNamesFor` — the SAME set `knownBareAttribute` accepts, so
// the typed surface and the bare-shorthand validator can never
// disagree (dom-types.test.js pins the lockstep).
//
// Value policy (docs/TYPES.md § Intrinsic element typing):
//   - attribute road (`setAttribute`): the DOM property's type WIDENED
//     by `| string` — attributes are string serializations, so
//     `width: '400'` passes while `alt: 42` still errors; names with
//     no matching property fall back to plain `string`.
//   - property road (`.value =`, `.checked =`, `.innerHTML =`,
//     `className`): the property's own type, strict — v3 parity.
//   - SVG attributes: uniform `string | number` (the DOM-side
//     properties are readonly `SVGAnimated*` objects — their types
//     describe the live object, never the serialization written).
//   - `class`/`className`: `__RipClassValue` — clsx vocabulary MINUS
//     `number` (the runtime's __clsx silently drops numbers, so a
//     number here is a real bug, not a serialization).
//   - `data-*`/`aria-*`: template keys, `string | number | boolean`
//     (serializable primitives; any suffix is legal by design, so a
//     misspelled `aria-labl` passes — same admission v3 made).
//
// Attribute names answer in BOTH spellings on HTML surfaces — the
// spec's lowercase form and the DOM property's camelCase where the two
// differ (the CAMEL table; HTML attribute names are case-insensitive,
// so `maxLength:` serializes identically to `maxlength:`). SVG names
// are case-SENSITIVE and match verbatim — no doubling.

import { attributeNamesFor, knownBareAttribute, GLOBAL_ATTRS, SVG_ATTRS, SVG_TAGS, HTML_TAGS } from '../dom.js';

// Attribute spellings whose DOM property is camelCased — the
// attribute→property bridge the guarded value lookup reads through,
// and the source of the doubled HTML key spellings. `for` maps to
// `htmlFor` (the one rename rather than a case fold).
export const CAMEL = {
  __proto__: null,
  maxlength: 'maxLength', minlength: 'minLength', readonly: 'readOnly',
  tabindex: 'tabIndex', colspan: 'colSpan', rowspan: 'rowSpan',
  contenteditable: 'contentEditable', formaction: 'formAction',
  formenctype: 'formEnctype', formmethod: 'formMethod',
  formnovalidate: 'formNoValidate', formtarget: 'formTarget',
  novalidate: 'noValidate', crossorigin: 'crossOrigin',
  usemap: 'useMap', srclang: 'srcLang',
  inputmode: 'inputMode', cellpadding: 'cellPadding',
  cellspacing: 'cellSpacing', bgcolor: 'bgColor', valign: 'vAlign',
  nowrap: 'noWrap', for: 'htmlFor', datetime: 'dateTime',
  ismap: 'isMap', nomodule: 'noModule', playsinline: 'playsInline',
  dirname: 'dirName', accesskey: 'accessKey',
  enterkeyhint: 'enterKeyHint', referrerpolicy: 'referrerPolicy',
  fetchpriority: 'fetchPriority', imagesrcset: 'imageSrcset',
  imagesizes: 'imageSizes', popovertargetaction: 'popoverTargetAction',
  allowfullscreen: 'allowFullscreen',
};

// The class-value vocabulary (v3's spelling, verbatim): everything the
// runtime's __clsx flattens — strings, nested arrays, truthiness-keyed
// objects — EXCEPT number, which __clsx drops silently.
export const CLASS_VALUE_DECL =
  'type __RipClassValue = string | boolean | null | undefined | Record<string, boolean | null | undefined> | __RipClassValue[];';

// What a component projects through `slot`: the DOM the parent built for
// it — an element, a fragment, a text node — or a value the runtime
// renders as text. The union is the runtime's own admission (renderSlot:
// a Node as-is, any other non-null value through String()); the name is
// what the editor shows, scrubbed to `Children`, and its doc rides the
// alias so a hover on the name explains it.
export const CHILDREN_DECL =
  '/** What a component projects through `slot`: the DOM its parent built for it — an element, a fragment, or a text node — or a value rendered as text. */\n' +
  'type __RipChildren = Node | string | number | boolean | null;';

// The `__clsx` signature for the runtime-destructure types assertion
// (RUNTIME_TABLE `types`) — the one entry that types every merged
// `class:` value in the face.
export const CLSX_TYPE = '(...args: (__RipClassValue | __RipClassValue[])[]) => string';

// The guarded lookups. __RipAV is the ATTRIBUTE road (widened
// `| string`); __RipProp is the PROPERTY road (strict, `any` where the
// tag has no such property — a claim-free fallback, never `never`).
const HELPER_DECLS =
  "type __RipAV<E, P extends PropertyKey, F = string> = E extends Record<P, infer V> ? V | string : F;\n" +
  'type __RipProp<E, P extends PropertyKey> = E extends Record<P, infer V> ? V : any;';

export const CLASS_TYPE = '__RipClassValue | __RipClassValue[]';
const TEMPLATE_ROWS =
  '  [k: `data-${string}`]: string | number | boolean;\n' +
  '  [k: `aria-${string}`]: string | number | boolean;';

const keyText = (name) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : `'${name}'`);

// The generated names, one scheme both halves use. Dual-namespace tags
// (a, script, style, title) carry distinct surfaces per namespace.
export const attrValsName = (tag, svg) => `__RipAttrVals_${svg ? 'svg_' : ''}${tag}`;
export const elSurfaceName = (tag, svg) => `__RipEl_${svg ? 'svg_' : ''}${tag}`;
export const hostText = (tag, svg) =>
  `${svg ? 'SVGElementTagNameMap' : 'HTMLElementTagNameMap'}['${tag}']`;

// A tag is emittable when the cast text would be legal TS and the tag
// map can answer for it — the tag-name shape the render walk records.
export const surfaceableTag = (tag, svg) =>
  typeof tag === 'string' && (svg ? SVG_TAGS.has(tag) : HTML_TAGS.has(tag));

// One HTML attribute member (+ its camelCase double where one exists):
// the attr spelling and the property spelling share one value type,
// looked up through the property name. The double rides only when the
// bare validator accepts it too (a dual-namespace tag's SVG-sourced
// names are verbatim — `crossorigin` on an HTML <a> arrives from the
// SVG table and takes no case fold), so the two vocabularies cannot
// drift — the lockstep test reads them back against each other.
function htmlMemberRows(tag, attr, host) {
  const prop = CAMEL[attr] ?? attr;
  const value = attr === 'class' ? CLASS_TYPE : `__RipAV<${host}, '${prop}'>`;
  const rows = [`  ${keyText(attr)}: ${value};`];
  if (prop !== attr && knownBareAttribute(tag, prop)) rows.push(`  ${keyText(prop)}: ${value};`);
  return rows;
}

// The HTML GLOBAL base — shared by every HTML surface; per-tag
// interfaces extend it with the tag's own content attributes. The
// value lookups guard against HTMLElement (what globals live on).
function globalAttrValsDecl() {
  const rows = [];
  for (const attr of GLOBAL_ATTRS) rows.push(...htmlMemberRows('div', attr, 'HTMLElement'));
  return `interface __RipGlobalAttrVals {\n${rows.join('\n')}\n${TEMPLATE_ROWS}\n}`;
}

// The SVG shared base — the global + SVG attribute set every SVG tag
// takes, uniformly `string | number` (class excepted).
function svgAttrValsDecl() {
  const rows = [];
  for (const attr of new Set([...GLOBAL_ATTRS, ...SVG_ATTRS])) {
    rows.push(`  ${keyText(attr)}: ${attr === 'class' ? CLASS_TYPE : 'string | number'};`);
  }
  return `interface __RipSvgAttrVals {\n${rows.join('\n')}\n${TEMPLATE_ROWS}\n}`;
}

// One tag's attribute-values interface: the members `attributeNamesFor`
// adds BEYOND the shared base (the per-tag content attributes; for a
// dual-namespace SVG tag, its HTML-side extras valued as SVG).
function attrValsDecl(tag, svg) {
  const base = svg ? '__RipSvgAttrVals' : '__RipGlobalAttrVals';
  const baseNames = svg ? new Set([...GLOBAL_ATTRS, ...SVG_ATTRS]) : GLOBAL_ATTRS;
  const rows = [];
  for (const attr of attributeNamesFor(tag)) {
    if (baseNames.has(attr)) continue;
    if (svg) rows.push(`  ${keyText(attr)}: ${attr === 'class' ? CLASS_TYPE : 'string | number'};`);
    else rows.push(...htmlMemberRows(tag, attr, hostText(tag, svg)));
  }
  const body = rows.length ? `\n${rows.join('\n')}\n` : '';
  return `interface ${attrValsName(tag, svg)} extends ${base} {${body}}`;
}

// One tag's receiver surface — the members the lowering actually
// touches through the cast, and nothing more (an emitter regression
// that reaches any other member draws TS2339 instead of passing
// silently through a broad interface):
//   - the attribute roads, name-constrained to the tag's vocabulary;
//   - addEventListener: the typed event-map overload (handler event
//     intersected with the HOST element as target/currentTarget) plus
//     the string overload that admits custom events (src/dom.js — an
//     explicit `@name:` binding is never gated on the vocabulary);
//   - the strict writable property surface (className on HTML — the
//     class-value contract; value/checked/innerHTML family guarded).
function elSurfaceDecl(tag, svg) {
  const vals = attrValsName(tag, svg);
  const host = hostText(tag, svg);
  const keys = `keyof ${vals} & string`;
  const rows = [
    `  setAttribute<A extends ${keys}>(name: A, value: ${vals}[A]): void;`,
    `  toggleAttribute(name: ${keys}, force?: boolean): boolean;`,
    `  removeAttribute(name: ${keys}): void;`,
    `  addEventListener<K extends keyof HTMLElementEventMap>(type: K, listener: (e: HTMLElementEventMap[K] & { target: ${host}; currentTarget: ${host} }) => unknown, options?: boolean | AddEventListenerOptions): void;`,
    '  addEventListener(type: string, listener: (e: any) => unknown, options?: boolean | AddEventListenerOptions): void;',
  ];
  if (!svg) rows.push(`  className: ${CLASS_TYPE};`);
  for (const prop of ['value', 'checked', 'innerHTML', 'textContent', 'innerText']) {
    rows.push(`  ${prop}: __RipProp<${host}, '${prop}'>;`);
  }
  return `interface ${elSurfaceName(tag, svg)} {\n${rows.join('\n')}\n}`;
}

// The whole generated block for one module's used surfaces.
// `used` is an iterable of `{ tag, svg }`, deduplicated here; helpers
// and shared bases emit once, only when something needs them.
// `needsClassValue` forces the __RipClassValue alias even with no
// surfaces (the __clsx types assertion references it wherever the
// components runtime delivers inline).
export function domSurfaceDecls(used, { needsClassValue = false, needsRefCell = false, needsChildren = false, extra = [] } = {}) {
  const surfaces = new Map();
  for (const { tag, svg } of used) {
    if (surfaceableTag(tag, svg)) surfaces.set(`${svg ? 'svg:' : ''}${tag}`, { tag, svg: Boolean(svg) });
  }
  const parts = [];
  if (surfaces.size > 0 || needsClassValue) parts.push(CLASS_VALUE_DECL);
  if (needsChildren) parts.push(CHILDREN_DECL);
  for (const line of extra) parts.push(line);
  if (surfaces.size > 0) {
    parts.push(HELPER_DECLS);
    const anyHtml = [...surfaces.values()].some((s) => !s.svg);
    const anySvg = [...surfaces.values()].some((s) => s.svg);
    if (anyHtml) parts.push(globalAttrValsDecl());
    if (anySvg) parts.push(svgAttrValsDecl());
    for (const { tag, svg } of surfaces.values()) {
      parts.push(attrValsDecl(tag, svg), elSurfaceDecl(tag, svg));
    }
  }
  if (needsRefCell) parts.push(REF_CELL_DECLS);
  return parts.length ? `\n${parts.join('\n')}\n` : '';
}

// The ref-cell admission — v3's nominal trick carried whole, plus the
// two arms v4 blesses by ruling: `V = any` (an unannotated cell) and
// `V = null` (the documented `el := null` idiom). A cell passes when:
//   1. it is `any` or exactly `null`-typed (the blessed arms);
//   2. the tag's EXACT element type is one of V's constituents — a
//      union containing it admits, a rich sibling extracts to never;
//   3. NonNullable<V> IS a recognized base element type (the exact
//      `__RipEqEl` test — a plain extends would readmit every sibling)
//      AND the tag's element really derives from it. Featureless
//      interfaces the lib leaves member-less (HTMLSpanElement) are
//      type-identical to their base and admit AS the base — the same
//      admission v3's checker makes (dom-typing-pins.test.js pins the
//      boundary).
// A rejected cell draws TS2345 anchored on the cell argument — the
// user's own binding name. The return type is what the lowering's real
// write checks against; teardown writes null, so a NON-nullable cell
// is rejected by arm 2/3 (never admitted, `null extends V` gates).
const REF_CELL_DECLS = [
  'type __RipEqEl<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;',
  'type __RipBaseEl<T> = __RipEqEl<T, EventTarget> extends true ? true : __RipEqEl<T, Node> extends true ? true : __RipEqEl<T, Element> extends true ? true : __RipEqEl<T, HTMLElement> extends true ? true : __RipEqEl<T, SVGElement> extends true ? true : __RipEqEl<T, HTMLMediaElement> extends true ? true : __RipEqEl<T, SVGGraphicsElement> extends true ? true : false;',
  'type __RipRefOk<V, E> = 0 extends (1 & V) ? unknown : [V] extends [null] ? unknown : null extends V ? ([E] extends [Extract<NonNullable<V>, E>] ? unknown : __RipBaseEl<NonNullable<V>> extends true ? ([E] extends [NonNullable<V>] ? unknown : never) : never) : never;',
  "declare function __ripRefCell<K extends keyof HTMLElementTagNameMap, V>(tag: K, cell: { value: V } & __RipRefOk<V, HTMLElementTagNameMap[K]>): { value: HTMLElementTagNameMap[K] | null };",
  "declare function __ripRefCellSvg<K extends keyof SVGElementTagNameMap, V>(tag: K, cell: { value: V } & __RipRefOk<V, SVGElementTagNameMap[K]>): { value: SVGElementTagNameMap[K] | null };",
].join('\n');
