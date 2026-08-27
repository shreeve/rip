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
import { pathToFileURL } from 'node:url';
import { cacheIdentityOf } from '../../packages/vscode/src/hash.js';
import { compile } from '../compile.js';
import { readProjectConfig } from '../config.js';
import { identifierRunAt } from '../ident.js';
import { startTsgo } from '../../packages/vscode/src/tsgo.js';
import { buildProbe, parseProbeHover } from '../../packages/vscode/src/pins.js';
import { mapTsDiagnostic, applyRipDirectives, isNoCheckPath, compileErrorInfo } from '../../packages/vscode/src/diagnostics.js';
import { SUPPRESSED_TS_CODES, IMPLICIT_ANY_CODES, MISSING_TYPES_CODES } from '../../packages/vscode/src/translate.js';
import { scopeGateOf, typedExportsOf, typedImportsOf } from '../../packages/vscode/src/scopes.js';
import { generatedMirror, projectWrapper, nearestTsconfig, HOST_FLOOR_NAME, mirrorRelForFsPath, missingModuleRead, linkNestedNodeModules, declaredButUninstalled, configEarnsBoundary, appStashSpecFor, closureImportsOf } from '../../packages/vscode/src/mirror.js';
import { lineStartsOf, offsetToPosition, positionToOffset, generatedSpanToSource } from '../../packages/vscode/src/translate.js';
import { publicEntriesOf, compileFailureOf } from './public.js';
import { createPublicSession, walkPublicEntry, useSitesOf, exportIdsOf } from '../../packages/vscode/src/publicwalk.js';
import { importBindingsOf, namespaceImportsOf } from '../../packages/vscode/src/scopes.js';
import { ripSpecifierTarget, anchorStdlib } from '../../packages/vscode/src/mirror.js';

// The two trees whose build identity the editor and this CLI must agree
// on. Computed once: they were spelled twice, and a hash that disagrees
// with itself is the exact failure this identity exists to detect.
const compilerDir = path.resolve(import.meta.dir, '..');
const serverDir = path.resolve(compilerDir, '..', 'packages', 'vscode', 'src');

// Fails OPEN, like the editor's: a gate scopes.js cannot build leaves the
// gate undefined and every diagnostic publishes. An empty annotation set
// would silence the whole file, and a silent file reads as a clean one. A
// compiled entry always carries its token tape — a result without one is
// a compiler-contract break, refused loudly rather than gated around.
const scopeGate = (tokens, source, face, typedImports) => {
  if (!tokens) throw new Error('compile result carries no token tape');
  try { return scopeGateOf(tokens, source, face, typedImports); }
  catch { return undefined; }
};

// The ESCAPE HATCHES a gradual target spells — each asks for checking and
// withholds it, or switches it off where it was asked for:
//
//   any      a TYPE token that is exactly `any`. Under gradual an
//            unannotated binding is already `any`, so the annotation opens
//            its scope for checking and gives the checker nothing to check
//            against. Composites (`any[]`, `Record<string, any>`) are shape
//            decisions, not counted.
//   casts    a CAST token that is exactly `any` (`x as any`): inside a
//            scope already being checked, one expression opted out.
//   ignores  a `# @ts-ignore` line: it suppresses the next line with no
//            check that the suppression is still needed — `@ts-expect-error`
//            is the form that says when it is not (TS2578).
//
// A strict project is different: there `any` is a stated decision against
// implicit-any, and nothing here is advice. Lines are 1-based.
const escapeHatchesOf = (tokens, source, srcLineStarts) => {
  const out = { any: [], casts: [], ignores: [] };
  for (const t of tokens ?? []) {
    if (t.value !== 'any' || typeof t.start !== 'number') continue;
    if (t.kind === 'TYPE') out.any.push(offsetToPosition(srcLineStarts, t.start).line + 1);
    else if (t.kind === 'CAST') out.casts.push(offsetToPosition(srcLineStarts, t.start).line + 1);
  }
  // Code only, like the tape: a `__DATA__` payload is not code.
  const ignore = /^[ \t]*#[ \t]*@ts-ignore(\s|$)/;
  for (const [i, line] of source.split('\n').entries()) {
    if (line === '__DATA__') break;
    if (ignore.test(line)) out.ignores.push(i + 1);
  }
  return out;
};

// A module's ANNOTATED exports — file-local, so a failure here costs this
// module's importers their cross-file checking and nothing else.
const moduleTypedExports = (source, face) => {
  try { return typedExportsOf(face.tokens, source, face); }
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
  --strict                 Check the workspace as if every package in it set
                           rip.strict — what strict would report, with no
                           package.json edited: the preview before flipping.
                           Dependencies outside the workspace keep their own
                           posture, as they would after the flip
  --public                 Audit the PUBLIC surface instead of type-checking:
                           for every package the given paths reach, read the
                           manifest — its entries are what gets compiled and
                           audited — and report the type a CONSUMER resolves
                           for each export and the path to the first any
                           inside it — through members, and through the
                           parameters, returns, and instances of the
                           signatures they name. Inference counts,
                           so an unannotated export with a typed origin passes;
                           members a package does not declare are its
                           dependencies' and are left alone. Exits 1 when any
                           export leaks, so it can gate
  --build                  Print the build identity (a content hash over the
                           compiler and editor-server trees) and exit — the
                           editor logs the same hash in its ready line, so a
                           mismatch means the installed extension is stale
  -h, --help               Show this help

Exit status is 0 when no error-severity diagnostic survives, 1 otherwise.
Directories are walked for *.rip (node_modules and dot-directories are
skipped). Config — package.json#rip (strict / noCheck) and the project
tsconfig — governs exactly as it does in the editor (--strict overrides
strict for the workspace's own packages; noCheck still governs). The generated TS
mirror stays at <root>/.rip/check after the run — the exact TypeScript
the LAST run type-checked (only the files that run covered), wiped and
rebuilt at the start of every run; .build inside it names the compiler
build that wrote it.`;

const fail = (message, code = 2) => { console.error(message); process.exit(code); };

// The package a path belongs to: the nearest ancestor holding a package.json.
// Memoized — asked once per checked file and again per declaration the walk
// reaches, and one CLI run sees one consistent disk.
const pkgOfMemo = new Map();
const nearestPackage = (from) => {
  if (pkgOfMemo.has(from)) return pkgOfMemo.get(from);
  let found = null;
  for (let d = from; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'package.json'))) { found = d; break; }
    if (path.dirname(d) === d) break;
  }
  pkgOfMemo.set(from, found);
  return found;
};

// ── report colors ───────────────────────────────────────────────────
// ONE palette for every printer in this file, named by role. Colors chosen
// to byte-match `tsc --pretty`: bright cyan file, bright yellow line/col,
// gray detail, reverse-video gutter; advisories in plain yellow. Two
// printers each declaring their own set is how one name came to mean two
// colors in one binary.
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (c, s) => (useColor ? `\x1b[${c}m${s}\x1b[0m` : s);
const dim = (s) => paint('90', s);      // detail: TS codes, summaries, hidden-family ledger
const bold = (s) => paint('1', s);
const green = (s) => paint('32', s);
const red = (s) => paint('31', s);
const cyan = (s) => paint('96', s);     // file paths
const lineCol = (s) => paint('93', s);  // line / col
const advise = (s) => paint('33', s);   // advisories and floors
const invert = (s) => paint('7', s);    // the gutter "box"
const sevPaint = (sev, s) => paint(sev === 1 ? '91' : '93', s); // error red / warning yellow
const rel = (f) => path.relative(process.cwd(), f) || '.';

// The `--public` report, v3's shape: every export listed with the type a
// consumer resolves, the path to the first `any` on a leaking one, and a
// percentage per package — a failures-only list cannot show a surface
// getting better, which is the number this exists to produce.
function printPublicReport(report, unreadable = []) {
  const byPkg = new Map();
  for (const r of report) {
    if (!byPkg.has(r.dir)) byPkg.set(r.dir, []);
    byPkg.get(r.dir).push(r);
  }
  let anyBad = false, sawEntry = false, anyUnaudited = false;
  for (const [dir, entries] of byPkg) {
    let name = rel(dir);
    try { name = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name ?? name; } catch { /* unnamed */ }
    let total = 0, leaks = 0;
    // Distinct source positions across the whole package: one position
    // reached from two exports is still one edit, and the count that
    // matters to whoever has to make them is how many there are.
    const positions = new Set();
    // The location column is sized ACROSS the package, not per export, so
    // it does not shift between rows: the point of these lines is to be
    // read straight down as a list of places to edit.
    // Spelled the way every other position in this report is spelled:
    // cyan file, yellow line and column, plain colons.
    const locate = (d) => (d.site === undefined ? '' : `${rel(d.site.file)}:${d.site.line + 1}:${d.site.character + 1}`);
    const paintLocation = (d) => (d.site === undefined ? ''
      : `${cyan(rel(d.site.file))}:${lineCol(String(d.site.line + 1))}:${lineCol(String(d.site.character + 1))}`);
    // Both columns are sized ACROSS the package, so neither shifts between
    // rows: the kinds run from `{}` to `Function`, and an unpadded one
    // leaves the paths starting at a different column line to line.
    let locw = 0, kindw = 0;
    for (const { rows } of entries) {
      for (const r of rows) {
        if (r.kind !== 'leak') continue;
        for (const d of r.defects) {
          locw = Math.max(locw, locate(d).length);
          kindw = Math.max(kindw, (d.why ?? 'any').length);
        }
      }
    }
    const lines = [];
    const unaudited = [];
    let unexplored = 0, forwarded = 0;
    for (const { entryFile, rows, unexplored: u, forwarded: f } of entries) {
      unexplored += u ?? 0;
      forwarded += f ?? 0;
      if (rows.length === 0) continue;
      const w = Math.min(28, rows.reduce((m, r) => Math.max(m, r.name.length), 0));
      // The type column takes whatever the terminal has left, and a type
      // too long for it CONTINUES rather than stopping: this column is the
      // evidence the report exists to hand over, and a surface whose
      // published type does not fit on a line is telling the reader
      // something rather than wasting their space. The name column stays
      // aligned so a long row costs nothing to scan past. Piped output has
      // no width to ask for and takes 80, which also keeps it reproducible.
      const room = Math.max(24, (process.stdout.columns || 80) - (w + 9));
      const wrap = (text) => {
        const out = [];
        let rest = text;
        while (rest.length > room) {
          // Break after a space when one is near the edge, so a type breaks
          // between its members rather than mid-name.
          const cut = rest.lastIndexOf(' ', room);
          const at = cut > room / 2 ? cut + 1 : room;
          out.push(rest.slice(0, at).trimEnd());
          rest = rest.slice(at);
        }
        out.push(rest);
        return out;
      };
      lines.push(`  ${bold(rel(entryFile))}`);
      for (const r of rows) {
        if (r.kind === 'unaudited') { unaudited.push({ entryFile, name: r.name, type: r.type, why: r.why }); continue; }
        total++;
        const [head, ...cont] = wrap(r.type ?? '?');
        const mark = r.kind === 'leak' ? red('\u2717') : green('\u2713');
        lines.push(`    ${mark} ${r.name.padEnd(w)}  ${dim(head)}`);
        for (const line of cont) lines.push(`      ${' '.repeat(w)}  ${dim(line)}`);
        if (r.kind === 'leak') {
          leaks++;
          // EVERY position this export leaves untyped, deduplicated by the
          // declaration that has to change — one lambda reached through six
          // verbs is one edit, not six defects.
          for (const d of r.defects) {
            // Counted per DECLARATION, the same identity the walk used —
            // several declarations can map back to one source line.
            positions.add(d.origin ? `${d.origin.path}|${d.origin.start}` : `at:${d.at}`);
            const where = locate(d);
            const pad = ' '.repeat(Math.max(0, locw - where.length));
            // Spelled like a diagnostic: the location carries the color and
            // what follows is the message, plain. Every line here is a
            // finding, so the kind distinguishes nothing a color would help
            // with — only `at:` is dimmed, as a separator.
            const why = (d.why ?? 'any').padEnd(kindw);
            lines.push(`      ${dim('\u2514\u2500')} ${paintLocation(d)}${pad}  ${why}${dim(' at:')} ${d.at}`);
          }
        }
      }
    }
    if (total === 0 && unaudited.length === 0 && forwarded === 0 && unexplored === 0) continue;
    sawEntry = true;                       // a package spoke, whatever it said
    console.log('');
    if (lines.length) { console.log(lines.join('\n')); console.log(''); }
    // Listed BY NAME, never merely counted: a reader has to know which of
    // their published names went unexamined, and a name that disappears
    // takes the denominator with it.
    for (const u of unaudited) {
      console.log(`  ${advise('?')} ${u.name}${dim(` — not audited: ${u.why ?? 'declared in another package'}`)}`);
    }
    if (unaudited.length) { anyUnaudited = true; console.log(''); }
    const typed = total - leaks;
    const pct = total === 0 ? '0.0' : (100 * typed / total).toFixed(1);
    // Two gaps with two remedies: a limit the walk hit, and names an
    // `export *` forwards without naming. Either makes the count a floor,
    // and each is reported as itself so the line says what to do about it.
    if (forwarded > 0) {
      anyUnaudited = true;
      console.log(`${advise('!')} ${forwarded} \`export *\` re-export${forwarded === 1 ? '' : 's'} not enumerated — every count below is a floor`);
    }
    if (unexplored > 0) {
      console.log(`${advise('!')} ${unexplored} branch${unexplored === 1 ? '' : 'es'} not explored (walk limit) — every count below is a floor`);
    }
    if (total === 0) console.log(`${advise('!')} ${bold(name)}: nothing here could be audited`);
    else if (leaks === 0) console.log(`${green('\u2713')} ${bold(name)}: ${typed}/${total} exports fully typed (${pct}%).`);
    else {
      anyBad = true;
      const n = positions.size;
      console.log(`${red('\u2717')} ${bold(name)}: ${typed}/${total} exports fully typed (${pct}%). `
        + `${red(`${n} position${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} a type`)}.`);
    }
  }
  if (unreadable.length > 0) {
    console.log('');
    for (const u of unreadable) {
      console.log(u.outside !== undefined
        ? `${red('\u2717')} ${bold(rel(path.dirname(u.entryFile)))}: publishes from outside the package — \`${u.outside}\` is not in what this package ships`
        : `${red('\u2717')} ${bold(rel(u.entryFile))}: publishes nothing a consumer can resolve — ${u.reason}`);
    }
    anyBad = true;
  } else if (!sawEntry) {
    // Told apart, because the remedies are not the same one: a package
    // that declares no entry is out of scope, and an entry that exports
    // nothing is in scope and empty.
    const entries = report.length + unreadable.length;
    console.log(entries === 0
      ? 'rip check --public: no package publishes a .rip entry here'
      : 'rip check --public: the published entry exports nothing');
  }
  // 1 for defects found, 2 for surface this audit never saw, 0 only for
  // checked-and-clean. The walk's own depth budget is this tool's cost
  // ceiling and no edit to the package clears it, so it annotates without
  // deciding.
  //
  // RETURNED, not exited: this verdict speaks for the report alone. The
  // run-completeness flags (incompleteCheck, tsgoUnavailable) are the
  // mainline's, and the caller folds them in where the other exit paths
  // already live — a printer that reads them here is fused to state
  // declared hundreds of lines below it.
  return anyBad ? 1 : (anyUnaudited ? 2 : 0);
}

// ── argument parsing ────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) { console.log(HELP); process.exit(0); }
// The build identity, printed and exited on before anything else: the same
// content hash over the same two trees (compiler + editor server) the
// editor computes for its cache key and logs in its ready line. When the
// two hashes differ, the installed extension is running different code
// than this CLI — the skew behind "the editor and rip check disagree".
if (argv.includes('--build')) {
  const tilde = (p) => (p.startsWith(os.homedir() + path.sep) ? '~' + p.slice(os.homedir().length) : p);
  console.log(`rip check build ${cacheIdentityOf(compilerDir, serverDir)}`);
  console.log(`  compiler  ${tilde(compilerDir)}`);
  console.log(`  server    ${tilde(serverDir)}`);
  process.exit(0);
}
const asJson = argv.includes('--json');
const showFrames = !argv.includes('--no-frame') && !asJson;
// `--strict`: every package under the workspace root reads as if it set
// `rip.strict` — the posture is overridden, the config on disk is read as
// written, and what strict means stays where it is defined (diagnostics.js
// per file, mirror.js per program). A dependency outside the workspace
// keeps its own posture: flipping the workspace would not change it
// either, and the preview reports what the flip would. The escape-hatch
// advisories read the posture ON DISK — they are the pre-flip cleanup
// list, and the run that previews the flip is where it is wanted.
const forceStrict = argv.includes('--strict');
// The public-surface audit: a mode, not a modifier — it answers its own
// question and prints its own report, in place of type-checking rather
// than alongside it.
const publicAudit = argv.includes('--public');
// `--public` prints a report, not a diagnostic list. Accepting the pair and
// emitting human text answers a machine in a language it did not ask for.
if (publicAudit && argv.includes('--json')) fail('rip check: --public has no --json form — it prints a report, not a diagnostic list.');
const KNOWN = new Set(['--json', '--no-frame', '--build', '--strict', '--public']);
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

// At most `width` tasks started at once, in call order; the next starts
// as one settles. The FIRST task runs alone: until it settles the width
// is one, so whatever the first request pays for (the cold program build
// behind the first tsgo request) is paid by exactly one request's budget.
// Each call returns the task's own promise.
function pacer(width) {
  let running = 0, settled = 0;
  const queue = [];
  const next = () => {
    while (running < (settled === 0 ? 1 : width) && queue.length) {
      const { task, resolve, reject } = queue.shift();
      running++;
      Promise.resolve().then(task).then(resolve, reject).finally(() => { running--; settled++; next(); });
    }
  };
  return (task) => new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); next(); });
}

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

// ── `--public` seeds from the MANIFESTS ─────────────────────────────
// The audit's question is about published entries, so the manifests are
// read FIRST and their entries become the compile targets. Deriving the
// entries from whatever a file walk happened to cover answers a different
// question three wrong ways at once: a package whose only published entry
// is missing has no files to find and reads as clean; an entry outside
// some other target set reads as unresolvable when it is merely
// unvisited; and a run where nothing compiles skips the report entirely.
function* walkManifests(dir) {
  if (fs.existsSync(path.join(dir, 'package.json'))) yield dir;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    yield* walkManifests(path.join(dir, entry.name));
  }
}
// The packages the given paths reach: every manifest at or under a
// directory, and the nearest one enclosing a file — or enclosing a
// directory that holds none, so pointing at a package's src/ audits the
// package.
function collectPublicPackages(paths) {
  const dirs = new Set();
  for (const p of paths) {
    const abs = path.resolve(p);
    let st;
    try { st = fs.statSync(abs); } catch { fail(`rip check: path not found: ${p}`); }
    if (st.isFile()) {
      if (!abs.endsWith('.rip')) fail(`rip check: not a .rip file: ${p}`);
      const dir = nearestPackage(path.dirname(abs));
      if (dir !== null) dirs.add(dir);
    } else {
      let found = false;
      for (const dir of walkManifests(abs)) { dirs.add(dir); found = true; }
      if (!found) {
        const dir = nearestPackage(abs);
        if (dir !== null) dirs.add(dir);
      }
    }
  }
  return [...dirs].sort();
}

const publicPkgs = publicAudit
  ? collectPublicPackages(positionals.length ? positionals : ['.']).map((dir) => ({ dir, ...publicEntriesOf(dir) }))
  : null;
const targets = publicAudit
  ? [...new Set(publicPkgs.flatMap((p) => p.entries))].filter((f) => fs.existsSync(f)).sort()
  : collectTargets(positionals.length ? positionals : ['.']);
// Under `--public` an empty target set is not an empty RUN: the manifests
// may still name entries that are missing, publish from outside, or only
// pattern — each of which the audit reports below, never as a clean 0.
if (targets.length === 0 && !publicAudit) {
  if (asJson) console.log('[]');
  else console.log('rip check: no .rip files found');
  process.exit(0);
}
const workspaceRoot = findWorkspaceRoot(targets);
// The workspace decides which checkout's stdlib `rip/*` names resolve
// to, for resolution and the generated `paths` map alike.
anchorStdlib(workspaceRoot);
// One run = one consistent view of the disk, so stash discovery
// memoizes per directory — files sharing a dirname share one walk.
const stashMemo = new Map();


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
// With no targets at all (`--public` over manifests that name no file on
// disk) there is nothing to mirror, and a run that compiles nothing must
// not go writing trees into whatever directory it ran from.
if (targets.length > 0) {
  try {
    fs.rmSync(mirrorRoot, { recursive: true, force: true });
    fs.mkdirSync(mirrorRoot, { recursive: true });
    fs.writeFileSync(path.join(mirrorRoot, '.gitignore'), '*\n');
    fs.writeFileSync(path.join(mirrorRoot, '.build'),
      cacheIdentityOf(compilerDir, serverDir) + '\n');
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
}

// ── closure compile (pins-less) ─────────────────────────────────────
// BFS the target set + its transitive .rip imports. Each source is
// compiled to its TS face once (with its own rip.strict); a parse
// failure is reported directly (no face) — its importers then see a
// cannot-find-module, exactly as a broken file behaves in the editor.
const configCache = new Map();
// The config as WRITTEN, by directory. readProjectConfig never throws — it
// returns its own defaults on any unreadable/malformed package.json — so
// no fallback wrapper is needed.
const diskConfig = (dir) => {
  if (!configCache.has(dir)) configCache.set(dir, readProjectConfig(dir));
  return configCache.get(dir);
};
// The config as CHECKED: the disk config, with `--strict` forcing the
// strict posture on every package under the workspace root.
const postureCache = new Map();
const projectConfig = (dir) => {
  if (!postureCache.has(dir)) {
    const cfg = diskConfig(dir);
    const inWorkspace = dir === workspaceRoot || dir.startsWith(workspaceRoot + path.sep);
    postureCache.set(dir, forceStrict && inWorkspace && cfg.strict !== true ? { ...cfg, strict: true } : cfg);
  }
  return postureCache.get(dir);
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
// Escape hatches in gradual targets, as `{ file, line }` in source order.
const escapes = { any: [], casts: [], ignores: [] };
let hiddenMissingTypes = 0;
const hiddenMissingTypesDirs = new Set();
let hiddenScope = 0;
// The NAMES the missing-types advisories are about (`describe`, `require`
// …) — TypeScript's own message carries each one, and a summary that says
// "install the @types package" without a noun sends the user hunting
// through their imports for which declaration is absent.
const missingTypeNames = new Set();
// The `@types/bun` a project resolves: the package.json that DECLARES it
// (the file an upgrade edits) and the version actually installed. Walks
// like node resolution — nearest declaration, nearest node_modules.
// Host types describe the RUNTIME's own globals, so a version apart from
// the running Bun describes a runtime the code will not meet; the
// advisory below reports the divergence, never the absence (that is the
// missing-types family's).
//
// The walk ALWAYS has a ceiling inside the project: the workspace root
// when startDir is under one, else startDir's own nearest package root,
// else startDir. Running to the FILESYSTEM root instead would let a
// `@types/bun` declared or installed anywhere above — a checkout's
// parent, a home directory — answer for a project that never asked, and
// the advisory names the directory it found.
const hostTypesFor = (startDir) => {
  let bound = startDir;
  if (workspaceRoot && (startDir === workspaceRoot || startDir.startsWith(workspaceRoot + path.sep))) {
    bound = workspaceRoot;
  } else {
    for (let d = startDir; path.dirname(d) !== d; d = path.dirname(d)) {
      if (fs.existsSync(path.join(d, 'package.json'))) { bound = d; break; }
    }
  }
  // The two sites are found INDEPENDENTLY and both are kept. Under a
  // hoisted linker they routinely differ — a member declares the
  // dependency while the install lands in the workspace root — and
  // naming only one of them misdirects in the other's case: report the
  // declaring site and a stale root install sends the reader to a
  // package.json that already reads correctly; report the install site
  // and a stale member declaration sends them to a directory that
  // declares nothing. Whoever reads the advisory needs whichever it is,
  // so the caller says both when they are not the same place.
  let declaredAt = null;
  let installedAt = null;
  let installed = null;
  for (let d = startDir; ; d = path.dirname(d)) {
    if (declaredAt === null) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8'));
        if ((pkg?.devDependencies?.['@types/bun'] ?? pkg?.dependencies?.['@types/bun']) != null) declaredAt = d;
      } catch { /* no package.json here, or unreadable — keep walking */ }
    }
    if (installed === null) {
      try {
        installed = JSON.parse(
          fs.readFileSync(path.join(d, 'node_modules', '@types', 'bun', 'package.json'), 'utf8'),
        ).version ?? null;
        if (installed !== null) installedAt = d;
      } catch { /* not installed at this level — keep walking */ }
    }
    if (d === bound || path.dirname(d) === d) break;
  }
  // A declaration is the GATE, never the report: without one the copy is
  // some dependency's, and the project was never asked to hold a version.
  return declaredAt === null || installed === null
    ? null : { declaredAt, installedAt, installed };
};
// The PROJECTS the hidden diagnostics belong to (config-dir, cwd-relative),
// per family — named in the summary so the `rip.strict` remedy points at
// the right package.json. The home project ('.') stays unnamed.
const hiddenScopeDirs = new Set();
const hiddenAnnotationDirs = new Set();
let hiddenUninstalled = 0;
const hiddenUninstalledDirs = new Set();   // where `bun install` answers
// package name -> the names this project imports from it and receives as
// `any`. Filled by the inherited-`any` pass; read by the advisory.
const inheritedAny = new Map();
// The files where this project uses a value it received as `any` — one
// row per (file, local binding), with the arrival position to open at.
const inheritedSites = [];
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
    result = compile(source, { path: fsPath, face: 'ts', runtimeDelivery: 'inline', strict: cfg.strict, appStashSpec: appStashSpecFor(fsPath, workspaceRoot, stashMemo) });
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
      pinSpans: result.pinSpans ?? [],
      srcLineStarts, genLineStarts: lineStartsOf(result.code),
      strict: cfg.strict === true,
      dir: path.dirname(fsPath),
    },
    pinnables: result.pinnables ?? [],
  });
  // The spliced stash rides the closure like an import (closureImportsOf):
  // a single-file check of a route must still compile the stash its face
  // references.
  const closureImports = closureImportsOf(result.stores, source, fsPath, workspaceRoot, stashMemo);
  for (const imp of closureImports) {
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
  typedExports.set(fsPath, moduleTypedExports(entry.source, entry.result));
}
for (const [fsPath, entry] of compiled) {
  const tokens = entry.result.tokens;
  entry.good.checkedLines = scopeGate(
    tokens, entry.source, entry.result,
    typedImportsOf(entry.result.stores, entry.source, path.dirname(fsPath), (p) => typedExports.get(p)),
  );
  if (explicitTargets.has(fsPath) && diskConfig(path.dirname(fsPath)).strict !== true) {
    const found = escapeHatchesOf(tokens, entry.source, entry.good.srcLineStarts);
    for (const kind of ['any', 'casts', 'ignores']) for (const line of found[kind]) escapes[kind].push({ file: fsPath, line });
  }
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
  // reaching importers the way the runtime does), when its MODE FLIPS
  // against its parent package's (floors and null posture are per-PROGRAM:
  // a strict package inside a gradual program would get the floor's `any`s,
  // and a gradual package inside a strict program would get strict nulls
  // and refused floors), or when it INSTALLS its own ambient types
  // (configEarnsBoundary carries the config-driven pair). A package whose
  // own tsconfig wraps it needs nothing more; the workspace root has no
  // narrower scope to give.
  const autoBoundaryRels = new Set();
  if (!mirrorRootIsFallback) {
    for (const [fsPath, entry] of compiled) {
      let pkgDir = null;
      const cfgDir = entry.cfg._configDir;
      if (cfgDir && configEarnsBoundary(entry.cfg, projectConfig(path.dirname(cfgDir)), workspaceRoot)) {
        pkgDir = cfgDir;
      } else if (entry.result.globalDecls?.length) {
        for (let dir = path.dirname(fsPath); ; dir = path.dirname(dir)) {
          if (fs.existsSync(path.join(dir, 'package.json'))) { pkgDir = dir; break; }
          if (dir === workspaceRoot || path.dirname(dir) === dir) break;
        }
      }
      if (pkgDir === null || pkgDir === workspaceRoot || !pkgDir.startsWith(workspaceRoot + path.sep)) continue;
      const rel = path.relative(workspaceRoot, pkgDir);
      // A tsconfig AT the package dir already partitions it (that wrapper
      // reads its posture from the package). One ABOVE it does not — the
      // wrapper's posture is the wrapper's, so a flipped package below a
      // wrapped project still needs its own boundary.
      if (![...wrapperRels].some((w) => rel === w)) autoBoundaryRels.add(rel);
    }
  }
  const mirror = generatedMirror({
    workspaceRoot, mirrorRootIsFallback, excludeDirs: [...wrapperRels, ...autoBoundaryRels], strict: forceStrict,
  });
  fs.writeFileSync(path.join(mirrorRoot, 'tsconfig.json'), JSON.stringify(mirror.tsconfig, null, 2));
  fs.writeFileSync(path.join(mirrorRoot, HOST_FLOOR_NAME), mirror.hostFloorDts);
  for (const rel of wrapperRels) {
    const wrapperDir = path.join(mirrorRoot, rel);
    const wrapper = projectWrapper({
      wrapperDir, sourceTsconfig: path.join(workspaceRoot, rel, 'tsconfig.json'),
      workspaceRoot, mirrorRoot, strict: forceStrict,
    });
    fs.mkdirSync(wrapperDir, { recursive: true });
    fs.writeFileSync(path.join(wrapperDir, 'tsconfig.json'), JSON.stringify(wrapper.tsconfig, null, 2));
    fs.writeFileSync(path.join(wrapperDir, HOST_FLOOR_NAME), wrapper.hostFloorDts);
  }
  for (const rel of autoBoundaryRels) {
    const wrapperDir = path.join(mirrorRoot, rel);
    const wrapper = projectWrapper({
      wrapperDir, sourceTsconfig: null, sourceDir: path.join(workspaceRoot, rel),
      workspaceRoot, mirrorRoot, strict: forceStrict,
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
    // `--public` cannot walk without a checker, and the mode answers its
    // own question or says why it could not — never the type-check frame
    // it exists to replace.
    if (publicAudit) {
      console.error('rip check --public: tsgo not available (bun install in packages/vscode) — the audit needs the type checker and could not run');
      process.exit(2);
    }
    // Without tsgo the mirror is built but nothing type-checks. Report the
    // Rip parse errors we do have, but the run is NOT clean — it exits
    // non-zero (below) so a CI gate never reads un-type-checked code as OK.
    console.error('rip check: tsgo not available (bun install in packages/vscode) — checking Rip parse errors only, no type diagnostics');
    tsgoUnavailable = true;
  } else {
    const tsgo = session.client;
    // Requests to tsgo go out a bounded number at a time, in issue order.
    // tsgo drains its queue serially, and a request's timeout runs from
    // the moment it is SENT (tsgo.js): a request's budget covers what is
    // in flight ahead of it — at most the window, never the whole batch —
    // and the first request of the session goes alone, so the cold
    // program build is charged to one request, not a window of them.
    // Wide enough that the round-trips still overlap.
    const paced = pacer(16);
    try {
      // ── PIN PASS ── Tier-3 pins, per file: splice probe declarations
      // that tsgo can type NATIVELY (not evolving-`any`), hover them, and
      // feed the answers back into a recompile — so a hoisted binding
      // read across a closure resolves to its real type, as in the editor.
      // Files are probed ONE AT A TIME, in `compiled` order (a file's
      // hovers overlap with each other, paced). A pinned file recompiles,
      // rewrites, and OPENS its face as a document before the next file
      // is probed: tsgo resolves an import against an open document's
      // text, not the disk (which it re-reads only at its own pace), so
      // every later probe sees every face the pass has pinned so far —
      // deterministically. Probing files concurrently would race an
      // importer's queued hovers against its dependency's didOpen, and
      // which pinnables land would then depend on timing, not source.
      const repin = (fsPath, entry, pins) => {
        const r = compile(entry.source, { path: fsPath, face: 'ts', runtimeDelivery: 'inline', strict: entry.cfg.strict, pins, appStashSpec: appStashSpecFor(fsPath, workspaceRoot, stashMemo) });
        entry.good.code = r.code;
        entry.good.mappings = r.mappings;
        entry.good.echoSpans = r.echoSpans ?? [];
        entry.good.pinSpans = r.pinSpans ?? [];
        entry.good.genLineStarts = lineStartsOf(r.code);
        fs.writeFileSync(entry.mirrorPath, r.code);
        tsgo.notify('textDocument/didOpen', { textDocument: { uri: entry.mirrorUri, languageId: 'typescript', version: 1, text: r.code } });
        entry.opened = true;
      };
      const probeOne = async ([fsPath, entry]) => {
        const probePath = entry.mirrorPath.replace(/\.ts$/, '.__rip_probe__.ts');
        const probeUri = pathToFileURL(probePath).href;
        const { text, positions } = buildProbe(entry.good.code, entry.pinnables);
        const pins = new Map();
        try {
          fs.writeFileSync(probePath, text);
          tsgo.notify('textDocument/didOpen', { textDocument: { uri: probeUri, languageId: 'typescript', version: 1, text } });
          // The probe's hovers are in flight together (paced — see
          // `paced`), so the round-trips overlap instead of queuing. A
          // dead tsgo or a timeout answers null — no pin, status quo.
          const hovers = await Promise.all(entry.pinnables.map((_, i) => (positions[i]
            ? paced(() => tsgo.request('textDocument/hover', { textDocument: { uri: probeUri }, position: positions[i] })).then(parseProbeHover, () => null)
            : Promise.resolve(null))));
          hovers.forEach((type, i) => { if (type !== null) pins.set(entry.pinnables[i].key, type); });
          tsgo.notify('textDocument/didClose', { textDocument: { uri: probeUri } });
        } finally {
          try { fs.unlinkSync(probePath); } catch { /* already gone */ }
        }
        if (pins.size) repin(fsPath, entry, pins);
      };
      for (const item of compiled) if (item[1].pinnables.length) await probeOne(item);

      // A finding's origin arrives as a position in the MIRROR. The report
      // is about source, so each mirror is kept under the checker's own
      // canonical spelling of its path — case-folded on a case-insensitive
      // filesystem, and never the spelling this process happens to hold.
      // One index for the run, shared by both passes below.
      const byMirror = new Map();
      for (const [fp, e] of compiled) {
        if (e.mirrorPath !== undefined) byMirror.set(e.mirrorPath.toLowerCase(), { fsPath: fp, entry: e });
      }
      // Q1 spelled once: a declaration belongs to the package whose
      // package.json is nearest it. Both passes ask it of a different
      // package, so the package is the parameter.
      const ownedBy = (pkgDir) => (declPath) => {
        const owner = byMirror.get(String(declPath ?? '').toLowerCase());
        if (owner === undefined) return false;
        return nearestPackage(path.dirname(owner.fsPath)) === pkgDir;
      };

      // Whether a generated offset falls in type text the COMPILER wrote.
      // A pin is the type inferred for a still-hoisted binding, spelled
      // into the face as an ordinary annotation — nothing in the mirror's
      // syntax separates it from one the author wrote, so a walk asking
      // whether a position was CLAIMED has to be told. Both passes ask.
      const synthesized = (declPath, start) => {
        const spans = byMirror.get(String(declPath ?? '').toLowerCase())?.entry.good?.pinSpans;
        if (spans === undefined) return false;
        return spans.some(([from, to]) => start >= from && start < to);
      };

      // ── PUBLIC PASS ── `--public`: what a CONSUMER's checker resolves
      // for every name a package publishes, and the path to the first `any`
      // inside it. The walk itself lives in
      // packages/vscode/src/publicwalk.js, which holds the type checker;
      // what happens here is finding each package, mirroring its entries,
      // and turning what comes back into a report.
      if (publicAudit) {
        const report = [], unreadable = [];
        const session = createPublicSession(mirrorRoot);
        try {
          for (const { dir, entries: pkgEntries, patterns, outside } of publicPkgs) {
            // The package's own mirrored tree: the ownership line, and the
            // only directory whose declarations this package can change.
            // Q1: a declaration is this package's when the package.json
            // NEAREST it is this one. Mirrored paths arrive case-folded, so
            // the index is keyed that way; a declaration this run never
            // compiled (lib.dom, node types, a `.d.ts`) is in no package of
            // ours and answers false, which is the correct answer and not a
            // fallback.
            const owns = ownedBy(dir);
            for (const spec of outside) {
              unreadable.push({ entryFile: path.join(dir, spec), reason: null, outside: spec });
            }
            // What the PACKAGE publishes, across every entry, before any
            // walk — the sibling stop asks "does another row cover this?",
            // and a package publishes from all of its entries, not just the
            // one being walked. A SINGLE entry needs no prebuild: the walk
            // seeds its own exports into the sibling set itself, and this
            // pass exists only so OTHER entries' exports can stop a walk —
            // enumerating the one entry here would enumerate it twice.
            const siblingIds = new Set();
            if (pkgEntries.length > 1) {
              for (const entryFile of pkgEntries) {
                const e = compiled.get(entryFile);
                if (e?.mirrorPath === undefined) continue;
                for (const id of await exportIdsOf(session, e.mirrorPath)) siblingIds.add(id);
              }
            }
            // A pattern is surface this audit cannot enumerate — a floor
            // rather than an absence. It is a fact about the MANIFEST,
            // carried once per package: riding each entry's row would
            // multiply it by however many entries the package has.
            if (patterns > 0) {
              report.push({ dir, entryFile: dir, rows: [], unexplored: 0, forwarded: patterns });
            }
            for (const entryFile of pkgEntries) {
              const entry = compiled.get(entryFile);
              // An entry the audit cannot read is not an absence of
              // findings, and never reports as one: an entry that does not
              // compile publishes nothing a consumer can resolve, which is
              // the strongest finding this command has. Every entry on disk
              // was a compile target, so the only way to be missing here is
              // to have failed — and `compileFailureOf` names the failure.
              if (entry === undefined) {
                unreadable.push({
                  entryFile,
                  reason: compileFailureOf(entryFile) ?? 'could not be compiled this run',
                });
                continue;
              }
              const walked = await walkPublicEntry(session, {
                mirrorFile: entry.mirrorPath,
                owns,
                siblingIds: new Set(siblingIds),
                synthesized,
              });
              if (walked.unresolved !== null) {
                unreadable.push({ entryFile, reason: walked.unresolved });
                continue;
              }
              const toSite = (origin) => {
                if (origin === null || origin === undefined) return undefined;
                const owner = byMirror.get(origin.path.toLowerCase());
                if (owner === undefined) return undefined;
                const span = generatedSpanToSource(owner.entry.good.mappings, origin.start, origin.start);
                if (!span) return undefined;
                const at = offsetToPosition(owner.entry.good.srcLineStarts, span[0]);
                return { file: owner.fsPath, line: at.line, character: at.character };
              };
              for (const row of walked.rows) {
                // Deduplicated on the SOURCE position, which is the thing
                // that gets edited. Several generated declarations can map
                // back to one line — a class's fields all carry the
                // constructor's — and naming it three times reads as three
                // things to fix.
                // A field assigned from a constructor parameter is not its
                // own work: `@request = request` emits a field declaration
                // that never existed in the source, and its type follows the
                // parameter. Annotating the parameter answers both, so the
                // parameter is the finding and the field is its shadow.
                // Identity is the DECLARATION the walk found, which it has
                // already deduplicated. Re-keying on the mapped source
                // position collapses distinct declarations that share a
                // line — every field a constructor synthesizes carries the
                // constructor's position — and reports less work than there
                // is. The mapped position is for display.
                for (const d of row.defects ?? []) d.site = toSite(d.origin);
              }
              report.push({ dir, entryFile, rows: walked.rows, unexplored: walked.unexplored, forwarded: walked.forwarded });
            }
          }
        } finally {
          try { await session.close(); } catch { /* the server is going away anyway */ }
        }
        const verdict = printPublicReport(report, unreadable);
        process.exit(verdict !== 0 ? verdict : ((incompleteCheck || tsgoUnavailable) ? 2 : 0));
      }

      // ── INHERITED `any` ── the names THIS project imports from other
      // packages and receives as `any`.
      //
      // Nothing else in the report covers it. The ledger below counts
      // diagnostics and missing annotations INSIDE a dependency, which is a
      // different claim: a package can carry no hidden diagnostics and still
      // publish `any`, or carry thousands and publish none. And no checker
      // will ever complain here, because using an `any` is not an error —
      // the narrowing succeeds, the member access resolves, and the code
      // reads as checked while nothing is checking it.
      //
      // Scoped to what this project actually IMPORTS. The whole published
      // surface would be the same number for every consumer of a package,
      // and so would say nothing about any of them.
      if (!publicAudit) {
        // A module imported as a NAMESPACE takes no named bindings, so
        // nothing narrows it: every export is reachable through the alias.
        const wanted = new Map();         // dependency entry -> imported names
        const importers = new Map();      // target file -> dependency entry -> imported name -> local name
        for (const fsPath of explicitTargets) {
          const entry = compiled.get(fsPath);
          if (entry === undefined) continue;
          // A file under `rip.noCheck` is not asked for diagnostics at all,
          // and does not report what it inherits either: the setting says
          // this code is not being checked, and an advisory about its type
          // safety answers a question its author declined to ask.
          if (isNoCheckPath(fsPath, entry.cfg._configDir, entry.cfg.noCheck)) continue;
          // STRICT only. Gradual accepts `any` — that is what it is for —
          // and an inherited one is not even a defect this project can
          // answer by annotating, so it is not on the gradual path at all.
          // It becomes actionable at the posture that refuses `any`, and a
          // gradual project meets it where it would meet every other strict
          // finding: under `--strict`, which reads the workspace as if it
          // had flipped.
          if (entry.good.strict !== true) continue;
          const fromDir = path.dirname(fsPath);
          const ownPackage = nearestPackage(fromDir);
          // The dependency an import lands on, when it IS one: resolved by
          // the shared rule (ripSpecifierTarget — the same spelling the
          // closure walk and the typed-import gate resolve with), compiled
          // this run, and across a package boundary.
          const dependencyOf = (module) => {
            const target = ripSpecifierTarget(module, fromDir);
            if (target === null || !compiled.has(target)) return null;
            if (nearestPackage(path.dirname(target)) === ownPackage) return null;  // same package
            return target;
          };
          const record = (target, imported, local) => {
            const byFile = importers.get(fsPath) ?? new Map();
            const forDep = byFile.get(target) ?? new Map();
            forDep.set(imported, local);
            byFile.set(target, forDep);
            importers.set(fsPath, byFile);
          };
          // Two readers, because a file binds a dependency's names two ways:
          // the braced list and the default binding, and `import * as ns`,
          // which binds the whole module and so narrows nothing.
          for (const n of namespaceImportsOf(entry.result?.stores, entry.source)) {
            const target = dependencyOf(n.module);
            if (target === null) continue;
            wanted.set(target, null);                   // null = the whole surface
            record(target, '*', n.local);               // the alias is the one site
          }
          for (const b of importBindingsOf(entry.result?.stores, entry.source)) {
            const target = dependencyOf(b.module);
            if (target === null) continue;
            if (!wanted.has(target)) wanted.set(target, new Set());
            wanted.get(target)?.add(b.imported);        // null stays null: all of it
            record(target, b.imported, b.local);
          }
        }
        if (wanted.size > 0) {
          const session = createPublicSession(mirrorRoot);
          // Accumulated ACROSS dependencies and resolved once per consumer
          // below: each useSitesOf call snapshots its file, and a consumer
          // importing from k leaking packages is one file, not k.
          const leakedLocals = new Map();   // consumer file -> local name -> package label
          try {
            for (const [entryFile, names] of wanted) {
              const entry = compiled.get(entryFile);
              if (entry?.mirrorPath === undefined) continue;
              const dir = nearestPackage(path.dirname(entryFile));
              const walked = await walkPublicEntry(session, {
                mirrorFile: entry.mirrorPath,
                owns: ownedBy(dir),
                only: names,
                synthesized,
              }).catch(() => null);
              if (walked === null || walked.unresolved !== null) continue;
              const leaks = walked.rows.filter((r) => r.kind === 'leak').map((r) => r.name);
              if (leaks.length === 0) continue;
              let label = dir === null ? entryFile : path.relative(process.cwd(), dir);
              try { label = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name ?? label; } catch { /* unnamed */ }
              const seen = inheritedAny.get(label) ?? new Set();
              for (const n of leaks) seen.add(n);
              inheritedAny.set(label, seen);
              for (const [fsPath, byDep] of importers) {
                const names = byDep.get(entryFile);
                if (names === undefined) continue;
                const locals = leaks.map((n) => names.get(n)).filter((n) => n !== undefined);
                const viaAlias = names.get('*');
                if (viaAlias !== undefined && !locals.includes(viaAlias)) locals.push(viaAlias);
                if (locals.length === 0) continue;
                const forFile = leakedLocals.get(fsPath) ?? new Map();
                for (const local of locals) forFile.set(local, label);
                leakedLocals.set(fsPath, forFile);
              }
            }
            // Where this project USES what it received untyped. The remedy
            // is in the package named above, but the reach is here, and the
            // reach is what a reader cannot otherwise see. A use counts
            // only when it maps to source — a body the compiler emits twice
            // reaches one source position from two generated ones, and a
            // local whose every use is unmapped has no reach to show — and
            // one row per (file, local) is all the table reads.
            for (const [fsPath, forFile] of leakedLocals) {
              const consumer = compiled.get(fsPath);
              if (consumer?.mirrorPath === undefined) continue;
              const found = await useSitesOf(session, { mirrorFile: consumer.mirrorPath, names: [...forFile.keys()] })
                .catch(() => new Map());
              const toSource = (span) => {
                const mapped = span === null ? null : generatedSpanToSource(consumer.good.mappings, span[0], span[1]);
                return mapped ? offsetToPosition(consumer.good.srcLineStarts, mapped[0]) : null;
              };
              for (const [local, { uses, arrival }] of found) {
                if (!uses.some((span) => toSource(span) !== null)) continue;
                inheritedSites.push({ file: fsPath, local, label: forFile.get(local), at: toSource(arrival) });
              }
            }
          } finally {
            try { await session.close(); } catch { /* the server is going away anyway */ }
          }
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
      // pinned faces before any diagnostics are pulled. A pinned face is
      // already open (its pin pass opened the final text).
      for (const [, entry] of compiled) {
        if (entry.opened) continue;
        tsgo.notify('textDocument/didOpen', { textDocument: { uri: entry.mirrorUri, languageId: 'typescript', version: 1, text: entry.good.code } });
      }

      // ── PULL + MAP ── one request per file (tsgo answers when the
      // program is ready — deterministic, no settle). Map back, apply the
      // @ts-expect-error semantics, silence rip.noCheck paths.
      // The pulls are issued together (paced — see `paced`; the first
      // answers when the program is ready, the rest are queued behind it)
      // and consumed in file order, so the report keeps its order.
      const pulls = new Map();
      for (const [fsPath, entry] of compiled) {
        if (isNoCheckPath(fsPath, entry.cfg._configDir, entry.cfg.noCheck)) continue;
        pulls.set(fsPath, paced(() => tsgo.request('textDocument/diagnostic', { textDocument: { uri: entry.mirrorUri } })).then((r) => ({ ok: true, r }), (err) => ({ ok: false, err })));
      }
      for (const [fsPath, entry] of compiled) {
        if (isNoCheckPath(fsPath, entry.cfg._configDir, entry.cfg.noCheck)) continue;
        let pulled;
        try { const got = await pulls.get(fsPath); if (!got.ok) throw got.err; pulled = got.r; }
        catch (err) {
          // A pull can reject (the cold first pull warms the whole program
          // and may hit the request timeout, or tsgo dies mid-run). That
          // file went unchecked — mark the run short rather than let a
          // dropped file read as clean.
          incompleteCheck = true;
          console.error(`rip check: could not pull diagnostics for ${path.relative(process.cwd(), fsPath)} (${err.message}) — the run is incomplete`);
          continue;
        }
        // A DEPENDENCY answers for itself, in every currency this report
        // has. A file the run was not asked about is still compiled and
        // checked — a target's types cannot resolve otherwise — but what
        // is read off it here belongs to THIS run's program, not to the
        // package: its own host types, its non-`.rip` files, and the
        // inference those support are all things a consumer's closure
        // may never materialize. So nothing it says is carried out of
        // this loop — not the diagnostics, which would make a package's
        // exit code hostage to code its author does not own, and not a
        // count of them either, which points a reader at a package where
        // the number cannot be reproduced. Its HIDDEN families stop here
        // for the same reason plus one more: a strict project hides
        // nothing of its own, so counting dependencies would make its
        // ledger wholly other people's, offering a `rip.strict` it has
        // already set in a package.json it did not open.
        const isTarget = explicitTargets.has(fsPath);
        const mapped = [];
        for (const d of pulled?.items ?? []) {
          const m = mapTsDiagnostic(entry.good, d);
          // Count only what strict would actually SHOW. The suppression
          // check runs before the mapping one, so a bare code test also
          // counts diagnostics that would have been dropped anyway for
          // having no source span — inflating the number several-fold and
          // promising the user diagnostics `rip.strict` would never
          // deliver. Re-map with the strict flag to ask the real question.
          if (!m && isTarget && !entry.cfg.strict && mapTsDiagnostic({ ...entry.good, strict: true }, d)) {
            // Which PROJECT the hidden diagnostic belongs to — config is
            // per file, so a directory check spans several package.jsons
            // and a summary that says "set `rip.strict`" right after the
            // user did exactly that in the one they were thinking of
            // reads as broken unless it names which is meant.
            const proj = path.relative(process.cwd(), entry.cfg._configDir ?? path.dirname(fsPath)) || '.';
            const uninstalledAt = d.code === 2307
              ? declaredButUninstalled(/Cannot find module '([^']+)'/.exec(d.message)?.[1], path.dirname(fsPath)) : null;
            if (uninstalledAt) { hiddenUninstalled++; hiddenUninstalledDirs.add(path.relative(process.cwd(), uninstalledAt) || '.'); }
            else if (IMPLICIT_ANY_CODES.has(d.code)) { hiddenAnnotations++; hiddenAnnotationDirs.add(proj); }
            else if (MISSING_TYPES_CODES.has(d.code)) {
              hiddenMissingTypes++;
              hiddenMissingTypesDirs.add(proj);
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
          // Dropped outright, not counted: a diagnostic raised against a
          // dependency HERE is a reading of that file inside THIS run's
          // program, where the package's own host types, its non-`.rip`
          // runtime files, and the inference they support may all be
          // absent. Its own check is the only place the reading is of the
          // package as it is built — so a count taken here is not a
          // smaller version of that report, it is a different one, and
          // pointing the reader at the package sends them somewhere the
          // number cannot be found.
          if (!isTarget) continue;
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

// ── `--public`, when nothing compiled ───────────────────────────────
// The pass above prints and exits, so reaching here under `--public`
// means no entry compiled at all and there is no checker to walk. What
// remains reportable are manifest and compiler facts — entries that
// failed to compile, entries published from outside the package, pattern
// floors — and the mode still answers with its own report, never the
// type-check frame it exists to replace.
if (publicAudit) {
  const report = [], unreadable = [];
  for (const { dir, entries: pkgEntries, patterns, outside } of publicPkgs) {
    for (const spec of outside) {
      unreadable.push({ entryFile: path.join(dir, spec), reason: null, outside: spec });
    }
    if (patterns > 0) {
      report.push({ dir, entryFile: dir, rows: [], unexplored: 0, forwarded: patterns });
    }
    for (const entryFile of pkgEntries) {
      unreadable.push({ entryFile, reason: compileFailureOf(entryFile) ?? 'could not be compiled this run' });
    }
  }
  const verdict = printPublicReport(report, unreadable);
  process.exit(verdict !== 0 ? verdict : ((incompleteCheck || tsgoUnavailable) ? 2 : 0));
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
  // aligned `~~~` underline, then a `Found N errors …` summary. The
  // report colors live at module scope, shared with `--public`'s printer.
  const sourceLines = new Map();
  const linesOf = (fsPath) => {
    if (!sourceLines.has(fsPath)) {
      const g = compiled.get(fsPath)?.good;
      sourceLines.set(fsPath, (g ? g.source : (() => { try { return fs.readFileSync(fsPath, 'utf8'); } catch { return ''; } })()).split('\n'));
    }
    return sourceLines.get(fsPath);
  };

  for (const r of rows) {
    const loc = `${cyan(rel(r.file))}:${lineCol(String(r.line + 1))}:${lineCol(String(r.character + 1))}`;
    const code = dim(r.code != null ? ` TS${r.code}: ` : ': '); // tsc wraps the whole ` TSxxxx: ` segment
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
      console.log(`  ${cyan(rel(rr.file))}:${lineCol(String(rr.line + 1))}:${lineCol(String(rr.character + 1))} - ${rr.message}`);
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
    else if (warningCount === 0) console.log(paint('32', '✓ No type errors') + dim(` (${compiled.size} file${compiled.size === 1 ? '' : 's'} checked)`));
    else console.log(`Found ${warningCount} warning${warningCount === 1 ? '' : 's'}.`);
  } else if (perFile.size === 1) {
    const [f, info] = [...perFile][0];
    console.log(errorCount === 1
      ? `Found 1 error in ${rel(f)}${dim(':' + info.firstLine)}`
      : `Found ${errorCount} errors in the same file, starting at: ${rel(f)}${dim(':' + info.firstLine)}`);
  } else {
    console.log(`Found ${errorCount} errors in ${perFile.size} files.`);
    console.log('');
    console.log('Errors  Files');
    // tsc leaves the filename PLAIN here (only the `:line` is gray).
    for (const [f, info] of perFile) {
      console.log(`${String(info.count).padStart(6)}  ${rel(f)}${dim(':' + info.firstLine)}`);
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
  // project — one check can span several package.jsons, and "set
  // `rip.strict`" must point at the one that governs the hiding.
  const inProjects = (dirs) => {
    const named = [...dirs].filter((d) => d !== '.').sort();
    if (!named.length) return '';
    return ` (${named.slice(0, 3).join(', ')}${named.length > 3 ? ` and ${named.length - 3} more` : ''})`;
  };
  // The escape-hatch advisories are not ledger: each names code that asks
  // for checking and withholds it, with the sites, so the remedy is one edit
  // away. Yellow, apart from the gray ledger below; they never move the exit
  // status.
  //
  // Yellow carries the CLAIM and stops there; the reasoning and the remedy
  // that follow it are gray. A sentence painted end to end is loud at the
  // length of its longest clause, and the clause that has to catch the eye
  // is the first one — the rest is read once the reader has decided to look.
  const claim = (head, tail) => `${advise(head)}${dim(tail)}`;
  const advisory = (sites, head, tail) => {
    if (sites.length === 0) return;
    console.log('');
    console.log(claim(head(sites.length), tail));
    for (const a of sites) console.log(`  ${rel(a.file)}${dim(':' + a.line)}`);
  };
  advisory(escapes.any, (n) => `${n} \`any\` annotation${plural(n)}`,
    ' — an `any` annotation switches checking on for its scope and tells the checker nothing; '
    + 'under gradual an unannotated binding is already `any`, so write the real type or drop the annotation');
  advisory(escapes.casts, (n) => `${n} \`as any\` cast${plural(n)}`,
    ' — `as any` exempts one expression from a scope that is otherwise checked; cast to the type it really is, or fix the value');
  advisory(escapes.ignores, (n) => `${n} \`@ts-ignore\` directive${plural(n)}`,
    ' — `@ts-ignore` keeps silencing the next line after the error it hid is gone; '
    + '`@ts-expect-error` reports when the suppression is no longer needed');
  // Host types that describe a DIFFERENT runtime than the one this ran
  // under, per declaring project — once, regardless of how many files
  // reached it. An ADVISORY, not ledger: the package is the target's own
  // and the remedy is a single `bun add`, where the gray families below
  // are counts a consumer often cannot act on at all (a dependency's
  // diagnostics belong to the dependency). Never gated on a diagnostic
  // either — types NEWER than the runtime answer for APIs absent at run
  // time, which is exactly the case no check can see, so this fires on a
  // wholly clean run. `bun` is absent under a non-Bun host; with nothing
  // to compare it stays silent.
  const runtimeBun = typeof Bun === 'undefined' ? null : Bun.version;
  const hostMismatches = new Map();             // sites → { where, installed }
  if (runtimeBun !== null) {
    const relOf = (d) => path.relative(process.cwd(), d) || '.';
    for (const fsPath of explicitTargets) {
      const cfgDir = compiled.get(fsPath)?.cfg?._configDir ?? path.dirname(fsPath);
      const host = hostTypesFor(cfgDir);
      if (host === null || host.installed === runtimeBun) continue;
      const at = relOf(host.installedAt);
      const from = relOf(host.declaredAt);
      // One place, one name; two places, both — the reader cannot act on
      // a location that is only half the story.
      const where = at === from ? (at === '.' ? '' : ` in ${at}`)
        : ` (installed in ${at}, declared in ${from})`;
      hostMismatches.set(`${at} ${from}`, { where, installed: host.installed });
    }
  }
  if (hostMismatches.size > 0) {
    const sites = [...hostMismatches.keys()].sort();
    const shown = sites.slice(0, 3)
      .map((s) => `${hostMismatches.get(s).installed}${hostMismatches.get(s).where}`).join(', ');
    const more = sites.length > 3 ? ` and ${sites.length - 3} more` : '';
    // `there` only when every mismatch names somewhere to go.
    const wholly = [...hostMismatches.values()].every((m) => m.where !== '');
    console.log('');
    console.log(claim(`\`@types/bun\` ${shown}${more} `
      + `${hostMismatches.size === 1 ? 'does' : 'do'} not match the running Bun ${runtimeBun}`,
      ` — \`Bun\`, \`process\`, and the rest are typed from the wrong version `
      + `(try \`bun add -d @types/bun@${runtimeBun}\`${wholly ? ' there' : ''})`));
  }
  if (inheritedAny.size > 0) {
    // Two levels, two questions: the heading is what this project
    // RECEIVES untyped from that package, the rows are where it reaches.
    // An import that arrives and is never used answers the first and not
    // the second, so neither level restates the other.
    //
    // One line per FILE, and every file that has one. A file is the unit
    // a reader opens, and naming each of them is complete at that level —
    // unlike a sample of positions, which shows some of the reach and
    // says nothing about the rest.
    const blocks = [...inheritedAny.keys()].sort().map((label) => {
      const byFile = new Map();
      for (const x of inheritedSites) {
        if (x.label !== label) continue;
        const row = byFile.get(x.file) ?? { locals: new Set(), at: null };
        row.locals.add(x.local);
        // The file opens where the value ARRIVED — its import — which is
        // the one position that is about the file as a whole rather than
        // about one of the places it is used.
        if (row.at === null && x.at !== null) row.at = x.at;
        byFile.set(x.file, row);
      }
      return { label, byFile, files: [...byFile.keys()].sort((a, b) => rel(a).localeCompare(rel(b))) };
    });
    const bare = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').length;
    const shownAt = (byFile, f) => {
      const { at } = byFile.get(f);
      return at === null ? cyan(rel(f))
        : `${cyan(rel(f))}:${lineCol(String(at.line + 1))}:${lineCol(String(at.character + 1))}`;
    };
    // Sized across the WHOLE family, not per package: the packages are
    // one table read down a single column of names, and three columns
    // that each happen to fit their own block read as three tables. No
    // ceiling on the width — a location wider than the cap cannot be
    // shortened to fit it, so a cap does not bound the column, it only
    // lets the long rows out of it and takes the one column back.
    const w = blocks.reduce((m, b) =>
      b.files.reduce((n, f) => Math.max(n, bare(shownAt(b.byFile, f))), m), 0);
    for (const { label, byFile, files } of blocks) {
      // EVERY name, never a sample: the list is the arrivals themselves,
      // and a reader who cannot see which ones has to go find out anyway.
      // A count with four of nine names beside it is the shape that reads
      // as complete while withholding most of what it describes.
      const names = [...inheritedAny.get(label)].sort();
      const shown = names.map((n) => `\`${n}\``).join(', ');
      // Each package is its own finding with its own remedy, so each
      // gets the blank line an advisory gets — run together they read as
      // one paragraph about nothing in particular.
      console.log('');
      console.log(claim(`${names.length} value${plural(names.length)} imported from \`${label}\` `
        + `${names.length === 1 ? 'is' : 'are'} \`any\``,
        ` (${shown}) — run \`rip check --public\` there`));
      for (const f of files) {
        const at = shownAt(byFile, f);
        console.log(`  ${at}${' '.repeat(Math.max(0, w - bare(at)))}  ${dim([...byFile.get(f).locals].sort().join(', '))}`);
      }
    }
  }
  if (hiddenAnnotations > 0 || hiddenMissingTypes > 0 || hiddenScope > 0 || hiddenUninstalled > 0) console.log('');
  if (hiddenScope > 0) {
    console.log(dim(`${hiddenScope} diagnostic${plural(hiddenScope)} hidden in unannotated code${inProjects(hiddenScopeDirs)} `
      + `— annotate a declaration to check its scope, or set \`rip.strict\` in package.json (preview it with \`rip check --strict\`)`));
  }
  if (hiddenAnnotations > 0) {
    console.log(dim(`${hiddenAnnotations} annotation diagnostic${plural(hiddenAnnotations)} hidden${inProjects(hiddenAnnotationDirs)} `
      + `— set \`rip.strict\` in package.json to see where annotations are missing (preview it with \`rip check --strict\`)`));
  }
  if (hiddenUninstalled > 0) {
    const dirs = [...hiddenUninstalledDirs].sort();
    const shown = dirs.slice(0, 3).join(', ') + (dirs.length > 3 ? ` and ${dirs.length - 3} more` : '');
    console.log(dim(`${hiddenUninstalled} uninstalled-dependency import${plural(hiddenUninstalled)} hidden `
      + `— run \`bun install\` in ${shown}`));
  }
  if (hiddenMissingTypes > 0) {
    const names = [...missingTypeNames].sort();
    const shown = names.slice(0, 4).map((n) => `\`${n}\``).join(', ');
    const more = names.length > 4 ? ` and ${names.length - 4} more` : '';
    const about = names.length ? ` — no declarations for ${shown}${more}` : '';
    // Named projects earn the deictic — and only when the count is WHOLLY
    // theirs: with none shown the missing declarations are the home
    // project's own, and a count the home project shares must not send
    // the install elsewhere.
    const where = inProjects(hiddenMissingTypesDirs);
    const wholly = where !== '' && !hiddenMissingTypesDirs.has('.');
    console.log(dim(`${hiddenMissingTypes} missing-types advisor${hiddenMissingTypes === 1 ? 'y' : 'ies'} hidden${where}`
      + `${about} (try \`bun add -d @types/bun\`${wholly ? ' there' : ''})`));
  }
  // A forced posture says so: a `--strict` report is otherwise
  // indistinguishable from a package failing its own gate.
  if (forceStrict) console.log(dim('checked under --strict — every package in the workspace read as if it set `rip.strict`; the posture on disk was not applied'));
}

// Exit: 1 on type errors; 2 when the run could not cover what was asked —
// tsgo never started, or a file could not be read / pulled (never a clean 0
// on incomplete coverage); else 0.
process.exit(errorCount > 0 ? 1 : ((tsgoUnavailable || incompleteCheck) ? 2 : 0));
