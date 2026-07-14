// The type-audit — a PROGRESS GAUGE (not a pass/fail gate): a
// categorized scoreboard over the fixtures. Each fixture is scored on
// independent dimensions, and every failure is categorized so the
// number tells you WHERE the type story stands.
//
//   bun run type-audit                  # the Type Audit (dims 1–5), the default
//   bun run type-audit --hover          # the Hover Audit ONLY (slower; drives LSP servers)
//   bun run type-audit --token          # the Token Audit ONLY (drives the editor server)
//   bun run type-audit --all            # all three audits
//   bun run type-audit --v              # + list expected hover divergences / unasserted tokens
//   bun run type-audit --update-hovers  # re-pin expected hovers (verify the change first)
//
// Three independent audits:
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
// C · THE TOKEN AUDIT (--token / --all) — request semanticTokens/full
//   from the editor server for every fixture and judge each token that
//   lands on a top-level declaration.
//
//   Semantic tokens have an oracle the hover audit does not: THE RIP
//   SOURCE ITSELF. A declaration's form fixes what its token must be, so
//   every expectation here is DERIVED from the `.rip` file — no twin, no
//   pinned baseline, nothing that could be re-photographed from the
//   server's own answer. Like the hover audit's not-`any` invariant, this
//   check structurally cannot self-confirm.
//
//   The server (server.js `ripSemanticTokens`) forwards tsgo's tokens
//   over the FACE, remapping spans back to source but never touching the
//   type or modifier bits. A token is therefore truthful only where the
//   face's declaration keyword agrees with rip's own semantics — and
//   finding where it does NOT is the whole job.
//
//   Three invariants per declaration:
//     · present    a declared name gets a token at all (else it loses its
//                  semantic color and silently falls back to TextMate)
//     · type       the token type matches the declaring form — asserted
//                  ONLY where rip source pins it (see expectedTokenType)
//     · readonly   the `readonly` modifier is set IFF the binding is
//                  really immutable IN RIP — a rule certified against the
//                  compiler, not assumed (see READONLY_FORMS)
//
//   SCOPE: top-level DECLARATION sites — the reach of `declsOf`, a
//   column-0 heuristic. Locals, parameters, properties and USE sites are
//   not probed (a `clicks` reference in `clicks + 1` may carry the same
//   bogus `readonly`, and nothing checks it). A clean run is a statement
//   about declarations, not about every token in the corpus.
//
// Layout: fixtures/ holds typed programs 01–12, each `.rip` beside a
// hand-written `.ts`/`.tsx` twin; hover-pins.json is the Hover Audit's
// baseline for symbols the twin cannot judge. The fixtures' dependency
// sandbox (react/zod/…) lives in THIS directory's package.json, never the
// repository root's — the preflight below names what is missing.
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
import { LspClient, tsgoBinaryPath, startTsgo, decodeSemanticTokens } from '../../packages/vscode/src/tsgo.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const RIP = path.join(ROOT, 'bin/rip');
const SERVER = path.join(ROOT, 'packages/vscode/src/server.js');
const FIX = path.join(HERE, 'fixtures');
const HOVERS = path.join(HERE, 'hover-pins.json');
const ARGV = process.argv.slice(2);
// ── flags. THE COMMAND IS THE DOCUMENTATION. ALL THREE audits live in this
// table, the default one included, and it is the only place that knows an audit
// exists: --help, the unknown-flag guard, which audits run, and the closing
// "not run" footer all derive from it. So adding or renaming an audit cannot
// leave a stale copy behind — an earlier version kept the footer's flag→ran map
// by hand, and renaming `--tokens` to `--token` silently broke it: the footer
// told you to run an audit you had just run.
//
// `judge` is what an audit's answers are checked AGAINST — its evidentiary
// value, the one thing a reader most needs and is least likely to guess.
const AUDITS = [
  {
    key: 'main', flag: null, name: 'Type Audit',
    blurb: 'five dimensions per fixture: compiles, directives, verdict, runtime, twin',
    judge: 'the fixtures themselves — a `# @ts-expect-error` marks a line that MUST error,\n'
         + 'so a clean verdict means every marker fired and nothing else did',
  },
  {
    key: 'hover', flag: '--hover', name: 'Hover Audit',
    blurb: 'hover every top-level declaration through the editor server',
    judge: 'the hand-written .ts/.tsx twin (a real oracle), falling back to hover-pins.json\n'
         + 'where rip-native constructs have no twin — a baseline, so re-pin it carelessly\n'
         + 'and it will certify whatever the editor currently emits',
  },
  {
    key: 'token', flag: '--token', name: 'Token Audit',
    blurb: 'semantic token + modifiers on every top-level declaration',
    judge: 'the .rip SOURCE ITSELF — a binding\'s form fixes what its token must be, so no\n'
         + 'twin and no baseline are involved and the check cannot self-confirm',
  },
];
const FLAGS = [
  ['--all', 'all three audits'],
  ['--v', '+ expected hover divergences and unasserted tokens, in full'],
  ['--update-hovers', 're-pin expected hovers (verify the change is correct FIRST)'],
  ['--help', '-h', 'this message'],
];
// Every accepted flag: the audits' own, plus the modifiers above (a row may
// carry aliases, so take every leading `-…` token).
const KNOWN = new Set([
  ...AUDITS.map((a) => a.flag).filter(Boolean),
  ...FLAGS.flatMap((row) => row.filter((c) => c.startsWith('-'))),
]);
const usage = () => [
  'The type-audit gauge — a progress scoreboard (not a pass/fail gate) for rip\'s',
  'typed-editor story: the compiler\'s TS face plus the tsgo-brokered editor,',
  'measured over the typed fixtures in ./fixtures. Not part of `bun test`.',
  '',
  'Usage: bun run type-audit [flag]',
  '',
  `  ${'(no flag)'.padEnd(16)} the Type Audit only — fast, the default`,
  ...AUDITS.filter((a) => a.flag).map((a) => `  ${a.flag.padEnd(16)} the ${a.name} only (drives the editor server)`),
  ...FLAGS.map((row) => `  ${row.slice(0, -1).join(', ').padEnd(16)} ${row.at(-1)}`),
  '',
  'The three audits, and what each is judged against:',
  '',
  ...AUDITS.flatMap((a) => [
    `  ${a.name} (${a.flag ?? 'default'}) — ${a.blurb}`,
    ...a.judge.split('\n').map((l, i) => `    ${i === 0 ? 'judged against: ' : '                '}${l}`),
    '',
  ]),
].join('\n');
if (ARGV.includes('--help') || ARGV.includes('-h')) { console.log('\n' + usage()); process.exit(0); }
// An unknown flag must NOT fall through to the default audit and report green —
// a typo'd `--tokens` would look like a clean Token Audit that never ran.
// Suggest the nearest flag rather than just rejecting. (Spread KNOWN into an
// array: `.find` on a Set ITERATOR is an ES2025 helper, and this runs on the
// error path, where a TypeError would replace the hint with a stack trace.)
const near = (a) => [...KNOWN].find((k) => k.startsWith(a) || a.startsWith(k) || k.slice(2).startsWith(a.replace(/^-+/, '')));
const unknown = ARGV.filter((a) => a.startsWith('-') && !KNOWN.has(a));
if (unknown.length) {
  const hint = unknown.map(near).find(Boolean);
  console.error(`\n✗ Unknown flag: ${unknown.join(', ')}${hint ? ` — did you mean ${hint}?` : ''}\n\n${usage()}`);
  process.exit(1);
}
const VERBOSE = ARGV.includes('--v');
const UPDATE_HOVERS = ARGV.includes('--update-hovers');
// Which audits this run covers — computed once, ON the table, so no other site
// can disagree with it. `--update-hovers` implies the Hover Audit (it re-pins
// from a live run); a named audit suppresses the default one; `--all` runs
// everything.
for (const a of AUDITS) a.ran = a.flag ? (ARGV.includes(a.flag) || ARGV.includes('--all')) : false;
if (UPDATE_HOVERS) AUDITS.find((a) => a.key === 'hover').ran = true;
const named = AUDITS.some((a) => a.ran);
AUDITS.find((a) => a.key === 'main').ran = !named || ARGV.includes('--all');
const ranAudit = (key) => AUDITS.find((a) => a.key === key).ran;
const RUN_MAIN = ranAudit('main');
const RUN_HOVER = ranAudit('hover');
const RUN_TOKENS = ranAudit('token');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Temp workspaces are removed by each server's stop(); this registry is
// the backstop — it clears them on normal exit, an uncaught error, or
// Ctrl-C, so nothing leaks.
const TEMP_DIRS = new Set();
const mkTemp = (base) => { const d = fs.mkdtempSync(base); TEMP_DIRS.add(d); return d; };
const cleanupTemp = () => { for (const d of TEMP_DIRS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } TEMP_DIRS.clear(); };
process.on('exit', cleanupTemp);
process.on('SIGINT', () => { cleanupTemp(); process.exit(130); });

// Preflight: the audit is a COMPLETENESS check, so a run missing its
// tools must fail loudly and up front, never let dimensions skip into a
// green subset (the twin dimension type-checks fixtures against the
// React/zod corpus; tsgo comes from the root install). "60/60" must
// always mean the whole audit ran.
{
  const missing = [];
  try { tsgoBinaryPath(); }
  catch { missing.push('tsgo — run `bun install` at the repository root'); }
  // Both the runtime libs AND their @types/* dev deps: the twin type-check
  // (dimension 5) needs the type declarations, and it now FAILS rather
  // than skips, so a missing @types would read as a false twin error.
  const auditPkg = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));
  const corpus = [...Object.keys(auditPkg.dependencies ?? {}), ...Object.keys(auditPkg.devDependencies ?? {})];
  const gone = corpus.filter((d) => !fs.existsSync(path.join(HERE, 'node_modules', d, 'package.json')));
  if (gone.length) missing.push(`the fixture corpus (${gone.join(', ')}) — run \`bun install\` in test/type-audit/`);
  if (missing.length) {
    console.error('\n✗ The type audit cannot run — dependencies are missing:');
    for (const m of missing) console.error(`  • ${m}`);
    console.error('\nInstall them, then re-run `bun run type-audit`.\n');
    process.exit(1);
  }
}

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
  // The preflight guarantees tsgo resolves; if it somehow does not, that
  // is a real broken state — let it throw loudly rather than skip.
  const tsc = tsgoBinaryPath();
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
  // Missing tools can no longer reach here — the preflight fails the run
  // up front — so a twin outcome is only ever pass or fail, never a
  // silent skip that would shrink "60/60" into a green subset.
  const errs = byFile.get(twinBase) ?? [];
  return errs.length === 0
    ? { status: 'pass' }
    : { status: 'fail', detail: `${errs.length} type error(s)`, errs };
}

// ── dimension 4: runtime parity (run .rip via rip, the twin via bun,
// diff stdout). bun executes .ts and .tsx alike — a .tsx twin's JSX is
// define-only at module scope (nothing renders without a DOM), so both
// modules must load, run their top level, and print identical bytes.
// This dimension only runs for a fixture that already COMPILED, so a run
// error is not an environment gap — it is a real regression (rip crashed
// on code it compiled, or the reference twin is broken) and FAILS loudly,
// never a silent skip that would drop the check from the denominator.
function runOut(cmd, file) {
  try { return { ok: true, out: execFileSync(cmd[0], [...cmd.slice(1), file], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (err) { return { ok: false, out: (err.stdout || '').toString(), detail: (err.stderr || err.message || '').toString().split('\n')[0] }; }
}
function dimRuntime(ripPath, tsPath) {
  if (!tsPath) return { status: 'n/a', detail: 'no twin' };
  const r = runOut(['bun', RIP], ripPath);
  const t = runOut(['bun'], tsPath);
  if (!r.ok || !t.ok) return { status: 'fail', detail: `run error (${r.ok ? 'ts' : 'rip'}): ${(r.detail || t.detail || '').slice(0, 80)}` };
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
    // `code` is the line with strings blanked and comments cut — the token
    // audit classifies binding forms off it (`codeOf` is hoisted).
    out.push({ name, keyword: keyword ?? null, line, character: text.indexOf(name), text: text.trim(), code: codeOf(text.trim()) });
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
    // Keep the token legend the SERVER advertises (it negotiates its own
    // from tsgo's at startup — server.js `semanticTokensLegend`). Never
    // hardcode one here: a legend change would silently re-label every
    // token the audit reads, and the audit would not notice.
    const init = await this.client.request('initialize', {
      processId: process.pid,
      rootUri: 'file://' + this.dir,
      capabilities: {
        workspace: { configuration: true },
        textDocument: { semanticTokens: { formats: ['relative'], tokenTypes: [], tokenModifiers: [], requests: { full: true } } },
      },
    });
    this.legend = init?.capabilities?.semanticTokensProvider?.legend ?? null;
    this.client.notify('initialized', {});
  }
  // semanticTokens/full, decoded from the LSP delta stream into absolute
  // rows against the .rip SOURCE (the server has already mapped the spans
  // back off the face).
  async tokens(uri) {
    const r = await this.client.request('textDocument/semanticTokens/full', { textDocument: { uri } }).catch(() => null);
    return decodeSemanticTokens(r?.data ?? [], this.legend);
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

// ── token machinery: what a declaration's token MUST be, derived from
// rip source syntax alone.
//
// The mutability column is rip's OWN rule, certified by compiling each
// `<form>` followed by `name = <other>` and reading the compiler's
// answer — NOT inferred from the face, which is the thing under test:
//
//   plain      x = 1        face `let x`      writable    → not readonly
//   annotated  x: T = 1     face `let x: T`   writable    → not readonly
//   pinned     x =! 1       face `const x`    immutable   → readonly
//   state      x := 1       face `const x`    WRITABLE    → not readonly
//   computed   x ~= y * 2   face `const x`    immutable   → readonly
//   effect     x ~> …       face `const x`    immutable   → readonly
//
// `state` is the ONE row where the face's declaration keyword and rip's
// semantics disagree: `:=` lowers to a `const` CELL whose value is
// mutable (`x = 5` → `x.value = 5`, which compiles), so that `const`
// describes the container, not the name the author assigns to. Every
// other const-emitting form really is immutable. Forwarding tsgo's
// modifier bits is therefore correct everywhere EXCEPT `:=`.
// The CODE of a line: string BODIES blanked (length preserved, so offsets
// still line up) and any trailing comment cut. Every rule below reads the
// line's operators, and an operator merely NAMED in prose or sitting
// inside a literal must not masquerade as the binding form — `total =! 1
// # unlike :=` is pinned, not state. Getting this wrong would report a
// violation against a CORRECT token, which is the one failure this
// harness cannot afford. `#{…}` interpolation is not a comment.
function codeOf(text) {
  const out = [];
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') { out.push(' ', ' '); i++; continue; }
      if (c === quote) { quote = null; out.push(c); continue; }
      out.push(' ');
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out.push(c); continue; }
    if (c === '#' && text[i + 1] !== '{') break;   // trailing comment
    out.push(c);
  }
  return out.join('');
}
const bindingForm = (code) => /~>/.test(code) ? 'effect'
  : /~=/.test(code) ? 'computed'
  : /:=/.test(code) ? 'state'
  : /=!/.test(code) ? 'pinned'
  : 'plain';
const READONLY_FORMS = new Set(['pinned', 'computed', 'effect']);
const KEYWORD_TOKEN = { def: 'function', class: 'class', interface: 'interface', enum: 'enum', type: 'type' };
// The VALUE side of a declaration — everything past the binding operator.
// Needed because a test against the whole line cannot tell an arrow that
// IS the value (`f = (x) -> x`) from one merely contained in it
// (`xs = list.map -> it * 2`, whose value is an array).
const OP = { effect: '~>', computed: '~=', state: ':=', pinned: '=!' };
function valueSide(code, form) {
  if (OP[form]) return code.slice(code.indexOf(OP[form]) + 2);
  // `plain`: the first `=` that is a real assignment — skipping `=>`/`==`
  // and any `=` belonging to another operator, so an annotation carrying a
  // function type (`x: () => void = …`) cannot steal the match.
  for (let i = 0; i < code.length; i++) {
    if (code[i] !== '=' || '>='.includes(code[i + 1] ?? '')) continue;
    if ('=<>!:~'.includes(code[i - 1] ?? '')) continue;
    return code.slice(i + 1);
  }
  return '';
}
// An arrow function as the VALUE: optional params, optional return
// annotation, then the arrow. ANCHORED — a `->` deeper in the expression
// (`xs = list.map -> it * 2`) is a callback, not the binding's value.
const IS_ARROW = /^\s*(?:\([^)]*\))?\s*(?::\s*[^-=]+)?\s*(?:->|=>)/;
// The expected token TYPE — asserted ONLY where rip source genuinely pins
// it. `null` means it does not, and the audit must not invent an
// expectation it cannot defend: a harness that cries wolf is worse than no
// harness. The undecidable case is `X = schema`, which declares a value
// AND a type; tsgo calls the name a `type`, which is defensible, so it is
// REPORTED (--v) rather than scored.
function expectedTokenType(d, form) {
  if (d.keyword) return KEYWORD_TOKEN[d.keyword] ?? null;
  const val = valueSide(d.code, form);
  if (/^\s*schema\b/.test(val)) return null;         // dual value+type — see above
  if (/^\s*component\b/.test(val)) return 'class';   // the component lowering emits a class
  // A function-valued PLAIN binding classifies as `function`, not
  // `variable` — TS's own rule, and the right one. Restricted to `plain`:
  // an arrow handed to `:=`/`~=` is wrapped in a cell, so the NAME stays a
  // variable no matter what the arrow is.
  if (form === 'plain' && IS_ARROW.test(val)) return 'function';
  return 'variable';
}
function expectedToken(d) {
  const form = d.keyword ?? bindingForm(d.code);
  return { type: expectedTokenType(d, form), readonly: d.keyword ? null : READONLY_FORMS.has(form), form };
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

// ── the shared probe pass. The Hover and Token audits ask DIFFERENT questions
// of the SAME open document, so opening it twice pays the server's settle twice
// for nothing. Open each fixture once, take whatever the running audits need,
// close. Compilation is memoized for the same reason: a fixture's face does not
// change between audits, so `rip --ts` runs at most once per file per run.
const compiled = new Map();
const compiles = (full) => {
  if (!compiled.has(full)) {
    try { execFileSync('bun', [RIP, '--ts', full], { timeout: 30000, stdio: 'ignore' }); compiled.set(full, true); }
    catch { compiled.set(full, false); }
  }
  return compiled.get(full);
};

const PROBES = new Map();   // file → { decls, hovers, tokens, tmap }
let hskip = 0;
if (RUN_HOVER || RUN_TOKENS) {
  let twin = null;
  if (RUN_HOVER) {
    try { twin = new TwinOracle(); await twin.start(); } catch { twin = null; }
    if (!twin) console.log(`    ${dim('tsgo unavailable — twin oracle skipped; hover-pins comparison still runs')}`);
  }

  for (const f of fixtures) {
    const full = path.join(FIX, f);
    const src = fs.readFileSync(full, 'utf8');
    if (!compiles(full)) { console.log(`    ${dim(`skip ${f} — does not compile (no face to probe)`)}`); hskip++; continue; }

    // Probe the editor server and the tsgo twin concurrently — they are
    // independent servers, so the twin's settle overlaps the editor's.
    const twinBase = twin ? ['.tsx', '.ts'].map((e) => f.replace(/\.rip$/, e)).find((b) => fs.existsSync(path.join(FIX, b))) : null;
    const decls = declsOf(src);
    const [uri, tmap] = await Promise.all([
      editor.openForHover(f, src),
      twinBase ? twin.hoverTwin(path.join(FIX, twinBase)).catch(() => null) : Promise.resolve(null),
    ]);
    const hovers = [];
    if (RUN_HOVER) for (const d of decls) hovers.push(await editor.hover(uri, { line: d.line, character: d.character }));
    const tokens = RUN_TOKENS ? await editor.tokens(uri) : null;
    await editor.close(uri);

    PROBES.set(f, { decls, hovers, tokens, tmap });
  }

  if (twin) await twin.stop();
}

// ── the Hover Audit: twin oracle (correctness) + expected hovers (baseline)
let hp = null;
if (RUN_HOVER) {
  auditBanner('HOVER AUDIT', `twin oracle + expected hovers · ${fixtures.length} files`);

  const pinned = fs.existsSync(HOVERS) ? JSON.parse(fs.readFileSync(HOVERS, 'utf8')) : null;
  const allRows = [];
  let anyCount = 0, probeCount = 0;

  for (const [f, { decls, hovers, tmap }] of PROBES) {
    const occ = new Map();
    decls.forEach((d, i) => {
      const k = occ.get(d.name) ?? 0; occ.set(d.name, k + 1);
      allRows.push({ ...d, hover: hovers[i], ts: tmap ? (tmap.get(`${d.name}#${k}`) ?? null) : null, file: f });
      probeCount++;
      if (/(?:^|:\s*)any$/.test(hovers[i] ?? '')) anyCount++;
    });
  }

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

// ── the Token Audit: source-derived invariants — no oracle, no baseline
let tk = null;
if (RUN_TOKENS) {
  auditBanner('TOKEN AUDIT', `source-derived invariants · ${fixtures.length} files`);
  // No legend, no audit. Token indices are meaningless without it, so decoding
  // anyway yields zero probes and zero violations — which the Totals line would
  // print GREEN, exactly the "a gate that never ran reads like a gate that
  // passed" failure the unknown-flag guard exists to prevent. Die loudly, like
  // the preflight, rather than pass vacuously.
  if (!editor.legend) {
    await editor.stop();
    console.error(`\n✗ The token audit cannot run — the server advertised no semanticTokens legend.`);
    console.error(`  Its capability comes from tsgo at startup (server.js \`semanticTokensLegend\`);`);
    console.error(`  a missing one means the broker never came up. Nothing was checked.\n`);
    process.exit(1);
  }
  {
    const missing = [], badType = [], badReadonly = [], unasserted = [];
    let probed = 0;
    const tskip = fixtures.length - PROBES.size;
    // Each invariant reports against the rows it ACTUALLY asserted — a
    // keyword decl carries no readonly question, a schema no token type.
    // Scoring them against the full probe count would inflate the gauge.
    let typeAsserted = 0, roAsserted = 0;
    // Per-form coverage — the readonly invariant is only meaningful if the
    // corpus exercises BOTH polarities. A run where every row expected
    // "not readonly" would flag `:=` for free and prove nothing.
    const byForm = new Map();

    for (const [f, { decls, tokens: toks }] of PROBES) {
      // A declaration's token is the one STARTING at its name.
      const at = new Map(toks.map((t) => [`${t.line}:${t.character}`, t]));
      for (const d of decls) {
        // `String::titleCase = …` extends an EXISTING prototype: the
        // leading name is a reference, not a declaration (declsOf's
        // line-shape heuristic cannot tell the difference).
        if (/^[A-Za-z_$][\w$]*::/.test(d.text)) continue;
        const want = expectedToken(d);
        const got = at.get(`${d.line}:${d.character}`);
        probed++;
        const row = { ...d, file: f, want, got };
        if (!got) { missing.push(row); continue; }
        if (want.type === null) unasserted.push(row);
        else { typeAsserted++; if (got.type !== want.type) badType.push(row); }
        if (want.readonly !== null) {
          roAsserted++;
          const bad = got.modifiers.includes("readonly") !== want.readonly;
          const s = byForm.get(want.form) ?? { want: want.readonly, ok: 0, bad: 0 };
          s[bad ? 'bad' : 'ok']++;
          byForm.set(want.form, s);
          if (bad) badReadonly.push(row);
        }
      }
    }

    const fmt = (t) => t ? [t.type, ...t.modifiers].join(" ") : "(no token)";
    const show = (rows, label, render) => {
      if (!rows.length) return;
      console.log(`\n    ${bold(label)}`);
      for (const r of rows) {
        console.log(`      ${red('✗')} ${bold(r.name)} ${dim(`@ ${r.file}:${r.line + 1}`)}  ${dim(`(${r.text})`)}`);
        render(r);
      }
    };

    console.log(`\n  ${bold('Invariants')} ${dim(`(${probed} declarations${tskip ? `, ${tskip} file(s) skipped` : ''} — every expectation derived from .rip syntax)`)}`);
    const irow = (label, bad, den, note) => console.log(
      `    ${pad(label, 12)} ${(bad ? red : green)(String(den - bad).padStart(3))} ${dim('/')} ${dim(String(den).padStart(3))}${bad ? '   ' + yellow(`${bad} violation${bad === 1 ? '' : 's'}`) : ''}${note ? '   ' + dim(note) : ''}`);
    irow('present', missing.length, probed, 'a declared name gets a token');
    irow('type', badType.length, typeAsserted, `token type matches the declaring form${unasserted.length ? ` · ${unasserted.length} unasserted` : ''}`);
    irow('readonly', badReadonly.length, roAsserted, `readonly IFF the binding is immutable in rip${probed - roAsserted ? ` · ${probed - roAsserted} n/a` : ''}`);

    show(missing, 'No token — the name gets no semantic color', () => {});
    show(badType, 'Wrong token type', (r) => {
      console.log(`          ${dim('expected')} ${green(r.want.type)}`);
      console.log(`          ${dim('actual  ')} ${yellow(fmt(r.got))}`);
    });
    show(badReadonly, 'Wrong `readonly` modifier', (r) => {
      console.log(`          ${dim('expected')} ${green(`${r.want.type}${r.want.readonly ? ' readonly' : ''}`)} ${dim(`— a \`${r.want.form}\` binding is ${r.want.readonly ? 'immutable' : 'WRITABLE'} in rip`)}`);
      console.log(`          ${dim('actual  ')} ${yellow(fmt(r.got))}`);
    });
    // Both polarities, per binding form — a vacuity check on the readonly
    // invariant above, not decoration.
    if (byForm.size) {
      console.log(`\n    ${dim('readonly coverage by form')} ${dim('(both polarities must appear, or the invariant proves nothing)')}`);
      for (const [form, s] of [...byForm].sort()) {
        const tally = s.bad ? `${green(`${s.ok} ok`)}, ${red(`${s.bad} bad`)}` : green(`${s.ok} ok`);
        console.log(`      ${pad(form, 10)} ${dim(`expect ${s.want ? 'readonly' : 'writable'}`)}  ${tally}`);
      }
    }
    if (VERBOSE && unasserted.length) {
      console.log(`\n    ${dim('unasserted — rip source does not pin a token type (schema declares a value AND a type)')}`);
      for (const r of unasserted) console.log(`      ${dim('•')} ${bold(r.name)} ${dim(`@ ${r.file}:${r.line + 1}`)}  ${dim(`(${r.text}) → ${fmt(r.got)}`)}`);
    }

    tk = { probed, missing, badType, badReadonly };
  }
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
if (tk) {
  const bad = tk.missing.length + tk.badType.length + tk.badReadonly.length;
  console.log('    ' + `${tk.probed} token probes: `
    + (bad === 0 ? green('all invariants hold')
      : red(`${bad} invariant violation${bad === 1 ? '' : 's'}`)
        + dim(` (${[[tk.missing, 'missing'], [tk.badType, 'wrong type'], [tk.badReadonly, 'wrong readonly']].filter(([r]) => r.length).map(([r, l]) => `${r.length} ${l}`).join(', ')})`)));
}

// ── what this run did NOT cover. The default runs one of three audits, so say
// so on the way out: an audit nobody knows about is an audit nobody runs. Reads
// `ran` straight off AUDITS, so EVERY audit can appear here — including the
// default one, which a `--hover`/`--token` run silently skips.
{
  const skipped = AUDITS.filter((a) => !a.ran);
  const covered = AUDITS.filter((a) => a.ran).map((a) => a.name).join(' + ') || 'nothing';
  if (skipped.length) {
    console.log(`\n  ${dim('Not run')} ${dim(`(this run: ${covered})`)}`);
    for (const a of skipped) console.log(`    ${dim('·')} ${bold(a.name)} ${dim(`— ${a.blurb}`)}\n      ${dim(`bun run type-audit${a.flag ? ' ' + a.flag : ''}`)}`);
    console.log(`    ${dim('·')} ${dim('all three:')} ${dim('bun run type-audit --all')}   ${dim('· full flag list:')} ${dim('--help')}`);
  }
}
console.log('');
