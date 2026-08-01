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
// A tsconfig path is written into a generated config, so it is always
// POSIX-separated — a Windows `..\\pkg\\tsconfig.json` is not a legal
// `extends` spec.
const posix = (p) => p.split(path.sep).join('/');

// The nearest `tsconfig.json` at or above `dir`, stopping AT `anchor`
// (inclusive). Null when the walk reaches the anchor without finding
// one, which is the ordinary case: most directories are governed by the
// workspace root's config and need no wrapper of their own.
export function nearestTsconfig(dir, anchor) {
  for (let d = dir; ; d = path.dirname(d)) {
    const candidate = path.join(d, 'tsconfig.json');
    if (fs.existsSync(candidate)) return candidate;
    if (d === anchor || path.dirname(d) === d) return null;
  }
}

// The generated WRAPPER for one nested project: the same overrides the
// mirror root gets, but reaching up to that project's own tsconfig
// instead of the workspace root's, with every reach-up computed rather
// than spelled. tsgo's LSP does per-file nearest-tsconfig discovery (the
// tsserver configured-project model), so placing one of these at each
// mirrored project dir partitions the faces by project inside a SINGLE
// mirror tree and a SINGLE session — no multiplexing, and the pin pass
// is untouched.
//
// The wrapper states its own include/exclude, so the source tsconfig's
// FILE SET is not inherited — only its compilerOptions. And the floor is
// emitted per project, from that project's own gate answers: a nested
// project's strictness and installed types govern whether ITS files see
// it, which a single workspace-root floor could never express.
export function projectWrapper({ wrapperDir, sourceTsconfig, chain = new Set(), onUnresolved }) {
  const sourceDir = path.dirname(sourceTsconfig);
  const overrides = {
    noImplicitAny: true,
    noEmit: true,
    allowImportingTsExtensions: true,
    rootDirs: ['.', posix(path.relative(wrapperDir, sourceDir))],
  };
  chain.clear();
  const setsTypes = chainSetsTypes(sourceTsconfig, chain, onUnresolved);
  if (!setsTypes) overrides.types = ['*'];
  const reachUp = posix(path.relative(wrapperDir, sourceDir));
  return {
    tsconfig: {
      extends: posix(path.relative(wrapperDir, sourceTsconfig)),
      compilerOptions: overrides,
      include: ['**/*.ts', `${reachUp}/**/*.d.ts`],
      exclude: ['node_modules', `${reachUp}/**/node_modules`],
    },
    hostFloorDts: hostFloorDts(sourceDir, { userSetsTypes: setsTypes }),
  };
}

export function generatedMirror({ workspaceRoot, mirrorRootIsFallback, chain = new Set(), onUnresolved, excludeDirs = [] } = {}) {
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
  // A nested project's mirrored subtree belongs to ITS wrapper. Without
  // the exclusion both configs claim the same faces, and which one
  // answers is tsgo's discovery order rather than the file's own
  // nearest config.
  const exclude = ['node_modules', ...excludeDirs.map((d) => `${posix(d)}/**`)];
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

// ---- the auto-import stub face: what a workspace `.rip` NOTHING has
// opened or imported contributes to the program, so its exported names
// are auto-import candidates from cold.
//
// Built from a SOURCE scan, not a compile, and that is the whole reason
// the eager pass is affordable: compiling every workspace face is ~92%
// of population time (1456 ms over 277 files, measured), against ~8 ms
// to read the export lines. A stub and a full face produce the same
// completion item and the same import edit, so the compile buys nothing
// candidacy needs.
//
// Scanning SOURCE for a fact the compiler already knows is otherwise the
// never-list's territory (ripImportsOf reads the stores, not text) — the
// exemption is precise and holds only here: this runs where there is no
// compile to read stores from, its output is thrown away the instant a
// real edge materializes the true face over it, and a name this scan
// misses costs a missing completion candidate, never a wrong answer. It
// must NOT be reused anywhere a mapping, a diagnostic, or a closure edge
// depends on it.

const IDENT = String.raw`[A-Za-z_$][A-Za-z0-9_$]*`;
// Words that open a declaration form and are therefore never the
// exported NAME in rip's bare `export name = …` production.
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
// A binding inside a destructuring pattern: an identifier followed by a
// separator, a closer, end of text, or `=` — the last because a binding
// may carry a DEFAULT (`{ a = 1, b }`) and is still the name being bound.
// A renamed key (`{ a: renamed }`) is deliberately not matched at `a`,
// whose `:` is in none of these: `renamed` is the binding.
const PATTERN_NAME = new RegExp(String.raw`(${IDENT})\s*(?:[,}\]=]|$)`, 'g');
const FROM_SPEC = /^from\s*['"]([^'"]+)['"]/;

// The exported names of one `.rip` SOURCE, split by declaration space.
// `stars` carries the specifiers of `export * from …`, which name no
// names of their own — the caller resolves those against its own scan of
// the target (buildStubFaces does). `hasDefault` is tracked separately
// because a default export has no name to carry: a consumer spells it
// `import theme from …` or `import { default as theme } from …`, and a
// stub that omitted it answered TS1192/TS2305 on every such consumer.
export function scanExportNames(source) {
  const values = new Set();
  const types = new Set();
  const stars = [];
  let hasDefault = false;
  const lines = source.split('\n');
  let inBlockString = false;
  for (let i = 0; i < lines.length; i++) {
    // A block string's CONTENT can start a line with `export` — rip's own
    // suites embed whole modules that way, and reading one as an export
    // put two names in the candidate set that the face never exported.
    const fences = (lines[i].match(/"""|'''/g) ?? []).length;
    const wasInBlockString = inBlockString;
    if (fences % 2) inBlockString = !inBlockString;
    if (wasInBlockString) continue;
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
      // A brace list may span lines (`export {\n  a,\n  b,\n}`), so read
      // forward to the closing brace rather than judging one line. Joined
      // with a COMMA: rip lets a multi-line list separate its entries by
      // newline alone, and a space-join fuses those into one unparseable
      // clause (an empty clause from a trailing comma is skipped below).
      while (!rest.includes('}') && i + 1 < lines.length) rest += ',' + lines[++i].trim();
      const close = rest.indexOf('}');
      if (close < 0) continue;                   // unterminated: nothing trustworthy to emit
      // A brace list is the whole statement or a re-export — and a
      // re-export's target contributes nothing beyond the names written
      // here (`export { a } from './x.rip'` states `a` outright). Anything
      // ELSE after the brace is a shape this scan does not understand, so
      // the clauses are not read: names guessed out of it would be offered
      // as candidates the real face never exports. Checked BEFORE the
      // clause loop, so it gates the names rather than trailing them.
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
      // The assignment `=` is the one at DEPTH ZERO. A binding's DEFAULT
      // spells `=` too (`{ a = 1, b }`), and cutting at the first one
      // drops every name after it — the pattern's own tail, not the
      // initializer.
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
    // A schema binding is a TYPE as well as a value, and a `:model` also
    // ships the two companion types its lowering derives from the name.
    // This is the one place the scan encodes a lowering rule rather than
    // reading what the source says, and the cost of it going stale is
    // bounded to candidacy: an offered name the real face does not export
    // fails loudly at the import the moment that face materializes.
    const schema = /^(?:[^=]*)=\s*schema\s+:(\w+)/.exec(rest);
    if (!schema) continue;
    types.add(name);
    if (schema[1] === 'model') { types.add(name + 'Data'); types.add(name + 'Create'); }
  }
  return { values: [...values], types: [...types], stars, hasDefault };
}

// The stub text for one file's exported names. Every name is `any`: the
// stub exists to make the NAME reachable, and a shape it guessed would be
// a shape that could be wrong. A type alias and a variable occupy
// different declaration spaces, so a class or enum can legally be both.
export function stubFace({ values = [], types = [], hasDefault = false } = {}) {
  const lines = [];
  for (const name of types) lines.push(`export type ${name} = any;`);
  for (const name of values) lines.push(`export declare const ${name}: any;`);
  if (hasDefault) lines.push('declare const __ripDefault: any;', 'export default __ripDefault;');
  lines.push('export {};');   // a module even when it exports nothing
  return lines.join('\n') + '\n';
}

// Stub faces from already-scanned sources (fsPath → scanExportNames
// result), as fsPath → text. `export * from './x.rip'` is resolved
// against the OTHER scans here — the one export form whose names are not
// written where it appears. Split from the scan so a caller populating a
// large workspace can yield between reads; `buildStubFaces` below is the
// whole-thing convenience.
export function stubFacesFromScans(scans) {
  // Star edges, resolved once. A target outside `scans` contributes
  // nothing — there is no source here to read names from.
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
  // Grown to a FIXPOINT rather than resolved by recursion. `export *` is
  // transitive and a cycle of them is legal (mutually re-exporting barrel
  // files), so a recursive walk has to break the cycle somewhere and
  // whichever file it breaks on gets a short answer — which a memo then
  // stores as if it were complete, making the result depend on traversal
  // order. Iterating to closure has no break to place: every file ends up
  // with the union its stars reach, cycles included. It terminates because
  // the sets only grow and the name space is finite.
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
    // `export * from` carries names but never a DEFAULT — the star form
    // is defined to skip it — so hasDefault stays this file's own.
    faces.set(file, stubFace({
      values: [...values.get(file)], types: [...types.get(file)], hasDefault: scan.hasDefault,
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

// The roles whose recorded span is TYPE TEXT — where an import type's
// specifier lives, since it belongs to no import node.
const TYPE_TEXT_ROLES = new Set(['annotation', 'returnType', 'typeParams', 'declaration']);
const IMPORT_TYPE = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

// The relative .rip import targets of a compiled file, as absolute paths
// — the closure edges. Read from the compiler's OWN stores (never
// scanned from generated text — the never-list): import/export nodes
// carry a `source` role whose exact source span is the specifier string;
// dynimport nodes carry an `args` span, followed only when it is a single
// static string literal (a computed specifier is a recorded closure miss);
// and an IMPORT TYPE (`c: import('./lib.rip').Crate`) names its module
// inside recorded type text, which is read the same way — a role's own
// span over SOURCE, never a scan of anything generated. Program
// membership is the whole fix there: with the sibling in the program the
// untouched `.rip` specifier resolves by the mirror's filename, so
// nothing rewrites a specifier and there is no second resolution rule.
export function ripImportsOf(stores, sourceText, fromDir) {
  const seen = new Set();
  const targets = [];
  const addSpec = (spec) => {
    if (!spec.endsWith('.rip')) return;
    if (!spec.startsWith('./') && !spec.startsWith('../')) return;
    const abs = path.resolve(fromDir, spec);
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
    for (const m of sourceText.slice(r.sourceStart, r.sourceEnd).matchAll(IMPORT_TYPE)) addSpec(m[2]);
  }
  return targets;
}
