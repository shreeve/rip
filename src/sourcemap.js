// Source Map V3 serialization + reverse lookup — the thin final stage.
// Offsets convert to line/col ONLY here, via SourceFile
// lineStarts on both sides (the input source, and a lineStarts build over
// the emitted code).
//
// Segment policy lives in the query layer: the serializer
// consumes Mappings.serializableRows() — exact rows plus `$self` cover
// START anchors, one candidate per generated start, synthetics excluded
// — and never touches raw MappingStore rows. Synthetic rows remain fully
// visible to the reverse-lookup API from the generated side; non-$self
// cover rows resolve only through Mappings.bestAt*.
//
// A segment carries a `names` index iff its generated slice is
// identifier-shaped — exact identifier roles (target, callee, property,
// name, operands that are identifiers) surface to debuggers by name.
//
// Single-file compiles use sources[0]; the segment format already
// carries a source index, so multi-source needs no schema change.

import { SourceFile } from './source.js';
import { Mappings } from './stores.js';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function encodeVLQ(value) {
  let vlq = value < 0 ? ((-value) << 1) | 1 : value << 1;
  let out = '';
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) digit |= 32;
    out += B64[digit];
  } while (vlq > 0);
  return out;
}

// Decode a full V3 `mappings` string into structured segments:
// [{genLine, genCol, srcIndex, srcLine, srcCol, nameIndex?}, ...]
export function decodeMappings(mappings) {
  const segments = [];
  let genLine = 0;
  let genCol = 0, srcIndex = 0, srcLine = 0, srcCol = 0, nameIndex = 0;

  for (const group of mappings.split(';').map(line => line.split(','))) {
    genCol = 0;
    for (const seg of group) {
      if (seg === '') continue;
      const fields = [];
      let value = 0, shift = 0;
      for (const ch of seg) {
        const digit = B64_INDEX.get(ch);
        if (digit === undefined) throw new Error(`invalid VLQ character '${ch}'`);
        value |= (digit & 31) << shift;
        if (digit & 32) {
          shift += 5;
        } else {
          fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = 0;
          shift = 0;
        }
      }
      if (shift !== 0) throw new Error('truncated VLQ segment');
      genCol += fields[0];
      const entry = { genLine, genCol };
      if (fields.length >= 4) {
        srcIndex += fields[1];
        srcLine += fields[2];
        srcCol += fields[3];
        Object.assign(entry, { srcIndex, srcLine, srcCol });
      }
      if (fields.length >= 5) {
        nameIndex += fields[4];
        entry.nameIndex = nameIndex;
      }
      segments.push(entry);
    }
    genLine++;
  }
  return segments;
}

// compileResult: {code, mappings} from the emitter.
export function toSourceMap({ code, mappings }, { source, file = 'output.js', sourcePath = 'input.rip' } = {}) {
  const srcFile = new SourceFile(source, sourcePath);
  const genFile = new SourceFile(code, file);

  const maps = mappings instanceof Mappings ? mappings : new Mappings(mappings);
  const rows = maps.serializableRows();

  const names = [];
  const nameIndex = new Map();
  const lines = [];
  let prevSrcLine = 0, prevSrcCol = 0, prevName = 0;

  for (const m of rows) {
    const gen = genFile.lineColAt(m.generatedStart);
    const src = srcFile.lineColAt(m.sourceStart);
    while (lines.length <= gen.line) lines.push([]);
    const group = lines[gen.line];
    const prevGenCol = group.length ? group[group.length - 1].genCol : 0;

    let seg = encodeVLQ(gen.col - prevGenCol) + encodeVLQ(0) +
      encodeVLQ(src.line - prevSrcLine) + encodeVLQ(src.col - prevSrcCol);
    prevSrcLine = src.line;
    prevSrcCol = src.col;

    const slice = code.slice(m.generatedStart, m.generatedEnd);
    // Only EXACT rows carry a name: names[i] presents as the ORIGINAL
    // name of the generated identifier, and only an exact row spells
    // its source verbatim. A cover row over a minted temp (a hoisted
    // `_ref`) must not rename the source position it anchors to.
    if (m.mappingKind === 'exact' && IDENT.test(slice)) {
      let idx = nameIndex.get(slice);
      if (idx === undefined) {
        idx = names.length;
        names.push(slice);
        nameIndex.set(slice, idx);
      }
      seg += encodeVLQ(idx - prevName);
      prevName = idx;
    }
    group.push({ genCol: gen.col, seg });
  }

  return {
    version: 3,
    file,
    sources: [sourcePath],
    sourcesContent: [source],
    names,
    mappings: lines.map(group => group.map(g => g.seg).join(',')).join(';'),
  };
}

// The map as an inline `sourceMappingURL` comment — appended to emitted
// JS so runtimes resolve stack-trace positions back to the .rip source.
export function toInlineMapComment(map) {
  const b64 = Buffer.from(JSON.stringify(map), 'utf8').toString('base64');
  return `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${b64}`;
}

// Reverse lookup — thin wrappers over the Mappings query policy plus
// lineStarts conversion. Synthetic rows are reachable from the generated
// side; their zero-width source anchors contain no offset, so source-side
// containment cannot return them (inherent to zero-width spans).
export function createLookup({ code, mappings }, { source } = {}) {
  const maps = mappings instanceof Mappings ? mappings : new Mappings(mappings);
  const srcFile = new SourceFile(source);
  const genFile = new SourceFile(code);

  return {
    fromGeneratedOffset: (offset) => maps.bestAtGenerated(offset),
    fromSourceOffset: (offset) => maps.bestAtSource(offset),

    fromGenerated(line, col) {
      const row = maps.bestAtGenerated(genFile.offsetAt(line, col));
      return row === null ? null : { row, source: srcFile.lineColAt(row.sourceStart) };
    },

    fromSource(line, col) {
      const row = maps.bestAtSource(srcFile.offsetAt(line, col));
      return row === null ? null : { row, generated: genFile.lineColAt(row.generatedStart) };
    },
  };
}
