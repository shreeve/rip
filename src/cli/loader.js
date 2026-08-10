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
import { existsSync, readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { compile } from '../compile.js';
import { toInlineMapComment } from '../sourcemap.js';
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
  const rt = await import('../runtime/reactive.js');
  rt.__setEffectErrorReporter((label, err) => {
    console.error(label, remapStack(err?.stack ?? String(err)));
  });
};

// Stdlib namespace: `rip/<pkg>` (and `@rip-lang/<pkg>`, the published
// alias) resolves to this checkout's packages/<pkg> — no node_modules,
// no per-project install: whoever has rip has the whole stdlib. Bun's
// runtime consults plugins' onLoad but not onResolve (measured on
// 1.3.14: the hook never fires for import statements), so the mapping
// is registered as virtual modules instead — one per package entry,
// enumerated from the checkout at preload. Each package's manifest is
// honored: the exports map (string or import/default conditions, and
// every "./subpath" key becomes `rip/<pkg>/<subpath>`), then main,
// then <pkg>.rip / index.rip. Packages with no resolvable entry
// (editor extensions) are skipped. The shim re-exports the real file,
// so module identity is shared with any path-based import of it.
const packagesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages');

const stdlibEntries = () => {
  const entries = [];
  for (const name of readdirSync(packagesDir)) {
    const pkgDir = join(packagesDir, name);
    let manifest;
    try { manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')); } catch { continue; }
    const asFile = (target) => {
      if (target && typeof target === 'object') target = target.import ?? target.default;
      if (typeof target !== 'string') return null;
      const path = join(pkgDir, target);
      return existsSync(path) ? path : null;
    };
    const exp = manifest.exports;
    let root = null;
    if (typeof exp === 'string' || (exp && typeof exp === 'object' && !('.' in exp) && !Object.keys(exp).some((k) => k.startsWith('./')))) {
      root = asFile(exp);
    } else if (exp && typeof exp === 'object') {
      root = asFile(exp['.']);
      for (const [key, value] of Object.entries(exp)) {
        if (!key.startsWith('./')) continue;
        const path = asFile(value);
        if (path) entries.push([`${name}/${key.slice(2)}`, path]);
      }
    }
    root ??= [manifest.main, `${name}.rip`, 'index.rip'].map((f) => f && join(pkgDir, f)).find((p) => p && existsSync(p)) ?? null;
    if (root) entries.push([name, root]);
  }
  return entries;
};

await plugin({
  name: 'rip',
  setup(build) {
    for (const [sub, path] of stdlibEntries()) {
      const file = JSON.stringify(path);
      // Forward `default` only when the entry declares one — a shim
      // that always re-exports it would grow a spurious `default` key
      // on every named-exports-only package.
      const shim = () => {
        const hasDefault = /^\s*export\s+default\b/m.test(readFileSync(path, 'utf8'));
        const forward = hasDefault ? `\nimport * as __m from ${file};\nexport default __m.default;` : '';
        return { contents: `export * from ${file};${forward}\n`, loader: 'js' };
      };
      build.module(`rip/${sub}`, shim);
      build.module(`@rip-lang/${sub}`, shim);
    }

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
