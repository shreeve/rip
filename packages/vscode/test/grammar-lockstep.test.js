// The grammar LOCKSTEP check for own-line bare boolean flags: the
// TextMate grammar paints a line holding only a known HTML
// boolean-attribute name as an attribute, because the compiler sets
// that attribute on the ENCLOSING element (v3's bare-flag semantics —
// never a bogus child element). The painted list is DATA in
// rip.tmLanguage.json — nothing structural stops it drifting from the
// compiler's BOOLEAN_ATTRS — so this suite is the lockstep:
//
//   1. the grammar's alternation equals BOOLEAN_ATTRS minus `loop`
//      (the keyword claims that line at parse, exactly as the
//      compiler does), and
//   2. every painted name COMPILES as a flag of its enclosing element
//      through the real render DSL, in both faces, while an unlisted
//      word keeps its element reading and stays unpainted.
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import path from 'node:path';
import { compile } from '../../../src/compile.js';
import { BOOLEAN_ATTRS } from '../../../src/dom-vocab.js';

const grammar = JSON.parse(readFileSync(
  path.resolve(import.meta.dir, '..', 'syntaxes', 'rip.tmLanguage.json'), 'utf8'));

// The own-line flag rule, found by shape: a render-block pattern whose
// match anchors a line-start alternation followed by the end-of-line
// lookahead.
const renderBlock = grammar.patterns.find((p) =>
  typeof p.begin === 'string' && p.begin.includes('(render)'));
const flagRule = renderBlock.patterns.find((p) =>
  typeof p.match === 'string' && p.match.includes('disabled|'));

describe('own-line bare-flag lockstep (grammar ⇄ compiler)', () => {
  test('the grammar alternation is BOOLEAN_ATTRS minus `loop`', () => {
    const painted = flagRule.match.match(/\((\w+(?:\|\w+)+)\)/)[1].split('|');
    const expected = [...BOOLEAN_ATTRS].filter((n) => n !== 'loop');
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

  test('an unlisted bare word stays an element and stays unpainted', () => {
    const re = new RegExp(flagRule.match);
    expect('      spacer').not.toMatch(re);
    expect('      disabled: busy').not.toMatch(re); // the colon form is the key rule's
    const { code } = compile('P = component\n  render\n    div\n      spacer\n',
      { runtimeDelivery: 'none' });
    expect(code).toContain(`createElement('spacer')`);
  });
});
