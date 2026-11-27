// The emitter switch and the v1/v2 differential (test/support/emit-diff.js).
// Over every language-suite row and every caller option set, v2 never
// emits something v1 does not: zero unexplained differences, zero stale
// ledger entries, and at least FLOOR programs identical per option set.
// FLOOR is the number of language rows v2 emits identically today; the
// whole corpus runs through scripts/emit-diff.mjs.
import { test, expect, describe } from 'bun:test';
import { join } from 'node:path';
import { compile, parseSource } from '../../src/compiler.js';
import { emit as emitV2, lower, EmitUnimplemented } from '../../src/emit/index.js';
import { resolveEmitter } from '../../src/emit/switch.js';
import { rowInputs } from '../support/consumer-hashes.js';
import { differential, loadLedger, OPTION_SETS } from '../support/emit-diff.js';

const root = join(import.meta.dir, '../..');

const FLOOR = 0;

// The option sets whose options v2 honors; the rest set an option v2
// rejects (src/emit/index.js unhonored()).
const HONORED_SETS = ['js-inline', 'js-import', 'js-none', 'ts-import', 'ts-tolerant'];

const rejection = (fn) => {
  try { fn(); } catch (err) { return err; }
  return null;
};

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
  });

  test('compile() rejects an unknown engine with the path, before the parse', () => {
    expect(() => compile('x = 1', { emitter: 'next', path: 'a.rip' })).toThrow(`a.rip: compile: unknown emitter "next"`);
    expect(() => compile('x = (', { emitter: 'next', path: 'a.rip' })).toThrow(`a.rip: compile: unknown emitter "next"`);
  });

  test('both engines emit an empty program to the same record in every set v2 honors', () => {
    const inputs = [
      { key: 'row empty', src: '', path: 'empty.rip' },
      { key: 'row comment only', src: '# a comment\n', path: 'comment.rip' },
    ];
    const { summary, different } = differential(inputs);
    expect(different).toEqual([]);
    for (const [set, counts] of Object.entries(summary)) {
      const expected = HONORED_SETS.includes(set) ? { identical: 2, unimplemented: 0 } : { identical: 0, unimplemented: 2 };
      expect({ set, identical: counts.identical, unimplemented: counts.unimplemented }).toEqual({ set, ...expected });
    }
  });

  test('compile() routes to the engine the option names', () => {
    for (const face of ['js', 'ts']) {
      const a = compile('# a comment\n', { face, emitter: 'v1' });
      const b = compile('# a comment\n', { face, emitter: 'v2' });
      expect(b.code).toBe(a.code);
      expect(b.mappings.rows).toEqual(a.mappings.rows);
    }
    expect(() => compile('x = 1', { emitter: 'v1' })).not.toThrow();
    expect(() => compile('x = 1', { emitter: 'v2' })).toThrow("emitter v2: no lowering for 'assign'");
  });
});

describe('v2 rejects what it does not lower', () => {
  test('a node, at its span, naming its kind', () => {
    const parsed = parseSource('# lead\ncount = 1\n');
    const err = rejection(() => emitV2(parsed.result, { source: parsed.source }));
    expect(err).toBeInstanceOf(EmitUnimplemented);
    expect(err.message).toBe("emitter v2: no lowering for 'assign'");
    expect([err.kind, err.start, err.end]).toEqual(['assign', 7, 16]);
  });

  test('through compile(), as a positioned diagnostic', () => {
    expect(() => compile('# lead\ncount = 1\n', { emitter: 'v2', path: 'probe.rip' }))
      .toThrow("probe.rip:2:1: emitter v2: no lowering for 'assign'");
  });

  test('the __DATA__ payload, at its marker line', () => {
    const err = rejection(() => compile('# lead\n__DATA__\nhello\n', { emitter: 'v2', path: 'd.rip' }));
    expect(err.message).toStartWith('d.rip:2:1: emitter v2: no lowering for the __DATA__ payload');
    expect(compile('# lead\n__DATA__\nhello\n').code).toContain('let DATA = __data__();');
  });

  test('a TS directive comment on the TS face, at the comment', () => {
    const src = '# @ts-nocheck\n';
    const err = rejection(() => compile(src, { face: 'ts', emitter: 'v2', path: 't.rip' }));
    expect(err.message).toStartWith('t.rip:1:1: emitter v2: no lowering for a TS directive comment');
    expect(compile(src, { face: 'ts' }).code).toContain('// @ts-nocheck');
    // The JS face carries no directive, so both engines agree there.
    expect(compile(src, { emitter: 'v2' }).code).toBe(compile(src).code);
  });

  test('every option that changes what v1 emits', () => {
    const parsed = parseSource('');
    const cases = {
      repl: { repl: true }, hmr: { hmr: true }, script: { script: true }, strict: { strict: true },
      browserModule: { browserModule: true }, pins: { pins: new Map() },
      ambientBindings: { ambientBindings: [{ name: 'a', kind: 'plain' }] },
      appStashSpec: { appStashSpec: {} }, routesUnion: { routesUnion: '' }, routeParams: { routeParams: {} },
    };
    for (const [name, options] of Object.entries(cases)) {
      const err = rejection(() => emitV2(parsed.result, { source: '', ...options }));
      expect({ name, message: err?.message, unimplemented: err instanceof EmitUnimplemented })
        .toEqual({ name, message: `emitter v2: no lowering for the ${name} option`, unimplemented: true });
    }
    expect(() => emitV2(parsed.result, { source: '', ambientBindings: [] })).not.toThrow();
  });

  test('a malformed tree node is a defect, never an unlowered construct', () => {
    const parsed = parseSource('');
    const ctx = { stores: { idOf: () => null, node: () => null } };
    for (const bad of [{}, 'x', [], [1, {}], null]) {
      const err = rejection(() => lower(ctx, bad));
      expect(err).not.toBeInstanceOf(EmitUnimplemented);
      expect(err.message).toStartWith('emitter v2: lower() was handed');
    }
    expect(parsed.result.sexpr[0]).toBe('program');
  });

  test("v2 validates emit() options with v1's messages", () => {
    const parsed = parseSource('');
    for (const ambientBindings of [{}, 5, true, { length: 0 }]) {
      const message = `emitter: ambientBindings must be an array of {name, kind}; got ${typeof ambientBindings}`;
      expect(() => emitV2(parsed.result, { ambientBindings })).toThrow(message);
      expect(() => compile('', { ambientBindings, emitter: 'v1' })).toThrow(message);
    }
    expect(() => emitV2(parsed.result, { face: 'dts' })).toThrow("emitter: unknown face 'dts'");
    expect(() => emitV2(parsed.result, { runtimeDelivery: 'eager' })).toThrow("emitter: unknown runtimeDelivery 'eager'");
    expect(() => emitV2({ sexpr: null })).toThrow('emitter: cannot emit a failed parse');
  });
});

describe('the ledger', () => {
  test('an entry naming no program, no option set, or a moved output is stale', () => {
    const inputs = [{ key: 'row probe', src: '', path: 'p.rip' }];
    const ledger = [
      { key: 'row probe', set: 'js-none', reason: 'identical now', v1: 'a', v2: 'b' },
      { key: 'row gone', set: 'js-none', reason: 'no such program', v1: 'a', v2: 'b' },
      { key: 'row probe', set: 'js-nowhere', reason: 'no such set', v1: 'a', v2: 'b' },
      { key: 'row probe', set: 'toString', reason: 'an inherited name is no set', v1: 'a', v2: 'b' },
      { key: 'rowprobe', set: 'js-none', reason: 'no namespace', v1: 'a', v2: 'b' },
      { key: 'pkg elsewhere.rip', set: 'js-none', reason: 'outside this run', v1: 'a', v2: 'b' },
    ];
    const { stale } = differential(inputs, { sets: ['js-none'], ledger });
    expect(stale.map((e) => e.reason)).toEqual(['identical now', 'no such program', 'no such set', 'an inherited name is no set', 'no namespace']);
  });

  test('every entry names a program, a known option set, a reason and both hashes', () => {
    for (const entry of loadLedger(root)) {
      expect(Object.keys(entry).sort()).toEqual(['key', 'reason', 'set', 'v1', 'v2']);
      expect(entry.key).toMatch(/^(pkg|row) /);
      expect(Object.keys(OPTION_SETS)).toContain(entry.set);
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('the differential over the language rows', () => {
  test('no unexplained difference, no stale ledger entry, coverage at or above the floor', async () => {
    const inputs = await rowInputs(root);
    const { summary, different, stale } = differential(inputs, { ledger: loadLedger(root) });
    expect(different.map((d) => `[${d.set}] ${d.key}: ${d.detail}`)).toEqual([]);
    expect(stale.map((e) => `[${e.set}] ${e.key}`)).toEqual([]);
    for (const [set, counts] of Object.entries(summary)) {
      expect({ set, covered: counts.identical >= FLOOR }).toEqual({ set, covered: true });
    }
  }, 120000);
});
