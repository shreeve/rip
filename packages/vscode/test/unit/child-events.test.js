// A parent's `@event:` on a child is a DOM listener on the element the
// child inherits through `extends`, and a child notifies its parent
// through a callback prop. Two misses are worded from the emitter's
// records rather than the checker's sentence: a listener on a child with
// no host (the handler cast indexes `el` in the child's `__host` record,
// TS-only bytes that anchor on the event word through the pair's
// relation site), and a required prop a construction omits (the site's
// recorded keys against the component's recorded required props).
// Driven through the one mapping road (mapTsDiagnostic) over real
// compile() output, with the diagnostics synthesized at the spans the
// pinned tsgo uses.
import { test, expect } from 'bun:test';
import { compile } from '../../../../src/compiler.js';
import { mapTsDiagnostic } from '../../src/diagnostics.js';
import { lineStartsOf, offsetToPosition } from '../../src/translate.js';

const source = [
  'Btn = component extends button',
  "  render",
  "    button 'b'",
  'Card = component',
  '  @onDone: () => void',
  '  @note?: string',
  '  render',
  "    div 'c'",
  'Page = component',
  '  render',
  '    div',
  '      Btn @click: (e) -> e',
  '      Card @click: -> 1',
  "      Card note: 'n'",
  "      Card onDone: (-> 1)",
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
  renderPairs: result.renderPairs,
  intrinsics: result.intrinsics,
  componentUses: result.componentUses,
  componentProps: result.componentProps,
};
const at = (span, code, message) => ({
  code, message, severity: 1,
  range: {
    start: offsetToPosition(good.genLineStarts, span[0]),
    end: offsetToPosition(good.genLineStarts, span[1]),
  },
});
const srcSpan = (m) => {
  const a = good.srcLineStarts[m.range.start.line] + m.range.start.character;
  const b = good.srcLineStarts[m.range.end.line] + m.range.end.character;
  return source.slice(a, b);
};
const genIndexAfter = (needle, from) => {
  const i = result.code.indexOf(needle, from);
  if (i < 0) throw new Error(`generated text lacks ${needle}`);
  return i;
};

test('the host record: a child that extends a tag declares its element; a hostless child declares {}', () => {
  expect(result.code).toContain("declare __host: { el: HTMLElementTagNameMap['button'] };");
  expect(result.code).toContain('declare __host: {};');
});

test('a listener on a hostless child: the el miss inside the cast anchors on the event word and names the channel', () => {
  // The Card listener's cast indexes `['__host']>['el']`; the miss stands on the `'el'` literal.
  const line = genIndexAfter("typeof Card>['__host']>['el']", 0);
  const el = genIndexAfter("'el'", line);
  const m = mapTsDiagnostic(good, at([el, el + 4], 2339, "Property 'el' does not exist on type '{}'."));
  expect(m).not.toBeNull();
  expect(m.message).toBe('Card extends no tag, so `@click:` has no element to listen on — a child notifies its parent through a callback prop');
  expect(srcSpan(m)).toBe('@click');
});

test('a hosted child keeps the checker\'s own words for a miss inside the handler', () => {
  const cast = genIndexAfter("typeof Btn>['__host']>['el']", 0);
  const m = mapTsDiagnostic(good, at([cast, cast + 2], 2339, "Property 'nope' does not exist on type 'PointerEvent'."));
  expect(m === null || m.message.startsWith("Property 'nope'")).toBe(true);
});

test('a construction that omits a required prop is worded from the records; one that passes it keeps the checker\'s words', () => {
  const omitted = genIndexAfter("new Card({ note: \"n\" })", 0) + 'new Card('.length;
  const m = mapTsDiagnostic(good, at([omitted, omitted + '{ note: "n" }'.length], 2345, "Argument of type '{ note: string; }' is not assignable to parameter of type '…'."));
  expect(m).not.toBeNull();
  expect(m.message).toBe("Card requires 'onDone'");
  expect(srcSpan(m)).toBe('Card');
  const passed = genIndexAfter('new Card({ onDone: (() => 1) })', 0) + 'new Card('.length;
  const n = mapTsDiagnostic(good, at([passed, passed + '{ onDone: (() => 1) }'.length], 2345, 'Argument of type X is not assignable to parameter of type Y.'));
  expect(n).not.toBeNull();
  expect(n.message).toBe('Argument of type X is not assignable to parameter of type Y.');
});
