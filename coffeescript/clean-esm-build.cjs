#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('Cleaning ESM build...');

// Fix coffeescript.js
let coffee = fs.readFileSync('lib/coffeescript/coffeescript.js', 'utf8');

// Remove malformed line
coffee = coffee.replace(/^\s*exports\.const.*export const.*$/gm, '');

// Remove duplicate exports
const lines = coffee.split('\n');
const seen = new Set();
const cleaned = [];

for (let line of lines) {
  // Skip duplicate export declarations
  if (line.match(/^\s*export\s+const\s+(\w+)\s*=\s*\1;?\s*$/)) {
    const name = RegExp.$1;
    if (seen.has(name)) continue;
    seen.add(name);
  }
  cleaned.push(line);
}

fs.writeFileSync('lib/coffeescript/coffeescript.js', cleaned.join('\n'));

// Update all other scripts to use lib/ instead of lib-esm/
const files = [
  'fix-esm.cjs',
  'rebuild-esm.mjs',
  'test-runner.mjs',
  'test-index-compile.mjs'
];

for (const file of files) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(/lib-esm\//g, 'lib/');
    fs.writeFileSync(file, content);
  }
}

console.log('ESM build cleaned!');
