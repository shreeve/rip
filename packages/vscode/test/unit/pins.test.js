// Tier 3 pin probe — the probe builder and hover parser as units.
// The LSP stdio half lives in test/editor/pins-lsp.test.js.
import { test, expect, describe } from 'bun:test';
import { buildProbe, parseProbeHover, buildVerify, refusedByVerify } from '../../src/pins.js';

describe('buildProbe', () => {
  test('splices a probe declaration above the first write, same indent', () => {
    const face = 'let items;\n\nitems = [1, 2];\nrest();\n';
    const stmt = face.indexOf('items = [1, 2];');
    const value = face.indexOf('[1, 2]');
    const { text, positions } = buildProbe(face, [
      { name: 'items', key: 'items@x', stmtGen: [stmt, stmt + 15], valueGen: [value, value + 6] },
    ]);
    expect(text).toContain('let __rip_probe_0_items = [1, 2];\nitems = [1, 2];');
    const p = positions[0];
    expect(text.split('\n')[p.line].slice(p.character)).toStartWith('__rip_probe_0_items');
  });

  test('multiple pinnables splice bottom-up and never collide, even same-named', () => {
    const face = 'a = f();\nfunction g() {\n  a = h();\n}\n';
    const s1 = 0, s2 = face.indexOf('a = h()');
    const { text, positions } = buildProbe(face, [
      { name: 'a', key: 'k1', stmtGen: [s1, s1 + 7], valueGen: [s1 + 4, s1 + 7] },
      { name: 'a', key: 'k2', stmtGen: [s2, s2 + 7], valueGen: [s2 + 4, s2 + 7] },
    ]);
    expect(text).toContain('let __rip_probe_0_a = f();\na = f();');
    expect(text).toContain('  let __rip_probe_1_a = h();\n  a = h();'); // indent copied
    expect(positions[0]).not.toBeNull();
    expect(positions[1]).not.toBeNull();
    expect(positions[0].line).toBeLessThan(positions[1].line);
  });
});

describe('parseProbeHover', () => {
  const hover = (sig) => ({ contents: { value: '```typescript\n' + sig + '\n```' } });
  test('extracts the declared type', () => {
    expect(parseProbeHover(hover('let __rip_probe_0_items: string[]'))).toBe('string[]');
  });
  test('collapses multi-line object types', () => {
    expect(parseProbeHover(hover('let __rip_probe_2_api: {\n  run(): number;\n}'))).toBe('{ run(): number; }');
  });
  test('rejects any, truncation, and junk', () => {
    expect(parseProbeHover(hover('let __rip_probe_0_x: any'))).toBeNull();
    expect(parseProbeHover(hover('let __rip_probe_0_x: { a: 1; ... 24 more }'))).toBeNull();
    expect(parseProbeHover({ contents: { value: 'no fence here' } })).toBeNull();
    expect(parseProbeHover(null)).toBeNull();
  });
  // An answer naming a probe symbol cannot outlive the probe file. tsgo types
  // an anonymous class by its own binding, so a class-expression RHS answers
  // `typeof __rip_probe_N_<name>` — accepted, that annotates the REAL binding
  // with a name deleted along with the probe, and tsgo then publishes TS2304
  // on legal code, spelled in vocabulary the author can find nowhere. The
  // probe round's doctrine is that every failure path lands on the status
  // quo, so this caches null and the binding stays an unpinned evolving
  // `any`. Not only SELF-reference: a sibling probe's symbol dangles the same
  // way once the file is gone.
  test('rejects an answer naming a probe symbol — it cannot outlive the probe file', () => {
    expect(parseProbeHover(hover('let __rip_probe_0_Box: typeof __rip_probe_0_Box'))).toBeNull();
    expect(parseProbeHover(hover('let __rip_probe_1_make: () => __rip_probe_0_Box'))).toBeNull();
    // The ordinary answer is unaffected — the clause reads the TYPE, never the
    // declaration's own minted name, which every probe answer carries.
    expect(parseProbeHover(hover('let __rip_probe_0_items: string[]'))).toBe('string[]');
  });
});

// A hover answer is verified where the pin will live: one `declare let`
// per answer, appended at the probe's top level, and a diagnostic on that
// line refuses the answer by its ORIGINAL index — the index the pinnables
// array and the answers array share, not the position among the answers
// that survived parsing.
describe('buildVerify', () => {
  test('appends one top-level declaration per answer, keyed by answer index', () => {
    const probe = 'let a;\nlet b;\n'
    const { text, lineOf } = buildVerify(probe, ['string[]', 'Stats'])
    expect(text).toBe('let a;\nlet b;\ndeclare let __rip_verify_0: string[];\ndeclare let __rip_verify_1: Stats;\n')
    expect(text.split('\n')[2]).toBe('declare let __rip_verify_0: string[];')
    expect(lineOf.get(2)).toBe(0)
    expect(lineOf.get(3)).toBe(1)
    expect(lineOf.size).toBe(2)
  })

  test('a null answer takes no line and does not shift the indices after it', () => {
    const { text, lineOf } = buildVerify('x();\n', [null, 'number', null, 'Stats'])
    expect(text).toBe('x();\ndeclare let __rip_verify_1: number;\ndeclare let __rip_verify_3: Stats;\n')
    expect(lineOf.get(1)).toBe(1)
    expect(lineOf.get(2)).toBe(3)
    expect(lineOf.size).toBe(2)
  })

  test('a probe without a trailing newline still starts its verify lines on fresh lines', () => {
    const { text, lineOf } = buildVerify('let a;\nlet b;', ['number'])
    expect(text).toBe('let a;\nlet b;\ndeclare let __rip_verify_0: number;\n')
    expect(lineOf.get(2)).toBe(0)
  })

  test('no answers leaves the probe untouched', () => {
    const { text, lineOf } = buildVerify('let a;\n', [null, null])
    expect(text).toBe('let a;\n')
    expect(lineOf.size).toBe(0)
  })
})

describe('refusedByVerify', () => {
  const at = (line, code) => ({ code, range: { start: { line, character: 0 }, end: { line, character: 10 } } })
  const lineOf = new Map([[5, 0], [6, 2]])

  test('a diagnostic on a verify line refuses that answer index', () => {
    expect(refusedByVerify([at(6, 2304)], lineOf)).toEqual(new Set([2]))
  })

  test('any diagnostic refuses — the code is not consulted', () => {
    expect(refusedByVerify([at(5, 2552), at(6, 7006)], lineOf)).toEqual(new Set([0, 2]))
  })

  test('diagnostics off the verify lines refuse nothing', () => {
    expect(refusedByVerify([at(0, 2304), at(4, 2304), at(7, 2304)], lineOf)).toEqual(new Set())
  })

  test('tolerates a missing pull and malformed items', () => {
    expect(refusedByVerify(null, lineOf)).toEqual(new Set())
    expect(refusedByVerify(undefined, lineOf)).toEqual(new Set())
    expect(refusedByVerify([null, {}, { range: null }, at(5, 2304)], lineOf)).toEqual(new Set([0]))
  })
})
