// Minimal Lexer for Rip - Just enough to get started
// This is hand-written ES6, not corrupted by bootstrap

export class MinimalLexer {
  constructor() {
    this.reset();
  }

  reset() {
    this.tokens = [];
    this.current = 0;
    this.line = 1;
    this.column = 1;
    this.source = '';
  }

  tokenize(source) {
    this.reset();
    this.source = source;
    
    while (!this.isAtEnd()) {
      this.scanToken();
    }
    
    this.addToken('EOF', '');
    return this.tokens;
  }

  isAtEnd() {
    return this.current >= this.source.length;
  }

  advance() {
    const char = this.source[this.current++];
    if (char === '\n') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return char;
  }

  peek() {
    if (this.isAtEnd()) return '\0';
    return this.source[this.current];
  }

  peekNext() {
    if (this.current + 1 >= this.source.length) return '\0';
    return this.source[this.current + 1];
  }

  addToken(type, value) {
    this.tokens.push({
      type,
      value,
      line: this.line,
      column: this.column - value.length
    });
  }

  scanToken() {
    const c = this.advance();

    // Skip whitespace
    if (c === ' ' || c === '\r' || c === '\t') {
      return;
    }

    // Newlines are significant in Rip/CoffeeScript
    if (c === '\n') {
      this.addToken('TERMINATOR', '\n');
      return;
    }

    // Comments
    if (c === '#') {
      while (this.peek() !== '\n' && !this.isAtEnd()) {
        this.advance();
      }
      return;
    }

    // Numbers
    if (this.isDigit(c)) {
      this.scanNumber();
      return;
    }

    // Identifiers and keywords
    if (this.isAlpha(c)) {
      this.scanIdentifier();
      return;
    }

    // Strings
    if (c === '"' || c === "'") {
      this.scanString(c);
      return;
    }

    // Two-character operators
    const twoChar = c + this.peek();
    switch (twoChar) {
      case '->': this.advance(); this.addToken('->', '->'); return;
      case '=>': this.advance(); this.addToken('=>', '=>'); return;
      case '==': this.advance(); this.addToken('==', '=='); return;
      case '!=': this.advance(); this.addToken('!=', '!='); return;
      case '<=': this.advance(); this.addToken('<=', '<='); return;
      case '>=': this.advance(); this.addToken('>=', '>='); return;
      case '&&': this.advance(); this.addToken('&&', '&&'); return;
      case '||': this.advance(); this.addToken('||', '||'); return;
      case '+=': this.advance(); this.addToken('+=', '+='); return;
      case '-=': this.advance(); this.addToken('-=', '-='); return;
      case '*=': this.advance(); this.addToken('*=', '*='); return;
      case '/=': this.advance(); this.addToken('/=', '/='); return;
      case '?.': this.advance(); this.addToken('?.', '?.'); return;
    }

    // Single character tokens
    switch (c) {
      case '(': this.addToken('(', '('); break;
      case ')': this.addToken(')', ')'); break;
      case '{': this.addToken('{', '{'); break;
      case '}': this.addToken('}', '}'); break;
      case '[': this.addToken('[', '['); break;
      case ']': this.addToken(']', ']'); break;
      case ',': this.addToken(',', ','); break;
      case '.': this.addToken('.', '.'); break;
      case '-': this.addToken('-', '-'); break;
      case '+': this.addToken('+', '+'); break;
      case '/': this.addToken('/', '/'); break;
      case '*': this.addToken('*', '*'); break;
      case '%': this.addToken('%', '%'); break;
      case '=': this.addToken('=', '='); break;
      case '<': this.addToken('<', '<'); break;
      case '>': this.addToken('>', '>'); break;
      case '!': this.addToken('!', '!'); break;
      case '?': this.addToken('?', '?'); break;
      case ':': this.addToken(':', ':'); break;
      case ';': this.addToken(';', ';'); break;
      case '@': this.addToken('@', '@'); break;
      default:
        console.warn(`Unknown character: ${c} at line ${this.line}`);
    }
  }

  scanNumber() {
    const start = this.current - 1; // We've already consumed the first digit
    
    while (this.isDigit(this.peek())) {
      this.advance();
    }
    
    // Decimal part
    if (this.peek() === '.' && this.isDigit(this.peekNext())) {
      this.advance(); // consume '.'
      while (this.isDigit(this.peek())) {
        this.advance();
      }
    }
    
    const value = this.source.substring(start, this.current);
    this.addToken('NUMBER', value);
  }

  scanIdentifier() {
    const start = this.current - 1; // We've already consumed the first character
    
    while (this.isAlphaNumeric(this.peek())) {
      this.advance();
    }
    
    const value = this.source.substring(start, this.current);
    
    // Check for keywords
    const keywords = {
      'if': 'IF',
      'else': 'ELSE',
      'unless': 'UNLESS',
      'then': 'THEN',
      'for': 'FOR',
      'while': 'WHILE',
      'break': 'BREAK',
      'continue': 'CONTINUE',
      'return': 'RETURN',
      'throw': 'THROW',
      'try': 'TRY',
      'catch': 'CATCH',
      'finally': 'FINALLY',
      'switch': 'SWITCH',
      'when': 'WHEN',
      'case': 'CASE',
      'default': 'DEFAULT',
      'class': 'CLASS',
      'extends': 'EXTENDS',
      'new': 'NEW',
      'this': 'THIS',
      'super': 'SUPER',
      'import': 'IMPORT',
      'export': 'EXPORT',
      'from': 'FROM',
      'as': 'AS',
      'const': 'CONST',
      'let': 'LET',
      'var': 'VAR',
      'function': 'FUNCTION',
      'true': 'BOOL',
      'false': 'BOOL',
      'null': 'NULL',
      'undefined': 'UNDEFINED',
      'typeof': 'TYPEOF',
      'instanceof': 'INSTANCEOF',
      'in': 'IN',
      'of': 'OF',
      'delete': 'DELETE',
      'void': 'VOID',
      'do': 'DO',
      'and': 'AND',
      'or': 'OR',
      'not': 'NOT',
      'is': 'IS',
      'isnt': 'ISNT'
    };
    
    const type = keywords[value] || 'IDENTIFIER';
    this.addToken(type, value);
  }

  scanString(quote) {
    const start = this.current; // Start after the opening quote
    
    while (this.peek() !== quote && !this.isAtEnd()) {
      if (this.peek() === '\n') this.line++;
      if (this.peek() === '\\') {
        this.advance(); // Skip escape character
        if (!this.isAtEnd()) this.advance(); // Skip escaped character
      } else {
        this.advance();
      }
    }
    
    if (this.isAtEnd()) {
      console.error(`Unterminated string at line ${this.line}`);
      return;
    }
    
    // Consume closing quote
    this.advance();
    
    // The value is without quotes
    const value = this.source.substring(start, this.current - 1);
    this.addToken('STRING', value);
  }

  isDigit(c) {
    return c >= '0' && c <= '9';
  }

  isAlpha(c) {
    return (c >= 'a' && c <= 'z') ||
           (c >= 'A' && c <= 'Z') ||
           c === '_' || c === '$';
  }

  isAlphaNumeric(c) {
    return this.isAlpha(c) || this.isDigit(c);
  }
}

export default MinimalLexer;
