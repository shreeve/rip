/**
 * Shared test helpers for unit tests
 * Handles the CoffeeScript-to-ESM conversion once
 */

import fs from 'fs';
import { execSync } from 'child_process';

// Use a lock file to prevent race conditions
const lockFile = './lib/.conversion-lock';
let isConverting = false;

export async function ensureESMExports() {
  // If another process is converting, wait
  while (fs.existsSync(lockFile)) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  // Check if already converted
  try {
    const lexerContent = fs.readFileSync('./lib/lexer.js', 'utf-8');
    if (lexerContent.includes('export default Lexer') &&
        !lexerContent.match(/export default Lexer[\s\S]*export default Lexer/)) {
      // Already properly converted
      return;
    }
  } catch (e) {
    // File doesn't exist, need to compile
  }

  // Lock for conversion
  fs.writeFileSync(lockFile, 'converting');

  try {
    // Recompile from source to ensure clean state
    execSync('coffee -c -b -o lib/ src/', { stdio: 'ignore' });

    // Convert each module
    const modules = ['lexer', 'rewriter', 'compiler'];

    for (const moduleName of modules) {
      const modulePath = `./lib/${moduleName}.js`;

      if (!fs.existsSync(modulePath)) continue;

      let js = fs.readFileSync(modulePath, 'utf-8');

      // Fix class declarations
      js = js.replace(/var\s+(\w+);?\s*\1\s*=\s*class\s+\1/g, 'const $1 = class $1');

      // Remove CommonJS exports
      js = js.replace(/module\.exports = (\w+);/, '');

      // Add ESM exports if not present
      if (!js.includes('export default')) {
        const className = moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
        js += `\nexport default ${className};\nexport { ${className} };`;
      }

      fs.writeFileSync(modulePath, js);
    }
  } finally {
    // Remove lock
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
    }
  }
}

export async function loadModule(moduleName) {
  await ensureESMExports();
  return import(`../../lib/${moduleName}.js`);
}