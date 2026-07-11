// The void-marker family: a trailing `!` on a function's NAME at any
// DEFINITION site (def, arrow assignment, export, method key) makes the
// function VOID — implicit return suppressed, the function returns
// undefined. Definition-site rows cannot live in the shared corpus'
// token/dammit surfaces: the compiler carries a real VOID_MARKER
// token and structural heads (`void-def`/`void-assign`/`void-pair`)
// — sexprs are corpus-pinned (test/corpus/voidmarker.rip,
// canonicalized heads); THIS file owns the byte pins, the eval
// checks, the disambiguation-boundary token fixtures, the mapping
// pins, and the negative surface.
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import parser from '../../src/parser.js';
import { makeParserLexer, tokenize } from '../../src/lexer.js';
import { emit } from '../../src/emitter.js';
import { Mappings } from '../../src/stores.js';

parser.lexer = makeParserLexer();

const compile = (src) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  return emit(r, { source: src }).code;
};

const emitOf = (src) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  return emit(r, { source: src });
};

const kinds = (src) => tokenize(src).tokens.map((t) => t.kind);

// Load compiled code as a real ES module and return its default export.
let seq = 0;
async function loadDefault(code) {
  const dir = mkdtempSync(join(tmpdir(), 'rip-void-'));
  const file = join(dir, `m${seq++}.mjs`);
  writeFileSync(file, code);
  return (await import(pathToFileURL(file).href)).default;
}

// Tier 1 declare-in-place is a SANCTIONED divergence from: the compiler
// declares straight-line locals at their first write. unplaced()
// erases declaration placement — hoist lines drop, in-place
// declarations become bare assignments — so byte pins stay focused
// on the feature bytes they exist for.
const unplaced = (code) => code
  .replace(/^[ \t]*let [A-Za-z_$][\w$]*(, [A-Za-z_$][\w$]*)*;\n\n?/gm, '')
  .replace(/^([ \t]*)let ([A-Za-z_$][\w$]*)( = )/gm, '$1$2$3');

