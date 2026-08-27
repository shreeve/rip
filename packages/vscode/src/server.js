// The Rip language server: document sync, per-buffer compilation through
// the compiler's compile() TS face, a WORKSPACE-ROOTED TypeScript project (the budget: one
// tsgo program over a disk-mirror tree materialized DEMAND-DRIVEN from
// the import closure of open buffers, so cross-file imports resolve and
// the user's tsconfig/@types govern), and a broker to the TypeScript 7
// native LSP server (tsgo). Positions translate through MappingStore in
// both directions, so hover and diagnostics land on .rip source.
//
// Runs on Bun, spawned by the client shell (src/extension.js).
//
// The project model:
//   - Mirror tree: <workspace>/.rip/editor/<rel-path>.rip.ts carries the
//     last-compiled TS face of every .rip file the program NEEDS — the
//     open buffers plus their transitive .rip imports (the closure),
//     materialized on demand and kept fresh by open-buffer refreshes and
//     the watched-files handler. Never an unconditional whole-workspace
//     pass: standard language-server whole-project semantics,
//     demand-driven materialization. The tree is a regenerable,
//     self-gitignoring cache (never a shipping artifact — the strip
//     gate stands).
//   - Persistent cache: the mirror tree survives restarts; a manifest
//     (.cache.json) keys every mirror by its source text's hash AND the
//     compiler build's hash, so a restart recompiles only what changed —
//     and a compiler upgrade invalidates the whole tree.
//   - Imports come from the compiler's OWN stores (import/export nodes'
//     `source` roles — exact source spans), never from scanning
//     generated text.
//   - Generated tsconfig at the mirror root: extends the workspace's
//     tsconfig.json when present (the user's lib/target/strictness
//     govern); inferred-project-like defaults otherwise. types:["*"]
//     restores the classic visible-@types enumeration TS 6/7 dropped,
//     unless the user's config sets `types` itself. rootDirs merges the
//     mirror tree with the real workspace so .rip files can import real
//     .ts siblings.
//   - Open buffers OVERLAY their mirrors via didOpen/didChange (the
//     overlay governs over stale disk bytes); closure files serve
//     from their last-compiled face on disk; closing a buffer falls back
//     to its mirror.
//   - Unwritable/nonexistent workspace roots fall back to a temp mirror
//     root: cross-file resolution keeps working (mirrors group there);
//     tsconfig/@types fidelity honestly degrades (nothing to read).
//
// Staleness policy (the staleness policy): while the
// buffer fails to compile, published diagnostics are REPLACED by the
// parse diagnostic alone (stale TS diagnostics withdraw — positions from
// two buffer versions never mix), the virtual TS doc keeps its last good
// text, and hover serves from the last good compile ONLY where
// coordinates verifiably align (staleOffsetMap: common prefix/suffix of
// the two texts; the changed middle region answers null). Full
// error-tolerant parsing remains out of scope.

import {
  createConnection, TextDocuments, TextDocumentSyncKind, ProposedFeatures,
  CompletionTriggerKind, DidChangeWatchedFilesNotification, FileChangeType,
  ResponseError, ErrorCodes, SemanticTokensBuilder,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTsgo } from './tsgo.js';
import { buildProbe, parseProbeHover } from './pins.js';
import { hashText, cacheIdentityOf } from './hash.js';
import {
  lineStartsOf, offsetToPosition, positionToOffset,
  sourceOffsetToGenerated, sourceOffsetToGeneratedExact, sourceCursorToGenerated, sourceSlotToGenerated, generatedSpanToSource,
  generatedEditSpanToSource, generatedInsertionToSource, insertionAboveAttachedDirectives,
  isNocheckDirectiveRow, wholeImportLinesEdit, importLineSpanEdit, exactSpanMapper,
  staleOffsetMap, isScaffoldingLabel, scrubFaceArtifacts, ripImportText,
  noUserSymbolSpans, inNoUserSymbolSpan, memberDeclKind,
  SUPPRESSED_TS_CODES, SCAFFOLD_HOVER,
} from './translate.js';
import { mapTsDiagnostic, applyRipDirectives, isNoCheckPath, compileErrorInfo } from './diagnostics.js';
import { scopeGateOf, typedExportsOf, typedImportsOf } from './scopes.js';
import { generatedMirror as buildGeneratedMirror, projectWrapper, nearestTsconfig, HOST_FLOOR_NAME, mirrorRelForFsPath, ripImportsOf, scanExportNames, stubFacesFromScans, linkNestedNodeModules, configEarnsBoundary, appStashSpecFor, closureImportsOf, isStdlibPath, anchorStdlib } from './mirror.js';

// The compiler: in-repo development resolves the repository's src/;
// the staged .vsix carries a copy at compiler/src/ (scripts/package.js).
// The cache key spans the compiler tree AND this server's own tree
// (recursive — nested runtime/ fragments included): the manifest caches
// faces the compiler built and closure edge lists THIS code derived, so
// either tree changing has to purge it.
//
// Installed, the identity is READ rather than computed, because the vsix
// is not byte-identical to the source it was built from — packaging
// bundles this server and trims the compiler copy. Hashing the artifact
// would answer a different question than `rip check --build` asks of the
// repository, and the two are meant to be COMPARED: a mismatch is how
// "the editor and rip check disagree" gets caught. So packaging records
// the source identity and the server reports it verbatim. Both trees
// still feed it — the file is written by cacheIdentityOf over the same
// pair — and a source change still changes it, so the cache purges.
async function loadCompiler() {
  const candidates = [
    new URL('../../../src/compile.js', import.meta.url),   // in-repo
    new URL('../compiler/src/compile.js', import.meta.url), // staged vsix
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(fileURLToPath(candidate))) {
      compilerDir = path.dirname(fileURLToPath(candidate));
      const stamped = fileURLToPath(new URL('../build-identity', import.meta.url));
      cacheIdentity = fs.existsSync(stamped)
        ? fs.readFileSync(stamped, 'utf8').trim()
        : cacheIdentityOf(
          compilerDir,
          path.dirname(fileURLToPath(import.meta.url)),
        );
      return (await import(candidate.href)).compile;
    }
  }
  throw new Error('rip compiler not found (looked for ../../../src/compile.js and ../compiler/src/compile.js)');
}

// The declaration-scope gate (scopes.js) reads the compile's own token tape
// — the tokens the parse consumed, which is exactly the code the face
// carries — so the gate and the face describe one text, and the editor
// and `rip check` gate the same text. Two consequences of "the same
// compile": a `__DATA__` payload is not code (it seeds no binding and
// holds no annotation), and an open buffer's TOLERANT compile gates its
// recovered face — mid-edit, an unclosed bracket leaves the file gated
// like any other, not thrown open. The gate needs TYPE tokens: a text
// scan cannot tell the annotation `x: T = v` from the object literal
// `{ x: T }`, and reading the wrong one would gate the wrong declarations.
// Fails OPEN: a gate scopes.js cannot build leaves it undefined, and an
// undefined gate publishes everything. Failing CLOSED would be an empty
// annotation set — which reads as "no declaration is annotated",
// silencing the entire file, and a silent file is indistinguishable from
// a clean one.
function scopeGateFor(source, face, typedImports) {
  try { return scopeGateOf(face.tokens, source, face, typedImports); }
  catch { return undefined; }
}

// readProjectConfig rides the same dual-path resolution as compile
// (in-repo src/ or the staged vsix copy). Absent (older staged
// compiler): a no-op reader — every project non-strict, no throw.
async function loadProjectConfigReader() {
  const candidates = [
    new URL('../../../src/config.js', import.meta.url),
    new URL('../compiler/src/config.js', import.meta.url),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(fileURLToPath(candidate))) {
      return (await import(candidate.href)).readProjectConfig;
    }
  }
  return () => ({ strict: false, noCheck: [], _configDir: null });
}

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let compile = null;
let readProjectConfig = null;
let tsgo = null;
let tsgoReady = null;
let tsgoLaunches = 0;
let shuttingDown = false;

// The project roots (established at initialize).
let workspaceRoot = null;        // the client workspace's fsPath, or null
let mirrorRoot = null;           // where mirrors + the generated tsconfig live
let mirrorRootReal = null;       // realpath twin when it differs (symlinked root)
let mirrorRootIsFallback = false; // temp-dir mirror root (workspace unwritable/absent)
let mirrorRootReady = false;     // lazily created on first materialization
let clientSupportsWatchers = false;
let clientDefinitionLinks = false;
let clientSupportsConfiguration = false;
let clientInitialized = false;   // the initialize handshake has COMPLETED (onInitialized)
let cacheIdentity = null;        // compiler build + server build (cache keying)
let compilerDir = null;          // where the compiler resolved from (in-repo vs staged) — the ready log names it

// rip document uri → per-buffer state.
const states = new Map();

// The demand-driven closure: which disk .rip files are materialized
// this session (fsPath → { sourceHash }), and which import targets were
// missing from disk when an importer compiled — a watched Created event
// for one of those pulls it into the program.
const materializedMirrors = new Map();
const pendingImports = new Set();

// The persistent face cache manifest (.cache.json at the mirror root):
// absolute source path → { sourceHash, imports }. Valid only under the
// manifest's recorded cacheIdentity — a compiler OR server upgrade purges
// the tree. The field is deliberately not the old `compilerHash` name:
// a manifest written before the key widened carries no cacheIdentity,
// mismatches on read, and purges — which is exactly right, since its
// edge lists were derived by the narrower rule.
let cacheManifest = { cacheIdentity: null, entries: {} };
let manifestDirty = false;
let manifestTimer = null;

const manifestPath = () => path.join(mirrorRoot, '.cache.json');

function saveManifestNow() {
  if (!manifestDirty || !mirrorRoot) return;
  manifestDirty = false;
  try {
    fs.writeFileSync(manifestPath(), JSON.stringify(cacheManifest));
  } catch { /* cache only — never fatal */ }
}

function scheduleManifestSave() {
  manifestDirty = true;
  clearTimeout(manifestTimer);
  manifestTimer = setTimeout(saveManifestNow, 500);
}

function detectWorkspaceRoot(params) {
  const uri = params.workspaceFolders?.[0]?.uri ?? params.rootUri;
  if (!uri || !uri.startsWith('file://')) return null;
  try { return fileURLToPath(uri); } catch { return null; }
}

// The mirror root: workspace-local (.rip/editor — inside the workspace so
// node_modules/@types resolution walks find the user's packages), or a
// temp fallback when the workspace root is unwritable or does not exist.
// Initialize only PLANS the path; nothing touches disk until the first
// materialization (ensureMirrorRoot) — a session that never opens a .rip
// document leaves the workspace untouched.
function planMirrorRoot() {
  if (workspaceRoot) {
    mirrorRoot = path.join(workspaceRoot, '.rip', 'editor');
    mirrorRootIsFallback = false;
  } else {
    mirrorRoot = null;
    mirrorRootIsFallback = true;
  }
}

// Write OUR file only when absent or drifted from our content. Never
// used on user-owned paths — the self-gitignore lives INSIDE the
// extension-owned mirror root (.rip/editor/.gitignore, `*` covering the
// tree and itself); a user's .rip/.gitignore is theirs and is never
// touched.
function ensureOwnedFile(filePath, content) {
  try { if (fs.readFileSync(filePath, 'utf8') === content) return; } catch { /* absent */ }
  fs.writeFileSync(filePath, content);
}

// tsgo realpaths module-resolution results, so an answer can spell the
// mirror root through its resolved form (a temp root under macOS /var →
// /private/var, a workspace reached through a symlink) while the server
// spells it as configured. Both spellings name the same tree, so the
// realpath twin is recorded once the root exists and containment checks
// accept either.
function recordMirrorRootReal() {
  try { mirrorRootReal = fs.realpathSync(mirrorRoot); } catch { mirrorRootReal = null; }
  if (mirrorRootReal === mirrorRoot) mirrorRootReal = null;
}

// The mirror-relative path of a file under the mirror tree — either
// spelling — or null. The ONE containment test: every "is this inside
// the mirror?" ask goes through here, so the symlink rule cannot drift
// between consumers.
function mirrorRelOf(fsPath) {
  for (const root of [mirrorRoot, mirrorRootReal]) {
    if (root && fsPath.startsWith(root + path.sep)) return path.relative(root, fsPath);
  }
  return null;
}

function ensureMirrorRoot() {
  if (mirrorRootReady) return;
  if (workspaceRoot && !mirrorRootIsFallback) {
    try {
      fs.mkdirSync(mirrorRoot, { recursive: true });
      ensureOwnedFile(path.join(mirrorRoot, '.gitignore'), '*\n');
      writeGeneratedTsconfig();
      recordMirrorRootReal();
      mirrorRootReady = true;
      return;
    } catch (err) {
      connection.console.error(
        `[rip] workspace mirror root unavailable (${err.message}) — using a temp fallback (tsconfig/@types fidelity degrades)`,
      );
    }
  }
  mirrorRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-lsp-'));
  mirrorRootIsFallback = true;
  writeGeneratedTsconfig();
  recordMirrorRootReal();
  mirrorRootReady = true;
}

function* walkFiles(dir, suffix) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      yield* walkFiles(path.join(dir, entry.name), suffix);
    } else if (entry.name.endsWith(suffix)) {
      yield path.join(dir, entry.name);
    }
  }
}

// Load the persistent cache: a manifest recorded under a DIFFERENT
// build invalidates the whole tree — every cached face was produced by
// a compiler that no longer exists here, and every recorded import list
// by a closure walk that may no longer agree. Read-only unless a purge
// is due — a fresh session creates nothing.
function loadCache() {
  if (!mirrorRoot) {
    cacheManifest = { cacheIdentity, entries: {} };
    return;
  }
  try {
    const loaded = JSON.parse(fs.readFileSync(manifestPath(), 'utf8'));
    if (loaded?.cacheIdentity === cacheIdentity && loaded.entries) {
      cacheManifest = loaded;
      return;
    }
    // A manifest from another build: purge the tree it keyed.
    for (const mirror of walkFiles(mirrorRoot, '.rip.ts')) {
      try { fs.rmSync(mirror); } catch { /* best effort */ }
    }
    cacheManifest = { cacheIdentity, entries: {} };
    scheduleManifestSave();
    return;
  } catch { /* absent or unreadable: start fresh, create nothing */ }
  cacheManifest = { cacheIdentity, entries: {} };
}

// JSONC → parseable JSON (comments stripped).
// The user's resolved `extends` chain, recorded by generatedMirror
// (below) so the watcher can re-govern when a chain member changes.
const userConfigChain = new Set();

// The generated mirror-root files (tsconfig + host floor) — the pure
// builder lives in mirror.js (shared with the batch `rip check`); here
// it is fed the server's workspace/fallback state and its config-chain
// set.
function generatedMirror() {
  return buildGeneratedMirror({
    workspaceRoot, mirrorRootIsFallback, chain: userConfigChain,
    excludeDirs: [...wrapperDirs.keys()],
    onUnresolved: (spec) =>
      connection.console.log(`[rip] tsconfig extends "${spec}" not resolvable — not injecting types:["*"]`),
  });
}

// Workspace-relative dirs that own a nested `tsconfig.json` and have a
// generated wrapper mirroring them, each with its OWN source tsconfig
// and resolved extends chain. tsgo assigns each face to its NEAREST
// config, so these partition the mirror by project inside the one tree
// and the one session; the root config excludes them so no face has two
// owners. The chain is per-project — never the shared root set, whose
// builder clears and refills it — so the watcher can match a mid-session
// edit to a nested config (or any member of its chain) to the one
// wrapper it re-governs.
const wrapperDirs = new Map(); // rel → { sourceTsconfig, chain: Set }

// Build and write one project wrapper (tsconfig + host floor) from its
// source config, recording its chain. Returns the wrapper paths written.
// Shared by first generation and by the watcher's re-govern — the same
// files, the same builder, whichever event asks.
function writeProjectWrapper(rel, sourceTsconfig) {
  const wrapperDir = path.join(mirrorRoot, rel);
  const chain = new Set();
  const wrapper = projectWrapper({
    wrapperDir, sourceTsconfig, sourceDir: sourceTsconfig === null ? path.join(workspaceRoot, rel) : null,
    workspaceRoot, mirrorRoot, chain,
    onUnresolved: (spec) =>
      connection.console.log(`[rip] ${rel}: tsconfig extends "${spec}" not resolvable — not injecting types:["*"]`),
  });
  wrapperDirs.set(rel, { sourceTsconfig, chain });
  fs.mkdirSync(wrapperDir, { recursive: true });
  const written = [];
  for (const [name, text] of [['tsconfig.json', JSON.stringify(wrapper.tsconfig, null, 2)], [HOST_FLOOR_NAME, wrapper.hostFloorDts]]) {
    const at = path.join(wrapperDir, name);
    ensureOwnedFile(at, text);
    written.push(at);
  }
  return written;
}

// Give `fsPath`'s owning project its wrapper, if it has one and does not
// yet. Returns the mirror paths written — a new wrapper also rewrites the
// ROOT config (its exclusions grew), so callers forward all of them to
// tsgo or the new project's files stay in the root's program.
// The AUTO BOUNDARY: a package that DECLARES globals (`globalThis.NAME
// ??=` at top level) becomes its own program without owning a tsconfig,
// so its vocabulary stays package-scoped — reaching importers the way the
// runtime does, and leaving a non-importing neighbor its cannot-find. A
// nested tsconfig outranks it (that wrapper already partitions), and the
// workspace root has no narrower scope to give. Idempotent; returns every
// mirror path the ensure wrote — the wrapper files plus the regenerated
// root config, whose exclusions grew — for the caller to forward to tsgo.
function ensureAutoBoundary(fsPath) {
  if (mirrorRootIsFallback || !workspaceRoot || !mirrorRootReady) return [];
  let dir = path.dirname(fsPath);
  let pkgDir = null;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) { pkgDir = dir; break; }
    if (dir === workspaceRoot || path.dirname(dir) === dir) break;
    dir = path.dirname(dir);
  }
  if (pkgDir === null || pkgDir === workspaceRoot) return [];
  // A tsconfig AT or BELOW the package already partitions it (that wrapper
  // reads its posture from the package's own directory). One ABOVE it does
  // not — the wrapper's posture is the wrapper's — so a flipped package
  // below a wrapped project still earns its boundary.
  const owner = nearestTsconfig(path.dirname(fsPath), workspaceRoot);
  if (owner !== null) {
    const ownerDir = path.dirname(owner);
    if (ownerDir === pkgDir || ownerDir.startsWith(pkgDir + path.sep)) return [];
  }
  const rel = path.relative(workspaceRoot, pkgDir);
  if (rel === '' || path.isAbsolute(rel) || rel === '..' || rel.startsWith('..' + path.sep)) return [];
  if (wrapperDirs.has(rel)) return [];
  let written;
  try { written = writeProjectWrapper(rel, null); } catch (err) {
    connection.console.error(`[rip] auto boundary for ${rel} failed: ${err.message}`);
    return [];
  }
  writeGeneratedTsconfig();
  written.push(path.join(mirrorRoot, 'tsconfig.json'), path.join(mirrorRoot, HOST_FLOOR_NAME));
  connection.console.log(`[rip] ${rel}: the package becomes its own program (declared globals, a mode flip against its parent, or its own installed types)`);
  return written;
}

function ensureProjectWrapper(fsPath) {
  if (mirrorRootIsFallback || !workspaceRoot || !mirrorRootReady) return [];
  const owner = nearestTsconfig(path.dirname(fsPath), workspaceRoot);
  if (owner === null || path.dirname(owner) === workspaceRoot) return [];
  const rel = path.relative(workspaceRoot, path.dirname(owner));
  // TERRITORY, belt and braces: a rel that is empty, absolute, or
  // '..'-shaped would walk the wrapper write out of the mirror root —
  // nearestTsconfig's anchor bound makes this unreachable today, but a
  // wrapper is a WRITE, and no future rel construction gets to escape
  // `.rip/editor` by accident. (The doctrine the disk-layer hygiene
  // gates enforce: writes stay inside `.rip/`.)
  if (rel === '' || path.isAbsolute(rel) || rel === '..' || rel.startsWith('..' + path.sep)) return [];
  if (wrapperDirs.has(rel)) return [];
  let written;
  try {
    written = writeProjectWrapper(rel, owner);
  } catch (err) {
    wrapperDirs.delete(rel);
    connection.console.error(`[rip] wrapper for ${rel} not generated (${err.message}) — its files keep the root config`);
    return [];
  }
  writeGeneratedTsconfig();
  written.push(path.join(mirrorRoot, 'tsconfig.json'));
  connection.console.log(`[rip] per-project tsconfig: ${rel} now extends its own config`);
  return written;
}

// Idempotent: an unchanged file never rewrites (no spurious mtime for
// tsgo to reload on). The host floor is written even when inactive —
// always-present, content varies — so a gate flip is a plain Changed
// event with no create/delete lifecycle.
function writeGeneratedTsconfig() {
  const mirror = generatedMirror();
  ensureOwnedFile(path.join(mirrorRoot, 'tsconfig.json'), JSON.stringify(mirror.tsconfig, null, 2));
  ensureOwnedFile(path.join(mirrorRoot, HOST_FLOOR_NAME), mirror.hostFloorDts);
}

// A .rip uri's mirror path: workspace files keep their relative structure
// (relative imports between mirrors resolve exactly as between sources);
// files outside the workspace (or non-file URIs) mirror under
// __external__ so distinct buffers never collide.
function mirrorPathOf(uri) {
  const rel = uri.startsWith('file://')
    ? mirrorRelForFsPath(fileURLToPath(uri), workspaceRoot)
    : path.join('__external__', uri.replace(/[^A-Za-z0-9._-]+/g, '_'));
  return path.join(mirrorRoot, rel) + '.ts';
}

// Atomic: a crash mid-write must never leave a partial mirror that the
// hash-keyed cache would later trust (the manifest's codeHash is the
// second guard — revalidation verifies the bytes).
function writeMirror(mirrorPath, code) {
  fs.mkdirSync(path.dirname(mirrorPath), { recursive: true });
  const tmp = mirrorPath + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, code);
  fs.renameSync(tmp, mirrorPath);
}

// Case-collision guard: on a case-insensitive file system two sources
// differing only in case — or two __external__ paths whose sanitization
// coincides — land on ONE mirror, and one face silently shadows the
// other. A path-hash suffix on mirror names is not an option (the
// mirror NAME is the resolution mechanism: `./util.rip` resolves to the
// adjacent `util.rip.ts`), so the guard detects and warns loudly.
const mirrorOwners = new Map(); // lowercased mirror path → owning source
function warnOnMirrorCollision(mirrorPath, source) {
  const key = mirrorPath.toLowerCase();
  const owner = mirrorOwners.get(key);
  if (owner && owner !== source) {
    connection.console.error(
      `[rip] mirror collision: ${source} and ${owner} map to the same mirror (${mirrorPath}) — one face shadows the other`,
    );
  }
  mirrorOwners.set(key, source);
}

// tsgo lifecycle: launch, watch for death, RESTART ONCE, then stay
// degraded (recorded policy — a second unexpected exit means something
// environmental; parse diagnostics keep working either way, and hover/
// TS-diagnostics answer null/absent with a logged notice, never a write
// to a dead stdin — LspClient fails fast once its child exits). The
// mirror tree lives on disk, so a restarted tsgo rebuilds the same
// program; only the open-buffer overlays need re-opening (refresh does).
// What the broker declares to tsgo. The feature handlers consume
// exactly these shapes: resolve-lazy completion items, literal code
// actions, prepare-supported rename, relative-encoded semantic tokens.
const TSGO_CLIENT_CAPABILITIES = {
  textDocument: {
    hover: { contentFormat: ['markdown', 'plaintext'] },
    // tagSupport rides the PULL slot: the broker pulls diagnostics
    // (textDocument/diagnostic), and tsgo keys tag emission on
    // diagnostic.tagSupport — declared there, unused/deprecated items
    // arrive tagged from tsgo itself (probed against the pinned
    // tsgo). The push-slot
    // twin covers anything tsgo ever publishes.
    publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] } },
    diagnostic: { tagSupport: { valueSet: [1, 2] } },
    synchronization: { didSave: true },
    completion: {
      contextSupport: true,
      completionItem: {
        snippetSupport: false,
        labelDetailsSupport: true,
        resolveSupport: { properties: ['detail', 'documentation', 'additionalTextEdits'] },
      },
    },
    signatureHelp: {
      contextSupport: true,
      signatureInformation: {
        parameterInformation: { labelOffsetSupport: true },
        activeParameterSupport: true,
        documentationFormat: ['markdown', 'plaintext'],
      },
    },
    definition: {},
    typeDefinition: {},
    implementation: {},
    references: {},
    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
    rename: { prepareSupport: true },
    codeAction: {
      codeActionLiteralSupport: {
        codeActionKind: {
          valueSet: [
            'quickfix',
            'source.organizeImports', 'source.removeUnusedImports', 'source.sortImports', 'source.fixAll',
          ],
        },
      },
    },
    semanticTokens: {
      requests: { full: true, range: true },
      tokenTypes: [
        'namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter',
        'parameter', 'variable', 'property', 'enumMember', 'event', 'function',
        'method', 'macro', 'keyword', 'modifier', 'comment', 'string', 'number',
        'regexp', 'operator', 'decorator',
      ],
      tokenModifiers: [
        'declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract',
        'async', 'modification', 'documentation', 'defaultLibrary',
      ],
      formats: ['relative'],
    },
  },
  workspace: { configuration: true, didChangeWatchedFiles: {}, symbol: {}, diagnostics: { refreshSupport: true } },
};

// The broker publishes only what it pulls, so it must accept tsgo's
// one channel for saying "my answers changed, ask again" — without
// this handler a program-wide recomputation that lands after the
// triggering batch's pulls would never publish. (Today's tsgo does
// not send it; the diagnostic pulls' generous timeout carries the
// config-flip path until it does.)
function tsgoDiagnosticRefreshRequest() {
  repullOpenDocuments();
  return null;
}

// tsgo drives preference-sensitive behavior off workspace/configuration
// answers. The broker FORWARDS tsgo's asks to the editor when the
// client declared configuration support, so the user's own typescript.*
// settings govern .rip files exactly as they do .ts files (plain-TS
// parity — VS Code ships the typescript.* contributions regardless of
// our extension); a client without configuration support answers null
// per item, which leaves tsgo's own defaults in charge.
async function tsgoConfigurationRequest(params) {
  const items = params?.items ?? [];
  if (!clientSupportsConfiguration) return items.map(() => null);
  // The handshake window: tsgo boots INSIDE this server's own
  // initialize handler and asks for configuration immediately, but the
  // editor's languageclient installs its workspace/configuration
  // handler only once the handshake completes — a forward before then
  // bounces with "Unhandled method". Answer tsgo's boot-time asks with
  // nulls directly (its own defaults, the same answer the bounce
  // produced), and save the forward — and the failure log — for
  // requests the editor can actually serve.
  if (!clientInitialized) return items.map(() => null);
  try {
    return await connection.workspace.getConfiguration(
      items.map((item) => ({
        ...(item.section !== undefined ? { section: item.section } : {}),
        ...(item.scopeUri !== undefined ? { scopeUri: item.scopeUri } : {}),
      })),
    );
  } catch (err) {
    connection.console.log(`[rip] configuration forward failed: ${err.message}`);
    return items.map(() => null);
  }
}

function launchTsgo() {
  tsgoLaunches += 1;
  let rootDir;
  if (workspaceRoot && fs.existsSync(workspaceRoot)) {
    rootDir = workspaceRoot;
  } else {
    // No usable workspace: tsgo roots at the (temp) mirror root, which
    // must exist to be a cwd. Only the fallback path materializes here —
    // a real workspace stays untouched until the first mirror write.
    ensureMirrorRoot();
    rootDir = mirrorRoot;
  }
  tsgoReady = startTsgo(rootDir, {
    clientCapabilities: TSGO_CLIENT_CAPABILITIES,
    serverRequests: {
      'workspace/configuration': tsgoConfigurationRequest,
      'workspace/diagnostic/refresh': tsgoDiagnosticRefreshRequest,
    },
  }).then(
    (session) => {
      tsgo = session;
      connection.console.log(`[rip] tsgo up: ${JSON.stringify(session.serverInfo)}`);
      session.client.exited.then(() => handleTsgoExit(session));
      return session;
    },
    (err) => {
      connection.console.error(`[rip] tsgo failed to start: ${err.message} — hover/TS diagnostics unavailable`);
      tsgo = null;
      return null;
    },
  );
  return tsgoReady;
}

function handleTsgoExit(session) {
  if (shuttingDown || tsgo !== session) return;
  tsgo = null;
  // Overlays died with the process; the next refresh re-opens them.
  for (const st of states.values()) st.tsOpen = false;
  if (tsgoLaunches < 2) {
    connection.console.error('[rip] tsgo exited unexpectedly — restarting once');
    launchTsgo().then((restarted) => {
      if (!restarted) return;
      for (const document of documents.all()) scheduleRefresh(document);
    });
  } else {
    connection.console.error('[rip] tsgo exited again — staying degraded (Rip parse diagnostics only)');
    tsgoReady = Promise.resolve(null);
  }
}

function stateOf(uri) {
  let state = states.get(uri);
  if (!state) {
    const mirrorPath = mirrorPathOf(uri);
    state = {
      mirrorPath,
      tsUri: 'file://' + mirrorPath,
      tsOpen: false,
      tsVersion: 0,
      lastGood: null,        // { source, code, mappings, srcLineStarts, genLineStarts }
      imports: null,         // this buffer's .rip import targets (closure roots)
      lastCompletion: null,  // tsgo's raw items from the newest completion (resolve reads them)
      hoverEnrich: new Map(), // version-keyed evolving-any enrichment memo
      refreshTimer: null,
      refreshRun: null,      // the debounced refresh body, so a flush runs THE SAME one
      settling: null,        // resolves when the owed refresh has finished; null when nothing is owed
      pinCache: new Map(),   // Tier 3 pins: `${name}@${valueHash}` → type text | null (probed-and-rejected)
      probing: false,        // one probe round in flight per document
    };
    states.set(uri, state);
  }
  return state;
}

// ---- the demand-driven closure: the program is the open buffers
// plus their TRANSITIVE .rip imports, materialized on demand — never an
// unconditional whole-workspace pass.

// ripImportsOf — the relative .rip import targets of a compiled file,
// read from the compiler's OWN stores — lives in mirror.js (shared with
// the batch `rip check`, which walks the same closure).

// ---- cross-file mappings: the closure cache is TEXT-only, so a
// result landing inside an UNOPENED mirror (a definition target, a
// reference site, a rename edit) recompiles its source for mappings on
// demand (~0.1 ms warm, measured; persisting mappings in the cache
// manifest is the rejected alternative). Faces are memoized by source hash
// and verified against the mirror bytes tsgo answered from — ON EVERY
// ASK, cache hits included: a mirror that drifts or corrupts AFTER
// the face warmed must not keep answering from the stale memo. A face
// that does not reproduce the mirror describes a DIFFERENT text, and
// its positions would lie, so the result drops instead.
const faceCache = new Map(); // fsPath → { sourceHash, source, code, mappings, srcLineStarts, genLineStarts }

function mirrorBytesOf(fsPath) {
  try { return fs.readFileSync(mirrorPathOf('file://' + fsPath), 'utf8'); } catch { return null; }
}

// One PLAIN face compile per (path, bytes), shared by the three sites that
// spell the identical compile — the typed-export reader, the mirror writer,
// and the disk face. On a cold open the gate reads a dependency's typed
// exports and the closure pass then mirrors the same bytes; without this
// memo that is two full compiles of every direct dependency (+57% on the
// average importing file of this repo's packages/, +131 ms on the worst).
//
// Holds full results — token tape included, the largest part of one, and
// read again whenever a face or typed-export memo misses on a hit here —
// so it is BOUNDED: recency-evicted well above the widest direct-import
// fan-out measured here (16). The open buffer's own
// compile never lands here: it rides pins/tolerant/strict options, which
// are a different compile. Every consumer receives the SAME result
// object — nothing mutates compile results today, and a consumer that
// started annotating them would corrupt its siblings.
const rawCompileCache = new Map(); // fsPath → { sourceHash, stashSpec, result }, insertion = recency
const RAW_COMPILE_CAP = 32;
function rawCompile(fsPath, source, sourceHash) {
  // The stash discovery is a COMPILE INPUT (the face splices by it), so
  // it joins the cache key — a hit on source bytes alone would keep
  // serving a face compiled before app/stash.rip appeared or vanished.
  const stashSpec = appStashSpecFor(fsPath, workspaceRoot);
  const hit = rawCompileCache.get(fsPath);
  if (hit && hit.sourceHash === sourceHash && hit.stashSpec === stashSpec) return hit.result;
  const result = compile(source, { path: fsPath, runtimeDelivery: 'inline', face: 'ts', appStashSpec: stashSpec });
  rawCompileCache.delete(fsPath);
  rawCompileCache.set(fsPath, { sourceHash, stashSpec, result });
  if (rawCompileCache.size > RAW_COMPILE_CAP) rawCompileCache.delete(rawCompileCache.keys().next().value);
  return result;
}

// A dependency's ANNOTATED exports, for the declaration-scope gate: an
// import of one carries that export's type information into the importer.
//
// Deliberately NOT served from faceOf. A face carries a gate, a gate asks
// its dependencies for this, and `a.rip` ↔ `b.rip` would recur forever.
// Typed exports are file-local — they ask only what a source says about its
// own declarations — so this path compiles and answers without ever
// building a gate, and the cycle cannot form.
//
// An OPEN buffer answers over disk, matching every other cross-file answer:
// the importer must be checked against the dependency the author is looking
// at, not the one they last saved.
const typedExportCache = new Map(); // fsPath → { sourceHash, names }
function typedExportsFor(fsPath) {
  const open = documents.get('file://' + fsPath);
  let source;
  if (open) source = open.getText();
  else { try { source = fs.readFileSync(fsPath, 'utf8'); } catch { return null; } }
  const sourceHash = hashText(source);
  const cached = typedExportCache.get(fsPath);
  if (cached && cached.sourceHash === sourceHash) return cached.names;
  let names;
  try {
    const result = rawCompile(fsPath, source, sourceHash);
    names = typedExportsOf(result.tokens, source, result);
  } catch {
    names = new Set(); // a source that will not compile types none of its importers
  }
  typedExportCache.set(fsPath, { sourceHash, names });
  return names;
}

// The local names an import bound to an annotated export, for a compile
// whose source sits in `dir`. Fails to null, like the gate itself.
function typedImportsFor(stores, source, dir) {
  if (!dir) return null;
  try { return typedImportsOf(stores, source, dir, typedExportsFor); }
  catch { return null; }
}

function faceOf(fsPath) {
  let source;
  try { source = fs.readFileSync(fsPath, 'utf8'); } catch { return null; }
  const sourceHash = hashText(source);
  const cached = faceCache.get(fsPath);
  if (cached && cached.sourceHash === sourceHash && mirrorBytesOf(fsPath) === cached.code) {
    return cached;
  }
  faceCache.delete(fsPath);
  let result;
  try {
    result = rawCompile(fsPath, source, sourceHash);
  } catch {
    return null; // the mirror serves a LAST-GOOD face this source no longer produces
  }
  if (mirrorBytesOf(fsPath) !== result.code) {
    // A mirror this compile cannot reproduce is either corruption or a
    // PINNED face that outlived its session: an open buffer's refresh
    // writes its pin-annotated face into the mirror (importers should see
    // the richer types while the buffer lives), but pins are per-session
    // probe answers, so after a restart the pin-less compile here can
    // never match those bytes — and refusing would strand every
    // cross-file ask into this file until its next edit. Only CLOSED
    // files reach faceOf, and a closed file's canonical face is exactly
    // what mirrorFromDisk writes — so re-materialize, tell tsgo, and
    // serve. A mirror that STILL disagrees after the rewrite is a write
    // failure or a collision, and that refusal stands: a face that does
    // not reproduce the mirror describes a different text, and its
    // positions would lie.
    try {
      const { mirrorPath } = mirrorFromDisk(fsPath, source);
      if (tsgo) {
        tsgo.client.notify('workspace/didChangeWatchedFiles', {
          changes: [{ uri: 'file://' + mirrorPath, type: FileChangeType.Changed }],
        });
      }
      connection.console.log(`[rip] mirror for ${fsPath} re-materialized: its bytes had drifted from the source's face`);
    } catch {
      return null; // the source no longer compiles; the mirror keeps serving last-good to tsgo
    }
    if (mirrorBytesOf(fsPath) !== result.code) {
      connection.console.log(`[rip] cross-file mapping refused for ${fsPath}: mirror bytes drifted from the source's face`);
      return null;
    }
  }
  const face = {
    sourceHash,
    source,
    code: result.code,
    mappings: result.mappings,
    stores: result.stores,
    srcLineStarts: lineStartsOf(source),
    genLineStarts: lineStartsOf(result.code),
    // The declaration-scope gate, computed once per face and cached with it
    // — the face is keyed by sourceHash, so an edit that changes which
    // declarations carry annotations rebuilds this alongside the mappings.
    checkedLines: scopeGateFor(source, result,
      typedImportsFor(result.stores, source, path.dirname(fsPath))),
  };
  faceCache.set(fsPath, face);
  return face;
}

// The inverse of mirrorPathOf for workspace files. __external__ mirrors
// have no faithful inverse (sanitized names) — their results drop.
function sourcePathOfMirror(mirrorFsPath) {
  if (!workspaceRoot || mirrorRootIsFallback) return null;
  if (!mirrorFsPath.endsWith('.rip.ts')) return null;
  const mirrorRel = mirrorRelOf(mirrorFsPath);
  if (mirrorRel === null) return null;
  const rel = mirrorRel.slice(0, -'.ts'.length);
  if (rel.split(path.sep)[0] === '__external__') return null;
  return path.join(workspaceRoot, rel);
}

// Compile one on-disk .rip into its mirror and record its cache entry
// (source hash for change detection, code hash so a crash-partial
// mirror can never pass revalidation). A compile failure leaves the
// previous mirror in place (the last-compiled face serves — the
// the staleness posture at project scale).
// The enum names a compile declares, read off the binding inventory.
const enumNamesOf = (result) =>
  (result.bindings ?? []).filter((b) => b.kind === 'enum').map((b) => b.name);

function mirrorFromDisk(fsPath, source) {
  faceCache.delete(fsPath);
  if (!mirrorRootIsFallback) linkNestedNodeModules(workspaceRoot, mirrorRoot, fsPath);
  const result = rawCompile(fsPath, source, hashText(source));
  const mirrorPath = mirrorPathOf('file://' + fsPath);
  warnOnMirrorCollision(mirrorPath, fsPath);
  writeMirror(mirrorPath, result.code);
  // A dependency that DECLARES globals or lives in a mode-flipped package
  // gets its boundary the moment its face materializes — the closure pass
  // may be the first to see it. Only INSIDE the workspace: a dependency
  // outside it (the stdlib) keeps its own posture and never earns a
  // boundary here — the same rule the CLI walker applies.
  const inWorkspace = workspaceRoot && fsPath.startsWith(workspaceRoot + path.sep);
  const depCfg = inWorkspace && readProjectConfig ? readProjectConfig(path.dirname(fsPath)) : null;
  const depEarns = depCfg?._configDir
    && configEarnsBoundary(depCfg, readProjectConfig(path.dirname(depCfg._configDir)), workspaceRoot);
  if (inWorkspace && (result.globalDecls?.length || depEarns)) {
    const bw = ensureAutoBoundary(fsPath);
    if (bw.length && tsgo) {
      tsgo.client.notify('workspace/didChangeWatchedFiles', {
        changes: bw.map((p) => ({ uri: 'file://' + p, type: FileChangeType.Changed })),
      });
    }
  }
  const imports = closureImportsOf(result.stores, source, fsPath, workspaceRoot);
  cacheManifest.entries[fsPath] = {
    sourceHash: hashText(source), codeHash: hashText(result.code), imports,
    // The stash discovery the face was compiled under — a COMPILE INPUT
    // the source bytes cannot vouch for, so revalidation compares it
    // against the live discovery (materializeClosure's cached road).
    stashSpec: appStashSpecFor(fsPath, workspaceRoot),
    // The names this module declares as enums — what an IMPORTER needs to
    // color its own uses, and the one fact it cannot compute for itself.
    // Cheap to carry (names, no spans) and invalidated with the entry; a
    // manifest written before this field existed is purged wholesale by
    // the cacheIdentity key, which a server change already moves.
    enumNames: enumNamesOf(result),
  };
  scheduleManifestSave();
  return { mirrorPath, imports };
}

// The mirror's bytes match what the cache recorded for them.
function mirrorIntact(file, entry) {
  if (!entry.codeHash) return false;
  try {
    return hashText(fs.readFileSync(mirrorPathOf('file://' + file), 'utf8')) === entry.codeHash;
  } catch {
    return false;
  }
}

// Pull `seeds` (absolute .rip paths) and their transitive imports into
// the program. Valid cache entries (source hash unchanged, mirror bytes
// intact) skip the compile and traverse their recorded imports; import
// targets missing from disk are remembered (pendingImports) so a later
// Created event pulls them in; targets resolving OUTSIDE the workspace
// truncate the closure loudly (a `../` chain must not walk the whole
// disk into __external__) — EXCEPT the stdlib tree: `rip/<pkg>`
// specifiers resolve into the one this server is anchored on, a bounded
// tree whose faces the generated tsconfig already maps by name
// (stdlibRipPaths), so materializing them completes a mapping the config
// promised rather than opening the disk walk. Returns the counters (the
// scaling gate pins them) and the created/changed mirror paths for tsgo
// notification.
function materializeClosure(seeds) {
  ensureMirrorRoot();
  const queue = [...seeds];
  let compiled = 0, cached = 0, failed = 0;
  const touched = [];
  while (queue.length) {
    const file = queue.pop();
    if (materializedMirrors.has(file)) continue;
    if (documents.get('file://' + file)) continue; // open buffers own their mirrors and closures
    // The stdlib is the sanctioned exception to the workspace bound: the
    // generated tsconfig points `rip/*` at its `__external__` mirror
    // faces, so those faces must exist — and the subtree is finite, so
    // the runaway-`../`-chain concern the bound guards against does not
    // apply to it.
    if (!workspaceRoot || (!file.startsWith(workspaceRoot + path.sep) && !isStdlibPath(file))) {
      connection.console.error(
        `[rip] closure truncated: ${file} resolves outside the workspace — not materialized (open it directly for single-file service)`,
      );
      continue;
    }
    let source;
    try { source = fs.readFileSync(file, 'utf8'); } catch {
      pendingImports.add(file);
      continue;
    }
    pendingImports.delete(file);
    const sourceHash = hashText(source);
    materializedMirrors.set(file, { sourceHash });
    const entry = cacheManifest.entries[file];
    // Freshness = source bytes AND the stash discovery the face was
    // compiled under: creating or deleting app/stash.rip (or its
    // anchor pair) changes no route's bytes, and an entry written
    // before the field existed reads undefined — a mismatch, so it
    // recompiles once and heals.
    if (entry && entry.sourceHash === sourceHash && mirrorIntact(file, entry) &&
        entry.stashSpec === appStashSpecFor(file, workspaceRoot)) {
      cached++;
      // The cached road reconverges on the compile road's disk truth:
      // wrapperDirs is per-SESSION memory over per-WORKSPACE disk, and a
      // warm session that reached every nested face by cache hit never
      // ensured a wrapper — the root config then regenerated without its
      // exclusions and every nested face had two owners.
      touched.push(...ensureProjectWrapper(file));
      queue.push(...entry.imports);
      continue;
    }
    try {
      // Before the face is written, so the project it belongs to already
      // exists when tsgo reads it.
      touched.push(...ensureProjectWrapper(file));
      const { mirrorPath, imports } = mirrorFromDisk(file, source);
      compiled++;
      touched.push(mirrorPath);
      queue.push(...imports);
    } catch {
      failed++; // CompileError: the last-compiled mirror (if any) keeps serving
      // A file with NO cache entry has no last-compiled face, so the only
      // bytes on disk are its auto-import stub — which would answer `any`
      // for every use and swallow the unresolved-module error the importer
      // is owed. Candidacy must never buy silence: take the stub out.
      if (!cacheManifest.entries[file]) {
        const stale = mirrorPathOf('file://' + file);
        try { fs.rmSync(stale); touched.push(stale); } catch { /* nothing there */ }
      }
    }
  }
  return { compiled, cached, failed, touched };
}

// The ACTIVE closure: the open buffers plus everything transitively
// reachable from their recorded imports (through the manifest's import
// lists for disk files).
function computeActiveClosure() {
  const active = new Set();
  const queue = [];
  for (const [uri, state] of states) {
    if (!uri.startsWith('file://')) continue;
    try { active.add(fileURLToPath(uri)); } catch { continue; }
    queue.push(...(state.imports ?? []));
  }
  while (queue.length) {
    const file = queue.pop();
    if (active.has(file)) continue;
    active.add(file);
    const entry = cacheManifest.entries[file];
    if (entry) queue.push(...entry.imports);
  }
  return active;
}

// The closure SHRINKS too: when a file is no longer reachable from any
// open buffer — its importer closed, or the import line was removed —
// its mirror and cache entry leave the program (tsgo sees the
// deletions), so the program is always exactly the open buffers'
// closure. A shared dependency survives while ANY importer remains
// open.
async function pruneClosure() {
  const active = computeActiveClosure();
  const removed = [];
  // Mirrors overwritten with a stub rather than removed: the file left the
  // CLOSURE but not the workspace, so its names stay auto-importable.
  const restubbed = [];
  // Decided here, WRITTEN below. The stub needs the file read and scanned,
  // and doing that inside drop() put one synchronous read+scan+write on the
  // message loop per pruned file — the cost the population pass yields
  // against every 10 files, and a wide prune (closing a buffer whose
  // closure is large) is exactly when there are many. Only the cheap tests
  // run here; the work runs in a loop that can yield.
  const maybeStub = [];
  const drop = (file) => {
    materializedMirrors.delete(file);
    faceCache.delete(file);
    delete cacheManifest.entries[file];
    const mirrorPath = mirrorPathOf('file://' + file);
    if (workspaceRoot && file.startsWith(workspaceRoot + path.sep)
        && fs.existsSync(mirrorPath) && fs.existsSync(file)) {
      maybeStub.push({ file, mirrorPath });
      return;
    }
    try {
      fs.rmSync(mirrorPath);
      removed.push(mirrorPath);
    } catch { /* no mirror on disk */ }
  };
  for (const file of [...materializedMirrors.keys()]) {
    if (!active.has(file)) drop(file);
  }
  for (const file of Object.keys(cacheManifest.entries)) {
    if (!active.has(file)) drop(file);
  }
  for (const file of [...pendingImports]) {
    if (!active.has(file)) pendingImports.delete(file);
  }
  // A workspace source that still exports something keeps a
  // declaration-only stub IN PLACE OF its compiled face — overwritten,
  // never removed and rewritten. The distinction is the whole fix: any
  // sequence that deletes the mirror first opens a window where the path
  // does not exist, and tsgo drops the file from its auto-import index when
  // it reads during that window. Driven, and the window is small enough to
  // be a race rather than a rule — a 400 ms gap between the delete and the
  // rewrite restored the candidate, 0 ms did not, which is exactly the
  // shape of fix that works on this machine and fails on a slower one.
  // Overwriting has no window: the file is a face, then it is a stub, and
  // it is continuously present. Yields on the population pass's cadence,
  // and finishes BEFORE the notify below, which is what the ordering needs.
  let scanned = 0;
  for (const { file, mirrorPath } of maybeStub) {
    const stub = stubTextFor(file);
    // Ownership re-checked in the SAME synchronous turn as the write —
    // wantsStub's discipline, spelled out because the mirror exists
    // here by construction. The yields on this loop let a refresh or a
    // watcher event re-materialize the file mid-prune (the list above
    // was decided before any of them ran), and a stale stub must never
    // clobber a face the bookkeeping has since reclaimed.
    if (documents.get('file://' + file) || materializedMirrors.has(file) ||
        cacheManifest.entries[file] !== undefined) continue;
    let kept = false;
    if (stub !== null) {
      try { writeMirror(mirrorPath, stub); restubbed.push(mirrorPath); kept = true; }
      catch { /* candidacy is never worth a broken tree */ }
    }
    if (!kept) {
      try { fs.rmSync(mirrorPath); removed.push(mirrorPath); } catch { /* already gone */ }
    }
    if (++scanned % 10 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  if (!removed.length && !restubbed.length) return;
  scheduleManifestSave();
  connection.console.log(`[rip] closure pruned: ${removed.length + restubbed.length} mirror(s) left the program${restubbed.length ? ` (${restubbed.length} kept as auto-import stubs)` : ''}`);
  // Re-stubbing does not undo the prune: the compiled FACE is gone and stays
  // gone, and the stub sits in neither bookkeeping collection, so the closure
  // is exactly as small as the prune made it. What it buys is candidacy —
  // without it, accepting an import and then removing it takes that file out
  // of auto-import for the rest of the session, curable only by a restart
  // nobody would guess at. Any removed import does it.
  //
  // Two kinds of change, one batch. A removed mirror is Deleted; a mirror
  // that became a stub is Changed — the file never left, so nothing has to
  // be re-added to tsgo's index, which is what the delete-then-recreate
  // sequences were fighting.
  await tsgoReady;
  if (tsgo && (removed.length || restubbed.length)) {
    tsgo.client.notify('workspace/didChangeWatchedFiles', {
      changes: [
        ...removed.map((p) => ({ uri: 'file://' + p, type: FileChangeType.Deleted })),
        ...restubbed.map((p) => ({ uri: 'file://' + p, type: FileChangeType.Changed })),
      ],
    });
  }
  repullOpenDocuments();
}

// Orphan mirrors: a mirror file with no
// manifest entry — a crash between the mirror write and the debounced
// manifest save — is invisible to revalidateCache and pruneClosure but
// joins the program through the tsconfig include glob, forever. Sweep
// them at startup, before the program serves; anything legitimately
// needed re-materializes through the normal demand-driven path. The
// __external__ subtree is EXEMPT: non-file URIs mirror there with no
// manifest entry BY DESIGN (sourcePathOfMirror has no inverse for
// them), so manifest-lessness is their normal state, not orphanhood.
// ACCEPTED INVARIANT: the mirror root has no cross-instance
// lease, so a second window on the same workspace can sweep a mirror
// the first window wrote inside the 500 ms manifest-save debounce.
// Impact is bounded — open buffers serve from in-memory overlays and
// the next refresh rewrites the mirror — and a lockfile would be
// disproportionate: it adds a stale-lock recovery protocol to guard a
// window that a single refresh already heals.
function sweepOrphanMirrors() {
  if (!mirrorRoot) return;
  const externalRoot = path.join(mirrorRoot, '__external__') + path.sep;
  const expected = new Set();
  for (const file of Object.keys(cacheManifest.entries)) {
    expected.add(mirrorPathOf('file://' + file));
  }
  for (const [, state] of states) expected.add(state.mirrorPath);
  const removed = [];
  for (const mirror of walkFiles(mirrorRoot, '.rip.ts')) {
    if (expected.has(mirror) || mirror.startsWith(externalRoot)) continue;
    try {
      fs.rmSync(mirror);
      removed.push(mirror);
    } catch { /* best effort */ }
  }
  if (removed.length) {
    connection.console.log(`[rip] orphan mirror sweep: ${removed.length} manifest-less mirror(s) removed`);
  }
}

// ---- auto-import candidacy: the whole workspace, as stubs.
//
// The doctrine, RULED: faces are lazy, candidacy is eager. The
// demand-driven closure keeps everything expensive — compiled faces,
// tsgo program growth — behind an open buffer's demand; candidacy is
// the one eager act, because a candidate written late is no candidate
// at all. Its writes stay inside `.rip/editor`, its bytes come from a
// scan and never a compile, and the disk-layer hygiene gates
// (project-model.test.js) enforce exactly those edges.
//
// A candidate is offered only from tsgo's PROGRAM, and the program is the
// open buffers' mirror closure — so a workspace `.rip` nothing has opened
// or imported is not offered, which defeats auto-import's headline case.
// Every such file therefore gets a declaration-only mirror: its exported
// NAMES and nothing else, built from a source scan (mirror.js) rather
// than a compile, because compiling the workspace is ~99% of the cost and
// buys candidacy nothing — a stub and a full face yield the same
// completion item and the same import edit.
//
// BYTES ONLY. A stub is written to disk and announced to tsgo, and is
// deliberately absent from `materializedMirrors` and
// `cacheManifest.entries`. Two things follow, and both are the point:
//
//   - `pruneClosure` iterates exactly those two collections, so a stub is
//     invisible to it and survives with no exemption and no change there.
//   - `materializeClosure` short-circuits on a REGISTERED mirror, so a
//     registered stub would shadow the real face forever — hover
//     answering `() => any`, go-to-definition empty, real type errors
//     unraised. Unregistered, the first real import edge compiles the
//     true face straight over the stub's bytes.
//
// Maintenance follows the same registration line: an edit to an
// unopened CLOSURE member (bookkeeping-tracked) re-materializes the
// full face through the watcher; an edit to a stub-backed bystander
// re-derives the STUB in place — a one-file scan, never a compile — so
// workspace churn maintains candidacy without growing the program. A
// delete removes the mirror either way.
//
// A file that LEAVES the closure — its importer closed, its import line
// removed — is re-stubbed by `pruneClosure` in the same pass that
// deregisters it: overwritten in place (a delete-then-recreate opens a
// window where tsgo drops the candidate), face one moment, stub the
// next, continuously present and continuously a candidate. The stub
// lands in neither bookkeeping collection, so the closure is exactly as
// small as the prune made it.
//
// The cap bounds tsgo's memory, which is what the closure exists to hold.
// Measured against the pinned tsgo over this repo's corpus, replicated:
// 279 stubs cost +12.7 MiB of tsgo RSS, 1116 cost +36.7 MiB — sublinear,
// with a marginal ~25 KiB per stub, so the cap is worth roughly +130 MiB
// at its limit. Full faces for the same 279 files cost +147 MiB, which is
// the cost the demand-driven closure was built to refuse.
const STUB_FILE_CAP = 5000;
const STUB_WALK_SKIP = new Set(['node_modules']);

// Every `.rip` under the workspace, minus the trees no source lives in.
// Dot-directories are skipped, which is also what keeps the walk out of
// our own mirror root (.rip/editor). Yields between directories: this
// runs on the message loop, and a wide workspace must not cost a
// keystroke.
async function workspaceRipFiles() {
  const files = [];
  const queue = [[workspaceRoot, 0]];
  let seen = 0;
  while (queue.length && files.length < STUB_FILE_CAP) {
    const [dir, depth] = queue.pop();
    if (depth > 32) continue;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    // Sorted, so the walk order — and therefore WHICH files make the cap
    // in an over-cap workspace — is a property of the tree, not of
    // readdir's platform-dependent ordering.
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || STUB_WALK_SKIP.has(entry.name)) continue;
        queue.push([path.join(dir, entry.name), depth + 1]);
      } else if (entry.name.endsWith('.rip')) {
        files.push(path.join(dir, entry.name));
      }
    }
    if (++seen % 25 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  // No silent caps: a truncated walk must say so, or the missing
  // candidates read as "the workspace was covered" to whoever debugs an
  // auto-import that never offers.
  if (files.length >= STUB_FILE_CAP) {
    connection.console.log(
      `[rip] auto-import stub walk capped at ${STUB_FILE_CAP} .rip files — the rest gain candidacy when opened or imported`,
    );
  }
  return files;
}

// A file wants a stub only when nothing better already speaks for it. The
// on-disk check is the load-bearing one: a real face must never be
// overwritten by a stub, whoever wrote it.
function wantsStub(file) {
  if (documents.get('file://' + file)) return false;      // an open buffer owns its mirror
  if (materializedMirrors.has(file)) return false;        // the closure owns it
  if (cacheManifest.entries[file]) return false;
  return !fs.existsSync(mirrorPathOf('file://' + file));
}

// One file's stub text, synchronously — the prune's re-stub path, which
// must finish before its own notify goes out. Null when the file cannot be
// read or exports nothing (no candidate to keep alive, so no mirror).
//
// The STAR TARGETS are scanned too, and that is not an optimization. A
// barrel's `export * from './x.rip'` names live in the target, and
// stubFacesFromScans resolves them by looking the target up in the map it
// was handed — so a map of one file resolves nothing and the barrel comes
// back carrying only the names it writes itself. The population pass never
// sees this because it scans the whole workspace at once; only this path
// builds a stub in isolation. Driven: a barrel re-stubbed after its import
// was removed lost every pass-through name, so accepting an auto-import
// through a barrel and then deleting it took that barrel out of candidacy
// while the direct file stayed.
function stubTextFor(file) {
  const scans = new Map();
  const queue = [file];
  const seen = new Set();
  while (queue.length) {
    const at = queue.pop();
    if (seen.has(at)) continue;                       // a star cycle closes here
    seen.add(at);
    let source;
    try { source = fs.readFileSync(at, 'utf8'); } catch { continue; }
    const scan = scanExportNames(source);
    scans.set(at, scan);
    for (const spec of scan.stars) {
      if (spec.endsWith('.rip')) queue.push(path.resolve(path.dirname(at), spec));
    }
  }
  const scan = scans.get(file);
  if (!scan) return null;
  if (!scan.values.length && !scan.types.length && !scan.stars.length && !scan.hasDefault && !scan.globals?.length) return null;
  return stubFacesFromScans(scans).get(file) ?? null;
}

// Populate stubs for `candidates` (default: the whole workspace).
// Backgrounded by every caller — candidacy is never allowed in front of a
// diagnostic — and yields in SMALL batches, which is not a tuning knob but
// a measured one: the pass runs on the message loop at the same moment
// the first document is being refreshed, and over this repo's corpus the
// batch size is the difference between +19 ms and +6 ms on the first
// diagnostics (150 ms baseline). Coarse batches are cheaper for the pass
// and more expensive for the user.
async function populateAutoImportStubs(candidates = null) {
  if (!compile || !workspaceRoot || mirrorRootIsFallback) return;
  const t0 = performance.now();
  const scans = new Map();
  let read = 0;
  for (const file of candidates ?? await workspaceRipFiles()) {
    if (!wantsStub(file)) continue;
    let source;
    try { source = fs.readFileSync(file, 'utf8'); } catch { continue; }
    scans.set(file, scanExportNames(source));
    if (++read % 10 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  // A file that exports NOTHING offers no candidate, so its stub is pure
  // cost: bytes, a program entry, and a mirror where a reader expects none.
  // It also matters on the re-stub path — a closed buffer that exports
  // nothing must not acquire a mirror it never had.
  for (const [file, scan] of [...scans]) {
    if (!scan.values.length && !scan.types.length && !scan.stars.length && !scan.hasDefault && !scan.globals?.length) scans.delete(file);
  }
  if (!scans.size) return;
  ensureMirrorRoot();   // deferred to here: a workspace with no .rip stays untouched
  // Declared vocabulary discovered at SCAN time: the boundary must exist
  // before tsgo first assigns these files to a program, or a cold-open
  // handler lands in the root program where its globals miss (or leak).
  const configWritten = new Set();
  for (const [file, scan] of scans) {
    if (scan.globals?.length) for (const w of ensureAutoBoundary(file)) configWritten.add(w);
  }
  const written = [];
  let done = 0;
  for (const [file, text] of stubFacesFromScans(scans)) {
    // Re-checked at the write, not only at the scan: the awaits above let
    // a refresh materialize the real face in between, and the check and
    // the write together are one synchronous turn.
    if (!wantsStub(file)) continue;
    try {
      writeMirror(mirrorPathOf('file://' + file), text);
      written.push(mirrorPathOf('file://' + file));
    } catch { /* candidacy only — never fatal */ }
    if (++done % 10 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  if (!written.length && !configWritten.size) return;
  connection.console.log(
    `[rip] auto-import stubs: ${written.length} declaration-only mirror(s) in ${Math.round(performance.now() - t0)} ms`,
  );
  // tsgo does not notice a bare mid-session disk write. The Created batch
  // is what puts these files in its program — driven, and decisive. The
  // auto-boundary's config writes ride along as Changed.
  await tsgoReady;
  if (tsgo) {
    tsgo.client.notify('workspace/didChangeWatchedFiles', {
      changes: [
        ...written.map((p) => ({ uri: 'file://' + p, type: FileChangeType.Created })),
        ...[...configWritten].map((p) => ({ uri: 'file://' + p, type: FileChangeType.Changed })),
      ],
    });
  }
}

// Startup: reconcile the persisted tree. Every cached entry revalidates
// against the disk (source-hash compare AND mirror-byte verification —
// recompile what changed while the server was down and anything a crash
// left partial); mirrors whose source is gone leave the program. Cost
// scales with the CLOSURE the previous session used, not the workspace.
async function revalidateCache() {
  const t0 = performance.now();
  let fresh = 0, recompiled = 0, removed = 0, processed = 0;
  sweepOrphanMirrors();
  if (Object.keys(cacheManifest.entries).length) ensureMirrorRoot();
  for (const [file, entry] of Object.entries(cacheManifest.entries)) {
    if (documents.get('file://' + file)) continue; // an open buffer's refresh owns its mirror
    let source;
    try { source = fs.readFileSync(file, 'utf8'); } catch {
      delete cacheManifest.entries[file];
      try { fs.rmSync(mirrorPathOf('file://' + file)); } catch { /* already gone */ }
      scheduleManifestSave();
      removed++;
      continue;
    }
    const sourceHash = hashText(source);
    if (sourceHash === entry.sourceHash && mirrorIntact(file, entry)) {
      fresh++;
    } else {
      try { mirrorFromDisk(file, source); recompiled++; }
      catch { failedQuietly(file); }
    }
    // Fresh or recompiled, the file's project needs its wrapper THIS
    // session: wrapperDirs starts empty on every start, and the root
    // config's exclusions are rebuilt from it.
    ensureProjectWrapper(file);
    materializedMirrors.set(file, { sourceHash });
    // Keep the message loop responsive over large closures.
    if (++processed % 50 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  // With wrapperDirs repopulated from every cached member, disk and
  // memory reconcile in the other direction too: a wrapper left by a
  // previous session whose project no longer earns one (its tsconfig
  // deleted while the server was down, or its members gone from the
  // cache) would keep claiming the subtree's faces with a config
  // extending nothing. Nothing else removes wrapper files — the orphan
  // sweep is faces-only by design.
  sweepStaleWrappers();
  const ms = Math.round(performance.now() - t0);
  connection.console.log(
    `[rip] project cache: ${fresh} face(s) fresh, ${recompiled} recompiled, ${removed} removed in ${ms} ms`,
  );
}

// Remove generated wrapper files (tsconfig + host floor) in mirror
// subdirectories that no current wrapper claims. Wrapper-file-only: the
// faces beside them belong to the manifest and the orphan sweep.
function sweepStaleWrappers() {
  if (!mirrorRoot || mirrorRootIsFallback || !mirrorRootReady) return;
  const removed = [];
  for (const cfg of walkFiles(mirrorRoot, 'tsconfig.json')) {
    const dir = path.dirname(cfg);
    if (dir === mirrorRoot) continue; // the root config is not a wrapper
    if (wrapperDirs.has(path.relative(mirrorRoot, dir))) continue;
    for (const name of ['tsconfig.json', HOST_FLOOR_NAME]) {
      try { fs.rmSync(path.join(dir, name)); removed.push(path.join(dir, name)); } catch { /* absent */ }
    }
  }
  if (removed.length) {
    connection.console.log(`[rip] stale wrapper sweep: ${removed.length} generated file(s) from projects no session member claims`);
  }
}

function failedQuietly(file) {
  connection.console.log(`[rip] cached face for ${file} failed to recompile — last-compiled face serves`);
}

// tsgo's semantic-tokens legend, mirrored to our own client: the token
// data arrays pass through re-encoded but never re-typed, so the legend
// must be tsgo's. The fallback matches the pinned tsgo's legend and
// only governs when tsgo failed to start (no tokens flow then anyway).
const FALLBACK_LEGEND = {
  tokenTypes: [
    'namespace', 'class', 'enum', 'interface', 'struct', 'typeParameter', 'type',
    'parameter', 'variable', 'property', 'enumMember', 'decorator', 'event',
    'function', 'method', 'macro', 'comment', 'string', 'keyword', 'number',
    'regexp', 'operator',
  ],
  tokenModifiers: [
    'declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract',
    'async', 'modification', 'documentation', 'defaultLibrary',
  ],
};
let semanticTokensLegend = FALLBACK_LEGEND;

// A completion trigger character is a PROMISE: the editor opens a
// suggest session the moment one is typed, and a session that opens
// with nothing from this server lives on the editor's OWN word matches
// for the rest of the word — every later keystroke refilters that
// session instead of asking again, so the members never arrive however
// well the position maps. The advertised set therefore holds only
// characters the pipeline answers. Two of tsgo's are not among them.
// SPACE it advertises and then answers nothing for anywhere, at any
// position, in a face or in plain TypeScript. STAR it reserves for
// continuing a JSDoc block, a context no face can hold: Rip's comment
// glyph is '#', so nothing a .rip file compiles to ever puts a cursor
// inside `/** */`.
const UNSERVED_COMPLETION_TRIGGERS = new Set([' ', '*']);

// The set as advertised — what onCompletion is willing to relay.
let completionTriggerCharacters = [];

connection.onInitialize(async (params) => {
  compile = await loadCompiler();
  readProjectConfig = await loadProjectConfigReader();
  workspaceRoot = detectWorkspaceRoot(params);
  // Before any mirror is planned: the workspace decides which checkout's
  // stdlib `rip/*` names resolve to, for resolution and the generated
  // `paths` map alike.
  anchorStdlib(workspaceRoot);
  planMirrorRoot();
  loadCache();
  clientSupportsWatchers = !!params.capabilities?.workspace?.didChangeWatchedFiles?.dynamicRegistration;
  clientSupportsConfiguration = !!params.capabilities?.workspace?.configuration;
  clientDefinitionLinks = !!params.capabilities?.textDocument?.definition?.linkSupport;
  // Awaited: the advertised trigger characters and semantic-tokens
  // legend are tsgo's own — a made-up legend would mislabel every token.
  const session = await launchTsgo();
  const tsCaps = session?.capabilities ?? {};
  semanticTokensLegend = tsCaps.semanticTokensProvider?.legend ?? FALLBACK_LEGEND;
  completionTriggerCharacters = (tsCaps.completionProvider?.triggerCharacters
    ?? ['.', '"', "'", '`', '/', '@', '<', '#', ' ']).filter((c) => !UNSERVED_COMPLETION_TRIGGERS.has(c));
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      hoverProvider: true,
      definitionProvider: true,
      typeDefinitionProvider: true,
      implementationProvider: true,
      referencesProvider: true,
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      completionProvider: {
        triggerCharacters: completionTriggerCharacters,
        resolveProvider: true,
      },
      signatureHelpProvider: {
        triggerCharacters: tsCaps.signatureHelpProvider?.triggerCharacters ?? ['(', ',', '<'],
        retriggerCharacters: tsCaps.signatureHelpProvider?.retriggerCharacters ?? [')'],
      },
      codeActionProvider: {
        codeActionKinds: [
          'quickfix',
          'source.organizeImports', 'source.removeUnusedImports', 'source.sortImports', 'source.fixAll',
        ],
      },
      renameProvider: { prepareProvider: true },
      semanticTokensProvider: {
        legend: semanticTokensLegend,
        full: true,
        range: true,
      },
      documentLinkProvider: {},
    },
  };
});

connection.onInitialized(async () => {
  clientInitialized = true;
  if (clientSupportsWatchers) {
    connection.client.register(DidChangeWatchedFilesNotification.type, {
      watchers: [{ globPattern: '**/*.rip' }, { globPattern: '**/tsconfig.json' }, { globPattern: '**/package.json' }],
    });
  }
  // The build hash is `rip check --build`'s twin — same content hash over
  // the same two trees — so one glance at this block against that output
  // says whether the installed extension matches the checkout it serves.
  // One aligned line per fact: the single-line form wrapped illegibly the
  // moment real paths landed in it. Paths shorten to `~`, and the mirror
  // prints workspace-relative when it lives inside the workspace.
  const tilde = (p) => (p && p.startsWith(os.homedir() + path.sep) ? '~' + p.slice(os.homedir().length) : p);
  const mirrorShown = workspaceRoot && mirrorRoot.startsWith(workspaceRoot + path.sep)
    ? path.relative(workspaceRoot, mirrorRoot) : tilde(mirrorRoot);
  connection.console.log(`[rip] ready (build ${cacheIdentity ?? 'unknown'})`);
  connection.console.log(`[rip]   compiler:  ${tilde(compilerDir) ?? 'unresolved'}`);
  connection.console.log(`[rip]   workspace: ${tilde(workspaceRoot) ?? 'none'}`);
  connection.console.log(`[rip]   mirror:    ${mirrorShown}${mirrorRootIsFallback ? ' [fallback]' : ''}`);
  await revalidateCache();
  repullOpenDocuments();
  // Auto-import candidacy, and deliberately NOT awaited: it is a
  // background convenience that must never sit in front of the first
  // diagnostics. It runs AFTER revalidateCache so the orphan sweep — which
  // deletes every manifest-less mirror, stubs included — has already run.
  populateAutoImportStubs().catch(
    (err) => connection.console.error(`[rip] auto-import stub population failed: ${err.stack ?? err}`),
  );
});

const cleanupFallbackRoot = () => {
  // The workspace-local mirror tree is a persistent, regenerable cache
  // (the next session's revalidation reconciles it); only a temp fallback
  // root is ours to remove.
  if (mirrorRootIsFallback && mirrorRoot) {
    try { fs.rmSync(mirrorRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  }
};

connection.onShutdown(async () => {
  shuttingDown = true;
  if (tsgo) {
    try { await tsgo.client.stop(); } catch { /* it dies with us regardless */ }
  }
  saveManifestNow();
  cleanupFallbackRoot();
});

process.on('exit', () => {
  saveManifestNow();
  cleanupFallbackRoot();
});

// A CompileError as an LSP diagnostic on the .rip buffer. Structured
// fields carry [start, end) offsets when the failure has a source
// position; the rare message-only errors mark the first character.
function compileErrorDiagnostic(err, text, lineStarts) {
  // Reason + [start, end) span come from the shared formatter
  // (diagnostics.js), so the editor and the batch `rip check` render a
  // CompileError identically.
  const { reason, start, end } = compileErrorInfo(err, text.length);
  return {
    severity: 1,
    source: 'rip',
    message: reason,
    range: {
      start: offsetToPosition(lineStarts, start),
      end: offsetToPosition(lineStarts, end),
    },
  };
}

// The rejections a TOLERANT compile carried instead of throwing, as LSP
// diagnostics. Source-positioned already (parse and lex diagnostics are
// offsets into the .rip text), so no face mapping is involved — which is
// what lets them publish with tsgo dead or mid-restart.
function ripParseDiagnostics(good) {
  return (good.parseDiagnostics ?? []).map((d) => ({
    severity: 1,
    source: 'rip',
    message: d.message,
    range: {
      start: offsetToPosition(good.srcLineStarts, d.start),
      end: offsetToPosition(good.srcLineStarts, d.end),
    },
  }));
}

// mapTsDiagnostic / ripDirectiveLines / applyRipDirectives — the
// diagnostic-mapping core — live in diagnostics.js (shared with the
// batch `rip check`).

// Re-pull TS diagnostics for one open document WITHOUT recompiling — the
// cross-file freshness path: an edit elsewhere in the program can change
// this document's diagnostics while its own text (and mappings) are
// unchanged. Only runs while the buffer matches its lastGood compile;
// the stale buffer's own refresh owns its publishing (positions from two
// buffer versions never mix). The `@ts-expect-error` semantics and the
// TS2578 handling live in applyRipDirectives (diagnostics.js).
async function repullDiagnostics(uri) {
  const state = states.get(uri);
  const good = state?.lastGood;
  if (!good || !state.tsOpen || !tsgo) return;
  // rip.noCheck: silenced here too — cross-file re-pulls must not
  // resurrect a no-check doc's diagnostics after refresh cleared them.
  if (isNoCheck(uri, state)) { connection.sendDiagnostics({ uri, diagnostics: [] }); return; }
  if (documents.get(uri)?.getText() !== good.source) return;
  let pulled;
  try {
    // A generous cap, not the default: this pull is issued ONCE per
    // trigger and abandoned on timeout, so a cap shorter than tsgo's
    // worst rebuild (a config flip re-governing the program on a loaded
    // machine) loses the publication forever — nothing re-pulls until
    // the next user action. A late answer is still safe: the staleness
    // guards below discard it if the buffer moved on.
    pulled = await tsgo.client.request('textDocument/diagnostic', { textDocument: { uri: state.tsUri } }, { timeoutMs: 60000 });
  } catch (err) {
    connection.console.error(`[rip] diagnostic re-pull failed: ${err.message}`);
    return;
  }
  if (documents.get(uri)?.getText() !== good.source) return;
  const mapped = [];
  for (const d of pulled?.items ?? []) {
    const m = mapTsDiagnostic(good, d);
    if (m) mapped.push(m);
  }
  // rip's own parse rejections ride in front here exactly as in the
  // refresh publish: sendDiagnostics REPLACES the set per URI, and a
  // tolerant compile satisfies every guard above (lastGood.source IS
  // the incomplete buffer text) — so a re-pull without the prefix
  // would wipe the incompleteness squiggle from a buffer that is
  // still incomplete.
  connection.sendDiagnostics({ uri, diagnostics: [...ripParseDiagnostics(good), ...applyRipDirectives(good, mapped)] });
}

function repullOpenDocuments(exceptUri = null) {
  for (const uri of states.keys()) {
    if (uri === exceptUri) continue;
    repullDiagnostics(uri).catch((err) => connection.console.error(`[rip] re-pull failed: ${err.stack ?? err}`));
  }
}

// Does this document match its project's rip.noCheck? (globToRegex /
// isNoCheckPath live in diagnostics.js — shared with the batch checker.)
function isNoCheck(uri, state) {
  if (!uri.startsWith('file://')) return false;
  let fsPath;
  try { fsPath = fileURLToPath(uri); } catch { return false; }
  return isNoCheckPath(fsPath, state.configDir, state.noCheck);
}

async function refresh(document) {
  ensureMirrorRoot(); // first materialization decides/creates the tree
  const state = stateOf(document.uri);
  const text = document.getText();
  const srcLineStarts = lineStartsOf(text);

  // rip.strict / rip.noCheck (package.json#rip, nearest wins, no
  // ancestor inheritance). Presentation-only: strict surfaces the
  // implicit-any family and drops the `!` on typed forwards/pins;
  // noCheck silences diagnostics for matched paths. Re-read each
  // refresh — cheap, always current, and reactive to the package.json
  // watch (onDidChangeWatchedFiles refreshes open docs on a config change).
  if (document.uri.startsWith('file://')) {
    try {
      const cfg = readProjectConfig(path.dirname(fileURLToPath(document.uri)));
      state.strict = cfg.strict;
      state.noCheck = cfg.noCheck;
      state.configDir = cfg._configDir;
    } catch { state.strict = false; state.noCheck = []; state.configDir = null; }
  }

  let result;
  try {
    // The TS FACE: the mirror carries Rip's type
    // information — annotations, structured type/interface
    // declarations, typed hoist lines — so tsgo checks declared types
    // and write-site hover reads them. Never a shipping surface;
    // its rows ride the same MappingStore protocol, so translation
    // below is face-agnostic.
    // Tier 3 pins ride every compile: cached probe answers keyed by
    // `${name}@${valueHash}` — stale keys simply miss, and a rejected
    // probe (null) never becomes a pin.
    let pins = null;
    for (const [key, type] of state.pinCache) {
      if (type !== null) (pins ??= new Map()).set(key, type);
    }
    // The OPEN BUFFER's face compile is tolerant: an incomplete buffer
    // (a trailing dot, an open call) still yields a CURRENT face, with
    // zero-width holes at the incompleteness, so completion and
    // signature help map into the buffer being typed rather than the
    // last good one. The rejections the compile carried instead of
    // throwing publish below — tolerance is never acceptance. Disk-file
    // closure compiles stay strict: a mirror is a statement about a
    // file at rest, not a keystroke in flight. Parser holes and schema
    // callable lines are recovery units. Other positioned rejections,
    // including incomplete token bodies and schema directives, reach the
    // catch below and ride the last good face.
    const stashSpec = (() => { try { return appStashSpecFor(fileURLToPath(document.uri), workspaceRoot); } catch { return null; } })();
    result = compile(text, { path: document.uri, runtimeDelivery: 'inline', face: 'ts', pins, strict: state.strict, tolerant: true, appStashSpec: stashSpec });
  } catch (err) {
    if (err?.name !== 'CompileError') throw err;
    // staleness: lastGood (and the overlay/mirror) stay as they are.
    connection.sendDiagnostics({
      uri: document.uri,
      diagnostics: [compileErrorDiagnostic(err, text, srcLineStarts)],
    });
    return;
  }

  const good = {
    source: text,
    code: result.code,
    mappings: result.mappings,
    stores: result.stores,
    trivia: result.trivia,
    // Parse/lex rejections the tolerant compile carried through —
    // published beside the mapped TS diagnostics, so an incomplete
    // buffer still says it is incomplete.
    parseDiagnostics: result.parseDiagnostics ?? [],
    // Generated spans of `:=` state names — writable in rip though the face
    // binds their cell `const`. Semantic tokens clear TypeScript's `readonly`
    // on exactly these.
    mutables: result.mutables,
    // Generated spans of every enum-name occurrence. The face's const
    // object and its companion type alias merge into one symbol tsgo
    // classifies `type`; the token names the construct the author
    // declared.
    enums: result.enums,
    // Hoisted class-expression bindings whose declaration lost its
    // initializer to the hoist split (see ripSemanticTokens).
    classDecls: result.classDecls ?? [],
    // Render-loop binding names — parameters in the face's block factory,
    // loop variables in the source (see ripSemanticTokens).
    loopVars: result.loopVars ?? [],
    // Render attribute names — prop keys of component calls, whose
    // semantic tokens are suppressed so every attribute reads through the
    // TextMate attribute scope (see ripSemanticTokens).
    attrNames: result.attrNames ?? [],
    // The enum names this module declares — read by IMPORTERS, which
    // cannot compute it from their own compile. An open buffer answers
    // from here; a disk file from its manifest entry.
    enumNames: enumNamesOf(result),
    // Generated spans of references to imported names, each with its
    // module — the editor resolves the specifier and asks that module
    // what kind the name is (see ripSemanticTokens).
    importedRefs: result.importedRefs ?? [],
    dir: (() => { try { return path.dirname(fileURLToPath(document.uri)); } catch { return null; } })(),
    // SOURCE spans the lowering owns whole — hover declines there rather
    // than describing the machinery the face put in their place.
    silent: noUserSymbolSpans(result),
    // SOURCE spans of component member declaration names — where a hover
    // answers in the author's vocabulary rather than the container the
    // face declares (see `memberDeclKind`).
    memberDecls: result.memberDecls ?? [],
    // Generated spans of face-echo text (the behavior objects) — the
    // diagnostic mapper drops non-exact-mapped diagnostics born there,
    // the real copy's report being the one honest squiggle.
    echoSpans: result.echoSpans ?? [],
    srcLineStarts,
    genLineStarts: lineStartsOf(result.code),
    strict: state.strict === true, // rides the compile it governed
    // The declaration-scope gate, over the SAME compile that produced the
    // face above — so the lines it calls typed are the lines this face
    // actually carries type information for. `dir` is computed just above;
    // this reads it back rather than deriving the path a second way.
    checkedLines: (() => {
      const dir = (() => { try { return path.dirname(fileURLToPath(document.uri)); } catch { return null; } })();
      return scopeGateFor(text, result, typedImportsFor(result.stores, text, dir));
    })(),
  };

  // The last-compiled face to disk: program membership for the mirror
  // tree (unopened importers resolve against it) and what this file
  // serves from after its buffer closes. The open buffer's overlay
  // below takes precedence over these bytes while the doc is open.
  // A RECOVERED face never lands here: the mirror is what IMPORTERS
  // resolve against, and a face with holes is a keystroke in flight,
  // not a statement about the module — during incompleteness the disk
  // keeps the last good face, exactly as it did when the compile threw.
  if (good.parseDiagnostics.length === 0) {
    try {
      warnOnMirrorCollision(state.mirrorPath, document.uri);
      if (!mirrorRootIsFallback) { try { linkNestedNodeModules(workspaceRoot, mirrorRoot, fileURLToPath(document.uri)); } catch { /* non-file uri */ } }
      writeMirror(state.mirrorPath, result.code);
    } catch (err) {
      connection.console.error(`[rip] mirror write failed: ${err.message}`);
    }
  }

  // The demand-driven closure: this buffer's .rip imports (from the
  // compiler's stores) pull their transitive subtrees into the program —
  // a NEW import appearing in an edit materializes on this refresh, and
  // a REMOVED one prunes whatever only it was keeping in.
  if (document.uri.startsWith('file://')) {
    let fsPath = null;
    try { fsPath = fileURLToPath(document.uri); } catch { /* non-path uri */ }
    if (fsPath) {
      const imports = closureImportsOf(result.stores, text, fsPath, workspaceRoot);
      const previous = state.imports ?? [];
      state.imports = imports;
      // The entry describes the bytes ON DISK, so it is gated exactly as
      // the mirror write above: a RECOVERED face's codeHash would name
      // holed bytes the mirror does not hold, and its sourceHash would
      // persist a keystroke in flight — mirrorIntact would then fail for
      // a mirror that is perfectly good. During incompleteness the
      // previous entry stands, describing the last good face the disk
      // still serves. (The closure work below still runs: a tolerant
      // face's imports are real, and completion inside the incomplete
      // buffer needs them materialized.)
      if (good.parseDiagnostics.length === 0) {
        cacheManifest.entries[fsPath] = {
          sourceHash: hashText(text), codeHash: hashText(result.code), imports,
          // The discovery this compile ran under (the compile-input rule
          // the closure road's revalidation reads).
          stashSpec: appStashSpecFor(fsPath, workspaceRoot),
          // An open buffer answers importers from its own last-good compile;
          // the entry has to carry the names too, or closing this buffer
          // leaves importers uncorrected until the file next changes.
          enumNames: enumNamesOf(result),
        };
        scheduleManifestSave();
      }
      const wrapperFiles = ensureProjectWrapper(fsPath);
      // Globals-declaring, mode-flipped against the parent package, or
      // installing its own ambient types: each way the package needs its
      // own program (floors, null posture, and typeRoots are per-program,
      // and a flip cuts both ways — configEarnsBoundary carries the
      // config-driven reasons).
      const stateEarns = state.configDir && configEarnsBoundary(
        { strict: state.strict, _configDir: state.configDir },
        readProjectConfig(path.dirname(state.configDir)), workspaceRoot);
      if (result.globalDecls?.length || stateEarns) {
        wrapperFiles.push(...ensureAutoBoundary(fsPath));
      }
      if (wrapperFiles.length && tsgo) {
        tsgo.client.notify('workspace/didChangeWatchedFiles', {
          changes: wrapperFiles.map((p) => ({ uri: 'file://' + p, type: FileChangeType.Changed })),
        });
      }
      const { compiled, cached, failed, touched } = materializeClosure(imports);
      // Every mirror this materialization wrote is forwarded NOW, the same
      // way the watcher-event path forwards its own touched list: tsgo's
      // program otherwise keeps the bytes it last knew for these files —
      // after a prune, the auto-import stub, whose exports all answer `any`.
      // The event is owed here by contract: this server advertises
      // didChangeWatchedFiles to tsgo, and tsgo's own disk watching is
      // darwin-only in practice, so an unforwarded write is invisible on
      // linux while FSEvents quietly covers the same gap on macOS.
      if (touched.length && tsgo) {
        tsgo.client.notify('workspace/didChangeWatchedFiles', {
          changes: touched.map((p) => ({
            uri: 'file://' + p,
            type: fs.existsSync(p) ? FileChangeType.Changed : FileChangeType.Deleted,
          })),
        });
      }
      if (compiled || cached || failed) {
        connection.console.log(
          `[rip] closure of ${path.basename(fsPath)}: ${compiled} compiled, ${cached} cached, ${failed} failed`,
        );
      }
      if (previous.some((p) => !imports.includes(p))) {
        pruneClosure().catch((err) => connection.console.error(`[rip] prune failed: ${err.stack ?? err}`));
      }
    }
  }

  await tsgoReady;
  if (!tsgo) {
    // No TS server: Rip's own diagnostics alone — empty on a clean
    // compile, the carried rejections on a tolerant one.
    state.lastGood = good;
    connection.sendDiagnostics({ uri: document.uri, diagnostics: ripParseDiagnostics(good) });
    return;
  }

  state.tsVersion += 1;
  state.hoverEnrich.clear();
  if (!state.tsOpen) {
    state.tsOpen = true;
    tsgo.client.notify('textDocument/didOpen', {
      textDocument: { uri: state.tsUri, languageId: 'typescript', version: state.tsVersion, text: result.code },
    });
  } else {
    tsgo.client.notify('textDocument/didChange', {
      textDocument: { uri: state.tsUri, version: state.tsVersion },
      contentChanges: [{ text: result.code }],
    });
  }
  // lastGood swaps only AFTER the virtual-doc update is on the wire:
  // LSP stream order guarantees tsgo processes that didOpen/didChange
  // before any subsequent hover, so a hover can never pair the new
  // mapping table with the previous virtual-doc text.
  state.lastGood = good;

  // An INCOMPLETE buffer's own rejections publish NOW, ahead of the TS
  // pull — they depend on nothing but the compile, so they must not wait
  // on (or die with) tsgo. The pull below re-publishes them merged with
  // the mapped TS set.
  if (good.parseDiagnostics.length > 0) {
    connection.sendDiagnostics({ uri: document.uri, diagnostics: ripParseDiagnostics(good) });
  }

  // rip.noCheck: the file stays in the program — imports resolve,
  // exported types flow to typed consumers — but its OWN diagnostics
  // are silenced, so a partly-typed project quiets its untyped/legacy
  // paths without dropping them from the type graph. Still re-pull
  // dependents so a typed importer reflects this face.
  if (isNoCheck(document.uri, state)) {
    connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
    repullOpenDocuments(document.uri);
    return;
  }

  const versionAtRequest = document.version;
  let pulled;
  try {
    // Same cap as the re-pull: one shot per refresh, abandoned on
    // timeout, so the cap must outlast tsgo's worst rebuild; the
    // version guard below discards a stale answer.
    pulled = await tsgo.client.request('textDocument/diagnostic', { textDocument: { uri: state.tsUri } }, { timeoutMs: 60000 });
  } catch (err) {
    connection.console.error(`[rip] diagnostic pull failed: ${err.message}`);
    return;
  }
  // Superseded by a newer edit — that edit's own refresh will publish.
  if (documents.get(document.uri)?.version !== versionAtRequest) return;

  const items = pulled?.items ?? [];
  const mapped = [];
  for (const d of items) {
    const m = mapTsDiagnostic(state.lastGood, d);
    if (m) mapped.push(m);
    else if (!SUPPRESSED_TS_CODES.has(d.code)) {
      connection.console.log(`[rip] dropped unmappable TS diagnostic ${d.code}: ${d.message}`);
    }
  }
  // rip's own parse rejections ride in front of the mapped TS set — a
  // tolerant compile carried them instead of throwing, and the buffer
  // must still read as incomplete.
  connection.sendDiagnostics({
    uri: document.uri,
    diagnostics: [...ripParseDiagnostics(state.lastGood), ...applyRipDirectives(state.lastGood, mapped)],
  });

  // This buffer's new face can change what OTHER open buffers see
  // (cross-file type flow); their diagnostics re-pull without recompiling.
  repullOpenDocuments(document.uri);

  // Tier 3 probe: any pinnable without a cache verdict gets one probe
  // round (async, behind diagnostics). Accepted answers trigger one
  // re-refresh; on that pass every key hits the cache, so the cycle
  // terminates. Rejected answers cache as null and never retry until
  // the defining expression changes (the key hashes its source text).
  if (result.pinnables?.some((p) => !state.pinCache.has(p.key))) {
    probePinsFor(document, state, result).catch((err) =>
      connection.console.error(`[rip] pin probe failed: ${err.message}`));
  }
}

// One probe round for a document: splice probe declarations into a
// sibling mirror file, hover each, cache verdicts, clean up, and
// re-refresh when anything new pinned. The probe file is never pulled
// for diagnostics (pull-model: only open rip mirrors are requested)
// and exports nothing, so it is invisible to the user.
async function probePinsFor(document, state, result) {
  if (state.probing || !tsgo) return;
  const wanted = result.pinnables.filter((p) => !state.pinCache.has(p.key));
  if (wanted.length === 0) return;
  state.probing = true;
  const versionAtProbe = documents.get(document.uri)?.version;
  const probePath = state.mirrorPath.replace(/\.ts$/, '.__rip_probe__.ts');
  const probeUri = 'file://' + probePath;
  try {
    const { text, positions } = buildProbe(result.code, wanted);
    writeMirror(probePath, text);
    tsgo.client.notify('textDocument/didOpen', {
      textDocument: { uri: probeUri, languageId: 'typescript', version: 1, text },
    });
    let pinned = 0;
    for (let i = 0; i < wanted.length; i++) {
      if (!positions[i]) { state.pinCache.set(wanted[i].key, null); continue; }
      let type = null;
      try {
        const hover = await tsgo.client.request('textDocument/hover', {
          textDocument: { uri: probeUri }, position: positions[i],
        });
        type = parseProbeHover(hover);
      } catch { /* dead tsgo or timeout: fall through to null */ }
      state.pinCache.set(wanted[i].key, type);
      if (type !== null) pinned++;
    }
    tsgo.client.notify('textDocument/didClose', { textDocument: { uri: probeUri } });
    if (pinned > 0) {
      connection.console.log(`[rip] pinned ${pinned}/${wanted.length} hoisted binding(s) for ${path.basename(state.mirrorPath)}`);
      // Superseded edits refresh on their own; only re-refresh the text we probed.
      if (documents.get(document.uri)?.version === versionAtProbe) await refresh(document);
    }
  } finally {
    try { fs.unlinkSync(probePath); } catch { /* already gone */ }
    state.probing = false;
  }
}

function scheduleRefresh(document) {
  const state = stateOf(document.uri);
  // Keystroke coalescing; compiles are fast but tsgo round-trips add up.
  clearTimeout(state.refreshTimer);
  // The pending work is made AWAITABLE, because a debounce is invisible
  // to a request that arrives inside it: completion and signature help
  // answer from `lastGood`, and for 100ms after a keystroke that is the
  // face of the PREVIOUS text. Retyping a member dot is the case that
  // shows it — the buffer without the dot compiles clean, so `lastGood`
  // has plain statement context there and the popup serves the whole
  // global scope instead of the receiver's members. Recompiling locally
  // would not fix it: tsgo holds the face text, so an answer has to come
  // from a face tsgo has actually been given. Hence flush-and-await
  // rather than compile-on-demand.
  //
  // The body is held so a FLUSH can run the very same one. Clearing the
  // timer and running a separate refresh would strand this promise
  // unresolved, and a second request already awaiting it would never be
  // answered — one flusher and one waiter is the ordinary case, because
  // an editor fires completion and signature help on the same keystroke.
  let done;
  const settled = new Promise((resolve) => { done = resolve; });
  state.refreshRun = async () => {
    state.refreshTimer = null;
    try { await refresh(document); }
    catch (err) { connection.console.error(`[rip] refresh failed: ${err.stack ?? err}`); }
    finally { if (state.settling === settled) state.settling = null; done(); }
  };
  state.refreshTimer = setTimeout(() => state.refreshRun(), 100);
  state.settling = settled;
}

// Await whatever refresh this document owes before reading its face.
// A request that arrives with the buffer already settled pays nothing:
// no timer, no pending refresh, and `lastGood` is current by definition.
async function settleDocument(uri) {
  const state = states.get(uri);
  if (!state) return;
  // Two ways to be behind: the debounce has not fired (flush it — the user
  // has stopped typing long enough to ask a question), or it fired and the
  // refresh is still in flight. Both end at the SAME promise, so any number
  // of concurrent requests share one refresh and all of them are answered.
  if (state.refreshTimer) {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = null;
    state.refreshRun?.();
  }
  if (state.settling) await state.settling;
}

documents.onDidChangeContent(({ document }) => scheduleRefresh(document));

documents.onDidClose(({ document }) => {
  const state = states.get(document.uri);
  if (!state) return;
  clearTimeout(state.refreshTimer);
  if (state.tsOpen && tsgo) {
    // The overlay closes; tsgo falls back to the disk mirror while the
    // file remains in the closure (some open buffer imports it).
    tsgo.client.notify('textDocument/didClose', { textDocument: { uri: state.tsUri } });
  }
  states.delete(document.uri);
  connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });

  // Closure membership after the close: if the file is still reachable
  // from an open buffer, DISK now owns it (re-materialize — an unsaved
  // buffer's mirror reverts to the saved state); otherwise it — and
  // whatever only it was keeping in — leaves the program.
  if (document.uri.startsWith('file://')) {
    let fsPath = null;
    try { fsPath = fileURLToPath(document.uri); } catch { /* non-path uri */ }
    if (fsPath) {
      materializedMirrors.delete(fsPath);
      if (computeActiveClosure().has(fsPath)) materializeClosure([fsPath]);
      pruneClosure().catch((err) => connection.console.error(`[rip] prune failed: ${err.stack ?? err}`));
    }
  }
});

// Watched files: .rip creates/changes/deletes maintain the CLOSURE
// (renames arrive as delete+create pairs) — a created file some importer
// was waiting on (pendingImports) pulls its subtree into the program; a
// change to a materialized file recompiles it; anything outside the
// closure at most refreshes its auto-import STUB, a one-file scan
// (demand-driven — the program never grows and nothing compiles from
// unrelated workspace churn). A tsconfig.json change — the workspace's,
// a chain member's, or a nested project's — regenerates the mirror
// configs. Everything forwards to tsgo as mirror-file events (tsgo
// invalidates on didChangeWatchedFiles), then every open document's
// diagnostics re-pull.
connection.onDidChangeWatchedFiles(async ({ changes }) => {
  if (!compile || !mirrorRoot) return;
  const forward = [];
  const ripChanged = new Set(); // closed .rip files this batch touched on disk
  let configChanged = false;
  let refreshAllForConfig = false;
  // Stash DISCOVERY is a compile input made of existence facts
  // (app/stash.rip and its index.rip/package.json anchor), so an event
  // that creates or deletes one flips the spec for a whole subtree
  // without touching any route's bytes.
  let stashDiscoveryChanged = false;
  for (const change of changes) {
    if (!change.uri.startsWith('file://')) continue;
    let fsPath;
    try { fsPath = fileURLToPath(change.uri); } catch { continue; }
    if (fsPath.startsWith(mirrorRoot + path.sep)) continue; // our own writes
    if (path.basename(fsPath) === 'tsconfig.json') {
      // The workspace's own tsconfig, any tsconfig.json in its resolved
      // extends chain, or a NESTED project's config (or chain member) —
      // each re-governs. Nested configs match through the per-project
      // chains; the shared root set never holds them, its builder
      // clears and refills it. (Chain members not named tsconfig.json
      // are outside the watch glob — recorded limitation.)
      const nested = [...wrapperDirs.values()].some(
        (m) => fsPath === m.sourceTsconfig || m.chain.has(fsPath),
      );
      if (workspaceRoot && (fsPath === path.join(workspaceRoot, 'tsconfig.json') || userConfigChain.has(fsPath) || nested)) {
        configChanged = true;
        forward.push({ uri: change.uri, type: change.type }); // tsgo re-reads the extends chain
      }
      continue;
    }
    if (path.basename(fsPath) === 'package.json') {
      // rip.strict / rip.noCheck live here; a change re-governs how open
      // docs present. package.json edits are rare, so refresh ALL open
      // docs and let each re-resolve its own nearest config (resolution
      // is per-doc, so this is correct in a monorepo — every doc lands on
      // its own answer). The generated tsconfig ALSO depends on
      // package.json now — hostFloorPath reads the workspace's
      // rip.strict to decide whether the host floor joins the program —
      // so the same edit regenerates it and re-governs tsgo, not just
      // presentation. (The floor's other input, node_modules/@types
      // presence, stays reload-only: VS Code's default watcher excludes
      // node_modules, so an install's events never arrive.) Skip
      // dependency churn: an install rewrites node_modules/**/package.json
      // and must not recompile the world.
      if (!fsPath.includes(`${path.sep}node_modules${path.sep}`)) {
        refreshAllForConfig = true;
        configChanged = true;
        // A created/deleted package.json is half an anchor pair.
        if (change.type !== FileChangeType.Changed) stashDiscoveryChanged = true;
      }
      continue;
    }
    if (!fsPath.endsWith('.rip')) continue;
    if (change.type !== FileChangeType.Changed &&
        (path.basename(fsPath) === 'index.rip' ||
         (path.basename(fsPath) === 'stash.rip' && path.basename(path.dirname(fsPath)) === 'app'))) {
      stashDiscoveryChanged = true;
    }
    if (documents.get(change.uri)) continue; // open buffers own their mirrors
    ripChanged.add(fsPath);
    const mirrorPath = mirrorPathOf(change.uri);
    // Closure membership is the BOOKKEEPING, never the disk: every real
    // face is manifest-tracked (revalidateCache seeds materializedMirrors
    // from the manifest; the orphan sweep removes anything unmanifested),
    // so a mirror on disk outside these three sets is an auto-import
    // STUB. Asking the disk instead made every stubbed workspace file
    // pass as in-closure, and any bystander churn — a branch switch — a
    // chain of synchronous full compiles.
    const inClosure = materializedMirrors.has(fsPath) || pendingImports.has(fsPath) ||
      cacheManifest.entries[fsPath] !== undefined;
    if (change.type === FileChangeType.Deleted) {
      materializedMirrors.delete(fsPath);
      faceCache.delete(fsPath);
      delete cacheManifest.entries[fsPath];
      scheduleManifestSave();
      // Importers that still name it get their TS2307 back; if the file
      // returns, the Created event pulls it back into the program. A
      // stub-only file has no importers by construction, so it joins no
      // pending set — a mass delete must not grow one.
      if (inClosure) pendingImports.add(fsPath);
      try {
        fs.rmSync(mirrorPath);
        forward.push({ uri: 'file://' + mirrorPath, type: FileChangeType.Deleted });
      } catch { /* no mirror to remove */ }
    } else {
      if (!inClosure) {
        if (!fs.existsSync(mirrorPath)) {
          // No mirror at all: a `.rip` CREATED this session. The startup
          // pass never saw it, and a file you just wrote is exactly the
          // one you are about to want to import, so it gets its stub now.
          // Backgrounded; a no-op for anything already spoken for.
          populateAutoImportStubs([fsPath]).catch(
            (err) => connection.console.error(`[rip] auto-import stub for a new file failed: ${err.stack ?? err}`),
          );
          continue;
        }
        // A STUB-backed bystander changed: re-derive the declaration-only
        // stub in place — a one-file scan, never a compile of its
        // transitive closure. The demand-driven invariant holds: the
        // program grows by imports and opens, not by disk churn. A file
        // that stopped exporting loses its stub (a stub with no
        // candidates is pure cost — the population pass's own rule).
        try {
          const text = stubTextFor(fsPath);
          if (text === null) {
            fs.rmSync(mirrorPath);
            forward.push({ uri: 'file://' + mirrorPath, type: FileChangeType.Deleted });
          } else {
            writeMirror(mirrorPath, text);
            forward.push({ uri: 'file://' + mirrorPath, type: FileChangeType.Changed });
          }
        } catch { /* candidacy only — never fatal */ }
        continue;
      }
      const existed = fs.existsSync(mirrorPath);
      materializedMirrors.delete(fsPath); // force the re-read/recompile
      const { touched } = materializeClosure([fsPath]);
      for (const p of touched) {
        // A path materialization TOUCHED can also be one it removed — a
        // compile failure takes out the auto-import stub that would
        // otherwise answer `any` in the real face's place — so the event
        // follows what is on disk now.
        forward.push({
          uri: 'file://' + p,
          type: !fs.existsSync(p) ? FileChangeType.Deleted
            : (p === mirrorPath && existed ? FileChangeType.Changed : FileChangeType.Created),
        });
      }
      // Never two compiles back-to-back without yielding: an event
      // batch touching N closure members must not block the message
      // loop for N materializations.
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  if (configChanged && mirrorRootReady) {
    // A pre-materialization config change has nothing to re-govern; the
    // first materialization generates from the current user config.
    // The host floor forwards too: its content can flip while the
    // tsconfig text stays identical (a rip.strict toggle changes only
    // the floor), and tsgo re-reads only what it is told changed.
    writeGeneratedTsconfig();
    forward.push({ uri: 'file://' + path.join(mirrorRoot, 'tsconfig.json'), type: FileChangeType.Changed });
    forward.push({ uri: 'file://' + path.join(mirrorRoot, HOST_FLOOR_NAME), type: FileChangeType.Changed });
    // Every project wrapper regenerates on the same trigger: a nested
    // tsconfig edit re-governs its own wrapper, and a package.json edit
    // can flip any project's host floor (rip.strict is read per
    // project). Config events are rare and the writes are idempotent,
    // so regenerating all of them beats attributing the edit to one.
    for (const [rel, meta] of wrapperDirs) {
      try {
        for (const p of writeProjectWrapper(rel, meta.sourceTsconfig)) {
          forward.push({ uri: 'file://' + p, type: FileChangeType.Changed });
        }
      } catch (err) {
        connection.console.error(`[rip] wrapper for ${rel} not regenerated (${err.message}) — it keeps its previous config`);
      }
    }
  }
  if (stashDiscoveryChanged) {
    // The discovery flipped for some subtree: every cached face and
    // every materialized-this-session mark is suspect. Clearing them
    // makes the next closure pass revisit each file through the
    // manifest's stashSpec revalidation — entries whose discovery
    // still matches revalidate cheaply, the flipped ones recompile —
    // and the open docs refresh below recompile under the new spec.
    rawCompileCache.clear();
    faceCache.clear();
    materializedMirrors.clear();
    refreshAllForConfig = true;
  }
  if (refreshAllForConfig) {
    // A package.json#rip edit re-governs every open doc's presentation
    // (strict/noCheck change the face itself, not just diagnostics), so
    // a full refresh — not a re-pull — with no window reload.
    await tsgoReady;
    for (const doc of documents.all()) {
      refresh(doc).catch((err) => connection.console.error(`[rip] config-change refresh failed: ${err.stack ?? err}`));
    }
  }
  if (!forward.length) return;
  await tsgoReady;
  if (tsgo) tsgo.client.notify('workspace/didChangeWatchedFiles', { changes: forward });
  // A dependency that changed ON DISK can change an open importer's GATE,
  // not just its answers: a created file starts carrying typed exports, a
  // deleted one stops, an edit can add or remove the annotation an import
  // was riding. The importer's checkedLines live in its lastGood, so a
  // re-pull through that gate would keep answering from yesterday's
  // annotations — an importer of a touched file gets a full refresh.
  // Everyone else re-pulls: their gates never read the changed file.
  const refreshed = new Set();
  if (ripChanged.size) {
    for (const doc of documents.all()) {
      let docPath;
      try { docPath = fileURLToPath(doc.uri); } catch { continue; }
      if (!cacheManifest.entries[docPath]?.imports?.some((p) => ripChanged.has(p))) continue;
      refreshed.add(doc.uri);
      refresh(doc).catch((err) => connection.console.error(`[rip] importer refresh failed: ${err.stack ?? err}`));
    }
  }
  for (const uri of states.keys()) {
    if (refreshed.has(uri)) continue;
    repullDiagnostics(uri).catch((err) => connection.console.error(`[rip] re-pull failed: ${err.stack ?? err}`));
  }
});

// ---- feature-request plumbing. Every feature shares the same
// two translations:
//   REQUEST: the position arrives in CURRENT-buffer coordinates;
//     lastGood may be older (staleness). Interpret against the
//     current text, translate into last-good coordinates through the
//     alignment guard (a position whose surroundings shifted answers
//     null rather than serving the wrong construct), then source →
//     generated through MappingStore.
//   RESULT: generated positions land in THREE kinds of file — the open
//     buffers (their live lastGood mappings translate, then the
//     alignment guard maps back into the current text), unopened
//     closure mirrors (recompile-for-mappings — same exactness
//     semantics as open buffers), and real TypeScript files
//     (node_modules, .d.ts, workspace .ts siblings — passed through
//     untouched). Synthetic generated spans DROP their results
//     (recorded policy — never pinned to unrelated source). The one
//     carve-out: an answer that names a MODULE (the ask sat inside an
//     import/export specifier) is the file itself — its face target
//     answers by URI at file start, no span consulted, because the
//     file IS the related source (ripModuleLocation).

// The request context for a feature call, or null when the position
// does not survive translation.
function requestContext(params) {
  const state = states.get(params.textDocument.uri);
  const good = state?.lastGood;
  if (!good || !tsgo || !state.tsOpen) return null;
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  const currentText = document.getText();
  const curLineStarts = currentText !== good.source ? lineStartsOf(currentText) : good.srcLineStarts;
  const align = staleOffsetMap(currentText, good.source);
  const ctx = { state, good, document, currentText, curLineStarts, align };
  if (params.position) {
    const curOffset = positionToOffset(curLineStarts, currentText.length, params.position);
    const offset = align.toGood(curOffset);
    if (offset === null) return null;
    ctx.offset = offset;
    // Three request flavors (translate.js): LENIENT for hover (a cover
    // row's start still answers about the construct), EXACT for
    // symbol-identifying requests (definition/references/rename — a
    // position with no verbatim twin answers null, never the wrong
    // symbol), CURSOR for completion/signature (one past a construct).
    ctx.genOffset = sourceOffsetToGenerated(good.mappings, offset, good.source, good.code);
    ctx.genExact = sourceOffsetToGeneratedExact(good.mappings, offset, good.source, good.code);
    ctx.genCursor = sourceCursorToGenerated(good.mappings, offset);
    // Completion alone widens to the dropped-slot landing: an object
    // literal's key after a trailing comma emits nothing to sit on.
    ctx.genSlot = ctx.genCursor ?? sourceSlotToGenerated(good.mappings, offset, good.source, good.code);
    if (ctx.genOffset === null && ctx.genSlot === null) return null;
    ctx.genPosition = ctx.genOffset === null ? null : offsetToPosition(good.genLineStarts, ctx.genOffset);
    ctx.genExactPosition = ctx.genExact === null ? null : offsetToPosition(good.genLineStarts, ctx.genExact);
  }
  return ctx;
}

// A generated [start, end) range in `face` coordinates → a source
// range in that face's text (last-good for open buffers, disk text for
// mirrors), or null (synthetic/unmapped). The verbatim edit-span
// mapper answers first — a range inside a cover-mapped construct whose
// bytes correspond (a name inside an import statement) maps precisely
// — then the cover fallback answers with the construct's whole span
// (a lowered construct's head is still a useful landing). `strict`
// suppresses the cover fallback: a range that IDENTIFIES a symbol (an
// outline entry's name) maps verbatim or not at all — a cover landing
// would present a construct's whole span as a name.
function faceRangeToSourceRange(face, range, { strict = false } = {}) {
  const s = positionToOffset(face.genLineStarts, face.code.length, range.start);
  const e = positionToOffset(face.genLineStarts, face.code.length, range.end);
  const span = generatedEditSpanToSource(face.mappings, s, e, face.source, face.code)
    ?? (strict ? null : generatedSpanToSource(face.mappings, s, e));
  if (!span) return null;
  return {
    start: offsetToPosition(face.srcLineStarts, span[0]),
    end: offsetToPosition(face.srcLineStarts, span[1]),
  };
}

// A last-good source range → the CURRENT buffer, through the alignment
// guard; null when either endpoint sits in the changed region.
function goodRangeToCurrent(ctx, range) {
  const s = ctx.align.toCurrent(positionToOffset(ctx.good.srcLineStarts, ctx.good.source.length, range.start));
  const e = ctx.align.toCurrent(positionToOffset(ctx.good.srcLineStarts, ctx.good.source.length, range.end), { exclusiveEnd: true });
  if (s === null || e === null || s > e) return null;
  return {
    start: offsetToPosition(ctx.curLineStarts, s),
    end: offsetToPosition(ctx.curLineStarts, e),
  };
}

// tsUri → the open buffer's state, for result attribution.
function stateByTsUri(tsUri) {
  for (const [uri, state] of states) {
    if (state.tsUri === tsUri && state.lastGood) return { uri, state };
  }
  return null;
}

// One tsgo result uri, classified. This is the SHARED policy — which
// uris are open buffers, which invert to a `.rip` source, which are
// mirror paths with no faithful inverse (__external__, or a session with
// no invertible root), and which are real TypeScript files — so the
// rules cannot drift between the consumers, which differ only in what
// they DO with each class.
function classifyTsUri(uri) {
  const open = stateByTsUri(uri);
  if (open) return { kind: 'open', open };
  if (!uri.startsWith('file://')) return null;
  let fsPath;
  try { fsPath = fileURLToPath(uri); } catch { return null; }
  const sourcePath = sourcePathOfMirror(fsPath);
  if (sourcePath !== null) return { kind: 'mirror', sourcePath };
  if (mirrorRelOf(fsPath) !== null) return { kind: 'mirror-opaque' };
  return { kind: 'real', fsPath };
}

// Location | Location[] | LocationLink[] → flat [{uri, range}] in tsgo
// coordinates, still unmapped. Links prefer the selection range — the
// symbol's own span, matching what a plain Location would carry.
function flattenLocations(result) {
  const list = result === null ? [] : Array.isArray(result) ? result : [result];
  return list.map((item) => item.targetUri
    ? { uri: item.targetUri, range: item.targetSelectionRange ?? item.targetRange }
    : { uri: item.uri, range: item.range });
}

// One result location {uri, range} in tsgo coordinates → a Rip
// location, or null (dropped: synthetic target, unmappable file, or a
// stale open buffer whose changed region swallowed the range).
// `strict` propagates to the range mapping (symbol-identifying
// results refuse cover landings).
function ripLocation(uri, range, { strict = false } = {}) {
  const target = classifyTsUri(uri);
  if (!target) return null;
  if (target.kind === 'open') {
    const { open } = target;
    const document = documents.get(open.uri);
    if (!document) return null;
    const good = open.state.lastGood;
    const srcRange = faceRangeToSourceRange(good, range, { strict });
    if (!srcRange) return null;
    const ctx = {
      good,
      align: staleOffsetMap(document.getText(), good.source),
      curLineStarts: document.getText() !== good.source ? lineStartsOf(document.getText()) : good.srcLineStarts,
    };
    const curRange = goodRangeToCurrent(ctx, srcRange);
    return curRange ? { uri: open.uri, range: curRange } : null;
  }
  // Inside the mirror tree but not invertible → drop; a REAL TypeScript
  // file (node_modules, .d.ts, workspace .ts siblings) passes through
  // untouched.
  if (target.kind === 'mirror-opaque') return null;
  if (target.kind === 'real') return { uri, range };
  const { sourcePath } = target;
  // An OPEN buffer that reaches this branch has no usable lastGood (it
  // never compiled) — the disk face's positions describe a text the
  // buffer no longer shows, so the result drops rather than lies.
  if (documents.get('file://' + sourcePath)) return null;
  const face = faceOf(sourcePath);
  if (!face) return null;
  const srcRange = faceRangeToSourceRange(face, range, { strict });
  return srcRange ? { uri: 'file://' + sourcePath, range: srcRange } : null;
}

// Location | Location[] | LocationLink[] → Rip locations (flat).
function ripLocations(result) {
  return flattenLocations(result).map(({ uri, range }) => ripLocation(uri, range)).filter(Boolean);
}

// A definition answer FOR A MODULE SPECIFIER names a file, not a symbol:
// for a FACE target the uri is the whole content of the answer. The
// range tsgo reports lives in face coordinates that need not survive the
// map-back — an empty range at offset 0 sits inside the runtime preamble
// whenever the target's face delivers helpers, and a whole-file span
// covers no single construct — so range-mapping such an answer drops
// exactly the modules whose faces carry any synthetic lead-in. A face
// target therefore answers the FILE, at its start (stable in every
// version of the text, so no face positions are consulted): an open
// target with a lastGood answers its own buffer uri; one without answers
// through mirror inversion — the same file, spelled by the server; a
// mirror whose `.rip` source no longer exists drops (tsgo can outrun a
// deletion by one answer); a non-invertible mirror (__external__) drops.
// A REAL TypeScript file keeps tsgo's own range — its coordinates are
// its own, and an ambient `declare module` answer points mid-file at the
// declaration, which the pin would erase.
function ripModuleLocation(uri, range) {
  const target = classifyTsUri(uri);
  if (!target || target.kind === 'mirror-opaque') return null;
  if (target.kind === 'real') return { uri, range };
  const fileStart = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
  if (target.kind === 'open') return { uri: target.open.uri, range: fileStart };
  if (!fs.existsSync(target.sourcePath)) return null;
  return { uri: 'file://' + target.sourcePath, range: fileStart };
}

// Location | Location[] | LocationLink[] → the named modules' Rip
// locations (flat).
function ripModuleLocations(result) {
  return flattenLocations(result).map(({ uri, range }) => ripModuleLocation(uri, range)).filter(Boolean);
}

async function tsgoRequest(method, params, label) {
  try {
    return await tsgo.client.request(method, params);
  } catch (err) {
    connection.console.error(`[rip] ${label} failed: ${err.message}`);
    return null;
  }
}

// ---- write-site hover enrichment: tsgo's
// quickinfo for an evolving let answers `let x: any` at the declaration
// and every WRITE reference — the evolving type manifests only at READ
// references (ground truth probed against the pinned tsgo). When a hover answer is exactly that shape,
// the server asks tsgo for the symbol's references (document order,
// requesting face first) and presents the first reference whose
// quickinfo answers a DIFFERENT declaration type — by construction a
// read, since the declaration and every write answer the evolving
// base, and an EXPLICIT `: any` annotation answers `any` at reads too,
// so it self-corrects to the original. Every step is a real LSP query
// against the face; nothing is invented, and no qualifying reference
// (no reads anywhere) presents tsgo's original answer unchanged —
// plain-TS behavior. Cost: fires only on the evolving-any answer
// shape, probes at most REF_PROBE_LIMIT references, memoized per face
// version, never an extra compile.
const HOVER_EVOLVING_ANY = /^```typescript\r?\n(?:let|var) [A-Za-z_$][\w$]*: any\r?\n```\r?\n?$/;
const HOVER_LET_DECL = /^```typescript\r?\n(?:let|var) /;
const REF_PROBE_LIMIT = 16;

// Alias-union hover ordering (the old runtime/TS6 display parity): TS7 renders
// literal unions in checker-internal order (effectively sorted), but
// authors read their unions in DECLARATION order ('pending' before
// 'done' means something). When the hover is a one-line `type N = A |
// B | …` and the face declares the same member SET for N, re-order
// the display to the declaration. Same type either way — this touches
// presentation only, and only when the sets match exactly.
function reorderUnionHover(ctx, contents) {
  const value = contents?.value;
  if (typeof value !== 'string') return null;
  const fence = /(```(?:typescript|ts)\n)(\s*(?:export )?type ([A-Za-z_$][\w$]*)\s*=\s*)([^\n]+?);?\n(```)/.exec(value);
  if (!fence) return null;
  const [, open, head, name, rhs, close] = fence;
  const splitUnion = (t) => {
    const parts = [];
    let depth = 0, cur = '', inStr = null;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (inStr) { if (c === '\\') { cur += c + (t[i + 1] ?? ''); i++; continue; } if (c === inStr) inStr = null; cur += c; continue; }
      if (c === '"' || c === "'") { inStr = c; cur += c; continue; }
      if ('<([{'.includes(c)) depth++;
      else if ('>)]}'.includes(c)) depth--;
      if (c === '|' && depth === 0) { parts.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    parts.push(cur.trim());
    return parts.filter((p) => p !== '');
  };
  const hoverMembers = splitUnion(rhs);
  if (hoverMembers.length < 2) return null;
  const decl = new RegExp(`^(?:export )?type ${name}\\s*=\\s*(.+?);?$`, 'm').exec(ctx.good.code);
  if (!decl) return null;
  const declMembers = splitUnion(decl[1]);
  if (declMembers.length !== hoverMembers.length) return null;
  const set = new Set(hoverMembers);
  if (!declMembers.every((mem) => set.has(mem))) return null;
  const reordered = value.replace(fence[0], `${open}${head}${declMembers.join(' | ')}\n${close}`);
  return { ...contents, value: reordered };
}

// Reactive-cell hovers present the VALUE type: the
// author reads `clicks := 0` as a number, not as its container. A
// hover whose type is EXACTLY the cell shape `{ value: T; read(): T }`
// (both Ts equal — the brand doctrine keeps user literals out of this
// shape) rewrites to `let N: T` for a state (mutable value, the old runtime's
// spelling) or `const N: T` for a computed (readonly). Anything else
// passes through untouched.
//
// ONE RULE, UNIFORMLY APPLIED: infer when unannotated, honor the annotation
// when present. The pass-through above is where the second half is enacted,
// so it is deliberate and not a gap — an annotated effect
// (`clickLogger: Function ~> …`) hovers `Function` and is left alone, never
// narrowed to `() => void`. An annotation is the author's statement of the
// type and the hover shows it back; whether it is a GOOD annotation is the
// author's business. The editor's job is to be honest about what the source
// says, not to second-guess it.
// A component MEMBER takes the same presentation for the same reason —
// the author declared `people := []` and reads it as an array — at its
// DECLARATION and at every IN-BODY read (where the lowering appended
// `.value` to the bare name the author wrote). `atMemberDecl` says the
// request landed on one of those spans, both carried by the compiler's
// memberDecls channel; anywhere else the member's container is real (a
// consumer holding an instance writes `inst.people.value`) and passes
// through untouched.
function presentReactiveCellHover(contents, atMemberDecl = false) {
  const value = contents?.value;
  if (typeof value !== 'string') return null;
  const fence = /(```(?:typescript|ts)\n)([^]*?)(\n?```)/.exec(value);
  if (!fence) return null;
  // tsgo renders object types with internal line breaks / run-on
  // spaces and a trailing `;` — normalize before matching.
  const flat = fence[2].replace(/\s+/g, ' ').trim();
  // The member arm's qualifier is whatever TypeScript prints before the
  // final dot, NOT an identifier: a GENERIC component's containing type
  // arrives with its parameter list (`Palette<TShade extends string>`),
  // and anything narrower silently leaves the container standing on every
  // generic component. The greedy run cannot swallow the type, which is
  // anchored behind `: { … value: `.
  const m = /^(?:(const|let) ([A-Za-z_$][\w$]*)|\(property\) ((?:.+\.)?[A-Za-z_$][\w$]*)): \{ (readonly )?value: (.+); read\(\): (.+?)(?:; touch\??\(\): void)?;? \}$/.exec(flat);
  if (!m) return null;
  const [, , plain, qualified, ro, t, readT] = m;
  const member = qualified !== undefined;
  if (member && !atMemberDecl) return null;
  // depth guard: the `;` split above is greedy on `t` — verify T and
  // read()'s return agree after the same normalization (the brand
  // shape), else pass through.
  if (t.trim() !== readT.trim()) return null;
  const head = member ? `(property) ${qualified}` : `${ro ? 'const' : 'let'} ${plain}`;
  const reworded = value.replace(fence[0], `${fence[1]}${head}: ${t.trim()}${fence[3]}`);
  return { ...contents, value: reworded };
}

async function enrichEvolvingAnyHover(ctx, hover) {
  const value = hover?.contents?.value;
  if (typeof value !== 'string' || !HOVER_EVOLVING_ANY.test(value)) return null;
  if (ctx.genExactPosition === null) return null;
  const state = ctx.state;
  const cacheKey = `${state.tsVersion}:${ctx.genExact}`;
  if (state.hoverEnrich.has(cacheKey)) return state.hoverEnrich.get(cacheKey);

  let result = null;
  const refs = await tsgoRequest('textDocument/references', {
    textDocument: { uri: state.tsUri },
    position: ctx.genExactPosition,
    context: { includeDeclaration: false },
  }, 'hover-enrichment references');
  if (Array.isArray(refs) && refs.length) {
    const ordered = [...refs].sort((a, b) =>
      (a.uri === state.tsUri ? 0 : 1) - (b.uri === state.tsUri ? 0 : 1)
      || (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0)
      || a.range.start.line - b.range.start.line
      || a.range.start.character - b.range.start.character);
    for (const ref of ordered.slice(0, REF_PROBE_LIMIT)) {
      const probe = await tsgoRequest('textDocument/hover', {
        textDocument: { uri: ref.uri },
        position: ref.range.start,
      }, 'hover-enrichment quickinfo');
      const probed = probe?.contents?.value;
      if (typeof probed === 'string' && HOVER_LET_DECL.test(probed) && !HOVER_EVOLVING_ANY.test(probed)) {
        result = probe.contents;
        break;
      }
    }
  }
  state.hoverEnrich.set(cacheKey, result);
  return result;
}

connection.onHover(async (params) => {
  await tsgoReady;
  // Position-identifying surfaces (definition, references) survive a stale
  // face because staleOffsetMap re-aligns coordinates. A TYPE cannot be
  // re-aligned: change a binding's annotation and hover inside the debounce
  // and the old type is simply the wrong answer. So hover settles too.
  await settleDocument(params.textDocument.uri);
  const ctx = requestContext(params);
  if (!ctx || ctx.genPosition === null) return null;
  // A position the lowering owns whole answers nothing. tsgo would
  // describe the minted symbol its own emission put there — truthfully,
  // and about something the user never wrote.
  if (inNoUserSymbolSpan(ctx.good.silent ?? [], ctx.offset)) return null;
  const memberDecl = memberDeclKind(ctx.good.memberDecls ?? [], ctx.offset);

  const hover = await tsgoRequest('textDocument/hover', {
    textDocument: { uri: ctx.state.tsUri },
    position: ctx.genPosition,
  }, 'hover');
  if (!hover) return null;
  // A position whose mapping falls to a cover row over render scaffold
  // answers with the lowering's own locals (`let _el14: any`) — never a
  // user symbol. The decline is the machinery interim (RULINGS.md);
  // SCAFFOLD_HOVER (translate.js) is the one shared pattern, and its
  // `: any` requirement spares an author's own single-underscore
  // binding, whose hover carries a real type.
  if (typeof hover.contents?.value === 'string' && SCAFFOLD_HOVER.test(hover.contents.value)) return null;

  let contents = (await enrichEvolvingAnyHover(ctx, hover)) ?? hover.contents;
  contents = reorderUnionHover(ctx, contents) ?? contents;
  contents = presentReactiveCellHover(contents, memberDecl === 'value') ?? contents;

  // The response range travels the reverse path: generated → last-good
  // source → current buffer. If it does not survive both hops intact,
  // the hover ships without a range.
  let range;
  if (hover.range) {
    const srcRange = faceRangeToSourceRange(ctx.good, hover.range);
    if (srcRange) range = goodRangeToCurrent(ctx, srcRange) ?? undefined;
  }
  return { contents, ...(range ? { range } : {}) };
});

// The import/export specifier STRING span the last-good offset sits in
// (stores coordinates, quotes included), or null. Membership is the
// MODULE dispatch: a position inside a specifier asks about the module,
// whether or not the span still maps into the edited buffer — an
// unflushed edit that swallows one endpoint must not flip the ask back
// to symbol treatment while the cursor's own offset aligns.
function specifierSpanAt(ctx) {
  const stores = ctx.good.stores;
  if (!stores?.nodesByKind) return null;
  for (const kind of ['import', 'export']) {
    for (const node of stores.nodesByKind(kind)) {
      const src = stores.role(node.nodeId, 'source');
      if (!src || typeof src.sourceStart !== 'number') continue;
      if (ctx.offset < src.sourceStart || ctx.offset >= src.sourceEnd) continue;
      return src;
    }
  }
  return null;
}

// The specifier span as a current-buffer range — what a client
// underlines for go-to-definition: left to the editor's word pattern, a
// path like `rip/http` underlines one segment at a time (words break at
// `/`, `-`, `.`) where TypeScript underlines the whole string literal —
// as LocationLink's originSelectionRange, which only a linkSupport
// client is allowed to receive. Null when the span does not survive
// into the edited buffer; the answer then ships without an origin.
function specifierOriginOf(ctx, span) {
  return goodRangeToCurrent(ctx, {
    start: offsetToPosition(ctx.good.srcLineStarts, span.sourceStart),
    end: offsetToPosition(ctx.good.srcLineStarts, span.sourceEnd),
  });
}

connection.onDefinition(async (params) => {
  await tsgoReady;
  const ctx = requestContext(params);
  if (!ctx) return null;
  // Inside an import specifier the EXACT flavor can refuse honestly: the
  // face normalizes quote style, so a double-quoted string's bytes have
  // no verbatim twin. The whole specifier names ONE module — the stores
  // just said which — so the lenient position cannot land on a wrong
  // symbol here, and nowhere else is it accepted.
  const span = specifierSpanAt(ctx);
  const position = ctx.genExactPosition ?? (span ? ctx.genPosition : null);
  if (position === null) return null;
  const result = await tsgoRequest('textDocument/definition', {
    textDocument: { uri: ctx.state.tsUri },
    position,
  }, 'definition');
  // A position inside a specifier asked about the MODULE, and the answer
  // is read as one (ripModuleLocations).
  const locations = span ? ripModuleLocations(result) : ripLocations(result);
  const origin = span && locations.length ? specifierOriginOf(ctx, span) : null;
  if (clientDefinitionLinks && origin) {
    return locations.map((loc) => ({
      originSelectionRange: origin,
      targetUri: loc.uri,
      targetRange: loc.range,
      targetSelectionRange: loc.range,
    }));
  }
  return locations;
});

// Type definition: served like definition (EXACT flavor, synthetic
// drops, recompile-for-mappings for unopened members, real-.ts
// pass-through), including the module treatment — at a specifier tsgo
// answers the module file whole, the module-shaped span the range
// map-back cannot serve. A null answer is honest for primitive-typed
// symbols — a number has no type-declaration site.
connection.onTypeDefinition(async (params) => {
  await tsgoReady;
  const ctx = requestContext(params);
  if (!ctx) return null;
  const span = specifierSpanAt(ctx);
  const position = ctx.genExactPosition ?? (span ? ctx.genPosition : null);
  if (position === null) return null;
  const result = await tsgoRequest('textDocument/typeDefinition', {
    textDocument: { uri: ctx.state.tsUri },
    position,
  }, 'type definition');
  return span ? ripModuleLocations(result) : ripLocations(result);
});

// Implementation and references take NO module treatment: at a
// specifier, tsgo answers the import-site string literals — verbatim
// spans in each importing face that the ordinary range map-back serves.
connection.onImplementation(async (params) => {
  await tsgoReady;
  const ctx = requestContext(params);
  if (!ctx || ctx.genExactPosition === null) return null;
  const result = await tsgoRequest('textDocument/implementation', {
    textDocument: { uri: ctx.state.tsUri },
    position: ctx.genExactPosition,
  }, 'implementation');
  return ripLocations(result);
});

connection.onReferences(async (params) => {
  await tsgoReady;
  const ctx = requestContext(params);
  if (!ctx || ctx.genExactPosition === null) return null;
  const result = await tsgoRequest('textDocument/references', {
    textDocument: { uri: ctx.state.tsUri },
    position: ctx.genExactPosition,
    context: params.context ?? { includeDeclaration: true },
  }, 'references');
  return ripLocations(result);
});

// ---- completions: the context position travels Rip → TS with CURSOR
// semantics (a cursor one past `msg.sub` maps one past the generated
// `msg.sub`); returned edit ranges travel TS → Rip; scaffolding labels
// (`__` runtime, `_ref` temps) filter out; detail/documentation are
// resolve-lazy through tsgo's own resolve, keyed by the raw item the
// server kept.

// A file-level directive (`# @ts-nocheck` — emitted as the face's
// FIRST line) must stay first on the Rip side too: no statement
// may precede it, so an insertion anchored at or inside its source
// line pushes past it — the zero-delta cover match at offset 0 would
// otherwise anchor a new import ABOVE the directive, demoting it and
// resurrecting every suppressed error. Nocheck rows identify by their
// SPELLING (isNocheckDirectiveRow), never by generated offset — in a
// hoist-free face an ATTACHED directive's row sits at offset 0 too,
// and pushing past THAT one would split it from its governed line.
// No clean push (no newline after the directive) answers null — the
// caller's label-only fallback is the honest disposition.
function pushPastFilePrefix(face, at) {
  for (const row of face.mappings.rows) {
    if (row.role !== 'tsDirective' || !isNocheckDirectiveRow(row, face.source)) continue;
    if (at > row.sourceEnd) continue;
    const lineEnd = face.source.indexOf('\n', row.sourceEnd);
    return lineEnd < 0 ? null : lineEnd + 1;
  }
  return at;
}

// One face TextEdit → a source-coordinate TextEdit against `face`, or
// null. Zero-width edits are INSERTIONS (auto-import lines) and map
// through the insertion-point rule; everything else maps as a span —
// verbatim-verified first, then the statement-granular whole-import-
// line shape (the budget: the organizeImports family).
function faceEditToSourceEdit(face, edit) {
  const s = positionToOffset(face.genLineStarts, face.code.length, edit.range.start);
  const e = positionToOffset(face.genLineStarts, face.code.length, edit.range.end);
  let span;
  let newText = ripImportText(edit.newText);
  if (s === e) {
    let at = generatedInsertionToSource(face.mappings, s, face.source, face.code);
    if (at !== null) at = pushPastFilePrefix(face, at);
    // The directive-adjacency twin of the nocheck push: an anchor
    // landing directly beneath a next-line-attached directive hoists
    // above it, keeping the directive attached to its governed line.
    if (at !== null) at = insertionAboveAttachedDirectives(face.mappings, at, face.source);
    span = at === null ? null : [at, at];
  } else {
    // Strict: an edit replaces exactly the bytes the user sees, so only
    // verbatim-verified spans qualify — a cover row's whole-construct
    // fallback would let a rename swallow an entire import line.
    span = generatedEditSpanToSource(face.mappings, s, e, face.source, face.code);
    if (!span) {
      const whole = wholeImportLinesEdit(face, s, e, edit.newText);
      if (whole) ({ span, newText } = whole);
    }
  }
  // Either path may have refused an edit that is really a change to ONE
  // import statement — the face's clause is not always the author's, so the
  // bytes tsgo rewrites can be generated-only. Widen to a whole-line rewrite
  // of that statement: a span the user CAN see, carrying the same guards.
  if (!span) {
    const widened = importLineSpanEdit(face, s, e, edit.newText);
    if (widened) ({ span, newText } = widened);
  }
  if (!span) return null;
  return {
    range: {
      start: offsetToPosition(face.srcLineStarts, span[0]),
      end: offsetToPosition(face.srcLineStarts, span[1]),
    },
    newText,
  };
}

// Face TextEdits for the REQUESTING document → current-buffer edits,
// or null when any edit fails to map (all-or-nothing: a half-applied
// auto-import is worse than none).
function faceEditsToCurrent(ctx, edits) {
  const mapped = [];
  for (const edit of edits) {
    const srcEdit = faceEditToSourceEdit(ctx.good, edit);
    if (!srcEdit) return null;
    const range = goodRangeToCurrent(ctx, srcEdit.range);
    if (!range) return null;
    mapped.push({ range, newText: srcEdit.newText });
  }
  return mapped;
}

// The context to relay, or null for an ordinary request. A trigger
// character outside the advertised set answered no promise this server
// made, and relaying one is how tsgo comes to answer nothing (space) or
// to panic outright (comma, which signature help advertises). The
// position still carries the whole question, so such a request is
// served rather than refused.
function relayableCompletionContext(context) {
  if (!context) return null;
  if (context.triggerKind !== CompletionTriggerKind.TriggerCharacter) return context;
  return completionTriggerCharacters.includes(context.triggerCharacter) ? context : null;
}

function ripCompletionItem(ctx, raw, index) {
  const item = {
    label: raw.label,
    kind: raw.kind,
    data: { uri: ctx.document.uri, index },
  };
  if (raw.labelDetails) {
    item.labelDetails = { ...raw.labelDetails };
    if (item.labelDetails.description) {
      item.labelDetails.description = scrubFaceArtifacts(item.labelDetails.description);
    }
  }
  for (const key of ['sortText', 'filterText', 'insertText', 'preselect', 'tags']) {
    if (raw[key] !== undefined) item[key] = raw[key];
  }
  if (raw.detail) item.detail = scrubFaceArtifacts(raw.detail);
  if (raw.documentation) item.documentation = raw.documentation;
  if (raw.textEdit?.range) {
    const mapped = faceEditsToCurrent(ctx, [raw.textEdit]);
    // An unmappable primary edit degrades to label insertion at the
    // client's word range — never a wrong-place edit.
    if (mapped) item.textEdit = { ...raw.textEdit, range: mapped[0].range, newText: mapped[0].newText };
  }
  if (raw.additionalTextEdits?.length) {
    const mapped = faceEditsToCurrent(ctx, raw.additionalTextEdits);
    if (mapped) item.additionalTextEdits = mapped;
    else return null; // an auto-import that cannot land drops the item, honestly
  }
  return item;
}

connection.onCompletion(async (params) => {
  await tsgoReady;
  // The buffer being typed is the whole point of these two
  // surfaces, so they wait for it rather than answering about the
  // text of 100ms ago.
  await settleDocument(params.textDocument.uri);
  const ctx = requestContext(params);
  if (!ctx) return null;
  const genCursor = ctx.genSlot ?? ctx.genExact;
  if (genCursor === null) return null;
  const context = relayableCompletionContext(params.context);
  const result = await tsgoRequest('textDocument/completion', {
    textDocument: { uri: ctx.state.tsUri },
    position: offsetToPosition(ctx.good.genLineStarts, genCursor),
    ...(context ? { context } : {}),
  }, 'completion');
  if (!result) return null;
  const rawItems = Array.isArray(result) ? result : result.items ?? [];
  ctx.state.lastCompletion = rawItems;
  const items = [];
  for (let i = 0; i < rawItems.length; i++) {
    if (isScaffoldingLabel(rawItems[i].label)) continue;
    const item = ripCompletionItem(ctx, rawItems[i], i);
    if (item) items.push(item);
  }
  return { isIncomplete: Array.isArray(result) ? false : !!result.isIncomplete, items };
});

connection.onCompletionResolve(async (item) => {
  const { uri, index } = item.data ?? {};
  const state = uri === undefined ? null : states.get(uri);
  const raw = state?.lastCompletion?.[index];
  if (!raw || !tsgo) return item;
  const resolved = await tsgoRequest('completionItem/resolve', raw, 'completion resolve');
  if (!resolved) return item;
  if (resolved.detail) item.detail = scrubFaceArtifacts(resolved.detail);
  if (resolved.documentation) {
    item.documentation = typeof resolved.documentation === 'string'
      ? scrubFaceArtifacts(resolved.documentation)
      : { ...resolved.documentation, value: scrubFaceArtifacts(resolved.documentation.value ?? '') };
  }
  if (resolved.additionalTextEdits?.length) {
    const ctx = requestContext({ textDocument: { uri } });
    const mapped = ctx ? faceEditsToCurrent(ctx, resolved.additionalTextEdits) : null;
    if (mapped) item.additionalTextEdits = mapped;
    else connection.console.log(`[rip] auto-import edit for '${item.label}' did not map — inserted without the import`);
  }
  return item;
});

// ---- signature help: the position maps with cursor semantics (the
// active position sits between a call's argument tokens); the response
// carries no positions — signatures, activeSignature, and
// activeParameter pass through as tsgo computed them, which is what
// keeps the indices correct across bodiless overload rows (the face
// prints them adjacent to their implementation, and tsgo numbers the
// overload list itself).
connection.onSignatureHelp(async (params) => {
  await tsgoReady;
  // The buffer being typed is the whole point of these two
  // surfaces, so they wait for it rather than answering about the
  // text of 100ms ago.
  await settleDocument(params.textDocument.uri);
  const ctx = requestContext(params);
  if (!ctx) return null;
  const genCursor = ctx.genCursor ?? ctx.genExact;
  if (genCursor === null) return null;
  const result = await tsgoRequest('textDocument/signatureHelp', {
    textDocument: { uri: ctx.state.tsUri },
    position: offsetToPosition(ctx.good.genLineStarts, genCursor),
    ...(params.context ? { context: params.context } : {}),
  }, 'signature help');
  if (!result?.signatures) return null;
  return {
    ...result,
    signatures: result.signatures.map((sig) => ({
      ...sig,
      label: scrubFaceArtifacts(sig.label),
    })),
  };
});

// ---- semantic tokens: tsgo's relative-encoded data decodes against
// the FACE text; each token's generated span maps to Rip only where
// the correspondence is VERBATIM — an exact row (one sorted sweep;
// annotation tokens have real Rip spans in the face), or the
// edit-span mapper's verbatim-verified cover prefix (a rendered
// declaration's NAME — `interface Point` is one cover row whose bytes
// match the source through the name). Synthetic bytes and TS-only
// scaffolding have neither and drop. Hoisting emits one source name at
// several generated positions (the `let` line and the assignment), so
// mapped tokens DEDUP by source span — modifiers union, the
// declaration modifier from the hoist line survives on the merged
// token.
//
// Reactive STATE (`:=`) is the one form where TypeScript's modifiers lie. Its
// lowering binds a cell with `const`, so tsgo classifies the identifier
// `readonly` — true of the container, false of the name: `clicks = 5` is legal
// rip and lowers to `clicks.value = 5`. Forwarded as-is, the editor paints the
// only reactive form you may assign to as a constant. The compile reports the
// generated span of each state name (`mutables`), and the bit is cleared there
// and nowhere else — `=!`, `~=` and `~>` also emit `const` and really ARE
// immutable, so they keep it.
// Does the module `specifier` names, resolved from `fromDir`, declare
// `name` as an enum? An OPEN buffer answers from its own last-good
// compile; a disk file from its manifest entry, which the closure fills
// as it materializes and which is invalidated with the file's source
// hash. Unknown (not in the closure, or unreadable) answers no — a
// missing correction leaves TypeScript's own answer, which is the
// conservative direction.
function declaresEnum(fromDir, specifier, name) {
  if (fromDir === null || !specifier.endsWith('.rip')) return false;
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return false;
  const abs = path.resolve(fromDir, specifier);
  const open = states.get('file://' + abs);
  if (open?.lastGood?.enumNames) return open.lastGood.enumNames.includes(name);
  return (cacheManifest.entries[abs]?.enumNames ?? []).includes(name);
}

function ripSemanticTokens(ctx, data) {
  const mapSpan = exactSpanMapper(ctx.good.mappings);
  const roIndex = semanticTokensLegend?.tokenModifiers?.indexOf('readonly') ?? -1;
  const roBit = roIndex < 0 ? 0 : (1 << roIndex);
  // Keyed by START offset: a state name's span IS the token, so the token's
  // generated start equals the span's exactly. A set lookup per token, rather
  // than a scan of every span for every token on a surface that fires on each
  // edit.
  const mutableStarts = new Set((ctx.good.mutables ?? []).map(([s]) => s));
  // Same keying, the other correction: an enum name's TYPE, not a
  // modifier bit. -1 when the client's legend omits `enum`, and then the
  // rewrite is skipped rather than pointed at some other type's index.
  const enumType = semanticTokensLegend?.tokenTypes?.indexOf('enum') ?? -1;
  const enumStarts = new Set((ctx.good.enums ?? []).map(([s]) => s));
  // The third correction of the same shape: TypeScript classifies a binding
  // from its DECLARATION's initializer, so `let Shape = class {…}` colors
  // `class` on its own and reports nothing here — but a forward reference
  // splits the declaration from the class expression, and `let Box;` is a
  // variable as far as tsgo can see. -1 when the client's legend omits
  // `class`, and then the rewrite is skipped rather than pointed at some
  // other type's index, exactly as the enum correction does.
  const classType = semanticTokensLegend?.tokenTypes?.indexOf('class') ?? -1;
  const classStarts = new Set((ctx.good.classDecls ?? []).map(([s]) => s));
  // The fourth correction of the same shape: a render loop's body lowers
  // to a block-function factory, so its item/index binding genuinely IS a
  // parameter in the face — the factory header, the keyed callback, every
  // read — and tsgo classifies each occurrence so. The author declared a
  // loop variable. The compiler reports each occurrence's span, so a
  // handler's own `(e) ->` parameter — a parameter in the source too — is
  // never touched: the correction is the span, not a rule over the block.
  const variableType = semanticTokensLegend?.tokenTypes?.indexOf('variable') ?? -1;
  const loopStarts = new Set((ctx.good.loopVars ?? []).map(([s]) => s));
  // The one correction that DROPS instead of retyping: a render attribute
  // name's token is suppressed, so a plain prop (whose `property` maps
  // exactly and would forward) reads like its two-way-bound neighbor
  // (whose minted key cannot map and already drops) — every attribute
  // falls back to the TextMate attribute scope, the one fact all of them
  // share. Never the reverse: no token is invented at the bind's span,
  // and the drop is keyed by the compiler's span, so a property inside an
  // attribute's VALUE keeps its own.
  const attrStarts = new Set((ctx.good.attrNames ?? []).map(([s]) => s));
  // An IMPORTED enum carries the same merged-symbol `type` classification
  // its declaration does, and the importing file's compile cannot know
  // that — the kind lives in the declaring module. The compiler reports
  // which references are imports and from where; the module answers.
  // Only `./`-relative `.rip` specifiers resolve, matching the closure's
  // own rule (mirror.js): a package import is TypeScript's to classify.
  for (const [genStart, , importedName, specifier] of (ctx.good.importedRefs ?? [])) {
    if (declaresEnum(ctx.good.dir, specifier, importedName)) enumStarts.add(genStart);
  }
  const tokens = new Map(); // start → { start, length, type, modifiers }
  let line = 0, char = 0;
  for (let i = 0; i + 4 < data.length; i += 5) {
    line += data[i];
    char = data[i] === 0 ? char + data[i + 1] : data[i + 1];
    const length = data[i + 2];
    const genStart = positionToOffset(ctx.good.genLineStarts, ctx.good.code.length, { line, character: char });
    if (attrStarts.has(genStart)) continue;
    const srcStart = mapSpan(genStart, genStart + length)
      ?? generatedEditSpanToSource(ctx.good.mappings, genStart, genStart + length, ctx.good.source, ctx.good.code)?.[0]
      ?? null;
    if (srcStart === null) continue;
    const curStart = ctx.align.toCurrent(srcStart);
    const curEnd = ctx.align.toCurrent(srcStart + length, { exclusiveEnd: true });
    if (curStart === null || curEnd !== curStart + length) continue;
    // Cleared BEFORE the dedup union below, or a second generated manifestation
    // of the same name would put the bit straight back.
    let modifiers = data[i + 4];
    if (roBit && mutableStarts.has(genStart)) modifiers &= ~roBit;
    // An enum name carries the merged symbol's `readonly` too, off the
    // `const` object half. The construct is a declaration, not a
    // binding whose mutability is at issue, so the corrected token
    // drops it with the type — TypeScript's own enum tokens carry
    // neither.
    let type = data[i + 3];
    if (enumType >= 0 && enumStarts.has(genStart)) {
      type = enumType;
      modifiers &= ~roBit;
    }
    if (classType >= 0 && classStarts.has(genStart)) type = classType;
    if (variableType >= 0 && loopStarts.has(genStart)) type = variableType;
    const key = curStart * 0x100000 + length;
    const existing = tokens.get(key);
    if (existing && existing.type === type) {
      existing.modifiers |= modifiers;
    } else if (!existing) {
      tokens.set(key, { start: curStart, length, type, modifiers });
    }
  }
  const builder = new SemanticTokensBuilder();
  for (const t of [...tokens.values()].sort((a, b) => a.start - b.start)) {
    const pos = offsetToPosition(ctx.curLineStarts, t.start);
    builder.push(pos.line, pos.character, t.length, t.type, t.modifiers);
  }
  return builder.build();
}

connection.languages.semanticTokens.on(async (params) => {
  await tsgoReady;
  // Tokens settle like hover does, but for a harsher reason: the editor
  // CACHES a token answer and only re-asks on an edit or a server-pushed
  // refresh (we push none). An answer from before the first compile is
  // `{data: []}`, and identifiers have no TextMate fallback — the file
  // would sit uncolored until something else forces a re-request.
  await settleDocument(params.textDocument.uri);
  const ctx = requestContext(params);
  if (!ctx) return { data: [] };
  const result = await tsgoRequest('textDocument/semanticTokens/full', {
    textDocument: { uri: ctx.state.tsUri },
  }, 'semantic tokens');
  if (!result?.data) return { data: [] };
  return ripSemanticTokens(ctx, result.data);
});

connection.languages.semanticTokens.onRange(async (params) => {
  await tsgoReady;
  // Same settle as the full request: a range answer is cached the same way.
  await settleDocument(params.textDocument.uri);
  const ctx = requestContext(params);
  if (!ctx) return { data: [] };
  // Hoisting reorders: a Rip range's tokens live at SCATTERED generated
  // offsets (the hoist line above, the assignment below), so a single
  // generated range cannot cover them. tsgo answers full; the mapped
  // tokens filter to the requested Rip range.
  const result = await tsgoRequest('textDocument/semanticTokens/full', {
    textDocument: { uri: ctx.state.tsUri },
  }, 'semantic tokens range');
  if (!result?.data) return { data: [] };
  const full = ripSemanticTokens(ctx, result.data);
  const startOffset = positionToOffset(ctx.curLineStarts, ctx.currentText.length, params.range.start);
  const endOffset = positionToOffset(ctx.curLineStarts, ctx.currentText.length, params.range.end);
  const builder = new SemanticTokensBuilder();
  let line = 0, char = 0;
  for (let i = 0; i + 4 < full.data.length; i += 5) {
    line += full.data[i];
    char = full.data[i] === 0 ? char + full.data[i + 1] : full.data[i + 1];
    const off = positionToOffset(ctx.curLineStarts, ctx.currentText.length, { line, character: char });
    if (off >= startOffset && off + full.data[i + 2] <= endOffset) {
      builder.push(line, char, full.data[i + 2], full.data[i + 3], full.data[i + 4]);
    }
  }
  return builder.build();
});

// ---- document links: relative paths in Rip COMMENTS become
// clickable (`# see ../NOTES.md#section-3`). Editors only auto-linkify
// scheme-carrying URLs, so this is ours; the source of truth is the
// compiler's trivia channel (comment records with real spans —
// string literals that merely look like paths are code, not trivia,
// and never linkify). Only real files become links; a `#anchor`
// fragment resolves to a line when the target contains a matching
// HTML id/name anchor or a `gap-N`-style numbered heading. Links
// serve from lastGood through the alignment guard (a comment in
// the changed region drops rather than pointing at moved text).
const LINK_PATTERN = /(\.\.?\/[\w./-]+\.\w+)(#[\w-]+)?/g;

// A fragment's 0-based line in the target file: an `id="…"`/`name="…"`
// HTML anchor, or `gap-N` mapping to the heading that starts with
// `N.`. -1 when not found.
function anchorLine(file, anchor) {
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split('\n'); } catch { return -1; }
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`id="${anchor}"`) || lines[i].includes(`name="${anchor}"`)) return i;
  }
  const numbered = /^gap-(\d+)$/.exec(anchor);
  if (numbered) {
    const heading = new RegExp(`^#{1,6}\\s+${numbered[1]}\\.`);
    for (let i = 0; i < lines.length; i++) {
      if (heading.test(lines[i])) return i;
    }
  }
  return -1;
}

connection.onDocumentLinks(async (params) => {
  // Asked once on open and cached, so the same settle the outline needs.
  await settleDocument(params.textDocument.uri);
  const ctx = requestContext(params);
  if (!ctx?.good.trivia || !params.textDocument.uri.startsWith('file://')) return null;
  let dir;
  try { dir = path.dirname(fileURLToPath(params.textDocument.uri)); } catch { return null; }
  const links = [];
  for (const t of ctx.good.trivia) {
    if (t.kind !== 'comment') continue;
    for (const m of t.text.matchAll(LINK_PATTERN)) {
      const [full, relPath, frag] = m;
      const file = path.resolve(dir, relPath);
      if (!fs.existsSync(file)) continue;
      const start = ctx.align.toCurrent(t.start + m.index);
      const end = ctx.align.toCurrent(t.start + m.index + full.length, { exclusiveEnd: true });
      if (start === null || end === null) continue;
      let target = 'file://' + file;
      if (frag) {
        const line = anchorLine(file, frag.slice(1));
        if (line >= 0) target += `#L${line + 1}`;
      }
      links.push({
        range: {
          start: offsetToPosition(ctx.curLineStarts, start),
          end: offsetToPosition(ctx.curLineStarts, end),
        },
        target,
        tooltip: `Open ${relPath}${frag ?? ''}`,
      });
    }
  }
  return links;
});

// ---- document symbols (outline) and workspace symbols: tsgo's
// hierarchical symbol tree decodes against the face; each symbol's
// NAME range (selectionRange) maps generated → Rip (verbatim first,
// cover tolerance for navigation) and the construct range rides
// along (clamped to contain the name). Symbols DEDUP by mapped name
// span: one symbol per Rip declaration — an enum's const object and
// its same-name type companion are two generated manifestations of ONE
// source declaration (the semantic-tokens dedup, symbol-shaped).
// Scaffolding names and synthetic landings drop.
//
// The name range maps STRICTLY (verbatim-verified only): a symbol's
// name must land on the bytes that spell it, so a manifestation whose
// name bytes are generated-only (an enum companion's `type Color` —
// the `type` head never matches the `enum` source) drops here, and
// the dedup below never even sees it. The construct range keeps the
// lenient cover tolerance (navigation).
function ripDocumentSymbols(ctx, symbols, seen = new Set()) {
  const out = [];
  for (const sym of symbols ?? []) {
    if (isScaffoldingLabel(sym.name)) continue;
    const selSrc = faceRangeToSourceRange(ctx.good, sym.selectionRange ?? sym.range, { strict: true });
    if (!selSrc) continue;
    const selection = goodRangeToCurrent(ctx, selSrc);
    if (!selection) continue;
    const key = `${sym.name}@${selection.start.line}:${selection.start.character}:${selection.end.line}:${selection.end.character}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fullSrc = sym.range ? faceRangeToSourceRange(ctx.good, sym.range) : null;
    const full = (fullSrc && goodRangeToCurrent(ctx, fullSrc)) || selection;
    // LSP requires selectionRange ⊆ range; hoisting can map the
    // construct range and the name range to different Rip lines, so
    // the range widens to the union.
    const before = (a, b) => a.line < b.line || (a.line === b.line && a.character <= b.character);
    const range = {
      start: before(full.start, selection.start) ? full.start : selection.start,
      end: before(selection.end, full.end) ? full.end : selection.end,
    };
    out.push({
      name: scrubFaceArtifacts(sym.name),
      kind: sym.kind,
      ...(sym.detail ? { detail: scrubFaceArtifacts(sym.detail) } : {}),
      ...(sym.tags ? { tags: sym.tags } : {}),
      range,
      selectionRange: selection,
      children: sym.children?.length ? ripDocumentSymbols(ctx, sym.children, seen) : [],
    });
  }
  return out;
}

connection.onDocumentSymbol(async (params) => {
  await tsgoReady;
  // Cached by the editor exactly like semantic tokens, and asked once when
  // the editor opens — before the first compile that is a null, and the
  // outline and breadcrumbs stay empty until an edit re-asks.
  await settleDocument(params.textDocument.uri);
  const ctx = requestContext(params);
  if (!ctx) return null;
  const result = await tsgoRequest('textDocument/documentSymbol', {
    textDocument: { uri: ctx.state.tsUri },
  }, 'document symbols');
  if (!Array.isArray(result)) return null;
  // The hierarchical shape is what we declared; a SymbolInformation
  // answer (location-shaped) maps through the location path instead.
  if (result.length && result[0].location) {
    const out = [];
    for (const sym of result) {
      if (isScaffoldingLabel(sym.name)) continue;
      const loc = ripLocation(sym.location.uri, sym.location.range);
      if (loc) out.push({ ...sym, name: scrubFaceArtifacts(sym.name), location: loc });
    }
    return out;
  }
  return ripDocumentSymbols(ctx, result);
});

// Workspace symbols search the ACTIVE PROGRAM (the open
// buffers' closure; out-of-program files are honestly out of scope).
// Locations map exactly like every other result: open buffers through
// their live mappings, unopened closure members through
// recompile-for-mappings, real
// TypeScript files pass through; synthetic landings drop. The same
// one-symbol-per-declaration dedup as the outline.
connection.onWorkspaceSymbol(async (params) => {
  await tsgoReady;
  if (!tsgo) return null;
  const result = await tsgoRequest('workspace/symbol', { query: params.query ?? '' }, 'workspace symbols');
  if (!Array.isArray(result)) return null;
  const out = [];
  const seen = new Set();
  for (const sym of result) {
    if (isScaffoldingLabel(sym.name)) continue;
    if (!sym.location?.uri) continue;
    const loc = ripLocation(sym.location.uri, sym.location.range, { strict: true });
    if (!loc) continue;
    const key = `${sym.name}@${loc.uri}:${loc.range.start.line}:${loc.range.start.character}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: scrubFaceArtifacts(sym.name),
      kind: sym.kind,
      ...(sym.containerName ? { containerName: scrubFaceArtifacts(sym.containerName) } : {}),
      ...(sym.tags ? { tags: sym.tags } : {}),
      location: loc,
    });
  }
  return out;
});

// ---- WorkspaceEdit mapping (rename, code actions): every edit in
// every touched file must land on Rip source — all-or-nothing. Edits
// land in three file kinds exactly like locations do: open buffers
// (which must MATCH their lastGood — an edit computed against a stale
// face could half-apply; the fail-safe), unopened mirrors (recompiled
// mappings), and real TypeScript files (passed through untouched).
// The coincident-span dedup: a hoisted declaration and its assignment are two
// generated manifestations of the IDENTICAL source span, so their
// mapped edits coincide — coincident spans with identical newText
// collapse to one edit, and any remaining overlap refuses loudly.
// Strictly-before, on LSP positions.
const beforePosition = (a, b) => a.line < b.line || (a.line === b.line && a.character < b.character);

// The earliest point a tolerant compile marked incomplete, as an LSP
// position — or null when the face is a clean compile. Everything from
// here to end of buffer is what the user is still typing; everything
// before it is settled text an edit may touch.
function earliestIncompleteness(face) {
  let at = null;
  for (const d of face.parseDiagnostics ?? []) {
    if (at === null || d.start < at) at = d.start;
  }
  return at === null ? null : offsetToPosition(face.srcLineStarts, at);
}

// `atomic` (the default) is the RENAME contract: every participating
// buffer must be settled, because a rename is one refactor spread across
// files and a partial apply is worse than none — a buffer mid-keystroke
// cannot promise its occurrences are the ones the user means. A quick fix
// is the opposite shape: one local insertion, whose only requirement is
// that its OWN span is settled text, so it passes `atomic: false` and is
// judged positionally.
function mapWorkspaceEditToRip(edit, { atomic = true } = {}) {
  const byUri = new Map(); // tsUri → TextEdit[]
  for (const [uri, edits] of Object.entries(edit?.changes ?? {})) {
    byUri.set(uri, edits);
  }
  for (const change of edit?.documentChanges ?? []) {
    if (!change.textDocument) {
      return { failure: `the edit needs a file operation (${change.kind}) — not supported on Rip mirrors` };
    }
    byUri.set(change.textDocument.uri, [...(byUri.get(change.textDocument.uri) ?? []), ...change.edits]);
  }

  const changes = {};
  for (const [uri, edits] of byUri) {
    const open = stateByTsUri(uri);
    let face, ripUri, incompleteFrom = null;
    if (open) {
      const document = documents.get(open.uri);
      if (!document || document.getText() !== open.state.lastGood.source) {
        return { failure: `${open.uri.split('/').pop()} has unapplied changes that do not compile — fix it and retry` };
      }
      if (atomic && open.state.lastGood.parseDiagnostics?.length > 0) {
        return { failure: `${open.uri.split('/').pop()} does not compile — fix it and retry` };
      }
      face = open.state.lastGood;
      ripUri = open.uri;
      // A RECOVERED face (tolerant compile of an incomplete buffer) takes
      // edits BEFORE its incompleteness and refuses them at or after it.
      // The hole is a keystroke in flight, so an edit landing on or past
      // one commits the workspace to a text the user is mid-way through
      // changing. Refusing the whole FILE is what this used to do, and it
      // takes the editor's most-used edit surface with it: an import
      // inserted at offset 0 cannot be affected by an unclosed call three
      // lines below, yet the auto-import quick fix silently disappeared
      // for as long as the buffer was mid-expression.
      incompleteFrom = earliestIncompleteness(face);
    } else {
      let fsPath = null;
      if (uri.startsWith('file://')) {
        try { fsPath = fileURLToPath(uri); } catch { fsPath = null; }
      }
      const sourcePath = fsPath === null ? null : sourcePathOfMirror(fsPath);
      if (sourcePath === null) {
        if (fsPath !== null && mirrorRelOf(fsPath) === null) {
          // A real TypeScript file: its edits apply as tsgo spelled them.
          changes[uri] = edits;
          continue;
        }
        return { failure: `an edit lands in ${uri}, which has no Rip source` };
      }
      // An open buffer with no usable lastGood (it never compiled): the
      // disk face's positions describe a text the buffer no longer
      // shows — refuse, never apply against the wrong text.
      if (documents.get('file://' + sourcePath)) {
        return { failure: `${path.basename(sourcePath)} is open but does not compile — fix it and retry` };
      }
      face = faceOf(sourcePath);
      if (!face) {
        return { failure: `${path.basename(sourcePath)} cannot be mapped (its source does not compile to the served face) — fix it and retry` };
      }
      ripUri = 'file://' + sourcePath;
    }

    const mapped = [];
    for (const e of edits) {
      const srcEdit = faceEditToSourceEdit(face, e);
      if (!srcEdit) {
        return { failure: `an edit in ${ripUri.split('/').pop()} lands on generated-only bytes with no Rip source` };
      }
      if (incompleteFrom !== null && !beforePosition(srcEdit.range.end, incompleteFrom)) {
        return { failure: `an edit in ${ripUri.split('/').pop()} lands on an incomplete expression — finish it and retry` };
      }
      mapped.push(srcEdit);
    }

    // The coincident-span collapse, then the non-overlap assertion.
    const keyed = new Map();
    for (const e of mapped) {
      const key = `${e.range.start.line}:${e.range.start.character}:${e.range.end.line}:${e.range.end.character}`;
      const existing = keyed.get(key);
      if (existing) {
        if (existing.newText !== e.newText) {
          return { failure: `conflicting edits over one span in ${ripUri.split('/').pop()}` };
        }
        continue;
      }
      keyed.set(key, e);
    }
    const collapsed = [...keyed.values()].sort((a, b) =>
      a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character);
    for (let i = 1; i < collapsed.length; i++) {
      const prev = collapsed[i - 1].range.end;
      const next = collapsed[i].range.start;
      if (prev.line > next.line || (prev.line === next.line && prev.character > next.character)) {
        return { failure: `overlapping edits in ${ripUri.split('/').pop()} after collapsing coincident spans` };
      }
    }
    changes[ripUri] = [...(changes[ripUri] ?? []), ...collapsed];
  }
  return { changes };
}

connection.onPrepareRename(async (params) => {
  await tsgoReady;
  const ctx = requestContext(params);
  // The EXACT flavor: a position with no verbatim generated twin —
  // synthetic bytes, keyword glyphs, comments — refuses here.
  if (!ctx || ctx.genExactPosition === null) return null;
  const result = await tsgoRequest('textDocument/prepareRename', {
    textDocument: { uri: ctx.state.tsUri },
    position: ctx.genExactPosition,
  }, 'prepare rename');
  if (!result) return null;
  const range = result.range ?? (result.start ? result : null);
  if (!range) return null;
  const srcRange = faceRangeToSourceRange(ctx.good, range);
  if (!srcRange) return null;
  const curRange = goodRangeToCurrent(ctx, srcRange);
  if (!curRange) return null;
  return result.placeholder !== undefined
    ? { range: curRange, placeholder: result.placeholder }
    : curRange;
});

connection.onRenameRequest(async (params) => {
  await tsgoReady;
  const refuse = (message) => {
    throw new ResponseError(ErrorCodes.InvalidRequest, `rename refused: ${message}`);
  };
  const ctx = requestContext(params);
  if (!ctx) refuse('the position does not map to the compiled document');
  if (ctx.currentText !== ctx.good.source || ctx.good.parseDiagnostics?.length > 0) {
    refuse('the buffer does not compile — fix the parse error and retry');
  }
  if (ctx.genExactPosition === null) refuse('the position does not map to the compiled document');
  const result = await tsgoRequest('textDocument/rename', {
    textDocument: { uri: ctx.state.tsUri },
    position: ctx.genExactPosition,
    newName: params.newName,
  }, 'rename');
  if (!result) return null;
  const { changes, failure } = mapWorkspaceEditToRip(result);
  if (failure) refuse(failure);
  return { changes };
});

// ---- code actions: quickfix plus the source.* family (the
// organizeImports/removeUnusedImports/sortImports rewrites land
// through the whole-import-line mapping; fixAll's auto-imports
// land through the standing insertion rules). The request range and
// its diagnostics map Rip → TS; returned edits map back through the
// same all-or-nothing WorkspaceEdit path as rename — an action whose
// edit cannot land on Rip source is dropped, never shown broken.
connection.onCodeAction(async (params) => {
  await tsgoReady;
  const ctx = requestContext(params);
  if (!ctx) return null;
  // The EXACT mapping, not the lenient one. A quick fix is keyed to a
  // diagnostic's SPAN: tsgo looks for its own diagnostic at the range it is
  // handed, and answers nothing when none sits there. The lenient flavor
  // falls back to the innermost cover row's start, which turns a four-byte
  // identifier into the whole statement — driven on 10-modules.rip, where
  // `host` (13:47) arrived as a 36-byte range and tsgo returned ZERO
  // actions where the TS twin offers four. Exact spans put all four back.
  //
  // This is the same rule translate.js states for definition, references
  // and rename: anything that identifies or MUTATES a symbol takes the
  // strict flavor, because a cover row's start is a different construct.
  // A code action mutates, and was reading from the wrong list.
  const toGen = (position, exclusiveEnd) => {
    const cur = positionToOffset(ctx.curLineStarts, ctx.currentText.length, position);
    const offset = ctx.align.toGood(cur, { exclusiveEnd });
    if (offset === null) return null;
    return sourceOffsetToGeneratedExact(ctx.good.mappings, offset, ctx.good.source, ctx.good.code)
      ?? sourceCursorToGenerated(ctx.good.mappings, offset);
  };
  // A pure source.* ask (VS Code's organize-imports command, fix-all
  // on save) is document-scoped by nature: the face's whole range
  // serves, so a request range past the last mapped construct (the
  // full-document range clients send) cannot refuse the ask.
  const onlySource = (params.context?.only?.length ?? 0) > 0
    && params.context.only.every((kind) => kind.startsWith('source.'));
  let range;
  if (onlySource) {
    range = {
      start: offsetToPosition(ctx.good.genLineStarts, 0),
      end: offsetToPosition(ctx.good.genLineStarts, ctx.good.code.length),
    };
  } else {
    const genStart = toGen(params.range.start, false);
    const genEnd = toGen(params.range.end, true);
    if (genStart === null || genEnd === null) return null;
    range = {
      start: offsetToPosition(ctx.good.genLineStarts, Math.min(genStart, genEnd)),
      end: offsetToPosition(ctx.good.genLineStarts, Math.max(genStart, genEnd)),
    };
  }
  const diagnostics = [];
  for (const d of params.context?.diagnostics ?? []) {
    const s = toGen(d.range.start, false);
    const e = toGen(d.range.end, true);
    if (s === null || e === null) continue;
    diagnostics.push({
      ...d,
      source: 'ts',
      range: {
        start: offsetToPosition(ctx.good.genLineStarts, Math.min(s, e)),
        end: offsetToPosition(ctx.good.genLineStarts, Math.max(s, e)),
      },
    });
  }
  const result = await tsgoRequest('textDocument/codeAction', {
    textDocument: { uri: ctx.state.tsUri },
    range,
    context: { diagnostics, ...(params.context?.only ? { only: params.context.only } : {}) },
  }, 'code action');
  if (!Array.isArray(result)) return null;
  const actions = [];
  for (const action of result) {
    if (action.kind && !action.kind.startsWith('quickfix') && !action.kind.startsWith('source.')) continue;
    if (!action.edit) continue; // command-only actions execute inside tsgo — not brokered
    const { changes, failure } = mapWorkspaceEditToRip(action.edit, { atomic: false });
    if (failure) {
      connection.console.log(`[rip] code action '${action.title}' dropped: ${failure}`);
      continue;
    }
    actions.push({
      title: scrubFaceArtifacts(action.title),
      kind: action.kind,
      ...(action.isPreferred !== undefined ? { isPreferred: action.isPreferred } : {}),
      diagnostics: params.context?.diagnostics ?? [],
      edit: { changes },
    });
  }
  return actions;
});

documents.listen(connection);
connection.listen();
