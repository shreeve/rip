#!/usr/bin/env node

import fs from 'fs';
import * as CoffeeScript from './lib/coffeescript/coffeescript.js';

console.log('Rebuilding nodes.js from nodes.coffee...');

const source = fs.readFileSync('src/nodes.coffee', 'utf8');
const compiled = CoffeeScript.compile(source, {
  bare: true,
  filename: 'src/nodes.coffee'
});

fs.writeFileSync('lib/coffeescript/nodes.js', compiled);
console.log('Done!');
