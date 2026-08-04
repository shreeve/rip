// The certification page server: repository dist plus the fixture app,
// with ETag revalidation on the bundle so the boot's 304 path runs in
// a real browser.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleBundle } from '../../src/bundle.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

const MODULES = {
  'stash.rip': [
    "import { source } from '@rip-lang/app'",
    'export stash = {',
    "  user: source fetch: -> (await fetch('/user.json')).json()",
    '}',
  ].join('\n'),
  'routes/index.rip': [
    'export Home = component',
    '  render',
    '    h1#title "home"',
    '    a href: "/profile", "profile"',
  ].join('\n'),
  'routes/profile.rip': [
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

// The workspace door surface: latest file bytes, a revalidated manifest,
// and a hub socket that sends {ding: {id, hash}} — never bodies. POST /__test/bump
// advances a file from the spec; GET /__test/frames pins D2.
const wsRoute = title => [
  'export Home = component',
  '  render',
  `    h1#title "${title}"`,
].join('\n');

const wsModules = { 'routes/index.rip': wsRoute('workspace home') };
const wsHashes = new Map();
const ripHash = text => createHash('sha256').update(text).digest('base64url').slice(0, 6).replaceAll('-', '_');
wsHashes.set('routes/index.rip', ripHash(wsModules['routes/index.rip']));
const wsInventory = () => [...wsHashes]
  .map(([id, hash]) => ({ id, hash }))
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const checkOf = files => ripHash(JSON.stringify(files.map(({ id, hash }) => [id, hash])));
let wsBundleText = null;
let wsBundleTag = null;
const rebuildWsBundle = () => {
  const files = wsInventory();
  wsBundleText = JSON.stringify({
    ...assembleBundle({
      modules: wsModules,
      packagesDir: join(root, 'packages'),
    }),
    check: checkOf(files),
    files,
  });
  wsBundleTag = `"${Bun.hash(wsBundleText).toString(16)}"`;
};
rebuildWsBundle();

const wsSockets = new Set();
const wsFrames = [];
const ding = (id, hash) => {
  const frame = JSON.stringify({ ding: { id, hash } });
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
      const files = wsInventory();
      return new Response(JSON.stringify({ check: checkOf(files), files }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      });
    }
    if (pathname.startsWith('/') && pathname.endsWith('.rip')) {
      const id = pathname.slice(1);
      const body = wsModules[id];
      if (body === undefined) return new Response('unknown module', { status: 404 });
      return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    if (pathname === '/__test/bump' && request.method === 'POST') {
      const { id, title } = await request.json();
      const source = wsRoute(title);
      const hash = ripHash(source);
      wsHashes.set(id, hash);
      wsModules[id] = source;
      rebuildWsBundle();
      ding(id, hash);
      return new Response(JSON.stringify({ id, hash }), { headers: { 'Content-Type': 'application/json' } });
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
