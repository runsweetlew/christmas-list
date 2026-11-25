'use strict';
// Live product lookup via SerpApi (Google Shopping) for niche interests the fixed
// catalog does not cover with photos. One query returns ~40 real products WITH
// accurate photos, prices, and links. Results are disk-cached so the same niche
// never costs a second search against the monthly quota. Dormant without a key.

const fs = require('fs');
const path = require('path');

const KEY = process.env.SERPAPI_KEY || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CACHE_FILE = path.join(DATA_DIR, 'serpapi-cache.json');
const TTL_MS = 30 * 86400 * 1000; // 30 days

function serpapiEnabled() { return !!KEY; }

let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (e) { cache = {}; }
function saveCache() { try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch (e) {} }

const normKey = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const nowMs = () => new Date().getTime();

function normalizeResult(p, categoryLabel) {
  const price = Number(p.extracted_price);
  if (!p.title || !p.thumbnail || !price) return null;
  return {
    title: String(p.title).slice(0, 140),
    descr: p.source ? ('Available via ' + String(p.source).slice(0, 60)) : '',
    category: categoryLabel,
    price_cents: Math.round(price * 100),
    retailer: String(p.source || 'Shopping').slice(0, 40),
    url: p.product_link || '',
    image: p.thumbnail,
    tags: ['serpapi', 'anyone'],
    why: ''
  };
}

// One Google Shopping search. Returns normalized product objects (cached).
async function searchShopping(query, { maxPriceCents = 0, categoryLabel = '' } = {}) {
  if (!KEY) return [];
  const label = categoryLabel || query.replace(/\bgifts?\b/i, '').trim().replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40) || 'Gift';
  const qk = normKey(query);
  let items;
  if (cache[qk] && (nowMs() - cache[qk].ts) < TTL_MS) {
    items = cache[qk].items;
  } else {
    const u = 'https://serpapi.com/search.json?engine=google_shopping&num=40&q=' + encodeURIComponent(query) + '&api_key=' + KEY;
    try {
      const j = await fetch(u).then((r) => r.json());
      if (j.error) { console.error('[serpapi]', j.error); return []; }
      items = (j.shopping_results || []).map((p) => normalizeResult(p, label)).filter(Boolean);
      cache[qk] = { ts: nowMs(), items };
      saveCache();
    } catch (e) { console.error('[serpapi] fetch failed:', e.message); return []; }
  }
  // re-label cached items to the caller's category + apply budget ceiling
  return items
    .map((it) => ({ ...it, category: label }))
    .filter((it) => !maxPriceCents || it.price_cents <= maxPriceCents);
}

module.exports = { serpapiEnabled, searchShopping };
