// REGRESSION GUARD (gap 1 of Philip Lindberg's editor-gaps bundle,
// relocated from editor-gaps/ into this package per the repo's test
// boundary — extension tests live only in packages/vscode): cross-file
// .rip imports resolve in the editor, and an imported value's type flows
// across the file boundary.
//
// The guarded failure mode: per-buffer mirrors that never group into one
// tsgo program — a tsconfig `include` only groups on-disk files, so
// in-memory-only mirrors fragment the project, app.rip.ts can't see
// util.rip.ts, and TS2307 persists even with both files open (confirmed
// structural in the bundle: forcing mirrors onto disk makes cross-file
// resolve — not the import shape, not a bug). The disk-mirror project
// model is what keeps this green; if it regresses, this suite goes red
// with the original reproduction.
//
// Opt-in via RIP_REQUIRE_TSGO (this package's `bun run test` arms it);
// the repo's root suite excludes packages/** mechanically. Driven through
// the real src/server.js (see support/gaps-server.mjs); a tsgo-direct
// harness falsely resolves and must not be used.
import { test, expect, describe } from 'bun:test';
import { tsgoAvailable, session } from './support/gaps-server.mjs';

// Availability gate: with RIP_REQUIRE_TSGO set (the package's canonical
// test script), a missing tsgo is a hard failure; without it the suite
// skips quietly.
const RUN = !!process.env.RIP_REQUIRE_TSGO && tsgoAvailable;
if (process.env.RIP_REQUIRE_TSGO && !tsgoAvailable) {
  test('tsgo present (RIP_REQUIRE_TSGO)', () => {
    throw new Error('RIP_REQUIRE_TSGO is set but tsgo was not found — run `bun install` in packages/vscode');
  });
}

const APP = 'import { answer } from "./util.rip"\nbad = answer.toUpperCase()\n';

describe.skipIf(!RUN)('cross-file .rip imports resolve in the editor', () => {
  // Most favorable case: the dependency is open and the importer re-checked.
  // The import resolves (no TS2307) and `answer`'s real type (42) flows so
  // the string-method misuse is caught (TS2339).
  test('an imported value resolves and its type flows across files', async () => {
    await session('/proj', async (api) => {
      await api.open('/proj/util.rip', 'export answer = 42\n');
      await api.open('/proj/app.rip', APP);
      await api.change('/proj/app.rip', APP + '\n'); // re-check with the dependency present
      expect(api.codes('/proj/app.rip')).not.toContain(2307); // module resolves
      expect(api.codes('/proj/app.rip')).toContain(2339);     // real type flows → bug caught
    });
  }, 30000);
});
