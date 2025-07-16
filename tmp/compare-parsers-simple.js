const fs = require('fs');

// Load both parser files
const jisonCode = fs.readFileSync('lib/coffeescript/parser-jison.js', 'utf8');
const sonarCode = fs.readFileSync('lib/coffeescript/parser.js', 'utf8');

// Find the actual parser object definitions
const jisonParserStart = jisonCode.indexOf('var parser = {trace:');
const jisonParserSection = jisonCode.substring(jisonParserStart);

const sonarParserStart = sonarCode.indexOf('var parser = {');
const sonarParserSection = sonarCode.substring(sonarParserStart);

// Extract symbols_/symbolMap
console.log('=== Extracting symbols_/symbolMap ===');

// For jison, find the real symbols_ (not the placeholder)
const jisonSymbolsMatch = jisonParserSection.match(/symbols_:\s*(\{[^}]+\})/);
if (jisonSymbolsMatch) {
  const jisonSymbols = JSON.parse(jisonSymbolsMatch[1]);
  console.log('Jison symbols_: Found', Object.keys(jisonSymbols).length, 'entries');
}

// For sonar
const sonarSymbolsMatch = sonarParserSection.match(/symbolMap:\s*(\{[^}]+\})/);
if (sonarSymbolsMatch) {
  const sonarSymbols = JSON.parse(sonarSymbolsMatch[1]);
  console.log('Sonar symbolMap: Found', Object.keys(sonarSymbols).length, 'entries');

  // Compare if both found
  if (jisonSymbolsMatch) {
    const jisonSymbols = JSON.parse(jisonSymbolsMatch[1]);
    if (JSON.stringify(jisonSymbols) === JSON.stringify(sonarSymbols)) {
      console.log('✓ symbolMap matches symbols_');
    } else {
      console.log('✗ symbolMap does NOT match symbols_');
    }
  }
}

// Extract terminals_
console.log('\n=== Extracting terminals_ ===');

const jisonTerminalsMatch = jisonParserSection.match(/terminals_:\s*(\{[^}]+\})/);
if (jisonTerminalsMatch) {
  const jisonTerminals = JSON.parse(jisonTerminalsMatch[1]);
  console.log('Jison terminals_: Found', Object.keys(jisonTerminals).length, 'entries');
}

const sonarTerminalsMatch = sonarParserSection.match(/terminals_:\s*(\{[^}]+\})/);
if (sonarTerminalsMatch) {
  const sonarTerminals = JSON.parse(sonarTerminalsMatch[1]);
  console.log('Sonar terminals_: Found', Object.keys(sonarTerminals).length, 'entries');

  if (jisonTerminalsMatch) {
    const jisonTerminals = JSON.parse(jisonTerminalsMatch[1]);
    if (JSON.stringify(jisonTerminals) === JSON.stringify(sonarTerminals)) {
      console.log('✓ terminals_ matches');
    } else {
      console.log('✗ terminals_ does NOT match');
    }
  }
}

// Extract productions_/productionTable
console.log('\n=== Extracting productions_/productionTable ===');

// Extract full array by finding the closing bracket
function extractArray(text, varName) {
  const start = text.indexOf(varName + ':');
  if (start === -1) return null;

  let pos = start + varName.length + 1;
  while (text[pos] === ' ') pos++;

  if (text[pos] !== '[') return null;

  let depth = 0;
  let arrayStart = pos;

  for (let i = pos; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']') {
      depth--;
      if (depth === 0) {
        return text.substring(arrayStart, i + 1);
      }
    }
  }
  return null;
}

const jisonProductionsStr = extractArray(jisonParserSection, 'productions_');
const sonarProductionsStr = extractArray(sonarParserSection, 'productionTable');

if (jisonProductionsStr && sonarProductionsStr) {
  try {
    const jisonProductions = JSON.parse(jisonProductionsStr);
    const sonarProductions = JSON.parse(sonarProductionsStr);

    console.log('Jison productions_:', jisonProductions.length, 'entries');
    console.log('Sonar productionTable:', sonarProductions.length, 'entries');

    if (JSON.stringify(jisonProductions) === JSON.stringify(sonarProductions)) {
      console.log('✓ productionTable matches productions_');
    } else {
      console.log('✗ productionTable does NOT match productions_');

      // Find first difference
      for (let i = 0; i < Math.min(jisonProductions.length, sonarProductions.length); i++) {
        if (JSON.stringify(jisonProductions[i]) !== JSON.stringify(sonarProductions[i])) {
          console.log(`First difference at index ${i}:`);
          console.log('  Jison:', JSON.stringify(jisonProductions[i]));
          console.log('  Sonar:', JSON.stringify(sonarProductions[i]));
          break;
        }
      }
    }
  } catch (e) {
    console.log('Error parsing productions:', e.message);
  }
}

// Check state table sizes
console.log('\n=== State Table Sizes ===');
const jisonStateCount = (jisonParserSection.match(/table:\s*\{[^}]*\}/s) || [''])[0].split(/\d+:/).length - 1;
const sonarStateCount = (sonarParserSection.match(/stateTable:\s*\{[^}]*\}/s) || [''])[0].split(/\d+:/).length - 1;

console.log('Jison table states:', jisonStateCount);
console.log('Sonar stateTable states:', sonarStateCount);

// Check defaultActions
console.log('\n=== Default Actions ===');
const jisonDefaultsMatch = jisonParserSection.match(/defaultActions:\s*(\{[^}]*\})/);
const sonarDefaultsMatch = sonarParserSection.match(/defaultActions:\s*(\{[^}]*\})/);

if (jisonDefaultsMatch && sonarDefaultsMatch) {
  try {
    const jisonDefaults = JSON.parse(jisonDefaultsMatch[1]);
    const sonarDefaults = JSON.parse(sonarDefaultsMatch[1]);

    console.log('Jison defaultActions:', Object.keys(jisonDefaults).length, 'entries');
    console.log('Sonar defaultActions:', Object.keys(sonarDefaults).length, 'entries');

    if (JSON.stringify(jisonDefaults) === JSON.stringify(sonarDefaults)) {
      console.log('✓ defaultActions match exactly');
    } else {
      console.log('Note: defaultActions may differ due to optimization strategies');
    }
  } catch (e) {
    console.log('Could not parse defaultActions');
  }
}