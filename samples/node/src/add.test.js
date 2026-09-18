// assertion_failure reproduction (not admitted as a new case in T7; the corpus
// already covers assertion_failure, but this keeps the sample project able to
// reproduce it). Fails on purpose.
const test = require('node:test');
const assert = require('node:assert');
const { add } = require('./index.js');

test('add adds two numbers', () => {
  assert.strictEqual(add(2, 2), 5);
});
