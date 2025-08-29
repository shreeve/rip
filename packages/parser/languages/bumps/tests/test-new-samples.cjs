#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.js');
require('../../../../../coffeescript/register.js');

(async () => {
  const { BumpsLexer } = require('../lexer.coffee');

  // Test a few of the new samples
  const samples = [
    'READ *CHAR\n',
    'READ INPUT#10\n',
    'READ "Enter name: ",NAME\n',
    'SET CNT=$INCREMENT(^COUNTER)\n',
    'SET TRAP=$ZTRAP\n',
    'SET TXT=$TEXT(LABEL)\n'
  ];

  for (const src of samples) {
    const lex = new BumpsLexer();
    const toks = lex.tokenize(src);
    const p = parserMod.parser;
    p.tokens = toks; p.yy = { node: (t,p)=>({type:t,...(p||{})}) };
    p.lexer = { all: toks, i: 0, yytext: '', yyleng: 0, yylloc: {}, yylineno: 0,
      setInput(){ this.i=0; return this; },
      lex(){ if(this.i>=this.all.length) return 1; const [t,v,l]=this.all[this.i++]; this.yytext=String(v??t); this.yyleng=this.yytext.length; this.yylloc=l||{}; this.yylineno=this.yylloc.first_line||0; return t; },
      showPosition(){ return ''; }
    };

    try {
      const ast = parserMod.parse(src);
      assert.equal(ast.type, 'Program');
      console.log(`✓ ${src.trim()}`);
    } catch (e) {
      console.error(`✗ Failed to parse: ${src.trim()}`);
      console.error(`  Error: ${e.message}`);
      process.exit(1);
    }
  }

  console.log('\nAll new samples parsed successfully!');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
