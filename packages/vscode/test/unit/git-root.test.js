// The mirror's anchor. The editor's folder is wherever a person happened
// to open; the mirror belongs to the repository that folder is in, so
// one checkout collects one `.rip/editor` instead of one per opened
// subdirectory.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { realpathSync } from 'node:fs';
import { gitRootFor } from '../../src/mirror.js';

const scratch = () => realpathSync(mkdtempSync(join(tmpdir(), 'rip-gitroot-')));

test('a subdirectory answers the repository root, however deep', () => {
  const root = scratch();
  try {
    mkdirSync(join(root, '.git'));
    const deep = join(root, 'test', 'corpus');
    mkdirSync(deep, { recursive: true });
    expect(gitRootFor(deep)).toBe(root);
    expect(gitRootFor(join(root, 'packages', 'pdf'))).toBe(root);
    // the root is its own answer
    expect(gitRootFor(root)).toBe(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a worktree or submodule checkout counts — .git is a FILE there', () => {
  const root = scratch();
  try {
    writeFileSync(join(root, '.git'), 'gitdir: /elsewhere/.git/worktrees/w\n');
    const deep = join(root, 'a', 'b');
    mkdirSync(deep, { recursive: true });
    expect(gitRootFor(deep)).toBe(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the NEAREST repository wins, so a nested checkout keeps its own mirror', () => {
  const root = scratch();
  try {
    mkdirSync(join(root, '.git'));
    const inner = join(root, 'vendor', 'thing');
    mkdirSync(join(inner, '.git'), { recursive: true });
    const deep = join(inner, 'src');
    mkdirSync(deep, { recursive: true });
    expect(gitRootFor(deep)).toBe(inner);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('outside a repository the answer is null, and the caller keeps its own directory', () => {
  const root = scratch();
  try {
    const deep = join(root, 'no', 'repo', 'here');
    mkdirSync(deep, { recursive: true });
    // A scratch dir under the system temp root has no .git above it.
    expect(gitRootFor(deep)).toBeNull();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
