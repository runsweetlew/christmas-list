// test/avoid.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { avoidFieldTerms, buildAvoidRx } = require('../avoid');

test('every term in a plain comma list is an avoid (no negative phrasing needed)', () => {
  assert.deepStrictEqual(avoidFieldTerms('coffee, cooking, baking'), ['coffee', 'cooking', 'baking']);
});

test('splits on commas, newlines and semicolons', () => {
  assert.deepStrictEqual(avoidFieldTerms('coffee\nbaking; golf'), ['coffee', 'baking', 'golf']);
});

test('drops filler words and keeps the meaningful ones', () => {
  assert.deepStrictEqual(avoidFieldTerms('kitchen stuff, no gift cards'), ['kitchen', 'cards']);
});

test('lowercases and de-duplicates', () => {
  assert.deepStrictEqual(avoidFieldTerms('Coffee, coffee, COFFEE'), ['coffee']);
});

test('empty / whitespace yields no terms', () => {
  assert.deepStrictEqual(avoidFieldTerms(''), []);
  assert.deepStrictEqual(avoidFieldTerms('   '), []);
  assert.deepStrictEqual(avoidFieldTerms(null), []);
});

test('buildAvoidRx matches any listed term on a word boundary', () => {
  const rx = buildAvoidRx(['coffee', 'baking']);
  assert.ok(rx.test('Nordic Ware Bundt Pan (Baking)'));
  assert.ok(rx.test('Porlex Coffee Grinder'));
  assert.ok(!rx.test('Titleist Pro V1 Golf Balls'));
});

test('buildAvoidRx is null for an empty list', () => {
  assert.strictEqual(buildAvoidRx([]), null);
});
