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
  CompletionTriggerKind, DidChangeWatchedFilesNotification, FileChangeType, InsertTextFormat,
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
  staleOffsetMap, isScaffoldingLabel, isMirrorImportItem, scrubFaceArtifacts, presentType, presentOutgoing, isImportFixTitle, ripImportText,
  noUserSymbolSpans, inNoUserSymbolSpan, memberDeclKind,
  SUPPRESSED_TS_CODES, SCAFFOLD_HOVER, prettifyRouteUnion, hoverableSpans, collapseCellArms,
  splitTypeAt, balancedTo, unionArms, cellShape,
} from './translate.js';
import { mapTsDiagnostic, applyRipDirectives, isNoCheckPath, compileErrorInfo } from './diagnostics.js';
import { scopeGateOf, typedExportsOf, typedImportsOf } from './scopes.js';
import { generatedMirror as buildGeneratedMirror, projectWrapper, nearestTsconfig, HOST_FLOOR_NAME, mirrorRelForFsPath, ripImportsOf, scanExportNames, stubFacesFromScans, linkNestedNodeModules, configEarnsBoundary, appStashSpecFor, appRoutesFor, closureImportsOf, isStdlibPath, anchorStdlib, identifierRunAt } from './mirror.js';

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
let clientSnippetSupport = false;
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
// The code-action kinds the editor serves, advertised to the client and
// asked of tsgo alike: the quick fix, and organize imports. Nothing else
// in the source.* family is offered (see onCodeAction).
const CODE_ACTION_KINDS = ['quickfix', 'source.organizeImports'];

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
    references: {},
    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
    rename: { prepareSupport: true },
    codeAction: {
      codeActionLiteralSupport: { codeActionKind: { valueSet: CODE_ACTION_KINDS } },
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
// tsgo truncates quickinfo at `js/ts.hover.maximumLength` (default
// 5000), and a component's lowered construct type — every intrinsic
// passthrough row of an `extends <tag>` — can exceed that. A truncated
// construct loses the tail the signature presenter keys on, so the raw
// machinery would pass through to the user. The broker floors the
// preference high enough that whole constructs always arrive; the
// presenter collapses them to a few lines, and a user's LARGER setting
// still wins.
const HOVER_LENGTH_FLOOR = 262144;
function floorHoverLength(items, answers) {
  return answers.map((answer, i) => {
    // The preference has no VS Code config path — tsgo reads it from a
    // section's `unstable` blob (raw-name lookup), and `js/ts` is the
    // last section in its precedence order.
    if (items[i]?.section !== 'js/ts') return answer;
    const given = answer?.unstable?.maximumHoverLength;
    if (typeof given === 'number' && given >= HOVER_LENGTH_FLOOR) return answer;
    return { ...(answer ?? {}), unstable: { ...(answer?.unstable ?? {}), maximumHoverLength: HOVER_LENGTH_FLOOR } };
  });
}

async function tsgoConfigurationRequest(params) {
  const items = params?.items ?? [];
  if (!clientSupportsConfiguration) return floorHoverLength(items, items.map(() => null));
  // The handshake window: tsgo boots INSIDE this server's own
  // initialize handler and asks for configuration immediately, but the
  // editor's languageclient installs its workspace/configuration
  // handler only once the handshake completes — a forward before then
  // bounces with "Unhandled method". Answer tsgo's boot-time asks with
  // nulls directly (its own defaults, the same answer the bounce
  // produced), and save the forward — and the failure log — for
  // requests the editor can actually serve.
  if (!clientInitialized) return floorHoverLength(items, items.map(() => null));
  try {
    const answers = await connection.workspace.getConfiguration(
      items.map((item) => ({
        ...(item.section !== undefined ? { section: item.section } : {}),
        ...(item.scopeUri !== undefined ? { scopeUri: item.scopeUri } : {}),
      })),
    );
    return floorHoverLength(items, answers);
  } catch (err) {
    connection.console.log(`[rip] configuration forward failed: ${err.message}`);
    return floorHoverLength(items, items.map(() => null));
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
const rawCompileCache = new Map(); // fsPath → { sourceHash, stashSpec, routesUnion, routeParams, result }, insertion = recency
const RAW_COMPILE_CAP = 32;
// Answers the whole cache entry — result plus the discovery the face
// was compiled under — so a caller recording those inputs (the
// manifest) records the walk this compile actually used, never a
// second walk's view of a disk that may have changed in between.
function rawCompileEntry(fsPath, source, sourceHash) {
  // The stash and route discoveries are COMPILE INPUTS (the face
  // splices by them), so they join the cache key — a hit on source
  // bytes alone would keep serving a face compiled before
  // app/stash.rip or a route file appeared or vanished.
  const stashSpec = appStashSpecFor(fsPath, workspaceRoot);
  const { union: routesUnion, params: routeParams } = appRoutesFor(fsPath, workspaceRoot);
  const hit = rawCompileCache.get(fsPath);
  if (hit && hit.sourceHash === sourceHash && hit.stashSpec === stashSpec &&
      hit.routesUnion === routesUnion && hit.routeParams === routeParams) return hit;
  const result = compile(source, { path: fsPath, runtimeDelivery: 'inline', face: 'ts', appStashSpec: stashSpec, routesUnion, routeParams });
  const entry = { sourceHash, stashSpec, routesUnion, routeParams, result };
  rawCompileCache.delete(fsPath);
  rawCompileCache.set(fsPath, entry);
  if (rawCompileCache.size > RAW_COMPILE_CAP) rawCompileCache.delete(rawCompileCache.keys().next().value);
  return entry;
}
const rawCompile = (fsPath, source, sourceHash) => rawCompileEntry(fsPath, source, sourceHash).result;

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

// Every out-of-workspace source this server has mirrored: the live
// closure, and the manifest a warm start restored before the closure
// walk reached anything. Bounded by what actually mirrors externally —
// in practice the stdlib faces a `rip/*` specifier pulled in.
function* externalMirroredSources() {
  const seen = new Set();
  const inWorkspace = workspaceRoot + path.sep;
  for (const source of [materializedMirrors.keys(), Object.keys(cacheManifest.entries)]) {
    for (const file of source) {
      if (file.startsWith(inWorkspace) || seen.has(file)) continue;
      seen.add(file);
      yield file;
    }
  }
}

// The inverse of mirrorPathOf. A workspace file's mirror rel IS its
// source's rel, so it inverts by construction. An __external__ rel does
// NOT, and re-deriving one from a candidate path proves nothing:
// mirrorRelForFsPath strips colons on the way in, so its output is a
// fixed point of itself, and on Windows the drive letter's colon goes
// with it. The faithful inverse is a LOOKUP over the sources actually
// mirrored — the answer is then a path this server itself put there, in
// its own spelling, on every platform. Ambiguity refuses: a mirror two
// sources claim (the collision warnOnMirrorCollision reports) names
// neither. A mirror no source claims — a non-file uri under the
// sanitizer, which nothing invertible ever produced — drops.
function sourcePathOfMirror(mirrorFsPath) {
  if (!workspaceRoot || mirrorRootIsFallback) return null;
  if (!mirrorFsPath.endsWith('.rip.ts')) return null;
  const mirrorRel = mirrorRelOf(mirrorFsPath);
  if (mirrorRel === null) return null;
  const rel = mirrorRel.slice(0, -'.ts'.length);
  if (rel.split(path.sep)[0] === '__external__') {
    let found = null;
    for (const file of externalMirroredSources()) {
      if (mirrorPathOf('file://' + file) !== mirrorFsPath) continue;
      if (found !== null) return null;
      found = file;
    }
    return found;
  }
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
  const compiled = rawCompileEntry(fsPath, source, hashText(source));
  const result = compiled.result;
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
    // The stash and route discoveries the face was compiled under —
    // COMPILE INPUTS the source bytes cannot vouch for, so revalidation
    // compares them against the live discovery (materializeClosure's
    // cached road). Taken from the compile's OWN entry, never a second
    // walk: a route file landing between two walks would stamp the
    // manifest with a union this face was not compiled under, and
    // revalidation would then certify the stale face as fresh.
    stashSpec: compiled.stashSpec,
    routesUnion: compiled.routesUnion, routeParams: compiled.routeParams,
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
    // Freshness = source bytes AND the discoveries the face was
    // compiled under: creating or deleting app/stash.rip (or its
    // anchor pair), or adding/removing a route file, changes no
    // importer's bytes — and an entry written before a field existed
    // reads undefined, a mismatch, so it recompiles once and heals.
    const liveRoutes = entry && entry.sourceHash === sourceHash ? appRoutesFor(file, workspaceRoot) : null;
    if (entry && entry.sourceHash === sourceHash && mirrorIntact(file, entry) &&
        entry.stashSpec === appStashSpecFor(file, workspaceRoot) &&
        entry.routesUnion === liveRoutes.union && entry.routeParams === liveRoutes.params) {
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
  clientSnippetSupport = !!params.capabilities?.textDocument?.completion?.completionItem?.snippetSupport;
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
      codeActionProvider: { codeActionKinds: CODE_ACTION_KINDS },
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
      // The two routes-dir patterns exist for DIRECTORY events: a
      // folder rename or delete under app/routes commonly arrives as
      // one event for the folder path — which '**/*.rip' can never
      // match — yet flips route-existence facts for the whole subtree.
      watchers: [
        { globPattern: '**/*.rip' }, { globPattern: '**/tsconfig.json' }, { globPattern: '**/package.json' },
        { globPattern: '**/app/routes' }, { globPattern: '**/app/routes/**' },
      ],
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
  // Hoisted past the try: the good object below carries the entries the
  // compile ran under.
  let routes = { union: null, params: null, entries: [] };
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
    // The same URI-vs-fsPath trap as the stash walk: discovery walks
    // the FILESYSTEM, so it takes the converted path, never the URI.
    try { routes = appRoutesFor(fileURLToPath(document.uri), workspaceRoot); } catch { /* non-file uri — stays unarmed */ }
    result = compile(text, { path: document.uri, runtimeDelivery: 'inline', face: 'ts', pins, strict: state.strict, tolerant: true, appStashSpec: stashSpec, routesUnion: routes.union, routeParams: routes.params });
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
    // The union's members ({ shape, text, display }) the compile above
    // ran under — display-side only (diagnostic/hover prettifying).
    routeEntries: routes.entries,
    // Generated key/value spans of the `__ripRoute` attribute wraps —
    // the diagnostics road re-anchors a whole-value mismatch on the key.
    routeWraps: result.routeWraps ?? [],
    // Per render pair, the key's source span and the road's generated
    // relation sites — a diagnostic standing on a site re-anchors on the
    // key (diagnostics.js, recordedAnchor; RULINGS.md).
    renderPairs: result.renderPairs ?? [],
    // Minted kind labels by declaration span (RULINGS.md, the kind rows).
    kinds: result.kinds ?? [],
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
    // SOURCE spans of intrinsic-element positions served from the
    // compiler's own record — the tag word and the `ref` channel word
    // (RULINGS.md, the render rows; see the hover handler).
    intrinsics: result.intrinsics ?? [],
    // SOURCE spans where hover may answer at all — the positive model
    // (hoverableSpans, translate.js): the author's own symbol tokens,
    // annotations, and import specifiers; every other byte declines.
    hoverable: hoverableSpans(result, text),
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
          routesUnion: routes.union, routeParams: routes.params,
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
  // DISCOVERY is a compile input made of existence facts — the stash
  // (app/stash.rip and its index.rip/package.json anchor) and the route
  // tree (which files exist under app/routes) — so an event that
  // creates or deletes one flips the answer for a whole subtree
  // without touching any importer's bytes.
  let discoveryChanged = false;
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
        if (change.type !== FileChangeType.Changed) discoveryChanged = true;
      }
      continue;
    }
    if (!fsPath.endsWith('.rip')) {
      // A DIRECTORY event under (or of) a routes tree: a folder
      // rename/delete arrives as one event for the folder path, with
      // no per-file `.rip` events, yet route-existence facts flipped
      // for the whole subtree. The routes-dir watchers deliver it.
      if (fsPath.includes(`${path.sep}app${path.sep}routes${path.sep}`) ||
          fsPath.endsWith(`${path.sep}app${path.sep}routes`)) {
        discoveryChanged = true;
      }
      continue;
    }
    if (change.type !== FileChangeType.Changed &&
        (path.basename(fsPath) === 'index.rip' ||
         (path.basename(fsPath) === 'stash.rip' && path.basename(path.dirname(fsPath)) === 'app') ||
         fsPath.includes(`${path.sep}app${path.sep}routes${path.sep}`))) {
      discoveryChanged = true;
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
  if (discoveryChanged) {
    // The discovery flipped for some subtree: every cached face and
    // every materialized-this-session mark is suspect. Clearing them
    // makes the next closure pass revisit each file through the
    // manifest's stashSpec/routes revalidation — entries whose
    // discovery still matches revalidate cheaply, the flipped ones
    // recompile — and the open docs refresh below recompile under the
    // new answers.
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
function requestContext(params, { wordEndBias = false } = {}) {
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
    let curOffset = positionToOffset(curLineStarts, currentText.length, params.position);
    // HOVER ONLY: a cursor at a word's END boundary is on that word —
    // VS Code's own word-under-cursor semantics — while every span
    // channel here is end-EXCLUSIVE, so the boundary byte otherwise
    // falls past the word's silence or serve and lands on whatever the
    // cover holds (the sweep's boundary-cover class). Completion and
    // the symbol surfaces keep exact cursor semantics.
    if (wordEndBias && curOffset > 0
        && /[\w$]/.test(currentText[curOffset - 1] ?? '')
        && !/[\w$]/.test(currentText[curOffset] ?? '')) {
      curOffset -= 1;
    }
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

// The identifier-shaped word around `at` in `text`, or '' when the
// position sits on none (the hover machinery guard compares it to a
// hover's declared name, so a non-word position must never equal one).
function wordAtOffset(text, at) {
  let s = at, e = at;
  while (s > 0 && /[\w$]/.test(text[s - 1])) s--;
  while (e < text.length && /[\w$]/.test(text[e])) e++;
  return text.slice(s, e);
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
  let span = generatedEditSpanToSource(face.mappings, s, e, face.source, face.code)
    ?? (strict ? null : generatedSpanToSource(face.mappings, s, e));
  // An anonymous default export has no NAME for a strict landing: tsgo
  // targets the whole `export default …` statement, whose body is the
  // lowering's spelling. The statement's head is verbatim on both sides,
  // and the `default` keyword is the landing TypeScript itself uses for
  // it — so a strict miss whose face and source both open on
  // `export default ` lands there.
  if (!span && strict) {
    const cover = generatedSpanToSource(face.mappings, s, e);
    if (cover && /^export default\b/.test(face.code.slice(s, s + 15)) && /^export default\b/.test(face.source.slice(cover[0], cover[0] + 15))) {
      span = [cover[0] + 'export '.length, cover[0] + 'export default'.length];
    }
  }
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
//
// Compared as PATHS, never as uri strings. tsgo percent-encodes the
// characters a uri reserves — `[`, `]`, `(`, `)`, a space — so a result
// in `app/routes/(app)/page.rip` comes back as `%28app%29`, while the
// state's own tsUri was built by concatenation and spells the bytes.
// A string comparison misses exactly the paths a rip app is most likely
// to have (a dynamic route's `[id]`, a route group's `(app)`), and the
// open buffer then loses every answer about itself: its references
// vanish from its own list, and a definition falls back to a mirror
// whose face need not match the buffer.
function stateByTsUri(tsUri) {
  const wanted = fsPathOfUri(tsUri);
  if (wanted === null) return null;
  for (const [uri, state] of states) {
    if (state.lastGood && fsPathOfUri(state.tsUri) === wanted) return { uri, state };
  }
  return null;
}

// A `file:` uri's path, decoded, or null when it names no file. Both
// spellings of one path answer alike, which is the whole point.
function fsPathOfUri(uri) {
  if (typeof uri !== 'string' || !uri.startsWith('file://')) return null;
  try { return fileURLToPath(uri); } catch { return null; }
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

// The rip text a mapped location covers, and the line it starts on —
// from the open buffer when there is one, else the disk file. Null when
// neither can be read.
function ripSourceText(uri) {
  const document = documents.get(uri);
  if (document) return document.getText();
  try { return fs.readFileSync(fileURLToPath(uri), 'utf8'); } catch { return null; }
}
function ripTextAt(uri, range) {
  const text = ripSourceText(uri);
  if (text === null) return null;
  const ls = lineStartsOf(text);
  return text.slice(ls[range.start.line] + range.start.character, ls[range.end.line] + range.end.character);
}
function ripLineAt(uri, line) {
  const text = ripSourceText(uri);
  return text === null ? null : (text.split('\n')[line] ?? null);
}

// Location | Location[] | LocationLink[] → Rip locations (flat). STRICT:
// a definition, type definition, or reference IDENTIFIES a symbol, so
// each range maps verbatim or drops — a cover landing would present a
// construct's whole span as the name (translate.js states the rule for
// the request direction; this is the answer direction).
function ripLocations(result) {
  return flattenLocations(result).map(({ uri, range }) => ripLocation(uri, range, { strict: true })).filter(Boolean);
}

// The identifier under a cursor, by the compiler's own vocabulary.
// Null off-identifier; a cursor at either edge of a run counts as on it
// (LSP convention).
function identifierAtCursor(text, lineStarts, position) {
  const lineStart = lineStarts[position.line];
  if (lineStart === undefined) return null;
  const at = lineStart + position.character;
  let i = lineStart;
  while (i <= at && i < text.length && text[i] !== '\n') {
    const run = identifierRunAt(text, i);
    if (run) {
      if (at >= run.start && at <= run.end) return run.value;
      i = run.end;
    } else {
      i++;
    }
  }
  return null;
}

// tsgo's definition for a CALL through a typed binding answers plain-TS
// style: the resolved call signature (a span inside the type's
// declaration) AND the binding itself. Rip's answer is the SYMBOL — of
// several mapped locations, keep the ones whose target text spells
// exactly the identifier under the cursor; a signature span never does.
// When none qualifies (a position off any identifier, an answer set
// with no naming site), the full set stands: the filter only ever
// sharpens, never empties.
function preferNamingLocations(params, locations) {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return locations;
  const text = doc.getText();
  const name = identifierAtCursor(text, lineStartsOf(text), params.position);
  if (!name) return locations;
  const naming = locations.filter((loc) => {
    const { start, end } = loc.range;
    if (start.line !== end.line || end.character - start.character !== name.length) return false;
    let target;
    const open = documents.get(loc.uri);
    if (open) {
      target = open.getText();
    } else {
      try { target = fs.readFileSync(fileURLToPath(loc.uri), 'utf8'); } catch { return false; }
    }
    const lineStart = lineStartsOf(target)[start.line];
    if (lineStart === undefined) return false;
    return target.slice(lineStart + start.character, lineStart + end.character) === name;
  });
  return naming.length ? naming : locations;
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

// A regex source for a name tsgo printed — every metacharacter an
// identifier can carry (`$`) reads literally.
const reSource = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
  const hoverMembers = unionArms(rhs);
  if (hoverMembers.length < 2) return null;
  const decl = new RegExp(`^(?:export )?type ${reSource(name)}\\s*=\\s*(.+?);?$`, 'm').exec(ctx.good.code);
  if (!decl) return null;
  const declMembers = unionArms(decl[1]);
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
  // anchored behind `: {` and judged whole by the cell-shape check.
  const m = /^(?:(const|let) ([A-Za-z_$][\w$]*)|\(property\) ((?:.+\.)?[A-Za-z_$][\w$]*)): (\{ .+ \})$/.exec(flat);
  if (!m) return null;
  const [, , plain, qualified, type] = m;
  const member = qualified !== undefined;
  if (member && !atMemberDecl) return null;
  const cell = cellShape(type);
  if (cell === null) return null;
  const head = member ? `(property) ${qualified}` : `${cell.readonly ? 'const' : 'let'} ${plain}`;
  const reworded = value.replace(fence[0], `${fence[1]}${head}: ${cell.value}${fence[3]}`);
  return { ...contents, value: reworded };
}

// The props block of a component's construct signature — the `{` at
// `open` through the intersection groups and optional tail that follow it
// — as the AUTHOR's rows, plus the tag an `extends` component's
// passthrough reported and the offset the signature's return tail starts
// at. Null where the text is not that shape. The one reading of the
// block, shared by the component-name hover and the call's signature
// help, so the two surfaces cannot present the same props differently.
function componentPropsAt(flat, open) {
  const extendsTag = { tag: null };
  const membersOf = (inner) => {
    const out = [];
    for (const raw of splitTypeAt(inner, ';')) {
      const row = raw.trim();
      // The DEFAULT projection slot stays out of the signature — it is the
      // channel every component has, not a prop this one declares — under
      // either spelling of its minted type; a declared `@children: T` shows.
      if (row === '' || row === 'children?: __RipChildren' || row === 'children?: Children' || /^__bind_[\w$]+__\??:/.test(row)) continue;
      // A passthrough row types through the tag's DOM interface — bare, or
      // parenthesized where the attribute road widened it (`style`) — and
      // the two class spellings take the clsx admission; all of them are
      // the extends surface's, never props this component declares.
      const passthrough = /^(?:"[^"]*"|'[^']*'|[\w$-]+)\??: \(?(?:HTML|SVG)ElementTagNameMap\[["']([\w-]+)["']\] extends Record</.exec(row);
      if (passthrough) { extendsTag.tag = passthrough[1]; continue; }
      if (/^(?:class|className)\??: (?:__RipClassValue \| __RipClassValue\[\]|ClassValue \| ClassValue\[\])$/.test(row)) continue;
      if (/^\[key: `(?:data|aria)-\$\{string\}`\]: any$/.test(row)) continue;
      const colon = row.indexOf(': ');
      let kept = row;
      if (colon !== -1) {
        const arms = unionArms(row.slice(colon + 2));
        const keptArms = arms.filter((arm) => cellShape(arm) === null);
        if (keptArms.length > 0 && keptArms.length < arms.length) kept = row.slice(0, colon + 2) + keptArms.join(' | ');
      }
      // tsgo spells string literals double-quoted; the corpus spelling
      // is single quotes, and the grammar colors the two forms apart.
      // Only a literal with nothing to re-escape converts.
      out.push(kept.replace(/"([^"'\\]*)"/g, "'$1'"));
    }
    return out;
  };
  // The base block holds every prop in optional spelling; each REQUIRED
  // prop then rides one `& ({ p: … } | { __bind_p__: … })` intersection
  // group, whose author-named alternative supersedes the base row.
  const close = balancedTo(flat, open);
  if (close === -1) return null;
  const props = membersOf(flat.slice(open + 1, close));
  let at = close + 1;
  while (flat.startsWith(' & (', at)) {
    const groupEnd = balancedTo(flat, at + 3);
    if (groupEnd === -1) return null;
    const named = unionArms(flat.slice(at + 4, groupEnd))
      .filter((a) => a.startsWith('{') && a.endsWith('}'))
      .flatMap((a) => membersOf(a.slice(1, -1)));
    if (named.length !== 1) return null;
    const propName = named[0].slice(0, named[0].indexOf(':')).replace(/\?$/, '');
    const idx = props.findIndex((p) => p.slice(0, p.indexOf(':')).replace(/\?$/, '') === propName);
    if (idx === -1) return null;
    props[idx] = named[0];
    at = groupEnd + 1;
  }
  // Under strict null posture an optional props param prints its own
  // `| undefined` between the block and the paren.
  if (flat.startsWith(' | undefined', at)) at += ' | undefined'.length;
  return { props, extendsTag, at };
}

// A component-name hover arrives as the lowered construct signature —
// `const Button: new (props?: { … }) => Button` — whose props block
// speaks the lowering's vocabulary: every author prop unions its
// reactive container, the two-way channel mints a `__bind_x__` twin
// per prop, and the children slot rides along. The author's answer is
// the component's SIGNATURE (RULINGS.md, the component-use row):
// `component <Name>` with the props in value-first spelling. Every
// structural expectation is verified before rewriting — a hover that
// is not exactly the construct shape passes through untouched.
function presentComponentSignatureHover(contents) {
  const value = contents?.value;
  if (typeof value !== 'string') return null;
  const fence = /(```(?:typescript|ts)\n)([^]*?)(\n?```)/.exec(value);
  if (!fence) return null;
  // The rows are re-rendered from scratch, so tsgo's line breaks carry
  // nothing — flatten once and parse the one-line shape.
  const flat = fence[2].replace(/\s+/g, ' ').trim();
  // An import-bound use hovers the same construct behind tsgo's alias
  // dress — `(alias) const N: …` with a trailing `import N` line; a
  // mutable module binding holding a component hovers `let`. The
  // binding's name says nothing about the construct: another binding
  // can hold a component (`Local = Button`), so the served name is the
  // one the tail constructs.
  // Two printings of the one construct: a lone construct signature
  // prints in arrow form (`new (props: …) => Name`), and the hoisted
  // binding's published type with its static `mount` beside it prints
  // as the object it is (`{ new (props?: …): Name; mount(target?: any):
  // Name; }`) — a forward-used declaration answers that form.
  // A GENERIC component's use site carries the inferred instantiation
  // — `new <"alpha">(props?: {…}) => Chip<"alpha">` — and the args
  // ride into the served head: `component Chip<'alpha'>`.
  const head = /^(?:\(alias\) )?(?:const|let|var) [A-Za-z_$][\w$]*: (\{ )?new /.exec(flat);
  if (!head) return null;
  const objectForm = head[1] !== undefined;
  let typeArgs = null;
  let propsAt = head[0].length;
  if (flat[propsAt] === '<') {
    const argsEnd = balancedTo(flat, propsAt);
    if (argsEnd === -1) return null;
    typeArgs = flat.slice(propsAt + 1, argsEnd);
    propsAt = argsEnd + 1;
  }
  const propsHead = /^\(props\??: \{/.exec(flat.slice(propsAt));
  if (!propsHead) return null;
  // A `{ … }` block's member rows, split at depth-0 semicolons, each
  // in the author's spelling: bind twins and the minted children slot
  // drop; an `extends <tag>` component's intrinsic passthrough (the
  // per-attribute template rows and the `data-`/`aria-` index rows)
  // collapses into the reported tag; and a container union collapses
  // to its value type under the same brand check the reactive-cell
  // presenter applies (both Ts equal). Any other union is the author's
  // own type and stands.
  const open = propsAt + propsHead[0].length - 1;
  const presented = componentPropsAt(flat, open);
  if (presented === null) return null;
  const { props, extendsTag, at } = presented;
  const tail = (objectForm
    ? /^\): ([A-Za-z_$][\w$]*)(?:<.*>)?(?:; mount\(target\?: any\): \1(?:<.*>)?)?;? \}$/
    : /^\) => ([A-Za-z_$][\w$]*)(?:<.*>)?(?: import [A-Za-z_$][\w$]*)?$/
  ).exec(flat.slice(at).trim());
  if (!tail) return null;
  const name = tail[1];
  // The signature is rip vocabulary, so it renders in a `rip` fence —
  // the extension's own grammar colors `component`/`extends` and the
  // prop annotations the way the source does — and the rows carry no
  // TS semicolons.
  const requote = (t) => t.replace(/"([^"'\\]*)"/g, "'$1'");
  const shownName = typeArgs === null ? name : `${name}<${requote(typeArgs)}>`;
  const headLine = extendsTag.tag === null ? `component ${shownName}` : `component ${shownName} extends ${extendsTag.tag}`;
  const signature = props.length === 0
    ? headLine
    : `${headLine}\nprops: {\n${props.map((p) => `  ${p}`).join('\n')}\n}`;
  return { ...contents, value: value.replace(fence[0], '```rip\n' + signature + fence[3]) };
}

// A component PROP KEY at a use site hovers the props surface's slot:
// `(property) outline?: boolean | { value: …; read(): …; touch?(): void; }
// | undefined` — the container arm is the bind-channel admission. The
// author's answer is the prop's type (RULINGS.md, the prop-name row):
// the cell arms collapse under the reactive-cell presenter's brand
// check, and NOTHING else — the trailing `undefined` is tsgo's own
// optional-property convention, kept so these keys hover like every
// other optional property (and the slot truly admits an explicit
// `undefined`). A `(property)` hover whose union carries no brand arm
// passes through untouched.
function presentPropSlotHover(contents) {
  const value = contents?.value;
  if (typeof value !== 'string') return null;
  const fence = /(```(?:typescript|ts)\n)([^]*?)(\n?```)/.exec(value);
  if (!fence) return null;
  const flat = fence[2].replace(/\s+/g, ' ').trim();
  const head = /^\(property\) ((?:.+\.)?[A-Za-z_$][\w$]*)(\??): (.+)$/.exec(flat);
  if (!head) return null;
  const [, name, opt, type] = head;
  // The cell arms collapse onto their value type (collapseCellArms — the
  // same collapse a diagnostic's quoted types take).
  const collapsed = collapseCellArms(type);
  if (collapsed === type) return null;
  const reworded = `(property) ${name}${opt}: ${collapsed}`;
  return { ...contents, value: value.replace(fence[0], `${fence[1]}${reworded}${fence[3]}`) };
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
    // Same-file references first — by PATH, since tsgo percent-encodes a
    // uri's reserved characters and the state's own tsUri spells them.
    const here = fsPathOfUri(state.tsUri);
    const isHere = (u) => (here !== null && fsPathOfUri(u) === here ? 0 : 1);
    const ordered = [...refs].sort((a, b) =>
      isHere(a.uri) - isHere(b.uri)
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

// Add the absence arms to a union without repeating a member it already has.
function withAbsenceArms(type) {
  const arms = unionArms(type);
  if (!arms.includes('undefined')) arms.push('undefined');
  return arms.join(' | ');
}

// Every display response leaves through the boundary pass
// (translate.js presentOutgoing). A field it has to change names a
// presenter that was forgotten upstream, and is logged as a RESCUE — the
// sweep counts those lines as findings, so the net stays an instrument
// and never becomes the only presenter.
const presented = (method, handler) => async (...args) => presentOutgoing(method, await handler(...args), (m, field) => {
  connection.console.log(`[rip] presentation rescue: ${m} ${field}`);
});

connection.onHover(presented('textDocument/hover', async (params) => {
  await tsgoReady;
  // Position-identifying surfaces (definition, references) survive a stale
  // face because staleOffsetMap re-aligns coordinates. A TYPE cannot be
  // re-aligned: change a binding's annotation and hover inside the debounce
  // and the old type is simply the wrong answer. So hover settles too.
  await settleDocument(params.textDocument.uri);
  const ctx = requestContext(params, { wordEndBias: true });
  if (!ctx || ctx.genPosition === null) return null;
  // Intrinsic-element positions the compiler recorded answer from the
  // record itself (RULINGS.md, the render rows) — checked BEFORE the
  // silence decline, because the `ref` word is census-excluded yet
  // ruled to answer. The tag word's face position is a string literal
  // (no symbol — tsgo has nothing to say), so the served text is the
  // native lib.dom spelling of what the lowering does there.
  const intr = (ctx.good.intrinsics ?? []).find((r) => ctx.offset >= r.start && ctx.offset < r.end);
  // What tsgo says at a chosen face offset, flattened. The served records
  // below point at the position that NAMES a type the author's word cannot.
  const askAt = async (offset) => {
    const probe = await tsgoRequest('textDocument/hover', {
      textDocument: { uri: ctx.state.tsUri },
      position: offsetToPosition(ctx.good.genLineStarts, offset),
    }, 'served-record quickinfo');
    return typeof probe?.contents?.value === 'string' ? probe.contents.value.replace(/```\w*\n?/g, '').replace(/\s+/g, ' ').trim() : '';
  };
  if (intr) {
    const map = intr.svg ? 'SVGElementTagNameMap' : 'HTMLElementTagNameMap';
    let body;
    if (intr.kind === 'tag') {
      body = `(element) ${intr.tag}: ${map}['${intr.tag}']`;
    } else if (intr.kind === 'event') {
      // The event word serves the handler's event type — the claim the
      // lowering's casts enforce (RULINGS.md, the event-word row) — in
      // the `(kind)` head form the other served rows use. Host
      // elements read back in the `<tag>` shorthand; a component's
      // root element is a runtime fact, so its known events carry no
      // host claim, and a name outside the DOM vocabulary reads as the
      // custom event it is. No prose in the fence: the grammar
      // tokenizes the body as TypeScript, so an apostrophe would open
      // a string scope.
      body = intr.type === null
        ? `(custom event) @${intr.name}: any`
        : `(event) @${intr.name}: ${intr.type.replace(/(?:HTML|SVG)ElementTagNameMap\['([\w-]+)'\]/g, '<$1>')}`;
    } else if (intr.kind === 'attr') {
      // The attribute KEY answers the value type its road admits
      // (RULINGS.md, the attr-name row). A road that spells presence
      // carries the type outright; every other key reads it off the
      // INSTANTIATED method the record points at — the call is generic
      // over the key, so tsgo prints the one value type this attribute
      // takes. No shape to read means no honest type to name, and the
      // ruled interim is silence.
      // A route-checked href carries the route union; it reads in the same
      // display form the diagnostics use (`/orders/:id`, never `${string}`).
      let type = intr.type === undefined ? null : (intr.route ? prettifyRouteUnion(intr.type, ctx.good.routeEntries) : intr.type);
      if (type === null && typeof intr.gen === 'number') {
        const flat = await askAt(intr.gen);
        const m = /\(name: "[^"]*", (?:value|force\??): (.+?)\): void/.exec(flat);
        // The call takes the value ALREADY NARROWED past the absence fork,
        // so its parameter names what lands on the element. The road admits
        // the two absence spellings on top, and the answer says so — unless
        // the value type already carries one (a DOM property spelled
        // `string | null`), which must not be said twice.
        // Through the same scrub every served answer takes: a surface
        // name reads back as what the author wrote, never its face spelling.
        if (m) type = withAbsenceArms(scrubFaceArtifacts(m[1]));
      }
      if (type === null) return null;
      body = `(attribute) ${intr.name}: ${type}`;
    } else if (intr.kind === 'classkey') {
      // A `class:` merged with a selector class emits no key of its own — the
      // pair dissolves into one `__clsx` argument — so it answers from the
      // typed `className` the merge writes, which is the SAME answer the
      // unmerged spelling gives. The key does not change meaning because a
      // selector appeared on the tag.
      const head = /^\(property\) (?:.+\.)?[\w$]+\??: (.+)$/.exec(await askAt(intr.gen));
      if (head === null) return null;
      // The merged key answers as the attribute the author wrote, like every
      // other element key — never as the surface's `className` property.
      body = `(attribute) ${intr.name}: ${scrubFaceArtifacts(head[1])}`;
    } else if (intr.kind === 'bind') {
      // The `<=>` target names a channel, not a symbol: the census spends the
      // word, so the answer comes from the record. Both receivers land on a
      // typed face position — an element property for an intrinsic bind, the
      // minted props key for a component one — and the component's key holds
      // the CONTAINER, whose value type is what the author bound.
      const head = /^\(property\) (?:.+\.)?[\w$]+\??: (.+)$/.exec(await askAt(intr.gen));
      if (head === null) return null;
      // A bindable prop's slot is the CONTAINER, and an optional one arrives
      // as a union with its absence arm — so the arms are split and the cell
      // among them gives up the value type the author bound.
      const cell = unionArms(head[1]).map(cellShape).find((c) => c !== null);
      body = `(bind) ${intr.name}: ${scrubFaceArtifacts(cell ? cell.value : head[1].trim())}`;
    } else if (intr.kind === 'key' || intr.kind === 'slot') {
      // Two channel words whose typed position is what they spend: a
      // loop's `key:` reads its expression's type off the expression's
      // last name (the bind technique); `slot` reads the children it
      // projects off the `children` member (RULINGS.md, render rows).
      const head = /^\((?:parameter|property|method|accessor)\) (?:.*?\.)?[\w$]+(\??): ([^]+)$/.exec(scrubFaceArtifacts(await askAt(intr.gen)));
      if (head === null) return null;
      // An optional member keeps its marker beside its absence arm — the
      // form every optional member answers in (`label?: string | undefined`).
      body = intr.kind === 'key' ? `(key) key: ${head[2].trim()}` : `(slot) children${head[1]}: ${head[2].trim()}`;
    } else if (intr.kind === 'schema') {
      // A schema body's words are descriptor string literals in the face
      // and carry no symbol, so each answers from its own member in the
      // companion alias (RULINGS.md, Schema). A name row keeps tsgo's
      // type and takes rip's word for the head — the body declared a
      // field or a callable, never the `property` the alias spells. A
      // type-slot row lands on an annotation already, so it passes
      // through whatever that position answers.
      const flat = scrubFaceArtifacts(await askAt(intr.gen));
      if (flat === '') return null;
      if (intr.label === null) { body = flat; }
      else {
        const head = new RegExp(`^\\(property\\) (?:.*?\\.)?${reSource(intr.name)}\\??: ([^]+)$`).exec(flat);
        if (head === null) return null;
        // The `this` parameter is the lowering's own calling convention,
        // not a parameter the author declared — it is spent making the
        // body's `@name` reads resolve, so it never reaches the answer.
        const type = head[1].trim().replace(/^\(this: [^,)]+(?:, )?/, '(');
        body = `(${intr.label}) ${intr.name}${intr.optional ? '?' : ''}: ${type}`;
      }
    } else {
      body = `ref — writes ${map}['${intr.tag}'] into ${intr.name}`;
    }
    return { contents: { kind: 'markdown', value: `\`\`\`typescript\n${body}\n\`\`\`` } };
  }
  // The POSITIVE hover model: outside the author's own symbol tokens
  // (and the served records above, which answered already) there is
  // nothing to ask about — a keyword, a literal's interior, a comment,
  // or a blank byte otherwise falls to a cover row and answers about
  // a NEIGHBOR. Declining here is the platform's own convention.
  if (!inNoUserSymbolSpan(ctx.good.hoverable ?? [], ctx.offset)) return null;
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
  // The same decline for the lowering's MINTED `__` names (`__effect`,
  // `__clsx`, the generated interfaces): a cover-row landing can put a
  // position on one of them, and tsgo then describes the helper. The
  // author's own `__`-prefixed binding is spared by the source check —
  // it spells the hover's declared name at the hovered position;
  // machinery never does.
  // Judged on the SCRUBBED text: a `__` spelling the presentation
  // layer translates (`__RipEl_span` → `<span>`) is presentable, not
  // machinery — what gates is a minted name no translation covers.
  const minted = typeof hover.contents?.value === 'string'
    ? /(?:\b(?:let|const|var|function|class|interface|type) |\((?:property|parameter|method)\) )(__[A-Za-z$][\w$]*)/.exec(scrubFaceArtifacts(hover.contents.value)) : null;
  if (minted && wordAtOffset(ctx.good.source, ctx.offset) !== minted[1]) return null;
  // The cover-`this` answer: a position with no landing of its own
  // falls to a render cover whose generated start sits on the lowered
  // receiver, and tsgo reports `this: this` over the whole construct.
  // Machinery, not an answer (RULINGS.md names it among what the
  // declines replaced) — unless the author is actually on a `this`.
  if (typeof hover.contents?.value === 'string'
      && /^```(?:typescript|ts)\n\s*this: this\s*\n?```/.test(hover.contents.value)
      && wordAtOffset(ctx.good.source, ctx.offset) !== 'this') return null;

  let contents = (await enrichEvolvingAnyHover(ctx, hover)) ?? hover.contents;
  contents = reorderUnionHover(ctx, contents) ?? contents;
  contents = presentReactiveCellHover(contents, memberDecl === 'value') ?? contents;
  contents = presentComponentSignatureHover(contents) ?? contents;
  contents = presentPropSlotHover(contents) ?? contents;
  // The declaration's own kind. tsgo names the CELL the lowering binds
  // (`const count: number`), which describes the emission and not the
  // construct the author declared — the same leak the token audit refuses
  // in the color. Rip mints its own labels, mirroring TypeScript's
  // (RULINGS.md, Principles), so the head is replaced and the type it
  // resolved stands untouched.
  const kind = (ctx.good.kinds ?? []).find((k) => ctx.offset >= k.start && ctx.offset < k.end);
  if (kind && typeof contents?.value === 'string') {
    // Two heads to displace: the `const`/`let` tsgo gives a module binding,
    // and the `(property) Owner.` it gives a class member. The owner is
    // dropped with it — at a member's own declaration the class is the line
    // above, and the ruled form names the member alone.
    // Two heads to displace. A class member arrives as `(property) Owner.name`
    // — and the owner can carry type parameters, so the replacement is
    // anchored on the member's OWN name rather than on a shape for the owner.
    // A module binding arrives as `const`/`let`.
    const esc = kind.name === null ? null : reSource(kind.name);
    contents = { ...contents, value: contents.value
      // The marker is re-emitted from the record, never read off tsgo's text:
      // the face declares an optional member required, so only the record
      // knows the author wrote `?`.
      .replace(esc === null ? /(?!)/ : new RegExp(`\\(property\\) [^\\n]*?\\b${esc}\\??(?=:)`), `(${kind.label}) ${kind.name}${kind.optional ? '?' : ''}`)
      .replace(/\b(?:const|let|var) (?=[A-Za-z_$])/, `(${kind.label}) `) };
  }
  // A route union in the hover renders for READING — the same
  // display-only re-labeling the diagnostics road applies.
  if (typeof contents?.value === 'string' && ctx.good.routeEntries?.length) {
    contents = { ...contents, value: prettifyRouteUnion(contents.value, ctx.good.routeEntries) };
  }
  // Face artifacts read back in the author's vocabulary — the
  // intrinsic-surface names among them (display only).
  if (typeof contents?.value === 'string') {
    contents = { ...contents, value: scrubFaceArtifacts(contents.value) };
  }
  // An element KEY answers as the attribute the author wrote, whichever
  // road the lowering took it down. A property-road key (`class:`,
  // `value:`, `innerHTML:`) lands on the surface's real property, so tsgo
  // heads it `(property) <tag>.className` — the road and the DOM's own
  // name for it, neither of which the author spelled. The attribute and
  // boolean roads already answer `(attribute) key: T`; this makes the
  // three one form: the word under the cursor, and the type the road
  // admits (RULINGS.md, attr name on an intrinsic).
  if (typeof contents?.value === 'string' && typeof ctx.genExact === 'number'
      && (ctx.good.attrNames ?? []).some(([s, e]) => ctx.genExact >= s && ctx.genExact < e)) {
    const span = (ctx.good.hoverable ?? []).find(([a, b]) => ctx.offset >= a && ctx.offset < b);
    const word = span ? ctx.good.source.slice(span[0], span[1]) : null;
    if (word !== null) {
      contents = { ...contents, value: contents.value.replace(/\(property\) <[\w-]+>\.[\w$]+\??: /, `(attribute) ${word}: `) };
    }
  }

  // The response range travels the reverse path: generated → last-good
  // source → current buffer. If it does not survive both hops intact,
  // the hover ships without a range.
  let range;
  if (hover.range) {
    const srcRange = faceRangeToSourceRange(ctx.good, hover.range);
    if (srcRange) range = goodRangeToCurrent(ctx, srcRange) ?? undefined;
  }
  return { contents, ...(range ? { range } : {}) };
}));

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
  // A NAMESPACE or DEFAULT import's definition is the module — tsgo
  // targets the whole file, or the `export default` statement whose
  // body is the lowering's spelling. Neither has a name to land on
  // verbatim: the whole-file target answers the module (its start,
  // like a specifier's), and the default statement lands on its
  // `default` keyword (faceRangeToSourceRange). Every other target is a
  // symbol and maps strictly.
  let locations = span ? ripModuleLocations(result) : flattenLocations(result).map(({ uri, range }) => {
    const wholeFile = range.start.line === 0 && range.start.character === 0 && (range.end.line > 0 || range.end.character > 0);
    return wholeFile && classifyTsUri(uri)?.kind !== 'real' ? ripModuleLocation(uri, range) : ripLocation(uri, range, { strict: true });
  }).filter(Boolean);
  // …and of the SYMBOL locations that mapping produced, the ones that
  // actually name the symbol under the cursor: the two rules compose —
  // this one chooses among mapped answers, the mapping above decides
  // what each answer IS.
  if (!span && locations.length > 1) locations = preferNamingLocations(params, locations);
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
  if (span) return ripModuleLocations(result);
  // tsgo answers a TYPE ALIAS with its body as the selection (`{ name:
  // string; … }`), not its name. A landing that is not an identifier,
  // on a line declaring a type or interface, re-lands on the declared
  // name — the symbol the command names.
  return ripLocations(result).map((loc) => {
    const text = ripTextAt(loc.uri, loc.range);
    if (text === null || /^[A-Za-z_$][\w$]*$/.test(text)) return loc;
    const line = ripLineAt(loc.uri, loc.range.start.line);
    const decl = line === null ? null : /^\s*(?:export\s+)?(?:type|interface)\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (!decl) return loc;
    const character = line.indexOf(decl[1], decl[0].length - decl[1].length);
    return { uri: loc.uri, range: { start: { line: loc.range.start.line, character }, end: { line: loc.range.start.line, character: character + decl[1].length } } };
  });
});

// References take NO module treatment: at a specifier, tsgo answers
// the import-site string literals — verbatim spans in each importing
// face that the ordinary range map-back serves. (Implementation is not
// served: rip's libraries state contracts structurally, and nothing in
// the language's idiom declares an `implements` relationship for the
// command to follow.)
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

// The TYPE half of a one-line declaration head: what follows the first
// `: ` after the head's name (`let text: string` → `string`, `(property)
// P.count: number` → `number`); a construct or call head (`constructor
// Field(props): Field`) is its own type. Null where no head is found.
function typeTextOf(flat) {
  if (typeof flat !== 'string' || flat === '') return null;
  if (/^(?:constructor |\(method\) |function )/.test(flat)) return flat;
  const m = /^(?:\(alias\) )*(?:\([a-z ]+\) )?(?:readonly )?(?:const |let |var )?[\w$.]+(?:<[^>]*>)?\??: ([^]*)$/.exec(flat);
  return m ? m[1] : null;
}

// A completion item's detail column is a typed line, the same thing a
// hover's fenced block is, and it takes the hover's own presenters
// before the type presenter: a component's construct signature reads as
// its rip signature on one line (`component Button extends button props:
// { … }`), and a reactive member of a component THIS file declares reads
// value-first, the in-body answer (RULINGS.md, the member rows) — a
// consumer's instance member, declared elsewhere, keeps its container.
// Everything else is presentType's.
function presentCompletionDetail(good, detail) {
  const fence = { kind: 'markdown', value: '```typescript\n' + detail + '\n```' };
  const asComponent = presentComponentSignatureHover(fence);
  if (asComponent) {
    const body = /```rip\n([^]*?)\n```/.exec(asComponent.value);
    if (body) {
      const lines = body[1].split('\n');
      return lines.length > 1 ? `${lines[0]} props: { ${lines.slice(2, -1).map((l) => l.trim()).join('; ')} }` : lines[0];
    }
  }
  const flat = detail.replace(/\s+/g, ' ').trim();
  // tsgo cuts a long resolved detail short (`…Record<'accesskey', ...`),
  // and a cut construct signature parses as nothing: the props block is
  // open-ended. The construct's own head still says what it is, and a
  // component whose rows cannot be read presents as the component alone
  // — never as the lowering's cut text.
  const construct = /^(?:\(alias\) )?(?:const|let|var) ([A-Za-z_$][\w$]*): (?:\{ )?new (?:<[^(]*>)?\(props\??: \{/.exec(flat);
  if (construct) return `component ${construct[1]}`;
  const member = /^\(property\) (?:[\w$]+\.)*([A-Za-z_$][\w$]*)\.[A-Za-z_$][\w$]*: \{/.exec(flat);
  if (member && new RegExp(`(?:^|\\n)(?:export )?${member[1]}(?:<[^>\\n]*>)?\\s*=\\s*component\\b`).test(good.source)) {
    const asMember = presentReactiveCellHover({ ...fence, value: '```typescript\n' + flat + '\n```' }, true);
    const body = asMember ? /```typescript\n([^]*?)\n```/.exec(asMember.value) : null;
    if (body) return presentType(body[1]);
  }
  return presentType(detail);
}

// A completion's documentation, either LSP spelling, face names scrubbed.
function scrubDocumentation(doc) {
  return typeof doc === 'string' ? scrubFaceArtifacts(doc) : { ...doc, value: scrubFaceArtifacts(doc.value ?? '') };
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
      item.labelDetails.description = presentType(item.labelDetails.description);
    }
  }
  for (const key of ['sortText', 'filterText', 'insertText', 'preselect', 'tags']) {
    if (raw[key] !== undefined) item[key] = raw[key];
  }
  // The detail column is a printed type and the documentation is prose:
  // the type presents (presentType — scrubbed, a cell arm collapsed), the
  // prose only scrubs.
  if (raw.detail) item.detail = presentCompletionDetail(ctx.good, raw.detail);
  if (raw.documentation) item.documentation = scrubDocumentation(raw.documentation);
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

// Finishing work for completions inside a rip STRING LITERAL that is
// route-constrained. tsgo's raw items need two repairs there: it sends
// BARE LABELS, so the client's word-range insertion doubles the typed
// prefix (accepting `/cart` inside `'/'` lands `//cart`) — every item
// gets a textEdit replacing the literal's interior — and it offers only
// the union's string-literal members, so the DYNAMIC members ride in as
// our own items, labeled by their display (`/orders/:id`) and inserting
// their static prefix (`/orders/`). The gate is a RECORDED FACT, never
// an inference: the mapped face offset sits inside a routeWraps value
// span — the emitter records one per checked surface, attribute wraps
// and `push`/`replace` arguments alike — so a user-authored literal
// union that happens to be a subset of the route statics is never
// rewritten or fed members its type rejects. All items take
// walker-order sortText, so the popup reads like the diagnostics do.
function finishRouteStringItems(ctx, genOffset, items) {
  const entries = ctx.good.routeEntries;
  if (!entries?.length || items.length === 0) return;
  const inWrap = (ctx.good.routeWraps ?? []).some((w) => genOffset >= w.value[0] && genOffset <= w.value[1]);
  if (!inWrap) return;

  // The enclosing SOURCE string literal — the innermost cover row that
  // is a quoted string around the cursor. Without one (mid-edit, an
  // exotic spelling) the items stay untouched.
  const src = ctx.good.source;
  let literal = null;
  for (const r of ctx.good.mappings.atSource(ctx.offset)) {
    if (r.sourceEnd - r.sourceStart < 2) continue;
    const q = src[r.sourceStart];
    if ((q !== "'" && q !== '"') || src[r.sourceEnd - 1] !== q) continue;
    if (ctx.offset <= r.sourceStart || ctx.offset >= r.sourceEnd) continue;
    literal = r;
    break;
  }
  if (!literal) return;
  const range = goodRangeToCurrent(ctx, {
    start: offsetToPosition(ctx.good.srcLineStarts, literal.sourceStart + 1),
    end: offsetToPosition(ctx.good.srcLineStarts, literal.sourceEnd - 1),
  });
  if (!range) return;

  const order = new Map(entries.map((e, i) => [e.text.startsWith('"') ? JSON.parse(e.text) : e.display, i]));
  const kind = items[0].kind;
  for (const item of items) {
    item.textEdit = { range, newText: item.label };
    item.filterText = item.label;
    const at = order.get(item.label);
    if (at !== undefined) item.sortText = String(at).padStart(3, '0');
  }
  for (const e of entries) {
    if (!e.text.startsWith('`') || !e.display) continue;
    const prefix = e.shape.slice(0, e.shape.indexOf('${'));
    // A snippet-capable client gets the display's param slots as
    // tabstops with the first pre-selected (`/orders/${1:id}`); anyone
    // else gets the static prefix and a cursor ready to type the id.
    const snippet = clientSnippetSupport ? (() => {
      let slot = 0;
      const escaped = (t) => t.replace(/([\\$}])/g, '\\$1');
      return e.display.split('/').map((seg) =>
        seg.startsWith(':') && seg.length > 1 ? `$\{${++slot}:${seg.slice(1)}}` : escaped(seg)).join('/');
    })() : null;
    items.push({
      label: e.display,
      kind,
      // The statics' right-hand detail arrives from tsgo's resolve;
      // a synthetic item states its own — the params the route
      // captures, the most a URL slot can tell you.
      detail: e.display.split('/').filter((seg) => seg.startsWith(':') && seg.length > 1)
        .map((seg) => `${seg.slice(1)}: string`).join(', '),
      textEdit: { range, newText: snippet ?? prefix },
      ...(snippet ? { insertTextFormat: InsertTextFormat.Snippet } : {}),
      filterText: prefix,
      sortText: String(order.get(e.display) ?? entries.length).padStart(3, '0'),
    });
  }
}

// The MEMBER-DOT PROBE: completion's answer for a buffer the tolerant
// compile cannot hold. A trailing `.` mid-file is LEGAL continuation
// (`x = a.` + `y = 2` parses as `x = a.y = 2`), so recovery cannot mint
// a hole there — the next line merges into the expression, and when the
// merged program will not emit (a swallowed `<~`, a nonsense member
// chain), the whole compile rides the last-good face. The probe repairs
// the buffer INSTEAD of the parse: a marker identifier at the cursor
// completes the member access (the next line stops merging), the
// repaired buffer compiles as this module, and a transient overlay on
// the buffer's own face document asks tsgo at the marker. A typed
// prefix rides along — `data.va` + marker is the identifier
// `va__ripDotProbe`, tsgo lists the receiver's members from inside it,
// and the client's own word-prefix filter narrows. Fires from
// completion's null exits AND its ask-fidelity gate (below), so a
// working road never pays for it.
const DOT_PROBE_MARK = '__ripDotProbe';
// A member-dot ask at `cursor`: an identifier prefix (possibly empty)
// whose preceding character is `.`. Answers the prefix start, or null
// when the cursor is not completing a member.
function memberAskStart(text, cursor) {
  let i = cursor;
  while (i > 0 && /[\w$]/.test(text[i - 1])) i--;
  return text[i - 1] === '.' ? i : null;
}
async function dotProbeCompletion(params) {
  const state = states.get(params.textDocument.uri);
  const document = documents.get(params.textDocument.uri);
  if (!state?.mirrorPath || !document || !tsgo || !compile) return null;
  const text = document.getText();
  const curLineStarts = lineStartsOf(text);
  const cursor = positionToOffset(curLineStarts, text.length, params.position);
  if (memberAskStart(text, cursor) === null || text.includes(DOT_PROBE_MARK)) return null;
  let result;
  try {
    const fsPath = fileURLToPath(document.uri);
    const stashSpec = appStashSpecFor(fsPath, workspaceRoot);
    const routes = appRoutesFor(fsPath, workspaceRoot);
    result = compile(text.slice(0, cursor) + DOT_PROBE_MARK + text.slice(cursor), {
      path: document.uri, runtimeDelivery: 'inline', face: 'ts', strict: state.strict, tolerant: true,
      appStashSpec: stashSpec, routesUnion: routes.union, routeParams: routes.params,
    });
  } catch { return null; }
  const at = result.code.indexOf(DOT_PROBE_MARK);
  if (at < 0) return null;
  const items = await overlayCompletionAsk(state, result.code, at);
  return items.length ? { isIncomplete: false, items } : null;
}

// One completion ask against a PROBE face, returned as bare-label
// items (scaffolding filtered). OVERLAY, not a new document: the probe
// text rides the buffer's own face document (a project member by
// construction — a freshly minted probe file answers before tsgo has
// admitted it to the project, and an unadmitted file resolves no
// imports). The overlay swaps in, one completion asks against it, and
// the CURRENT last-good face swaps back in the finally — read at
// restore time, because a refresh can complete while the probe awaits
// tsgo. The version counter is the state's own so both roads stay
// monotonic. A buffer that has NEVER compiled has no face document
// yet: the probe face becomes its first (mirror written so the project
// holds a real file), stays open, and the next good compile didChanges
// over it.
async function overlayCompletionAsk(state, code, at) {
  const coldOpen = !(state.tsOpen && state.lastGood);
  try {
    state.tsVersion += 1;
    if (!state.tsOpen) {
      try { writeMirror(state.mirrorPath, code); } catch { return []; }
      state.tsOpen = true;
      tsgo.client.notify('textDocument/didOpen', {
        textDocument: { uri: state.tsUri, languageId: 'typescript', version: state.tsVersion, text: code },
      });
    } else {
      tsgo.client.notify('textDocument/didChange', {
        textDocument: { uri: state.tsUri, version: state.tsVersion },
        contentChanges: [{ text: code }],
      });
    }
    const position = offsetToPosition(lineStartsOf(code), at);
    let res = await tsgoRequest('textDocument/completion', {
      textDocument: { uri: state.tsUri }, position,
    }, 'completion probe');
    // A COLD-opened face (this probe was the document's first) can
    // answer null while tsgo settles its project association — one
    // beat, one retry.
    if (res === null && coldOpen) {
      await new Promise((r) => setTimeout(r, 400));
      res = await tsgoRequest('textDocument/completion', {
        textDocument: { uri: state.tsUri }, position,
      }, 'completion probe');
    }
    const raw = Array.isArray(res) ? res : res?.items ?? [];
    const items = [];
    for (const item of raw) {
      if (isScaffoldingLabel(item.label) || isMirrorImportItem(item)) continue;
      // Labels only: the probe overlay is transient, so resolve-lazy
      // detail and tsgo text edits have nothing durable to point at —
      // a member name inserted at the cursor's own (empty) word range
      // is exactly the right edit.
      const out = { label: item.label };
      for (const key of ['kind', 'sortText', 'preselect', 'tags']) {
        if (item[key] !== undefined) out[key] = item[key];
      }
      items.push(out);
    }
    return items;
  } finally {
    // Restore the face CURRENT at this moment, never the pre-probe
    // snapshot: a debounced refresh may have completed while the probe
    // awaited tsgo (nothing orders the two), and re-sending its output
    // is a harmless duplicate where re-sending the old snapshot would
    // desync tsgo from lastGood until the next keystroke. A buffer
    // still without a good compile restores nothing — the probe face
    // stays its first document by design.
    const current = state.lastGood ? state.lastGood.code : null;
    if (current !== null) {
      state.tsVersion += 1;
      tsgo.client.notify('textDocument/didChange', {
        textDocument: { uri: state.tsUri, version: state.tsVersion },
        contentChanges: [{ text: current }],
      });
    }
  }
}

// Whether a cursor sits in RENDER content, judged on the last good
// compile's own record: the cursor's line, or the line above it, holds
// a render pair or an intrinsic position. The cursor reaches the good
// source through the stale alignment — its line start stands in when
// the cursor's own bytes are the edit. A buffer without a good compile,
// or a cursor the alignment cannot place, is not judged.
function inRenderContent(state, text, cursor) {
  const good = state.lastGood;
  if (!good) return true;
  const align = staleOffsetMap(text, good.source);
  const at = align.toGood(cursor) ?? align.toGood(text.lastIndexOf('\n', cursor - 1) + 1);
  if (at === null) return true;
  const lineOf = (offset) => offsetToPosition(good.srcLineStarts, offset).line;
  const line = lineOf(at);
  const spans = [
    ...(good.renderPairs ?? []).map((p) => p.pair),
    ...(good.intrinsics ?? []).map((r) => [r.start, r.end]),
  ];
  return spans.some(([s, e]) => lineOf(s) <= line && lineOf(Math.max(s, e - 1)) >= line - 1);
}

// The pair-splice probe: an ATTRIBUTE-KEY ask the buffer cannot answer
// through its own face — a bare prefix (`pla`) or an empty slot inside
// an element body, positions whose real compile either fails or lands
// the cursor on bytes that are not a key. The probe splices the ask
// into a well-formed pair (`pla` → `<mark>: null`), compiles it
// tolerant, and asks completions INSIDE the spliced key — where the
// receiver surface's string-literal union answers with the tag's own
// attribute vocabulary. Same overlay contract as the dot probe. The
// probe costs a compile and two face swaps, so it runs only where a
// key can be asked for: inside render content.
async function pairSpliceProbe(params) {
  const state = states.get(params.textDocument.uri);
  const document = documents.get(params.textDocument.uri);
  if (!state?.mirrorPath || !document || !tsgo || !compile) return null;
  const text = document.getText();
  const curLineStarts = lineStartsOf(text);
  const cursor = positionToOffset(curLineStarts, text.length, params.position);
  if (text.includes(DOT_PROBE_MARK)) return null;
  // The ask must sit at the END of its word (attr words carry `-`).
  if (cursor < text.length && /[\w$-]/.test(text[cursor])) return null;
  let s = cursor;
  while (s > 0 && /[\w$-]/.test(text[s - 1])) s--;
  const prev = s > 0 ? text[s - 1] : '';
  // Member (`.`), value (`:`), and event (`@`) asks are other roads.
  if (prev === '.' || prev === ':' || prev === '@' || prev === '#') return null;
  if (s === cursor) {
    // An EMPTY-slot ask only on an otherwise-blank line tail — an
    // empty prefix anywhere else is every other completion in the file.
    const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
    if (text.slice(lineStart, cursor).trim() !== '') return null;
  }
  if (!inRenderContent(state, text, cursor)) return null;
  let result;
  try {
    const fsPath = fileURLToPath(document.uri);
    const stashSpec = appStashSpecFor(fsPath, workspaceRoot);
    const routes = appRoutesFor(fsPath, workspaceRoot);
    result = compile(text.slice(0, s) + DOT_PROBE_MARK + ': null' + text.slice(cursor), {
      path: document.uri, runtimeDelivery: 'inline', face: 'ts', strict: state.strict, tolerant: true,
      appStashSpec: stashSpec, routesUnion: routes.union, routeParams: routes.params,
    });
  } catch { return null; }
  const at = result.code.indexOf(DOT_PROBE_MARK);
  if (at < 0) return null;
  // One byte INSIDE the mark: the key lands as a string literal on the
  // attribute road, and a completion ask at the literal's first byte
  // reads as outside the string (the identifier scope) — inside it,
  // the constrained union answers.
  const items = await overlayCompletionAsk(state, result.code, at + 1);
  return items.length ? { isIncomplete: false, items } : null;
}

connection.onCompletion(presented('textDocument/completion', async (params) => {
  await tsgoReady;
  // The buffer being typed is the whole point of these two
  // surfaces, so they wait for it rather than answering about the
  // text of 100ms ago.
  await settleDocument(params.textDocument.uri);
  const ctx = requestContext(params);
  if (!ctx) return (await dotProbeCompletion(params)) ?? pairSpliceProbe(params);
  const genCursor = ctx.genSlot ?? ctx.genExact;
  if (genCursor === null) return (await dotProbeCompletion(params)) ?? pairSpliceProbe(params);
  // A member-dot ask must land in the face AS the same member-dot —
  // same typed prefix, right of a `.`. Two faces betray it: a STALE
  // face (the trailing dot failed to compile, and the fresh `.` sits
  // exactly at the alignment boundary, so the cursor "survives"
  // translation onto the END of the previous segment) and a DANGLING
  // dot the tolerant emit passed through (`this.stash.` verbatim —
  // syntactically invalid TS whose cursor mapping also lands on the
  // previous word). Both make tsgo complete that word among ITS
  // receiver's members: non-empty, plausible, one segment wrong
  // (`@stash.` offered `stash`). A prefix mismatch hands the ask to
  // the probe; a faithful landing pays nothing.
  const cursor = positionToOffset(ctx.curLineStarts, ctx.currentText.length, params.position);
  const askStart = memberAskStart(ctx.currentText, cursor);
  if (askStart !== null) {
    const faceStart = memberAskStart(ctx.good.code, genCursor);
    const faithful = faceStart !== null
      && ctx.good.code.slice(faceStart, genCursor) === ctx.currentText.slice(askStart, cursor);
    if (!faithful) {
      const probed = await dotProbeCompletion(params);
      if (probed) return probed;
    }
  } else {
    // A bare-WORD ask whose bytes do not survive into the face at the
    // mapped position is the pair-splice probe's case: a broken
    // attribute line compiles stale, and the cursor lands on whatever
    // the last good compile put there.
    let ws = cursor;
    while (ws > 0 && /[\w$-]/.test(ctx.currentText[ws - 1])) ws--;
    if (ws < cursor) {
      let fs = genCursor;
      while (fs > 0 && /[\w$-]/.test(ctx.good.code[fs - 1])) fs--;
      const faithful = ctx.good.code.slice(fs, genCursor) === ctx.currentText.slice(ws, cursor);
      if (!faithful) {
        const probed = await pairSpliceProbe(params);
        if (probed) return probed;
      }
    }
  }
  const context = relayableCompletionContext(params.context);
  const result = await tsgoRequest('textDocument/completion', {
    textDocument: { uri: ctx.state.tsUri },
    position: offsetToPosition(ctx.good.genLineStarts, genCursor),
    ...(context ? { context } : {}),
  }, 'completion');
  if (!result) return pairSpliceProbe(params);
  const rawItems = Array.isArray(result) ? result : result.items ?? [];
  ctx.state.lastCompletion = rawItems;
  // tsgo's resolve, asked with the cursor inside a CALLABLE symbol's own
  // name (a class in `new Field(`, a function in `go()`), prints every
  // item's detail with that symbol's type after the item's own head —
  // `let text: new (props?) => Field`. The cursor symbol's type is read
  // once here, and a resolved detail that merely repeats it is dropped
  // (onCompletionResolve) rather than shown wrong. At a fresh prefix,
  // a blank, or a plain variable the details are tsgo's own and pass.
  ctx.state.lastCompletionCursorType = null;
  ctx.state.lastCompletionCursorWord = null;
  if (/[\w$]/.test(ctx.currentText[cursor - 1] ?? '') || /[\w$]/.test(ctx.currentText[cursor] ?? '')) {
    let ws = cursor, we = cursor;
    while (ws > 0 && /[\w$]/.test(ctx.currentText[ws - 1])) ws--;
    while (we < ctx.currentText.length && /[\w$]/.test(ctx.currentText[we])) we++;
    ctx.state.lastCompletionCursorWord = ctx.currentText.slice(ws, we);
    const probe = await tsgoRequest('textDocument/hover', {
      textDocument: { uri: ctx.state.tsUri }, position: offsetToPosition(ctx.good.genLineStarts, genCursor),
    }, 'completion cursor type');
    const flat = typeof probe?.contents?.value === 'string' ? probe.contents.value.replace(/```\w*\n?/g, '').replace(/\s+/g, ' ').trim() : '';
    ctx.state.lastCompletionCursorType = typeTextOf(flat);
  }
  const items = [];
  for (let i = 0; i < rawItems.length; i++) {
    if (isScaffoldingLabel(rawItems[i].label, ctx.good.source) || isMirrorImportItem(rawItems[i])) continue;
    const item = ripCompletionItem(ctx, rawItems[i], i);
    if (item) items.push(item);
  }
  finishRouteStringItems(ctx, genCursor, items);
  if (items.length === 0) {
    // Nothing survived the face ask — an attribute-key position whose
    // mapped bytes answer no completions falls to the probe.
    const probed = await pairSpliceProbe(params);
    if (probed) return probed;
  }
  return { isIncomplete: Array.isArray(result) ? false : !!result.isIncomplete, items };
}));

connection.onCompletionResolve(presented('completionItem/resolve', async (item) => {
  const { uri, index } = item.data ?? {};
  const state = uri === undefined ? null : states.get(uri);
  const raw = state?.lastCompletion?.[index];
  if (!raw || !tsgo) return item;
  const resolved = await tsgoRequest('completionItem/resolve', raw, 'completion resolve');
  if (!resolved) return item;
  // The positional leak (see onCompletion): a detail whose type is the
  // cursor symbol's own, on an item that is not that symbol, is not the
  // item's type and does not show.
  // The item that IS the cursor symbol carries its own type by right. Every
  // other item's detail is the leak when it carries the cursor type — whole,
  // as a variable's type, or as the PARAMETER LIST a function head wears
  // (`function scroll(props?: { … }): Tag` for a construct `new (props?: {
  // … }) => Tag`), which is the same body under another head.
  const leaked = state.lastCompletionCursorType;
  const own = item.label.replace(/\?$/, '') === state.lastCompletionCursorWord;
  const leakedBody = leaked === null ? null : /\((?:.|\n)*\)(?= =>|:)/.exec(leaked)?.[0] ?? null;
  const flatDetail = resolved.detail ? resolved.detail.replace(/\s+/g, ' ').trim() : '';
  const carriesLeak = leaked !== null && !own && (typeTextOf(flatDetail) === leaked || (leakedBody !== null && leakedBody.length > 8 && flatDetail.includes(leakedBody)));
  if (resolved.detail && !carriesLeak) {
    item.detail = state.lastGood ? presentCompletionDetail(state.lastGood, resolved.detail) : presentType(resolved.detail);
  }
  if (resolved.documentation) item.documentation = scrubDocumentation(resolved.documentation);
  if (resolved.additionalTextEdits?.length) {
    const ctx = requestContext({ textDocument: { uri } });
    const mapped = ctx ? faceEditsToCurrent(ctx, resolved.additionalTextEdits) : null;
    if (mapped) item.additionalTextEdits = mapped;
    else connection.console.log(`[rip] auto-import edit for '${item.label}' did not map — inserted without the import`);
  }
  return item;
}));

// ---- signature help: the position maps with cursor semantics (the
// active position sits between a call's argument tokens); the response
// carries no positions — signatures, activeSignature, and
// activeParameter pass through as tsgo computed them, which is what
// keeps the indices correct across bodiless overload rows (the face
// prints them adjacent to their implementation, and tsgo numbers the
// overload list itself).
connection.onSignatureHelp(presented('textDocument/signatureHelp', async (params) => {
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
  // The calls the LOWERING wrote never show. A positional text child
  // lowers to the text-node call, an element tag to createElement, a
  // handler's arrow into the runtime's `__batch` wrapper: a cursor there
  // lands inside a call the author never wrote, and tsgo would describe
  // ITS signature. The face's callee says whose call this is; and when
  // the wrapper's paren sits on an earlier face line, the answer itself
  // says so — a signature whose callee is a minted `__` name the source
  // never spells.
  if (insideLoweredCall(ctx.good.code, genCursor)) return null;
  // The general form of the same rule: the call's CALLEE must be a word
  // the author wrote. The lowering inserts calls whose callee is a lib
  // name — `__out.push(` for a comprehension, `Object.assign(` for a
  // spread, `Array.isArray(`/`.includes(` for `in`, `new RegExp(` for a
  // heregex, `toMatchable(` for `=~` — and a signature there describes
  // the lowering. A callee whose face bytes map back to source
  // verbatim is the author's; one with no such twin is not.
  if (!authoredCallee(ctx, genCursor)) return null;
  const active = result.signatures[result.activeSignature ?? 0];
  const mintedCallee = /^(__[A-Za-z$][\w$]*)\(/.exec(active?.label ?? '');
  if (mintedCallee && !ctx.good.source.includes(mintedCallee[1])) return null;
  // A COMPONENT USE declines. Its props are named keys, so there is no
  // positional parameter for the highlight to track, and the hover on
  // the component's name already answers the signature in the author's
  // spelling; what signature help would add is the same rows in a call
  // shape. The construction is recognized by its own signature — the
  // one-parameter `Name(props?: { … }): Name` row whose block reads as
  // a props block — so a class the author constructs positionally
  // answers as any call does.
  if (isComponentConstruction(active)) return null;
  return {
    ...result,
    signatures: result.signatures.map((sig) => ({ ...sig, label: presentType(sig.label) })),
  };
}));

// Whether the face position `gen` sits inside the argument list of a call
// the LOWERING minted on that line — the text-node call a render child
// becomes. Walks back over the line's balanced parens to each enclosing
// open paren and reads its callee.
// The calls the lowering writes around an author's bytes: the DOM
// constructors, the `String` wrap a text read takes, the runtime's `__`
// helpers, and any method called on a render local (`this._el3.
// setAttribute(`, `_el0.addEventListener(`) — the attribute, event, and
// presence roads. Judged at the INNERMOST call: the call nearest the
// cursor is the one a signature would describe, and a call the author
// wrote inside a handler (`console.log(1)` under the `__batch` wrapper)
// answers as itself.
const LOWERED_CALLEES = /(?:^|[^\w$.])(?:document\.create(?:TextNode|Element|ElementNS|Comment)|String|__[A-Za-z$][\w$]*|\(?(?:this\.)?_(?:el|t|inst|frag|anchor|empty|slot)\d+(?: as [\w$<>]+)?\)?\.[A-Za-z]+)$/;
function insideLoweredCall(code, gen) {
  const call = enclosingCall(code, gen);
  return call !== null && LOWERED_CALLEES.test(call.before);
}

// The innermost CALL whose argument list holds the face position `gen`,
// on gen's own face line: the text before its open paren (the callee
// sits at its end) and the paren's offset. A paren that opens no call —
// a grouping `(`, an arrow's parameter list, a keyword's `if (` — is
// passed over for the next one out: a cursor inside the ternary the
// loop lowering pushes is inside `push(`, whatever parens the ternary
// wears. Null when no call on the line opens around the position.
const NOT_A_CALLEE = /\b(?:if|while|for|switch|catch|return|typeof|await|yield|else|in|of|void|delete|instanceof)$/;
function enclosingCall(code, gen) {
  const lineStart = code.lastIndexOf('\n', gen - 1) + 1;
  let depth = 0;
  for (let i = gen - 1; i >= lineStart; i--) {
    const c = code[i];
    if (c === ')') depth++;
    else if (c === '(') {
      if (depth > 0) { depth--; continue; }
      const before = code.slice(lineStart, i);
      if (/[\w$)\]]\s*$/.test(before) && !NOT_A_CALLEE.test(before.trimEnd())) return { before, open: i };
    }
  }
  return null;
}



// Whether the innermost call around the face position `gen` has a
// callee the author wrote: its identifier bytes in the face map back
// to source verbatim (the precise map, the same one an edit needs). A
// position inside no call answers true — there is nothing to judge, and
// tsgo decides.
function authoredCallee(ctx, gen) {
  const call = enclosingCall(ctx.good.code, gen);
  if (call === null) return true;
  const callee = /([A-Za-z_$][\w$]*)\s*$/.exec(call.before);
  if (callee === null) return true;
  const end = call.open - (call.before.length - callee.index - callee[0].length) - (callee[0].length - callee[1].length);
  const start = end - callee[1].length;
  return generatedEditSpanToSource(ctx.good.mappings, start, end, ctx.good.source, ctx.good.code) !== null;
}

// Whether a signature row is a component's construction — `Name(props?:
// { … }): Name`, one parameter whose block reads as a props block
// (componentPropsAt, the same reading the component-name hover takes).
function isComponentConstruction(sig) {
  if (typeof sig?.label !== 'string') return false;
  const flat = sig.label.replace(/\s+/g, ' ').trim();
  const head = /^([A-Za-z_$][\w$]*)(<[^(]*>)?\(props(\??): \{/.exec(flat);
  if (!head) return false;
  const presented = componentPropsAt(flat, head[0].length - 1);
  return presented !== null && /^\): [A-Za-z_$][\w$]*(?:<.*>)?$/.test(flat.slice(presented.at));
}

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
    // A selection that maps to NOTHING (an anonymous callback's arrow, a
    // name the face spells where the source spells none) is no entry:
    // an outline row must be its own name. Its children still list.
    if (selection.start.line === selection.end.line && selection.start.character === selection.end.character) {
      if (sym.children?.length) out.push(...ripDocumentSymbols(ctx, sym.children, seen));
      continue;
    }
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
      ...(sym.detail ? { detail: presentType(sym.detail) } : {}),
      ...(sym.tags ? { tags: sym.tags } : {}),
      range,
      selectionRange: selection,
      children: sym.children?.length ? ripDocumentSymbols(ctx, sym.children, seen) : [],
    });
  }
  return out;
}

connection.onDocumentSymbol(presented('textDocument/documentSymbol', async (params) => {
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
}));

// Workspace symbols search the ACTIVE PROGRAM (the open
// buffers' closure; out-of-program files are honestly out of scope).
// Locations map exactly like every other result: open buffers through
// their live mappings, unopened closure members through
// recompile-for-mappings, real
// TypeScript files pass through; synthetic landings drop. The same
// one-symbol-per-declaration dedup as the outline.
connection.onWorkspaceSymbol(presented('workspace/symbol', async (params) => {
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
}));

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
function mapWorkspaceEditToRip(edit, { atomic = true, derived = false } = {}) {
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
        const at = positionToOffset(face.genLineStarts, face.code.length, e.range.start);
        const end = positionToOffset(face.genLineStarts, face.code.length, e.range.end);
        // A RENAME edit that replaces a proper part of a longer identifier
        // (`Cart` inside `__Cart__behavior` or `CartData`) names a word the
        // lowering DERIVED from the author's; the compiler re-derives it
        // from the renamed source, so the edit is dropped, never refused.
        if (derived && (/[\w$]/.test(face.code[at - 1] ?? '') || /[\w$]/.test(face.code[end] ?? ''))) continue;
        // An edit inside a face ECHO — the TS-only restatement of a body
        // the real lowering already emitted (a component's behavior
        // object restates its computed members) — names bytes the REAL
        // copy also spells, and that copy's own edit carries the source.
        // Dropping the echo's edit keeps a rename that is well-formed in
        // the source; refusing it would lose the whole rename over a
        // duplicate. The diagnostic mapper declines echo positions on the
        // same ground.
        // An edit inside a face ECHO — the TS-only restatement of a body
        // the real lowering already emitted (a component's behavior
        // object restates its computed members) — names bytes the REAL
        // copy also spells, and that copy's own edit carries the source.
        // Dropping the echo's edit keeps a rename that is well-formed in
        // the source; refusing it would lose the whole rename over a
        // duplicate. The diagnostic mapper declines echo positions on the
        // same ground.
        if (face.echoSpans?.some(([a, b]) => at >= a && at < b)) continue;
        // The refusal names the generated bytes it could not place, and
        // where, so the reader sees WHICH copy of the name the lowering
        // spelled on its own.
        const lineStart = face.code.lastIndexOf('\n', at - 1) + 1;
        const around = face.code.slice(Math.max(lineStart, at - 40), Math.min(face.code.length, at + 50)).replace(/\s+/g, ' ').trim().slice(0, 90);
        return { failure: `an edit in ${ripUri.split('/').pop()} lands on generated-only bytes with no Rip source (face ${e.range.start.line + 1}:${e.range.start.character + 1}: ${JSON.stringify(around)})` };
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
  const { changes, failure } = mapWorkspaceEditToRip(result, { derived: true });
  if (failure) refuse(failure);
  return { changes };
});

// ---- code actions: the import quick fixes and organize imports. The
// organize rewrite lands through the whole-import-line mapping and the
// quick fixes' auto-imports through the standing insertion rules. Those
// are the whole offer: a quick fix outside the import family
// (isImportFixTitle), the sort and remove-unused subsets of organize,
// and the fix-all batch are not served — whatever tsgo would rewrite. The request range and
// its diagnostics map Rip → TS; returned edits map back through the
// same all-or-nothing WorkspaceEdit path as rename — an action whose
// edit cannot land on Rip source is dropped, never shown broken.
connection.onCodeAction(presented('textDocument/codeAction', async (params) => {
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
  // A pure source.* ask (VS Code's organize-imports command, on save
  // or from the palette) is document-scoped by nature: the face's whole range
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
    if (action.kind && !action.kind.startsWith('quickfix') && !CODE_ACTION_KINDS.includes(action.kind)) continue;
    if (action.kind?.startsWith('quickfix') && !isImportFixTitle(action.title)) continue;
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
}));

documents.listen(connection);
connection.listen();
