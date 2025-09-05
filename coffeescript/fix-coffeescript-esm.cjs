const fs = require('fs');

// Read the file
let code = fs.readFileSync('lib-esm/coffeescript/coffeescript.js', 'utf8');

// Fix all variable declarations systematically
const fixes = [
  // Fix reassignments that should not have const
  [/^    options = Object\.assign/gm, '    options = Object.assign'],

  // Add const/let to bare assignments
  [/^    generateSourceMap = /gm, '    const generateSourceMap = '],
  [/^    filename = /gm, '    const filename = '],
  [/^    map = /gm, '    let map = '],
  [/^    tokens = /gm, '    const tokens = '],
  [/^    nodes = /gm, '    const nodes = '],
  [/^    fragments = /gm, '    const fragments = '],
  [/^    currentLine = /gm, '    let currentLine = '],
  [/^    currentColumn = /gm, '    let currentColumn = '],
  [/^    js = ""/gm, '    let js = ""'],
  [/^      results = \[\]/gm, '      const results = []'],
  [/^      for \(i = /gm, '      for (let i = '],
  [/^        token = tokens/gm, '        const token = tokens'],

  // Fix specific issues
  [/^    errorText = \(function/gm, '    const errorText = (function'],
  [/^      token = parser\.tokens/gm, '      const token = parser.tokens'],
  [/^      \[tag,/gm, '      let tag;\n      [tag,'],

  // Fix function declarations
  [/^  formatSourcePosition = function/gm, '  const formatSourcePosition = function'],
  [/^  getSourceMapping = function/gm, '  const getSourceMapping = function'],

  // Fix checkShebangLine variables
  [/^    firstLine = input\.split/gm, '    const firstLine = input.split'],
  [/^    rest = firstLine/gm, '    const match = firstLine'],
  [/^    args = rest/gm, '    const args = match'],

  // Fix loop variables
  [/for \(i = 0/g, 'for (let i = 0'],
  [/for \(j = 0/g, 'for (let j = 0'],
  [/for \(k = 0/g, 'for (let k = 0'],
];

// Apply all fixes
for (const [pattern, replacement] of fixes) {
  code = code.replace(pattern, replacement);
}

// Write the fixed file
fs.writeFileSync('lib-esm/coffeescript/coffeescript.js', code);
console.log('Fixed all variable declarations in coffeescript.js');
