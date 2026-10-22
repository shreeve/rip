// The lowered context read folds into the declare line's report: an
// accept's `_init` reads `getContext(Provider, 'name')`, typed as a source
// call is, so a provider that is no component or a key it does not offer
// draws TS2345 on the call's argument — the fact the declare line already
// reports once, on the accept's name (check.test.js pins the words). The
// fold is keyed on the accept's own record — the member written, the
// provider spelled, the key — so a read the author wrote keeps its
// diagnostic. Driven through mapTsDiagnostic over real compile() output,
// with the diagnostics synthesized at the spans tsgo uses.
import { test, expect } from 'bun:test';
import { compile } from '../../../../src/compiler.js';
import { mapTsDiagnostic } from '../../src/diagnostics.js';
import { lineStartsOf, offsetToPosition } from '../../src/translate.js';

const source = [
  "import * as Ns from './ns.rip'",
  'Root = component',
  '  offer open := false',
  '  render',
  '    slot',
  'Plain = 5',
  'Part = component',
  '  accept open from Plain',
  '  accept opne from Root',
  '  accept side from Ns.Root',
  '  probe = -> getContext(Plain, "open")',
  "  keep = -> @open = fetchFrom(Plain, 'open')",
  '  render',
  '    span',
  "fetchFrom = (p, k) -> 1",
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
  kinds: result.kinds,
};
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
// The span of `arg` inside the one generated line that reads `line`.
const argSpan = (line, arg) => {
  const at = result.code.indexOf(line);
  expect(at, line).toBeGreaterThan(-1);
  expect(result.code.indexOf(line, at + 1), line).toBe(-1);
  const start = at + line.indexOf(arg);
  return [start, start + arg.length];
};

test("the lowered read's refusal folds, on the provider and on the key, for a bare and a path provider", () => {
  expect(mapTsDiagnostic(good, diagnosticAt(2345, argSpan("this.open = getContext(Plain, 'open');", 'Plain')))).toBe(null);
  expect(mapTsDiagnostic(good, diagnosticAt(2345, argSpan("this.opne = getContext(Root, 'opne');", "'opne'")))).toBe(null);
  expect(mapTsDiagnostic(good, diagnosticAt(2345, argSpan("this.side = getContext(Ns.Root, 'side');", "'side'")))).toBe(null);
});

// A read the author wrote keeps its diagnostic: a bare call, and a write
// to the accepted member, which lowers through the member's container
// (`this.open.value = …`), so the lowered read's own shape is the
// lowering's alone.
test('a read the author wrote keeps its diagnostic, on the argument', () => {
  const m = mapTsDiagnostic(good, diagnosticAt(2345, argSpan('getContext(Plain, "open")', 'Plain')));
  expect(m).not.toBe(null);
  expect(sourceTextOf(m)).toBe('Plain');
  const own = mapTsDiagnostic(good, diagnosticAt(2345, argSpan('this.open.value = fetchFrom(Plain, "open")', 'Plain')));
  expect(own).not.toBe(null);
  expect(sourceTextOf(own)).toBe('Plain');
});

// A binding that takes the runtime's name makes delivery mint an alias,
// and the lowered read spells it; the fold follows the alias.
test('the fold follows the alias delivery mints when a binding takes the name', () => {
  const aliased = [
    'getContext = 1',
    'Root = component',
    '  offer open := false',
    '  render',
    '    slot',
    'Plain = 5',
    'Part = component',
    '  accept open from Plain',
    '  render',
    '    span',
    'console.log getContext',
    '',
  ].join('\n');
  const r = compile(aliased, { path: 'a.rip', runtimeDelivery: 'none', face: 'ts' });
  const g = { source: aliased, code: r.code, mappings: r.mappings, srcLineStarts: lineStartsOf(aliased), genLineStarts: lineStartsOf(r.code), strict: true, kinds: r.kinds };
  const line = "this.open = getContext_(Plain, 'open');";
  const at = r.code.indexOf(line);
  expect(at).toBeGreaterThan(-1);
  const start = at + line.indexOf('Plain');
  const d = { code: 2345, message: 'x', severity: 1, range: { start: offsetToPosition(g.genLineStarts, start), end: offsetToPosition(g.genLineStarts, start + 'Plain'.length) } };
  expect(mapTsDiagnostic(g, d)).toBe(null);
});
