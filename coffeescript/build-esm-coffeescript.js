const fs = require('fs');

// Read the CJS version
const cjsCode = fs.readFileSync('lib/coffeescript/coffeescript.js', 'utf8');

// Extract the main content without IIFE wrapper
const match = cjsCode.match(/\(function\(\) \{([\s\S]*)\}\).call\(this\);/);
if (!match) {
  console.error('Could not extract code from CJS file');
  process.exit(1);
}

let body = match[1];

// Build the ESM version
let esmCode = `import {Lexer} from './lexer.js';
import {parser} from './parser.js';
import * as helpers from './helpers.js';
import SourceMap from './sourcemap.js';
import * as nodes from './nodes.js';

// Hardcoded version for now
const packageJson = {version: '0.1.0'};
`;

// Remove all variable declarations for imports
body = body.replace(/var\s+\w+,\s*[^;]+;/g, '');
body = body.replace(/var\s+\w+;/g, '');

// Remove all requires
body = body.replace(/\w+\s*=\s*require\([^)]+\)[^;]*;/g, '');

// Extract and convert exports
const exports = {};

// Find all exports assignments
body = body.replace(/exports\.(\w+)\s*=\s*(\w+)\s*=\s*function/g, (match, name, varName) => {
  exports[name] = varName;
  return `const ${varName} = function`;
});

body = body.replace(/exports\.(\w+)\s*=\s*function/g, (match, name) => {
  exports[name] = name;
  return `const ${name} = function`;
});

body = body.replace(/exports\.(\w+)\s*=\s*(\w+)\s*=/g, (match, name, varName) => {
  exports[name] = varName || name;
  return `const ${name} =`;
});

body = body.replace(/exports\.(\w+)\s*=/g, (match, name) => {
  exports[name] = name;
  return `const ${name} =`;
});

// Fix parser.yy assignment
body = body.replace('parser.yy = nodes;', `// Initialize parser.yy and copy all nodes exports
parser.yy = {};
Object.keys(nodes).forEach(function(key) {
  parser.yy[key] = nodes[key];
});`);

// Fix getSourceMap destructuring
body = body.replace(/\(\{([^}]+)\}\s*=\s*SourceMap\);/g, 'const {$1} = SourceMap;');

// Add the body
esmCode += body;

// Add exports at the end
esmCode += '\n\n// Export declarations\n';
for (const [exportName, varName] of Object.entries(exports)) {
  if (exportName === varName) {
    esmCode += `export {${exportName}};\n`;
  } else {
    esmCode += `export {${varName} as ${exportName}};\n`;
  }
}

// Write the file
fs.writeFileSync('lib-esm/coffeescript/coffeescript.js', esmCode);
console.log('Successfully built ESM coffeescript.js');
