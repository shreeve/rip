#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.js');
require('../../../../../coffeescript/register.js');

(async () => {
  const { BumpsLexer } = require('../lexer.coffee');
  const samples = [
    'READ "Enter name: ",NAME\n',
    'READ "Age: ",AGE:10\n'
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
    const ast = parserMod.parse(src);
    assert.equal(ast.type, 'Program');
    const items = ast.lines[0].cmds[0].args.items;

    if (src.includes('Enter name')) {
      assert.equal(items[0].type, 'ReadPrompt');
      assert.equal(items[0].lhs.name, 'NAME');
      assert(items[0].prompt.includes('Enter name'));
    } else if (src.includes('Age:')) {
      assert.equal(items[0].type, 'ReadPrompt');
      assert.equal(items[0].timeout.value, 10);
    }
  }
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
