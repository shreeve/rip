#!/usr/bin/env bun

// scripts/test-all.mjs — the lane orchestrator behind `bun run test:all`.
//
// The tests live behind a directory boundary: the root suite runs from
// here (bunfig's pathIgnorePatterns excludes packages/**) and every
// workspace package owns a suite that runs from its own directory, so no
// single `bun test` can cover the repository. This script crosses that
// boundary the only honest way — it spawns each suite as the process that
// suite's own package.json declares — and aggregates the exit codes.
//
// It is deliberately dumb. It discovers lanes, spawns them, labels their
// output, and fails if any lane fails; the only thing it reads out of a
// suite is how many tests that suite says it ran (the zero-test gate
// below), and the package lanes are found by walking packages/*/ for a
// `test` script, never from a list maintained here. One piece of
// structural knowledge is unavoidable, and it is named:
//
//   * packages/browser-tests is excluded. It needs installed Playwright
//     browsers, which a local checkout is not required to have; CI runs it
//     as its own job. It is the ONE suite a local `bun run test:all` does
//     not cover.
//
// Every other package runs the way its own package.json says to. A suite
// that wants file-level parallelism asks for it in its own script, so the
// developer in that directory gets exactly what this does — running a
// suite differently here than it runs there is how the two drift apart.
//
// Two guardrails run before any lane: scripts/link-check.mjs (nothing
// answers `@rip-lang/*` from outside this repo) and scripts/preflight.mjs
// (tsgo resolves). Both are failures whose symptoms otherwise appear
// inside unrelated lanes, or — worse for tsgo — as a green run with the
// editor surface skipped.
//
// Teeth, following test/support/extended.js: a lane whose tool is missing
// SKIPS locally behind a visible line, and in CI (the CI environment
// variable set) a skipped lane FAILS the run instead — a configuration
// that quietly stops running a suite must not be able to go green.
//
// Lane output is buffered and flushed as one labeled block when the lane
// finishes: with a couple dozen lanes in flight, interleaved live streams
// are unreadable, and each block preserves its runner's own formatting.
//
// Flags (all optional; the defaults are what `bun run test:all` uses):
//   --root <dir>     repository to orchestrate (default: this checkout)
//   --jobs <n>       lanes in flight at once (default: half the cores, min 4)
//   --timeout <ms>   per-lane timeout (default: 600000)
//   --plan           print the lanes that would run, spawn nothing

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 || i === argv.length - 1 ? fallback : argv[i + 1];
};

// A numeric flag is refused rather than coerced, because NaN is not inert
// here: `live.size < NaN` is false forever, so a mistyped --jobs starts no
// lane and the run hangs with no output; and setTimeout treats a NaN delay
// as 0, so a mistyped --timeout kills every lane the instant it spawns and
// blames the suites. Exit 2 is this repo's usage-error code.
const number = (name, fallback, min) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const raw = argv[i + 1];
  const n = Number(raw);
  if (raw === undefined || raw.startsWith('--') || !Number.isFinite(n) || n < min) {
    console.error(`[rip] --${name} needs a number >= ${min}; got ${raw === undefined ? '(nothing)' : JSON.stringify(raw)}`);
    process.exit(2);
  }
  return n;
};

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = resolve(flag('root', HERE));

// The root suite is the critical path — every other lane finishes inside
// its shadow — and it spawns tsc/tsgo children of its own, so slots past
// a handful buy no wall time and only add contention. Half the cores,
// never fewer than 4 so a small CI runner still overlaps its lanes.
const JOBS = Math.floor(number('jobs', Math.max(4, Math.floor(cpus().length / 2)), 1));
const TIMEOUT_MS = number('timeout', 600_000, 1);
const CI = Boolean(process.env.CI);

// The one excluded suite, named once.
const EXCLUDED = new Map([
  ['browser-tests', 'needs installed Playwright browsers — CI runs it as its own job'],
]);

// The label names its tier: the extended tier is what makes this lane
// ~2x the work of a bare `bun run test`, so the two wall times are not
// comparable.
const ROOT_LANE = 'root (extended tier)';

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s) => paint('2', s);
const red = (s) => paint('31', s);
const green = (s) => paint('32', s);
const yellow = (s) => paint('33', s);
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

// ── Tool resolution ────────────────────────────────────────────────────
// A package lane runs `bun run test`, but what that script INVOKES may be
// absent (no install, so no node_modules/.bin/rip). Resolving the script's
// first token up front is what separates "this suite could not run" from
// "this suite failed" — the distinction the CI teeth below depend on.
const resolveTool = (tool, cwd) => {
  if (!tool) return null;
  if (tool === 'bun' || tool === 'bunx') return process.execPath;
  const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
  if (tool.includes('/')) {
    const p = resolve(cwd, tool);
    return isFile(p) ? p : null;
  }
  for (const dir of [join(cwd, 'node_modules/.bin'), join(ROOT, 'node_modules/.bin')]) {
    if (isFile(join(dir, tool))) return join(dir, tool);
  }
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (dir && isFile(join(dir, tool))) return join(dir, tool);
  }
  return null;
};

// ── Lane planning ──────────────────────────────────────────────────────
const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };

const planLanes = () => {
  const lanes = [];
  const excluded = [];

  // The root suite, extended tier included — the tier `bun test` alone
  // leaves out (see test/support/extended.js).
  lanes.push({
    label: ROOT_LANE,
    cwd: ROOT,
    cmd: process.execPath,
    args: ['test', '--timeout', '15000'],
    env: { RIP_EXTENDED: '1', RIP_REQUIRE_TSC: '1' },
  });

  const packagesDir = join(ROOT, 'packages');
  let names = [];
  try { names = readdirSync(packagesDir).sort(); } catch { names = []; }

  for (const name of names) {
    const cwd = join(packagesDir, name);
    const pkg = readJson(join(cwd, 'package.json'));
    const script = pkg?.scripts?.test;
    if (!script) continue; // not a suite — nothing to run, nothing to report

    if (EXCLUDED.has(name)) { excluded.push({ name, why: EXCLUDED.get(name) }); continue; }

    const tool = script.trim().split(/\s+/)[0];
    lanes.push({
      label: `packages/${name}`,
      cwd,
      cmd: process.execPath,
      args: ['run', 'test'],
      skip: resolveTool(tool, cwd) ? undefined : `\`${tool}\` is not on PATH or in node_modules/.bin`,
    });
  }

  // Scheduling hint only: the longest lanes are started first so a late
  // start cannot stretch the wall clock past the root suite. Correctness
  // does not depend on the order.
  const weight = (lane) =>
    lane.label === ROOT_LANE ? 0 : lane.label === 'packages/vscode' ? 1 : lane.label === 'packages/server' ? 2 : 3;
  lanes.sort((a, b) => weight(a) - weight(b));

  return { lanes, excluded };
};

// ── Running ────────────────────────────────────────────────────────────
// A lane that exits 0 having run NOTHING is, to an exit code alone,
// indistinguishable from a lane that passed — and it is reachable:
// `bun test` over a file whose every describe is skipped prints
// "Ran 0 tests" and exits 0, and the rip harness sets a non-zero code
// only for a failure. Seven vscode lanes would go green that way with
// tsgo absent (the guardrails refuse first, but that closes one
// instance, not the class).
//
// Both runners end with a count, so require one and require it to be
// positive. This is the only thing here that reads a lane's output, and
// a lane that prints no count at all is a failure too: silence is the
// state being ruled out, so it cannot be the state that passes.
//
// The sum is per COMMAND, not per lane — packages/app runs three, and
// all three count. Two sharp edges: bun writes "Ran 1 test" singular,
// and a one-test lane is the case sitting closest to the zero this
// gate exists to catch; and the anchor is a real newline rather than
// /m, whose ^ also matches after a bare carriage return, where a
// redrawn progress line would count as a run.
const TEST_COUNTS = [
  /(?:^|\n)Ran (\d+) tests?\b/g, // bun test
  /(?:^|\n)(\d+) tests?:/g,      // rip test (@rip-lang/testing)
];
const testsReported = (output) => {
  let total = null;
  for (const re of TEST_COUNTS) {
    for (const m of output.matchAll(re)) total = (total ?? 0) + Number(m[1]);
  }
  return total; // null → the lane never printed a count
};

const runLane = (lane) => new Promise((done) => {
  const started = Date.now();
  const chunks = [];
  const finish = (extra) => done({
    lane,
    ms: Date.now() - started,
    output: Buffer.concat(chunks).toString('utf8'),
    ...extra,
  });

  let child;
  try {
    child = spawn(lane.cmd, lane.args, {
      cwd: lane.cwd,
      env: { ...process.env, ...lane.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return finish({ status: 'fail', why: `could not spawn: ${e?.message ?? e}` });
  }

  child.stdout.on('data', (c) => chunks.push(c));
  child.stderr.on('data', (c) => chunks.push(c));

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 5000).unref();
  }, TIMEOUT_MS);

  child.on('error', (e) => {
    clearTimeout(timer);
    finish({ status: 'fail', why: `could not spawn: ${e?.message ?? e}` });
  });
  child.on('close', (code, signal) => {
    clearTimeout(timer);
    if (timedOut) return finish({ status: 'fail', why: `timed out after ${secs(TIMEOUT_MS)}` });
    if (code !== 0) return finish({ status: 'fail', why: signal ? `killed by ${signal}` : `exit ${code}` });
    const ran = testsReported(Buffer.concat(chunks).toString('utf8'));
    if (ran === null) return finish({ status: 'fail', why: 'exited 0 without reporting a test count' });
    if (ran === 0) return finish({ status: 'fail', why: 'exited 0 having run no tests' });
    finish({ status: 'pass', ran });
  });
});

const runAll = async (lanes) => {
  const queue = lanes.filter((l) => !l.skip);
  const results = [];
  const live = new Map();

  const heartbeat = setInterval(() => {
    if (live.size === 0) return;
    const now = Date.now();
    const running = [...live.entries()].map(([label, at]) => `${label} ${secs(now - at)}`).join(', ');
    console.log(dim(`  … ${live.size} running: ${running}`));
  }, 15_000);
  heartbeat.unref?.();

  let next = 0;
  await new Promise((allDone) => {
    if (queue.length === 0) return allDone();
    const pump = () => {
      while (live.size < JOBS && next < queue.length) {
        const lane = queue[next++];
        live.set(lane.label, Date.now());
        console.log(dim(`▸ ${lane.label}`));
        runLane(lane).then((result) => {
          live.delete(lane.label);
          results.push(result);
          report(result);
          if (results.length === queue.length) allDone();
          else pump();
        });
      }
    };
    pump();
  });

  clearInterval(heartbeat);
  return results;
};

const report = ({ lane, status, ms, why, output }) => {
  const mark = status === 'pass' ? green('✓') : red('✗');
  const head = `${mark} ${lane.label} ${dim(secs(ms))}${why ? red(` — ${why}`) : ''}`;
  console.log(`\n${dim('─'.repeat(72))}\n${head}\n${dim('─'.repeat(72))}`);
  if (output.trim()) console.log(output.trimEnd());
};

// ── Guardrails ─────────────────────────────────────────────────────────
// Both must hold before any lane starts, and both fail confusingly INSIDE
// unrelated lanes when they do not: a stray sibling checkout answering
// `@rip-lang/*` surfaces as duplicate-runtime and ENOENT errors scattered
// across half the packages, and a missing tsgo makes the vscode suite
// skip its whole LSP surface and pass. The root lane's extended tier
// needs tsgo too and has no preflight of its own, so the guarantee lives
// here — every entry point reaches it, not just `bun run test:all`.
const guardrails = () => {
  for (const [script, args] of [['link-check.mjs', ['--quiet']], ['preflight.mjs', []]]) {
    const r = spawnSync(process.execPath, [join(HERE, 'scripts', script), ...args], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
};

// ── Main ───────────────────────────────────────────────────────────────
// A foreign --root is a fixture repository, which has neither to check.
if (ROOT === HERE && !argv.includes('--plan')) guardrails();

const { lanes, excluded } = planLanes();
const skipped = lanes.filter((l) => l.skip);

// "repo", not "root" — `root` names a lane, and the two would read as
// the same thing on adjacent lines.
console.log(`[rip] test:all — ${lanes.length - skipped.length} lanes, ${JOBS} at a time, repo ${ROOT}`);
for (const { name, why } of excluded) console.log(dim(`  · packages/${name} excluded: ${why}`));
for (const lane of skipped) {
  console.log((CI ? red : yellow)(`  ⊘ ${lane.label} SKIPPED: ${lane.skip}`));
}

// A discovery walk that silently matches nothing reads as a fast, green
// run; printing the plan without spawning is what makes it assertable.
if (argv.includes('--plan')) {
  for (const lane of lanes.filter((l) => !l.skip)) console.log(`▸ ${lane.label}`);
  process.exit(0);
}

const startedAt = Date.now();
const results = await runAll(lanes);
const wall = Date.now() - startedAt;

const failed = results.filter((r) => r.status !== 'pass');

// One column layout for every row — run, skipped, excluded — so the
// times, counts and trailing notes line up down the whole table. Pad
// before colouring: ANSI escapes are characters to padEnd/padStart.
const cols = (label, time = '', tests = '', tint = (s) => s) =>
  `${label.padEnd(44)} ${time.padStart(7)} ${tint(tests.padStart(11))}`;

console.log(`\n${dim('═'.repeat(72))}\nsummary — ${secs(wall)} wall\n${dim('═'.repeat(72))}`);
for (const r of [...results].sort((a, b) => b.ms - a.ms)) {
  const mark = r.status === 'pass' ? green('✓') : red('✗');
  const tests = r.ran ? `${r.ran} test${r.ran === 1 ? '' : 's'}` : '';
  console.log(`  ${mark} ${cols(r.lane.label, secs(r.ms), tests, dim)}${r.why ? red(`  ${r.why}`) : ''}`);
}
for (const lane of skipped) {
  const paint = CI ? red : yellow;
  console.log(`  ${paint('⊘')} ${cols(lane.label)}  ${paint(lane.skip)}`);
}
for (const { name } of excluded) {
  console.log(`  ${dim('·')} ${dim(cols(`packages/${name}`))}  ${dim('excluded (CI runs it as its own job)')}`);
}

// A failing lane's output is printed where the lane finished, which in
// CI is the middle of a very long log — and GitHub drops the MIDDLE of a
// log it has to truncate, keeping the head and the tail. The root lane
// alone prints ~6000 lines, so the one thing worth reading (the name of
// the test that failed) is exactly what goes missing. Repeat the tail of
// each failing lane after the summary, where truncation cannot reach it.
// A runner prints a failure's DETAIL where the test ran and only its
// NAME in the closing summary, so the tail alone carries the name and
// loses the assertion message — which for a measurement gate is the
// whole point. Lift the lines leading up to each `(fail)` marker too.
const failureDetail = (output, lead = 30) => {
  const lines = output.split('\n');
  const out = [];
  lines.forEach((line, i) => {
    if (!/^\(fail\)/.test(line) || out.length > 400) return;
    out.push(...lines.slice(Math.max(0, i - lead), i + 1), '');
  });
  return out.join('\n').trimEnd();
};

if (failed.length > 0) {
  for (const r of failed) {
    const detail = failureDetail(r.output);
    const tail = r.output.split('\n').slice(-60).join('\n').trimEnd();
    console.log(`\n${dim('─'.repeat(72))}\n${red(`✗ ${r.lane.label}`)} ${dim('— failures, then last 60 lines')}\n${dim('─'.repeat(72))}`);
    if (detail) console.log(`${detail}\n`);
    if (tail) console.log(tail);
  }
  console.log(red(`\n✗ ${failed.length} of ${results.length} lanes failed: ${failed.map((r) => r.lane.label).join(', ')}\n`));
  process.exit(1);
}

// The teeth: locally a missing tool is a visible skip, in CI it is a
// failure. A CI run that stops covering a suite must never go green.
if (CI && skipped.length > 0) {
  console.log(red(
    `\n✗ ${skipped.length} lane(s) skipped in CI: ${skipped.map((l) => l.label).join(', ')}\n` +
    '  CI must run every lane; a skipped suite cannot pass. Fix the tool this lane needs\n' +
    '  (a full `bun install` provisions every workspace member) or remove the suite.\n',
  ));
  process.exit(1);
}

const ranTotal = results.reduce((sum, r) => sum + (r.ran ?? 0), 0);
console.log(green(`\n✓ ${results.length} lanes, ${ranTotal} tests passed in ${secs(wall)}\n`));
