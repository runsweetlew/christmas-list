'use strict';
// Resolve a real product photo for every catalog item via Bing image search
// (free, no key, scrape-tolerant). Searches the exact product title, takes the
// first result that verifies as a real image, and stores it. Keeps any existing
// image on failure. Run from two IPs if Bing starts throttling.

const fs = require('fs');
const path = require('path');
const CAT = path.join(__dirname, '..', 'seed', 'catalog.json');
const catalog = JSON.parse(fs.readFileSync(CAT, 'utf8'));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const MIN = 4000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BAD = /(lookaside\.fbsbx|youtube|ytimg|\.svg(\?|$)|favicon|sprite|placeholder|no[-_]?image|^data:)/i;
const ONLY = process.env.ONLY_MISSING === '1';

async function bing(q) {
  try {
    const r = await fetch('https://www.bing.com/images/search?q=' + encodeURIComponent(q) + '&form=HDRSC2&first=1', { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
    if (!r.ok) return { status: r.status, urls: [] };
    const h = await r.text();
    const urls = [...h.matchAll(/murl&quot;:&quot;(.*?)&quot;/g)].map((m) => m[1].replace(/\\u0026/g, '&'));
    return { status: 200, urls };
  } catch (e) { return { status: 0, urls: [] }; }
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

function needs(it) {
  if (ONLY) return !it.image || it.image_proxied || /weserv\.nl/i.test(it.image || '');
  return true;
}

async function run() {
  const targets = catalog.filter(needs);
  targets.sort((a, b) => (a.tags.includes('dogs') ? 0 : 1) - (b.tags.includes('dogs') ? 0 : 1));
  console.log(`bing-resolving ${targets.length} items...`);
  let ok = 0, fail = 0, done = 0, throttle = 0;
  for (const it of targets) {
    const res = await bing(it.title);
    if (res.status === 429 || res.status === 403) { throttle++; await sleep(5000); }
    let got = null;
    for (const u of res.urls.filter((x) => x && !BAD.test(x)).slice(0, 6)) { if (await verify(u)) { got = u; break; } }
    if (got) { it.image = got; delete it.image_proxied; ok++; } else fail++;
    done++;
    if (done % 20 === 0) { console.log(`  ...${done}/${targets.length} (${ok} ok, ${fail} fail, ${throttle} throttle)`); fs.writeFileSync(CAT, JSON.stringify(catalog, null, 2)); }
    await sleep(850);
  }
  fs.writeFileSync(CAT, JSON.stringify(catalog, null, 2));
  const withImg = catalog.filter((i) => i.image && !/weserv\.nl/i.test(i.image)).length;
  console.log(`\nbing resolved ${ok}, failed ${fail}; catalog ${withImg}/${catalog.length} with real images`);
}
run();
