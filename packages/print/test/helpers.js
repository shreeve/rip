// Shared harness for the rip-print tests.
//
// print.rip is a pure CLI: it highlights the requested files, serves
// the result ONCE on http://localhost:9111/, opens a browser, and
// exits after the first request. The tests run it as a real
// subprocess with a stub `open`/`xdg-open`/`start` first on PATH (so
// no browser ever launches), fetch the served page, and wait for the
// process to exit on its own.
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const pkgDir = fileURLToPath(new URL('..', import.meta.url));
export const printRip = join(pkgDir, 'print.rip');
export const loader = join(pkgDir, '..', '..', 'src', 'loader.js');
export const binPath = join(pkgDir, 'bin', 'rip-print');
export const fixtures = join(pkgDir, 'test', 'fixtures');

const URL_SERVED = 'http://localhost:9111/';

// A PATH prefix whose `open` (and friends) are no-ops.
const stubBrowserDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'rip-print-stub-'));
  for (const name of ['open', 'xdg-open', 'start']) {
    const path = join(dir, name);
    writeFileSync(path, '#!/bin/sh\nexit 0\n');
    chmodSync(path, 0o755);
  }
  return dir;
};

const stubDir = stubBrowserDir();
export const stubbedEnv = { ...process.env, PATH: `${stubDir}:${process.env.PATH}` };

// Run the CLI to completion for non-serving paths (-v, -h, errors).
export const run = (args, cwd = fixtures) =>
  Bun.spawnSync([process.execPath, '--preload', loader, printRip, ...args], {
    cwd,
    env: stubbedEnv,
  });

// Run the CLI, fetch the served page, and wait for the self-exit.
export const serve = async (args, cwd = fixtures) => {
  const proc = Bun.spawn([process.execPath, '--preload', loader, printRip, ...args], {
    cwd,
    env: stubbedEnv,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let html = null;
  let headers = null;
  for (let i = 0; i < 200; i++) {
    try {
      const res = await fetch(URL_SERVED);
      headers = res.headers;
      html = await res.text();
      break;
    } catch {
      await Bun.sleep(50);
    }
  }
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { html, headers, stdout, stderr, exitCode };
};

// A scratch tree for file-discovery tests.
export const scratchTree = () => {
  const dir = mkdtempSync(join(tmpdir(), 'rip-print-tree-'));
  const write = (rel, content = 'x') => {
    const path = join(dir, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
    return path;
  };
  return { dir, write };
};
