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
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
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

// PER-PROJECT RESOLUTION: a nested package's own `tsconfig.json` governs
// ITS files, and the workspace root's governs the rest. Every other
// fixture in this package is single-package, where a flat mirror root is
// indistinguishable from a correct per-project one — which is exactly why
// the gap was invisible. `strict` is the discriminator because it changes
// an ANSWER (TS2322) rather than a setting.
//
// The EDITOR half of this gate matters on its own: `rip check` walks to
// the nearest package.json/tsconfig/.git marker for its root while the
// editor roots at the VS Code folder, so the same file could extend
// different configs in the two surfaces. Both are driven, and both are
// asserted to agree on the root file.
describe.skipIf(!tsgoAvailable)('per-project tsconfig resolution', () => {
  const monorepo = ({ rootStrict, nestedStrict }) => ({
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'preserve', noEmit: true, skipLibCheck: true, strict: rootStrict } }, null, 2),
    'package.json': '{}',
    'pkg/tsconfig.json': JSON.stringify({ compilerOptions: { strict: nestedStrict } }, null, 2),
  });
  const BAD = 'x: string = null\nconsole.log x\n';

  const drive = async (posture, fn) => {
    const ws = mkdtempSync(join(tmpdir(), 'rip-mono-'));
    for (const [rel, content] of Object.entries(monorepo(posture))) {
      const p = join(ws, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    const rootFile = join(ws, 'root.rip');
    const nestedFile = join(ws, 'pkg', 'a.rip');
    try {
      return await session(ws, async (api) => {
        await api.open(rootFile, BAD);
        await api.open(nestedFile, BAD);
        return fn(api, { rootFile, nestedFile });
      });
    } finally { rmSync(ws, { recursive: true, force: true }); }
  };

  test('a nested strict tsconfig rejects its own file; the loose root stays clean', async () => {
    const codes = await drive({ rootStrict: false, nestedStrict: true },
      (api, f) => ({ root: api.codes(f.rootFile), nested: api.codes(f.nestedFile) }));
    expect(codes.nested, 'the nested file under its own strict config').toContain(2322);
    expect(codes.root, 'the root file under the loose root config').not.toContain(2322);
  }, 40000);

  // The inverse posture, so neither answer can be the whole session's:
  // a flat mirror root answers identically in both directions.
  test('the polarity inverts with the configs — strict root, loose nested', async () => {
    const codes = await drive({ rootStrict: true, nestedStrict: false },
      (api, f) => ({ root: api.codes(f.rootFile), nested: api.codes(f.nestedFile) }));
    expect(codes.root, 'the root file under the strict root').toContain(2322);
    expect(codes.nested, 'the nested file under its own loose config').not.toContain(2322);
  }, 40000);

  // The SECOND symptom's regression guard. `rip check` walks to the
  // nearest package.json/tsconfig/.git marker for its root; the editor
  // roots at the VS Code folder. Where those differ, the same file can
  // extend a different tsconfig in each surface — invisible in a
  // single-package workspace, and invisible to either surface alone.
  // Driven here as an AGREEMENT: both are asked the same question about
  // the same two files, and their answers are compared, not assumed.
  // The row's THIRD symptom: the host floor was generated once, from the
  // workspace root, so a nested project's own strictness could not govern
  // whether ITS files see it. Each wrapper now carries its own floor,
  // emitted from that project's gate answers — asserted here by the one
  // observable difference, since `rip.strict` deactivates the floor.
  test('the host floor is per project — a nested strict package loses it while the root keeps it', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'rip-mono-floor-'));
    const files = {
      ...monorepo({ rootStrict: false, nestedStrict: false }),
      'pkg/package.json': JSON.stringify({ rip: { strict: true } }, null, 2),
    };
    for (const [rel, content] of Object.entries(files)) {
      const p = join(ws, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    const USES_HOST = 'console.log process.argv\n';
    const rootFile = join(ws, 'root.rip');
    const nestedFile = join(ws, 'pkg', 'a.rip');
    try {
      const codes = await session(ws, async (api) => {
        await api.open(rootFile, USES_HOST);
        await api.open(nestedFile, USES_HOST);
        return { root: api.codes(rootFile), nested: api.codes(nestedFile) };
      });
      // The floor carries the root: `process` is answered.
      expect(codes.root).not.toContain(2580);
      // The nested package asked for strict, so missing host types are
      // complaints there — which is only expressible with a per-project floor.
      expect(codes.nested).toContain(2580);
    } finally { rmSync(ws, { recursive: true, force: true }); }
  }, 40000);

  test('the editor and `rip check` agree on both files', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'rip-mono-agree-'));
    for (const [rel, content] of Object.entries(monorepo({ rootStrict: false, nestedStrict: true }))) {
      const p = join(ws, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    const rootFile = join(ws, 'root.rip');
    const nestedFile = join(ws, 'pkg', 'a.rip');
    writeFileSync(rootFile, BAD);
    writeFileSync(nestedFile, BAD);
    try {
      const editor = await session(ws, async (api) => {
        await api.open(rootFile, BAD);
        await api.open(nestedFile, BAD);
        return { root: api.codes(rootFile).includes(2322), nested: api.codes(nestedFile).includes(2322) };
      });
      const bin = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'bin', 'rip');
      const run = spawnSync('bun', [bin, 'check', '--json'], { cwd: ws, encoding: 'utf8', timeout: 90_000 });
      const rows = JSON.parse(run.stdout);
      const batch = {
        root: rows.some((d) => d.file === 'root.rip' && d.code === 2322),
        nested: rows.some((d) => d.file === 'pkg/a.rip' && d.code === 2322),
      };
      expect(batch).toEqual(editor);
      // ...and the agreed answer is the RIGHT one, or both surfaces could
      // agree on the flat-root behaviour and pass.
      expect(editor).toEqual({ root: false, nested: true });
    } finally { rmSync(ws, { recursive: true, force: true }); }
  }, 120000);
});
