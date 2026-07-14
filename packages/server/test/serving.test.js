// Static and App serving: path containment (traversal + symlink),
// content types, cache headers and ETag revalidation, SPA fallback,
// the bundle endpoint, and title/state injection — all over an
// injected filesystem host, so the containment policy tests without a
// real disk.
import { describe, expect, test } from 'bun:test';
import { appServer, appShell, compose, createContext, mimeType, serveStatic } from '@rip-lang/server';

const request = (path = '/', opts = {}) => new Request(`http://test.local${path}`, opts);
const ctxOf = (req) => createContext(req);

// An in-memory host keyed by absolute path. Directories are declared
// with a trailing '/'; a symlink maps a path to its real target.
const memHost = (tree, links = {}) => {
  const norm = p => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);
  const realOf = p => links[norm(p)] ?? norm(p);
  return {
    stat(path) {
      const real = realOf(path);
      if (tree[`${real}/`] !== undefined || Object.keys(tree).some(k => k.startsWith(`${real}/`))) {
        if (tree[real] === undefined) return { isFile: false, isDirectory: true, size: 0, mtimeMs: 1 };
      }
      const body = tree[real];
      if (body === undefined) return null;
      return { isFile: true, isDirectory: false, size: body.length, mtimeMs: 1000 };
    },
    read: path => tree[realOf(path)] ?? null,
    realpath: path => realOf(path),
  };
};

describe('mimeType', () => {
  test('maps known extensions and falls back to octet-stream', () => {
    expect(mimeType('/a/b.html')).toBe('text/html; charset=UTF-8');
    expect(mimeType('/x.css')).toBe('text/css; charset=UTF-8');
    expect(mimeType('/x.js')).toBe('application/javascript');
    expect(mimeType('/x.json')).toBe('application/json');
    expect(mimeType('/logo.svg')).toBe('image/svg+xml');
    expect(mimeType('/font.woff2')).toBe('font/woff2');
    expect(mimeType('/nope.xyz')).toBe('application/octet-stream');
    expect(mimeType('/no-extension')).toBe('application/octet-stream');
  });
});

describe('serveStatic containment', () => {
  const host = memHost({
    '/site/index.html': '<h1>home</h1>',
    '/site/app.js': 'console.log(1)',
    '/site/assets/logo.svg': '<svg/>',
    '/secret.txt': 'TOP SECRET',
  });
  const run = (path, opts = {}) =>
    compose({ use: [serveStatic({ root: '/site', host })], handler: () => 'fell-through' })(
      ctxOf(request(path, opts)));

  test('serves a file within the root with its content type', async () => {
    const res = await run('/app.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/javascript');
    expect(await res.text()).toBe('console.log(1)');
  });

  test('no traversal spelling ever serves a file outside the root', async () => {
    for (const attack of [
      '/../secret.txt',
      '/..%2Fsecret.txt',
      '/%2e%2e/secret.txt',
      '/assets/../../secret.txt',
      '/....//secret.txt',
      '/%2e%2e%2f%2e%2e%2fsecret.txt',
      '/%2fsecret.txt',
      '/..\\secret.txt',
    ]) {
      expect(await (await run(attack)).text()).not.toBe('TOP SECRET');
    }
  });

  test('an encoded ".." that survives URL normalization is a hard 403', async () => {
    // The URL constructor collapses literal '..' and even '%2e%2e';
    // an encoded SLASH (%2f) is what smuggles '..' past it, and
    // resolveWithin is the second line that catches those.
    for (const escape of ['/..%2Fsecret.txt', '/%2e%2e%2f%2e%2e%2fsecret.txt']) {
      expect((await run(escape)).status).toBe(403);
    }
  });

  test('a segment that fails to percent-decode is refused, not served', async () => {
    const res = await run('/%E0%A4%A');
    expect([400, 404]).toContain(res.status);
  });

  test('a non-matching path falls through to the next handler', async () => {
    const res = await run('/api/users');
    expect(await res.text()).toBe('fell-through');
  });

  test('a host missing realpath is refused at construction', () => {
    expect(() => serveStatic({ root: '/site', host: { stat: () => null, read: () => null } }))
      .toThrow(/stat, read, and realpath/);
    expect(() => serveStatic({ root: '/site' })).toThrow(/host/);
    expect(() => serveStatic({ host })).toThrow(/root/);
  });

  test('a symlink escaping the root is refused', async () => {
    const linked = memHost(
      { '/site/index.html': 'home', '/outside/secret': 'ESCAPED' },
      { '/site/evil': '/outside/secret' },
    );
    const res = await compose({ use: [serveStatic({ root: '/site', host: linked })], handler: () => 'nf' })(
      ctxOf(request('/evil')));
    expect(await res.text()).not.toBe('ESCAPED');
    expect(res.status).toBe(403);
  });
});

describe('serveStatic behavior', () => {
  const host = memHost({
    '/site/index.html': '<h1>home</h1>',
    '/site/style.css': 'body{}',
    '/site/docs/index.html': '<h1>docs</h1>',
  });
  const stack = (opts) => compose({ use: [serveStatic({ root: '/site', host, ...opts })], handler: () => 'api' });
  const run = (path, opts, sopts) => stack(sopts)(ctxOf(request(path, opts)));

  test('a directory redirects to a trailing slash, then serves its index', async () => {
    const redirect = await run('/docs');
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get('Location')).toBe('/docs/');
    const index = await run('/docs/');
    expect(await index.text()).toBe('<h1>docs</h1>');
  });

  test('the trailing-slash redirect keeps the query and never goes scheme-relative', async () => {
    expect((await run('/docs?tab=api')).headers.get('Location')).toBe('/docs/?tab=api');
    const evil = await compose({ use: [serveStatic({ root: '/site', host: memHost({ '/site/evil.com/index.html': 'x' }) })], handler: () => 'api' })(
      ctxOf(request('//evil.com')));
    expect(evil.headers.get('Location')).toBe('/evil.com/');
  });

  test('a root with a trailing slash serves identically to one without', async () => {
    const slashed = compose({ use: [serveStatic({ root: '/site/', host })], handler: () => 'api' });
    expect(await (await slashed(ctxOf(request('/style.css')))).text()).toBe('body{}');
  });

  test('the root path serves the root index', async () => {
    expect(await (await run('/')).text()).toBe('<h1>home</h1>');
  });

  test('cache headers: immutable assets get a long max-age, ETag always', async () => {
    const res = await run('/style.css', {}, { maxAge: 3600, immutable: true });
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, immutable');
    expect(res.headers.get('ETag')).toMatch(/^W\/"/);
  });

  test('a matching If-None-Match is a 304 with no body', async () => {
    const first = await run('/style.css');
    const etag = first.headers.get('ETag');
    const second = await run('/style.css', { headers: { 'If-None-Match': etag } });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
  });

  test('only GET and HEAD are served; HEAD carries headers without a body', async () => {
    const head = await run('/style.css', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Type')).toBe('text/css; charset=UTF-8');
    expect(await head.text()).toBe('');
    const post = await run('/style.css', { method: 'POST' });
    expect(await post.text()).toBe('api');
  });

  test('SPA fallback serves index.html for HTML navigations that match no file', async () => {
    const nav = await run('/users/42', { headers: { Accept: 'text/html' } }, { spa: true });
    expect(await nav.text()).toBe('<h1>home</h1>');
    const asset = await run('/missing.js', { headers: { Accept: '*/*' } }, { spa: true });
    expect(await asset.text()).toBe('api');
  });
});

describe('appShell', () => {
  test('injects a title and a JSON-safe state payload', () => {
    const html = appShell({ title: 'My App', state: { user: 'Ada', count: 3 } });
    expect(html).toContain('<title>My App</title>');
    expect(html).toContain('{"user":"Ada","count":3}');
  });

  test('a hostile title or state cannot break out into markup', () => {
    const html = appShell({
      title: '</title><script>alert(1)</script>',
      state: { x: '</script><script>alert(2)</script>' },
    });
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('<script>alert(2)');
    expect(html).toContain('&lt;/title&gt;');
    expect(html).toContain('\\u003c/script>');
  });
});

describe('appServer preset', () => {
  const host = memHost({ '/app/index.html': '<div id=app></div>', '/app/main.js': 'boot()' });
  const bundle = { modules: { '_route/index.rip': 'export Home = component' }, data: { title: 'seed' } };
  const run = (path, opts, sopts) =>
    compose({ use: [appServer({ root: '/app', host, bundle, ...sopts })], handler: () => 'api' })(
      ctxOf(request(path, opts)));

  test('serves the bundle at its endpoint with an ETag and 304 revalidation', async () => {
    const res = await run('/bundle.json');
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(await res.json()).toEqual(bundle);
    const etag = res.headers.get('ETag');
    const again = await run('/bundle.json', { headers: { 'If-None-Match': etag } });
    expect(again.status).toBe(304);
  });

  test('applies secure headers by default and lets an asset through', async () => {
    const res = await run('/main.js');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await res.text()).toBe('boot()');
    const plain = await run('/main.js', {}, { secure: false });
    expect(plain.headers.get('X-Content-Type-Options')).toBeNull();
  });

  test('an HTML navigation gets the shell with the bundle state injected', async () => {
    const res = await run('/dashboard', { headers: { Accept: 'text/html' } }, { title: 'Dash' });
    const body = await res.text();
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(body).toContain('<title>Dash</title>');
    expect(body).toContain('"title":"seed"');
  });

  test('a non-asset non-HTML request falls through to the API', async () => {
    const res = await run('/api/users', { headers: { Accept: 'application/json' } });
    expect(await res.text()).toBe('api');
  });

  test('HEAD on the bundle endpoint carries headers without a body', async () => {
    const res = await run('/bundle.json', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).not.toBeNull();
    expect(await res.text()).toBe('');
  });

  test('an explicit state option overrides the bundle data in the shell', async () => {
    const res = await run('/dashboard', { headers: { Accept: 'text/html' } }, { state: { who: 'explicit' } });
    const body = await res.text();
    expect(body).toContain('"who":"explicit"');
    expect(body).not.toContain('"title":"seed"');
  });

  test('appServer requires a bundle', () => {
    expect(() => appServer({ root: '/app', host })).toThrow(/requires a bundle/);
  });
});
