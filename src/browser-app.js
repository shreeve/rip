// The browser distribution's built-in App package. It is compiled into
// rip.js once, alongside the compiler and runtimes, so each App publication
// carries only authored source and optional non-core browser packages.
import * as app from '../packages/app/index.rip';

const rash = Object.freeze({ rash: app.rash, check: app.check });

export const embeddedPackages = Object.freeze({
  '@rip-lang/app': app,
  '@rip-lang/app/rash': rash,
});

export { app };
