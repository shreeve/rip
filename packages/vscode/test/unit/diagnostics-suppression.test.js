// mapTsDiagnostic's recovered-face gate is SCOPED. While a buffer is
// incomplete, cover-mapped TS diagnostics drop — but only at or after
// the EARLIEST rejection, because repair mints holes at the
// incompleteness and closers after it, never before. A real error on
// settled text above the incompleteness has a cover row as its only
// mapping; file-wide suppression traded it for silence.
import { describe, test, expect } from 'bun:test';
import { applyRipDirectives, mapTsDiagnostic } from '../../src/diagnostics.js';
import { Mappings } from '../../../../src/stores.js';

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

test('identical mapped manifestations collapse before directive handling', () => {
  const mapped = [
    {
      code: 7006, severity: 1, message: "Parameter 'item' implicitly has an 'any' type.",
      range: { start: { line: 58, character: 10 }, end: { line: 58, character: 14 } },
    },
    {
      code: 7006, severity: 1, message: "Parameter 'item' implicitly has an 'any' type.",
      range: { start: { line: 58, character: 10 }, end: { line: 58, character: 14 } },
    },
    {
      code: 7006, severity: 1, message: "Parameter 'other' implicitly has an 'any' type.",
      range: { start: { line: 58, character: 10 }, end: { line: 58, character: 15 } },
    },
  ];
  expect(applyRipDirectives({ source: '' }, mapped)).toEqual([mapped[0], mapped[2]]);
});

// Two renderings of one claim can mark different EXTENTS of the same span
// (`: T` against `T`), which the identity collapse above cannot see. The
// narrowest keeps it.
test('a claim on nested spans collapses to the narrowest', () => {
  const at = (sc, ec) => ({ start: { line: 3, character: sc }, end: { line: 3, character: ec } });
  const mapped = [
    { code: 2304, severity: 1, message: "Cannot find name 'Nope'.", range: at(5, 11) },
    { code: 2304, severity: 1, message: "Cannot find name 'Nope'.", range: at(7, 11) },
    { code: 2304, severity: 1, message: "Cannot find name 'Other'.", range: at(5, 11) },
  ];
  expect(applyRipDirectives({ source: '' }, mapped)).toEqual([mapped[1], mapped[2]]);
});

// A directive is charged by a diagnostic STARTING on its governed line, so
// the nested collapse has to run AFTER charging: collapsing first can retire
// the only row that starts there and leave the directive reading unused,
// resurrecting the TS2578 the charge exists to drop.
test('the wider span still charges its directive before the collapse', () => {
  const source = 'x = 1\n# @ts-expect-error\nouter\ninner\n';
  const wide = {
    code: 2304, severity: 1, message: "Cannot find name 'Nope'.",
    range: { start: { line: 2, character: 0 }, end: { line: 3, character: 9 } },
  };
  const narrow = {
    code: 2304, severity: 1, message: "Cannot find name 'Nope'.",
    range: { start: { line: 3, character: 2 }, end: { line: 3, character: 6 } },
  };
  // TS2578 lands on the directive comment itself (line 1).
  const unused = {
    code: 2578, severity: 1, message: "Unused '@ts-expect-error' directive.",
    range: { start: { line: 1, character: 0 }, end: { line: 1, character: 19 } },
  };
  const out = applyRipDirectives({ source }, [wide, narrow, unused]);
  // The directive absorbed the wide one and is therefore USED, so its
  // TS2578 drops; the narrow one is not on a governed line and survives.
  expect(out).toEqual([narrow]);
});
