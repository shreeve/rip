// Disk-layer hygiene of the workspace project model, driven over real
// LSP stdio: mirror-tree ownership, collision guards, and traversal
// bounds — the mirror is editor scratch and must never clobber or escape
// user territory.
//
// Same availability guard as the other live suites: dependencies absent →
// skip; the package's `bun run test` preflight turns a missing tsgo into a
// hard failure first (tsgo-broker.test.js owns the loud skip notice).
// Fixtures and the harness wrapper live in support/project-model.mjs.
import { test, expect, describe } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  tsgoAvailable, makeWorkspace, inSession, inWorkspace, isStub, UTIL, APP,
} from './support/project-model.mjs';

// Disk-layer hygiene: mirror-tree ownership, collision guards, and
// traversal bounds — the mirror is editor scratch and must never
// clobber or escape user territory.
describe.skipIf(!tsgoAvailable)('disk-layer hygiene', () => {
  const mirrorFileOf = (ws, rel) => path.join(ws, '.rip', 'editor', rel + '.ts');

  // What a PRUNE must remove is the compiled face, not every byte. A
  // workspace `.rip` is stubbed into the program at startup (the gate
  // below), so demanding an empty path after a prune would demand a state
  // stricter than the file's own starting one — the same file, untouched all
  // session, carries a stub. The closure invariant is that no compiled face
  // outlives its last importer.
  const noCompiledFace = (ws, name) => {
    const at = mirrorFileOf(ws, name);
    return !fs.existsSync(at) || isStub(fs.readFileSync(at, 'utf8'));
  };

  test('user territory: a pre-existing .rip/.gitignore survives byte-identical; ours lives in editor/', async () => {
    const USER_GITIGNORE = '# user-owned rules\neditor/\n!keep-me\n';
    await inWorkspace({ '.rip/.gitignore': USER_GITIGNORE, 'util.rip': UTIL }, async (api) => {
      await api.open('app.rip', APP); // materialization creates the tree
      expect(fs.readFileSync(path.join(api.ws, '.rip', '.gitignore'), 'utf8')).toBe(USER_GITIGNORE);
      expect(fs.readFileSync(path.join(api.ws, '.rip', 'editor', '.gitignore'), 'utf8')).toBe('*\n');
    });
  }, 30000);

  // The disk doctrine, RULED not drifted: faces are lazy, candidacy is
  // eager. The expensive thing — compiled faces, tsgo program growth —
  // stays demand-driven through the open-buffer closure. The cheap
  // thing — scan-derived name stubs — is written for the whole
  // workspace at startup, because a candidate written late is no
  // candidate at all (tsgo offers imports only from files it already
  // holds). The gates below enforce the ruling's sharp edges rather
  // than ratifying whatever startup does: writes confined to `.rip/`,
  // stub bytes declaration-only (a scan, never a compile), stubs
  // registered nowhere.
  test('territory: a workspace with no .rip source is never written to', async () => {
    await inWorkspace({ 'notes.md': '# nothing to mirror\n' }, async (api) => {
      // initialize + revalidation ran (the session helper waited for the
      // cache log), and stub population runs right behind it.
      await api.sleep(1500);
      expect(fs.existsSync(path.join(api.ws, '.rip'))).toBe(false);
    });
  }, 30000);

  // Wrappers are per-SESSION memory over per-WORKSPACE disk, and the two
  // must reconverge on a warm start: a nested project whose faces arrive
  // from CACHE never takes the compile road where the wrapper was
  // ensured, so wrapperDirs stayed empty, the root config regenerated
  // without its exclusions (two owners for every nested face), and a
  // mid-session edit to the nested tsconfig matched nothing in the
  // watcher. Disk truth is the assertion: the exclusion and the wrapper
  // must survive the cached road exactly as the compiled road left them.
  test('warm restart: a nested project\'s wrapper and the root exclusion survive a cached closure', async () => {
    const NESTED_APP = 'import { answer } from "./pkg/util.rip"\nk = answer\nconsole.log k\n';
    const ws = makeWorkspace({
      'pkg/tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }, null, 2) + '\n',
      'pkg/util.rip': UTIL,
    });
    const wrapperAt = path.join(ws, '.rip', 'editor', 'pkg', 'tsconfig.json');
    const rootExclude = () => JSON.parse(fs.readFileSync(path.join(ws, '.rip', 'editor', 'tsconfig.json'), 'utf8')).exclude ?? [];
    try {
      await inSession(ws, async (api) => {
        await api.open('app.rip', NESTED_APP);
        await api.poll(() => fs.existsSync(wrapperAt), 'wrapper written on the compile road');
        expect(rootExclude()).toContain('pkg/**');
      });
      // The cache is warm now. The second session reaches every nested
      // face by cache-hit — and must land on the same disk truth.
      await inSession(ws, async (api) => {
        await api.open('app.rip', NESTED_APP);
        await api.sleep(600); // let the cached closure settle
        expect(fs.existsSync(wrapperAt), 'wrapper survives the cached road').toBe(true);
        expect(rootExclude()).toContain('pkg/**');
      });
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  }, 60000);

  test('warm restart: a wrapper whose project lost its tsconfig while the server was down is swept', async () => {
    const NESTED_APP = 'import { answer } from "./pkg/util.rip"\nk = answer\nconsole.log k\n';
    const ws = makeWorkspace({
      'pkg/tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }, null, 2) + '\n',
      'pkg/util.rip': UTIL,
    });
    const wrapperAt = path.join(ws, '.rip', 'editor', 'pkg', 'tsconfig.json');
    try {
      await inSession(ws, async (api) => {
        await api.open('app.rip', NESTED_APP);
        await api.poll(() => fs.existsSync(wrapperAt), 'wrapper written');
      });
      // The project dissolves while the server is down: its tsconfig
      // goes, the source stays. A stale wrapper left behind would keep
      // claiming the subtree's faces with a config extending nothing.
      fs.rmSync(path.join(ws, 'pkg', 'tsconfig.json'));
      await inSession(ws, async (api) => {
        await api.open('app.rip', NESTED_APP);
        await api.poll(() => !fs.existsSync(wrapperAt), 'stale wrapper swept');
      });
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  }, 60000);

  // The wrapper road is under the same territory doctrine as the stub
  // walk: writes stay inside `.rip/`. An out-of-workspace document is the
  // shape that once escaped it — nearestTsconfig only stopped at the
  // anchor when the walk PASSED THROUGH it, so a dir outside the
  // workspace climbed to the filesystem root, found whatever
  // tsconfig.json it met, and the '..'-prefixed rel walked the wrapper
  // write out of the mirror — able to create or overwrite tsconfig.json
  // and the host floor in directories the extension does not own.
  test('territory: opening a .rip OUTSIDE the workspace writes nothing anywhere — and still serves', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-outside-'));
    const USER_TSCONFIG = '{\n  "compilerOptions": { "strict": true }\n}\n';
    try {
      // A user project ABOVE the workspace: its own tsconfig, its own file.
      fs.writeFileSync(path.join(outside, 'tsconfig.json'), USER_TSCONFIG);
      fs.writeFileSync(path.join(outside, 'lonely.rip'), 'x = 1\nconsole.log x\n');
      fs.mkdirSync(path.join(outside, 'ws'));
      await inSession(path.join(outside, 'ws'), async (api) => {
        await api.openUri('file://' + path.join(outside, 'lonely.rip'), 'x = 1\nconsole.log x\n');
        await api.sleep(800); // give a wrong wrapper write time to land
        // The user's tsconfig survives byte-identical, their dir gains
        // nothing, and the workspace's .rip/ holds only the mirror root.
        expect(fs.readFileSync(path.join(outside, 'tsconfig.json'), 'utf8')).toBe(USER_TSCONFIG);
        expect(fs.readdirSync(outside).sort()).toEqual(['lonely.rip', 'tsconfig.json', 'ws']);
        const dotRip = path.join(outside, 'ws', '.rip');
        if (fs.existsSync(dotRip)) expect(fs.readdirSync(dotRip)).toEqual(['editor']);
        expect(fs.existsSync(path.join(outside, 'ws', 'tsconfig.json'))).toBe(false);
      });
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  }, 30000);

  test('candidacy is eager, confined, and declaration-only: startup stubs the workspace inside .rip/ and registers nothing', async () => {
    await inWorkspace({ 'util.rip': UTIL, 'docs/readme.md': '# hands off\n' }, async (api) => {
      await api.untilLog(/auto-import stubs:/);
      // Territory: startup wrote inside `.rip/` and NOWHERE else — the
      // user's tree holds exactly the fixture afterward.
      const outside = [];
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.name === '.rip') continue;
          if (e.isDirectory()) walk(path.join(dir, e.name));
          else outside.push(path.relative(api.ws, path.join(dir, e.name)));
        }
      };
      walk(api.ws);
      expect(outside.sort()).toEqual(['docs/readme.md', 'util.rip']);
      // Scan, never a compile: every line of the stub is a declaration —
      // one compiled statement in these bytes and startup cost what the
      // demand-driven closure exists to refuse.
      const stub = fs.readFileSync(mirrorFileOf(api.ws, 'util.rip'), 'utf8');
      expect(stub).toContain('export declare const answer: any;');
      expect(isStub(stub)).toBe(true);
      // Registered nowhere: the manifest that `pruneClosure` and
      // `materializeClosure` both read has never heard of it, which is
      // what lets the real face land over it later.
      expect(fs.existsSync(path.join(api.ws, '.rip', 'editor', '.cache.json'))).toBe(false);
    });
  }, 30000);

  test('pruning: closing a buffer removes its mirror and its exclusive imports from the program', async () => {
    await inWorkspace({ 'util.rip': UTIL }, async (api) => {
      await api.open('app.rip', APP);
      await api.change('app.rip', APP + '\n');
      expect(fs.existsSync(mirrorFileOf(api.ws, 'util.rip'))).toBe(true);
      expect(fs.existsSync(mirrorFileOf(api.ws, 'app.rip'))).toBe(true);

      api.close('app.rip');
      await api.poll(() => !fs.existsSync(mirrorFileOf(api.ws, 'app.rip')), 'closed buffer mirror pruned');
      await api.poll(() => noCompiledFace(api.ws, 'util.rip'), 'exclusive import pruned');
    });
  }, 30000);

  test('pruning: removing an import line prunes what only it kept in', async () => {
    await inWorkspace({ 'util.rip': UTIL }, async (api) => {
      await api.open('app.rip', APP);
      await api.change('app.rip', APP + '\n');
      expect(fs.existsSync(mirrorFileOf(api.ws, 'util.rip'))).toBe(true);

      await api.change('app.rip', 'k = 1\n'); // the import line is gone
      await api.poll(() => noCompiledFace(api.ws, 'util.rip'), 'orphaned import pruned');
      expect(fs.existsSync(mirrorFileOf(api.ws, 'app.rip'))).toBe(true); // the open buffer stays
    });
  }, 30000);

  test('pruning: a shared dependency survives while any importer remains open', async () => {
    const IMPORTER = 'import { answer } from "./util.rip"\nk = answer * 2\n';
    await inWorkspace({ 'util.rip': UTIL }, async (api) => {
      await api.open('one.rip', IMPORTER);
      await api.open('two.rip', IMPORTER);
      await api.change('two.rip', IMPORTER + '\n');
      expect(fs.existsSync(mirrorFileOf(api.ws, 'util.rip'))).toBe(true);

      api.close('one.rip');
      await api.poll(() => !fs.existsSync(mirrorFileOf(api.ws, 'one.rip')), 'closed importer mirror pruned');
      await api.sleep(500); // give a wrong prune time to happen
      expect(noCompiledFace(api.ws, 'util.rip')).toBe(false); // two.rip still imports it: the real face, not a stub

      api.close('two.rip');
      await api.poll(() => noCompiledFace(api.ws, 'util.rip'), 'last importer gone → pruned');
    });
  }, 30000);

  test('crash-partial mirrors: corrupted bytes behind the cache are detected and recompiled', async () => {
    const ws = makeWorkspace({
      'a.rip': 'import { b } from "./b.rip"\nexport a: number = b + 1\n',
      'b.rip': 'export b: number = 41\n',
    });
    try {
      const APP2 = 'import { a } from "./a.rip"\nbad = a.toUpperCase()\n';
      await inSession(ws, async (api) => {
        await api.open('app.rip', APP2);
        await api.change('app.rip', APP2 + '\n');
        expect(api.codes('app.rip')).toContain(2339);
      });

      // A crash mid-write leaves partial bytes; the source is unchanged,
      // so a hash-of-source check alone would trust the mirror.
      fs.writeFileSync(path.join(ws, '.rip', 'editor', 'b.rip.ts'), 'export let b =');

      await inSession(ws, async (api) => {
        const line = await api.untilLog(/project cache:/);
        expect(/1 face\(s\) fresh, 1 recompiled, 1 removed/.test(line)).toBe(true); // b recompiled (bytes), a fresh, app buffer-only
        await api.open('app.rip', APP2);
        await api.change('app.rip', APP2 + '\n');
        expect(api.codes('app.rip')).toContain(2339); // the chain serves again
      });
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  }, 60000);

  test('types:["*"] is NOT injected when the extends chain narrows types', async () => {
    await inWorkspace({
      'base.json': JSON.stringify({ compilerOptions: { types: [] } }),
      'tsconfig.json': JSON.stringify({ extends: './base.json', compilerOptions: { target: 'es2023', module: 'esnext', lib: ['es2023'] } }),
      'node_modules/@types/probe/package.json': JSON.stringify({ name: '@types/probe', version: '1.0.0', types: 'index.d.ts' }),
      'node_modules/@types/probe/index.d.ts': 'declare const RIP_PROBE_GLOBAL: number;\n',
    }, async (api) => {
      await api.open('env.rip', 'x = RIP_PROBE_GLOBAL + 1\n');
      // The BASE config narrowed types to none; injecting ["*"] would
      // clobber that, so the global must stay unknown.
      expect(api.has('env.rip', /Cannot find name 'RIP_PROBE_GLOBAL'/)).toBe(true);
      const generated = fs.readFileSync(path.join(api.ws, '.rip', 'editor', 'tsconfig.json'), 'utf8');
      expect(generated.includes('"types"')).toBe(false);
    });
  }, 30000);

  test('mirror collisions are detected and warned loudly (the __external__ sanitization case)', async () => {
    await inWorkspace({}, async (api) => {
      // Two distinct non-file URIs whose sanitization coincides.
      await api.openUri('untitled:x y.rip', 'a = 1\n');
      await api.openUri('untitled:x_y.rip', 'b = 2\n');
      await api.poll(() => api.logs.some((l) => l.includes('mirror collision')), 'collision warning logged');
    });
  }, 30000);

  test('closure traversal outside the workspace truncates loudly', async () => {
    await inWorkspace({}, async (api) => {
      const src = 'import { x } from "../../../../outside-the-workspace.rip"\nk = x\n';
      await api.open('app.rip', src);
      await api.change('app.rip', src + '\n');
      await api.poll(() => api.logs.some((l) => l.includes('closure truncated')), 'truncation logged');
      expect(api.codes('app.rip')).toContain(2307); // honestly unresolved
    });
  }, 30000);

  test('stdlib imports materialize through the fence — rip/<pkg> is mapped, so it must resolve', async () => {
    await inWorkspace({}, async (api) => {
      const src = 'import { check } from "rip/validate"\nk = check("1", "int")\n';
      await api.open('app.rip', src);
      await api.change('app.rip', src + '\n');
      // The generated tsconfig maps rip/validate to an __external__ face;
      // the closure walk must actually write that face (the workspace
      // fence exempts the stdlib) or the import squiggles TS2307 forever.
      await api.poll(() => !api.codes('app.rip').includes(2307), 'rip/validate resolves');
    });
  }, 30000);

  test('a source the closure compiled from disk and then opened in the editor has one owner — no collision', async () => {
    // The closure compile names a.rip by filesystem path, didOpen by
    // URI. One file, two spellings; the collision guard exists for two
    // DIFFERENT sources landing on one mirror.
    await inWorkspace({ 'a.rip': 'export a: number = 41\n' }, async (api) => {
      const APP = 'import { a } from "./a.rip"\nbad = a.toUpperCase()\n';
      await api.open('app.rip', APP);
      await api.until('app.rip', (codes) => codes.includes(2339)); // a.rip's face is on disk
      await api.open('a.rip', 'export a: number = 41\n');
      await api.change('a.rip', 'export a: number = 42\n');
      expect(api.logs.filter((l) => /mirror collision/.test(l))).toEqual([]);
    });
  }, 30000);

  test('a restart keeps the stubs it wrote: nothing swept, nothing rewritten; a stale stub is re-derived, a sourceless one swept', async () => {
    const ws = makeWorkspace({ 'util.rip': UTIL, 'b.rip': 'export b: number = 1\n', 'c.rip': 'export c: number = 2\n' });
    try {
      // Session 1: util's face through the closure; b and c as stubs.
      await inSession(ws, async (api) => {
        await api.open('app.rip', APP);
        await api.untilLog(/auto-import stubs:/);
        await api.until('app.rip', (codes) => codes.includes(2339));
      });
      const stubB = path.join(ws, '.rip', 'editor', 'b.rip.ts');
      const stubC = path.join(ws, '.rip', 'editor', 'c.rip.ts');
      const inoB = fs.statSync(stubB).ino;

      // Session 2: a stub is manifest-less by design, not an orphan.
      await inSession(ws, async (api) => {
        await api.sleep(1000); // past the (backgrounded) population pass
        expect(api.logs.filter((l) => /orphan mirror sweep|auto-import stubs:/.test(l))).toEqual([]);
        expect(fs.statSync(stubB).ino).toBe(inoB);
      });

      // While the server is down: b's exports change, c is deleted.
      fs.writeFileSync(path.join(ws, 'b.rip'), 'export b2: number = 1\n');
      fs.rmSync(path.join(ws, 'c.rip'));

      // Session 3: both stale stubs are swept; b's is re-derived, c's is gone.
      await inSession(ws, async (api) => {
        expect(api.logs.some((l) => /orphan mirror sweep: 2 /.test(l))).toBe(true);
        await api.untilLog(/auto-import stubs: 1 /);
        await api.poll(() => fs.readFileSync(stubB, 'utf8').includes('export declare const b2: any;'), 'b re-stubbed');
        expect(fs.existsSync(stubC)).toBe(false);
      });
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  }, 30000);
});
