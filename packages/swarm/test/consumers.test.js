import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The real v3 call sites this package serves — the labcorp downloader
// scripts in rip-lang's apps/medlabs and apps/trustlabs — all share one
// shape, pinned here end-to-end: `import { swarm, args, init, retry,
// todo }`, an isMainThread guard around the positional args() read, one
// task per input line, and an idempotent perform() that skips outputs
// already on disk.

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const ripBin = join(pkgDir, '..', '..', 'bin', 'rip');
const fixture = join(pkgDir, 'test', 'fixtures', 'consumer.rip');

test('the downloader pattern: args() input, tasks from lines, idempotent perform', () => {
  const dir = mkdtempSync(join(tmpdir(), 'swarm-consumer-'));
  writeFileSync(join(dir, 'codes.txt'), 'alpha\nbeta\n\ngamma \n');
  mkdirSync(join(dir, 'out'));
  writeFileSync(join(dir, 'out', 'beta.json'), 'SENTINEL'); // already downloaded

  const r = spawnSync(process.execPath, [ripBin, fixture, 'codes.txt', '-w', '2', '-q'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 12000,
  });
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/^\d+\.\d{2} secs for 3 jobs by 2 workers/);

  // blank line skipped, 'gamma ' trimmed, every task done
  expect(readdirSync(join(dir, '.swarm', 'done')).sort()).toEqual(['alpha', 'beta', 'gamma']);
  expect(readdirSync(join(dir, '.swarm', 'todo'))).toEqual([]);

  // fresh outputs written; the existing one left untouched
  expect(readdirSync(join(dir, 'out')).sort()).toEqual(['alpha.json', 'beta.json', 'gamma.json']);
  expect(JSON.parse(readFileSync(join(dir, 'out', 'alpha.json'), 'utf8'))).toEqual({ code: 'alpha' });
  expect(readFileSync(join(dir, 'out', 'beta.json'), 'utf8')).toBe('SENTINEL');
});
