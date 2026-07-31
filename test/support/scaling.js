// Shared scaling-gate harness. Each gate supplies its workload
// (`prepare(n)` builds the input, `run(arg)` does the measured work),
// doubling sizes, and a ratio bound.
//
// Cost is this process's own CPU time, not elapsed wall time. Wall time
// answers "how long did that take", which on a busy machine is mostly a
// question about the other work: measured on the parse gate, the second
// doubling ratio sat at ~1.8 idle and climbed to ~2.55 — against a 2.8
// bound — with the cores oversubscribed, purely from being descheduled.
// CPU time holds its idle band under the same load, and unlike the
// COUNT-ratio gate below it still sees builtin cost (splice, GC, engine
// work), which is the whole reason these gates exist alongside that one.
//
// Per size the cost is min-of-5 (GC and JIT noise is one-sided — the
// minimum approaches true cost). If any doubling ratio exceeds the
// bound, the WHOLE measurement re-runs once, while genuinely superlinear
// growth fails every round by structural margin (a quadratic pass
// doubles at ~4x against the 2.8 bound) — re-verified against the
// documented quadratic runner variant whenever this harness changes.
import { expect } from 'bun:test';
import { ops } from '../../src/ops.js';

// COUNT-ratio gate (deterministic): run the workload under
// RIP_COUNT_OPS and assert each doubling's instrumented-iteration
// ratio stays linear. Counts are exact and machine-independent — one
// sample, no retry, and a tighter bound than the timing gates can
// afford (linear passes double at ~2×; a quadratic doubles at ~4×).
// Counters see instrumented loops only; builtin costs (splice, GC)
// remain the wall-clock smoke gates' territory.
export const expectLinearOpsDoubling = ({ prepare, run, sizes, bound = 2.6 }) => {
  process.env.RIP_COUNT_OPS = '1';
  try {
    const counts = sizes.map((n) => {
      run(prepare(n));
      expect(ops.n).toBeGreaterThan(0); // the workload must actually count
      return ops.n;
    });
    counts.forEach((c, i) => {
      if (i === 0) return;
      expect(c / counts[i - 1]).toBeLessThan(bound);
    });
  } finally {
    delete process.env.RIP_COUNT_OPS;
  }
};

const cpuMs = (since) => {
  const { user, system } = process.cpuUsage(since);
  return (user + system) / 1000;
};

export const expectLinearDoubling = ({ prepare, run, sizes, bound = 2.8, samples = 5 }) => {
  let costs = [];
  const measure = () => {
    run(prepare(1000)); // warmup
    costs = sizes.map((n) => {
      const arg = prepare(n);
      let m = Infinity;
      for (let k = 0; k < samples; k++) {
        const t0 = process.cpuUsage();
        run(arg);
        m = Math.min(m, cpuMs(t0));
      }
      return Math.max(m, 0.5);
    });
    return costs.every((t, i) => i === 0 || t / costs[i - 1] < bound);
  };
  const ok = measure() || measure();
  // Report the measurement, not just the verdict: a gate that fails on a
  // machine you cannot attach to is only actionable if it says by how
  // much. A ratio of 2.9 against a 2.8 bound is noise to re-examine; 4.1
  // is the quadratic these gates exist to catch, and the two need
  // different responses.
  const ratios = costs.slice(1).map((t, i) => (t / costs[i]).toFixed(2));
  expect(
    ok,
    `sizes ${sizes.join('/')} cost ${costs.map((t) => t.toFixed(2)).join('/')} cpu-ms ` +
    `→ ratios ${ratios.join('/')} (bound ${bound})`,
  ).toBe(true);
};
