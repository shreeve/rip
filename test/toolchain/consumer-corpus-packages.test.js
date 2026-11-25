// The consumer-corpus gate, package modules half: every one compiles, on both
// faces, to the output the manifest pins. A change that moves real
// code's output is accepted only by `bun run corpus`, after its diff is
// reviewed (`bun scripts/consumer-diff.mjs <ref>` shows each moved output
// against another revision's compiler).
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '../../src/compiler.js';
import { packageInputs, rowInputs, hashInputs, MANIFEST } from '../support/consumer-hashes.js';

const ROOT = join(import.meta.dir, '../..');

test('package modules compile to the pinned consumer-corpus output', async () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, MANIFEST), 'utf8'));
  const got = hashInputs(packageInputs(ROOT), compile);
  const pinned = Object.fromEntries(Object.entries(manifest).filter(([k]) => k.startsWith('pkg ')));
  const moved = [], missing = [], unpinned = [];
  for (const [k, v] of Object.entries(got)) {
    if (!(k in pinned)) unpinned.push(k);
    else if (v.js !== pinned[k].js || v.ts !== pinned[k].ts) moved.push(`${k}${v.js !== pinned[k].js ? ' [js]' : ''}${v.ts !== pinned[k].ts ? ' [ts]' : ''}`);
  }
  for (const k of Object.keys(pinned)) if (!(k in got)) missing.push(k);
  const report = [
    moved.length && `output moved (${moved.length}):\n  ${moved.slice(0, 40).join('\n  ')}`,
    unpinned.length && `not in the manifest (${unpinned.length}):\n  ${unpinned.slice(0, 20).join('\n  ')}`,
    missing.length && `in the manifest but gone (${missing.length}):\n  ${missing.slice(0, 20).join('\n  ')}`,
  ].filter(Boolean).join('\n');
  expect(report, report + '\n\nReview the moved output (bun scripts/consumer-diff.mjs <ref>), then accept it with bun run corpus.').toBe('');
}, 120_000);
