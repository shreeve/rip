import { describe, expect, test } from 'bun:test';
import { Decimal } from '@rip-lang/decimal';
import { registerDecimalCoercer } from '@rip-lang/decimal/coercers';
import { registerCoercer } from '../../../src/runtime/schema.js';
import { Custom, Invoice } from './fixtures/invoice.rip';

describe('the ~:Decimal schema coercer', () => {
  test('hydrates a wire string into a Decimal, scale preserved', () => {
    const inv = Invoice.parse({ amount: '19.990' });
    expect(Decimal.isDecimal(inv.amount)).toBeTrue();
    expect(inv.amount.toString()).toBe('19.990');
  });

  test('a wire number arrives through the string pipeline', () => {
    const inv = Invoice.parse({ amount: 5, tip: '0.50' });
    expect(inv.amount.toString()).toBe('5');
    expect(inv.tip.toString()).toBe('0.50');
  });

  test('a coercion miss is a structured coerce issue', () => {
    for (const amount of ['abc', '$1.00', '1,000', 'NaN']) {
      const bad = Invoice.safe({ amount });
      expect(bad.ok).toBeFalse();
      expect(bad.errors[0]).toMatchObject({ field: 'amount', error: 'coerce' });
    }
  });

  test('the bridge registers under any name', () => {
    registerDecimalCoercer('Dec2');
    const row = Custom.parse({ n: '0.125' });
    expect(Decimal.isDecimal(row.n)).toBeTrue();
    expect(row.n.toString()).toBe('0.125');
  });

  test('name collisions reject loudly', () => {
    expect(() => registerCoercer('Decimal', v => v)).toThrow(/already registered/);
    expect(() => registerDecimalCoercer('Dec2')).toThrow(/already registered/);
  });
});
