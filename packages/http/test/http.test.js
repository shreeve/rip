// The @rip-lang/http behavior contract, exercised end-to-end against a
// live Bun.serve fixture: URL building, query encoding, JSON bodies,
// auto-throw, retries (status, network, Retry-After), timeout/abort
// semantics, lifecycle hooks, and instance defaults/merging.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { HTTPError, TimeoutError, http } from '@rip-lang/http';

let server;
let base;
const hits = [];          // every request the fixture saw: { method, path, search }
const counters = new Map(); // per-key attempt counts for flaky endpoints

const caught = (promise) => promise.then(() => null, (e) => e);
const countHits = (path, search) =>
  hits.filter((h) => h.path === path && (search === undefined || h.search === search)).length;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = await req.text();
      hits.push({ method: req.method, path: url.pathname, search: url.search });

      if (url.pathname.endsWith('/echo')) {
        return Response.json({
          method: req.method,
          path: url.pathname,
          search: url.search,
          headers: Object.fromEntries(req.headers),
          body,
        });
      }

      if (url.pathname.startsWith('/status/')) {
        const status = Number(url.pathname.slice('/status/'.length));
        return new Response(`status ${status}`, { status });
      }

      // Fails with 500 the first `fails` times per key, then succeeds.
      if (url.pathname === '/flaky') {
        const key = url.searchParams.get('key');
        const fails = Number(url.searchParams.get('fails'));
        const attempt = (counters.get(key) ?? 0) + 1;
        counters.set(key, attempt);
        if (attempt <= fails) return new Response('boom', { status: 500 });
        return Response.json({ attempts: attempt });
      }

      // 503 with a Retry-After header once per key, then succeeds.
      if (url.pathname === '/retry-after') {
        const key = url.searchParams.get('key');
        const attempt = (counters.get(key) ?? 0) + 1;
        counters.set(key, attempt);
        if (attempt === 1) {
          const value = url.searchParams.get('format') === 'date'
            ? new Date(Date.now() - 1000).toUTCString()
            : '0';
          return new Response('wait', { status: 503, headers: { 'Retry-After': value } });
        }
        return Response.json({ attempts: attempt });
      }

      if (url.pathname === '/slow') {
        await Bun.sleep(300);
        return new Response('slow-ok');
      }

      if (url.pathname === '/redirect') {
        return new Response(null, { status: 302, headers: { Location: '/echo' } });
      }

      return new Response('ok');
    },
  });
  base = `http://localhost:${server.port}`;
});

afterAll(() => server.stop(true));

describe('url building', () => {
  test('an absolute URL requests as-is with GET by default', async () => {
    const res = await http(`${base}/echo`);
    const data = await res.json();
    expect(data.method).toBe('GET');
    expect(data.path).toBe('/echo');
  });

  test('prefixUrl joins with the input path, slash or no slash', async () => {
    const api = http.create({ prefixUrl: base });
    expect((await (await api.get('echo')).json()).path).toBe('/echo');
    expect((await (await api.get('/echo')).json()).path).toBe('/echo');
  });

  test('a prefixUrl subpath is preserved, not root-relativized', async () => {
    const api = http.create({ prefixUrl: `${base}/api` });
    expect((await (await api.get('/echo')).json()).path).toBe('/api/echo');
  });

  test('a relative path with no prefixUrl rejects with an invalid-URL error', async () => {
    const err = await caught(http.get('/echo'));
    expect(err).toBeInstanceOf(TypeError);
  });

  test('object searchParams stringify values and drop null/undefined', async () => {
    const res = await http.get(`${base}/echo`, {
      searchParams: { a: 1, b: undefined, c: null, d: 'x' },
    });
    expect((await res.json()).search).toBe('?a=1&d=x');
  });

  test('string searchParams overlay the input URL query, set-style', async () => {
    const res = await http.get(`${base}/echo?x=1&a=0`, { searchParams: 'a=1&a=2' });
    expect((await res.json()).search).toBe('?x=1&a=2');
  });

  test('URLSearchParams are applied set-style', async () => {
    const sp = new URLSearchParams();
    sp.set('page', '3');
    const res = await http.get(`${base}/echo`, { searchParams: sp });
    expect((await res.json()).search).toBe('?page=3');
  });
});

describe('methods', () => {
  test('every shortcut sends its method', async () => {
    for (const [shortcut, method] of [
      ['get', 'GET'], ['post', 'POST'], ['put', 'PUT'], ['patch', 'PATCH'], ['del', 'DELETE'],
    ]) {
      const res = await http[shortcut](`${base}/echo`);
      expect((await res.json()).method).toBe(method);
    }
  });

  test('head sends HEAD and yields an empty body', async () => {
    const res = await http.head(`${base}/echo`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    expect(hits.at(-1)).toEqual({ method: 'HEAD', path: '/echo', search: '' });
  });

  test('a lowercase method option is uppercased', async () => {
    const res = await http(`${base}/echo`, { method: 'post' });
    expect((await res.json()).method).toBe('POST');
  });

  test('fetch options pass through (redirect: manual)', async () => {
    const followed = await http.get(`${base}/redirect`);
    expect((await followed.json()).path).toBe('/echo');
    const manual = await http.get(`${base}/redirect`, { redirect: 'manual', throwHttpErrors: false });
    expect(manual.status).toBe(302);
  });
});

describe('json bodies', () => {
  test('json stringifies the body and sets the content-type', async () => {
    const res = await http.post(`${base}/echo`, { json: { name: 'Alice' } });
    const data = await res.json();
    expect(data.body).toBe('{"name":"Alice"}');
    expect(data.headers['content-type']).toBe('application/json');
  });

  test('an explicit content-type is not overridden', async () => {
    const res = await http.post(`${base}/echo`, {
      json: [1, 2],
      headers: { 'content-type': 'application/vnd.custom+json' },
    });
    const data = await res.json();
    expect(data.body).toBe('[1,2]');
    expect(data.headers['content-type']).toBe('application/vnd.custom+json');
  });

  test('json: null sends the literal body "null" with a JSON content-type', async () => {
    const res = await http.post(`${base}/echo`, { json: null });
    const data = await res.json();
    expect(data.body).toBe('null');
    expect(data.headers['content-type']).toBe('application/json');
  });

  test('json: undefined is absent — no body, no content-type', async () => {
    const res = await http.post(`${base}/echo`, { json: undefined });
    const data = await res.json();
    expect(data.body).toBe('');
    expect(data.headers['content-type']).toBeUndefined();
  });

  test('json wins over body when both are given', async () => {
    const res = await http.post(`${base}/echo`, { body: 'raw', json: { a: 1 } });
    expect((await res.json()).body).toBe('{"a":1}');
  });
});

describe('error throwing', () => {
  test('a non-2xx response throws HTTPError carrying response, request, and options', async () => {
    const err = await caught(http.get(`${base}/status/404`));
    expect(err).toBeInstanceOf(HTTPError);
    expect(err.name).toBe('HTTPError');
    expect(err.message).toBe('Request failed with status 404');
    expect(err.response.status).toBe(404);
    expect(await err.response.text()).toBe('status 404');
    expect(err.request).toBeInstanceOf(Request);
    expect(err.request.url).toBe(`${base}/status/404`);
    expect(err.options.method).toBe('GET');
  });

  test('throwHttpErrors: false returns the error response', async () => {
    const res = await http.get(`${base}/status/500`, { retry: 0, throwHttpErrors: false });
    expect(res.status).toBe(500);
  });

  test('a 404 is not a retryable status', async () => {
    await caught(http.get(`${base}/status/404?once`));
    expect(countHits('/status/404', '?once')).toBe(1);
  });

  test('beforeError hooks transform the error; undefined keeps it', async () => {
    const err = await caught(http.get(`${base}/status/404`, {
      hooks: {
        beforeError: [
          (e) => { e.customMessage = `API ${e.response.status}`; return e; },
          () => undefined,
        ],
      },
    }));
    expect(err).toBeInstanceOf(HTTPError);
    expect(err.customMessage).toBe('API 404');
  });
});

describe('retries', () => {
  const fast = { limit: 2, delay: () => 1 };

  test('a retryable status on a GET retries up to the limit, then throws', async () => {
    const err = await caught(http.get(`${base}/flaky?key=exhaust&fails=10`, { retry: fast }));
    expect(err).toBeInstanceOf(HTTPError);
    expect(err.response.status).toBe(500);
    expect(counters.get('exhaust')).toBe(3); // 1 try + 2 retries
  });

  test('a GET that recovers within the limit succeeds', async () => {
    const res = await http.get(`${base}/flaky?key=recover&fails=2`, { retry: fast });
    expect((await res.json()).attempts).toBe(3);
  });

  test('POST is not retried by default', async () => {
    const err = await caught(http.post(`${base}/flaky?key=post&fails=1`, { retry: fast }));
    expect(err).toBeInstanceOf(HTTPError);
    expect(counters.get('post')).toBe(1);
  });

  test('custom retry methods make POST retryable', async () => {
    const res = await http.post(`${base}/flaky?key=postok&fails=1`, {
      retry: { ...fast, methods: ['POST'] },
    });
    expect((await res.json()).attempts).toBe(2);
  });

  test('retry: 0 and retry: false disable retries', async () => {
    for (const [key, retry] of [['zero', 0], ['off', false]]) {
      const err = await caught(http.get(`${base}/flaky?key=${key}&fails=1`, { retry }));
      expect(err).toBeInstanceOf(HTTPError);
      expect(counters.get(key)).toBe(1);
    }
  });

  test('a number retry option is the limit (default backoff applies)', async () => {
    const err = await caught(http.get(`${base}/flaky?key=one&fails=10`, { retry: 1 }));
    expect(err).toBeInstanceOf(HTTPError);
    expect(counters.get('one')).toBe(2);
  });

  test('a custom delay receives the attempt number', async () => {
    const attempts = [];
    await caught(http.get(`${base}/flaky?key=delays&fails=10`, {
      retry: { limit: 2, delay: (n) => { attempts.push(n); return 1; } },
    }));
    expect(attempts).toEqual([1, 2]);
  });

  test('Retry-After in seconds is honored over backoff', async () => {
    const started = Date.now();
    const res = await http.get(`${base}/retry-after?key=secs`);
    expect((await res.json()).attempts).toBe(2);
    expect(Date.now() - started).toBeLessThan(250); // default backoff would wait ~300ms
  });

  test('Retry-After as an HTTP date is honored', async () => {
    const started = Date.now();
    const res = await http.get(`${base}/retry-after?key=date&format=date`);
    expect((await res.json()).attempts).toBe(2);
    expect(Date.now() - started).toBeLessThan(250);
  });

  test('network errors retry then rethrow the original error', async () => {
    const probe = Bun.serve({ port: 0, fetch: () => new Response('x') });
    const closed = probe.port;
    probe.stop(true);

    const seen = [];
    const err = await caught(http.get(`http://127.0.0.1:${closed}/x`, {
      retry: fast,
      hooks: { beforeRetry: [({ error, retryCount }) => { seen.push({ retryCount, hasError: error !== null }); }] },
    }));
    expect(err).not.toBeNull();
    expect(err instanceof HTTPError).toBeFalse();
    expect(err instanceof TimeoutError).toBeFalse();
    expect(seen).toEqual([
      { retryCount: 1, hasError: true },
      { retryCount: 2, hasError: true },
    ]);
  });

  test('beforeRetry for a status retry carries error: null and the request', async () => {
    const seen = [];
    await http.get(`${base}/flaky?key=hook&fails=1`, {
      retry: fast,
      hooks: {
        beforeRetry: [({ request, options, error, retryCount }) => {
          seen.push({ url: request.url, method: options.method, error, retryCount });
        }],
      },
    });
    expect(seen).toEqual([
      { url: `${base}/flaky?key=hook&fails=1`, method: 'GET', error: null, retryCount: 1 },
    ]);
  });
});

describe('timeout and abort', () => {
  test('a timeout throws TimeoutError with the request attached', async () => {
    const err = await caught(http.get(`${base}/slow`, { timeout: 40 }));
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err.name).toBe('TimeoutError');
    expect(err.message).toBe('Request timed out');
    expect(err.request).toBeInstanceOf(Request);
    expect(err.request.url).toBe(`${base}/slow`);
    expect(err instanceof HTTPError).toBeFalse();
  });

  test('timeout: false lets a slow response finish', async () => {
    const res = await http.get(`${base}/slow`, { timeout: false });
    expect(await res.text()).toBe('slow-ok');
  });

  test('a caller abort surfaces as AbortError, not TimeoutError', async () => {
    const ctrl = new AbortController();
    const pending = caught(http.get(`${base}/slow`, { signal: ctrl.signal }));
    setTimeout(() => ctrl.abort(), 20);
    const err = await pending;
    expect(err.name).toBe('AbortError');
    expect(err instanceof TimeoutError).toBeFalse();
  });

  test('a caller abort with timeout disabled still aborts', async () => {
    const ctrl = new AbortController();
    const pending = caught(http.get(`${base}/slow`, { timeout: false, signal: ctrl.signal }));
    setTimeout(() => ctrl.abort(), 20);
    const err = await pending;
    expect(err.name).toBe('AbortError');
  });
});

describe('hooks', () => {
  test('beforeRequest can mutate the request headers', async () => {
    const res = await http.get(`${base}/echo`, {
      hooks: { beforeRequest: [(req) => { req.headers.set('authorization', 'Bearer tok'); }] },
    });
    expect((await res.json()).headers.authorization).toBe('Bearer tok');
  });

  test('beforeRequest can replace the request', async () => {
    const res = await http.get(`${base}/echo`, {
      hooks: { beforeRequest: [(req) => new Request(`${base}/echo?swapped=1`, req)] },
    });
    expect((await res.json()).search).toBe('?swapped=1');
  });

  test('beforeRequest returning a Response short-circuits the fetch', async () => {
    const before = hits.length;
    const res = await http.get(`${base}/echo`, {
      hooks: { beforeRequest: [() => new Response('shortcut', { status: 203 })] },
    });
    expect(res.status).toBe(203);
    expect(await res.text()).toBe('shortcut');
    expect(hits.length).toBe(before);
  });

  test('afterResponse can replace the response, averting throw and retry', async () => {
    const args = [];
    const res = await http.get(`${base}/status/500?fixed`, {
      hooks: {
        afterResponse: [(req, opts, r) => {
          args.push([req.constructor.name, opts.method, r.status]);
          return r.status === 500 ? new Response('fixed') : undefined;
        }],
      },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('fixed');
    expect(args).toEqual([['Request', 'GET', 500]]);
    expect(countHits('/status/500', '?fixed')).toBe(1);
  });
});

describe('instances', () => {
  test('create applies defaults; per-call headers merge and override', async () => {
    const api = http.create({ prefixUrl: base, headers: { 'x-a': '1', 'x-b': '1' } });
    const data = await (await api.get('echo', { headers: { 'x-b': '2', 'x-c': '3' } })).json();
    expect(data.headers['x-a']).toBe('1');
    expect(data.headers['x-b']).toBe('2');
    expect(data.headers['x-c']).toBe('3');
  });

  test('create on an instance starts from scratch', async () => {
    const api = http.create({ headers: { 'x-api-key': 'secret' } });
    const fresh = api.create({});
    const data = await (await fresh.get(`${base}/echo`)).json();
    expect(data.headers['x-api-key']).toBeUndefined();
  });

  test('extend inherits defaults and merges headers', async () => {
    const api = http.create({ prefixUrl: base, headers: { 'x-a': '1' } });
    const admin = api.extend({ headers: { 'x-admin': 'true' } });
    const data = await (await admin.get('echo')).json();
    expect(data.path).toBe('/echo'); // prefixUrl inherited
    expect(data.headers['x-a']).toBe('1');
    expect(data.headers['x-admin']).toBe('true');
  });

  test('extend concatenates hooks, parent first', async () => {
    const order = [];
    const parent = http.create({
      prefixUrl: base,
      hooks: { beforeRequest: [() => { order.push('parent'); }] },
    });
    const child = parent.extend({
      hooks: { beforeRequest: [() => { order.push('child'); }] },
    });
    await child.get('echo');
    expect(order).toEqual(['parent', 'child']);
  });

  test('instances carry the error classes', () => {
    expect(http.HTTPError).toBe(HTTPError);
    expect(http.TimeoutError).toBe(TimeoutError);
    const api = http.create({});
    expect(api.HTTPError).toBe(HTTPError);
    expect(api.TimeoutError).toBe(TimeoutError);
  });
});
