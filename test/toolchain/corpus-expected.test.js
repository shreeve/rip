// The standalone corpus snapshot layer: every corpus
// program's emitted JS, sexpr, and serialized source map must be
// BYTE-IDENTICAL to the committed artifacts in test/corpus/expected/ —
// with no external involvement. Drift fails here loudly; accepting new
// bytes is an explicit act (`bun run corpus`, regenerated in
// the same commit as the change that moved them — like `bun run
// parser`).
import { describe, test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import parser from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { emit } from '../../src/emit/emitter.js';
import { toSourceMap } from '../../src/sourcemap.js';
import { ripFiles } from '../support/rip-files.js';
import { compile } from '../../src/compiler.js';
import { packageInputs, rowInputs, hashInputs, MANIFEST } from '../support/consumer-hashes.js';

parser.lexer = makeParserLexer();

const corpusDir = join(import.meta.dir, '../corpus');
const expectedDir = join(corpusDir, 'expected');
const files = ripFiles(corpusDir);

test('the artifact set is exactly three files per corpus program — no missing, no orphans', () => {
  const want = files.flatMap((f) => {
    const base = f.replace(/\.rip$/, '');
    return [`${base}.js`, `${base}.sexpr.json`, `${base}.map.json`];
  }).sort();
  expect(readdirSync(expectedDir).sort()).toEqual(want);
});

describe('corpus: compilation is byte-identical to the committed expected artifacts', () => {
  for (const file of files) {
    test(file, () => {
      const source = readFileSync(join(corpusDir, file), 'utf8');
      const result = parser.parse(source);
      expect(result.diagnostics).toEqual([]);
      const emitted = emit(result, { source });
      const map = toSourceMap(emitted, { source, sourcePath: file, file: `${file}.js` });

      const base = file.replace(/\.rip$/, '');
      const read = (name) => readFileSync(join(expectedDir, name), 'utf8');
      expect(emitted.code).toBe(read(`${base}.js`));
      expect(`${JSON.stringify(result.sexpr)}\n`).toBe(read(`${base}.sexpr.json`));
      expect(`${JSON.stringify(map)}\n`).toBe(read(`${base}.map.json`));
    });
  }
});

// The consumer-corpus gate, package modules half: every one compiles, on both
// faces, to the output the manifest pins. A change that moves real
// code's output is accepted only by `bun run corpus`, after its diff is
// reviewed (`bun scripts/consumer-diff.mjs <ref>` shows each moved output
// against another revision's compiler).
describe('the consumer corpus: package modules', () => {
  const ROOT = join(import.meta.dir, '../..');

  test('package modules compile to the pinned consumer-corpus output', async () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, MANIFEST), 'utf8'));
    const got = hashInputs(packageInputs(ROOT), compile);
    const pinned = Object.fromEntries(Object.entries(manifest).filter(([k]) => k.startsWith('pkg ')));
    const moved = [], missing = [], unpinned = [];
    for (const [k, v] of Object.entries(got)) {
      if (!(k in pinned)) unpinned.push(k);
      else if (v.js !== pinned[k].js || v.ts !== pinned[k].ts) moved.push(`${k}${v.js !== pinned[k].js ? ' [js]' : ''}${v.ts !== pinned[k].ts ? ' [ts]' : ''}`);
    }
    for (const k of Object.keys(pinned)) if (!(k in got)) missing.push(k);
    const report = [
      moved.length && `output moved (${moved.length}):\n  ${moved.slice(0, 40).join('\n  ')}`,
      unpinned.length && `not in the manifest (${unpinned.length}):\n  ${unpinned.slice(0, 20).join('\n  ')}`,
      missing.length && `in the manifest but gone (${missing.length}):\n  ${missing.slice(0, 20).join('\n  ')}`,
    ].filter(Boolean).join('\n');
    expect(report, report + '\n\nReview the moved output (bun scripts/consumer-diff.mjs <ref>), then accept it with bun run corpus.').toBe('');
  }, 120_000);
});

// The consumer-corpus gate, language-suite rows half: every one compiles, on both
// faces, to the output the manifest pins. A change that moves real
// code's output is accepted only by `bun run corpus`, after its diff is
// reviewed (`bun scripts/consumer-diff.mjs <ref>` shows each moved output
// against another revision's compiler).
describe('the consumer corpus: language-suite rows', () => {
  const ROOT = join(import.meta.dir, '../..');

  test('language-suite rows compile to the pinned consumer-corpus output', async () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, MANIFEST), 'utf8'));
    const got = hashInputs(await rowInputs(ROOT), compile);
    const pinned = Object.fromEntries(Object.entries(manifest).filter(([k]) => k.startsWith('row ')));
    const moved = [], missing = [], unpinned = [];
    for (const [k, v] of Object.entries(got)) {
      if (!(k in pinned)) unpinned.push(k);
      else if (v.js !== pinned[k].js || v.ts !== pinned[k].ts) moved.push(`${k}${v.js !== pinned[k].js ? ' [js]' : ''}${v.ts !== pinned[k].ts ? ' [ts]' : ''}`);
    }
    for (const k of Object.keys(pinned)) if (!(k in got)) missing.push(k);
    const report = [
      moved.length && `output moved (${moved.length}):\n  ${moved.slice(0, 40).join('\n  ')}`,
      unpinned.length && `not in the manifest (${unpinned.length}):\n  ${unpinned.slice(0, 20).join('\n  ')}`,
      missing.length && `in the manifest but gone (${missing.length}):\n  ${missing.slice(0, 20).join('\n  ')}`,
    ].filter(Boolean).join('\n');
    expect(report, report + '\n\nReview the moved output (bun scripts/consumer-diff.mjs <ref>), then accept it with bun run corpus.').toBe('');
  }, 120_000);
});
