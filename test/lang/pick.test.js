// The pick wave: the `.{}`/`?.{}` operator — lexer PICK tokens
// (PICK_START/OPTPICK_START/PICK_END + the scan-time PROPERTY key
// tagging), the Pick grammar (PickList/PickItem/PickKey on
// SimpleAssignable and ObjSpreadExpr), and the emitter lowerings —
// byte-matched against the old lowering everywhere the old lowering is correct, with the two
// divergence classes pinned (a pinned defect assignment targets,
// #96 IIFE-crossing await/yield defaults).
import { test, expect } from 'bun:test';
import parser from '../../src/parser.js';
import { tokenize, makeParserLexer } from '../../src/lexer.js';
import { emit } from '../../src/emitter.js';
import { compile } from '../../src/compile.js';

parser.lexer = makeParserLexer();

const compileOk = (src) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  return emit(r, { source: src }).code;
};

// Tier 1 declare-in-place is a SANCTIONED divergence from: the compiler
// declares straight-line locals at their first write. unplaced()
// erases declaration placement — hoist lines drop, in-place
// declarations become bare assignments — so byte pins stay focused
// on the feature bytes they exist for.
const unplaced = (code) => code
  .replace(/^[ \t]*let [A-Za-z_$][\w$]*(, [A-Za-z_$][\w$]*)*;\n\n?/gm, '')
  .replace(/^([ \t]*)let ([A-Za-z_$][\w$]*)( = )/gm, '$1$2$3');

const parseFails = (src) => {
  const r = parser.parse(src);
  expect(r.sexpr).toBeNull();
  expect(r.diagnostics).not.toHaveLength(0);
};
const emitFails = (src, re) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  expect(() => emit(r, { source: src })).toThrow(re);
};
const kinds = (text) => tokenize(text).tokens.map(t => t.kind);

