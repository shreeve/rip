// The consumer corpus: every program the repository holds — each tracked
// package module and each language-suite row's source — compiled on the
// JS face and the TS face, one hash per output. The manifest
// (test/corpus/consumers.json) pins those hashes, so any engine change
// that moves the output of real code fails loudly until the change is
// reviewed and the manifest regenerated (`bun run corpus`). The mutation
// runner's `observe` reads the same inputs, so a survivor it reports as
// observed is exactly one this gate kills.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBattery } from './battery.js';
import { ripFiles } from './rip-files.js';

// Tracked package modules, by repository-relative path.
export function packageInputs(root) {
  const proc = Bun.spawnSync(['git', 'ls-files', '-z', '--', 'packages/*.rip', 'packages/**/*.rip'], { cwd: root });
  if (proc.exitCode !== 0) throw new Error(`git ls-files failed in ${root}`);
  return new TextDecoder().decode(proc.stdout).split('\0').filter(Boolean).sort()
    .map((f) => ({ key: `pkg ${f}`, src: readFileSync(join(root, f), 'utf8'), path: f }));
}

// Language-suite rows, keyed by file, verb and name — never by position,
// so adding a row moves no other key. A repeated name takes an
// occurrence suffix.
export async function rowInputs(root) {
  const dir = join(root, 'test/rip');
  const inputs = [];
  for (const file of ripFiles(dir)) {
    const seen = new Map();
    for (const row of await loadBattery(join(dir, file))) {
      if (typeof row.src !== 'string') continue;
      const base = `row ${file} › ${row.verb} ${row.name}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      inputs.push({ key: n === 1 ? base : `${base} #${n}`, src: row.src, path: `<${file}>` });
    }
  }
  return inputs;
}

// One hash per face per input. A rejection hashes its first message line,
// so a moved or reworded error counts as moved output.
export function hashInputs(inputs, compile) {
  const out = {};
  for (const { key, src, path } of inputs) {
    const faces = {};
    for (const face of ['js', 'ts']) {
      let text;
      try {
        text = compile(src, { path, runtimeDelivery: 'none', ...(face === 'ts' ? { face: 'ts' } : {}) }).code;
      } catch (e) {
        text = `ERR ${String(e?.message ?? e).split('\n')[0]}`;
      }
      faces[face] = Bun.hash(text).toString(36);
    }
    out[key] = faces;
  }
  return out;
}

export const MANIFEST = 'test/corpus/consumers.json';
