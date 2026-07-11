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

await plugin({
  name: 'rip',
  setup(build) {
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
      // (src/stackmap.js has the measured behavior).
      registerModuleMap(args.path, map);
      const sep = code.endsWith('\n') ? '' : '\n';
      return {
        contents: `${code}${sep}${toInlineMapComment(map)}\n`,
        loader: 'js',
      };
    });
  },
});
