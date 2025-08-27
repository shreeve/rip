#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.cjs');
require('../../../../../coffeescript/register.js');

(async () => {
  const { BumpsLexer } = await import('../lexer.js');
  const src = 'SET =1\n';
  let threw = false;
  try {
    parserMod.parse(src);
  } catch (e) {
    threw = true;
  }
  assert.equal(threw, true);
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });


