// End-to-end broker path without the editor in the loop:
// compile Rip → virtual TS doc in tsgo → hover + pulled diagnostics →
// mapped back onto .rip source through MappingStore. This is the Rip
// language server's core data path, exercised against the real pinned
// typescript@7 server.
//
// Requires the extension's dependencies (`bun install` in
// packages/vscode). Absent, the suite skips with a loud notice —
// RIP_REQUIRE_TSGO=1 (armed by this package's canonical `bun run test`
// script, and therefore by its CI step) turns absence into a failure
// so the gate cannot go quietly toothless.
import { test, expect, describe } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compile } from '../../../src/compile.js';
import {
  lineStartsOf, offsetToPosition, positionToOffset,
  sourceOffsetToGenerated, generatedSpanToSource, SUPPRESSED_TS_CODES,
} from '../src/translate.js';

let tsgoAvailable = false;
try {
  const { tsgoBinaryPath } = await import('../src/tsgo.js');
  tsgoBinaryPath();
  tsgoAvailable = true;
} catch { /* dependencies not installed */ }

if (!tsgoAvailable) {
  if (process.env.RIP_REQUIRE_TSGO) {
    test('tsgo present (RIP_REQUIRE_TSGO)', () => {
      throw new Error(
        'RIP_REQUIRE_TSGO is set but tsgo was not found — run `bun install` in packages/vscode',
      );
    });
  } else {
    console.warn(
      '\n⚠ packages/vscode dependencies are not installed — the tsgo broker tests are SKIPPED. ' +
      'Run `bun install` in packages/vscode to enable them.\n',
    );
  }
}

describe.skipIf(!tsgoAvailable)('rip → tsgo → rip round trip', () => {
  test('diagnostics and hover land on .rip source', async () => {
    const { startTsgo } = await import('../src/tsgo.js');

    // Same governing options the server materializes (src/server.js).
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-broker-test-'));
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'es2022', module: 'esnext', lib: ['es2022', 'dom'], noImplicitAny: true },
      include: ['**/*.ts'],
    }));

    const source = [
      'greeting = "hello"',
      'count = 42',
      'bad = count.toUpperCase()',
      'console.log greeting, count, bad',
      '',
    ].join('\n');
    // The TS face — exactly what the server compiles (the settled scope, the settled rule).
    const { code, mappings } = compile(source, { path: 'demo.rip', runtimeDelivery: 'inline', face: 'ts' });
    const srcLS = lineStartsOf(source);
    const genLS = lineStartsOf(code);

    const { client } = await startTsgo(root);
    try {
      const uri = 'file://' + path.join(root, 'demo.rip.ts');
      client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'typescript', version: 1, text: code },
      });

      // Diagnostics: TS2339 on `toUpperCase`, mapped back to the .rip
      // line; the UNANNOTATED hoisted `let` declarations draw
      // implicit-any codes that the server suppresses as a class
      // (legal, idiomatic Rip — the the settled rule posture).
      const pulled = await client.request('textDocument/diagnostic', { textDocument: { uri } });
      expect(pulled.kind).toBe('full');
      const surfaced = pulled.items.filter((it) => !SUPPRESSED_TS_CODES.has(it.code));
      const d = surfaced.find((it) => it.code === 2339);
      expect(d).toBeDefined();
      expect(surfaced).toHaveLength(1);
      const gs = positionToOffset(genLS, code.length, d.range.start);
      const ge = positionToOffset(genLS, code.length, d.range.end);
      const span = generatedSpanToSource(mappings, gs, ge);
      expect(span).not.toBeNull();
      expect(source.slice(span[0], span[1])).toBe('toUpperCase');

      // Hover a READ site: `count` inside `count.toUpperCase()` answers
      // its evolving-let-narrowed type (unannotated — the annotated
      // write-site case is pinned end-to-end in server.test.js).
      const srcOffset = source.indexOf('count.toUpperCase') + 2;
      const genOffset = sourceOffsetToGenerated(mappings, srcOffset);
      expect(genOffset).not.toBeNull();
      const hover = await client.request('textDocument/hover', {
        textDocument: { uri },
        position: offsetToPosition(genLS, genOffset),
      });
      expect(hover).not.toBeNull();
      const text = typeof hover.contents === 'string' ? hover.contents : hover.contents.value;
      expect(text).toContain('count');
      expect(text).toContain('number');

      // The hover range maps back onto the .rip identifier.
      const hs = positionToOffset(genLS, code.length, hover.range.start);
      const he = positionToOffset(genLS, code.length, hover.range.end);
      const hoverSpan = generatedSpanToSource(mappings, hs, he);
      expect(hoverSpan).not.toBeNull();
      expect(source.slice(hoverSpan[0], hoverSpan[1])).toBe('count');

      // didChange: fixing the source clears the diagnostic.
      const fixed = source.replace('count.toUpperCase()', 'greeting.toUpperCase()');
      const recompiled = compile(fixed, { path: 'demo.rip', runtimeDelivery: 'inline', face: 'ts' });
      client.notify('textDocument/didChange', {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: recompiled.code }],
      });
      const pulled2 = await client.request('textDocument/diagnostic', { textDocument: { uri } });
      expect(pulled2.items.filter((it) => !SUPPRESSED_TS_CODES.has(it.code))).toEqual([]);
    } finally {
      await client.stop();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

  test('tsgo supplies its OWN diagnostic tags through the pull slot (tagSupport in textDocument.diagnostic)', async () => {
    const { startTsgo } = await import('../src/tsgo.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-broker-tags-'));
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'es2022', module: 'esnext', lib: ['es2022', 'dom'], noImplicitAny: true },
      include: ['**/*.ts'],
    }));
    // No server in the loop: what arrives tagged here is tsgo's own
    // reportsUnnecessary delivery, keyed on the PULL-slot capability
    // the server declares (diagnostic.tagSupport) — the push-slot
    // declaration alone does not tag pulled items. Distinguishable
    // from the fallback table because the table never touches this
    // path.
    const { code } = compile('main: ->\n  total = 1 + 2\n', { path: 'tags.rip', runtimeDelivery: 'inline', face: 'ts' });
    const { client } = await startTsgo(root, {
      clientCapabilities: {
        textDocument: {
          publishDiagnostics: { relatedInformation: true },
          diagnostic: { tagSupport: { valueSet: [1, 2] } },
        },
      },
    });
    try {
      const uri = 'file://' + path.join(root, 'tags.rip.ts');
      client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'typescript', version: 1, text: code },
      });
      const pulled = await client.request('textDocument/diagnostic', { textDocument: { uri } });
      const unused = pulled.items.find((it) => it.code === 6133);
      expect(unused).toBeDefined();
      expect(unused.tags).toEqual([1]); // DiagnosticTag.Unnecessary, from tsgo itself
    } finally {
      await client.stop();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 30000);
});
