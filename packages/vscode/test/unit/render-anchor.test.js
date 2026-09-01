// Where a render pair's complaint lands (RULINGS.md): a complaint that
// exists only because of the pair — the value against the key's admitted
// type — lands on the KEY; one the value would draw in any position
// keeps its bytes. The distinction is structural: the emitter records
// each road's RELATION SITE in generated coordinates, and the mapper
// re-anchors exactly a diagnostic standing on a site. Driven through the
// one honest mapping road (mapTsDiagnostic) over real compile() output,
// with the diagnostics synthesized at the spans the pinned tsgo uses
// (test/spawn/cli/check.test.js drives the same rows through tsgo).
import { test, expect } from 'bun:test';
import { compile } from '../../../../src/compile.js';
import { mapTsDiagnostic } from '../../src/diagnostics.js';
import { lineStartsOf, offsetToPosition } from '../../src/translate.js';

const source = [
  'Btn = component',
  '  @label: string',
  '  render',
  "    button 'b'",
  '',
  'P = component',
  '  n := 0',
  '  cell: HTMLInputElement | null := null',
  '  handle: (e: KeyboardEvent) -> null',
  '  render',
  '    div',
  '      input value: nope',       // scratch-const road
  '      img alt: 42',             // direct road
  '      img alt: n',              // scratch-const road, the effect arm
  '      input value: n',          // property road
  '      div textContent: nope',   // property road, static
  '      button disabled: n',      // boolean road
  '      p class: nope',           // className write
  '      p class: n',              // __clsx argument
  '      div.card class: nope',    // __clsx merge argument
  '      button @click: handle',   // handler cast
  '      div ref: cell',           // ref cell argument
  '      input value <=> n',       // bind write-back
  '      Btn label <=> n',         // props-object bind key
  '      Btn anything: 2',         // props-object key
  '',
].join('\n');
const result = compile(source, { path: 'p.rip', runtimeDelivery: 'none', face: 'ts' });
const good = {
  source,
  code: result.code,
  mappings: result.mappings,
  srcLineStarts: lineStartsOf(source),
  genLineStarts: lineStartsOf(result.code),
  strict: true,
  routeWraps: result.routeWraps,
  renderPairs: result.renderPairs,
};
const pairKeyed = (bytes) => result.renderPairs.filter((p) => source.slice(p.key[0], p.key[1]) === bytes);
const siteBytes = (p) => p.sites.map(([a, b]) => result.code.slice(a, b));
const diagnosticAt = (code, span) => ({
  code, message: 'x', severity: 1,
  range: {
    start: offsetToPosition(good.genLineStarts, span[0]),
    end: offsetToPosition(good.genLineStarts, span[1]),
  },
});
const sourceTextOf = (m) => {
  const off = (p) => good.srcLineStarts[p.line] + p.character;
  return source.slice(off(m.range.start), off(m.range.end));
};
const genSpanOf = (text, nth = 0) => {
  let at = -1;
  for (let i = 0; i <= nth; i++) { at = result.code.indexOf(text, at + 1); expect(at).toBeGreaterThan(-1); }
  return [at, at + text.length];
};

test('every road records its relation site in generated coordinates', () => {
  const [valueAttr, valueProp, valueBind] = pairKeyed('value');
  expect(siteBytes(valueAttr)).toEqual(['__v']);
  expect(siteBytes(valueProp)).toEqual(['(this._el4 as __RipEl_input).value']);
  expect(siteBytes(valueBind)).toEqual(['this.n.value']);
  const [altDirect, altEffect] = pairKeyed('alt');
  expect(siteBytes(altDirect)).toEqual(['42']);
  expect(siteBytes(altEffect)).toEqual(['__v']);
  expect(siteBytes(pairKeyed('textContent')[0])).toEqual(['(this._el5 as __RipEl_div).textContent']);
  expect(siteBytes(pairKeyed('disabled')[0])).toEqual(['satisfies']);
  const [classWrite, classClsx, classMerge] = pairKeyed('class');
  expect(siteBytes(classWrite)).toEqual(['(this._el7 as __RipEl_p).className']);
  expect(siteBytes(classClsx)).toEqual(['this.n.value']);
  expect(siteBytes(classMerge)).toEqual(['nope']);
  expect(siteBytes(pairKeyed('@click')[0])).toEqual([
    "this.handle as (e: HTMLElementEventMap['click'] & { target: HTMLElementTagNameMap['button']; currentTarget: HTMLElementTagNameMap['button'] }) => unknown",
  ]);
  expect(siteBytes(pairKeyed('ref')[0])).toEqual(['this.cell']);
  expect(siteBytes(pairKeyed('label')[0])).toEqual(['__bind_label__']);
  expect(siteBytes(pairKeyed('anything')[0])).toEqual(['anything']);
});

test('a relation standing on a site lands on the key; the value\'s own complaint keeps its bytes', () => {
  // The scratch-const road: TS2322 on `__v`, TS2304 on the initializer.
  const attr = pairKeyed('value')[0];
  expect(sourceTextOf(mapTsDiagnostic(good, diagnosticAt(2322, attr.sites[0])))).toBe('value');
  const init = genSpanOf('= nope;');
  expect(sourceTextOf(mapTsDiagnostic(good, diagnosticAt(2304, [init[0] + 2, init[1] - 1])))).toBe('nope');
  // The direct road: TS2345 on the argument.
  expect(sourceTextOf(mapTsDiagnostic(good, diagnosticAt(2345, pairKeyed('alt')[0].sites[0])))).toBe('alt');
  // The property road: TS2322 on the left-hand side; the right-hand
  // side's unresolved name is the value's own.
  const text = pairKeyed('textContent')[0];
  expect(sourceTextOf(mapTsDiagnostic(good, diagnosticAt(2322, text.sites[0])))).toBe('textContent');
  const rhs = genSpanOf('.textContent = nope');
  expect(sourceTextOf(mapTsDiagnostic(good, diagnosticAt(2304, [rhs[1] - 4, rhs[1]])))).toBe('nope');
  // The boolean road: TS1360 on the keyword.
  expect(sourceTextOf(mapTsDiagnostic(good, diagnosticAt(1360, pairKeyed('disabled')[0].sites[0])))).toBe('disabled');
  // The handler cast, the ref cell, the bind write-back, the props keys.
  expect(sourceTextOf(mapTsDiagnostic(good, diagnosticAt(2352, pairKeyed('@click')[0].sites[0])))).toBe('@click');
  expect(sourceTextOf(mapTsDiagnostic(good, diagnosticAt(2345, pairKeyed('ref')[0].sites[0])))).toBe('ref');
  expect(sourceTextOf(mapTsDiagnostic(good, diagnosticAt(2322, pairKeyed('value')[2].sites[0])))).toBe('value');
  expect(sourceTextOf(mapTsDiagnostic(good, diagnosticAt(2322, pairKeyed('label')[0].sites[0])))).toBe('label');
  expect(sourceTextOf(mapTsDiagnostic(good, diagnosticAt(2353, pairKeyed('anything')[0].sites[0])))).toBe('anything');
});

test('a __clsx argument is the value\'s own expression: the family separates the relation from a bare name', () => {
  const merge = pairKeyed('class')[2];
  expect(sourceTextOf(mapTsDiagnostic(good, diagnosticAt(2345, merge.sites[0])))).toBe('class');
  expect(sourceTextOf(mapTsDiagnostic(good, diagnosticAt(2304, merge.sites[0])))).toBe('nope');
});

test('a span that is not a recorded site never moves — a site\'s interior included', () => {
  const site = pairKeyed('@click')[0].sites[0];
  const inner = [site[0] + 'this.'.length, site[0] + 'this.handle'.length];
  expect(sourceTextOf(mapTsDiagnostic(good, diagnosticAt(2352, inner)))).toBe('handle');
});
