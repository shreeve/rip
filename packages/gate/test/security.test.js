// The security battery behind this port's dedicated review: Remote-User
// spoofing, session fixation, CSRF forgery, open redirects, username
// enumeration, cookie attributes, and secret handling. Every case pins the
// v3 semantics — the findings themselves live in the PR's review section.
import { afterAll, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gate } from '@rip-lang/gate';
import {
  absorb, cookieHeader, csrfOf, freshDir, login, setup, sweepDirs,
} from './harness.js';

afterAll(sweepDirs);

describe('Remote-User trust boundary', () => {
  test('a client-supplied Remote-User header never reaches the /check answer', async () => {
    const app = setup();
    // Unauthenticated probe with a spoofed identity: 401, no Remote-User out.
    const anon = await app('/_gate/check', { headers: { 'Remote-User': 'root' } });
    expect(anon.status).toBe(401);
    expect(anon.headers.get('remote-user')).toBeNull();

    // Authenticated probe still spoofing: the session store wins.
    const { jar } = await login(app);
    const chk = await app('/_gate/check', {
      headers: { Cookie: cookieHeader(jar), 'Remote-User': 'root' },
    });
    expect(chk.status).toBe(204);
    expect(chk.headers.get('remote-user')).toBe('alice');
  });

  test('middleware mode passes request headers through untouched (proxy strips, by contract)', async () => {
    // Gate never strips inbound headers: in forward-auth mode the reverse
    // proxy MUST drop client-supplied Remote-User (README configs do), and in
    // middleware mode the app must not read it — identity only ever travels
    // on gate's own /check RESPONSE header. Pinned so a future "helpful"
    // mutation of the inbound request shows up as a test failure.
    const app = setup({}, (c) => `saw:${c.req.header('remote-user') ?? 'nothing'}`);
    const { jar } = await login(app);
    const res = await app('/private', {
      headers: { Cookie: cookieHeader(jar), 'Remote-User': 'root' },
    });
    expect(await res.text()).toBe('saw:root');
  });
});

describe('session fixation and token forgery', () => {
  test('login always mints a fresh token — a pre-set cookie is never adopted', async () => {
    const app = setup();
    const planted = 'AAAAAAAAAAAAAAAAAAAAAA'; // well-formed 22-char token
    const jar = {};
    const page = await app('/_gate/login', { headers: { Cookie: `rip_gate=${planted}` } });
    absorb(jar, page);
    const csrf = csrfOf(await page.text());
    const res = await app('/_gate/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: `rip_gate=${planted}; ${cookieHeader(jar)}`,
      },
      body: `user=alice&password=hunter2&_csrf=${csrf}`,
    });
    expect(res.status).toBe(303);
    absorb(jar, res);
    expect(jar.rip_gate).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(jar.rip_gate).not.toBe(planted);
    // The planted token itself is still worthless.
    const chk = await app('/_gate/check', { headers: { Cookie: `rip_gate=${planted}` } });
    expect(chk.status).toBe(401);
  });

  test('a well-formed token that was never issued is rejected', async () => {
    const app = setup();
    const forged = 'Zz0-_Zz0-_Zz0-_Zz0-_Zz';
    const chk = await app('/_gate/check', { headers: { Cookie: `rip_gate=${forged}` } });
    expect(chk.status).toBe(401);
  });

  test('a token file planted in the dir works only under its exact name (charset is the guard)', async () => {
    // The filesystem is the source of truth by design: whoever can write the
    // 0700 session dir owns the sessions. What the cookie path guarantees is
    // that only TOKEN_RE names are ever looked up.
    const app = setup();
    writeFileSync(join(app.dir, 'evil name'), 'root', { mode: 0o600 });
    const chk = await app('/_gate/check', { headers: { Cookie: 'rip_gate=evil%20name' } });
    expect(chk.status).toBe(401);
  });
});

describe('CSRF forgery', () => {
  test('cookie without form field fails; matching pair without valid HMAC fails', async () => {
    const app = setup();
    // Cookie present, no form field.
    const jar = {};
    absorb(jar, await app('/_gate/login'));
    const noField = await app('/_gate/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(jar) },
      body: 'user=alice&password=hunter2',
    });
    expect(noField.status).toBe(403);

    // Attacker-minted matched pair: right shape, wrong key.
    const forged = 'aaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const matched = await app('/_gate/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: `rip_gate_csrf=${forged}`,
      },
      body: `user=alice&password=hunter2&_csrf=${forged}`,
    });
    expect(matched.status).toBe(403);
  });

  test('two genuine tokens cannot stand in for each other (cookie must equal form)', async () => {
    const app = setup();
    const jarA = {};
    absorb(jarA, await app('/_gate/login'));
    const pageB = await app('/_gate/login');
    const csrfB = csrfOf(await pageB.text());
    // Cookie from mint A, form field from mint B — both HMAC-valid, still 403.
    const res = await app('/_gate/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(jarA) },
      body: `user=alice&password=hunter2&_csrf=${csrfB}`,
    });
    expect(res.status).toBe(403);
  });

  test('a tampered signature of the right length is rejected (timingSafeEqual path)', async () => {
    const app = setup();
    const page = await app('/_gate/login');
    const genuine = csrfOf(await page.text());
    const [nonce, sig] = genuine.split('.');
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    const tampered = `${nonce}.${flipped}`;
    const res = await app('/_gate/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: `rip_gate_csrf=${tampered}`,
      },
      body: `user=alice&password=hunter2&_csrf=${tampered}`,
    });
    expect(res.status).toBe(403);
  });

  test('the session cookie is not accepted as a csrf token', async () => {
    const app = setup();
    const { jar } = await login(app);
    const res = await app('/_gate/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(jar) },
      body: `_csrf=${jar.rip_gate}`,
    });
    expect(res.status).toBe(403);
  });
});

describe('open redirect (login flow)', () => {
  const hostile = [
    'https://evil.com',
    '//evil.com',
    '/\\evil.com',
    '\\/evil.com',
    'javascript:alert(1)',
    '/ok\r\nSet-Cookie: pwned=1',
    '/has space',
    `/${'a'.repeat(2100)}`,
  ];

  test('hostile return_to collapses to / on the post-login redirect', async () => {
    const app = setup();
    for (const bad of hostile) {
      const { res } = await login(app, 'alice', 'hunter2', `&return_to=${encodeURIComponent(bad)}`);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/');
    }
  });

  test('hostile return_to collapses to / on the guard redirect and /check', async () => {
    const app = setup();
    // A CRLF value can't travel as a header at all — the fetch layer refuses
    // it before gate sees it; every other hostile shape reaches safeReturnTo.
    for (const bad of hostile.filter((s) => !/[\r\n]/.test(s))) {
      const res = await app('/_gate/check', {
        headers: { Accept: 'text/html', 'X-Forwarded-Uri': bad },
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`/_gate/login?return_to=${encodeURIComponent('/')}`);
    }
  });

  test('a genuine same-origin deep link survives', async () => {
    const app = setup();
    const { res } = await login(app, 'alice', 'hunter2', `&return_to=${encodeURIComponent('/deep/link?x=1&y=2')}`);
    expect(res.headers.get('location')).toBe('/deep/link?x=1&y=2');
  });
});

describe('username enumeration', () => {
  test('unknown user and wrong password are indistinguishable responses', async () => {
    const app = setup();
    const wrongPass = await login(app, 'alice', 'nope');
    const unknownUser = await login(app, 'mallory', 'nope');
    expect(wrongPass.res.status).toBe(401);
    expect(unknownUser.res.status).toBe(401);
    const scrub = (body, csrf) => body.replaceAll(csrf, 'CSRF');
    const a = scrub(await wrongPass.res.text(), wrongPass.csrf);
    const b = scrub(await unknownUser.res.text(), unknownUser.csrf);
    expect(a).toBe(b);
  });
});

describe('identity hardening', () => {
  test('verify() returning an unsafe user value rejects the login with 500', async () => {
    for (const user of ['', 'line\nbreak', 'ctrl\x00char', 'ünïcode', 42, null]) {
      const app = setup({ users: {}, verify: () => ({ user }) });
      const { jar, res } = await login(app, 'x', 'y');
      expect(res.status).toBe(500);
      expect(await res.text()).toBe('login rejected');
      expect(jar.rip_gate).toBeUndefined();
    }
  });
});

describe('cookie attributes', () => {
  test('session cookie is HttpOnly, SameSite=Lax, Path=/, session-scoped', async () => {
    const app = setup();
    const { res } = await login(app);
    const session = res.headers.getSetCookie().find((c) => c.startsWith('rip_gate='));
    expect(session).toInclude('HttpOnly');
    expect(session).toInclude('SameSite=Lax');
    expect(session).toInclude('Path=/');
    expect(session).not.toInclude('Max-Age'); // mtime+ttl is the sole expiry authority
    expect(session).not.toInclude('Secure'); // secure: false in this harness
  });

  test('secure: true adds Secure and the __Host- prefix', async () => {
    const app = setup({ secure: true });
    const page = await app('/_gate/login');
    const csrfCookie = page.headers.getSetCookie().find((c) => c.startsWith('__Host-rip_gate_csrf='));
    expect(csrfCookie).toBeDefined();
    expect(csrfCookie).toInclude('Secure');
    expect(csrfCookie).toInclude('Path=/'); // __Host- requires Secure + Path=/ + no Domain
    expect(csrfCookie).not.toInclude('Domain');
  });

  test('logout expires both cookies', async () => {
    const app = setup();
    const { jar } = await login(app);
    const page = await app('/_gate/logout', { headers: { Cookie: cookieHeader(jar) } });
    absorb(jar, page);
    const csrf = csrfOf(await page.text());
    const res = await app('/_gate/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(jar) },
      body: `_csrf=${csrf}`,
    });
    const cleared = res.headers.getSetCookie();
    expect(cleared.some((c) => c.startsWith('rip_gate=;') && /Max-Age=0/.test(c))).toBeTrue();
    expect(cleared.some((c) => c.startsWith('rip_gate_csrf=;') && /Max-Age=0/.test(c))).toBeTrue();
  });

  test('every gate response carries Cache-Control: no-store', async () => {
    const app = setup();
    const probes = [
      await app('/_gate/login'),
      await app('/_gate/check'),
      await app('/private', { headers: { Accept: 'text/html' } }),
      await app('/private'),
    ];
    for (const res of probes) expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('template safety', () => {
  test('login page escapes a hostile host header and return_to', async () => {
    const app = setup();
    const res = await app(`/_gate/login?return_to=${encodeURIComponent('/"/><script>x</script>')}`, {
      headers: { Host: 'app.test', 'X-Forwarded-Host': '"><script>alert(1)</script>' },
    });
    const body = await res.text();
    expect(body).not.toInclude('<script>alert(1)</script>');
    expect(body).not.toInclude('<script>x</script>');
  });
});

describe('secret handling', () => {
  test('a weak secret fails construction without echoing the secret', () => {
    let thrown = null;
    try {
      gate({ secret: 'hunter2-weak', users: {}, sessionDir: freshDir() });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown.message).toInclude('at least 32 characters');
    expect(thrown.message).not.toInclude('hunter2-weak'); // never echo the secret
    expect(thrown.message).not.toInclude('12');           // nor even its length
  });

  test('insecure: true (no secret) still yields a working CSRF key', async () => {
    // The per-boot random key must sign and verify a real login round trip.
    const app = setup({ secret: undefined, insecure: true });
    const { jar, res } = await login(app);
    expect(res.status).toBe(303);
    const chk = await app('/_gate/check', { headers: { Cookie: cookieHeader(jar) } });
    expect(chk.status).toBe(204);
  });
});

describe('hash subcommand', () => {
  test('emits a verifiable argon2id hash and stays inert on import', async () => {
    const run = Bun.spawnSync({
      cmd: ['bun', 'index.rip', 'hash', 'hunter2'],
      cwd: new URL('..', import.meta.url).pathname,
    });
    expect(run.exitCode).toBe(0);
    const hash = run.stdout.toString().trim();
    expect(hash).toStartWith('$argon2id$');
    expect(await Bun.password.verify('hunter2', hash)).toBeTrue();
  });
});
