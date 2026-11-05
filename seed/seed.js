'use strict';
// Default recipients + their head-to-head pools, built from the verified
// real-product catalog (seed/catalog.json, assembled by scripts/build_catalog.js
// from parallel research agents). Each recipient is seeded with every catalog
// item tagged for them plus broadly-giftable ("anyone") items.

const fs = require('fs');
const path = require('path');

const amz = (q) => 'https://www.amazon.com/s?k=' + encodeURIComponent(q);

const DEFAULTS = [
  { key: 'mom', name: 'Mom', relationship: 'Mom', emoji: '👩', age: '60s', gender: 'female',
    keywords: 'cooking, baking, gardening, cozy home, reading, wine, candles, self-care, kitchen gadgets', wishlist: '', budget_min: 5000, budget_max: 25000 },
  { key: 'dad', name: 'Dad', relationship: 'Dad', emoji: '👨', age: '60s', gender: 'male',
    keywords: 'grilling and BBQ, golf, tools, gadgets, history, whiskey, outdoors, cars', wishlist: '', budget_min: 5000, budget_max: 30000 },
  { key: 'wife', name: 'Wife', relationship: 'Wife', emoji: '💍', age: '30s', gender: 'female',
    keywords: 'jewelry, lululemon, cozy knits, travel, spa and self-care, candles, nice kitchen, fashion, coffee', wishlist: '', budget_min: 10000, budget_max: 60000 },
  { key: 'dogs', name: 'The Dogs', relationship: 'Dogs', emoji: '🐕', age: '', gender: '',
    keywords: 'durable chew toys, treats, cozy bed, outdoor dog gear, enrichment puzzle', wishlist: '', budget_min: 1500, budget_max: 12000 },
  { key: 'friends', name: 'Good Friends', relationship: 'Good friends', emoji: '🧑‍🤝‍🧑', age: '30s', gender: '',
    keywords: 'barware, board games, experiences, gadgets, outdoor, coffee, whiskey, fun and a little novel', wishlist: '', budget_min: 2500, budget_max: 12000 },
  { key: 'coworker', name: 'Coworker', relationship: 'Coworker', emoji: '🧑‍💼', age: '', gender: '',
    keywords: 'desk gadget, good coffee, nice notebook, consumable treats, Secret Santa, safe and thoughtful', wishlist: '', budget_min: 1500, budget_max: 6000 },
  { key: 'myself', name: 'Myself', relationship: 'Me (Lewis)', emoji: '🎅', age: '30s', gender: 'male',
    keywords: 'aviation, boating and fishing, camping, tools and DIY, precision tools, running and fitness, smart home, Apple, lululemon, vineyard vines, travel and points', wishlist: '', budget_min: 5000, budget_max: 50000 }
];

function loadCatalog() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog.json'), 'utf8')); }
  catch (e) { console.error('[seed] no catalog.json:', e.message); return []; }
}

// Decide whether a catalog item genuinely fits a person. The key fix: "anyone"
// does NOT mean "put it on every list". Family/self only get a universal item
// when it actually overlaps their stated interests; the generic giftees
// (friends, coworker) are the right home for broadly-nice universal gifts.
const GENERIC = new Set(['friends', 'coworker']);
function fits(item, person) {
  if (person.key === 'dogs') return item.tags.includes('dogs');
  if (item.tags.includes('dogs')) return false; // dog gifts only for dogs
  if (item.tags.includes(person.key)) return true; // explicit, agent-chosen fit
  if (item.tags.includes('anyone')) {
    // universal items must at least be in the right ballpark on price
    const price = item.price_cents || 0;
    if (price > 0 && price > person.budget_max * 1.4) return false;
    if (GENERIC.has(person.key)) return true;
    const kws = (person.keywords || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4);
    const hay = (item.category + ' ' + item.title + ' ' + item.descr).toLowerCase();
    return kws.some((w) => hay.includes(w));
  }
  return false;
}
function itemsFor(key, catalog) {
  const person = DEFAULTS.find((d) => d.key === key);
  return catalog.filter((i) => fits(i, person));
}

function nowIso() { return new Date().toISOString(); }

function seedIfEmpty(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM recipients').get().n;
  if (count > 0) return false;
  const catalog = loadCatalog();
  const ts = nowIso();
  const insR = db.prepare(`INSERT INTO recipients
    (name, relationship, emoji, age, gender, keywords, wishlist, budget_min, budget_max, sort, created, updated)
    VALUES (@name,@relationship,@emoji,@age,@gender,@keywords,@wishlist,@budget_min,@budget_max,@sort,@created,@updated)`);
  const insI = db.prepare(`INSERT INTO ideas
    (recipient_id, title, descr, category, est_price, retailer, search_url, product_url, image, source, why, created, updated)
    VALUES (@recipient_id,@title,@descr,@category,@est_price,@retailer,@search_url,@product_url,@image,'pool',@why,@created,@updated)`);
  const tx = db.transaction(() => {
    DEFAULTS.forEach((d, i) => {
      const r = insR.run({ ...d, sort: i, created: ts, updated: ts });
      const rid = r.lastInsertRowid;
      const items = itemsFor(d.key, catalog);
      for (const it of items) {
        const url = it.url || amz(it.title);
        insI.run({ recipient_id: rid, title: it.title, descr: it.descr, category: it.category,
          est_price: it.price_cents, retailer: it.retailer, search_url: url, product_url: it.url || '',
          image: it.image || '', why: it.why, created: ts, updated: ts });
      }
    });
  });
  tx();
  return true;
}

module.exports = { seedIfEmpty, DEFAULTS };
