// `rip file.rip` runs the file in a child Bun with the loader preloaded,
// and that child is the launcher's to keep and to end. Two ways a
// launcher used to leak it: a signal aimed at the launcher stopped at
// the launcher (Playwright ending the web server it started, a lane
// timeout), and a launcher whose parent vanished sat in a synchronous
// wait forever with the child still holding its port. Both are pinned
// against the real bin/rip so the shape cannot quietly return.
import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const BIN = join(ROOT, 'bin', 'rip');

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (predicate, ms) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(50);
  }
  return predicate();
};

// A script that announces its pid and then waits to be told to stop.
const lingering = (dir) => {
  const file = join(dir, 'linger.rip');
  writeFileSync(file, "console.log 'pid ' + process.pid\nsetInterval (-> null), 1000\n");
  return file;
};

// Launch bin/rip on the script; resolve with the launcher and the
// child's pid once the child has printed it.
const launch = (file, extra = {}) => new Promise((resolve, reject) => {
  const launcher = spawn('bun', [BIN, file], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], ...extra });
  let out = '';
  launcher.stdout.on('data', (chunk) => {
    out += chunk;
    const m = out.match(/pid (\d+)/);
    if (m) resolve({ launcher, child: Number(m[1]) });
  });
  launcher.once('error', reject);
  launcher.once('exit', () => reject(new Error(`launcher exited before the child spoke: ${out}`)));
});

describe('rip file.rip owns its child', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rip-owns-'));
  const file = lingering(dir);
  const cleanup = () => rmSync(dir, { recursive: true, force: true });

  test('SIGTERM to the launcher reaches the child, and the launcher exits with it', async () => {
    const { launcher, child } = await launch(file);
    expect(alive(child)).toBe(true);
    launcher.kill('SIGTERM');
    expect(await until(() => !alive(child), 3000)).toBe(true);
    expect(await until(() => launcher.exitCode !== null || launcher.signalCode !== null, 3000)).toBe(true);
  });

  test('a launcher whose parent vanished takes the child down', async () => {
    // Stand in for the vanished parent: a shell that starts the launcher
    // and is then killed outright, leaving the launcher reparented to
    // pid 1 — the shape Playwright's dead process leaves behind.
    const shell = spawn('sh', ['-c', `bun ${BIN} ${file} & echo shell $!; wait`], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    const child = await new Promise((resolve) => {
      shell.stdout.on('data', (chunk) => {
        out += chunk;
        const m = out.match(/pid (\d+)/);
        if (m) resolve(Number(m[1]));
      });
    });
    expect(alive(child)).toBe(true);
    shell.kill('SIGKILL');
    // The launcher polls its parent every 500ms; allow a few polls.
    expect(await until(() => !alive(child), 4000)).toBe(true);
    cleanup();
  });
});
