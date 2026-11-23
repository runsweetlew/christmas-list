// test/catalog_match.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { matchCatalog } = require('../catalog_match');

const CAT = [
  { title: 'Fly Fishing Rod', descr: 'river rod', category: 'fishing', tags: ['anyone'], price_cents: 12000 },
  { title: 'Chew Toy', descr: 'durable', category: 'pets', tags: ['dogs'], price_cents: 2000 },
  { title: 'Gold Watch', descr: 'luxury', category: 'jewelry', tags: ['anyone'], price_cents: 500000 },
  { title: 'Camp Stove', descr: 'camping gear', category: 'outdoors', tags: ['anyone'], price_cents: 9000 },
];

test('matches by keyword overlap within budget', () => {
  const r = { keywords: 'fishing, camping', wishlist: '', budget_max: 20000 };
  const got = matchCatalog(r, CAT).map((i) => i.title);
  assert.ok(got.includes('Fly Fishing Rod'));
  assert.ok(got.includes('Camp Stove'));
  assert.ok(!got.includes('Gold Watch')); // over 1.4x budget
  assert.ok(!got.includes('Chew Toy'));   // dog-only item, non-dog recipient
});

test('dog recipients only get dog items', () => {
  const r = { keywords: 'dog toys treats', wishlist: '', budget_max: 12000, relationship: 'Dogs' };
  const got = matchCatalog(r, CAT).map((i) => i.title);
  assert.deepStrictEqual(got, ['Chew Toy']);
});

test('wishlist words also match', () => {
  const r = { keywords: '', wishlist: 'wants a nice watch', budget_max: 600000 };
  const got = matchCatalog(r, CAT).map((i) => i.title);
  assert.ok(got.includes('Gold Watch'));
});

test('respects the cap', () => {
  const big = Array.from({ length: 200 }, (_, i) => ({ title: 'Camp ' + i, descr: 'camping', category: 'outdoors', tags: ['anyone'], price_cents: 1000 }));
  const r = { keywords: 'camping', wishlist: '', budget_max: 20000 };
  assert.ok(matchCatalog(r, big, 80).length <= 80);
});
