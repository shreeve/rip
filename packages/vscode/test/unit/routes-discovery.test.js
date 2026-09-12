// Route discovery — the walk from a source file to the project's route
// union and its own params shape. The union is TS text over
// `<root>/app/routes`: statics as string literals, dynamic segments as
// `${string}` template holes, `/` first then lexicographic, deduped —
// stable text, usable as a cache key. The walker re-implements the
// runtime conventions of packages/app/routes.rip in pure JS; the
// differential test in packages/app/test/routes-discovery.test.js is
// the drift guard against `buildRoutes` itself. These are the pure-JS
// pins: shape of the text, arming, leniency, memo semantics.
import { test, expect, afterAll } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appRoutesFor, appRootDirFor } from '../../src/mirror.js';

const made = [];
afterAll(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

// An app project: `<root>/index.rip` + `<root>/package.json` anchor the
// walk; route files live under the fixed contract `<root>/app/routes`.
function makeApp(routeFiles) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rip-routes-')));
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

const routeFile = (root, rel) => path.join(root, 'app', 'routes', ...rel.split('/'));
const fromApp = (root, rel = 'index.rip', memo = null) => appRoutesFor(routeFile(root, rel), root, memo);

test('statics, dynamics, and nesting render sorted union text', () => {
  const root = makeApp([
    'index.rip',
    'about.rip',
    'users/index.rip',
    'users/[id].rip',
    'blog/[slug]/comments/[cid].rip',
  ]);
  expect(fromApp(root).union).toBe(
    '"/" | "/about" | `/blog/${string}/comments/${string}` | "/users" | `/users/${string}`',
  );
});

test('group directories contribute no segment; _-prefixed entries are unroutable', () => {
  const root = makeApp([
    '(admin)/settings.rip',
    '(admin)/_layout.rip',
    '_layout.rip',
    '_lib/helper.rip',
  ]);
  expect(fromApp(root, '(admin)/settings.rip').union).toBe('"/settings"');
});

test('catch-alls claim their bare prefix and everything under it', () => {
  const root = makeApp(['index.rip', 'files/[...rest].rip']);
  const answer = fromApp(root, 'files/[...rest].rip');
  expect(answer.union).toBe('"/" | "/files" | `/files/${string}`');
  expect(answer.params).toBe('{ rest: string }');
  expect(answer.entries.map((e) => e.display)).toEqual(['/', '/files', '/files/*rest']);
  const only = makeApp(['[...rest].rip']);
  expect(fromApp(only, '[...rest].rip').union).toBe('"/" | `/${string}`');
  expect(fromApp(only, '[...rest].rip').entries.map((e) => e.display)).toEqual(['/', '/*rest']);
});

test('a not-found page is no route: no member, its directory params', () => {
  const root = makeApp(['index.rip', '_404.rip', 'users/[id]/_404.rip', 'docs/[[page]]/_404.rip', '_lib/_404.rip']);
  expect(fromApp(root).union).toBe('"/"');
  expect(fromApp(root, '_404.rip').params).toBeNull();
  expect(fromApp(root, 'users/[id]/_404.rip').params).toBe('{ id: string }');
  expect(fromApp(root, 'docs/[[page]]/_404.rip').params).toBeNull();
  expect(fromApp(root, '_lib/_404.rip').params).toBeNull();
});

test('optional segments contribute both expansions and an optional param', () => {
  const root = makeApp(['docs/[[page]].rip']);
  const answer = fromApp(root, 'docs/[[page]].rip');
  expect(answer.union).toBe('"/docs" | `/docs/${string}`');
  expect(answer.params).toBe('{ page?: string }');
});

test('params answer only for the exact route file, in segment order', () => {
  const root = makeApp(['users/index.rip', 'users/[id].rip', 'blog/[slug]/comments/[cid].rip']);
  expect(fromApp(root, 'users/[id].rip').params).toBe('{ id: string }');
  expect(fromApp(root, 'users/index.rip').params).toBeNull();
  expect(fromApp(root, 'blog/[slug]/comments/[cid].rip').params).toBe('{ slug: string; cid: string }');
  expect(appRoutesFor(path.join(root, 'index.rip'), root).params).toBeNull();
});

test('no routes dir, or no routable files, leaves checking unarmed — null, never `never`', () => {
  const bare = makeApp([]);
  fs.rmSync(path.join(bare, 'app'), { recursive: true, force: true });
  expect(appRoutesFor(path.join(bare, 'index.rip'), bare)).toEqual({ union: null, params: null, entries: [] });

  const pageOnly = makeApp(['_layout.rip', '_404.rip']);
  expect(fromApp(pageOnly, '_404.rip')).toEqual({ union: null, params: null, entries: [] });
});

test('no anchoring project root answers unarmed', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rip-routes-noroot-')));
  made.push(dir);
  fs.writeFileSync(path.join(dir, 'stray.rip'), '');
  expect(appRoutesFor(path.join(dir, 'stray.rip'), dir)).toEqual({ union: null, params: null, entries: [] });
  expect(appRootDirFor(path.join(dir, 'stray.rip'), dir)).toBeNull();
});

test('files the runtime would reject are silently unroutable', () => {
  const root = makeApp([
    'ok.rip',
    'us[er.rip',            // marker not claiming a whole segment
    '(group).rip',          // group segment as a file name
    '[...mid]/tail.rip',    // catch-all not last
    '[id]/[id].rip',        // duplicate parameter name
    '[[a]]/[[b]].rip',      // ambiguous with itself
  ]);
  const answer = fromApp(root, 'ok.rip');
  expect(answer.union).toBe('"/ok"');
  expect(fromApp(root, '[id]/[id].rip').params).toBeNull();
});

test('two files claiming one shape dedupe instead of poisoning the union', () => {
  const root = makeApp(['(a)/x.rip', 'x.rip']);
  expect(fromApp(root, 'x.rip').union).toBe('"/x"');
});

test('entries ride in union order and dynamic members carry a display', () => {
  const root = makeApp(['index.rip', 'docs/[[page]].rip', 'users/[id].rip']);
  const { entries } = fromApp(root);
  expect(entries.map((e) => e.shape)).toEqual(['/', '/docs', '/docs/${string}', '/users/${string}']);
  expect(entries.filter((e) => e.text.startsWith('`')).map((e) => e.display))
    .toEqual(['/docs/:page', '/users/:id']);
});

test('a memo is one consistent view of the disk', () => {
  const root = makeApp(['index.rip', 'about.rip']);
  const memo = new Map();
  const before = fromApp(root, 'about.rip', memo);
  fs.rmSync(path.join(root, 'app', 'routes'), { recursive: true, force: true });
  expect(fromApp(root, 'about.rip', memo)).toEqual(before);
  expect(fromApp(root, 'about.rip').union).toBeNull();
});
