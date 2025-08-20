/**
 * Rip Language Lexer
 *
 * Tokenizes Rip source code into a stream of tokens.
 * Future clean implementation - currently under construction.
 */

export interface Token {
  type: TokenType
  value: string
  line: number
  column: number
}

export enum TokenType {
  // Literals
  IDENTIFIER = 'IDENTIFIER',
  NUMBER = 'NUMBER',
  STRING = 'STRING',
  REGEX = 'REGEX',

  // Keywords
  IF = 'IF',
  ELSE = 'ELSE',
  SWITCH = 'SWITCH',
  WHEN = 'WHEN',

  // Operators
  ASSIGN = 'ASSIGN',
  COMPARE = 'COMPARE',
  REGEX_MATCH = 'REGEX_MATCH', // =~
  ASYNC_CALL = 'ASYNC_CALL', // !

  // Punctuation
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  ARROW = 'ARROW', // ->

  // Special
  NEWLINE = 'NEWLINE',
  EOF = 'EOF',
}

export class Lexer {
  private source: string
  private position = 0
  private line = 1
  private column = 1

  constructor(source: string) {
    this.source = source
  }

  tokenize(): Token[] {
    // TODO: Implement Rip lexer with support for:
    // - Async bang syntax (!)
    // - Regex match operator (=~)
    // - Clean function syntax
    // - All CoffeeScript-inspired features

    throw new Error(
      'Rip lexer not yet implemented - building the 747 mid-flight!',
    )
  }

  private nextToken(): Token {
    // TODO: Implement token parsing
    throw new Error('Token parsing not implemented')
  }
}
