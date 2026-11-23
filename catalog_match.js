// catalog_match.js
'use strict';

function isDogRecipient(r) {
  const s = ((r.relationship || '') + ' ' + (r.keywords || '') + ' ' + (r.name || '')).toLowerCase();
  return /\bdogs?\b|\bpuppy\b|\bpup\b/.test(s);
}

function words(s) {
  return String(s || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4);
}

// Return catalog items that genuinely fit this recipient, best (most keyword
// overlap) first, capped. Dogs get only dog-tagged items; everyone else is
// matched by keyword/wishlist overlap within ~1.4x their max budget.
function matchCatalog(recipient, catalog, cap = 80) {
  const dog = isDogRecipient(recipient);
  const kws = [...new Set([...words(recipient.keywords), ...words(recipient.wishlist)])];
  const ceiling = Math.max(1, Number(recipient.budget_max) || 20000) * 1.4;
  const scored = [];
  for (const item of catalog) {
    const tags = item.tags || [];
    if (dog) { if (tags.includes('dogs')) scored.push({ item, score: 1 }); continue; }
    if (tags.includes('dogs')) continue; // dog gifts only for dogs
    const price = item.price_cents || 0;
    if (price > 0 && price > ceiling) continue;
    const hay = (item.category + ' ' + item.title + ' ' + item.descr).toLowerCase();
    const score = kws.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
    if (score > 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, cap).map((s) => s.item);
}

module.exports = { matchCatalog };
