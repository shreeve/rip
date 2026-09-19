// Faithful harness (Philip Lindberg's editor-gaps bundle, relocated from
// editor-gaps/_server.mjs): drive the REAL src/server.js over LSP stdio,
// exactly as VS Code's language client does. This is the ONLY trustworthy
// way to characterize editor behavior: talking to tsgo directly
// reimplements the server's document/project handling and diverges from
// it — a tsgo-direct harness can "resolve" cross-file where the real
// server does not, which is exactly the false-optimism the bundle's
// retired _broker.mjs produced.
//
// The session itself is the shared editor harness (support/harness.mjs);
// this module keeps the bundle's calling shape — absolute paths, a root
// the server may never read — for the two editor-gaps suites.
// api.open/change return after the server publishes diagnostics for that
// document. api.codes(path) / api.has(path, re) read the LAST published
// diagnostics for it (unused-var noise filtered).
import { inSession } from './harness.mjs';

export { tsgoAvailable } from './harness.mjs';

// Run `fn(api)` against a live server rooted at `rootPath`, then tear down.
export const session = (rootPath, fn) => inSession(rootPath, fn, { capabilities: {} });
