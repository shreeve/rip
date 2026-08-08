//  acceptance: the readonly declaration
// (`x =! e`) — adjacency lexing (adjacent `=!` is one token; spaced
// `= !` keeps assignment-of-negation).
// is correct, loud rejections where it is not (the pinned
// #79/#80/#85/the pinned contractes extend — #94), write semantics riding JS's
// own const TypeError (the handle precedent), the reactive
// interplay (a readonly of a reactive read is a value SNAPSHOT; the
// lowering never calls `__readonly`), typed twins + .d.ts, the full
// mapping story, and delivery staying zero-cost for readonly-only
// files.
import { test, expect, describe } from 'bun:test';
import parser from '../../src/parser.js';
import { makeParserLexer, tokenize } from '../../src/lexer.js';
import { emit } from '../../src/emitter.js';
import { compile as fullCompile } from '../../src/compile.js';
import { Mappings } from '../../src/stores.js';
import * as rt from '../../src/runtime/reactive.js';

parser.lexer = makeParserLexer();

const compile = (src, opts = {}) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  const out = emit(r, { source: src, ...opts });
  return { ...out, mappings: new Mappings(out.mappings) };
};

const emitFails = (src, re) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  expect(() => emit(r, { source: src })).toThrow(re);
};


// Eval pairing for rows that touch the reactive runtime: each
// compiler's undecorated output runs against ITS runtime.
const NAMES = ['__state', '__computed', '__effect', '__batch'];
const runWith = (runtime, code, harness) =>
  new Function(...NAMES, `${code}\n${harness}`)(...NAMES.map((n) => runtime[n]));
const evalBoth = (src, harness) => runWith(rt, compile(src).code, harness);

// Runtime-free eval pairing: readonly-only programs reference no
// runtime name, so both outputs run bare.
const runBare = (code, harness) => new Function(`${code}\n${harness}`)();
const evalBothBare = (src, harness) => runBare(compile(src).code, harness);

describe('token fixtures: adjacent `=!` is one token; spaced `= !` is two', () => {
  const stream = (src) => tokenize(src).tokens.map((t) => `${t.kind}:${t.value}`);

  test('the four spacing spellings split exactly on adjacency (\'s OPERATOR_RE rule)', () => {
    expect(stream('x =! 5')).toEqual(['IDENTIFIER:x', 'READONLY_ASSIGN:=!', 'NUMBER:5']);
    expect(stream('x =!5')).toEqual(['IDENTIFIER:x', 'READONLY_ASSIGN:=!', 'NUMBER:5']);
    expect(stream('x=!5')).toEqual(['IDENTIFIER:x', 'READONLY_ASSIGN:=!', 'NUMBER:5']);
    expect(stream('x = !5')).toEqual(['IDENTIFIER:x', '=:=', 'UNARY_MATH:!', 'NUMBER:5']);
  });

  test('the token span is exact', () => {
    const { tokens } = tokenize('x =! 5');
    expect(tokens.map((t) => t.kind)).toEqual(['IDENTIFIER', 'READONLY_ASSIGN', 'NUMBER']);
    expect([tokens[1].start, tokens[1].end]).toEqual([2, 4]);
  });

  test('a readonly of a negation spells the space out: `x =! !y`', () => {
    expect(stream('x =! !y')).toEqual(['IDENTIFIER:x', 'READONLY_ASSIGN:=!', 'UNARY_MATH:!', 'IDENTIFIER:y']);
    // Unspaced `=!!` reads the same way — `=!` claims, `!` negates.
    expect(stream('x =!!y')).toEqual(['IDENTIFIER:x', 'READONLY_ASSIGN:=!', 'UNARY_MATH:!', 'IDENTIFIER:y']);
  });

  test('neighboring spellings keep their meanings', () => {
    // `==` claims before `=!` can — comparison against a negation.
    expect(stream('a ==!b')).toEqual(['IDENTIFIER:a', 'COMPARE:==', 'UNARY_MATH:!', 'IDENTIFIER:b']);
    expect(stream('a != b')).toEqual(['IDENTIFIER:a', 'COMPARE:!=', 'IDENTIFIER:b']);
    // The void marker resolves BEFORE the `=` is reached — the bang
    // rides the NAME, not the operator (`save! = ->` unchanged).
    expect(stream('save! = -> 5').slice(0, 3)).toEqual(['IDENTIFIER:save', 'VOID_MARKER:!', '=:=']);
  });

  test('a typed declaration collapses its annotation and stops at the readonly head', () => {
    expect(stream('x: number =! 5')).toEqual(
      ['IDENTIFIER:x', 'TYPE:number', 'READONLY_ASSIGN:=!', 'NUMBER:5']);
  });
});

describe('eval checks: reads, writes, and the reactive interplay', () => {
  test('reads compose everywhere a value reads', () => {
    const out = evalBothBare(
 'n =! 6\ninArg = Math.max(n, 2)\ninArr = [n, n + 1]\ninObj = {n}\ninTpl = "v=#{n * 2}"\nf = -> n\ninRet = f()',
 'return [inArg, inArr, inObj, inTpl, inRet];',
    );
    expect(out).toEqual([6, [6, 7], { n: 6 }, 'v=12', 6]);
  });

  test('the postfix guard governs the INITIALIZER, never the binding', () => {
    const out = evalBothBare('x =! 5 if false\ny =! 7 if true', 'return [typeof x, x, y];');
    expect(out).toEqual(['undefined', undefined, 7]);
  });

  test('a readonly of a reactive read is a SNAPSHOT — later writes never move it', () => {
    const out = evalBoth(
 'count := 1\nro =! count + 1\nfirst = ro\ncount = 10\nsecond = ro',
 'return [first, second];',
    );
    expect(out).toEqual([2, 2]);
  });

  test('effects and computeds read readonly names plain (no unwrap, no tracking)', () => {
    const out = evalBoth(
 'base =! 10\ncount := 1\ntotal ~= base + count\nlog = []\n~> log.push total\ncount = 5',
 'return log;',
    );
    expect(out).toEqual([11, 15]);
  });

});

describe('documented equivalences: operand grouping diverges in bytes, never in meaning', () => {
  // needsGrouping is the ONE grouping source of truth;
  // the old runtime hand-rolls per-site wrap conditions. On unary-chain and yield
  // initializers the two disagree about REDUNDANT parens — the
  // divergence is family-wide (every reactive-family value position
  // shares the operand context: `count := !!y` diverges identically)
  // and semantically empty. Deliberate, not drift.

});

// ════════════════════════════════════════════════════════════════════
// The rejection classes extend
// ════════════════════════════════════════════════════════════════════

describe('readonly declarations have no expression form (the pinned contract)', () => {
  test.each([
    ['y = (x =! 5)', 'y = const x = 5;'],
    ['f(x =! 5)', 'f(const x = 5);'],
    ['export default x =! 5', 'export default const x = 5;'],
  ])('%s rejects with no expression form', (src) => {
    emitFails(src, /readonly declaration .* no expression form/);
  });

  test('the composition matrix closes: head positions (member-object, call-callee, index-key) and return reject too', () => {
    for (const src of ['(x =! 5).toString()', '(x =! 5)(1)', 'a[x =! 5]', 'f = -> return x =! 5']) {
      emitFails(src, /no expression form/);
    }
  });
});

describe('readonly targets are plain names (the pinned contract)', () => {
  test.each([
    ['obj.x =! 5', 'const .,obj,x = 5;'],
    ['x[0] =! 5', 'const [],x,0 = 5;'],
    ['@x =! 5', 'const .,this,x = 5;'],
    ['{a} =! obj', 'const object,,a,a = obj;'],
  ])('%s rejects', (src, debris) => {
    emitFails(src, /readonly declaration takes a plain name/);
  });
});

describe('no readonly class members (the pinned contract)', () => {
});

describe('readonly declarations sit at module or function scope (the pinned contract)', () => {
  const positions = [
 'if c\n  x =! 5',
 'while c\n  x =! 5',
 'loop\n  x =! 5\n  break',
 'for a in [1]\n  x =! 5',
 'switch a\n  when 1\n    x =! 5',
 'try\n  x =! 5\ncatch e\n  f()',
 'f = ->\n  if c\n    x =! 5',
  ];
  for (const src of positions) {
    test(`${JSON.stringify(src)} rejects`, () => {
      emitFails(src, /must sit at module or function scope/);
    });
  }

  test('module and function scope stay legal', () => {
    expect(compile('x =! 1').code).toBe('const x = 1;');
    expect(compile('f = ->\n  x =! 1\n  x').code).toContain('const x = 1;');
  });
});

// ════════════════════════════════════════════════════════════════════
// Divergences: order-independence, hoisting, the dropped bang
// ════════════════════════════════════════════════════════════════════

describe(': readonly names never hoist; registration is order-independent (the #82/the pinned contractes)', () => {

});

describe('the scope-blind set unwraps a shadowing readonly (the pinned contract extends)', () => {

});

describe('a bang-marked readonly target rejects at parse — never a silently dropped bang (the pinned contract)', () => {
});

describe(' extends: the `readonly` head is spellable — semanticKind discriminates (D6)', () => {

  test('the impersonating call triggers no delivery', () => {
    const { runtimes } = fullCompile('readonly x, 5', { runtimeDelivery: 'import' });
    expect([...runtimes]).toEqual([]);
  });
});

describe('the delivered-name boundary does NOT extend to readonly: `__readonly =! 5` is the bring-your-own hatch', () => {
  test('the lowering calls no runtime name, so the binding is legal and suppresses that one name', () => {
    // Legal — a plain const of the user's own value.
    expect(compile('__readonly =! 5').code).toBe('const __readonly = 5;');
    // Under delivery, a module that ALSO triggers the runtime keeps
    // the user's binding: the injected import excludes __readonly.
    const { code, runtimes } = fullCompile('__readonly =! 5\n~> probe __readonly', { runtimeDelivery: 'import' });
    expect([...runtimes]).toEqual(['reactive']);
    const importLine = code.split('\n')[0];
    expect(importLine).toStartWith('import {');
    expect(importLine).not.toContain('__readonly');
  });
});

// ════════════════════════════════════════════════════════════════════
// Typed twins + .d.ts
// ════════════════════════════════════════════════════════════════════

describe('typed readonly declarations: erased twins with recorded spans', () => {
  test('the typed forms compile byte-identical to their untyped twins (erasure-neutrality)', () => {
    for (const [typed, untyped] of [
      ['x: number =! 5', 'x =! 5'],
      ['export x: number =! 5', 'export x =! 5'],
    ]) {
      expect(compile(typed).code).toBe(compile(untyped).code);
    }
  });

  test('the annotation records as a side-band role and covers the whole emitted declaration', () => {
    const src = 'x: number =! 5';
    const { code, mappings, stores } = compile(src);
    const node = stores.nodesByKind('readonly')[0];
    const role = stores.role(node.nodeId, 'annotation');
    expect(src.slice(role.sourceStart, role.sourceEnd)).toBe(': number');
    const rows = mappings.of(node.nodeId, 'annotation');
    expect(rows).toHaveLength(1);
    expect(rows[0].mappingKind).toBe('cover');
    expect(code.slice(rows[0].generatedStart, rows[0].generatedEnd)).toBe('const x = 5');
  });

  test('a typed readonly declares a plain `declare const` — no container (the effect-handle shape, not the reactive one)', () => {
    expect(fullCompile('export x: number =! 5').declarations)
      .toBe('export declare const x: number;\n');
    expect(fullCompile('label: string =! "tag"').declarations)
      .toBe('declare const label: string;\nexport {};\n');
    // Untyped declarations declare nothing (M8's contract).
    expect(fullCompile('x =! 5').declarations).toBe('');
  });
});

// ════════════════════════════════════════════════════════════════════
// The mapping story
// ════════════════════════════════════════════════════════════════════

describe('mapping: the readonly declaration and its reads', () => {
  const src = 'x =! 5\ny = x + 1';
  // → let y;\n\nconst x = 5;\ny = x + 1;

  test('the declaration: target exact, operator cover over `=!`, value exact, $self cover over the lowering', () => {
    const { code, mappings, stores } = compile(src);
    const node = stores.nodesByKind('readonly')[0];

    const target = mappings.of(node.nodeId, 'target');
    expect(target).toHaveLength(1);
    expect(target[0].mappingKind).toBe('exact');
    expect(src.slice(target[0].sourceStart, target[0].sourceEnd)).toBe('x');
    expect(code.slice(target[0].generatedStart, target[0].generatedEnd)).toBe('x');

    // The operator role is the side-band label on the dropped
    // READONLY_ASSIGN token: source span `=!`, generated manifestation
    // the emitted `=` — a cover row by construction.
    const op = mappings.of(node.nodeId, 'operator');
    expect(op).toHaveLength(1);
    expect(op[0].mappingKind).toBe('cover');
    expect(src.slice(op[0].sourceStart, op[0].sourceEnd)).toBe('=!');
    expect(code.slice(op[0].generatedStart, op[0].generatedEnd)).toBe('=');

    const value = mappings.of(node.nodeId, 'value');
    expect(value).toHaveLength(1);
    expect(value[0].mappingKind).toBe('exact');
    expect(src.slice(value[0].sourceStart, value[0].sourceEnd)).toBe('5');

    const self = mappings.of(node.nodeId, '$self');
    expect(self).toHaveLength(1);
    expect(self[0].mappingKind).toBe('cover');
    expect(src.slice(self[0].sourceStart, self[0].sourceEnd)).toBe('x =! 5');
    expect(code.slice(self[0].generatedStart, self[0].generatedEnd)).toBe('const x = 5');
  });

  test('a READ maps exactly — no sugar, the identifier is its own row', () => {
    const { code, mappings } = compile(src);
    const read = code.indexOf('x + 1');
    const rows = mappings.atGenerated(read);
    const exact = rows.find((r) => r.mappingKind === 'exact' && src.slice(r.sourceStart, r.sourceEnd) === 'x');
    expect(exact).toBeDefined();
    expect(code.slice(exact.generatedStart, exact.generatedEnd)).toBe('x');
    // Forward: a breakpoint on the read's source lands on the read.
    const fromSource = mappings.bestAtSource(src.indexOf('x + 1'));
    expect(fromSource.generatedStart).toBe(read);
  });

  test('a breakpoint on the declaration lands inside the lowering', () => {
    const { code, mappings } = compile(src);
    const decl = mappings.bestAtSource(0);
    expect(decl).not.toBeNull();
    expect(decl.generatedStart).toBeGreaterThanOrEqual(code.indexOf('const x'));
  });
});

// ════════════════════════════════════════════════════════════════════
// delivery: readonly is the runtime-FREE leg
// ════════════════════════════════════════════════════════════════════

describe('delivery: readonly-only files stay zero-cost; the interplay triggers only from reactive constructs', () => {
  test('zero-cost: a readonly-only file is byte-identical under every mode and reports no runtimes', () => {
    const src = 'x =! 5\ny = x + 1\nf = -> x * 2';
    const outputs = ['none', 'import', 'inline'].map((mode) =>
      fullCompile(src, { runtimeDelivery: mode }));
    expect(outputs[0].code).toBe(outputs[1].code);
    expect(outputs[1].code).toBe(outputs[2].code);
    for (const o of outputs) expect([...o.runtimes]).toEqual([]);
  });

  test('readonly + reactive in one module: the reactive DECLARATION triggers; the readonly adds nothing', () => {
    const { code, runtimes, mappings } = fullCompile('count := 0\nro =! count', { runtimeDelivery: 'import' });
    expect([...runtimes]).toEqual(['reactive']);
    expect(mappings.rows.filter((r) => r.role === 'runtime')).toHaveLength(1);
    expect(code).toContain('const ro = count.value;');
  });

  test('a user REFERENCE to __readonly still delivers (the delivery rule — the name stays in the table)', () => {
    const { runtimes } = fullCompile('wrapped = __readonly(5)', { runtimeDelivery: 'import' });
    expect([...runtimes]).toEqual(['reactive']);
  });

  test('standalone inline: a readonly-only file carries ZERO runtime bytes and runs', () => {
    const { code } = fullCompile('x =! 21\nconsole.log x * 2', { runtimeDelivery: 'inline' });
    expect(code).not.toContain('__state');
    expect(code).not.toContain('__readonly');
    const logs = [];
    new Function('console', code)({ log: (v) => logs.push(String(v)) });
    expect(logs).toEqual(['42']);
  });
});
