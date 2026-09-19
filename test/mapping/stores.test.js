// NodeStore + RoleStore populated at reduce
// time, asserted by OFFSET — plus the store invariants over the corpus.
// The scaling gates live in stores-scaling.test.js.
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import parser from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { Stores } from '../../src/stores.js';
import { ripFiles } from '../support/rip-files.js';

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

describe('pass-through creates no identity', () => {
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

// A primitive tree value is a bare JS string — two occurrences of one name are
// the same value with no identity to tell them apart. PrimitiveStore is that
// identity: the lexer's own token span, kept alive across each reduce by the
// rule's carried-value refs. Only the TS face queries it, so recording is
// opt-in and OFF by default — the shipping JS compile pays nothing.
describe('PrimitiveStore: occurrence spans for primitive values', () => {
  const parseP = (src, opts) => {
    const r = parser.parse(src, opts);
    expect(r.diagnostics).toEqual([]);
    return { stores: new Stores(r.stores), raw: r.stores };
  };

  test('recording is off by default and on when asked', () => {
    expect(parseP('x = [a, a]').raw.primitives).toHaveLength(0);
    expect(parseP('x = [a, a]', { primitives: true }).raw.primitives.length).toBeGreaterThan(0);
  });

  test('each occurrence is stored once, and queries answer in source order', () => {
    const src = 'x = [a, a]\ny = a';
    const { stores, raw } = parseP(src, { primitives: true });
    const occurrences = raw.primitives.filter((p) => p.value === 'a');
    expect(occurrences.map(span)).toEqual([[5, 6], [8, 9], [15, 16]]);
    expect(new Set(occurrences.map((p) => `${p.sourceStart}:${p.sourceEnd}`)).size).toBe(3);
    expect(stores.primitiveSpans('a', 0, src.length).map(span)).toEqual([[5, 6], [8, 9], [15, 16]]);
  });

  test('a containment query returns only the occurrences inside its bounds', () => {
    const src = 'x = [a, a]\ny = a';
    const { stores } = parseP(src, { primitives: true });
    expect(stores.primitiveSpans('a', 0, 10).map(span)).toEqual([[5, 6], [8, 9]]);
    expect(stores.primitiveSpans('a', 11, src.length).map(span)).toEqual([[15, 16]]);
  });

  // The shapes the identifier-read gap lost: a comprehension's clause reads
  // survive the Parenthetical and the IIFE lowering, and a schema body's words
  // survive the collapse of the whole block into one opaque parser token.
  test.each([
    ['x = (n for n in nums)', ['n', 'nums']],
    ['x = (k for own k, v of ages)', ['k', 'v', 'ages']],
    ['Alpha = schema :shape\n  units!  number\n', ['units', 'number']],
  ])('%p records every read the source spells', (src, names) => {
    const { raw } = parseP(src, { primitives: true });
    for (const name of names) {
      const hits = raw.primitives.filter((p) => p.value === name);
      expect(hits.length, `${name} in ${src}`).toBeGreaterThan(0);
      for (const h of hits) expect(src.slice(h.sourceStart, h.sourceEnd)).toBe(name);
    }
  });
});

describe('$self extent: spans cover exactly real content', () => {
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

describe('CodeBuilder mark-span protocol', () => {
  test('an out-of-range source span rejects loudly, never clamps', async () => {
    // Every span derives from token offsets into the compiled source,
    // so an out-of-range span can only mean store corruption — and the
    // exactness check's length gate reads the span's nominal width,
    // which is equivalent to slicing only in-range. Rule 5: fail with
    // an identifying error instead of silently comparing over a clamp.
    const { CodeBuilder } = await import('../../src/builder.js');
    const stores = { node: () => ({ sourceStart: 0, sourceEnd: 1 }) };
    const b = new CodeBuilder(stores, { source: '' });
    b.beginMark(1, '$self');
    expect(() => b.endMark()).toThrow(
      /source span \[0, 1\) outside the source text \[0, 0\) — store-protocol violation/,
    );
  });
});

describe('store invariants over the corpus', () => {
  const corpusDir = join(import.meta.dir, '../corpus');
  const files = ripFiles(corpusDir);

  for (const file of files) {
    test(file, () => {
      const src = readFileSync(join(corpusDir, file), 'utf8');
      const { stores } = parse(src);
      const { nodes, roles } = stores;

      // Whitespace inside string/heredoc literals IS content: spans whose
      // edges land inside a STRING token's raw extent are exempt from the
      // no-whitespace-edges check (an interpolation chunk legitimately
      // starts at a newline).
      const { tokenize } = require('../../src/lexer.js');
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
        if ('literal' in r) {
          // Literal-sourced: value only, never a span.
          expect(r.grammarRef).toBeNull();
          expect('sourceStart' in r).toBe(false);
          expect('childNodeId' in r).toBe(false);
        } else {
          // A nested-node role has no grammarRef but a real span and a
          // child; a ref role has both.
          if (r.grammarRef === null) expect(stores.node(r.childNodeId)).not.toBeNull();
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

// ── the mapping query index ──────────────────────────────────────────
// atGenerated/atSource answer through a centered interval tree. These
// pins hold it to the full-scan CONTRACT (same rows, same order) and
// to its scaling promise.
describe('the mapping query index', () => {
  const bruteAtGenerated = (rows, x) => rows
    .filter((r) => r.generatedStart <= x && x < r.generatedEnd)
    .sort((a, b) => (a.generatedEnd - a.generatedStart) - (b.generatedEnd - b.generatedStart));
  const bruteAtSource = (rows, x) => rows
    .filter((r) => r.sourceStart <= x && x < r.sourceEnd)
    .sort((a, b) => (a.sourceEnd - a.sourceStart) - (b.sourceEnd - b.sourceStart));

  test('answers byte-identically to the full scan over the corpus, order included', async () => {
    const { compile } = await import('../../src/compile.js');
    const dir = join(import.meta.dir, '../corpus');
    for (const f of ripFiles(dir)) {
      const src = readFileSync(join(dir, f), 'utf8');
      const r = compile(src, { path: f });
      const m = r.mappings;
      const probes = [0, Math.max(0, r.code.length - 1)];
      for (let x = 0; x < r.code.length; x += 61) probes.push(x);
      for (let x = 0; x < src.length; x += 61) probes.push(x);
      for (const x of probes) {
        expect(m.atGenerated(x)).toEqual(bruteAtGenerated(m.rows, x));
        expect(m.atSource(x)).toEqual(bruteAtSource(m.rows, x));
      }
    }
  }, 30000);

  test('rows appended after a query are visible to the next query (count-keyed rebuild)', async () => {
    const { compile } = await import('../../src/compile.js');
    const r = compile('x = 1\ny = x + 2\n', { path: 'p.rip' });
    const m = r.mappings;
    const before = m.atGenerated(0).length;
    expect(before).toBeGreaterThan(0);
    m.rows.push({
      nodeId: -1, role: '$self', mappingKind: 'cover',
      sourceStart: 0, sourceEnd: 1, generatedStart: 0, generatedEnd: r.code.length, fileId: 0,
    });
    const after = m.atGenerated(0);
    expect(after.length).toBe(before + 1);
    expect(after).toEqual(bruteAtGenerated(m.rows, 0));
  });
});
