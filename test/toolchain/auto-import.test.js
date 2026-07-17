// Auto-import candidate scope: workspace `.rip` exports are offered from
// cold via the Rip export index (walk + scanExports), while the tsgo
// program stays the open-buffer mirror closure. Closure-reachable symbols
// still come through tsgo; unimported workspace symbols come through the
// index with Rip-native import edits.
import { expect, test } from 'bun:test';
import { openSession } from '../support/lsp-session.js';
import { describeExtended } from '../support/extended.js';

// app imports a, a imports util  →  `shout` is IN the closure.
// orphan is imported by nothing  →  `orphanWidget` is OUT of the program,
// but MUST still be offered via the export index.
const FILES = {
  'util.rip': 'export shout = (s: string): string -> s.toUpperCase()\n',
  'a.rip': "import { shout } from './util.rip'\nexport relay = (s: string): string -> shout(s)\n",
  'orphan.rip': 'export orphanWidget = (): string -> "widget"\n',
  'app.rip': "import { relay } from './a.rip'\nconsole.log relay('x')\nfirst = sh\nsecond = orph\n",
  'package.json': '{}\n',
};

// Two completion sites, one per candidate, because tsgo (and the index)
// filter BY PREFIX: asking at `sh` can never offer `orphanWidget`.
// The site must also be an expression position.
const SHOUT = { line: 2, col: 10 };          // `first = sh|`
const ORPHAN = { line: 3, col: 13 };         // `second = orph|`

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

  test('an UNIMPORTED workspace .rip IS offered from cold (export index)', async () => {
    const s = await openSession(FILES);
    try {
      s.open('app.rip');                                          // orphan stays closed
      await s.diagnostics('app.rip');
      expect(await candidatesAt(s, ORPHAN)).toContain('orphanWidget');
    } finally { await s.close(); }
  }, 90_000);
});
