// Shows each consumer-corpus program whose output differs between another
// revision's compiler and this checkout's: the review that precedes
// accepting a moved manifest with `bun run corpus`.
//   bun scripts/consumer-diff.mjs <git-ref> [key substring]
//
// `--records` compares whole emit records instead of output text: for
// every program and every option set real callers emit with, the code,
// the mapping rows, every editor field, and a rejection's message and
// span (test/support/emit-diff.js's `canonical`). It is the gate of an
// emitter change that must move nothing. Exits 1 on any difference.
//   bun scripts/consumer-diff.mjs --records <git-ref> [--rows] [--sets a,b] [--show n] [key substring]
// The ref's records are cached by commit and program text, so a rerun
// emits this checkout's side alone. `--leaf-rows` classifies each record
// that differs only in its mapping rows and source-span channels, row by
// row: MOVED (same node, role and generated span, a source span of the
// same spelling), CHANGED (a source span of another spelling), ADDED or
// LOST, and each channel entry the same way.
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { packageInputs, rowInputs } from '../test/support/consumer-hashes.js';
import { OPTION_SETS, canonical, recordHash } from '../test/support/emit-diff.js';

const args = process.argv.slice(2);
const records = args.includes('--records');
const rowsOnly = args.includes('--rows');
const leafRows = args.includes('--leaf-rows');
const valueOf = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? null : args[at + 1];
};
const sets = valueOf('--sets')?.split(',') ?? Object.keys(OPTION_SETS);
const show = Number(valueOf('--show') ?? 20);
const positional = args.filter((a, i) => !a.startsWith('--') && !['--sets', '--show'].includes(args[i - 1]));
const [ref, filter] = positional;
if (!ref) {
  console.error('usage: bun scripts/consumer-diff.mjs [--records [--rows] [--sets a,b] [--show n]] <git-ref> [key substring]');
  process.exit(2);
}
for (const set of sets) if (!OPTION_SETS[set]) { console.error(`unknown option set '${set}'`); process.exit(2); }

const root = join(import.meta.dir, '..');
const scratch = mkdtempSync(join(tmpdir(), 'rip-consumer-diff-'));
// A record holds the absolute paths runtime delivery imports from, and
// every generated offset after them: the ref checks out beside this one
// under a name of the same length, so its paths are as long as ours.
const other = records ? join(dirname(root), sibling(basename(root))) : join(scratch, 'ref');
const git = (...a) => Bun.spawnSync(['git', ...a], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
if (git('worktree', 'add', '--detach', other, ref).exitCode !== 0) { console.error(`cannot check out ${ref}`); process.exit(1); }
let failed = false;
try {
  const inputs = (rowsOnly ? [] : packageInputs(root)).concat(await rowInputs(root))
    .filter(({ key }) => !filter || key.includes(filter));
  if (records) failed = await compareRecords(inputs);
  else await compareOutputs(inputs);
} finally {
  git('worktree', 'remove', '--force', other);
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);

function sibling(name) {
  const tag = `.${randomBytes(16).toString('hex')}`;
  return name.length >= tag.length ? tag.padEnd(name.length, 'x') : tag.slice(0, Math.max(name.length, 2));
}

async function compareOutputs(inputs) {
  const { compile: mine } = await import(join(root, 'src/compiler.js'));
  const { compile: theirs } = await import(join(other, 'src/compiler.js'));
  const run = (compile, src, path, face) => {
    try { return compile(src, { path, runtimeDelivery: 'none', ...(face === 'ts' ? { face: 'ts' } : {}) }).code; } catch (e) { return `ERR ${String(e?.message ?? e).split('\n')[0]}\n`; }
  };
  let moved = 0;
  for (const { key, src, path } of inputs) {
    for (const face of ['js', 'ts']) {
      const a = run(theirs, src, path, face), b = run(mine, src, path, face);
      if (a === b) continue;
      moved++;
      const fa = join(scratch, 'a'), fb = join(scratch, 'b');
      writeFileSync(fa, a); writeFileSync(fb, b);
      const d = Bun.spawnSync(['diff', '-u', '--label', `${ref} ${face}`, '--label', `this ${face}`, fa, fb], { stdout: 'pipe' });
      console.log(`=== ${key} [${face}]\n${new TextDecoder().decode(d.stdout)}`);
    }
  }
  console.log(`${moved} output(s) differ from ${ref}`);
}

// One engine's record of one program under one option set, as canonical
// text: the record, or the rejection with its span. Each engine parses
// with its own parser, so neither reads a tree the other emitted from.
function engine(dir) {
  // Each checkout's own path, spelled one way in both engines' records.
  const anyRoot = '#'.repeat(dir.length);
  return Promise.all([import(join(dir, 'src/compiler.js')), import(join(dir, 'src/emit/emitter.js'))])
    .then(([{ parseSource }, { emit }]) => {
      const parses = new Map();
      const parse = (src, path, face, tolerant) => {
        const at = `${face}\0${tolerant}`;
        if (!parses.has(at)) {
          let parsed = null;
          try { parsed = parseSource(src, { path, face, tolerant }); } catch (e) { parsed = { error: `PARSE ${e.message}` }; }
          parses.set(at, parsed);
        }
        return parses.get(at);
      };
      return {
        begin: () => parses.clear(),
        record({ src, path }, options) {
          const { face = 'js', tolerant = false, ...rest } = options;
          const parsed = parse(src, path, face, tolerant);
          if (parsed.error) return { text: parsed.error };
          const { source, dataPayload, dataLine, result } = parsed;
          try {
            const record = emit(result, { ...rest, face, tolerant, source, dataPayload, dataLine, modulePath: path });
            return { text: canonical(record).replaceAll(dir, anyRoot), record, dir, anyRoot };
          } catch (err) {
            return { text: `ERR ${err.message} @${err.start ?? '-'}:${err.end ?? '-'}` };
          }
        },
      };
    });
}

async function compareRecords(inputs) {
  const mine = await engine(root);
  const theirs = await engine(other);
  const sha = new TextDecoder().decode(git('rev-parse', ref).stdout).trim();
  const cachePath = join(tmpdir(), `rip-records-${sha}-${other.length}.json`);
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
  let cacheGrew = false;
  const started = performance.now();
  const differing = [];
  const counts = Object.fromEntries(sets.map((s) => [s, 0]));
  for (const input of inputs) {
    mine.begin();
    theirs.begin();
    const srcHash = recordHash(input.src);
    for (const set of sets) {
      const options = OPTION_SETS[set];
      const at = `${input.key}\0${set}\0${srcHash}`;
      const b = mine.record(input, options);
      let refHash = cache[at];
      if (refHash === undefined) {
        refHash = cache[at] = recordHash(theirs.record(input, options).text);
        cacheGrew = true;
      }
      if (recordHash(b.text) === refHash) continue;
      counts[set]++;
      differing.push({ input, set, options, b });
    }
  }
  if (cacheGrew) writeFileSync(cachePath, JSON.stringify(cache));
  const total = differing.length;
  console.log(`records: ${inputs.length} programs × ${sets.length} option sets against ${ref} (${sha.slice(0, 8)}), ${((performance.now() - started) / 1000).toFixed(1)} s`);
  for (const set of sets) if (counts[set]) console.log(`  ${set.padEnd(15)} ${counts[set]} different`);
  for (const { input, set, options, b } of differing.slice(0, leafRows ? differing.length : show)) {
    theirs.begin();
    const a = theirs.record(input, options);
    if (leafRows) console.log(`  [${set}] ${input.key}\n    ${classifyRows(a, b, input.src)}`);
    else console.log(`  [${set}] ${input.key}\n    ${firstDifference(a, b)}`);
  }
  console.log(`${total} record(s) differ from ${ref}`);
  return total > 0;
}

// The first top-level field two records disagree on, for a readable report.
function firstDifference(a, b) {
  if (!a.record || !b.record) return `${ref} ${a.record ? 'emitted' : a.text.slice(0, 160)} | this ${b.record ? 'emitted' : b.text.slice(0, 160)}`;
  const json = (v) => JSON.stringify(v, (_k, x) => (x instanceof Set ? { Set: [...x] } : x instanceof Map ? { Map: [...x] } : x));
  for (const key of new Set([...Object.keys(a.record), ...Object.keys(b.record)])) {
    if (key === 'stores') continue;
    const x = (json(a.record[key]) ?? 'undefined').replaceAll(a.dir, a.anyRoot);
    const y = (json(b.record[key]) ?? 'undefined').replaceAll(b.dir, b.anyRoot);
    if (x === y) continue;
    let i = 0;
    while (i < x.length && x[i] === y[i]) i++;
    const from = Math.max(0, i - 60);
    return `${key} @${i}: ${ref} …${x.slice(from, i + 100)} | this …${y.slice(from, i + 100)}`;
  }
  return 'records differ';
}

// The row-by-row reading of a record pair that differs in mapping rows
// and source-span channels alone (kinds, memberDecls, …: arrays whose
// entries carry a source span as {start, end} or [start, end, …]);
// anything else is reported as its first difference. A channel entry
// that keeps every other field and moves to a span of the same spelling
// is MOVED.
function classifyRows(a, b, source) {
  if (!a.record || !b.record) return firstDifference(a, b);
  const json = (v) => JSON.stringify(v, (_k, x) => (x instanceof Set ? { Set: [...x] } : x instanceof Map ? { Map: [...x] } : x));
  const spanOf = (e) => (Array.isArray(e) && typeof e[0] === 'number' && typeof e[1] === 'number' ? [e[0], e[1]]
    : e !== null && typeof e === 'object' && typeof e.start === 'number' && typeof e.end === 'number' ? [e.start, e.end] : null);
  const restOf = (e) => (Array.isArray(e) ? json(e.slice(2)) : json({ ...e, start: 0, end: 0 }));
  const channels = [];
  for (const key of new Set([...Object.keys(a.record), ...Object.keys(b.record)])) {
    if (key === 'stores' || key === 'mappings') continue;
    const x = a.record[key], y = b.record[key];
    if ((json(x) ?? '').replaceAll(a.dir, a.anyRoot) === (json(y) ?? '').replaceAll(b.dir, b.anyRoot)) continue;
    if (!Array.isArray(x) || !Array.isArray(y) || ![...x, ...y].every((e) => spanOf(e) !== null)) return `not rows alone (${key}): ${firstDifference(a, b)}`;
    const count = (es) => { const m = new Map(); for (const e of es) m.set(json(e), (m.get(json(e)) ?? 0) + 1); return m; };
    const cx = count(x), cy = count(y);
    const lost = [], added = [];
    for (const e of x) { const k = json(e); if ((cy.get(k) ?? 0) > 0) cy.set(k, cy.get(k) - 1); else lost.push(e); }
    for (const e of y) { const k = json(e); if ((cx.get(k) ?? 0) > 0) cx.set(k, cx.get(k) - 1); else added.push(e); }
    const text = (e) => { const [s0, s1] = spanOf(e); return source.slice(s0, s1); };
    let moved = 0;
    for (let i = lost.length - 1; i >= 0; i--) {
      const j = added.findIndex((e) => restOf(e) === restOf(lost[i]) && text(e) === text(lost[i]));
      if (j !== -1) { moved++; lost.splice(i, 1); added.splice(j, 1); }
    }
    const show = (e) => `${json(spanOf(e))} ${JSON.stringify(text(e))} ${Array.isArray(e) ? json(e.slice(2)) : json({ ...e, start: undefined, end: undefined })}`;
    channels.push(`channel ${key}: ${moved} MOVED, ${added.length} ADDED, ${lost.length} LOST`);
    for (const e of added) channels.push(`      ${key} ADDED ${show(e)}`);
    for (const e of lost) channels.push(`      ${key} LOST ${show(e)}`);
  }
  const keyOf = (r) => `${r.nodeId}|${r.role}|${r.generatedStart}|${r.generatedEnd}`;
  const index = (rows) => {
    const m = new Map();
    for (const r of rows) (m.get(keyOf(r)) ?? m.set(keyOf(r), []).get(keyOf(r))).push(r);
    return m;
  };
  const theirs = index(a.record.mappings), mine = index(b.record.mappings);
  const text = (r) => source.slice(r.sourceStart, r.sourceEnd);
  const same = (x, y) => x.sourceStart === y.sourceStart && x.sourceEnd === y.sourceEnd && x.mappingKind === y.mappingKind;
  const out = { MOVED: [], CHANGED: [], ADDED: [], LOST: [] };
  for (const k of new Set([...theirs.keys(), ...mine.keys()])) {
    const xs = (theirs.get(k) ?? []).filter((x) => !(mine.get(k) ?? []).some((y) => same(x, y)));
    const ys = (mine.get(k) ?? []).filter((y) => !(theirs.get(k) ?? []).some((x) => same(x, y)));
    const n = Math.min(xs.length, ys.length);
    for (let i = 0; i < n; i++) out[text(xs[i]) === text(ys[i]) ? 'MOVED' : 'CHANGED'].push([xs[i], ys[i]]);
    for (const x of xs.slice(n)) out.LOST.push([x]);
    for (const y of ys.slice(n)) out.ADDED.push([y]);
  }
  const span = (r) => `${r.role}#${r.nodeId} gen ${r.generatedStart}-${r.generatedEnd} src ${r.sourceStart}-${r.sourceEnd} ${JSON.stringify(text(r))}`;
  const lines = [`rows: ${Object.entries(out).map(([k, v]) => `${v.length} ${k}`).join(', ')}`];
  for (const k of ['CHANGED', 'ADDED', 'LOST']) for (const pair of out[k]) lines.push(`      ${k} ${pair.map(span).join(' → ')}`);
  for (const c of channels) lines.push(`    ${c}`);
  return lines.join('\n');
}
