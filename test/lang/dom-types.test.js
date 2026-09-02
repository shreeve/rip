// The generated intrinsic surfaces ↔ src/dom.js lockstep. The typed
// vocabulary (src/ts/dom-types.js) and the bare-shorthand validator
// (knownBareAttribute) must accept the SAME names — a key the checker
// offers that the validator rejects, or the reverse, is two vocabularies
// drifting. These tests read the generated declaration TEXT back as
// member lists and compare against the tables; the tsc-side proof that
// the text is legal TS lives in test/spawn/tsc (the extended tier).

import { describe, test, expect } from 'bun:test';
import {
  CAMEL, domSurfaceDecls, attrValsName, elSurfaceName, hostText, surfaceableTag,
  CLASS_VALUE_DECL, CLSX_TYPE,
} from '../../src/ts/dom-types.js';
import { attributeNamesFor, knownBareAttribute, HTML_TAGS, SVG_TAGS, SVG_ONLY_TAGS } from '../../src/dom.js';

// Member keys of one `interface <name> ... { ... }` block in the
// generated text (quoted or bare, methods excluded by the `(` check;
// template index rows excluded by the backtick).
function membersOf(text, name) {
  if (new RegExp(`interface ${name}[^{]*\\{\\}`).test(text)) return [];
  const m = text.match(new RegExp(`interface ${name}[^{]*\\{([^]*?)\\n\\}`));
  expect(m, `interface ${name} missing from the generated block`).toBeTruthy();
  const keys = [];
  for (const line of m[1].split('\n')) {
    const row = line.trim();
    if (!row || row.startsWith('[')) continue;
    const key = row.match(/^'([^']+)'|^([A-Za-z_$][\w$]*)/);
    if (key && !row.slice((key[1] ?? key[2]).length + (key[1] ? 2 : 0)).trimStart().startsWith('(')) {
      keys.push(key[1] ?? key[2]);
    }
  }
  return keys;
}

// The full key set one HTML tag's surface must answer: the tables'
// names plus each CAMEL double the bare validator also accepts (a
// dual-namespace tag's SVG-sourced names take no case fold).
function expectedHtmlKeys(tag) {
  const keys = new Set(attributeNamesFor(tag));
  for (const attr of [...keys]) {
    const prop = CAMEL[attr];
    if (prop && prop !== attr && knownBareAttribute(tag, prop)) keys.add(prop);
  }
  return keys;
}

describe('dom-types ↔ dom.js lockstep', () => {
  test('every HTML tag surface carries exactly the tables\' names plus the CAMEL doubles', () => {
    for (const tag of HTML_TAGS) {
      const text = domSurfaceDecls([{ tag, svg: false }]);
      const own = new Set([
        ...membersOf(text, '__RipGlobalAttrVals'),
        ...membersOf(text, attrValsName(tag, false)),
      ]);
      expect([...own].sort(), `<${tag}>`).toEqual([...expectedHtmlKeys(tag)].sort());
    }
  });

  test('every SVG tag surface carries exactly attributeNamesFor(tag)', () => {
    for (const tag of SVG_TAGS) {
      const text = domSurfaceDecls([{ tag, svg: true }]);
      const own = new Set([
        ...membersOf(text, '__RipSvgAttrVals'),
        ...membersOf(text, attrValsName(tag, true)),
      ]);
      expect([...own].sort(), `<${tag}> (svg)`).toEqual([...new Set(attributeNamesFor(tag))].sort());
    }
  });

  test('every surface key the checker offers, the bare validator accepts (HTML: case-insensitively)', () => {
    for (const tag of HTML_TAGS) {
      for (const key of expectedHtmlKeys(tag)) {
        expect(knownBareAttribute(tag, key), `<${tag}> ${key}`).toBe(true);
      }
    }
    for (const tag of SVG_ONLY_TAGS) {
      for (const key of attributeNamesFor(tag)) {
        expect(knownBareAttribute(tag, key), `<${tag}> ${key}`).toBe(true);
      }
    }
  });

  test('surface arming: known tags in their own namespace, nothing else', () => {
    expect(surfaceableTag('div', false)).toBe(true);
    expect(surfaceableTag('circle', true)).toBe(true);
    expect(surfaceableTag('circle', false)).toBe(false);
    expect(surfaceableTag('widgetron', false)).toBe(false);
    expect(surfaceableTag('a', true)).toBe(true);
    expect(surfaceableTag('a', false)).toBe(true);
  });

  test('dual-namespace tags get distinct surfaces per namespace', () => {
    const text = domSurfaceDecls([{ tag: 'a', svg: false }, { tag: 'a', svg: true }]);
    expect(text).toContain(`interface ${attrValsName('a', false)} extends __RipGlobalAttrVals`);
    expect(text).toContain(`interface ${attrValsName('a', true)} extends __RipSvgAttrVals`);
    expect(text).toContain(`interface ${elSurfaceName('a', false)}`);
    expect(text).toContain(`interface ${elSurfaceName('a', true)}`);
  });

  test('the value policy rows: widened attribute road, strict property road, class contract, templates', () => {
    const text = domSurfaceDecls([{ tag: 'input', svg: false }, { tag: 'label', svg: false }]);
    // maxlength and maxLength share the property's type, widened.
    expect(text).toContain(`maxlength: __RipAV<HTMLElementTagNameMap['input'], 'maxLength'>`);
    expect(text).toContain(`maxLength: __RipAV<HTMLElementTagNameMap['input'], 'maxLength'>`);
    // `for:` types through the htmlFor property — but htmlFor is NOT an
    // attr-road key (setAttribute case-folds it to the unrelated
    // `htmlfor` attribute; only case folds that land on the real
    // attribute earn a doubled spelling).
    expect(text).toContain(`for: __RipAV<HTMLElementTagNameMap['label'], 'htmlFor'>`);
    expect(text).not.toContain(`htmlFor: __RipAV`);
    // class rides the clsx contract, never a string lookup.
    expect(text).toContain('class: __RipClassValue | __RipClassValue[]');
    // property road strict (no | string): the receiver surface's value/checked.
    expect(text).toContain(`value: __RipProp<HTMLElementTagNameMap['input'], 'value'>`);
    // templates admit data-/aria- on every surface.
    expect(text).toContain('[k: `data-${string}`]: string | number | boolean;');
  });

  test('the class-value vocabulary excludes number, and __clsx types against it', () => {
    expect(CLASS_VALUE_DECL).not.toContain('number');
    expect(CLSX_TYPE).toContain('__RipClassValue');
    const text = domSurfaceDecls([], { needsClassValue: true });
    expect(text).toContain(CLASS_VALUE_DECL);
    expect(text).not.toContain('interface');
  });

  test('hostText is the one spelling of an element type — the surfaces and the emitter share it', () => {
    // The receiver cast, the handler-param host claim, and the ref-cell
    // cast all spell the element's lib.dom type through this function, so
    // the generated block and the face never drift on it.
    expect(hostText('input', false)).toBe("HTMLElementTagNameMap['input']");
    expect(hostText('a', true)).toBe("SVGElementTagNameMap['a']");
    const text = domSurfaceDecls([{ tag: 'input', svg: false }, { tag: 'a', svg: true }]);
    expect(text).toContain(`value: __RipProp<${hostText('input', false)}, 'value'>`);
    expect(text).toContain(hostText('a', true));
  });

  test('the ref-cell declares ride only when asked, and carry both namespace roads', () => {
    const off = domSurfaceDecls([{ tag: 'div', svg: false }]);
    expect(off).not.toContain('__ripRefCell');
    const on = domSurfaceDecls([], { needsRefCell: true });
    expect(on).toContain('declare function __ripRefCell<K extends keyof HTMLElementTagNameMap');
    expect(on).toContain('declare function __ripRefCellSvg<K extends keyof SVGElementTagNameMap');
    expect(on).toContain('0 extends (1 & V) ? unknown');
    expect(on).toContain('[V] extends [null] ? unknown');
  });
});
