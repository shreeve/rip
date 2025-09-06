#!/usr/bin/env bun

import RipBootstrap from '../bootstrap/rip-bootstrap.js';
import fs from 'fs';

const source = `class Test
  constructor: ->
    @options = {
      bare: true           # Don't wrap in IIFE
      sourceMap: false     # Source map generation
    }`;

const compiler = new RipBootstrap();

// Monkey-patch to add debugging
const originalCompileLine = compiler.compileLine.bind(compiler);
compiler.compileLine = function(line, nextLine, context) {
  const trimmed = line.trim();
  console.log(`Line: "${trimmed}"`);
  console.log(`  Context: inObject=${context.inObject}, objectBraceLevel=${context.objectBraceLevel}`);

  const result = originalCompileLine(line, nextLine, context);

  console.log(`  Result: "${result}"`);
  console.log('');

  return result;
};

const compiled = compiler.compile(source);
console.log('FINAL OUTPUT:');
console.log(compiled);
