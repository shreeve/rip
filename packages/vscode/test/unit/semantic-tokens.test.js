// The import-kind correction over tsgo's tokens (src/tokens.js) against
// real compile output. tsgo tokens an imported object binding as the
// readonly variable its declaration made; the declaring module's record
// says which exported objects a tag constructs through, and the
// correction retypes the qualifier to `namespace` — the token a module
// namespace takes — while an exported object of anything else keeps
// tsgo's token. The token data is shaped as tsgo emits it for these
// bindings, `variable` with `readonly` at every read, so the pin is the
// correction, not tsgo.
import { describe, test, expect } from 'bun:test';
import { compile } from '../../../../src/compiler.js';
import { lineStartsOf, offsetToPosition, staleOffsetMap } from '../../src/translate.js';
import { FALLBACK_LEGEND, importRecordOf, importedKindInRecord, correctSemanticTokens } from '../../src/tokens.js';

const PAGE = [
  'Panel = component',
  '  @title: string',
  '  render',
  '    section',
  '      h2 title',
  '      slot',
  '',
  'Row = component',
  '  render',
  '    div',
  '      slot',
  '',
  'export Controls = { Panel, Row }',
  'export Plain = { a: 1, b: 2 }',
  'export Mixed = { Panel, a: 1 }',
  '',
].join('\n');

const USE = [
  "import { Controls, Plain, Mixed } from './page.rip'",
  '',
  'export App = component',
  '  render',
  "    Controls.Panel title: 'x'",
  '      Controls.Row',
  '    span Plain.a',
  '    span Mixed.a',
  '',
].join('\n');

const ts = (source, path) => compile(source, { runtimeDelivery: 'none', face: 'ts', path });
const typeIndex = (name) => FALLBACK_LEGEND.tokenTypes.indexOf(name);
const readonlyBit = 1 << FALLBACK_LEGEND.tokenModifiers.indexOf('readonly');

// tsgo's relative encoding of absolute tokens, in generated coordinates.
function encode(genLineStarts, tokens) {
  const data = [];
  let prevLine = 0, prevChar = 0;
  for (const t of [...tokens].sort((a, b) => a.start - b.start)) {
    const { line, character } = offsetToPosition(genLineStarts, t.start);
    data.push(line - prevLine, line === prevLine ? character - prevChar : character, t.length, t.type, t.modifiers);
    prevLine = line; prevChar = character;
  }
  return data;
}

// Every source offset at which `word` occurs at or after `from`.
function occurrences(text, word, from = 0) {
  const found = [];
  for (let at = text.indexOf(word, from); at >= 0; at = text.indexOf(word, at + 1)) found.push(at);
  return found;
}

describe('an imported object of components is a namespace to the token lane', () => {
  const page = ts(PAGE, '/ws/page.rip');
  const record = importRecordOf(page);
  const use = ts(USE, '/ws/use.rip');
  const good = { ...use, source: USE, dir: '/ws', srcLineStarts: lineStartsOf(USE), genLineStarts: lineStartsOf(use.code) };
  const ctx = { good, align: staleOffsetMap(USE, USE), curLineStarts: good.srcLineStarts };
  const reads = use.importedRefs.filter(([, , , , site]) => site !== 'declaration');
  // tsgo's answer for these bindings: a readonly variable at every read.
  const data = encode(good.genLineStarts, reads.map(([start, end]) => ({
    start, length: end - start, type: typeIndex('variable'), modifiers: readonlyBit,
  })));
  const tokens = correctSemanticTokens(ctx, data, {
    legend: FALLBACK_LEGEND,
    importedKindOf: (specifier, name) => (specifier === './page.rip' ? importedKindInRecord(record, name) : null),
    declaresEnum: () => false,
  });
  const tokenAt = (start) => tokens.find((t) => t.start === start) ?? null;
  const afterImport = USE.indexOf('\n') + 1;

  test('the declaring module records the object of components, and only it', () => {
    expect(page.componentNames).toEqual(['Panel', 'Row']);
    expect(page.partNames).toEqual(['Controls']);
    expect(record.namespaceNames).toEqual(['Controls']);
    expect(importedKindInRecord(record, 'Controls')).toBe('namespace');
    expect(importedKindInRecord(record, 'Plain')).toBeNull();
    expect(importedKindInRecord(record, 'Mixed')).toBeNull();
  });

  test('the compile reports every read of the qualifier', () => {
    const readsOf = (name) => reads.filter(([, , imported]) => imported === name).length;
    expect(readsOf('Controls')).toBe(2);
    expect(readsOf('Plain')).toBe(1);
    expect(readsOf('Mixed')).toBe(1);
  });

  test('the qualifier of a component path retypes to namespace with the readonly bit cleared', () => {
    const starts = occurrences(USE, 'Controls', afterImport);
    expect(starts).toHaveLength(2);
    for (const start of starts) {
      expect(tokenAt(start)).toEqual({ start, length: 'Controls'.length, type: typeIndex('namespace'), modifiers: 0 });
    }
  });

  test('an exported object of non-components keeps its readonly variable token', () => {
    for (const name of ['Plain', 'Mixed']) {
      const [start] = occurrences(USE, name, afterImport);
      expect(tokenAt(start)).toEqual({ start, length: name.length, type: typeIndex('variable'), modifiers: readonlyBit });
    }
  });

  test('the import line keeps the silent variable token for every name', () => {
    for (const name of ['Controls', 'Plain', 'Mixed']) {
      const start = USE.indexOf(name);
      expect(tokenAt(start)).toEqual({ start, length: name.length, type: typeIndex('variable'), modifiers: 0 });
    }
  });
});
