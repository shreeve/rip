// Identifier READs must carry their own exact mapping rows. Without one,
// byte-arithmetic remap collapses to the enclosing cover's start — wrong
// hover, null definition, fat diagnostics, dropped tokens. The three
// loss categories (call-arg list elements, annotation names, type-decl
// internals) share one fix: emit-time `read` markSpan rows from an
// anchored bare-word scan (the shorthandProp precedent).
import { describe, test, expect } from 'bun:test';
import { compile } from '../../src/compile.js';
import { stripFace } from '../../src/emitter.js';

const ts = (src) => compile(src, { runtimeDelivery: 'none', face: 'ts' });
const js = (src) => compile(src, { runtimeDelivery: 'none' });

const exactNameAt = (src, rows, at, name) =>
  rows.filter((m) =>
    m.mappingKind === 'exact'
    && m.sourceStart <= at && at + name.length <= m.sourceEnd
    && src.slice(m.sourceStart, m.sourceEnd) === name);

describe('call-argument identifier reads (trigger table)', () => {
  // Each trigger alone was sufficient to lose the read. All six must
  // land an exact row on the argument `total`.
  const cases = [
    ['parens + no literal', 'total = 1\nconsole.log(total)\n'],
    ['parens + double-quoted', 'total = 1\nconsole.log("total:", total)\n'],
    ['parens + single-quoted', "total = 1\nconsole.log('total:', total)\n"],
    ['paren-less + no literal', 'total = 1\nconsole.log total\n'],
    ['paren-less + double-quoted', 'total = 1\nconsole.log "total:", total\n'],
    ['paren-less + single-quoted', "total = 1\nconsole.log 'total:', total\n"],
  ];

  for (const [label, src] of cases) {
    test(label, () => {
      const r = ts(src);
      expect(stripFace(r.code, r.tsRegions)).toBe(js(src).code);
      const assignEnd = src.indexOf('\n') + 1;
      let at = -1;
      for (let from = assignEnd; ;) {
        const i = src.indexOf('total', from);
        if (i < 0) break;
        at = i;
        from = i + 1;
      }
      expect(at).toBeGreaterThan(0);
      expect(exactNameAt(src, r.mappings.rows, at, 'total').length).toBeGreaterThan(0);
      // Face-only — JS-mode corpus maps stay untouched.
      expect(js(src).mappings.rows.filter((m) => m.role === 'read')).toEqual([]);
    });
  }
});

describe('annotation and type-decl identifier reads', () => {
  test('annotation type name gets an exact read row', () => {
    const src = 'x: number = 5\n';
    const r = ts(src);
    const at = src.indexOf('number');
    const rows = exactNameAt(src, r.mappings.rows, at, 'number');
    expect(rows.some((m) => m.role === 'read')).toBe(true);
    expect(stripFace(r.code, r.tsRegions)).toBe(js(src).code);
  });

  test('type-decl internals (alias + object members) get exact read rows', () => {
    const src = "type Circle = { kind: 'circle', radius: number }\n";
    const r = ts(src);
    for (const name of ['Circle', 'kind', 'radius', 'number']) {
      const at = src.indexOf(name);
      expect(exactNameAt(src, r.mappings.rows, at, name).length).toBeGreaterThan(0);
    }
    expect(js(src).mappings.rows.filter((m) => m.role === 'read')).toEqual([]);
    expect(stripFace(r.code, r.tsRegions)).toBe(js(src).code);
  });

  test('import specifiers get exact read rows across quote-normalized from', () => {
    const src = 'import { add, greet } from "./m"\nconsole.log add\n';
    const r = ts(src);
    for (const name of ['add', 'greet']) {
      const at = src.indexOf(name);
      expect(exactNameAt(src, r.mappings.rows, at, name).length).toBeGreaterThan(0);
    }
    expect(stripFace(r.code, r.tsRegions)).toBe(js(src).code);
  });
});
