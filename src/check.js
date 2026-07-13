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
//   · mirror.js       — generatedTsconfig, mirror naming, closure edges
//   · diagnostics.js  — mapTsDiagnostic, rip.strict gate, @ts-expect-error
//                        (applyRipDirectives), rip.noCheck (isNoCheckPath)
//   · pins.js         — buildProbe / parseProbeHover (Tier-3 pins)
//   · translate.js    — the generated↔source mapping primitives

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compile } from './compile.js';
import { readProjectConfig } from './config.js';
import { startTsgo } from '../packages/vscode/src/tsgo.js';
import { buildProbe, parseProbeHover } from '../packages/vscode/src/pins.js';
import { mapTsDiagnostic, applyRipDirectives, isNoCheckPath, compileErrorInfo } from '../packages/vscode/src/diagnostics.js';
import { generatedTsconfig, mirrorRelForFsPath, ripImportsOf } from '../packages/vscode/src/mirror.js';
import { lineStartsOf, offsetToPosition, positionToOffset, generatedSpanToSource } from '../packages/vscode/src/translate.js';

const HELP = `rip check — type-check .rip files headlessly (the tsc --noEmit of rip-land)

Usage:
  rip check [paths...]     Type-check the given files/directories
                           (default: the current directory, recursively)

Options:
  --json                   Emit diagnostics as a JSON array instead of the
                           human-readable text report
  --no-frame               Suppress the source code-frame under each error
  --keep-mirror            Keep the generated TS mirror (.rip/check) after the
                           run instead of removing it — for inspecting the
                           exact TypeScript tsgo type-checked
  -h, --help               Show this help

Exit status is 0 when no error-severity diagnostic survives, 1 otherwise.
Directories are walked for *.rip (node_modules and dot-directories are
skipped). Config — package.json#rip (strict / noCheck) and the project
tsconfig — governs exactly as it does in the editor.`;

const fail = (message, code = 2) => { console.error(message); process.exit(code); };

// ── argument parsing ────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) { console.log(HELP); process.exit(0); }
const asJson = argv.includes('--json');
const showFrames = !argv.includes('--no-frame') && !asJson;
const keepMirror = argv.includes('--keep-mirror');
const KNOWN = new Set(['--json', '--no-frame', '--keep-mirror']);
const positionals = argv.filter((a) => !a.startsWith('-'));
const unknownFlags = argv.filter((a) => a.startsWith('-') && !KNOWN.has(a));
if (unknownFlags.length) fail(`rip check: unknown option${unknownFlags.length === 1 ? '' : 's'}: ${unknownFlags.join(', ')}\n\nRun 'rip check --help' for usage.`);

// The generated TS mirror is scratch, not a build product: it is removed
// when the process exits by ANY path (normal, error, or process.exit) —
// rmSync in an exit handler runs synchronously, so this reclaims the
// <root>/.rip/check tree AND the temp fallback without leaving either
// behind between runs. `--keep-mirror` retains it for inspecting the
// exact TypeScript tsgo checked.
let mirrorToClean = null;
let dotRipDir = null;   // <root>/.rip, pruned if the mirror left it empty
process.on('exit', () => {
  if (keepMirror || mirrorToClean === null) return;
  try { fs.rmSync(mirrorToClean, { recursive: true, force: true }); } catch { /* best effort */ }
  // Prune the .rip parent too, but only when now empty — the editor's
  // .rip/editor may share it, and rmdirSync refuses a non-empty dir, so
  // this removes .rip only when `rip check` was what created it.
  if (dotRipDir !== null) { try { fs.rmdirSync(dotRipDir); } catch { /* not empty / shared */ } }
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
function findWorkspaceRoot(files) {
  const base = commonAncestor(files);
  for (let cur = base; ; ) {
    for (const marker of ['package.json', 'tsconfig.json', '.git']) {
      if (fs.existsSync(path.join(cur, marker))) return cur;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return base;
}

const targets = collectTargets(positionals.length ? positionals : ['.']);
if (targets.length === 0) {
  if (asJson) console.log('[]');
  else console.log('rip check: no .rip files found');
  process.exit(0);
}
const workspaceRoot = findWorkspaceRoot(targets);

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
const seen = new Set();
const queue = [...targets];
while (queue.length) {
  const fsPath = queue.shift();
  if (seen.has(fsPath)) continue;
  seen.add(fsPath);
  let source;
  try { source = fs.readFileSync(fsPath, 'utf8'); }
  catch (err) {
    // Readable at collect time (statSync), not now: a permission flip, a
    // broken symlink, a race. Never silently drop it — mark the run short.
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
    source, cfg,
    good: {
      source, code: result.code, mappings: result.mappings,
      srcLineStarts, genLineStarts: lineStartsOf(result.code),
      strict: cfg.strict === true,
    },
    pinnables: result.pinnables ?? [],
  });
  for (const imp of ripImportsOf(result.stores, source, path.dirname(fsPath))) {
    if (!seen.has(imp)) queue.push(imp);
  }
}

// ── materialize the mirror + drive one tsgo session ─────────────────
const tsDiags = [];
let tsgoUnavailable = false; // tsgo needed but could not start — a run that couldn't type-check
if (compiled.size > 0) {
  // A dedicated mirror at <root>/.rip/check (peer of the editor's
  // .rip/editor), rebuilt from scratch and removed on exit (see the
  // exit handler above) — scratch, not a build product. The start-of-run
  // wipe also guards against a stale mirror a killed/`--keep-mirror` run
  // left behind, so a since-deleted source's face never lingers in the
  // `**/*.ts` program.
  let mirrorRoot = path.join(workspaceRoot, '.rip', 'check');
  let mirrorRootIsFallback = false;
  try {
    fs.rmSync(mirrorRoot, { recursive: true, force: true });
    fs.mkdirSync(mirrorRoot, { recursive: true });
    fs.writeFileSync(path.join(mirrorRoot, '.gitignore'), '*\n');
  } catch {
    mirrorRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-check-'));
    mirrorRootIsFallback = true;
  }
  mirrorToClean = mirrorRoot;
  if (!mirrorRootIsFallback) dotRipDir = path.join(workspaceRoot, '.rip');
  if (keepMirror) console.error(`rip check: keeping TS mirror at ${mirrorRoot}`);
  for (const [fsPath, entry] of compiled) {
    const rel = mirrorRelForFsPath(fsPath, mirrorRootIsFallback ? null : workspaceRoot);
    const mirrorPath = path.join(mirrorRoot, rel) + '.ts';
    entry.mirrorPath = mirrorPath;
    // Canonical (percent-encoded) URI — tsgo emits relatedInformation
    // locations in this form, so a raw `'file://' + path` key would miss
    // them whenever the path carries a space or non-ASCII char.
    entry.mirrorUri = pathToFileURL(mirrorPath).href;
    fs.mkdirSync(path.dirname(mirrorPath), { recursive: true });
    fs.writeFileSync(mirrorPath, entry.good.code);
  }
  fs.writeFileSync(
    path.join(mirrorRoot, 'tsconfig.json'),
    JSON.stringify(generatedTsconfig({ workspaceRoot, mirrorRootIsFallback }), null, 2),
  );

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
          const idm = /^[A-Za-z_$][\w$]*/.exec(lineText.slice(sp.character));
          endCharacter = sp.character + (idm ? idm[0].length : 1);
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
}

// Exit: 1 on type errors; 2 when the run could not cover what was asked —
// tsgo never started, or a file could not be read / pulled (never a clean 0
// on incomplete coverage); else 0.
process.exit(errorCount > 0 ? 1 : ((tsgoUnavailable || incompleteCheck) ? 2 : 0));
