// Unit pins for the workspace export index (cold auto-import substrate).
import { expect, test, describe } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  scanExports, buildImportEdit, collectImportedNames, createExportIndex,
} from '../../packages/vscode/src/export-index.js';

describe('scanExports', () => {
  test('picks up export-equals and braced re-exports', () => {
    const names = scanExports([
      'export shout = (s: string): string -> s',
      'export def helper()',
      '  1',
      'export { a, b as c }',
      '# export ignored = 1',
      "export keep = 'has # inside'",
    ].join('\n'));
    expect([...names].sort()).toEqual(['a', 'c', 'helper', 'keep', 'shout']);
  });
});

describe('buildImportEdit', () => {
  test('inserts after existing imports', () => {
    const src = "import { relay } from './a.rip'\nconsole.log relay\n";
    const edit = buildImportEdit(src, './orphan.rip', 'orphanWidget');
    expect(edit.newText).toContain("import { orphanWidget } from './orphan.rip'");
    expect(edit.range.start.line).toBe(1);
  });

  test('augments an existing named import', () => {
    const src = "import { a } from './m.rip'\nx = a\n";
    const edit = buildImportEdit(src, './m.rip', 'b');
    expect(edit.update).toBe(true);
    expect(edit.newText).toBe("import { a, b } from './m.rip'");
  });
});

describe('createExportIndex', () => {
  test('indexes an orphan export and resolves a same-project relative spec', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-export-index-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{}\n');
      fs.writeFileSync(path.join(dir, 'orphan.rip'), 'export orphanWidget = (): string -> "w"\n');
      fs.writeFileSync(path.join(dir, 'app.rip'), "first = orph\n");
      const idx = createExportIndex({ workspaceRoot: dir });
      idx.discover();
      idx.ensureBuilt();
      expect(idx.size).toBeGreaterThan(0);

      const items = [];
      idx.augmentCompletions({
        source: fs.readFileSync(path.join(dir, 'app.rip'), 'utf8'),
        fromFp: path.join(dir, 'app.rip'),
        position: { line: 0, character: 12 },
        items,
      });
      const hit = items.find((it) => it.label === 'orphanWidget');
      expect(hit).toBeDefined();
      expect(hit.additionalTextEdits?.[0]?.newText).toContain("from './orphan.rip'");
      expect(collectImportedNames("import { orphanWidget } from './orphan.rip'\n")).toContain('orphanWidget');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
