// pool.js
'use strict';
// Builds a recipient's head-to-head catalog pool. The key rule: if a recipient
// has stated interests, the pool stays ON those interests - we never pad it with
// generic "broadly giftable" catalog items (which skew heavily toward cookware),
// because that floods, say, a golfer's pool with baking gear. Generic filler is
// only used when there is nothing to stay on-topic about (no interests at all).
const { genderWants } = require('./gender');
const { matchCatalog } = require('./catalog_match');

function matchesAvoid(it, avoid) {
  if (!avoid || !avoid.termRx) return false;
  return avoid.termRx.test((it.title || '') + ' ' + (it.category || '') + ' ' + (it.descr || ''));
}

function hasInterests(r) {
  return (((r.keywords || '') + ' ' + (r.wishlist || '')).trim().length > 0);
}

function selectPool(r, cat, target, avoid = null) {
  const { wantM, wantF } = genderWants(r.gender);
  const hay = ((r.relationship || '') + ' ' + (r.keywords || '') + ' ' + (r.name || '')).toLowerCase();
  const dog = /\bdogs?\b|\bpuppy\b/.test(hay);
  const ceiling = (Number(r.budget_max) || 20000) * 1.4;
  const okTag = (i) => {
    if (matchesAvoid(i, avoid)) return false; // never fill in a disliked category/term
    const t = i.tags || [];
    if (dog) return t.includes('dogs');
    if (t.includes('dogs')) return false;
    const neutral = t.includes('unisex') || t.includes('anyone');
    if (wantM && t.includes('women') && !t.includes('men') && !neutral) return false;
    if (wantF && t.includes('men') && !t.includes('women') && !neutral) return false;
    return true;
  };
  const okBudget = (i) => !i.price_cents || i.price_cents <= ceiling;
  const seen = new Set();
  const chosen = [];
  const add = (it) => { const k = it.title.toLowerCase(); if (seen.has(k)) return; seen.add(k); chosen.push(it); };
  // 1) interest matches that have a photo
  const matched = matchCatalog(r, cat, 400);
  for (const it of matched) { if (chosen.length >= target) break; if (it.image && okTag(it) && okBudget(it)) add(it); }
  // 2) generic fill ONLY for recipients with no stated interests. With interests
  //    present we stay strictly on-topic so unrelated catalog items never flood in.
  if (!hasInterests(r)) {
    const photographed = cat.filter((i) => i.image && okTag(i) && okBudget(i));
    const fill = photographed.filter((i) => (i.tags || []).includes('anyone'))
      .concat(photographed.filter((i) => !(i.tags || []).includes('anyone')));
    for (const it of fill) { if (chosen.length >= target) break; add(it); }
  }
  // 3) last resort if the catalog is tiny: interest matches without a photo
  for (const it of matched) { if (chosen.length >= target) break; if (okTag(it) && okBudget(it)) add(it); }
  return chosen;
}

module.exports = { selectPool, matchesAvoid, hasInterests };
