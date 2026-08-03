// Rip's dammit operator is the call-and-await form. A written `await` is
// reserved for promise values that are already in hand; spelling
// `await fn()` duplicates the language's own call vocabulary and makes the
// package sources read like JavaScript. Parse real syntax so examples embedded
// in strings and comments are never mistaken for authored operations.
import { test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Parser } from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';

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

test('package Rip sources use dammit for calls and await only stored promises', () => {
  const violations = [];
  const files = ripFiles(join(ROOT, 'packages'));

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const parser = Parser();
    parser.lexer = makeParserLexer(file);
    const result = parser.parse(source);
    expect(result.diagnostics, relative(ROOT, file)).toEqual([]);

    const byId = new Map(result.stores.nodes.map((node) => [node.nodeId, node]));
    const role = (nodeId, name) => result.stores.roles.find(
      (row) => row.nodeId === nodeId && row.role === name
    );

    for (const node of result.stores.nodes) {
      if (node.semanticKind === 'await') {
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

  expect(files.length).toBeGreaterThan(30);
  expect(violations, violations.join('\n')).toEqual([]);
});
