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
// documented in test/type-audit/runner.js's token-machinery header.)
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
});
