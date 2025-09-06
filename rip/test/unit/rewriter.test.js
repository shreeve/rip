import { test, expect, describe } from "bun:test";
import { loadModule } from './test-helpers.js';

const Lexer = (await loadModule('lexer')).default;
const Rewriter = (await loadModule('rewriter')).default;

describe("Rewriter", () => {
  function getRewrittenTokens(code) {
    const lexer = new Lexer();
    const rawTokens = lexer.tokenize(code);
    const tokens = rawTokens.map(([type, value, line, column]) => ({
      type, value, line: line || 0, column: column || 0
    }));
    const rewriter = new Rewriter();
    return rewriter.rewrite(tokens);
  }

  test("adds implicit parentheses for function calls", () => {
    const tokens = getRewrittenTokens("console.log 42");
    const types = tokens.map(t => t.type);
    
    expect(types).toContain("CALL_START");
    expect(types).toContain("CALL_END");
    
    // Should be: IDENTIFIER . PROPERTY CALL_START NUMBER CALL_END
    const callStartIndex = types.indexOf("CALL_START");
    const callEndIndex = types.indexOf("CALL_END");
    
    expect(callStartIndex).toBeGreaterThan(2); // After console.log
    expect(callEndIndex).toBeGreaterThan(callStartIndex);
  });

  test("handles postfix conditionals", () => {
    const tokens = getRewrittenTokens("return x if y");
    const types = tokens.map(t => t.type);
    
    expect(types).toContain("POST_IF");
    expect(types).not.toContain("IF"); // Should be converted to POST_IF
  });

  test("adds INDENT/OUTDENT for single-line blocks", () => {
    const tokens = getRewrittenTokens("-> x * 2");
    const types = tokens.map(t => t.type);
    
    expect(types).toContain("INDENT");
    expect(types).toContain("OUTDENT");
    
    // Arrow function should trigger block normalization
    const arrowIndex = types.indexOf("->");
    const indentIndex = types.indexOf("INDENT");
    
    expect(indentIndex).toBeGreaterThan(arrowIndex);
  });

  test("doesn't add parens when already present", () => {
    const tokens = getRewrittenTokens("console.log(42)");
    const generatedParens = tokens.filter(t => 
      t.generated && (t.type === "CALL_START" || t.type === "CALL_END")
    );
    
    expect(generatedParens.length).toBe(0);
  });

  test("handles implicit calls with multiple arguments", () => {
    const tokens = getRewrittenTokens('console.log "hello", 42');
    const types = tokens.map(t => t.type);
    
    expect(types).toContain("CALL_START");
    expect(types).toContain("CALL_END");
    
    // Both arguments should be within the call
    const callStart = types.indexOf("CALL_START");
    const callEnd = types.indexOf("CALL_END");
    const comma = types.indexOf(",");
    
    expect(comma).toBeGreaterThan(callStart);
    expect(comma).toBeLessThan(callEnd);
  });

  test("handles implicit object literals", () => {
    const tokens = getRewrittenTokens("func a: 1, b: 2");
    const types = tokens.map(t => t.type);
    
    // Should detect implicit object pattern
    expect(types.filter(t => t === "{").length).toBeGreaterThanOrEqual(1);
    expect(types.filter(t => t === "}").length).toBeGreaterThanOrEqual(1);
  });

  test("preserves token values", () => {
    const tokens = getRewrittenTokens("x = 42");
    
    const xToken = tokens.find(t => t.type === "IDENTIFIER");
    const numToken = tokens.find(t => t.type === "NUMBER");
    
    expect(xToken.value).toBe("x");
    expect(numToken.value).toBe("42");
  });

  test("marks generated tokens", () => {
    const tokens = getRewrittenTokens("console.log 42");
    
    const callStart = tokens.find(t => t.type === "CALL_START");
    const callEnd = tokens.find(t => t.type === "CALL_END");
    
    expect(callStart.generated).toBe(true);
    expect(callEnd.generated).toBe(true);
  });
});