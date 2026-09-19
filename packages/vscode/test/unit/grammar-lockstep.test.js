// The grammar LOCKSTEP check for own-line bare boolean flags: the
// TextMate grammar paints a line holding only a known HTML
// boolean-attribute name as an attribute, because the compiler sets
// that attribute on the ENCLOSING element. The compiler reads EVERY
// bare word on its own line that resolves to nothing as an attribute
// (a tag word and a component name keep their element readings, and
// an in-scope value its text reading); the grammar, blind to scope and
// to the tag tables, paints only the list it can be sure of. That list
// is DATA in rip.tmLanguage.json — nothing structural stops it drifting
// from the compiler's BOOLEAN_ATTRS — so this suite is the lockstep:
//
//   1. the grammar's alternation equals BOOLEAN_ATTRS minus `loop`
//      and `default` (those keywords claim the line at parse,
//      exactly as the compiler does), and
//   2. every painted name COMPILES as a flag of its enclosing element
//      through the real render DSL, in both faces, while an unlisted
//      word stays unpainted (the grammar guesses no identifier's
//      reading) and still compiles as an attribute.
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import path from 'node:path';
import { compile } from '../../../../src/compiler.js';
import { BOOLEAN_ATTRS } from '../../../../src/dom.js';

const grammar = JSON.parse(readFileSync(
  path.resolve(import.meta.dir, '..', '..', 'syntaxes', 'rip.tmLanguage.json'), 'utf8'));

// The own-line flag rule, found by shape: a render-block pattern whose
// match anchors a line-start alternation followed by the end-of-line
// lookahead.
const renderBlock = grammar.patterns.find((p) =>
  typeof p.begin === 'string' && p.begin.includes('(render)'));
const flagRule = renderBlock.patterns.find((p) =>
  typeof p.match === 'string' && p.match.includes('disabled|'));
const symbolRule = grammar.patterns.find((p) =>
  p.name === 'constant.other.symbol.rip');
const maybeDammitRule = grammar.patterns.find((p) =>
  p.name === 'keyword.control.await.rip' && p.match?.startsWith('\\?!'));
const presenceRule = grammar.patterns.find((p) =>
  p.name === 'keyword.operator.presence.rip');
const controlRule = grammar.patterns.find((p) =>
  p.name === 'keyword.control.rip' && p.match?.includes('finally'));
const vimSyntax = readFileSync(
  path.resolve(import.meta.dir, '..', '..', '..', 'vim', 'syntax', 'rip.vim'), 'utf8');
const readonlyRule = grammar.patterns.find((p) =>
  typeof p.match === 'string' && p.match.endsWith('(=!)'));
const tagRule = renderBlock.patterns.find((p) =>
  typeof p.begin === 'string' && p.begin.includes('|wbr)'));
const ownLineAttrRule = renderBlock.patterns.find((p) =>
  typeof p.match === 'string' && p.match.includes('|<=>'));

describe('own-line bare-flag lockstep (grammar ⇄ compiler)', () => {
  test('the grammar alternation is BOOLEAN_ATTRS minus the parse-reserved words', () => {
    const painted = flagRule.match.match(/\((\w+(?:\|\w+)+)\)/)[1].split('|');
    const expected = [...BOOLEAN_ATTRS].filter((n) => n !== 'loop' && n !== 'default');
    expect(painted.toSorted()).toEqual(expected.toSorted());
  });

  test('every painted name compiles as a flag of the enclosing element, both faces', () => {
    const re = new RegExp(flagRule.match);
    const painted = flagRule.match.match(/\((\w+(?:\|\w+)+)\)/)[1].split('|');
    for (const name of painted) {
      expect(`      ${name}`).toMatch(re);
      for (const face of ['js', 'ts']) {
        const { code } = compile(`P = component\n  render\n    div\n      ${name}\n`,
          { runtimeDelivery: 'none', face });
        expect(code).toContain(`setAttribute('${name}', '')`);
        expect(code).not.toContain(`createElement('${name}')`);
      }
    }
  });

  test('an unlisted bare word stays unpainted and is still an attribute of its element', () => {
    const re = new RegExp(flagRule.match);
    expect('      spacer').not.toMatch(re);
    expect('      readOnly').not.toMatch(re);        // one spelling: the grammar paints the attribute's own
    expect('      disabled: busy').not.toMatch(re); // the colon form is the key rule's
    for (const word of ['spacer', 'readOnly']) {
      const { code } = compile(`P = component\n  render\n    div\n      ${word}\n`,
        { runtimeDelivery: 'none' });
      expect(code).toContain(`setAttribute('${word}', '')`);
      expect(code).not.toContain(`createElement('${word}')`);
    }
  });
});

describe('symbol-literal lockstep (grammar ⇄ compiler)', () => {
  test('dotted and hyphenated names paint and compile as one symbol', () => {
    const re = new RegExp(symbolRule.match);
    for (const name of [':steve.shreeve-usa', ':one.two.three-four.five']) {
      expect(name.match(re)?.[0]).toBe(name);
      expect(compile(name, { runtimeDelivery: 'none' }).code)
        .toContain(`Symbol.for("${name.slice(1)}")`);
    }
  });
});

describe('Houdini / maybe dammit lockstep (editor grammars ⇄ compiler)', () => {
  const maybeRe = new RegExp(maybeDammitRule.match);
  const presenceRe = new RegExp(presenceRule.match);

  test('TextMate gives argument-bearing ?! await scope and leaves bare ?! as presence', () => {
    for (const source of ['?!()', '?!(arg)', '?! arg', '?! 42', '?! {ok: true}', '?! [1]']) {
      expect(source.match(maybeRe)?.[0]).toBe('?!');
    }
    for (const source of ['?!', '?! ?? fallback', '?! + 1', '?!\nnext']) {
      expect(maybeRe.test(source)).toBe(false);
      expect(source.match(presenceRe)?.[0]).toBe('?!');
    }
  });

  test('the TextMate split agrees with emitted meaning', () => {
    expect(compile('fn?!', { runtimeDelivery: 'none' }).code)
      .toBe('(fn ? true : undefined);');
    expect(compile('fn?!()', { runtimeDelivery: 'none' }).code)
      .toBe('await fn?.();');
    expect(compile('fn?! arg', { runtimeDelivery: 'none' }).code)
      .toBe('await fn?.(arg);');
  });

  test('Vim recognizes ?! as one special operator token', () => {
    expect(vimSyntax).toContain('syn match  ripOperator      /!?\\|?!\\|??\\|?\\./');
  });
});

describe('inline try/finally lockstep (editor grammars ⇄ compiler)', () => {
  const source = 'try fsyncSync(directory) finally closeSync(directory)';

  test('TextMate paints both clause words and the source compiles', () => {
    const re = new RegExp(controlRule.match, 'g');
    expect([...source.matchAll(re)].map((match) => match[0]))
      .toEqual(['try', 'finally']);
    expect(compile(source, { runtimeDelivery: 'none' }).code)
      .toBe('try {\n  fsyncSync(directory);\n} finally {\n  closeSync(directory);\n}');
  });

  test('Vim carries both clause words in its control-keyword group', () => {
    expect(vimSyntax).toMatch(/syn keyword ripKeyword\s+try catch finally/);
  });
});


describe('void readonly definition lockstep (editor grammars ⇄ compiler)', () => {
  const source = 'wipe! =! -> 1';

  test('TextMate names the constant, scopes the bang as the void marker, and the source compiles void', () => {
    const match = new RegExp(readonlyRule.match).exec(source);
    expect(match.slice(1)).toEqual(['wipe', '!', '=!']);
    expect(readonlyRule.captures['1'].name).toBe('variable.other.constant.rip');
    expect(readonlyRule.captures['2'].name).toBe('storage.modifier.rip');
    expect(readonlyRule.captures['3'].name).toBe('keyword.operator.assignment.readonly.rip');
    expect(compile(source, { runtimeDelivery: 'none' }).code)
      .toBe('const wipe = (function() {\n  1;\n  return;\n});');
  });

  test('a plain readonly binding leaves the void-marker capture empty', () => {
    expect(new RegExp(readonlyRule.match).exec('limit =! 100').slice(1))
      .toEqual(['limit', undefined, '=!']);
  });

  test('Vim admits the bang between the constant name and the glyph', () => {
    expect(vimSyntax).toMatch(/syn match\s+ripReadonlyName\s+\/\^\\s\*\\zs\[a-zA-Z_\$\]\[a-zA-Z0-9_\$\]\*\\ze!\\\?/);
  });
});

describe('hyphenated attribute lockstep (grammar ⇄ compiler)', () => {
  const tagRe = new RegExp(tagRule.begin);
  const attrRe = new RegExp(ownLineAttrRule.match);

  test('a tag word heading a hyphenated attribute is the attribute, not an element', () => {
    for (const [line, name] of [['      data-side: side', 'data-side'], ['      text-anchor: middle', 'text-anchor']]) {
      expect(line).not.toMatch(tagRe);
      expect(attrRe.exec(line)[1]).toBe(name);
      const { code } = compile(`P = component\n  render\n    div\n      ${line.trim()}\n`,
        { runtimeDelivery: 'none' });
      expect(code).toContain(`setAttribute('${name}', __v)`);
      expect(code).not.toContain(`createElement('${name.split('-')[0]}')`);
    }
  });

  test('the same word alone on its line is still the element', () => {
    expect(tagRe.exec('      data')[1]).toBe('data');
    expect('      data').not.toMatch(attrRe);
    expect(compile('P = component\n  render\n    div\n      data\n', { runtimeDelivery: 'none' }).code)
      .toContain("createElement('data')");
  });
});
