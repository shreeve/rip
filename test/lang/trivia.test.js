// The trivia channel (the bound v1): comments and blank-line runs are
// span-anchored lexer facts — never parser input — relayed verbatim
// through parse() and compile() for rewrite/LSP consumers. The
// concrete consumer pinned here is the span-based rename: RoleStore
// spans locate every occurrence of a name in SOURCE bytes, the edit
// splices those spans only, and comment bytes survive untouched by
// construction (no reprinting, no comment re-attachment policy —
// exactly the v1 scope; leading/trailing attachment stays out until
// a consumer needs it).
import { describe, test, expect } from 'bun:test';
import { compile } from '../../src/compile.js';
import { Parser } from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';

const src = [
  '# doubles the counter value',
  'count = 1  # the counter',
  '',
  '# reads count twice',
  'double = -> count + count',
  '',
].join('\n');

describe('trivia channel through parse() and compile()', () => {
  test('parse() relays the lexer trivia channel', () => {
    const parser = Parser();
    parser.lexer = makeParserLexer('unit.rip');
    const result = parser.parse(src);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.trivia.map((t) => t.kind)).toEqual(['comment', 'blank', 'comment', 'blank', 'comment', 'blank']);
    for (const t of result.trivia) {
      expect(src.slice(t.start, t.end)).toBe(t.text);
    }
  });

  test('parse() relays trivia on FAILED parses too — scan-time fact', () => {
    const parser = Parser();
    parser.lexer = makeParserLexer('unit.rip');
    const result = parser.parse('# a comment\na + * b\n');
    expect(result.sexpr).toBeNull();
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.trivia.some((t) => t.kind === 'comment' && t.text === '# a comment')).toBe(true);
  });

  test('compile() exposes the channel with source-true spans', () => {
    const { trivia } = compile(src, { path: 'unit.rip' });
    const comments = trivia.filter((t) => t.kind === 'comment').map((t) => t.text);
    expect(comments).toEqual(['# doubles the counter value', '# the counter', '# reads count twice']);
    for (const t of trivia) {
      expect(src.slice(t.start, t.end)).toBe(t.text);
      expect(t.start).toBeLessThanOrEqual(t.end);
    }
    // Source order, non-overlapping.
    for (let i = 1; i < trivia.length; i++) {
      expect(trivia[i].start).toBeGreaterThanOrEqual(trivia[i - 1].end);
    }
  });

  test('a lexer without a trivia channel relays null (protocol-optional)', () => {
    const parser = Parser();
    parser.lexer = {
      inner: makeParserLexer('unit.rip'),
      setInput(input) { this.inner.setInput(input); },
      lex() { const k = this.inner.lex(); this.text = this.inner.text; this.loc = this.inner.loc; return k; },
    };
    const result = parser.parse('x = 1\n');
    expect(result.trivia).toBeNull();
  });
});

describe('the rewrite consumer: span-based rename keeps comment bytes untouched', () => {
  // Every RoleStore span whose source text is exactly the old name is
  // a rename site (role spans point at real source extents; comments
  // are not in any of them — they never reach the parser).
  const renameSpans = (stores, source, oldName) => {
    const spans = [];
    for (const r of stores.roles) {
      if (r.sourceStart == null) continue; // literal-sourced roles carry no span
      if (source.slice(r.sourceStart, r.sourceEnd) === oldName) {
        spans.push([r.sourceStart, r.sourceEnd]);
      }
    }
    // Distinct spans, descending — splices never shift earlier offsets.
    const seen = new Set();
    return spans
      .filter(([a, b]) => !seen.has(`${a}:${b}`) && seen.add(`${a}:${b}`))
      .sort(([a], [b]) => b - a);
  };

  test('renaming `count` → `total` preserves every comment byte and the program meaning', () => {
    const before = compile(src, { path: 'unit.rip' });
    let text = src;
    const spans = renameSpans(before.stores, src, 'count');
    expect(spans.length).toBeGreaterThanOrEqual(3); // the target + two reads
    for (const [a, b] of spans) {
      text = text.slice(0, a) + 'total' + text.slice(b);
    }

    // The rename landed everywhere...
    const after = compile(text, { path: 'unit.rip' });
    expect(after.code).toContain('total = 1');
    expect(after.code).toContain('total + total');
    expect(after.code).not.toMatch(/\bcount\b/);

    // ...and the comments are byte-identical, shifted but intact.
    const commentTexts = (t) => t.filter((x) => x.kind === 'comment').map((x) => x.text);
    expect(commentTexts(after.trivia)).toEqual(commentTexts(before.trivia));
    for (const t of after.trivia) {
      expect(text.slice(t.start, t.end)).toBe(t.text);
    }
    // The comment SOURCE BYTES were never edited: every comment in the
    // rewritten text is the original byte sequence.
    for (const original of commentTexts(before.trivia)) {
      expect(text).toContain(original);
    }
  });
});
