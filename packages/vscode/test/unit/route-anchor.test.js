// The route-mismatch anchor is the feature's MEANINGFUL TOKEN, by
// surface: a diagnostic covering EXACTLY the `__ripRoute`-wrapped value
// re-anchors on the pair's key — the anchor every other mistyped
// attribute in the render DSL reports on — and a route mismatch in a
// `.push(`/`.replace(` argument slot re-anchors on the method name
// (both v3 parity). A diagnostic interior to a wrapped value (an
// interpolated expression's own defect) keeps its exact position, and
// an ordinary `.push(` — an array's — never snaps: the method road is
// double-gated on the call shape AND a parameter type composed
// entirely of route-union members. Driven through the one honest
// mapping road (mapTsDiagnostic) over real compile() output.
import { test, expect } from 'bun:test';
import { compile } from '../../../../src/compile.js';
import { mapTsDiagnostic } from '../../src/diagnostics.js';
import { lineStartsOf, offsetToPosition } from '../../src/translate.js';

const source = [
  'Page = component',
  '  go: ->',
  "    @router.push '/cartz'",
  "    @list.push '/cartz'",
  '  render',
  "    a href: '/carts', 'x'",
  '',
].join('\n');
const result = compile(source, { path: 'p.rip', runtimeDelivery: 'none', face: 'ts', routesUnion: '"/" | "/cart"' });
const good = {
  source,
  code: result.code,
  mappings: result.mappings,
  srcLineStarts: lineStartsOf(source),
  genLineStarts: lineStartsOf(result.code),
  strict: true,
  routeWraps: result.routeWraps,
  routeEntries: [
    { shape: '/', text: '"/"', display: '/' },
    { shape: '/cart', text: '"/cart"', display: '/cart' },
  ],
};
const ROUTE_MISMATCH = 'Argument of type \'"/cartz"\' is not assignable to parameter of type \'"/" | "/cart"\'.';
const diagnosticAt = (span, message = 'mismatch') => ({
  code: 2345, message, severity: 1,
  range: {
    start: offsetToPosition(good.genLineStarts, span[0]),
    end: offsetToPosition(good.genLineStarts, span[1]),
  },
});
const sourceTextOf = (m) => {
  const off = (p) => good.srcLineStarts[p.line] + p.character;
  return source.slice(off(m.range.start), off(m.range.end));
};
// The generated argument span of a `.receiver.method("...")` call.
const argSpanOf = (receiver) => {
  const at = result.code.indexOf(`${receiver}.push("/cartz")`);
  expect(at).toBeGreaterThan(-1);
  const start = at + `${receiver}.push(`.length;
  return [start, start + '"/cartz"'.length];
};

test('the compile records the wrap: key and value spans hold their bytes', () => {
  expect(result.routeWraps.length).toBe(1);
  const [wrap] = result.routeWraps;
  expect(result.code.slice(wrap.key[0], wrap.key[1])).toBe('href');
  expect(result.code.slice(wrap.value[0], wrap.value[1])).toBe('"/carts"');
});

test('a mismatch covering the whole wrapped value anchors on the key', () => {
  const mapped = mapTsDiagnostic(good, diagnosticAt(result.routeWraps[0].value));
  expect(mapped).not.toBeNull();
  expect(sourceTextOf(mapped)).toBe('href');
});

test('a diagnostic interior to the value keeps its own position', () => {
  const [start, end] = result.routeWraps[0].value;
  const mapped = mapTsDiagnostic(good, diagnosticAt([start + 1, end - 1]));
  expect(mapped).not.toBeNull();
  expect(sourceTextOf(mapped)).not.toBe('href');
});

test('a route mismatch in a router-method argument anchors on the method name', () => {
  const mapped = mapTsDiagnostic(good, diagnosticAt(argSpanOf('this.router'), ROUTE_MISMATCH));
  expect(mapped).not.toBeNull();
  expect(sourceTextOf(mapped)).toBe('push');
});

test("an ordinary .push( — not route-typed — never snaps", () => {
  // Same call shape, but the parameter type is not the route union.
  const other = mapTsDiagnostic(good, diagnosticAt(argSpanOf('this.list'),
    'Argument of type \'"/cartz"\' is not assignable to parameter of type \'number\'.'));
  expect(other).not.toBeNull();
  expect(sourceTextOf(other)).not.toBe('push');
  // And the union gate alone is not enough either way: the route
  // message on a non-call position keeps its own anchor.
  const wrapped = mapTsDiagnostic(good, diagnosticAt(result.routeWraps[0].value, ROUTE_MISMATCH));
  expect(sourceTextOf(wrapped)).toBe('href');
});
