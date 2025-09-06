import { test, expect, describe } from "bun:test";
import fs from 'fs';

// Fix exports and import Lexer
const lexerJs = fs.readFileSync('./lib/lexer.js', 'utf-8')
  .replace(/var\s+(\w+);?\s*\1\s*=\s*class\s+\1/g, 'const $1 = class $1')
  .replace(/module\.exports = (\w+);/, '');
fs.writeFileSync('./lib/lexer.js', lexerJs + '\nexport default Lexer;\nexport { Lexer };');

const Lexer = (await import('../lib/lexer.js')).default;

describe("Lexer", () => {
  test("tokenizes numbers", () => {
    const lexer = new Lexer();
    const tokens = lexer.tokenize("42");
    
    expect(tokens[0][0]).toBe("NUMBER");
    expect(tokens[0][1]).toBe("42");
  });

  test("tokenizes strings", () => {
    const lexer = new Lexer();
    const tokens = lexer.tokenize('"hello"');
    
    expect(tokens[0][0]).toBe("STRING");
    expect(tokens[0][1]).toBe('"hello"');
  });

  test("tokenizes identifiers", () => {
    const lexer = new Lexer();
    const tokens = lexer.tokenize("myVariable");
    
    expect(tokens[0][0]).toBe("IDENTIFIER");
    expect(tokens[0][1]).toBe("myVariable");
  });

  test("tokenizes operators", () => {
    const lexer = new Lexer();
    const tokens = lexer.tokenize("+ - * /");
    
    expect(tokens[0][0]).toBe("+");
    expect(tokens[1][0]).toBe("-");
    expect(tokens[2][0]).toBe("*");
    expect(tokens[3][0]).toBe("/");
  });

  test("tokenizes assignment", () => {
    const lexer = new Lexer();
    const tokens = lexer.tokenize("x = 10");
    
    expect(tokens[0][0]).toBe("IDENTIFIER");
    expect(tokens[0][1]).toBe("x");
    expect(tokens[1][0]).toBe("=");
    expect(tokens[2][0]).toBe("NUMBER");
    expect(tokens[2][1]).toBe("10");
  });

  test("handles comments", () => {
    const lexer = new Lexer();
    const tokens = lexer.tokenize("42 # this is a comment");
    
    expect(tokens[0][0]).toBe("NUMBER");
    expect(tokens[0][1]).toBe("42");
    // Comment should not appear in tokens
    expect(tokens.length).toBe(2); // NUMBER and EOF
  });

  test("handles indentation", () => {
    const lexer = new Lexer();
    const code = `if true
  x = 1
  y = 2`;
    
    const tokens = lexer.tokenize(code);
    const tokenTypes = tokens.map(t => t[0]);
    
    expect(tokenTypes).toContain("INDENT");
    expect(tokenTypes).toContain("OUTDENT");
  });

  test("tokenizes method calls", () => {
    const lexer = new Lexer();
    const tokens = lexer.tokenize("console.log");
    
    expect(tokens[0][0]).toBe("IDENTIFIER");
    expect(tokens[0][1]).toBe("console");
    expect(tokens[1][0]).toBe(".");
    expect(tokens[2][0]).toBe("PROPERTY");
    expect(tokens[2][1]).toBe("log");
  });

  test("handles multiline strings", () => {
    const lexer = new Lexer();
    const code = `"""
    This is a
    multiline string
    """`;
    
    const tokens = lexer.tokenize(code);
    expect(tokens[0][0]).toBe("STRING");
    expect(tokens[0][1]).toContain("multiline");
  });

  test("tokenizes arrow functions", () => {
    const lexer = new Lexer();
    const tokens = lexer.tokenize("(x) -> x * 2");
    
    const tokenTypes = tokens.map(t => t[0]);
    expect(tokenTypes).toContain("->");
    expect(tokenTypes).toContain("(");
    expect(tokenTypes).toContain(")");
  });
});
