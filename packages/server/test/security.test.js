// Sessions, CSRF, secure headers, proxy trust, and request hardening —
// the security boundary. Everything drives through Request/Response;
// crypto is WebCrypto, available everywhere the server runs.
import { describe, expect, test } from 'bun:test';
import { compose, createContext, csrf, harden, secureHeaders, sessions, trustProxy } from '@rip-lang/server';

const request = (path = '/x', opts = {}) => new Request(`http://test.local${path}`, opts);
const ctxOf = (req) => createContext(req);
const SECRET = 'a-test-secret-of-reasonable-length';

const cookieOf = (res, name) => {
  const all = res.headers.getSetCookie?.() ?? [];
  const hit = all.find(line => line.startsWith(`${name}=`));
  return hit ?? null;
};
const cookieValue = line => decodeURIComponent(line.split(';')[0].split('=').slice(1).join('='));

describe('sessions', () => {
  const app = (handler, opts = {}) =>
    compose({ use: [sessions({ secret: SECRET, ...opts })], handler });

  test('a secret is required, strong, and unforgeable to skip', () => {
    expect(() => sessions()).toThrow(/requires a secret/);
    expect(() => sessions({ insecure: true })).not.toThrow();
    expect(() => sessions({ encrypt: true, insecure: true })).toThrow(/requires a secret/);
    expect(() => sessions({ secret: '' })).toThrow(/at least 32/);
    expect(() => sessions({ secret: '   ' })).toThrow(/at least 32/);
    expect(() => sessions({ secret: 'too-short' })).toThrow(/at least 32/);
  });

  test('SameSite=None without a Secure cookie is a loud mistake', () => {
    expect(() => sessions({ secret: SECRET, sameSite: 'None', secure: false })).toThrow(/SameSite=None requires a Secure/);
    expect(() => sessions({ secret: SECRET, sameSite: 'None' })).not.toThrow();
  });

  test('a changed session sets the cookie with the settled attributes, Secure by default', async () => {
    const res = await app(c => { c.session.user = 'ada'; return 'ok'; })(ctxOf(request()));
    const line = cookieOf(res, 'session');
    expect(line).toContain('HttpOnly');
    expect(line).toContain('Secure');
    expect(line).toContain('SameSite=Lax');
    expect(line).toContain('Path=/');
    expect(line).toContain('Max-Age=86400');
    const plain = await app(c => { c.session.user = 'ada'; return 'ok'; }, { secure: false })(ctxOf(request()));
    expect(cookieOf(plain, 'session')).not.toContain('Secure');
  });

  test('a 5xx response commits no session change; a 4xx still does', async () => {
    const failed = await app(c => { c.session.user = 'ada'; throw Object.assign(new Error('x'), { status: 500 }); })(ctxOf(request()));
    expect(failed.status).toBe(500);
    expect(cookieOf(failed, 'session')).toBeNull();
    const rejected = await app(c => { c.session.attempts = 1; return c.json({ error: 'bad' }, 400); })(ctxOf(request()));
    expect(rejected.status).toBe(400);
    expect(cookieOf(rejected, 'session')).not.toBeNull();
  });

  test('an untouched session sets no cookie', async () => {
    const res = await app(() => 'ok')(ctxOf(request()));
    expect(cookieOf(res, 'session')).toBeNull();
  });

  test('a signed session round-trips and survives the wire', async () => {
    const first = await app(c => { c.session.n = 41; return 'ok'; })(ctxOf(request()));
    const cookie = cookieValue(cookieOf(first, 'session'));
    const second = await app(c => { c.session.n += 1; return c.json({ n: c.session.n }); })(
      ctxOf(request('/x', { headers: { Cookie: `session=${encodeURIComponent(cookie)}` } })));
    expect(await second.json()).toEqual({ n: 42 });
  });

  test('a tampered signed cookie is a fresh empty session, never a throw', async () => {
    const first = await app(c => { c.session.role = 'admin'; return 'ok'; })(ctxOf(request()));
    const cookie = cookieValue(cookieOf(first, 'session'));
    const [payload, sig] = cookie.split('--');
    const forged = `${btoa(unescape(encodeURIComponent(JSON.stringify({ role: 'root' }))))}--${sig}`;
    const res = await app(c => c.json({ role: c.session.role ?? null }))(
      ctxOf(request('/x', { headers: { Cookie: `session=${encodeURIComponent(forged)}` } })));
    expect(await res.json()).toEqual({ role: null });
    expect(payload).not.toBe(forged.split('--')[0]);
  });

  test('an encrypted session is opaque and round-trips', async () => {
    const enc = { encrypt: true };
    const first = await app(c => { c.session.token = 'top-secret'; return 'ok'; }, enc)(ctxOf(request()));
    const cookie = cookieValue(cookieOf(first, 'session'));
    expect(cookie.startsWith('v1.')).toBe(true);
    expect(cookie).not.toContain('top-secret');
    const second = await app(c => c.json({ token: c.session.token }), enc)(
      ctxOf(request('/x', { headers: { Cookie: `session=${encodeURIComponent(cookie)}` } })));
    expect(await second.json()).toEqual({ token: 'top-secret' });
  });

  test('an emptied session expires the cookie', async () => {
    const first = await app(c => { c.session.user = 'ada'; return 'ok'; })(ctxOf(request()));
    const cookie = cookieValue(cookieOf(first, 'session'));
    const res = await app(c => { delete c.session.user; return 'ok'; })(
      ctxOf(request('/x', { headers: { Cookie: `session=${encodeURIComponent(cookie)}` } })));
    expect(cookieOf(res, 'session')).toContain('Max-Age=0');
  });

  test('sessions from one secret never open under another', async () => {
    const first = await app(c => { c.session.user = 'ada'; return 'ok'; })(ctxOf(request()));
    const cookie = cookieValue(cookieOf(first, 'session'));
    const other = compose({
      use: [sessions({ secret: 'a-completely-different-secret-of-length' })],
      handler: c => c.json({ user: c.session.user ?? null }),
    });
    const res = await other(ctxOf(request('/x', { headers: { Cookie: `session=${encodeURIComponent(cookie)}` } })));
    expect(await res.json()).toEqual({ user: null });
  });
});

describe('csrf', () => {
  const app = (handler, opts = {}) =>
    compose({ use: [csrf({ secret: SECRET, ...opts })], handler });

  test('csrf holds a secret to the sessions standard', () => {
    expect(() => csrf()).toThrow(/requires a secret/);
    expect(() => csrf({ secret: 'short' })).toThrow(/at least 32/);
    expect(() => csrf({ insecure: true })).not.toThrow();
  });

  test('a safe request mints a readable csrf_token cookie', async () => {
    const res = await app(c => c.json({ token: c.csrfToken }))(ctxOf(request()));
    const line = cookieOf(res, 'csrf_token');
    expect(line).not.toBeNull();
    expect(line).not.toContain('HttpOnly');
    expect(line).toContain('SameSite=Lax');
    const { token } = await res.json();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  test('an unsafe request without the header is a 403 envelope', async () => {
    const first = await app(c => c.json({ token: c.csrfToken }))(ctxOf(request()));
    const cookie = cookieValue(cookieOf(first, 'csrf_token'));
    const res = await app(() => 'never')(
      ctxOf(request('/x', { method: 'POST', headers: { Cookie: `csrf_token=${encodeURIComponent(cookie)}` } })));
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toContain('CSRF');
  });

  test('the header token must match the cookie — there is no form fallback', async () => {
    const first = await app(c => c.json({ token: c.csrfToken }))(ctxOf(request()));
    const cookie = cookieValue(cookieOf(first, 'csrf_token'));
    const token = (await first.json()).token;
    const good = await app(() => 'ok')(ctxOf(request('/x', {
      method: 'POST',
      headers: { Cookie: `csrf_token=${encodeURIComponent(cookie)}`, 'X-CSRF-Token': token },
    })));
    expect(good.status).toBe(200);
    const bad = await app(() => 'never')(ctxOf(request('/x', {
      method: 'POST',
      body: `_csrf=${token}`,
      headers: { Cookie: `csrf_token=${encodeURIComponent(cookie)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    })));
    expect(bad.status).toBe(403);
  });

  test('a forged cookie without the HMAC binding fails even with a matching header', async () => {
    const forgedToken = 'ab'.repeat(16);
    const res = await app(() => 'never')(ctxOf(request('/x', {
      method: 'POST',
      headers: { Cookie: `csrf_token=${forgedToken}`, 'X-CSRF-Token': forgedToken },
    })));
    expect(res.status).toBe(403);
  });

  test('exempt requests skip the check', async () => {
    const res = await app(() => 'ok', { exempt: c => c.req.path === '/webhook' })(
      ctxOf(request('/webhook', { method: 'POST' })));
    expect(res.status).toBe(200);
  });
});

describe('secureHeaders', () => {
  test('the modern header set lands on every response', async () => {
    const res = await compose({ use: [secureHeaders()], handler: () => 'ok' })(ctxOf(request()));
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('X-XSS-Protection')).toBe('0');
    expect(res.headers.get('Strict-Transport-Security')).toBeNull();
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
  });

  test('CSP and HSTS are explicit opt-ins; options override defaults', async () => {
    const res = await compose({
      use: [secureHeaders({ contentSecurityPolicy: "default-src 'self'", hsts: true, frameOptions: 'SAMEORIGIN' })],
      handler: () => 'ok',
    })(ctxOf(request()));
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
    expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
  });

  test('the headers ride error envelopes too', async () => {
    const res = await compose({
      use: [secureHeaders()],
      handler: () => { throw Object.assign(new Error('no'), { status: 403 }); },
    })(ctxOf(request()));
    expect(res.status).toBe(403);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

describe('trustProxy', () => {
  const client = handler => compose({ use: [trustProxy({ trust: true })], handler });

  test('trust is off by default — forwarded headers are ignored', async () => {
    const res = await compose({ use: [trustProxy()], handler: c => c.json(c.locals.client) })(
      ctxOf(request('/x', { headers: { 'X-Forwarded-For': '1.2.3.4', 'X-Forwarded-Proto': 'https' } })));
    expect(await res.json()).toEqual({ ip: null, proto: 'http', host: 'test.local' });
  });

  test('with explicit trust, the nearest forwarded hop wins', async () => {
    const res = await client(c => c.json(c.locals.client))(
      ctxOf(request('/x', { headers: { 'X-Forwarded-For': '9.9.9.9, 10.0.0.1', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'app.example' } })));
    expect(await res.json()).toEqual({ ip: '10.0.0.1', proto: 'https', host: 'app.example' });
  });

  test('a hops count implies trust and climbs only as far as configured', async () => {
    const res = await compose({ use: [trustProxy({ hops: 2 })], handler: c => c.json(c.locals.client) })(
      ctxOf(request('/x', { headers: { 'X-Forwarded-For': '9.9.9.9, 10.0.0.1, 10.0.0.2' } })));
    expect((await res.json()).ip).toBe('10.0.0.1');
  });

  test('a forwarded host that is not a bare hostname is refused', async () => {
    const res = await client(c => c.json(c.locals.client))(
      ctxOf(request('/x', { headers: { 'X-Forwarded-Host': 'good.example@evil.example' } })));
    expect((await res.json()).host).toBe('test.local');
    const ported = await client(c => c.json(c.locals.client))(
      ctxOf(request('/x', { headers: { 'X-Forwarded-Host': 'app.example:8443' } })));
    expect((await ported.json()).host).toBe('app.example:8443');
  });

  test('garbage forwarded values degrade to null, never a throw', async () => {
    const res = await client(c => c.json(c.locals.client))(
      ctxOf(request('/x', { headers: { 'X-Forwarded-For': ' ,, ', 'X-Forwarded-Proto': 'javascript' } })));
    const seen = await res.json();
    expect(seen.ip).toBeNull();
    expect(seen.proto).toBe('http');
  });

  test('the middleware is total off-pipeline — it self-inits locals', async () => {
    const mw = trustProxy();
    const ctx = ctxOf(request('/x'));
    await mw(ctx, async () => new Response('ok'));
    expect(ctx.locals.client.host).toBe('test.local');
  });
});

describe('harden', () => {
  test('oversized URLs and unknown methods reject on already-parsed values', async () => {
    const run = compose({ use: [harden({ maxUrl: 64 })], handler: () => 'ok' });
    expect((await run(ctxOf(request('/' + 'a'.repeat(200))))).status).toBe(414);
    const trace = await run(ctxOf(request('/x', { method: 'TRACE' })));
    expect(trace.status).toBe(405);
    expect((await run(ctxOf(request('/fine')))).status).toBe(200);
  });

  test('the defaults pass ordinary requests untouched', async () => {
    const run = compose({ use: [harden()], handler: () => 'ok' });
    expect((await run(ctxOf(request('/api/users?page=2', { method: 'POST' })))).status).toBe(200);
  });
});
