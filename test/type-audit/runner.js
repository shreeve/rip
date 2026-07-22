// The type-audit — a PROGRESS GAUGE (not a pass/fail gate): a
// categorized scoreboard over the fixtures. Each fixture is scored on
// independent dimensions, and every failure is categorized so the
// number tells you WHERE the type story stands.
//
//   bun run type-audit                  # the Type Audit (dims 1–6), the default
//   bun run type-audit --grammar        # the Grammar Gate ONLY (parser only)
//   bun run type-audit --map            # the Mapping Audit ONLY (compiler output; no server)
//   bun run type-audit --errors         # the Diagnostics Lane ONLY (drives the editor server)
//   bun run type-audit --hover          # the Hover Audit ONLY (slower; drives LSP servers)
//   bun run type-audit --token          # the Token Audit ONLY (drives the editor server)
//   bun run type-audit --all            # every audit, bottom-up: grammar → map → type → errors → hover + token
//   bun run type-audit --v              # + list expected hover divergences / unasserted tokens
//   bun run type-audit --update-hovers  # re-pin expected hovers (verify the change first)
//
// The independent audits (the AUDITS table below is the authoritative list —
// it also carries the Grammar Gate, ROADMAP "M2", and the Diagnostics Lane,
// ROADMAP "M3", which each document themselves at their sections):
//
// A · THE TYPE AUDIT — a per-fixture grid over six dimensions:
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
//   6 strict       `rip check` under rip.strict reports ZERO errors —
//                  i.e. the face carries no implicit `any`
//                                                     (else: implicit-any hole)
//
// WHY 6 IS NOT A DUPLICATE OF 3. Dimension 3 already runs under the strict
// TSCONFIG (tsgo defaults strict:true). `rip.strict` is a different switch:
// it stops rip SUPPRESSING the implicit-any family (SUPPRESSED_TS_CODES).
// tsgo emits those diagnostics today and mapTsDiagnostic drops them — so an
// unchecked `any` region is invisible to 3 and to `rip check`, and reads as
// a clean pass. Dimension 6 is the only gauge that can go red for it. The
// compiler-emitted names user expressions type through — the render
// fragment's context parameter and loop item/index params, event handler
// params (inline casts, named-ref pre-scan annotation), the schema
// transform's `it` — carry face types now, each gated where it is enforced
// (check.test.js's branch-body/loop-row and handler cases;
// schema-types.test.js's transform case), and this dimension is what
// discovers the NEXT such name the day an emission grows one.
//
// THIS DIMENSION RUNS CLEAN, AND CLEAN IS THE CONTRACT. Two curation
// rules keep it that way without silencing anything:
//
//   · Author-annotatable shapes (bare optionals, unannotated params) are
//     legal permissive rip that strict correctly asks annotations for —
//     they live OUTSIDE this corpus rather than as permanent red
//     (face-dts-agreement.test.js pins the bare-optional emission
//     paths).
//   · An uninferrable-by-construction param maps its implicit-any to the
//     source line that OWNS it, where a directive can acknowledge it:
//     09's `for item in itemsz` loops over a deliberate typo, so no
//     element type exists to infer and the factory's item param stays
//     honestly bare — but it marks with the LOOP node, so its TS7006
//     lands on the loop line and rides the same `@ts-expect-error` that
//     acknowledges the typo. Never a silencing `any` in the emitter.
//
// A red row here is therefore a DISCOVERY, not routine: a
// compiler-emitted name user expressions type through wants a face type
// at its emission seam (the closed class above), an uninferrable param
// wants its diagnostic mapped to the line the author can govern, or a
// fixture grew a legal-permissive shape that belongs outside the
// corpus. Do not fix a red row by suppressing; read the failure's note,
// which names what is actually there.
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
//   And ONE more, over TYPE-BODY MEMBERS (see typeMembersOf):
//     · member     a property name inside a `type`/`interface` body gets a
//                  token — presence only, same oracle (rip source names the
//                  member, so it must classify). This is EXPECTED RED —
//                  the mapping gap: members ride one coarse cover row and
//                  map only where verbatim from its start, so a
//                  quote-normalized literal or a block body's inserted `{`
//                  truncates the prefix and drops every later member token.
//                  The token twin of the `strict` gauge — a red row that
//                  goes green the day the mapping fix lands, at which point
//                  the gauge is retired.
//
//   And ONE more, the OTHER direction — over the FACE, not the source (see
//   FaceOracle / faceSurvival):
//     · survival   a classified source identifier the server DROPS. Counted,
//                  not position-mapped: a dropped token's source offset is
//                  unrecoverable (it sits past a byte divergence, where the map
//                  collapses to the cover-row start), so per classified name
//                  compare source code occurrences to what the server delivered
//                  — the deficit is the drop. The only invariant that reaches
//                  USE sites and rip-native names (a reactive read has no
//                  column-0 declaration and no TS twin). EXPECTED RED —
//                  the same coarse-cover-row root as `member`, so both
//                  flip green on the mapping fix. A length-≥2 floor plus a rip
//                  declaration-keyword denylist and a `delivered >= 1` gate keep
//                  keywords and synthetic tokens out of the count.
//
//   SCOPE: top-level DECLARATION sites (the reach of `declsOf`, a column-0
//   heuristic) and type-body MEMBERS carry the source-enumerated invariants
//   (present/type/readonly, presence-only for members). USE sites and
//   rip-native names are covered ONLY by `survival`, and for PRESENCE only —
//   a surviving token's type/readonly is still unchecked (a `clicks` read may
//   carry the same bogus `readonly` as its declaration, and nothing verifies
//   the modifier there). A clean run is a statement about those sites.
//
// D · THE MAPPING AUDIT (--map / --all) — the one audit that starts no
//   server and asks no oracle: it reads the compiler's OWN mapping rows
//   and checks, for every identifier in the source, that it maps to a
//   generated position holding the same text. The three audits above all
//   probe DECLARATIONS or type verdicts; none asks, of an identifier at a
//   USE site, where it maps and whether that is the right place. This one
//   does, and it does it from `compile()` alone — the same rows the editor
//   server remaps every hover, definition, and edit through.
//
//   Two invariants per read, INDEPENDENT by construction (each catches a
//   root the other cannot — see the partition note at the audit itself):
//     · placed   the PRECISE map (sourceOffsetToGeneratedExact — the same
//                resolver definition/rename ride) resolves the read's start
//                to a generated offset. It REFUSES on a rewrite: the cover's
//                verbatim prefix breaks at a re-rendered string literal and
//                no exact position survives.
//     · text     that resolved position holds the read's own bytes. It
//                ANSWERS WRONG on mark-width: a paren-less call or a
//                brace-lowered body maps the read onto its cover's inserted
//                glyph (`(tota…` for `total`), so a position resolves but to
//                the wrong symbol — the use-site mapping hazard.
//
//   Each failure is classified by the ROW it fell to (its role: `args`,
//   `$self`, `body`, `value`, …) and by ROOT — synthetic-inclusion (the
//   dominant class: the mark carries glyphs its source span does not) or
//   string-rewrite (smaller: a literal re-rendered double-quoted). The run
//   PRINTS the live counts; none is frozen here. One structural invariant
//   backs the lot: EVERY flagged read has a containing row (the spans exist,
//   they are just wrong) — a read with none would be a genuinely missing
//   span, a new class, and the run says so loudly if it ever appears.
//
//   No oracle backs the walk on a per-run basis — and it needs none TO RUN.
//   Trusting the LOGIC, though, is a one-time act: it was validated against the
//   real editor once (2026-07-17, driven — see ROADMAP.md "M1"), then the
//   server-driven scaffolds were retired. The audit ships STANDALONE under every
//   flag; re-validation, if the mapping internals change, recovers that
//   cross-check from git rather than wiring a server into every run.
//
// Layout: fixtures/ holds two fixture blocks — 01–12 and the M3 block from
// 20; ROADMAP "M3" owns the migration between them — each `.rip` beside a
// hand-written `.ts`/`.tsx` twin;
// hover-pins.json is the Hover Audit's baseline for symbols the twin cannot
// judge. fixtures/errors/ is where the M3 corpus's NEGATIVE tests live —
// one unsuppressed error pair per family — and it belongs to the
// Diagnostics Lane ALONE: the flat `fixtures` walk never descends into it,
// and tsconfig.json excludes it from the twin type-check, so its
// deliberately-unsuppressed errors cannot leak
// into any other audit's denominator. Each error pair carries a
// LINE-ALIGNED @ts-nocheck pragma (`# @ts-nocheck` / `// @ts-nocheck`), so
// every authoring surface — `rip check`, the rip editor, VS Code's own
// TypeScript on the twin — stays quiet about errors that are instrument
// content. The pragmas cannot blind the lane: it strips them on the way
// into each measurement and ENFORCES their presence per pair, so the
// silencer applies to authoring only, never to a measurement, and a new
// error fixture cannot forget it quietly. The fixtures' dependency
// sandbox (react/zod/…) lives in THIS directory's package.json, never the
// repository root's — the preflight below names what is missing.
//
// The verdict (dim 3) runs under STRICT because tsgo (TS7) defaults
// strict:true ON — the posture rides that default, and the audit's
// tsconfig does not restate it. The runner copies tsconfig.json into the
// editor workspace for the fixtures' other options
// (moduleDetection/jsx/skipLibCheck/noFallthroughCasesInSwitch — the
// last IS pinned there, unlike strict: it sits outside the strict
// family, so no default supplies it, and it guards the hand-written
// twins against switch fallthrough; a comment cannot live in the
// tsconfig itself because this runner JSON.parses it), and to drive
// dim 5.
//
// The 01–12 block's fixtures self-check: a `# @ts-expect-error` marks a
// line that MUST error, and if the face + tsgo satisfy every marker and
// add none, the editor publishes nothing — that is dimension 3 passing.
// M3-block fixtures (20+) carry no markers at all: their negatives live
// in fixtures/errors/, asserted by the Diagnostics Lane, so for them
// dimension 3 means zero diagnostics absolutely.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LspClient, tsgoBinaryPath, startTsgo, decodeSemanticTokens } from '../../packages/vscode/src/tsgo.js';
import { compile } from '../../src/compile.js';
import { Parser } from '../../src/parser.js';
import { makeParserLexer } from '../../src/lexer.js';
import { lineStartsOf, SUPPRESSED_TS_CODES, sourceOffsetToGeneratedExact, offsetToPosition } from '../../packages/vscode/src/translate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const RIP = path.join(ROOT, 'bin/rip');
const SERVER = path.join(ROOT, 'packages/vscode/src/server.js');
const FIX = path.join(HERE, 'fixtures');
// The Diagnostics Lane's fixtures — OUTSIDE the flat walk below by construction:
// `fixtures` reads FIX non-recursively, so nothing in errors/ can join another
// audit's denominator, and tsconfig.json excludes it from the twin type-check.
const ERRD = path.join(FIX, 'errors');
const HOVERS = path.join(HERE, 'hover-pins.json');
const ARGV = process.argv.slice(2);
// ── flags. THE COMMAND IS THE DOCUMENTATION. Every audit lives in this
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
    key: 'grammar', flag: '--grammar', name: 'Grammar Gate',
    // Parser only — no server, no tsgo, no compile even: the corpus is parsed
    // with an instrumented Parser and each reduce records its rule.
    runs: 'parser only',
    blurb: 'which grammar productions the fixture corpus exercises, and which it never reduces',
    judge: 'the GRAMMAR\'S OWN RULE LIST — a closed denominator: every production the\n'
         + 'parser can reduce is enumerable, so "exercised by at least one fixture" is\n'
         + 'checkable in a way no corpus-relative rate ever is. The uncovered list is\n'
         + 'the M3 fixture-growth queue (see ROADMAP.md)',
  },
  {
    key: 'map', flag: '--map', name: 'Mapping Audit',
    // Touches no server: it reads the compiler's own
    // mapping rows, so it is the one whose "drives the editor server" the usage
    // line below must NOT claim (see `runs`).
    runs: 'compiler output only',
    blurb: 'every source identifier maps to a generated position holding the same text',
    judge: 'the COMPILER OUTPUT alone — no server, no tsgo, no twin. A read is `placed`\n'
         + 'when the precise map resolves it and `text`-true when that position holds its\n'
         + 'own bytes; each failure is classified by the mapping row it fell to',
  },
  {
    key: 'main', flag: null, name: 'Type Audit',
    blurb: 'six dimensions per fixture: compiles, directives, verdict, runtime, twin, strict',
    judge: 'the fixtures themselves. 01–12 self-check via `# @ts-expect-error` markers —\n'
         + 'every marker must fire and nothing else may. M3 fixtures (20+) carry no\n'
         + 'markers: they must publish ZERO diagnostics, their negatives living in\n'
         + 'fixtures/errors/ under the Diagnostics Lane',
  },
  {
    key: 'errors', flag: '--errors', name: 'Diagnostics Lane',
    blurb: 'the corpus\'s negatives — unsuppressed error fixtures, every diagnostic asserted by code and position',
    judge: 'the twin\'s OWN tsgo diagnostics — TypeScript\'s answer on the LINE-ALIGNED twin\n'
         + 'fixes each expected code and line, and the flagged token\'s place in the rip\n'
         + 'source fixes the expected column. ALL of the M3 corpus\'s negative tests live\n'
         + 'here, in fixtures/errors/ (one error pair per family), OUTSIDE the shared\n'
         + 'fixture walk: positive fixtures publish zero diagnostics absolutely, and only\n'
         + 'this lane can see a mis-positioned diagnostic — suppression would consume the\n'
         + 'evidence on the face',
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
  ['--all', 'every audit'],
  ['--serial', 'probe one fixture at a time — the control for the concurrent pass'],
  ['--v', '+ expected hover divergences, unasserted tokens, and every flagged mapping read, in full'],
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
  ...AUDITS.filter((a) => a.flag).map((a) => `  ${a.flag.padEnd(16)} the ${a.name} only (${a.runs ?? 'drives the editor server'})`),
  ...FLAGS.map((row) => `  ${row.slice(0, -1).join(', ').padEnd(16)} ${row.at(-1)}`),
  '',
  'The audits, and what each is judged against:',
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
// Fixtures probe a few at a time because the cost is waiting, not computing.
// `--serial` collapses that to one lane: if a result ever looks wrong, run it
// and see whether concurrency was the cause. The two must agree — and if they
// ever do not, the concurrent path is the bug, not the answer.
const LANES = ARGV.includes('--serial') ? 1 : 4;
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
const RUN_MAP = ranAudit('map');
const RUN_GRAMMAR = ranAudit('grammar');
const RUN_ERRORS = ranAudit('errors');
// The Mapping Audit reads the compiler's own mapping rows and touches no
// server, so a run covering ONLY it needs neither the editor-server pool nor
// tsgo. Everything else does. This gates both the pool construction and the
// tsgo half of the preflight, so `bun run type-audit --map` is honest about
// running from compiler output alone — it works with tsgo absent entirely.
const NEED_SERVER = RUN_MAIN || RUN_HOVER || RUN_TOKENS || RUN_ERRORS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const execFileP = promisify(execFile);
// A face carries the whole reactive-runtime prelude, so it outgrows execFile's
// 1MB default; a truncated face would read as a compile failure.
const MAX_FACE = 32 * 1024 * 1024;

// Run `work` over `items` a few at a time, resolving results IN ORDER so a
// caller can stream them as they land. Every audit's cost is dominated by
// waiting — on a server, on a spawned process — not by CPU, so the width buys
// wall-clock without contending for anything.
async function lanes(items, work, { width = 4, onDone = null } = {}) {
  const out = new Array(items.length);
  const gate = items.map(() => { let go; return { done: new Promise((r) => { go = r; }), go }; });
  const queue = items.map((it, i) => [it, i]);
  // Each runner carries its LANE INDEX, and every lane owns its own server. That
  // is what makes a concurrent run equivalent to a serial one by construction:
  // no server ever sees a second document, so no probe is ever answered by a
  // program a serial run would not have built.
  const runners = Array.from({ length: Math.min(width, items.length) }, async (_, lane) => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const [it, i] = job;
      out[i] = await work(it, i, lane);
      gate[i].go();
    }
  });
  // The printer walks the results IN INDEX ORDER, so output stays in fixture
  // order even though the work finishes out of order.
  const printer = (async () => {
    for (let i = 0; i < items.length; i++) { await gate[i].done; onDone?.(out[i], i); }
  })();
  await Promise.all([...runners, printer]);
  return out;
}

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
  // The Mapping Audit needs no tsgo (it never starts a server), so a --map-only
  // run must not fail here for a missing binary — that is the whole point of its
  // "compiler output alone" contract.
  if (NEED_SERVER) {
    try { tsgoBinaryPath(); }
    catch { missing.push('tsgo — run `bun install` at the repository root'); }
  }
  // Both the runtime libs AND their @types/* dev deps: the twin type-check
  // (dimension 5) needs the type declarations, and it now FAILS rather
  // than skips, so a missing @types would read as a false twin error. The
  // Mapping Audit type-checks nothing — it never resolves an import — so a
  // --map-only run does not need the corpus present either.
  if (NEED_SERVER) {
    const auditPkg = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));
    const corpus = [...Object.keys(auditPkg.dependencies ?? {}), ...Object.keys(auditPkg.devDependencies ?? {})];
    const gone = corpus.filter((d) => !fs.existsSync(path.join(HERE, 'node_modules', d, 'package.json')));
    if (gone.length) missing.push(`the fixture corpus (${gone.join(', ')}) — run \`bun install\` in test/type-audit/`);
  }
  if (missing.length) {
    console.error('\n✗ The type audit cannot run — dependencies are missing:');
    for (const m of missing) console.error(`  • ${m}`);
    console.error('\nInstall them, then re-run `bun run type-audit`.\n');
    process.exit(1);
  }
}

// One tsc-diagnostic output line: `path(line,col): error TScode`. The
// basename class admits dots — role-suffixed names (`NN-family.errors.ts`)
// would otherwise truncate to `errors.ts` and mis-key every downstream
// lookup, turning a twin full of errors into a silent green cell.
const TSC_DIAG = /([\w.-]+\.tsx?)\((\d+),(\d+)\): error TS(\d+)/;

// Count REAL directives only — comment-start position, the emitter's
// own rule (a prose comment that merely MENTIONS "@ts-expect-error" is
// not a directive in either surface).
const countDirectives = (text) => (text.match(/^[ \t]*(?:#|\/\/)[ \t]*@ts-expect-error(?=\s|$)/gm) ?? []).length;

// Does a fixture produce a face? One answer per file per run, shared by every
// audit that asks — the answer cannot change within a run.
//
// The map holds the PROMISE, not the boolean, so two lanes asking at once share
// one compile instead of racing two. Every spawn on this path is async: a
// synchronous one blocks the event loop, freezing every other lane's in-flight
// LSP request and serializing exactly the work the lanes exist to overlap.
const compiled = new Map();   // ripPath → Promise<boolean>
const compiles = (ripPath) => {
  if (!compiled.has(ripPath)) {
    compiled.set(ripPath, execFileP('bun', [RIP, '--ts', ripPath], { timeout: 30000, maxBuffer: MAX_FACE }).then(() => true, () => false));
  }
  return compiled.get(ripPath);
};

// ── dimension 1: compiles (+ capture the face for dimension 2)
async function dimCompiles(ripPath) {
  try {
    const { stdout: face } = await execFileP('bun', [RIP, '--ts', ripPath], { encoding: 'utf8', timeout: 30000, maxBuffer: MAX_FACE });
    compiled.set(ripPath, Promise.resolve(true));
    return { ok: true, face };
  } catch (err) {
    compiled.set(ripPath, Promise.resolve(false));
    const msg = (err.stderr || err.stdout || err.message || '').toString().split('\n').find((l) => l.trim()) ?? 'compile failed';
    return { ok: false, detail: msg.trim() };
  }
}

// ── dimension 5: twin type-check — run tsgo ONCE over the fixtures
// under tsconfig.json (strict via tsgo's default; the file itself pins
// only the non-defaulted options), then attribute errors per twin.
async function runTwinTsc() {
  // The preflight guarantees tsgo resolves; if it somehow does not, that
  // is a real broken state — let it throw loudly rather than skip.
  const tsc = tsgoBinaryPath();
  let out = '';
  try { out = (await execFileP(tsc, ['--noEmit', '-p', path.join(HERE, 'tsconfig.json')], { encoding: 'utf8', timeout: 120000 })).stdout; }
  catch (err) { out = (err.stdout || '').toString() + (err.stderr || '').toString(); } // tsc exits non-zero when it finds errors
  const byFile = new Map();
  for (const line of out.split('\n')) {
    const m = TSC_DIAG.exec(line);
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

// ── dimension 6: strict — run `rip check` ONCE over the whole corpus with
// rip.strict ON, then attribute Error-severity diagnostics per fixture.
// Same shape as runTwinTsc: one batch pass, attributed, never per-fixture
// spawns.
//
// The workspace is built rather than reused because rip.strict is read from
// package.json#rip (nearest wins) and the measurement must be
// instrument-owned: this dimension writes its own package.json, so its
// posture cannot ride whatever the audit directory happens to carry. The
// audit's own package.json also carries rip.strict — strict-clean is the
// corpus contract, so a fixture violation squiggles at authoring time
// instead of surfacing here first — but that is an authoring affordance
// layered on top, not part of the instrument, and removing it must not
// change what this dimension reports.
//
// node_modules is symlinked, not copied: the fixtures' dependency sandbox
// (react/zod and their @types) lives in THIS directory, and a fixture that
// imports react must resolve it exactly as dimension 5 does. It changes
// nothing today (driven: same 188 diagnostics either way) — it is here so a
// future react-importing fixture cannot silently degrade into a resolution
// error that reads as an implicit-any hole.
// The implicit-any family — the ONLY codes `rip.strict` un-suppresses —
// judged against SUPPRESSED_TS_CODES itself, never a 70xx
// range: that block also holds codes outside the family (7027 unreachable,
// 7028 unused label, 7029 fallthrough), and a range would mislabel them.
// A strict failure outside the set is therefore NOT an implicit-any hole;
// it is something else that slipped past the other dimensions (a compile
// cascade — 07 imports 06 — is the known class), and calling it one would
// be the exact misattribution this dimension's header warns against.
const IMPLICIT_ANY = (code) => SUPPRESSED_TS_CODES.has(code);
async function runStrictCheck() {
  const dir = mkTemp(path.join(os.tmpdir(), 'rip-audit-strict-'));
  for (const f of fs.readdirSync(FIX)) if (f.endsWith('.rip')) fs.copyFileSync(path.join(FIX, f), path.join(dir, f));
  const tscfg = JSON.parse(fs.readFileSync(path.join(HERE, 'tsconfig.json'), 'utf8'));
  tscfg.include = ['.'];   // the fixtures are flat here, not under fixtures/
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(tscfg, null, 2));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ rip: { strict: true } }, null, 2));
  try { fs.symlinkSync(path.join(HERE, 'node_modules'), path.join(dir, 'node_modules'), 'dir'); } catch { /* absent → preflight already spoke */ }

  let out = '';
  // `rip check` exits 1 when it finds errors — which is the expected case
  // here — so the throw carries the payload.
  try { out = (await execFileP(RIP, ['check', dir, '--json'], { encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024 })).stdout; }
  catch (err) { out = (err.stdout || '').toString(); }

  let diags;
  // A `rip check` that timed out, crashed, or printed anything but JSON is a
  // BROKEN HARNESS, not a corpus full of holes. Returning per-fixture failures
  // here would paint 12 red rows that read as findings — so hand the caller a
  // reason and let it abort(), the same contract the preflight has.
  try { diags = JSON.parse(out); }
  catch { return { broken: `rip check --json produced no parseable output (${out.length} bytes; ${out.slice(0, 120).trim() || 'empty'})` }; }

  const byFile = new Map();
  for (const d of diags) {
    // Errors AND warnings — `rip check`'s own gate is `severity <= 2`, and a
    // warning-severity implicit-any is still an implicit-any. Only the fade
    // classes (info/hint) are out of scope.
    if (d.severity !== 'error' && d.severity !== 'warning') continue;
    const base = path.basename(d.file);
    if (!byFile.has(base)) byFile.set(base, []);
    byFile.get(base).push(d);
  }
  return { byFile };
}
function dimStrict(ripBase, byFile) {
  const errs = byFile.get(ripBase) ?? [];
  if (errs.length === 0) return { status: 'pass' };
  // Name what is ACTUALLY there. All-70xx is the implicit-any hole this
  // dimension exists to measure; anything else is a different animal and must
  // not borrow its label.
  const anys = errs.filter((e) => IMPLICIT_ANY(e.code));
  const other = errs.length - anys.length;
  const detail = other === 0
    ? `${anys.length} implicit-any error(s)`
    : anys.length === 0
      ? `${other} strict error(s), NONE implicit-any — not this dimension's class, triage it`
      : `${anys.length} implicit-any + ${other} other strict error(s) — the ${other} are not this dimension's class`;
  return { status: 'fail', detail, errs };
}

// ── dimension 4: runtime parity (run .rip via rip, the twin via bun,
// diff stdout). bun executes .ts and .tsx alike — a .tsx twin's JSX is
// define-only at module scope (nothing renders without a DOM), so both
// modules must load, run their top level, and print identical bytes.
// This dimension only runs for a fixture that already COMPILED, so a run
// error is not an environment gap — it is a real regression (rip crashed
// on code it compiled, or the reference twin is broken) and FAILS loudly,
// never a silent skip that would drop the check from the denominator.
// ASYNC spawn, not execFileSync: this runs while fixtures are probed in
// parallel, and a synchronous spawn blocks the event loop — stalling every
// in-flight LSP request and serializing the very work the lanes exist to
// overlap.
async function runOut(cmd, file) {
  try {
    const { stdout } = await execFileP(cmd[0], [...cmd.slice(1), file], { encoding: 'utf8', timeout: 30000 });
    return { ok: true, out: stdout };
  } catch (err) {
    return { ok: false, out: (err.stdout || '').toString(), detail: (err.stderr || err.message || '').toString().split('\n')[0] };
  }
}
async function dimRuntime(ripPath, tsPath) {
  if (!tsPath) return { status: 'n/a', detail: 'no twin' };
  // The two runs are independent — the .rip through rip, the twin through bun —
  // so run them together rather than back to back.
  const [r, t] = await Promise.all([runOut(['bun', RIP], ripPath), runOut(['bun'], tsPath)]);
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
// Type-body PROPERTY members — the names inside a `type`/`interface` body,
// in the two layouts the corpus uses: an inline object literal
// (`type X = { a: T, b: U }`) and an indented block (`interface X` or
// `type X =`, then `  a: T` lines). CONSERVATIVE by the same contract as
// `declsOf`: it emits a member only where it is confident the name is a
// plain `name: type` property, and SKIPS anything it cannot read that
// cleanly — method shorthand (`foo():`, no `:` right after the name),
// index signatures / mapped types (start with `[`), a union `| 'x'` arm,
// or an inline body carrying a nested bracket a naive comma-split would
// mangle. Feeds the PRESENCE invariant ONLY — never type or
// readonly, which a type-body member does not pin here. Crying wolf is the
// one failure it must avoid: a bogus member position never receives a
// token, so it would sit red forever and never flip on the fix.
const MEMBER = /^(\s*)([A-Za-z_$][\w$]*)\s*\??\s*:/;   // `  name?: …`, a plain property
const IFACE_HEAD = /^\s*(?:export\s+)?interface\s+[A-Za-z_$][\w$]*(?:\s+extends\b[^{]*)?\s*$/;
const TYPE_HEAD = /^\s*(?:export\s+)?type\s+[A-Za-z_$][\w$]*(?:<[^>]*>)?\s*=\s*$/;
function typeMembersOf(src) {
  const out = [];
  let blockIndent = -1;   // -1 = not inside a block type/interface body
  src.split('\n').forEach((raw, line) => {
    const code = codeOf(raw);   // strings blanked, trailing comment cut — offsets preserved
    // Inline object type literal on one line: `type X = { … }` (or a `{ … }`
    // arm of a union). Only a FLAT, bracket-free member list is safe to
    // comma-split; anything nested (generic, call, tuple, nested object)
    // is skipped whole rather than mis-split into a wrong span.
    const open = code.indexOf('{');
    if (/^\s*(?:export\s+)?type\s+[A-Za-z_$]/.test(code) && open >= 0 && code.lastIndexOf('}') > open) {
      blockIndent = -1;
      const body = code.slice(open + 1, code.lastIndexOf('}'));
      if (!/[<>(){}\[\]]/.test(body)) {
        let off = open + 1;
        for (const seg of body.split(',')) {
          const m = seg.match(MEMBER);
          if (m) out.push({ name: m[2], line, character: off + m[1].length, form: 'inline' });
          off += seg.length + 1;   // +1 for the comma the split consumed
        }
      }
      return;
    }
    // A block header ENDS any prior block and starts a new one — checked
    // before the member branch, so a dedented header re-anchors correctly.
    if ((IFACE_HEAD.test(code) || TYPE_HEAD.test(code)) && !code.includes('{')) {
      blockIndent = raw.match(/^\s*/)[0].length;
      return;
    }
    if (blockIndent < 0) return;
    if (!code.trim()) return;                          // blank line — still inside
    if (raw.match(/^\s*/)[0].length <= blockIndent) { blockIndent = -1; return; }
    const m = code.match(MEMBER);
    if (m) out.push({ name: m[2], line, character: m[1].length, form: 'block' });
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
  constructor() { this.diags = new Map(); this.dir = mkTemp(path.join(os.tmpdir(), 'rip-audit-')); this.open = null; }

  // ── THE INVARIANT THAT MAKES CONCURRENCY SAFE ────────────────────────────
  //
  // At most ONE .rip document is open on a server at any moment. That is
  // precisely the condition a serial run satisfies, so enforcing it means every
  // probe is answered by a program of the same SHAPE it would have had serially
  // — concurrency lives between server processes, never inside one program.
  //
  // This is not fussiness. The open-document set genuinely changes what the
  // server answers: the auto-import candidate set IS the open program.
  // Hovers and tokens happen not to depend on it for this corpus,
  // but "happen not to" is an observation, not a guarantee, and observations are
  // what this runner exists to distrust.
  //
  // So it throws. A future edit that probes two documents through one server
  // fails loudly here instead of quietly answering from a program the serial run
  // never had.
  claim(uri) {
    if (this.open && this.open !== uri) {
      throw new Error(
        `EditorServer: ${path.basename(uri)} opened while ${path.basename(this.open)} is still open.\n`
        + `  A server must hold at most one document — that is what makes a concurrent run\n`
        + `  equivalent to a serial one. Give each lane its own server (see the pool below).`,
      );
    }
    this.open = uri;
  }
  release(uri) { if (this.open === uri) this.open = null; }
  async start() {
    for (const f of fs.readdirSync(FIX)) if (f.endsWith('.rip')) fs.copyFileSync(path.join(FIX, f), path.join(this.dir, f));
    // No errors/ copy: the Diagnostics Lane opens its fixtures with in-memory
    // text under `errors/…` URIs (distinct from every flat fixture by path
    // alone), and the server compiles the didOpen text — it never reads an
    // opened document from disk.
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
    this.claim(uri);
    try {
      this.diags.delete(uri);
      this.client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'rip', version: 1, text: src } });
      for (let i = 0; i < 60 && !this.diags.has(uri); i++) await sleep(100);
      await sleep(500);
      const ds = this.diags.get(uri) ?? [];
      this.client.notify('textDocument/didClose', { textDocument: { uri } });
      await sleep(300);
      return ds;
    } finally {
      this.release(uri);   // a throw must not strand the server as "open"
    }
  }

  // Open a document, hand it to `fn`, and close it — the ONLY way the probe pass
  // holds a document. claim/release and open/close are paired in `finally`, so a
  // throw anywhere inside cannot leave a server marked open: were that possible,
  // the lane's NEXT fixture would fail the one-document invariant and report a
  // violation that never happened, hiding the error that actually occurred.
  async withDoc(base, src, probe, fn) {
    const uri = await this.openForHover(base, src, probe);
    try { return await fn(uri); }
    finally { await this.close(uri); }
  }

  // Open, then WAIT FOR READINESS rather than sleeping a fixed interval.
  //
  // Hovers need a longer settle than the verdict: evolving `let`s type through
  // an async pass, so a hover taken before the program is built answers `any`.
  // `probe` is a declaration whose hover CANNOT legitimately be `any` (an
  // annotated or keyword declaration — see `readyProbe`), so "it answered a
  // type" is a true readiness signal. Probing an arbitrary declaration would
  // conflate a program that is not built yet with a binding that is genuinely
  // `any`, and burn the whole timeout on the latter.
  async openForHover(base, src, probe = null) {
    const uri = 'file://' + path.join(this.dir, base);
    this.claim(uri);
    try {
      this.diags.delete(uri);
      this.client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'rip', version: 1, text: src } });
      for (let i = 0; i < 60 && !this.diags.has(uri); i++) await sleep(100);
      if (!probe) { await sleep(400); return uri; }
      for (let i = 0; i < 40; i++) {
        const h = normHover(await this.client.request('textDocument/hover', {
          textDocument: { uri }, position: { line: probe.line, character: probe.character },
        }).catch(() => null));
        if (h && !/(?:^|:\s*)any$/.test(h)) return uri;   // typed: the program is built
        await sleep(100);
      }
      return uri;
    } catch (err) {
      this.release(uri);
      throw err;
    }
  }
  // An `any` here is either TIMING (the enrichment pass has not reached this
  // position) or GENUINE (a write-only local, which has no read to infer
  // from and truthfully hovers `any`). Re-ask to
  // separate them: a timing `any` clears within a poll or two, a genuine one
  // survives every retry and is reported as `any`, which is the truth.
  async hover(uri, pos) {
    const ask = async () => normHover(await this.client.request('textDocument/hover', {
      textDocument: { uri }, position: pos,
    }).catch(() => null));
    let h = await ask();
    for (let i = 0; i < 8 && /(?:^|:\s*)any$/.test(h ?? ''); i++) {
      await sleep(150);
      h = await ask();
    }
    return h;
  }
  async close(uri) {
    this.client.notify('textDocument/didClose', { textDocument: { uri } });
    await sleep(300);
    this.release(uri);
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

// ── the face-survival oracle (the mapping gap's USE-SITE surface). The token
// audit's `present`/`member` invariants enumerate SOURCE names (declarations,
// type-body members) and ask whether each got a token — a source→token check
// that structurally cannot reach USE sites or rip-native names (a reactive
// `:=` read in a render block has no column-0 declaration and no TS twin).
// `faceSurvival` reaches them by comparing three oracles by COUNT (see its
// header for why position correspondence is impossible for a dropped token):
// tsgo on the compiled FACE supplies the SET of names TypeScript classifies,
// the source supplies each classified name's code occurrences, and the real
// server (session.semanticTokens) supplies what was delivered — the deficit is
// the drop. The face is the classified-name oracle here; no twin, rip-native
// covered.
//
// Faces live in ONE shared dir named `<base>.rip.ts`, so a cross-file import
// (`from './06-functions.rip'`) resolves to its sibling face: TS appends `.ts`
// to the `.rip` specifier, which is exactly why the server's mirror carries
// that name. tsgo echoes the legend the CLIENT declares, so declare the full
// one the real server advertises (server.js `TSGO_CLIENT_CAPABILITIES`) — an
// empty declaration yields an empty legend and every token decodes to `#N`.
const FACE_TOKEN_TYPES = [
  'namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter',
  'parameter', 'variable', 'property', 'enumMember', 'event', 'function',
  'method', 'macro', 'keyword', 'modifier', 'comment', 'string', 'number',
  'regexp', 'operator', 'decorator',
];
const FACE_TOKEN_MODS = [
  'declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract',
  'async', 'modification', 'documentation', 'defaultLibrary',
];
let FACE_DIR = null;         // temp dir of `<base>.rip.ts` faces + a tsconfig
let facesAvailable = false;  // did the face oracle come up (visible to the report)
const FACES = new Map();       // file → { code, mappings } of the TS face
const FACE_ERRORS = new Map(); // file → why its in-process face:'ts' compile threw

class FaceOracle {
  async start() {
    const { client, capabilities } = await startTsgo(FACE_DIR, {
      clientCapabilities: {
        textDocument: { semanticTokens: { requests: { full: true, range: true }, formats: ['relative'], tokenTypes: FACE_TOKEN_TYPES, tokenModifiers: FACE_TOKEN_MODS } },
      },
      serverRequests: {
        'workspace/configuration': (p) => (p.items ?? []).map(() => ({})),
        'client/registerCapability': () => null,
        'client/unregisterCapability': () => null,
        'window/workDoneProgress/create': () => null,
      },
    });
    this.client = client;
    this.legend = capabilities?.semanticTokensProvider?.legend ?? null;
  }
  // Raw tsgo tokens for a fixture's FACE, decoded, PRE-remap. Open, poll for a
  // live list (tokens ride the async program build), close — one document at a
  // time, the same serial-equivalence contract the editor servers hold.
  async faceTokens(base) {
    const uri = 'file://' + path.join(FACE_DIR, base.replace(/\.rip$/, '.rip.ts'));
    const code = FACES.get(base).code;
    this.client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'typescript', version: 1, text: code } });
    // Generous ceiling (15s). The FIRST request per oracle triggers the full
    // program build over all 12 faces (09's alone is ~167KB with the inlined
    // runtime), and a timeout here surfaces downstream as a hard coverage abort
    // — so wait well past the editor side's 6s rather than fail a merely-slow
    // machine. A healthy build answers on the first poll; this ceiling is only
    // reached when something is genuinely wrong.
    let data = [];
    for (let i = 0; i < 60; i++) {
      const r = await this.client.request('textDocument/semanticTokens/full', { textDocument: { uri } }).catch(() => null);
      if (r?.data?.length) { data = r.data; break; }
      await sleep(250);
    }
    this.client.notify('textDocument/didClose', { textDocument: { uri } });
    return decodeSemanticTokens(data, this.legend);
  }
  async stop() { await this.client.stop().catch(() => {}); }
}

// FACE-SURVIVAL for one fixture — COUNT-BASED, no position correspondence.
//
// A dropped token's source position is UNRECOVERABLE: it drops precisely
// because it sits past a byte divergence on a cover row, and there both map
// directions collapse to the row's start (the `total` use maps to the `(`
// before its string, not the name). So any position-based classifier fails —
// arithmetic under-counts, cover-span over-counts. Do not correspond by
// position at all. Instead compare COUNTS, with the real server as the delivery
// oracle (no remap is reimplemented, so there is nothing to drift):
//   · classified   the SET of names tsgo tokenizes on the face — position-free,
//                   just "does TS ever classify this name" (excludes keywords).
//   · realOcc(n)   source CODE occurrences of a classified name (codeMask
//                   blanks string LITERALS but keeps `#{…}` interpolation reads,
//                   across lines, so only real code positions count).
//   · delivered(n) tokens the SERVER actually shipped for that name
//                   (session.semanticTokens — the ground truth for drops).
//   drop(n) = max(0, realOcc(n) - delivered(n)); a synthetic face token (a
//   `.value` unwrap, a generic re-instantiation) never adds a source occurrence,
//   so it cannot inflate the count. Name FLOOR (length >= 2) as before.
//
// A silent DRIFT guard rides along: `delivered ⊆ classified` holds by
// construction (the server derives its tokens from tsgo classifying the same
// face), so it is near-tautological — its only teeth are catching THIS
// standalone FaceOracle's tsgo drifting from the server's. `unclassified`
// counts violators; it surfaces only if nonzero, never as an always-ok line.
const FACE_IDENT = /^[A-Za-z_$][\w$]*$/;
// Whole-source code mask for the occurrence scan: blank STRING-LITERAL bytes
// but KEEP `#{…}` interpolation expressions (a read inside an interpolation is
// real code), track string state ACROSS lines (a multi-line template's body
// stays blanked), and cut comments — all offset-preserving. Unlike the per-line
// `codeOf`, which cannot see a multi-line string and blanks interpolations
// wholesale. Single-quoted strings do not interpolate, so `#{` inside one is
// literal. Interpolation depth is tracked per string on a stack, so nested
// strings/braces inside `#{…}` resolve correctly.
function codeMask(src) {
  const out = [];
  const stack = [];   // string contexts: { delim, interp, brace } — brace>0 ⇒ inside its #{…}
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const top = stack[stack.length - 1];
    if (top && top.brace === 0) {                              // inside a string LITERAL
      if (c === '\\') { out.push(' '); if (i + 1 < src.length) { out.push(' '); i++; } continue; }
      if (c === top.delim) { stack.pop(); out.push(c); continue; }
      if (top.interp && c === '#' && src[i + 1] === '{') { top.brace = 1; out.push(' ', ' '); i++; continue; }
      out.push(c === '\n' ? '\n' : ' ');                       // literal content — blank, keep newlines
      continue;
    }
    if (top && top.brace > 0) {                                // interpolation code — track its braces
      if (c === '{') { top.brace++; out.push(c); continue; }
      if (c === '}') { top.brace--; out.push(top.brace === 0 ? ' ' : c); continue; }
    }
    if (!stack.length && c === '#' && src[i + 1] !== '{') {    // comment (top-level only)
      while (i < src.length && src[i] !== '\n') { out.push(' '); i++; }
      i--; continue;                                           // leave the newline for the loop
    }
    if (c === "'" || c === '"' || c === '`') { stack.push({ delim: c, interp: c !== "'", brace: 0 }); out.push(c); continue; }
    out.push(c);
  }
  return out.join('');
}
// rip DECLARATION keywords whose spelling is ALSO a common property name, so a
// source-word count cannot tell the keyword from the identifier (`type X =` vs
// `type: 'a'`). Excluded wholesale — a few genuine property-`type` drops are
// forgone rather than count every `type`/`interface`/`class` header as one. The
// OPERATOR keywords (`is`/`for`/`in`/`when`/…) need no list: the editor never
// tokens them, so the `delivered >= 1` gate below drops them for free.
const RIP_KEYWORDS = new Set(['type', 'interface', 'class', 'enum', 'def', 'component', 'schema', 'render', 'extends', 'implements', 'import', 'export', 'namespace', 'module']);
function faceSurvival(src, code, faceDecoded, serverTokens) {
  const genStarts = lineStartsOf(code);
  const srcStarts = lineStartsOf(src);
  const classified = new Set();
  for (const t of faceDecoded) {
    const nm = code.slice(genStarts[t.line] + t.character, genStarts[t.line] + t.character + t.length);
    if (FACE_IDENT.test(nm) && nm.length >= 2 && !RIP_KEYWORDS.has(nm)) classified.add(nm);
  }
  const delivered = new Map();
  let unclassified = 0;
  for (const t of (serverTokens ?? [])) {
    const nm = src.slice(srcStarts[t.line] + t.character, srcStarts[t.line] + t.character + t.length);
    if (!FACE_IDENT.test(nm) || nm.length < 2 || RIP_KEYWORDS.has(nm)) continue;
    if (!classified.has(nm)) unclassified++;   // server shipped a name TS never classifies
    delivered.set(nm, (delivered.get(nm) ?? 0) + 1);
  }
  const realOcc = new Map();
  for (const nm of codeMask(src).match(/[A-Za-z_$][\w$]*/g) ?? []) {
    if (nm.length >= 2 && classified.has(nm)) realOcc.set(nm, (realOcc.get(nm) ?? 0) + 1);
  }
  let survived = 0;
  const drops = [];   // { name, count } — a name the editor colors somewhere that loses tokens at some uses
  for (const [nm, occ] of realOcc) {
    const got = delivered.get(nm) ?? 0;
    survived += Math.min(occ, got);
    // A use-site drop is a COLORED identifier losing its token at a use; if the
    // editor never tokens the name (got 0) there is no use-site token to lose —
    // it is a keyword or a fully-dropped decl (the `member` gauge's job).
    if (occ > got && got > 0) drops.push({ name: nm, count: occ - got });
  }
  const dropCount = drops.reduce((n, d) => n + d.count, 0);
  return { survived, dropCount, drops, unclassified };
}

// The declaration to poll for READINESS: one whose hover cannot legitimately be
// `any`, so "it answered a type" means the program is built and nothing else.
// A keyword declaration (`def`/`class`/`interface`/`enum`/`type`) or an
// annotated binding qualifies; a bare `x = …` does not, because a write-only
// local genuinely hovers `any` and polling it would wait out the
// full timeout on a correct answer. `null` when a fixture offers neither.
const readyProbe = (decls) =>
  decls.find((d) => d.keyword)
  ?? decls.find((d) => new RegExp(`^${d.name}\\s*:`).test(d.code))
  ?? null;

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

// ── mapping machinery (the Mapping Audit): walk every source identifier and
// ask the compiler's own rows where it lands.
//
// Reserved words are excluded WHOLESALE. A keyword-spelled property read
// (`x.type`, `promise.then`) is forgone rather than count every `if`/`for`/
// `type` header as a use site — the same trade `faceSurvival`'s RIP_KEYWORDS
// makes, one step wider (it needs only declaration heads; this walk also meets
// control-flow and operator keywords). The cost is a handful of false
// NEGATIVES, never a false positive: a real read that happens to be spelled
// like a keyword is skipped, but nothing correct is ever flagged.
const MAP_RESERVED = new Set([
  'if', 'unless', 'else', 'elif', 'for', 'in', 'of', 'while', 'until', 'loop',
  'switch', 'when', 'then', 'return', 'throw', 'try', 'catch', 'finally',
  'break', 'continue', 'new', 'typeof', 'instanceof', 'delete', 'void', 'await',
  'yield', 'do', 'import', 'export', 'from', 'as', 'default', 'let', 'const',
  'var', 'function', 'class', 'extends', 'implements', 'interface', 'enum',
  'type', 'namespace', 'module', 'def', 'component', 'schema', 'render', 'and',
  'or', 'not', 'is', 'isnt', 'true', 'false', 'null', 'undefined', 'this',
  'super', 'with', 'case', 'by',
]);

// Every identifier in real CODE, as { name, offset }. `codeMask` blanks string
// LITERALS and comments (offset-preserving) while KEEPING `#{…}` interpolation
// reads, so a name inside a template's `#{…}` counts and a keyword inside a
// comment does not. Reserved words are dropped here so the caller never sees
// them.
function* identReads(src) {
  const masked = codeMask(src);
  const re = /[A-Za-z_$][\w$]*/g;
  let m;
  while ((m = re.exec(masked))) {
    if (MAP_RESERVED.has(m[0])) continue;
    yield { name: m[0], offset: m.index };
  }
}

// The scan for one fixture. For each read: `placed` is whether the PRECISE map
// (the definition/rename resolver) answers at the read's start; `text` is
// whether the position it answers holds the read's own bytes. A read is healthy
// iff both hold. Every failure is tagged with the ROW it fell to (bestAtSource,
// which for a failing read is always the innermost COVER — a direct row would
// have placed it) and a ROOT:
//   · rewrite    a string literal sits between the cover's start and the read.
//                The compiler re-renders every literal double-quoted with
//                escapes recomputed, so the cover's verbatim prefix breaks at
//                that quote and the precise map refuses. (`text` never fails
//                this way — an unplaced read has no resolved position to be
//                wrong about — so rewrite is an `unplaced`-only root.)
//   · synthetic  everything else: the mark's generated span carries glyphs its
//                source span does not (an inserted `(`, a brace-lowered `{`, a
//                `.value` unwrap), so byte arithmetic lands on the wrong text.
//                The dominant class.
// The rewrite test is a source predicate (a quote in the cover prefix), not a
// diff of the two texts — coarse, but it reproduces the split the prototype
// found and never misfires on a read with no literal before it.
//
// A read with NO containing row at all is the pathological third case, and it
// is routed to `missingRows`, NOT `rows`: it is worse than at-risk (no span,
// not merely no exact one), a class the prototype never saw, so it is counted
// apart and never folded into the census or the unplaced/mistext tallies, which
// speak about reads that HAVE a span. The audit proves the class empty afresh
// each run.
function mappingScan(src, code, mappings) {
  const rows = [];         // flagged reads WITH a containing row (unplaced/mistext)
  const missingRows = [];  // flagged reads with NO row at all — counted apart
  let total = 0, census = 0, byLuck = 0;
  for (const { name, offset } of identReads(src)) {
    total++;
    const g = sourceOffsetToGeneratedExact(mappings, offset, src, code);
    const placed = g !== null;
    const text = g === null ? true : code.slice(g, g + name.length) === name;
    const flagged = !(placed && text);
    // One source-tree stab, reused for every question below — the missing check,
    // the census, and the cover row — rather than a `bestAtSource` plus a
    // separate `atSource`. `at` is empty iff nothing contains the offset, which
    // is exactly what `bestAtSource` returns null for.
    const at = mappings.atSource(offset);
    if (at.length === 0) { missingRows.push({ name, offset, placed }); continue; }   // no span ⟹ flagged; kept out of census
    // The CENSUS — #21's at-risk population: reads with no EXACT row. Byte
    // arithmetic is verbatim only inside an exact row; everything else resolves
    // today only while a cover prefix stays verbatim through it, one face rewrite
    // from breaking. The count is MITIGATION-PROOF: only real source spans reduce
    // it, never a downstream resolver tweak. A flagged read is ALWAYS in the
    // census, by construction — an exact row containing the offset WOULD have
    // resolved it (synthetic rows are zero-width on the SOURCE side, so they
    // never enter `at` and `directAtSource` returns only exact rows) — so
    // census ≥ flagged and byLuck = census − flagged. The audit checks that
    // identity after the run rather than trusting it (see the census guard).
    const noExact = !at.some((r) => r.mappingKind === 'exact');
    if (noExact) { census++; if (!flagged) byLuck++; }
    if (!flagged) continue;
    // The innermost containing row — and for a flagged read this IS bestAtSource,
    // since no direct row applies here (an exact one would have resolved the read,
    // and synthetic rows are zero-width source, so `at` holds only covers).
    const row = at[0];
    const root = /['"`]/.test(src.slice(row.sourceStart, offset)) ? 'rewrite' : 'synthetic';
    // `gen`/`hit` make the failure self-describing under --v: where the precise
    // map landed (null if it refused) and the bytes actually sitting there — for
    // a mistext, the wrong text a hover at this read would answer about.
    rows.push({ name, offset, placed, text, role: row.role, root, gen: g, hit: g === null ? null : code.slice(g, g + name.length) });
  }
  return { total, rows, missingRows, census, byLuck };
}

// ── run
const fixtures = fs.readdirSync(FIX).filter((f) => f.endsWith('.rip')).sort();
// The Diagnostics Lane's fixtures, listed here beside the flat walk so the
// pool below can size itself to the lane's workload.
const errorFixtures = fs.existsSync(ERRD) ? fs.readdirSync(ERRD).filter((f) => f.endsWith('.rip')).sort() : [];
// ── shared presentation helpers
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => paint('1', s);
const dim = (s) => paint('2', s);
const green = (s) => paint('32', s);
const red = (s) => paint('31', s);
const yellow = (s) => paint('33', s);
const pad = (s, n) => String(s).padEnd(n);
// The Type Audit's grid is the widest thing this runner prints, so its natural
// width — the fixture column plus every dimension column — IS the report's
// width, and every rule derives from it. No rule carries a hand-picked number:
// two independently chosen widths agree only by luck, and stop agreeing the
// moment a column moves.
// Sized to the longest fixture name — a fixed width misaligns every column to
// its right the moment a longer name lands. 18 is the floor.
const NAME_W = Math.max(18, ...fixtures.map((f) => f.length));
const DIMS = [['compiles', 10], ['directives', 12], ['verdict', 10], ['runtime', 9], ['twin', 8], ['strict', 8]];
const RULE_W = NAME_W + 1 + DIMS.reduce((a, [, w]) => a + w, 0) + (DIMS.length - 1);

// The sections scroll past in one `--all` run, so each needs a seam that
// survives the wall of rows above it. The title rides in a reverse-video chip
// (legible without spending colour, which is reserved for status), the subtitle
// sits beside it, and a dotted rule CLOSES the header block: the break belongs
// between title and content, which is where the eye needs it, not between one
// section and the last.
//
// `1;7` is bold INSIDE the chip. Bold-under-reverse is terminal-dependent (some
// render a heavier glyph; others implement bold as a brighter foreground, which
// reverse swaps into a brighter background), so if this reads thin, the fix is
// an explicit pair like `1;30;47` — bold black on white, never using reverse.
const auditBanner = (title, subtitle) => {
  console.log(`\n\n  ${paint('1;7', ` ${title} `)}${subtitle ? '  ' + dim(subtitle) : ''}`);
  console.log(`  ${dim('┈'.repeat(RULE_W))}\n`);
};

// ── the server pool: ONE EDITOR SERVER PER LANE.
//
// This is the determinism argument, and it is worth stating plainly.
//
// A server holds at most one open document — `EditorServer.claim` throws
// otherwise — so a document is only ever probed ALONE. Serial satisfies that
// with one server; concurrent satisfies it with N. Every probe therefore runs
// against a program of the same SHAPE either way, and the concurrent result
// cannot differ from the serial one. Concurrency lives BETWEEN servers, never
// inside a program.
//
// That distinction is load-bearing, not pedantry: the open-document set really
// does change what a server answers — the auto-import candidate set IS the
// open program. A pool shared across lanes would put four
// documents in one program and make the equivalence an empirical accident, to be
// re-established by diffing outputs. Here it is a property of the code.
//
// The cost is N server processes. That is the price of the guarantee, and the
// lanes pay it out of time they would otherwise spend idle.
// Skipped entirely when no running audit opens a document (Mapping and Grammar
// read compiler/parser output alone), sized to the widest workload the
// running audits actually have (a bare --errors run over one fixture boots one
// server, not LANES), and STARTED WITHOUT AWAITING — the serverless sections
// run while the servers boot, and each server-driven section awaits readiness
// on entry. The early .catch only parks the rejection so a boot failure
// surfaces at that await, not as an unhandled rejection mid-Grammar-Gate.
const POOL_SIZE = NEED_SERVER
  ? Math.min(LANES, Math.max(1,
      (RUN_MAIN || RUN_HOVER || RUN_TOKENS) ? fixtures.length : 0,
      RUN_ERRORS ? errorFixtures.length : 0))
  : 0;
const poolP = Promise.all(Array.from({ length: POOL_SIZE }, async () => {
  const s = new EditorServer();
  await s.start();
  return s;
}));
poolP.catch(() => {});
let pool = [];

// A coverage shortfall is not a low score — it means the audit did not run over
// what it claims to cover, and every ratio below it is a fraction of the wrong
// denominator. That must never print green, so it exits non-zero before any
// score is reported.
async function abort(headline, reasons) {
  await Promise.all(pool.map((s) => s.stop()));
  console.error(`\n✗ ${headline} — nothing it reports would be trustworthy:`);
  for (const r of reasons) console.error(`  • ${r}`);
  console.error(`\n  Every score is a ratio of what was CHECKED, so a missing fixture reads as full marks.`);
  console.error(`  Re-run with --serial to rule out the concurrent pass.\n`);
  process.exit(1);
}

// ── AUDIT RUN ORDER — bottom-up by instrument layer, so under --all each
// section's failures explain the one after it: the Grammar Gate (can the
// parser even reduce it) and the Mapping Audit (do the compiler's own rows
// place every read) run first and need no server; then the Type Audit (the
// face and its verdict), the Diagnostics Lane (each diagnostic's code and
// position), and last the probe pass driving the slow LSP surfaces (hover,
// tokens). The Totals at the bottom print in this same order.
// ── the Grammar Gate (ROADMAP "M2"): which productions the corpus exercises.
// Parser only — no compile, no server. Each fixture is parsed with an
// instrumented Parser whose ctx.onReduce records every rule the parse reduces;
// the denominator is the generated parser's own ruleNames table (index 0 is
// the $accept pad), so the question "is every production exercised by at least
// one fixture?" has a CLOSED answer no corpus-relative rate can give. The
// uncovered list is the M3 fixture-growth queue — group it by LHS so a reader
// sees which CONSTRUCTS are dark, not 200 interchangeable rows. Coverage here
// is necessary, not sufficient: a rule can be exercised while its interaction
// shapes (reorder × repetition, strings/comments in the frame) stay untested —
// those are M3's adversarial tranche, not this gate's denominator.
let gr = null;
if (RUN_GRAMMAR) {
  const names = Parser().ruleNames;
  // Productions no fixture can or should ever reduce, netted out of the
  // denominator. This table is the GATE'S own record — part of the
  // measurement, so it lives with the instrument and outlives the manifest,
  // whose sections are grouping only. Two classes: LEXICALLY UNREACHABLE —
  // the lexer mints TYPE_PARAMS only when the angle run's `=` is immediately
  // followed by `component` on the same line, so the line-break layout
  // variants of the assignment cross-product can never receive the token —
  // and BANNED BY DESIGN — the emitter rejects a for loop that binds no
  // variable, and the productions stay in the grammar as that error
  // message's carrier. Self-policing against grammar drift: an excluded
  // production a fixture reduces paints red (the exclusion claim is false),
  // and a row naming no grammar production paints red (the row is stale), so
  // a grammar change trims this table rather than being absorbed by it.
  const EXCLUDED = new Map([
    ['Assign → Assignable TYPE_PARAMS = TERMINATOR Expression', 'lexically unreachable — TYPE_PARAMS is minted only for same-line `= component`'],
    ['Assign → Assignable TYPE_PARAMS = INDENT Expression OUTDENT', 'lexically unreachable — TYPE_PARAMS is minted only for same-line `= component`'],
    ['ExportAssign → Identifier TYPE_PARAMS = TERMINATOR Expression', 'lexically unreachable — TYPE_PARAMS is minted only for same-line `= component`'],
    ['ExportAssign → Identifier TYPE_PARAMS = INDENT Expression OUTDENT', 'lexically unreachable — TYPE_PARAMS is minted only for same-line `= component`'],
    ['For → FOR Range Block', 'banned by design — the emitter rejects a for loop that binds no variable'],
    ['For → FOR Range BY Expression Block', 'banned by design — the emitter rejects a for loop that binds no variable'],
  ]);
  // The M3 manifest: grouping only — the decision record of which corpus file
  // owns each construct's productions, with per-production overrides for
  // bridges that carry another family's construct. The MEASUREMENT above and
  // below is untouched by it. A production the manifest fails to allocate
  // paints red as UNALLOCATED — a grammar change demands an ownership
  // decision, never a silent default — and a malformed manifest refuses
  // rather than degrading. With no manifest (post-M3, once it is deleted),
  // grouping is by LHS construct: the unit a fixture author thinks in.
  const MANIFEST = path.join(HERE, 'MANIFEST.md');
  let owner = null;
  if (fs.existsSync(MANIFEST)) {
    owner = { constructs: new Map(), overrides: new Map(), parked: new Set() };
    let section = null;
    for (const line of fs.readFileSync(MANIFEST, 'utf8').split('\n')) {
      if (line.startsWith('## ')) { section = line.slice(3).trim(); continue; }
      const m = line.match(/^\| (.+?) \| ([^|]+?) \|/);
      if (!m) continue;
      // Cells may be pad-aligned by an editor; keys must be trimmed or every
      // lookup silently misses and the whole queue paints UNALLOCATED.
      const cell = m[1].trim();
      if (cell === 'construct' || cell === 'production' || cell.startsWith('---')) continue;
      const key = cell.replace(/^`|`$/g, '');
      if (section === 'Constructs') owner.constructs.set(key, m[2].trim());
      else if (section === 'Overrides') owner.overrides.set(key, m[2].trim());
      else if (section === 'Parked') owner.parked.add(key);
    }
    if (!owner.constructs.size) {
      console.error(`\n✗ MANIFEST.md exists but its Constructs table parsed empty — fix the manifest (or delete it for construct grouping); refusing to report against a broken allocation.`);
      process.exit(1);
    }
  }
  const denom = [], excludedIdx = [];
  for (let i = 1; i < names.length; i++) {
    if (!names[i]) continue;
    if (EXCLUDED.has(names[i])) excludedIdx.push(i); else denom.push(i);
  }
  const grammarNames = new Set(names.filter(Boolean));
  const staleExcluded = [...EXCLUDED.keys()].filter((k) => !grammarNames.has(k));
  auditBanner('GRAMMAR GATE', `productions the corpus reduces · ${denom.length} rules${excludedIdx.length ? ` (${excludedIdx.length} excluded)` : ''} · ${fixtures.length} fixtures`);
  const seen = new Set();
  for (const f of fixtures) {
    const before = seen.size;
    const p = Parser({ onReduce: (id) => seen.add(id) });
    p.lexer = makeParserLexer(path.join(FIX, f));
    try {
      p.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));
      console.log(`    ${green('✓')} ${pad(f, NAME_W + 2)} ${dim(`+${seen.size - before} new rules (${seen.size} cumulative)`)}`);
    } catch (e) {
      console.log(`    ${red('✗')} ${pad(f, NAME_W + 2)} ${dim(`parse failed — ${String(e.message ?? e).split('\n')[0]}`)}`);
    }
  }
  const uncovered = denom.filter((i) => !seen.has(i));
  const groupOf = (prod) => owner
    ? (owner.overrides.get(prod) ?? owner.constructs.get(prod.split(' → ')[0]) ?? 'UNALLOCATED')
    : prod.split(' → ')[0];
  const groups = new Map();
  for (const i of uncovered) {
    const g = groupOf(names[i]);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(names[i]);
  }
  console.log(`\n    ${bold('Coverage')} ${dim(`(exercised = reduced by at least one fixture)`)}`);
  const pct = ((100 * (denom.length - uncovered.length)) / denom.length).toFixed(1);
  console.log(`    ${(uncovered.length ? yellow : green)(String(denom.length - uncovered.length))} ${dim('/')} ${dim(String(denom.length))} ${dim(`productions (${pct}%)`)}`);
  if (excludedIdx.length) {
    console.log(`    ${dim(`${excludedIdx.length} excluded by the gate (unreachable or banned spellings) — netted from the denominator${VERBOSE ? '' : '; --v lists them'}`)}`);
    if (VERBOSE) for (const i of excludedIdx) console.log(`        ${dim(names[i])} ${dim('·')} ${dim(EXCLUDED.get(names[i]))}`);
  }
  const falseExclusions = excludedIdx.filter((i) => seen.has(i));
  for (const i of falseExclusions) console.log(`    ${red('✗')} ${red('excluded but reduced:')} ${names[i]} ${dim("— the exclusion claim is false; fix the gate's exclusion table")}`);
  for (const k of staleExcluded) console.log(`    ${red('✗')} ${red('excluded row names no grammar production:')} ${k} ${dim("— stale; fix the gate's exclusion table")}`);
  if (groups.size) {
    const title = owner ? 'Uncovered, by owning file (MANIFEST.md)' : 'Uncovered, by construct';
    console.log(`\n    ${bold(title)} ${dim(`— the M3 queue; ${VERBOSE ? 'every production shown' : 'counts only, --v for every production'}`)}`);
    // Files read in wave order; constructs by descending count.
    const rows = [...groups.entries()].sort(owner ? (a, b) => a[0].localeCompare(b[0]) : (a, b) => b[1].length - a[1].length);
    for (const [g, rules] of rows) {
      const paint = g === 'UNALLOCATED' ? red : yellow;
      console.log(`      ${pad(g, 24)} ${paint(String(rules.length).padStart(3))}`);
      if (VERBOSE || g === 'UNALLOCATED') for (const r of rules) console.log(`        ${dim(r)}${owner?.parked.has(r) ? ' ' + yellow('· parked') : ''}`);
    }
  }
  gr = { total: denom.length, covered: denom.length - uncovered.length, uncovered: uncovered.length, groups: groups.size, groupKind: owner ? 'files' : 'constructs', unallocated: groups.get('UNALLOCATED')?.length ?? 0, excluded: excludedIdx.length, badExclusions: falseExclusions.length + staleExcluded.length };
}

// ── the Mapping Audit (--map / --all): use-site identifier coverage, from the
// compiler's own rows. No server, no tsgo, no twin — so it runs here, before
// the probe pass spins up any of them.
let mp = null;
if (RUN_MAP) {
  auditBanner('MAPPING AUDIT', `use-site identifier coverage · compiler output only · ${fixtures.length} files`);

  const perFile = [];
  const byRootRole = { synthetic: new Map(), rewrite: new Map() };
  let totReads = 0, totFlag = 0, unplaced = 0, mistext = 0, missing = 0, census = 0, byLuck = 0;
  const missingRows = [];   // flagged reads with no containing row — the pathological class
  const skips = [];

  for (const f of fixtures) {
    const full = path.join(FIX, f);
    const src = fs.readFileSync(full, 'utf8');
    let scan;
    try {
      // The SAME compile the server's `faceOf` and the survival oracle use, so
      // the rows walked here are the exact rows the editor remaps through.
      const { code, mappings } = compile(src, { path: full, runtimeDelivery: 'inline', face: 'ts' });
      scan = mappingScan(src, code, mappings);
    } catch (e) {
      // A fixture that will not compile has no face to walk. Surfaced, never
      // silent: a shrinking denominator is exactly what the coverage line below
      // exists to make visible.
      skips.push(f);
      console.log(`    ${yellow('skip')} ${pad(f, NAME_W + 2)} ${dim('does not compile — no face to walk: ' + ((e && e.message) || e))}`);
      continue;
    }
    // Only `starts` is kept for the --v listing; `src` is not retained (nothing
    // reads it back), and `walked` is just `perFile.length`.
    perFile.push({ f, ...scan, starts: lineStartsOf(src) });
    totReads += scan.total;
    totFlag += scan.rows.length;
    census += scan.census;
    byLuck += scan.byLuck;
    for (const r of scan.rows) {
      if (r.placed) mistext++; else unplaced++;
      const roleKey = r.role ?? 'NONE';
      byRootRole[r.root].set(roleKey, (byRootRole[r.root].get(roleKey) ?? 0) + 1);
    }
    // Missing-span reads are their own class — counted here alone, never in the
    // unplaced/mistext/census tallies above.
    missing += scan.missingRows.length;
    for (const r of scan.missingRows) missingRows.push({ f, ...r });
    const flagged = scan.rows.length;
    console.log(`    ${flagged === 0 ? green('✓') : yellow('•')} ${pad(f, NAME_W + 2)} ${dim(pad(scan.total + ' reads', 12))}`
      + (flagged === 0 ? green('all placed') : yellow(`${flagged} unmapped`)));
  }

  console.log(`\n    ${green('✓')} ${dim(`coverage: ${perFile.length} of ${fixtures.length} fixture(s) walked${skips.length ? `, ${skips.length} skipped (no face)` : ''}, ${totReads} reads`)}`);

  // ── the two invariants. Every failure is one or the other, never both: a
  // rewrite REFUSES (no resolved position to hold wrong text), mark-width
  // RESOLVES to the wrong bytes — so `unplaced` and `mistext` partition the
  // flagged set, and each is the root the other cannot catch.
  console.log(`\n  ${bold('Invariants')} ${dim(`(${totFlag} of ${totReads} reads unmapped — every position from the compiler's own rows)`)}`);
  const invLine = (label, n, note) =>
    console.log(`    ${pad(label, 10)} ${(n === 0 ? green : yellow)(String(n).padStart(4))}   ${dim(note)}`);
  invLine('unplaced', unplaced, '`placed` fails — the precise map REFUSES, a rewrite breaks the cover\'s verbatim prefix');
  invLine('mistext', mistext, '`text` fails — resolves, but to the WRONG bytes: mark-width, so a hover at the use site names the wrong symbol');

  // ── the CENSUS — the gate the ledger's identifier-read finding asks for:
  // reads with no exact row, the at-risk population, and the MITIGATION-PROOF
  // one. `unplaced`/`mistext` count the reads broken TODAY; the census is the
  // superset that also holds the ones resolving today only by a verbatim cover
  // prefix (byLuck), each one face rewrite from breaking. Only giving reads real
  // source spans drives it to zero — no downstream resolver tweak can — which is
  // why THIS number is the gate, not the symptom count. Same mapping rows, no
  // server, no oracle.
  console.log(`\n  ${bold('Census')} ${dim('(reads with no exact row — the mitigation-proof at-risk population)')}`);
  console.log(`    ${pad('census', 10)} ${(census === 0 ? green : yellow)(String(census).padStart(4))}   ${dim(`of ${totReads} reads — ${totFlag} broken today (flagged above) + ${byLuck} resolving by luck (one face rewrite from breaking)`)}`);
  // The decomposition is exact BY CONSTRUCTION — a flagged read always lacks an
  // exact row (see mappingScan) — so census === broken-today + by-luck. Checked,
  // not assumed: it rests on the compiler keeping synthetic rows zero-width on
  // the source side, and if that ever changed a flagged read could fall inside
  // an exact row and the split would silently misreport. Surface the drift.
  if (census !== totFlag + byLuck) {
    console.log(`    ${red('✗')} ${dim(`census decomposition off: ${census} ≠ ${totFlag} broken + ${byLuck} by-luck — a flagged read sits in an exact row (a compiler-invariant regression, not a corpus change)`)}`);
  }

  // ── the two roots, each with the roles it bit (the row every failure fell
  // to). The counts are live and the ordering is by weight, so the dominant
  // class names itself.
  // Role breakdown only when a root bit something — empty maps used to print
  // a lone "—" under each zero, which reads as noise once the census is clean.
  const roleBreak = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([role, n]) => `${role} ${n}`).join(', ');
  const rootTotal = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  console.log(`\n  ${bold('Roots')} ${dim('(classified from the mapping row each read fell to)')}`);
  const rootLine = (label, n, note, roles) => {
    console.log(`    ${pad(label, 10)} ${(n === 0 ? green : yellow)(String(n).padStart(4))}   ${dim(note)}`);
    if (roles) console.log(`    ${' '.repeat(15)}${dim(roles)}`);
  };
  rootLine('synthetic', rootTotal(byRootRole.synthetic), 'a mark carries glyphs its source span does not', roleBreak(byRootRole.synthetic));
  rootLine('rewrite', rootTotal(byRootRole.rewrite), 'a string literal re-rendered double-quoted', roleBreak(byRootRole.rewrite));

  // ── the one structural invariant that IS load-bearing: no flagged read may
  // lack a containing row. Every failure above is a span that EXISTS and is
  // wrong; a read with no span would be a genuinely missing mapping — a class
  // the prototype never saw. This is a gauge, not a gate, so a nonzero count
  // does not abort — but it prints red and names every offender, because it
  // would be a NEW finding, not a known one.
  if (missing === 0) {
    console.log(`\n  ${green('✓')} ${dim(`every flagged read has a containing row — no genuinely missing span`)}`);
  } else {
    console.log(`\n  ${red('✗')} ${bold(`${missing} flagged read(s) with NO containing row`)} ${dim('— a missing span, a new class not seen before:')}`);
    for (const r of missingRows.slice(0, 10)) console.log(`      ${red('·')} ${bold(r.name)} ${dim(`@ ${r.f} offset ${r.offset}`)}`);
    if (missingRows.length > 10) console.log(`      ${dim(`… ${missingRows.length - 10} more`)}`);
  }

  // ── --v: every flagged read, per fixture, made self-describing so it can be
  // verified by hand. Each row names the invariant it broke (`unplaced` = the
  // precise map refused; `mistext` = it resolved to the wrong bytes), the root,
  // the mapping row's role, and — for a mistext — the face bytes it landed on,
  // which is exactly what a hover at that position would answer about. Cross-
  // check any row against the real editor by hovering `line:col` in the fixture.
  if (VERBOSE && totFlag) {
    console.log(`\n  ${bold('Flagged reads')} ${dim('(--v — every one, so each can be checked against the editor at its line:col)')}`);
    for (const pf of perFile) {
      if (!pf.rows.length) continue;
      console.log(`\n    ${bold(pf.f)} ${dim(`(${pf.rows.length})`)}`);
      for (const r of pf.rows) {
        const { line, character } = offsetToPosition(pf.starts, r.offset);
        const where = dim(`${String(line + 1).padStart(3)}:${String(character).padEnd(3)}`);
        const inv = r.placed ? yellow('mistext ') : yellow('unplaced');
        const detail = r.placed
          ? dim(`maps onto ${JSON.stringify(r.hit)}`)               // the wrong bytes a hover would read
          : dim('the precise map refuses');
        console.log(`      ${where} ${bold(pad(r.name, 16))} ${inv} ${dim(pad(r.root, 10))} ${dim(pad(r.role ?? '—', 12))} ${detail}`);
      }
    }
  }

  // Exactly what the combined-totals line reads — no dead fields carried on the
  // signal object (perFile, byLuck, skips, walked were all retained for nothing).
  mp = { totReads, totFlag, unplaced, mistext, missing, census,
         synthetic: rootTotal(byRootRole.synthetic), rewrite: rootTotal(byRootRole.rewrite) };

  // No calibration runs here, and that is deliberate: trusting the instrument is
  // a ONE-TIME act, not a per-run one. The walk's logic was validated against
  // the real editor once (2026-07-17, driven — see ROADMAP.md "M1"), and the
  // code doesn't drift on its own. So the audit ships STANDALONE — no server,
  // ever, under any flag. If the mapping internals it reads change (codeMask,
  // the skip list, or translate.js's precise resolver), RE-VALIDATE by
  // recovering that driven cross-check from git rather than paying for a wired
  // server dependency on every run. Standalone is the whole identity of this
  // audit; a permanent server tie-in — even a cheap one — would blur it for a
  // check the manual gauge fires only when someone runs it anyway.
}

// ── the Type Audit (dims 1–6) — the default; skipped when another audit is named without --all
let totalPass = 0, totalApplicable = 0, fails = 0;
if (RUN_MAIN) {
  const glyph = { pass: ['✓', green('✓')], fail: ['✗', red('✗')], skip: ['skip', yellow('skip')], '—': ['·', dim('·')], 'n/a': ['·', dim('·')] };
  const cell = (s, n) => { const [v, col] = glyph[s] ?? [String(s), dim(String(s))]; return col + ' '.repeat(Math.max(0, n - v.length)); };
  const dims = DIMS;

  pool = await poolP;
  // Print the header immediately, then stream each fixture's row as it
  // is computed, so the report fills in live.
  auditBanner('TYPE AUDIT', `${fixtures.length} fixtures × ${dims.length} dimensions`);
  console.log('  ' + dim(pad('fixture', NAME_W) + ' ' + dims.map(([d, w]) => pad(d, w)).join(' ')));
  console.log('  ' + dim('─'.repeat(RULE_W)));

  // Both batch passes are independent of each other AND of the per-fixture
  // lanes, so they are KICKED OFF here and awaited inside the row that first
  // needs them: a fixture's compile + runtime spawns overlap the tsc and
  // `rip check` passes instead of queueing behind them. Serially these two
  // added a dead stare at a bare header before the first row could print,
  // which is precisely what the streaming grid exists to avoid.
  const twinP = runTwinTsc();        // one strict tsc pass over all twins
  const strictP = runStrictCheck();  // one rip.strict `rip check` pass over all fixtures

  // Fixtures run a few at a time — each row is mostly waiting (a compiler spawn,
  // the server's program build, two runtime spawns). Rows still PRINT in fixture
  // order: `lanes` resolves in index order, so the grid fills top-to-bottom even
  // though the work finishes out of order.
  const rows = await lanes(fixtures, async (f, _i, lane) => {
    const ripPath = path.join(FIX, f);
    const twinBase = ['.tsx', '.ts'].map((e) => f.replace(/\.rip$/, e)).find((b) => fs.existsSync(path.join(FIX, b)));
    const src = fs.readFileSync(ripPath, 'utf8');

    const c = await dimCompiles(ripPath);
    const row = { name: f, compiles: c.ok ? 'pass' : 'fail', compileDetail: c.detail };

    if (c.ok) {
      const sd = countDirectives(src), fd = countDirectives(c.face);
      row.directives = sd === fd ? 'pass' : 'fail';
      row.dirDetail = sd === fd ? `${fd}` : `src=${sd} face=${fd} (lost ${sd - fd})`;

      // Count ERROR-severity only. Unused-local and deprecation arrive
      // as Hint severity (fade/strikethrough, not a type error) and are
      // expected on the fixtures' intentionally-unused bindings.
      //
      // The verdict and the runtime dimension do not touch each other — one
      // asks the server, the other spawns two processes — so overlap them.
      const [ds, rt] = await Promise.all([
        pool[lane].verdict(f, src).then((all) => all.filter((d) => (d.severity ?? 1) <= 2)),
        dimRuntime(ripPath, twinBase ? path.join(FIX, twinBase) : null),
      ]);
      row.verdict = ds.length === 0 ? 'pass' : 'fail';
      row.verdictDetail = ds.length === 0 ? '0 errors' : `${ds.length} unexpected`;
      row.diags = ds;
      row.runtime = rt.status;
      row.runtimeDetail = rt.detail;

      const strict = await strictP;
      if (strict.broken) await abort('The strict dimension could not run', [strict.broken]);
      const st = dimStrict(f, strict.byFile);
      row.strict = st.status;
      row.strictDetail = st.detail;
      row.strictErrs = st.errs;
    } else {
      row.directives = row.verdict = row.runtime = row.strict = '—';
    }

    const tw = twinBase ? dimTwin(twinBase, await twinP) : { status: 'n/a', detail: 'no twin' };
    row.twin = tw.status;
    row.twinDetail = tw.detail;
    row.twinErrs = tw.errs;
    return row;
  }, { width: LANES, onDone: (row) => console.log(`  ${pad(row.name, NAME_W)} ${dims.map(([d, w]) => cell(row[d], w)).join(' ')}`) });

  // COVERAGE, for the same reason the probe pass has one: the Score below is a
  // ratio of the rows this loop produced. A fixture that fell out of the lanes
  // would make it read "11 / 11 — all passing" over a corpus one short.
  const missed = fixtures.filter((f, i) => !rows[i] || rows[i].name !== f);
  if (missed.length) await abort('The Type Audit did not score every fixture', missed.map((f) => `${f}: no row produced`));

  console.log(`\n  ${bold('Failures')} ${dim('(categorized)')}`);
  let any = false;
  for (const r of rows) {
    const notes = [];
    if (r.compiles === 'fail') notes.push([yellow('compiler-coverage gap'), r.compileDetail]);
    if (r.directives === 'fail') notes.push([red('face-emission bug'), `directives ${r.dirDetail}`]);
    if (r.verdict === 'fail') notes.push([red('type-face divergence'), r.verdictDetail]);
    if (r.runtime === 'fail') notes.push([red('behavioral divergence'), r.runtimeDetail]);
    if (r.twin === 'fail') notes.push([red('reference twin invalid'), r.twinDetail]);
    // Neutral category — the DETAIL names the class. The label must not claim
    // "implicit-any" when dimStrict just finished reporting that none of the
    // errors are; that contradiction is the misattribution in miniature.
    if (r.strict === 'fail') notes.push([yellow('fails under rip.strict'), r.strictDetail]);
    if (notes.length) {
      any = true;
      console.log(`    ${bold(r.name)}`);
      for (const [label, detail] of notes) console.log(`      ${dim('·')} ${label} ${dim('— ' + detail)}`);
      // A failure always shows its evidence — no flag needed to learn WHY.
      if (r.diags?.length) for (const d of r.diags) console.log(dim(`          ${d.range.start.line}:${d.range.start.character} [TS${d.code}] ${d.message}`));
      if (r.twinErrs?.length) for (const e of r.twinErrs) console.log(dim(`          twin: ${e}`));
      // The implicit-any evidence is bulky and REPETITIVE by nature: ONE
      // untyped param fans out into a diagnostic per member access, all
      // reported at the SAME source position. Showing the first N raw rows
      // therefore spends every line on one site and teaches the reader nothing
      // about the spread — so collapse by position first, and say both what
      // was collapsed and what was elided. Never silently truncate.
      if (r.strictErrs?.length) {
        const sites = new Map();   // "line:column" → the diagnostics reported there
        for (const e of r.strictErrs) {
          const k = `${e.line}:${e.column}`;
          if (!sites.has(k)) sites.set(k, []);
          sites.get(k).push(e);
        }
        for (const [at, es] of [...sites].slice(0, 4)) {
          const more = es.length > 1 ? dim(` (+${es.length - 1} more here)`) : '';
          console.log(dim(`          strict: ${at} [TS${es[0].code}] ${es[0].message}`) + more);
        }
        const rest = sites.size - Math.min(sites.size, 4);
        if (rest > 0) console.log(dim(`          strict: … and ${rest} more site${rest === 1 ? '' : 's'} (see \`rip check\` under rip.strict)`));
      }
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

// ── the Diagnostics Lane (--errors / --all; ROADMAP "M3"): fixtures whose
// errors are UNSUPPRESSED, each published diagnostic asserted by code AND
// position. The verdict dimension can never see a mis-positioned diagnostic —
// a fixture's `@ts-expect-error` is consumed inside tsgo, on the face, before
// rip's mapping runs — so this lane keeps its fixtures bare and does the
// positional bookkeeping itself. Expectations are DERIVED, never hand-pinned:
// tsgo's run over the LINE-ALIGNED twin fixes each expected code and line,
// and the flagged token's OCCURRENCE in that twin line, found at the same
// rank in the rip source's same line, fixes the expected column. A twin that
// stops aligning therefore fails loudly instead of drifting.
let el = null;
if (RUN_ERRORS) {
  // Each regex mirrors ITS tool's honoring rule — not a tidier one — so
  // whatever would silence a measurement is exactly what gets stripped and
  // what enforcement accepts. Rip: a whole-line `# @ts-nocheck` comment,
  // trailing words allowed (emitter.js TS_DIRECTIVE). tsgo: a `//` comment
  // beginning with @ts-nocheck, equally lenient about a trailing tail
  // (driven 2026-07-22: `// @ts-nocheck with trailing words` silences).
  const RIP_NOCHECK = /^[ \t]*#[ \t]*@ts-nocheck(?=\s|$)/;
  const TS_NOCHECK = /^\s*\/\/\/?\s*@ts-nocheck(?=\s|$)/;
  // Boundary-clean occurrences of an identifier in a line — positions not
  // embedded in a longer identifier. The OCCURRENCE INDEX is what transfers
  // between the line-aligned pair: raw columns differ (`let `), and a bare
  // indexOf lies whenever the token's text appears earlier as a substring.
  const occurrencesOf = (line, token) => {
    const out = [];
    for (let i = line.indexOf(token); i >= 0; i = line.indexOf(token, i + 1)) {
      if (!/[\w$]/.test(line[i - 1] ?? '') && !/[\w$]/.test(line[i + token.length] ?? '')) out.push(i);
    }
    return out;
  };
  // A pragma both tools honor sits BEFORE the first statement — the emitter
  // takes only `nochecks.find((t) => t.end <= firstStmt)` and TypeScript's
  // @ts-nocheck is likewise file-level — so enforcement is positional too: a
  // merely-present-but-late pragma is an ordinary comment to every authoring
  // surface, which is exactly the regression this check exists to catch.
  const pragmaLeads = (lines, pragmaRe, commentRe) => {
    const pragma = lines.findIndex((l) => pragmaRe.test(l));
    const code = lines.findIndex((l) => l.trim() && !commentRe.test(l));
    return pragma >= 0 && (code < 0 || pragma < code);
  };
  auditBanner('DIAGNOSTICS LANE', `unsuppressed fixtures, code + position asserted · ${errorFixtures.length} file(s)`);
  if (errorFixtures.length === 0) await abort('The Diagnostics Lane found no fixtures', [`${path.relative(ROOT, ERRD)} holds no .rip files`]);

  // The twin pass: tsgo over fixtures/errors' twins in an instrument-owned
  // workspace (the runStrictCheck pattern — the audit tsconfig excludes
  // errors/, so the shared twin pass never sees these and this one must run
  // its own). KICKED OFF, not awaited: the per-fixture lanes below start
  // their server measurements immediately and each awaits this shared
  // promise only where the expectation derivation first needs it.
  const twinP = (async () => {
    const tsc = tsgoBinaryPath();
    const dir = mkTemp(path.join(os.tmpdir(), 'rip-audit-errors-'));
    // Both files of an error pair carry an @ts-nocheck pragma, LINE-ALIGNED
    // (`# @ts-nocheck` / `// @ts-nocheck`), so every authoring surface — `rip
    // check`, the rip editor, VS Code's own TypeScript on the twin — stays
    // quiet about errors that are instrument content. The instrument must not
    // be blinded with them: the lane strips the pragma on the way into each
    // measurement (here for the twin; at verdict() for the .rip), replacing
    // its line to keep the pair aligned, and ENFORCES its placement per file
    // below. A strip that ever misses fails loudly downstream — a silenced
    // twin raises no errors, a silenced fixture publishes none, and the lane
    // flags both, never a pass.
    for (const f of fs.readdirSync(ERRD)) {
      if (!/\.tsx?$/.test(f)) continue;
      const src = fs.readFileSync(path.join(ERRD, f), 'utf8');
      fs.writeFileSync(path.join(dir, f), src.split('\n').map((l) => (TS_NOCHECK.test(l) ? '//' : l)).join('\n'));
    }
    const tscfg = JSON.parse(fs.readFileSync(path.join(HERE, 'tsconfig.json'), 'utf8'));
    tscfg.include = ['.'];
    delete tscfg.exclude;
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(tscfg, null, 2));
    // node_modules is symlinked for the same reason runStrictCheck symlinks
    // it: an error twin importing the fixture sandbox (react/zod — the
    // components/schema pairs) must resolve exactly as the flat twins do, or
    // TS2307 module-resolution noise masquerades as derived expectations.
    try { fs.symlinkSync(path.join(HERE, 'node_modules'), path.join(dir, 'node_modules'), 'dir'); } catch { /* absent → preflight already spoke */ }
    let out = '';
    try { out = (await execFileP(tsc, ['--noEmit', '-p', dir], { encoding: 'utf8', timeout: 120000 })).stdout; }
    catch (err) { out = (err.stdout || '').toString() + (err.stderr || '').toString(); }
    const byFile = new Map();
    for (const line of out.split('\n')) {
      const m = TSC_DIAG.exec(line);
      if (!m) continue;
      if (!byFile.has(m[1])) byFile.set(m[1], []);
      byFile.get(m[1]).push({ line: Number(m[2]), col: Number(m[3]), code: Number(m[4]) });
    }
    return byFile;
  })();
  pool = await poolP;

  const laneRows = await lanes(errorFixtures, async (f, _i, lane) => {
    const src = fs.readFileSync(path.join(ERRD, f), 'utf8');
    const ripLines = src.split('\n');
    const problems = [];
    // Bare errors means NO suppressing directive of any spelling — the
    // emitter honors `@ts-ignore` exactly like `@ts-expect-error`
    // (TS_DIRECTIVE), so a stray ignore would consume a diagnostic inside
    // tsgo and masquerade as a `missing` violation here.
    ripLines.forEach((l, i) => {
      const m = l.match(/^[ \t]*#[ \t]*@ts-(expect-error|ignore)(?=\s|$)/);
      if (m) problems.push({ kind: 'shape', note: `line ${i + 1} carries @ts-${m[1]} — this lane's fixtures must be unsuppressed` });
    });

    const twinBase = ['.tsx', '.ts'].map((e) => f.replace(/\.rip$/, e)).find((b) => fs.existsSync(path.join(ERRD, b)));
    if (!twinBase) return { name: f, problems: [{ kind: 'shape', note: 'no twin — expectations cannot be derived' }], expected: [] };
    const twinLines = fs.readFileSync(path.join(ERRD, twinBase), 'utf8').split('\n');

    if (!pragmaLeads(ripLines, RIP_NOCHECK, /^\s*#/)) problems.push({ kind: 'shape', note: '`# @ts-nocheck` missing or below the first statement — the emitter honors it only before any statement, so `rip check` goes red for the whole directory' });
    if (!pragmaLeads(twinLines, TS_NOCHECK, /^\s*\/\//)) problems.push({ kind: 'shape', note: `\`// @ts-nocheck\` missing or below the first statement in ${twinBase} — TypeScript honors it only at file level, so VS Code squiggles the twin` });

    // The measurement is started FIRST — the server's publish (settle sleeps
    // and all) runs while the shared twin pass finishes and expectations
    // derive; nothing below before the final await depends on it.
    const stripped = ripLines.map((l) => (RIP_NOCHECK.test(l) ? '#' : l)).join('\n');
    const dsP = pool[lane].verdict(path.join('errors', f), stripped);

    // Derive each expectation from the twin diagnostic: the flagged token at
    // (line, col) of the TWIN, transferred to the SAME line of the rip source
    // by OCCURRENCE RANK. Positions become LSP coordinates here (0-based
    // line/character).
    const twinByFile = await twinP;
    const expected = [];
    for (const d of twinByFile.get(twinBase) ?? []) {
      const twinLine = twinLines[d.line - 1] ?? '';
      // Identifier-only is a DERIVATION LIMIT, not corpus policy: TypeScript
      // also anchors errors on literals, operators, and parens, and a family
      // whose negatives legitimately flag such spans (operations, arity) is
      // the cue to widen this extraction to whatever sits at the flagged
      // position — never to reshape fixtures until the error lands on an
      // identifier, which would drift the corpus toward shapes the harness
      // can measure instead of shapes the type story needs tested.
      const token = twinLine.slice(d.col - 1).match(/^[A-Za-z_$][\w$]*/)?.[0];
      if (!token) { problems.push({ kind: 'shape', note: `twin ${d.line}:${d.col} TS${d.code}: no identifier at the flagged position — a derivation limit; widen the extraction here rather than reshaping the fixture` }); continue; }
      // The measurement side is the PERMISSIVE editor (its workspace carries
      // no package.json, so rip.strict is off and mapTsDiagnostic drops the
      // implicit-any family before publishing). An expectation carrying one
      // of those codes is structurally unassertable here — say so, instead
      // of reporting a permanent `missing` that reads as a server bug.
      if (SUPPRESSED_TS_CODES.has(d.code)) { problems.push({ kind: 'shape', note: `twin ${d.line}:${d.col} raises TS${d.code} — implicit-any family, which the permissive editor never publishes; this negative belongs with the strict dimension's shapes, not in the lane` }); continue; }
      const rank = occurrencesOf(twinLine, token).indexOf(d.col - 1);
      if (rank < 0) { problems.push({ kind: 'shape', note: `twin ${d.line}:${d.col} TS${d.code}: flagged position is not a clean occurrence of \`${token}\`` }); continue; }
      const character = occurrencesOf(ripLines[d.line - 1] ?? '', token)[rank];
      if (character === undefined) { problems.push({ kind: 'shape', note: `twin ${d.line}:${d.col} TS${d.code}: occurrence ${rank + 1} of \`${token}\` absent from the rip line — twin not line-aligned` }); continue; }
      expected.push({ line: d.line - 1, character, code: d.code, token });
    }
    if (expected.length === 0) problems.push({ kind: 'shape', note: 'the twin raises no errors — an error fixture must have some' });

    // Errors AND warnings — the verdict dimension's own rule (`severity <= 2`;
    // a warning-severity diagnostic is still a diagnostic), and error
    // fixtures are visible to no other audit, so a narrower filter here would
    // make warnings on them invisible everywhere.
    const ds = (await dsP).filter((d) => (d.severity ?? 1) <= 2);
    const unmatched = [...ds];
    for (const e of expected) {
      // Exact column first, so two same-code diagnostics on one line each
      // claim their own row instead of cross-pairing by publish order.
      let i = unmatched.findIndex((d) => d.code === e.code && d.range.start.line === e.line && d.range.start.character === e.character);
      if (i < 0) i = unmatched.findIndex((d) => d.code === e.code && d.range.start.line === e.line);
      if (i < 0) {
        const near = unmatched.find((d) => d.code === e.code);
        problems.push({ kind: 'missing', note: `expected TS${e.code} at ${e.line + 1}:${e.character} (\`${e.token}\`) — never published${near ? ` (a TS${e.code} sits at ${near.range.start.line + 1}:${near.range.start.character} — possibly this one, mis-lined)` : ''}` });
        continue;
      }
      const [d] = unmatched.splice(i, 1);
      if (d.range.start.character !== e.character) {
        problems.push({ kind: 'position', note: `TS${e.code} at line ${e.line + 1}: expected column ${e.character} (\`${e.token}\`), published ${d.range.start.character}` });
      }
    }
    for (const d of unmatched) problems.push({ kind: 'stray', note: `unexpected ${(d.severity ?? 1) === 2 ? 'warning ' : ''}TS${d.code} at ${d.range.start.line + 1}:${d.range.start.character} — ${String(d.message).split('\n')[0]}` });
    return { name: f, expected, problems };
  }, {
    width: LANES,
    onDone: (r) => {
      const ok = r.problems.length === 0;
      console.log(`    ${ok ? green('✓') : red('✗')} ${pad(path.join('errors', r.name), 34)} ${dim(`${r.expected.length} diagnostic(s) asserted`)}`);
      for (const p of r.problems) console.log(`        ${red('·')} ${yellow(p.kind)} ${dim(p.note)}`);
    },
  });
  const missedErr = errorFixtures.filter((f, i) => !laneRows[i] || laneRows[i].name !== f);
  if (missedErr.length) await abort('The Diagnostics Lane did not score every fixture', missedErr.map((f) => `${f}: no row produced`));
  // No orphaned twins: a twin whose .rip was renamed away would otherwise
  // have its asserted negatives vanish from every denominator, silently.
  const orphanTwins = fs.readdirSync(ERRD).filter((t) => /\.tsx?$/.test(t) && !errorFixtures.includes(t.replace(/\.tsx?$/, '.rip')));
  for (const o of orphanTwins) console.log(`    ${red('✗')} ${pad(path.join('errors', o), 34)} ${red('orphaned twin — no .rip pairs with it, so its negatives are asserted nowhere')}`);
  el = {
    files: laneRows.length,
    asserted: laneRows.reduce((n, r) => n + r.expected.length, 0),
    problems: [...laneRows.flatMap((r) => r.problems), ...orphanTwins.map((o) => ({ kind: 'orphan', note: `${o}: twin with no fixture` }))],
  };
}

const PROBES = new Map();   // file → { decls, hovers, tokens, tmap }
let hskip = 0;
if (RUN_HOVER || RUN_TOKENS) {
  pool = await poolP;
  // The Hover and Token audits ask DIFFERENT questions of the SAME open
  // document, so this pass opens each fixture once and takes whatever the
  // running audits need. It is also the slow part of the run — the server has
  // to build a program per document — so it STREAMS: a silent two-minute stall
  // followed by a finished report is indistinguishable from a hang.
  const wants = [RUN_HOVER && 'hovers', RUN_TOKENS && 'tokens'].filter(Boolean).join(' + ');
  auditBanner('PROBE PASS', `${wants} · one open per fixture · ${fixtures.length} files`);

  // One twin oracle PER LANE, for the same reason as the editor servers: a
  // shared tsgo would hold several twin documents open at once, which a serial
  // run never does. Same guarantee, applied to the oracle as well as the
  // subject — an oracle answering from a different program shape is no oracle.
  let twins = [];
  if (RUN_HOVER) {
    try {
      twins = await Promise.all(Array.from({ length: LANES }, async () => { const t = new TwinOracle(); await t.start(); return t; }));
    } catch { twins = []; }
    if (!twins.length) console.log(`    ${dim('tsgo unavailable — twin oracle skipped; hover-pins comparison still runs')}`);
  }

  // The face-survival oracle (the mapping gap's use sites). Compile every compiling
  // fixture to its TS face ONCE into a shared dir where sibling faces resolve
  // each other's imports (07 → 06), then start one oracle PER LANE — the same
  // one-document contract as the editor servers and twins. The faces are the
  // exact bytes the server remaps: same `compile(..., runtimeDelivery:'inline',
  // face:'ts')` call as server.js `faceOf`.
  let faces = [];
  if (RUN_TOKENS) {
    FACE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-audit-face-'));
    const tscfg = path.join(HERE, 'tsconfig.json');
    const baseCfg = fs.existsSync(tscfg) ? JSON.parse(fs.readFileSync(tscfg, 'utf8')) : { compilerOptions: {} };
    fs.writeFileSync(path.join(FACE_DIR, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { ...baseCfg.compilerOptions, allowImportingTsExtensions: true },
      include: ['*.rip.ts'],
    }));
    for (const f of fixtures) {
      const full = path.join(FIX, f);
      if (!await compiles(full)) continue;   // a fixture with no face has nothing to survive
      try {
        const { code, mappings } = compile(fs.readFileSync(full, 'utf8'), { path: full, runtimeDelivery: 'inline', face: 'ts' });
        FACES.set(f, { code, mappings });
        fs.writeFileSync(path.join(FACE_DIR, f.replace(/\.rip$/, '.rip.ts')), code);
      } catch (e) {
        // compiles() (subprocess `bin/rip --ts`) passed but the in-process
        // face:'ts' compile threw — a real divergence between the two compile
        // paths. Record it so the coverage gate names it precisely (rather than
        // the generic "no face tokens") and still treats it as fatal, not a
        // silently dropped fixture.
        FACE_ERRORS.set(f, (e && e.message) || String(e));
      }
    }
    try {
      faces = await Promise.all(Array.from({ length: LANES }, async () => { const o = new FaceOracle(); await o.start(); return o; }));
    } catch { faces = []; }
    facesAvailable = faces.length > 0;
    if (!facesAvailable) console.log(`    ${dim('tsgo unavailable — face-survival oracle skipped (the use-site token gauge)')}`);
  }

  const t0 = Date.now();

  const probeOne = async (f, _i, lane = 0) => {
    const full = path.join(FIX, f);
    const src = fs.readFileSync(full, 'utf8');
    if (!await compiles(full)) { hskip++; return { file: f, probe: null, line: `    ${yellow('skip')} ${pad(f, NAME_W + 2)} ${dim('does not compile — no face to probe')}` }; }

    // This lane's own server and own oracle — never a neighbour's.
    const srv = pool[lane];
    const twin = twins[lane] ?? null;

    const started = Date.now();
    const twinBase = twin ? ['.tsx', '.ts'].map((e) => f.replace(/\.rip$/, e)).find((b) => fs.existsSync(path.join(FIX, b))) : null;
    const decls = declsOf(src);
    // Type-body members ride alongside the declarations — the token audit's
    // PRESENCE invariant probes both. Computed here so the
    // coverage check below can hold the count against source, same as decls.
    const members = RUN_TOKENS ? typeMembersOf(src) : [];

    // The editor server and the tsgo twin are separate processes, so the twin's
    // settle overlaps the editor's.
    const [probe, tmap] = await Promise.all([
      srv.withDoc(f, src, readyProbe(decls), async (uri) => {
        // Hovers CONCURRENTLY: independent reads of ONE settled document,
        // answered from the same built program. This is concurrency within a
        // document, which a serial run does too — it cannot change the program's
        // shape, which is the property the per-lane servers exist to hold.
        const hovers = RUN_HOVER
          ? await Promise.all(decls.map((d) => srv.hover(uri, { line: d.line, character: d.character })))
          : [];
        const tokens = RUN_TOKENS ? await srv.tokens(uri) : null;
        return { decls, hovers, tokens };
      }),
      twinBase ? twin.hoverTwin(path.join(FIX, twinBase)).catch(() => null) : Promise.resolve(null),
    ]);

    // Face-survival (the mapping gap's use sites): raw face tokens run through the
    // server's remap; the drops naming a verbatim source identifier are the
    // real use-site regressions. Its own tsgo, so it neither shares nor
    // perturbs the editor read above.
    let survival = null;
    if (RUN_TOKENS && faces[lane] && FACES.has(f)) {
      const dec = await faces[lane].faceTokens(f);
      const { code } = FACES.get(f);
      // probe.tokens is the REAL server's delivered output — the survival oracle.
      survival = faceSurvival(src, code, dec, probe.tokens);
    }

    const took = `${((Date.now() - started) / 1000).toFixed(1)}s`;
    return {
      file: f,
      probe: { ...probe, tmap, members, survival },
      line: `    ${green('✓')} ${pad(f, NAME_W + 2)} ${dim(`${pad(decls.length + ' decls', 10)}${RUN_TOKENS ? pad(probe.tokens.length + ' tokens', 12) : ''}${took}`)}`,
    };
  };

  // Fixtures probe a few at a time; each one's cost is waiting on its server, not
  // CPU. Equivalence with a serial run rests on the per-lane servers (each lane
  // probes into its own program, never a shared one), NOT on the oracles noticing
  // cross-talk afterwards. Results land in fixture order.
  const probed = await lanes(fixtures, probeOne, { width: LANES, onDone: (r) => r && console.log(r.line) });
  for (const r of probed) if (r?.probe) PROBES.set(r.file, r.probe);

  console.log(`\n    ${dim(`probed ${PROBES.size} file(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s`)}`);
  await Promise.all(twins.map((t) => t.stop()));
  await Promise.all(faces.map((o) => o.stop()));
  if (FACE_DIR) fs.rmSync(FACE_DIR, { recursive: true, force: true });

  // ── COVERAGE. Every ratio this runner prints is relative to WHAT IT PROBED.
  // A fixture that silently fell out of the pass — a dropped lane, a swallowed
  // error — would leave every score reading full marks over a smaller corpus:
  // "300 / 300 typed hovers", green, with 36 declarations never checked. That is
  // the same failure as a gate that never ran, and it must never read green.
  //
  // So the run is checked against the SOURCE, not against itself: the corpus
  // fixes how many fixtures should be probed and how many declarations each
  // holds, and any shortfall is fatal. This is the check that makes the
  // concurrency above safe to trust — not the gauge, which is a quality
  // measure, not a completeness one.
  const want = [];
  for (const f of fixtures) if (await compiles(path.join(FIX, f))) want.push(f);
  const gaps = [];
  for (const f of want) {
    const p = PROBES.get(f);
    if (!p) { gaps.push(`${f}: compiles, but was never probed`); continue; }
    const src = fs.readFileSync(path.join(FIX, f), 'utf8');
    const decls = declsOf(src);
    if (p.decls.length !== decls.length) gaps.push(`${f}: probed ${p.decls.length} declarations, source has ${decls.length}`);
    if (RUN_TOKENS) {
      const members = typeMembersOf(src);
      if ((p.members?.length ?? 0) !== members.length) gaps.push(`${f}: probed ${p.members?.length ?? 0} type-body members, source has ${members.length}`);
      // The face oracle must have produced a face AND answered with tokens; a
      // silent shortfall here is the exact failure the coverage section exists
      // to make fatal. Two distinct modes, named distinctly: the in-process
      // face compile threw (FACE_ERRORS, a compile-path divergence), or the
      // oracle answered empty (a build that never settled within the poll).
      if (facesAvailable) {
        if (FACE_ERRORS.has(f)) gaps.push(`${f}: bin/rip --ts passed but the in-process face:'ts' compile threw — ${FACE_ERRORS.get(f)}`);
        else if (!p.survival || (p.survival.survived === 0 && p.survival.dropCount === 0)) gaps.push(`${f}: face-survival oracle classified no identifiers (build never settled within the poll)`);
      }
    }
    // A hover that answered NOTHING is a failed probe, not a typed one. The
    // gauge below only tests for `any`, so a null would sail through it.
    if (RUN_HOVER) {
      if (p.hovers.length !== p.decls.length) gaps.push(`${f}: ${p.decls.length} declarations but ${p.hovers.length} hover answers`);
      const dead = p.hovers.filter((h) => h == null).length;
      if (dead) gaps.push(`${f}: ${dead} hover probe(s) returned no answer at all`);
    }
    if (RUN_TOKENS && (!p.tokens || !p.tokens.length)) gaps.push(`${f}: no semantic tokens returned`);
  }
  if (gaps.length) await abort('The probe pass did not cover the corpus', gaps);
  console.log(`    ${green('✓')} ${dim(`coverage: ${want.length} compiling fixture(s), ${want.reduce((n, f) => n + PROBES.get(f).decls.length, 0)} declarations — all probed, all answered`)}`);
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
      // `any` OR no answer at all. A null hover is a probe that FAILED, never a
      // typed one — testing `hovers[i] ?? ''` against the `any` pattern would
      // score it as a real type and let the gauge read full while probes were
      // silently dying. The coverage gate rejects nulls outright; the gauge
      // counts them here so the two cannot disagree about what "typed" means.
      if (hovers[i] == null || /(?:^|:\s*)any$/.test(hovers[i])) anyCount++;
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
  // No legend, no audit. Token indices are meaningless without one: decoding
  // anyway yields type names like `#3` and empty modifier lists, which surface as
  // violations REPORTED AGAINST RIP rather than as a dead server.
  //
  // EVERY server is checked, not just one. A fixture is probed by whichever lane
  // took it, so a single legend-less server in the pool corrupts exactly the
  // fixtures that landed on it while the rest look fine — the worst shape a
  // failure can take, because it is quiet and partial.
  const blind = pool.filter((s) => !s.legend);
  if (blind.length) {
    await abort(
      `The token audit cannot run — ${blind.length} of ${pool.length} server(s) advertised no semanticTokens legend`,
      [`the capability comes from tsgo at startup (server.js \`semanticTokensLegend\`); a missing one means that broker never came up`],
    );
  }
  {
    const missing = [], badType = [], badReadonly = [], unasserted = [];
    // Type-body member PRESENCE. A property in a type/interface
    // body must get a token; it rides one coarse cover row and maps only
    // where verbatim from that row's start, so any face rewrite before it —
    // a quote-normalized literal on an inline line, the `{`/reflow of a
    // block body — truncates the prefix and drops it. This invariant is
    // EXPECTED RED until the mapping fix lands (per-name rows for members,
    // or literals left un-normalized in the face), then flips green.
    const memberMissing = []; let memberProbed = 0;
    // Face-survival accumulators (the mapping gap's use sites): survivors, the dropped
    // classified names ({name, count} per fixture), and `unclassified` — server
    // tokens whose name tsgo never classifies (the sanity check; must be 0, or
    // the server and face oracles disagree and the gauge is untrustworthy).
    const survDrops = []; let survSurvived = 0, survUnclassified = 0;
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

    for (const [f, { decls, tokens: toks, members, survival }] of PROBES) {
      // A declaration's token is the one STARTING at its name.
      const at = new Map(toks.map((t) => [`${t.line}:${t.character}`, t]));
      // Face-survival rolls up independently of the source-enumerated
      // invariants below — it is keyed on the FACE, not on `decls`.
      if (survival) {
        survSurvived += survival.survived;
        survUnclassified += survival.unclassified;
        for (const d of survival.drops) survDrops.push({ ...d, file: f });
      }
      // Members carry the SAME keying — a present member's token starts at
      // its name. Presence only: type-body members do not pin a type/readonly
      // expectation the way a declaration form does.
      for (const mem of (members ?? [])) {
        memberProbed++;
        if (!at.get(`${mem.line}:${mem.character}`)) memberMissing.push({ ...mem, file: f, text: `${mem.name} (${mem.form})` });
      }
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
    // Type-body member presence — EXPECTED RED (the mapping gap), the token
    // twin of the `strict` gauge. Its own line so the wording is "gap" (a
    // known-open hole), not "violation" (a fresh regression), and green means
    // the mapping fix has landed and this gauge should be retired.
    {
      const gaps = memberMissing.length;
      const note = gaps ? yellow(`${gaps} gap${gaps === 1 ? '' : 's'}`) + '   ' + dim('type-body member tokens drop — expected red until the mapping fix')
                        : dim('type-body member tokens — the mapping fix appears to have landed; retire this gauge');
      console.log(`    ${pad('member', 12)} ${(gaps ? red : green)(String(memberProbed - gaps).padStart(3))} ${dim('/')} ${dim(String(memberProbed).padStart(3))}   ${note}`);
    }
    // Face-survival — USE-SITE token drops (the mapping gap), the direction the
    // source-enumerated invariants above cannot see: a classified source
    // identifier the server drops, covering use sites AND rip-native names with
    // no twin. EXPECTED RED like `member`; green means the mapping fix has
    // landed. Denominator is classified source identifiers (survivors + drops),
    // so the ratio reads as delivery FIDELITY.
    if (facesAvailable) {
      const dropTotal = survDrops.reduce((n, d) => n + d.count, 0);
      const den = survSurvived + dropTotal;
      const note = dropTotal ? yellow(`${dropTotal} drop${dropTotal === 1 ? '' : 's'}`) + '   ' + dim('classified source identifiers the server drops at use sites — expected red until the mapping fix')
                             : dim('use-site tokens — the mapping fix appears to have landed; retire this gauge');
      console.log(`    ${pad('survival', 12)} ${(dropTotal ? red : green)(String(survSurvived).padStart(3))} ${dim('/')} ${dim(String(den).padStart(3))}   ${note}`);
      // Silent guard (surfaces only on failure): count-based uses the server's
      // tokens directly, so `delivered ⊆ classified` holds by construction —
      // EXCEPT if this standalone FaceOracle's tsgo drifts from the server's.
      // Nothing else would catch that, so flag it, but don't print an always-ok
      // line for a near-tautology.
      if (survUnclassified) console.log(`    ${pad('  ↳ drift', 12)} ${red(`${survUnclassified} unclassified`)}   ${dim('server shipped a name tsgo never classifies — face oracle drifted, distrust the survival count')}`);
    }

    show(missing, 'No token — the name gets no semantic color', () => {});
    show(badType, 'Wrong token type', (r) => {
      console.log(`          ${dim('expected')} ${green(r.want.type)}`);
      console.log(`          ${dim('actual  ')} ${yellow(fmt(r.got))}`);
    });
    show(badReadonly, 'Wrong `readonly` modifier', (r) => {
      console.log(`          ${dim('expected')} ${green(`${r.want.type}${r.want.readonly ? ' readonly' : ''}`)} ${dim(`— a \`${r.want.form}\` binding is ${r.want.readonly ? 'immutable' : 'WRITABLE'} in rip`)}`);
      console.log(`          ${dim('actual  ')} ${yellow(fmt(r.got))}`);
    });
    // The mapping gap's expected-red evidence, kept apart from the regression
    // sections above: these are known-open holes, not surprises. The name lists
    // are long by nature, so each fixture's names WRAP with a hanging indent
    // aligned under the fixture column (adapting to terminal width) — every name
    // visible by default, but never soft-wrapped into a jumble.
    const byFileOf = (rows) => { const m = new Map(); for (const r of rows) { if (!m.has(r.file)) m.set(r.file, []); m.get(r.file).push(r); } return m; };
    const COL = 6 + 18 + 1 + 3 + 3;                                  // leading + filename + sp + count + gap = name column
    const WRAP = Math.max(80, process.stdout.columns || 120) - 2;
    const dropSection = (title, byFile, tally, nameOf) => {
      console.log(`\n    ${bold(title)} ${dim('— the mapping gap, expected red')}`);
      for (const [file, entries] of byFile) {
        // filename stays plain (the terminal linkifies it) and full — never
        // dimmed and never stripped of `.rip`, so the click target survives.
        const head = `      ${pad(file, 18)} ${dim(String(tally(entries)).padStart(3))}   `;
        const rows = []; let line = '';
        for (const n of entries.map(nameOf)) {
          const next = line ? `${line}, ${n}` : n;
          if (COL + next.length > WRAP && line) { rows.push(line); line = n; } else line = next;
        }
        if (line) rows.push(line);
        rows.forEach((r, i) => console.log((i === 0 ? head : ' '.repeat(COL)) + dim(r)));
      }
    };
    if (memberMissing.length) dropSection('Type-body members with no token', byFileOf(memberMissing), (e) => e.length, (r) => r.name);
    if (survDrops.length) dropSection('Use-site tokens lost in remap', byFileOf(survDrops), (e) => e.reduce((n, r) => n + r.count, 0), (r) => r.count > 1 ? `${r.name}×${r.count}` : r.name);
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

    tk = { probed, missing, badType, badReadonly, memberProbed, memberMissing, survSurvived, survDrops, survUnclassified };
  }
}

await Promise.all(pool.map((s) => s.stop()));

// ── combined totals
//
// EVERY LINE NAMES ITS AUDIT. Under --all these totals lines print together at
// the very end, directly beneath the LAST audit's section — so an unlabelled
// "3 failing" reads as belonging to whatever section happens to sit above it.
// That is not hypothetical: the Type Audit's failures were read as the Token
// Audit's, which was reporting all-green two lines lower. A totals line that
// can be misattributed is worse than no totals line.
const TOTAL_W = 12;
const totalLine = (audit, text) => console.log('    ' + dim(pad(audit, TOTAL_W)) + text);
console.log(`\n  ${bold('Totals')}`);
// The Grammar Gate is a gauge toward M3, not a regression count: uncovered
// productions are the fixture-growth queue, red only in the sense of "work
// remains", so the count paints yellow until the corpus covers the grammar.
if (gr) totalLine('Grammar', `${gr.total} productions: `
  + (gr.uncovered === 0
    ? green('every production exercised by the corpus')
    : `${green(`${gr.covered} exercised`)}${dim(' · ')}${yellow(`${gr.uncovered} uncovered`)} ${dim(`across ${gr.groups} ${gr.groupKind} — the M3 queue`)}`
      + (gr.unallocated ? `${dim(' · ')}${red(`${gr.unallocated} UNALLOCATED`)} ${dim('— the manifest owes an ownership decision')}` : ''))
  + (gr.excluded ? `${dim(` · ${gr.excluded} excluded`)}` : '')
  + (gr.badExclusions ? `${dim(' · ')}${red(`${gr.badExclusions} bad exclusion${gr.badExclusions === 1 ? '' : 's'}`)} ${dim("— fix the gate's exclusion table")}` : ''));
// The Mapping Audit's flagged reads are EXPECTED red (the mapping gap), so
// they read as a gauge, never a regression count: the total is the census, and
// the missing-span clause is the only part that would signal something new.
if (mp) totalLine('Mapping', `${mp.totReads} reads: `
  + (mp.totFlag === 0
    ? green('all placed, all truthful')
    : `${yellow(`${mp.totFlag} unmapped`)} ${dim(`(${mp.unplaced} unplaced, ${mp.mistext} mis-texted · ${mp.synthetic} synthetic, ${mp.rewrite} rewrite)`)} ${dim('tracking the mapping gap (expected)')}`)
  + dim(` · ${mp.census} at-risk (census: no exact row)`)
  + (mp.missing ? ` · ${red(`${mp.missing} missing span${mp.missing === 1 ? '' : 's'}`)} ${dim('— a new class')}` : ''));
if (RUN_MAIN) totalLine('Type', (fails === 0
  ? green(`${totalApplicable} dimension checks: all passing`)
  : `${totalApplicable} dimension checks: ${green(totalPass + ' passing')}, ${red(fails + ' failing')}`));
if (el) totalLine('Diagnostics', `${el.asserted} asserted over ${el.files} file(s): ` + (el.problems.length === 0
  ? green('every code and position as TypeScript says')
  : red(`${el.problems.length} violation${el.problems.length === 1 ? '' : 's'}`)
    + dim(` (${['shape', 'missing', 'position', 'stray', 'orphan'].map((k) => [k, el.problems.filter((p) => p.kind === k).length]).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ')})`)));
if (hp) totalLine('Hover', `${hp.probed} hover probes: `
  + (hp.gap === 0 && hp.snapChanged === 0 && hp.violations.length === 0
    ? green('twin parity + expected clean')
    : `${hp.gap ? yellow(hp.gap + ' twin gap' + (hp.gap === 1 ? '' : 's')) : green('0 twin gaps')}, ${hp.snapChanged ? red(hp.snapChanged + ' expected change' + (hp.snapChanged === 1 ? '' : 's')) : green('expected clean')}${hp.violations.length ? `, ${red(hp.violations.length + ' invariant hit' + (hp.violations.length === 1 ? '' : 's'))}` : ''}`));
if (tk) {
  const bad = tk.missing.length + tk.badType.length + tk.badReadonly.length;
  // The member gauge is reported SEPARATELY from the invariant total: it is
  // expected red (the mapping gap), so folding it in would read as N fresh
  // regressions. Its own clause keeps the real-regression signal clean.
  // Each segment paints itself — never dim() wrapping a yellow()/green(), or
  // ANSI faint stacks onto the color and the count renders washed-out.
  const memberClause = tk.memberMissing.length
    ? dim(' · ') + yellow(`${tk.memberMissing.length}/${tk.memberProbed} type-body member gap${tk.memberMissing.length === 1 ? '' : 's'}`) + ' ' + dim('tracking the mapping gap (expected)')
    : dim(' · ') + green('type-body members clean') + ' ' + dim('— the mapping gap may be closed');
  // Face-survival rides the same expected-red logic as the member clause: its
  // own segment so use-site drops never read as fresh invariant regressions.
  // Absent entirely when the face oracle did not run (no survDrops key set).
  const survDropTotal = (tk.survDrops ?? []).reduce((n, d) => n + d.count, 0);
  const survivalClause = !facesAvailable
    ? ''
    : tk.survUnclassified
      ? dim(' · ') + red(`${tk.survUnclassified} unclassified`) + ' ' + dim('— server/face oracles disagree, distrust the survival gauge')
      : survDropTotal
        ? dim(' · ') + yellow(`${survDropTotal} use-site drop${survDropTotal === 1 ? '' : 's'}`) + ' ' + dim('tracking the mapping gap (expected)')
        : dim(' · ') + green('use-site tokens clean') + ' ' + dim('— the mapping gap may be closed');
  totalLine('Token', `${tk.probed} token probes: `
    + (bad === 0 ? green('all invariants hold')
      : red(`${bad} invariant violation${bad === 1 ? '' : 's'}`)
        + dim(` (${[[tk.missing, 'missing'], [tk.badType, 'wrong type'], [tk.badReadonly, 'wrong readonly']].filter(([r]) => r.length).map(([r, l]) => `${r.length} ${l}`).join(', ')})`))
    + memberClause + survivalClause);
}

// ── what this run did NOT cover. The default runs one of the audits, so say
// so on the way out: an audit nobody knows about is an audit nobody runs. Reads
// `ran` straight off AUDITS, so EVERY audit can appear here — including the
// default one, which a `--hover`/`--token` run silently skips.
{
  const skipped = AUDITS.filter((a) => !a.ran);
  const covered = AUDITS.filter((a) => a.ran).map((a) => a.name).join(' + ') || 'nothing';
  if (skipped.length) {
    console.log(`\n  ${dim('Not run')} ${dim(`(this run: ${covered})`)}`);
    for (const a of skipped) console.log(`    ${dim('·')} ${bold(a.name)} ${dim(`— ${a.blurb}`)}\n      ${dim(`bun run type-audit${a.flag ? ' ' + a.flag : ''}`)}`);
    console.log(`    ${dim('·')} ${dim('all of them:')} ${dim('bun run type-audit --all')}   ${dim('· full flag list:')} ${dim('--help')}`);
  }
}
console.log('');
