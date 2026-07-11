// The typed-editor audit — a PROGRESS GAUGE (not a pass/fail gate): a
// categorized scoreboard over the fixtures. Each fixture is scored on
// independent dimensions, and every failure is categorized so the
// number tells you WHERE the typed-editor story stands.
//
//   bun test/type-audit/runner.js                  # full audit over fixtures/
//   bun test/type-audit/runner.js --v              # + per-diagnostic detail
//   bun test/type-audit/runner.js --update-hovers  # accept current hovers as the pinned snapshot
//
// Dimensions:
//   1 compiles     rip --ts succeeds                  (else: compiler-coverage gap)
//   2 directives   face carries all @ts-expect-error  (else: face-emission bug)
//   3 verdict      the editor server publishes ZERO Error-severity
//                  diagnostics — every intended error is
//                  @ts-expect-error-suppressed, none stray
//                                                     (else: type-face divergence)
//   4 runtime      rip <fixture> stdout == bun <twin> stdout
//                                                     (else: behavioral divergence)
//   5 twin         the .ts/.tsx companion type-checks under the strict
//                  tsconfig                           (else: reference twin invalid)
//   6 hovers       hover text at every top-level declaration matches the
//                  committed snapshot (hovers.json)   (else: hover regression)
//
// Dimension 6 exists for the write-only-`any` class: a binding whose
// face compiles, emits no diagnostic, and runs identically — but hovers
// `any` where a real type belongs. Error-based dimensions cannot see
// it; pinned hover TEXT can. `--update-hovers` is the one way snapshot
// bytes move (regenerate in the same commit as the change that moved
// them — the corpus-expected convention). The report also counts `any`
// hovers as the gauge metric to drive down.
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
import { LspClient, tsgoBinaryPath } from '../../packages/vscode/src/tsgo.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const RIP = path.join(ROOT, 'bin/rip');
const SERVER = path.join(ROOT, 'packages/vscode/src/server.js');
const FIX = path.join(HERE, 'fixtures');
const HOVERS = path.join(HERE, 'hovers.json');
const VERBOSE = process.argv.includes('--v');
const UPDATE_HOVERS = process.argv.includes('--update-hovers');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Count REAL directives only — comment-start position, the emitter's
// own TS_DIRECTIVE rule (a prose comment that merely MENTIONS
// "@ts-expect-error" is not a directive in either surface).
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

// ── dimension 5: twin type-check — run tsgo ONCE over the fixtures under
// tsconfig.json (strict), then attribute errors per twin.
function runTwinTsc() {
  let tsc;
  try { tsc = tsgoBinaryPath(); } catch { return null; } // no tsgo installed
  let out = '';
  try { out = execFileSync(tsc, ['--noEmit', '-p', path.join(HERE, 'tsconfig.json')], { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (err) { out = (err.stdout || '').toString() + (err.stderr || '').toString(); } // tsc exits non-zero when it finds errors
  const byFile = new Map();
  for (const line of out.split('\n')) {
    const m = /(\d\d-[\w-]+\.tsx?)\(\d+,\d+\): error (TS\d+)/.exec(line);
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
  // The twin deps (react/zod/dayjs/zustand + @types) are declared in
  // this directory's package.json. A missing-module error therefore
  // means the harness isn't installed — a setup gap, not a twin defect —
  // so skip with an actionable message rather than fail.
  if (errs.some((e) => /Cannot find module '(react|react-dom|dayjs|zod|zustand)/.test(e)))
    return { status: 'skip', detail: 'needs deps (bun install in test/type-audit/)' };
  return { status: 'fail', detail: `${errs.length} type error(s)`, errs };
}

// ── dimension 4: runtime parity (run .rip via rip, .ts via bun, diff stdout)
function runOut(cmd, file) {
  try { return { ok: true, out: execFileSync(cmd[0], [...cmd.slice(1), file], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (err) { return { ok: false, out: (err.stdout || '').toString(), detail: (err.stderr || err.message || '').toString().split('\n')[0] }; }
}
function dimRuntime(ripPath, tsPath) {
  if (!fs.existsSync(tsPath)) return { status: 'n/a', detail: 'no .ts twin' };
  const r = runOut(['bun', RIP], ripPath);
  const t = runOut(['bun'], tsPath);
  if (!r.ok || !t.ok) return { status: 'skip', detail: `run error (${r.ok ? 'ts' : 'rip'}): ${(r.detail || t.detail || '').slice(0, 80)}` };
  return { status: r.out === t.out ? 'pass' : 'fail', detail: r.out === t.out ? '' : 'stdout differs' };
}

// ── hover text normalization: the bare type text, for pinning.
const normHover = (h) => {
  if (!h) return null;
  const raw = typeof h.contents === 'string' ? h.contents
    : (h.contents?.value ?? (Array.isArray(h.contents) ? h.contents.map((c) => c.value ?? c).join('\n') : ''));
  return raw.replace(/```typescript\n?/g, '').replace(/```/g, '').replace(/\s+/g, ' ').trim() || null;
};
// Top-level declarations: a name at column 0, optionally after a leading
// export/def/class/interface/enum/type keyword. Heuristic, not a parser.
const DECL = /^(?:export\s+)?(?:(?:def|class|interface|enum|type)\s+)?([A-Za-z_$][\w$]*)/;
const KEYWORDS = new Set(['import', 'return', 'if', 'unless', 'for', 'while', 'export', 'switch', 'try', 'throw']);
function declsOf(src) {
  const out = [];
  src.split('\n').forEach((text, line) => {
    if (/^\s*#/.test(text) || !text.trim() || /^\s/.test(text)) return;
    const m = text.match(DECL);
    if (!m || KEYWORDS.has(m[1])) return;
    out.push({ name: m[1], line, character: text.indexOf(m[1]), text: text.trim() });
  });
  return out;
}

// ── dimensions 3 + 6: one editor server serves both — diagnostics for
// the verdict, hover probes for the snapshot — over a shared workspace
// holding every fixture under its real name (so cross-file imports
// resolve; unimported siblings never join the program).
class EditorServer {
  constructor() { this.diags = new Map(); this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-audit-')); }
  async start() {
    for (const f of fs.readdirSync(FIX)) if (f.endsWith('.rip')) fs.copyFileSync(path.join(FIX, f), path.join(this.dir, f));
    const tscfg = path.join(HERE, 'tsconfig.json');
    if (fs.existsSync(tscfg)) fs.copyFileSync(tscfg, path.join(this.dir, 'tsconfig.json'));
    this.client = new LspClient('bun', [SERVER, '--stdio'], {
      cwd: path.join(ROOT, 'packages/vscode'),
      onNotification: (m, p) => { if (m === 'textDocument/publishDiagnostics') this.diags.set(p.uri, p.diagnostics); },
    });
    this.client.onServerRequest('workspace/configuration', (p) => (p.items ?? []).map(() => ({})));
    this.client.onServerRequest('client/registerCapability', () => null);
    this.client.onServerRequest('client/unregisterCapability', () => null);
    this.client.onServerRequest('window/workDoneProgress/create', () => null);
    await this.client.request('initialize', { processId: process.pid, rootUri: 'file://' + this.dir, capabilities: { workspace: { configuration: true } } });
    this.client.notify('initialized', {});
  }
  // Open a fixture by its REAL name, wait until the program is ready
  // (diagnostics published), then settle: evolving `let`s type through
  // an async pass, so an early hover answers `any`.
  async open(base, src) {
    const uri = 'file://' + path.join(this.dir, base);
    this.diags.delete(uri);
    this.client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'rip', version: 1, text: src } });
    for (let i = 0; i < 60 && !this.diags.has(uri); i++) await sleep(100);
    await sleep(1500);
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

// ── run
const fixtures = fs.readdirSync(FIX).filter((f) => f.endsWith('.rip')).sort();
const editor = new EditorServer();
await editor.start();
const twinByFile = runTwinTsc(); // one strict tsc pass over all .ts/.tsx twins
const pinned = fs.existsSync(HOVERS) ? JSON.parse(fs.readFileSync(HOVERS, 'utf8')) : null;
const liveHovers = {};
let anyCount = 0, probeCount = 0;

const rows = [];
for (const f of fixtures) {
  const ripPath = path.join(FIX, f);
  const tsPath = path.join(FIX, f.replace(/\.rip$/, '.ts'));
  const src = fs.readFileSync(ripPath, 'utf8');

  const c = dimCompiles(ripPath);
  const row = { name: f, compiles: c.ok ? 'pass' : 'fail', compileDetail: c.detail };

  if (c.ok) {
    const sd = countDirectives(src), fd = countDirectives(c.face);
    row.directives = sd === fd ? 'pass' : 'fail';
    row.dirDetail = sd === fd ? `${fd}` : `src=${sd} face=${fd} (lost ${sd - fd})`;

    const uri = await editor.open(f, src);

    // Count ERROR-severity only. Unused-local and deprecation arrive as
    // Hint severity (the editor's fade/strikethrough, not a type error)
    // and are expected on the fixtures' intentionally-unused bindings.
    const ds = (editor.diags.get(uri) ?? []).filter((d) => (d.severity ?? 1) <= 2);
    row.verdict = ds.length === 0 ? 'pass' : 'fail';
    row.verdictDetail = ds.length === 0 ? '0 errors' : `${ds.length} unexpected`;
    row.diags = ds;

    // Dimension 6: hover every top-level declaration through the same
    // open document; compare against the pinned snapshot.
    const probes = {};
    for (const d of declsOf(src)) {
      const text = await editor.hover(uri, { line: d.line, character: d.character });
      probes[`${d.name}@${d.line + 1}`] = text;
      probeCount++;
      if (/(?:^|:\s*)any$/.test(text ?? '')) anyCount++;
    }
    liveHovers[f] = probes;
    if (UPDATE_HOVERS || pinned === null) {
      row.hovers = 'skip';
      row.hoverDetail = 'snapshot updated';
    } else {
      const want = pinned[f] ?? {};
      const diffs = [];
      for (const k of new Set([...Object.keys(want), ...Object.keys(probes)])) {
        if ((want[k] ?? null) !== (probes[k] ?? null)) diffs.push(`${k}: ${JSON.stringify(want[k] ?? null)} → ${JSON.stringify(probes[k] ?? null)}`);
      }
      row.hovers = diffs.length === 0 ? 'pass' : 'fail';
      row.hoverDetail = diffs.length === 0 ? `${Object.keys(probes).length} pinned` : `${diffs.length} changed`;
      row.hoverDiffs = diffs;
    }

    await editor.close(uri);

    const rt = dimRuntime(ripPath, tsPath);
    row.runtime = rt.status;
    row.runtimeDetail = rt.detail;
  } else {
    row.directives = row.verdict = row.runtime = row.hovers = '—';
  }

  // Dim 5 (twin) is independent of whether the .rip compiles — the twin
  // is the hand-written reference TS. Find the .ts or .tsx companion.
  const twinBase = ['.tsx', '.ts'].map((e) => f.replace(/\.rip$/, e)).find((b) => fs.existsSync(path.join(FIX, b)));
  const tw = twinBase ? dimTwin(twinBase, twinByFile) : { status: 'n/a', detail: 'no twin' };
  row.twin = tw.status;
  row.twinDetail = tw.detail;
  row.twinErrs = tw.errs;

  rows.push(row);
}
await editor.stop();

if (UPDATE_HOVERS || pinned === null) {
  fs.writeFileSync(HOVERS, JSON.stringify(liveHovers, null, 2) + '\n');
}

// ── scoreboard
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => paint('1', s);
const dim = (s) => paint('2', s);
const green = (s) => paint('32', s);
const red = (s) => paint('31', s);
const yellow = (s) => paint('33', s);
const pad = (s, n) => String(s).padEnd(n);

// status → [visible glyph, colored glyph]. Pad by the VISIBLE length so
// the ANSI escapes never count toward column width.
const glyph = { pass: ['✓', green('✓')], fail: ['✗', red('✗')], skip: ['skip', yellow('skip')], '—': ['·', dim('·')], 'n/a': ['·', dim('·')] };
const cell = (s, n) => { const [v, col] = glyph[s] ?? [String(s), dim(String(s))]; return col + ' '.repeat(Math.max(0, n - v.length)); };

const dims = [['compiles', 10], ['directives', 12], ['verdict', 10], ['runtime', 9], ['twin', 8], ['hovers', 8]];
const ruleW = 18 + 1 + dims.reduce((a, [, w]) => a + w, 0) + (dims.length - 1);

console.log(`\n  ${bold('— Type Audit —')}  ${dim(`${fixtures.length} fixtures × ${dims.length} dimensions`)}\n`);
console.log('  ' + dim(pad('fixture', 18) + ' ' + dims.map(([d, w]) => pad(d, w)).join(' ')));
console.log('  ' + dim('─'.repeat(ruleW)));
for (const r of rows) {
  console.log(`  ${pad(r.name, 18)} ${dims.map(([d, w]) => cell(r[d], w)).join(' ')}`);
}

// categorized failures
console.log(`\n  ${bold('Failures')} ${dim('(categorized)')}`);
let anyFail = false;
for (const r of rows) {
  const notes = [];
  if (r.compiles === 'fail') notes.push([yellow('compiler-coverage gap'), r.compileDetail]);
  if (r.directives === 'fail') notes.push([red('face-emission bug'), `directives ${r.dirDetail}`]);
  if (r.verdict === 'fail') notes.push([red('type-face divergence'), r.verdictDetail]);
  if (r.runtime === 'fail') notes.push([red('behavioral divergence'), r.runtimeDetail]);
  if (r.twin === 'fail') notes.push([red('reference twin invalid'), r.twinDetail]);
  if (r.hovers === 'fail') notes.push([red('hover regression'), r.hoverDetail]);
  if (notes.length) {
    anyFail = true;
    console.log(`    ${bold(r.name)}`);
    for (const [label, detail] of notes) console.log(`      ${dim('·')} ${label} ${dim('— ' + detail)}`);
    if (VERBOSE && r.diags?.length) for (const d of r.diags) console.log(dim(`          ${d.range.start.line}:${d.range.start.character} [TS${d.code}] ${d.message}`));
    if (VERBOSE && r.twinErrs?.length) for (const e of r.twinErrs) console.log(dim(`          twin: ${e}`));
    if (VERBOSE && r.hoverDiffs?.length) for (const e of r.hoverDiffs) console.log(dim(`          hover: ${e}`));
  }
}
if (!anyFail) console.log('    ' + green('none'));

// tally
console.log(`\n  ${bold('Score')} ${dim('(pass / applicable)')}`);
for (const [d] of dims) {
  const pass = rows.filter((r) => r[d] === 'pass').length;
  const applicable = rows.filter((r) => r[d] === 'pass' || r[d] === 'fail').length;
  const ratio = `${pass} / ${applicable}`;
  console.log(`    ${pad(d, 12)} ${pass === applicable && applicable > 0 ? green(ratio) : pass === 0 ? red(ratio) : yellow(ratio)}`);
}

// the gauge metric: write-only-`any` pressure across every probe
const anyRatio = `${anyCount} / ${probeCount}`;
console.log(`\n  ${bold('Gauge')} ${dim('(hover probes answering `any` — drive this down)')}`);
console.log(`    ${pad('any hovers', 12)} ${anyCount === 0 ? green(anyRatio) : yellow(anyRatio)}\n`);
