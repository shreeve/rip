// Finding #15 — a `:=` state binding is tagged `readonly`.
//
// The editor forwards tsgo's semantic tokens over the FACE, remapping spans
// back to .rip but never touching the type or modifier bits (server.js
// `ripSemanticTokens`). That is right wherever the face's declaration keyword
// agrees with rip's semantics — and `:=` is the one form where it does not:
// the lowering emits a `const` CELL whose VALUE is mutable (`clicks = 5`
// compiles, becoming `clicks.value = 5`), so TypeScript calls the binding
// readonly and the bit rides through. The editor then paints the one reactive
// form you are meant to assign to as a constant.
//
// This is an OPEN gap, so the `:=` test asserts the current, WRONG behavior on
// purpose — and says so. The day `ripSemanticTokens` learns to clear the bit
// for state bindings, `toContain('readonly')` goes red: that is the cue to
// invert this test and close #15, not a regression.
//
// Deliberately NOT written as `test.failing`: under that, any throw counts as
// a pass, so a dead tsgo or a broken mapping — no tokens at all — would report
// green, indistinguishable from the gap it means to record. Every assertion is
// therefore paired with a liveness check (the token must EXIST), and the
// immutable forms below are positive controls: they demand the `readonly` bit
// and get it, which is what proves the probe can see modifiers at all. Without
// them, a server that returned no modifiers ever would satisfy the `:=`
// expectation for free once the gap is closed.
import { expect, test, describe } from 'bun:test';
import { openSession } from '../support/lsp-session.js';
import { describeExtended } from '../support/extended.js';

// One binding per form. `plain` and `state` are writable in rip; `pinned`,
// `computed` and `effect` are not — the compiler rejects a write to them.
// (Certified by compiling each form followed by a reassignment; the rule is
// documented in test/type-audit/runner.js's token-machinery header.)
const SRC = [
  'plain = 1',                       // line 0 — let, writable
  'pinned =! 2',                     // line 1 — const, immutable
  'state := 3',                      // line 2 — const CELL, value WRITABLE  ← the gap
  'computed ~= state * 2',           // line 3 — const, immutable
  'effect ~> console.log state',     // line 4 — const, immutable
  '',
].join('\n');

// The token that STARTS at a declaration's name.
const at = (tokens, line, character) => tokens.find((t) => t.line === line && t.character === character);

describeExtended('semantic tokens — the readonly modifier (#15)', () => {
  test('`:=` is tagged readonly though rip lets you assign to it — the open gap', async () => {
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

      // THE GAP. `state := 3` is assignable in rip, so this SHOULD be
      // `not.toContain('readonly')`. It is not, today. When the fix lands this
      // line goes red — invert it and close #15.
      const state = at(tokens, 2, 0);
      expect(state).toBeDefined();
      expect(state.modifiers).toContain('readonly');
    } finally {
      await session.close();
    }
  }, 60000);
});
