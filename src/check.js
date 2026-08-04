// `rip check` — the headless type-checker (the `tsc --noEmit` of
// rip-land), as a BATCH over the editor's own pipeline: compile each
// target `.rip` (and its transitive `.rip` closure) to a TS face,
// materialize the faces into a mirror tree with the editor's generated
// tsconfig, then drive ONE tsgo session over the whole mirror —
// pin-probing each file exactly as the editor does (so evolving-`let`
// bindings resolve to their real types, not `any`) and pulling
// diagnostics per file (a request/response, so no settle) — and map
// every diagnostic back onto `.rip` source.
//
// It is the editor's refresh→probe→pull loop, batched and headless:
// full parity with what VS Code shows, in one tsgo program instead of a
// per-keystroke session. The drift-sensitive core is SHARED with the
// server, not copied:
//   · mirror.js       — generatedMirror, mirror naming, closure edges
//   · diagnostics.js  — mapTsDiagnostic, rip.strict gate, @ts-expect-error
//                        (applyRipDirectives), rip.noCheck (isNoCheckPath)
//   · pins.js         — buildProbe / parseProbeHover (Tier-3 pins)
//   · translate.js    — the generated↔source mapping primitives

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { cacheIdentityOf } from '../packages/vscode/src/hash.js';
import { compile } from './compile.js';
import { readProjectConfig } from './config.js';
import { identifierRunAt } from './lexer.js';
import { startTsgo } from '../packages/vscode/src/tsgo.js';
import { buildProbe, parseProbeHover } from '../packages/vscode/src/pins.js';
import { mapTsDiagnostic, applyRipDirectives, isNoCheckPath, compileErrorInfo } from '../packages/vscode/src/diagnostics.js';
import { SUPPRESSED_TS_CODES, IMPLICIT_ANY_CODES, MISSING_TYPES_CODES } from '../packages/vscode/src/translate.js';
import { scopeGateOf, typedExportsOf, typedImportsOf } from '../packages/vscode/src/scopes.js';
import { tokenize } from './lexer.js';
import { generatedMirror, projectWrapper, nearestTsconfig, HOST_FLOOR_NAME, mirrorRelForFsPath, ripImportsOf, missingModuleRead, linkNestedNodeModules, declaredButUninstalled } from '../packages/vscode/src/mirror.js';
import { lineStartsOf, offsetToPosition, positionToOffset, generatedSpanToSource } from '../packages/vscode/src/translate.js';

// Fails OPEN, like the editor's: a source the lexer refuses leaves the gate
// undefined and every diagnostic publishes. An empty annotation set would
// silence the whole file, and a silent file reads as a clean one.
const scopeGate = (source, fsPath, face, typedImports) => {
  try { return scopeGateOf(tokenize(source, fsPath).tokens, source, face, typedImports); }
  catch { return undefined; }
};

// A module's ANNOTATED exports — file-local, so a lexer refusal costs this
// module's importers their cross-file checking and nothing else.
const moduleTypedExports = (source, fsPath, face) => {
  try { return typedExportsOf(tokenize(source, fsPath).tokens, source, face); }
  catch { return new Set(); }
};

const HELP = `rip check — type-check .rip files headlessly (the tsc --noEmit of rip-land)

Usage:
  rip check [paths...]     Type-check the given files/directories
                           (default: the current directory, recursively)

Options:
  --json                   Emit diagnostics as a JSON array instead of the
                           human-readable text report
  --no-frame               Suppress the source code-frame under each error
  --build                  Print the build identity (a content hash over the
                           compiler and editor-server trees) and exit — the
                           editor logs the same hash in its ready line, so a
                           mismatch means the installed extension is stale
  -h, --help               Show this help

Exit status is 0 when no error-severity diagnostic survives, 1 otherwise.
Directories are walked for *.rip (node_modules and dot-directories are
skipped). Config — package.json#rip (strict / noCheck) and the project
tsconfig — governs exactly as it does in the editor. The generated TS
mirror stays at <root>/.rip/check after the run — the exact TypeScript
the LAST run type-checked (only the files that run covered), wiped and
rebuilt at the start of every run; .build inside it names the compiler
build that wrote it.`;

const fail = (message, code = 2) => { console.error(message); process.exit(code); };

// ── argument parsing ────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) { console.log(HELP); process.exit(0); }
// The build identity, printed and exited on before anything else: the same
// content hash over the same two trees (compiler + editor server) the
// editor computes for its cache key and logs in its ready line. When the
// two hashes differ, the installed extension is running different code
// than this CLI — the skew behind "the editor and rip check disagree".
if (argv.includes('--build')) {
  const compilerDir = path.dirname(fileURLToPath(import.meta.url));
  const serverDir = path.join(compilerDir, '..', 'packages', 'vscode', 'src');
  const tilde = (p) => (p.startsWith(os.homedir() + path.sep) ? '~' + p.slice(os.homedir().length) : p);
  console.log(`rip check build ${cacheIdentityOf(compilerDir, serverDir)}`);
  console.log(`  compiler  ${tilde(compilerDir)}`);
  console.log(`  server    ${tilde(serverDir)}`);
  process.exit(0);
}
const asJson = argv.includes('--json');
const showFrames = !argv.includes('--no-frame') && !asJson;
const KNOWN = new Set(['--json', '--no-frame', '--build']);
const positionals = argv.filter((a) => !a.startsWith('-'));
const unknownFlags = argv.filter((a) => a.startsWith('-') && !KNOWN.has(a));
if (unknownFlags.length) fail(`rip check: unknown option${unknownFlags.length === 1 ? '' : 's'}: ${unknownFlags.join(', ')}\n\nRun 'rip check --help' for usage.`);

// The generated TS mirror at <root>/.rip/check is a persistent,
// regenerable cache — the peer of the editor's .rip/editor, self-
// gitignored, left in place between runs so the exact TypeScript tsgo
// checked stays inspectable. Freshness never depends on cleanup: every
// run wipes and rebuilds the tree before tsgo sees it. Only the temp
// fallback root — used when the workspace isn't writable — is ours to
// remove, on ANY exit path: rmSync in an exit handler runs
// synchronously.
let fallbackToClean = null;
process.on('exit', () => {
  if (fallbackToClean === null) return;
  try { fs.rmSync(fallbackToClean, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ── target collection ───────────────────────────────────────────────
function* walkRip(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      yield* walkRip(path.join(dir, entry.name));
    } else if (entry.isFile() && entry.name.endsWith('.rip')) {
      yield path.join(dir, entry.name);
    }
  }
}
function collectTargets(paths) {
  const files = new Set();
  for (const p of paths) {
    const abs = path.resolve(p);
    let st;
    try { st = fs.statSync(abs); } catch { fail(`rip check: path not found: ${p}`); }
    if (st.isDirectory()) { for (const f of walkRip(abs)) files.add(f); }
    else if (st.isFile()) {
      if (!abs.endsWith('.rip')) fail(`rip check: not a .rip file: ${p}`);
      files.add(abs);
    }
  }
  return [...files].sort();
}

// The workspace root the mirror + tsconfig are rooted at: the nearest
// ancestor of the targets carrying a project marker, else their common
// ancestor. This makes package.json#rip and the user's tsconfig resolve
// as they do in the editor (whose mirror sits at <root>/.rip/editor —
// the batch mirror sits beside it at <root>/.rip/check, the same
// two-levels-down depth so the tsconfig's ../../ reach-ups resolve).
function commonAncestor(files) {
  if (files.length === 0) return process.cwd();
  if (files.length === 1) return path.dirname(files[0]);
  const split = files.map((f) => f.split(path.sep));
  const first = split[0];
  let i = 0;
  for (; i < first.length; i++) if (!split.every((parts) => parts[i] === first[i])) break;
  return first.slice(0, i).join(path.sep) || path.sep;
}
// The workspace root anchors the mirror, and a WORKSPACES root outranks
// a nearer plain package.json: checking `packages/http` from a monorepo
// root must land the sibling packages its bare imports resolve to INSIDE
// the mirror, and stopping at the package's own manifest strands them
// outside. The walk records the nearest marker as the fallback and keeps
// climbing for a `workspaces` declaration — bun's own resolution rule.
function findWorkspaceRoot(files) {
  const base = commonAncestor(files);
  let nearest = null;
  for (let cur = base; ; ) {
    const pkg = path.join(cur, 'package.json');
    if (fs.existsSync(pkg)) {
      try { if (JSON.parse(fs.readFileSync(pkg, 'utf8')).workspaces) return cur; } catch { /* malformed — a marker, not a root */ }
      nearest ??= cur;
    } else if (['tsconfig.json', '.git'].some((m) => fs.existsSync(path.join(cur, m)))) {
      nearest ??= cur;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return nearest ?? base;
}

const targets = collectTargets(positionals.length ? positionals : ['.']);
if (targets.length === 0) {
  if (asJson) console.log('[]');
  else console.log('rip check: no .rip files found');
  process.exit(0);
}
const workspaceRoot = findWorkspaceRoot(targets);

// ── mirror root ─────────────────────────────────────────────────────
// A dedicated mirror at <root>/.rip/check (peer of the editor's
// .rip/editor), wiped and rebuilt EVERY run — unconditionally, before
// anything compiles, so a run whose targets all fail to parse still
// clears the previous run's faces and the tree always holds exactly
// what the LAST run checked. `.build` stamps it with the compiler build
// that wrote it. The wipe is what carries correctness: a since-deleted
// source's face from an earlier run never lingers in the `**/*.ts`
// program.
let mirrorRoot = path.join(workspaceRoot, '.rip', 'check');
let mirrorRootIsFallback = false;
try {
  fs.rmSync(mirrorRoot, { recursive: true, force: true });
  fs.mkdirSync(mirrorRoot, { recursive: true });
  fs.writeFileSync(path.join(mirrorRoot, '.gitignore'), '*\n');
  const compilerDir = path.dirname(fileURLToPath(import.meta.url));
  fs.writeFileSync(path.join(mirrorRoot, '.build'),
    cacheIdentityOf(compilerDir, path.join(compilerDir, '..', 'packages', 'vscode', 'src')) + '\n');
} catch (err) {
  // Degraded, never silent: the fallback re-roots tsgo outside the
  // workspace, so per-project wrappers stop applying and @types
  // resolution changes — the user must know their diagnostics come
  // from a different posture than the editor's.
  mirrorRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-check-'));
  mirrorRootIsFallback = true;
  fallbackToClean = mirrorRoot;
  console.error(`rip check: workspace mirror root unavailable (${err.code ?? err.message}) — using a temp fallback (tsconfig/@types fidelity degrades)`);
}

// ── closure compile (pins-less) ─────────────────────────────────────
// BFS the target set + its transitive .rip imports. Each source is
// compiled to its TS face once (with its own rip.strict); a parse
// failure is reported directly (no face) — its importers then see a
// cannot-find-module, exactly as a broken file behaves in the editor.
const configCache = new Map();
const projectConfig = (dir) => {
  // readProjectConfig never throws — it returns its own defaults on any
  // unreadable/malformed package.json — so no fallback wrapper is needed.
  if (!configCache.has(dir)) configCache.set(dir, readProjectConfig(dir));
  return configCache.get(dir);
};

const compiled = new Map();   // fsPath → { source, cfg, good, pinnables }
const parseDiags = [];        // rows for files that failed to compile
// A file that could not be read, or whose diagnostics could not be pulled,
// leaves coverage SHORT of what was asked — the run then never exits 0 (a
// clean 0 must mean "checked, and clean", never "couldn't check"), mirroring
// the tsgo-unavailable posture below.
let incompleteCheck = false;
// Diagnostics dropped by the gradual posture, counted so the summary can
// say so. A run that hides hundreds and reports nothing about it reads as
// "rip's checker is weak" rather than "this project is in gradual mode" —
// the wrong lesson, and an undiscoverable one.
//
// Counted per FAMILY because the remedies differ: one is a mode you can
// turn on, the other is a package you can install. A single total would
// point everyone at the wrong one.
let hiddenAnnotations = 0;
let hiddenMissingTypes = 0;
let hiddenScope = 0;
// The NAMES the missing-types advisories are about (`describe`, `require`
// …) — TypeScript's own message carries each one, and a summary that says
// "install the @types package" without a noun sends the user hunting
// through their imports for which declaration is absent.
const missingTypeNames = new Set();
// The PROJECTS the hidden diagnostics belong to (config-dir, cwd-relative),
// per family — named in the summary so the `rip.strict` remedy points at
// the right package.json. The home project ('.') stays unnamed.
const hiddenScopeDirs = new Set();
const hiddenAnnotationDirs = new Set();
let hiddenUninstalled = 0;
const hiddenUninstalledDirs = new Set();   // where `bun install` answers
const seen = new Set();
const explicitTargets = new Set(targets);
const queue = [...targets];
while (queue.length) {
  const fsPath = queue.shift();
  if (seen.has(fsPath)) continue;
  seen.add(fsPath);
  let source;
  try { source = fs.readFileSync(fsPath, 'utf8'); }
  catch (err) {
    // A QUEUED import whose module does not exist as specified
    // (missingModuleRead: ENOENT, ENOTDIR, ELOOP…) is not a coverage
    // gap: a dangling specifier is the IMPORTER's defect, and its
    // missing face already earns the importer tsgo's TS2307 on the .rip
    // line (or silence under @ts-nocheck, whose writ covers the file's
    // imports). Everything else stays loud and marks the run short: an
    // explicit target is part of what was ASKED to be checked (named on
    // the command line or found by the walk), and an import that EXISTS
    // but cannot be read (EACCES) must not skip into a "cannot find
    // module" that misstates the problem. The editor's closure walk is
    // broader here — it parks EVERY unreadable import for a later
    // Created event — because an open-buffer server retries where a
    // batch gate answers once, loudly.
    if (!explicitTargets.has(fsPath) && missingModuleRead(err)) continue;
    incompleteCheck = true;
    console.error(`rip check: cannot read ${path.relative(process.cwd(), fsPath)} (${err.code ?? err.message}) — skipped; the run is incomplete`);
    continue;
  }
  const cfg = projectConfig(path.dirname(fsPath));
  const srcLineStarts = lineStartsOf(source);
  let result;
  try {
    result = compile(source, { path: fsPath, face: 'ts', runtimeDelivery: 'inline', strict: cfg.strict });
  } catch (err) {
    if (err?.name !== 'CompileError') throw err;
    const { reason, start, end } = compileErrorInfo(err, source.length);
    const s = offsetToPosition(srcLineStarts, start);
    const e = offsetToPosition(srcLineStarts, end);
    parseDiags.push({ file: fsPath, line: s.line, character: s.character, endLine: e.line, endCharacter: e.character, severity: 1, code: null, message: reason });
    continue;
  }
  compiled.set(fsPath, {
    source, cfg, result,
    good: {
      source, code: result.code, mappings: result.mappings,
      echoSpans: result.echoSpans ?? [],
      srcLineStarts, genLineStarts: lineStartsOf(result.code),
      strict: cfg.strict === true,
      dir: path.dirname(fsPath),
    },
    pinnables: result.pinnables ?? [],
  });
  for (const imp of ripImportsOf(result.stores, source, path.dirname(fsPath))) {
    if (!seen.has(imp)) queue.push(imp);
  }
}

// The gate runs in a SECOND pass, once the whole closure is compiled: a
// file's gate depends on which of its imports name an ANNOTATED export, and
// the queue reaches a dependency after the file importing it as often as
// before. Typed exports are file-local, so this pass needs no ordering of
// its own and an import cycle cannot recur through it.
const typedExports = new Map();
for (const [fsPath, entry] of compiled) {
  typedExports.set(fsPath, moduleTypedExports(entry.source, fsPath, entry.result));
}
for (const [fsPath, entry] of compiled) {
  entry.good.checkedLines = scopeGate(
    entry.source, fsPath, entry.result,
    typedImportsOf(entry.result.stores, entry.source, path.dirname(fsPath), (p) => typedExports.get(p)),
  );
}

// ── materialize the mirror + drive one tsgo session ─────────────────
const tsDiags = [];
let tsgoUnavailable = false; // tsgo needed but could not start — a run that couldn't type-check
if (compiled.size > 0) {
  for (const [fsPath, entry] of compiled) {
    const rel = mirrorRelForFsPath(fsPath, mirrorRootIsFallback ? null : workspaceRoot);
    const mirrorPath = path.join(mirrorRoot, rel) + '.ts';
    entry.mirrorPath = mirrorPath;
    // Canonical (percent-encoded) URI — tsgo emits relatedInformation
    // locations in this form, so a raw `'file://' + path` key would miss
    // them whenever the path carries a space or non-ASCII char.
    entry.mirrorUri = pathToFileURL(mirrorPath).href;
    fs.mkdirSync(path.dirname(mirrorPath), { recursive: true });
    if (!mirrorRootIsFallback) linkNestedNodeModules(workspaceRoot, mirrorRoot, fsPath);
    fs.writeFileSync(mirrorPath, entry.good.code);
  }
  // Per-project wrappers: one generated tsconfig at each mirrored dir whose
  // OWN tsconfig governs it, so a nested package's compilerOptions — its
  // strict, types, lib, jsx, paths — reach its files. tsgo assigns each file
  // to its nearest config, so one mirror tree and one session still serve
  // the whole workspace. Files under no nested project keep the root
  // wrapper, which excludes these subtrees so no face has two owners.
  const wrapperRels = new Set();
  if (!mirrorRootIsFallback) {
    for (const [fsPath] of compiled) {
      const owner = nearestTsconfig(path.dirname(fsPath), workspaceRoot);
      if (owner === null || path.dirname(owner) === workspaceRoot) continue;
      wrapperRels.add(path.relative(workspaceRoot, path.dirname(owner)));
    }
  }
  // The AUTO BOUNDARY: a package becomes its own program when it DECLARES
  // globals (`globalThis.NAME ??=` — the vocabulary stays package-scoped,
  // reaching importers the way the runtime does) or when it sets
  // `rip.strict` (floors and null posture are per-PROGRAM, so a strict
  // package inside the root program kept getting the gradual floor's
  // `any`s — driven by `bun:sqlite` staying unsquiggled in a strict
  // package). A package already inside a tsconfig-wrapped project needs
  // nothing more; the workspace root has no narrower scope to give.
  const autoBoundaryRels = new Set();
  if (!mirrorRootIsFallback) {
    for (const [fsPath, entry] of compiled) {
      let pkgDir = null;
      if (entry.cfg.strict === true && entry.cfg._configDir && entry.cfg._configDir !== workspaceRoot) {
        pkgDir = entry.cfg._configDir;
      } else if (entry.result.globalDecls?.length) {
        for (let dir = path.dirname(fsPath); ; dir = path.dirname(dir)) {
          if (fs.existsSync(path.join(dir, 'package.json'))) { pkgDir = dir; break; }
          if (dir === workspaceRoot || path.dirname(dir) === dir) break;
        }
      }
      if (pkgDir === null || pkgDir === workspaceRoot || !pkgDir.startsWith(workspaceRoot + path.sep)) continue;
      const rel = path.relative(workspaceRoot, pkgDir);
      if (![...wrapperRels].some((w) => rel === w || rel.startsWith(w + path.sep))) autoBoundaryRels.add(rel);
    }
  }
  const mirror = generatedMirror({
    workspaceRoot, mirrorRootIsFallback, excludeDirs: [...wrapperRels, ...autoBoundaryRels],
  });
  fs.writeFileSync(path.join(mirrorRoot, 'tsconfig.json'), JSON.stringify(mirror.tsconfig, null, 2));
  fs.writeFileSync(path.join(mirrorRoot, HOST_FLOOR_NAME), mirror.hostFloorDts);
  for (const rel of wrapperRels) {
    const wrapperDir = path.join(mirrorRoot, rel);
    const wrapper = projectWrapper({
      wrapperDir, sourceTsconfig: path.join(workspaceRoot, rel, 'tsconfig.json'),
      workspaceRoot, mirrorRoot,
    });
    fs.mkdirSync(wrapperDir, { recursive: true });
    fs.writeFileSync(path.join(wrapperDir, 'tsconfig.json'), JSON.stringify(wrapper.tsconfig, null, 2));
    fs.writeFileSync(path.join(wrapperDir, HOST_FLOOR_NAME), wrapper.hostFloorDts);
  }
  for (const rel of autoBoundaryRels) {
    const wrapperDir = path.join(mirrorRoot, rel);
    const wrapper = projectWrapper({
      wrapperDir, sourceTsconfig: null, sourceDir: path.join(workspaceRoot, rel),
      workspaceRoot, mirrorRoot,
    });
    fs.mkdirSync(wrapperDir, { recursive: true });
    fs.writeFileSync(path.join(wrapperDir, 'tsconfig.json'), JSON.stringify(wrapper.tsconfig, null, 2));
    fs.writeFileSync(path.join(wrapperDir, HOST_FLOOR_NAME), wrapper.hostFloorDts);
  }

  let session = null;
  try {
    session = await startTsgo(mirrorRootIsFallback ? mirrorRoot : workspaceRoot, {
      // relatedInformation rides the PULL slot: tsgo returns bare items
      // unless the client advertises support on the `diagnostic`
      // capability specifically — the push-slot declaration alone is not
      // enough. Advertising it here is what lets the `textDocument/
      // diagnostic` response carry the secondary "declared here"
      // locations, so no second batch pass over the mirror is needed.
      // The override replaces startTsgo's whole textDocument slot, so
      // hover's contentFormat is restated — the pin probe's parser reads
      // the fenced-markdown hover form.
      clientCapabilities: {
        textDocument: {
          hover: { contentFormat: ['markdown', 'plaintext'] },
          diagnostic: { relatedInformation: true },
          publishDiagnostics: { relatedInformation: true },
          synchronization: { didSave: true },
        },
      },
      serverRequests: {
        'workspace/configuration': (p) => (p.items ?? []).map(() => null),
        'client/registerCapability': () => null,
        'client/unregisterCapability': () => null,
        'window/workDoneProgress/create': () => null,
      },
    });
  } catch { session = null; }

  if (!session) {
    // Without tsgo the mirror is built but nothing type-checks. Report the
    // Rip parse errors we do have, but the run is NOT clean — it exits
    // non-zero (below) so a CI gate never reads un-type-checked code as OK.
    console.error('rip check: tsgo not available (bun install in packages/vscode) — checking Rip parse errors only, no type diagnostics');
    tsgoUnavailable = true;
  } else {
    const tsgo = session.client;
    try {
      // ── PIN PASS ── Tier-3 pins, per file: splice probe declarations
      // that tsgo can type NATIVELY (not evolving-`any`), hover them, and
      // feed the answers back into a recompile — so a hoisted binding
      // read across a closure resolves to its real type, as in the editor.
      for (const [fsPath, entry] of compiled) {
        if (!entry.pinnables.length) continue;
        const probePath = entry.mirrorPath.replace(/\.ts$/, '.__rip_probe__.ts');
        const probeUri = pathToFileURL(probePath).href;
        const { text, positions } = buildProbe(entry.good.code, entry.pinnables);
        const pins = new Map();
        try {
          fs.writeFileSync(probePath, text);
          tsgo.notify('textDocument/didOpen', { textDocument: { uri: probeUri, languageId: 'typescript', version: 1, text } });
          for (let i = 0; i < entry.pinnables.length; i++) {
            if (!positions[i]) continue;
            let type = null;
            try {
              const hover = await tsgo.request('textDocument/hover', { textDocument: { uri: probeUri }, position: positions[i] });
              type = parseProbeHover(hover);
            } catch { /* dead tsgo / timeout: no pin, status quo */ }
            if (type !== null) pins.set(entry.pinnables[i].key, type);
          }
          tsgo.notify('textDocument/didClose', { textDocument: { uri: probeUri } });
        } finally {
          try { fs.unlinkSync(probePath); } catch { /* already gone */ }
        }
        if (pins.size) {
          const r = compile(entry.source, { path: fsPath, face: 'ts', runtimeDelivery: 'inline', strict: entry.cfg.strict, pins });
          entry.good.code = r.code;
          entry.good.mappings = r.mappings;
          entry.good.echoSpans = r.echoSpans ?? [];
          entry.good.genLineStarts = lineStartsOf(r.code);
          fs.writeFileSync(entry.mirrorPath, r.code);
        }
      }

      // Index every mirror face by its URI so a diagnostic's secondary
      // locations — which may point into a different file — map back to
      // source. relatedInformation now rides the diagnostic PULL itself
      // (the capability advertised at handshake), so there is no second
      // pass and no cross-frontend byte-matching: the secondary spans
      // come from the same tsgo response as their primary.
      const uriToEntry = new Map();
      for (const [fp, e] of compiled) uriToEntry.set(e.mirrorUri, { good: e.good, fsPath: fp });
      // An LSP relatedInformation item ({ location: { uri, range }, message },
      // generated coordinates) → { file, line, character, endCharacter } on
      // .rip source. The generated range maps through the face's own tables;
      // a cross-line source span (rare for a "declared here") falls back to
      // the identifier width at the start, keeping the frame single-line.
      const mapRelated = (ri) => {
        if (!ri.location?.range) return null;
        const target = uriToEntry.get(ri.location.uri);
        if (!target) return null;
        const g = target.good;
        const startOff = positionToOffset(g.genLineStarts, g.code.length, ri.location.range.start);
        const endOff = positionToOffset(g.genLineStarts, g.code.length, ri.location.range.end);
        const span = generatedSpanToSource(g.mappings, startOff, Math.max(startOff, endOff));
        if (!span) return null;
        const sp = offsetToPosition(g.srcLineStarts, span[0]);
        const ep = offsetToPosition(g.srcLineStarts, span[1]);
        let endCharacter;
        if (ep.line === sp.line && ep.character > sp.character) {
          endCharacter = ep.character;
        } else {
          const lineText = g.source.split('\n')[sp.line] ?? '';
          const identifier = identifierRunAt(lineText, sp.character);
          endCharacter = identifier?.end ?? sp.character + 1;
        }
        return { file: target.fsPath, line: sp.line, character: sp.character, endCharacter, message: ri.message };
      };

      // ── OPEN ALL FINAL FACES ── so cross-file imports resolve to the
      // pinned faces before any diagnostics are pulled.
      for (const [, entry] of compiled) {
        tsgo.notify('textDocument/didOpen', { textDocument: { uri: entry.mirrorUri, languageId: 'typescript', version: 1, text: entry.good.code } });
      }

      // ── PULL + MAP ── one request per file (tsgo answers when the
      // program is ready — deterministic, no settle). Map back, apply the
      // @ts-expect-error semantics, silence rip.noCheck paths.
      for (const [fsPath, entry] of compiled) {
        if (isNoCheckPath(fsPath, entry.cfg._configDir, entry.cfg.noCheck)) continue;
        let pulled;
        try { pulled = await tsgo.request('textDocument/diagnostic', { textDocument: { uri: entry.mirrorUri } }); }
        catch (err) {
          // A pull can reject (the cold first pull warms the whole program
          // and may hit the request timeout, or tsgo dies mid-run). That
          // file went unchecked — mark the run short rather than let a
          // dropped file read as clean.
          incompleteCheck = true;
          console.error(`rip check: could not pull diagnostics for ${path.relative(process.cwd(), fsPath)} (${err.message}) — the run is incomplete`);
          continue;
        }
        const mapped = [];
        for (const d of pulled?.items ?? []) {
          const m = mapTsDiagnostic(entry.good, d);
          // Count only what strict would actually SHOW. The suppression
          // check runs before the mapping one, so a bare code test also
          // counts diagnostics that would have been dropped anyway for
          // having no source span — inflating the number several-fold and
          // promising the user diagnostics `rip.strict` would never
          // deliver. Re-map with the strict flag to ask the real question.
          if (!m && !entry.cfg.strict && mapTsDiagnostic({ ...entry.good, strict: true }, d)) {
            // Which PROJECT the hidden diagnostic belongs to — config is
            // per file, so a strict consumer's check still hides its
            // gradual dependencies' diagnostics, and a summary that says
            // "set `rip.strict`" right after the user did exactly that
            // reads as broken unless it names whose package.json is meant.
            const proj = path.relative(process.cwd(), entry.cfg._configDir ?? path.dirname(fsPath)) || '.';
            const uninstalledAt = d.code === 2307
              ? declaredButUninstalled(/Cannot find module '([^']+)'/.exec(d.message)?.[1], path.dirname(fsPath)) : null;
            if (uninstalledAt) { hiddenUninstalled++; hiddenUninstalledDirs.add(path.relative(process.cwd(), uninstalledAt) || '.'); }
            else if (IMPLICIT_ANY_CODES.has(d.code)) { hiddenAnnotations++; hiddenAnnotationDirs.add(proj); }
            else if (MISSING_TYPES_CODES.has(d.code)) {
              hiddenMissingTypes++;
              const name = /Cannot find name '([^']+)'/.exec(d.message)?.[1];
              if (name) missingTypeNames.add(name);
            }
            // Held by the declaration-scope gate: the author annotated
            // nothing here, so nothing is asked of them.
            else { hiddenScope++; hiddenScopeDirs.add(proj); }
          }
          if (!m) continue;
          // The diagnostic carries its own relatedInformation (secondary
          // "declared here" locations), each mapped from its generated
          // span back to .rip source.
          m.related = (d.relatedInformation ?? []).map(mapRelated).filter(Boolean);
          mapped.push(m);
        }
        for (const m of applyRipDirectives(entry.good, mapped)) {
          tsDiags.push({
            file: fsPath, severity: m.severity, code: m.code, message: m.message,
            line: m.range.start.line, character: m.range.start.character,
            endLine: m.range.end.line, endCharacter: m.range.end.character,
            related: m.related ?? [],
          });
        }
      }
    } finally {
      await session.client.stop().catch(() => {});
    }
  }
}

// ── report ──────────────────────────────────────────────────────────
// Error (1) and Warning (2) are the type gate; Info/Hint (3/4) — the
// unused/deprecated fade classes — are not failures and stay out of the
// report, matching `tsc --noEmit` semantics.
const rows = [...parseDiags, ...tsDiags].filter((r) => (r.severity ?? 1) <= 2);
rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.character - b.character);
const errorCount = rows.filter((r) => r.severity === 1).length;
const warningCount = rows.filter((r) => r.severity === 2).length;
const SEV = { 1: 'error', 2: 'warning' };

if (asJson) {
  console.log(JSON.stringify(rows.map((r) => ({
    file: path.relative(process.cwd(), r.file),
    line: r.line + 1, column: r.character + 1,
    endLine: r.endLine + 1, endColumn: r.endCharacter + 1,
    severity: SEV[r.severity], code: r.code ?? null, message: r.message,
    ...((r.related?.length) ? { related: r.related.map((x) => ({ file: path.relative(process.cwd(), x.file), line: x.line + 1, column: x.character + 1, message: x.message })) } : {}),
  })), null, 2));
} else {
  // Match `tsc --pretty`: `file:line:col - error TSxxxx: message`, a blank
  // line, a reverse-video line-number gutter with the source line, an
  // aligned `~~~` underline, then a `Found N errors …` summary.
  // Colors chosen to byte-match `tsc --pretty`: bright cyan file, bright
  // yellow line/col (colored separately), gray ` TS<code>: `, bright red
  // squiggle, reverse-video gutter.
  const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
  const paint = (c, s) => (useColor ? `\x1b[${c}m${s}\x1b[0m` : s);
  const cyan = (s) => paint('96', s);     // file paths (header)
  const yellow = (s) => paint('93', s);   // line / col
  const gray = (s) => paint('90', s);     // the TSxxxx code + summary :line
  const invert = (s) => paint('7', s);    // the gutter "box"
  const sevPaint = (sev, s) => paint(sev === 1 ? '91' : '93', s); // error red / warning yellow
  const rel = (f) => path.relative(process.cwd(), f);
  const sourceLines = new Map();
  const linesOf = (fsPath) => {
    if (!sourceLines.has(fsPath)) {
      const g = compiled.get(fsPath)?.good;
      sourceLines.set(fsPath, (g ? g.source : (() => { try { return fs.readFileSync(fsPath, 'utf8'); } catch { return ''; } })()).split('\n'));
    }
    return sourceLines.get(fsPath);
  };

  for (const r of rows) {
    const loc = `${cyan(rel(r.file))}:${yellow(String(r.line + 1))}:${yellow(String(r.character + 1))}`;
    const code = gray(r.code != null ? ` TS${r.code}: ` : ': '); // tsc wraps the whole ` TSxxxx: ` segment
    const message = r.message.replace(/\n/g, '\n  '); // indent continuation lines
    console.log(`${loc} - ${sevPaint(r.severity, SEV[r.severity])}${code}${message}`);
    if (showFrames) {
      const text = linesOf(r.file)[r.line] ?? '';
      const num = String(r.line + 1);
      const underEnd = r.endLine === r.line ? Math.max(r.endCharacter, r.character + 1) : text.length;
      // Leading spaces + tildes share one color span, as tsc emits it.
      const squiggle = sevPaint(r.severity, ' '.repeat(r.character) + '~'.repeat(Math.max(1, underEnd - r.character)));
      console.log('');
      console.log(`${invert(num)} ${text}`);
      console.log(`${invert(' '.repeat(num.length))} ${squiggle}`);
      console.log('');
    }
    // Secondary "declared here"-style locations (from the diagnostic's
    // relatedInformation, mapped to .rip source): tsc-style — an indented
    // location line, then, with frames, an indented frame with a cyan
    // underline.
    for (const rr of r.related ?? []) {
      console.log(`  ${cyan(rel(rr.file))}:${yellow(String(rr.line + 1))}:${yellow(String(rr.character + 1))} - ${rr.message}`);
      if (showFrames) {
        const rtext = linesOf(rr.file)[rr.line] ?? '';
        const rnum = String(rr.line + 1);
        const rsquiggle = paint('96', ' '.repeat(rr.character) + '~'.repeat(Math.max(1, rr.endCharacter - rr.character)));
        console.log(`    ${invert(rnum)} ${rtext}`);
        console.log(`    ${invert(' '.repeat(rnum.length))} ${rsquiggle}`);
        console.log('');
      }
    }
  }

  // Summary, tsc-shaped. Errors drive the count; the file table appears
  // (as tsc does) only when errors span more than one file.
  const errorRows = rows.filter((r) => r.severity === 1);
  const perFile = new Map(); // fsPath → { count, firstLine }
  for (const r of errorRows) {
    const e = perFile.get(r.file) ?? { count: 0, firstLine: r.line + 1 };
    e.count += 1;
    perFile.set(r.file, e);
  }
  if (!showFrames && rows.length) console.log(''); // compact mode has no trailing blank

  if (errorCount === 0) {
    // A run where tsgo never started type-checked nothing — the stderr
    // note already said so; don't print a false "no type errors" clean.
    if (tsgoUnavailable || incompleteCheck) { /* coverage was short — no clean "✓" to claim (a per-file note already went to stderr) */ }
    else if (warningCount === 0) console.log(paint('32', '✓ No type errors') + gray(` (${compiled.size} file${compiled.size === 1 ? '' : 's'} checked)`));
    else console.log(`Found ${warningCount} warning${warningCount === 1 ? '' : 's'}.`);
  } else if (perFile.size === 1) {
    const [f, info] = [...perFile][0];
    console.log(errorCount === 1
      ? `Found 1 error in ${rel(f)}${gray(':' + info.firstLine)}`
      : `Found ${errorCount} errors in the same file, starting at: ${rel(f)}${gray(':' + info.firstLine)}`);
  } else {
    console.log(`Found ${errorCount} errors in ${perFile.size} files.`);
    console.log('');
    console.log('Errors  Files');
    // tsc leaves the filename PLAIN here (only the `:line` is gray).
    for (const [f, info] of perFile) {
      console.log(`${String(info.count).padStart(6)}  ${rel(f)}${gray(':' + info.firstLine)}`);
    }
  }
  // Named once, at the end, whatever the run's verdict — a clean run that
  // hid 2,000 diagnostics is exactly the case where saying nothing
  // misleads most. Three lines because the remedies differ — annotate a
  // declaration, flip the mode, install declarations — and the strict
  // remedy is SPELLED IDENTICALLY on both lines that offer it: a summary
  // wording one lever two ways reads as two levers.
  const plural = (n) => (n === 1 ? '' : 's');
  // The projects a family's hidden diagnostics live in, minus the home
  // project — "set `rip.strict`" must point at the right package.json when
  // the hiding happens in a dependency the target does not govern.
  const inProjects = (dirs) => {
    const named = [...dirs].filter((d) => d !== '.').sort();
    if (!named.length) return '';
    return ` (${named.slice(0, 3).join(', ')}${named.length > 3 ? ` and ${named.length - 3} more` : ''})`;
  };
  if (hiddenAnnotations > 0 || hiddenMissingTypes > 0 || hiddenScope > 0 || hiddenUninstalled > 0) console.log('');
  if (hiddenScope > 0) {
    console.log(gray(`${hiddenScope} diagnostic${plural(hiddenScope)} hidden in unannotated code${inProjects(hiddenScopeDirs)} `
      + `— annotate a declaration to check its scope, or set \`rip.strict\` in package.json`));
  }
  if (hiddenAnnotations > 0) {
    console.log(gray(`${hiddenAnnotations} annotation diagnostic${plural(hiddenAnnotations)} hidden${inProjects(hiddenAnnotationDirs)} `
      + `— set \`rip.strict\` in package.json to see where annotations are missing`));
  }
  if (hiddenUninstalled > 0) {
    const dirs = [...hiddenUninstalledDirs].sort();
    const shown = dirs.slice(0, 3).join(', ') + (dirs.length > 3 ? ` and ${dirs.length - 3} more` : '');
    console.log(gray(`${hiddenUninstalled} uninstalled-dependency import${plural(hiddenUninstalled)} hidden `
      + `— run \`bun install\` in ${shown}`));
  }
  if (hiddenMissingTypes > 0) {
    const names = [...missingTypeNames].sort();
    const shown = names.slice(0, 4).map((n) => `\`${n}\``).join(', ');
    const more = names.length > 4 ? ` and ${names.length - 4} more` : '';
    const about = names.length ? ` — no declarations for ${shown}${more}` : '';
    console.log(gray(`${hiddenMissingTypes} missing-types advisor${hiddenMissingTypes === 1 ? 'y' : 'ies'} hidden`
      + `${about} (try \`bun add -d @types/bun\`)`));
  }
}

// Exit: 1 on type errors; 2 when the run could not cover what was asked —
// tsgo never started, or a file could not be read / pulled (never a clean 0
// on incomplete coverage); else 0.
process.exit(errorCount > 0 ? 1 : ((tsgoUnavailable || incompleteCheck) ? 2 : 0));
