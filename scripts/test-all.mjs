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
//   * test/browser (Playwright) is not a packages/*/ lane. It needs
//     installed browsers; run `bun run test:browser` / CI's browser job.
//     Local `bun run test:all` does not cover it.
//
// Every other package runs the way its own package.json says to. A suite
// that wants file-level parallelism asks for it in its own script, so the
// developer in that directory gets exactly what this does — running a
// suite differently here than it runs there is how the two drift apart.
//
// One guardrail runs before any lane: scripts/preflight.mjs (tsgo
// resolves) — a failure whose symptoms otherwise appear inside
// unrelated lanes, or worse, as a green run with the editor surface
// skipped.
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
//   --jobs <n>       lanes in flight at once (default: half the cores, min 2)
//   --timeout <ms>   per-lane timeout (default: 600000)
//   --root-workers <n>  bun workers for the root lane (default: the budget below)
//   --lane-workers <n>  RIP_LANE_WORKERS handed to package lanes (default: the budget below)
//   --plan           print the lanes that would run, spawn nothing
//
// Environment handed to every package lane:
//   RIP_LANE_WORKERS  that lane's share of the CPU budget below. A suite
//                     that fans out CPU-bound work (packages/vscode's
//                     `bun test --parallel`) sizes itself by this
//                     instead of by the machine; a single-process suite
//                     ignores it. Unset — a developer running `bun run
//                     test` in the package directory — vscode uses its
//                     own default (4). packages/sites deliberately does
//                     NOT read it: its sub-suites wait on agent boots,
//                     heartbeats and drain deadlines rather than burn
//                     CPU, so its cap of 4 is a latency choice — at 2
//                     the lane roughly doubles.
//
// Root-lane file order: if test/.timings.json exists, the root lane runs
// with `--timings` so bun starts its slowest files first. The file is
// measured, not authored — gitignored, seeded with `touch
// test/.timings.json`, refreshed by every run (see TIMINGS below).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
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

// Everything below is one CPU budget, because the machine is one machine:
// oversubscription does not fail loudly, it just stretches every clock
// until the suites that time real machinery start missing deadlines they
// meet idle (a reload doorbell, a scaling gate, a control-plane probe).
//
// availableParallelism, not cpus().length: it respects CPU affinity, so a
// pinned or containerised runner is sized by what it may actually use.
const CORES = availableParallelism();

// ONE ratio sets the peak, so it is the same multiple of the machine at
// every size rather than whatever two independent formulas happen to
// produce. Above 1.0 deliberately: lanes are not uniformly CPU-bound —
// they spawn subprocesses, wait on sockets and block on I/O — so a strict
// 1:1 budget leaves those cores idle. Measured on an 8-core box: a 1.0x
// peak cost +29% wall (81s against 63s); 1.25x costs +6%. Push it past
// ~1.5 and the suites that time real machinery start missing deadlines
// they meet idle, which is the whole reason this budget exists. The
// ratio only means something if every lane keeps to its share — which
// is what RIP_LANE_WORKERS (below) is for. 1.4x, re-measured on a
// 10-core box once every lane kept to its share and the sites lane
// stopped burning CPU on recompiles: the root lane alone runs 50s on 5
// workers, 45s on 7, 38s on 9 with the same 234 CPU-s, so it is the
// worker count, not the machine, that was holding it; in the full run,
// root 7 with the fan-out lane at 4 was the best of eight trials
// (55s against 68s at the old 5/2), and 9 gained nothing further.
const OVERSUBSCRIBE = 1.4;
const PEAK = Math.max(3, Math.round(CORES * OVERSUBSCRIBE));

// Lane slots are a PACKING constraint, not a CPU one — the long sibling
// lanes (sites, vscode, print) have to overlap the root lane or the wall
// clock becomes their sum, which is what the old floor of 4 was really
// buying. Half the cores, floor 2: on a two-core box the cores, not the
// slots, are the constraint, and four lanes there only added contention.
const JOBS = Math.floor(number('jobs', Math.max(2, Math.floor(CORES / 2)), 1));

// The peak is split between the root lane and the JOBS-1 sibling slots
// beside it. ONE sibling fans out CPU-bound work — vscode's `bun test
// --parallel`, sized by RIP_LANE_WORKERS — and it used to size itself
// by the MACHINE instead: one worker per core, each spawning a language
// server and tsgo, so a 10-core box ran ~25 bun workers plus their
// children against a budget that had counted each sibling as one, and
// every clock stretched (small lanes 3.4x, the root lane 2.7x). Every
// other sibling is one process and ignores the variable; sites keeps its
// own sub-suite cap of 4 because those suites mostly wait (see the
// header). So the budget counts one fan-out sibling at LANE_WORKERS and
// the rest at one each, and the root lane — the critical path and the
// CPU-bound one — gets the remainder, never more than the machine,
// never fewer than two. LANE_WORKERS is four where the peak affords it
// (vscode's editor suite is latency-bound: 20s at two workers, 13s at
// four) and shrinks before the root lane would drop below two.
// Worked on 10 cores: PEAK 14, JOBS 5 → 3 plain siblings + vscode at 4
// = 7, root 7; 7 + 7 = 14, the peak.
const SIBLINGS = Math.max(0, JOBS - 1);
const PLAIN_SIBLINGS = Math.max(0, SIBLINGS - 1);
const LANE_WORKERS = number('lane-workers', Math.max(1, Math.min(4, PEAK - 2 - PLAIN_SIBLINGS)), 1);
const ROOT_WORKERS = number('root-workers', Math.max(2, Math.min(CORES, PEAK - PLAIN_SIBLINGS - LANE_WORKERS)), 1);

// Root-lane file order. Bun 1.4.2 grew `--timings <json>`, per-file
// durations that make --parallel start the slowest files first, so the
// longest file cannot be picked up last and add its whole length to the
// lane. The file is measured, not authored: gitignored, seeded with
// `touch test/.timings.json` (an empty file is tolerated), and refreshed
// by every root-lane run through --update-timings. Absent, or under an
// older bun, the root lane runs as before. The file is created on first
// sight, so run two of any checkout is already ordered.
const TIMINGS = 'test/.timings.json';
const timingsArgs = () => {
  if (!Bun.semver.satisfies(Bun.version, '>=1.4.2')) return [];
  const file = join(ROOT, TIMINGS);
  // Seed on first sight: an empty file is a valid (empty) timings map, so
  // the first run measures and every later run orders by what it saw.
  // A root that refuses the write (read-only fixture) just runs unordered.
  if (!existsSync(file)) { try { writeFileSync(file, ''); } catch { return []; } }
  return [`--timings=${TIMINGS}`, '--update-timings'];
};
const TIMEOUT_MS = number('timeout', 600_000, 1);
const CI = Boolean(process.env.CI);

// Named package exclusions (none today — Playwright lives under test/browser).
const EXCLUDED = new Map();

// The label names its tier: the extended tier is what makes this lane
// ~2x the work of a bare `bun run test`, so the two wall times are not
// comparable.
const ROOT_LANE = 'root (extended tier)';

// Lane walls in seconds, measured under `test:all` on a 10-core box
// (before the budget above reached the lanes; the ranking held after).
// Only the RANKING is read, so the digits need refreshing only when a
// lane changes tier; a lane not listed sorts after every listed one.
const DURATIONS = {
  [ROOT_LANE]: 106.7,
  'packages/sites': 77.0,
  'packages/vscode': 55.6,
  'packages/ui': 33.3,
  'packages/print': 20.7,
  'packages/email': 17.1,
  'packages/db': 12.7,
  'packages/swarm': 10.5,
};

// Bun's gate (TTY / NO_COLOR / FORCE_COLOR / CI). When this process will
// paint, lanes get a PTY (Bun.spawn `terminal`) so runners see isTTY and
// color themselves — never by inheriting FORCE_COLOR. FORCE_COLOR on a
// piped child paints console.log/inspect (Bun latches it) and breaks
// every suite that pins subprocess stdout bytes.
const color = Bun.enableANSIColors;
const usePty = color && process.platform !== 'win32';
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
  // tsgo is a Go binary and every lane starts it many times (rip check,
  // the editor server); with the default GOGC=100 half of a short session
  // is the collector. 400 is a fifth of the collections, identical
  // answers, measured 7% off the check gate — and bun ignores the variable.
  const GO_ENV = { GOGC: process.env.GOGC ?? '400' };


  // The full root suite: in-process + test/spawn + the extended tier
  // (see test/support/extended.js). `bun run test` is the fast edit loop
  // (in-process path list only); this lane runs all of `test/` so the
  // process lane and extended gates still certify here.
  lanes.push({
    label: ROOT_LANE,
    cwd: ROOT,
    cmd: process.execPath,
    // 60s, not 15s: the extended tier's scaling gates budget up to three
    // full measurements, and a busy lane stretches one past 5s.
    args: ['test', `--parallel=${ROOT_WORKERS}`, '--timeout', '60000', ...timingsArgs()],
    env: { ...GO_ENV, RIP_EXTENDED: '1', RIP_REQUIRE_TSC: '1' },
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
      env: { ...GO_ENV, RIP_LANE_WORKERS: String(LANE_WORKERS) },
      skip: resolveTool(tool, cwd) ? undefined : `\`${tool}\` is not on PATH or in node_modules/.bin`,
    });
  }

  // Scheduling hint only: the longest lanes start first, so a long lane
  // picked up late cannot stretch the wall clock past the root suite —
  // in discovery (alphabetical) order packages/ui, the fourth-longest,
  // started at ~68s of a ~110s run and finished within 6s of the wall.
  // The sort is stable, so lanes not listed keep discovery order after
  // the listed ones. Correctness does not depend on the order.
  lanes.sort((a, b) => (DURATIONS[b.label] ?? 0) - (DURATIONS[a.label] ?? 0));

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
// All three runners end with a count, so require one and require it to
// be positive. This is the only thing here that reads a lane's output, and
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
  /(?:^|\n)Ran (\d+) tests?\b/g,   // bun test
  /(?:^|\n)(\d+) tests?:/g,        // rip test (rip/testing)
  /(?:^|\n) *(\d+) passed \(/g,    // playwright test (packages/ui)
];
// Strip CSI / OSC so painted tallies still match the count regexes.
const stripAnsi = (s) => s.replace(/\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g, '');
// PTYs speak CRLF / bare CR (progress redraws); normalize before matching
// and before reprinting so blocks read like a captured pipe.
const normalizeOut = (chunks) =>
  Buffer.concat(chunks).toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const testsReported = (output) => {
  const plain = stripAnsi(output);
  let total = null;
  for (const re of TEST_COUNTS) {
    for (const m of plain.matchAll(re)) total = (total ?? 0) + Number(m[1]);
  }
  return total; // null → the lane never printed a count
};

// Every lane process in flight, so an interrupted run can take them
// down. Left alone, Ctrl-C kills only this process: the lanes run in
// their own sessions (the PTY below), keep going without a reader, and
// a suite that dies of the closed PTY mid-flight strands whatever it
// had spawned detached — a Playwright web server on :4180, say, which
// the NEXT run then trips over.
const live = new Set();

const runLane = async (lane) => {
  const started = Date.now();
  const chunks = [];
  const finish = (extra) => ({
    lane,
    ms: Date.now() - started,
    output: normalizeOut(chunks),
    ...extra,
  });

  const env = { ...process.env, ...lane.env };
  // Parent may have FORCE_COLOR (piped `test:all | less -R`). Strip it
  // so lane children that pin stdout stay byte-stable; the PTY above is
  // what paints the lane reporters.
  delete env.FORCE_COLOR;
  let proc;
  try {
    if (usePty) {
      proc = Bun.spawn([lane.cmd, ...lane.args], {
        cwd: lane.cwd,
        env,
        terminal: {
          cols: process.stdout.columns || 120,
          rows: process.stdout.rows || 40,
          data(_term, data) { chunks.push(Buffer.from(data)); },
        },
      });
    } else {
      proc = Bun.spawn([lane.cmd, ...lane.args], {
        cwd: lane.cwd,
        env,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
    }
  } catch (e) {
    return finish({ status: 'fail', why: `could not spawn: ${e?.message ?? e}` });
  }
  live.add(proc);
  proc.exited.then(() => live.delete(proc));

  // A lane past its deadline is told to stop, then killed. The exit wait
  // below is bounded too: a lane that has been killed is finished whether
  // or not its exit is ever observed (a PTY lane's can go unreported).
  let timedOut = false;
  let killed;
  const gaveUp = new Promise((resolve) => { killed = resolve; });
  const timer = setTimeout(() => {
    timedOut = true;
    try { proc.kill('SIGTERM'); } catch { /* already dead */ }
    setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      try { proc.terminal?.close(); } catch { /* closed */ }
      setTimeout(() => killed(null), 5000).unref();
    }, 5000).unref();
  }, TIMEOUT_MS);

  if (!usePty) {
    const pull = async (stream) => {
      if (!stream) return;
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    };
    await Promise.all([pull(proc.stdout), pull(proc.stderr)]);
  }

  const code = await Promise.race([proc.exited, gaveUp]);
  clearTimeout(timer);
  try { proc.terminal?.close(); } catch { /* closed */ }

  if (timedOut) return finish({ status: 'fail', why: `timed out after ${secs(TIMEOUT_MS)}` });
  if (code !== 0) return finish({ status: 'fail', why: `exit ${code}` });
  const ran = testsReported(normalizeOut(chunks));
  if (ran === null) return finish({ status: 'fail', why: 'exited 0 without reporting a test count' });
  if (ran === 0) return finish({ status: 'fail', why: 'exited 0 having run no tests' });
  return finish({ status: 'pass', ran });
};

// Interrupted (Ctrl-C, a supervisor's SIGTERM): tell every lane in
// flight, give it a moment to tear down what it spawned, then leave
// with the conventional status. A lane that will not stop is killed.
const interrupt = (signal) => {
  for (const proc of live) { try { proc.kill('SIGTERM'); } catch { /* gone */ } }
  const status = signal === 'SIGINT' ? 130 : 143;
  const deadline = setTimeout(() => {
    for (const proc of live) { try { proc.kill('SIGKILL'); } catch { /* gone */ } }
    process.exit(status);
  }, 3000);
  deadline.unref?.();
  Promise.all([...live].map((proc) => proc.exited)).then(() => process.exit(status));
};
process.on('SIGINT', () => interrupt('SIGINT'));
process.on('SIGTERM', () => interrupt('SIGTERM'));

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
// Must hold before any lane starts, and fails confusingly INSIDE
// unrelated lanes when it does not: a missing tsgo makes the vscode
// suite skip its whole LSP surface and pass. The root lane's extended
// tier needs tsgo too and has no preflight of its own, so the
// guarantee lives here — every entry point reaches it, not just
// `bun run test:all`.
const guardrails = () => {
  for (const [script, args] of [['preflight.mjs', []]]) {
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
console.log(`[rip] test:all — ${lanes.length - skipped.length} lanes, ${JOBS} at a time on ${CORES} cores (root lane ${ROOT_WORKERS} workers, ${LANE_WORKERS} per sibling lane), repo ${ROOT}`);
for (const { name, why } of excluded) console.log(dim(`  · packages/${name} excluded: ${why}`));
for (const lane of skipped) {
  console.log((CI ? red : yellow)(`  ⊘ ${lane.label} SKIPPED: ${lane.skip}`));
}

// A discovery walk that silently matches nothing reads as a fast, green
// run; printing the plan without spawning is what makes it assertable.
if (argv.includes('--plan')) {
  for (const lane of lanes.filter((l) => !l.skip)) console.log(`▸ ${lane.label}`);
  // The budget as it reaches the lanes, so a plan is assertable on the
  // arguments as well as the list.
  const root = lanes.find((l) => l.label === ROOT_LANE);
  console.log(dim(`  · root lane: bun ${root.args.join(' ')}`));
  console.log(dim(`  · package lanes: bun run test  (RIP_LANE_WORKERS=${LANE_WORKERS})`));
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
