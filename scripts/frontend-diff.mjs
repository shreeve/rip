// Shows each consumer-corpus program whose front-end facts (the token tape,
// the strict tree and its store rows, the tolerant parse, the REPL verdict)
// differ between another revision's front end and this checkout's: the
// review that precedes accepting a moved test/corpus/frontend.json with
// `bun run corpus`, and the proof that a change meant to leave trees alone
// did.
//   bun scripts/frontend-diff.mjs <git-ref> [key substring] [--lines N] [--rule-text]
//
// A grammar change renumbers the rules after it, and every NodeStore row
// carries its rule id. --rule-text prints each id as its rule's text in
// that revision's grammar, so a renumbering diffs empty and what remains is
// a real change; the summary lists each rule whose own text differs
// between the rows, the renames the change made. A pair is a rename only
// when neither text exists in the other revision's grammar: a row that now
// names a rule both grammars have was parsed by a different rule, and is
// counted with the facts that differ in more than a rule's text.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { packageInputs, rowInputs } from '../test/support/consumer-hashes.js';
import { frontEndFacts, FRONTEND_FACTS } from '../test/support/frontend-hashes.js';

const args = process.argv.slice(2);
const ruleTextAt = args.indexOf('--rule-text');
const ruleText = ruleTextAt !== -1;
if (ruleText) args.splice(ruleTextAt, 1);
const linesAt = args.indexOf('--lines');
const limit = linesAt === -1 ? 60 : Number(args.splice(linesAt, 2)[1]);
const [ref, filter] = args;
if (!ref || !Number.isInteger(limit) || limit < 1) {
  console.error('usage: bun scripts/frontend-diff.mjs <git-ref> [key substring] [--lines N] [--rule-text]');
  process.exit(2);
}
const root = join(import.meta.dir, '..');
const scratch = mkdtempSync(join(tmpdir(), 'rip-frontend-diff-'));
const other = join(scratch, 'ref');
const git = (...a) => Bun.spawnSync(['git', ...a], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
if (git('worktree', 'add', '--detach', other, ref).exitCode !== 0) {
  rmSync(scratch, { recursive: true, force: true });
  console.error(`cannot check out ${ref}`);
  process.exit(1);
}
try {
  const engine = async (dir, name) => {
    try {
      const mod = await import(join(dir, 'src/parser.js'));
      const { Parser } = mod;
      const { makeParserLexer } = await import(join(dir, 'src/lexer.js'));
      const { classifyCompleteness, splitData } = await import(join(dir, 'src/compiler.js'));
      // Another revision's parser may carry the names as a property.
      return { Parser, makeParserLexer, classifyCompleteness, splitData, ruleNames: mod.ruleNames ?? mod.parser.ruleNames };
    } catch (e) {
      throw new Error(`${name} has no front end this script can load (src/parser.js, src/lexer.js, src/compiler.js): ${e.message}`);
    }
  };
  const theirs = await engine(other, ref);
  const mine = await engine(root, 'this checkout');
  const counts = Object.fromEntries(FRONTEND_FACTS.map((f) => [f, 0]));
  const RULE_ID = /"ruleId":(\d+)/g;
  const named = (lines, names) => lines.map((l) => l.replace(RULE_ID, (_, n) => `"rule":${JSON.stringify(+n === 0 ? '(leaf)' : names[+n])}`));
  const textOf = (lines, engine) => (ruleText ? named(lines, engine.ruleNames) : lines).join('\n') + '\n';
  const renames = new Map();
  let unexplained = 0;
  let programs = 0;
  for (const { key, src, path } of [...packageInputs(root), ...(await rowInputs(root))]) {
    if (filter && !key.includes(filter)) continue;
    const a = frontEndFacts(src, path, theirs), b = frontEndFacts(src, path, mine);
    let movedHere = false;
    for (const fact of FRONTEND_FACTS) {
      const ta = textOf(a[fact], theirs), tb = textOf(b[fact], mine);
      if (ta === tb) continue;
      if (ruleText) {
        // Rows identical once the rule is blanked differ only in the rule's
        // own text: record that pair as a rename.
        const la = ta.split('\n'), lb = tb.split('\n');
        const blank = (l) => l.replace(/"rule":"(?:[^"\\]|\\.)*"/g, '"rule"');
        if (la.length === lb.length && la.every((l, i) => blank(l) === blank(lb[i]))) {
          la.forEach((l, i) => {
            if (l === lb[i]) return;
            const ra = [...l.matchAll(/"rule":("(?:[^"\\]|\\.)*")/g)].map((m) => JSON.parse(m[1]));
            const rb = [...lb[i].matchAll(/"rule":("(?:[^"\\]|\\.)*")/g)].map((m) => JSON.parse(m[1]));
            ra.forEach((r, k) => { if (r !== rb[k]) renames.set(`${r}  →  ${rb[k]}`, (renames.get(`${r}  →  ${rb[k]}`) ?? 0) + 1); });
          });
        } else {
          unexplained++;
        }
      }
      counts[fact]++;
      movedHere = true;
      const fa = join(scratch, 'a'), fb = join(scratch, 'b');
      writeFileSync(fa, ta); writeFileSync(fb, tb);
      const d = Bun.spawnSync(['diff', '-u', '--label', `${ref} ${fact}`, '--label', `this ${fact}`, fa, fb], { stdout: 'pipe' });
      const out = new TextDecoder().decode(d.stdout).split('\n');
      const shown = out.slice(0, limit).join('\n');
      console.log(`=== ${key} [${fact}]\n${shown}${out.length > limit ? `\n… ${out.length - limit} more diff lines (--lines N)` : ''}`);
    }
    if (movedHere) programs++;
  }
  console.log(`${programs} program(s) differ from ${ref}: ${FRONTEND_FACTS.map((f) => `${f} ${counts[f]}`).join(', ')}`);
  const oldRules = new Set(theirs.ruleNames), newRules = new Set(mine.ruleNames);
  const reselected = [...renames.keys()].filter((pair) => {
    const [from, to] = pair.split('  →  ');
    return newRules.has(from) || oldRules.has(to);
  });
  for (const pair of reselected) { unexplained += renames.get(pair); renames.delete(pair); }
  if (ruleText) console.log(`${unexplained} moved fact(s) or row(s) differ in more than a rule's text`);
  if (reselected.length) {
    console.log('rows that now name a different rule both grammars define (a different parse, not a rename):');
    for (const pair of reselected) console.log(`  ${pair}`);
  }
  if (renames.size) {
    console.log('rules whose own text differs (rows that differ only by it):');
    for (const [pair, rows] of renames) console.log(`  ${pair}  (${rows} rows)`);
  }
} finally {
  git('worktree', 'remove', '--force', other);
  rmSync(scratch, { recursive: true, force: true });
}
