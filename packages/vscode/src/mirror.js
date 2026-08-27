// The mirror layout and its generated tsconfig — shared by the editor
// server and the batch `rip check`, which must resolve imports, @types,
// and strictness identically.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Dual-path like the server's compiler load: `../../../src/` in-repo,
// `../compiler/src/` in the staged .vsix. A static relative import knows
// only the repo layout — installed, it reaches outside the extension and
// the server dies at import time.
const { identifierRunAt } = await (async () => {
  const candidates = [
    new URL('../../../src/ident.js', import.meta.url),   // in-repo
    new URL('../compiler/src/ident.js', import.meta.url), // staged vsix
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(fileURLToPath(candidate))) return import(candidate.href);
  }
  throw new Error('rip identifier vocabulary not found (looked for ../../../src/ident.js and ../compiler/src/ident.js)');
})();

const stripJsonComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

// Resolve one `extends` specifier the way TS does: exact / +.json /
// +/tsconfig.json for paths, node-style for bare packages. Null when
// unresolvable.
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

// Does the config — anywhere in its resolved `extends` chain — set
// compilerOptions.types? Unresolvable or unreadable links answer TRUE:
// never clobber a narrowing we cannot see. Visited files land in `chain`
// for the watcher's re-govern; `onUnresolved(spec)` is a log hook.
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

// The zero-config host floor: host globals (`process`, `Bun`) declared
// by EXISTENCE as `any` — otherwise unresolvable on every face in a
// workspace with no installed host types. Gated per name by a DISK probe
// of ancestor node_modules, never module resolution (Bun's resolve falls
// back to the machine-global install cache, which tsgo's typeRoots walk
// never consults — a resolve probe false-positives). A floored name that
// gets its real package installed would be a TS2403 double declaration,
// so the floor exists only where the package is absent. A strict project
// refuses every floor — a floor is exactly a missing-annotation
// forgiveness — and keeps the unresolved-name diagnostic until real host
// types are declared. The strictness read is the WORKSPACE ROOT's (a
// floor joins the program whole-or-not), walked to the first
// package.json locally: mirror.js stays layout-agnostic and cannot
// import the compiler's readProjectConfig.
// Base posture by mode: TypeScript 7 defaults `strict` ON, and gradual
// RIDES that default, subtracting only what it deliberately loosens. The
// direction is the constraint: a strict-family member this list does not
// name arrives ON, so any noise it brings LEAKS where the canaries look
// (the gradual pair's held fixture, the corpus count) — never OFF, where
// it would degrade inference silently (`strictBindCallApply` off, for
// one, collapses every type the face routes through a `.call` to
// `any`). The three loosenings:
//   `strictNullChecks` — the one lever that changes TYPES, not just
//     which diagnostics publish (`find()` hovers `T` here,
//     `T | undefined` under `rip.strict`);
//   `useUnknownInCatchVariables` — an unannotated `catch err` answers
//     `any`, never narrowing ceremony;
//   `noImplicitThis` — `this` in an unannotated object-literal method
//     is `any`, not the literal's inferred type.
// `noImplicitAny` stays ON everywhere (set in the generated config):
// turning it off disables evolving-array inference and strands
// unannotated `[]` on `never[]`.
// The strict posture at `dir`: forced by the caller outright (what
// `rip.strict` would give, without any package.json saying so), or set by
// the nearest package.json's `rip.strict`. The one read every per-program
// decision — null posture, host floors — goes through.
const strictAt = (dir, forced = false) => forced || Boolean(dir && workspaceIsStrict(dir));
const nullPosture = (configPath, strict) => {
  if (strict) return {};
  // The user's OWN tsconfig wins: rip's default posture never overrules
  // a strictness the author wrote down.
  if (configPath && chainSetsStrictness(configPath)) return {};
  return { strictNullChecks: false, useUnknownInCatchVariables: false, noImplicitThis: false };
};

// Does the config chain SET strictness (`strict` or `strictNullChecks`)
// anywhere? Mirrors chainSetsTypes' conservatism: an unreadable or
// unfollowable link answers TRUE, so an unknown config is never overridden.
export function chainSetsStrictness(configPath, visited = new Set(), depth = 0) {
  if (depth > 16 || visited.has(configPath)) return false;
  visited.add(configPath);
  let text;
  try { text = fs.readFileSync(configPath, 'utf8'); } catch { return true; }
  const stripped = stripJsonComments(text);
  let parsed;
  try { parsed = JSON.parse(stripped); } catch {
    if (/"(strict|strictNullChecks)"\s*:/.test(stripped)) return true;
    return /"extends"\s*:/.test(stripped);
  }
  const co = parsed?.compilerOptions;
  if (co && (co.strict !== undefined || co.strictNullChecks !== undefined)) return true;
  if (parsed?.extends === undefined) return false;
  const bases = Array.isArray(parsed.extends) ? parsed.extends : [parsed.extends];
  return bases.some((spec) => {
    if (typeof spec !== 'string') return true;
    const next = resolveExtends(spec, path.dirname(configPath));
    if (!next) return true;
    return chainSetsStrictness(next, visited, depth + 1);
  });
}

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
// One floor PER NAME — the suppliers differ (@types/node declares
// `process` but not `Bun`), so a partial install keeps each name at its
// installed truth. Bare `bun-types` is not probed: outside the @types
// root it is inert until a `types` field names it, and a chain that sets
// `types` refuses floors wholesale before any probe runs. The texts live
// HERE, not as shipped .d.ts assets: a packaging list can omit an asset
// silently; text in this module ships wherever the toolchain does.
const HOST_FLOORS = [
  { text: 'declare var process: any;', suppliedBy: ['@types/node', '@types/bun'] },
  { text: 'declare var Bun: any;', suppliedBy: ['@types/bun'] },
  // `import.meta.dir` and kin are an interface to MERGE, not a global to
  // shadow — a var would not reach `import.meta.x` at all. An INDEX
  // SIGNATURE, not an enumeration: naming fields asserts an API rip does
  // not own, and the enumeration was wrong on arrival (`main` missing,
  // ten call sites red). Merging is additive: `url` keeps its real type.
  {
    text: 'interface ImportMeta { [key: string]: any }',
    suppliedBy: ['@types/bun'],
  },
  // Bun's builtin modules (`bun:sqlite`, `bun:ffi`, …): a bodyless
  // wildcard SHORTHAND types every matching import `any`, and an exact
  // declaration from installed @types/bun outranks a wildcard by TS's
  // own pattern rules.
  {
    text: 'declare module "bun:*";',
    suppliedBy: ['@types/bun'],
  },
];
export const HOST_FLOOR_NAME = 'host-floor.d.ts';

// The app's stash module for a source file — the discovery half of the
// typed `@app.data` splice (the compiler takes the answer as
// `appStashSpec` and stays pure). The anchor is the project root: the
// nearest directory holding both an `index.rip` and a `package.json`,
// walking up from the file and stopping at the workspace root
// (inclusive — a standalone app IS its workspace). The stash is the
// framework contract `<root>/app/stash.rip`; the answer is the relative
// specifier faces import by. Null for the stash module itself — its own
// face carries `__RipStash`, not a self-import.
// `memo`, when given, caches the DISCOVERY (the resolved stash path per
// directory — the walk's fs facts, identical for every file sharing a
// dirname); the per-file self-import guard stays outside it, so the
// stash module itself never poisons its siblings' entry. A memo is for
// one consistent view of the disk (the CLI's single run) — a long-lived
// caller passes none, because discovery is a live filesystem fact.
export function appStashSpecFor(fsPath, workspaceRoot, memo = null) {
  const fromDir = path.dirname(fsPath);
  let stashPath;
  if (memo?.has(fromDir)) {
    stashPath = memo.get(fromDir);
  } else {
    stashPath = null;
    for (let dir = fromDir; ; dir = path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, 'index.rip')) && fs.existsSync(path.join(dir, 'package.json'))) {
        const stash = path.join(dir, 'app', 'stash.rip');
        if (fs.existsSync(stash)) stashPath = path.resolve(stash);
        break;
      }
      if (!workspaceRoot || dir === workspaceRoot || path.dirname(dir) === dir) break;
    }
    memo?.set(fromDir, stashPath);
  }
  if (stashPath === null || stashPath === path.resolve(fsPath)) return null;
  const rel = path.relative(fromDir, stashPath).split(path.sep).join('/');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

// The stash as a CLOSURE DEPENDENCY: a face compiled with an
// `appStashSpec` references the stash module at the type level
// (`import('<spec>').__RipStash`) without any source import, so a
// walker following source imports alone would leave the stash face
// unmaterialized and the splice resolving to a stub. Every closure walk
// appends this to a file's imports.
export function appStashImportOf(fsPath, workspaceRoot, memo = null) {
  const spec = appStashSpecFor(fsPath, workspaceRoot, memo);
  if (spec === null) return [];
  // Both halves of the splice: the stash module itself, and the
  // `rip/app` entry the projection type imports from — a closure that
  // never source-imports either would otherwise leave a face
  // unmaterialized and the splice resolving against a stub or nothing.
  const deps = [path.resolve(path.dirname(fsPath), spec)];
  if (stdlibAppEntry !== null) deps.push(stdlibAppEntry);
  return deps;
}

// The closure's import list for one compiled file: the source imports
// plus the stash splice's type-level dependencies. Walkers use THIS,
// never bare ripImportsOf — a walk that forgets the append leaves the
// stash face unmaterialized and the splice resolving against a stub.
export function closureImportsOf(stores, sourceText, fsPath, workspaceRoot, memo = null) {
  const imports = ripImportsOf(stores, sourceText, path.dirname(fsPath));
  for (const dep of appStashImportOf(fsPath, workspaceRoot, memo)) {
    if (!imports.includes(dep)) imports.push(dep);
  }
  return imports;
}

// A package that INSTALLS its own ambient types. Ambient declarations —
// `@types/*` packages and `bun-types` — bind per PROGRAM through the
// governing tsconfig's typeRoots, which walk UP from the program root and
// never down into a member, so a nested install is unread until the
// member has a program of its own; a package whose own tsconfig already
// partitions it needs nothing (its wrapper's typeRoots walk starts at
// the package). The test is a NON-EMPTY install, not a directory's
// existence — package managers leave empty `@types` scope dirs behind,
// and an empty dir must not partition a program. A resolver-parked
// conflict copy counts: whatever sits in a package's own node_modules is
// what binds for that package's files, however it got there. Granting is
// live (the next refresh reads the disk); RETRACTION is reload-only,
// like every node_modules mutation without a manifest edit.
const nonEmptyDir = (p) => {
  try { return fs.readdirSync(p).some((e) => !e.startsWith('.')); } catch { return false; }
};
export function installsOwnTypes(pkgDir) {
  return nonEmptyDir(path.join(pkgDir, 'node_modules', '@types'))
    || fs.existsSync(path.join(pkgDir, 'node_modules', 'bun-types', 'package.json'));
}

// The CONFIG-driven reasons a package earns its own program, shared by
// the editor and `rip check` so the two cannot drift: its mode flips
// against its parent package's (floors and null posture are per-program,
// and a flip cuts both ways), or it installs its own ambient types. The
// third reason — the package DECLARES globals — reads the compile result
// and stays with the callers.
export function configEarnsBoundary(cfg, parentCfg, workspaceRoot) {
  const dir = cfg?._configDir;
  if (!dir || dir === workspaceRoot) return false;
  return (cfg.strict === true) !== (parentCfg?.strict === true) || installsOwnTypes(dir);
}
const ancestorHas = (fromDir, pkgs) => {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    if (pkgs.some((p) => fs.existsSync(path.join(dir, 'node_modules', p)))) return true;
    if (path.dirname(dir) === dir) return false;
  }
};
// `userSetsTypes`: the chain sets compilerOptions.types — the user's
// COMPLETE ambient manifest, the same signal that stops the types:["*"]
// injection — and floors defer to it wholesale. The file is written even
// when every floor is refused (reason in the body): an always-present
// file makes the flip a plain Changed event, no create/delete lifecycle.
// `typesRoot`: where installed host types are looked for (null when the
// mirror is a temp fallback that cannot reach the workspace's
// node_modules). `strict`: the posture, decided by the caller (strictAt) —
// it is not re-read from `typesRoot`, which a fallback leaves null.
export function hostFloorDts(typesRoot, { userSetsTypes = false, strict = false } = {}) {
  const head = '// Generated by rip — the zero-config host floor. Do not edit.\n';
  if (userSetsTypes) {
    return head + '// Inactive: the tsconfig chain sets `types` — the complete ambient manifest.\n';
  }
  if (strict) {
    return head + '// Inactive: strict posture (rip.strict, or rip check --strict) — missing host types are complaints, not `any`s.\n';
  }
  const active = HOST_FLOORS.filter(({ suppliedBy }) => !(typesRoot && ancestorHas(typesRoot, suppliedBy)));
  if (active.length === 0) {
    return head + '// Inactive: the workspace installs its own host types.\n';
  }
  return head + active.map(({ text }) => text + '\n').join('');
}

// The generated mirror-root files, built together because they share one
// probe of the user's config chain. Overrides: noImplicitAny stays ON (it
// powers evolving-`let` inference; the implicit-any family is suppressed
// per-code in translate.js), noEmit also legalizes
// allowImportingTsExtensions, and rootDirs merges the mirror with the
// real workspace so a `.rip` file importing a real `.ts` sibling
// resolves. The mirror root MUST sit two levels below the workspace for
// the `../../` reach-ups to resolve; written tsconfig paths are POSIX
// (`..\\pkg` is not a legal `extends` spec).
const posix = (p) => p.split(path.sep).join('/');

// The nearest tsconfig.json at or above `dir`, BOUNDED by `anchor`: a
// dir outside the anchor answers null immediately — without that, an
// out-of-workspace document adopted whatever config it met on the climb
// and the '..'-shaped rel carried the wrapper write out of the mirror.
// Null is the ordinary answer (the workspace root's config governs).
export function nearestTsconfig(dir, anchor) {
  if (dir !== anchor && !dir.startsWith(anchor + path.sep)) return null;
  for (let d = dir; ; d = path.dirname(d)) {
    const candidate = path.join(d, 'tsconfig.json');
    if (fs.existsSync(candidate)) return candidate;
    if (d === anchor || path.dirname(d) === d) return null;
  }
}

// The generated WRAPPER for one nested project: tsgo's LSP assigns each
// file its nearest config, so a wrapper per mirrored project dir
// partitions the faces inside ONE tree and ONE session. It states its
// own include/exclude — only the source config's compilerOptions are
// inherited — and emits the floor per project, from that project's own
// strictness and installs. `sourceTsconfig: null` (with `sourceDir`) is
// the AUTO-BOUNDARY form for a globals-declaring package that owns no
// tsconfig: the wrapper anchors on the workspace root's config, or the
// mirror-root defaults when there is none.
export function projectWrapper({ wrapperDir, sourceTsconfig, sourceDir: sourceDirIn = null, workspaceRoot = null, mirrorRoot = null, chain = new Set(), onUnresolved, strict = false }) {
  const sourceDir = sourceDirIn ?? path.dirname(sourceTsconfig);
  const rootConfig = workspaceRoot ? path.join(workspaceRoot, 'tsconfig.json') : null;
  const anchor = sourceTsconfig ?? (rootConfig && fs.existsSync(rootConfig) ? rootConfig : null);
  const strictHere = strictAt(sourceDir, strict);
  const overrides = {
    noImplicitAny: true,
    noEmit: true,
    allowImportingTsExtensions: true,
    ...nullPosture(anchor, strictHere),
    rootDirs: ['.', posix(path.relative(wrapperDir, sourceDir))],
  };
  // The mirror root's bare-specifier map, rebased through this wrapper's
  // reach-up: paths are read from the config that declares them.
  if (workspaceRoot && mirrorRoot) {
    const reachUpToMirror = path.relative(wrapperDir, mirrorRoot);
    const ripPaths = {
      ...stdlibRipPaths(workspaceRoot, reachUpToMirror),
      ...workspaceRipPaths(workspaceRoot, reachUpToMirror),
    };
    if (Object.keys(ripPaths).length) overrides.paths = ripPaths;
  }
  chain.clear();
  const setsTypes = anchor !== null && chainSetsTypes(anchor, chain, onUnresolved);
  if (!setsTypes) overrides.types = ['*'];
  const reachUp = posix(path.relative(wrapperDir, sourceDir));
  const tsconfig = {
    compilerOptions: overrides,
    include: ['**/*.ts', `${reachUp}/**/*.d.ts`],
    exclude: ['**/node_modules', `${reachUp}/**/node_modules`],
  };
  if (anchor !== null) tsconfig.extends = posix(path.relative(wrapperDir, anchor));
  else Object.assign(overrides, { target: 'esnext', module: 'esnext', lib: ['esnext', 'dom'] });
  return {
    tsconfig,
    hostFloorDts: hostFloorDts(sourceDir, { userSetsTypes: setsTypes, strict: strictHere }),
  };
}

export function generatedMirror({ workspaceRoot, mirrorRootIsFallback, chain = new Set(), onUnresolved, excludeDirs = [], strict = false } = {}) {
  const rootConfig = !mirrorRootIsFallback && workspaceRoot
    ? path.join(workspaceRoot, 'tsconfig.json') : null;
  // The posture is the WORKSPACE's, fallback mirror or not — only the
  // lookup of installed host types (`floorRoot`) is withheld from a
  // fallback, which cannot reach the workspace's node_modules.
  const strictHere = strictAt(workspaceRoot, strict);
  const overrides = {
    noImplicitAny: true,
    noEmit: true,
    allowImportingTsExtensions: true,
    ...nullPosture(rootConfig && fs.existsSync(rootConfig) ? rootConfig : null, strictHere),
  };
  if (!mirrorRootIsFallback) overrides.rootDirs = ['.', '../..'];
  // Workspace ambient d.ts join the program; an explicit `exclude`
  // REPLACES the defaults, so node_modules is restated.
  const include = ['**/*.ts'];
  // A wrapped subtree belongs to ITS config; without the exclusion two
  // configs claim the same faces in tsgo's discovery order.
  const exclude = ['**/node_modules', ...excludeDirs.map((d) => `${posix(d)}/**`)];
  if (!mirrorRootIsFallback) {
    include.push('../../**/*.d.ts');
    exclude.push('../../**/node_modules');
  }
  // Bare workspace `.rip` specifiers resolve by MAP: their manifests land
  // on `.rip` files TypeScript will not follow, so `paths` points each
  // bare name at the mirror face the closure compiled. `paths` outranks
  // the node_modules walk.
  const ripPaths = mirrorRootIsFallback ? {} : {
    ...stdlibRipPaths(workspaceRoot),
    ...workspaceRipPaths(workspaceRoot),
  };
  if (Object.keys(ripPaths).length) overrides.paths = ripPaths;
  const floorRoot = mirrorRootIsFallback ? null : workspaceRoot;
  const userConfig = !mirrorRootIsFallback && workspaceRoot
    ? path.join(workspaceRoot, 'tsconfig.json') : null;
  if (userConfig && fs.existsSync(userConfig)) {
    chain.clear();
    const setsTypes = chainSetsTypes(userConfig, chain, onUnresolved);
    if (!setsTypes) overrides.types = ['*'];
    return {
      tsconfig: { extends: '../../tsconfig.json', compilerOptions: overrides, include, exclude },
      hostFloorDts: hostFloorDts(floorRoot, { userSetsTypes: setsTypes, strict: strictHere }),
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
    hostFloorDts: hostFloorDts(floorRoot, { strict: strictHere }),
  };
}

// A bare specifier DECLARED in a governing package.json but not
// installed anywhere on the ancestor chain — the manifest's stated
// intent, not a typo. Returns the declaring dir (for the install
// remedy), or null. Gradual holds these 2307s; strict publishes them.
export function declaredButUninstalled(spec, fromDir) {
  if (!spec || !fromDir || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('#')) return null;
  if (spec.startsWith('node:') || spec.startsWith('bun:')) return null;
  const parts = spec.split('/');
  const pkgName = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  if (!pkgName || (spec.startsWith('@') && parts.length < 2)) return null;
  let declaringDir = null;
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'node_modules', pkgName))) return null;   // installed: resolution's problem, not ours
    if (declaringDir === null && fs.existsSync(path.join(dir, 'package.json'))) {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
          if (m?.[field]?.[pkgName] !== undefined) { declaringDir = dir; break; }
        }
      } catch { /* unreadable manifest declares nothing */ }
    }
    if (path.dirname(dir) === dir) return declaringDir;
  }
}

// A face's module walk lives in the MIRROR tree, so a nested source
// install (a quarantined bench dir's own node_modules) was invisible to
// it — bun resolves those at runtime. Every source dir on the file's
// ancestor chain that carries node_modules gets a symlink twin in the
// mirror; the workspace root needs none (the walk exits the mirror into
// it). Best-effort: a failed link leaves the 2307 standing.
export function linkNestedNodeModules(workspaceRoot, mirrorRoot, fsPath) {
  if (!workspaceRoot || !mirrorRoot || !fsPath.startsWith(workspaceRoot + path.sep)) return;
  for (let dir = path.dirname(fsPath); dir !== workspaceRoot && dir.startsWith(workspaceRoot + path.sep); dir = path.dirname(dir)) {
    const srcNm = path.join(dir, 'node_modules');
    if (!fs.existsSync(srcNm)) continue;
    const at = path.join(mirrorRoot, path.relative(workspaceRoot, dir), 'node_modules');
    try {
      fs.mkdirSync(path.dirname(at), { recursive: true });
      if (!fs.lstatSync(at, { throwIfNoEntry: false })) fs.symlinkSync(srcNm, at);
    } catch { /* best-effort */ }
  }
}

// Workspace files keep their relative structure (imports between mirrors
// resolve as between sources; `foo.rip.ts` lets `./foo.rip` resolve by
// TS's extension-append); files outside the workspace mirror under
// __external__ so distinct buffers never collide. The caller forms the
// on-disk path: `join(mirrorRoot, rel) + '.ts'`.
export function mirrorRelForFsPath(fsPath, workspaceRoot) {
  if (workspaceRoot && fsPath.startsWith(workspaceRoot + path.sep)) {
    return path.relative(workspaceRoot, fsPath);
  }
  return path.join('__external__', fsPath.replace(/^[/\\]/, '').replace(/:/g, ''));
}

// ---- the auto-import stub face: what an unopened, unimported workspace
// `.rip` contributes, so its exports are auto-import candidates from
// cold. A SOURCE scan, not a compile — compiling every face is ~92% of
// population time (1456 ms over 277 files, measured) and buys nothing
// candidacy needs. Text-scanning is otherwise the never-list's
// territory; the exemption holds only here: no compile exists to read
// stores from, the output dies when a real face materializes over it,
// and a missed name costs a completion candidate, never a wrong answer.
// It must NOT be reused anywhere a mapping, diagnostic, or closure edge
// depends on it.

const IDENT = String.raw`[A-Za-z_$][A-Za-z0-9_$]*`;
// Words that open a declaration form — never the exported NAME in
// rip's bare `export name = …` production.
const EXPORT_KEYWORDS = new Set([
  'default', 'from', 'as', 'declare', 'async', 'abstract', 'type', 'interface',
  'class', 'enum', 'function', 'def', 'const', 'let', 'var', 'namespace', 'module',
]);
const DECLARATION = new RegExp(
  String.raw`^(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:const\s+)?` +
  String.raw`(type|interface|class|enum|function|def|const|let|var|namespace|module)\s+(${IDENT})\b`,
);
const STAR = new RegExp(String.raw`^\*\s*(?:as\s+(${IDENT})\s+)?from\s*['"]([^'"]+)['"]`);
const CLAUSE = new RegExp(String.raw`^(?:(type)\s+)?(${IDENT}|default)(?:\s+as\s+(${IDENT}|default))?$`);
// A pattern binding: an identifier before a separator, closer, end, or
// `=` (a default's name is still bound). A renamed key's `a:` matches
// none of these — `renamed` is the binding.
const PATTERN_NAME = new RegExp(String.raw`(${IDENT})\s*(?:[,}\]=]|$)`, 'g');
const FROM_SPEC = /^from\s*['"]([^'"]+)['"]/;

// The exported names of one `.rip` SOURCE, split by declaration space.
// `stars` carries `export * from …` specifiers (the caller resolves them
// against its other scans); `hasDefault` is separate because a default
// has no name — a stub omitting it answered TS1192/TS2305 on every
// `import theme from …` consumer.
export function scanExportNames(source) {
  const values = new Set();
  const types = new Set();
  const stars = [];
  const globals = new Set();   // top-level `globalThis.NAME ??=` — declared vocabulary
  let hasDefault = false;
  const lines = source.split('\n');
  let inBlockString = false;
  for (let i = 0; i < lines.length; i++) {
    // A block string's content can start a line with `export` (rip's own
    // suites embed whole modules) — never read those as exports.
    const fences = (lines[i].match(/"""|'''/g) ?? []).length;
    const wasInBlockString = inBlockString;
    if (fences % 2) inBlockString = !inBlockString;
    if (wasInBlockString) continue;
    // A top-level `globalThis.NAME ??=` declares the global (the face
    // emits the typed declaration); the stub carries an `any` twin so the
    // name resolves before anything compiles.
    const g = /^globalThis\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\?\?=/.exec(lines[i]);
    if (g) { globals.add(g[1]); continue; }
    if (!/^export\b/.test(lines[i])) continue;   // exports are top-level: column 0
    let rest = lines[i].slice('export'.length).trim();

    const star = STAR.exec(rest);
    if (star) {
      if (star[1]) values.add(star[1]);          // export * as NS from '…'
      else stars.push(star[2]);
      continue;
    }

    // `export type { … }` — the whole list is type-only.
    let typeOnly = false;
    if (/^type\s*\{/.test(rest)) { typeOnly = true; rest = rest.slice('type'.length).trim(); }

    if (rest.startsWith('{')) {
      // A brace list may span lines; joined with a COMMA because rip lets
      // entries separate by newline alone — a space-join fuses them into
      // one unparseable clause.
      while (!rest.includes('}') && i + 1 < lines.length) rest += ',' + lines[++i].trim();
      const close = rest.indexOf('}');
      if (close < 0) continue;                   // unterminated: nothing trustworthy to emit
      // Anything after the brace other than a `from` spec is a shape this
      // scan does not understand — gate the names BEFORE reading clauses,
      // or it offers candidates the real face never exports.
      const tail = rest.slice(close + 1).trim();
      if (tail && !FROM_SPEC.test(tail)) continue;
      for (const raw of rest.slice(1, close).split(',')) {
        const clause = CLAUSE.exec(raw.trim());
        if (!clause) continue;
        const name = clause[3] ?? clause[2];
        if (name === 'default') { hasDefault = true; continue; }
        (typeOnly || clause[1] ? types : values).add(name);
      }
      continue;
    }

    if (/^default\b/.test(rest)) { hasDefault = true; continue; }

    const decl = DECLARATION.exec(rest);
    if (decl) {
      const [, keyword, name] = decl;
      if (keyword === 'type' || keyword === 'interface') types.add(name);
      else if (keyword === 'class' || keyword === 'enum') { values.add(name); types.add(name); }
      else values.add(name);
      continue;
    }

    // `export const { a, b } = …` / `export const [a, b] = …`
    const pattern = /^(?:declare\s+)?(?:const|let|var)\s*([[{])/.exec(rest);
    if (pattern) {
      const body = rest.slice(rest.indexOf(pattern[1]));
      // Cut at the DEPTH-ZERO `=`: a binding's default spells `=` too
      // (`{ a = 1, b }`), and cutting at the first drops the pattern's
      // own tail.
      let depth = 0, end = -1;
      for (let j = 0; j < body.length && end < 0; j++) {
        const ch = body[j];
        if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') depth--;
        else if (ch === '=' && depth === 0 && body[j + 1] !== '=' && body[j + 1] !== '>') end = j;
      }
      for (const m of (end < 0 ? body : body.slice(0, end)).matchAll(PATTERN_NAME)) values.add(m[1]);
      continue;
    }

    // rip's own production: `export name = …`, with any of the binding
    // markers the language spells after the name (`!`, `:=`, `=!`, an
    // annotation, a type-parameter list).
    const bare = new RegExp(String.raw`^(${IDENT})`).exec(rest);
    if (!bare || EXPORT_KEYWORDS.has(bare[1])) continue;
    const name = bare[1];
    values.add(name);
    // A schema binding is a TYPE too, and `:model` ships two derived
    // companions — the one lowering rule the scan encodes; staleness is
    // bounded to candidacy and fails loudly at the import.
    const schema = /^(?:[^=]*)=\s*schema\s+:(\w+)/.exec(rest);
    if (!schema) continue;
    types.add(name);
    if (schema[1] === 'model') { types.add(name + 'Data'); types.add(name + 'Create'); }
  }
  return { values: [...values], types: [...types], stars, hasDefault, globals: [...globals] };
}

// The stub text for one file's exported names — every name `any`: the
// stub makes NAMES reachable, and a guessed shape could be wrong. A type
// alias and a variable occupy different declaration spaces, so a class
// or enum is legally both. `defaultName`: see defaultLocalName.
export function stubFace({ values = [], types = [], hasDefault = false, defaultName = '_default', globals = [] } = {}) {
  const lines = [];
  for (const name of types) lines.push(`export type ${name} = any;`);
  for (const name of values) lines.push(`export declare const ${name}: any;`);
  if (hasDefault) lines.push(`declare const ${defaultName}: any;`, `export default ${defaultName};`);
  // Declared vocabulary, `any` until the real face materializes.
  if (globals.length) {
    lines.push('declare global {');
    for (const name of globals) lines.push(`  var ${name}: any;`);
    lines.push('}');
  }
  lines.push('export {};');   // a module even when it exports nothing
  return lines.join('\n') + '\n';
}

// The local a default export binds — the name the editor OFFERS it
// under, derived from the SOURCE filename (the mirror's `theme.rip.ts`
// would derive as `themeRip`). Four fallbacks to `_default`, each
// driven: not an identifier; a leading double underscore (TS escapes
// `__x` to `___x`, leaving no candidate); already exported here; a
// reserved word. Below: the names a `const` cannot bind, verified by
// compiling each — contextual keywords (`type`, `as`, `of`, …) bind
// fine and are deliberately absent; `await` is reserved because a
// module body is always async context.
const NOT_BINDABLE = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false',
  'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let',
  'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try',
  'typeof', 'var', 'void', 'while', 'with', 'yield',
]);

function defaultLocalName(file, taken) {
  const base = path.basename(file).replace(/\.rip$/, '');
  const ident = base.replace(/[^A-Za-z0-9_$]/g, '_');
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(ident)) return '_default';
  if (ident.startsWith('__') || taken.has(ident)) return '_default';
  if (NOT_BINDABLE.has(ident)) return '_default';
  return ident;
}

export function stubFacesFromScans(scans) {
  // Star edges, resolved once; a target outside `scans` contributes
  // nothing.
  const starsOf = new Map();
  for (const [file, scan] of scans) {
    starsOf.set(file, scan.stars
      .filter((spec) => spec.endsWith('.rip'))   // a non-rip target has no scan here
      .map((spec) => path.resolve(path.dirname(file), spec))
      .filter((target) => scans.has(target)));
  }
  const values = new Map();
  const types = new Map();
  for (const [file, scan] of scans) {
    values.set(file, new Set(scan.values));
    types.set(file, new Set(scan.types));
  }
  // Grown to a FIXPOINT, not recursed: `export *` cycles are legal
  // (mutual barrels), and a recursive walk breaks the cycle somewhere,
  // memoizing that file's short answer as complete — order-dependent
  // results. Iteration terminates: the sets only grow, the space is
  // finite.
  for (let changed = true; changed; ) {
    changed = false;
    for (const [file, targets] of starsOf) {
      for (const target of targets) {
        for (const name of values.get(target)) if (!values.get(file).has(name)) { values.get(file).add(name); changed = true; }
        for (const name of types.get(target)) if (!types.get(file).has(name)) { types.get(file).add(name); changed = true; }
      }
    }
  }
  const faces = new Map();
  for (const [file, scan] of scans) {
    // `export * from` never carries a default; hasDefault stays local.
    const v = [...values.get(file)];
    const t = [...types.get(file)];
    faces.set(file, stubFace({
      values: v, types: t, hasDefault: scan.hasDefault,
      globals: scan.globals ?? [],
      defaultName: defaultLocalName(file, new Set([...v, ...t])),
    }));
  }
  return faces;
}

// Read, scan and build in one call. `read` returns a file's source or null.
export function buildStubFaces(files, read) {
  const scans = new Map();
  for (const file of files) {
    const source = read(file);
    if (source === null || source === undefined) continue;
    scans.set(file, scanExportNames(source));
  }
  return stubFacesFromScans(scans);
}

// Roles whose recorded span is TYPE TEXT — where an import type's
// specifier lives (it belongs to no import node).
const TYPE_TEXT_ROLES = new Set(['annotation', 'returnType', 'typeParams', 'declaration']);

const skipTypeTrivia = (text, from) => {
  let i = from;
  for (;;) {
    while (i < text.length && /\s/u.test(text[i])) i++;
    if (text[i] === '#') {
      const end = text.indexOf('\n', i + 1);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i + 2);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    return i;
  }
};

const quotedTypeText = (text, start) => {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === '\\') { i += 2; continue; }
    if (text[i] === quote) return { value: text.slice(start + 1, i), end: i + 1 };
    i++;
  }
  return null;
};

// Static module specifiers in authored type text. Literals and comments
// are data; a property named `import` is not an import type; identifier
// recognition uses the lexer vocabulary so a Unicode name ending in
// `import` cannot split into a false keyword.
export function typeImportSpecifiers(text) {
  const specs = [];
  let i = 0;
  let lastCode = '';
  while (i < text.length) {
    if (text[i] === '#' || text.startsWith('//', i) || text.startsWith('/*', i)) {
      i = skipTypeTrivia(text, i);
      continue;
    }
    if (text[i] === "'" || text[i] === '"' || text[i] === '`') {
      const literal = quotedTypeText(text, i);
      i = literal?.end ?? text.length;
      lastCode = text[i - 1] ?? lastCode;
      continue;
    }
    const identifier = identifierRunAt(text, i);
    if (identifier === null) {
      if (!/\s/u.test(text[i])) lastCode = text[i];
      i++;
      continue;
    }
    const precededByDot = lastCode === '.';
    i = identifier.end;
    lastCode = identifier.value.at(-1);
    if (precededByDot || identifier.value !== 'import') continue;
    let at = skipTypeTrivia(text, i);
    if (text[at] !== '(') continue;
    at = skipTypeTrivia(text, at + 1);
    if (text[at] !== "'" && text[at] !== '"') continue;
    const literal = quotedTypeText(text, at);
    if (literal === null) continue;
    at = skipTypeTrivia(text, literal.end);
    if (text[at] !== ')') continue;
    specs.push(literal.value);
    i = at + 1;
    lastCode = ')';
  }
  return specs;
}

// The entry a manifest serves for `subpath` ('.', './x'), or null.
// `exports` beats `main`; a conditions object reads in bun's runtime
// order (import → default → first string). Glob subpaths are not
// expanded — a miss errs toward the TS2307, never a silent wrong file.
// A subpath-map `exports` object ({'.': …, './x': …}) as opposed to a bare
// conditions object ({ import: './x.rip' }), which IS the '.' entry. One
// spelling of the shape decision, shared with every reader that has to ask
// it — a second copy of this predicate is a second answer to what a
// manifest publishes.
export const isSubpathExportsMap = (exp) => Object.keys(exp).some((k) => k === '.' || k.startsWith('./'));

function manifestTarget(manifest, subpath) {
  const pick = (entry) => {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object') {
      for (const key of ['import', 'default', ...Object.keys(entry)]) {
        if (typeof entry[key] === 'string') return entry[key];
      }
    }
    return null;
  };
  let target = null;
  const exp = manifest?.exports;
  if (typeof exp === 'string') { if (subpath === '.') target = exp; }
  else if (exp && typeof exp === 'object') {
    target = isSubpathExportsMap(exp) ? pick(exp[subpath]) : (subpath === '.' ? pick(exp) : null);
  } else if (subpath === '.' && typeof manifest?.main === 'string') {
    target = manifest.main;
  }
  return target;
}
// The same entry when it is a `.rip` — the one the mirror builds a face
// for. Anything else answers null here.
export function ripManifestTarget(manifest, subpath) {
  const target = manifestTarget(manifest, subpath);
  return target !== null && target.endsWith('.rip') ? target : null;
}

// The declaration a package serving JAVASCRIPT carries for its entry. A
// `.rip` entry has a face and needs none; a `.js` entry has no face, and
// without its declaration the bare name is unresolvable (TS2307) — with
// it, the name resolves to the declaration, absolute because the file
// lives in the source tree, not the mirror. The declaration is what the
// manifest NAMES — the `types` condition of the entry, or top-level
// `types`/`typings` for '.' — and otherwise the conventional sibling:
// `x.js` → `x.d.ts`, `x.mjs` → `x.d.mts`, `x.cjs` → `x.d.cts`.
function declarationTarget(manifest, subpath, dir) {
  const target = manifestTarget(manifest, subpath);
  if (target === null || !/\.[cm]?js$/.test(target)) return null;
  const candidates = [];
  const exp = manifest?.exports;
  const entry = exp && typeof exp === 'object' ? (isSubpathExportsMap(exp) ? exp[subpath] : (subpath === '.' ? exp : null)) : null;
  if (entry && typeof entry === 'object' && typeof entry.types === 'string') candidates.push(entry.types);
  if (subpath === '.') for (const named of [manifest?.types, manifest?.typings]) if (typeof named === 'string') candidates.push(named);
  candidates.push(target.replace(/\.([cm]?)js$/, '.d.$1ts'));
  for (const candidate of candidates) {
    try { return fs.realpathSync(path.resolve(dir, candidate)); } catch { /* next */ }
  }
  return null;
}

// The `.rip` file a BARE specifier lands on, resolved the way bun will:
// node_modules walk-up, manifest, then realpath (a workspace package is
// a symlink; the mirror is keyed by the real source path). Null for
// builtins, uninstalled packages, non-`.rip` targets, and targets
// physically inside node_modules — those would mirror under an excluded
// tree (a recorded limit).
export function bareRipSpecifierTarget(spec, fromDir) {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('#')) return null;
  if (spec.startsWith('node:') || spec.startsWith('bun:')) return null;
  const parts = spec.split('/');
  const pkgName = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  if (!pkgName || (spec.startsWith('@') && parts.length < 2)) return null;
  const subpath = '.' + spec.slice(pkgName.length);
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const pkgDir = path.join(dir, 'node_modules', pkgName);
    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')); } catch { /* keep walking */ }
    if (manifest) {
      const target = ripManifestTarget(manifest, subpath);
      if (target === null) return null;
      let real;
      try { real = fs.realpathSync(path.join(pkgDir, target)); } catch { return null; }
      return real.includes(`${path.sep}node_modules${path.sep}`) ? null : real;
    }
    if (path.dirname(dir) === dir) return stdlibRipTarget(spec);
  }
}

// The `.rip` module ANY specifier lands on, from `fromDir` — the one
// spelling of the resolution rule: a relative specifier resolves only when
// it names a `.rip` file (bare specifiers resolve through node_modules,
// relative ones by the filesystem — absolute paths either way). Every
// reader of an import edge — the closure walk, the typed-import gate, the
// inherited-`any` pass — resolves through this, so no two of them can
// disagree about which module an import lands on.
export function ripSpecifierTarget(spec, fromDir) {
  if (spec.startsWith('./') || spec.startsWith('../')) {
    return spec.endsWith('.rip') ? path.resolve(fromDir, spec) : null;
  }
  return bareRipSpecifierTarget(spec, fromDir);
}

// A rip checkout's packages/ — the stdlib the runtime loader serves as
// `rip/<pkg>` with no node_modules anywhere. Checking resolves the same
// names: bare-specifier targets fall back here when no node_modules
// provides the package, and tsconfig paths point each name at the
// entry's mirror face — or, for an entry that is JavaScript, at its
// declaration.
//
// What makes a `packages` directory a stdlib rather than any other
// directory of that name: rip's OWN editor package sits in it. The test
// reads the manifest's name — a monorepo that merely has a
// `packages/vscode/` of its own (a common way to ship an extension) is
// not a rip checkout, and mistaking one for a rip checkout would serve
// it a stdlib that holds none of the `rip/*` names.
const holdsStdlib = (packagesDir) => {
  try { return JSON.parse(fs.readFileSync(path.join(packagesDir, 'vscode', 'package.json'), 'utf8')).name === 'vscode-rip'; }
  catch { return false; }
};

// The stdlib the RUNNING BINARY carries — where a name lands when the
// file asking for it sits in no rip checkout, which is every consumer
// app. In-repo, this server IS in a checkout (../../../packages); the
// installed .vsix carries no stdlib, so it follows the `rip` bin's
// symlink home — PATH plus the standard bin dirs, because an extension
// host's PATH can be narrower than a shell's.
const STDLIB_DIR = (() => {
  const candidates = [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages')];
  const binDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  binDirs.push(
    path.join(process.env.BUN_INSTALL ?? path.join(os.homedir(), '.bun'), 'bin'),
    path.join(os.homedir(), '.local', 'bin'),
  );
  for (const dir of binDirs) {
    try {
      const repo = path.dirname(path.dirname(fs.realpathSync(path.join(dir, 'rip'))));
      candidates.push(path.join(repo, 'packages'));
    } catch { /* no rip bin here */ }
  }
  return candidates.find(holdsStdlib) ?? candidates[0];
})();

// The stdlib THIS PROCESS serves, and the spellings read off it. ONE
// stdlib, not one per file: a workspace generates a single tsconfig
// carrying a single `paths` map, so the stdlib a name resolves to and the
// stdlib that map points at have to be the same directory, or the closure
// materializes faces the config never names and every `rip/*` import
// squiggles TS2307. Deriving them separately — resolution from the
// importing file, the map from the workspace root — lets the two
// disagree whenever a checkout sits inside a workspace that is not
// itself one. All three are set together, by anchorStdlib alone.
let stdlibDir;
let realStdlibDir;
let stdlibAppEntry;

// Point this process at the stdlib of the checkout enclosing `root`, the
// local-first rule the runtime loader applies: a workspace inside a rip
// checkout is checked against THAT checkout's stdlib, so two checkouts
// holding the same source answer the same instead of answering by
// whichever binary happened to run. A root enclosed by no checkout —
// every consumer app — keeps STDLIB_DIR, the stdlib the running binary
// carries. Hosts call this once, before any mirror is generated.
export function anchorStdlib(root) {
  let found = STDLIB_DIR;
  if (typeof root === 'string' && root !== '') {
    for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
      const packagesDir = path.join(dir, 'packages');
      if (holdsStdlib(packagesDir)) { found = packagesDir; break; }
      if (path.dirname(dir) === dir) break;
    }
  }
  stdlibDir = found;
  try { realStdlibDir = fs.realpathSync(found); } catch { realStdlibDir = found; }
  // Realpath'd, the spelling stdlibRipPaths' targets use, so the face and
  // the tsconfig `paths` mapping land at one mirror path.
  try { stdlibAppEntry = fs.realpathSync(path.join(found, 'app', 'index.rip')); } catch { stdlibAppEntry = null; }
}
anchorStdlib(null);

// The one subtree OUTSIDE a workspace whose files are sanctioned closure
// members: the generated tsconfig already points `rip/*` at the stdlib's
// mirror faces, and the stash splice reaches `rip/app` with no source
// import — so a closure walker that refuses everything outside the
// workspace strands the mapping against faces nobody wrote. Compared
// realpath'd against the ONE stdlib this process serves — a tree this
// process was never anchored on is not a sanctioned closure member, so
// the bound the fence exists to enforce still holds everywhere else.
export const isStdlibPath = (fsPath) =>
  fsPath === realStdlibDir || fsPath.startsWith(realStdlibDir + path.sep);

function stdlibRipTarget(spec) {
  if (!spec.startsWith('rip/')) return null;
  const rest = spec.slice('rip/'.length);
  const [name, ...deeper] = rest.split('/');
  const pkgDir = path.join(stdlibDir, name);
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')); } catch { return null; }
  const target = ripManifestTarget(manifest, '.' + (deeper.length ? '/' + deeper.join('/') : ''));
  if (target === null) return null;
  let real;
  try { real = fs.realpathSync(path.join(pkgDir, target)); } catch { return null; }
  return real;
}

// tsconfig `paths` for the stdlib namespace: `rip/<pkg>` (plus
// manifest export subpaths) → the mirror face of each package entry, or
// the declaration of a JavaScript entry. Merged UNDER workspaceRipPaths,
// so a workspace's own copy of a name wins — the same local-first rule
// the runtime loader applies.
export function stdlibRipPaths(workspaceRoot, fromConfigDirToMirrorRoot = '') {
  const paths = {};
  let entries;
  try { entries = fs.readdirSync(stdlibDir, { withFileTypes: true }); } catch { return paths; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(stdlibDir, e.name);
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { continue; }
    const subpaths = ['.'];
    if (manifest.exports && typeof manifest.exports === 'object') {
      for (const k of Object.keys(manifest.exports)) if (k.startsWith('./') && !k.includes('*')) subpaths.push(k);
    }
    for (const sub of subpaths) {
      const name = sub === '.' ? `rip/${e.name}` : `rip/${e.name}` + sub.slice(1);
      const target = ripManifestTarget(manifest, sub);
      if (target === null) {
        const dts = declarationTarget(manifest, sub, dir);
        if (dts !== null) paths[name] ??= [dts];
        continue;
      }
      let real;
      try { real = fs.realpathSync(path.resolve(dir, target)); } catch { continue; }
      const face = mirrorRelForFsPath(real, workspaceRoot) + '.ts';
      paths[name] ??= [posix(path.join(fromConfigDirToMirrorRoot, face))];
    }
  }
  return paths;
}

// tsconfig `paths` for every workspace package serving `.rip` (or
// JavaScript with a declaration beside it): bare-name → mirror face, or
// the declaration, enumerated from the root's `workspaces` globs
// (`<dir>/*` form; members serving neither contribute nothing). Face
// paths are relative to the CONFIG carrying them — the mirror root passes
// '', a wrapper passes its reach-up — and declarations are absolute.
export function workspaceRipPaths(workspaceRoot, fromConfigDirToMirrorRoot = '') {
  const paths = {};
  if (!workspaceRoot) return paths;
  let ws;
  try { ws = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8')).workspaces; } catch { return paths; }
  const globs = Array.isArray(ws) ? ws : Array.isArray(ws?.packages) ? ws.packages : [];
  const memberDirs = [];
  for (const glob of globs) {
    if (typeof glob !== 'string') continue;
    if (glob.endsWith('/*')) {
      const parent = path.join(workspaceRoot, glob.slice(0, -2));
      let entries;
      try { entries = fs.readdirSync(parent, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) if (e.isDirectory()) memberDirs.push(path.join(parent, e.name));
    } else {
      memberDirs.push(path.join(workspaceRoot, glob));
    }
  }
  for (const dir of memberDirs) {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { continue; }
    if (typeof manifest?.name !== 'string') continue;
    const subpaths = ['.'];
    if (manifest.exports && typeof manifest.exports === 'object') {
      for (const k of Object.keys(manifest.exports)) if (k.startsWith('./')) subpaths.push(k);
    }
    for (const sub of subpaths) {
      const name = sub === '.' ? manifest.name : manifest.name + sub.slice(1);
      const target = ripManifestTarget(manifest, sub);
      if (target === null) {
        const dts = declarationTarget(manifest, sub, dir);
        if (dts !== null) paths[name] = [dts];
        continue;
      }
      const face = path.relative(workspaceRoot, path.resolve(dir, target)) + '.ts';
      paths[name] = [posix(path.join(fromConfigDirToMirrorRoot, face))];
    }
  }
  return paths;
}

// A closure-edge read failure that means the module DOES NOT EXIST as
// specified — nothing at the path (ENOENT, including a dangling
// symlink), a path segment that is a file (ENOTDIR), a symlink cycle
// (ELOOP), an unresolvable name (ENAMETOOLONG) — as opposed to a module
// that exists but cannot be read (EACCES, EIO). ripImportsOf hands out
// relative edges without an existence check, so its consumers meet both
// classes and route them differently: a missing module is the
// IMPORTER's defect (its absent face earns tsgo's TS2307 on the
// importing line), while an unreadable one is a coverage gap a skip
// would mislabel as "cannot find module".
export const missingModuleRead = (err) =>
  err?.code === 'ENOENT' || err?.code === 'ENOTDIR' || err?.code === 'ELOOP' || err?.code === 'ENAMETOOLONG';

// The `.rip` import targets of a compiled file — the closure edges.
// Read from the compiler's OWN stores, never generated text (the
// never-list): import/export `source` roles, dynimport args only when a
// single static literal (computed specifiers are a recorded miss), and
// import types inside recorded type text. Program membership is the
// whole fix: with the sibling in the program, the untouched specifier
// resolves by the mirror's filename — no rewriting, no second rule.
export function ripImportsOf(stores, sourceText, fromDir) {
  const seen = new Set();
  const targets = [];
  const addSpec = (spec) => {
    const abs = ripSpecifierTarget(spec, fromDir);
    if (abs === null) return;
    if (seen.has(abs)) return;   // one edge per module, however many spellings name it
    seen.add(abs);
    targets.push(abs);
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
  for (const r of stores.roles) {
    if (!TYPE_TEXT_ROLES.has(r.role) || typeof r.sourceStart !== 'number') continue;
    for (const spec of typeImportSpecifiers(sourceText.slice(r.sourceStart, r.sourceEnd))) addSpec(spec);
  }
  return targets;
}
