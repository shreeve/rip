// The scaling harness's own gate (test/support/scaling.js).
//
// Thirteen extended-tier gates trust expectLinearDoubling to tell linear
// from quadratic. Its comment used to ask whoever edited it to re-verify
// against a quadratic runner by hand; this file is that verification as a
// standing test, over the three shapes that define the contract:
//
//   * a plainly linear run passes;
//   * a genuine quadratic fails — surviving the harness's built-in
//     whole-measurement retry, so this exercises the retry too;
//   * a blowup confined to the LAST doubling fails. This is the shape the
//     growth exponent alone dilutes (a cliff at the top size reads ~1.66
//     against the 1.7 bound) and the reason the pair-ratio backstop exists.
//
// These run real workloads (~2s: the failing shapes ride the harness's
// retry, so each measures twice). Extended tier: every gate this harness
// serves is extended-tier, so a rotted harness costs that tier, not the
// fast loop — the self-test rides with its dependents.
import { expect, test } from 'bun:test';
import { expectLinearDoubling } from '../support/scaling.js';
import { describeExtended } from '../support/extended.js';

const ints = (n) => Array.from({ length: n }, (_, i) => i);

const verdict = (spec) => {
  try { expectLinearDoubling(spec); return null; } catch (e) { return String(e.message ?? e); }
};

describeExtended('the scaling harness discriminates', () => {
  test('a linear workload passes', () => {
    expect(verdict({
      prepare: ints,
      run: (a) => { let s = 0; for (const x of a) s += x * 3; return s; },
      sizes: [8000, 16000, 32000],
    })).toBeNull();
  });

  test('a quadratic workload fails, through the retry, naming its exponent', () => {
    const msg = verdict({
      prepare: ints,
      run: (a) => { let s = 0; for (const x of a) for (const y of a) s += x ^ y; return s; },
      sizes: [2000, 4000, 8000],
    });
    expect(msg).not.toBeNull();
    expect(msg).toContain('growth exponent');
  });

  test('a blowup confined to the last doubling fails (the pair backstop, not the exponent)', () => {
    expect(verdict({
      prepare: ints,
      run: (a) => {
        let s = 0;
        const cliff = a.length >= 8000;
        for (const x of a) { s += x; if (cliff) for (const y of a) s += y & 1; }
        return s;
      },
      sizes: [2000, 4000, 8000],
    })).not.toBeNull();
  });
});
