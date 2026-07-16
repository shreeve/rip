import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every expectation in this file was captured from the running v3
// implementation (rip-lang) — the port's behavioral oracle. The fixture
// scripts are deterministic (no random sleeps, no random failures), so
// worker scheduling never changes an outcome; the spawnSync timeout is
// the only clock in play, a generous bound rather than a race.

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const ripBin = join(pkgDir, '..', '..', 'bin', 'rip');
const binPath = join(pkgDir, 'swarm.rip');
const fixture = (name) => join(pkgDir, 'test', 'fixtures', name);

const run = (dir, script, ...flags) =>
  spawnSync(process.execPath, [ripBin, fixture(script), ...flags], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 12000,
  });

const fresh = () => mkdtempSync(join(tmpdir(), 'swarm-'));
const names = (dir, sub) =>
  readdirSync(join(dir, '.swarm', sub)).sort((a, b) => Number(a) - Number(b));

// The -q summary: "0.07 secs for 12 jobs by 3 workers @ 160.00 jobs/sec"
const summary = (jobs, workers) =>
  new RegExp(`^\\d+\\.\\d{2} secs for ${jobs} jobs by ${workers} workers( @ \\d+\\.\\d{2} jobs/sec)?\\n$`);

// ==[ swarm() batch runs ]====================================================

describe('swarm() batch runs', () => {
  test('processes every task across workers and reports a summary', () => {
    const dir = fresh();
    const r = run(dir, 'basic.rip', '-w', '3', '-q');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(summary(12, 3));
    expect(names(dir, 'done')).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
    expect(names(dir, 'todo')).toEqual([]);
    expect(names(dir, 'died')).toEqual([]);
  });

  test('setup() context is cloned to every worker call, with safe: false by default', () => {
    const dir = fresh();
    run(dir, 'basic.rip', '-w', '3', '-q');
    const lines = readFileSync(join(dir, 'out.log'), 'utf8').trim().split('\n').map(JSON.parse);
    expect(lines.length).toBe(12);
    expect(lines.map((l) => l.name).sort((a, b) => a - b)).toEqual(
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
    for (const line of lines) {
      expect(line.token).toBe('abc123');
      expect(line.deep).toEqual([1, 2, 3]);
      expect(line.safe).toBeFalse();
    }
  });

  test('-s/--safe flips safe: true on the worker context', () => {
    const dir = fresh();
    run(dir, 'basic.rip', '-w', '2', '-q', '-s');
    const lines = readFileSync(join(dir, 'out.log'), 'utf8').trim().split('\n').map(JSON.parse);
    expect(lines.every((l) => l.safe === true)).toBeTrue();
  });

  test('failed tasks move to died/ and their errors append to errors.log', () => {
    const dir = fresh();
    const r = run(dir, 'fail.rip', '-w', '2', '-q');
    expect(r.status).toBe(0); // died tasks do not fail the run
    expect(r.stdout).toMatch(summary(10, 2));
    expect(names(dir, 'done')).toEqual(['1', '2', '4', '5', '6', '8', '9', '10']);
    expect(names(dir, 'died')).toEqual(['3', '7']);
    const log = readFileSync(join(dir, '.swarm', 'errors.log'), 'utf8');
    expect(log).toContain('3: boom 3\n');
    expect(log).toContain('7: boom 7\n');
  });

  test('a second run retries only the died tasks and they can complete', () => {
    const dir = fresh();
    run(dir, 'flaky.rip', '-w', '2', '-q');
    expect(names(dir, 'died')).toEqual(['3', '7']);
    const r = run(dir, 'flaky.rip', '-w', '2', '-q');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(summary(2, 2)); // only the retried tasks run
    expect(names(dir, 'done')).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(names(dir, 'died')).toEqual([]);
  });

  test('deterministic failures stay died across a retry run', () => {
    const dir = fresh();
    run(dir, 'fail.rip', '-w', '2', '-q');
    const r = run(dir, 'fail.rip', '-w', '2', '-q');
    expect(r.stdout).toMatch(summary(2, 2));
    expect(names(dir, 'done')).toEqual(['1', '2', '4', '5', '6', '8', '9', '10']);
    expect(names(dir, 'died')).toEqual(['3', '7']);
  });

  test('a worker crash moves the in-flight task to died/, respawns, and the batch completes', () => {
    const dir = fresh();
    const r = run(dir, 'crash.rip', '-w', '2', '-q');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(summary(6, 2));
    expect(names(dir, 'done')).toEqual(['1', '2', '3', '4', '6']);
    expect(names(dir, 'died')).toEqual(['5']);
    const log = readFileSync(join(dir, '.swarm', 'errors.log'), 'utf8');
    expect(log).toMatch(/worker \d+ exited with code 7/);
  });
});

// ==[ CLI flags ]=============================================================

describe('CLI flags', () => {
  test('-r/--reset removes the .swarm directory and quits', () => {
    const dir = fresh();
    mkdirSync(join(dir, '.swarm', 'todo'), { recursive: true });
    const r = run(dir, 'basic.rip', '-r');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('removed .swarm directory\n');
    expect(existsSync(join(dir, '.swarm'))).toBeFalse();
  });

  test('long-form --workers=N is honored', () => {
    const dir = fresh();
    const r = run(dir, 'basic.rip', '--workers=4', '-q');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(summary(12, 4));
  });

  test('negative workers is an error', () => {
    const dir = fresh();
    const r = run(dir, 'basic.rip', '-w', '-2', '-q');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('error: workers must be at least 1');
  });

  test('-w 0 silently falls back to the CPU count (v3 wart: 0 is falsy, so the <1 guard never sees it)', () => {
    const dir = fresh();
    const r = run(dir, 'basic.rip', '-w', '0', '-q');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(summary(12, cpus().length));
  });

  test('missing perform() is an error', () => {
    const dir = fresh();
    const r = run(dir, 'noperform.rip', '-q');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('error: perform() function is required');
  });

  test('missing .swarm/todo is an error', () => {
    const dir = fresh();
    const r = run(dir, 'notodo.rip', '-q');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('error: no .swarm/todo directory found (did setup run?)');
  });

  test('an empty queue is a clean no-op', () => {
    const dir = fresh();
    const r = run(dir, 'empty.rip', '-q');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('no tasks to process\n');
  });
});

// ==[ progress display ]======================================================

describe('progress display', () => {
  test('non-quiet runs render the ANSI frame, bars, and summary', () => {
    const dir = fresh();
    const r = run(dir, 'basic.rip', '-w', '2', '-b', '10', '-c', '#');
    expect(r.status).toBe(0);
    const out = r.stdout;
    expect(out).toContain('\x1b[2J'); // clear screen
    expect(out).toContain('\x1b[?25l'); // hide cursor
    expect(out).toContain('\x1b[?25h'); // restore cursor
    expect(out).toContain('╭────────────╮'); // frame: bar width 10 + 2
    expect(out).toContain('╰────────────╯');
    expect(out).toContain('##########'); // -c character fills the bars
    expect(out).toContain('100.0%');
    expect(out).toContain('12/12 done');
    expect(out).toMatch(/ jobs @ [\d.]+\/sec/); // per-worker stats
    expect(out).toMatch(/\d+\.\d{2} secs for 12 jobs by 2 workers @ [\d.]+ jobs\/sec/);
  });
});

// ==[ args() ]================================================================

describe('args()', () => {
  test('strips swarm flags (short, long, =-joined, standalone) and keeps the rest', () => {
    const dir = fresh();
    const r = run(dir, 'args.rip',
      'foo', '-w', '5', 'bar', '--bar=30', '-c', '*', 'baz', '-q', '--reset', '-x', 'qux');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(['foo', 'bar', 'baz', '-x', 'qux']);
  });
});

// ==[ task queue ]============================================================

describe('task queue (init / todo / retry / _getPerform)', () => {
  test('the whole file-based queue contract, pinned line for line', () => {
    const dir = fresh();
    const r = run(dir, 'queue.rip');
    expect(r.status).toBe(0);
    expect(r.stdout.split('\n')).toEqual([
      '["0","42","empty","obj","str"]', // String(name) filenames, sorted
      '""', // todo(name) writes an empty file
      '"hello"', // string data as-is
      '"{\\"a\\":1,\\"b\\":[2,3]}"', // object data JSON.stringify'd
      'retry-with-todo: true', // died empty but todo queued -> true
      'retry-moves: true', // died/* renamed back to todo/
      '["0","42","empty","obj","str"]',
      '[]',
      'retry-empty: false', // nothing anywhere -> false
      'after-reinit: []', // init() clears the queue
      'getPerform: null', // no perform registered on the main thread
      '',
    ]);
  });
});

// ==[ the swarm command (swarm.rip run as the bin) ]==========================

describe('the swarm command', () => {
  test('without a script prints usage and exits 1', () => {
    const r = spawnSync(process.execPath, [ripBin, binPath], { encoding: 'utf8', timeout: 12000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('usage: swarm <script.rip> [options]');
  });

  test('a missing script is a named error', () => {
    const r = spawnSync(process.execPath, [ripBin, binPath, 'no-such-job.rip'], {
      encoding: 'utf8',
      timeout: 12000,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('error: no such script: no-such-job.rip');
  });

  test('runs a job script, forwarding flags and exit status', () => {
    const dir = fresh();
    const ok = spawnSync(process.execPath, [ripBin, binPath, fixture('basic.rip'), '-w', '2', '-q'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 12000,
    });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(summary(12, 2));
    const bad = spawnSync(process.execPath, [ripBin, binPath, fixture('noperform.rip'), '-q'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 12000,
    });
    expect(bad.status).toBe(1);
  });
});
