// The suite-split gate: the default `bun run test` loop carries the
// in-process trees only (no test/spawn/). The EXTENDED tier — tsc
// validity gates, scaling gates, the fuzz layer — runs under
// RIP_EXTENDED=1, which `bun run test:all` sets. Process-lane pins
// live under test/spawn/ and run via `bun run test:spawn` or the
// root lane of `test:all`. CI certification runs the extended tier.
//
// Locally, with the flag absent, extended suites register NOTHING —
// a deliberate quiet omission (the fast loop is not the place that
// proves them). In CI the same absence FAILS: a configuration that
// stops setting RIP_EXTENDED must not go green while the tier silently
// stops running.
import { describe, test } from 'bun:test';

export const EXTENDED = Boolean(process.env.RIP_EXTENDED);

export const describeExtended = EXTENDED
  ? describe
  : (name, fn) => {
      if (!process.env.CI) return;
      describe(name, () => {
        test('the extended tier is REQUIRED in CI but RIP_EXTENDED is unset', () => {
          throw new Error(
            'this run executes in CI (the CI environment variable is set) without RIP_EXTENDED — ' +
            'CI must run the extended tier (`bun run test:all`); a CI run cannot silently drop it',
          );
        });
      });
    };
