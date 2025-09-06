#!/usr/bin/env bun
// The "Cheat" Compiler - Uses CoffeeScript to bootstrap Rip
// This is our secret weapon to get Rip working quickly!

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import MinimalLexer from './lexer-minimal.js';

export class CheatCompiler {
  constructor(options = {}) {
    this.options = {
      useCoffeeScript: true,  // Use CoffeeScript as our cheat code
      bare: true,
      ...options
    };
    this.lexer = new MinimalLexer();
  }

  compile(source, options = {}) {
    const opts = { ...this.options, ...options };

    if (opts.useCoffeeScript) {
      // CHEAT MODE: Use CoffeeScript to compile!
      return this.compileWithCoffeeScript(source);
    } else {
      // Future: Use our own parser
      throw new Error('Pure Rip compilation not yet implemented');
    }
  }

  compileWithCoffeeScript(source) {
    try {
      // Pre-process: Convert Rip-specific syntax to CoffeeScript
      let coffeeSource = source;

      // Rip uses 'import' and 'export' which CoffeeScript supports
      // But we might need to handle some special cases

      // Simple string interpolation fix (if needed)
      // coffeeSource = coffeeSource.replace(/\#\{/g, '#{');

      // Write to temp file
      const tempFile = `/tmp/rip-temp-${Date.now()}.coffee`;
      fs.writeFileSync(tempFile, coffeeSource);

      // Use CoffeeScript to compile
      const jsCode = execSync(`coffee -c -b -p ${tempFile}`, {
        encoding: 'utf-8'
      });

      // Clean up
      fs.unlinkSync(tempFile);

      // Post-process: Add ES6 module syntax if needed
      let result = jsCode;

      // Convert CommonJS to ES6 if needed
      result = result.replace(/^var\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\);?$/gm,
                               "import $1 from '$2';");
      result = result.replace(/^exports\.(\w+)\s*=\s*/gm, 'export const $1 = ');
      result = result.replace(/^module\.exports\s*=\s*/gm, 'export default ');

      return result;
    } catch (error) {
      // If CoffeeScript fails, try to give a helpful error
      const message = error.message || error.toString();
      if (message.includes('command not found')) {
        throw new Error('CoffeeScript not found. Install with: npm install -g coffeescript');
      }
      throw new Error(`CoffeeScript compilation failed: ${message}`);
    }
  }

  // Test our lexer (for debugging)
  tokenize(source) {
    return this.lexer.tokenize(source);
  }
}

// Simple compile function
export function compile(source, options = {}) {
  const compiler = new CheatCompiler(options);
  return compiler.compile(source);
}

export default CheatCompiler;
