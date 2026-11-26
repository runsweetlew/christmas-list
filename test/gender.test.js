// test/gender.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { genderWants, genderTextMismatch, genderQuerySuffix } = require('../gender');

test('genderWants reads common gender spellings', () => {
  assert.deepStrictEqual(genderWants('male'), { wantM: true, wantF: false });
  assert.deepStrictEqual(genderWants('Man'), { wantM: true, wantF: false });
  assert.deepStrictEqual(genderWants('female'), { wantM: false, wantF: true });
  assert.deepStrictEqual(genderWants('Woman'), { wantM: false, wantF: true });
  assert.deepStrictEqual(genderWants(''), { wantM: false, wantF: false });
  assert.deepStrictEqual(genderWants('nonbinary'), { wantM: false, wantF: false });
});

test('no gender set means nothing is ever a mismatch', () => {
  assert.strictEqual(genderTextMismatch("Women's Leather Handbag", ''), false);
  assert.strictEqual(genderTextMismatch('Beard Oil Kit', 'nonbinary'), false);
});

test('explicit opposite-gender wording is a mismatch for a man', () => {
  assert.strictEqual(genderTextMismatch("Women's Wool Peacoat", 'male'), true);
  assert.strictEqual(genderTextMismatch('Ladies Running Shoes', 'male'), true);
  assert.strictEqual(genderTextMismatch('A thoughtful gift for her', 'male'), true);
});

test('women-coded product categories are a mismatch for a man', () => {
  assert.strictEqual(genderTextMismatch('Matte Lipstick Set', 'male'), true);
  assert.strictEqual(genderTextMismatch('Waterproof Mascara', 'male'), true);
  assert.strictEqual(genderTextMismatch('Designer Handbag', 'male'), true);
});

test('men-coded wording is a mismatch for a woman', () => {
  assert.strictEqual(genderTextMismatch("Men's Merino Socks", 'female'), true);
  assert.strictEqual(genderTextMismatch('Beard Grooming Kit', 'female'), true);
  assert.strictEqual(genderTextMismatch('A great gift for him', 'female'), true);
});

test('neutral items are never a mismatch for anyone', () => {
  assert.strictEqual(genderTextMismatch('Cast Iron Skillet', 'male'), false);
  assert.strictEqual(genderTextMismatch('Cast Iron Skillet', 'female'), false);
  assert.strictEqual(genderTextMismatch('Noise Cancelling Headphones', 'female'), false);
  assert.strictEqual(genderTextMismatch('Bourbon Barrel Smoker Chips', 'female'), false);
});

test('items naming both genders are fine for either', () => {
  assert.strictEqual(genderTextMismatch("Men's and Women's Cozy Robe", 'male'), false);
  assert.strictEqual(genderTextMismatch('Unisex Beanie for men and women', 'female'), false);
});

test('an item matching the target gender is fine', () => {
  assert.strictEqual(genderTextMismatch("Men's Leather Wallet", 'male'), false);
  assert.strictEqual(genderTextMismatch('Matte Lipstick Set', 'female'), false);
});

test('genderQuerySuffix targets the shopping query', () => {
  assert.strictEqual(genderQuerySuffix('male'), ' for men');
  assert.strictEqual(genderQuerySuffix('female'), ' for women');
  assert.strictEqual(genderQuerySuffix(''), '');
  assert.strictEqual(genderQuerySuffix('nonbinary'), '');
});
