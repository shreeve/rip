//  acceptance: type-annotation SYNTAX + ERASURE + side-table
// recording.
//
// The two the contract gates hold here as tests, not prose:
//   (a) zero-cost — a typed program's output carries no runtime
//       imports and no preamble beyond what its stripped twin carries;
//   (b) erasure neutrality — adding/removing type annotations leaves
//       the compiled output BYTE-IDENTICAL to the stripped twin's.
// Plus: side tables carry every annotation's span; the erased spans
// round-trip through bestAtSource as COVER rows (never a fake exact);
// malformed type syntax rejects loudly; the old lowering byte-parity where the old lowering is
// correct, with the divergences pinned against a pinned defect–#51.
import { describe, test, expect } from 'bun:test';
import { join, resolve } from 'path';
import parser from '../../src/parser.js';
import { makeParserLexer, tokenize } from '../../src/lexer.js';
import { emit } from '../../src/emitter.js';
import { Stores, Mappings } from '../../src/stores.js';

parser.lexer = makeParserLexer();

const compile = (src) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  const { code, mappings } = emit(r, { source: src });
  return { code, rows: mappings, mappings: new Mappings(mappings), stores: new Stores(r.stores), sexpr: r.sexpr };
};

// Tier 1 declare-in-place is a SANCTIONED divergence from: the compiler
// declares straight-line locals at their first write. unplaced()
// erases declaration placement — hoist lines drop, in-place
// declarations become bare assignments — so byte pins stay focused
// on the feature bytes they exist for.
const unplaced = (code) => code
  .replace(/^[ \t]*let [A-Za-z_$][\w$]*(, [A-Za-z_$][\w$]*)*;\n\n?/gm, '')
  .replace(/^([ \t]*)let ([A-Za-z_$][\w$]*)( = )/gm, '$1$2$3');

// ── The erasure pair table ──────────────────────────────────────────
// [typed source, stripped twin]. The gate: both compile to the SAME
// BYTES. Rows marked:false diverge from the output (each pinned
// with its finding below); every other row also byte-matches.
const PAIRS = [
  // statement-level typed declarations
  ['x: number = 5', 'x = 5'],
  ['x : number = 5', 'x = 5'],
  ['x: string | null = null', 'x = null'],
  ['x: Map<string, number> = m', 'x = m'],
  ['x: A.B<C> = v', 'x = v'],
  ['x: {a: number, b?: string} = v', 'x = v'],
  ['x: (n: number) => string = f', 'x = f'],
  ['x: number[] = []', 'x = []'],
  ['x: [number, string] = pair', 'x = pair'],
  ['x: "lit" = v', 'x = v'],
  ['x: 42 = v', 'x = v'],
  // adversarial characters INSIDE the type text: a colon and a hash
  // in a string literal type stay type text (never a second
  // annotation, never a comment); a real trailing comment after the
  // value stays a comment
  ['x: "a: b" = 5', 'x = 5'],
  ['v: "has # hash" = 2', 'v = 2'],
  ['z: T = 5 # trailing comment', 'z = 5 # trailing comment'],
  ['x: T extends U ? A : B = v', 'x = v'],
  ['x: number =\n  5', 'x =\n  5'],
  ['x: number = 5 if c', 'x = 5 if c'],
  ['x: number = 5 while c', 'x = 5 while c'],
  ['get: (p: string) => void = f', 'get = f'],
  ['if c\n  x: number = 5\n  x', 'if c\n  x = 5\n  x'],
  ['f = ->\n  r: number = g()\n  r', 'f = ->\n  r = g()\n  r'],
  // parameter annotations
  ['f = (a: number, b: string = "s") -> a', 'f = (a, b = "s") -> a'],
  ['f = (a: number = 3) -> a', 'f = (a = 3) -> a'],
  ['f = (...args: number[]) -> args', 'f = (...args) -> args'],
  ['f = ({a, b}: Opts) -> a', 'f = ({a, b}) -> a'],
  ['f = ([a, b]: Pair) -> a', 'f = ([a, b]) -> a'],
  ['f = ({a, b}: Opts = {}) -> a', 'f = ({a, b} = {}) -> a'],
  ['f = (a: T) => a', 'f = (a) => a'],
  ['f = (cb: (e) => void) -> cb', 'f = (cb) -> cb'],
  ['def g(a: string, b: number = 1)\n  a', 'def g(a, b = 1)\n  a'],
  ['def m(a: number,\n      b: string)\n  a', 'def m(a,\n      b)\n  a'],
  // newline-/semicolon-separated typed params (PR #35 review, F1):
  // every separator ends a segment, so EVERY typed param erases —
  // resets on commas alone and silently miscompiles the rest into
  // destructuring patterns
  ['f = (\n  a: number\n  b: string\n  c: boolean\n) -> a', 'f = (\n  a\n  b\n  c\n) -> a'],
  ['f = (a: number\n b: string\n c: boolean) -> a', 'f = (a\n b\n c) -> a'],
  ['f = (a: number; b: string) -> a', 'f = (a; b) -> a'],
  ['def g(\n  a: number\n  b: string\n)\n  a', 'def g(\n  a\n  b\n)\n  a'],
  ['def g(a: number; b: string)\n  a', 'def g(a; b)\n  a'],
  ['f = (a: number = 1\n b: string) -> a', 'f = (a = 1\n b) -> a'],
  ['f = (\n  a: number = 1\n  b: string\n) -> a', 'f = (\n  a = 1\n  b\n) -> a'],
  // a default's BODY block is the value's own — its separators never
  // reset the segment, its colons never claim
  ['f = (cb = ->\n  k: 1\n  j: 2\n, b: T) -> b', 'f = (cb = ->\n  k: 1\n  j: 2\n, b) -> b'],
  ['f = (a = if c\n  k: 1\n  m: 2\n, b: T) -> b', 'f = (a = if c\n  k: 1\n  m: 2\n, b) -> b'],
  // …but a default that completed INLINE owns no following indent —
  // the next parameter line's annotation still erases (PR #35 review,
  // N1: a stale body claim once exempted it)
  ['f = (a = -> 5\n b: T) -> b', 'f = (a = -> 5\n b) -> b'],
  ['f = (a = -> 5\n b: T\n c: U) -> b', 'f = (a = -> 5\n b\n c) -> b'],
  ['f = (x = => 2\n b: T) -> b', 'f = (x = => 2\n b) -> b'],
  ['f = (cb = (y: U) -> y\n b: T) -> b', 'f = (cb = (y) -> y\n b) -> b'],
  ['def g(a = -> 1\n b: T)\n  b', 'def g(a = -> 1\n b)\n  b'],
  ['f = (a = do g\n b: T) -> b', 'f = (a = do g\n b) -> b'],
  ['f = (a = if c then 1 else 2\n b: T) -> b', 'f = (a = if c then 1 else 2\n b) -> b'],
  ['f = (a = (g 1)\n b: T) -> b', 'f = (a = (g 1)\n b) -> b'],
  ['f = (a = switch v\n  when 1 then 2\n  else 3\n, b: T) -> b', 'f = (a = switch v\n  when 1 then 2\n  else 3\n, b) -> b'],
  ['f = (a = ->\n  k: 1\n  j: 2\n, b: T) -> b', 'f = (a = ->\n  k: 1\n  j: 2\n, b) -> b'],
  // casts in ternary branches (PR #35 review, F2): the type name
  // before the else-colon is scanner-key-tagged PROPERTY; the cast
  // claims it and the ':' stays the ternary's (the old lowering rejects the SIMPLE
  // spelling only; the generic one compiles there too)
  ['y = a ? x as T : b', 'y = a ? x : b'],
  ['q = c ? v as Map<K, V> : w', 'q = c ? v : w'],
  // return types
  ['def g(a: string): number\n  a', 'def g(a)\n  a'],
  ['def g: number\n  5', 'def g\n  5'],
  ['def g(a): Map<K, V>\n  a', 'def g(a)\n  a'],
  ['f = (a): number -> a', 'f = (a) -> a'],
  ['f = (a): T => a', 'f = (a) => a'],
  ['f = (a): ((e: T) => R) => a', 'f = (a) => a'],
  // casts
  ['y = x as MyType', 'y = x'],
  ['y = x as Map<K, V>\ny2 = 3', 'y = x\ny2 = 3'],
  ['y = (f 1) as A as B', 'y = (f 1)'],
  ['y = x as unknown as T', 'y = x'],
  ['z = a as N + 1', 'z = a + 1'],
  ['y = [1, x as T, 2]', 'y = [1, x, 2]'],
  ['y = f a as T, b', 'y = f a, b'],
  ['m = {k: v as T}', 'm = {k: v}'],
  ['throw x as T', 'throw x'],
  ['y = x? as T', 'y = x?'],
  ['y = x as A | B', 'y = x'],
  ['y = x as {a: number}', 'y = x'],
  ['y = x as (A | B)', 'y = x'],
  ['y = x as typeof w', 'y = x'],
  ['s = "a as b"', 's = "a as b"'],
  ['w = "#{n as T}"', 'w = "#{n}"'],
  ['abc = do (x: number = 5) -> x', 'abc = do (x = 5) -> x'],
  // composition: typed everything at once
  [
    'def total(items: number[], start: number = 0): number\n  sum: number = start\n  sum += n for n in items\n  sum',
    'def total(items, start = 0)\n  sum = start\n  sum += n for n in items\n  sum',
  ],
];

  test('newline-/semicolon-separated typed params all erase', () => {
    // the old lowering emits `function(a, {b: string, c: boolean})` for the opener
    // form — the annotations become destructuring patterns binding
    // `string`/`boolean`. The no-opener form throws in
    // ("Unexpected CALL_START") even though its UNTYPED twin compiles
    // — the compiler erases both to the twin's exact bytes (asserted per-pair by
    // the gate; the shape is pinned here once).
    expect(compile('f = (\n  a: number\n  b: string\n  c: boolean\n) -> a').code)
      .toBe('let f = function(a, b, c) {\n  return a;\n};');
    expect(compile('f = (a: number\n b: string\n c: boolean) -> a').code)
      .toBe('let f = function(a, b, c) {\n  return a;\n};');
  });

  test('F2 decision, pinned: casts parse in ternary branches; the neighboring forms are unchanged', () => {
    // The cast run stops at the ternary's else-colon; the PROPERTY
    // key-tag on the type name is a type starter now. the old lowering rejects this
    // SIMPLE spelling ("Unexpected PROPERTY" — only a type name
    // directly before the colon gets key-tagged); generic spellings
    // (`v as Map<K, V> : w`) compile and stay byte-pinned.
    expect(compile('y = a ? x as T : b').code).toBe('let y = a ? x : b;');
    // No collision: an object literal in a ternary branch stays what
    // it always was — rejected in BOTH compilers (no grammar form)...
    const r = parser.parse('y = a ? {x: 1} : b');
    expect(r.sexpr).toBeNull();
    // ...and an `as` PROPERTY key keeps its implicit-object reading.
    expect(compile('f as: 1').code).toBe('f({as: 1});');
  });

  test('N1 pins: inline bodies keep their own separators; deeper lines after them are new segments', () => {
    // A ';' after an inline arrow body CONTINUES the body (the
    // only-a-newline-ends-a-single-liner rule): `b: 1` stays the
    // returned object — the segment machinery must not reset there
    // and must not claim inside the body.
    expect(compile('f = (a = -> 5; b: 1) -> b').code)
      .toBe('let f = function(a = function() {\n  5;\n  return {b: 1};\n}) {\n  return b;\n};');
    // A DEEPER line after an inline body ends it and starts a new
    // parameter segment — in the typed world a `j: 2` there is an
    // annotated param (type "2", a literal type) and erases;
    // instead reads a destructuring pattern `{j: 2}` (its param model
    // has no annotations — the #52 family).
    expect(compile('f = (a = -> k: 1\n  j: 2, b) -> b').code)
      .toBe('let f = function(a = function() {\n  return {k: 1};\n}, j, b) {\n  return b;\n};');
  });

  test('a `name: T = v` line inside an indented object body stays an object member', () => {
    // A naive reading compiles this to `conf = a = 1` — the object
    // literal vanishes and `a` leaks to module scope. The object is
    // kept; the pair's value is the assignment expression `(Foo = 1)`.
    const { code } = compile('conf =\n  a: Foo = 1');
    expect(code).toBe('let Foo;\n\nlet conf = {a: (Foo = 1)};');
  });

