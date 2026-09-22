// scripts/lanes.mjs — the lanes behind `bun run test:all` and `bun run test:tui`.
//
// No single `bun test` covers the repository: bunfig keeps the root suite
// out of packages/**, and each workspace package runs its own suite from
// its own directory. A lane is one such suite, spawned as the process its
// package.json declares. Lanes are found by walking packages/*/ for a
// `test` script, never from a list kept here. test/browser (Playwright)
// is not a lane: it needs installed browsers and runs as
// `bun run test:browser` / CI's browser job.
//
// This module plans the lanes, runs them, and says what each one's output
// means; it prints nothing. A front end reads the plan and starts the run
// with a listener, which hears every step as one event:
//
//   { type: 'plan', plan }          as the run starts, before any lane
//   { type: 'start', lane, at }     a lane is spawned (`at` is Date.now())
//   { type: 'chunk', lane, data }   bytes the lane wrote, a Buffer, as they come
//   { type: 'finish', result }      { lane, status, ms, ran, why, output }
//   { type: 'end', summary }        { results, skipped, excluded, failed, wall, ranTotal, code }
//
// A result's status is 'pass', 'fail', 'timeout' or 'skip'; a skipped
// lane (its tool is missing) finishes as the run starts and is never
// spawned. `ran` is the test count its runner reported, `output` what
// it wrote, normalized as a pipe would carry it. The summary's `code`
// is the exit status the run earns: 1 when a lane failed, 1 when a lane
// was skipped in CI, 0 otherwise. `results` holds the lanes that ran,
// in the order they finished.

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(dirname(fileURLToPath(import.meta.url)));

// OVERSUBSCRIBE is the peak as a multiple of the cores. Above 1.0 because
// lanes spawn subprocesses and wait on sockets rather than burn CPU flat
// out, so a strict 1:1 budget leaves cores idle; past ~1.5 the timed
// suites start missing deadlines. It only holds if every lane keeps to
// its share, which is what RIP_LANE_WORKERS is for.
const OVERSUBSCRIBE = 1.4;

// The label names its tier: the extended tier is what makes this lane
// ~2x the work of a bare `bun run test`, so the two wall times are not
// comparable.
export const ROOT_LANE = 'root (extended tier)';

// Lanes start in this order, longest first, so a long lane picked up late
// cannot stretch the wall clock past the root suite. A lane not listed
// starts after every listed one, in discovery order.
const LONGEST_FIRST = [
  ROOT_LANE,
  'packages/sites',
  'packages/vscode',
  'packages/ui',
  'packages/print',
  'packages/email',
  'packages/db',
  'packages/swarm',
];

// Named package exclusions (none today — Playwright lives under test/browser).
const EXCLUDED = new Map();

export const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

// ── Configuration ──────────────────────────────────────────────────────
// Flags:  --root <dir>    repository to orchestrate (default: this checkout)
//         --jobs <n>      lanes in flight at once (default: half the cores, min 2)
//         --timeout <ms>  per-lane timeout (default: 600000)
//         --plan          print the lanes that would run, spawn nothing
//
// Every package lane gets RIP_LANE_WORKERS, its share of the CPU budget
// below: a suite that fans out CPU-bound work (packages/vscode's `bun test
// --parallel`) sizes itself by it instead of by the machine. packages/sites
// ignores it on purpose — its sub-suites mostly wait, so its cap of 4 is a
// latency choice.
export const configure = (argv, env = process.env) => {
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

  const root = resolve(flag('root', HERE));

  // One CPU budget for the whole run: oversubscription does not fail loudly,
  // it stretches every clock until the suites that time real machinery miss
  // deadlines they meet idle. availableParallelism respects CPU affinity, so
  // a pinned or containerised runner is sized by what it may actually use.
  const cores = availableParallelism();
  const peak = Math.max(3, Math.round(cores * OVERSUBSCRIBE));

  // Lane slots are a packing constraint, not a CPU one: the long sibling
  // lanes have to overlap the root lane or the wall clock becomes their sum.
  const jobs = Math.floor(number('jobs', Math.max(2, Math.floor(cores / 2)), 1));

  // The peak is split between the root lane and the jobs-1 siblings beside
  // it. One sibling fans out (vscode, sized by RIP_LANE_WORKERS) and counts
  // at laneWorkers, the rest are one process each, and the root lane — the
  // CPU-bound critical path — gets the remainder, never more than the
  // machine, never fewer than two. laneWorkers is four where the peak
  // affords it and shrinks before the root lane would drop below two.
  const siblings = Math.max(0, jobs - 1);
  const plainSiblings = Math.max(0, siblings - 1);
  const laneWorkers = Math.max(1, Math.min(4, peak - 2 - plainSiblings));
  const rootWorkers = Math.max(2, Math.min(cores, peak - plainSiblings - laneWorkers));

  const timeoutMs = number('timeout', 600_000, 1);

  return {
    root,
    cores,
    jobs,
    laneWorkers,
    rootWorkers,
    timeoutMs,
    ci: Boolean(env.CI),
    plan: argv.includes('--plan'),
  };
};

// ── Tool resolution ────────────────────────────────────────────────────
// A package lane runs `bun run test`, but what that script INVOKES may be
// absent (no install, so no node_modules/.bin/rip). Resolving the script's
// first token up front is what separates "this suite could not run" from
// "this suite failed" — the distinction the CI teeth depend on.
const resolveTool = (tool, cwd, root) => {
  if (!tool) return null;
  if (tool === 'bun' || tool === 'bunx') return process.execPath;
  const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
  if (tool.includes('/')) {
    const p = resolve(cwd, tool);
    return isFile(p) ? p : null;
  }
  for (const dir of [join(cwd, 'node_modules/.bin'), join(root, 'node_modules/.bin')]) {
    if (isFile(join(dir, tool))) return join(dir, tool);
  }
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (dir && isFile(join(dir, tool))) return join(dir, tool);
  }
  return null;
};

// ── Lane planning ──────────────────────────────────────────────────────
const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };

// The lanes in the order they start, the packages excluded by name, and
// the lanes whose tool is missing (`skip` says why), which are among
// `lanes` too.
export const planLanes = (config) => {
  const { root } = config;
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
    cwd: root,
    cmd: process.execPath,
    // 60s, not 15s: the extended tier's scaling gates budget up to three
    // full measurements, and a busy lane stretches one past 5s.
    args: ['test', `--parallel=${config.rootWorkers}`, '--timeout', '60000'],
    env: { ...GO_ENV, RIP_EXTENDED: '1', RIP_REQUIRE_TSC: '1' },
  });

  const packagesDir = join(root, 'packages');
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
      env: { ...GO_ENV, RIP_LANE_WORKERS: String(config.laneWorkers) },
      skip: resolveTool(tool, cwd, root) ? undefined : `\`${tool}\` is not on PATH or in node_modules/.bin`,
    });
  }

  // Stable sort: unlisted lanes keep discovery order after the listed ones.
  const rank = (lane) => { const i = LONGEST_FIRST.indexOf(lane.label); return i === -1 ? LONGEST_FIRST.length : i; };
  lanes.sort((a, b) => rank(a) - rank(b));

  return { lanes, excluded, skipped: lanes.filter((l) => l.skip) };
};

// ── Guardrails ─────────────────────────────────────────────────────────
// Must hold before any lane starts, and fails confusingly INSIDE
// unrelated lanes when it does not: a missing tsgo makes the vscode
// suite skip its whole LSP surface and pass. The root lane's extended
// tier needs tsgo too and has no preflight of its own, so the
// guarantee lives here — every entry point reaches it. A foreign
// --root is a fixture repository, which has neither to check.
export const guardrails = (config) => {
  if (config.root !== HERE || config.plan) return;
  for (const [script, args] of [['preflight.mjs', []]]) {
    const r = spawnSync(process.execPath, [join(HERE, 'scripts', script), ...args], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
};

// ── What a lane's output says ──────────────────────────────────────────
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
export const stripAnsi = (s) => s.replace(/\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g, '');
// PTYs speak CRLF / bare CR (progress redraws); normalize before matching
// and before reprinting so blocks read like a captured pipe.
export const normalizeOut = (chunks) =>
  Buffer.concat(chunks).toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
export const testsReported = (output) => {
  const plain = stripAnsi(output);
  let total = null;
  for (const re of TEST_COUNTS) {
    for (const m of plain.matchAll(re)) total = (total ?? 0) + Number(m[1]);
  }
  return total; // null → the lane never printed a count
};

// A runner prints a failure's DETAIL where the test ran and only its
// NAME in the closing summary, so a lane's tail alone carries the name
// and loses the assertion message — which for a measurement gate is the
// whole point. Lift the lines leading up to each failure marker too:
// bun's `(fail)` line (`✗` under a PTY), and the rip harness's
// `✗ name: message` line, which a package lane of many sub-suites
// prints far above its tail.
export const FAILURE_MARK = /^\(fail\)|^ *✗ /;
export const failureDetail = (output, lead = 30) => {
  const lines = output.split('\n');
  const out = [];
  lines.forEach((line, i) => {
    if (!FAILURE_MARK.test(line) || out.length > 400) return;
    out.push(...lines.slice(Math.max(0, i - lead), i + 1), '');
  });
  return out.join('\n').trimEnd();
};

// A failing lane's block as the plain runner prints it after the
// summary: the lines around each failure, then the lane's last 60
// lines, under a rule that names the lane. `paint` holds the runner's
// `dim` and `red`.
export const failureBlock = (result, { dim, red }) => {
  const detail = failureDetail(result.output);
  const tail = result.output.split('\n').slice(-60).join('\n').trimEnd();
  let text = `\n${dim('─'.repeat(72))}\n${red(`✗ ${result.lane.label}`)} ${dim('— failures, then last 60 lines')}\n${dim('─'.repeat(72))}`;
  if (detail) text += `\n${detail}\n`;
  if (tail) text += `\n${tail}`;
  return text;
};

// ── Running ────────────────────────────────────────────────────────────
// A lane under a PTY leads a session of its own, so its process group
// is its pid and everything it spawned without leaving the group dies
// with it; a piped lane shares ours and is signalled alone.
const signal = (proc, sig) => {
  if (proc.group) { try { process.kill(-proc.pid, sig); } catch { /* gone */ } }
  try { proc.kill(sig); } catch { /* already dead */ }
};

// Every process below `pids`, with the process group each leads. A
// lane's descendants need not stay in its group: `bun test --parallel`
// puts each worker in a group of its own, and a worker whose
// coordinator is killed is re-parented and runs on. So an abort reads
// the whole tree while the lanes are still its roots, and signals every
// process in it and every group one of them leads. Synchronous, so an
// exit handler can use it.
const tree = (pids) => {
  const r = spawnSync('ps', ['-Ao', 'pid=,ppid=,pgid='], { encoding: 'utf8' });
  const rows = (r.stdout ?? '').trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number));
  const below = new Set(pids);
  for (let grew = true; grew;) {
    grew = false;
    for (const [pid, ppid] of rows) {
      if (below.has(ppid) && !below.has(pid)) { below.add(pid); grew = true; }
    }
  }
  const leaders = rows.filter(([pid, , pgid]) => below.has(pid) && pid === pgid).map(([pid]) => pid);
  return { pids: [...below], leaders };
};

const signalTree = (procs, sig) => {
  const { pids, leaders } = tree(procs.map((proc) => proc.pid));
  for (const pgid of leaders) { try { process.kill(-pgid, sig); } catch { /* gone */ } }
  for (const pid of pids) { try { process.kill(pid, sig); } catch { /* gone */ } }
};

// Start the planned run: `usePty` gives each lane a PTY of `cols` by
// `rows`, so runners see isTTY and paint; `hear` is told every event.
// The run returns at once with `done`, which resolves with the summary,
// and `abort`, which signals every process under the lanes in flight,
// and every process group one of them leads, with `sig` and, after
// `grace` milliseconds, SIGKILL; it resolves once every lane has exited
// or been killed.
export const launch = (config, planned, { usePty, cols = 120, rows = 40 }, hear) => {
  const { lanes, excluded, skipped } = planned;
  const { jobs, timeoutMs, ci } = config;

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
    const take = (data) => {
      const bytes = Buffer.from(data);
      chunks.push(bytes);
      hear({ type: 'chunk', lane, data: bytes });
    };
    const finish = (extra) => ({
      lane,
      ms: Date.now() - started,
      output: normalizeOut(chunks),
      ...extra,
    });

    const env = { ...process.env, ...lane.env };
    // Parent may have FORCE_COLOR (piped `test:all | less -R`). Strip it
    // so lane children that pin stdout stay byte-stable; the PTY is what
    // paints the lane reporters.
    delete env.FORCE_COLOR;
    let proc;
    try {
      if (usePty) {
        proc = Bun.spawn([lane.cmd, ...lane.args], {
          cwd: lane.cwd,
          env,
          terminal: { cols, rows, data(_term, data) { take(data); } },
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
    proc.group = usePty;
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
      signal(proc, 'SIGTERM');
      setTimeout(() => {
        signal(proc, 'SIGKILL');
        try { proc.terminal?.close(); } catch { /* closed */ }
        setTimeout(() => killed(null), 5000).unref();
      }, 5000).unref();
    }, timeoutMs);

    if (!usePty) {
      const pull = async (stream) => {
        if (!stream) return;
        for await (const chunk of stream) take(chunk);
      };
      await Promise.all([pull(proc.stdout), pull(proc.stderr)]);
    }

    const code = await Promise.race([proc.exited, gaveUp]);
    clearTimeout(timer);
    try { proc.terminal?.close(); } catch { /* closed */ }

    if (timedOut) return finish({ status: 'timeout', why: `timed out after ${secs(timeoutMs)}` });
    if (code !== 0) return finish({ status: 'fail', why: `exit ${code}` });
    const ran = testsReported(normalizeOut(chunks));
    if (ran === null) return finish({ status: 'fail', why: 'exited 0 without reporting a test count' });
    if (ran === 0) return finish({ status: 'fail', why: 'exited 0 having run no tests' });
    return finish({ status: 'pass', ran });
  };

  const run = async () => {
    const startedAt = Date.now();
    hear({ type: 'plan', plan: { ...planned, config } });
    for (const lane of skipped) hear({ type: 'finish', result: { lane, status: 'skip', ms: 0, why: lane.skip, output: '' } });

    const queue = lanes.filter((l) => !l.skip);
    const results = [];
    let inFlight = 0;
    let next = 0;
    await new Promise((allDone) => {
      if (queue.length === 0) return allDone();
      const pump = () => {
        while (inFlight < jobs && next < queue.length) {
          const lane = queue[next++];
          inFlight += 1;
          hear({ type: 'start', lane, at: Date.now() });
          runLane(lane).then((result) => {
            inFlight -= 1;
            results.push(result);
            hear({ type: 'finish', result });
            if (results.length === queue.length) allDone();
            else pump();
          });
        }
      };
      pump();
    });

    const wall = Date.now() - startedAt;
    const failed = results.filter((r) => r.status !== 'pass');
    const ranTotal = results.reduce((sum, r) => sum + (r.ran ?? 0), 0);
    // The teeth: locally a missing tool is a visible skip, in CI it is a
    // failure. A CI run that stops covering a suite must never go green.
    const code = failed.length > 0 || (ci && skipped.length > 0) ? 1 : 0;
    const summary = { results, skipped, excluded, failed, wall, ranTotal, code };
    hear({ type: 'end', summary });
    return summary;
  };

  const abort = (sig = 'SIGKILL', grace = 0) => {
    if (live.size) signalTree([...live], sig);
    return new Promise((resolve) => {
      const deadline = setTimeout(() => {
        if (live.size) signalTree([...live], 'SIGKILL');
        resolve();
      }, grace);
      deadline.unref?.();
      Promise.all([...live].map((proc) => proc.exited)).then(() => { clearTimeout(deadline); resolve(); });
    });
  };

  return { done: run(), abort, live };
};
