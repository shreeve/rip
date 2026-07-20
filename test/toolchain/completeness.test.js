// classifyCompleteness(source) — the REPL's continue/report decision,
// owned by the lexer+parser (never a bracket-counting heuristic over
// text). Verdicts: complete (parses clean), incomplete (more input
// can complete it), error (no continuation fixes it; the underlying
// positioned CompileError rides along). The structured facts: a lexer
// rejection whose delimiter was still open at end of input is
// incomplete (any other lexer rejection is hard); a parse diagnostic
// got 'end of input' is incomplete; any other diagnostic classifies
// by the single owned probe — an indented continuation line.
import { describe, test, expect } from 'bun:test';
import { classifyCompleteness, CompileError } from '../../src/compile.js';

const status = (src) => classifyCompleteness(src).status;

describe('incomplete: open delimiters thrown by the lexer', () => {
  test('unclosed call paren', () => expect(status('f(1,')).toBe('incomplete'));
  test('unclosed array bracket', () => expect(status('[1, 2')).toBe('incomplete'));
  test('unclosed object brace', () => expect(status('{a: 1')).toBe('incomplete'));
  test('unclosed double-quoted string', () => expect(status('"abc')).toBe('incomplete'));
  test('open heredoc', () => expect(status('"""\nline one')).toBe('incomplete'));
  test('open raw heredoc', () => expect(status("'''\nline one")).toBe('incomplete'));
  test('open interpolation', () => expect(status('"a#{b')).toBe('incomplete'));
});

describe('incomplete: end-of-input parse diagnostics', () => {
  test('dangling binary operator', () => expect(status('x +')).toBe('incomplete'));
  test('dangling reactive declaration', () => expect(status('a := ')).toBe('incomplete'));
  test('bodiless while', () => expect(status('while x')).toBe('incomplete'));
  test('bodiless arrow', () => expect(status('->')).toBe('incomplete'));
  test('bodiless try', () => expect(status('try')).toBe('incomplete'));
  test('dangling else', () => expect(status('if x\n  1\nelse')).toBe('incomplete'));
});

describe('incomplete: bodiless block headers (the POST_IF retag class)', () => {
  test('if with a name condition', () => expect(status('if x')).toBe('incomplete'));
  test('if with a literal condition', () => expect(status('if true')).toBe('incomplete'));
  test('unless', () => expect(status('unless x')).toBe('incomplete'));
  test('a complete line followed by an open one', () => {
    expect(status('x := 5\nif x')).toBe('incomplete');
  });
  test('a bodiless header nested under real indentation', () => {
    expect(status('def f()\n  if x')).toBe('incomplete');
  });
});

describe('complete', () => {
  test('a plain expression', () => expect(status('1 + 2')).toBe('complete'));
  test('a prefix-complete class header', () => expect(status('class Foo')).toBe('complete'));
  test('a reactive declaration', () => expect(status('x := 5')).toBe('complete'));
  test('a multi-line block', () => expect(status('if x\n  1\nelse\n  2')).toBe('complete'));
  test('empty input', () => expect(status('')).toBe('complete'));
});

describe('error: no continuation fixes it', () => {
  test('a doubled assignment reports the positioned diagnostic', () => {
    const r = classifyCompleteness('x = = 3');
    expect(r.status).toBe('error');
    expect(r.error).toBeInstanceOf(CompileError);
    expect(r.error.message).toContain("Unexpected '='");
    expect(r.error.line).toBe(1);
  });

  test('an unmatched closer is a lexer hard error', () => {
    const r = classifyCompleteness('f(1))');
    expect(r.status).toBe('error');
    expect(r.error).toBeInstanceOf(CompileError);
    expect(r.error.message).toContain("unmatched ')'");
  });

  test('a mid-input error under a trailing complete line stays an error', () => {
    const r = classifyCompleteness('x = = 3\ny = 1');
    expect(r.status).toBe('error');
  });

  test('a newline-broken single-line string is a hard error', () => {
    // More input can never close it — the string may not contain a
    // newline, so continuation lines cannot help.
    expect(classifyCompleteness('x = "abc\ny = 1').status).toBe('error');
  });
});

describe('API guard', () => {
  test('a non-string source rejects loudly', () => {
    expect(() => classifyCompleteness(null)).toThrow(/source must be a string/);
  });
});
