// Offset-native lexer: span correctness, the loc-freshness contract,
// synthetic-token conventions, trivia retention, and
// call-paren disambiguation.
import { describe, test, expect } from 'bun:test';
import { tokenize, makeParserLexer } from '../src/lexer.js';

const kinds = (text) => tokenize(text).tokens.map(t => t.kind);
const values = (text) => tokenize(text).tokens.map(t => t.value);
const spans = (text) => tokenize(text).tokens.map(t => [t.kind, t.start, t.end]);

describe('token spans', () => {
  test('simple expression spans', () => {
    expect(spans('x = y + 1')).toEqual([
      ['IDENTIFIER', 0, 1],
      ['=', 2, 3],
      ['IDENTIFIER', 4, 5],
      ['+', 6, 7],
      ['NUMBER', 8, 9],
    ]);
  });

  test('every non-generated token span slices back to its value', () => {
    const text = 'total = obj.compute(3.14, "hi") + f(x)\nif total > 5\n  y = -total\n';
    const { tokens, source } = tokenize(text);
    for (const t of tokens) {
      if (!t.generated) {
        expect(source.slice(t.start, t.end)).toBe(t.value);
      }
    }
  });

  test('astral-plane string literals carry UTF-16 spans', () => {
    const { tokens, source } = tokenize('x = "😀"\ny = 1');
    const str = tokens.find(t => t.kind === 'STRING');
    expect(str.start).toBe(4);
    expect(str.end).toBe(8); // quote + 2-unit emoji + quote
    expect(source.slice(str.start, str.end)).toBe('"😀"');
    const y = tokens.find(t => t.kind === 'IDENTIFIER' && t.value === 'y');
    expect(y.start).toBe(9);
  });
});

describe('loc-freshness contract', () => {
  test('each lex() yields a distinct loc object; mutation cannot alias', () => {
    const lexer = makeParserLexer();
    lexer.setInput('a = b');
    lexer.lex();
    const first = lexer.loc;
    lexer.lex();
    const second = lexer.loc;
    expect(first).not.toBe(second);
    first.start = 999;
    first.end = 999;
    expect(second.start).toBe(2);
    expect(second.end).toBe(3);
  });
});

// origin references stable token IDS, never tape indices.
const byId = (tokens, id) => tokens.find(t => t.id === id);

describe('synthetic tokens', () => {
  test('INDENT/OUTDENT are zero-width, generated, with origin (by ID) at the next real token', () => {
    const { tokens } = tokenize('if x\n  y\nz');
    const indent = tokens.find(t => t.kind === 'INDENT');
    const outdent = tokens.find(t => t.kind === 'OUTDENT');
    expect(indent.start).toBe(indent.end);
    expect(indent.generated).toBe(true);
    expect(byId(tokens, indent.origin).value).toBe('y');
    expect(outdent.start).toBe(outdent.end);
    expect(outdent.generated).toBe(true);
    expect(byId(tokens, outdent.origin).value).toBe('z');
    expect(byId(tokens, outdent.origin).generated).toBe(false);
  });

  test('stacked OUTDENTs all resolve origin to the first real token of the dedented line', () => {
    const { tokens } = tokenize('if a\n  if b\n    c\nz');
    const outdents = tokens.filter(t => t.kind === 'OUTDENT');
    expect(outdents).toHaveLength(2);
    for (const outdent of outdents) {
      expect(byId(tokens, outdent.origin).value).toBe('z');
      expect(byId(tokens, outdent.origin).generated).toBe(false);
    }
  });

  test('inserted implicit-block tokens carry minted ids and id-based origins', () => {
    const { tokens } = tokenize('f = (x) -> x * 2');
    const maxScanId = Math.max(...tokens.filter(t => !t.generated).map(t => t.id));
    const indent = tokens.find(t => t.kind === 'INDENT');
    const outdent = tokens.find(t => t.kind === 'OUTDENT');
    expect(indent.generated).toBe(true);
    expect(indent.id).toBeGreaterThan(maxScanId); // minted by the insertion pass
    const bodyX = byId(tokens, indent.origin);
    expect([bodyX.value, bodyX.start]).toEqual(['x', 11]); // anchored at the body's first real token
    expect(indent.start).toBe(11);
    expect(indent.end).toBe(11);
    expect(outdent.start).toBe(16); // end of `2`, the last real body token
    expect(outdent.origin).toBeNull(); // nothing follows
    // THEN retags in place: its record (and id) persists as the INDENT.
    const thenCase = tokenize('if a then b');
    const thenIndent = thenCase.tokens.find(t => t.kind === 'INDENT');
    expect(thenIndent.generated).toBe(true);
    expect(byId(thenCase.tokens, thenIndent.origin).value).toBe('b');
  });

  test('OUTDENTs at end of input have no following real token; origin stays null', () => {
    const { tokens } = tokenize('if a\n  b');
    const outdent = tokens.find(t => t.kind === 'OUTDENT');
    expect(outdent.origin).toBeNull();
  });

  test('implicit CALL_START/CALL_END are zero-width generated tokens with minted ids and honest anchors', () => {
    const src = 'f x, y';
    const { tokens } = tokenize(src);
    const maxScanId = Math.max(...tokens.filter(t => !t.generated).map(t => t.id));
    const cs = tokens.find(t => t.kind === 'CALL_START');
    const ce = tokens.find(t => t.kind === 'CALL_END');
    expect(cs.generated).toBe(true);
    expect(cs.id).toBeGreaterThan(maxScanId);
    expect([cs.start, cs.end]).toEqual([2, 2]); // zero-width at the first argument's start
    expect(byId(tokens, cs.origin).value).toBe('x'); // origin = the trigger token
    expect(ce.generated).toBe(true);
    expect([ce.start, ce.end]).toEqual([6, 6]); // zero-width at the last argument's end
    expect(byId(tokens, ce.origin).value).toBe('y'); // origin = last real token before the close
  });

  test('implicit-object braces are zero-width generated tokens with minted ids and honest anchors', () => {
    const src = 'x = a: 1, b: 2';
    const { tokens } = tokenize(src);
    const maxScanId = Math.max(...tokens.filter(t => !t.generated).map(t => t.id));
    const open = tokens.find(t => t.kind === '{');
    const close = tokens.find(t => t.kind === '}');
    expect(open.generated).toBe(true);
    expect(open.id).toBeGreaterThan(maxScanId);
    expect([open.start, open.end]).toEqual([4, 4]); // zero-width at the first key's start
    expect(byId(tokens, open.origin).value).toBe('a'); // origin = the key that triggered it
    expect(close.generated).toBe(true);
    expect([close.start, close.end]).toEqual([14, 14]); // zero-width at the last value's end
    expect(byId(tokens, close.origin).value).toBe('2');
  });

  test('object-in-call: CALL_START anchors through the generated brace to a REAL origin', () => {
    const { tokens } = tokenize('f a: 1');
    const cs = tokens.find(t => t.kind === 'CALL_START');
    const origin = byId(tokens, cs.origin);
    expect(origin.generated).toBe(false);
    expect(origin.value).toBe('a');
  });

  test('TERMINATOR carries the span of the newline that ended the line', () => {
    const { tokens, source } = tokenize('a = 1\nb = 2');
    const term = tokens.find(t => t.kind === 'TERMINATOR');
    expect(source.slice(term.start, term.end)).toBe('\n');
    expect(term.start).toBe(5);
  });

  test('TERMINATOR span survives intervening comment and blank lines', () => {
    const { tokens, source } = tokenize('a = 1\n# c\n\nb = 2');
    const term = tokens.find(t => t.kind === 'TERMINATOR');
    expect(term.start).toBe(5);
    expect(term.end).toBe(6);
    expect(source.slice(term.start, term.end)).toBe('\n');
  });

  test('open blocks close with OUTDENTs at end of input', () => {
    expect(kinds('if a\n  if b\n    c')).toEqual([
      'IF', 'IDENTIFIER', 'INDENT', 'IF', 'IDENTIFIER', 'INDENT', 'IDENTIFIER', 'OUTDENT', 'OUTDENT',
    ]);
  });

  test('no TERMINATOR before else', () => {
    expect(kinds('if a\n  b\nelse\n  c')).toEqual([
      'IF', 'IDENTIFIER', 'INDENT', 'IDENTIFIER', 'OUTDENT', 'ELSE', 'INDENT', 'IDENTIFIER', 'OUTDENT',
    ]);
  });
});

describe('operator and keyword tokens', () => {
  test('operators tokenize longest-match first with correct spans', () => {
    expect(spans('a **= 2')).toEqual([
      ['IDENTIFIER', 0, 1],
      ['COMPOUND_ASSIGN', 2, 5],
      ['NUMBER', 6, 7],
    ]);
    expect(kinds('a ** b')).toEqual(['IDENTIFIER', '**', 'IDENTIFIER']);
    expect(kinds('a ??= b')).toEqual(['IDENTIFIER', 'COMPOUND_ASSIGN', 'IDENTIFIER']);
    expect(kinds('a ?? b && c || d')).toEqual(['IDENTIFIER', '??', 'IDENTIFIER', '&&', 'IDENTIFIER', '||', 'IDENTIFIER']);
    expect(kinds('!a')).toEqual(['UNARY_MATH', 'IDENTIFIER']);
  });

  test("word compound assignments: 'and='/'or=' are COMPOUND_ASSIGN", () => {
    const { tokens } = tokenize('x and= y\nz or= w');
    const andEq = tokens.find(t => t.kind === 'COMPOUND_ASSIGN' && t.value === '&&=');
    expect([andEq.start, andEq.end]).toEqual([2, 6]); // spans `and=`
    const orEq = tokens.find(t => t.kind === 'COMPOUND_ASSIGN' && t.value === '||=');
    expect([orEq.start, orEq.end]).toEqual([11, 14]); // spans `or=`
  });

  test('word aliases carry the operator VALUE with the word span', () => {
    const { tokens } = tokenize('x = a and b or not c');
    const and = tokens.find(t => t.start === 6);
    expect([and.kind, and.value, and.end]).toEqual(['&&', '&&', 9]);
    const or = tokens.find(t => t.start === 12);
    expect([or.kind, or.value, or.end]).toEqual(['||', '||', 14]);
    const not = tokens.find(t => t.start === 15);
    expect([not.kind, not.value, not.end]).toEqual(['UNARY', '!', 18]); // word-not is UNARY; symbol ! is UNARY_MATH
  });

  test('literal keywords tokenize with their kinds', () => {
    expect(kinds('true false null undefined while until')).toEqual([
      'BOOL', 'BOOL', 'NULL', 'UNDEFINED', 'WHILE', 'UNTIL',
    ]);
  });

  test('numeric literals: radix prefixes, separators, BigInt', () => {
    expect(values('x = 0xff')).toEqual(['x', '=', '0xff']);
    expect(values('x = 0b1010')).toEqual(['x', '=', '0b1010']);
    expect(values('x = 0o755')).toEqual(['x', '=', '0o755']);
    expect(values('x = 1_000_000')).toEqual(['x', '=', '1_000_000']);
    expect(values('x = 2.5e-3')).toEqual(['x', '=', '2.5e-3']);
    expect(values('x = 10n')).toEqual(['x', '=', '10n']);
    expect(() => tokenize('x = 0XFF')).toThrow(/radix prefix.*must be lowercase/);
    expect(() => tokenize('x = 089')).toThrow(/must not be prefixed with '0'/);
    expect(() => tokenize('x = 0755')).toThrow(/octal literal.*must be prefixed with '0o'/);
  });

  test('bitwise and shift operators lex', () => {
    expect(kinds('a & b')).toEqual(['IDENTIFIER', '&', 'IDENTIFIER']);
    expect(kinds('a | b')).toEqual(['IDENTIFIER', '|', 'IDENTIFIER']);
    expect(kinds('a ^ b')).toEqual(['IDENTIFIER', '^', 'IDENTIFIER']);
    expect(kinds('a << 2')).toEqual(['IDENTIFIER', 'SHIFT', 'NUMBER']);
    expect(kinds('a >>> 2')).toEqual(['IDENTIFIER', 'SHIFT', 'NUMBER']);
    expect(kinds('a >>>= 2')).toEqual(['IDENTIFIER', 'COMPOUND_ASSIGN', 'NUMBER']);
    expect(kinds('~a')).toEqual(['UNARY_MATH', 'IDENTIFIER']);
  });
});

describe('collection tokens', () => {
  test("unspaced '[' after an indexable token indexes; otherwise array literal", () => {
    expect(kinds('a[0]')).toEqual(['IDENTIFIER', 'INDEX_START', 'NUMBER', 'INDEX_END']);
    // Spaced: an array-literal ARGUMENT of an implicit call.
    expect(kinds('a [0]')).toEqual(['IDENTIFIER', 'CALL_START', '[', 'NUMBER', ']', 'CALL_END']);
    expect(kinds('[1]')).toEqual(['[', 'NUMBER', ']']);
    expect(kinds('f(1)[0]')).toEqual(['IDENTIFIER', 'CALL_START', 'NUMBER', 'CALL_END', 'INDEX_START', 'NUMBER', 'INDEX_END']);
    expect(kinds('[1][0]')).toEqual(['[', 'NUMBER', ']', 'INDEX_START', 'NUMBER', 'INDEX_END']);
    expect(kinds('"s"[0]')).toEqual(['STRING', 'INDEX_START', 'NUMBER', 'INDEX_END']);
    expect(kinds('a[0](x)')).toEqual(['IDENTIFIER', 'INDEX_START', 'NUMBER', 'INDEX_END', 'CALL_START', 'IDENTIFIER', 'CALL_END']);
  });

  test('braces and pairs tokenize; range dots longest-match before dot', () => {
    expect(kinds('{a: 1}')).toEqual(['{', 'PROPERTY', ':', 'NUMBER', '}']); // key-position identifiers are properties
    expect(spans('a[1..3]')).toEqual([
      ['IDENTIFIER', 0, 1], ['INDEX_START', 1, 2], ['NUMBER', 2, 3],
      ['..', 3, 5], ['NUMBER', 5, 6], ['INDEX_END', 6, 7],
    ]);
    expect(kinds('[1...5]')).toEqual(['[', 'NUMBER', '...', 'NUMBER', ']']);
    expect(kinds('a.b')).toEqual(['IDENTIFIER', '.', 'PROPERTY']);
  });

  test('mismatched closers fail loudly', () => {
    expect(() => tokenize('a = 1]')).toThrow(/unmatched/);
    expect(() => tokenize('a = 1}')).toThrow(/unmatched/);
    expect(() => tokenize('f(a]')).toThrow(/unmatched/);
    expect(() => tokenize('x = [1, 2')).toThrow(/unclosed/);
    expect(() => tokenize('x = {a: 1')).toThrow(/unclosed/);
  });
});

describe('the tagParams pass', () => {
  test('arrow params retag to PARAM_START/PARAM_END (retag-only: indices stable)', () => {
    const before = tokenize('f = (a, b) ->\n  a').tokens;
    expect(before.map(t => t.kind)).toEqual([
      'IDENTIFIER', '=', 'PARAM_START', 'IDENTIFIER', ',', 'IDENTIFIER', 'PARAM_END', '->',
      'INDENT', 'IDENTIFIER', 'OUTDENT',
    ]);
    // Spans are the original paren spans — retagged, not re-lexed.
    const open = before.find(t => t.kind === 'PARAM_START');
    expect([open.start, open.end, open.value]).toEqual([4, 5, '(']);
  });

  test('a call before a bare arrow does NOT retag; the arrow becomes an implicit-call argument', () => {
    expect(kinds('f(a) ->\n  1')).toEqual([
      'IDENTIFIER', 'CALL_START', 'IDENTIFIER', 'CALL_END',
      'CALL_START', '->', 'INDENT', 'NUMBER', 'OUTDENT', 'CALL_END',
    ]);
  });

  test('grouping parens not followed by an arrow stay parens', () => {
    expect(kinds('x = (a)')).toEqual(['IDENTIFIER', '=', '(', 'IDENTIFIER', ')']);
  });

  test("'@prop' is a property; spaced '@ name' is an implicit call on this", () => {
    expect(kinds('@count')).toEqual(['@', 'PROPERTY']);
    expect(kinds('@ count')).toEqual(['@', 'CALL_START', 'IDENTIFIER', 'CALL_END']); // this(count)
    expect(kinds('this')).toEqual(['THIS']);
  });

  test("spaced '?' is TERNARY; unspaced '?' is the postfix existence token", () => {
    expect(kinds('a ? b : c')).toEqual(['IDENTIFIER', 'TERNARY', 'IDENTIFIER', ':', 'IDENTIFIER']);
    expect(kinds('a?')).toEqual(['IDENTIFIER', '?']);
    expect(kinds('f(x)?')).toEqual(['IDENTIFIER', 'CALL_START', 'IDENTIFIER', 'CALL_END', '?']);
    // With no value before it, an unspaced '?' is nothing.
    expect(() => tokenize('x =? 1')).toThrow(/unspaced '\?' needs a value/);
  });

  test("'?.', '++', '--', '->', '=>' tokenize with correct spans", () => {
    expect(spans('a?.b')).toEqual([
      ['IDENTIFIER', 0, 1], ['?.', 1, 3], ['PROPERTY', 3, 4],
    ]);
    expect(kinds('i++')).toEqual(['IDENTIFIER', '++']);
    expect(kinds('--i')).toEqual(['--', 'IDENTIFIER']);
    expect(kinds('=>')).toEqual(['=>']);
  });
});

describe('the tagPostfixConditionals pass', () => {
  test('postfix IF/UNLESS retag; prefix forms stay (retag-only pass)', () => {
    expect(kinds('b = 1 if a')).toEqual(['IDENTIFIER', '=', 'NUMBER', 'POST_IF', 'IDENTIFIER']);
    expect(kinds('b = 1 unless a')).toEqual(['IDENTIFIER', '=', 'NUMBER', 'POST_UNLESS', 'IDENTIFIER']);
    expect(kinds('if a\n  b')).toEqual(['IF', 'IDENTIFIER', 'INDENT', 'IDENTIFIER', 'OUTDENT']);
    expect(kinds('unless a\n  b')).toEqual(['UNLESS', 'IDENTIFIER', 'INDENT', 'IDENTIFIER', 'OUTDENT']);
    // Mid-line prefix if with a block still counts as prefix.
    expect(kinds('x = if a\n  1')).toEqual(['IDENTIFIER', '=', 'IF', 'IDENTIFIER', 'INDENT', 'NUMBER', 'OUTDENT']);
  });

  test("`in`/`of` are FORIN/FOROF after FOR on the line, RELATION elsewhere (seenFor)", () => {
    expect(kinds('for x in arr\n  x')).toEqual(['FOR', 'IDENTIFIER', 'FORIN', 'IDENTIFIER', 'INDENT', 'IDENTIFIER', 'OUTDENT']);
    expect(kinds('for k of obj\n  k')).toEqual(['FOR', 'IDENTIFIER', 'FOROF', 'IDENTIFIER', 'INDENT', 'IDENTIFIER', 'OUTDENT']);
    expect(kinds('x = a in b')).toEqual(['IDENTIFIER', '=', 'IDENTIFIER', 'RELATION', 'IDENTIFIER']);
    // Only the FIRST in/of after FOR is the connector.
    expect(kinds('for x in a in b\n  x')).toEqual(['FOR', 'IDENTIFIER', 'FORIN', 'IDENTIFIER', 'RELATION', 'IDENTIFIER', 'INDENT', 'IDENTIFIER', 'OUTDENT']);
  });

  test("`when` at a logical-line start is LEADING_WHEN; mid-line is WHEN", () => {
    const tape = tokenize('switch x\n  when 1\n    y\nfor a in b when a\n  a').tokens.map(t => t.kind);
    expect(tape).toContain('LEADING_WHEN');
    expect(tape).toContain('WHEN');
  });

  test('statement keywords carry their word as the token value', () => {
    const { tokens } = tokenize('break\ncontinue\ndebugger');
    const stmts = tokens.filter(t => t.kind === 'STATEMENT').map(t => t.value);
    expect(stmts).toEqual(['break', 'continue', 'debugger']);
  });

  test('catch/finally continue the enclosing try (no TERMINATOR before them)', () => {
    expect(kinds('try\n  a\ncatch e\n  b')).toEqual([
      'TRY', 'INDENT', 'IDENTIFIER', 'OUTDENT', 'CATCH', 'IDENTIFIER', 'INDENT', 'IDENTIFIER', 'OUTDENT',
    ]);
  });
});

describe('trivia channel', () => {
  test('comments and blank lines are retained with spans, not tokenized', () => {
    const text = '# leading comment\nx = 1\n\ny = 2  # trailing\n';
    const { tokens, trivia, source } = tokenize(text);
    expect(tokens.some(t => t.kind === 'COMMENT')).toBe(false);
    const comments = trivia.filter(t => t.kind === 'comment');
    expect(comments).toHaveLength(2);
    expect(source.slice(comments[0].start, comments[0].end)).toBe('# leading comment');
    expect(source.slice(comments[1].start, comments[1].end)).toBe('# trailing');
    expect(trivia.some(t => t.kind === 'blank')).toBe(true);
  });
});

describe('call-paren disambiguation', () => {
  test("'(' after a callable with no space opens a call", () => {
    expect(kinds('f(1)')).toEqual(['IDENTIFIER', 'CALL_START', 'NUMBER', 'CALL_END']);
  });

  test("'(' after space or at expression start groups", () => {
    expect(kinds('(1)')).toEqual(['(', 'NUMBER', ')']);
    expect(kinds('x = (1)')).toEqual(['IDENTIFIER', '=', '(', 'NUMBER', ')']);
  });

  test('nested and chained calls pair correctly', () => {
    expect(kinds('f(g(1), (2))')).toEqual([
      'IDENTIFIER', 'CALL_START', 'IDENTIFIER', 'CALL_START', 'NUMBER', 'CALL_END',
      ',', '(', 'NUMBER', ')', 'CALL_END',
    ]);
    expect(kinds('h()()')).toEqual(['IDENTIFIER', 'CALL_START', 'CALL_END', 'CALL_START', 'CALL_END']);
  });

  test('identifier after dot is a PROPERTY, even for keywords', () => {
    expect(kinds('a.if')).toEqual(['IDENTIFIER', '.', 'PROPERTY']);
  });

  test('a word directly followed by `:` is a PROPERTY key before it is a keyword (colon capture)', () => {
    expect(kinds('x = {when: 1, if: 2, for: 3}')).toEqual([
      'IDENTIFIER', '=', '{', 'PROPERTY', ':', 'NUMBER', ',',
      'PROPERTY', ':', 'NUMBER', ',', 'PROPERTY', ':', 'NUMBER', '}',
    ]);
    expect(kinds('x = {and: 1, break: 2, is: 3}').filter(k => k === 'PROPERTY')).toHaveLength(3);
    // Ternary branches stay guarded; `::`/`:=` never key.
    expect(kinds('x = a ? b: 1')).toEqual(['IDENTIFIER', '=', 'IDENTIFIER', 'TERNARY', 'IDENTIFIER', ':', 'NUMBER']);
  });
});

describe('indentation is a literal prefix (tabs, spaces, consistent mixes)', () => {
  test('tab-indented blocks nest by textual containment', () => {
    expect(kinds('if a\n\tx = 1\n\ty = 2')).toEqual([
      'IF', 'IDENTIFIER', 'INDENT', 'IDENTIFIER', '=', 'NUMBER',
      'TERMINATOR', 'IDENTIFIER', '=', 'NUMBER', 'OUTDENT',
    ]);
    expect(kinds('if a\n\tif b\n\t\tc(1)\n\td(2)')).toEqual([
      'IF', 'IDENTIFIER', 'INDENT', 'IF', 'IDENTIFIER', 'INDENT',
      'IDENTIFIER', 'CALL_START', 'NUMBER', 'CALL_END', 'OUTDENT', 'TERMINATOR',
      'IDENTIFIER', 'CALL_START', 'NUMBER', 'CALL_END', 'OUTDENT',
    ]);
  });

  test('a mixed prefix nests when it EXTENDS the enclosing prefix', () => {
    expect(kinds('if a\n\tif b\n\t  c(1)')).toEqual([
      'IF', 'IDENTIFIER', 'INDENT', 'IF', 'IDENTIFIER', 'INDENT',
      'IDENTIFIER', 'CALL_START', 'NUMBER', 'CALL_END', 'OUTDENT', 'OUTDENT',
    ]);
  });

  test('INDENT/OUTDENT anchors are unchanged by how indentation is measured', () => {
    const src = 'if a\n\tx = 1\n';
    const { tokens } = tokenize(src);
    const indent = tokens.find(t => t.kind === 'INDENT');
    const outdent = tokens.find(t => t.kind === 'OUTDENT');
    expect([indent.start, indent.end]).toEqual([6, 6]);   // first real token of the block: `x`
    expect([outdent.start, outdent.end]).toEqual([11, 11]); // end of `1`, the block's last real token
    expect(byId(tokens, indent.origin).value).toBe('x');
  });

  test('inconsistent mixing rejects loudly, naming both prefixes', () => {
    // The classic trap: a tab and spaces that LOOK equal at some
    // editor tab width.
    expect(() => tokenize('if a\n\tif b\n  c 1')).toThrow(/inconsistent indentation: "  " neither extends the enclosing block's "\\t"/);
    expect(() => tokenize('if a\n        x = 1\n\ty = 2')).toThrow(/inconsistent indentation: "\\t"/);
    expect(() => tokenize('if a\n\tif b\n\t\tc 1\n\t    d 2')).toThrow(/inconsistent indentation: "\\t {4}"/);
  });

  test('mid-line tabs are plain whitespace', () => {
    expect(kinds('x =\t1')).toEqual(['IDENTIFIER', '=', 'NUMBER']);
    const { tokens } = tokenize('x =\t1');
    expect(tokens[2].spaced).toBe(true);
  });

  test('class bodies work per indentation style: spaces, tabs, consistent-mixed, CRLF', () => {
    const spaces = 'class A\n  m: -> 1\n  n: -> 2';
    const tabs = 'class A\n\tm: -> 1\n\tn: -> 2';
    const mixed = 'class A\n\t m: -> 1\n\t n: -> 2';
    const expected = kinds(spaces);
    expect(expected[0]).toBe('CLASS');
    expect(kinds(tabs)).toEqual(expected);
    expect(kinds(mixed)).toEqual(expected);
    expect(kinds(spaces.replace(/\n/g, '\r\n'))).toEqual(expected);
  });

  test('destructuring works per indentation style: spaces, tabs, consistent-mixed, CRLF', () => {
    const spaces = 'try\n  f()\ncatch {message}\n  g message';
    const tabs = 'try\n\tf()\ncatch {message}\n\tg message';
    const expected = kinds(spaces);
    expect(expected).toContain('CATCH');
    expect(kinds(tabs)).toEqual(expected);
    expect(kinds(spaces.replace(/\n/g, '\r\n'))).toEqual(expected);
  });

  test('indented implicit objects work per indentation style: spaces, tabs, consistent-mixed', () => {
    // Layout-interacting features get fixtures per indentation
    // style. The token stream must be identical across all three.
    const spaces = 'x =\n  a: 1\n  b: 2';
    const tabs = 'x =\n\ta: 1\n\tb: 2';
    const mixed = 'x =\n\t a: 1\n\t b: 2';
    const expected = kinds(spaces);
    expect(expected).toContain('{');
    expect(expected).toContain('}');
    expect(kinds(tabs)).toEqual(expected);
    expect(kinds(mixed)).toEqual(expected);
    // CRLF twin: identical stream too.
    expect(kinds(spaces.replace(/\n/g, '\r\n'))).toEqual(expected);
  });
});

describe('CRLF line endings', () => {
  test('\\r\\n is one line terminator; TERMINATOR spans both characters', () => {
    const src = 'a = 1\r\nb = 2';
    const { tokens } = tokenize(src);
    const term = tokens.find(t => t.kind === 'TERMINATOR');
    expect([term.start, term.end]).toEqual([5, 7]); // [start of \r, end of \n)
    expect(term.value).toBe('\r\n');
    expect(kinds(src)).toEqual(kinds('a = 1\nb = 2'));
  });

  test('layout across CRLF matches the LF twin; spans stay raw-source offsets', () => {
    const crlf = 'if a\r\n  x = 1\r\ny = 2';
    const lf = 'if a\n  x = 1\ny = 2';
    expect(kinds(crlf)).toEqual(kinds(lf));
    const { tokens } = tokenize(crlf);
    const x = tokens.find(t => t.value === 'x');
    expect(crlf.slice(x.start, x.end)).toBe('x'); // offsets index the RAW source
  });

  test('blank-line and comment trivia spans cover the full \\r\\n', () => {
    const src = 'a = 1\r\n\r\n# note\r\nb = 2';
    const { trivia } = tokenize(src);
    const blank = trivia.find(t => t.kind === 'blank');
    expect(src.slice(blank.start, blank.end)).toBe('\r\n');
    const comment = trivia.find(t => t.kind === 'comment');
    expect(src.slice(comment.start, comment.end)).toBe('# note'); // the \r is line ending, not comment text
  });

  test('heredoc VALUES normalize \\r\\n to \\n; spans stay raw', () => {
    const src = 'x = """\r\n  a\r\n  b\r\n  """';
    const { tokens } = tokenize(src);
    const str = tokens.find(t => t.kind === 'STRING');
    expect(str.value).toBe('`a\nb`');
    expect(src.slice(str.start, str.end)).toBe('"""\r\n  a\r\n  b\r\n  """');
  });

  test('bare \\r (not followed by \\n) rejects loudly', () => {
    expect(() => tokenize('x = 1\ry = 2')).toThrow(/bare carriage return/);
    expect(() => tokenize('x = "a\rb"')).toThrow(/unterminated string/);
  });
});

describe('rejection', () => {

  test('unterminated strings fail loudly', () => {
    expect(() => tokenize('x = "abc')).toThrow(/unterminated string/);
  });

  test('unmatched parens fail loudly', () => {
    expect(() => tokenize('f(1')).toThrow(/unclosed/);
    expect(() => tokenize('f 1)')).toThrow(/unmatched/);
  });

  test('unclosed brackets reject at the OUTERMOST opener with its glyph and span, not at end of input', () => {
    const rejectsAt = (src, glyph, start) => {
      let err = null;
      try { tokenize(src); } catch (e) { err = e; }
      expect(err).not.toBeNull();
      expect(err.reason).toBe(`unclosed '${glyph}' — never closed by end of input`);
      expect(err.start).toBe(start);
      // The span covers the opener's own glyph — an editor squiggle
      // lands on the bracket, never zero-width.
      expect(err.end).toBe(start + glyph.length);
    };
    rejectsAt('x = 1\ny = f(a, b\nz = 3\n', '(', 11);
    rejectsAt('a = [1, 2\nb = 4\n', '[', 4);
    rejectsAt('o = {a: 1\nc = 5\n', '{', 4);
    rejectsAt('x = "a#{b\n', '#{', 6);
    // Every openBracket site owns its offset — the heregex interp,
    // pick brace, and optional call/index forms open frames at
    // positions the plain forms never exercise.
    rejectsAt('x = ///a#{b\n', '#{', 8);
    rejectsAt('y = o.{a\n', '{', 6);
    rejectsAt('y = a?.(1\n', '(', 7);
    rejectsAt('y = a?.[1\n', '[', 7);
    // Nested unclosed: the outermost opener is the FIRST in source
    // order that never finds its closer — everything still open at
    // EOF nests inside it.
    rejectsAt('y = f(a, [b\n', '(', 5);
    // Inner brackets that DID close never shadow the open outer frame.
    rejectsAt('y = f(g(1), h(2)\nz = 1\n', '(', 5);
  });

  test('inconsistent dedent fails loudly', () => {
    expect(() => tokenize('if a\n    b\n  c')).toThrow(/inconsistent indentation/);
  });

  test('malformed bracket-interior layout fails loudly', () => {
    // A dedent inside a bracket must return to an exact open prefix.
    expect(() => tokenize('x = [\n    1\n  2\n]')).toThrow(/inconsistent indentation/);
    // A dedent can never cross the innermost bracket's indentation
    // floor — the closer must sit at or above the indent its bracket
    // opened at.
    expect(() => tokenize('def f()\n  x = [\n    1\n]')).toThrow(/crosses the enclosing bracket's indentation floor/);
    // A comma-continuation line must sit at an exact open prefix too.
    expect(() => tokenize('f 1, ->\n    2\n  , 3')).toThrow(/inconsistent indentation/);
    // Brackets left open across indentation still fail at end of input.
    expect(() => tokenize('x = [\n  1\n')).toThrow(/unclosed/);
  });

  test('bracket-interior INDENT/OUTDENT anchor inside the construct with resolving origins', () => {
    const src = 'x = [\n  1\n  2\n]';
    const { tokens } = tokenize(src);
    const indent = tokens.find((t) => t.kind === 'INDENT');
    const outdent = tokens.find((t) => t.kind === 'OUTDENT');
    // INDENT: zero-width at the first element; OUTDENT: zero-width at
    // the last element's end — never on the brackets or whitespace.
    expect([indent.start, indent.end]).toEqual([src.indexOf('1'), src.indexOf('1')]);
    expect([outdent.start, outdent.end]).toEqual([src.indexOf('2') + 1, src.indexOf('2') + 1]);
    // Origins resolve to real tokens (the element and the closer).
    const byId = new Map(tokens.map((t) => [t.id, t]));
    expect(byId.get(indent.origin).value).toBe('1');
    expect(byId.get(outdent.origin).value).toBe(']');
    // The separator TERMINATOR carries the newline it stands for.
    const sep = tokens.find((t) => t.kind === 'TERMINATOR');
    expect(src.slice(sep.start, sep.end)).toBe('\n');
  });

  test('unicode identifiers tokenize with UTF-16 spans', () => {
    expect(spans('café = 1')).toEqual([
      ['IDENTIFIER', 0, 4], ['=', 5, 6], ['NUMBER', 7, 8],
    ]);
    // Astral identifiers: the emoji is two UTF-16 units.
    expect(spans('😀x = 2')).toEqual([
      ['IDENTIFIER', 0, 3], ['=', 4, 5], ['NUMBER', 6, 7],
    ]);
  });

  test('interpolation produces the interpolation token shapes with REAL source spans', () => {
    const { tokens } = tokenize('x = "Hello #{who}!"');
    expect(tokens.map(t => t.kind)).toEqual([
      'IDENTIFIER', '=', 'STRING_START', 'STRING', 'INTERPOLATION_START',
      'IDENTIFIER', 'INTERPOLATION_END', 'STRING', 'STRING_END',
    ]);
    const who = tokens.find(t => t.value === 'who');
    expect([who.start, who.end]).toEqual([13, 16]); // honest offsets into the source
    // Escaped \#{ and single-quoted #{ remain literal text.
    const esc = tokenize('x = "a\\#{b}c"').tokens.find(t => t.kind === 'STRING');
    expect(esc.value).toBe('"a\\#{b}c"');
    const single = tokenize("x = 'lit #{a}'").tokens.find(t => t.kind === 'STRING');
    expect(single.value).toBe('"lit #{a}"');
  });
});

describe('large inputs', () => {
  test('rewriteTypes writes back multi-million-token tapes (no argument-spread copy)', async () => {
    // `tokens.push(...out)` would pass every token as a CALL
    // ARGUMENT and overflow the stack past ~1.2M tokens — on
    // ALL input, type-free included. The write-back must be an indexed
    // copy. 2.5M synthetic pass-through tokens exercise exactly that
    // path without paying for a scan.
    const { rewriteTypes } = await import('../src/lexer.js');
    const tokens = [];
    for (let i = 0; i < 1_250_000; i++) {
      tokens.push(
        { id: 2 * i, kind: 'IDENTIFIER', value: `v${i}`, start: 0, end: 2, spaced: false, newLine: true, generated: false, origin: null },
        { id: 2 * i + 1, kind: 'TERMINATOR', value: '\n', start: 2, end: 3, spaced: false, newLine: false, generated: true, origin: null },
      );
    }
    let next = tokens.length;
    const out = rewriteTypes(tokens, () => next++, '', () => { throw new Error('unreachable'); });
    expect(out).toBe(tokens); // same array identity — callers hold the reference
    expect(out.length).toBe(2_500_000);
    expect(out[2_499_998].kind).toBe('IDENTIFIER');
  });

  test('tokenize survives a ~1.6M-token program end to end', () => {
    const src = Array.from({ length: 400_000 }, (_, i) => `a${i} = ${i}`).join('\n');
    const { tokens } = tokenize(src);
    expect(tokens.length).toBeGreaterThan(1_500_000);
  });
});
