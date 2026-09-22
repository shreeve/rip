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
// Two scheduling properties ride along, asserted on `--plan` and on a
// probe lane: the CPU budget reaches every package lane as
// RIP_LANE_WORKERS (the suites that fan out size themselves by it), and
// lanes are planned longest-first. Neither is a correctness property of
// the orchestrator — a wrong order still runs every lane — but a budget
// that silently stops reaching the lanes is how a 10-core box came to
// run ~25 workers, and that is worth a gate.
//
// The fixture is a real directory tree, not a mock: the orchestrator's job
// IS spawning processes, and a stubbed spawn would gate nothing. It stays
// out of the extended tier even so — the fixtures are trivial, and a
// broken aggregation is precisely what a green fast loop would hide.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from '../../support/spawn.js';
import { alive, until } from '../../support/wait.js';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ORCHESTRATOR = resolve(import.meta.dir, '../../../scripts/test-all.mjs');

const PASSING = "import { expect, test } from 'bun:test';\ntest('ok', () => { expect(1).toBe(1) });\n";
const FAILING = "import { expect, test } from 'bun:test';\ntest('no', () => { expect(1).toBe(2) });\n";

// A minimal stand-in for this repository's shape: a root suite plus
// packages/*/ suites, with the same bunfig boundary (the root run must not
// reach into packages/**, or a package's failure would be counted twice).
// Every fixture root, removed when the file is done (a leaked root per
// test per run adds up: 1,500 of them were found in one TMPDIR).
const roots = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

// A nested orchestrator that will not finish is terminated with the test
// instead of outliving it: SIGTERM, which it handles by stopping its own
// lanes and exiting 143. One left running was found three hours later,
// still holding a lane's port.
const BOUND = { timeout: 60_000, killSignal: 'SIGTERM' };

const fixture = (packages) => {
  const root = mkdtempSync(join(tmpdir(), 'rip-test-all-'));
  roots.push(root);
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

const orchestrate = (root, env = {}, ...extra) =>
  spawnSync(process.execPath, [ORCHESTRATOR, '--root', root, '--timeout', '120000', ...extra], {
    encoding: 'utf8',
    env: { ...process.env, CI: '', NO_COLOR: '1', ...env },
    ...BOUND,
  });

// Spawns nothing; what it prints is the schedule.
const plan = (root) => orchestrate(root, {}, '--plan');
const planned = (r) => [...r.stdout.matchAll(/^▸ (.+)$/gm)].map((m) => m[1]);

const GREEN = { script: 'bun test suite.test.js', body: PASSING };

// A lane that parks: it records its pid in the fixture and waits to be
// told to stop, standing in for a suite mid-flight when the run is
// interrupted.
const PARKED = {
  script: `bun -e "require('fs').writeFileSync('lane.pid', String(process.pid)); setInterval(() => {}, 1000)"`,
};
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

  test('a rip-harness failure far above the lane tail still names its test after the summary', () => {
    // A package lane of many sub-suites (packages/sites) prints its one
    // `✗` line where that sub-suite finished, with every later suite's
    // green checks below it — well past the 60 lines the tail repeats.
    const failure = '  ✗ stop command exits the canonical manager: expected 0, got null';
    const body = [
      `console.log(${JSON.stringify(failure)});`,
      "for (let i = 0; i < 80; i++) console.log(`  ✓ later case ${i}`);",
      "console.log('18 tests: 17 passed, 1 failed');",
      'process.exit(1);',
      '',
    ].join('\n');
    const r = orchestrate(fixture({ alpha: GREEN, sites: { script: 'bun suite.test.js', body } }));
    expect(r.stdout).toContain('✗ packages/sites');
    expect(r.status).not.toBe(0);
    const afterSummary = r.stdout.slice(r.stdout.indexOf('summary —'));
    expect(afterSummary).toContain(failure);
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

  // A painted tally must still count — the gate strips CSI before matching.
  test('a CSI-painted rip tally still counts as a reported run', () => {
    const painted = {
      script: 'bun -e ' + JSON.stringify("console.log('\\x1b[1m3 tests\\x1b[0m: \\x1b[32m3 passed\\x1b[0m, \\x1b[2m0 failed\\x1b[0m')"),
    };
    const r = orchestrate(fixture({ painted }));
    expect(r.stdout).toMatch(/✓ packages\/painted\s+[\d.]+s\s+3 tests\b/);
    expect(r.status).toBe(0);
  });

  // Color on → PTY for lanes (Bun.spawn `terminal`). The child must see
  // isTTY and paint; FORCE_COLOR is only how THIS parent enables color
  // without a TTY — lanes must not inherit it (piped inspect paint
  // breaks stdout pins in package suites).
  test('color-enabled lanes run under a PTY so runners paint', () => {
    const probe = {
      // Sentinels are unique so bun's echoed `bun -e '...'` command line
      // cannot satisfy the assertions.
      script: 'bun -e ' + JSON.stringify(
        "const t = !!process.stdout.isTTY;" +
        "const fc = process.env.FORCE_COLOR;" +
        "process.stdout.write((t ? '\\x1b[32m1 tests:\\x1b[0m pty-lane' : '1 tests: pipe-lane') + ' fc=' + JSON.stringify(fc) + '\\n');",
      ),
    };
    const root = fixture({ probe });
    const env = { ...process.env, CI: '', FORCE_COLOR: '1' };
    delete env.NO_COLOR;
    const r = spawnSync(process.execPath, [ORCHESTRATOR, '--root', root, '--timeout', '120000'], {
      encoding: 'utf8',
      env,
      keepForceColor: true, // orchestrator must see FORCE_COLOR to enable PTYs without a TTY
      ...BOUND,
    });
    expect(r.status).toBe(0);
    // The live output line (not the echoed `bun -e` source) carries the
    // painted tally; a pipe-spawned child would print the mono branch.
    expect(r.stdout).toMatch(/\x1b\[32m1 tests:\x1b\[0m pty-lane fc=undefined\n/);
  });

  // A blindly coerced non-number is NaN, and NaN here is a hang, not a
  // crash: a NaN jobs cap starts no lane and waits forever. The spawn
  // carries its own timeout so a regression fails this test rather than
  // hanging the suite that is trying to catch it.
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

  test('a package with no test script is not a lane', () => {
    const r = orchestrate(fixture({
      alpha: GREEN,
      docs: { script: '' },
    }));
    expect(r.stdout).not.toContain('packages/docs');
    expect(r.status).toBe(0);
  });

  // The budget has to REACH the suites that size themselves by it
  // (vscode's --parallel count), and a budget that stops arriving is
  // invisible from the exit code — the lane sizes itself by the machine
  // again and everything still passes, slower. So the probe lane prints
  // what it was handed, and it must be the number the banner promised.
  test('every package lane is handed its share of the budget as RIP_LANE_WORKERS', () => {
    const probe = {
      script: 'bun -e ' + JSON.stringify("console.log('1 tests: lane-workers=' + process.env.RIP_LANE_WORKERS)"),
    };
    const r = orchestrate(fixture({ probe }));
    expect(r.status).toBe(0);
    const banner = r.stdout.match(/(\d+) per sibling lane\)/);
    expect(banner).not.toBeNull();
    expect(r.stdout).toContain(`lane-workers=${banner[1]}\n`);
  });

  test('lanes are planned longest-first, unlisted lanes last in discovery order', () => {
    // sites and ui are in the orchestrator's longest-first list, sites
    // ahead of ui; the other two are not and trail in the order the walk
    // found them.
    const root = fixture({ zebra: GREEN, sites: GREEN, aardvark: GREEN, ui: GREEN });
    const r = plan(root);
    expect(r.status).toBe(0);
    expect(planned(r)).toEqual([
      'root (extended tier)',
      'packages/sites',
      'packages/ui',
      'packages/aardvark',
      'packages/zebra',
    ]);
    expect(readdirSync(join(root, 'test'))).toEqual(['root.test.js']); // a plan writes nothing
  });

  // The plan's bytes are pinned whole, painted and plain: the header's
  // budget, the skip line, the queue and the two argument lines. The
  // budget is recomputed here from the cores this machine offers, by
  // the rule the orchestrator documents, so the pin holds on any box.
  test('the plan prints exactly its header, skips, queue and budget, plain and painted', () => {
    const root = fixture({ zebra: GREEN, sites: GREEN, toolless: TOOLLESS });
    const cores = availableParallelism();
    const peak = Math.max(3, Math.round(cores * 1.4));
    const lane = Math.max(1, Math.min(4, peak - 2));        // --jobs 2: one sibling, which fans out
    const rootWorkers = Math.max(2, Math.min(cores, peak - lane));
    const skip = '  ⊘ packages/toolless SKIPPED: `rip-no-such-tool-6f2a` is not on PATH or in node_modules/.bin';
    const expected = (paint) => [
      `[rip] test:all — 3 lanes, 2 at a time on ${cores} cores (root lane ${rootWorkers} workers, ${lane} per sibling lane), repo ${root}`,
      paint('33', skip),
      '▸ root (extended tier)',
      '▸ packages/sites',
      '▸ packages/zebra',
      paint('2', `  · root lane: bun test --parallel=${rootWorkers} --timeout 60000`),
      paint('2', `  · package lanes: bun run test  (RIP_LANE_WORKERS=${lane})`),
      '',
    ].join('\n');

    const plain = orchestrate(root, {}, '--plan', '--jobs', '2');
    expect(plain.status).toBe(0);
    expect(plain.stdout).toBe(expected((_, s) => s));

    const env = { ...process.env, CI: '', FORCE_COLOR: '1' };
    delete env.NO_COLOR;
    const painted = spawnSync(process.execPath, [ORCHESTRATOR, '--root', root, '--plan', '--jobs', '2'], {
      encoding: 'utf8',
      env,
      keepForceColor: true,
      ...BOUND,
    });
    expect(painted.status).toBe(0);
    expect(painted.stdout).toBe(expected((code, s) => `\x1b[${code}m${s}\x1b[0m`));
  });

  // A real run starts lanes in the planned order too (the plan is the
  // queue, not a separate listing). One lane at a time makes the start
  // order the output order.
  test('a run starts lanes in the planned order', () => {
    const r = orchestrate(fixture({ zebra: GREEN, ui: GREEN, aardvark: GREEN }), {}, '--jobs', '1');
    expect(r.status).toBe(0);
    expect(planned(r)).toEqual([
      'root (extended tier)',
      'packages/ui',
      'packages/aardvark',
      'packages/zebra',
    ]);
  });

});

// This repository's own plan, asserted without running anything (`--plan`
// spawns no lanes, so this belongs in the fast tier): the lanes the
// orchestrator would spawn here must actually cover the packages that
// declare a suite. A discovery bug — a walk that silently matches nothing —
// otherwise reads as a fast, green run.
test('the plan for this repository is one lane per packages/*/ suite plus root', () => {
  const repo = resolve(import.meta.dir, '../../..');
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
    expect(discovered).toContain(`packages/${name}`);
  }
  // Playwright lives under test/browser — not a packages/*/ lane.
  expect(discovered).not.toContain('packages/browser-tests');
  expect(discovered).not.toContain('test/browser');
  expect(discovered).not.toContain('rip-browser-tests');
  // The root lane names its tier: it runs with RIP_EXTENDED set, so its
  // wall time is not comparable to a bare `bun run test` and the label
  // has to say which one a reader is looking at.
  expect(discovered).toContain('root (extended tier)');
  // One lane per suite: a package must never be expanded here into
  // something a developer running `bun run test` in that directory would
  // not get. Parallelism inside a suite is that suite's own business.
  expect(discovered.length).toBe(declared.length + 1); // packages + root
});

describe('an interrupted run takes its lanes down', () => {
  test('SIGTERM to the orchestrator stops a lane in flight and exits 143', async () => {
    const root = fixture({ parked: PARKED });
    const pidFile = join(root, 'packages', 'parked', 'lane.pid');
    const orchestrator = spawn(process.execPath, [ORCHESTRATOR, '--root', root, '--timeout', '120000'], {
      stdio: 'ignore',
      env: { ...process.env, CI: '', NO_COLOR: '1' },
    });
    expect(await until(() => existsSync(pidFile), 15000)).toBe(true);
    const lane = Number(readFileSync(pidFile, 'utf8'));
    expect(alive(lane)).toBe(true);
    const exited = new Promise((resolve) => orchestrator.once('exit', (code, signal) => resolve({ code, signal })));
    orchestrator.kill('SIGTERM');
    expect(await until(() => !alive(lane), 5000)).toBe(true);
    const status = await exited;
    expect(status).toEqual({ code: 143, signal: null });
    rmSync(root, { recursive: true, force: true });
  });
});
