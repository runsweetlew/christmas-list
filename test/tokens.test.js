// test/tokens.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { randomToken, signValue, unsignValue } = require('../auth/tokens');

test('randomToken is urlsafe and the requested byte length', () => {
  const t = randomToken(24);
  assert.match(t, /^[A-Za-z0-9_-]+$/);
  assert.notStrictEqual(randomToken(24), randomToken(24));
});

test('sign then unsign returns the original value', () => {
  const secret = 'test-secret';
  const signed = signValue('sess-abc', secret);
  assert.strictEqual(unsignValue(signed, secret), 'sess-abc');
});

test('tampered or wrong-secret signatures reject', () => {
  const signed = signValue('sess-abc', 'secret-a');
  assert.strictEqual(unsignValue(signed, 'secret-b'), null);
  assert.strictEqual(unsignValue(signed + 'x', 'secret-a'), null);
  assert.strictEqual(unsignValue('garbage', 'secret-a'), null);
  assert.strictEqual(unsignValue('', 'secret-a'), null);
});
