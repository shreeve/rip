// The standalone corpus snapshot layer: every corpus
// program's emitted JS, sexpr, and serialized source map must be
// BYTE-IDENTICAL to the committed artifacts in test/corpus/expected/ —
// with no external involvement. Drift fails here loudly; accepting new
// bytes is an explicit act (`bun run corpus-expected`, regenerated in
// the same commit as the change that moved them — like `bun run
// parser`).
import { describe, test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import parser from '../src/parser.js';
import { makeParserLexer } from '../src/lexer.js';
import { emit } from '../src/emitter.js';
import { toSourceMap } from '../src/sourcemap.js';

parser.lexer = makeParserLexer();

const corpusDir = join(import.meta.dir, 'corpus');
const expectedDir = join(corpusDir, 'expected');
const files = readdirSync(corpusDir).filter((f) => f.endsWith('.rip')).sort();

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
