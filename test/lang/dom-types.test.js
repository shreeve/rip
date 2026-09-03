// The generated intrinsic surfaces ↔ src/dom.js lockstep. The typed
// vocabulary (src/ts/dom-types.js) and the bare-shorthand validator
// (knownBareAttribute) must accept the SAME names — a key the checker
// offers that the validator rejects, or the reverse, is two vocabularies
// drifting. These tests read the generated declaration TEXT back as
// member lists and compare against the tables; the tsc-side proof that
// the text is legal TS lives in test/spawn/tsc (the extended tier).

import { describe, test, expect } from 'bun:test';
import {
  domSurfaceDecls, attrValsName, elSurfaceName, hostText, surfaceableTag,
  CLASS_VALUE_DECL, CLSX_TYPE,
} from '../../src/ts/dom-types.js';
import { attributeNamesFor, knownBareAttribute, suggestAttribute, HTML_TAGS, SVG_TAGS, SVG_ONLY_TAGS } from '../../src/dom.js';

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
// names, and ONLY those — a DOM property's camelCase name is not an
// attribute name and is never a key.
function expectedHtmlKeys(tag) {
  return new Set(attributeNamesFor(tag));
}

describe('dom-types ↔ dom.js lockstep', () => {
  test('every HTML tag surface carries exactly the tables\' names', () => {
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
    // The attribute answers to its OWN spelling, typed through the DOM
    // property it reflects: the property name is a lookup, never a key.
    expect(text).toContain(`maxlength: __RipAV<HTMLElementTagNameMap['input'], 'maxLength'>`);
    expect(text).not.toContain('maxLength:');
    expect(text).toContain(`readonly: __RipAV<HTMLElementTagNameMap['input'], 'readOnly'>`);
    expect(text).not.toContain('readOnly:');
    expect(text).toContain(`for: __RipAV<HTMLElementTagNameMap['label'], 'htmlFor'>`);
    expect(text).not.toContain('htmlFor:');
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

describe('suggestAttribute: what a rejected name is offered instead', () => {
  // A case FOLD is the certain answer — the DOM property spelling of a
  // real attribute, which is what an author arriving from JSX writes.
  test('a DOM property spelling folds to its attribute', () => {
    expect(suggestAttribute('input', 'readOnly')).toBe('readonly');
    expect(suggestAttribute('form', 'noValidate')).toBe('novalidate');
    expect(suggestAttribute('td', 'colSpan')).toBe('colspan');
    expect(suggestAttribute('label', 'htmlFor')).toBe(null);   // a RENAME, not a fold
  });

  // SVG names are verbatim, so the fold runs the other way there.
  test('an SVG name folds to its own case', () => {
    expect(suggestAttribute('svg', 'viewbox')).toBe('viewBox');
    expect(suggestAttribute('svg', 'VIEWBOX')).toBe('viewBox');
  });

  // A near miss earns one name, within two edits.
  test('a typo within two edits earns the closest name', () => {
    expect(suggestAttribute('div', 'claas')).toBe('class');
    expect(suggestAttribute('a', 'hrf')).toBe('href');
    expect(suggestAttribute('img', 'srcc')).toBe('src');
    expect(suggestAttribute('input', 'tpe')).toBe('type');
  });

  // Nothing near, a tie, or too short to judge: DECLINE. A wrong
  // suggestion sends the author to the wrong fix, which costs more
  // than saying nothing.
  test('a distant name, a tie, or a very short one declines', () => {
    expect(suggestAttribute('span', 'countt')).toBe(null);
    expect(suggestAttribute('input', 'zzzzzz')).toBe(null);
    expect(suggestAttribute('div', 'xy')).toBe(null);
    // Already legal names are never "suggested" onto themselves.
    expect(suggestAttribute('input', 'readonly')).toBe(null);
    expect(suggestAttribute('div', 'class')).toBe(null);
  });
});
