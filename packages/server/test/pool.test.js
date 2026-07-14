// The worker pool: bounded concurrency across a fixed set of workers,
// a bounded queue with a per-job wait timeout (backpressure), a
// recycle policy (retire a worker after N requests or an age, replace
// it), and graceful shutdown that drains in flight. The worker body
// and the clock are injected, so the whole lifecycle tests
// deterministically without threads or real time.
import { describe, expect, test } from 'bun:test';
import { createPool } from '@rip-lang/server';

// A controllable worker: each handle() returns a promise the test
// resolves by hand, so ordering and draining are observable.
const controllable = () => {
  const pending = [];
  const worker = {
    handled: 0,
    handle(job) {
      return new Promise((resolve, reject) => {
        worker.handled += 1;
        pending.push({ job, resolve, reject });
      });
    },
  };
  worker.pending = pending;
  worker.settleNext = (value) => pending.shift().resolve(value);
  return worker;
};

// A manual clock + scheduler: time only advances when the test says
// so, and scheduled callbacks fire on advance.
const fakeClock = () => {
  let t = 0;
  const timers = [];
  return {
    now: () => t,
    schedule: (fn, ms) => {
      const timer = { at: t + ms, fn, live: true };
      timers.push(timer);
      return () => { timer.live = false; };
    },
    advance(ms) {
      t += ms;
      for (const timer of timers.filter(x => x.live && x.at <= t)) {
        timer.live = false;
        timer.fn();
      }
    },
  };
};

const poolOf = (opts = {}) => {
  const workers = [];
  const clock = fakeClock();
  const pool = createPool({
    size: 2,
    concurrency: 1,
    queueLimit: 3,
    timeout: 1000,
    now: clock.now,
    schedule: clock.schedule,
    spawn: () => { const w = controllable(); workers.push(w); return w; },
    ...opts,
  });
  return { pool, workers, clock };
};

describe('dispatch and concurrency', () => {
  test('jobs spread across workers up to the concurrency limit', async () => {
    const { pool, workers } = poolOf();
    const a = pool.submit('a');
    const b = pool.submit('b');
    expect(workers.length).toBe(2);
    expect(workers[0].pending.length).toBe(1);
    expect(workers[1].pending.length).toBe(1);
    workers[0].settleNext('ra');
    workers[1].settleNext('rb');
    expect(await a).toBe('ra');
    expect(await b).toBe('rb');
  });

  test('a busy pool queues, then dispatches as workers free up', async () => {
    const { pool, workers } = poolOf();
    pool.submit('a');
    pool.submit('b'); // both workers now busy at concurrency 1
    const c = pool.submit('c'); // queued
    expect(pool.stats().queued).toBe(1);
    expect(workers[0].pending.length).toBe(1);
    workers[0].settleNext('ra');
    await Promise.resolve();
    expect(pool.stats().queued).toBe(0);
    expect(workers[0].pending.length).toBe(1); // picked up 'c'
    workers[0].settleNext('rc');
    expect(await c).toBe('rc');
  });

  test('concurrency > 1 lets one worker hold several jobs', async () => {
    const { pool, workers } = poolOf({ size: 1, concurrency: 3 });
    pool.submit('a');
    pool.submit('b');
    pool.submit('c');
    expect(workers.length).toBe(1);
    expect(workers[0].pending.length).toBe(3);
    expect(pool.stats().queued).toBe(0);
  });
});

describe('backpressure', () => {
  test('a full queue rejects further submits loudly', async () => {
    const { pool } = poolOf();
    pool.submit('a');
    pool.submit('b'); // workers busy
    pool.submit('q1');
    pool.submit('q2');
    pool.submit('q3'); // queue at limit 3
    await expect(pool.submit('overflow')).rejects.toThrow(/at capacity/);
    expect(pool.stats().queued).toBe(3);
  });

  test('a job that waits past the timeout is rejected, freeing the slot', async () => {
    const { pool, workers, clock } = poolOf();
    pool.submit('a');
    pool.submit('b');
    const slow = pool.submit('queued');
    expect(pool.stats().queued).toBe(1);
    clock.advance(1001);
    await expect(slow).rejects.toThrow(/tim/i);
    expect(pool.stats().queued).toBe(0);
    // A freed worker no longer picks up the timed-out job.
    workers[0].settleNext('ra');
    await Promise.resolve();
    expect(workers[0].pending.length).toBe(0);
  });
});

describe('recycle policy', () => {
  test('a worker retires after its request budget and is replaced', async () => {
    const { pool, workers } = poolOf({ size: 1, concurrency: 1, maxRequests: 2 });
    const first = workers.length;
    pool.submit('a'); workers[0].settleNext('ra'); await Promise.resolve();
    pool.submit('b'); workers[0].settleNext('rb'); await Promise.resolve();
    // budget spent; the next submit spawns a replacement worker
    pool.submit('c');
    await Promise.resolve();
    expect(workers.length).toBe(first + 1);
    expect(pool.stats().recycled).toBe(1);
  });

  test('a worker past its max age retires when next idle', async () => {
    const { pool, workers, clock } = poolOf({ size: 1, concurrency: 1, maxAge: 5000 });
    pool.submit('a');
    clock.advance(6000);
    workers[0].settleNext('ra');
    await Promise.resolve();
    pool.submit('b');
    await Promise.resolve();
    expect(workers.length).toBe(2);
    expect(pool.stats().recycled).toBe(1);
  });

  test('a retiring worker drains its in-flight jobs before replacement', async () => {
    const { pool, workers } = poolOf({ size: 1, concurrency: 2, maxRequests: 2 });
    const a = pool.submit('a');
    const b = pool.submit('b'); // both dispatched to worker 0, which is now spent
    expect(workers[0].pending.length).toBe(2);
    // The spent worker still completes both in-flight jobs before it leaves.
    workers[0].settleNext('ra');
    workers[0].settleNext('rb');
    expect(await a).toBe('ra');
    expect(await b).toBe('rb');
    await Promise.resolve();
    pool.submit('c'); // lands on the replacement, not the retired worker
    await Promise.resolve();
    expect(workers.length).toBe(2);
    expect(pool.stats().recycled).toBe(1);
  });
});

describe('graceful shutdown', () => {
  test('shutdown drains in-flight work and then resolves', async () => {
    const { pool, workers } = poolOf();
    const a = pool.submit('a');
    const b = pool.submit('b');
    const drained = pool.shutdown();
    let done = false;
    drained.then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false); // still draining
    workers[0].settleNext('ra');
    workers[1].settleNext('rb');
    await a; await b;
    await drained;
    expect(done).toBe(true);
  });

  test('submits after shutdown reject; queued jobs are cancelled', async () => {
    const { pool, workers } = poolOf();
    pool.submit('a');
    pool.submit('b');
    const queued = pool.submit('c');
    pool.shutdown();
    await expect(pool.submit('late')).rejects.toThrow(/shut/i);
    await expect(queued).rejects.toThrow(/shut/i);
    workers[0].settleNext('ra');
    workers[1].settleNext('rb');
  });
});

describe('robustness', () => {
  test('a synchronously-throwing handle rejects its job and never wedges the pool', async () => {
    let mode = 'throw';
    const pool = createPool({
      size: 1,
      concurrency: 1,
      spawn: () => ({ handle: () => { if (mode === 'throw') throw new Error('sync boom'); return Promise.resolve('ok'); } }),
    });
    await expect(pool.submit('a')).rejects.toThrow(/sync boom/);
    expect(pool.stats().inflight).toBe(0);
    mode = 'ok';
    expect(await pool.submit('b')).toBe('ok');
  });

  test('a NaN or non-numeric size still floors to a working pool of one', async () => {
    const pool = createPool({ size: NaN, queueLimit: NaN, spawn: () => ({ handle: () => Promise.resolve('r') }) });
    expect(pool.stats().size).toBe(1);
    expect(await pool.submit('a')).toBe('r');
  });

  test('a recycled worker and shutdown dispose the underlying worker', async () => {
    const closed = [];
    const clock = fakeClock();
    let n = 0;
    const pool = createPool({
      size: 1, concurrency: 1, maxRequests: 1,
      now: clock.now, schedule: clock.schedule,
      spawn: () => { const id = n++; return { handle: () => Promise.resolve('r'), close: () => closed.push(id) }; },
    });
    await pool.submit('a'); // worker 0 spent → recycled → closed
    await Promise.resolve();
    expect(closed).toContain(0);
    await pool.shutdown();
    expect(closed.length).toBeGreaterThanOrEqual(2); // the replacement disposed at shutdown
  });

  test('a recycle keeps full available capacity — no queue gap while draining', async () => {
    const { pool, workers } = poolOf({ size: 1, concurrency: 1, maxRequests: 1 });
    pool.submit('a'); // worker 0 in flight, now spent → retiring
    pool.submit('b'); // replacement already available — dispatched, not queued
    expect(pool.stats().queued).toBe(0);
    expect(workers.length).toBe(2);
    workers[0].settleNext('ra');
    workers[1].settleNext('rb');
  });
});

describe('stats', () => {
  test('reports size, inflight, queued, and recycled', async () => {
    const { pool, workers } = poolOf();
    pool.submit('a');
    pool.submit('b');
    pool.submit('c');
    const s = pool.stats();
    expect(s.size).toBe(2);
    expect(s.inflight).toBe(2);
    expect(s.queued).toBe(1);
    expect(s.recycled).toBe(0);
    workers[0].settleNext('ra');
  });
});
