'use strict';
// Fill product images via DuckDuckGo image search (free, no key). For each item
// still on a proxy/placeholder, search the exact product title and store the
// first result that verifies as a real, reasonably-sized image. This defeats the
// Amazon/Chewy scrape walls because the images come from wherever DDG indexed
// them (Walmart, Target, brand CDNs, etc.) which hotlink fine.

const fs = require('fs');
const path = require('path');
const CAT = path.join(__dirname, '..', 'seed', 'catalog.json');
const catalog = JSON.parse(fs.readFileSync(CAT, 'utf8'));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const MIN = 4000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BAD = /(lookaside\.fbsbx|youtube|ytimg|\.gif($|\?)|sprite|logo|favicon|placeholder|no[-_]?image)/i;

async function getVqd(q) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch('https://duckduckgo.com/?q=' + encodeURIComponent(q) + '&iax=images&ia=images', { headers: { 'User-Agent': UA } });
      const h = await r.text();
      const m = h.match(/vqd=["']([0-9-]+)["']/) || h.match(/vqd=([0-9-]+)&/);
      if (m) return m[1];
    } catch (e) {}
    await sleep(1500);
  }
  return null;
}
async function search(q) {
  const vqd = await getVqd(q);
  if (!vqd) return [];
  try {
    const u = 'https://duckduckgo.com/i.js?l=us-en&o=json&q=' + encodeURIComponent(q) + '&vqd=' + vqd + '&f=,,,&p=1';
    const r = await fetch(u, { headers: { 'User-Agent': UA, Referer: 'https://duckduckgo.com/', Accept: 'application/json' } });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.results || []);
  } catch (e) { return []; }
}
async function verify(url) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 12000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*,*/*' }, signal: ac.signal, redirect: 'follow' });
    if (!r.ok) return false;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image')) return false;
    const b = await r.arrayBuffer();
    return b.byteLength >= MIN;
  } catch (e) { return false; } finally { clearTimeout(t); }
}

async function run() {
  const targets = catalog.filter((i) => !i.image || i.image_proxied || /weserv\.nl/i.test(i.image || ''));
  targets.sort((a, b) => (a.tags.includes('dogs') ? 0 : 1) - (b.tags.includes('dogs') ? 0 : 1));
  console.log(`resolving ${targets.length} via DuckDuckGo image search...`);
  let ok = 0, fail = 0, done = 0;
  for (const it of targets) {
    const results = await search(it.title);
    let got = null;
    const cands = results.filter((r) => r.image && !BAD.test(r.image) && (!r.width || r.width >= 300)).slice(0, 6);
    for (const c of cands) { if (await verify(c.image)) { got = c.image; break; } }
    if (got) { it.image = got; delete it.image_proxied; ok++; } else fail++;
    done++;
    if (done % 15 === 0) { console.log(`  ...${done}/${targets.length} (${ok} ok, ${fail} fail)`); fs.writeFileSync(CAT, JSON.stringify(catalog, null, 2)); }
    await sleep(900);
  }
  fs.writeFileSync(CAT, JSON.stringify(catalog, null, 2));
  const direct = catalog.filter((i) => i.image && !/weserv\.nl/i.test(i.image)).length;
  console.log(`\nresolved ${ok}, still ${fail} without`);
  console.log(`catalog: ${direct}/${catalog.length} render-now`);
}
run();
