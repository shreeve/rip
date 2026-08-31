// API proxying on a live Site: Manager registers the app's `/api` prefix as
// proxy-first, and the edge reaches a worker through it.
//
// Small, but it is the only coverage of that path in the repo — nothing
// outside test/browser boots manager.rip, worker upstreams, or proxy_first.
// It lives against the suite's own fixture so no demo has to answer to CI.
import { expect, test } from '@playwright/test';

test('an /api route is proxied to a worker', async ({ request }) => {
  const res = await request.get('/api/ping');
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true, from: 'worker' });
});

test('a path outside the API prefix is served as a file, not proxied', async ({ request }) => {
  const res = await request.get('/styles.css');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/css');
});
