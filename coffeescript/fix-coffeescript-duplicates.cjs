#!/usr/bin/env node

const fs = require('fs');

let code = fs.readFileSync('lib-esm/coffeescript/coffeescript.js', 'utf8');

// Track what's already been exported
const exportedNames = new Set();
const lines = code.split('\n');
const newLines = [];

for (const line of lines) {
  // Check for export const X = X patterns
  const match = line.match(/^\s*export\s+const\s+(\w+)\s*=\s*\1;?\s*$/);
  if (match) {
    const name = match[1];
    if (exportedNames.has(name)) {
      console.log(`Skipping duplicate export: ${name}`);
      continue; // Skip duplicate
    }
    exportedNames.add(name);
  }
  
  // Check for regular const declarations that might be exported elsewhere
  const constMatch = line.match(/^\s*const\s+(\w+)\s*=/);
  if (constMatch) {
    const name = constMatch[1];
    if (line.includes('export const')) {
      exportedNames.add(name);
    }
  }
  
  newLines.push(line);
}

fs.writeFileSync('lib-esm/coffeescript/coffeescript.js', newLines.join('\n'));
console.log('Fixed duplicates in coffeescript.js');
