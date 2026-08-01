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
// minimum approaches true cost). If the verdict is red, the WHOLE
// measurement re-runs once, while genuinely superlinear growth fails
// every round by structural margin — the discrimination is a standing
// gate, test/toolchain/scaling-harness.test.js.
//
// The verdict is on the GROWTH EXPONENT — log(cost ratio)/log(size
// ratio) across the endpoints — not on adjacent-pair ratios. A pair
// ratio is maximally exposed to a single noisy sample: one lucky-fast
// middle point sits in the denominator of the next pair — a measured
// pair of 1.57/2.92 carries an end-to-end exponent of 1.10, MORE linear
// than the idle baseline (1.21). Healthy code measures 1.10-1.43 on
// loaded CI runners, ~1.2 idle. A quadratic measures 2.00. The
// bound is 1.7, the midpoint. For sizes evenly spaced in log (every
// caller doubles), the endpoint exponent IS the least-squares slope —
// the middle point has zero leverage on it, which is the point.
//
// Honest cost still grows past 2.0 per doubling (the doubled set is
// walked, allocated and cached, so per-item cost rises as it outgrows
// cache — exponent ~1.2, not 1.0). The pair bound of 3.4 survives only
// as a backstop for a blowup confined to the LAST doubling (a capacity
// cliff), which an endpoint exponent would dilute: healthy pairs reach
// 2.92 under load, while a quadratic's 4x fails both retry rounds.
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

// The verdict, separated from the measuring so it is testable on exact
// numbers (test/toolchain/scaling-harness.test.js pins it against
// measured cost triples — no timing involved).
export const scalingVerdict = ({ sizes, costs, bound = 3.4, exponentBound = 1.7 }) => {
  const exponent = Math.log(costs.at(-1) / costs[0]) / Math.log(sizes.at(-1) / sizes[0]);
  const pairs = costs.slice(1).map((t, i) => t / costs[i]);
  const ok = exponent < exponentBound && pairs.every((r) => r < bound);
  // Report the measurement, not just the verdict: a gate that fails on a
  // machine you cannot attach to is only actionable if it says by how
  // much. An exponent of 1.8 against 1.7 is noise to re-examine; 2.0 is
  // the quadratic these gates exist to catch, and the two need different
  // responses.
  const message =
    `sizes ${sizes.join('/')} cost ${costs.map((t) => t.toFixed(2)).join('/')} cpu-ms ` +
    `→ growth exponent ${exponent.toFixed(2)} (bound ${exponentBound}; linear ~1.2, quadratic 2.0), ` +
    `pair ratios ${pairs.map((r) => r.toFixed(2)).join('/')} (backstop ${bound})`;
  return { ok, message };
};

export const expectLinearDoubling = ({ prepare, run, sizes, bound = 3.4, exponentBound = 1.7, samples = 5 }) => {
  let verdict;
  const measure = () => {
    run(prepare(1000)); // warmup
    const costs = sizes.map((n) => {
      const arg = prepare(n);
      let m = Infinity;
      for (let k = 0; k < samples; k++) {
        const t0 = process.cpuUsage();
        run(arg);
        m = Math.min(m, cpuMs(t0));
      }
      return Math.max(m, 0.5);
    });
    verdict = scalingVerdict({ sizes, costs, bound, exponentBound });
    return verdict.ok;
  };
  const ok = measure() || measure();
  expect(ok, verdict.message).toBe(true);
};
