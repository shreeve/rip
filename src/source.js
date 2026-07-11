// SourceFile: source text plus the lineStarts table.
//
// All spans in the pipeline are [start, end) offsets in UTF-16 code units
// (native JavaScript string indices). Line/column exists only at
// serialization boundaries — diagnostics and source maps — computed here,
// lazily, via binary search over lineStarts.

export class SourceFile {
  constructor(text, path = '<anonymous>') {
    this.path = path;
    this.text = text;

    const starts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) starts.push(i + 1);
    }
    this.lineStarts = Uint32Array.from(starts);
  }

  get lineCount() {
    return this.lineStarts.length;
  }

  // offset → {line, col}, both 0-based. Offsets are clamped to [0, text.length].
  lineColAt(offset) {
    if (offset < 0) offset = 0;
    if (offset > this.text.length) offset = this.text.length;
    const starts = this.lineStarts;
    let lo = 0, hi = starts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= offset) lo = mid + 1;
      else hi = mid - 1;
    }
    return { line: hi, col: offset - starts[hi] };
  }

  // {line, col} (0-based) → offset. Out-of-range lines/cols are clamped.
  offsetAt(line, col) {
    if (line < 0) return 0;
    if (line >= this.lineStarts.length) return this.text.length;
    const start = this.lineStarts[line];
    let end = line + 1 < this.lineStarts.length ? this.lineStarts[line + 1] - 1 : this.text.length;
    // A CRLF line's logical end sits AT the '\r': clamping between
    // the two newline bytes would answer a position past the last
    // column.
    if (end > start && this.text.charCodeAt(end - 1) === 13) end--;
    const offset = start + Math.max(0, col);
    return offset > end ? end : offset;
  }

  // Text of a span — convenience for diagnostics and tests.
  slice(start, end) {
    return this.text.slice(start, end);
  }
}
