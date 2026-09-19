// The workspace project model's closure behaviors driven over real LSP
// stdio: the active closure across a preview-tab swap, the module marker
// end-to-end (two plain buffers share one program without a false
// TS2451), workspace ambient .d.ts and prototype augmentation, and
// untyped .js imports staying quiet.
//
// Same availability guard as the other live suites: dependencies absent →
// skip; the package's `bun run test` preflight turns a missing tsgo into a
// hard failure first (tsgo-broker.test.js owns the loud skip notice).
// Fixtures and the harness wrapper live in support/project-model.mjs.
import { test, expect, describe } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  tsgoAvailable, makeWorkspace, inSession, inWorkspace,
} from './support/project-model.mjs';

// The active closure is the open buffers' RECORDED imports, and a
// buffer opened inside the last debounce window has recorded none yet.
// A preview tab closes the previous file in the same instant it opens
// the next — the shape a single click in the Explorer sends.
describe.skipIf(!tsgoAvailable)('the closure across a preview-tab swap', () => {
  const USES_APP = (name) => `import { source } from 'rip/app'\n\nexport ${name} =\n  user: source fetch: -> Promise.resolve { name: 'Ada' }\n  count: 0\n`;

  // The app runtime's faces, by inode: a delete-and-rewrite changes them.
  const inodesOf = (ws) => {
    const out = new Map();
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.set(p, fs.statSync(p).ino); } };
    walk(path.join(ws, '.rip', 'editor', '__external__'));
    return out;
  };

  // a.rip is open and clean; `swap` sends the close of a.rip and the open
  // of b.rip in the order under test, with no wait between them.
  const swapKeepsTheFaces = (swap) => inWorkspace({}, async (api) => {
    await api.open('a.rip', USES_APP('a'));
    await api.until('a.rip', (codes) => !codes.includes(2307));
    const before = inodesOf(api.ws);
    expect(before.size).toBeGreaterThan(0);
    const mark = api.publishedCount;
    swap(api);
    await api.poll(() => api.publishesSince('b.rip', mark).length > 0, 'b.rip published');
    // The FIRST answer is the one the user sees flash.
    const first = api.publishesSince('b.rip', mark)[0].diagnostics.map((d) => d.code);
    expect(first).not.toContain(2307);
    // Structural: the faces never left the program. a.rip did — it is
    // the one thing the prune has to reconcile, and it re-stubs in place.
    await api.poll(() => api.logs.some((l) => /closure pruned: 1 mirror/.test(l)), 'a.rip left the program');
    expect(inodesOf(api.ws)).toEqual(before);
  });

  test('the next buffer opens as the previous one closes: nothing the next one imports is dropped', async () => {
    await swapKeepsTheFaces((api) => { api.openNoWait('b.rip', USES_APP('b')); api.close('a.rip'); });
  }, 30000);

  // The order VS Code sends: the replaced editor is disposed inside the
  // open call, and the next document's model waits on a file read.
  test('the previous buffer closes before the next one opens: nothing the next one imports is dropped', async () => {
    await swapKeepsTheFaces((api) => { api.close('a.rip'); api.openNoWait('b.rip', USES_APP('b')); });
  }, 30000);

  // The property the swap rests on: a stdlib face outlives its last
  // importer. Only the importer leaves the program.
  test('closing the last importer of rip/app prunes the importer alone; the stdlib faces stay', async () => {
    await inWorkspace({}, async (api) => {
      await api.open('a.rip', USES_APP('a'));
      await api.until('a.rip', (codes) => !codes.includes(2307));
      const before = inodesOf(api.ws);
      expect(before.size).toBeGreaterThan(0);
      api.close('a.rip');
      await api.poll(() => api.logs.some((l) => /closure pruned: 1 mirror/.test(l)), 'a.rip left the program');
      expect(inodesOf(api.ws)).toEqual(before);
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
      // The d.ts widened one interface, not the checking: on a checked
      // line (the annotation gates it on), a real typo still reports.
      await api.change('app.rip', 'bad: string = "hi".missing()\n');
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
