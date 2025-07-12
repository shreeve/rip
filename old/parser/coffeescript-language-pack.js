// CoffeeScript Language Pack for Universal Parser
// This file contains the 4 essential components needed by the Universal Parser

const fs = require('fs');
const path = require('path');

// Load the extracted parser data
const parserData = JSON.parse(fs.readFileSync(path.join(__dirname, 'generated/coffeescript-parser-data.json'), 'utf8'));

// CoffeeScript Language Pack
const CoffeeScriptLanguagePack = {
  // 1. SYMBOLS - All grammar symbols (terminals + non-terminals)
  symbols: parserData.symbols,

  // 2. TERMINALS - Terminal symbol IDs
  terminals: parserData.terminals,

  // 3. RULES - Production rules [LHS, RHS_LENGTH]
  rules: parserData.rules,

  // 4. STATES - LALR(1) parse table states
  states: parserData.states,

  // 5. ACTIONS - Semantic actions for AST construction
  actions: {
    // Default action for most rules - return first child
    0: (rhs) => rhs[0],

    // Root -> Body
    1: (rhs) => ({
      type: 'Root',
      body: rhs[0]
    }),

    // Body -> Line
    2: (rhs) => ({
      type: 'Body',
      statements: [rhs[0]]
    }),

    // Body -> Body TERMINATOR Line
    3: (rhs) => ({
      type: 'Body',
      statements: rhs[0].statements.concat([rhs[2]])
    }),

    // Line -> Expression
    4: (rhs) => ({
      type: 'ExpressionStatement',
      expression: rhs[0]
    }),

    // Expression -> Literal
    5: (rhs) => rhs[0],

    // Literal -> NUMBER
    6: (rhs) => ({
      type: 'NumericLiteral',
      value: parseFloat(rhs[0])
    }),

    // Literal -> STRING
    7: (rhs) => ({
      type: 'StringLiteral',
      value: rhs[0]
    }),

    // Literal -> IDENTIFIER
    8: (rhs) => ({
      type: 'Identifier',
      name: rhs[0]
    }),

    // Add more actions as needed...
    // For now, default action handles most cases
  },

  // 6. LEXER - Custom lexer for CoffeeScript
  createLexer: (input, options = {}) => {
    // This would integrate with the existing CoffeeScript lexer
    // For now, return a simple placeholder
    const CoffeeScriptLexer = require('../coffeescript/lib/coffeescript/lexer');
    return new CoffeeScriptLexer(input, options);
  },

  // Metadata
  name: 'CoffeeScript',
  version: '2.7.0',
  description: 'CoffeeScript language pack for Universal Parser'
};

module.exports = CoffeeScriptLanguagePack;