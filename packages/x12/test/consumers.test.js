import { describe, expect, test } from 'bun:test';
import { X12 } from '@rip-lang/x12';

// The v3 package's real call sites (the ally eligibility responder, the
// dental 837/835 demo, the elig site) shipped without package tests.
// This file pins the exact usage patterns those consumers rely on.

const X270 = [
  'ISA*00*          *00*          *ZZ*OFFALLY        *ZZ*PAYER          *260428*1234*^*00501*100000001*0*P*:~',
  'GS*HS*OFFALLY*PAYER*20260428*1234*100000001*X*005010X279A1~',
  'ST*270*0001*005010X279A1~',
  'BHT*0022*13*8675309*20260428*1234~',
  'HL*1**20*1~',
  'NM1*PR*2*EXAMPLE HEALTH PLAN*****PI*12345~',
  'HL*2*1*21*1~',
  'NM1*1P*2*EXAMPLE CLINIC*****XX*1234567893~',
  'HL*3*2*22*0~',
  'TRN*1*8675309-001*9OFFALLY~',
  'NM1*IL*1*DOE*JOHN****MI*M0000001~',
  'DMG*D8*19850615*M~',
  'DTP*291*D8*20260428~',
  'EQ*30~',
  'SE*13*0001~',
  'GE*1*100000001~',
  'IEA*1*100000001~',
].join('');

describe('270 eligibility inquiry (ally edi.rip pattern)', () => {
  test('segment walk with HL loop tracking finds the subscriber', () => {
    const x = new X12(X270);
    let current = null;
    let subscriber = null;
    let trace = null;
    for (const row of x.toArray()) {
      const seg = String(row[0]).toUpperCase();
      if (seg === 'HL') current = String(row[3] ?? '');
      else if (seg === 'TRN' && trace === null) trace = String(row[2] ?? '');
      else if (seg === 'NM1' && row[1] === 'IL' && current === '22') {
        subscriber = { lastName: row[3], firstName: row[4], memberId: row[9] };
      }
    }
    expect(trace).toBe('8675309-001');
    expect(subscriber).toEqual({ lastName: 'DOE', firstName: 'JOHN', memberId: 'M0000001' });
  });

  test('envelope mirroring reads ISA ids and reuses the inbound separators', () => {
    const inbound = new X12(X270);
    const isaSender = String(inbound.get('ISA-8')).trim();
    const isaReceiver = String(inbound.get('ISA-6')).trim();
    expect(isaSender).toBe('PAYER');
    expect(isaReceiver).toBe('OFFALLY');

    // build271 renders plain segment arrays with the inbound delimiters
    // and re-parses the result to prove it is well-formed.
    const segs = [
      ['ISA', '00', '          ', '00', '          ', 'ZZ', isaSender.padEnd(15), 'ZZ', isaReceiver.padEnd(15), '260428', '1234', '^', '00501', '000000042', '0', 'P', ':'],
      ['GS', 'HB', isaSender, isaReceiver, '20260428', '1234', '000000042', 'X', '005010X279A1'],
      ['ST', '271', '0001', '005010X279A1'],
      ['NM1', 'IL', '1', 'DOE', 'JOHN', '', '', '', 'MI', 'M0000001'],
      ['SE', '3', '0001'],
      ['GE', '1', '000000042'],
      ['IEA', '1', '000000042'],
    ];
    const x271 = segs.map((row) => row.join(inbound.fld) + inbound.seg).join('').toUpperCase();

    const out = new X12(x271);
    expect(out.get('ST-1')).toBe('271');
    expect(out.get('NM1-9')).toBe('M0000001');
    expect(out.get('ISA-8').trim()).toBe('OFFALLY');
    expect(out.show('list', 'down')[0]).toBe('isa-1          00');
  });
});

describe('837/835 building (rip-dental claims.rip pattern)', () => {
  test('a fresh X12 seeds a valid fixed-width ISA envelope for 837 headers', () => {
    const x = new X12();
    x.set('ISA-6', 'SMILEDENTAL');
    x.set('ISA-8', 'DELTADENTAL');
    x.set('ISA-9', '260625');
    x.set('ISA-10', '1200');
    x.set('ISA-13', '000000001');
    const isa = x.toArray()[0].join('*');
    expect(isa.length).toBe(105); // 106-char ISA line, less the ~ terminator
    expect(isa).toBe(
      'ISA*00*          *00*          *ZZ*SMILEDENTAL    *ZZ*DELTADENTAL    *260625*1200*^*00501*000000001*0*P*:',
    );
  });

  test('an 835 accretes through (+) appends and exports without the seed rows', () => {
    const x = new X12();
    x.set('ISA-6', 'DELTADENTAL');
    x.set('ISA-13', '000000002');
    const add = (name, fields) => x.set(`${name}(+)-1`, fields.map((f) => String(f ?? '')));

    add('GS', ['HP', 'DELTA', 'NPI', '20260625', '1200', '1', 'X', '005010X221A1']);
    add('ST', ['835', '0001']);
    add('TRN', ['1', 'CHK0001', 'DELTA']);
    add('CLP', ['CLAIM001', '1', '190.00', '152.00', '19.00', 'CI', 'PAY001', '11']);
    add('SVC', ['AD:D1110', '95.00', '76.00', '', '1']);
    add('CAS', ['CO', '45', '9.50']);
    add('SE', ['7', '0001']);
    add('IEA', ['1', '000000002']);

    const era = x
      .toArray()
      .filter((r) => r[0] && r[0].length)
      .map((r) => r.join('*'))
      .join('~') + '~';
    expect(era.startsWith('ISA*00*')).toBeTrue();
    expect(era).toContain('~CLP*CLAIM001*1*190.00*152.00*19.00*CI*PAY001*11~');
    expect(era.endsWith('IEA*1*000000002~')).toBeTrue();
    expect(() => new X12(era)).not.toThrow();
  });

  test('an 835 parses into structured posting data (parse835 pattern)', () => {
    const era =
      'ISA*00*          *00*          *ZZ*DELTADENTAL    *ZZ*1234567893     *260625*1200*^*00501*000000002*0*P*:~' +
      'GS*HP*DELTA*NPI*20260625*1200*1*X*005010X221A1~ST*835*0001~BPR*I*152.00*C*ACH~' +
      'TRN*1*CHK12345*1512345678~N1*PR*DELTA DENTAL~N1*PE*SMILE DENTAL*XX*1234567893~LX*1~' +
      'CLP*CLAIM001*1*190.00*152.00*19.00*CI*PAY001*11~NM1*QC*1*DOE*JANE~' +
      'SVC*AD:D1110*95.00*76.00**1~DTM*472*20260625~CAS*CO*45*9.50~CAS*PR*2*9.50~' +
      'SVC*AD:D0120*95.00*76.00**1~CAS*CO*45*9.50~CAS*PR*2*9.50~' +
      'SE*16*0001~GE*1*1~IEA*1*000000002~';
    const x = new X12(era);
    const toCents = (amt) => Math.round(parseFloat(amt || '0') * 100);

    expect(x.get('TRN-2')).toBe('CHK12345');

    const claims = [];
    let claim = null;
    let svc = null;
    for (const row of x.toArray()) {
      switch (row[0]?.toUpperCase()) {
        case 'CLP':
          claim = { patientControl: row[1], paidCents: toCents(row[4]), lines: [] };
          claims.push(claim);
          svc = null;
          break;
        case 'SVC':
          svc = { code: (row[1] || '').split(':')[1] || row[1], paidCents: toCents(row[3]), writeoffCents: 0 };
          claim?.lines.push(svc);
          break;
        case 'CAS':
          if (row[1] === 'CO') (svc ?? claim).writeoffCents += toCents(row[3]);
          break;
      }
    }
    expect(claims.length).toBe(1);
    expect(claims[0].patientControl).toBe('CLAIM001');
    expect(claims[0].paidCents).toBe(15200);
    expect(claims[0].lines.map((l) => l.code)).toEqual(['D1110', 'D0120']);
    expect(claims[0].lines.map((l) => l.writeoffCents)).toEqual([950, 950]);
  });
});
