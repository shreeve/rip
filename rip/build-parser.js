#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import Solar from './lib/solar.js';
import { grammar } from './lib/grammar-solar.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// First compile the grammar if needed
console.log("Compiling grammar-solar.rip...");
execSync('coffee -c -b -o lib/ src/grammar-solar.rip', { cwd: __dirname });

// Generate the parser
console.log("Generating parser...");
const generator = new Solar.Generator(grammar, { debug: false });

// Generate the full parser module
let parserCode = generator.generate();

// Wrap in ESM export
parserCode = parserCode + '\n\n// ESM export\nexport default parser;\n';

// Write to file
const outputPath = path.join(__dirname, 'lib/parser.js');
fs.writeFileSync(outputPath, parserCode);

console.log(`Parser generated: ${outputPath}`);
console.log(`Parser size: ${(parserCode.length / 1024).toFixed(2)} KB`);

// Show a sample of the state table
const lines = parserCode.split('\n');
const tableStart = lines.findIndex(line => line.includes('parseTable:'));
if (tableStart >= 0) {
  console.log('\nState table preview:');
  console.log(lines.slice(tableStart, tableStart + 3).join('\n'));
}
