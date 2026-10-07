// The runtime loader serves a stdlib package's files by path: an import
// of `rip/<pkg>/<path>.rip` lands on that file with no exports key for
// it, and a file under the package's test tree is not served.
import { test, expect, afterAll } from 'bun:test';
import { spawnSync } from '../../support/spawn.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

const RIP = path.resolve(import.meta.dir, '..', '..', '..', 'bin', 'rip');
const NEUTRAL = fs.realpathSync(os.tmpdir());

const made = [];
afterAll(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

// A checkout is known by rip's own editor package. The fixture package
// exports its entry alone and holds one module by path and one under test/.
function makeCheckout() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rip-paths-')));
  made.push(root);
  fs.mkdirSync(path.join(root, 'packages', 'vscode'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages', 'vscode', 'package.json'), JSON.stringify({ name: 'vscode-rip' }));
  const pkg = path.join(root, 'packages', 'zzpath');
  fs.mkdirSync(path.join(pkg, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(pkg, 'test'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@rip/zzpath', exports: { '.': './zzpath.rip' } }));
  fs.writeFileSync(path.join(pkg, 'zzpath.rip'), "export entry = 'entry'\n");
  fs.writeFileSync(path.join(pkg, 'lib', 'extra.rip'), "export extra = 'by path'\n");
  fs.writeFileSync(path.join(pkg, 'test', 'hidden.rip'), "export hidden = 'hidden'\n");
  return root;
}

const run = (root, name, source) => {
  fs.writeFileSync(path.join(root, name), source);
  return spawnSync(RIP, [path.join(root, name)], { cwd: NEUTRAL, encoding: 'utf8', env: process.env });
};

test('a module under a stdlib package imports by its path with no exports key', () => {
  const root = makeCheckout();
  const out = run(root, 'entry.rip', "import { extra } from 'rip/zzpath/lib/extra.rip'\nconsole.log extra\n");
  expect(out.stdout.trim()).toBe('by path');
  expect(out.status).toBe(0);
});

test('a module under a package\'s test tree is not served', () => {
  const root = makeCheckout();
  const out = run(root, 'hidden.rip', "import { hidden } from 'rip/zzpath/test/hidden.rip'\nconsole.log hidden\n");
  expect(out.status).not.toBe(0);
  expect(out.stdout.trim()).toBe('');
});
