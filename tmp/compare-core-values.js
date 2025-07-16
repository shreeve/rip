const fs = require('fs');

// Load parser files
const jisonCode = fs.readFileSync('lib/coffeescript/parser-jison.js', 'utf8');
const sonarCode = fs.readFileSync('lib/coffeescript/parser.js', 'utf8');

console.log('=== Comparing Core Parser Values ===\n');

// 1. Check specific symbol mappings
console.log('1. Symbol Mappings:');
const symbolTests = [
  ['Root', 3],
  ['IDENTIFIER', 39],
  ['TERMINATOR', 6],
  ['error', 2]
];

for (const [symbol, expectedId] of symbolTests) {
  const jisonHas = jisonCode.includes(`"${symbol}":${expectedId}`);
  const sonarHas = sonarCode.includes(`"${symbol}":${expectedId}`);
  console.log(`   "${symbol}":${expectedId} - Jison: ${jisonHas ? '✓' : '✗'}, Sonar: ${sonarHas ? '✓' : '✗'}`);
}

// 2. Check specific terminal mappings
console.log('\n2. Terminal Mappings:');
const terminalTests = [
  [6, 'TERMINATOR'],
  [39, 'IDENTIFIER'],
  [44, 'NUMBER'],
  [46, 'STRING']
];

for (const [id, terminal] of terminalTests) {
  const jisonHas = jisonCode.includes(`${id}:"${terminal}"`);
  const sonarHas = sonarCode.includes(`${id}:"${terminal}"`);
  console.log(`   ${id}:"${terminal}" - Jison: ${jisonHas ? '✓' : '✗'}, Sonar: ${sonarHas ? '✓' : '✗'}`);
}

// 3. Check specific productions
console.log('\n3. Production Rules:');
const productionTests = [
  '[0,[3,0]]',  // First production
  '[3,1]',      // Root production
  '[4,1]',      // Body production
  '[103,2]'     // Last production
];

for (const prod of productionTests) {
  const jisonHas = jisonCode.includes(prod);
  const sonarHas = sonarCode.includes(prod);
  console.log(`   ${prod} - Jison: ${jisonHas ? '✓' : '✗'}, Sonar: ${sonarHas ? '✓' : '✗'}`);
}

// 4. Count production array entries by looking for patterns
console.log('\n4. Production Count Estimation:');
// Count by looking for the pattern ],[ which separates productions
const jisonProdCount = (jisonCode.match(/productions_:.*?\]/s)?.[0].match(/\],\[/g) || []).length + 1;
const sonarProdCount = (sonarCode.match(/productionTable:.*?\]/s)?.[0].match(/\],\[/g) || []).length + 1;
console.log(`   Jison productions: ~${jisonProdCount}`);
console.log(`   Sonar productions: ~${sonarProdCount}`);

// 5. Extract exact variable names used
console.log('\n5. Variable Names:');
console.log('   Jison uses:');
console.log('     - symbols_');
console.log('     - terminals_');
console.log('     - productions_');
console.log('     - table');
console.log('     - defaultActions');
console.log('   Sonar uses:');
console.log('     - symbolMap (equivalent to symbols_)');
console.log('     - terminals_');
console.log('     - productionTable (equivalent to productions_)');
console.log('     - stateTable (equivalent to table)');
console.log('     - defaultActions');

console.log('\n=== Conclusion ===');
console.log('Based on the spot checks above, verify that:');
console.log('1. Symbol mappings match between symbols_ and symbolMap');
console.log('2. Terminal mappings match in both terminals_');
console.log('3. Production rules match between productions_ and productionTable');
console.log('4. The parsers have the same grammar structure');