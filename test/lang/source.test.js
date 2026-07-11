// SourceFile: lineStarts construction and lazy offset↔line/col conversion.
// Spans are UTF-16 code units, so astral-plane characters count as 2.
import { describe, test, expect } from 'bun:test';
import { SourceFile } from '../../src/source.js';

describe('SourceFile', () => {
  test('lineStarts for multi-line text', () => {
    const sf = new SourceFile('ab\ncd\n\nef');
    expect(Array.from(sf.lineStarts)).toEqual([0, 3, 6, 7]);
    expect(sf.lineCount).toBe(4);
  });

  test('empty text has a single line', () => {
    const sf = new SourceFile('');
    expect(Array.from(sf.lineStarts)).toEqual([0]);
    expect(sf.lineColAt(0)).toEqual({ line: 0, col: 0 });
  });

  test('lineColAt maps offsets to 0-based line/col', () => {
    const sf = new SourceFile('ab\ncd\nef');
    expect(sf.lineColAt(0)).toEqual({ line: 0, col: 0 });
    expect(sf.lineColAt(1)).toEqual({ line: 0, col: 1 });
    expect(sf.lineColAt(2)).toEqual({ line: 0, col: 2 }); // the newline itself
    expect(sf.lineColAt(3)).toEqual({ line: 1, col: 0 });
    expect(sf.lineColAt(7)).toEqual({ line: 2, col: 1 });
  });

  test('lineColAt clamps out-of-range offsets', () => {
    const sf = new SourceFile('abc');
    expect(sf.lineColAt(-5)).toEqual({ line: 0, col: 0 });
    expect(sf.lineColAt(99)).toEqual({ line: 0, col: 3 });
  });

  test('offsetAt inverts lineColAt', () => {
    const sf = new SourceFile('ab\ncd\nef');
    for (const offset of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const { line, col } = sf.lineColAt(offset);
      expect(sf.offsetAt(line, col)).toBe(offset);
    }
  });

  test('CRLF files: lines split on \\n; the \\r is the last column of its line', () => {
    // Raw-source convention: lineStarts indexes the character after each
    // \n, so the \r of a \r\n pair belongs to the line it ends. Columns
    // of real content are unaffected (the \r sits after the content).
    const sf = new SourceFile('ab\r\ncd\r\nef');
    expect(Array.from(sf.lineStarts)).toEqual([0, 4, 8]);
    expect(sf.lineColAt(1)).toEqual({ line: 0, col: 1 }); // 'b'
    expect(sf.lineColAt(2)).toEqual({ line: 0, col: 2 }); // the \r
    expect(sf.lineColAt(4)).toEqual({ line: 1, col: 0 }); // 'c'
    expect(sf.lineColAt(9)).toEqual({ line: 2, col: 1 }); // 'f'
  });

  test('astral-plane characters count as two UTF-16 units', () => {
    const sf = new SourceFile('a😀b\nc');
    // 'a'=0, '😀'=[1,3), 'b'=3, '\n'=4, 'c'=5
    expect(sf.lineColAt(3)).toEqual({ line: 0, col: 3 });
    expect(Array.from(sf.lineStarts)).toEqual([0, 5]);
    expect(sf.lineColAt(5)).toEqual({ line: 1, col: 0 });
    expect(sf.slice(1, 3)).toBe('😀');
  });
});

describe('offsetAt clamps to the logical end of line', () => {
  test('a CRLF line clamps AT the \r, never between the newline bytes', () => {
    const f = new SourceFile('ab\r\ncd');
    expect(f.offsetAt(0, 999)).toBe(2);
    expect(f.offsetAt(0, 2)).toBe(2);
    expect(f.offsetAt(1, 999)).toBe(6);
  });

  test('an LF line clamps at the newline as before', () => {
    const f = new SourceFile('ab\ncd');
    expect(f.offsetAt(0, 999)).toBe(2);
  });
});
