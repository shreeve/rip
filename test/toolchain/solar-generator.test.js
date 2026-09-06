// Solar's action compiler and parse-table resolution, pinned on small
// grammars: a quoted tag keeps its digits, a reduce-reduce pair records
// the reduction the table kept beside the one it dropped, and a nonassoc
// error cell stays an error whatever else lands in it.
import { test, expect } from 'bun:test';
import { Generator } from '../../src/grammar/solar.rip';

const SHIFT = 1, REDUCE = 2;

test('a number inside a quoted template literal is text, not a position', () => {
  const gen = new Generator({ start: 'S', grammar: { S: [['ID', '["es2015", 1]', 'x: tag, val']] } });
  expect(gen.ruleActions).toContain('return ["es2015", $[$0]];');
  expect(gen.ruleActions).not.toContain('$02014');
});

test('a reduce-reduce pair records its winner, installs it, and the manifest names the pair', () => {
  const grammar = {
    start: 'S',
    grammar: {
      S: [['A', '["a", 1]', 'a: _, v'], ['B', '["b", 1]', 'b: _, v']],
      A: [['x']],
      B: [['x']],
    },
  };
  const gen = new Generator(structuredClone(grammar));
  const [detail] = gen.conflictDetails;
  expect(detail.category).toBe('reduce-reduce');
  expect(detail.winner).toMatch(/^[AB] → x$/);
  expect(`${detail.lhs} → ${detail.ruleSymbols}`).toMatch(/^[AB] → x$/);
  expect(detail.winner).not.toBe(`${detail.lhs} → ${detail.ruleSymbols}`);
  // The installed action is the winner's reduction.
  const winnerId = gen.rules.find((r) => `${r.lhs} → ${r.symbols.join(' ')}` === detail.winner).id;
  const cell = gen.parseTable[detail.state][gen.symbolIds[detail.lookahead]];
  expect(cell).toEqual([REDUCE, winnerId]);
  // The manifest key is `winner over loser`; a reversed declaration is a drift.
  const pair = `${detail.winner} over ${detail.lhs} → ${detail.ruleSymbols}`;
  expect(() => new Generator({ ...structuredClone(grammar), expectedConflicts: [['reduce-reduce', pair, 1]] })).not.toThrow();
  const reversed = `${detail.lhs} → ${detail.ruleSymbols} over ${detail.winner}`;
  expect(() => new Generator({ ...structuredClone(grammar), expectedConflicts: [['reduce-reduce', reversed, 1]] }))
    .toThrow(/undeclared: \[reduce-reduce\] .* over .*[\s\S]*declared but absent/);
});

test('a nonassoc error cell is not overwritten by a higher-precedence reduction', () => {
  // `E < E` under a nonassoc `<` is an error on a following `<`; the
  // F reduction shares the cell and would win on precedence alone.
  const grammar = {
    start: 'S',
    operators: [['nonassoc', '<'], ['left', 'HIGH']],
    grammar: {
      S: [['E'], ['F < E', '["f", 1, 3]', 'f: _, l, r']],
      E: [['E < E', '["<", 1, 3]', 'binary: operator, left, right'], ['x']],
      F: [['E < E', '["F", 1, 3]', 'binary: operator, left, right', { prec: 'HIGH' }]],
    },
  };
  const gen = new Generator(grammar);
  // Find the state holding both completed items with `<` in the lookahead.
  const state = gen.states.find((st) => {
    const done = [...st.reductions].filter((i) => i.rule.symbols.join(' ') === 'E < E');
    return done.length === 2 && done.every((i) => i.lookaheads.has('<'));
  });
  expect(state).toBeDefined();
  expect(gen.parseTable[state.id][gen.symbolIds['<']]).toBeUndefined();
  const dropped = gen.resolutionDetails.filter((r) => r.state === state.id && r.category === 'nonassoc');
  expect(dropped.map((r) => r.lhs)).toEqual(['F']);
});
