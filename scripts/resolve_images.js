'use strict';
// For catalog items missing an image, resolve the product page's real og:image
// via microlink (which renders with a real browser and defeats the simple
// anti-scrape walls that blocked the research agents). Store the direct CDN URL
// only if it verifies as a real image. Leaves image empty on failure.

const fs = require('fs');
const path = require('path');
const CAT = path.join(__dirname, '..', 'seed', 'catalog.json');
const catalog = JSON.parse(fs.readFileSync(CAT, 'utf8'));

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const MIN = 3500;

async function verify(url) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*,*/*' }, signal: ac.signal, redirect: 'follow' });
    if (!r.ok) return false;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image')) return false;
    const b = await r.arrayBuffer();
    return b.byteLength >= MIN;
  } catch (e) { return false; } finally { clearTimeout(t); }
}

async function resolveOne(it) {
  const api = 'https://api.microlink.io/?url=' + encodeURIComponent(it.url) + '&palette=false&audio=false&video=false';
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 30000);
  try {
    const r = await fetch(api, { headers: { 'User-Agent': UA }, signal: ac.signal });
    if (r.status === 429) return { rateLimited: true };
    const j = await r.json();
    const img = j && j.data && j.data.image && j.data.image.url;
    const logo = j && j.data && j.data.logo && j.data.logo.url;
    for (const cand of [img, logo]) {
      if (cand && await verify(cand)) { it.image = cand; return { ok: true }; }
    }
    return { ok: false };
  } catch (e) { return { ok: false, err: e.message }; } finally { clearTimeout(t); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function run() {
  const missing = catalog.filter((i) => !i.image);
  console.log(`resolving ${missing.length} missing images via microlink (serial + backoff)...`);
  let ok = 0, fail = 0, done = 0;
  for (const it of missing) {
    let tries = 0, settled = false;
    while (tries < 5 && !settled) {
      const res = await resolveOne(it);
      if (res.rateLimited) { tries++; await sleep(4000 * tries); continue; }
      if (res.ok) ok++; else fail++;
      settled = true;
    }
    if (!settled) fail++;
    done++;
    if (done % 15 === 0) {
      console.log(`  ...${done}/${missing.length}  (${ok} resolved, ${fail} failed)`);
      fs.writeFileSync(CAT, JSON.stringify(catalog, null, 2)); // checkpoint
    }
    await sleep(1200);
  }
  fs.writeFileSync(CAT, JSON.stringify(catalog, null, 2));
  console.log(`\nresolved ${ok}, still missing ${fail}`);
  console.log(`catalog now ${catalog.length} items, ${catalog.filter((x) => x.image).length} with images`);
}
run();
