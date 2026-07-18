// The mirror layout and its generated tsconfig — shared by the editor
// server (which materializes the mirror demand-driven, per keystroke)
// and the batch `rip check` (which materializes a target's closure once,
// then runs `tsc --noEmit` over it). Both need the SAME tsconfig and the
// SAME mirror-file naming, or the batch checker would resolve imports /
// @types / strictness differently from the editor.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const stripJsonComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

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

// The zero-config host floor: the runtime-host globals (`process`,
// `Bun`) declared by EXISTENCE only, as `any` — the permissive default
// for a workspace that supplies no host types. A workspace with no
// node_modules has nothing for tsgo's typeRoots walk-up to find, so the
// names are unresolvable on every face; a floor (a one-line d.ts
// shipped with the toolchain) resolves its name without claiming any
// shape that could go stale or be wrong. GATED per name: a workspace
// that installs the name's real declaration package (anywhere up its
// ancestor chain — the same walk tsgo's default typeRoots performs)
// never sees that floor; a second declaration beside the real one
// would be a TS2403 conflict, and precision is the user's opt-in.
// The probes walk the DISK, not module resolution: Bun's
// `createRequire().resolve` falls back to the machine-global install
// cache (`~/.bun/install/cache`), which tsgo's typeRoots walk never
// consults — a resolve-based probe would false-positive on any machine
// that ever installed the package.
//
// A strict project refuses every floor: `rip.strict` means MISSING
// annotations get complained about (src/config.js), and a floor is
// exactly a missing-annotation forgiveness — host globals as `any`. A
// strict project gets the unresolved-name diagnostic (pointing at
// @types/bun) until it declares real host types. The probe mirrors
// readProjectConfig's boundary rule — walk UP to the FIRST package.json
// and stop; unreadable answers false, like readProjectConfig's own
// defaults — but stays local: mirror.js must remain layout-agnostic
// (repo checkout vs staged vsix), so it cannot import the compiler.
// The strictness read is the WORKSPACE root's: a floor joins the
// program whole-or-not (one tsconfig include), so a nested project's
// own package.json cannot govern it per-file the way the diagnostic
// gate does.
const workspaceIsStrict = (workspaceRoot) => {
  for (let dir = workspaceRoot; ; dir = path.dirname(dir)) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try { return JSON.parse(fs.readFileSync(pkgPath, 'utf8'))?.rip?.strict === true; }
      catch { return false; }
    }
    if (path.dirname(dir) === dir) return false;
  }
};
// One floor PER NAME, because the names' real-type suppliers differ:
// @types/node declares `process` but not `Bun`. A workspace with only
// @types/node keeps `process` at its installed truth and still floors
// `Bun` (rip runs on Bun — the name is real in every rip program); a
// workspace with @types/bun supplies both and floors nothing. The disk
// probe governs only the no-`types`-field world, where the mirror's
// `types:["*"]` makes @types presence and program inclusion the same
// fact — which is also why bare `bun-types` is NOT probed: on disk it
// is inert (outside the @types root) until a `types` entry names it,
// and a chain that sets `types` refuses floors wholesale before any
// probe runs (`userSetsTypes` below).
//
// The declarations are COMPILER-TOOLCHAIN DATA, not shipped .d.ts
// assets: the text lives here and is emitted into the mirror root as a
// generated file beside the generated tsconfig (the mirror's existing
// `**/*.ts` include picks it up). A shipped asset would be one more
// packaging surface (vsix staging, a future CLI `files` list) whose
// omission fails SILENTLY — an existence-gated floor that simply never
// materializes; text in this module ships wherever the toolchain does.
const HOST_FLOORS = [
  { text: 'declare var process: any;', suppliedBy: ['@types/node', '@types/bun'] },
  { text: 'declare var Bun: any;', suppliedBy: ['@types/bun'] },
];
export const HOST_FLOOR_NAME = 'host-floor.d.ts';
const ancestorHas = (fromDir, pkgs) => {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    if (pkgs.some((p) => fs.existsSync(path.join(dir, 'node_modules', p)))) return true;
    if (path.dirname(dir) === dir) return false;
  }
};
// `userSetsTypes`: the resolved tsconfig chain sets
// compilerOptions.types — the user's COMPLETE ambient manifest, the
// same signal that already stops the `types:["*"]` injection. Floors
// defer to it wholesale: an enumerated list means "these ambients and
// no others", whether or not the named packages are even installed —
// a floor beside an explicit manifest would clobber the narrowing
// exactly like `["*"]` would. The generated file is written even when
// every floor is refused (with the reason in its body) — an
// always-present file with varying content, so the flip is a plain
// Changed event and no caller carries a create/delete lifecycle.
export function hostFloorDts(workspaceRoot, { userSetsTypes = false } = {}) {
  const head = '// Generated by rip — the zero-config host floor. Do not edit.\n';
  if (userSetsTypes) {
    return head + '// Inactive: the tsconfig chain sets `types` — the complete ambient manifest.\n';
  }
  if (workspaceRoot && workspaceIsStrict(workspaceRoot)) {
    return head + '// Inactive: rip.strict — missing host types are complaints, not `any`s.\n';
  }
  const active = HOST_FLOORS.filter(({ suppliedBy }) => !(workspaceRoot && ancestorHas(workspaceRoot, suppliedBy)));
  if (active.length === 0) {
    return head + '// Inactive: the workspace installs its own host types.\n';
  }
  return head + active.map(({ text }) => text + '\n').join('');
}

// The generated mirror-root files, built together because they share
// one probe of the user's config chain: the tsconfig, and the host
// floor's content (written as HOST_FLOOR_NAME beside it — the
// tsconfig's own `**/*.ts` include picks it up). Tsconfig overrides
// applied over the user's config (or the defaults): noImplicitAny
// stays ON (it activates the evolving-`let` inference; the
// implicit-any family is suppressed per-code in translate.js), noEmit
// (the project never emits; also what legalizes
// allowImportingTsExtensions), and rootDirs merging the mirror tree
// with the real workspace (a .rip file importing a real .ts sibling
// resolves). The mirror root MUST sit two levels below the workspace so
// the `../../` reach-ups (extends, ambient d.ts, node_modules) resolve.
export function generatedMirror({ workspaceRoot, mirrorRootIsFallback, chain = new Set(), onUnresolved } = {}) {
  const overrides = {
    noImplicitAny: true,
    noEmit: true,
    allowImportingTsExtensions: true,
  };
  if (!mirrorRootIsFallback) overrides.rootDirs = ['.', '../..'];
  // Workspace AMBIENT declarations (`rip-env.d.ts` and kin) join the
  // program. An explicit `exclude` REPLACES the built-in defaults, so
  // `node_modules` is restated alongside the `../../` reach-up.
  const include = ['**/*.ts'];
  const exclude = ['node_modules'];
  if (!mirrorRootIsFallback) {
    include.push('../../**/*.d.ts');
    exclude.push('../../**/node_modules');
  }
  const floorRoot = mirrorRootIsFallback ? null : workspaceRoot;
  const userConfig = !mirrorRootIsFallback && workspaceRoot
    ? path.join(workspaceRoot, 'tsconfig.json') : null;
  if (userConfig && fs.existsSync(userConfig)) {
    chain.clear();
    const setsTypes = chainSetsTypes(userConfig, chain, onUnresolved);
    if (!setsTypes) overrides.types = ['*'];
    return {
      tsconfig: { extends: '../../tsconfig.json', compilerOptions: overrides, include, exclude },
      hostFloorDts: hostFloorDts(floorRoot, { userSetsTypes: setsTypes }),
    };
  }
  chain.clear();
  return {
    tsconfig: {
      compilerOptions: {
        target: 'esnext', module: 'esnext', lib: ['esnext', 'dom'],
        types: ['*'],
        ...overrides,
      },
      include,
      exclude,
    },
    hostFloorDts: hostFloorDts(floorRoot),
  };
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
