// test/password.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { hashPassword, verifyPassword } = require('../auth/password');

test('hash round-trips with the correct password', () => {
  const h = hashPassword('correct horse battery');
  assert.match(h, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.strictEqual(verifyPassword('correct horse battery', h), true);
});

test('wrong password fails', () => {
  const h = hashPassword('correct horse battery');
  assert.strictEqual(verifyPassword('wrong', h), false);
});

test('tampered / malformed hash fails safely', () => {
  assert.strictEqual(verifyPassword('x', 'not-a-hash'), false);
  assert.strictEqual(verifyPassword('x', ''), false);
  assert.strictEqual(verifyPassword('x', null), false);
});

test('two hashes of the same password differ (random salt)', () => {
  assert.notStrictEqual(hashPassword('same'), hashPassword('same'));
});
