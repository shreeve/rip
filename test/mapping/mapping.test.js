// Every RoleStore role of every emitted construct maps source span →
// generated span AND back, exactly, with zero string searching — plus
// the generated-span invariants.
import { test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import parser from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { emit } from '../../src/emitter.js';
import { Stores, Mappings } from '../../src/stores.js';

parser.lexer = makeParserLexer();

const compile = (src) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  const { code, mappings } = emit(r, { source: src });
  return { code, rows: mappings, mappings: new Mappings(mappings), stores: new Stores(r.stores) };
};

// Tier 1 declare-in-place: straight-line locals declare at their first assignment
// (`let x = <value>;`) instead of joining a hoisted `let a, b, x;` line.
// Byte-pin tests keep their intent (same JS modulo that one deliberate
// divergence) by normalizing let placement on BOTH sides: hoist-only lines
// drop (with their trailing blank line) and the `let ` prefix on
// initialized declarations strips. Strength is preserved by ALSO requiring
// the exact multiset of let-declared names to match — a name the compiler forgot to
// declare (or declared twice) still fails.
const ID = '[\\p{ID_Start}$_][\\p{ID_Continue}$]*'; // identifiers may be non-ASCII (café, naïve)
const letDeclNames = (js) => {
  const names = [];
  for (const m of js.matchAll(new RegExp(`^[ \\t]*let (${ID}(?:, ${ID})*);$`, 'gmu'))) names.push(...m[1].split(', '));
  for (const m of js.matchAll(new RegExp(`^[ \\t]*let (${ID}) =`, 'gmu'))) names.push(m[1]);
  return names.sort();
};
const letNorm = (js) => js
  .replace(new RegExp(`^[ \\t]*let ${ID}(?:, ${ID})*;\\n\\n?`, 'gmu'), '')
  .replace(new RegExp(`^([ \\t]*)let (?=${ID} =)`, 'gmu'), '$1');
const expectLetEqual = (v4code, v3code) => {
  expect(letDeclNames(v4code)).toEqual(letDeclNames(v3code));
  expect(letNorm(v4code)).toBe(letNorm(v3code));
};

const corpusDir = join(import.meta.dir, '../corpus');
const corpusFiles = readdirSync(corpusDir).filter(f => f.endsWith('.rip')).sort();

