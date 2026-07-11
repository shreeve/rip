// MappingStore → Source Map V3 + reverse
// lookup. Fixture maps are asserted as decoded structured segments; the
// corpus round-trips through the map API; the map for the same corpus is
// strictly less precise or equal, never more.
import { test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import parser from '../src/parser.js';
import { makeParserLexer } from '../src/lexer.js';
import { emit } from '../src/emitter.js';
import { Mappings } from '../src/stores.js';
import { SourceFile } from '../src/source.js';
import { encodeVLQ, decodeMappings, toSourceMap, createLookup } from '../src/sourcemap.js';

parser.lexer = makeParserLexer();

const compile = (src) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  const out = emit(r, { source: src });
  return {
    ...out,
    map: toSourceMap(out, { source: src }),
    lookup: createLookup(out, { source: src }),
    queries: new Mappings(out.mappings),
  };
};

const corpusDir = join(import.meta.dir, 'corpus');
const corpusFiles = readdirSync(corpusDir).filter(f => f.endsWith('.rip')).sort();

