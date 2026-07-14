// The browser entry: the compiler surface plus exactly one copy of
// every browser-safe feature runtime. Browser compilation delivers
// runtimes by SCOPE, not by injection — compiled scripts run with
// these bindings provided by their loader — so compile() is used with
// runtimeDelivery 'none' here, and the runtime modules' process-wide
// sentinels guarantee one copy per bundle. Server-only surfaces
// (loader, run harness, project config, persistence, migration, CLI)
// are structurally unreachable from this module; the bundle gate pins
// that.
import { compile } from './compile.js';
import { runtimes } from './browser-runtimes.js';

export { compile };
export { runtimes };
export { processRipScripts } from './browser-scripts.js';
export { createModuleLoader } from './browser-modules.js';

// The compiler call browser loaders make: JavaScript out, runtimes by
// scope, original-position diagnostics carried on the thrown error.
// Browser compilation delivers runtimes by scope, never by emission,
// so another delivery mode rejects by name.
export function compileToJS(source, options = {}) {
  if (options.runtimeDelivery !== undefined && options.runtimeDelivery !== 'none') {
    throw new Error(
      `rip: browser compilation delivers runtimes by scope; runtimeDelivery '${options.runtimeDelivery}' is not available here`,
    );
  }
  return compile(source, { ...options, runtimeDelivery: 'none' });
}
