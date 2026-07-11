// One tsc program over many independent rows: each row
// materializes as its own FILE in a fresh temp directory and a single
// tsc invocation checks them all, with every diagnostic attributed
// back to its row by tsc's own file-prefixed output. Rows isolate
// from each other by MODULE scope — callers append `export {}` (the
// same isolation idiom the tsface tier-1 gate uses; the appended line
// is idiom, not part of the artifact) — so global-scope collisions
// across rows (TS2451/TS2300, the reason naive concatenation and
// shared-scope batching were rejected) cannot occur, while every
// within-row defect (TS7006/TS7010 implicit-any, syntax, type errors)
// still fires exactly as it did under per-row invocation.
//
// The declare-module wrapping variant was probed and rejected: the
// declaration rows carry their own `declare` modifiers, which are
// illegal inside an already-ambient `declare module` block (TS1038) —
// wrapping would force stripping `declare` from the artifact under
// validation, a transform the gate must not have.
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';

// files: { name: text }. Returns { status, byFile: Map<name, [line]>,
// unattributed: [line] } — unattributed lines (global tsc errors, or
// diagnostics against a file the caller did not register) must be
// asserted empty by the caller, so no diagnostic can vanish between
// the rows.
export function tscBatch(tsc, files, extraArgs = []) {
  const dir = mkdtempSync(join(tmpdir(), 'rip-tsc-batch-'));
  try {
    const names = Object.keys(files);
    for (const name of names) writeFileSync(join(dir, name), files[name]);
    const r = spawnSync(tsc, ['--noEmit', '--target', 'es2022', '--lib', 'es2022,dom', ...extraArgs, ...names], {
      cwd: dir,
      encoding: 'utf8',
    });
    if (r.error) {
      throw new Error(`cannot run tsc at ${tsc} (${r.error.message}) — fix RIP_TSC or PATH`);
    }
    const byFile = new Map(names.map((n) => [n, []]));
    const unattributed = [];
    for (const line of `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n')) {
      if (!/\berror TS\d+:/.test(line)) continue;
      const m = line.match(/^(.+?)\(\d+,\d+\):/);
      if (m && byFile.has(m[1])) byFile.get(m[1]).push(line);
      else unattributed.push(line);
    }
    return { status: r.status, byFile, unattributed };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
