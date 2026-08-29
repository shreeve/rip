// Bun loader plugin for .rip files: any `import` of a .rip module —
// direct, transitive, static, or dynamic — compiles through this
// pipeline at load time. Registered via `--preload` (the `rip` CLI does
// this) or a project bunfig.toml `preload` entry.
//
// Each compiled module carries its source map as an inline
// `sourceMappingURL` comment (for debuggers and map-aware tools) and
// registers the map with src/stackmap.js so the run harness can remap
// runtime stack frames to .rip source positions — Bun itself reads the
// module path from the plugin but not the map (src/stackmap.js).
// Compile failures throw CompileError — the message is the full
// formatted diagnostic (path:line:col plus a source excerpt), which
// Bun surfaces with a non-zero exit.

import { plugin } from 'bun';
import { readFileSync } from 'fs';
import { compile } from './compile.js';
import { toInlineMapComment } from './sourcemap.js';
import { registerModuleMap, remapStack } from './stackmap.js';
import { bareSpecifierMap } from './resolve.js';

// Async effect failures are report-and-continue by design (the
// record): the runtime prints them itself, and its default printer
// shows raw (generated-JS) stack coordinates. Under the loader those
// frames carry .rip paths with WRONG line numbers — so the first time
// a loaded module actually delivers the reactive runtime, install a
// reporter that remaps the stack through the same registry the run
// harness uses. Installing lazily keeps reactive-free sessions from
// evaluating the runtime module at all (its process-wide sentinel
// must stay unset until a real consumer loads a copy).
let reporterInstalled = false;
const installReactiveReporter = async () => {
  if (reporterInstalled) return;
  reporterInstalled = true;
  const rt = await import('./runtime/reactive.js');
  rt.__setEffectErrorReporter((label, err) => {
    console.error(label, remapStack(err?.stack ?? String(err)));
  });
};

// Bare-specifier resolution (the `rip/<pkg>` stdlib namespace and the
// bun-global-install fallback) is enumerated by src/resolve.js,
// shared with the sites artifact generator. Bun's runtime consults
// plugins' onLoad but not onResolve (measured on 1.3.14: the hook
// never fires for import statements), so here every name is registered
// as a virtual module at preload. The shim re-exports the real file,
// so module identity is shared with any path-based import of it.

await plugin({
  name: 'rip',
  setup(build) {
    // Forward `default` only when the entry declares one (or is CJS,
    // whose module.exports IS the default) — a shim that always
    // re-exports it would grow a spurious `default` key on every
    // named-exports-only ESM package.
    const shimFor = (path) => () => {
      const file = JSON.stringify(path);
      const src = readFileSync(path, 'utf8');
      const isEsm = /^\s*(export|import)\b/m.test(src);
      const hasDefault = /^\s*export\s+default\b/m.test(src);
      const forward = (!isEsm || hasDefault) ? `\nimport * as __m from ${file};\nexport default __m.default;` : '';
      return { contents: `export * from ${file};${forward}\n`, loader: 'js' };
    };

    for (const [name, path] of bareSpecifierMap()) build.module(name, shimFor(path));

    // rip/sites/configs — the same virtual module the sites artifact
    // generator serves to bundled workers, here for in-process
    // contexts (tests, REPL, scripts). The app is the nearest
    // serve.rip at or above cwd; tenant configs are enumerated from
    // its sites.dir and keyed by DIRECTORY NAME, exactly like the
    // bundler's emission. Throws only when actually imported.
    build.module('rip/sites/configs', () => ({
      loader: 'js',
      contents: `
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
let __dir = process.cwd(), __root = null;
for (;;) {
  if (existsSync(join(__dir, 'serve.rip'))) { __root = __dir; break; }
  const parent = dirname(__dir);
  if (parent === __dir) break;
  __dir = parent;
}
if (!__root) throw new Error('rip/sites/configs: no serve.rip found at or above ' + process.cwd() + ' — run from inside a Rip Sites app (bundled workers get this module from the generator)');
const __serve = (await import(join(__root, 'serve.rip'))).default;
const __sub = __serve?.sites?.dir;
if (typeof __sub !== 'string' || !__sub) throw new Error('rip/sites/configs: ' + join(__root, 'serve.rip') + ' does not declare sites.dir — tenant configs require sites mode');
const __sitesDir = join(__root, __sub);
const __configs = {};
for (const __name of readdirSync(__sitesDir).sort()) {
  const __stat = statSync(join(__sitesDir, __name), { throwIfNoEntry: false });
  const __config = join(__sitesDir, __name, 'config.rip');
  if (__stat?.isDirectory() && existsSync(__config)) __configs[__name] = (await import(__config)).default;
}
export default __configs;
`,
    }));

    const loadRip = async (args) => {
      const source = readFileSync(args.path, 'utf8');
      // The loader is a toolchain path: feature runtimes arrive
      // as ONE injected import of the shared runtime module — every
      // loaded module shares one copy per process.
      const { code, map, runtimes } = compile(source, { path: args.path, runtimeDelivery: 'import' });
      // The reporter must exist before the module's first effect can
      // run — awaited here, ahead of the module body's evaluation.
      if (runtimes.has('reactive')) await installReactiveReporter();
      // Bun ignores the inline map for runtime stack traces; the
      // registry lets the run harness remap frames at display time
      // (src/stackmap.js has the measured behavior).
      registerModuleMap(args.path, map);
      const sep = code.endsWith('\n') ? '' : '\n';
      return {
        contents: `${code}${sep}${toInlineMapComment(map)}\n`,
        loader: 'js',
      };
    };
    build.onLoad({ filter: /\.rip$/ }, loadRip);

    // One exact non-.rip path may be nominated by the CLI
    // (RIP_SHEBANG_ENTRY): an executable script whose
    // `#!/usr/bin/env rip` shebang names the language instead of the
    // extension (bin/rip's run()). It must be a VIRTUAL module, not an
    // onLoad filter: Bun's native JS loader claims extensionless files
    // before plugins are consulted (measured on 1.4.0 — the same class
    // of gap as onResolve above), but the virtual-module registry is
    // checked first, and a file: URL import normalizes to the
    // registered path. Relative imports inside the compiled code still
    // resolve against the script's own directory. One known cost: Bun
    // reports virtual-module stack frames with the path but NO
    // line/column, so runtime errors in the script name it without a
    // position (nothing for stackmap to remap). Consumed here —
    // deleted before the program body runs — so the program's own
    // children never inherit it.
    const shebangEntry = process.env.RIP_SHEBANG_ENTRY;
    delete process.env.RIP_SHEBANG_ENTRY;
    if (shebangEntry) build.module(shebangEntry, () => loadRip({ path: shebangEntry }));
  },
});
