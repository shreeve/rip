// Auto-import candidate scope: workspace `.rip` exports are offered from
// cold via the Rip export index (walk + scanExports), while the tsgo
// program stays the open-buffer mirror closure. v3 parity: completion
// carries Rip import edits; TS2304 quick fix offers Add import for orphans.
import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { openSession } from '../support/lsp-session.js';
import { describeExtended } from '../support/extended.js';

const FILES = {
  'util.rip': 'export shout = (s: string): string -> s.toUpperCase()\n',
  'a.rip': "import { shout } from './util.rip'\nexport relay = (s: string): string -> shout(s)\n",
  'orphan.rip': 'export orphanWidget = (): string -> "widget"\n',
  'app.rip': "import { relay } from './a.rip'\nconsole.log relay('x')\nfirst = sh\nsecond = orph\n",
  'package.json': '{}\n',
};

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
      expect(await candidatesAt(s, SHOUT)).toContain('shout');
    } finally { await s.close(); }
  }, 90_000);

  test('an UNIMPORTED workspace .rip IS offered from cold (export index)', async () => {
    const s = await openSession(FILES);
    try {
      s.open('app.rip');
      await s.diagnostics('app.rip');
      expect(await candidatesAt(s, ORPHAN)).toContain('orphanWidget');
    } finally { await s.close(); }
  }, 90_000);

  test('cold orphan completion carries additionalTextEdits that insert the import', async () => {
    const s = await openSession(FILES);
    try {
      s.open('app.rip');
      await s.diagnostics('app.rip');
      const hit = await s.completionItem('app.rip', ORPHAN.line, ORPHAN.col, 'orphanWidget');
      expect(hit).toBeDefined();
      expect(hit.labelDetails?.description).toBe('./orphan.rip');
      expect(hit.data?.ripExportIndex).toBe(true);
      expect(hit.additionalTextEdits).toHaveLength(1);
      const edit = hit.additionalTextEdits[0];
      expect(edit.newText).toMatch(/import \{ orphanWidget \} from ['"]\.\/orphan\.rip['"]/);
      expect(edit.newText).not.toContain('.rip.ts');
      expect(edit.newText).not.toContain(';');
      expect(edit.range.start).toEqual({ line: 1, character: 0 });
    } finally { await s.close(); }
  }, 90_000);

  test('applying the cold orphan import edit clears TS2304 for that symbol', async () => {
    const s = await openSession({
      ...FILES,
      'app.rip': "import { relay } from './a.rip'\nconsole.log relay('x')\nsecond = orphanWidget\n",
    });
    try {
      s.open('app.rip');
      const before = await s.diagnostics('app.rip');
      expect(before.some((d) => d.code === 2304 && /orphanWidget/.test(d.message))).toBe(true);

      const hit = await s.completionItem('app.rip', 2, 19, 'orphanWidget');
      expect(hit?.additionalTextEdits?.length).toBeGreaterThan(0);
      const src = fs.readFileSync(path.join(s.dir, 'app.rip'), 'utf8');
      const next = s.applyTextEdits(src, hit.additionalTextEdits);
      expect(next).toMatch(/import \{ orphanWidget \} from ['"]\.\/orphan\.rip['"]/);

      s.forget('app.rip');
      s.change('app.rip', next);
      const after = await s.diagnostics('app.rip');
      expect(after.some((d) => d.code === 2304 && /orphanWidget/.test(d.message))).toBe(false);
    } finally { await s.close(); }
  }, 90_000);

  test('code action on TS2304 offers Add import for a cold orphan', async () => {
    const s = await openSession({
      ...FILES,
      'app.rip': "import { relay } from './a.rip'\nconsole.log relay('x')\nsecond = orphanWidget\n",
    });
    try {
      s.open('app.rip');
      const diags = await s.diagnostics('app.rip');
      const missing = diags.find((d) => d.code === 2304 && /orphanWidget/.test(d.message));
      expect(missing).toBeDefined();

      const actions = await s.codeActions('app.rip', missing.range, [missing]);
      const fix = actions.find((a) => /import/i.test(a.title) && /orphan\.rip/.test(a.title));
      expect(fix).toBeDefined();
      expect(fix.kind).toBe('quickfix');
      expect(fix.title).not.toContain('.rip.ts');
      const edits = fix.edit.changes[s.uri('app.rip')];
      expect(edits?.length).toBeGreaterThan(0);
      expect(edits.some((e) => /orphanWidget/.test(e.newText) && /orphan\.rip/.test(e.newText))).toBe(true);
    } finally { await s.close(); }
  }, 90_000);
});
