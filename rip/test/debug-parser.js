#!/usr/bin/env bun

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Compile the files we need
execSync('coffee -c -b -o lib/ src/lexer.rip src/rewriter.rip', { stdio: 'inherit' });

// Fix exports
function fixExports(jsPath) {
  let js = fs.readFileSync(jsPath, 'utf-8');
  js = js.replace(/var\s+(\w+);?\s*\1\s*=\s*class\s+\1/g, 'const $1 = class $1')
         .replace(/module\.exports = (\w+);/, '');
  if (!js.includes('export default')) {
    const className = path.basename(jsPath, '.js');
    const exportName = className.charAt(0).toUpperCase() + className.slice(1);
    js += `\nexport default ${exportName};\nexport { ${exportName} };`;
  }
  fs.writeFileSync(jsPath, js);
}

// Fix all modules
['lexer', 'rewriter', 'solar'].forEach(mod => {
  const jsPath = path.join(import.meta.dir, '..', 'lib', `${mod}.js`);
  if (fs.existsSync(jsPath)) {
    fixExports(jsPath);
  }
});

// Compile grammar if needed
const grammarJs = path.join(import.meta.dir, '..', 'lib', 'grammar-solar.js');
if (!fs.existsSync(grammarJs)) {
  execSync('coffee -c -b -o lib/ src/grammar-solar.rip', { stdio: 'inherit' });
  fixExports(grammarJs);
}

const Lexer = (await import('../lib/lexer.js')).default;
const Rewriter = (await import('../lib/rewriter.js')).default;
const Solar = (await import('../lib/solar.js')).default;
const { grammar } = await import('../lib/grammar-solar.js');

const code = '5';
const lexer = new Lexer();
const tokens = lexer.tokenize(code);
const rewriter = new Rewriter();
const rewritten = rewriter.rewrite(tokens);

console.log('Tokens after rewriter:');
rewritten.forEach((t, i) => {
  const [type, value] = t;
  console.log(`  [${i}] ${type}: "${value}"`);
});

// Create parser
const generator = new Solar.Generator(grammar, { debug: false });
const parser = generator.createParser();

// Debug what symbolIds are generated
console.log('\nSymbol IDs:');
console.log('  EOF:', parser.symbolIds?.EOF);
console.log('  $end:', parser.symbolIds?.['$end']);
console.log('  TERMINATOR:', parser.symbolIds?.TERMINATOR);

// Set up lexer
let lexPos = 0;
parser.lexer = {
  tokens: rewritten,
  pos: 0,

  setInput: function(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  },

  lex: function() {
    const token = this.tokens[this.pos++];
    if (token) {
      const [type, value] = token;

      this.yytext = value || '';
      this.yylineno = token[2] || 0;
      this.yylloc = {
        first_line: token[2] || 0,
        first_column: token[3] || 0,
        last_line: token[2] || 0,
        last_column: (token[3] || 0) + (value?.length || 0)
      };

      // Handle EOF specially - it maps to $end
      if (type === 'EOF') {
        console.log(`Lexer returning: EOF -> $end (id: 1)`);
        return 1;  // $end symbol ID
      }

      const id = parser.symbolIds?.[type];
      console.log(`Lexer returning: ${type} (id: ${id})`);
      return id || type;
    } else {
      console.log('Lexer returning: $end (no more tokens, id: 1)');
      return 1;  // $end when no more tokens
    }
  },

  showPosition: function() {
    return `Line ${this.yylineno}`;
  },

  upcomingInput: function() {
    return '';
  }
};

try {
  console.log('\nParsing...');
  const ast = parser.parse(rewritten);
  console.log('\nSuccess! AST:', JSON.stringify(ast, null, 2));
} catch (error) {
  console.log('\nError:', error.message);
}
