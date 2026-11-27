// The analysis pass (src/emit/analyze.js) against v1's facts
// (test/support/analyze-diff.js). Every language-suite row agrees in
// every option set; the whole consumer corpus runs through
// scripts/analyze-diff.mjs. The unit pins below hold the boundary rows
// of the walks, every rejection analysis owns (each against v1's own
// message and span), and the scope facts: hoist entries, declare in
// place, temp sites and predicates, each also agreeing with v1.
import { test, expect, describe } from 'bun:test';
import { join } from 'node:path';
import { parseSource } from '../../src/compiler.js';
import { emit as emitV1 } from '../../src/emitter.js';
import { analyze } from '../../src/emit/analyze.js';
import { rowInputs } from '../support/consumer-hashes.js';
import { differential, v1Facts, v2Facts, compareFacts } from '../support/analyze-diff.js';
import { Stores } from '../../src/stores.js';

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

  test('a pick key is a property name: a keyword key declares nothing, and the default\'s write hoists here', () => {
    for (const key of ['class', 'component', 'def']) {
      const src = `x = o.{${key} = (a = 1)}\nlog a`;
      expect(run(src).programHoist.map(([n]) => n)).toEqual(['a', 'x']);
      expect(v1Facts(parseSource(src), { face: 'js' }).record.bindings).toEqual([{ name: 'x', kind: 'plain' }, { name: 'a', kind: 'plain' }]);
    }
    expect(run('a = o.{class}\nb = q.{class}\n').bindingNames).toEqual(['a', 'b']);
  });

  test('bindingNames: parameter patterns, promoted parameters, parameter defaults and every catch binding', () => {
    const src = 'f = ([p], q = (r = 1), s = ((t) -> t)) -> p\nclass K\n  constructor: (@u, @v = 2) ->\ntry\n  g()\ncatch e\n  0\n';
    const names = ['f', 'p', 'q', 's', 'r', 't', 'K', 'u', 'v', 'e'];
    expect([...run(src).bindingNames].sort()).toEqual([...names].sort());
    expect([...v1Facts(parseSource(src), { face: 'js' }).record.bindingNames].sort()).toEqual([...names].sort());
  });

  test('runtimes: an inline try body is a delivery site', () => {
    for (const src of ['try p 1', 'x = try kind 1', 'f = -> try kind 1']) {
      expect([...run(src).runtimes]).toEqual(['stdlib']);
      expect([...v1Facts(parseSource(src), { face: 'js' }).record.runtimes]).toEqual(['stdlib']);
    }
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

// ── the scope facts ──────────────────────────────────────────────────

// Analysis and v1 agree on every fact, the scope facts included; the
// analysis comes back with a reader for its node-keyed facts.
const hoistOf = (src, options = {}) => {
  const face = options.face ?? 'js';
  const parsed = parseSource(src, { face });
  const v1 = v1Facts(parsed, options);
  expect(v1.error?.message ?? null).toBe(null);
  const v2 = v2Facts(parsed, options);
  expect(compareFacts(v1, v2)).toBe(null);
  const a = v2.analysis;
  const stores = new Stores(parsed.result.stores);
  const text = (x) => {
    const id = Array.isArray(x) ? stores.idOf(x) : null;
    const span = id === null ? null : stores.selfSpan(id);
    return span === null ? null : src.slice(span[0], span[1]);
  };
  // The hoist of the program (null) or of the construct whose source
  // starts with `owner`.
  const find = (owner) => a.hoists.find((h) => (owner === null ? h.list === null : h.owner !== null && text(h.owner)?.startsWith(owner)));
  // The predicate bits of the node whose source is exactly `at`.
  const bits = (at) => {
    const node = parsed.result.stores.nodes.find((n) => src.slice(n.sourceStart, n.sourceEnd) === at);
    expect(node).toBeDefined();
    return a.predicateBits(node.nodeId);
  };
  return { a, find, text, bits };
};
const names = (h) => h.entries.map(([n]) => n);

describe('scope facts: hoist entries', () => {
  test('a nested scope hoists only what no enclosing scope binds', () => {
    const { find } = hoistOf('x = 1\nf = (p) ->\n  x = 2\n  p = 3\n  y = 4\n  y\n');
    expect(names(find(null))).toEqual(['f', 'x']);
    expect(names(find('(p) ->'))).toEqual(['y']);
  });

  test('every invocation owns its last match: `_` hoists under an outer `_`', () => {
    const { find } = hoistOf('"a" =~ /a/\nf = (s) ->\n  s =~ /b/\n  _\n');
    expect(names(find('(s) ->'))).toEqual(['_']);
    expect(find('(s) ->').matchWrite).toBe(true);
  });

  test('a compound write to an enclosing exported const mints no local; a plain write shadows it', () => {
    // v1's write guard then rejects the compound write in the author's
    // vocabulary; the hoist it reaches first has no entry for it.
    const src = 'export flag = 1\nf = ->\n  flag += 2\ng = ->\n  flag = 3\n  flag\n';
    expect(run(src).hoists.map((h) => names(h))).toEqual([['f', 'g'], ['flag']]);
  });

  test('component members never hoist; the member initializers hoist in `_init`', () => {
    const { find } = hoistOf('A = component\n  n := (t = 1; t + 1)\n  m: ->\n    n = 2\n    k = 3\n    k\n');
    expect(names(find('component'))).toEqual(['t']);
    expect(find('component').declareInPlace).toBe(false);
    expect(names(find('->\n    n ='))).toEqual(['k']);
  });

  test('TS: a function body and the program annotate from their assignments before their bare typed forwards; a def in walk order', () => {
    const fn = hoistOf('f = ->\n  r: number\n  q()\n  r: string = "a"\n  r = "b"\n  r\n', { face: 'ts' });
    expect(fn.text(fn.find('->').annotations.get('r'))).toBe('r: string = "a"');
    const def = hoistOf('def f\n  r: number\n  q()\n  r: string = "a"\n  r = "b"\n  r\n', { face: 'ts' });
    expect(def.text(def.find('def').annotations.get('r'))).toBe('r: number');
    // The program's hoist reads its live statements, as a function's.
    const program = hoistOf('r: number\nq()\nr: string = "a"\nr = "b"\nlog r\n', { face: 'ts' });
    expect(program.text(program.find(null).annotations.get('r'))).toBe('r: string = "a"');
  });
});

describe('scope facts: declare in place and its scan', () => {
  test('the first write declares when it is the name\'s first occurrence and a statement of the scope', () => {
    const h = hoistOf('f = ->\n  a = 1\n  b = b + 1\n  if c\n    d = 1\n  e = 2\n  a + b + d + e\n').find('->');
    expect([...h.inPlace.keys()]).toEqual(['a', 'e']);
    expect(h.captures.get('b').decl).toBe(null);
    expect(h.captures.get('d').decl).toBe(null);
  });

  test('a def reading the name, a guard write and the implicit-return tail keep the hoist', () => {
    const h = hoistOf('f = ->\n  a = 1\n  def g\n    a\n  b = c or return 0\n  t = 2\n').find('->');
    expect(h.captures.get('a').inDef).toBe(true);
    expect(h.inPlace.size).toBe(0);
  });

  test('a pattern declares all its names or none', () => {
    const one = hoistOf('f = ->\n  [a, b] = pair\n  a + b\n').find('->');
    expect([...one.inPlace.keys()]).toEqual(['a', 'b']);
    const none = hoistOf('f = ->\n  log b\n  [a, b] = pair\n  a + b\n').find('->');
    expect(none.inPlace.size).toBe(0);
  });

  test('a head of the emitter\'s tree is the node\'s kind, never a read of the name it spells', () => {
    // `str` heads every interpolated string; the write still declares in place.
    const h = hoistOf('f = ->\n  str = "x#{y}"\n  s2 = "x#{y}"\n  str + s2\n').find('->');
    expect([...h.inPlace.keys()]).toEqual(['s2', 'str']);
  });

  test('a headless array\'s first element is a child: a name there spelled `object` is read', () => {
    // The guard reads `object` before its write, and the nested handler's
    // binding is an occurrence there: both writes stay hoisted.
    const guard = hoistOf('x = (k for c in xs when object)\nobject = 1\n').find(null);
    expect([...guard.inPlace.keys()]).toEqual(['x']);
    const handler = hoistOf('object = ->\n  try\n    g()\n  catch object\n    log 1\n').find(null);
    expect([...handler.inPlace.keys()]).toEqual([]);
  });

  test('a nested write marks the name nested; a pattern binding records its accessor path', () => {
    const h = hoistOf('f = ->\n  {a: [p, q]} = rec\n  g = -> q = 2\n  p\n').find('->');
    const q = h.captures.get('q');
    expect([q.nested, q.nestedWrite, q.firstWritePath]).toEqual([true, true, '.a[1]']);
  });

  test('a class binding read before its write stays hoisted, a class binding and a pin candidate', () => {
    const h = hoistOf('f = ->\n  log K\n  K = class\n    m: -> 1\n  g = -> K\n  null\n', { face: 'ts' }).find('->');
    expect(h.classBindings).toEqual(['K']);
    expect(h.pinnable.map(([n]) => n)).toEqual(['K']);
  });

  test('the REPL\'s tail keeps its hoist', () => {
    const program = hoistOf('a = 1\nb = 2\n', { repl: true }).find(null);
    expect([...program.inPlace.keys()]).toEqual(['a']);
  });

  test('a parameter default\'s match write and an annotation a declaring pattern cannot carry reject', () => {
    rejectsLikeV1('f = (a = (x =~ /r/)) ->\n  1', 'emitter: a parameter default cannot write the last-match binding — `_` lives in the enclosing body, which a default cannot reach (move the match into the body)');
    const src = 'f = ->\n  [a, b] = pair\n  a: number = 3\n  a\n';
    const parsed = parseSource(src, { face: 'ts' });
    const err = rejection(() => analyze(parsed.result, { source: src, face: 'ts' }));
    const v1 = v1Facts(parsed, { face: 'ts' });
    expect(err.message).toBe(v1.error.message);
    expect([err.start, err.end]).toEqual([v1.error.start, v1.error.end]);
  });
});

describe('scope facts: temp sites', () => {
  test('a chain caches a structured mid operand in its scope', () => {
    const { find, text } = hoistOf('f = ->\n  x = a < g() < c\n  y = a < b < c\n  x + y\n');
    expect(find('->').chains.map(text)).toEqual(['g()']);
  });

  test('the program plans its captures before any scope exists: an import is no binding there', () => {
    const { find, text } = hoistOf('import {a} from "m"\na?.b = 1\nf = ->\n  a?.c = 2\n  null\n');
    expect(find(null).plans.map((p) => [text(p.node), p.recv])).toEqual([['a?.b = 1', true]]);
    expect(find('->')).toBe(undefined);
  });

  // A v1-fidelity pin: v1's planner hands each loop's variable LIST to
  // patternNames, which reads no name from it, so a re-read loop
  // variable captures (a conservative temp, a v1 defect a later v1 PR
  // removes); this row moves with that fix.
  test('loop variables and a catch pattern\'s names are repeat-safe to the planner; a plain catch binding is not', () => {
    const { find, text } = hoistOf('f = ->\n  for x, i in xs\n    x?.p = 1\n    i?.p = 1\n  try\n    t()\n  catch e\n    e?.p = 1\n  try\n    t()\n  catch {k}\n    k?.p = 1\n  null\n');
    expect(find('->').plans.map((p) => text(p.node))).toEqual(['e?.p = 1']);
  });

  test('a synthesized compound captures its object and key unless repeat-safe', () => {
    const { find } = hoistOf('f = (o, k) ->\n  o[k] %%= 3\n  g()[h()] //= 2\n  null\n');
    expect(find('(o, k)').plans.map((p) => [p.recv, p.obj, p.key])).toEqual([[false, true, true]]);
  });

  test('a class field value plans in its own evaluation, knowing no name of its own', () => {
    const { a } = hoistOf('class A\n  f = (g()?.x = 1)\n  h = g()[k()] //= 2\n');
    expect(a.fieldPlans.map((f) => f.plans.map((p) => [p.recv, p.obj, p.key]))).toEqual([[[true, false, false]], [[false, true, true]]]);
  });

  test('one node can be both a chain\'s mid operand and a plan site: both temps are its', () => {
    const { find, text } = hoistOf('f = ->\n  a < (g()[k()] //= r) < c\n');
    const h = find('->');
    expect(h.chains.map(text)).toEqual(['g()[k()] //= r']);
    expect(h.plans.map((p) => text(p.node))).toEqual(['g()[k()] //= r']);
  });

  test('a site is a site whatever its temp would be named', () => {
    // v1's chain temp at module level and the function's plan temp both
    // spell `_ref` (the unreserved chain temp, #531); the site stands.
    const { find, text } = hoistOf('n = a < g() < c\nx = ->\n  b?.p = 1\n  null\n');
    expect(find('->').plans.map((p) => text(p.node))).toEqual(['b?.p = 1']);
  });
});

describe('scope facts: predicates', () => {
  const AWAIT = 1, IT = 4, RETURN = 8, CTRL = 16;

  test('await stops at a function and a class body, not at a class parent; an effect stops it', () => {
    const { bits } = hoistOf('f = ->\n  class K extends (await y)\n    m: -> await z\n  1\n');
    expect(bits('class K extends (await y)\n    m: -> await z') & AWAIT).toBe(AWAIT);
    expect(hoistOf('f = ->\n  ~> await x\n  1\n').bits('~> await x') & AWAIT).toBe(0);
  });

  test('a bare `it` skips member names and object keys', () => {
    expect(hoistOf('f = -> o.it + {it: 1}.x\n').bits('o.it + {it: 1}.x') & IT).toBe(0);
    expect(hoistOf('f = -> o[it]\n').bits('o[it]') & IT).toBe(IT);
  });

  test('control flow: a break or continue word, a return or throw', () => {
    expect(hoistOf('loop\n  if a then break\n').bits('if a then break') & CTRL).toBe(CTRL);
    expect(hoistOf('f = ->\n  if a\n    return 1\n  2\n').bits('if a\n    return 1') & RETURN).toBe(RETURN);
  });
});
