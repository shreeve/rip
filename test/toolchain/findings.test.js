// The findings ledger's integrity, as a standing gate — two rules, both about
// test/audit/FINDINGS.md.
//
// 1. IDS STAY INSIDE. Its rows are numbered so one row can cite another;
//    nothing outside the file cites one. The reason is lifetime: a row is
//    deleted the day its gate goes green, so a pointer to it from code — which
//    is permanent — is a reference built to rot, and it rots silently, the
//    moment the row leaves. References run doc -> code (a Gate cell names a
//    test that outlives the row), never code -> doc.
//
// 2. EVERY GATE NAME RESOLVES. The Gate column is the ledger's exit criterion,
//    and for a closed row it is the whole of what survives deletion: ID,
//    claim, gate. Rename a gate away and that row points at nothing, taking
//    the record of why the code is shaped as it is with it. So every
//    backticked token in a Gate cell must name a real test file, a real file
//    in the audit directory, or a real audit dimension.
//
// WHY GATES AND NOT CONVENTIONS. The agent that closes a finding is not the
// agent that wrote it: different session, no shared context, pointed at one
// row. It does not know the citations exist, so it cannot clean up what it
// cannot see — a DISCOVERY problem, which prose cannot address, and whose
// omission is otherwise silent. Same for a renamed gate: nothing fails today.
//
// SCOPE OF RULE 1 — the citation FORM, `finding #<n>`, INCLUDING one wrapped
// across a comment continuation. That last part is load-bearing: this repo's
// comments wrap, and a line-oriented scan cannot see `(finding` / `// #21)`,
// which is a shape runner.js actually contained. A bare `#<n>` is deliberately
// NOT gated — this repo means a dozen unrelated things by it (the emitter's
// defect classes, review rounds, hex colours, tsgo's own type names), and a
// rule carrying a denylist erodes as the denylist ages. This gate is therefore
// a proxy for its invariant, not the invariant itself: it catches the natural
// spelling, which is what an agent reaches for, and misses a determined
// paraphrase.
//
// The spelling `finding #<n>` is RESERVED for ledger rows. A review finding
// (PROCESS.md section 6) has its own ID space and must not borrow this one —
// today's spell it `finding S3` / `finding M-2`, which is the convention to
// keep.
import { test, expect } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join, relative, sep } from 'path';

const ROOT = join(import.meta.dir, '../..');
const LEDGER = join('test', 'audit', 'FINDINGS.md');   // sep-correct: compared against relative()
const RUNNER = join('test', 'audit', 'runner.js');
// The sweep walks GIT-TRACKED files only, so its verdict is a function of
// the repository rather than the checkout's scratch state. The directory
// skip-list this replaces kept growing the same lesson case by case: the
// editor's `.rip` mirror made the verdict depend on whether VS Code was
// running, `.claude` on whether an agent session was, untracked `misc/`
// notes on what was jotted locally — every one untracked, which is the
// actual boundary. Tracked-only also means a citation added WITH a new
// file fails the moment the file is staged, which is the earliest a gate
// can catch it.
const TEXT = /\.(js|mjs|cjs|md|json|rip|ts|tsx|yml|yaml|sh)$/;

// The banned form. `finding` and `#<n>` may be separated by a comment
// continuation (`\n  // `, `\n * `, `\n # `) because that is how this repo
// wraps prose. Spelled as a character class rather than with a literal example
// so this file — which the sweep reads like any other — never trips its own
// gate. The `post-`/`pre-`/`per-` prefixed spellings are the paraphrase a
// real citation actually wore once (`post-` + row number in pins.js), so
// the sweep names them too; a fully determined paraphrase still evades,
// as the header concedes.
const CITE = /(?:findings?[ \t]*(?:\r?\n[ \t]*(?:\/\/|#|\*)?[ \t]*)?|(?:post|pre|per)-)#[0-9]+/gi;

// `git ls-files -z` (NUL-delimited: filenames are data, not lines). A path
// tracked but deleted from the working tree still lists, so existence
// filters — the sweep reads bytes, and a ghost entry would throw. Text
// files by extension, plus everything under bin/ — launchers are
// extension-less by convention and are exactly as permanent as any other
// tracked code.
const trackedFiles = () =>
  execSync('git ls-files -z', { cwd: ROOT }).toString().split('\0')
    .filter((rel) => rel && (TEXT.test(rel) || rel.startsWith('bin/')))
    .map((rel) => join(ROOT, rel))
    .filter((p) => existsSync(p));

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

test('finding IDs stay inside the ledger — nothing outside it cites one', () => {
  const files = trackedFiles();
  const rels = new Set(files.map((f) => relative(ROOT, f)));

  // Not vacuous, and specific: name the trees this rule is about, so a
  // filter that swallows a whole subtree fails here instead of quietly
  // shrinking the sweep. (A bare count cannot tell 700 files from 700 of the
  // wrong files.) `bin/rip` holds the extension-less launchers in scope,
  // and the workflow yml holds the new extensions in.
  for (const probe of ['src/emitter.js', 'packages/vscode/src/server.js', RUNNER, LEDGER, 'bin/rip', '.github/workflows/test.yml']) {
    expect(rels.has(probe.split('/').join(sep)), `the walk never reached ${probe}`).toBe(true);
  }

  const violations = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (rel === LEDGER) continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(CITE)) {
      violations.push(`  ${rel}:${lineOf(text, m.index)}: ${m[0].replace(/\s+/g, ' ')}`);
    }
  }
  expect(
    violations,
    'a finding ID escaped the ledger. Each of these names a row that is deleted\n'
    + 'the day its gate goes green, and will then point at nothing:\n\n'
    + `${violations.join('\n')}\n\n`
    + 'State the constraint in place instead of pointing at where it is written —\n'
    + 'the number is doc-internal, and the commit that filed the finding is the\n'
    + 'durable provenance. (Meant a review finding, not a ledger row? Spell it\n'
    + "without the `#`, the way `finding S3` and `finding M-2` already do.)",
  ).toEqual([]);
});

test('every gate the ledger names resolves — a renamed gate cannot rot in the Gate column', () => {
  const ledger = readFileSync(join(ROOT, LEDGER), 'utf8');
  const runner = readFileSync(join(ROOT, RUNNER), 'utf8');

  // The Type Audit's five dimensions, read from the runner's OWN declaration
  // rather than copied — renaming one there fails here instead of drifting.
  const dims = [...(/const DIMS = \[(.+?)\];/s.exec(runner)?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  expect(dims.length, 'could not read DIMS out of runner.js — the parse below is stale').toBe(5);

  // The token audit's invariants and the mapping audit's census are not in DIMS
  // (that table is the Type Audit's). Listed here, but each is asserted to still
  // appear in the runner, so a rename fails rather than rotting.
  // Retiring one means deleting it here too: a name kept in this list after the
  // runner drops it asserts a gauge that no longer exists.
  const invariants = ['present', 'type', 'readonly', 'use-site', 'census', 'identity', 'silence', 'ruled'];
  for (const name of invariants) {
    expect(runner.includes(`'${name}'`), `runner.js no longer mentions the '${name}' invariant`).toBe(true);
  }

  const tracked = trackedFiles();
  const testFiles = new Set(tracked
    .map((f) => relative(ROOT, f))
    .filter((rel) => (rel.startsWith(`test${sep}`) || rel.startsWith(`packages${sep}`)) && rel.endsWith('.test.js'))
    .map((rel) => rel.split(sep).pop().replace(/\.test\.js$/, '')));
  const auditFiles = new Set(tracked
    .map((f) => relative(ROOT, f))
    .filter((rel) => rel.startsWith(join('test', 'audit') + sep))
    .map((rel) => rel.split(sep)[2]));
  const known = new Set([...dims, ...invariants, ...testFiles, ...auditFiles]);

  // A table row's LAST cell is its Gate. Inside it, a backticked token is a
  // gate name — that is the convention this assertion enforces, so prose in a
  // Gate cell must not wear backticks.
  const unresolved = [];
  for (const line of ledger.split('\n')) {
    if (!/^\| (\[\d+\]\(#|C?\d+ \|)/.test(line)) continue;
    const cells = line.split('|').slice(1, -1);
    const id = cells[0].trim();
    for (const m of cells[cells.length - 1].matchAll(/`([^`]+)`/g)) {
      if (!known.has(m[1])) unresolved.push(`  ${id}: \`${m[1]}\``);
    }
  }
  expect(
    unresolved,
    'the ledger names a gate that does not resolve to a test file, an audit\n'
    + 'dimension, or a file in test/audit/:\n\n'
    + `${unresolved.join('\n')}\n\n`
    + 'Either the gate was renamed and the row now points at nothing, or the\n'
    + 'Gate cell is wearing backticks around prose. In a Gate cell, a backticked\n'
    + 'token is a gate name.',
  ).toEqual([]);
});

// The five slots every open row carries, and the marker each is recognized by.
// Markers, not prose: a section a gate cannot see is a section that goes
// missing silently, which is how a row shipped with its symptom driven and its
// root never diagnosed. Each marker is the spelling already dominant in the
// ledger, so this gate normalizes rather than invents.
const SLOTS = [
  ['**Why (code)', 'the ROOT — what in the code produces this, cited by file and symbol'],
  ['**The fix', 'the FIX — where it belongs, what it must not do, and a precedent if one exists;\n     or, where the fix needs a decision, the ruling required and who makes it'],
  ['**Why the suite missed it', 'how it ESCAPED — which instrument should have caught it and why it did not'],
  ['**vs v3', 'the PRIOR behavior — driven both sides, or explicitly why v3 cannot be asked'],
  ['**Status.**', 'the EXIT — open date, and the gate (or an honest none, plus what the fix\'s gate would be)'],
];

// A marker must be followed by punctuation or a space, never by more word.
// Without the lookahead `**The fix` also matches `**The fixture…`, a phrase
// this ledger reaches for constantly — a row could then satisfy the fix slot
// while carrying no fix, which is the one failure this gate exists to prevent.
// The apostrophe is in the class deliberately: `**The fix's shape …` is a real
// slot, and an anchor that excluded it would manufacture a rewrite.
const slotAt = (body, marker) =>
  new RegExp(`\\n${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[ .,—:*'])`).test(body);

// Bodies only, and terminated. Splitting on `\n### ` alone runs the LAST body
// to end-of-file, swallowing `## Closed` and anything after it — so a marker
// appearing in that trailing prose would silently satisfy the final row's slot.
const findingBodies = (ledger) =>
  ledger.slice(ledger.indexOf('\n## Findings'))
    .replace(/\n## (?!Findings)[\s\S]*$/, '')
    .split(/\n### /)
    .slice(1);

test('every open row is complete — all five slots present', () => {
  const ledger = readFileSync(join(ROOT, LEDGER), 'utf8');
  const bodies = findingBodies(ledger);

  // Not a row COUNT: the road is engineered to drain, and its stated end state
  // is empty, so asserting "at least N rows" would turn success into failure.
  // What must hold is that the parse worked at all.
  expect(ledger.includes('\n## Findings'), 'the ## Findings heading is gone — the parse below is meaningless').toBe(true);
  expect(bodies.every((b) => /^\d+\. \S/.test(b)), 'a parsed body does not open with `<id>. <title>` — the ### row form changed').toBe(true);

  const incomplete = [];
  for (const body of bodies) {
    const id = body.slice(0, body.indexOf('\n')).trim();
    const missing = SLOTS.filter(([marker]) => !slotAt(body, marker)).map(([, what]) => what);
    if (missing.length) incomplete.push(`  ${id}\n${missing.map((m) => `   - ${m}`).join('\n')}`);
  }

  expect(
    incomplete,
    'a row is missing a slot completeness requires. A finding is not a report of a\n'
    + 'symptom — it is everything the person who fixes it would otherwise have to\n'
    + 'rediscover, and the parts most worth keeping (what the fix must NOT do, why\n'
    + 'the instrument was blind) exist nowhere in the code and die with the body:\n\n'
    + `${incomplete.join('\n\n')}\n\n`
    + 'A slot with nothing to say is still filled, honestly: "root not diagnosed,\n'
    + 'and here is what would settle it" is complete; silence is not. See the\n'
    + 'completeness contract under "How to read this ledger".',
  ).toEqual([]);
});

// A slot's evidence often lives in ANOTHER slot, cited by direction — "v3
// already answers this (below)". Slots get inserted, and an insertion moves
// what is above what, so a pointer written correctly once silently inverts
// later. This is not hypothetical: every one of these was produced by a single
// pass that appended slots ahead of `**Status.**` without regard to order.
//
// SCOPE — the unambiguous case only: a slot paragraph that cites v3 evidence
// with a bare directional parenthetical, where the `**vs v3` slot sits the
// other way. A general "any above/below" check would drown in this file's
// ordinary prose ("driven above", "the table below"), so like the citation
// sweep this is a proxy for its invariant: it catches the natural spelling and
// misses a determined paraphrase.
test('a slot citing v3 evidence by direction points the right way', () => {
  const ledger = readFileSync(join(ROOT, LEDGER), 'utf8');
  const backwards = [];

  for (const body of findingBodies(ledger)) {
    const id = body.slice(0, body.indexOf('\n')).trim();
    const paras = body.split('\n\n');
    const v3At = paras.findIndex((p) => /^\*\*vs v3(?=[ .,—:*'])/.test(p));
    if (v3At < 0) continue;
    paras.forEach((p, i) => {
      if (!/^\*\*(The fix|Why \(code\))(?=[ .,—:*'])/.test(p)) return;
      // Proximity, not paragraph scope. A slot paragraph routinely points at
      // several things at once — "the reproduction above" beside "v3 … (below)"
      // — so a paragraph-wide test flags the sentence that is right. Only a
      // directional parenthetical trailing a v3 clause is unambiguous enough
      // to judge.
      for (const m of p.matchAll(/\((?:also )?(above|below)\)/g)) {
        if (!/\bv3\b[^.]{0,60}$/.test(p.slice(0, m.index))) continue;
        const said = m[1];
        const actual = v3At > i ? 'below' : 'above';
        if (said !== actual) {
          backwards.push(`  ${id}\n     cites v3 as "${said}"; the vs v3 slot is ${actual.toUpperCase()} it`);
        }
      }
    });
  }

  expect(
    backwards,
    'a slot points at v3 evidence in the wrong direction. A reader following the\n'
    + 'pointer lands on the wrong paragraph — and the row exists so that someone who\n'
    + 'was not there can act on it without rediscovering anything:\n\n'
    + `${backwards.join('\n\n')}\n\n`
    + 'Either reorder the slots or reword the pointer. Inserting a slot reorders the\n'
    + 'body, so every cross-reference in that body is in scope for the same edit.',
  ).toEqual([]);
});

test('the sweep is not vacuous — the banned form is really detected, wrapped or not, and its neighbours really are not', () => {
  // If CITE ever stopped matching, the sweep above would read a repo full of
  // citations and report clean — the exact failure the ledger's own rules warn
  // about (a gate that cannot fail is not covering anything). These probes are
  // built by concatenation because spelling one literally here would violate
  // the rule this file enforces.
  const hit = (s) => { CITE.lastIndex = 0; return CITE.test(s); };
  const cite = 'finding ' + '#42';
  expect(hit(`// under always-place (${cite}) every directive reaches the face`)).toBe(true);
  expect(hit('// Finding ' + '#7' + ' — the headless type-checker')).toBe(true);
  expect(hit('// findings ' + '#3' + ' and ' + '#10' + ' share a root')).toBe(true);
  // Wrapped across a comment continuation — the shape runner.js actually had,
  // and the one a line-oriented scan cannot see.
  expect(hit('// EXPECTED RED (finding\n//                  ' + '#21' + '): the same root')).toBe(true);
  expect(hit('// suppressed as a class (see finding\n// ' + '#20' + ' for why)')).toBe(true);
  expect(hit(' * governs the next line (finding\n *  ' + '#6' + ')')).toBe(true);
  // And the ID spaces it must leave alone.
  expect(hit('const brand = { colors: { brand: "#123456" } };')).toBe(false);
  expect(hit("// the #126 defect class — the emitter's own numbering")).toBe(false);
  expect(hit('// yields type names like `#3` and empty modifier lists')).toBe(false);
  expect(hit('// session-lifecycle guarantees PR #107 pinned')).toBe(false);
});
