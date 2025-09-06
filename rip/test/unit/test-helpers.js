/**
 * Shared test helpers for unit tests
 * Handles the CoffeeScript-to-ESM conversion once
 */

import fs from 'fs';
import { execSync } from 'child_process';

// Cache of already processed modules
const processedModules = new Set();

export async function ensureESMExports() {
  // Only run once per test run
  if (processedModules.size > 0) return;
  
  // Always start fresh - recompile from source
  execSync('coffee -c -b -o lib/ src/', { stdio: 'ignore' });
  
  // Convert each module
  const modules = ['lexer', 'rewriter', 'compiler'];
  
  for (const moduleName of modules) {
    const modulePath = `./lib/${moduleName}.js`;
    
    if (!fs.existsSync(modulePath)) continue;
    
    let js = fs.readFileSync(modulePath, 'utf-8');
    
    // Skip if already has proper exports
    if (js.includes('export default') && js.includes('export {')) {
      processedModules.add(moduleName);
      continue;
    }
    
    // Fix class declarations
    js = js.replace(/var\s+(\w+);?\s*\1\s*=\s*class\s+\1/g, 'const $1 = class $1');
    
    // Remove CommonJS exports
    js = js.replace(/module\.exports = (\w+);/, '');
    
    // Add ESM exports only if completely missing
    if (!js.includes('export default') && !js.includes('export {')) {
      const className = moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
      js += `\nexport default ${className};\nexport { ${className} };`;
    }
    
    fs.writeFileSync(modulePath, js);
    processedModules.add(moduleName);
  }
}

export async function loadModule(moduleName) {
  await ensureESMExports();
  return import(`../../lib/${moduleName}.js`);
}