// `rip.lint` construction, await, and dammit — each a keyword or operator
// with an equivalent Rip spelling: `X.new(a)` for `new X(a)`, `f!(a)` for
// `await f(a)`, and `f!` for `f!()`. Every rewrite must compile to the same
// JavaScript as the source it replaces.
//
// Fixtures are inline strings: package-rip-style.test.js lints every .rip
// file under packages/, so a fixture file there would be audited as
// authored Rip.
import { describe, expect, test } from 'bun:test';
import { compile } from '../../src/compiler.js';
import { applyEdits, lintFindingsOf, lintRulesOf } from '../../src/lint.js';

const SPELLING = lintRulesOf({ construction: '.new', await: 'dammit', dammit: 'bare' });
const ALL = lintRulesOf({ calls: 'explicit', construction: '.new', await: 'dammit', dammit: 'bare' });

function findings(source, rules) {
  const r = compile(source, { face: 'js', path: 'lint.rip' });
  return lintFindingsOf(r.tokens, r.stores, source, rules);
}

function fixed(source, rules) {
  const out = applyEdits(source, findings(source, rules).flatMap((f) => f.edits ?? []));
  expect(compile(out, { face: 'js', path: 'lint.rip' }).code).toBe(compile(source, { face: 'js', path: 'lint.rip' }).code);
  return out;
}

const FLAGGED = [
  ['a construction', 'x = new X(a)\n', 'x = X.new(a)\n'],
  ['a construction without arguments', 'x = new X()\n', 'x = X.new()\n'],
  ['a bare construction, which takes parens since `X.new` alone reads the property', 'seen = new Set\n', 'seen = Set.new()\n'],
  ['a construction with implicit arguments', 'throw new Error "m"\n', 'throw Error.new "m"\n'],
  ['a construction in a spread', 'xs = [...new Set(ys)]\n', 'xs = [...Set.new(ys)]\n'],
  ['a construction ahead of a chain', 'x = new X(a).b\n', 'x = X.new(a).b\n'],
  ['a bare construction as an implicit argument', 'f new X\n', 'f X.new()\n'],
  ['an await on a call', 'x = await f(a)\n', 'x = f!(a)\n'],
  ['an await on an implicit call', 'x = await f a\n', 'x = f! a\n'],
  ['an await on a call without arguments', 'x = await f()\n', 'x = f!\n'],
  ['an await on a method call', 'x = await o.m(a)\n', 'x = o.m!(a)\n'],
  ['an await on a chained call', 'x = await f(a).then(g)\n', 'x = f(a).then!(g)\n'],
  ['an await on an optional call', 'x = await f?(a)\n', 'x = f?!(a)\n'],
  ['an await on an implicit optional call', 'x = await f? a\n', 'x = f?! a\n'],
  ['an await on a dynamic import', "m = await import('m')\n", "m = import!('m')\n"],
  ['an await on a construction', 'x = await new X(a)\n', 'x = X.new!(a)\n'],
  ['an await on a construction without arguments', 'x = await new X()\n', 'x = X.new!\n'],
  ['an await on a bare construction', 'x = await new X\n', 'x = X.new!\n'],
  ['an await on a call in grouping parens', 'x = await (f a)\n', 'x = (f! a)\n'],
  ['a dammit call with empty parens', 'x = f!()\n', 'x = f!\n'],
  ['a dammit method call with empty parens', 'x = o.m!()\n', 'x = o.m!\n'],
];

const FLAGGED_WITH_CALLS = [
  ['a construction with implicit arguments', 'x = new X a\n', 'x = X.new(a)\n'],
  ['a bare construction as an implicit argument', 'f new X\n', 'f(X.new())\n'],
  ['an await on an implicit call', 'x = await f a\n', 'x = f!(a)\n'],
  ['an await on an implicit call inside an implicit call', 'g await f a\n', 'g(f!(a))\n'],
  ['an await on a construction with implicit arguments', 'x = await new X a\n', 'x = X.new!(a)\n'],
  ['an await on a call in grouping parens', 'x = await (f a)\n', 'x = f!(a)\n'],
];

const KEPT = [
  ['a method construction', 'x = X.new(a)\n'],
  ['a construction awaited with dammit', 'x = X.new!(a)\n'],
  ['an await on a promise in hand', 'x = await p\n'],
  ['an await on a member', 'x = await o.ready\n'],
  ['a dammit call', 'x = f!(a)\n'],
  ['a bare dammit call', 'x = f!\n'],
  ['a dammit call after an optional call', 'x = f!?()\n'],
];

describe('rip.lint construction, await, dammit — the spellings they rewrite', () => {
  for (const [name, before, after] of FLAGGED) {
    test(name, () => {
      expect(findings(before, SPELLING).length).toBeGreaterThan(0);
      expect(fixed(before, SPELLING)).toBe(after);
      expect(findings(after, SPELLING)).toEqual([]);
    });
  }
});

describe('rip.lint construction, await, dammit — alongside calls', () => {
  for (const [name, before, after] of FLAGGED_WITH_CALLS) {
    test(name, () => {
      expect(fixed(before, ALL)).toBe(after);
      expect(findings(after, ALL)).toEqual([]);
    });
  }
});

describe('rip.lint construction, await, dammit — the spellings they keep', () => {
  for (const [name, src] of KEPT) {
    test(`${name} is clean`, () => {
      expect(findings(src, SPELLING)).toEqual([]);
    });
  }
});

describe('rip.lint construction, await, dammit — findings', () => {
  test('each finding names its rule and the fixed form', () => {
    const src = 'a = new X(1)\nb = await f(2)\nc = g!()\n';
    expect(findings(src, SPELLING).map((f) => [f.rule, src.slice(f.start, f.end), f.message])).toEqual([
      ['construction', 'new X(1)', 'prefix construction — write `X.new(1)`'],
      ['await', 'await f(2)', 'await on a call — write `f!(2)`'],
      ['dammit', 'g!()', 'empty parens on a dammit call — write `g!`'],
    ]);
  });

  test('a construction whose callee is not a plain name is reported without a rewrite', () => {
    // `a.B.new(c)` compiles to `new (a.B)(c)`, which is not the source's
    // JavaScript.
    const [f] = findings('x = new a.B(c)\n', SPELLING);
    expect([f.rule, f.edits, f.message]).toEqual(['construction', null, 'prefix construction — no automatic rewrite for this shape']);
  });

  test('an await on a call already awaited with dammit is reported without a rewrite', () => {
    const [f] = findings('x = await f!(a)\n', SPELLING);
    expect([f.rule, f.edits]).toEqual(['await', null]);
  });

  test('an awaited construction belongs to the await rule alone', () => {
    expect(findings('x = await new X(a)\n', SPELLING).map((f) => f.rule)).toEqual(['await']);
    expect(findings('x = await new X(a)\n', lintRulesOf({ construction: '.new' })).map((f) => f.rule)).toEqual(['construction']);
  });

  test('without the dammit rule, an awaited empty call keeps its parens', () => {
    expect(fixed('x = await f()\n', lintRulesOf({ await: 'dammit' }))).toBe('x = f!()\n');
  });

  test('a message shows the rewrite another rule makes inside it', () => {
    const src = 'x = new X a\n';
    const call = findings(src, ALL).find((f) => f.rule === 'calls');
    expect(call.message).toBe('implicit call — write `X.new(a)`');
  });

  test('a rule value outside its accepted spelling rejects', () => {
    expect(() => lintRulesOf({ construction: 'new' })).toThrow('rip.lint.construction: expected ".new"');
    expect(() => lintRulesOf({ await: true })).toThrow('rip.lint.await: expected "dammit"');
    expect(() => lintRulesOf({ dammit: 'parens' })).toThrow('rip.lint.dammit: expected "bare"');
  });
});
