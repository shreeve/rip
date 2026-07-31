// A `:=` state binding must NOT be tagged `readonly`.
//
// The editor forwards tsgo's semantic tokens over the FACE, remapping spans
// back to .rip. TypeScript's modifiers are truthful wherever the face's
// declaration keyword agrees with rip's semantics — and `:=` is the one form
// where it does not: the lowering binds a `const` CELL whose VALUE is mutable
// (`clicks = 5` compiles, becoming `clicks.value = 5`), so TypeScript calls the
// identifier readonly. That is true of the container and false of the name the
// author writes to. The compile reports each state name's generated span
// (`mutables`) and `ripSemanticTokens` clears the bit on exactly those.
//
// The immutable forms are POSITIVE CONTROLS, and they carry the weight here:
// `=!`, `~=` and `~>` also emit `const`, really are immutable, and must KEEP
// their `readonly`. Without them, a server that simply never reported modifiers
// would satisfy the `:=` expectation for free — the clearing has to be surgical,
// not a blanket strip. Every assertion is paired with a liveness check, so an
// empty token list can only ever be a real failure.
import { expect, test } from 'bun:test';
import { openSession } from '../support/lsp-session.js';
import { describeExtended } from '../support/extended.js';

// One binding per form. `plain` and `state` are writable in rip; `pinned`,
// `computed` and `effect` are not — the compiler rejects a write to them.
// (Certified by compiling each form followed by a reassignment; the rule is
// documented in test/audit/runner.js's token-machinery header.)
const SRC = [
  'plain = 1',                       // line 0 — let, writable
  'pinned =! 2',                     // line 1 — const, immutable
  'state := 3',                      // line 2 — const CELL, value WRITABLE
  'computed ~= state * 2',           // line 3 — const, immutable
  'effect ~> console.log state',     // line 4 — const, immutable
  '',
].join('\n');

// `:=` reaches the face by THREE different emitter paths, and only the bare
// top-level one is exercised above. Each is pinned here, because a refactor of
// any of them puts `readonly` back on a writable binding with every other gate
// still green — the token audit probes only column-0 declarations, so it would
// not see it either.
//
//   exported  → `export s := …` delegates to reactiveDecl, so it records the
//               same way as a bare one
//   nested    → a `:=` in a `def` body is still a reactiveDecl
//   component → a member `:=` takes a DIFFERENT path (emitState), lowering to a
//               `declare` class field rather than a `const` cell, so TypeScript
//               never calls it readonly and there is nothing to clear. Pinned
//               precisely because that could change: emit a `const` there and
//               the bug returns silently.
const PATHS = [
  'export exported := 1',            // line 0
  'def make()',                      // line 1
  '  nested := 2',                   // line 2
  '  nested',                        // line 3
  'Counter = component',             // line 4
  '  member := 3',                   // line 5
  '  render: ->',                    // line 6
  '    member',                      // line 7
  '',
].join('\n');

// The token that STARTS at a declaration's name.
const at = (tokens, line, character) => tokens.find((t) => t.line === line && t.character === character);

describeExtended('semantic tokens — the readonly modifier', () => {
  test('`readonly` is set IFF the binding is immutable in rip — `:=` is not', async () => {
    const session = await openSession({ 'app.rip': SRC });
    try {
      session.open('app.rip');
      const tokens = await session.semanticTokens('app.rip');
      expect(tokens.length).toBeGreaterThan(0);   // liveness: the server answered

      // Positive controls FIRST. These are what give the assertion below its
      // meaning: the probe demands `readonly` on every genuinely-immutable
      // form and gets it, so it demonstrably reads modifiers.
      for (const [name, line] of [['pinned', 1], ['computed', 3], ['effect', 4]]) {
        const tok = at(tokens, line, 0);
        expect(tok, `${name} has a token`).toBeDefined();
        expect(tok.modifiers, `${name} is immutable in rip`).toContain('readonly');
      }

      // Negative control: a plain `=` binding hoists to an evolving `let`, so
      // it carries no `readonly`. Both polarities are now exercised — the
      // check cannot be passing vacuously.
      const plain = at(tokens, 0, 0);
      expect(plain).toBeDefined();
      expect(plain.modifiers).not.toContain('readonly');

      // `state := 3` is assignable in rip — `state = 9` compiles, lowering
      // to `state.value = 9` — so the editor must not paint it as a constant.
      // The bit is cleared for this form and no other; the controls above prove
      // the clearing is surgical rather than a blanket strip.
      const state = at(tokens, 2, 0);
      expect(state).toBeDefined();
      expect(state.modifiers).not.toContain('readonly');
      expect(state.modifiers).toContain('declaration');   // still a declaration
    } finally {
      await session.close();
    }
  }, 60000);

  test('every lowering path that reaches a `:=` name — exported, nested, component member', async () => {
    const session = await openSession({ 'app.rip': PATHS });
    try {
      session.open('app.rip');
      const tokens = await session.semanticTokens('app.rip');
      expect(tokens.length).toBeGreaterThan(0);   // liveness

      // `export s := 1` — reactiveDecl, same as a bare one.
      const exported = at(tokens, 0, 7);
      expect(exported, 'exported state has a token').toBeDefined();
      expect(exported.modifiers).not.toContain('readonly');

      // `nested := 2` inside a def — still a reactiveDecl, still a `const` cell.
      const nested = at(tokens, 2, 2);
      expect(nested, 'nested state has a token').toBeDefined();
      expect(nested.modifiers).not.toContain('readonly');

      // A component member lowers to a `declare` field, not a `const` cell, so
      // TypeScript classifies it a property and never marks it readonly. This
      // asserts the OUTCOME, not the mechanism: whichever way it lowers, the one
      // reactive form you may assign to must not read as a constant.
      const member = at(tokens, 5, 2);
      expect(member, 'component member has a token').toBeDefined();
      expect(member.modifiers).not.toContain('readonly');
    } finally {
      await session.close();
    }
  }, 60000);

  // `readonly` is a fact about the BINDING, so it holds wherever the name
  // appears. Clearing it at the declaration alone left the write — the
  // position that proves the binding writable — painted immutable, and
  // the read beside it too. The audit scores the same ruling over the
  // corpus; this is the boundary, asserted directly: the `~=` name in the
  // same file KEEPS its bit at its own use, so the correction is still
  // surgical rather than a blanket strip over every reactive name.
  test('a `:=` name carries no `readonly` at its WRITE or its READ — and `~=` still does', async () => {
    const USES = [
      'total := 1',              // line 0
      'doubled ~= total * 2',    // line 1
      'total = 5',               // line 2  the write
      'console.log total',       // line 3  the read
      'console.log doubled',     // line 4  a computed's read — keeps readonly
      '',
    ].join('\n');
    const session = await openSession({ 'app.rip': USES });
    try {
      session.open('app.rip');
      const tokens = await session.semanticTokens('app.rip');
      expect(tokens.length).toBeGreaterThan(0);   // liveness

      const write = at(tokens, 2, 0);
      expect(write, 'the write site has a token').toBeDefined();
      expect(write.modifiers).not.toContain('readonly');

      const read = at(tokens, 3, 12);
      expect(read, 'the read site has a token').toBeDefined();
      expect(read.modifiers).not.toContain('readonly');

      // The positive control at a USE site, which is what makes the two
      // assertions above mean something: a blanket strip would clear this
      // one too, and rip's own ruling says a `~=` binding is immutable.
      const computedRead = at(tokens, 4, 12);
      expect(computedRead, 'the computed read has a token').toBeDefined();
      expect(computedRead.modifiers).toContain('readonly');
    } finally {
      await session.close();
    }
  }, 60000);
});

// An enum lowers to a const object PLUS a companion type alias sharing the
// name, so the two symbols merge and TypeScript classifies the merged
// symbol `type` at every position. The token names the construct the
// author declared (RULINGS.md, Tokens). All three positions answer
// separately — a correction reaching the declaration alone leaves two
// thirds standing — so all three are pinned.
describeExtended('semantic tokens — an enum name', () => {
  const ENUMS = [
    'enum Color',              // line 0
    '  Red = 1',               // line 1
    '  Blue = 2',              // line 2
    'shade: Color = Color.Red', // line 3
    'def paint(c: Color)',     // line 4
    '  c',                     // line 5
    '',
  ].join('\n');

  test('every occurrence classifies `enum` — declaration, annotation, value use', async () => {
    const session = await openSession({ 'app.rip': ENUMS });
    try {
      session.open('app.rip');
      const tokens = await session.semanticTokens('app.rip');
      expect(tokens.length).toBeGreaterThan(0);   // liveness

      for (const [label, line, character] of [
        ['the declaration', 0, 5],
        ['the annotation', 3, 7],
        ['the value use', 3, 15],
        ['a parameter annotation', 4, 13],
      ]) {
        const tok = at(tokens, line, character);
        expect(tok, `${label} has a token`).toBeDefined();
        expect(tok.type, label).toBe('enum');
        // The `readonly` the merged symbol carries off its const-object
        // half goes with the type — TypeScript's own enum tokens have none.
        expect(tok.modifiers, label).not.toContain('readonly');
      }
    } finally {
      await session.close();
    }
  }, 60000);

  // The correction resolves by SCOPE, never by spelling. A local that
  // re-binds the name is not the enum, and painting it `enum` is exactly
  // the over-reach v3's source-regex mechanism has.
  // An imported enum carries the same merged-symbol `type` classification
  // its declaration does, and the importing file's compile cannot know
  // that — the kind lives in the declaring module. In any project of more
  // than one file this is where MOST enum uses are, so a correction that
  // stopped at the declaring file would leave the majority mis-colored.
  test('an enum imported from another module classifies `enum` at its uses', async () => {
    const session = await openSession({
      'lib.rip': 'export enum Color\n  Red = 1\n  Blue = 2\n\nexport plain = 7\n',
      'app.rip': [
        "import { Color, plain } from './lib.rip'",  // line 0
        '',
        'shade: Color = Color.Red',                  // line 2
        'console.log plain',                         // line 3
        '',
      ].join('\n'),
    });
    try {
      session.open('app.rip');
      const tokens = await session.semanticTokens('app.rip');
      expect(tokens.length).toBeGreaterThan(0);   // liveness

      expect(at(tokens, 2, 7)?.type, 'the imported annotation').toBe('enum');
      expect(at(tokens, 2, 15)?.type, 'the imported value use').toBe('enum');
      // The negative control: an imported name that is NOT an enum keeps
      // TypeScript's own answer. Without it, a correction that repainted
      // every imported reference would pass the two assertions above.
      const notAnEnum = at(tokens, 3, 12);
      expect(notAnEnum, 'the plain import has a token').toBeDefined();
      expect(notAnEnum.type, 'a non-enum import is untouched').not.toBe('enum');
    } finally {
      await session.close();
    }
  }, 60000);

  // Every position that re-uses the spelling, DECLARATIONS INCLUDED. The
  // first version of this test asserted only the body read and passed
  // while the parameter one line above it was painted `enum` — the two
  // scope walks answer about the ENCLOSING scope, and at a parameter or a
  // class member the binding being written is not in that scope yet. A
  // read is the easy half; the declaration is where this breaks.
  test('nothing that merely re-uses the spelling is the enum — parameter, class member, local', async () => {
    const SHADOW = [
      'enum Color',                 // line 0
      '  Red = 1',                  // line 1
      'def paint(Color)',           // line 2  the PARAMETER — was painted `enum`
      '  Color',                    // line 3  its read
      'class P',                    // line 4
      '  Color: 3',                 // line 5  a class member — was painted `enum`
      'def repaint()',              // line 6
      '  Color = "not the enum"',   // line 7
      '  Color',                    // line 8
      '',
    ].join('\n');
    const session = await openSession({ 'app.rip': SHADOW });
    try {
      session.open('app.rip');
      const tokens = await session.semanticTokens('app.rip');
      expect(tokens.length).toBeGreaterThan(0);   // liveness

      // The positive control: the enum itself still classifies, so a
      // guard that simply stopped recording would not pass this.
      expect(at(tokens, 0, 5)?.type, 'the enum itself').toBe('enum');

      for (const [label, line, character] of [
        ['the parameter declaration', 2, 10],
        ['the parameter read', 3, 2],
        ['the class member', 5, 2],
        ['the shadowing local', 8, 2],
      ]) {
        const tok = at(tokens, line, character);
        expect(tok, `${label} has a token`).toBeDefined();
        expect(tok.type, label).not.toBe('enum');
      }
    } finally {
      await session.close();
    }
  }, 60000);
});

// A FORWARD-REFERENCED class binding keeps its `class` color.
//
// TypeScript classifies a binding from its DECLARATION's initializer, so
// `let Shape = class {…}` colors `class` unaided. A forward reference splits
// the two — the binding hoists to a bare `let Box;` and the class expression
// assigns below it — and the initializer tsgo would have read is not there.
// The compile reports the declaration's generated span (`classDecls`) and
// `ripSemanticTokens` repaints exactly those, the third correction of the
// shape `mutables` and `enums` already use.
//
// The three fixtures are one assertion each, and the last two carry the
// weight: a server that simply painted every hoisted name `class` would
// satisfy the first on its own.
describeExtended('semantic tokens — a forward-referenced class binding', () => {
  const FWD = [
    'make = -> (new Box())',   // line 0 — reads Box above its declaration
    'Box = class',             // line 1 — hoisted, so the face spells it `let`
    "  greet: -> 'hi'",
    'console.log make().greet()',
    '',
  ].join('\n');

  const PLAIN = [
    'Shape = class',           // line 0 — declared before any use
    "  area: -> 1",
    'console.log (new Shape()).area()',
    '',
  ].join('\n');

  // A forward-referenced binding that is NOT a class. It hoists identically —
  // same `let obj;` spelling, same split — so it is the control that proves
  // the correction is keyed by the compiler's span and not by the hoist.
  const NOTACLASS = [
    'make = -> obj.a',         // line 0
    'obj = { a: 1 }',          // line 1 — hoisted, and a variable
    'console.log make()',
    '',
  ].join('\n');

  // A component lowers to a class expression, and a forward-rendered child is
  // ordinary component-library structure — the spelling that reaches real code.
  const COMPONENT = [
    'Parent = component',
    '  render',
    "    Child text: 'hi'",
    '',
    'Child = component',       // line 4 — rendered above its declaration
    '  @text: string',
    '  render',
    '    div',
    '      = @text',
    '',
  ].join('\n');

  const typeAt = async (files, file, line, character, label) => {
    const session = await openSession(files);
    try {
      session.open(file);
      const tokens = await session.semanticTokens(file);
      expect(tokens.length, 'liveness').toBeGreaterThan(0);
      const tok = at(tokens, line, character);
      expect(tok, `${label} has a token`).toBeDefined();
      return tok.type;
    } finally {
      await session.close();
    }
  };

  // An EXPORTED forward reference needs no correction and gets none: the
  // export lowers to `export const Box = class {…}`, which keeps the
  // initializer TypeScript classifies from. Asserted because it is the
  // spelling most likely to start needing one — a change to how exports
  // lower would move it into the split silently, and this reds.
  const EXPORTED = [
    'make = -> (new Box())',
    'export Box = class',      // line 1 — keeps its initializer
    '  g: -> 1',
    'console.log make().g()',
    '',
  ].join('\n');

  test('a forward-referenced class declaration colors `class`, as the declared spelling does', async () => {
    expect(await typeAt({ 'app.rip': FWD }, 'app.rip', 1, 0, 'the Box declaration')).toBe('class');
    expect(await typeAt({ 'app.rip': PLAIN }, 'app.rip', 0, 0, 'the Shape declaration')).toBe('class');
    expect(await typeAt({ 'app.rip': EXPORTED }, 'app.rip', 1, 7, 'the exported Box declaration')).toBe('class');
  }, 60000);

  // USE SITES, not just the declaration. A file has one declaration and many
  // uses, so a correction that repainted only the declaration would leave the
  // name disagreeing with itself everywhere it is read — more visible than the
  // defect it replaced. References join the channel through `noteNameSpan`,
  // the same funnel enum references use.
  test('every occurrence colors `class` — the use site, not only the declaration', async () => {
    // `new Box()` on line 0; the declaration below it on line 1.
    expect(await typeAt({ 'app.rip': FWD }, 'app.rip', 0, 15, 'the Box use')).toBe('class');
    // Declare-in-place is repainted too, idempotently: tsgo already answers
    // `class` there, so this asserts the correction never makes it worse.
    expect(await typeAt({ 'app.rip': PLAIN }, 'app.rip', 2, 17, 'the Shape use')).toBe('class');
  }, 60000);

  test('a forward-referenced component declaration colors `class` too', async () => {
    expect(await typeAt({ 'app.rip': COMPONENT }, 'app.rip', 4, 0, 'the Child declaration')).toBe('class');
  }, 60000);

  test('a forward-referenced NON-class stays `variable` — the correction is the compiler\'s span, not the hoist', async () => {
    expect(await typeAt({ 'app.rip': NOTACLASS }, 'app.rip', 1, 0, 'the obj declaration')).toBe('variable');
  }, 60000);
});
