// Main entry point for Rip language

export { default as Compiler, compile } from './compiler.js';
export { default as Lexer } from './lexer.js';
export * as nodes from './nodes.js';

// Simple compile function for testing
export function compileFile(filename) {
  throw new Error('compileFile not implemented yet');
}

export default { compile, compileFile, Compiler, Lexer, nodes };