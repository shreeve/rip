// The certification page server: repository dist plus the fixture app,
// with ETag revalidation on the bundle so the boot's 304 path runs in
// a real browser.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleBundle } from '../../src/bundle.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

const MODULES = {
  'app/stash.rip': [
    "import { source } from '@rip-lang/app'",
    'export stash = {',
    "  user: source fetch: -> (await fetch('/user.json')).json()",
    '}',
  ].join('\n'),
  'app/routes/index.rip': [
    'export Home = component',
    '  render',
    '    h1#title "home"',
    '    a href: "/profile", "profile"',
  ].join('\n'),
  'app/routes/profile.rip': [
    'export Profile = component',
    '  user <~ @app.data.user',
    '  render',
    '    h1#title user.name',
  ].join('\n'),
};

const bundleText = JSON.stringify(assembleBundle({
  modules: MODULES,
  packagesDir: join(root, 'packages'),
  data: { title: 'certification' },
}));
const bundleTag = `"${Bun.hash(bundleText).toString(16)}"`;

// The workspace door surface (docs/WORKSPACE.md dev-feed shape): a
// mutable cell registry with rev-keyed immutable bytes, a no-store
// manifest, and a hub socket that only ever sends {ding: {id, rev}} —
// never bodies. POST /__test/bump advances a cell from the spec, and
// GET /__test/frames answers the full frame log so specs pin D2.
const wsRoute = title => [
  'export Home = component',
  '  render',
  `    h1#title "${title}"`,
].join('\n');

const wsModules = { 'app/routes/index.rip': wsRoute('workspace home') };
const wsRevs = new Map([['app/routes/index.rip', 1]]);
const wsEtags = new Map();
const shortEtag = (text) => new Bun.CryptoHasher('sha256').update(text).digest('hex').slice(0, 16);
wsEtags.set('app/routes/index.rip', shortEtag(wsModules['app/routes/index.rip']));
let wsBundleText = null;
let wsBundleTag = null;
const rebuildWsBundle = () => {
  wsBundleText = JSON.stringify(assembleBundle({
    modules: wsModules,
    packagesDir: join(root, 'packages'),
  }));
  wsBundleTag = `"${Bun.hash(wsBundleText).toString(16)}"`;
};
rebuildWsBundle();

const wsSockets = new Set();
const wsFrames = [];
const ding = (id, rev, etag) => {
  const frame = JSON.stringify({ ding: { id, rev, etag } });
  wsFrames.push(frame);
  for (const socket of wsSockets) socket.send(frame);
};

const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };

Bun.serve({
  port: 4173,
  async fetch(request, server) {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === '/bundle.json') {
      // ?door=1 is the workspace certification bundle (harness-only); the
      // plain URL is the non-workspace app.spec bundle.
      const door = url.searchParams.has('door');
      const text = door ? wsBundleText : bundleText;
      const tag = door ? wsBundleTag : bundleTag;
      if (request.headers.get('If-None-Match') === tag) {
        return new Response(null, { status: 304, headers: { ETag: tag } });
      }
      return new Response(text, { headers: { 'Content-Type': 'application/json', ETag: tag } });
    }
    if (pathname === '/user.json') {
      return new Response(JSON.stringify({ name: 'Ada Lovelace' }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (pathname === '/hub') {
      return server.upgrade(request) ? undefined : new Response('websocket only', { status: 400 });
    }
    if (pathname === '/manifest.json') {
      const cells = [...wsRevs].map(([id, rev]) => ({ id, rev, etag: wsEtags.get(id) }));
      return new Response(JSON.stringify({ cells }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
    if (pathname.startsWith('/app/') && pathname.endsWith('.rip')) {
      const id = pathname.slice(1); // app/...
      const wanted = url.searchParams.get('etag');
      const body = wsModules[id];
      if (body === undefined) return new Response('unknown module', { status: 404 });
      const current = wsEtags.get(id) ?? shortEtag(body);
      const headers = { 'Content-Type': 'text/plain; charset=utf-8', ETag: `"${current}"`, 'Cache-Control': 'no-store' };
      if (!wanted || !/^[0-9a-f]{16}$/.test(wanted)) {
        return new Response('module URLs require ?etag=<16-hex>', { status: 400 });
      }
      if (wanted !== current) return new Response(null, { status: 409, headers });
      return new Response(body, { headers });
    }
    if (pathname === '/__test/bump' && request.method === 'POST') {
      const { id, title } = await request.json();
      const rev = (wsRevs.get(id) ?? 0) + 1;
      const source = wsRoute(title);
      const etag = shortEtag(source);
      wsRevs.set(id, rev);
      wsEtags.set(id, etag);
      wsModules[id] = source;
      rebuildWsBundle();
      ding(id, rev, etag);
      return new Response(JSON.stringify({ id, rev, etag }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (pathname === '/__test/frames') {
      return new Response(JSON.stringify(wsFrames), { headers: { 'Content-Type': 'application/json' } });
    }
    const file = pathname === '/' ? '/index.html' : pathname;
    const candidates = [join(here, 'fixture', file), join(root, file)];
    for (const candidate of candidates) {
      try {
        const body = readFileSync(candidate);
        const type = TYPES[candidate.slice(candidate.lastIndexOf('.'))] ?? 'application/octet-stream';
        return new Response(body, { headers: { 'Content-Type': type } });
      } catch {}
    }
    return new Response('not found', { status: 404 });
  },
  websocket: {
    open(socket) { wsSockets.add(socket); },
    close(socket) { wsSockets.delete(socket); },
    message() {},
  },
});
console.log('serving http://localhost:4173');
