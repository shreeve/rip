// Source Map V3 consumer — the conformance suite's independent decoder
//. Implemented strictly from the Source Map
// specification (ECMA-426): base64 VLQ segment decoding, per-line
// segment groups with relative-offset state, sources/names index
// resolution, and the lookup semantics DevTools-class consumers use —
// originalPositionFor answers with the nearest segment at-or-before the
// queried generated column on its line (GREATEST_LOWER_BOUND), or
// at-or-after under LEAST_UPPER_BOUND (the set-breakpoint slide).
//
// INDEPENDENCE INVARIANT: this module shares no code with
// src/sourcemap.js or src/stores.js and must never import from src/ —
// the conformance suite's value is a separate implementation, written
// from the spec, decoding what the compiler encodes.
//
// Malformed input rejects loudly (invalid base64 characters, truncated
// VLQ continuations, wrong field counts) — a consumer that repairs its
// input cannot certify an encoder.

export const GREATEST_LOWER_BOUND = 'greatest-lower-bound';
export const LEAST_UPPER_BOUND = 'least-upper-bound';

const NOT_FOUND = Object.freeze({ source: null, line: null, column: null, name: null });

// ECMA-426 base64 alphabet: A-Z a-z 0-9 + / mapping to 0..63.
const CHAR_VALUE = new Map(
  [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/']
    .map((c, i) => [c, i]),
);

// Decode one comma-delimited segment of base64 VLQ fields. Each base64
// digit carries 5 value bits little-endian plus a continuation bit
// (0x20); the assembled quantity stores the sign in bit 0 and the
// magnitude in the remaining bits. Per ECMA-426 DecodeBase64VLQ the
// raw quantity is a 32-bit value — anything ≥ 2³² is an error, and the
// sign-bit-only form (raw 1, "-0") decodes to −2147483648.
function decodeSegmentFields(text) {
  const fields = [];
  let value = 0;
  let shift = 0;
  for (const ch of text) {
    const digit = CHAR_VALUE.get(ch);
    if (digit === undefined) {
      throw new Error(`source map: invalid base64 VLQ character '${ch}' in segment '${text}'`);
    }
    value += (digit & 0x1f) * 2 ** shift;
    if (digit & 0x20) {
      shift += 5;
    } else {
      if (value >= 2 ** 32) {
        throw new Error(`source map: VLQ value out of 32-bit range in segment '${text}'`);
      }
      const magnitude = Math.floor(value / 2);
      fields.push(value % 2 === 0 ? magnitude : magnitude === 0 ? -2147483648 : -magnitude);
      value = 0;
      shift = 0;
    }
  }
  if (shift !== 0) {
    throw new Error(`source map: truncated VLQ continuation in segment '${text}'`);
  }
  if (fields.length !== 1 && fields.length !== 4 && fields.length !== 5) {
    throw new Error(`source map: segment '${text}' has ${fields.length} fields (spec allows 1, 4, or 5)`);
  }
  return fields;
}

// Parse a full `mappings` string into per-generated-line arrays of
// absolute segments [genCol, srcIdx, srcLine, srcCol, nameIdx?] (or
// [genCol] for unmapped segments). Per spec, the generated column
// resets at each `;` line boundary; source index, source line, source
// column, and name index carry across lines.
function parseMappings(mappings, sourceCount, nameCount) {
  const lines = [];
  let srcIdx = 0;
  let srcLine = 0;
  let srcCol = 0;
  let nameIdx = 0;
  for (const group of mappings.split(';')) {
    const segments = [];
    let genCol = 0;
    if (group !== '') {
      for (const text of group.split(',')) {
        const fields = decodeSegmentFields(text);
        genCol += fields[0];
        if (genCol < 0) throw new Error('source map: negative generated column');
        if (fields.length === 1) {
          segments.push([genCol]);
          continue;
        }
        srcIdx += fields[1];
        srcLine += fields[2];
        srcCol += fields[3];
        if (srcIdx < 0 || srcIdx >= sourceCount) {
          throw new Error(`source map: source index ${srcIdx} out of range`);
        }
        if (srcLine < 0 || srcCol < 0) throw new Error('source map: negative source position');
        if (fields.length === 5) {
          nameIdx += fields[4];
          if (nameIdx < 0 || nameIdx >= nameCount) {
            throw new Error(`source map: name index ${nameIdx} out of range`);
          }
          segments.push([genCol, srcIdx, srcLine, srcCol, nameIdx]);
        } else {
          segments.push([genCol, srcIdx, srcLine, srcCol]);
        }
      }
    }
    // The spec does not require sorted segments; lookup does. Stable
    // sort by generated column preserves emission order among ties.
    if (!segments.every((s, i) => i === 0 || segments[i - 1][0] <= s[0])) {
      segments.sort((a, b) => a[0] - b[0]);
    }
    lines.push(segments);
  }
  return lines;
}

// Binary search over segments sorted by keyAt. Returns the index the
// bias selects: the run of exact matches is entered at its first
// element for GREATEST_LOWER_BOUND and its last for LEAST_UPPER_BOUND;
// with no exact match, GLB answers the nearest key below (-1 if none)
// and LUB the nearest key above (-1 if none).
function biasedSearch(segments, key, needle, bias) {
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = segments[mid][key];
    if (v === needle) {
      found = mid;
      break;
    }
    if (v < needle) lo = mid + 1;
    else hi = mid - 1;
  }
  if (found >= 0) {
    if (bias === LEAST_UPPER_BOUND) {
      while (found + 1 < segments.length && segments[found + 1][key] === needle) found++;
    } else {
      while (found > 0 && segments[found - 1][key] === needle) found--;
    }
    return found;
  }
  // lo is the first index whose key exceeds needle.
  if (bias === LEAST_UPPER_BOUND) return lo < segments.length ? lo : -1;
  return lo - 1;
}

// Resolve a source entry against sourceRoot per spec: a non-empty root
// prefixes each source with exactly one separating slash.
function resolveSource(sourceRoot, source) {
  if (!sourceRoot) return source;
  return sourceRoot.endsWith('/') ? sourceRoot + source : `${sourceRoot}/${source}`;
}

export class SourceMapConsumer {
  constructor(map) {
    if (map.version !== 3) {
      throw new Error(`source map: unsupported version ${map.version}`);
    }
    this.file = map.file ?? null;
    this.names = map.names ?? [];
    this.resolvedSources = (map.sources ?? []).map(s => resolveSource(map.sourceRoot, s));
    this.sourcesContent = map.sourcesContent ?? [];
    this.lines = parseMappings(map.mappings, this.resolvedSources.length, this.names.length);

    // Reverse index: per source, per source line, entries
    // [srcCol, genLine, genCol] stable-sorted by source column.
    this.bySource = this.resolvedSources.map(() => []);
    this.lines.forEach((segments, genLine) => {
      for (const seg of segments) {
        if (seg.length === 1) continue;
        const perLine = this.bySource[seg[1]];
        while (perLine.length <= seg[2]) perLine.push([]);
        perLine[seg[2]].push([seg[3], genLine, seg[0]]);
      }
    });
    for (const perLine of this.bySource) {
      for (const entries of perLine) {
        if (!entries.every((e, i) => i === 0 || entries[i - 1][0] <= e[0])) {
          entries.sort((a, b) => a[0] - b[0]);
        }
      }
    }
  }

  sourceIndexOf(source) {
    return this.resolvedSources.indexOf(source);
  }
}

// The decoded per-line segment arrays, absolute values — the shape the
// spec's `mappings` grammar describes, one array per generated line.
export function decodedMappings(consumer) {
  return consumer.lines;
}

// Generated position (line 1-based, column 0-based) → original
// position. Answers `{source, line, column, name}` with nulls when the
// line has no segment on the biased side of the column, or when the
// selected segment carries no source fields.
export function originalPositionFor(consumer, { line, column, bias = GREATEST_LOWER_BOUND }) {
  const segments = consumer.lines[line - 1] ?? [];
  const i = biasedSearch(segments, 0, column, bias);
  if (i === -1) return NOT_FOUND;
  const seg = segments[i];
  if (seg.length === 1) return NOT_FOUND;
  return {
    source: consumer.resolvedSources[seg[1]],
    line: seg[2] + 1,
    column: seg[3],
    name: seg.length === 5 ? consumer.names[seg[4]] : null,
  };
}

// Original position → one generated position, biased over the source
// columns of the segments mapping from that source line.
export function generatedPositionFor(consumer, { source, line, column, bias = GREATEST_LOWER_BOUND }) {
  const srcIdx = consumer.sourceIndexOf(source);
  const entries = srcIdx === -1 ? [] : (consumer.bySource[srcIdx][line - 1] ?? []);
  const i = biasedSearch(entries, 0, column, bias);
  if (i === -1) return { line: null, column: null };
  return { line: entries[i][1] + 1, column: entries[i][2] };
}

// Original position → every generated position mapped from it: the
// full run of entries at the queried source column when an exact match
// exists, otherwise the run at the nearest source column after it.
export function allGeneratedPositionsFor(consumer, { source, line, column }) {
  const srcIdx = consumer.sourceIndexOf(source);
  const entries = srcIdx === -1 ? [] : (consumer.bySource[srcIdx][line - 1] ?? []);
  let i = biasedSearch(entries, 0, column, LEAST_UPPER_BOUND);
  if (i === -1) return [];
  while (i > 0 && entries[i - 1][0] === entries[i][0]) i--;
  const run = [];
  const col = entries[i][0];
  for (; i < entries.length && entries[i][0] === col; i++) {
    run.push({ line: entries[i][1] + 1, column: entries[i][2] });
  }
  return run;
}

// The embedded content for a source (resolved name), or null.
export function sourceContentFor(consumer, source) {
  const srcIdx = consumer.sourceIndexOf(source);
  return srcIdx === -1 ? null : (consumer.sourcesContent[srcIdx] ?? null);
}
