// The v3 behavior contract, converted from packages/gate/test.rip and run
// through the v4 pipeline (compose + createContext): guard modes, the
// login/logout flows, CSRF double-submit, the custom verify hook, config
// fail-closed validation, and the file-backed session store.
import { afterAll, describe, expect, test } from 'bun:test';
import { readdirSync, statSync, unlinkSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { gate } from '@rip-lang/gate';
import {
  ALICE_HASH, SECRET, absorb, cookieHeader, csrfOf, freshDir, login, setup, sweepDirs,
} from './harness.js';

afterAll(sweepDirs);

describe("protect: 'all' (default, middleware mode)", () => {
  test('browser GET /private with no session is redirected to login', async () => {
    const app = setup();
    const res = await app('/private', { headers: { Accept: 'text/html' } });
    expect(res.status).toBe(302);
    const loc = res.headers.get('location');
    expect(loc.startsWith('/_gate/login?return_to=')).toBeTrue();
    expect(loc).toInclude(encodeURIComponent('/private'));
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('API GET /private with no session returns 401', async () => {
    const app = setup();
    const res = await app('/private', { headers: { Accept: 'application/json' } });
    expect(res.status).toBe(401);
  });

  test('unsafe methods are guarded too: anonymous POST is 401, never a redirect', async () => {
    const app = setup();
    const res = await app('/private', { method: 'POST', headers: { Accept: 'text/html' } });
    expect(res.status).toBe(401);
  });

  test('an unknown /_gate/* path falls through to the app (v3: fell to the router)', async () => {
    const app = setup();
    const res = await app('/_gate/nope');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('top secret');
  });
});

describe('login flow', () => {
  test('GET /_gate/login renders the form and sets a csrf cookie', async () => {
    const app = setup();
    const res = await app('/_gate/login');
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith('rip_gate_csrf='))).toBeTrue();
    expect(cookies.find((c) => c.startsWith('rip_gate_csrf='))).toInclude('Max-Age=600');
    const body = await res.text();
    expect(body).toInclude('<form');
    expect(body).toInclude('name="_csrf"');
  });

  test('POST /_gate/login with no csrf cookie/field is rejected', async () => {
    const app = setup();
    const res = await app('/_gate/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'user=alice&password=hunter2',
    });
    expect(res.status).toBe(403);
  });

  test('POST /_gate/login with form csrf but no cookie is rejected', async () => {
    const app = setup();
    const page = await app('/_gate/login');
    const csrf = csrfOf(await page.text());
    // Send the form token but omit the cookie — double-submit must fail.
    const res = await app('/_gate/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `user=alice&password=hunter2&_csrf=${csrf}`,
    });
    expect(res.status).toBe(403);
  });

  test('full happy path: login then private succeeds, /check sees the user', async () => {
    const app = setup();
    const { jar, res } = await login(app, 'alice', 'hunter2', '&return_to=%2Fprivate');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/private');

    const show = await app('/private', { headers: { Cookie: cookieHeader(jar), Accept: 'text/html' } });
    expect(show.status).toBe(200);
    expect(await show.text()).toInclude('top secret');

    const chk = await app('/_gate/check', { headers: { Cookie: cookieHeader(jar) } });
    expect(chk.status).toBe(204);
    expect(chk.headers.get('remote-user')).toBe('alice');
  });

  test('wrong password re-renders login with 401, no session', async () => {
    const app = setup();
    const { jar, res } = await login(app, 'alice', 'WRONG');
    expect(res.status).toBe(401);
    expect(await res.text()).toInclude('Invalid credentials');
    expect(jar.rip_gate).toBeUndefined();
  });

  test('over-long credentials are rejected before Argon2id runs', async () => {
    const app = setup();
    const { res: longUser } = await login(app, 'u'.repeat(257), 'hunter2');
    expect(longUser.status).toBe(400);
    const { res: longPass } = await login(app, 'alice', 'p'.repeat(1025));
    expect(longPass.status).toBe(400);
  });

  test('usernames are case-insensitive against the users map', async () => {
    const app = setup();
    const { res } = await login(app, 'ALICE', 'hunter2');
    expect(res.status).toBe(303);
  });

  test('a username like `constructor` never resolves to an inherited member', async () => {
    const app = setup();
    for (const name of ['constructor', 'toString', '__proto__']) {
      const { res } = await login(app, name, 'anything');
      expect(res.status).toBe(401); // clean rejection, not a 500
    }
  });
});

describe('logout flow', () => {
  test('GET /_gate/logout when not authed redirects to login', async () => {
    const app = setup();
    const res = await app('/_gate/logout');
    expect(res.status).toBe(302);
    expect(res.headers.get('location').startsWith('/_gate/login')).toBeTrue();
  });

  test('GET /_gate/logout when authed renders confirmation (no side effect)', async () => {
    const app = setup();
    const { jar } = await login(app);
    const res = await app('/_gate/logout', { headers: { Cookie: cookieHeader(jar) } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toInclude('Sign out');
    expect(body).toInclude('name="_csrf"');
    // GET did not log out — session still valid.
    const chk = await app('/_gate/check', { headers: { Cookie: cookieHeader(jar) } });
    expect(chk.status).toBe(204);
  });

  test('POST /_gate/logout (CSRF ok) clears the session server-side', async () => {
    const app = setup();
    const { jar } = await login(app);
    const token = jar.rip_gate;
    const page = await app('/_gate/logout', { headers: { Cookie: cookieHeader(jar) } });
    absorb(jar, page);
    const csrf = csrfOf(await page.text());
    const res = await app('/_gate/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(jar) },
      body: `_csrf=${csrf}`,
    });
    expect(res.status).toBe(303);
    // Even replaying the (pre-logout) session cookie now fails — file is gone.
    const chk = await app('/_gate/check', { headers: { Cookie: `rip_gate=${token}` } });
    expect(chk.status).toBe(401);
  });

  test('POST /_gate/logout without CSRF is rejected', async () => {
    const app = setup();
    const res = await app('/_gate/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    expect(res.status).toBe(403);
  });
});

describe('custom verify hook', () => {
  test('custom verify hook overrides the users map', async () => {
    let called = false;
    const app = setup({
      users: {},
      verify: (user, pass) => {
        called = true;
        return user === 'bob' && pass === 'rosebud' ? { user: 'bob', role: 'admin' } : null;
      },
    });
    const { res } = await login(app, 'bob', 'rosebud', '&return_to=%2Fprivate');
    expect(res.status).toBe(303);
    expect(called).toBeTrue();
  });

  test('custom verify gets the raw (non-lowercased) username', async () => {
    let captured = null;
    const app = setup({
      users: {},
      verify: (user, pass) => {
        captured = user;
        return user === 'Alice@Example.COM' && pass === 'p' ? { user } : null;
      },
    });
    await login(app, 'Alice%40Example.COM', 'p'); // urlencoded @
    expect(captured).toBe('Alice@Example.COM');
  });

  test('a truthy non-object verify result accepts as the submitted username', async () => {
    const app = setup({ users: {}, verify: () => true });
    const { jar, res } = await login(app, 'carol', 'whatever');
    expect(res.status).toBe(303);
    const chk = await app('/_gate/check', { headers: { Cookie: cookieHeader(jar) } });
    expect(chk.headers.get('remote-user')).toBe('carol');
  });
});

describe("protect: 'none' (forward_auth mode)", () => {
  test('does not auto-protect non-/_gate routes', async () => {
    const app = setup({ protect: 'none' });
    const res = await app('/private');
    expect(res.status).toBe(200); // the app answers itself, gate doesn't intercept
  });

  test('still answers /_gate/check with 401 for anonymous probes', async () => {
    const app = setup({ protect: 'none' });
    const res = await app('/_gate/check');
    expect(res.status).toBe(401);
  });
});

describe('safeReturnTo via /_gate/check redirect', () => {
  test('open-redirect tricks fall back to /', async () => {
    const app = setup();
    const res = await app('/_gate/check', {
      headers: { Accept: 'text/html', 'X-Forwarded-Uri': '//evil.com' },
    });
    expect(res.headers.get('location')).toInclude(`return_to=${encodeURIComponent('/')}`);
  });

  test('deep-link return_to preserves query string', async () => {
    const app = setup();
    const res = await app('/private?tab=settings&id=123', { headers: { Accept: 'text/html' } });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toInclude(encodeURIComponent('/private?tab=settings&id=123'));
  });

  test('forward_auth: /check honors X-Forwarded-Method for the redirect decision', async () => {
    const app = setup();
    // A forwarded POST never gets the login redirect, even from a browser.
    const res = await app('/_gate/check', {
      headers: { Accept: 'text/html', 'X-Forwarded-Method': 'POST' },
    });
    expect(res.status).toBe(401);
  });
});

describe('config validation (fail-closed)', () => {
  test('protect: invalid value throws', () => {
    expect(() => gate({ secret: SECRET, users: {}, protect: 'al', sessionDir: freshDir() }))
      .toThrow(/protect/);
  });

  test('ttl: non-positive or non-integer value throws', () => {
    for (const ttl of [0, -1, 1.5, '3600']) {
      expect(() => gate({ secret: SECRET, users: {}, ttl, sessionDir: freshDir() }))
        .toThrow(/ttl/);
    }
  });

  test('missing secret throws', () => {
    expect(() => gate({ users: {}, sessionDir: freshDir() })).toThrow(/secret/);
  });

  test('weak secret throws (fail-hard, as in the server security middleware)', () => {
    for (const secret of ['hunter2-weak', '   ', 'x'.repeat(31), 42]) {
      expect(() => gate({ secret, users: {}, sessionDir: freshDir() }))
        .toThrow(/at least 32 characters/);
    }
  });

  test('insecure: true excuses only an ABSENT secret, never a weak one', () => {
    // The opt-out: no secret + insecure: true constructs (random per-boot key).
    expect(() => gate({ insecure: true, users: {}, sessionDir: freshDir() })).not.toThrow();
    // No middle ground: a weak secret still throws even with insecure: true.
    expect(() => gate({ secret: 'hunter2-weak', insecure: true, users: {}, sessionDir: freshDir() }))
      .toThrow(/at least 32 characters/);
  });
});

describe('file-backed session store', () => {
  test('session cookie value is a 22-char base64url token, file exists in dir', async () => {
    const app = setup();
    const { jar } = await login(app);
    const token = jar.rip_gate;
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(readdirSync(app.dir)).toContain(token);
  });

  test('rm-ing the token file revokes the session (server-side revocation)', async () => {
    const app = setup();
    const { jar } = await login(app);
    expect((await app('/_gate/check', { headers: { Cookie: cookieHeader(jar) } })).status).toBe(204);
    unlinkSync(join(app.dir, jar.rip_gate));
    const chk = await app('/_gate/check', { headers: { Cookie: cookieHeader(jar) } });
    expect(chk.status).toBe(401);
  });

  test('a bogus / traversal token is rejected without touching the FS', async () => {
    const app = setup();
    for (const bad of ['../etc/passwd', 'short', 'has/slash/in/it/xxxxxx', '', '..%2F..%2Fetc%2Fpasswd']) {
      const chk = await app('/_gate/check', { headers: { Cookie: `rip_gate=${encodeURIComponent(bad)}` } });
      expect(chk.status).toBe(401);
    }
  });

  test('expired session is treated as anonymous (server-side mtime TTL)', async () => {
    const app = setup({ ttl: 1 });
    const { jar } = await login(app);
    // Backdate the file's mtime past the 1s TTL instead of sleeping.
    const path = join(app.dir, jar.rip_gate);
    const old = (Date.now() - 5000) / 1000;
    utimesSync(path, old, old);
    const chk = await app('/_gate/check', { headers: { Cookie: cookieHeader(jar) } });
    expect(chk.status).toBe(401); // cookie present but expired server-side
    expect(readdirSync(app.dir)).not.toContain(jar.rip_gate); // swept lazily
  });

  test('sliding window: an active session keeps getting refreshed past ttl', async () => {
    const app = setup({ ttl: 2 });
    const { jar } = await login(app);
    const path = join(app.dir, jar.rip_gate);
    // Push mtime to just-before expiry, then a request should bump it forward.
    const near = (Date.now() - 1500) / 1000;
    utimesSync(path, near, near);
    const before = statSync(path).mtimeMs;
    const chk = await app('/_gate/check', { headers: { Cookie: cookieHeader(jar) } });
    expect(chk.status).toBe(204);
    expect(statSync(path).mtimeMs).toBeGreaterThan(before);
  });

  test('the guard itself slides the window too, not just /check', async () => {
    const app = setup({ ttl: 2 });
    const { jar } = await login(app);
    const path = join(app.dir, jar.rip_gate);
    const near = (Date.now() - 1500) / 1000;
    utimesSync(path, near, near);
    const before = statSync(path).mtimeMs;
    const res = await app('/private', { headers: { Cookie: cookieHeader(jar) } });
    expect(res.status).toBe(200);
    expect(statSync(path).mtimeMs).toBeGreaterThan(before);
  });
});

describe('v3 read() semantics, pinned', () => {
  // v3's server read() merged { ...body, ...query } — the query string wins
  // over the form body — and trimmed every string value (passwords included).
  // Both are pinned warts, not endorsements.
  test('query string wins over the form body for login fields', async () => {
    const app = setup();
    const jar = {};
    const page = await app('/_gate/login');
    absorb(jar, page);
    const csrf = csrfOf(await page.text());
    const res = await app('/_gate/login?return_to=%2Ffrom-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(jar) },
      body: `user=alice&password=hunter2&_csrf=${csrf}&return_to=%2Ffrom-body`,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/from-query');
  });

  test('passwords are whitespace-trimmed before verification (v3 read() trim)', async () => {
    const app = setup();
    const { res } = await login(app, 'alice', '%20hunter2%20');
    expect(res.status).toBe(303);
  });
});
