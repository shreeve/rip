// toMatchable — the match operator's receiver coercion, and a
// user-referenceable stdlib export in its own right. Two contracts:
//
// 1. It RETURNS A STRING for every receiver (the face annotates
//    `=> string`; the null this helper once answered surfaced as a
//    downstream TypeError on `.match`, a worse error at a worse
//    distance).
// 2. A multi-line answer without /m THROWS — anchors mislead across
//    embedded newlines — and the guard sits after the coercion, so a
//    receiver that merely COERCES to multi-line text (a decoded
//    Uint8Array, an array element carrying a newline, a custom
//    toString spanning lines) is the same refusal as a multi-line
//    string. A guard on the string path alone let those through.
import { describe, expect, test } from 'bun:test';
import { toMatchable } from '../../src/runtime/stdlib.js';

const MULTILINE = /spans lines/;

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

describe('the newline guard holds for every receiver, not only strings', () => {
  test.each([
    ['a multi-line string', 'a\nb'],
    ['a CR receiver', 'a\rb'],
    ['a Uint8Array decoding to lines', new TextEncoder().encode('a\nb')],
    ['an array whose element carries a newline', ['a\nb']],
    ['a custom toString spanning lines', { toString: () => 'a\nb' }],
  ])('%s throws without /m', (_label, v) => {
    expect(() => toMatchable(v)).toThrow(MULTILINE);
  });

  test('the same receivers pass under /m (allowNewlines)', () => {
    expect(toMatchable('a\nb', true)).toBe('a\nb');
    expect(toMatchable(new TextEncoder().encode('a\nb'), true)).toBe('a\nb');
    expect(toMatchable(['a\nb'], true)).toBe('a\nb');
  });
});
