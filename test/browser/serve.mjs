// The certification page server: repository dist plus complete Rip
// publications, ordered watch changes, and latest.json reconnect identity.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleRipBundle } from '../../packages/sites/bundle.rip';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

const MODULES = {
  'stash.rip': [
    "import { source } from 'rip/app'",
    'export stash = {',
    "  user: source fetch: -> (await fetch('/user.json')).json()",
    '}',
  ].join('\n'),
  'data.rip': "export data = { title: 'certification' }",
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

const bundleText = JSON.stringify({
  hash: 'APP001',
  list: assembleRipBundle({ modules: MODULES, packagesDir: join(root, 'packages') }),
});
const bundleTag = `"${Bun.hash(bundleText).toString(16)}"`;

// POST /__test/bump publishes a new complete bundle/latest pair and sends one
// source-carrying Rip change. GET /__test/frames exposes the wire contract.
const wsRoute = title => [
  'export Home = component',
  '  render',
  `    h1#title "${title}"`,
].join('\n');

const wsModules = { 'routes/index.rip': wsRoute('workspace home') };
const ripHash = text => createHash('sha256').update(text).digest('base64url').slice(0, 6).replaceAll('-', '_');
let wsBundleText = null;
let wsBundleTag = null;
let wsHash = null;
const rebuildWsBundle = () => {
  const list = assembleRipBundle({ modules: wsModules, packagesDir: join(root, 'packages') });
  wsHash = ripHash(JSON.stringify(list));
  wsBundleText = JSON.stringify({ hash: wsHash, list });
  wsBundleTag = `"${Bun.hash(wsBundleText).toString(16)}"`;
};
rebuildWsBundle();

const wsSockets = new Set();
const wsFrames = [];
const publishChange = change => {
  const frame = JSON.stringify({ change });
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
      // ?watch=1 is the workspace certification bundle (harness-only); the
      // plain URL is the non-workspace app.spec bundle.
      const watch = url.searchParams.has('watch');
      const text = watch ? wsBundleText : bundleText;
      const tag = watch ? wsBundleTag : bundleTag;
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
    if (pathname === '/latest.json') {
      return Response.json({ hash: wsHash }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (pathname === '/__test/bump' && request.method === 'POST') {
      const { id, title } = await request.json();
      const source = wsRoute(title);
      const from = wsHash;
      wsModules[id] = source;
      rebuildWsBundle();
      publishChange({ from, hash: wsHash, list: [[id, source]] });
      return Response.json({ id, hash: wsHash });
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
    message(socket, text) {
      try {
        const frame = JSON.parse(String(text));
        if (typeof frame?.['?'] === 'string') socket.send(JSON.stringify({ '!': frame['?'] }));
      } catch {}
    },
  },
});
console.log('serving http://localhost:4173');
