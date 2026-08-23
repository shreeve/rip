// The declaration-scope gate reads the compile's own token tape, so the
// gate and the face describe one text: a `__DATA__` payload is not code,
// and a tolerant compile's recovered face is gated like any other.
import { describe, test, expect } from 'bun:test';
import { compile } from '../../../../src/compile.js';
import { scopeGateOf } from '../../src/scopes.js';

const gateOf = (source, opts = {}) => {
  const result = compile(source, { path: '/g.rip', face: 'ts', runtimeDelivery: 'inline', ...opts });
  return Array.from(scopeGateOf(result.tokens, source, result, null));
};

describe('the gate reads the compile\'s text', () => {
  test('a __DATA__ payload seeds no binding: an annotation spelled in the payload does not type the code above it', () => {
    const code = 'n = 5\nbad = n.toUpperCase()\nconsole.log bad\n';
    expect(gateOf(code)).toEqual([0, 0, 0, 0]);
    // The same code over a payload that, read as code, would annotate `n`.
    expect(gateOf(code + '__DATA__\nn: number = 1\n')).toEqual([0, 0, 0, 0, 0, 0]);
  });

  test('a payload the lexer would refuse leaves the gate defined: the payload is never lexed', () => {
    const code = 'x = 1\ny = x.bar.baz\nz: number = "s"\n';
    expect(gateOf(code + "__DATA__\nit's payload\n")).toEqual([0, 0, 1, 0, 0, 0]);
  });

  test('a tolerant compile gates its recovered face: an unclosed bracket mid-edit does not throw the file open', () => {
    const closed = 'x: number = 1\nfoo(x)\ny = 5\nz = y.nope()\n';
    const open = 'x: number = 1\nfoo(x\ny = 5\nz = y.nope()\n';
    expect(gateOf(closed)).toEqual([1, 1, 0, 0, 0]);
    const recovered = compile(open, { path: '/g.rip', face: 'ts', runtimeDelivery: 'inline', tolerant: true });
    expect(recovered.parseDiagnostics.length).toBeGreaterThan(0);
    expect(Array.from(scopeGateOf(recovered.tokens, open, recovered, null))).toEqual([1, 1, 0, 0, 0]);
  });
});
