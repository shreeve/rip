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

      // No didOpen. No didChange. The document is byte-identical.
      const after = s.codes(await s.diagnostics('app.rip'));
      expect(after).toContain(7006);                      // strict now governs the open doc
    } finally { await s.close(); }
  }, 60_000);

  test('and it reverses: dropping rip.strict re-silences the open doc', async () => {
    const s = await openSession({ 'app.rip': UNANNOTATED, 'package.json': pkg({ strict: true }) });
    try {
      s.open('app.rip');
      expect(s.codes(await s.diagnostics('app.rip'))).toContain(7006);

      s.forget('app.rip');
      s.touch('package.json', pkg(null));

      // The reverse direction matters as much: a fix that only ever ADDED
      // diagnostics on a config change would pass the test above and still
      // strand a project that turns strict back off.
      expect(s.codes(await s.diagnostics('app.rip'))).toEqual([]);
    } finally { await s.close(); }
  }, 60_000);

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

      // Matched path goes quiet on the open document…
      expect(s.codes(await s.diagnostics('legacy/old.rip'))).toEqual([]);
      // …and the unmatched one is untouched. A noCheck that silenced
      // everything would pass a one-file test.
      expect(s.codes(await s.diagnostics('app/new.rip'))).toContain(2322);
    } finally { await s.close(); }
  }, 90_000);

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
});
