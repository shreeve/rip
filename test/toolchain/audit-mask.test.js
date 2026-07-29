// The mapping census counts identifier READS, and `codeMask` is what decides
// which bytes are code at all. It became load-bearing when the census turned
// into a contract invariant: a byte the mask leaves standing enters a
// population of reads that must own a mapping row, and pattern syntax never
// can — so a mask that under-blanks holds `mapping.census` red for bytes that
// were never reads, and one that over-blanks hides real ones.
//
// Every case here is offset-preserving by construction, which is the property
// the whole audit indexes on: the mask replaces bytes, never removes them.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { codeMask } from '../audit/mask.js';

const names = (src) => codeMask(src).match(/[A-Za-z_$][\w$]*/g) ?? [];

describe('codeMask: what counts as code', () => {
  test.each([
    ['a plain regex', 'ok = /ab/.test(y)\n', ['ok', 'test', 'y']],
    // The case the byte-only test got wrong: a keyword ends in a word
    // character, so `return /…/` read as division and the pattern's own
    // letters entered the population.
    ['a regex after `return`', 'def f()\n  return /^[A-Z]+$/.test(x)\n', ['def', 'f', 'return', 'test', 'x']],
    ['a regex after `yield`', 'x = yield /ab/\n', ['x', 'yield']],
    // Division must survive all three value positions, or real reads vanish.
    ['division by a variable', 'total = a / b / c\n', ['total', 'a', 'b', 'c']],
    ['division after a paren', 'half = (x + 1) / 2\n', ['half', 'x']],
    ['division after an index', 'arr = items[0] / 2\n', ['arr', 'items']],
    ['a heregex, interpolation LIVE', 'h = ///\n  ab+   # note\n  #{single}\n///i\n', ['h', 'single']],
    ['a string, interpolation LIVE', "s = 'lit' + \"a#{inner}b\"\n", ['s', 'inner']],
    ['a comment', 'v = 1 # commented word\n', ['v']],
  ])('%s', (_label, src, expected) => {
    expect(names(src)).toEqual(expected);
  });
});

describe('codeMask: offsets never move', () => {
  const corpus = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.rip')) corpus.push(p);
    }
  };
  walk(join(import.meta.dir, '..', 'audit', 'corpus'));

  test('every corpus fixture masks to the same length, newlines intact', () => {
    expect(corpus.length).toBeGreaterThan(20);
    for (const f of corpus) {
      const src = readFileSync(f, 'utf8');
      const masked = codeMask(src);
      expect(masked.length, `${f} changed length`).toBe(src.length);
      for (let i = 0; i < src.length; i++) {
        if (src[i] === '\n') expect(masked[i], `${f} lost a newline at ${i}`).toBe('\n');
      }
    }
  });
});
