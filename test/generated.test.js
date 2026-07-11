// Guard: the committed src/parser.js is exactly what the current grammar
// and generator produce. Fails when someone edits parser.js by hand or
// forgets to run `bun run parser` after a grammar change (the regeneration rule).
import { test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Generator } from '../src/grammar/solar.rip';
import grammar from '../src/grammar/grammar.rip';

test('committed parser.js is current with grammar.rip + solar.rip', () => {
  const generated = new Generator(structuredClone(grammar)).generate();
  const committed = readFileSync(join(import.meta.dir, '../src/parser.js'), 'utf8');
  expect(committed).toBe(generated);
});
