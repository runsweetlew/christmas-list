'use strict';
// Directly scrape og:image from product pages for items still missing a real
// image. Works for most brand/retailer sites (free, unlimited). Skips Chewy
// (hard bot wall). Verifies each extracted image actually loads before storing.

const fs = require('fs');
const path = require('path');
const CAT = path.join(__dirname, '..', 'seed', 'catalog.json');
const catalog = JSON.parse(fs.readFileSync(CAT, 'utf8'));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const MIN = 3500;

function extractOg(html, base) {
  if (!html) return '';
  const pats = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i
  ];
  for (const p of pats) { const m = html.match(p); if (m && m[1]) return abs(m[1], base); }
  // JSON-LD image
  const ld = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of ld) {
    try {
      const data = JSON.parse(block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, ''));
      const nodes = Array.isArray(data) ? data : [data];
      for (const n of nodes) {
        let img = n && n.image;
        if (Array.isArray(img)) img = img[0];
        if (img && typeof img === 'object') img = img.url;
        if (typeof img === 'string' && img) return abs(img, base);
      }
    } catch (e) {}
  }
  return '';
}
function abs(u, base) { try { return new URL(u, base).href; } catch (e) { return u; } }

async function get(url, asImage) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 18000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: asImage ? 'image/*,*/*' : 'text/html,*/*', 'Accept-Language': 'en-US,en;q=0.9' }, signal: ac.signal, redirect: 'follow' });
    if (!r.ok) return null;
    if (asImage) {
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      if (!ct.startsWith('image')) return null;
      const b = await r.arrayBuffer();
      return b.byteLength >= MIN;
    }
    return await r.text();
  } catch (e) { return null; } finally { clearTimeout(t); }
}

async function run() {
  const targets = catalog.filter((i) => (!i.image || i.image_proxied) && i.url && !/chewy\.com/i.test(i.url));
  console.log(`scraping og:image for ${targets.length} items...`);
  let ok = 0, fail = 0, done = 0, idx = 0;
  const CONC = 8;
  async function worker() {
    while (idx < targets.length) {
      const it = targets[idx++];
      const html = await get(it.url, false);
      let found = '';
      if (html) { const og = extractOg(html, it.url); if (og && await get(og, true)) found = og; }
      if (found) { it.image = found; delete it.image_proxied; ok++; }
      else { fail++; }
      done++;
      if (done % 20 === 0) { console.log(`  ...${done}/${targets.length} (${ok} ok)`); fs.writeFileSync(CAT, JSON.stringify(catalog, null, 2)); }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  // any remaining proxied that we could not scrape: drop proxied url, leave blank for clean placeholder
  for (const it of catalog) { if (it.image_proxied) { it.image = ''; delete it.image_proxied; } }
  fs.writeFileSync(CAT, JSON.stringify(catalog, null, 2));
  console.log(`\nscraped ${ok} real og:images, ${fail} failed`);
  console.log(`catalog ${catalog.length} items, ${catalog.filter((x) => x.image).length} with images, ${catalog.filter((x) => !x.image).length} none`);
}
run();
