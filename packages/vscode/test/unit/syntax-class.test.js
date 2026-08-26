// A face SYNTAX error (the TS1000–1999 band) is the emitter's defect,
// not a type judgment on the author's code: a face that does not parse
// invalidates every conclusion the checker draws from it, and no
// annotation reaches it. The band therefore bypasses the
// declaration-scope gate as a CLASS, and an occurrence whose generated
// span has no source mapping reports at the file head rather than
// vanishing — a silent drop reads as a clean file.
import { describe, test, expect } from 'bun:test';
import { mapTsDiagnostic } from '../../src/diagnostics.js';
import { Mappings } from '../../../../src/stores.js';

// One-line texts keep positions arithmetic: offset === character.
const TEXT = 'aaaaaaaaaa bbbbbbbbbb cccccccccc';
const LINE_STARTS = [0];

const exact = () => ({
  nodeId: 1, role: 'value', mappingKind: 'exact',
  sourceStart: 0, sourceEnd: 10, generatedStart: 0, generatedEnd: 10,
});
const good = (rows) => ({
  strict: false, source: TEXT, code: TEXT,
  genLineStarts: LINE_STARTS, srcLineStarts: LINE_STARTS,
  mappings: new Mappings(rows),
  checkedLines: [false],
});
const diag = (code) => ({
  code, message: 'Type expected.', severity: 1,
  range: { start: { line: 0, character: 2 }, end: { line: 0, character: 5 } },
});

describe('face syntax errors are never gated', () => {
  test('a syntax-class code on an unchecked line publishes in gradual mode', () => {
    expect(mapTsDiagnostic(good([exact()]), diag(1110))).not.toBeNull();
  });

  test('a type diagnostic on an unchecked line still gates', () => {
    expect(mapTsDiagnostic(good([exact()]), diag(2339))).toBeNull();
  });

  test('an unmappable syntax error reports at the file head instead of vanishing', () => {
    const d = mapTsDiagnostic(good([]), diag(1110));
    expect(d).not.toBeNull();
    expect(d.range.start).toEqual({ line: 0, character: 0 });
  });

  test('an unmappable type diagnostic still drops', () => {
    expect(mapTsDiagnostic(good([]), diag(2339))).toBeNull();
  });

  test('semantic band members stay behind the gate', () => {
    expect(mapTsDiagnostic(good([exact()]), diag(1345))).toBeNull();
    expect(mapTsDiagnostic(good([exact()]), diag(1360))).toBeNull();
  });

  test('an unmappable semantic band member still drops', () => {
    expect(mapTsDiagnostic(good([]), diag(1360))).toBeNull();
  });
});
