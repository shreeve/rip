// The language suite covers the whole grammar: every production the
// generated parser can reduce is reduced by at least one test/rip row,
// except the ones this file declares unreachable or banned. Both
// directions are gated — a production no row reaches fails, and a
// declared exclusion some row reaches fails (the claim is stale) — so a
// grammar change trims this table instead of hiding behind it.
//
// Parser only: each row's source is parsed with an instrumented Parser
// whose onReduce records the rule ids; the denominator is the parser's
// own ruleNames table less its accept rules (index 0, the program's, and
// one per grammar entry), which the driver accepts on and never reduces.
import { test, expect } from 'bun:test';
import { join } from 'node:path';
import { Parser, ruleNames } from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { loadBattery, dedent } from '../support/battery.js';
import { ripFiles } from '../support/rip-files.js';

// Productions no battery row can or should reduce.
const EXCLUDED = new Map([
  ['For → FOR Range Block', 'banned by design — the emitter rejects a for loop that binds no variable (loops.rip pins the rejection)'],
  ['For → FOR Range BY Expression Block', 'banned by design — the emitter rejects a for loop that binds no variable (loops.rip pins the rejection)'],
  ['ImportSpecifier → DEFAULT', 'no legal ES lowering — a bare default specifier binds nothing; the emitter rejects it, pointing at `import name from` and `default as name`'],
  ['If → Statement POST_UNLESS Expression ELSE Expression', 'banned by design — postfix unless has no else form; the production exists to reject it rather than fold the else into the condition (control.rip pins the rejection)'],
  ['If → Expression POST_UNLESS Expression ELSE Expression', 'banned by design — postfix unless has no else form; the production exists to reject it rather than fold the else into the condition (control.rip pins the rejection)'],
  ['ComponentLine → ACCEPT IDENTIFIER', 'an accept names its provider; the emitter rejects the bare form, pointing at `accept name from Component` (components.rip pins the rejection)'],
  ['GateSource → Literal', "a gate source only a literal @stash path makes legal; the production carries the emitter's rejection (render-gates.rip pins it)"],
  ['GateSource → Range', "a gate source only a literal @stash path makes legal; the production carries the emitter's rejection (render-gates.rip pins it)"],
  ['GateSource → MarkedInvocation', "a gate source only a literal @stash path makes legal; the production carries the emitter's rejection (render-gates.rip pins it)"],
  ['GateSource → DoIife', "a gate source only a literal @stash path makes legal; the production carries the emitter's rejection (render-gates.rip pins it)"],
  ['GateSource → This', "a gate source only a literal @stash path makes legal; the production carries the emitter's rejection (render-gates.rip pins it)"],
  ['GateSource → Super', "a gate source only a literal @stash path makes legal; the production carries the emitter's rejection (render-gates.rip pins it)"],
  ['GateSource → SuffixedCall', "a gate source only a literal @stash path makes legal; the production carries the emitter's rejection (render-gates.rip pins it)"],
  ['SchemaBody → INDENT OUTDENT', 'reached only by a tolerant scan that dropped every member line of a body (test/toolchain/incomplete-expression.test.js pins the face it keeps)'],
  ['SchemaBody → S_KIND INDENT OUTDENT', 'reached only by a tolerant scan that dropped every member line of a body (test/toolchain/incomplete-expression.test.js pins the face it keeps)'],
  ['SchemaArrays → SchemaArrays S_ARRAY', "a shape the schema reader rejects with its own message; the production carries it (schema.rip and test/schema/schema.test.js pin it)"],
  ['SchemaRange → ..', "a shape the schema reader rejects with its own message; the production carries it (schema.rip and test/schema/schema.test.js pin it)"],
  ['SchemaValue → REGEX', "a shape the schema reader rejects with its own message; the production carries it (schema.rip and test/schema/schema.test.js pin it)"],
  ['SchemaAttrs → { }', "a shape the schema reader rejects with its own message; the production carries it (schema.rip and test/schema/schema.test.js pin it)"],
  ['SchemaEnsure → S_ENSURE', "a shape the schema reader rejects with its own message; the production carries it (schema.rip and test/schema/schema.test.js pin it)"],
  ['SchemaEnsure → S_ENSURE S_BANG', "a shape the schema reader rejects with its own message; the production carries it (schema.rip and test/schema/schema.test.js pin it)"],
  ['SchemaEnsureItem → SchemaNum', "a shape the schema reader rejects with its own message; the production carries it (schema.rip and test/schema/schema.test.js pin it)"],
  ['SchemaEnsureItem → S_WORD', "a shape the schema reader rejects with its own message; the production carries it (schema.rip and test/schema/schema.test.js pin it)"],
  ['SchemaEnsureElement → SchemaNum', "a shape the schema reader rejects with its own message; the production carries it (schema.rip and test/schema/schema.test.js pin it)"],
  ['SchemaEnsureElement → S_WORD', "a shape the schema reader rejects with its own message; the production carries it (schema.rip and test/schema/schema.test.js pin it)"],
  ['SchemaDirArg → .', "a shape the schema reader rejects with its own message; the production carries it (schema.rip and test/schema/schema.test.js pin it)"],
]);

const names = ruleNames.map((n) => (n?.startsWith('$accept') ? null : n));
const dir = join(import.meta.dir, '../rip');
const files = ripFiles(dir);

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
