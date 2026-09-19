// A render pair whose value repeats the key's spelling (`title: title`,
// `@cancel: cancel`) generates the word twice, and each generated word
// must map to its own source word: the key's bytes carry the attribute
// or event name, the value's bytes carry the read. The claim cursor
// pairs occurrences by spelling, so without a bound on the key's claim
// the two swap — a road that emits the value first takes the key's
// bytes, and a pair frame that owns the value's bare word hands it to
// the key — and a semantic token or a rename meant for the member lands
// on the attribute name.
import { describe, test, expect } from 'bun:test';
import { compile } from '../../src/compiler.js';
import { decodeMappings } from '../../src/sourcemap.js';

// The source column each named segment on the pair's line maps to,
// keyed by the generated text at the segment.
function mapped(decl, body) {
  const src = `P = component\n  ${decl}\n  render\n    dialog\n      ${body}\n`;
  const out = compile(src, { runtimeDelivery: 'none', face: 'ts', sourceMap: true });
  const gen = out.code.split('\n');
  return decodeMappings(out.map.mappings)
    .filter((s) => s.srcLine === 4 && s.nameIndex != null)
    .map((s) => [gen[s.genLine].slice(s.genCol), s.srcCol]);
}

// The column of the one segment whose generated text starts with `text`.
function columnOf(segments, text) {
  const hits = segments.filter(([gen]) => gen.startsWith(text));
  expect(hits.length).toBe(1);
  return hits[0][1];
}

// Every segment whose generated text starts with `text` maps to `col`.
function allAt(segments, text, col) {
  const hits = segments.filter(([gen]) => gen.startsWith(text));
  expect(hits.length).toBeGreaterThan(0);
  for (const [, c] of hits) expect(c).toBe(col);
}

describe('a value spelled like its key maps each generated word to its own source word', () => {
  test('the event road: the name string to the key, the handler read to the value', () => {
    const segs = mapped('cancel = -> 1', '@cancel: cancel');
    expect(columnOf(segs, "cancel'")).toBe(7);
    expect(columnOf(segs, 'cancel as')).toBe(15);
  });

  test('the attribute road, static: the scratch read to the value, the name string to the key', () => {
    const segs = mapped("title = 'x'", 'title: title');
    expect(columnOf(segs, 'title;')).toBe(13);
    expect(columnOf(segs, "title'")).toBe(6);
  });

  test('the attribute road, reactive: the signal read to the value, both name strings to the key', () => {
    const segs = mapped("title := 'x'", 'title: title');
    expect(columnOf(segs, 'title.value')).toBe(13);
    allAt(segs, "title'", 6);
  });

  test('the boolean road, static: the guard read to the value, the name string to the key', () => {
    const segs = mapped('open = true', 'open: open');
    expect(columnOf(segs, 'open satisfies')).toBe(12);
    expect(columnOf(segs, "open'")).toBe(6);
  });

  test('the boolean road, reactive: the signal read to the value, the name string to the key', () => {
    const segs = mapped('open := true', 'open: open');
    expect(columnOf(segs, 'open.value')).toBe(12);
    expect(columnOf(segs, "open'")).toBe(6);
  });
});
