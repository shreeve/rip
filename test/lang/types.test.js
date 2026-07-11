// Type-annotation acceptance: SYNTAX + ERASURE + side-table recording.
//
// Two contract gates hold here as tests, not prose:
//   (a) zero-cost — a typed program's output carries no runtime
//       imports and no preamble beyond what its stripped twin carries;
//   (b) erasure neutrality — adding/removing type annotations leaves
//       the compiled output BYTE-IDENTICAL to the stripped twin's.
// Plus: side tables carry every annotation's span; the erased spans
// round-trip through bestAtSource as COVER rows (never a fake exact);
// malformed type syntax rejects loudly.
import { describe, test, expect } from 'bun:test';
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

// ── The erasure pair table ──────────────────────────────────────────
// [typed source, stripped twin]. The gate: both compile to the SAME
// BYTES.
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
  // newline-/semicolon-separated typed params: every separator ends a
  // segment, so EVERY typed param erases (a comma-only segment reset
  // would silently miscompile the rest into destructuring patterns)
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
  // the next parameter line's annotation still erases
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
  // casts in ternary branches: the type name before the else-colon is
  // scanner-key-tagged PROPERTY; the cast claims it and the ':' stays
  // the ternary's
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

describe('erasure-neutrality gate: typed and stripped twins compile to the same bytes', () => {
  for (const [typed, plain] of PAIRS) {
    test(JSON.stringify(typed), () => {
      expect(compile(typed).code).toBe(compile(plain).code);
    });
  }
});

describe('zero-cost gate: erased types add no imports and no preamble', () => {
  test('no typed output contains an import/require its source did not write', () => {
    for (const [typed] of PAIRS) {
      const { code } = compile(typed);
      expect(code).not.toMatch(/\brequire\s*\(/);
      expect(code.includes('import')).toBe(typed.includes('import'));
    }
  });
});

describe('sexpr erasure: a typed program parses to its stripped twin\'s tree', () => {
  // Typed params construct the erased ["typed-var", target, "T"] wrapper —
  // canonicalize it away; every OTHER typed form drops its annotation
  // from the tree by construction (side-band roles).
  const canon = (x) => {
    if (!Array.isArray(x)) return x;
    if (x.length === 3 && x[0] === 'typed-var' && typeof x[2] === 'string') return canon(x[1]);
    return x.map(canon);
  };
  for (const [typed, plain] of PAIRS) {
    if (typed.includes(' as ')) continue; // casts are REAL nodes on both sides
    test(JSON.stringify(typed), () => {
      const t = parser.parse(typed);
      const p = parser.parse(plain);
      expect(t.diagnostics).toEqual([]);
      expect(JSON.stringify(canon(t.sexpr))).toBe(JSON.stringify(p.sexpr));
    });
  }
});

describe('erasure boundary pins: guards, forwards, segments, ternary casts', () => {
  test('a postfix clause after a cast survives — the guard never joins the type string', () => {
    // A greedy type collector would swallow the guard into the type
    // string and emit `y = x;`. The guard survives.
    expect(compile('y = x as T if c').code).toBe('let y;\n\nif (c) y = x;');
    // The else-branch likewise stays out of the type string.
    expect(compile('q = if c then x as T else y').code).toBe('let q = c ? x : y;');
    // The while spelling of the same rule.
    expect(compile('y = x as T while c').code).toBe(compile('y = x while c').code);
  });

  test('assigned-later evidence is INDENT-scoped: single-line arrow assignments count, multi-line closures never do', () => {
    // `f = -> r = 5` carries no INDENT at the collapse stage
    // (implicitBlocks runs later), so its assignment registers at the
    // enclosing statement level and the bare declaration CLAIMS —
    // erasing to the twin's bytes.
    expect(compile('r: number\nf = -> r = 5').code).toBe(compile('f = -> r = 5').code);
    // A MULTI-LINE arrow body is a closure (INDENT directly after the
    // arrow): its assignment is never evidence — the line keeps its
    // object reading.
    expect(compile('r: number\nf = ->\n  r = 5').code)
      .toBe('({r: number});\nlet f = function() {\n  let r;\n  return (r = 5);\n};');
  });

  test('bare typed forward declarations erase COMPLETELY — no bare-name statement leaks', () => {
    // The claim erases to NOTHING; the hoisted `let r;` comes from the
    // later assignment. (A leaked bare `r;` would be a live read —
    // TDZ/accessor-observable — plus dead weight.)
    expect(compile('r: number\nr = 5').code).toBe('let r = 5;');
    // The class variant: an initialized typed field declares nothing
    // outside the class.
    expect(compile('class A\n  x: number = 5').code).toBe('class A {\n  x = 5;\n}');
    // The claim needs its evidence — without a later assignment the
    // line keeps its object-literal reading.
    expect(compile('r: number').code).toBe('({r: number});');
    // Adjacent `key:` lines with full run evidence claim as typed
    // forwards (the sibling-run claim).
    expect(compile('a: number\nb: string\na = 1\nb = "s"').code)
      .toBe('let a = 1;\nlet b = "s";');
    // Tail position (a block's value) stays an implicit-return object.
    expect(compile('f = ->\n  r = 1\n  r: number').code)
      .toBe('let f = function() {\n  let r = 1;\n  return {r: number};\n};');
  });

  test('newline-/semicolon-separated typed params all erase', () => {
    // Both spellings — with and without an opener line — erase to the
    // untyped twin's exact bytes (asserted per-pair by the gate; the
    // shape is pinned here once).
    expect(compile('f = (\n  a: number\n  b: string\n  c: boolean\n) -> a').code)
      .toBe('let f = function(a, b, c) {\n  return a;\n};');
    expect(compile('f = (a: number\n b: string\n c: boolean) -> a').code)
      .toBe('let f = function(a, b, c) {\n  return a;\n};');
  });

  test('casts parse in ternary branches; the neighboring forms are unchanged', () => {
    // The cast run stops at the ternary's else-colon; the PROPERTY
    // key-tag on the type name is a type starter.
    expect(compile('y = a ? x as T : b').code).toBe('let y = a ? x : b;');
    // No collision: an object literal in a ternary branch parses —
    // each brace depth pairs its own colons, so the brace-inner pair
    // colon never claims the ternary's else-colon...
    const r = parser.parse('y = a ? {x: 1} : b');
    expect(r.sexpr).toEqual(['program', ['=', 'y', ['?:', 'a', ['object', [':', 'x', '1']], 'b']]]);
    // ...and an `as` PROPERTY key keeps its implicit-object reading.
    expect(compile('f as: 1').code).toBe('f({as: 1});');
  });

  test('inline bodies keep their own separators; deeper lines after them are new segments', () => {
    // A ';' after an inline arrow body CONTINUES the body (only a
    // newline ends a single-liner): `b: 1` stays the returned object —
    // the segment machinery must not reset there and must not claim
    // inside the body.
    expect(compile('f = (a = -> 5; b: 1) -> b').code)
      .toBe('let f = function(a = function() {\n  5;\n  return {b: 1};\n}) {\n  return b;\n};');
    // A DEEPER line after an inline body ends it and starts a new
    // parameter segment — a `j: 2` there is an annotated param
    // (type "2", a literal type) and erases.
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
});

describe('token fixtures: TYPE/CAST tokens carry the annotation extent', () => {
  const kinds = (src) => tokenize(src).tokens.map((t) => `${t.kind}`).join(' ');
  const find = (src, kind) => tokenize(src).tokens.find((t) => t.kind === kind);

  test('typed declaration: `: number` collapses to one TYPE token spanning the annotation', () => {
    expect(kinds('x: number = 5')).toBe('IDENTIFIER TYPE = NUMBER');
    const t = find('x: number = 5', 'TYPE');
    expect(t.value).toBe('number');
    expect([t.start, t.end]).toEqual([1, 9]); // `: number`
    expect(t.generated).toBe(false);
  });

  test('spaced colon: the TYPE span still starts at the colon', () => {
    const t = find('x : number = 5', 'TYPE');
    expect([t.start, t.end]).toEqual([2, 10]);
  });

  test('cast: `as Type` collapses to one CAST token from the `as` through the type', () => {
    expect(kinds('y = x as MyType')).toBe('IDENTIFIER = IDENTIFIER CAST');
    const t = find('y = x as MyType', 'CAST');
    expect(t.value).toBe('MyType');
    expect([t.start, t.end]).toEqual([6, 15]); // `as MyType`
  });

  test('generic cast at line end: the scanner-suppressed TERMINATOR is restored', () => {
    const toks = tokenize('y = x as Map<K, V>\ny2 = 3').tokens.map((t) => t.kind);
    expect(toks).toEqual(['IDENTIFIER', '=', 'IDENTIFIER', 'CAST', 'TERMINATOR', 'IDENTIFIER', '=', 'NUMBER']);
  });

  test('generic return type at line end: the def still opens its body block', () => {
    const toks = tokenize('def g(a): Map<K, V>\n  a').tokens.map((t) => t.kind);
    expect(toks).toEqual(['DEF', 'IDENTIFIER', 'CALL_START', 'IDENTIFIER', 'CALL_END', 'TYPE', 'INDENT', 'IDENTIFIER', 'OUTDENT']);
  });

  test('param annotations claim inside PARAM and def CALL frames only', () => {
    expect(kinds('f = (a: T) -> a')).toBe('IDENTIFIER = PARAM_START IDENTIFIER TYPE PARAM_END -> INDENT IDENTIFIER OUTDENT');
    expect(kinds('def g(a: T)\n  a')).toBe('DEF IDENTIFIER CALL_START IDENTIFIER TYPE CALL_END INDENT IDENTIFIER OUTDENT');
    // an ordinary CALL keeps its implicit-object reading
    expect(kinds('foo(a: 1)')).toBe('IDENTIFIER CALL_START { PROPERTY : NUMBER } CALL_END');
  });

  test('non-type colons are untouched: object pairs, ternaries, renames', () => {
    expect(kinds('obj = {x: 1}')).toBe('IDENTIFIER = { PROPERTY : NUMBER }');
    expect(kinds('t = a ? b : c')).toBe('IDENTIFIER = IDENTIFIER TERNARY IDENTIFIER : IDENTIFIER');
    expect(kinds('{a: b} = o')).toBe('{ PROPERTY : IDENTIFIER } = IDENTIFIER');
  });

  test('reserved words are legal inside type runs, still loud in value position', () => {
    const t = find('f = (cb: () => void) -> cb', 'TYPE');
    expect(t.value).toBe('() => void');
    expect(() => tokenize('x = void')).toThrow(/'void' is reserved/);
    expect(() => tokenize('let x')).toThrow(/'let' is reserved/);
  });
});

describe('side tables carry type spans', () => {
  test('typed declaration: the assign node owns a side-band annotation role', () => {
    const src = 'x: number = 5';
    const { stores } = compile(src);
    const [assign] = stores.nodesByKind('assign');
    const role = stores.role(assign.nodeId, 'annotation');
    expect(role).not.toBeNull();
    expect(role.grammarRef).toBe(2);
    expect(role.childSlot).toBeNull(); // dropped from the s-expression
    expect(src.slice(role.sourceStart, role.sourceEnd)).toBe(': number');
    // containment: the annotation sits inside its owner's span
    const [s, e] = stores.selfSpan(assign.nodeId);
    expect(role.sourceStart >= s && role.sourceEnd <= e).toBe(true);
  });

  test('typed param: a `typedvar` node spans `a: T`, its annotation role spans `: T`', () => {
    const src = 'f = (a: number) -> a';
    const { stores } = compile(src);
    const [typed] = stores.nodesByKind('typedvar');
    expect(typed).toBeDefined();
    expect(src.slice(typed.sourceStart, typed.sourceEnd)).toBe('a: number');
    const target = stores.role(typed.nodeId, 'target');
    const annotation = stores.role(typed.nodeId, 'annotation');
    expect(src.slice(target.sourceStart, target.sourceEnd)).toBe('a');
    expect(src.slice(annotation.sourceStart, annotation.sourceEnd)).toBe(': number');
  });

  test('def return type: the def node owns a side-band returnType role', () => {
    const src = 'def g(a): number\n  a';
    const { stores } = compile(src);
    const [def] = stores.nodesByKind('def');
    const role = stores.role(def.nodeId, 'returnType');
    expect(src.slice(role.sourceStart, role.sourceEnd)).toBe(': number');
  });

  test('arrow return type: the func node owns a side-band returnType role', () => {
    const src = 'f = (a): number -> a';
    const { stores } = compile(src);
    const [func] = stores.nodesByKind('func');
    const role = stores.role(func.nodeId, 'returnType');
    expect(src.slice(role.sourceStart, role.sourceEnd)).toBe(': number');
  });

  test('cast: the cast node is real; its annotation role spans `as T`', () => {
    const src = 'y = x as MyType';
    const { stores } = compile(src);
    const [cast] = stores.nodesByKind('cast');
    expect(src.slice(cast.sourceStart, cast.sourceEnd)).toBe('x as MyType');
    const role = stores.role(cast.nodeId, 'annotation');
    expect(src.slice(role.sourceStart, role.sourceEnd)).toBe('as MyType');
  });
});

describe('mapping: erased type spans round-trip through bestAtSource as COVER rows', () => {
  test('typed declaration: an offset inside `: number` resolves to the statement\'s generated span', () => {
    const src = 'x: number = 5';
    const { code, mappings, stores } = compile(src);
    const [assign] = stores.nodesByKind('assign');
    // offset 4 sits inside `: number`
    const row = mappings.bestAtSource(4);
    expect(row).not.toBeNull();
    expect(row.nodeId).toBe(assign.nodeId);
    expect(row.role).toBe('annotation');
    expect(row.mappingKind).toBe('cover'); // never a fake exact
    expect(code.slice(row.generatedStart, row.generatedEnd)).toBe('x = 5');
  });

  test('cast: an offset inside `as T` resolves to the erased value\'s generated span', () => {
    const src = 'y = x as MyType';
    const { code, mappings } = compile(src);
    const row = mappings.bestAtSource(8); // inside `as MyType`
    expect(row.role).toBe('annotation');
    expect(row.mappingKind).toBe('cover');
    expect(code.slice(row.generatedStart, row.generatedEnd)).toBe('x');
  });

  test('typed param: an offset inside the annotation resolves to the emitted name', () => {
    const src = 'f = (a: number) -> a';
    const { code, mappings } = compile(src);
    const row = mappings.bestAtSource(8); // inside `: number`
    expect(row.role).toBe('annotation');
    expect(row.mappingKind).toBe('cover');
    expect(code.slice(row.generatedStart, row.generatedEnd)).toBe('a');
  });

  test('return type: an offset inside the annotation covers the whole emitted function', () => {
    const src = 'def g(a): number\n  a';
    const { code, mappings } = compile(src);
    const row = mappings.bestAtSource(12); // inside `: number`
    expect(row.role).toBe('returnType');
    expect(row.mappingKind).toBe('cover');
    expect(code.slice(row.generatedStart, row.generatedEnd)).toBe('function g(a) {\n  return a;\n}');
  });

  test('no annotation/returnType mapping row is ever exact', () => {
    for (const [typed] of PAIRS) {
      const { rows } = compile(typed);
      for (const r of rows) {
        if (r.role === 'annotation' || r.role === 'returnType') {
          expect(r.mappingKind).toBe('cover');
        }
      }
    }
  });

  test('annotation cover rows never serialize into the source map (non-$self covers stay reverse-only)', () => {
    const { mappings } = compile('x: number = 5');
    for (const r of mappings.serializableRows()) {
      expect(r.role === 'annotation' || r.role === 'returnType').toBe(false);
    }
  });
});

describe('composition and boundary: casts in every position, eval-asserted', () => {
  const evalOf = (src) => {
    const { code } = compile(src);
    // module-style output evals as a script body returning r
    return new Function(`${code}\nreturn r;`)();
  };

  test('member-object head: `({a: 1} as T).a`', () => {
    expect(evalOf('r = ({a: 1} as T).a')).toBe(1);
  });

  test('call-callee head: `(f as G)(3)`', () => {
    expect(evalOf('f = (x) -> x * 2\nr = (f as G)(3)')).toBe(6);
  });

  test('index-object head: `(arr as A)[1]`', () => {
    expect(evalOf('arr = [10, 20]\nr = (arr as A)[1]')).toBe(20);
  });

  test('argument position: `g(x as T)`', () => {
    expect(evalOf('g = (v) -> v + 1\nx = 4\nr = g(x as T)')).toBe(5);
  });

  test('assignment value and chained cast', () => {
    expect(evalOf('x = 7\nr = x as A as B')).toBe(7);
  });

  test('return position inside a def', () => {
    expect(evalOf('def pick(v: number): number\n  return v as T\nr = pick(9)')).toBe(9);
  });

  test('statement position: a cast object literal groups', () => {
    const { code } = compile('{a: 1} as T');
    expect(code).toBe('({a: 1});');
    expect(() => new Function(code)).not.toThrow();
  });

  test('typed params compose with defaults, rests, and patterns (eval)', () => {
    expect(evalOf('f = (a: number, b: number = 3, ...rest: number[]) -> a + b + rest.length\nr = f(1, 2, 9, 9)')).toBe(5);
    expect(evalOf('f = ({a, b}: Opts = {a: 1, b: 2}) -> a + b\nr = f()')).toBe(3);
  });
});

describe('malformed type syntax rejects loudly', () => {
  const parseFails = (src) => {
    const r = parser.parse(src);
    expect(r.sexpr).toBeNull();
    expect(r.diagnostics).not.toHaveLength(0);
  };

  test('a bare function-type arrow return must be parenthesized', () => {
    expect(() => tokenize('f = (x): (a: T) => R => x')).toThrow(/function-type return on an arrow must be parenthesized/);
  });

  test('an empty annotation is no annotation: `x: = 5` fails the parse', () => {
    parseFails('x: = 5');
  });

  test('a depth-0 colon inside a type run is collected, not a second annotation (conditional types need it)', () => {
    // `T extends U ? A : B` carries a legitimate depth-0 ':' — the
    // collector cannot reject colons wholesale. Junk strings like
    // 'T: U' stay opaque in ANNOTATION position; they surface as
    // diagnosable text on the declaration artifact, where the tsc
    // harness owns the verdict.
    const r = parser.parse('f = (a: T: U) -> a');
    expect(r.diagnostics).toEqual([]);
    expect(JSON.stringify(r.sexpr)).toContain('"T: U"');
  });

  test('an unterminated typed param list is loud', () => {
    expect(() => tokenize('f = (a: T')).toThrow(/unclosed/);
  });

  test('reserved words in value position keep their loud rejection', () => {
    expect(() => tokenize('x = interface')).toThrow(/'interface' is reserved/);
  });
});

// ════════════════════════════════════════════════════════════════════
// Declaration forms — whole STATEMENTS that erase: type/interface
// declarations, bare typed forward declarations, typed class fields,
// exported typed declarations. The erasure-neutrality gate extends to
// statement-level byte-neutrality: the typed program and its stripped
// twin compile to the SAME BYTES.
// ════════════════════════════════════════════════════════════════════

const STMT_PAIRS = [
  // type aliases: simple, generic, function, conditional, block-union,
  // structural — plus separator variants (`;`, generic line-close)
  ['type ID = string\nx = 5', 'x = 5'],
  ['type ID = string; x = 5', 'x = 5'],
  ['type Pair<A, B> = [A, B]\nz = 1', 'z = 1'],
  ['type P = {x: number, y: number}\nz = 1', 'z = 1'],
  ['type H = (e: Event) => void\nh = null', 'h = null'],
  ['type X = T extends U ? A : B\nz = 1', 'z = 1'],
  ['type T = Map<string, number>\nz = 1', 'z = 1'],
  ['type R =\n  | Ok\n  | Err\nz = 1', 'z = 1'],
  ['type S =\n  x: number\n  y: string\nz = 1', 'z = 1'],
  ['export type ID = string\nz = 1', 'z = 1'],
  ['export type Pair<A, B> = [A, B]\nz = 1', 'z = 1'],
  // adversarial characters inside alias text: a `#` comment BETWEEN
  // block-union variants erases with the body; an angle bracket
  // inside a string literal type never opens a generic
  ['type R =\n  | Ok\n  # note between variants\n  | Err\nz = 1', 'z = 1'],
  ['type S = "a>b" | C<D>\nz = 1', 'z = 1'],
  // block-body TAILS ending in a generic close (the scanner's
  // unfinished-`>` rule must end the body, not glue the next
  // statement into it): both union orderings, a `>>` tail, a
  // structural-field tail, a one-line conditional tail, and
  // blank-line/comment/EOF followers
  ['type R =\n  | Ok<T>\n  | Err<E>\ny = 2', 'y = 2'],
  ['type R =\n  | Some<T>\n  | None\ny = 2', 'y = 2'],
  ['type R =\n  | None\n  | Some<T>\ny = 2', 'y = 2'],
  ['type W =\n  | Wrap<Inner<K>>\ny = 2', 'y = 2'],
  ['type S =\n  size: Map<K, V>\ny = 2', 'y = 2'],
  ['type X = c extends d ? A : Map<K, V>\ny = 2', 'y = 2'],
  ['type T =\n  | Ok<T>\n\ny = 2', 'y = 2'],
  ['type T =\n  | Ok<T>\n# note\ny = 2', 'y = 2'],
  ['type T =\n  | Ok<T>', ''],
  // generics WRAPPED across body lines: tail wraps at same and deeper
  // indents, `>>` wraps, union-variant wraps, MID-body wraps, and
  // interface-member wraps
  ['type T =\n  Map<K,\n  V>\ny = 2', 'y = 2'],
  ['type T =\n  A<B<K,\n  V>>\ny = 2', 'y = 2'],
  ['type R =\n  | Ok<A,\n  B>\ny = 2', 'y = 2'],
  ['type T =\n  Map<K,\n  V>\n  | Other\ny = 2', 'y = 2'],
  ['type T =\n  Map<K,\n    V>\nobj.method\ny = 2', 'obj.method\ny = 2'],
  ['interface P\n  x: Map<K,\n  V>\ny = 2', 'y = 2'],
  // interface: plain, extends, exported, method shorthand
  ['interface Point\n  x: number\n  y: number\nz = 1', 'z = 1'],
  ['interface Q extends P\n  z: number\nw = 1', 'w = 1'],
  ['export interface P\n  x: number\nz = 1', 'z = 1'],
  ['interface P\n  m(x: number): void\nz = 1', 'z = 1'],
  ['interface P\n  m(cb: (e: Event) => void): Map<K, V>\n  x: number\nz = 1', 'z = 1'],
  // erased statements inside blocks, function bodies, and branches —
  // separator/indent interactions included
  ['if c\n  type T = string\n  x = 1', 'if c\n  x = 1'],
  ['f = ->\n  type T = string\n  5', 'f = ->\n  5'],
  ['f = ->\n  5\n  type T = string', 'f = ->\n  5'], // tail erasure: the implicit return moves
  ['x = if a\n  type T = string\n  1', 'x = if a\n  1'], // ternary-lowered branch
  // bare typed forward declarations: newline, semicolon, blank-line,
  // generic, block variants
  ['r: number\nr = 5', 'r = 5'],
  ['r: number; r = 5', 'r = 5'],
  ['r: number\n\nr = 5', 'r = 5'],
  ['r: Map<string, number>\nr = m', 'r = m'],
  ['f = ->\n  r: number\n  r = g()\n  r', 'f = ->\n  r = g()\n  r'],
  ['if c\n  r: number\n  r = 5', 'if c\n  r = 5'],
  // typed class fields: with/without initializers, static `@` forms,
  // method interleavings, `;` separators, extends/expression classes
  ['class A\n  x: number = 5', 'class A\n  x = 5'],
  ['class A\n  x: number', 'class A\n  x'],
  ['class A\n  x: Map<K, V>', 'class A\n  x'],
  ['class A\n  @x: number = 2', 'class A\n  @x = 2'],
  ['class A\n  @x: number', 'class A\n  @x'],
  ['class A\n  x: number = 5\n  m: -> @x', 'class A\n  x = 5\n  m: -> @x'],
  ['class A\n  m: -> 1\n  x: number = 5\n  n: -> 2', 'class A\n  m: -> 1\n  x = 5\n  n: -> 2'],
  ['class A\n  x: number = 5; y: string = "s"', 'class A\n  x = 5; y = "s"'],
  ['class A extends B\n  x: number = 5', 'class A extends B\n  x = 5'],
  ['x = class A\n  y: number = 5', 'x = class A\n  y = 5'],
  ['class A\n  constructor: ->\n    @v = 1\n  x: number = 5', 'class A\n  constructor: ->\n    @v = 1\n  x = 5'],
  // exported typed declarations
  ['export x: number = 5', 'export x = 5'],
  ['export x: number =\n  5', 'export x =\n  5'],
  ['export f: (n: number) => number = (n) -> n + 1', 'export f = (n) -> n + 1'],
  // module-level @-typed declaration
  ['@x: number = 2', '@x = 2'],
];

describe('whole-statement erasure: typed and stripped twins compile to the same bytes', () => {
  for (const [typed, plain] of STMT_PAIRS) {
    test(JSON.stringify(typed), () => {
      expect(compile(typed).code).toBe(compile(plain).code);
    });
  }
});

describe('erased declarations add no imports and no preamble', () => {
  test('no typed output contains an import/require its source did not write', () => {
    for (const [typed] of STMT_PAIRS) {
      const { code } = compile(typed);
      expect(code).not.toMatch(/\brequire\s*\(/);
      expect(code.includes('import')).toBe(typed.includes('import'));
    }
  });
});

describe('s-expressions: erased statements carry stable trees', () => {
  test('type/interface declarations parse to erased type-decl statements (raw text as the value)', () => {
    expect(JSON.stringify(parser.parse('type ID = string\nx = 5').sexpr))
      .toBe(JSON.stringify(['program', ['type-decl', 'type ID = string'], ['=', 'x', '5']]));
    expect(JSON.stringify(parser.parse('export type Pair<A, B> = [A, B]').sexpr))
      .toBe(JSON.stringify(['program', ['type-decl', 'export type Pair<A, B> = [A, B]']]));
    expect(JSON.stringify(parser.parse('interface Q extends P\n  z: number').sexpr))
      .toBe(JSON.stringify(['program', ['type-decl', 'interface Q extends P\n  z: number']]));
  });

  test('bare declarations and class fields carry the erased typed wrapper', () => {
    expect(JSON.stringify(parser.parse('r: number\nr = 5').sexpr))
      .toBe(JSON.stringify(['program', ['typed-var', 'r', 'number'], ['=', 'r', '5']]));
    expect(JSON.stringify(parser.parse('class A\n  @x: number').sexpr))
      .toBe(JSON.stringify(['program', ['class', 'A', null, ['block', ['typed-var', ['.', 'this', 'x'], 'number']]]]));
    // The typed initialized field is the SAME node as its twin — the
    // annotation lives only in the side tables.
    expect(JSON.stringify(parser.parse('class A\n  x: number = 5').sexpr))
      .toBe(JSON.stringify(parser.parse('class A\n  x = 5').sexpr));
    expect(JSON.stringify(parser.parse('export x: number = 5').sexpr))
      .toBe(JSON.stringify(parser.parse('export x = 5').sexpr));
  });

  test('a user function named `typed` is never mistaken for the erased wrapper (hyphenated head — collision impossible)', () => {
    // The wrapper head is "typed-var" — not a spellable identifier —
    // so no user call can build the wrapper's shape; the call survives
    // every filter, including bare statement position.
    expect(compile('typed = (a, b) -> a\nr = typed(1, 2)\ntyped 3, 4').code)
      .toBe('let typed = function(a, b) {\n  return a;\n};\nlet r = typed(1, 2);\ntyped(3, 4);');
  });
});

describe('token fixtures: TYPE_DECL and bare-declaration tapes', () => {
  test('a type alias collapses to ONE token spanning the whole declaration', () => {
    const { tokens } = tokenize('type ID = string');
    expect(tokens.map((t) => t.kind)).toEqual(['TYPE_DECL']);
    expect(tokens[0].value).toBe('type ID = string');
    expect([tokens[0].start, tokens[0].end]).toEqual([0, 16]);
  });

  test('an exported interface folds the EXPORT token in; the value normalizes CRLF', () => {
    const src = 'export interface P\r\n  x: number\r\nz = 1';
    const { tokens } = tokenize(src);
    expect(tokens[0].kind).toBe('TYPE_DECL');
    expect(tokens[0].value).toBe('export interface P\n  x: number');
    expect(tokens[0].start).toBe(0);
    expect(src.slice(tokens[0].start, tokens[0].end)).toBe('export interface P\r\n  x: number');
  });

  test('a bare declaration leaves `IDENTIFIER TYPE` on the tape', () => {
    expect(tokenize('r: number\nr = 5').tokens.map((t) => t.kind).join(' '))
      .toBe('IDENTIFIER TYPE TERMINATOR IDENTIFIER = NUMBER');
    expect(tokenize('class A\n  x: number').tokens.map((t) => t.kind).join(' '))
      .toBe('CLASS IDENTIFIER INDENT IDENTIFIER TYPE OUTDENT');
    expect(tokenize('class A\n  @x: number').tokens.map((t) => t.kind).join(' '))
      .toBe('CLASS IDENTIFIER INDENT @ PROPERTY TYPE OUTDENT');
  });

  test('a generic close ends a declaration/field/alias line (the scanner-suppressed TERMINATOR)', () => {
    expect(tokenize('r: Map<K, V>\nr = m').tokens.map((t) => t.kind).join(' '))
      .toBe('IDENTIFIER TYPE TERMINATOR IDENTIFIER = IDENTIFIER');
    expect(tokenize('type T = Map<K, V>\nz = 1').tokens.map((t) => t.kind).join(' '))
      .toBe('TYPE_DECL TERMINATOR IDENTIFIER = NUMBER');
  });
});

describe('side tables: every erased declaration span lands', () => {
  test('type-decl node: semanticKind typedecl, declaration role spans the whole statement', () => {
    const src = 'type ID = string\nx = 5';
    const { stores } = compile(src);
    const [decl] = stores.nodesByKind('typedecl');
    expect(decl).toBeDefined();
    expect(src.slice(decl.sourceStart, decl.sourceEnd)).toBe('type ID = string');
    const role = stores.role(decl.nodeId, 'declaration');
    expect(src.slice(role.sourceStart, role.sourceEnd)).toBe('type ID = string');
  });

  test('bare declaration: a typedvar node with target and annotation roles', () => {
    const src = 'r: number\nr = 5';
    const { stores } = compile(src);
    const [typed] = stores.nodesByKind('typedvar');
    expect(src.slice(typed.sourceStart, typed.sourceEnd)).toBe('r: number');
    expect(src.slice(stores.role(typed.nodeId, 'target').sourceStart, stores.role(typed.nodeId, 'target').sourceEnd)).toBe('r');
    expect(src.slice(stores.role(typed.nodeId, 'annotation').sourceStart, stores.role(typed.nodeId, 'annotation').sourceEnd)).toBe(': number');
  });

  test('typed class field: the assign node owns a side-band annotation role', () => {
    const src = 'class A\n  x: number = 5';
    const { stores } = compile(src);
    const [assign] = stores.nodesByKind('assign');
    const role = stores.role(assign.nodeId, 'annotation');
    expect(role.childSlot).toBeNull();
    expect(src.slice(role.sourceStart, role.sourceEnd)).toBe(': number');
  });

  test('exported typed declaration: the ExportAssign node carries the label-recorded role', () => {
    const src = 'export x: number = 5';
    const { stores } = compile(src);
    const [assign] = stores.nodesByKind('assign');
    const role = stores.role(assign.nodeId, 'annotation');
    expect(role).not.toBeNull();
    expect(role.childSlot).toBeNull(); // dropped from the s-expression
    expect(src.slice(role.sourceStart, role.sourceEnd)).toBe(': number');
    // The untyped spelling carries ordinary assign roles too.
    const plain = compile('export x = 5');
    const [pa] = plain.stores.nodesByKind('assign');
    expect(plain.stores.role(pa.nodeId, 'target')).not.toBeNull();
  });
});

describe('mapping: erased statements round-trip as zero-width COVER rows', () => {
  test('type alias: an offset inside the declaration resolves to a zero-width cover', () => {
    const src = 'type ID = string\nx = 5';
    const { mappings } = compile(src);
    const row = mappings.bestAtSource(5); // inside `type ID = string`
    expect(row).not.toBeNull();
    expect(row.mappingKind).toBe('cover');
    expect(row.generatedStart).toBe(row.generatedEnd); // emits NOTHING
  });

  test('bare declaration: the annotation resolves to a zero-width cover', () => {
    const src = 'r: number\nr = 5';
    const { mappings } = compile(src);
    const row = mappings.bestAtSource(4); // inside `: number`
    expect(row.mappingKind).toBe('cover');
    expect(row.generatedStart).toBe(row.generatedEnd);
  });

  test('erased statements inside function bodies and branches still resolve', () => {
    for (const [src, offset] of [
      ['f = ->\n  type T = string\n  5', 12],
      ['x = if a\n  type T = string\n  1', 15],
      ['f = ->\n  r: number\n  r = g()\n  r', 12],
    ]) {
      const row = compile(src).mappings.bestAtSource(offset);
      expect(row).not.toBeNull();
      expect(row.mappingKind).toBe('cover');
      expect(row.generatedStart).toBe(row.generatedEnd);
    }
  });

  test('typed class field: the annotation covers the emitted field', () => {
    const src = 'class A\n  x: number = 5';
    const { code, mappings } = compile(src);
    const row = mappings.bestAtSource(13); // inside `: number`
    expect(row.role).toBe('annotation');
    expect(row.mappingKind).toBe('cover');
    expect(code.slice(row.generatedStart, row.generatedEnd)).toBe('x = 5');
  });

  test('bodiless typed field: the annotation covers the emitted name', () => {
    const src = 'class A\n  @x: number';
    const { code, mappings } = compile(src);
    const row = mappings.bestAtSource(15); // inside `: number`
    expect(row.role).toBe('annotation');
    expect(code.slice(row.generatedStart, row.generatedEnd)).toBe('static x');
  });

  test('exported typed declaration: the annotation covers the emitted const', () => {
    const src = 'export x: number = 5';
    const { code, mappings } = compile(src);
    const row = mappings.bestAtSource(10); // inside `: number`
    expect(row.role).toBe('annotation');
    expect(row.mappingKind).toBe('cover');
    expect(code.slice(row.generatedStart, row.generatedEnd)).toBe('const x = 5');
  });

  test('zero-width cover rows never serialize into the source map', () => {
    const { mappings } = compile('type ID = string\nr: number\nr = 5');
    for (const r of mappings.serializableRows()) {
      expect(r.generatedStart === r.generatedEnd && r.mappingKind === 'cover').toBe(false);
    }
  });
});

describe('composition: erased declarations leave running programs intact (eval)', () => {
  const evalOf = (src) => {
    const { code } = compile(src);
    return new Function(`${code}\nreturn r;`)();
  };

  test('type alias + bare declaration + typed def in one program', () => {
    expect(evalOf('type ID = number\ncount: ID\ncount = 2\ndef bump(n: number): number\n  n + count\nr = bump(3)')).toBe(5);
  });

  test('typed class fields initialize and methods read them', () => {
    expect(evalOf('class A\n  x: number = 5\n  m: -> @x + 1\na = new A()\nr = a.m()')).toBe(6);
    expect(evalOf('class B\n  @k: number = 7\nr = B.k')).toBe(7);
    expect(evalOf('class C\n  x: number\nc = new C()\nr = c.x == undefined')).toBe(true);
  });
});

describe('negative: malformed declarations reject loudly', () => {
  test('a type alias with no type after = is loud', () => {
    expect(() => tokenize('type Foo = ')).toThrow(/a type alias needs a type after '='/);
  });

  test('a type alias with trailing content is loud', () => {
    expect(() => tokenize('type ID = string if c')).toThrow(/a type alias must fill its line/);
    expect(() => tokenize('type X = A, B')).toThrow(/a type alias must fill its line/);
  });

  test('code-shaped content in type bodies rejects loudly, one-line and block alike', () => {
    const loud = (src) => expect(() => tokenize(src)).toThrow(/code expression \('.+'\) in a type body — types erase and cannot execute/);
    // One-line alias right-hand sides.
    loud('type X = f()');
    loud('type X = new Foo()');
    loud('type X = await x');
    loud('type X = a + b');
    loud('type X = a and b');
    loud('type X = foo.bar()');
    // Block alias bodies — code lines cannot hide in the indent.
    loud('type T =\n  z = sideEffect()');
    loud('type R =\n  | Ok\n  | f()');
    loud('type S =\n  kind: g()');
    // Interface members. Method shorthand (`m(x: number): void`) is
    // LEGAL in interfaces and in BLOCK alias bodies — but only whole:
    // a nested call inside the parameter list and a missing return
    // type stay loud; inline aliases still reject the spelling.
    loud('interface P\n  z = f()');
    loud('interface P\n  m(f(x)): void');
    loud('type X = m(x: number): void');
    expect(() => tokenize('interface P\n  m(x: number)')).toThrow(/method shorthand needs a return type/);
    expect(parser.parse('interface P\n  m(x: number): void\nz = 1').diagnostics).toEqual([]);
    expect(parser.parse('type X =\n  m(x: number): void\nz = 1').diagnostics).toEqual([]);
    // The vocabulary's carve-outs stay legal: negative literal
    // types, typeof, generic-parameter defaults.
    for (const ok of ['type X = -1\nz = 1', 'type K = typeof config\nz = 1', 'type G = Foo<T = U>\nz = 1']) {
      const r = parser.parse(ok);
      expect(r.diagnostics).toEqual([]);
    }
  });

  test('a type declaration is not a class member — loud with the real cause named', () => {
    const r = parser.parse('class A\n  type T = string');
    expect(r.diagnostics).toEqual([]);
    expect(() => emit(r, { source: 'class A\n  type T = string' })).toThrow(/type declarations are not allowed as class members/);
  });

  test('a bodiless interface stays the reserved-word rejection', () => {
    expect(() => tokenize('interface P')).toThrow(/'interface' is reserved/);
    expect(() => tokenize('interface P extends')).toThrow(/'interface' is reserved/);
  });

  test('interface generics parse and erase — malformed groups stay loud', () => {
    // A generic NAME (`interface P<T>`), a generic PARENT
    // (`extends Q<T>`), and both together claim as TYPE_DECL
    // statements — parsed, erased, span-recorded.
    for (const src of [
      'interface P<T>\n  x: T\nz = 1',
      'interface P extends Q<T>\n  x: number\nz = 1',
      'interface P<T extends string> extends Q<T>\n  x: T\nz = 1',
    ]) {
      const r = parser.parse(src);
      expect(r.diagnostics).toEqual([]);
      expect(r.sexpr[1][0]).toBe('type-decl');
      expect(compile(src).code).toBe(compile('z = 1').code);
    }
    // The plain forms parse, and generic types remain legal in MEMBER
    // positions.
    expect(parser.parse('interface Q extends P\n  z: number\nw = 1').diagnostics).toEqual([]);
    expect(parser.parse('interface P\n  x: Map<K, V>\nz = 1').diagnostics).toEqual([]);
    // An UNBALANCED generic group never claims — the reserved-word
    // rejection holds from the interface's own position.
    expect(() => tokenize('interface P<T\n  x: T')).toThrow(/'interface' is reserved/);
    expect(() => tokenize('interface P extends Q<\n  x: number')).toThrow(/unclosed|'interface' is reserved/);
  });

  test('an exported bare declaration has no form — loud', () => {
    const r = parser.parse('export r: number\nr = 5');
    expect(r.sexpr).toBeNull();
    expect(r.diagnostics).not.toHaveLength(0);
  });

  test('generic defs and optional params parse', () => {
    // Generic def params are live: TYPE_PARAMS drops as the side-band
    // typeParams role and the TS face re-emits it after the name.
    const g = parser.parse('def id<T>(v: T)\n  v');
    expect(g.diagnostics).toEqual([]);
    expect(JSON.stringify(g.sexpr)).toContain('"def"');
    // Optional params are live: annotated and bare, def and arrow —
    // the wrapper is a typed-var (empty annotation for the bare form)
    // with the OPT_MARKER dropped as the side-band optionalMarker role.
    for (const src of ['f = (a?: number) -> a', 'def f(a?: number)\n  a', 'def g(a: number, b?)\n  a']) {
      const r = parser.parse(src);
      expect(r.diagnostics).toEqual([]);
      expect(JSON.stringify(r.sexpr)).toContain('"typed-var"');
    }
  });

  test('optional params emit the TS-only `?` and erase from JS', () => {
    const ts = emit(parser.parse('def f(a?: number)\n  a'), { source: 'def f(a?: number)\n  a', face: 'ts' }).code;
    expect(ts).toContain('function f(a?: number)');
    expect(compile('def f(a?: number)\n  a\nf()').code).toContain('function f(a)');
    expect(compile('def g(b?)\n  b\ng()').code).toContain('function g(b)');
  });

  test('a variable named `type` keeps every non-alias reading', () => {
    // No name, no `=`: the implicit call and member readings survive.
    expect(compile('type = 5').code).toBe('let type = 5;');
    expect(compile('x = type ID').code).toBe('let x = type(ID);');
    expect(compile('t = {type: 1}').code).toBe('let t = {type: 1};');
  });
});

describe('statement-erasure pins: aliases, empty blocks, generic tails', () => {
  test('only clean aliases erase — a clean alias erases to nothing (junk spellings are loud, pinned above)', () => {
    expect(compile('type X = 5\nz = 1').code).toBe('let z = 1;');
  });

  test('a block whose every statement erases compiles to an empty block', () => {
    expect(compile('if c\n  type T = string\ny = 2').code).toBe('if (c) {\n}\nlet y = 2;');
  });

  test('a block-body TAIL ending in a generic close ends the body — the next statement survives', () => {
    // A `>` ending an indented type body's LAST line must not swallow
    // the dedent — a glue there would erase the next statement
    // silently when it fit the type vocabulary, or reject it falsely
    // when it did not. Every follower survives, whatever its shape:
    expect(compile('type T =\n  Map<K, V>\nobj.method\ny = 2').code)
      .toBe('obj.method;\nlet y = 2;');
    expect(compile('type T =\n  Map<K, V>\nx: number\ny = 2').code)
      .toBe('({x: number});\nlet y = 2;');
    expect(compile('type T =\n  Map<K, V>\ntype U = string\nz = 1').code)
      .toBe('let z = 1;');
    // Nested context: the body's tail also releases its enclosing
    // OUTDENTs.
    expect(compile('if c\n  type T =\n    | Ok<T>\ny = 2').code)
      .toBe('if (c) {\n}\nlet y = 2;');
    // The tail's tape: one TYPE_DECL, then the next statement.
    expect(tokenize('type R =\n  | Ok<T>\ny = 2').tokens.map((t) => t.kind).join(' '))
      .toBe('TYPE_DECL TERMINATOR IDENTIFIER = NUMBER');
  });

  test('wrapped generics: a tail generic spanning body LINES still ends the body', () => {
    // The tail classifier must not bail at a line boundary with
    // unbalanced angles — the type-body floor answers O(1) for
    // anything at or beyond a `type … =`/`interface` body indent,
    // wraps included. The silent-erasure shape (follower fits the
    // vocabulary):
    expect(compile('type T =\n  Map<K,\n  V>\nobj.method\ny = 2').code)
      .toBe('obj.method;\nlet y = 2;');
    // Glued bare-decl shape: the follower claims (and erases) as its
    // own statement, never as body text.
    expect(compile('type T =\n  Map<K,\n  V>\nr: number\nr = 5').code)
      .toBe('let r = 5;');
    // False-rejection shape: union-variant wraps compile clean (both
    // byte-asserted against their twins in the gate).
    expect(compile('type R =\n  | Ok<A,\n  B>\ny = 2').code).toBe('let y = 2;');
    expect(compile('type T =\n  A<B<K,\n  V>>\ny = 2').code).toBe('let y = 2;');
    // Value-position wrapped generics keep their prior loud reading —
    // the floor never covers ordinary code.
    expect(parser.parse('x = a<b,\n c>').sexpr).toBeNull();
    expect(parser.parse('foo a<b,\n c>').sexpr).toBeNull();
  });

  test('a generic bodiless field ends its line — the next statement never joins the type', () => {
    // A glue here would absorb the def's body as a second field
    // (`class A { x; w; }` — the def GONE). The field line ends at
    // the generic close.
    expect(compile('class A\n  x: Map<K, V>\ndef f(w)\n  w').code)
      .toBe('class A {\n  x;\n}\nfunction f(w) {\n  return w;\n}');
    // The declaration spelling of the same glue: `r: Map<K, V>` and
    // the next line stay separate lines — the forward claims on its
    // later assignment and the follower survives.
    expect(compile('r: Map<K, V>\nr = m\nz = 1').code).toBe('let r = m;\nlet z = 1;');
  });

  test('field/method mixes and bare static fields compile to valid JS', () => {
    // Interleaved fields and methods stay ONE class body (byte-asserted
    // in the gate; shape pinned here once).
    expect(compile('class A\n  x: number = 5\n  m: -> @x').code)
      .toBe('class A {\n  x = 5;\n  m() {\n    return this.x;\n  }\n}');
    // A bare static typed field emits a real static member.
    expect(compile('class A\n  @x: number').code).toBe('class A {\n  static x;\n}');
  });
});

// ════════════════════════════════════════════════════════════════════
// Structured-type validation — junk-type spellings an opaque-string
// model would tolerate are loud rejections in type/interface bodies.
// ════════════════════════════════════════════════════════════════════

describe('structured-type validation', () => {
  test('nonsense arithmetic in an alias is loud: the minus exemption is PREFIX-only', () => {
    expect(() => tokenize('type X = 5 - 3')).toThrow(/code expression \('-'\) in a type body/);
    expect(() => tokenize('type X = A - 1')).toThrow(/code expression \('-'\) in a type body/);
    // Negative LITERAL types stay legal in every prefix position.
    for (const ok of ['type X = -1\nz = 1', 'type X = -1 | -2\nz = 1', 'type P = [-1, 2]\nz = 1']) {
      expect(parser.parse(ok).diagnostics).toEqual([]);
    }
  });

  test('unbalanced angle brackets in a type body are loud', () => {
    expect(() => tokenize('type R =\n  | Ok\n  a >\nz = 1')).toThrow(/unbalanced '>' in a type body/);
    expect(() => tokenize('interface P\n  x: number\n  a >\nz = 1')).toThrow(/unbalanced '>' in a type body/);
    expect(() => tokenize('type T =\n  Map<K\ny = 2')).toThrow(/unclosed '<' in a type body/);
    // Balanced spellings — wraps, `>>` closes, strings with angles —
    // stay legal (re-pinned here at the boundary).
    for (const ok of ['type W =\n  | Wrap<Inner<K>>\ny = 2', 'type S = "a>b" | C<D>\nz = 1', 'type T =\n  Map<K,\n  V>\ny = 2']) {
      expect(parser.parse(ok).diagnostics).toEqual([]);
    }
  });

  test('template-literal types reject with a type-positioned message', () => {
    expect(() => tokenize('type T = `a${B}`')).toThrow(/template-literal types are not supported/);
    expect(() => tokenize('type T =\n  `a`')).toThrow(/template-literal types are not supported/);
    // Value-position backticks keep the raw rejection — the message is
    // for TYPE positions only.
    expect(() => tokenize('x = `nope`')).toThrow(/cannot tokenize '`'/);
  });

  test('interface method shorthand parses, erases, and stays interface-only', () => {
    // Erasure and byte-parity ride the STMT_PAIRS gate; the tape here:
    // one TYPE_DECL carrying the raw text, method included.
    const { tokens } = tokenize('interface P\n  m(x: number): void\nz = 1');
    expect(tokens[0].kind).toBe('TYPE_DECL');
    expect(tokens[0].value).toBe('interface P\n  m(x: number): void');
  });
});

// ════════════════════════════════════════════════════════════════════
// Class generics reject loudly — `class Box<T>` would read its `<` as
// a comparison and the chained-comparison lowering would compile the
// head to garbage (`(class Box {} < T) && (T > {…})`): the silent-
// miscompile class the rules forbid.
// ════════════════════════════════════════════════════════════════════

describe('class-head generics reject loudly, positioned at the `<`', () => {
  test('the named head: class Box<T>', () => {
    const src = 'class Box<T>\n  x: T\n';
    let err = null;
    try { tokenize(src); } catch (e) { err = e; }
    expect(err?.message).toMatch(/class generics are not supported/);
    expect(err.start).toBe(src.indexOf('<'));
  });

  test('the generic parent: extends Base<T>', () => {
    const src = 'class Box extends Base<T>\n  x = 1\n';
    let err = null;
    try { tokenize(src); } catch (e) { err = e; }
    expect(err?.message).toMatch(/class generics are not supported/);
    expect(err.start).toBe(src.indexOf('<'));
  });

  test('the expression form: x = class Inner<T>', () => {
    const src = 'x = class Inner<T>\n';
    let err = null;
    try { tokenize(src); } catch (e) { err = e; }
    expect(err?.message).toMatch(/class generics are not supported/);
    expect(err.start).toBe(src.indexOf('<'));
  });

  test('the spaced spelling rejects identically (class Box < T was an unpositioned parse error)', () => {
    const src = 'class Box < T\n  x = 1\n';
    let err = null;
    try { tokenize(src); } catch (e) { err = e; }
    expect(err?.message).toMatch(/class generics are not supported/);
    expect(err.start).toBe(src.indexOf('<'));
  });

  test('legal `<` near a class stays legal: clause conditions, then-forms, parenthesized comparison', () => {
    for (const ok of [
      'x = class A if a < b\n',
      'x = if a < b then class A else class B\n',
      'y = (class Box) < T\n',
      'class A\n  m: (v) -> v < 2\n',
    ]) {
      expect(parser.parse(ok).diagnostics).toEqual([]);
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// The sibling-run claim — adjacent statement-level `name:` lines
// decide as ONE unit. Full evidence (every line a complete TYPE, every
// name assigned later in the block, the run non-tail) claims every
// member as a typed forward; partial evidence rejects loudly; anything
// else keeps the implicit-object reading.
// ════════════════════════════════════════════════════════════════════

describe('sibling runs of bare typed forwards claim all-or-nothing', () => {
  test('the repro family: 2-line and 3-line runs claim as typed forwards', () => {
    expect(compile('a: number\nb: string\na = 1\nb = "x"').code)
      .toBe('let a = 1;\nlet b = "x";');
    expect(compile('a: number\nb: string\nc: boolean\na = 1\nb = "x"\nc = true').code)
      .toBe('let a = 1;\nlet b = "x";\nlet c = true;');
  });

  test('blank lines and comments do not sever a run (the scanner collapses them into one TERMINATOR)', () => {
    expect(compile('a: number\n\nb: string\na = 1\nb = "x"').code)
      .toBe('let a = 1;\nlet b = "x";');
    expect(compile('a: number\n# note\nb: string\na = 1\nb = "x"').code)
      .toBe('let a = 1;\nlet b = "x";');
  });

  test('generic, union, and literal-type members claim (the generic pair was a misleading parse error)', () => {
    // Without the run claim, a sibling guard would block BOTH lines
    // and the object reading would choke on the generic's comma — an
    // unpositioned parse error for a legal-looking pair of forwards.
    expect(compile('a: Map<string, number>\nb: Set<number>\na = new Map\nb = new Set').code)
      .toBe('let a = new Map();\nlet b = new Set();');
    expect(compile('a: number | string\nb: string\na = 1\nb = "x"').code)
      .toBe('let a = 1;\nlet b = "x";');
    // Literal types follow the single-line precedent (`x: 1` claims).
    expect(compile('a: 1\nb: 2\na = 3\nb = 4').code)
      .toBe('let a = 3;\nlet b = 4;');
  });

  test('typed declaration lines separate runs without joining them — bare forwards interleave freely, both orders', () => {
    expect(compile('a: number\nb: string = "s"\na = 1').code)
      .toBe('let b = "s";\nlet a = 1;');
    expect(compile('b: string = "s"\na: number\na = 1').code)
      .toBe('let b = "s";\nlet a = 1;');
  });

  test('runs claim inside statement blocks: if bodies, switch arms', () => {
    expect(compile('if c\n  a: number\n  b: string\n  a = 1\n  b = "x"').code)
      .toBe('let a, b;\n\nif (c) {\n  a = 1;\n  b = "x";\n}');
    expect(compile('switch v\n  when 1\n    a: number\n    b: string\n    a = 1\n    b = "x"').code)
      .toBe('let a, b;\n\nswitch (v) {\n  case 1:\n    a = 1;\n    b = "x";\n    break;\n}');
  });

  test('forwards whose type names are in-scope VALUE variables still claim (the accepted false-positive class)', () => {
    // The object reading (`({a: number, b: string})` with number and
    // string bound) is dead code by construction — statement-level,
    // non-tail, value discarded. Zero occurrences across the corpus;
    // the acceptance is deliberate.
    expect(compile('number = 1\nstring = 2\na: number\nb: string\na = 3\nb = 4').code)
      .toBe('let number = 1;\nlet string = 2;\nlet a = 3;\nlet b = 4;');
  });

  test('a real statement between forwards still severs the run (each line claims alone, as before)', () => {
    expect(compile('a: number\n0\nb: string\na = 1\nb = "x"').code)
      .toBe('0;\nlet a = 1;\nlet b = "x";');
  });

  test('genuine object literals keep every legal home: value indents, implicit returns, call blocks, parens, braces', () => {
    // `=`-indented body (a VALUE indent, never a candidate).
    expect(compile('x =\n  a: number\n  b: string\nnumber = 1').code)
      .toBe('let number;\n\nlet x = {a: number, b: string};\nnumber = 1;');
    // Implicit return: the run's last line is the block's tail.
    expect(compile('f = ->\n  a: number\n  b: string').code)
      .toBe('let f = function() {\n  return {a: number, b: string};\n};');
    // Call-argument block: evidence is block-scoped, so outer
    // assignments never bind the run — the object survives.
    expect(compile('configure\n  a: number\n  b: string\na = 1\nb = 2').code)
      .toBe('configure({a: number, b: string});\nlet a = 1;\nlet b = 2;');
    // The disambiguating spellings: parenthesize or brace explicitly.
    expect(compile('(a: 1\nb: 2)\na = 3\nb = 4').code)
      .toBe('({a: 1, b: 2});\nlet a = 3;\nlet b = 4;');
    expect(compile('{a: number, b: string}\na = 1\nb = 2').code)
      .toBe('({a: number, b: string});\nlet a = 1;\nlet b = 2;');
  });

  test('tail runs stay implicit-value objects — at a block end and at file end', () => {
    expect(compile('a = 1\na: number\nb: string').code)
      .toBe('let a = 1;\n({a: number, b: string});');
    expect(compile('f = ->\n  a = 1\n  a: number\n  b: string').code)
      .toBe('let f = function() {\n  let a = 1;\n  return {a: number, b: string};\n};');
  });

  test('runs with NO forward evidence stay objects (no type-shaped member, or no assigned name)', () => {
    // Value-shaped members: unambiguously an object.
    expect(compile('a: f()\nb: g()\na = 1\nb = 2').code)
      .toBe('({a: f(), b: g()});\nlet a = 1;\nlet b = 2;');
    // Type-shaped but never assigned: the forward reading has no
    // support — the object reading stands (loud at runtime and in the
    // editor face, as before).
    expect(compile('a: number\nb: string\nc = 0').code)
      .toBe('({a: number, b: string});\nlet c = 0;');
  });

  test('partial evidence rejects loudly, positioned at the first evidence-less member: a name never assigned', () => {
    const src = 'a: number\nb: string\na = 1';
    let err = null;
    try { tokenize(src); } catch (e) { err = e; }
    expect(err?.message).toMatch(/adjacent 'name:' lines are ambiguous/);
    expect(err?.message).toMatch(/'b' is never assigned in this block/);
    expect(err?.message).toMatch(/add an initializer/);
    expect(err?.message).toMatch(/parenthesize the literal/);
    expect(err.start).toBe(src.indexOf('b: string'));
  });

  test('partial evidence rejects loudly: a member whose value is not a type', () => {
    const src = 'a: number\nb: g()\na = 1\nb = 2';
    let err = null;
    try { tokenize(src); } catch (e) { err = e; }
    expect(err?.message).toMatch(/adjacent 'name:' lines are ambiguous/);
    expect(err?.message).toMatch(/the value after 'b:' is not a type/);
    expect(err.start).toBe(src.indexOf('b: g()'));
  });

  test('partial evidence rejects loudly: evidence severed at a closure boundary', () => {
    // `x` is assigned only inside a multi-line closure — never
    // evidence (the INDENT-scoped contract) — while `y` is assigned
    // at the statement level: a mixed run.
    const src = 'x: number\ny: number\ng = ->\n  x = 5\ny = 1';
    let err = null;
    try { tokenize(src); } catch (e) { err = e; }
    expect(err?.message).toMatch(/'x' is never assigned in this block/);
    expect(err.start).toBe(0);
  });

  test('the rejection reaches both faces (one lexer, one discipline)', () => {
    const { compile: fullCompile } = require('../../src/compile.js');
    for (const face of ['js', 'ts']) {
      let err = null;
      try { fullCompile('a: number\nb: string\na = 1', { runtimeDelivery: 'none', face }); } catch (e) { err = e; }
      expect(err?.message).toMatch(/ambiguous/);
    }
  });

  test('clause-guarded lines disqualify the run — the guarded object statement survives, never a rejection', () => {
    // A postfix clause on a `name:` line is a legal GUARDED object
    // statement, not a bare typed forward: the member disqualifies
    // the whole run (all-or-nothing → object reading), even when a
    // type-shaped assigned neighbor would otherwise make the
    // evidence look partial. All bytes pinned to the plain object
    // reading.
    expect(compile('a: number if c\nb: string\na = 1\nb = "x"').code)
      .toBe('({a: (c ? number : undefined), b: string});\nlet a = 1;\nlet b = "x";');
    expect(compile('a: number unless c\nb: string\na = 1\nb = "x"').code)
      .toBe('({a: (!c ? number : undefined), b: string});\nlet a = 1;\nlet b = "x";');
    // Guard in the middle of a run.
    expect(compile('a: number\nb: string if c\nd: boolean\na = 1\nd = true').code)
      .toBe('({a: number, b: (c ? string : undefined), d: boolean});\nlet a = 1;\nlet d = true;');
    // Guard on the run's last line.
    expect(compile('a: number\nb: string if c\na = 1\nb = "x"').code)
      .toBe('({a: number, b: (c ? string : undefined)});\nlet a = 1;\nlet b = "x";');
  });

  test('compound assignment is not evidence — a mixed `=`/`+=`-only run rejects loudly (the predicate is `=`-only)', () => {
    // buildAssignIndex registers `name =` bindings only: compound
    // assignment, destructuring, and for-bindings are deliberately
    // not evidence. `b += 2` therefore leaves `b` evidence-less and
    // the run is partial.
    const src = 'a: number\nb: number\na = 1\nb += 2';
    let err = null;
    try { tokenize(src); } catch (e) { err = e; }
    expect(err?.message).toMatch(/'b' is never assigned in this block/);
    expect(err.start).toBe(src.indexOf('b: number'));
  });

  test('single lines are a run of one — the pinned single-forward behavior is unchanged', () => {
    // Full evidence claims, no evidence stays object, and a lone
    // type-shaped-but-unassigned line NEVER rejects (a run of one
    // carries no mixed evidence).
    expect(compile('r: number\nr = 5').code).toBe('let r = 5;');
    expect(compile('r: number').code).toBe('({r: number});');
    expect(compile('r: number\nz = 1').code).toBe('({r: number});\nlet z = 1;');
  });

  test('string-key neighbors never join a name-keyed run', () => {
    // `"lit": v` never sets the sibling flag, so the bare forward
    // next to it claims on its own evidence.
    expect(compile('"lit": v\nb: string\nb = "s"').code)
      .toBe('({"lit": v});\nlet b = "s";');
  });
});

describe('nested array types across the annotation surface', () => {
  // The schema DSL rejects nested array field types (`tags! string[][]`)
  // by design — one `[]` validates element-wise. The TYPE-ANNOTATION
  // surface has no such gap: `T[][]` renders through the shared
  // typetext renderer in every position — pinned here so the two
  // records never blur.
  test('typed declarations and forwards erase byte-identically with nested array types', () => {
    expect(compile('x: string[][] = []').code).toBe(compile('x = []').code);
    expect(compile('y: number[][]\ny = []').code).toBe(compile('y = []').code);
  });

  test('aliases, interfaces, params, and returns carry T[][] through the renderer', () => {
    // No rejection, full erasure in JS mode.
    const src = 'type Grid = string[][]\ninterface I\n  rows: number[][]\n  m(x: number[][]): void\ndef f(m: string[][]): number[][]\n  m\ng: Grid = []';
    const { code } = compile(src);
    expect(code).not.toContain('[][]');
    expect(code).toContain('function f(m)');
  });

  test('the schema-DSL rejection stands: one [] validates element-wise, deeper nesting rejects', () => {
    expect(() => tokenize('X = schema :shape\n  tags! string[][]'))
      .toThrow(/nested array types.*are not supported/);
  });
});
