#!/usr/bin/env bun
/**
 * Rip Server Wrapper - Ensures Rip transpiler is loaded
 * This wrapper re-executes the server with --preload to enable Rip transpilation
 */

import { spawn } from 'bun';

// Check if we're already running with preload
const hasPreload = process.argv.some(arg => arg.includes('rip-bun.ts'));

if (!hasPreload) {
  console.log('🔄 Restarting with Rip transpiler...');
  
  // Re-execute with preload
  const result = spawn([
    'bun',
    '--preload', './packages/bun/rip-bun.ts',
    './packages/server/rip-server.ts',
    ...process.argv.slice(2)
  ], {
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  
  process.exit(await result.exited);
} else {
  // We're already running with preload, load the actual server
  await import('./rip-server.ts');
}
