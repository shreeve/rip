// Request context and response helpers: request-scoped reading
// (params, query, headers, body), JSON/text/HTML/redirect/file
// responses, and the deterministic error envelope. Everything drives
// through web-standard Request/Response — no sockets.
import { describe, expect, test } from 'bun:test';
import { createContext, errorEnvelope, respond } from '@rip-lang/server';

const request = (path = '/x', opts = {}) => new Request(`http://test.local${path}`, opts);
const ctxOf = (path, opts, extra) => createContext(request(path, opts), extra);

describe('request reading', () => {
  test('method, url, and path reflect the request', () => {
    const c = ctxOf('/users/42?x=1', { method: 'POST' });
    expect(c.req.method).toBe('POST');
    expect(c.req.path).toBe('/users/42');
    expect(c.req.url).toBe('http://test.local/users/42?x=1');
    expect(c.req.raw).toBeInstanceOf(Request);
  });

  test('param reads one key or snapshots all params', () => {
    const c = ctxOf('/users/42', {}, { params: { id: '42' } });
    expect(c.req.param('id')).toBe('42');
    expect(c.req.param('nope')).toBeUndefined();
    expect(c.req.param()).toEqual({ id: '42' });
    c.req.param().id = 'mutated';
    expect(c.req.param('id')).toBe('42');
  });

  test('query reads one key or all keys, duplicates keep the last value', () => {
    const c = ctxOf('/x?a=1&b=two%20words&a=3');
    expect(c.req.query('a')).toBe('3');
    expect(c.req.query('b')).toBe('two words');
    expect(c.req.query('nope')).toBeUndefined();
    expect(c.req.query()).toEqual({ a: '3', b: 'two words' });
  });

  test('header reads are case-insensitive, one key or all', () => {
    const c = ctxOf('/x', { headers: { 'X-Token': 'abc', Accept: 'text/plain' } });
    expect(c.req.header('x-token')).toBe('abc');
    expect(c.req.header('ACCEPT')).toBe('text/plain');
    expect(c.req.header('nope')).toBeUndefined();
    expect(c.req.header()['x-token']).toBe('abc');
  });

  test('json, text, and formData read the body through the request', async () => {
    const asJson = ctxOf('/x', { method: 'POST', body: '{"a":1}', headers: { 'Content-Type': 'application/json' } });
    expect(await asJson.req.json()).toEqual({ a: 1 });
    const asText = ctxOf('/x', { method: 'POST', body: 'plain' });
    expect(await asText.req.text()).toBe('plain');
    const form = new FormData();
    form.set('name', 'Ada');
    const asForm = ctxOf('/x', { method: 'POST', body: form });
    expect((await asForm.req.formData()).get('name')).toBe('Ada');
  });

  test('parseBody dispatches on content type and never throws on junk', async () => {
    const asJson = ctxOf('/x', { method: 'POST', body: '{"a":1}', headers: { 'Content-Type': 'application/json' } });
    expect(await asJson.req.parseBody()).toEqual({ a: 1 });
    const form = new FormData();
    form.set('name', 'Ada');
    const asForm = ctxOf('/x', { method: 'POST', body: form });
    expect(await asForm.req.parseBody()).toEqual({ name: 'Ada' });
    const asNothing = ctxOf('/x', { method: 'POST', body: 'who knows' });
    expect(await asNothing.req.parseBody()).toEqual({});
    const asBadJson = ctxOf('/x', { method: 'POST', body: '{nope', headers: { 'Content-Type': 'application/json' } });
    expect(await asBadJson.req.parseBody()).toBeNull();
    const asFakeForm = ctxOf('/x', { method: 'POST', body: 'junk', headers: { 'Content-Type': 'application/x-chloroform' } });
    expect(await asFakeForm.req.parseBody()).toBeNull();
  });

  test('param never answers from the prototype', () => {
    const c = ctxOf('/x', {}, { params: { id: '1' } });
    expect(c.req.param('constructor')).toBeUndefined();
    expect(c.req.param('hasOwnProperty')).toBeUndefined();
  });

  test('a request with an unparseable url rejects by name', () => {
    expect(() => createContext({ url: 'not-a-url', headers: new Headers() }))
      .toThrow(/Rip Server: .*valid absolute URL/);
  });
});

describe('response helpers', () => {
  test('json stringifies with its content type and status', async () => {
    const c = ctxOf();
    const res = c.json({ ok: 1 });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(await res.json()).toEqual({ ok: 1 });
    expect(c.json({}, 201).status).toBe(201);
  });

  test('text and html carry their content types', () => {
    const c = ctxOf();
    expect(c.text('hi').headers.get('Content-Type')).toContain('text/plain');
    expect(c.html('<p>hi</p>').headers.get('Content-Type')).toContain('text/html');
    expect(c.text('hi', 404).status).toBe(404);
  });

  test('redirect sets Location and defaults to 302', () => {
    const c = ctxOf();
    const res = c.redirect('/there');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/there');
    expect(c.redirect('/gone', 301).status).toBe(301);
  });

  test('header() stages response headers for every later response', () => {
    const c = ctxOf();
    c.header('X-Request-Id', 'r1');
    expect(c.header('X-Request-Id')).toBe('r1');
    c.header('Vary', 'Accept');
    c.header('Vary', 'Origin', { append: true });
    const res = c.text('ok');
    expect(res.headers.get('X-Request-Id')).toBe('r1');
    expect(res.headers.get('Vary')).toBe('Accept, Origin');
  });

  test('per-call headers override staged ones', () => {
    const c = ctxOf();
    c.header('X-Kind', 'staged');
    const res = c.json({}, 200, { 'X-Kind': 'inline' });
    expect(res.headers.get('X-Kind')).toBe('inline');
  });

  test('cache stages Cache-Control from seconds or a duration phrase', () => {
    const c = ctxOf();
    c.cache(60);
    expect(c.text('ok').headers.get('Cache-Control')).toBe('public, max-age=60, immutable');
    const d = ctxOf();
    d.cache('2 hours');
    expect(d.text('ok').headers.get('Cache-Control')).toBe('public, max-age=7200, immutable');
    const e = ctxOf();
    expect(() => e.cache('sideways')).toThrow(/cache duration/);
    expect(() => e.cache(NaN)).toThrow(/cache duration/);
    expect(() => e.cache(1e21)).toThrow(/cache duration/);
    const f = ctxOf();
    f.cache(1.5);
    expect(f.text('ok').headers.get('Cache-Control')).toBe('public, max-age=1, immutable');
  });

  test('send serves a file through the injected host with ETag revalidation', async () => {
    const files = path => ({
      body: `content of ${path}`,
      size: 20,
      lastModified: 1234,
      type: 'text/plain',
      exists: true,
    });
    const c = createContext(request('/f'), { files });
    const res = c.send('/data/report.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBe('W/"1234-20"');
    expect(res.headers.get('Content-Type')).toBe('text/plain');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(await res.text()).toBe('content of /data/report.txt');
    expect(c.send('/x', 'image/png').headers.get('Content-Type')).toBe('image/png');
    const bare = createContext(request('/f'), { files: () => ({ body: 'x', size: 1, lastModified: 1, exists: true }) });
    expect(bare.send('/x').headers.get('Content-Type')).toBe('application/octet-stream');

    const revalidated = createContext(request('/f', { headers: { 'If-None-Match': 'W/"1234-20"' } }), { files });
    revalidated.cache(60);
    revalidated.header('X-Request-Id', 'r1');
    const notModified = revalidated.send('/data/report.txt');
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get('ETag')).toBe('W/"1234-20"');
    expect(notModified.headers.get('Cache-Control')).toBe('public, max-age=60, immutable');
    expect(notModified.headers.get('X-Request-Id')).toBe('r1');
  });

  test('a host without freshness numbers serves without a validator', () => {
    const files = () => ({ body: 'x', type: 'text/plain', exists: true });
    const c = createContext(request('/f', { headers: { 'If-None-Match': 'W/"undefined-undefined"' } }), { files });
    const res = c.send('/anything');
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBeNull();
  });

  test('an asynchronous file host rejects loudly', () => {
    const c = createContext(request('/f'), { files: async () => ({ exists: true }) });
    expect(() => c.send('/x')).toThrow(/synchronous file host/);
  });

  test('redirects and error envelopes carry staged headers', async () => {
    const c = ctxOf();
    c.header('X-Request-Id', 'r7');
    expect(c.redirect('/there').headers.get('X-Request-Id')).toBe('r7');
    const res = await respond(() => { throw Object.assign(new Error('no'), { status: 403 }); }, c);
    expect(res.headers.get('X-Request-Id')).toBe('r7');
  });

  test('send rejects a missing file with 404, never leaking the path outward', () => {
    const files = () => ({ exists: false });
    const c = createContext(request('/f'), { files });
    const res = c.send('/data/missing.txt');
    expect(res.status).toBe(404);
  });

  test('send without a file host rejects loudly — there is no default', () => {
    expect(() => createContext(request('/f'), { files: null }).send('/data/x')).toThrow(/file host/);
    expect(() => createContext(request('/f')).send('/data/x')).toThrow(/file host/);
  });
});

describe('errorEnvelope', () => {
  test('a 4xx error shows its message; 5xx and raw throws mask to status text', () => {
    const teapot = Object.assign(new Error('short and stout'), { status: 418 });
    expect(errorEnvelope(teapot)).toEqual({ status: 418, error: { message: 'short and stout' } });
    const boom = Object.assign(new Error('secret internals'), { status: 500 });
    expect(errorEnvelope(boom)).toEqual({ status: 500, error: { message: 'Internal Server Error' } });
    expect(errorEnvelope(new Error('also secret'))).toEqual({ status: 500, error: { message: 'Internal Server Error' } });
    expect(errorEnvelope('string throw')).toEqual({ status: 500, error: { message: 'Internal Server Error' } });
  });

  test('notice and issues are user-facing at any status', () => {
    const notice = Object.assign(new Error('x'), { notice: 'Try again shortly', status: 503 });
    expect(errorEnvelope(notice)).toEqual({ status: 503, error: { notice: 'Try again shortly' } });
    const invalid = Object.assign(new Error('Validation failed'), { status: 400, issues: [{ field: 'a' }] });
    expect(errorEnvelope(invalid)).toEqual({ status: 400, error: { message: 'Validation failed', issues: [{ field: 'a' }] } });
  });

  test('a status outside 400-599 masks to 500', () => {
    expect(errorEnvelope(Object.assign(new Error('x'), { status: 302 })).status).toBe(500);
    expect(errorEnvelope(Object.assign(new Error('x'), { status: 999 })).status).toBe(500);
    expect(errorEnvelope(Object.assign(new Error('x'), { status: '404' })).status).toBe(500);
  });
});

describe('respond', () => {
  const run = async (handler, path = '/x', opts = {}) => respond(handler, ctxOf(path, opts));

  test('a Response passes through untouched', async () => {
    const direct = new Response('raw', { status: 201 });
    expect(await run(() => direct)).toBe(direct);
  });

  test('an object becomes JSON, a string becomes text or html by shape', async () => {
    const asJson = await run(() => ({ ok: 1 }));
    expect(asJson.headers.get('Content-Type')).toContain('application/json');
    expect(await asJson.json()).toEqual({ ok: 1 });
    const asText = await run(() => 'plain words');
    expect(asText.headers.get('Content-Type')).toContain('text/plain');
    const asHtml = await run(() => '  <div>hi</div>');
    expect(asHtml.headers.get('Content-Type')).toContain('text/html');
  });

  test('numbers and booleans become text; null and undefined become 204', async () => {
    expect(await (await run(() => 42)).text()).toBe('42');
    expect(await (await run(() => false)).text()).toBe('false');
    expect((await run(() => null)).status).toBe(204);
    expect((await run(() => undefined)).status).toBe(204);
  });

  test('an async handler resolves before translation', async () => {
    const res = await run(async () => ({ later: true }));
    expect(await res.json()).toEqual({ later: true });
  });

  test('a thrown error becomes its envelope as JSON', async () => {
    const res = await run(() => { throw Object.assign(new Error('nope'), { status: 403 }); });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { message: 'nope' } });
    const masked = await run(() => { throw new Error('internal detail'); });
    expect(masked.status).toBe(500);
    expect(await masked.json()).toEqual({ error: { message: 'Internal Server Error' } });
  });

  test('an error hostile to its own envelope still becomes a bare 500', async () => {
    const bomb = { get status() { throw new Error('getter bomb'); } };
    const fromGetter = await run(() => { throw bomb; });
    expect(fromGetter.status).toBe(500);
    expect(await fromGetter.json()).toEqual({ error: { message: 'Internal Server Error' } });

    const issues = [];
    issues.push(issues);
    const fromCycle = await run(() => { throw Object.assign(new Error('x'), { status: 400, issues }); });
    expect(fromCycle.status).toBe(500);
    expect(await fromCycle.json()).toEqual({ error: { message: 'Internal Server Error' } });
  });

  test('the handler receives the context as this and first argument', async () => {
    const res = await run(function (c) {
      expect(this).toBe(c);
      return c.text(c.req.path);
    }, '/here');
    expect(await res.text()).toBe('/here');
  });
});
