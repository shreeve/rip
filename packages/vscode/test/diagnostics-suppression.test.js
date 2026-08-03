// mapTsDiagnostic's recovered-face gate is SCOPED. While a buffer is
// incomplete, cover-mapped TS diagnostics drop — but only at or after
// the EARLIEST rejection, because repair mints holes at the
// incompleteness and closers after it, never before. A real error on
// settled text above the incompleteness has a cover row as its only
// mapping; file-wide suppression traded it for silence.
import { describe, test, expect } from 'bun:test';
import { mapTsDiagnostic } from '../src/diagnostics.js';
import { Mappings } from '../../../src/stores.js';

// One-line texts keep positions arithmetic: offset === character.
const TEXT = 'aaaaaaaaaa bbbbbbbbbb cccccccccc';
const LINE_STARTS = [0];

const cover = (at) => ({
  nodeId: 1, role: 'value', mappingKind: 'cover',
  sourceStart: at, sourceEnd: at + 10, generatedStart: at, generatedEnd: at + 10,
});
const good = (parseDiagnostics, rows) => ({
  strict: true, source: TEXT, code: TEXT,
  genLineStarts: LINE_STARTS, srcLineStarts: LINE_STARTS,
  mappings: new Mappings(rows),
  parseDiagnostics,
});
const tsError = (at) => ({
  code: 2322, message: 'not assignable', severity: 1,
  range: { start: { line: 0, character: at }, end: { line: 0, character: at + 3 } },
});

describe('the recovered-face gate is scoped to the incompleteness', () => {
  test('a cover-mapped error BEFORE the earliest rejection publishes', () => {
    // The rejection sits in the third word; the cover row (and the
    // error inside it) covers the first — settled text.
    const g = good([{ reason: 'incomplete', start: 22, end: 23 }], [cover(0)]);
    expect(mapTsDiagnostic(g, tsError(2))).not.toBeNull();
  });

  test('a cover span reaching the rejection still drops — minted bytes can live there', () => {
    const g = good([{ reason: 'incomplete', start: 5, end: 6 }], [cover(0)]);
    expect(mapTsDiagnostic(g, tsError(2))).toBeNull();
  });

  test('a complete buffer never enters the gate: the cover row publishes', () => {
    expect(mapTsDiagnostic(good([], [cover(0)]), tsError(2))).not.toBeNull();
  });
});
