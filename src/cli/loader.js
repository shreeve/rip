// Bun loader plugin for .rip files: any `import` of a .rip module —
// direct, transitive, static, or dynamic — compiles through this
// pipeline at load time. Registered via `--preload` (the `rip` CLI does
// this) or a project bunfig.toml `preload` entry.
//
// Each compiled module carries its source map as an inline
// `sourceMappingURL` comment (for debuggers and map-aware tools) and
// registers the map with src/cli/stackmap.js so the run harness can remap
// runtime stack frames to .rip source positions — Bun itself reads the
// module path from the plugin but not the map (src/cli/stackmap.js).
// Compile failures throw CompileError — the message is the full
// formatted diagnostic (path:line:col plus a source excerpt), which
// Bun surfaces with a non-zero exit.

import { plugin } from 'bun';
import { readFileSync } from 'fs';
import { compile } from '../compile.js';
import { toInlineMapComment } from '../sourcemap.js';
import { registerModuleMap, remapStack } from './stackmap.js';
import { bareSpecifierMap } from './stdlib.js';

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
  const rt = await import('../runtime/reactive.js');
  rt.__setEffectErrorReporter((label, err) => {
    console.error(label, remapStack(err?.stack ?? String(err)));
  });
};

// Bare-specifier resolution (the `rip/<pkg>` stdlib namespace and the
// bun-global-install fallback) is enumerated by src/cli/stdlib.js,
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

    build.onLoad({ filter: /\.rip$/ }, async (args) => {
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
      // (src/cli/stackmap.js has the measured behavior).
      registerModuleMap(args.path, map);
      const sep = code.endsWith('\n') ? '' : '\n';
      return {
        contents: `${code}${sep}${toInlineMapComment(map)}\n`,
        loader: 'js',
      };
    });
  },
});
