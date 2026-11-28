// Feature-runtime delivery: the runtime table and the inline bodies.
//
// Packaging follows the compilation context:
//   'none'   — emit the bare program (references like `__schema` stay
//              free identifiers). The low-level default: tests and
//              test comparisons see undecorated output.
//   'import' — toolchain paths (the loader): ONE injected import of
//              the shared runtime module, mapped as a synthetic row
//              (zero-width source anchor on the program node).
//   'inline' — carried-away output (compile-to-file/stdout): the
//              runtime body inlined ONCE, IIFE-wrapped so only the
//              needed names bind; the runtime's own sentinel rejects
//              two standalone copies meeting in one process.
// Scope-aware suppression: a user binding shadowing a runtime name at
// PROGRAM scope (hoist target, import binding, export const —
// decided statically) suppresses injection for that name;
// function-scope shadowing is the user's local choice and suppresses
// nothing.

import { readFileSync } from 'fs';
import { locateRuntimes } from './runtimes.js';
import { RUNTIME_DIR } from '../runtime-dir.js';

// The delivered-runtime table (src/emit/runtimes.js), each runtime's
// module located in src/runtime/.
export const RUNTIME_TABLE = locateRuntimes(RUNTIME_DIR);

// The export line is the module's ES seam: inline delivery strips it, and
// the declaration beside the runtime (src/ts/runtime-decls.js) reads the
// module's export names off it, so both see the same list. A runtime's
// import of a sibling runtime module is a seam likewise: inlined bodies
// share one IIFE scope, so both lines strip and the references bind
// directly.
const RUNTIME_EXPORT_LINE = /^export \{([^}]*)\};\s*$/gm;
const SIBLING_IMPORT_LINE = /^import \{[^}]*\} from '\.\/[a-z-]+\.js';\s*$/gm;

// Inline-mode body text, lazily read and cached per runtime.
const runtimeBodies = new Map();
export const runtimeText = (rt) => {
  if (!runtimeBodies.has(rt.key)) {
    const raw = readFileSync(rt.url, 'utf8');
    const body = raw.replace(RUNTIME_EXPORT_LINE, '').replace(SIBLING_IMPORT_LINE, '').trimEnd();
    // A surviving `import`/`export` is a syntax error in the shared IIFE
    // scope — and nothing downstream re-parses the output, so the compile
    // would SUCCEED and the program fail to load. Both strips are global
    // so a runtime may carry several; anything they cannot reach is
    // refused here rather than shipped.
    const stray = /^[ \t]*(import|export)\b.*$/m.exec(body);
    if (stray) {
      throw new Error(
        `emitter: runtime '${rt.key}' carries a top-level ${stray[1]} that inline delivery cannot strip — ` +
        `${JSON.stringify(stray[0].trim())}. Inline bodies share one IIFE scope, so it would emit unparseable ` +
        `output. Use the './name.js' import form, or move the dependency into RUNTIME_TABLE 'requires'.`);
    }
    runtimeBodies.set(rt.key, body);
  }
  return runtimeBodies.get(rt.key);
};

export const _runtimeTable = () => RUNTIME_TABLE;
// The names a runtime module exports, read off its export line.
export const _runtimeExports = (rt) => [...readFileSync(rt.url, 'utf8').matchAll(RUNTIME_EXPORT_LINE)]
  .flatMap(([, list]) => list.split(',').map((s) => s.trim()).filter(Boolean));
