// The emitter switch and the v1/v2 differential (test/support/emit-diff.js).
// Over every language-suite row, v2 must never emit something v1 does not:
// zero unexplained differences, zero stale ledger entries, and at least
// FLOOR programs identical per option set. Each lowering PR raises FLOOR
// to what it covers; the whole corpus runs through scripts/emit-diff.mjs.
import { test, expect, describe } from 'bun:test';
import { join } from 'node:path';
import { compile, parseSource } from '../../src/compiler.js';
import { emit as emitV2, EmitUnimplemented } from '../../src/emit/index.js';
import { resolveEmitter } from '../../src/emit/switch.js';
import { rowInputs } from '../support/consumer-hashes.js';
import { differential, loadLedger } from '../support/emit-diff.js';

const root = join(import.meta.dir, '../..');

// Identical programs per option set over the language rows.
const FLOOR = 0;

describe('the emitter switch', () => {
  test('an explicit option wins over the environment default', () => {
    expect(resolveEmitter('v2', null)).toBe('v2');
    expect(resolveEmitter('v1', 'v2')).toBe('v1');
  });

  test('with no option, RIP_EMITTER decides, and unset or empty means v1', () => {
    expect(resolveEmitter(undefined, null)).toBe('v1');
    expect(resolveEmitter(undefined, '')).toBe('v1');
    expect(resolveEmitter(undefined, 'v2')).toBe('v2');
  });

  test('a value that names no engine rejects, from either channel', () => {
    expect(() => resolveEmitter('v3', null)).toThrow(`compile: unknown emitter "v3" — expected 'v1' or 'v2'`);
    expect(() => resolveEmitter(undefined, 'V2')).toThrow(`RIP_EMITTER: unknown emitter "V2" — expected 'v1' or 'v2'`);
    expect(() => compile('x = 1', { emitter: 'next' })).toThrow(`compile: unknown emitter "next"`);
  });

  test('both engines emit an empty program to the same record, in every option set', () => {
    const inputs = [
      { key: 'empty', src: '', path: 'empty.rip' },
      { key: 'comment only', src: '# a comment\n', path: 'comment.rip' },
    ];
    const { summary, different } = differential(inputs);
    expect(different).toEqual([]);
    for (const counts of Object.values(summary)) expect(counts.identical).toBe(2);
  });

  test('compile() routes to the engine the option names', () => {
    for (const face of ['js', 'ts']) {
      const a = compile('# a comment\n', { face, emitter: 'v1' });
      const b = compile('# a comment\n', { face, emitter: 'v2' });
      expect(b.code).toBe(a.code);
      expect(b.mappings.rows).toEqual(a.mappings.rows);
    }
    expect(() => compile('x = 1', { emitter: 'v1' })).not.toThrow();
    expect(() => compile('x = 1', { emitter: 'v2' })).toThrow("emitter v2: 'assign' is not implemented yet");
  });
});

describe('v2 rejects what it does not lower', () => {
  test('at the node, naming its kind, as an EmitUnimplemented', () => {
    const parsed = parseSource('# lead\ncount = 1\n');
    let err;
    try { emitV2(parsed.result, { source: parsed.source }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(EmitUnimplemented);
    expect(err.message).toBe("emitter v2: 'assign' is not implemented yet");
    expect([err.start, err.end]).toEqual([7, 16]);
  });

  test('through compile(), as a positioned diagnostic', () => {
    expect(() => compile('# lead\ncount = 1\n', { emitter: 'v2', path: 'probe.rip' }))
      .toThrow("probe.rip:2:1: emitter v2: 'assign' is not implemented yet");
  });

  test("v2 validates emit() options with v1's messages", () => {
    const parsed = parseSource('');
    expect(() => emitV2(parsed.result, { face: 'dts' })).toThrow("emitter: unknown face 'dts'");
    expect(() => emitV2(parsed.result, { runtimeDelivery: 'eager' })).toThrow("emitter: unknown runtimeDelivery 'eager'");
    expect(() => emitV2({ sexpr: null })).toThrow('emitter: cannot emit a failed parse');
  });
});

describe('the differential over the language rows', () => {
  test('no unexplained difference, no stale ledger entry, coverage at or above the floor', async () => {
    const inputs = await rowInputs(root);
    const { summary, different, stale } = differential(inputs, {
      sets: ['js-none', 'js-repl', 'ts-import'],
      ledger: loadLedger(root),
    });
    expect(different.map((d) => `[${d.set}] ${d.key}: ${d.detail}`)).toEqual([]);
    expect(stale.map((e) => `[${e.set}] ${e.key}`)).toEqual([]);
    for (const [set, counts] of Object.entries(summary)) {
      expect({ set, covered: counts.identical >= FLOOR }).toEqual({ set, covered: true });
    }
  }, 60000);

  test('every ledger entry names a program, an option set, a reason and both hashes', () => {
    for (const entry of loadLedger(root)) {
      expect(Object.keys(entry).sort()).toEqual(['key', 'reason', 'set', 'v1', 'v2']);
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });
});
