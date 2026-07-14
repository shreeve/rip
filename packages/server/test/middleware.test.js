// Middleware composition: onion ordering, double-next and silent-drop
// protection, before/after filters, error propagation through the
// envelope, aborted requests, request-local ownership — plus the two
// core middleware, cors and logger. No sockets anywhere.
import { describe, expect, test } from 'bun:test';
import { compose, cors, createContext, logger } from '@rip-lang/server';

const request = (path = '/x', opts = {}) => new Request(`http://test.local${path}`, opts);
const ctxOf = (path, opts) => createContext(request(path, opts));

describe('compose', () => {
  test('middlewares run as an onion around filters and handler', async () => {
    const order = [];
    const mark = name => async (c, next) => {
      order.push(`${name}-in`);
      const res = await next();
      order.push(`${name}-out`);
      return res;
    };
    const run = compose({
      use: [mark('a'), mark('b')],
      before: [() => void order.push('before')],
      after: [() => void order.push('after')],
      handler: () => (order.push('handler'), { ok: 1 }),
    });
    const res = await run(ctxOf());
    expect(await res.json()).toEqual({ ok: 1 });
    expect(order).toEqual(['a-in', 'b-in', 'before', 'handler', 'after', 'b-out', 'a-out']);
  });

  test('next() returns the downstream response for inspection', async () => {
    let seen = null;
    const run = compose({
      use: [async (c, next) => { const res = await next(); seen = res.status; return res; }],
      handler: c => c.text('made', 201),
    });
    expect((await run(ctxOf())).status).toBe(201);
    expect(seen).toBe(201);
  });

  test('a middleware returning a Response short-circuits downstream', async () => {
    let reached = false;
    const run = compose({
      use: [c => c.text('halted', 403)],
      handler: () => { reached = true; return 'never'; },
    });
    const res = await run(ctxOf());
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('halted');
    expect(reached).toBe(false);
  });

  test('calling next() twice rejects into a masked 500 envelope', async () => {
    const run = compose({
      use: [async (c, next) => { await next(); return next(); }],
      handler: () => 'ok',
    });
    const res = await run(ctxOf());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { message: 'Internal Server Error' } });
  });

  test('a middleware that neither responds nor calls next is a loud mistake', async () => {
    const run = compose({ use: [() => undefined], handler: () => 'ok' });
    const res = await run(ctxOf());
    expect(res.status).toBe(500);
  });

  test('a before filter can short-circuit the handler; after filters still observe', async () => {
    const order = [];
    const run = compose({
      before: [c => c.text('denied', 401), () => void order.push('second-before')],
      after: [(c, res) => void order.push(`after:${res.status}`)],
      handler: () => { order.push('handler'); return 'never'; },
    });
    const res = await run(ctxOf());
    expect(res.status).toBe(401);
    expect(order).toEqual(['after:401']);
  });

  test('an after filter may replace the response', async () => {
    const run = compose({
      after: [(c, res) => (res.status === 200 ? c.text('replaced', 418) : null)],
      handler: () => 'original',
    });
    const res = await run(ctxOf());
    expect(res.status).toBe(418);
    expect(await res.text()).toBe('replaced');
  });

  test('throws anywhere translate through the envelope', async () => {
    const boom = () => { throw Object.assign(new Error('gate'), { status: 403 }); };
    for (const stack of [
      { use: [boom], handler: () => 'x' },
      { before: [boom], handler: () => 'x' },
      { handler: boom },
      { after: [boom], handler: () => 'x' },
    ]) {
      const res = await compose(stack)(ctxOf());
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: { message: 'gate' } });
    }
  });

  test('an aborted request stops the pipeline with 499 and skips the handler', async () => {
    const controller = new AbortController();
    controller.abort();
    let reached = false;
    const run = compose({ handler: () => { reached = true; return 'never'; } });
    const ctx = createContext(request('/x', { signal: controller.signal }));
    const res = await run(ctx);
    expect(res.status).toBe(499);
    expect(reached).toBe(false);
  });

  test('an abort between stages stops before the handler', async () => {
    const controller = new AbortController();
    let reached = false;
    const run = compose({
      use: [async (c, next) => { controller.abort(); return next(); }],
      handler: () => { reached = true; return 'never'; },
    });
    const res = await run(createContext(request('/x', { signal: controller.signal })));
    expect(res.status).toBe(499);
    expect(reached).toBe(false);
  });

  test('locals are request-scoped and cross the whole pipeline', async () => {
    const run = compose({
      use: [(c, next) => { c.locals.user = 'ada'; return next(); }],
      handler: c => ({ user: c.locals.user }),
    });
    const first = await run(ctxOf());
    expect(await first.json()).toEqual({ user: 'ada' });
    const bare = compose({ handler: c => ({ empty: Object.keys(c.locals).length === 0 }) });
    expect(await (await bare(ctxOf())).json()).toEqual({ empty: true });
  });

  test('a stack requires a handler and function stages, loudly at build time', () => {
    expect(() => compose({})).toThrow(/handler/);
    expect(() => compose({ use: 'oops', handler: () => 'x' })).toThrow(/use must be an array of functions/);
    expect(() => compose({ before: [null], handler: () => 'x' })).toThrow(/before must be an array of functions/);
  });

  test('a fire-and-forget next() still resolves to the real response', async () => {
    const run = compose({
      use: [(c, next) => { next(); }],
      handler: c => c.text('made it', 201),
    });
    const res = await run(ctxOf());
    expect(res.status).toBe(201);
    expect(await res.text()).toBe('made it');
  });

  test('a next() held past the response rejects loudly when called', async () => {
    let stale = null;
    const run = compose({
      use: [(c, next) => { stale = next; return c.text('answered', 200); }],
      handler: () => 'never',
    });
    expect((await run(ctxOf())).status).toBe(200);
    expect(() => stale()).toThrow(/after the pipeline settled/);
  });
});

describe('cors', () => {
  const run = (opts, reqOpts = {}, handler = c => c.text('ok')) =>
    compose({ use: [cors(opts)], handler })(ctxOf('/x', reqOpts));

  test('no Origin header means no CORS headers', async () => {
    const res = await run({}, {});
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(await res.text()).toBe('ok');
  });

  test('the default policy reflects any origin as *', async () => {
    const res = await run({}, { headers: { Origin: 'https://app.example' } });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  test('string, array, and predicate origins allow and deny', async () => {
    const allowed = await run({ origin: ['https://a.example', 'https://b.example'] },
      { headers: { Origin: 'https://b.example' } });
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://b.example');
    const denied = await run({ origin: ['https://a.example'] },
      { headers: { Origin: 'https://evil.example' } });
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const byRule = await run({ origin: origin => origin.endsWith('.trusted.example') },
      { headers: { Origin: 'https://app.trusted.example' } });
    expect(byRule.headers.get('Access-Control-Allow-Origin')).toBe('https://app.trusted.example');
  });

  test('credentials never ride a wildcard origin', async () => {
    const wild = await run({ credentials: true }, { headers: { Origin: 'https://a.example' } });
    expect(wild.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    const scoped = await run({ origin: 'https://a.example', credentials: true },
      { headers: { Origin: 'https://a.example' } });
    expect(scoped.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  test('a preflight OPTIONS answers 204 without reaching the handler', async () => {
    let reached = false;
    const res = await run({},
      { method: 'OPTIONS', headers: { Origin: 'https://a.example', 'Access-Control-Request-Method': 'PUT' } },
      () => { reached = true; return 'never'; });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(reached).toBe(false);
  });

  test('an ordinary OPTIONS request reaches its handler', async () => {
    const res = await run({}, { method: 'OPTIONS', headers: { Origin: 'https://a.example' } },
      c => c.text('options body'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('options body');
  });

  test('a scoped policy varies by Origin on allow and deny alike', async () => {
    const allowed = await run({ origin: ['https://a.example'] }, { headers: { Origin: 'https://a.example' } });
    expect(allowed.headers.get('Vary')).toBe('Origin');
    const denied = await run({ origin: ['https://a.example'] }, { headers: { Origin: 'https://evil.example' } });
    expect(denied.headers.get('Vary')).toBe('Origin');
    const wildcard = await run({}, { headers: { Origin: 'https://a.example' } });
    expect(wildcard.headers.get('Vary')).toBeNull();
  });

  test("credentials never ride the literal 'null' origin", async () => {
    const res = await run({ origin: o => true, credentials: true }, { headers: { Origin: 'null' } });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('null');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  test('exposeHeaders and array options normalize to header lists', async () => {
    const res = await run({ exposeHeaders: ['X-Total', 'X-Page'], methods: ['GET', 'POST'] },
      { headers: { Origin: 'https://a.example' } });
    expect(res.headers.get('Access-Control-Expose-Headers')).toBe('X-Total,X-Page');
  });
});

describe('logger', () => {
  test('logs method, path, status, and duration to the injected stream', async () => {
    const lines = [];
    const run = compose({
      use: [logger({ format: 'tiny', stream: { write: line => lines.push(line) } })],
      handler: c => c.text('ok', 201),
    });
    await run(ctxOf('/logged'));
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/^GET \/logged 201 - \d+ms\n$/);
  });

  test('a custom format function and skip predicate apply', async () => {
    const lines = [];
    const stream = { write: line => lines.push(line) };
    const run = compose({
      use: [logger({ format: info => `${info.status}!`, stream, skip: c => c.req.path === '/quiet' })],
      handler: () => 'ok',
    });
    await run(ctxOf('/loud'));
    await run(ctxOf('/quiet'));
    expect(lines).toEqual(['200!\n']);
  });

  test('a broken sink or format loses the line, never the response', async () => {
    const run = compose({
      use: [logger({ stream: { write: () => { throw new Error('sink down'); } } })],
      handler: c => c.text('kept', 201),
    });
    const res = await run(ctxOf());
    expect(res.status).toBe(201);
    expect(await res.text()).toBe('kept');
    const broken = compose({
      use: [logger({ format: () => { throw new Error('fmt'); }, stream: { write: () => {} }, skip: () => { throw new Error('skip'); } })],
      handler: c => c.text('kept', 200),
    });
    expect((await broken(ctxOf())).status).toBe(200);
  });

  test('the envelope status is what gets logged', async () => {
    const lines = [];
    const run = compose({
      use: [logger({ format: 'tiny', stream: { write: line => lines.push(line) } })],
      handler: () => { throw Object.assign(new Error('x'), { status: 404 }); },
    });
    await run(ctxOf('/missing'));
    expect(lines[0]).toContain(' 404 ');
  });
});
