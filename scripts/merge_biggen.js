'use strict';
// Merge the big parallel "biggen" research batches into seed/catalog.json.
// - dedups against the existing catalog and within the new set (by title)
// - resolves ACCURATE images: og:image from the real product URL first, Bing
//   image search only as a fallback (keeps photo tied to the actual product)
// - items where no image resolves keep image '' (UI shows a clean placeholder)

const fs = require('fs');
const path = require('path');
const { resolveMany } = require('../bing_img');

const SEED = path.join(__dirname, '..', 'seed');
const CAT = path.join(SEED, 'catalog.json');
const RAW = path.join(SEED, 'raw');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const MIN = 3500;

const catalog = JSON.parse(fs.readFileSync(CAT, 'utf8'));
const normKey = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const seen = new Set(catalog.map((i) => normKey(i.title)));

// ---- collect new items ----
const files = fs.readdirSync(RAW).filter((f) => /^biggen_.*\.json$/.test(f));
const incoming = [];
let dupTitles = 0, badRows = 0;
for (const f of files) {
  let arr;
  try { arr = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8')); } catch (e) { console.error('skip (parse)', f, e.message); continue; }
  if (!Array.isArray(arr)) { console.error('skip (not array)', f); continue; }
  for (const it of arr) {
    const title = String(it.title || '').trim().slice(0, 140);
    if (!title) { badRows++; continue; }
    const key = normKey(title);
    if (seen.has(key)) { dupTitles++; continue; }
    seen.add(key);
    let price = parseInt(it.price_cents, 10);
    if (isNaN(price) || price < 0) price = 0;
    if (price > 0 && price < 100) price *= 100; // guard against dollars-not-cents
    const url = /^https?:\/\//i.test(it.url) ? String(it.url).slice(0, 600) : '';
    incoming.push({
      title,
      descr: String(it.descr || '').trim().slice(0, 300),
      category: String(it.category || '').trim().slice(0, 60),
      price_cents: price,
      retailer: String(it.retailer || 'Amazon').trim().slice(0, 40),
      url,
      image: '',
      tags: Array.isArray(it.tags) ? it.tags.map((t) => String(t).toLowerCase().slice(0, 30)).slice(0, 8) : ['anyone'],
      why: String(it.why || it.descr || '').trim().slice(0, 240),
      _sq: String(it.search_query || title).trim().slice(0, 140)
    });
  }
}
console.log(`new items: ${incoming.length} (deduped ${dupTitles}, bad ${badRows}) from ${files.length} files`);

// ---- image helpers ----
function isSearchUrl(u) { return /[?&](k|q|query)=|\/s\?|\/search|\/sch\//i.test(u); }
function abs(u, base) { try { return new URL(u, base).href; } catch (e) { return u; } }
function extractOg(html, base) {
  if (!html) return '';
  const pats = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i
  ];
  for (const p of pats) { const m = html.match(p); if (m && m[1]) return abs(m[1], base); }
  const ld = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of ld) {
    try {
      const data = JSON.parse(block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, ''));
      for (const n of (Array.isArray(data) ? data : [data])) {
        let img = n && n.image;
        if (Array.isArray(img)) img = img[0];
        if (img && typeof img === 'object') img = img.url;
        if (typeof img === 'string' && img) return abs(img, base);
      }
    } catch (e) {}
  }
  return '';
}
async function fetchT(url, asImage) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 16000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: asImage ? 'image/*,*/*' : 'text/html,*/*', 'Accept-Language': 'en-US,en;q=0.9' }, signal: ac.signal, redirect: 'follow' });
    if (!r.ok) return null;
    if (asImage) {
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      if (!ct.startsWith('image')) return null;
      return (await r.arrayBuffer()).byteLength >= MIN;
    }
    return await r.text();
  } catch (e) { return null; } finally { clearTimeout(t); }
}
const BAD = /(lookaside\.fbsbx|\.svg(\?|$)|favicon|sprite|placeholder|no[-_]?image|^data:)/i;
async function ogImage(item) {
  if (!item.url || isSearchUrl(item.url)) return '';
  const html = await fetchT(item.url, false);
  const img = extractOg(html, item.url);
  if (!img || BAD.test(img)) return '';
  const ok = await fetchT(img, true);
  return ok ? img : '';
}

// ---- pass 1: accurate og:image from real product URLs (concurrency pool) ----
(async () => {
  let idx = 0, ogOk = 0, done = 0;
  const CONC = 10;
  async function worker() {
    while (idx < incoming.length) {
      const i = idx++;
      try { const img = await ogImage(incoming[i]); if (img) { incoming[i].image = img; ogOk++; } } catch (e) {}
      if (++done % 50 === 0) console.log(`  og ...${done}/${incoming.length} (${ogOk} ok)`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log(`og:image resolved ${ogOk}/${incoming.length}`);

  // ---- pass 2: Bing fallback for the rest (less accurate, keeps photo-to-title) ----
  const missing = incoming.filter((it) => !it.image);
  console.log(`bing fallback for ${missing.length} items...`);
  const BATCH = 40;
  for (let s = 0; s < missing.length; s += BATCH) {
    const batch = missing.slice(s, s + BATCH);
    let map = new Map();
    try { map = await resolveMany(batch.map((b) => b._sq), 8); } catch (e) {}
    for (const b of batch) { const v = map.get(b._sq); if (v && v.image) b.image = v.image; }
    console.log(`  bing ...${Math.min(s + BATCH, missing.length)}/${missing.length}`);
  }
  const withImg = incoming.filter((it) => it.image).length;

  // ---- strip helper field, merge, write ----
  for (const it of incoming) delete it._sq;
  const merged = catalog.concat(incoming);
  fs.writeFileSync(CAT, JSON.stringify(merged, null, 2));
  console.log(`\nDONE. added ${incoming.length} (images ${withImg}/${incoming.length}); catalog now ${merged.length} items, ${merged.filter((i) => i.image).length} with images`);
})();
