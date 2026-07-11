// Async/await, the dammit operator, and generators. The dammit
// operator is an explicit DAMMIT token and ["dammit!", target] node —
// BY DESIGN (the compiler has no hidden channels). The contract here
// is the emitted JS and behavior (the module-loader eval — top-level
// await needs a real module context).
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import parser from '../src/parser.js';
import { makeParserLexer, tokenize } from '../src/lexer.js';
import { emit } from '../src/emitter.js';
import { Mappings } from '../src/stores.js';

parser.lexer = makeParserLexer();

const compile = (src) => {
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

// Load compiled code as a real ES module and return its default
// export (awaited).
let seq = 0;
async function loadDefault(code) {
  const dir = mkdtempSync(join(tmpdir(), 'rip-async-'));
  const file = join(dir, `m${seq++}.mjs`);
  writeFileSync(file, code);
  return (await import(pathToFileURL(file).href)).default;
}

