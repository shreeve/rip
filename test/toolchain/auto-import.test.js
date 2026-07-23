// Auto-import candidate scope: the candidate set is the tsgo program, and the
// program is the mirror closure of the OPEN buffers — so a workspace `.rip`
// that nothing open imports is not offered until you open or import it. The
// headline case of auto-import (import from a file you have not opened) is
// therefore defeated for `.rip` → `.rip`. npm/@types candidates are
// unaffected: they arrive via node_modules, which the generated tsconfig
// reaches.
//
// This is an OPEN gap, so the second test asserts the current, wrong behavior
// on purpose — and says so. The day the scope is widened, `not.toContain`
// goes red: that is the cue to invert this test and close the finding, not a
// regression. Deliberately NOT written as an expected-failure: under
// `test.failing` any throw counts as a pass, so a server that returned no
// completions at all — tsgo dead, mapping broken — would be reported green,
// indistinguishable from the gap it means to record. Every completion
// assertion below is therefore paired with a liveness check, so an empty list
// can only ever be a real failure.
import { expect, test } from 'bun:test';
import { openSession } from '../support/lsp-session.js';
import { describeExtended } from '../support/extended.js';

// app imports a, a imports util  →  `shout` is IN the closure.
// orphan is imported by nothing  →  `orphanWidget` is OUT of it.
const FILES = {
  'util.rip': 'export shout = (s: string): string -> s.toUpperCase()\n',
  'a.rip': "import { shout } from './util.rip'\nexport relay = (s: string): string -> shout(s)\n",
  'orphan.rip': 'export orphanWidget = (): string -> "widget"\n',
  'app.rip': "import { relay } from './a.rip'\nconsole.log relay('x')\nfirst = sh\nsecond = orph\n",
  'package.json': '{}\n',
};

// Two completion sites, one per candidate, because tsgo filters auto-import
// candidates BY PREFIX: asking at `sh` can never offer `orphanWidget`, no
// matter what the program contains — a probe at the wrong prefix would read a
// filtered-out name as an unreachable one and "reproduce" the gap against a
// server that had it fixed. The site must also be an expression position: a
// bare identifier statement does not map cleanly into the face and answers
// with no completions at all.
const SHOUT = { line: 2, col: 10 };          // `first = sh|`
const ORPHAN = { line: 3, col: 13 };         // `second = orph|`

// Every completion assertion goes through here: a list must be LIVE before its
// membership means anything. An empty list satisfies any `not.toContain` for
// free, which would make a scope test pass for the wrong reason.
async function candidatesAt(session, pos) {
  const labels = await session.completions('app.rip', pos.line, pos.col);
  expect(labels.length).toBeGreaterThan(0);
  return labels;
}

describeExtended('auto-import candidate scope', () => {
  test('a candidate reachable through the import closure IS offered', async () => {
    const s = await openSession(FILES);
    try {
      s.open('app.rip');
      await s.diagnostics('app.rip');
      expect(await candidatesAt(s, SHOUT)).toContain('shout');   // app → a → util
    } finally { await s.close(); }
  }, 90_000);

  // THE GAP, and the mechanism behind it in one test: an unimported file is
  // absent from the candidate set, and OPENING it is what puts it there —
  // which is precisely what proves the candidate set is the tsgo program (the
  // mirror closure) rather than a workspace scan.
  //
  // When auto-import is widened to the whole workspace, the first assertion
  // fails. That is the intended signal: invert it, and the gap is closed.
  test('an UNIMPORTED workspace .rip is NOT offered until it is opened (the open gap)', async () => {
    const s = await openSession(FILES);
    try {
      s.open('app.rip');                                          // orphan stays closed
      await s.diagnostics('app.rip');
      expect(await candidatesAt(s, ORPHAN)).not.toContain('orphanWidget');

      s.open('orphan.rip');                                       // now it joins the closure
      await s.diagnostics('orphan.rip');
      expect(await candidatesAt(s, ORPHAN)).toContain('orphanWidget');
    } finally { await s.close(); }
  }, 90_000);
});
