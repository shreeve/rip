#!/usr/bin/env node

const fs = require('fs');

let coffee = fs.readFileSync('lib/coffeescript/coffeescript.js', 'utf8');

// Add const to all undefined variables
const varsToFix = ['header', 'footer', 'answer', 'v3SourceMap'];

for (const varName of varsToFix) {
  const regex = new RegExp(`^(\\s+)${varName} = `, 'gm');
  coffee = coffee.replace(regex, `$1const ${varName} = `);
}

fs.writeFileSync('lib/coffeescript/coffeescript.js', coffee);
console.log('Fixed all variable declarations');
