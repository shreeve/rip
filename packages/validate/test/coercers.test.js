import { describe, expect, test } from 'bun:test';
import { getValidator, registerValidator } from '@rip-lang/validate';
import '@rip-lang/validate/coercers';
import { registerCoercer, SchemaError } from '../../../src/runtime/schema.js';
import { Order, Tick } from './fixtures/order.rip';

describe('the vocabulary powers ~:name schema coercion', () => {
  test('named coercers normalize schema fields', () => {
    const order = Order.parse({
      total: '$1,292.22',
      placed: '20240229',
      ssn: '123-45-6789',
    });
    expect(order.total).toBe(129222);
    expect(order.placed).toBe('2024-02-29');
    expect(order.ssn).toBe('123456789');
  });

  test('a coercion miss is a structured coerce issue', () => {
    const bad = Order.safe({ total: '1,00', placed: '2023-02-29' });
    expect(bad.ok).toBeFalse();
    const errors = Object.fromEntries(bad.errors.map(e => [e.field, e.error]));
    expect(errors).toEqual({ total: 'coerce', placed: 'coerce' });
  });

  test('a coerced false is a value, not a miss', () => {
    const order = Order.parse({ total: '5', placed: '2024-01-01', flag: 'no' });
    expect(order.flag).toBeFalse();
    expect(Order.parse({ total: '5', placed: '2024-01-01', flag: 'YES' }).flag).toBeTrue();
    expect(Order.safe({ total: '5', placed: '2024-01-01', flag: 'maybe' }).errors[0].error).toBe('coerce');
  });

  test('schema coercion trims wire input; check does not', () => {
    expect(Order.parse({ total: '5', placed: '2024-01-01', qty: ' 42 ' }).qty).toBe(42);
  });

  test('every vocabulary name is bridged', () => {
    const names = [
      'address', 'array', 'bool', 'cents', 'color', 'date', 'decimal',
      'email', 'falsy', 'float', 'hash', 'id', 'ids', 'int', 'ip', 'json',
      'mac', 'money', 'money_even', 'name', 'phone', 'semver', 'sex',
      'slug', 'ssn', 'state', 'string', 'text', 'time', 'time12', 'truthy',
      'url', 'username', 'uuid', 'whole', 'zip', 'zipplus4',
    ];
    for (const name of names) {
      expect(() => registerCoercer(name, v => v)).toThrow(/already registered/);
    }
  });

  test('a rejecting bridge leaves the validator registry unchanged', () => {
    registerCoercer('preclaimed', v => v);
    expect(() => registerValidator('preclaimed', v => v)).toThrow(/already registered/);
    expect(getValidator('preclaimed')).toBeUndefined();
  });

  test('a coercer-name collision rejects the bridge import, naming the coercer', () => {
    const run = Bun.spawnSync(
      ['bun', '-e', [
        "const { registerCoercer } = await import('../../src/runtime/schema.js');",
        "registerCoercer('money', v => v);",
        "await import('@rip-lang/validate/coercers');",
      ].join('\n')],
      { cwd: new URL('..', import.meta.url).pathname },
    );
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr.toString()).toMatch(/'~:money' is already registered/);
  });

  test('raw coercers receive values untouched', () => {
    const order = Order.parse({
      total: '5',
      placed: '2024-01-01',
      meta: { source: 'web' },
    });
    expect(order.meta).toEqual({ source: 'web' });
  });

  test('parse throws SchemaError carrying the coerce issue', () => {
    let caught = null;
    try {
      Order.parse({ total: 'x', placed: '2024-01-01' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SchemaError);
    expect(caught.issues[0]).toMatchObject({ field: 'total', error: 'coerce' });
  });

  test('validators registered after the bridge join the coercer table', () => {
    registerValidator('evenCents', v => {
      const n = parseInt(String(v), 10);
      return Number.isInteger(n) && n % 2 === 0 ? n : null;
    });
    expect(Tick.parse({ n: '42' }).n).toBe(42);
    expect(Tick.safe({ n: '41' }).errors[0].error).toBe('coerce');
  });

  test('re-registering a bridged name rejects loudly', () => {
    expect(() => registerCoercer('money', v => v)).toThrow(/already registered/);
  });

  test('an async coercer rejects loudly', () => {
    expect(() => registerCoercer('later', async v => v)).toThrow(/synchronous/);
  });
});
