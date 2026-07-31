// The scaling harness's own gate (test/support/scaling.js).
//
// Thirteen extended-tier gates trust expectLinearDoubling to tell linear
// from quadratic. The discrimination lives in scalingVerdict, a pure
// function over (sizes, costs) — so it is proven here on exact numbers,
// with the cost triples captured from real CI failures pinned as
// fixtures. No clock is involved: a verdict test that measured real
// workloads would itself be load-sensitive, which is the disease the
// verdict exists to cure. (A first version of this file did exactly
// that, and its quadratic — a 16x end-to-end signal against the 10.6x
// the bound allows — was masked on a loaded runner by 1.5x of noise on
// the smallest size. The margins are the statistic's, not the test's,
// so the timing layer keeps only the one check with a fat margin.)
import { expect, test } from 'bun:test';
import { expectLinearDoubling, scalingVerdict } from '../support/scaling.js';
import { describeExtended } from '../support/extended.js';

const verdict = (sizes, costs) => scalingVerdict({ sizes, costs });

// ── The verdict, on exact numbers (fast tier — pure math) ─────────────

test('captured CI failures of the old pairwise statistic are green: one lucky-fast middle sample is not growth', () => {
  // Real cost triples from CI runs that failed the old per-pair bound.
  // Each has a pair ratio the old statistic rejected; each grows more
  // slowly end-to-end than the idle baseline (exponent ~1.2).
  const captured = [
    { sizes: [500, 1000, 2000], costs: [46.45, 73.04, 213.36] },   // pairs 1.57/2.92, exponent 1.10
    { sizes: [2000, 4000, 8000], costs: [48.20, 124.12, 352.00] }, // pairs 2.58/2.84, exponent 1.43
    { sizes: [2000, 4000, 8000], costs: [21.12, 50.53, 113.58] },  // the idle baseline itself
  ];
  for (const c of captured) expect(verdict(c.sizes, c.costs).ok).toBe(true);
});

test('a quadratic is red by exponent, and the message carries the numbers', () => {
  const v = verdict([2000, 4000, 8000], [10, 40, 160]);
  expect(v.ok).toBe(false);
  expect(v.message).toContain('growth exponent 2.00');
});

test('sustained growth just under the backstop is red by the exponent alone', () => {
  // Pairs of 3.30/3.30 clear the 3.4 backstop individually, but held for
  // two doublings they compound to 10.9x — exponent 1.72. This is the
  // one shape only the exponent catches, and it is exactly what a
  // lucky-middle sample cannot fake: both endpoints have to move.
  const v = verdict([2000, 4000, 8000], [10, 33, 108.9]);
  expect(v.ok).toBe(false);
  expect(v.message).toContain('growth exponent 1.72');
});

test('a blowup confined to the last doubling is red by the pair backstop, not the exponent', () => {
  // End-to-end this reads exponent ~1.54 — under the 1.7 bound. The
  // 4.25x last pair is why the backstop exists.
  const v = verdict([2000, 4000, 8000], [10, 20, 85]);
  expect(v.ok).toBe(false);
  expect(v.message).toContain('pair ratios 2.00/4.25');
});

test('the bounds hold for any geometric size progression, not only doubling', () => {
  expect(verdict([1000, 3000, 9000], [10, 31, 92]).ok).toBe(true);    // linear at 3x steps
  expect(verdict([1000, 3000, 9000], [10, 90, 810]).ok).toBe(false);  // quadratic at 3x steps
});

// ── The measurement path, end to end (extended tier — real clock) ─────

describeExtended('the harness measures what the verdict judges', () => {
  // One integration check each way. The quadratic's margin is what makes
  // it CI-safe: at 3x size steps its pair ratios are ~9x against the 3.4
  // backstop and its end-to-end signal is 81x against the ~42x the
  // exponent bound allows — noise has to shrink the signal by more than
  // half, twice (the harness retries), to mask it.
  const ints = (n) => Array.from({ length: n }, (_, i) => i);

  test('a linear workload passes through the real measurement path', () => {
    expectLinearDoubling({
      prepare: ints,
      run: (a) => { let s = 0; for (const x of a) s += x * 3; return s; },
      sizes: [8000, 16000, 32000],
    });
  });

  test('a quadratic workload fails through the real measurement path', () => {
    let msg = null;
    try {
      expectLinearDoubling({
        prepare: ints,
        run: (a) => { let s = 0; for (const x of a) for (const y of a) s += x ^ y; return s; },
        sizes: [1000, 3000, 9000],
      });
    } catch (e) { msg = String(e.message ?? e); }
    expect(msg).not.toBeNull();
    expect(msg).toContain('growth exponent');
  });
});
