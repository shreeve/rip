#!/usr/bin/env node
require('coffeescript/register');
const jison = require('jison');
const fs = require('fs');
const path = require('path');

// Load grammar (CoffeeScript module exporting tokens, bnf, operators, lex, startSymbol)
const grammar = require(path.resolve(__dirname, './bumps.revF3.coffee'));

// Build parser
const parser = new jison.Parser({
  bnf: grammar.bnf,
  operators: grammar.operators,
  tokens: grammar.tokens,
  startSymbol: grammar.startSymbol,
  lex: grammar.lex
});

// Provide yy helpers used by grammar actions
parser.yy = {
  options: {
    // flip these as needed for your dialect
    allowWritableDeviceVars: true,
    allowWritableSystemVar: true
  },
  node(type, fields){ return Object.assign({ type }, fields || {}); }
};

function parseText(text){
  return parser.parse(text);
}

if (require.main === module) {
  const inputPath = process.argv[2];
  const src = inputPath ? fs.readFileSync(inputPath, 'utf8')
    : `\
; Sample M code exercising ELSE and indirect entryrefs
IF 1=0  WRITE "no"  ELSE  WRITE "yes"
SET R="ROU"
DO @X
G @(R)
`;
  try {
    const ast = parseText(src);
    console.log(JSON.stringify(ast, null, 2));
  } catch (e) {
    console.error("Parse error:", e && e.message || e);
    process.exit(1);
  }
}

module.exports = { parseText };
