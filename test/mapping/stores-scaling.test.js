// The scaling gates over the stores — parse, tokenize (op counts), and
// emission — plus the mapping query index's. Split out of
// stores.test.js so `bun test --parallel`, which schedules whole files,
// runs the seconds of multi-thousand-line work here on a worker of its
// own instead of behind the store-row pins.
import { describe, test } from 'bun:test';
import parser from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { expectLinearDoubling, expectLinearOpsDoubling } from '../support/scaling.js';
import { describeExtended } from '../support/extended.js';

parser.lexer = makeParserLexer();

// The scaling gates run in the EXTENDED tier: they compile
// multi-thousand-line inputs at several sizes — seconds of work whose
// value is regression detection on the quadratic shapes, not
// per-change feedback — and the wall-clock gates are the suite's only
// load-sensitive tests, which the fast loop must not carry.
describeExtended('parse scaling', () => {
  // The tokenize gates below assert on RIP_COUNT_OPS iteration counts
  // (deterministic — exact, machine-independent, immune to CI load);
  // this parse gate and the emission gate stay WALL-CLOCK smoke gates,
  // the layer that still sees builtin costs (splice, GC, engine work)
  // the counters cannot.
  test('parse time grows roughly linearly with statement count', () => {
    // Spread-copying list rules made each doubling ~4x (240k lines took
    // 10.4s); accumulator compilation makes it ~2x. Bound sized for CI
    // noise: quadratic trips the checks at ~4x each.
    expectLinearDoubling({
      prepare: (n) => Array.from({ length: n }, (_, i) => `v${i} = ${i} + 1`).join('\n'),
      run: (src) => parser.parse(src),
      sizes: [2000, 4000, 8000],
    });
  });

  test('tokenize op count grows linearly with arrow-body count', async () => {
    // Audit #4's finding: implicitBlocks was the one insertion pass
    // still splicing per body (plus a whole-tail slice per body) —
    // quadratic that only arrow-heavy input triggers. Every insertion
    // pass ships a gate that actually TRIGGERS its insertions.
    const { tokenize } = await import('../../src/lexer.js');
    expectLinearOpsDoubling({
      prepare: (n) => Array.from({ length: n }, (_, i) => `f${i} = -> ${i}`).join('\n'),
      run: (src) => tokenize(src),
      sizes: [4000, 8000, 16000],
    });
  });

  test('tokenize op count grows linearly with implicit-object count', async () => {
    // The F3 mandate: an object-heavy gate lands WITH the pass — the
    // implicit-call gate below triggers zero object insertions, so it
    // cannot see a quadratic implicitObjects. Each statement is an
    // object-in-call (four generated tokens: { } CALL_START CALL_END).
    const { tokenize } = await import('../../src/lexer.js');
    expectLinearOpsDoubling({
      prepare: (n) => Array.from({ length: n }, (_, i) => `f a: ${i}, b: ${i}`).join('\n'),
      run: (src) => tokenize(src),
      sizes: [4000, 8000, 16000],
    });
  });

  test('tokenize op count grows linearly with multiline-collection count', async () => {
    // The layout gate: every statement is a multiline collection —
    // bracket-interior INDENT/OUTDENT synthesis, closer auto-outdents,
    // and trailing-TERMINATOR drops all trigger on each one. A gate
    // blind to bracket-interior layout cannot protect it.
    const { tokenize } = await import('../../src/lexer.js');
    expectLinearOpsDoubling({
      prepare: (n) => Array.from({ length: n }, (_, i) => `a${i} = [\n  ${i}\n  {k: ${i}}\n]`).join('\n'),
      run: (src) => tokenize(src),
      sizes: [4000, 8000, 16000],
    });
  });

  test('tokenize op count grows linearly with type-annotation count', async () => {
    // The collapse-pass gate: every statement TRIGGERS
    // rewriteTypes — a typed declaration, typed/defaulted params, and
    // a cast per line (collection runs, claims, splices) — so a
    // quadratic collapse or backscan cannot hide behind type-free
    // input (the scaling-gate policy).
    const { tokenize } = await import('../../src/lexer.js');
    expectLinearOpsDoubling({
      prepare: (n) => Array.from({ length: n }, (_, i) =>
        `v${i}: Map<string, number> = m${i} as T\nf${i} = (a: number, b: string = "s") -> a`).join('\n'),
      run: (src) => tokenize(src),
      sizes: [4000, 8000, 16000],
    });
  });

  test('tokenize op count grows linearly with type-declaration count', async () => {
    // The typed-field claims, each triggered on every repetition: a type
    // alias, an interface, a bare typed forward declaration, and a
    // typed class field. Bare object-key lines that DON'T claim ride
    // along — the assigned-later index must answer them without
    // rescanning the tape.
    const { tokenize } = await import('../../src/lexer.js');
    expectLinearOpsDoubling({
      prepare: (n) => Array.from({ length: n }, (_, i) => [
        `type T${i} = Map<string, number>`,
        `interface I${i}\n  x: number\n  y: string`,
        `r${i}: number\nr${i} = ${i}`,
        `k${i}: ${i}`,
        `class C${i}\n  a: number = ${i}\n  b: string`,
      ].join('\n')).join('\n'),
      run: (src) => tokenize(src),
      sizes: [2000, 4000, 8000],
    });
  });

  test('tokenize op count grows linearly with ONE long type body', async () => {
    // A single pathological alias body of n generic-tail lines: every
    // line-end consults the tail classifier. The scanner's type-body
    // floor answers each in O(1) — the walk-back it replaces was
    // O(line-index) each, quadratic per body.
    const { tokenize } = await import('../../src/lexer.js');
    expectLinearOpsDoubling({
      prepare: (n) => 'type R =\n' + Array.from({ length: n }, () => '  | Err<E>').join('\n') + '\ny = 2',
      run: (src) => tokenize(src),
      sizes: [4000, 8000, 16000],
    });
  });

  test('tokenize op count grows linearly with ADJACENT bare declarations (one sibling run)', async () => {
    // The sibling-run decision must walk each run ONCE (memoized per
    // colon): n adjacent forwards with n tail assignments would be
    // quadratic if every member re-walked the run.
    const { tokenize } = await import('../../src/lexer.js');
    expectLinearOpsDoubling({
      prepare: (n) => {
        const decls = Array.from({ length: n }, (_, i) => `r${i}: number`).join('\n');
        const assigns = Array.from({ length: n }, (_, i) => `r${i} = ${i}`).join('\n');
        return `${decls}\n${assigns}`;
      },
      run: (src) => tokenize(src),
      sizes: [2000, 4000, 8000],
    });
  });

  test('tokenize op count grows linearly with FAR-assigned bare declarations', async () => {
    // The adversarial shape: n bare declarations
    // whose assignments all sit at the block's TAIL — non-adjacent
    // (a plain statement separates decl lines so the sibling guard
    // never blocks the claim). A per-candidate forward scan is
    // O(block) each — quadratic; the per-block assignment index
    // answers each candidate in O(1).
    const { tokenize } = await import('../../src/lexer.js');
    expectLinearOpsDoubling({
      prepare: (n) => {
        const decls = Array.from({ length: n }, (_, i) => `r${i}: number\nsep${i} = 0`).join('\n');
        const assigns = Array.from({ length: n }, (_, i) => `r${i} = ${i}`).join('\n');
        return `${decls}\n${assigns}`;
      },
      run: (src) => tokenize(src),
      sizes: [2000, 4000, 8000],
    });
  });

  test('tokenize op count grows linearly with implicit-call count', async () => {
    // The plain-assignment gate above exercises ZERO insertions, so it
    // cannot see a quadratic insertion pass. This input makes every
    // statement an implicit call — two generated tokens each, O(n)
    // insertions total.
    const { tokenize } = await import('../../src/lexer.js');
    expectLinearOpsDoubling({
      prepare: (n) => Array.from({ length: n }, (_, i) => `f x${i}`).join('\n'),
      run: (src) => tokenize(src),
      sizes: [4000, 8000, 16000],
    });
  });

  test('tokenize op count grows linearly with trailing-angle chain lines', async () => {
    // The tokenizer memo shape: angle-balanced trailing-`>` logical
    // lines. Each line-end consults closesTypeGeneric; the walk-back
    // re-read the whole accumulated logical line per line (~3.7x per
    // doubling measured); the incremental memo processes every token
    // once and answers each line in O(1). Both recorded shapes gate:
    // the parse-rejected `foo a<b>` lines and the LEGAL multi-line
    // comparison chain.
    const { tokenize } = await import('../../src/lexer.js');
    expectLinearOpsDoubling({
      prepare: (n) => Array.from({ length: n }, () => 'foo a<b>').join('\n'),
      run: (src) => tokenize(src),
      sizes: [4000, 8000, 16000],
    });
    expectLinearOpsDoubling({
      prepare: (n) => 'z =\n' + Array.from({ length: n }, () => '  a < b >').join('\n') + '\n  c',
      run: (src) => tokenize(src),
      sizes: [4000, 8000, 16000],
    });
  });

  test('tokenize op count grows linearly with nested pick depth', async () => {
    // Deep pick-in-default nesting (`o.{a = o.{a = …}}`): each close
    // brace reads its PICK_END identity from the open-bracket frame in
    // O(1) — a per-pick forward matching walk re-reads every nested
    // body and is quadratic exactly here (~135x linear cost at depth
    // 2000 when this gate landed).
    const { tokenize } = await import('../../src/lexer.js');
    expectLinearOpsDoubling({
      prepare: (n) => 'x = ' + 'o.{a = '.repeat(n) + '1' + '}'.repeat(n),
      run: (src) => tokenize(src),
      sizes: [1000, 2000, 4000],
    });
  });

  test('tokenize op count grows linearly with schema count', async () => {
    // The gate that TRIGGERS the schema collapse pass: every statement
    // is a schema declaration, so the pass parses and replaces O(n)
    // regions. The pass rebuilds the tape ONCE (a splice per schema
    // would be quadratic exactly here).
    const { tokenize } = await import('../../src/lexer.js');
    expectLinearOpsDoubling({
      prepare: (n) => Array.from({ length: n }, (_, i) => `S${i} = schema :shape\n  a! string, 2..9\n  b? integer`).join('\n'),
      run: (src) => tokenize(src),
      sizes: [2000, 4000, 8000],
    });
  });
});

describeExtended('emission scaling', () => {
  test('emit time grows roughly linearly with input size', async () => {
    const { emit } = await import('../../src/emitter.js');
    // Sizes matter: per-mark flattening of the growing output buffer only
    // shows its quadratic clearly at large N (triple-ratio ~5 first
    // appears above ~3k lines). 9k → 27k separates cleanly: linear ~3x,
    // per-mark row scans or buffer flattens ~8x. Parse is hoisted out of
    // the measured region by prepare().
    expectLinearDoubling({
      prepare: (n) => {
        const src = Array.from({ length: n }, (_, i) => `v${i} = ${i} + 1`).join('\n');
        return { parsed: parser.parse(src), src };
      },
      run: ({ parsed, src }) => emit(parsed, { source: src }),
      sizes: [9000, 27000],
      bound: 5,
    });
  // The gate retries three times (min-of-5 at 27k lines each) precisely
  // when the machine is slow; the runner's 15 s default cut those
  // retries off on a hosted CI box (2026-08-24, "timed out after
  // 15000ms" with ~1 s locally). The verdict is still the CPU-time
  // ratio — the clock must not veto it.
  }, 60000);

  // S6: a flat chain's n nested marks each cover an O(n) region, so
  // any per-mark work proportional to the region (the old
  // join-and-compare exactness check) is quadratic exactly here —
  // 10000 `<` links cost ~2.4 s pre-fix. The length gate answers the
  // paren/lowering shapes (`+`, `and`, `<`) in O(1); the member spine
  // is fully exact and relies on the per-delta memo to verify each
  // generated byte once. Both paths need pinning: a gate blind to
  // either cannot protect it.
  test('S6 count gate: deep-chain emit walk stays linear per doubling, every chain shape', async () => {
    const { emit } = await import('../../src/emitter.js');
    const links = (n, sep) => 'x = ' + Array.from({ length: n + 1 }, (_, i) => `a${i}`).join(sep);
    const shapes = [
      (n) => links(n, ' + '),
      (n) => links(n, ' and '),
      (n) => links(n, ' < '),
      (n) => 'x = a' + Array.from({ length: n }, (_, i) => `.b${i}`).join(''),
    ];
    for (const shape of shapes) {
      // Counts sum the lexer passes (parse) and the builder's
      // exactness walk (emit) — both linear, so the ratio stays ~2×;
      // a quadratic walk doubles at ~4× and fails structurally.
      expectLinearOpsDoubling({
        prepare: shape,
        run: (src) => emit(parser.parse(src), { source: src }),
        sizes: [2000, 4000, 8000],
      });
    }
  });

  test('S6 wall-clock gate: deep member-spine emit stays linear', async () => {
    const { emit } = await import('../../src/emitter.js');
    // The member spine is the shape the count gate alone cannot fully
    // protect: a regression to whole-region string building (join,
    // slice) spends its time in builtins the counters never see.
    // Sizes cap at 8000: chains are NESTED nodes, and the emitter's
    // recursive pre-passes exhaust the engine stack in the twenty-
    // thousands (the nesting-bound backstop's territory) — far
    // above 8000 the gate would measure the crash path, not scaling.
    const gen = (n) => 'x = a' + Array.from({ length: n }, (_, i) => `.b${i}`).join('');
    expectLinearDoubling({
      prepare: (n) => {
        const src = gen(n);
        return { parsed: parser.parse(src), src };
      },
      run: ({ parsed, src }) => emit(parsed, { source: src }),
      sizes: [2000, 4000, 8000],
    });
  });
});

// ── the mapping query index ──────────────────────────────────────────
// The count gate on atGenerated/atSource's centered interval tree; the
// full-scan contract pins sit beside the index in stores.test.js.
describe('the mapping query index', () => {
  test('scaling: an n-query batch over an n-statement program stays near-linear in index ops', async () => {
    const { compile } = await import('../../src/compile.js');
    const { syncCounterFlag } = await import('../../src/counter.js');
    expectLinearOpsDoubling({
      prepare: (n) => {
        const src = Array.from({ length: n }, (_, i) => `v${i} = w${i}.p.q + ${i}`).join('\n');
        const r = compile(src, { path: 'scale.rip' });
        const offsets = Array.from({ length: n }, (_, i) => (i * 7919) % r.code.length);
        return { m: r.mappings, offsets };
      },
      run: ({ m, offsets }) => {
        syncCounterFlag(); // count index build + queries only, not the compile
        for (const x of offsets) m.bestAtGenerated(x);
      },
      sizes: [250, 500, 1000, 2000],
    });
  }, 30000);
});
