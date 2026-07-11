// Differential check for CodeBuilder's exactness algorithm: mappingKind
// is DEFINED as "the emitted slice equals the source slice verbatim"
// (builder.js header). The builder computes that incrementally (length
// gate, chunk walk, per-delta memo — never a join); this suite runs
// every corpus file and a set of adversarial chain shapes through both
// the incremental check and the definition executed literally (join the
// region's chunks, compare the strings), and requires byte-identical
// code AND identical mapping rows.
//
// Coverage note: the equivalence holds for in-range source spans — the
// definition's slice() clamps an out-of-range span, while the
// incremental check REJECTS it loudly as a store-protocol violation
// (pinned by a negative test in stores.test.js). All spans here are
// in-range by construction: every source compiles through the real
// pipeline, whose spans derive from token offsets.
import { describe, test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CodeBuilder } from '../../src/builder.js';
import { compile } from '../../src/compile.js';

// endMark with matchesSource replaced by the definition, verbatim.
const refEndMark = function () {
  const f = this.markStack.pop();
  this.openMarks--;
  let { mappingKind } = f;
  if (mappingKind === null) {
    const emitted = this.chunks.slice(f.chunkStart).join('');
    const original = this.source === null ? null : this.source.slice(f.sourceStart, f.sourceEnd);
    mappingKind = emitted === original ? 'exact' : 'cover';
  }
  this.rows.push({
    nodeId: f.nodeId, role: f.role, mappingKind,
    sourceStart: f.sourceStart, sourceEnd: f.sourceEnd,
    generatedStart: f.generatedStart, generatedEnd: this.length,
    fileId: 0,
  });
};
const newEndMark = CodeBuilder.prototype.endMark;

const runWith = (impl, src, name) => {
  CodeBuilder.prototype.endMark = impl;
  try {
    const r = compile(src, { path: name });
    return { code: r.code, rows: r.mappings.rows };
  } catch (err) {
    return { error: err.message };
  } finally {
    CodeBuilder.prototype.endMark = newEndMark;
  }
};

const corpusDir = join(import.meta.dir, '../corpus');
const sources = readdirSync(corpusDir)
  .filter((f) => f.endsWith('.rip'))
  .sort()
  .map((f) => [f, readFileSync(join(corpusDir, f), 'utf8')]);

// Adversarial chain shapes: deep spines stress the memo's skip logic;
// self-similar sources make MANY deltas match, stressing memo
// replacement/bridging; multiple statements make disjoint sibling
// regions at the same delta.
const ids = (n) => Array.from({ length: n + 1 }, (_, i) => `a${i}`);
const shapes = [
  ['<plus-500>', 'x = ' + ids(500).join(' + ')],
  ['<and-500>', 'x = ' + ids(500).join(' and ')],
  ['<lt-500>', 'x = ' + ids(500).join(' < ')],
  ['<member-500>', 'x = a' + Array.from({ length: 500 }, (_, i) => `.b${i}`).join('')],
  ['<index-300>', 'x = a' + Array.from({ length: 300 }, (_, i) => `[${i}]`).join('')],
  ['<call-300>', 'x = a' + Array.from({ length: 300 }, (_, i) => `(${i})`).join('')],
  ['<optmember-300>', 'x = a' + Array.from({ length: 300 }, (_, i) => `?.b${i}`).join('')],
  ['<mixed-300>', 'x = a' + Array.from({ length: 300 }, (_, i) => `.b${i}(${i})[${i}]`).join('')],
  ['<selfsim-300>', 'x = ' + Array.from({ length: 300 }, () => 'a').join(' + ')],
  ['<selfsim-arr>', 'x = [' + Array.from({ length: 300 }, () => '[a, a]').join(', ') + ']'],
  ['<stmts-500>', Array.from({ length: 500 }, (_, i) => `v${i} = w${i}.p.q + 1`).join('\n')],
];

describe('exactness: the incremental check equals the definition', () => {
  for (const [name, src] of [...sources, ...shapes]) {
    test(name, () => {
      const a = runWith(refEndMark, src, name);
      const b = runWith(newEndMark, src, name);
      expect(b).toEqual(a);
    });
  }
});
