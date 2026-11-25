// compile() is parseSource() then emitSource(). A caller may emit one parse
// more than once (rip check re-emits a probed file with pins), so emission
// must never change the parse it reads: every emission from one parse equals
// a fresh compile with the same options, field for field.

import { test, expect, describe } from 'bun:test';
import { compile, parseSource, emitSource } from '../../src/compiler.js';

const fields = (r) => JSON.stringify({
  code: r.code,
  map: r.map,
  mappings: r.mappings,
  pinnables: r.pinnables,
  pinSpans: r.pinSpans,
  echoSpans: r.echoSpans,
  runtimeRefs: r.runtimeRefs,
  imports: r.imports,
  declarations: r.declarations,
});

// A module binding read inside a function body: the TS face offers it as
// a pinnable, so pins change what the emitter writes.
const PINNABLE = "items = [{ name: 'duck', price: 399 }]\nexport def total()\n  items.length\n";

describe('parseSource / emitSource', () => {
  test('emitting a parse equals compiling the source, on both faces', () => {
    for (const face of ['js', 'ts']) {
      const opts = { path: 'x.rip', face, runtimeDelivery: 'import' };
      expect(fields(emitSource(parseSource(PINNABLE, opts), opts))).toBe(fields(compile(PINNABLE, opts)));
    }
  });

  test('one parse emits unpinned and pinned faces exactly as fresh compiles do', () => {
    const opts = { path: 'x.rip', face: 'ts', runtimeDelivery: 'import' };
    const parsed = parseSource(PINNABLE, opts);
    const plain = emitSource(parsed, opts);
    expect(plain.pinnables.length).toBeGreaterThan(0);
    const pins = new Map(plain.pinnables.map((p) => [p.key, 'number']));
    const pinned = emitSource(parsed, { ...opts, pins });
    expect(pinned.code).not.toBe(plain.code);
    expect(fields(pinned)).toBe(fields(compile(PINNABLE, { ...opts, pins })));
    expect(fields(emitSource(parsed, { ...opts, pins }))).toBe(fields(pinned));
    expect(fields(emitSource(parsed, opts))).toBe(fields(plain));
  });

  test('an emission whose face, tolerance or path differs from the parse rejects', () => {
    const parsed = parseSource('x = 1', { path: 'a.rip', face: 'ts' });
    expect(() => emitSource(parsed, { path: 'a.rip', face: 'js' })).toThrow('emitSource: emits the parse it was given');
    expect(() => emitSource(parsed, { path: 'a.rip', face: 'ts', tolerant: true })).toThrow('must match the parse');
    expect(() => emitSource(parsed, { path: 'b.rip', face: 'ts' })).toThrow('must match the parse');
  });
});
