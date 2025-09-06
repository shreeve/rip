import * as CoffeeScript from './lib-esm/coffeescript/index.js';
import fs from 'fs';
import path from 'path';

// Simple test runner
const testFile = './test/arrays.coffee';
const code = fs.readFileSync(testFile, 'utf8');

try {
  const js = CoffeeScript.compile(code, { filename: testFile });
  console.log('Compiled successfully!');
  console.log('First 200 chars:', js.substring(0, 200));
} catch (error) {
  console.error('Compilation error:', error.message);
}
