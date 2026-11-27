// v1 against v2 emit time, measured on the programs v2 covers: those
// both engines emit to the identical record (test/support/emit-diff.js).
// Every timing is emit() alone over parses made in advance, interleaved
// A/B rounds, the fastest round reported. Construction cost is measured
// too: each engine's module load in a fresh process, and the per-compile
// fixed cost of emitting an empty program.
//
//   bun scripts/emit-bench.mjs [rounds]
//
// Run it under cpuq's timing lane (AGENTS.md "Heavy commands run under
// cpuq"); numbers from a loaded machine rank, they do not measure.
import { join } from 'node:path';
import { parseSource } from '../src/compiler.js';
import { emit as emitV1 } from '../src/emitter.js';
import { emit as emitV2 } from '../src/emit/index.js';
import { packageInputs, rowInputs } from '../test/support/consumer-hashes.js';
import { OPTION_SETS } from '../test/support/emit-diff.js';

const root = join(import.meta.dir, '..');
const rounds = Number(process.argv[2] ?? 7);
const inputs = [...packageInputs(root), ...(await rowInputs(root))];

const options = (parsed, set) => {
  const { face = 'js', tolerant = false, ...rest } = OPTION_SETS[set];
  return { ...rest, face, tolerant, source: parsed.source, dataPayload: parsed.dataPayload, modulePath: parsed.path };
};

const sameRecord = (a, b) => {
  const strip = ({ stores, ...rest }) => JSON.stringify(rest, (_k, v) => (v instanceof Set ? [...v] : v));
  return strip(a) === strip(b);
};

const timeRounds = (fnA, fnB) => {
  fnA(); fnB();
  const ta = [], tb = [];
  for (let i = 0; i < rounds; i++) {
    const order = i % 2 ? [[fnB, tb], [fnA, ta]] : [[fnA, ta], [fnB, tb]];
    for (const [fn, into] of order) {
      const start = performance.now();
      fn();
      into.push(performance.now() - start);
    }
  }
  return [Math.min(...ta), Math.min(...tb)];
};

const row = (label, n, a, b) => {
  const ratio = n === 0 ? '-' : `${((b / a) * 100).toFixed(0)}%`;
  console.log(`${label.padEnd(30)} n=${String(n).padStart(5)}  v1 ${a.toFixed(1).padStart(8)} ms  v2 ${b.toFixed(1).padStart(8)} ms  v2/v1 ${ratio.padStart(5)}`);
};

console.log(`emit-bench: ${inputs.length} programs, ${rounds} rounds\n`);
for (const set of ['js-inline', 'ts-import']) {
  const covered = [];
  for (const { src, path } of inputs) {
    let parsed;
    try {
      parsed = parseSource(src, { path, face: OPTION_SETS[set].face ?? 'js' });
      const opts = options(parsed, set);
      if (sameRecord(emitV1(parsed.result, opts), emitV2(parsed.result, opts))) covered.push([parsed, opts]);
    } catch {
      // Rejected by the parser, by either engine, or not covered by v2.
    }
  }
  const [a, b] = covered.length === 0 ? [0, 0] : timeRounds(
    () => { for (const [p, o] of covered) emitV1(p.result, o); },
    () => { for (const [p, o] of covered) emitV2(p.result, o); },
  );
  row(`covered programs, ${set}`, covered.length, a, b);
}

// Per-compile fixed cost: the driver, stores and builder setup, and the
// emit record, with nothing to lower.
for (const set of ['js-inline', 'ts-import']) {
  const parsed = parseSource('', { face: OPTION_SETS[set].face ?? 'js' });
  const opts = options(parsed, set);
  const N = 2000;
  const [a, b] = timeRounds(
    () => { for (let i = 0; i < N; i++) emitV1(parsed.result, opts); },
    () => { for (let i = 0; i < N; i++) emitV2(parsed.result, opts); },
  );
  row(`empty program x${N}, ${set}`, N, a, b);
}

// Module load: a fresh process imports one engine and reports how long
// the import took; the fastest of the rounds counts.
const loadTime = (file) => {
  const times = [];
  for (let i = 0; i < rounds; i++) {
    const code = `const t = performance.now(); await import(${JSON.stringify(join(root, file))}); console.log(performance.now() - t);`;
    const proc = Bun.spawnSync(['bun', '-e', code], { cwd: root });
    if (proc.exitCode !== 0) throw new Error(`emit-bench: loading ${file} failed: ${proc.stderr}`);
    times.push(Number(new TextDecoder().decode(proc.stdout).trim()));
  }
  return Math.min(...times);
};
row('module load (fresh process)', 1, loadTime('src/emitter.js'), loadTime('src/emit/index.js'));
