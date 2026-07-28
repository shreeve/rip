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
//      compiler-hash mismatch purges the whole tree.
//
// Same availability guard as the other live suites: dependencies absent →
// skip; the package's `bun run test` preflight turns a missing tsgo into a
// hard failure first (tsgo-broker.test.js owns the loud skip notice).
import { test, expect, describe } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tsgoAvailable = false;
try {
  const { tsgoBinaryPath } = await import('../src/tsgo.js');
  tsgoBinaryPath();
  tsgoAvailable = true;
} catch { /* dependencies not installed */ }

const SERVER = path.resolve(import.meta.dir, '..', 'src', 'server.js');

function makeWorkspace(files) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-pm-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(ws, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return ws;
}

// One live server session over a real workspace directory. The api
// extends the gaps harness with hover, watched-files notifications, and
// the server's log lines; `initialized` resolves after the cache
// revalidation log line arrives (startup complete).
async function inSession(ws, fn) {
  const { LspClient } = await import('../src/tsgo.js');
  const published = [];
  const logs = [];
  const client = new LspClient('bun', [SERVER, '--stdio'], {
    onNotification: (m, p) => {
      if (m === 'textDocument/publishDiagnostics') published.push(p);
      if (m === 'window/logMessage') logs.push(p.message);
    },
  });
  const uriOf = (rel) => 'file://' + path.join(ws, rel);
  const latest = (rel) => {
    const u = uriOf(rel);
    for (let i = published.length - 1; i >= 0; i--) if (published[i].uri === u) return published[i];
    return null;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function awaitPublish(rel, sinceLen) {
    const u = uriOf(rel);
    for (let i = 0; i < 60; i++) {
      for (let j = published.length - 1; j >= sinceLen; j--) {
        if (published[j].uri === u) { await sleep(120); return; }
      }
      await sleep(100);
    }
    throw new Error(`no publishDiagnostics for ${rel} arrived`);
  }
  const versions = new Map();
  const api = {
    ws,
    logs,
    uriOf,
    sleep,
    async open(rel, text) {
      const before = published.length;
      versions.set(rel, 1);
      client.notify('textDocument/didOpen', { textDocument: { uri: uriOf(rel), languageId: 'rip', version: 1, text } });
      await awaitPublish(rel, before);
    },
    close(rel) {
      client.notify('textDocument/didClose', { textDocument: { uri: uriOf(rel) } });
    },
    // Open a document by RAW uri (non-file schemes — the __external__ path).
    async openUri(uri, text) {
      const before = published.length;
      client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'rip', version: 1, text } });
      for (let i = 0; i < 60; i++) {
        for (let j = published.length - 1; j >= before; j--) {
          if (published[j].uri === uri) { await sleep(120); return; }
        }
        await sleep(100);
      }
      throw new Error(`no publishDiagnostics for ${uri} arrived`);
    },
    // Poll until `fn()` is truthy (async prunes land off the request path).
    async poll(fn, what) {
      for (let i = 0; i < 60; i++) {
        if (fn()) return;
        await sleep(150);
      }
      throw new Error(`condition never held: ${what}`);
    },
    async change(rel, text) {
      const before = published.length;
      const v = (versions.get(rel) || 1) + 1;
      versions.set(rel, v);
      client.notify('textDocument/didChange', { textDocument: { uri: uriOf(rel), version: v }, contentChanges: [{ text }] });
      await awaitPublish(rel, before);
    },
    watched(changes) {
      client.notify('workspace/didChangeWatchedFiles', {
        changes: changes.map(([rel, type]) => ({ uri: uriOf(rel), type })),
      });
    },
    codes(rel) {
      return (latest(rel)?.diagnostics ?? []).map((d) => d.code).filter((c) => c !== 6133 && c !== 6199);
    },
    has(rel, re) { return (latest(rel)?.diagnostics ?? []).some((d) => re.test(d.message)); },
    hover(rel, line, character) {
      return client.request('textDocument/hover', { textDocument: { uri: uriOf(rel) }, position: { line, character } });
    },
    // Wait until `pred(codes)` holds for `rel` — cross-file re-checks
    // land asynchronously after watched-file events.
    async until(rel, pred) {
      for (let i = 0; i < 60; i++) {
        if (pred(api.codes(rel))) return;
        await sleep(150);
      }
      throw new Error(`condition never held for ${rel}; last codes ${JSON.stringify(api.codes(rel))}`);
    },
    async untilLog(re) {
      for (let i = 0; i < 60; i++) {
        const line = logs.find((l) => re.test(l));
        if (line) return line;
        await sleep(100);
      }
      throw new Error(`no log line matching ${re}; got:\n${logs.join('\n')}`);
    },
  };
  try {
    await client.request('initialize', { processId: process.pid, rootUri: 'file://' + ws, capabilities: {} });
    client.notify('initialized', {});
    await api.untilLog(/project cache:/); // startup revalidation complete
    return await fn(api);
  } finally {
    await client.stop();
  }
}

// Convenience: one session over a fresh workspace, torn down after.
async function inWorkspace(files, fn) {
  const ws = makeWorkspace(files);
  try {
    return await inSession(ws, fn);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
}

// Count the .rip mirrors materialized in a workspace's tree.
const mirrorCount = (ws) => {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (e.name.endsWith('.rip.ts')) out.push(path.join(dir, e.name));
    }
  };
  walk(path.join(ws, '.rip', 'editor'));
  return out.length;
};

const UTIL = 'export answer = 42\n';
const APP = 'import { answer } from "./util.rip"\nbad = answer.toUpperCase()\n';

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
      await api.open('util.rip', 'export answer = "s"\n');
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

  test('cross-file readiness: hover crosses the file boundary onto .rip source', async () => {
    await inWorkspace({ 'util.rip': UTIL }, async (api) => {
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

  test('demand-driven: only the import closure materializes, however large the workspace', async () => {
    // 200 unrelated .rip files + a 3-file chain: app → a → b. The
    // program is the chain; the 200 contribute nothing (the scaling
    // posture: startup work follows the closure, not the workspace).
    const files = {
      'chain/a.rip': 'import { b } from "./b.rip"\nexport a = b + 1\n',
      'chain/b.rip': 'export b = 41\n',
    };
    for (let i = 0; i < 200; i++) files[`bulk/mod${i}.rip`] = `export value${i} = ${i}\n`;
    await inWorkspace(files, async (api) => {
      const src = 'import { a } from "./chain/a.rip"\nbad = a.toUpperCase()\n';
      await api.open('app.rip', src);
      await api.change('app.rip', src + '\n');
      expect(api.codes('app.rip')).not.toContain(2307);
      expect(api.codes('app.rip')).toContain(2339); // the type crossed BOTH hops

      // The structural pin: the mirror tree holds exactly the closure —
      // app + a + b — never the 200 bystanders.
      expect(mirrorCount(api.ws)).toBe(3);
      const line = api.logs.find((l) => /closure of app\.rip: 2 compiled/.test(l));
      expect(line).toBeDefined();
    });
  }, 30000);

  test('persistent cache: a restart recompiles only what changed; a compiler-hash mismatch purges', async () => {
    const ws = makeWorkspace({
      'a.rip': 'import { b } from "./b.rip"\nexport a = b + 1\n',
      'b.rip': 'export b = 41\n',
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
      fs.writeFileSync(path.join(ws, 'b.rip'), 'export b = 43\n');

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

      // A DIFFERENT COMPILER recorded the cache → the whole tree purges
      // (every face was produced by a build that no longer exists here).
      const manifestPath = path.join(ws, '.rip', 'editor', '.cache.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.compilerHash = 'stale-compiler-build';
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      await inSession(ws, async (api) => {
        expect(mirrorCount(ws)).toBe(0); // purged at load, before any open
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

// Disk-layer hygiene: mirror-tree ownership, collision guards, and
// traversal bounds — the mirror is editor scratch and must never
// clobber or escape user territory.
describe.skipIf(!tsgoAvailable)('disk-layer hygiene', () => {
  const mirrorFileOf = (ws, rel) => path.join(ws, '.rip', 'editor', rel + '.ts');

  test('user territory: a pre-existing .rip/.gitignore survives byte-identical; ours lives in editor/', async () => {
    const USER_GITIGNORE = '# user-owned rules\neditor/\n!keep-me\n';
    await inWorkspace({ '.rip/.gitignore': USER_GITIGNORE, 'util.rip': UTIL }, async (api) => {
      await api.open('app.rip', APP); // materialization creates the tree
      expect(fs.readFileSync(path.join(api.ws, '.rip', '.gitignore'), 'utf8')).toBe(USER_GITIGNORE);
      expect(fs.readFileSync(path.join(api.ws, '.rip', 'editor', '.gitignore'), 'utf8')).toBe('*\n');
    });
  }, 30000);

  test('lazy creation: a session that never opens a .rip document leaves the workspace untouched', async () => {
    await inWorkspace({ 'util.rip': UTIL }, async (api) => {
      // initialize + revalidation ran (the session helper waited for the
      // cache log); nothing was opened — no .rip/ tree may exist.
      expect(fs.existsSync(path.join(api.ws, '.rip'))).toBe(false);
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
      await api.poll(() => !fs.existsSync(mirrorFileOf(api.ws, 'util.rip')), 'exclusive import pruned');
    });
  }, 30000);

  test('pruning: removing an import line prunes what only it kept in', async () => {
    await inWorkspace({ 'util.rip': UTIL }, async (api) => {
      await api.open('app.rip', APP);
      await api.change('app.rip', APP + '\n');
      expect(fs.existsSync(mirrorFileOf(api.ws, 'util.rip'))).toBe(true);

      await api.change('app.rip', 'k = 1\n'); // the import line is gone
      await api.poll(() => !fs.existsSync(mirrorFileOf(api.ws, 'util.rip')), 'orphaned import pruned');
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
      expect(fs.existsSync(mirrorFileOf(api.ws, 'util.rip'))).toBe(true); // two.rip still imports it

      api.close('two.rip');
      await api.poll(() => !fs.existsSync(mirrorFileOf(api.ws, 'util.rip')), 'last importer gone → pruned');
    });
  }, 30000);

  test('crash-partial mirrors: corrupted bytes behind the cache are detected and recompiled', async () => {
    const ws = makeWorkspace({
      'a.rip': 'import { b } from "./b.rip"\nexport a = b + 1\n',
      'b.rip': 'export b = 41\n',
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
});

// The module marker driven end-to-end: two PLAIN buffers (no
// imports/exports) share one tsgo program — without the
// marker both faces are global scripts and every shared top-level
// name draws a false TS2451 in both files, which also starves the
// write-site hover enrichment (references answer [] under the
// collision and the memo stores the null). Plus the restart shape
// (the persisted closure re-materializes without collisions) and the
// orphan-mirror startup sweep.
describe.skipIf(!tsgoAvailable)('the module marker over LSP', () => {
  // Shared top-level names across both files; `total` is unannotated
  // (evolving-let) with a read, so the write-site hover exercises the
  // enrichment path.
  const PLAIN = 'count: number = 0\nratio: number = 3.14\ntotal = count + ratio\ntotal.toFixed(2)\n';

  test('two plain buffers: zero TS2451 on both; write-site hover answers the evolved type memo-cold', async () => {
    await inWorkspace({}, async (api) => {
      await api.open('one.rip', PLAIN);
      await api.open('two.rip', PLAIN);
      expect(api.codes('one.rip')).toEqual([]);
      expect(api.codes('two.rip')).toEqual([]);

      // The FIRST hover ask with both buffers open — the memo-cold
      // condition under which the collision used to store null and
      // present `let total: any` forever.
      const hover = await api.hover('one.rip', 2, 2);
      expect(hover).not.toBeNull();
      expect(hover.contents.value).toContain('let total: number');
      expect(hover.contents.value).not.toContain('any');
      const twin = await api.hover('two.rip', 2, 2);
      expect(twin.contents.value).toContain('let total: number');
    });
  }, 30000);

  test('restart: the persisted closure re-materializes clean — reopen ONE file, no TS2451, hover intact', async () => {
    const ws = makeWorkspace({ 'one.rip': PLAIN, 'two.rip': PLAIN });
    try {
      // Session 1: both open; the server dies WITHOUT didClose (the
      // persisted closure survives restarts by design).
      await inSession(ws, async (api) => {
        await api.open('one.rip', PLAIN);
        await api.open('two.rip', PLAIN);
        expect(api.codes('one.rip')).toEqual([]);
        expect(api.codes('two.rip')).toEqual([]);
      });

      // Session 2: revalidation re-materializes BOTH mirrors; only
      // one buffer reopens — the other rides as an unopened closure
      // member. One buffer open is all the collision ever needed.
      await inSession(ws, async (api) => {
        await api.open('one.rip', PLAIN);
        expect(api.codes('one.rip')).toEqual([]);
        const hover = await api.hover('one.rip', 2, 2);
        expect(hover.contents.value).toContain('let total: number');
        expect(hover.contents.value).not.toContain('any');
      });
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  }, 60000);

  test('orphan mirrors: a planted manifest-less mirror is swept at startup and never rejoins the program', async () => {
    const ws = makeWorkspace({ 'app.rip': PLAIN });
    try {
      // Session 1 materializes app.rip's mirror and records its
      // manifest entry.
      await inSession(ws, async (api) => {
        await api.open('app.rip', PLAIN);
        expect(api.codes('app.rip')).toEqual([]);
      });

      // The orphan: a mirror file with NO manifest entry (the crash-
      // before-the-debounced-manifest-save shape). Its bogus global-
      // script bytes would join the program through the include glob.
      const ghost = path.join(ws, '.rip', 'editor', 'ghost.rip.ts');
      fs.writeFileSync(ghost, 'let count: string = 42;\n');
      // The __external__ subtree is exempt: non-file URIs mirror
      // there with no manifest entry BY DESIGN — manifest-lessness
      // is their normal state, not orphanhood.
      const external = path.join(ws, '.rip', 'editor', '__external__', 'untitled_x.rip.ts');
      fs.mkdirSync(path.dirname(external), { recursive: true });
      fs.writeFileSync(external, 'let scratch;\nscratch = 1;\nconsole.log(scratch);\nexport {};\n');

      // Session 2: the sweep removes the orphan before the program
      // serves; the legitimate mirror and the __external__ mirror
      // stay; the reopened buffer is clean.
      await inSession(ws, async (api) => {
        expect(fs.existsSync(ghost)).toBe(false);
        expect(fs.existsSync(external)).toBe(true);
        expect(api.logs.some((l) => /orphan mirror sweep: 1 /.test(l))).toBe(true);
        expect(fs.existsSync(path.join(ws, '.rip', 'editor', 'app.rip.ts'))).toBe(true);
        await api.open('app.rip', PLAIN);
        expect(api.codes('app.rip')).toEqual([]);
      });
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  }, 60000);
});

// Workspace ambient declarations join the program: an augmentation the
// project declares (a prototype extension's interface, a window field)
// governs in the editor exactly as it does under a workspace-root tsc
// run — and the compiler's own augmentation line makes an ANNOTATED
// prototype member self-sufficient, no ambient file needed.
describe.skipIf(!tsgoAvailable)('workspace ambient .d.ts and prototype augmentation', () => {
  test('a workspace .d.ts augmentation governs: the patched method is a known member', async () => {
    await inWorkspace({ 'rip-env.d.ts': 'interface String { shout(): string }\n' }, async (api) => {
      await api.open('app.rip', 'String.prototype.shout = -> @toUpperCase() + "!"\nout = "hi".shout()\n');
      await api.until('app.rip', (codes) => !codes.includes(2339));
      // The d.ts widened one interface, not the checking: a real typo
      // still reports.
      await api.change('app.rip', 'bad = "hi".missing()\n');
      await api.until('app.rip', (codes) => codes.includes(2339));
    });
  }, 30000);

  test('an annotated prototype member is self-sufficient: the face augments, the editor resolves', async () => {
    await inWorkspace({}, async (api) => {
      await api.open('app.rip', 'String::cap: () => string = -> @charAt(0).toUpperCase()\nout = "hi".cap()\n');
      await api.until('app.rip', (codes) => !codes.includes(2339) && !codes.includes(2304));
    });
  }, 30000);
});

// Importing a plain .js module is legal, idiomatic Rip — the
// no-declaration-file complaint (TS7016) is implicit-any-family noise
// on exactly that pattern and never publishes.
describe.skipIf(!tsgoAvailable)('untyped .js imports stay quiet', () => {
  test('a .rip importing a sibling .js draws no 7016; real errors still report', async () => {
    await inWorkspace({ 'util.js': 'export const shout = (s) => s.toUpperCase();\n' }, async (api) => {
      await api.open('app.rip', 'import { shout } from "./util.js"\nout = shout("hi")\n');
      await api.until('app.rip', (codes) => !codes.includes(7016) && !codes.includes(2307));
      // The import types as `any` under the gradual posture — a WRONG
      // use elsewhere still reports through the real error classes.
      await api.change('app.rip', 'import { shout } from "./util.js"\nn: number = "not a number"\n');
      await api.until('app.rip', (codes) => codes.includes(2322));
    });
  }, 30000);
});
