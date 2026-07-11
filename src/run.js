// Run-mode harness — the entry module the CLI actually hands to Bun:
//
//   bun --preload=src/loader.js src/run.js <entry.rip> [args...]
//
// The .rip entry loads via dynamic import, which routes it through the
// loader plugin like any other module (plugins are always consulted for
// imports — only the process ENTRY file is skipped when a cwd bunfig
// carries its own preload list). The harness owns error display because
// Bun's own reporter prints plugin-loaded modules' frames at
// GENERATED-JS coordinates (see src/stackmap.js): every uncaught error
// — module-evaluation throw, later uncaught exception, unhandled
// rejection — prints here with its .rip frames remapped to true source
// positions, and the process exits 1 (Bun's own uncaught exit status).
// Compile failures print the CompileError's formatted diagnostic alone;
// a harness stack under it would be noise.
//
// Entry fidelity: process.argv and Bun.main are rewritten so the .rip
// file observes itself as the program (argv[1] is the entry, script
// args follow). Handlers registered by the entry's own code win: the
// harness fallbacks step aside whenever another listener exists.

import { realpathSync } from 'fs';
import { pathToFileURL } from 'url';
import { CompileError } from './compile.js';
import { remapStack } from './stackmap.js';

const entry = realpathSync(process.argv[2]);
process.argv = [process.argv[0], entry, ...process.argv.slice(3)];
Bun.main = entry;

const report = (err) => {
  if (err instanceof CompileError) {
    console.error(err.message);
  } else {
    console.error(remapStack(err?.stack ?? String(err)));
  }
  process.exit(1);
};

process.on('uncaughtException', (err) => {
  if (process.listeners('uncaughtException').length > 1) return;
  report(err);
});
process.on('unhandledRejection', (reason) => {
  if (process.listeners('unhandledRejection').length > 1) return;
  report(reason);
});

try {
  await import(pathToFileURL(entry).href);
} catch (err) {
  report(err);
}
