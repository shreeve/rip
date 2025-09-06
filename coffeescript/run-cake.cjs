#!/usr/bin/env node

// Temporary CommonJS runner for Cakefile
const fs = require('fs');
const path = require('path');
const CoffeeScript = require('./lib/coffeescript');

// Find and run the Cakefile
const cakefilePath = path.join(process.cwd(), 'Cakefile');
if (!fs.existsSync(cakefilePath)) {
  console.error('Cakefile not found in current directory');
  process.exit(1);
}

// Read and compile the Cakefile
const cakefileContent = fs.readFileSync(cakefilePath, 'utf8');
const compiledCode = CoffeeScript.compile(cakefileContent, {
  filename: 'Cakefile',
  bare: true
});

// Run the compiled code
eval(compiledCode);

// Run the task
const taskName = process.argv[2] || 'build';
if (global[taskName]) {
  global[taskName]();
} else {
  console.error(`Task '${taskName}' not found`);
  process.exit(1);
}
