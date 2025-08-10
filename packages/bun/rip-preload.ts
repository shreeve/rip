#!/usr/bin/env bun
/**
 * Rip Preload Entry - ensures the Rip transpiler is loaded, then runs a target script.
 * Usage:
 *   bun packages/bun/rip-preload.ts <target-path> [args...]
 * If no target is provided, defaults to packages/server/rip-server.ts
 */

import { spawn } from 'bun';

const hasPreload = process.argv.some(arg => arg.includes('rip-bun.ts'));
const [maybeTarget, ...rest] = process.argv.slice(2);
const target = maybeTarget || './packages/server/rip-server.ts';

if (!hasPreload) {
  console.log('🔄 Restarting with Rip transpiler...');
  const result = spawn([
    'bun',
    '--preload', './packages/bun/rip-bun.ts',
    target,
    ...rest,
  ], { stdio: ['inherit', 'inherit', 'inherit'] });
  process.exit(await result.exited);
} else {
  await import(target);
}
