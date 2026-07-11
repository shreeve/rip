// The cache key's compiler identity (src/hash.js): hashTree must see the
// WHOLE compiler tree — a nested module (src/runtime/*.js) changing has
// to change the hash, or a compiler upgrade would leave stale cached
// faces trusted (the review round's moderate #4: the original top-level
// hash let nested modules escape the key).
import { test, expect, describe } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashTree, hashText } from '../src/hash.js';

function makeTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-hashtree-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

const BASE = {
  'compile.js': 'export const compile = 1;\n',
  'runtime/reactive.js': 'export const r = 1;\n',
  'runtime/schema.js': 'export const s = 1;\n',
};

describe('hashTree (the compiler-build cache key)', () => {
  test('identical trees hash identically; text hashing is stable', () => {
    const a = makeTree(BASE);
    const b = makeTree(BASE);
    try {
      expect(hashTree(a)).toBe(hashTree(b));
      expect(hashText('x')).toBe(hashText('x'));
      expect(hashText('x')).not.toBe(hashText('y'));
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });

  test('a NESTED module change changes the hash (a compiler upgrade purges the cache)', () => {
    const dir = makeTree(BASE);
    try {
      const before = hashTree(dir);
      fs.writeFileSync(path.join(dir, 'runtime/reactive.js'), 'export const r = 2;\n');
      expect(hashTree(dir)).not.toBe(before);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('renames change the hash; test directories stay outside the identity', () => {
    const dir = makeTree(BASE);
    try {
      const before = hashTree(dir);
      fs.renameSync(path.join(dir, 'runtime/schema.js'), path.join(dir, 'runtime/schema2.js'));
      const renamed = hashTree(dir);
      expect(renamed).not.toBe(before);

      fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'test/x.test.js'), 'test file\n');
      expect(hashTree(dir)).toBe(renamed); // test/ is not the build
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
