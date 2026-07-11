// Semantic side table: emitted into the generated parser, and provably
// inert — annotations never change tables or parse behavior.
import { describe, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { Generator } from '../solar.rip';
import exprGrammar from './fixtures/expr.js';
import exprPlain from './fixtures/expr-plain.js';
import { makeLexer } from './fixtures/lexer.js';

// Fresh directory per generated parser: Bun caches directory listings for
// module resolution, so a file written after a sibling import is not found.
async function loadGeneratedParser(grammar, name) {
  const code = new Generator(structuredClone(grammar)).generate();
  const file = join(mkdtempSync(join(tmpdir(), 'solar-semtable-')), `${name}.mjs`);
  writeFileSync(file, code);
  const mod = await import(pathToFileURL(file).href);
  mod.parser.lexer = makeLexer();
  return mod.parser;
}

describe('semantic side table', () => {
  test('generator builds the expected table for the expr fixture', () => {
    const gen = new Generator(structuredClone(exprGrammar));
    const byKind = {};
    for (const [ruleId, sem] of Object.entries(gen.semantics)) {
      (byKind[sem.kind] ??= []).push({ ruleId: +ruleId, roles: sem.roles });
    }
    expect(Object.keys(byKind).sort()).toEqual(['assign', 'binary', 'call']);
    expect(byKind.assign[0].roles.map(r => r.name)).toEqual(['operator', 'target', 'value']);
    expect(byKind.assign[0].roles[0]).toEqual(
      { name: 'operator', grammarRef: null, childSlot: 0, literal: '=' }
    );
    expect(byKind.binary).toHaveLength(3);
    expect(byKind.binary[0].roles.map(r => r.name)).toEqual(['operator', 'left', 'right']);
    expect(byKind.call[0].roles).toEqual([
      { name: 'callee', grammarRef: 1, childSlot: 0, spread: false },
      { name: 'args', grammarRef: 3, childSlot: 1, spread: true },
    ]);
  });

  test('generated parser module carries the semantic table', async () => {
    const parser = await loadGeneratedParser(exprGrammar, 'expr');
    const kinds = new Set(Object.values(parser.semantics).map(s => s.kind));
    expect(kinds).toEqual(new Set(['assign', 'binary', 'call']));
  });

  test('annotations do not change tables or actions', () => {
    const withAnn = new Generator(structuredClone(exprGrammar));
    const without = new Generator(structuredClone(exprPlain));
    expect(JSON.stringify(withAnn.parseTable)).toBe(JSON.stringify(without.parseTable));
    expect(JSON.stringify(withAnn.ruleTable)).toBe(JSON.stringify(without.ruleTable));
    expect(withAnn.ruleActions).toBe(without.ruleActions);
    expect(JSON.stringify(without.semantics)).toBe('{}');
  });

  test('annotations do not change parse output', async () => {
    const annotated = await loadGeneratedParser(exprGrammar, 'expr-behavior');
    const plain = await loadGeneratedParser(exprPlain, 'expr-plain-behavior');
    for (const input of ['x = 1 + 2 * 3', 'f(1, 2)', 'x = f(a) - 4', 'x = f()']) {
      const a = annotated.parse(input);
      const b = plain.parse(input);
      expect(a.diagnostics).toEqual([]);
      expect(JSON.stringify(a.sexpr)).toBe(JSON.stringify(b.sexpr));
    }
  });

  test('parse produces the expected s-expressions with offset spans', async () => {
    const parser = await loadGeneratedParser(exprGrammar, 'expr-sexpr');
    const { sexpr, diagnostics } = parser.parse('x = 1 + 2 * f(3, 4)');
    expect(diagnostics).toEqual([]);
    expect(JSON.stringify(sexpr)).toBe(JSON.stringify(
      ['=', 'x', ['+', '1', ['*', '2', ['f', '3', '4']]]]
    ));
  });

  test('parse failure returns diagnostics with offsets, not a throw', async () => {
    const parser = await loadGeneratedParser(exprGrammar, 'expr-diag');
    const { sexpr, diagnostics } = parser.parse('x = = 1');
    expect(sexpr).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].start).toBe(4);
    expect(diagnostics[0].end).toBe(5);
    expect(diagnostics[0].message).toMatch(/Unexpected '='/);
  });

  test('unexpected EOF diagnostics carry a zero-width span at end of input', async () => {
    const parser = await loadGeneratedParser(exprGrammar, 'expr-eof');
    const { sexpr, diagnostics } = parser.parse('x =');
    expect(sexpr).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].start).toBe(3);
    expect(diagnostics[0].end).toBe(3);
    expect(diagnostics[0].message).toMatch(/Unexpected end of input/);
  });

  test('empty argument lists parse with whitespace inside the parens', async () => {
    const parser = await loadGeneratedParser(exprGrammar, 'expr-empty-args');
    const { sexpr, diagnostics } = parser.parse('f(   )');
    expect(diagnostics).toEqual([]);
    expect(JSON.stringify(sexpr)).toBe(JSON.stringify(['f']));
  });

  test('token displays: `grammar.displays` overrides a terminal\'s diagnostic rendering, and expected lists dedup colliding displays', async () => {
    const grammar = structuredClone(exprGrammar);
    grammar.displays = { NUMBER: '#' };
    const parser = await loadGeneratedParser(grammar, 'expr-displays');
    const { diagnostics } = parser.parse('x = = 1');
    expect(diagnostics[0].expected).toContain('#');
    expect(diagnostics[0].expected).not.toContain('NUMBER');
    // The `got` side renders through the same table.
    const bad = parser.parse('x 5');
    expect(bad.diagnostics[0].message).toMatch(/Unexpected '#'/);

    // A display colliding with a REAL terminal's name dedups the list.
    const colliding = structuredClone(exprGrammar);
    colliding.displays = { NUMBER: 'ID' };
    const dedup = await loadGeneratedParser(colliding, 'expr-displays-dedup');
    const list = dedup.parse('x = = 1').diagnostics[0].expected;
    expect(list.filter((t) => t === 'ID')).toHaveLength(1);
  });

  test('token displays: a key naming an unknown or non-terminal symbol fails generation loudly', () => {
    const unknown = structuredClone(exprGrammar);
    unknown.displays = { NOPE: '?' };
    expect(() => new Generator(unknown)).toThrow(/displays\['NOPE'\] does not name a terminal/);
    const nonterminal = structuredClone(exprGrammar);
    nonterminal.displays = { Expression: 'e' };
    expect(() => new Generator(nonterminal)).toThrow(/displays\['Expression'\] does not name a terminal/);
  });

  test('empty-production spans anchor at the current lookahead start', async () => {
    // The parent action reads the empty production's span off the location
    // stack (locs[top-2] = E's slot in `ID E ID`), making it observable
    // through the parse result before stores exist.
    const grammar = {
      start: 'S',
      grammar: {
        S: [['ID E ID', '["s", $1, locs[locs.length - 2].start, locs[locs.length - 2].end]']],
        E: [['', '["e"]', '~ test plumbing']],
      },
    };
    const parser = await loadGeneratedParser(grammar, 'empty-span');
    const { sexpr, diagnostics } = parser.parse('x   y');
    expect(diagnostics).toEqual([]);
    // E sits between x (0-1) and y (4-5): zero-width at y's start, not x's end.
    expect(JSON.stringify(sexpr)).toBe(JSON.stringify(['s', 'x', 4, 4]));
  });
});
