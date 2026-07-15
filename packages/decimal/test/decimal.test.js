// The v3 @rip-lang/decimal suite, carried over as the executable spec,
// plus adversarial pins (carry, signed zero, negative-operand division,
// negative scales, tiny magnitudes) verified against the v3
// implementation. Pure (no I/O), so it runs anywhere.
import { describe, expect, test } from 'bun:test';
import {
  D,
  Decimal,
  DecimalDivisionByZeroError,
  DecimalError,
  DecimalInexactError,
  DecimalInvalidOperationError,
  DecimalNonTerminatingError,
  DecimalParseError,
  DecimalRangeError,
  DecimalResourceLimitError,
  DecimalUnsafeConversionError,
} from '@rip-lang/decimal';

const dec = s => Decimal.parse(s);
const show = s => Decimal.parse(s).toString();

describe('parsing accepts strict decimal syntax', () => {
  test('valid forms', () => {
    expect(show('123')).toBe('123');
    expect(show('1.23')).toBe('1.23');
    expect(show('+1.5')).toBe('1.5');
    expect(show('.5')).toBe('0.5');
    expect(show('5.')).toBe('5');
    expect(show('001.2300')).toBe('1.2300');
    expect(show('1.230')).toBe('1.230');
    expect(show('-0.00')).toBe('0.00');
    expect(show('1.5e3')).toBe('1500');
    expect(show('1.23e-2')).toBe('0.0123');
    expect(show('0')).toBe('0');
    expect(show('0.00')).toBe('0.00');
  });

  test('exponent spellings', () => {
    expect(show('1e+5')).toBe('100000');
    expect(show('1E5')).toBe('100000');
    expect(show('.5e1')).toBe('5');
    expect(show('5.e1')).toBe('50');
    expect(show('0e99999')).toBe('0');
  });

  test('rejected forms', () => {
    expect(() => dec('')).toThrow(DecimalParseError);
    expect(() => dec(' 1.2')).toThrow(DecimalParseError);
    expect(() => dec('1.2 ')).toThrow(DecimalParseError);
    expect(() => dec('1_000')).toThrow(DecimalParseError);
    expect(() => dec('1,000')).toThrow(DecimalParseError);
    expect(() => dec('$1.00')).toThrow(DecimalParseError);
    expect(() => dec('NaN')).toThrow(DecimalParseError);
    expect(() => dec('Infinity')).toThrow(DecimalParseError);
    expect(() => dec('--1')).toThrow(DecimalParseError);
    expect(() => dec('.')).toThrow(DecimalParseError);
    expect(() => dec('e10')).toThrow(DecimalParseError);
  });
});

describe('canonical string and key', () => {
  test('canonical form strips insignificant zeros', () => {
    expect(dec('1.00').toCanonicalString()).toBe('1');
    expect(dec('1.50').toCanonicalString()).toBe('1.5');
    expect(dec('1.0').canonicalKey()).toBe(dec('1.00').canonicalKey());
    expect(dec('1.20').toJSON()).toBe('1.20');
  });

  test('every zero shares one canonical key', () => {
    expect(dec('0.00').canonicalKey()).toBe('0e0');
    expect(dec('-0').canonicalKey()).toBe('0e0');
  });
});

describe('exact arithmetic keeps explicit scale', () => {
  test('add/sub/mul scale rules', () => {
    expect(dec('1.20').add('3.4').toString()).toBe('4.60');
    expect(dec('1.00').sub('1.0').toString()).toBe('0.00');
    expect(dec('1.20').mul('3.0').toString()).toBe('3.600');
    expect(dec('0.1').add('0.2').toString()).toBe('0.3');
    expect(dec('2.5').mul(4n).toString()).toBe('10.0');
    expect(dec('1.5').neg().toString()).toBe('-1.5');
    expect(dec('-1.5').abs().toString()).toBe('1.5');
    expect(dec('1').sub('3').toString()).toBe('-2');
  });

  test('carry propagates across the whole coefficient', () => {
    expect(dec('9.999').add('0.001').toString()).toBe('10.000');
    expect(dec('0.95').quantizeToScale(1, 'HALF_UP').toString()).toBe('1.0');
    expect(dec('9.99').quantizeToScale(1, 'HALF_UP').toString()).toBe('10.0');
    expect(dec('99.995').quantizeToScale(2, 'HALF_UP').toString()).toBe('100.00');
  });

  test('there is no negative zero', () => {
    expect(dec('0').neg().toString()).toBe('0');
    expect(dec('0.00').neg().toString()).toBe('0.00');
    expect(dec('1.0').sub('1.00').toString()).toBe('0.00');
    expect(dec('-0').toString()).toBe('0');
    expect(dec('-0.00').signum()).toBe(0);
  });
});

describe('divExact terminates or throws', () => {
  test('terminating quotients are exact', () => {
    expect(dec('1').divExact('2').toString()).toBe('0.5');
    expect(dec('1').divExact('4').toString()).toBe('0.25');
    expect(dec('1').divExact('5').toString()).toBe('0.2');
    expect(dec('1').divExact('8').toString()).toBe('0.125');
    expect(dec('1').divExact('20').toString()).toBe('0.05');
    expect(dec('10').divExact('40').toString()).toBe('0.25');
    expect(dec('1').divExact('1024').toString()).toBe('0.0009765625');
    expect(dec('1').divExact('625').toString()).toBe('0.0016');
    expect(dec('-3').divExact('8').toString()).toBe('-0.375');
    expect(dec('7').divExact('7').toString()).toBe('1');
    expect(dec('22').divExact('11').toString()).toBe('2');
    expect(dec('1.5').divExact('0.3').toString()).toBe('5');
  });

  test('non-terminating and zero divisors throw', () => {
    expect(() => dec('1').divExact('3')).toThrow(DecimalNonTerminatingError);
    expect(() => dec('2').divExact('6')).toThrow(DecimalNonTerminatingError);
    expect(() => dec('1').divExact('0')).toThrow(DecimalDivisionByZeroError);
  });
});

describe('divToScale rounds at an explicit scale', () => {
  test('rounded quotients', () => {
    expect(dec('1').divToScale('3', 2, 'HALF_UP').toString()).toBe('0.33');
    expect(dec('2').divToScale('3', 4, 'HALF_EVEN').toString()).toBe('0.6667');
    expect(dec('10').divToScale('3', 0, 'FLOOR').toString()).toBe('3');
    expect(dec('-1').divToScale('3', 2, 'HALF_UP').toString()).toBe('-0.33');
    expect(() => dec('1').divToScale('0', 2, 'HALF_UP')).toThrow(DecimalDivisionByZeroError);
  });

  test('negative operands round on the absolute remainder', () => {
    const modes = {
      UP: '-4',
      DOWN: '-3',
      CEILING: '-3',
      FLOOR: '-4',
      HALF_UP: '-4',
      HALF_DOWN: '-3',
      HALF_EVEN: '-4',
    };
    for (const [mode, want] of Object.entries(modes)) {
      expect(dec('-7').divToScale('2', 0, mode).toString()).toBe(want);
      expect(dec('7').divToScale('-2', 0, mode).toString()).toBe(want);
    }
    expect(dec('-1').divToScale('-3', 3, 'HALF_UP').toString()).toBe('0.333');
  });

  test('HALF_EVEN ties on the quotient parity', () => {
    expect(dec('5').divToScale('2', 0, 'HALF_EVEN').toString()).toBe('2');
    expect(dec('7').divToScale('2', 0, 'HALF_EVEN').toString()).toBe('4');
  });

  test('UNNECESSARY divides exactly or throws', () => {
    expect(dec('1').divToScale('4', 2, 'UNNECESSARY').toString()).toBe('0.25');
    expect(() => dec('1').divToScale('3', 2, 'UNNECESSARY')).toThrow(DecimalInexactError);
  });

  test('negative scales round to whole tens', () => {
    expect(dec('1234').divToScale('1', -2, 'HALF_UP').toString()).toBe('1200');
  });
});

describe('the rounding matrix at scale 2', () => {
  const q = (s, mode) => dec(s).quantizeToScale(2, mode).toString();

  test('directed and half modes', () => {
    expect(q('1.234', 'UP')).toBe('1.24');
    expect(q('1.239', 'DOWN')).toBe('1.23');
    expect(q('1.231', 'CEILING')).toBe('1.24');
    expect(q('-1.239', 'CEILING')).toBe('-1.23');
    expect(q('1.239', 'FLOOR')).toBe('1.23');
    expect(q('-1.231', 'FLOOR')).toBe('-1.24');
    expect(q('1.235', 'HALF_UP')).toBe('1.24');
    expect(q('1.235', 'HALF_DOWN')).toBe('1.23');
    expect(q('1.225', 'HALF_EVEN')).toBe('1.22');
    expect(q('1.235', 'HALF_EVEN')).toBe('1.24');
  });

  test('negative ties round on the absolute remainder', () => {
    expect(dec('-0.005').quantizeToScale(2, 'HALF_EVEN').toString()).toBe('0.00');
    expect(dec('-0.005').quantizeToScale(2, 'HALF_UP').toString()).toBe('-0.01');
    expect(dec('0.005').quantizeToScale(2, 'HALF_EVEN').toString()).toBe('0.00');
    expect(dec('-0.005').toCentsNumber('HALF_EVEN')).toBe(0);
    expect(dec('-0.005').toCentsNumber('HALF_UP')).toBe(-1);
    expect(dec('0.005').toCentsNumber('HALF_UP')).toBe(1);
    expect(dec('0.005').toCentsNumber('HALF_EVEN')).toBe(0);
  });

  test('UNNECESSARY asserts exactness', () => {
    expect(dec('1.5').quantizeToScale(2, 'UNNECESSARY').toString()).toBe('1.50');
    expect(() => dec('1.555').quantizeToScale(2, 'UNNECESSARY')).toThrow(DecimalInexactError);
  });

  test('negative scales quantize to whole tens', () => {
    expect(dec('1234').quantizeToScale(-2, 'HALF_UP').toString()).toBe('1200');
    expect(dec('1250').quantizeToScale(-2, 'HALF_EVEN').toString()).toBe('1200');
    expect(dec('1350').quantizeToScale(-2, 'HALF_EVEN').toString()).toBe('1400');
    expect(dec('-1250').quantizeToScale(-2, 'HALF_EVEN').toString()).toBe('-1200');
  });

  test('magnitudes below half an ulp round as a tiny remainder', () => {
    expect(dec('0.0001').quantizeToScale(2, 'HALF_UP').toString()).toBe('0.00');
    expect(dec('0.0001').quantizeToScale(2, 'UP').toString()).toBe('0.01');
    expect(dec('0.0001').quantizeToScale(2, 'CEILING').toString()).toBe('0.01');
    expect(dec('-0.0001').quantizeToScale(2, 'FLOOR').toString()).toBe('-0.01');
    expect(dec('-0.0001').quantizeToScale(2, 'CEILING').toString()).toBe('0.00');
    expect(() => dec('0.0001').quantizeToScale(2, 'UNNECESSARY')).toThrow(DecimalInexactError);
  });
});

describe('cents interop with @rip-lang/validate', () => {
  // validate `money` is HALF_UP, `money_even` is HALF_EVEN; both return
  // integer cents. A bare integer is dollars: "129222" -> 12922200 cents.
  test('toCentsNumber matches the cents convention', () => {
    expect(dec('1234.50').toCentsNumber('HALF_UP')).toBe(123450);
    expect(dec('129222').toCentsNumber('HALF_UP')).toBe(12922200);
    expect(dec('1.235').toCentsNumber('HALF_UP')).toBe(124);
    expect(dec('1.225').toCentsNumber('HALF_UP')).toBe(123);
    expect(dec('1.225').toCentsNumber('HALF_EVEN')).toBe(122);
    expect(dec('1.235').toCentsNumber('HALF_EVEN')).toBe(124);
    expect(dec('1.23').toScaledInteger(2, 'HALF_UP')).toBe(123n);
  });

  test('toScaledInteger keeps the sign through ties', () => {
    expect(dec('-1.235').toScaledInteger(2, 'HALF_EVEN')).toBe(-124n);
    expect(dec('-1.235').toScaledInteger(2, 'HALF_UP')).toBe(-124n);
  });
});

describe('comparison is value-based', () => {
  test('scale never affects equality or order', () => {
    expect(dec('1.0').eq('1.00')).toBeTrue();
    expect(dec('1.1').lt('1.2')).toBeTrue();
    expect(dec('-1').gt('-2')).toBeTrue();
    expect(dec('2.50').cmp('2.5')).toBe(0);
    expect(dec('1').cmp('2')).toBe(-1);
    expect(dec('3').cmp('2')).toBe(1);
    expect(dec('1.00').cmp('1')).toBe(0);
    expect(dec('-1.10').cmp('-1.1')).toBe(0);
    expect(dec('0.00').cmp('-0')).toBe(0);
    expect(dec('9.9').cmp('10')).toBe(-1);
    expect(dec('-9.9').cmp('-10')).toBe(1);
  });

  test('a huge exponent gap compares without allocating', () => {
    expect(Decimal.fromParts(1n, 90000).cmp(Decimal.fromParts(1n, 0))).toBe(1);
    expect(Decimal.fromParts(1n, 0).cmp(Decimal.fromParts(1n, 90000))).toBe(-1);
  });
});

describe('construction', () => {
  test('from and fromScaledInteger', () => {
    expect(Decimal.from(42n).toString()).toBe('42');
    expect(Decimal.from(42).toString()).toBe('42');
    expect(Decimal.fromScaledInteger(12345n, 2).toString()).toBe('123.45');
    expect(Decimal.fromScaledInteger(12345, 2).toString()).toBe('123.45');
    expect(() => Decimal.from(0.1)).toThrow(DecimalUnsafeConversionError);
    expect(() => Decimal.from(9007199254740993)).toThrow(DecimalUnsafeConversionError);
  });

  test('fromParts renders plain strings at any exponent', () => {
    expect(Decimal.fromParts(123n, -1).toString()).toBe('12.3');
    expect(show('1e5')).toBe('100000');
    expect(show('1e-7')).toBe('0.0000001');
  });
});

describe('DuckDB DECIMAL(p, s) fit', () => {
  test('fitsDecimal checks scale loss and precision', () => {
    expect(dec('123.45').fitsDecimal(5, 2)).toBeTrue();
    expect(dec('123.45').fitsDecimal(4, 2)).toBeFalse();
    expect(dec('123.45').fitsDecimal(5, 1)).toBeFalse();
    expect(dec('0.00').fitsDecimal(1, 0)).toBeTrue();
    expect(dec('1.20').fitsDecimal(2, 1)).toBeTrue();
    expect(dec('-123.45').fitsDecimal(5, 2)).toBeTrue();
    expect(dec('1.2').toFixed(3, 'HALF_EVEN')).toBe('1.200');
    expect(dec('1.2').toFixed(4, 'UNNECESSARY')).toBe('1.2000');
  });

  test('fitsDecimal validates its DECIMAL(p, s) metadata', () => {
    expect(() => dec('1.5').fitsDecimal(0, 0)).toThrow(DecimalInvalidOperationError);
    expect(() => dec('1.5').fitsDecimal(2, 3)).toThrow(DecimalInvalidOperationError);
  });
});

describe('resource limits preflight before allocating', () => {
  test('pathological inputs are rejected up front', () => {
    expect(() => dec('1e1000000000')).toThrow(DecimalRangeError);
    expect(() => Decimal.fromParts(1n, 50000).add(Decimal.fromParts(1n, 0))).toThrow(DecimalResourceLimitError);
    expect(() => Decimal.fromParts(1n, 100000).toString()).toThrow(DecimalResourceLimitError);
  });

  test('results at the digit cap are exact; one past it throws', () => {
    expect(Decimal.parse('9'.repeat(999)).add('1').toString().length).toBe(1000);
    expect(() => Decimal.parse('9'.repeat(1000)).add('1')).toThrow(DecimalResourceLimitError);
  });

  test('the product exponent must stay in range', () => {
    expect(() => Decimal.fromParts(1n, 50000).mul(Decimal.fromParts(1n, 50001))).toThrow(DecimalRangeError);
  });

  test('zero never trips false limits at huge exponents', () => {
    expect(Decimal.fromParts(0n, 100000).add('1').toString()).toBe('1');
    expect(Decimal.fromParts(0n, 0).mul(Decimal.parse('9'.repeat(1000))).toString()).toBe('0');
    expect(Decimal.fromParts(0n, 100000).quantizeToScale(100000, 'HALF_EVEN').exp).toBe(-100000);
    expect(Decimal.fromParts(0n, 100000).toString()).toBe('0');
    expect(Decimal.fromParts(0n, 5).mul(Decimal.fromParts(3n, 5)).exp).toBe(10);
    expect(() => Decimal.fromParts(0n, 100000).divExact(Decimal.fromParts(1n, -100000))).toThrow(DecimalRangeError);
  });

  test('divToScale short-circuits a tiny quotient without allocating', () => {
    expect(Decimal.fromParts(1n, -100000).divToScale('1', 2, 'HALF_UP').toString()).toBe('0.00');
    expect(Decimal.fromParts(1n, -100000).divToScale('1', 2, 'UP').toString()).toBe('0.01');
  });
});

describe('D"..." tagged constructor', () => {
  test('parses a single literal', () => {
    expect(D`19.99`.toString()).toBe('19.99');
    expect(D`-0.00`.toString()).toBe('0.00');
    expect(() => D``).toThrow(DecimalParseError);
    expect(() => D`x${1}y`).toThrow(DecimalParseError);
  });
});

describe('invariant enforcement', () => {
  test('construction obeys the limits', () => {
    expect(() => Decimal.from(10n ** 1000n)).toThrow(DecimalResourceLimitError);
    expect(() => Decimal.fromParts(10n ** 1000n, 0)).toThrow(DecimalResourceLimitError);
    expect(() => Decimal.config({ maxDigit: 2000 })).toThrow(DecimalInvalidOperationError);
  });

  test('an invalid mode throws even when no rounding is needed', () => {
    expect(() => dec('1.50').quantizeToScale(2, 'BOGUS')).toThrow(DecimalInvalidOperationError);
    expect(() => dec('1.5').quantizeToScale(2, 'BOGUS')).toThrow(DecimalInvalidOperationError);
    expect(() => dec('1').divToScale('2', 1, 'BOGUS')).toThrow(DecimalInvalidOperationError);
  });
});

describe('conversion is lossy only on request', () => {
  test('toNumber is explicit and finite', () => {
    expect(Decimal.fromParts(1n, 308).toNumber()).toBe(1e308);
    expect(Decimal.fromParts(1n, -400).toNumber()).toBe(0);
    expect(() => Decimal.fromParts(1n, 309).toNumber()).toThrow(DecimalUnsafeConversionError);
  });

  test('valueOf blocks implicit coercion', () => {
    expect(() => dec('1').valueOf()).toThrow(DecimalError);
  });
});
