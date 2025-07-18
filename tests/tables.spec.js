const assert = require('assert');
const expected = require('./baseline.snap.json');
const current  = require('../src/harness');

describe('Parser tables stability', () => {
  it('should keep all snapshot metrics identical', () => {
    for (const k in expected) {
      assert.strictEqual(current[k], expected[k], `${k} changed`);
    }
  });
});