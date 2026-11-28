// Materialize the standalone corpus snapshot layer:
// for every test/corpus/*.rip, write the compiler pipeline's current output
// into test/corpus/expected/ — the emitted JS (<name>.js), the sexpr
// (<name>.sexpr.json), and the serialized Source Map V3 object
// (<name>.map.json). test/corpus-expected.test.js asserts byte-equality
// of every future compile against these committed artifacts with no external
// involvement — the first-class byte-confidence layer
// tiers are the second layer (CI-required via RIP_REQUIRE_V3).
//
// Running this script is the EXPLICIT act that accepts new output bytes
// (like `bun run parser`): the test layer fails loudly on any drift,
// and only a deliberate regeneration — reviewed in the same commit as
// the emitter change that caused it — may move the pinned bytes.
// Run: bun run corpus
//
// The artifacts pin emit()'s undecorated output (runtimeDelivery
// 'none'), exactly the certified surface — delivery
// decoration is pinned separately by the CLI tests.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import parser from '../src/parser.js';
import { makeParserLexer } from '../src/lexer.js';
import { emit } from '../src/emit/emitter.js';
import { toSourceMap } from '../src/sourcemap.js';

parser.lexer = makeParserLexer();

const corpusDir = join(import.meta.dir, '../test/corpus');
const expectedDir = join(corpusDir, 'expected');
mkdirSync(expectedDir, { recursive: true });

const files = readdirSync(corpusDir).filter((f) => f.endsWith('.rip')).sort();
if (files.length === 0) throw new Error(`no corpus files found in ${corpusDir}`);

const stale = new Set(readdirSync(expectedDir));
let written = 0;
let unchanged = 0;

const put = (name, contents) => {
  stale.delete(name);
  const path = join(expectedDir, name);
  if (existsSync(path) && readFileSync(path, 'utf8') === contents) {
    unchanged++;
    return;
  }
  writeFileSync(path, contents);
  written++;
  console.log(`  wrote ${name}`);
};

for (const file of files) {
  const source = readFileSync(join(corpusDir, file), 'utf8');
  const result = parser.parse(source);
  if (result.diagnostics.length > 0) {
    throw new Error(`${file} does not parse: ${result.diagnostics[0].message}`);
  }
  const emitted = emit(result, { source });
  const map = toSourceMap(emitted, { source, sourcePath: file, file: `${file}.js` });

  const base = file.replace(/\.rip$/, '');
  put(`${base}.js`, emitted.code);
  put(`${base}.sexpr.json`, `${JSON.stringify(result.sexpr)}\n`);
  put(`${base}.map.json`, `${JSON.stringify(map)}\n`);
}

// An artifact with no corpus source is drift — remove it loudly.
for (const orphan of stale) {
  rmSync(join(expectedDir, orphan));
  console.log(`  removed orphan ${orphan}`);
}

console.log(
  `corpus: ${files.length} corpus files → ${written} artifact(s) written, ` +
  `${unchanged} unchanged, ${stale.size} orphan(s) removed`,
);

// The consumer corpus: every package module and language-suite row, one
// hash per face (test/support/consumer-hashes.js). Rewritten only when an
// output moved; the manifest's diff names each moved program.
{
  const { compile } = await import('../src/compiler.js');
  const { packageInputs, rowInputs, hashInputs, MANIFEST } = await import('../test/support/consumer-hashes.js');
  const root = join(import.meta.dir, '..');
  const hashes = hashInputs([...packageInputs(root), ...(await rowInputs(root))], compile);
  const text = `${JSON.stringify(hashes, null, 1)}\n`;
  const path = join(root, MANIFEST);
  const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (before !== text) writeFileSync(path, text);
  console.log(`corpus: ${Object.keys(hashes).length} consumer programs → manifest ${before === text ? 'unchanged' : 'rewritten'}`);

  // The same programs at the front end: tape, tree, tolerant parse, REPL
  // verdict (test/support/frontend-hashes.js).
  const { hashFrontEnd, FRONTEND_MANIFEST } = await import('../test/support/frontend-hashes.js');
  const front = hashFrontEnd([...packageInputs(root), ...(await rowInputs(root))]);
  const frontText = `${JSON.stringify(front, null, 1)}\n`;
  const frontPath = join(root, FRONTEND_MANIFEST);
  const frontBefore = existsSync(frontPath) ? readFileSync(frontPath, 'utf8') : '';
  if (frontBefore !== frontText) writeFileSync(frontPath, frontText);
  console.log(`corpus: ${Object.keys(front).length} consumer programs → front-end manifest ${frontBefore === frontText ? 'unchanged' : 'rewritten'}`);
}
