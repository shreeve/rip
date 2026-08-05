import { expect, test } from '@playwright/test';
import { currentWorkerSocket } from '../harness-worker.mjs';

test('readiness skips stale replacement sockets and selects the newest live worker', () => {
  const calls = [
    { method: 'PUT', body: { upstreams: [{ path: '/live' }] } },
    { method: 'PUT', body: { upstreams: [{ path: '/stale' }] } },
  ];
  const path = currentWorkerSocket(calls, null, candidate => candidate === '/live');
  expect(path).toBe('/live');
});
