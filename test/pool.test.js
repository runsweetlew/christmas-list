// test/pool.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { selectPool, hasInterests } = require('../pool');

const CAT = [
  { title: 'Titleist Pro V1 Golf Balls', category: 'Golf', tags: ['men'], image: 'x', price_cents: 5000 },
  { title: 'YETI Camp Chair', category: 'Camping', tags: ['anyone'], image: 'x', price_cents: 4000 },
  { title: 'Nordic Ware Bundt Pan', category: 'Baking', tags: ['anyone'], image: 'x', price_cents: 3000 },
  { title: 'Caraway Cookware Set', category: 'Kitchen', tags: ['anyone'], image: 'x', price_cents: 9000 },
  { title: 'Scented Candle', category: 'Home', tags: ['anyone'], image: 'x', price_cents: 2000 },
];

test('hasInterests reflects keywords/wishlist', () => {
  assert.strictEqual(hasInterests({ keywords: 'golf', wishlist: '' }), true);
  assert.strictEqual(hasInterests({ keywords: '', wishlist: 'a nice watch' }), true);
  assert.strictEqual(hasInterests({ keywords: '', wishlist: '' }), false);
});

test('a recipient WITH interests gets only on-interest items, no generic filler', () => {
  const r = { keywords: 'golf, camping', wishlist: '', gender: 'male', budget_max: 20000 };
  const got = selectPool(r, CAT, 110).map((i) => i.title);
  assert.ok(got.includes('Titleist Pro V1 Golf Balls'), 'keeps golf match');
  assert.ok(got.includes('YETI Camp Chair'), 'keeps camping match');
  assert.ok(!got.includes('Nordic Ware Bundt Pan'), 'no off-interest baking filler');
  assert.ok(!got.includes('Caraway Cookware Set'), 'no off-interest cookware filler');
  assert.ok(!got.includes('Scented Candle'), 'no off-interest generic filler');
});

test('a recipient WITHOUT interests still gets a generic filler pool', () => {
  const r = { keywords: '', wishlist: '', gender: '', budget_max: 20000 };
  const got = selectPool(r, CAT, 110).map((i) => i.title);
  assert.ok(got.includes('Nordic Ware Bundt Pan'), 'generic filler kicks in with no interests');
  assert.ok(got.includes('Scented Candle'));
  assert.ok(got.length >= 4);
});

test('avoid terms exclude matching items even when on-interest', () => {
  const r = { keywords: 'golf, baking', wishlist: '', gender: 'male', budget_max: 20000 };
  const avoid = { terms: ['baking'], termRx: /\b(baking)/i };
  const got = selectPool(r, CAT, 110, avoid).map((i) => i.title);
  assert.ok(got.includes('Titleist Pro V1 Golf Balls'));
  assert.ok(!got.includes('Nordic Ware Bundt Pan'), 'avoid term beats interest match');
});

test('gender filter still excludes opposite-gender-tagged items', () => {
  const r = { keywords: 'golf', wishlist: '', gender: 'female', budget_max: 20000 };
  const got = selectPool(r, CAT, 110).map((i) => i.title);
  assert.ok(!got.includes('Titleist Pro V1 Golf Balls'), 'men-only item excluded for a woman');
});
