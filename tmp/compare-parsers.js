const fs = require('fs');

// Load both parser files
const jisonCode = fs.readFileSync('lib/coffeescript/parser-jison.js', 'utf8');
const sonarCode = fs.readFileSync('lib/coffeescript/parser.js', 'utf8');

// Extract specific variables using regex
function extractVariable(code, varName) {
  // For simple objects/arrays
  const simpleMatch = new RegExp(varName + ':\\s*({[^}]+}|\\[[^\\]]+\\])').exec(code);
  if (simpleMatch) {
    try {
      return JSON.parse(simpleMatch[1]);
    } catch (e) {
      // Try eval if JSON.parse fails
      return eval('(' + simpleMatch[1] + ')');
    }
  }

  // For larger structures, extract between varName: and the next property
  const startIndex = code.indexOf(varName + ':');
  if (startIndex === -1) return null;

  let depth = 0;
  let inString = false;
  let stringChar = '';
  let start = startIndex + varName.length + 1;

  // Skip whitespace
  while (code[start] === ' ' || code[start] === '\n' || code[start] === '\t') start++;

  for (let i = start; i < code.length; i++) {
    const char = code[i];
    const prevChar = i > 0 ? code[i-1] : '';

    // Handle strings
    if (!inString && (char === '"' || char === "'") && prevChar !== '\\') {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar && prevChar !== '\\') {
      inString = false;
    }

    if (!inString) {
      if (char === '{' || char === '[') depth++;
      else if (char === '}' || char === ']') {
        depth--;
        if (depth === 0) {
          const extracted = code.substring(start, i + 1);
          try {
            return JSON.parse(extracted);
          } catch (e) {
            return eval('(' + extracted + ')');
          }
        }
      } else if (depth === 0 && char === ',') {
        // End of value at same depth
        const extracted = code.substring(start, i);
        try {
          return JSON.parse(extracted);
        } catch (e) {
          return eval('(' + extracted + ')');
        }
      }
    }
  }
  return null;
}

// Extract and compare symbolMap/symbols_
console.log('=== Comparing symbolMap/symbols_ ===');
const jisonSymbols = extractVariable(jisonCode, 'symbols_');
const sonarSymbols = extractVariable(sonarCode, 'symbolMap');

if (jisonSymbols && sonarSymbols) {
  if (JSON.stringify(jisonSymbols) === JSON.stringify(sonarSymbols)) {
    console.log('✓ symbolMap matches symbols_');
    console.log('  Total symbols:', Object.keys(jisonSymbols).length);
  } else {
    console.log('✗ symbolMap does NOT match symbols_');
    console.log('  Jison symbols_:', Object.keys(jisonSymbols).length, 'entries');
    console.log('  Sonar symbolMap:', Object.keys(sonarSymbols).length, 'entries');

    // Show some differences
    const jisonKeys = Object.keys(jisonSymbols);
    const sonarKeys = Object.keys(sonarSymbols);
    const inJisonNotSonar = jisonKeys.filter(k => !sonarSymbols[k]);
    const inSonarNotJison = sonarKeys.filter(k => !jisonSymbols[k]);

    if (inJisonNotSonar.length > 0) {
      console.log('  In Jison but not Sonar:', inJisonNotSonar.slice(0, 5));
    }
    if (inSonarNotJison.length > 0) {
      console.log('  In Sonar but not Jison:', inSonarNotJison.slice(0, 5));
    }
  }
}

// Extract and compare terminals_
console.log('\n=== Comparing terminals_ ===');
const jisonTerminals = extractVariable(jisonCode, 'terminals_');
const sonarTerminals = extractVariable(sonarCode, 'terminals_');

if (jisonTerminals && sonarTerminals) {
  if (JSON.stringify(jisonTerminals) === JSON.stringify(sonarTerminals)) {
    console.log('✓ terminals_ matches');
    console.log('  Total terminals:', Object.keys(jisonTerminals).length);
  } else {
    console.log('✗ terminals_ does NOT match');
    console.log('  Jison terminals_:', Object.keys(jisonTerminals).length, 'entries');
    console.log('  Sonar terminals_:', Object.keys(sonarTerminals).length, 'entries');
  }
}

// Extract and compare productionTable/productions_
console.log('\n=== Comparing productionTable/productions_ ===');
const jisonProductions = extractVariable(jisonCode, 'productions_');
const sonarProductions = extractVariable(sonarCode, 'productionTable');

if (jisonProductions && sonarProductions) {
  if (JSON.stringify(jisonProductions) === JSON.stringify(sonarProductions)) {
    console.log('✓ productionTable matches productions_');
    console.log('  Total productions:', jisonProductions.length);
  } else {
    console.log('✗ productionTable does NOT match productions_');
    console.log('  Jison productions_:', jisonProductions.length);
    console.log('  Sonar productionTable:', sonarProductions.length);

    // Find first difference
    for (let i = 0; i < Math.min(jisonProductions.length, sonarProductions.length); i++) {
      const jisonProd = jisonProductions[i];
      const sonarProd = sonarProductions[i];
      if (JSON.stringify(jisonProd) !== JSON.stringify(sonarProd)) {
        console.log(`  First difference at index ${i}:`);
        console.log('    Jison:', JSON.stringify(jisonProd));
        console.log('    Sonar:', JSON.stringify(sonarProd));
        break;
      }
    }
  }
}

// Extract defaultActions
console.log('\n=== Comparing defaultActions ===');
const jisonDefaults = extractVariable(jisonCode, 'defaultActions');
const sonarDefaults = extractVariable(sonarCode, 'defaultActions');

if (jisonDefaults && sonarDefaults) {
  const jisonCount = Object.keys(jisonDefaults).length;
  const sonarCount = Object.keys(sonarDefaults).length;
  console.log('  Jison defaultActions:', jisonCount, 'entries');
  console.log('  Sonar defaultActions:', sonarCount, 'entries');

  if (JSON.stringify(jisonDefaults) === JSON.stringify(sonarDefaults)) {
    console.log('✓ defaultActions matches exactly');
  } else {
    console.log('✗ defaultActions differ (this is OK - different optimization strategies)');
  }
}

// Check table/stateTable sizes
console.log('\n=== Checking state table sizes ===');
const jisonTableMatch = jisonCode.match(/table:\s*{([^}]*(?:{[^}]*}[^}]*)*)}/);
const sonarTableMatch = sonarCode.match(/stateTable:\s*{([^}]*(?:{[^}]*}[^}]*)*)}/);

if (jisonTableMatch && sonarTableMatch) {
  const jisonStates = jisonTableMatch[1].match(/\d+:/g);
  const sonarStates = sonarTableMatch[1].match(/\d+:/g);
  console.log('  Jison table states:', jisonStates ? jisonStates.length : 0);
  console.log('  Sonar stateTable states:', sonarStates ? sonarStates.length : 0);
}