// Shared harness: drive the gate middleware through the real v4 server
// pipeline (compose + createContext), with a cookie jar over Set-Cookie.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compose, createContext } from '../../server/index.rip';
import { gate } from '@rip-lang/gate';

export const SECRET = 'gate-test-secret-32-chars-or-longer';
export const ALICE_HASH = await Bun.password.hash('hunter2', { algorithm: 'argon2id' });

const dirs = [];
export const freshDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-test-'));
  dirs.push(dir);
  return dir;
};
export const sweepDirs = () => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
};

// Build a gate-protected app; returns an `app(path, opts)` fetch-alike.
// `secure: false` keeps cookie names deterministic (rip_gate, not __Host-)
// regardless of NODE_ENV, so the cookie jar below can find them.
export const setup = (opts = {}, handler = () => 'top secret') => {
  const dir = opts.sessionDir ?? freshDir();
  const mw = gate({
    secret: SECRET,
    users: { alice: ALICE_HASH },
    secure: false,
    ...opts,
    sessionDir: dir,
  });
  const run = compose({ use: [mw], handler });
  const app = (path, reqOpts = {}) => {
    const headers = { Host: 'app.test', ...(reqOpts.headers ?? {}) };
    const request = new Request(`http://app.test${path}`, {
      method: reqOpts.method ?? 'GET',
      headers,
      body: reqOpts.body,
    });
    return run(createContext(request));
  };
  app.dir = dir;
  return app;
};

// Cookie jar: absorb Set-Cookie headers, emit a Cookie header. A Max-Age=0
// (or empty value) cookie is treated as a deletion.
export const absorb = (jar, res) => {
  for (const cookie of res.headers.getSetCookie()) {
    const [pair] = cookie.split(';');
    const at = pair.indexOf('=');
    const name = pair.slice(0, at);
    const value = pair.slice(at + 1);
    if (value === '' || /max-age=0\b/i.test(cookie)) delete jar[name];
    else jar[name] = value;
  }
  return jar;
};

export const cookieHeader = (jar) =>
  Object.entries(jar).map(([name, value]) => `${name}=${value}`).join('; ');

export const csrfOf = (body) => body.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];

// Log in through the real GET→POST flow; returns { jar, res }.
export const login = async (app, user = 'alice', pass = 'hunter2', extra = '', headers = {}) => {
  const jar = {};
  const page = await app('/_gate/login');
  absorb(jar, page);
  const csrf = csrfOf(await page.text());
  const res = await app('/_gate/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(jar),
      ...headers,
    },
    body: `user=${user}&password=${pass}&_csrf=${csrf}${extra}`,
  });
  absorb(jar, res);
  return { jar, res, csrf };
};
