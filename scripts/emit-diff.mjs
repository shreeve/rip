// The v1/v2 emitter differential over the whole consumer corpus: every
// tracked package module and every language-suite row, through each
// caller's option set (test/support/emit-diff.js defines the outcomes).
// Exits 1 when any pair differs without a ledger entry, or a ledger
// entry no longer matches.
//
//   bun scripts/emit-diff.mjs                  every input, every option set
//   bun scripts/emit-diff.mjs --rows           language-suite rows only
//   bun scripts/emit-diff.mjs --sets js-none,ts-import
//   bun scripts/emit-diff.mjs --show 50        list up to 50 differences
import { join } from 'node:path';
import { packageInputs, rowInputs } from '../test/support/consumer-hashes.js';
import { differential, loadLedger, OPTION_SETS } from '../test/support/emit-diff.js';

const root = join(import.meta.dir, '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  if (at === -1) return null;
  const value = args[at + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`emit-diff: ${name} needs a value`);
  return value;
};
for (const arg of args) {
  if (arg.startsWith('--') && !['--rows', '--sets', '--show'].includes(arg)) throw new Error(`emit-diff: unknown flag ${arg}`);
}

const sets = flag('--sets')?.split(',') ?? Object.keys(OPTION_SETS);
const show = Number(flag('--show') ?? 20);
const inputs = [...(args.includes('--rows') ? [] : packageInputs(root)), ...(await rowInputs(root))];

const started = performance.now();
const { summary, different, stale, unimplementedKinds } = differential(inputs, { sets, ledger: loadLedger(root) });

console.log(`emit-diff: ${inputs.length} programs, ${((performance.now() - started) / 1000).toFixed(1)} s`);
console.log(`${'set'.padEnd(12)} ${'identical'.padStart(9)} ${'unimpl'.padStart(7)} ${'explained'.padStart(9)} ${'DIFFERENT'.padStart(9)} ${'parse-rej'.padStart(9)}`);
for (const [set, c] of Object.entries(summary)) {
  console.log(`${set.padEnd(12)} ${String(c.identical).padStart(9)} ${String(c.unimplemented).padStart(7)} ${String(c.explained).padStart(9)} ${String(c.different).padStart(9)} ${String(c.parseRejected).padStart(9)}`);
}
const kinds = [...unimplementedKinds].sort((a, b) => b[1] - a[1]);
if (kinds.length) {
  console.log(`\nfirst unimplemented kind per program (top 20 of ${kinds.length}):`);
  for (const [kind, n] of kinds.slice(0, 20)) console.log(`  ${kind.padEnd(24)} ${n}`);
}
if (different.length) {
  console.log(`\nDIFFERENT (${different.length}; showing ${Math.min(show, different.length)}):`);
  for (const d of different.slice(0, show)) console.log(`  [${d.set}] ${d.key}\n    v1 ${d.v1} v2 ${d.v2}  ${d.detail}`);
}
if (stale.length) {
  console.log(`\nSTALE ledger entries (${stale.length}): the pair is now identical or its output moved`);
  for (const e of stale) console.log(`  [${e.set}] ${e.key}`);
}
process.exit(different.length || stale.length ? 1 : 0);
