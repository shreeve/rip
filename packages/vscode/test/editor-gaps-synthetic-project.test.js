// REGRESSION GUARD (gap 2 of Philip Lindberg's editor-gaps bundle,
// relocated from editor-gaps/ into this package per the repo's test
// boundary): the editor behaves like a standard TypeScript project. A
// lone `.ts` file gets an inferred project with a default lib, the
// `@types` packages in the workspace's `node_modules/@types`, and
// upgrades to the workspace `tsconfig.json` if one is present. The
// guarded failure mode: a FIXED synthetic project in a temp dir that
// reads neither — the workspace `tsconfig` and the installed `@types`
// both invisible. The workspace-rooted project config (mirror config extends
// the user's tsconfig; types:["*"] restores the visible-@types
// enumeration TS 6/7 dropped) is what keeps this green.
//
// This is `.ts`-parity, and it is dependency-clean — rip reads the consumer's
// `@types`, it never ships its own. The one conscious trade: a bare file
// with no `@types/bun` won't get Bun globals — exactly like a lone
// `.ts`. So these tests assert the standard TS behaviors, using a real
// workspace (tsconfig + installed @types) so a failing symptom proves
// the server ignores it.
//
// Skips when tsgo is unavailable; the package's `bun run test` runs a
// preflight that turns a missing binary into a hard failure first, and
// the repo's root suite excludes packages/** mechanically. Driven
// through the real src/server.js (see support/gaps-server.mjs).
import { test, expect, describe } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { tsgoAvailable, session } from './support/gaps-server.mjs';

// Set up a REAL workspace dir with the given files, open `ripSrc` as a.rip
// inside it (rootUri = the dir), and return fn(api, ripPath). `files` maps
// relative paths (e.g. `tsconfig.json`, `node_modules/@types/probe/index.d.ts`)
// to contents — the config the server reads when it behaves like TS.
async function inWorkspace(files, ripSrc, fn) {
  const ws = mkdtempSync(join(tmpdir(), 'rip-ws-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(ws, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  const file = join(ws, 'a.rip');
  try {
    return await session(ws, async (api) => {
      await api.open(file, ripSrc);
      return fn(api, file);
    });
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
}

// A workspace tsconfig with lib es2023 (no `dom`).
const ES2023 = { 'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'es2023', module: 'esnext', lib: ['es2023'] } }, null, 2) };
// A workspace with an installed @types package declaring a global — the
// classic visible-@types enumeration serves it with no tsconfig needed.
const PROBE_TYPES = {
  'node_modules/@types/probe/package.json': JSON.stringify({ name: '@types/probe', version: '1.0.0', types: 'index.d.ts' }),
  'node_modules/@types/probe/index.d.ts': 'declare const RIP_PROBE_GLOBAL: number;\n',
};

describe.skipIf(!tsgoAvailable)('the editor behaves like a standard TS project', () => {
  // Your tsconfig sets lib es2023 (no dom). `document` is a DOM global,
  // so it errors — your lib governs, dom is not forced in over it.
  test('your tsconfig governs: DOM is not forced in when your lib omits it', async () => {
    const documentErrors = await inWorkspace(ES2023, 'doc = document.title\n',
      (api, f) => api.has(f, /Cannot find name 'document'/));
    expect(documentErrors).toBe(true); // a fixed dom-forcing config would resolve it
  }, 30000);

  // es2023 has `findLast`, so your es2023 project type-checks it clean.
  test('your tsconfig governs: es2023 APIs type-check when your lib enables them', async () => {
    const findLastErrors = await inWorkspace(ES2023, 'last = [1, 2].findLast((n) -> n > 1)\n',
      (api, f) => api.has(f, /findLast.*does not exist/));
    expect(findLastErrors).toBe(false); // a fixed es2022-pinned config would reject it
  }, 30000);

  // Your workspace has an @types package installed. Its global resolves
  // with no tsconfig at all. (This is the `@types/bun` case in general
  // form: the server discovers your installed types.)
  test('your @types resolve: an installed @types global is discovered', async () => {
    const probeUnknown = await inWorkspace(PROBE_TYPES, 'x = RIP_PROBE_GLOBAL + 1\n',
      (api, f) => api.has(f, /Cannot find name 'RIP_PROBE_GLOBAL'/));
    expect(probeUnknown).toBe(false); // a synthetic temp root would have no view of node_modules
  }, 30000);
});
