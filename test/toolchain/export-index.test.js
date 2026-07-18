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

  test('cross-project export is not offered without a declared dependency', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-export-xproj-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{}\n');
      fs.mkdirSync(path.join(dir, 'packages/app'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'packages/app/package.json'),
        JSON.stringify({ name: 'app', dependencies: {} }) + '\n');
      fs.writeFileSync(path.join(dir, 'packages/app/app.rip'), 'x = libFn\n');
      fs.mkdirSync(path.join(dir, 'packages/lib'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'packages/lib/package.json'),
        JSON.stringify({ name: 'lib', exports: './index.rip' }) + '\n');
      fs.writeFileSync(path.join(dir, 'packages/lib/index.rip'),
        'export libFn = (): number -> 1\n');

      const idx = createExportIndex({ workspaceRoot: dir });
      idx.discover();
      idx.ensureBuilt();
      const from = path.join(dir, 'packages/app/app.rip');
      const to = path.join(dir, 'packages/lib/index.rip');
      expect(idx.resolveSpecForTarget(from, to)).toBeNull();

      const items = [];
      idx.augmentCompletions({
        source: 'x = libFn\n', fromFp: from,
        position: { line: 0, character: 10 }, items,
      });
      expect(items.find((it) => it.label === 'libFn')).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('cross-project export is offered via bare spec when dependency is declared', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-export-dep-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{}\n');
      fs.mkdirSync(path.join(dir, 'packages/app'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'packages/app/package.json'),
        JSON.stringify({ name: 'app', dependencies: { lib: '*' } }) + '\n');
      fs.writeFileSync(path.join(dir, 'packages/app/app.rip'), 'x = libFn\n');
      fs.mkdirSync(path.join(dir, 'packages/lib'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'packages/lib/package.json'),
        JSON.stringify({ name: 'lib', exports: './index.rip' }) + '\n');
      fs.writeFileSync(path.join(dir, 'packages/lib/index.rip'),
        'export libFn = (): number -> 1\n');

      const idx = createExportIndex({ workspaceRoot: dir });
      idx.discover();
      idx.ensureBuilt();
      const from = path.join(dir, 'packages/app/app.rip');
      const to = path.join(dir, 'packages/lib/index.rip');
      expect(idx.resolveSpecForTarget(from, to)).toBe('lib');

      const items = [];
      idx.augmentCompletions({
        source: 'x = libFn\n', fromFp: from,
        position: { line: 0, character: 10 }, items,
      });
      const hit = items.find((it) => it.label === 'libFn');
      expect(hit?.labelDetails?.description).toBe('lib');
      expect(hit?.additionalTextEdits?.[0]?.newText).toMatch(/from 'lib'/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('node_modules Rip package entry is indexed for declared deps', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-export-nm-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'),
        JSON.stringify({ name: 'app', dependencies: { '@rip/widget': '*' } }) + '\n');
      fs.writeFileSync(path.join(dir, 'app.rip'), 'x = makeWidget\n');
      const pkg = path.join(dir, 'node_modules/@rip/widget');
      fs.mkdirSync(pkg, { recursive: true });
      fs.writeFileSync(path.join(pkg, 'package.json'),
        JSON.stringify({ name: '@rip/widget', exports: './index.rip' }) + '\n');
      fs.writeFileSync(path.join(pkg, 'index.rip'),
        'export makeWidget = (): string -> "w"\n');

      const idx = createExportIndex({ workspaceRoot: dir });
      idx.discover();
      idx.ensureBuilt();
      const from = path.join(dir, 'app.rip');
      const to = path.join(pkg, 'index.rip');
      expect(idx.resolveSpecForTarget(from, to)).toBe('@rip/widget');

      const items = [];
      idx.augmentCompletions({
        source: 'x = makeWidget\n', fromFp: from,
        position: { line: 0, character: 14 }, items,
      });
      const hit = items.find((it) => it.label === 'makeWidget');
      expect(hit?.labelDetails?.description).toBe('@rip/widget');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('codeActions offers Add import for an unresolved orphan name', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-export-ca-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{}\n');
      fs.writeFileSync(path.join(dir, 'orphan.rip'), 'export orphanWidget = (): string -> "w"\n');
      const src = 'second = orphanWidget\n';
      fs.writeFileSync(path.join(dir, 'app.rip'), src);
      const idx = createExportIndex({ workspaceRoot: dir });
      idx.discover();
      const uri = 'file://' + path.join(dir, 'app.rip');
      const diag = {
        code: 2304,
        message: "Cannot find name 'orphanWidget'.",
        range: { start: { line: 0, character: 9 }, end: { line: 0, character: 21 } },
      };
      const actions = idx.codeActions({
        source: src, fromFp: path.join(dir, 'app.rip'), uri, diagnostics: [diag],
      });
      expect(actions.some((a) => /orphan\.rip/.test(a.title) && /orphanWidget/.test(a.title))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
