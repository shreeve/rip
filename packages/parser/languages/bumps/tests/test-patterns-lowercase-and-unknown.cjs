#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.js');
require('../../../../../coffeescript/register.js');

(async () => {
  const { BumpsLexer } = require('../lexer.coffee');
  const { parsePattern } = require('../patterns.coffee');
  const samples = [
    { src: 'IF X?2an\n', check(ast){
        const a = ast.lines[0].cmds[0].cond.pat.items[0];
        assert.equal(a.type, 'ClassSet');
        assert.deepEqual(a.names, ['A','N']);
      }
    },
    { src: 'IF X?1Z\n', check(ast){
        const a = ast.lines[0].cmds[0].cond.pat.items[0];
        assert.equal(a.type, 'Class');
        assert.equal(a.name, 'Z');
        // Unknown class stays as-is; canonical falls back to same
        assert.equal(a.canonical, 'Z');
      }
    }
  ];
  for (const {src, check} of samples) {
    const lex = new BumpsLexer();
    const toks = lex.tokenize(src);
    const p = parserMod.parser;
    p.tokens = toks; p.yy = { node: (t,p)=>({type:t,...(p||{})}), parsePattern };
    p.lexer = { all: toks, i: 0, yytext: '', yyleng: 0, yylloc: {}, yylineno: 0,
      setInput(){ this.i=0; return this; },
      lex(){ if(this.i>=this.all.length) return 1; const [t,v,l]=this.all[this.i++]; this.yytext=String(v??t); this.yyleng=this.yytext.length; this.yylloc=l||{}; this.yylineno=this.yylloc.first_line||0; return t; },
      showPosition(){ return ''; }
    };
    const ast = parserMod.parse(src);
    check(ast);
  }
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
