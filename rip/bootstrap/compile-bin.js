#!/usr/bin/env bun
// Compile the bin/rip.rip file

import RipBootstrap from './bootstrap.js';

async function main() {
  const bootstrap = new RipBootstrap();
  
  console.log('Compiling bin/rip.rip...');
  await bootstrap.compileFile('bin/rip.rip', 'bin/rip.js');
  
  console.log('Done!');
}

main();
