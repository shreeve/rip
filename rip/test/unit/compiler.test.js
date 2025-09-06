import { test, expect, describe } from "bun:test";
import { loadModule } from './test-helpers.js';

const Compiler = (await loadModule('compiler')).default;

describe("Compiler", () => {
  const compiler = new Compiler();

  test("compiles numbers", () => {
    const ast = { type: 'num', val: '42' };
    const js = compiler.compile(ast);
    expect(js).toBe('42');
  });

  test("compiles strings", () => {
    const ast = { type: 'str', val: 'hello' };
    const js = compiler.compile(ast);
    expect(js).toBe('"hello"');
  });

  test("compiles identifiers", () => {
    const ast = { type: 'id', name: 'myVar' };
    const js = compiler.compile(ast);
    expect(js).toBe('myVar');
  });

  test("compiles binary operations", () => {
    const ast = {
      type: 'op',
      op: '+',
      left: { type: 'num', val: '1' },
      right: { type: 'num', val: '2' }
    };
    const js = compiler.compile(ast);
    expect(js).toBe('(1 + 2)');
  });

  test("compiles assignments", () => {
    const ast = {
      type: 'assign',
      target: { type: 'id', name: 'x' },
      value: { type: 'num', val: '42' }
    };
    const js = compiler.compile(ast);
    expect(js).toBe('let x = 42');
  });

  test("compiles function calls", () => {
    const ast = {
      type: 'call',
      func: { type: 'id', name: 'print' },
      args: [
        { type: 'str', val: 'hello' },
        { type: 'num', val: '42' }
      ]
    };
    const js = compiler.compile(ast);
    expect(js).toBe('print("hello", 42)');
  });

  test("compiles arrow functions", () => {
    const ast = {
      type: 'func',
      arrow: true,
      params: [{ type: 'id', name: 'x' }],
      body: {
        type: 'op',
        op: '*',
        left: { type: 'id', name: 'x' },
        right: { type: 'num', val: '2' }
      }
    };
    const js = compiler.compile(ast);
    expect(js).toBe('(x) => (x * 2)');
  });

  test("compiles blocks", () => {
    const ast = {
      type: 'block',
      stmts: [
        { type: 'assign', target: { type: 'id', name: 'x' }, value: { type: 'num', val: '1' } },
        { type: 'assign', target: { type: 'id', name: 'y' }, value: { type: 'num', val: '2' } }
      ]
    };
    const js = compiler.compile(ast);
    expect(js).toContain('let x = 1');
    expect(js).toContain('let y = 2');
  });

  test("compiles array literals", () => {
    const ast = {
      type: 'array',
      items: [
        { type: 'num', val: '1' },
        { type: 'num', val: '2' },
        { type: 'num', val: '3' }
      ]
    };
    const js = compiler.compile(ast);
    expect(js).toBe('[1, 2, 3]');
  });

  test("compiles object literals", () => {
    const ast = {
      type: 'object',
      pairs: [
        { key: { type: 'str', val: 'name' }, value: { type: 'str', val: 'Rip' } },
        { key: { type: 'str', val: 'version' }, value: { type: 'num', val: '1' } }
      ]
    };
    const js = compiler.compile(ast);
    expect(js).toBe('{name: "Rip", version: 1}');
  });

  test("compiles property access", () => {
    const ast = {
      type: 'access',
      object: { type: 'id', name: 'obj' },
      property: { type: 'prop', name: 'prop' },
      computed: false
    };
    const js = compiler.compile(ast);
    expect(js).toBe('obj.prop');
  });

  test("compiles computed property access", () => {
    const ast = {
      type: 'access',
      object: { type: 'id', name: 'arr' },
      property: { type: 'num', val: '0' },
      computed: true
    };
    const js = compiler.compile(ast);
    expect(js).toBe('arr[0]');
  });

  test("compiles return statements", () => {
    const ast = {
      type: 'return',
      expr: { type: 'num', val: '42' }
    };
    const js = compiler.compile(ast);
    expect(js).toBe('return 42');
  });

  test("compiles if statements", () => {
    const ast = {
      type: 'if',
      cond: { type: 'id', name: 'x' },
      then: { type: 'block', stmts: [{ type: 'return', expr: { type: 'num', val: '1' } }] },
      else: { type: 'block', stmts: [{ type: 'return', expr: { type: 'num', val: '2' } }] }
    };
    const js = compiler.compile(ast);
    expect(js).toContain('if (x)');
    expect(js).toContain('return 1');
    expect(js).toContain('else');
    expect(js).toContain('return 2');
  });

  test("handles special operators", () => {
    const ast = {
      type: 'op',
      op: '**',
      left: { type: 'num', val: '2' },
      right: { type: 'num', val: '3' }
    };
    const js = compiler.compile(ast);
    expect(js).toBe('Math.pow(2, 3)');
  });

  test("compiles 'is' to ===", () => {
    const ast = {
      type: 'op',
      op: 'is',
      left: { type: 'id', name: 'x' },
      right: { type: 'num', val: '5' }
    };
    const js = compiler.compile(ast);
    expect(js).toBe('x === 5');
  });

  test("compiles 'isnt' to !==", () => {
    const ast = {
      type: 'op',
      op: 'isnt',
      left: { type: 'id', name: 'x' },
      right: { type: 'null' }
    };
    const js = compiler.compile(ast);
    expect(js).toBe('x !== null');
  });

  test("compiles unary operations", () => {
    const ast = {
      type: 'unary',
      op: 'not',
      expr: { type: 'id', name: 'x' }
    };
    const js = compiler.compile(ast);
    expect(js).toBe('!x');
  });

  test("compiles root with statements", () => {
    const ast = {
      type: 'root',
      stmts: [
        { type: 'stmt', expr: { type: 'assign', target: { type: 'id', name: 'x' }, value: { type: 'num', val: '1' } } },
        { type: 'stmt', expr: { type: 'call', func: { type: 'id', name: 'print' }, args: [{ type: 'id', name: 'x' }] } }
      ]
    };
    const js = compiler.compile(ast);
    expect(js).toContain('let x = 1;');
    expect(js).toContain('print(x);');
  });
});