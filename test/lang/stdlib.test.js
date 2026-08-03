// toMatchable — the match operator's receiver coercion, and a
// user-referenceable stdlib export in its own right. One contract,
// RULED (2026-08-03): it coerces every reasonable receiver to a string
// and matching is exactly JavaScript's — always a string, never a
// null, never a throw. Multi-line semantics are the regex's own
// business (`^`/`$` cross lines only under /m, as everywhere in JS);
// the guard that once refused multi-line receivers intercepted
// standard regex behavior to teach standard regex behavior, and broke
// every main-legal program that greps decoded file bytes.
import { describe, expect, test } from 'bun:test';
import { toMatchable } from '../../src/runtime/stdlib.js';

describe('toMatchable coerces every receiver to a string', () => {
  test.each([
    ['a string', 'abc', 'abc'],
    ['null', null, ''],
    ['undefined', undefined, ''],
    ['a number', 42, '42'],
    ['a boolean', true, 'true'],
    ['a symbol', Symbol('tag'), 'tag'],
    ['an array', ['a', 'b'], 'a,b'],
    ['a Uint8Array', new TextEncoder().encode('bytes'), 'bytes'],
    ['a custom toString', { toString: () => 'shaped' }, 'shaped'],
  ])('%s', (_label, v, expected) => {
    expect(toMatchable(v)).toBe(expected);
  });
});

describe('multi-line receivers coerce like any other — the regex decides what anchors mean', () => {
  test.each([
    ['a multi-line string', 'a\nb', 'a\nb'],
    ['a CR receiver', 'a\rb', 'a\rb'],
    ['a Uint8Array decoding to lines', new TextEncoder().encode('a\nb'), 'a\nb'],
    ['an array whose element carries a newline', ['a\nb'], 'a\nb'],
    ['a custom toString spanning lines', { toString: () => 'a\nb' }, 'a\nb'],
  ])('%s coerces without complaint', (_label, v, expected) => {
    expect(toMatchable(v)).toBe(expected);
  });

  // The behavior the coercion feeds: matching IS JavaScript's. An
  // anchor-free grep finds its text across lines; an anchored pattern
  // needs /m to cross them — standard regex literacy, not rip's to
  // intercept.
  test('matching over the coercion behaves exactly like hand-written JS', () => {
    const text = toMatchable(new TextEncoder().encode('name: app\nversion: 2\n'));
    expect(text.match(/version: \d/)?.[0]).toBe('version: 2');
    expect(text.match(/^version: \d$/)).toBeNull();
    expect(text.match(/^version: \d$/m)?.[0]).toBe('version: 2');
  });
});
