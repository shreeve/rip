// Authored Rip uses its own call and construction vocabulary. Dammit is the
// call-and-await form; a written `await` is reserved for promise values already
// in hand. `.new` is construction, and `.new!` is construction plus await.
// Parse/tokenize real syntax so examples embedded in strings and comments are
// never mistaken for authored operations. Language fixtures keep the alternate
// spellings because their job is to exercise the complete accepted grammar.
import { test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Parser } from '../../src/parser.js';
import { makeParserLexer, tokenize } from '../../src/lexer.js';

const ROOT = join(import.meta.dir, '../..');

const ripFiles = (directory, files = []) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) ripFiles(path, files);
    else if (entry.name.endsWith('.rip')) files.push(path);
  }
  return files;
};

const lineAt = (source, offset) => source.slice(0, offset).split('\n').length;

test('authored Rip uses dammit calls, Ruby construction, and awaits only stored promises', () => {
  const violations = [];
  const files = [
    ...ripFiles(join(ROOT, 'packages')),
    ...ripFiles(join(ROOT, 'examples')),
    join(ROOT, 'src/grammar/solar.rip'),
  ];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const token of tokenize(source, file).tokens) {
      if (token.kind === 'NEW') {
        violations.push(`${relative(ROOT, file)}:${lineAt(source, token.start)}: prefix new; use .new or .new!`);
      }
    }

    const parser = Parser();
    parser.lexer = makeParserLexer(file);
    const result = parser.parse(source);
    expect(result.diagnostics, relative(ROOT, file)).toEqual([]);

    const byId = new Map(result.stores.nodes.map((node) => [node.nodeId, node]));
    const role = (nodeId, name) => result.stores.roles.find(
      (row) => row.nodeId === nodeId && row.role === name
    );

    for (const node of result.stores.nodes) {
      if (node.semanticKind === 'await' && source.slice(node.sourceStart, node.sourceStart + 5) === 'await') {
        const value = role(node.nodeId, 'value');
        const child = byId.get(value?.childNodeId);
        let callShaped = ['call', 'dynimport', 'optcall'].includes(child?.semanticKind);
        if (child?.semanticKind === 'unary' && source.slice(child.sourceStart, child.sourceStart + 3) === 'new') {
          const operand = role(child.nodeId, 'operand');
          callShaped = byId.get(operand?.childNodeId)?.semanticKind === 'call';
        }
        if (callShaped) {
          violations.push(`${relative(ROOT, file)}:${lineAt(source, node.sourceStart)}: ${source.slice(node.sourceStart, node.sourceEnd).split('\n')[0]}`);
        }
      }

      if (node.semanticKind === 'call') {
        const callee = role(node.nodeId, 'callee');
        const args = role(node.nodeId, 'args');
        if (byId.get(callee?.childNodeId)?.semanticKind === 'dammit' &&
            source.slice(args?.sourceStart, args?.sourceEnd) === '()') {
          violations.push(`${relative(ROOT, file)}:${lineAt(source, node.sourceStart)}: redundant empty parens on ${source.slice(node.sourceStart, node.sourceEnd)}`);
        }
      }
    }
  }

  expect(files.length).toBeGreaterThan(150);
  expect(violations, violations.join('\n')).toEqual([]);
});
