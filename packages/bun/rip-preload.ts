#!/usr/bin/env bun
/**
 * Rip Preload Entry - ensures the Rip transpiler is loaded, then runs a target script.
 * Usage:
 *   bun packages/bun/rip-preload.ts <target-path> [args...]
 * If no target is provided, defaults to packages/server/rip-server.ts
 */

import { spawn } from 'bun';

const hasPreload = process.argv.some(arg => arg.includes('rip-bun.ts'));
const argv = process.argv.slice(2);
// If the first arg looks like a script path (*.ts/*.js) treat it as target, else default to rip-server.ts
let target = './packages/server/rip-server.ts';
let rest = argv;
if (argv[0] && /\.(ts|js|rip)$/i.test(argv[0])) {
  target = argv[0];
  rest = argv.slice(1);
}

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
