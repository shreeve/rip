// The route-mismatch anchor is where tsgo anchors the construct the
// lowering mimics, through ONE mechanism: the emitter records a
// key/value span pair per checked surface, and a diagnostic covering
// EXACTLY a recorded value re-anchors on its key — the pair's key for
// an attribute's `__ripRoute` wrap (a JSX attribute's anchor, the one
// every other mistyped attribute in the render DSL reports on); a
// `push`/`replace` argument records NO key and keeps the literal, a
// call argument's anchor. A diagnostic interior to a recorded value
// (an interpolated expression's own defect) keeps its exact position,
// and an ordinary `.push(` — an array's, even one whose element type
// IS the route union — can never snap: no span was recorded for it,
// and the message text is never consulted. A member initializer's
// lowered write re-anchors on the member's NAME the same way. Driven
// through the one honest mapping road (mapTsDiagnostic) over real
// compile() output.
import { test, expect } from 'bun:test';
import { compile } from '../../../../src/compile.js';
import { mapTsDiagnostic } from '../../src/diagnostics.js';
import { lineStartsOf, offsetToPosition } from '../../src/translate.js';

const source = [
  'Page = component',
  "  nav: RoutePath = '/cartz'",
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
  memberInits: result.memberInits,
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
const wrapKeyed = (bytes) => result.routeWraps.find((w) => w.key !== null && result.code.slice(w.key[0], w.key[1]) === bytes);
const routerWrap = () => result.routeWraps.find((w) => w.key === null);
// The generated argument span of a `.receiver.method("...")` call.
const argSpanOf = (receiver) => {
  const at = result.code.indexOf(`${receiver}.push("/cartz")`);
  expect(at).toBeGreaterThan(-1);
  const start = at + `${receiver}.push(`.length;
  return [start, start + '"/cartz"'.length];
};

test('the compile records both surfaces: key and value spans hold their bytes', () => {
  expect(result.routeWraps.length).toBe(2);
  const href = wrapKeyed('href');
  expect(result.code.slice(href.value[0], href.value[1])).toBe('"/carts"');
  const push = routerWrap();
  expect(result.code.slice(push.value[0], push.value[1])).toBe('"/cartz"');
  // The router entry's value IS the argument span — no wrap bytes
  // surround it (the ambience's const conditional does the checking).
  expect(push.value).toEqual(argSpanOf('this.router'));
});

test('a mismatch covering the whole wrapped value anchors on the key', () => {
  const mapped = mapTsDiagnostic(good, diagnosticAt(wrapKeyed('href').value));
  expect(mapped).not.toBeNull();
  expect(sourceTextOf(mapped)).toBe('href');
});

test('a diagnostic interior to the value keeps its own position', () => {
  const [start, end] = wrapKeyed('href').value;
  const mapped = mapTsDiagnostic(good, diagnosticAt([start + 1, end - 1]));
  expect(mapped).not.toBeNull();
  expect(sourceTextOf(mapped)).not.toBe('href');
});

test('a route mismatch in a router-method argument stays on the literal', () => {
  // A generic message: the span alone carries the decision.
  const mapped = mapTsDiagnostic(good, diagnosticAt(argSpanOf('this.router')));
  expect(mapped).not.toBeNull();
  expect(sourceTextOf(mapped)).toBe("'/cartz'");
});

test('a mismatch on a member initializer\'s lowered write anchors on the member name', () => {
  const at = result.code.indexOf('this.nav = ');
  expect(at).toBeGreaterThan(-1);
  expect(result.memberInits.map((m) => [source.slice(...m.key), result.code.slice(...m.site)])).toContainEqual(['nav', 'this.nav']);
  const mapped = mapTsDiagnostic(good, { ...diagnosticAt([at, at + 'this.nav'.length]), code: 2820 });
  expect(sourceTextOf(mapped)).toBe('nav');
  // A diagnostic on the literal alone keeps its own position.
  const lit = at + 'this.nav = '.length;
  expect(sourceTextOf(mapTsDiagnostic(good, diagnosticAt([lit, lit + '"/cartz"'.length])))).toBe("'/cartz'");
});

test("an ordinary .push( never snaps — even with a route-membered parameter type", () => {
  // The exact shape the old message-parsing gate misfired on: an array
  // whose element type is the inline route union. No span was recorded
  // for `this.list.push`, so the diagnostic keeps TS's argument anchor.
  const other = mapTsDiagnostic(good, diagnosticAt(argSpanOf('this.list'), ROUTE_MISMATCH));
  expect(other).not.toBeNull();
  expect(sourceTextOf(other)).not.toBe('push');
});

// The OWN-MEMBER gates: a component declaring its own `router` (or
// `stash`) shadows the ambient one, so its calls are not route (or
// stash) surfaces and record (or wrap) nothing.
const shadowed = [
  'Page = component',
  '  router = null',
  '  stash = null',
  '  go: ->',
  "    @router.push '/cartz'",
  "    u = @stash.source 'userz'",
  '  render',
  "    div 'x'",
  '',
].join('\n');
const shadowResult = compile(shadowed, {
  path: 'p2.rip', runtimeDelivery: 'none', face: 'ts',
  routesUnion: '"/" | "/cart"', appStashSpec: './app/stash.rip',
});

test('an own router member records no push span', () => {
  expect(shadowResult.routeWraps.length).toBe(0);
});

test('an own stash member wraps no source key', () => {
  expect(shadowResult.code).not.toContain('__ripSourceKey');
});
