// The config surface is REACTIVE.
//
// The claim is about a SESSION, not a window: edit package.json#rip, and an
// already-open document is re-governed — without being re-opened, re-edited,
// or reloaded. Stated as a test:
//
//   open the doc ONCE  ·  never touch it again  ·  mutate package.json
//   ·  send didChangeWatchedFiles  ·  observe the diagnostics change
//
// A server that re-read config only on a .rip edit leaves the document's
// diagnostics where they were, and every test below fails.
//
// Not covered here, and genuinely needing a live VS Code: that the window
// repaints. Everything upstream of the paint is server work.
import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { openSession } from '../support/lsp-session.js';
import { describeExtended } from '../support/extended.js';

// One unannotated param: legal rip, silent by default, TS7006 under strict.
const UNANNOTATED = 'greet = (name) -> name.toUpperCase()\ngreet "world"\n';
// One genuine type error, for the noCheck gates.
const BAD = "n: number = 'oops'\nconsole.log n\n";

const pkg = (rip) => JSON.stringify(rip ? { rip } : {}, null, 2) + '\n';

describeExtended('the config surface is reactive', () => {
  // The half a test client cannot prove by notifying: that the server ASKS
  // to be told. VS Code delivers didChangeWatchedFiles only for globs the
  // server registered, so the handler below is unreachable in a real editor
  // unless package.json is on the watch list — which is exactly the bug this
  // was (globs covered **/*.rip and **/tsconfig.json, never package.json).
  // A test client notifies regardless, so it would pass a server that never
  // registered anything. This asserts the registration itself.
  test('the server registers a watcher for package.json (else nothing notifies it)', async () => {
    const s = await openSession({ 'app.rip': UNANNOTATED, 'package.json': pkg(null) });
    try {
      const globs = await s.watchedGlobs();
      expect(globs).toContain('**/package.json');
      expect(globs).toContain('**/*.rip');           // the pre-existing ones, still there
      expect(globs).toContain('**/tsconfig.json');
    } finally { await s.close(); }
  }, 60_000);

  test('flipping rip.strict re-governs an ALREADY-OPEN doc, with no re-open', async () => {
    const s = await openSession({ 'app.rip': UNANNOTATED, 'package.json': pkg(null) });
    try {
      s.open('app.rip');                                  // the only didOpen in this test
      expect(s.codes(await s.diagnostics('app.rip'))).toEqual([]);

      s.forget('app.rip');
      s.touch('package.json', pkg({ strict: true }));

      // No didOpen. No didChange. The document is byte-identical. The
      // re-govern lands in waves, so wait for the state — an early wave
      // still reads the pre-flip posture.
      await s.diagnosticsUntil('app.rip',
        (d) => s.codes(d).includes(7006), { timeout: 75000 });
    } finally { await s.close(); }
  }, 150_000);

  test('and it reverses: dropping rip.strict re-silences the open doc', async () => {
    const s = await openSession({ 'app.rip': UNANNOTATED, 'package.json': pkg({ strict: true }) });
    try {
      s.open('app.rip');
      expect(s.codes(await s.diagnostics('app.rip'))).toContain(7006);

      s.forget('app.rip');
      s.touch('package.json', pkg(null));

      // The reverse direction matters as much: a fix that only ever ADDED
      // diagnostics on a config change would pass the test above and still
      // strand a project that turns strict back off. (The empty-set wait is
      // non-vacuous: the doc carries 7006 until the re-govern lands.)
      await s.diagnosticsUntil('app.rip',
        (d) => s.codes(d).length === 0, { timeout: 75000 });
    } finally { await s.close(); }
  }, 150_000);

  test('rip.noCheck silences an already-open file reactively', async () => {
    const s = await openSession({
      'legacy/old.rip': BAD,
      'app/new.rip': BAD,
      'package.json': pkg(null),
    });
    try {
      s.open('legacy/old.rip');
      s.open('app/new.rip');
      expect(s.codes(await s.diagnostics('legacy/old.rip'))).toContain(2322);
      expect(s.codes(await s.diagnostics('app/new.rip'))).toContain(2322);

      s.forget('legacy/old.rip');
      s.forget('app/new.rip');
      s.touch('package.json', pkg({ noCheck: ['legacy/**'] }));

      // Matched path goes quiet on the open document… (state-waited: the
      // doc carries 2322 until the re-govern lands)
      await s.diagnosticsUntil('legacy/old.rip',
        (d) => s.codes(d).length === 0, { timeout: 75000 });
      // …and the unmatched one is untouched. A noCheck that silenced
      // everything would pass a one-file test.
      expect(s.codes(await s.diagnostics('app/new.rip'))).toContain(2322);
    } finally { await s.close(); }
  }, 150_000);

  test('a cross-file re-pull cannot resurrect a silenced file', async () => {
    // Why the guard sits in repullDiagnostics() and not only refresh():
    // EDITING an open document refreshes it and then re-pulls diagnostics
    // for every other open document (repullOpenDocuments). That re-pull is
    // the only path into repullDiagnostics(). If it skipped the noCheck
    // check, a silenced file would light back up the moment anything else
    // in the session was typed in — silently undoing rip.noCheck.
    //
    // Two things this test needs in order to be able to FAIL, both learned
    // the hard way: the silenced file must carry a REAL error (an error-free
    // file has nothing to resurrect), and the trigger must be a didChange on
    // another OPEN doc (a watched-file touch never reaches the re-pull).
    const s = await openSession({
      'legacy/old.rip': "export bad: number = 'oops'\n",   // TS2322, silenced by noCheck
      'app/main.rip': "import { bad } from '../legacy/old.rip'\nconsole.log bad\n",
      'package.json': pkg({ noCheck: ['legacy/**'] }),
    });
    try {
      s.open('legacy/old.rip');
      s.open('app/main.rip');
      expect(s.codes(await s.diagnostics('legacy/old.rip'))).toEqual([]);   // silenced at rest

      // Type into the importer. This refreshes main and re-pulls old.rip.
      s.forget('legacy/old.rip');
      s.change('app/main.rip', "import { bad } from '../legacy/old.rip'\nconsole.log bad, 1\n");

      // The re-pull must not republish old.rip's TS2322.
      expect(s.codes(await s.diagnostics('legacy/old.rip'))).toEqual([]);
    } finally { await s.close(); }
  }, 90_000);

  // The HOST FLOOR is reactive through the same package.json event. The
  // floor decision lives in the GENERATED TSCONFIG (hostFloorPath —
  // mirror.js), not in per-doc presentation, so these gates catch the
  // failure the presentation gates above cannot: a handler that
  // refreshes open docs but never regenerates the tsconfig leaves the
  // floor frozen at whatever startup decided, and both tests below
  // fail. The install gate is OFFLINE by design — a fake
  // node_modules/@types/bun stands in for the real package, because the
  // gate under test probes only its existence and the `types:["*"]`
  // inclusion loads whatever d.ts it finds. The event is the one a real
  // editor genuinely delivers: `bun add -d @types/bun` REWRITES the
  // workspace package.json, which is on the watch list —
  // node_modules events themselves never arrive (VS Code's watcher
  // excludes them), and nothing in this pipeline self-watches the disk.
  const FLOOR_PROBE = 'console.log(Bun.nonsense)\n';
  const UNRESOLVED_BUN = [2304, 2580, 2867, 2868]; // "cannot find name" family, per checker context

  test('installing @types retracts the floor live — the manifest edit re-governs the program', async () => {
    const s = await openSession({ 'app.rip': FLOOR_PROBE, 'package.json': pkg(null) });
    try {
      s.open('app.rip');
      // Floor active: Bun is an honest `any`; the bogus member is silent.
      expect(s.codes(await s.diagnostics('app.rip'))).toEqual([]);

      // The install, offline: the fake package lands BEFORE the manifest
      // event, exactly as `bun add` orders it.
      const typesDir = path.join(s.dir, 'node_modules', '@types', 'bun');
      fs.mkdirSync(typesDir, { recursive: true });
      fs.writeFileSync(path.join(typesDir, 'package.json'), '{ "name": "@types/bun", "version": "0.0.0", "types": "index.d.ts" }\n');
      fs.writeFileSync(path.join(typesDir, 'index.d.ts'), 'declare var Bun: { version: string };\n');

      s.forget('app.rip');
      s.touch('package.json', JSON.stringify({ devDependencies: { '@types/bun': '0.0.0' } }, null, 2) + '\n');

      // Real types govern now: the member typo surfaces, no reload. The
      // re-govern lands in waves — an early wave still reads the floor,
      // so wait for the state, not the next publication.
      await s.diagnosticsUntil('app.rip',
        (d) => s.codes(d).includes(2339), { timeout: 75000 });
    } finally { await s.close(); }
  }, 150_000);

  test('partial supply: @types/node alone keeps the Bun floor and defers process to the real types', async () => {
    // The state a half-finished uninstall leaves behind (bun's prune can
    // strand @types/node after @types/bun is removed) — and equally a
    // deliberate Node-typed project. Per-name floors make it coherent:
    // `process` at its installed truth, `Bun` still an honest `any` — a
    // single all-or-nothing floor would strand `Bun` unresolvable here.
    const s = await openSession({
      'app.rip': 'console.log(Bun.nonsense)\nconsole.log(process.madeUp)\n',
      'package.json': pkg(null),
      'node_modules/@types/node/package.json': '{ "name": "@types/node", "version": "0.0.0", "types": "index.d.ts" }\n',
      'node_modules/@types/node/index.d.ts': 'declare var process: { pid: number };\n',
    });
    try {
      s.open('app.rip');
      const codes = s.codes(await s.diagnostics('app.rip'));
      expect(codes).toContain(2339);        // process.madeUp — real @types/node governs
      expect(codes.length).toBe(1);         // Bun.nonsense — floored, silent any
    } finally { await s.close(); }
  }, 90_000);

  test('an explicit tsconfig `types` field refuses every floor — the user manifest is complete', async () => {
    // `types` is the user's complete ambient enumeration — the same
    // signal that stops the `types:["*"]` injection. A floor slipped in
    // beside `types: []` would clobber the narrowing exactly like `["*"]`
    // would, so `Bun` must stay unresolved here even though nothing on
    // disk supplies it.
    const s = await openSession({
      'app.rip': FLOOR_PROBE,
      'package.json': pkg(null),
      'tsconfig.json': '{ "compilerOptions": { "types": [] } }\n',
    });
    try {
      s.open('app.rip');
      const codes = s.codes(await s.diagnostics('app.rip'));
      expect(codes.some((c) => UNRESOLVED_BUN.includes(c))).toBe(true);
    } finally { await s.close(); }
  }, 90_000);

  test('flipping rip.strict retracts the floor live — Bun stops resolving until types are declared', async () => {
    const s = await openSession({ 'app.rip': FLOOR_PROBE, 'package.json': pkg(null) });
    try {
      s.open('app.rip');
      expect(s.codes(await s.diagnostics('app.rip'))).toEqual([]);   // floor: silent any

      s.forget('app.rip');
      s.touch('package.json', pkg({ strict: true }));

      // Strict refuses the floor: the free name stops resolving, and the
      // diagnostic points the user at @types/bun. The re-govern lands in
      // WAVES (the watched-file forward, an early re-pull, the
      // regenerated floor, the real re-pull), so wait for the STATE —
      // accepting whichever wave publishes first read a pre-re-govern
      // snapshot as the answer on a slow machine.
      await s.diagnosticsUntil('app.rip',
        (d) => s.codes(d).some((c) => UNRESOLVED_BUN.includes(c)), { timeout: 75000 });
    } finally { await s.close(); }
  }, 150_000);

  test('a NESTED project\'s tsconfig re-governs its open files mid-session — no restart', async () => {
    // The nested config is matched through the chain its WRAPPER records
    // (a per-project set — the shared root set is cleared and refilled
    // by its own builder, which is exactly how nested configs went
    // unwatched). The same trigger regenerates every wrapper, so the
    // flip reaches tsgo as wrapper Changed events and the open doc's
    // diagnostics re-pull under the new posture.
    const nested = (on) => JSON.stringify({ compilerOptions: { strictNullChecks: on } }, null, 2) + '\n';
    const s = await openSession({
      'pkg/tsconfig.json': nested(false),
      'pkg/mod.rip': 'x: number = null\nconsole.log x\n',
      'package.json': pkg(null),
    });
    try {
      s.open('pkg/mod.rip');
      // strictNullChecks off: null is assignable, the doc is clean.
      expect(s.codes(await s.diagnostics('pkg/mod.rip'))).toEqual([]);

      s.forget('pkg/mod.rip');
      s.touch('pkg/tsconfig.json', nested(true));
      // State-based, both flips: the re-govern lands in waves, and the
      // first wave's publication can predate the wrapper regeneration.
      await s.diagnosticsUntil('pkg/mod.rip',
        (d) => s.codes(d).includes(2322), { timeout: 75000 });

      // And it reverses — a fix that only ever ADDED diagnostics would
      // pass the flip above and still strand the project. (The clean
      // state is only reachable THROUGH the re-govern here — the doc
      // carries 2322 until the wrapper reverts — so waiting for [] is
      // not a vacuous absence wait.)
      s.forget('pkg/mod.rip');
      s.touch('pkg/tsconfig.json', nested(false));
      await s.diagnosticsUntil('pkg/mod.rip',
        (d) => s.codes(d).length === 0, { timeout: 75000 });
    } finally { await s.close(); }
  }, 240_000);
});
