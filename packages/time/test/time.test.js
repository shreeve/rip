// @rip-lang/time tests — black-box parity against upstream dayjs.
// Every dayjs-oracle case computes the reference in-process, so the
// suite holds in any host timezone.
import { describe, expect, test } from 'bun:test';
import ref from 'dayjs';
import time, { Duration, age } from '@rip-lang/time';

// Rip symbol units (`:day`) are registered symbols on the JS side.
const u = (name) => Symbol.for(name);

const UNITS = ['year', 'month', 'week', 'day', 'hour', 'minute', 'second'];

describe('construction & getters', () => {
  test('now()', () => {
    const now = time();
    expect(now.year()).toBe(new Date().getFullYear());
    expect(now.month()).toBe(new Date().getMonth());
    expect(now.date()).toBe(new Date().getDate());
  });

  test('from ISO string', () => {
    const d = time('2026-04-19');
    expect(d.year()).toBe(2026);
    expect(d.month()).toBe(3);
    expect(d.date()).toBe(19);
  });

  test('from ISO datetime', () => {
    const d = time('2026-04-19T14:30:45');
    expect(d.hour()).toBe(14);
    expect(d.minute()).toBe(30);
    expect(d.second()).toBe(45);
  });

  test('from US MM/DD/YYYY', () => {
    const d = time('04/19/2026');
    expect(d.year()).toBe(2026);
    expect(d.month()).toBe(3);
    expect(d.date()).toBe(19);
  });

  test('from US M/D/YY', () => {
    const d = time('4/19/26');
    expect(d.year()).toBe(2026);
    expect(d.month()).toBe(3);
    expect(d.date()).toBe(19);
  });

  test('from US with time & AM/PM', () => {
    const d = time('04/19/2026 3:45 PM');
    expect(d.hour()).toBe(15);
    expect(d.minute()).toBe(45);
  });

  test('from US 12 AM', () => {
    expect(time('04/19/2026 12:00 AM').hour()).toBe(0);
  });

  test('from US 12 PM', () => {
    expect(time('04/19/2026 12:00 PM').hour()).toBe(12);
  });

  test('from Date object', () => {
    const d = time(new Date(2026, 3, 19));
    expect(d.year()).toBe(2026);
    expect(d.date()).toBe(19);
  });

  test('from timestamp', () => {
    const ts = Date.UTC(2026, 3, 19);
    expect(time.utc(ts).year()).toBe(2026);
    expect(time.utc(ts).month()).toBe(3);
  });

  test('from another time (clone)', () => {
    const a = time('2026-04-19');
    const b = time(a);
    expect(b.year()).toBe(2026);
    expect(b).not.toBe(a);
  });

  test('unix seconds', () => {
    expect(time.unix(1760000000).unix()).toBe(1760000000);
  });

  test('isValid true', () => {
    expect(time('2026-04-19').isValid()).toBe(true);
  });

  test('isValid false', () => {
    expect(time('not-a-date').isValid()).toBe(false);
  });

  test('null is invalid', () => {
    expect(time(null).isValid()).toBe(false);
  });
});

describe('immutability', () => {
  test('add returns new instance', () => {
    const a = time('2026-04-19');
    const b = a.add(1, u('day'));
    expect(a.date()).toBe(19);
    expect(b.date()).toBe(20);
  });

  test('set returns new instance', () => {
    const a = time('2026-04-19');
    const b = a.set(u('year'), 2027);
    expect(a.year()).toBe(2026);
    expect(b.year()).toBe(2027);
  });
});

describe('format (matches upstream dayjs)', () => {
  const FORMAT_CASES = [
    '2026-04-19',
    '2026-04-19T08:05:03',
    '2024-02-29',
    '2026-01-01',
    '2026-12-31T23:59:59',
  ];

  const FORMAT_PATTERNS = [
    'YYYY', 'YY', 'M', 'MM', 'MMM', 'MMMM', 'D', 'DD',
    'd', 'dd', 'ddd', 'dddd', 'H', 'HH', 'h', 'hh',
    'a', 'A', 'm', 'mm', 's', 'ss',
    'YYYY-MM-DD', 'MM/DD/YYYY', 'MMM D, YYYY',
    'dddd, MMMM D, YYYY', 'h:mm A',
  ];

  for (const inp of FORMAT_CASES) {
    for (const pat of FORMAT_PATTERNS) {
      test(`format ${pat} for ${inp}`, () => {
        expect(time(inp).format(pat)).toBe(ref(inp).format(pat));
      });
    }
  }

  // Extensions baked in (upstream needs advancedFormat plugin for these)
  test('format Do ordinal (built in)', () => {
    expect(time('2026-04-01').format('Do')).toBe('1st');
    expect(time('2026-04-02').format('Do')).toBe('2nd');
    expect(time('2026-04-03').format('Do')).toBe('3rd');
    expect(time('2026-04-04').format('Do')).toBe('4th');
    expect(time('2026-04-11').format('Do')).toBe('11th');
    expect(time('2026-04-12').format('Do')).toBe('12th');
    expect(time('2026-04-13').format('Do')).toBe('13th');
    expect(time('2026-04-21').format('Do')).toBe('21st');
    expect(time('2026-04-22').format('Do')).toBe('22nd');
  });

  test('format Q quarter (built in)', () => {
    expect(time('2026-01-15').format('Q')).toBe('1');
    expect(time('2026-05-15').format('Q')).toBe('2');
    expect(time('2026-08-15').format('Q')).toBe('3');
    expect(time('2026-11-15').format('Q')).toBe('4');
  });

  test('format bracket literal', () => {
    expect(time('2026-04-19').format('[Today is] MMMM Do')).toBe('Today is April 19th');
  });
});

describe('arithmetic', () => {
  test('add 1 day', () => {
    expect(time('2026-04-19').add(1, u('day')).format('YYYY-MM-DD'))
      .toBe(ref('2026-04-19').add(1, 'day').format('YYYY-MM-DD'));
  });

  test('add 1 month from Jan 31', () => {
    expect(time('2026-01-31').add(1, u('month')).format('YYYY-MM-DD'))
      .toBe(ref('2026-01-31').add(1, 'month').format('YYYY-MM-DD'));
  });

  test('add 1 year Feb 29 leap', () => {
    expect(time('2024-02-29').add(1, u('year')).format('YYYY-MM-DD'))
      .toBe(ref('2024-02-29').add(1, 'year').format('YYYY-MM-DD'));
  });

  test('subtract 2 weeks', () => {
    expect(time('2026-04-19').subtract(2, u('week')).format('YYYY-MM-DD'))
      .toBe(ref('2026-04-19').subtract(2, 'week').format('YYYY-MM-DD'));
  });

  test('add hours', () => {
    expect(time('2026-04-19T10:00').add(5, u('hour')).format('HH:mm'))
      .toBe(ref('2026-04-19T10:00').add(5, 'hour').format('HH:mm'));
  });

  test('add with string unit', () => {
    expect(time('2026-04-19').add(1, 'days').format('YYYY-MM-DD'))
      .toBe(ref('2026-04-19').add(1, 'days').format('YYYY-MM-DD'));
  });
});

describe('startOf / endOf', () => {
  for (const unit of UNITS) {
    test(`startOf(${unit})`, () => {
      expect(time('2026-04-19T14:30:45.123').startOf(unit).format('YYYY-MM-DD HH:mm:ss.SSS'))
        .toBe(ref('2026-04-19T14:30:45.123').startOf(unit).format('YYYY-MM-DD HH:mm:ss.SSS'));
    });
    test(`endOf(${unit})`, () => {
      expect(time('2026-04-19T14:30:45.123').endOf(unit).format('YYYY-MM-DD HH:mm:ss.SSS'))
        .toBe(ref('2026-04-19T14:30:45.123').endOf(unit).format('YYYY-MM-DD HH:mm:ss.SSS'));
    });
  }

  test('endOf month for February leap', () => {
    expect(time('2024-02-15').endOf(u('month')).format('YYYY-MM-DD')).toBe('2024-02-29');
  });

  test('endOf month for February non-leap', () => {
    expect(time('2023-02-15').endOf(u('month')).format('YYYY-MM-DD')).toBe('2023-02-28');
  });
});

describe('diff', () => {
  for (const unit of UNITS) {
    test(`diff(${unit})`, () => {
      const a = '2026-04-19T10:30:00';
      const b = '2020-01-15T08:15:30';
      expect(time(a).diff(time(b), unit)).toBe(ref(a).diff(ref(b), unit));
    });
  }

  test('diff float', () => {
    const a = '2026-04-19T10:30:00';
    const b = '2026-04-18T22:30:00';
    expect(time(a).diff(time(b), u('hour'), true))
      .toBeCloseTo(ref(a).diff(ref(b), 'hour', true), 4);
  });

  test('diff default ms', () => {
    const a = time('2026-04-19T10:30:00');
    const b = time('2026-04-19T10:30:05');
    expect(a.diff(b)).toBe(-5000);
  });
});

describe('comparisons', () => {
  test('isBefore', () => {
    expect(time('2026-04-18').isBefore(time('2026-04-19'))).toBe(true);
    expect(time('2026-04-19').isBefore(time('2026-04-19'))).toBe(false);
  });

  test('isAfter', () => {
    expect(time('2026-04-20').isAfter(time('2026-04-19'))).toBe(true);
    expect(time('2026-04-19').isAfter(time('2026-04-19'))).toBe(false);
  });

  test('isSame default (ms)', () => {
    expect(time('2026-04-19').isSame(time('2026-04-19'))).toBe(true);
  });

  test('isSame :day', () => {
    expect(time('2026-04-19T10:00').isSame(time('2026-04-19T23:59'), u('day'))).toBe(true);
    expect(time('2026-04-19T00:00').isSame(time('2026-04-20T00:00'), u('day'))).toBe(false);
  });

  test('isBefore with unit', () => {
    expect(time('2026-04-19').isBefore(time('2026-05-10'), u('month'))).toBe(true);
    expect(time('2026-04-30').isBefore(time('2026-04-01'), u('month'))).toBe(false);
  });

  test('isBetween exclusive', () => {
    const d = time('2026-04-19');
    expect(d.isBetween(time('2026-04-18'), time('2026-04-20'))).toBe(true);
    expect(d.isBetween(time('2026-04-19'), time('2026-04-20'))).toBe(false);
  });

  test('isBetween inclusive []', () => {
    const d = time('2026-04-19');
    expect(d.isBetween(time('2026-04-19'), time('2026-04-20'), u('day'), '[]')).toBe(true);
  });
});

describe('extras', () => {
  test('daysInMonth Feb leap', () => {
    expect(time('2024-02-10').daysInMonth()).toBe(29);
  });

  test('daysInMonth Feb non-leap', () => {
    expect(time('2023-02-10').daysInMonth()).toBe(28);
  });

  test('daysInMonth April', () => {
    expect(time('2026-04-10').daysInMonth()).toBe(30);
  });

  test('isLeapYear', () => {
    expect(time('2024-01-01').isLeapYear()).toBe(true);
    expect(time('2023-01-01').isLeapYear()).toBe(false);
    expect(time('2000-01-01').isLeapYear()).toBe(true);
    expect(time('1900-01-01').isLeapYear()).toBe(false);
  });

  test('quarter', () => {
    expect(time('2026-01-15').quarter()).toBe(1);
    expect(time('2026-04-15').quarter()).toBe(2);
    expect(time('2026-07-15').quarter()).toBe(3);
    expect(time('2026-12-15').quarter()).toBe(4);
  });

  test('dayOfYear', () => {
    expect(time('2026-01-01').dayOfYear()).toBe(1);
    expect(time('2026-12-31').dayOfYear()).toBe(365);
    expect(time('2024-12-31').dayOfYear()).toBe(366);
  });

  test('unix', () => {
    expect(time('2026-04-19T00:00:00Z').unix()).toBe(Math.floor(Date.UTC(2026, 3, 19) / 1000));
  });

  test('valueOf', () => {
    expect(time('2026-04-19T00:00:00Z').valueOf()).toBe(Date.UTC(2026, 3, 19));
  });

  test('min()', () => {
    const a = time('2026-04-18');
    const b = time('2026-04-19');
    const c = time('2026-04-20');
    expect(time.min(a, b, c).format('YYYY-MM-DD')).toBe('2026-04-18');
    expect(time.min([a, b, c]).format('YYYY-MM-DD')).toBe('2026-04-18');
  });

  test('max()', () => {
    const a = time('2026-04-18');
    const b = time('2026-04-19');
    const c = time('2026-04-20');
    expect(time.max(a, b, c).format('YYYY-MM-DD')).toBe('2026-04-20');
  });
});

describe('UTC mode', () => {
  test('time.utc()', () => {
    const d = time.utc('2026-04-19T00:00:00Z');
    expect(d.year()).toBe(2026);
    expect(d.month()).toBe(3);
    expect(d.date()).toBe(19);
    expect(d.hour()).toBe(0);
    expect(d.isUTC()).toBe(true);
  });

  test('toISOString round-trip', () => {
    expect(time.utc('2026-04-19T12:34:56Z').toISOString()).toBe('2026-04-19T12:34:56.000Z');
  });

  test('utc().local() preserves instant', () => {
    const d1 = time.utc('2026-04-19T00:00:00Z');
    const d2 = d1.local();
    expect(d1.valueOf()).toBe(d2.valueOf());
  });
});

describe('relative time', () => {
  test('from seconds ago', () => {
    const now = time();
    expect(now.subtract(30, u('second')).from(now)).toBe('a few seconds ago');
  });

  test('from minute ago (singular)', () => {
    const now = time();
    expect(now.subtract(1, u('minute')).from(now)).toBe('a minute ago');
  });

  test('in minutes (future)', () => {
    const now = time();
    expect(now.add(5, u('minute')).from(now)).toBe('in 5 minutes');
  });

  test('hour boundary', () => {
    const now = time();
    expect(now.subtract(50, u('minute')).from(now)).toBe('an hour ago');
  });

  test('year', () => {
    const now = time();
    expect(now.subtract(2, u('year')).from(now)).toBe('2 years ago');
  });
});

describe('custom format parsing', () => {
  test('MM/DD/YYYY h:mm A', () => {
    const d = time.parse('04/19/2026 3:45 PM', 'MM/DD/YYYY h:mm A');
    expect(d.year()).toBe(2026);
    expect(d.month()).toBe(3);
    expect(d.date()).toBe(19);
    expect(d.hour()).toBe(15);
    expect(d.minute()).toBe(45);
  });

  test('MMM D, YYYY', () => {
    const d = time.parse('Apr 19, 2026', 'MMM D, YYYY');
    expect(d.year()).toBe(2026);
    expect(d.month()).toBe(3);
    expect(d.date()).toBe(19);
  });

  test('YYYY-MM-DD (explicit)', () => {
    const d = time.parse('2026-04-19', 'YYYY-MM-DD');
    expect(d.year()).toBe(2026);
    expect(d.month()).toBe(3);
    expect(d.date()).toBe(19);
  });
});

describe('isSameOrBefore / isSameOrAfter', () => {
  test('isSameOrBefore true when same', () => {
    expect(time('2026-04-19').isSameOrBefore(time('2026-04-19'))).toBe(true);
  });

  test('isSameOrBefore true when before', () => {
    expect(time('2026-04-18').isSameOrBefore(time('2026-04-19'))).toBe(true);
  });

  test('isSameOrBefore false when after', () => {
    expect(time('2026-04-20').isSameOrBefore(time('2026-04-19'))).toBe(false);
  });

  test('isSameOrAfter true when same', () => {
    expect(time('2026-04-19').isSameOrAfter(time('2026-04-19'))).toBe(true);
  });

  test('isSameOrAfter true when after', () => {
    expect(time('2026-04-20').isSameOrAfter(time('2026-04-19'))).toBe(true);
  });

  test('isSameOrBefore respects unit', () => {
    const a = time('2026-04-19T10:00');
    const b = time('2026-04-19T23:59');
    expect(a.isSameOrBefore(b, u('day'))).toBe(true);
    expect(b.isSameOrAfter(a, u('day'))).toBe(true);
  });
});

describe('isToday / isYesterday / isTomorrow', () => {
  test('isToday for now', () => {
    expect(time().isToday()).toBe(true);
  });

  test('isToday for yesterday = false', () => {
    expect(time().subtract(1, u('day')).isToday()).toBe(false);
  });

  test('isYesterday', () => {
    expect(time().subtract(1, u('day')).isYesterday()).toBe(true);
    expect(time().isYesterday()).toBe(false);
    expect(time().subtract(2, u('day')).isYesterday()).toBe(false);
  });

  test('isTomorrow', () => {
    expect(time().add(1, u('day')).isTomorrow()).toBe(true);
    expect(time().isTomorrow()).toBe(false);
    expect(time().add(2, u('day')).isTomorrow()).toBe(false);
  });
});

describe('weekday', () => {
  test('weekday() getter equals day() in US', () => {
    // 2026-04-19 is a Sunday
    const d = time('2026-04-19');
    expect(d.weekday()).toBe(0);
    expect(d.weekday()).toBe(d.day());
  });

  test('weekday(1) moves to Monday', () => {
    // From Sunday 2026-04-19 → Monday 2026-04-20
    const d = time('2026-04-19');
    expect(time(d.weekday(1)).format('YYYY-MM-DD')).toBe('2026-04-20');
  });

  test('weekday(6) moves to Saturday (same week)', () => {
    // From Wednesday → Saturday of same week
    const d = time('2026-04-22'); // Wed
    expect(time(d.weekday(6)).format('YYYY-MM-DD')).toBe('2026-04-25');
  });

  test('weekday(0) moves to Sunday (start of week)', () => {
    const d = time('2026-04-22'); // Wed
    expect(time(d.weekday(0)).format('YYYY-MM-DD')).toBe('2026-04-19');
  });
});

describe('calendar', () => {
  test('calendar today', () => {
    expect(/^Today at /.test(time().calendar())).toBe(true);
  });

  test('calendar yesterday', () => {
    expect(/^Yesterday at /.test(time().subtract(1, u('day')).calendar())).toBe(true);
  });

  test('calendar tomorrow', () => {
    expect(/^Tomorrow at /.test(time().add(1, u('day')).calendar())).toBe(true);
  });

  test('calendar next week', () => {
    // 3 days ahead should hit 'nextWeek' bucket (dddd [at] h:mm A)
    const t = time().add(3, u('day'));
    const out = t.calendar();
    expect(/at /.test(out)).toBe(true);
    expect(out.startsWith(t.format('dddd'))).toBe(true);
  });

  test('calendar last week', () => {
    expect(time().subtract(3, u('day')).calendar().startsWith('Last ')).toBe(true);
  });

  test('calendar far past uses sameElse (MM/DD/YYYY)', () => {
    expect(time('2020-01-15').calendar()).toBe('01/15/2020');
  });

  test('calendar custom format', () => {
    expect(time().calendar(null, { sameDay: '[Right now]' })).toBe('Right now');
  });
});

describe('timezone (US)', () => {
  // UTC anchor — known instant: 2026-04-19 18:00:00 UTC
  const INSTANT = '2026-04-19T18:00:00Z';

  test('tz Pacific/Honolulu offset', () => {
    const d = time.utc(INSTANT).tz('Pacific/Honolulu');
    expect(d.utcOffset()).toBe(-600);
    expect(d.hour()).toBe(8);
    expect(d.format('HH:mm Z')).toBe('08:00 -10:00');
  });

  test('tz HT alias (= Pacific/Honolulu)', () => {
    const d = time.utc(INSTANT).tz('HT');
    expect(d.utcOffset()).toBe(-600);
    expect(d.timezone()).toBe('Pacific/Honolulu');
  });

  test('tz ET during April (DST active)', () => {
    const d = time.utc(INSTANT).tz('ET');
    // April 19, 2026 is EDT (UTC-4)
    expect(d.utcOffset()).toBe(-240);
    expect(d.hour()).toBe(14);
    expect(d.format('HH:mm Z')).toBe('14:00 -04:00');
  });

  test('tz ET during January (standard)', () => {
    const d = time.utc('2026-01-15T18:00:00Z').tz('ET');
    // January is EST (UTC-5)
    expect(d.utcOffset()).toBe(-300);
    expect(d.hour()).toBe(13);
    expect(d.format('HH:mm Z')).toBe('13:00 -05:00');
  });

  test('tz AZ (Phoenix, never DST)', () => {
    // April — rest of the Mountain zone is on MDT (UTC-6) but Phoenix stays MST (UTC-7)
    const apr = time.utc(INSTANT).tz('AZ');
    const jan = time.utc('2026-01-15T18:00:00Z').tz('AZ');
    expect(apr.utcOffset()).toBe(-420);
    expect(jan.utcOffset()).toBe(-420);
    expect(apr.format('Z')).toBe('-07:00');
  });

  test('tz MT vs AZ in summer', () => {
    const mt = time.utc(INSTANT).tz('MT');
    const az = time.utc(INSTANT).tz('AZ');
    // Same instant: MDT = -06:00, MST (AZ) = -07:00 → Denver reads one hour later
    expect(mt.utcOffset() - az.utcOffset()).toBe(60);
  });

  test('tz AKT (Anchorage)', () => {
    const d = time.utc(INSTANT).tz('AKT');
    // April — AKDT (UTC-8)
    expect(d.utcOffset()).toBe(-480);
    expect(d.hour()).toBe(10);
  });

  test('tz ChST (Guam, UTC+10, no DST)', () => {
    const d = time.utc(INSTANT).tz('ChST');
    expect(d.utcOffset()).toBe(600);
    expect(d.hour()).toBe(4); // next day 04:00 local
    expect(d.date()).toBe(20);
  });

  test('tz SST (American Samoa, UTC-11)', () => {
    expect(time.utc(INSTANT).tz('SST').utcOffset()).toBe(-660);
  });

  test('tz AST (Puerto Rico, UTC-4, no DST)', () => {
    const apr = time.utc(INSTANT).tz('AST');
    const jan = time.utc('2026-01-15T18:00:00Z').tz('AST');
    expect(apr.utcOffset()).toBe(-240);
    expect(jan.utcOffset()).toBe(-240);
  });

  test('tz IANA raw name pass-through', () => {
    expect(time.utc(INSTANT).tz('America/Chicago').utcOffset()).toBe(-300); // April → CDT
  });

  test('tz preserves underlying instant', () => {
    const utc = time.utc(INSTANT);
    const hi = utc.tz('HT');
    const ny = utc.tz('ET');
    expect(utc.valueOf()).toBe(hi.valueOf());
    expect(utc.valueOf()).toBe(ny.valueOf());
  });

  test('tz chain: HI → NY reads correct NY wall clock', () => {
    const hi = time.utc(INSTANT).tz('HT');
    const ny = hi.tz('ET');
    expect(ny.hour()).toBe(14);
    expect(ny.format('MM/DD/YYYY HH:mm')).toBe('04/19/2026 14:00');
  });

  test('time.tz factory interprets wall-clock in zone', () => {
    // "3:00 PM Hawaii time" on April 19 = 2026-04-20T01:00:00Z
    const d = time.tz('2026-04-19 15:00:00', 'Pacific/Honolulu');
    expect(d.valueOf()).toBe(Date.UTC(2026, 3, 20, 1, 0, 0));
    expect(d.format('HH:mm')).toBe('15:00');
  });

  test('time.tz factory with ET', () => {
    // "9:00 AM ET" on April 19 2026 (EDT, UTC-4) = 13:00 UTC
    const d = time.tz('2026-04-19 09:00:00', 'ET');
    expect(d.valueOf()).toBe(Date.UTC(2026, 3, 19, 13, 0, 0));
  });

  test('time.tz.guess()', () => {
    const zone = time.tz.guess();
    expect(typeof zone).toBe('string');
    expect(zone.length > 0).toBe(true);
  });

  test('aliases resolve consistently', () => {
    for (const short of ['ET', 'EST', 'EDT']) {
      expect(time.utc(INSTANT).tz(short).timezone()).toBe('America/New_York');
    }
    for (const short of ['HT', 'HST', 'HAST']) {
      expect(time.utc(INSTANT).tz(short).timezone()).toBe('Pacific/Honolulu');
    }
  });

  test('format tokens use zoned fields', () => {
    expect(time.utc(INSTANT).tz('HT').format('dddd, MMMM D, YYYY h:mm A'))
      .toBe('Sunday, April 19, 2026 8:00 AM');
  });

  test('format z (short zone name)', () => {
    expect(time.utc(INSTANT).tz('HT').format('z')).toBe('HST');
    expect(time.utc(INSTANT).tz('ET').format('z')).toBe('EDT'); // April = DST
    expect(time.utc('2026-01-15T18:00Z').tz('ET').format('z')).toBe('EST');
    expect(time.utc(INSTANT).tz('AZ').format('z')).toBe('MST'); // never DST
  });

  test('format zzz (long zone name)', () => {
    expect(time.utc(INSTANT).tz('HT').format('zzz')).toBe('Hawaii-Aleutian Standard Time');
    expect(time.utc(INSTANT).tz('ET').format('zzz')).toBe('Eastern Daylight Time');
  });

  test('DST spring-forward instant (US 2026-03-08 at 2 AM → 3 AM ET)', () => {
    // 07:00 UTC on 2026-03-08 = 02:00 EST, which jumps to 03:00 EDT.
    // In ET, this instant's wall clock is 03:00 EDT.
    const d = time.utc('2026-03-08T07:00:00Z').tz('ET');
    expect(d.hour()).toBe(3);
    expect(d.utcOffset()).toBe(-240);
  });
});

describe('unit aliases', () => {
  for (const unit of ['year', 'years', 'y']) {
    test(`add 1 '${unit}' (year)`, () => {
      expect(time('2026-04-19').add(1, unit).year()).toBe(2027);
    });
  }

  for (const unit of ['month', 'months', 'M']) {
    test(`add 1 '${unit}' (month)`, () => {
      expect(time('2026-01-15').add(1, unit).month()).toBe(1);
    });
  }
});

describe('duration', () => {
  test('zero duration', () => {
    const d = time.duration();
    expect(d.asMilliseconds()).toBe(0);
    expect(d.toISOString()).toBe('P0D');
  });

  test('from number (ms)', () => {
    const d = time.duration(5000);
    expect(d.asSeconds()).toBe(5);
    expect(d.seconds()).toBe(5);
  });

  test('from number + unit', () => {
    expect(time.duration(90, u('minute')).asMinutes()).toBe(90);
    expect(time.duration(90, 'minutes').asMinutes()).toBe(90);
    expect(time.duration(2, u('hour')).asMinutes()).toBe(120);
    expect(time.duration(1, u('day')).asHours()).toBe(24);
  });

  test('from object', () => {
    const d = time.duration({ hours: 1, minutes: 30 });
    expect(d.asMinutes()).toBe(90);
    expect(d.hours()).toBe(1);
    expect(d.minutes()).toBe(30);
  });

  test('from ISO string', () => {
    expect(time.duration('PT30M').asMinutes()).toBe(30);
    expect(time.duration('PT1H30M').asMinutes()).toBe(90);
    expect(time.duration('P1DT2H').asHours()).toBe(26);
    expect(time.duration('P1Y2M3D').years()).toBe(1);
    expect(time.duration('P1Y2M3D').months()).toBe(2);
    expect(time.duration('P1Y2M3D').days()).toBe(3);
  });

  test('from negative ISO string', () => {
    expect(time.duration('-PT30M').asMinutes()).toBe(-30);
  });

  test('component getters (normalized)', () => {
    const d = time.duration({ hours: 25, minutes: 90, seconds: 70 });
    // 25h + 90m + 70s = 95,470,000 ms = 1d 2h 31m 10s
    expect(d.days()).toBe(1);
    expect(d.hours()).toBe(2);
    expect(d.minutes()).toBe(31);
    expect(d.seconds()).toBe(10);
    // Total is still unchanged:
    expect(Math.round(d.asHours() * 100) / 100).toBe(26.52);
  });

  test('as* total getters', () => {
    const d = time.duration({ hours: 1, minutes: 30 });
    expect(d.asMilliseconds()).toBe(5400000);
    expect(d.asSeconds()).toBe(5400);
    expect(d.asMinutes()).toBe(90);
    expect(d.asHours()).toBe(1.5);
  });

  test('add / subtract durations', () => {
    const a = time.duration(1, u('hour'));
    const b = time.duration(30, u('minute'));
    expect(a.add(b).asMinutes()).toBe(90);
    expect(a.subtract(b).asMinutes()).toBe(30);
    expect(a.add(15, u('minute')).asMinutes()).toBe(75);
  });

  test('toISOString round-trips', () => {
    for (const iso of ['PT30M', 'PT1H', 'P1D', 'P1Y']) {
      expect(time.duration(iso).toISOString()).toBe(iso);
    }
  });

  test('toISOString complex', () => {
    const d = time.duration({ years: 1, months: 2, days: 3, hours: 4, minutes: 5, seconds: 6 });
    expect(d.toISOString()).toBe('P1Y2M3DT4H5M6S');
  });

  test('toJSON delegates to toISOString', () => {
    expect(time.duration(90, u('minute')).toJSON()).toBe('PT1H30M');
  });

  test('negated', () => {
    expect(time.duration(1, u('hour')).negated().asMinutes()).toBe(-60);
  });

  test('abs', () => {
    expect(time.duration(-1, u('hour')).abs().asMinutes()).toBe(60);
  });

  test('humanize (no suffix)', () => {
    expect(time.duration(1, u('hour')).humanize()).toBe('an hour');
    expect(time.duration(2, u('hour')).humanize()).toBe('2 hours');
    expect(time.duration(30, u('minute')).humanize()).toBe('30 minutes');
    expect(time.duration(2, u('day')).humanize()).toBe('2 days');
  });

  test('humanize (with suffix)', () => {
    // Future (positive duration)
    expect(time.duration(1, u('hour')).humanize(true)).toBe('in an hour');
    // Past (negative duration)
    expect(time.duration(-1, u('hour')).humanize(true)).toBe('an hour ago');
  });

  test('format', () => {
    const d = time.duration({ hours: 2, minutes: 5, seconds: 9 });
    expect(d.format('HH:mm:ss')).toBe('02:05:09');
    expect(d.format('H [hr] m [min]')).toBe('2 hr 5 min');
  });

  test('isDuration predicate', () => {
    expect(time.isDuration(time.duration(1, u('hour')))).toBe(true);
    expect(time.isDuration(time())).toBe(false);
    expect(time.isDuration({})).toBe(false);
    expect(time.isDuration(null)).toBe(false);
  });

  test('valueOf returns ms', () => {
    expect(+time.duration(1, u('second'))).toBe(1000);
  });

  test('Duration class exported', () => {
    expect(time.duration(1, u('hour')) instanceof Duration).toBe(true);
  });
});

describe('time arithmetic with Duration', () => {
  test('time.add(Duration)', () => {
    const d = time('2026-04-19T10:00:00');
    const result = d.add(time.duration({ hours: 2, minutes: 30 }));
    expect(result.format('YYYY-MM-DD HH:mm')).toBe('2026-04-19 12:30');
  });

  test('time.subtract(Duration)', () => {
    const d = time('2026-04-19T10:00:00');
    const result = d.subtract(time.duration(1, u('hour')));
    expect(result.format('YYYY-MM-DD HH:mm')).toBe('2026-04-19 09:00');
  });

  test('duration across DST (ET spring-forward)', () => {
    const before = time.utc('2026-03-08T06:00:00Z'); // 1:00 AM EST
    const after = before.add(time.duration(2, u('hour'))); // +2h instant-wise
    // 06Z + 2h = 08Z; in ET (now EDT after 07Z), that's 04:00 EDT
    expect(after.tz('ET').format('HH:mm')).toBe('04:00');
  });

  test('real-world: specimen age', () => {
    const collected = time.utc('2026-04-19T08:00:00Z');
    const analyzed = time.utc('2026-04-19T14:47:00Z');
    const elapsed = time.duration(analyzed.diff(collected));
    expect(elapsed.asMinutes()).toBe(407);
    expect(elapsed.humanize()).toBe('7 hours'); // bucketed to nearest relative time
  });
});

describe('age()', () => {
  test('age: after birthday this year', () => {
    expect(age('2000-01-01', '2026-06-26')).toBe(26);
  });

  test('age: before birthday this year', () => {
    expect(age('2000-12-31', '2026-06-26')).toBe(25);
  });

  test('age: on the birthday', () => {
    expect(age('2000-06-26', '2026-06-26')).toBe(26);
  });

  test('age: day before birthday', () => {
    expect(age('2000-06-27', '2026-06-26')).toBe(25);
  });

  test('age: default asOf is now', () => {
    expect(age(time().subtract(30, u('year')).format('YYYY-MM-DD'))).toBe(30);
  });

  test('age: blank/invalid → null', () => {
    expect(age(null)).toBe(null);
    expect(age('')).toBe(null);
    expect(age('not-a-date')).toBe(null);
  });
});

describe('toZone / asZone / asUTC', () => {
  test('toZone converts — same instant, new clock', () => {
    const d = time.utc('2026-06-15T12:00:00Z');
    expect(d.toZone('America/New_York').toISOString()).toBe('2026-06-15T12:00:00.000Z');
  });

  test('asZone reinterprets — wall-clock kept, instant shifts', () => {
    const d = time.utc('2026-06-15T12:00:00Z');
    expect(d.asZone('America/New_York').toISOString()).toBe('2026-06-15T16:00:00.000Z');
  });

  test('asUTC labels the wall-clock as UTC', () => {
    const ny = time.utc('2026-06-15T12:00:00Z').toZone('America/New_York'); // 08:00 EDT
    expect(ny.asUTC().toISOString()).toBe('2026-06-15T08:00:00.000Z');
  });
});
