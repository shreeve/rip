const fs = require('fs');

// Load parser files
const jisonCode = fs.readFileSync('lib/coffeescript/parser-jison.js', 'utf8');
const sonarCode = fs.readFileSync('lib/coffeescript/parser.js', 'utf8');

// Extract parser objects by evaluating them
let jisonParser, sonarParser;

try {
  // For jison parser, extract the parser object
  const jisonParserMatch = jisonCode.match(/var parser = ({[\s\S]*?});[\s\S]*?if \(typeof require/);
  if (jisonParserMatch) {
    // Remove functions for now to parse the data
    const jisonObj = jisonParserMatch[1]
      .replace(/performAction:[^,]*?^\}/m, 'performAction: null')
      .replace(/parseError:[^,]*?^\}/m, 'parseError: null')
      .replace(/parse:[^,]*?^\}/m, 'parse: null');

    eval('jisonParser = ' + jisonObj);
  }

  // For sonar parser
  const sonarParserMatch = sonarCode.match(/var parser = ({[\s\S]*?});/);
  if (sonarParserMatch) {
    // Remove functions for now to parse the data
    const sonarObj = sonarParserMatch[1]
      .replace(/performAction:[^,]*?^\}/m, 'performAction: null')
      .replace(/parseError:[^,]*?^\}/m, 'parseError: null')
      .replace(/parse:[^,]*?^\}/m, 'parse: null');

    eval('sonarParser = ' + sonarObj);
  }
} catch (e) {
  console.error('Error extracting parser objects:', e.message);
}

// Compare key variables
console.log('=== Parser Variable Comparison ===\n');

// 1. Compare symbols_/symbolMap
if (jisonParser && sonarParser) {
  const jisonSymbols = jisonParser.symbols_;
  const sonarSymbols = sonarParser.symbolMap;

  if (jisonSymbols && sonarSymbols) {
    console.log('1. Symbol Map (symbols_ vs symbolMap):');
    console.log('   Jison symbols_:', Object.keys(jisonSymbols).length, 'entries');
    console.log('   Sonar symbolMap:', Object.keys(sonarSymbols).length, 'entries');

    const symbolsMatch = JSON.stringify(jisonSymbols) === JSON.stringify(sonarSymbols);
    console.log('   Match:', symbolsMatch ? '✓ YES' : '✗ NO');

    if (!symbolsMatch) {
      // Sample comparison
      console.log('   Sample entries:');
      ['IDENTIFIER', 'TERMINATOR', 'Root', 'error'].forEach(key => {
        console.log(`     ${key}: Jison=${jisonSymbols[key]}, Sonar=${sonarSymbols[key]}`);
      });
    }
  }

  // 2. Compare terminals_
  console.log('\n2. Terminals:');
  const jisonTerminals = jisonParser.terminals_;
  const sonarTerminals = sonarParser.terminals_;

  if (jisonTerminals && sonarTerminals) {
    console.log('   Jison terminals_:', Object.keys(jisonTerminals).length, 'entries');
    console.log('   Sonar terminals_:', Object.keys(sonarTerminals).length, 'entries');

    const terminalsMatch = JSON.stringify(jisonTerminals) === JSON.stringify(sonarTerminals);
    console.log('   Match:', terminalsMatch ? '✓ YES' : '✗ NO');
  }

  // 3. Compare productions_/productionTable
  console.log('\n3. Productions (productions_ vs productionTable):');
  const jisonProductions = jisonParser.productions_;
  const sonarProductions = sonarParser.productionTable;

  if (jisonProductions && sonarProductions) {
    console.log('   Jison productions_:', jisonProductions.length, 'entries');
    console.log('   Sonar productionTable:', sonarProductions.length, 'entries');

    const productionsMatch = JSON.stringify(jisonProductions) === JSON.stringify(sonarProductions);
    console.log('   Match:', productionsMatch ? '✓ YES' : '✗ NO');

    if (!productionsMatch && jisonProductions.length === sonarProductions.length) {
      // Find first difference
      for (let i = 0; i < jisonProductions.length; i++) {
        if (JSON.stringify(jisonProductions[i]) !== JSON.stringify(sonarProductions[i])) {
          console.log(`   First difference at index ${i}:`);
          console.log(`     Jison: ${JSON.stringify(jisonProductions[i])}`);
          console.log(`     Sonar: ${JSON.stringify(sonarProductions[i])}`);
          break;
        }
      }
    }
  }

  // 4. Compare state table sizes
  console.log('\n4. State Tables:');
  const jisonTable = jisonParser.table;
  const sonarTable = sonarParser.stateTable;

  if (jisonTable && sonarTable) {
    console.log('   Jison table:', Object.keys(jisonTable).length, 'states');
    console.log('   Sonar stateTable:', Object.keys(sonarTable).length, 'states');
  }

  // 5. Compare defaultActions
  console.log('\n5. Default Actions:');
  const jisonDefaults = jisonParser.defaultActions;
  const sonarDefaults = sonarParser.defaultActions;

  if (jisonDefaults && sonarDefaults) {
    console.log('   Jison defaultActions:', Object.keys(jisonDefaults).length, 'entries');
    console.log('   Sonar defaultActions:', Object.keys(sonarDefaults).length, 'entries');
    console.log('   Note: These may differ due to optimization strategies');
  }

  console.log('\n=== Summary ===');
  console.log('The key parser data structures that must match are:');
  console.log('- Symbol mappings (symbols_/symbolMap)');
  console.log('- Terminal mappings (terminals_)');
  console.log('- Production rules (productions_/productionTable)');
  console.log('\nState tables and default actions may differ due to different optimization strategies.');
}