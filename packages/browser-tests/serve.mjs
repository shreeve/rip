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
  '_app/stash.rip': [
    "import { source } from '@rip-lang/app'",
    'export appStash = {',
    "  user: source fetch: -> (await fetch('/user.json')).json()",
    '}',
  ].join('\n'),
  '_route/index.rip': [
    'export Home = component',
    '  render',
    '    h1#title "home"',
    '    a href: "/profile", "profile"',
  ].join('\n'),
  '_route/profile.rip': [
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

const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };

Bun.serve({
  port: 4173,
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/bundle.json') {
      if (request.headers.get('If-None-Match') === bundleTag) {
        return new Response(null, { status: 304, headers: { ETag: bundleTag } });
      }
      return new Response(bundleText, { headers: { 'Content-Type': 'application/json', ETag: bundleTag } });
    }
    if (pathname === '/user.json') {
      return new Response(JSON.stringify({ name: 'Ada Lovelace' }), { headers: { 'Content-Type': 'application/json' } });
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
});
console.log('serving http://localhost:4173');
