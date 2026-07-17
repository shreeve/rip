// The mirror layout and its generated tsconfig — shared by the editor
// server (which materializes the mirror demand-driven, per keystroke)
// and the batch `rip check` (which materializes a target's closure once,
// then runs `tsc --noEmit` over it). Both need the SAME tsconfig and the
// SAME mirror-file naming, or the batch checker would resolve imports /
// @types / strictness differently from the editor.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const stripJsonComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const toPosix = (p) => p.split(path.sep).join('/');

// Resolve one `extends` specifier the way TS does, bounded: relative and
// absolute paths get the exact / +.json / +/tsconfig.json attempts; bare
// package specifiers resolve node-style from the extending config's
// directory. Null when unresolvable.
export function resolveExtends(spec, fromDir) {
  const attempts = [];
  if (spec.startsWith('.') || path.isAbsolute(spec)) {
    const base = path.resolve(fromDir, spec);
    attempts.push(base, base + '.json', path.join(base, 'tsconfig.json'));
    for (const p of attempts) {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }
    return null;
  }
  const req = createRequire(path.join(fromDir, 'noop.js'));
  for (const candidate of [spec, spec + '.json', spec + '/tsconfig.json']) {
    try { return req.resolve(candidate); } catch { /* next */ }
  }
  return null;
}

// Does the user's config — ANYWHERE in its resolved `extends` chain —
// set compilerOptions.types? Injecting types:["*"] over a chain that
// narrows types would clobber the user's narrowing, so unresolvable or
// unreadable links answer TRUE (conservative: never clobber what we
// cannot see). Visited files are recorded into `chain` so a watcher can
// re-govern when a chain member changes; `onUnresolved(spec)` is an
// optional log hook. Bounded depth, cycles guarded.
export function chainSetsTypes(configPath, chain, onUnresolved, visited = new Set(), depth = 0) {
  if (depth > 16 || visited.has(configPath)) return false; // cycle/degenerate
  visited.add(configPath);
  chain?.add(configPath);
  let text;
  try { text = fs.readFileSync(configPath, 'utf8'); } catch { return true; }
  const stripped = stripJsonComments(text);
  let parsed;
  try { parsed = JSON.parse(stripped); } catch {
    // Unparsable (trailing commas etc.): a textual probe decides `types`;
    // an extends we cannot follow is conservative.
    if (/"types"\s*:/.test(stripped)) return true;
    return /"extends"\s*:/.test(stripped);
  }
  if (parsed?.compilerOptions?.types !== undefined) return true;
  if (parsed?.extends === undefined) return false;
  const bases = Array.isArray(parsed.extends) ? parsed.extends : [parsed.extends];
  return bases.some((spec) => {
    if (typeof spec !== 'string') return true;
    const next = resolveExtends(spec, path.dirname(configPath));
    if (!next) { onUnresolved?.(spec); return true; }
    return chainSetsTypes(next, chain, onUnresolved, visited, depth + 1);
  });
}

// Walk up from `fromDir` looking for tsconfig.json, stopping at `anchor`
// (inclusive). Null when none exists under the workspace root.
export function nearestTsconfig(fromDir, anchor) {
  if (!fromDir || !anchor) return null;
  const root = path.resolve(anchor);
  let dir = path.resolve(fromDir);
  if (dir !== root && !dir.startsWith(root + path.sep)) return null;
  while (true) {
    const candidate = path.join(dir, 'tsconfig.json');
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* absent */ }
    if (dir === root) return null;
    dir = path.dirname(dir);
  }
}

// A generated WRAPPER tsconfig living at `mirrorDir`. When `sourceConfig`
// is set it extends that workspace file (compilerOptions only — wrappers
// own include/exclude so the source file set is not inherited). Reach-ups
// use path.relative so the wrapper may sit at any depth under the mirror.
//
// Overrides: noImplicitAny stays ON (it activates the evolving-`let`
// inference; the implicit-any family is suppressed per-code in
// translate.js), noEmit (the project never emits; also what legalizes
// allowImportingTsExtensions), and rootDirs merging the wrapper dir with
// the real workspace (a .rip file importing a real .ts sibling resolves).
export function generatedTsconfig({
  workspaceRoot,
  mirrorDir = null,
  sourceConfig = null,
  mirrorRootIsFallback,
  chain = new Set(),
  onUnresolved,
} = {}) {
  const overrides = {
    noImplicitAny: true,
    noEmit: true,
    allowImportingTsExtensions: true,
  };
  const wrapperDir = mirrorDir
    ?? (workspaceRoot ? path.join(workspaceRoot, '.rip', 'check') : '.');
  const toWorkspace = (!mirrorRootIsFallback && workspaceRoot)
    ? (toPosix(path.relative(wrapperDir, workspaceRoot)) || '.')
    : null;
  if (toWorkspace != null) overrides.rootDirs = ['.', toWorkspace];

  // Workspace AMBIENT declarations (`rip-env.d.ts` and kin) join the
  // program. An explicit `exclude` REPLACES the built-in defaults, so
  // `node_modules` is restated alongside the reach-up.
  const include = ['**/*.ts'];
  const exclude = ['node_modules'];
  if (toWorkspace != null) {
    include.push(`${toWorkspace}/**/*.d.ts`);
    exclude.push(`${toWorkspace}/**/node_modules`);
  }

  const userConfig = sourceConfig
    ?? ((!mirrorRootIsFallback && workspaceRoot && fs.existsSync(path.join(workspaceRoot, 'tsconfig.json')))
      ? path.join(workspaceRoot, 'tsconfig.json')
      : null);

  if (userConfig && fs.existsSync(userConfig)) {
    chain.clear();
    if (!chainSetsTypes(userConfig, chain, onUnresolved)) overrides.types = ['*'];
    return {
      extends: toPosix(path.relative(wrapperDir, userConfig)),
      compilerOptions: overrides,
      include,
      exclude,
    };
  }
  chain.clear();
  return {
    compilerOptions: {
      target: 'esnext', module: 'esnext', lib: ['esnext', 'dom'],
      types: ['*'],
      ...overrides,
    },
    include,
    exclude,
  };
}

// Plan one wrapper per distinct owning project directory for the given
// workspace source files. Returns [{ wrapperDir, sourceConfig, chain }].
export function planProjectTsconfigs(sourceFiles, { workspaceRoot, mirrorRoot, mirrorRootIsFallback } = {}) {
  if (mirrorRootIsFallback || !workspaceRoot) {
    const chain = new Set();
    return [{
      wrapperDir: mirrorRoot,
      sourceConfig: null,
      chain,
      config: generatedTsconfig({ workspaceRoot, mirrorDir: mirrorRoot, sourceConfig: null, mirrorRootIsFallback: true, chain }),
    }];
  }

  const byWrapper = new Map(); // wrapperDir → sourceConfig|null
  for (const fsPath of sourceFiles) {
    const cfg = nearestTsconfig(path.dirname(fsPath), workspaceRoot);
    const projectDir = cfg ? path.dirname(cfg) : workspaceRoot;
    const rel = path.relative(workspaceRoot, projectDir);
    const wrapperDir = (!rel || rel === '.') ? mirrorRoot : path.join(mirrorRoot, rel);
    if (!byWrapper.has(wrapperDir)) byWrapper.set(wrapperDir, cfg);
  }
  // Root wrapper covers faces whose nearest config is the workspace root
  // (and gives __external__/orphan faces a config to discover).
  if (!byWrapper.has(mirrorRoot)) {
    const rootCfg = path.join(workspaceRoot, 'tsconfig.json');
    byWrapper.set(mirrorRoot, fs.existsSync(rootCfg) ? rootCfg : null);
  }

  const plans = [];
  for (const [wrapperDir, sourceConfig] of byWrapper) {
    const chain = new Set();
    plans.push({
      wrapperDir,
      sourceConfig,
      chain,
      config: generatedTsconfig({
        workspaceRoot,
        mirrorDir: wrapperDir,
        sourceConfig,
        mirrorRootIsFallback: false,
        chain,
      }),
    });
  }
  return plans;
}

// Write planned wrappers. `writeFile(path, content)` defaults to sync
// write; the editor passes ensureOwnedFile for idempotent mtimes.
export function writeProjectTsconfigs(sourceFiles, opts, writeFile = (p, c) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, c);
}) {
  const plans = planProjectTsconfigs(sourceFiles, opts);
  const written = [];
  for (const plan of plans) {
    const configPath = path.join(plan.wrapperDir, 'tsconfig.json');
    writeFile(configPath, JSON.stringify(plan.config, null, 2));
    written.push({ configPath, chain: plan.chain, wrapperDir: plan.wrapperDir });
  }
  return written;
}

// A workspace file's mirror path is RELATIVE to the mirror root: workspace
// files keep their relative structure (so relative imports between mirrors
// resolve exactly as between sources — and a `foo.rip.ts` name lets a bare
// `./foo.rip` import resolve by TS's extension-append); files outside the
// workspace mirror under __external__ so distinct buffers never collide.
// The caller forms the on-disk path: `join(mirrorRoot, rel) + '.ts'`.
export function mirrorRelForFsPath(fsPath, workspaceRoot) {
  if (workspaceRoot && fsPath.startsWith(workspaceRoot + path.sep)) {
    return path.relative(workspaceRoot, fsPath);
  }
  return path.join('__external__', fsPath.replace(/^[/\\]/, '').replace(/:/g, ''));
}

// The relative .rip import targets of a compiled file, as absolute paths
// — the closure edges. Read from the compiler's OWN stores (never
// scanned from generated text — the never-list): import/export nodes
// carry a `source` role whose exact source span is the specifier string;
// dynimport nodes carry an `args` span, followed only when it is a single
// static string literal (a computed specifier is a recorded closure miss).
export function ripImportsOf(stores, sourceText, fromDir) {
  const targets = [];
  const addSpec = (spec) => {
    if (!spec.endsWith('.rip')) return;
    if (!spec.startsWith('./') && !spec.startsWith('../')) return;
    targets.push(path.resolve(fromDir, spec));
  };
  for (const kind of ['import', 'export']) {
    for (const node of stores.nodesByKind(kind)) {
      const src = stores.role(node.nodeId, 'source');
      if (!src || typeof src.sourceStart !== 'number') continue;
      addSpec(sourceText.slice(src.sourceStart, src.sourceEnd).replace(/^['"`]|['"`]$/g, ''));
    }
  }
  for (const node of stores.nodesByKind('dynimport')) {
    const args = stores.role(node.nodeId, 'args');
    if (!args || typeof args.sourceStart !== 'number') continue;
    const raw = sourceText.slice(args.sourceStart, args.sourceEnd);
    const literal = /^\(\s*(['"`])([^'"`]+)\1\s*\)$/.exec(raw);
    if (literal) addSpec(literal[2]);
  }
  return targets;
}
