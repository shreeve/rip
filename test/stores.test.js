// NodeStore + RoleStore populated at reduce
// time, asserted by OFFSET — plus the §4.6 store invariants over the corpus.
import { describe, test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import parser from '../src/parser.js';
import { makeParserLexer } from '../src/lexer.js';
import { Stores } from '../src/stores.js';
import { expectLinearDoubling, expectLinearOpsDoubling } from './support/scaling.js';
import { describeExtended } from './support/extended.js';

parser.lexer = makeParserLexer();

const parse = (src) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  return { sexpr: r.sexpr, stores: new Stores(r.stores), raw: r.stores };
};

const span = (row) => [row.sourceStart, row.sourceEnd];

describe('store rows: x = y + 1', () => {
  const { stores } = parse('x = y + 1');
  const [assign] = stores.nodesByKind('assign');
  const [binary] = stores.nodesByKind('binary');

  test('assign.$self spans the whole statement', () => {
    expect(stores.selfSpan(assign.nodeId)).toEqual([0, 9]);
  });

  test('assign.operator is literal-sourced: static value "=", no span', () => {
    const op = stores.role(assign.nodeId, 'operator');
    expect(op.grammarRef).toBeNull();
    expect(op.literal).toBe('=');
    expect('sourceStart' in op).toBe(false);
    expect('sourceEnd' in op).toBe(false);
  });

  test('assign.target spans `x`', () => {
    expect(span(stores.role(assign.nodeId, 'target'))).toEqual([0, 1]);
  });

  test('assign.value spans `y + 1` and joins to the binary node', () => {
    const value = stores.role(assign.nodeId, 'value');
    expect(span(value)).toEqual([4, 9]);
    expect(value.childNodeId).toBe(binary.nodeId);
  });

  test('binary.$self spans `y + 1`', () => {
    expect(stores.selfSpan(binary.nodeId)).toEqual([4, 9]);
  });

  test('binary.left spans `y`', () => {
    expect(span(stores.role(binary.nodeId, 'left'))).toEqual([4, 5]);
  });

  test('binary.operator is literal-sourced: static value "+", no span', () => {
    const op = stores.role(binary.nodeId, 'operator');
    expect(op.grammarRef).toBeNull();
    expect(op.literal).toBe('+');
    expect('sourceStart' in op).toBe(false);
  });

  test('binary.right spans `1`', () => {
    expect(span(stores.role(binary.nodeId, 'right'))).toEqual([8, 9]);
  });
});

describe('store rows for the core constructs', () => {
  test('def: name/params/body spans', () => {
    const src = 'def add(a, b)\n  return a + b';
    const { stores } = parse(src);
    const [def] = stores.nodesByKind('def');
    expect(stores.selfSpan(def.nodeId)).toEqual([0, src.length]);
    expect(span(stores.role(def.nodeId, 'name'))).toEqual([4, 7]);       // add
    expect(span(stores.role(def.nodeId, 'params'))).toEqual([7, 13]);    // (a, b) — OptParams extent
    expect(span(stores.role(def.nodeId, 'body'))).toEqual([16, 28]);     // `return a + b` exactly
    const [ret] = stores.nodesByKind('return');
    expect(stores.selfSpan(ret.nodeId)).toEqual([16, 28]);               // return a + b
    expect(span(stores.role(ret.nodeId, 'value'))).toEqual([23, 28]);    // a + b
  });

  test('call: callee span + spread args extent', () => {
    const { stores } = parse('add(1, 2)');
    const [call] = stores.nodesByKind('call');
    expect(stores.selfSpan(call.nodeId)).toEqual([0, 9]);
    expect(span(stores.role(call.nodeId, 'callee'))).toEqual([0, 3]);
    const args = stores.role(call.nodeId, 'args');
    expect(args.spread).toBe(true);
    expect(span(args)).toEqual([3, 9]);   // Arguments: CALL_START..CALL_END
    expect(args.childNodeId).toBeNull();  // per-element spans live on the children
  });

  test('member: object/property spans, "." literal-sourced', () => {
    const { stores } = parse('obj.prop');
    const [member] = stores.nodesByKind('member');
    expect(stores.selfSpan(member.nodeId)).toEqual([0, 8]);
    expect(span(stores.role(member.nodeId, 'object'))).toEqual([0, 3]);
    expect(span(stores.role(member.nodeId, 'property'))).toEqual([4, 8]);
    expect(stores.role(member.nodeId, 'operator').literal).toBe('.');
  });

  test('if: condition/then/else spans', () => {
    const src = 'if a\n  b\nelse\n  c';
    const { stores } = parse(src);
    const [ifNode] = stores.nodesByKind('if');
    expect(stores.selfSpan(ifNode.nodeId)).toEqual([0, 17]);
    expect(span(stores.role(ifNode.nodeId, 'condition'))).toEqual([3, 4]);
    expect(span(stores.role(ifNode.nodeId, 'then'))).toEqual([7, 8]);    // `b` exactly — no indent, no newline
    expect(span(stores.role(ifNode.nodeId, 'else'))).toEqual([9, 17]);   // else..`c` end
  });

  test('return without a value has no value role', () => {
    const { stores } = parse('return');
    const [ret] = stores.nodesByKind('return');
    expect(stores.selfSpan(ret.nodeId)).toEqual([0, 6]);
    expect(stores.role(ret.nodeId, 'value')).toBeNull();
  });

  test('assignment, INDENT form: value span inside the block', () => {
    const { stores } = parse('x =\n  5');
    const [assign] = stores.nodesByKind('assign');
    expect(stores.selfSpan(assign.nodeId)).toEqual([0, 7]);
    expect(span(stores.role(assign.nodeId, 'target'))).toEqual([0, 1]);
    expect(span(stores.role(assign.nodeId, 'value'))).toEqual([6, 7]);
  });

  test('assignment, TERMINATOR form: value on the next line', () => {
    const { stores } = parse('q =\n9');
    const [assign] = stores.nodesByKind('assign');
    expect(stores.selfSpan(assign.nodeId)).toEqual([0, 5]);
    expect(span(stores.role(assign.nodeId, 'value'))).toEqual([4, 5]);
  });

  test('assignment with a member target joins target to the member node', () => {
    const { stores } = parse('obj.prop = 1');
    const [assign] = stores.nodesByKind('assign');
    const [member] = stores.nodesByKind('member');
    const target = stores.role(assign.nodeId, 'target');
    expect(span(target)).toEqual([0, 8]);
    expect(target.childNodeId).toBe(member.nodeId);
    expect(span(stores.role(assign.nodeId, 'value'))).toEqual([11, 12]);
  });
});

describe('un-annotated constructed nodes get rows', () => {
  test('list-plumbing arrays (Body) have semanticKind null with ruleId set', () => {
    const { stores } = parse('a = 1\nb = 2');
    const plain = stores.nodes.filter(n => n.semanticKind === null);
    expect(plain.length).toBeGreaterThan(0);
    for (const n of plain) expect(n.ruleId).toBeGreaterThan(0);
  });

  test('empty Arguments constructs a node row spanning the parens', () => {
    const { stores } = parse('f()');
    const empty = stores.nodes.find(n => n.semanticKind === null && n.sourceStart === 1);
    expect(stores.selfSpan(empty.nodeId)).toEqual([1, 3]);
  });
});

describe('§4.6: pass-through creates no identity', () => {
  // Exact node counts: every count below includes ONLY constructed arrays
  // (construct rules + list plumbing). Any pass-through or Parenthetical
  // reduction registering its child again would inflate these.
  test.each([
    ['x = y + 1', 4],       // binary, assign, Body, program
    ['(y + 1)', 4],         // binary, paren-Body, Body, program — Parenthetical itself passes through
    ['x = 1; b = 2', 4],    // assign, Body (ONE row — the accumulator grows), assign, program
    ['((z))', 4],           // two paren-Bodys, Body, program — both paren layers pass through
  ])('%p constructs exactly %i nodes', (src, count) => {
    const { stores } = parse(src);
    expect(stores.nodes.length).toBe(count);
  });

  test('accumulator lists keep ONE row whose span grows to the full extent', () => {
    const src = 'a = 1\nb = 2\nc = 3';
    const { stores } = parse(src);
    const lists = stores.nodes.filter(n => n.semanticKind === null);
    expect(lists).toHaveLength(1); // one Body row, not one per reduction
    expect(src.slice(lists[0].sourceStart, lists[0].sourceEnd)).toBe(src); // grew to cover all statements
  });

  test('a parenthesized node keeps one identity through the pass-through', () => {
    const { stores, sexpr } = parse('(y + 1)');
    // The binary node in the tree is the SAME array the Parenthetical
    // returned; exactly one binary row exists and program's tree holds it.
    expect(stores.nodesByKind('binary')).toHaveLength(1);
    expect(sexpr[1][0]).toBe('+');
  });
});

describe('§4.6 $self extent: spans cover exactly real content', () => {
  test('trailing blank/comment lines never extend a block or if span', () => {
    const src = 'if a\n  return a\n\n# c\n\nz = 1';
    const { stores } = parse(src);
    const [ifNode] = stores.nodesByKind('if');
    // Ends exactly at `return a`'s end — not at the dedent line.
    expect(src.slice(...stores.selfSpan(ifNode.nodeId))).toBe('if a\n  return a');
    const [block] = stores.nodesByKind('block');
    expect(src.slice(...stores.selfSpan(block.nodeId))).toBe('return a');
  });

  test('INDENT-form assignment stops at its value', () => {
    const src = 'x =\n  5\n';
    const { stores } = parse(src);
    const [assign] = stores.nodesByKind('assign');
    expect(src.slice(...stores.selfSpan(assign.nodeId))).toBe('x =\n  5');
  });
});

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
    const { tokenize } = await import('../src/lexer.js');
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
    const { tokenize } = await import('../src/lexer.js');
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
    const { tokenize } = await import('../src/lexer.js');
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
    const { tokenize } = await import('../src/lexer.js');
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
    const { tokenize } = await import('../src/lexer.js');
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
    const { tokenize } = await import('../src/lexer.js');
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
    const { tokenize } = await import('../src/lexer.js');
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
    const { tokenize } = await import('../src/lexer.js');
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
    const { tokenize } = await import('../src/lexer.js');
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
    const { tokenize } = await import('../src/lexer.js');
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
    const { tokenize } = await import('../src/lexer.js');
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
    const { tokenize } = await import('../src/lexer.js');
    expectLinearOpsDoubling({
      prepare: (n) => Array.from({ length: n }, (_, i) => `S${i} = schema :shape\n  a! string, 2..9\n  b? integer`).join('\n'),
      run: (src) => tokenize(src),
      sizes: [2000, 4000, 8000],
    });
  });
});

describeExtended('emission scaling', () => {
  test('emit time grows roughly linearly with input size', async () => {
    const { emit } = await import('../src/emitter.js');
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
  });

  // S6: a flat chain's n nested marks each cover an O(n) region, so
  // any per-mark work proportional to the region (the old
  // join-and-compare exactness check) is quadratic exactly here —
  // 10000 `<` links cost ~2.4 s pre-fix. The length gate answers the
  // paren/lowering shapes (`+`, `and`, `<`) in O(1); the member spine
  // is fully exact and relies on the per-delta memo to verify each
  // generated byte once. Both paths need pinning: a gate blind to
  // either cannot protect it.
  test('S6 count gate: deep-chain emit walk stays linear per doubling, every chain shape', async () => {
    const { emit } = await import('../src/emitter.js');
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
    const { emit } = await import('../src/emitter.js');
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

describe('CodeBuilder mark-span protocol', () => {
  test('an out-of-range source span rejects loudly, never clamps', async () => {
    // Every span derives from token offsets into the compiled source,
    // so an out-of-range span can only mean store corruption — and the
    // exactness check's length gate reads the span's nominal width,
    // which is equivalent to slicing only in-range. Rule 5: fail with
    // an identifying error instead of silently comparing over a clamp.
    const { CodeBuilder } = await import('../src/builder.js');
    const stores = { node: () => ({ sourceStart: 0, sourceEnd: 1 }) };
    const b = new CodeBuilder(stores, { source: '' });
    b.beginMark(1, '$self');
    expect(() => b.endMark()).toThrow(
      /source span \[0, 1\) outside the source text \[0, 0\) — store-protocol violation/,
    );
  });
});

describe('§4.6 invariants over the corpus', () => {
  const corpusDir = join(import.meta.dir, 'corpus');
  const files = readdirSync(corpusDir).filter(f => f.endsWith('.rip')).sort();

  for (const file of files) {
    test(file, () => {
      const src = readFileSync(join(corpusDir, file), 'utf8');
      const { stores } = parse(src);
      const { nodes, roles } = stores;

      // Whitespace inside string/heredoc literals IS content: spans whose
      // edges land inside a STRING token's raw extent are exempt from the
      // no-whitespace-edges check (an interpolation chunk legitimately
      // starts at a newline).
      const { tokenize } = require('../src/lexer.js');
      const stringRanges = tokenize(src).tokens
        .filter(t => t.kind === 'STRING' || t.kind === 'STRING_START' || t.kind === 'STRING_END')
        .map(t => [t.start, t.end]);
      const inString = (o) => stringRanges.some(([s, e]) => s <= o && o <= e);

      // Dense nodeIds from 1, in registration order.
      nodes.forEach((n, i) => expect(n.nodeId).toBe(i + 1));

      for (const n of nodes) {
        expect(n.fileId).toBe(0);
        expect(n.sourceStart).toBeGreaterThanOrEqual(0);
        expect(n.sourceEnd).toBeGreaterThanOrEqual(n.sourceStart);
        expect(n.sourceEnd).toBeLessThanOrEqual(src.length);
        // $self extent: the span covers the construct's non-trivia
        // source extent, including any real delimiter tokens — so its
        // edges land on real content, never on whitespace or trivia. One
        // matched TERMINATOR may close a span (its newline is a real
        // grammar symbol: `When ... TERMINATOR`) — and symmetrically may
        // OPEN one: a list rule whose first symbol is an empty production
        // anchored at its separator (`AssignList(ε) OptComma TERMINATOR
        // AssignObj` in an unindented brace body) starts on that matched
        // newline. A single newline at either edge is legal; anything
        // more is leakage. String-literal interiors are content, exempt
        // from the edge check.
        const slice = src.slice(n.sourceStart, n.sourceEnd);
        if (!inString(n.sourceStart)) {
          const led = slice.startsWith('\r\n') ? slice.slice(2) : (slice.startsWith('\n') ? slice.slice(1) : slice);
          expect(led).not.toMatch(/^\s/);
        }
        if (!inString(n.sourceEnd)) {
          const trimmed = slice.endsWith('\n') ? slice.slice(0, -1) : slice;
          expect(trimmed).not.toMatch(/\s$/);
        }
      }

      for (const r of roles) {
        const owner = stores.node(r.nodeId);
        expect(owner).not.toBeNull();
        expect(r.fileId).toBe(0);
        if (r.grammarRef === null) {
          // Literal-sourced: value only, never a span.
          expect('sourceStart' in r).toBe(false);
          expect('childNodeId' in r).toBe(false);
        } else {
          // Containment: every role span sits inside its owner's span.
          expect(r.sourceStart).toBeGreaterThanOrEqual(owner.sourceStart);
          expect(r.sourceEnd).toBeLessThanOrEqual(owner.sourceEnd);
          expect(r.sourceStart).toBeLessThanOrEqual(r.sourceEnd);
          // Every childNodeId resolves to an existing node row.
          if (r.childNodeId !== null) {
            expect(stores.node(r.childNodeId)).not.toBeNull();
          }
          if (r.spread) expect(r.childNodeId).toBeNull();
        }
      }
    });
  }
});
