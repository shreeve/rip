import { beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A conversion of v3's test/ssh.rip, which drove a live `ssh trust`
// session (mc, a :pure escape send at the Hint: prompt, exit).
// Script.ssh execs the `ssh` binary found on PATH, so the flow is
// tested through that seam: a stub `ssh` records its argv, plays the
// password prompt, reports the PTY size, and echoes each exchange in a
// parseable form. Bun.spawn resolves PATH from the process's startup
// environment (runtime process.env mutations are not seen), so the
// conversation runs in a subprocess (test/ssh-driver.mjs) whose env
// carries the stub directory — the same pattern as x12's cli.test.js.

const stub = `#!/bin/bash
printf 'ARGS[%s]\\n' "$*"
if [ "$1" = "-p" ]; then
  printf 'Password: '
  IFS= read -r pw
  printf 'PW[%s]\\n' "$pw"
fi
printf 'SIZE[%s]\\n' "$(stty size)"
printf '~> '
IFS= read -r cmd
printf 'CMD[%s]\\n' "$cmd"
printf 'Hint: '
IFS= read -r -n 2 -d '' raw
printf 'RAW[%s]\\n' "$(printf '%s' "$raw" | xxd -p)"
printf '~> '
IFS= read -r bye
printf 'BYE[%s]\\n' "$bye"
`;

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const loader = join(pkgDir, '..', '..', 'src', 'loader.js');
const driver = join(pkgDir, 'test', 'ssh-driver.mjs');

let stubDir;

beforeAll(() => {
  stubDir = mkdtempSync(join(tmpdir(), 'rip-script-ssh-'));
  const bin = join(stubDir, 'ssh');
  writeFileSync(bin, stub);
  chmodSync(bin, 0o755);
});

const drive = (url, opts = {}) => {
  const r = spawnSync(
    process.execPath,
    ['--preload', loader, driver, url, JSON.stringify(opts)],
    {
      encoding: 'utf8',
      cwd: pkgDir,
      env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}` },
      timeout: 20000,
    },
  );
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout);
};

describe('Script.ssh', () => {
  // The 1:1 conversion of ssh.rip: a bare host alias, cols/rows options,
  // the mc/Hint/exit dance with a raw :pure escape send.
  test('bare host alias: mc, :pure escape at Hint:, exit', () => {
    const seen = drive('trust', { cols: 120, rows: 32 });
    expect(seen).toContain('ARGS[trust]');    // bare alias, no flags
    expect(seen).toContain('SIZE[32 120]');   // rows cols from options
    expect(seen).toContain('CMD[mc]');
    expect(seen).toContain('RAW[1b30]');      // ESC + '0', no line terminator
    expect(seen).toContain('BYE[exit]');
  });

  // Added coverage: the ssh:// URL form — port, user, and password are
  // parsed from the URL (percent-decoded), and the password answers the
  // Password prompt before Script.ssh returns.
  test('ssh:// URL form parses port, user, and password', () => {
    const seen = drive('ssh://user%40x:s3cret%21@myhost:2222');
    expect(seen).toContain('ARGS[-p 2222 -l user@x myhost]');
    expect(seen).toContain('PW[s3cret!]');    // percent-decoded password
    expect(seen).toContain('CMD[mc]');
    expect(seen).toContain('RAW[1b30]');
    expect(seen).toContain('BYE[exit]');
  });
});
