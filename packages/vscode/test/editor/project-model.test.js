// The workspace project model driven over real LSP stdio — the
// behaviors the demand-driven mirror tree adds beyond the per-buffer
// slice:
//
//   1. UNOPENED files participate: an importer resolves against a
//      dependency that materialized on demand and was never opened.
//   2. OPEN BUFFERS take precedence over disk state: an unsaved edit to
//      the dependency governs the importer's diagnostics, and a
//      dependency edit re-checks the importer without an importer edit
//      (cross-file freshness).
//   3. WATCHER: a .rip file created mid-session that an importer was
//      waiting on joins the program (TS2307 clears); deleting it brings
//      TS2307 back.
//   4. CROSS-FILE READINESS: hover crosses the file boundary — an imported
//      name reads the dependency's real type, with the range landing on
//      the importer's .rip source (positions translate across files).
//   5. REAL .ts SIBLINGS: a .rip file importing a plain TypeScript file
//      from the workspace resolves (the rootDirs merge).
//   6. USER TSCONFIG mid-session: a lib change in the workspace's
//      tsconfig.json re-governs open buffers without a restart.
//   7. DEMAND-DRIVEN SCALING (the posture pin): only the import
//      closure materializes — a workspace of hundreds of unrelated .rip
//      files contributes NOTHING to startup or the mirror tree.
//   8. PERSISTENT CACHE: a restart revalidates by source hash and
//      recompiles only what changed while the server was down; a
//      build-identity mismatch purges the whole tree. The identity spans
//      the compiler tree AND the server's own, because the manifest
//      records both the faces the compiler built and the closure edge
//      lists the server derived.
//
// Same availability guard as the other live suites: dependencies absent →
// skip; the package's `bun run test` preflight turns a missing tsgo into a
// hard failure first (tsgo-broker.test.js owns the loud skip notice).
// Fixtures and the harness wrapper live in support/project-model.mjs.
import { test, expect, describe } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  tsgoAvailable, makeWorkspace, inSession, inWorkspace, mirrorCount, isStub, faceCount, UTIL, INFERRED_UTIL, APP,
} from './support/project-model.mjs';

describe.skipIf(!tsgoAvailable)('the workspace project model', () => {
  test('an unopened dependency materializes on demand and serves', async () => {
    await inWorkspace({ 'util.rip': UTIL }, async (api) => {
      // util.rip is on disk and NEVER opened: the importer's refresh
      // pulls it into the program (the closure), and its type flows.
      await api.open('app.rip', APP);
      await api.change('app.rip', APP + '\n');
      expect(api.codes('app.rip')).not.toContain(2307); // resolves against the materialized face
      expect(api.codes('app.rip')).toContain(2339);     // its type flows
    });
  }, 30000);

  test('an open buffer takes precedence over disk, and a dependency edit re-checks the importer', async () => {
    await inWorkspace({ 'util.rip': UTIL }, async (api) => {
      // The OPEN buffer contradicts its disk face: string, not number —
      // so .toUpperCase() is legal and the importer must stay clean.
      await api.open('util.rip', 'export answer: string = "s"\n');
      await api.open('app.rip', APP);
      await api.change('app.rip', APP + '\n');
      expect(api.codes('app.rip')).not.toContain(2307);
      expect(api.codes('app.rip')).not.toContain(2339); // the unsaved edit governs

      // Edit the DEPENDENCY back to a number: the importer's TS2339 must
      // arrive without the importer being touched (cross-file freshness).
      await api.change('util.rip', UTIL);
      await api.until('app.rip', (codes) => codes.includes(2339));
    });
  }, 30000);

  test('watcher: a .rip file created mid-session joins the program; deleting it removes it', async () => {
    await inWorkspace({}, async (api) => {
      await api.open('app.rip', APP);
      expect(api.codes('app.rip')).toContain(2307); // no dependency anywhere yet

      // The dependency arrives ON DISK (create → watched-files event);
      // the importer's failed resolution marked it pending, so the event
      // pulls it into the program.
      fs.writeFileSync(path.join(api.ws, 'util.rip'), UTIL);
      api.watched([['util.rip', 1]]);
      await api.until('app.rip', (codes) => !codes.includes(2307) && codes.includes(2339));

      // And leaves (delete → watched-files event): TS2307 returns.
      fs.rmSync(path.join(api.ws, 'util.rip'));
      api.watched([['util.rip', 3]]);
      await api.until('app.rip', (codes) => codes.includes(2307));
    });
  }, 30000);

  // A package declaring vocabulary (`globalThis.NAME ??=` at top level)
  // resolves it package-wide in the editor — through the auto boundary
  // and, before anything compiles, through the stub's any-typed twin.
  // The neighbor outside the package keeps its cannot-find: the boundary
  // is the typo protection.
  test('declared globals resolve package-wide in the editor; the neighbor keeps its cannot-find', async () => {
    await inWorkspace({
      'vocab/package.json': JSON.stringify({ name: '@t/vocab' }),
      'vocab/vocab.rip': 'sh = (cmd: string): string -> cmd\nglobalThis.sh ??= sh\nexport ping = 1\n',
      'vocab/handler.rip': 'out = sh("ls")\nbad = shh("ls")\nconsole.log out, bad\n',
    }, async (api) => {
      // Cold open: vocab.rip is UNOPENED — a stub carries the declaration.
      await api.open('vocab/handler.rip', 'out = sh("ls")\nbad = shh("ls")\nconsole.log out, bad\n');
      await api.until('vocab/handler.rip', (codes) => {
        const cannotFinds = codes.filter((c) => [2304, 2552].includes(c));
        return cannotFinds.length === 1;   // exactly the typo — `sh` resolved
      });
      // Outside the package: the vocabulary does not reach.
      await api.open('other.rip', 'oops = sh("ls")\nconsole.log oops\n');
      await api.until('other.rip', (codes) => codes.some((c) => [2304, 2552].includes(c)));
    });
  }, 30000);

  test('cross-file readiness: hover crosses the file boundary onto .rip source', async () => {
    await inWorkspace({ 'util.rip': INFERRED_UTIL }, async (api) => {
      await api.open('app.rip', APP);
      await api.change('app.rip', APP + '\n');
      // Hover `answer` inside the importer's use site (line 1, `bad = answer…`).
      const hover = await api.hover('app.rip', 1, 8);
      expect(hover).not.toBeNull();
      expect(hover.contents.value).toContain('answer');
      expect(hover.contents.value).toContain('42'); // the DEPENDENCY's inferred type, across files
      expect(hover.range.start.line).toBe(1);       // …positioned on the importer's .rip source
    });
  }, 30000);

  test('a real .ts sibling import resolves through the merged roots', async () => {
    await inWorkspace({ 'helper.ts': 'export const helper = (n: number) => n * 2;\n' }, async (api) => {
      const src = 'import { helper } from "./helper.ts"\nbad = helper(1).toUpperCase()\n';
      await api.open('app.rip', src);
      await api.change('app.rip', src + '\n');
      expect(api.codes('app.rip')).not.toContain(2307); // the plain .ts file resolves
      expect(api.codes('app.rip')).toContain(2339);     // and its types flow
    });
  }, 30000);

  test('type-text literals that resemble imports do not enter the closure', async () => {
    const files = {
      'real.rip': 'export interface Thing\n  value: number\n',
      'ghost.rip': 'export ghost = 42\n',
    };
    await inWorkspace(files, async (api) => {
      const source = [
        `actual: import('./real.rip').Thing = { value: 1 }`,
        `label: "import('./ghost.rip')" = "import('./ghost.rip')"`,
        '',
      ].join('\n');
      await api.open('app.rip', source);
      await api.poll(
        () => fs.existsSync(path.join(api.ws, '.rip', 'editor', 'real.rip.ts')),
        'real import type materialized',
      );
      const realMirror = path.join(api.ws, '.rip', 'editor', 'real.rip.ts');
      const ghostMirror = path.join(api.ws, '.rip', 'editor', 'ghost.rip.ts');
      expect(isStub(fs.readFileSync(realMirror, 'utf8'))).toBe(false);
      expect(isStub(fs.readFileSync(ghostMirror, 'utf8'))).toBe(true);
      expect(faceCount(api.ws)).toBe(2); // app + the syntactic import type
    });
  }, 30000);

  test('a workspace tsconfig change mid-session re-governs open buffers', async () => {
    const noDom = JSON.stringify({ compilerOptions: { target: 'es2023', module: 'esnext', lib: ['es2023'] } });
    const withDom = JSON.stringify({ compilerOptions: { target: 'es2023', module: 'esnext', lib: ['es2023', 'dom'] } });
    await inWorkspace({ 'tsconfig.json': noDom }, async (api) => {
      await api.open('env.rip', 'doc = document.title\n');
      expect(api.has('env.rip', /Cannot find name 'document'/)).toBe(true); // your lib omits dom

      fs.writeFileSync(path.join(api.ws, 'tsconfig.json'), withDom);
      api.watched([['tsconfig.json', 2]]);
      await api.until('env.rip', (codes) => codes.length === 0); // dom now in your lib
    });
  }, 30000);

  test('demand-driven: only the import closure COMPILES, however large the workspace', async () => {
    // 200 unrelated .rip files + a 3-file chain: app → a → b. The
    // compiled program is the chain; the 200 are auto-import candidates
    // and cost a source scan and a declaration line each (the scaling
    // posture: startup COMPILE work follows the closure, not the
    // workspace — candidacy is what follows the workspace).
    const files = {
      'chain/a.rip': 'import { b } from "./b.rip"\nexport a: number = b + 1\n',
      'chain/b.rip': 'export b: number = 41\n',
    };
    for (let i = 0; i < 200; i++) files[`bulk/mod${i}.rip`] = `export value${i} = ${i}\n`;
    await inWorkspace(files, async (api) => {
      const src = 'import { a } from "./chain/a.rip"\nbad = a.toUpperCase()\n';
      await api.open('app.rip', src);
      await api.change('app.rip', src + '\n');
      expect(api.codes('app.rip')).not.toContain(2307);
      expect(api.codes('app.rip')).toContain(2339); // each hop's annotation crossed

      // The structural pin: exactly the closure — app + a + b — holds a
      // compiled face. The 200 bystanders are in the tree, and in tsgo's
      // program, as stubs only; nothing compiled them.
      await api.poll(() => mirrorCount(api.ws) === 203, 'every workspace .rip has a mirror');
      expect(faceCount(api.ws)).toBe(3);
      const line = api.logs.find((l) => /closure of app\.rip: 2 compiled/.test(l));
      expect(line).toBeDefined();
    });
  }, 30000);

  test('persistent cache: a restart recompiles only what changed; a build-identity mismatch purges', async () => {
    const ws = makeWorkspace({
      'a.rip': 'import { b } from "./b.rip"\nexport a: number = b + 1\n',
      'b.rip': 'export b: number = 41\n',
    });
    try {
      const APP2 = 'import { a } from "./a.rip"\nbad = a.toUpperCase()\n';
      // Session 1: materialize the closure (a + b compile fresh).
      await inSession(ws, async (api) => {
        await api.open('app.rip', APP2);
        await api.change('app.rip', APP2 + '\n');
        expect(api.codes('app.rip')).toContain(2339);
        expect(api.logs.some((l) => /closure of app\.rip: 2 compiled, 0 cached/.test(l))).toBe(true);
      });

      // b.rip changes while the server is DOWN.
      fs.writeFileSync(path.join(ws, 'b.rip'), 'export b: number = 43\n');

      // Session 2: revalidation recompiles ONLY b (a is fresh by hash;
      // app never existed on disk — buffer-only, so its entry leaves the
      // cache), and the closure serves from cache.
      await inSession(ws, async (api) => {
        const cacheLine = await api.untilLog(/project cache:/);
        expect(/1 face\(s\) fresh, 1 recompiled, 1 removed/.test(cacheLine)).toBe(true);
        await api.open('app.rip', APP2);
        await api.change('app.rip', APP2 + '\n');
        expect(api.codes('app.rip')).toContain(2339);
        // The closure was already materialized by revalidation — the
        // refresh compiles NOTHING beyond the buffer itself.
        expect(api.logs.some((l) => /closure of app\.rip: [1-9]\d* compiled/.test(l))).toBe(false);
      });

      // A DIFFERENT BUILD recorded the cache → the whole tree purges. The
      // key spans the compiler tree AND the server's own: every face was
      // produced by a compiler that no longer exists here, and every
      // recorded import list by a closure walk that may no longer agree
      // about which spellings are edges.
      const manifestPath = path.join(ws, '.rip', 'editor', '.cache.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      expect(manifest.cacheIdentity).toBeTruthy();     // the key is recorded under its own name
      manifest.cacheIdentity = 'stale-build';
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      await inSession(ws, async (api) => {
        // Purged at load, before any open. Counted as FACES: stub
        // population refills the tree behind the purge, and a stub carries
        // no face from any build — it is derived from the source it sits
        // beside, every session.
        expect(faceCount(ws)).toBe(0);
        await api.open('app.rip', APP2);
        await api.change('app.rip', APP2 + '\n');
        expect(api.codes('app.rip')).toContain(2339); // and rebuilt on demand
        expect(api.logs.some((l) => /closure of app\.rip: 2 compiled, 0 cached/.test(l))).toBe(true);
      });
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  }, 60000);
});
