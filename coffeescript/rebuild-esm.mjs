#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import * as CoffeeScript from './lib-esm/coffeescript/coffeescript.js';

console.log('Building ESM version...');

// Create lib-esm directories
const dirs = ['lib-esm', 'lib-esm/coffeescript'];
for (const dir of dirs) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
}

// Copy and transform parser.js
console.log('Transforming parser.js...');
const parserSrc = fs.readFileSync('lib/coffeescript/parser.js', 'utf8');
let parserESM = parserSrc
  .replace(/\(function\s*\(\)\s*\{/, '')  // Remove IIFE start
  .replace(/\}\)\.call\(this\);?\s*$/, '') // Remove IIFE end
  .replace(/if \(typeof require[\s\S]*?exports\.main[^}]*\}/, ''); // Remove CJS exports

// Add ESM exports at the end
parserESM += '\nexport {parser, Parser};';
fs.writeFileSync('lib-esm/coffeescript/parser.js', parserESM);

// Compile source files
const srcFiles = fs.readdirSync('src').filter(f => f.endsWith('.coffee'));
for (const file of srcFiles) {
  if (file === 'grammar.coffee') continue; // Skip grammar
  
  console.log(`Compiling ${file}...`);
  const source = fs.readFileSync(`src/${file}`, 'utf8');
  
  try {
    const compiled = CoffeeScript.compile(source, {
      bare: true,
      filename: `src/${file}`
    });
    
    const outputFile = `lib-esm/coffeescript/${file.replace('.coffee', '.js')}`;
    fs.writeFileSync(outputFile, compiled);
  } catch (error) {
    console.error(`Error compiling ${file}:`, error.message);
  }
}

// Apply fixes
console.log('Applying ESM fixes...');
execSync('./fix-esm.cjs', { stdio: 'inherit' });

console.log('ESM build complete!');
