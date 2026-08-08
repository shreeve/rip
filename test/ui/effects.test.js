//  acceptance: the effect surface (`~>`) — the
// reactive triad's third leg.
// correct, loud rejections where it is not (the a pinned defect/
// #85/#87/the pinned contractes extended, #90–#92 new), the dispose handle as a
// real binding, async bodies riding  ported semantics, the
// cleanup channel, delivery from the emitted lowering, and the
// Debugging showcase: a runtime stack trace from a throw INSIDE
// an effect body resolving to the .rip line.
import { test, expect, describe } from 'bun:test';
import parser from '../../src/parser.js';
import { makeParserLexer, tokenize } from '../../src/lexer.js';
import { emit } from '../../src/emitter.js';
import { compile as fullCompile } from '../../src/compile.js';
import { explainSource } from '../../src/cli/explain.js';
import { Mappings } from '../../src/stores.js';
import { expectLinearDoubling } from '../support/scaling.js';
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

// Eval pairing: each compiler's undecorated output runs against ITS
// runtime — tier 4 with the delivery seam factored out.
const NAMES = ['__state', '__computed', '__effect', '__batch'];
const runWith = (runtime, code, harness) =>
  new Function(...NAMES, `${code}\n${harness}`)(...NAMES.map((n) => runtime[n]));
const evalBoth = (src, harness) => runWith(rt, compile(src).code, harness);

describe('token fixtures: the `~>` spelling', () => {
  const stream = (src) => tokenize(src).tokens.map((t) => `${t.kind}:${t.value}`);

  test('`~>` is a single EFFECT token with an exact span, any spacing', () => {
    const { tokens } = tokenize('h ~> f()');
    expect(tokens.slice(0, 3).map((t) => t.kind)).toEqual(['IDENTIFIER', 'EFFECT', 'IDENTIFIER']);
    expect([tokens[1].start, tokens[1].end]).toEqual([2, 4]);
    expect(stream('h~> f()').slice(0, 2)).toEqual(['IDENTIFIER:h', 'EFFECT:~>']);
  });

  test('a typed handle collapses its annotation and stops at the effect head', () => {
    expect(stream('h: Function ~> f()').slice(0, 3)).toEqual(
      ['IDENTIFIER:h', 'TYPE:Function', 'EFFECT:~>']);
    expect(stream('h: (() => void) ~> f()').slice(0, 3)).toEqual(
      ['IDENTIFIER:h', 'TYPE:(() => void)', 'EFFECT:~>']);
  });

  test('neighboring spellings keep their meanings', () => {
    // `~` alone stays bitwise-not, `~=` the computed head; `!>` stays
    // schema-body-only (no main-grammar rule).
    expect(stream('y = ~x')).toEqual(['IDENTIFIER:y', '=:=', 'UNARY_MATH:~', 'IDENTIFIER:x']);
    expect(stream('t ~= 1')).toEqual(['IDENTIFIER:t', 'COMPUTED_ASSIGN:~=', 'NUMBER:1']);
    expect(stream('x = a > b')).toContain('COMPARE:>');
  });
});

describe('typed twin erasure', () => {
  test('the typed twin compiles byte-identical to its untyped twin (erasure-neutrality)', () => {
    expect(compile('h: Function ~> f()').code).toBe(compile('h ~> f()').code);
    expect(compile('export h: Function ~> f()').code).toBe(compile('export h ~> f()').code);
  });
});

describe('eval checks: paired runs against each side\'s own runtime', () => {
  test('THE END-TO-END PIN: a state write triggers the effect (both runtimes)', () => {
    const out = evalBoth(
 'count := 0\nlog = []\n~> log.push count\ncount = 5\ncount += 2',
 'return log;',
    );
    expect(out).toEqual([0, 5, 7]);
  });

  test('the dispose handle is real: calling it stops the effect', () => {
    const out = evalBoth(
 'count := 0\nlog = []\nh ~> log.push count\ncount = 1\nh()\ncount = 2',
 'return log;',
    );
    expect(out).toEqual([0, 1]);
  });

  test('the cleanup channel: a block body\'s returned function runs before each re-run and on dispose', () => {
    const out = evalBoth(
 'count := 0\nlog = []\nh ~>\n  c = count\n  -> log.push "clean #{c}"\ncount = 1\ncount = 2\nh()',
 'return log;',
    );
    expect(out).toEqual(['clean 0', 'clean 1', 'clean 2']);
  });

  test('effect-in-effect: the inner effect re-creates per outer run', () => {
    const out = evalBoth(
 'a := 0\nlog = []\n~>\n  v = a\n  ~> log.push v\na = 1',
 'return log;',
    );
    expect(out).toEqual([0, 1]);
  });

  test('batched writes flush once', () => {
    const out = evalBoth(
 'a := 0\nb := 0\nlog = []\n~> log.push [a, b]\n__batch ->\n  a = 1\n  b = 1',
 'return log;',
    );
    expect(out).toEqual([[0, 0], [1, 1]]);
  });

  test('a computed feeds an effect through the graph', () => {
    const out = evalBoth(
 'n := 1\ndouble ~= n * 2\nlog = []\n~> log.push double\nn = 3',
 'return log;',
    );
    expect(out).toEqual([2, 6]);
  });

  test('the  async BLOCK surface rides the ported AbortSignal machinery (stale runs abort)', async () => {
    // this side-only spelling (the old runtime compiles it to a SyntaxError — #90); the
    // signal comes from the delivered getEffectSignal name.
    const src = [
 'count := 0',
 'log = []',
 '~>',
 '  v = count',
 '  signal = getEffectSignal()',
 '  await new Promise (r) -> setTimeout r, 10',
 '  log.push [v, signal.aborted]',
 'count = 1',
    ].join('\n');
    const { code } = compile(src);
    expect(code).toContain('__effect(async () => {');
    const out = await new Function(...NAMES, 'getEffectSignal',
      `${code}\nreturn (async () => { await new Promise((r) => setTimeout(r, 50)); return log; })();`,
    )(...NAMES.map((n) => rt[n]), rt.getEffectSignal);
    // The first run (v=0) was superseded by the write — its signal
    // aborted; the second run (v=1) completed live.
    expect(out).toEqual([[0, true], [1, false]]);
  });
});

// ════════════════════════════════════════════════════════════════════
// Divergences: loud where the old runtime ships invalid or silently wrong JS
// ════════════════════════════════════════════════════════════════════

describe('the #79/the pinned contractes extend to effects: no expression form for the BOUND effect, plain-name handles', () => {

  test('a bare TAIL effect RETURNS the disposer (byte-matched): the caller owns disposal', () => {
    const out = evalBoth(
 'count := 0\nlog = []\nmake = ->\n  ~> log.push count\nstop = make()\ncount = 1\nstop()\ncount = 2',
 'return log;',
    );
    expect(out).toEqual([0, 1]);
  });

});

describe('the pinned contract extends to the dispose handle: bound effects sit at module or function scope', () => {

  test('module and function scope stay legal — including effect and computed block bodies (their own scopes)', () => {
    expect(compile('h ~> f()').code).toBe('const h = __effect(() => { f(); });');
    expect(compile('f = ->\n  h ~> g()\n  h').code).toContain('const h = __effect');
    expect(compile('~>\n  inner ~> f()\n  inner').code).toContain('const inner = __effect');
  });
});

describe(' extends: the effect head is spellable — semanticKind discriminates', () => {

  test('a user call does not trigger reactive delivery (zero-cost holds for the impersonating spelling)', () => {
    for (const mode of ['none', 'import', 'inline']) {
      const { code, runtimes } = fullCompile('effect = (a, b) -> a\nx = effect 1, 2', { runtimeDelivery: mode });
      expect([...runtimes]).toEqual([]);
      expect(code).not.toContain('__effect');
    }
  });
});

describe('emitter rejections carry source positions', () => {
  test('the effect and reactive rejection classes format as path:line:col with a caret', () => {
    const cases = [
      ['pad = 1\nif c\n  h ~> f()', /demo\.rip:3:3/],
      ['pad = 1\nif c\n  y := 1', /demo\.rip:3:3/],
      ['count := 0\ndelete count', /demo\.rip:2:1/],
      ['pad = 1\ny = (h ~> f())', /demo\.rip:2:6/],
      ['pad = 1\nobj.x ~> f()', /demo\.rip:2:1/],
      ['pad = 1\nclass A\n  x := 5', /demo\.rip:3:3/],
    ];
    for (const [src, re] of cases) {
      let err = null;
      try {
        fullCompile(src, { path: 'demo.rip' });
      } catch (e) {
        err = e;
      }
      expect(err).not.toBeNull();
      expect(err.message).toMatch(re);
      expect(err.message).toContain('^');
      expect(typeof err.line).toBe('number');
      expect(typeof err.col).toBe('number');
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// The mapping story: the debugging showcase
// ════════════════════════════════════════════════════════════════════

describe('mapping: effect bodies are exact where user code, covers over the scaffolding', () => {
  test('the bound declaration: target exact, operator cover over `~>` → `=`, value cover, $self cover', () => {
    const src = 'count := 0\nh ~>\n  console.log count';
    const { code, mappings, stores } = compile(src);
    const node = stores.nodesByKind('effect')[0];

    const target = mappings.of(node.nodeId, 'target');
    expect(target).toHaveLength(1);
    expect(target[0].mappingKind).toBe('exact');
    expect(src.slice(target[0].sourceStart, target[0].sourceEnd)).toBe('h');

    const op = mappings.of(node.nodeId, 'operator');
    expect(op).toHaveLength(1);
    expect(op[0].mappingKind).toBe('cover');
    expect(src.slice(op[0].sourceStart, op[0].sourceEnd)).toBe('~>');
    expect(code.slice(op[0].generatedStart, op[0].generatedEnd)).toBe('=');

    const value = mappings.of(node.nodeId, 'value');
    expect(value).toHaveLength(1);
    expect(value[0].mappingKind).toBe('cover');
    expect(code.slice(value[0].generatedStart, value[0].generatedEnd)).toContain('console.log(count.value)');

    const self = mappings.of(node.nodeId, '$self');
    expect(self).toHaveLength(1);
    expect(self[0].mappingKind).toBe('cover');
    expect(code.slice(self[0].generatedStart, self[0].generatedEnd))
      .toBe('const h = __effect(() => {\n  return console.log(count.value);\n})');
  });

  test('the bare form: the operator role covers the emitted `__effect` name — the `~>` glyph\'s manifestation', () => {
    const src = '~> f()';
    const { code, mappings, stores } = compile(src);
    const node = stores.nodesByKind('effect')[0];
    const op = mappings.of(node.nodeId, 'operator');
    expect(op).toHaveLength(1);
    expect(op[0].mappingKind).toBe('cover');
    expect(src.slice(op[0].sourceStart, op[0].sourceEnd)).toBe('~>');
    expect(code.slice(op[0].generatedStart, op[0].generatedEnd)).toBe('__effect');
    // The body expression stays exact inside the wrapper.
    const value = mappings.of(node.nodeId, 'value');
    expect(value[0].mappingKind).toBe('exact');
    expect(code.slice(value[0].generatedStart, value[0].generatedEnd)).toBe('f()');
  });

  test('the `() => {` scaffolding resolves through cover rows — never a fake exact', () => {
    const src = 'count := 0\n~>\n  count = count + 1';
    const { code, mappings } = compile(src);
    const arrow = code.indexOf('() =>');
    expect(mappings.atGenerated(arrow).every((r) => r.mappingKind !== 'exact')).toBe(true);
    expect(mappings.bestAtGenerated(arrow)).not.toBeNull();
    // User statements inside the wrapper keep exact rows; the
    // unwrapped read nests its exact row inside the sugar's cover.
    const read = code.indexOf('count.value + 1');
    const exact = mappings.atGenerated(read).find((r) => r.mappingKind === 'exact');
    expect(exact).toBeDefined();
    expect(src.slice(exact.sourceStart, exact.sourceEnd)).toBe('count');
  });

  test('a breakpoint on a statement inside an effect body lands on the .rip line', () => {
    const src = 'count := 0\n~>\n  probe(count)\ncount = 1';
    const { code, mappings } = compile(src);
    const call = code.indexOf('probe(count.value)');
    // Innermost exact at the call start is the callee identifier; the
    // call as a whole is a COVER by construction — the unwrap injected
    // `.value`, so its emitted slice no longer equals the source
    // (never a fake exact).
    const best = mappings.bestAtGenerated(call);
    expect(best.mappingKind).toBe('exact');
    expect(src.slice(best.sourceStart, best.sourceEnd)).toBe('probe');
    const callRow = mappings.atGenerated(call).find(
      (r) => r.role === '$self' && src.slice(r.sourceStart, r.sourceEnd) === 'probe(count)');
    expect(callRow.mappingKind).toBe('cover');
    // Forward: the source call resolves into the emitted wrapper.
    const fromSource = mappings.bestAtSource(src.indexOf('probe'));
    expect(code.slice(fromSource.generatedStart, fromSource.generatedEnd)).toContain('probe');
  });
});

describe('--explain tells the story at the effect operator', () => {
  test('at `~>`: the effect node, its roles, and the operator cover onto the lowering', () => {
    const out = explainSource('count := 0\nh ~> console.log count', { path: 'demo.rip', pos: { line: 2, col: 3 } });
    expect(out).toContain('effect');
    expect(out).toMatch(/roles:/);
    expect(out).toMatch(/operator +\[13,15\).*`~>`/);
    expect(out).toMatch(/target +\[11,12\).*`h`/);
    expect(out).toMatch(/operator +cover/);
  });
});

// ════════════════════════════════════════════════════════════════════
// Typed handles: erasure, declarations
// ════════════════════════════════════════════════════════════════════

describe('typed effect handles: erased twins, .d.ts surfaces the handle type', () => {
  test('declarations surface the annotated type directly (the handle is a plain const, no container)', () => {
    expect(fullCompile('export h: Function ~> f()').declarations)
      .toBe('export declare const h: Function;\n');
    expect(fullCompile('h: (() => void) ~> f()').declarations)
      .toBe('declare const h: (() => void);\nexport {};\n');
    // Untyped handles declare nothing (M8's contract).
    expect(fullCompile('export h ~> f()').declarations).toBe('');
  });

  test('the annotation records as a side-band role covering the whole emitted declaration', () => {
    const src = 'h: Function ~> f()';
    const { code, mappings, stores } = compile(src);
    const node = stores.nodesByKind('effect')[0];
    const role = stores.role(node.nodeId, 'annotation');
    expect(src.slice(role.sourceStart, role.sourceEnd)).toBe(': Function');
    const rows = mappings.of(node.nodeId, 'annotation');
    expect(rows).toHaveLength(1);
    expect(rows[0].mappingKind).toBe('cover');
    expect(code.slice(rows[0].generatedStart, rows[0].generatedEnd)).toBe('const h = __effect(() => { f(); })');
  });
});

// ════════════════════════════════════════════════════════════════════
// delivery: the lowering EMITS `__effect` — the seam delivers
// ════════════════════════════════════════════════════════════════════

describe('delivery triggers from the emitted lowering', () => {
  test("an effect-only file under 'import': one injected import, the runtime reported", () => {
    const { code, runtimes, mappings } = fullCompile('~> console.log 1', { runtimeDelivery: 'import' });
    expect([...runtimes]).toEqual(['reactive']);
    expect(code.split('\n')[0]).toMatch(/^import \{ __state, __computed, __effect, .* \} from ".*runtime\/reactive\.js";$/);
    expect(mappings.rows.find((r) => r.role === 'runtime').mappingKind).toBe('synthetic');
  });

  test('standalone: a reactive-triad file compiled inline runs in a fresh process', () => {
    const src = 'count := 1\ndouble ~= count * 2\n~> console.log double\ncount = 21\n';
    const { code } = fullCompile(src, { runtimeDelivery: 'inline' });
    expect(/^import /m.test(code)).toBe(false);
    // Value pin via none+binding — never eval the inline IIFE here.
    const seen = [];
    const { code: none } = compile('count := 1\ndouble ~= count * 2\n~> seen.push(double)\ncount = 21\n');
    new Function('__state', '__computed', '__effect', 'seen', none)(
      rt.__state, rt.__computed, rt.__effect, seen,
    );
    expect(seen).toEqual([2, 42]);
  });

  test('zero-cost: an effect-free file is byte-identical under every mode (the standing gate extends)', () => {
    const outputs = ['none', 'import', 'inline'].map((mode) =>
      fullCompile('x = 1 + 2\nf = (a) -> a * x', { runtimeDelivery: mode }));
    expect(outputs[0].code).toBe(outputs[1].code);
    expect(outputs[1].code).toBe(outputs[2].code);
    for (const o of outputs) expect([...o.runtimes]).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════

describe('schema callable bodies propagate runtime delivery', () => {
  const src = [
 'count := 0',
 'S = schema :shape',
 '  a! integer',
 '  watch: -> ~> console.log "sum #{@a + count}"',
 'v = S.parse {a: 1}',
 'stop = v.watch()',
 'count = 1',
 'stop()',
 'count = 2',
 '',
  ].join('\n');

  test('an effect inside a schema method reports BOTH runtimes in every mode', () => {
    for (const mode of ['none', 'import', 'inline']) {
      const { runtimes } = fullCompile(src, { runtimeDelivery: mode });
      expect([...runtimes].sort()).toEqual(['reactive', 'schema']);
    }
    // The import line itself carries the reactive names.
    const { code } = fullCompile(src, { runtimeDelivery: 'import' });
    expect(code).toMatch(/^import \{ __state, __computed, __effect, .* \} from ".*runtime\/reactive\.js";$/m);
    expect(code).toMatch(/^import \{ __schema, .* \} from ".*runtime\/schema\.js";$/m);
  });

  test("end-to-end 'inline': the method's effect tracks module state in a fresh process", async () => {
    const { code } = fullCompile(src, { runtimeDelivery: 'inline' });
    expect(/^import /m.test(code)).toBe(false);
    // Value pin via none+binding against shared schema + reactive modules.
    const schema = await import('../../src/runtime/schema.js');
    schema.__SchemaRegistry.reset();
    const seen = [];
    const valueSrc = [
      'count := 0',
      'S = schema :shape',
      '  a! integer',
      '  watch: -> ~> seen.push("sum #{@a + count}")',
      'v = S.parse {a: 1}',
      'stop = v.watch()',
      'count = 1',
      'stop()',
      'count = 2',
    ].join('\n');
    const { code: none } = compile(valueSrc);
    new Function('__schema', '__state', '__computed', '__effect', 'seen', none)(
      schema.__schema, rt.__state, rt.__computed, rt.__effect, seen,
    );
    // First run 1+0, the tracked write 1+1, disposed before count=2.
    expect(seen).toEqual(['sum 1', 'sum 2']);
  });

  test('effects in ensure bodies and field transforms trigger too; reactive declarations inside method bodies as well', () => {
    const ensureSrc = 'S = schema :input\n  a! integer\n  @ensure "x", (u) -> (~> probe(u)) and true';
    expect([...fullCompile(ensureSrc, { runtimeDelivery: 'import' }).runtimes].sort()).toEqual(['reactive', 'schema']);
    const transformSrc = 'S = schema :input\n  a integer, -> (~> probe(it)) and it';
    expect([...fullCompile(transformSrc, { runtimeDelivery: 'import' }).runtimes].sort()).toEqual(['reactive', 'schema']);
    const stateSrc = 'S = schema :shape\n  a! integer\n  m: ->\n    z := 1\n    z + @a';
    expect([...fullCompile(stateSrc, { runtimeDelivery: 'import' }).runtimes].sort()).toEqual(['reactive', 'schema']);
  });

  test("a schema-only file stays schema-only: the body's `~>` computed getter is schema spelling, and impersonating calls inside methods deliver nothing", () => {
    const getterSrc = 'S = schema :shape\n  a! integer\n  double: ~> @a * 2';
    expect([...fullCompile(getterSrc, { runtimeDelivery: 'import' }).runtimes]).toEqual(['schema']);
    const callSrc = 'S = schema :shape\n  a! integer\n  m: -> effect @a, 1';
    expect([...fullCompile(callSrc, { runtimeDelivery: 'import' }).runtimes]).toEqual(['schema']);
  });
});

describe('the cleanup channel surface', () => {
  test('GPT repro: a trailing helper definition IS the cleanup — it fires before each re-run and on dispose', () => {
    const out = evalBoth(
 'count := 0\ncalls = []\nh ~>\n  calls.push count\n  helper = -> calls.push "clean:" + count\ncount = 1\nh()',
 'return calls;',
    );
    // The "helper" runs as cleanup with the NEW value already written.
    expect(out).toEqual([0, 'clean:1', 1, 'clean:1']);
  });

  test('a non-function tail value is ignored — no cleanup installs', () => {
    const out = evalBoth(
 'count := 0\nlog = []\nh ~>\n  log.push count\n  42\ncount = 1\nh()',
 'return log;',
    );
    expect(out).toEqual([0, 1]);
  });

  test('data-dependent cleanup: an if/else tail installs cleanup only on the function-returning branch', () => {
    const out = evalBoth(
 'count := 0\nlog = []\nh ~>\n  v = count\n  if v == 0\n    -> log.push "clean0"\n  else\n    null\ncount = 1\ncount = 2\nh()',
 'return log;',
    );
    // Run v=0 installs; the v=1 re-run fires it and installs nothing;
    // later runs and the dispose find no cleanup.
    expect(out).toEqual(['clean0']);
  });

});

// ════════════════════════════════════════════════════════════════════
// Scaling: the surface machinery stays linear
// ════════════════════════════════════════════════════════════════════

describe('scaling gate: effect-heavy compilation doubles linearly', () => {
  test('N effects over N states: parse + emit stays linear', () => {
    expectLinearDoubling({
      prepare: (n) => {
        const lines = [];
        for (let i = 0; i < n; i++) lines.push(`s${i} := ${i}`);
        for (let i = 0; i < n; i++) lines.push(`h${i} ~> probe(s${i})`);
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
