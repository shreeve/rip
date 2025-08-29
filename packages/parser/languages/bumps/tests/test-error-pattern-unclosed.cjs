#!/usr/bin/env node

const assert = require('assert');
const parserMod = require('../parser.js');
require('../../../../../coffeescript/register.js');

(async () => {
  const src = 'IF X?2(1A,1N\n';
  let threw = false;
  try {
    parserMod.parse(src);
  } catch (e) {
    threw = true;
  }
  assert.equal(threw, true);
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });


