// Differential guard against walker/runtime drift: the route discovery
// in packages/vscode/src/mirror.js (`appRoutesFor`, pure JS — it feeds
// typed hrefs, `router.push`, and per-route `@params`) re-implements
// the routing conventions this package's `buildRoutes` owns. Both are
// run over the same trees and must tell the same story: every route the
// runtime accepts appears in the walker's union (catch-alls excepted —
// they are fallbacks, not navigation targets) with the same expansion
// of optionals, and every route's captured params match the walker's
// per-file shape. The pattern→TS-text bridge here is deliberately
// independent of the walker's own rendering path.
import { expect, test, afterAll } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRoutes } from 'rip/app';
import { appRoutesFor } from '../../vscode/src/mirror.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const made = [];
afterAll(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

function makeApp(routeFiles) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rip-routes-diff-')));
  made.push(root);
  fs.writeFileSync(path.join(root, 'index.rip'), '');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture' }));
  for (const rel of routeFiles) {
    const abs = path.join(root, 'app', 'routes', ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '');
  }
  return root;
}

// The bridge: a manifest pattern (`/users/:id`, `/docs/:page?`,
// `/files/*rest`) re-rendered as the union-member text the walker is
// expected to emit for that route.
const partsOf = (pattern) =>
  (pattern === '/' ? [] : pattern.slice(1).split('/')).map((seg) => {
    if (seg.startsWith('*')) return { kind: 'catchall', name: seg.slice(1) };
    if (seg.startsWith(':')) {
      return seg.endsWith('?')
        ? { kind: 'optional', name: seg.slice(1, -1) }
        : { kind: 'dynamic', name: seg.slice(1) };
    }
    return { kind: 'static', text: seg };
  });

const escapeTemplateText = (text) =>
  text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const unionFromManifest = (manifest) => {
  const members = new Map(); // text → shape (the sort key)
  for (const route of manifest.routes) {
    const parts = partsOf(route.pattern);
    if (parts.some((p) => p.kind === 'catchall')) continue;
    let expansions = [[]];
    for (const part of parts) {
      if (part.kind === 'static') expansions = expansions.map((e) => [...e, part.text]);
      else if (part.kind === 'dynamic') expansions = expansions.map((e) => [...e, null]);
      else expansions = expansions.flatMap((e) => [e, [...e, null]]);
    }
    for (const pieces of expansions) {
      const shape = pieces.map((p) => (p === null ? '/${string}' : `/${p}`)).join('') || '/';
      const text = pieces.includes(null)
        ? '`' + pieces.map((p) => (p === null ? '/${string}' : `/${escapeTemplateText(p)}`)).join('') + '`'
        : JSON.stringify(shape);
      if (!members.has(text)) members.set(text, shape);
    }
  }
  const sorted = [...members.entries()].sort(([, a], [, b]) => {
    if (a === '/') return -1;
    if (b === '/') return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return sorted.length ? sorted.map(([text]) => text).join(' | ') : null;
};

const paramsFromRoute = (route) => {
  const fields = partsOf(route.pattern)
    .filter((p) => p.kind !== 'static')
    .map((p) => `${p.name}${p.kind === 'optional' ? '?' : ''}: string`);
  return fields.length ? `{ ${fields.join('; ')} }` : null;
};

// One tree, both implementations, full-story comparison: the union from
// any file, and the params answer at every route file the runtime kept.
function agree(routeFiles) {
  const root = makeApp(routeFiles);
  const manifest = buildRoutes(routeFiles.map((f) => `routes/${f}`));
  const memo = new Map();
  const union = appRoutesFor(path.join(root, 'index.rip'), root, memo).union;
  expect(union).toBe(unionFromManifest(manifest));
  for (const route of manifest.routes) {
    const rel = route.file.slice('routes/'.length);
    const answer = appRoutesFor(path.join(root, 'app', 'routes', ...rel.split('/')), root, memo);
    expect(answer.union).toBe(union);
    expect(answer.params).toBe(paramsFromRoute(route));
  }
}

test('statics, dynamics, groups, layouts, and nesting agree', () => {
  agree([
    'index.rip',
    'about.rip',
    '_layout.rip',
    '_lib/helper.rip',
    'users/index.rip',
    'users/[id].rip',
    'users/[id]/edit.rip',
    '(admin)/settings.rip',
    '(admin)/_layout.rip',
    'blog/[slug]/comments/[cid].rip',
    'legal/terms.rip',
  ]);
});

test('optional segments agree on both expansions', () => {
  agree(['docs/[[page]].rip', 'x/[[b]]/y/[[c]].rip']);
});

test('catch-alls agree: no union claim, full params', () => {
  agree(['index.rip', 'files/[...rest].rip', 'docs/[topic]/[...path].rip']);
});

test('a catch-all-only tree agrees on an empty union', () => {
  agree(['[...rest].rip']);
});

test('the cart demo tree agrees', () => {
  const cartRoot = path.resolve(HERE, '..', '..', 'sites', 'demos', 'cart');
  const routesDir = path.join(cartRoot, 'app', 'routes');
  const files = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name), `${rel}${e.name}/`);
      else if (e.name.endsWith('.rip')) files.push(`${rel}${e.name}`);
    }
  };
  walk(routesDir, '');
  const manifest = buildRoutes(files.map((f) => `routes/${f}`));
  expect(manifest.routes.length).toBeGreaterThan(0);
  const answer = appRoutesFor(path.join(cartRoot, 'index.rip'), cartRoot);
  expect(answer.union).toBe(unionFromManifest(manifest));
});
