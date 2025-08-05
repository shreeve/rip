/**
 * Basic tests for RIP Language implementation
 *
 * Tests for the future clean RIP compiler.
 * Currently placeholders - building the 747 mid-flight!
 */

import { describe, it, expect } from 'bun:test';
import { compile, parse, VERSION, FEATURES } from '../index.ts';

describe('RIP Language', () => {
  it('should have correct version', () => {
    expect(VERSION).toBe('0.1.0');
  });

  it('should expose expected features', () => {
    expect(FEATURES).toContain('async-bang-syntax');
    expect(FEATURES).toContain('regex-match-operator');
    expect(FEATURES).toContain('clean-function-syntax');
  });

  it('should throw not-implemented error for compile', () => {
    expect(() => compile('test')).toThrow('not yet implemented');
  });

  it('should throw not-implemented error for parse', () => {
    expect(() => parse('test')).toThrow('not yet implemented');
  });
});

// Future test cases for when implementation is complete:

describe.skip('RIP Async Syntax (Future)', () => {
  it('should compile ! suffix to async/await', () => {
    const result = compile('data = fetch(url)!');
    expect(result.js).toContain('await fetch(url)');
  });
});

describe.skip('RIP Regex Syntax (Future)', () => {
  it('should compile =~ to match with _ assignment', () => {
    const result = compile('val =~ /test/');
    expect(result.js).toContain('(_ = val.match(/test/), _)');
  });

  it('should handle regex match with optional chaining', () => {
    const result = compile('val =~ /^([A-Z]{2})$/; code = _?[1]');
    expect(result.js).toContain('_ != null ? _[1] : void 0');
  });
});

describe.skip('RIP Function Syntax (Future)', () => {
  it('should compile clean function syntax', () => {
    const result = compile('greet = (name) -> "Hello, #{name}!"');
    expect(result.js).toContain('function');
  });
});