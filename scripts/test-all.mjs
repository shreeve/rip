#!/usr/bin/env bun

// scripts/test-all.mjs — the plain front end behind `bun run test:all`.
//
// scripts/lanes.mjs finds the lanes, runs them and reads their output;
// this prints the run as text: a line as each lane starts, a heartbeat
// while lanes are in flight, each lane's output as one labeled block when
// it finishes, then a summary table, the failing lanes' failures again,
// and the verdict. `bun run test:tui` is the same run drawn live.
//
// scripts/preflight.mjs (tsgo resolves) runs before any lane, because a
// missing tsgo otherwise shows up inside unrelated lanes or as a green run
// with the editor surface skipped. A lane whose tool is missing SKIPS
// locally behind a visible line and FAILS the run in CI, the same teeth
// test/support/extended.js puts on the extended tier.
//
// Flags:  --root <dir>    repository to orchestrate (default: this checkout)
//         --jobs <n>      lanes in flight at once (default: half the cores, min 2)
//         --timeout <ms>  per-lane timeout (default: 600000)
//         --plan          print the lanes that would run, spawn nothing

import { ROOT_LANE, configure, failureBlock, guardrails, launch, planLanes, secs } from './lanes.mjs';

const argv = process.argv.slice(2);
const config = configure(argv);
const { root: ROOT, cores: CORES, jobs: JOBS, laneWorkers: LANE_WORKERS, rootWorkers: ROOT_WORKERS, ci: CI } = config;

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

// Interrupted (Ctrl-C, a supervisor's SIGTERM): tell every lane in
// flight, give it a moment to tear down what it spawned, then leave
// with the conventional status. A lane that will not stop is killed.
let run = null;
const interrupt = (signal) => {
  const status = signal === 'SIGINT' ? 130 : 143;
  (run ? run.abort('SIGTERM', 3000) : Promise.resolve()).then(() => process.exit(status));
};
process.on('SIGINT', () => interrupt('SIGINT'));
process.on('SIGTERM', () => interrupt('SIGTERM'));

guardrails(config);

const { lanes, excluded, skipped } = planLanes(config);

// "repo", not "root" — `root` names a lane, and the two would read as
// the same thing on adjacent lines.
console.log(`[rip] test:all — ${lanes.length - skipped.length} lanes, ${JOBS} at a time on ${CORES} cores (root lane ${ROOT_WORKERS} workers, ${LANE_WORKERS} per sibling lane), repo ${ROOT}`);
for (const { name, why } of excluded) console.log(dim(`  · packages/${name} excluded: ${why}`));
for (const lane of skipped) {
  console.log((CI ? red : yellow)(`  ⊘ ${lane.label} SKIPPED: ${lane.skip}`));
}

// A discovery walk that silently matches nothing reads as a fast, green
// run; printing the plan without spawning is what makes it assertable.
if (config.plan) {
  for (const lane of lanes.filter((l) => !l.skip)) console.log(`▸ ${lane.label}`);
  // The budget as it reaches the lanes, so a plan is assertable on the
  // arguments as well as the list.
  const root = lanes.find((l) => l.label === ROOT_LANE);
  console.log(dim(`  · root lane: bun ${root.args.join(' ')}`));
  console.log(dim(`  · package lanes: bun run test  (RIP_LANE_WORKERS=${LANE_WORKERS})`));
  process.exit(0);
}

const report = ({ lane, status, ms, why, output }) => {
  const mark = status === 'pass' ? green('✓') : red('✗');
  const head = `${mark} ${lane.label} ${dim(secs(ms))}${why ? red(` — ${why}`) : ''}`;
  console.log(`\n${dim('─'.repeat(72))}\n${head}\n${dim('─'.repeat(72))}`);
  if (output.trim()) console.log(output.trimEnd());
};

// The lanes in flight, by label, with when each started: the heartbeat
// names them every five seconds.
const running = new Map();
const heartbeat = setInterval(() => {
  if (running.size === 0) return;
  const now = Date.now();
  const names = [...running.entries()].map(([label, at]) => `${label} ${secs(now - at)}`).join(', ');
  console.log(dim(`  … ${running.size} running: ${names}`));
}, 5_000);
heartbeat.unref?.();

run = launch(config, { lanes, excluded, skipped }, { usePty, cols: process.stdout.columns || 120, rows: process.stdout.rows || 40 }, (event) => {
  if (event.type === 'start') {
    running.set(event.lane.label, Date.now());
    console.log(dim(`▸ ${event.lane.label}`));
  } else if (event.type === 'finish' && event.result.status !== 'skip') {
    running.delete(event.result.lane.label);
    report(event.result);
  }
});
const { results, failed, wall, ranTotal, code } = await run.done;
clearInterval(heartbeat);

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
  const tint = CI ? red : yellow;
  console.log(`  ${tint('⊘')} ${cols(lane.label)}  ${tint(lane.skip)}`);
}
for (const { name } of excluded) {
  console.log(`  ${dim('·')} ${dim(cols(`packages/${name}`))}  ${dim('excluded (CI runs it as its own job)')}`);
}

// A failing lane's output is printed where the lane finished, which in
// CI is the middle of a very long log — and GitHub drops the MIDDLE of a
// log it has to truncate, keeping the head and the tail. The root lane
// alone prints ~6000 lines, so the one thing worth reading (the name of
// the test that failed) is exactly what goes missing. Repeat each
// failing lane's failures and tail after the summary, where truncation
// cannot reach it.
if (failed.length > 0) {
  for (const r of failed) console.log(failureBlock(r, { dim, red }));
  console.log(red(`\n✗ ${failed.length} of ${results.length} lanes failed: ${failed.map((r) => r.lane.label).join(', ')}\n`));
  process.exit(code);
}

if (code !== 0) {
  console.log(red(
    `\n✗ ${skipped.length} lane(s) skipped in CI: ${skipped.map((l) => l.label).join(', ')}\n` +
    '  CI must run every lane; a skipped suite cannot pass. Fix the tool this lane needs\n' +
    '  (a full `bun install` provisions every workspace member) or remove the suite.\n',
  ));
  process.exit(code);
}

console.log(green(`\n✓ ${results.length} lanes, ${ranTotal} tests passed in ${secs(wall)}\n`));
