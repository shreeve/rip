// Enum codegen: `enum Name` lowers to ONE const object mapping
// forward (member → value) and reverse (value → member) — real
// codegen, not erasure.
import { test, expect } from 'bun:test';
import parser from '../src/parser.js';
import { makeParserLexer } from '../src/lexer.js';
import { emit } from '../src/emitter.js';
import { Stores, Mappings } from '../src/stores.js';

parser.lexer = makeParserLexer();

const compile = (src) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  const { code, mappings } = emit(r, { source: src });
  return { code, mappings: new Mappings(mappings), stores: new Stores(r.stores), sexpr: r.sexpr };
};

const parseFails = (src) => {
  let r;
  try {
    r = parser.parse(src);
  } catch (err) {
    expect(err.message).toBeTruthy();
    return;
  }
  expect(r.diagnostics).not.toEqual([]);
};

// ── Zero-cost: enum output is self-contained ────────────────────────

test('enum output carries no imports and no preamble', () => {
  const { code } = compile('enum Color\n  red = 0');
  expect(code).toBe('const Color = {red: 0, 0: "red"};');
});

