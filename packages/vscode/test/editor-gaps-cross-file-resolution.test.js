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
// Skips when tsgo is unavailable; the package's `bun run test` runs a
// preflight that turns a missing binary into a hard failure first, and
// the repo's root suite excludes packages/** mechanically. Driven through
// the real src/server.js (see support/gaps-server.mjs); a tsgo-direct
// harness falsely resolves and must not be used.
import { test, expect, describe } from 'bun:test';
import { tsgoAvailable, session } from './support/gaps-server.mjs';

const APP = 'import { answer } from "./util.rip"\nbad = answer.toUpperCase()\n';

describe.skipIf(!tsgoAvailable)('cross-file .rip imports resolve in the editor', () => {
  // Most favorable case: the dependency is open and the importer re-checked.
  // The import resolves (no TS2307) and `answer`'s ANNOTATED type flows so
  // the string-method misuse is caught (TS2339). The annotation is what
  // carries it across — the gate's ACROSS rule; the inferred case is pinned
  // below.
  test('an imported value resolves and its type flows across files', async () => {
    await session('/proj', async (api) => {
      await api.open('/proj/util.rip', 'export answer: number = 42\n');
      await api.open('/proj/app.rip', APP);
      await api.change('/proj/app.rip', APP + '\n'); // re-check with the dependency present
      expect(api.codes('/proj/app.rip')).not.toContain(2307); // module resolves
      expect(api.codes('/proj/app.rip')).toContain(2339);     // real type flows → bug caught
    });
  }, 30000);

  // The declaration-scope gate is FILE-LOCAL for everything except this: an
  // import of an ANNOTATED export carries that export's type information
  // across the boundary. Without it the boundary is incoherent — move
  // `shout` into app.rip and the diagnostic appears, move it back and it
  // vanishes, on a program whose annotations never changed.
  //
  // Driven through the real server because `rip check` and the editor
  // compute this from different places (a whole-closure second pass there,
  // a per-dependency cache here) and the two must not answer differently.
  const TYPED_UTIL = 'export shout = (s: string): string -> s.toUpperCase()\nexport answer = 42\n';
  const MISUSE = 'import { shout } from "./util.rip"\nconsole.log shout(42)\n';
  const INFERRED = 'import { answer } from "./util.rip"\nconsole.log answer.toUpperCase()\n';

  test('an ANNOTATED export types its importer; an inferred one does not', async () => {
    await session('/proj', async (api) => {
      await api.open('/proj/util.rip', TYPED_UTIL);
      await api.open('/proj/app.rip', MISUSE);
      await api.change('/proj/app.rip', MISUSE + '\n');
      expect(api.codes('/proj/app.rip')).toContain(2345); // the annotation crossed
    });

    // The negative half, and the reason this is not simply "imports are
    // typed": `answer` carries no annotation in EITHER file, so nothing
    // crosses and the misuse stays held.
    await session('/proj2', async (api) => {
      await api.open('/proj2/util.rip', TYPED_UTIL);
      await api.open('/proj2/app.rip', INFERRED);
      await api.change('/proj2/app.rip', INFERRED + '\n');
      expect(api.codes('/proj2/app.rip')).not.toContain(2339);
    });
  }, 30000);
});
