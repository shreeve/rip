// Every RoleStore role of every emitted construct maps source span →
// generated span AND back, exactly, with zero string searching — plus
// the generated-span invariants.
import { describe, test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import parser from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { emit } from '../../src/emitter.js';
import { Stores, Mappings } from '../../src/stores.js';

parser.lexer = makeParserLexer();

const compile = (src) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  const { code, mappings } = emit(r, { source: src });
  return { code, rows: mappings, mappings: new Mappings(mappings), stores: new Stores(r.stores) };
};

const corpusDir = join(import.meta.dir, '../corpus');
const corpusFiles = readdirSync(corpusDir).filter(f => f.endsWith('.rip')).sort();

describe('x = y + 1 maps bidirectionally', () => {
  const src = 'x = y + 1';
  const { code, mappings, stores } = compile(src);
  const [assign] = stores.nodesByKind('assign');
  const [binary] = stores.nodesByKind('binary');

  test('emitted code declares in place', () => {
    expect(code).toBe('let x = y + 1;');
  });

  test('assign.target has ONE exact row: the declaring statement (declare-in-place)', () => {
    const rows = mappings.of(assign.nodeId, 'target');
    expect(rows).toHaveLength(1);
    expect([rows[0].generatedStart, rows[0].generatedEnd]).toEqual([4, 5]); // `x` in `let x = y + 1;`
    expect([rows[0].sourceStart, rows[0].sourceEnd]).toEqual([0, 1]);
    expect(rows[0].mappingKind).toBe('exact');
  });

  test('a HOISTED binding keeps TWO ordered target rows: hoisted declaration + assignment (one-to-many)', () => {
    // A branch-first write stays hoisted, preserving the one-to-many
    // contract this suite pins.
    const hoisted = compile('if y\n  x = 1');
    expect(hoisted.code).toBe('let x;\n\nif (y) {\n  x = 1;\n}');
    const [hAssign] = hoisted.stores.nodesByKind('assign');
    const rows = hoisted.mappings.of(hAssign.nodeId, 'target');
    expect(rows).toHaveLength(2);
    expect([rows[0].generatedStart, rows[0].generatedEnd]).toEqual([4, 5]);   // `x` in `let x;`
    expect(hoisted.code.slice(rows[1].generatedStart, rows[1].generatedEnd)).toBe('x'); // `x` in the branch
    for (const r of rows) expect(r.mappingKind).toBe('exact');
  });

  // Every role of both nodes, with generated spans: (nodeId, role, row
  // index) → [sourceSpan, generatedSpan, kind, generated slice].
  const expected = () => [
    [assign.nodeId, '$self',    0, [0, 9], [4, 13],  'exact',     'x = y + 1'],
    [assign.nodeId, 'target',   0, [0, 1], [4, 5],   'exact',     'x'],
    [assign.nodeId, 'operator', 0, [0, 0], [6, 7],   'synthetic', '='],
    [assign.nodeId, 'value',    0, [4, 9], [8, 13],  'exact',     'y + 1'],
    [binary.nodeId, '$self',    0, [4, 9], [8, 13],  'exact',     'y + 1'],
    [binary.nodeId, 'left',     0, [4, 5], [8, 9],   'exact',     'y'],
    [binary.nodeId, 'operator', 0, [4, 4], [10, 11], 'synthetic', '+'],
    [binary.nodeId, 'right',    0, [8, 9], [12, 13], 'exact',     '1'],
  ];

  test.each(expected())('node %i role %s row %i: source %p → generated %p (%s)', (nodeId, role, idx, srcSpan, genSpan, kind, slice) => {
    const row = mappings.of(nodeId, role)[idx];
    expect([row.sourceStart, row.sourceEnd]).toEqual(srcSpan);
    expect([row.generatedStart, row.generatedEnd]).toEqual(genSpan);
    expect(row.mappingKind).toBe(kind);
    expect(code.slice(row.generatedStart, row.generatedEnd)).toBe(slice);
  });

  test('source → generated: offset lookups land on the right roles', () => {
    // src 4 = `y`: innermost is binary.left.
    const atY = mappings.atSource(4)[0];
    expect([atY.nodeId, atY.role]).toEqual([binary.nodeId, 'left']);
    // src 8 = `1`: innermost is binary.right.
    const atOne = mappings.atSource(8)[0];
    expect([atOne.nodeId, atOne.role]).toEqual([binary.nodeId, 'right']);
    // src 0 = `x`: innermost is assign.target.
    const atX = mappings.atSource(0)[0];
    expect([atX.nodeId, atX.role]).toEqual([assign.nodeId, 'target']);
  });

  test('generated → source: offset lookups land on the right roles', () => {
    const atY = mappings.atGenerated(8)[0];
    expect([atY.nodeId, atY.role, atY.sourceStart, atY.sourceEnd]).toEqual([binary.nodeId, 'left', 4, 5]);
    const atEq = mappings.atGenerated(6)[0];
    expect([atEq.nodeId, atEq.role, atEq.mappingKind]).toEqual([assign.nodeId, 'operator', 'synthetic']);
    const atOne = mappings.atGenerated(12)[0];
    expect([atOne.nodeId, atOne.role, atOne.sourceStart, atOne.sourceEnd]).toEqual([binary.nodeId, 'right', 8, 9]);
  });
});

describe('construct by construct: spans, grouping, and lowerings', () => {
  test('object spread with a call head: splat and inner call map with exact slices', () => {
    const src = 'x = { ...f(k), a: 2 }';
    const { code, mappings, stores } = compile(src);
    expect(code).toBe('let x = {...f(k), a: 2};'); // locals declare in place
    const [splat] = stores.nodesByKind('splat');
    const [call] = stores.nodesByKind('call');
    for (const [nodeId, role, srcSpan, genSpan, kind, slice] of [
      [splat.nodeId, '$self',  [6, 13],  [9, 16],  'exact', '...f(k)'],
      [splat.nodeId, 'value',  [9, 13],  [12, 16], 'exact', 'f(k)'],
      [call.nodeId,  '$self',  [9, 13],  [12, 16], 'exact', 'f(k)'],
      [call.nodeId,  'callee', [9, 10],  [12, 13], 'exact', 'f'],
      [call.nodeId,  'args',   [10, 13], [13, 16], 'exact', '(k)'],
    ]) {
      const row = mappings.of(nodeId, role)[0];
      expect([row.sourceStart, row.sourceEnd]).toEqual(srcSpan);
      expect([row.generatedStart, row.generatedEnd]).toEqual(genSpan);
      expect(row.mappingKind).toBe(kind);
      expect(code.slice(row.generatedStart, row.generatedEnd)).toBe(slice);
      expect(src.slice(row.sourceStart, row.sourceEnd)).toBe(slice.replace('{...', '{ ...'));
    }
  });

  test('def: name/params/body + return value map with exact slices', () => {
    const src = 'def add(a, b)\n  return a + b';
    const { code, mappings, stores } = compile(src);
    expect(code).toBe('function add(a, b) {\n  return (a + b);\n}');
    const [def] = stores.nodesByKind('def');
    const name = mappings.of(def.nodeId, 'name')[0];
    expect(code.slice(name.generatedStart, name.generatedEnd)).toBe('add');
    expect(name.mappingKind).toBe('exact');
    const params = mappings.of(def.nodeId, 'params')[0];
    expect(code.slice(params.generatedStart, params.generatedEnd)).toBe('(a, b)');
    expect([params.sourceStart, params.sourceEnd]).toEqual([7, 13]);
    expect(params.mappingKind).toBe('exact');
    const body = mappings.of(def.nodeId, 'body')[0];
    expect(code.slice(body.generatedStart, body.generatedEnd)).toBe('{\n  return (a + b);\n}');
    expect(body.mappingKind).toBe('cover');
    const [ret] = stores.nodesByKind('return');
    const value = mappings.of(ret.nodeId, 'value')[0];
    expect(code.slice(value.generatedStart, value.generatedEnd)).toBe('a + b'); // parens sit outside the mark
    expect(value.mappingKind).toBe('exact');
    expect([value.sourceStart, value.sourceEnd]).toEqual([23, 28]);
  });

  test('call: callee + ONE spread-extent row for args', () => {
    const src = 'add(1, 2)';
    const { code, mappings, stores } = compile(src);
    expect(code).toBe('add(1, 2);');
    const [call] = stores.nodesByKind('call');
    const callee = mappings.of(call.nodeId, 'callee')[0];
    expect(code.slice(callee.generatedStart, callee.generatedEnd)).toBe('add');
    const args = mappings.of(call.nodeId, 'args');
    expect(args).toHaveLength(1); // granularity decision: one row per spread role
    expect(code.slice(args[0].generatedStart, args[0].generatedEnd)).toBe('(1, 2)');
    expect([args[0].sourceStart, args[0].sourceEnd]).toEqual([3, 9]);
    expect(args[0].mappingKind).toBe('exact'); // verbatim argument list
  });

  test('member: object/property exact, "." synthetic', () => {
    const { code, mappings, stores } = compile('obj.prop');
    expect(code).toBe('obj.prop;');
    const [member] = stores.nodesByKind('member');
    const object = mappings.of(member.nodeId, 'object')[0];
    const property = mappings.of(member.nodeId, 'property')[0];
    const operator = mappings.of(member.nodeId, 'operator')[0];
    expect(code.slice(object.generatedStart, object.generatedEnd)).toBe('obj');
    expect(code.slice(property.generatedStart, property.generatedEnd)).toBe('prop');
    expect([operator.mappingKind, code.slice(operator.generatedStart, operator.generatedEnd)]).toEqual(['synthetic', '.']);
  });

  test('if/else: condition exact; then/else cover the lowered braces', () => {
    const src = 'if a\n  b\nelse\n  c';
    const { code, mappings, stores } = compile(src);
    expect(code).toBe('if (a) {\n  b;\n} else {\n  c;\n}');
    const [ifNode] = stores.nodesByKind('if');
    const cond = mappings.of(ifNode.nodeId, 'condition')[0];
    expect([cond.mappingKind, code.slice(cond.generatedStart, cond.generatedEnd)]).toEqual(['exact', 'a']);
    const then = mappings.of(ifNode.nodeId, 'then')[0];
    expect([then.mappingKind, code.slice(then.generatedStart, then.generatedEnd)]).toEqual(['cover', '{\n  b;\n}']);
    const els = mappings.of(ifNode.nodeId, 'else')[0];
    expect([els.mappingKind, code.slice(els.generatedStart, els.generatedEnd)]).toEqual(['cover', 'else {\n  c;\n}']);
  });

  test('parenthesized operations keep grouping in member/call position', () => {
    // The grouping parens are emitter-produced characters outside the
    // role marks, so the object/callee roles stay honest.
    const src = '(x + y).z';
    const { code, mappings, stores } = compile(src);
    expect(code).toBe('(x + y).z;');
    const [member] = stores.nodesByKind('member');
    const object = mappings.of(member.nodeId, 'object')[0];
    expect(code.slice(object.generatedStart, object.generatedEnd)).toBe('x + y');
    expect([object.sourceStart, object.sourceEnd]).toEqual([0, 7]); // source `(x + y)` incl. parens
    expect(object.mappingKind).toBe('cover');

    const call = compile('(a + b)(c)');
    expect(call.code).toBe('(a + b)(c);');
    const [callNode] = call.stores.nodesByKind('call');
    const callee = call.mappings.of(callNode.nodeId, 'callee')[0];
    expect(call.code.slice(callee.generatedStart, callee.generatedEnd)).toBe('a + b');
    expect(callee.mappingKind).toBe('cover');

    expect(compile('((a + b))(c).d').code).toBe('(a + b)(c).d;');
  });

  test('statement-position object literals group — bare braces would be a block', () => {
    for (const src of ['{1: "one"}', '{"two": 2}', '{a: f()}']) {
      new Function(compile(src).code); // must parse as JS
    }
    expect(compile('{1: "one"}').code).toBe('({1: "one"});');
  });

  test('arrow → braced object → comprehension compiles and evals', () => {
    const src = 'f = ->\n  {a: (n for n in [1..2])}\ng = f()';
    const { code } = compile(src);
    new Function(code);
    const out = new Function(`${code}\nreturn g;`)();
    expect(out).toEqual({ a: [1, 2] });
  });

  test('switch-case body ending in a bare -> groups validly', () => {
    const src = 'switch x\n  when 1\n    ->\n      5';
    const { code } = compile(src);
    new Function(code);
    expect(code).toContain('(function() {');
  });

  test('a postfix-if inside a when body keeps the statement form', () => {
    // A postfix-if inside a when body lowers to the plain statement
    // form (`if (b) a = 1;`), not a ternary — the simpler shape.
    const src = 'a = 0\nb = true\nswitch 1\n  when 1\n    a = 1 if b';
    const { code } = compile(src);
    expect(code).toContain('if (b) a = 1;');
    expect(new Function(`${code}\nreturn a;`)()).toBe(1);
  });

  test('interpolated expressions map bidirectionally with real source spans', () => {
    const src = 'x = "a#{b}c"';
    const { code, mappings, stores } = compile(src);
    expect(code).toBe('let x = `a${b}c`;'); // locals declare in place
    // The interpolation chunk (a Body node) has an honest source span
    // over `b` and a generated span inside ${…}.
    const chunk = stores.nodes.find(n => src.slice(n.sourceStart, n.sourceEnd) === 'b');
    expect(chunk).toBeDefined();
    const row = mappings.of(chunk.nodeId, '$self')[0];
    expect(code.slice(row.generatedStart, row.generatedEnd)).toBe('b');
    expect(row.mappingKind).toBe('exact');
    // Both directions through the query policy.
    const gen = mappings.bestAtSource(row.sourceStart);
    expect(gen.nodeId).toBe(chunk.nodeId);
    const back = mappings.bestAtGenerated(row.generatedStart);
    expect(back.nodeId).toBe(chunk.nodeId);
  });

  test('nested inline-then binds else to the nearest if', () => {
    const src = 'if a then if b then c else d';
    const r = parser.parse(src);
    expect(r.diagnostics).toEqual([]);
    // else belongs to the inner if (the JS convention).
    expect(JSON.stringify(r.sexpr)).toBe(JSON.stringify(
      ['program', ['if', 'a', ['block', ['if', 'b', ['block', 'c'], ['block', 'd']]]]],
    ));
  });

  test('own+guard keeps the hasOwn filter', () => {
    // A single-variable `own` loop with a guard keeps the Object.hasOwn
    // filter — the guard must not silently drop the own semantics.
    // `obj` resolves nowhere here, so the own-filter's reread binds
    // once (an unresolved name may be a globalThis accessor).
    const src = 'for own k of obj when k\n  f(k)';
    const { code } = compile(src);
    expect(code).toContain('Object.hasOwn(_ref, k)');
    new Function(code);
  });

  test('postfix-if-ELSE in statement position lowers to a ternary with the implicit call intact', () => {
    const src = 'f b if c else d';
    expect(compile(src).code).toBe('(c ? f(b) : d);');
    const run = (cond) => new Function(`let hit = null; let f = (v) => (hit = 'f:' + v); let b = 1, d = 9, c = ${cond};\n${compile(src).code}\nreturn hit;`)();
    expect(run('true')).toBe('f:1');
    expect(run('false')).toBe(null);
  });

  test('statement-position `->` functions group; `=>` stays bare', () => {
    // A bare `function() {...};` statement is invalid JS ("Function
    // statements must have a name"), so `->` statements group. `=>`
    // arrows are valid bare statements and stay bare.
    const bare = compile('->\n  0').code;
    expect(bare).toBe('(function() {\n  return 0;\n});');
    new Function(bare);
    const withParams = compile('(x) ->\n  x').code;
    expect(withParams).toBe('(function(x) {\n  return x;\n});');
    new Function(withParams);
    const arrow = compile('=>\n  5').code;
    new Function(arrow);
  });

  test('object statements group in EVERY position', () => {
    // A statement-position object literal groups wherever it appears —
    // bare `{1: "one"};` would be invalid JS or a silently different
    // block-with-label program.
    const { code } = compile('q = 1\n{1: "one"}');
    expect(code).toBe('let q = 1;\n({1: "one"});'); // locals declare in place
    new Function(code);
  });

  test('`!` keeps grouping in head positions, drops it as an operand', () => {
    // (!x).y emitted as !x.y would be a different program — the
    // grouping stays in member-object/callee position; as a binary
    // operand `!` binds tighter than any binary, so no parens.
    expect(compile('r = (!x).y').code).toBe('let r = (!x).y;');
    expect(compile('r = (!x)(y)').code).toBe('let r = (!x)(y);');
    expect(compile('r = !x && y').code).toBe('let r = !x && y;');
    expect(compile('r = -x && y').code).toBe('let r = (-x) && y;');
  });

  test('conditionals/relations in HEAD positions (member/callee/index) — eval-pinned', () => {
    // Every value-lowered conditional/relation in each head position.
    // (if-as-CALLEE is pinned separately below.)
    const rows = [
      // [source, expected value]
      ['r = (if true then {n: 1} else {n: 2}).n', 1],
      ['r = (if false then {n: 1} else {n: 2}).n', 2],
      ['r = (if true then [9] else [8])[0]', 9],
      ['r = (true ? 1 : 2).toString()', '1'],
      ['r = ("a" in {a: 1}).toString()', 'true'],
      ['r = ([] instanceof Array).toString()', 'true'],
      ['r = (2 in [5, 6, 7]).toString()', 'false'],
    ];
    for (const [src, expected] of rows) {
      const { code } = compile(src);
      new Function(code);
      expect(new Function(`${code}\nreturn r;`)()).toEqual(expected);
    }
  });

  test('prefix-if as CALLEE keeps the call', () => {
    // Unparenthesized-ternary lowering in callee position must not
    // swallow the invocation.
    const src = 'f = -> "F"\ng = -> "G"\nr = (if false then f else g)()';
    const { code } = compile(src);
    expect(code).toContain('(false ? f : g)()');
    new Function(code);
    expect(new Function(`${code}\nreturn r;`)()).toBe('G');
  });

  test('object-method shorthand: `->` values emit methods, `=>` values stay arrows (eval-pinned)', () => {
    // The rule: ':' pairs with a simple identifier key and a thin-arrow
    // value emit ES6 method shorthand (dynamic `this`); fat arrows stay
    // `k: () => …` (lexical `this`); string keys never shorthand.
    const rows = [
      ['o = {k: -> 5}\nr = o.k()', 5],
      ['o = {k: (x) -> x + 1}\nr = o.k(4)', 5],
      ['o = {a: 7, m: -> @a}\nr = o.m()', 7], // method `this` is the object
      ['o = {k: (a, b) => a + b}\nr = o.k(2, 3)', 5],
      ['o = {"str key": -> 6}\nr = o["str key"]()', 6],
    ];
    for (const [src, expected] of rows) {
      expect(new Function(`${compile(src).code}\nreturn r;`)()).toEqual(expected);
    }
    expect(compile('o = {k: -> 5}').code).toContain('{k() {');
    expect(compile('o = {k: => @x}').code).toContain('k: () => this.x');
  });

  test('typeof in HEAD positions keeps grouping', () => {
    // Ungrouped, (typeof x).length would emit typeof x.length — a
    // different program.
    const member = 'x = 42\nr = (typeof x).length';
    const memberCode = compile(member).code;
    expect(memberCode).toContain('(typeof x).length');
    expect(new Function(`${memberCode}\nreturn r;`)()).toBe(6); // "number".length
    const index = 'x = 42\nr = (typeof x)[0]';
    const indexCode = compile(index).code;
    expect(indexCode).toContain('(typeof x)[0]');
    expect(new Function(`${indexCode}\nreturn r;`)()).toBe('n');
    new Function(compile('r = (typeof x)()').code); // callee form: valid JS
  });

  test('parenthesized grouping evaluates correctly', () => {
    const src = 'q = (1 + 2) * 3\ns = -(4 + 5)\nt = (100 + 20).toString';
    const { code } = compile(src);
    expect(new Function(`${code}\nreturn [q, s, t.call(120)];`)()).toEqual([9, -9, '120']);
  });

  test('lowered compare operator maps as a ref-role cover row', () => {
    const src = 'x = a == b';
    const { code, mappings, stores } = compile(src);
    expect(code).toBe('let x = a === b;'); // locals declare in place
    const [binary] = stores.nodesByKind('binary');
    const op = mappings.of(binary.nodeId, 'operator')[0];
    // MATH/COMPARE operators occupy a ref slot — real source span, and the
    // lowering (`==` → `===`) makes the row cover, not exact.
    expect(code.slice(op.generatedStart, op.generatedEnd)).toBe('===');
    expect([op.sourceStart, op.sourceEnd]).toEqual([6, 8]);
    expect(op.mappingKind).toBe('cover');
  });
});

describe('implicit-call spans stay honest', () => {
  test('call.$self spans the REAL source extent; args span the argument list (no phantom parens)', () => {
    const src = 'f x, y';
    const { code, mappings, stores } = compile(src);
    expect(code).toBe('f(x, y);');
    const [call] = stores.nodesByKind('call');
    const self = mappings.of(call.nodeId, '$self')[0];
    expect([self.sourceStart, self.sourceEnd]).toEqual([0, 6]); // `f x, y`
    expect(code.slice(self.generatedStart, self.generatedEnd)).toBe('f(x, y)');
    expect(self.mappingKind).toBe('cover'); // generated grew parens the source never had
    const callee = mappings.of(call.nodeId, 'callee')[0];
    expect([callee.sourceStart, callee.sourceEnd]).toEqual([0, 1]);
    expect(callee.mappingKind).toBe('exact');
    const args = mappings.of(call.nodeId, 'args')[0];
    expect([args.sourceStart, args.sourceEnd]).toEqual([2, 6]); // `x, y` — bare, real extent
    expect(code.slice(args.generatedStart, args.generatedEnd)).toBe('(x, y)');
    expect(args.mappingKind).toBe('cover');
  });

  test('nested implicit calls: each call spans its own real extent', () => {
    const src = 'f g x';
    const { code, mappings, stores } = compile(src);
    expect(code).toBe('f(g(x));');
    const calls = stores.nodesByKind('call');
    const extents = calls
      .map((c) => mappings.of(c.nodeId, '$self')[0])
      .map((r) => src.slice(r.sourceStart, r.sourceEnd))
      .sort((a, b) => a.length - b.length);
    expect(extents).toEqual(['g x', 'f g x']);
  });

  test('implicit trailing comma is JS-style', () => {
    // `f 1, 2,` is accepted exactly like the explicit `f(1, 2,)`.
    expect(compile('f 1, 2,').code).toBe('f(1, 2);');
    expect(compile('f(1, 2,)').code).toBe('f(1, 2);');
  });

  test('logicalKeep is exactly one atom or bracket group wide: wider operands close the call', () => {
    // `-y` after `&&` is two tokens — the call closes at the operator,
    // making the trailing `, z` a syntax error. A wider lookahead would
    // silently accept these programs.
    for (const src of ['f x && -y, z', 'f a && b.c, d']) {
      expect(parser.parse(src).sexpr).toBeNull();
    }
  });

  test('implicit calls evaluate correctly', () => {
    const src = [
      'double = (x) -> x * 2',
      'add = (a, b) -> a + b',
      'r1 = add 1, double 3',
      'r2 = double double 2',
      'r3 = "a,b".split ","',
      'mk = (x) -> (y) -> x + y',
      'r4 = mk(10) 32',
    ].join('\n');
    const { code } = compile(src);
    expect(new Function(`${code}\nreturn [r1, r2, r3, r4];`)()).toEqual([7, 8, ['a', 'b'], 42]);
  });
});

describe('implicit-object spans stay honest', () => {
  test('object.$self spans the REAL source extent (no phantom braces); pairs map exactly', () => {
    const src = 'x = a: 1, b: 2';
    const { code, mappings, stores } = compile(src);
    expect(code).toBe('let x = {a: 1, b: 2};'); // locals declare in place
    const [obj] = stores.nodesByKind('object');
    const self = mappings.of(obj.nodeId, '$self')[0];
    expect([self.sourceStart, self.sourceEnd]).toEqual([4, 14]); // `a: 1, b: 2` — the real extent
    expect(code.slice(self.generatedStart, self.generatedEnd)).toBe('{a: 1, b: 2}');
    expect(self.mappingKind).toBe('cover'); // generated grew braces the source never had
    const pairs = stores.nodesByKind('pair');
    expect(pairs).toHaveLength(2);
    const spans = pairs
      .map((p) => mappings.of(p.nodeId, '$self')[0])
      .map((r) => src.slice(r.sourceStart, r.sourceEnd))
      .sort();
    expect(spans).toEqual(['a: 1', 'b: 2']);
  });

  test('object-in-call: call and object each span their own real extent', () => {
    const src = 'f a: 1, b: 2';
    const { code, mappings, stores } = compile(src);
    expect(code).toBe('f({a: 1, b: 2});');
    const [call] = stores.nodesByKind('call');
    const [obj] = stores.nodesByKind('object');
    const callSelf = mappings.of(call.nodeId, '$self')[0];
    expect(src.slice(callSelf.sourceStart, callSelf.sourceEnd)).toBe('f a: 1, b: 2');
    const objSelf = mappings.of(obj.nodeId, '$self')[0];
    expect(src.slice(objSelf.sourceStart, objSelf.sourceEnd)).toBe('a: 1, b: 2');
  });

  test('indented implicit object: $self covers the property block, not the indentation', () => {
    const src = 'x =\n  a: 1\n  b: 2';
    const { code, mappings, stores } = compile(src);
    expect(code).toBe('let x = {a: 1, b: 2};'); // locals declare in place
    const [obj] = stores.nodesByKind('object');
    const self = mappings.of(obj.nodeId, '$self')[0];
    expect(src.slice(self.sourceStart, self.sourceEnd)).toBe('a: 1\n  b: 2');
  });

  test('implicit objects evaluate correctly', () => {
    const src = [
      'mk = (o) -> o',
      'r1 = mk a: 1, b: 2',
      'r2 = a: 1, b: mk 2, c: 3',
      'r3 =',
      '  a: 1',
      '  b: [2, 3]',
      'r4 = (a: 10).a',
      'r5 = k: v for v in [7]',
    ].join('\n').replace('r5 = k: v for v in [7]', 'r5 = (k: v for v in [7])');
    const { code } = compile(src);
    // r2's value call: `mk 2, c: 3` is mk(2, {c: 3}) — mk returns its
    // first argument, so b lands as 2 (the nested object was the call's
    // second argument).
    expect(new Function(`${code}\nreturn [r1, r2, r3, r4, r5];`)())
      .toEqual([{ a: 1, b: 2 }, { a: 1, b: 2 }, { a: 1, b: [2, 3] }, 10, [{ k: 7 }]]);
  });

  test('@-keys outside a class body reject loudly', () => {
    // Emitting `{this.a: 1}` would be a syntax error shipped without a
    // sound — the emitter rejects instead.
    const r = parser.parse('x = @a: 1'); // parses (class statics need the key form)
    expect(r.diagnostics).toEqual([]);
    expect(() => emit(r, { source: 'x = @a: 1' })).toThrow(/@-keys are only supported in class bodies/);
  });

  test('class spans stay honest', () => {
    const src = 'class A\n  m: (x) -> x + 1';
    const { code, mappings, stores } = compile(src);
    expect(code).toBe('class A {\n  m(x) {\n    return (x + 1);\n  }\n}');
    const [cls] = stores.nodesByKind('class');
    const self = mappings.of(cls.nodeId, '$self')[0];
    expect(src.slice(self.sourceStart, self.sourceEnd)).toBe(src); // the whole declaration
    const name = mappings.of(cls.nodeId, 'name')[0];
    expect([name.sourceStart, name.sourceEnd]).toEqual([6, 7]); // `A`
    expect(name.mappingKind).toBe('exact');
    const body = mappings.of(cls.nodeId, 'body')[0];
    expect(src.slice(body.sourceStart, body.sourceEnd)).toBe('m: (x) -> x + 1');
    const [pair] = stores.nodesByKind('pair');
    const key = mappings.of(pair.nodeId, 'key')[0];
    expect(src.slice(key.sourceStart, key.sourceEnd)).toBe('m');
    expect(key.mappingKind).toBe('exact');
  });

  test('arrow-comma seam: commas owned by an implicit call inside a single-line body extend the body', () => {
    // Class member with a multi-argument implicit call: the comma
    // belongs to the call, not the member list.
    const a = 'class A\n  m: -> f 1, 2';
    expect(compile(a).code).toContain('return f(1, 2);');
    // Object value: an early body cut here would be SILENT invalid JS.
    const b = 'x = {m: -> f 1, 2}';
    const { code } = compile(b);
    expect(() => new Function(code)).not.toThrow();
    const out = new Function(`let f = (p, q) => p + q;\n${code.replace('let x;\n', '')}\nreturn x.m();`)();
    expect(out).toBe(3);
  });

  test('pattern-target spans stay honest', () => {
    const src = '[a, b] = pair';
    const { code, mappings, stores } = compile(src);
    expect(code).toBe('let a, b;\n\n[a, b] = pair;');
    const [assign] = stores.nodesByKind('assign');
    const target = mappings.of(assign.nodeId, 'target');
    // The pattern target has THREE generated manifestations: one per
    // hoisted name (a, b — one-to-many) plus the pattern itself.
    expect(target.length).toBe(3);
    const patternRow = target.find((r) => code.slice(r.generatedStart, r.generatedEnd) === '[a, b]');
    expect(src.slice(patternRow.sourceStart, patternRow.sourceEnd)).toBe('[a, b]');
    expect(patternRow.mappingKind).toBe('exact');
  });

  test('pattern defaults never operand-group; the output Function-validates', () => {
    const run = (code, tail) => new Function(`${code}\n${tail}`)();
    // Array-element default in ASSIGNMENT position: `[y = 2]` must stay
    // a destructuring default, never an operand-grouped `(y = 2)`.
    const a = compile('[y = 2] = []').code;
    expect(a).toContain('[y = 2] = [];');
    expect(run(a, 'return y;')).toBe(2);
    // Rename default in assignment position: valid JS with BOTH names
    // declared (the defaulted name must not drop from the hoist).
    const c = compile('{a: x, b: y = 2} = {a: 1}').code;
    expect(c).toContain('let x, y;');
    expect(run(c, 'return [x, y];')).toEqual([1, 2]);
    // Sweep: rest after default, deep nesting, loop and comprehension
    // pattern vars with defaults — all Function-valid.
    for (const [src, tail, want] of [
      ['[a = 1, ...rest] = [undefined, 5]', 'return [a, rest];', [1, [5]]],
      ['[{a = 1}] = [{}]', 'return a;', 1],
      ['for [q = 7] in [[]]\n  r = q', 'return r;', 7],
      ['g = ({a: renamed = 3}) -> renamed\nr = g {}', 'return r;', 3],
      ['comp = (x for [a, x] in [[1, 2]])', 'return comp;', [2]],
    ]) {
      const code = compile(src).code;
      expect(() => new Function(code)).not.toThrow();
      expect(run(code, tail)).toEqual(want);
    }
  });

  test('object-pattern catch names hoist — no leaked globals', () => {
    const src = 'try\n  throw {message: "boom"}\ncatch {message}\n  r = message';
    const { code } = compile(src);
    expect(code).toContain('let message, r;');
    expect(new Function(`"use strict";${code}\nreturn r;`)()).toBe('boom');
  });

  test('extends-expression classes keep their body', () => {
    // The class body must nest under the class, never get swallowed
    // into the extends expression's call.
    const src = 'base = -> Object\nclass Cat extends base()\n  speak: -> "meow"';
    const { code } = compile(src);
    expect(code).toContain('class Cat extends base() {');
    expect(code).toContain('speak()');
    expect(new Function(`${code}\nreturn new Cat().speak();`)()).toBe('meow');
  });

  test('zero-argument super() emits super(); super outside a class method rejects loudly', () => {
    const src = 'class B extends A\n  constructor: ->\n    super()';
    expect(compile(src).code).toContain('super();');
    // Outside a class method, bare `super` has no valid emission.
    const outside = 'f = -> super()';
    const r = parser.parse(outside);
    expect(() => emit(r, { source: outside })).toThrow(/super outside a class method/);
  });

  test('single-line arrow returning a class with a body compiles', () => {
    const src = 'ret = -> class A\n  m: -> 1';
    const { code } = compile(src);
    expect(new Function(`${code}\nreturn new (ret())().m();`)()).toBe(1);
  });

  test('single-line arrow returning implicit-call-of-switch compiles', () => {
    const src = 'm = -> f switch a\n  when 1 then 2';
    const { code } = compile(src);
    expect(code).toContain('switch (a)');
    expect(new Function(`let f = (v) => v * 10, a = 1;\n${code.replace('let m;\n', '')}\nreturn m();`)()).toBe(20);
  });

  test('runtime-sign BY steps: a literal zero rejects; non-literal steps get a sign-tested header', () => {
    // A literal zero step never advances the loop — rejected at compile.
    expect(() => compile('for x in arr by 0\n  f x')).toThrow(/BY step of 0 never advances/);
    expect(() => compile('for x in arr by -0\n  f x')).toThrow(/BY step of 0 never advances/);
    // A non-literal step evaluates once and tests its sign — an
    // unconditionally ascending header would never terminate on a
    // negative runtime step.
    const src = 'for x in arr by step\n  f x';
    expect(compile(src).code).toContain('_step > 0 ? _i < _ref.length : _step < 0 && _i >= 0');
    // Eval: positive, negative, and zero runtime steps all terminate;
    // the step expression evaluates exactly once.
    const harness = [
      'calls = 0',
      'stepOf = (s) -> (calls += 1; s)',
      'run = (s) ->',
      '  acc = []',
      '  for x in [1, 2, 3, 4] by stepOf(s)',
      '    acc.push x',
      '  acc',
      'out = [run(1), run(-1), run(-2), run(0), calls]',
    ].join('\n');
    const { code } = compile(harness);
    expect(new Function(`${code}\nreturn out;`)()).toEqual([[1, 2, 3, 4], [4, 3, 2, 1], [4, 2], [], 4]);
  });

  test('do-IIFE parameters capture their arguments', () => {
    // `do (i) ->` invokes with the captured argument — the loop-closure
    // idiom depends on it.
    expect(compile('do (i) ->\n  use(i)').code).toContain('})(i);');
    // Eval: each closure sees its own iteration's value through the
    // captured argument.
    const harness = 'out = []\nfor i in [1, 2, 3]\n  do (i) -> out.push(-> i)\npicked = (f() for f in out)';
    const { code } = compile(harness);
    expect(new Function(`${code}\nreturn picked;`)()).toEqual([1, 2, 3]);
  });

  test('two-variable for-as rejects in every position', () => {
    // The iterator protocol yields single values — a second loop
    // variable would silently stay unbound. The rejection sits in the
    // shared clause emitter, so the statement form and all four
    // expression positions hit it.
    for (const src of [
      'for a, b as pairs\n  f(a, b)',
      'x = (a for a, b as pairs)',
      'x = for a, b as pairs\n  f(a, b)',
      'f(a, b) for a, b as pairs',
      'g = (ps) ->\n  for a, b as ps\n    f(a, b)',
    ]) {
      expect(() => compile(src)).toThrow(/for-as takes ONE loop variable/);
    }
  });

  test('tab-indented heredoc closers strip the literal baseline', () => {
    // The closer's LITERAL tab is the indentation baseline — a
    // space-rebuilt column would never prefix-match tab-indented lines
    // and nothing would strip.
    const src = 'x = """\n\ta\n\t\tb\n\t"""';
    const { code } = compile(src);
    expect(code).toContain('x = `a\n\tb`;');
    expect(new Function(`${code}\nreturn x;`)()).toBe('a\n\tb');
  });

  test('arrow INLINE object bodies group (`=> {}` returns the object, not undefined)', () => {
    // An inline `{}` body is an object literal, not an empty BLOCK —
    // ungrouped it would silently return undefined.
    for (const [src, expected] of [
      ['f = => {}', 'f = () => ({});'],
      ['g = => {a: 1}', 'g = () => ({a: 1});'],
    ]) {
      expect(compile(src).code).toContain(expected);
    }
    const { code } = compile('g = => {a: 1}');
    expect(new Function(`${code}\nreturn g();`)()).toEqual({ a: 1 });
  });

  test('def with a bare implicit-object body compiles', () => {
    const src = 'def m()\n  a: 1';
    const { code } = compile(src);
    expect(code).toBe('function m() {\n  return {a: 1};\n}');
    expect(new Function(`${code}\nreturn m();`)()).toEqual({ a: 1 });
  });
});

describe('generated-span invariants over the corpus', () => {
  for (const file of corpusFiles) {
    test(file, () => {
      const src = readFileSync(join(corpusDir, file), 'utf8');
      const { code, rows, stores } = compile(src);

      for (const m of rows) {
        // Every mapping joins to live store rows.
        const owner = stores.node(m.nodeId);
        expect(owner).not.toBeNull();
        if (m.role !== '$self') {
          expect(stores.role(m.nodeId, m.role)).not.toBeNull();
        }
        // Spans in-bounds on both sides; zero-width legal.
        expect(m.sourceStart).toBeGreaterThanOrEqual(0);
        expect(m.sourceEnd).toBeGreaterThanOrEqual(m.sourceStart);
        expect(m.sourceEnd).toBeLessThanOrEqual(src.length);
        expect(m.generatedStart).toBeGreaterThanOrEqual(0);
        expect(m.generatedEnd).toBeGreaterThanOrEqual(m.generatedStart);
        expect(m.generatedEnd).toBeLessThanOrEqual(code.length);
        // Synthetic rows carry a zero-width source anchor.
        if (m.mappingKind === 'synthetic') expect(m.sourceStart).toBe(m.sourceEnd);
        // Exact rows are verbatim by definition.
        if (m.mappingKind === 'exact') {
          expect(code.slice(m.generatedStart, m.generatedEnd)).toBe(src.slice(m.sourceStart, m.sourceEnd));
        }
      }

      // Exact generated spans are disjoint or properly nested.
      const exact = rows.filter(m => m.mappingKind === 'exact');
      for (const a of exact) {
        for (const b of exact) {
          if (a === b) continue;
          const disjoint = a.generatedEnd <= b.generatedStart || b.generatedEnd <= a.generatedStart;
          const aInB = b.generatedStart <= a.generatedStart && a.generatedEnd <= b.generatedEnd;
          const bInA = a.generatedStart <= b.generatedStart && b.generatedEnd <= a.generatedEnd;
          expect(disjoint || aInB || bInA).toBe(true);
        }
      }
    });
  }

  test('round-trip: source → generated → source returns the same (nodeId, role) and spans', () => {
    for (const file of corpusFiles) {
      const src = readFileSync(join(corpusDir, file), 'utf8');
      const { rows, mappings } = compile(src);
      for (const m of rows) {
        // Generated side: the lookup at a row's start returns THAT row
        // among the (nodeId, role) matches. Membership, not identity:
        // a reactive read's exact row nests INSIDE its cover row at
        // the same start (`count` inside `count.value`), so one
        // (nodeId, role) can own two rows sharing a generated start.
        if (m.generatedEnd > m.generatedStart) {
          const back = mappings.atGenerated(m.generatedStart).filter(r => r.nodeId === m.nodeId && r.role === m.role);
          expect(back).toContain(m);
          for (const r of back) expect([r.sourceStart, r.sourceEnd]).toEqual([m.sourceStart, m.sourceEnd]);
        }
        // Source side is one-to-many: a source position may have
        // several generated manifestations (hoist + assignment). The
        // lookup must return the same (nodeId, role) with the same source
        // span — and that row must lead back to this source span.
        if (m.sourceEnd > m.sourceStart) {
          const back = mappings.atSource(m.sourceStart).find(r => r.nodeId === m.nodeId && r.role === m.role);
          expect(back).not.toBeUndefined();
          expect([back.sourceStart, back.sourceEnd]).toEqual([m.sourceStart, m.sourceEnd]);
        }
      }
    }
  });

  test('multi-row access is ordered by generated offset', () => {
    for (const file of corpusFiles) {
      const src = readFileSync(join(corpusDir, file), 'utf8');
      const { mappings, stores } = compile(src);
      for (const n of stores.nodes) {
        for (const role of ['$self', ...stores.rolesOf(n.nodeId).map(r => r.role)]) {
          const group = mappings.of(n.nodeId, role);
          for (let i = 1; i < group.length; i++) {
            expect(group[i].generatedStart).toBeGreaterThanOrEqual(group[i - 1].generatedStart);
          }
        }
      }
    }
  });
});

describe('node identity survives emission', () => {
  // Identity, not coverage. Lowered constructs legitimately emit no
  // rows of their own — a value-lowered if's branch blocks, an
  // unrolled loop range, a rewritten catch binding all emit through
  // their parent's or children's roles — so a corpus-wide tree walk
  // cannot demand a $self row per kind-carrying node. What identity
  // promises is the JOIN: the WeakMap id is the only bridge between
  // tree nodes and mapping rows, and it must stay live through
  // emission. A transform that rebuilt an array would strand the
  // registered node outside the tree while its rows keep the old id —
  // the reverse join below catches exactly that, corpus-wide.
  test('every mapping row joins back to a tree-reachable node by WeakMap id (corpus-wide)', () => {
    for (const file of corpusFiles) {
      const src = readFileSync(join(corpusDir, file), 'utf8');
      const r = parser.parse(src);
      const { mappings } = emit(r, { source: src });
      const stores = new Stores(r.stores);
      const reachable = new Set();
      const walk = (node) => {
        if (!Array.isArray(node)) return;
        const id = stores.idOf(node);
        if (id !== null) reachable.add(id);
        for (const el of node) walk(el);
      };
      walk(r.sexpr);
      const orphans = mappings.filter((m) => !reachable.has(m.nodeId));
      expect(orphans).toEqual([]);
    }
  });

  test('every kind-carrying node joins its mappings by WeakMap id (mixed.rip — fully emitted, no lowering bypasses)', () => {
    const src = readFileSync(join(corpusDir, 'mixed.rip'), 'utf8');
    const r = parser.parse(src);
    const mappings = new Mappings(emit(r, { source: src }).mappings);
    const stores = new Stores(r.stores);
    const walk = (node) => {
      if (!Array.isArray(node)) return;
      const id = stores.idOf(node);
      if (id !== null && stores.node(id).semanticKind !== null) {
        expect(mappings.of(id, '$self')).not.toHaveLength(0);
      }
      for (const el of node) walk(el);
    };
    walk(r.sexpr);
  });
});
