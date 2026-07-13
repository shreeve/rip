//  acceptance: the reactive declaration surface —
// state (`:=`) and computed (`~=`).
// the old runtime is correct, loud rejections where it is not,
// the scope-aware read/write rewrite, the full bidirectional mapping story on
// the lowerings and the unwrap sugar, typed-from-birth declarations
//, and delivery triggered by EMITTED references.
import { test, expect, describe } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import parser from '../../src/parser.js';
import { makeParserLexer, tokenize } from '../../src/lexer.js';
import { emit } from '../../src/emitter.js';
import { compile as fullCompile } from '../../src/compile.js';
import { explainSource } from '../../src/explain.js';
import { Mappings } from '../../src/stores.js';
import { expectLinearDoubling } from '../support/scaling.js';
import * as rt from '../../src/runtime/reactive.js';
import { __schema } from '../../src/runtime/schema.js';

parser.lexer = makeParserLexer();

const BIN = resolve(import.meta.dir, '../../bin/rip');

const compile = (src, opts = {}) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  const out = emit(r, { source: src, ...opts });
  return { ...out, mappings: new Mappings(out.mappings) };
};

const parseFails = (src) => {
  const r = parser.parse(src);
  expect(r.sexpr).toBeNull();
  expect(r.diagnostics).not.toHaveLength(0);
};

const emitFails = (src, re) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  expect(() => emit(r, { source: src })).toThrow(re);
};


// Tier 1 declare-in-place is a SANCTIONED divergence from: this side
// declares straight-line locals at their first write. unplaced()
// erases declaration placement from BOTH sides — hoist lines drop,
// in-place declarations become bare assignments — so these
// tests keep pinning the feature bytes they exist for.
const unplaced = (code) => code
  .replace(/^[ \t]*let [A-Za-z_$][\w$]*(, [A-Za-z_$][\w$]*)*;\n\n?/gm, '')
  .replace(/^([ \t]*)let ([A-Za-z_$][\w$]*)( = )/gm, '$1$2$3');

// Eval pairing: each compiler's undecorated output runs against ITS
// runtime (the module, the materialized template), same harness —
// tier 4 with the delivery seam factored out.
const NAMES = ['__state', '__computed', '__effect', '__batch'];
const runWith = (runtime, code, harness) =>
  new Function(...NAMES, `${code}\n${harness}`)(...NAMES.map((n) => runtime[n]));
const evalBoth = (src, harness) => runWith(rt, compile(src).code, harness);

// ════════════════════════════════════════════════════════════════════
// Grammar: forms, sexpr pins, 0-conflict shapes
// ════════════════════════════════════════════════════════════════════

describe('the declaration forms parse to  sexpr shapes', () => {
  const rows = [
    ['count := 0', ['program', ['state', 'count', '0']]],
    ['count := 1 + 2', ['program', ['state', 'count', ['+', '1', '2']]]],
    ['count :=\n  0', ['program', ['state', 'count', '0']]],
    ['total ~= count * 2', ['program', ['computed', 'total', ['*', 'count', '2']]]],
    ['total ~=\n  count * 2', ['program', ['computed', 'total', ['block', ['*', 'count', '2']]]]],
    ['total ~=\n  a = 1\n  a + 1', ['program', ['computed', 'total', ['block', ['=', 'a', '1'], ['+', 'a', '1']]]]],
    // Typed twins: byte-identical s-expressions (erasure by construction).
    ['count: number := 0', ['program', ['state', 'count', '0']]],
    ['total: number ~= 7', ['program', ['computed', 'total', '7']]],
    ['export count := 0', ['program', ['export', ['state', 'count', '0']]]],
    ['export total ~= 7', ['program', ['export', ['computed', 'total', '7']]]],
    ['export count: number := 0', ['program', ['export', ['state', 'count', '0']]]],
    ['export total: number ~= 7', ['program', ['export', ['computed', 'total', '7']]]],
    // THE POSTFIX SHIFT, PLAINLY (Opus F3; the design record):
    // `count := 0 if c` DECLARES count UNCONDITIONALLY — only the
    // VALUE is conditional (undefined when the guard is false). It is
    // NOT a guarded declaration: REACTIVE_ASSIGN sits below
    // POST_IF/POST_UNLESS in precedence, so the guard shifts into the
    // value — the shape, and the only reading with a valid lowering
    // (a const declaration has no guarded statement form).
    ['count := 0 if c', ['program', ['state', 'count', ['if', 'c', ['0']]]]],
    ['count := 0 unless c', ['program', ['state', 'count', ['if', ['!', 'c'], ['0']]]]],
  ];
  for (const [src, sexpr] of rows) {
  }

});

describe('token fixtures: the reactive spellings', () => {
  const stream = (src) => tokenize(src).tokens.map((t) => `${t.kind}:${t.value}`);

  test('`:=` and `~=` are single tokens with exact spans, any spacing', () => {
    const { tokens } = tokenize('count := 0');
    expect(tokens.map((t) => t.kind)).toEqual(['IDENTIFIER', 'REACTIVE_ASSIGN', 'NUMBER']);
    expect([tokens[1].start, tokens[1].end]).toEqual([6, 8]);
    expect(stream('x:= 5')).toEqual(['IDENTIFIER:x', 'REACTIVE_ASSIGN::=', 'NUMBER:5']);
    expect(stream('t ~= 1')).toEqual(['IDENTIFIER:t', 'COMPUTED_ASSIGN:~=', 'NUMBER:1']);
  });

  test('a typed declaration collapses its annotation and stops at the reactive head', () => {
    expect(stream('count: number := 0')).toEqual(
      ['IDENTIFIER:count', 'TYPE:number', 'REACTIVE_ASSIGN::=', 'NUMBER:0']);
    expect(stream('total: Map<string, number> ~= m')).toEqual(
      ['IDENTIFIER:total', 'TYPE:Map<string, number>', 'COMPUTED_ASSIGN:~=', 'IDENTIFIER:m']);
  });

  test('neighboring spellings keep their meanings', () => {
    // `~` alone stays bitwise-not; `!=` stays the comparison; `=` untouched.
    expect(stream('y = ~x')).toEqual(['IDENTIFIER:y', '=:=', 'UNARY_MATH:~', 'IDENTIFIER:x']);
    expect(stream('a != b')).toEqual(['IDENTIFIER:a', 'COMPARE:!=', 'IDENTIFIER:b']);
    expect(stream('x = 1')).toEqual(['IDENTIFIER:x', '=:=', 'NUMBER:1']);
  });
});

// ════════════════════════════════════════════════════════════════════
// Lowerings: byte pins, Function-validated
// ════════════════════════════════════════════════════════════════════

describe('lowerings byte-match  where  is correct', () => {
  const rows = [
 'count := 0',
 'count := 1 + 2',
 'count :=\n  0',
 'config :=\n  {a: 1}',
 'total ~= count * 2',
 'total ~=\n  count * 2',
 'total ~=\n  a = count * 2\n  a + 1',
 'b ~=\n  if x\n    1\n  else\n    2',
 'x ~= 42',
 'count := 0\nx = count + 1',
 'count := 0\ncount = 5',
 'count := 0\ncount += 1',
 'count := 0\ncount++',
 'count := 0\n++count',
 'count := 0\nobj = {count: 1}',
 'count := 0\nobj = {count}',
 'count := 0\nobj = {n: count}',
 'count := 0\nobj = {"count": count}',
 'count := 0\nobj = {[count]: 1}',
 'user := {name: "Ada"}\nx = user.name',
 'user := {name: "Ada"}\nuser.name = "Bob"',
 'count := 0\nconsole.log count',
 'count := 0\nf = -> count + 1',
 'count := 0\nf = -> count = 9',
 'f = ->\n  local := 5\n  local + 1',
 'def f()\n  z := 1\n  z + 1',
 'count := 0\ndef bump()\n  count += 1\nbump()',
 'count := 0\ndef f()\n  return count',
 'count := 0\nclass A\n  m: -> count + 1',
 'base := null\nclass A extends base\n  m: -> 1',
 'export count := 0',
 'count := 0\nexport total ~= count * 2',
 'count: number := 0',
 'export count: number := 0',
 'a := 1\nb ~= a * 2\nc ~= b + 1',
 'count := count + 1',
 'count := 0\nif count then x = 1',
 'items := [1,2,3]\nfor x in items\n  console.log x',
 'items := [1, 2]\nys = (x * 2 for x in items)',
 'count := 0\na = count = 7',
 'a := 1\nb := 2\na = b',
 'a := 1\na = 2',
 'fn := null\nfn()',
 'fn := null\nfn?()',
 'user := null\nx = user?.name',
 'a := 1\nx = a?.b',
 'count := 0\ncount = 5 if true',
 'count := 0 if true',
 'count := 5\nx = -count',
 'flag := true\nx = !flag',
 'a := 1\nx = a > 0',
 'a := null\nx = a ?? 5',
 'arr := [1,2]\nx = arr[0]',
 'arr := [1,2]\narr[0] = 9',
 'a := 1\nxs = [a, 2]',
 'xs := [1,2]\nys = [...xs]',
 'n := 3\nxs = [1..n]',
 'a := 1\nswitch a\n  when 1 then x = 1\n  else x = 2',
 'a := 3\nwhile a > 0\n  a -= 1',
 'a := 1\nx = if a then 1 else 2',
 'a := 1\nx = typeof a',
 'obj := {a: 1}\ndelete obj.a',
 'obj := {a: 1}\n{a} = obj',
 'a := 1\nx = do -> a',
 'f = ->\n  x := await g()\n  x',
 'count := 0\ns = "n=#{count + 1}"',
 'count := 0\ncount = 1 if c else 2',
 'count := 0\nx = 1 if count else 2',
 'count := 0\nobj = {count: x for x of src}',
 'count := 5\nf = (x = count) -> x',
  ];
  for (const src of rows) {
  }
});

describe('eval checks: paired runs against each side\'s own runtime', () => {
  test('state + computed + reads/writes propagate identically', () => {
    const out = evalBoth(
 'count := 1\ndouble ~= count * 2\nseen = []\nseen.push double\ncount = 5\nseen.push double\ncount += 2\nseen.push [count, double]',
 'return seen;',
    );
    expect(out).toEqual([2, 10, [7, 14]]);
  });

  test('update operators write the container', () => {
    const out = evalBoth('n := 1\nn++\nn++\n--n\nx = n', 'return x;');
    expect(out).toBe(2);
  });

  test('cross-function behavior: closures read and write the module container', () => {
    const out = evalBoth(
 'count := 0\ndef bump()\n  count += 1\nf = -> count * 10\nbump()\nbump()\nr = f()',
 'return r;',
    );
    expect(out).toBe(20);
  });

  test('computed chains recompute through the graph', () => {
    const out = evalBoth(
 'a := 1\nb ~= a * 2\nc ~= b + 1\nfirst = c\na = 10\nsecond = c',
 'return [first, second];',
    );
    expect(out).toEqual([3, 21]);
  });

  test('the container composes in head positions (member-object, call-callee, index-object)', () => {
    const out = evalBoth(
 'm := {f: (-> 7), xs: [3, 4]}\nviaMember = m.f\nviaCall = m.f()\nviaIndex = m.xs[1]\nfn := (x) -> x + 1\nviaCallee = fn(41)',
 'return [viaCall, viaIndex, viaCallee];',
    );
    expect(out).toEqual([7, 4, 42]);
  });

  test('reads compose in argument, array, object, template, and return positions', () => {
    const out = evalBoth(
 'n := 6\ninArg = Math.max(n, 2)\ninArr = [n, n + 1]\ninObj = {n}\ninTpl = "v=#{n * 2}"\nf = -> n\ninRet = f()',
 'return [inArg, inArr, inObj, inTpl, inRet];',
    );
    expect(out).toEqual([6, [6, 7], { n: 6 }, 'v=12', 6]);
  });

  test('an effect written by hand sees declaration writes (the runtime and the surface meet)', () => {
    const log = runWith(rt, compile('count := 0\nlog = []\nstop = __effect(-> log.push count)\ncount = 3\ncount = 8\nstop()').code, 'return log;');
    expect(log).toEqual([0, 3, 8]);
  });

  test('the ternary hoist writes the CONTAINER (`count = 1 if c else 2` → `count.value = (c ? 1 : 2)`)', () => {
    const src = 'count := 0\nflag = true\ncount = 1 if flag else 2\na = count\nflag = false\ncount = 1 if flag else 2\nb = count';
    const out = evalBoth(src, 'return [a, b];');
    expect(out).toEqual([1, 2]);
    expect(compile(src).code).toContain('count.value = (flag ? 1 : 2);');
  });

});

describe('schema callable bodies thread the reactive frames (GPT blocker 2)', () => {
  const runSchema = (code, tail) =>
    new Function('__schema', ...NAMES, `${code}\n${tail}`)(__schema, ...NAMES.map((n) => rt[n]));

  test('schema-body params still shadow (the frames thread WITH the scope chain, not instead of it)', () => {
    const src = 'u := 1\nS3 = schema :input\n  a! integer\n  @ensure "x", (u) -> u.a > 0';
    const { code } = compile(src);
    expect(code).toContain('u.a > 0');
    expect(code).not.toContain('u.value.a');
  });
});

describe('object-comprehension string keys route through the rewrite (GPT item 3)', () => {
});

// ════════════════════════════════════════════════════════════════════
// Scope-aware rewriting: this side divergences from the scope-blind set
// ════════════════════════════════════════════════════════════════════

describe('scope-aware unwrap (): shadows suppress, locals never leak', () => {

  test('(g) def/class declarations shadow inside their scope\'s frame', () => {
    const src = 'count := 0\nf = ->\n  def count()\n    9\n  count()';
    const { code } = compile(src);
    expect(code).toContain('return count();');
    expect(code).not.toContain('count.value()');
  });

});

describe('reactive names never hoist ()', () => {

});

describe('export registration is order-independent ()', () => {
});

describe("the existential reads the VALUE — the container itself is never null, so testing it would always answer true", () => {
});

describe('bare template interpolations unwrap (deliberate byte divergence; eval-equal)', () => {
});

// ════════════════════════════════════════════════════════════════════
// Loud rejections where the old runtime emits invalid or silently wrong JS
// ════════════════════════════════════════════════════════════════════

describe(': reactive declarations have no expression form', () => {

});

describe(': reactive targets are plain names', () => {
});

describe(': reactive declarations sit at module or function scope — statement blocks reject', () => {
  test('every block-nested declaration position rejects loudly (the Opus F1 repro shapes)', () => {
    for (const src of [
 'if c\n  y := 1\nconsole.log y',        // the escape: read after the block
 'if c\n  y := 1\n  console.log y',      // in-block use — the declaration position itself rejects
 'if c then count := 1',
 '(count := 1) if c',
 'while c then y := 1',
 'while x\n  y := 1',
 'for x in xs\n  y := x',
 'switch v\n  when 1 then y := 1\n  else z = 2',
 'try\n  y := 1\ncatch e\n  z = 2',
 'loop\n  y := 1',
 'f = ->\n  if c\n    y := 1\n  y',      // nested inside a function's block, same rule
    ]) {
      emitFails(src, /module or function scope/);
    }
  });

  test('module and function scope stay legal — including computed block bodies (their own scope)', () => {
    expect(compile('y := 1').code).toBe('const y = __state(1);');
    expect(compile('f = ->\n  y := 1\n  y').code).toContain('const y = __state(1);');
    expect(compile('def g()\n  z := 2\n  z').code).toContain('const z = __state(2);');
  });
});

describe('`delete` on a reactive name rejects — never a silent accessor deletion', () => {
});

describe(': no reactive class members', () => {
});

describe(': a computed object-literal value groups', () => {
});

describe(': the heads are spellable — semanticKind is the discriminator (D6)', () => {

  test('a user call does not trigger reactive delivery (zero-cost holds for impersonating spellings)', () => {
    for (const mode of ['none', 'import', 'inline']) {
      const { code, runtimes } = fullCompile('state = (a) -> a\nx = state 1', { runtimeDelivery: mode });
      expect([...runtimes]).toEqual([]);
      expect(code).not.toContain('__state');
    }
  });
});

describe('self-referential runtime-name targets reject (the delivered-name boundary class)', () => {

  test('binding a DIFFERENT runtime name reactively is the bring-your-own hatch (per-name suppression)', () => {
    const { code, runtimes } = fullCompile('__effect := 5', { runtimeDelivery: 'import' });
    expect([...runtimes]).toEqual(['reactive']);
    expect(code.split('\n')[0]).toMatch(/^import \{ __state, __computed, __effect as __effect_, __batch/);
    expect(code).toContain('const __effect = __state(5);');
  });
});

// ════════════════════════════════════════════════════════════════════
// Typed-from-birth: erasure, annotation rows, declarations
// ════════════════════════════════════════════════════════════════════

describe('typed reactive declarations: erased twins with recorded spans', () => {
  test('the typed forms compile byte-identical to their untyped twins (erasure-neutrality)', () => {
    for (const [typed, untyped] of [
      ['count: number := 0', 'count := 0'],
      ['total: number ~= count * 2', 'total ~= count * 2'],
      ['export count: number := 0', 'export count := 0'],
      ['export total: number ~= 7', 'export total ~= 7'],
    ]) {
      expect(compile(typed).code).toBe(compile(untyped).code);
    }
  });

  test('the annotation records as a side-band role and covers the whole emitted declaration', () => {
    const src = 'count: number := 0';
    const { code, mappings, stores } = compile(src);
    const node = stores.nodesByKind('state')[0];
    const role = stores.role(node.nodeId, 'annotation');
    expect(src.slice(role.sourceStart, role.sourceEnd)).toBe(': number');
    const rows = mappings.of(node.nodeId, 'annotation');
    expect(rows).toHaveLength(1);
    expect(rows[0].mappingKind).toBe('cover');
    expect(code.slice(rows[0].generatedStart, rows[0].generatedEnd)).toBe('const count = __state(0)');
  });

  test('declarations surface the CONTAINER type (the cross-module contract); computed is readonly', () => {
    expect(fullCompile('export count: number := 0').declarations)
      .toBe('export declare const count: { value: number; read(): number };\n');
    expect(fullCompile('export total: number ~= count * 2').declarations)
      .toBe('export declare const total: { readonly value: number; read(): number };\n');
    expect(fullCompile('label: string := "tag"').declarations)
      .toBe('declare const label: { value: string; read(): string };\nexport {};\n');
    // Untyped declarations declare nothing (M8's contract).
    expect(fullCompile('count := 0').declarations).toBe('');
  });
});

// ════════════════════════════════════════════════════════════════════
// The mapping story: the densest pins yet
// ════════════════════════════════════════════════════════════════════

describe('mapping: the state declaration and the unwrapped read', () => {
  const src = 'count := 0\nx = count + 1';
  // → let x;\n\nconst count = __state(0);\nx = count.value + 1;

  test('the declaration: target exact, operator cover over `:=`, value exact, $self cover over the lowering', () => {
    const { code, mappings, stores } = compile(src);
    const node = stores.nodesByKind('state')[0];

    const target = mappings.of(node.nodeId, 'target');
    expect(target).toHaveLength(1);
    expect(target[0].mappingKind).toBe('exact');
    expect(src.slice(target[0].sourceStart, target[0].sourceEnd)).toBe('count');
    expect(code.slice(target[0].generatedStart, target[0].generatedEnd)).toBe('count');

    // The operator role is the side-band label on the dropped
    // REACTIVE_ASSIGN token: source span `:=`, generated manifestation
    // the emitted `=` — a cover row by construction.
    const op = mappings.of(node.nodeId, 'operator');
    expect(op).toHaveLength(1);
    expect(op[0].mappingKind).toBe('cover');
    expect(src.slice(op[0].sourceStart, op[0].sourceEnd)).toBe(':=');
    expect(code.slice(op[0].generatedStart, op[0].generatedEnd)).toBe('=');

    const value = mappings.of(node.nodeId, 'value');
    expect(value).toHaveLength(1);
    expect(value[0].mappingKind).toBe('exact');
    expect(src.slice(value[0].sourceStart, value[0].sourceEnd)).toBe('0');

    const self = mappings.of(node.nodeId, '$self');
    expect(self).toHaveLength(1);
    expect(self[0].mappingKind).toBe('cover');
    expect(src.slice(self[0].sourceStart, self[0].sourceEnd)).toBe('count := 0');
    expect(code.slice(self[0].generatedStart, self[0].generatedEnd)).toBe('const count = __state(0)');

    // The `__state(` glyphs live inside $self and outside every child
    // role — the lowering's own text, never a fake exact.
    const call = code.indexOf('__state(');
    expect(mappings.atGenerated(call).every((r) => r.mappingKind !== 'exact')).toBe(true);
    expect(mappings.bestAtGenerated(call).nodeId).toBe(node.nodeId);
  });

  test('the read: an exact row on the read site nests inside the cover row over the sugar', () => {
    const { code, mappings } = compile(src);
    const read = code.indexOf('count.value');
    const rows = mappings.atGenerated(read);
    const exact = rows.find((r) => r.mappingKind === 'exact');
    const cover = rows.find((r) => r.mappingKind === 'cover' && r.role === exact.role && r.nodeId === exact.nodeId);
    expect(exact).toBeDefined();
    expect(cover).toBeDefined();
    expect(src.slice(exact.sourceStart, exact.sourceEnd)).toBe('count');
    expect(code.slice(exact.generatedStart, exact.generatedEnd)).toBe('count');
    expect(code.slice(cover.generatedStart, cover.generatedEnd)).toBe('count.value');
    // Same (nodeId, role): two manifestations of the read's role.
    expect(exact.role).toBe('left');

    // The `.value` suffix itself resolves through the cover — reverse
    // lookup lands on the read's source span, never a fake exact.
    const dot = code.indexOf('.value', read);
    const best = mappings.bestAtGenerated(dot);
    expect(best.mappingKind).not.toBe('exact');
    expect(src.slice(best.sourceStart, best.sourceEnd)).toBe('count');

    // Serialization prefers the exact row at the read start: the V3 map
    // sends the read site to the identifier, name channel included.
    const serialized = mappings.serializableRows().find((r) => r.generatedStart === read);
    expect(serialized.mappingKind).toBe('exact');
  });

  test('a breakpoint on a reactive write lands on the source assignment', () => {
    const wsrc = 'count := 0\ncount = 5';
    const { code, mappings } = compile(wsrc);
    const write = code.indexOf('count.value = 5');
    // Forward: the source assignment's span resolves to the write.
    const fromSource = mappings.bestAtSource(wsrc.indexOf('count = 5'));
    expect(fromSource.generatedStart).toBeGreaterThanOrEqual(write);
    // Reverse: every position across the write resolves into the
    // assignment's source line (offset 11 starts `count = 5`).
    for (const off of [write, write + 6, code.indexOf('= 5', write)]) {
      const row = mappings.bestAtGenerated(off);
      expect(row.sourceStart).toBeGreaterThanOrEqual(11);
    }
  });

  test('the computed block: value covers the synthesized body; inner statements stay exact', () => {
    const csrc = 'total ~=\n  a = 1\n  a + 1';
    const { code, mappings, stores } = compile(csrc);
    const node = stores.nodesByKind('computed')[0];
    const value = mappings.of(node.nodeId, 'value');
    expect(value).toHaveLength(1);
    expect(value[0].mappingKind).toBe('cover');
    expect(code.slice(value[0].generatedStart, value[0].generatedEnd)).toContain('let a = 1;');
    // The user expression `a + 1` maps exactly inside the wrapper.
    const plus = code.indexOf('a + 1');
    const exact = mappings.atGenerated(plus).find(
      (r) => r.mappingKind === 'exact' && csrc.slice(r.sourceStart, r.sourceEnd) === 'a + 1');
    expect(exact).toBeDefined();
    // The `() => ` wrapper resolves through the declaration's cover
    // rows — synthesized text, honestly mapped (never exact).
    const arrow = code.indexOf('() =>');
    expect(mappings.atGenerated(arrow).every((r) => r.mappingKind !== 'exact')).toBe(true);
  });
});

describe('--explain tells the full story on a reactive declaration', () => {
  test('at the declaration operator', () => {
    const out = explainSource('count := 0\nx = count + 1', { path: 'demo.rip', pos: { line: 1, col: 7 } });
    // The state node owns the position; its kind and roles surface.
    expect(out).toContain('state');
    expect(out).toMatch(/roles:/);
    expect(out).toMatch(/operator +\[6,8\).*`:=`/);
    expect(out).toMatch(/target +\[0,5\).*`count`/);
    // The mapping table shows the operator's cover onto the emitted `=`
    // and the $self cover over the whole lowering.
    expect(out).toMatch(/operator +cover +\[6,8\)[^\n]*`=`/);
    expect(out).toMatch(/\$self +cover +\[0,10\)[^\n]*`const count = __state\(0\)`/);
    // Serialization verdicts are explicit.
    expect(out).toContain('V3 map');
    expect(out).toContain('reverse-only');
  });

  test('at the unwrapped read: both manifestations, exact first in generated order', () => {
    const src = 'count := 0\nx = count + 1';
    const out = explainSource(src, { path: 'demo.rip', pos: { line: 2, col: 5 } });
    expect(out).toMatch(/left +exact +\[15,20\)[^\n]*`count`[^\n]*V3 map/);
    expect(out).toMatch(/left +cover +\[15,20\)[^\n]*`count\.value`[^\n]*reverse-only/);
  });
});

// ════════════════════════════════════════════════════════════════════
// delivery: the lowerings EMIT the references — the seam delivers
// ════════════════════════════════════════════════════════════════════

describe('delivery triggers from the emitted lowering', () => {
  test("a `:=` file under 'import': one injected import, the synthetic row, the runtime reported", () => {
    const { code, runtimes, mappings } = fullCompile('count := 0\ncount = 5', { runtimeDelivery: 'import' });
    expect([...runtimes]).toEqual(['reactive']);
    expect(code.split('\n')[0]).toMatch(/^import \{ __state, __computed, __effect, __batch, __readonly, __setErrorHandler, __handleError, __catchErrors, getEffectSignal \} from ".*runtime\/reactive\.js";$/);
    const row = mappings.rows.find((r) => r.role === 'runtime');
    expect(row.mappingKind).toBe('synthetic');
    expect(mappings.serializableRows().some((r) => r.role === 'runtime')).toBe(false);
  });

  test('a `~=`-only file triggers identically', () => {
    const { runtimes } = fullCompile('t ~= 1 + 1', { runtimeDelivery: 'import' });
    expect([...runtimes]).toEqual(['reactive']);
  });

  test('standalone: a reactive file compiled inline runs in a fresh process, sentinel intact', () => {
    const { code } = fullCompile('count := 1\ndouble ~= count * 2\nconsole.log double\ncount = 21\nconsole.log double', { runtimeDelivery: 'inline' });
    expect(/^import /m.test(code)).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), 'rip-m9b-inline-'));
    try {
      writeFileSync(join(dir, 'one.js'), code);
      const r = spawnSync('bun', [join(dir, 'one.js')], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim().split('\n')).toEqual(['2', '42']);
      // A second copy in one process still rejects loudly.
      writeFileSync(join(dir, 'two.js'), code);
      writeFileSync(join(dir, 'main.js'), "import './one.js';\nimport './two.js';\n");
      const r2 = spawnSync('bun', [join(dir, 'main.js')], { encoding: 'utf8' });
      expect(r2.status).not.toBe(0);
      expect(r2.stderr).toContain('two copies of the Rip reactive runtime');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the loader path end to end: declarations in one module, explicit `.value` imports in another (cross-module)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rip-m9b-loader-'));
    try {
      writeFileSync(join(dir, 'store.rip'), 'export count := 1\nexport double ~= count * 2\ndef bump()\n  count += 1\nexport { bump }\n');
      writeFileSync(join(dir, 'main.rip'), [
 'import { count, double, bump } from "./store.rip"',
        // Imported reactive names are containers — reads spell `.value`
        // (no side channel threads the exporter's name set; ).
 'console.log count.value',
 'console.log double.value',
 'bump()',
 'console.log [count.value, double.value]',
      ].join('\n'));
      const r = spawnSync('bun', [BIN, 'main.rip'], { cwd: dir, encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim().split('\n')).toEqual(['1', '2', '[ 2, 4 ]']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an importing module does NOT auto-unwrap an imported reactive name (bare reads stay bare)', () => {
    const { code, runtimes } = fullCompile('import { count } from "./store.rip"\nx = count + 1', { runtimeDelivery: 'import' });
    expect(code).toContain('x = count + 1;');
    expect(code).not.toContain('count.value');
    expect([...runtimes]).toEqual([]);
  });

  test('zero-cost: a reactive-free file is byte-identical under every mode — the standing gate extends', () => {
    const outputs = ['none', 'import', 'inline'].map((mode) =>
      fullCompile('x = 1 + 2\nf = (a) -> a * x', { runtimeDelivery: mode }));
    expect(outputs[0].code).toBe(outputs[1].code);
    expect(outputs[1].code).toBe(outputs[2].code);
    for (const o of outputs) expect([...o.runtimes]).toEqual([]);
  });

  test('BOTH runtimes deliver into one module: two synthetic rows, distinguished by generated range (the dual-delivery caveat)', () => {
    const src = 'count := 0\nS = schema\n  a! integer\ncount = 1';
    const { code, runtimes, mappings } = fullCompile(src, { runtimeDelivery: 'import' });
    expect([...runtimes].sort()).toEqual(['reactive', 'schema']);
    const rows = mappings.rows.filter((r) => r.role === 'runtime');
    expect(rows).toHaveLength(2);
    // Same (nodeId, role) pair — the  record — so any per-runtime
    // query keys on the generated range, never on role uniqueness.
    expect(rows[0].nodeId).toBe(rows[1].nodeId);
    expect(rows[0].generatedEnd).toBeLessThanOrEqual(rows[1].generatedStart);
    const [schemaRow, reactiveRow] = code.indexOf('schema.js') < code.indexOf('reactive.js')
      ? rows : [rows[1], rows[0]];
    expect(code.slice(schemaRow.generatedStart, schemaRow.generatedEnd)).toContain('schema.js');
    expect(code.slice(reactiveRow.generatedStart, reactiveRow.generatedEnd)).toContain('reactive.js');
  });
});

// ════════════════════════════════════════════════════════════════════
// Scaling: the surface machinery stays linear
// ════════════════════════════════════════════════════════════════════

describe('scaling gate: reactive-heavy compilation doubles linearly', () => {
  test('N chained declarations + N reads + N writes: parse + emit stays linear', () => {
    expectLinearDoubling({
      prepare: (n) => {
        const lines = ['s0 := 0'];
        for (let i = 1; i < n; i++) lines.push(`s${i} ~= s${i - 1} + 1`);
        for (let i = 0; i < n; i++) lines.push(`r${i} = s${i} * 2`);
        lines.push('s0 = 1');
        return lines.join('\n');
      },
      run: (src) => {
        const r = parser.parse(src);
        emit(r, { source: src });
      },
      sizes: [500, 1000, 2000],
    });
  });
});
