#!/usr/bin/env bun
// Actually RUN compiled Rip code!

import fs from 'fs';

console.log('🚀 RUNNING COMPILED RIP CODE!!!');
console.log('================================\n');

// Fix exports
let compilerJs = fs.readFileSync('/Users/shreeve/Data/Code/rip/rip/lib/compiler.js', 'utf-8');
compilerJs = compilerJs
  .replace(/var\s+(\w+);?\s*\1\s*=\s*class\s+\1/g, 'const $1 = class $1')
  .replace(/module\.exports = (\w+);/, '');
if (!compilerJs.includes('export default')) {
  compilerJs += '\nexport default Compiler;\nexport { Compiler };';
}
fs.writeFileSync('/Users/shreeve/Data/Code/rip/rip/lib/compiler.js', compilerJs);

// Import components
const Lexer = (await import('/Users/shreeve/Data/Code/rip/rip/lib/lexer.js')).default;
const Rewriter = (await import('/Users/shreeve/Data/Code/rip/rip/lib/rewriter.js')).default;
const Compiler = (await import('/Users/shreeve/Data/Code/rip/rip/lib/compiler.js')).default;

// Simple parser (same as before)
class SimpleParser {
  parse(tokens) {
    const stmts = [];
    let i = 0;

    while (i < tokens.length) {
      const token = tokens[i];

      if (token.type === 'TERMINATOR' || token.type === 'EOF') {
        i++;
        continue;
      }

      // Assignment
      if (i + 2 < tokens.length && tokens[i+1].type === '=') {
        const stmt = {
          type: 'assign',
          target: { type: 'id', name: token.value },
          value: this.parseExpr(tokens, i + 2)
        };
        stmts.push({ type: 'stmt', expr: stmt });

        while (i < tokens.length && tokens[i].type !== 'TERMINATOR' && tokens[i].type !== 'EOF') {
          i++;
        }
        continue;
      }

      // Method calls
      if (token.type === 'IDENTIFIER' && i + 1 < tokens.length && tokens[i+1].type === '.') {
        let expr = { type: 'id', name: token.value };
        i++;

        while (i < tokens.length && tokens[i].type === '.') {
          i++; // skip dot
          if (tokens[i].type === 'PROPERTY' || tokens[i].type === 'IDENTIFIER') {
            expr = {
              type: 'access',
              object: expr,
              property: { type: 'prop', name: tokens[i].value },
              computed: false
            };
            i++;
          }
        }

        if (i < tokens.length && tokens[i].type === 'CALL_START') {
          const args = [];
          i++; // skip CALL_START

          while (i < tokens.length && tokens[i].type !== 'CALL_END') {
            if (tokens[i].type === 'STRING') {
              args.push({ type: 'str', val: tokens[i].value.slice(1, -1) });
            } else if (tokens[i].type === 'NUMBER') {
              args.push({ type: 'num', val: tokens[i].value });
            } else if (tokens[i].type === 'IDENTIFIER') {
              args.push({ type: 'id', name: tokens[i].value });
            }
            i++;
          }
          i++; // skip CALL_END

          expr = { type: 'call', func: expr, args };
        }

        stmts.push({ type: 'stmt', expr });
        continue;
      }

      i++;
    }

    return { type: 'root', stmts };
  }

  parseExpr(tokens, start) {
    const token = tokens[start];

    if (!token) return { type: 'null' };

    if (token.type === 'NUMBER') {
      if (start + 2 < tokens.length && tokens[start + 1].type in {'+':1, '-':1, '*':1, '/':1}) {
        return {
          type: 'op',
          op: tokens[start + 1].value,
          left: { type: 'num', val: token.value },
          right: this.parseExpr(tokens, start + 2)
        };
      }
      return { type: 'num', val: token.value };
    }

    if (token.type === 'STRING') {
      return { type: 'str', val: token.value.slice(1, -1) };
    }

    if (token.type === 'IDENTIFIER') {
      if (start + 2 < tokens.length && tokens[start + 1].type in {'+':1, '-':1, '*':1, '/':1}) {
        return {
          type: 'op',
          op: tokens[start + 1].value,
          left: { type: 'id', name: token.value },
          right: this.parseExpr(tokens, start + 2)
        };
      }
      return { type: 'id', name: token.value };
    }

    return { type: 'null' };
  }
}

// The Rip program to compile and run
const ripCode = `
# A real Rip program!
x = 10
y = 20
z = x + y

console.log "Starting Rip calculation..."
console.log x
console.log y
console.log z

# More calculations
result = z * 2
console.log "Final result:"
console.log result
`;

console.log('📝 Rip Source Code:');
console.log('-------------------');
console.log(ripCode);
console.log();

// Compile it!
function compileRip(code) {
  // Step 1: Lex
  const lexer = new Lexer();
  const rawTokens = lexer.tokenize(code);

  // Convert to object format
  const tokens = rawTokens.map(([type, value, line, column]) => ({
    type, value, line: line || 0, column: column || 0
  }));

  // Step 2: Rewrite
  const rewriter = new Rewriter();
  const rewritten = rewriter.rewrite(tokens);

  // Step 3: Parse
  const parser = new SimpleParser();
  const ast = parser.parse(rewritten);

  // Step 4: Compile
  const compiler = new Compiler();
  return compiler.compile(ast);
}

try {
  const jsCode = compileRip(ripCode);

  console.log('✅ Compiled JavaScript:');
  console.log('-----------------------');
  console.log(jsCode);
  console.log();

  console.log('🏃 Running the code:');
  console.log('--------------------');

  // Actually run it!
  eval(jsCode);

  console.log();
  console.log('🎉'.repeat(25));
  console.log('✨ RIP SUCCESSFULLY COMPILED AND RAN! ✨');
  console.log('🎉'.repeat(25));

} catch (e) {
  console.log('❌ Error:', e.message);
}
