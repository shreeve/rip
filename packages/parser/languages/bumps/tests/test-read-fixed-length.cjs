#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.js');
require('../../../../../coffeescript/register.js');

(async () => {
  const { BumpsLexer } = require('../lexer.coffee');
  const samples = [
    'READ X#5\n',
    'READ Y#10:3\n',
    'READ A,B#7,C\n'
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
    
    if (src.includes('X#5')) {
      assert.equal(items[0].type, 'ReadFixed');
      assert.equal(items[0].lhs.name, 'X');
      assert.equal(items[0].length.value, 5);
    } else if (src.includes('Y#10:3')) {
      assert.equal(items[0].type, 'ReadFixed');
      assert.equal(items[0].length.value, 10);
      assert.equal(items[0].timeout.value, 3);
    } else if (src.includes('A,B#7,C')) {
      assert.equal(items.length, 3);
      assert.equal(items[0].type, 'ReadItem');
      assert.equal(items[1].type, 'ReadFixed');
      assert.equal(items[1].length.value, 7);
      assert.equal(items[2].type, 'ReadItem');
    }
  }
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
