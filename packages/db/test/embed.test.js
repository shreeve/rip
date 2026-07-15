// The boot-time harbor reachability probe. Pure over an injected fetch,
// so every branch — healthy, unhealthy, unreachable, URL resolution —
// tests without a server. (The 5s AbortController timeout shares the
// unreachable path: an abort surfaces as the same caught rejection a
// transport failure does.)
import { describe, expect, test } from 'bun:test';
import { assertReachable, ensureRunning } from '@rip-lang/db/embed';

const reply = (status, body) => ({ ok: status >= 200 && status < 400, status, json: async () => body });

describe('assertReachable', () => {
  test('a healthy /ready (200 { ok: true }) resolves to "running"', async () => {
    let hit = null;
    const fetch = async (url) => { hit = url; return reply(200, { ok: true }); };
    expect(await assertReachable('http://harbor:9494', { fetch })).toBe('running');
    expect(hit).toBe('http://harbor:9494/ready'); // probes /ready, not /sql
  });

  test('a 503 (harbor up, database unhealthy) throws not-reachable', async () => {
    const fetch = async () => reply(503, { ok: false });
    await expect(assertReachable('http://harbor:9494', { fetch })).rejects.toThrow(/not reachable at http:\/\/harbor:9494/);
  });

  test('a 200 body without ok:true is not reachable', async () => {
    const fetch = async () => reply(200, { ok: false });
    await expect(assertReachable('http://harbor:9494', { fetch })).rejects.toThrow(/not reachable/);
  });

  test('a transport failure is caught and reported as not-reachable', async () => {
    const fetch = async () => { throw new TypeError('connection refused'); };
    await expect(assertReachable('http://harbor:9494', { fetch })).rejects.toThrow(/not reachable/);
  });

  test('a trailing slash is trimmed from the resolved url', async () => {
    let hit = null;
    const fetch = async (url) => { hit = url; return reply(200, { ok: true }); };
    await assertReachable('http://harbor:9494///', { fetch });
    expect(hit).toBe('http://harbor:9494/ready');
  });

  test('an omitted url falls back to RIP_DB_URL then the local default', async () => {
    let hit = null;
    const fetch = async (url) => { hit = url; return reply(200, { ok: true }); };
    const prev = process.env.RIP_DB_URL;
    try {
      process.env.RIP_DB_URL = 'http://env-harbor:9494';
      await assertReachable(null, { fetch });
      expect(hit).toBe('http://env-harbor:9494/ready');
      delete process.env.RIP_DB_URL;
      await assertReachable(null, { fetch });
      expect(hit).toBe('http://127.0.0.1:9494/ready'); // package default
    } finally {
      if (prev === undefined) delete process.env.RIP_DB_URL; else process.env.RIP_DB_URL = prev;
    }
  });
});

describe('ensureRunning', () => {
  test('is a back-compat alias that only checks reachability', async () => {
    const fetch = async () => reply(200, { ok: true });
    expect(await ensureRunning('http://harbor:9494', { fetch })).toBe('running');
  });
});
