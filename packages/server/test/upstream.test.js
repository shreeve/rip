// Upstream pool: target selection strategies, per-target circuit
// breaker, health thresholds, and retry/backoff — all pure over an
// injected clock and RNG, so the whole state machine is deterministic.
// The actual fetch to an upstream and the health-poll loop are the
// serving layer's wiring; what is exercised here is the decision
// logic that decides where a request goes and when a target is cut.
import { describe, expect, test } from 'bun:test';
import { createUpstream } from '@rip-lang/server';

const clock = () => {
  let t = 0;
  return { now: () => t, advance: ms => { t += ms; } };
};

const poolOf = (opts = {}) => {
  const c = clock();
  const rng = { value: 0, next: () => rng.value };
  const pool = createUpstream({
    targets: ['a', 'b', 'c'],
    now: c.now,
    random: rng.next,
    ...opts,
  });
  return { pool, clock: c, rng };
};

describe('selection strategies', () => {
  test('round-robin cycles through healthy targets', () => {
    const { pool } = poolOf({ strategy: 'round-robin' });
    expect([pool.pick(), pool.pick(), pool.pick(), pool.pick()].map(t => t.url))
      .toEqual(['a', 'b', 'c', 'a']);
  });

  test('least-inflight prefers the target with the fewest active requests', () => {
    const { pool } = poolOf({ strategy: 'least-inflight' });
    const first = pool.pick(); // a (all 0, ties to first)
    pool.begin(first);
    const second = pool.pick(); // b or c (a now has 1 inflight)
    expect(second.url).not.toBe('a');
  });

  test('weighted selection honors target weights', () => {
    const { pool, rng } = poolOf({
      targets: [{ url: 'a', weight: 1 }, { url: 'b', weight: 3 }],
      strategy: 'weighted',
    });
    rng.value = 0.1; // low → into the first weight band (a)
    expect(pool.pick().url).toBe('a');
    rng.value = 0.9; // high → into b's larger band
    expect(pool.pick().url).toBe('b');
  });

  test('an empty or all-down pool picks nothing', () => {
    const { pool } = poolOf({ targets: [] });
    expect(pool.pick()).toBeNull();
  });
});

describe('health thresholds', () => {
  test('consecutive failures mark a target unhealthy; it is skipped', () => {
    const { pool } = poolOf({ strategy: 'round-robin', health: { unhealthyThreshold: 2 } });
    const a = pool.pick();
    pool.record(a, { ok: false });
    pool.record(a, { ok: false }); // a now unhealthy
    const picks = new Set([pool.pick().url, pool.pick().url, pool.pick().url]);
    expect(picks.has('a')).toBe(false);
  });

  test('consecutive successes restore an unhealthy target', () => {
    const { pool } = poolOf({ targets: ['a'], health: { unhealthyThreshold: 1, healthyThreshold: 2 } });
    const a = pool.targets()[0];
    pool.record(a, { ok: false }); // unhealthy
    expect(pool.pick()).toBeNull();
    pool.record(a, { ok: true });
    pool.record(a, { ok: true }); // healthy again
    expect(pool.pick().url).toBe('a');
  });
});

describe('circuit breaker', () => {
  const brk = (over = {}) => poolOf({
    targets: ['a'],
    circuit: { minRequests: 4, errorThreshold: 0.5, cooldownMs: 1000, ...over },
    health: { unhealthyThreshold: 100 }, // isolate the circuit from health
  });

  test('the circuit opens when the error rate crosses the threshold', () => {
    const { pool } = brk();
    const a = pool.targets()[0];
    pool.record(a, { ok: false });
    pool.record(a, { ok: false });
    pool.record(a, { ok: true });
    expect(pool.pick().url).toBe('a'); // window not full yet
    pool.record(a, { ok: false }); // 3/4 failures ≥ 0.5 → open
    expect(pool.pick()).toBeNull();
    expect(pool.stats()[0].circuit).toBe('open');
  });

  test('after the cooldown the circuit half-opens for one probe', () => {
    const { pool, clock } = brk();
    const a = pool.targets()[0];
    for (const ok of [false, false, false, false]) pool.record(a, { ok });
    expect(pool.pick()).toBeNull(); // open
    clock.advance(1000);
    const probe = pool.pick(); // half-open: one probe allowed
    expect(probe.url).toBe('a');
    expect(pool.stats()[0].circuit).toBe('half-open');
    expect(pool.pick()).toBeNull(); // no second probe while one is in flight
  });

  test('a successful probe closes the circuit; a failed probe reopens it', () => {
    const { pool, clock } = brk();
    const a = pool.targets()[0];
    for (const ok of [false, false, false, false]) pool.record(a, { ok });
    clock.advance(1000);
    pool.pick(); // half-open probe
    pool.record(a, { ok: true });
    expect(pool.stats()[0].circuit).toBe('closed');
    expect(pool.pick().url).toBe('a');

    for (const ok of [false, false, false, false]) pool.record(a, { ok });
    clock.advance(1000);
    pool.pick();
    pool.record(a, { ok: false }); // failed probe
    expect(pool.stats()[0].circuit).toBe('open');
    expect(pool.pick()).toBeNull();
  });

  test('one pick over several recovered targets strands none of them', () => {
    const { pool, clock } = poolOf({
      targets: ['a', 'b'], strategy: 'round-robin',
      circuit: { minRequests: 4, errorThreshold: 0.5, cooldownMs: 1000 },
      health: { unhealthyThreshold: 100 },
    });
    for (const t of pool.targets()) for (const ok of [false, false, false, false]) pool.record(t, { ok });
    expect(pool.stats().map(s => s.circuit)).toEqual(['open', 'open']);
    clock.advance(1000);
    pool.pick(); // probes exactly one
    const halfOpen = pool.stats().filter(s => s.circuit === 'half-open');
    expect(halfOpen.length).toBe(1); // the other stays 'open', still reachable
    expect(pool.stats().some(s => s.circuit === 'open')).toBe(true);
  });

  test('a probe that is never recorded re-arms after the probe timeout', () => {
    const { pool, clock } = poolOf({
      targets: ['a'],
      circuit: { minRequests: 4, errorThreshold: 0.5, cooldownMs: 1000, probeTimeoutMs: 5000 },
      health: { unhealthyThreshold: 100 },
    });
    const a = pool.targets()[0];
    for (const ok of [false, false, false, false]) pool.record(a, { ok });
    clock.advance(1000);
    expect(pool.pick().url).toBe('a'); // probe taken, never recorded (crashed fetch)
    expect(pool.pick()).toBeNull(); // no second probe yet
    clock.advance(5000); // probe timed out — the target is not stranded
    expect(pool.pick().url).toBe('a');
  });

  test('cooldown carries jitter from the injected RNG', () => {
    const { pool, clock, rng } = brk({ jitter: 0.5 });
    rng.value = 1; // max jitter → cooldown 1000 + 500 = 1500
    const a = pool.targets()[0];
    for (const ok of [false, false, false, false]) pool.record(a, { ok });
    clock.advance(1000);
    expect(pool.pick()).toBeNull(); // not yet — jittered cooldown is 1500
    clock.advance(500);
    expect(pool.pick().url).toBe('a');
  });
});

describe('retry policy', () => {
  test('retries idempotent methods on retryable statuses, up to the attempt cap', () => {
    const { pool } = poolOf({ retry: { attempts: 2, statuses: [502, 503], methods: ['GET'] } });
    expect(pool.shouldRetry('GET', 503, 0)).toBe(true);
    expect(pool.shouldRetry('GET', 503, 2)).toBe(false); // cap reached
    expect(pool.shouldRetry('GET', 200, 0)).toBe(false); // not a retryable status
    expect(pool.shouldRetry('POST', 503, 0)).toBe(false); // not idempotent
  });

  test('backoff grows with the attempt and carries jitter', () => {
    const { pool, rng } = poolOf({ retry: { baseDelayMs: 100, jitter: 0 } });
    rng.value = 0;
    expect(pool.backoff(0)).toBe(100);
    expect(pool.backoff(1)).toBe(200);
    expect(pool.backoff(2)).toBe(400);
  });

  test('backoff is clamped, never Infinity, and a string status still retries', () => {
    const { pool } = poolOf({ retry: { baseDelayMs: 100, jitter: 0, maxDelayMs: 5000, statuses: [503], methods: ['GET'] } });
    expect(pool.backoff(1e9)).toBe(5000);
    expect(pool.shouldRetry('GET', '503', 0)).toBe(true);
  });
});

describe('config hardening', () => {
  test('degenerate circuit config falls back to a working breaker', () => {
    // errorThreshold 0 must not open on a full window of successes.
    const zero = poolOf({ targets: ['a'], circuit: { minRequests: 4, errorThreshold: 0, cooldownMs: 1000 }, health: { unhealthyThreshold: 100 } });
    const a = zero.pool.targets()[0];
    for (const ok of [true, true, true, true]) zero.pool.record(a, { ok });
    expect(zero.pool.stats()[0].circuit).toBe('closed');
    // minRequests 0 must not silently disable the breaker: it falls
    // back to the default window and still opens on a full run of failures.
    const mr = poolOf({ targets: ['b'], circuit: { minRequests: 0, errorThreshold: 0.5, cooldownMs: 1000 }, health: { unhealthyThreshold: 1000 } });
    const b = mr.pool.targets()[0];
    for (let i = 0; i < 20; i++) mr.pool.record(b, { ok: false });
    expect(mr.pool.stats()[0].circuit).toBe('open');
  });

  test('record tolerates malformed input without throwing', () => {
    const { pool } = poolOf({ targets: ['a'] });
    expect(() => pool.record(null, { ok: true })).not.toThrow();
    expect(() => pool.record({ url: 'x' }, { ok: true })).not.toThrow();
    expect(() => pool.record(pool.targets()[0], {})).not.toThrow();
  });
});

describe('inflight accounting', () => {
  test('begin and end bracket a request; end restores availability', () => {
    const { pool } = poolOf({ targets: ['a'], strategy: 'least-inflight' });
    const a = pool.pick();
    pool.begin(a);
    expect(pool.stats()[0].inflight).toBe(1);
    pool.end(a);
    expect(pool.stats()[0].inflight).toBe(0);
  });
});
