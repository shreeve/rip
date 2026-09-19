// Tier 3 pin probe over real LSP stdio — a still-hoisted def-referenced
// binding gets probed, pinned, and a wrong-typed write inside the def
// surfaces as a REAL TS diagnostic on rip source — the case TS7034
// suppression hides today. Unit halves live in test/unit/pins.test.js.
import { test, expect, describe } from 'bun:test';
import { tsgoAvailable, inWorkspace } from './support/harness.mjs';

// The rip source: `items` is def-referenced (stays hoisted; evolving
// inference is dead — TS7034, suppressed today), and `breakIt` writes
// it wrong-typed. Without a pin the bug is invisible; with the probe
// round it must surface as a type error on the write line.
const SRC = `items = ['a', 'b', 'c']

def filterBy(query: string)
  items.filter (s) -> s.includes(query)

def breakIt()
  items = 42
`;

describe.skipIf(!tsgoAvailable)('pin probe over LSP stdio', () => {
  test('def-referenced hoisted binding gets pinned; wrong-typed write surfaces on rip source', async () => {
    // A STRICT project: the wrong-write diagnostic is a pin giving the
    // implicit-any family PRECISION — strict is where that family
    // publishes, and gradual holds inference-with-certainty by design
    // (a pin is exactly materialized inference). The pin's other half,
    // truthful hover, is mode-independent and pinned elsewhere.
    await inWorkspace({ 'package.json': JSON.stringify({ rip: { strict: true } }) }, async (api) => {
      api.openNoWait('app.rip', SRC);
      // Two publishes expected: the unpinned pass, then the post-probe
      // re-refresh carrying the TS2322-class error. Poll for the error.
      let hit = null;
      for (let i = 0; i < 300 && !hit; i++) {
        await api.sleep(100);
        for (const p of api.publishesSince('app.rip', 0)) {
          hit = (p.diagnostics ?? []).find((d) => /not assignable|number/.test(d.message)) ?? hit;
        }
      }
      expect(hit).not.toBeNull();
      // Mapped to rip source: the wrong write sits on line 6 (0-based).
      expect(hit.range.start.line).toBe(6);
    }, { prefix: 'rip-pin-', capabilities: {} });
  }, 45000);
});
