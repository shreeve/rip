#!/usr/bin/env bun
// Shared VS Code extension installer (the repo grows more
// extensions than one — "Rip Print" is next).
//
//   bun run ext <name> <editor>
//   e.g.  bun run ext rip cursor | bun run ext rip vscode | bun run ext rip both
//
// ALL install logic lives here: build the .vsix through the package's
// own `package` script (packaging stays per-package; installing is
// shared), then install via the editor CLI — located on PATH first,
// then at the well-known app locations. No silent failure: a missing
// CLI reports precisely how to fix it and where the built .vsix is, so
// the UI route ("Extensions: Install from VSIX…") always remains.
//
// The registry maps PRODUCT names to package directories — never
// directory names, so `rip` → packages/vscode never collides with the
// editor name. A future extension registers itself by adding one line.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── The registry ────────────────────────────────────────────────────
const EXTENSIONS = {
  rip: 'packages/vscode',
  // print: 'packages/print/vscode',   ← the shape of the next entry
};

// Editor CLIs: PATH name + the app-bundle fallbacks worth checking.
const EDITORS = {
  vscode: {
    cli: 'code',
    fallbacks: [
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      path.join(os.homedir(), 'Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'),
      '/usr/share/code/bin/code',
      '/usr/local/bin/code',
    ],
    enableHint: 'open VS Code and run "Shell Command: Install \'code\' command in PATH" from the command palette',
  },
  cursor: {
    cli: 'cursor',
    fallbacks: [
      '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
      path.join(os.homedir(), 'Applications/Cursor.app/Contents/Resources/app/bin/cursor'),
      '/usr/local/bin/cursor',
    ],
    enableHint: 'open Cursor and run "Shell Command: Install \'cursor\' command in PATH" from the command palette',
  },
};

function usage() {
  console.log('Usage: bun run ext <name> <editor>');
  console.log('');
  console.log('  Registered extensions:');
  for (const [name, dir] of Object.entries(EXTENSIONS)) {
    console.log(`    ${name.padEnd(10)} → ${dir}`);
  }
  console.log('');
  console.log(`  Editors: ${[...Object.keys(EDITORS), 'both'].join(' | ')}`);
  console.log('');
  console.log('  Examples: bun run ext rip cursor');
  console.log('            bun run ext rip both');
}

function findEditorCli(editorName) {
  const editor = EDITORS[editorName];
  const onPath = Bun.which(editor.cli);
  if (onPath) return onPath;
  for (const candidate of editor.fallbacks) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const [name, editorArg] = process.argv.slice(2);
const editorNames = editorArg === 'both' ? Object.keys(EDITORS) : [editorArg];
if (!EXTENSIONS[name] || !editorArg || (editorArg !== 'both' && !EDITORS[editorArg])) {
  usage();
  process.exit(name || editorArg ? 1 : 0);
}

const pkgDir = path.join(repoRoot, EXTENSIONS[name]);

// Dependencies first (the packaging script needs them and says so, but
// installing from the committed lockfile is the obvious next step — do
// it rather than instruct it).
if (!fs.existsSync(path.join(pkgDir, 'node_modules'))) {
  console.log(`→ installing dependencies in ${EXTENSIONS[name]} (frozen lockfile)`);
  const r = spawnSync('bun', ['install', '--frozen-lockfile'], { cwd: pkgDir, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Build the .vsix through the package's own script.
console.log(`→ packaging ${name} (${EXTENSIONS[name]})`);
const build = spawnSync('bun', ['run', 'package'], { cwd: pkgDir, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const vsix = fs.readdirSync(pkgDir)
  .filter((f) => f.endsWith('.vsix'))
  .map((f) => ({ f, mtime: fs.statSync(path.join(pkgDir, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)[0]?.f;
if (!vsix) {
  console.error(`no .vsix found in ${pkgDir} after packaging`);
  process.exit(1);
}
const vsixPath = path.join(pkgDir, vsix);

let failed = false;
for (const editorName of editorNames) {
  const cli = findEditorCli(editorName);
  if (!cli) {
    console.error(`✗ ${editorName}: no CLI found (looked for \`${EDITORS[editorName].cli}\` on PATH and at the app locations).`);
    console.error(`  Fix: ${EDITORS[editorName].enableHint},`);
    console.error(`  or install manually: "Extensions: Install from VSIX…" → ${vsixPath}`);
    failed = true;
    continue;
  }
  console.log(`→ installing into ${editorName} (${cli})`);
  const r = spawnSync(cli, ['--install-extension', vsixPath, '--force'], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`✗ ${editorName}: install failed (exit ${r.status})`);
    failed = true;
  } else {
    console.log(`✓ ${editorName}: installed ${vsix}`);
  }
}
process.exit(failed ? 1 : 0);
