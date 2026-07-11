// The pending lane — the revival ratchet, spelled in battery format.
// Every test/battery-pending/pending-*.rip row is a language behavior
// the battery does not cover yet: its source fails to compile, or
// compiles to bytes/values the row's expectation rejects. The lane
// asserts each row STILL FAILS — the suite stays green while features
// are missing, and flips red exactly when a change makes a pending
// row pass without MOVING it (cut the row, paste it into the matching
// test/battery/*.rip, reconcile its expectation to current output —
// one change with the feature). The lane is done when the directory
// is empty, and this file dies with it.
import { describe, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadBattery, runRow } from './support/battery.js';

const dir = join(import.meta.dir, 'battery-pending');
const files = readdirSync(dir).filter((f) => f.endsWith('.rip')).sort();

let total = 0;
const loaded = [];
for (const file of files) {
  const rows = await loadBattery(join(dir, file));
  total += rows.length;
  loaded.push([file, rows]);
}

describe('battery-pending (the revival ratchet)', () => {
  test(`scoreboard: ${total} rows pending across ${files.length} files`, () => {
    console.log(`battery-pending → ${total} rows pending (` +
      loaded.map(([f, r]) => `${f.replace('pending-', '').replace('.rip', '')}: ${r.length}`).join(', ') + ')');
  });
  for (const [file, rows] of loaded) {
    test(`${file}: every pending row still fails (a passing row must MOVE to test/battery/)`, async () => {
      const revived = [];
      for (const row of rows) {
        let failure;
        try { failure = await runRow(row); } catch (err) { failure = String(err?.message ?? err); }
        if (failure === null) revived.push(`${row.verb} "${row.name}"`);
      }
      if (revived.length > 0) {
        throw new Error(
          `${file}: ${revived.length} pending row(s) now PASS — move them into test/battery/ ` +
          `(same change as the feature):\n  ${revived.join('\n  ')}`,
        );
      }
    });
  }
});
