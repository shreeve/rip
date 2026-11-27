// The analysis pass (src/emit/analyze.js) against v1's facts
// (test/support/analyze-diff.js). Every language-suite row agrees in
// every option set; the whole consumer corpus runs through
// scripts/analyze-diff.mjs. The unit pins below hold the boundary rows
// of the one walk and every rejection analysis owns, each against v1's
// own message and span.
import { test, expect, describe } from 'bun:test';
import { join } from 'node:path';
import { parseSource } from '../../src/compiler.js';
import { emit as emitV1 } from '../../src/emitter.js';
import { analyze } from '../../src/emit/analyze.js';
import { rowInputs } from '../support/consumer-hashes.js';
import { differential, v1Facts } from '../support/analyze-diff.js';

const root = join(import.meta.dir, '../..');

const run = (src, options = {}) => analyze(parseSource(src).result, { source: src, ...options });

const rejection = (fn) => {
  try { fn(); } catch (err) { return err; }
  return null;
};

// analyze.js rejects with exactly the message and span v1 does.
const rejectsLikeV1 = (src, message) => {
  const parsed = parseSource(src);
  const err = rejection(() => analyze(parsed.result, { source: src }));
  expect(err?.message).toBe(message);
  const v1 = v1Facts(parsed, { face: 'js' });
  expect(v1.error?.message).toBe(message);
  expect([err.start, err.end]).toEqual([v1.error.start, v1.error.end]);
};

const scopeOf = (a, owner) => a.scopes.find((s) => s.ownerId === owner);

describe('the analysis differential', () => {
  test('every language row agrees with v1 in every option set', async () => {
    const inputs = await rowInputs(root);
    const { summary, different } = differential(inputs);
    expect(different).toEqual([]);
    for (const [set, counts] of Object.entries(summary)) {
      expect({ set, covered: counts.identical > 3000 }).toEqual({ set, covered: true });
    }
  });

  test('the fact sink moves no output byte', () => {
    const src = 'import {a} from "m"\nx := 1\nf = (y) ->\n  z = y\n  log(a < z < 3)\n~> p x\n';
    for (const face of ['js', 'ts']) {
      const parsed = parseSource(src, { face });
      const plain = emitV1(parsed.result, { source: src, face });
      const seen = [];
      const sunk = emitV1(parsed.result, { source: src, face, facts: (kind) => seen.push(kind) });
      expect(sunk.code).toBe(plain.code);
      expect(sunk.mappings).toEqual(plain.mappings);
      expect(seen).toContain('frame');
    }
  });
});

describe('module facts', () => {
  test('the binding inventory: imports, then declarations by kind, then hoisted writes', () => {
    const a = run('import {q} from "m"\nn := 1\nc ~= n + 1\nh ~> log n\nr =! 2\nclass K\ndef d\n  1\nw = 3\n[u, v] = pair\n');
    expect(a.bindings).toEqual([
      { name: 'q', kind: 'import' }, { name: 'n', kind: 'state' }, { name: 'c', kind: 'computed' },
      { name: 'h', kind: 'effect' }, { name: 'r', kind: 'readonly' }, { name: 'K', kind: 'class' },
      { name: 'd', kind: 'def' }, { name: 'w', kind: 'plain' }, { name: 'u', kind: 'plain' }, { name: 'v', kind: 'plain' },
    ]);
  });

  test('an ambient name written plainly is no binding of this program', () => {
    const a = run('w = 1\nk = 2\n', { ambientBindings: [{ name: 'w', kind: 'state' }] });
    expect(a.bindings).toEqual([{ name: 'k', kind: 'plain' }]);
    expect(a.bindingNames).toEqual(['w', 'k']);
  });

  test('runtimes: a structural trigger or a free runtime name, dependencies closed', () => {
    expect([...run('x := 1').runtimes]).toEqual(['reactive']);
    expect([...run('p 1').runtimes]).toEqual(['stdlib']);
    expect([...run('p = 2\np 1').runtimes]).toEqual([]);
    expect([...run('f = (p) -> p 1').runtimes]).toEqual([]);
    expect([...run('p 1', { ambientBindings: [{ name: 'p', kind: 'plain' }] }).runtimes]).toEqual([]);
    expect([...run('t = "a" =~ /a/').runtimes]).toEqual(['stdlib']);
  });

  test('a loop or clause variable spelled like a runtime name binds it: no reference', () => {
    for (const src of ['for p in xs\n  log 1', 'x = (1 for p in xs)', 'for [p] in xs\n  1', 'for k, p of xs\n  1']) {
      expect([...run(src).runtimes]).toEqual([]);
      expect(v1Facts(parseSource(src), { face: 'js' }).record.runtimes.size).toBe(0);
    }
    expect([...run('for [a = p] in xs\n  1').runtimes]).toEqual(['stdlib']);
  });

  test('typeOnlyImports: an import named only in type text', () => {
    expect([...run('import {T, v} from "m"\nx: T = v\n').typeOnlyImports]).toEqual(['T']);
  });

  test('appAccessors: value imports from rip/app under their local names', () => {
    expect(run('import {currentStash as s, currentRouter} from "rip/app"\n').appAccessors).toEqual({ stash: 's', router: 'currentRouter' });
  });

  test('a schema callable body is its own delivery tree and scope', () => {
    const a = run('S = schema :shape\n  name! string\n  greet: (who) -> x := who\n');
    expect(a.schemaTrees.map((t) => t.atoms)).toEqual([['who']]);
    const body = a.scopes.find((s) => s.ownerId === null && s !== a.scopes[0]);
    expect([...body.reactive.keys()]).toEqual(['x']);
  });
});

describe('scope boundaries', () => {
  test('a class: the collectors never enter it; the hoist reads its field values here', () => {
    const a = run('class A\n  f = (y = 1)\n  m: -> z := 1\n');
    expect(a.programHoist.map(([n]) => n)).toEqual(['y']);
    expect([...a.scopes[0].reactive.keys()]).toEqual([]);
  });

  test('a render children block is inlined, never a scope; a callback is one', () => {
    const src = 'A = component\n  render\n    code = (f) -> "x"\n    div\n      code -> load!\n      span -> "y"\n';
    const parsed = parseSource(src);
    const a = analyze(parsed.result, { source: src });
    const scoped = new Set(a.scopes.map((s) => s.ownerId));
    const funcs = parsed.result.stores.nodes.filter((n) => n.semanticKind === 'func')
      .sort((x, y) => x.sourceStart - y.sourceStart || y.sourceEnd - x.sourceEnd)
      .map((n) => [src.slice(n.sourceStart, n.sourceEnd).trim().split('\n')[0], scoped.has(n.nodeId)]);
    expect(funcs).toEqual([['(f) -> "x"', true], ['code -> load!', false], ['-> load!', true], ['-> "y"', false]]);
  });

  test('a component member effect with one statement has no scope; a module one is checked alone', () => {
    const member = run('A = component\n  ~> log 1\n');
    expect(member.scopes.length).toBe(1);
    const module = run('~> log 1\n');
    expect(module.scopes.map((s) => s.checkOnly)).toEqual([false, true]);
  });

  test('a zero-parameter function that reads a bare `it` declares it', () => {
    const parsed = parseSource('g = -> it * 2\n');
    const a = analyze(parsed.result, { source: 'g = -> it * 2\n' });
    const fn = parsed.result.stores.nodes.find((n) => n.semanticKind === 'func').nodeId;
    expect([...scopeOf(a, fn).decls.keys()]).toEqual(['it']);
  });
});

describe('rejections, each exactly v1\'s', () => {
  test('a plain write ahead of a declaration of the same name', () => {
    rejectsLikeV1('x = 1\nx := 2', "emitter: 'x' was already declared as plain on line 1 — assign with 'x = …' to update it, or choose a different name");
  });

  test('two authoritative declarations in one scope', () => {
    rejectsLikeV1('def f\n  1\nclass f', "emitter: 'f' was already declared as def on line 1 — choose a different name");
    rejectsLikeV1('f = (x) ->\n  def x\n    1', "emitter: 'x' was already declared as parameter on line 1 — assign with 'x = …' to update it, or choose a different name");
  });

  test('a name bound twice in one pattern', () => {
    rejectsLikeV1('f = (a, a) -> a', "emitter: 'a' is bound twice in one parameter list — one binding per name; rename or drop the duplicate");
    rejectsLikeV1('for [a, a] in xs\n  a', "emitter: 'a' is bound twice in one loop head — one binding per name; rename or drop the duplicate");
    rejectsLikeV1('r = (x for [y, y] in xs)', "emitter: 'y' is bound twice in one comprehension clause — one binding per name; rename or drop the duplicate");
    rejectsLikeV1('[b, b] = c', "emitter: 'b' is bound twice in one destructuring pattern — one binding per name; rename or drop the duplicate");
  });

  test('a try reads its handler before its body', () => {
    rejectsLikeV1('try\n  [a, a] = x\ncatch {e, e}\n  0', "emitter: 'e' is bound twice in one catch pattern — one binding per name; rename or drop the duplicate");
  });

  test('a declaration nested in a statement block', () => {
    rejectsLikeV1('if c\n  n := 1', "emitter: a reactive declaration ('n := …') must sit at module or function scope — inside a statement block it lowers to a block-scoped const, and any later read would unwrap '.value' off a binding that no longer exists");
    rejectsLikeV1('if c\n  h ~> log 1', "emitter: a bound effect ('h ~> …') must sit at module or function scope — inside a statement block its dispose handle would be a block-scoped const, dead to every later read ; a BARE '~> …' stays legal here");
    rejectsLikeV1('if c\n  r =! 1', "emitter: a readonly declaration ('r =! …') must sit at module or function scope — inside a statement block it lowers to a block-scoped const, dead to every later read ");
  });

  test('a destructuring target that cannot bind', () => {
    rejectsLikeV1('[true] = c', 'emitter: `true` cannot be a destructuring target — a value word lowers to its literal before scope exists, so the binding would be unreachable');
    rejectsLikeV1('[f()] = c', "emitter: a call cannot be a destructuring target — a pattern element writes a name or a member, and a call's result is neither");
  });

  test('scopes reject in emission order: an outer scope before a scope inside it', () => {
    rejectsLikeV1('f = ->\n  g = ->\n    y := 1\n    y := 2\n  if c\n    n := 1', "emitter: a reactive declaration ('n := …') must sit at module or function scope — inside a statement block it lowers to a block-scoped const, and any later read would unwrap '.value' off a binding that no longer exists");
  });

  test('a function checks its body before the functions in its parameter defaults', () => {
    const b = "emitter: 'b' is bound twice in one destructuring pattern — one binding per name; rename or drop the duplicate";
    rejectsLikeV1('f = (a = (-> [c, c] = 1)) ->\n  [b, b] = 1', b);
    rejectsLikeV1('f = ([a = (-> [c, c] = 1)]) ->\n  [b, b] = 1', b);
    rejectsLikeV1('f = ({a = (-> [c, c] = 1)}) =>\n  [b, b] = 1', b);
    rejectsLikeV1('do (a = (-> [c, c] = 1)) ->\n  [b, b] = 1', b);
    rejectsLikeV1('f = (a = (-> (x := 1; x := 2))) ->\n  y := 1\n  y := 2', "emitter: 'y' was already declared as state on line 2 — assign with 'y = …' to update it, or choose a different name");
  });

  test('a def and a method emit their parameters first', () => {
    const c = "emitter: 'c' is bound twice in one destructuring pattern — one binding per name; rename or drop the duplicate";
    rejectsLikeV1('def f(a = (-> [c, c] = 1))\n  [b, b] = 1', c);
    rejectsLikeV1('class A\n  m: (a = (-> [c, c] = 1)) ->\n    [b, b] = 1', c);
    rejectsLikeV1('class A\n  constructor: (a = (-> [c, c] = 1)) ->\n    [b, b] = 1', c);
    rejectsLikeV1('o = {m: (a = (-> [c, c] = 1)) ->\n  [b, b] = 1}', c);
  });

  test('every function a class or component member pair holds is a method; other functions check their body first', () => {
    const c = "emitter: 'c' is bound twice in one destructuring pattern — one binding per name; rename or drop the duplicate";
    const b = "emitter: 'b' is bound twice in one destructuring pattern — one binding per name; rename or drop the duplicate";
    const D = '(a = (-> [c, c] = 1))';
    for (const src of [
      `class A\n  @s: ${D} ->\n    [b, b] = 1`,
      `class A extends B2\n  @s: ${D} ->\n    [b, b] = 1`,
      `class A\n  @s: ${D} =>\n    [b, b] = 1`,
      `class A\n  constructor: -> 1\n  m: ${D} =>\n    [b, b] = 1`,
      `class A\n  'q': ${D} ->\n    [b, b] = 1`,
      `class A\n  m!: ${D} ->\n    [b, b] = 1`,
      'class A\n  set x: (v = (-> [c, c] = 1)) ->\n    [b, b] = 1',
      `A = component\n  m: ${D} =>\n    [b, b] = 1`,
      `A = component\n  m: ${D} ->\n    [b, b] = 1`,
      `A = component\n  m = ${D} ->\n    [b, b] = 1`,
      `A = component\n  mounted = ${D} ->\n    [b, b] = 1`,
    ]) rejectsLikeV1(src, c);
    // A class field's function, and an object pair that is no method
    // (a string key, a fat arrow), are ordinary functions.
    for (const src of [
      `class A\n  f = ${D} ->\n    [b, b] = 1`,
      `o = {'q': ${D} ->\n  [b, b] = 1}`,
      `o = {m: ${D} =>\n  [b, b] = 1}`,
    ]) rejectsLikeV1(src, b);
  });

  test('a single-expression effect is checked as its own scope', () => {
    rejectsLikeV1('~> (y := 1; y := 2)', "emitter: 'y' was already declared as state on line 1 — assign with 'y = …' to update it, or choose a different name");
  });
});
