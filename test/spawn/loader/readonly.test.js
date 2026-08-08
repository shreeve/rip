// Process pin: exported readonly across modules via the loader (bin/rip).
import { test, expect, describe } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { spawnSync } from '../../support/spawn.js';

const BIN = resolve(import.meta.dir, '../../../bin/rip');

describe('delivery: readonly-only files stay zero-cost; the interplay triggers only from reactive constructs', () => {
  test('the loader path end to end: an exported readonly is a plain const binding across modules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rip-m9d-loader-'));
    try {
      writeFileSync(join(dir, 'store.rip'), 'export limit =! 10\nexport count := 1\nexport snap =! count + 1\n');
      writeFileSync(join(dir, 'main.rip'), [
 'import { limit, count, snap } from "./store.rip"',
        // The readonly export is the VALUE itself; the reactive export
        // is its container — the two surfaces side by side.
 'console.log limit',
 'console.log [count.value, snap]',
      ].join('\n'));
      const r = spawnSync('bun', [BIN, 'main.rip'], { cwd: dir, encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim().split('\n')).toEqual(['10', '[ 1, 2 ]']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
