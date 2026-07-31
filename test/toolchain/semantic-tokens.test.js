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

// A FORWARD-REFERENCED class binding loses its `class` color.
//
// The hoist split is the trigger, and it is the same one that used to leak a
// probe symbol (#41): read a class above its declaration and the binding stays
// hoisted, so the face spells it `let Box!: …` and tsgo — truthfully, about the
// face — calls it a variable. Declared before its uses the same binding takes
// declare-in-place, keeps a `class` face spelling, and colors correctly; that
// is the POSITIVE CONTROL below, and it carries the weight, because a server
// that simply never classified anything `class` would satisfy the negative for
// free.
//
// `ripSemanticTokens` already owns two corrections of exactly this shape —
// `mutables` clears a modifier, `enums` rewrites a type — both keyed by the
// generated start the compiler reports. A third of the same form is the fix;
// re-reading the .rip text to guess at `= class` is not, because a span the
// compiler declares is what survives lowering.
//
// An OPEN gap, asserted as-is: the day the correction lands this goes red,
// the cue to invert it. Liveness-paired.
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

  test('a forward-referenced class declaration colors `variable`, not `class` — an open gap, asserted as-is', async () => {
    const session = await openSession({ 'app.rip': FWD });
    try {
      session.open('app.rip');
      const tokens = await session.semanticTokens('app.rip');
      expect(tokens.length).toBeGreaterThan(0);   // liveness
      const tok = at(tokens, 1, 0);
      expect(tok, 'the Box declaration has a token').toBeDefined();
      expect(tok.type, 'the gap — the hoist split costs the binding form').toBe('variable');
    } finally {
      await session.close();
    }
  }, 60000);

  test('the same binding declared before its uses colors `class` — the control that makes the gap a gap', async () => {
    const session = await openSession({ 'app.rip': PLAIN });
    try {
      session.open('app.rip');
      const tokens = await session.semanticTokens('app.rip');
      expect(tokens.length).toBeGreaterThan(0);   // liveness
      const tok = at(tokens, 0, 0);
      expect(tok, 'the Shape declaration has a token').toBeDefined();
      expect(tok.type, 'declare-in-place keeps the form').toBe('class');
    } finally {
      await session.close();
    }
  }, 60000);
});
