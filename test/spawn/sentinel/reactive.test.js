// Process pins: two-heap reactive sentinel and loader cross-module bin/rip.
import { test, expect, describe } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { spawnSync } from '../../support/spawn.js';
import { compile as fullCompile } from '../../../src/compile.js';

const BIN = resolve(import.meta.dir, '../../../bin/rip');

describe('delivery triggers from the emitted lowering', () => {
  test('standalone: a reactive file compiled inline runs in a fresh process, sentinel intact', () => {
    const src = 'count := 1\ndouble ~= count * 2\nconsole.log double\ncount = 21\nconsole.log double';
    const { code } = fullCompile(src, { runtimeDelivery: 'inline' });
    expect(/^import /m.test(code)).toBe(false);
    // Value pin via none+binding lives in test/ui/reactive.test.js.
    // Sentinel: two standalone copies in one process still reject loudly.
    const dir = mkdtempSync(join(tmpdir(), 'rip-m9b-inline-'));
    try {
      writeFileSync(join(dir, 'one.js'), code);
      writeFileSync(join(dir, 'two.js'), code);
      writeFileSync(join(dir, 'main.js'), "import './one.js';\nimport './two.js';\n");
      const r2 = spawnSync('bun', [join(dir, 'main.js')], { encoding: 'utf8' });
      expect(r2.status).not.toBe(0);
      expect(r2.stderr).toContain('two copies of the Rip reactive runtime');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the loader path end to end: declarations in one module, explicit `.value` imports in another (cross-module)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rip-m9b-loader-'));
    try {
      writeFileSync(join(dir, 'store.rip'), 'export count := 1\nexport double ~= count * 2\ndef bump()\n  count += 1\nexport { bump }\n');
      writeFileSync(join(dir, 'main.rip'), [
 'import { count, double, bump } from "./store.rip"',
        // Imported reactive names are containers — reads spell `.value`
        // (no side channel threads the exporter's name set; ).
 'console.log count.value',
 'console.log double.value',
 'bump()',
 'console.log [count.value, double.value]',
      ].join('\n'));
      const r = spawnSync('bun', [BIN, 'main.rip'], { cwd: dir, encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim().split('\n')).toEqual(['1', '2', '[ 2, 4 ]']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
