#!/usr/bin/env bun
// Reactive runtime benchmark: memory, construction, reads, propagation,
// effect re-runs and teardown, for one runtime file per process (the
// runtime's sentinel rejects a second copy).
//
//   bun scripts/reactive-bench.mjs [runtime.js] [--json]
//
// Compare two runtimes by running this once per file. Each timing is the
// median of several rounds after a warm-up round; memory is the heap
// growth per object across 100k live objects after a forced collection.

import { heapStats } from 'bun:jsc';
import { resolve } from 'path';

const path = resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'src/runtime/reactive.js');
const json = process.argv.includes('--json');
const R = await import(path);
const { __state, __computed, __effect, __batch, __ownerFrame, __pushOwner, __popOwner } = R;

const heap = () => { Bun.gc(true); return heapStats().heapSize; };
const memPer = (make, n = 100_000) => {
  const keep = new Array(n);
  const before = heap();
  for (let i = 0; i < n; i++) keep[i] = make(i);
  const after = heap();
  const per = (after - before) / n;
  keep.length = 0;
  return Math.round(per);
};

const time = (fn, rounds = 7) => {
  fn();
  const t = [];
  for (let r = 0; r < rounds; r++) { const s = Bun.nanoseconds(); fn(); t.push(Bun.nanoseconds() - s); }
  t.sort((a, b) => a - b);
  return t[rounds >> 1];
};

const results = {};
const put = (name, value, unit) => { results[name] = { value, unit }; };

// ── memory ───────────────────────────────────────────────────────────────
put('memory: state', memPer((i) => __state(i)), 'B');
put('memory: computed (unread)', memPer((i) => __computed(() => i)), 'B');
{
  const s = __state(0);
  put('memory: computed (read once)', memPer(() => { const c = __computed(() => s.value + 1); c.value; return c; }), 'B');
}
{
  const s = __state(0);
  const disposers = [];
  put('memory: effect (one dependency)', memPer(() => { const d = __effect(() => { s.value; }); disposers.push(d); return d; }), 'B');
  for (const d of disposers) d();
}

// ── construction ─────────────────────────────────────────────────────────
const N = 100_000;
put('construct: 100k states', time(() => { for (let i = 0; i < N; i++) __state(i); }) / N, 'ns/op');
put('construct: 100k computeds', time(() => { for (let i = 0; i < N; i++) __computed(() => i); }) / N, 'ns/op');
{
  const s = __state(0);
  put('construct+dispose: 10k effects', time(() => {
    const ds = [];
    for (let i = 0; i < 10_000; i++) ds.push(__effect(() => { s.value; }));
    for (const d of ds) d();
  }) / 10_000, 'ns/op');
}

// ── reads ────────────────────────────────────────────────────────────────
{
  const s = __state(1);
  let x = 0;
  put('read: untracked state.value x1M', time(() => { for (let i = 0; i < 1_000_000; i++) x += s.value; }) / 1_000_000, 'ns/op');
  const c = __computed(() => s.value * 2);
  put('read: clean computed.value x1M', time(() => { for (let i = 0; i < 1_000_000; i++) x += c.value; }) / 1_000_000, 'ns/op');
  if (x === 42) console.log('');
}

// ── propagation ──────────────────────────────────────────────────────────
{
  const s = __state(0);
  let runs = 0;
  const d = __effect(() => { s.value; runs++; });
  put('write: state → effect', time(() => { for (let i = 0; i < 100_000; i++) s.value = i + 1; s.value = 0; }) / 100_000, 'ns/op');
  d();
}
{
  const s = __state(0);
  const c = __computed(() => s.value + 1);
  const d = __effect(() => { c.value; });
  put('write: state → computed → effect', time(() => { for (let i = 0; i < 100_000; i++) s.value = i + 1; s.value = 0; }) / 100_000, 'ns/op');
  d();
}
{
  const s = __state(0);
  const ds = [];
  for (let i = 0; i < 100; i++) ds.push(__effect(() => { s.value; }));
  put('write: fan-out to 100 effects', time(() => { for (let i = 0; i < 1_000; i++) s.value = i + 1; s.value = 0; }) / 1_000, 'ns/op');
  for (const d of ds) d();
}
{
  const s = __state(0);
  let c = __computed(() => s.value);
  for (let i = 0; i < 99; i++) { const prev = c; c = __computed(() => prev.value + 1); }
  const last = c;
  const d = __effect(() => { last.value; });
  put('write: chain of 100 computeds', time(() => { for (let i = 0; i < 1_000; i++) s.value = i + 1; s.value = 0; }) / 1_000, 'ns/op');
  d();
}
{
  // The equality cut: the computed's output never changes, so the effect
  // must not re-run.
  const s = __state(0);
  const c = __computed(() => s.value >= 0);
  let runs = 0;
  const d = __effect(() => { c.value; runs++; });
  put('write: cut by an unchanged computed', time(() => { for (let i = 0; i < 100_000; i++) s.value = i + 1; s.value = 0; }) / 100_000, 'ns/op');
  if (runs !== 1) throw new Error(`equality cut broken: ${runs} runs`);
  d();
}
{
  const a = __state(0), b = __state(0);
  const d = __effect(() => { a.value; b.value; });
  put('batch: two writes, one flush', time(() => { for (let i = 0; i < 100_000; i++) __batch(() => { a.value = i + 1; b.value = i + 1; }); }) / 100_000, 'ns/op');
  d();
}

// ── effect re-runs ───────────────────────────────────────────────────────
{
  const deps = Array.from({ length: 50 }, (_, i) => __state(i));
  const trigger = __state(0);
  const d = __effect(() => { trigger.value; for (const s of deps) s.value; });
  put('re-run: effect with 50 dependencies', time(() => { for (let i = 0; i < 10_000; i++) trigger.value = i + 1; trigger.value = 0; }) / 10_000, 'ns/op');
  d();
}

// ── ownership ────────────────────────────────────────────────────────────
{
  // Children disposed one by one before their parent: each removal
  // searches the parent's list.
  put('teardown: 10k nested frames, children first', time(() => {
    const parent = __ownerFrame({ nested: false });
    const tok = __pushOwner(parent);
    const kids = [];
    for (let i = 0; i < 10_000; i++) kids.push(__ownerFrame());
    __popOwner(tok);
    for (const k of kids) k.dispose();
    parent.dispose();
  }, 3) / 10_000, 'ns/op');
}
{
  // A component-shaped mount: one frame, 10 states, 5 computeds, 5 effects.
  put('mount+unmount: component-shaped frame', time(() => {
    for (let n = 0; n < 1_000; n++) {
      const f = __ownerFrame({ nested: false });
      const tok = __pushOwner(f);
      const ss = Array.from({ length: 10 }, (_, i) => __state(i));
      const cs = Array.from({ length: 5 }, (_, i) => __computed(() => ss[i].value + ss[i + 5].value));
      for (let i = 0; i < 5; i++) __effect(() => { cs[i].value; });
      __popOwner(tok);
      f.dispose();
    }
  }) / 1_000, 'ns/op');
}

if (json) console.log(JSON.stringify(results));
else for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(44)} ${String(Math.round(v.value * 10) / 10).padStart(10)} ${v.unit}`);
