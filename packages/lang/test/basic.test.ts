/**
 * Basic tests for Rip Language implementation
 *
 * Tests for the future clean Rip compiler.
 * Currently placeholders - building the 747 mid-flight!
 */

import { describe, expect, it } from 'bun:test'
import { FEATURES, VERSION, compile, parse } from '../index.ts'
import { execSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'

// Helper to compile using the working Rip compiler in /coffeescript
function ripCompile(source: string): { js: string } {
  const tempFile = join(__dirname, `temp_${Date.now()}.rip`)
  const outFile = tempFile.replace('.rip', '.js')

  try {
    writeFileSync(tempFile, source)
    execSync(`cd /Users/shreeve/Data/Code/rip/coffeescript && ./bin/coffee -c "${tempFile}"`, { stdio: 'pipe' })
    const js = readFileSync(outFile, 'utf-8')
    return { js }
  } finally {
    try { unlinkSync(tempFile) } catch {}
    try { unlinkSync(outFile) } catch {}
  }
}

describe('Rip Language', () => {
  it('should have correct version', () => {
    expect(VERSION).toBe('0.1.0')
  })

  it('should expose expected features', () => {
    expect(FEATURES).toContain('async-bang-syntax')
    expect(FEATURES).toContain('regex-match-operator')
    expect(FEATURES).toContain('clean-function-syntax')
  })

  it('should throw not-implemented error for compile', () => {
    expect(() => compile('test')).toThrow('not yet implemented')
  })

  it('should throw not-implemented error for parse', () => {
    expect(() => parse('test')).toThrow('not yet implemented')
  })
})

// Test cases using the working Rip compiler in /coffeescript:

describe('Rip Async Syntax', () => {
  it('should compile ! suffix to async/await', () => {
    const result = ripCompile('data = fetch!(url)')
    expect(result.js).toContain('await fetch(url)')
  })
})

describe.skip('Rip Regex Syntax', () => {
  it('should compile =~ to enable _ variable access', () => {
    const result = compile('val =~ /test/; _[0]')
    expect(result.js).toContain('_[0]')
  })

  it('should handle regex match with optional chaining', () => {
    const result = compile('val =~ /^([A-Z]{2})$/; code = _?[1]')
    expect(result.js).toContain('_ != null ? _[1] : void 0')
  })
})

describe.skip('Rip Function Syntax', () => {
  it('should compile clean function syntax', () => {
    const result = compile('greet = (name) -> "Hello, #{name}!"')
    expect(result.js).toContain('function')
  })
})
