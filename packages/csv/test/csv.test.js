// The v3 suite: reading (basic, quoted, headers, options, relax, excel,
// relax+excel, BOM, line endings) and writing (basic, writer instances).
import { describe, expect, test } from 'bun:test';
import { CSV } from '@rip-lang/csv';

describe('reading: basic', () => {
  test('simple CSV', () => {
    expect(CSV.read('a,b,c\n1,2,3\n')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  test('no trailing newline', () => {
    expect(CSV.read('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  test('single column', () => {
    expect(CSV.read('a\nb\nc\n')).toEqual([['a'], ['b'], ['c']]);
  });

  test('empty string', () => {
    expect(CSV.read('')).toEqual([]);
  });

  test('empty fields', () => {
    expect(CSV.read('a,,c\n,,\n')).toEqual([['a', '', 'c'], ['', '', '']]);
  });

  test('tab delimiter', () => {
    expect(CSV.read('a\tb\tc\n1\t2\t3\n')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  test('pipe delimiter', () => {
    expect(CSV.read('a|b|c\n1|2|3\n')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  test('semicolon delimiter', () => {
    expect(CSV.read('a;b;c\n1;2;3\n')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  test('explicit separator', () => {
    expect(CSV.read('a:b:c\n1:2:3\n', { sep: ':' })).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });
});

describe('reading: quoted fields', () => {
  test('simple quoted fields', () => {
    expect(CSV.read('"a","b","c"\n"1","2","3"\n')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  test('quoted with commas', () => {
    expect(CSV.read('"a,1","b,2"\n')).toEqual([['a,1', 'b,2']]);
  });

  test('quoted with newlines', () => {
    expect(CSV.read('"line1\nline2",b\n')).toEqual([['line1\nline2', 'b']]);
  });

  test('escaped quotes (doubled)', () => {
    expect(CSV.read('"say ""hello""",b\n')).toEqual([['say "hello"', 'b']]);
  });

  test('mixed quoted and unquoted', () => {
    expect(CSV.read('a,"b,c",d\n')).toEqual([['a', 'b,c', 'd']]);
  });
});

describe('reading: headers mode', () => {
  test('headers: true', () => {
    const rows = CSV.read('name,age\nAlice,30\nBob,25\n', { headers: true });
    expect(rows).toEqual([{ name: 'Alice', age: '30' }, { name: 'Bob', age: '25' }]);
  });

  test('headers with quoted fields', () => {
    const rows = CSV.read('"name","age"\n"Alice","30"\n', { headers: true });
    expect(rows).toEqual([{ name: 'Alice', age: '30' }]);
  });
});

describe('reading: options', () => {
  test('strip whitespace', () => {
    expect(CSV.read(' a , b \n 1 , 2 \n', { strip: true })).toEqual([['a', 'b'], ['1', '2']]);
  });

  test('skip empty lines', () => {
    expect(CSV.read('a,b\n\n1,2\n\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  test('keep empty lines', () => {
    const rows = CSV.read('a,b\n\n1,2\n', { skipBlanks: false });
    expect(rows.length).toBe(3);
  });

  test('comment lines', () => {
    expect(CSV.read('a,b\n# skip me\n1,2\n', { comments: '#' })).toEqual([['a', 'b'], ['1', '2']]);
  });

  test('each callback', () => {
    const collected = [];
    const n = CSV.read('a,b\n1,2\n3,4\n', { each: (row) => { collected.push(row); } });
    expect(n).toBe(3);
    expect(collected).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });

  test('each with early halt', () => {
    const collected = [];
    const n = CSV.read('a\n1\n2\n3\n', {
      each: (row) => {
        collected.push(row);
        if (row[0] === '1') return false;
      },
    });
    expect(n).toBe(2);
    expect(collected).toEqual([['a'], ['1']]);
  });
});

describe('reading: relax mode', () => {
  test('stray quote in relax mode', () => {
    const rows = CSV.read('a,"bad"quote",b\n', { relax: true });
    expect(rows).toEqual([['a', 'bad"quote"', 'b']]);
  });

  test('stray quotes: AAA BBB', () => {
    const rows = CSV.read('"AAA "BBB",CCC,"DDD"\n', { relax: true });
    expect(rows).toEqual([['AAA "BBB"', 'CCC', 'DDD']]);
  });

  test('stray quotes: JOJO', () => {
    const rows = CSV.read('123,"CHO, JOELLE "JOJO"",456\n', { relax: true });
    expect(rows).toEqual([['123', 'CHO, JOELLE "JOJO"', '456']]);
  });

  test('properly doubled quotes: JOJO', () => {
    const rows = CSV.read('123,"CHO, JOELLE ""JOJO""",456\n');
    expect(rows).toEqual([['123', 'CHO, JOELLE "JOJO"', '456']]);
  });

  test('stray quotes: BENNY with excel', () => {
    const rows = CSV.read('"CHUI, LOK HANG "BENNY",224325325610,="001453","Hemoglobin A1c",=""\n', { relax: true, excel: true });
    expect(rows).toEqual([['CHUI, LOK HANG "BENNY"', '224325325610', '001453', 'Hemoglobin A1c', '']]);
  });

  test('stray quotes: unquoted Chuck', () => {
    const rows = CSV.read('Charlie or "Chuck",=B2 + B3,9\n', { relax: true, excel: true });
    expect(rows).toEqual([['Charlie or "Chuck"', '=B2 + B3', '9']]);
  });

  test('stray quote: trailing C"', () => {
    const rows = CSV.read('A,B,C",D\n', { relax: true });
    expect(rows).toEqual([['A', 'B', 'C"', 'D']]);
  });
});

describe('reading: excel mode', () => {
  test('excel literal ="01"', () => {
    const rows = CSV.read('="01",b\n', { excel: true });
    expect(rows).toEqual([['01', 'b']]);
  });

  test('excel empty =""', () => {
    const rows = CSV.read('="",next\n', { excel: true });
    expect(rows).toEqual([['', 'next']]);
  });

  test('excel full matrix', () => {
    const rows = CSV.read('=,=x,x=,="x",="","","=",123,0123,="123",="0123"\n', { excel: true });
    expect(rows).toEqual([['=', '=x', 'x=', 'x', '', '', '=', '123', '0123', '123', '0123']]);
  });
});

describe('reading: relax + excel (Labcorp patterns)', () => {
  test('JAMIE pattern: doubled quotes at excel boundary', () => {
    const rows = CSV.read('04003497,72359435,"DAVIS, DAKOTA ""JAMIE"",=""03/13/2022",207394404660,001453,Hemoglobin A1c,4.00\n', { relax: true, excel: true });
    expect(rows).toEqual([['04003497', '72359435', 'DAVIS, DAKOTA "JAMIE"', '03/13/2022', '207394404660', '001453', 'Hemoglobin A1c', '4.00']]);
  });

  test('JOJO pattern: doubled quotes at excel boundary', () => {
    const rows = CSV.read('04003497,72359439,"CHO, JOELLE ""JOJO"",=""03/25/2022",208449441660,602989,Food Allergy Profile,66.00\n', { relax: true, excel: true });
    expect(rows).toEqual([['04003497', '72359439', 'CHO, JOELLE "JOJO"', '03/25/2022', '208449441660', '602989', 'Food Allergy Profile', '66.00']]);
  });

  test('="" with content: extra quote skip', () => {
    const rows = CSV.read('simple,=""03/15/2022",after\n', { relax: true, excel: true });
    expect(rows).toEqual([['simple', '03/15/2022', 'after']]);
  });

  test('trailing separator: empty final field', () => {
    const rows = CSV.read('Name,Age,,,Shoe,,,\n', { relax: true, excel: true });
    expect(rows).toEqual([['Name', 'Age', '', '', 'Shoe', '', '', '']]);
  });

  test('trailing separator: 123,', () => {
    const rows = CSV.read('123,\n', { relax: true, excel: true });
    expect(rows).toEqual([['123', '']]);
  });
});

describe('reading: BOM', () => {
  test('strip BOM', () => {
    expect(CSV.read('\uFEFFa,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('reading: line endings', () => {
  test('CRLF line endings', () => {
    expect(CSV.read('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  test('CR only line endings', () => {
    expect(CSV.read('a,b\r1,2\r')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('writing: basic', () => {
  test('simple write', () => {
    expect(CSV.write([['a', 'b'], ['1', '2']])).toBe('a,b\n1,2\n');
  });

  test('write with quoting', () => {
    expect(CSV.write([['a,b', 'c']])).toBe('"a,b",c\n');
  });

  test('write with escaped quotes', () => {
    expect(CSV.write([['say "hi"', 'ok']])).toBe('"say ""hi""",ok\n');
  });

  test('write full mode', () => {
    expect(CSV.write([['a', 'b']], { mode: 'full' })).toBe('"a","b"\n');
  });

  test('write with tab separator', () => {
    expect(CSV.write([['a', 'b']], { sep: '\t' })).toBe('a\tb\n');
  });

  test('write zeros mode', () => {
    expect(CSV.write([['0123', 'hello']], { zeros: true })).toBe('="0123",hello\n');
  });

  test('write drop trailing empties', () => {
    expect(CSV.write([['a', '', '']], { drop: true })).toBe('a\n');
  });

  test('formatRow convenience', () => {
    expect(CSV.formatRow(['a', 'b,c', 'd'])).toBe('a,"b,c",d');
  });
});

describe('writing: writer instance', () => {
  test('reusable writer', () => {
    const w = CSV.writer({ sep: '\t' });
    expect(w.row(['a', 'b'])).toBe('a\tb');
    expect(w.row(['1', '2'])).toBe('1\t2');
  });

  test('writer rows', () => {
    const w = CSV.writer();
    expect(w.rows([['a', 'b'], ['1', '2']])).toBe('a,b\n1,2\n');
  });
});
