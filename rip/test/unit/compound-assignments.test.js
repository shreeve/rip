#!/usr/bin/env bun
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { loadModule } from "./test-helpers.js";

// Load the modules
const { Lexer } = await loadModule("lexer");
const { Compiler } = await loadModule("compiler");

describe("Compound Assignments", () => {
  const lexer = new Lexer();
  const compiler = new Compiler();

  // Simple parser for basic assignment tests
  class SimpleParser {
    parse(tokens) {
      const stmts = [];
      let i = 0;

      while (i < tokens.length) {
        const token = tokens[i];

        if (token[0] === 'TERMINATOR' || token[0] === 'EOF') {
          i++;
          continue;
        }

        // Check for assignments (including compound)
        if (token[0] === 'IDENTIFIER' && i + 1 < tokens.length) {
          const nextToken = tokens[i + 1];
          if (nextToken[0] === '=' || nextToken[0] === '+=' ||
              nextToken[0] === '-=' || nextToken[0] === '*=' ||
              nextToken[0] === '/=') {

            // Collect expression tokens
            const exprTokens = [];
            let j = i + 2;
            while (j < tokens.length && tokens[j][0] !== 'TERMINATOR' && tokens[j][0] !== 'EOF') {
              exprTokens.push(tokens[j]);
              j++;
            }

            // Build assignment node
            const assign = {
              type: 'assign',
              target: { type: 'id', name: token[1] },
              value: this.parseSimpleExpr(exprTokens)
            };

            if (nextToken[0] !== '=') {
              assign.op = nextToken[0];
            }

            stmts.push({ type: 'stmt', expr: assign });
            i = j;
            continue;
          }
        }

        i++;
      }

      return { type: 'root', stmts };
    }

    parseSimpleExpr(tokens) {
      if (tokens.length === 0) return { type: 'undef' };
      if (tokens.length === 1) {
        const t = tokens[0];
        if (t[0] === 'NUMBER') return { type: 'num', val: t[1] };
        if (t[0] === 'IDENTIFIER') return { type: 'id', name: t[1] };
      }
      // Simple binary op
      if (tokens.length === 3) {
        return {
          type: 'op',
          op: tokens[1][0],
          left: this.parseSimpleExpr([tokens[0]]),
          right: this.parseSimpleExpr([tokens[2]])
        };
      }
      // Default to first token
      return this.parseSimpleExpr([tokens[0]]);
    }
  }

  const parser = new SimpleParser();

  const compile = (code) => {
    const tokens = lexer.tokenize(code);
    const ast = parser.parse(tokens);
    return compiler.compile(ast);
  };

  it("should compile += operator", () => {
    const code = "x += 5";
    const js = compile(code);
    expect(js).toContain("x += 5");
  });

  it("should compile -= operator", () => {
    const code = "y -= 3";
    const js = compile(code);
    expect(js).toContain("y -= 3");
  });

  it("should compile *= operator", () => {
    const code = "z *= 2";
    const js = compile(code);
    expect(js).toContain("z *= 2");
  });

  it("should compile /= operator", () => {
    const code = "w /= 4";
    const js = compile(code);
    expect(js).toContain("w /= 4");
  });

  it("should handle let declarations with regular assignments", () => {
    const code = "x = 10\nx += 5";
    const js = compile(code);
    expect(js).toContain("let x = 10");
    expect(js).toContain("x += 5");
  });

  it("should handle compound assignments with expressions", () => {
    const code = "x += 2 + 3";
    const js = compile(code);
    expect(js).toContain("x += (2 + 3)");
  });

  it("should handle sequence of compound assignments", () => {
    const code = `
value = 100
value += 50
value -= 25
value *= 2
value /= 5`;
    const js = compile(code);
    expect(js).toContain("let value = 100");
    expect(js).toContain("value += 50");
    expect(js).toContain("value -= 25");
    expect(js).toContain("value *= 2");
    expect(js).toContain("value /= 5");
  });
});
