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
  DidChangeWatchedFilesNotification, FileChangeType,
  ResponseError, ErrorCodes, SemanticTokensBuilder,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTsgo } from './tsgo.js';
import { buildProbe, parseProbeHover } from './pins.js';
import { hashText, hashTree } from './hash.js';
import {
  lineStartsOf, offsetToPosition, positionToOffset,
  sourceOffsetToGenerated, sourceOffsetToGeneratedExact, sourceCursorToGenerated, generatedSpanToSource,
  generatedEditSpanToSource, generatedInsertionToSource, insertionAboveAttachedDirectives,
  isNocheckDirectiveRow, wholeImportLinesEdit, exactSpanMapper,
  staleOffsetMap, isScaffoldingLabel, scrubFaceArtifacts, ripImportText,
  SUPPRESSED_TS_CODES,
} from './translate.js';
import { mapTsDiagnostic, applyRipDirectives, isNoCheckPath, compileErrorInfo } from './diagnostics.js';
import { writeProjectTsconfigs, mirrorRelForFsPath, ripImportsOf } from './mirror.js';

// The compiler: in-repo development resolves the repository's src/;
// the staged .vsix carries a copy at compiler/src/ (scripts/package.js).
// hashTree over the compiler tree (recursive — nested runtime/ fragments
// included) is the cache key's compiler identity.
async function loadCompiler() {
  const candidates = [
    new URL('../../../src/compile.js', import.meta.url),   // in-repo
    new URL('../compiler/src/compile.js', import.meta.url), // staged vsix
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(fileURLToPath(candidate))) {
      compilerHash = hashTree(path.dirname(fileURLToPath(candidate)));
      return (await import(candidate.href)).compile;
    }
  }
  throw new Error('rip compiler not found (looked for ../../../src/compile.js and ../compiler/src/compile.js)');
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
let mirrorRootIsFallback = false; // temp-dir mirror root (workspace unwritable/absent)
let mirrorRootReady = false;     // lazily created on first materialization
let clientSupportsWatchers = false;
let clientSupportsConfiguration = false;
let compilerHash = null;         // the compiler build's identity (cache keying)

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
// manifest's recorded compilerHash — a compiler upgrade purges the tree.
let cacheManifest = { compilerHash: null, entries: {} };
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

function ensureMirrorRoot() {
  if (mirrorRootReady) return;
  if (workspaceRoot && !mirrorRootIsFallback) {
    try {
      fs.mkdirSync(mirrorRoot, { recursive: true });
      ensureOwnedFile(path.join(mirrorRoot, '.gitignore'), '*\n');
      writeGeneratedTsconfig();
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
// compiler build invalidates the whole tree (every cached face was
// produced by a compiler that no longer exists here). Read-only unless
// a purge is due — a fresh session creates nothing.
function loadCache() {
  if (!mirrorRoot) {
    cacheManifest = { compilerHash, entries: {} };
    return;
  }
  try {
    const loaded = JSON.parse(fs.readFileSync(manifestPath(), 'utf8'));
    if (loaded?.compilerHash === compilerHash && loaded.entries) {
      cacheManifest = loaded;
      return;
    }
    // A manifest from another compiler build: purge the tree it keyed.
    for (const mirror of walkFiles(mirrorRoot, '.rip.ts')) {
      try { fs.rmSync(mirror); } catch { /* best effort */ }
    }
    cacheManifest = { compilerHash, entries: {} };
    scheduleManifestSave();
    return;
  } catch { /* absent or unreadable: start fresh, create nothing */ }
  cacheManifest = { compilerHash, entries: {} };
}

// Every source tsconfig (and its extends chain) that a wrapper currently
// extends — the watcher re-governs when any member changes.
const userConfigChain = new Set();

// Source .rip paths whose faces are in the program (open buffers +
// materialized closure). Each owning project dir gets a wrapper tsconfig.
function activeSourceFiles() {
  const files = new Set();
  for (const [uri] of states) {
    if (!uri.startsWith('file://')) continue;
    try { files.add(fileURLToPath(uri)); } catch { /* */ }
  }
  for (const file of materializedMirrors.keys()) files.add(file);
  for (const file of Object.keys(cacheManifest?.entries ?? {})) files.add(file);
  return [...files];
}

// Per-project wrappers — pure planner in mirror.js (shared with
// `rip check`). Idempotent per file via ensureOwnedFile (no spurious
// mtime for tsgo). Returns the written wrapper paths.
function writeGeneratedTsconfig() {
  userConfigChain.clear();
  const written = writeProjectTsconfigs(
    activeSourceFiles(),
    { workspaceRoot, mirrorRoot, mirrorRootIsFallback },
    (configPath, content) => {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      ensureOwnedFile(configPath, content);
    },
  );
  for (const w of written) {
    for (const c of w.chain) userConfigChain.add(c);
  }
  return written;
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
  workspace: { configuration: true, didChangeWatchedFiles: {}, symbol: {} },
};

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
    serverRequests: { 'workspace/configuration': tsgoConfigurationRequest },
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
    result = compile(source, { path: fsPath, runtimeDelivery: 'inline', face: 'ts' });
  } catch {
    return null; // the mirror serves a LAST-GOOD face this source no longer produces
  }
  if (mirrorBytesOf(fsPath) !== result.code) {
    connection.console.log(`[rip] cross-file mapping refused for ${fsPath}: mirror bytes drifted from the source's face`);
    return null;
  }
  const face = {
    sourceHash,
    source,
    code: result.code,
    mappings: result.mappings,
    stores: result.stores,
    srcLineStarts: lineStartsOf(source),
    genLineStarts: lineStartsOf(result.code),
  };
  faceCache.set(fsPath, face);
  return face;
}

// The inverse of mirrorPathOf for workspace files. __external__ mirrors
// have no faithful inverse (sanitized names) — their results drop.
function sourcePathOfMirror(mirrorFsPath) {
  if (!workspaceRoot || mirrorRootIsFallback) return null;
  if (!mirrorFsPath.startsWith(mirrorRoot + path.sep)) return null;
  if (!mirrorFsPath.endsWith('.rip.ts')) return null;
  const rel = path.relative(mirrorRoot, mirrorFsPath).slice(0, -'.ts'.length);
  if (rel.split(path.sep)[0] === '__external__') return null;
  return path.join(workspaceRoot, rel);
}

// Compile one on-disk .rip into its mirror and record its cache entry
// (source hash for change detection, code hash so a crash-partial
// mirror can never pass revalidation). A compile failure leaves the
// previous mirror in place (the last-compiled face serves — the
// the staleness posture at project scale).
function mirrorFromDisk(fsPath, source) {
  faceCache.delete(fsPath);
  const result = compile(source, { path: fsPath, runtimeDelivery: 'inline', face: 'ts' });
  const mirrorPath = mirrorPathOf('file://' + fsPath);
  warnOnMirrorCollision(mirrorPath, fsPath);
  writeMirror(mirrorPath, result.code);
  const imports = ripImportsOf(result.stores, source, path.dirname(fsPath));
  cacheManifest.entries[fsPath] = { sourceHash: hashText(source), codeHash: hashText(result.code), imports };
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
// disk into __external__). Returns the counters (the scaling gate pins
// them) and the created/changed mirror paths for tsgo notification.
function materializeClosure(seeds) {
  ensureMirrorRoot();
  const queue = [...seeds];
  let compiled = 0, cached = 0, failed = 0;
  const touched = [];
  while (queue.length) {
    const file = queue.pop();
    if (materializedMirrors.has(file)) continue;
    if (documents.get('file://' + file)) continue; // open buffers own their mirrors and closures
    if (!workspaceRoot || !file.startsWith(workspaceRoot + path.sep)) {
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
    if (entry && entry.sourceHash === sourceHash && mirrorIntact(file, entry)) {
      cached++;
      queue.push(...entry.imports);
      continue;
    }
    try {
      const { mirrorPath, imports } = mirrorFromDisk(file, source);
      compiled++;
      touched.push(mirrorPath);
      queue.push(...imports);
    } catch {
      failed++; // CompileError: the last-compiled mirror (if any) keeps serving
    }
  }
  // New project dirs may have entered the closure — emit their wrappers.
  writeGeneratedTsconfig();
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
  const drop = (file) => {
    materializedMirrors.delete(file);
    faceCache.delete(file);
    delete cacheManifest.entries[file];
    const mirrorPath = mirrorPathOf('file://' + file);
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
  if (!removed.length) return;
  scheduleManifestSave();
  connection.console.log(`[rip] closure pruned: ${removed.length} mirror(s) left the program`);
  await tsgoReady;
  if (tsgo) {
    tsgo.client.notify('workspace/didChangeWatchedFiles', {
      changes: removed.map((p) => ({ uri: 'file://' + p, type: FileChangeType.Deleted })),
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
    materializedMirrors.set(file, { sourceHash });
    // Keep the message loop responsive over large closures.
    if (++processed % 50 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  const ms = Math.round(performance.now() - t0);
  connection.console.log(
    `[rip] project cache: ${fresh} face(s) fresh, ${recompiled} recompiled, ${removed} removed in ${ms} ms`,
  );
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

connection.onInitialize(async (params) => {
  compile = await loadCompiler();
  readProjectConfig = await loadProjectConfigReader();
  workspaceRoot = detectWorkspaceRoot(params);
  planMirrorRoot();
  loadCache();
  clientSupportsWatchers = !!params.capabilities?.workspace?.didChangeWatchedFiles?.dynamicRegistration;
  clientSupportsConfiguration = !!params.capabilities?.workspace?.configuration;
  // Awaited: the advertised trigger characters and semantic-tokens
  // legend are tsgo's own — a made-up legend would mislabel every token.
  const session = await launchTsgo();
  const tsCaps = session?.capabilities ?? {};
  semanticTokensLegend = tsCaps.semanticTokensProvider?.legend ?? FALLBACK_LEGEND;
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
        triggerCharacters: tsCaps.completionProvider?.triggerCharacters ?? ['.', '"', "'", '`', '/', '@', '<', '#', ' '],
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
  if (clientSupportsWatchers) {
    connection.client.register(DidChangeWatchedFilesNotification.type, {
      watchers: [{ globPattern: '**/*.rip' }, { globPattern: '**/tsconfig.json' }, { globPattern: '**/package.json' }],
    });
  }
  connection.console.log(
    `[rip] ready (workspace: ${workspaceRoot ?? 'none'}, mirror root: ${mirrorRoot}${mirrorRootIsFallback ? ' [fallback]' : ''})`,
  );
  await revalidateCache();
  repullOpenDocuments();
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
    pulled = await tsgo.client.request('textDocument/diagnostic', { textDocument: { uri: state.tsUri } });
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
  connection.sendDiagnostics({ uri, diagnostics: applyRipDirectives(good, mapped) });
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
    result = compile(text, { path: document.uri, runtimeDelivery: 'inline', face: 'ts', pins, strict: state.strict });
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
    // Generated spans of `:=` state names — writable in rip though the face
    // binds their cell `const`. Semantic tokens clear TypeScript's `readonly`
    // on exactly these.
    mutables: result.mutables,
    srcLineStarts,
    genLineStarts: lineStartsOf(result.code),
    strict: state.strict === true, // rides the compile it governed
  };

  // The last-compiled face to disk: program membership for the mirror
  // tree (unopened importers resolve against it) and what this file
  // serves from after its buffer closes. The open buffer's overlay
  // below takes precedence over these bytes while the doc is open.
  try {
    warnOnMirrorCollision(state.mirrorPath, document.uri);
    writeMirror(state.mirrorPath, result.code);
  } catch (err) {
    connection.console.error(`[rip] mirror write failed: ${err.message}`);
  }

  // The demand-driven closure: this buffer's .rip imports (from the
  // compiler's stores) pull their transitive subtrees into the program —
  // a NEW import appearing in an edit materializes on this refresh, and
  // a REMOVED one prunes whatever only it was keeping in.
  if (document.uri.startsWith('file://')) {
    let fsPath = null;
    try { fsPath = fileURLToPath(document.uri); } catch { /* non-path uri */ }
    if (fsPath) {
      const imports = ripImportsOf(result.stores, text, path.dirname(fsPath));
      const previous = state.imports ?? [];
      state.imports = imports;
      cacheManifest.entries[fsPath] = { sourceHash: hashText(text), codeHash: hashText(result.code), imports };
      scheduleManifestSave();
      const { compiled, cached, failed } = materializeClosure(imports);
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
    // No TS server: Rip parse diagnostics alone (none — the buffer compiled).
    state.lastGood = good;
    connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
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
    pulled = await tsgo.client.request('textDocument/diagnostic', { textDocument: { uri: state.tsUri } });
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
  connection.sendDiagnostics({ uri: document.uri, diagnostics: applyRipDirectives(state.lastGood, mapped) });

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
  state.refreshTimer = setTimeout(() => {
    refresh(document).catch((err) => connection.console.error(`[rip] refresh failed: ${err.stack ?? err}`));
  }, 100);
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
// closure is ignored (demand-driven — the program never grows from
// unrelated workspace churn). A workspace tsconfig.json change
// regenerates the mirror config. Everything forwards to tsgo as
// mirror-file events (tsgo invalidates on didChangeWatchedFiles), then every open document's
// diagnostics re-pull.
connection.onDidChangeWatchedFiles(async ({ changes }) => {
  if (!compile || !mirrorRoot) return;
  const forward = [];
  let configChanged = false;
  let refreshAllForConfig = false;
  for (const change of changes) {
    if (!change.uri.startsWith('file://')) continue;
    let fsPath;
    try { fsPath = fileURLToPath(change.uri); } catch { continue; }
    if (fsPath.startsWith(mirrorRoot + path.sep)) continue; // our own writes
    if (path.basename(fsPath) === 'tsconfig.json') {
      // Any workspace tsconfig (nested packages included), or a member of
      // a wrapper's resolved extends chain, re-governs. (Chain members
      // not named tsconfig.json are outside the watch glob — recorded
      // limitation.)
      const underWorkspace = workspaceRoot
        && (fsPath === workspaceRoot || fsPath.startsWith(workspaceRoot + path.sep))
        && !fsPath.includes(`${path.sep}node_modules${path.sep}`);
      if (underWorkspace || userConfigChain.has(fsPath)) {
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
      // its own answer). Skip dependency churn: an install rewrites
      // node_modules/**/package.json and must not recompile the world.
      if (!fsPath.includes(`${path.sep}node_modules${path.sep}`)) refreshAllForConfig = true;
      continue;
    }
    if (!fsPath.endsWith('.rip')) continue;
    if (documents.get(change.uri)) continue; // open buffers own their mirrors
    const mirrorPath = mirrorPathOf(change.uri);
    if (change.type === FileChangeType.Deleted) {
      materializedMirrors.delete(fsPath);
      faceCache.delete(fsPath);
      delete cacheManifest.entries[fsPath];
      scheduleManifestSave();
      // Importers that still name it get their TS2307 back; if the file
      // returns, the Created event pulls it back into the program.
      pendingImports.add(fsPath);
      try {
        fs.rmSync(mirrorPath);
        forward.push({ uri: 'file://' + mirrorPath, type: FileChangeType.Deleted });
      } catch { /* no mirror to remove */ }
    } else {
      const inClosure = materializedMirrors.has(fsPath) || pendingImports.has(fsPath) || fs.existsSync(mirrorPath);
      if (!inClosure) continue;
      const existed = fs.existsSync(mirrorPath);
      materializedMirrors.delete(fsPath); // force the re-read/recompile
      const { touched } = materializeClosure([fsPath]);
      for (const p of touched) {
        forward.push({
          uri: 'file://' + p,
          type: p === mirrorPath && existed ? FileChangeType.Changed : FileChangeType.Created,
        });
      }
    }
  }
  if (configChanged && mirrorRootReady) {
    // A pre-materialization config change has nothing to re-govern; the
    // first materialization generates from the current user config.
    const written = writeGeneratedTsconfig();
    for (const w of written) {
      forward.push({ uri: 'file://' + w.configPath, type: FileChangeType.Changed });
    }
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
  repullOpenDocuments();
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
//     (recorded policy — never pinned to unrelated source).

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
    if (ctx.genOffset === null && ctx.genCursor === null) return null;
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

// One result location {uri, range} in tsgo coordinates → a Rip
// location, or null (dropped: synthetic target, unmappable file, or a
// stale open buffer whose changed region swallowed the range).
// `strict` propagates to the range mapping (symbol-identifying
// results refuse cover landings).
function ripLocation(uri, range, { strict = false } = {}) {
  const open = stateByTsUri(uri);
  if (open) {
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
  if (!uri.startsWith('file://')) return null;
  let fsPath;
  try { fsPath = fileURLToPath(uri); } catch { return null; }
  const sourcePath = sourcePathOfMirror(fsPath);
  if (sourcePath === null) {
    // Inside the mirror tree but not invertible → drop; anywhere else
    // is a REAL TypeScript file (node_modules, .d.ts, workspace .ts
    // siblings) and passes through untouched.
    if (mirrorRoot && fsPath.startsWith(mirrorRoot + path.sep)) return null;
    return { uri, range };
  }
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
  const list = result === null ? [] : Array.isArray(result) ? result : [result];
  const mapped = [];
  for (const item of list) {
    if (item.targetUri) {
      const loc = ripLocation(item.targetUri, item.targetSelectionRange ?? item.targetRange);
      if (loc) mapped.push(loc);
    } else {
      const loc = ripLocation(item.uri, item.range);
      if (loc) mapped.push(loc);
    }
  }
  return mapped;
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
function presentReactiveCellHover(contents) {
  const value = contents?.value;
  if (typeof value !== 'string') return null;
  const fence = /(```(?:typescript|ts)\n)([^]*?)(\n?```)/.exec(value);
  if (!fence) return null;
  // tsgo renders object types with internal line breaks / run-on
  // spaces and a trailing `;` — normalize before matching.
  const flat = fence[2].replace(/\s+/g, ' ').trim();
  const m = /^(const|let) ([A-Za-z_$][\w$]*): \{ (readonly )?value: (.+); read\(\): (.+?);? \}$/.exec(flat);
  if (!m) return null;
  const [, , name, ro, t, readT] = m;
  // depth guard: the `;` split above is greedy on `t` — verify T and
  // read()'s return agree after the same normalization (the brand
  // shape), else pass through.
  if (t.trim() !== readT.trim()) return null;
  const reworded = value.replace(fence[0], `${fence[1]}${ro ? 'const' : 'let'} ${name}: ${t.trim()}${fence[3]}`);
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
  const ctx = requestContext(params);
  if (!ctx || ctx.genPosition === null) return null;

  const hover = await tsgoRequest('textDocument/hover', {
    textDocument: { uri: ctx.state.tsUri },
    position: ctx.genPosition,
  }, 'hover');
  if (!hover) return null;

  let contents = (await enrichEvolvingAnyHover(ctx, hover)) ?? hover.contents;
  contents = reorderUnionHover(ctx, contents) ?? contents;
  contents = presentReactiveCellHover(contents) ?? contents;

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

connection.onDefinition(async (params) => {
  await tsgoReady;
  const ctx = requestContext(params);
  if (!ctx || ctx.genExactPosition === null) return null;
  const result = await tsgoRequest('textDocument/definition', {
    textDocument: { uri: ctx.state.tsUri },
    position: ctx.genExactPosition,
  }, 'definition');
  return ripLocations(result);
});

// Type definition: served exactly like definition (EXACT flavor,
// synthetic drops, recompile-for-mappings for unopened members,
// real-.ts pass-through). A null answer is honest for primitive-typed
// symbols — a number has no type-declaration site.
connection.onTypeDefinition(async (params) => {
  await tsgoReady;
  const ctx = requestContext(params);
  if (!ctx || ctx.genExactPosition === null) return null;
  const result = await tsgoRequest('textDocument/typeDefinition', {
    textDocument: { uri: ctx.state.tsUri },
    position: ctx.genExactPosition,
  }, 'type definition');
  return ripLocations(result);
});

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

// ── Incomplete-expression recovery (bare-dot / open-call) ──
// The broker only advances lastGood on a successful compile. Member
// completion at `items.` and signature help inside `add(1, ` fire on
// text that throws CompileError, so requestContext has no member/call
// face. Recovery compiles a REQUEST-LOCAL patched buffer, swaps it
// into the tsgo virtual doc for one query, then restores lastGood —
// never mutating lastGood, the mirror, or stripFace. Port of v3's
// `word.` → `word.__rip__` rewrite (rip-lang lsp.js onCompletion).
const RECOVERY_PROP = '__rip__';
let recoveryChain = Promise.resolve();

function patchTrailingDot(text, position) {
  const lines = text.split('\n');
  const line = lines[position.line] ?? '';
  const before = line.slice(0, position.character);
  if (!/\w\.\s*$/.test(before)) return null;
  const patchedBefore = before.replace(/(\w)\.\s*$/, `$1.${RECOVERY_PROP}`);
  lines[position.line] = patchedBefore + line.slice(position.character);
  const dotAt = before.lastIndexOf('.');
  return {
    patched: lines.join('\n'),
    position: { line: position.line, character: dotAt + 1 },
  };
}

function patchOpenCall(text, position) {
  const lines = text.split('\n');
  const line = lines[position.line] ?? '';
  const before = line.slice(0, position.character);
  let depth = 0;
  for (let i = 0; i < before.length; i++) {
    const c = before[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
  }
  if (depth <= 0) return null;
  // Close the call with a placeholder arg so the face parses and tsgo
  // still sees the cursor inside the argument list.
  const insert = /[(,]\s*$/.test(before) ? '0)' : ')';
  lines[position.line] = before + insert + line.slice(position.character);
  return {
    patched: lines.join('\n'),
    position: { line: position.line, character: position.character },
  };
}

function compileRecoveryFace(patched, uri, state) {
  if (!compile) return null;
  try {
    let pins = null;
    for (const [key, type] of state.pinCache) {
      if (type !== null) (pins ??= new Map()).set(key, type);
    }
    const result = compile(patched, {
      path: uri, runtimeDelivery: 'inline', face: 'ts', pins, strict: state.strict,
    });
    return {
      source: patched,
      code: result.code,
      mappings: result.mappings,
      stores: result.stores,
      trivia: result.trivia,
      mutables: result.mutables,
      srcLineStarts: lineStartsOf(patched),
      genLineStarts: lineStartsOf(result.code),
      strict: state.strict === true,
    };
  } catch {
    return null;
  }
}

// Serialize ephemeral virtual-doc swaps so concurrent requests cannot
// leave tsgo on a patched face.
async function withEphemeralFace(state, recoveredCode, fn) {
  const prev = recoveryChain;
  let release;
  recoveryChain = new Promise((resolve) => { release = resolve; });
  await prev;
  const savedCode = state.lastGood?.code ?? null;
  const openedEphemeral = !state.tsOpen;
  try {
    if (!tsgo) return null;
    state.tsVersion += 1;
    if (openedEphemeral) {
      state.tsOpen = true;
      tsgo.client.notify('textDocument/didOpen', {
        textDocument: {
          uri: state.tsUri, languageId: 'typescript',
          version: state.tsVersion, text: recoveredCode,
        },
      });
    } else {
      tsgo.client.notify('textDocument/didChange', {
        textDocument: { uri: state.tsUri, version: state.tsVersion },
        contentChanges: [{ text: recoveredCode }],
      });
    }
    return await fn();
  } finally {
    try {
      if (tsgo) {
        if (savedCode != null) {
          state.tsVersion += 1;
          tsgo.client.notify('textDocument/didChange', {
            textDocument: { uri: state.tsUri, version: state.tsVersion },
            contentChanges: [{ text: savedCode }],
          });
        } else if (openedEphemeral && state.tsOpen) {
          tsgo.client.notify('textDocument/didClose', { textDocument: { uri: state.tsUri } });
          state.tsOpen = false;
        }
      }
    } finally {
      release();
    }
  }
}

async function completionFromFace(ctx, genCursor, params) {
  const result = await tsgoRequest('textDocument/completion', {
    textDocument: { uri: ctx.state.tsUri },
    position: offsetToPosition(ctx.good.genLineStarts, genCursor),
    ...(params.context ? { context: params.context } : {}),
  }, 'completion');
  if (!result) return null;
  const rawItems = Array.isArray(result) ? result : result.items ?? [];
  ctx.state.lastCompletion = rawItems;
  const items = [];
  for (let i = 0; i < rawItems.length; i++) {
    const label = rawItems[i].label;
    if (isScaffoldingLabel(label) || label === RECOVERY_PROP) continue;
    const item = ripCompletionItem(ctx, rawItems[i], i);
    if (item) items.push(item);
  }
  return { isIncomplete: Array.isArray(result) ? false : !!result.isIncomplete, items };
}

connection.onCompletion(async (params) => {
  await tsgoReady;
  const document = documents.get(params.textDocument.uri);
  const state = states.get(params.textDocument.uri);
  if (!document || !state || !tsgo) return null;
  const currentText = document.getText();

  // Bare-dot recovery: patch `word.` → `word.__rip__`, compile a
  // throwaway face, ask at the synthetic property, restore.
  const dot = patchTrailingDot(currentText, params.position);
  if (dot) {
    const recovered = compileRecoveryFace(dot.patched, document.uri, state);
    if (recovered) {
      const srcOffset = positionToOffset(recovered.srcLineStarts, recovered.source.length, dot.position);
      const genCursor = sourceCursorToGenerated(recovered.mappings, srcOffset)
        ?? sourceOffsetToGeneratedExact(recovered.mappings, srcOffset, recovered.source, recovered.code);
      if (genCursor != null) {
        const ctx = {
          state, good: recovered, document, currentText,
          curLineStarts: lineStartsOf(currentText),
          align: staleOffsetMap(currentText, recovered.source),
        };
        const out = await withEphemeralFace(state, recovered.code, () => completionFromFace(ctx, genCursor, params));
        if (out?.items?.length) return out;
      }
    }
  }

  const ctx = requestContext(params);
  if (!ctx) return null;
  const genCursor = ctx.genCursor ?? ctx.genExact;
  if (genCursor === null) return null;
  return completionFromFace(ctx, genCursor, params);
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
async function signatureHelpFromFace(ctx, genCursor, params) {
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
}

connection.onSignatureHelp(async (params) => {
  await tsgoReady;
  const document = documents.get(params.textDocument.uri);
  const state = states.get(params.textDocument.uri);
  if (!document || !state || !tsgo) return null;
  const currentText = document.getText();

  // Open-call recovery: close with a placeholder arg so the call parses
  // (`add(1, ` → `add(1, 0)`), ask at the original cursor, restore.
  // Covers fresh open-paren AND mid-edit after a good closed compile —
  // the response carries no positions, so a throwaway face is safe.
  const call = patchOpenCall(currentText, params.position);
  if (call) {
    const recovered = compileRecoveryFace(call.patched, document.uri, state);
    if (recovered) {
      const srcOffset = positionToOffset(recovered.srcLineStarts, recovered.source.length, call.position);
      const genCursor = sourceCursorToGenerated(recovered.mappings, srcOffset)
        ?? sourceOffsetToGeneratedExact(recovered.mappings, srcOffset, recovered.source, recovered.code);
      if (genCursor != null) {
        const ctx = {
          state, good: recovered, document, currentText,
          curLineStarts: lineStartsOf(currentText),
          align: staleOffsetMap(currentText, recovered.source),
        };
        const out = await withEphemeralFace(state, recovered.code, () => signatureHelpFromFace(ctx, genCursor, params));
        if (out) return out;
      }
    }
  }

  const ctx = requestContext(params);
  if (!ctx) return null;
  const genCursor = ctx.genCursor ?? ctx.genExact;
  if (genCursor === null) return null;
  return signatureHelpFromFace(ctx, genCursor, params);
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
function ripSemanticTokens(ctx, data) {
  const mapSpan = exactSpanMapper(ctx.good.mappings);
  const roIndex = semanticTokensLegend?.tokenModifiers?.indexOf('readonly') ?? -1;
  const roBit = roIndex < 0 ? 0 : (1 << roIndex);
  // Keyed by START offset: a state name's span IS the token, so the token's
  // generated start equals the span's exactly. A set lookup per token, rather
  // than a scan of every span for every token on a surface that fires on each
  // edit.
  const mutableStarts = new Set((ctx.good.mutables ?? []).map(([s]) => s));
  const tokens = new Map(); // start → { start, length, type, modifiers }
  let line = 0, char = 0;
  for (let i = 0; i + 4 < data.length; i += 5) {
    line += data[i];
    char = data[i] === 0 ? char + data[i + 1] : data[i + 1];
    const length = data[i + 2];
    const genStart = positionToOffset(ctx.good.genLineStarts, ctx.good.code.length, { line, character: char });
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
    const key = curStart * 0x100000 + length;
    const existing = tokens.get(key);
    if (existing && existing.type === data[i + 3]) {
      existing.modifiers |= modifiers;
    } else if (!existing) {
      tokens.set(key, { start: curStart, length, type: data[i + 3], modifiers });
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

connection.onDocumentLinks((params) => {
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
function mapWorkspaceEditToRip(edit) {
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
    let face, ripUri;
    if (open) {
      const document = documents.get(open.uri);
      if (!document || document.getText() !== open.state.lastGood.source) {
        return { failure: `${open.uri.split('/').pop()} has unapplied changes that do not compile — fix it and retry` };
      }
      face = open.state.lastGood;
      ripUri = open.uri;
    } else {
      let fsPath = null;
      if (uri.startsWith('file://')) {
        try { fsPath = fileURLToPath(uri); } catch { fsPath = null; }
      }
      const sourcePath = fsPath === null ? null : sourcePathOfMirror(fsPath);
      if (sourcePath === null) {
        if (fsPath !== null && (!mirrorRoot || !fsPath.startsWith(mirrorRoot + path.sep))) {
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
  if (ctx.currentText !== ctx.good.source) {
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
  const toGen = (position, exclusiveEnd) => {
    const cur = positionToOffset(ctx.curLineStarts, ctx.currentText.length, position);
    const offset = ctx.align.toGood(cur, { exclusiveEnd });
    if (offset === null) return null;
    return sourceOffsetToGenerated(ctx.good.mappings, offset) ?? sourceCursorToGenerated(ctx.good.mappings, offset);
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
    const { changes, failure } = mapWorkspaceEditToRip(action.edit);
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
