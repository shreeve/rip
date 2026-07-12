// The type-audit — a PROGRESS GAUGE (not a pass/fail gate): a
// categorized scoreboard over the fixtures. Each fixture is scored on
// independent dimensions, and every failure is categorized so the
// number tells you WHERE the type story stands.
//
//   bun run type-audit                  # the Type Audit (dims 1–5), the default
//   bun run type-audit --hover          # the Hover Audit ONLY (slower; drives LSP servers)
//   bun run type-audit --all            # both audits
//   bun run type-audit --v              # + list the expected hover divergences
//   bun run type-audit --update-hovers  # re-pin expected hovers (verify the change first)
//
// Two independent audits:
//
// A · THE TYPE AUDIT — a per-fixture grid over five dimensions:
//   1 compiles     rip --ts produces a face           (else: compiler-coverage gap)
//   2 directives   face carries all @ts-expect-error  (else: face-emission bug)
//   3 verdict      the editor server publishes ZERO Error-severity
//                  diagnostics — every intended error is
//                  @ts-expect-error-suppressed, none stray
//                                                     (else: type-face divergence)
//   4 runtime      rip <fixture> stdout == bun <twin> stdout
//                                                     (else: behavioral divergence)
//   5 twin         the .ts/.tsx companion type-checks under the strict
//                  tsconfig                           (else: reference twin invalid)
//
// B · THE HOVER AUDIT (--hover / --all) — hover every top-level
//   declaration through the editor server and judge each answer against
//   the best available reference:
//
//   · TWIN ORACLE (correctness): where the hand-written .ts/.tsx twin
//     declares the same symbol, tsgo's hover of the twin is the ACTUAL
//     TypeScript answer — the editor's hover should match it (modulo
//     quote style, binding keyword, and union-member order, which carry
//     no type meaning). Rip-native constructs (component / schema /
//     reactive) are EXPECTED divergences — the twin approximates them
//     with a different system (React / zod), so it is not an oracle
//     there.
//   · EXPECTED HOVERS (correctness baseline): every symbol the twin
//     CANNOT validate — rip-native (component/schema/reactive) and any
//     symbol with no twin — is pinned in hover-pins.json, seeded
//     from values certified against the v3 oracle. The live hover must
//     match its expected value. `--update-hovers` re-pins, but VERIFY
//     the change is correct first: this is a correctness baseline, not a
//     photo of whatever the editor emitted. Twin-checked symbols are NOT
//     pinned here — the twin validates them live, and pinning raw text
//     would flag harmless changes (union-member order) it normalizes
//     away. (The write-only-`any` class is caught for ALL symbols by the
//     oracle-free invariant below.)
//
// The verdict (dim 3) runs under STRICT because tsgo (TS7) defaults
// strict:true ON. The runner still copies tsconfig.json into the editor
// workspace to PIN that posture explicitly and add the fixtures' other
// options (moduleDetection/jsx/skipLibCheck), and to drive dim 5.
//
// The fixtures self-check: a `# @ts-expect-error` marks a line that
// MUST error. If the face + tsgo satisfy every marker and add none,
// the editor publishes nothing — that is dimension 3 passing.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { LspClient, tsgoBinaryPath, startTsgo } from '../../packages/vscode/src/tsgo.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const RIP = path.join(ROOT, 'bin/rip');
const SERVER = path.join(ROOT, 'packages/vscode/src/server.js');
const FIX = path.join(HERE, 'fixtures');
const HOVERS = path.join(HERE, 'hover-pins.json');
const VERBOSE = process.argv.includes('--v');
const UPDATE_HOVERS = process.argv.includes('--update-hovers');
// Run selection:
//   (no flag)  the Type Audit (dims 1–5) — fast, the default
//   --hover    the Hover Audit ONLY (drives LSP servers; slower)
//   --all      both
const RUN_HOVER = process.argv.includes('--hover') || process.argv.includes('--all') || UPDATE_HOVERS;
const RUN_MAIN = !(process.argv.includes('--hover') || UPDATE_HOVERS) || process.argv.includes('--all');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Temp workspaces are removed by each server's stop(); this registry is
// the backstop — it clears them on normal exit, an uncaught error, or
// Ctrl-C, so nothing leaks.
const TEMP_DIRS = new Set();
const mkTemp = (base) => { const d = fs.mkdtempSync(base); TEMP_DIRS.add(d); return d; };
const cleanupTemp = () => { for (const d of TEMP_DIRS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } TEMP_DIRS.clear(); };
process.on('exit', cleanupTemp);
process.on('SIGINT', () => { cleanupTemp(); process.exit(130); });

// Count REAL directives only — comment-start position, the emitter's
// own rule (a prose comment that merely MENTIONS "@ts-expect-error" is
// not a directive in either surface).
const countDirectives = (text) => (text.match(/^[ \t]*(?:#|\/\/)[ \t]*@ts-expect-error(?=\s|$)/gm) ?? []).length;

// ── dimension 1: compiles (+ capture the face for dimension 2)
function dimCompiles(ripPath) {
  try {
    const face = execFileSync('bun', [RIP, '--ts', ripPath], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, face };
  } catch (err) {
    const msg = (err.stderr || err.stdout || err.message || '').toString().split('\n').find((l) => l.trim()) ?? 'compile failed';
    return { ok: false, detail: msg.trim() };
  }
}

// ── dimension 5: twin type-check — run tsgo ONCE over the fixtures
// under tsconfig.json (strict), then attribute errors per twin.
function runTwinTsc() {
  let tsc;
  try { tsc = tsgoBinaryPath(); } catch { return null; } // no tsgo installed
  let out = '';
  try { out = execFileSync(tsc, ['--noEmit', '-p', path.join(HERE, 'tsconfig.json')], { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (err) { out = (err.stdout || '').toString() + (err.stderr || '').toString(); } // tsc exits non-zero when it finds errors
  const byFile = new Map();
  for (const line of out.split('\n')) {
    const m = /([\w-]+\.tsx?)\(\d+,\d+\): error (TS\d+)/.exec(line);
    if (!m) continue;
    if (!byFile.has(m[1])) byFile.set(m[1], []);
    byFile.get(m[1]).push(line.trim());
  }
  return byFile;
}
function dimTwin(twinBase, byFile) {
  if (byFile === null) return { status: 'skip', detail: 'tsgo not found — bun install in packages/vscode' };
  const errs = byFile.get(twinBase) ?? [];
  if (errs.length === 0) return { status: 'pass' };
  if (errs.some((e) => /Cannot find module '(react|react-dom|dayjs|zod|zustand)/.test(e)))
    return { status: 'skip', detail: 'needs deps (bun install in test/type-audit/)' };
  return { status: 'fail', detail: `${errs.length} type error(s)`, errs };
}

// ── dimension 4: runtime parity (run .rip via rip, the twin via bun,
// diff stdout). bun executes .ts and .tsx alike — a .tsx twin's JSX is
// define-only at module scope (nothing renders without a DOM), so both
// modules must load, run their top level, and print identical bytes.
function runOut(cmd, file) {
  try { return { ok: true, out: execFileSync(cmd[0], [...cmd.slice(1), file], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (err) { return { ok: false, out: (err.stdout || '').toString(), detail: (err.stderr || err.message || '').toString().split('\n')[0] }; }
}
function dimRuntime(ripPath, tsPath) {
  if (!tsPath) return { status: 'n/a', detail: 'no twin' };
  const r = runOut(['bun', RIP], ripPath);
  const t = runOut(['bun'], tsPath);
  if (!r.ok || !t.ok) return { status: 'skip', detail: `run error (${r.ok ? 'ts' : 'rip'}): ${(r.detail || t.detail || '').slice(0, 80)}` };
  return { status: r.out === t.out ? 'pass' : 'fail', detail: r.out === t.out ? '' : 'stdout differs' };
}

// ── hover machinery ──────────────────────────────────────────────────
const attachHandlers = (c) => {
  c.onServerRequest('workspace/configuration', (p) => (p.items ?? []).map(() => ({})));
  c.onServerRequest('client/registerCapability', () => null);
  c.onServerRequest('client/unregisterCapability', () => null);
  c.onServerRequest('window/workDoneProgress/create', () => null);
};
// The bare type text, for pinning and comparison.
const normHover = (h) => {
  if (!h) return null;
  const raw = typeof h.contents === 'string' ? h.contents
    : (h.contents?.value ?? (Array.isArray(h.contents) ? h.contents.map((c) => c.value ?? c).join('\n') : ''));
  return raw.replace(/```typescript\n?/g, '').replace(/```/g, '').replace(/\s+/g, ' ').trim() || null;
};
// Top-level declarations: a name at column 0, optionally after a leading
// export/def/class/interface/enum/type keyword. Heuristic, not a parser.
const DECL = /^(?:export\s+)?(?:(def|class|interface|enum|type)\s+)?([A-Za-z_$][\w$]*)/;
const KEYWORDS = new Set(['import', 'return', 'if', 'unless', 'for', 'while', 'export', 'switch', 'try', 'throw']);
function declsOf(src) {
  const out = [];
  src.split('\n').forEach((text, line) => {
    if (/^\s*#/.test(text) || !text.trim() || /^\s/.test(text)) return;
    const m = text.match(DECL);
    if (!m || KEYWORDS.has(m[2])) return;
    const keyword = m[1], name = m[2];
    // Only actual DECLARATIONS, not usage statements. A keyword form
    // (def/class/…) always declares. A bare name declares only when its
    // next token is an assignment / annotation / reactive operator
    // (= : := ~= ~>); a name followed by `.`/`(`/`[` is a usage
    // (console.log(…)) — which the old heuristic wrongly probed.
    if (!keyword) {
      const after = text.slice(text.indexOf(name) + name.length);
      if (!/^!?\s*(?:<[^>]*>)?\s*(?:~[=>]|[:=])/.test(after)) return;
    }
    out.push({ name, line, character: text.indexOf(name), text: text.trim() });
  });
  return out;
}
// Twin (.ts/.tsx) top-level declarations. TS names its bindings AFTER a
// keyword (`function`/`const`/`let`/`var` as well as class/interface/
// enum/type), so the rip-shaped regex would capture the keyword itself.
// This variant captures the bound identifier so a rip decl can be
// matched to its twin by (name, occurrence) — occurrence keeps
// same-named rows distinct.
const TS_DECL = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|enum|type)\s+([A-Za-z_$][\w$]*)/;
function tsDeclsOf(src) {
  const out = [];
  src.split('\n').forEach((text, line) => {
    if (/^\s/.test(text) || !text.trim()) return;
    const m = text.match(TS_DECL);
    if (!m) return;
    out.push({ name: m[1], line, character: text.indexOf(m[1], m[0].length - m[1].length) });
  });
  return out;
}

// The editor server: diagnostics for the verdict, hover probes for the
// hover audit — over a shared workspace holding every fixture under its
// real name (cross-file imports resolve; idle siblings never join the
// program, so they don't collide).
class EditorServer {
  constructor() { this.diags = new Map(); this.dir = mkTemp(path.join(os.tmpdir(), 'rip-audit-')); }
  async start() {
    for (const f of fs.readdirSync(FIX)) if (f.endsWith('.rip')) fs.copyFileSync(path.join(FIX, f), path.join(this.dir, f));
    const tscfg = path.join(HERE, 'tsconfig.json');
    if (fs.existsSync(tscfg)) fs.copyFileSync(tscfg, path.join(this.dir, 'tsconfig.json'));
    this.client = new LspClient('bun', [SERVER, '--stdio'], {
      cwd: path.join(ROOT, 'packages/vscode'),
      onNotification: (m, p) => { if (m === 'textDocument/publishDiagnostics') this.diags.set(p.uri, p.diagnostics); },
    });
    attachHandlers(this.client);
    await this.client.request('initialize', { processId: process.pid, rootUri: 'file://' + this.dir, capabilities: { workspace: { configuration: true } } });
    this.client.notify('initialized', {});
  }
  // Diagnostics settle on the FIRST publish (~150ms); the server
  // re-publishes later with identical (post-filter) content, so a short
  // settle after the first publish is enough for the verdict.
  async verdict(base, src) {
    const uri = 'file://' + path.join(this.dir, base);
    this.diags.delete(uri);
    this.client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'rip', version: 1, text: src } });
    for (let i = 0; i < 60 && !this.diags.has(uri); i++) await sleep(100);
    await sleep(500);
    const ds = this.diags.get(uri) ?? [];
    this.client.notify('textDocument/didClose', { textDocument: { uri } });
    await sleep(300);
    return ds;
  }
  // Hovers need a LONGER settle than the verdict: evolving `let`s type
  // through an async pass, so an early hover answers `any`.
  async openForHover(base, src) {
    const uri = 'file://' + path.join(this.dir, base);
    this.diags.delete(uri);
    this.client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'rip', version: 1, text: src } });
    for (let i = 0; i < 60 && !this.diags.has(uri); i++) await sleep(100);
    await sleep(1800);
    return uri;
  }
  // Hover; if `any`, re-hover after a pause. A timing `any` resolves; a
  // genuine write-only `any` stays. Separates the two without bias.
  async hover(uri, pos) {
    let h = await this.client.request('textDocument/hover', { textDocument: { uri }, position: pos }).catch(() => null);
    if (/(?:^|:\s*)any$/.test(normHover(h) ?? '')) {
      await sleep(1200);
      h = await this.client.request('textDocument/hover', { textDocument: { uri }, position: pos }).catch(() => null);
    }
    return normHover(h);
  }
  async close(uri) {
    this.client.notify('textDocument/didClose', { textDocument: { uri } });
    await sleep(300);
  }
  async stop() { await this.client.stop().catch(() => {}); fs.rmSync(this.dir, { recursive: true, force: true }); }
}

// The tsgo-twin oracle: hover the hand-written .ts/.tsx twin through a
// raw tsgo LSP — the ACTUAL TypeScript answer, uncorrupted by any
// mapping layer. Returns a Map keyed `name#occurrence` → hover text so
// a rip hover row can look up what TS itself shows for the same
// declaration.
class TwinOracle {
  async start() {
    const { client } = await startTsgo(HERE, {
      serverRequests: {
        'workspace/configuration': (p) => (p.items ?? []).map(() => ({})),
        'client/registerCapability': () => null,
        'client/unregisterCapability': () => null,
        'window/workDoneProgress/create': () => null,
      },
    });
    this.client = client;
  }
  async hoverTwin(twinPath) {
    const src = fs.readFileSync(twinPath, 'utf8');
    const uri = 'file://' + twinPath;
    const languageId = twinPath.endsWith('.tsx') ? 'typescriptreact' : 'typescript';
    this.client.notify('textDocument/didOpen', { textDocument: { uri, languageId, version: 1, text: src } });
    await sleep(2000); // let the program load before probing
    const decls = tsDeclsOf(src);
    const hovers = await Promise.all(decls.map((d) => this.client.request('textDocument/hover', {
      textDocument: { uri }, position: { line: d.line, character: d.character },
    }).catch(() => null)));
    const out = new Map();
    const occ = new Map();
    decls.forEach((d, i) => {
      const k = occ.get(d.name) ?? 0; occ.set(d.name, k + 1);
      out.set(`${d.name}#${k}`, normHover(hovers[i]));
    });
    this.client.notify('textDocument/didClose', { textDocument: { uri } });
    await sleep(200);
    return out;
  }
  async stop() { await this.client.stop().catch(() => {}); }
}

// No-oracle invariant: an initialized binding (`name = expr`) whose RHS
// is not itself `: any` must not hover as `any`.
const invariantHit = (r) =>
  /^(?:export\s+)?[A-Za-z_$][\w$]*\s*=\s*\S/.test(r.text) && !/:\s*any\b/.test(r.text)
  && /(?:^|:\s*)any$/.test(r.hover ?? '');

// ── run
const fixtures = fs.readdirSync(FIX).filter((f) => f.endsWith('.rip')).sort();
// ── shared presentation helpers
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => paint('1', s);
const dim = (s) => paint('2', s);
const green = (s) => paint('32', s);
const red = (s) => paint('31', s);
const yellow = (s) => paint('33', s);
const pad = (s, n) => String(s).padEnd(n);
const auditBanner = (title, subtitle) =>
  console.log(`\n  ${paint('36', '❯')} ${bold(title)}${subtitle ? '   ' + dim(subtitle) : ''}`);

const editor = new EditorServer();
await editor.start();

// ── the Type Audit (dims 1–5) — the default; skipped by --hover
let totalPass = 0, totalApplicable = 0, fails = 0;
if (RUN_MAIN) {
  const glyph = { pass: ['✓', green('✓')], fail: ['✗', red('✗')], skip: ['skip', yellow('skip')], '—': ['·', dim('·')], 'n/a': ['·', dim('·')] };
  const cell = (s, n) => { const [v, col] = glyph[s] ?? [String(s), dim(String(s))]; return col + ' '.repeat(Math.max(0, n - v.length)); };
  const dims = [['compiles', 10], ['directives', 12], ['verdict', 10], ['runtime', 9], ['twin', 8]];
  const ruleW = 18 + 1 + dims.reduce((a, [, w]) => a + w, 0) + (dims.length - 1);

  // Print the header immediately, then stream each fixture's row as it
  // is computed, so the report fills in live.
  auditBanner('TYPE AUDIT', `${fixtures.length} fixtures × ${dims.length} dimensions`);
  console.log('');
  console.log('  ' + dim(pad('fixture', 18) + ' ' + dims.map(([d, w]) => pad(d, w)).join(' ')));
  console.log('  ' + dim('─'.repeat(ruleW)));

  const twinByFile = runTwinTsc(); // one strict tsc pass over all twins

  const rows = [];
  for (const f of fixtures) {
    const ripPath = path.join(FIX, f);
    const twinBase = ['.tsx', '.ts'].map((e) => f.replace(/\.rip$/, e)).find((b) => fs.existsSync(path.join(FIX, b)));
    const src = fs.readFileSync(ripPath, 'utf8');

    const c = dimCompiles(ripPath);
    const row = { name: f, compiles: c.ok ? 'pass' : 'fail', compileDetail: c.detail };

    if (c.ok) {
      const sd = countDirectives(src), fd = countDirectives(c.face);
      row.directives = sd === fd ? 'pass' : 'fail';
      row.dirDetail = sd === fd ? `${fd}` : `src=${sd} face=${fd} (lost ${sd - fd})`;

      // Count ERROR-severity only. Unused-local and deprecation arrive
      // as Hint severity (fade/strikethrough, not a type error) and are
      // expected on the fixtures' intentionally-unused bindings.
      const ds = (await editor.verdict(f, src)).filter((d) => (d.severity ?? 1) <= 2);
      row.verdict = ds.length === 0 ? 'pass' : 'fail';
      row.verdictDetail = ds.length === 0 ? '0 errors' : `${ds.length} unexpected`;
      row.diags = ds;

      const rt = dimRuntime(ripPath, twinBase ? path.join(FIX, twinBase) : null);
      row.runtime = rt.status;
      row.runtimeDetail = rt.detail;
    } else {
      row.directives = row.verdict = row.runtime = '—';
    }

    const tw = twinBase ? dimTwin(twinBase, twinByFile) : { status: 'n/a', detail: 'no twin' };
    row.twin = tw.status;
    row.twinDetail = tw.detail;
    row.twinErrs = tw.errs;

    console.log(`  ${pad(row.name, 18)} ${dims.map(([d, w]) => cell(row[d], w)).join(' ')}`); // stream the row live
    rows.push(row);
  }

  console.log(`\n  ${bold('Failures')} ${dim('(categorized)')}`);
  let any = false;
  for (const r of rows) {
    const notes = [];
    if (r.compiles === 'fail') notes.push([yellow('compiler-coverage gap'), r.compileDetail]);
    if (r.directives === 'fail') notes.push([red('face-emission bug'), `directives ${r.dirDetail}`]);
    if (r.verdict === 'fail') notes.push([red('type-face divergence'), r.verdictDetail]);
    if (r.runtime === 'fail') notes.push([red('behavioral divergence'), r.runtimeDetail]);
    if (r.twin === 'fail') notes.push([red('reference twin invalid'), r.twinDetail]);
    if (notes.length) {
      any = true;
      console.log(`    ${bold(r.name)}`);
      for (const [label, detail] of notes) console.log(`      ${dim('·')} ${label} ${dim('— ' + detail)}`);
      // A failure always shows its evidence — no flag needed to learn WHY.
      if (r.diags?.length) for (const d of r.diags) console.log(dim(`          ${d.range.start.line}:${d.range.start.character} [TS${d.code}] ${d.message}`));
      if (r.twinErrs?.length) for (const e of r.twinErrs) console.log(dim(`          twin: ${e}`));
    }
  }
  if (!any) console.log('    ' + green('none'));

  console.log(`\n  ${bold('Score')} ${dim('(pass / applicable)')}`);
  for (const [d] of dims) {
    const pass = rows.filter((r) => r[d] === 'pass').length;
    const applicable = rows.filter((r) => r[d] === 'pass' || r[d] === 'fail').length;
    totalPass += pass; totalApplicable += applicable;
    const ratio = `${pass} / ${applicable}`;
    console.log(`    ${pad(d, 12)} ${pass === applicable ? green(ratio) : pass === 0 ? red(ratio) : yellow(ratio)}`);
  }
  fails = totalApplicable - totalPass;
}

// ── the Hover Audit: twin oracle (correctness) + expected hovers (baseline)
let hp = null;
if (RUN_HOVER) {
  auditBanner('HOVER AUDIT', `twin oracle + expected hovers · ${fixtures.length} files`);
  let twin = null;
  try { twin = new TwinOracle(); await twin.start(); } catch { twin = null; }
  if (!twin) console.log(`    ${dim('tsgo unavailable — twin oracle skipped; hover-pins comparison still runs')}`);

  const pinned = fs.existsSync(HOVERS) ? JSON.parse(fs.readFileSync(HOVERS, 'utf8')) : null;
  const allRows = [];
  let hskip = 0, anyCount = 0, probeCount = 0;

  for (const f of fixtures) {
    const full = path.join(FIX, f);
    const src = fs.readFileSync(full, 'utf8');
    try { execFileSync('bun', [RIP, '--ts', full], { timeout: 30000, stdio: 'ignore' }); }
    catch { console.log(`    ${dim(`skip ${f} — does not compile (no face to probe)`)}`); hskip++; continue; }

    // Probe the editor server and the tsgo twin concurrently — they are
    // independent servers, so the twin's settle overlaps the editor's.
    const twinBase = twin ? ['.tsx', '.ts'].map((e) => f.replace(/\.rip$/, e)).find((b) => fs.existsSync(path.join(FIX, b))) : null;
    const decls = declsOf(src);
    const [uri, tmap] = await Promise.all([
      editor.openForHover(f, src),
      twinBase ? twin.hoverTwin(path.join(FIX, twinBase)).catch(() => null) : Promise.resolve(null),
    ]);
    const hovers = [];
    for (const d of decls) hovers.push(await editor.hover(uri, { line: d.line, character: d.character }));
    await editor.close(uri);

    const occ = new Map();
    decls.forEach((d, i) => {
      const k = occ.get(d.name) ?? 0; occ.set(d.name, k + 1);
      allRows.push({ ...d, hover: hovers[i], ts: tmap ? (tmap.get(`${d.name}#${k}`) ?? null) : null, file: f });
      probeCount++;
      if (/(?:^|:\s*)any$/.test(hovers[i] ?? '')) anyCount++;
    });
  }

  if (twin) await twin.stop();

  // ── twin-oracle comparison. Cosmetic normalization — differences that
  // carry no type meaning must not surface as gaps: string-literal
  // quote style (tsgo echoes the twin's single quotes; the face emits
  // double) and the binding keyword (`let` where a twin authored
  // `const` — the same type either way). Union member ORDER is a
  // presentation choice (the hover mirrors declaration order; tsgo
  // sorts): the same member SET in a different order is the same type.
  const unionMembers = (t) => {
    const s = (t ?? '').replace(/^.*?(?::|=)\s*/, '');
    const parts = [];
    let depth = 0, cur = '';
    for (const c of s) {
      if ('<([{'.includes(c)) depth++;
      else if ('>)]}'.includes(c)) depth--;
      if (c === '|' && depth === 0) { parts.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    parts.push(cur.trim());
    return parts.filter((p) => p !== '');
  };
  const canon = (s) => s == null ? null
    : s.replace(/'([^']*)'/g, '"$1"').replace(/^(?:export\s+)?(?:let|const|var)\s+/, '').trim();
  const unionSet = (s) => {
    const parts = unionMembers(canon(s) ?? '');
    return parts.length > 1 ? [...parts].map((x) => x.trim()).sort().join(' | ') : null;
  };
  const eq = (a, b) => canon(a) === canon(b);
  const eqType = (a, b) => { if (eq(a, b)) return true; const ka = unionSet(a); return ka != null && ka === unionSet(b); };

  // A rip-NATIVE construct — component / schema / reactive — has no
  // TS-language equivalent, so the hand-written twin approximates it
  // with a DIFFERENT system (React / zod / plain callbacks). The twin's
  // hover is therefore not a valid oracle there: these are EXPECTED
  // divergences, not gaps.
  //
  // HEURISTIC (source-text, not resolved): a schema INSTANCE is spotted
  // by a `.parse()` on a Capitalized receiver, excluding JSON/Date.
  // Erring here HIDES a gap, so keep it as narrow as the fixtures allow.
  const ripNative = (r) => {
    const t = r.text ?? '';
    return /=\s*component\b/.test(t)
      || /=\s*schema\b/.test(t)
      || /\b(?!JSON\b|Date\b)[A-Z]\w*\.parse(?:Async)?\s*\(/.test(t)
      || /~>|~=|:=/.test(t);
  };

  // Outcomes per probe, twin side:
  //   agree        hover matches the twin's tsgo answer
  //   gap          hover ≠ tsgo twin on a COMPARABLE type — the actionable bucket
  //   rip-native   component / schema / reactive — the twin is not an oracle there
  //   pinned-only  no twin symbol — hover-pins alone covers it
  const tally = { agree: 0, gap: 0, native: 0, pinnedOnly: 0, order: 0 };
  const gaps = [], natives = [], pinnedOnly = [];
  for (const r of allRows) {
    if (r.ts != null) {
      if (eqType(r.hover, r.ts)) {
        tally.agree++;
        if (!eq(r.hover, r.ts)) tally.order++; // agreed modulo union order
      } else if (ripNative(r)) { tally.native++; natives.push(r); }
      else { tally.gap++; gaps.push(r); }
    } else if (ripNative(r)) { tally.native++; natives.push(r); }
    else { tally.pinnedOnly++; pinnedOnly.push(r); }
  }
  const violations = allRows.filter(invariantHit).map((r) => `${r.file}:${r.line + 1} ${r.name} (${r.text}) → \`${r.hover}\``);

  // ── hover-pins comparison — the pinned file covers ONLY what the
  // twin can't validate live (rip-native + no-twin). Twin-checked symbols
  // are judged by the twin oracle every run; pinning their raw text would
  // flag harmless changes (union order) the twin normalizes away.
  const twinCovered = (r) => r.ts != null && !ripNative(r);
  const liveScoped = {};
  let pinnedCount = 0;
  for (const r of allRows) {
    if (twinCovered(r)) continue;
    (liveScoped[r.file] ??= {})[`${r.name}@${r.line + 1}`] = r.hover;
    pinnedCount++;
  }
  let snapChanged = [];
  if (UPDATE_HOVERS || pinned === null) {
    fs.writeFileSync(HOVERS, JSON.stringify(liveScoped, null, 2) + '\n');
  } else {
    for (const f of Object.keys({ ...pinned, ...liveScoped })) {
      const want = pinned[f] ?? {}, got = liveScoped[f] ?? {};
      for (const k of new Set([...Object.keys(want), ...Object.keys(got)])) {
        if ((want[k] ?? null) !== (got[k] ?? null)) snapChanged.push(`${f} ${k}: ${JSON.stringify(want[k] ?? null)} → ${JSON.stringify(got[k] ?? null)}`);
      }
    }
  }

  const probed = allRows.length;
  console.log(`\n  ${bold('Parity')} ${dim(`(${probed} probes${hskip ? `, ${hskip} file(s) skipped` : ''})`)}`);
  const prow = (label, n, color, note) => console.log(`    ${pad(label, 12)} ${color(String(n).padStart(3))}${note ? '   ' + dim(note) : ''}`);
  prow('agree', tally.agree, green, tally.order ? `incl. ${tally.order} union-order` : '');
  prow('gaps', tally.gap, tally.gap ? yellow : green, tally.gap ? 'hover ≠ tsgo twin on a comparable type' : '');
  prow('rip-native', tally.native, dim, 'component / schema / reactive — twin uses React/zod, no oracle');
  prow('pinned-only', tally.pinnedOnly, dim, 'no twin symbol — covered by hover-pins');
  prow('expected', snapChanged.length, snapChanged.length ? red : green,
    UPDATE_HOVERS || pinned === null ? 'updated' : (snapChanged.length ? 'changed vs hover-pins.json' : `${pinnedCount} pinned, unchanged`));
  prow('invariant', violations.length, violations.length ? red : green, violations.length ? 'initialized binding hovers `any`' : '');

  if (gaps.length) {
    console.log(`\n    ${bold('Gaps — hover ≠ tsgo twin on a comparable type')} ${dim('(after quote / keyword / union-order normalization)')}`);
    for (const r of gaps) {
      console.log(`      ${yellow('✗')} ${bold(r.name)} ${dim(`@ ${r.file}:${r.line + 1}`)}  ${dim(`(${r.text})`)}`);
      console.log(`          ${dim('tsgo')} ${green(r.ts)}`);
      console.log(`          ${dim('rip ')} ${yellow(r.hover)}`);
    }
  }
  if (snapChanged.length) {
    console.log(`\n    ${bold('Expected-hover changes')} ${dim('(--update-hovers re-pins them — verify correctness first)')}`);
    for (const c of snapChanged.slice(0, VERBOSE ? Infinity : 10)) console.log(`      ${red('✗')} ${dim(c)}`);
    if (snapChanged.length > 10 && !VERBOSE) console.log(`      ${dim(`… ${snapChanged.length - 10} more (--v for all)`)}`);
  }
  if (violations.length) {
    console.log(`\n    ${bold('Invariant violations')}`);
    for (const v of violations) console.log(`      ${red('✗')} ${dim(v)}`);
  }
  if (VERBOSE) for (const [label, rowset] of [['rip-native (expected divergences — twin uses React/zod)', natives], ['pinned-only (no twin symbol)', pinnedOnly]]) {
    if (!rowset.length) continue;
    console.log(`\n    ${dim(label)}`);
    for (const r of rowset) {
      console.log(`      ${green('•')} ${bold(r.name)} ${dim(`@ ${r.file}:${r.line + 1}`)}  ${dim(`(${r.text})`)}`);
      if (r.ts != null) console.log(`          ${dim('tsgo')} ${dim(r.ts)}`);
      console.log(`          ${dim('rip ')} ${dim(r.hover)}`);
    }
  }

  const typedRatio = `${probeCount - anyCount} / ${probeCount}`;
  console.log(`\n  ${bold('Gauge')} ${dim('(hover probes answering a real type, not `any` — keep this full)')}`);
  console.log(`    ${pad('typed hovers', 12)} ${anyCount === 0 ? green(typedRatio) : yellow(typedRatio)}`);

  hp = { probed, gap: tally.gap, snapChanged: snapChanged.length, violations };
}

await editor.stop();

// ── combined totals
console.log(`\n  ${bold('Totals')}`);
if (RUN_MAIN) console.log('    ' + (fails === 0
  ? green(`${totalApplicable} dimension checks: all passing`)
  : `${totalApplicable} dimension checks: ${green(totalPass + ' passing')}, ${red(fails + ' failing')}`));
if (hp) console.log('    ' + `${hp.probed} hover probes: `
  + (hp.gap === 0 && hp.snapChanged === 0 && hp.violations.length === 0
    ? green('twin parity + expected clean')
    : `${hp.gap ? yellow(hp.gap + ' twin gap' + (hp.gap === 1 ? '' : 's')) : green('0 twin gaps')}, ${hp.snapChanged ? red(hp.snapChanged + ' expected change' + (hp.snapChanged === 1 ? '' : 's')) : green('expected clean')}${hp.violations.length ? `, ${red(hp.violations.length + ' invariant hit' + (hp.violations.length === 1 ? '' : 's'))}` : ''}`));
console.log('');
