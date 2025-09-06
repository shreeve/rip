#!/usr/bin/env node

import fs from 'fs';
import * as CoffeeScript from './lib/coffeescript/coffeescript.js';

console.log('Rebuilding index.js from index.coffee...');

const source = fs.readFileSync('src/index.coffee', 'utf8');
const compiled = CoffeeScript.compile(source, {
  bare: true,
  filename: 'src/index.coffee'
});

fs.writeFileSync('lib/coffeescript/index.js', compiled);
console.log('Done!');
