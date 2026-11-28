// The Rip-native language suite: every test/rip/*.rip
// row runs against the compiler — one bun test per row, so a
// failure names its file, verb, and case and prints the diff.
import { describe, test, expect } from 'bun:test';
import { join } from 'node:path';
import { loadBattery, runRow } from './support/battery.js';
import { ripFiles } from './support/rip-files.js';

const dir = join(import.meta.dir, 'rip');
const files = ripFiles(dir);

for (const file of files) {
  const rows = await loadBattery(join(dir, file));
  describe(`rip: ${file}`, () => {
    for (const row of rows) {
      test(`${row.verb} ${row.name}`, async () => {
        const failure = await runRow(row);
        if (failure !== null) throw new Error(failure);
      });
    }
  });
}

// The loud-failure meta-gate: a
// broken expectation must fail with the file, the case name, and the
// diff — asserted against synthetic rows, one per verb.
describe('rip: a broken expectation fails loudly', () => {
  test('test-verb failure carries file, name, expected, actual', async () => {
    const failure = await runRow({ verb: 'test', name: 'broken', src: '1 + 1', expected: 3, file: 'meta.rip' });
    expect(failure).toContain('meta.rip › test "broken"');
    expect(failure).toContain('expected: 3');
    expect(failure).toContain('actual:   2');
  });

  test('code-verb failure carries the normalized diff and raw output', async () => {
    const failure = await runRow({ verb: 'code', name: 'broken', src: 'x = 1', expected: 'y = 2;', file: 'meta.rip' });
    expect(failure).toContain('meta.rip › code "broken"');
    expect(failure).toContain('expected (normalized)');
    expect(failure).toContain('actual (raw)');
  });

  test('fail-verb reports when the code unexpectedly succeeds', async () => {
    const failure = await runRow({ verb: 'fail', name: 'broken', src: '1 + 1', expected: undefined, file: 'meta.rip' });
    expect(failure).toContain('meta.rip › fail "broken"');
    expect(failure).toContain('expected a failure');
  });

  test('a TS-face fail row compiles on the TS face and expects a compile rejection', async () => {
    const src = 'a: number = 1\nf = ->\n  a: string = 2';
    expect(await runRow({ verb: 'fail', name: 'ts', src, expected: "but ': number' on line 1", options: { face: 'ts' }, file: 'meta.rip' })).toBeNull();
    const failure = await runRow({ verb: 'fail', name: 'broken', src: 'x: number = 1', expected: undefined, options: { face: 'ts' }, file: 'meta.rip' });
    expect(failure).toContain('meta.rip › fail "broken"');
    expect(failure).toContain('expected a TS-face compile rejection');
  });

  test('an option a verb does not honour fails the row', async () => {
    for (const verb of ['test', 'type']) {
      const failure = await runRow({ verb, name: 'broken', src: '1', expected: 1, options: { face: 'ts' }, file: 'meta.rip' });
      expect(failure).toContain(`meta.rip › ${verb} "broken"`);
      expect(failure).toContain(`the ${verb} verb does not honour 'face'`);
    }
    const failure = await runRow({ verb: 'fail', name: 'broken', src: 'x =! 1\nx = 2', expected: undefined, options: { skipPreamble: true }, file: 'meta.rip' });
    expect(failure).toContain("the fail verb does not honour 'skipPreamble'");
  });
});
