import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { compile } from '../../src/compile.js';
import { tokenize } from '../../src/lexer.js';

const fails = (source, pattern) => {
  let error;
  try {
    compile(source, { runtimeDelivery: 'none' });
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeDefined();
  expect(error.message).toMatch(pattern);
  return error;
};

describe('render gates', () => {
  test('only adjacent `<~` tokenizes as GATE', () => {
    const tight = tokenize('x <~ @app.data.x').tokens;
    expect(tight.find((token) => token.kind === 'GATE')).toMatchObject({
      value: '<~',
      start: 2,
      end: 4,
    });
    const spaced = tokenize('x < ~load()').tokens;
    expect(spaced.some((token) => token.kind === 'GATE')).toBe(false);
    expect(spaced.some((token) => token.kind === 'COMPARE' && token.value === '<')).toBe(true);
    expect(compile('x < ~load()', { runtimeDelivery: 'none' }).code).toBe('x < (~load());');
  });

  test('path and key analysis emits only literal app descriptors', () => {
    const source = [
      'A = component',
      '  account <~ @app.data.accounts.current',
      '  byParam <~ @app.data.order(params.id)',
      '  byQuery <~ @app.data.search(@query.term)',
      '  byLiteral <~ @app.data.page(2)',
      '  render null',
    ].join('\n');
    const { code } = compile(source, { runtimeDelivery: 'none' });
    expect(code).toContain(
      "static __gates = ['accounts.current', { path: 'order', key: (params, query) => params.id }, " +
      "{ path: 'search', key: (params, query) => query.term }, { path: 'page', key: (params, query) => 2 }];",
    );
  });

  test('placement, target, path, arity, and key failures are precisely positioned', () => {
    const outside = 'user <~ @app.data.user';
    const outsideError = fails(outside, /only be used as a direct component body line/);
    expect(outside.slice(outsideError.start, outsideError.end)).toBe(outside);

    const publicTarget = 'C = component\n  @user <~ @app.data.user\n  render null';
    const publicError = fails(publicTarget, /render gate 'user' must be private/);
    expect(publicTarget.slice(publicError.start, publicError.end)).toBe('@user');

    const nonliteral = 'C = component\n  user <~ someVar.user\n  render null';
    const pathError = fails(nonliteral, /requires a literal @app\.data\.<path>/);
    expect(nonliteral.slice(pathError.start, pathError.end)).toBe('someVar.user');

    const arity = 'C = component\n  user <~ @app.data.user(params.id, query.tab)\n  render null';
    const arityError = fails(arity, /takes exactly one key argument/);
    expect(arity.slice(arityError.start, arityError.end)).toBe('params.id, query.tab');

    const badKey = 'C = component\n  user <~ @app.data.user(local)\n  render null';
    const keyError = fails(badKey, /key may only be a literal or a params\/query path/);
    expect(badKey.slice(keyError.start, keyError.end)).toBe('local');
  });

  test('gate lowering records target, operator, rhs, and key mapping facts', () => {
    const source = 'A = component\n  order <~ @app.data.order(params.id)\n  render null';
    const result = compile(source, { runtimeDelivery: 'none' });
    const gate = result.stores.nodesByKind('gate')[0];
    expect(result.stores.rolesOf(gate.nodeId).map((row) => row.role))
      .toEqual(['target', 'rhs', 'key', 'operator']);

    const targetRows = result.mappings.of(gate.nodeId, 'target');
    expect(targetRows).toHaveLength(1);
    expect(targetRows[0].mappingKind).toBe('exact');
    expect(result.code.slice(targetRows[0].generatedStart, targetRows[0].generatedEnd)).toBe('order');

    const operatorRows = result.mappings.of(gate.nodeId, 'operator');
    expect(operatorRows).toHaveLength(2);
    expect(operatorRows.every((row) =>
      row.mappingKind === 'cover' && row.generatedStart === row.generatedEnd)).toBe(true);

    const rhsRows = result.mappings.of(gate.nodeId, 'rhs');
    expect(rhsRows).toHaveLength(2);
    expect(rhsRows.every((row) => row.mappingKind === 'cover')).toBe(true);

    const keyRows = result.mappings.of(gate.nodeId, 'key');
    expect(keyRows).toHaveLength(1);
    expect(keyRows.every((row) => row.mappingKind === 'exact')).toBe(true);
    const keyNodeRows = result.mappings.rows.filter((row) =>
      source.slice(row.sourceStart, row.sourceEnd) === 'params.id');
    expect(keyNodeRows).toHaveLength(2);
    expect(keyNodeRows.every((row) => row.mappingKind === 'exact')).toBe(true);
  });

  test('generated gate helper aliases dodge source bindings', () => {
    const source = [
      '__gateBind = null',
      'A = component',
      '  user <~ @app.data.user',
      '  render null',
    ].join('\n');
    for (const runtimeDelivery of ['none', 'import', 'inline']) {
      const { code } = compile(source, { runtimeDelivery });
      expect(code).toContain('this.user = __gateBind_(this, 0)');
      if (runtimeDelivery === 'import') {
        expect(code).toMatch(/__gateBind as __gateBind_/);
      }
      if (runtimeDelivery === 'inline') {
        expect(code).toMatch(/__gateBind:\s*__gateBind_/);
      }
    }
  });

  test('the TypeScript face makes gated constructors and static mount private', () => {
    const { code } = compile([
      'Page = component',
      '  user: { name: string } <~ @app.data.user',
      '  render null',
    ].join('\n'), { face: 'ts', runtimeDelivery: 'none' });
    expect(code).toContain('declare static mount: never;');
    expect(code).toContain('private constructor() { super(); }');
    expect(code).toContain('this.user = __gateBind(this, 0)');
  });

  test('import and inline delivery reject direct gated construction', () => {
    const source = [
      'A = component',
      '  user <~ @app.data.user',
      '  render null',
      'A.new()',
    ].join('\n');
    for (const runtimeDelivery of ['import', 'inline']) {
      const { code } = compile(source, { runtimeDelivery });
      const run = spawnSync('bun', ['-e', code], { encoding: 'utf8' });
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('cannot be constructed directly');
    }
  });
});
