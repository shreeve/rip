// One copy of every browser-safe feature runtime, assembled once:
// the scope namespace loaders inject around evaluated output.
// Server-only runtime names (persistence) are deliberately absent.
import * as intrinsics from './runtime/intrinsics.js';
import * as stdlib from './runtime/stdlib.js';
import * as schema from './runtime/schema.js';
import * as reactive from './runtime/reactive.js';
import * as components from './runtime/components.js';

export const runtimes = Object.freeze({
  ...intrinsics,
  ...stdlib,
  ...schema,
  ...reactive,
  ...components,
});
