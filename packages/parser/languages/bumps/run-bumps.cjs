#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const parserMod = require('./parser.cjs');
let BumpsLexer;
// Enable requiring CoffeeScript modules
require('../../../../coffeescript/register.js');
const { BumpsRewriter } = require('./rewriter.coffee');
const { attachBlocks } = require('./blocks.coffee');

function readSource(argv) {
  if (argv.length > 2) {
    const p = path.resolve(argv[2]);
    return fs.readFileSync(p, 'utf8');
  }
  return 'SET X=1,Y=2\nWRITE "A", 1, X\nREAD X:5\nDO ^ROUT\n';
}

class Adapter {
  constructor(tokens) {
    this.all = tokens || [];
    this.i = 0;
    this.yytext = '';
    this.yyleng = 0;
    this.yylineno = 0;
    this.yylloc = {};
  }
  setInput(input, yy) {
    this.yy = yy || {};
    this.i = 0;
    this.yytext = '';
    this.yyleng = 0;
    this.yylleno = 0;
    this.yylloc = {};
    return this;
  }
  lex() {
    if (this.i >= this.all.length) return 1; // $end
    const [tag, val, loc] = this.all[this.i++];
    this.yytext = String(val ?? tag);
    this.yyleng = this.yytext.length;
    this.yylloc = loc || {};
    this.yylineno = this.yylloc.first_line || 0;
    return tag;
  }
  showPosition() { return ''; }
}

function main() {
  // Lazy import ESM lexer
  const loadLexer = () => import('./lexer.js').then(m => m.BumpsLexer);

  loadLexer().then((Ctor) => {
    BumpsLexer = Ctor;
  const src = readSource(process.argv);
  const lex = new BumpsLexer();
  const toks = lex.tokenize(src);
  const rewritten = new BumpsRewriter().rewrite(toks);

  const p = parserMod.parser;
  p.tokens = rewritten;
  p.yy = p.yy || {};
  p.yy.node = p.yy.node || ((type, props) => ({ type, ...(props || {}) }));
  p.lexer = new Adapter(p.tokens);

  try {
    const ast = parserMod.parse(src);
    if (ast && ast.type === 'Program') attachBlocks(ast);
    console.log(ast === true ? 'accepted' : 'ok');
    // Optional: print a simple JSON of tokens for debugging
    if (process.env.BUMPS_DEBUG) {
      console.log(JSON.stringify(rewritten.map(([t,v])=>[t,v]), null, 2));
      console.log(JSON.stringify(ast, null, 2));
    }
  } catch (e) {
    console.error('Parse error:', e.message);
    process.exit(1);
  }
  }).catch((e) => { console.error('Failed to load lexer:', e.message); process.exit(1); });
}

if (require.main === module) main();

// Attach IF/ELSE blocks using Line.depth
function attachBlocks(program) {
  if (!program || program.type !== 'Program' || !Array.isArray(program.lines)) return;
  const lines = program.lines;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !Array.isArray(line.cmds) || line.cmds.length === 0) continue;
    const cmd = line.cmds[0];
    if (cmd && cmd.type === 'If') {
      const baseDepth = line.depth || 0;
      // then-block: lines strictly deeper than baseDepth until depth <= baseDepth or ELSE at same depth
      const thenLines = [];
      let j = i + 1;
      // collect then lines
      while (j < lines.length && (lines[j].depth || 0) > baseDepth) {
        thenLines.push(lines[j]);
        j++;
      }
      // else-case at same depth
      const elseLines = [];
      if (j < lines.length) {
        const maybeElse = lines[j];
        if (maybeElse.depth === baseDepth && maybeElse.cmds && maybeElse.cmds[0] && maybeElse.cmds[0].type === 'Else') {
          j++;
          while (j < lines.length && (lines[j].depth || 0) > baseDepth) {
            elseLines.push(lines[j]);
            j++;
          }
        }
      }
      cmd.then = thenLines;
      if (elseLines.length) cmd.else = elseLines;
    }
  }
}
