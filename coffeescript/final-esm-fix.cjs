#!/usr/bin/env node

const fs = require('fs');

console.log('Applying final ESM fixes...');

// Fix coffeescript.js
let coffee = fs.readFileSync('lib/coffeescript/coffeescript.js', 'utf8');

// Add missing variable declarations
coffee = coffee.replace(/^(\s+)args = /gm, '$1const args = ');
coffee = coffee.replace(/^(\s+)ref = /gm, '$1const ref = ');

fs.writeFileSync('lib/coffeescript/coffeescript.js', coffee);

console.log('Final fixes applied!');
