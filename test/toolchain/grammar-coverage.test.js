// The language suite covers the whole grammar: every production the
// generated parser can reduce is reduced by at least one test/rip row,
// except the ones this file declares unreachable or banned. Both
// directions are gated — a production no row reaches fails, and a
// declared exclusion some row reaches fails (the claim is stale) — so a
// grammar change trims this table instead of hiding behind it.
//
// Parser only: each row's source is parsed with an instrumented Parser
// whose onReduce records the rule ids; the denominator is the parser's
// own ruleNames table (index 0 is the $accept pad).
import { test, expect } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Parser } from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { loadBattery, dedent } from '../support/battery.js';

// Productions no battery row can or should reduce.
const EXCLUDED = new Map([
  ['Root → ε', 'the empty program has no row shape; that it compiles clean is guarded in check.test.js'],
  ['For → FOR Range Block', 'banned by design — the emitter rejects a for loop that binds no variable (loops.rip pins the rejection)'],
  ['For → FOR Range BY Expression Block', 'banned by design — the emitter rejects a for loop that binds no variable (loops.rip pins the rejection)'],
  ['ImportSpecifier → DEFAULT', 'no legal ES lowering — a bare default specifier binds nothing; the emitter rejects it, pointing at `import name from` and `default as name`'],
]);

const names = Parser().ruleNames;
const dir = join(import.meta.dir, '../rip');
const files = readdirSync(dir).filter((f) => f.endsWith('.rip')).sort();

const reached = new Set();
for (const file of files) {
  for (const row of await loadBattery(join(dir, file))) {
    if (row.verb === 'fail') continue;
    const parser = Parser({ onReduce: (id) => reached.add(names[id]) });
    parser.lexer = makeParserLexer(`<${file}>`);
    try { parser.parse(dedent(row.src)); } catch { /* the row's own test reports it */ }
  }
}

test('every production is reduced by a test/rip row, or declared excluded', () => {
  const dark = names.slice(1).filter((n) => n && !reached.has(n) && !EXCLUDED.has(n));
  expect(dark).toEqual([]);
});

test('every exclusion names a production no row reaches', () => {
  const grammar = new Set(names.filter(Boolean));
  const stale = [...EXCLUDED.keys()].filter((n) => !grammar.has(n));
  const reachedAnyway = [...EXCLUDED.keys()].filter((n) => reached.has(n));
  expect({ stale, reachedAnyway }).toEqual({ stale: [], reachedAnyway: [] });
});
