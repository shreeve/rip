import { parser as Parser } from './test-grammar-parser.js';

// Minimal mock lexer for demonstration
class Lexer {
  constructor(input) {
    this.input = input.replace(/\s+/g, '');
    this.pos = 0;
    this.tokens = [];
    this.tokenize();
    this.yytext = '';
    this.yyleng = 0;
    this.yylineno = 0;
    this.yylloc = {};
    this.index = 0;
  }

  tokenize() {
    const regex = /\d+|[()+\-*/]/g;
    let match;
    while ((match = regex.exec(this.input)) !== null) {
      const value = match[0];
      if (/\d+/.test(value)) {
        this.tokens.push({ type: 'NUMBER', value });
      } else if (value === '+') {
        this.tokens.push({ type: 'PLUS', value });
      } else if (value === '-') {
        this.tokens.push({ type: 'MINUS', value });
      } else if (value === '*') {
        this.tokens.push({ type: 'TIMES', value });
      } else if (value === '/') {
        this.tokens.push({ type: 'DIVIDE', value });
      } else if (value === '(') {
        this.tokens.push({ type: 'LPAREN', value });
      } else if (value === ')') {
        this.tokens.push({ type: 'RPAREN', value });
      }
    }
    this.tokens.push({ type: '$end' });
    this.index = 0;
  }

  setTokens(tokens) {
    if (!tokens) {
      // If no tokens provided, use the lexer's own tokens
      this.index = 0;
      return;
    }
    this.tokens = tokens.map(type => {
      if (typeof type === 'object' && type.type) return type;
      // Try to find a value for the type
      return { type, value: type };
    });
    this.index = 0;
  }

  lex() {
    if (!this.tokens) this.tokens = [];
    if (typeof this.index !== 'number') this.index = 0;
    if (this.index < this.tokens.length) {
      const token = this.tokens[this.index++];
      this.yytext = token.value;
      return token.type;
    }
    return '$end';
  }
}

// Test input
const input = '2 + 3 * (4 - 1)';
const lexer = new Lexer(input);

const parser = new Parser();
parser.lexer = lexer;
parser.yy = {}; // Optionally, add any custom parser state here

const result = parser.parse();
console.log(`Result: ${result}`); // Should output: Result: 11