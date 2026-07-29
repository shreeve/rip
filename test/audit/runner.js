// The audit — a PROGRESS GAUGE (not a pass/fail gate): a
// categorized scoreboard over the fixtures. Each fixture is scored on
// independent dimensions, and every failure is categorized so the
// number tells you WHERE the type story stands.
//
//   bun run audit                  # EVERY lane, bottom-up: grammar → map → type → diagnostics → hover + token
//   bun run audit --grammar        # the Grammar Audit ONLY (parser only)
//   bun run audit --map            # the Mapping Audit ONLY (compiler output; no server)
//   bun run audit --type           # the Type Audit ONLY — the fast loop while authoring
//   bun run audit --diagnostics    # the Diagnostics Audit ONLY (drives the editor server)
//   bun run audit --hover          # the Hover Audit ONLY (slower; drives LSP servers)
//   bun run audit --token          # the Token Audit ONLY (drives the editor server)
//   bun run audit --verbose        # + list expected hover divergences / unasserted tokens
//
// A FLAG NAMES ITS LANE, and that is the whole naming rule — the flag is the
// lane's own noun, never the directory it reads or an abbreviation of the
// question. `--diagnostics` is plural on purpose: the lane asserts a SET per
// file, where hover and token probe one answer per position, so number tracks
// what is counted rather than following its neighbours. `--map` keeps its
// short spelling because it names the source map, the artifact the lane
// audits. `--serial` is a mode, not a lane, and stays outside the set.
//
// The independent audits (the AUDITS table below is the authoritative list —
// it also carries the Grammar Audit, ROADMAP "M2", and the Diagnostics Audit,
// ROADMAP "M3", which each document themselves at their sections):
//
// A · THE TYPE AUDIT — a per-fixture grid over five dimensions:
//   1 compiles     rip --ts produces a face           (else: compiler-coverage gap)
//   2 verdict      the editor server publishes ZERO Error-severity
//                  diagnostics — the corpus carries no suppressions
//                  (the preflight refuses them), so zero means zero
//                                                     (else: type-face divergence)
//   3 runtime      rip <fixture> stdout == bun <twin> stdout
//                                                     (else: behavioral divergence)
//   4 twin         the .ts/.tsx companion type-checks under the strict
//                  tsconfig                           (else: reference twin invalid)
//   5 strict       `rip check` under rip.strict reports ZERO errors —
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
// B · THE HOVER AUDIT (--hover) — hover every top-level
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
//     symbol with no twin — is pinned in hover-pins.json (its `decls`
//     sections). The live hover must match its expected value. Pins are
//     HAND-MAINTAINED, per row, reviewed against RULINGS.md — there is
//     no mechanical re-pin: on a divergence or an unpinned symbol the
//     run prints a paste-ready row, and adopting it is an explicit edit,
//     so the baseline can never silently become a photo of whatever the
//     editor emitted. Twin-checked symbols are NOT pinned here — the
//     twin validates them live, and pinning raw text would flag harmless
//     changes (union-member order) it normalizes away. (The
//     write-only-`any` class is caught for ALL symbols by the
//     oracle-free invariant below.)
//
// C · THE TOKEN AUDIT (--token) — request semanticTokens/full
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
// D · THE MAPPING AUDIT (--map) — the one audit that starts no
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
// Layout: corpus/ holds the corpus in two CHARTER buckets — each `.rip`
// beside a hand-written `.ts`/`.tsx` twin:
//   corpus/grammar/  fixtures chartered by the closed denominators (the
//                    grammar audit's productions, the census's type kinds);
//                    each must uniquely reduce at least one production.
//   corpus/claims/   fixtures chartered by CLAIMS.md — ruled behaviors no
//                    denominator can derive; each must be a named carrier
//                    of at least one CLAIMS row. Unique production
//                    reduction is neither required nor accepted here.
// hover-pins.json is the Hover Audit's pin file — declaration baselines for
// symbols the twin cannot judge, and the RULINGS-governed in-body positions.
// corpus/errors/ is where the corpus's NEGATIVE tests live —
// one unsuppressed error pair per family — and it belongs to the
// Diagnostics Audit ALONE: the fixture walk never descends into it,
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
// No positive fixture carries suppression directives — the preflight
// REFUSES them (a marker consumes a diagnostic before any dimension can
// see it): negatives live in corpus/errors/, asserted by the Diagnostics
// Lane, so the verdict dimension means zero diagnostics absolutely.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LspClient, tsgoBinaryPath, startTsgo, decodeSemanticTokens } from '../../packages/vscode/src/tsgo.js';
import { compile } from '../../src/compile.js';
import { codeMask } from './mask.js';
import { Parser } from '../../src/parser.js';
import { makeParserLexer, tokenize, ALIASES } from '../../src/lexer.js';
import { renderTypeDecl } from '../../src/typetext.js';
import { judge } from './contract.js';
import { lineStartsOf, SUPPRESSED_TS_CODES, sourceOffsetToGeneratedExact, generatedSpanToSource, offsetToPosition } from '../../packages/vscode/src/translate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const RIP = path.join(ROOT, 'bin/rip');
const SERVER = path.join(ROOT, 'packages/vscode/src/server.js');
const CORPUS = path.join(HERE, 'corpus');
const FIX = path.join(CORPUS, 'grammar');
const CLM = path.join(CORPUS, 'claims');
// The Diagnostics Audit's fixtures — a SIBLING of the positive buckets, so
// nothing in errors/ can join another audit's denominator, and
// tsconfig.json excludes it from the twin type-check.
const ERRD = path.join(CORPUS, 'errors');
// The Hover Audit's pin file, HAND-MAINTAINED per row (no mechanical
// re-pin exists; the run prints paste-ready rows for divergences and
// unpinned symbols). Two sections per fixture, one discipline — reviewed
// measurements, gated on RULINGS.md, asserting the interim where a ledger
// row holds the target:
//   `decls` — declaration baselines for symbols the twin cannot judge
//     (rip-native / no twin symbol), keyed by NAME (+ `occurrence` for
//     repeats) so a fixture edit that only moves lines cannot rot them;
//     positions resolve through the declsOf walk each run, and a pin
//     naming no declaration fails the coverage gate.
//   `positions` — the RULINGS-governed IN-BODY positions (render-DSL
//     words, component member declarations, gate spellings) declsOf
//     cannot reach: 1-based line, 0-based character, the token at that
//     position (source-integrity: a pin whose token no longer sits there
//     is a rotted pin and fails the coverage gate), and the expected
//     hover (`null` = ruled silence / an unserved target's interim;
//     text = a reviewed truthful interim). The `ruled` gauge below
//     reports divergences red by agreement, soft, like the silence gauge.
const HOVERS = path.join(HERE, 'hover-pins.json');
// The Diagnostics Audit's pinned expectations — ADDITIVE per error pair, for
// exactly the diagnostics no honest twin line can spell (a lowering's second
// publish). Rows the twin CAN judge stay derived; a pin that duplicates a
// derived row is flagged, never silently merged. Same discipline as
// hover-pins.json: reviewed measurements, gated on RULINGS.md, asserting the
// interim where a ledger row holds the target.
const ERROR_PINS = path.join(HERE, 'error-pins.json');
// ONE terminal width for every wrap in this file. Four sites used to read it
// independently, with three different fallbacks (120, 120, 200, 200) and only
// two honouring COLUMNS — so one run could wrap its totals at 200 and its kind
// lists at 120, and a narrow terminal was reported to only some of them.
// Reading COLUMNS is also what makes any of this EXERCISABLE: a piped stdout
// has no `columns`, so `COLUMNS=80 bun run audit | cat` is the only way to see
// what an 80-column terminal sees.
//
// The 60-column floor lives HERE and nowhere else. Each wrap site used to
// carry its own (60, 40, 80), which is how a narrow run could still print a
// 76-column totals line: the site's floor outvoted the terminal, after its
// indent had already been spent. One floor, applied before any indent is
// subtracted, means the widest PROSE line this file emits is
// `max(60, terminal)` — and nothing quietly exceeds it.
const TERM_W = Math.max(60, process.stdout.columns || Number(process.env.COLUMNS) || 120);
// A styled string's PRINTED width — ANSI escapes occupy no columns, so every
// wrap decision must measure with this rather than `.length`.
const visibleW = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').length;
// Wrap `text` to `width`, indenting continuation lines by `indent` spaces.
// Splits on spaces, so an unbroken token longer than the width overhangs
// rather than being cut: a truncated production name or carrier is worse than
// a long line, since the whole point of printing it is that it can be looked
// up. Styling survives the break — ANSI state persists across a newline.
const wrapText = (text, width, indent) => {
  const out = [];
  // `null` rather than `''` for "no line yet": splitting on spaces turns a
  // LEADING run of spaces into empty words, and a truthiness test treats the
  // partly-built line as still-empty and swallows them. Text that opens with
  // spaces is exactly the multi-line case — a compiler elaboration indents
  // its continuation, and that indent is information about nesting.
  let line = null;
  for (const word of text.split(' ')) {
    if (line === null) { line = word; continue; }
    if (visibleW(line) + 1 + visibleW(word) > width) { out.push(line); line = ' '.repeat(indent) + word; }
    else line += ' ' + word;
  }
  if (line) out.push(line);
  return out;
};
// PROSE wraps; GRID ROWS DO NOT. A table row's columns are its meaning — a
// wrapped row dangles half its cells under the name column and destroys the
// alignment that makes the column scannable — so rows print at their natural
// width (bounded by their own column widths) and only prose comes through
// here. Continuations hang two spaces in, so a wrapped sentence never reads as
// a new bullet.
const wrapAt = (indent, text) => {
  for (const l of wrapText(text, TERM_W - indent, 2)) console.log(' '.repeat(indent) + l);
};
// A LABEL COLUMN followed by prose — an excluded spelling and its reason, a
// held kind and what holds it. `out` hangs a wrap two spaces in from the
// line's own indent, which is right for a paragraph and wrong here: the
// continuation lands back under the LABEL, so a wrapped reason reads as a
// second row with a blank label rather than as more of the first. The hang
// belongs at the prose's own column, and only the caller knows where that is,
// so it is passed rather than inferred. Both halves are then measured against
// it: a reason that wraps stays inside its own column for as long as it runs.
// Rows sharing a reason VERBATIM are one ruling, not several, so they share a
// row. Printing the sentence once per key turns a two-decision table into a
// wall a reader has to diff against itself to notice the repetition — and the
// repetition is the point being missed: `on` and `yes` are excluded for the
// same reason because they are the same case. Keys keep table order, and the
// grouping collapses to one-per-row on its own when the reasons differ.
const groupByReason = (entries) => {
  const g = new Map();
  for (const [k, why] of entries) {
    if (!g.has(why)) g.set(why, []);
    g.get(why).push(k);
  }
  return [...g].map(([why, keys]) => [keys.join(', '), why]);
};
const labeled = (indent, label, width, text, paintLabel = (s) => s) => {
  const gutter = indent + width + 1;
  const lines = wrapText(text, TERM_W - gutter, 0);
  console.log(' '.repeat(indent) + paintLabel(pad(label, width)) + ' ' + dim(lines[0]));
  for (const l of lines.slice(1)) console.log(' '.repeat(gutter) + dim(l));
};
// `wrapAt` for a line that is already fully composed — leading blank lines,
// indent and all. It reads the indent off the string rather than being told
// it, so converting a prose call site is `console.log` → `out` and nothing
// else: the template stays exactly as written, which is what keeps these long
// interpolated lines legible in the source.
const out = (s) => {
  const lead = s.match(/^\n*/)[0];
  const body = s.slice(lead.length);
  // The indent can sit BEHIND a styling escape — `dim('          text')` puts
  // the escape first — so it is read off the VISIBLE text and stripped in a
  // way that leaves any leading escape in place. Reading it off the raw
  // string instead sees zero indent, and the continuation lines lose the
  // column their first line sits in.
  const indent = body.replace(/\x1b\[[0-9;]*m/g, '').match(/^ */)[0].length;
  if (lead) process.stdout.write(lead);
  // A newline INSIDE the line is a HARD BREAK, not whitespace between words:
  // tsgo elaborates an assignability error across several lines, and handing
  // that to a space-splitting wrapper drops everything after the first
  // newline to column zero and then measures the rest of the line against an
  // offset that is already wrong. Each part wraps on its own at the same
  // indent, keeping its own leading spaces — the elaboration's nesting is
  // information, so it is preserved rather than trimmed.
  for (const part of body.replace(/^((?:\x1b\[[0-9;]*m)*) +/, '$1').split('\n')) {
    if (part) wrapAt(indent, part); else console.log('');
  }
};

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
    key: 'grammar', flag: '--grammar', name: 'Grammar Audit',
    // Parser only — no server, no tsgo, no compile even: the corpus is parsed
    // with an instrumented Parser and each reduce records its rule.
    runs: 'parser only',
    blurb: 'which grammar productions the fixture corpus exercises, and which it never reduces',
    judge: 'the GRAMMAR\'S OWN RULE LIST — a closed denominator: every production the\n'
         + 'parser can reduce is enumerable, so "exercised by at least one fixture" is\n'
         + 'checkable in a way no corpus-relative rate ever is. The uncovered list names\n'
         + 'the productions no fixture reduces — a fixture to write where one is\n'
         + 'available, an open finding where MANIFEST.md parks it',
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
         + 'own bytes; each failure is classified by the mapping row it fell to. The\n'
         + 'walk needs no reference to run: `text` is a PROPERTY, not a comparison, so\n'
         + 'drift toward wrong positions surfaces as a rising count. Its blind spot is\n'
         + 'that byte-equality is not identity — a read resolving onto a DIFFERENT\n'
         + 'occurrence of the same name passes both invariants. The logic was driven\n'
         + 'against the real editor once (ROADMAP.md, M1); nothing re-drives it',
  },
  {
    key: 'main', flag: '--type', name: 'Type Audit',
    runs: 'compiles, runs, and type-checks each fixture',
    blurb: 'five dimensions per fixture: compiles, verdict, runtime, twin, strict',
    judge: 'a DIFFERENT reference per dimension, which is why there are five:\n'
         + '`compiles` and `runtime` against the fixture running, `twin` against the\n'
         + 'hand-written .ts/.tsx beside it, `verdict` against zero published\n'
         + 'diagnostics, `strict` against `rip check` over the whole corpus. No\n'
         + 'positive fixture may carry a suppression directive (the preflight refuses\n'
         + 'them): every fixture publishes ZERO diagnostics, its negatives living in\n'
         + 'corpus/errors/ under the Diagnostics Audit',
  },
  {
    key: 'errors', flag: '--diagnostics', name: 'Diagnostics Audit',
    blurb: 'the corpus\'s negatives — unsuppressed error fixtures, every diagnostic asserted by code and position',
    judge: 'the twin\'s OWN tsgo diagnostics — TypeScript\'s answer on the LINE-ALIGNED twin\n'
         + 'fixes each expected code and line, and the flagged token\'s place in the rip\n'
         + 'source fixes the expected column; error-pins.json adds the diagnostics no\n'
         + 'honest twin line can spell (a lowering\'s second publish), additively and\n'
         + 'never shadowing a derived row. ALL of the corpus\'s negative tests live\n'
         + 'here, in corpus/errors/ (one error pair per family), OUTSIDE the shared\n'
         + 'fixture walk: positive fixtures publish zero diagnostics absolutely, and only\n'
         + 'this lane can see a mis-positioned diagnostic — a suppression is consumed on\n'
         + 'the face, before any of it reaches the audit',
  },
  {
    key: 'hover', flag: '--hover', name: 'Hover Audit',
    blurb: 'hover every top-level declaration through the editor server',
    judge: 'the hand-written .ts/.tsx twin — a real reference answer — falling back to hover-pins.json\n'
         + 'where rip-native constructs have no twin. The pin file is hand-maintained per\n'
         + 'row (no mechanical re-pin — the run prints paste-ready rows instead): `decls`\n'
         + 'sections hold the declaration baselines, `positions` sections the\n'
         + 'RULINGS-governed IN-BODY positions (render-DSL words, member declarations,\n'
         + 'gate spellings) — the `ruled` gauge, red by agreement while their findings are open',
  },
  {
    key: 'token', flag: '--token', name: 'Token Audit',
    blurb: 'semantic token + modifiers on every top-level declaration',
    judge: 'the .rip SOURCE ITSELF — a binding\'s form fixes what its token must be, so no\n'
         + 'twin and no baseline are involved and the check cannot self-confirm',
  },
];
const FLAGS = [
  ['--serial', 'probe one fixture at a time — the control for the concurrent pass'],
  ['--verbose', '-v', 'every list a section summarizes — exclusions, queue members, claims rows, hover divergences, unasserted tokens, and every flagged mapping read'],
  ['--help', '-h', 'this message'],
];
// Every accepted flag: the audits' own, plus the modifiers above (a row may
// carry aliases, so take every leading `-…` token).
const KNOWN = new Set([
  ...AUDITS.map((a) => a.flag).filter(Boolean),
  ...FLAGS.flatMap((row) => row.filter((c) => c.startsWith('-'))),
]);
// Help is the one screen a reader meets before they know anything, so it wraps
// to THEIR terminal rather than to a width chosen when it was written. The
// `judge` texts carry their own hand-placed newlines — those are reflow points,
// not layout, so they collapse to spaces and the paragraph re-wraps whole.
const usage = () => {
  const para = (text, indent, hang) => wrapText(text.replace(/\s*\n\s*/g, ' '), TERM_W - indent, hang)
    .map((l) => ' '.repeat(indent) + l);
  // A flag and its description are a two-column row: the description wraps
  // under itself, never back under the flag.
  const row = (label, text) => {
    const [first, ...more] = wrapText(text, TERM_W - 19, 0);
    return [`  ${label.padEnd(16)} ${first}`, ...more.map((l) => ' '.repeat(19) + l)];
  };
  return [
    ...para('The audit — a scoreboard for rip\'s typed-editor story over the typed fixtures in ./corpus: the '
      + 'TypeScript view the compiler shows a checker (the FACE), plus the tsgo-brokered editor. '
      + 'GAUGE AND GATE at once: most of what it prints is a queue whose size is work remaining, and the '
      + 'CONTRACT at the foot of the run is what decides the exit code. Not part of `bun test`.', 0, 0),
    '',
    'Usage: bun run audit [flag]',
    '',
    ...row('(no flag)', 'EVERY lane — the default, because a lane left unrun reports nothing'),
    ...AUDITS.filter((a) => a.flag).flatMap((a) => row(a.flag, `the ${a.name} only (${a.runs ?? 'drives the editor server'})`)),
    ...FLAGS.flatMap((r) => row(r.slice(0, -1).join(', '), r.at(-1))),
    '',
    'The audits, and what each is judged against:',
    '',
    ...AUDITS.flatMap((a) => [
      ...para(`${a.name} (${a.flag ?? 'default'}) — ${a.blurb}`, 2, 2),
      ...(() => {
        const [first, ...more] = wrapText(a.judge.replace(/\s*\n\s*/g, ' '), TERM_W - 20, 0);
        return [`    judged against: ${first}`, ...more.map((l) => ' '.repeat(20) + l)];
      })(),
      '',
    ]),
  ].join('\n');
};
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
const VERBOSE = ARGV.includes('--verbose') || ARGV.includes('-v');
// Fixtures probe a few at a time because the cost is waiting, not computing.
// `--serial` collapses that to one lane: if a result ever looks wrong, run it
// and see whether concurrency was the cause. The two must agree — and if they
// ever do not, the concurrent path is the bug, not the answer.
const LANES = ARGV.includes('--serial') ? 1 : 4;
// Which audits this run covers — computed once, ON the table, so no other site
// can disagree with it. NAMING a lane narrows the run to the lanes named;
// naming none runs them ALL, because the alternative — defaulting to one lane —
// defaults to the only lane whose clean run is contractual, so the bare command
// would print an all-green screen while every lane that can carry news sat
// unrun. Speed never bought enough to justify that silence — the run is
// dominated by waiting on the editor server, and the two lanes holding closed
// denominators are the cheapest of the six. `--type` is the fast loop for
// whoever is authoring a fixture.
const named = AUDITS.some((a) => ARGV.includes(a.flag));
for (const a of AUDITS) a.ran = !named || ARGV.includes(a.flag);
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
// tsgo half of the preflight, so `bun run audit --map` is honest about
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
    if (gone.length) missing.push(`the fixture corpus (${gone.join(', ')}) — run \`bun install\` in test/audit/`);
  }
  if (missing.length) {
    console.error('\n✗ The audit cannot run — dependencies are missing:');
    for (const m of missing) console.error(`  • ${m}`);
    console.error('\nInstall them, then re-run `bun run audit`.\n');
    process.exit(1);
  }
}

// One tsc-diagnostic output line: `path(line,col): error TScode`. The
// basename class admits dots — role-suffixed names (`NN-family.errors.ts`)
// would otherwise truncate to `errors.ts` and mis-key every downstream
// lookup, turning a twin full of errors into a silent green cell.
const TSC_DIAG = /([\w.-]+\.tsx?)\((\d+),(\d+)\): error TS(\d+)/;

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

// ── dimension 1: compiles
async function dimCompiles(ripPath) {
  try {
    await execFileP('bun', [RIP, '--ts', ripPath], { encoding: 'utf8', timeout: 30000, maxBuffer: MAX_FACE });
    compiled.set(ripPath, Promise.resolve(true));
    return { ok: true };
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
  for (const d of [FIX, CLM]) if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (f.endsWith('.rip')) fs.copyFileSync(path.join(d, f), path.join(dir, f));
  const tscfg = JSON.parse(fs.readFileSync(path.join(HERE, 'tsconfig.json'), 'utf8'));
  tscfg.include = ['.'];   // the fixtures are flat here, not under corpus/
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
    const keyword = m[1];
    // DECL's match ENDS at the name, so this is the name's exact column.
    // Searching for the name instead would find it inside its own prefix —
    // `export port` answers 2, the `port` in `export`, which both mis-places
    // the probe and makes the follow-token test below read the wrong bytes.
    let name = m[2], character = m[0].length - name.length;
    // `Base::member` declares the MEMBER on Base's prototype, never Base.
    // Read as a bare name it declares `String`, and the probe then answers
    // about TypeScript's own global constructor — text no twin can match and
    // no pin should hold, being lib.d.ts prose that moves on every TS bump.
    // Re-pointing also puts the follow-token test past the member, where the
    // annotation or assignment that makes it a declaration actually sits.
    const proto = text.slice(character + name.length).match(/^(\?*::)([A-Za-z_$][\w$]*)/);
    if (proto) {
      character += name.length + proto[1].length;
      name = proto[2];
    }
    // Only actual DECLARATIONS, not usage statements. A keyword form
    // (def/class/…) always declares. A bare name declares only when its
    // next token is an assignment / annotation / reactive operator
    // (= : := ~= ~>); a name followed by `.`/`(`/`[` is a usage
    // (console.log(…)) — which the old heuristic wrongly probed.
    if (!keyword) {
      const after = text.slice(character + name.length);
      if (!/^!?\s*(?:<[^>]*>)?\s*(?:~[=>]|[:=])/.test(after)) return;
    }
    // `code` is the line with strings blanked and comments cut — the token
    // audit classifies binding forms off it (`codeOf` is hoisted).
    out.push({ name, keyword: keyword ?? null, line, character, text: text.trim(), code: codeOf(text.trim()) });
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
// Two branches: a keyword declaration, and a BARE ASSIGNMENT — which rip's own
// `declsOf` treats as a declaration (`ledger = 34` re-declares nothing but is
// the site a hover answers about), so the twin has to enumerate it or the rip
// side has a probe with no oracle and falls back to a pin. The trailing
// `[^=>]` is load-bearing twice over: `=` would let `x == y` through, and `>`
// would let a line-start `x => …` register the ARROW'S PARAMETER as a
// declaration, which would shift every later `name#occurrence` for that name.
const TS_DECL = /^(?:(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|enum|type)\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*=[^=>])/;
function tsDeclsOf(src) {
  const out = [];
  src.split('\n').forEach((text, line) => {
    if (/^\s/.test(text) || !text.trim()) return;
    const m = text.match(TS_DECL);
    if (!m) return;
    // The keyword branch's match ENDS at the name, so its offset is exact; the
    // bare-assignment branch is anchored, so the name starts at column 0.
    // Searching for the name instead would find it inside its own keyword —
    // `export const port` answers 2, the `port` in `export`.
    const name = m[1] ?? m[2];
    out.push({ name, line, character: m[1] ? m[0].length - m[1].length : 0 });
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
    for (const d of [FIX, CLM]) if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (f.endsWith('.rip')) fs.copyFileSync(path.join(d, f), path.join(this.dir, f));
    // No errors/ copy: the Diagnostics Audit opens its fixtures with in-memory
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
// (`from './08-functions.rip'`) resolves to its sibling face: TS appends `.ts`
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
// REPORTED (-v) rather than scored.
function expectedTokenType(d, form) {
  if (d.keyword) return KEYWORD_TOKEN[d.keyword] ?? null;
  // A named EFFECT binding holds the disposer — a callable — so an
  // UNANNOTATED name classifies `function` in every form (inline, carried,
  // block): the value is the information, the class-expression doctrine.
  // An ANNOTATED effect (`x: Function ~>`) is governed by its annotation
  // instead — tsgo's own rule, identical on the equivalent plain-TS line —
  // so asserting against it is an expectation this audit cannot defend:
  // reported, never scored, like the dual classes below. Ruled in
  // RULINGS.md (Tokens). Decided before the value-side scan because the
  // carried forms hide their body from a line-shaped read, and the
  // disposer is the value regardless.
  if (form === 'effect') return /:.+~>/.test(d.code) ? null : 'function';
  const val = valueSide(d.code, form);
  // A carried value (`name =` with the expression on the next line) is
  // invisible to this line-shaped scan, so no type expectation exists to
  // defend — same contract as the undecidables below.
  if (!val.trim()) return null;
  if (/^\s*schema\b/.test(val)) return null;         // dual value+type — see above
  if (/^\s*component\b/.test(val)) return 'class';   // the component lowering emits a class
  // A class expression declares a class — the name is `new`-ed and
  // extended, and tsgo classifies it `class`, the informative answer
  // (RULINGS.md, Tokens).
  if (/^\s*class\b/.test(val)) return 'class';
  // A cast to a constructor type (`X = value as new () => …`) is a
  // variable by spelling and a class by shape — dual like schema, so
  // reported rather than scored.
  if (/\bas\s+new\b/.test(val)) return null;
  // A prototype access (`A::m`, `a?::m`) is a variable by spelling and
  // whatever the member is by value — a method classifies `function`, a data
  // property `variable`, and this line-shaped scan cannot resolve which.
  // Undecidable, so reported rather than scored: the same contract as the
  // constructor cast above, and the rulings' own doctrine that a callable
  // VALUE is the informative answer (RULINGS.md, Tokens — the named-effect
  // row). Scoring `variable` here would manufacture a red on correct
  // behavior, and `token.type` is red by agreement for an unrelated reason,
  // so that red would be invisible.
  if (/^\s*[A-Za-z_$][\w$.]*\??::/.test(val)) return null;
  // A function-valued PLAIN binding classifies as `function`, not
  // `variable` — TS's own rule, and the right one. Restricted to `plain`:
  // an arrow handed to `:=`/`~=` is wrapped in a cell, so the NAME stays a
  // variable no matter what the arrow is.
  if (form === 'plain' && IS_ARROW.test(val)) return 'function';
  return 'variable';
}
function expectedToken(d) {
  const raw = d.keyword ?? bindingForm(d.code);
  const type = expectedTokenType(d, raw);
  // An exported plain VALUE binding lowers to `export const` by the
  // emitter's stated design ("never a hoisted write"), so the name IS
  // readonly — ruled in RULINGS.md (Tokens); the writable-exports question
  // lives in FINDINGS.md's export-reassignment row, and if that ruling
  // ever flips the emission, this expectation goes red at exactly that
  // flip. Scoped to value bindings (variable/function): a component- or
  // class-valued export lowers to its own declaration form, and a carried
  // value cannot be read from this line — neither can defend a readonly
  // expectation in either direction, so neither asserts one.
  const exportedPlain = !d.keyword && raw === 'plain' && /^export\s/.test(d.code);
  let readonly;
  if (d.keyword) readonly = null;
  else if (exportedPlain) readonly = (type === 'variable' || type === 'function') ? true : null;
  else readonly = READONLY_FORMS.has(raw);
  return { type, readonly, form: exportedPlain ? 'export' : raw };
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
  'super', 'with', 'case', 'by', 'own',
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
// The census population is reads that SHOULD resolve. A word that is syntax in
// its position resolves to nothing by design, so counting it would demand a row
// no honest emission can produce — and the hover audit already pins these
// positions null and GREEN, so counting them here would have two instruments
// disagreeing about the same bytes.
//
// This is also the one lever that could shrink the census without fixing
// anything, which is why it is a TABLE and not a filter: the compiler names the
// kind at the site it consumes the word (never the audit guessing from
// spelling — `key` is a loop variable in 06-loops and `ref` a schema field in
// 14-schema, both of which must keep counting), every kind here must actually
// occur, and `mapping.exclusions` goes red when one stops occurring, so an
// exclusion cannot outlive its reason.
const MAP_EXCLUSIONS = new Map([
  ['render-channel', "the render DSL's own channel words — `ref:` binds a cell, `key:` identifies loop rows, `slot` projects children. The compiler CONSUMES each; none reaches a face entity"],
  ['gate-prefix', "a gate's `@app.data` marker, erased whole by the lowering, which keeps only the route name. RULINGS.md pins these segments to silence"],
]);

function mappingScan(src, code, mappings, vocabulary = []) {
  const rows = [];         // flagged reads WITH a containing row (unplaced/mistext)
  const missingRows = [];  // flagged reads with NO row at all — counted apart
  const excluded = [];     // reads the compiler consumed as vocabulary
  let total = 0, census = 0, byLuck = 0;
  const drifted = [];    // resolved and byte-equal, but maps back somewhere else
  const consumed = (offset, len) => vocabulary.find((v) => v.start === offset && v.end === offset + len) ?? null;
  for (const { name, offset } of identReads(src)) {
    const eaten = consumed(offset, name.length);
    if (eaten !== null) { excluded.push({ name, offset, kind: eaten.kind }); continue; }
    total++;
    const g = sourceOffsetToGeneratedExact(mappings, offset, src, code);
    const placed = g !== null;
    const text = g === null ? true : code.slice(g, g + name.length) === name;
    // IDENTITY — the third invariant, and the only one byte-equality cannot
    // supply. `text` asks whether the resolved position holds the read's
    // bytes; it cannot ask whether those are the SAME bytes, so a read landing
    // on a different occurrence of its own name passes it. Mapping back closes
    // that: the reverse direction is the editor's own, and the source span it
    // answers must contain the offset we started from. CONTAINMENT, not
    // equality — a read resolving through a cover row maps back to the whole
    // cover, which is coarse but not wrong, and is what the census already
    // counts. Only checked where the forward map resolved.
    const back = g === null ? null : generatedSpanToSource(mappings, g, g + name.length);
    const identity = g === null ? true : (back !== null && back[0] <= offset && offset <= back[1]);
    const flagged = !(placed && text);
    if (!flagged && !identity) drifted.push({ name, offset, gen: g, back });
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
    // `gen`/`hit` make the failure self-describing under -v: where the precise
    // map landed (null if it refused) and the bytes actually sitting there — for
    // a mistext, the wrong text a hover at this read would answer about.
    rows.push({ name, offset, placed, text, role: row.role, root, gen: g, hit: g === null ? null : code.slice(g, g + name.length) });
  }
  return { total, rows, missingRows, census, byLuck, drifted, excluded };
}

// ── run
// The positive corpus spans BOTH charter buckets; every lane treats them
// identically (the buckets differ only in which instrument justifies a
// fixture's existence — judged in the grammar audit). Basenames must be
// unique across buckets: twins, pins, and CLAIMS carriers all key on them.
const grammarFixtures = fs.readdirSync(FIX).filter((f) => f.endsWith('.rip')).sort();
const claimsFixtures = fs.existsSync(CLM) ? fs.readdirSync(CLM).filter((f) => f.endsWith('.rip')).sort() : [];
{
  const dup = grammarFixtures.filter((f) => claimsFixtures.includes(f));
  if (dup.length) {
    console.error(`✗ fixture basename collision across corpus buckets: ${dup.join(', ')} — twins, pins, and CLAIMS carriers key on basenames, so every fixture name must be unique corpus-wide.`);
    process.exit(1);
  }
}
const fixDirOf = (f) => (claimsFixtures.includes(f) ? CLM : FIX);
const fixPath = (f) => path.join(fixDirOf(f), f);
const fixtures = [...grammarFixtures, ...claimsFixtures].sort();
// The corpus BANS suppression directives in positive fixtures: a marker
// consumes a diagnostic before any dimension can see it, so a smuggled one
// rots the corpus silently — verdict would stay green over a suppressed
// error. Refused here, for every audit mode, at comment-start position (a
// prose mention is not a directive). corpus/errors/ is exempt — its
// line-aligned @ts-nocheck pragma pair is the Diagnostics Audit's own
// enforced discipline — and the carriage FEATURE (a rip marker surviving
// onto the face) is gated in test/lang/tsface.test.js, not here.
{
  const smuggled = fixtures.filter((f) =>
    /^[ \t]*(?:#|\/\/)[ \t]*@ts-(?:expect-error|ignore|nocheck)(?=\s|$)/m.test(fs.readFileSync(fixPath(f), 'utf8')));
  if (smuggled.length) {
    console.error(`✗ suppression directive in a positive fixture: ${smuggled.join(', ')} — the corpus bans @ts-expect-error/@ts-ignore/@ts-nocheck in positives (a marker consumes the diagnostic the dimensions must see); negatives belong in corpus/errors/.`);
    process.exit(1);
  }
}
// The Diagnostics Audit's fixtures, listed here beside the flat walk so the
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
// Every audit table pads its name column to the longest name plus two, then
// one joining space — the same gap everywhere. The lane's labels carry the
// errors/ prefix, so its width derives from its own list.
const ERR_NAME_W = Math.max(18, ...errorFixtures.map((f) => path.join('errors', f).length)) + 2;
const DIMS = [['compiles', 10], ['verdict', 10], ['runtime', 9], ['twin', 8], ['strict', 8]];
const RULE_W = NAME_W + 3 + DIMS.reduce((a, [, w]) => a + w, 0) + (DIMS.length - 1);

// The sections scroll past in one full run, so each needs a seam that
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
// The rule closes the header block, so it runs under the whole of it: the
// GRID's width is its floor — a short title still opens the report as wide as
// the widest thing printed below it — the longest header line is its reach,
// and the TERMINAL is its ceiling. A rule that stops mid-title reads as a
// broken underline; one that wraps prints a second stub line of dots under the
// first, which reads as a rendering fault rather than a seam. The subtitle
// drops to its own wrapped line when the chip leaves it too little room to sit
// alongside, and the rule then closes under the widest of those lines.
const auditBanner = (title, subtitle) => {
  const chip = `  ${paint('1;7', ` ${title} `)}`;
  const room = TERM_W - visibleW(chip) - 2;
  // Composed before anything prints: the rule is measured against the lines it
  // has to close, so those lines have to exist first.
  const head = subtitle && visibleW(subtitle) > room
    ? [chip, ...wrapText(dim(subtitle), TERM_W - 2, 2).map((l) => `  ${l}`)]
    : [`${chip}${subtitle ? '  ' + dim(subtitle) : ''}`];
  console.log('\n');
  for (const l of head) console.log(l);
  // Every header line is indented two, and so is the rule — the widths compare
  // only after that shared indent comes off both.
  const ruleW = Math.min(TERM_W - 2, Math.max(RULE_W, ...head.map((l) => visibleW(l) - 2)));
  console.log(`  ${dim('┈'.repeat(ruleW))}\n`);
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
// running audits actually have (a bare --diagnostics run over one fixture boots one
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

// ── AUDIT RUN ORDER — bottom-up by instrument layer, so in a full run each
// section's failures explain the one after it: the Grammar Audit (can the
// parser even reduce it) and the Mapping Audit (do the compiler's own rows
// place every read) run first and need no server; then the Type Audit (the
// face and its verdict), the Diagnostics Audit (each diagnostic's code and
// position), and last the probe pass driving the slow LSP surfaces (hover,
// tokens). The Totals at the bottom print in this same order.
// ── the Grammar Audit (ROADMAP "M2"): which productions the corpus exercises.
// Parser only — no compile, no server. Each fixture is parsed with an
// instrumented Parser whose ctx.onReduce records every rule the parse reduces;
// the denominator is the generated parser's own ruleNames table (index 0 is
// the $accept pad), so the question "is every production exercised by at least
// one fixture?" has a CLOSED answer no corpus-relative rate can give. The
// uncovered list is the corpus's remaining work — group it by LHS so a reader
// sees which CONSTRUCTS are dark, not 200 interchangeable rows. Coverage here
// is necessary, not sufficient: a rule can be exercised while its interaction
// shapes (reorder × repetition, strings/comments in the frame) stay untested —
// those are the containment matrix's territory, joined against CLAIMS.md's
// ruled cells below, not this gate's denominator.
let gr = null;
if (RUN_GRAMMAR) {
  const names = Parser().ruleNames;
  // Productions no fixture can or should ever reduce, netted out of the
  // denominator. This table is the GATE'S own record — part of the
  // measurement, so it lives with the instrument and outlives the manifest,
  // whose sections are grouping only. Three classes: LEXICALLY UNREACHABLE —
  // the lexer mints TYPE_PARAMS only when the angle run's `=` is immediately
  // followed by `component` on the same line, so the line-break layout
  // variants of the assignment cross-product can never receive the token —
  // BANNED BY DESIGN — the emitter rejects a for loop that binds no
  // variable, and the productions stay in the grammar as that error
  // message's carrier — and CARRIED ONLY BY A VACUOUS FIXTURE: the empty
  // program reduces `Root → ε` and nothing else, so a fixture holding it
  // passes every dimension by having nothing to check, and buys a coverage
  // point with a file that cannot fail. Self-policing against grammar drift: an excluded
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
    ['ImportSpecifier → DEFAULT', 'no legal ES lowering — a bare default specifier has no binding name (the emitter currently passes it through verbatim); the aliased spelling is ImportSpecifier → DEFAULT AS Identifier'],
    ['Root → ε', 'carried only by a vacuous fixture — the empty program is its sole carrier and declares nothing, so it asserts nothing on any dimension; that an empty file compiles and checks clean is guarded in test/toolchain/check.test.js instead'],
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
  // `after N exclusions` rather than `(N excluded)`: the count printed here is
  // the DENOMINATOR, already net of the exclusions, and a parenthesised count
  // beside a total reads as a part OF that total — a reader would subtract
  // twice and arrive at a denominator the report never uses.
  auditBanner('GRAMMAR AUDIT', `productions the corpus reduces · ${denom.length} rules${excludedIdx.length ? ` after ${excludedIdx.length} exclusions` : ''} · ${fixtures.length} fixtures`);
  const seen = new Set();
  // Reducers per production, for UNIQUE contribution — the retirement
  // instrument: a fixture whose every reduction some other fixture also
  // performs is removable with zero coverage loss, and only a per-fixture
  // count can say so (the cumulative `+N` above cannot).
  const reducers = new Map();
  const perFixture = new Map();
  // Containment pairs — (construct inside ancestor), transitive, from the
  // parse tree. Production counting is context-free, so switch-in-render
  // and switch-anywhere are indistinguishable to the gate; this matrix is
  // what CLAIMS.md's Containment cells join against. Curated construct
  // heads only: a call puts its callee in head position, so raw heads are
  // noisy, and data heads (`object`, `array`, `block`) sit under nearly
  // every construct, so their cells are satisfied by accident rather than
  // by a shape anyone chose.
  //
  // The list is SELF-POLICING, because a head nobody can spell makes the
  // matrix claim a capability it does not have: a curated head no fixture
  // produces paints red below. Two things hide there and both need a
  // decision rather than an absence — a head the parser never mints (rip
  // lowers `unless` to `if` and `until` to `while`, and `catch`/`finally`
  // are positional children of `try`, so a cell naming any of them could
  // never be satisfied by any fixture) and a head that is merely untested
  // (reachable, so its cells are candidates, but the matrix cannot express
  // them until something spells it).
  const CONSTRUCT_HEADS = new Set([
    'component', 'render', 'schema', 'class', 'if', 'switch', 'when', 'for-in', 'for-of', 'for-as',
    'while', 'loop', 'try', 'throw', 'state', 'computed', 'effect', 'gate', 'readonly', 'def',
    '->', '=>', 'export', 'import', 'enum',
    // Constructs whose containment is a distinct type question and which
    // the matrix could not express before: whether a cast's type survives
    // its context, whether a comprehension's element type does, whether a
    // nested type declaration resolves, and whether the suspension forms
    // carry their awaited type out of the construct holding them.
    'cast', 'comprehension', 'type-decl', 'do-iife', 'await', 'yield',
  ]);
  const pairsSeen = new Set();
  const headsSeen = new Set();
  const walkPairs = (n, anc) => {
    if (!Array.isArray(n)) return;
    const h = typeof n[0] === 'string' && CONSTRUCT_HEADS.has(n[0]) ? n[0] : null;
    if (h) headsSeen.add(h);
    if (h) for (const a of anc) pairsSeen.add(`${h} inside ${a}`);
    const next = h ? [...anc, h] : anc;
    for (const c of n) walkPairs(c, next);
  };
  // Both buckets parse (the containment matrix is corpus-wide), but only
  // grammar-bucket reductions count toward coverage and unique
  // contribution: a claims fixture's charter is CLAIMS.md, so its
  // reductions must never let a production read as covered — deleting the
  // fixture would then drop coverage no claims instrument watches.
  // Rows are BUFFERED rather than printed as each fixture parses, because the
  // per-fixture number worth reading is UNIQUE contribution — how many
  // productions this fixture alone reduces — and that is not knowable until
  // every fixture has parsed. What this replaces, marginal `+N new rules`, was
  // a function of ALPHABETICAL ORDER: `01-basics` collected +79 for going
  // first while holding only 11 productions uniquely, and `12-reactive` showed
  // +64 while holding 57 — so the column ranked the corpus by filename and
  // inverted the real one. `rules` (breadth) and `unique` (irreplaceability)
  // are both order-independent, and together they answer the two questions a
  // fixture list is read for: how much does this file exercise, and what would
  // deleting it cost.
  // `ok` carries the outcome, never the message: a discriminant that is the
  // message text is falsy exactly when the message is empty, and a parse
  // failure would then fall through to the pass branches and print as a fixture
  // that parsed. For the same reason the first NON-EMPTY line is taken — an
  // error whose text opens with a newline still names itself.
  const firstLine = (s) => String(s).split('\n').find((l) => l.trim()) ?? 'no message';
  const fixtureRows = [];
  for (const f of fixtures) {
    const grammarBucket = fixDirOf(f) === FIX;
    const mine = new Set();
    const p = Parser({ onReduce: grammarBucket ? (id) => mine.add(id) : () => {} });
    p.lexer = makeParserLexer(fixPath(f));
    try {
      const text = fs.readFileSync(fixPath(f), 'utf8');
      const tree = p.parse(text);
      // A PARSE error is RETURNED, not thrown — only the LEXER throws. The
      // generated parser stops at the offending token and hands back
      // `{ sexpr: null, stores: null, diagnostics: [...] }`, so a bare
      // try/catch reads a program the compiler rejects as one that parsed: it
      // prints the ✓ a clean parse wears, and the rules reduced on the way to
      // the bad token stand as coverage. The returned diagnostic IS the
      // outcome, so it is what the row is judged on.
      const bad = tree?.diagnostics?.[0];
      if (bad || !tree?.stores) {
        // The offending token's own line:column, the way the compiler prints
        // it: the name column says which file to open, and this says where to
        // look once it is open.
        const at = bad ? offsetToPosition(lineStartsOf(text), bad.start ?? 0) : null;
        fixtureRows.push({ f, ok: false, failed: bad ? `at ${at.line + 1}:${at.character + 1} — ${firstLine(bad.message)}` : '— the parser returned no tree' });
        continue;
      }
      walkPairs(tree.sexpr, []);
      // Coverage folds in only once the parse SUCCEEDS. Reductions performed on
      // the way to a rejected token are not evidence that the corpus exercises
      // a production — a file the compiler refuses cannot be the reason a rule
      // reads as covered, or fixing the file would DROP coverage nobody knew
      // rested on it, and the uncovered queue would be short by exactly the rules only
      // the broken fixture reached.
      if (grammarBucket) {
        perFixture.set(f, mine);
        for (const id of mine) { seen.add(id); reducers.set(id, (reducers.get(id) ?? 0) + 1); }
      }
      fixtureRows.push({ f, ok: true, grammarBucket, reduced: mine.size });
    } catch (e) {
      // The LEXER's throw — it names itself with an absolute path, which in
      // this list is a wall of shared prefix before the part that differs.
      fixtureRows.push({ f, ok: false, failed: `— ${firstLine(e?.message ?? e).replaceAll(CORPUS + '/', '')}` });
    }
  }
  // Which fixtures the coverage would survive losing — the retirement
  // instrument, now the fixture list's own column.
  const uniqueOf = (f) => [...(perFixture.get(f) ?? [])].filter((id) => reducers.get(id) === 1).length;
  for (const r of fixtureRows) {
    // The only row here that carries PROSE — a parser's expected-token list
    // runs past any terminal — so it is the only one that wraps, hanging under
    // its own column rather than dangling fragments at column zero.
    if (!r.ok) { out(`    ${red('✗')} ${pad(r.f, NAME_W + 2)} ${dim(`parse failed ${r.failed}`)}`); continue; }
    // A claims fixture parses but contributes no coverage, so it must not wear
    // the ✓ a contributing fixture wears: one mark, two meanings, and the
    // weaker meaning is the one a reader would assume. It still belongs to the
    // gate — it feeds the containment matrix below, and it must PARSE like
    // anything else in the corpus — but neither column has a value to show, so
    // one line stands for the whole bucket and -v breaks it out. Six rows
    // repeating one sentence is a third of this table saying nothing.
    if (!r.grammarBucket) {
      if (VERBOSE) console.log(`    ${dim('·')} ${pad(r.f, NAME_W + 2)} ${dim('no coverage — judged under Corpus claims')}`);
      continue;
    }
    const u = uniqueOf(r.f);
    console.log(`    ${green('✓')} ${pad(r.f, NAME_W + 2)} ${dim(`${String(r.reduced).padStart(3)} rules · `)}${(u ? dim : yellow)(`${String(u).padStart(3)} unique`)}`);
  }
  // A failed claims fixture already printed its own ✗ row above, so this line
  // counts only the ones that parsed — it can never stand in front of a
  // failure and report it as fine.
  {
    const n = fixtureRows.filter((r) => r.ok && !r.grammarBucket).length;
    if (n && !VERBOSE) out(`    ${dim('·')} ${dim(`${n} claims fixtures parsed — no coverage, judged under Corpus claims; -v lists them`)}`);
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
  out(`\n    ${bold('Coverage')} ${dim(`(exercised = reduced by at least one fixture)`)}`);
  const pct = ((100 * (denom.length - uncovered.length)) / denom.length).toFixed(1);
  // COLOUR, one rule for every `N / M` in this gate. GREEN when the fraction
  // is whole — the obligation holds. RED when the shortfall is a contract
  // violation (a containment construct nothing spells, a wrapped divider):
  // something broke. Otherwise UNPAINTED, because the shortfall is a QUEUE,
  // and Totals already fixes what yellow means — `work remains, never because
  // anything is wrong`. Painting 520 yellow said the achievement was the
  // problem; the 6 uncovered are the problem, and they are yellow in the
  // queue below, where a reader can act on them. It also disagreed with
  // Totals, which paints the same 520 green.
  console.log(`    ${(uncovered.length ? dim : green)(String(denom.length - uncovered.length))} ${dim('/')} ${dim(String(denom.length))} ${dim(`productions (${pct}%)`)}`);
  if (excludedIdx.length) {
    out(`    ${dim(`${excludedIdx.length} excluded by ruling (unreachable, banned, or coverable only by a fixture that asserts nothing) — netted from the denominator${VERBOSE ? '' : '; -v lists them'}`)}`);
    // A production name is itself most of a line, so its reason goes BENEATH
    // rather than beside: a label column that wide leaves the prose a gutter
    // too narrow to read, and the pair is legible stacked.
    if (VERBOSE) for (const i of excludedIdx) {
      out(`      ${dim(names[i])}`);
      out(`        ${dim(EXCLUDED.get(names[i]))}`);
    }
  }
  // Both directions of the exclusion table's self-policing, printed where the
  // exclusions are: a claim that a production is unreachable is refuted by the
  // corpus reaching it, and a row naming no production has outlived its rule.
  const falseExclusions = excludedIdx.filter((i) => seen.has(i));
  for (const i of falseExclusions) out(`    ${red('✗')} ${red('excluded but reduced:')} ${names[i]} ${dim("— the exclusion claim is false; fix the gate's exclusion table")}`);
  for (const k of staleExcluded) out(`    ${red('✗')} ${red('excluded row names no grammar production:')} ${k} ${dim("— stale; fix the gate's exclusion table")}`);
  // The verdict on the unique column above — the RETIREMENT measurement, and
  // it reports either way for the reason every other check in this section
  // does: a line that appears only on bad news makes its absence ambiguous
  // between "nothing to report" and "never measured", and this section's whole
  // discipline is that a measurement which ran contributes a clause. So it
  // carries a count in the same `N / N` shape as its neighbours rather than a
  // sentence of reassurance, and names the removable files when there are any.
  {
    // Only fixtures that PARSED can be judged removable: one that failed
    // reduces nothing the corpus can rely on, so it trivially has no unique
    // contribution, and listing it as removable-at-no-cost would answer a
    // question nobody asked over the one the ✗ row just raised.
    const judged = fixtureRows.filter((r) => r.ok && r.grammarBucket);
    const removable = judged.filter((r) => uniqueOf(r.f) === 0).map((r) => r.f);
    out(`    ${(removable.length ? dim : green)(String(judged.length - removable.length))} ${dim('/')} ${dim(String(judged.length))} ${dim('fixtures reduce a production no other does')}`
      + (removable.length ? `${dim(' · ')}${yellow(`removable at zero coverage loss: ${removable.join(', ')}`)}` : ''));
  }
  // The queue is the ANSWER to the number above it — which productions the
  // corpus does not reach — so it sits under that number rather than behind
  // the censuses of four other denominators. Its rows split by STANDING,
  // because the two halves are different kinds of work: a PARKED production is
  // blocked on an open finding (MANIFEST.md names which), and an AVAILABLE one
  // is a fixture someone could write this afternoon. So the available half is
  // always named — it is the actionable half, and a queue that hides what can
  // be worked behind a flag is a queue nobody works — while the parked half
  // stays counted, its spellings under -v. Without a manifest there is no park
  // data to sort by, so the whole queue reports as counts, as before.
  if (groups.size) {
    const isParked = (r) => owner?.parked.has(r) ?? false;
    const parkedN = uncovered.filter((i) => isParked(names[i])).length;
    const availN = uncovered.length - parkedN;
    const title = owner ? 'Uncovered, by owning file (MANIFEST.md)' : 'Uncovered, by construct';
    const standing = owner
      ? (availN
        ? `${availN} available to cover, ${parkedN} parked on open findings (FINDINGS.md)${VERBOSE || !parkedN ? '' : '; -v spells the parked ones'}`
        : `all ${parkedN} parked on open findings (FINDINGS.md)${VERBOSE ? '' : '; -v spells them'}`)
      : (VERBOSE ? 'every production shown' : 'counts only, -v for every production');
    out(`\n    ${bold(title)} ${dim(`— ${standing}`)}`);
    // Files read in wave order; constructs by descending count.
    const rows = [...groups.entries()].sort(owner ? (a, b) => a[0].localeCompare(b[0]) : (a, b) => b[1].length - a[1].length);
    for (const [g, rules] of rows) {
      const paint = g === 'UNALLOCATED' ? red : yellow;
      console.log(`      ${pad(g, 24)} ${paint(String(rules.length).padStart(3))}`);
      for (const r of rules) {
        if (!(VERBOSE || g === 'UNALLOCATED' || (owner && !isParked(r)))) continue;
        out(`        ${dim(r)}${isParked(r) ? ' ' + yellow('· parked') : ''}`);
      }
    }
  }
  // ── NEGATIVE COVERAGE — the error lane measured against the positive
  // corpus's own claims. The denominator problem: positives get theirs from
  // the grammar, but "wrong programs" has no inherent universe — so the
  // denominator here is the POSITIVE CORPUS ITSELF, on the polarity
  // principle the token invariant already states: a claim class the
  // positives make with no negative demonstrating its rejection is untested
  // in the direction that matters. Two layers with different standing:
  // TYPE VOCABULARY is CONTRACTUAL — every class the positives claim must
  // have at least one error-lane instance, and an unfalsified class paints
  // red (the type-level text is invisible to the parser: a TYPE token is
  // one token, so tuples, index signatures, constraints live beneath the
  // production grid). Productions-per-family remains a GAUGE — which
  // families have any negative at all, on the gate's own denominator;
  // report-only until its contract is ruled. Classification is textual and
  // conservative.
  let ng = null;
  {
    // Parses each type text as its own virtual file (attribution by file,
    // immune to a text parsing as several statements) through the pinned
    // tsgo's unstable ASYNC API — bun-compatible, unlike the sync channel,
    // which reads a raw stdio fd bun does not expose — and records the TS
    // type-AST node kinds per text.
    const classifyTypeTexts = async (texts) => {
      const { API } = await import('typescript/unstable/async');
      const { createVirtualFileSystem } = await import('typescript/unstable/fs');
      const { SyntaxKind } = await import('typescript/unstable/ast');
      const ordered = [...texts.keys()];
      const vfiles = { '/p/tsconfig.json': `{"files":[${ordered.map((_, i) => `"t${i}.ts"`).join(',')}],"compilerOptions":{"noEmit":true}}` };
      ordered.forEach((k, i) => { vfiles[`/p/t${i}.ts`] = texts.get(k) + '\n'; });
      const api = new API({ fs: createVirtualFileSystem(vfiles), cwd: '/p' });
      const snap = await api.updateSnapshot({ openProject: '/p/tsconfig.json' });
      const program = snap.getProjects()[0].program;
      // Range markers (FirstTypeNode, LastKeyword, …) alias REAL kind values
      // — FirstTypeNode IS TypePredicate's number — so they must never enter
      // the name map, or a kind gets recorded under its marker alias.
      const kindEntries = Object.entries(SyntaxKind).filter(([n, v]) => typeof v === 'number' && !/^(First|Last)/.test(n));
      const kindName = new Map(kindEntries.map(([n, v]) => [v, n]));
      // THE CENSUS UNIVERSE — every kind TS's type grammar defines, so the
      // claimed/unclaimed report never depends on anyone thinking of a kind.
      // The structural set is mechanical (the FirstTypeNode..LastTypeNode
      // range). The rest are TS's own definitions transcribed: the
      // KeywordTypeSyntaxKind union, the LiteralType payload keywords, the
      // readonly member modifier, the type-member signatures, and the
      // carrier kinds the walker records. The transcription cannot rot
      // silently: a claimed kind outside this universe paints red below,
      // demanding the derivation be extended.
      const structural = kindEntries
        .filter(([, v]) => v >= SyntaxKind.FirstTypeNode && v <= SyntaxKind.LastTypeNode)
        .map(([n]) => n);
      const universe = [...new Set([
        ...structural,
        'AnyKeyword', 'BigIntKeyword', 'BooleanKeyword', 'IntrinsicKeyword', 'NeverKeyword', 'NumberKeyword',
        'ObjectKeyword', 'StringKeyword', 'SymbolKeyword', 'UndefinedKeyword', 'UnknownKeyword', 'VoidKeyword',
        'NullKeyword', 'TrueKeyword', 'FalseKeyword', 'ReadonlyKeyword',
        // Modifier keywords that ARE walkable children in type contexts
        // (`abstract new () => T`, `asserts x is T`). The keyof/unique/
        // readonly operators are NOT children — TypeOperator holds the
        // operator as a property, so TypeOperator is their claimable kind.
        'AbstractKeyword', 'AssertsKeyword',
        'PropertySignature', 'MethodSignature', 'CallSignature', 'ConstructSignature', 'IndexSignature',
        'TypeParameter', 'Parameter', 'ExpressionWithTypeArguments',
        // Derived pseudo-kinds — distinctions a bare kind cannot carry.
        'OptionalPropertySignature', 'ConstrainedTypeParameter', 'SelfReferentialAlias',
      ])].sort();
      // The universe's transcribed parts are guarded on BOTH sides: a
      // claimed kind outside the universe paints red below (live), and this
      // hash pins the pinned TypeScript's whole type-relevant name surface —
      // a pin bump that adds or renames kinds fails here, forcing the
      // derivation to be re-reviewed instead of silently missing new
      // vocabulary. Recompute: sorted TYPE_NODE-matching non-marker names.
      const surface = kindEntries.map(([n]) => n).filter((n) => /Type|Keyword|Signature|TypeReference|Parameter/.test(n)).sort().join(' ');
      const SURFACE_HASH = 'f86b9639022d9dc0';
      const surfaceHash = (await import('node:crypto')).createHash('sha256').update(surface).digest('hex').slice(0, 16);
      if (surfaceHash !== SURFACE_HASH) {
        console.error(`\n✗ the pinned TypeScript's type-kind surface changed (hash ${surfaceHash}, pinned ${SURFACE_HASH}) — re-derive the census universe in classifyTypeTexts, then update the pinned hash.`);
        process.exit(1);
      }
      // What the walker RECORDS is the universe itself, not a name pattern.
      // A pattern can silently miss a kind the universe contains — a name
      // carrying none of its words (NamedTupleMember) would then sit
      // unclaimable no matter what any fixture spells, which is the exact
      // blindness the closed denominator exists to remove. Membership makes
      // the two sides one list by construction.
      // Declaration modifiers (export/declare/default) and the wrapper's own
      // alias scaffolding are excluded by the same membership: they ride
      // statements, not types, so the universe never contains them.
      const CLAIMABLE = new Set(universe);
      const out = new Map();
      for (let i = 0; i < ordered.length; i++) {
        const sf = await program.getSourceFile(`/p/t${i}.ts`);
        const kinds = new Set();
        const walk = (n, aliasName) => {
          const k = kindName.get(n.kind);
          // Self-reference is judged against the ENCLOSING alias only — two
          // aliases in one text referencing each other are not recursion.
          if (k === 'TypeAliasDeclaration') aliasName = n.name?.text ?? null;
          if (CLAIMABLE.has(k)) {
            kinds.add(k);
            // tsgo's nodes carry the optional marker as postfixToken; the
            // kind check keeps a definite-assignment `!` from counting as `?`.
            if (k === 'PropertySignature' && n.postfixToken && kindName.get(n.postfixToken.kind) === 'QuestionToken') kinds.add('OptionalPropertySignature');
            if (k === 'TypeParameter' && n.constraint) kinds.add('ConstrainedTypeParameter');
            if (k === 'TypeReference' && aliasName && n.typeName?.text === aliasName) kinds.add('SelfReferentialAlias');
          }
          n.forEachChild?.((c) => { walk(c, aliasName); });
        };
        if (sf) walk(sf, null);
        out.set(ordered[i], [...kinds]);
      }
      await api.close?.();
      return { byText: out, universe };
    };
    const negSeen = new Set();
    let negParsed = 0;
    for (const f of errorFixtures) {
      const p = Parser({ onReduce: (id) => negSeen.add(id) });
      p.lexer = makeParserLexer(path.join(ERRD, f));
      try { p.parse(fs.readFileSync(path.join(ERRD, f), 'utf8')); negParsed++; } catch { /* an unparseable negative is the lane's failure to report, not this gauge's */ }
    }
    const famPos = new Map(), famNeg = new Map();
    for (const i of denom) {
      if (!seen.has(i)) continue;
      const g = groupOf(names[i]);
      famPos.set(g, (famPos.get(g) ?? 0) + 1);
      if (negSeen.has(i)) famNeg.set(g, (famNeg.get(g) ?? 0) + 1);
    }
    const famZero = [...famPos.keys()].filter((g) => !(famNeg.get(g) > 0)).sort();
    // The error lane's reductions that land INSIDE what the positives
    // exercise — the numerator the family rows sum to.
    const negWithin = denom.filter((i) => seen.has(i) && negSeen.has(i)).length;
    // TYPE VOCABULARY, classified by TypeScript's own grammar, live: every
    // type-level text in the corpus (TYPE/TYPE_DECL/TYPE_PARAMS/CAST tokens
    // — everything beneath the parser's one-token opacity) is parsed
    // through the pinned tsgo each run, and the type-AST node kinds are the
    // classes. The taxonomy is TS's: closed, not curated — and in-process
    // classification can never be stale. Three derived pseudo-kinds carry
    // distinctions a bare kind cannot: OptionalPropertySignature,
    // ConstrainedTypeParameter, SelfReferentialAlias.
    const TYPE_TOKEN_KINDS = new Set(['TYPE', 'TYPE_DECL', 'TYPE_PARAMS', 'CAST']);
    const typeTokensOf = (file) => {
      try {
        return tokenize(fs.readFileSync(file, 'utf8'), path.basename(file)).tokens
          .filter((t) => TYPE_TOKEN_KINDS.has(t.kind) && typeof t.value === 'string');
      } catch { return []; }
    };
    // Each distinct text, wrapped per its token kind into a standalone
    // parseable statement.
    // A declaration rip rejects has no TS form to classify; it reaches the
    // census only from an error fixture, where the raw text is the honest
    // thing to hand over.
    const declText = (raw) => { try { return renderTypeDecl(raw).join('\n'); } catch { return raw; } };
    const typeTexts = new Map();
    for (const [dir, dirFiles] of [[FIX, grammarFixtures], [CLM, claimsFixtures], [ERRD, errorFixtures]]) {
      for (const f of dirFiles) for (const t of typeTokensOf(path.join(dir, f))) {
        // A TYPE_DECL carries rip's own indented spelling, which is not
        // TypeScript — handed over raw, its members never parse and the kinds
        // inside them read as absent. renderTypeDecl is the SAME renderer the
        // face and the declaration pipeline emit through, so the census
        // classifies the declaration the compiler actually produces rather
        // than a second opinion about what it would produce.
        if (!typeTexts.has(t.value)) typeTexts.set(t.value, t.kind === 'TYPE_DECL' ? declText(t.value)
          : t.kind === 'TYPE_PARAMS' ? `type __W${t.value} = 0`
          : `type __W = ${t.value}`);
      }
    }
    const { byText: kindsByText, universe: kindUniverse } = await classifyTypeTexts(typeTexts);
    const sideKinds = (pairs) => {
      const counts = new Map();
      for (const [dir, files] of pairs) for (const f of files) for (const t of typeTokensOf(path.join(dir, f))) {
        for (const k of kindsByText.get(t.value) ?? []) counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      return counts;
    };
    const posVocab = sideKinds([[FIX, grammarFixtures], [CLM, claimsFixtures]]);
    const negVocab = sideKinds([[ERRD, errorFixtures]]);
    const claimed = [...posVocab].filter(([, n]) => n > 0);
    const unfalsified = claimed.filter(([c]) => (negVocab.get(c) ?? 0) === 0).map(([c]) => c);
    // A kind list wraps on its own indented lines — a single long line pushes
    // past the terminal and dangles unindented fragments.
    const wrapList = (items, paintFn) => {
      const width = TERM_W - 8;
      let line = '';
      const flush = () => { if (line) console.log(`      ${paintFn(line)}`); line = ''; };
      for (const c of items) {
        const next = line ? `${line}, ${c}` : c;
        if (next.length > width) { flush(); line = c; } else line = next;
      }
      flush();
    };
    // ── TYPE-VOCABULARY CENSUS — positive coverage on the closed universe.
    // The grammar audit cannot see below the parser's one-token type opacity,
    // so this is that world's denominator: every kind TS's type grammar
    // defines, claimed or queued — a kind nobody thought of is still a
    // queue item. Exclusions are rulings, named and reasoned, netted from
    // the denominator; a false or stale exclusion paints red, as does a
    // claimed kind the universe derivation does not contain.
    const EXCLUDED_KINDS = new Map([
      ['TemplateLiteralTypeSpan', 'a constituent of TemplateLiteralType — it cannot appear without its parent, so the parent is the claimable kind'],
      ['IntrinsicKeyword', 'reserved for lib.d.ts internals (`intrinsic`) — not writable in user code'],
      // Kinds rip's type sub-language rejects BY DESIGN — reasons cite the
      // lexer's own errors. If the lexer ever admits one, its text claims
      // the kind and the excluded-but-claimed red fires. MappedType is
      // lexer-rejected but NOT excluded — the open mapped-type finding
      // holds its queue row (a generic validator collision, not a
      // considered rejection); ThisType is claimable (a class method's
      // return annotation carries it).
      ['TemplateLiteralType', 'rip\'s dedicated rejection — "template-literal types are not supported — a Rip type cannot contain \'`\'" (the backtick is rip\'s own token)'],
      ['ConstructSignature', "rip's lexer rejects `new (` inside a type body; the annotation-position ConstructorType (`new () => T`) is the claimable spelling"],
    ]);
    // Queue rows a finding holds. An unclaimed kind is normally a fixture
    // someone could write; these are not — no spelling of either compiles
    // today, so listing them beside genuinely writable rows sends a reader
    // to discover that for themselves. Same distinction the production
    // queue draws between parked and available. Self-policing in both
    // directions: a held kind that becomes CLAIMED means the finding closed
    // and the hold outlived it, and a hold naming a kind outside the
    // universe is stale — each paints red rather than sitting there.
    const HELD_KINDS = new Map([
      ['MappedType', 'the open mapped-type finding — every spelling is lexer-rejected'],
      ['ImportType', 'the open import-type finding — the `.rip` specifier does not resolve'],
    ]);
    const claimedSet = new Set(claimed.map(([c]) => c));
    const universeSet = new Set(kindUniverse);
    const censusDenom = kindUniverse.filter((k) => !EXCLUDED_KINDS.has(k));
    const kindQueue = censusDenom.filter((k) => !claimedSet.has(k));
    const claimedOutside = [...claimedSet].filter((k) => !universeSet.has(k)).sort();
    const falseKindExclusions = [...EXCLUDED_KINDS.keys()].filter((k) => claimedSet.has(k));
    const staleKindExclusions = [...EXCLUDED_KINDS.keys()].filter((k) => !universeSet.has(k));
    // ── LEXER-SPELLING CENSUS — the denominator BELOW the productions.
    //
    // Production counting is blind to any feature the lexer implements by
    // rewriting bytes into tokens that already exist: `a and b` reduces the
    // same `&&` rule as `a && b`, so the gate reads full coverage while a
    // spelling the language admits goes untried. `A::m` is the sharper case —
    // three tokens minted over two bytes, reducing ordinary property rules.
    //
    // The denominator is the LEXER'S OWN table, read live (src/lexer.js
    // exports it, as Solar exports `ruleNames`), so adding an alias there adds
    // a census row here with nobody's help. The blind-spot half is derived, not
    // listed: an alias whose emitted value differs from the word the user typed
    // is exactly a spelling the parser cannot distinguish. Aliases that keep
    // their own spelling (`typeof`, `instanceof`) reach the parser as
    // themselves, so the production denominator already covers them.
    //
    // Scanner MINTS have no table, so they are curated — and a curated list
    // rots. The guard is a probe rather than a hash: each mint names a source
    // that must still produce it, driven every run, so a lexer change that
    // retires a spelling fails here instead of leaving a row that measures
    // nothing. (A hash over lexer.js would churn on every unrelated edit.)
    //
    // The queue is a GAUGE: a dark spelling is a candidate, not an obligation.
    // The battery gates these behaviorally — `is`/`isnt` compile-and-run rows,
    // a whole file for `::` — so a row earns a fixture only where the TYPE
    // question is distinct and unanswered.
    const MINTS = [
      { spelling: '::', probe: 'A::m = 1', what: 'prototype member access' },
      { spelling: '?::', probe: 'a = b?::c', what: 'the soak form of prototype access' },
    ];
    // Spellings netted out of the denominator by ruling, so the queue holds
    // only candidates a fixture could actually settle. The bar is NOT "some
    // other suite covers it" — that is the triage every queue row already
    // faces — but that the spelling's own type question cannot be distinct:
    // the tokens it produces are byte-identical to those of a spelling the
    // production denominator already covers, so no fixture written in it
    // could answer anything a fixture in the other spelling does not.
    //
    // Self-policing on both sides, as the census exclusions are: an excluded
    // spelling the corpus writes paints red (the redundancy claim is false —
    // if it was worth writing, it was worth counting), and an exclusion
    // naming a spelling the lexer no longer rewrites paints red (stale), so
    // an alias-table change trims this rather than being absorbed by it.
    //
    // All four value words are here now that #51 is closed: a binding named
    // for one is REJECTED at every annotated site, so in the positions a
    // fixture can legally carry, the spelling and its literal are
    // interchangeable and the bar is met.
    const EXCLUDED_SPELLINGS = new Map([
      ['on', '`true` produces the identical BOOL token and reaches the parser as itself, so the production denominator already covers the lowering'],
      ['off', '`false` produces the identical BOOL token and reaches the parser as itself, so the production denominator already covers the lowering'],
      ['yes', '`true` produces the identical BOOL token and reaches the parser as itself, so the production denominator already covers the lowering'],
      ['no', '`false` produces the identical BOOL token and reaches the parser as itself, so the production denominator already covers the lowering'],
    ]);
    const rewrittenAll = Object.entries(ALIASES)
      .filter(([word, [, value]]) => value !== word)
      .map(([word, [kind, value]]) => ({ spelling: word, becomes: `${kind === value ? kind : `${kind} ${value}`}` }));
    const rewritten = rewrittenAll.filter((s) => !EXCLUDED_SPELLINGS.has(s.spelling));
    // What the corpus actually writes: a token whose SOURCE BYTES are the
    // spelling. Reading the source rather than the value is the whole point —
    // by the time the parser sees `&&`, the `and` is gone.
    const spellingSeen = new Map();
    for (const f of [...grammarFixtures, ...claimsFixtures]) {
      const text = fs.readFileSync(fixPath(f), 'utf8');
      let toks;
      try { toks = tokenize(text, fixPath(f)).tokens; } catch { continue; }
      for (const t of toks) {
        if (t.start == null || t.end == null || t.end <= t.start) continue;
        const src = text.slice(t.start, t.end);
        if (!spellingSeen.has(src)) spellingSeen.set(src, new Set());
        spellingSeen.get(src).add(t.kind);
      }
    }
    // Drive each mint's probe: the curated row must still describe the lexer.
    const staleMints = MINTS.filter((m) => {
      try {
        const { tokens } = tokenize(m.probe, '<mint-probe>');
        return !tokens.some((t) => m.probe.slice(t.start, t.end) === m.spelling);
      } catch { return true; }
    });
    const spellings = [...rewritten, ...MINTS.map((m) => ({ spelling: m.spelling, becomes: m.what }))];
    const darkSpellings = spellings.filter((s) => !spellingSeen.has(s.spelling));
    const falseSpellingExclusions = [...EXCLUDED_SPELLINGS.keys()].filter((s) => spellingSeen.has(s));
    const staleSpellingExclusions = [...EXCLUDED_SPELLINGS.keys()]
      .filter((s) => !rewrittenAll.some((r) => r.spelling === s));
    // ── CONTAINMENT — the first of three sections measuring what production
    // counting CANNOT see, ordered outside-in by the layer each looks at:
    // nesting sits above a production, a rewritten spelling at the token, and
    // a type kind inside one token. Reading them in that order is a single
    // zoom from structure down into a token; any other order alternates.
    //
    // What the matrix can express at all. The cells
    // CLAIMS.md rules are joined against pairs of these, so a head no
    // fixture produces is the matrix advertising a capability it does not
    // have: any cell naming it is unsatisfiable, and the row would sit red
    // with no authoring that could clear it. Red rather than a queue,
    // because the fix is a decision either way — drop the head if the
    // parser never mints it, or spell it in a fixture if it does.
    const headsUnseen = [...CONSTRUCT_HEADS].filter((h) => !headsSeen.has(h)).sort();
    // The heading has to carry the WHY, because nothing else in the output
    // does: a reader meeting `the matrix's vocabulary` has never been told
    // there is a matrix, let alone that it exists because production counting
    // is context-free. One example is worth the explanation — seeing `if
    // inside render` tells a reader what a head is, what a pair is, and what
    // a claim may name, in four words.
    out(`\n    ${bold('Containment constructs')} ${dim('(production counts see no nesting — a pair of these names it, like `if inside render`)')}`);
    // The pair count does NOT belong here: it has no denominator and can only
    // rise, so on its own it is a number a reader cannot act on. Where it
    // means something is next to the cells it is the pool for, so it prints
    // with the Containment summary under Corpus claims.
    out(`    ${(headsUnseen.length ? red : green)(String(headsSeen.size))} ${dim('/')} ${dim(String(CONSTRUCT_HEADS.size))} ${dim('constructs spelled by a fixture')}`);
    for (const h of headsUnseen) out(`    ${red('✗')} ${red(`curated construct no fixture produces: ${h}`)} ${dim('— drop it if the parser never mints it, or spell it if it does')}`);
    // The vocabulary itself under -v, as every other census in this section
    // lists its own members. A reader asking which pairs a CLAIMS.md cell may
    // name has to know the heads to answer, and this was the one denominator
    // the report counted without ever showing.
    if (VERBOSE) wrapList([...CONSTRUCT_HEADS].sort(), dim);

    // Not "the denominator below the productions": `below` was a layering
    // metaphor (source, then lexer, then parser) competing with the plain
    // spatial reading, since this section is also printed below that one — and
    // it never said why a second denominator exists. It exists because these
    // spellings are the ones the production count cannot tell apart.
    out(`\n    ${bold('Lexer-spelling census')} ${dim("(what the lexer rewrites before the parser sees it — invisible to the production count)")}`);
    // Deliberately NOT a fraction. This queue is a gauge — the next line says
    // so — and a `5 / 9` printed between two closed-denominator scores reads
    // as the worst mark on the screen, which is a comparison the prose then
    // has to spend a sentence undoing. A count of what is tracked carries the
    // same information and invites no ranking against the obligations.
    // `after N exclusions` rather than a trailing `N excluded — netted from
    // the denominator`: the count leads the denominator it already belongs
    // to, the way the productions banner states its own, and the clause the
    // sentence used to spend on saying so is the clause it no longer needs.
    // The alias table needs no owner named — this is the LEXER-spelling
    // census, and it has only one.
    out(`    ${dim(`${spellings.length} spellings${EXCLUDED_SPELLINGS.size ? ` after ${EXCLUDED_SPELLINGS.size} exclusions${VERBOSE ? '' : ' (-v lists them)'}` : ''} · ${rewritten.length} read live from the alias table, ${MINTS.length} hand-listed, each probed`)}`);
    if (VERBOSE) for (const [label, why] of groupByReason(EXCLUDED_SPELLINGS)) labeled(6, label, 8, `excluded — ${why}`);
    if (darkSpellings.length) {
      out(`    ${yellow(`${darkSpellings.length} never written by the corpus — candidates, not obligations:`)}`);
      for (const s of darkSpellings) console.log(`      ${yellow(pad(s.spelling, 8))} ${dim(`→ ${s.becomes}`)}`);
    } else out(`    ${green('every rewritten spelling is written somewhere in the corpus')}`);
    if (VERBOSE) for (const s of spellings.filter((x) => spellingSeen.has(x.spelling))) {
      out(`      ${pad(s.spelling, 8)} ${dim(`→ ${s.becomes} · lexes as ${[...spellingSeen.get(s.spelling)].join(', ')}`)}`);
    }
    for (const m of staleMints) out(`    ${red('✗')} ${red(`hand-listed spelling the lexer no longer produces:`)} ${m.spelling} ${dim(`— \`${m.probe}\` does not produce it; the lexer changed, so fix or retire the row`)}`);
    for (const s of falseSpellingExclusions) out(`    ${red('✗')} ${red('excluded but written:')} ${s} ${dim('— the redundancy claim is false; count the spelling or stop writing it')}`);
    for (const s of staleSpellingExclusions) out(`    ${red('✗')} ${red('excluded spelling the lexer no longer rewrites:')} ${s} ${dim('— stale; fix the spelling exclusion table')}`);

    out(`\n    ${bold('Type vocabulary census')} ${dim(`(what lives inside a TYPE token — invisible to the production count, from the pinned tsgo)`)}`);
    out(`    ${(kindQueue.length ? dim : green)(String(claimedSet.size))} ${dim('/')} ${dim(`${censusDenom.length} kinds claimed by the corpus`)}${EXCLUDED_KINDS.size ? dim(` · ${EXCLUDED_KINDS.size} excluded by ruling — netted from the denominator; -v lists them`) : ''}`);
    const heldKinds = kindQueue.filter((k) => HELD_KINDS.has(k));
    const staleHeldKinds = [...HELD_KINDS.keys()].filter((k) => !universeSet.has(k));
    if (kindQueue.length) {
      const writable = kindQueue.length - heldKinds.length;
      out(`    ${yellow(`${kindQueue.length} unclaimed — ${heldKinds.length === kindQueue.length
        ? 'every one held by an open finding'
        : heldKinds.length ? `${writable} a fixture could claim today, ${heldKinds.length} held by an open finding` : 'the vocabulary queue'}:`)}`);
      for (const k of kindQueue) {
        const held = HELD_KINDS.get(k);
        if (held) labeled(6, k, 26, `· held by ${held}`, yellow);
      }
      const free = kindQueue.filter((k) => !HELD_KINDS.has(k));
      if (free.length) wrapList(free, yellow);
    } else out(`    ${green('every kind claimed or excluded')}`);
    for (const k of heldKinds.filter((k) => claimedSet.has(k))) out(`    ${red('✗')} ${red('held but claimed:')} ${k} ${dim('— the finding closed; drop the hold')}`);
    for (const k of staleHeldKinds) out(`    ${red('✗')} ${red('held kind not in the universe:')} ${k} ${dim('— stale; fix the census hold table')}`);
    if (VERBOSE) for (const [label, why] of groupByReason(EXCLUDED_KINDS)) labeled(6, label, 26, `excluded — ${why}`);
    for (const k of claimedOutside) out(`    ${red('✗')} ${red('claimed kind outside the census universe:')} ${k} ${dim('— extend the universe derivation in classifyTypeTexts')}`);
    for (const k of falseKindExclusions) out(`    ${red('✗')} ${red('excluded but claimed:')} ${k} ${dim("— the exclusion claim is false; fix the census exclusion table")}`);
    for (const k of staleKindExclusions) out(`    ${red('✗')} ${red('excluded kind not in the universe:')} ${k} ${dim("— stale; fix the census exclusion table")}`);

    // ── COMMENT CONVENTION — one rule enforced, one reported. A corpus
    // comment is never a reflowed paragraph: a section divider opens `── `
    // and closes ` ──` on its OWN line, however long. That half is exact —
    // no threshold and no judgment — and its only
    // remediation is joining the lines, never deleting a note. The header's
    // LENGTH is a gauge instead of an invariant on purpose: any cap would be
    // a number with no denominator behind it, and the only way to satisfy a
    // tripped cap is to delete prose — which would push authors to drop
    // exactly the workaround notes a reader cannot reconstruct from the code.
    // Reported every run, because a header reaching eighteen lines unnoticed
    // is what this measures.
    const commentFiles = [
      ...fs.readdirSync(FIX).map((f) => [FIX, f]),
      ...fs.readdirSync(CLM).map((f) => [CLM, f]),
      ...fs.readdirSync(ERRD).map((f) => [ERRD, f]),
    ].filter(([, f]) => /\.(rip|ts|tsx)$/.test(f));
    const splitDividers = [];
    // A rip line opening `#` is not necessarily a comment: `#{…}` is string
    // interpolation, and inside a heredoc or heregex a `#` line is content
    // whose bytes the runtime dimension compares. Two conditions keep this
    // exact without parsing rip. A comment is `#` alone or `# ` — hash-SPACE
    // — which excludes interpolation by construction. And a DIVIDER is only
    // recognized at column 0, where all 330 of the corpus's dividers sit and
    // where content nested inside a construct cannot reach.
    for (const [dir, f] of commentFiles) {
      const commentOf = f.endsWith('.rip')
        ? (t) => (t === '#' ? '' : t.startsWith('# ') ? t.slice(2) : null)
        : (t) => (t === '//' ? '' : t.startsWith('// ') ? t.slice(3) : null);
      const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
      lines.forEach((l, i) => {
        if (l !== l.trimStart()) return;            // indented: inside a construct, not a divider
        const body = commentOf(l);
        if (body === null) return;
        const t = body.trim();
        if (t.startsWith('── ') && !t.endsWith('──')) splitDividers.push([f, i + 1, t]);
      });
    }
    // NO SECTION when this holds. Every other block in this gate reports a
    // coverage denominator — what the corpus proves and what it does not —
    // and a divider rule is neither: it is a readability invariant over
    // prose, true every run so far, and two lines saying the comments are
    // tidy sat between two censuses answering a different question entirely.
    // It keeps its teeth: the contract still judges it, Totals names it among
    // the obligations that HELD (so a reader can tell "clean" from "never
    // measured"), and a violation prints here, loudly, where the corpus it
    // describes is being reported on.
    // The header gauge is ONE NUMBER, riding the divider line. Its whole job
    // is that a header drifting toward eighteen lines gets noticed, and the
    // number alone does that job — naming the files at the deepest depth
    // spends a line telling a reader which files have an ordinary header,
    // which is news about nothing. When the number does look wrong, the file
    // is one grep away, and no threshold has to be invented to decide when to
    // print it.
    out(`\n    ${bold('Negative coverage')} ${dim(`(the error lane against the positive corpus — vocabulary contractual, family fractions a gauge)`)}`);
    // The reduction COUNT is gone from this line, not reworded. Nothing acts
    // on it: it has no target (a negative proves one rejection and has no
    // reason to re-exercise the grammar), no obligation behind it, and no
    // follow-up when it moves — a fraction invented a gap that was not there,
    // and a bare count invited the reader to wonder what it should be. What
    // this section can actually say is whether every family has a negative at
    // all, which is a question with an answer someone can act on. The
    // per-family counts stay under -v, where a reader who wants the texture
    // asks for it.
    out(`    ${dim(`${negParsed} error fixtures`)}${dim(' · ')}${famZero.length
      ? yellow(`no negative at all for: ${famZero.join(', ')}`)
      : green('every construct family has at least one negative')}`);
    if (VERBOSE) for (const [g, n] of [...famPos.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      out(`      ${pad(g, 24)} ${dim(`${String(famNeg.get(g) ?? 0).padStart(3)} of ${String(n).padStart(3)} exercised productions appear in a negative`)}`);
    }
    out(`    ${dim(`type vocabulary: positives claim ${claimed.length} classes`)}${unfalsified.length ? `${dim(' · ')}${red(`${unfalsified.length} unfalsified (no negative instance) — every claimed class needs one`)}` : `${dim(' · ')}${green('every claimed class has a negative instance')}`}`);
    if (unfalsified.length) wrapList(unfalsified, red);
    if (VERBOSE) for (const [c, n] of claimed) console.log(`      ${pad(c, 24)} ${dim(`${String(n).padStart(4)} in positives · ${String(negVocab.get(c) ?? 0).padStart(3)} in the error lane`)}`);
    ng = {
      darkSpellings: darkSpellings.length, spellings: spellings.length, staleMints: staleMints.length,
      badSpellingExclusions: falseSpellingExclusions.length + staleSpellingExclusions.length,
      famZero: famZero.length, vocabClaimed: claimed.length, vocabUnfalsified: unfalsified.length,
      kindDenom: censusDenom.length, kindQueued: kindQueue.length, kindHeld: heldKinds.length,
      kindBad: claimedOutside.length + falseKindExclusions.length + staleKindExclusions.length,
      headsUnseen: headsUnseen.length, headsTotal: CONSTRUCT_HEADS.size, pairs: pairsSeen.size,
      splitDividers: splitDividers.length, splitDividerRows: splitDividers, dividerFiles: commentFiles.length,
    };
    // ── CORPUS CLAIMS (CLAIMS.md) — the decision record for coverage with
    // no syntactic denominator: checker behaviors (carrier presence-checked
    // here, semantics held by the ordinary dimensions) and containment
    // cells (joined against the matrix above). Type kinds are NOT here —
    // the census above owns them on a closed denominator. ABSENT is a
    // ruled, uncarried claim — red on purpose, the queue's memory, like a
    // parked production.
    const CLAIMS = path.join(HERE, 'CLAIMS.md');
    if (fs.existsSync(CLAIMS)) {
      // A ruled row can be uncarried for two DIFFERENT reasons, and ABSENT
      // alone cannot tell them apart: it is queued (nobody has authored the
      // fixture yet) or it is BLOCKED (a defect makes the shape unable to
      // enter a positive fixture at all — the strict dimension or the verdict
      // would reject it). The Parked table separates them, the same way
      // MANIFEST.md parks a production a fixture cannot yet reduce, so the
      // queue count means "work available" rather than "work available plus
      // work impossible". Self-policing: a park naming no row is stale, and a
      // park whose row is now CARRIED is stale too — the block cleared, so the
      // park is what needs deleting.
      const behaviors = [], cells = [], parks = [];
      let section = null;
      for (const line of fs.readFileSync(CLAIMS, 'utf8').split('\n')) {
        if (line.startsWith('## ')) { section = line.slice(3).trim(); continue; }
        if (!line.startsWith('|')) continue;
        const row = line.split('|').slice(1, -1).map((s) => s.trim());
        if (!row.length || row[0].startsWith('---') || ['behavior', 'construct'].includes(row[0])) continue;
        if (section === 'Behaviors') behaviors.push({ behavior: row[0], carrier: row[1], neg: row[2] });
        else if (section === 'Containment') cells.push({ construct: row[0], inside: row[1] });
        else if (section === 'Parked') parks.push({ behavior: row[0], until: row[1] });
      }
      const carrierOk = (c) => {
        if (!c || c === 'ABSENT' || c === '—') return c === '—' ? 'na' : 'absent';
        const [file, symbol] = c.split(':');
        // Carriers may live in any bucket — grammar fixtures can carry bonus
        // claims (the bucket encodes a fixture's PRIMARY charter), and a
        // claim's fire side lives in the error lane.
        const full = [FIX, CLM, ERRD].map((d) => path.join(d, file)).find((p) => fs.existsSync(p));
        if (!full) return 'missing';
        // A carrier must name a DECLARATION, not merely bytes. A text search
        // over the file is satisfied by the symbol in a comment or a string,
        // so a claim whose fixture was deleted still reads carried — the one
        // failure this registry exists to prevent. `declsOf` is the same
        // extractor the hover and token lanes probe from, so a carrier means
        // exactly what those lanes would visit. It also removes an
        // interpolation: the old pattern spliced the symbol in unescaped, so a
        // carrier carrying a regex metacharacter matched more than it named.
        return declsOf(fs.readFileSync(full, 'utf8')).some((d) => d.name === symbol) ? 'ok' : 'missing';
      };
      // Rows are split by WHAT A RUN CAN NEWLY SAY about them. A red (a
      // carrier that stopped existing, a cell nothing satisfies, a stale
      // park) and a PARKED row (work a defect is blocking) are news, and
      // print unconditionally. A carried ✓ and a ruled-uncarried · are not:
      // they restate CLAIMS.md, which is in the repo, and they cannot change
      // without someone editing that file — so by default they are counted,
      // and `-v` prints them, exactly as the uncovered production queue under
      // Coverage behaves. The reason is not brevity for its
      // own sake: 47 unchanging lines around 4 that matter is how a reader
      // learns to skip the section.
      const loud = [], quiet = [];
      const parkedBy = new Map(parks.map((p) => [p.behavior, p.until]));
      let absent = 0, broken = 0, parked = 0, carried = 0;
      const staleParks = [];
      // Parked rows sit apart from `loud`. A park is a STANDING state — it
      // cannot change until the finding blocking it closes — so printing its
      // full reason every run gave six rows eighteen lines, three-quarters of
      // this section, saying what they said yesterday. The count leads and -v
      // carries the prose, exactly as the production queue and the vocabulary
      // census now do. Reds keep printing unconditionally: those are news.
      const parkedRows = [];
      for (const b of behaviors) {
        const s1 = carrierOk(b.carrier), s2 = carrierOk(b.neg);
        const until = parkedBy.get(b.behavior);
        if (s1 === 'missing' || s2 === 'missing') { broken++; loud.push(`${red('✗')} ${b.behavior} ${dim('— the fixture this row points at is gone:')} ${red(s1 === 'missing' ? b.carrier : b.neg)}`); }
        else if (s1 === 'absent' || s2 === 'absent') {
          if (until) { parked++; parkedRows.push(`${yellow('·')} ${b.behavior} ${dim(`— PARKED until ${until}`)}`); }
          else { absent++; quiet.push(`${yellow('·')} ${b.behavior} ${dim('— ruled, uncarried')}`); }
        } else {
          carried++;
          if (until) staleParks.push(b.behavior);
          quiet.push(`${green('✓')} ${b.behavior} ${dim(`(${b.carrier})`)}`);
        }
      }
      const orphanParks = parks.filter((p) => !behaviors.some((b) => b.behavior === p.behavior)).map((p) => p.behavior);
      for (const p of staleParks) loud.push(`${red('✗')} ${p} ${dim('— parked, but CARRIED: the block cleared, so delete the park row')}`);
      for (const p of orphanParks) loud.push(`${red('✗')} ${p} ${dim('— a park naming no Behaviors row: stale, or the row text drifted')}`);
      let cellsMissing = 0;
      for (const c of cells) {
        const hit = pairsSeen.has(`${c.construct} inside ${c.inside}`);
        if (!hit) cellsMissing++;
        (hit ? quiet : loud).push(`${hit ? green('✓') : red('✗')} ${c.construct} inside ${c.inside}${hit ? '' : ' ' + dim('— no fixture carries this cell')}`);
      }
      // The claims bucket's retirement standard — the mirror of the grammar
      // bucket's unique-contribution line: a corpus/claims fixture justified
      // by NO CLAIMS row is removable (or mis-bucketed) and paints red.
      const carrierFiles = new Set(behaviors.flatMap((b) => [b.carrier, b.neg])
        .filter((c) => c && c !== 'ABSENT' && c !== '—').map((c) => c.split(':')[0]));
      let claimsOrphans = 0;
      for (const f of claimsFixtures) if (!carrierFiles.has(f)) {
        claimsOrphans++;
        loud.push(`${red('✗')} ${f} ${dim('— a claims fixture no CLAIMS row names: removable, or mis-bucketed under corpus/claims')}`);
      }
      out(`\n    ${bold('Corpus claims')} ${dim('(CLAIMS.md — behaviors and containment cells; the no-denominator coverage record)')}`);
      out(`    ${dim('behaviors: ')}${green(`${carried} carried`)}${absent ? `${dim(' · ')}${yellow(`${absent} ruled, uncarried`)}` : ''}${parked ? `${dim(' · ')}${yellow(`${parked} parked on open findings`)}` : ''}${VERBOSE ? '' : dim(' — -v lists every row')}`);
      // The pair count lands here, where it is not a bare rising number but
      // the pool the cells below are drawn from.
      out(`    ${dim('containment: ')}${(cellsMissing ? red : green)(`${cells.length - cellsMissing} of ${cells.length} cells carried`)}${dim(` · ${pairsSeen.size} pairs available to name`)}`);
      for (const r of (VERBOSE ? [...loud, ...parkedRows, ...quiet] : loud)) out(`      ${r}`);
      ng.claimsAbsent = absent; ng.claimsBroken = broken + claimsOrphans; ng.cellsMissing = cellsMissing;
      ng.claimsParked = parked; ng.claimsBadParks = staleParks.length + orphanParks.length;
    }
  }
  // LAST, and only when it fires. Every section above measures what the
  // corpus proves; this one measures whether its prose is tidy, which is the
  // least of what a reader came here for — so it never interrupts the
  // coverage narrative, and when it does appear it is at the bottom where an
  // interruption costs nothing. Totals names the rule among the obligations
  // either way, so silence here is never mistaken for unmeasured.
  if (ng?.splitDividerRows?.length) {
    out(`\n    ${bold('Comment convention')} ${dim('(a section divider opens and closes on one line — never a reflowed paragraph)')}`);
    for (const [f, ln, body] of ng.splitDividerRows) out(`    ${red('✗')} ${red(`${f}:${ln} divider wraps`)} ${dim(`— join the lines: ${body.slice(0, 60)}…`)}`);
  }
  gr = { total: denom.length, covered: denom.length - uncovered.length, uncovered: uncovered.length, uncoveredParked: uncovered.filter((i) => owner?.parked.has(names[i])).length, groups: groups.size, groupKind: owner ? 'files' : 'constructs', unallocated: groups.get('UNALLOCATED')?.length ?? 0, excluded: excludedIdx.length, badExclusions: falseExclusions.length + staleExcluded.length, unparsed: fixtureRows.filter((r) => !r.ok).length, negatives: ng };
}

// ── the Mapping Audit (--map): use-site identifier coverage, from the
// compiler's own rows. No server, no tsgo, no twin — so it runs here, before
// the probe pass spins up any of them.
let mp = null;
if (RUN_MAP) {
  auditBanner('MAPPING AUDIT', `use-site identifier coverage · compiler output only, no per-run reference · ${fixtures.length} files`);

  const perFile = [];
  const fileRows = [];
  const byRootRole = { synthetic: new Map(), rewrite: new Map() };
  let totReads = 0, totFlag = 0, unplaced = 0, mistext = 0, missing = 0, census = 0, byLuck = 0;
  const missingRows = [];   // flagged reads with no containing row — the pathological class
  const skips = [];

  for (const f of fixtures) {
    const full = fixPath(f);
    const src = fs.readFileSync(full, 'utf8');
    let scan;
    try {
      // The SAME compile the server's `faceOf` and the survival oracle use, so
      // the rows walked here are the exact rows the editor remaps through.
      const { code, mappings, vocabulary } = compile(src, { path: full, runtimeDelivery: 'inline', face: 'ts' });
      scan = mappingScan(src, code, mappings, vocabulary);
    } catch (e) {
      // A fixture that will not compile has no face to walk. Surfaced, never
      // silent: a shrinking denominator is exactly what the coverage line below
      // exists to make visible.
      skips.push(f);
      fileRows.push({ f, skip: (e && e.message) || String(e) });
      continue;
    }
    // Only `starts` is kept for the -v listing; `src` is not retained (nothing
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
    fileRows.push({ f, reads: scan.total, flagged });
  }
  // Counts RIGHT-align, as every other fixture table in the audit does — and
  // the widths come from the run's own numbers, so a busier corpus cannot
  // misalign them. Padding `N reads` as one string left-aligned the number
  // instead, sliding the unit left under a shorter count: `2 reads` and
  // `102 reads` shared a start and nothing else. Rows buffer for the same
  // reason the Grammar Audit's do — a column width is not knowable until every
  // row exists.
  const READ_W = Math.max(1, ...fileRows.filter((r) => !r.skip).map((r) => String(r.reads).length));
  const FLAG_W = Math.max(1, ...fileRows.filter((r) => !r.skip).map((r) => String(r.flagged).length));
  for (const r of fileRows) {
    if (r.skip) { out(`    ${yellow('skip')} ${pad(r.f, NAME_W + 2)} ${dim('does not compile — no face to walk: ' + r.skip)}`); continue; }
    console.log(`    ${r.flagged === 0 ? green('✓') : yellow('·')} ${pad(r.f, NAME_W + 2)} ${dim(String(r.reads).padStart(READ_W) + ' reads')}   `
      + (r.flagged === 0 ? green('all placed') : yellow(String(r.flagged).padStart(FLAG_W) + ' unmapped')));
  }

  console.log(`\n    ${green('✓')} ${dim(`${perFile.length} of ${fixtures.length} fixtures walked${skips.length ? `, ${skips.length} skipped (no face)` : ''} · ${totReads} reads`)}`);

  // ── the two invariants. Every failure is one or the other, never both: a
  // rewrite REFUSES (no resolved position to hold wrong text), mark-width
  // RESOLVES to the wrong bytes — so `unplaced` and `mistext` partition the
  // flagged set, and each is the root the other cannot catch.
  out(`\n  ${bold('Invariants')} ${dim(`(${totFlag} of ${totReads} reads unmapped — every position from the compiler's own rows)`)}`);
  // The note column is where a wrap has to hang — 4 indent, a 10-wide label,
  // a 4-wide count, and the gaps between them. `out` would hang it at 6,
  // under the label, which reads as a second row whose name went missing.
  const NOTE_COL = 4 + 10 + 1 + 4 + 3;
  const invLine = (label, n, note) => {
    const lines = wrapText(note, TERM_W - NOTE_COL, 0);
    console.log(`    ${pad(label, 10)} ${(n === 0 ? green : yellow)(String(n).padStart(4))}   ${dim(lines[0])}`);
    for (const l of lines.slice(1)) console.log(' '.repeat(NOTE_COL) + dim(l));
  };
  invLine('unplaced', unplaced, '`placed` fails — nothing resolves, so definition and rename find nothing there');
  invLine('mistext', mistext, '`text` fails — the span is wider than the name, so a hover names the wrong symbol');
  // EXPECTED ZERO, unlike the two above. Those count the known mapping gap;
  // this one closes the hole byte-equality leaves — a read landing on another
  // occurrence of its own name — so any count here is a defect nobody has
  // seen, not a queue. Green at zero and named either way, because a check
  // that prints only on failure cannot be told from one that never ran.
  const driftRows = perFile.flatMap((pf) => pf.drifted.map((d) => ({ f: pf.f, ...d })));
  out(`    ${pad('identity', 10)} ${(driftRows.length ? red : green)(String(driftRows.length).padStart(4))}   `
    + dim('resolved and byte-equal, but maps back outside the read — a wrong symbol both checks above accept'));
  for (const d of driftRows) out(`      ${red('✗')} ${d.f} ${dim(`${d.name} at ${d.offset} → generated ${d.gen} → back to ${JSON.stringify(d.back)}`)}`);

  // ── the CENSUS — the gate the ledger's identifier-read finding asks for:
  // reads with no exact row, the at-risk population, and the MITIGATION-PROOF
  // one. `unplaced`/`mistext` count the reads broken TODAY; the census is the
  // superset that also holds the ones resolving today only by a verbatim cover
  // prefix (byLuck), each one face rewrite from breaking. Only giving reads real
  // source spans drives it to zero — no downstream resolver tweak can — which is
  // why THIS number is the gate, not the symptom count. Same mapping rows, no
  // server, no oracle.
  out(`\n  ${bold('Census')} ${dim('(reads with no exact row)')}`);
  out(`    ${pad('census', 10)} ${(census === 0 ? green : yellow)(String(census).padStart(4))}   ${dim(`of ${totReads} — ${totFlag} broken today, ${byLuck} resolving by luck: one change to the emitted TS from breaking`)}`);
  // The decomposition is exact BY CONSTRUCTION — a flagged read always lacks an
  // exact row (see mappingScan) — so census === broken-today + by-luck. Checked,
  // not assumed: it rests on the compiler keeping synthetic rows zero-width on
  // the source side, and if that ever changed a flagged read could fall inside
  // an exact row and the split would silently misreport. Surface the drift.
  if (census !== totFlag + byLuck) {
    console.log(`    ${red('✗')} ${dim(`census decomposition off: ${census} ≠ ${totFlag} broken + ${byLuck} by-luck — a flagged read sits in an exact row (a compiler-invariant regression, not a corpus change)`)}`);
  }

  // The exclusions, PRINTED — a population this gate narrows silently is a
  // population nobody can audit. Each kind is declared with its reason above and
  // must actually occur; `mapping.exclusions` fails on one that no longer does.
  const excRows = perFile.flatMap((pf) => (pf.excluded ?? []).map((e) => ({ f: pf.f, ...e })));
  const byKind = new Map();
  for (const e of excRows) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  const undeclared = [...byKind.keys()].filter((k) => !MAP_EXCLUSIONS.has(k));
  const unused = [...MAP_EXCLUSIONS.keys()].filter((k) => !byKind.has(k));
  out(`    ${pad('excluded', 10)} ${dim(String(excRows.length).padStart(4))}   ${dim('reads the compiler consumed as its own vocabulary — netted from the population above')}`);
  for (const [kind, why] of MAP_EXCLUSIONS) {
    const n = byKind.get(kind) ?? 0;
    out(`      ${(n ? dim : red)(`${kind} ${n}`)}`);
    out(`        ${(n ? dim : red)(why)}`);
  }
  for (const k of undeclared) console.log(`    ${red('✗')} ${dim(`the compiler recorded exclusion kind '${k}', which this gate does not declare`)}`);
  for (const k of unused) console.log(`    ${red('✗')} ${dim(`exclusion '${k}' is declared but no longer occurs — delete it, or it will excuse the next read that lands there`)}`);
  if (VERBOSE) for (const e of excRows) out(`      ${dim(`${e.f} ${e.name} at ${e.offset} (${e.kind})`)}`);

  // ── the two roots, each with the roles it bit (the row every failure fell
  // to). The counts are live and the ordering is by weight, so the dominant
  // class names itself.
  // Role breakdown only when a root bit something — empty maps used to print
  // a lone "—" under each zero, which reads as noise once the census is clean.
  const roleBreak = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([role, n]) => `${role} ${n}`).join(', ');
  const rootTotal = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  // `out`, not console.log: this heading carries a gloss now and a heading
  // that overruns hard-breaks mid-word at the terminal's edge.
  out(`\n  ${bold('Why they miss')} ${dim('(the row each read landed in — ROLE is the part of the construct emitted, `$self` the construct itself)')}`);
  const rootLine = (label, n, note, roles) => {
    invLine(label, n, note);
    if (roles) for (const l of wrapText(roles, TERM_W - NOTE_COL, 2)) console.log(' '.repeat(NOTE_COL) + dim(l));
  };
  rootLine('synthetic', rootTotal(byRootRole.synthetic), 'the generated text carries characters the source span does not', roleBreak(byRootRole.synthetic));
  rootLine('rewrite', rootTotal(byRootRole.rewrite), 'a string literal re-rendered double-quoted', roleBreak(byRootRole.rewrite));

  // ── the one structural invariant that IS load-bearing: no flagged read may
  // lack a containing row. Every failure above is a span that EXISTS and is
  // wrong; a read with no span would be a genuinely missing mapping — a class
  // the prototype never saw. This is a gauge, not a gate, so a nonzero count
  // does not abort — but it prints red and names every offender, because it
  // would be a NEW finding, not a known one.
  if (missing === 0) {
    out(`\n  ${green('✓')} ${dim(`every flagged read has a containing row — no genuinely missing span`)}`);
  } else {
    console.log(`\n  ${red('✗')} ${bold(`${missing} flagged read(s) with NO containing row`)} ${dim('— a missing span, a new class not seen before:')}`);
    for (const r of missingRows.slice(0, 10)) console.log(`      ${red('·')} ${bold(r.name)} ${dim(`@ ${r.f} offset ${r.offset}`)}`);
    if (missingRows.length > 10) console.log(`      ${dim(`… ${missingRows.length - 10} more`)}`);
  }

  // ── -v: every flagged read, per fixture, made self-describing so it can be
  // verified by hand. Each row names the invariant it broke (`unplaced` = the
  // precise map refused; `mistext` = it resolved to the wrong bytes), the root,
  // the mapping row's role, and — for a mistext — the face bytes it landed on,
  // which is exactly what a hover at that position would answer about. Cross-
  // check any row against the real editor by hovering `line:col` in the fixture.
  //
  // These rows do NOT wrap, and are the largest deliberate exception in the
  // file: six aligned columns over 500-odd rows, where the alignment IS how a
  // reader scans for the one row they want. Wrapping the tail would stagger
  // every column after it. A narrow terminal loses the last column here; the
  // alternative loses the listing.
  if (VERBOSE && totFlag) {
    out(`\n  ${bold('Flagged reads')} ${dim('(every one, so each can be checked against the editor at its line:col)')}`);
    // Widths from the rows themselves — a name one character over a
    // hand-picked 16 shunts every column right of it on that line alone.
    const allRows = perFile.flatMap((pf) => pf.rows);
    const NAME_C = Math.max(4, ...allRows.map((r) => r.name.length));
    const ROLE_C = Math.max(4, ...allRows.map((r) => (r.role ?? '—').length));
    for (const pf of perFile) {
      if (!pf.rows.length) continue;
      console.log(`\n    ${bold(pf.f)} ${dim(`(${pf.rows.length})`)}`);
      for (const r of pf.rows) {
        const { line, character } = offsetToPosition(pf.starts, r.offset);
        const where = dim(`${String(line + 1).padStart(3)}:${String(character).padEnd(3)}`);
        const inv = r.placed ? yellow('mistext ') : yellow('unplaced');
        // A trailing note ONLY where it carries something the columns do not.
        // `unplaced` rows all ended in `the precise map refuses`, which is what
        // `unplaced` means — 496 rows restating their own second column, in a
        // listing whose whole value is the per-row detail. A `mistext` row's
        // note is the wrong bytes a hover would actually read, which is the
        // one thing no column can hold.
        const detail = r.placed ? ' ' + dim(`maps onto \`${r.hit}\``) : '';
        // The role column pads only when something follows it: a padded LAST
        // column is trailing whitespace on every line of a 660-line listing.
        const role = r.role ?? '—';
        console.log(`      ${where} ${bold(pad(r.name, NAME_C))} ${inv} ${dim(pad(r.root, 10))} ${dim(detail ? pad(role, ROLE_C) : role)}${detail}`);
      }
    }
  }

  // Exactly what the combined-totals line reads — no dead fields carried on the
  // signal object (perFile, byLuck, skips, walked were all retained for nothing).
  mp = { totReads, totFlag, unplaced, mistext, missing, census, drifted: driftRows.length, badExclusions: undeclared.length + unused.length,
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

// ── the Type Audit (dims 1–6) — runs unless another lane is named
let totalPass = 0, totalApplicable = 0, fails = 0;
if (RUN_MAIN) {
  const glyph = { pass: ['✓', green('✓')], fail: ['✗', red('✗')], skip: ['skip', yellow('skip')], '—': ['·', dim('·')], 'n/a': ['·', dim('·')] };
  const cell = (s, n) => { const [v, col] = glyph[s] ?? [String(s), dim(String(s))]; return col + ' '.repeat(Math.max(0, n - v.length)); };
  const dims = DIMS;

  pool = await poolP;
  // Print the header immediately, then stream each fixture's row as it
  // is computed, so the report fills in live.
  auditBanner('TYPE AUDIT', `${fixtures.length} fixtures × ${dims.length} dimensions`);
  // `trimEnd` on both the header and every row: the last dimension pads to its
  // column width like the others, which is trailing whitespace on 24 lines —
  // invisible in a terminal, loud in a diff, and stripped by half the editors
  // that would ever open a captured run.
  console.log(('  ' + dim(pad('fixture', NAME_W + 2) + ' ' + dims.map(([d, w]) => pad(d, w)).join(' '))).trimEnd());
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
    const ripPath = fixPath(f);
    const twinBase = ['.tsx', '.ts'].map((e) => f.replace(/\.rip$/, e)).find((b) => fs.existsSync(path.join(fixDirOf(f), b)));
    const src = fs.readFileSync(ripPath, 'utf8');

    const c = await dimCompiles(ripPath);
    const row = { name: f, compiles: c.ok ? 'pass' : 'fail', compileDetail: c.detail };

    if (c.ok) {
      // Count ERROR-severity only. Unused-local and deprecation arrive
      // as Hint severity (fade/strikethrough, not a type error) and are
      // expected on the fixtures' intentionally-unused bindings.
      //
      // The verdict and the runtime dimension do not touch each other — one
      // asks the server, the other spawns two processes — so overlap them.
      const [ds, rt] = await Promise.all([
        pool[lane].verdict(f, src).then((all) => all.filter((d) => (d.severity ?? 1) <= 2)),
        dimRuntime(ripPath, twinBase ? path.join(fixDirOf(f), twinBase) : null),
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
      row.verdict = row.runtime = row.strict = '—';
    }

    const tw = twinBase ? dimTwin(twinBase, await twinP) : { status: 'n/a', detail: 'no twin' };
    row.twin = tw.status;
    row.twinDetail = tw.detail;
    row.twinErrs = tw.errs;
    return row;
  }, { width: LANES, onDone: (row) => console.log(`  ${pad(row.name, NAME_W + 2)} ${dims.map(([d, w]) => cell(row[d], w)).join(' ')}`.trimEnd()) });

  // COVERAGE, for the same reason the probe pass has one: the Score below is a
  // ratio of the rows this loop produced. A fixture that fell out of the lanes
  // would make it read "11 / 11 — all passing" over a corpus one short.
  const missed = fixtures.filter((f, i) => !rows[i] || rows[i].name !== f);
  if (missed.length) await abort('The Type Audit did not score every fixture', missed.map((f) => `${f}: no row produced`));

  // The heading waits for its first row. `Failures / none` announced a section
  // with nothing in it, in a lane that already says all-passing three more
  // times — the per-dimension Score, the grid above, and Totals. Silence here
  // is never ambiguous because Score reports each dimension's ratio whether or
  // not anything failed.
  let any = false;
  const failHeading = () => { if (!any) console.log(`\n  ${bold('Failures')} ${dim('(categorized)')}`); };
  for (const r of rows) {
    const notes = [];
    if (r.compiles === 'fail') notes.push([yellow('compiler-coverage gap'), r.compileDetail]);
    if (r.verdict === 'fail') notes.push([red('type-face divergence'), r.verdictDetail]);
    if (r.runtime === 'fail') notes.push([red('behavioral divergence'), r.runtimeDetail]);
    if (r.twin === 'fail') notes.push([red('reference twin invalid'), r.twinDetail]);
    // Neutral category — the DETAIL names the class. The label must not claim
    // "implicit-any" when dimStrict just finished reporting that none of the
    // errors are; that contradiction is the misattribution in miniature.
    if (r.strict === 'fail') notes.push([yellow('fails under rip.strict'), r.strictDetail]);
    if (notes.length) {
      failHeading();
      any = true;
      console.log(`    ${bold(r.name)}`);
      for (const [label, detail] of notes) console.log(`      ${dim('·')} ${label} ${dim('— ' + detail)}`);
      // A failure always shows its evidence — no flag needed to learn WHY.
      if (r.diags?.length) for (const d of r.diags) out(dim(`        ${d.range.start.line}:${d.range.start.character} [TS${d.code}] ${d.message}`));
      if (r.twinErrs?.length) for (const e of r.twinErrs) console.log(dim(`        twin: ${e}`));
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
          out(dim(`        strict: ${at} [TS${es[0].code}] ${es[0].message}`) + more);
        }
        const rest = sites.size - Math.min(sites.size, 4);
        if (rest > 0) console.log(dim(`        strict: … and ${rest} more site${rest === 1 ? '' : 's'} (see \`rip check\` under rip.strict)`));
      }
    }
  }


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

// ── the Diagnostics Audit (--diagnostics; ROADMAP "M3"): fixtures whose
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
  auditBanner('DIAGNOSTICS AUDIT', `unsuppressed fixtures, code + position asserted · ${errorFixtures.length} files`);
  if (errorFixtures.length === 0) await abort('The Diagnostics Audit found no fixtures', [`${path.relative(ROOT, ERRD)} holds no .rip files`]);

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

  const errorPins = fs.existsSync(ERROR_PINS) ? JSON.parse(fs.readFileSync(ERROR_PINS, 'utf8')) : {};
  // A pin file entry naming no fixture is a key that rotted — the fixture
  // renamed or retired under it — and its pinned negatives are asserted
  // nowhere from that moment. Loud, like the orphaned-twin check below.
  for (const k of Object.keys(errorPins)) {
    if (!errorFixtures.includes(k)) console.log(`    ${red('✗')} ${pad(k, ERR_NAME_W)} ${red('error-pins.json entry with no fixture — its pinned negatives are asserted nowhere')}`);
  }

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
      // What can be extracted is a DERIVATION LIMIT, not corpus policy:
      // TypeScript anchors errors on literals as readily as on names — a
      // wrong tuple element is flagged on the element — so the extraction
      // covers identifiers and literal spellings both. It still cannot
      // anchor on an operator, paren, or bracket; a family whose negatives
      // legitimately flag such a span is the cue to widen this further,
      // never to reshape fixtures until the error lands on something the
      // harness can read, which would drift the corpus toward shapes it can
      // measure instead of shapes the type story needs tested.
      //
      // A literal transfers by the same occurrence rank as a name because the
      // twin is line-aligned and copies literals verbatim; where it cannot
      // (rip's `#{}` interpolation against a template), the rank lookup below
      // reports the absence rather than silently missing it.
      const token = twinLine.slice(d.col - 1).match(/^(?:[A-Za-z_$][\w$]*|'[^']*'|"[^"]*"|-?\d[\w.]*)/)?.[0];
      if (!token) { problems.push({ kind: 'shape', note: `twin ${d.line}:${d.col} TS${d.code}: no identifier or literal at the flagged position — a derivation limit; widen the extraction here rather than reshaping the fixture` }); continue; }
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
    // Pinned expectations join AFTER derivation, additively (see ERROR_PINS).
    // A pin lands only where the twin cannot judge; one that duplicates a
    // derived row exactly (line+code+character — a lowering's SECOND publish
    // legitimately shares its line and code with the derived first) is a
    // redundant pin, flagged loudly: a pin shadowing live derivation is
    // exactly the rot the twin exists to prevent. A near-miss pin cannot
    // sneak through either — it and the derived row would then contest one
    // published diagnostic, and the loser reports `missing`. Pin lines are
    // 1-based (how the fixture reads), columns 0-based (LSP, like every
    // expectation here).
    for (const p of errorPins[f] ?? []) {
      if (expected.some((e) => e.line === p.line - 1 && e.code === p.code && e.character === p.character)) {
        problems.push({ kind: 'shape', note: `pin TS${p.code} at ${p.line}:${p.character}: the twin already derives this exact expectation — pins are for what derivation cannot spell` });
        continue;
      }
      expected.push({ line: p.line - 1, character: p.character, code: p.code, token: p.token ?? '(pinned)' });
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
  }, { width: LANES });
  // Printed after the pass, not streamed from it: the lane is a five-second
  // run, so streaming buys nothing, and a count column cannot right-align
  // until every row exists — `8` sat under the first digit of `10`, which is
  // a column in name only. A row's own violation count rides its line too: a
  // ✗ whose text says `35 asserted` and nothing else reads like a success
  // whose mark is a typo.
  {
    const W = Math.max(1, ...laneRows.map((r) => String(r.expected.length).length));
    for (const r of laneRows) {
      const ok = r.problems.length === 0;
      console.log(`    ${ok ? green('✓') : red('✗')} ${pad(path.join('errors', r.name), ERR_NAME_W)} ${dim(String(r.expected.length).padStart(W) + ` diagnostic${r.expected.length === 1 ? '' : 's'} asserted`)}`
        + (ok ? '' : dim(' · ') + red(`${r.problems.length} violation${r.problems.length === 1 ? '' : 's'}`)));
      for (const p of r.problems) out(`      ${red('·')} ${yellow(p.kind)} ${dim(p.note)}`);
    }
  }
  const missedErr = errorFixtures.filter((f, i) => !laneRows[i] || laneRows[i].name !== f);
  if (missedErr.length) await abort('The Diagnostics Audit did not score every fixture', missedErr.map((f) => `${f}: no row produced`));
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
// The pin file, loaded once for the probe pass, the coverage gate, and the
// comparison alike (see HOVERS above for the shape and discipline).
const hoverPins = fs.existsSync(HOVERS) ? JSON.parse(fs.readFileSync(HOVERS, 'utf8')) : {};
const declPinsOf = (f) => hoverPins[f]?.decls ?? [];
const positionPinsOf = (f) => hoverPins[f]?.positions ?? [];
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
    if (!twins.length) console.log(`    ${dim('tsgo unavailable — the twin comparison is skipped; hover-pins still run')}`);
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
      const full = fixPath(f);
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
    if (!facesAvailable) console.log(`    ${dim('tsgo unavailable — the use-site token gauge is skipped')}`);
  }

  const t0 = Date.now();

  const probeOne = async (f, _i, lane = 0) => {
    const full = fixPath(f);
    const src = fs.readFileSync(full, 'utf8');
    if (!await compiles(full)) { hskip++; return { file: f, probe: null, line: `    ${yellow('skip')} ${pad(f, NAME_W + 2)} ${dim('does not compile — no face to probe')}` }; }

    // This lane's own server and own oracle — never a neighbour's.
    const srv = pool[lane];
    const twin = twins[lane] ?? null;

    const started = Date.now();
    const twinBase = twin ? ['.tsx', '.ts'].map((e) => f.replace(/\.rip$/, e)).find((b) => fs.existsSync(path.join(fixDirOf(f), b))) : null;
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
        // Ruled-silent positions — the bare `~>` operator at column 0
        // (RULINGS.md, Reactive: punctuation is silent, permanently).
        // Probed after the same readiness wait as the declarations, so a
        // null here is the position's real answer, not an unbuilt
        // program's. Today the server leaks the runtime's `__effect`
        // symbol at these positions — the open bare-effect finding — so
        // the `silence` gauge below is red by agreement until the server
        // declines to answer.
        const silent = RUN_HOVER
          ? await Promise.all(src.split('\n')
              .map((text, line) => (/^~>/.test(text) ? line : -1)).filter((l) => l >= 0)
              .map(async (line) => ({ line, hover: await srv.hover(uri, { line, character: 0 }) })))
          : [];
        // RULINGS-governed in-body positions (hover-pins.json `positions`) —
        // probed on the same settled document, after the same readiness wait,
        // so a null is the position's real answer, not an unbuilt program's.
        const ruled = RUN_HOVER
          ? await Promise.all(positionPinsOf(f).map(async (rp) =>
              ({ ...rp, hover: await srv.hover(uri, { line: rp.line - 1, character: rp.character }) })))
          : [];
        const tokens = RUN_TOKENS ? await srv.tokens(uri) : null;
        return { decls, hovers, tokens, silent, ruled };
      }),
      twinBase ? twin.hoverTwin(path.join(fixDirOf(f), twinBase)).catch(() => null) : Promise.resolve(null),
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

    return {
      file: f,
      decls: decls.length,
      tokens: RUN_TOKENS ? probe.tokens.length : null,
      probe: { ...probe, tmap, members, survival },
    };
  };

  // Fixtures probe a few at a time; each one's cost is waiting on its server, not
  // CPU. Equivalence with a serial run rests on the per-lane servers (each lane
  // probes into its own program, never a shared one), NOT on the oracles noticing
  // cross-talk afterwards. Results land in fixture order.
  // Rows STREAM as each fixture returns: this pass takes about fourteen
  // seconds and prints nothing else, so buffering it to align a column traded
  // the only progress the run shows for two spaces of tidiness. The width is
  // still derived rather than picked — a fixture cannot declare more names
  // than it has lines, so the longest fixture's line count is an upper bound
  // available before the first probe returns. It over-pads by at most a
  // column, and `padStart` never truncates, so a surprise is a wide row and
  // not a lost digit.
  const CW = String(Math.max(1, ...fixtures.map((f) => fs.readFileSync(fixPath(f), 'utf8').split('\n').length))).length;
  const probeRow = (r) => console.log(`    ${green('✓')} ${pad(r.file, NAME_W + 2)} `
    + dim(String(r.decls).padStart(CW) + ` decl${r.decls === 1 ? '' : 's'}`)
    + (r.tokens === null ? '' : dim('   ' + String(r.tokens).padStart(CW) + ` token${r.tokens === 1 ? '' : 's'}`)));
  const probed = await lanes(fixtures, probeOne, { width: LANES, onDone: (r) => r && probeRow(r) });
  for (const r of probed) if (r?.probe) PROBES.set(r.file, r.probe);

  console.log(`\n    ${dim(`probed ${PROBES.size} file${PROBES.size === 1 ? '' : 's'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`)}`);
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
  for (const f of fixtures) if (await compiles(fixPath(f))) want.push(f);
  const gaps = [];
  for (const f of want) {
    const p = PROBES.get(f);
    if (!p) { gaps.push(`${f}: compiles, but was never probed`); continue; }
    const src = fs.readFileSync(fixPath(f), 'utf8');
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
      // Position pins are positional, so they rot when the fixture shifts:
      // every pin's token must still sit at its (line, character), and every
      // pin must have been probed — a rotted or dropped pin is a coverage
      // failure, never a silent shrink of the ruled denominator.
      const pins = positionPinsOf(f);
      if ((p.ruled?.length ?? 0) !== pins.length) gaps.push(`${f}: probed ${p.ruled?.length ?? 0} ruled positions, hover-pins.json lists ${pins.length}`);
      const srcLines = src.split('\n');
      for (const rp of pins) {
        if ((srcLines[rp.line - 1] ?? '').slice(rp.character, rp.character + rp.token.length) !== rp.token) {
          gaps.push(`${f}: ruled pin \`${rp.token}\` not at ${rp.line}:${rp.character} — the fixture moved under the pin (re-measure and re-pin)`);
        }
      }
      // Decl pins are name-keyed, so their one rot mode is the declaration
      // leaving the fixture (or an occurrence miscount): a pin naming no
      // declaration would otherwise be asserted nowhere, silently.
      const occCount = new Map();
      for (const d of decls) occCount.set(d.name, (occCount.get(d.name) ?? 0) + 1);
      for (const dp of declPinsOf(f)) {
        if ((occCount.get(dp.name) ?? 0) <= (dp.occurrence ?? 0)) {
          gaps.push(`${f}: decl pin \`${dp.name}\`${dp.occurrence ? `#${dp.occurrence}` : ''} names no declaration — the pin rotted (declaration removed or renamed)`);
        }
      }
    }
    if (RUN_TOKENS && (!p.tokens || !p.tokens.length)) gaps.push(`${f}: no semantic tokens returned`);
  }
  if (gaps.length) await abort('The probe pass did not cover the corpus', gaps);
  out(`    ${green('✓')} ${dim(`${want.length} compiling fixtures, ${want.reduce((n, f) => n + PROBES.get(f).decls.length, 0)} declarations — all probed, all answered`)}`);
}

// ── the Hover Audit: twin oracle (correctness) + expected hovers (baseline)
let hp = null;
if (RUN_HOVER) {
  auditBanner('HOVER AUDIT', `the twin's answers + pinned answers · ${fixtures.length} files`);

  const allRows = [];
  let anyCount = 0, probeCount = 0;

  for (const [f, { decls, hovers, tmap }] of PROBES) {
    const occ = new Map();
    decls.forEach((d, i) => {
      const k = occ.get(d.name) ?? 0; occ.set(d.name, k + 1);
      allRows.push({ ...d, occurrence: k, hover: hovers[i], ts: tmap ? (tmap.get(`${d.name}#${k}`) ?? null) : null, file: f });
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
  // The reactive clause is LEGACY-SCOPED: 08's React twin approximates
  // reactivity with useState, so its reactive rows have no oracle — but the
  // M3 reactive twin is plain TS written to BE the oracle (ROADMAP.md,
  // Oracles; RULINGS.md, Reactive: the twin agrees live, so no pin), and
  // classifying its rows native would silently retire that oracle the run
  // it landed. Component/schema clauses stay corpus-wide: those analogies
  // (TSX/zod) remain approximations in every fixture that carries them.
  // Reactive spellings (`:=`/`~=`/`~>`) are NOT rip-native here: the
  // reactive twin is a deliberate plain-TS oracle (state → let, computed →
  // const — ROADMAP.md, Oracles), so those declarations are twin-judged.
  const ripNative = (r) => {
    const t = r.text ?? '';
    return /=\s*component\b/.test(t)
      || /=\s*schema\b/.test(t)
      || /\b(?!JSON\b|Date\b)[A-Z]\w*\.parse(?:Async)?\s*\(/.test(t);
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

  // ── decl-pin comparison — the `decls` sections cover ONLY what the
  // twin can't validate live (rip-native + no-twin). Twin-checked symbols
  // are judged by the twin oracle every run; pinning their raw text would
  // flag harmless changes (union order) the twin normalizes away. Pins are
  // matched by name (+ occurrence), never by line, so a fixture edit that
  // only moves lines touches nothing here. Three failure classes, none
  // silent: a pin whose measured hover DIVERGED (drift to review), a
  // non-twin-covered symbol with NO pin (a new declaration must be pinned
  // by hand — the paste-ready row prints below), and a pin on a symbol the
  // twin now covers (shadowing live judgment — remove it). Rot (a pin
  // naming no declaration) already failed the coverage gate above.
  const twinCovered = (r) => r.ts != null && !ripNative(r);
  const pasteRow = (r) => `{ "name": ${JSON.stringify(r.name)}, ${r.occurrence ? `"occurrence": ${r.occurrence}, ` : ''}"expect": ${JSON.stringify(r.hover)} }`;
  let pinnedCount = 0;
  const snapChanged = [];
  for (const [f, p] of PROBES) {
    const pinByKey = new Map(declPinsOf(f).map((dp) => [`${dp.name}#${dp.occurrence ?? 0}`, dp]));
    for (const r of allRows) {
      if (r.file !== f) continue;
      const dp = pinByKey.get(`${r.name}#${r.occurrence}`);
      pinByKey.delete(`${r.name}#${r.occurrence}`);
      if (twinCovered(r)) {
        if (dp) snapChanged.push(`${f} ${r.name}: pinned, but the twin now covers it live — remove the pin (it shadows the oracle)`);
        continue;
      }
      if (!dp) snapChanged.push(`${f} ${r.name}@${r.line + 1}: unpinned — add to decls: ${pasteRow(r)}`);
      else if ((dp.expect ?? null) !== (r.hover ?? null)) {
        pinnedCount++;
        snapChanged.push(`${f} ${r.name}: ${JSON.stringify(dp.expect ?? null)} → ${JSON.stringify(r.hover ?? null)} — if correct, re-pin: ${pasteRow(r)}`);
      } else pinnedCount++;
    }
    // Leftovers matched no probed declaration for OTHER reasons than rot
    // (e.g. the fixture stopped compiling and was skipped) — the coverage
    // gate owns the rot case; anything surviving to here is still loud.
    for (const dp of pinByKey.values()) snapChanged.push(`${f} ${dp.name}: pin matched no probed declaration`);
  }

  const probed = allRows.length;
  out(`\n  ${bold('Parity')} ${dim(`(${probed} probes${hskip ? `, ${hskip} file${hskip === 1 ? '' : 's'} skipped` : ''} — the first four partition them; the rest are separate checks)`)}`);
  // Rows buffer so every value shares ONE right-aligned field: a fraction is
  // wider than a count, and printing each as it came left the notes in two
  // columns. `silence` and `ruled` count what HOLDS out of a population where
  // every row above counts probes — identical shapes for opposite senses is
  // how `0` came to mean "none of the three is behaving" in a column whose
  // every other zero means "nothing wrong", so those two carry a denominator.
  const prows = [];
  const prow = (label, n, color, note) => prows.push({ label, text: String(n), color, note });
  const pgap = () => prows.push(null);
  const pfrac = (label, ok, of, note) => prows.push({ label, text: `${ok} / ${of}`, color: ok === of ? green : red, note });
  prow('agree', tally.agree, green, tally.order ? `${tally.order} of them after normalizing union-member order` : 'every twin-checked hover matches TypeScript');
  prow('gaps', tally.gap, tally.gap ? yellow : green, tally.gap ? 'hover ≠ tsgo twin on a comparable type' : 'no hover disagrees with the tsgo twin on a comparable type');
  prow('rip-native', tally.native, dim, 'component / schema / reactive — the twin uses React/zod, so it has no answer to compare');
  prow('pinned-only', tally.pinnedOnly, dim, 'no twin symbol — covered by hover-pins');
  pgap();
  prow('pins', snapChanged.length, snapChanged.length ? red : green,
    snapChanged.length ? 'diverging vs hover-pins.json decls' : `${pinnedCount} pinned, unchanged`);
  prow('invariant', violations.length, violations.length ? red : green, violations.length ? 'an initialized binding hovers `any`' : 'no initialized binding hovers `any`');
  // The `silence` gauge — ruled-silent positions (bare `~>` operators) must
  // serve null. EXPECTED RED while the bare-effect finding is open: the
  // server leaks the runtime's `__effect` symbol there today, and this
  // gauge is that row's gate — soft, like the token audit's enum rows.
  const silentRows = [...PROBES].flatMap(([file, p]) => (p.silent ?? []).map((s) => ({ file, ...s })));
  const silentLeaks = silentRows.filter((s) => s.hover !== null);
  if (silentRows.length) {
    pfrac('silence', silentRows.length - silentLeaks.length, silentRows.length,
      `ruled-silent bare ~> positions serve null${silentLeaks.length ? ' — red by agreement: the open bare-effect finding (FINDINGS.md)' : ''}`);
  }
  // The `ruled` gauge — RULINGS-governed in-body positions (hover-pins.json `positions`:
  // render-DSL words, member declarations, gate spellings) must serve their
  // pinned answer: null where the ruling's interim is silence, text where a
  // truthful interim is pinned. EXPECTED RED while the render-DSL and
  // member-wrapper findings are open — the server serves scaffold symbols and
  // container wrappers at positions ruled otherwise. Soft, like `silence`.
  const ruledRows = [...PROBES].flatMap(([file, p]) => (p.ruled ?? []).map((r) => ({ file, ...r })));
  const ruledDiverging = ruledRows.filter((r) => (r.expect ?? null) !== (r.hover ?? null));
  if (ruledRows.length) {
    pfrac('ruled', ruledRows.length - ruledDiverging.length, ruledRows.length,
      `RULINGS-governed in-body positions serve their pin${ruledDiverging.length ? ' — red by agreement: the render-DSL and member-wrapper findings (FINDINGS.md)' : ''}`);
  }

  {
    const VW = Math.max(...prows.filter(Boolean).map((r) => r.text.length));
    for (const r of prows) {
      if (!r) { console.log(''); continue; }
      out(`    ${pad(r.label, 12)} ${r.color(r.text.padStart(VW))}${r.note ? '   ' + dim(r.note) : ''}`);
    }
  }

  if (gaps.length) {
    console.log(`\n    ${bold('Gaps — hover ≠ tsgo twin on a comparable type')} ${dim('(after quote / keyword / union-order normalization)')}`);
    for (const r of gaps) {
      out(`      ${yellow('✗')} ${bold(r.name)} ${dim(`@ ${r.file}:${r.line + 1}`)}  ${dim(`(${r.text})`)}`);
      out(`        ${dim('tsgo')} ${green(r.ts)}`);
      out(`        ${dim('rip ')} ${yellow(r.hover)}`);
    }
  }
  if (snapChanged.length) {
    console.log(`\n    ${bold('Expected-hover divergences')} ${dim('(hand-edit hover-pins.json decls — verify correctness first; paste-ready rows above)')}`);
    for (const c of snapChanged.slice(0, VERBOSE ? Infinity : 10)) console.log(`      ${red('✗')} ${dim(c)}`);
    if (snapChanged.length > 10 && !VERBOSE) console.log(`      ${dim(`… ${snapChanged.length - 10} more (-v for all)`)}`);
  }
  if (violations.length) {
    console.log(`\n    ${bold('Invariant violations')}`);
    for (const v of violations) console.log(`      ${red('✗')} ${dim(v)}`);
  }
  if (silentLeaks.length) {
    out(`\n    ${bold('Ruled-silent positions serving an answer')} ${dim('(bare ~> — RULINGS.md, Reactive; red by agreement while the bare-effect finding is open)')}`);
    for (const s of silentLeaks) out(`      ${red('✗')} ${s.file}:${s.line + 1}  ${dim(`→ ${s.hover}`)}`);
  }
  if (ruledDiverging.length) {
    // 63 lines — the largest block left in the report, and every row of it is
    // red BY AGREEMENT: it cannot move until the render-DSL and member-wrapper
    // findings close, so each run reprints yesterday's state at three lines a
    // row. The `ruled` fraction above carries the count; what survives here is
    // WHICH RULES are diverging, since that is the part that would change if
    // one of them were fixed alone.
    out(`\n    ${bold('Ruled positions diverging from their pins')} ${dim('(RULINGS.md, Components / render; red by agreement while the render-DSL and member-wrapper findings are open)')}`);
    if (VERBOSE) {
      for (const r of ruledDiverging) {
        console.log(`      ${red('✗')} ${r.file}:${r.line}:${r.character} ${bold(r.token)} ${dim(`[${r.rule}]`)}`);
        out(`        ${dim('pin')} ${green(JSON.stringify(r.expect ?? null))}`);
        out(`        ${dim('now')} ${yellow(JSON.stringify(r.hover ?? null))}`);
      }
    } else {
      const byRule = new Map();
      for (const r of ruledDiverging) byRule.set(r.rule, (byRule.get(r.rule) ?? 0) + 1);
      const ranked = [...byRule].sort((a, b) => b[1] - a[1]).map(([rule, n]) => (n > 1 ? `${rule} ×${n}` : rule));
      out(`      ${dim(`${ruledDiverging.length} across ${byRule.size} ruled position${byRule.size === 1 ? '' : 's'}: ${ranked.join(', ')}; -v shows each pin and answer`)}`);
    }
  }
  if (VERBOSE) for (const [label, rowset] of [['rip-native (expected divergences — twin uses React/zod)', natives], ['pinned-only (no twin symbol)', pinnedOnly]]) {
    if (!rowset.length) continue;
    console.log(`\n    ${dim(label)}`);
    for (const r of rowset) {
      out(`      ${green('•')} ${bold(r.name)} ${dim(`@ ${r.file}:${r.line + 1}`)}  ${dim(`(${r.text})`)}`);
      if (r.ts != null) out(`        ${dim('tsgo')} ${dim(r.ts)}`);
      out(`        ${dim('rip ')} ${dim(r.hover)}`);
    }
  }

  const typedRatio = `${probeCount - anyCount} / ${probeCount}`;
  out(`\n  ${bold('Gauge')} ${dim('(hover probes answering a real type, not `any` — keep this full)')}`);
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
      `The Token Audit cannot run — ${blind.length} of ${pool.length} server(s) advertised no semanticTokens legend`,
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
        out(`      ${red('✗')} ${bold(r.name)} ${dim(`@ ${r.file}:${r.line + 1}`)}  ${dim(`(${r.text})`)}`);
        render(r);
      }
    };

    out(`\n  ${bold('Invariants')} ${dim(`(${probed} declarations${tskip ? `, ${tskip} file${tskip === 1 ? '' : 's'} skipped` : ''} — every expectation derived from .rip syntax)`)}`);
    // Every row here is `label  N / M  [count]  note`, and the note is the
    // only part that can run long — so a wrap hangs at the note's own column
    // rather than at the line's indent, where it would read as a nameless
    // second row. The lead is composed first and measured, because the
    // optional violation count moves the column.
    // Rows buffer so the fraction and the shortfall each get ONE column: the
    // numerators run 12 to 2535 and the denominators 22 to 2933, so printing
    // each as it came put every slash at a different place. The shortfall
    // keeps three different WORDS on purpose — `violations` is a fresh
    // regression, `gaps` and `drops` are the known mapping hole — so its
    // number aligns and its word runs on.
    const irows = [];
    let driftNote = 0;
    const irow = (label, bad, den, note, word = 'violation') =>
      irows.push({ label, ok: den - bad, den, bad, word, note: note ?? '' });
    const noteWrap = (lead, note) => {
      const col = visibleW(lead);
      const lines = note ? wrapText(note, TERM_W - col, 0) : [''];
      console.log(lead + dim(lines[0]));
      for (const l of lines.slice(1)) console.log(' '.repeat(col) + dim(l));
    };
    const flushIrows = () => {
      const OW = Math.max(...irows.map((r) => String(r.ok).length));
      const DW = Math.max(...irows.map((r) => String(r.den).length));
      const BW = Math.max(0, ...irows.filter((r) => r.bad).map((r) => String(r.bad).length));
      const SW = Math.max(0, ...irows.filter((r) => r.bad).map((r) => `${r.bad} ${r.word}${r.bad === 1 ? '' : 's'}`.length + (BW - String(r.bad).length)));
      for (const r of irows) {
        const short = r.bad ? String(r.bad).padStart(BW) + ` ${r.word}${r.bad === 1 ? '' : 's'}` : '';
        const lead = `    ${pad(r.label, 12)} ${(r.bad ? red : green)(String(r.ok).padStart(OW))} ${dim('/')} ${dim(pad(String(r.den), DW))}`
          + (SW ? '   ' + yellow(pad(short, SW)) : '') + '   ';
        noteWrap(lead, r.note);
      }
    };
    irow('present', missing.length, probed, 'a declared name gets a token');
    irow('type', badType.length, typeAsserted, `token type matches the declaring form${unasserted.length ? ` · ${unasserted.length} unasserted` : ''}`);
    irow('readonly', badReadonly.length, roAsserted, `readonly IFF the binding is immutable in rip${probed - roAsserted ? ` · ${probed - roAsserted} unasserted` : ''}`);
    // Type-body member presence — EXPECTED RED (the mapping gap), the token
    // twin of the `strict` gauge. Its own line so the wording is "gap" (a
    // known-open hole), not "violation" (a fresh regression), and green means
    // the mapping fix has landed and this gauge should be retired.
    irow('member', memberMissing.length, memberProbed,
      memberMissing.length ? 'type-body member tokens drop — expected red until the mapping fix'
                           : 'type-body member tokens — the mapping fix appears to have landed; retire this gauge', 'gap');
    // Face-survival — USE-SITE token drops (the mapping gap), the direction the
    // source-enumerated invariants above cannot see: a classified source
    // identifier the server drops, covering use sites AND rip-native names with
    // no twin. EXPECTED RED like `member`; green means the mapping fix has
    // landed. Denominator is classified source identifiers (survivors + drops),
    // so the ratio reads as delivery FIDELITY.
    if (facesAvailable) {
      const dropTotal = survDrops.reduce((n, d) => n + d.count, 0);
      irow('use-site', dropTotal, survSurvived + dropTotal,
        dropTotal ? 'identifiers tsgo tokenizes that the server never ships at a use site — expected red until the mapping fix'
                  : 'use-site tokens — the mapping fix appears to have landed; retire this gauge', 'drop');
      // Silent guard (surfaces only on failure): count-based uses the server's
      // tokens directly, so `delivered ⊆ classified` holds by construction —
      // EXCEPT if this standalone FaceOracle's tsgo drifts from the server's.
      // Nothing else would catch that, so flag it, but don't print an always-ok
      // line for a near-tautology.
      if (survUnclassified) driftNote = survUnclassified;
    }
    // OUTSIDE the facesAvailable branch: `use-site` is the only row that
    // depends on the face oracle, and flushing inside it would drop the other
    // four entirely on a run where tsgo never settled.
    flushIrows();
    if (driftNote) console.log(`    ${pad('  ↳ drift', 12)} ${red(`${driftNote} unclassified`)}   ${dim('the server shipped a name tsgo never tokenizes — the reference drifted, distrust the use-site count')}`);

    show(missing, 'No token — the name gets no semantic color', () => {});
    show(badType, 'Wrong token type', (r) => {
      console.log(`        ${dim('expected')} ${green(r.want.type)}`);
      console.log(`        ${dim('actual  ')} ${yellow(fmt(r.got))}`);
    });
    show(badReadonly, 'Wrong `readonly` modifier', (r) => {
      console.log(`        ${dim('expected')} ${green(`${r.want.type}${r.want.readonly ? ' readonly' : ''}`)} ${dim(`— a \`${r.want.form}\` binding is ${r.want.readonly ? 'immutable' : 'WRITABLE'} in rip`)}`);
      console.log(`        ${dim('actual  ')} ${yellow(fmt(r.got))}`);
    });
    // The mapping gap's expected-red evidence, kept apart from the regression
    // sections above: these are known-open holes, not surprises. The name lists
    // are long by nature, so each fixture's names WRAP with a hanging indent
    // aligned under the fixture column (adapting to terminal width) — every name
    // visible by default, but never soft-wrapped into a jumble.
    const byFileOf = (rows) => { const m = new Map(); for (const r of rows) { if (!m.has(r.file)) m.set(r.file, []); m.get(r.file).push(r); } return m; };
    const COL = 6 + (NAME_W + 2) + 1 + 3 + 3;                        // leading + filename + sp + count + gap = name column
    const WRAP = TERM_W - 2;
    // The NAMES go behind -v. This is a known-open gap that cannot move until
    // the mapping fix lands, and 398 identifiers spread over 45 wrapped lines
    // is the largest block in the report saying something the invariant row
    // above already totals. What survives by default is where the drops
    // CONCENTRATE, which is the only part anyone reads for direction.
    const dropSection = (title, byFile, tally, nameOf) => {
      if (!VERBOSE) {
        const ranked = [...byFile].map(([file, entries]) => [file, tally(entries)]).sort((a, b) => b[1] - a[1]);
        const total = ranked.reduce((n, [, c]) => n + c, 0);
        const top = ranked.slice(0, 3).map(([f, c]) => `${f} (${c})`).join(', ');
        out(`\n    ${bold(title)} ${dim(`— the mapping gap, expected red · ${total} across ${ranked.length} file${ranked.length === 1 ? '' : 's'}, heaviest in ${top}; -v names them`)}`);
        return;
      }
      console.log(`\n    ${bold(title)} ${dim('— the mapping gap, expected red')}`);
      for (const [file, entries] of byFile) {
        // filename stays plain (the terminal linkifies it) and full — never
        // dimmed and never stripped of `.rip`, so the click target survives.
        const head = `      ${pad(file, NAME_W + 2)} ${dim(String(tally(entries)).padStart(3))}   `;
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
      out(`\n    ${dim('readonly coverage by form')} ${dim('(both polarities must appear, or the invariant proves nothing)')}`);
      for (const [form, s] of [...byForm].sort()) {
        const tally = s.bad ? `${green(`${s.ok} ok`)}, ${red(`${s.bad} bad`)}` : green(`${s.ok} ok`);
        console.log(`      ${pad(form, 10)} ${dim(`expect ${s.want ? 'readonly' : 'writable'}`)}  ${tally}`);
      }
    }
    if (VERBOSE && unasserted.length) {
      out(`\n    ${dim('unasserted — rip source does not pin a token type (schema declares a value AND a type)')}`);
      for (const r of unasserted) out(`      ${dim('•')} ${bold(r.name)} ${dim(`@ ${r.file}:${r.line + 1}`)}  ${dim(`(${r.text}) → ${fmt(r.got)}`)}`);
    }

    tk = { probed, missing, badType, badReadonly, memberProbed, memberMissing, survSurvived, survDrops, survUnclassified };
  }
}

await Promise.all(pool.map((s) => s.stop()));

// ── combined totals
//
// EVERY LINE NAMES ITS AUDIT. In a full run these totals lines print together at
// the very end, directly beneath the LAST audit's section — so an unlabelled
// "3 failing" reads as belonging to whatever section happens to sit above it.
// That is not hypothetical: the Type Audit's failures were read as the Token
// Audit's, which was reporting all-green two lines lower. A totals line that
// can be misattributed is worse than no totals line.
// Derived, not chosen: the longest lane name plus a two-column gutter, so
// the widest label (`Diagnostics`, at 11) still has air between it and its
// text instead of butting straight into the number. A hand-picked 12 left it
// one space, which reads as a run-on where every other lane has a clean
// column. Adding a lane with a longer name widens the column by itself.
const TOTAL_LABELS = ['Grammar', 'Mapping', 'Type', 'Diagnostics', 'Hover', 'Token'];
const TOTAL_W = Math.max(...TOTAL_LABELS.map((l) => l.length)) + 2;
// Wrap on VISIBLE width (ANSI-stripped) at ` · ` segment boundaries: a totals
// line longer than the terminal would otherwise hard-break mid-word at column
// zero, dangling unindented fragments under the audit-name column. Every
// totals line is built as ` · `-joined segments, so breaking there keeps each
// clause whole; a continuation line leads with its separator. ANSI state
// persists across the break, so a styled segment keeps its paint even when
// its opening code lands on the previous line.
let totalsPrinted = 0;
const totalLine = (audit, text) => {
  const avail = TERM_W - (4 + TOTAL_W) - 1;
  // Split only at TOP-LEVEL separators — a ` · ` inside a parenthetical is
  // part of its clause, and breaking there tears the parens across lines.
  // (ANSI escape codes contain no parens, so depth-counting the styled
  // string is safe.)
  const segs = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch === ' ' && text.startsWith(' · ', i)) { segs.push(text.slice(start, i)); start = i + 3; i += 2; }
  }
  segs.push(text.slice(start));
  // ONE GROUP PER LINE, each starting at the label column. The groups are
  // different KINDS of statement — a headline, the obligations, the queues —
  // and packing them into a paragraph made the longest lane a wall whose
  // continuation opened with a stray `· `, reading as a bullet rather than as
  // the wrap marker it was. The line break separates them now, so the join
  // character is gone and every line begins with the thing it is about. A
  // group too long for one line wraps within itself, hanging two columns in
  // so a continuation can never be mistaken for the next group.
  const lines = [];
  for (const seg of segs) for (const l of wrapText(seg, avail, 2)) lines.push(l);
  // One blank line between every lane. Six lanes reporting on six different
  // instruments are six separate statements, and run together they read as
  // one paragraph whose lines happen to start with a word in the left
  // column — the more so where a lane runs to three lines and the next
  // begins immediately under its last continuation. Uniform, because a rule
  // that spaces some seams and not others makes the spacing itself carry a
  // meaning it does not have.
  if (totalsPrinted++) console.log('');
  console.log('    ' + dim(pad(audit, TOTAL_W)) + lines[0]);
  for (const l of lines.slice(1)) console.log(' '.repeat(4 + TOTAL_W + 2) + l);
};
console.log(`\n  ${bold('Totals')}`);
// The Grammar Audit's coverage number is a gauge, not a regression count:
// uncovered productions are work remaining — a fixture to write, or a park
// held by an open finding — so the count paints yellow until the corpus
// covers the grammar, never red.
//
// The gate reports at three DIFFERENT STANDINGS, and a totals line that
// strings them together with one separator lets none of them be read: a
// closed-denominator score (520/526), a contractual result (every claimed
// vocabulary class falsified), and a gauge (3 spellings never written) each
// mean something different by being off. So the line groups them and SAYS
// WHICH IS WHICH — obligations, whose violation is red and demands a fix, and
// queues, which are work remaining and can only be worked down. Groups are
// joined by ` · ` (the wrap boundary, so a group never tears) and their own
// members by `, `.
if (gr) {
  const n = gr.negatives ?? {};
  const s = (k, one, many = one + 's') => `${k} ${k === 1 ? one : many}`;
  // Obligations: every one of these is a claim the gate makes about itself or
  // about the corpus, and a nonzero count is a defect, not a backlog.
  const broken = [];
  if (gr.unparsed) broken.push(`${s(gr.unparsed, 'fixture')} the parser rejects — the rows say which`);
  if (gr.badExclusions) broken.push(`${s(gr.badExclusions, 'bad exclusion')} — fix the gate's exclusion table`);
  if (gr.unallocated) broken.push(`${gr.unallocated} UNALLOCATED — the manifest owes an ownership decision`);
  if (n.badSpellingExclusions || n.staleMints) broken.push(s((n.badSpellingExclusions ?? 0) + (n.staleMints ?? 0), 'spelling-census violation'));
  if (n.kindBad) broken.push(s(n.kindBad, 'census violation'));
  if (n.vocabUnfalsified) broken.push(`${n.vocabUnfalsified}/${n.vocabClaimed} vocabulary classes unfalsified`);
  if (n.headsUnseen) broken.push(`${s(n.headsUnseen, 'containment construct')} no fixture spells`);
  // The contract judged this all along, but Totals never did — so a wrapped
  // divider failed the run while this line still read `all hold`. It matters
  // more now that the held list names the rule: an obligation a reader is
  // told held must be one this line can also report broken.
  if (n.splitDividers) broken.push(`${s(n.splitDividers, 'wrapped divider')} — join the lines`);
  // The claims registry is the one input here that can be ABSENT: everything
  // else is derived from the grammar or the corpus and always measured, but
  // CLAIMS.md is a file, and when it is missing the whole section is skipped
  // and these counters are never set. `0 red` and `nothing was read` are the
  // same number, so the standing has to be carried separately — an unread
  // registry must never be summarised as a held obligation.
  const claimsRead = n.claimsAbsent != null;
  const claimsRed = (n.claimsBroken ?? 0) + (n.cellsMissing ?? 0) + (n.claimsBadParks ?? 0);
  if (claimsRead && claimsRed) broken.push(`${s(claimsRed, 'claims row')} red`);
  // Queues: yellow because work remains, never because anything is wrong.
  const queues = [];
  // A queue that is entirely parked is a different report from one that is
  // waiting to be worked: the number is the same, the standing is not.
  if (gr.uncovered) queues.push(`${s(gr.uncovered, 'production')} uncovered across ${gr.groups} ${gr.groupKind}${gr.uncoveredParked === gr.uncovered ? ' (all parked)' : gr.uncoveredParked ? ` (${gr.uncoveredParked} parked)` : ''}`);
  if (n.kindQueued) queues.push(`${s(n.kindQueued, 'type kind')} unclaimed${n.kindHeld === n.kindQueued ? ' (all held)' : n.kindHeld ? ` (${n.kindHeld} held)` : ''}`);
  if (n.claimsAbsent) queues.push(`${n.claimsAbsent} claims ruled-uncarried`);
  if (n.darkSpellings) queues.push(`${n.darkSpellings} of ${n.spellings} spellings never written`);
  if (n.famZero) queues.push(`${s(n.famZero, 'family', 'families')} without negatives`);
  if (n.claimsParked) queues.push(`${s(n.claimsParked, 'claims row')} parked`);
  // The green text NAMES what it checked, so it can only ever claim ground
  // actually covered: each clause is pushed by the same condition that made
  // its measurement possible, and a measurement that did not run contributes
  // no clause rather than a zero.
  //
  // SUBJECTS ONLY. Each of these restated its section's own sentence in full
  // — `47 vocabulary classes falsified`, `every claims row still points at a
  // fixture that exists` — and five of those made the one lane whose
  // obligations all hold the longest thing in Totals, a paragraph saying
  // nothing is wrong. The naming property survives on the subject alone: a
  // reader can still see which five checks ran, and the section above owns
  // the count and the verb.
  const held = ['exclusions'];
  if (n.headsTotal) held.push('containment constructs');
  if (n.vocabClaimed) held.push('vocabulary classes');
  if (claimsRead) held.push('claims rows');
  // The divider rule prints no section of its own while it holds, so this
  // clause is the only place a reader learns it was measured at all.
  if (n.dividerFiles) held.push('corpus dividers');
  totalLine('Grammar', `${gr.total} productions${gr.excluded ? dim(` after ${gr.excluded} exclusions`) : ''}: `
    + (gr.uncovered === 0 ? green('every production exercised by the corpus') : green(`${gr.covered} exercised`))
    + `${dim(' · obligations: ')}${broken.length ? red(broken.join(', ')) : green(`all hold — ${held.join(', ')}`)}`
    // An absent registry is NEWS, not silence: the gate prints no Corpus
    // claims section at all in that case, so without this the only trace of
    // a deleted CLAIMS.md is the absence of something a reader has to
    // remember to miss.
    + (claimsRead ? '' : `${dim(' · ')}${yellow('claims: CLAIMS.md absent — not judged')}`)
    + (queues.length ? `${dim(' · queues: ')}${yellow(queues.join(', '))}` : `${dim(' · ')}${green('no queue — nothing ruled and unbuilt')}`));
}
// The Mapping Audit's flagged reads are EXPECTED red (the mapping gap), so
// they read as a gauge, never a regression count: the total is the census, and
// the missing-span clause is the only part that would signal something new.
if (mp) totalLine('Mapping', `${mp.totReads} reads: `
  + (mp.totFlag === 0
    ? green('all placed, all truthful')
    : `${yellow(`${mp.totFlag} unmapped`)} ${dim(`(${mp.unplaced} unplaced, ${mp.mistext} mistext · ${mp.synthetic} synthetic, ${mp.rewrite} rewrite)`)} ${dim('tracking the mapping gap (expected)')}`)
  + dim(` · ${mp.census} at-risk — no exact row`)
  + (mp.drifted ? ` · ${red(`${mp.drifted} mapping back outside the read`)}` : '')
  + (mp.missing ? ` · ${red(`${mp.missing} missing span${mp.missing === 1 ? '' : 's'}`)} ${dim('— a new class')}` : ''));
if (RUN_MAIN) totalLine('Type', (fails === 0
  ? green(`${totalApplicable} dimension checks: all passing`)
  : `${totalApplicable} dimension checks: ${green(totalPass + ' passing')}, ${red(fails + ' failing')}`));
if (el) totalLine('Diagnostics', `${el.asserted} asserted over ${el.files} files: ` + (el.problems.length === 0
  ? green('every code and position as TypeScript says')
  : red(`${el.problems.length} violation${el.problems.length === 1 ? '' : 's'}`)
    + (() => {
        const kinds = ['shape', 'missing', 'position', 'stray', 'orphan'].map((k) => [k, el.problems.filter((p) => p.kind === k).length]).filter(([, n]) => n);
        // A single category is the whole count — `2 violations (2 position)`
        // splits one number into itself. Name the kind instead.
        return kinds.length === 1 ? dim(` — all ${kinds[0][0]}`) : dim(` (${kinds.map(([k, n]) => `${n} ${k}`).join(', ')})`);
      })()));
if (hp) totalLine('Hover', `${hp.probed} hover probes: `
  + (hp.gap === 0 && hp.snapChanged === 0 && hp.violations.length === 0
    ? green('every answer matches the twin, every pin unchanged')
    : `${hp.gap ? yellow(hp.gap + ' twin gap' + (hp.gap === 1 ? '' : 's')) : green('0 twin gaps')}, ${hp.snapChanged ? red(hp.snapChanged + ' pinned answer' + (hp.snapChanged === 1 ? '' : 's') + ' changed') : green('pins unchanged')}${hp.violations.length ? `, ${red(hp.violations.length + ' invariant hit' + (hp.violations.length === 1 ? '' : 's'))}` : ''}`));
if (tk) {
  const bad = tk.missing.length + tk.badType.length + tk.badReadonly.length;
  // The member gauge is reported SEPARATELY from the invariant total: it is
  // expected red (the mapping gap), so folding it in would read as N fresh
  // regressions. Its own clause keeps the real-regression signal clean.
  // Each segment paints itself — never dim() wrapping a yellow()/green(), or
  // ANSI faint stacks onto the color and the count renders washed-out.
  const memberClause = tk.memberMissing.length
    ? dim(' · ') + yellow(`${tk.memberMissing.length}/${tk.memberProbed} type-body member gap${tk.memberMissing.length === 1 ? '' : 's'}`)
    : dim(' · ') + green('type-body members clean');
  // Face-survival rides the same expected-red logic as the member clause: its
  // own segment so use-site drops never read as fresh invariant regressions.
  // Absent entirely when the face oracle did not run (no survDrops key set).
  const survDropTotal = (tk.survDrops ?? []).reduce((n, d) => n + d.count, 0);
  // Joined to the member clause with `, ` rather than ` · `: both gauges track
  // the SAME open gap and carried the same trailing sentence, so as separate
  // groups they spent two lines saying `tracking the mapping gap (expected)`
  // twice. One group, one statement of what they are both waiting on.
  const survivalClause = !facesAvailable
    ? ''
    : tk.survUnclassified
      ? dim(' · ') + red(`${tk.survUnclassified} unclassified`) + ' ' + dim('— the server and tsgo disagree on what is an identifier, distrust the use-site gauge')
      : survDropTotal
        ? dim(', ') + yellow(`${survDropTotal} use-site drop${survDropTotal === 1 ? '' : 's'}`)
        : dim(', ') + green('use-site tokens clean');
  totalLine('Token', `${tk.probed} token probes: `
    + (bad === 0 ? green('all invariants hold')
      : red(`${bad} invariant violation${bad === 1 ? '' : 's'}`)
        + dim(` (${[[tk.missing, 'missing'], [tk.badType, 'wrong type'], [tk.badReadonly, 'wrong readonly']].filter(([r]) => r.length).map(([r, l]) => `${r.length} ${l}`).join(', ')})`))
    + memberClause + survivalClause
    + (tk.memberMissing.length || survDropTotal ? dim(' — tracking the mapping gap (expected)') : dim(' — the mapping gap may be closed')));
}

// ── what this run did NOT cover. The default runs one of the audits, so say
// so on the way out: an audit nobody knows about is an audit nobody runs. Reads
// `ran` straight off AUDITS, so EVERY audit can appear here — including the
// default one, which a `--hover`/`--token` run silently skips.
{
  const skipped = AUDITS.filter((a) => !a.ran);
  const covered = AUDITS.filter((a) => a.ran).map((a) => a.name).join(' + ') || 'nothing';
  if (skipped.length) {
    out(`\n  ${dim('Not run')} ${dim(`(this run: ${covered})`)}`);
    for (const a of skipped) {
      // The blurb wraps; the command below it never does — it is meant to be
      // copied, and a wrapped command line is a command that does not run.
      out(`    ${dim('·')} ${bold(a.name)} ${dim(`— ${a.blurb}`)}`);
      console.log(`      ${dim(`bun run audit${a.flag ? ' ' + a.flag : ''}`)}`);
    }
    out(`    ${dim('·')} ${dim('all of them:')} ${dim('bun run audit')}${dim(' (no flag)')}   ${dim('· full flag list:')} ${dim('--help')}`);
  }
}

// ── the contract (contract.js holds the invariants, and the reason each red one
// is tolerated). The gauges above are read by a person; THIS decides the exit
// code, so the run can be gated without gating on a queue that is expected
// non-zero.
//
// A reason is a sentence, not a clause, so it goes on its OWN indented lines
// rather than trailing the verdict: a hanging wrap under a 30-column name would
// leave two words per line at any normal width, and letting the terminal break
// it dangles fragments at column zero (the defect `totalLine` exists to prevent,
// one section up).
{
  const reason = (text) => { for (const l of wrapText(text, TERM_W - 8, 0)) console.log(`        ${dim(l)}`); };
  const { verdicts, failures } = judge({
    states: { gr, mp, el, hp, tk, fails },
    ran: (lane) => AUDITS.find((a) => a.key === lane).ran,
  });
  const judged = verdicts.filter((v) => v.state !== 'skipped');
  out(`\n  ${bold('Contract')} ${dim(`(${judged.length} invariant${judged.length === 1 ? '' : 's'} judged${verdicts.length - judged.length ? `, ${verdicts.length - judged.length} unjudged — their lane did not run` : ''})`)}`);
  for (const v of judged.filter((x) => x.state !== 'green')) {
    if (v.state === 'red-expected') { console.log(`    ${yellow('·')} ${pad(v.name, 26)} ${dim('red by agreement')}`); reason(v.redBecause); }
    if (v.state === 'red-new') { console.log(`    ${red('✗')} ${pad(v.name, 26)} ${red('BROKEN')}`); reason(`this must hold: ${v.property}`); }
    if (v.state === 'recovered') { console.log(`    ${red('✗')} ${pad(v.name, 26)} ${red('RECOVERED')}`); reason('red by agreement, now holding — delete its `redBecause`, which would otherwise mask the next break here'); }
  }
  const held = judged.filter((v) => v.state === 'red-expected').length;
  const clean = judged.filter((v) => v.state === 'green').length;
  out(`    ${failures.length ? red(`${failures.length} failing`) : green('contract holds')}${dim(` · ${clean} green · ${held} red by agreement`)}`);
  console.log('');
  if (failures.length) process.exit(1);
}
console.log('');
