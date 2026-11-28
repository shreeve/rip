// The analysis differential over the whole consumer corpus: every
// tracked package module and every language-suite row, through each
// option set (test/support/analyze-diff.js defines the verdicts and the
// outcomes). Exits 1 when any program differs.
//
//   bun scripts/analyze-diff.mjs                  every input, every option set
//   bun scripts/analyze-diff.mjs --rows           language-suite rows only
//   bun scripts/analyze-diff.mjs --sets js,ts
//   bun scripts/analyze-diff.mjs --show 50        list up to 50 differences
import { join } from 'node:path';
import { packageInputs, rowInputs } from '../test/support/consumer-hashes.js';
import { differential, OPTION_SETS } from '../test/support/analyze-diff.js';

const root = join(import.meta.dir, '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  if (at === -1) return null;
  const value = args[at + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`analyze-diff: ${name} needs a value`);
  return value;
};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--rows') continue;
  if (args[i] === '--sets' || args[i] === '--show') { i++; continue; }
  throw new Error(`analyze-diff: unknown argument ${args[i]}`);
}

const sets = flag('--sets')?.split(',') ?? Object.keys(OPTION_SETS);
const show = Number(flag('--show') ?? 20);
if (!Number.isInteger(show) || show < 0) throw new Error(`analyze-diff: --show needs a whole number, got ${flag('--show')}`);
const inputs = [...(args.includes('--rows') ? [] : packageInputs(root)), ...(await rowInputs(root))];

const started = performance.now();
const { summary, different } = differential(inputs, { sets });

console.log(`analyze-diff: ${inputs.length} programs, ${((performance.now() - started) / 1000).toFixed(1)} s`);
console.log(`${'set'.padEnd(6)} ${'identical'.padStart(9)} ${'masked'.padStart(7)} ${'DIFFERENT'.padStart(9)} ${'parse-rej'.padStart(9)} ${'skipped'.padStart(7)}`);
for (const [set, c] of Object.entries(summary)) {
  console.log(`${set.padEnd(6)} ${String(c.identical).padStart(9)} ${String(c.masked).padStart(7)} ${String(c.different).padStart(9)} ${String(c.parseRejected).padStart(9)} ${String(c.skipped).padStart(7)}`);
}
if (different.length) {
  console.log(`\nDIFFERENT (${different.length}; showing ${Math.min(show, different.length)}):`);
  for (const d of different.slice(0, show)) console.log(`  [${d.set}] ${d.key}\n    ${d.detail}`);
}
process.exit(different.length ? 1 : 0);
