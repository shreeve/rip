// Annotation validator: every malformed annotation must FAIL generation
// with a precise, rule-identifying error.
import { describe, test, expect } from 'bun:test';
import { Generator } from '../solar.rip';

// Minimal grammar shell around a single rule handle.
const g = (handle) => ({ start: 'S', grammar: { S: [handle] } });

describe('annotation validation', () => {
  test('accepts a valid annotation; named literals become literal roles with decoded values', () => {
    const gen = new Generator(g(['ID = ID', '["=", 1, 3]', 'assign: operator, target, value']));
    expect(gen.semantics[1]).toEqual({
      kind: 'assign',
      roles: [
        { name: 'operator', grammarRef: null, childSlot: 0, literal: '=' },
        { name: 'target', grammarRef: 1, childSlot: 1, spread: false },
        { name: 'value', grammarRef: 3, childSlot: 2, spread: false },
      ],
    });
  });

  test('boolean and null literal elements decode to real JS values', () => {
    const gen = new Generator(g(['ID', '[true, null, 1]', 'x: flag, nothing, val']));
    expect(gen.semantics[1].roles).toEqual([
      { name: 'flag', grammarRef: null, childSlot: 0, literal: true },
      { name: 'nothing', grammarRef: null, childSlot: 1, literal: null },
      { name: 'val', grammarRef: 1, childSlot: 2, spread: false },
    ]);
  });

  test('string literals decode JS backslash escapes', () => {
    const gen = new Generator(g(['ID', '["a\\"b", 1]', 'x: label, val']));
    expect(gen.semantics[1].roles[0]).toEqual(
      { name: 'label', grammarRef: null, childSlot: 0, literal: 'a"b' }
    );
    const single = new Generator(g(['ID', "['it\\'s', 1]", 'x: label, val']));
    expect(single.semantics[1].roles[0].literal).toBe("it's");
    const tab = new Generator(g(['ID', '["a\\tb", 1]', 'x: label, val']));
    expect(tab.semantics[1].roles[0].literal).toBe('a\tb');
  });

  test("'_' on a literal element yields no role", () => {
    const gen = new Generator(g(['ID = ID', '["def", 1, 3]', 'def: _, name, body']));
    expect(gen.semantics[1]).toEqual({
      kind: 'def',
      roles: [
        { name: 'name', grammarRef: 1, childSlot: 1, spread: false },
        { name: 'body', grammarRef: 3, childSlot: 2, spread: false },
      ],
    });
  });

  test('kind-only annotation on a zero-element template', () => {
    const gen = new Generator(g(['ID', '[]', 'list']));
    expect(gen.semantics[1]).toEqual({ kind: 'list', roles: [] });
  });

  test('childSlot is null for elements after a spread (landed index not static)', () => {
    const gen = new Generator(g(['ID ( ID )', '[...1, 3]', 'call: ...parts, extra']));
    expect(gen.semantics[1].roles).toEqual([
      { name: 'parts', grammarRef: 1, childSlot: 0, spread: true },
      { name: 'extra', grammarRef: 3, childSlot: null, spread: false },
    ]);
  });

  test('string-literal tags containing commas do not shift slots', () => {
    const gen = new Generator(g(['ID , ID', '[",", 1, 3]', 'pair: _, first, second']));
    expect(gen.semantics[1].roles).toEqual([
      { name: 'first', grammarRef: 1, childSlot: 1, spread: false },
      { name: 'second', grammarRef: 3, childSlot: 2, spread: false },
    ]);
  });

  test('string-literal tags containing brackets are valid flat templates', () => {
    const gen = new Generator(g(['ID [ ID ]', '["[]", 1, 3]', 'index: _, object, key']));
    expect(gen.semantics[1]).toEqual({
      kind: 'index',
      roles: [
        { name: 'object', grammarRef: 1, childSlot: 1, spread: false },
        { name: 'key', grammarRef: 3, childSlot: 2, spread: false },
      ],
    });
  });

  test('rejects annotation on template with unsupported elements', () => {
    expect(() => new Generator(g(['ID = ID', '[foo, 1, 3]', 'assign: _, target, value'])))
      .toThrow(/only flat array construction templates can be annotated/);
  });

  test('rejects quoted elements that are executable expressions, not string literals', () => {
    expect(() => new Generator(g(['ID', '["a"+String(1)+"b", 1]', 'x: lit, target'])))
      .toThrow(/only flat array construction templates can be annotated/);
  });

  test('rejects quoted elements with extra tokens after the closing quote', () => {
    expect(() => new Generator(g(['ID', '["x" "y", 1]', 'x: lit, target'])))
      .toThrow(/only flat array construction templates can be annotated/);
  });

  test('accepts spread roles aligned with spread refs', () => {
    const gen = new Generator(g(['ID ( ID )', '[1, ...3]', 'call: callee, ...args']));
    expect(gen.semantics[1]).toEqual({
      kind: 'call',
      roles: [
        { name: 'callee', grammarRef: 1, childSlot: 0, spread: false },
        { name: 'args', grammarRef: 3, childSlot: 1, spread: true },
      ],
    });
  });

  test('rejects wrong part count (every element needs a part)', () => {
    expect(() => new Generator(g(['ID = ID', '["=", 1, 3]', 'assign: target, value'])))
      .toThrow(/3 element\(s\) but annotation names 2 part\(s\)/);
  });

  test("rejects '_' on a position ref", () => {
    expect(() => new Generator(g(['ID = ID', '["=", 1, 3]', 'assign: _, _, value'])))
      .toThrow(/position ref 1 requires a real role name, not '_'/);
  });

  test('rejects kind-only form when the template has elements', () => {
    expect(() => new Generator(g(['ID = ID', '["=", 1, 3]', 'assign'])))
      .toThrow(/annotation must be 'kind: part, \.\.\.' naming each one/);
  });

  test('rejects parts on a zero-element template', () => {
    expect(() => new Generator(g(['ID', '[]', 'list: x'])))
      .toThrow(/kind-only annotation takes no parts; template has no elements/);
  });

  test('rejects missing spread marker on spread ref', () => {
    expect(() => new Generator(g(['ID ( ID )', '[1, ...3]', 'call: callee, args'])))
      .toThrow(/spread ref \.\.\.3 requires spread role '\.\.\.args'/);
  });

  test('rejects spread marker on non-spread ref', () => {
    expect(() => new Generator(g(['ID = ID', '["=", 1, 3]', 'assign: _, ...target, value'])))
      .toThrow(/marked spread but ref 1 is not a spread/);
  });

  test('rejects spread marker on a literal element', () => {
    expect(() => new Generator(g(['ID = ID', '["=", 1, 3]', 'assign: ...operator, target, value'])))
      .toThrow(/literal element "=" cannot take a spread role/);
  });

  test('rejects reserved role name $self', () => {
    expect(() => new Generator(g(['ID = ID', '["=", 1, 3]', 'assign: _, $self, value'])))
      .toThrow(/'\$self' is a reserved role name/);
  });

  test('rejects duplicate role names', () => {
    expect(() => new Generator(g(['ID = ID', '["=", 1, 3]', 'assign: _, x, x'])))
      .toThrow(/duplicate role 'x'/);
  });

  test('rejects duplicate role names across literal and ref parts', () => {
    expect(() => new Generator(g(['ID = ID', '["=", 1, 3]', 'assign: x, x, value'])))
      .toThrow(/duplicate role 'x'/);
  });

  test('rejects invalid semantic kind', () => {
    expect(() => new Generator(g(['ID = ID', '["=", 1, 3]', '9kind: a, b, c'])))
      .toThrow(/invalid semantic kind '9kind'/);
  });

  test('rejects annotation on executable-JS action', () => {
    expect(() => new Generator(g(['ID = ID', '$1.parenthesized = true', 'assign: target'])))
      .toThrow(/only flat array construction templates can be annotated/);
  });

  test('nested-array scaffolds annotate as structural slots', () => {
    expect(() => new Generator(g(['IF ID ID', '["if", 2, [3]]', 'if: _, condition, _'])))
      .not.toThrow();
  });

  test('deeper nested-array scaffolds retain generator output', () => {
    const gen = new Generator(g(['IF ID', '["if", [["wrap", 2]]]', 'if: _, _']));
    expect(gen.semantics[1]).toEqual({ kind: 'if', roles: [] });
    expect(gen.ruleActions).toContain('return ["if", [["wrap", $[$0]]]];');
  });

  test('nested-array scaffolds cannot claim a mapping role', () => {
    expect(() => new Generator(g(['IF ID ID', '["if", 2, [3]]', 'if: _, condition, then'])))
      .toThrow(/nested structural element must be named '_'/);
  });

  test('a label on a reference carried inside a nested scaffold rejects', () => {
    expect(() => new Generator(g(['IF ID[x]', '["if", [2]]', 'if: _, _'])))
      .toThrow(/pattern label '\[x\]' sits on 'ID' \(position 2\), which the template carries — name it in the annotation string/);
  });

  test('a label on a deeply nested carried reference rejects', () => {
    expect(() => new Generator(g(['IF ID[x]', '["if", [[["branch", 2]]]]', 'if: _, _'])))
      .toThrow(/pattern label '\[x\].*position 2.*template carries/);
  });

  test('quoted digits and brackets inside nested scaffolds are not references', () => {
    const gen = new Generator(g(['IF ID[x]', '["if", [["literal [2]"]]]', 'if: _, _']));
    expect(gen.semantics[1].roles).toEqual([
      { name: 'x', grammarRef: 2, childSlot: null, spread: false },
    ]);
  });

  test('a nested spread reference is still template-carried', () => {
    expect(() => new Generator(g(['IF ID[x]', '["if", [[...2]]]', 'if: _, _'])))
      .toThrow(/pattern label '\[x\].*position 2.*template carries/);
  });

  test('quoted spread-shaped text is not a reference', () => {
    const gen = new Generator(g(['IF ID[x]', '["if", [["...2"]]]', 'if: _, _']));
    expect(gen.semantics[1].roles.at(-1)).toEqual(
      { name: 'x', grammarRef: 2, childSlot: null, spread: false }
    );
  });

  test('a nested position ref is range-checked', () => {
    expect(() => new Generator(g(['IF ID', '["if", [[3]]]', 'if: _, _'])))
      .toThrow(/position ref 3 out of range \(pattern has 2 symbol\(s\)\)/);
  });

  test('rejects position ref out of range', () => {
    expect(() => new Generator(g(['ID = ID', '["=", 1, 5]', 'assign: _, target, value'])))
      .toThrow(/position ref 5 out of range/);
  });

  test('rejects multiple annotation strings', () => {
    expect(() => new Generator(g(['ID = ID', '["=", 1, 3]', 'assign: _, a, b', 'extra: _, c, d'])))
      .toThrow(/multiple annotation strings/);
  });

  test('error identifies the offending rule', () => {
    expect(() => new Generator(g(['ID = ID', '["=", 1, 3]', 'assign: target, value'])))
      .toThrow(/S → ID = ID/);
  });
});

describe('pattern-label boundaries', () => {
  test('a label on an un-annotated rule rejects (the M1 reservation, enforced per-rule)', () => {
    expect(() => new Generator(g(['ID[left] = ID', '["=", 1, 3]'])))
      .toThrow(/pattern label '\[left\]' requires an annotated rule/);
  });

  test('bare bracket tokens in patterns are not labels', () => {
    const gen = new Generator({
      start: 'S',
      grammar: { S: [['[ ID ]', '["array", 2]', 'array: _, element']] },
    });
    expect(gen.semantics[1].kind).toBe('array');
  });
});

describe('options object coexistence (D1)', () => {
  test('annotation third, options fourth', () => {
    const gen = new Generator({
      start: 'S',
      grammar: { S: [['- ID', '["-", 2]', 'unary: operator, operand', { prec: 'UMINUS' }]] },
      operators: [['right', 'UMINUS']],
    });
    expect(gen.semantics[1].kind).toBe('unary');
    expect(gen.rules[0].precedence).toBe(1);
  });

  test('options third with an opt-out annotation', () => {
    const gen = new Generator({
      start: 'S',
      grammar: { S: [['- ID', '["-", 2]', '~ test plumbing', { prec: 'UMINUS' }]] },
      operators: [['right', 'UMINUS']],
    });
    expect(gen.semantics[1]).toBeUndefined();
    expect(gen.rules[0].precedence).toBe(1);
  });

  test('rejects multiple options objects', () => {
    expect(() => new Generator(g(['ID', 1, { prec: 'A' }, { prec: 'B' }])))
      .toThrow(/multiple options objects/);
  });
});

describe('constructor-coverage enforcement', () => {
  test('an unannotated constructor rule FAILS generation, identifying the rule', () => {
    expect(() => new Generator({
      start: 'S',
      grammar: {
        S: [
          ['A'],                          // pass-through: not a constructor
          ['A + A', '["+", 1, 3]'],       // constructor, unannotated → error
          ['A - A', '["-", 1, 3]', 'binary: operator, left, right'], // annotated
        ],
        A: [['ID']],
      },
    })).toThrow(/annotation coverage: 1 constructor rule\(s\) lack annotations/);
  });

  test("a '~ reason' opt-out is recorded and produces no side-table entry", () => {
    const gen = new Generator({
      start: 'S',
      grammar: {
        S: [
          ['A + A', '["+", 1, 3]', '~ intentional: covered by parent'],
          ['A'],
        ],
        A: [['ID']],
      },
    });
    expect(gen.optedOutConstructors).toEqual(['S → A + A (intentional: covered by parent)']);
    expect(gen.unannotatedConstructors).toEqual([]);
    expect(gen.semantics[1]).toBeUndefined();
  });

  test('a bare opt-out without a reason is rejected', () => {
    expect(() => new Generator(g(['ID = ID', '["=", 1, 3]', '~'])))
      .toThrow(/requires a reason/);
  });
});

// Pattern labels ('SYMBOL[role]'): pattern symbols the template drops
// from the s-expression still record RoleStore rows — spans that reach
// the side tables without appearing in parser output (erased type
// annotations are the founding case). The dropped symbol carries its
// role name IN THE PATTERN — naming lives where the thing lives; labels
// strip before grammar construction (D20 alternative (e)).
describe('pattern labels (side-band roles)', () => {
  test('a labeled dropped symbol records grammarRef with a null childSlot', () => {
    const gen = new Generator(g(['ID TYPE[annotation] = ID', '["=", 1, 4]', 'assign: operator, target, value']));
    expect(gen.semantics[1]).toEqual({
      kind: 'assign',
      roles: [
        { name: 'operator', grammarRef: null, childSlot: 0, literal: '=' },
        { name: 'target', grammarRef: 1, childSlot: 1, spread: false },
        { name: 'value', grammarRef: 4, childSlot: 2, spread: false },
        { name: 'annotation', grammarRef: 2, childSlot: null, spread: false },
      ],
    });
  });

  test('ambiguity needs no rule: two dropped occurrences each carry their own label', () => {
    const gen = new Generator(g(['ID TYPE[t1] ID TYPE[t2]', '[1, 3]', 'x: a, b']));
    expect(gen.semantics[1].roles.slice(2)).toEqual([
      { name: 't1', grammarRef: 2, childSlot: null, spread: false },
      { name: 't2', grammarRef: 4, childSlot: null, spread: false },
    ]);
  });

  test('a kind-only annotation accepts a labeled pattern', () => {
    const gen = new Generator(g(['TYPE[annotation]', '[]', 'list']));
    expect(gen.semantics[1]).toEqual({
      kind: 'list',
      roles: [{ name: 'annotation', grammarRef: 1, childSlot: null, spread: false }],
    });
  });

  test('labels strip before grammar construction: every table artifact matches the unlabeled spelling', () => {
    const labeled = new Generator(g(['ID TYPE[annotation] = ID', '["=", 1, 4]', 'assign: operator, target, value']));
    const plain = new Generator(g(['ID TYPE = ID', '["=", 1, 4]', 'assign: operator, target, value']));
    expect(labeled.symbolIds).toEqual(plain.symbolIds);
    expect(labeled.ruleTable).toEqual(plain.ruleTable);
    expect(labeled.conflicts).toBe(plain.conflicts);
    // The one difference is the recorded role.
    expect(labeled.semantics[1].roles.length).toBe(plain.semantics[1].roles.length + 1);
  });

  test('two rules identical but for labels still collide as duplicates (labels are not grammar identity)', () => {
    const gen = new Generator({
      start: 'S',
      grammar: {
        S: [
          ['ID TYPE[x]', '["s", 1]', 's: _, a'],
          ['ID TYPE', '["t", 1]', 't: _, a'],
        ],
      },
    });
    expect(gen.conflicts).toBeGreaterThan(0);
  });

  test('rejects a label on a template-carried symbol — its role lives in the annotation string', () => {
    expect(() => new Generator(g(['ID[target] = ID', '["=", 1, 3]', 'assign: _, target2, value'])))
      .toThrow(/pattern label '\[target\]' sits on 'ID' \(position 1\), which the template carries — name it in the annotation string/);
  });

  test('rejects a duplicate role name across the annotation string and labels', () => {
    expect(() => new Generator(g(['ID TYPE[value] = ID', '["=", 1, 4]', 'assign: _, target, value'])))
      .toThrow(/duplicate role 'value'/);
  });

  test('rejects two labels with the same role name', () => {
    expect(() => new Generator(g(['ID TYPE[t] ID TYPE[t]', '[1, 3]', 'x: a, b'])))
      .toThrow(/duplicate role 't'/);
  });

  test("rejects '$self' as a label name", () => {
    expect(() => new Generator(g(['ID TYPE[$self] = ID', '["=", 1, 4]', 'assign: _, target, value'])))
      .toThrow(/'\$self' is a reserved role name \(pattern label 'TYPE\[\$self\]'\)/);
  });

  test('rejects an empty label name', () => {
    expect(() => new Generator(g(['ID TYPE[] = ID', '["=", 1, 4]', 'assign: _, target, value'])))
      .toThrow(/pattern label 'TYPE\[\]' carries an empty role name/);
  });

  test('rejects malformed label syntax', () => {
    expect(() => new Generator(g(['ID TYPE[a][b] = ID', '["=", 1, 4]', 'assign: _, target, value'])))
      .toThrow(/malformed pattern label 'TYPE\[a\]\[b\]' — expected SYMBOL\[role\]/);
    expect(() => new Generator(g(['ID TYPE[a = ID', '["=", 1, 4]', 'assign: _, target, value'])))
      .toThrow(/malformed pattern label 'TYPE\[a' — expected SYMBOL\[role\]/);
    expect(() => new Generator(g(['ID TYPE[9x] = ID', '["=", 1, 4]', 'assign: _, target, value'])))
      .toThrow(/invalid role name '9x' in pattern label 'TYPE\[9x\]'/);
  });

  test('rejects a label on a rule with no annotation (no node to record on)', () => {
    expect(() => new Generator(g(['ID TYPE[x] = ID', '["=", 1, 4]'])))
      .toThrow(/pattern label '\[x\]' requires an annotated rule/);
  });

  test('rejects a label on a coverage opt-out rule', () => {
    expect(() => new Generator(g(['ID TYPE[x] = ID', '["=", 1, 4]', '~ plumbing'])))
      .toThrow(/pattern label '\[x\]' requires an annotated rule, not a coverage opt-out/);
  });

  test("rejects a ';' section in the annotation string, pointing at pattern labels", () => {
    expect(() => new Generator(g(['ID TYPE = ID', '["=", 1, 4]', 'assign: _, target, value; annotation@TYPE'])))
      .toThrow(/annotation strings carry no ';' section — record a dropped symbol's span with a pattern label: SYMBOL\[role\]/);
  });

  test('bracket terminals still parse as plain symbols (and may themselves carry a label)', () => {
    const gen = new Generator(g(['[ ID ][closer]', '["arr", 2]', 'arr: _, item']));
    expect(gen.semantics[1].roles).toEqual([
      { name: 'item', grammarRef: 2, childSlot: 1, spread: false },
      { name: 'closer', grammarRef: 3, childSlot: null, spread: false },
    ]);
  });
});
