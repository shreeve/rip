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
    'export appStash = {',
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
const wsBytes = new Map([['app/routes/index.rip@1', wsModules['app/routes/index.rip']]]);
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
const ding = (id, rev) => {
  const frame = JSON.stringify({ ding: { id, rev } });
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
      if (request.headers.get('If-None-Match') === bundleTag) {
        return new Response(null, { status: 304, headers: { ETag: bundleTag } });
      }
      return new Response(bundleText, { headers: { 'Content-Type': 'application/json', ETag: bundleTag } });
    }
    if (pathname === '/user.json') {
      return new Response(JSON.stringify({ name: 'Ada Lovelace' }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (pathname === '/hub') {
      return server.upgrade(request) ? undefined : new Response('websocket only', { status: 400 });
    }
    if (pathname === '/@rip/bundle.json') {
      if (request.headers.get('If-None-Match') === wsBundleTag) {
        return new Response(null, { status: 304, headers: { ETag: wsBundleTag } });
      }
      return new Response(wsBundleText, { headers: { 'Content-Type': 'application/json', ETag: wsBundleTag } });
    }
    if (pathname === '/@rip/manifest') {
      const cells = [...wsRevs].map(([id, rev]) => ({ id, rev }));
      return new Response(JSON.stringify({ cells }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
    if (pathname.startsWith('/@rip/cells/')) {
      const id = pathname.slice('/@rip/cells/'.length);
      const body = wsBytes.get(`${id}@${url.searchParams.get('rev')}`);
      if (body === undefined) return new Response('unknown cell', { status: 404 });
      return new Response(body, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable' },
      });
    }
    if (pathname === '/__test/bump' && request.method === 'POST') {
      const { id, title } = await request.json();
      const rev = (wsRevs.get(id) ?? 0) + 1;
      const source = wsRoute(title);
      wsRevs.set(id, rev);
      wsBytes.set(`${id}@${rev}`, source);
      wsModules[id] = source;
      rebuildWsBundle();
      ding(id, rev);
      return new Response(JSON.stringify({ id, rev }), { headers: { 'Content-Type': 'application/json' } });
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
