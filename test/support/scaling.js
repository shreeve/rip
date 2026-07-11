// Shared scaling-gate harness. Each gate supplies its workload
// (`prepare(n)` builds the input, `run(arg)` does the measured work),
// doubling sizes, and a ratio bound. Timing per size is min-of-5
// (scheduler spikes are one-sided noise — the minimum approaches true
// cost). If any doubling ratio exceeds the bound, the WHOLE measurement
// re-runs once: a machine-load transient does not survive two full
// rounds, while genuinely superlinear growth fails every round by
// structural margin (a quadratic pass doubles at ~4x against the 2.8
// bound). The retry therefore buys load tolerance without weakening
// quadratic-catching power — re-verified against the documented
// quadratic runner variant whenever this harness changes.
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

export const expectLinearDoubling = ({ prepare, run, sizes, bound = 2.8, samples = 5 }) => {
  const measure = () => {
    run(prepare(1000)); // warmup
    const best = sizes.map((n) => {
      const arg = prepare(n);
      let m = Infinity;
      for (let k = 0; k < samples; k++) {
        const t0 = performance.now();
        run(arg);
        m = Math.min(m, performance.now() - t0);
      }
      return Math.max(m, 0.5);
    });
    return best.every((t, i) => i === 0 || t / best[i - 1] < bound);
  };
  expect(measure() || measure()).toBe(true);
};
