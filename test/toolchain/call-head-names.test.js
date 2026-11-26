// Every call is ["call", attrs, callee, ...args], so the head string
// `call` sits in every call node. A user binding named `call` is an
// ordinary name: no walk may read the head as a reference to it.
import { test, expect } from 'bun:test';
import { compile } from '../../src/compiler.js';

const js = (src) => compile(src, { path: 'x.rip', runtimeDelivery: 'none' }).code;

test('a binding named call keeps its declaration in place after earlier calls', () => {
  expect(js('f = -> g()\ncall = (x) -> x\n')).toContain('let call = function(x)');
});

test('a type-only import named call is elided though the file makes calls', () => {
  const code = js('import { call } from "./m.rip"\nx: call = 1\nconsole.log x\n');
  expect(code).toContain("import './m.rip';");
  expect(code).not.toContain('import { call }');
});

test('a dead render local named call still rejects when the render makes calls', () => {
  expect(() => js('A = component\n  x := true\n  render\n    div\n      call = 1\n      if x\n        p fmt(1)\n'))
    .toThrow(/render local 'call' is never read/);
});

test('a reactive binding named call does not make every render call live', () => {
  const code = js('call := 0\nA = component\n  render\n    p fmt(1)\n');
  expect(code).toContain('createTextNode(String(fmt(1)))');
  expect(code).not.toContain('__effect');
});

test('an optional member call in render text reads like any other call', () => {
  // Only a plain call of a component method is a live read; the optional
  // spelling and a bare optional call both stay static.
  const code = js('A = component\n  g: (x) -> x\n  render\n    p "#{@g?(2)}"\n');
  expect(code).not.toContain('__effect');
});
