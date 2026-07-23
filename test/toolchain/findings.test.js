// The findings ledger's integrity, as a standing gate — two rules, both about
// test/type-audit/FINDINGS.md.
//
// 1. IDS STAY INSIDE. Its rows are numbered so one row can cite another;
//    nothing outside the file cites one (sole exemption: HANDOFF.md — see
//    the HANDOFF constant). The reason is lifetime: a row is
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
import { readFileSync, readdirSync, lstatSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = join(import.meta.dir, '../..');
const LEDGER = join('test', 'type-audit', 'FINDINGS.md');   // sep-correct: compared against relative()
// HANDOFF.md is exempt from rule 1 on the rule's own premise. The rule bans
// citations from things LONGER-lived than a row, because they outlive the row
// and rot. HANDOFF.md is the one document shorter-lived than the rows: its
// contract (AGENTS.md, working ledgers) is a wholesale rewrite at every
// session boundary with live-verified facts only, so a citation there dies
// before — or with — the row it names. An exemption grounded in that lifetime
// argument is not the denylist erosion warned about below; a second exemption
// citing this one as precedent, without its own lifetime argument, would be.
const HANDOFF = 'HANDOFF.md';
const RUNNER = join('test', 'type-audit', 'runner.js');
// `.rip` is the editor's generated mirror — untracked scratch that holds
// compiled faces of whatever happened to be open, so scanning it makes this
// gate's verdict depend on whether VS Code was running. `.claude` is the
// same class: agent-session state (settings, git worktrees holding whole
// checkouts of OTHER branches), so scanning it makes the verdict depend on
// whether a Claude session was running and what its branch contained.
const SKIP = new Set(['node_modules', '.git', '.rip', '.claude', 'dist', 'build', 'coverage', '.vscode-test']);
const TEXT = /\.(js|mjs|cjs|md|json|rip|ts|tsx)$/;

// The banned form. `finding` and `#<n>` may be separated by a comment
// continuation (`\n  // `, `\n * `, `\n # `) because that is how this repo
// wraps prose. Spelled as a character class rather than with a literal example
// so this file — which the sweep reads like any other — never trips its own
// gate.
const CITE = /findings?[ \t]*(?:\r?\n[ \t]*(?:\/\/|#|\*)?[ \t]*)?#[0-9]+/gi;

// lstat, not stat: a symlinked directory is not descended, so a symlink cycle
// anywhere under ROOT cannot recurse this whole-repo walk into a stack blowout.
const walk = (dir, acc = []) => {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (st.isFile() && TEXT.test(name)) acc.push(p);
  }
  return acc;
};

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

test('finding IDs stay inside the ledger — nothing outside it cites one', () => {
  const files = walk(ROOT);
  const rels = new Set(files.map((f) => relative(ROOT, f)));

  // Not vacuous, and specific: name the trees this rule is about, so a SKIP
  // entry that swallows a whole subtree fails here instead of quietly
  // shrinking the sweep. (A bare count cannot tell 700 files from 700 of the
  // wrong files.)
  for (const probe of ['src/emitter.js', 'packages/vscode/src/server.js', RUNNER, LEDGER]) {
    expect(rels.has(probe.split('/').join(sep)), `the walk never reached ${probe}`).toBe(true);
  }

  const violations = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (rel === LEDGER || rel === HANDOFF) continue;
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

  // The type audit's six dimensions, read from the runner's OWN declaration
  // rather than copied — renaming one there fails here instead of drifting.
  const dims = [...(/const DIMS = \[(.+?)\];/s.exec(runner)?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  expect(dims.length, 'could not read DIMS out of runner.js — the parse below is stale').toBe(6);

  // The token audit's invariants and the mapping audit's census are not in DIMS
  // (that table is the type audit's). Listed here, but each is asserted to still
  // appear in the runner, so a rename fails rather than rotting.
  const invariants = ['present', 'type', 'readonly', 'member', 'survival', 'census', 'silence'];
  for (const name of invariants) {
    expect(runner.includes(`'${name}'`), `runner.js no longer mentions the '${name}' invariant`).toBe(true);
  }

  const testFiles = new Set(walk(join(ROOT, 'test')).concat(walk(join(ROOT, 'packages')))
    .filter((f) => f.endsWith('.test.js'))
    .map((f) => f.split(sep).pop().replace(/\.test\.js$/, '')));
  const auditFiles = new Set(readdirSync(join(ROOT, 'test', 'type-audit')));
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
    + 'dimension, or a file in test/type-audit/:\n\n'
    + `${unresolved.join('\n')}\n\n`
    + 'Either the gate was renamed and the row now points at nothing, or the\n'
    + 'Gate cell is wearing backticks around prose. In a Gate cell, a backticked\n'
    + 'token is a gate name.',
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
