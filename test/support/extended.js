// The suite-split gate: the default `bun run test` loop carries
// every in-process test; the EXTENDED tier — process-spawning
// validation gates (tsc), the scaling gates, the fuzz layer — runs
// under RIP_EXTENDED=1, which `bun run test:all` sets. CI runs the
// extended tier always.
//
// The gate pattern: with
// the flag absent, an extended suite registers ONE visible skip
// placeholder — never a silent absence — and in a CI environment the
// placeholder FAILS instead, so a CI configuration that stops setting
// RIP_EXTENDED cannot go green while the extended tier silently
// stops running.
import { describe, test } from 'bun:test';

export const EXTENDED = Boolean(process.env.RIP_EXTENDED);

export const describeExtended = EXTENDED
  ? describe
  : (name) => describe(name, () => {
      if (process.env.CI) {
        test('the extended tier is REQUIRED in CI but RIP_EXTENDED is unset', () => {
          throw new Error(
            'this run executes in CI (the CI environment variable is set) without RIP_EXTENDED — ' +
            'CI must run the extended tier (`bun run test:all`); a CI run cannot silently drop it',
          );
        });
      } else {
        test.skip('SKIPPED: extended tier (`bun run test:all` runs it; CI always does)', () => {});
      }
    });
