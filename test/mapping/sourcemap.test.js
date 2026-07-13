// MappingStore → serialized source map + reverse lookup. Fixture maps
// are asserted as decoded structured segments; the corpus round-trips
// through the map API.
import { describe, test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import parser from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { emit } from '../../src/emitter.js';
import { Mappings } from '../../src/stores.js';
import { SourceFile } from '../../src/source.js';
import { encodeVLQ, decodeMappings, toSourceMap, createLookup } from '../../src/sourcemap.js';

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

const corpusDir = join(import.meta.dir, '../corpus');
const corpusFiles = readdirSync(corpusDir).filter(f => f.endsWith('.rip')).sort();

describe('VLQ encoding', () => {
  test('encodes canonical values', () => {
    expect(encodeVLQ(0)).toBe('A');
    expect(encodeVLQ(1)).toBe('C');
    expect(encodeVLQ(-1)).toBe('D');
    expect(encodeVLQ(16)).toBe('gB');
  });

  test('round-trips through the decoder', () => {
    for (const v of [0, 1, -1, 15, 16, -16, 31, 32, 1000, -1000, 123456]) {
      const segs = decodeMappings(encodeVLQ(v) + 'AAA'.slice(0, 0) + encodeVLQ(0) + encodeVLQ(0) + encodeVLQ(v));
      expect(segs[0].genCol).toBe(v < 0 ? v : v); // genCol accumulates from 0
      expect(segs[0].srcCol).toBe(v);
    }
  });

  test('rejects malformed VLQ', () => {
    expect(() => decodeMappings('!')).toThrow(/invalid VLQ/);
  });
});

describe('fixture maps: exact decoded segments', () => {
  test('x = y + 1', () => {
    const { map } = compile('x = y + 1');
    expect(map.version).toBe(3);
    expect(map.sources).toEqual(['input.rip']);
    expect(map.sourcesContent).toEqual(['x = y + 1']);
    expect(map.names).toEqual(['x', 'y']);
    // Declare-in-place: `let x = y + 1;` — the declaring statement
    // carries the target row itself; there is no separate hoist line.
    expect(decodeMappings(map.mappings)).toEqual([
      { genLine: 0, genCol: 0, srcIndex: 0, srcLine: 0, srcCol: 0 },               // statement cover anchor at `let`
      { genLine: 0, genCol: 4, srcIndex: 0, srcLine: 0, srcCol: 0, nameIndex: 0 }, // `x` target (declaring statement)
      { genLine: 0, genCol: 8, srcIndex: 0, srcLine: 0, srcCol: 4, nameIndex: 1 }, // `y` left
      { genLine: 0, genCol: 12, srcIndex: 0, srcLine: 0, srcCol: 8 },              // `1` right
    ]);
  });

  test('obj.prop', () => {
    const { map } = compile('obj.prop');
    expect(map.names).toEqual(['obj', 'prop']);
    expect(decodeMappings(map.mappings)).toEqual([
      { genLine: 0, genCol: 0, srcIndex: 0, srcLine: 0, srcCol: 0, nameIndex: 0 },
      { genLine: 0, genCol: 4, srcIndex: 0, srcLine: 0, srcCol: 4, nameIndex: 1 },
    ]);
  });

  test('add(1, 2)', () => {
    const { map } = compile('add(1, 2)');
    expect(map.names).toEqual(['add']);
    expect(decodeMappings(map.mappings)).toEqual([
      { genLine: 0, genCol: 0, srcIndex: 0, srcLine: 0, srcCol: 0, nameIndex: 0 }, // callee
      { genLine: 0, genCol: 3, srcIndex: 0, srcLine: 0, srcCol: 3 },               // args extent
    ]);
  });

  test('astral-plane strings produce correct UTF-16 columns', () => {
    const src = 'x = "😀"\ny = f("🎉", 2)';
    const { map, code } = compile(src);
    const segs = decodeMappings(map.mappings);
    // Source line 1: `y = f("🎉", 2)` — f at col 4, args at col 5.
    const args = segs.find(s => s.srcLine === 1 && s.srcCol === 5);
    expect(args).toBeDefined();
    expect(code.split('\n')[args.genLine].slice(args.genCol)).toStartWith('("🎉", 2)');
    // Generated columns are UTF-16 too: `"😀"` occupies 4 code units.
    // Declare-in-place: the string sits after `let x = ` (8 cols).
    const str = segs.find(s => s.srcLine === 0 && s.srcCol === 4);
    expect(str.genCol).toBe(8);
    expect(code.split('\n')[str.genLine].slice(str.genCol)).toStartWith('"😀"');
  });
});

describe('cover-vs-direct query policy', () => {
  const src = 'x = y + 1';
  const { queries } = compile(src);

  test('positions inside `let ` resolve only to the enclosing cover', () => {
    // Generated offset 1 is inside the `let ` prefix of the declaring
    // statement, with no direct row; the innermost enclosing cover is
    // the program body row.
    expect(queries.directAtGenerated(1)).toBeNull();
    const best = queries.bestAtGenerated(1);
    expect(best.mappingKind).toBe('cover');
    expect(best.role).toBe('body');
  });

  test('the declared name itself IS direct (target role)', () => {
    const row = queries.directAtGenerated(4); // `x` in `let x = y + 1;`
    expect(row.role).toBe('target');
    expect(row.mappingKind).toBe('exact');
  });

  test('direct rows win over enclosing covers at role positions', () => {
    const row = queries.bestAtGenerated(8); // `y` in `let x = y + 1;`
    expect([row.role, row.mappingKind]).toEqual(['left', 'exact']);
  });
});

describe('synthetic rows are reverse-map-only', () => {
  const src = 'x = y + 1';
  const { map, queries, code } = compile(src);

  test('no serialized segment lands on an operator glyph', () => {
    // `let x = y + 1;` — `=` at generated (0,6), `+` at (0,10).
    const positions = new Set(decodeMappings(map.mappings).map(s => `${s.genLine}:${s.genCol}`));
    expect(positions.has('0:6')).toBe(false);
    expect(positions.has('0:10')).toBe(false);
  });

  test('the reverse API reaches synthetic rows from the generated side', () => {
    const eq = queries.bestAtGenerated(6); // `=` glyph in `let x = y + 1;`
    expect([eq.role, eq.mappingKind]).toEqual(['operator', 'synthetic']);
    expect(code.slice(eq.generatedStart, eq.generatedEnd)).toBe('=');
  });

  test('zero-width source anchors are unreachable from the source side', () => {
    // Source offset 4 (`y`, also the binary node's anchor) returns the
    // left role, never the synthetic operator row.
    const row = queries.directAtSource(4);
    expect(row.role).toBe('left');
  });

  test('serializableRows encodes the selection policy at the query layer', () => {
    const { queries } = compile('x = y + 1');
    const rows = queries.serializableRows();
    // One candidate per generated start, in generated order.
    const starts = rows.map(r => r.generatedStart);
    expect(new Set(starts).size).toBe(starts.length);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    // No synthetics; covers only as $self anchors.
    for (const r of rows) {
      expect(r.mappingKind).not.toBe('synthetic');
      if (r.mappingKind === 'cover') expect(r.role).toBe('$self');
    }
    // Exact beats cover at a shared start: generated 4 hosts both
    // assign.$self (exact) and assign.target (exact, smaller) — innermost
    // wins (the declaring statement, `x` after `let `); generated 0
    // hosts only the statement cover anchor.
    expect(rows.find(r => r.generatedStart === 4).role).toBe('target');
    expect(rows.find(r => r.generatedStart === 0).role).toBe('$self');
  });

  test('only exact rows and $self cover anchors serialize', () => {
    const { map: m, mappings: rows, code: c } = compile('if a\n  b\nelse\n  c');
    const segs = decodeMappings(m.mappings);
    const genFile = new SourceFile(c);
    for (const s of segs) {
      const offset = genFile.offsetAt(s.genLine, s.genCol);
      const at = rows.filter(r => r.generatedStart === offset)
        .filter(r => r.mappingKind === 'exact' || (r.mappingKind === 'cover' && r.role === '$self'));
      expect(at.length).toBeGreaterThan(0);
    }
  });
});

describe('round-trip over the corpus', () => {
  for (const file of corpusFiles) {
    test(file, () => {
      const src = readFileSync(join(corpusDir, file), 'utf8');
      const { mappings, lookup } = compile(src);
      const srcFile = new SourceFile(src);
      for (const m of mappings) {
        if (m.mappingKind !== 'exact') continue;
        // source position → generated → back to source lands at the
        // original position: the returned row's source span contains it
        // (closed on the end so zero-width glyph anchors AT the position
        // count — e.g. the generated start of unary `-a` resolves to the
        // 1-char synthetic `-` row anchored exactly there).
        const p = m.sourceStart;
        const { line, col } = srcFile.lineColAt(p);
        const toGen = lookup.fromSource(line, col);
        expect(toGen).not.toBeNull();
        const back = lookup.fromGeneratedOffset(toGen.row.generatedStart);
        const contains = back.sourceStart <= p && p < back.sourceEnd;
        const anchoredAt = back.sourceStart === p && back.sourceEnd === p;
        expect(contains || anchoredAt).toBe(true);
      }
    });
  }
});

describe('source map format validity over the corpus', () => {
  for (const file of corpusFiles) {
    test(file, () => {
      const src = readFileSync(join(corpusDir, file), 'utf8');
      const { map, code } = compile(src);
      // Shape: serializable, well-typed fields.
      const parsed = JSON.parse(JSON.stringify(map));
      expect(parsed.version).toBe(3);
      expect(parsed.sources).toEqual(['input.rip']);
      expect(parsed.sourcesContent).toEqual([src]);
      expect(Array.isArray(parsed.names)).toBe(true);
      for (const n of parsed.names) expect(n).toMatch(/^[$_\p{ID_Start}][$\u200C\u200D_\p{ID_Continue}]*$/u);
      // All VLQ decodes; every position is in-bounds on both sides.
      const segs = decodeMappings(parsed.mappings);
      const genFile = new SourceFile(code);
      const srcFile = new SourceFile(src);
      expect(segs.length).toBeGreaterThan(0);
      for (const s of segs) {
        expect(s.genLine).toBeLessThan(genFile.lineCount);
        expect(s.genCol).toBeGreaterThanOrEqual(0);
        expect(s.srcIndex).toBe(0);
        expect(s.srcLine).toBeLessThan(srcFile.lineCount);
        if (s.nameIndex !== undefined) expect(parsed.names[s.nameIndex]).toBeDefined();
      }
    });
  }
});
