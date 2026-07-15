import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { X12, ISA_WIDTHS, SELECTOR } from '@rip-lang/x12';

// Every expectation in this file was captured from the running v3
// implementation (rip-lang) — the port's behavioral oracle. The v3
// package shipped without tests; this suite pins its observed contract,
// warts included (each wart is called out where pinned).

const FIXTURE = new URL('./fixtures/270.x12', import.meta.url).pathname;
const X270 = readFileSync(FIXTURE, 'utf8');

const ISA_DEFAULT =
  'ISA*00*          *00*          *ZZ*               *ZZ*               *      *    *^*00501*         *0*P*:';

// ==[ exports ]===============================================================

test('ISA_WIDTHS carries the official element widths', () => {
  expect(ISA_WIDTHS).toEqual([3, 2, 10, 2, 10, 2, 15, 2, 15, 6, 4, 1, 5, 9, 1, 1]);
});

test('SELECTOR is the selector grammar regexp', () => {
  expect(SELECTOR).toBeInstanceOf(RegExp);
  expect('EB(3)-4(2).1'.match(SELECTOR).slice(1)).toEqual(['EB', '3', '4', '2', '1']);
  expect('NM1(?)'.match(SELECTOR).slice(1)).toEqual(['NM1', '?', undefined, undefined, undefined]);
  expect('REF(+)-1'.match(SELECTOR).slice(1)).toEqual(['REF', '+', '1', undefined, undefined]);
});

// ==[ construction and separator detection ]==================================

describe('construction', () => {
  test('no argument seeds the fixed-width ISA template', () => {
    const x = new X12();
    // Wart (pinned): the parsed template keeps one empty trailing row,
    // so toString ends with "\n~" and raw() with "~~".
    expect(x.toString()).toBe(`${ISA_DEFAULT}~\n~`);
    expect(x.raw()).toBe(`${ISA_DEFAULT}~~`);
    expect(x.toString().length).toBe(108);
  });

  test('empty string also seeds the template', () => {
    expect(new X12('').toString()).toBe(new X12().toString());
  });

  test('separators are read from the ISA header', () => {
    const x = new X12(X270);
    expect([x.fld, x.rep, x.com, x.seg]).toEqual(['*', '^', ':', '~']);
  });

  test('alternate separators are detected', () => {
    const raw =
      'ISA|00|          |00|          |ZZ|A              |ZZ|B              |260428|1234|^|00501|000000001|0|P|:!REF|X!';
    const x = new X12(raw);
    expect([x.fld, x.rep, x.com, x.seg]).toEqual(['|', '^', ':', '!']);
    expect(x.get('REF-1')).toBe('X');
    expect(x.toArray().length).toBe(3);
  });

  test('an ISA-11 of U falls back to ^ for repetition', () => {
    const raw = X270.replace('*1234*^*', '*1234*U*');
    expect(new X12(raw).rep).toBe('^');
  });

  test('an X12 instance clones through its string form', () => {
    const a = new X12(X270);
    const b = new X12(a);
    // The original segments survive and address normally...
    expect(b.get('TRN-2')).toBe('8675309-001');
    // ...though the junk STR row (below) embeds a copy of the whole
    // message, so occurrence counts double: 3 real NM1s count as 6.
    expect(b.get('NM1(?)')).toBe(6);
    // ...but (wart, pinned): the constructor treats the instance as a
    // plain selector/value object, so its own properties (str, fld,
    // rep, com, seg, ary) are re-applied as set() calls and the clone
    // gains junk STR/FLD/REP/COM/SEG/ARY rows after the real ones.
    const names = b.toArray().map((r) => r[0]);
    expect(names.slice(0, 18)).toEqual(new X12(X270).toArray().map((r) => r[0]));
    expect(names.slice(18)).toEqual(['STR', 'FLD', 'REP', 'COM', 'SEG', 'ARY']);
  });

  test('an array seeds the template and applies selector/value pairs', () => {
    const x = new X12(['ISA-6', 'SNDR', 'GS(+)-1', ['HB', 'A', 'B']]);
    expect(x.get('ISA-6')).toBe('SNDR           ');
    expect(x.toArray().at(-1)).toEqual(['GS', 'HB', 'A', 'B']);
  });

  test('an object seeds the template and applies entries, skipping nullish values', () => {
    const x = new X12({ 'ISA-6': 'SNDR', 'ISA-8': null });
    expect(x.get('ISA-6')).toBe('SNDR           ');
    expect(x.get('ISA-8')).toBe('               ');
  });

  test('malformed input throws "malformed X12"', () => {
    expect(() => new X12('FOO*1~')).toThrow('malformed X12');
    expect(() => new X12('ISA*00~')).toThrow('malformed X12');
    // The header match is case-sensitive: a lowercase isa is rejected.
    expect(() => new X12(X270.replace(/^ISA/, 'isa'))).toThrow('malformed X12');
  });
});

// ==[ serialization ]=========================================================

describe('toArray / toString / raw', () => {
  test('toArray splits segments and fields', () => {
    const rows = new X12(X270).toArray();
    // Wart (pinned): the terminator after the last segment yields one
    // trailing [''] row, so 17 segments parse to 18 rows.
    expect(rows.length).toBe(18);
    expect(rows.at(-1)).toEqual(['']);
    expect(rows[0][0]).toBe('ISA');
    expect(rows[2]).toEqual(['ST', '270', '0001', '005010X279A1']);
    expect(rows[10]).toEqual(['NM1', 'IL', '1', 'DOE', 'JOHN', '', '', '', 'MI', 'M0000001']);
  });

  test('toString renders one segment per line and round-trips', () => {
    const x = new X12(X270);
    expect(x.toString().split('\n').length).toBe(18);
    expect(x.toString().replace(/\n/g, '')).toBe(`${X270}~`); // trailing-row wart
    expect(new X12(x.toString()).toArray()).toEqual(x.toArray());
  });

  test('raw() is the uppercased single-line wire form', () => {
    const x = new X12(X270.replace('DOE*JOHN', 'Doe*John'));
    expect(x.raw()).toBe(`${X270}~`);
  });

  test('newlines and CRLF between segments are absorbed', () => {
    expect(new X12(X270.replace(/~/g, '~\n')).toArray().length).toBe(18);
    expect(new X12(X270.replace(/~/g, '~\r\n')).toArray().length).toBe(18);
  });
});

// ==[ get ]===================================================================

describe('get', () => {
  const x = new X12(X270);

  test('addresses fields within the first matching segment', () => {
    expect(x.get('GS-2')).toBe('OFFALLY');
    expect(x.get('ST-1')).toBe('270');
    expect(x.get('TRN-2')).toBe('8675309-001');
  });

  test('ISA elements come back at their fixed widths', () => {
    expect(x.get('ISA-6')).toBe('OFFALLY        ');
    expect(x.get('ISA-8')).toBe('PAYER          ');
  });

  test('segment names match case-insensitively', () => {
    expect(x.get('nm1-3')).toBe('EXAMPLE HEALTH PLAN');
  });

  test('(n) selects the nth occurrence', () => {
    expect(x.get('NM1-3')).toBe('EXAMPLE HEALTH PLAN');
    expect(x.get('NM1(2)-3')).toBe('EXAMPLE CLINIC');
    expect(x.get('NM1(3)-9')).toBe('M0000001');
  });

  test('(?) counts occurrences', () => {
    expect(x.get('NM1(?)')).toBe(3);
    expect(x.get('HL(?)')).toBe(3);
    expect(x.get('ZZZ(?)')).toBe(0);
  });

  test('(*) collects from every occurrence', () => {
    expect(x.get('NM1(*)-3')).toEqual(['EXAMPLE HEALTH PLAN', 'EXAMPLE CLINIC', 'DOE']);
    expect(x.get('NM1(*)-1')).toEqual(['PR', '1P', 'IL']);
    expect(x.get('HL(*)')).toEqual(['HL*1**20*1', 'HL*2*1*21*1', 'HL*3*2*22*0']);
  });

  test('a bare segment name returns the whole segment', () => {
    expect(x.get('TRN')).toBe('TRN*1*8675309-001*9OFFALLY');
  });

  test('dot and dash are interchangeable position separators', () => {
    expect(x.get('NM1.3')).toBe(x.get('NM1-3'));
  });

  test('missing segments and fields return the empty string', () => {
    expect(x.get('ZZZ-1')).toBe('');
    expect(x.get('NM1-20')).toBe('');
    expect(x.get('NM1(9)-3')).toBe('');
  });

  test('no selector returns the serialized message', () => {
    expect(x.get()).toBe(x.toString());
  });

  test('a selector that cannot form a segment pattern throws', () => {
    expect(() => x.get('***')).toThrow();
  });
});

describe('get — repeats and components', () => {
  const raw =
    'ISA*00*          *00*          *ZZ*A              *ZZ*B              *260428*1234*^*00501*000000001*0*P*:~' +
    'SVC*AD:D1110*95*76~LQ*HE*N1^N2^N3~';
  const x = new X12(raw);

  test('.n addresses components', () => {
    expect(x.get('SVC-1.1')).toBe('AD');
    expect(x.get('SVC-1.2')).toBe('D1110');
    expect(x.get('SVC-1-2')).toBe('D1110'); // dash form
  });

  test('(n) after a field addresses repetitions', () => {
    expect(x.get('LQ-2(1)')).toBe('N1');
    expect(x.get('LQ-2(2)')).toBe('N2');
    expect(x.get('LQ-2(3)')).toBe('N3');
    expect(x.get('LQ-2(9)')).toBe('');
  });

  test('(?) after a field counts repetitions', () => {
    expect(x.get('LQ-2(?)')).toBe(3);
  });

  test('repetition and component combine', () => {
    expect(x.get('LQ-2(2).1')).toBe('N2');
  });
});

// ==[ set ]===================================================================

describe('set', () => {
  test('ISA elements are padded/truncated to their fixed widths', () => {
    const x = new X12();
    x.set('ISA-6', 'SENDER');
    expect(x.toArray()[0][6]).toBe('SENDER         ');
    x.set('ISA-13', '42');
    expect(x.toArray()[0][13]).toBe('42       ');
    x.set('ISA-6', 'WAY-TOO-LONG-FOR-FIFTEEN');
    expect(x.toArray()[0][6]).toBe('WAY-TOO-LONG-FO');
  });

  test('set invalidates the cached string', () => {
    const x = new X12();
    const before = x.toString();
    x.set('ISA-8', 'RCVR');
    expect(x.toString()).not.toBe(before);
    expect(x.get('ISA-8')).toBe('RCVR           ');
  });

  test('(+) appends a new segment occurrence', () => {
    const x = new X12();
    x.set('GS(+)-1', ['HB', 'S', 'R']);
    expect(x.toArray().at(-1)).toEqual(['GS', 'HB', 'S', 'R']);
    x.set('REF(+)-1', 'A');
    x.set('REF(+)-1', 'B');
    expect(x.get('REF(1)-1')).toBe('A');
    expect(x.get('REF(2)-1')).toBe('B');
    expect(x.get('REF(?)')).toBe(2);
  });

  test('setting a missing segment creates it, padding skipped fields', () => {
    const x = new X12();
    x.set('BHT-3', 'TRACE');
    expect(x.toArray().find((r) => r[0] === 'BHT')).toEqual(['BHT', '', '', 'TRACE']);
  });

  test("the literal value 'num' on a (+) append writes the occurrence number", () => {
    const x = new X12();
    x.set('LX(+)-1', 'num');
    x.set('LX(+)-1', 'num');
    expect(x.get('LX(*)-1')).toEqual(['1', '2']);
  });

  test('an array value joins on the field separator', () => {
    const x = new X12();
    x.set('SV3-1', ['AD', 'D1110']);
    expect(x.toArray().find((r) => r[0] === 'SV3')).toEqual(['SV3', 'AD', 'D1110']);
  });

  test('a bare segment selector replaces every field', () => {
    const x = new X12();
    x.set('DMG', ['D8', '19850615', 'M']);
    expect(x.toArray().find((r) => r[0] === 'DMG')).toEqual(['DMG', 'D8', '19850615', 'M']);
  });

  test('components write through rep 1 when the rep is explicit', () => {
    const x = new X12();
    x.set('CLM-5(1).1', '11');
    x.set('CLM-5(1).3', '1');
    expect(x.toArray().find((r) => r[0] === 'CLM').join('*')).toBe('CLM*****11::1');
  });

  test('component set without a rep works only on an empty field', () => {
    const x = new X12();
    x.set('CLM-5.1', '11');
    // Wart (pinned): once the field is non-empty, a component set with
    // no explicit rep resolves to repeat index -1 and is silently lost.
    x.set('CLM-5.3', '1');
    expect(x.toArray().find((r) => r[0] === 'CLM').join('*')).toBe('CLM*****11');
  });

  test('repetitions pad out and splice in place', () => {
    const x = new X12();
    x.set('LQ-2(2)', 'X2');
    x.set('LQ-2(1)', 'X1');
    expect(x.toArray().find((r) => r[0] === 'LQ')[2]).toBe('X1^X2');
    expect(x.get('LQ-2(?)')).toBe(2);
  });

  test('(*) sets every occurrence', () => {
    const x = new X12(X270);
    x.set('NM1(*)-1', 'XX');
    expect(x.get('NM1(*)-1')).toEqual(['XX', 'XX', 'XX']);
  });

  test('a missing value writes the empty string', () => {
    const x = new X12();
    x.set('REF-1');
    expect(x.toArray().find((r) => r[0] === 'REF')).toEqual(['REF', '']);
  });

  test('created segment names are uppercased', () => {
    const x = new X12();
    x.set('ref(+)-1', 'lower');
    expect(x.toArray().at(-1)).toEqual(['REF', 'lower']);
  });

  test('zero indexes are rejected', () => {
    const x = new X12();
    expect(() => x.set('NM1-0', 'x')).toThrow('zero index on field');
    expect(() => x.set('NM1-1.0', 'x')).toThrow('zero index on component');
  });
});

// ==[ data / update ]=========================================================

describe('data and update', () => {
  test('update applies selector/value pairs from an array', () => {
    const x = new X12();
    expect(x.update(['ISA-6', 'A', 'ISA-8', 'B'])).toBe(x);
    expect(x.get('ISA-6')).toBe('A              ');
    expect(x.get('ISA-8')).toBe('B              ');
  });

  test('update applies entries from an object and skips nullish values', () => {
    const x = new X12();
    x.update({ 'ISA-6': 'A', 'ISA-8': null });
    expect(x.get('ISA-6')).toBe('A              ');
    expect(x.get('ISA-8')).toBe('               ');
  });

  test('data with three or more arguments routes to update', () => {
    const x = new X12();
    x.data('ISA-6', 'A', 'ISA-8', 'B');
    expect(x.get('ISA-6')).toBe('A              ');
    expect(x.get('ISA-8')).toBe('B              ');
  });

  test('data with one argument gets, with two sets', () => {
    const x = new X12();
    x.data('ISA-6', 'A');
    expect(x.data('ISA-6')).toBe('A              ');
  });
});

// ==[ iteration ]=============================================================

describe('each and grep', () => {
  const x = new X12(X270);

  test('each visits every row (including the trailing empty row)', () => {
    const names = [];
    expect(x.each((r) => names.push(r[0]))).toBe(x);
    expect(names).toEqual([
      'ISA', 'GS', 'ST', 'BHT', 'HL', 'NM1', 'HL', 'NM1', 'HL', 'TRN',
      'NM1', 'DMG', 'DTP', 'EQ', 'SE', 'GE', 'IEA', '',
    ]);
  });

  test('each filters by name, case-insensitively', () => {
    const got = [];
    x.each('nm1', (r) => got.push(r[3]));
    expect(got).toEqual(['EXAMPLE HEALTH PLAN', 'EXAMPLE CLINIC', 'DOE']);
  });

  test('each filters by regexp', () => {
    const got = [];
    x.each(/^G[SE]$/, (r) => got.push(r[0]));
    expect(got).toEqual(['GS', 'GE']);
  });

  test('grep collects matching rows', () => {
    expect(x.grep('hl').length).toBe(3);
    expect(x.grep(/^N/).map((r) => r[0])).toEqual(['NM1', 'NM1', 'NM1']);
  });
});

// ==[ find ]==================================================================

describe('find', () => {
  const x = new X12(X270);

  test('a single selector returns its value directly', () => {
    expect(x.find('TRN-2')).toBe('8675309-001');
    expect(x.find('NM1(?)')).toBe(3);
    expect(x.find('NM1(*)-1')).toEqual(['PR', '1P', 'IL']);
  });

  test('several selectors return an array in order', () => {
    expect(x.find('ISA-6', 'GS-2', 'ST-1')).toEqual(['OFFALLY        ', 'OFFALLY', '270']);
  });

  test('nullish selectors produce null slots; missing values produce ""', () => {
    expect(x.find('TRN-2', null, 'ST-1')).toEqual(['8675309-001', null, '270']);
    expect(x.find('ZZZ-1', 'TRN-2')).toEqual(['', '8675309-001']);
  });

  test('a (*) selector must be the only one', () => {
    expect(() => x.find('NM1(*)-1', 'TRN-2')).toThrow('multi query allows only one selector');
  });

  test('no selectors returns undefined', () => {
    expect(x.find()).toBeUndefined();
  });
});

// ==[ show ]==================================================================

describe('show', () => {
  const x = new X12(X270);

  test("'list' returns padded tag/value lines", () => {
    expect(x.show('list').slice(0, 3)).toEqual([
      'ISA-1          00',
      'ISA-2                    ',
      'ISA-3          00',
    ]);
  });

  test("'full' prepends the serialized message", () => {
    const out = x.show('list', 'full');
    expect(out[0]).toBe(x.toString());
    expect(out[1]).toBe('');
  });

  test("'down' lowercases the segment tags", () => {
    expect(x.show('list', 'down')[0]).toBe('isa-1          00');
  });

  test('repeated segments are numbered unless only is set', () => {
    const tags = x.show('list').filter((l) => l.startsWith('NM1'));
    expect(tags[0]).toBe('NM1-1          PR');
    expect(x.show('list').some((l) => l.startsWith('HL(2)'))).toBeTrue();
    expect(x.show('list', 'only').some((l) => l.includes('('))).toBeFalse();
  });

  test("'deep' expands repetitions", () => {
    const raw =
      'ISA*00*          *00*          *ZZ*A              *ZZ*B              *260428*1234*^*00501*000000001*0*P*:~LQ*HE*N1^N2^N3~';
    expect(new X12(raw).show('list', 'deep').filter((l) => l.startsWith('LQ'))).toEqual([
      'LQ-1           HE',
      'LQ-2(1)        N1',
      'LQ-2(2)        N2',
      'LQ-2(3)        N3',
    ]);
  });

  test("'hide' suppresses the field listing", () => {
    expect(x.show('list', 'hide')).toEqual([]);
    expect(x.show('list', 'hide', 'full')).toEqual([x.toString()]);
  });
});

// ==[ normalize and isaWidths ]===============================================

describe('helpers', () => {
  test('normalize uppercases scalars and arrays in place', () => {
    const x = new X12();
    expect(x.normalize('abc')).toBe('ABC');
    expect(x.normalize(42)).toBe('42');
    const arr = ['a', 1];
    x.normalize(arr);
    expect(arr).toEqual(['A', '1']);
  });

  test('isaWidths pads a split ISA row to the official widths', () => {
    const x = new X12();
    const row = ['ISA', '00', '', '00', '', 'ZZ', 'ABC', 'ZZ', 'B', '260428', '1234', '^', '00501', '1', '0', 'P', ':'];
    expect(x.isaWidths(row)).toEqual([
      'ISA', '00', '          ', '00', '          ', 'ZZ', 'ABC            ', 'ZZ',
      'B              ', '260428', '1234', '^', '00501', '1        ', '0', 'P', ':',
    ]);
  });
});

// ==[ load ]==================================================================

describe('X12.load', () => {
  test('reads and parses a file', () => {
    const x = X12.load(FIXTURE);
    expect(x.get('TRN-2')).toBe('8675309-001');
    expect(x.toArray().length).toBe(18);
  });

  test('an unreadable file throws', () => {
    expect(() => X12.load('/nonexistent/nope.x12')).toThrow('unreadable file: /nonexistent/nope.x12');
  });
});
