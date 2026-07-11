// The pending lane — the revival ratchet. Every row here is a
// language behavior the battery does not cover yet (the reconciliation
// queue in misc/PORT-GAPS.md): its source fails to compile, or
// compiles to bytes/values the row's expectation rejects. The lane
// asserts each row STILL FAILS — so the suite stays green while
// features are missing, and flips red exactly when a change makes a
// pending row pass without MOVING it to test/battery/ (transcribed as
// a real battery row, expectations reconciled to current output).
// Landing a feature and moving its rows is ONE change. The lane is
// done when pending.json is empty, and this file dies with it.
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runRow } from './support/battery.js';

const rows = JSON.parse(readFileSync(join(import.meta.dir, 'battery-pending/pending.json'), 'utf8'));

const byFile = new Map();
for (const row of rows) {
  if (!byFile.has(row.file)) byFile.set(row.file, []);
  byFile.get(row.file).push(row);
}

describe('battery-pending (the revival ratchet)', () => {
  test(`scoreboard: ${rows.length} rows pending across ${byFile.size} files`, () => {
    const counts = [...byFile.entries()].map(([f, r]) => `${f}: ${r.length}`).join(', ');
    console.log(`battery-pending → ${rows.length} rows pending (${counts})`);
    expect(rows.length).toBeGreaterThanOrEqual(0);
  });
  for (const [file, fileRows] of byFile) {
    test(`${file}: every pending row still fails (a passing row must MOVE to test/battery/)`, async () => {
      const revived = [];
      for (const row of fileRows) {
        let failure;
        try { failure = await runRow(row); } catch (err) { failure = String(err?.message ?? err); }
        if (failure === null) revived.push(`${row.verb} "${row.name}"`);
      }
      if (revived.length > 0) {
        throw new Error(
          `${file}: ${revived.length} pending row(s) now PASS — move them to test/battery/ ` +
          `(transcribe as real rows, delete from pending.json):\n  ${revived.join('\n  ')}`,
        );
      }
    });
  }
});
