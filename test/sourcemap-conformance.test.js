// Mapping-surface conformance: the serialized Source Map V3
// must behave correctly when read back by an INDEPENDENT consumer, not
// just our own decodeMappings. The reference is test/support/consumer.js —
// an in-repo consumer implemented strictly from the Source Map
// specification (ECMA-426), sharing no code with the encoder, and
// pinned below to hand-computed spec vectors so decoder agreement is
// anchored to the spec rather than mutual. Three consumption surfaces
// motivate the assertions: CLI runtime stacks (frames remap), IDE
// debugging (breakpoint/step fidelity), browser DevTools (sourcesContent
// view-source, names-based identifier resolution).
import { describe, test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  SourceMapConsumer,
  originalPositionFor,
  generatedPositionFor,
  allGeneratedPositionsFor,
  sourceContentFor,
  decodedMappings,
  LEAST_UPPER_BOUND,
} from './support/consumer.js';
import parser from '../src/parser.js';
import { makeParserLexer } from '../src/lexer.js';
import { emit } from '../src/emitter.js';
import { Mappings } from '../src/stores.js';
import { SourceFile } from '../src/source.js';
import { toSourceMap, decodeMappings } from '../src/sourcemap.js';

parser.lexer = makeParserLexer();

const compile = (src) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  const out = emit(r, { source: src });
  const map = toSourceMap(out, { source: src });
  return {
    ...out,
    map,
    tracer: new SourceMapConsumer(map),
    queries: new Mappings(out.mappings),
    genFile: new SourceFile(out.code),
    srcFile: new SourceFile(src),
  };
};

const corpusDir = join(import.meta.dir, 'corpus');
const corpusFiles = readdirSync(corpusDir).filter(f => f.endsWith('.rip')).sort();
const corpus = new Map(
  corpusFiles.map(f => [f, readFileSync(join(corpusDir, f), 'utf8')])
);

// With both decoders in-repo, agreement alone would be circular — these
// vectors, hand-computed from the spec's VLQ and segment grammar, anchor
// the consumer (and therefore the agreement suite) to ECMA-426 itself.
describe('the consumer is pinned to hand-computed spec vectors', () => {
  const skeleton = (mappings, extra = {}) => new SourceMapConsumer({
    version: 3, sources: ['a.rip'], sourcesContent: ['A'], names: [], mappings, ...extra,
  });

  test('base64 VLQ: sign bit, continuation bit, multi-digit values', () => {
    // Column deltas 0, +1 ('C'=2 → 1), +15 ('e'=30 → 15) — and in the
    // second line +123 ('2H': 22 + 7·32 = 246 → 123) then -21 ('rB':
    // 11 + 1·32 = 43, sign bit set → -21).
    const c = skeleton('A,C,e;2H,rB');
    expect(decodedMappings(c)).toEqual([[[0], [1], [16]], [[102], [123]]]);
  });

  test('segment fields: absolutes, cross-line carry, names channel', () => {
    // Line 1: [0,0,0,0] then 'IACQA' = +4/+0/+1/+8/+0 → [4,0,1,8,0].
    // Line 2: empty. Line 3: 'ACSA' = +0/+1/+9/+0 — generated column
    // resets at ';', the other fields carry → [0,1,10,8].
    const map = {
      version: 3, file: 'out.js', sources: ['a.rip', 'b.rip'],
      sourcesContent: ['A', 'B'], names: ['x'], mappings: 'AAAA,IACQA;;ACSA',
    };
    const c = new SourceMapConsumer(map);
    expect(decodedMappings(c)).toEqual([
      [[0, 0, 0, 0], [4, 0, 1, 8, 0]], [], [[0, 1, 10, 8]],
    ]);
    // Nearest at-or-before: column 3 falls back to the segment at 0;
    // column 5 lands on the named segment at 4.
    expect(originalPositionFor(c, { line: 1, column: 3 }))
      .toEqual({ source: 'a.rip', line: 1, column: 0, name: null });
    expect(originalPositionFor(c, { line: 1, column: 5 }))
      .toEqual({ source: 'a.rip', line: 2, column: 8, name: 'x' });
    // A line with no segments answers all-null.
    expect(originalPositionFor(c, { line: 2, column: 0 }))
      .toEqual({ source: null, line: null, column: null, name: null });
    expect(originalPositionFor(c, { line: 3, column: 7 }))
      .toEqual({ source: 'b.rip', line: 11, column: 8, name: null });
    // Reverse: LEAST_UPPER_BOUND slides source column 0 forward to the
    // segment anchored at source line 2 column 8.
    expect(generatedPositionFor(c, {
      source: 'a.rip', line: 2, column: 0, bias: LEAST_UPPER_BOUND,
    })).toEqual({ line: 1, column: 4 });
    expect(sourceContentFor(c, 'b.rip')).toBe('B');
  });

  test('sourceRoot prefixes resolved source names', () => {
    const c = skeleton('AAAA', { sourceRoot: 'lib' });
    expect(originalPositionFor(c, { line: 1, column: 0 }).source).toBe('lib/a.rip');
    expect(sourceContentFor(c, 'lib/a.rip')).toBe('A');
  });

  test('VLQ raw values past 32 bits throw instead of wrapping', () => {
    // Seven zero-valued continuation digits ('g'=32) then 'B'=1 put the
    // set bit at position 35: raw 2³⁵ ≥ 2³² — DecodeBase64VLQ mandates
    // an error, never a silent 32-bit truncation to 0.
    expect(() => skeleton('gggggggB')).toThrow(/VLQ value out of 32-bit range/);
  });

  test('VLQ -0 decodes to -2147483648, not 0', () => {
    // 'B' = raw 1: sign bit set, magnitude 0 — the spec's spelling of
    // −2³¹. As a generated-column delta from 0 it must therefore trip
    // the negative-position rejection (decoding it as 0 would not).
    expect(() => skeleton('B')).toThrow(/negative generated column/);
    expect(() => skeleton('AAAB')).toThrow(/negative source position/);
  });

  test('malformed mappings reject loudly', () => {
    expect(() => skeleton('!')).toThrow(/invalid base64 VLQ character/);
    expect(() => skeleton('g')).toThrow(/truncated VLQ continuation/);
    expect(() => skeleton('AA')).toThrow(/2 fields/);
    expect(() => skeleton('AAAAAA')).toThrow(/6 fields/);
    expect(() => skeleton('ACAA')).toThrow(/source index 1 out of range/);
    expect(() => skeleton('AAAAA')).toThrow(/name index 0 out of range/);
  });
});

// The heaviest mapping shapes, pinned as exact consumer-visible positions.
describe('representative fixtures through the independent consumer', () => {
  test('assignment: statement start, declaration, operand, name channel', () => {
    const { tracer, map } = compile('total = count + 1');
    // Generated (Tier 1 declare-in-place): `let total = count + 1;`
    expect(map.names).toEqual(['total', 'count']);
    expect(originalPositionFor(tracer, { line: 1, column: 0 }))
      .toEqual({ source: 'input.rip', line: 1, column: 0, name: null }); // statement cover anchor at `let`
    expect(originalPositionFor(tracer, { line: 1, column: 4 }))
      .toEqual({ source: 'input.rip', line: 1, column: 0, name: 'total' }); // declared name — the ONE target manifestation
    expect(originalPositionFor(tracer, { line: 1, column: 12 }))
      .toEqual({ source: 'input.rip', line: 1, column: 8, name: 'count' });
    // A HOISTED binding (branch-first write, Tier 2) keeps the hoisted
    // declaration as the first manifestation of `target`:
    // `let total;` / blank / `if (flag) {` / `  total = count + 1;`.
    const hoisted = compile('if flag\n  total = count + 1');
    expect(hoisted.code.startsWith('let total;\n\n')).toBe(true);
    expect(originalPositionFor(hoisted.tracer, { line: 1, column: 4 }))
      .toEqual({ source: 'input.rip', line: 2, column: 2, name: 'total' });
    expect(originalPositionFor(hoisted.tracer, { line: 4, column: 2 }))
      .toEqual({ source: 'input.rip', line: 2, column: 2, name: 'total' });
  });

  test('nested functions: inner body positions and both param names', () => {
    const src = 'outer = (a) ->\n  inner = (b) ->\n    a + b\n  inner(a)';
    const { tracer } = compile(src);
    // Tier 1 declare-in-place: `let outer = function(a) {` on line 1,
    // `  let inner = function(b) {` on line 2, `return (a + b);` on
    // line 3 — operands resolve into the inner body line.
    expect(originalPositionFor(tracer, { line: 3, column: 12 }))
      .toEqual({ source: 'input.rip', line: 3, column: 4, name: 'a' });
    expect(originalPositionFor(tracer, { line: 3, column: 16 }))
      .toEqual({ source: 'input.rip', line: 3, column: 8, name: 'b' });
    // Params of both function layers carry their names.
    expect(originalPositionFor(tracer, { line: 1, column: 21 }).name).toBe('a');
    expect(originalPositionFor(tracer, { line: 2, column: 23 }).name).toBe('b');
    // The trailing call remaps to the source call line.
    expect(originalPositionFor(tracer, { line: 5, column: 9 }))
      .toEqual({ source: 'input.rip', line: 4, column: 2, name: 'inner' });
  });

  test('class methods: class name, method key, body expression', () => {
    const src = 'class Greeter\n  greet: (name) ->\n    "hi " + name';
    const { tracer } = compile(src);
    expect(originalPositionFor(tracer, { line: 1, column: 6 }))
      .toEqual({ source: 'input.rip', line: 1, column: 6, name: 'Greeter' });
    expect(originalPositionFor(tracer, { line: 2, column: 2 }))
      .toEqual({ source: 'input.rip', line: 2, column: 2, name: 'greet' });
    expect(originalPositionFor(tracer, { line: 3, column: 20 }))
      .toEqual({ source: 'input.rip', line: 3, column: 12, name: 'name' });
  });

  test('interpolation: template-literal interior maps into the #{} hole', () => {
    const src = 'who = "world"\nmsg = "hello #{who}!"';
    const { tracer } = compile(src);
    // Tier 1: `let msg = \`hello ${who}!\`;` on line 2 — the
    // interpolated identifier.
    expect(originalPositionFor(tracer, { line: 2, column: 19 }))
      .toEqual({ source: 'input.rip', line: 2, column: 15, name: 'who' });
    expect(originalPositionFor(tracer, { line: 2, column: 10 }))
      .toEqual({ source: 'input.rip', line: 2, column: 6, name: null });
  });

  test('accumulator IIFE: comprehension body positions resolve through synthetic scaffolding', () => {
    const src = 'doubled = (n * 2 for n in items)';
    const { tracer, map } = compile(src);
    // Generated (Tier 1 declare-in-place):
    //   1: let doubled = (() => {
    //   4:     result.push((n * 2));
    // The scaffolding lines (const result, for-of, return) carry no
    // segments; the body expression anchors into the source line.
    expect(map.names).toEqual(['doubled', 'n']);
    expect(originalPositionFor(tracer, { line: 1, column: 0 }))
      .toEqual({ source: 'input.rip', line: 1, column: 0, name: null }); // statement cover anchor at `let`
    expect(originalPositionFor(tracer, { line: 1, column: 4 }))
      .toEqual({ source: 'input.rip', line: 1, column: 0, name: 'doubled' });
    // The IIFE the emitter opens anchors to the comprehension's own extent.
    expect(originalPositionFor(tracer, { line: 1, column: 14 }))
      .toEqual({ source: 'input.rip', line: 1, column: 11, name: null });
    // Body operands inside the accumulator: `n`, `2`.
    expect(originalPositionFor(tracer, { line: 4, column: 17 }))
      .toEqual({ source: 'input.rip', line: 1, column: 11, name: 'n' });
    expect(originalPositionFor(tracer, { line: 4, column: 21 }))
      .toEqual({ source: 'input.rip', line: 1, column: 15, name: null });
    // A breakpoint on the source body expression slides INTO the IIFE body.
    const bp = generatedPositionFor(tracer, {
      source: 'input.rip', line: 1, column: 11, bias: LEAST_UPPER_BOUND,
    });
    expect({ line: bp.line, column: bp.column }).toEqual({ line: 4, column: 17 });
  });

  test('value-lowered if: ternary arms anchor to their source branches', () => {
    const src = 'x = if flag\n  1\nelse\n  2';
    const { tracer } = compile(src);
    // Tier 1: `let x = flag ? 1 : 2;`
    expect(originalPositionFor(tracer, { line: 1, column: 8 }))
      .toEqual({ source: 'input.rip', line: 1, column: 7, name: 'flag' });
    expect(originalPositionFor(tracer, { line: 1, column: 15 }))
      .toEqual({ source: 'input.rip', line: 2, column: 2, name: null });
    // A breakpoint set on the source `if` line reaches the lowered
    // statement (its declared target, after the `let ` prefix).
    const bp = generatedPositionFor(tracer, {
      source: 'input.rip', line: 1, column: 0, bias: LEAST_UPPER_BOUND,
    });
    expect({ line: bp.line, column: bp.column }).toEqual({ line: 1, column: 4 });
  });
});

describe('mappings decode identically in both decoders', () => {
  // The independent consumer's decoder and our decodeMappings must see
  // the same segments — any divergence is a VLQ/format bug on one side.
  for (const [file, src] of corpus) {
    test(file, () => {
      const { tracer, map } = compile(src);
      const theirs = decodedMappings(tracer);
      const ours = decodeMappings(map.mappings);
      const flat = [];
      theirs.forEach((line, genLine) => {
        for (const seg of line) {
          const entry = { genLine, genCol: seg[0] };
          if (seg.length >= 4) Object.assign(entry, { srcIndex: seg[1], srcLine: seg[2], srcCol: seg[3] });
          if (seg.length >= 5) entry.nameIndex = seg[4];
          flat.push(entry);
        }
      });
      expect(flat).toEqual(ours);
      // Spec shape: per-line segments strictly ascending — no duplicates.
      for (const line of theirs) {
        for (let i = 1; i < line.length; i++) {
          expect(line[i][0]).toBeGreaterThan(line[i - 1][0]);
        }
      }
    });
  }
});

describe('sourcesContent round-trips byte-for-byte', () => {
  for (const [file, src] of corpus) {
    test(file, () => {
      const { tracer, map } = compile(src);
      expect(sourceContentFor(tracer, map.sources[0])).toBe(src);
    });
  }
});

describe('originalPositionFor agrees with MappingStore', () => {
  // At every serialized segment the consumer's answer must equal the
  // serialized row's source anchor, and must equal our bestAtGenerated
  // except in exactly two documented policy classes:
  //   (1) bestAtGenerated returns a non-$self cover — the contract excludes those
  //       anchors from the V3 map by decision (debugger-hostile), so the
  //       map answers with the enclosing $self anchor instead;
  //   (2) the serialized row is zero-width — containment queries cannot
  //       see zero-width spans, so bestAtGenerated returns the
  //       enclosing row.
  for (const [file, src] of corpus) {
    test(file, () => {
      const { tracer, map, queries, genFile, srcFile } = compile(src);
      const byStart = new Map(queries.serializableRows().map(r => [r.generatedStart, r]));
      for (const s of decodeMappings(map.mappings)) {
        if (!('srcLine' in s)) continue;
        const orig = originalPositionFor(tracer, { line: s.genLine + 1, column: s.genCol });
        const off = genFile.offsetAt(s.genLine, s.genCol);
        const row = byStart.get(off);
        expect(row).toBeDefined();
        const anchor = srcFile.lineColAt(row.sourceStart);
        expect({ line: orig.line - 1, column: orig.column })
          .toEqual({ line: anchor.line, column: anchor.col });

        const best = queries.bestAtGenerated(off);
        const bestLC = best ? srcFile.lineColAt(best.sourceStart) : null;
        const agrees = bestLC && orig.line - 1 === bestLC.line && orig.column === bestLC.col;
        if (!agrees) {
          const nonSelfCover = best && best.mappingKind === 'cover' && best.role !== '$self';
          const zeroWidth = row.generatedStart === row.generatedEnd;
          expect(nonSelfCover || zeroWidth).toBe(true);
        }
      }
    });
  }
});

describe('statement starts: consumer and stores agree exactly', () => {
  // The positions a debugger actually pauses at — the first non-blank
  // column of each generated line that carries a segment there. No policy
  // exceptions apply at these positions.
  for (const [file, src] of corpus) {
    test(file, () => {
      const { tracer, map, queries, genFile, srcFile, code } = compile(src);
      const segs = decodeMappings(map.mappings).filter(s => 'srcLine' in s);
      const byLine = new Map();
      for (const s of segs) {
        if (!byLine.has(s.genLine)) byLine.set(s.genLine, []);
        byLine.get(s.genLine).push(s);
      }
      let checked = 0;
      code.split('\n').forEach((text, i) => {
        const firstCol = text.length - text.trimStart().length;
        const seg = (byLine.get(i) ?? []).find(s => s.genCol === firstCol);
        if (!seg) return;
        checked++;
        const orig = originalPositionFor(tracer, { line: i + 1, column: firstCol });
        const best = queries.bestAtGenerated(genFile.offsetAt(i, firstCol));
        expect(best).not.toBeNull();
        const lc = srcFile.lineColAt(best.sourceStart);
        expect({ line: orig.line - 1, column: orig.column })
          .toEqual({ line: lc.line, column: lc.col });
      });
      expect(checked).toBeGreaterThan(0);
    });
  }
});

describe('generatedPositionFor round-trips and breakpoints resolve', () => {
  for (const [file, src] of corpus) {
    test(file, () => {
      const { tracer, map } = compile(src);
      const segs = decodeMappings(map.mappings).filter(s => 'srcLine' in s);
      // Every segment is reachable back from its own source position.
      for (const s of segs) {
        const all = allGeneratedPositionsFor(tracer, {
          source: map.sources[0], line: s.srcLine + 1, column: s.srcCol,
        });
        expect(all.some(g => g.line === s.genLine + 1 && g.column === s.genCol)).toBe(true);
      }
      // A breakpoint set at column 0 of every mapped source line resolves
      // (LEAST_UPPER_BOUND — the DevTools set-breakpoint slide) and lands
      // on a generated position that maps back to the SAME source line.
      for (const line of new Set(segs.map(s => s.srcLine))) {
        const gen = generatedPositionFor(tracer, {
          source: map.sources[0], line: line + 1, column: 0, bias: LEAST_UPPER_BOUND,
        });
        expect(gen.line).not.toBeNull();
        const back = originalPositionFor(tracer, { line: gen.line, column: gen.column });
        expect(back.line).toBe(line + 1);
      }
    });
  }
});

describe('names resolve identifiers against the source text', () => {
  // DevTools shows `names[i]` as the ORIGINAL name of a generated
  // identifier. Every named segment must (a) resolve through the
  // consumer and (b) match the source text at its mapped position
  // byte-for-byte — this pins that exact rows never rename.
  for (const [file, src] of corpus) {
    test(file, () => {
      const { tracer, map, srcFile } = compile(src);
      let named = 0;
      for (const s of decodeMappings(map.mappings)) {
        if (s.nameIndex === undefined) continue;
        named++;
        const orig = originalPositionFor(tracer, { line: s.genLine + 1, column: s.genCol });
        const name = map.names[s.nameIndex];
        expect(orig.name).toBe(name);
        const off = srcFile.offsetAt(s.srcLine, s.srcCol);
        expect(src.slice(off, off + name.length)).toBe(name);
      }
      // The corpus is identifier-rich; a file with zero named segments
      // would mean the names channel silently vanished.
      expect(named).toBeGreaterThan(0);
    });
  }
});

describe('map skeleton fields', () => {
  test('file, sources, sourceRoot behave for external consumers', () => {
    const src = 'x = 1';
    const out = emit(parser.parse(src), { source: src });
    const map = toSourceMap(out, { source: src, sourcePath: 'lib/app.rip', file: 'lib/app.rip.js' });
    expect(map.file).toBe('lib/app.rip.js');
    expect(map.sources).toEqual(['lib/app.rip']);
    const tracer = new SourceMapConsumer(map);
    // The consumer resolves positions against the declared source name.
    // (Tier 1: `let x = 1;` is a single generated line.)
    expect(originalPositionFor(tracer, { line: 1, column: 0 }).source).toBe('lib/app.rip');
    expect(sourceContentFor(tracer, 'lib/app.rip')).toBe(src);
  });

  test('empty and comment-only programs still parse as valid maps', () => {
    for (const src of ['', '\n', '# just a comment\n']) {
      const out = emit(parser.parse(src), { source: src });
      const map = toSourceMap(out, { source: src });
      const tracer = new SourceMapConsumer(map);
      expect(decodedMappings(tracer).length).toBeGreaterThan(0);
      expect(map.names).toEqual([]);
    }
  });
});
