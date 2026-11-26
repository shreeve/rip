// Shows each consumer-corpus program whose output differs between another
// revision's compiler and this checkout's: the review that precedes
// accepting a moved manifest with `bun run corpus`.
//   bun scripts/consumer-diff.mjs <git-ref> [key substring]
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { packageInputs, rowInputs } from '../test/support/consumer-hashes.js';

const [ref, filter] = process.argv.slice(2);
if (!ref) { console.error('usage: bun scripts/consumer-diff.mjs <git-ref> [key substring]'); process.exit(2); }
const root = join(import.meta.dir, '..');
const scratch = mkdtempSync(join(tmpdir(), 'rip-consumer-diff-'));
const other = join(scratch, 'ref');
const git = (...a) => Bun.spawnSync(['git', ...a], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
if (git('worktree', 'add', '--detach', other, ref).exitCode !== 0) { console.error(`cannot check out ${ref}`); process.exit(1); }
try {
  const { compile: mine } = await import(join(root, 'src/compiler.js'));
  const { compile: theirs } = await import(join(other, 'src/compiler.js'));
  const run = (compile, src, path, face) => {
    try { return compile(src, { path, runtimeDelivery: 'none', ...(face === 'ts' ? { face: 'ts' } : {}) }).code; } catch (e) { return `ERR ${String(e?.message ?? e).split('\n')[0]}\n`; }
  };
  let moved = 0;
  for (const { key, src, path } of [...packageInputs(root), ...(await rowInputs(root))]) {
    if (filter && !key.includes(filter)) continue;
    for (const face of ['js', 'ts']) {
      const a = run(theirs, src, path, face), b = run(mine, src, path, face);
      if (a === b) continue;
      moved++;
      const fa = join(scratch, 'a'), fb = join(scratch, 'b');
      writeFileSync(fa, a); writeFileSync(fb, b);
      const d = Bun.spawnSync(['diff', '-u', '--label', `${ref} ${face}`, '--label', `this ${face}`, fa, fb], { stdout: 'pipe' });
      console.log(`=== ${key} [${face}]\n${new TextDecoder().decode(d.stdout)}`);
    }
  }
  console.log(`${moved} output(s) differ from ${ref}`);
} finally {
  git('worktree', 'remove', '--force', other);
  rmSync(scratch, { recursive: true, force: true });
}
