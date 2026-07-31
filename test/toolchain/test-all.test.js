// The lane orchestrator's own gate (scripts/test-all.mjs).
//
// The failure that matters here is not a broken lane — it is a broken
// AGGREGATION: if a red lane's exit code is dropped on the way out, every
// CI run goes green over red suites, and nothing else in the repository
// would notice. So these tests drive the real script end to end against a
// throwaway fixture repository (--root) and assert on its exit code:
//
//   * a green fixture exits 0 — the assertions below are not vacuous;
//   * one red lane among green ones exits non-zero;
//   * a lane whose tool is missing skips locally (still exit 0) but FAILS
//     under CI, the same teeth test/support/extended.js puts on the
//     extended tier.
//
// The fixture is a real directory tree, not a mock: the orchestrator's job
// IS spawning processes, and a stubbed spawn would gate nothing. It stays
// out of the extended tier even so — the fixtures are trivial, and a
// broken aggregation is precisely what a green fast loop would hide.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ORCHESTRATOR = resolve(import.meta.dir, '../../scripts/test-all.mjs');

const PASSING = "import { expect, test } from 'bun:test';\ntest('ok', () => { expect(1).toBe(1) });\n";
const FAILING = "import { expect, test } from 'bun:test';\ntest('no', () => { expect(1).toBe(2) });\n";

// A minimal stand-in for this repository's shape: a root suite plus
// packages/*/ suites, with the same bunfig boundary (the root run must not
// reach into packages/**, or a package's failure would be counted twice).
const fixture = (packages) => {
  const root = mkdtempSync(join(tmpdir(), 'rip-test-all-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true }));
  writeFileSync(join(root, 'bunfig.toml'), '[test]\npathIgnorePatterns = ["packages/**"]\n');
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'test/root.test.js'), PASSING);
  for (const [name, { script, body }] of Object.entries(packages)) {
    const dir = join(root, 'packages', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, scripts: { test: script } }));
    if (body) writeFileSync(join(dir, 'suite.test.js'), body);
  }
  return root;
};

const orchestrate = (root, env = {}) =>
  spawnSync(process.execPath, [ORCHESTRATOR, '--root', root, '--timeout', '120000'], {
    encoding: 'utf8',
    env: { ...process.env, CI: '', NO_COLOR: '1', ...env },
  });

const GREEN = { script: 'bun test suite.test.js', body: PASSING };
const RED = { script: 'bun test suite.test.js', body: FAILING };
// Exits 0 having run nothing — what a suite whose every describe is
// skipped looks like from outside. Indistinguishable from GREEN by exit
// code alone, which is the point.
const HOLLOW = { script: 'bun test suite.test.js', body: '// every test skipped\n' };
// Exits 0 and prints no count at all: silence must not read as success.
const MUTE = { script: 'true' };
// A tool no PATH can hold: the lane cannot run, which is not the same as
// the lane failing.
const TOOLLESS = { script: 'rip-no-such-tool-6f2a test.rip' };

describe('the lane orchestrator', () => {
  test('an all-green repository exits 0, with every discovered lane run', () => {
    const r = orchestrate(fixture({ alpha: GREEN, beta: GREEN }));
    expect(r.stdout).toContain('✓ root');
    expect(r.stdout).toContain('✓ packages/alpha');
    expect(r.stdout).toContain('✓ packages/beta');
    expect(r.status).toBe(0);
  });

  test('one red lane among green ones fails the whole run', () => {
    const r = orchestrate(fixture({ alpha: GREEN, beta: RED, gamma: GREEN }));
    // The green lanes still pass — it is the aggregation being gated here,
    // not a run that collapsed wholesale.
    expect(r.stdout).toContain('✓ packages/alpha');
    expect(r.stdout).toContain('✓ packages/gamma');
    expect(r.stdout).toContain('✗ packages/beta');
    expect(r.stdout).toContain('1 of 4 lanes failed');
    expect(r.status).not.toBe(0);
    // The failing lane's tail repeats after the summary. CI truncates the
    // MIDDLE of a long log, so a failure printed where the lane happened
    // to finish can vanish; this copy sits past the summary where it
    // survives, and it must carry the failing test's name.
    const afterSummary = r.stdout.slice(r.stdout.indexOf('summary —'));
    expect(afterSummary).toContain('✗ packages/beta');
    expect(afterSummary).toContain('last 60 lines');
    expect(afterSummary).toContain('(fail) no');
    expect(afterSummary).toContain('Expected: 2'); // the assertion detail, not just the name
  });

  test('a red ROOT lane fails the run (the root suite is aggregated like any other)', () => {
    const root = fixture({ alpha: GREEN });
    writeFileSync(join(root, 'test/root.test.js'), FAILING);
    const r = orchestrate(root);
    expect(r.stdout).toContain('✗ root');
    expect(r.status).not.toBe(0);
  });

  test('a lane whose tool is missing skips locally, and FAILS in CI', () => {
    const root = fixture({ alpha: GREEN, toolless: TOOLLESS });

    const local = orchestrate(root);
    expect(local.stdout).toContain('⊘ packages/toolless SKIPPED');
    expect(local.status).toBe(0);

    const ci = orchestrate(root, { CI: '1' });
    expect(ci.stdout).toContain('lane(s) skipped in CI');
    expect(ci.stdout).toContain('packages/toolless');
    expect(ci.status).not.toBe(0);
  });

  test('a lane that exits 0 having run no tests fails the run', () => {
    const r = orchestrate(fixture({ alpha: GREEN, hollow: HOLLOW }));
    expect(r.stdout).toContain('✓ packages/alpha');
    expect(r.stdout).toContain('exited 0 having run no tests');
    expect(r.status).not.toBe(0);
  });

  test('a lane that exits 0 reporting no count at all fails the run', () => {
    const r = orchestrate(fixture({ alpha: GREEN, mute: MUTE }));
    expect(r.stdout).toContain('exited 0 without reporting a test count');
    expect(r.status).not.toBe(0);
  });

  // Singular is the sharp edge: bun writes "Ran 1 test", and a one-test
  // lane is the case sitting closest to the zero the gate rules out.
  test('a passing lane reports how many tests it ran', () => {
    const r = orchestrate(fixture({ alpha: GREEN }));
    expect(r.stdout).toMatch(/✓ packages\/alpha\s+[\d.]+s\s+1 test\b/);
    expect(r.stdout).toContain('2 lanes, 2 tests passed');
    expect(r.status).toBe(0);
  });

  // Both of these used to be coerced to NaN and carried into the run.
  // The spawn carries its own timeout so a regression fails this test
  // rather than hanging the suite that is trying to catch it — the
  // --jobs regression is an infinite wait, not a crash.
  const withArgs = (...extra) =>
    spawnSync(process.execPath, [ORCHESTRATOR, '--root', fixture({}), ...extra], {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, CI: '', NO_COLOR: '1' },
    });

  test('a non-numeric --jobs is refused (NaN would start no lane and hang forever)', () => {
    const r = withArgs('--jobs', 'oops');
    expect(r.status).toBe(2);
    expect(`${r.stderr}${r.stdout}`).toContain('--jobs needs a number');
    expect(r.signal).toBeNull(); // refused outright, not killed by the timeout above
  });

  test('a non-numeric --timeout is refused (NaN means a 0ms deadline: every lane dies at once)', () => {
    const r = withArgs('--timeout', 'oops');
    expect(r.status).toBe(2);
    expect(`${r.stderr}${r.stdout}`).toContain('--timeout needs a number');
  });

  test('a numeric flag left without a value is refused, not silently defaulted', () => {
    const r = withArgs('--jobs');
    expect(r.status).toBe(2);
    expect(`${r.stderr}${r.stdout}`).toContain('(nothing)');
  });

  test('a package with no test script is not a lane; browser-tests is excluded by name', () => {
    const r = orchestrate(fixture({
      alpha: GREEN,
      'browser-tests': { script: 'playwright test' },
      docs: { script: '' },
    }));
    expect(r.stdout).toContain('packages/browser-tests excluded');
    expect(r.stdout).not.toContain('packages/docs');
    expect(r.status).toBe(0);
  });
});

// This repository's own plan, asserted without running anything (`--plan`
// spawns no lanes, so this belongs in the fast tier): the lanes the
// orchestrator would spawn here must actually cover the packages that
// declare a suite. A discovery bug — a walk that silently matches nothing —
// otherwise reads as a fast, green run.
test('the plan for this repository is one lane per packages/*/ suite, excluding only browser-tests', () => {
  const repo = resolve(import.meta.dir, '../..');
  const r = spawnSync(process.execPath, [ORCHESTRATOR, '--root', repo, '--plan'], {
    encoding: 'utf8',
    env: { ...process.env, CI: '', NO_COLOR: '1' },
  });
  expect(r.status).toBe(0);
  // What this gates is DISCOVERY — the walk over packages/*/ finding
  // every declared suite. A lane whose tool is missing was still
  // discovered; it just cannot run, and `--plan` lists only the runnable
  // ones. Counting both keeps this an assertion about the walk. Reading
  // `▸` alone quietly turns it into an assertion that `bun install` has
  // been run, which fails on a fresh checkout where the other 5,849
  // tests in this tier pass.
  const discovered = [
    ...[...r.stdout.matchAll(/^▸ (.+)$/gm)].map((m) => m[1]),
    ...[...r.stdout.matchAll(/^\s*⊘ (.+?) SKIPPED:/gm)].map((m) => m[1]),
  ];

  const declared = readdirSync(join(repo, 'packages'))
    .filter((name) => {
      try { return Boolean(JSON.parse(readFileSync(join(repo, 'packages', name, 'package.json'), 'utf8')).scripts?.test); }
      catch { return false; }
    });
  expect(declared.length).toBeGreaterThan(15); // not vacuous

  for (const name of declared) {
    if (name === 'browser-tests') {
      expect(discovered).not.toContain('packages/browser-tests');
      expect(r.stdout).toContain('packages/browser-tests excluded');
    } else {
      expect(discovered).toContain(`packages/${name}`);
    }
  }
  // The root lane names its tier: it runs with RIP_EXTENDED set, so its
  // wall time is not comparable to a bare `bun run test` and the label
  // has to say which one a reader is looking at.
  expect(discovered).toContain('root (extended tier)');
  // One lane per suite: a package must never be expanded here into
  // something a developer running `bun run test` in that directory would
  // not get. Parallelism inside a suite is that suite's own business.
  expect(discovered.length).toBe(declared.length); // browser-tests out, root in
});
