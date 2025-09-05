#!/usr/bin/env node

const fs = require('fs');

console.log('Fixing ESM build...');

// 1. Fix coffeescript.js
console.log('Fixing coffeescript.js...');
const cjs = fs.readFileSync('lib/coffeescript/coffeescript.js', 'utf8');
const content = cjs.match(/\(function\(\) \{([\s\S]*)\}\)\.call\(this\);/)[1];

let esm = `import {Lexer} from './lexer.js';
import {parser} from './parser.js';
import * as helpers from './helpers.js';
import SourceMap from './sourcemap.js';
import * as nodes from './nodes.js';

const packageJson = {version: '0.1.0'};
`;

let body = content
  .split('\n')
  .filter(line => !line.match(/^\s*var\s+/))
  .filter(line => !line.match(/require\(/))
  .join('\n');

// Fix exports
body = body.replace(/exports\.VERSION\s*=\s*/g, 'const VERSION = ');
body = body.replace(/exports\.FILE_EXTENSIONS\s*=\s*FILE_EXTENSIONS\s*=\s*/g, 'const FILE_EXTENSIONS = ');
body = body.replace(/exports\.helpers\s*=\s*/g, '// helpers already imported\n');
body = body.replace(/exports\.registerCompiled\s*=\s*/g, '// registerCompiled handled below\n');
body = body.replace(/exports\.compile\s*=\s*compile\s*=\s*/g, 'const compile = ');
body = body.replace(/exports\.tokens\s*=\s*/g, 'const tokens = ');
body = body.replace(/exports\.nodes\s*=\s*/g, 'const nodesFn = ');
body = body.replace(/exports\.run\s*=\s*/g, 'const run = ');
body = body.replace(/exports\.eval\s*=\s*/g, '// eval is alias\n');
body = body.replace(/exports\.register\s*=\s*/g, '// register is alias\n');
body = body.replace(/exports\.patchStackTrace\s*=\s*/g, 'const patchStackTrace = ');

// Add parser.yy initialization
const parseErrorIndex = body.indexOf('parser.yy.parseError');
if (parseErrorIndex > 0) {
  body = body.slice(0, parseErrorIndex) +
    `// Initialize parser.yy
  parser.yy = {};
  Object.keys(nodes).forEach(function(key) {
    parser.yy[key] = nodes[key];
  });

  ` + body.slice(parseErrorIndex);
}

// Fix destructuring
body = body.replace(/\(\{([^}]+)\}\s*=\s*SourceMap\);/g, 'const {$1} = SourceMap;');

// Add necessary declarations
body = body.replace(/^  base64encode = function/gm, '  const base64encode = function');
body = body.replace(/^  withPrettyErrors = function/gm, '  const withPrettyErrors = function');
body = body.replace(/^  checkShebangLine = function/gm, '  const checkShebangLine = function');
body = body.replace(/^  lexer = new Lexer/gm, '  const lexer = new Lexer');

// Clean up orphaned statements
body = body.replace(/^registerCompiled;$/gm, '');
body = body.replace(/^helpers;$/gm, '');

// Fix catch variable
body = body.replace(/} catch \(error\) {/g, '} catch (err) {');
body = body.replace(/^        err = error;$/gm, '');

// Add variable declarations
body = body.replace(/^    generateSourceMap = /gm, '    const generateSourceMap = ');
body = body.replace(/^    filename = /gm, '    const filename = ');
body = body.replace(/^    tokens = /gm, '    const tokens = ');
body = body.replace(/^    nodes = /gm, '    const nodes = ');
body = body.replace(/^    fragments = /gm, '    const fragments = ');
body = body.replace(/^    currentLine = /gm, '    let currentLine = ');
body = body.replace(/^    currentColumn = /gm, '    let currentColumn = ');
body = body.replace(/^    js = ""/gm, '    let js = ""');
body = body.replace(/^      results = \[\]/gm, '      const results = []');
body = body.replace(/for \(i = 0/g, 'for (let i = 0');
body = body.replace(/^        token = tokens/gm, '        const token = tokens');

// Fix lex function
body = body.replace(
  'lex: function() {\n      token = parser.tokens',
  'lex: function() {\n      let tag;\n      const token = parser.tokens'
);

// Fix map declaration
body = body.replace(
  '    checkShebangLine(filename, code);\n    if (generateSourceMap) {\n      map = new SourceMap();',
  '    checkShebangLine(filename, code);\n    let map;\n    if (generateSourceMap) {\n      map = new SourceMap();'
);

esm += body;

// Add exports
esm += `

// Exports
export {VERSION, FILE_EXTENSIONS, helpers, compile, tokens, nodesFn as nodes, run, patchStackTrace};
export {run as eval, run as register};
const {registerCompiled} = SourceMap;
export {registerCompiled};
`;

fs.writeFileSync('lib-esm/coffeescript/coffeescript.js', esm);

// 2. Fix nodes.js exports
console.log('Fixing nodes.js...');
let nodesCode = fs.readFileSync('lib-esm/coffeescript/nodes.js', 'utf8');
nodesCode = nodesCode.replace(/^exports\./gm, 'export const ');
nodesCode = nodesCode.replace(/export const mergeLocationData = mergeLocationData = /g, 'mergeLocationData = ');
nodesCode = nodesCode.replace(/export const mergeAstLocationData = mergeAstLocationData = /g, 'mergeAstLocationData = ');
nodesCode = nodesCode.replace(/export const jisonLocationDataToAstLocationData = jisonLocationDataToAstLocationData = /g, 'jisonLocationDataToAstLocationData = ');
fs.writeFileSync('lib-esm/coffeescript/nodes.js', nodesCode);

console.log('ESM build fixed!');
