import { describe, expect, test } from 'bun:test';
import {
  check,
  formatMoney,
  getValidator,
  isBlank,
  isRawType,
  registerValidator,
  toName,
  toPhone,
  validatorNames,
} from '@rip-lang/validate';

// One row per contract: [type, input, normalized-or-null]. check()
// stringifies every input except the raw set, exactly like the schema
// and server call sites.
const rows = [
  // id — positive integer, no leading zero, at most 15 digits
  ['id', '12345', 12345],
  ['id', '999999999999999', 999999999999999],
  ['id', '0', null],
  ['id', '01', null],
  ['id', '-5', null],
  ['id', '1234567890123456', null],
  ['id', 'x', null],

  // int / whole / float
  ['int', '42', 42],
  ['int', '-42', -42],
  ['int', '+7', 7],
  ['int', '0', 0],
  ['int', '007', null],
  ['int', '1.5', null],
  ['int', ' 42 ', null],
  ['whole', '0', 0],
  ['whole', '42', 42],
  ['whole', '-1', null],
  ['float', '3.14', 3.14],
  ['float', '.5', 0.5],
  ['float', '-.5', -0.5],
  ['float', '-2.', -2],
  ['float', '+1.25', 1.25],
  ['float', 'x', null],

  // money — dollars in, integer cents out, half-up
  ['money', '$1,292.22', 129222],
  ['money', '129222', 12922200],
  ['money', '1,000', 100000],
  ['money', '.5', 50],
  ['money', '1.005', 101],
  ['money', '1.0050', 101],
  ['money', '-1.005', -101],
  ['money', '-$0.01', -1],
  ['money', '1,00', null],
  ['money', ',5', null],
  ['money', '1,2,3', null],
  ['money', '$', null],
  ['money', 'x', null],

  // money_even — half-to-even at the third fractional digit
  ['money_even', '1.005', 100],
  ['money_even', '1.015', 102],
  ['money_even', '1.0051', 101],

  // cents — already cents, whole numbers only
  ['cents', '123', 123],
  ['cents', '-45', -45],
  ['cents', '0', 0],
  ['cents', '-0', 0],
  ['cents', '1.23', null],
  ['cents', '12345678901234567890', null],

  // decimal — lossless string, canonical sign and leading zeros
  ['decimal', '0', '0'],
  ['decimal', '.5', null],
  ['decimal', '007', '7'],
  ['decimal', '+1.50', '1.50'],
  ['decimal', '-2.50', '-2.50'],
  ['decimal', '-0', '0'],
  ['decimal', '-0.00', '0.00'],
  ['decimal', '1,000', null],
  ['decimal', '$5', null],

  // string / text — whitespace collapse
  ['string', 'a\t\tb  c', 'a b c'],
  ['text', 'a  b', 'a b'],
  ['text', 'a\tb', 'a\tb'],

  // name / address — US-English casing packs
  ['name', 'JOHN   MCDONALD', 'John McDonald'],
  ['name', "o'brien", "O'Brien"],
  ['address', '123 main st.', '123 Main St'],
  ['address', 'p.o. box 12', 'PO Box 12'],

  // date — calendar-true, canonical YYYY-MM-DD
  ['date', '2024-02-29', '2024-02-29'],
  ['date', '20240215', '2024-02-15'],
  ['date', '2000-02-29', '2000-02-29'],
  ['date', '1900-02-29', null],
  ['date', '2023-02-29', null],
  ['date', '2024-02-30', null],
  ['date', '2024-13-01', null],
  ['date', '2024-00-10', null],
  ['date', '2024-01-00', null],
  ['date', '2024-01-32', null],
  ['date', '2024-0215', null],
  ['date', '2024-2-15', null],
  ['date', '2024-02-15 ', null],
  ['date', '99-01-01', null],

  // time / time12
  ['time', '00:30', '00:30'],
  ['time', '23:59', '23:59'],
  ['time', '7:05', '7:05'],
  ['time', '12:30:45', '12:30:45'],
  ['time', '24:00', null],
  ['time', '12:60', null],
  ['time12', '9:30 PM', '9:30 pm'],
  ['time12', '12:00am', '12:00am'],
  ['time12', '13:00 pm', null],
  ['time12', '0:30 am', null],

  // booleans
  ['truthy', 'YES', true],
  ['truthy', 'off', null],
  ['falsy', 'off', true],
  ['falsy', 'yes', null],
  ['bool', 'T', true],
  ['bool', 'Off', false],
  ['bool', 'maybe', null],

  // contact, geo, identity
  ['email', 'Foo@Example.COM', 'foo@example.com'],
  ['email', 'a@b', null],
  ['email', 'a b@c.com', null],
  ['state', 'ca', 'CA'],
  ['state', 'xz', 'XZ'],
  ['state', 'c', null],
  ['state', 'cal', null],
  ['zip', '12345-6789', '12345'],
  ['zip', '1234', null],
  ['zip', '123456', null],
  ['zip', '12345abc', null],
  ['zipplus4', '123456789', '12345-6789'],
  ['zipplus4', '12345-6789', '12345-6789'],
  ['zipplus4', '12345', null],
  ['ssn', '123-45-6789', '123456789'],
  ['ssn', '123456789', '123456789'],
  ['ssn', '123-45-678', null],
  ['sex', 'female', 'F'],
  ['sex', 'M', 'M'],
  ['sex', 'unspecified', 'U'],
  ['sex', 'x', null],

  // phone — NANP normalization
  ['phone', '502.758.8802', '(502) 758-8802'],
  ['phone', '1 (502) 758-8802', '(502) 758-8802'],
  ['phone', '5027588802 x12', '(502) 758-8802, ext. 12'],
  ['phone', '123-456-7890', null],
  ['phone', '+44 20 7946 0958', '+442079460958'],
  ['phone', '+1 502 758 8802 x12', '(502) 758-8802, ext. 12'],

  // web & technical
  ['username', 'Bob_Smith-1', 'bob_smith-1'],
  ['username', 'ab', null],
  ['username', 'a'.repeat(21), null],
  ['ip', '192.168.0.1', '192.168.0.1'],
  ['ip', '256.1.1.1', null],
  ['ip', '1.2.3', null],
  ['mac', 'AA:BB:CC:DD:EE:FF', 'aa:bb:cc:dd:ee:ff'],
  ['mac', 'aabbccddeeff', 'aa:bb:cc:dd:ee:ff'],
  ['mac', 'aa-bb-cc-dd-ee-ff', 'aa:bb:cc:dd:ee:ff'],
  ['mac', 'aa:bb-cc-dd:ee:ff', 'aa:bb:cc:dd:ee:ff'],
  ['mac', 'aabb', null],
  ['url', 'https://x.com/path', 'https://x.com/path'],
  ['url', 'ftp://x.com', null],
  ['url', 'https://', null],
  ['color', 'AbC', '#abc'],
  ['color', '#a1b2c3', '#a1b2c3'],
  ['color', '#ab', null],
  ['uuid', '123E4567E89B12D3A456426614174000', '123e4567-e89b-12d3-a456-426614174000'],
  ['uuid', '123e4567-e89b-12d3-a456-42661417400', null],
  ['semver', '1.2.3', '1.2.3'],
  ['semver', '1.2.3-rc.1+build.5', '1.2.3-rc.1+build.5'],
  ['semver', '1.2', null],
  ['semver', '01.2.3', null],

  // slugs & id lists
  ['slug', 'My-Page', 'my-page'],
  ['slug', 'a--b', null],
  ['slug', '-a', null],
  ['ids', '15 2 2 1', [1, 2, 15]],
  ['ids', '3,4', [3, 4]],
  ['ids', '999999999999999', [999999999999999]],
  ['ids', '1234567890123456', null],
  ['ids', '0 1', null],
  ['ids', '1 x', null],
  ['ids', '', null],
];

describe('the vocabulary', () => {
  for (const [type, input, expected] of rows) {
    test(`${type} ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      expect(check(input, type)).toEqual(expected);
    });
  }

  test('the raw set receives values untouched', () => {
    expect(check([1, 2], 'array')).toEqual([1, 2]);
    expect(check('x', 'array')).toBeNull();
    expect(check({ a: 1 }, 'hash')).toEqual({ a: 1 });
    expect(check([], 'hash')).toBeNull();
    expect(check(null, 'hash')).toBeNull();
    expect(check('{"a":1}', 'json')).toEqual({ a: 1 });
    expect(check('[1,2]', 'json')).toEqual([1, 2]);
    expect(check({ b: 2 }, 'json')).toEqual({ b: 2 });
    expect(check('nope', 'json')).toBeNull();
    expect(check(42, 'json')).toBeNull();
  });

  test('isRawType answers the raw flag; unknown names answer false', () => {
    for (const raw of ['array', 'hash', 'json']) expect(isRawType(raw)).toBeTrue();
    for (const plain of ['int', 'string', 'phone']) expect(isRawType(plain)).toBeFalse();
    expect(isRawType('nope')).toBeFalse();
  });

  test('non-raw validators receive the string form', () => {
    expect(check(42, 'int')).toBe(42);
    expect(check(null, 'string')).toBe('');
    expect(check([12345], 'id')).toBe(12345);
  });

  test('blank strings normalize to blank, not to a miss, in the string family', () => {
    expect(check('', 'string')).toBe('');
    expect(check('', 'text')).toBe('');
    expect(check('', 'phone')).toBe('');
  });

  test('every built-in name is present and the list is sorted', () => {
    const builtins = [
      'address', 'array', 'bool', 'cents', 'color', 'date', 'decimal',
      'email', 'falsy', 'float', 'hash', 'id', 'ids', 'int', 'ip', 'json',
      'mac', 'money', 'money_even', 'name', 'phone', 'semver', 'sex',
      'slug', 'ssn', 'state', 'string', 'text', 'time', 'time12', 'truthy',
      'url', 'username', 'uuid', 'whole', 'zip', 'zipplus4',
    ];
    expect(builtins.length).toBe(37);
    const names = validatorNames();
    for (const name of builtins) expect(names).toContain(name);
    expect(names).toEqual([...names].sort());
  });

  test('a fresh registry holds exactly the 37 built-ins', () => {
    const run = Bun.spawnSync(
      ['bun', '-e', "const v = await import('./index.rip'); console.log(v.validatorNames().length);"],
      { cwd: new URL('..', import.meta.url).pathname },
    );
    expect(run.stderr.toString()).toBe('');
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString().trim()).toBe('37');
  });
});

describe('registration', () => {
  test('a registered validator joins the vocabulary', () => {
    registerValidator('even', v => (Number(v) % 2 === 0 ? Number(v) : null));
    expect(check('4', 'even')).toBe(4);
    expect(check('3', 'even')).toBeNull();
    expect(validatorNames()).toContain('even');
  });

  test('a raw registration receives values untouched', () => {
    registerValidator('pair', v => (Array.isArray(v) && v.length === 2 ? v : null), { raw: true });
    expect(check([1, 2], 'pair')).toEqual([1, 2]);
    expect(check([1], 'pair')).toBeNull();
    expect(isRawType('pair')).toBeTrue();
    expect(isRawType('even')).toBeFalse();
  });

  test('registering an existing name rejects', () => {
    expect(() => registerValidator('id', v => v)).toThrow(/already registered/);
    expect(() => registerValidator('even', v => v)).toThrow(/already registered/);
  });

  test('async and generator validators reject', () => {
    expect(() => registerValidator('later', async v => v)).toThrow(/synchronous/);
    expect(() => registerValidator('gen', function* (v) { yield v; })).toThrow(/synchronous/);
  });

  test('a non-boolean raw flag rejects', () => {
    expect(() => registerValidator('rawish', v => v, { raw: 1 })).toThrow(/raw flag/);
  });

  test('an invalid name or non-function rejects', () => {
    expect(() => registerValidator('a-b', v => v)).toThrow(/invalid validator name/);
    expect(() => registerValidator('', v => v)).toThrow(/invalid validator name/);
    expect(() => registerValidator('fine', 'not a function')).toThrow(/must be a function/);
  });

  test('getValidator answers softly; check rejects loudly', () => {
    expect(typeof getValidator('id')).toBe('function');
    expect(getValidator('nope')).toBeUndefined();
    expect(() => check('x', 'nope')).toThrow(/unknown validator 'nope'/);
  });
});

describe('utilities', () => {
  test('isBlank', () => {
    for (const blank of [null, undefined, false, '', '  \t ', [], {}]) {
      expect(isBlank(blank)).toBeTrue();
    }
    for (const present of [0, 'x', [0], { a: 1 }, true]) {
      expect(isBlank(present)).toBeFalse();
    }
  });

  test('toName rule packs', () => {
    expect(toName('JOHN SMITH')).toBe('John Smith');
    expect(toName('mcdonald', 'name')).toBe('McDonald');
    expect(toName("o'brien's", 'name')).toBe("O'Brien's");
    expect(toName('main st', 'address')).toBe('Main St');
    expect(toName('WWW.EXAMPLE.COM')).toBe('www.example.com');
  });

  test('toPhone', () => {
    expect(toPhone('')).toBe('');
    expect(toPhone(null)).toBe('');
    expect(toPhone('502-758-8802')).toBe('(502) 758-8802');
    expect(toPhone('bogus')).toBeNull();
  });

  test('formatMoney', () => {
    expect(formatMoney(129222)).toBe('$1,292.22');
    expect(formatMoney(-1)).toBe('-$0.01');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(null)).toBe('$0.00');
    expect(formatMoney(129222, { commas: false })).toBe('$1292.22');
    expect(formatMoney(500, { symbol: '' })).toBe('5.00');
    expect(() => formatMoney(NaN)).toThrow(/finite/);
    expect(() => formatMoney(Infinity)).toThrow(/finite/);
  });
});

describe('statelessness', () => {
  test('identical inputs validate identically, repeatedly', () => {
    for (let i = 0; i < 3; i++) {
      expect(check('12345', 'id')).toBe(12345);
      expect(check('x', 'id')).toBeNull();
      expect(check('2024-02-29', 'date')).toBe('2024-02-29');
    }
  });
});
