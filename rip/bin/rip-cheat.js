#!/usr/bin/env bun
// Rip CLI - "Cheat" Version using CoffeeScript
// This actually works!

import fs from 'fs';
import path from 'path';
import { CheatCompiler } from '../lib/cheat-compiler.js';

class RipCLI {
  constructor() {
    this.compiler = new CheatCompiler();
  }

  run(args) {
    if (args.length < 1) {
      this.printHelp();
      return;
    }

    const command = args[0];
    
    if (command === '-h' || command === '--help') {
      this.printHelp();
      return;
    }
    
    if (command === '-v' || command === '--version') {
      console.log('Rip 0.1.0 (Cheat Mode - using CoffeeScript)');
      return;
    }
    
    if (command === '-c' || command === '--compile') {
      // Compile to stdout
      const filename = args[1];
      if (!filename) {
        console.error('Error: No file specified');
        process.exit(1);
      }
      this.compileFile(filename, { output: 'stdout' });
      return;
    }
    
    if (command === '-e' || command === '--eval') {
      // Evaluate code
      const code = args[1];
      if (!code) {
        console.error('Error: No code specified');
        process.exit(1);
      }
      this.evalCode(code);
      return;
    }
    
    // Default: compile and run file
    this.runFile(command);
  }
  
  compileFile(filename, options = {}) {
    try {
      const source = fs.readFileSync(filename, 'utf-8');
      const compiled = this.compiler.compile(source);
      
      if (options.output === 'stdout') {
        console.log(compiled);
      } else if (options.output) {
        fs.writeFileSync(options.output, compiled);
        console.log(`Compiled to ${options.output}`);
      } else {
        // Default: write to .js file
        const outputFile = filename.replace(/\.rip$/, '.js');
        fs.writeFileSync(outputFile, compiled);
        console.log(`Compiled to ${outputFile}`);
      }
      
      return compiled;
    } catch (error) {
      console.error(`Error compiling ${filename}:`, error.message);
      process.exit(1);
    }
  }
  
  runFile(filename) {
    try {
      const source = fs.readFileSync(filename, 'utf-8');
      const compiled = this.compiler.compile(source);
      
      // Run the compiled code
      eval(compiled);
    } catch (error) {
      console.error(`Error running ${filename}:`, error.message);
      process.exit(1);
    }
  }
  
  evalCode(code) {
    try {
      const compiled = this.compiler.compile(code);
      eval(compiled);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  }
  
  printHelp() {
    console.log(`
Rip Language - Cheat Mode (using CoffeeScript)
===============================================

Usage:
  rip <file.rip>           Run a Rip file
  rip -c <file.rip>        Compile to stdout
  rip -e "<code>"          Evaluate code
  rip -h                   Show this help
  rip -v                   Show version

Examples:
  rip hello.rip            Run hello.rip
  rip -c hello.rip         Compile and print JS
  rip -e "console.log 42"  Run inline code

Note: This version uses CoffeeScript as a backend.
      It's a cheat, but it works!
    `.trim());
  }
}

// Run the CLI
const cli = new RipCLI();
cli.run(process.argv.slice(2));
