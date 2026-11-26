// Shows each consumer-corpus program whose front-end facts (the token tape,
// the strict tree and its store rows, the tolerant parse, the REPL verdict)
// differ between another revision's front end and this checkout's: the
// review that precedes accepting a moved test/corpus/frontend.json with
// `bun run corpus`, and the proof that a change meant to leave trees alone
// did.
//   bun scripts/frontend-diff.mjs <git-ref> [key substring] [--lines N]
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { packageInputs, rowInputs } from '../test/support/consumer-hashes.js';
import { frontEndFacts, FRONTEND_FACTS } from '../test/support/frontend-hashes.js';

const args = process.argv.slice(2);
const linesAt = args.indexOf('--lines');
const limit = linesAt === -1 ? 60 : Number(args.splice(linesAt, 2)[1]);
const [ref, filter] = args;
if (!ref || !Number.isInteger(limit) || limit < 1) {
  console.error('usage: bun scripts/frontend-diff.mjs <git-ref> [key substring] [--lines N]');
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
      const { Parser } = await import(join(dir, 'src/parser.js'));
      const { makeParserLexer } = await import(join(dir, 'src/lexer.js'));
      const { classifyCompleteness, splitData } = await import(join(dir, 'src/compiler.js'));
      return { Parser, makeParserLexer, classifyCompleteness, splitData };
    } catch (e) {
      throw new Error(`${name} has no front end this script can load (src/parser.js, src/lexer.js, src/compiler.js): ${e.message}`);
    }
  };
  const theirs = await engine(other, ref);
  const mine = await engine(root, 'this checkout');
  const counts = Object.fromEntries(FRONTEND_FACTS.map((f) => [f, 0]));
  let programs = 0;
  for (const { key, src, path } of [...packageInputs(root), ...(await rowInputs(root))]) {
    if (filter && !key.includes(filter)) continue;
    const a = frontEndFacts(src, path, theirs), b = frontEndFacts(src, path, mine);
    let movedHere = false;
    for (const fact of FRONTEND_FACTS) {
      const ta = a[fact].join('\n') + '\n', tb = b[fact].join('\n') + '\n';
      if (ta === tb) continue;
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
} finally {
  git('worktree', 'remove', '--force', other);
  rmSync(scratch, { recursive: true, force: true });
}
