// The Rip-native battery: every test/battery/*.rip
// row runs against the compiler — one bun test per row, so a
// failure names its file, verb, and case and prints the diff.
import { describe, test, expect } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadBattery, runRow } from './support/battery.js';

const dir = join(import.meta.dir, 'battery');
const files = readdirSync(dir).filter((f) => f.endsWith('.rip')).sort();

for (const file of files) {
  const rows = await loadBattery(join(dir, file));
  describe(`battery: ${file}`, () => {
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
describe('battery: a broken expectation fails loudly', () => {
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
});
